/**
 * Pure judging of the player's two decisions. Inputs are sim.state() snapshots; nothing is mutated.
 *
 *   judgeGo(state)            -> Verdict for a Go tap now (memoised per state object)
 *   goAssessment(state)       -> { me, tLine, tMerge, list }: the conflicts judgeGo weighs (see below)
 *   queuedBehind(state, me)   -> true while a vehicle ahead in the player's own entry lane is short of its line
 *   judgeExit(state)          -> Verdict for an Exit tap now
 *   missedExit()              -> Verdict when the exit passes with no (or too late a) tap
 *   createGapLog(layout)      -> recorder for the analysis sheet; see below
 *   judgeHesitation(summary)  -> post-run Verdict from a gap-log summary
 *
 * Verdict: { verdict, title, detail, reason, hcRef, culpritId, eta?, needDecel?, signalLead?, cue? }
 *   verdict: 'ok' | 'tight' | 'unsafe' | 'notAllowed' | 'early' | 'late' | 'alongside' | 'lateSignal' | 'hesitation'
 *   title: short Title Case line for a toast; detail: sentence-case explanation; reason: same as detail
 *   eta (s) and needDecel (m/s^2): the culprit's arrival and the braking it would need (Go verdicts)
 *   signalLead (s): how long before peeling off the left signal comes on (Exit verdicts on the ring)
 *   cue (unsafe): { indicator, wheels: 'in'|'out'|'straight', comingRound: true }
 *
 * Unsafe means a vehicle's TRUE path reaches the player's entry before the player can clear it, so it would
 * have to brake harder than BRAKE_LIMIT; its signal never matters, which is exactly what the detail explains.
 * All timing is from the player's real motion (pulling away at its real acceleration): a vehicle that will be
 * out of the conflict zone before the player reaches it passes in front and only opens the gap; tight is
 * measured from the player's real arrival at its line.
 * Sources: gov.uk Highway Code 184-189; DVSA "Understanding your driving test result" (DL25 faults).
 */
import { assessEntry, entryConflicts, requiredDecel, speedProfile, timeToReach, BRAKE_LIMIT, CLEAR_MARGIN } from './kinematics.js';
import { wrapPi, wrap2Pi, indexAt } from './geom.js';
import { LARGE_TYPES, CRITICAL_GAP } from './traffic-data.js';

export const TIGHT_GAP = CRITICAL_GAP.mean; // s: joining with less than a typical accepted gap is tight
export const REACTION = 1.5; // s to see a gap and move off
export const CLEAR_GAP = CRITICAL_GAP.mean + REACTION; // s of lag that leaves no reason to wait
export const EXIT_LATE = 1.0; // s before peeling off: too late to mirror, signal and leave
export const SIGNAL_DELAY = 0.4; // s from the Exit tap (mirror glance) to the left signal
export const LATE_SIGNAL = 2.0; // s: a left signal with less warning than this is late
export const OK_WINDOW = 2.0; // s of 'ok' Exit timing every route keeps, however close the exits
const CROSS_TIME = 1.5; // s past the diverge point an inner-lane car takes to cross the outer lane (estimate)
// s between a vehicle's rear leaving the conflict zone and the player's front reaching it; a post-encroachment
// time under about 1 s is read as a conflict in traffic-conflict studies (estimate).
const PASS_MARGIN = 1.0;
const STOPPED = 1.5; // m/s: a vehicle this slow inside the entry is a blockage, not traffic
const LARGE_ALONGSIDE = 15; // m either side of the player's merge point

const TYPE_NAMES = { hatch: 'car', estate: 'estate', van: 'van', bus: 'bus', lorry: 'lorry' };
export const vehicleName = (v) => `${v.colour} ${TYPE_NAMES[v.type] ?? v.type}`;
const capital = (s) => s[0].toUpperCase() + s.slice(1);
const secs = (x) => `${x.toFixed(1)} s`;
const WHEEL_WORDS = { in: 'turned in', out: 'turned out', straight: 'straight' };
const HC185_QUOTE = 'Be aware they may not be signalling correctly or at all (HC 185).';

