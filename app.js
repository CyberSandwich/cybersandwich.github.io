(function(){'use strict';

const $=function(s){return document.querySelector(s)};
const $$=function(s){return document.querySelectorAll(s)};

// State
let posts=null;
let projects=null;
let links=null;
const postCache={};
let postVer=0;
const validPages=['home','projects','updates','links'];
const titles={home:'Home',projects:'Projects',updates:'Updates',links:'Links'};
const emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');
const CHECK_SVG='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
const SVG_WRAP_OPEN='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
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
    // Force repaint to clear ghost box-shadow artifacts (Safari)
    document.body.style.transform='translateZ(0)';
    requestAnimationFrame(()=>{document.body.style.transform=''});
  }
  window.scrollTo({top:0,behavior:'instant'});
  const ft=page==='home'?$('#main'):$('#'+page+' .stitle');
  if(ft){ft.setAttribute('tabindex','-1');ft.focus()}

  $$('.tabs a').forEach(a=>{
    const href=a.getAttribute('href');
    const isActive=(page==='home'&&href==='/')||(page!=='home'&&href==='/'+page);
    a.classList.toggle('active',isActive);
    if(isActive)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });



  if(page!=='updates'){for(const k in postCache)delete postCache[k]}

  if(page==='projects'){showProjects()}
  if(page==='links'){showLinks()}
  if(page==='updates'){
    let wrap=$('#usearch');
    if(wrap)wrap=wrap.parentNode;
    if(slug){if(wrap)wrap.style.display='none';showPost(slug)}
    else{const st=$('#updates .stitle');if(st)st.textContent='Updates';const ul=$('#ulist');if(ul&&ul.querySelector('.pcontent'))ul.replaceChildren();if(wrap)wrap.style.display='block';showList()}
  }
}

// Screen-reader announcement region for copy feedback (WCAG 4.1.3)
const copyLive=document.createElement('div');
copyLive.className='sr-only';
copyLive.setAttribute('aria-live','polite');
copyLive.setAttribute('role','status');
document.body.appendChild(copyLive);

// Click handler: copy buttons + SPA link interception
// Note: CHECK_SVG innerHTML below uses hardcoded SVG constant, not user content — safe from XSS
document.addEventListener('click',e=>{
  const btn=e.target.closest('.copy-btn');
  if(btn){
    const text=btn.getAttribute('data-copy');
    if(!text)return;
    e.preventDefault();
    function done(){
      clearTimeout(btn._t1);clearTimeout(btn._t2);
      btn.classList.add('copied');
      btn.textContent='';
      const tmp=document.createElement('span');
      tmp.innerHTML=CHECK_SVG;
      btn.appendChild(tmp.firstChild);
      copyLive.textContent='Copied';
      btn._t1=setTimeout(()=>{
        btn.style.opacity='0';
        btn._t2=setTimeout(()=>{
          btn.classList.remove('copied');
          btn.textContent='Copy';
          btn.style.opacity='';
          copyLive.textContent='';
        },200);
      },1500);
    }
    function legacy(){
      const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';
      document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done();
    }
    if(navigator.clipboard&&navigator.clipboard.writeText){
      navigator.clipboard.writeText(text).then(done).catch(()=>{try{legacy()}catch(e){}});
    }else{try{legacy()}catch(e){}}
    return;
  }
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  const a=e.target.closest('a[href]');
  if(!a)return;
  const href=a.getAttribute('href');
  if(!href.startsWith('/')||href.startsWith('//')||a.hasAttribute('download')||a.target==='_blank')return;
  const parts=href.split('/').filter(Boolean);
  const page=parts[0];
  if(!page||validPages.indexOf(page)!==-1){
    e.preventDefault();
    if(href===location.pathname&&(href==='/'||page==='home')){openCmd();return}
    if(href!==location.pathname)history.pushState(null,'',href);
    route();
  }
});

// Data loaders (SWR via shared/swr.js)
const getProjects=_swr.loader('/projects/projects.json',d=>{projects=d;return d});
const getLinks=_swr.loader('/links/links.json',d=>{links=d;return d});
const getPosts=_swr.loader('/updates/posts.json',d=>{
  d.sort((a,b)=>b.date>a.date?1:b.date<a.date?-1:a.title.localeCompare(b.title));
  posts=d;return d;
});

