/**
 * Wiring only: boot, screens (preview -> run -> analysis), settings, the fixed-step loop and lifecycle.
 * The run's own state machine lives in run.js; everything drawn per frame in render.js; buttons and keys in
 * controls.js (onto the `app` commands below); pure rules in ui.js.
 *
 * URL hash (ui.parseHash): #seed=abc&cars=<traffic seed>&tier=easy[&traffic=normal][&tips=guided][&drill=none][&debug=...][&qa=1]
 * (settings at ui.DEFAULTS stay out of the hash)
 * window.__rb is a read-only QA handle, present only with qa=1 or a debug= scenario in the hash.
 */
import * as THREE from 'three';
import { generate } from './gen.js';
import { createSim } from './sim.js';
import { vehicleName } from './judge.js';
import { COLOURS } from './traffic-data.js';
import { createEnvironment, buildWorld } from './world.js';
import { createVehicles } from './vehicles.js';
import { createCockpit } from './cockpit.js';
import { createAudio } from './audio.js';
import { createRun } from './run.js';
import { createView, playerView } from './render.js';
import { createControls } from './controls.js';
import { resolveSettings, hashOf, newSeed, cleanSeed, nextTrafficSeed, within, routeView, storedDrill, COPY, QUALITY } from './ui.js';

window.__rbBoot = true; // the module graph settled: index.html's boot watchdog stands down

const STEP = 1 / 60;
const MAX_STEPS = 8;
const BOOT_TIMEOUT = 20000; // ms any one boot request may take before it is reported
const BASE = new URL('..', import.meta.url).href.replace(/\/$/, '');
const store = { load: (k, d) => window._base.load(k, d), save: (k, v) => window._base.save(k, v) };

// ---------- long-lived parts ----------

const canvas = document.getElementById('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.toneMapping = THREE.NeutralToneMapping;
renderer.info.autoReset = false;
const scene = new THREE.Scene();
const env = createEnvironment(renderer, scene);
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const cockpit = createCockpit({ canvas, reducedMotion });
scene.add(cockpit.group);
const audio = createAudio({ muted: store.load('rb-mute', false) });

// ---------- settings ----------

const STORED = { tier: 'rb-tier', traffic: 'rb-traffic', tips: 'rb-tips-mode', drill: 'rb-drill' };
// cfg: { seed, trafficSeed, tier, traffic, tips, drill, debug, qa }: the session's settings, mirrored in the hash.
const cfg = resolveSettings(Object.fromEntries(Object.entries(STORED).map(([k, key]) => [k, store.load(key, null)])), location.hash);
const tipsShown = store.load('rb-tips-shown', {});

// ---------- state ----------

let screen = 'loading'; // 'preview' | 'run' | 'analysis' (the run carries its own finer states)
let layout = null;
let world = null;
let vehicles = null;
let palette = null;
let preview = null; // { sim, prev, curr, angle }
let run = null;
let statics = [];
let acc = 0;

function writeHash() {
  const h = hashOf(cfg);
  if (location.hash !== h) history.replaceState(null, '', h);
}

function makeLayout() {
  const { tier, seed } = cfg;
  let l = generate(tier, seed);
  if (cfg.debug === 'alongside') {
    // The alongside check needs the player in an inner ring lane: pick an exit that uses one.
    const inner = Object.entries(l.arms[l.player.arm].exits).find(([, e]) => e.lane > 0);
    if (inner) l = generate(tier, seed, { playerArm: l.player.arm, targetArm: Number(inner[0]) });
  }
  return l;
}

function setLayout() {
  if (layout && layout.seed === cfg.seed && layout.tier === cfg.tier) return;
  layout = makeLayout();
  writeHash();
  world?.dispose();
  world = buildWorld(layout, { base: BASE });
  scene.add(world.group);
  world.setTheme(palette);
  vehicles?.setLayout(layout);
  const pc = layout.scenery.parkedCar;
  statics = pc ? [{ id: -1, type: pc.type, colour: 'Blue', colourHex: COLOURS.Blue, x: pc.x, z: pc.z, heading: pc.heading, s: 0, steer: 0 }] : [];
  hud.route(routeView(layout));
  hud.setSeed(cfg.seed);
  const built = world;
  // Scenery after the road and cars are on screen; a failure costs only dressing, so it is reported, not fatal.
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (world === built) built.dress(view.quality).catch((err) => console.error('Scenery', err));
  }));
}

// ---------- screens ----------

function startPreview() {
  endRun();
  screen = 'preview';
  preview = { sim: createSim(layout, { player: false, trafficSeed: cfg.trafficSeed, density: cfg.traffic }), angle: layout.arms[layout.player.arm].bearing + 0.55 };
  preview.prev = preview.curr = preview.sim.snapshot();
  vehicles?.clearGhosts();
  vehicles?.highlight(null);
  world.showRoute(true);
  cockpit.setVisible(false);
  hud.screen('start');
  hud.fade(0);
}

function endRun() {
  run?.dispose();
  run = null;
  view.clear();
  hud.chip(null); // also cancels a caption's hold, which would otherwise clear the next run's first line
  hud.clearToasts();
}

