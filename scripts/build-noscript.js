#!/usr/bin/env node
'use strict';

/**
 * build-noscript.js — Inject <noscript> listings into index.html for SEO
 *
 * Crawlers that don't execute JS see empty divs. This script reads
 * projects.json and posts.json, injecting semantic HTML inside <noscript>
 * blocks so non-JS crawlers can index content.
 *
 * Idempotent: uses marker comments, only writes when content changes.
 * Run after editing projects.json or posts.json.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PROJECTS_JSON = path.join(ROOT, 'projects', 'projects.json');
var POSTS_JSON = path.join(ROOT, 'posts', 'posts.json');
var INDEX_HTML = path.join(ROOT, 'index.html');

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Inject or replace a noscript block between marker comments.
 * On first run, inserts after the given anchor element.
 */
function inject(src, startMark, endMark, anchor, html) {
  var sIdx = src.indexOf(startMark);
  var eIdx = src.indexOf(endMark);

  if (sIdx !== -1 && eIdx !== -1) {
    return src.slice(0, sIdx) + html + src.slice(eIdx + endMark.length);
  }

  var pos = src.indexOf(anchor);
  if (pos === -1) {
    console.error('ERROR: Cannot find ' + anchor + ' in index.html');
    process.exit(1);
  }
  return src.slice(0, pos + anchor.length) + '\n  ' + html + '\n' + src.slice(pos + anchor.length);
}

// ---------------------------------------------------------------------------
// 1. Build projects noscript
// ---------------------------------------------------------------------------

var P_START = '<!-- noscript:projects:start -->';
var P_END   = '<!-- noscript:projects:end -->';

var projects = JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf8'));
var categories = [];
var grouped = {};

projects.forEach(function(p) {
  if (p.url === '#') return;
  var cat = p.category || 'Miscellaneous';
  if (!grouped[cat]) { grouped[cat] = []; categories.push(cat); }
  grouped[cat].push(p);
});

var pLines = [P_START, '  <noscript>'];
categories.forEach(function(cat) {
  pLines.push('  <h3>' + escHtml(cat) + '</h3>');
  pLines.push('  <ul>');
  grouped[cat].forEach(function(p) {
    pLines.push('    <li><a href="' + escHtml(p.url) + '">' + escHtml(p.title) + '</a> \u2014 ' + escHtml(p.subtitle) + '</li>');
  });
  pLines.push('  </ul>');
});
pLines.push('  </noscript>');
pLines.push(P_END);

// ---------------------------------------------------------------------------
// 2. Build updates noscript
// ---------------------------------------------------------------------------

var U_START = '<!-- noscript:posts:start -->';
var U_END   = '<!-- noscript:posts:end -->';

var posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));

var uLines = [U_START, '  <noscript>'];
uLines.push('  <ul>');
posts.forEach(function(p) {
  var slug = p.slug || p.file.replace(/\.md$/, '');
  uLines.push('    <li><a href="/posts/' + escHtml(slug) + '">' + escHtml(p.title) + '</a> \u2014 ' + escHtml(p.date) + '</li>');
});
uLines.push('  </ul>');
uLines.push('  </noscript>');
uLines.push(U_END);

// ---------------------------------------------------------------------------
// 3. Inject both blocks
// ---------------------------------------------------------------------------

var src = fs.readFileSync(INDEX_HTML, 'utf8');

var updated = inject(src, P_START, P_END, '<div id="plist"></div>', pLines.join('\n'));
updated = inject(updated, U_START, U_END, '<div id="ulist"></div>', uLines.join('\n'));

if (updated === src) {
  console.log('noscript: unchanged');
} else {
  fs.writeFileSync(INDEX_HTML, updated);
  console.log('noscript: updated');
}
