(function(){
'use strict';

/* Date Parser — robust two-pass: normalize+autoCorrect, then match cascade */
var MONTHS={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
var MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS={sun:0,sunday:0,mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};

var EASTER={2025:[3,20],2026:[4,5],2027:[3,28],2028:[4,16],2029:[4,1],2030:[4,21],2031:[4,13],2032:[3,28],2033:[4,17],2034:[4,9],2035:[3,25],2036:[4,13],2037:[4,5],2038:[4,25],2039:[4,10],2040:[4,1]};
var CNY={2025:[1,29],2026:[2,17],2027:[2,6],2028:[1,26],2029:[2,13],2030:[2,3],2031:[1,23],2032:[2,11],2033:[1,31],2034:[2,19],2035:[2,8],2036:[1,28],2037:[2,15],2038:[2,4],2039:[1,24],2040:[2,12]};

/* ---------- normalize / damerau / fuzzy / autoCorrect ---------- */

function normalize(s){
  return String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'').replace(/\s+/g,' ').trim();
}

function damerau(a,b,cap){
  var la=a.length,lb=b.length;
  if(Math.abs(la-lb)>cap)return cap+1;
  if(la===0)return lb;
  if(lb===0)return la;
  var prev2=new Array(lb+1),prev1=new Array(lb+1),curr=new Array(lb+1);
  for(var j=0;j<=lb;j++)prev1[j]=j;
  for(var i=1;i<=la;i++){
    curr[0]=i;
    var rowMin=i;
    for(var j=1;j<=lb;j++){
      var cost=a.charCodeAt(i-1)===b.charCodeAt(j-1)?0:1;
      var v=curr[j-1]+1;
      var w=prev1[j]+1;if(w<v)v=w;
      var x=prev1[j-1]+cost;if(x<v)v=x;
      if(i>1&&j>1&&a.charCodeAt(i-1)===b.charCodeAt(j-2)&&a.charCodeAt(i-2)===b.charCodeAt(j-1)){
        var t=prev2[j-2]+1;if(t<v)v=t;
      }
      curr[j]=v;
      if(v<rowMin)rowMin=v;
    }
    if(rowMin>cap)return cap+1;
    var tmp=prev2;prev2=prev1;prev1=curr;curr=tmp;
  }
  return prev1[lb];
}

function getThreshold(len){
  if(len<=3)return 0;
  if(len<=5)return 1;
  return 2;
}

function fuzzyLookup(token,keys,cap){
  var best=null,bestDist=cap+1;
  for(var i=0;i<keys.length;i++){
    var k=keys[i];
    var d=damerau(token,k,bestDist);
    if(d<bestDist){best=k;bestDist=d;}
    else if(d===bestDist&&best){
      var dt=Math.abs(k.length-token.length),db=Math.abs(best.length-token.length);
      if(dt<db){best=k;}
    }
  }
  return bestDist<=cap?best:null;
}

var CORRECTION_DICT=(function(){
  var d={},k,i,arr=[
    'today','tomorrow','tmr','tmrw','tmw','yesterday','ytd',
    'next','last','this','in','on','at','from','until','by','for','ago','before','after','of',
    'noon','midday','midnight','half','past','quarter','to','am','pm','oclock','clock',
    'tonight','evening','morning','afternoon','weekend','weekday','weekdays',
    'working','business','work',
    'end','start','week','weeks','month','months','year','years',
    'day','days','fortnight','fortnights','hour','hours','minute','minutes','min','mins','second','seconds','sec','secs',
    'christmas','xmas','easter','thanksgiving','halloween','ny','nye','valentine','valentines','paddy','patrick','st','fool','fools','bonfire','fawkes','veterans','armistice','remembrance','boxing','burns','australia','groundhog','mlk','presidents','mother','father','labor','labour','columbus','indigenous','memorial','spring','summer','bank','holiday','independence','bastille','hallows','guy','turkey','chinese','lunar','cny','good','martin','luther','king','jr','peoples','eve'
  ];
  for(k in MONTHS)d[k]=true;
  for(k in DAYS)d[k]=true;
  for(i=0;i<arr.length;i++)d[arr[i]]=true;
  return d;
})();
var CORRECTION_KEYS=Object.keys(CORRECTION_DICT);

function autoCorrect(text){
  return String(text).replace(/[A-Za-z]+/g,function(token){
    var lower=token.toLowerCase();
    if(CORRECTION_DICT[lower])return token;
    var thr=getThreshold(lower.length);
    if(thr===0)return token;
    var hit=fuzzyLookup(lower,CORRECTION_KEYS,thr);
    if(!hit)return token;
    if(token===token.toUpperCase())return hit.toUpperCase();
    if(token.charAt(0)===token.charAt(0).toUpperCase())return hit.charAt(0).toUpperCase()+hit.slice(1);
    return hit;
  });
}

function stripPunct(text){
  return String(text).split(/(\s+)/).map(function(part){
    if(/^\s+$/.test(part))return part;
    return part.replace(/^[^\w]+|[^\w]+$/g,'');
  }).join('').trim();
}

/* Rewrite decimal-hour notation as colon time: "5.5pm" -> "5:30pm",
   "17.5" -> "17:30", "12.5am" -> "12:30am", "5.25pm" -> "5:15pm".
   Skipped if hour > 23, if minutes round to 60+, or if a duration unit
   word (week/month/year/day/fortnight/hour/min/sec) follows, so "10.5 weeks"
   stays intact for the relative-quantity matcher. */
function expandDecimalTime(text){
  return String(text).replace(/\b(\d{1,2})\.(\d+)(\s*(?:am?|pm?))?\b(?!\s*(?:weeks?|months?|years?|days?|fortnights?|hours?|hrs?|minutes?|mins?|seconds?|secs?))/gi,function(whole,h,dec,suf){
    var hh=parseInt(h,10);
    var min=Math.round(parseFloat('0.'+dec)*60);
    if(hh>23||min<0||min>=60)return whole;
    return hh+':'+(min<10?'0':'')+min+(suf||'');
  });
}

/* ---------- helpers (unchanged) ---------- */

/* Add n working days (Mon-Fri) to a date, skipping weekends. Negative n walks
   backwards. Used by "5 working days", "3 business days ago", etc. */
function addWorkingDays(date,n){
  var d=new Date(date);
  var step=n>=0?1:-1;
  var remaining=Math.abs(Math.round(n));
  while(remaining>0){
    d.setDate(d.getDate()+step);
    var dow=d.getDay();
    if(dow!==0&&dow!==6)remaining--;
  }
  return d;
}

function nextOccurrence(m,d){
  var now=new Date(),y=now.getFullYear();
  var dt=new Date(y,m,d);
  if(dt<now){dt=new Date(y+1,m,d)}
  return dt;
}

function nthWeekday(year,month,weekday,n){
  var d=new Date(year,month,1);
  var first=d.getDay();
  var offset=(weekday-first+7)%7;
  d.setDate(1+offset+(n-1)*7);
  return d;
}

function lastWeekday(year,month,weekday){
  var d=new Date(year,month+1,0);
  var diff=(d.getDay()-weekday+7)%7;
  d.setDate(d.getDate()-diff);
  return d;
}

function nextNthWeekday(month,weekday,n){
  var now=new Date(),y=now.getFullYear();
  var dt=nthWeekday(y,month,weekday,n);
  if(dt<now)dt=nthWeekday(y+1,month,weekday,n);
  return dt;
}

function nextLastWeekday(month,weekday){
  var now=new Date(),y=now.getFullYear();
  var dt=lastWeekday(y,month,weekday);
  if(dt<now)dt=lastWeekday(y+1,month,weekday);
  return dt;
}

function nextPrecomputed(table,offsetDays){
  var now=new Date();
  for(var y=now.getFullYear();y<=2040;y++){
    var e=table[y];if(!e)continue;
    var dt=new Date(y,e[0]-1,e[1]);
    if(offsetDays)dt.setDate(dt.getDate()+offsetDays);
    if(dt>=new Date(now.getFullYear(),now.getMonth(),now.getDate()))return dt;
  }
  return null;
}

function autoAmPm(h,min){
  var now=new Date(),curH=now.getHours(),curM=now.getMinutes();
  var amH=h===12?0:h,pmH=h===12?12:h+12;
  if(amH>curH||(amH===curH&&min>curM))return amH;
  if(pmH>curH||(pmH===curH&&min>curM))return pmH;
  return amH;
}

function parseTime(text){
  var t=text.trim(),h,min,m;

  if(/\bnoon\b/i.test(t)||/\bmidday\b/i.test(t))return{h:12,m:0,raw:t.match(/\b(?:noon|midday)\b/i)[0]};
  if(/\bmidnight\b/i.test(t))return{h:0,m:0,raw:t.match(/\bmidnight\b/i)[0]};

  m=t.match(/\bhalf\s+past\s+(\d{1,2})\b/i)||t.match(/\bhalf\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:30,raw:m[0]}}

  m=t.match(/\bquarter\s+past\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:15,raw:m[0]}}

  m=t.match(/\bquarter\s+to\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:(h===1?12:h-1),m:45,raw:m[0]}}

  m=t.match(/\b(\d{1,2})\s*o['']?clock\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:0,raw:m[0]}}

  m=t.match(/[\s,]+(\d{1,2})\s+(\d{2})\s*(am?|pm?)\s*$/i);
  if(!m)m=t.match(/^(\d{1,2})\s+(\d{2})\s*(am?|pm?)[\s,]+/i);
  if(!m)m=t.match(/^(\d{1,2})\s+(\d{2})\s*(am?|pm?)$/i);
  if(m){
    h=parseInt(m[1],10);min=parseInt(m[2],10);
    var ap=m[3].toLowerCase().charAt(0);
    if(ap==='p'&&h<12)h+=12;if(ap==='a'&&h===12)h=0;
    if(h>23||min>59)return null;
    return{h:h,m:min,raw:m[0]};
  }

  m=t.match(/[\s,]+(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)\s*$/i)||t.match(/[\s,]+(\d{1,2}):(\d{2})\s*$/i);
  if(!m){
    m=t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)[\s,]+/i)||t.match(/^(\d{1,2}):(\d{2})[\s,]+/i);
  }
  if(!m){
    m=t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)$/i)||t.match(/^(\d{1,2}):(\d{2})$/i);
  }
  if(m){
    h=parseInt(m[1],10);min=m[2]?parseInt(m[2],10):0;
    var ap=m[3]?m[3].toLowerCase():null;
    if(ap){ap=ap.charAt(0);if(ap==='p'&&h<12)h+=12;if(ap==='a'&&h===12)h=0}
    if(h>23||min>59)return null;
    return{h:h,m:min,raw:m[0]};
  }

  m=t.match(/[\s,]+(\d{3,4})\s*(am?|pm?)\s*$/i);
  if(!m)m=t.match(/^(\d{3,4})\s*(am?|pm?)[\s,]+/i);
  if(!m)m=t.match(/^(\d{3,4})\s*(am?|pm?)$/i);
  if(m){
    var dg=m[1];h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);min=parseInt(dg.slice(-2),10);
    var ap=m[2].toLowerCase().charAt(0);
    if(ap==='p'&&h<12)h+=12;if(ap==='a'&&h===12)h=0;
    if(h>23||min>59)return null;
    return{h:h,m:min,raw:m[0]};
  }

  m=t.match(/^(\d{3,4})$/);
  if(!m){
    var bm=t.match(/[\s,]+(\d{3,4})\s*$/)||t.match(/^(\d{3,4})[\s,]+/);
    if(bm){var dg=bm[1],th=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);if(th<=12)m=bm}
  }
  if(m){
    var dg=m[1];h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);min=parseInt(dg.slice(-2),10);
    if(min>59||h>23)return null;
    if(h>=1&&h<=12)h=autoAmPm(h,min);
    return{h:h,m:min,raw:m[0]};
  }

  m=t.match(/^(\d{1,2})$/);
  if(m){
    h=parseInt(m[1],10);
    if(h>23)return null;
    if(h>=1&&h<=12)h=autoAmPm(h,0);
    return{h:h,m:0,raw:m[0]};
  }

  return null;
}

