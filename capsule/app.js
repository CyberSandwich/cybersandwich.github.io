'use strict';
(function(){
var $=function(s){return document.getElementById(s)};
var FONT_SIZES=[12,14,16,18,20,24,28,32,40,48,56,64,72,84,96];
var PAD_STOPS=[8,12,16,20,24,28,32,40,48,56,64,80];
var RAD_STOPS=[0,4,8,12,18,24,32,48,72,-1];
var SHD_STOPS=[0,2,4,6,8,12,16,22,30,40,52];
var FONT_STACKS=[
'system-ui,-apple-system,BlinkMacSystemFont,sans-serif',
'"Helvetica Neue",Helvetica,Arial,"Liberation Sans",sans-serif',
'ui-monospace,SFMono-Regular,Menlo,Consolas,"Liberation Mono",monospace'
];
var BG_CLS=['bg-clear','bg-light','bg-dark','bg-warm','bg-cool','bg-auto'];
var FMT_MIME=['image/png','image/jpeg','image/webp'];
var FMT_QUAL=[undefined,0.92,0.92];
var FMT_EXT=['png','jpg','webp'];
var MAX_TEXT_LEN=4000,MAX_DIM=8192,LH_MULT=1.35;
var DEFAULTS={fontFamIdx:0,fontIdx:6,padIdx:5,radIdx:9,shdIdx:5,bgMode:0,fmtIdx:0};
var KEY_S='capsule:settings:v1',KEY_T='capsule:text:v1';
var SVG_NS='http://www.w3.org/2000/svg';

var st=Object.assign({},DEFAULTS);
var saved=_base.load(KEY_S);
if(saved&&typeof saved==='object'){for(var k in DEFAULTS)if(k in saved&&typeof saved[k]==='number')st[k]=saved[k]}
var savedText=_base.load(KEY_T);if(typeof savedText!=='string')savedText='';

var pv=$('pv'),cv=$('cv'),ctx=cv.getContext('2d'),emptyEl=$('empty'),txt=$('txt');
var psBtn=$('psBtn'),cpBtn=$('cpBtn'),dlBtn=$('dlBtn'),rsBtn=$('rsBtn');
var ov=$('drop-ov');
var dlA=document.createElement('a');dlA.style.display='none';document.body.appendChild(dlA);

var rafId=0,renderToken=0,lastHash=null,lastBlob=null,idleId=0;
var measureCtx=null;
function getMeasureCtx(){
  if(measureCtx)return measureCtx;
  try{measureCtx=new OffscreenCanvas(1,1).getContext('2d');return measureCtx}catch(_){}
  var c=document.createElement('canvas');c.width=1;c.height=1;measureCtx=c.getContext('2d');return measureCtx
}

function fnv1a(s){var h=2166136261;for(var i=0;i<s.length;i++){h^=s.charCodeAt(i);h=(h+((h<<1)+(h<<4)+(h<<7)+(h<<8)+(h<<24)))>>>0}return h.toString(36)}
function sanitise(t){return t?t.normalize('NFC').replace(/[\x00-\x1F\x7F]/g,''):''}

function rrPath(c,x,y,w,h,r){
  r=Math.min(r,w/2,h/2);
  if(c.roundRect){c.beginPath();c.roundRect(x,y,w,h,r);return}
  c.beginPath();c.moveTo(x+r,y);c.lineTo(x+w-r,y);
  c.arcTo(x+w,y,x+w,y+r,r);c.lineTo(x+w,y+h-r);
  c.arcTo(x+w,y+h,x+w-r,y+h,r);c.lineTo(x+r,y+h);
  c.arcTo(x,y+h,x,y+h-r,r);c.lineTo(x,y+r);
  c.arcTo(x,y,x+r,y,r);c.closePath()
}

function bgGradStops(m){if(m===3)return ['#ffecd2','#fcb69f'];if(m===4)return ['#e0c3fc','#8ec5fc'];return null}
function bgSolid(m){if(m===1)return '#fff';if(m===2)return '#1a1a1a';if(m===5){var t=_base.curTheme();return t==='dark'?'#1a1a1a':t==='sepia'?'#FAF4E6':'#fff'}return null}
function isDarkCap(m){if(m===2)return true;if(m===5||m===0)return _base.curTheme()==='dark';return false}

function snap(){
  return {
    text:txt.value,
    fontFamIdx:st.fontFamIdx,fontIdx:st.fontIdx,padIdx:st.padIdx,
    radIdx:st.radIdx,shdIdx:st.shdIdx,bgMode:st.bgMode,
    theme:_base.curTheme(),dpr:Math.min(window.devicePixelRatio||1,2.5)
  }
}
function schedule(){
  var tk=++renderToken;
  if(rafId)return;
  rafId=requestAnimationFrame(function(){rafId=0;if(tk===renderToken)render(snap())})
}
function showEmpty(){cv.style.display='none';emptyEl.style.display='';lastBlob=null;lastHash=null}

function render(sn){
  var raw=sanitise(sn.text);
  if(!raw){showEmpty();return}
  var fontPx=FONT_SIZES[sn.fontIdx];
  var padX=PAD_STOPS[sn.padIdx],padY=Math.round(padX*0.55);
  var lh=Math.round(fontPx*LH_MULT);
  var fontStr='500 '+fontPx+'px '+FONT_STACKS[sn.fontFamIdx];
  var mctx=getMeasureCtx();mctx.font=fontStr;
  var widest=Math.ceil(mctx.measureText(raw).width);
  var capW=widest+2*padX,capH=lh+2*padY;
  var rad;
  if(RAD_STOPS[sn.radIdx]===-1)rad=capH/2;
  else rad=Math.min(RAD_STOPS[sn.radIdx],capW/2,capH/2);
  var shd=SHD_STOPS[sn.shdIdx];
  var margin=Math.max(8,Math.ceil(shd*4.5));
  var ow=capW+2*margin,oh=capH+2*margin;
  var dpr=sn.dpr,pxW=ow*dpr,pxH=oh*dpr;
  if(pxW>MAX_DIM||pxH>MAX_DIM){var sf=Math.min(MAX_DIM/pxW,MAX_DIM/pxH);dpr*=sf}

  var hash=fnv1a(JSON.stringify(sn)+'|'+raw+'|'+capW+'|'+capH+'|'+rad);
  if(hash===lastHash)return;
  lastHash=hash;
  if(idleId){clearTimeout(idleId);idleId=0}
  lastBlob=null;

  cv.width=Math.round(ow*dpr);cv.height=Math.round(oh*dpr);
  cv.style.width=ow+'px';cv.style.height=oh+'px';
  ctx.setTransform(dpr,0,0,dpr,0,0);
  ctx.clearRect(0,0,ow,oh);

  var dk=isDarkCap(sn.bgMode);
  var capColor=dk?'#1a1a1a':'#fff';

  if(shd>0){
    ctx.save();
    ctx.shadowColor=dk?'rgba(255,255,255,0.18)':'rgba(0,0,0,0.16)';
    ctx.shadowBlur=shd*3.5;ctx.shadowOffsetX=0;ctx.shadowOffsetY=dk?0:Math.round(shd*0.7);
    rrPath(ctx,margin,margin,capW,capH,rad);ctx.fillStyle=capColor;ctx.fill();
    ctx.restore();
    ctx.save();
    ctx.shadowColor=dk?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.07)';
    ctx.shadowBlur=Math.round(shd*1.2);ctx.shadowOffsetX=0;ctx.shadowOffsetY=dk?0:Math.round(shd*0.25);
    rrPath(ctx,margin,margin,capW,capH,rad);ctx.fillStyle=capColor;ctx.fill();
    ctx.restore()
  }else{
    rrPath(ctx,margin,margin,capW,capH,rad);ctx.fillStyle=capColor;ctx.fill()
  }
  rrPath(ctx,margin,margin,capW,capH,rad);
  ctx.strokeStyle=dk?'rgba(255,255,255,0.10)':'rgba(0,0,0,0.08)';
  ctx.lineWidth=1;ctx.stroke();

  ctx.fillStyle=dk?'#fff':'#1a1a1a';
  ctx.font=fontStr;ctx.textAlign='center';ctx.textBaseline='middle';
  if('textRendering' in ctx)ctx.textRendering='geometricPrecision';
  ctx.fillText(raw,margin+capW/2,margin+padY+lh/2);

  cv.style.display='block';emptyEl.style.display='none';
  scheduleIdleBlob()
}

function scheduleIdleBlob(){
  if(idleId)clearTimeout(idleId);
  idleId=setTimeout(function(){idleId=0;if(!cv.width)return;exportToBlob(function(b){lastBlob=b})},250)
}

function compose(){
  var ow=cv.width,oh=cv.height;
  var tmp=document.createElement('canvas');tmp.width=ow;tmp.height=oh;
  var t=tmp.getContext('2d');
  var sol=bgSolid(st.bgMode),grad=bgGradStops(st.bgMode);
  if(sol){t.fillStyle=sol;t.fillRect(0,0,ow,oh)}
  else if(grad){var g=t.createLinearGradient(0,0,ow,oh);g.addColorStop(0,grad[0]);g.addColorStop(1,grad[1]);t.fillStyle=g;t.fillRect(0,0,ow,oh)}
  t.drawImage(cv,0,0);
  return tmp
}
function exportToBlob(cb){compose().toBlob(cb,FMT_MIME[st.fmtIdx],FMT_QUAL[st.fmtIdx])}

function updFnt(){$('fnt-val').textContent=FONT_SIZES[st.fontIdx]+'px Font';
  $('fnt-dec').disabled=st.fontIdx===0;$('fnt-inc').disabled=st.fontIdx===FONT_SIZES.length-1}
function updPad(){$('pad-val').textContent=PAD_STOPS[st.padIdx]+'px Padding';
  $('pad-dec').disabled=st.padIdx===0;$('pad-inc').disabled=st.padIdx===PAD_STOPS.length-1}
function updRad(){var r=RAD_STOPS[st.radIdx];$('rad-val').textContent=r===-1?'Auto Radius':r===0?'No Radius':r+'px Radius';
  $('rad-dec').disabled=st.radIdx===0;$('rad-inc').disabled=st.radIdx===RAD_STOPS.length-1}
function updShd(){var v=SHD_STOPS[st.shdIdx];$('shd-val').textContent=v===0?'No Shadow':v+'px Shadow';
  $('shd-dec').disabled=st.shdIdx===0;$('shd-inc').disabled=st.shdIdx===SHD_STOPS.length-1}
function updFf(){for(var i=0;i<3;i++)$('ff-'+i).classList.toggle('active',i===st.fontFamIdx)}
function updBg(){for(var i=0;i<6;i++){var el=$('bg-'+i);el.classList.toggle('active',i===st.bgMode);el.setAttribute('aria-checked',i===st.bgMode?'true':'false')}
  BG_CLS.forEach(function(c){pv.classList.remove(c)});pv.classList.add(BG_CLS[st.bgMode]);
  $('bg-0').disabled=(st.fmtIdx===1)}
function updFmt(){for(var i=0;i<3;i++)$('fmt-'+i).classList.toggle('active',i===st.fmtIdx);$('bg-0').disabled=(st.fmtIdx===1)}

var saveT=0;
function saveSettings(){_base.save(KEY_S,{fontFamIdx:st.fontFamIdx,fontIdx:st.fontIdx,padIdx:st.padIdx,radIdx:st.radIdx,shdIdx:st.shdIdx,bgMode:st.bgMode,fmtIdx:st.fmtIdx})}
function saveTextDeb(){clearTimeout(saveT);saveT=setTimeout(function(){_base.save(KEY_T,txt.value)},250)}

txt.value=savedText;
updFnt();updPad();updRad();updShd();updFf();updBg();updFmt();schedule();

function bindStep(decId,incId,key,arr,upd){
  $(decId).addEventListener('click',function(){if(st[key]>0){st[key]--;upd();schedule();saveSettings()}});
  $(incId).addEventListener('click',function(){if(st[key]<arr.length-1){st[key]++;upd();schedule();saveSettings()}})
}
bindStep('fnt-dec','fnt-inc','fontIdx',FONT_SIZES,updFnt);
bindStep('pad-dec','pad-inc','padIdx',PAD_STOPS,updPad);
bindStep('rad-dec','rad-inc','radIdx',RAD_STOPS,updRad);
bindStep('shd-dec','shd-inc','shdIdx',SHD_STOPS,updShd);

function makeResetSvg(){
  var s=document.createElementNS(SVG_NS,'svg');s.setAttribute('viewBox','0 0 24 24');
  var p1=document.createElementNS(SVG_NS,'path');p1.setAttribute('d','M21 2v6h-6');
  var p2=document.createElementNS(SVG_NS,'path');p2.setAttribute('d','M21 13a9 9 0 1 1-3-7.7L21 8');
  s.appendChild(p1);s.appendChild(p2);return s
}
var groups=[
{_row:$('sr-fnt'),_reset:function(){st.fontIdx=DEFAULTS.fontIdx;updFnt()}},
{_row:$('sr-pad'),_reset:function(){st.padIdx=DEFAULTS.padIdx;updPad()}},
{_row:$('sr-rad'),_reset:function(){st.radIdx=DEFAULTS.radIdx;updRad()}},
{_row:$('sr-shd'),_reset:function(){st.shdIdx=DEFAULTS.shdIdx;updShd()}}
];
function animateReset(g){
  var row=g._row,lbl=row.querySelector('.slbl'),ic=lbl.querySelector('svg');
  if(!ic)return;
  var origClone=ic.cloneNode(true);
  ic.replaceWith(makeResetSvg());
  row.classList.remove('rs-fb');void row.offsetWidth;row.classList.add('rs-fb');
  clearTimeout(g._ft);
  g._ft=setTimeout(function(){
    row.classList.remove('rs-fb');
    var cur=lbl.querySelector('svg');
    if(cur)cur.replaceWith(origClone)
  },600)
}
groups.forEach(function(g){
  g._row.addEventListener('click',function(e){if(!e.target.closest('button')){g._reset();animateReset(g);schedule();saveSettings()}})
});

for(var i=0;i<3;i++)(function(i){$('ff-'+i).addEventListener('click',function(){setFontFam(i)})})(i);
function setFontFam(i){if(i<0||i>2||i===st.fontFamIdx)return;st.fontFamIdx=i;updFf();schedule();saveSettings()}

function setBg(m){
  if(m<0||m>5)return;
  if(st.fmtIdx===1&&m===0){_base.notify('JPEG Needs Solid Background',false);return}
  st.bgMode=m;updBg();schedule();saveSettings()
}
for(var b=0;b<6;b++)(function(b){$('bg-'+b).addEventListener('click',function(){setBg(b)})})(b);

function setFmt(i){
  if(i<0||i>2)return;
  st.fmtIdx=i;
  if(i===1&&st.bgMode===0){st.bgMode=1;updBg();_base.notify('Switched BG to Light for JPEG','warn')}
  updFmt();lastBlob=null;saveSettings();schedule()
}
for(var f=0;f<3;f++)(function(f){$('fmt-'+f).addEventListener('click',function(){setFmt(f)})})(f);

txt.addEventListener('input',function(){schedule();saveTextDeb()});

txt.addEventListener('paste',function(e){
  var data=(e.clipboardData||window.clipboardData).getData('text');
  if(data==null)return;
  e.preventDefault();
  var clean=data.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,'  ').replace(/^\n+|\n+$/g,'');
  var ok=false;try{ok=document.execCommand('insertText',false,clean)}catch(_){}
  if(!ok){var s0=txt.selectionStart,e0=txt.selectionEnd;txt.value=txt.value.slice(0,s0)+clean+txt.value.slice(e0);txt.selectionStart=txt.selectionEnd=s0+clean.length;txt.dispatchEvent(new Event('input'))}
});

