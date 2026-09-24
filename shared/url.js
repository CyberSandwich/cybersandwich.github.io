(function(){
'use strict';

/* Known TLDs (single and two-label, e.g. co.uk) and a suffix-aware host split, shared by parsely and bookmark. */
var TLDS=[
'com','net','org','info','biz','name','pro','int','mil','edu','gov',
'io','dev','app','me','co','ai','tech','xyz','online','site','store','blog','shop','top','icu','cloud','digital','media','agency','design','studio','global','world','group','live','life','news','plus','one','zone','works','systems','solutions','services','consulting','ventures','holdings','capital','finance','money','company','business','enterprises','industries','foundation','institute','academy','university','college','school','training','health','care','clinic','dental','fitness','center','network','email','marketing','social','community',
'us','uk','de','fr','it','es','nl','be','at','ch','se','no','dk','fi','pt','ie','pl','cz','sk','hu','ro','bg','hr','si','rs','ba','mk','me','al','gr','cy','mt','lu','li','is','ee','lv','lt','ru','ua','by','md','ge','am','az','kz','uz','tm','kg','tj',
'au','nz','jp','cn','kr','tw','hk','sg','my','th','id','ph','vn','in','pk','bd','lk','np','mm','kh','la','mn',
'br','mx','ar','cl','co','pe','ve','ec','uy','py','bo','cr','pa','sv','gt','hn','ni','cu','do','pr','jm','tt','bb','bs','ky',
'za','ng','ke','gh','tz','ug','et','rw','cm','ci','sn','ml','bf','ne','tg','bj','mg','mz','zw','zm','bw','na','mu','mw','ao','cd','cg',
'eg','ma','dz','tn','ly','sd','ss',
'sa','ae','qa','kw','bh','om','jo','lb','il','iq','ir','ye','sy','tr',
'ca',
'ly','tv','cc','gg','to','fm','ws','la','vc','sc','ac','sh','im','je','gi',
'co.uk','org.uk','gov.uk','ac.uk','net.uk','me.uk','nhs.uk','sch.uk','police.uk',
'com.au','org.au','gov.au','edu.au','net.au','asn.au',
'co.nz','org.nz','net.nz','govt.nz','ac.nz','school.nz',
'co.za','org.za','gov.za','edu.za','net.za',
'co.in','org.in','gov.in','net.in','ac.in','edu.in',
'co.jp','or.jp','ne.jp','ac.jp','go.jp','ed.jp',
'co.kr','or.kr','go.kr','ac.kr','ne.kr',
'com.cn','org.cn','gov.cn','net.cn','edu.cn','ac.cn',
'com.hk','org.hk','gov.hk','edu.hk','net.hk',
'com.tw','org.tw','gov.tw','edu.tw','net.tw',
'com.sg','org.sg','gov.sg','edu.sg','net.sg',
'com.my','org.my','gov.my','edu.my','net.my',
'co.id','or.id','go.id','ac.id','web.id',
'co.th','or.th','go.th','ac.th','in.th',
'com.ph','org.ph','gov.ph','edu.ph','net.ph',
'com.vn','org.vn','gov.vn','edu.vn','net.vn',
'com.bd','org.bd','gov.bd','edu.bd','net.bd',
'com.pk','org.pk','gov.pk','edu.pk','net.pk',
'com.lk','org.lk','gov.lk','edu.lk','net.lk',
'com.br','org.br','gov.br','edu.br','net.br',
'com.mx','org.mx','gob.mx','edu.mx','net.mx',
'com.ar','org.ar','gov.ar','edu.ar','net.ar',
'com.co','org.co','gov.co','edu.co','net.co',
'com.pe','org.pe','gob.pe','edu.pe','net.pe',
'co.cl',
'com.ve','org.ve','gov.ve','edu.ve','net.ve',
'com.ng','org.ng','gov.ng','edu.ng','net.ng',
'co.ke','or.ke','go.ke','ac.ke','ne.ke',
'com.gh','org.gh','gov.gh','edu.gh',
'co.tz','or.tz','go.tz','ac.tz','ne.tz',
'co.ug','or.ug','go.ug','ac.ug',
'com.eg','org.eg','gov.eg','edu.eg','net.eg',
'co.ma','ac.ma','gov.ma','net.ma','org.ma',
'com.sa','org.sa','gov.sa','edu.sa','net.sa',
'co.ae','org.ae','gov.ae','ac.ae','net.ae',
'com.qa','org.qa','gov.qa','edu.qa','net.qa',
'com.kw','org.kw','gov.kw','edu.kw','net.kw',
'com.bh','org.bh','gov.bh','edu.bh','net.bh',
'co.il','org.il','gov.il','ac.il','net.il',
'com.tr','org.tr','gov.tr','edu.tr','net.tr',
'com.ru','org.ru',
'com.ua','org.ua','gov.ua','edu.ua','net.ua',
'co.zw','org.zw','gov.zw','ac.zw',
'co.zm','org.zm','gov.zm','ac.zm',
'co.bw','org.bw',
'com.om','org.om','gov.om','edu.om','net.om',
'com.lb','org.lb','gov.lb','edu.lb','net.lb',
'com.jo','org.jo','gov.jo','edu.jo','net.jo',
'com.np','org.np','gov.np','edu.np','net.np',
'com.mm','org.mm','gov.mm','edu.mm','net.mm',
'com.kh','org.kh','gov.kh','edu.kh','net.kh',
'com.la',
'gov.ie','com.pa','gob.pa',
'gob.sv','com.sv','com.gt','gob.gt','com.hn','gob.hn','com.ni','gob.ni'
].join(',').split(',');
var TLD_SET={};for(var ti=0;ti<TLDS.length;ti++)TLD_SET[TLDS[ti]]=1;
var MULTI_TLDS={};for(var ti=0;ti<TLDS.length;ti++)if(TLDS[ti].indexOf('.')!==-1)MULTI_TLDS[TLDS[ti]]=1;
var TLDS_PAT=TLDS.map(function(t){return t.replace(/\./g,'\\.')}).sort(function(a,b){return b.length-a.length}).join('|');
function hostBase(h){
  var parts=h.split('.');
  for(var i=parts.length-1;i>=1;i--){
    var tld=parts.slice(i).join('.');
    if(MULTI_TLDS[tld])return parts.slice(0,i).join('.');
  }
  if(parts.length>=2)return parts.slice(0,-1).join('.');
  return h;
}

var _urlExports={TLDS:TLDS,TLD_SET:TLD_SET,MULTI_TLDS:MULTI_TLDS,TLDS_PAT:TLDS_PAT,hostBase:hostBase};
if(typeof window!=='undefined')window._url=_urlExports;
if(typeof globalThis!=='undefined')globalThis._url=_urlExports;
})();