function stripTime(text){
  var s=text;
  s=s.replace(/\b(?:noon|midday|midnight)\b/gi,'');
  s=s.replace(/\bhalf\s+past\s+\d{1,2}\b/gi,'');
  s=s.replace(/\bhalf\s+\d{1,2}\b/gi,'');
  s=s.replace(/\bquarter\s+(?:past|to)\s+\d{1,2}\b/gi,'');
  s=s.replace(/\b\d{1,2}\s*o['']?clock\b/gi,'');
  s=s.replace(/[\s,]+\d{1,2}\s+\d{2}\s*(?:am?|pm?)\s*$/i,'');
  s=s.replace(/^\d{1,2}\s+\d{2}\s*(?:am?|pm?)[\s,]+/i,'');
  s=s.replace(/[\s,]+(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)\s*$/i,'').replace(/[\s,]+(\d{1,2}):(\d{2})\s*$/i,'');
  s=s.replace(/^(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)[\s,]+/i,'').replace(/^(\d{1,2}):(\d{2})[\s,]+/i,'');
  s=s.replace(/^\d{3,4}\s*(?:am?|pm?)?\s*$/i,'');
  s=s.replace(/^\d{1,2}$/,'');
  /* Standalone bare time-only inputs: "5pm", "5p", "5:30", "5:30pm", "17:30" */
  s=s.replace(/^(\d{1,2}):(\d{2})\s*(?:am?|pm?)?$/i,'');
  s=s.replace(/^(\d{1,2})\s*(?:am?|pm?)$/i,'');
  s=s.replace(/[\s,]+\d{3,4}\s*(?:am?|pm?)\s*$/i,'');
  s=s.replace(/^\d{3,4}\s*(?:am?|pm?)[\s,]+/i,'');
  s=s.replace(/[\s,]+(\d{3,4})\s*$/,function(_,dg){var h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);return h<=12?'':_});
  s=s.replace(/^(\d{3,4})([\s,]+)/,function(_,dg){var h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);return h<=12?'':_});
  s=s.replace(/\s+at\s*$/i,'').replace(/^\s*at\s+/i,'');
  return s.trim();
}

