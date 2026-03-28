/* shared/swr.js — Stale-While-Revalidate fetch utility
 *
 * _swr(url)                         Text/JSON — localStorage cache, SWR revalidation
 * _swr(url, {binary:true})          Binary — Cache API + memory cache, SWR revalidation
 * _swr(url, {parse:fn, onFresh:fn}) Custom parse + fresh-data callback
 * _swr.loader(url, cb)              Reusable loader: dedup, retry cap, .err, .onFresh
 */
(function(){'use strict';

var mem={};
var BIN_CACHE='swr-assets-v1';

/* ── Text SWR (localStorage) ─────────────────────────────────────── */

function swrText(url,parse,key,onFresh){
  var raw,cached;
  try{raw=localStorage.getItem(key);if(raw!=null)cached=parse(raw)}catch(e){raw=null}
  var fresh=fetch(url,{cache:'no-cache'})
    .then(function(r){if(!r.ok)throw new Error(url+' HTTP '+r.status);return r.text()})
    .then(function(text){
      if(text===raw)return cached;
      try{localStorage.setItem(key,text)}catch(e){}
      var d=parse(text);
      if(cached!=null&&onFresh)onFresh(d);
      return d
    });
  if(cached!=null){fresh.catch(function(){});return Promise.resolve(cached)}
  return fresh
}

/* ── Binary SWR (Cache API + memory) ──────────────────────────────── */

function swrBinary(url){
  if(mem[url])return Promise.resolve(mem[url]);
  return caches.open(BIN_CACHE).then(function(c){
    return c.match(url).then(function(r){
      if(r){
        fetch(url).then(function(r2){if(r2.ok)c.put(url,r2)}).catch(function(){});
        return r.arrayBuffer().then(function(b){mem[url]=b;return b})
      }
      return fetch(url).then(function(r2){
        if(!r2.ok)throw new Error(url+' HTTP '+r2.status);
        c.put(url,r2.clone());
        return r2.arrayBuffer().then(function(b){mem[url]=b;return b})
      })
    })
  })
}

/* ── Main entry ───────────────────────────────────────────────────── */

function swr(url,opts){
  opts=opts||{};
  if(opts.binary)return swrBinary(url);
  return swrText(url,opts.parse||JSON.parse,opts.key||'swr_'+url,opts.onFresh||null)
}

/* ── Loader factory (dedup + retry cap) ───────────────────────────── */

swr.loader=function(url,cb,opts){
  opts=opts||{};
  var p=null,fails=0;
  var loader=function(){
    if(p)return p;
    if(fails>=3)return Promise.resolve([]);
    p=swr(url,{
      parse:opts.parse,
      key:opts.key,
      onFresh:function(d){cb(d);if(loader.onFresh)loader.onFresh(d)}
    }).then(function(d){
      fails=0;loader.err=false;
      cb(d);
      return d
    }).catch(function(e){
      p=null;fails++;
      console.error('Load failed:',e);
      loader.err=true;
      return[]
    });
    return p
  };
  loader.err=false;
  loader.onFresh=null;
  return loader
};

window._swr=swr
})()