const projectCategories=['Flagship Projects','Image Tools','Text Tools','Time Tools','Generators','Utilities','Miscellaneous','In Development'];
const linkCategories=['Modules','Initiatives','Academic','Career','Community','Personal','Social Media','Miscellaneous'];

// Chevron SVG for card arrows
const CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

// Project icons — hardcoded SVGs keyed by title, safe for innerHTML
const PROJECT_ICONS={
'menuva':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M18 15v7"/>',
'CaseConverter':'<path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/>',
'ClearView':'<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="1"/><path d="M18.944 12.33a1 1 0 0 0 0-.66 7.5 7.5 0 0 0-13.888 0 1 1 0 0 0 0 .66 7.5 7.5 0 0 0 13.888 0"/>',
'Clip':'<path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
'Clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'Countdown':'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
'Arbit':'<rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
'CodeGen':'<path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M16 7v10"/>',
'Iconic':'<path d="M8.3 10a.7.7 0 0 1-.626-1.079L11.4 3a.7.7 0 0 1 1.198-.043L16.3 8.9a.7.7 0 0 1-.572 1.1Z"/><rect x="3" y="14" width="7" height="7" rx="1"/><circle cx="17.5" cy="17.5" r="3.5"/>',
'MockupGen':'<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
'ImageOpt':'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/>',
'Lorip':'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6"/><path d="M16 13H8"/><path d="M16 17H8"/><path d="M10 9H8"/>',
'Miele Laundry Guide':'<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
'NumGen':'<path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3l-2 18"/><path d="M16 3l-2 18"/>',
'PasswdGen':'<rect x="2" y="6" width="20" height="12" rx="3"/><circle cx="7" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="17" cy="12" r="1.5" fill="currentColor" stroke="none"/>',
'Parsely':'<path d="M22 3H2l8 9.46V19l4 2v-8.54z"/>',
'ReSolve':'<polyline points="16 3 21 3 21 8"/><path d="M4 20L21 3"/><polyline points="21 16 21 21 16 21"/><path d="M15 15l6 6"/><path d="M4 4l5 5"/>',
'ThymeZone':'<circle cx="12" cy="12" r="10"/><path d="M2 12h20"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10"/>',
'Palit':'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
'Wrighter':'<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
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
'briefcase':'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
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
'gamepad':'<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
'gauge':'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
'graduation':'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
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
'monitor-play':'<path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>',
'music':'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
'newspaper':'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M7 7h4v4H7z"/><path d="M14 7h3"/><path d="M14 11h3"/><path d="M7 15h10"/>',
'notebook':'<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
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
'sparkles':'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
'spell-check':'<path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/>',
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
function mkIcon(s){const ic=document.createElement('div');ic.className='picon';const v=s.slice(0,4)==='<svg'?s:SVG_WRAP_OPEN+s+SVG_WRAP_CLOSE;ic.textContent='';ic.insertAdjacentHTML('afterbegin',v);return ic}

// Skeleton loading placeholders
function showSkel(el,n){el.setAttribute('aria-busy','true');for(let i=0;i<n;i++){const s=document.createElement('div');s.className='skel';el.appendChild(s)}}
function mkEmpty(text,cls){const d=document.createElement('div');d.className=cls||'empty';d.textContent=text;d.setAttribute('role','status');return d}
function mkSection(label,cls){const s=document.createElement('div');s.className=cls;const h=document.createElement('h3');h.textContent=label;s.appendChild(h);return s}
function setSearchVis(sw,v){if(sw)sw.parentNode.style.display=v?'block':'none'}
function setSearchX(p,v){const x=p.querySelector('.search-x');if(x)x.style.display=v?'flex':'none'}

// Render categorized cards (projects & links)
function renderCards(cfg,el,sw,items){
  el.removeAttribute('aria-busy');
  el.replaceChildren();
  if(!items||!items.length){
    setSearchVis(sw,false);
    el.appendChild(mkEmpty(cfg.get.err?'Unable to load. Please check your connection.':'Coming Soon!'));return;
  }
  setSearchVis(sw,true);
  const frag=document.createDocumentFragment();
  cfg.groups(items).forEach(g=>{
    if(!g.items.length)return;
    const sec=mkSection(g.label,'link-sec');
    g.items.forEach(x=>{
      const a=document.createElement('a');a.className='pcard';
      a.href=cfg.href(x);
      if(cfg.external&&cfg.external(x)){a.target='_blank';a.rel='noopener noreferrer'}
      a.setAttribute('data-q',normC(cfg.q(x)));
      a.setAttribute('data-title',normC(cfg.title(x).toLowerCase()));
      a.appendChild(mkIcon(cfg.icon(x)));
      const inf=document.createElement('div');inf.className='pinf';
      const pt=document.createElement('div');pt.className='pt';pt.textContent=cfg.title(x);
      const pd=document.createElement('div');pd.className='pd';pd.textContent=cfg.sub(x);
      inf.appendChild(pt);inf.appendChild(pd);
      a.appendChild(inf);
      if(cfg.chevron){const arr=document.createElement('div');arr.className='arr';arr.insertAdjacentHTML('afterbegin',CHEVRON);a.appendChild(arr)}
      sec.appendChild(a);
    });
    frag.appendChild(sec);
  });
  el.appendChild(frag);
  if(sw&&sw.value){filterList(sw,el);setSearchX(sw.parentNode,true)}
}
function showCards(cfg){
  const el=$(cfg.el);
  const sw=$(cfg.si);
  if(cfg.data&&el.children.length){
    setSearchVis(sw,true);
    if(sw&&sw.value)filterList(sw,el);
    return;
  }
  el._saved=null;
  el.replaceChildren();
  showSkel(el,3);
  cfg.get().then(items=>{
    renderCards(cfg,el,sw,items);
    cfg.get.onFresh=function(d){
      kbClear();
      el.style.opacity='0';
      cfg.get.onFresh=null;
      setTimeout(function(){el._saved=null;renderCards(cfg,el,sw,d);el.style.opacity=''},150);
    };
  });
}

function catGroups(cats){return function(items){return cats.map(cat=>({label:cat,items:items.filter(x=>x.category===cat).sort((a,b)=>a.title.localeCompare(b.title))}))}}

function showProjects(){showCards({el:'#plist',data:projects,get:getProjects,si:'#psearch',chevron:true,
  groups:catGroups(projectCategories),href:x=>x.url==='#'?mailtoUrl(x.title):x.url,external:x=>x.url!=='#'&&!x.url.startsWith('/'),
  title:x=>x.title,sub:x=>x.subtitle,icon:x=>PROJECT_ICONS[x.title]||DEFAULT_PROJECT_ICON,q:x=>(x.title+' '+x.subtitle+' '+x.category).toLowerCase()})}
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,si:'#lsearch',chevron:true,
  groups:catGroups(linkCategories),href:x=>x.url,external:()=>true,
  title:x=>x.title,sub:x=>cleanUrl(x.url),icon:x=>ICONS[x.icon]||DEFAULT_LINK_ICON,q:x=>(x.title+' '+cleanUrl(x.url)+' '+x.category).toLowerCase()})}