/* Mid-prose time extractor: returns {h,m,raw,span:[a,b]} or null.
   Only matches explicit time forms (with am/pm, colon, or named); never bare digits. */
function findTimeMid(text){
  var m;
  m=text.match(/\b(noon|midday|midnight)\b/i);
  if(m)return{h:m[1].toLowerCase()==='midnight'?0:12,m:0,raw:m[0],span:[m.index,m.index+m[0].length]};

  m=text.match(/\b(half|quarter)\s+(past|to)\s+(\d{1,2})\b/i);
  if(m){
    var hh=parseInt(m[3],10);
    if(hh>=1&&hh<=12){
      var min,h2=hh,word=m[1].toLowerCase(),dir=m[2].toLowerCase();
      if(word==='half'){min=30;}
      else if(dir==='past'){min=15;}
      else{min=45;h2=hh===1?12:hh-1;}
      return{h:h2,m:min,raw:m[0],span:[m.index,m.index+m[0].length]};
    }
  }
  m=text.match(/\bhalf\s+(\d{1,2})\b/i);
  if(m){var hh=parseInt(m[1],10);if(hh>=1&&hh<=12)return{h:hh,m:30,raw:m[0],span:[m.index,m.index+m[0].length]};}

  m=text.match(/\b(\d{1,2})\s*o['']?clock\b/i);
  if(m){var hh=parseInt(m[1],10);if(hh>=1&&hh<=12)return{h:hh,m:0,raw:m[0],span:[m.index,m.index+m[0].length]};}

  m=text.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)\b/i);
  if(m){
    var h=parseInt(m[1],10),min=m[2]?parseInt(m[2],10):0,ap=m[3].toLowerCase().charAt(0);
    if(h<=23&&min<=59){
      if(ap==='p'&&h<12)h+=12;
      if(ap==='a'&&h===12)h=0;
      return{h:h,m:min,raw:m[0],span:[m.index,m.index+m[0].length]};
    }
  }

  m=text.match(/\b(\d{1,2}):(\d{2})\b/);
  if(m){
    var h=parseInt(m[1],10),min=parseInt(m[2],10);
    if(h<=23&&min<=59){
      if(h<=12)h=autoAmPm(h,min);
      return{h:h,m:min,raw:m[0],span:[m.index,m.index+m[0].length]};
    }
  }

  return null;
}

