(function(){'use strict';

var $=function(s){return document.querySelector(s)};
var $$=function(s){return document.querySelectorAll(s)};

// State
var posts=null;
var projects=null;
var links=null;
var cv=null;
var postCache={};
var postVer=0;
var validPages=['home','projects','cv','updates','links'];
var titles={home:'Home',projects:'Projects',cv:'CV',updates:'Updates',links:'Links'};
var emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');
var CHECK_SVG='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 12 9 17 20 6"/></svg>';
function cleanUrl(u){return u.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'')}
function mailtoUrl(t){return 'mailto:ventures@saputra.co.uk?cc=duke%40saputra.co.uk&subject='+encodeURIComponent('Inquiry: '+t)+'&body='+emailBody}

// Handle 404.html redirect (validate path is relative to prevent cross-origin crash)
var redir=new URLSearchParams(location.search).get('p');
if(redir){try{if(redir.startsWith('/')&&!redir.startsWith('//'))history.replaceState(null,'',redir);else history.replaceState(null,'','/')}catch(e){history.replaceState(null,'','/')}}

// Router
function route(){
  var path=location.pathname;
  if(path!=='/'&&path.endsWith('/'))path=path.slice(0,-1);
  var parts=path.split('/').filter(Boolean);
  var page=parts[0]||'home';
  if(validPages.indexOf(page)===-1){
    history.replaceState(null,'','/');
    page='home';
  }
  var slug=parts.slice(1).join('/');
  document.title='DS | '+(titles[page]||'Home');

  var active=$('.page.active');
  if(!active||active.id!==page){
    $$('.page').forEach(function(p){
      if(p.id===page){p.classList.add('active')}
      else{p.classList.remove('active')}
    });
  }
  window.scrollTo(0,0);

  $$('.tabs a').forEach(function(a){
    var href=a.getAttribute('href');
    var isActive=(page==='home'&&href==='/')||(page!=='home'&&href==='/'+page);
    a.classList.toggle('active',isActive);
    if(isActive)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });



  if(page==='projects'){showProjects()}
  if(page==='cv'){showCV()}
  if(page==='links'){showLinks()}
  if(page==='updates'){
    var wrap=$('#usearch');
    if(wrap)wrap=wrap.parentNode;
    if(slug){if(wrap)wrap.style.display='none';showPost(slug)}
    else{if(wrap)wrap.style.display='block';showList()}
  }
}

// Copy buttons (with clipboard API fallback and error handling)
// Note: innerHTML below uses hardcoded SVG string, not user content — safe from XSS
document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(!btn)return;
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
    btn._t1=setTimeout(function(){
      btn.style.opacity='0';
      btn._t2=setTimeout(function(){
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
    navigator.clipboard.writeText(text).then(done).catch(function(){try{legacy()}catch(e){}});
  }else{try{legacy()}catch(e){}}
});

// SPA link interception
document.addEventListener('click',function(e){
  if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button!==0)return;
  if(e.target.closest('.copy-btn'))return;
  var a=e.target.closest('a[href]');
  if(!a)return;
  var href=a.getAttribute('href');
  if(!href.startsWith('/')||href.startsWith('//')||a.hasAttribute('download')||a.target==='_blank')return;
  var parts=href.split('/').filter(Boolean);
  var page=parts[0];
  if(!page||validPages.indexOf(page)!==-1){
    e.preventDefault();
    if(href!==location.pathname)history.pushState(null,'',href);
    route();
  }
});

// Data loaders (with retry cap and error logging)
function makeLoader(url,cb){
  var p=null,fails=0;
  return function(){
    if(p)return p;
    if(fails>=3)return Promise.resolve([]);
    p=fetch(url,{cache:'no-cache'})
      .then(function(r){if(!r.ok)throw new Error(url+' HTTP '+r.status);return r.json()})
      .then(function(d){fails=0;return cb(d)})
      .catch(function(e){p=null;fails++;console.error('Load failed:',e);return []});
    return p;
  };
}
var getProjects=makeLoader('/projects/projects.json',function(d){projects=d;return d});
var getLinks=makeLoader('/links/links.json',function(d){links=d;return d});
var getCV=makeLoader('/cv/cv.json',function(d){cv=d;return d});
var getPosts=makeLoader('/updates/posts.json',function(d){
  d.sort(function(a,b){return b.date>a.date?1:b.date<a.date?-1:a.title.localeCompare(b.title)});
  posts=d;return d;
});

var projectCategories=['Mobile','Web','Extensions','In Development'];
var linkCategories=['Modules','Career','Initiatives','Academic','Community','Personal','Miscellaneous'];

// Chevron SVG for card arrows
var CHEVRON='<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18l6-6-6-6"/></svg>';

// Render categorized cards (projects & links)
function showCards(cfg){
  var el=$(cfg.el);
  if(cfg.data&&el.children.length)return;
  while(el.firstChild)el.removeChild(el.firstChild);
  cfg.get().then(function(items){
    var sw=$(cfg.si);
    if(!items.length){
      if(sw)sw.parentNode.style.display='none';
      var d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    cfg.cats.forEach(function(cat){
      var filtered=items.filter(function(x){return x.category===cat}).sort(function(a,b){return a.title.localeCompare(b.title)});
      if(!filtered.length)return;
      var sec=document.createElement('div');sec.className='link-sec';
      var h=document.createElement('h3');h.textContent=cat;sec.appendChild(h);
      filtered.forEach(function(x){
        var a=document.createElement('a');a.className='pcard';
        if(x.url==='#'){
          a.href=mailtoUrl(x.title);
        }else{a.href=x.url;a.target='_blank';a.rel='noopener noreferrer'}
        a.setAttribute('data-q',(x.title+' '+cfg.sub(x)+' '+x.category).toLowerCase());
        var inf=document.createElement('div');inf.className='pinf';
        var pt=document.createElement('div');pt.className='pt';pt.textContent=x.title;
        var pd=document.createElement('div');pd.className='pd';pd.textContent=cfg.sub(x);
        inf.appendChild(pt);inf.appendChild(pd);
        var arr=document.createElement('div');arr.className='arr';
        arr.innerHTML=CHEVRON;
        a.appendChild(inf);a.appendChild(arr);sec.appendChild(a);
      });
      el.appendChild(sec);
    });
    var si=$(cfg.si);if(si&&si.value){filterList(si,el);var x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

function showProjects(){showCards({el:'#plist',data:projects,get:getProjects,cats:projectCategories,si:'#psearch',sub:function(x){return x.subtitle}})}
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,cats:linkCategories,si:'#lsearch',sub:function(x){return cleanUrl(x.url)}})}

// Render CV
function showCV(){
  var el=$('#cvlist');
  if(cv&&el.children.length)return;
  while(el.firstChild)el.removeChild(el.firstChild);
  getCV().then(function(data){
    var sw=$('#csearch');
    if(!data.length){
      if(sw)sw.parentNode.style.display='none';
      var d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    data.forEach(function(section){
      var sec=document.createElement('div');sec.className='cv-sec';
      var h=document.createElement('h3');h.textContent=section.section;sec.appendChild(h);
      section.entries.forEach(function(e){
        var card=document.createElement('div');card.className='cve';
        if(e.org){
          var co=document.createElement('div');co.className='co';co.textContent=e.org;card.appendChild(co);
          if(e.role){
            var cr=document.createElement('div');cr.className='cr';cr.textContent=e.role;card.appendChild(cr);
          }
          if(e.location||e.dates){
            var meta=document.createElement('div');meta.className='cmeta';
            if(e.location){var loc=document.createElement('span');loc.textContent=e.location;meta.appendChild(loc)}
            if(e.dates){var dates=document.createElement('span');dates.textContent=e.dates;meta.appendChild(dates)}
            card.appendChild(meta);
          }
          if(e.text){
            var cn=document.createElement('div');cn.className='cn';cn.textContent=e.text;card.appendChild(cn);
          }
          if(e.pills){
            var pills=document.createElement('div');pills.className='pills';
            e.pills.forEach(function(p){
              var pill=document.createElement('span');pill.className='pill';pill.textContent=p;pills.appendChild(pill);
            });
            card.appendChild(pills);
          }
          if(e.bullets){
            var ul=document.createElement('ul');
            e.bullets.forEach(function(b){
              var li=document.createElement('li');li.textContent=b;ul.appendChild(li);
            });
            card.appendChild(ul);
          }
        }
        card.setAttribute('data-q',card.textContent.toLowerCase());
        sec.appendChild(card);
      });
      el.appendChild(sec);
    });
    var si=$('#csearch');if(si&&si.value){filterList(si,el);var x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

// Render post list
function showList(){
  var el=$('#ulist');
  if(posts&&el.querySelector('.ucard')){
    var sw=$('#usearch');if(sw)sw.parentNode.style.display='block';
    if(sw&&sw.value)filterList(sw,el);
    return;
  }
  el._saved=null;
  while(el.firstChild)el.removeChild(el.firstChild);
  getPosts().then(function(p){
    var sw=$('#usearch');
    if(!p.length){
      if(sw)sw.parentNode.style.display='none';
      var d=document.createElement('div');d.className='empty';d.textContent='Coming Soon!';
      el.appendChild(d);return;
    }
    if(sw)sw.parentNode.style.display='block';
    var curMonth='',sec;
    p.forEach(function(x){
      var ym=x.date.slice(0,7);
      if(ym!==curMonth){
        curMonth=ym;
        sec=document.createElement('div');sec.className='link-sec';
        var h=document.createElement('h3');
        h.textContent=new Date(x.date+'T00:00:00').toLocaleDateString('en-GB',{month:'long',year:'numeric'});
        sec.appendChild(h);el.appendChild(sec);
      }
      var a=document.createElement('a');
      a.className='ucard';
      a.href='/updates/'+x.file.replace('.md','');
      a.setAttribute('data-q',(x.title+' '+x.date).toLowerCase());
      var t=document.createElement('div');t.className='ut';t.textContent=x.title;
      var d=document.createElement('div');d.className='ud';d.textContent=fmtDate(x.date);
      a.appendChild(t);a.appendChild(d);sec.appendChild(a);
    });
    var si=$('#usearch');
    if(si&&si.value){filterList(si,el);var x=si.parentNode.querySelector('.search-x');if(x)x.style.display='flex'}
  });
}

// Render single post
// Note: innerHTML used here to render parsed markdown from first-party .md
// files committed by the site owner. Content is same-origin and trusted.
function showPost(slug){
  var el=$('#ulist');
  var ver=++postVer;
  while(el.firstChild)el.removeChild(el.firstChild);
  function render(html){
    if(ver!==postVer)return;
    var content=document.createElement('div');
    content.className='pcontent';
    // Safe: html is parsed from first-party .md files committed by site owner
    content.innerHTML=html;
    var h1=content.querySelector('h1');
    if(h1)document.title='DS | '+h1.textContent;
    el.appendChild(content);
    window.scrollTo(0,0);
  }
  if(postCache[slug]){render(postCache[slug]);return}
  fetch('/updates/'+encodeURIComponent(slug)+'.md')
    .then(function(r){if(!r.ok)throw new Error('Post '+r.status);return r.text()})
    .then(function(md){
      var html=parseMd(md);
      postCache[slug]=html;
      render(html);
    })
    .catch(function(e){
      if(ver!==postVer)return;
      console.error('Post load failed:',slug,e);
      var msg=document.createElement('div');msg.className='empty';
      msg.textContent='Unable to load this post. Please check your connection and try again.';
      el.appendChild(msg);
    });
}

// Markdown parser — processes first-party .md files only
function parseMd(md){
  md=md.replace(/^---[\s\S]*?---\n?/,'');
  var h='',code=false,ul=false,ol=false;
  var lines=md.split('\n');
  for(var i=0;i<lines.length;i++){
    var line=lines[i];
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
    .replace(/`([^`]+)`/g,function(_,c){return '<code>'+esc(c)+'</code>'})
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,function(_,alt,src){
      return '<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,function(_,text,href){
      return '<a href="'+esc(href)+'" target="_blank" rel="noopener noreferrer">'+esc(text)+'</a>';
    });
}

function esc(s){
  return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// Score how well a word matches text (0 = no match)
// 5 = exact, 4 = prefix, 3 = word-boundary, 2 = substring, 0.5-1.0 = fuzzy (by tightness)
function scoreWord(w,t,nf){
  var i=t.indexOf(w);
  if(i!==-1){
    if(i===0&&t.length===w.length)return 5;
    if(i===0)return 4;
    if(t[i-1]===' ')return 3;
    return 2;
  }
  if(nf)return 0;
  for(var qi=0,ti=0,first=-1,last=0;ti<t.length&&qi<w.length;ti++){
    if(t[ti]===w[qi]){if(first<0)first=ti;last=ti;qi++}
  }
  if(qi<w.length)return 0;
  return 0.5+w.length/(last-first+1)*0.5;
}

// Generic list filter — scores, sorts, flattens results when searching
function filterList(input,container){
  var q=input.value.trim().toLowerCase();
  var words=q.split(/\s+/).filter(Boolean);
  var secs=[].slice.call(container.querySelectorAll('.link-sec,.cv-sec'));
  var cards=[].slice.call(container.querySelectorAll('.pcard,.cve,.ucard'));

  if(!container._saved&&cards.length){
    container._saved=cards.map(function(c){return{el:c,parent:c.parentNode}});
  }

  // No query — restore original categorized layout instantly
  if(!words.length){
    if(container._saved){
      container._saved.forEach(function(s){
        s.parent.appendChild(s.el);s.el.style.display='';
      });
    }
    secs.forEach(function(s){s.style.display=''});
    var empty=container.querySelector('.search-empty');
    if(empty)empty.style.display='none';
    return;
  }

  // Score each card
  var scored=[];
  cards.forEach(function(c){
    var t=c.getAttribute('data-q')||c.textContent.toLowerCase();
    var cv=c.classList.contains('cve');
    var total=0;
    var ok=words.every(function(w){var s=scoreWord(w,t,cv);total+=s;return s>0});
    if(ok)scored.push({el:c,score:total});
    else c.style.display='none';
  });

  scored.sort(function(a,b){return b.score-a.score||(a.el.getAttribute('data-q')||'').localeCompare(b.el.getAttribute('data-q')||'')});
  secs.forEach(function(s){s.style.display='none'});

  scored.forEach(function(s,idx){
    if(idx<10){
      s.el.style.display='';
      container.appendChild(s.el);
    }else{s.el.style.display='none'}
  });

  // Empty state
  var empty=container.querySelector('.search-empty');
  if(!scored.length){
    if(!empty){empty=document.createElement('div');empty.className='empty search-empty';empty.textContent='No results';container.appendChild(empty)}
    empty.style.display='';
  }else if(empty){empty.style.display='none'}
}

function fmtDate(d){
  if(!d)return '';
  var dt=new Date(d+'T00:00:00');
  if(isNaN(dt.getTime()))return '';
  return dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
}

// Search wiring with debounce
function wireSearch(iid,cid){
  var i=$(iid),c=$(cid);
  if(!i||!c)return;
  var x=i.parentNode.querySelector('.search-x');
  var timer;
  function run(){
    filterList(i,c);
    if(x)x.style.display=i.value?'flex':'none';
  }
  i.addEventListener('input',function(){
    clearTimeout(timer);
    if(x)x.style.display=i.value?'flex':'none';
    timer=setTimeout(run,120);
  });
  i.addEventListener('keydown',function(e){
    if(e.key==='Escape'){clearTimeout(timer);i.value='';run();i.blur()}
  });
  if(x)x.addEventListener('click',function(){clearTimeout(timer);i.value='';run();i.focus()});
}
wireSearch('#psearch','#plist');
wireSearch('#csearch','#cvlist');
wireSearch('#usearch','#ulist');
wireSearch('#lsearch','#llist');

// Theme toggle
var themeBtn=$('#theme-toggle');
var themeLabel=$('#theme-label');
var themeOrder=['light','sepia','dark'];
var themeColors={light:'#FAFAFA',sepia:'#F5EDDA',dark:'#1C1C1E'};
function setThemeLabel(t){if(themeLabel)themeLabel.textContent='Theme: '+t[0].toUpperCase()+t.slice(1)}
function curTheme(){return document.documentElement.getAttribute('data-theme')||'light'}
function applyTheme(t){
  if(t==='light'){document.documentElement.removeAttribute('data-theme')}
  else{document.documentElement.setAttribute('data-theme',t)}
  setThemeLabel(t);
  var mt=$('meta[name="theme-color"]');if(mt)mt.content=themeColors[t];
  var ms=$('meta[name="color-scheme"]');if(ms)ms.content=t==='dark'?'dark':'light';
}
if(themeBtn){
  setThemeLabel(curTheme());
  themeBtn.addEventListener('click',function(e){
    e.preventDefault();
    var cur=curTheme();
    var next=themeOrder[(themeOrder.indexOf(cur)+1)%themeOrder.length];
    if(next==='light')localStorage.removeItem('theme');
    else localStorage.setItem('theme',next);
    applyTheme(next);
  });
}
document.addEventListener('visibilitychange',function(){
  if(document.hidden)return;
  var stored=localStorage.getItem('theme')||'light';
  if(stored!==curTheme())applyTheme(stored);
});

// Command palette
var cmdOverlay=document.createElement('div');cmdOverlay.className='cmd-overlay';
var cmdPalette=document.createElement('div');cmdPalette.className='cmd-palette';cmdPalette.setAttribute('role','dialog');cmdPalette.setAttribute('aria-modal','true');cmdPalette.setAttribute('aria-label','Search');
var cmdInput=document.createElement('input');cmdInput.className='cmd-input';cmdInput.type='text';cmdInput.placeholder='Search';cmdInput.autocomplete='off';cmdInput.spellcheck=false;
var cmdResults=document.createElement('div');cmdResults.className='cmd-results';
cmdPalette.appendChild(cmdInput);cmdPalette.appendChild(cmdResults);cmdOverlay.appendChild(cmdPalette);
document.body.appendChild(cmdOverlay);

var cmdOpen=false;
var cmdIdx=-1;
var cmdItems=null;

function openCmd(){
  if(cmdOpen)return;
  if(qrOpen)closeQR();
  cmdOpen=true;
  cmdInput.value='';
  cmdResults.textContent='';
  cmdIdx=-1;
  cmdItems=cmdBuildItems();
  document.body.style.overflow='hidden';
  cmdOverlay.classList.add('open');
  requestAnimationFrame(function(){requestAnimationFrame(function(){cmdInput.focus()})});
}

function closeCmd(){
  if(!cmdOpen)return;
  cmdOpen=false;
  cmdItems=null;
  document.body.style.overflow='';
  cmdOverlay.classList.remove('open');
  cmdInput.blur();
}

cmdOverlay.addEventListener('click',function(e){
  if(e.target===cmdOverlay)closeCmd();
});

var qrOverlay=document.createElement('div');
qrOverlay.className='qr-overlay';
qrOverlay.setAttribute('role','dialog');
qrOverlay.setAttribute('aria-modal','true');
qrOverlay.setAttribute('aria-label','QR Code');
var qrCard=document.createElement('div');qrCard.className='qr-card';
var qrImg=document.createElement('img');qrImg.alt='QR code to saputra.co.uk';qrImg.width=23;qrImg.height=23;
qrCard.appendChild(qrImg);qrOverlay.appendChild(qrCard);document.body.appendChild(qrOverlay);

var qrOpen=false;
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
var nameCard=$('.name-card');
if(nameCard){
  nameCard.addEventListener('click',function(e){e.preventDefault();openQR()});
  nameCard.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();openQR()}});
}
qrOverlay.addEventListener('click',function(e){if(e.target===qrOverlay)closeQR()});

function cmdBuildItems(){
  var items=[];
  function add(title,sub,type,act){items.push({q:(title+' '+(sub||'')).toLowerCase(),tl:title.toLowerCase(),title:title,type:type,act:act})}
  validPages.forEach(function(p){
    add(titles[p],'','Page',function(){history.pushState(null,'',p==='home'?'/':'/'+p);route()});
  });
  if(projects)projects.forEach(function(x){
    add(x.title,x.subtitle,'Project',function(){
      if(x.url==='#'){location.href=mailtoUrl(x.title)}
      else window.open(x.url,'_blank')
    });
  });
  if(links)links.forEach(function(x){
    add(x.title,cleanUrl(x.url),'Link',function(){window.open(x.url,'_blank')});
  });
  if(posts)posts.forEach(function(x){
    add(x.title,fmtDate(x.date),'Post',function(){
      history.pushState(null,'','/updates/'+x.file.replace('.md',''));route();
    });
  });
  if(cv)cv.forEach(function(sec){
    sec.entries.forEach(function(e){
      if(!e.org)return;
      add(e.org,e.role||e.text||'','CV',function(){
        history.pushState(null,'','/cv');route();
      });
    });
  });
  return items;
}

// Type priority: pages are primary nav, content items next, CV last
var cmdTypePri={Page:4,Project:3,Link:3,Post:3,CV:2};

function cmdSearch(q){
  var words=q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if(!words.length)return [];
  var items=cmdItems||[];
  var scored=[];
  items.forEach(function(it){
    var total=0;
    var ok=words.every(function(w){
      var ts=scoreWord(w,it.tl)*1.5;
      var fs=scoreWord(w,it.q);
      var s=ts>fs?ts:fs;
      total+=s;return s>0;
    });
    if(ok)scored.push({item:it,score:total+(cmdTypePri[it.type]||0)*0.1});
  });
  scored.sort(function(a,b){return b.score-a.score||a.item.title.localeCompare(b.item.title)});
  return scored.slice(0,8).map(function(s){return s.item});
}

var cmdTimer;
cmdInput.addEventListener('input',function(){
  clearTimeout(cmdTimer);
  cmdTimer=setTimeout(cmdRender,80);
});

function cmdRender(){
  var results=cmdSearch(cmdInput.value);
  cmdResults.textContent='';
  cmdIdx=-1;
  if(!cmdInput.value.trim())return;
  if(!results.length){
    var empty=document.createElement('div');empty.className='cmd-empty';empty.textContent='Nothing Found';
    cmdResults.appendChild(empty);return;
  }
  results.forEach(function(r){
    var row=document.createElement('button');row.className='cmd-row';
    var t=document.createElement('span');t.className='cmd-row-title';t.textContent=r.title;
    var tag=document.createElement('span');tag.className='cmd-row-type';tag.textContent=r.type;
    row.appendChild(t);row.appendChild(tag);
    row.addEventListener('click',function(){r.act();closeCmd()});
    cmdResults.appendChild(row);
  });
}

function cmdNav(dir){
  var rows=cmdResults.querySelectorAll('.cmd-row');
  if(!rows.length)return;
  if(cmdIdx>=0&&rows[cmdIdx])rows[cmdIdx].classList.remove('cmd-active');
  cmdIdx+=dir;
  if(cmdIdx<0)cmdIdx=rows.length-1;
  if(cmdIdx>=rows.length)cmdIdx=0;
  rows[cmdIdx].classList.add('cmd-active');
  rows[cmdIdx].scrollIntoView({block:'nearest'});
}

cmdInput.addEventListener('keydown',function(e){
  if(e.key==='ArrowDown'||(!e.shiftKey&&e.key==='Tab')){e.preventDefault();cmdNav(1)}
  else if(e.key==='ArrowUp'||(e.shiftKey&&e.key==='Tab')){e.preventDefault();cmdNav(-1)}
  else if(e.key==='Enter'){
    e.preventDefault();
    var rows=cmdResults.querySelectorAll('.cmd-row');
    if(cmdIdx>=0&&rows[cmdIdx])rows[cmdIdx].click();
    else if(rows.length)rows[0].click();
  }
  else if(e.key==='Escape'){e.preventDefault();closeCmd()}
});

// Keyboard shortcuts
var kbIdx=-1,kbCards=[],kbPrev=-1;

function kbGetCards(){
  var active=$('.page.active');
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
      var vh=window.innerHeight;
      kbIdx=dir>0?0:kbCards.length-1;
      for(var i=dir>0?0:kbCards.length-1;dir>0?i<kbCards.length:i>=0;i+=dir){
        var r=kbCards[i].getBoundingClientRect();
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

document.addEventListener('mousemove',function(){if(kbIdx>=0)kbClear(true)},{passive:true});

var tabPaths=['/','/projects','/cv','/updates','/links'];
function isPost(){return location.pathname.startsWith('/updates/')&&location.pathname.split('/').length>2}

document.addEventListener('keydown',function(e){
  if((e.metaKey||e.ctrlKey)&&e.key==='k'){
    e.preventDefault();
    if(cmdOpen)closeCmd();else openCmd();
    return;
  }

  if(cmdOpen)return;

  if(qrOpen){if(e.key==='Escape')closeQR();return}

  var tag=document.activeElement&&document.activeElement.tagName;
  if(tag==='INPUT'||tag==='TEXTAREA'){
    if(e.key==='Escape'){document.activeElement.blur();kbClear()}
    return;
  }

  if(e.metaKey||e.ctrlKey||e.altKey)return;

  var key=e.key;

  if(key>='1'&&key<='5'){
    var idx=+key-1;
    var path=tabPaths[idx];
    if(path!==location.pathname){history.pushState(null,'',path);route()}
    kbClear();return;
  }

  if(key==='/'){
    var page=$('.page.active');
    if(!page)return;
    var si=page.querySelector('.search');
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
    var ci=tabPaths.indexOf(location.pathname==='/'?'/':location.pathname);
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
window.addEventListener('popstate',function(){closeCmd();closeQR();kbClear();route()});
route();

// Prefetch all data during idle time so tab switches are instant
var ric=window.requestIdleCallback||function(cb){setTimeout(cb,200)};
ric(function(){getProjects();getCV();getPosts();getLinks()});

})();
