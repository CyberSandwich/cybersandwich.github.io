/**
 * Boot, game loop and run flow. The sim steps at a fixed 60 Hz; rendering interpolates the last two snapshots.
 *
 * Modes: preview (start sheet over an aerial briefing with live traffic) -> run (driver's seat) -> freeze
 * (400 ms slow-motion to a stop on a red verdict) -> frozen -> analysis; ending (fade after a clean exit);
 * replay (explain sheet over the last 5 s, third person).
 *
 * URL hash: #seed=abc&tier=easy[&debug=liar|unsafe|tight|bus|blocked|alongside|clear|early|missed]
 *   Scenarios are injected when the player stops at the line (alongside: once on the ring; clear, early and
 *   missed: no traffic from the start). window.__rb exposes internals for QA only.
 */
import * as THREE from 'three';
import { generate, TIERS } from './gen.js';
import { createSim } from './sim.js';
import { createPlayer } from './player.js';
import { judgeGo, judgeExit, createGapLog, judgeHesitation, missedExit, vehicleName } from './judge.js';
import { entryConflicts } from './kinematics.js';
import { dir, wrapPi, bearingOf, indexAt } from './geom.js';
import { createEnvironment, buildWorld } from './world.js';
import { createVehicles } from './vehicles.js';
import { createCockpit } from './cockpit.js';
import { createHud } from './hud.js';
import { createAudio } from './audio.js';

const STEP = 1 / 60;
const MAX_STEPS = 8;
const FREEZE_SECONDS = 0.4;
const END_AFTER_EXIT = 2.6; // sim s after leaving the ring; the path runs ~80 m further, so the car never stops
const MAX_LAPS = 3;
const TIERS_ORDER = ['mini', 'easy', 'medium', 'hard'];
const QUALITY = ['low', 'medium', 'high'];
const RED = new Set(['unsafe', 'notAllowed', 'early', 'alongside']);
const TITLES = {
  ok: 'Clean Run', tight: 'Tight Gap', unsafe: 'Unsafe Go', notAllowed: 'Not Allowed', early: 'Early Exit Signal',
  alongside: 'Car Alongside', late: 'Missed Exit', hesitation: 'Hesitation',
};
const BASE = new URL('..', import.meta.url).href.replace(/\/$/, '');
const store = { load: (k, d) => window._base.load(k, d), save: (k, v) => window._base.save(k, v) };
const capital = (s) => s.replace(/\b\w/g, (c) => c.toUpperCase());
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;

// ---------- renderer ----------

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const env = createEnvironment(renderer, scene);
const cockpit = createCockpit({ canvas, reducedMotion });
scene.add(cockpit.group);
const aerial = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
const audio = createAudio({ muted: store.load('rb-mute', false) });

let quality = store.load('rb-quality', null) ?? (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high');
function applyQuality() {
  const cap = { low: 1, medium: 1.25, high: 1.5 }[quality];
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, cap));
  cockpit.setQuality(quality);
  resize();
}

function resize() {
  const w = innerWidth;
  const h = innerHeight;
  renderer.setSize(w, h, false);
  cockpit.setAspect(w / h);
  aerial.aspect = w / h;
  aerial.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / Math.min(1, w / h))), 45, 75);
  aerial.updateProjectionMatrix();
}

// ---------- state ----------

const params = new URLSearchParams(location.hash.slice(1));
const debug = params.get('debug');
let tier = TIERS[params.get('tier')] ? params.get('tier') : store.load('rb-tier', 'easy');
if (!TIERS[tier]) tier = 'easy';
if ((debug === 'bus' || debug === 'alongside') && (tier === 'mini' || tier === 'easy')) tier = 'medium';
let seed = params.get('seed') || newSeed();
let tipsOn = store.load('rb-tips', true);

let mode = 'loading';
let layout = null;
let world = null;
let vehicles = null;
let sim = null;
let player = null;
let log = null;
let prev = null;
let curr = null;
let acc = 0;
let timeScale = 1;
let frame = 0;
let run = null; // per-run record
let replay = null;
let statics = [];
let pendingEvents = [];
let previewAngle = 0;

