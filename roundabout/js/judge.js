/**
 * Pure judging of the player's two decisions. Inputs are sim.state() snapshots; nothing is mutated.
 *
 *   judgeGo(state, { windowOpen })   -> Verdict for a Go tap now
 *   judgeExit(state)                 -> Verdict for an Exit tap now
 *   missedExit()                     -> Verdict when the exit passes with no (or too late a) tap
 *   createGapLog(layout)             -> recorder for the analysis sheet; see below
 *   judgeHesitation(summary)         -> post-run Verdict from a gap-log summary
 *
 * Verdict: { verdict, reason, hcRef, culpritId, cue? }
 *   verdict: 'ok' | 'tight' | 'unsafe' | 'notAllowed' | 'early' | 'late' | 'alongside' | 'hesitation'
 *   cue (Go verdicts with a culprit): { indicator, wheels: 'in'|'out'|'straight', comingRound: true }
 *
 * Unsafe means a vehicle's TRUE path reaches the player's entry before the player can clear it, so it would
 * have to brake harder than BRAKE_LIMIT; its signal never matters, which is exactly what the reason explains.
 */
import { assessEntry, entryConflicts, BRAKE_LIMIT } from './kinematics.js';
import { wrapPi, wrap2Pi, indexAt } from './geom.js';
import { LARGE_TYPES, CRITICAL_GAP } from './traffic-data.js';

export const TIGHT_GAP = CRITICAL_GAP.mean; // s: joining with less than a typical accepted gap is tight
export const HESITATION_GAP = 6; // s: a clear gap this long that is not taken counts against the driver
export const HESITATION_COUNT = 2;
export const EXIT_LATE = 1.0; // s before peeling off: too late to mirror, signal and leave
const STOPPED = 1.5; // m/s: a vehicle this slow inside the entry is a blockage, not traffic
const LARGE_ALONGSIDE = 15; // m either side of the player's merge point

const TYPE_NAMES = { hatch: 'car', estate: 'estate', van: 'van', bus: 'bus', lorry: 'lorry' };
export const vehicleName = (v) => `${v.colour} ${TYPE_NAMES[v.type] ?? v.type}`;
const capital = (s) => s[0].toUpperCase() + s.slice(1);

const verdict = (v, reason = '', hcRef = null, culpritId = null, extra = {}) => ({ verdict: v, reason, hcRef, culpritId, ...extra });
const playerOf = (state) => state.vehicles.find((v) => v.isPlayer);

function wheelsOf(v) {
  if (v.steer < -0.02) return 'in'; // right lock: following the ring
  if (v.steer > 0.02) return 'out';
  return 'straight';
}

function unsafeReason(v) {
  const name = capital(vehicleName(v));
  if (v.indicator === 'left') return `${name} was signalling left but its wheels were turned in. It was coming round.`;
  if (v.indicator === 'right') return `${name} was signalling right and kept coming round.`;
  return `${name} wasn't signalling, but it was coming round. Read its wheels and position.`;
}

// Large vehicle on the ring passing the player's merge point (in any lane).
function largeAlongside(state, me) {
  const mergeBearing = me.path.bearing[indexAt(me.path, me.path.marks.merge)];
  return state.vehicles.find((w) => {
    if (w.isPlayer || !w.inRing || !LARGE_TYPES.has(w.type)) return false;
    const ahead = wrapPi(mergeBearing - w.bearing) * w.r; // > 0: still upstream of the merge point
    return ahead > -(w.length / 2 + LARGE_ALONGSIDE / 2) && ahead < LARGE_ALONGSIDE + w.length / 2;
  });
}