function pasteClip(){
  if(!navigator.clipboard||!navigator.clipboard.readText){_base.notify('Clipboard Not Available',false);return}
  navigator.clipboard.readText().then(function(t){
    if(!t){_base.notify('Clipboard Empty',false);return}
    var clean=t.replace(/\r\n/g,'\n').replace(/\r/g,'\n').replace(/\t/g,'  ').replace(/^\n+|\n+$/g,'');
    txt.focus();
    var s0=txt.selectionStart,e0=txt.selectionEnd;
    var ok=false;try{ok=document.execCommand('insertText',false,clean)}catch(_){}
    if(!ok){txt.value=txt.value.slice(0,s0)+clean+txt.value.slice(e0);txt.selectionStart=txt.selectionEnd=s0+clean.length}
    schedule();saveTextDeb();
    _base.feedback(psBtn,'ps-fb','Pasted')
  },function(){_base.notify('Clipboard Not Available',false)})
}
psBtn.addEventListener('click',pasteClip);

function pad2(n){return n<10?'0'+n:''+n}
function genFilename(){
  var raw=txt.value.toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9-]/g,'').replace(/-+/g,'-').replace(/^-|-$/g,'').slice(0,24)||'capsule';
  var d=new Date();
  return 'capsule-'+raw+'-'+d.getFullYear()+pad2(d.getMonth()+1)+pad2(d.getDate())+'-'+pad2(d.getHours())+pad2(d.getMinutes())+'.'+FMT_EXT[st.fmtIdx]
}

