/**
 * Auto-drive for the player car. Pure: drives the sim's player through sim.setPlayerControl.
 *
 *   const player = createPlayer(sim, { onEvent })
 *   player.update()      call once per sim step BEFORE sim.step(dt); returns the events fired this step
 *   player.go()          Go tapped: stop holding at the line (an early tap commits to rolling in). Accepted
 *                        only while goWindowOpen; returns true when accepted, false (ignored) otherwise
 *   player.goWindowOpen  true within CREEP_DISTANCE of the line while first in the queue (no vehicle ahead
 *                        in its own entry lane short of its line): the Go is always the player's own call
 *   player.exit()        Exit accepted: mirror glance, signal left, leave at the target exit
 *   player.goRoundAgain() late Exit: stay on the ring for another lap
 *   player.phase         'approach' | 'waiting' | 'going' | 'ring' | 'leaving' | 'exited'
 *   player.exitWindowOpen  on the ring with an exit decision
 *   player.exitDecision  false on a first-exit route: no Exit tap, the car leaves by itself (HC 186)
 *   player.dispose()
 *   CREEP_DISTANCE       metres before the line where the Go window opens
 *
 * Invariants (tests/test-roundabout-judge.js): car-following beats every speed target, so the player never
 * overlaps another vehicle and queues >= 2 m back; once committed it drops below MIN_ROLL only behind a
 * vehicle ahead in its own lane.
 *
 * Events (name, { t, ...data }):
 *   goWindowOpen  first time the window opens            atLine   stopped at the give-way line
 *   entered       front crossed the line                exitWindowOpen  on the ring (again after a missed lap)
 *   mirrorGlance  exit taken: look left                 signalLeft      SIGNAL_DELAY later
 *   exited        left the ring                         missedExit      passed the exit: going round again
 *
 * Signals follow HC 186: left on approach for the first exit and kept on; right on approach for exits past
 * 12 o'clock and while circulating (also when going round again); left only once the exit is taken.
 *
 * Suggested glue: on Go tap  v = judgeGo(sim.state()); player.go();
 *   on Exit tap  v = judgeExit(sim.state()); 'ok'/'lateSignal' -> player.exit(); 'late' -> player.goRoundAgain().
 */
import { PLAYER_ID } from './sim.js';
import { EXIT_LATE, SIGNAL_DELAY, outerOffset } from './judge.js';
import { wrapPi } from './geom.js';

// Estimates of a brisk but ordinary automatic Polo, not sourced figures.
const CREEP = 4.5; // m/s, about 10 mph
export const CREEP_DISTANCE = 16; // m before the line where the creep starts and the Go window opens
const APPROACH_DECEL = 1.75;
const STOP_DECEL = 1.6;
const MAX_ACCEL = 2.4;
const MAX_BRAKE = 3.0;
const SIGNAL_FROM = 60; // m before the line
// Car-following (IDM interaction term): stopped gap FOLLOW.s0, time headway FOLLOW.T, comfortable braking
// FOLLOW.b. It may brake up to EMERGENCY_BRAKE: a leader can stop harder than any of the player's own targets.
const FOLLOW = { s0: 2.2, T: 1.2, b: 2.0 };
const EMERGENCY_BRAKE = 7;
const LINE_EPS = 0.02; // m: at the stop point
const CUT_IN_SPARE = FOLLOW.s0; // m of gap left when the player has matched a leader's speed
const MIN_ROLL = 3; // m/s: the least a committed car slows to for anything but a vehicle ahead in its lane

