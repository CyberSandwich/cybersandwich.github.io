#!/usr/bin/env node
'use strict';

/**
 * build-redirects.js
 *
 * Generate minimal static redirect pages from redirects.json.
 * Each entry produces <slug>/index.html at repo root: synchronous JS
 * location.replace + meta refresh fallback + noscript link. Generated
 * files carry a marker comment so this script knows it can overwrite
 * them safely without --force.
 *
 * Usage:
 *   node scripts/build-redirects.js                    build all
 *   node scripts/build-redirects.js --add SLUG URL [TITLE]
 *                                                      append+build
 *   node scripts/build-redirects.js --remove SLUG      drop from manifest
 *   node scripts/build-redirects.js --list             print all redirects
 *   node scripts/build-redirects.js --dry-run          preview only
 *   node scripts/build-redirects.js --force            overwrite non-generated
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var MANIFEST = path.join(ROOT, 'redirects.json');
var MARKER = '<!-- generated-redirect: do not edit, see redirects.json -->';

// Reserved top-level names that must not be clobbered by a redirect slug.
var PROTECTED = [
  'archive', 'assets', 'context', 'docs', 'iconic', 'links', 'posts',
  'projects', 'scripts', 'shared', 'tasks', 'tests',
  '.git', '.github', 'node_modules', 'api', 'admin'
];

function die(msg) {
  console.error('error: ' + msg);
  process.exit(1);
}

function parseArgs(argv) {
  var f = { add: null, remove: null, list: false, dryRun: false, force: false };
  for (var i = 0; i < argv.length; i++) {
    var a = argv[i];
    if (a === '--add') {
      var slug = argv[++i], url = argv[++i];
      if (!slug || !url) die('--add requires SLUG and URL');
      var title = (argv[i + 1] && argv[i + 1].charAt(0) !== '-') ? argv[++i] : null;
      f.add = { slug: slug, url: url, title: title };
    } else if (a === '--remove') {
      f.remove = argv[++i];
      if (!f.remove) die('--remove requires SLUG');
    } else if (a === '--list' || a === '-l') {
      f.list = true;
    } else if (a === '--dry-run' || a === '-n') {
      f.dryRun = true;
    } else if (a === '--force' || a === '-f') {
      f.force = true;
    } else if (a === '--help' || a === '-h') {
      printUsage();
      process.exit(0);
    } else {
      die('unknown argument: ' + a);
    }
  }
  return f;
}

function printUsage() {
  process.stdout.write([
    'Usage: node scripts/build-redirects.js [options]',
    '',
    '  (no args)              build all redirects from redirects.json',
    '  --add SLUG URL [TITLE] append entry to manifest, then build',
    '  --remove SLUG          remove entry and delete its generated file',
    '  --list, -l             print all redirects',
    '  --dry-run, -n          show planned changes without writing',
    '  --force, -f            overwrite files that lack the generated marker',
    '  --help, -h             this message',
    ''
  ].join('\n'));
}

function escAttr(s) {
  return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
}
function escText(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function validateSlug(slug) {
  if (typeof slug !== 'string' || !slug) die('slug required');
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(slug)) {
    die('slug must be lowercase alphanumeric with internal dashes: "' + slug + '"');
  }
  if (PROTECTED.indexOf(slug) !== -1) {
    die('slug "' + slug + '" is reserved');
  }
}

function validateUrl(url) {
  if (typeof url !== 'string' || !url) die('url required');
  var u;
  try { u = new URL(url); } catch (e) { die('invalid url: ' + url); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') {
    die('url must be http or https: ' + url);
  }
}

function loadManifest() {
  if (!fs.existsSync(MANIFEST)) return [];
  var raw;
  try { raw = fs.readFileSync(MANIFEST, 'utf8'); }
  catch (e) { die('cannot read redirects.json: ' + e.message); }
  try { return JSON.parse(raw); }
  catch (e) { die('cannot parse redirects.json: ' + e.message); }
}

function saveManifest(list) {
  var sorted = list.slice().sort(function(a, b) { return a.slug.localeCompare(b.slug); });
  fs.writeFileSync(MANIFEST, JSON.stringify(sorted, null, 2) + '\n');
}

function validateManifest(list) {
  if (!Array.isArray(list)) die('redirects.json must be an array');
  var seen = {};
  list.forEach(function(e, i) {
    if (!e || typeof e !== 'object') die('entry ' + i + ' is not an object');
    validateSlug(e.slug);
    validateUrl(e.url);
    if (seen[e.slug]) die('duplicate slug: ' + e.slug);
    seen[e.slug] = true;
  });
}

function render(entry) {
  var url = entry.url;
  var title = entry.title || entry.slug;
  var urlAttr = escAttr(url);
  return [
    '<!doctype html>',
    '<html lang="en">',
    '<head>',
    MARKER,
    '<meta charset="utf-8">',
    '<title>' + escText(title) + '</title>',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    '<meta name="robots" content="noindex">',
    '<link rel="canonical" href="' + urlAttr + '">',
    '<script>location.replace(' + JSON.stringify(url) + ')</script>',
    '<meta http-equiv="refresh" content="0; url=' + urlAttr + '">',
    '<style>body{font:16px/1.5 -apple-system,system-ui,sans-serif;margin:0;padding:24px;color:#222;background:#fff}a{color:#06c}@media(prefers-color-scheme:dark){body{color:#eee;background:#000}a{color:#6af}}</style>',
    '</head>',
    '<body>',
    '<noscript>Redirecting to <a href="' + urlAttr + '">' + escText(url) + '</a>.</noscript>',
    '</body>',
    '</html>',
    ''
  ].join('\n');
}

function isSafeToOverwrite(indexPath) {
  if (!fs.existsSync(indexPath)) return true;
  return fs.readFileSync(indexPath, 'utf8').indexOf(MARKER) !== -1;
}

function buildOne(entry, flags) {
  var dir = path.join(ROOT, entry.slug);
  var indexPath = path.join(dir, 'index.html');
  if (!isSafeToOverwrite(indexPath) && !flags.force) {
    die('refusing to overwrite non-generated file: ' + path.relative(ROOT, indexPath) + ' (use --force)');
  }
  var html = render(entry);
  var existing = fs.existsSync(indexPath) ? fs.readFileSync(indexPath, 'utf8') : null;
  if (existing === html) return 'unchanged';
  if (flags.dryRun) return existing ? 'would-update' : 'would-create';
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(indexPath, html);
  return existing ? 'updated' : 'created';
}

function removeOne(slug, flags) {
  var dir = path.join(ROOT, slug);
  var indexPath = path.join(dir, 'index.html');
  if (!fs.existsSync(indexPath)) return 'missing';
  if (!isSafeToOverwrite(indexPath) && !flags.force) {
    die('refusing to delete non-generated file: ' + path.relative(ROOT, indexPath) + ' (use --force)');
  }
  if (flags.dryRun) return 'would-delete';
  fs.unlinkSync(indexPath);
  // Remove dir only if empty
  try {
    var remaining = fs.readdirSync(dir);
    if (remaining.length === 0) fs.rmdirSync(dir);
  } catch (e) { /* ignore */ }
  return 'deleted';
}

