#!/usr/bin/env node
'use strict';
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const VERSION='1.7.0';
const ROOT=path.resolve(__dirname,'..');
const OUT_ICONS=path.join(ROOT,'iconic','icons');
const OUT_MANIFEST=path.join(ROOT,'iconic','manifest.json');
const TMP=process.env.TMPDIR||'/tmp';
const ZIP=path.join(TMP,'lucide-'+VERSION+'.zip');
const EXTRACT=path.join(TMP,'lucide-extract-'+Date.now());

// Download
console.log('Downloading Lucide '+VERSION+'...');
execFileSync('curl',['-sL','https://github.com/lucide-icons/lucide/archive/refs/tags/'+VERSION+'.zip','-o',ZIP]);

// Extract
console.log('Extracting...');
fs.mkdirSync(EXTRACT,{recursive:true});
execFileSync('unzip',['-qo',ZIP,'-d',EXTRACT]);

// Find icons directory (lucide-X.Y.Z/icons/)
var dirs=fs.readdirSync(EXTRACT);
var repoDir=dirs.find(function(d){return d.startsWith('lucide')});
if(!repoDir){console.error('Could not find lucide directory in zip');process.exit(1)}
var iconsDir=path.join(EXTRACT,repoDir,'icons');
if(!fs.existsSync(iconsDir)){console.error('No icons/ directory found');process.exit(1)}

// Ensure output directory exists and is clean
if(fs.existsSync(OUT_ICONS)){
  fs.readdirSync(OUT_ICONS).filter(function(f){return f.endsWith('.svg')}).forEach(function(f){
    fs.unlinkSync(path.join(OUT_ICONS,f));
  });
}
fs.mkdirSync(OUT_ICONS,{recursive:true});

// Process icons
var entries=fs.readdirSync(iconsDir).filter(function(f){return f.endsWith('.svg')});
console.log('Processing '+entries.length+' icons...');

var manifest=[];
var copied=0;

for(var i=0;i<entries.length;i++){
  var file=entries[i];
  var name=file.replace('.svg','');
  var svgPath=path.join(iconsDir,file);
  var metaPath=path.join(iconsDir,name+'.json');

  // Read SVG
  var svg=fs.readFileSync(svgPath,'utf8');

  // Extract inner content (between <svg ...> and </svg>)
  var innerMatch=svg.match(/<svg[^>]*>([\s\S]*?)<\/svg>/);
  if(!innerMatch){console.warn('Skipping '+name+': no svg content');continue}
  var inner=innerMatch[1].trim().replace(/\n\s*/g,'');

  // Copy raw SVG file
  fs.copyFileSync(svgPath,path.join(OUT_ICONS,file));
  copied++;

  // Read metadata (tags, categories)
  var tags=[],categories=[];
  if(fs.existsSync(metaPath)){
    try{
      var meta=JSON.parse(fs.readFileSync(metaPath,'utf8'));
      if(Array.isArray(meta.tags))tags=meta.tags;
      if(Array.isArray(meta.categories))categories=meta.categories;
    }catch(e){/* skip bad metadata */}
  }

  // Build pre-computed search text: kebab-name + space-separated words + tags + categories
  var nameWords=name.replace(/-/g,' ');
  var parts=[name,nameWords].concat(tags).concat(categories);
  var searchText=parts.join(' ').toLowerCase();

  // Display tags (bullet-separated)
  var displayTags=tags.join(' \u2022 ');

  // [name, searchText, displayTags] — SVG content lives in individual files, loaded lazily
  manifest.push([name,searchText,displayTags]);
}

// Sort alphabetically by name
manifest.sort(function(a,b){return a[0].localeCompare(b[0])});

// Write manifest
fs.writeFileSync(OUT_MANIFEST,JSON.stringify(manifest));
var size=(fs.statSync(OUT_MANIFEST).size/1024).toFixed(0);

console.log('Done: '+copied+' SVGs copied, '+manifest.length+' manifest entries ('+size+'KB)');

// Cleanup
execFileSync('rm',['-rf',EXTRACT,ZIP]);
console.log('Cleaned up temp files.');
