(function(){
'use strict';
var ACT_SVG={
  paste:'<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/><rect x="8" y="2" width="8" height="4" rx="1"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  download:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><path d="M12 15V3"/>',
  check:'<polyline points="4 12 9 17 20 6"/>'
};
var NF='Nothing Found';
var STYLES=[{fg:'#000000',bg:'#FFFFFF'},{fg:'#FFFFFF',bg:'#000000'},{fg:'#000000',bg:null}];
var dlA=document.createElement('a');
var jpgC=document.createElement('canvas');
var jpgCtx=jpgC.getContext('2d',{alpha:false});

function debounce(fn,ms){var t,last=0;return function(){clearTimeout(t);var now=Date.now();if(now-last>=ms){last=now;requestAnimationFrame(fn)}else{t=setTimeout(function(){last=Date.now();fn()},ms-(now-last))}}}

function autoGrow(el){requestAnimationFrame(function(){el.style.height='auto';var h=el.scrollHeight;el.style.height=h+'px';el.classList.toggle('scroll',h>=140)})}

function pvPop(el){el.style.animation='none';el.offsetHeight;el.style.animation='pvPop .2s cubic-bezier(.34,1.56,.64,1)'}

function mkBtn(id,label,iconSvg,hasCheck){
  var btn=document.createElement('button');
  btn.type='button';btn.id=id;btn.dataset.l=label;
  var idEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
  idEl.setAttribute('class','id');idEl.setAttribute('viewBox','0 0 24 24');
  idEl.innerHTML=iconSvg;
  btn.appendChild(idEl);
  if(hasCheck){
    var icEl=document.createElementNS('http://www.w3.org/2000/svg','svg');
    icEl.setAttribute('class','ic');icEl.setAttribute('viewBox','0 0 24 24');
    icEl.innerHTML=ACT_SVG.check;
    btn.appendChild(icEl);
  }
  var sp=document.createElement('span');sp.textContent=label;btn.appendChild(sp);
  return btn;
}

function mkActions(prefix){
  var el=document.getElementById(prefix+'Act');
  var ri=window._cgResetInner;
  el.appendChild(mkBtn(prefix+'Ps','Paste',ACT_SVG.paste,true));
  el.appendChild(mkBtn(prefix+'Cp','Copy',ACT_SVG.copy,true));
  el.appendChild(mkBtn(prefix+'Dl','Download',ACT_SVG.download,true));
  el.appendChild(mkBtn(prefix+'Rs','Reset',ri,false));
}

function drawCropMarks(canvas,style,margin,ctx){
  if(margin<=0)return;
  var w=canvas.width,h=canvas.height;
  ctx.save();
  ctx.strokeStyle=style===1?'rgba(255,255,255,0.5)':'rgba(0,0,0,0.35)';
  var lw=Math.max(2,Math.round(Math.min(w,h)/200));
  ctx.lineWidth=lw;
  var L=Math.round(Math.min(w,h)*0.06);
  if(L<2){ctx.restore();return}
  var o=Math.ceil(lw/2);
  ctx.beginPath();
  ctx.moveTo(o,L+o);ctx.lineTo(o,o);ctx.lineTo(L+o,o);
  ctx.moveTo(w-L-o,o);ctx.lineTo(w-o,o);ctx.lineTo(w-o,L+o);
  ctx.moveTo(o,h-L-o);ctx.lineTo(o,h-o);ctx.lineTo(L+o,h-o);
  ctx.moveTo(w-L-o,h-o);ctx.lineTo(w-o,h-o);ctx.lineTo(w-o,h-L-o);
  ctx.stroke();
  ctx.restore();
}

function drawQR(ctx,qr,st,sz,margin){
  if(st.bg){ctx.fillStyle=st.bg;ctx.fillRect(0,0,sz,sz)}
  var area=sz-2*margin;
  var modPx=Math.floor(area/qr.count);
  var actualSz=modPx*qr.count;
  var off=margin+Math.floor((area-actualSz)/2);
  ctx.fillStyle=st.fg;
  for(var r=0;r<qr.count;r++){
    var y=off+r*modPx,row=qr.matrix[r],c=0;
    while(c<qr.count){if(row[c]){var s=c;while(c<qr.count&&row[c])c++;ctx.fillRect(off+s*modPx,y,modPx*(c-s),modPx)}else c++}
  }
}

function quantizeCanvas(ctx,w,h,hasBg){
  var id=ctx.getImageData(0,0,w,h),d=new Uint32Array(id.data.buffer);
  if(hasBg){for(var i=0;i<d.length;i++)d[i]=(d[i]&0xFF)<128?0xFF000000:0xFFFFFFFF}
  else{for(var i=0;i<d.length;i++){var a=(d[i]>>>24)&0xFF;d[i]=a>128?0xFF000000:0x00000000}}
  ctx.putImageData(id,0,0);
}

function resetGroup(g){
  g._reset();
  var row=g._row,lbl=row.querySelector('.slbl');
  if(!lbl)return;
  var ic=lbl.querySelector('svg'),orig=ic.outerHTML;
  ic.outerHTML=window._cgResetSvg;
  row.classList.remove('rs-fb');
  void row.offsetWidth;
  row.classList.add('rs-fb');
  clearTimeout(g._ft);
  g._ft=setTimeout(function(){row.classList.remove('rs-fb');lbl.querySelector('svg').outerHTML=orig},600);
}

function initSettings(container,groups){
  groups.forEach(function(g){
    var row=document.createElement('div');
    row.className='srow';
    var lbl=document.createElement('div');
    lbl.className='slbl';

    if(g.type==='seg'){
      var segIdx=g.def;
      var segRow=document.createElement('div');
      segRow.className='seg-row';
      var btns=[];
      g.formats.forEach(function(name,i){
        var btn=document.createElement('button');
        btn.type='button';btn.className='seg'+(i===g.def?' active':'');
        btn.textContent=name;
        if(g.disable&&g.disable(i))btn.disabled=true;
        btn.addEventListener('click',function(){
          if(btn.disabled)return;
          segIdx=i;
          btns.forEach(function(b,j){b.classList.toggle('active',j===i)});
          g.onChange(segIdx);
        });
        btns.push(btn);
        segRow.appendChild(btn);
      });
      g._reset=function(){segIdx=g.def;btns.forEach(function(b,j){b.classList.toggle('active',j===g.def);if(g.disable)b.disabled=g.disable(j)});g.onChange(g.def)};
      g._rebuild=function(){btns.forEach(function(b,j){b.disabled=g.disable?g.disable(j):false})};
      g._refresh=g._rebuild;
      g._set=function(i){if(i===segIdx||i<0||i>=g.formats.length)return;if(btns[i].disabled)return;segIdx=i;btns.forEach(function(b,j){b.classList.toggle('active',j===i)});g.onChange(segIdx)};
      g._cur=function(){return segIdx};
      row.appendChild(segRow);

    }else if(g.type==='format'){
      var fmtIdx=g.def;
      var iconWrap=document.createElement('span');
      var getIcon=function(i){return g.icons?g.icons[i]:g.icon};
      iconWrap.innerHTML=getIcon(fmtIdx);
      lbl.appendChild(iconWrap);
      var nameSpan=document.createElement('span');
      nameSpan.textContent=g.formats[fmtIdx];
      nameSpan.style.transition='opacity .15s';
      lbl.appendChild(nameSpan);
      row.appendChild(lbl);

      var chips=document.createElement('div');
      chips.className='schips';

      var buildChips=function(){
        chips.textContent='';
        g.formats.forEach(function(name,i){
          if(i===fmtIdx)return;
          if(g.hide&&g.hide(i))return;
          var btn=document.createElement('button');
          btn.type='button';btn.className='chip';btn.textContent=name;
          btn.addEventListener('click',function(){
            fmtIdx=i;
            iconWrap.innerHTML=getIcon(fmtIdx);
            nameSpan.style.opacity='.3';
            setTimeout(function(){
              nameSpan.textContent=g.formats[fmtIdx];
              nameSpan.style.opacity='1';
            },100);
            buildChips();
            g.onChange(fmtIdx);
          });
          chips.appendChild(btn);
        });
      };
      buildChips();

      g._rebuild=buildChips;
      g._reset=function(){fmtIdx=g.def;iconWrap.innerHTML=getIcon(g.def);nameSpan.textContent=g.formats[g.def];buildChips();g.onChange(g.def)};
      g._set=function(i){if(i===fmtIdx||i<0||i>=g.formats.length||(g.hide&&g.hide(i)))return;fmtIdx=i;iconWrap.innerHTML=getIcon(fmtIdx);nameSpan.style.opacity='.3';setTimeout(function(){nameSpan.textContent=g.formats[fmtIdx];nameSpan.style.opacity='1'},100);buildChips();g.onChange(fmtIdx)};
      g._cur=function(){return fmtIdx};
      row.appendChild(chips);

    }else{
      lbl.innerHTML=g.icon||'';
      var sp=document.createElement('span');
      lbl.appendChild(sp);
      row.appendChild(lbl);

      if(g.type==='chips'){
        sp.textContent=g.label;
        var chips=document.createElement('div');
        chips.className='schips';
        g.opts.forEach(function(opt,i){
          var btn=document.createElement('button');
          btn.type='button';
          btn.className='chip'+(i===g.def?' active':'');
          btn.setAttribute('aria-pressed',i===g.def?'true':'false');
          btn.textContent=opt;
          btn.addEventListener('click',function(){
            chips.querySelectorAll('.chip').forEach(function(c){c.classList.remove('active');c.setAttribute('aria-pressed','false')});
            btn.classList.add('active');btn.setAttribute('aria-pressed','true');
            g.onChange(i);
          });
          chips.appendChild(btn);
        });
        g._reset=function(){
          chips.querySelectorAll('.chip').forEach(function(c,i){var a=i===g.def;c.classList.toggle('active',a);c.setAttribute('aria-pressed',a?'true':'false')});
          g.onChange(g.def);
        };
        g._next=function(){var cl=chips.querySelectorAll('.chip'),cur=0;cl.forEach(function(c,i){if(c.classList.contains('active'))cur=i});cl[(cur+1)%g.opts.length].click()};
        row.appendChild(chips);

      }else if(g.type==='stepper'){
        g.steps=g.steps.slice();
        sp.style.fontVariantNumeric='tabular-nums';
        sp.textContent=g.format(g.steps[g.def]);
        var stepper=document.createElement('div');
        stepper.className='stepper';
        var minus=document.createElement('button');
        minus.type='button';minus.className='step-btn';minus.innerHTML='<svg viewBox="0 0 24 24"><line x1="5" y1="12" x2="19" y2="12"/></svg>';minus.setAttribute('aria-label','Decrease');
        var plus=document.createElement('button');
        plus.type='button';plus.className='step-btn';plus.innerHTML='<svg viewBox="0 0 24 24"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>';plus.setAttribute('aria-label','Increase');
        var idx=g.def;
        var upd=function(){
          sp.textContent=g.format(g.steps[idx]);
          minus.disabled=idx===0;
          plus.disabled=idx===g.steps.length-1;
          g.onChange(idx);
        };
        minus.addEventListener('click',function(){if(idx>0){idx--;upd()}});
        plus.addEventListener('click',function(){if(idx<g.steps.length-1){idx++;upd()}});
        g._reset=function(){idx=g.def;upd()};
        g._inc=function(){if(idx<g.steps.length-1){idx++;upd()}};
        g._dec=function(){if(idx>0){idx--;upd()}};
        g._setIdx=function(i){if(i>=0&&i<g.steps.length){idx=i;upd()}};
        g._setVal=function(v){var i=g.steps.indexOf(v);if(i<0){for(i=0;i<g.steps.length;i++){if(g.steps[i]>v)break}g.steps.splice(i,0,v)}idx=i;sp.textContent=g.format(v);minus.disabled=idx===0;plus.disabled=idx===g.steps.length-1};
        minus.disabled=g.def===0;
        plus.disabled=g.def===g.steps.length-1;
        stepper.appendChild(minus);stepper.appendChild(plus);
        row.appendChild(stepper);
      }
    }

    g._row=row;
    lbl.setAttribute('tabindex','0');lbl.setAttribute('role','button');
    row.addEventListener('click',function(e){if(!e.target.closest('button')&&g._reset)resetGroup(g)});
    lbl.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();if(g._reset)resetGroup(g)}});
    container.appendChild(row);
  });
}

