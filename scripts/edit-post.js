#!/usr/bin/env node
'use strict';

/**
 * edit-post.js — Safe editor for posts.json with validation
 *
 * Usage:
 *   node scripts/edit-post.js list                          List all posts
 *   node scripts/edit-post.js set <slug> icon <name>        Set icon
 *   node scripts/edit-post.js set <slug> featured true      Mark as featured
 *   node scripts/edit-post.js set <slug> featured false     Unmark featured
 *   node scripts/edit-post.js set <slug> slug <new-slug>    Change slug
 *   node scripts/edit-post.js unset <slug> <field>          Remove a field
 *   node scripts/edit-post.js validate                      Validate all entries
 */

var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var POSTS_JSON = path.join(ROOT, 'posts', 'posts.json');
var APP_JS = path.join(ROOT, 'app.js');

// ---------------------------------------------------------------------------
// Load data
// ---------------------------------------------------------------------------

var posts = JSON.parse(fs.readFileSync(POSTS_JSON, 'utf8'));

// Extract valid icon names from ICONS map in app.js
function getValidIcons() {
  var src = fs.readFileSync(APP_JS, 'utf8');
  var match = src.match(/const ICONS=\{([\s\S]*?)\n\}/);
  if (!match) return [];
  var keys = [];
  var re = /'([a-z][\w-]*)'/g;
  var m;
  while ((m = re.exec(match[1])) !== null) keys.push(m[1]);
  return keys;
}

var VALID_ICONS = getValidIcons();

// Generated fields that shouldn't be manually edited via this script
var GENERATED = ['date', 'title', 'file', 'words'];
// Allowed custom fields
var CUSTOM_FIELDS = ['icon', 'slug', 'featured'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function findPost(slug) {
  return posts.find(function(p) {
    return (p.slug || p.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '')) === slug;
  });
}

function save() {
  fs.writeFileSync(POSTS_JSON, JSON.stringify(posts, null, 2) + '\n');
}

function die(msg) {
  console.error('ERROR: ' + msg);
  process.exit(1);
}

function ok(msg) { console.log('OK: ' + msg); }
function warn(msg) { console.log('WARN: ' + msg); }

// ---------------------------------------------------------------------------
// Commands
// ---------------------------------------------------------------------------

function cmdList() {
  if (!posts.length) { console.log('No posts.'); return; }
  var maxTitle = Math.max.apply(null, posts.map(function(p) { return p.title.length; }));
  posts.forEach(function(p) {
    var slug = p.slug || p.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    var flags = [];
    if (p.featured) flags.push('featured');
    if (p.icon) flags.push('icon:' + p.icon);
    var pad = p.title + Array(maxTitle - p.title.length + 1).join(' ');
    console.log('  ' + p.date + '  ' + pad + '  /' + slug + (flags.length ? '  [' + flags.join(', ') + ']' : ''));
  });
}

function cmdSet(slug, field, value) {
  var post = findPost(slug);
  if (!post) die('Post not found: "' + slug + '". Run "list" to see available posts.');
  if (GENERATED.indexOf(field) !== -1) die('"' + field + '" is auto-generated. Edit the .md file instead.');
  if (CUSTOM_FIELDS.indexOf(field) === -1) die('Unknown field: "' + field + '". Allowed: ' + CUSTOM_FIELDS.join(', '));

  // Validate values
  if (field === 'icon') {
    if (VALID_ICONS.indexOf(value) === -1) {
      console.log('\nAvailable icons (' + VALID_ICONS.length + '):');
      var cols = 5;
      for (var i = 0; i < VALID_ICONS.length; i += cols) {
        var row = VALID_ICONS.slice(i, i + cols).map(function(v) {
          return v + Array(Math.max(0, 18 - v.length)).join(' ');
        }).join('');
        console.log('  ' + row);
      }
      die('"' + value + '" is not in the ICONS map. See available icons above.');
    }
    post.icon = value;
  } else if (field === 'featured') {
    if (value === 'true') post.featured = true;
    else if (value === 'false') delete post.featured;
    else die('featured must be "true" or "false"');
  } else if (field === 'slug') {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(value)) die('Slug must be lowercase alphanumeric with hyphens');
    var dup = posts.find(function(p) { return p !== post && (p.slug || '') === value; });
    if (dup) die('Slug "' + value + '" already used by "' + dup.title + '"');
    post.slug = value;
  }

  save();
  ok(field + ' = ' + (field === 'featured' ? value : '"' + value + '"') + ' on "' + post.title + '"');
}