function newSeed() { return Math.random().toString(36).slice(2, 8); }

function writeHash() {
  const h = `#seed=${encodeURIComponent(seed)}&tier=${tier}${debug ? `&debug=${debug}` : ''}`;
  if (location.hash !== h) history.replaceState(null, '', h);
}

function makeLayout() {
  let l = generate(tier, seed);
  if (debug === 'alongside') {
    // The alongside check needs the player in an inner ring lane: pick an exit that uses one.
    const arm = l.arms[l.player.arm];
    const inner = Object.entries(arm.exits).find(([, e]) => e.lane > 0);
    if (inner) l = generate(tier, seed, { playerArm: l.player.arm, targetArm: Number(inner[0]) });
  }
  return l;
}

// ---------- streaks ----------

function streakOf(t) { return store.load('rb-streak', {})[t] ?? { cur: 0, best: 0 }; }
function streakText(t) {
  const s = streakOf(t);
  return s.best ? `Streak ${s.cur} (Best ${s.best})` : '';
}
function recordStreak(clean) {
  const all = store.load('rb-streak', {});
  const s = all[tier] ?? { cur: 0, best: 0 };
  s.cur = clean ? s.cur + 1 : 0;
  s.best = Math.max(s.best, s.cur);
  all[tier] = s;
  store.save('rb-streak', all);
  return s;
}

// ---------- scene setup ----------

function setLayout() {
  if (layout && layout.seed === seed && layout.tier === tier) return;
  layout = makeLayout();
  writeHash();
  world?.dispose();
  world = buildWorld(layout, { base: BASE });
  scene.add(world.group);
  world.setTheme(palette);
  vehicles?.setLayout(layout);
  const pc = layout.scenery.parkedCar;
  statics = pc ? [{ id: -1, type: pc.type, colour: 'Blue', colourHex: '#2a4f8f', x: pc.x, z: pc.z, heading: pc.heading, s: 0, steer: 0 }] : [];
  hud.route(layout);
  hud.setStreak(streakText(tier));
  hud.setSeed(seed);
  const built = world;
  // Scenery after the road and cars are on screen.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (world === built) built.dress(quality);
  }));
}

function startPreview() {
  mode = 'preview';
  sim = createSim(layout, { player: false });
  player = null;
  prev = curr = sim.snapshot();
  vehicles?.clearGhosts();
  vehicles?.highlight(null);
  world.showRoute(true);
  cockpit.setVisible(false);
  const arm = layout.arms[layout.player.arm];
  previewAngle = arm.bearing + 0.55;
  timeScale = 1;
  hud.mode('start');
  hud.fade(0);
}

function startRun() {
  audio.start();
  sim = createSim(layout);
  log = createGapLog(layout);
  run = { go: null, exit: null, laps: 0, endAt: null, red: null, tipShown: 0, exitWindows: 0, frozenAt: null };
  player = createPlayer(sim, { onEvent: (name, e) => pendingEvents.push(e) });
  pendingEvents = [];
  prev = curr = sim.snapshot();
  acc = 0;
  timeScale = 1;
  vehicles.clearGhosts();
  vehicles.highlight(null);
  world.showRoute(false);
  cockpit.setVisible(true);
  cockpit.resetLook();
  hud.mode('run');
  hud.act('Go', false);
  if (debug === 'clear' || debug === 'early' || debug === 'missed') sim.debug.scenario('clear');
  mode = 'run';
  store.save('rb-runs', store.load('rb-runs', 0) + 1);
  // Cut in from the briefing through the page colour.
  hud.fade(1);
  requestAnimationFrame(() => requestAnimationFrame(() => hud.fade(0)));
}

// ---------- decisions ----------

const playerView = (snap) => snap?.vehicles.find((v) => v.isPlayer) ?? null;

// Yaw (radians, + = left) from the player to a world point, for automatic glances.
function yawTo(x, z) {
  const me = playerView(curr);
  if (!me) return 0;
  return wrapPi(me.heading - bearingOf(x - me.x, z - me.z));
}

