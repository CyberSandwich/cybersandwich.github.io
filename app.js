(function(){'use strict';

var $=function(s){return document.querySelector(s)};
var $$=function(s){return document.querySelectorAll(s)};

// State
var posts=null;
var projects=null;
var links=null;
var cv=null;
var validPages=['home','projects','cv','updates','links'];
var titles={home:'Home',projects:'Projects',cv:'CV',updates:'Updates',links:'Links'};
var emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');

// Handle 404.html redirect
var redir=new URLSearchParams(location.search).get('p');
if(redir){history.replaceState(null,'',redir)}

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
    window.scrollTo(0,0);
  }

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
    else{if(wrap)wrap.style.display='';showList()}
  }
}

// Copy buttons
document.addEventListener('click',function(e){
  var btn=e.target.closest('.copy-btn');
  if(!btn)return;
  e.preventDefault();
  var text=btn.getAttribute('data-copy');
  navigator.clipboard.writeText(text).then(function(){
    btn.classList.add('copied');
    btn.textContent='';
    var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
    svg.setAttribute('viewBox','0 0 24 24');
    svg.setAttribute('fill','none');
    svg.setAttribute('stroke','currentColor');
    svg.setAttribute('stroke-width','2.5');
    svg.setAttribute('stroke-linecap','round');
    svg.setAttribute('stroke-linejoin','round');
    var poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
    poly.setAttribute('points','4 12 9 17 20 6');
    svg.appendChild(poly);
    btn.appendChild(svg);
    setTimeout(function(){
      btn.style.opacity='0';
      setTimeout(function(){
        btn.classList.remove('copied');
        btn.textContent='Copy';
        btn.style.opacity='';
      },200);
    },1500);
  });
});

// SPA link interception
document.addEventListener('click',function(e){
  var a=e.target.closest('a[href]');
  if(!a)return;
  var href=a.getAttribute('href');
  if(!href.startsWith('/')||href.startsWith('//')||a.hasAttribute('download')||a.target==='_blank')return;
  var parts=href.split('/').filter(Boolean);
  var page=parts[0];
  if(!page||validPages.indexOf(page)!==-1){
    e.preventDefault();
    history.pushState(null,'',href);
    route();
  }
});

// Data loaders
function makeLoader(url,cb){
  var p=null;
  return function(){
    if(p)return p;
    p=fetch(url,{cache:'no-cache'})
      .then(function(r){if(!r.ok)throw 0;return r.json()})
      .then(cb)
      .catch(function(){return []});
    return p;
  };
}
var getProjects=makeLoader('/projects/projects.json',function(d){projects=d;return d});
var getLinks=makeLoader('/links/links.json',function(d){links=d;return d});
var getCV=makeLoader('/cv/cv.json',function(d){cv=d;return d});
var getPosts=makeLoader('/updates/posts.json',function(d){
  d.sort(function(a,b){return b.date>a.date?1:b.date<a.date?-1:0});
  posts=d;return d;
});

var projectCategories=['Mobile','Web','Extensions','In Development'];
var linkCategories=['Personal','Career','Initiatives','Academic','Modules','Community','Miscellaneous'];

