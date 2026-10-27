/**
 * Pure front-end rules: no DOM, no three.js, so node tests cover them (tests/test-roundabout-ui.js).
 *
 *   COPY                              every HUD string in one table
 *   signalLabel(indicator)            'Signalling Left' | 'Signalling Right' | 'No Signal'
 *   hcLink(ref)                       'HC 185' / 'DL25 ...' -> { text, href } or null
 *   parseHash(hash) / hashOf(opts)    #seed=&cars=&tier=&traffic=&tips=&drill=&debug= <-> settings
 *   resolveSettings(stored, hash)     the session's settings (hash wins, bad values fall back, seeds drawn)
 *   nextTrafficSeed(current, ctx)     same traffic on Retry after red and on Guided/Watch, fresh after clean
 *   cleanSeed(s) / newSeed(rand)      typed seeds normalised; '' means random
 *   keyAction(key, ctx)               the one keyboard table: state -> action name
 *   verdictKind(v) / toastTitle(v, name) / toastPlan(items)   one short line per verdict, red first
 *   adviceTone(advice, phase)         Guided mode's live go/caution/stop light on the big button
 *   tipFor(cars, shown, ctx)          at most one tip, each shown a few times at most
 *   analysisView(run)                 the analysis sheet's rows, from verdicts and the gap-log summary
 *   captionSteps(text)                a verdict sentence as 1-3 Title Case caption lines
 *   directorSteps(input)              the "What Went Wrong" replay timeline
 *   edgeArrow(ndc)                    where to pin the off-screen pointer, or null when on screen
 *   nextQuality(q, fps)               the quality tier after a frame-rate sample
 *   within(ms, what, promise)         the promise, or a named timeout error
 */

export const TIER_NAMES = ['mini', 'easy', 'medium', 'hard'];
export const TRAFFIC_LEVELS = ['none', 'light', 'normal', 'heavy'];
export const TIP_MODES = ['off', 'tips', 'guided', 'watch'];
export const DRILLS = ['exitPractice', 'liarCars']; // traffic-data PRESETS keys offered as drills
export const DEBUG_NAMES = ['liar', 'unsafe', 'tight', 'bus', 'blocked', 'shield', 'alongside', 'clear', 'early', 'missed'];
export const QUALITY = ['low', 'medium', 'high'];
const SEED_MAX = 24;
const TOAST_MS = 2800;
const TOAST_MAX = 32; // characters that fit one line at 390 px
const TIP_REPEATS = 3;
const FPS_FLOOR = 45;

export const RED = new Set(['unsafe', 'notAllowed', 'early', 'alongside']);
const AMBER = new Set(['tight', 'late', 'hesitation', 'lateSignal']);

export const COPY = {
  title: {
    ok: 'Clean Run', tight: 'Tight Gap', unsafe: 'Unsafe Go', notAllowed: 'No Room to Join', early: 'Signalled Too Early',
    alongside: 'Car Alongside', late: 'Missed Exit', hesitation: 'Hesitation', lateSignal: 'Late Signal',
  },
  go: { ok: 'Safe', tight: 'Tight', unsafe: 'Unsafe', notAllowed: 'No Room', none: 'Not Taken' },
  exit: { ok: 'On Time', early: 'Too Early', alongside: 'Car Alongside', late: 'Missed', lateSignal: 'Late Signal', auto: 'First Exit, Taken for You', none: 'Not Reached' },
  taken: {
    next: (s, name) => `Next Car ${s.toFixed(1)} s Away${name ? ` (${name})` : ''}`,
    none: 'No Car Coming',
    afterCar: (s) => `Went ${s.toFixed(1)} s After the Last Car Passed`,
    afterWindow: (s) => `Went ${s.toFixed(1)} s After the Window Opened`,
  },
  tips: { liar: 'Watch Front Wheels', long: 'Give Long Vehicles Room' },
  notes: { guided: 'Guided Run', watch: 'Watched Run', traffic: (t) => `${t[0].toUpperCase()}${t.slice(1)} Traffic` },
  replay: { again: 'Replay Again', driver: 'Driver View', above: 'Above View', next: 'Continue' },
  signal: { left: 'Signalling Left', right: 'Signalling Right', none: 'No Signal' },
};