// Where circulating traffic comes from: a point on the ring about 25 m upstream of the player's merge.
function rightGlance() {
  const path = sim.player.path;
  const bm = path.bearing[indexAt(path, path.marks.merge)];
  const r = layout.circulatory.laneRadii[0];
  const p = dir(bm - Math.min(1.3, 25 / r));
  return THREE.MathUtils.clamp(yawTo(p[0] * r, p[1] * r) * 0.85, -1.75, -0.35);
}

function act() {
  if (mode !== 'run' || !player) return;
  const phase = player.phase;
  if ((phase === 'approach' || phase === 'waiting') && player.goWindowOpen) {
    const v = judgeGo(sim.state(), { windowOpen: true });
    log.goTapped(sim.t);
    run.go = v;
    player.go();
    cockpit.rest(null);
    hud.act('Exit', false);
    hud.tip(null);
    if (RED.has(v.verdict)) freeze(v);
    else if (v.verdict === 'tight') hud.toast(v.reason, 'warn');
  } else if (phase === 'ring' && player.exitWindowOpen) {
    const v = judgeExit(sim.state());
    if (v.verdict === 'ok') {
      run.exit = v;
      player.exit();
      hud.act('Exit', false);
    } else if (v.verdict === 'late') {
      player.goRoundAgain();
    } else {
      run.exit = v;
      freeze(v);
    }
  }
}

function freeze(v) {
  run.red = v;
  mode = 'freeze';
  run.frozenAt = 0;
  vehicles.highlight(v.culpritId);
  const culprit = curr.vehicles.find((w) => w.id === v.culpritId);
  if (culprit) cockpit.look(THREE.MathUtils.clamp(yawTo(culprit.x, culprit.z), -2, 2), 0, 4);
  hud.act(player.phase === 'ring' || player.phase === 'leaving' ? 'Exit' : 'Go', false);
  hud.toast(v.reason, 'err', () => openExplain());
}

function handleEvent(e) {
  switch (e.name) {
    case 'goWindowOpen':
      log.windowOpened(e.t);
      hud.act('Go', true);
      break;
    case 'atLine':
      cockpit.rest(rightGlance());
      if (debug && ['liar', 'unsafe', 'tight', 'bus', 'blocked'].includes(debug)) {
        sim.debug.scenario(debug);
        vehicles.clearGhosts();
      }
      break;
    case 'entered':
      cockpit.rest(null);
      break;
    case 'exitWindowOpen':
      hud.act('Exit', true);
      if (debug === 'alongside' && run.exitWindows === 0) sim.debug.scenario('alongside');
      run.exitWindows++;
      break;
    case 'missedExit':
      run.laps++;
      if (run.laps >= MAX_LAPS) endRun();
      else hud.toast(missedExit().reason, 'warn');
      break;
    case 'mirrorGlance':
      cockpit.glanceMirrors();
      break;
    case 'exited':
      run.endAt = sim.t + END_AFTER_EXIT;
      break;
    default:
  }
}

// One tip at most, for the first few runs: the cue that matters most right now.
function updateTip() {
  if (!tipsOn || store.load('rb-runs', 0) > 5 || !player.goWindowOpen || !['approach', 'waiting'].includes(player.phase)) return;
  const state = sim.state();
  const me = state.vehicles.find((v) => v.isPlayer);
  const bm = me.path.bearing[indexAt(me.path, me.path.marks.merge)];
  let text = null;
  for (const w of state.vehicles) {
    if (w.isPlayer || !w.inRing) continue;
    const up = wrapPi(bm - w.bearing);
    if (up < 0 || up > 1.6) continue;
    if (w.indicator === 'left' && entryConflicts(me.path, w.path).length) { text = 'Watch Front Wheels'; break; }
    if ((w.type === 'bus' || w.type === 'lorry') && layout.circulatory.lanes > 1) text = 'Give Long Vehicles Room';
  }
  if (text !== run.tip) {
    run.tip = text;
    hud.tip(text);
  }
}

