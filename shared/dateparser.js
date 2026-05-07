(function(){
'use strict';

/* Date Parser - lifted verbatim from countdown/index.html */
var MONTHS={jan:0,january:0,feb:1,february:1,mar:2,march:2,apr:3,april:3,may:4,jun:5,june:5,jul:6,july:6,aug:7,august:7,sep:8,sept:8,september:8,oct:9,october:9,nov:10,november:10,dec:11,december:11};
var MONTH_NAMES=['January','February','March','April','May','June','July','August','September','October','November','December'];
var DAYS={sun:0,sunday:0,mon:1,monday:1,tue:2,tuesday:2,wed:3,wednesday:3,thu:4,thursday:4,fri:5,friday:5,sat:6,saturday:6};

var EASTER={2025:[3,20],2026:[4,5],2027:[3,28],2028:[4,16],2029:[4,1],2030:[4,21],2031:[4,13],2032:[3,28],2033:[4,17],2034:[4,9],2035:[3,25],2036:[4,13],2037:[4,5],2038:[4,25],2039:[4,10],2040:[4,1]};
var CNY={2025:[1,29],2026:[2,17],2027:[2,6],2028:[1,26],2029:[2,13],2030:[2,3],2031:[1,23],2032:[2,11],2033:[1,31],2034:[2,19],2035:[2,8],2036:[1,28],2037:[2,15],2038:[2,4],2039:[1,24],2040:[2,12]};

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

  // noon / midday / midnight - anywhere in string
  if(/\bnoon\b/i.test(t)||/\bmidday\b/i.test(t))return{h:12,m:0,raw:t.match(/\b(?:noon|midday)\b/i)[0]};
  if(/\bmidnight\b/i.test(t))return{h:0,m:0,raw:t.match(/\bmidnight\b/i)[0]};

  // half past X, half X to X:30
  m=t.match(/\bhalf\s+past\s+(\d{1,2})\b/i)||t.match(/\bhalf\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:30,raw:m[0]}}

  // quarter past X to X:15
  m=t.match(/\bquarter\s+past\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:15,raw:m[0]}}

  // quarter to X
  m=t.match(/\bquarter\s+to\s+(\d{1,2})\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:(h===1?12:h-1),m:45,raw:m[0]}}

  // X o'clock / X oclock
  m=t.match(/\b(\d{1,2})\s*o['']?clock\b/i);
  if(m){h=parseInt(m[1],10);if(h>=1&&h<=12)return{h:h,m:0,raw:m[0]}}

  // Space-separated: H MM am/pm (10 25 am, 10 25a)
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

  // Standard: Xam/Xpm/Xa/Xp with optional minutes - try end then start
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

  // Compact: 3-4 digits with am/pm (boundaries + standalone)
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

  // Compact: 3-4 digits without am/pm (boundary h<=12, standalone any)
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

  // Bare hour: 1-2 digits without am/pm (standalone only)
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
  // Strip word-based time expressions
  s=s.replace(/\b(?:noon|midday|midnight)\b/gi,'');
  s=s.replace(/\bhalf\s+past\s+\d{1,2}\b/gi,'');
  s=s.replace(/\bhalf\s+\d{1,2}\b/gi,'');
  s=s.replace(/\bquarter\s+(?:past|to)\s+\d{1,2}\b/gi,'');
  s=s.replace(/\b\d{1,2}\s*o['']?clock\b/gi,'');
  // Strip space-separated time (H MM am/pm) from end/start
  s=s.replace(/[\s,]+\d{1,2}\s+\d{2}\s*(?:am?|pm?)\s*$/i,'');
  s=s.replace(/^\d{1,2}\s+\d{2}\s*(?:am?|pm?)[\s,]+/i,'');
  // Strip standard time from end
  s=s.replace(/[\s,]+(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)\s*$/i,'').replace(/[\s,]+(\d{1,2}):(\d{2})\s*$/i,'');
  // Strip standard time from start
  s=s.replace(/^(\d{1,2})(?::(\d{2}))?\s*(am?|pm?)[\s,]+/i,'').replace(/^(\d{1,2}):(\d{2})[\s,]+/i,'');
  // Strip standalone compact time or bare hour (before boundary to avoid partial strips)
  s=s.replace(/^\d{3,4}\s*(?:am?|pm?)?\s*$/i,'');
  s=s.replace(/^\d{1,2}$/,'');
  // Strip compact time (3-4 digits + am/pm) from end/start
  s=s.replace(/[\s,]+\d{3,4}\s*(?:am?|pm?)\s*$/i,'');
  s=s.replace(/^\d{3,4}\s*(?:am?|pm?)[\s,]+/i,'');
  // Strip compact time without am/pm at boundary (h<=12 only, avoids stripping years)
  s=s.replace(/[\s,]+(\d{3,4})\s*$/,function(_,dg){var h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);return h<=12?'':_});
  s=s.replace(/^(\d{3,4})([\s,]+)/,function(_,dg){var h=parseInt(dg.length===3?dg[0]:dg.slice(0,2),10);return h<=12?'':_});
  // Strip connecting words left behind (at, for, etc.)
  s=s.replace(/\s+at\s*$/i,'').replace(/^\s*at\s+/i,'');
  return s.trim();
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
  // Remove common noise words/prepositions to expose the date pattern
  // Strip "at" separately since it's also handled in stripTime
  return s.replace(/\b(?:on|at|the|for|by|until|from|to|my|our|with|and|is|a|an)\b/gi,' ').replace(/\s{2,}/g,' ').trim();
}