function showList(){showCards({el:'#ulist',data:posts,get:getPosts,si:'#usearch',chevron:true,
  groups:function(items){const g=[];let cur='',s;items.forEach(function(x){const ym=x.date.slice(0,7);if(ym!==cur){cur=ym;s={label:fmtDate(x.date,{month:'long',year:'numeric'}),items:[]};g.push(s)}s.items.push(x)});return g},
  href:x=>'/updates/'+x.file.replace('.md',''),title:x=>x.title,sub:x=>fmtDate(x.date),
  icon:x=>ICONS[x.icon]||ICONS['post'],q:x=>(x.title+' '+x.date).toLowerCase()})}

// Render single post — splits on <hr> into multi-card layout
// innerHTML usage: Safe — content is parsed from first-party .md files
// committed by the site owner, not user input. Same-origin trusted content.
function showPost(slug){
  const el=$('#ulist');
  const stitle=$('#updates .stitle');
  const ver=++postVer;
  el.replaceChildren();
  function render(html){
    if(ver!==postVer)return;
    // Parse into DOM and walk nodes (safe: first-party markdown)
    const tmp=document.createElement('div');
    tmp.innerHTML=html;
    const h1=tmp.querySelector('h1');
    if(h1){
      document.title='DS | '+h1.textContent;
      if(stitle)stitle.textContent=h1.textContent;
      h1.remove();
    }
    // Walk child nodes: h2→section heading, hr→card break, else→card content
    const frag=document.createDocumentFragment();
    var card=null;
    function flush(){if(card){frag.appendChild(card);card=null}}
    var nodes=[].slice.call(tmp.childNodes);
    for(var i=0;i<nodes.length;i++){
      var n=nodes[i];
      if(n.nodeType===1&&n.tagName==='H1'){continue}
      if(n.nodeType===1&&n.tagName==='H2'){
        flush();
        frag.appendChild(mkSection(n.textContent,'link-sec'));
        continue;
      }
      if(n.nodeType===1&&n.tagName==='HR'){
        flush();
        continue;
      }
      // Skip whitespace-only text nodes between blocks
      if(n.nodeType===3&&!n.textContent.trim())continue;
      if(!card){card=document.createElement('div');card.className='pcontent'}
      card.appendChild(n.cloneNode(true));
    }
    flush();
    el.appendChild(frag);
    window.scrollTo(0,0);
  }
  if(postCache[slug]){render(postCache[slug]);return}
  _swr('/updates/'+encodeURIComponent(slug)+'.md',{
    parse:function(md){try{return parseMd(md)}catch(e){console.error('Parse error:',e);return'<p>Unable to render this post.</p>'}},
    key:'swr_post_'+slug,
    onFresh:function(html){postCache[slug]=html;render(html)}
  }).then(function(html){
    postCache[slug]=html;
    render(html);
  }).catch(function(e){
    if(ver!==postVer)return;
    console.error('Post load failed:',slug,e);
    el.appendChild(mkEmpty('Unable to load this post. Please check your connection and try again.'));
  });
}

