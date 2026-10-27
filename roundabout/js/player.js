/**
 * Auto-drive for the player car. Pure: drives the sim's player through sim.setPlayerControl.
 *
 *   const player = createPlayer(sim, { onEvent })
 *   player.update()      call once per sim step BEFORE sim.step(dt); returns the events fired this step
 *   player.go()          Go tapped: stop holding at the line (an early tap commits to rolling in)
 *   player.exit()        Exit accepted: mirror glance, signal left, leave at the target exit
 *   player.goRoundAgain() late Exit: stay on the ring for another lap
 *   player.phase         'approach' | 'waiting' | 'going' | 'ring' | 'leaving' | 'exited'
 *   player.goWindowOpen / player.exitWindowOpen   booleans for the HUD button state
 *
 * Events (name, { t, ...data }):
 *   goWindowOpen  ~4 s before the line        atLine        stopped at the give-way line
 *   entered       front crossed the line      exitWindowOpen on the ring (again after each missed lap)
 *   mirrorGlance  exit accepted: look left    signalLeft    ~0.4 s later
 *   exited        left the ring               missedExit    passed the exit: going round again
 *
 * Suggested glue: on Go tap  v = judgeGo(sim.state(), { windowOpen: player.goWindowOpen }); player.go();
 *   on Exit tap  v = judgeExit(sim.state()); 'ok' -> player.exit(); 'late' -> player.goRoundAgain().
 */
import { PLAYER_ID } from './sim.js';
import { EXIT_LATE } from './judge.js';

const CREEP = 4.5; // m/s, about 10 mph
const CREEP_DISTANCE = 16; // m before the line where the creep starts (3-4 s at creep speed)
const APPROACH_DECEL = 1.75;
const STOP_DECEL = 1.0;
const GO_WINDOW = 4; // s before the line
const MAX_ACCEL = 2.0;
const MAX_BRAKE = 3.0;
const SIGNAL_DELAY = 0.4;
const SIGNAL_FROM = 60; // m before the line

export function createPlayer(sim, { onEvent } = {}) {
  let phase = 'approach';
  let goWindowOpen = false;
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

  // Never closer to the vehicle ahead than it allows to stop behind it.
  function followCap() {
    const lead = sim.leaderOf(PLAYER_ID);
    if (lead.gap === Infinity) return Infinity;
    return lead.speed + Math.sqrt(Math.max(0, 2 * 2 * (lead.gap - 2)));
  }

  const track = (vTarget, v) => Math.max(-MAX_BRAKE, Math.min(MAX_ACCEL, 2 * (vTarget - v)));

  function update() {
    events = [];
    const me = sim.player;
    const m = me.path.marks;
    const d = me.stopS - me.s;
    let vTarget;

    if (phase === 'approach' || phase === 'waiting') {
      vTarget = approachTarget(d, me.path.limits.approach);
      if (!goWindowOpen && (d / Math.max(me.v, 0.5) <= GO_WINDOW || d < CREEP_DISTANCE)) {
        goWindowOpen = true;
        emit('goWindowOpen');
      }
      if (!atLine && d < 0.5 && me.v < 0.2) {
        atLine = true;
        phase = 'waiting';
        emit('atLine');
      }
      if (indicator === null && d < SIGNAL_FROM && me.path.direction !== 'ahead') indicator = me.path.direction;
    } else {
      vTarget = sim.allowedSpeed(PLAYER_ID);
    }
    vTarget = Math.min(vTarget, followCap());

    if (!entered && me.s + me.length / 2 >= m.giveWay) {
      entered = true;
      emit('entered');
    }
    if (phase === 'going' && me.s >= m.merge) {
      phase = 'ring';
      exitWindowOpen = true;
      emit('exitWindowOpen');
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

    sim.setPlayerControl({ accel: track(vTarget, me.v), indicator });
    return events;
  }

  function go() {
    if (phase !== 'approach' && phase !== 'waiting') return;
    phase = 'going';
    sim.commitPlayer();
  }

  function exit() {
    if (phase !== 'ring') return;
    phase = 'leaving';
    exitWindowOpen = false;
    signalAt = sim.t + SIGNAL_DELAY;
    emit('mirrorGlance');
  }

  function goRoundAgain() {
    if (phase !== 'ring') return;
    const p = sim.setPlayerLoops(sim.player.path.loops + 1);
    emit('missedExit', { loops: p.loops });
    emit('exitWindowOpen');
  }

  return {
    update,
    go,
    exit,
    goRoundAgain,
    get phase() { return phase; },
    get goWindowOpen() { return goWindowOpen; },
    get exitWindowOpen() { return exitWindowOpen; },
  };
}
