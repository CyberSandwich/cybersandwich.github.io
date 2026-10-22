'use strict';

/**
 * static-page.js: shared by build-posts.js and build-listings.js
 *
 * Generated pages render with app.js's own parser, icons, categories and card
 * markup, lifted out of app.js by regex at build time (each piece up to its
 * first unindented `}` or end of line), so a static page and its SPA view
 * cannot drift. CSS/JS ?v= params are read from index.html, which
 * bump-shared.sh keeps current.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..', '..');
var SITE = 'https://saputra.co.uk';
// The site is US English (context/content-editing.md); index.html carries the same locale.
var LANG = 'en-US';
var OG_IMAGE = SITE + '/og-image.png';

// Pixel size of a JPEG (first SOF marker) or PNG (IHDR), or null: og:image width/height without an image library
function imageSize(file) {
  var b;
  try { b = fs.readFileSync(file); } catch (_) { return null; }
  if (b.length > 24 && b.readUInt32BE(0) === 0x89504E47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b[0] !== 0xFF || b[1] !== 0xD8) return null;
  for (var i = 2; i + 9 < b.length && b[i] === 0xFF;) {
    var m = b[i + 1];
    // SOF0 to SOF15 carry the frame size; C4 (Huffman), C8 (reserved) and CC (arithmetic) are not frames
    if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return { width: b.readUInt16BE(i + 7), height: b.readUInt16BE(i + 5) };
    i += 2 + b.readUInt16BE(i + 2);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Cache-bust versions from index.html
// ---------------------------------------------------------------------------

var indexSrc = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

function version(pattern, label) {
  var m = indexSrc.match(pattern);
  if (!m) throw new Error('Cannot find ' + label + ' version in index.html');
  return m[1];
}

var V = {
  baseCss: version(/\/shared\/base\.css\?v=(\d+)/, 'base.css'),
  styleCss: version(/style\.css\?v=(\d+)/, 'style.css'),
  baseJs: version(/\/shared\/base\.js\?v=(\d+)/, 'base.js')
};

// ---------------------------------------------------------------------------
// Pieces of app.js, evaluated in an isolated module
// ---------------------------------------------------------------------------

var appSrc = fs.readFileSync(path.join(ROOT, 'app.js'), 'utf8');

function lift(re, label) {
  var m = appSrc.match(re);
  if (!m) throw new Error('Cannot find ' + label + ' in app.js');
  return m[0];
}

var ONE_LINERS = ['SVG_WRAP_OPEN', 'SVG_WRAP_CLOSE', 'CHEVRON', 'DEFAULT_PROJECT_ICON', 'DEFAULT_LINK_ICON',
  'emailBody', 'projectCategories', 'linkCategories'];

var liftedSrc = [
  lift(/function esc\(s\)\{[\s\S]*?\n\}/, 'esc'),
  lift(/function il\(t\)\{[\s\S]*?\n\}/, 'il'),
  lift(/function parseMd\(md[^)]*\)\{[\s\S]*?\n\}/, 'parseMd'),
  lift(/function postMeta\(md,file\)\{[\s\S]*?\n\}/, 'postMeta'),
  lift(/function cleanUrl\(u\)\{[^\n]*\}/, 'cleanUrl'),
  lift(/function mailtoUrl\(t\)\{[^\n]*\}/, 'mailtoUrl'),
  lift(/const PROJECT_ICONS=\{[\s\S]*?\n\};/, 'PROJECT_ICONS'),
  lift(/const ICONS=\{[\s\S]*?\n\};/, 'ICONS')
].concat(ONE_LINERS.map(function(n) {
  return lift(new RegExp('const ' + n + '=[^\\n]*;'), n);
})).join('\n');

var exportNames = ['parseMd', 'postMeta', 'cleanUrl', 'mailtoUrl', 'PROJECT_ICONS', 'ICONS'].concat(ONE_LINERS);
var tmp = path.join(__dirname, '_lifted_tmp_' + process.pid + '.js');
fs.writeFileSync(tmp, liftedSrc + '\nmodule.exports = { ' + exportNames.map(function(n) { return n + ': ' + n; }).join(', ') + ' };\n');
var app;
try { app = require(tmp); } finally { fs.unlinkSync(tmp); }

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Text-node escaping exactly as the DOM serializes textContent, so card markup compares byte for byte with the SPA's
function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Strip tags and decode the entities esc() produces
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

// fmtDate in app.js formats with en-GB; the static pages match it
function fmtDate(d, opts) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-GB', opts || { day: 'numeric', month: 'long', year: 'numeric' });
}

// Home › ...trail, as a schema.org BreadcrumbList
function breadcrumbs(trail) {
  return {
    '@type': 'BreadcrumbList',
    'itemListElement': [{ name: 'Home', item: SITE + '/' }].concat(trail).map(function(x, i) {
      return { '@type': 'ListItem', 'position': i + 1, 'name': x.name, 'item': x.item };
    })
  };
}

// Same group-filter-sort as catGroups in app.js
function catGroups(cats, items) {
  return cats.map(function(cat) {
    return { label: cat, items: items.filter(function(x) { return x.category === cat; }).sort(function(a, b) { return a.title.localeCompare(b.title); }) };
  });
}

/**
 * The markup renderCards in app.js builds, as a string: one .link-sec per
 * non-empty group, a .pcard per item, chevron on every card. The SPA's search
 * data-* attributes are left out because static pages have no search.
 * cfg: { href, external, title, sub, icon } as in app.js's showCards configs.
 */