function tryMatch(s,now,today){
  var result=null;

  /* 1. Relative keywords */
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
  if(!result){
    var rm=s.match(/(?:^|\s)in\s+(\d+)\s+(day|days|week|weeks|month|months|year|years)(?:\s|$)/);
    if(rm){
      var n=parseInt(rm[1],10),u=rm[2].replace(/s$/,'');
      result=new Date(today);
      if(u==='day')result.setDate(result.getDate()+n);
      else if(u==='week')result.setDate(result.getDate()+n*7);
      else if(u==='month')result.setMonth(result.getMonth()+n);
      else if(u==='year')result.setFullYear(result.getFullYear()+n);
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
  var totalSec=0,found=false;
  var r=/(\d+(?:\.\d+)?)\s*(?:(h|hr|hrs|hours?)|(m|min|mins|minutes?)|(s|sec|secs|seconds?))\b/gi;
  var m;
  while((m=r.exec(s))!==null){
    var v=parseFloat(m[1]);
    if(m[2]){totalSec+=v*3600;found=true}
    else if(m[3]){totalSec+=v*60;found=true}
    else if(m[4]){totalSec+=v;found=true}
  }
  if(!found)return null;
  var dt=new Date(Date.now()+Math.round(totalSec*1000));
  return{date:dt,label:formatLabel(dt)};
}

function parseDate(text){
  if(!text||!text.trim())return null;
  var raw=text.trim();

  var dur=parseDuration(raw);
  if(dur){dur.hint=null;return dur}

  var time=parseTime(raw);
  var s=stripTime(raw).toLowerCase();
  if(!s&&time){
    // Time only - use today (or tomorrow if time already passed)
    var td=new Date();
    td.setHours(time.h,time.m,0,0);
    if(td<=new Date())td.setDate(td.getDate()+1);
    return{date:td,label:formatLabel(td),hint:'date'};
  }
  if(!s)s=raw.toLowerCase();
  var now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());

  var result=tryMatch(s,now,today);
  if(!result){
    var cleaned=stripNoise(s);
    if(cleaned&&cleaned!==s)result=tryMatch(cleaned,now,today);
  }
  if(!result){
    var words=s.split(/\s+/);
    for(var i=1;i<words.length&&!result;i++){
      var sub=words.slice(i).join(' ');
      result=tryMatch(sub,now,today);
      if(!result){
        var subClean=stripNoise(sub);
        if(subClean&&subClean!==sub)result=tryMatch(subClean,now,today);
      }
    }
  }

  if(!result)return null;

  applyTime(result,time);
  return{date:result,label:formatLabel(result),hint:time?null:'time'};
}

function parseHoliday(s){
  // Fixed-date holidays
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

  // Nth-weekday holidays
  var nth=[
    [/^(?:mlk(?:\s*day)?|martin\s*luther\s*king(?:\s*(?:jr\.?)?(?:\s*day)?)?)$/,0,1,3],  // 3rd Mon Jan
    [/^(?:presidents?\s*day)$/,1,1,3],  // 3rd Mon Feb
    [/^(?:mother(?:'?s)?\s*day)$/,4,0,2],  // 2nd Sun May
    [/^(?:father(?:'?s)?\s*day)$/,5,0,3],  // 3rd Sun Jun
    [/^(?:labor\s*day|labour\s*day)$/,8,1,1],  // 1st Mon Sep
    [/^(?:columbus\s*day|indigenous\s*peoples?\s*day)$/,9,1,2],  // 2nd Mon Oct
    [/^(?:thanksgiving|turkey\s*day)$/,10,4,4],  // 4th Thu Nov
    [/^(?:early\s*may\s*bank\s*holiday|may\s*day)$/,4,1,1],  // 1st Mon May
  ];
  for(var i=0;i<nth.length;i++){
    if(nth[i][0].test(s))return nextNthWeekday(nth[i][1],nth[i][2],nth[i][3]);
  }

  // Last-weekday holidays
  if(/^(?:memorial\s*day)$/.test(s))return nextLastWeekday(4,1);
  if(/^(?:spring\s*bank\s*holiday)$/.test(s))return nextLastWeekday(4,1);
  if(/^(?:summer\s*bank\s*holiday|august\s*bank\s*holiday)$/.test(s))return nextLastWeekday(7,1);

  // Easter-based
  if(/^(?:easter(?:\s*sunday)?)$/.test(s))return nextPrecomputed(EASTER,0);
  if(/^(?:good\s*friday)$/.test(s))return nextPrecomputed(EASTER,-2);
  if(/^(?:easter\s*monday)$/.test(s))return nextPrecomputed(EASTER,1);

  // Chinese New Year
  if(/^(?:chinese\s*new\s*year|lunar\s*new\s*year|cny)$/.test(s))return nextPrecomputed(CNY,0);

  return null;
}

function parseDateFormats(s){
  var now=new Date(),today=new Date(now.getFullYear(),now.getMonth(),now.getDate());
  var m,day,mon,year,dt;

  // DA: 25 December 2025, 25th Dec, 1st Jan 2026
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

  // DB: December 25 2025, Dec 25, June 5
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

  // DC: 2025-12-25
  m=s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if(m){
    year=parseInt(m[1],10);mon=parseInt(m[2],10)-1;day=parseInt(m[3],10);
    if(mon>=0&&mon<=11&&day>=1&&day<=daysInMonth(year,mon))return new Date(year,mon,day);
  }

  // DC: 25/12/2025 (UK day/month/year)
  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if(m){
    var a=parseInt(m[1],10),b=parseInt(m[2],10);year=parseInt(m[3],10);
    // If first > 12, must be day
    if(a>12){day=a;mon=b-1}
    else if(b>12){day=b;mon=a-1}
    else{day=a;mon=b-1}  // UK-first: day/month
    if(mon>=0&&mon<=11&&day>=1&&day<=daysInMonth(year,mon))return new Date(year,mon,day);
  }

  // DD: 15/03 (day/month, UK-first)
  m=s.match(/^(\d{1,2})[\/\-](\d{1,2})$/);
  if(m){
    day=parseInt(m[1],10);mon=parseInt(m[2],10)-1;
    // If first number > 12, it's definitely day. If second > 12, swap.
    if(m[1]>12){day=parseInt(m[1],10);mon=parseInt(m[2],10)-1}
    else if(m[2]>12){mon=parseInt(m[1],10)-1;day=parseInt(m[2],10)}
    // else UK-first: day/month (already set)
    if(mon>=0&&mon<=11&&day>=1&&day<=31){
      dt=new Date(now.getFullYear(),mon,day);
      if(dt<today)dt.setFullYear(dt.getFullYear()+1);
      if(day<=daysInMonth(dt.getFullYear(),dt.getMonth()))return dt;
    }
  }

  return null;
}

/* Smart Split (title + date from one string) */
function splitTitleDate(text){
  // Whole string is a date?
  var full=parseDate(text);
  if(full)return{title:null,date:text,parsed:full};

  // Try splitting on em dash, en dash, pipe, or spaced hyphen first
  var delims=[/\s*—\s*/,/\s*–\s*/,/\s*\|\s*/,/\s+[-]\s+/];
  for(var di=0;di<delims.length;di++){
    var parts=text.split(delims[di]);
    if(parts.length===2){
      // Try right as date
      var p=parseDate(parts[1].trim());
      if(p&&!parseDate(parts[0].trim()))return{title:parts[0].trim(),date:parts[1].trim(),parsed:p};
      // Try left as date
      p=parseDate(parts[0].trim());
      if(p&&!parseDate(parts[1].trim()))return{title:parts[1].trim(),date:parts[0].trim(),parsed:p};
    }
  }

  // Word-by-word splitting
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

window._dp={parseDate:parseDate,parseTime:parseTime,parseDuration:parseDuration,splitTitleDate:splitTitleDate,formatLabel:formatLabel,fmtTime12:fmtTime12,MONTH_NAMES:MONTH_NAMES,MONTHS:MONTHS,DAYS:DAYS};
})();
