(function(){
  'use strict';
  function norm(s){return s.normalize('NFD').replace(/[\u0300-\u036f]/g,'')}
  var _nCache={};
  function normC(s){return _nCache[s]||(_nCache[s]=norm(s))}
  function dlDist(a,b,max){
    var la=a.length,lb=b.length;
    if(Math.abs(la-lb)>max)return max+1;
    if(!la)return lb>max?max+1:lb;
    if(!lb)return la>max?max+1:la;
    var pp=[],pr=[],cr=[];
    for(var j=0;j<=lb;j++)pr[j]=j;
    for(var i=1;i<=la;i++){
      cr[0]=i;var mn=cr[0];
      for(var j=1;j<=lb;j++){
        var cost=a[i-1]===b[j-1]?0:1;
        cr[j]=Math.min(pr[j]+1,cr[j-1]+1,pr[j-1]+cost);
        if(i>1&&j>1&&a[i-1]===b[j-2]&&a[i-2]===b[j-1]&&pp.length)
          cr[j]=Math.min(cr[j],pp[j-2]+cost);
        if(cr[j]<mn)mn=cr[j];
      }
      if(mn>max)return max+1;
      var t=pp;pp=pr;pr=cr;cr=t.length?t:[];
    }
    return pr[lb]>max?max+1:pr[lb];
  }
  function scoreWord(w,t,cvPenalty){
    var nt=normC(t),nw=norm(w);
    var i=nt.indexOf(nw);
    if(i!==-1){
      if(i===0&&nt.length===nw.length)return 10;
      if(i===0)return 8+(nw.length>=4?1:0);
      if(nt[i-1]===' ')return 6+(nw.length>=4?1:0);
      return 4+(1-i/nt.length);
    }
    var d1=dlDist(nw,nt,1);
    if(d1<=1&&nw.length>=3)return 3+(nw.length>=5?0.5:0);
    if(nw.length>=5){
      var wds=nt.split(' ');
      for(var k=0;k<wds.length;k++){
        if(dlDist(nw,wds[k],1)<=1)return 3+(nw.length>=5?0.5:0);
        if(dlDist(nw,wds[k],2)<=2)return 2;
      }
      if(dlDist(nw,nt,2)<=2)return 2;
    }else if(nw.length>=3){
      var wds=nt.split(' ');
      for(var k=0;k<wds.length;k++){
        if(dlDist(nw,wds[k],1)<=1)return 3;
      }
    }
    var qi=0,first=-1,last=0;
    for(var ti=0;ti<nt.length&&qi<nw.length;ti++){
      if(nt[ti]===nw[qi]){if(first<0)first=ti;last=ti;qi++}
    }
    if(qi<nw.length)return 0;
    var f=0.3+nw.length/(last-first+1)*1.2;
    return cvPenalty?f*0.7:f;
  }
  window._search={norm:norm,normC:normC,dlDist:dlDist,scoreWord:scoreWord,clearCache:function(){_nCache={}}};
})();
