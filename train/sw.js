/* train/sw.js — scoped to /train/ only.
   Versions below mirror the ?v= query strings in train/index.html as of last
   bump. When shared/* files are re-bumped, update SHELL entries (and CACHE) so
   precache stays warm. The fetch handler is version-agnostic; it caches any
   /train/ or /shared/ GET it sees. */
'use strict';
const CACHE='train-v1';
const SHELL=[
  '/train/',
  '/train/index.html',
  '/train/stations.json',
  '/shared/base.css?v=27',
  '/shared/base.js?v=25',
  '/shared/swr.js?v=2',
  '/shared/search.js?v=20',
  '/shared/dateparser.js?v=9',
  '/favicon.png'
];
const HUXLEY='huxley2.azurewebsites.net';

self.addEventListener('install',e=>{
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c=>Promise.all(
    SHELL.map(u=>c.add(u).catch(()=>{}))
  )));
});

self.addEventListener('activate',e=>{
  e.waitUntil(
    caches.keys()
      .then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k))))
      .then(()=>self.clients.claim())
  );
});

self.addEventListener('fetch',e=>{
  const req=e.request;
  if(req.method!=='GET')return;
  let url;
  try{url=new URL(req.url)}catch(_){return}
  if(url.hostname===HUXLEY)return; /* live data — network only */
  const sameOrigin=url.origin===self.location.origin;
  if(!sameOrigin)return;
  const inScope=url.pathname.startsWith('/train/')||url.pathname.startsWith('/shared/')||url.pathname==='/favicon.png';
  if(!inScope)return;
  e.respondWith(
    caches.open(CACHE).then(cache=>cache.match(req).then(cached=>{
      const network=fetch(req).then(res=>{
        if(res&&res.ok&&res.type!=='opaque')cache.put(req,res.clone()).catch(()=>{});
        return res;
      });
      if(cached){network.catch(()=>{});return cached}
      return network;
    }))
  );
});
