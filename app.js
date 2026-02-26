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
var linkCategories=['Personal','Career','Initiatives','Academic','Modules','Community','Miscellaneous'];

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
          a.href='mailto:ventures@saputra.co.uk?cc=duke%40saputra.co.uk&subject='+encodeURIComponent('Inquiry: '+x.title)+'&body='+emailBody;
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
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,cats:linkCategories,si:'#lsearch',sub:function(x){return x.url.replace(/^https?:\/\//,'').replace(/^www\./,'').replace(/\/$/,'')}})}

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
    p.forEach(function(x,i){
      var a=document.createElement('a');
      a.className='ucard';
      a.href='/updates/'+x.file.replace('.md','');
      a.setAttribute('data-q',(x.title+' '+x.date).toLowerCase());
      var t=document.createElement('div');t.className='ut';t.textContent=x.title;
      var d=document.createElement('div');d.className='ud';d.textContent=fmtDate(x.date);
      a.appendChild(t);a.appendChild(d);el.appendChild(a);
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
    var back=document.createElement('a');
    back.className='post-back';
    back.href='/updates';
    back.title='Back to all updates';
    back.innerHTML='<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="15 18 9 12 15 6"/></svg>Back';
    // innerHTML required for rendered markdown — source: first-party .md files
    var content=document.createElement('div');
    content.className='pcontent';
    content.innerHTML=html;
    var h1=content.querySelector('h1');
    if(h1)document.title='DS | '+h1.textContent;
    el.appendChild(back);el.appendChild(content);
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

// Fuzzy search — checks if all chars of q appear in order within text
function fuzzy(q,text){
  for(var qi=0,ti=0;ti<text.length&&qi<q.length;ti++){
    if(text[ti]===q[qi])qi++;
  }
  return qi===q.length;
}

// Score how well a word matches text (0 = no match)
function scoreWord(w,t,nf){
  var i=t.indexOf(w);
  if(i===-1)return(!nf&&fuzzy(w,t))?1:0;
  return i===0?4:t[i-1]===' '?3:2;
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

  scored.sort(function(a,b){return b.score-a.score});
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
if(themeBtn){
  var isDark=document.documentElement.getAttribute('data-theme')==='dark';
  themeBtn.textContent=isDark?'Light':'Dark';
  themeBtn.addEventListener('click',function(){
    var dark=document.documentElement.getAttribute('data-theme')==='dark';
    var next=dark?'light':'dark';
    if(next==='dark'){
      document.documentElement.setAttribute('data-theme','dark');
      localStorage.setItem('theme','dark');
    }else{
      document.documentElement.removeAttribute('data-theme');
      localStorage.removeItem('theme');
    }
    themeBtn.textContent=next==='dark'?'Light':'Dark';
    var mc=next==='dark'?'#1C1C1E':'#FAFAFA';
    var cs=next==='dark'?'dark':'light';
    var mt=$('meta[name="theme-color"]');if(mt)mt.content=mc;
    var ms=$('meta[name="color-scheme"]');if(ms)ms.content=cs;
  });
}

// Init
window.addEventListener('popstate',route);
route();

// Prefetch all data during idle time so tab switches are instant
var ric=window.requestIdleCallback||function(cb){setTimeout(cb,200)};
ric(function(){getProjects();getCV();getPosts();getLinks()});

})();
