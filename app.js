(function(){'use strict';

var $=function(s){return document.querySelector(s)};
var $$=function(s){return document.querySelectorAll(s)};

// State
var posts=null;
var projects=null;
var validPages=['home','projects','cv','updates'];

// Router
function route(){
  var hash=location.hash.slice(1)||'home';
  var parts=hash.split('/');
  var page=validPages.indexOf(parts[0])!==-1?parts[0]:'home';
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
    var isActive=a.getAttribute('href')==='#'+page;
    a.classList.toggle('active',isActive);
    if(isActive)a.setAttribute('aria-current','page');
    else a.removeAttribute('aria-current');
  });

  if(page==='projects'){showProjects()}
  if(page==='updates'){
    if(slug){showPost(slug)}
    else{showList()}
  }
}

// Fetch and render projects
function getProjects(){
  if(projects)return Promise.resolve(projects);
  return fetch('projects/projects.json')
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .then(function(p){projects=p;return projects})
    .catch(function(){return []});
}

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
    p.forEach(function(x,i){
      var a=document.createElement('a');
      a.className='pcard';
      a.href=x.url;
      a.style.animationDelay=(i*0.04)+'s';
      if(x.url.startsWith('http')){a.target='_blank';a.rel='noopener'}

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
      el.appendChild(a);
    });
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

// Fetch posts manifest
function getPosts(){
  if(posts)return Promise.resolve(posts);
  return fetch('updates/posts.json')
    .then(function(r){if(!r.ok)throw 0;return r.json()})
    .then(function(p){
      posts=p;
      posts.sort(function(a,b){return b.date>a.date?1:b.date<a.date?-1:0});
      return posts;
    })
    .catch(function(){return []});
}

// Render post list using DOM methods
function showList(){
  var el=$('#ulist');
  // Clear previous content safely
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
      a.href='#updates/'+x.file.replace('.md','');
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
  });
}

// Render single post
// Note: innerHTML used here to render parsed markdown from first-party .md
// files committed by the site owner. Content is same-origin and trusted.
function showPost(slug){
  var el=$('#ulist');
  while(el.firstChild)el.removeChild(el.firstChild);

  fetch('updates/'+encodeURIComponent(slug)+'.md')
    .then(function(r){if(!r.ok)throw 0;return r.text()})
    .then(function(md){
      // Back link
      var back=document.createElement('a');
      back.className='post-back';
      back.href='#updates';
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
    .catch(function(){location.hash='updates'});
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

function fmtDate(d){
  var dt=new Date(d+'T00:00:00');
  return dt.toLocaleDateString('en-GB',{day:'numeric',month:'long',year:'numeric'});
}

// Init
window.addEventListener('hashchange',route);
route();

})();