// All verdict copy: title (Title Case, short) and detail (sentence case).
export const COPY = {
  ok: () => ({ title: 'Good', detail: '' }),
  unsafeInEntry: (n) => ({ title: 'Unsafe Gap', detail: `${capital(n)} was already at your entry. ${HC185_QUOTE}` }),
  unsafeLeft: (n, eta, wheels) => ({
    title: 'Unsafe Gap',
    detail: `${capital(n)} was ${secs(eta)} away, signalling left with wheels ${WHEEL_WORDS[wheels]}: it was coming round. ${HC185_QUOTE}`,
  }),
  unsafeRight: (n, eta) => ({ title: 'Unsafe Gap', detail: `${capital(n)} was ${secs(eta)} away. It was signalling right: it was always coming past you.` }),
  unsafeNone: (n, eta, wheels) => ({
    title: 'Unsafe Gap',
    detail: `${capital(n)} was ${secs(eta)} away with no signal and wheels ${WHEEL_WORDS[wheels]}: it was coming round. ${HC185_QUOTE}`,
  }),
  tight: (n, lag) => ({ title: 'Tight Gap', detail: `${capital(n)} was ${secs(lag)} away. Leave more room before you join.` }),
  longVehicle: (type) => ({
    title: 'Too Close to a Long Vehicle',
    detail: `Long vehicles might have to take a different course or straddle lanes. Let the ${type} pass before you join.`,
  }),
  blocked: (n) => ({ title: 'No Room to Join', detail: `${capital(n)} was stopped where you would join. Wait until your way is clear.` }),
  notOnRing: () => ({ title: 'Not on the Roundabout Yet', detail: 'Signal left for your exit once you are on the roundabout.' }),
  earlyExit: () => ({
    title: 'Too Early',
    detail: 'Signalling left now reads as taking the earlier exit. Signal left once you pass the exit before yours.',
  }),
  missed: () => ({ title: 'Missed It', detail: 'Too late to signal and leave safely. Go round again, never swerve.' }),
  alongside: (n) => ({
    title: 'Car Alongside',
    detail: `${capital(n)} is alongside on your left. Check your mirror and hold your lane: vehicles may straddle lanes.`,
  }),
  lateSignal: (lead, mini) => ({
    title: 'Late Signal',
    detail: `Your left signal came ${secs(lead)} before the exit. Signal once you pass the exit before yours.`
      + (mini ? ' On a mini roundabout there is less time to signal (HC 188).' : ''),
  }),
  hesitation: (lag) => ({
    title: 'Undue Hesitation',
    detail: lag === null
      ? 'Nothing was coming and you waited at the line. Go when it is safe to do so.'
      : `A clear gap of ${secs(lag)} went by at the line. Go when it is safe to do so.`,
  }),
};

function verdict(kind, copy, hcRef = null, culpritId = null, extra = {}) {
  return { verdict: kind, title: copy.title, detail: copy.detail, reason: copy.detail, hcRef, culpritId, ...extra };
}
const playerOf = (state) => state.vehicles.find((v) => v.isPlayer);

export function wheelsOf(v) {
  if (v.steer < -0.02) return 'in'; // right lock: following the ring
  if (v.steer > 0.02) return 'out';
  return 'straight';
}

function unsafeCopy(c) {
  const o = c.other;
  const n = vehicleName(o);
  if (c.inZone) return COPY.unsafeInEntry(n);
  if (o.indicator === 'left') return COPY.unsafeLeft(n, c.eta, wheelsOf(o));
  if (o.indicator === 'right') return COPY.unsafeRight(n, c.eta);
  return COPY.unsafeNone(n, c.eta, wheelsOf(o));
}

// Seconds to cover d metres from speed v at constant acceleration a (only braking counts); Infinity if it stops first.
function timeToCover(d, v, a) {
  if (d <= 0) return 0;
  const b = Math.min(0, a);
  if (b === 0) return v > 0.1 ? d / v : Infinity;
  const disc = v * v + 2 * b * d;
  return disc < 0 ? Infinity : (v - Math.sqrt(disc)) / -b;
}