// mode defaults to the Tips setting; See Solution passes 'watch' without changing it.
function startRun(mode = cfg.tips) {
  if (!vehicles) return;
  endRun();
  audio.start();
  preview = null;
  screen = 'run';
  writeHash();
  const { tier, trafficSeed, traffic, drill: preset, debug } = cfg;
  run = createRun({ layout, tier, trafficSeed, traffic, preset, debug, tipsMode: mode, tipsShown, out });
  hud.advice(null);
  acc = 0;
  vehicles.clearGhosts();
  vehicles.highlight(null);
  world.showRoute(false);
  cockpit.setVisible(true);
  cockpit.resetLook();
  hud.screen('run');
  hud.speed(0, layout.arms[layout.player.arm].limitMph);
  hud.fade(1);
  requestAnimationFrame(() => requestAnimationFrame(() => hud.fade(0)));
}

// Which traffic a rerun sees is ui.nextTrafficSeed's rule.
function retry() {
  cfg.trafficSeed = nextTrafficSeed(cfg.trafficSeed, { wasRed: Boolean(run?.wasRed) });
  startRun();
}
function retryAs(mode) {
  cfg.trafficSeed = nextTrafficSeed(cfg.trafficSeed, { mode });
  startRun(mode);
}

function newRoundabout() {
  cfg.seed = newSeed();
  cfg.trafficSeed = newSeed();
  setLayout();
  if (screen === 'preview') startPreview();
  else startRun();
}

// ---------- what a run asks of the screen ----------

const out = {
  act: (label, opts) => hud.act(label, opts),
  advice: (tone) => hud.advice(tone),
  chip: (text, opts) => hud.chip(text, opts),
  toasts: (plan) => hud.toasts(plan, (item) => { if (item.kind === 'err') run?.showReplay(); }),
  clearToasts: () => hud.clearToasts(),
  highlight: (id, opts) => vehicles.highlight(id, opts),
  clearGhosts: () => vehicles.clearGhosts(),
  glance: {
    look: (target, hold) => view.glance.look(target, hold),
    focus: (target, hold, marks) => view.glance.focus(target, hold, marks),
    mirrors: () => cockpit.glanceMirrors(),
  },
  horn: (id) => {
    const v = run.curr.vehicles.find((w) => w.id === id);
    audio.horn(v ? Math.sign(-view.yawTo(v.x, v.z)) : 0);
  },
  // A replay opened from the results lifts their fade and offers Back to them (or Keep Driving, when the run
  // was ended from its freeze).
  replay: (on) => {
    if (on) {
      screen = 'run';
      hud.fade(0);
      hud.replayEnd(run.finished);
      hud.keepDriving(Boolean(run.canKeepDriving));
    }
    hud.screen(on ? 'replay' : 'run');
    world.showRoute(on);
    view.replayView(on);
  },
  ended: (summary) => {
    screen = 'analysis';
    store.save('rb-tips-shown', tipsShown);
    world.showRoute(false);
    cockpit.setVisible(true);
    hud.analysis(summary);
    hud.fade(run.wasRed ? 0.15 : 0.5);
  },
};

// ---------- loop ----------

let last = 0;
let raf = 0;

// The freeze has no out hook, so its bar follows run.state here: up on a red freeze, down when the learner keeps
// driving (the replay and the analysis bring their own screens through out.replay and out.ended).
let freezeKey = null;
function syncFreeze() {
  const key = run ? `${run.state}|${run.canKeepDriving}` : null;
  if (key === freezeKey) return;
  const was = freezeKey?.split('|')[0];
  freezeKey = key;
  if (!run) return;
  if (run.state === 'frozen') hud.screen('frozen');
  else if (was === 'frozen' && run.state !== 'replay' && run.state !== 'analysis') hud.screen('run');
  hud.keepDriving(Boolean(run.canKeepDriving));
}

function loop(now) {
  raf = requestAnimationFrame(loop);
  const rawDt = last ? (now - last) / 1000 : STEP;
  const dt = Math.min(0.1, rawDt);
  last = now;
  const sim = run?.sim ?? preview?.sim;
  const scale = run ? run.tick(dt) : 1;
  if (sim && scale > 0) {
    acc += dt * scale;
    let n = 0;
    while (acc >= STEP && n++ < MAX_STEPS) {
      if (run) run.step(STEP);
      else { preview.sim.step(STEP); preview.prev = preview.curr; preview.curr = preview.sim.snapshot(); }
      acc -= STEP;
    }
    if (n >= MAX_STEPS) acc = 0;
  }
  syncFreeze();
  view.frame(dt, scale > 0 ? acc / STEP : 1);
  // Every frame on every screen, so no state can leave a voice playing: no run or an open sheet is 'idle'.
  audio.update(playerView(run?.curr), run?.curr.vehicles ?? [], run && !hud.openSheet ? run.state : 'idle', scale);
  view.monitor(rawDt);
}

// ---------- lifecycle ----------