function applyTime(date,time){
  if(time){date.setHours(time.h,time.m,0,0)}
  else{date.setHours(0,0,0,0)}
  return date;
}

function daysInMonth(y,m){return new Date(y,m+1,0).getDate()}

function fmtTime12(h,m){
  var ap=h>=12?'PM':'AM';var hh=h%12;if(hh===0)hh=12;
  return m===0?hh+' '+ap:hh+':'+(m<10?'0':'')+m+' '+ap;
}
function formatLabel(date){
  return date.getDate()+' '+MONTH_NAMES[date.getMonth()]+' '+date.getFullYear()+', '+fmtTime12(date.getHours(),date.getMinutes());
}

function stripNoise(s){
  return s.replace(/\b(?:on|at|the|for|by|until|from|to|my|our|with|and|is|a|an)\b/gi,' ').replace(/\s{2,}/g,' ').trim();
}

/* ---------- match cascade ---------- */

function tryMatch(s,now,today){
  var result=null;

  /* 1a. Compound relative phrases (must come before single-keyword block).
     "tomorrow"/"yesterday" optional: bare "day after" implies +2, "day before" implies -2. */
  if(/^day\s+after(?:\s+(?:tomorrow|tmr|tmrw|tmw))?$/.test(s)){
    result=new Date(today);result.setDate(result.getDate()+2);
  }else if(/^day\s+before(?:\s+(?:yesterday|ytd))?$/.test(s)){
    result=new Date(today);result.setDate(result.getDate()-2);
  }else if(s==='tonight'){
    result=new Date(today);
    if(now.getHours()>=18){result.__dpTime={h:Math.min(now.getHours()+2,23),m:0};}
    else{result.__dpTime={h:20,m:0};}
  }else if(s==='this evening'){
    result=new Date(today);result.__dpTime={h:18,m:0};
  }else if(s==='this morning'){
    result=new Date(today);result.__dpTime={h:9,m:0};
  }else if(s==='this afternoon'){
    result=new Date(today);result.__dpTime={h:14,m:0};
  }else if(s==='this weekend'||s==='weekend'){
    result=new Date(today);
    var dow=result.getDay();
    if(dow!==6){var diff=(6-dow+7)%7;result.setDate(result.getDate()+diff);}
  }else if(s==='next weekend'){
    result=new Date(today);
    var dow=result.getDay(),diff=(6-dow+7)%7;
    if(diff===0)diff=7;
    result.setDate(result.getDate()+diff+7);
  }else if(s==='end of week'){
    result=new Date(today);
    var diff=(0-result.getDay()+7)%7;if(diff===0)diff=7;
    result.setDate(result.getDate()+diff);
  }else if(s==='end of month'){
    result=new Date(today.getFullYear(),today.getMonth()+1,0);
  }else if(s==='end of year'){
    result=new Date(today.getFullYear(),11,31);
  }else if(s==='start of week'||s==='start of next week'){
    result=new Date(today);
    var diff=(1-result.getDay()+7)%7;if(diff===0)diff=7;
    result.setDate(result.getDate()+diff);
  }else if(s==='start of next month'||s==='start of month'){
    result=new Date(today.getFullYear(),today.getMonth()+1,1);
  }

  /* 1b. Single-keyword relative */
  if(!result){
    if(s==='today'){
      result=new Date(today);
    }else if(s==='tomorrow'||s==='tmr'||s==='tmrw'||s==='tmw'){
      result=new Date(today);result.setDate(result.getDate()+1);
    }else if(s==='yesterday'||s==='ytd'){
      result=new Date(today);result.setDate(result.getDate()-1);
    }else if(s==='next week'){
      result=new Date(today);
      var dw=(1-result.getDay()+7)%7;
      result.setDate(result.getDate()+(dw===0?7:dw));
    }else if(s==='next month'){
      result=new Date(today.getFullYear(),today.getMonth()+1,1);
    }else if(s==='next year'){
      result=new Date(today.getFullYear()+1,0,1);
    }
  }

  /* 1b2. N working/business days. Must precede the generic day matcher because
     it spans multiple words ("5 working days", "3 business days ago"). */
  if(!result){
    var wdAgo=s.match(/(?:^|\s)(\d+(?:\.\d+)?)\s+(?:(?:working|business|work)\s+days?|weekdays?)\s+(?:ago|before)\b/);
    if(wdAgo){
      result=addWorkingDays(today,-parseFloat(wdAgo[1]));
    }else{
      var wd=s.match(/(?:^|\s)(?:in\s+|for\s+)?(\d+(?:\.\d+)?)\s+(?:(?:working|business|work)\s+days?|weekdays?)\b/);
      if(wd)result=addWorkingDays(today,parseFloat(wd[1]));
    }
  }

  /* 1c. N units ago/before (negative offset) */
  if(!result){
    var rmA=s.match(/(?:^|\s)(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years|fortnight|fortnights)\s+(?:ago|before)\b/);
    if(rmA){
      var n=parseFloat(rmA[1]),u=rmA[2].replace(/s$/,'');
      result=new Date(today);
      if(u==='day')result.setDate(result.getDate()-Math.round(n));
      else if(u==='week')result.setDate(result.getDate()-Math.round(n*7));
      else if(u==='fortnight')result.setDate(result.getDate()-Math.round(n*14));
      else if(u==='month')result.setMonth(result.getMonth()-Math.round(n));
      else if(u==='year')result.setFullYear(result.getFullYear()-Math.round(n));
    }
  }

  /* 1d. (in/for) N units (positive offset) */
  if(!result){
    var rm=s.match(/(?:^|\s)(?:in\s+|for\s+)?(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months|year|years|fortnight|fortnights|hour|hours|minute|minutes|min|mins|second|seconds|sec|secs)\b/);
    if(rm){
      var n=parseFloat(rm[1]),u=rm[2].replace(/s$/,'');
      if(u==='hour'||u==='minute'||u==='min'||u==='second'||u==='sec'){
        var ms=0;
        if(u==='hour')ms=n*3600000;
        else if(u==='minute'||u==='min')ms=n*60000;
        else ms=n*1000;
        result=new Date(Date.now()+Math.round(ms));
        result.__dpTime={h:result.getHours(),m:result.getMinutes()};
      }else{
        result=new Date(today);
        if(u==='day')result.setDate(result.getDate()+Math.round(n));
        else if(u==='week')result.setDate(result.getDate()+Math.round(n*7));
        else if(u==='fortnight')result.setDate(result.getDate()+Math.round(n*14));
        else if(u==='month')result.setMonth(result.getMonth()+Math.round(n));
        else if(u==='year')result.setFullYear(result.getFullYear()+Math.round(n));
      }
    }
  }

  /* 2. Named days */
  if(!result){
    var dayMatch=s.match(/(?:^|\s)(?:next\s+|this\s+)?(\w+)$/);
    if(dayMatch){
      var dn=DAYS[dayMatch[1]];
      if(dn!==undefined){
        result=new Date(today);
        var diff=(dn-result.getDay()+7)%7;
        if(diff===0)diff=7;
        result.setDate(result.getDate()+diff);
      }
    }
  }

  /* 3. Holidays */
  if(!result){
    result=parseHoliday(s);
  }

  /* 4. Date formats */
  if(!result){
    result=parseDateFormats(s);
  }

  return result;
}