// Large vehicle on the ring (in any lane) that will be passing the player's merge point when the player,
// pulling away for real, gets there (PASS_MARGIN either side): one already gone by then, or still far upstream,
// is not alongside.
function largeAlongside(state, me, tMerge) {
  const mergeBearing = me.path.bearing[indexAt(me.path, me.path.marks.merge)];
  return state.vehicles.find((w) => {
    if (w.isPlayer || !w.inRing || !LARGE_TYPES.has(w.type)) return false;
    const ahead = wrapPi(mergeBearing - w.bearing) * w.r; // > 0: still upstream of the merge point
    const past = ahead + w.length / 2 + LARGE_ALONGSIDE / 2; // m it still has to go to be clear
    if (past <= 0) return false;
    const tReach = timeToCover(ahead - (LARGE_ALONGSIDE + w.length / 2), w.v, w.a);
    return tReach < tMerge + PASS_MARGIN && timeToCover(past, w.v, w.a) + PASS_MARGIN > tMerge;
  });
}

// The player is queued (no Go is possible) while a vehicle ahead in its own entry lane has not crossed its line.
export const queuedBehind = (state, me) => state.vehicles.some((w) => !w.isPlayer && w.path.arm === me.path.arm
  && w.path.lane === me.path.lane && w.s > me.s && w.s - w.length / 2 < w.path.marks.giveWay);

/**
 * The Go as the player would really make it now: pulling away from its current speed at its real acceleration
 * (state's accelMax). Memoised per state object, so the guide, the gap log and a tap share one answer.
 *   tLine   s until the player reaches its line (0 at the line): the accepted gap is measured from here
 *   tMerge  s until the player is at its merge point
 *   list    assessEntry results that still matter, one per vehicle, soonest first. A vehicle passes in front
 *           of a conflict run when its rear passes every point of the run PASS_MARGIN before the player's front
 *           reaches the first entry point that point conflicts with (run.pairs). Point by point, because where
 *           the entry joins the vehicle's lane the run goes on downstream: a from-rest player then follows a
 *           faster vehicle in, long after its rear has passed. One that passes in front of all its remaining
 *           runs starts the gap and is left out; otherwise it counts by the first run it does not.
 */
const goMemo = new WeakMap();
export function goAssessment(state) {
  let a = goMemo.get(state);
  if (a) return a;
  const me = playerOf(state);
  const profile = speedProfile(me.path, me.latComfort);
  const reach = (s) => timeToReach(me.path, profile, me.s, me.v, me.accelMax, s);
  const frontAt = new Map(); // entry arc length -> s until the player's front gets there
  const frontTime = (sEntry) => {
    let t = frontAt.get(sEntry);
    if (t === undefined) frontAt.set(sEntry, (t = reach(sEntry - me.length / 2)));
    return t;
  };
  const passesInFront = ({ other: o, run }) => {
    const rear = o.s - o.length / 2;
    // NaN (no speed or acceleration on a hand-built state) fails the test: kept, fail safe.
    return run.pairs.every(([sOther, sEntry]) => sOther <= rear || timeToCover(sOther - rear, o.v, o.a) + PASS_MARGIN <= frontTime(sEntry));
  };
  const others = state.vehicles.filter((w) => !w.isPlayer && (w.inRing || w.committed));
  // Every remaining pass of each vehicle (on a mini one may cross the entry twice); it counts by the first it
  // does not pass in front of.
  const byVehicle = new Map();
  for (const c of assessEntry(me, others, { allRuns: true })) {
    if (passesInFront(c)) continue;
    const kept = byVehicle.get(c.other.id);
    if (!kept || c.run.sFrom < kept.run.sFrom) byVehicle.set(c.other.id, c);
  }
  // Braking a vehicle still to arrive needs, point by point: it reaches each run point no sooner than
  // CLEAR_MARGIN after the player's rear has passed the last entry point that point conflicts with. A car
  // following the player into the lane it joins only has to stay behind it, not out of the whole merge run.
  const rearAt = new Map();
  const rearTime = (sEntry) => {
    let t = rearAt.get(sEntry);
    if (t === undefined) rearAt.set(sEntry, (t = reach(sEntry + me.length / 2)));
    return t;
  };
  const pointwise = (c) => {
    if (c.inZone) return c;
    const front = c.other.s + c.other.length / 2;
    let needDecel = 0;
    for (const [sOther, , sLast] of c.run.pairs) {
      if (sOther > front) needDecel = Math.max(needDecel, requiredDecel(c.other.v, sOther - front, rearTime(sLast) + CLEAR_MARGIN));
    }
    return { ...c, needDecel };
  };
  const list = [...byVehicle.values()].map(pointwise).sort((x, y) => x.eta - y.eta);
  a = { me, tLine: reach(me.stopS), tMerge: reach(me.path.marks.merge), list };
  goMemo.set(state, a);
  return a;
}

