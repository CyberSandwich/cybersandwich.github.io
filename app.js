(function(){'use strict';

const $=function(s){return document.querySelector(s)};
const $$=function(s){return document.querySelectorAll(s)};

// State
let posts=null;
let projects=null;
let links=null;
let cv=null;
let postCache={};
let postVer=0;
const validPages=['home','projects','cv','updates','links'];
const titles={home:'Home',projects:'Projects',cv:'CV',updates:'Updates',links:'Links'};
const emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');
const CHECK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
const SVG_WRAP_OPEN='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SVG_WRAP_CLOSE='</svg>';
const RE_UL=/^[-*] /;
const RE_OL=/^\d+\. /;
function cleanUrl(u){return u.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'')}
function mailtoUrl(t){return 'mailto:ventures@saputra.co.uk?cc=duke%40saputra.co.uk&subject='+encodeURIComponent('Inquiry: '+t)+'&body='+emailBody}

// Handle 404.html redirect (validate path is relative to prevent cross-origin crash)
const redir=new URLSearchParams(location.search).get('p');
if(redir){try{if(redir.startsWith('/')&&!redir.startsWith('//'))history.replaceState(null,'',redir);else history.replaceState(null,'','/')}catch(e){history.replaceState(null,'','/')}}

// Router
function route(){
  let path=location.pathname;
  if(path!=='/'&&path.endsWith('/'))path=path.slice(0,-1);
  const parts=path.split('/').filter(Boolean);
  let page=parts[0]||'home';
  if(validPages.indexOf(page)===-1){
    history.replaceState(null,'','/');
    page='home';
  }
  const slug=parts.slice(1).join('/');
  document.title='DS | '+(titles[page]||'Home');

  const active=$('.page.active');
  if(!active||active.id!==page){
    $$('.page').forEach(p=>{
      p.classList.toggle('active',p.id===page)
    });
  }
  window.scrollTo(0,0);

  $$('.tabs a').forEach(a=>{
    const href=a.getAttribute('href');
    const isActive=(page==='home'&&href==='/')||(page!=='home'&&href==='/'+page);
    a.classList.toggle('active',isActive);
    if(isActive)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });



  if(page!=='updates'){for(var k in postCache)delete postCache[k]}

  if(page==='projects'){showProjects()}
  if(page==='cv'){showCV()}
  if(page==='links'){showLinks()}
  if(page==='updates'){
    let wrap=$('#usearch');
    if(wrap)wrap=wrap.parentNode;
    if(slug){if(wrap)wrap.style.display='none';showPost(slug)}
    else{if(wrap)wrap.style.display='block';showList()}
  }
}

// Click handler: copy buttons + SPA link interception
// Note: CHECK_SVG innerHTML below uses hardcoded SVG constant, not user content — safe from XSS
document.addEventListener('click',e=>{
  var btn=e.target.closest('.copy-btn');
  if(btn){
    var text=btn.getAttribute('data-copy');
    if(!text)return;
    e.preventDefault();
    function done(){
      clearTimeout(btn._t1);clearTimeout(btn._t2);
      btn.classList.add('copied');
      btn.textContent='';
      var tmp=document.createElement('span');
      tmp.innerHTML=CHECK_SVG;
      btn.appendChild(tmp.firstChild);
      btn._t1=setTimeout(()=>{
        btn.style.opacity='0';
        btn._t2=setTimeout(()=>{
          btn.classList.remove('copied');
          btn.textContent='Copy';
          btn.style.opacity='';
        },200);
      },1500);
    }
    function legacy(){
      var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';
      document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done();
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(()=>{try{legacy()}catch(e){}});
    }else{try{legacy()}catch(e){}}
    return;
  }
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  var a=e.target.closest('a[href]');
  if(!a)return;
  var href=a.getAttribute('href');
  if(!href.startsWith('/')||href.startsWith('//')||a.hasAttribute('download')||a.target==='_blank')return;
  var parts=href.split('/').filter(Boolean);
  var page=parts[0];
  if(!page||validPages.indexOf(page)!==-1){
    e.preventDefault();
    if(href===location.pathname&&(href==='/'||page==='home')){openCmd();return}
    if(href!==location.pathname)history.pushState(null,'',href);
    route();
  }
});

// Data loaders (with retry cap and error logging)
function makeLoader(url,cb){
  let p=null,fails=0;
  return function(){
    if(p)return p;
    if(fails>=3)return Promise.resolve([]);
    p=fetch(url,{cache:'no-cache'})
      .then(r=>{if(!r.ok)throw new Error(url+' HTTP '+r.status);return r.json()})
      .then(d=>{fails=0;return cb(d)})
      .catch(e=>{p=null;fails++;console.error('Load failed:',e);return []});
    return p;
  };
}
const getProjects=makeLoader('/projects/projects.json',d=>{projects=d;return d});
const getLinks=makeLoader('/links/links.json',d=>{links=d;return d});
const getCV=makeLoader('/cv/cv.json',d=>{cv=d;return d});
const getPosts=makeLoader('/updates/posts.json',d=>{
  d.sort((a,b)=>b.date>a.date?1:b.date<a.date?-1:a.title.localeCompare(b.title));
  posts=d;return d;
});

const projectCategories=['Mobile','Web','Extensions','In Development'];
const linkCategories=['Modules','Initiatives','Academic','Career','Community','Personal','Miscellaneous'];

// Chevron SVG for card arrows
const CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

// Project icons — hardcoded SVGs keyed by title, safe for innerHTML
const PROJECT_ICONS={
'menuva':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M18 15v7"/>',
'Clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'AztecGen':'<rect x="2" y="2" width="20" height="20" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1"/><rect x="10" y="10" width="4" height="4" rx=".5"/>',
'Arbit':'<rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
'CodeGen':'<path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M16 7v10"/>',
'JPEG-Opt':'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
'Miele Laundry Guide':'<path d="M12 22a7 7 0 007-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 007 7z"/>',
'UK Number Generator':'<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3l-2 18"/><path d="M16 3l-2 18"/>',
'PNG-Opt':'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
'Wrighter':'<path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/>',
'Project Convergence':'<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
'Project Shifting Tides':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
'Whisp':'<path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><path d="M12 19v3"/>'
};

// Named icons — reusable SVG inner paths for posts and links, wrapped by mkIcon
const ICONS={
'activity':'<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
'alert':'<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
'archive':'<path d="M21 8v13H3V8"/><path d="M1 3h22v5H1z"/><path d="M10 12h4"/>',
'award':'<circle cx="12" cy="8" r="7"/><path d="M8.21 13.89L7 23l5-3 5 3-1.21-9.12"/>',
'book':'<path d="M4 19.5A2.5 2.5 0 016.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 014 19.5v-15A2.5 2.5 0 016.5 2z"/>',
'book-open':'<path d="M2 3h6a4 4 0 014 4v14a3 3 0 00-3-3H2z"/><path d="M22 3h-6a4 4 0 00-4 4v14a3 3 0 013-3h7z"/>',
'calendar':'<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/>',
'camera':'<path d="M14.5 4h-5L7 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2h-3l-2.5-3z"/><circle cx="12" cy="13" r="3"/>',
'cart':'<circle cx="9" cy="21" r="1"/><circle cx="20" cy="21" r="1"/><path d="M1 1h4l2.68 13.39a2 2 0 002 1.61h9.72a2 2 0 002-1.61L23 6H6"/>',
'clipboard':'<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'cloud':'<path d="M18 10h-1.26A8 8 0 109 20h9a5 5 0 000-10z"/>',
'code':'<path d="M16 18l6-6-6-6"/><path d="M8 6l-6 6 6 6"/>',
'doc':'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
'door':'<rect x="3" y="2" width="18" height="20" rx="2"/><circle cx="15" cy="12" r="1"/>',
'download':'<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><path d="M7 10l5 5 5-5"/><path d="M12 15V3"/>',
'eye':'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
'file':'<path d="M15 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V7z"/><path d="M14 2v4a1 1 0 001 1h3"/><path d="M10 13h4"/><path d="M10 17h4"/>',
'flame':'<path d="M12 22c5.5-2.5 8-7 8-12a8 8 0 00-16 0c0 5 2.5 9.5 8 12z"/><path d="M12 22c-2-1-4-3.5-4-7a4 4 0 018 0c0 3.5-2 6-4 7z"/>',
'globe':'<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>',
'home':'<path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><path d="M9 22V12h6v10"/>',
'image':'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
'keyboard':'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h3m2 0h2m2 0h3"/><path d="M6 12h2m2 0h4m2 0h2"/><path d="M8 16h8"/>',
'layers':'<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/>',
'layout':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M9 21V9"/>',
'mail':'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 6L2 7"/>',
'map':'<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
'megaphone':'<path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M15.54 8.46a5 5 0 010 7.07"/><path d="M19.07 4.93a10 10 0 010 14.14"/>',
'message':'<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>',
'mic':'<path d="M12 1a4 4 0 00-4 4v6a4 4 0 008 0V5a4 4 0 00-4-4z"/><path d="M6 11v1a6 6 0 0012 0v-1"/><path d="M12 19v4"/>',
'newspaper':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h4v4H7z"/><path d="M14 7h3"/><path d="M14 11h3"/><path d="M7 15h10"/>',
'pen':'<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 013 3L7 19l-4 1 1-4z"/>',
'phone':'<rect x="5" y="2" width="14" height="20" rx="3"/><path d="M12 18h.01"/>',
'plane':'<path d="M22 2L11 13"/><path d="M22 2l-7 20-4-9-9-4z"/>',
'post':'<path d="M4 22h16a2 2 0 002-2V4a2 2 0 00-2-2H8a2 2 0 00-2 2v16a2 2 0 01-2 2zm0 0a2 2 0 01-2-2v-9c0-1.1.9-2 2-2h2"/><path d="M10 10h4"/><path d="M10 14h4"/><path d="M10 18h4"/>',
'presentation':'<rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
'printer':'<path d="M6 9V2h12v7"/><path d="M6 18H4a2 2 0 01-2-2v-5a2 2 0 012-2h16a2 2 0 012 2v5a2 2 0 01-2 2h-2"/><rect x="6" y="14" width="12" height="8"/>',
'rocket':'<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 00-2.91-.09z"/><path d="M12 15l-3-3a22 22 0 012-3.95A12.88 12.88 0 0122 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 01-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0"/><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
'school':'<path d="M22 10v6M2 10l10-5 10 5-10 5z"/><path d="M6 12v5c3 3 9 3 12 0v-5"/>',
'search':'<circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>',
'shield':'<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><path d="M9 12l2 2 4-4"/>',
'table':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18"/><path d="M3 15h18"/><path d="M9 3v18"/>',
'tag':'<path d="M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z"/><circle cx="7" cy="7" r="1"/>',
'terminal':'<rect x="2" y="3" width="20" height="18" rx="2"/><path d="M7 8l4 4-4 4"/><path d="M14 16h3"/>',
'trending':'<path d="M23 6l-9.5 9.5-5-5L1 18"/><path d="M17 6h6v6"/>',
'users':'<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>',
'utensils':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M18 15v7"/>',
'video':'<polygon points="23 7 16 12 23 17 23 7"/><rect x="1" y="5" width="15" height="14" rx="2"/>',
'wand':'<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>',
'wifi':'<path d="M5 12.55a11 11 0 0114.08 0"/><path d="M1.42 9a16 16 0 0121.16 0"/><path d="M8.53 16.11a6 6 0 016.95 0"/><circle cx="12" cy="20" r="1"/>'
};

// Default fallback icons
const DEFAULT_PROJECT_ICON='<path d="M21 8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><path d="M3.3 7L12 12l8.7-5"/><path d="M12 22V12"/>';
const DEFAULT_LINK_ICON='<path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/>';

// Shared icon renderer — wraps inner SVG paths; passes through full SVGs (safe: all SVGs are hardcoded constants, not user content)
function mkIcon(s){const ic=document.createElement('div');ic.className='picon';var v=s.slice(0,4)==='<svg'?s:SVG_WRAP_OPEN+s+SVG_WRAP_CLOSE;ic.textContent='';ic.insertAdjacentHTML('afterbegin',v);return ic}

// Render categorized cards (projects & links)
function showCards(cfg){
  const el=$(cfg.el);
  if(cfg.data&&el.children.length)return;
  el.replaceChildren();
  cfg.get().then(items=>{
    const sw=$(cfg.si);
    if(!items.length){
      if(sw)sw.parentNode.style.display='none';
      const d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';d.setAttribute('role','status');
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    const frag=document.createDocumentFragment();
    cfg.cats.forEach(cat=>{
      const filtered=items.filter(x=>x.category===cat).sort((a,b)=>a.title.localeCompare(b.title));
      if(!filtered.length)return;
      const sec=document.createElement('div');sec.className='link-sec';
      const h=document.createElement('h3');h.textContent=cat;sec.appendChild(h);
      filtered.forEach(x=>{
        const a=document.createElement('a');a.className='pcard';
        if(x.url==='#'){
          a.href=mailtoUrl(x.title);
        }else{a.href=x.url;a.target='_blank';a.rel='noopener noreferrer'}
        a.setAttribute('data-q',normC((x.title+' '+cfg.sub(x)+' '+x.category).toLowerCase()));
        a.setAttribute('data-title',normC(x.title.toLowerCase()));
        if(cfg.icon){a.appendChild(mkIcon(cfg.icon(x)))}
        const inf=document.createElement('div');inf.className='pinf';
        const pt=document.createElement('div');pt.className='pt';pt.textContent=x.title;
        const pd=document.createElement('div');pd.className='pd';pd.textContent=cfg.sub(x);
        inf.appendChild(pt);inf.appendChild(pd);
        const arr=document.createElement('div');arr.className='arr';
        arr.insertAdjacentHTML('afterbegin',CHEVRON);
        a.appendChild(inf);a.appendChild(arr);sec.appendChild(a);
      });
      frag.appendChild(sec);
    });
    el.appendChild(frag);
    const si=$(cfg.si);if(si&&si.value){filterList(si,el);const x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

function showProjects(){showCards({el:'#plist',data:projects,get:getProjects,cats:projectCategories,si:'#psearch',sub:x=>x.subtitle,icon:x=>PROJECT_ICONS[x.title]||DEFAULT_PROJECT_ICON})}
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,cats:linkCategories,si:'#lsearch',sub:x=>cleanUrl(x.url),icon:x=>ICONS[x.icon]||DEFAULT_LINK_ICON})}

// Render CV
function showCV(){
  const el=$('#cvlist');
  if(cv&&el.children.length)return;
  el.replaceChildren();
  getCV().then(data=>{
    const sw=$('#csearch');
    if(!data.length){
      if(sw)sw.parentNode.style.display='none';
      const d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';d.setAttribute('role','status');
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    const frag=document.createDocumentFragment();
    data.forEach(section=>{
      const sec=document.createElement('div');sec.className='cv-sec';
      const h=document.createElement('h3');h.textContent=section.section;sec.appendChild(h);
      section.entries.forEach(e=>{
        const card=document.createElement('div');card.className='cve';
        if(e.org){
          const co=document.createElement('div');co.className='co';co.textContent=e.org;card.appendChild(co);
          if(e.role){
            const cr=document.createElement('div');cr.className='cr';cr.textContent=e.role;card.appendChild(cr);
          }
          if(e.location||e.dates){
            const meta=document.createElement('div');meta.className='cmeta';
            if(e.location){const loc=document.createElement('span');loc.textContent=e.location;meta.appendChild(loc)}
            if(e.dates){const dates=document.createElement('span');dates.textContent=e.dates;meta.appendChild(dates)}
            card.appendChild(meta);
          }
          if(e.text){
            const cn=document.createElement('div');cn.className='cn';cn.textContent=e.text;card.appendChild(cn);
          }
          if(e.pills){
            const pills=document.createElement('div');pills.className='pills';
            e.pills.forEach(p=>{
              const pill=document.createElement('span');pill.className='pill';pill.textContent=p;pills.appendChild(pill);
            });
            card.appendChild(pills);
          }
          if(e.bullets){
            const ul=document.createElement('ul');
            e.bullets.forEach(b=>{
              const li=document.createElement('li');li.textContent=b;ul.appendChild(li);
            });
            card.appendChild(ul);
          }
        }
        card.setAttribute('data-q',normC(card.textContent.toLowerCase()));
        if(e.org)card.setAttribute('data-title',normC(e.org.toLowerCase()));
        sec.appendChild(card);
      });
      frag.appendChild(sec);
    });
    el.appendChild(frag);
    const si=$('#csearch');if(si&&si.value){filterList(si,el);const x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

// Render post list
function showList(){
  const el=$('#ulist');
  if(posts&&el.querySelector('.ucard')){
    const sw=$('#usearch');if(sw)sw.parentNode.style.display='block';
    if(sw&&sw.value)filterList(sw,el);
    return;
  }
  el._saved=null;
  el.replaceChildren();
  getPosts().then(p=>{
    const sw=$('#usearch');
    if(!p.length){
      if(sw)sw.parentNode.style.display='none';
      const d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';d.setAttribute('role','status');
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    const frag=document.createDocumentFragment();
    let curMonth='',sec;
    p.forEach(x=>{
      const ym=x.date.slice(0,7);
      if(ym!==curMonth){
        curMonth=ym;
        sec=document.createElement('div');sec.className='link-sec';
        const h=document.createElement('h3');
        h.textContent=fmtDate(x.date,{month:'long',year:'numeric'});
        sec.appendChild(h);frag.appendChild(sec);
      }
      const a=document.createElement('a');
      a.className='ucard';
      a.href='/updates/'+x.file.replace('.md','');
      a.setAttribute('data-q',normC((x.title+' '+x.date).toLowerCase()));
      a.setAttribute('data-title',normC(x.title.toLowerCase()));
      a.appendChild(mkIcon(ICONS[x.icon]||ICONS['post']));
      const inf=document.createElement('div');inf.className='uinf';
      const t=document.createElement('div');t.className='ut';t.textContent=x.title;
      const d=document.createElement('div');d.className='ud';d.textContent=fmtDate(x.date);
      inf.appendChild(t);inf.appendChild(d);a.appendChild(inf);sec.appendChild(a);
    });
    el.appendChild(frag);
    const si=$('#usearch');
    if(si&&si.value){filterList(si,el);const x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

// Render single post
// Note: innerHTML used here to render parsed markdown from first-party .md
// files committed by the site owner. Content is same-origin and trusted.
function showPost(slug){
  const el=$('#ulist');
  const ver=++postVer;
  el.replaceChildren();
  function render(html){
    if(ver!==postVer)return;
    const content=document.createElement('div');
    content.className='pcontent';
    // Safe: html is parsed from first-party .md files committed by site owner
    content.innerHTML=html;
    const h1=content.querySelector('h1');
    if(h1)document.title='DS | '+h1.textContent;
    el.appendChild(content);
    window.scrollTo(0,0);
  }
  if(postCache[slug]){render(postCache[slug]);return}
  fetch('/updates/'+encodeURIComponent(slug)+'.md')
    .then(r=>{if(!r.ok)throw new Error('Post '+r.status);return r.text()})
    .then(md=>{
      const html=parseMd(md);
      postCache[slug]=html;
      render(html);
    })
    .catch(e=>{
      if(ver!==postVer)return;
      console.error('Post load failed:',slug,e);
      const msg=document.createElement('div');msg.className='empty';msg.setAttribute('role','status');
      msg.textContent='Unable to load this post. Please check your connection and try again.';
      el.appendChild(msg);
    });
}

// Markdown parser — processes first-party .md files only
function parseMd(md){
  md=md.replace(/^---[\s\S]*?---\n?/,'');
  let h='',code=false,ul=false,ol=false;
  const lines=md.split('\n');
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    if(line.startsWith('```')){
      if(code){h+='</code></pre>';code=false}
      else{cl();h+='<pre><code>';code=true}
      continue;
    }
    if(code){h+=esc(line)+'\n';continue}
    if(!line.trim()){cl();continue}
    if(line.startsWith('### ')){cl();h+='<h3>'+il(line.slice(4))+'</h3>';continue}
    if(line.startsWith('## ')){cl();h+='<h2>'+il(line.slice(3))+'</h2>';continue}
    if(line.startsWith('# ')){cl();h+='<h1>'+il(line.slice(2))+'</h1>';continue}
    if(line.startsWith('> ')){cl();h+='<blockquote><p>'+il(line.slice(2))+'</p></blockquote>';continue}
    if(RE_UL.test(line)){
      if(!ul){cl();h+='<ul>';ul=true}
      h+='<li>'+il(line.replace(RE_UL,''))+'</li>';continue;
    }
    if(RE_OL.test(line)){
      if(!ol){cl();h+='<ol>';ol=true}
      h+='<li>'+il(line.replace(RE_OL,''))+'</li>';continue;
    }
    cl();h+='<p>'+il(line)+'</p>';
  }
  cl();if(code)h+='</code></pre>';
  return h;

  function cl(){
    if(ul){h+='</ul>';ul=false}
    if(ol){h+='</ol>';ol=false}
  }
}

function il(t){
  return t
    .replace(/`([^`]+)`/g,(_,c)=>'<code>'+esc(c)+'</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,src)=>{
      return '<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy" decoding="async">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,text,href)=>{
      return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(text)+'</a>';
    });
}

function esc(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Diacritic normalization + cache
function norm(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
var _nCache={};
function normC(s){return _nCache[s]||(_nCache[s]=norm(s))}

// Bounded Damerau-Levenshtein distance (3-row for transpositions)
function dlDist(a,b,max){
  var la=a.length,lb=b.length;
  if(Math.abs(la-lb)>max)return max+1;
  if(!la)return lb>max?max+1:lb;
  if(!lb)return la>max?max+1:la;
  var pp=[],pr=[],cr=[];
  for(var j=0;j<=lb;j++)pr[j]=j;
  for(var i=1;i<=la;i++){
    cr[0]=i;var mn=cr[0];
    for(var j=1;j<=lb;j++){
      var cost=a[i-1]===b[j-1]?0:1;
      cr[j]=Math.min(pr[j]+1,cr[j-1]+1,pr[j-1]+cost);
      if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]&&pp.length)
        cr[j]=Math.min(cr[j],pp[j-2]+cost);
      if(cr[j]<mn)mn=cr[j];
    }
    if(mn>max)return max+1;
    var t=pp;pp=pr;pr=cr;cr=t.length?t:[];
  }
  return pr[lb]>max?max+1:pr[lb];
}

// 7-tier scoring: exact=10, prefix=8, word-boundary=6, substring=4, edit1=3, edit2=2, fuzzy=0.3-1.5
function scoreWord(w,t,cvPenalty){
  var nt=normC(t),nw=norm(w);
  var i=nt.indexOf(nw);
  if(i!==-1){
    if(i===0&&nt.length===nw.length)return 10;
    if(i===0)return 8+(nw.length>=4?1:0);
    if(nt[i-1]===' ')return 6+(nw.length>=4?1:0);
    return 4+(1-i/nt.length);
  }
  var d1=dlDist(nw,nt,1);
  if(d1<=1&&nw.length>=3)return 3+(nw.length>=5?0.5:0);
  if(nw.length>=5){
    var wds=nt.split(' ');
    for(var k=0;k<wds.length;k++){
      if(dlDist(nw,wds[k],1)<=1)return 3+(nw.length>=5?0.5:0);
      if(dlDist(nw,wds[k],2)<=2)return 2;
    }
    if(dlDist(nw,nt,2)<=2)return 2;
  }else if(nw.length>=3){
    var wds=nt.split(' ');
    for(var k=0;k<wds.length;k++){
      if(dlDist(nw,wds[k],1)<=1)return 3;
    }
  }
  var qi=0,first=-1,last=0;
  for(var ti=0;ti<nt.length&&qi<nw.length;ti++){
    if(nt[ti]===nw[qi]){if(first<0)first=ti;last=ti;qi++}
  }
  if(qi<nw.length)return 0;
  var f=0.3+nw.length/(last-first+1)*1.2;
  return cvPenalty?f*0.7:f;
}

// Generic list filter — scores, sorts, flattens results when searching
function filterList(input,container){
  const q=norm(input.value.trim().toLowerCase());
  const words=q.split(/\s+/).filter(Boolean);
  const secs=[].slice.call(container.querySelectorAll('.link-sec,.cv-sec'));
  const cards=[].slice.call(container.querySelectorAll('.pcard,.cve,.ucard'));

  if(!container._saved&&cards.length){
    container._saved=cards.map(c=>({el:c,parent:c.parentNode}));
  }

  // No query — restore original categorized layout instantly
  if(!words.length){
    if(container._saved){
      container._saved.forEach(s=>{
        s.parent.appendChild(s.el);s.el.style.display='';
      });
    }
    secs.forEach(s=>{s.style.display=''});
    const empty=container.querySelector('.search-empty');
    if(empty)empty.style.display='none';
    return;
  }

  // Score each card (title weighted 1.5x, CV fuzzy penalized 0.7x)
  const scored=[];
  cards.forEach(c=>{
    const t=c.getAttribute('data-q')||normC(c.textContent.toLowerCase());
    const tl=c.getAttribute('data-title');
    const isCV=c.classList.contains('cve');
    let total=0;
    const ok=words.every(w=>{
      var fs=scoreWord(w,t,isCV);
      if(tl){var ts=scoreWord(w,tl,isCV)*1.5;if(ts>fs)fs=ts}
      total+=fs;return fs>0;
    });
    if(ok)scored.push({el:c,score:total});
    else c.style.display='none';
  });

  scored.sort((a,b)=>b.score-a.score||(a.el.getAttribute('data-q')||'').localeCompare(b.el.getAttribute('data-q')||''));
  secs.forEach(s=>{s.style.display='none'});

  scored.forEach(s=>{
    s.el.style.display='';
    container.appendChild(s.el);
  });

  // Empty state
  let empty=container.querySelector('.search-empty');
  if(!scored.length){
    if(!empty){empty=document.createElement('div');empty.className='empty search-empty';empty.textContent='No results';empty.setAttribute('role','status');container.appendChild(empty)}
    empty.style.display='';
  }else if(empty){empty.style.display='none'}
}

function fmtDate(d,opts){
  if(!d)return '';
  var dt=new Date(d+'T12:00:00');
  if(isNaN(dt.getTime()))return '';
  return dt.toLocaleDateString('en-GB',opts||{day:'numeric',month:'long',year:'numeric'});
}

// Search wiring with debounce
function wireSearch(iid,cid){
  const i=$(iid),c=$(cid);
  if(!i||!c)return;
  const x=i.parentNode.querySelector('.search-x');
  let timer;
  function run(){
    filterList(i,c);
    if(x)x.style.display=i.value?'flex':'none';
  }
  i.addEventListener('input',()=>{
    clearTimeout(timer);
    if(x)x.style.display=i.value?'flex':'none';
    timer=setTimeout(run,80);
  });
  i.addEventListener('keydown',e=>{
    if(e.key==='Escape'){clearTimeout(timer);i.value='';run();i.blur()}
  });
  if(x)x.addEventListener('click',()=>{clearTimeout(timer);i.value='';run();i.focus()});
}
[['#psearch','#plist'],['#csearch','#cvlist'],['#usearch','#ulist'],['#lsearch','#llist']].forEach(function(p){wireSearch(p[0],p[1])});

// Theme toggle
const themeBtn=$('#theme-toggle');
const themeLabel=$('#theme-label');
const themeOrder=['light','sepia','dark'];
const themeColors={light:'#FAFAFA',sepia:'#F5EDDA',dark:'#1C1C1E'};
function setThemeLabel(t){if(themeLabel)themeLabel.textContent='Theme: '+t[0].toUpperCase()+t.slice(1)}
function curTheme(){return document.documentElement.getAttribute('data-theme')||'light'}
function applyTheme(t){
  if(t==='light'){document.documentElement.removeAttribute('data-theme')}
  else{document.documentElement.setAttribute('data-theme',t)}
  setThemeLabel(t);
  const mt=$('meta[name="theme-color"]');if(mt)mt.content=themeColors[t];
  const ms=$('meta[name="color-scheme"]');if(ms)ms.content=t==='dark'?'dark':'light';
}
if(themeBtn){
  setThemeLabel(curTheme());
  themeBtn.addEventListener('click',e=>{
    e.preventDefault();
    const cur=curTheme();
    const next=themeOrder[(themeOrder.indexOf(cur)+1)%themeOrder.length];
    if(next==='light')localStorage.removeItem('theme');
    else localStorage.setItem('theme',next);
    applyTheme(next);
  });
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return;
  const stored=localStorage.getItem('theme')||'light';
  if(stored!==curTheme())applyTheme(stored);
  // iOS Safari: force nav repaint after tab switch to restore touch hit-testing
  const n=document.querySelector('nav');
  if(n){n.style.display='none';n.offsetHeight;n.style.display=''}
},{passive:true});

// Command palette
const cmdOverlay=document.createElement('div');cmdOverlay.className='cmd-overlay';cmdOverlay.setAttribute('aria-hidden','true');
const cmdPalette=document.createElement('div');cmdPalette.className='cmd-palette';cmdPalette.setAttribute('role','dialog');cmdPalette.setAttribute('aria-modal','true');cmdPalette.setAttribute('aria-label','Search');
const cmdInput=document.createElement('input');cmdInput.className='cmd-input';cmdInput.type='text';cmdInput.placeholder='Search';cmdInput.autocomplete='off';cmdInput.spellcheck=false;
const cmdX=document.createElement('button');cmdX.className='cmd-x';cmdX.setAttribute('aria-label','Clear search');
const cmdResults=document.createElement('div');cmdResults.className='cmd-results';
const cmdInputWrap=document.createElement('div');cmdInputWrap.className='cmd-input-wrap';
cmdInputWrap.appendChild(cmdInput);cmdInputWrap.appendChild(cmdX);
cmdPalette.appendChild(cmdInputWrap);cmdPalette.appendChild(cmdResults);cmdOverlay.appendChild(cmdPalette);
document.body.appendChild(cmdOverlay);

let cmdOpen=false;
let cmdIdx=-1;
let cmdItems=null;

function openCmd(){
  if(cmdOpen)return;
  if(qrOpen)closeQR();
  cmdOpen=true;
  cmdInput.value='';
  cmdX.style.display='none';
  cmdResults.textContent='';
  cmdIdx=-1;
  cmdItems=cmdBuildItems();
  document.body.style.overflow='hidden';
  cmdOverlay.removeAttribute('aria-hidden');
  cmdOverlay.classList.add('open');
  cmdInput.focus();
  cmdInput.select();
}

function closeCmd(){
  if(!cmdOpen)return;
  cmdOpen=false;
  cmdItems=null;
  document.body.style.overflow='';
  cmdOverlay.setAttribute('aria-hidden','true');
  cmdOverlay.classList.remove('open');
  cmdInput.blur();
}

cmdOverlay.addEventListener('click',e=>{
  if(e.target===cmdOverlay)closeCmd();
});

const qrOverlay=document.createElement('div');
qrOverlay.className='qr-overlay';
qrOverlay.setAttribute('role','dialog');
qrOverlay.setAttribute('aria-modal','true');
qrOverlay.setAttribute('aria-label','QR Code');
const qrCard=document.createElement('div');qrCard.className='qr-card';
const qrImg=document.createElement('img');qrImg.alt='QR code to saputra.co.uk';qrImg.width=23;qrImg.height=23;
qrCard.appendChild(qrImg);qrOverlay.appendChild(qrCard);document.body.appendChild(qrOverlay);

let qrOpen=false;
function openQR(){
  if(qrOpen)return;
  if(cmdOpen)closeCmd();
  if(!qrImg.src)qrImg.src='/qr-homepage.png';
  qrOpen=true;
  document.body.style.overflow='hidden';
  qrOverlay.classList.add('open');
}
function closeQR(){
  if(!qrOpen)return;
  qrOpen=false;
  document.body.style.overflow='';
  qrOverlay.classList.remove('open');
}
const nameCard=$('.name-card');
if(nameCard){
  nameCard.addEventListener('click',e=>{e.preventDefault();openQR()});
  nameCard.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openQR()}});
}
qrOverlay.addEventListener('click',e=>{if(e.target===qrOverlay)closeQR()});

function cmdBuildItems(){
  const items=[];
  function add(title,sub,type,act){items.push({q:normC((title+' '+(sub||'')).toLowerCase()),tl:normC(title.toLowerCase()),title:title,type:type,act:act})}
  validPages.forEach(p=>{
    add(titles[p],'','Page',()=>{history.pushState(null,'',p==='home'?'/':'/'+p);route()});
  });
  if(projects)projects.forEach(x=>{
    add(x.title,x.subtitle,'Project',()=>{
      if(x.url==='#'){location.href=mailtoUrl(x.title)}
      else window.open(x.url,'_blank')
    });
  });
  if(links)links.forEach(x=>{
    add(x.title,cleanUrl(x.url),'Link',()=>{window.open(x.url,'_blank')});
  });
  if(posts)posts.forEach(x=>{
    add(x.title,fmtDate(x.date),'Post',()=>{
      history.pushState(null,'','/updates/'+x.file.replace('.md',''));route();
    });
  });
  if(cv)cv.forEach(sec=>{
    sec.entries.forEach(e=>{
      if(!e.org)return;
      add(e.org,e.role||e.text||'','CV',()=>{
        history.pushState(null,'','/cv');route();
      });
    });
  });
  return items;
}

// Type priority: pages are primary nav, content items next, CV last
const cmdTypePri={Page:4,Project:3,Link:3,Post:3,CV:2};

function cmdSearch(q){
  const words=norm(q.trim().toLowerCase()).split(/\s+/).filter(Boolean);
  if(!words.length)return [];
  const items=cmdItems||[];
  const scored=[];
  items.forEach(it=>{
    let total=0;
    const isCV=it.type==='CV';
    const ok=words.every(w=>{
      const ts=scoreWord(w,it.tl,isCV)*1.5;
      const fs=scoreWord(w,it.q,isCV);
      const s=ts>fs?ts:fs;
      total+=s;return s>0;
    });
    if(ok)scored.push({item:it,score:total+(cmdTypePri[it.type]||0)*0.1});
  });
  scored.sort((a,b)=>b.score-a.score||a.item.title.localeCompare(b.item.title));
  return scored.slice(0,8).map(s=>s.item);
}

let cmdTimer;
cmdInput.addEventListener('input',()=>{
  clearTimeout(cmdTimer);
  cmdX.style.display=cmdInput.value?'flex':'none';
  cmdTimer=setTimeout(cmdRender,80);
});
cmdX.addEventListener('click',()=>{clearTimeout(cmdTimer);cmdInput.value='';cmdX.style.display='none';cmdRender();cmdInput.focus()});

function cmdRender(){
  const results=cmdSearch(cmdInput.value);
  cmdResults.textContent='';
  cmdIdx=-1;
  if(!cmdInput.value.trim())return;
  if(!results.length){
    const empty=document.createElement('div');empty.className='cmd-empty';empty.textContent='Nothing Found';
    cmdResults.appendChild(empty);return;
  }
  results.forEach(r=>{
    const row=document.createElement('button');row.className='cmd-row';
    const t=document.createElement('span');t.className='cmd-row-title';t.textContent=r.title;
    const tag=document.createElement('span');tag.className='cmd-row-type';tag.textContent=r.type;
    row.appendChild(t);row.appendChild(tag);
    row.addEventListener('click',()=>{r.act();closeCmd()});
    cmdResults.appendChild(row);
  });
}

function cmdNav(dir){
  const rows=cmdResults.querySelectorAll('.cmd-row');
  if(!rows.length)return;
  if(cmdIdx>=0&&rows[cmdIdx])rows[cmdIdx].classList.remove('cmd-active');
  cmdIdx+=dir;
  if(cmdIdx<0)cmdIdx=rows.length-1;
  if(cmdIdx>=rows.length)cmdIdx=0;
  rows[cmdIdx].classList.add('cmd-active');
  rows[cmdIdx].scrollIntoView({block:'nearest'});
}

cmdInput.addEventListener('keydown',e=>{
  if(e.key==='ArrowDown'||(!e.shiftKey&&e.key==='Tab')){e.preventDefault();cmdNav(1)}
  else if(e.key==='ArrowUp'||(e.shiftKey&&e.key==='Tab')){e.preventDefault();cmdNav(-1)}
  else if(e.key==='Enter'){
    e.preventDefault();
    const rows=cmdResults.querySelectorAll('.cmd-row');
    if(cmdIdx>=0&&rows[cmdIdx])rows[cmdIdx].click();
    else if(rows.length)rows[0].click();
  }
  else if(e.key==='Escape'){e.preventDefault();closeCmd()}
});

// Keyboard shortcuts
let kbIdx=-1,kbCards=[],kbPrev=-1;

function kbGetCards(){
  const active=$('.page.active');
  if(!active)return [];
  return [].slice.call(active.querySelectorAll('.pcard,.cve,.ucard'));
}

function kbClear(remember){
  if(kbIdx>=0&&kbCards[kbIdx])kbCards[kbIdx].classList.remove('kb-focus');
  kbPrev=remember?kbIdx:-1;
  kbIdx=-1;kbCards=[];
}

function kbMove(dir){
  kbCards=kbGetCards();
  if(!kbCards.length)return;
  if(kbIdx>=0&&kbCards[kbIdx])kbCards[kbIdx].classList.remove('kb-focus');
  if(kbIdx<0){
    if(kbPrev>=0&&kbPrev<kbCards.length){
      kbIdx=kbPrev;
    }else{
      const vh=window.innerHeight;
      kbIdx=dir>0?0:kbCards.length-1;
      for(let i=dir>0?0:kbCards.length-1;dir>0?i<kbCards.length:i>=0;i+=dir){
        const r=kbCards[i].getBoundingClientRect();
        if(r.bottom>0&&r.top<vh){kbIdx=i;break}
      }
    }
    kbPrev=-1;
  }else{
    kbIdx+=dir;
    if(kbIdx<0)kbIdx=kbCards.length-1;
    if(kbIdx>=kbCards.length)kbIdx=0;
  }
  kbCards[kbIdx].classList.add('kb-focus');
  kbCards[kbIdx].scrollIntoView({block:'nearest'});
}

var _kbTick=false;
document.addEventListener('mousemove',()=>{if(kbIdx>=0)kbClear(true)},{passive:true});

const tabPaths=['/','/projects','/cv','/updates','/links'];
function isPost(){return location.pathname.startsWith('/updates/')&&location.pathname.split('/').length>2}

document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    e.preventDefault();
    if(cmdOpen)closeCmd();else openCmd();
    return;
  }

  if(cmdOpen){if(e.key==='Escape')closeCmd();return}

  if(qrOpen){if(e.key==='Tab'){e.preventDefault();return}if(e.key==='Escape')closeQR();return}

  const tag=document.activeElement&&document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'){
    if(e.key==='Escape'){document.activeElement.blur();kbClear()}
    return;
  }

  if(e.metaKey||e.ctrlKey||e.altKey)return;

  const key=e.key;

  if(key>='1'&&key<='5'){
    const idx=+key-1;
    const path=tabPaths[idx];
    if(path!==location.pathname){history.pushState(null,'',path);route()}
    kbClear();return;
  }

  if(key==='/'){
    const page=$('.page.active');
    if(!page)return;
    const si=page.querySelector('.search');
    if(si){e.preventDefault();si.focus()}
    return;
  }

  if(key==='t'){
    if(themeBtn)themeBtn.click();
    return;
  }

  if(key==='j'||key==='ArrowDown'){e.preventDefault();if(!_kbTick){_kbTick=true;var d=1;requestAnimationFrame(function(){kbMove(d);_kbTick=false})}return}
  if(key==='k'||key==='ArrowUp'){e.preventDefault();if(!_kbTick){_kbTick=true;var d=-1;requestAnimationFrame(function(){kbMove(d);_kbTick=false})}return}

  if(key==='ArrowRight'||key==='ArrowLeft'){
    let ci=tabPaths.indexOf(location.pathname==='/'?'/':location.pathname);
    if(ci===-1)ci=0;
    ci+=key==='ArrowRight'?1:-1;
    if(ci<0)ci=tabPaths.length-1;
    if(ci>=tabPaths.length)ci=0;
    history.pushState(null,'',tabPaths[ci]);route();
    kbClear();return;
  }

  if(key==='Enter'&&kbIdx>=0&&kbCards[kbIdx]){
    kbCards[kbIdx].click();
    kbClear();return;
  }

  if(key==='Escape'){
    if(kbIdx>=0){kbClear();return}
    if(isPost()){history.pushState(null,'','/updates');route();return}
  }

  if(key==='Backspace'){
    if(isPost()){history.pushState(null,'','/updates');route();return}
  }
});

// Init
window.addEventListener('popstate',()=>{closeCmd();closeQR();kbClear();route()});
route();

// Prefetch all data during idle time so tab switches are instant
const ric=window.requestIdleCallback||(cb=>{setTimeout(cb,200)});
ric(()=>{getProjects();getCV();getPosts();getLinks()});

})();