function endRun() {
  if (mode === 'analysis') return;
  mode = 'ending';
  hud.tip(null);
  hud.fade(0.5);
  setTimeout(showAnalysis, 450);
}

function verdictWord(v) {
  if (!v) return 'Not Taken';
  return { ok: 'Safe', tight: 'Tight', unsafe: 'Unsafe', notAllowed: 'Not Allowed' }[v.verdict] ?? capital(v.verdict);
}

function showAnalysis() {
  mode = 'analysis';
  run.analysis ??= analysisOf();
  hud.analysis(run.analysis);
  hud.fade(run.red ? 0.15 : 0.5);
}

// Computed once per run: it also records the streak.
function analysisOf() {
  const summary = log.summary();
  const hes = judgeHesitation(summary);
  const red = run.red;
  const missed = run.laps >= MAX_LAPS;
  const main = red ?? (missed ? missedExit() : run.go?.verdict === 'tight' ? run.go : hes.verdict !== 'ok' ? hes : run.laps ? missedExit() : { verdict: 'ok', reason: '' });
  const clean = !red && !missed && run.laps === 0 && hes.verdict === 'ok' && run.go?.verdict === 'ok' && run.exit?.verdict === 'ok';
  const streak = recordStreak(clean);

  const taken = summary.gaps.find((g) => g.taken);
  const signal = (c) => (c.indicator === 'left' ? 'Signal Left' : c.indicator === 'right' ? 'Signal Right' : 'No Signal');
  const cars = summary.cars.slice(-6).map((c) => ({
    name: capital(c.name),
    value: `${signal(c)}, ${c.comingRound ? 'Came Round' : 'Turned Off'}${c.misleading ? ' (Misleading)' : ''}`,
  }));
  const exitWord = run.exit
    ? ({ ok: 'On Time', early: 'Too Early', alongside: 'Car Alongside' }[run.exit.verdict] ?? capital(run.exit.verdict))
    : run.laps ? `Missed (${run.laps} ${run.laps === 1 ? 'Lap' : 'Laps'})` : 'Not Reached';
  const decisions = [
    ['Go', verdictWord(run.go)],
    ['Waiting', hes.verdict === 'ok' ? 'Fine' : `Hesitant (${summary.missedClear} Clear Gaps)`],
    ['Exit', run.laps && run.exit?.verdict === 'ok' ? `On Time After ${run.laps} ${run.laps === 1 ? 'Lap' : 'Laps'}` : exitWord],
    ['Streak', `${streak.cur} (Best ${streak.best})`],
  ];
  return {
    title: TITLES[main.verdict] ?? 'Run Complete',
    reason: main.reason,
    explain: !!red && !!run.replay,
    gaps: summary.gaps.length ? { gaps: summary.gaps, start: summary.gaps[0].start, end: summary.end ?? summary.gaps[summary.gaps.length - 1].end } : null,
    reactText: taken ? `Gap Taken After ${taken.reaction.toFixed(1)} s` : '',
    cars,
    decisions,
  };
}

function openExplain() {
  if (!run?.red || !run.replay) return;
  if (mode === 'freeze') return;
  mode = 'replay';
  hud.fade(0);
  hud.explain(run.red, TITLES[run.red.verdict]);
  replay = { t: 0, frames: run.replay, cam: null };
}

function closeExplain() {
  replay = null;
  mode = 'analysis';
  showAnalysis();
}

// ---------- loop ----------

function stepOnce() {
  if (player) {
    player.update();
    if (player.goWindowOpen && player.phase !== 'ring') log.record(sim.state());
  }
  sim.step(STEP);
  prev = curr;
  curr = sim.snapshot();
  if (player) {
    const events = pendingEvents;
    pendingEvents = [];
    for (const e of events) handleEvent(e);
    if (mode === 'run' && frame % 15 === 0) updateTip();
    if (run?.endAt !== null && sim.t >= run.endAt && mode === 'run') endRun();
  }
}