/** The culprit's signal as the words pinned beside it in a freeze or replay: the cue stated, not just shown. */
export const signalLabel = (indicator) => COPY.signal[indicator] ?? COPY.signal.none;

const HC_PAGE = 'https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203';
const DL25_PAGE = 'https://www.gov.uk/guidance/understanding-your-driving-test-result/car-driving-test';

/**
 * A verdict's reference as link text and target; null when there is none (never a dead link). A ref may list
 * several ('HC 187, DL25 Mirrors: Change Direction'): the Highway Code rule wins, else the DL25 marking by name.
 */
export function hcLink(ref) {
  const parts = String(ref ?? '').split(/,\s*/);
  for (const part of parts) {
    const m = /^HC (\d+)$/.exec(part);
    if (m) return { text: `Highway Code Rule ${m[1]}`, href: `${HC_PAGE}#rule${m[1]}` };
  }
  const dl = parts.map((p) => /^DL25 (.+)$/.exec(p)).find(Boolean);
  return dl ? { text: `Driving Test Marking: ${dl[1].replace(/^\w+: /, '')}`, href: DL25_PAGE } : null;
}

// ---------- hash and seed ----------

export function cleanSeed(s) {
  const t = String(s ?? '').trim().replace(/\s+/g, '-').slice(0, SEED_MAX);
  return t || null;
}

export function newSeed(rand = Math.random) {
  return Math.floor(rand() * 36 ** 6).toString(36).padStart(6, '0');
}

const pick = (list, v, d) => (list.includes(v) ? v : d);