function cardsHtml(groups, cfg) {
  var body = '';
  groups.forEach(function(g) {
    if (!g.items.length) return;
    body += '<div class="link-sec"><h3>' + escText(g.label) + '</h3>';
    g.items.forEach(function(x) {
      var icon = cfg.icon(x);
      body += '<a class="pcard' + (x.featured ? ' featured' : '') + '" href="' + escAttr(cfg.href(x)) + '"' +
        (cfg.external && cfg.external(x) ? ' target="_blank" rel="noopener noreferrer"' : '') + '>' +
        '<div class="picon">' + (icon.slice(0, 4) === '<svg' ? icon : app.SVG_WRAP_OPEN + icon + app.SVG_WRAP_CLOSE) + '</div>' +
        '<div class="pinf"><div class="pt">' + escText(cfg.title(x)) + '</div><div class="pd">' + escText(cfg.sub(x)) + '</div></div>' +
        '<div class="arr">' + app.CHEVRON + '</div></a>';
    });
    body += '</div>\n';
  });
  return body || '<div class="empty" role="status">Coming Soon!</div>\n';
}

/**
 * A full static page: head (meta, OG, Twitter, JSON-LD @graph), theme FOUC
 * guard, shared CSS, nav with o.active highlighted, h1.stitle, o.body inside
 * o.listId (the SPA's container id, so page CSS applies), base.js.
 * o: { title, tabTitle?, desc, canonical, ogType, extraMeta, graph, active, listId, body }
 * The tab title is the page title alone (owner: no site-name suffix); tabTitle overrides it where the SPA uses another.
 */
