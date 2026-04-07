#!/usr/bin/env node
'use strict';

/**
 * build-posts.js — Generate static HTML pages for blog posts (SEO)
 *
 * Zero dependencies. Extracts parseMd() from app.js using the same regex
 * pattern as tests/_helpers.js, then generates /updates/<slug>/index.html
 * for each post in posts.json.
 *
 * Idempotent: only writes when content has changed.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var POSTS_JSON = path.join(ROOT, 'updates', 'posts.json');
var APP_JS = path.join(ROOT, 'app.js');
var INDEX_HTML = path.join(ROOT, 'index.html');
var UPDATES_DIR = path.join(ROOT, 'updates');

// ---------------------------------------------------------------------------
// 1. Read CSS/JS cache-bust versions from index.html (stays in sync with
//    bump-shared.sh instead of hardcoding version numbers)
// ---------------------------------------------------------------------------

var indexSrc = fs.readFileSync(INDEX_HTML, 'utf8');

function extractVersion(pattern, label) {
  var m = indexSrc.match(pattern);
  if (!m) throw new Error('Cannot find ' + label + ' version in index.html');
  return m[1];
}

var V_BASE_CSS = extractVersion(/\/shared\/base\.css\?v=(\d+)/, 'base.css');
var V_STYLE_CSS = extractVersion(/style\.css\?v=(\d+)/, 'style.css');
var V_BASE_JS = extractVersion(/\/shared\/base\.js\?v=(\d+)/, 'base.js');

// ---------------------------------------------------------------------------
// 2. Extract parseMd from app.js (same pattern as tests/_helpers.js)
// ---------------------------------------------------------------------------

var appSrc = fs.readFileSync(APP_JS, 'utf8');

var parserSrc =
  'var RE_UL = /^[-*] /;\n' +
  'var RE_OL = /^\\d+\\. /;\n' +
  appSrc.match(/function esc\(s\)\{[\s\S]*?\n\}/)[0] + '\n' +
  appSrc.match(/function il\(t\)\{[\s\S]*?\n\}/)[0] + '\n' +
  appSrc.match(/function parseMd\(md[^)]*\)\{[\s\S]*?\n\}/)[0] + '\n';

// Evaluate parser in an isolated module
var tmp = path.join(__dirname, '_build_parser_tmp_' + process.pid + '.js');
fs.writeFileSync(tmp, parserSrc + '\nmodule.exports = { parseMd: parseMd };\n');
var parser = require(tmp);
fs.unlinkSync(tmp);

var parseMd = parser.parseMd;

// ---------------------------------------------------------------------------
// 3. Read posts.json
// ---------------------------------------------------------------------------

var posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));

// ---------------------------------------------------------------------------
// 4. Multi-card layout builder (string-based, mirrors SPA render logic)
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
    if (tok.type === 'h2') {
      flush();
      body += '<div class="link-sec"><h3>' + tok.text + '</h3></div>\n';
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
    var h2 = remaining.match(/^<h2>([\s\S]*?)<\/h2>/);
    if (h2) {
      tokens.push({ type: 'h2', text: h2[1] });
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
// 5. Metadata helpers
// ---------------------------------------------------------------------------

/**
 * Strip HTML tags and decode common entities to get plain text.
 */
function stripHtml(html) {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Generate a meta description from post plain text (~160 chars).
 */
function metaDescription(html) {
  var text = stripHtml(html);
  if (text.length <= 160) return text;
  // Truncate at word boundary
  var truncated = text.slice(0, 160);
  var lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 120) truncated = truncated.slice(0, lastSpace);
  return truncated + '...';
}

/**
 * Escape a string for use inside an HTML attribute value.
 */
