(function(){'use strict';

const $=function(s){return document.querySelector(s)};
const $$=function(s){return document.querySelectorAll(s)};

// State
let posts=null;
let projects=null;
let links=null;
let postVer=0;
const validPages=['home','projects','posts','links'];
const titles={home:'Home',projects:'Projects',posts:'Posts',links:'Links'};
const emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');
const CHECK_SVG='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
const SVG_WRAP_OPEN='<svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">';
const SVG_WRAP_CLOSE='</svg>';
const RE_UL=/^[-*+] /;
const RE_OL=/^\d+[.)]\s/;
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
  // Redirect legacy /updates/ URLs to /posts/
  if(page==='updates'){
    const slug=parts.slice(1).join('/');
    history.replaceState(null,'','/posts'+(slug?'/'+slug:''));
    route();return;
  }
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




  if(page==='projects'){showProjects()}
  if(page==='links'){showLinks()}
  if(page==='posts'){
    let wrap=$('#usearch');
    if(wrap)wrap=wrap.parentNode;
    if(slug){if(wrap)wrap.style.display='none';showPost(slug)}
    else{const st=$('#posts .stitle');if(st)st.textContent='Posts';const ul=$('#ulist');if(ul&&ul.querySelector('.pcontent'))ul.replaceChildren();if(wrap)wrap.style.display='block';showList()}
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
  if(!page||validPages.indexOf(page)!==-1||page==='updates'){
    e.preventDefault();
    if(href===location.pathname&&(href==='/'||page==='home')){openCmd();return}
    if(href!==location.pathname)history.pushState(null,'',href);
    route();
  }
});