function copyImage(useFb){
  if(!txt.value.trim()){_base.notify('Type Something First',false);return}
  if(!navigator.clipboard||!navigator.clipboard.write){_base.notify('Clipboard Not Available',false);return}
  var tmp=compose();
  navigator.clipboard.write([new ClipboardItem({'image/png':new Promise(function(rs,rj){tmp.toBlob(function(b){if(b)rs(b);else rj()},'image/png')})})]).then(
    function(){if(useFb)_base.feedback(cpBtn,'ok','Copied');else _base.notify('Copied to Clipboard',true)},
    function(){_base.notify('Copy Failed',false)}
  )
}
cpBtn.addEventListener('click',function(){copyImage(true)});

pv.addEventListener('click',function(e){
  if(e.target.closest('button')||e.target===txt)return;
  if(!txt.value.trim()){txt.focus();return}
  copyImage(false)
});

function fallbackDl(blob,fname){
  var u=URL.createObjectURL(blob);
  dlA.download=fname;dlA.href=u;dlA.click();
  setTimeout(function(){URL.revokeObjectURL(u)},10000);
  _base.feedback(dlBtn,'dl-fb','Downloaded')
}
function doDownload(){
  if(!txt.value.trim()){_base.notify('Type Something First',false);return}
  var fname=genFilename();
  function go(blob){
    if(!blob){_base.notify('Export Failed',false);return}
    if(window.showSaveFilePicker){
      var ext=FMT_EXT[st.fmtIdx],mime=FMT_MIME[st.fmtIdx],accept={};accept[mime]=['.'+ext];
      window.showSaveFilePicker({suggestedName:fname,types:[{description:'Image',accept:accept}]}).then(function(h){
        return h.createWritable().then(function(w){return w.write(blob).then(function(){return w.close()})})
      }).then(function(){_base.feedback(dlBtn,'dl-fb','Saved')},function(err){
        if(err&&err.name==='AbortError')return;
        fallbackDl(blob,fname)
      })
    }else fallbackDl(blob,fname)
  }
  if(lastBlob)go(lastBlob);else exportToBlob(function(b){lastBlob=b;go(b)})
}
dlBtn.addEventListener('click',doDownload);

