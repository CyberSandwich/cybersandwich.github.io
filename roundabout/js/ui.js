/**
 * Pure front-end rules: no DOM, no three.js, so node tests cover them (tests/test-roundabout-ui.js).
 *
 *   COPY                              every HUD string in one table
 *   signalLabel(indicator)            'Signalling Left' | 'Signalling Right' | 'No Signal'
 *   hcLink(ref)                       'HC 185' / 'DL25 ...' -> { text, href } or null
 *   parseHash(hash) / hashOf(opts)    #seed=&cars=&tier=&traffic=&tips=&drill=&debug=&qa= <-> settings
 *   resolveSettings(stored, hash)     the session's settings (hash wins, bad values fall back, seeds drawn)
 *   nextTrafficSeed(current, ctx)     same traffic on Retry after red and on Guided/Watch, fresh after clean
 *   cleanSeed(s) / newSeed(rand)      typed seeds normalised; '' means random
 *   keyAction(key, ctx)               the one keyboard table: state -> action name
 *   verdictKind(v) / toastPlan(items) one short line per verdict (its own title), red first
 *   createToastQueue({ now })         the toast stack: red above amber, each up for a minimum time, the hint below
 *   leaderPath(rect, target, view)    the line from the hint to what it points at, or null
 *   routeView(layout)                 the route card: exit, lane, destination and the clock-face pip's spokes
 *   adviceTone(advice, phase)        Guided mode's live go/caution/stop light on the big button
 *   tipFor(cars, shown, ctx)          at most one tip, each shown a few times at most
 *   analysisView(run)                 the analysis sheet's rows, from verdicts and the gap-log summary
 *   captionSteps(text)                a verdict sentence as 1-3 Title Case caption lines
 *   directorSteps(input)              the "What Went Wrong" replay timeline
 *   edgeArrow(ndc)                    where to pin the off-screen pointer, or null when on screen
 *   nextQuality(q, fps)               the quality tier after a frame-rate sample
 *   within(ms, what, promise)         the promise, or a named timeout error
 */

import { titleCase } from './guide.js';
import { missedExit, CLEAR_GAP } from './judge.js';

const TIER_NAMES = ['mini', 'easy', 'medium', 'hard'];
const TRAFFIC_LEVELS = ['none', 'light', 'normal', 'heavy'];
const TIP_MODES = ['off', 'tips', 'guided', 'watch'];
const DRILLS = ['exitPractice', 'liarCars']; // traffic-data PRESETS keys offered as drills
const DEBUG_NAMES = ['liar', 'unsafe', 'tight', 'bus', 'blocked', 'shield', 'alongside', 'clear', 'early', 'missed'];
export const QUALITY = ['low', 'medium', 'high'];
const SEED_MAX = 24;
// A toast is at most 32 characters (about 5 words, ~1.5 s to read) seen in a glance away from the road: 3.5 s
// covers the look down, the read and the look back, and a full stack of three still clears in one 3.5 s window.
export const TOAST_MIN_MS = 3500;
export const TOAST_CAP = 3;
const TIP_REPEATS = 3;
const FPS_FLOOR = 45;

export const RED = new Set(['unsafe', 'notAllowed', 'early', 'alongside']);
const AMBER = new Set(['tight', 'late', 'hesitation', 'lateSignal']);

// Verdict titles are judge's (every verdict carries `title`); only a run with no verdict needs one here.
export const COPY = {
  clean: 'Clean Run',
  go: { ok: 'Safe', tight: 'Tight', unsafe: 'Unsafe', notAllowed: 'No Room', none: 'Not Taken', handled: 'Handled for You' },
  exit: { ok: 'On Time', early: 'Too Early', alongside: 'Car Alongside', late: 'Missed', lateSignal: 'Late Signal', auto: 'First Exit, Taken for You', none: 'Not Reached' },
  taken: {
    next: (s, name) => `Next Car ${s.toFixed(1)} s Away${name ? ` (${name})` : ''}`,
    none: 'No Car Coming',
    afterCar: (s) => `Went ${s.toFixed(1)} s After the Last Car Passed`,
    afterWindow: (s) => `Went ${s.toFixed(1)} s After the Window Opened`,
  },
  tips: { liar: 'Watch Front Wheels', long: 'Give Long Vehicles Room' },
  notes: { guided: 'Guided Run', watch: 'Watched Run', traffic: (t) => `${t[0].toUpperCase()}${t.slice(1)} Traffic` },
  replay: { again: 'Replay Again', driver: 'Driver View', above: 'Above View', keep: 'Keep Driving', next: 'See Analysis' },
  signal: { left: 'Signalling Left', right: 'Signalling Right', none: 'No Signal' },
  paused: 'Paused',
  start: 'Start',
  loading: 'Loading',
  link: { copy: 'Copy Link', copied: 'Copied' },
  mph: (n) => `${n} mph`,
  // index.html's boot watchdog keeps its own copy: it runs before any module can load.
  bootFailed: 'Could Not Load the Roundabout',
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
    qa: p.has('qa'), // the window.__rb QA handle (main.js); kept in the hash so a reload keeps it
  };
}

