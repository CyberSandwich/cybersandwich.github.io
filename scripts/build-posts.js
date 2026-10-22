#!/usr/bin/env node
'use strict';

/**
 * build-posts.js: static HTML for every post (/posts/<slug>/) and the /posts
 * listing, for crawlers and social previews.
 *
 * Zero dependencies. Parser, icons and page shell come from lib/static-page.js,
 * which lifts them out of app.js so static pages match the SPA.
 *
 * Idempotent: only writes when content has changed.
 */

var fs = require('fs');
var path = require('path');
var S = require('./lib/static-page.js');

var POSTS_DIR = path.join(S.ROOT, 'posts');
var parseMd = S.parseMd;
var stripHtml = S.stripHtml;
var SITE = S.SITE;

var posts = JSON.parse(fs.readFileSync(path.join(POSTS_DIR, 'posts.json'), 'utf8'));

// ---------------------------------------------------------------------------
// 1. Multi-card layout builder (string-based, mirrors SPA render logic)
// ---------------------------------------------------------------------------

/**
 * Applies the same card layout as showPost() in app.js:
 * - <h1> → extracted as page title (removed from body)
 * - <h2> → section heading: <div class="link-sec"><h3>text</h3></div>
 * - <hr> → card boundary (flushes current pcontent card)
 * - everything else → accumulated into <div class="pcontent">...</div>
 *
 * Returns { title: string, body: string }
 */
function buildLayout(html) {
  // Extract <h1> for page title
  var title = '';
  var h1Match = html.match(/<h1>([\s\S]*?)<\/h1>/);
  if (h1Match) {
    title = h1Match[1];
    html = html.replace(/<h1>[\s\S]*?<\/h1>/, '');
  }

  // Split the remaining HTML into tokens: h2, hr, or other content
  // We need to walk through the HTML string and identify top-level elements
  var tokens = tokenize(html);
  var body = '';
  var card = '';

  function flush() {
    if (card) {
      body += '<div class="pcontent">' + card + '</div>\n';
      card = '';
    }
  }

  for (var i = 0; i < tokens.length; i++) {
    var tok = tokens[i];
    // The postMeta dateline and the cover image sit outside the cards (mirrors showPost in app.js)
    if (tok.type === 'content' && /^<(p|figure) class="(pmeta|pcover)">/.test(tok.html)) {
      body += tok.html + '\n';
      continue;
    }
    if (tok.type === 'h2') {
      flush();
      body += '<div class="link-sec"' + (tok.id ? ' id="' + tok.id + '"' : '') + '><h3>' + tok.text + '</h3></div>\n';
    } else if (tok.type === 'hr') {
      flush();
    } else {
      card += tok.html;
    }
  }
  flush();

  return { title: title, body: body };
}

/**
 * Tokenize HTML into top-level elements.
 * Recognizes <h2>...</h2>, <hr>, and everything else as content chunks.
 */
function tokenize(html) {
  var tokens = [];
  var remaining = html.trim();

  while (remaining.length > 0) {
    // Skip whitespace between tags
    var ws = remaining.match(/^\s+/);
    if (ws) {
      remaining = remaining.slice(ws[0].length);
      if (!remaining.length) break;
    }

    // Check for <h2>
    var h2 = remaining.match(/^<h2(?: id="([^"]*)")?>([\s\S]*?)<\/h2>/);
    if (h2) {
      tokens.push({ type: 'h2', id: h2[1], text: h2[2] });
      remaining = remaining.slice(h2[0].length);
      continue;
    }

    // Check for <hr> (with optional attributes/self-closing)
    var hr = remaining.match(/^<hr\s*\/?>/);
    if (hr) {
      tokens.push({ type: 'hr' });
      remaining = remaining.slice(hr[0].length);
      continue;
    }

    // Consume one top-level element or text node
    var tag = remaining.match(/^<(\w+)[\s>]/);
    if (tag) {
      var tagName = tag[1];
      // Self-closing tags
      if (/^(br|hr|img|input)$/i.test(tagName)) {
        var selfClose = remaining.match(/^<\w+[^>]*\/?>/);
        if (selfClose) {
          tokens.push({ type: 'content', html: selfClose[0] });
          remaining = remaining.slice(selfClose[0].length);
          continue;
        }
      }
      // Find matching closing tag (simple: works for well-formed HTML from parseMd)
      var closeTag = '</' + tagName + '>';
      var closeIdx = findClosingTag(remaining, tagName);
      if (closeIdx !== -1) {
        var chunk = remaining.slice(0, closeIdx + closeTag.length);
        tokens.push({ type: 'content', html: chunk });
        remaining = remaining.slice(chunk.length);
        continue;
      }
    }

    // Fallback: consume until next < or end
    var next = remaining.indexOf('<', 1);
    if (next === -1) next = remaining.length;
    tokens.push({ type: 'content', html: remaining.slice(0, next) });
    remaining = remaining.slice(next);
  }

  return tokens;
}