// SVG helper
function mkSvg(d){
  var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
  svg.setAttribute('viewBox','0 0 24 24');
  svg.setAttribute('fill','none');
  svg.setAttribute('stroke','currentColor');
  svg.setAttribute('stroke-width','2');
  svg.setAttribute('stroke-linecap','round');
  svg.setAttribute('stroke-linejoin','round');
  svg.setAttribute('aria-hidden','true');
  d.split('M').filter(Boolean).forEach(function(seg){
    var path=document.createElementNS('http://www.w3.org/2000/svg','path');
    path.setAttribute('d','M'+seg);
    svg.appendChild(path);
  });
  return svg;
}

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
    var idx=0;
    cfg.cats.forEach(function(cat){
      var filtered=items.filter(function(x){return x.category===cat});
      if(!filtered.length)return;
      var sec=document.createElement('div');sec.className='link-sec';
      var h=document.createElement('h3');h.textContent=cat;sec.appendChild(h);
      filtered.forEach(function(x){
        var a=document.createElement('a');a.className='pcard';
        if(x.url==='#'){
          a.href='mailto:ventures@saputra.co.uk?cc=duke%40saputra.co.uk&subject='+encodeURIComponent('Inquiry: '+x.title)+'&body='+emailBody;
        }else{a.href=x.url;a.target='_blank';a.rel='noopener noreferrer'}
        a.setAttribute('data-q',(x.title+' '+cfg.sub(x)+' '+x.category).toLowerCase());
        a.style.animationDelay=(idx*0.04)+'s';idx++;
        var inf=document.createElement('div');inf.className='pinf';
        var pt=document.createElement('div');pt.className='pt';pt.textContent=x.title;
        var pd=document.createElement('div');pd.className='pd';pd.textContent=cfg.sub(x);
        inf.appendChild(pt);inf.appendChild(pd);
        var arr=document.createElement('div');arr.className='arr';
        arr.appendChild(mkSvg('M9 18l6-6-6-6'));
        a.appendChild(inf);a.appendChild(arr);sec.appendChild(a);
      });
      el.appendChild(sec);
    });
    var si=$(cfg.si);if(si&&si.value)filterList(si,el);
  });
}

function showProjects(){showCards({el:'#plist',data:projects,get:getProjects,cats:projectCategories,si:'#psearch',sub:function(x){return x.subtitle}})}
function showLinks(){showCards({el:'#llist',data:links,get:getLinks,cats:linkCategories,si:'#lsearch',sub:function(x){return x.url.replace(/^https?:\/\//,'')}})}

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
    var idx=0;
    data.forEach(function(section){
      var sec=document.createElement('div');sec.className='cv-sec';
      var h=document.createElement('h3');h.textContent=section.section;sec.appendChild(h);
      section.entries.forEach(function(e){
        var card=document.createElement('div');card.className='cve';
        if(e.org){
          var co=document.createElement('div');co.className='co';co.textContent=e.org;card.appendChild(co);
          var cr=document.createElement('div');cr.className='cr';cr.textContent=e.role;card.appendChild(cr);
          var meta=document.createElement('div');meta.className='cmeta';
          var loc=document.createElement('span');loc.textContent=e.location;
          var dates=document.createElement('span');dates.textContent=e.dates;
          meta.appendChild(loc);meta.appendChild(dates);card.appendChild(meta);
          if(e.highlight){
            var hl=document.createElement('div');hl.className='hl';hl.textContent=e.highlight;card.appendChild(hl);
          }
          if(e.notes){
            e.notes.forEach(function(n){
              var cn=document.createElement('div');cn.className='cn';cn.textContent=n;card.appendChild(cn);
            });
          }
          if(e.bullets){
            var ul=document.createElement('ul');
            e.bullets.forEach(function(b){
              var li=document.createElement('li');li.textContent=b;ul.appendChild(li);
            });
            card.appendChild(ul);
          }
        }
        if(e.subs){
          e.subs.forEach(function(sub){
            var st=document.createElement('div');st.className='cv-sub';st.textContent=sub.title;card.appendChild(st);
            if(sub.text){
              var cn=document.createElement('div');cn.className='cn';cn.textContent=sub.text;card.appendChild(cn);
            }
            if(sub.pills){
              var pills=document.createElement('div');pills.className='pills';
              sub.pills.forEach(function(p){
                var pill=document.createElement('span');pill.className='pill';pill.textContent=p;pills.appendChild(pill);
              });
              card.appendChild(pills);
            }
          });
        }
        card.setAttribute('data-q',((e.org?e.org+' ':'')+(e.role?e.role+' ':'')+card.textContent).toLowerCase());
        card.style.animationDelay=(idx*0.04)+'s';idx++;
        sec.appendChild(card);
      });
      el.appendChild(sec);
    });
    var si=$('#csearch');if(si&&si.value)filterList(si,el);
  });
}

// Render post list
function showList(){
  var el=$('#ulist');
  if(posts&&el.querySelector('.ucard'))return;
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
      a.style.animationDelay=(i*0.04)+'s';
      var t=document.createElement('div');t.className='ut';t.textContent=x.title;
      var d=document.createElement('div');d.className='ud';d.textContent=fmtDate(x.date);
      a.appendChild(t);a.appendChild(d);el.appendChild(a);
    });
    var si=$('#usearch');
    if(si&&si.value)filterList(si,el);
  });
}