// cars = the traffic seed: a shared link replays the same arrivals as well as the same roundabout.
export function parseHash(hash, fallbacks = {}) {
  const p = new URLSearchParams(String(hash ?? '').replace(/^#/, ''));
  return {
    seed: cleanSeed(p.get('seed')),
    trafficSeed: cleanSeed(p.get('cars')),
    tier: pick(TIER_NAMES, p.get('tier'), fallbacks.tier ?? 'easy'),
    traffic: pick(TRAFFIC_LEVELS, p.get('traffic'), fallbacks.traffic ?? 'normal'),
    tips: pick(TIP_MODES, p.get('tips'), fallbacks.tips ?? 'tips'),
    drill: pick(DRILLS, p.get('drill'), fallbacks.drill ?? null),
    debug: pick(DEBUG_NAMES, p.get('debug'), null),
  };
}

// Defaults (normal traffic, Tips, no drill) stay out of shared links.
export function hashOf({ seed, trafficSeed, tier, traffic, tips, drill, debug }) {
  const p = new URLSearchParams({ seed, tier });
  if (trafficSeed) p.set('cars', trafficSeed);
  if (traffic && traffic !== 'normal') p.set('traffic', traffic);
  if (tips && tips !== 'tips') p.set('tips', tips);
  if (drill) p.set('drill', drill);
  if (debug) p.set('debug', debug);
  return '#' + p.toString();
}

/**
 * The session's settings from stored preferences and the URL hash (the hash wins; bad values fall back).
 * stored: { tier, traffic, tips, drill }. Bus and alongside checks need two ring lanes, so they lift mini/easy
 * to medium.
 */
export function resolveSettings(stored, hash, rand = Math.random) {
  const prefs = {
    tier: pick(TIER_NAMES, stored.tier, 'easy'),
    traffic: pick(TRAFFIC_LEVELS, stored.traffic, 'normal'),
    tips: pick(TIP_MODES, stored.tips, 'tips'),
    drill: pick(DRILLS, stored.drill, null),
  };
  const h = parseHash(hash, prefs);
  const twoLanes = (h.debug === 'bus' || h.debug === 'alongside') && (h.tier === 'mini' || h.tier === 'easy');
  return { ...h, tier: twoLanes ? 'medium' : h.tier, seed: h.seed ?? newSeed(rand), trafficSeed: h.trafficSeed ?? newSeed(rand) };
}

/**
 * The traffic seed for the next run. Retry after a red verdict replays the same traffic (see it again, decide
 * better); after a clean run it brings fresh traffic. Retry Guided and Watch It Done (mode set) always replay it.
 */
export function nextTrafficSeed(current, { wasRed = false, mode = null } = {}, rand = Math.random) {
  return mode || wasRed ? current : newSeed(rand);
}

// ---------- keyboard ----------

/**
 * ctx: { screen: 'preview'|'run'|'frozen'|'replay'|'analysis', phase (player phase in a run), sheet (an open
 * overlay sheet: 'settings'|'about'|'explain'|null), repeat }. Returns an action name or null.
 */
export function keyAction(key, { screen, phase, sheet = null, repeat = false }) {
  const k = key.length === 1 ? key.toLowerCase() : key;
  if (k === 'Escape') return sheet ? 'close' : screen === 'run' ? 'pause' : null;
  if (repeat) return null;
  if (sheet && (k === ' ' || k === 'Enter')) return sheet === 'explain' ? 'close' : null;
  if (k === ' ' || k === 'Enter') {
    if (screen === 'preview') return 'start';
    if (screen === 'run') return phase === 'ring' ? 'exit' : phase === 'approach' || phase === 'waiting' ? 'go' : null;
    if (screen === 'frozen') return 'replay';
    if (screen === 'replay') return 'continue';
    if (screen === 'analysis') return 'retry';
    return null;
  }
  if (sheet) return null;
  if (k === 'r') return screen === 'replay' ? 'replayAgain' : screen === 'analysis' || screen === 'frozen' ? 'retry' : null;
  if (k === 'n') return screen === 'run' ? null : 'new';
  if (k === 'g') return screen === 'analysis' ? 'retryGuided' : null;
  if (k === 'w') return screen === 'analysis' ? 'watch' : null;
  if (k === 'm') return 'mute';
  if (k === 's') return screen === 'run' ? null : 'settings';
  return null;
}

// ---------- verdicts and toasts ----------

export const verdictKind = (v) => (RED.has(v?.verdict) ? 'err' : AMBER.has(v?.verdict) ? 'warn' : 'ok');

const capital = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** One short Title Case line: core's own title when it has one, else built from the verdict and culprit name. */
export function toastTitle(v, culpritName = null) {
  if (v.title) return v.title.slice(0, TOAST_MAX);
  const name = culpritName ? capital(culpritName) : null;
  let t = COPY.title[v.verdict] ?? 'Check Your Run';
  if (v.verdict === 'unsafe' && name) t = `${name} Was Coming Round`;
  if (v.verdict === 'alongside' && name) t = `${name} Alongside`;
  if (v.verdict === 'notAllowed' && name && /bus|lorry/i.test(name)) t = `Too Close to the ${name.split(' ').pop()}`;
  return t.length > TOAST_MAX ? COPY.title[v.verdict] : t;
}

/** items: [{ verdict, name }] -> [{ verdict, kind, title, ms }], red before amber, original order kept within a kind. */
export function toastPlan(items) {
  const rank = { err: 0, warn: 1, ok: 2 };
  return items
    .map((it, i) => ({ ...it, kind: verdictKind(it.verdict), i }))
    .sort((a, b) => rank[a.kind] - rank[b.kind] || a.i - b.i)
    .map(({ verdict, name, kind }) => ({ verdict, kind, title: toastTitle(verdict, name), ms: TOAST_MS }));
}

// ---------- guided advice ----------

const GO_TONE = { safe: 'go', tight: 'caution', unsafe: 'stop' };
const EXIT_TONE = { ok: 'go', late: 'caution', early: 'stop' };

/**
 * Guided mode's live light on the big button: advice { go, exit, cueId } and the player phase -> 'go' |
 * 'caution' | 'stop' | null (neutral). Only the decision in front of the learner counts.
 */
export function adviceTone(advice, phase) {
  if (!advice) return null;
  if (phase === 'approach' || phase === 'waiting') return GO_TONE[advice.go] ?? null;
  if (phase === 'ring') return EXIT_TONE[advice.exit] ?? null;
  return null;
}

// The car to pick out while the light is amber or red, so the colour and the car connect.
export const adviceFocus = (advice, tone) => (tone === 'caution' || tone === 'stop' ? advice?.cueId ?? null : null);

// ---------- tips ----------

/**
 * cars: [{ upstream, indicator, large }] circulating vehicles; shown: { tipKey: count }; ctx: { lanes }.
 * Any upstream car signalling left gets the wheels tip, liar or not, so the tip never gives the answer away.
 */
export function tipFor(cars, shown, { lanes = 1 } = {}) {
  const allowed = (key) => (shown[key] ?? 0) < TIP_REPEATS;
  if (allowed('liar') && cars.some((c) => c.upstream && c.indicator === 'left')) return 'liar';
  if (allowed('long') && lanes > 1 && cars.some((c) => c.upstream && c.large)) return 'long';
  return null;
}

// ---------- analysis ----------

export function titleCase(s) {
  const minor = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'per', 'as', 'via']);
  return s.split(' ').map((w, i, all) => (i > 0 && i < all.length - 1 && minor.has(w.toLowerCase()) ? w.toLowerCase() : w[0] ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
}

/** A verdict sentence as one to three caption lines, Title Case, without trailing stops. */
export function captionSteps(text) {
  if (!text) return [];
  return text
    .split(/(?<=[.:])\s+|\s+but\s+/i)
    .map((s) => s.replace(/[.:]$/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .map(titleCase);
}

const signalText = (i) => (i === 'left' ? 'Signal Left' : i === 'right' ? 'Signal Right' : 'No Signal');
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

/**
 * run: { go, exit, exited, laps, red, mode ('off'|'tips'|'guided'|'watch'), traffic, signalLead, culprit: { id, name, indicator, comingRound } | null,
 *   summary (gap-log summary), hesitation (verdict), maxLaps }.
 * -> { title, reason, ref (verdict for the reference line), notes[], gaps, takenLines[], cars[], decisions[], explain }
 *   takenLines: "Next Car X s Away (Name)" or "No Car Coming", then how long after the last car (or the window)
 */
export function analysisView(run) {
  const { summary, hesitation: hes } = run;
  const missedOut = run.laps >= run.maxLaps;
  const ambers = [
    run.go?.verdict === 'tight' ? run.go : null,
    hes && hes.verdict !== 'ok' ? hes : null,
    run.laps ? { verdict: 'late', reason: 'Missed it: go round, never swerve.', hcRef: null } : null,
    run.exit?.verdict === 'lateSignal' ? run.exit : null,
  ].filter(Boolean);
  const main = run.red ?? ambers[0] ?? { verdict: 'ok', reason: '', hcRef: null };

  const cars = summary.cars.slice(-6).map((c) => ({ name: capital(c.name), value: `${signalText(c.indicator)}, ${c.comingRound ? 'Came Round' : 'Turned Off'}${c.misleading ? ' (Misleading)' : ''}` }));
  if (run.culprit && !summary.cars.some((c) => c.id === run.culprit.id)) {
    const c = run.culprit;
    cars.push({ name: capital(c.name), value: `${signalText(c.indicator)}, Came Round${c.indicator === 'left' ? ' (Misleading)' : ''}` });
  }

  // The taken entry's length runs from the gap (or window) opening to the tap: never call it "the gap".
  const taken = summary.taken;
  const nextName = taken?.nextCarId != null ? summary.cars.find((c) => c.id === taken.nextCarId)?.name : null;
  const takenLines = !taken ? [] : [
    taken.lag != null ? COPY.taken.next(taken.lag, nextName && capital(nextName)) : COPY.taken.none,
    ...(taken.reaction != null ? [(summary.gaps.some((g) => !g.taken) ? COPY.taken.afterCar : COPY.taken.afterWindow)(taken.reaction)] : []),
  ];

  let exitWord;
  if (run.exit && run.exit.verdict !== 'ok') exitWord = COPY.exit[run.exit.verdict] ?? capital(run.exit.verdict);
  else if (missedOut) exitWord = `Missed (${plural(run.laps, 'Lap')})`;
  else if (run.exit) exitWord = run.laps ? `Went Round ${plural(run.laps, 'Time')}, Then On Time` : COPY.exit.ok;
  else exitWord = run.exited ? COPY.exit.auto : COPY.exit.none; // the first exit has no Exit decision

  const decisions = [
    ['Go', COPY.go[run.go?.verdict ?? 'none'] ?? capital(run.go.verdict)],
    ['Waiting', hes?.verdict === 'ok' ? 'Fine' : `Hesitant (${plural(summary.missedClear, 'Clear Gap')})`],
    ['Exit', exitWord],
  ];
  if (run.signalLead != null) decisions.push(['Signal', `Given ${run.signalLead.toFixed(1)} s Before Exit`]);

  const notes = [];
  if (run.mode === 'guided' || run.mode === 'watch') notes.push(COPY.notes[run.mode]);
  if (run.traffic && run.traffic !== 'normal') notes.push(COPY.notes.traffic(run.traffic));

  return {
    title: missedOut ? COPY.title.late : COPY.title[main.verdict] ?? 'Run Complete',
    reason: main.detail ?? main.reason ?? '',
    ref: main.hcRef ?? null,
    notes,
    gaps: summary.gaps.length ? { gaps: summary.gaps, start: summary.gaps[0].start, end: summary.end ?? summary.gaps[summary.gaps.length - 1].end } : null,
    takenLines,
    cars,
    decisions,
    explain: Boolean(run.red),
    ambers: ambers.map((a) => ({ verdict: a.verdict, title: toastTitle(a) })),
  };
}

// ---------- replay director ----------

export const DIRECTOR = { lead: 3, ease: 0.8, hold: 1.5, slow: 0.5, captionGap: 1.2 };

/**
 * input: { frames: [{ t }], decisionT, verdict, culpritName }. Timeline in replay seconds:
 *   ease  camera eases from the seat to three-quarter while the clip plays from decisionT - lead
 *   hold  paused on the decision frame with the captions, one after another
 *   slow  half speed to the last frame (the would-be conflict), then end
 * Each step: { kind, from, to, rate, ms, captions? } with from/to as frame times.
 */
export function directorSteps({ frames, decisionT, verdict, culpritName = null }) {
  if (!frames.length) return [];
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const at = Math.min(t1, Math.max(t0, decisionT));
  const from = Math.max(t0, at - DIRECTOR.lead);
  const captions = captionSteps(verdict.detail ?? verdict.reason);
  if (culpritName && captions.length < 3) captions.push(`${capital(culpritName)} Was Coming Round`);
  return [
    { kind: 'play', from, to: at, rate: 1, camera: 'ease' },
    { kind: 'hold', from: at, to: at, ms: Math.max(DIRECTOR.hold, captions.length * DIRECTOR.captionGap) * 1000, captions },
    { kind: 'play', from: at, to: t1, rate: DIRECTOR.slow, camera: 'hold' },
    { kind: 'end', from: t1, to: t1 },
  ];
}

// ---------- on-screen helpers ----------

/** ndc: { x, y, behind } of a projected target. Off screen -> pointer position in 0..1 viewport units plus angle. */
export function edgeArrow({ x, y, behind }, margin = 0.08) {
  let nx = behind ? -x : x;
  let ny = behind ? -y : y;
  if (!behind && Math.abs(nx) <= 1 && Math.abs(ny) <= 1) return null;
  const k = 1 / Math.max(Math.abs(nx), Math.abs(ny), 1e-6);
  nx *= k;
  ny *= k;
  const lim = 1 - margin * 2;
  return { x: (Math.max(-lim, Math.min(lim, nx)) + 1) / 2, y: (1 - Math.max(-lim, Math.min(lim, ny))) / 2, angle: Math.atan2(-ny, nx) };
}

export function nextQuality(q, fps) {
  const i = QUALITY.indexOf(q);
  return fps < FPS_FLOOR && i > 0 ? QUALITY[i - 1] : q;
}

/** promise, or a rejection naming `what` after ms: a request that never settles must surface as an error. */
export function within(ms, what, promise) {
  let timer;
  const late = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`${what} did not load within ${ms / 1000} s`)), ms); });
  return Promise.race([promise, late]).finally(() => clearTimeout(timer));
}
