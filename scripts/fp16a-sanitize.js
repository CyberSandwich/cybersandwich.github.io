#!/usr/bin/env node
/**
 * Turns a Warwick FP16a or Foreign Payments template into the sidecar /fp16a/ serves.
 * Usage: node scripts/fp16a-sanitize.js <src.xlsx> <out.xlsx>
 * Idempotent; prints the parts it changed and the output sha256. Refresh steps: context/fp16a.md.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Uses the page's own zip + sheet modules so the sidecar is written by the engine that reads it.
const html = fs.readFileSync(path.join(__dirname, '..', 'fp16a', 'index.html'), 'utf8');
const slice = name => {
  const m = html.match(new RegExp(`/\\* -- fp16a:${name} -- \\*/([\\s\\S]*?)/\\* -- end fp16a:${name} -- \\*/`));
  if (!m) throw new Error('marker not found: fp16a:' + name);
  return m[1];
};
const { zip, sheet } = new Function(`${slice('zip')}\n${slice('sheet')}\nreturn {zip, sheet};`)();

const must = (x, re, what) => { if (!re.test(x)) throw new Error('sanitize target moved: ' + what); return x; };
const COMMON = {
  'xl/workbook.xml': x => x.replace(/<mc:AlternateContent\b[^>]*>(?:(?!<\/mc:AlternateContent>)[\s\S])*?x15ac:absPath[\s\S]*?<\/mc:AlternateContent>/, ''),
  'docProps/core.xml': x => must(x, /<cp:lastModifiedBy>[^<]*<\/cp:lastModifiedBy>/, 'lastModifiedBy').replace(/(<cp:lastModifiedBy>)[^<]*/, '$1'),
  '[Content_Types].xml': x => x.replace(/<Override PartName="\/xl\/calcChain\.xml"[^>]*\/>/, ''),
  'xl/_rels/workbook.xml.rels': x => x.replace(/<Relationship\s[^>]*Target="calcChain\.xml"[^>]*\/>/, '')
};
const KIND = {
  fp16a: {
    'xl/workbook.xml': x => must(x, /<calcPr\b/, 'calcPr').replace(/<calcPr\b(?![^>]*fullCalcOnLoad)([^>]*?)\/>/, '<calcPr$1 fullCalcOnLoad="1"/>'),
    'xl/worksheets/sheet1.xml': x => must(x, /<selection activeCell="[A-Z]+\d+" sqref="[A-Z]+\d+"\/>/, 'selection').replace(/<selection activeCell="[A-Z]+\d+" sqref="[A-Z]+\d+"\/>/, '<selection activeCell="A1" sqref="A1"/>')
  },
  foreign: {
    // NOW() is volatile: it would stamp every export with the open time instead of the typed date.
    'xl/worksheets/sheet1.xml': x => must(x, /<c r="I26" s="51"(?:\/>|>)/, 'I26').replace(/<c r="I26" s="51">[\s\S]*?<\/c>/, '<c r="I26" s="51"/>'),
    // The template's long weekday format overflows the 152px date cell to ####.
    'xl/styles.xml': x => must(x, /<numFmt numFmtId="164" formatCode="[^"]*"\/>/, 'numFmt 164').replace(/<numFmt numFmtId="164" formatCode="[^"]*"\/>/, '<numFmt numFmtId="164" formatCode="dd\\ mmmm\\ yyyy"/>')
  }
};

(async () => {
  const [src, out] = process.argv.slice(2);
  if (!src || !out) { console.error('usage: node scripts/fp16a-sanitize.js <src.xlsx> <out.xlsx>'); process.exit(2); }
  const u8 = new Uint8Array(fs.readFileSync(src));
  const { kind } = await sheet.open(u8);
  const z = zip.readZip(u8), changes = {}, fixes = {};
  for (const set of [COMMON, KIND[kind]]) for (const [name, fn] of Object.entries(set)) (fixes[name] ||= []).push(fn);
  for (const [name, fns] of Object.entries(fixes)) {
    const before = await zip.readText(z, name), after = fns.reduce((x, fn) => fn(x), before);
    if (after !== before) changes[name] = after;
  }
  if (z.entries.some(e => e.name === 'xl/calcChain.xml')) changes['xl/calcChain.xml'] = null;
  const parts = {};
  for (const n of ['xl/workbook.xml', 'xl/worksheets/sheet1.xml', 'xl/drawings/drawing1.xml', 'xl/sharedStrings.xml']) parts[n] = n in changes ? changes[n] : await zip.readText(z, n);
  sheet.verifyTemplate(kind, parts);
  const res = await zip.rewriteZip(z, changes);
  fs.writeFileSync(out, res);
  console.log(kind + ': ' + (Object.keys(changes).join(', ') || 'no content changes'));
  console.log(crypto.createHash('sha256').update(res).digest('hex') + '  ' + out);
})().catch(e => { console.error(e.message || e); process.exit(1); });