/**
 * Find the index of the matching closing tag, handling nesting.
 */
function findClosingTag(html, tagName) {
  var openTag = '<' + tagName;
  var closeTag = '</' + tagName + '>';
  var depth = 0;
  var pos = 0;

  while (pos < html.length) {
    var nextOpen = html.indexOf(openTag, pos);
    var nextClose = html.indexOf(closeTag, pos);

    if (nextClose === -1) return -1;

    if (nextOpen !== -1 && nextOpen < nextClose) {
      // Verify it's actually an opening tag (not just a substring)
      var charAfter = html.charAt(nextOpen + openTag.length);
      if (charAfter === ' ' || charAfter === '>' || charAfter === '/') {
        depth++;
        pos = nextOpen + openTag.length;
      } else {
        pos = nextOpen + 1;
      }
    } else {
      depth--;
      if (depth === 0) return nextClose;
      pos = nextClose + closeTag.length;
    }
  }
  return -1;
}

// ---------------------------------------------------------------------------
// 2. Metadata helpers
// ---------------------------------------------------------------------------

/**
 * Generate a meta description from post plain text (~160 chars).
 */
function metaDescription(html) {
  // Section-heading wrappers are layout, not prose: left in, every description opened with the first heading.
  var text = stripHtml(html.replace(/<div class="link-sec">[\s\S]*?<\/div>/g, ' '));
  if (text.length <= 160) return text;
  // Truncate at word boundary
  var truncated = text.slice(0, 160);
  var lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 120) truncated = truncated.slice(0, lastSpace);
  return truncated + '...';
}

/**
 * Read the optional `key: value` frontmatter block. Only `description` and
 * `updated` (YYYY-MM-DD) are used; anything else is ignored, never an error.
 */
