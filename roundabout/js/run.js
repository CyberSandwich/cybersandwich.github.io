/**
 * One run: sim + auto-drive + judging + gap log + optional guide, as a state machine. No three.js, no DOM:
 * it talks to the screen only through the `out` callbacks main passes in.
 *
 *   const run = createRun({ layout, tier, trafficSeed, traffic, preset, debug, tipsMode, tipsShown, out, gapLog? })
 *     trafficSeed fixes the arrivals (same seed, same traffic, whatever the player does); traffic = density;
 *     preset = a traffic-data PRESETS key (a drill); its autoGo makes the run tap Go itself.
 *     gapLog defaults to judge.createGapLog(layout) (tests pass a spy)
 *   run.step(dt)            one fixed sim step (player, guide, gap log, sim, events)
 *   run.tick(dt)            real time: freeze slow-motion, guide slow cues, replay playback; returns time scale
 *   run.act()               the Go/Exit decision (tap, key and guide all come here)
 *   run.state               'approach' | 'atLine' | 'onRing' | 'exited' | 'frozen' | 'replay' | 'analysis' | 'paused'
 *   run.sim  run.player  run.prev  run.curr  run.focus  run.culpritId  run.replayFrame()  run.togglePause()
 *   run.replayAgain()  run.continue()  run.showReplay()
 *
 * tipsMode: 'off' | 'tips' | 'guided' (learner taps, guide advises) | 'watch' (guide taps).
 * out: { act(label, opts), advice(tone | null), chip(text, opts), toasts(plan), clearToasts(), highlight(id, opts), clearGhosts(),
 *   glance: { look(target, hold), focus(target, hold?, { sign, arrows }), mirrors() }, replay(on), horn(culpritId), ended(view) }
 *   focus marks: sign = layout.signs index to pulse, arrows = arm whose lane arrows pulse (null for none).
 *   target = { id } (a vehicle) or { x, z } (a world point). look() is the fixed freeze glance; focus() is guide
 *   focus, which the cab's head-look scheduler yields to. The scan itself is the cab's (cockpit.setDrive, main).
 */
import { createSim } from './sim.js';
import { createPlayer } from './player.js';
import { judgeGo, judgeExit, createGapLog, judgeHesitation, previousExitS, vehicleName } from './judge.js';
import { createGuide } from './guide.js';
import { entryConflicts } from './kinematics.js';
import { wrapPi, indexAt } from './geom.js';
import { LARGE_TYPES, PRESETS } from './traffic-data.js';
import { RED, COPY, toastPlan, tipFor, analysisView, directorSteps, adviceTone, adviceFocus } from './ui.js';

const FREEZE_SECONDS = 0.4;
const REPLAY_AFTER = 1.2; // s frozen before "What Went Wrong" starts on its own
const END_AFTER_EXIT = 2.6; // sim s after leaving the ring; the path runs ~80 m further, so the car never stops
const MAX_LAPS = 3;
const SLOW_SCALE = 0.4;
const TIP_EVERY = 15; // steps between tip checks
const UPSTREAM = 1.6; // rad of ring upstream of the player's merge that counts for tips
const GO_SCENARIOS = ['liar', 'unsafe', 'tight', 'bus', 'blocked', 'shield'];
const EMPTY_SCENARIOS = ['clear', 'early', 'missed'];
const EXIT_GOES = new Set(['ok', 'lateSignal']); // Exit verdicts on which the car leaves; red ones freeze

