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
function mailtoUrl(t){return 'mailto:duke@saputra.co.uk?subject='+encodeURIComponent('Inquiry: '+t)+'&body='+emailBody}

// Handle 404.html redirect (validate path is relative to prevent cross-origin crash)
const redir=new URLSearchParams(location.search).get('p');
const cgRedir=redir&&redir.match(/^\/codegen\/([^?#]+)/);
if(cgRedir){location.replace('/codegen/#'+encodeURIComponent(cgRedir[1].replace(/\/+$/,'')))}
else if(redir){try{if(redir.startsWith('/')&&!redir.startsWith('//'))history.replaceState(null,'',redir);else history.replaceState(null,'','/')}catch(e){history.replaceState(null,'','/')}}

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
const DATA_V=18;
const getProjects=_swr.loader('/projects/projects.json?v='+DATA_V,d=>{projects=d;return d});
const getLinks=_swr.loader('/links/links.json?v='+DATA_V,d=>{links=d;return d});
const getPosts=_swr.loader('/posts/posts.json?v='+DATA_V,d=>{
  d.sort((a,b)=>b.date>a.date?1:b.date<a.date?-1:a.title.localeCompare(b.title));
  posts=d;return d;
});

const projectCategories=['Flagship Projects','Image Tools','Video Tools','Text Tools','Time Tools','Generators','Utilities','Miscellaneous','In Development','Archive'];
const linkCategories=['Development','Cloud & Domains','Security & Network','Media & Tools','AI','Productivity','Reference','Visa','Everyday','Games & Fun','Social Media'];

// Chevron SVG for card arrows
const CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

// Project icons — hardcoded SVGs keyed by title, safe for innerHTML
const PROJECT_ICONS={
'menuva (Retired)':'<path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M18 15v7"/>',
'Caption':'<rect width="18" height="14" x="3" y="5" rx="2" ry="2"/><path d="M7 15h4M15 15h2M7 11h2M13 11h4"/>',
'Capsule':'<rect x="2" y="7" width="20" height="10" rx="5"/><path d="M8 12h8"/>',
'CaseConverter':'<path d="m15 16 2.536-7.328a1.02 1.02 1 0 1 1.928 0L22 16"/><path d="M15.697 14h5.606"/><path d="m2 16 4.039-9.69a.5.5 0 0 1 .923 0L11 16"/><path d="M3.304 13h6.392"/>',
'ClearView':'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
'Clip':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><path d="M12 11h4"/><path d="M12 16h4"/><path d="M8 11h.01"/><path d="M8 16h.01"/>',
'Clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'Countdown':'<path d="M5 22h14"/><path d="M5 2h14"/><path d="M17 22v-4.172a2 2 0 0 0-.586-1.414L12 12l-4.414 4.414A2 2 0 0 0 7 17.828V22"/><path d="M7 2v4.172a2 2 0 0 0 .586 1.414L12 12l4.414-4.414A2 2 0 0 0 17 6.172V2"/>',
'Diffy':'<circle cx="5" cy="12" r="2"/><circle cx="19" cy="12" r="2"/><path d="M7 12h10"/><path d="M14 9l3 3-3 3"/>',
'Arbit':'<rect width="12" height="12" x="2" y="10" rx="2" ry="2"/><path d="m17.92 14 3.5-3.5a2.24 2.24 0 0 0 0-3l-5-4.92a2.24 2.24 0 0 0-3 0L10 6"/><path d="M6 18h.01"/><path d="M10 14h.01"/><path d="M15 6h.01"/><path d="M18 9h.01"/>',
'ASCIIverse':'<path d="M12 2l8 5v10l-8 5-8-5V7z"/><path d="M12 22V12M4 7l8 5 8-5"/>',
'CodeGen':'<rect width="5" height="5" x="3" y="3" rx="1"/><rect width="5" height="5" x="16" y="3" rx="1"/><rect width="5" height="5" x="3" y="16" rx="1"/><path d="M21 16h-3a2 2 0 0 0-2 2v3"/><path d="M21 21v.01"/><path d="M12 7v3a2 2 0 0 1-2 2H7"/><path d="M3 12h.01"/><path d="M12 3h.01"/><path d="M12 16v.01"/><path d="M16 12h1"/><path d="M21 12v.01"/><path d="M12 21v-1"/>',
'Iconic':'<path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/><circle cx="12" cy="12" r="3"/><path d="m16 16-1.9-1.9"/>',
'MockupGen':'<path d="M18 8V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h8"/><path d="M10 19v-3.96 3.15"/><path d="M7 19h5"/><rect width="6" height="10" x="16" y="12" rx="2"/>',
'ImageOpt':'<path d="M10.3 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v10l-3.1-3.1a2 2 0 0 0-2.814.014L6 21"/><path d="m14 19 3 3v-5.5"/><path d="m17 22 3-3"/><circle cx="9" cy="9" r="2"/>',
'Lorip':'<path d="M13 4v16"/><path d="M17 4v16"/><path d="M19 4H9.5a4.5 4.5 0 0 0 0 9H13"/>',
'FP16a':'<path d="M10 17V9.5a1 1 0 0 1 5 0"/><path d="M4 3a1 1 0 0 1 1-1 1.3 1.3 0 0 1 .7.2l.933.6a1.3 1.3 0 0 0 1.4 0l.934-.6a1.3 1.3 0 0 1 1.4 0l.933.6a1.3 1.3 0 0 0 1.4 0l.933-.6a1.3 1.3 0 0 1 1.4 0l.934.6a1.3 1.3 0 0 0 1.4 0l.933-.6A1.3 1.3 0 0 1 19 2a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1 1.3 1.3 0 0 1-.7-.2l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.934.6a1.3 1.3 0 0 1-1.4 0l-.933-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-1.4 0l-.934-.6a1.3 1.3 0 0 0-1.4 0l-.933.6a1.3 1.3 0 0 1-.7.2 1 1 0 0 1-1-1z"/><path d="M8 13h5"/><path d="M8 17h7"/>',
'Miele Laundry Guide':'<path d="M3 6h3"/><path d="M17 6h.01"/><rect width="18" height="20" x="3" y="2" rx="2"/><circle cx="12" cy="13" r="5"/><path d="M12 18a2.5 2.5 0 0 0 0-5 2.5 2.5 0 0 1 0-5"/>',
'NumGen':'<line x1="4" x2="20" y1="9" y2="9"/><line x1="4" x2="20" y1="15" y2="15"/><line x1="10" x2="8" y1="3" y2="21"/><line x1="16" x2="14" y1="3" y2="21"/>',
'PasswdGen':'<path d="M2.586 17.414A2 2 0 0 0 2 18.828V21a1 1 0 0 0 1 1h3a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h1a1 1 0 0 0 1-1v-1a1 1 0 0 1 1-1h.172a2 2 0 0 0 1.414-.586l.814-.814a6.5 6.5 0 1 0-4-4z"/><circle cx="16.5" cy="7.5" r=".5" fill="currentColor"/>',
'Parsely':'<path d="M10 20a1 1 0 0 0 .553.895l2 1A1 1 0 0 0 14 21v-7a2 2 0 0 1 .517-1.341L21.74 4.67A1 1 0 0 0 21 3H3a1 1 0 0 0-.742 1.67l7.225 7.989A2 2 0 0 1 10 14z"/>',
'ReSolve':'<circle cx="6" cy="19" r="3"/><path d="M9 19h8.5a3.5 3.5 0 0 0 0-7h-11a3.5 3.5 0 0 1 0-7H15"/><circle cx="18" cy="5" r="3"/>',
'ThymeZone':'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
'Palit':'<path d="M12 22a1 1 0 0 1 0-20 10 9 0 0 1 10 9 5 5 0 0 1-5 5h-2.25a1.75 1.75 0 0 0-1.4 2.8l.3.4a1.75 1.75 0 0 1-1.4 2.8z"/><circle cx="13.5" cy="6.5" r=".5" fill="currentColor"/><circle cx="17.5" cy="10.5" r=".5" fill="currentColor"/><circle cx="6.5" cy="12.5" r=".5" fill="currentColor"/><circle cx="8.5" cy="7.5" r=".5" fill="currentColor"/>',
'Pomo':'<line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/>',
'Wrighter':'<path d="M13 21h8"/><path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
'Whisp':'<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>'
};

// Named icons — reusable SVG inner paths for posts and links, wrapped by mkIcon
const ICONS={
'activity':'<path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/>',
'archive':'<rect width="20" height="5" x="2" y="3" rx="1"/><path d="M4 8v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8"/><path d="M10 12h4"/>',
'book-open':'<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
'camera':'<path d="M13.997 4a2 2 0 0 1 1.76 1.05l.486.9A2 2 0 0 0 18.003 7H20a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h1.997a2 2 0 0 0 1.759-1.048l.489-.904A2 2 0 0 1 10.004 4z"/><circle cx="12" cy="13" r="3"/>',
'chart-line':'<path d="M3 3v16a2 2 0 0 0 2 2h16"/><path d="m19 9-5 5-4-4-3 3"/>',
'clapperboard':'<path d="m12.296 3.464 3.02 3.956"/><path d="M20.2 6 3 11l-.9-2.4c-.3-1.1.3-2.2 1.3-2.5l13.5-4c1.1-.3 2.2.3 2.5 1.3z"/><path d="M3 11h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="m6.18 5.276 3.1 3.899"/>',
'clipboard':'<rect width="8" height="4" x="8" y="2" rx="1" ry="1"/><path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>',
'clock':'<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
'cloud':'<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
'code':'<path d="m16 18 6-6-6-6"/><path d="m8 6-6 6 6 6"/>',
'doc':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
'download':'<path d="M12 15V3"/><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><path d="m7 10 5 5 5-5"/>',
'file':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/>',
'file-text':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10 9H8"/><path d="M16 13H8"/><path d="M16 17H8"/>',
'file-user':'<path d="M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M16 22a4 4 0 0 0-8 0"/><circle cx="12" cy="15" r="3"/>',
'flame':'<path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/>',
'gamepad':'<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
'gauge':'<path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/>',
'globe':'<circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>',
'id-card':'<path d="M16 10h2"/><path d="M16 14h2"/><path d="M6.17 15a3 3 0 0 1 5.66 0"/><circle cx="9" cy="11" r="2"/><rect x="2" y="5" width="20" height="14" rx="2"/>',
'image':'<rect width="18" height="18" x="3" y="3" rx="2" ry="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"/>',
'keyboard':'<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
'layers':'<path d="M12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83z"/><path d="M2 12a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 12"/><path d="M2 17a1 1 0 0 0 .58.91l8.6 3.91a2 2 0 0 0 1.65 0l8.58-3.9A1 1 0 0 0 22 17"/>',
'layout':'<rect width="7" height="9" x="3" y="3" rx="1"/><rect width="7" height="5" x="14" y="3" rx="1"/><rect width="7" height="9" x="14" y="12" rx="1"/><rect width="7" height="5" x="3" y="16" rx="1"/>',
'mail':'<path d="m22 7-8.991 5.727a2 2 0 0 1-2.009 0L2 7"/><rect x="2" y="4" width="20" height="16" rx="2"/>',
'map':'<path d="M20 10c0 4.993-5.539 10.193-7.399 11.799a1 1 0 0 1-1.202 0C9.539 20.193 4 14.993 4 10a8 8 0 0 1 16 0"/><circle cx="12" cy="10" r="3"/>',
'megaphone':'<path d="M11 6a13 13 0 0 0 8.4-2.8A1 1 0 0 1 21 4v12a1 1 0 0 1-1.6.8A13 13 0 0 0 11 14H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2z"/><path d="M6 14a12 12 0 0 0 2.4 7.2 2 2 0 0 0 3.2-2.4A8 8 0 0 1 10 14"/><path d="M8 6v8"/>',
'message':'<path d="M22 17a2 2 0 0 1-2 2H6.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 2 21.286V5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2z"/>',
'mic':'<path d="M12 19v3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><rect x="9" y="2" width="6" height="13" rx="3"/>',
'music':'<path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/>',
'newspaper':'<path d="M15 18h-5"/><path d="M18 14h-8"/><path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-4 0v-9a2 2 0 0 1 2-2h2"/><rect width="8" height="4" x="10" y="6" rx="1"/>',
'notebook':'<path d="M13.4 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-7.4"/><path d="M2 6h4"/><path d="M2 10h4"/><path d="M2 14h4"/><path d="M2 18h4"/><path d="M21.378 5.626a1 1 0 1 0-3.004-3.004l-5.01 5.012a2 2 0 0 0-.506.854l-.837 2.87a.5.5 0 0 0 .62.62l2.87-.837a2 2 0 0 0 .854-.506z"/>',
'pen':'<path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z"/>',
'phone':'<rect width="14" height="20" x="5" y="2" rx="2" ry="2"/><path d="M12 18h.01"/>',
'post':'<path d="M12.659 22H18a2 2 0 0 0 2-2V8a2.4 2.4 0 0 0-.706-1.706l-3.588-3.588A2.4 2.4 0 0 0 14 2H6a2 2 0 0 0-2 2v9.34"/><path d="M14 2v5a1 1 0 0 0 1 1h5"/><path d="M10.378 12.622a1 1 0 0 1 3 3.003L8.36 20.637a2 2 0 0 1-.854.506l-2.867.837a.5.5 0 0 1-.62-.62l.836-2.869a2 2 0 0 1 .506-.853z"/>',
'presentation':'<path d="M2 3h20"/><path d="M21 3v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V3"/><path d="m7 21 5-5 5 5"/>',
'rocket':'<path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/>',
'shield':'<path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/><path d="m9 12 2 2 4-4"/>',
'sparkles':'<path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/>',
'stamp':'<path d="M14 13V8.5C14 7 15 7 15 5a3 3 0 0 0-6 0c0 2 1 2 1 3.5V13"/><path d="M20 15.5a2.5 2.5 0 0 0-2.5-2.5h-11A2.5 2.5 0 0 0 4 15.5V17a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1z"/><path d="M5 22h14"/>',
'table':'<path d="M9 3H5a2 2 0 0 0-2 2v4m6-6h10a2 2 0 0 1 2 2v4M9 3v18m0 0h10a2 2 0 0 0 2-2V9M9 21H5a2 2 0 0 1-2-2V9m0 0h18"/>',
'tag':'<path d="M12.586 2.586A2 2 0 0 0 11.172 2H4a2 2 0 0 0-2 2v7.172a2 2 0 0 0 .586 1.414l8.704 8.704a2.426 2.426 0 0 0 3.42 0l6.58-6.58a2.426 2.426 0 0 0 0-3.42z"/><circle cx="7.5" cy="7.5" r=".5" fill="currentColor"/>',
'terminal':'<path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/>',
'trending':'<path d="M16 7h6v6"/><path d="m22 7-8.5 8.5-5-5L2 17"/>',
'users':'<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><path d="M16 3.128a4 4 0 0 1 0 7.744"/><path d="M22 21v-2a4 4 0 0 0-3-3.87"/><circle cx="9" cy="7" r="4"/>',
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
qrCard.appendChild(qrImg);qrOverlay.appendChild(qrCard);document.body.appendChild(qrOverlay);

const qrModal=mkModal(qrOverlay);
function openQR(){
  if(qrModal.isOpen)return;
  if(cmdModal.isOpen)closeCmd();
  if(!qrImg.src)qrImg.src='/qr-homepage.png';
  qrModal.open(qrOverlay);
}
function closeQR(){qrModal.close()}
// Home coin: yaw th spins and always lands on a face, pitch ph only tips and springs back. th'' = -a(w)*w - K*sin(2th):
// friction light while spinning fast and heavy near rest, plus a pull toward the nearest face, so multiples of pi are
// the only stable rests and it never stops edge-on. Substepped at 120 Hz so any frame rate lands the same way.
// tests/test-coin.js holds it to that.
function coinStep(c,dt){
  const K=45,A_LO=.5,A_HI=12,W0=4,PK=160,PC=14;
  for(let n=Math.ceil(dt*120),h=dt/n;n>0;n--){
    const r=c.w/W0,a=A_LO+(A_HI-A_LO)*Math.exp(-r*r);
    c.w+=(-a*c.w-K*Math.sin(2*c.th))*h;c.th+=c.w*h;
    c.pv+=(-PK*c.ph-PC*c.pv)*h;c.ph+=c.pv*h;
  }
}
function coinAtRest(c){
  const e=c.th-Math.round(c.th/Math.PI)*Math.PI;
  return Math.abs(e)<.002&&Math.abs(c.w)<.02&&Math.abs(c.ph)<.002&&Math.abs(c.pv)<.02;
}
const photo=$('.photo'),coin=photo&&photo.querySelector('.coin');
if(photo){
  const c={th:0,w:0,ph:0,pv:0},P_MAX=.35,W_MAX=30,still=matchMedia('(prefers-reduced-motion: reduce)');
  let drag=null,moved=false,raf=0,last=0;
  const draw=()=>{coin.style.transform='rotateX('+c.ph+'rad) rotateY('+c.th+'rad)'};
  function frame(ts){
    raf=0;coinStep(c,Math.min(.05,last?(ts-last)/1000:1/60));last=ts;
    if(coinAtRest(c)){c.th=Math.round(c.th/Math.PI)%2?Math.PI:0;c.w=c.ph=c.pv=0;last=0}
    else raf=requestAnimationFrame(frame);
    draw();
  }
  const run=()=>{if(!raf)raf=requestAnimationFrame(frame)};
  // A native button clicks on pointerup even after a long drag; only a tap (or Enter/Space) opens the QR.
  photo.addEventListener('click',e=>{if(moved){e.preventDefault();return}openQR()});
  photo.addEventListener('pointerdown',e=>{
    if(e.button)return;
    // Grabbing stops the coin, so a tap on a spinning coin is still a tap.
    if(raf){cancelAnimationFrame(raf);raf=0;last=0}
    c.w=c.pv=0;moved=false;
    drag={id:e.pointerId,x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,t:e.timeStamp,th:c.th,ph:c.ph,vx:0,vy:0};
  });
  photo.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id)return;
    if(!moved){
      if(Math.hypot(e.clientX-drag.x0,e.clientY-drag.y0)<(e.pointerType==='touch'?8:4))return;
      moved=true;try{photo.setPointerCapture(e.pointerId)}catch(_){}
    }
    // The face follows the pointer: a coin-width drag is half a turn, and vertical tips at half that rate into a soft limit.
    const k=Math.PI/photo.offsetWidth,dt=Math.max(8,e.timeStamp-drag.t)/1000;
    c.th=drag.th+(e.clientX-drag.x0)*k;
    c.ph=P_MAX*Math.tanh((drag.ph-(e.clientY-drag.y0)*k/2)/P_MAX);
    drag.vx=(drag.vx+(e.clientX-drag.x)*k/dt)/2;
    drag.vy=(drag.vy-(e.clientY-drag.y)*k/2/dt)/2;
    drag.x=e.clientX;drag.y=e.clientY;drag.t=e.timeStamp;
    draw();
  });
  function release(e){
    if(!drag||e.pointerId!==drag.id)return;
    const d=drag;drag=null;
    // A pointer that rested before lifting throws nothing, and a cancelled gesture belongs to the browser's scroll.
    if(moved&&e.type==='pointerup'&&e.timeStamp-d.t<80&&!still.matches){
      c.w=Math.max(-W_MAX,Math.min(W_MAX,d.vx));c.pv=Math.max(-6,Math.min(6,d.vy));
    }
    if(moved)setTimeout(()=>{moved=false});
    run();
  }
  photo.addEventListener('pointerup',release);
  photo.addEventListener('pointercancel',release);
}

/*ENGINE-START*/
// DS monogram engine: letterforms, point cloud, grid bound. Pure (no DOM); tests/test-ds-monogram.js extracts it verbatim.
const DSE=(()=>{
const TAU=Math.PI*2,STEP=0.02;
function line(o,x0,y0,x1,y1){const n=Math.max(1,Math.ceil(Math.hypot(x1-x0,y1-y0)/STEP));for(let i=1;i<=n;i++){const t=i/n;o.push(x0+(x1-x0)*t,y0+(y1-y0)*t)}}
function bez(o,x0,y0,x1,y1,x2,y2,x3,y3){const L=Math.hypot(x1-x0,y1-y0)+Math.hypot(x2-x1,y2-y1)+Math.hypot(x3-x2,y3-y2),n=Math.max(2,Math.ceil(L/STEP));for(let i=1;i<=n;i++){const t=i/n,u=1-t,a=u*u*u,b=3*u*u*t,c=3*u*t*t,d=t*t*t;o.push(a*x0+b*x1+c*x2+d*x3,a*y0+b*y1+c*y2+d*y3)}}
function arc(o,cx,cy,r,a0,a1){const n=Math.max(2,Math.ceil(Math.abs(a1-a0)*r/STEP));for(let i=1;i<=n;i++){const a=a0+(a1-a0)*i/n;o.push(cx+r*Math.cos(a),cy+r*Math.sin(a))}}
// D: stem on x=0 from y=-1 to 1, flats of length f, bowl out to x=w as two cubics (k = handle fraction, 0.5523 is a circle).
// Closed, starting at the stem foot so the pen goes up the stem, across the top and round the bowl.
function letterD(w,f,k){const o=[0,-1];line(o,0,-1,0,1);line(o,0,1,f,1);bez(o,f,1,f+k*(w-f),1,w,k,w,0);bez(o,w,0,w,-k,f+k*(w-f),-1,f,-1);line(o,f,-1,0,-1);return{pts:o,closed:true}}
// S: an upper circle (r1) and a larger lower one (r2) spanning top..-top, joined by their internal tangent, which is the spine.
// Terminals at angles t1 (upper) and t4 (lower). Open, from the upper terminal: the pen draws it like a signature.
function letterS(r1,r2,top,t1,t4){
  const c1y=top-r1,c2y=-top+r2,al=Math.acos((r1+r2)/(c1y-c2y)),hx=Math.cos(al),hy=-Math.sin(al);
  const p2x=r1*hy,p2y=c1y-r1*hx,p3x=-r2*hy,p3y=c2y+r2*hx;
  let th2=Math.atan2(-hx,hy),th3=Math.atan2(hx,-hy);if(th2<t1)th2+=TAU;if(t4>th3)t4-=TAU;
  const o=[r1*Math.cos(t1),c1y+r1*Math.sin(t1)];arc(o,0,c1y,r1,t1,th2);line(o,p2x,p2y,p3x,p3y);arc(o,0,c2y,r2,th3,t4);
  return{pts:o,closed:false};
}
// Places the S after the D with an ink gap and centers the pair's ink box on x=0.
function layout(sp){
  const rD=sp.r,rS=sp.r*sp.sRatio,D=letterD(sp.dW,sp.dF,sp.dK),S=letterS(sp.sR1,sp.sR2,sp.sTop,sp.sT1,sp.sT4);
  D.r=rD;S.r=rS;
  const xS=sp.dW+rD+sp.gap+sp.sR2+rS,cx=(-rD+xS+sp.sR2+rS)/2;
  for(let i=0;i<S.pts.length;i+=2)S.pts[i]+=xS-cx;for(let i=0;i<D.pts.length;i+=2)D.pts[i]-=cx;
  return[D,S];
}
// Binned segment field: nearest segment to (x,y), optionally skipping one stroke's stations near a given one.
function field(strokes){
  const seg=[],meta=[];let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
  strokes.forEach((L,si)=>{const p=L.pts,n=p.length/2,m=L.closed?n:n-1;for(let i=0;i<m;i++){const j=(i+1)%n;seg.push(p[2*i],p[2*i+1],p[2*j],p[2*j+1]);meta.push(si,i);
    minx=Math.min(minx,p[2*i]);maxx=Math.max(maxx,p[2*i]);miny=Math.min(miny,p[2*i+1]);maxy=Math.max(maxy,p[2*i+1])}});
  // Bin side must cover the longest query radius (a stroke radius plus a sample step), so a 3x3 block always holds the answer.
  const BS=0.25;minx-=BS;miny-=BS;maxx+=BS;maxy+=BS;
  const nx=Math.ceil((maxx-minx)/BS),ny=Math.ceil((maxy-miny)/BS),bins=new Array(nx*ny);
  for(let i=0;i<bins.length;i++)bins[i]=[];
  for(let s=0;s<seg.length/4;s++){const x0=Math.floor((Math.min(seg[4*s],seg[4*s+2])-minx)/BS),x1=Math.floor((Math.max(seg[4*s],seg[4*s+2])-minx)/BS),y0=Math.floor((Math.min(seg[4*s+1],seg[4*s+3])-miny)/BS),y1=Math.floor((Math.max(seg[4*s+1],seg[4*s+3])-miny)/BS);
    for(let y=y0;y<=y1;y++)for(let x=x0;x<=x1;x++)bins[y*nx+x].push(s)}
  const nSt=strokes.map(L=>L.pts.length/2);
  function query(x,y,exS,exI,win,out){
    const bx=Math.floor((x-minx)/BS),by=Math.floor((y-miny)/BS);let best=Infinity,bs=-1,bt=0;
    for(let dy=-1;dy<=1;dy++){const yy=by+dy;if(yy<0||yy>=ny)continue;for(let dx=-1;dx<=1;dx++){const xx=bx+dx;if(xx<0||xx>=nx)continue;const list=bins[yy*nx+xx];
      for(let k=0;k<list.length;k++){const s=list[k];
        if(exS>=0&&meta[2*s]===exS){let d=Math.abs(meta[2*s+1]-exI);if(strokes[exS].closed)d=Math.min(d,nSt[exS]-d);if(d<win)continue}
        const x0=seg[4*s],y0=seg[4*s+1],ex=seg[4*s+2]-x0,ey=seg[4*s+3]-y0;let t=((x-x0)*ex+(y-y0)*ey)/(ex*ex+ey*ey);t=t<0?0:t>1?1:t;
        const qx=x0+ex*t-x,qy=y0+ey*t-y,d2=qx*qx+qy*qy;if(d2<best){best=d2;bs=s;bt=t}}}}
    if(bs<0){out.d=Infinity;return}const s=bs;out.d=Math.sqrt(best);out.stroke=meta[2*s];out.station=meta[2*s+1];out.t=bt;
    const x0=seg[4*s],y0=seg[4*s+1];out.qx=x0+(seg[4*s+2]-x0)*bt;out.qy=y0+(seg[4*s+3]-y0)*bt;
  }
  return{query:query,nSt:nSt};
}
// Round-tube point cloud of the letters, sorted along each stroke's path (key = station + t), so drawing the points whose key
// lies behind the pen is a clean cut across the tube. aoK darkens crevices: probes around each sample that hit another stroke
// portion count as occluders.
function build(strokes,step,aoK){
  const F=field(strokes),q={},q2={},rec=[],aoWin=Math.ceil(1.2*0.18/STEP);
  const AOD=6,aoDir=[];for(let i=0;i<AOD;i++)aoDir.push(Math.cos(TAU*i/AOD),Math.sin(TAU*i/AOD));
  function ao(x,y,gx,gy,si,st,r){
    if(!aoK)return 1;let occ=0,cnt=0;
    for(let i=0;i<AOD;i++){const dx=aoDir[2*i],dy=aoDir[2*i+1];if(dx*gx+dy*gy<-0.7)continue;cnt++;
      F.query(x+dx*1.6*r,y+dy*1.6*r,si,st,aoWin,q2);if(q2.d<strokes[q2.stroke].r)occ++}
    return 1-aoK*(cnt?occ/cnt:0);
  }
  strokes.forEach((L,si)=>{
    const r=L.r,p=L.pts;let minx=1e9,miny=1e9,maxx=-1e9,maxy=-1e9;
    for(let i=0;i<p.length;i+=2){minx=Math.min(minx,p[i]);maxx=Math.max(maxx,p[i]);miny=Math.min(miny,p[i+1]);maxy=Math.max(maxy,p[i+1])}
    const pad=r+2*step,Fs=field([L]);
    const x0=Math.floor((minx-pad)/step)*step,y0=Math.floor((miny-pad)/step)*step;
    for(let y=y0;y<=maxy+pad;y+=step)for(let x=x0;x<=maxx+pad;x+=step){
      Fs.query(x,y,-1,0,0,q);if(q.d>r+step)continue;
      const sd=q.d-r,gx=q.d>1e-9?(x-q.qx)/q.d:0,gy=q.d>1e-9?(y-q.qy)/q.d:0;
      const dd=q.d,key=si*1e5+q.station+q.t,a=ao(x,y,gx,gy,si,q.station,r);
      const em=(px,py,pz,nx,ny,nz)=>rec.push(key,px,py,pz,nx,ny,nz,a);
      if(dd<=r){const z=Math.sqrt(r*r-dd*dd),c=dd/r;em(x,y,-z,gx*c,gy*c,-z/r);em(x,y,z,gx*c,gy*c,z/r)}
      // The raster thins out toward the silhouette (z ~ sqrt), so the rim gets ring samples of its own.
      if(Math.abs(sd)<=step*0.5){const bx=x-gx*sd,by=y-gy*sd,pm=Math.acos(Math.max(0,1-step/r)),dp=step/r;
        for(let ph=-pm;ph<=pm+1e-9;ph+=dp){const c=Math.cos(ph),s=Math.sin(ph);em(bx-gx*r*(1-c),by-gy*r*(1-c),r*s,gx*c,gy*c,s)}}
    }
  });
  const n=rec.length/8,idx=new Uint32Array(n);for(let i=0;i<n;i++)idx[i]=i;
  idx.sort((a,b)=>rec[8*a]-rec[8*b]);
  const pos=new Float32Array(3*n),nrm=new Float32Array(3*n),aoA=new Float32Array(n),key=new Float32Array(n);
  const start=new Uint32Array(strokes.length+1);let rho=0;
  for(let k=0;k<n;k++){const i=idx[k]*8;key[k]=rec[i];pos[3*k]=rec[i+1];pos[3*k+1]=rec[i+2];pos[3*k+2]=rec[i+3];nrm[3*k]=rec[i+4];nrm[3*k+1]=rec[i+5];nrm[3*k+2]=rec[i+6];aoA[k]=rec[i+7];
    start[Math.floor(rec[i]/1e5)+1]=k+1;rho=Math.max(rho,Math.hypot(rec[i+1],rec[i+2],rec[i+3]))}
  for(let s=1;s<=strokes.length;s++)if(!start[s])start[s]=start[s-1];
  return{n:n,pos:pos,nrm:nrm,ao:aoA,key:key,start:start,rho:rho,nSt:F.nSt};
}
// Exact per-point projection extremes over every yaw and every pitch in [-Bh,Bh]. A point's yaw sweep is a circle of radius
// rho=hypot(x,z) about the y axis. Projected x peaks on the tangent ray, rho/sqrt(a^2-b^2) with a=K2+y sinB, b=rho cosB; over pitch
// that has one interior critical point, sinB=-K2 y/(y^2+rho^2), so the extreme is there or at a clamp end. Projected y is monotone
// in sin(yaw), so it peaks at sin(yaw)=+-1, where it is r cos(B+phi)/(K2+r sin(B+phi)) with r=hypot(y,rho): the tangent bound
// r/sqrt(K2^2-r^2) if the clamp interval reaches a tangent angle, else a clamp end.
function bound(cloud,K2,Bh){
  let rx=0,ry=0;const P=cloud.pos;
  const xAt=(y,rho,B)=>{const a=K2+y*Math.sin(B),b=rho*Math.cos(B);return rho/Math.sqrt(a*a-b*b)};
  function yMax(r,phi){
    const t0=-Math.asin(r/K2),inside=t=>{let d=t-phi;d-=Math.round(d/TAU)*TAU;return Math.abs(d)<=Bh};
    if(inside(t0)||inside(Math.PI-t0))return r/Math.sqrt(K2*K2-r*r);
    const f=t=>Math.abs(r*Math.cos(t)/(K2+r*Math.sin(t)));return Math.max(f(phi-Bh),f(phi+Bh));
  }
  for(let i=0;i<cloud.n;i++){const x=P[3*i],y=P[3*i+1],rho=Math.hypot(x,P[3*i+2]);
    let m=Math.max(xAt(y,rho,-Bh),xAt(y,rho,Bh));const sc=-K2*y/(y*y+rho*rho);
    if(Math.abs(sc)<=1){const Bc=Math.asin(sc);if(Math.abs(Bc)<=Bh)m=Math.max(m,xAt(y,rho,Bc))}
    rx=Math.max(rx,m);
    const r=Math.hypot(y,rho);ry=Math.max(ry,yMax(r,Math.atan2(rho,y)),yMax(r,Math.atan2(-rho,y)))}
  return{rx:rx,ry:ry};
}
// Shatter confinement: a cylinder about the y axis (radius rc, half-height yc) 3% larger than the letters' own extents, so every
// sample's home lies inside it with room for a spring overshoot. Its rim corners are the farthest points it holds, and their reach
// joins the letters' in reachWith, so the grid covers debris anywhere in the cylinder at every rotation.
function shatterFit(cloud,K2,Bh){
  const P=cloud.pos;let RXZ=0,YM=0;
  for(let i=0;i<cloud.n;i++){RXZ=Math.max(RXZ,Math.hypot(P[3*i],P[3*i+2]));YM=Math.max(YM,Math.abs(P[3*i+1]))}
  const rc=RXZ*1.03,yc=YM*1.03;
  return{rc:rc,yc:yc,reach:bound({n:2,pos:new Float32Array([rc,yc,0,rc,-yc,0])},K2,Bh)};
}
function reachWith(cloud,K2,Bh){const b=bound(cloud,K2,Bh),s=shatterFit(cloud,K2,Bh).reach;return{rx:Math.max(b.rx,s.rx),ry:Math.max(b.ry,s.ry)}}
// Grid for W columns at a cell aspect (width/height): K1x so the widest reach lands inside W, H from the tallest.
function grid(reach,W,aspect){const K1x=(W/2-1.5)/reach.rx,K1y=K1x*aspect;return{K1x:K1x,K1y:K1y,W:W,H:2*(Math.ceil(K1y*reach.ry)+1)}}
// Sample step so neighbours land under a cell apart at the nearest depth the bound allows.
function stepFor(K1x,K2,rho){return 0.8*(K2-rho)/K1x}
// gap: ink gap between the D's bowl and the S (stroke width is 0.36); Bh: pitch clamp, which with free yaw sets the box height.
const SPEC={letters:{r:0.18,sRatio:1.03,dW:1.32,dF:0.30,dK:0.58,sR1:0.42,sR2:0.48,sTop:1.025,sT1:8*Math.PI/180,sT4:188*Math.PI/180,gap:0.16},
  K2:10,Bh:1.4,aoK:0.45,fog:0.4,light:{amb:0.08,kd:0.50,ks:0.46,kr:0.14}};
return{TAU:TAU,layout:layout,build:build,bound:bound,shatterFit:shatterFit,reachWith:reachWith,grid:grid,stepFor:stepFor,SPEC:SPEC};
})();
/*ENGINE-END*/

const dsMono=$('.ds-mono');
if(dsMono){
  // Pool of non-directional marks: slashes, bars, brackets and the horizontal-bar glyphs hatch a surface, so they never enter
  // the ramp (in Menlo Bold the two full-width bars of = out-cover @ and would have been the brightest glyph).
  const FONT="'Menlo','Monaco','Consolas','Courier New',monospace",RAMP_POOL=".,:;+*%#$@";
  // Ink coverage of each candidate glyph in the real font, so the ramp steps evenly in ink rather than by folklore.
  const FM=(()=>{
    const c=document.createElement('canvas'),S=48;c.width=S*2;c.height=S*2;const x=c.getContext('2d',{willReadFrequently:true});
    x.font='700 '+S+'px '+FONT;const adv=x.measureText('M').width/S,glyphs=[];
    for(const ch of RAMP_POOL){x.clearRect(0,0,S*2,S*2);x.textBaseline='middle';x.textAlign='center';x.fillStyle='#000';x.fillText(ch,S,S);
      const d=x.getImageData(S-adv*S/2-2,S-S/2,adv*S+4,S).data;let sum=0,sy=0;
      for(let i=3,p=0;i<d.length;i+=4,p++){sum+=d[i];sy+=d[i]*Math.floor(p/(adv*S+4))}
      glyphs.push({ch:ch,cov:sum/(255*adv*S*S),off:Math.abs(sum?sy/sum/S-0.5:0)})}
    glyphs.sort((a,b)=>a.cov-b.cov);
    const top=glyphs[glyphs.length-1].cov,lo=glyphs[0].cov,N=10,ramp=[' '],used=new Set();
    for(let k=0;k<N;k++){const target=lo+(top-lo)*k/(N-1);let best=null,bs=1e9;
      for(const g of glyphs){if(used.has(g.ch))continue;const s=Math.abs(g.cov-target)+0.05*g.off;if(s<bs){bs=s;best=g}}
      used.add(best.ch);ramp.push(best.ch)}
    return{adv:adv,ramp:ramp};
  })();
  const spec=DSE.SPEC,L=spec.light,K2=spec.K2,ramp=FM.ramp,NL=ramp.length-1,CELL_CSS=4.2;let DPR=1;
  const lx=-0.42,ly=0.62,lz=-0.66,ll=Math.hypot(lx,ly,lz),hx=lx/ll,hy=ly/ll,hz=lz/ll-1,hl=Math.hypot(hx,hy,hz);
  const rm=matchMedia('(prefers-reduced-motion: reduce)'),hoverMq=matchMedia('(hover:hover) and (pointer:fine)');
  const homeSection=$('#home'),host=dsMono.parentElement,ctx=dsMono.getContext('2d'),atlas=document.createElement('canvas');
  const strokes=DSE.layout(spec.letters),coarse=DSE.build(strokes,0.05,0),rho=coarse.rho,ooN=1/(K2-rho),ooF=1/(K2+rho);
  // The pen: per stroke its station positions and tangents, a curvature-weighted time map (the pen slows through bends and
  // corners, 1 + 9 x turning angle per station) and the time each station was laid down (fresh ink cools for 400 ms).
  const pen=strokes.map(Ls=>{const p=Ls.pts,n=p.length/2,tg=new Float32Array(2*n),cost=new Float32Array(n);let tot=0;
    for(let i=0;i<n;i++){const i0=Math.max(0,i-1),i1=Math.min(n-1,i+1),tx=p[2*i1]-p[2*i0],ty=p[2*i1+1]-p[2*i0+1],l=Math.hypot(tx,ty)||1;tg[2*i]=tx/l;tg[2*i+1]=ty/l}
    for(let i=0;i<n;i++){const i0=Math.max(0,i-1),d=tg[2*i]*tg[2*i0]+tg[2*i+1]*tg[2*i0+1];cost[i]=1+9*Math.acos(Math.max(-1,Math.min(1,d)));tot+=cost[i]}
    const map=new Float32Array(257);let acc=0,j=0;
    for(let k=0;k<=256;k++){const target=k/256*tot;while(j<n-1&&acc+cost[j]<target){acc+=cost[j];j++}map[k]=Math.min(n-1,j+Math.max(0,Math.min(1,(target-acc)/cost[j])))}
    return{pts:p,n:n,tg:tg,map:map,time:new Float32Array(n).fill(-1)}});
  // Round end cap for the pen: unit directions on a hemisphere facing along the tangent (c >= 0), Fibonacci-spaced.
  const CAPN=96,CAP=new Float32Array(3*CAPN);
  for(let i=0;i<CAPN;i++){const ph=Math.acos(1-(i+0.5)/CAPN),th=i*2.399963;CAP[3*i]=Math.sin(ph)*Math.cos(th);CAP[3*i+1]=Math.sin(ph)*Math.sin(th);CAP[3*i+2]=Math.cos(ph)}
  // Atlas rows 0..3: depth fade; 4..6: fade levels for the wake dye. Physics runs in fixed 1/120 s substeps so
  // the bounce is the same at 60 and 120 Hz; springs are underdamped (zeta 0.42: one clear overshoot, a smaller second) and the
  // pitch rebounds elastically at the clamp. HOME_B > 0 tips the top edge away from the viewer (a sign tipped back).
  const ROWS=7,FADE_A=[0.34,0.22,0.12],HOME_B=0.24,SPR_K=30,SPR_Z=0.42,INTRO_K=9,INTRO_Z=0.45,BOUNCE=0.8,SUB=1/120;
  const SWAY_A=0.45,SWAY_T=6.7,SWAY_O=0.07,SWAY_W=0.18,SWAY_MOD_T=19.3,BREATH_A=0.05,BREATH_T=4.1,BREATH_MOD_T=13.7;
  let cloud=null,W=0,H=0,cw=0,ch=0,K1x=0,K1y=0,zb,acc,cnt,ci,alv,dCi,dAlv,dsp,dRow,full=true,built=false,buildQueued=false;
  let rip,ripPrev,ripOn=false,FW=0,FH=0,fu,fv,fu2,fv2,fd,fd2,fp,fdiv,fsol,wakeOn=false,dP=null,dV=null,shat=0,shatT=0,fit=null;
  let A=0,B=HOME_B,Av=0,Bv=0,homeA=0,swayT=0,free=false,last=0,rafId=0,inView=false,near=false,accum=0,bump=0,bumpV=0,sc=1;
  let intro=null,introDone=false,coolUntil=0,fcA=1,fsA=0,fcB=1,fsB=0,pressA=0,pressB=0,hovA=0,hovB=0,drag=null,lastTap=0;
  const reduced=()=>rm.matches;
  // Cells snap to whole device pixels so the atlas glyphs stay crisp; W follows the column, the grid follows W and the reach of
  // the letters joined with the shatter cylinder's. The box is sized from the coarse cloud at once (no layout shift later); the
  // fine cloud is built off the main path at load, and synchronously only on a resize after it exists (a blank box would show).
  // This first runs while the router still hides #home, so the column falls back to 350 until the ResizeObserver corrects it.
  function layoutSize(sync){
    DPR=Math.min(3,window.devicePixelRatio||1);
    const col=Math.min(400,host.clientWidth||350);
    cw=Math.max(2,Math.round(CELL_CSS*DPR));ch=Math.max(3,Math.round(cw/FM.adv));
    const nW=Math.max(24,Math.floor(col*DPR/cw)),g=DSE.grid(DSE.reachWith(cloud||coarse,K2,spec.Bh),nW,cw/ch);
    if(built&&g.W!==W){built=false;cloud=null}
    W=g.W;H=g.H;K1x=g.K1x;K1y=g.K1y;
    zb=new Float32Array(W*H);acc=new Float32Array(W*H);cnt=new Uint16Array(W*H);ci=new Uint8Array(W*H);alv=new Uint8Array(W*H);dCi=new Uint8Array(W*H);dAlv=new Uint8Array(W*H);
    dsp=new Uint8Array(W*H);dRow=new Uint8Array(W*H);rip=new Float32Array(W*H);ripPrev=new Float32Array(W*H);ripOn=false;
    FW=Math.ceil(W/2);FH=Math.ceil(H/2);const fn=FW*FH;fu=new Float32Array(fn);fv=new Float32Array(fn);fu2=new Float32Array(fn);fv2=new Float32Array(fn);fd=new Float32Array(fn);fd2=new Float32Array(fn);fp=new Float32Array(fn);fdiv=new Float32Array(fn);fsol=new Uint8Array(fn);wakeOn=false;shat=0;
    dsMono.width=W*cw;dsMono.height=H*ch;dsMono.style.width=(W*cw/DPR)+'px';dsMono.style.height=(H*ch/DPR)+'px';
    buildAtlas();if(!built)queueBuild(sync);else wake();
  }
  function queueBuild(sync){
    if(buildQueued)return;buildQueued=true;
    const run=()=>{buildQueued=false;if(built)return;
      cloud=DSE.build(strokes,DSE.stepFor(K1x,K2,rho),spec.aoK);built=true;fit=DSE.shatterFit(cloud,K2,spec.Bh);
      if(!dP||dP.length!==cloud.n*3){dP=new Float32Array(cloud.n*3);dV=new Float32Array(cloud.n*3)}
      const g=DSE.grid(DSE.reachWith(cloud,K2,spec.Bh),W,cw/ch);if(g.H!==H){layoutSize(true);return}
      K1x=g.K1x;K1y=g.K1y;
      if(inView&&!introDone&&!intro)startIntro();else wake()};
    if(sync)run();else if('requestIdleCallback' in window)requestIdleCallback(run,{timeout:1500});else setTimeout(run,1);
  }
  function buildAtlas(){
    atlas.width=cw*(NL+1);atlas.height=ch*ROWS;
    const x=atlas.getContext('2d');x.clearRect(0,0,atlas.width,atlas.height);
    x.font='700 '+(cw/FM.adv)+'px '+FONT;x.textAlign='center';x.textBaseline='middle';x.fillStyle=getComputedStyle(dsMono).color;
    for(let r=0;r<ROWS;r++){x.globalAlpha=r<4?1-spec.fog*r/3:FADE_A[r-4];for(let k=1;k<=NL;k++){x.save();x.beginPath();x.rect(k*cw,r*ch,cw,ch);x.clip();x.fillText(ramp[k],k*cw+cw/2,r*ch+ch/2+0.5);x.restore()}}
    ctx.imageSmoothingEnabled=false;full=true;
  }
  // One auxiliary sample through the frame's projection and shading (pen cap), lit like the tube plus a boost.
  function plot(px,py,pz,nx,ny,nz,boost){
    const n1x=fcA*nx+fsA*nz,n1z=-fsA*nx+fcA*nz,n2z=fsB*ny+fcB*n1z;if(n2z>0.26)return;
    const p1x=fcA*px+fsA*pz,p1z=-fsA*px+fcA*pz,p2y=fcB*py-fsB*p1z,ooz=1/(fsB*py+fcB*p1z+K2);
    const xp=(W>>1)+Math.floor(K1x*ooz*p1x),yp=(H>>1)-Math.floor(K1y*ooz*p2y);if(xp<0||xp>=W||yp<0||yp>=H)return;
    const idx=yp*W+xp,zc=zb[idx];if(ooz<zc-0.0007)return;
    const n2y=fcB*ny-fsB*n1z;let d=n1x*lx+n2y*ly+n2z*lz;d=d<0?0:d/ll;let sp=(n1x*hx+n2y*hy+n2z*hz)/hl;sp=sp<0?0:sp*sp;sp*=sp;sp*=sp;sp*=sp;
    const rim=n2z<0?(1+n2z)*(1+n2z)*(1+n2z):1;let v=L.amb+L.kd*d+L.ks*sp+L.kr*rim+boost;if(v>1)v=1;
    if(ooz>zc+0.0007){zb[idx]=ooz;acc[idx]=v;cnt[idx]=1}else{acc[idx]+=v;cnt[idx]++}
  }
  // One frame: rotate, project, shade into a depth-tolerant z-buffer that averages the shades of near-tied samples.
  function render(){
    const tNow=performance.now(),cool=tNow<coolUntil;
    const cA=fcA=Math.cos(A),sA=fsA=Math.sin(A),cB=fcB=Math.cos(B),sB=fsB=Math.sin(B),P=shat?dP:cloud.pos,Nn=cloud.nrm,AO=cloud.ao,KEY=cloud.key;
    zb.fill(0);cnt.fill(0);
    const hw=W>>1,hh=H>>1,tol=0.0007,amb=L.amb,kd=L.kd,ks=L.ks,kr=L.kr,ns=cloud.start.length-1;
    // Draw-on: per stroke, the points whose nearest station lies behind the pen (a clean cut across the tube), then the cap.
    for(let s=0;s<ns;s++){
      let lo=cloud.start[s],hi=cloud.start[s+1];
      if(intro){if(intro.st[s]<0)continue;const th=s*1e5+intro.st[s];let a=lo,b=hi;while(a<b){const m=(a+b)>>1;if(KEY[m]<=th)a=m+1;else b=m}hi=a}
      const tm=pen[s].time,base=s*1e5;
      for(let i=lo;i<hi;i++){
        const nx=Nn[3*i],ny=Nn[3*i+1],nz=Nn[3*i+2],n1x=cA*nx+sA*nz,n1z=-sA*nx+cA*nz,n2z=sB*ny+cB*n1z;
        if(n2z>0.26)continue;
        const px=P[3*i]*sc,py=P[3*i+1]*sc,pz=P[3*i+2]*sc,p1x=cA*px+sA*pz,p1z=-sA*px+cA*pz,p2y=cB*py-sB*p1z,ooz=1/(sB*py+cB*p1z+K2);
        const xp=hw+Math.floor(K1x*ooz*p1x),yp=hh-Math.floor(K1y*ooz*p2y);
        if(xp<0||xp>=W||yp<0||yp>=H)continue;
        const idx=yp*W+xp,zc=zb[idx];
        if(ooz<zc-tol)continue;
        const n2y=cB*ny-sB*n1z;
        let d=n1x*lx+n2y*ly+n2z*lz;d=d<0?0:d/ll;
        let sp=(n1x*hx+n2y*hy+n2z*hz)/hl;sp=sp<0?0:sp*sp;sp*=sp;sp*=sp;sp*=sp;
        const rim=n2z<0?(1+n2z)*(1+n2z)*(1+n2z):1;
        let v=(amb+kd*d+ks*sp+kr*rim)*AO[i];
        // Fresh ink: a station laid down within the last 400 ms glows and cools to its lit shade.
        if(cool){const age=(tNow-tm[(KEY[i]-base)|0])/400;if(age<1)v+=0.55*(1-age)}
        if(v>1)v=1;
        if(ooz>zc+tol){zb[idx]=ooz;acc[idx]=v;cnt[idx]=1}else{acc[idx]+=v;cnt[idx]++}
      }
    }
    if(intro)for(let s=0;s<ns;s++){const st=intro.st[s];if(st<0)continue;
      const pn=pen[s],j=Math.min(pn.n-1,Math.floor(st)),f=st-j,j1=Math.min(pn.n-1,j+1),r=strokes[s].r*sc;
      const qx=(pn.pts[2*j]+(pn.pts[2*j1]-pn.pts[2*j])*f)*sc,qy=(pn.pts[2*j+1]+(pn.pts[2*j1+1]-pn.pts[2*j+1])*f)*sc;
      let tx=pn.tg[2*j]+(pn.tg[2*j1]-pn.tg[2*j])*f,ty=pn.tg[2*j+1]+(pn.tg[2*j1+1]-pn.tg[2*j+1])*f;const l=Math.hypot(tx,ty)||1;tx/=l;ty/=l;
      const nx=-ty,ny=tx;
      for(let c=0;c<CAPN;c++){const a=CAP[3*c],b=CAP[3*c+1],cc=CAP[3*c+2],dx=a*nx+cc*tx,dy=a*ny+cc*ty;plot(qx+r*dx,qy+r*dy,r*b,dx,dy,b,0.4)}}
    // Quantize with hysteresis (a cell changes glyph only once its shade leaves the old step by a margin); a ripple modulates it.
    const N1=NL-1,useRip=ripOn&&!reduced();
    for(let i=0;i<W*H;i++){
      if(!cnt[i]){ci[i]=0;continue}
      const raw=1+(acc[i]/cnt[i]+(useRip?0.45*rip[i]:0))*N1,prev=ci[i];
      ci[i]=(prev&&Math.abs(raw-prev)<0.72)?prev:Math.max(1,Math.min(NL,Math.round(raw)));
      let f=(zb[i]-ooF)/(ooN-ooF);f=f<0?0:f>1?1:f;alv[i]=Math.round((1-f)*3);
    }
    compose();
    // Blit only the cells whose glyph or row changed.
    if(full){ctx.clearRect(0,0,dsMono.width,dsMono.height);dCi.fill(0);dAlv.fill(0)}
    for(let j=0;j<H;j++)for(let i=0;i<W;i++){const k=j*W+i,c=dsp[k],a=dRow[k];if(c===dCi[k]&&a===dAlv[k])continue;
      if(!full)ctx.clearRect(i*cw,j*ch,cw,ch);if(c)ctx.drawImage(atlas,c*cw,a*ch,cw,ch,i*cw,j*ch,cw,ch);dCi[k]=c;dAlv[k]=a}
    full=false;
  }
  function speed(){return drag&&drag.moved?Math.abs(drag.vA)+0.7*Math.abs(drag.vB):Math.abs(Av)+0.7*Math.abs(Bv)}
  // ---- Ripple. A damped wave equation on the cell grid; a tap injects a pulse that spreads across the letters and modulates
  // their shade (never their geometry, so the bound is untouched). Stops itself when the energy is spent.
  function rippleTap(x,y){ripOn=true;for(let j=Math.max(0,y-3);j<=Math.min(H-1,y+3);j++)for(let i=Math.max(0,x-3);i<=Math.min(W-1,x+3);i++){const d2=(i-x)*(i-x)+(j-y)*(j-y)*0.36;rip[j*W+i]+=1.3*Math.exp(-d2/2.5)}}
  function rippleStep(){
    if(!ripOn)return;let e=0;
    for(let j=1;j<H-1;j++)for(let i=1;i<W-1;i++){const k=j*W+i,u=rip[k],lap=rip[k-1]+rip[k+1]+0.36*(rip[k-W]+rip[k+W])-2.72*u;
      const nu=2*u-ripPrev[k]+0.28*lap-0.06*(u-ripPrev[k]);ripPrev[k]=u;rip[k]=nu;e+=nu*nu}
    if(e<0.02){ripOn=false;rip.fill(0);ripPrev.fill(0)}
  }
  // ---- Wake. A 2D stable-fluids step on a half-resolution grid (semi-Lagrangian advection, vorticity confinement, 20 Jacobi
  // pressure iterations, closed walls). Cells under the letters are solid and carry the letters' screen velocity, so a turn
  // drags the fluid and sheds vortices off the corners and terminals; dye is injected at the trailing silhouette above the sway's
  // speed and decays, and is drawn as faint glyphs into empty cells, faded to nothing over the last cells. Skipped when there is
  // no dye and no speed.
  function fsample(f,x,y){x=x<0?0:x>FW-1.001?FW-1.001:x;y=y<0?0:y>FH-1.001?FH-1.001:y;const i=x|0,j=y|0,a=x-i,b=y-j,k=j*FW+i;return (f[k]*(1-a)+f[k+1]*a)*(1-b)+(f[k+FW]*(1-a)+f[k+FW+1]*a)*b}
  function wakeStep(dt){
    let s=(speed()-1.0)/6;s=s<0?0:s>1?1:s;
    const av=drag&&drag.moved?drag.vA:Av,bv=drag&&drag.moved?drag.vB:Bv;
    const V0=0.3*rho*K1x/(K2-rho)/2,cx=FW/2,cy=FH/2;let total=0;
    for(let j=0;j<FH;j++)for(let i=0;i<FW;i++){const k=j*FW+i,i2=Math.min(W-1,2*i+1),j2=Math.min(H-1,2*j+1);
      const solid=cnt[2*j*W+2*i]||cnt[2*j*W+i2]||cnt[j2*W+2*i]||cnt[j2*W+i2];fsol[k]=solid?1:0;
      if(solid){const rx=(i+0.5-cx)/cx,ry=(j+0.5-cy)/cy;fu[k]=-av*V0*Math.sqrt(Math.max(0,1-rx*rx));fv[k]=bv*V0*(ch/cw)*Math.sqrt(Math.max(0,1-ry*ry))*0.6;fd[k]=0}}
    if(s>0){const mx=av<0?1:-1,my=bv>0?-1:1;
      for(let j=1;j<FH-1;j++)for(let i=1;i<FW-1;i++){const k=j*FW+i;if(!fsol[k])continue;
        if(!fsol[k-mx])fd[k-mx]=Math.min(1,fd[k-mx]+0.3*s);if(!fsol[k-my*FW])fd[k-my*FW]=Math.min(1,fd[k-my*FW]+0.15*s)}}
    for(let j=0;j<FH;j++)for(let i=0;i<FW;i++){const k=j*FW+i;if(fsol[k]){fu2[k]=fu[k];fv2[k]=fv[k];fd2[k]=0;continue}
      const x=i-fu[k]*dt,y=j-fv[k]*dt;fu2[k]=fsample(fu,x,y);fv2[k]=fsample(fv,x,y);fd2[k]=fsample(fd,x,y)*0.955;total+=fd2[k]}
    for(let j=1;j<FH-1;j++)for(let i=1;i<FW-1;i++){const k=j*FW+i;if(fsol[k])continue;
      const wl=(fv2[k]-fv2[k-1])-(fu2[k]-fu2[k-FW]);const wr=Math.abs((fv2[k+1]-fv2[k])-(fu2[k+1]-fu2[k+1-FW])),wu=Math.abs((fv2[k-FW]-fv2[k-FW-1])-(fu2[k-FW]-fu2[k-2*FW<0?k-FW:k-2*FW]));
      const gx=wr-Math.abs(wl),gy=Math.abs(wl)-wu,gl=Math.hypot(gx,gy)+1e-6;fu2[k]+=0.35*(gy/gl)*wl*dt*8;fv2[k]-=0.35*(gx/gl)*wl*dt*8}
    for(let j=1;j<FH-1;j++)for(let i=1;i<FW-1;i++){const k=j*FW+i;fdiv[k]=fsol[k]?0:0.5*(fu2[k+1]-fu2[k-1]+fv2[k+FW]-fv2[k-FW]);fp[k]=0}
    for(let it=0;it<20;it++)for(let j=1;j<FH-1;j++)for(let i=1;i<FW-1;i++){const k=j*FW+i;if(fsol[k])continue;fp[k]=(fp[k-1]+fp[k+1]+fp[k-FW]+fp[k+FW]-fdiv[k])*0.25}
    for(let j=1;j<FH-1;j++)for(let i=1;i<FW-1;i++){const k=j*FW+i;if(fsol[k])continue;fu2[k]-=0.5*(fp[k+1]-fp[k-1]);fv2[k]-=0.5*(fp[k+FW]-fp[k-FW])}
    for(let j=0;j<FH;j++)for(let i=0;i<FW;i++){const k=j*FW+i,wall=i===0||j===0||i===FW-1||j===FH-1;fu[k]=wall?0:fu2[k];fv[k]=wall?0:fv2[k];fd[k]=wall?0:fd2[k]}
    wakeOn=total>0.05||s>0;
    if(!wakeOn){fu.fill(0);fv.fill(0);fd.fill(0)}
  }
  // ---- Shatter. A hard fling bursts the letters into their own samples: each inherits the rigid velocity (omega x p) plus an
  // outward kick, flies with drag inside the cylinder shatterFit allows (reflecting off its walls), then the underdamped springs
  // pull every sample home and it clicks back with one overshoot. The rigid rotation keeps running, so the debris tumbles.
  function shatterStart(){
    const P=cloud.pos,n=cloud.n;
    for(let i=0;i<n;i++){const x=P[3*i],y=P[3*i+1],z=P[3*i+2],r=Math.hypot(x,y,z)||1,k=(1.2+Math.random()*1.6)/r;
      dP[3*i]=x;dP[3*i+1]=y;dP[3*i+2]=z;
      dV[3*i]=Av*z*0.5+x*k+(Math.random()-0.5)*0.8;dV[3*i+1]=y*k+(Math.random()-0.5)*0.8;dV[3*i+2]=-Av*x*0.5+z*k+(Math.random()-0.5)*0.8}
    shat=1;shatT=0;
  }
  function shatterStep(dt){
    const P=cloud.pos,n=cloud.n,rc=fit.rc,yc=fit.yc,spring=shatT>0.45,k=30,c=2*0.42*Math.sqrt(30);let far=0;shatT+=dt;
    for(let i=0;i<n;i++){let x=dP[3*i],y=dP[3*i+1],z=dP[3*i+2],vx=dV[3*i],vy=dV[3*i+1],vz=dV[3*i+2];
      if(spring){vx+=(k*(P[3*i]-x)-c*vx)*dt;vy+=(k*(P[3*i+1]-y)-c*vy)*dt;vz+=(k*(P[3*i+2]-z)-c*vz)*dt}else{const g=Math.exp(-1.5*dt);vx*=g;vy*=g;vz*=g}
      x+=vx*dt;y+=vy*dt;z+=vz*dt;
      const rr=Math.hypot(x,z);if(rr>rc){const nx=x/rr,nz=z/rr,vn=vx*nx+vz*nz;if(vn>0){vx-=1.6*vn*nx;vz-=1.6*vn*nz}x=nx*rc;z=nz*rc}
      if(y>yc){y=yc;if(vy>0)vy=-0.6*vy}else if(y<-yc){y=-yc;if(vy<0)vy=-0.6*vy}
      dP[3*i]=x;dP[3*i+1]=y;dP[3*i+2]=z;dV[3*i]=vx;dV[3*i+1]=vy;dV[3*i+2]=vz;
      const e=Math.abs(x-P[3*i])+Math.abs(y-P[3*i+1])+Math.abs(z-P[3*i+2])+Math.abs(vx)+Math.abs(vy)+Math.abs(vz);if(e>far)far=e}
    if(spring&&(far<0.05||shatT>3.2))shat=0;
  }
  // Display composition: letters, then the wake dye into empty cells (fade rows, edge falloff).
  function compose(){
    const n=W*H;
    for(let i=0;i<n;i++){dsp[i]=ci[i];dRow[i]=alv[i]}
    if(wakeOn&&!reduced())for(let j=2;j<H-2;j++)for(let i=2;i<W-2;i++){const k=j*W+i;if(dsp[k])continue;
      const d=fsample(fd,(i+0.5)/2-0.5,(j+0.5)/2-0.5)*Math.min(1,(Math.min(i,W-1-i,j,H-1-j)-1)/4);if(d<0.12)continue;
      dsp[k]=d>0.55?3:d>0.3?2:1;dRow[k]=d>0.45?4:d>0.22?5:6}
  }
  // Motion. Idle is a sway: each half-swing is an eased S-curve (cubic in-out) that runs slightly past the far extreme and
  // settles back over the last SWAY_W of the half period, so every turnaround has a small overshoot and settle with zero
  // velocity at both ends of each segment; the amplitude breathes on a slow unrelated period and the pitch breath runs on two
  // more, so it never repeats as a loop. Underdamped springs follow the curve and return pitch to the tipped-back home,
  // rebounding elastically at the clamp. After any release the sway is re-centered on the nearest face-on turn and re-phased to
  // the letters' offset and direction, so it is always balanced left and right. Under reduced motion nothing moves on its own.
  function spring(x,v,target,dt,k,z){const a=k*(target-x)-2*z*Math.sqrt(k)*v;v+=a*dt;x+=v*dt;return[x,v]}
  function pitch(dt,goal,k,z){const r=spring(B,Bv,goal,dt,k,z);B=r[0];Bv=r[1];if(B>spec.Bh){B=spec.Bh;Bv=-Math.abs(Bv)*BOUNCE}if(B<-spec.Bh){B=-spec.Bh;Bv=Math.abs(Bv)*BOUNCE}}
  const ease=h=>h<0.5?4*h*h*h:1-Math.pow(2-2*h,3)/2;
  function swayAt(t){
    const amp=SWAY_A*(1+0.12*Math.sin(t*DSE.TAU/SWAY_MOD_T)),half=SWAY_T/2,n=Math.floor(t/half),q=t/half-n,from=n%2?1:-1,peak=-from*(1+SWAY_O);
    return amp*(q<1-SWAY_W?from+(peak-from)*ease(q/(1-SWAY_W)):peak+(-from-peak)*ease((q-(1-SWAY_W))/SWAY_W));
  }
  function swayNow(){return reduced()?0:swayAt(swayT)}
  function breathNow(){return reduced()?0:BREATH_A*(1+0.3*Math.sin(swayT*DSE.TAU/BREATH_MOD_T))*Math.sin((swayT+1.3)*DSE.TAU/BREATH_T)}
  function rephase(){
    homeA=Math.round(A/DSE.TAU)*DSE.TAU;
    if(reduced())return;
    const amp=SWAY_A*(1+0.12*Math.sin(swayT*DSE.TAU/SWAY_MOD_T)),dir=Av<0?-1:1,base=Math.floor(swayT/SWAY_T)*SWAY_T;
    let d=A-homeA-pressA-hovA;d=Math.max(-amp,Math.min(amp,d));let best=swayT,bd=1e9;
    for(let i=0;i<240;i++){const t=base+SWAY_T*i/240,v=swayAt(t);if((swayAt(t+0.01)-v)*dir<0)continue;const e=Math.abs(v-d);if(e<bd){bd=e;best=t}}
    swayT=best;
  }
  function step(dt){accum+=dt;while(accum>=SUB){substep(SUB);accum-=SUB}
    if(!reduced()){rippleStep();if(wakeOn||speed()>1.0)wakeStep(Math.min(0.05,dt))}
    if(shat)shatterStep(Math.min(0.05,dt));
  }
  function substep(dt){
    swayT+=dt;
    const sA_=swayNow(),sB_=breathNow();
    // Landing squash after the intro: the letters dip to 96% and spring back (clamped at 1, the size the box was derived for).
    let r=spring(bump,bumpV,0,dt,60,0.4);bump=r[0];bumpV=r[1];sc=Math.min(1,1-0.06*bump);
    if(drag&&drag.moved)return;
    if(free){Av*=Math.exp(-0.9*dt);A+=Av*dt;if(Math.abs(Av)<1.6){free=false;rephase()}pitch(dt,HOME_B+sB_+pressB+hovB,SPR_K,SPR_Z);return}
    const k=intro?INTRO_K:SPR_K,z=intro?INTRO_Z:SPR_Z;
    r=spring(A,Av,homeA+sA_+pressA+hovA,dt,k,z);A=r[0];Av=r[1];
    pitch(dt,HOME_B+sB_+pressB+hovB,k,z);
  }
  function settled(){return reduced()&&!intro&&!drag&&!free&&!shat&&!ripOn&&!wakeOn&&Math.abs(Av)<2e-3&&Math.abs(Bv)<2e-3&&Math.abs(bump)<1e-3&&Math.abs(A-homeA-pressA-hovA)<1e-3&&Math.abs(B-HOME_B-pressB-hovB)<1e-3}
  // The pen: D over the first 0.85 s, S from 0.55 s, eased overall and slowed through bends by the curvature map; -1 = not
  // started, so a stroke begins from its first station with the round cap and never as a stray dot.
  function introStep(){
    if(!intro)return;const now=performance.now(),t=(now-intro.t0)/1000,e=x=>x<=0?0:x>=1?1:x<0.5?4*x*x*x:1-Math.pow(-2*x+2,3)/2;
    const prog=[e(t/0.85),e((t-0.55)/0.9)];
    for(let s=0;s<2;s++){const pn=pen[s];if(prog[s]<=0){intro.st[s]=-1;continue}
      const u=Math.min(255.999,prog[s]*256),k=Math.floor(u),st=pn.map[k]+(pn.map[k+1]-pn.map[k])*(u-k);
      const prev=intro.st[s]<0?-1:Math.floor(intro.st[s]);for(let j=prev+1;j<=Math.floor(st);j++)pn.time[j]=now;
      intro.st[s]=st}
    // The pen lifts: the letters land with a squash and a nod toward the viewer, and the underdamped springs settle them.
    if(t>1.5){intro=null;introDone=true;bumpV=6;Bv-=1.4;coolUntil=now+450}
  }
  function frame(ts){
    rafId=0;
    if(document.hidden||!inView||!built||!homeSection.classList.contains('active'))return;
    const dt=Math.min(0.05,last?(ts-last)/1000:0.016);last=ts;
    introStep();step(dt);render();
    if(settled()){last=0;return}
    schedule();
  }
  function schedule(){if(!rafId)rafId=requestAnimationFrame(frame)}
  function wake(){last=0;schedule()}
  function startIntro(){
    if(reduced()){introDone=true;A=homeA;B=HOME_B;Av=Bv=0;wake();return}
    intro={t0:performance.now(),st:[-1,-1]};for(const pn of pen)pn.time.fill(-1);A=homeA-0.55;B=0.26;Av=0;Bv=0;wake();
  }
  layoutSize();
  // Sideways drags rotate (touch-action:pan-y leaves vertical swipes to the page); a drag that started sideways then has the full
  // pitch range. The surface follows the pointer on both axes. A press (or a hover, on fine pointers) pushes the side under the
  // pointer away; a tap sends a ripple; a double tap turns one full turn; a fling free-spins and the sway resumes, and a hard
  // fling shatters the letters.
  dsMono.addEventListener('pointerdown',e=>{
    if(e.button||!built)return;const r=dsMono.getBoundingClientRect();
    drag={id:e.pointerId,x0:e.clientX,y0:e.clientY,x:e.clientX,y:e.clientY,t:performance.now(),moved:false,A0:A,B0:B,vA:0,vB:0};
    pressA=-(((e.clientX-r.left)/r.width)-0.5)*0.36;pressB=(0.5-(e.clientY-r.top)/r.height)*0.30;Av=0;Bv=0;free=false;wake();
  });
  dsMono.addEventListener('pointermove',e=>{
    if(!drag||e.pointerId!==drag.id){
      if(!drag&&hoverMq.matches&&!reduced()){const r=dsMono.getBoundingClientRect();hovA=-(((e.clientX-r.left)/r.width)-0.5)*0.24;hovB=(0.5-(e.clientY-r.top)/r.height)*0.14;wake()}
      return}
    const dx=e.clientX-drag.x0,dy=e.clientY-drag.y0;
    if(!drag.moved){if(Math.hypot(dx,dy)<(e.pointerType==='touch'?6:3))return;drag.moved=true;pressA=0;pressB=0;dsMono.classList.add('ds-grabbing');try{dsMono.setPointerCapture(e.pointerId)}catch(_){}}
    const now=performance.now(),ddt=Math.max(4,now-drag.t)/1000,sens=DSE.TAU/(1.5*dsMono.clientWidth);
    A=drag.A0-dx*sens;B=Math.max(-spec.Bh,Math.min(spec.Bh,drag.B0-dy*sens));
    drag.vA=drag.vA*0.5-(e.clientX-drag.x)*sens/ddt*0.5;drag.vB=drag.vB*0.5-(e.clientY-drag.y)*sens/ddt*0.5;drag.x=e.clientX;drag.y=e.clientY;drag.t=now;wake();
  });
  function endDrag(e,cancel){
    if(!drag||e.pointerId!==drag.id)return;
    const d=drag;drag=null;dsMono.classList.remove('ds-grabbing');pressA=0;pressB=0;
    const thrown=d.moved&&!cancel&&performance.now()-d.t<=80&&!reduced();
    if(thrown){Bv=Math.max(-8,Math.min(8,d.vB));if(Math.abs(d.vA)>2.5){Av=Math.max(-14,Math.min(14,d.vA));free=true}
      if(Math.abs(d.vA)>9&&!intro&&Math.abs(bump)<0.01&&!shat)shatterStart()}
    if(!d.moved&&!cancel){const now=performance.now(),r=dsMono.getBoundingClientRect();
      if(!reduced())rippleTap(Math.floor((d.x0-r.left)/r.width*W),Math.floor((d.y0-r.top)/r.height*H));
      if(now-lastTap<320&&!reduced()){rephase();homeA+=DSE.TAU*(d.x0-r.left<dsMono.clientWidth/2?1:-1);lastTap=0}else lastTap=now}
    if(d.moved&&!free)rephase();
    wake();
  }
  dsMono.addEventListener('pointerup',e=>endDrag(e,false));
  dsMono.addEventListener('pointercancel',e=>endDrag(e,true));
  dsMono.addEventListener('pointerleave',()=>{hovA=0;hovB=0;wake()});
  dsMono.addEventListener('dragstart',e=>e.preventDefault());
  // Below the fold: build the fine cloud as it approaches, play the intro the first time a third of it is on screen.
  new IntersectionObserver(es=>{near=es[0].isIntersecting;if(near&&!built)queueBuild()},{rootMargin:'600px'}).observe(dsMono);
  new IntersectionObserver(es=>{const was=inView;inView=es[0].isIntersecting;if(inView&&built&&!introDone&&!intro)startIntro();if(inView&&!was)wake()},{threshold:0.35}).observe(dsMono);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)wake()});
  rm.addEventListener('change',()=>{if(reduced()){intro=null;introDone=true;free=false;Av=Bv=0;bump=bumpV=0;shat=0;ripOn=false;wakeOn=false;homeA=Math.round(A/DSE.TAU)*DSE.TAU}wake()});
  new ResizeObserver(()=>{const col=Math.min(400,host.clientWidth),d=Math.min(3,window.devicePixelRatio||1);if(cw&&(d!==DPR||Math.abs(col*d/cw-W)>=1))layoutSize(built)}).observe(host);
  // Theme changes recolor the atlas; leaving Home stops the loop and the route's class change on #home starts it again.
  new MutationObserver(()=>{buildAtlas();wake()}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
  new MutationObserver(wake).observe(homeSection,{attributeFilter:['class']});
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

  if(qrModal.isOpen){if(e.key==='Tab'){e.preventDefault();qrOverlay.focus();return}if(e.key==='Escape')closeQR();return}

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