var resetCtrl=_base.twoPress(rsBtn,{
  text:'Reset All',
  guard:function(){
    if(txt.value)return true;
    for(var k in DEFAULTS)if(st[k]!==DEFAULTS[k])return true;
    return false
  },
  onConfirm:function(){
    txt.value='';
    for(var k in DEFAULTS)st[k]=DEFAULTS[k];
    try{localStorage.removeItem(KEY_S);localStorage.removeItem(KEY_T)}catch(_){}
    updFnt();updPad();updRad();updShd();updFf();updBg();updFmt();schedule();
    groups.forEach(function(g){if(g._ft)clearTimeout(g._ft)});
    groups.forEach(function(g){animateReset(g)})
  }
});
function resetAll(){resetCtrl.press()}
rsBtn.addEventListener('click',resetAll);

_base.setupDragDrop({overlay:ov,onDrop:function(files,text){
  if(text){txt.value=(txt.value+(txt.value?'\n':'')+text).slice(0,MAX_TEXT_LEN);txt.dispatchEvent(new Event('input'));return}
  if(files&&files.length){
    var f=files[0];
    if(/^text\//.test(f.type)||/\.txt$/i.test(f.name)){
      var r=new FileReader();
      r.onload=function(){txt.value=String(r.result||'').slice(0,MAX_TEXT_LEN);txt.dispatchEvent(new Event('input'))};
      r.onerror=function(){_base.notify('Failed to Read File',false)};
      r.readAsText(f)
    }else _base.notify('Drop a Text File',false)
  }
}});

