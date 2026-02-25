(function(){'use strict';

var $=function(s){return document.querySelector(s)};
var $$=function(s){return document.querySelectorAll(s)};

// State
var posts=null;
var projects=null;
var links=null;
var validPages=['home','projects','cv','updates','links'];
var emailBody=encodeURIComponent('Hi Duke,\n\nName: \nRole: \nOrganization: \nWebsite/LinkedIn: \n\nInquiry & Desired Outcome: \nDeadline: \nBest Contact & Availability: ');

// Handle 404.html redirect
var sp=new URLSearchParams(location.search);
var redir=sp.get('p');
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
  if(page==='links'){showLinks()}
  if(page==='updates'){
    var us=$('#usearch');
    if(slug){if(us)us.style.display='none';showPost(slug)}
    else{if(us)us.style.display='';showList()}
  }
}

// SPA link interception
document.addEventListener('click',function(e){
  var a=e.target.closest('a[href]');
  if(!a)return;
  var href=a.getAttribute('href');
  if(!href.startsWith('/')||href.startsWith('//')||a.hasAttribute('download'))return;
  var parts=href.split('/').filter(Boolean);
  var page=parts[0];
  if(!page||validPages.indexOf(page)!==-1){
    e.preventDefault();
    history.pushState(null,'',href);
    route();
  }
});

// Fetch and render projects
var projectsPromise=null;
function getProjects(){
  if(projectsPromise)return projectsPromise;
  projectsPromise=fetch('/projects/projects.json',{cache:'no-cache'})
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .then(function(p){projects=p;return projects})
    .catch(function(){return []});
  return projectsPromise;
}

var projectCategories=['Launched','In Development'];

function showProjects(){
  var el=$('#plist');
  if(projects&&el.children.length)return;
  while(el.firstChild)el.removeChild(el.firstChild);
  getProjects().then(function(p){
    if(!p.length){
      var emptyDiv=document.createElement('div');
      emptyDiv.className='empty';
      emptyDiv.textContent='Coming Soon!';
      el.appendChild(emptyDiv);
      return;
    }
    var idx=0;
    projectCategories.forEach(function(cat){
      var items=p.filter(function(x){return x.category===cat});
      if(!items.length)return;
      var sec=document.createElement('div');
      sec.className='link-sec';
      var h=document.createElement('h3');
      h.textContent=cat;
      sec.appendChild(h);
      items.forEach(function(x){
        var a=document.createElement('a');
        a.className='pcard';
        if(x.category==='In Development'){
          a.href='mailto:ventures@saputra.co.uk?cc=duke%40saputra.co.uk&subject='+encodeURIComponent('Inquiry: '+x.title)+'&body='+emailBody;
        } else {
          a.href=x.url;
          if(x.url.startsWith('http')){a.target='_blank';a.rel='noopener noreferrer'}
        }
        a.setAttribute('data-q',(x.title+' '+x.subtitle+' '+x.category).toLowerCase());
        a.style.animationDelay=(idx*0.04)+'s';
        idx++;

        var inf=document.createElement('div');
        inf.className='pinf';
        var pt=document.createElement('div');
        pt.className='pt';pt.textContent=x.title;
        var pd=document.createElement('div');
        pd.className='pd';pd.textContent=x.subtitle;
        inf.appendChild(pt);inf.appendChild(pd);

        var arr=document.createElement('div');
        arr.className='arr';
        arr.appendChild(mkSvg('M9 18l6-6-6-6'));

        a.appendChild(inf);a.appendChild(arr);
        sec.appendChild(a);
      });
      el.appendChild(sec);
    });
    var si=$('#psearch');
    if(si&&si.value)filterList(si,el);
  });
}

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

// Fetch and render links
var linksPromise=null;
function getLinks(){
  if(linksPromise)return linksPromise;
  linksPromise=fetch('/links/links.json',{cache:'no-cache'})
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .then(function(l){links=l;return links})
    .catch(function(){return []});
  return linksPromise;
}

var linkCategories=['Personal','Career','Initiatives','Academic','Modules','Community','Miscellaneous'];

function showLinks(){
  var el=$('#llist');
  if(links&&el.children.length)return;
  while(el.firstChild)el.removeChild(el.firstChild);
  getLinks().then(function(l){
    if(!l.length){
      var emptyDiv=document.createElement('div');
      emptyDiv.className='empty';
      emptyDiv.textContent='Coming Soon!';
      el.appendChild(emptyDiv);
      return;
    }
    var idx=0;
    linkCategories.forEach(function(cat){
      var items=l.filter(function(x){return x.category===cat});
      if(!items.length)return;
      var sec=document.createElement('div');
      sec.className='link-sec';
      var h=document.createElement('h3');
      h.textContent=cat;
      sec.appendChild(h);
      items.forEach(function(x){
        var a=document.createElement('a');
        a.className='pcard';
        a.href=x.url;
        a.target='_blank';
        a.rel='noopener noreferrer';
        a.setAttribute('data-q',(x.title+' '+x.url+' '+x.category).toLowerCase());
        a.style.animationDelay=(idx*0.04)+'s';
        idx++;

        var inf=document.createElement('div');
        inf.className='pinf';
        var pt=document.createElement('div');
        pt.className='pt';pt.textContent=x.title;
        var pd=document.createElement('div');
        pd.className='pd';pd.textContent=x.url;
        inf.appendChild(pt);inf.appendChild(pd);

        var arr=document.createElement('div');
        arr.className='arr';
        arr.appendChild(mkSvg('M9 18l6-6-6-6'));

        a.appendChild(inf);a.appendChild(arr);
        sec.appendChild(a);
      });
      el.appendChild(sec);
    });
    var si=$('#lsearch');
    if(si&&si.value)filterList(si,el);
  });
}

// Fetch posts manifest
var postsPromise=null;
function getPosts(){
  if(postsPromise)return postsPromise;
  postsPromise=fetch('/updates/posts.json',{cache:'no-cache'})
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .then(function(p){
      posts=p;
      posts.sort(function(a,b){return b.date>a.date?1:b.date<a.date?-1:0});
      return posts;
    })
    .catch(function(){return []});
  return postsPromise;
}

// Render post list using DOM methods
function showList(){
  var el=$('#ulist');
  if(posts&&el.querySelector('.ucard'))return;
  while(el.firstChild)el.removeChild(el.firstChild);

  getPosts().then(function(p){
    if(!p.length){
      var emptyDiv=document.createElement('div');
      emptyDiv.className='empty';
      emptyDiv.textContent='Coming Soon!';
      el.appendChild(emptyDiv);
      return;
    }
    p.forEach(function(x,i){
      var a=document.createElement('a');
      a.className='ucard';
      a.href='/updates/'+x.file.replace('.md','');
      a.setAttribute('data-q',(x.title+' '+x.date).toLowerCase());
      a.style.animationDelay=(i*0.04)+'s';

      var titleDiv=document.createElement('div');
      titleDiv.className='ut';
      titleDiv.textContent=x.title;

      var dateDiv=document.createElement('div');
      dateDiv.className='ud';
      dateDiv.textContent=fmtDate(x.date);

      a.appendChild(titleDiv);
      a.appendChild(dateDiv);
      el.appendChild(a);
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
      // Back link
      var back=document.createElement('a');
      back.className='post-back';
      back.href='/updates';
      back.title='Back to all updates';
      back.textContent='Back';
      var svg=document.createElementNS('http://www.w3.org/2000/svg','svg');
      svg.setAttribute('width','16');
      svg.setAttribute('height','16');
      svg.setAttribute('viewBox','0 0 24 24');
      svg.setAttribute('fill','none');
      svg.setAttribute('stroke','currentColor');
      svg.setAttribute('stroke-width','2');
      svg.setAttribute('stroke-linecap','round');
      svg.setAttribute('stroke-linejoin','round');
      svg.setAttribute('aria-hidden','true');
      var poly=document.createElementNS('http://www.w3.org/2000/svg','polyline');
      poly.setAttribute('points','15 18 9 12 15 6');
      svg.appendChild(poly);
      back.insertBefore(svg,back.firstChild);

      // Post content - innerHTML required for rendered markdown
      // Source: first-party .md files from same-origin, committed by site owner
      var content=document.createElement('div');
      content.className='pcontent';
      var rendered=parseMd(md);
      content.innerHTML=rendered;

      el.appendChild(back);
      el.appendChild(content);
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
  if(text.indexOf(q)!==-1)return true;
  for(var qi=0,ti=0;ti<text.length&&qi<q.length;ti++){
    if(text[ti]===q[qi])qi++;
  }
  return qi===q.length;
}

// Generic list filter — handles sectioned (.link-sec/.cv-sec) and flat (.ucard) layouts
function filterList(input,container){
  var q=input.value.trim().toLowerCase();
  var words=q.split(/\s+/).filter(Boolean);
  var any=false;
  container.querySelectorAll('.link-sec,.cv-sec').forEach(function(sec){
    var cards=sec.querySelectorAll('.pcard,.cve');
    var vis=false;
    cards.forEach(function(c){
      var t=c.getAttribute('data-q')||c.textContent.toLowerCase();
      var ok=!words.length||words.every(function(w){return fuzzy(w,t)});
      c.style.display=ok?'':'none';
      if(ok)vis=true;
    });
    sec.style.display=vis?'':'none';
    if(vis)any=true;
  });
  container.querySelectorAll('.ucard').forEach(function(c){
    var t=c.getAttribute('data-q')||c.textContent.toLowerCase();
    var ok=!words.length||words.every(function(w){return fuzzy(w,t)});
    c.style.display=ok?'':'none';
    if(ok)any=true;
  });
  var empty=container.querySelector('.search-empty');
  if(!any&&q){
    if(!empty){
      empty=document.createElement('div');
      empty.className='empty search-empty';
      empty.textContent='No results';
      container.appendChild(empty);
    }
    empty.style.display='';
  } else if(empty){
    empty.style.display='none';
  }
}

function fmtDate(d){
  var dt=new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
}

// Set data-q on CV entries (org name first for priority, then full text)
$$('.cve').forEach(function(c){
  var co=c.querySelector('.co');
  var cr=c.querySelector('.cr');
  var t=(co?co.textContent+' ':'')+(cr?cr.textContent+' ':'')+c.textContent;
  c.setAttribute('data-q',t.toLowerCase());
});

// Search wiring
function wireSearch(iid,cid){
  var i=$(iid),c=$(cid);
  if(!i||!c)return;
  var x=i.parentNode.querySelector('.search-x');
  function update(){
    filterList(i,c);
    if(x)x.style.display=i.value?'flex':'none';
  }
  i.addEventListener('input',update);
  i.addEventListener('keydown',function(e){
    if(e.key==='Escape'){i.value='';update();i.blur()}
  });
  if(x)x.addEventListener('click',function(){i.value='';update();i.focus()});
}
wireSearch('#psearch','#plist');
wireSearch('#csearch','#cv');
wireSearch('#usearch','#ulist');
wireSearch('#lsearch','#llist');

// Init
window.addEventListener('popstate',route);
route();

})();
