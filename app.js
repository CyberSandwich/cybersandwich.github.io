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

// Copy buttons (with clipboard API fallback and error handling)
// Note: innerHTML below uses hardcoded SVG string, not user content — safe from XSS
document.addEventListener('click',e=>{
  const btn=e.target.closest('.copy-btn');
  if(!btn)return;
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
    const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;opacity:0';
    document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);done();
  }
  if(navigator.clipboard&&navigator.clipboard.writeText){
    navigator.clipboard.writeText(text).then(done).catch(()=>{try{legacy()}catch(e){}});
  }else{try{legacy()}catch(e){}}
});

// SPA link interception
document.addEventListener('click',e=>{
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  if(e.target.closest('.copy-btn'))return;
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
const linkCategories=['Modules','Career','Initiatives','Academic','Community','Personal','Miscellaneous'];

// Chevron SVG for card arrows
const CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

// Project icons — hardcoded SVGs keyed by title, safe for innerHTML
const PROJECT_ICONS={
'menuva':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 2v7c0 1.1.9 2 2 2h4a2 2 0 002-2V2"/><path d="M7 2v20"/><path d="M21 15V2a5 5 0 00-5 5v6c0 1.1.9 2 2 2h3"/><path d="M18 15v7"/></svg>',
'Clock':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/></svg>',
'AztecGen':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="2"/><rect x="6" y="6" width="12" height="12" rx="1"/><rect x="10" y="10" width="4" height="4" rx=".5"/></svg>',
'Arbit':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="2" width="20" height="20" rx="3"/><circle cx="8" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="8" r="1.5" fill="currentColor" stroke="none"/><circle cx="8" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="16" cy="16" r="1.5" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.5" fill="currentColor" stroke="none"/></svg>',
'CodeGen':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7V5a2 2 0 012-2h2"/><path d="M17 3h2a2 2 0 012 2v2"/><path d="M21 17v2a2 2 0 01-2 2h-2"/><path d="M7 21H5a2 2 0 01-2-2v-2"/><path d="M8 7v10"/><path d="M12 7v10"/><path d="M16 7v10"/></svg>',
'JPEG-Opt':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="M21 15l-5-5L5 21"/></svg>',
'Miele Laundry Guide':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22a7 7 0 007-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 007 7z"/></svg>',
'UK Number Generator':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 9h16"/><path d="M4 15h16"/><path d="M10 3l-2 18"/><path d="M16 3l-2 18"/></svg>',
'PNG-Opt':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 2 10 5-10 5L2 7z"/><path d="m2 12 10 5 10-5"/><path d="m2 17 10 5 10-5"/></svg>',
'Wrighter':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.83 2.83 0 114 4L7.5 20.5 2 22l1.5-5.5z"/></svg>',
'Project Convergence':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/></svg>',
'Project Shifting Tides':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>',
'Whisp':'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a3 3 0 00-3 3v7a3 3 0 006 0V5a3 3 0 00-3-3z"/><path d="M19 10v2a7 7 0 01-14 0v-2"/><path d="M12 19v3"/></svg>'
};

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
        a.setAttribute('data-q',(x.title+' '+cfg.sub(x)+' '+x.category).toLowerCase());
        // Icon: cfg.icon returns hardcoded SVG from PROJECT_ICONS — safe for innerHTML
        if(cfg.icon){const svg=cfg.icon(x);if(svg){const ic=document.createElement('div');ic.className='picon';ic.innerHTML=svg;a.appendChild(ic)}}
        const inf=document.createElement('div');inf.className='pinf';
        const pt=document.createElement('div');pt.className='pt';pt.textContent=x.title;
        const pd=document.createElement('div');pd.className='pd';pd.textContent=cfg.sub(x);
        inf.appendChild(pt);inf.appendChild(pd);
        const arr=document.createElement('div');arr.className='arr';
        arr.innerHTML=CHEVRON;
        a.appendChild(inf);a.appendChild(arr);sec.appendChild(a);
      });
      el.appendChild(sec);
    });
    const si=$(cfg.si);if(si&&si.value){filterList(si,el);const x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

function showProjects(){showCards({el:'#plist',data:projects,get:getProjects,cats:projectCategories,si:'#psearch',sub:x=>x.subtitle,icon:x=>PROJECT_ICONS[x.title]})}
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,cats:linkCategories,si:'#lsearch',sub:x=>cleanUrl(x.url)})}

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
        card.setAttribute('data-q',card.textContent.toLowerCase());
        sec.appendChild(card);
      });
      el.appendChild(sec);
    });
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
    let curMonth='',sec;
    p.forEach(x=>{
      const ym=x.date.slice(0,7);
      if(ym!==curMonth){
        curMonth=ym;
        sec=document.createElement('div');sec.className='link-sec';
        const h=document.createElement('h3');
        h.textContent=new Date(x.date+'T00:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
        sec.appendChild(h);el.appendChild(sec);
      }
      const a=document.createElement('a');
      a.className='ucard';
      a.href='/updates/'+x.file.replace('.md','');
      a.setAttribute('data-q',(x.title+' '+x.date).toLowerCase());
      const t=document.createElement('div');t.className='ut';t.textContent=x.title;
      const d=document.createElement('div');d.className='ud';d.textContent=fmtDate(x.date);
      a.appendChild(t);a.appendChild(d);sec.appendChild(a);
    });
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
    if(/^[-*] /.test(line)){
      if(!ul){cl();h+='<ul>';ul=true}
      h+='<li>'+il(line.replace(/^[-*] /,''))+'</li>';continue;
    }
    if(/^\d+\. /.test(line)){
      if(!ol){cl();h+='<ol>';ol=true}
      h+='<li>'+il(line.replace(/^\d+\. /,''))+'</li>';continue;
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
      return '<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,(_,text,href)=>{
      return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(text)+'</a>';
    });
}