// Data loaders (SWR via shared/swr.js)
const DATA_V=4;
const getProjects=_swr.loader('/projects/projects.json?v='+DATA_V,d=>{projects=d;return d});
const getLinks=_swr.loader('/links/links.json?v='+DATA_V,d=>{links=d;return d});
const getPosts=_swr.loader('/posts/posts.json?v='+DATA_V,d=>{
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
'ClearView':'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
'Clip':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
'Clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'Countdown':'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
'Arbit':'<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
'CodeGen':'<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
'Iconic':'<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
'MockupGen':'<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
'ImageOpt':'<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>',
'Lorip':'<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
'Miele Laundry Guide':'<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
'NumGen':'<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
'PasswdGen':'<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
'Parsely':'<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
'ReSolve':'<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
'ThymeZone':'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
'Palit':'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
'Wrighter':'<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
'Project Convergence':'<circle cx="12" cy="16" r="1"/><rect x="3" y="10" width="18" height="12" rx="2"/><path d="M7 10V7a5 5 0 0 1 10 0v3"/>',
'Project Shifting Tides':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/>',
'Whisp':'<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>'
};

// Named icons — reusable SVG inner paths for posts and links, wrapped by mkIcon
const ICONS={
'activity':'<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
'alert':'<path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
'archive':'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
'award':'<path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/>',
'briefcase':'<path d="M16 20V4a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/><rect width="20" height="14" x="2" y="6" rx="2"/>',
'book':'<path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H19a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6.5a1 1 0 0 1 0-5H20"/>',
'book-open':'<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
'calendar':'<path d="M8 2v4"/><path d="M16 2v4"/><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M3 10h18"/>',
'camera':'<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
'chart-line':'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
'clapperboard':'<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
'cart':'<circle cx="8" cy="21" r="1"/><circle cx="19" cy="21" r="1"/><path d="M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12"/>',
'clipboard':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'cloud':'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
'code':'<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
'doc':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
'door':'<path d="M11 20H2"/><path d="M11 4.562v16.157a1 1 0 0 0 1.242.97L19 20V5.562a2 2 0 0 0-1.515-1.94l-4-1A2 2 0 0 0 11 4.561z"/><path d="M11 4H8a2 2 0 0 0-2 2v14"/><path d="M14 12h.01"/><path d="M22 20h-3"/>',
'download':'<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
'eye':'<path d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"/><circle cx="12" cy="12" r="3"/>',
'file':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
'file-text':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
'file-user':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M16 22a4 4 0 0 0-8 0"/><circle cx="12" cy="15" r="3"/>',
'flame':'<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
'gamepad':'<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
'gauge':'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
'graduation':'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
'globe':'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
'home':'<path d="M15 21v-8a1 1 0 0 0-1-1h-4a1 1 0 0 0-1 1v8"/><path d="M3 10a2 2 0 0 1 .709-1.528l7-6a2 2 0 0 1 2.582 0l7 6A2 2 0 0 1 21 10v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
'image':'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
'keyboard':'<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
'landmark':'<path d="M10 18v-7"/><path d="M11.12 2.198a2 2 0 0 1 1.76.006l7.866 3.847c.476.233.31.949-.22.949H3.474c-.53 0-.695-.716-.22-.949z"/><path d="M14 18v-7"/><path d="M18 18v-7"/><path d="M3 22h18"/><path d="M6 18v-7"/>',
'laptop':'<path d="M18 5a2 2 0 0 1 2 2v8.526a2 2 0 0 0 .212.897l1.068 2.127a1 1 0 0 1-.9 1.45H3.62a1 1 0 0 1-.9-1.45l1.068-2.127A2 2 0 0 0 4 15.526V7a2 2 0 0 1 2-2z"/><path d="M20.054 15.987H3.946"/>',
'layers':'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
'layout':'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
'mail':'<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
'map':'<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
'megaphone':'<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
'message':'<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
'mic':'<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
'monitor-play':'<path d="M15.033 9.44a.647.647 0 0 1 0 1.12l-4.065 2.352a.645.645 0 0 1-.968-.56V7.648a.645.645 0 0 1 .967-.56z"/><path d="M12 17v4"/><path d="M8 21h8"/><rect x="2" y="3" width="20" height="14" rx="2"/>',
'music':'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
'newspaper':'<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>',
'notebook':'<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
'pen':'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
'phone':'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
'plane':'<path d="M17.8 19.2 16 11l3.5-3.5C21 6 21.5 4 21 3c-1-.5-3 0-4.5 1.5L13 8 4.8 6.2c-.5-.1-.9.1-1.1.5l-.3.5c-.2.5-.1 1 .3 1.3L9 12l-2 3H4l-1 1 3 2 2 3 1-1v-3l3-2 3.5 5.3c.3.4.8.5 1.3.3l.5-.2c.4-.3.6-.7.5-1.2z"/>',
'post':'<path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"/>',
'presentation':'<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
'printer':'<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><path d="M6 9V3a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v6"/><rect x="6" y="14" width="12" height="8" rx="1"/>',
'rocket':'<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
'scale':'<path d="M12 3v18"/><path d="m19 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M3 7h1a17 17 0 0 0 8-2 17 17 0 0 0 8 2h1"/><path d="m5 8 3 8a5 5 0 0 1-6 0zV7"/><path d="M7 21h10"/>',
'school':'<path d="M21.42 10.922a1 1 0 0 0-.019-1.838L12.83 5.18a2 2 0 0 0-1.66 0L2.6 9.08a1 1 0 0 0 0 1.832l8.57 3.908a2 2 0 0 0 1.66 0z"/><path d="M22 10v6"/><path d="M6 12.5V16a6 3 0 0 0 12 0v-3.5"/>',
'search':'<path d="m21 21-4.34-4.34"/><circle cx="11" cy="11" r="8"/>',
'shield':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
'sparkles':'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
'spell-check':'<path d="m6 16 6-12 6 12"/><path d="M8 12h8"/><path d="m16 20 2 2 4-4"/>',
'table':'<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
'tag':'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
'terminal':'<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
'trending':'<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
'utensils':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 0 0 2-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 0 0-5 5v6c0 1.1.9 2 2 2h3Zm0 0v7"/>',
'video':'<path d="m16 13 5.223 3.482a.5.5 0 0 0 .777-.416V7.87a.5.5 0 0 0-.752-.432L16 10.5"/><rect x="2" y="6" width="14" height="12" rx="2"/>',
'wand':'<path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/>',
'wifi':'<path d="M12 20h.01"/><path d="M2 8.82a15 15 0 0 1 20 0"/><path d="M5 12.859a10 10 0 0 1 14 0"/><path d="M8.5 16.429a5 5 0 0 1 7 0"/>'
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
      const a=document.createElement('a');a.className='pcard'+(x.featured?' featured':'');
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
  // Always register onFresh so SWR revalidation updates the UI on every visit
  cfg.get.onFresh=function(d){
    kbClear();
    el.style.opacity='0';
    setTimeout(function(){el._saved=null;renderCards(cfg,el,sw,d);el.style.opacity=''},150);
  };
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
  href:x=>'/posts/'+(x.slug||x.file.replace('.md','')),title:x=>x.title,sub:x=>fmtDate(x.date),
  icon:x=>ICONS[x.icon]||ICONS['post'],q:x=>(x.title+' '+x.date).toLowerCase()})}