let last = 0;
let raf = 0;
let fpsWindow = { t: 0, n: 0, since: 0 };
const stats = { calls: 0, triangles: 0, mainCalls: 0, mainTriangles: 0, fps: 0 };

function loop(now) {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(0.1, last ? (now - last) / 1000 : STEP);
  last = now;
  frame++;

  if (mode === 'freeze') {
    run.frozenAt += dt;
    const k = Math.min(1, run.frozenAt / FREEZE_SECONDS);
    timeScale = (1 - k) ** 2;
    if (k >= 1) {
      mode = 'frozen';
      timeScale = 0;
      run.replay = sim.replay();
      setTimeout(() => { if (mode === 'frozen') showAnalysis(); }, 2000);
    }
  }
  const stepping = mode === 'preview' || mode === 'run' || mode === 'freeze' || mode === 'ending';
  if (stepping && sim) {
    acc += dt * timeScale;
    let n = 0;
    while (acc >= STEP && n++ < MAX_STEPS) {
      stepOnce();
      acc -= STEP;
    }
    if (n >= MAX_STEPS) acc = 0;
  }
  const alpha = stepping ? acc / STEP : 1;

  let camera;
  if (mode === 'replay' && replay) {
    camera = renderReplay(dt);
  } else {
    vehicles?.update(prev, curr, alpha, { dt: dt * timeScale, statics });
    if (mode === 'preview' || mode === 'loading') {
      camera = aerial;
      orbit(dt);
    } else {
      camera = cockpit.camera;
      const me = interpolatedPlayer(alpha);
      cockpit.update(me, dt);
      audio.update(mode === 'run' ? me : null, curr?.vehicles ?? []);
    }
  }
  if (vehicles) vehicles.lampUniforms.uPxWorld.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, innerHeight);

  renderer.info.reset();
  if (camera === cockpit.camera) cockpit.renderMirrors(renderer, scene, frame);
  const c0 = renderer.info.render.calls;
  const t0 = renderer.info.render.triangles;
  renderer.render(scene, camera);
  stats.calls = renderer.info.render.calls;
  stats.triangles = renderer.info.render.triangles;
  stats.mainCalls = stats.calls - c0;
  stats.mainTriangles = stats.triangles - t0;
  monitor(dt);
}

function interpolatedPlayer(alpha) {
  const a = playerView(prev);
  const b = playerView(curr);
  if (!a || !b) return b;
  return { ...b, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, heading: a.heading + wrapPi(b.heading - a.heading) * alpha, steer: a.steer + (b.steer - a.steer) * alpha, speed: a.speed + (b.speed - a.speed) * alpha };
}

function orbit(dt) {
  if (!layout) return;
  if (!reducedMotion) previewAngle += dt * 0.035;
  const R = layout.outerRadius;
  const dist = R * 1.5 + 34;
  const d = dir(previewAngle);
  aerial.position.set(d[0] * dist, R * 0.75 + 24, d[1] * dist);
  aerial.lookAt(0, 0, 0);
}

function renderReplay(dt) {
  const frames = replay.frames;
  const span = (frames.length - 1) / 30;
  replay.t += dt;
  if (replay.t > span + 1.2) replay.t = 0;
  const f = Math.min(frames.length - 1, replay.t * 30);
  const i = Math.min(frames.length - 2, Math.floor(f));
  const a = frames[Math.max(0, i)];
  const b = frames[Math.max(0, i + 1)];
  vehicles.update(a, b, f - i, { showPlayer: true, ghosts: false, statics });
  const me = playerView(b);
  const culprit = b.vehicles.find((v) => v.id === run.red.culpritId);
  if (me) {
    const fwd = dir(me.heading);
    const look = culprit ? new THREE.Vector3((me.x + culprit.x) / 2, 0.5, (me.z + culprit.z) / 2) : new THREE.Vector3(me.x + fwd[0] * 8, 0.5, me.z + fwd[1] * 8);
    const pos = new THREE.Vector3(me.x - fwd[0] * 15, 10, me.z - fwd[1] * 15);
    if (!replay.cam) replay.cam = { pos: pos.clone(), look: look.clone() };
    replay.cam.pos.lerp(pos, Math.min(1, dt * 3));
    replay.cam.look.lerp(look, Math.min(1, dt * 3));
    aerial.position.copy(replay.cam.pos);
    aerial.lookAt(replay.cam.look);
  }
  return aerial;
}