function startLoop() { if (!raf) { last = 0; raf = requestAnimationFrame(loop); } }
function stopLoop() { cancelAnimationFrame(raf); raf = 0; }

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { stopLoop(); audio.suspend(); } else { startLoop(); if (screen === 'run') audio.resume(); }
});
// The loop is what drives audio levels, so a stopped loop must silence it; GPU-made content (the PMREM
// environment) comes back empty, so the theme is re-applied to render it again.
canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); stopLoop(); audio.suspend(); });
canvas.addEventListener('webglcontextrestored', () => {
  applyTheme();
  view.setQuality(view.quality);
  startLoop();
  if (screen === 'run' && !document.hidden) audio.resume();
});
for (const target of [window, window.visualViewport].filter(Boolean)) target.addEventListener('resize', () => view.resize());
addEventListener('orientationchange', () => view.resize());

function applyTheme() {
  palette = env.setTheme(document.documentElement.getAttribute('data-theme') || 'light');
  world?.setTheme(palette);
  vehicles?.setTheme(palette);
  cockpit.setTheme(palette); // static mirror glass follows the theme
  // After base.js has written the page colour: the status bar takes the sky's top instead, so it blends in.
  document.querySelector('meta[name="theme-color"]').content = palette.skyTop;
  // The page behind the canvas is the fog colour, so slivers shown while a mobile toolbar collapses match it.
  document.documentElement.style.setProperty('--rb-ground', palette.skyHorizon);
}
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// ---------- commands (controls.js maps buttons and keys onto these) ----------

// A stored setting (STORED key) changed: remember it, show it, put it in the hash.
function setting(key, value) {
  cfg[key] = value;
  store.save(STORED[key], key === 'drill' ? storedDrill(value) : value);
  hud[`set${key[0].toUpperCase()}${key.slice(1)}`](value);
  writeHash();
}

const app = {
  get screen() { return screen; },
  get run() { return run; },
  get view() { return view; },
  get muted() { return audio.muted; },
  start() { if (screen === 'preview') startRun(); },
  retry,
  retryAs,
  newRoundabout,
  preview: startPreview,
  setTier(t) {
    if (t === cfg.tier || (screen !== 'preview' && screen !== 'analysis')) return;
    cfg.seed = newSeed();
    setting('tier', t);
    setLayout();
    startPreview();
  },
  setTraffic(level) {
    setting('traffic', level);
    if (screen === 'preview') startPreview();
  },
  setDrill(drill) {
    setting('drill', drill);
    if (screen === 'preview') startPreview();
  },
  // Like setTier: a new roundabout always starts a fresh preview, so no finished run is left over a new junction.
  setSeed(text) {
    if (screen !== 'preview' && screen !== 'analysis') { hud.setSeed(cfg.seed); return; }
    cfg.seed = cleanSeed(text) ?? newSeed();
    setLayout();
    startPreview();
  },
  setTips: (mode) => setting('tips', mode),
  setSound(on) {
    audio.setMuted(!on);
    store.save('rb-mute', !on);
    hud.setSound(on);
  },
};

const { hud } = createControls(app);

const view = createView({
  canvas, renderer, scene, cockpit, hud, reducedMotion,
  quality: store.load('rb-quality', null) ?? (matchMedia('(pointer: coarse)').matches ? 'medium' : 'high'),
  onQuality: (q) => store.save('rb-quality', q),
  state: () => ({ run, preview, layout, world, vehicles, statics }),
});

// ---------- boot ----------

// Every boot await is bounded (ui.within): a request that never settles becomes the error toast, never a silent "Loading".
async function boot() {
  hud.setTier(cfg.tier);
  hud.setTips(cfg.tips);
  hud.setTraffic(cfg.traffic);
  hud.setDrill(cfg.drill);
  hud.setSound(!audio.muted);
  view.setQuality(view.quality);
  applyTheme();
  setLayout();
  startPreview();
  startLoop();
  const meta = await within(BOOT_TIMEOUT, 'Vehicle data', fetch(`${BASE}/assets/models/meta.json`).then((r) => r.json()));
  vehicles = await within(BOOT_TIMEOUT, 'Vehicle models', createVehicles(scene, { meta, base: BASE }));
  vehicles.setLayout(layout);
  vehicles.setTheme(palette);
  hud.setReady(true);
}

if (cfg.qa || cfg.debug) window.__rb = Object.freeze({
  renderer, scene, cockpit, stats: view.stats, QUALITY,
  act: () => run?.act(),
  get run() { return run; },
  get sim() { return run?.sim ?? preview?.sim; },
  get player() { return run?.player ?? null; },
  get layout() { return layout; },
  get vehicles() { return vehicles; },
  get world() { return world; },
  get screen() { return screen; },
  get mode() { return run ? (run.state === 'analysis' ? 'analysis' : run.state) : screen; },
  get quality() { return view.quality; },
  // QA: pin a tier for a perf pass; lock suspends the auto monitor. Nothing is saved.
  setQuality: (q, { lock = false } = {}) => view.setQuality(q, { lock }),
  get audio() { return audio.qa; },
  name: vehicleName,
});

boot().catch((err) => {
  console.error(err);
  hud.toast(COPY.bootFailed, 'err');
});