window.addEventListener('storage',function(e){
  if(e.key===KEY_S){
    var ns=_base.load(KEY_S);
    if(ns&&typeof ns==='object'){for(var k in DEFAULTS)if(k in ns&&typeof ns[k]==='number')st[k]=ns[k];
      updFnt();updPad();updRad();updShd();updFf();updBg();updFmt();schedule()}
  }else if(e.key===KEY_T){
    var nt=_base.load(KEY_T);if(typeof nt==='string'){txt.value=nt;schedule()}
  }
});

var mo=new MutationObserver(function(){if(st.bgMode===5||st.bgMode===0)schedule()});
mo.observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});

document.addEventListener('visibilitychange',function(){
  if(document.hidden&&rafId){cancelAnimationFrame(rafId);rafId=0}
  else if(!document.hidden)schedule()
});

function notInButton(){var ae=document.activeElement;return !ae||(ae.tagName!=='BUTTON'&&ae.tagName!=='A')}

_base.onKey({
  ctrl:{
    s:function(e){e.preventDefault();doDownload()},
    c:function(e){if(!getSelection().toString()){e.preventDefault();copyImage(false)}}
  },
  Tab:function(e){e.preventDefault();txt.focus()},
  Enter:function(e){if(!notInButton())return;e.preventDefault();copyImage(false)},
  ' ':function(e){if(!notInButton())return;e.preventDefault();copyImage(false)},
  v:function(){pasteClip()},
  r:function(){resetAll()},
  '0':function(){resetAll()},
  '=':function(){if(st.fontIdx<FONT_SIZES.length-1){st.fontIdx++;updFnt();schedule();saveSettings()}},
  '-':function(){if(st.fontIdx>0){st.fontIdx--;updFnt();schedule();saveSettings()}},
  '[':function(){if(st.padIdx>0){st.padIdx--;updPad();schedule();saveSettings()}},
  ']':function(){if(st.padIdx<PAD_STOPS.length-1){st.padIdx++;updPad();schedule();saveSettings()}},
  "'":function(){if(st.radIdx<RAD_STOPS.length-1){st.radIdx++;updRad();schedule();saveSettings()}},
  ';':function(){if(st.radIdx>0){st.radIdx--;updRad();schedule();saveSettings()}},
  '"':function(){if(st.shdIdx<SHD_STOPS.length-1){st.shdIdx++;updShd();schedule();saveSettings()}},
  ':':function(){if(st.shdIdx>0){st.shdIdx--;updShd();schedule();saveSettings()}},
  f:function(){setFontFam((st.fontFamIdx+1)%3)},
  x:function(){setBg(0)},l:function(){setBg(1)},b:function(){setBg(2)},a:function(){setBg(5)},
  '3':function(){setBg(3)},'4':function(){setBg(4)},
  p:function(){setFmt(0)},j:function(){setFmt(1)},w:function(){setFmt(2)}
});
})();