export function createRun({ layout, tier, trafficSeed, traffic = 'normal', preset = null, debug = null, tipsMode = 'tips', tipsShown = {}, out, gapLog = null }) {
  // Watch: the guide drives and taps. Guided: the learner taps, the guide advises. Both caption and focus.
  const watch = tipsMode === 'watch';
  const guided = watch || tipsMode === 'guided';
  const sim = createSim(layout, { trafficSeed, density: traffic, ...(preset ? { preset } : {}) });
  const autoGo = Boolean(preset && PRESETS[preset]?.autoGo);
  const events = [];
  const player = createPlayer(sim, { onEvent: (name, e) => events.push(e) });
  const log = gapLog ?? createGapLog(layout);
  const guide = guided ? createGuide(layout, { tier, mode: tipsMode }) : null;
  const exitDecision = layout.player.route.exitDecision !== false;
  if (EMPTY_SCENARIOS.includes(debug)) sim.debug.scenario('clear');
  else if (debug) sim.debug.clearTraffic(); // scenarios are timed from the line: no queue ahead

  const rec = { go: null, exit: null, laps: 0, red: null, culprit: null, decisionT: null, tip: null, alongside: null, signalAt: null, exitedAt: null };
  let state = 'approach';
  let beforePause = null;
  let endAt = null;
  let frozenFor = 0;
  let slowUntil = 0;
  let steps = 0;
  let replay = null;
  let focus = null;
  let goGate = false;
  let prev = sim.snapshot();
  let curr = prev;

  const me = () => sim.player;

  // player.goWindowOpen is the one Go gate (first at its own line, queue included); the button mirrors it.
  function setAct() {
    const phase = player.phase;
    const going = phase === 'approach' || phase === 'waiting';
    const inert = watch || (going ? autoGo : !exitDecision);
    if (going) out.act('Go', { enabled: player.goWindowOpen, inert });
    else out.act('Exit', { enabled: phase === 'ring' && player.exitWindowOpen, inert });
  }

  // ---------- decisions ----------

  function decide() {
    if (state !== 'approach' && state !== 'atLine' && state !== 'onRing') return;
    const phase = player.phase;
    if ((phase === 'approach' || phase === 'waiting') && player.goWindowOpen) {
      const st = sim.state();
      const v = judgeGo(st);
      // The player decides whether a tap counts (first at its own line); a refused tap leaves no trace at all.
      if (!player.go()) return;
      log.goTapped(sim.t, st);
      out.advice(null);
      rec.go = v;
      rec.decisionT = sim.t;
      out.chip(null);
      if (RED.has(v.verdict)) freeze(v, st);
      else if (v.verdict === 'tight') out.toasts(toastPlan([{ verdict: v, name: nameOf(st, v.culpritId) }]));
      setAct();
    } else if (phase === 'ring' && player.exitWindowOpen && exitDecision) {
      const st = sim.state();
      const v = judgeExit(st);
      out.advice(null);
      if (EXIT_GOES.has(v.verdict)) {
        // A late signal is amber: the car still leaves, the toast says why it was late.
        rec.exit = v;
        player.exit();
        if (v.verdict !== 'ok') out.toasts(toastPlan([{ verdict: v }]));
      } else if (v.verdict === 'late') player.goRoundAgain();
      else {
        rec.exit = v;
        rec.decisionT = sim.t;
        freeze(v, st);
      }
      setAct();
    }
  }

  const nameOf = (st, id) => {
    const v = id != null && st.vehicles.find((w) => w.id === id);
    return v ? vehicleName(v) : null;
  };

  function freeze(v, st) {
    rec.red = v;
    const c = v.culpritId != null && st.vehicles.find((w) => w.id === v.culpritId);
    rec.culprit = c ? { id: c.id, name: vehicleName(c), indicator: c.indicator, comingRound: true } : null;
    beforePause = null;
    state = 'frozen';
    frozenFor = 0;
    out.highlight(v.culpritId, { lamp: true });
    if (c) out.glance.look({ id: c.id }, Infinity);
    if (v.verdict === 'unsafe') out.horn(v.culpritId);
    out.clearToasts();
    out.toasts(toastPlan([{ verdict: v, name: rec.culprit?.name }]));
  }

  // ---------- events ----------

  function onEvent(e) {
    // One step can carry events past end() (missedExit then exitWindowOpen); the run is over.
    if (state === 'analysis') return;
    switch (e.name) {
      case 'goWindowOpen':
        log.windowOpened(e.t);
        break;
      case 'atLine':
        state = 'atLine';
        log.atLine(e.t); // hesitation counts only from here
        if (GO_SCENARIOS.includes(debug)) {
          sim.debug.scenario(debug);
          out.clearGhosts();
        }
        break;
      case 'exitWindowOpen':
        state = 'onRing';
        break;
      case 'missedExit':
        rec.laps++;
        if (rec.laps >= MAX_LAPS) end();
        else out.toasts(toastPlan([{ verdict: { verdict: 'late', reason: '' } }]));
        break;
      case 'mirrorGlance':
        out.glance.mirrors();
        break;
      case 'signalLeft':
        rec.signalAt ??= sim.t;
        break;
      case 'exited':
        state = 'exited';
        rec.exitedAt = sim.t;
        endAt = sim.t + END_AFTER_EXIT;
        break;
      default:
    }
  }

  // ---------- guide and tips ----------

  function onCue(cue) {
    // Guided mode's live advice may ride on any cue or come as its own; the light follows the latest.
    if (cue.advice !== undefined) {
      const tone = adviceTone(cue.advice, player.phase);
      out.advice(tone);
      const id = adviceFocus(cue.advice, tone);
      if (id != null) out.highlight(id, {});
    }
    switch (cue.kind) {
      case 'caption':
        out.chip(cue.text, { caption: true, holdMs: cue.holdMs });
        break;
      case 'focus':
        focus = cue.focusId != null ? { id: cue.focusId } : cue.focusPoint ?? null;
        out.highlight(cue.focusId ?? null, {});
        out.glance.focus(focus, cue.holdMs != null ? cue.holdMs / 1000 : undefined, marksFor(cue));
        break;
      case 'slow':
        slowUntil = Math.max(slowUntil, performance.now() + (cue.holdMs ?? 700));
        break;
      case 'go':
      case 'exit':
        if (watch) decide();
        break;
      default:
    }
  }

  // What a focus cue points at in the road furniture: the sign it reads (layout.signs index, matched by position)
  // or the lane arrows on the player's arm.
  function marksFor(cue) {
    const p = cue.topic === 'sign' ? cue.focusPoint : null;
    const sign = p ? layout.signs.findIndex((s) => Math.hypot(s.x - p.x, s.z - p.z) < 0.5) : -1;
    return { sign: sign >= 0 ? sign : null, arrows: cue.topic === 'lane' ? layout.player.arm : null };
  }

  function tips() {
    if (tipsMode !== 'tips' || !player.goWindowOpen || !['approach', 'waiting'].includes(player.phase)) return;
    const st = sim.state();
    const p = st.vehicles.find((v) => v.isPlayer);
    const bm = p.path.bearing[indexAt(p.path, p.path.marks.merge)];
    const cars = st.vehicles.filter((w) => !w.isPlayer && w.inRing).map((w) => {
      const up = wrapPi(bm - w.bearing);
      return { upstream: up >= 0 && up <= UPSTREAM && entryConflicts(p.path, w.path).length > 0, indicator: w.indicator, large: LARGE_TYPES.has(w.type) };
    });
    const key = tipFor(cars, tipsShown, { lanes: layout.circulatory.lanes });
    if (key === rec.tip) return;
    if (key) tipsShown[key] = (tipsShown[key] ?? 0) + 1;
    rec.tip = key;
    out.chip(key ? COPY.tips[key] : null);
  }

  // ---------- loop ----------

  function step(dt) {
    player.update();
    if (guide && (state === 'approach' || state === 'atLine' || state === 'onRing' || state === 'exited')) {
      for (const cue of guide.update(sim.state(), player.phase)) onCue(cue);
    }
    // Every step: the log gates itself, and keeps going past the Go tap until the player clears the entry,
    // so the car pulled out in front of is logged.
    log.record(sim.state());
    if (player.goWindowOpen !== goGate) { goGate = player.goWindowOpen; setAct(); } // the button follows the gate at once
    if (autoGo && !rec.go && player.goWindowOpen && state !== 'frozen') decide();
    sim.step(dt);
    prev = curr;
    curr = sim.snapshot();
    for (const e of events.splice(0)) onEvent(e);
    if (++steps % TIP_EVERY === 0 && (state === 'approach' || state === 'atLine' || state === 'onRing')) {
      setAct();
      tips();
    }
    if (debug === 'alongside' && rec.alongside === null && player.phase === 'ring') {
      // Placed once the player is past the exit before theirs, where an Exit tap is otherwise on time.
      if (me().s + me().length / 2 >= previousExitS(layout, me().path)) rec.alongside = sim.debug.scenario('alongside') ?? -1;
    }
    if (endAt !== null && sim.t >= endAt && state === 'exited') end();
    if (guide?.done && state === 'exited' && endAt === null) endAt = sim.t + END_AFTER_EXIT;
  }

  function tick(dt) {
    if (state === 'paused') return 0;
    if (state === 'frozen') {
      frozenFor += dt;
      if (frozenFor >= FREEZE_SECONDS + REPLAY_AFTER && !replay) startReplay();
      return Math.max(0, 1 - frozenFor / FREEZE_SECONDS) ** 2;
    }
    if (state === 'replay') { advanceReplay(dt); return 0; }
    if (state === 'analysis') return 0;
    return performance.now() < slowUntil ? SLOW_SCALE : 1;
  }

  // ---------- replay ("What Went Wrong") ----------

  function startReplay() {
    if (!rec.red) return;
    const frames = replay?.frames ?? sim.replay();
    replay = { frames, steps: directorSteps({ frames, decisionT: rec.decisionT ?? frames[frames.length - 1].t, verdict: rec.red, culpritName: rec.culprit?.name }), i: 0, t: 0, caption: -1 };
    replay.ft = replay.steps[0]?.from ?? frames[0].t;
    state = 'replay';
    out.clearToasts();
    out.replay(true);
  }

  function advanceReplay(dt) {
    const s = replay.steps[replay.i];
    if (!s || s.kind === 'end') return;
    if (s.kind === 'hold') {
      replay.t += dt * 1000;
      const k = Math.min(s.captions.length - 1, Math.floor(replay.t / (s.ms / Math.max(1, s.captions.length))));
      if (k !== replay.caption && s.captions[k]) { replay.caption = k; out.chip(s.captions[k], { caption: true }); }
      if (replay.t >= s.ms) { replay.i++; replay.t = 0; }
      return;
    }
    replay.ft = Math.min(s.to, replay.ft + dt * s.rate);
    if (replay.ft >= s.to) { replay.i++; replay.t = 0; }
  }

  // The two snapshots around the replay cursor, plus what the camera and overlays need.
  function replayFrame() {
    if (!replay) return null;
    const { frames } = replay;
    const f = Math.max(0, Math.min(frames.length - 1, (replay.ft - frames[0].t) * 30));
    const i = Math.min(frames.length - 2, Math.floor(f));
    const step = replay.steps[replay.i];
    return { a: frames[i], b: frames[i + 1], alpha: f - i, culpritId: rec.red?.culpritId ?? null, phase: step?.kind ?? 'end', easing: step?.camera === 'ease' };
  }

  function end() {
    if (state === 'analysis') return;
    state = 'analysis';
    replay && out.replay(false);
    out.chip(null);
    out.clearToasts();
    const summary = log.summary();
    const view = analysisView({
      go: rec.go, exit: rec.exit, exited: rec.exitedAt !== null, laps: rec.laps, red: rec.red, culprit: rec.culprit, summary, hesitation: judgeHesitation(summary),
      maxLaps: MAX_LAPS, mode: tipsMode, traffic, signalLead: rec.signalAt !== null && rec.exitedAt != null ? rec.exitedAt - rec.signalAt : null,
    });
    out.ended(view);
  }

  return {
    step,
    tick,
    act: decide,
    replayFrame,
    get state() { return state; },
    get sim() { return sim; },
    get player() { return player; },
    get prev() { return prev; },
    get curr() { return curr; },
    get focus() { return focus; },
    get guided() { return guided; },
    get wasRed() { return Boolean(rec.red); },
    get culpritId() { return rec.red?.culpritId ?? null; },
    togglePause() {
      if (state === 'paused') { state = beforePause; beforePause = null; return false; }
      if (!['approach', 'atLine', 'onRing', 'exited'].includes(state)) return false;
      beforePause = state;
      state = 'paused';
      return true;
    },
    showReplay: startReplay,
    replayAgain() { if (replay) { replay.i = 0; replay.t = 0; replay.caption = -1; replay.ft = replay.steps[0].from; } },
    continue: end,
    dispose() { events.length = 0; },
  };
}
