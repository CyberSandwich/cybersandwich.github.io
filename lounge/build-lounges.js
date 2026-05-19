#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'tasks', 'loungekey-lounges.md');
const OUT = path.join(__dirname, 'lounges.json');
const COUNTRY_BY_CODE = JSON.parse(fs.readFileSync(path.join(__dirname, 'country-by-code.json'), 'utf8'));

const CONTINENT_ORDER = [
  'North America',
  'Central America',
  'South America',
  'Europe',
  'Asia',
  'Africa',
  'Oceania'
];

// Icon keys map to entries in LOUNGE_ICONS in lounge/index.html (Lucide icons sourced from /iconic/icons).
const LANDMARK_BY_CODE = {
  LHR: 'ferrisWheel', LGW: 'ferrisWheel', LCY: 'ferrisWheel', STN: 'ferrisWheel',
  JFK: 'landmark', EWR: 'landmark', LGA: 'landmark',
  CDG: 'landmark', ORY: 'landmark',
  HND: 'mountainSnow', NRT: 'mountainSnow', KIX: 'mountainSnow',
  SYD: 'sailboat',
  DXB: 'building2',
  SIN: 'waves',
  FCO: 'landmark', CIA: 'landmark',
  AMS: 'leaf',
  IST: 'gem', SAW: 'gem',
  GIG: 'mountain', SDU: 'mountain',
  YYZ: 'radioTower', YTZ: 'radioTower',
  SFO: 'landmark',
  LAX: 'treePalm', BUR: 'treePalm', SNA: 'treePalm',
  ATH: 'landmark',
  BCN: 'church',
  MAD: 'landmark',
  ATL: 'sparkles',
  HKG: 'sailboat',
  BKK: 'church', DMK: 'church',
  KUL: 'building2',
  DOH: 'gem',
  JNB: 'trees',
  CPT: 'mountain',
  GVA: 'mountainSnow',
  ZRH: 'mountainSnow',
  CPH: 'treePine',
  OSL: 'mountainSnow',
  ARN: 'treePine',
  HEL: 'snowflake',
  YVR: 'mountainSnow',
  YYC: 'mountainSnow',
  YUL: 'treeDeciduous', YOW: 'treeDeciduous',
  MEX: 'landmark', CUN: 'treePalm', MID: 'landmark',
  LIM: 'mountainSnow', CUZ: 'mountainSnow',
  EZE: 'sparkles', AEP: 'sparkles',
  AUH: 'crown',
  GRU: 'treePalm', VCP: 'treePalm', BSB: 'treePalm',
  PEK: 'landmark', PVG: 'landmark', PKX: 'landmark',
  FRA: 'castle', MUC: 'castle',
  VIE: 'landmark',
  PRG: 'castle',
  BUD: 'landmark',
  WAW: 'landmark',
  DUB: 'leaf',
  EDI: 'castle',
  LIS: 'tramFront',
  REK: 'mountainSnow', KEF: 'mountainSnow',
  CAI: 'landmark',
  NBO: 'tentTree',
  ICN: 'moonStar', GMP: 'moonStar',
  TPE: 'moonStar',
  MNL: 'landmark',
  DEL: 'landmark', BOM: 'landmark', AGR: 'landmark',
  AKL: 'bird',
  HAV: 'treePalm',
  NAS: 'treePalm', PUJ: 'treePalm', MBJ: 'treePalm',
  BRU: 'landmark',
  LIS_BACKUP: 'tramFront'
};