function cmdUnset(slug, field) {
  var post = findPost(slug);
  if (!post) die('Post not found: "' + slug + '"');
  if (GENERATED.indexOf(field) !== -1) die('Cannot unset generated field: "' + field + '"');
  if (!post.hasOwnProperty(field)) die('"' + post.title + '" does not have field "' + field + '"');
  delete post[field];
  save();
  ok('Removed "' + field + '" from "' + post.title + '"');
}

function cmdValidate() {
  var errors = 0;
  posts.forEach(function(p) {
    var label = p.file || p.title;

    ['date', 'title', 'file', 'words'].forEach(function(f) {
      if (!p[f] && p[f] !== 0) { warn(label + ': missing required field "' + f + '"'); errors++; }
    });

    if (p.date && !/^\d{4}-\d{2}-\d{2}$/.test(p.date)) {
      warn(label + ': invalid date format "' + p.date + '" (expected YYYY-MM-DD)'); errors++;
    }

    if (p.file) {
      var mdPath = path.join(ROOT, 'posts', p.file);
      if (!fs.existsSync(mdPath)) { warn(label + ': .md file not found'); errors++; }
    }

    if (p.icon && VALID_ICONS.indexOf(p.icon) === -1) {
      warn(label + ': icon "' + p.icon + '" not in ICONS map'); errors++;
    }

    if (p.slug && !/^[a-z0-9][a-z0-9-]*$/.test(p.slug)) {
      warn(label + ': invalid slug format "' + p.slug + '"'); errors++;
    }

    var known = GENERATED.concat(CUSTOM_FIELDS);
    Object.keys(p).forEach(function(k) {
      if (known.indexOf(k) === -1) { warn(label + ': unknown field "' + k + '"'); }
    });
  });

  var slugs = {};
  posts.forEach(function(p) {
    var s = p.slug || p.file.replace(/\.md$/, '').replace(/^\d{4}-\d{2}-\d{2}-/, '');
    if (slugs[s]) { warn('Duplicate slug "' + s + '": ' + slugs[s] + ' and ' + p.file); errors++; }
    slugs[s] = p.file;
  });

  for (var i = 1; i < posts.length; i++) {
    var a = posts[i - 1], b = posts[i];
    if (a.date < b.date) { warn('Sort order: "' + a.title + '" (' + a.date + ') before "' + b.title + '" (' + b.date + ')'); errors++; }
  }

  if (errors === 0) ok('posts.json is valid (' + posts.length + ' post(s))');
  else die(errors + ' issue(s) found');
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

var args = process.argv.slice(2);
var cmd = args[0] || 'help';

switch (cmd) {
  case 'list': case 'ls': cmdList(); break;
  case 'set': cmdSet(args[1], args[2], args[3]); break;
  case 'unset': case 'rm': cmdUnset(args[1], args[2]); break;
  case 'validate': case 'check': cmdValidate(); break;
  default:
    console.log('edit-post.js — Safe posts.json editor\n');
    console.log('Commands:');
    console.log('  list                          List all posts');
    console.log('  set <slug> icon <name>        Set icon (validates against ICONS map)');
    console.log('  set <slug> featured true      Mark as featured');
    console.log('  set <slug> featured false     Unmark featured');
    console.log('  set <slug> slug <new-slug>    Change slug');
    console.log('  unset <slug> <field>          Remove a custom field');
    console.log('  validate                      Validate all entries');
    break;
}