export function createPlayer(sim, { onEvent } = {}) {
  const route = sim.layout.player.route;
  const exitDecision = route.exitDecision;
  let phase = 'approach';
  let goWindowOpen = false;
  let windowEverOpened = false;
  let exitWindowOpen = false;
  let atLine = false;
  let entered = false;
  let signalAt = null;
  let indicator = null;
  let events = [];

  const emit = (name, data = {}) => {
    const e = { name, t: sim.t, ...data };
    events.push(e);
    onEvent?.(e.name, e);
  };

  // Speed the approach should not exceed at distance d from the stop point.
  function approachTarget(d, limit) {
    if (d > CREEP_DISTANCE) return Math.min(limit, Math.sqrt(CREEP * CREEP + 2 * APPROACH_DECEL * (d - CREEP_DISTANCE)));
    return Math.min(CREEP, Math.sqrt(2 * STOP_DECEL * Math.max(0, d)));
  }

  // Nearest vehicle ahead with its true length: the sim's leader, or one in the player's entry lane on any
  // path (they share the samples up to the ring), including one just over the line the sim's frames miss.
  // A long vehicle queued in the NEXT approach lane is not the player's leader (the sim's HC 187 hold-back is
  // for AI): the player pulls up to its own line beside it and makes its own Go decision there.
  function leaderAhead(me, vehicles) {
    const lead = sim.leaderOf(PLAYER_ID);
    const lw = lead.id == null ? null : vehicles.find((w) => w.id === lead.id);
    const nextLane = lw && lw.path.arm === me.path.arm && lw.path.lane !== me.path.lane && lw.s - lw.length / 2 < lw.path.marks.giveWay;
    let best = nextLane ? { gap: Infinity, speed: 0 } : { gap: lead.gap, speed: lead.speed };
    for (const w of vehicles) {
      if (w.isPlayer || w.path.arm !== me.path.arm || w.path.lane !== me.path.lane || w.s <= me.s) continue;
      if (w.s - w.length / 2 > w.path.marks.entryEnd) continue;
      const gap = w.s - me.s - (w.length + me.length) / 2;
      if (gap < best.gap) best = { gap, speed: w.v };
    }
    return best;
  }

  // A vehicle ahead in the player's own entry lane that has not crossed its line yet: the player is queued.
  const queuedAhead = (me, vehicles) => vehicles.some((w) => !w.isPlayer && w.path.arm === me.path.arm
    && w.path.lane === me.path.lane && w.s > me.s && w.s - w.length / 2 < w.path.marks.giveWay);

  // Acceleration car-following allows: settles FOLLOW.s0 behind the vehicle ahead, whatever it does.
  function followAccel(me, vehicles) {
    const lead = leaderAhead(me, vehicles);
    if (lead.gap === Infinity) return Infinity;
    const want = FOLLOW.s0 + Math.max(0, me.v * FOLLOW.T + (me.v * (me.v - lead.speed)) / (2 * Math.sqrt(MAX_ACCEL * FOLLOW.b)));
    const idm = MAX_ACCEL * (1 - (want / Math.max(lead.gap, 0.05)) ** 2);
    // A car cutting in close but barely slower (a merge into the same exit) needs only gentle braking: IDM
    // alone stamps on the brakes for any gap under its desired spacing. Brake at least as hard as matching
    // the leader's speed CUT_IN_SPARE behind it takes, never less than comfortable.
    const closing = me.v - lead.speed;
    const need = closing > 0 ? (closing * closing) / (2 * Math.max(lead.gap - CUT_IN_SPARE, 0.05)) : 0;
    return Math.max(idm, -Math.max(FOLLOW.b, 1.2 * need));
  }

  // In an inner lane nearing the exit and while leaving, ease off to fall behind a vehicle level on the left
  // rather than sit beside it: the way out crosses its lane, and it may be heading into the same exit lane.
  // Only vehicles circulating in an outer ring lane (or merging into the same exit) count, never one waiting
  // at or turning off into an arm, and easing off never goes below MIN_ROLL: a committed car stops only for
  // a vehicle ahead in its own lane (followAccel).
  function dropBack(me, vehicles) {
    const m = me.path.marks;
    if ((phase !== 'ring' && phase !== 'leaving') || me.path.ringLane === 0 || me.s < m.diverge - 40 || me.s > m.exitRing) return Infinity;
    let cap = Infinity;
    for (const w of vehicles) {
      let off = outerOffset(me, w);
      const mergingOut = !w.isPlayer && w.path.ringLane < me.path.ringLane && w.path.exitArm === me.path.exitArm
        && w.s > w.path.marks.diverge && w.s - w.length / 2 < w.path.marks.exitRing + 15;
      if (mergingOut) off = me.r * wrapPi(w.bearing - me.bearing);
      if (off === null) continue;
      const level = (w.length + me.length) / 2 + 2;
      if (Math.abs(off) < level) cap = Math.min(cap, w.v - 1.5);
      else if (off > 0 && off < level + 8) cap = Math.min(cap, w.v); // just ahead: stay behind it
    }
    return Math.max(MIN_ROLL, cap);
  }

  // Stops exactly at the stop point, never over it: speed tracking alone lags the braking curve and lands
  // up to a metre past. Once stopping in d needs STOP_DECEL, brake at exactly v^2 / 2d (the sim integrates
  // constant acceleration exactly, so this lands on d = 0).
  function lineAccel(d, v) {
    if (d <= LINE_EPS) return v > 0 ? -Math.max(STOP_DECEL, (v * v) / (2 * LINE_EPS)) : 0;
    const need = (v * v) / (2 * d);
    return need >= STOP_DECEL * 0.95 ? -need : Infinity;
  }

  const track = (vTarget, v) => Math.max(-MAX_BRAKE, Math.min(MAX_ACCEL, 2 * (vTarget - v)));

  // Approach signal (HC 186): left for the first exit, right past 12 o'clock, none straight on.
  const approachSignal = () => (!exitDecision ? 'left' : sim.player.path.direction === 'right' ? 'right' : null);

  function update() {
    events = [];
    const me = sim.player;
    const { vehicles } = sim.state();
    const m = me.path.marks;
    const d = me.stopS - me.s;
    let vTarget;

    if (phase === 'approach' || phase === 'waiting') {
      vTarget = approachTarget(d, me.path.limits.approach);
      // The Go decision is the player's own, judged at its own line: open only when first in the queue.
      const open = d < CREEP_DISTANCE && !queuedAhead(me, vehicles);
      if (open && !windowEverOpened) {
        windowEverOpened = true;
        emit('goWindowOpen');
      }
      goWindowOpen = open;
      if (!atLine && d < 0.5 && me.v < 0.2) {
        atLine = true;
        phase = 'waiting';
        emit('atLine');
      }
      if (indicator === null && d < SIGNAL_FROM) indicator = approachSignal();
    } else {
      vTarget = Math.min(sim.allowedSpeed(PLAYER_ID), dropBack(me, vehicles));
    }

    if (!entered && me.s + me.length / 2 >= m.giveWay) {
      entered = true;
      emit('entered');
    }
    if (phase === 'going' && me.s >= m.merge) {
      phase = 'ring';
      if (exitDecision) {
        exitWindowOpen = true;
        emit('exitWindowOpen');
      } else {
        exit();
      }
    }
    // A tap inside EXIT_LATE is judged late; the car itself commits to the ring only at the last moment.
    if (phase === 'ring' && (m.diverge - me.s) / Math.max(me.v, 1) < EXIT_LATE / 2) goRoundAgain();
    if (phase === 'leaving') {
      if (signalAt !== null && sim.t >= signalAt) {
        signalAt = null;
        indicator = 'left';
        emit('signalLeft');
      }
      if (me.s >= m.exitRing) {
        phase = 'exited';
        emit('exited');
      }
    }
    if (phase === 'exited' && me.s > m.exitRing + 15) indicator = null;

    // Car-following always wins over the approach, creep, stop-line and ring targets.
    const holding = phase === 'approach' || phase === 'waiting';
    const accel = Math.max(-EMERGENCY_BRAKE, Math.min(track(vTarget, me.v), followAccel(me, vehicles), holding ? lineAccel(d, me.v) : Infinity));
    sim.setPlayerControl({ accel, indicator });
    return events;
  }

  // Accepted only while the Go window is open (first in queue, near the line); returns whether it was.
  function go() {
    if ((phase !== 'approach' && phase !== 'waiting') || !goWindowOpen) return false;
    phase = 'going';
    goWindowOpen = false;
    sim.commitPlayer();
    return true;
  }

  function exit() {
    if (phase !== 'ring') return;
    phase = 'leaving';
    exitWindowOpen = false;
    signalAt = sim.t + SIGNAL_DELAY;
    emit('mirrorGlance');
  }

  // Going round again is a full circle: signal right while circulating until the exit is taken (HC 186).
  function goRoundAgain() {
    if (phase !== 'ring') return;
    const p = sim.setPlayerLoops(sim.player.path.loops + 1);
    indicator = 'right';
    emit('missedExit', { loops: p.loops });
    emit('exitWindowOpen');
  }

  return {
    update,
    go,
    exit,
    goRoundAgain,
    exitDecision,
    dispose() { events = []; },
    get phase() { return phase; },
    get goWindowOpen() { return goWindowOpen; },
    get exitWindowOpen() { return exitWindowOpen; },
  };
}