// Markdown parser — processes first-party .md files only
// Gracefully handles malformed input: returns raw text wrapped in <p> on error
function parseMd(md,_depth){
  if(!md||typeof md!=='string')return '';
  if(!_depth)md=md.replace(/^---[\s\S]*?---\n?/,'');
  if((_depth||0)>4)return'<p>'+esc(md)+'</p>';
  let h='',code=false,ul=false,ol=false,tbl=false,para=[];
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
    if(/^[-*_]{3,}$/.test(line.trim())){cl();h+='<hr>';continue}
    if(line.startsWith('#### ')){cl();h+='<h4>'+il(line.slice(5))+'</h4>';continue}
    if(line.startsWith('### ')){cl();h+='<h3>'+il(line.slice(4))+'</h3>';continue}
    if(line.startsWith('## ')){cl();h+='<h2>'+il(line.slice(3))+'</h2>';continue}
    if(line.startsWith('# ')){cl();h+='<h1>'+il(line.slice(2))+'</h1>';continue}
    if(line.startsWith('> ')){
      cl();
      const bq=[];
      while(i<lines.length&&lines[i].startsWith('> ')){bq.push(lines[i].slice(2));i++}
      i--;
      h+='<blockquote>'+parseMd(bq.join('\n'),(_depth||0)+1)+'</blockquote>';
      continue;
    }
    if(line.charAt(0)==='|'){
      if(!tbl){
        cl();h+='<table><thead><tr>';
        line.split('|').filter(c=>c.trim()).forEach(c=>{h+='<th>'+il(c.trim())+'</th>'});
        h+='</tr></thead><tbody>';
        tbl=true;
        if(i+1<lines.length&&/^\|[\s\-:|]+\|$/.test(lines[i+1]))i++;
        continue;
      }
      h+='<tr>';
      line.split('|').filter(c=>c.trim()).forEach(c=>{h+='<td>'+il(c.trim())+'</td>'});
      h+='</tr>';
      continue;
    }
    if(RE_UL.test(line)){
      if(!ul){cl();h+='<ul>';ul=true}
      h+='<li>'+il(line.replace(RE_UL,''))+'</li>';continue;
    }
    if(RE_OL.test(line)){
      if(!ol){cl();h+='<ol>';ol=true}
      h+='<li>'+il(line.replace(RE_OL,''))+'</li>';continue;
    }
    // Consecutive text lines join into one <p> (standard markdown soft wraps)
    para.push(line.endsWith('  ')?il(line.slice(0,-2))+'<br>':il(line));
    continue;
  }
  cl();if(code)h+='</code></pre>';
  return h;

  function cl(){
    if(para.length){h+='<p>'+para.join('\n')+'</p>';para=[]}
    if(ul){h+='</ul>';ul=false}
    if(ol){h+='</ol>';ol=false}
    if(tbl){h+='</tbody></table>';tbl=false}
  }
}