function parseFrontmatter(md) {
  var m = md.replace(/\r\n/g, '\n').match(/^---\n([\s\S]*?)\n---/);
  var fm = {};
  if (!m) return fm;
  m[1].split('\n').forEach(function(line) {
    var kv = line.match(/^(\w+):\s*(.*?)\s*$/);
    if (kv) fm[kv[1]] = kv[2].replace(/^(["'])(.*)\1$/, '$2');
  });
  if (fm.updated && !/^\d{4}-\d{2}-\d{2}$/.test(fm.updated)) {
    console.error('WARN: ignoring updated "' + fm.updated + '" (want YYYY-MM-DD)');
    delete fm.updated;
  }
  return fm;
}

// ---------------------------------------------------------------------------
// 3. Pages
// ---------------------------------------------------------------------------

/**
 * The cover as the social card: a .jpg (or .png) beside the cover's file, since some platforms reject a WebP
 * og:image. Null (site card) without a cover, or when no such copy exists or its size cannot be read.
 */
function coverImage(body) {
  var m = body.match(/^<(?:p|figure) class="pcover"><img src="(\/[^"]+)" alt="([^"]*)"/m);
  if (!m) return null;
  var base = m[1].replace(/[?#].*$/, '').replace(/\.\w+$/, '');
  var alt = m[2].replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
  var exts = ['.jpg', '.jpeg', '.png'];
  for (var i = 0; i < exts.length; i++) {
    var size = S.imageSize(path.join(S.ROOT, base + exts[i]));
    if (size) return { url: SITE + base + exts[i], width: size.width, height: size.height, alt: alt };
  }
  return null;
}

function generatePage(post, slug, layout, fm) {
  fm = fm || {};
  var canonical = SITE + '/posts/' + slug;
  var pageTitle = layout.title || post.title;
  var plainTitle = stripHtml(pageTitle);
  var desc = fm.description || metaDescription(layout.body);
  var published = post.date + 'T00:00:00+00:00';
  var modified = (fm.updated || post.date) + 'T00:00:00+00:00';
  var author = { '@type': 'Person', 'name': 'Duke Saputra', 'url': SITE };
  var cover = coverImage(layout.body);

  var article = {
    '@type': 'Article',
    'headline': plainTitle,
    'description': desc,
    'datePublished': published,
    'dateModified': modified,
    'inLanguage': S.LANG,
    'url': canonical,
    'mainEntityOfPage': { '@type': 'WebPage', '@id': canonical },
    'image': cover ? cover.url : S.OG_IMAGE,
    'author': author,
    'publisher': author
  };
  if (post.words) article.wordCount = post.words;

  return S.pageShell({
    title: plainTitle,
    desc: desc,
    canonical: canonical,
    ogType: 'article',
    image: cover,
    extraMeta:
      '<meta property="article:published_time" content="' + published + '">\n' +
      '<meta property="article:modified_time" content="' + modified + '">\n' +
      '<meta property="article:author" content="Duke Saputra">\n',
    graph: [article, S.breadcrumbs([{ name: 'Posts', item: SITE + '/posts' }, { name: plainTitle, item: canonical }])],
    active: '/posts',
    body: layout.body
  });
}

// Same HTML showPost's parse() builds: the postMeta dateline, then the parsed markdown
function renderPost(md, file) {
  var meta = S.app.postMeta(md, file);
  return (meta ? '<p class="pmeta">' + S.escAttr(meta) + '</p>' : '') + parseMd(md);
}

// /posts listing: month groups, newest first, the cards showList draws in the SPA
function generateIndex(list) {
  var canonical = SITE + '/posts';
  var slugOf = function(p) { return p.slug || p.file.replace(/\.md$/, ''); };
  var groups = [];
  list.forEach(function(p) {
    var label = S.fmtDate(p.date, { month: 'long', year: 'numeric' });
    if (!groups.length || groups[groups.length - 1].label !== label) groups.push({ label: label, items: [] });
    groups[groups.length - 1].items.push(p);
  });
  var desc = 'Guides and articles by Duke Saputra.';
  return S.pageShell({
    title: 'Posts',
    tabTitle: 'DS | Posts', // what the SPA's router shows on /posts
    desc: desc,
    canonical: canonical,
    ogType: 'website',
    graph: [{
      '@type': 'CollectionPage',
      'name': 'Posts',
      'description': desc,
      'url': canonical,
      'inLanguage': S.LANG,
      'mainEntity': {
        '@type': 'ItemList',
        'itemListElement': list.map(function(p, i) {
          return { '@type': 'ListItem', 'position': i + 1, 'url': SITE + '/posts/' + slugOf(p) };
        })
      }
    }, S.breadcrumbs([{ name: 'Posts', item: canonical }])],
    active: '/posts',
    body: S.cardsHtml(groups, {
      href: function(p) { return '/posts/' + slugOf(p); },
      title: function(p) { return p.title; },
      sub: function(p) { return S.fmtDate(p.date); },
      icon: function(p) { return S.app.ICONS[p.icon] || S.app.ICONS.post; }
    })
  });
}

// ---------------------------------------------------------------------------
// 4. Build
// ---------------------------------------------------------------------------

module.exports = { parseFrontmatter: parseFrontmatter, coverImage: coverImage, buildLayout: buildLayout, renderPost: renderPost, generatePage: generatePage, generateIndex: generateIndex };
if (require.main !== module) return;

var stats = { built: 0, unchanged: 0 };

posts.forEach(function(post) {
  var slug = post.slug || post.file.replace(/\.md$/, '');
  var mdPath = path.join(POSTS_DIR, post.file);

  if (!fs.existsSync(mdPath)) {
    console.error('SKIP: ' + post.file + ' not found');
    return;
  }

  var md = fs.readFileSync(mdPath, 'utf8');
  S.writePage('posts/' + slug, generatePage(post, slug, buildLayout(renderPost(md, post.file)), parseFrontmatter(md)), stats);
});

// /posts itself, so the listing is a real 200 page and not the SPA's 404.html fallback
S.writePage('posts', generateIndex(posts), stats);

console.log('\n' + stats.built + ' built, ' + stats.unchanged + ' unchanged');