function updatePvStyle(pv,style){
  pv.classList.remove('dark','checker');
  if(style===1)pv.classList.add('dark');
  else if(style===2)pv.classList.add('checker');
}

function copyCanvas(canvas,btn,inputEl){
  if(!navigator.clipboard||!navigator.clipboard.write){_base.feedback(btn,'err-fb','No Access');return}
  navigator.clipboard.write([
    new ClipboardItem({'image/png':new Promise(function(resolve,reject){canvas.toBlob(function(b){b?resolve(b):reject()},'image/png')})})
  ]).then(function(){
    _base.feedback(btn,'ok','Copied');
  },function(){
    var text=inputEl.value.trim();
    if(text)_base.copyText(text,function(){_base.feedback(btn,'ok','Copied Text')},function(){_base.feedback(btn,'err-fb','Error')});
    else _base.feedback(btn,'err-fb','Error');
  });
}

function dlName(fallback,inputEl){
  var text=inputEl.value.trim();
  if(!text)return fallback;
  var s=text.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
  return s.slice(0,20)||fallback;
}

function dlBlob(blob,name,btn){
  var url=URL.createObjectURL(blob);
  dlA.download=name;dlA.href=url;dlA.click();
  setTimeout(function(){URL.revokeObjectURL(url)},1e4);
  _base.feedback(btn,'dl-fb','Downloaded');
}