function il(t){
  if(!t)return '';
  return esc(t)
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/~~([^~]+)~~/g,'<del>$1</del>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,src)=>{
      return '<img src="'+src+'" alt="'+alt+'" loading="lazy" decoding="async">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,text,href)=>{
      return '<a href="'+href+'" target="_blank" rel="noopener noreferrer">'+text+'</a>';
    });
}

function esc(s){
  if(!s)return '';
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

const norm=_search.norm,normC=_search.normC,scoreWord=_search.scoreWord;
function scoreItem(w,q,tl){let fs=scoreWord(w,q);if(tl){const ts=scoreWord(w,tl)*1.5;if(ts>fs)fs=ts}return fs}

// Generic list filter — scores, sorts, flattens results when searching
function filterList(input,container){
  const q=norm(input.value.trim().toLowerCase());
  const words=q.split(/\s+/).filter(Boolean);
  const secs=[].slice.call(container.querySelectorAll('.link-sec'));
  const cards=[].slice.call(container.querySelectorAll('.pcard'));

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
    const liveId=container.id+'-live';
    const live=document.getElementById(liveId);
    if(live)live.textContent='';
    return;
  }

  // Score each card (title weighted 1.5x)
  const scored=[];
  cards.forEach(c=>{
    const t=c.getAttribute('data-q')||normC(c.textContent.toLowerCase());
    const tl=c.getAttribute('data-title');
    let total=0;
    const ok=words.every(w=>{
      const fs=scoreItem(w,t,tl);
      total+=fs;return fs>0;
    });
    if(ok)scored.push({el:c,score:total});
    else c.style.display='none';
  });

  scored.sort((a,b)=>b.score-a.score||(a.el.getAttribute('data-q')||'').localeCompare(b.el.getAttribute('data-q')||''));

  // Announce result count for screen readers
  const liveId=container.id+'-live';
  let live=document.getElementById(liveId);
  if(!live){live=document.createElement('div');live.id=liveId;live.className='sr-only';live.setAttribute('aria-live','polite');live.setAttribute('role','status');container.parentNode.insertBefore(live,container)}
  live.textContent=scored.length?scored.length+' result'+(scored.length===1?'':'s'):'No results';

  secs.forEach(s=>{s.style.display='none'});

  scored.forEach(s=>{
    s.el.style.display='';
    container.appendChild(s.el);
  });

  // Empty state
  let empty=container.querySelector('.search-empty');
  if(!scored.length){
    if(!empty){empty=mkEmpty('No results','empty search-empty');container.appendChild(empty)}
    empty.style.display='';
  }else if(empty){empty.style.display='none'}
}

function fmtDate(d,opts){
  if(!d)return '';
  const dt=new Date(d+'T12:00:00');
  if(isNaN(dt.getTime()))return '';
  return dt.toLocaleDateString('en-GB',opts||{day:'numeric',month:'long',year:'numeric'});
}

// Search wiring with debounce
function wireSearch(iid,cid){
  const i=$(iid),c=$(cid);
  if(!i||!c)return;
  let timer;
  function run(){
    filterList(i,c);
    setSearchX(i.parentNode,i.value);
  }
  i.addEventListener('input',()=>{
    clearTimeout(timer);
    setSearchX(i.parentNode,i.value);
    timer=setTimeout(run,80);
  });
  i.addEventListener('keydown',e=>{
    if(e.key==='Escape'){clearTimeout(timer);i.value='';run();i.blur()}
  });
  const x=i.parentNode.querySelector('.search-x');
  if(x)x.addEventListener('click',()=>{clearTimeout(timer);i.value='';run();i.focus()});
}
[['#psearch','#plist'],['#usearch','#ulist'],['#lsearch','#llist']].forEach(function(p){wireSearch(p[0],p[1])});

