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
  setThemeIcon(THEMES[(THEMES.indexOf(t)+1)%THEMES.length]);

  /* Theme toggle click */
  document.getElementById('theme-btn').addEventListener('click',function(){
    setTheme(THEMES[(THEMES.indexOf(curTheme())+1)%THEMES.length]);
  });

  /* Cross-tab sync + iOS Safari nav repaint hack */
  document.addEventListener('visibilitychange',function(){
    if(document.hidden)return;
    var s=localStorage.getItem('theme')||'light';
    if(s!==curTheme())setTheme(s);
    var n=document.querySelector('nav');
    if(n){n.style.display='none';n.offsetHeight;n.style.display=''}
  });

  /* Clipboard write with execCommand fallback */
  function copyText(text,cb){
    function fb(){var ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none';ta.setAttribute('readonly','');document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){}document.body.removeChild(ta);if(cb)cb()}
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(cb,fb)}else{fb()}
  }

  /* SVG icon helpers */
  function mkCheck(){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','14');s.setAttribute('height','14');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2.5');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');var p=document.createElementNS('http://www.w3.org/2000/svg','polyline');p.setAttribute('points','4 12 9 17 20 6');s.appendChild(p);return s}

  function mkX(){var s=document.createElementNS('http://www.w3.org/2000/svg','svg');s.setAttribute('width','14');s.setAttribute('height','14');s.setAttribute('viewBox','0 0 24 24');s.setAttribute('fill','none');s.setAttribute('stroke','currentColor');s.setAttribute('stroke-width','2');s.setAttribute('stroke-linecap','round');s.setAttribute('stroke-linejoin','round');s.setAttribute('aria-hidden','true');var p=document.createElementNS('http://www.w3.org/2000/svg','path');p.setAttribute('d','M18 6L6 18M6 6l12 12');s.appendChild(p);return s}

  /* Button feedback: add class, hold, fade out, revert */
  function btnFeedback(btn,cls,dur,onDone){clearTimeout(btn._ft1);clearTimeout(btn._ft2);btn.classList.remove(cls);btn.offsetWidth;btn.classList.add(cls);btn._ft1=setTimeout(function(){btn.style.opacity='0';btn._ft2=setTimeout(function(){btn.classList.remove(cls);btn.style.opacity='';if(onDone)onDone()},200)},dur||1500)}

  /* Expose for project-specific keyboard handlers */
  window._base={THEMES:THEMES,curTheme:curTheme,setTheme:setTheme,copyText:copyText,mkCheck:mkCheck,mkX:mkX,btnFeedback:btnFeedback};
})();