// Render single post — splits on <hr> into multi-card layout
// innerHTML usage: Safe — content is parsed from first-party .md files
// committed by the site owner, not user input. Same-origin trusted content.
function showPost(slug){
  const el=$('#ulist');
  const stitle=$('#posts .stitle');
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
  // Resolve slug to filename: check posts for custom slug, fallback to slug.md
  var mdFile=slug+'.md';
  if(posts)posts.forEach(function(p){if(p.slug===slug||p.file.replace('.md','')===slug)mdFile=p.file});
  _swr('/posts/'+encodeURIComponent(mdFile),{
    parse:function(md){try{return parseMd(md)}catch(e){console.error('Parse error:',e);return'<p>Unable to render this post.</p>'}},
    key:'swr_post_'+slug,
    onFresh:function(html){
      el.style.opacity='0';
      setTimeout(function(){el.replaceChildren();render(html);el.style.opacity=''},150);
    }
  }).then(function(html){
    render(html);
  }).catch(function(e){
    if(ver!==postVer)return;
    console.error('Post load failed:',slug,e);
    el.appendChild(mkEmpty('Unable to load this post. Please check your connection and try again.'));
  });
}

// Markdown parser — Obsidian-compatible, processes first-party .md files only
// Supports: headings (h1-h6), paragraphs (soft wrap), line breaks (trailing  ),
// bold, italic, strikethrough, highlight, inline code, code blocks, links, images,
// blockquotes (recursive), unordered/ordered/task lists, tables, horizontal rules,
// backslash escaping. Graceful fallback on malformed input.
function parseMd(md,_depth){
  if(!md||typeof md!=='string')return '';
  if(!_depth)md=md.replace(/^---[\s\S]*?---\n?/,'');
  if((_depth||0)>4)return'<p>'+esc(md)+'</p>';
  let h='',code=false,ul=false,ol=false,tbl=false,para=[];
  // Track nested list depth: stack of 'ul'|'ol'
  const listStack=[];
  const lines=md.split('\n');
  for(let i=0;i<lines.length;i++){
    const line=lines[i];
    // Code blocks (``` or ~~~)
    if(/^(`{3,}|~{3,})/.test(line)){
      if(code){h+='</code></pre>';code=false}
      else{cl();h+='<pre><code>';code=true}
      continue;
    }
    if(code){h+=esc(line)+'\n';continue}
    if(!line.trim()){cl();continue}
    // Horizontal rules: 3+ of same char (-, *, _), optionally spaced
    if(/^([-*_])(\s*\1){2,}\s*$/.test(line.trim())){cl();h+='<hr>';continue}
    // Headings h1-h6
    const hm=line.match(/^(#{1,6}) (.+)/);
    if(hm){cl();h+='<h'+hm[1].length+'>'+il(hm[2])+'</h'+hm[1].length+'>';continue}
    // Blockquotes (recursive)
    if(line.startsWith('> ')||line==='>'){
      cl();
      const bq=[];
      while(i<lines.length&&(lines[i].startsWith('> ')||lines[i]==='>')){
        bq.push(lines[i]==='>'?'':lines[i].slice(2));i++}
      i--;
      h+='<blockquote>'+parseMd(bq.join('\n'),(_depth||0)+1)+'</blockquote>';
      continue;
    }
    // Tables
    if(line.charAt(0)==='|'){
      if(!tbl){
        cl();h+='<table><thead><tr>';
        line.split('|').filter(c=>c.trim()).forEach(c=>{h+='<th>'+il(c.trim())+'</th>'});
        h+='</tr></thead><tbody>';
        tbl=true;
        if(i+1<lines.length&&/^[\s|:\-]+$/.test(lines[i+1]))i++;
        continue;
      }
      h+='<tr>';
      line.split('|').filter(c=>c.trim()).forEach(c=>{h+='<td>'+il(c.trim())+'</td>'});
      h+='</tr>';
      continue;
    }
    // Task lists: - [ ] or - [x]
    const tm=line.match(/^(\s*)([-*+]) \[([ xX])\] (.*)$/);
    if(tm){
      const indent=tm[1].length;
      const checked=tm[3]!==' ';
      if(!ul){cl();h+='<ul class="task-list">';ul=true}
      h+='<li class="task-item'+(checked?' checked':'')+'"><input type="checkbox" disabled'+(checked?' checked':'')+'>'+il(tm[4])+'</li>';
      continue;
    }
    // Unordered lists (with nesting via indentation)
    const ulm=line.match(/^(\s*)([-*+]) (.*)$/);
    if(ulm&&!(/^[-*_]{3,}$/.test(line.trim()))){
      if(!ul){cl();h+='<ul>';ul=true}
      h+='<li>'+il(ulm[3])+'</li>';continue;
    }
    // Ordered lists
    const olm=line.match(/^(\s*)\d+[.)]\s(.*)$/);
    if(olm){
      if(!ol){cl();h+='<ol>';ol=true}
      h+='<li>'+il(olm[2])+'</li>';continue;
    }
    // Paragraph: consecutive text lines join (standard markdown soft wraps)
    para.push(line.endsWith('  ')?il(line.slice(0,-2))+'<br>':il(line));
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

// Inline formatting — order matters: escape first, then code, then overlapping patterns
function il(t){
  if(!t)return '';
  // Backslash escaping: \X → PUA placeholder, survives esc() and regex, restored at end
  var esc_slots=[];
  t=t.replace(/\\([\\*_#~`|=\[\]()>!-])/g,function(_,c){esc_slots.push(c);return'\uE000'+(esc_slots.length-1)+'\uE001'});
  t=esc(t);
  return t
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/~~([^~]+)~~/g,'<del>$1</del>')
    .replace(/==([^=]+)==/g,'<mark>$1</mark>')
    .replace(/\*\*\*([^*]+)\*\*\*/g,'<strong><em>$1</em></strong>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,(_,alt,src)=>{
      return '<img src="'+src+'" alt="'+alt+'" loading="lazy" decoding="async">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,text,href)=>{
      return '<a href="'+href+'" target="_blank" rel="noopener noreferrer">'+text+'</a>';
    })
    .replace(/\uE000(\d+)\uE001/g,function(_,idx){var c=esc_slots[+idx];return c==='&'?'&amp;':c==='<'?'&lt;':c==='>'?'&gt;':c==='"'?'&quot;':c});
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
      history.pushState(null,'','/posts/'+(x.slug||x.file.replace('.md','')));route();
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

const tabPaths=['/','/projects','/posts','/links'];
function isPost(){return location.pathname.startsWith('/posts/')&&location.pathname.split('/').length>2}

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
    if(isPost()){history.pushState(null,'','/posts');route();return}
  }

  if(key==='Backspace'){
    if(isPost()){history.pushState(null,'','/posts');route();return}
  }
});

// Init
window.addEventListener('popstate',()=>{closeCmd();closeQR();kbClear();route()});
route();

// Prefetch all data during idle time so tab switches are instant
const ric=window.requestIdleCallback||(cb=>{setTimeout(cb,200)});
ric(()=>{getProjects();getPosts();getLinks()});

})();