const goVerdicts = new WeakMap();
export function judgeGo(state) {
  let v = goVerdicts.get(state);
  if (!v) goVerdicts.set(state, (v = judgeGoNow(state)));
  return v;
}

function judgeGoNow(state) {
  const { me, tLine, tMerge, list } = goAssessment(state);
  const hits = list.filter((c) => (c.inZone && c.other.v >= STOPPED) || (!c.inZone && c.needDecel > BRAKE_LIMIT));
  if (hits.length) {
    // The culprit is the vehicle that would have to brake hardest (one already in the entry: infinitely).
    const c = hits.reduce((a, b) => (b.needDecel > a.needDecel ? b : a));
    const o = c.other;
    return verdict('unsafe', unsafeCopy(c), 'HC 185', o.id, {
      cue: { indicator: o.indicator, wheels: wheelsOf(o), comingRound: true }, needDecel: c.needDecel, eta: c.eta,
    });
  }
  const big = largeAlongside(state, me, tMerge);
  if (big) return verdict('notAllowed', COPY.longVehicle(TYPE_NAMES[big.type]), 'HC 187', big.id);
  const blocked = list.find((c) => c.inZone);
  if (blocked) return verdict('notAllowed', COPY.blocked(vehicleName(blocked.other)), 'HC 185', blocked.other.id);
  const close = list.find((c) => c.eta - tLine < TIGHT_GAP);
  if (close) {
    return verdict('tight', COPY.tight(vehicleName(close.other), Math.max(0, close.eta - tLine)), 'HC 185', close.other.id, {
      eta: close.eta, needDecel: close.needDecel,
    });
  }
  return verdict('ok', COPY.ok());
}

// Arc length on the player's path where it passes the exit before its own; -Infinity if never on the ring.
export function previousExitS(layout, path) {
  const n = layout.arms.length;
  const prev = (path.exitArm - 1 + n) % n;
  if (prev === path.arm && path.loops === 0) return -Infinity;
  const iD = indexAt(path, path.marks.diverge);
  const bD = path.bearing[iD];
  const target = bD - wrap2Pi(bD - layout.arms[prev].divergeBearing[path.ringLane]);
  const iG = indexAt(path, path.marks.giveWay);
  if (target < path.bearing[iG]) return -Infinity;
  let lo = iG;
  let hi = iD;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.bearing[mid] < target) lo = mid;
    else hi = mid;
  }
  return path.s[hi];
}

export const missedExit = () => verdict('late', COPY.missed());

// Signed distance (m, > 0 ahead) of w along the ring from the player, when w is circulating in a lane outside
// the player's; null otherwise (cars waiting at or joining from an arm, or already turning off, never count).
export function outerOffset(me, w) {
  if (w.isPlayer || w.path.ringLane >= me.path.ringLane || w.s < w.path.marks.merge || w.s > w.path.marks.diverge) return null;
  return me.r * wrapPi(w.bearing - me.bearing);
}

// Seconds from now until the left signal would come on, measured to the point of peeling off.
const signalLeadOf = (me) => (me.path.marks.diverge - me.s) / Math.max(me.v, 1) - SIGNAL_DELAY;