function downloadExport(canvas,svgStr,fmt,name,btn){
  if(fmt===1&&svgStr){
    dlBlob(new Blob([svgStr],{type:'image/svg+xml'}),name+'.svg',btn);
  }else if(fmt===2&&canvas){
    jpgC.width=canvas.width;jpgC.height=canvas.height;
    jpgCtx.fillStyle='#FFFFFF';jpgCtx.fillRect(0,0,jpgC.width,jpgC.height);
    jpgCtx.drawImage(canvas,0,0);
    jpgC.toBlob(function(blob){if(blob)dlBlob(blob,name+'.jpg',btn);else _base.feedback(btn,'err-fb','Error')},'image/jpeg',1);
  }else if(canvas){
    canvas.toBlob(function(blob){if(blob)dlBlob(blob,name+'.png',btn);else _base.feedback(btn,'err-fb','Error')},'image/png');
  }
}

function scanImage(blob,decodeFn){
  return createImageBitmap(blob).then(decodeFn).catch(function(){
    var url=URL.createObjectURL(blob),img=new Image();
    return new Promise(function(resolve){
      img.onload=function(){URL.revokeObjectURL(url);decodeFn(img).then(resolve).catch(function(){resolve(null)})};
      img.onerror=function(){URL.revokeObjectURL(url);resolve(null)};
      img.src=url;
    });
  });
}

function doResetAll(groups,input){
  input.value='';if(input.tagName==='TEXTAREA')autoGrow(input);
  groups.forEach(function(g){if(g._ft)clearTimeout(g._ft)});
  groups.forEach(function(g){if(g._reset)resetGroup(g)});
}

window._cg={
  ACT_SVG:ACT_SVG,
  NF:NF,
  STYLES:STYLES,
  debounce:debounce,
  autoGrow:autoGrow,
  pvPop:pvPop,
  mkBtn:mkBtn,
  mkActions:mkActions,
  drawCropMarks:drawCropMarks,
  drawQR:drawQR,
  quantizeCanvas:quantizeCanvas,
  resetGroup:resetGroup,
  initSettings:initSettings,
  updatePvStyle:updatePvStyle,
  copyCanvas:copyCanvas,
  dlName:dlName,
  dlBlob:dlBlob,
  downloadExport:downloadExport,
  scanImage:scanImage,
  doResetAll:doResetAll
};
})();