function esc(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Score how well a word matches text (0 = no match)
// 5 = exact, 4 = prefix, 3 = word-boundary, 2 = substring, 0.5-1.0 = fuzzy (by tightness)
function scoreWord(w,t,nf){
  const i=t.indexOf(w);
  if(i!==-1){
    if(i===0&&t.length===w.length)return 5;
    if(i===0)return 4;
    if(t[i-1]===' ')return 3;
    return 2;
  }
  if(nf)return 0;
  let qi=0,first=-1,last=0;
  for(let ti=0;ti<t.length&&qi<w.length;ti++){
    if(t[ti]===w[qi]){if(first<0)first=ti;last=ti;qi++}
  }
  if(qi<w.length)return 0;
  return 0.5+w.length/(last-first+1)*0.5;
}

// Generic list filter — scores, sorts, flattens results when searching
function filterList(input,container){
  const q=input.value.trim().toLowerCase();
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

  // Score each card
  const scored=[];
  cards.forEach(c=>{
    const t=c.getAttribute('data-q')||c.textContent.toLowerCase();
    const cv=c.classList.contains('cve');
    let total=0;
    const ok=words.every(w=>{const s=scoreWord(w,t,cv);total+=s;return s>0});
    if(ok)scored.push({el:c,score:total});
    else c.style.display='none';
  });

  scored.sort((a,b)=>b.score-a.score||(a.el.getAttribute('data-q')||'').localeCompare(b.el.getAttribute('data-q')||''));
  secs.forEach(s=>{s.style.display='none'});

  scored.forEach((s,idx)=>{
    if(idx<10){
      s.el.style.display='';
      container.appendChild(s.el);
    }else{s.el.style.display='none'}
  });

  // Empty state
  let empty=container.querySelector('.search-empty');
  if(!scored.length){
    if(!empty){empty=document.createElement('div');empty.className='empty search-empty';empty.textContent='No results';empty.setAttribute('role','status');container.appendChild(empty)}
    empty.style.display='';
  }else if(empty){empty.style.display='none'}
}

function fmtDate(d){
  if(!d)return '';
  const dt=new Date(d+'T12:00:00');
  if(isNaN(dt.getTime()))return '';
  return dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
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
    timer=setTimeout(run,120);
  });
  i.addEventListener('keydown',e=>{
    if(e.key==='Escape'){clearTimeout(timer);i.value='';run();i.blur()}
  });
  if(x)x.addEventListener('click',()=>{clearTimeout(timer);i.value='';run();i.focus()});
}
wireSearch('#psearch','#plist');
wireSearch('#csearch','#cvlist');
wireSearch('#usearch','#ulist');
wireSearch('#lsearch','#llist');

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
  function add(title,sub,type,act){items.push({q:(title+' '+(sub||'')).toLowerCase(),tl:title.toLowerCase(),title:title,type:type,act:act})}
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
  const words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return [];
  const items=cmdItems||[];
  const scored=[];
  items.forEach(it=>{
    let total=0;
    const ok=words.every(w=>{
      const ts=scoreWord(w,it.tl)*1.5;
      const fs=scoreWord(w,it.q);
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

  if(key==='j'||key==='ArrowDown'){e.preventDefault();kbMove(1);return}
  if(key==='k'||key==='ArrowUp'){e.preventDefault();kbMove(-1);return}

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
