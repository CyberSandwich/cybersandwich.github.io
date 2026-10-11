/* Opt-in tools for a flat list of rows: a sort view and drag to reorder. Load after base.js.
   Exposes window._list (and globalThis._list for node tests). */
(function(){
  'use strict';
  /* Stored sort keys. My Order is the page's own array; the rest are views over a copy. */
  var SORTS=['manual','new','old','az','za'];
  var FLIP={new:'old',old:'new',az:'za',za:'az'};
  var LABEL={manual:'My Order',new:'Newest',old:'Oldest',az:'A-Z',za:'Z-A'};
  var coll=new Intl.Collator(undefined,{numeric:true,sensitivity:'base'});

  function valid(s){return SORTS.indexOf(s)>=0?s:'manual'}

  /* A sorted copy; ties keep the array's order. text(item) and ts(item) read the sort keys. */
  function view(arr,sort,text,ts){
    var out=arr.slice(),cmp=null;
    if(sort==='az')cmp=function(a,b){return coll.compare(text(a),text(b))};
    else if(sort==='za')cmp=function(a,b){return coll.compare(text(b),text(a))};
    else if(sort==='new')cmp=function(a,b){return ts(b)-ts(a)};
    else if(sort==='old')cmp=function(a,b){return ts(a)-ts(b)};
    return cmp?out.sort(cmp):out;
  }

  /* A copy of arr with the item at from moved to index to. */
  function move(arr,from,to){var out=arr.slice();out.splice(to,0,out.splice(from,1)[0]);return out}

  /* A .seg-row of three .seg buttons with data-s="manual|new|az". Tapping the active Newest or A-Z
     flips it to Oldest or Z-A. Returns {set(sort)} for changes made elsewhere (a drop, a reset). */
  function sortSeg(row,sort,onChange){
    var segs=row.querySelectorAll('.seg');
    function set(s){
      sort=s;
      for(var i=0;i<segs.length;i++){
        var b=segs[i].dataset.s,on=b===s||FLIP[b]===s;
        segs[i].classList.toggle('active',on);segs[i].setAttribute('aria-checked',on);
        segs[i].textContent=LABEL[on?s:b];
      }
    }
    row.addEventListener('click',function(e){
      var seg=e.target.closest('.seg');if(!seg)return;
      var b=seg.dataset.s,next=b===sort||FLIP[b]===sort?FLIP[sort]||sort:b;
      if(next===sort)return;
      set(next);onChange(next);
    });
    set(sort);
    return{set:set};
  }

  /* Drag to reorder the rows of list. IDLE -> PENDING -> DRAG: touch after a 200 ms hold (moving 8 px
     first hands back to scrolling), mouse after 4 px; Esc, a lost pointer or hiding the page cancels.
     The lifted row is a liquid-glass pill; the others glide one row height to make room. The new index
     is read against where the rows sat when the drag began, so a row never slides out from under the
     pointer and back. opts: row (selector, default '.item'), skip (selector that never starts a drag),
     enabled() (default always), onDrop(from, to) with indices among the rows, called only on a real move.
     Returns {active(), cancel()}. */
  function drag(list,o){
    var IDLE=0,PEND=1,DRAG=2,EDGE=64,HOLD=200;
    var sel=o.row||'.item',doc=document.documentElement;
    var st=IDLE,pid=-1,touch=false,moved=false,sx=0,sy=0,x=0,y=0,gx=0,gy=0,H=0;
    var hold=0,raf=0,swallow=false,src=null,rows=null,mids=null,from=-1,to=-1,pill=null,floor=0,settle=null;
    list.classList.add('rd');
    function shift(){
      for(var j=0;j<rows.length;j++){
        var d=from<to&&j>from&&j<=to?-H:to<from&&j>=to&&j<from?H:0;
        rows[j].style.transform=d?'translateY('+d+'px)':'';
      }
    }
    function begin(){
      if(settle)settle();
      rows=Array.prototype.slice.call(list.querySelectorAll(sel));from=to=rows.indexOf(src);
      if(from<0){stop();return}
      st=DRAG;moved=!touch;
      try{list.setPointerCapture(pid)}catch(_){}
      doc.classList.add('rd-dragging');
      var lt=list.getBoundingClientRect().top,r=src.getBoundingClientRect();
      mids=rows.map(function(el){var b=el.getBoundingClientRect();return b.top-lt+b.height/2});
      gx=sx-r.left;gy=sy-r.top;H=r.height;
      pill=src.cloneNode(true);pill.className=src.classList[0]+' rd-ghost glass';
      pill.removeAttribute('data-id');pill.removeAttribute('data-idx');pill.style.width=r.width+'px';
      if(o.skip){var sk=pill.querySelectorAll(o.skip);for(var i=0;i<sk.length;i++)sk[i].style.visibility='hidden'}
      document.body.appendChild(pill);
      src.classList.add('rd-src');list.classList.add('rd-glide');
      var nav=document.querySelector('nav');floor=nav&&nav.getBoundingClientRect().top||innerHeight;
      frame();
    }
    /* The index the pill's centre is over, against where the rows sat at the start. */
    function track(){
      if(!moved&&Math.hypot(x-sx,y-sy)>8)moved=true;
      var cy=y-gy+H/2-list.getBoundingClientRect().top,t=0;
      for(var j=0;j<mids.length;j++)if(j!==from&&mids[j]<cy)t++;
      if(t!==to){to=t;shift()}
    }
    function frame(){
      raf=0;if(st!==DRAG)return;
      if(!src.isConnected){stop();return}
      pill.style.transform='translate3d('+(x-gx)+'px,'+(y-gy)+'px,0) scale(1.03)';
      track();
      var dy=y<EDGE?-Math.ceil((EDGE-y)/4):y>floor-EDGE?Math.ceil((y-floor+EDGE)/4):0;
      if(dy){scrollBy(0,dy);raf=requestAnimationFrame(frame)}
    }
    /* Back to IDLE before onDrop, whose re-render must find no drag in progress. */
    function stop(commit){
      clearTimeout(hold);cancelAnimationFrame(raf);raf=0;
      /* The release point may not have had a frame yet (a quick flick): drop where the pointer let go. */
      if(commit&&st===DRAG&&src.isConnected)track();      var was=st,f=from,t=to,s=src,p=pill;
      st=IDLE;pid=-1;src=null;pill=null;
      if(was!==DRAG)return;
      doc.classList.remove('rd-dragging');
      for(var j=0;j<rows.length;j++)rows[j].style.transform='';
      rows=mids=null;
      var drop=commit&&f!==t;
      if(drop)o.onDrop(f,t);
      /* The pill settles onto the row where the item landed (or glides home), which stays hidden until it arrives. */
      var el=drop?list.querySelectorAll(sel)[t]:s;
      if(el)el.classList.add('rd-src');
      settle=function(){
        settle=null;p.remove();list.classList.remove('rd-glide');
        if(el)el.classList.remove('rd-src');s.classList.remove('rd-src');
      };
      var done=settle;
      if(el){var r=el.getBoundingClientRect();p.classList.add('rd-gliding');p.style.transform='translate3d('+r.left+'px,'+r.top+'px,0)'}
      p.addEventListener('transitionend',function(){if(settle===done)settle()},{once:true});
      setTimeout(function(){if(settle===done)settle()},300);
      /* Eat this gesture's own click (a tap action such as Clip's copy); the next press resets it. */
      if(moved)swallow=true;
    }
    list.addEventListener('pointerdown',function(e){
      if(st!==IDLE){stop();return}
      swallow=false;
      var row=e.target.closest(sel);
      if(!row||!list.contains(row)||!e.isPrimary||e.button>0||(o.skip&&e.target.closest(o.skip))||(o.enabled&&!o.enabled()))return;
      src=row;pid=e.pointerId;sx=x=e.clientX;sy=y=e.clientY;touch=e.pointerType==='touch';st=PEND;
      if(touch)hold=setTimeout(function(){if(st===PEND)begin()},HOLD);
    });
    list.addEventListener('pointermove',function(e){
      if(e.pointerId!==pid||st===IDLE)return;
      /* A release the page never saw (a menu, another window) must not leave a drag armed. */
      if(e.pointerType==='mouse'&&!e.buttons){stop();return}
      x=e.clientX;y=e.clientY;
      if(st===PEND){var d=Math.hypot(x-sx,y-sy);if(touch?d>8:d>4){if(touch)stop();else begin()}return}
      if(!raf)raf=requestAnimationFrame(frame);
    });
    document.addEventListener('pointerup',function(e){if(e.pointerId===pid)stop(true)});
    document.addEventListener('pointercancel',function(e){if(e.pointerId===pid)stop()});
    list.addEventListener('lostpointercapture',function(e){if(e.pointerId===pid&&st===DRAG)stop()});
    list.addEventListener('touchmove',function(e){if(st===DRAG)e.preventDefault()},{passive:false});
    list.addEventListener('contextmenu',function(e){if(st!==IDLE)e.preventDefault()});
    list.addEventListener('click',function(e){if(swallow&&e.detail>0){swallow=false;e.preventDefault();e.stopPropagation()}},true);
    document.addEventListener('keydown',function(e){if(e.key==='Escape'&&st!==IDLE){e.preventDefault();e.stopPropagation();stop()}},true);
    document.addEventListener('visibilitychange',function(){if(document.hidden)stop()});
    return{active:function(){return st!==IDLE},cancel:function(){stop()}};
  }

  var api={SORTS:SORTS,valid:valid,view:view,move:move,sortSeg:sortSeg,drag:drag};
  if(typeof window!=='undefined')window._list=api;
  globalThis._list=api;
})();
