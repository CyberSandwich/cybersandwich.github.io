(function(){
'use strict';
function $(id){return document.getElementById(id)}
function fmtSize(b){
  if(b<1024)return b+' B';
  if(b<1048576)return(b/1024).toFixed(1)+' KB';
  return(b/1048576).toFixed(1)+' MB';
}
function tick(){return new Promise(function(r){requestAnimationFrame(r)})}
function b64toAB(s){var b=atob(s),n=b.length,u=new Uint8Array(n);for(var i=0;i<n;i++)u[i]=b.charCodeAt(i);return u.buffer}

var queue=[],processing=false,results=[],notifTimer=null,abortGen=0;
var cfg=null;

function showNotif(msg){
  var el=$('notif');el.textContent=msg;el.classList.add('show');
  if(notifTimer)clearTimeout(notifTimer);
  notifTimer=setTimeout(function(){el.classList.remove('show')},3000);
}
function hideNotif(){$('notif').classList.remove('show');if(notifTimer)clearTimeout(notifTimer)}

function updateCard(card,text,pct){card._fill.style.width=pct+'%';card._stage.textContent=text}

function errorCard(card,msg){
  if(card._fill&&card._fill.parentNode)card._fill.parentNode.remove();
  if(card._stage&&card._stage.parentNode)card._stage.remove();
  if(card._orig&&card._orig.parentNode)card._orig.remove();
  var err=document.createElement('span');err.className='fc-err';err.textContent=msg;
  card._top.appendChild(err);
}

function updateSummary(){
  var done=results.filter(function(r){return r.blob});
  if(done.length===0){$('sum').style.display='none';return}
  var totOrig=0,totNew=0;
  done.forEach(function(r){totOrig+=r.origSize;totNew+=r.blob.size});
  var pct=Math.round((1-totNew/totOrig)*100);
  $('sum-count').textContent=done.length+' File'+(done.length>1?'s':'');
  var ss=$('sum-save');ss.textContent=pct>=0?'Saved '+pct+'%':'Grew '+Math.abs(pct)+'%';
  ss.style.color=pct>=0?'#34D399':'#F59E0B';
  $('sum-sizes').textContent=fmtSize(totOrig)+' \u2192 '+fmtSize(totNew);
  $('sum').style.display='';
}

function downloadBlob(blob,name){
  var a=document.createElement('a');var url=URL.createObjectURL(blob);
  a.href=url;a.download=name;document.body.appendChild(a);a.click();
  document.body.removeChild(a);setTimeout(function(){URL.revokeObjectURL(url)},100);
}

function downloadAll(){
  var items=results.filter(function(r){return r.blob});
  if(!items.length)return;
  var i=0;
  function next(){if(i>=items.length)return;downloadBlob(items[i].blob,items[i].outName);i++;setTimeout(next,200)}
  next();
}

function copyTopImage(){
  var cards=$('files').children;
  for(var i=0;i<cards.length;i++){
    if(cards[i]._blob){
      var cp=cards[i].querySelector('.fc-acts button:last-child');
      if(cp)cfg.copyBlob(cards[i]._blob,cp);
      return;
    }
  }
}

function pasteImage(){
  if(!navigator.clipboard||!navigator.clipboard.read)return;
  navigator.clipboard.read().then(function(items){
    items.forEach(function(item){
      item.types.forEach(function(type){
        if(type.startsWith('image/')){
          item.getType(type).then(function(blob){
            enqueue([new File([blob],'clipboard.'+type.split('/')[1],{type:type})]);
          });
        }
      });
    });
  }).catch(function(){});
}

function createCard(file){
  var d=document.createElement('div');d.className='card fcard';
  var top=document.createElement('div');top.className='fc-top';
  var name=document.createElement('span');name.className='fc-name';name.textContent=file.name;
  var orig=document.createElement('span');orig.className='fc-orig';orig.textContent=fmtSize(file.size);
  top.appendChild(name);
  if(cfg.decorateCard)cfg.decorateCard(top,file);
  top.appendChild(orig);
  var bar=document.createElement('div');bar.className='fc-bar';
  var fill=document.createElement('div');fill.className='fc-fill';
  bar.appendChild(fill);
  var stage=document.createElement('div');stage.className='fc-stage';stage.textContent='Queued';
  d.appendChild(top);d.appendChild(bar);d.appendChild(stage);
  d._fill=fill;d._stage=stage;d._orig=orig;d._top=top;d._name=file.name;d._origSize=file.size;
  $('files').appendChild(d);
  return d;
}

function completeCard(card,blob){
  var origSize=card._origSize,newSize=blob.size;
  var pct=Math.round((1-newSize/origSize)*100);
  card._fill.parentNode.remove();card._stage.remove();card._orig.remove();
  var save=document.createElement('span');
  save.className=pct>0?'fc-save':'fc-grow';
  save.textContent=(pct>0?'-':'+')+Math.abs(pct)+'%';
  card._top.appendChild(save);
  var sizes=document.createElement('div');sizes.className='fc-sizes';
  sizes.textContent=fmtSize(origSize)+' \u2192 '+fmtSize(newSize);
  card.appendChild(sizes);
  if(pct>0){
    var acts=document.createElement('div');acts.className='fc-acts';
    var dl=document.createElement('button');dl.textContent='Download';
    var outName=card._name.replace(/\.[^.]+$/,'')+'_optimized.'+cfg.ext;
    dl.addEventListener('click',function(){downloadBlob(blob,outName)});
    var cp=document.createElement('button');cp.textContent='Copy';
    cp.addEventListener('click',function(){cfg.copyBlob(blob,cp)});
    acts.appendChild(dl);acts.appendChild(cp);card.appendChild(acts);
    card._blob=blob;card._outName=outName;
  }else{
    var note=document.createElement('div');note.className='fc-sizes';
    note.textContent='Already Optimal';card.appendChild(note);
  }
}

function enqueue(fileList){
  for(var i=0;i<fileList.length;i++){
    var f=fileList[i],card;
    if(f.type==='image/heic'||f.type==='image/heif'||/\.hei[cf]$/i.test(f.name)){
      card=createCard(f);errorCard(card,'HEIC Not Supported');
      results.push({origSize:f.size,blob:null,outName:''});continue;
    }
    if(f.type&&!/^image\//.test(f.type)){
      card=createCard(f);errorCard(card,'Unsupported Format');
      results.push({origSize:f.size,blob:null,outName:''});continue;
    }
    if(f.size>52428800)showNotif('Large File \u2014 Processing May Be Slow');
    card=createCard(f);queue.push({file:f,card:card});
  }
  updateActions();
  if(!processing)drain();
}

async function drain(){
  processing=true;
  var gen=abortGen;
  if(!cfg.wasmCompiled){
    await cfg.compileWasm();
    if(gen!==abortGen){processing=false;return}
    if(cfg.wasmFailed)showNotif('Canvas-Only Mode');
  }
  while(queue.length&&gen===abortGen){
    var item=queue.shift();
    try{
      var blob=await cfg.processFile(item.file,item.card);
      if(gen!==abortGen)break;
      completeCard(item.card,blob);
      var grew=blob.size>=item.file.size;
      results.push({origSize:item.file.size,blob:grew?null:blob,outName:grew?'':item.card._outName});
    }catch(e){
      if(gen!==abortGen)break;
      errorCard(item.card,e.message||'Processing Failed');
      results.push({origSize:item.file.size,blob:null,outName:''});
    }
    updateSummary();
  }
  if(gen===abortGen){processing=false;updateActions()}
}

function updateActions(){
  var hasFiles=results.length>0||queue.length>0;
  $('acts').style.display=hasFiles?'':'none';
  $('zone').style.display=hasFiles?'none':'';
  document.body.classList.toggle('has-files',hasFiles);
  $('dl-all').disabled=!results.some(function(r){return r.blob});
}

function doClearAll(){
  if(cfg.activeWorker){cfg.activeWorker.terminate();cfg.activeWorker=null}
  if(cfg.activeReject){cfg.activeReject(new Error('Cancelled'));cfg.activeReject=null}
  abortGen++;queue=[];results=[];processing=false;
  $('files').textContent='';$('sum').style.display='none';
  updateActions();
}

function init(c){
  cfg=c;
  var clearCtrl=_base.twoPress($('clear'),{
    text:'Clear All',
    guard:function(){return results.length>0||queue.length>0},
    onConfirm:doClearAll
  });
  function clearAll(){clearCtrl.press()}

  var fin=$('fin');
  document.body.addEventListener('click',function(e){if(!document.body.classList.contains('has-files')&&!e.target.closest('nav,button,a'))fin.click()});
  $('zone').addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();fin.click()}});
  fin.addEventListener('change',function(){if(fin.files.length)enqueue(fin.files);fin.value=''});
  $('dl-all').addEventListener('click',downloadAll);
  $('add-more').addEventListener('click',function(){fin.click()});
  $('clear').addEventListener('click',function(){clearCtrl.press()});

  _base.setupDragDrop({overlay:$('drop-ov'),onDrop:function(files){
    if(files&&files.length)enqueue(files);
  }});

  document.addEventListener('paste',function(e){
    var items=e.clipboardData&&e.clipboardData.items;if(!items)return;
    var files=[];
    for(var i=0;i<items.length;i++){if(items[i].kind==='file'){var f=items[i].getAsFile();if(f)files.push(f)}}
    if(files.length){e.preventDefault();enqueue(files)}
  });

  window.addEventListener('unload',function(){if(cfg.workerUrl)URL.revokeObjectURL(cfg.workerUrl)});

  var keys={ctrl:{s:function(e){e.preventDefault();downloadAll()},c:function(e){e.preventDefault();copyTopImage()},v:function(e){e.preventDefault();pasteImage()}},' ':function(e){e.preventDefault();fin.click()},Enter:function(e){e.preventDefault();fin.click()},s:function(e){e.preventDefault();downloadAll()},d:function(e){e.preventDefault();downloadAll()},c:function(e){e.preventDefault();copyTopImage()},v:function(e){e.preventDefault();pasteImage()},r:function(e){e.preventDefault();clearAll()},Escape:function(e){e.preventDefault();clearAll()}};
  if(cfg.navKeys)for(var k in cfg.navKeys)keys[k]=cfg.navKeys[k];
  _base.onKey(keys);
}

window._io={
  b64toAB:b64toAB,
  tick:tick,
  showNotif:showNotif,
  updateCard:updateCard,
  init:init
};
})();