function pageShell(o) {
  // o.image {url, width, height, alt}: a post's cover; anything else shares the site card
  var img = o.image || { url: OG_IMAGE, width: 1200, height: 630, alt: o.title };
  var tab = function(href, label) {
    return '    <a href="' + href + '"' + (o.active === href ? ' class="active"' : '') + '>' + label + '</a>\n';
  };
  return '<!DOCTYPE html>\n' +
    '<html lang="' + LANG + '">\n' +
    '<head>\n' +
    '<meta charset="UTF-8">\n' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' +
    '<meta name="color-scheme" content="light dark">\n' +
    '<title>' + escAttr(o.tabTitle || o.title) + '</title>\n' +
    '<meta name="description" content="' + escAttr(o.desc) + '">\n' +
    '<meta name="theme-color" content="#FAFAFA">\n' +
    '<link rel="canonical" href="' + o.canonical + '">\n' +
    '<link rel="icon" type="image/png" href="/favicon.png">\n' +
    '\n' +
    '<!-- Open Graph -->\n' +
    '<meta property="og:title" content="' + escAttr(o.title) + '">\n' +
    '<meta property="og:description" content="' + escAttr(o.desc) + '">\n' +
    '<meta property="og:type" content="' + o.ogType + '">\n' +
    '<meta property="og:url" content="' + o.canonical + '">\n' +
    '<meta property="og:site_name" content="Duke Saputra">\n' +
    '<meta property="og:locale" content="' + LANG.replace('-', '_') + '">\n' +
    '<meta property="og:image" content="' + img.url + '">\n' +
    '<meta property="og:image:width" content="' + img.width + '">\n' +
    '<meta property="og:image:height" content="' + img.height + '">\n' +
    '<meta property="og:image:alt" content="' + escAttr(img.alt) + '">\n' +
    (o.extraMeta || '') +
    '\n' +
    '<!-- Twitter Card -->\n' +
    '<meta name="twitter:card" content="summary_large_image">\n' +
    '<meta name="twitter:title" content="' + escAttr(o.title) + '">\n' +
    '<meta name="twitter:description" content="' + escAttr(o.desc) + '">\n' +
    '<meta name="twitter:image" content="' + img.url + '">\n' +
    '\n' +
    '<!-- JSON-LD -->\n' +
    '<script type="application/ld+json">\n' +
    // "</" would end the script element early; "<\/" is the same JSON string
    JSON.stringify({ '@context': 'https://schema.org', '@graph': o.graph }, null, 2).replace(/<\//g, '<\\/') + '\n' +
    '</script>\n' +
    '\n' +
    '<script>(function(){var t;try{t=localStorage.getItem(\'theme\')}catch(_){}if(t&&t!==\'light\')document.documentElement.setAttribute(\'data-theme\',t)})()</script>\n' +
    '<link rel="stylesheet" href="/shared/base.css?v=' + V.baseCss + '">\n' +
    '<link rel="stylesheet" href="/style.css?v=' + V.styleCss + '">\n' +
    '</head>\n' +
    '<body>\n' +
    '\n' +
    '<!-- Navigation -->\n' +
    '<nav aria-label="Main navigation">\n' +
    '  <div class="tabs">\n' +
    tab('/', 'Home') + tab('/projects', 'Projects') + tab('/posts', 'Posts') + tab('/links', 'Links') +
    '  </div>\n' +
    '</nav>\n' +
    '\n' +
    '<main class="wrap">\n' +
    '<h1 class="stitle">' + escAttr(o.title) + '</h1>\n' +
    '<div id="' + (o.listId || 'ulist') + '">\n' +
    o.body +
    '</div>\n' +
    '</main>\n' +
    '\n' +
    '<script src="/shared/base.js?v=' + V.baseJs + '"></script>\n' +
    '</body>\n' +
    '</html>\n';
}

/**
 * Writes <rel>/index.html under the site root only when the content changed.
 * stats: { built, unchanged } counters the caller prints.
 */
function writePage(rel, page, stats) {
  var outFile = path.join(ROOT, rel, 'index.html');
  if (fs.existsSync(outFile) && fs.readFileSync(outFile, 'utf8') === page) {
    stats.unchanged++;
    return;
  }
  fs.mkdirSync(path.dirname(outFile), { recursive: true });
  fs.writeFileSync(outFile, page);
  stats.built++;
  console.log('BUILT: ' + rel + '/index.html');
}

module.exports = {
  ROOT: ROOT, SITE: SITE, LANG: LANG, OG_IMAGE: OG_IMAGE, imageSize: imageSize,
  app: app, parseMd: app.parseMd,
  escAttr: escAttr, stripHtml: stripHtml, fmtDate: fmtDate, breadcrumbs: breadcrumbs,
  catGroups: catGroups, cardsHtml: cardsHtml, pageShell: pageShell, writePage: writePage
};