export function judgeExit(state) {
  const me = playerOf(state);
  const m = me.path.marks;
  if (!me.inRing || me.s < m.giveWay) return verdict('early', COPY.notOnRing(), 'HC 186');
  if (me.s + me.length / 2 < previousExitS(state.layout, me.path)) return verdict('early', COPY.earlyExit(), 'HC 186');
  if ((m.diverge - me.s) / Math.max(me.v, 1) < EXIT_LATE) return missedExit();
  const signalLead = signalLeadOf(me);
  if (me.path.ringLane > 0) {
    // Level on the left now, or closing from behind fast enough to be level before the player is across.
    const tAcross = (m.diverge - me.s) / Math.max(me.v, 1) + CROSS_TIME;
    const side = state.vehicles.find((w) => {
      const off = outerOffset(me, w);
      if (off === null) return false;
      const reach = (w.length + me.length) / 2 + 1;
      return off < reach && off > -(reach + Math.max(0, w.v - me.v) * tAcross);
    });
    if (side) return verdict('alongside', COPY.alongside(vehicleName(side)), 'HC 187, DL25 Mirrors: Change Direction', side.id, { signalLead });
  }
  // Between two close exits there may be under LATE_SIGNAL of signalling time at all (minis especially,
  // HC 188): there the bar drops so at least OK_WINDOW of good timing remains after passing the previous exit.
  const available = (m.diverge - previousExitS(state.layout, me.path) + me.length / 2) / Math.max(me.v, 1) - SIGNAL_DELAY;
  const lateBelow = Math.max(EXIT_LATE, Math.min(LATE_SIGNAL, available - OK_WINDOW));
  if (signalLead < lateBelow) {
    const mini = state.layout.type === 'mini';
    return verdict('lateSignal', COPY.lateSignal(signalLead, mini), mini ? 'DL25 Signals: Timed, HC 188' : 'DL25 Signals: Timed', null, { signalLead });
  }
  return verdict('ok', COPY.ok(), null, null, { signalLead });
}

/**
 * Gap log for the analysis sheet and the hesitation fault. Call record(state) on every sim step of the run
 * (it ignores steps before windowOpened and stops by itself once the player has cleared its entry after Go);
 * bracket the decision with windowOpened(t), atLine(t) and goTapped(t, state).
 *   Lag = time until the next conflicting vehicle reaches the player's entry (0 while one is in it), from
 *   goAssessment, so one that passes in front of a Go now never counts: lag and judgeGo always agree.
 *   Only time spent stopped at the line counts towards hesitation. A clear gap is a lag of at least
 *   CLEAR_GAP while judgeGo says 'ok'; it is missed when it lasts REACTION seconds without a Go, including
 *   inside the gap finally taken.
 * summary() -> {
 *   gaps: [{ start, end, length, taken, lag?, nextCarId?, reaction? }]   offered gaps between conflicting
 *                                           passes from the Go window; the taken one carries `taken` below
 *   taken: { at, lag, nextCarId, reaction } | null   lag (s) to the next conflicting car at the tap, null
 *                                           when none was coming; nextCarId its id; reaction = s since the
 *                                           last car passed (or the window opened)
 *   missed: [{ start, end, lag }]           clear gaps let go by at the line (the taken one if waited in);
 *                                           lag at the gap's start, null when nothing was coming
 *   missedClear: missed.length, cars: [CarCue], end }
 *   CarCue: { id, name, type, colour, indicator, wheels, signalBehaviour, intent, comingRound, misleading }
 */
