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
 *   run.sim  run.player  run.me  run.prev  run.curr  run.focus  run.culpritId  run.replayFrame()  run.togglePause()
 *   run.replayAgain()  run.continue()  run.showReplay()
 *   run.keepDriving()       from the freeze or its replay: unfreeze and carry on from the frozen moment; run.canKeepDriving
 *                           says when it applies. The first red verdict stays the run's recorded one; a later red freezes again.
 *
 * tipsMode: 'off' | 'tips' | 'guided' (learner taps, guide advises) | 'watch' (guide taps).
 * out: { act(label, opts), advice(tone | null), chip(text, opts), toasts(plan), clearToasts(), highlight(id, opts), clearGhosts(),
 *   glance: { look(target, hold), focus(target, hold?, { sign, arrows }), mirrors() }, replay(on), horn(culpritId), ended(view) }
 *   focus marks: sign = layout.signs index to pulse, arrows = arm whose lane arrows pulse (null for none).
 *   clearToasts() only when the run ends: a freeze, its replay or Keep Driving clears the hint (chip(null)), never
 *   a verdict toast, which keeps its full time on screen.
 *   target = { id } (a vehicle) or { x, z } (a world point). look() is the fixed freeze glance; focus() is guide
 *   focus, which the cab's head-look scheduler yields to. The scan itself is the cab's (cockpit.setDrive, main).
 */
import { createSim } from './sim.js';
import { createPlayer } from './player.js';
import { judgeGo, judgeExit, createGapLog, judgeHesitation, previousExitS, vehicleName, missedExit } from './judge.js';
import { createGuide } from './guide.js';
import { entryConflicts } from './kinematics.js';
import { wrapPi, indexAt } from './geom.js';
import { LARGE_TYPES, PRESETS } from './traffic-data.js';
import { RED, COPY, toastPlan, tipFor, analysisView, directorSteps, adviceTone, adviceFocus } from './ui.js';

