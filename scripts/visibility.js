#!/usr/bin/env node
'use strict';

/**
 * visibility.js: the one way to change whether a sub-project page is public.
 *
 * A page is public in five hand-kept places, plus the generated outputs:
 *   1. <slug>/index.html   no `<meta name="robots" content="noindex">`
 *   2. projects/projects.json   an entry with url /<slug>/
 *   3. app.js   a PROJECT_ICONS entry keyed by that entry's title
 *   4. sitemap.xml   a <url> line
 *   5. llms.txt   a line in the ## Projects section
 *   6. index.html noscript block and projects/index.html (build-noscript.js, build-listings.js)
 *
 * Usage:
 *   node scripts/visibility.js status [slug]
 *   node scripts/visibility.js publish <slug> --category C --title T --subtitle S --icon NAME
 *                                      [--llms TEXT] [--lastmod YYYY-MM-DD]
 *   node scripts/visibility.js unlist <slug>
 * Flags: -n/--dry-run (print the edits, write nothing), --force (act on a page whose
 * places disagree), --no-build (skip bump-shared.sh and the two build scripts).
 *
 * --icon takes an existing PROJECT_ICONS key, an ICONS key, or a Lucide name from
 * iconic/icons/. Every edit is a line edit, so untouched bytes stay untouched.
 * Idempotent: a page already in the requested state is left alone.
 * status exits 1 when any page is partial or its generated outputs are stale.
 */

var fs = require('fs');
var path = require('path');
var cp = require('child_process');

var ROOT = path.join(__dirname, '..');
var SITE = 'https://saputra.co.uk';
var REL = {
  json: 'projects/projects.json',
  app: 'app.js',
  sitemap: 'sitemap.xml',
  llms: 'llms.txt',
  index: 'index.html',
  listing: 'projects/index.html'
};
// Top-level directories that hold an index.html or look like a page but are not sub-projects
var NOT_SUBPROJECTS = ['posts', 'projects', 'links', 'archive', 'shared', 'scripts', 'tests', 'context',
  'docs', 'tasks', 'assets', 'website-assets', 'node_modules'];
var NOINDEX_LINE = '<meta name="robots" content="noindex">';
var NOINDEX_RE = /<meta\s+name=["']robots["']\s+content=["'][^"']*noindex[^"']*["']\s*\/?>/i;
var REDIRECT_MARK = '<!-- generated-redirect';
var ICON_LINE = /^'((?:[^'\\]|\\.)*)':'(.*?)',?$/;