// Theme toggle (delegates to _base for data-theme, theme-color, localStorage)
const themeBtn=$('#theme-toggle');
const themeLabel=$('#theme-label');
function setThemeLabel(t){if(themeLabel)themeLabel.textContent='Theme: '+t[0].toUpperCase()+t.slice(1)}
function applyTheme(t){
  _base.setTheme(t);
  setThemeLabel(t);
  const ms=$('meta[name="color-scheme"]');if(ms)ms.content=t==='dark'?'dark':'light';
}
if(themeBtn){
  setThemeLabel(_base.curTheme());
  themeBtn.addEventListener('click',e=>{
    e.preventDefault();
    const cur=_base.curTheme();
    const next=_base.THEMES[(_base.THEMES.indexOf(cur)+1)%_base.THEMES.length];
    applyTheme(next);
  });
}
document.addEventListener('visibilitychange',()=>{
  if(document.hidden)return;
  setThemeLabel(_base.curTheme());
  const ms=$('meta[name="color-scheme"]');if(ms)ms.content=_base.curTheme()==='dark'?'dark':'light';
  document.querySelectorAll('.copy-btn.copied').forEach(b=>{
    clearTimeout(b._t1);clearTimeout(b._t2);
    b.classList.remove('copied');b.textContent='Copy';b.style.opacity='';
  });
},{passive:true});
window.addEventListener('storage',function(e){
  if(e.key==='theme'){
    const t=e.newValue||'light';
    if(t!==_base.curTheme())applyTheme(t);
  }
},{passive:true});

// Command palette
const cmdOverlay=document.createElement('div');cmdOverlay.className='cmd-overlay';cmdOverlay.setAttribute('aria-hidden','true');
const cmdPalette=document.createElement('div');cmdPalette.className='cmd-palette';cmdPalette.setAttribute('role','dialog');cmdPalette.setAttribute('aria-modal','true');cmdPalette.setAttribute('aria-label','Search');
const cmdInput=document.createElement('input');cmdInput.className='cmd-input';cmdInput.type='text';cmdInput.placeholder='Search';cmdInput.autocomplete='off';cmdInput.spellcheck=false;
const cmdX=document.createElement('button');cmdX.className='cmd-x';cmdX.setAttribute('aria-label','Clear search');
const cmdResults=document.createElement('div');cmdResults.className='cmd-results';cmdResults.setAttribute('aria-live','polite');
const cmdInputWrap=document.createElement('div');cmdInputWrap.className='cmd-input-wrap';
cmdInputWrap.appendChild(cmdInput);cmdInputWrap.appendChild(cmdX);
cmdPalette.appendChild(cmdInputWrap);cmdPalette.appendChild(cmdResults);cmdOverlay.appendChild(cmdPalette);
document.body.appendChild(cmdOverlay);

function mkModal(overlay){
  let prev=null,open=false;
  const m={
    get isOpen(){return open},
    open:function(focusEl){
      if(open)return;prev=document.activeElement;open=true;
      document.body.style.overflow='hidden';
      overlay.removeAttribute('aria-hidden');overlay.classList.add('open');
      if(focusEl)focusEl.focus();
    },
    close:function(){
      if(!open)return;open=false;
      document.body.style.overflow='';
      overlay.setAttribute('aria-hidden','true');overlay.classList.remove('open');
      if(prev)try{prev.focus()}catch(e){}prev=null;
    }
  };
  overlay.addEventListener('click',function(e){if(e.target===overlay)m.close()});
  return m;
}

const cmdModal=mkModal(cmdOverlay);
let cmdIdx=-1;
let cmdItems=null;

function openCmd(){
  if(cmdModal.isOpen)return;
  if(qrModal.isOpen)qrModal.close();
  cmdInput.value='';cmdX.style.display='none';cmdResults.textContent='';
  cmdIdx=-1;cmdItems=cmdBuildItems();
  cmdModal.open(cmdInput);cmdInput.select();
}

function closeCmd(){
  if(!cmdModal.isOpen)return;
  cmdItems=null;cmdInput.blur();cmdModal.close();
}

