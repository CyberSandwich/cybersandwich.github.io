(function(){
  'use strict';
  var THEMES=['light','sepia','dark'];
  var THEME_COLORS={light:'#FAFAFA',dark:'#1C1C1E',sepia:'#F5EDDA'};
  var THEME_ICONS={
    sepia:'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 10V2"/><path d="m4.93 10.93 1.41 1.41"/><path d="M2 18h2"/><path d="M20 18h2"/><path d="m19.07 10.93-1.41 1.41"/><path d="M22 22H2"/><path d="M16 18a4 4 0 0 0-8 0"/></svg>',
    dark:'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 3c.132 0 .263 0 .393 0a7.5 7.5 0 0 0 7.92 12.446A9 9 0 1 1 12 3z"/></svg>',
    light:'<svg aria-hidden="true" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
  };
  var META=document.querySelector('meta[name="theme-color"]');

  function curTheme(){return document.documentElement.getAttribute('data-theme')||'light'}

  function setThemeIcon(next){
    var b=document.getElementById('theme-btn');
    if(!b)return;
    b.replaceChildren();
    /* Trusted first-party SVG icon strings — safe to parse as HTML */
    var d=document.createElement('template');
    d.innerHTML=THEME_ICONS[next];
    b.appendChild(d.content);
  }

  function setTheme(t){
    if(t==='light')document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme',t);
    META.content=THEME_COLORS[t];
    setThemeIcon(THEMES[(THEMES.indexOf(t)+1)%THEMES.length]);
    try{localStorage.setItem('theme',t)}catch(_){}
  }

  /* Init icon for current theme (data-theme already set by inline FOUC script) */
  var t=curTheme();
  var tb=document.getElementById('theme-btn');
  if(tb){
    setThemeIcon(THEMES[(THEMES.indexOf(t)+1)%THEMES.length]);
    tb.addEventListener('click',function(){
      setTheme(THEMES[(THEMES.indexOf(curTheme())+1)%THEMES.length]);
    });
  }

  /* Cross-tab sync + iOS Safari nav repaint hack */
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    var s=localStorage.getItem('theme')||'light';
    if(s!==curTheme())setTheme(s);
    var n=document.querySelector('nav');
    if(n){n.style.display='none';n.offsetHeight;n.style.display=''}
  });

  /* Clipboard write with execCommand fallback */
  function copyText(text,cb,onErr){
    function fb(){var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';ta.setAttribute('readonly','');document.body.appendChild(ta);ta.select();var ok=false;try{ok=document.execCommand('copy')}catch(_){}document.body.removeChild(ta);if(ok){if(cb)cb()}else{if(onErr)onErr()}}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(cb,fb)}else{fb()}
  }

  /* SVG icon helpers */
  function mkCheck(){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','14');s.setAttribute('height','14');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2.5');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');var p=document.createElementNS('http://www.w3.org/2000/svg','polyline');p.setAttribute('points','4 12 9 17 20 6');s.appendChild(p);return s}

  function mkX(){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','14');s.setAttribute('height','14');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M18 6L6 18M6 6l12 12');s.appendChild(p);return s}

  /* Button feedback: add class, hold, fade out, revert */
  function btnFeedback(btn,cls,dur,onDone){clearTimeout(btn._ft1);clearTimeout(btn._ft2);btn.classList.remove(cls);btn.offsetWidth;btn.classList.add(cls);btn._ft1=setTimeout(function(){btn.style.opacity='0';btn._ft2=setTimeout(function(){btn.classList.remove(cls);btn.style.opacity='';if(onDone)onDone()},200)},dur||1500)}

  /* Drag-and-drop overlay boilerplate
     opts.overlay: DOM element with .drop-overlay class (toggled via .active)
     opts.onDrop:  function(files, text) — called with FileList and text/plain data */
  function setupDragDrop(opts){
    var ov=opts.overlay,dc=0;
    document.addEventListener('dragenter',function(e){e.preventDefault();dc++;if(dc===1)ov.classList.add('active')});
    document.addEventListener('dragleave',function(e){e.preventDefault();dc--;if(dc<=0){dc=0;ov.classList.remove('active')}});
    document.addEventListener('dragover',function(e){e.preventDefault()});
    document.addEventListener('drop',function(e){
      e.preventDefault();dc=0;ov.classList.remove('active');
      var files=e.dataTransfer.files,text=e.dataTransfer.getData('text');
      opts.onDrop(files,text);
    });
    return function(){if(dc>0){dc=0;ov.classList.remove('active')}};
  }

  /* Two-press reset confirmation: first click shows warning, second confirms
     btn: the button element
     opts.label:    DOM element for text (default: btn.querySelector('span'))
     opts.text:     default label text (default: 'Reset')
     opts.onConfirm: function() called on second click
     opts.guard:    function()→boolean — if returns false, first click ignored
     opts.timeout:  ms before warn expires (default: 2000)
     opts.feedback: ms for Done feedback (default: 1500)
     Returns {press:function(), clear:function()} — press() is the click handler, clear() resets UI */
  function twoPress(btn,opts){
    var lbl=opts.label||btn.querySelector('span'),txt=opts.text||'Reset',tWarn=opts.timeout||2000,tFb=opts.feedback||1500;
    var pending=false,warnT=0,fbT=0;
    function clear(){
      pending=false;clearTimeout(warnT);clearTimeout(fbT);
      btn.classList.remove('rs-warn');btn.classList.remove('rs-fb');
      lbl.textContent=txt;
    }
    function press(){
      if(opts.guard&&!opts.guard())return;
      if(!pending){
        pending=true;clearTimeout(fbT);
        lbl.textContent='Confirm?';btn.classList.remove('rs-fb');btn.offsetWidth;btn.classList.add('rs-warn');
        warnT=setTimeout(function(){pending=false;btn.classList.remove('rs-warn');lbl.textContent=txt},tWarn);
        return;
      }
      pending=false;clearTimeout(warnT);
      btn.classList.remove('rs-warn');
      if(opts.onConfirm)opts.onConfirm();
      lbl.textContent='Done';btn.classList.remove('rs-fb');btn.offsetWidth;btn.classList.add('rs-fb');
      fbT=setTimeout(function(){btn.classList.remove('rs-fb');lbl.textContent=txt},tFb);
    }
    return{press:press,clear:clear};
  }

  var tm={},toastT,toastFadeT;

  function feedback(btn,cls,text,dur){
    clearTimeout(tm[btn.id]);
    var sp=btn.querySelector('span');
    btn.classList.remove('ok','ps-fb','dl-fb','rs-fb','err-fb','ld');
    var pl=btn.querySelector('.ic polyline');
    if(pl){var n=pl.cloneNode(true);pl.parentNode.replaceChild(n,pl)}
    void btn.offsetWidth;
    btn.classList.add(cls);sp.textContent=text;
    tm[btn.id]=setTimeout(function(){btn.classList.remove(cls);sp.textContent=btn.dataset.l},dur||800);
  }

  function notify(msg,ok,onTap){
    var old=document.querySelector('.notif');if(old)old.remove();
    clearTimeout(toastT);clearTimeout(toastFadeT);
    var wrap=document.createElement('div');
    wrap.className='notif fx-bottom';wrap.setAttribute('role','status');
    var pill=document.createElement('div');
    pill.className='notif-pill '+(ok?'nf-ok':'nf-err');
    pill.textContent=msg;wrap.appendChild(pill);
    var dismiss=function(){clearTimeout(toastT);clearTimeout(toastFadeT);wrap.style.animation='notifOut .2s ease forwards';toastFadeT=setTimeout(function(){wrap.remove()},200)};
    wrap.addEventListener('click',function(){if(onTap)onTap();dismiss()});
    document.body.appendChild(wrap);
    toastT=setTimeout(dismiss,5000);
  }

  /* localStorage helpers — JSON parse/stringify with try/catch */
  function load(key,def){try{var v=localStorage.getItem(key);return v!==null?JSON.parse(v):def!==undefined?def:null}catch(_){return def!==undefined?def:null}}
  function save(key,val){try{localStorage.setItem(key,JSON.stringify(val))}catch(_){}}

  /* Keyboard shortcut boilerplate: handles Ctrl combos, input bail, theme, Home
     map: {key:fn(e), ctrl:{key:fn(e)}} — 't' and '1' are built-in */
  function onKey(map){
    document.addEventListener('keydown',function(e){
      if(map.ctrl&&(e.metaKey||e.ctrlKey)&&!e.altKey&&!e.shiftKey){var f=map.ctrl[e.key];if(f)f(e);return}
      var tag=(document.activeElement||e.target).tagName;
      if(tag==='INPUT'||tag==='TEXTAREA'||tag==='SELECT'){if(e.key==='Escape')document.activeElement.blur();return}
      if(e.metaKey||e.ctrlKey||e.altKey)return;
      if(e.key==='t'){setTheme(THEMES[(THEMES.indexOf(curTheme())+1)%THEMES.length]);return}
      if(e.key==='1'){location.href='/';return}
      var f=map[e.key];if(f)f(e)
    });
  }

  /* Delegated step-button press animation */
  document.addEventListener('click',function(e){
    var btn=e.target.closest('.step-btn');
    if(!btn||btn.disabled)return;
    btn.classList.remove('step-press');void btn.offsetWidth;btn.classList.add('step-press');
    clearTimeout(btn._sa);btn._sa=setTimeout(function(){btn.classList.remove('step-press')},300);
  });

  window._base={THEMES:THEMES,curTheme:curTheme,setTheme:setTheme,copyText:copyText,mkCheck:mkCheck,mkX:mkX,btnFeedback:btnFeedback,feedback:feedback,notify:notify,setupDragDrop:setupDragDrop,twoPress:twoPress,onKey:onKey,load:load,save:save};
})();