// Render single post
// Note: innerHTML used here to render parsed markdown from first-party .md
// files committed by the site owner. Content is same-origin and trusted.
function showPost(slug){
  var el=$('#ulist');
  while(el.firstChild)el.removeChild(el.firstChild);
  fetch('/updates/'+encodeURIComponent(slug)+'.md')
    .then(function(r){if(!r.ok)throw 0;return r.text()})
    .then(function(md){
      var back=document.createElement('a');
      back.className='post-back';
      back.href='/updates';
      back.title='Back to all updates';
      back.textContent='Back';
      var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('width','16');svg.setAttribute('height','16');
      svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('fill','none');
      svg.setAttribute('stroke','currentColor');svg.setAttribute('stroke-width','2');
      svg.setAttribute('stroke-linecap','round');svg.setAttribute('stroke-linejoin','round');
      svg.setAttribute('aria-hidden','true');
      var poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
      poly.setAttribute('points','15 18 9 12 15 6');
      svg.appendChild(poly);
      back.insertBefore(svg,back.firstChild);

      // innerHTML required for rendered markdown — source: first-party .md files
      var content=document.createElement('div');
      content.className='pcontent';
      content.innerHTML=parseMd(md);

      el.appendChild(back);el.appendChild(content);
      window.scrollTo(0,0);
    })
    .catch(function(){
      history.replaceState(null,'','/updates');
      route();
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
    .replace(/`([^`]+)`/g,'<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>')
    .replace(/\*([^*]+)\*/g,'<em>$1</em>')
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g,function(_,alt,src){
      return '<img src="'+esc(src)+'" alt="'+esc(alt)+'" loading="lazy">';
    })
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g,function(_,text,href){
      return '<a href="'+esc(href)+'" target="_blank" rel="noopener">'+esc(text)+'</a>';
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
  var wasSearching=container._searching;

  if(!container._saved&&cards.length){
    container._saved=cards.map(function(c){return{el:c,parent:c.parentNode}});
  }

  // No query — restore original categorized layout instantly
  if(!words.length){
    container._searching=false;
    if(container._saved){
      container._saved.forEach(function(s){
        s.parent.appendChild(s.el);s.el.style.display='';
        s.el.style.animation='none';s.el.style.animationDelay='';
      });
    }
    secs.forEach(function(s){s.style.display=''});
    var empty=container.querySelector('.search-empty');
    if(empty)empty.style.display='none';
    return;
  }

  container._searching=true;

  // Score each card
  var scored=[];
  cards.forEach(function(c){
    var t=c.getAttribute('data-q')||c.textContent.toLowerCase();
    var cv=c.classList.contains('cve');
    var total=0;
    var ok=words.every(function(w){var s=scoreWord(w,t,cv);total+=s;return s>0});
    if(ok)scored.push({el:c,score:total});
    else{c.style.display='none';c.style.animation='none'}
  });

  scored.sort(function(a,b){return b.score-a.score});
  secs.forEach(function(s){s.style.display='none'});

  // Animate on first search entry; instant updates while refining
  var animate=!wasSearching;
  if(animate){
    scored.forEach(function(s){s.el.style.animation='none'});
    void container.offsetHeight;
  }

  scored.forEach(function(s,idx){
    if(idx<10){
      s.el.style.display='';
      s.el.style.animation=animate?'':'none';
      s.el.style.animationDelay=animate?(idx*0.03)+'s':'';
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
  var dt=new Date(d+'T00:00:00');
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

// Init
window.addEventListener('popstate',route);
route();

})();