// Defaults (normal traffic, Tips, no drill) stay out of shared links.
export function hashOf({ seed, trafficSeed, tier, traffic, tips, drill, debug, qa }) {
  const p = new URLSearchParams({ seed, tier });
  if (trafficSeed) p.set('cars', trafficSeed);
  if (traffic && traffic !== 'normal') p.set('traffic', traffic);
  if (tips && tips !== 'tips') p.set('tips', tips);
  if (drill) p.set('drill', drill);
  if (debug) p.set('debug', debug);
  if (qa) p.set('qa', '1');
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
    if (screen === 'replay') return 'seeAnalysis';
    if (screen === 'analysis') return 'retry';
    return null;
  }
  if (sheet) return null;
  if (k === 'r') return screen === 'replay' ? 'replayAgain' : screen === 'analysis' || screen === 'frozen' ? 'retry' : null;
  if (k === 'k') return screen === 'frozen' || screen === 'replay' ? 'keepDriving' : null;
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

const KIND_RANK = { err: 0, warn: 1, ok: 2 };

/**
 * items: [{ verdict }] -> [{ verdict, kind, title }], red before amber, original order kept within a kind. The
 * title is the verdict's own (judge keeps every title one line long).
 */
export function toastPlan(items) {
  return items
    .map((it, i) => ({ verdict: it.verdict, kind: verdictKind(it.verdict), i }))
    .sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.i - b.i)
    .map(({ verdict, kind }) => ({ verdict, kind, title: verdict.title }));
}

/**
 * The toast stack, with no DOM and no timers: the host calls tick() at nextChange() and redraws `visible`.
 *   push(plan)   toastPlan items join the stack, or wait while it is full
 *   tap(id)      takes that toast off and returns it (the host opens its explanation); the rest run on
 *   setCaption(text | null, { holdMs })   the one hint line (guide, tip, replay caption, Paused): a new text replaces
 *                the last, the same text only renews its hold; no holdMs = until replaced or cleared
 *   caption      the hint showing ({ id, kind: 'caption', title, until }) or null
 *   clear()      run start and end: nothing visible, nothing waiting, no hint
 *   tick()       expires toasts and the hint whose time is up and fills freed slots; true when `visible` changed
 *   visible      top to bottom: red above amber, newest first within a severity, then the hint (nearest the
 *                Go button, so verdicts always sit above it)
 *   nextChange() the clock time tick() next has work, or null
 * Each toast is up for exactly minMs from when it shows: a full stack makes a newcomer wait (red first, then in
 * arrival order) rather than push a showing one off early. The hint never counts toward the cap.
 */
export function createToastQueue({ now, minMs = TOAST_MIN_MS, cap = TOAST_CAP }) {
  let visible = [];
  let waiting = [];
  let note = null;
  let nextId = 1;

  function fill() {
    let changed = false;
    while (visible.length < cap && waiting.length) {
      visible.push({ ...waiting.shift(), shownAt: now() });
      changed = true;
    }
    visible.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || b.shownAt - a.shownAt || b.id - a.id);
    return changed;
  }

  return {
    push(plan) {
      waiting.push(...plan.map((item) => ({ ...item, id: nextId++ })));
      waiting.sort((a, b) => KIND_RANK[a.kind] - KIND_RANK[b.kind] || a.id - b.id);
      return fill();
    },
    tap(id) {
      const item = visible.find((t) => t.id === id);
      if (!item) return null;
      visible = visible.filter((t) => t !== item);
      fill();
      return item;
    },
    setCaption(text, { holdMs = 0 } = {}) {
      const until = text && holdMs ? now() + holdMs : null;
      if (!text) note = null;
      else if (note?.title === text) note = { ...note, until };
      else note = { id: nextId++, kind: 'caption', title: text, until };
    },
    get caption() { return note; },
    clear() { visible = []; waiting = []; note = null; },
    tick() {
      const t = now();
      const before = visible.length;
      visible = visible.filter((v) => t < v.shownAt + minMs);
      const noteGone = note?.until != null && t >= note.until;
      if (noteGone) note = null;
      return fill() || visible.length !== before || noteGone;
    },
    get visible() { return note ? [...visible, note] : visible; },
    get waiting() { return waiting; },
    nextChange() {
      const ends = visible.map((v) => v.shownAt + minMs);
      if (note?.until != null) ends.push(note.until);
      return ends.length ? Math.min(...ends) : null;
    },
  };
}

/**
 * The leader line from the hint to what it points at, in viewport pixels: rect { left, top, right, bottom } of the
 * hint, target { x, y } or null, view { width, height }. The line leaves the hint's nearest edge (kept clear of its
 * rounded ends by `inset`) and ends at the target. null when there is no target, the target is off screen or on the
 * hint itself, or the line would be too short to read.
 */