function parseDuration(s){
  /* Pure h/m/s duration (now-relative). Bails if no h/m/s units present;
     day/week/month/year/fortnight all route through tryMatch (today-relative). */
  if(!/\d/.test(s))return null;
  if(!/(?:^|[^a-z])(\d+(?:\.\d+)?\s*(?:h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?))\b/i.test(s))return null;
  var totalSec=0,found=false;
  s.replace(/(\d+(?:\.\d+)?)\s*(h|hr|hrs|hours?|m|min|mins|minutes?|s|sec|secs|seconds?)\b/gi,function(_,n,u){
    var v=parseFloat(n);
    u=u.toLowerCase();
    if(u==='h'||u==='hr'||u==='hrs'||u==='hour'||u==='hours'){totalSec+=v*3600;found=true;}
    else if(u==='m'||u==='min'||u==='mins'||u==='minute'||u==='minutes'){totalSec+=v*60;found=true;}
    else if(u==='s'||u==='sec'||u==='secs'||u==='second'||u==='seconds'){totalSec+=v;found=true;}
    return '';
  });
  if(!found)return null;
  var dt=new Date(Date.now()+Math.round(totalSec*1000));
  return{date:dt,label:formatLabel(dt)};
}

function parseDate(text){
  if(!text||!text.trim())return null;
  var raw=text.trim();

  /* 1. Pure duration on raw input (h/m/s only) */
  var dur=parseDuration(raw);
  if(dur){dur.hint=null;return dur}

  /* 2. Normalize, strip incidental punctuation, autoCorrect typos,
        rewrite decimal-hour notation (5.5pm → 5:30pm) so parseTime/findTimeMid
        can pick it up via existing colon patterns. */
  var prepared=expandDecimalTime(autoCorrect(stripPunct(normalize(raw))));

  /* 3. Retry duration on prepared text (catches typos like "0.5 howr") */
  var dur2=parseDuration(prepared);
  if(dur2){dur2.hint=null;return dur2}

  /* 4. Time extraction: anchor-based fast path, then mid-prose fallback */
  var time=parseTime(prepared);
  var s;
  if(time){
    s=stripTime(prepared).toLowerCase();
  }else{
    var mid=findTimeMid(prepared);
    if(mid){
      time=mid;
      s=(prepared.slice(0,mid.span[0])+' '+prepared.slice(mid.span[1])).replace(/\s+/g,' ').trim().toLowerCase();
    }else{
      s=prepared.toLowerCase();
    }
  }

  if(!s&&time){
    var td=new Date();
    td.setHours(time.h,time.m,0,0);
    if(td<=new Date())td.setDate(td.getDate()+1);
    return{date:td,label:formatLabel(td),hint:'date'};
  }
  if(!s)s=prepared.toLowerCase();
  var now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());

  var result=tryMatch(s,now,today);
  if(!result){
    var cleaned=stripNoise(s);
    if(cleaned&&cleaned!==s)result=tryMatch(cleaned,now,today);
  }
  if(!result){
    var words=s.split(/\s+/);
    /* Drop from start: "8am next monday" → "next monday" → "monday" */
    for(var i=1;i<words.length&&!result;i++){
      var sub=words.slice(i).join(' ');
      result=tryMatch(sub,now,today);
      if(!result){
        var subClean=stripNoise(sub);
        if(subClean&&subClean!==sub)result=tryMatch(subClean,now,today);
      }
    }
    /* Drop from end: "next monday call" → "next monday" → "next" */
    for(var j=words.length-1;j>=1&&!result;j--){
      var sub2=words.slice(0,j).join(' ');
      result=tryMatch(sub2,now,today);
      if(!result){
        var sub2Clean=stripNoise(sub2);
        if(sub2Clean&&sub2Clean!==sub2)result=tryMatch(sub2Clean,now,today);
      }
    }
  }

  if(!result)return null;

  /* 5. Time application: ISO-with-time keeps its own; else explicit > implicit > none */
  var hasIsoTime=result.__dpIsoTime;
  var implicitTime=result.__dpTime;
  try{delete result.__dpIsoTime;}catch(e){}
  try{delete result.__dpTime;}catch(e){}

  if(hasIsoTime){
    /* leave time as-is */
  }else if(time){
    applyTime(result,time);
  }else if(implicitTime){
    applyTime(result,implicitTime);
  }else{
    applyTime(result,null);
  }

  return{date:result,label:formatLabel(result),hint:(time||implicitTime||hasIsoTime)?null:'time'};
}