function UserError(msg) { this.message = msg; }
function fail(msg) { throw new UserError(msg); }

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function abs(rel) { return path.join(ROOT, rel); }
function readRel(rel) { return fs.readFileSync(abs(rel), 'utf8'); }
function eolOf(text) { return text.indexOf('\r\n') !== -1 ? '\r\n' : '\n'; }
function splitLines(text) { var eol = eolOf(text); return { lines: text.split(eol), eol: eol }; }
function joinLines(o) { return o.lines.join(o.eol); }
function escIcon(s) { return s.replace(/\\/g, '\\\\').replace(/'/g, "\\'"); }
// Same escaping as the Add Project workflow's json.dump, so both writers agree
function asciiEscape(s) {
  return s.replace(/[^\x00-\x7f]/g, function(c) { return '\\u' + ('0000' + c.charCodeAt(0).toString(16)).slice(-4); });
}
function today() {
  var d = new Date();
  function p(n) { return (n < 10 ? '0' : '') + n; }
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function pageUrl(slug) { return '/' + slug + '/'; }

// ---------------------------------------------------------------------------
// Page (noindex meta)
// ---------------------------------------------------------------------------

function headOf(html) {
  var i = html.indexOf('</head>');
  return i === -1 ? html : html.slice(0, i);
}

function hasNoindex(html) { return NOINDEX_RE.test(headOf(html)); }

// Goes on the line before <title>, where the page that was listed last carried it
function addNoindex(html, slug) {
  var o = splitLines(html);
  var i = o.lines.findIndex(function(l) { return /^\s*<title>/.test(l); });
  if (i === -1) fail(slug + '/index.html has no <title> line to anchor the robots meta; add it by hand');
  o.lines.splice(i, 0, NOINDEX_LINE);
  return joinLines(o);
}

function removeNoindex(html, slug) {
  var o = splitLines(html);
  var i = o.lines.findIndex(function(l) { return l.trim() === NOINDEX_LINE; });
  if (i === -1) fail(slug + '/index.html has a non-standard noindex robots meta; remove it by hand');
  o.lines.splice(i, 1);
  return joinLines(o);
}

// ---------------------------------------------------------------------------
// projects.json (line edits that reproduce json.dump(indent=2))
// ---------------------------------------------------------------------------

function jsonBlocks(text) {
  var lines = splitLines(text).lines, blocks = [], s = -1;
  lines.forEach(function(l, i) {
    if (l === '  {') s = i;
    else if (s !== -1 && /^  \},?$/.test(l)) { blocks.push({ start: s, end: i }); s = -1; }
  });
  return blocks;
}

function parseProjects(text) {
  var data = JSON.parse(text);
  if (jsonBlocks(text).length !== data.length) {
    fail(REL.json + ' is not laid out as one two-space-indented block per entry; refusing to edit it');
  }
  return data;
}

function findEntry(data, slug) {
  var u = pageUrl(slug);
  for (var i = 0; i < data.length; i++) {
    if (data[i].url === u || data[i].url === u.slice(0, -1)) return i;
  }
  return -1;
}

// Same order as the Add Project workflow: category order, then title case-insensitively
function insertIndex(data, entry, cats) {
  function key(e) { var c = cats.indexOf(e.category); return [c === -1 ? 999 : c, e.title.toLowerCase()]; }
  var k = key(entry);
  for (var i = 0; i < data.length; i++) {
    var d = key(data[i]);
    if (d[0] > k[0] || (d[0] === k[0] && d[1] > k[1])) return i;
  }
  return data.length;
}

function insertJsonEntry(text, entry, idx) {
  var o = splitLines(text), blocks = jsonBlocks(text);
  var body = asciiEscape(JSON.stringify(entry, null, 2)).split('\n').map(function(l) { return '  ' + l; });
  if (!blocks.length) return '[' + o.eol + body.join(o.eol) + o.eol + ']' + o.eol;
  var args;
  if (idx < blocks.length) {
    body[body.length - 1] += ',';
    args = [blocks[idx].start, 0].concat(body);
  } else {
    var last = blocks[blocks.length - 1].end;
    if (!/,$/.test(o.lines[last])) o.lines[last] += ',';
    args = [last + 1, 0].concat(body);
  }
  o.lines.splice.apply(o.lines, args);
  return joinLines(o);
}

function removeJsonEntry(text, idx) {
  var o = splitLines(text), blocks = jsonBlocks(text);
  if (blocks.length === 1) return '[]' + o.eol;
  var b = blocks[idx];
  o.lines.splice(b.start, b.end - b.start + 1);
  if (idx === blocks.length - 1) {
    var prev = blocks[idx - 1].end;
    o.lines[prev] = o.lines[prev].replace(/,$/, '');
  }
  return joinLines(o);
}

// ---------------------------------------------------------------------------
// app.js icon maps
// ---------------------------------------------------------------------------

function mapRange(lines, name) {
  var start = lines.findIndex(function(l) { return l.indexOf('const ' + name + '={') === 0; });
  if (start === -1) fail('Cannot find const ' + name + ' in ' + REL.app);
  for (var end = start + 1; end < lines.length; end++) if (lines[end] === '};') return { start: start, end: end };
  return fail(name + ' in ' + REL.app + ' has no closing "};" line');
}

// Raw (still escaped) key -> raw value
function parseMap(src, name) {
  var lines = splitLines(src).lines, r = mapRange(lines, name), out = {};
  for (var i = r.start + 1; i < r.end; i++) {
    var m = ICON_LINE.exec(lines[i]);
    if (m) out[m[1]] = m[2];
  }
  return out;
}

function addProjectIcon(src, title, rawValue) {
  var o = splitLines(src), r = mapRange(o.lines, 'PROJECT_ICONS');
  var prev = r.end - 1;
  if (prev > r.start && !/,$/.test(o.lines[prev])) o.lines[prev] += ',';
  o.lines.splice(r.end, 0, "'" + escIcon(title) + "':'" + rawValue + "'");
  return joinLines(o);
}

function removeProjectIcon(src, title) {
  var o = splitLines(src), r = mapRange(o.lines, 'PROJECT_ICONS'), key = escIcon(title);
  for (var i = r.start + 1; i < r.end; i++) {
    var m = ICON_LINE.exec(o.lines[i]);
    if (!m || m[1] !== key) continue;
    o.lines.splice(i, 1);
    if (i === r.end - 1 && i - 1 > r.start) o.lines[i - 1] = o.lines[i - 1].replace(/,$/, '');
    return joinLines(o);
  }
  return src;
}

function categoriesOf(appSrc) {
  var m = appSrc.match(/const projectCategories=\[([^\]]*)\]/);
  if (!m) fail('Cannot find projectCategories in ' + REL.app);
  return m[1].split(',').map(function(s) { return s.trim().replace(/^'|'$/g, ''); }).filter(Boolean);
}

// Inner SVG of an iconic/icons/<name>.svg, in the form the maps in app.js hold
function lucideInner(name) {
  var file = abs('iconic/icons/' + name + '.svg');
  if (!/^[a-z0-9-]+$/.test(name) || !fs.existsSync(file)) return null;
  var m = fs.readFileSync(file, 'utf8').match(/<svg[^>]*>([\s\S]*)<\/svg>/);
  if (!m) return null;
  return m[1].split('\n').map(function(l) { return l.trim(); }).filter(Boolean).join('').replace(/ \/>/g, '/>');
}

function resolveIcon(name, appSrc) {
  var key = escIcon(name);
  var own = parseMap(appSrc, 'PROJECT_ICONS'), named = parseMap(appSrc, 'ICONS');
  if (own[key] !== undefined) return own[key];
  if (named[key] !== undefined) return named[key];
  var inner = lucideInner(name);
  if (inner) return inner.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  return fail('Unknown icon "' + name + '": not a PROJECT_ICONS or ICONS key, and no iconic/icons/' + name + '.svg');
}

// ---------------------------------------------------------------------------
// sitemap.xml and llms.txt
// ---------------------------------------------------------------------------

function sitemapMatches(lines, slug) {
  var needle = '<loc>' + SITE + '/' + slug + '/</loc>';
  return lines.map(function(l, i) { return l.indexOf(needle) !== -1 ? i : -1; }).filter(function(i) { return i !== -1; });
}

function addSitemap(text, slug, lastmod) {
  var o = splitLines(text), one = /<loc>https:\/\/saputra\.co\.uk\/[^\/<]+\/<\/loc>/, at = -1;
  o.lines.forEach(function(l, i) { if (one.test(l) && l.indexOf('<priority>0.4</priority>') !== -1) at = i; });
  if (at === -1) o.lines.forEach(function(l, i) { if (one.test(l)) at = i; });
  if (at === -1) at = o.lines.findIndex(function(l) { return l.indexOf('</urlset>') !== -1; }) - 1;
  if (at < -1) fail('sitemap.xml has no </urlset> to anchor the new <url>');
  o.lines.splice(at + 1, 0, '  <url><loc>' + SITE + '/' + slug + '/</loc><lastmod>' + lastmod + '</lastmod><priority>0.4</priority></url>');
  return joinLines(o);
}

function removeSitemap(text, slug) {
  var o = splitLines(text);
  sitemapMatches(o.lines, slug).reverse().forEach(function(i) { o.lines.splice(i, 1); });
  return joinLines(o);
}

function llmsSection(lines) {
  var start = lines.findIndex(function(l) { return l === '## Projects'; });
  if (start === -1) fail('llms.txt has no "## Projects" section');
  var end = lines.length;
  for (var i = start + 1; i < lines.length; i++) if (lines[i].indexOf('## ') === 0) { end = i; break; }
  return { start: start, end: end };
}

function llmsMatches(lines, slug) {
  var s = llmsSection(lines), needle = '](' + SITE + '/' + slug + '/)', out = [];
  for (var i = s.start + 1; i < s.end; i++) if (lines[i].indexOf('- [') === 0 && lines[i].indexOf(needle) !== -1) out.push(i);
  return out;
}

function addLlms(text, slug, title, desc) {
  var o = splitLines(text), s = llmsSection(o.lines), at = s.start, internal = -1;
  for (var i = s.start + 1; i < s.end; i++) {
    if (o.lines[i].indexOf('- [') !== 0) continue;
    at = i;
    if (o.lines[i].indexOf('](' + SITE + '/') !== -1) internal = i;
  }
  if (internal !== -1) at = internal;
  o.lines.splice(at + 1, 0, '- [' + title + '](' + SITE + '/' + slug + '/), ' + desc);
  return joinLines(o);
}

function removeLlms(text, slug) {
  var o = splitLines(text);
  llmsMatches(o.lines, slug).reverse().forEach(function(i) { o.lines.splice(i, 1); });
  return joinLines(o);
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

function load() {
  return { json: readRel(REL.json), app: readRel(REL.app), sitemap: readRel(REL.sitemap), llms: readRel(REL.llms),
    index: readRel(REL.index), listing: readRel(REL.listing) };
}

function noscriptBlock(index) {
  var s = index.indexOf('<!-- noscript:projects:start -->'), e = index.indexOf('<!-- noscript:projects:end -->');
  return s === -1 || e === -1 ? '' : index.slice(s, e);
}

function pageInfo(slug) {
  var file = abs(slug + '/index.html');
  if (!fs.existsSync(file)) return { exists: false };
  var html = fs.readFileSync(file, 'utf8');
  return { exists: true, html: html, redirect: html.indexOf(REDIRECT_MARK) !== -1 };
}

function inspect(slug, t) {
  var page = pageInfo(slug);
  var data = parseProjects(t.json), idx = findEntry(data, slug), entry = idx === -1 ? null : data[idx];
  var icons = parseMap(t.app, 'PROJECT_ICONS');
  var href = 'href="' + pageUrl(slug) + '"';
  var inJson = !!entry;
  var noscript = noscriptBlock(t.index).indexOf(href) !== -1, listing = t.listing.indexOf(href) !== -1;
  return {
    slug: slug, page: page, entry: entry, idx: idx,
    noindex: page.exists && hasNoindex(page.html),
    icon: !!entry && icons[escIcon(entry.title)] !== undefined,
    sitemap: sitemapMatches(splitLines(t.sitemap).lines, slug).length > 0,
    llms: llmsMatches(splitLines(t.llms).lines, slug).length > 0,
    noscript: noscript, listing: listing,
    built: noscript === inJson && listing === inJson
  };
}

// The five hand-kept places, each as "does this say public"
function places(i) {
  return [
    ['robots meta', !i.noindex, i.noindex ? 'noindex present' : 'noindex absent'],
    ['projects.json', !!i.entry, i.entry ? 'entry present' : 'entry missing'],
    ['PROJECT_ICONS', i.icon, i.icon ? 'icon present' : 'icon missing'],
    ['sitemap.xml', i.sitemap, i.sitemap ? 'url present' : 'url missing'],
    ['llms.txt', i.llms, i.llms ? 'line present' : 'line missing']
  ];
}

function classify(i) {
  var n = places(i).filter(function(p) { return p[1]; }).length;
  return n === 5 ? 'listed' : n === 0 ? 'unlisted' : 'partial';
}

function disagreement(i) {
  var p = places(i);
  function names(pub) { return p.filter(function(x) { return x[1] === pub; }).map(function(x) { return x[2]; }).join(', '); }
  return 'public: ' + names(true) + '; hidden: ' + names(false);
}

function subprojectSlugs() {
  return fs.readdirSync(ROOT).filter(function(d) {
    if (d.charAt(0) === '.' || NOT_SUBPROJECTS.indexOf(d) !== -1) return false;
    var f = abs(d + '/index.html');
    if (!fs.existsSync(f)) return false;
    return fs.readFileSync(f, 'utf8').indexOf(REDIRECT_MARK) === -1;
  }).sort();
}

function requireSubproject(slug) {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(slug || '')) fail('Slug must be lowercase letters, digits and dashes: "' + (slug || '') + '"');
  if (NOT_SUBPROJECTS.indexOf(slug) !== -1) fail('"' + slug + '" is not a sub-project directory');
  var page = pageInfo(slug);
  if (!page.exists) fail(slug + '/index.html does not exist');
  if (page.redirect) fail(slug + '/ is a generated redirect (redirects.json), not a sub-project; its robots meta is by design');
  return page;
}

// ---------------------------------------------------------------------------
// status
// ---------------------------------------------------------------------------

function yn(b) { return b ? 'yes' : 'no'; }

function pad(s, n) { s = String(s); while (s.length < n) s += ' '; return s; }

function statusOne(slug, t, out) {
  requireSubproject(slug);
  var i = inspect(slug, t), st = classify(i);
  out.push(slug + '  ' + st.toUpperCase());
  out.push('  robots meta     ' + (i.noindex ? 'noindex present (hidden)' : 'noindex absent (indexable)'));
  out.push('  projects.json   ' + (i.entry ? i.entry.category + ', "' + i.entry.title + '"' : 'no entry'));
  out.push('  PROJECT_ICONS   ' + (i.icon ? "key '" + i.entry.title + "'" : (i.entry ? "no key '" + i.entry.title + "'" : 'no entry to key on')));
  out.push('  sitemap.xml     ' + (i.sitemap ? 'url present' : 'no url'));
  out.push('  llms.txt        ' + (i.llms ? 'line present' : 'no line'));
  out.push('  generated       ' + (i.built ? 'in sync' : 'STALE') + ' (noscript ' + yn(i.noscript) + ', /projects ' + yn(i.listing) + ')');
  if (st === 'partial') out.push('  DISAGREE        ' + disagreement(i));
  return st === 'partial' || !i.built;
}

function statusAll(t, out) {
  var data = parseProjects(t.json), slugs = subprojectSlugs(), bad = 0;
  var cols = ['slug', 'state', 'noindex', 'json', 'icon', 'sitemap', 'llms', 'built'], w = [16, 10, 9, 6, 6, 9, 6, 6];
  out.push(cols.map(function(c, k) { return pad(c, w[k]); }).join('').replace(/\s+$/, ''));
  var details = [];
  slugs.forEach(function(slug) {
    var i = inspect(slug, t), st = classify(i);
    var row = [slug, st.toUpperCase(), yn(i.noindex), yn(!!i.entry), yn(i.icon), yn(i.sitemap), yn(i.llms), i.built ? 'ok' : 'STALE'];
    out.push(row.map(function(c, k) { return pad(c, w[k]); }).join('').replace(/\s+$/, ''));
    if (st === 'partial') details.push('  ' + slug + ': ' + disagreement(i));
    if (st === 'partial' || !i.built) bad++;
  });
  out.push('', 'noindex yes = hidden; every other column yes = present; built = noscript and /projects match projects.json');
  var counts = { listed: 0, unlisted: 0, partial: 0 };
  slugs.forEach(function(s) { counts[classify(inspect(s, t))]++; });
  out.push(counts.listed + ' listed, ' + counts.unlisted + ' unlisted, ' + counts.partial + ' partial');
  if (details.length) out.push('', 'Pages whose places disagree:'), details.forEach(function(d) { out.push(d); });

  var pageless = data.filter(function(e) { return e.url === '#'; }).map(function(e) { return e.title; });
  if (pageless.length) out.push('', 'Pageless entries (url "#", never touched by this script): ' + pageless.join(', '));
  var orphanEntries = data.filter(function(e) {
    return e.url.charAt(0) === '/' && !/\.\w+$/.test(e.url) && slugs.indexOf(e.url.replace(/^\/|\/$/g, '')) === -1;
  }).map(function(e) { return e.title + ' (' + e.url + ')'; });
  if (orphanEntries.length) out.push('', 'Entries pointing at a path with no sub-project page: ' + orphanEntries.join(', '));

  var keys = Object.keys(parseMap(t.app, 'PROJECT_ICONS')).map(function(k) { return k.replace(/\\(.)/g, '$1'); });
  var titles = data.map(function(e) { return e.title; });
  var noIcon = titles.filter(function(x) { return keys.indexOf(x) === -1; });
  var noProject = keys.filter(function(x) { return titles.indexOf(x) === -1; });
  if (noIcon.length || noProject.length) {
    out.push('', 'Icon parity: titles without an icon key: ' + (noIcon.join(', ') || 'none') + '; icon keys without a project: ' + (noProject.join(', ') || 'none'));
  } else {
    out.push('', 'Icon parity: ' + titles.length + ' titles, ' + keys.length + ' keys, no orphans');
  }
  return bad > 0;
}

// ---------------------------------------------------------------------------
// publish / unlist
// ---------------------------------------------------------------------------

function diffLines(a, b) {
  var A = a.split('\n'), B = b.split('\n'), c = {}, added = [], removed = [];
  A.forEach(function(l) { c[l] = (c[l] || 0) + 1; });
  B.forEach(function(l) { if (c[l]) c[l]--; else added.push(l); });
  A.forEach(function(l) { if (c[l]) { c[l]--; removed.push(l); } });
  return { added: added, removed: removed };
}

function clip(s) { return s.length > 150 ? s.slice(0, 147) + '...' : s; }

function requireArgs(a, names) {
  var missing = names.filter(function(n) { return !a[n]; });
  if (missing.length) fail('publish needs ' + missing.map(function(n) { return '--' + n; }).join(', '));
}

function planPublish(slug, a, t, page, i) {
  var next = { page: page.html, json: t.json, app: t.app, sitemap: t.sitemap, llms: t.llms };
  var notes = [];
  var cats = categoriesOf(t.app);
  var title = i.entry ? i.entry.title : a.title;

  if (!i.entry) {
    requireArgs(a, ['category', 'title', 'subtitle']);
    if (cats.indexOf(a.category) === -1) fail('Unknown category "' + a.category + '". Categories (from app.js): ' + cats.join(', '));
    if (a.title.length > 100) fail('Title must be 1 to 100 characters');
    if (a.subtitle.length > 200) fail('Subtitle must be 1 to 200 characters');
    var data = parseProjects(t.json);
    data.forEach(function(e) {
      if (e.title.toLowerCase() === a.title.toLowerCase()) fail('A project titled "' + e.title + '" already exists in ' + e.category);
    });
    var entry = { title: a.title, subtitle: a.subtitle, url: pageUrl(slug), category: a.category };
    next.json = insertJsonEntry(t.json, entry, insertIndex(data, entry, cats));
  } else if (a.title && a.title !== i.entry.title) {
    notes.push('keeping existing title "' + i.entry.title + '" (ignoring --title)');
  }

  var haveKey = parseMap(t.app, 'PROJECT_ICONS')[escIcon(title)] !== undefined;
  if (!haveKey) {
    requireArgs(a, ['icon']);
    next.app = addProjectIcon(t.app, title, resolveIcon(a.icon, t.app));
  }
  if (i.noindex) next.page = removeNoindex(page.html, slug);
  if (!i.sitemap) next.sitemap = addSitemap(t.sitemap, slug, a.lastmod || today());
  if (!i.llms) {
    var desc = a.llms || (i.entry ? i.entry.subtitle : a.subtitle);
    if (/[–—]/.test(desc)) fail('llms.txt text must not contain en or em dashes (context/content-editing.md); use commas');
    next.llms = addLlms(t.llms, slug, title, desc);
  }
  return { next: next, notes: notes };
}

function planUnlist(slug, t, page, i, st) {
  var next = { page: page.html, json: t.json, app: t.app, sitemap: t.sitemap, llms: t.llms };
  var notes = [];
  if (!i.noindex) next.page = addNoindex(page.html, slug);
  if (i.entry) {
    next.json = removeJsonEntry(t.json, i.idx);
    next.app = removeProjectIcon(t.app, i.entry.title);
  } else if (st === 'partial') {
    notes.push('no projects.json entry, so the PROJECT_ICONS key cannot be identified; check it by hand');
  }
  if (i.sitemap) next.sitemap = removeSitemap(t.sitemap, slug);
  if (i.llms) next.llms = removeLlms(t.llms, slug);
  return { next: next, notes: notes };
}

function runStep(cmd, args, label) {
  var r = cp.spawnSync(cmd, args, { cwd: ROOT, encoding: 'utf8' });
  var text = ((r.stdout || '') + (r.stderr || '')).replace(/\x1b\[[0-9;]*m/g, '').trim();
  if (text) console.log(text.split('\n').map(function(l) { return '  ' + l; }).join('\n'));
  if (r.status !== 0) fail(label + ' failed (exit ' + r.status + '); the source edits above are already written');
}

function apply(slug, verb, plan, t, page, i, opts) {
  var files = { page: slug + '/index.html', json: REL.json, app: REL.app, sitemap: REL.sitemap, llms: REL.llms };
  var before = { page: page.html, json: t.json, app: t.app, sitemap: t.sitemap, llms: t.llms };
  var changed = Object.keys(files).filter(function(k) { return plan.next[k] !== before[k]; });
  plan.notes.forEach(function(n) { console.log('note: ' + n); });

  if (!changed.length && i.built) {
    console.log(slug + ': already ' + (verb === 'publish' ? 'public' : 'unlisted') + ', nothing to do');
    return;
  }

  var steps = [];
  if (changed.indexOf('json') !== -1) steps.push(['zsh', ['scripts/bump-shared.sh', 'data-v'], 'bump-shared.sh data-v']);
  if (changed.indexOf('app') !== -1) steps.push(['zsh', ['scripts/bump-shared.sh', 'main-js'], 'bump-shared.sh main-js']);
  steps.push(['node', ['scripts/build-noscript.js'], 'build-noscript.js']);
  steps.push(['node', ['scripts/build-listings.js'], 'build-listings.js']);

  if (opts.dry) {
    console.log('dry run, ' + slug + ' ' + verb + ': nothing written');
    changed.forEach(function(k) {
      var d = diffLines(before[k], plan.next[k]);
      console.log(files[k]);
      d.removed.forEach(function(l) { console.log('  - ' + clip(l)); });
      d.added.forEach(function(l) { console.log('  + ' + clip(l)); });
    });
    if (!opts.noBuild) steps.forEach(function(s) { console.log('then: ' + s[0] + ' ' + s[1].join(' ')); });
    return;
  }

  changed.forEach(function(k) {
    fs.writeFileSync(abs(files[k]), plan.next[k]);
    console.log('edited ' + files[k]);
  });
  if (opts.noBuild) { console.log('skipped bump and builds (--no-build)'); return; }
  steps.forEach(function(s) { runStep(s[0], s[1], s[2]); });
  console.log(slug + ': ' + (verb === 'publish' ? 'published' : 'unlisted'));
}

function change(verb, slug, a, opts) {
  var page = requireSubproject(slug), t = load(), i = inspect(slug, t), st = classify(i);
  if (st === 'partial' && !opts.force) {
    fail(slug + ' is in a partial state, so its places disagree (' + disagreement(i) + '). ' +
      'Fix it by hand, or rerun with --force to make every place match "' + verb + '".');
  }
  var plan = verb === 'publish' ? planPublish(slug, a, t, page, i) : planUnlist(slug, t, page, i, st);
  apply(slug, verb, plan, t, page, i, opts);
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

var USAGE = [
  'Usage:',
  '  node scripts/visibility.js status [slug]',
  '  node scripts/visibility.js publish <slug> --category C --title T --subtitle S --icon NAME [--llms TEXT] [--lastmod YYYY-MM-DD]',
  '  node scripts/visibility.js unlist <slug>',
  'Flags: -n/--dry-run, --force, --no-build'
].join('\n');

var VALUE_FLAGS = ['category', 'title', 'subtitle', 'icon', 'llms', 'lastmod'];

function parseArgs(argv) {
  var r = { pos: [], a: {}, opts: { dry: false, force: false, noBuild: false } };
  for (var k = 0; k < argv.length; k++) {
    var arg = argv[k];
    if (arg === '-n' || arg === '--dry-run') { r.opts.dry = true; continue; }
    if (arg === '--force') { r.opts.force = true; continue; }
    if (arg === '--no-build') { r.opts.noBuild = true; continue; }
    if (arg.indexOf('--') !== 0) { r.pos.push(arg); continue; }
    var eq = arg.indexOf('='), name = eq === -1 ? arg.slice(2) : arg.slice(2, eq);
    if (VALUE_FLAGS.indexOf(name) === -1) fail('Unknown flag ' + arg + '\n' + USAGE);
    var val = eq === -1 ? argv[++k] : arg.slice(eq + 1);
    if (val === undefined || val === '') fail('--' + name + ' needs a value');
    r.a[name] = val.trim();
  }
  return r;
}

function main(argv) {
  var cmd = argv[0], p = parseArgs(argv.slice(1));
  if (cmd === 'status') {
    var out = [], t = load(), bad = p.pos[0] ? statusOne(p.pos[0], t, out) : statusAll(t, out);
    console.log(out.join('\n'));
    return bad ? 1 : 0;
  }
  if (cmd === 'publish' || cmd === 'unlist') {
    if (p.pos.length !== 1) fail(cmd + ' takes exactly one slug\n' + USAGE);
    if (p.a.lastmod && !/^\d{4}-\d{2}-\d{2}$/.test(p.a.lastmod)) fail('--lastmod must be YYYY-MM-DD');
    change(cmd, p.pos[0], p.a, p.opts);
    return 0;
  }
  return fail(cmd ? 'Unknown command "' + cmd + '"\n' + USAGE : USAGE);
}

try {
  process.exit(main(process.argv.slice(2)));
} catch (e) {
  if (!(e instanceof UserError)) throw e;
  console.error('visibility: ' + e.message);
  process.exit(1);
}