const qrOverlay=document.createElement('div');
qrOverlay.className='qr-overlay';
qrOverlay.tabIndex=-1;
qrOverlay.setAttribute('role','dialog');
qrOverlay.setAttribute('aria-modal','true');
qrOverlay.setAttribute('aria-label','QR Code');
qrOverlay.setAttribute('aria-hidden','true');
const qrCard=document.createElement('div');qrCard.className='qr-card';
const qrImg=document.createElement('img');qrImg.alt='QR code to saputra.co.uk';qrImg.width=23;qrImg.height=23;
const qrClose=document.createElement('button');qrClose.className='qr-close';qrClose.setAttribute('aria-label','Close');
const qrSvg=document.createElementNS('http://www.w3.org/2000/svg','svg');qrSvg.setAttribute('viewBox','0 0 24 24');qrSvg.setAttribute('fill','none');qrSvg.setAttribute('stroke','currentColor');qrSvg.setAttribute('stroke-width','2');qrSvg.setAttribute('stroke-linecap','round');
const qrL1=document.createElementNS('http://www.w3.org/2000/svg','line');qrL1.setAttribute('x1','6');qrL1.setAttribute('y1','6');qrL1.setAttribute('x2','18');qrL1.setAttribute('y2','18');
const qrL2=document.createElementNS('http://www.w3.org/2000/svg','line');qrL2.setAttribute('x1','18');qrL2.setAttribute('y1','6');qrL2.setAttribute('x2','6');qrL2.setAttribute('y2','18');
qrSvg.appendChild(qrL1);qrSvg.appendChild(qrL2);qrClose.appendChild(qrSvg);
qrClose.addEventListener('click',function(){closeQR()});
qrCard.appendChild(qrClose);qrCard.appendChild(qrImg);qrOverlay.appendChild(qrCard);document.body.appendChild(qrOverlay);

const qrModal=mkModal(qrOverlay);
function openQR(){
  if(qrModal.isOpen)return;
  if(cmdModal.isOpen)closeCmd();
  if(!qrImg.src)qrImg.src='/qr-homepage.png';
  qrModal.open(qrClose);
}
function closeQR(){qrModal.close()}
const nameCard=$('.name-card');
if(nameCard){
  nameCard.addEventListener('click',e=>{e.preventDefault();openQR()});
  nameCard.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();openQR()}});
}

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
  return items;
}

// Type priority: pages first, content items next
const cmdTypePri={Page:4,Project:3,Link:3,Post:3};

function cmdSearch(q){
  const words=norm(q.trim().toLowerCase()).split(/\s+/).filter(Boolean);
  if(!words.length)return [];
  const items=cmdItems||[];
  const scored=[];
  items.forEach(it=>{
    let total=0;
    const ok=words.every(w=>{
      const s=scoreItem(w,it.q,it.tl);
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
  return [].slice.call(active.querySelectorAll('.pcard'));
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

let _kbTick=false;
function kbAsync(dir){if(!_kbTick){_kbTick=true;requestAnimationFrame(function(){kbMove(dir);_kbTick=false})}}
document.addEventListener('mousemove',()=>{if(kbIdx>=0)kbClear(true)},{passive:true});

const tabPaths=['/','/projects','/updates','/links'];
function isPost(){return location.pathname.startsWith('/updates/')&&location.pathname.split('/').length>2}

document.addEventListener('keydown',e=>{
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    e.preventDefault();
    if(cmdModal.isOpen)closeCmd();else openCmd();
    return;
  }

  if(cmdModal.isOpen){
    if(e.key==='Escape'){closeCmd();return}
    if(e.key==='Tab'){
      const els=cmdPalette.querySelectorAll('input,button:not([style*="display:none"]):not([style*="display: none"])');
      const focusable=[].slice.call(els).filter(function(el){return el.offsetParent!==null});
      if(focusable.length){
        const first=focusable[0],last=focusable[focusable.length-1];
        if(e.shiftKey&&document.activeElement===first){e.preventDefault();last.focus()}
        else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first.focus()}
      }
    }
    return;
  }

  if(qrModal.isOpen){if(e.key==='Tab'){e.preventDefault();qrClose.focus();return}if(e.key==='Escape')closeQR();return}

  const tag=document.activeElement&&document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'){
    if(e.key==='Escape'){document.activeElement.blur();kbClear()}
    return;
  }

  if(e.metaKey||e.ctrlKey||e.altKey)return;

  const key=e.key;

  if(key>='1'&&key<='4'){
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

  if(key==='j'||key==='ArrowDown'){e.preventDefault();kbAsync(1);return}
  if(key==='k'||key==='ArrowUp'){e.preventDefault();kbAsync(-1);return}

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
ric(()=>{getProjects();getPosts();getLinks()});

})();