// Quality: sampled over 2 s windows; below ~45 fps the tier steps down (never up on its own).
function monitor(dt) {
  if (document.hidden) return;
  fpsWindow.t += dt;
  fpsWindow.n++;
  fpsWindow.since += dt;
  if (fpsWindow.t < 2) return;
  stats.fps = fpsWindow.n / fpsWindow.t;
  if (stats.fps < 45 && fpsWindow.since > 4 && quality !== 'low') {
    quality = QUALITY[QUALITY.indexOf(quality) - 1];
    store.save('rb-quality', quality);
    applyQuality();
    fpsWindow.since = 0;
  }
  fpsWindow.t = 0;
  fpsWindow.n = 0;
}

// ---------- lifecycle ----------

function startLoop() {
  if (raf) return;
  last = 0;
  raf = requestAnimationFrame(loop);
}
function stopLoop() {
  cancelAnimationFrame(raf);
  raf = 0;
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopLoop(); audio.suspend(); }
  else { startLoop(); if (mode === 'run') audio.resume(); }
});
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); });
canvas.addEventListener('webglcontextrestored', () => { applyQuality(); startLoop(); });
addEventListener('resize', resize);
addEventListener('orientationchange', resize);

let palette;
function applyTheme() {
  palette = env.setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  world?.setTheme(palette);
  vehicles?.setTheme(palette);
}
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

const hud = createHud({
  onTier(t) {
    if (mode !== 'preview' || t === tier) return;
    tier = t;
    store.save('rb-tier', t);
    seed = newSeed();
    hud.setTier(t);
    setLayout();
    startPreview();
  },
  onStart() { if (mode === 'preview') startRun(); },
  onAct: act,
  onRetry() { setLayout(); startRun(); },
  onNew() { seed = newSeed(); setLayout(); startRun(); },
  onChangeTier() { startPreview(); },
  onExplain: openExplain,
  onExplainDone: closeExplain,
  onReplay() { if (replay) { replay.t = 0; replay.cam = null; } },
  onMute() {
    const muted = !audio.muted;
    audio.setMuted(muted);
    store.save('rb-mute', muted);
    hud.setSound(!muted);
  },
  onSound(on) { audio.setMuted(!on); store.save('rb-mute', !on); hud.setSound(on); },
  onTips(on) { tipsOn = on; store.save('rb-tips', on); hud.setTips(on); },
  onSeed(s) {
    if (!s || s === seed || mode !== 'preview') return;
    seed = s;
    setLayout();
    startPreview();
  },
});

window._base.onKey({
  ' ': (e) => { e.preventDefault(); if (mode === 'preview') startRun(); else act(); },
  ArrowLeft: () => cockpit.nudge(0.35),
  ArrowRight: () => cockpit.nudge(-0.35),
});

async function boot() {
  hud.setTier(tier);
  hud.setTips(tipsOn);
  hud.setSound(!audio.muted);
  applyQuality();
  applyTheme();
  await setLayout();
  startPreview();
  startLoop();
  const meta = await fetch(`${BASE}/assets/models/meta.json`).then((r) => r.json());
  vehicles = await createVehicles(scene, { meta, base: BASE });
  vehicles.setLayout(layout);
  vehicles.setTheme(palette);
  hud.setReady(true);
}

window.__rb = {
  renderer, scene, cockpit, stats, act,
  get sim() { return sim; },
  get player() { return player; },
  get layout() { return layout; },
  get vehicles() { return vehicles; },
  get world() { return world; },
  get mode() { return mode; },
  get quality() { return quality; },
  setQuality(q) { quality = q; applyQuality(); },
  name: vehicleName,
};

boot().catch((err) => {
  console.error(err);
  hud.toast('Could Not Load the Roundabout', 'err');
});