// Main
var flags = parseArgs(process.argv.slice(2));
var manifest = loadManifest();

if (flags.list) {
  validateManifest(manifest);
  if (manifest.length === 0) {
    console.log('(no redirects)');
  } else {
    manifest.forEach(function(e) {
      console.log('/' + e.slug + '/  ->  ' + e.url + (e.title ? '  [' + e.title + ']' : ''));
    });
  }
  process.exit(0);
}

if (flags.remove) {
  validateSlug(flags.remove);
  var idx = manifest.findIndex(function(e) { return e.slug === flags.remove; });
  if (idx === -1) die('slug not in manifest: ' + flags.remove);
  manifest.splice(idx, 1);
  if (!flags.dryRun) saveManifest(manifest);
  var r = removeOne(flags.remove, flags);
  console.log(r + ': ' + flags.remove + '/');
}

if (flags.add) {
  validateSlug(flags.add.slug);
  validateUrl(flags.add.url);
  var existingIdx = manifest.findIndex(function(e) { return e.slug === flags.add.slug; });
  var entry = {
    slug: flags.add.slug,
    url: flags.add.url,
    title: flags.add.title || flags.add.slug
  };
  if (existingIdx !== -1) manifest[existingIdx] = entry;
  else manifest.push(entry);
  if (!flags.dryRun) saveManifest(manifest);
}

validateManifest(manifest);

var counts = { created: 0, updated: 0, unchanged: 0, 'would-create': 0, 'would-update': 0 };
manifest.forEach(function(e) {
  var r = buildOne(e, flags);
  counts[r] = (counts[r] || 0) + 1;
  if (r !== 'unchanged') console.log(r + ': ' + e.slug + '/ -> ' + e.url);
});

var summary = [];
Object.keys(counts).forEach(function(k) {
  if (counts[k]) summary.push(k + '=' + counts[k]);
});
console.log('redirects: ' + manifest.length + ' total' + (summary.length ? ' (' + summary.join(', ') + ')' : ''));
