/**
 * Validates each generated static HTML file from build-posts.js.
 * For every post in posts.json, checks that the output at
 * updates/<slug>/index.html has correct structure and metadata.
 * Run: node tests/test-build-posts.js
 */
'use strict';

var fs = require('fs');
var path = require('path');
var h = require('./_helpers');
var assert = h.assert;

var ROOT = path.join(__dirname, '..');
var posts = JSON.parse(fs.readFileSync(path.join(ROOT, 'updates', 'posts.json'), 'utf8'));

posts.forEach(function(post) {
  var slug = post.file.replace(/\.md$/, '');
  var label = slug + ': ';
  var outPath = path.join(ROOT, 'updates', slug, 'index.html');

  // 1. File exists
  var exists = fs.existsSync(outPath);
  assert(label + 'file exists', exists, true);
  if (!exists) {
    // Skip remaining checks — file is absent
    console.error('  (skipping remaining checks for ' + slug + ')');
    return;
  }

  var html = fs.readFileSync(outPath, 'utf8');

  // 2. Correct <title>
  assert(label + 'title tag', html.includes('<title>DS | ' + post.title + '</title>'), true);

  // 3. OG tags
  assert(label + 'og:title present', html.includes('property="og:title"'), true);
  assert(label + 'og:description present', html.includes('property="og:description"'), true);
  assert(label + 'og:url present', html.includes('property="og:url"'), true);
  assert(label + 'og:type = article', html.includes('property="og:type" content="article"'), true);

  // 4. Canonical URL
  var canonical = 'https://saputra.co.uk/updates/' + slug;
  assert(label + 'rel=canonical', html.includes('rel="canonical" href="' + canonical + '"'), true);

  // 5. JSON-LD with Article type
  assert(label + 'ld+json script', html.includes('type="application/ld+json"'), true);
  assert(label + 'ld+json Article type', html.includes('"@type": "Article"'), true);

  // 6. Nav bar, Home link, Updates active
  assert(label + 'has nav', html.includes('<nav'), true);
  assert(label + 'nav: Home link', html.includes('href="/"'), true);
  // build-posts.js uses class="active" for the current section (not aria-current)
  assert(label + 'nav: Updates active', html.includes('href="/updates" class="active"'), true);

  // 7. Rendered content (.pcontent not empty)
  var pcontentMatch = html.match(/<div class="pcontent">([\s\S]*?)<\/div>/);
  assert(label + 'has .pcontent', !!pcontentMatch, true);
  if (pcontentMatch) {
    assert(label + '.pcontent non-empty', pcontentMatch[1].trim().length > 0, true);
  }

  // 8. base.css and style.css references
  assert(label + 'has base.css', html.includes('/shared/base.css'), true);
  assert(label + 'has style.css', html.includes('/style.css'), true);

  // 9. base.js reference
  assert(label + 'has base.js', html.includes('/shared/base.js'), true);

  // 10. Does NOT contain app.js, swr.js, or search.js
  assert(label + 'no app.js', !html.includes('app.js'), true);
  assert(label + 'no swr.js', !html.includes('swr.js'), true);
  assert(label + 'no search.js', !html.includes('search.js'), true);

  // 11. FOUC prevention script
  assert(label + 'FOUC theme script', html.includes("localStorage.getItem('theme')"), true);

  // 12. Non-empty meta description
  var descMatch = html.match(/<meta name="description" content="([^"]+)"/);
  assert(label + 'meta description exists', !!descMatch, true);
  if (descMatch) {
    assert(label + 'meta description non-empty', descMatch[1].trim().length > 0, true);
  }
});

// 13. CV post: specific structure checks
var cvSlug = '2026-04-07-curriculum-vitae';
var cvPost = posts.find(function(p) { return p.file === cvSlug + '.md'; });
if (cvPost) {
  var cvPath = path.join(ROOT, 'updates', cvSlug, 'index.html');
  if (fs.existsSync(cvPath)) {
    var cvHtml = fs.readFileSync(cvPath, 'utf8');
    var label = cvSlug + ': ';

    // Has .link-sec section headings
    assert(label + 'has .link-sec divs', cvHtml.includes('class="link-sec"'), true);
    var linkSecCount = (cvHtml.match(/class="link-sec"/g) || []).length;
    assert(label + 'multiple .link-sec (' + linkSecCount + ')', linkSecCount >= 2, true);

    // Has Education text
    assert(label + 'contains Education', cvHtml.includes('Education'), true);

    // Has multiple .pcontent divs
    var pcontentCount = (cvHtml.match(/class="pcontent"/g) || []).length;
    assert(label + 'multiple .pcontent (' + pcontentCount + ')', pcontentCount >= 2, true);
  }
}

process.exit(h.summary());