function parseHoliday(s){
  var fixed=[
    [/^(?:ny|new\s*year(?:'?s)?(?:\s*day)?|nyd)$/,0,1,'New Year\'s Day'],
    [/^(?:nye|new\s*year(?:'?s)?\s*eve)$/,11,31,'New Year\'s Eve'],
    [/^(?:valentine(?:'?s)?(?:\s*day)?|v-?day)$/,1,14,'Valentine\'s Day'],
    [/^(?:st\s*patrick(?:'?s)?(?:\s*day)?|paddy(?:'?s)?(?:\s*day)?|st\s*paddy(?:'?s)?(?:\s*day)?)$/,2,17,'St Patrick\'s Day'],
    [/^(?:april\s*fool(?:'?s)?(?:\s*day)?)$/,3,1,'April Fools'],
    [/^(?:may\s*the\s*4th|star\s*wars(?:\s*day)?)$/,4,4,'Star Wars Day'],
    [/^(?:4th\s*of\s*july|july\s*4th|independence\s*day)$/,6,4,'Independence Day'],
    [/^(?:bastille(?:\s*day)?)$/,6,14,'Bastille Day'],
    [/^(?:halloween|hallows?\s*eve)$/,9,31,'Halloween'],
    [/^(?:bonfire\s*night|guy\s*fawkes(?:\s*day)?|5th\s*of\s*november)$/,10,5,'Bonfire Night'],
    [/^(?:veterans?\s*day|armistice\s*day|remembrance\s*day)$/,10,11,'Remembrance Day'],
    [/^(?:christmas\s*eve|xmas\s*eve)$/,11,24,'Christmas Eve'],
    [/^(?:christmas(?:\s*day)?|xmas|x-mas)$/,11,25,'Christmas'],
    [/^(?:boxing\s*day)$/,11,26,'Boxing Day'],
    [/^(?:burns(?:\s*night|supper)?)$/,0,25,'Burns Night'],
    [/^(?:australia\s*day)$/,0,26,'Australia Day'],
    [/^(?:groundhog\s*day|groundhog)$/,1,2,'Groundhog Day']
  ];
  for(var i=0;i<fixed.length;i++){
    if(fixed[i][0].test(s))return nextOccurrence(fixed[i][1],fixed[i][2]);
  }

  var nth=[
    [/^(?:mlk(?:\s*day)?|martin\s*luther\s*king(?:\s*(?:jr\.?)?(?:\s*day)?)?)$/,0,1,3],
    [/^(?:presidents?\s*day)$/,1,1,3],
    [/^(?:mother(?:'?s)?\s*day)$/,4,0,2],
    [/^(?:father(?:'?s)?\s*day)$/,5,0,3],
    [/^(?:labor\s*day|labour\s*day)$/,8,1,1],
    [/^(?:columbus\s*day|indigenous\s*peoples?\s*day)$/,9,1,2],
    [/^(?:thanksgiving|turkey\s*day)$/,10,4,4],
    [/^(?:early\s*may\s*bank\s*holiday|may\s*day)$/,4,1,1]
  ];
  for(var i=0;i<nth.length;i++){
    if(nth[i][0].test(s))return nextNthWeekday(nth[i][1],nth[i][2],nth[i][3]);
  }

  if(/^(?:memorial\s*day)$/.test(s))return nextLastWeekday(4,1);
  if(/^(?:spring\s*bank\s*holiday)$/.test(s))return nextLastWeekday(4,1);
  if(/^(?:summer\s*bank\s*holiday|august\s*bank\s*holiday)$/.test(s))return nextLastWeekday(7,1);

  if(/^(?:easter(?:\s*sunday)?)$/.test(s))return nextPrecomputed(EASTER,0);
  if(/^(?:good\s*friday)$/.test(s))return nextPrecomputed(EASTER,-2);
  if(/^(?:easter\s*monday)$/.test(s))return nextPrecomputed(EASTER,1);

  if(/^(?:chinese\s*new\s*year|lunar\s*new\s*year|cny)$/.test(s))return nextPrecomputed(CNY,0);

  return null;
}

function parseDateFormats(s){
  var now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var m,day,mon,year,dt;

  /* ISO with time: 2026-01-15T14:30, 2026-01-15 14:30, ...:00Z, ...+00:00 */
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[t\s](\d{1,2}):(\d{2})(?::(\d{2}))?(z|[+-]\d{2}:?\d{2})?$/);
  if(m){
    var y=parseInt(m[1],10),mo=parseInt(m[2],10)-1,d=parseInt(m[3],10);
    var h=parseInt(m[4],10),mi=parseInt(m[5],10),sec=m[6]?parseInt(m[6],10):0;
    var tz=m[7];
    if(mo>=0&&mo<=11&&d>=1&&d<=daysInMonth(y,mo)&&h<=23&&mi<=59&&sec<=59){
      var dtIso;
      if(tz==='z'){
        dtIso=new Date(Date.UTC(y,mo,d,h,mi,sec));
      }else if(tz){
        var sign=tz.charAt(0)==='+'?1:-1;
        var tzCl=tz.replace(':','');
        var tzH=parseInt(tzCl.substr(1,2),10);
        var tzM=parseInt(tzCl.substr(3,2),10);
        var off=sign*(tzH*60+tzM);
        dtIso=new Date(Date.UTC(y,mo,d,h,mi,sec)-off*60000);
      }else{
        dtIso=new Date(y,mo,d,h,mi,sec);
      }
      dtIso.__dpIsoTime=true;
      return dtIso;
    }
  }

  m=s.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+([a-z]+)(?:\s+(\d{4}))?$/);
  if(m){
    day=parseInt(m[1],10);mon=MONTHS[m[2]];year=m[3]?parseInt(m[3],10):null;
    if(mon!==undefined&&day>=1&&day<=31){
      if(!year){
        dt=new Date(now.getFullYear(),mon,day);
        if(dt<today)dt.setFullYear(dt.getFullYear()+1);
      }else{dt=new Date(year,mon,day)}
      if(day<=daysInMonth(dt.getFullYear(),dt.getMonth()))return dt;
    }
  }

  m=s.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s+(\d{4}))?$/);
  if(m){
    mon=MONTHS[m[1]];day=parseInt(m[2],10);year=m[3]?parseInt(m[3],10):null;
    if(mon!==undefined&&day>=1&&day<=31){
      if(!year){
        dt=new Date(now.getFullYear(),mon,day);
        if(dt<today)dt.setFullYear(dt.getFullYear()+1);
      }else{dt=new Date(year,mon,day)}
      if(day<=daysInMonth(dt.getFullYear(),dt.getMonth()))return dt;
    }
  }

  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m){
    year=parseInt(m[1],10);mon=parseInt(m[2],10)-1;day=parseInt(m[3],10);
    if(mon>=0&&mon<=11&&day>=1&&day<=daysInMonth(year,mon))return new Date(year,mon,day);
  }

  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){
    var a=parseInt(m[1],10),b=parseInt(m[2],10);year=parseInt(m[3],10);
    if(a>12){day=a;mon=b-1}
    else if(b>12){day=b;mon=a-1}
    else{day=a;mon=b-1}
    if(mon>=0&&mon<=11&&day>=1&&day<=daysInMonth(year,mon))return new Date(year,mon,day);
  }

  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if(m){
    day=parseInt(m[1],10);mon=parseInt(m[2],10)-1;
    if(m[1]>12){day=parseInt(m[1],10);mon=parseInt(m[2],10)-1}
    else if(m[2]>12){mon=parseInt(m[1],10)-1;day=parseInt(m[2],10)}
    if(mon>=0&&mon<=11&&day>=1&&day<=31){
      dt=new Date(now.getFullYear(),mon,day);
      if(dt<today)dt.setFullYear(dt.getFullYear()+1);
      if(day<=daysInMonth(dt.getFullYear(),dt.getMonth()))return dt;
    }
  }

  return null;
}

function splitTitleDate(text){
  /* Delim splits first so a title doesn't get swallowed when the parser's
     word-shrink fallback can find the date inside the full string. */
  var delims=[/\s*—\s*/,/\s*–\s*/,/\s*\|\s*/,/\s+[-]\s+/];
  for(var di=0;di<delims.length;di++){
    var parts=text.split(delims[di]);
    if(parts.length===2){
      var p=parseDate(parts[1].trim());
      if(p&&!parseDate(parts[0].trim()))return{title:parts[0].trim(),date:parts[1].trim(),parsed:p};
      p=parseDate(parts[0].trim());
      if(p&&!parseDate(parts[1].trim()))return{title:parts[1].trim(),date:parts[0].trim(),parsed:p};
    }
  }

  var full=parseDate(text);
  if(full)return{title:null,date:text,parsed:full};

  var words=text.split(/\s+/);
  var bestRight=null,bestRightIdx=-1;
  for(var i=1;i<words.length;i++){
    var right=words.slice(i).join(' ');
    var p=parseDate(right);
    if(p){bestRight=p;bestRightIdx=i;break}
  }
  var bestLeft=null,bestLeftIdx=-1;
  for(var i=words.length-1;i>=1;i--){
    var left=words.slice(0,i).join(' ');
    var p=parseDate(left);
    if(p){bestLeft=p;bestLeftIdx=i;break}
  }
  if(bestRight&&bestRightIdx>0){
    var titlePart=words.slice(0,bestRightIdx).join(' ');
    if(!parseDate(titlePart)&&!parseTime(titlePart))
      return{title:titlePart,date:words.slice(bestRightIdx).join(' '),parsed:bestRight};
  }
  if(bestLeft&&bestLeftIdx<words.length){
    var titlePart=words.slice(bestLeftIdx).join(' ');
    if(!parseDate(titlePart)&&!parseTime(titlePart))
      return{title:titlePart,date:words.slice(0,bestLeftIdx).join(' '),parsed:bestLeft};
  }
  if(bestRight)return{title:null,date:text,parsed:bestRight};
  if(bestLeft)return{title:null,date:text,parsed:bestLeft};
  return null;
}

/* Extract first parseable date from arbitrary prose. Pre-passes a global
   mid-prose time so a chunk like "tomorrow" can pick up "5:30 PM" elsewhere
   in the same paragraph. */
function extractDate(text){
  if(!text||!text.trim())return null;
  var p=parseDate(text);
  if(p)return p;

  var preparedFull=expandDecimalTime(autoCorrect(stripPunct(normalize(text))));
  var midTime=findTimeMid(preparedFull);
  var workingText=text;
  if(midTime){
    workingText=text.replace(midTime.raw,' ').replace(/\s+/g,' ');
  }

  var chunks=workingText.split(/[\n.?!,;–—|()<>{}\[\]"]+/);
  for(var i=0;i<chunks.length;i++){
    var c=chunks[i].trim().replace(/^[^\w]+|[^\w]+$/g,'').trim();
    if(!c)continue;
    var pp=parseDate(c);
    if(pp){
      if(midTime&&pp.hint==='time'){
        pp.date.setHours(midTime.h,midTime.m,0,0);
        pp.label=formatLabel(pp.date);
        pp.hint=null;
      }
      return pp;
    }
    if(c.indexOf(' ')!==-1){
      var ss=splitTitleDate(c);
      if(ss){
        if(midTime&&ss.parsed.hint==='time'){
          ss.parsed.date.setHours(midTime.h,midTime.m,0,0);
          ss.parsed.label=formatLabel(ss.parsed.date);
          ss.parsed.hint=null;
        }
        return ss.parsed;
      }
    }
  }
  return null;
}

var _dpExports={parseDate:parseDate,parseTime:parseTime,parseDuration:parseDuration,splitTitleDate:splitTitleDate,extractDate:extractDate,formatLabel:formatLabel,fmtTime12:fmtTime12,MONTH_NAMES:MONTH_NAMES,MONTHS:MONTHS,DAYS:DAYS,normalize:normalize,autoCorrect:autoCorrect};
if(typeof window!=='undefined')window._dp=_dpExports;
if(typeof globalThis!=='undefined')globalThis._dp=_dpExports;
})();