function heuristicIcon(city, continent, airport) {
  const c = city.toLowerCase();
  const a = airport.toLowerCase();
  const both = c + ' ' + a;
  if (/beach|bay|island|caribbean|maldives|fiji|bahamas|seychelles|mauritius|aruba|barbados|cayman|tahiti|moorea|tobago/.test(both)) return 'treePalm';
  if (continent === 'Oceania') return 'waves';
  if (continent === 'Africa') return 'tentTree';
  if (continent === 'South America') return 'treePalm';
  if (continent === 'Central America') return 'treePalm';
  if (/iceland|reyk|tromso|murmansk|anchorage|fairbanks/.test(c)) return 'snowflake';
  if (/zurich|geneva|innsbruck|bern|basel|salzburg|bolzano/.test(c)) return 'mountainSnow';
  if (/oslo|bergen|stavanger|tromso/.test(c)) return 'mountainSnow';
  if (/copenhagen|stockholm|helsinki|gothen|malmo|aarhus|tallinn|riga|vilnius/.test(c)) return 'treePine';
  if (continent === 'Europe') return 'castle';
  if (/dubai|abu dhabi|doha|riyadh|jeddah|kuwait|muscat|bahrain|manama/.test(c)) return 'gem';
  if (/bangkok|phuket|chiang|saigon|hanoi|ho chi|hochiminh|jakarta|bali|denpasar|colombo/.test(c)) return 'church';
  if (/delhi|mumbai|bangalore|chennai|kolkata|hyderabad|cochin|ahmedabad|karachi|lahore/.test(c)) return 'landmark';
  if (/beijing|shanghai|guangzhou|chengdu|wuhan|hangzhou|tianjin|chongqing|xian|shenzhen/.test(c)) return 'landmark';
  if (/tokyo|osaka|nagoya|fukuoka|sapporo|kyoto/.test(c)) return 'mountainSnow';
  if (/seoul|busan|jeju|incheon/.test(c)) return 'moonStar';
  if (continent === 'Asia') return 'church';
  if (continent === 'North America') return 'building2';
  return 'plane';
}

// Replace em/en dashes with a colon, normalize whitespace.
function cleanDashes(s) {
  return s
    .replace(/\s*[–—]\s*/g, ': ')
    .replace(/\s+/g, ' ')
    .trim();
}

const md = fs.readFileSync(SRC, 'utf8');
const lines = md.split(/\r?\n/);

const lounges = [];
let currentContinent = null;

const TABLE_ROW = /^\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*$/;
const AIRPORT_CODE = /^(.*?)\s*\(([A-Z0-9]{3,4})\)\s*$/;

for (const raw of lines) {
  const line = raw.trim();
  if (line.startsWith('## ')) {
    currentContinent = line.slice(3).trim();
    continue;
  }
  if (!currentContinent) continue;
  if (!line.startsWith('|')) continue;
  if (/^\|\s*-{2,}/.test(line)) continue;
  const m = line.match(TABLE_ROW);
  if (!m) continue;
  const city = m[1].trim();
  const airportCell = m[2].trim();
  const nameRaw = m[3].trim();
  if (!city || !airportCell || !nameRaw) continue;
  if (city.toLowerCase() === 'city') continue;

  let airport = airportCell;
  let airportCode = '';
  const am = airportCell.match(AIRPORT_CODE);
  if (am) {
    airport = am[1].trim();
    airportCode = am[2].trim();
  }
  if (!airportCode) continue;

  const name = cleanDashes(nameRaw);
  airport = cleanDashes(airport);
  const cleanCity = cleanDashes(city);

  const icon = LANDMARK_BY_CODE[airportCode] || heuristicIcon(cleanCity, currentContinent, airport);
  const country = COUNTRY_BY_CODE[airportCode] || '';

  lounges.push({
    name,
    airport,
    airportCode,
    city: cleanCity,
    country,
    continent: currentContinent,
    icon
  });
}

const continentIdx = c => {
  const i = CONTINENT_ORDER.indexOf(c);
  return i < 0 ? 99 : i;
};

lounges.sort((a, b) => {
  const ci = continentIdx(a.continent) - continentIdx(b.continent);
  if (ci) return ci;
  const countryCmp = (a.country || 'ZZZ').localeCompare(b.country || 'ZZZ');
  if (countryCmp) return countryCmp;
  const cityCmp = a.city.localeCompare(b.city);
  if (cityCmp) return cityCmp;
  const airportCmp = a.airport.localeCompare(b.airport);
  if (airportCmp) return airportCmp;
  return a.name.localeCompare(b.name);
});

fs.writeFileSync(OUT, JSON.stringify(lounges, null, 2) + '\n');

const continents = [...new Set(lounges.map(l => l.continent))];
console.log('Wrote ' + lounges.length + ' lounges to ' + OUT);
console.log('Continents: ' + continents.join(', '));
console.log('Unique airports: ' + new Set(lounges.map(l => l.airportCode)).size);
console.log('Unique cities: ' + new Set(lounges.map(l => l.continent + '|' + l.city)).size);
const missing = [...new Set(lounges.filter(l => !l.country).map(l => l.airportCode))];
if (missing.length) console.log('Missing country for ' + missing.length + ' codes: ' + missing.join(', '));
