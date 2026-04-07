#!/usr/bin/env node
'use strict';

/**
 * build-noscript.js — Inject <noscript> project listings into index.html for SEO
 *
 * Crawlers that don't execute JS (AI crawlers, social previews, lite-mode
 * search bots) see empty <div id="plist"></div>. This script reads
 * projects.json and injects semantic HTML inside a <noscript> block so
 * those crawlers can index project names, descriptions, and links.
 *
 * Idempotent: uses marker comments, only writes when content changes.
 * Run after editing projects.json.
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var PROJECTS_JSON = path.join(ROOT, 'projects', 'projects.json');
var INDEX_HTML = path.join(ROOT, 'index.html');

var P_START = '<!-- noscript:projects:start -->';
var P_END   = '<!-- noscript:projects:end -->';

// ---------------------------------------------------------------------------
// 1. Read projects and group by category
// ---------------------------------------------------------------------------

var projects = JSON.parse(fs.readFileSync(PROJECTS_JSON, 'utf8'));

var categories = [];
var grouped = {};

projects.forEach(function(p) {
  if (p.url === '#') return; // skip stealth-mode projects
  var cat = p.category || 'Miscellaneous';
  if (!grouped[cat]) {
    grouped[cat] = [];
    categories.push(cat);
  }
  grouped[cat].push(p);
});

// ---------------------------------------------------------------------------
// 2. Build noscript HTML
// ---------------------------------------------------------------------------

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

var lines = [P_START, '  <noscript>'];

categories.forEach(function(cat) {
  lines.push('  <h3>' + escHtml(cat) + '</h3>');
  lines.push('  <ul>');
  grouped[cat].forEach(function(p) {
    lines.push('    <li><a href="' + escHtml(p.url) + '">' + escHtml(p.title) + '</a> \u2014 ' + escHtml(p.subtitle) + '</li>');
  });
  lines.push('  </ul>');
});

lines.push('  </noscript>');
lines.push(P_END);

var block = lines.join('\n');

// ---------------------------------------------------------------------------
// 3. Inject / replace in index.html
// ---------------------------------------------------------------------------

var src = fs.readFileSync(INDEX_HTML, 'utf8');

var sIdx = src.indexOf(P_START);
var eIdx = src.indexOf(P_END);

if (sIdx !== -1 && eIdx !== -1) {
  // Replace existing block
  var before = src.slice(0, sIdx);
  var after  = src.slice(eIdx + P_END.length);
  var updated = before + block + after;

  if (updated === src) {
    console.log('noscript:projects unchanged');
    process.exit(0);
  }
  fs.writeFileSync(INDEX_HTML, updated);
  console.log('noscript:projects updated');
} else {
  // First run — insert after <div id="plist"></div>
  var marker = '<div id="plist"></div>';
  var pos = src.indexOf(marker);
  if (pos === -1) {
    console.error('ERROR: Cannot find <div id="plist"></div> in index.html');
    process.exit(1);
  }
  var insertAt = pos + marker.length;
  var updated = src.slice(0, insertAt) + '\n  ' + block + '\n' + src.slice(insertAt);
  fs.writeFileSync(INDEX_HTML, updated);
  console.log('noscript:projects injected');
}
