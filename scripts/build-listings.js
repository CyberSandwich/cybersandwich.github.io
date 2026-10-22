#!/usr/bin/env node
'use strict';

/**
 * build-listings.js: static /projects/ and /links/ pages from their JSON, so
 * both are real 200 pages for crawlers instead of the SPA's 404.html fallback.
 *
 * Cards come from lib/static-page.js and match showProjects / showLinks in
 * app.js. Rerun after editing projects.json, links.json, the icon maps or
 * categories in app.js; bump-shared.sh runs it after every version bump, and
 * listings.yml runs it in CI.
 *
 * Idempotent: only writes when content has changed.
 */

var fs = require('fs');
var path = require('path');
var S = require('./lib/static-page.js');

var app = S.app;

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(S.ROOT, rel), 'utf8'));
}

// One listing page; graph names every card's destination so the page reads as a collection
function listingPage(name, desc, active, listId, items, cfg, cats) {
  var canonical = S.SITE + active;
  return S.pageShell({
    title: name,
    desc: desc,
    canonical: canonical,
    ogType: 'website',
    graph: [{
      '@type': 'CollectionPage',
      'name': name,
      'description': desc,
      'url': canonical,
      'inLanguage': S.LANG
    }, S.breadcrumbs([{ name: name, item: canonical }])],
    active: active,
    listId: listId,
    body: S.cardsHtml(S.catGroups(cats, items), cfg)
  });
}

// Mirrors showProjects in app.js
function generateProjects(items) {
  return listingPage('Projects', 'Tools and projects built by Duke Saputra.', '/projects', 'plist', items, {
    href: function(x) { return x.url === '#' ? app.mailtoUrl(x.title) : x.url; },
    external: function(x) { return x.url !== '#' && !x.url.startsWith('/'); },
    title: function(x) { return x.title; },
    sub: function(x) { return x.subtitle; },
    icon: function(x) { return app.PROJECT_ICONS[x.title] || app.DEFAULT_PROJECT_ICON; }
  }, app.projectCategories);
}

// Mirrors showLinks in app.js
function generateLinks(items) {
  return listingPage('Links', 'Links Duke Saputra uses and recommends.', '/links', 'llist', items, {
    href: function(x) { return x.url; },
    external: function() { return true; },
    title: function(x) { return x.title; },
    sub: function(x) { return app.cleanUrl(x.url); },
    icon: function(x) { return app.ICONS[x.icon] || app.DEFAULT_LINK_ICON; }
  }, app.linkCategories);
}

module.exports = { generateProjects: generateProjects, generateLinks: generateLinks };
if (require.main !== module) return;

var stats = { built: 0, unchanged: 0 };
S.writePage('projects', generateProjects(readJson('projects/projects.json')), stats);
S.writePage('links', generateLinks(readJson('links/links.json')), stats);
console.log('\n' + stats.built + ' built, ' + stats.unchanged + ' unchanged');