function escAttr(s) {
  return s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// ---------------------------------------------------------------------------
// 6. HTML template
// ---------------------------------------------------------------------------

function generatePage(post, slug, layout) {
  var canonical = 'https://saputra.co.uk/updates/' + slug;
  var pageTitle = layout.title || post.title;
  var desc = metaDescription(layout.body);
  var isoDate = post.date + 'T00:00:00+00:00';

  return '<!DOCTYPE html>\n' +
    '<html lang="en">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="color-scheme" content="light dark">\n' +
    '<title>DS | ' + escAttr(pageTitle) + '</title>\n' +
    '<meta name="description" content="' + escAttr(desc) + '">\n' +
    '<meta name="theme-color" content="#FAFAFA">\n' +
    '<link rel="canonical" href="' + canonical + '">\n' +
    '<link rel="icon" type="image/png" href="/favicon.png">\n' +
    '\n' +
    '<!-- Open Graph -->\n' +
    '<meta property="og:title" content="' + escAttr(pageTitle) + '">\n' +
    '<meta property="og:description" content="' + escAttr(desc) + '">\n' +
    '<meta property="og:type" content="article">\n' +
    '<meta property="og:url" content="' + canonical + '">\n' +
    '<meta property="og:site_name" content="Duke Saputra">\n' +
    '<meta property="og:locale" content="en_GB">\n' +
    '<meta property="og:image" content="https://saputra.co.uk/og-image.png">\n' +
    '<meta property="og:image:width" content="1200">\n' +
    '<meta property="og:image:height" content="630">\n' +
    '<meta property="og:image:alt" content="' + escAttr(pageTitle) + '">\n' +
    '\n' +
    '<!-- Twitter Card -->\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + escAttr(pageTitle) + '">\n' +
    '<meta name="twitter:description" content="' + escAttr(desc) + '">\n' +
    '<meta name="twitter:image" content="https://saputra.co.uk/og-image.png">\n' +
    '\n' +
    '<!-- JSON-LD -->\n' +
    '<script type="application/ld+json">\n' +
    JSON.stringify({
      '@context': 'https://schema.org',
      '@type': 'Article',
      'headline': pageTitle,
      'description': desc,
      'datePublished': isoDate,
      'dateModified': isoDate,
      'url': canonical,
      'author': {
        '@type': 'Person',
        'name': 'Duke Saputra',
        'url': 'https://saputra.co.uk'
      },
      'publisher': {
        '@type': 'Person',
        'name': 'Duke Saputra',
        'url': 'https://saputra.co.uk'
      }
    }, null, 2) + '\n' +
    '</script>\n' +
    '\n' +
    '<script>(function(){var t;try{t=localStorage.getItem(\'theme\')}catch(_){}if(t&&t!==\'light\')document.documentElement.setAttribute(\'data-theme\',t)})()</script>\n' +
    '<link rel="stylesheet" href="/shared/base.css?v=' + V_BASE_CSS + '">\n' +
    '<link rel="stylesheet" href="/style.css?v=' + V_STYLE_CSS + '">\n' +
    '</head>\n' +
    '<body>\n' +
    '\n' +
    '<!-- Navigation -->\n' +
    '<nav aria-label="Main navigation">\n' +
    '  <div class="tabs">\n' +
    '    <a href="/">Home</a>\n' +
    '    <a href="/projects">Projects</a>\n' +
    '    <a href="/updates" class="active">Updates</a>\n' +
    '    <a href="/links">Links</a>\n' +
    '  </div>\n' +
    '</nav>\n' +
    '\n' +
    '<main class="wrap">\n' +
    '<h2 class="stitle">' + escAttr(pageTitle) + '</h2>\n' +
    layout.body +
    '</main>\n' +
    '\n' +
    '<script src="/shared/base.js?v=' + V_BASE_JS + '"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

// ---------------------------------------------------------------------------
// 7. Build loop
// ---------------------------------------------------------------------------

var built = 0;
var unchanged = 0;

posts.forEach(function(post) {
  var slug = post.file.replace(/\.md$/, '');
  var mdPath = path.join(UPDATES_DIR, post.file);

  if (!fs.existsSync(mdPath)) {
    console.error('SKIP: ' + post.file + ' not found');
    return;
  }

  var md = fs.readFileSync(mdPath, 'utf8');
  var html = parseMd(md);
  var layout = buildLayout(html);
  var page = generatePage(post, slug, layout);

  var outDir = path.join(UPDATES_DIR, slug);
  var outFile = path.join(outDir, 'index.html');

  // Idempotent: only write if content changed
  if (fs.existsSync(outFile)) {
    var existing = fs.readFileSync(outFile, 'utf8');
    if (existing === page) {
      unchanged++;
      return;
    }
  }

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  fs.writeFileSync(outFile, page);
  built++;
  console.log('BUILT: updates/' + slug + '/index.html');
});

console.log('\n' + built + ' built, ' + unchanged + ' unchanged');