const FREEZE_SECONDS = 0.4;
const REPLAY_AFTER = 1.2; // s frozen before "What Went Wrong" starts on its own
const END_AFTER_EXIT = 2.6; // sim s after leaving the ring; the path runs ~80 m further, so the car never stops
const MAX_LAPS = 3;
const CUE_SLOW_SCALE = 0.25; // time scale at the bottom of a guide 'slow' cue
const CUE_SLOW_EASE = 0.3; // s to ease into and out of it, so speed never jumps
const TIP_EVERY = 15; // steps between tip checks
const UPSTREAM = 1.6; // rad of ring upstream of the player's merge that counts for tips
const GO_SCENARIOS = ['liar', 'unsafe', 'tight', 'bus', 'blocked', 'shield'];
const EMPTY_SCENARIOS = ['clear', 'early', 'missed'];
const LIVE = new Set(['approach', 'atLine', 'onRing', 'exited']); // states in which player events still count
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

  // rec.show is what "What Went Wrong" replays: the red verdict, else the first amber one with a decision to show.
  const rec = { go: null, exit: null, laps: 0, red: null, show: null, tip: null, alongside: null, goHandled: false };
  let state = 'approach';
  let beforePause = null;
  let endAt = null;
  let frozenFor = 0;
  let slowLeft = 0; // s of a guide 'slow' cue still to run, counted down in tick()
  let slowAge = 0; // s since it began
  let steps = 0;
  let replay = null;
  let finished = false; // end() has run
  let parked = false; // ended from a freeze or its replay: the results' replay can still keep driving
  let resume = null; // { state, exit }: where keepDriving() returns to
  let focus = null;
  let goGate = false;
  let prev = sim.snapshot();
  let curr = prev;

  let stepState = sim.state();
  let mine = stepState.vehicles.find((v) => v.isPlayer);

  // player.goWindowOpen is the one Go gate (first at its own line, queue included); the button mirrors it.
  function setAct() {
    const phase = player.phase;
    const going = phase === 'approach' || phase === 'waiting';
    const inert = watch || (going ? autoGo : !exitDecision);
    if (going) out.act(COPY.act.go, { enabled: player.goWindowOpen, inert });
    else out.act(COPY.act.exit, { enabled: phase === 'ring' && player.exitWindowOpen, inert });
  }

  // ---------- decisions ----------

  function decide() {
    if (state !== 'approach' && state !== 'atLine' && state !== 'onRing') return;
    const phase = player.phase;
    if ((phase === 'approach' || phase === 'waiting') && player.goWindowOpen && !autoGo) {
      const st = sim.state();
      const v = judgeGo(st);
      // The player decides whether a tap counts (first at its own line); a refused tap leaves no trace at all.
      if (!player.go()) return;
      log.goTapped(sim.t, st);
      out.advice(null);
      rec.go = v;
      out.chip(null);
      if (RED.has(v.verdict)) freeze(v, st);
      else if (v.verdict === 'tight') {
        keepForReplay(v, st);
        out.toasts(toastPlan([{ verdict: v, name: nameOf(st, v.culpritId) }]));
      }
      setAct();
    } else if (phase === 'ring' && player.exitWindowOpen && exitDecision) {
      const st = sim.state();
      const v = judgeExit(st);
      out.advice(null);
      if (EXIT_GOES.has(v.verdict)) {
        // A late signal is amber: the car still leaves, the toast says why it was late.
        rec.exit = v;
        player.exit();
        if (v.verdict !== 'ok') {
          keepForReplay(v, st);
          out.toasts(toastPlan([{ verdict: v }]));
        }
      } else if (v.verdict === 'late') player.goRoundAgain();
      else {
        rec.exit = v;
        freeze(v, st);
      }
      setAct();
    }
  }

  // A drill's own Go: it waits for the shared Go assessment to say ok (it never times out into an unsafe or tight
  // Go), and it is neither judged nor logged as the learner's decision.
  function autoTap() {
    if (rec.goHandled || state === 'frozen' || !player.goWindowOpen || judgeGo(stepState).verdict !== 'ok') return;
    if (!player.go()) return;
    rec.goHandled = true;
    out.advice(null);
    out.chip(null);
    setAct();
  }

  const nameOf = (st, id) => {
    const v = id != null && st.vehicles.find((w) => w.id === id);
    return v ? vehicleName(v) : null;
  };

  // An amber verdict is replayable from the analysis, so its lead-up is copied now: the sim's 5 s history
  // would have rolled past it by the time the run ends.
  function keepForReplay(v, st) {
    if (rec.show) return;
    rec.show = { verdict: v, name: nameOf(st, v.culpritId), decisionT: sim.t, frames: sim.replay() };
  }

  // Red verdicts freeze the run. The first stays the run's recorded verdict however many follow after
  // keepDriving(); rec.show is always the latest, which is the one the replay explains.
  function freeze(v, st) {
    const c = v.culpritId != null && st.vehicles.find((w) => w.id === v.culpritId);
    const culprit = c ? { id: c.id, name: vehicleName(c) } : null;
    rec.red ??= v;
    rec.show = { verdict: v, name: culprit?.name ?? null, decisionT: sim.t, frames: null };
    replay = null;
    resume = { state, exit: player.phase === 'ring' };
    beforePause = null;
    state = 'frozen';
    frozenFor = 0;
    out.highlight(v.culpritId, { lamp: true });
    if (c) out.glance.look({ id: c.id }, Infinity);
    if (v.verdict === 'unsafe') out.horn(v.culpritId);
    // Verdict toasts already up stay (they stack under the red one); only the hint gives way.
    out.chip(null);
    out.toasts(toastPlan([{ verdict: v, name: culprit?.name }]));
  }

  // From the freeze or its replay: the learner carries on from the frozen moment. The sim never advanced during
  // the replay or the results (both hold time at 0), so nothing needs restoring; a red Exit goes ahead and leaves.
  // A run ended from its freeze stays parked: See Analysis replays it and can still keep driving. A run that
  // ended on its own (left the ring, missed out) has nothing to resume.
  const canKeepDriving = () => (!finished || parked) && (state === 'frozen' || state === 'replay');

  function keepDriving() {
    if (!canKeepDriving()) return;
    finished = false;
    parked = false;
    if (state === 'replay') out.replay(false);
    replay = null;
    state = resume.state;
    frozenFor = 0;
    slowLeft = 0;
    out.chip(null);
    out.glance.look(null);
    out.highlight(null, {});
    if (resume.exit) player.exit();
    setAct();
  }

  // ---------- events ----------

  function onEvent(e) {
    // The sim keeps stepping through the freeze slow-motion and past end(): those events must not move the state.
    if (!LIVE.has(state)) return;
    switch (e.name) {
      case 'goWindowOpen':
        if (!autoGo) log.windowOpened(e.t);
        break;
      case 'atLine':
        state = 'atLine';
        if (!autoGo) log.atLine(e.t); // hesitation counts only from here
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
        else out.toasts(toastPlan([{ verdict: missedExit() }]));
        break;
      case 'mirrorGlance':
        out.glance.mirrors();
        break;
      case 'exited':
        state = 'exited';
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
        if (slowLeft <= 0) slowAge = 0;
        slowLeft = Math.max(slowLeft, (cue.holdMs ?? 700) / 1000);
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
    const p = mine;
    const bm = p.path.bearing[indexAt(p.path, p.path.marks.merge)];
    const cars = stepState.vehicles.filter((w) => !w.isPlayer && w.inRing).map((w) => {
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
    stepState = sim.state(); // built once per step; player, guide, log, tips and the view's player all read this one
    mine = stepState.vehicles.find((v) => v.isPlayer);
    player.update(stepState);
    // Every step: the log gates itself, and keeps going past the Go tap until the player clears the entry,
    // so the car pulled out in front of is logged.
    if (!autoGo) log.record(stepState);
    if (player.goWindowOpen !== goGate) { goGate = player.goWindowOpen; setAct(); } // the button follows the gate at once
    if (autoGo) autoTap();
    sim.step(dt);
    prev = curr;
    curr = sim.snapshot();
    for (const e of events.splice(0)) onEvent(e);
    // The guide reads the state as it stands after the step: the one a tap before the next step is judged on
    // (decide reads sim.state()), so Guided's light and the verdict on a tap always agree, to the frame.
    if (guide && LIVE.has(state)) {
      for (const cue of guide.update(sim.state(), player.phase)) onCue(cue);
    }
    if (++steps % TIP_EVERY === 0 && (state === 'approach' || state === 'atLine' || state === 'onRing')) {
      setAct();
      tips();
    }
    if (debug === 'alongside' && rec.alongside === null && player.phase === 'ring') {
      // Placed once the player is past the exit before theirs, where an Exit tap is otherwise on time.
      if (mine.s + mine.length / 2 >= previousExitS(layout, mine.path)) rec.alongside = sim.debug.scenario('alongside') ?? -1;
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
    if (slowLeft <= 0) return 1;
    const ramp = Math.min(1, slowAge / CUE_SLOW_EASE, slowLeft / CUE_SLOW_EASE);
    slowAge += dt;
    slowLeft -= dt;
    return 1 - (1 - CUE_SLOW_SCALE) * ramp;
  }

  // ---------- replay ("What Went Wrong") ----------

  const replayStart = (r) => r.steps[0]?.from ?? r.frames[0].t;

  function startReplay() {
    const show = rec.show;
    if (!show || !['frozen', 'replay', 'analysis'].includes(state)) return;
    const frames = replay?.frames ?? show.frames ?? sim.replay();
    if (!frames.length) return;
    replay = { frames, steps: directorSteps({ frames, decisionT: show.decisionT, verdict: show.verdict, culpritName: show.name }), i: 0, t: 0, caption: -1 };
    replay.ft = replayStart(replay);
    state = 'replay';
    out.chip(null);
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
    return { a: frames[i], b: frames[i + 1], alpha: f - i, culpritId: rec.show?.verdict.culpritId ?? null, phase: step?.kind ?? 'end', easing: step?.camera === 'ease' };
  }

  function end() {
    if (state === 'analysis') return;
    parked = canKeepDriving();
    state = 'analysis';
    finished = true;
    replay && out.replay(false);
    out.chip(null);
    out.clearToasts();
    const summary = log.summary();
    const view = analysisView({
      go: rec.go, exit: rec.exit, laps: rec.laps, red: rec.red, summary, hesitation: judgeHesitation(summary),
      replayable: Boolean(rec.show), goHandled: rec.goHandled, maxLaps: MAX_LAPS, mode: tipsMode,
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
    get me() { return mine; }, // the player's state as of the latest step: one build per step, not per read
    get guided() { return guided; },
    get wasRed() { return Boolean(rec.red); },
    get finished() { return finished; }, // the results are (or were last) up: a replay from them goes back to them
    get culpritId() { return rec.show?.verdict.culpritId ?? null; },
    togglePause() {
      if (state === 'paused') { state = beforePause; beforePause = null; return false; }
      if (!['approach', 'atLine', 'onRing', 'exited'].includes(state)) return false;
      beforePause = state;
      state = 'paused';
      return true;
    },
    showReplay: startReplay,
    keepDriving,
    get canKeepDriving() { return canKeepDriving(); },
    replayAgain() { if (replay) { replay.i = 0; replay.t = 0; replay.caption = -1; replay.ft = replayStart(replay); } },
    continue: end,
    dispose() { events.length = 0; },
  };
}