export function judgeGo(state, { windowOpen = true } = {}) {
  const me = playerOf(state);
  if (!windowOpen) return verdict('early', 'Wait until you can see into the roundabout.');
  const others = state.vehicles.filter((w) => !w.isPlayer && (w.inRing || w.committed));
  const tLine = Math.max(0, me.stopS - me.s) / Math.max(me.v, 2);
  const list = assessEntry(me, others);

  const hits = list.filter((c) => (c.inZone && c.other.v >= STOPPED) || (!c.inZone && c.needDecel > BRAKE_LIMIT));
  if (hits.length) {
    // The culprit is the vehicle that would have to brake hardest (one already in the entry: infinitely).
    const c = hits.reduce((a, b) => (b.needDecel > a.needDecel ? b : a));
    const o = c.other;
    return verdict('unsafe', unsafeReason(o), 'HC 185', o.id, {
      cue: { indicator: o.indicator, wheels: wheelsOf(o), comingRound: true },
      needDecel: c.needDecel, eta: c.eta,
    });
  }

  const big = largeAlongside(state, me);
  if (big) {
    return verdict('notAllowed', `Never join alongside a ${TYPE_NAMES[big.type]}: long vehicles can need more than one lane.`, 'HC 187', big.id);
  }

  const blocked = list.find((c) => c.inZone);
  if (blocked) {
    const name = vehicleName(blocked.other);
    return verdict('notAllowed', `No room: the ${name} was stopped where you would join. Only go when your way is clear.`, 'HC 185', blocked.other.id);
  }

  const close = list.find((c) => c.eta - tLine < TIGHT_GAP);
  if (close) {
    const lag = Math.max(0, close.eta - tLine);
    return verdict('tight', `Tight: the ${vehicleName(close.other)} was ${lag.toFixed(1)} s away. Aim for a gap of 4-5 s.`, 'HC 185', close.other.id, { eta: close.eta });
  }
  return verdict('ok');
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

export function missedExit() {
  return verdict('late', 'Missed it: go round, never swerve.', 'HC 186');
}

export function judgeExit(state) {
  const me = playerOf(state);
  const m = me.path.marks;
  if (!me.inRing || me.s < m.giveWay) return verdict('early', 'You are not on the roundabout yet.', 'HC 186');
  if (me.s + me.length / 2 < previousExitS(state.layout, me.path)) {
    return verdict('early', 'Reads as taking the earlier exit: signal left once you pass the exit before yours.', 'HC 186');
  }
  if ((m.diverge - me.s) / Math.max(me.v, 1) < EXIT_LATE) return missedExit();
  if (me.path.ringLane > 0) {
    const side = state.vehicles.find((w) => {
      if (w.isPlayer || !w.inRing || w.r < me.r + 1.5) return false;
      const off = me.r * wrapPi(w.bearing - me.bearing);
      return Math.abs(off) < (w.length + me.length) / 2 + 1;
    });
    if (side) {
      return verdict('alongside', `${capital(vehicleName(side))} alongside on your left: hold your lane or go round.`, 'HC 186', side.id);
    }
  }
  return verdict('ok');
}

/**
 * Gap log for the analysis sheet. Call record(state) every sim step; windowOpened(t) and goTapped(t) bracket
 * the decision. A gap is the time between consecutive conflicting vehicles passing the player's entry.
 *   summary() -> { gaps: [{ start, end, length, taken, reaction? }], cars: [CarCue], missedClear }
 *   CarCue: { id, name, type, colour, indicator, wheels, signalBehaviour, intent, comingRound, misleading }
 */
export function createGapLog(layout) {
  const passes = [];
  const cars = new Map();
  const lastFront = new Map();
  let windowAt = null;
  let tapAt = null;

  function record(state) {
    const me = playerOf(state);
    if (!me || windowAt === null || tapAt !== null) return;
    for (const w of state.vehicles) {
      if (w.isPlayer) continue;
      const front = w.s + w.length / 2;
      const prev = lastFront.get(w.id) ?? front;
      lastFront.set(w.id, front);
      const run = entryConflicts(me.path, w.path, Math.max(me.length, w.length))[0];
      const turnsOffHere = w.path.exitArm === layout.player.arm;
      if (run && prev < run.sFrom && front >= run.sFrom) {
        passes.push(state.t);
        noteCar(w, true);
      } else if (!run && turnsOffHere && prev < w.path.marks.diverge && front >= w.path.marks.diverge) {
        noteCar(w, false);
      }
    }
  }

  function noteCar(w, comingRound) {
    cars.set(w.id, {
      id: w.id, name: vehicleName(w), type: w.type, colour: w.colour, indicator: w.indicator, wheels: wheelsOf(w),
      signalBehaviour: w.signalBehaviour, intent: w.intent, comingRound,
      misleading: comingRound ? w.indicator === 'left' : w.indicator !== 'left',
    });
  }

  function summary() {
    const gaps = [];
    if (windowAt === null) return { gaps, cars: [...cars.values()], missedClear: 0 };
    const end = tapAt ?? passes[passes.length - 1] ?? windowAt;
    let start = windowAt;
    for (const p of passes) {
      if (p > start) gaps.push({ start, end: p, length: p - start, taken: false });
      start = Math.max(start, p);
    }
    if (tapAt !== null) gaps.push({ start, end: tapAt, length: tapAt - start, taken: true, reaction: tapAt - start });
    const missedClear = gaps.filter((g) => !g.taken && g.length > HESITATION_GAP).length;
    return { gaps, cars: [...cars.values()], missedClear, end };
  }

  return {
    record,
    windowOpened: (t) => { if (windowAt === null) windowAt = t; },
    goTapped: (t) => { tapAt = t; },
    summary,
  };
}

export function judgeHesitation(summary) {
  if (summary.missedClear >= HESITATION_COUNT) {
    return verdict('hesitation', `${summary.missedClear} clear gaps of over ${HESITATION_GAP} s went by. Go when it is safe.`, 'DL25 undue hesitation');
  }
  return verdict('ok');
}