export function createGapLog(layout) {
  const passes = [];
  const cars = new Map();
  const lastFront = new Map();
  const missed = [];
  let windowAt = null;
  let lineAt = null;
  let tapAt = null;
  let taken = null;
  let clearSince = null; // start of the current clear stretch at the line
  let clearLag = 0;
  let cleared = false;
  let lastState = null;

  function lagNow(state) {
    const next = goAssessment(state).list[0]; // soonest first; one in the entry has eta 0; one passing in front is out
    return { lag: next ? next.eta : Infinity, nextCarId: next ? next.other.id : null };
  }

  function closeClear(t) {
    if (clearSince !== null && t - clearSince >= REACTION) missed.push({ start: clearSince, end: t, lag: Number.isFinite(clearLag) ? clearLag : null });
    clearSince = null;
  }

  function record(state) {
    const me = playerOf(state);
    if (!me || windowAt === null || cleared) return;
    lastState = state;
    if (tapAt !== null && me.s > me.path.marks.entryEnd) { cleared = true; return; }
    for (const w of state.vehicles) {
      if (w.isPlayer) continue;
      const front = w.s + w.length / 2;
      const prev = lastFront.get(w.id) ?? front;
      lastFront.set(w.id, front);
      const run = entryConflicts(me.path, w.path, Math.max(me.length, w.length))[0];
      const turnsOffHere = w.path.exitArm === layout.player.arm;
      if (run && prev < run.sFrom && front >= run.sFrom) {
        if (tapAt === null) passes.push(state.t);
        noteCar(w, true);
      } else if (!run && turnsOffHere && prev < w.path.marks.diverge && front >= w.path.marks.diverge) {
        noteCar(w, false);
      }
    }
    if (lineAt === null || tapAt !== null) return;
    const { lag } = lagNow(state);
    if (lag >= CLEAR_GAP && judgeGo(state).verdict === 'ok') {
      if (clearSince === null) { clearSince = state.t; clearLag = lag; }
    } else {
      closeClear(state.t);
    }
  }

  function noteCar(w, comingRound) {
    cars.set(w.id, {
      id: w.id, name: vehicleName(w), type: w.type, colour: w.colour, indicator: w.indicator, wheels: wheelsOf(w),
      signalBehaviour: w.signalBehaviour, intent: w.intent, comingRound,
      misleading: comingRound ? w.indicator === 'left' : w.indicator !== 'left',
    });
  }

  function goTapped(t, state = lastState) {
    if (tapAt !== null) return;
    tapAt = t;
    const now = state ? lagNow(state) : { lag: Infinity, nextCarId: null };
    const lastPass = passes.length ? passes[passes.length - 1] : windowAt ?? t;
    taken = {
      at: t, lag: Number.isFinite(now.lag) ? now.lag : null, nextCarId: now.nextCarId, reaction: t - Math.max(lastPass, windowAt ?? t),
    };
    if (state && now.nextCarId !== null) {
      const car = state.vehicles.find((v) => v.id === now.nextCarId);
      if (car) noteCar(car, true);
    }
    closeClear(t);
  }

  function summary() {
    const gaps = [];
    if (windowAt === null) return { gaps, taken, missed, missedClear: missed.length, cars: [...cars.values()], end: null };
    const end = tapAt ?? passes[passes.length - 1] ?? windowAt;
    let start = windowAt;
    for (const p of passes) {
      if (p > start) gaps.push({ start, end: p, length: p - start, taken: false });
      start = Math.max(start, p);
    }
    if (tapAt !== null) {
      gaps.push({ start, end: tapAt, length: tapAt - start, taken: true, lag: taken.lag, nextCarId: taken.nextCarId, reaction: taken.reaction });
    }
    return { gaps, taken, missed, missedClear: missed.length, cars: [...cars.values()], end };
  }

  return {
    record,
    windowOpened: (t) => { if (windowAt === null) windowAt = t; },
    atLine: (t) => { if (lineAt === null) lineAt = t; if (windowAt === null) windowAt = t; },
    goTapped,
    summary,
  };
}

// DVSA marks "not proceeding when it is safe to do so at junctions": one clear gap let go by is enough.
export function judgeHesitation(summary) {
  if (summary.missed.length) {
    const worst = summary.missed.reduce((a, b) => ((b.lag ?? Infinity) > (a.lag ?? Infinity) ? b : a));
    return verdict('hesitation', COPY.hesitation(worst.lag), 'DL25 Progress: Undue Hesitation');
  }
  return verdict('ok', COPY.ok());
}