export function leaderPath(rect, target, view, { inset = 16, minLength = 24 } = {}) {
  if (!rect || !target) return null;
  const { x, y } = target;
  if (!(x >= 0 && x <= view.width && y >= 0 && y <= view.height)) return null;
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  let x1;
  let y1;
  if (y < rect.top || y > rect.bottom) {
    x1 = clamp(x, rect.left + inset, Math.max(rect.left + inset, rect.right - inset));
    y1 = y < rect.top ? rect.top : rect.bottom;
  } else if (x < rect.left || x > rect.right) {
    x1 = x < rect.left ? rect.left : rect.right;
    y1 = clamp(y, rect.top, rect.bottom);
  } else return null;
  if (Math.hypot(x - x1, y - y1) < minLength) return null;
  return { x1, y1, x2: x, y2: y };
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

// ---------- route card ----------

const TAU = Math.PI * 2;

/**
 * The route card's content from a layout, so the HUD never reads the layout itself:
 * { exitText, laneText ('' with one ring lane), destText, mini (a filled island on the pip),
 *   spokes: [{ angle, target }] } with angle in radians clockwise from the pip's top, the player's arm at six o'clock.
 */
export function routeView(layout) {
  const pl = layout.player;
  const me = layout.arms[pl.arm];
  const lanes = layout.circulatory.lanes;
  return {
    exitText: `Exit ${pl.exitNumber}`,
    laneText: lanes > 1 ? `${['Left', lanes === 3 ? 'Middle' : 'Right', 'Right'][pl.lane]} Lane` : '',
    destText: `${pl.route.destination} (${pl.route.road})`,
    mini: layout.type === 'mini',
    spokes: layout.arms.map((arm) => ({ angle: (((arm.bearing - me.bearing - Math.PI) % TAU) + TAU) % TAU, target: arm.index === pl.exitArm })),
  };
}

// ---------- analysis ----------

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
 *   summary (gap-log summary), hesitation (verdict), maxLaps, replayable, goHandled (a drill made the Go) }.
 * -> { title, reason, ref (verdict for the reference line), notes[], gaps, takenLines[], cars[], decisions[], explain }
 *   title: the main verdict's own (red, else a missed-out run, else the first amber), or COPY.clean
 *   takenLines: "Next Car X s Away (Name)" or "No Car Coming", then how long after the last car (or the window)
 */
export function analysisView(run) {
  const { summary } = run;
  const hes = run.goHandled ? null : run.hesitation;
  const missedOut = run.laps >= run.maxLaps;
  const missed = run.laps ? missedExit() : null;
  const ambers = [
    run.go?.verdict === 'tight' ? run.go : null,
    hes && hes.verdict !== 'ok' ? hes : null,
    missed,
    run.exit?.verdict === 'lateSignal' ? run.exit : null,
  ].filter(Boolean);
  const main = run.red ?? (missedOut ? missed : ambers[0]) ?? { verdict: 'ok', title: COPY.clean, detail: '', hcRef: null };

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
  else if (run.exit) exitWord = run.laps ? `Went Round ${plural(run.laps, 'Time')}, Then on Time` : COPY.exit.ok;
  else exitWord = run.exited ? COPY.exit.auto : COPY.exit.none; // the first exit has no Exit decision

  // A drill's Go is made for the learner: nothing about it (or the wait before it) is theirs to judge.
  const decisions = run.goHandled ? [['Go', COPY.go.handled], ['Exit', exitWord]] : [
    ['Go', COPY.go[run.go?.verdict ?? 'none'] ?? capital(run.go.verdict)],
    ['Waiting', hes?.verdict === 'ok' ? 'Fine' : `Hesitant (${plural(summary.missedClear, 'Clear Gap')})`],
    ['Exit', exitWord],
  ];
  if (run.signalLead != null) decisions.push(['Signal', `Given ${run.signalLead.toFixed(1)} s Before Exit`]);

  const notes = [];
  if (run.mode === 'guided' || run.mode === 'watch') notes.push(COPY.notes[run.mode]);
  if (run.traffic && run.traffic !== 'normal') notes.push(COPY.notes.traffic(run.traffic));

  return {
    title: main.title,
    reason: main.detail ?? main.reason ?? '',
    ref: main.hcRef ?? null,
    notes,
    // clear: a gap the judge would have called clear (CLEAR_GAP), so the chart marks it without knowing the rule.
    gaps: summary.gaps.length ? {
      gaps: summary.gaps.map((g) => ({ ...g, clear: g.length >= CLEAR_GAP })),
      start: summary.gaps[0].start,
      end: summary.end ?? summary.gaps[summary.gaps.length - 1].end,
    } : null,
    takenLines,
    cars,
    decisions,
    explain: Boolean(run.replayable || run.red), // the run kept a lead-up to replay: the red verdict, or an amber decision
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
