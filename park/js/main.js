/**
 * Page state, input and the frame loop. Geometry lives in polo, lot and plan; drawing in scene.
 */
import { BODY, step, centrePos } from './polo.js';
import { makeLot } from './lot.js';
import { preset, traceFrom, turnPoint, liveCue, inBay, goal, autoRoute } from './plan.js';
import { createScene } from './scene.js';

const KEY = 'park:state';
const DEFAULTS = { mode: 'reverse', side: 'left', lane: 'left', bay: 4, trace: true, turn: false };
const SPEED = 1.2; // m/s, walking pace
const ACCEL = 2.5; // m/s^2 to and from SPEED
const STEER_RATE = 2; // lock fractions per second: straight to full lock in half a second
const KEY_STEER_RATE = 1.2;
const SNAP = 5; // slider units either side of centre that read as straight
const CREEP = 0.05; // m/s: Park for Me never slows below this, so each leg ends

const $ = (id) => document.getElementById(id);
const saved = _base.load(KEY, {});
const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULTS)) };

const view = createScene($('gl'));
const lot = makeLot();
cfg.bay = Math.max(0, Math.min(lot.nBays - 1, cfg.bay));
let pose, steer = 0, steerTarget = 0, v = 0, travelled = 0, dirty = true, frameDirty = true;
let auto = null; // Park for Me: { segs, i, done } while it drives
const held = { drive: 0 };

function save() { _base.save(KEY, cfg); }

function reset() {
  stopAuto();
  pose = preset(lot, cfg);
  steer = steerTarget = 0;
  v = 0;
  dirty = true;
}

// ---------- the view: fit the manoeuvre into the space the panels leave ----------
function fit(instant) {
  const p0 = preset(lot, cfg);
  const tp = turnPoint(lot, cfg, p0.y);
  const xs = [p0.x + BODY.REAR, p0.x + BODY.FRONT, lot.bayX(cfg.bay) - lot.pitch, lot.bayX(cfg.bay) + lot.pitch];
  if (tp.ok) xs.push(tp.start.x + BODY.REAR, tp.start.x + BODY.FRONT);
  const focus = { x0: Math.min(...xs) - 1, x1: Math.max(...xs) + 1, y0: lot.backY(-1) - 1, y1: lot.backY(1) + 1 };
  const edge = 14, top = $('preset').getBoundingClientRect(), bar = $('bar').getBoundingClientRect();
  const tools = document.querySelector('.tools').getBoundingClientRect();
  const free = { l: edge, r: Math.min(innerWidth - edge, tools.left - 8), t: top.bottom + 52, b: bar.top - 8 };
  view.topView(instant, focus, free);
}

// ---------- segmented controls ----------
function bindSeg(id, key) {
  const row = $(id);
  const paint = () => row.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', b.dataset.v === cfg[key]));
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    cfg[key] = b.dataset.v;
    paint();
    save();
    reset();
    fit(false);
  });
  paint();
  return paint;
}
bindSeg('mode-seg', 'mode');
const paintSides = bindSeg('side-seg', 'side');
bindSeg('lane-seg', 'lane');

function bindToggle(id, key) {
  const b = $(id);
  const paint = () => b.classList.toggle('on', cfg[key]);
  const toggle = () => { cfg[key] = !cfg[key]; paint(); save(); dirty = true; };
  b.addEventListener('click', toggle);
  paint();
  return toggle;
}
const toggleTrace = bindToggle('trace-btn', 'trace');
const toggleTurn = bindToggle('turn-btn', 'turn');
$('top-btn').addEventListener('click', () => fit(false));
$('reset-btn').addEventListener('click', reset);

// ---------- steering: the slider, with full lock either side ----------
const slider = $('steer');
const lockL = $('lock-left'), lockR = $('lock-right');
function steerTo(s) { stopAuto(); steerTarget = s; }
// A second press on a lock button straightens up.
lockL.addEventListener('click', () => steerTo(steerTarget === 1 ? 0 : 1));
lockR.addEventListener('click', () => steerTo(steerTarget === -1 ? 0 : -1));
slider.addEventListener('input', () => {
  const n = Number(slider.value);
  steerTo(Math.abs(n) < SNAP ? 0 : -n / 100);
});

function paintSteer() {
  slider.value = String(Math.round(-steerTarget * 100));
  lockL.classList.toggle('on', steerTarget === 1);
  lockR.classList.toggle('on', steerTarget === -1);
}

// ---------- driving: hold to move ----------
function holdButton(btn, dir) {
  const release = () => { if (held.drive === dir) held.drive = 0; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', (e) => {
    stopAuto();
    btn.setPointerCapture(e.pointerId);
    held.drive = dir;
    btn.classList.add('held');
  });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(ev, release);
  btn.addEventListener('contextmenu', (e) => e.preventDefault());
}
holdButton($('fwd-btn'), 1);
holdButton($('back-btn'), -1);

const DRIVE_KEYS = { w: 1, ArrowUp: 1, s: -1, ArrowDown: -1 };
const STEER_KEYS = { a: 1, ArrowLeft: 1, d: -1, ArrowRight: -1 };
const down = new Set();
addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  if (k in DRIVE_KEYS || k in STEER_KEYS) { e.preventDefault(); stopAuto(); down.add(k); }
});
addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; down.delete(k); });
addEventListener('blur', () => { down.clear(); held.drive = 0; });

// ---------- Park for Me ----------
const autoBtn = $('auto-btn');
function stopAuto() {
  if (!auto) return;
  auto = null;
  v = 0;
  autoBtn.classList.remove('on');
}
function startAuto() {
  if (auto) { stopAuto(); return; }
  const route = autoRoute(lot, cfg, pose);
  if (!route) { _base.notify('No Single Sweep Into This Bay', false); return; }
  if (route.start !== pose) { pose = route.start; steer = steerTarget = 0; }
  v = 0;
  auto = { segs: route.segs, i: 0, done: 0 };
  autoBtn.classList.add('on');
  dirty = true;
}
autoBtn.addEventListener('click', startAuto);

_base.onKey({
  q: () => steerTo(1),
  e: () => steerTo(-1),
  c: () => steerTo(0),
  r: reset,
  v: () => fit(false),
  g: toggleTrace,
  p: toggleTurn,
  k: startAuto,
});

// ---------- tap a bay to choose it ----------
let tap = null;
const canvas = $('gl');
canvas.addEventListener('pointerdown', (e) => { tap = { x: e.clientX, y: e.clientY, t: performance.now() }; });
canvas.addEventListener('pointerup', (e) => {
  if (!tap || Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 6 || performance.now() - tap.t > 450) return;
  const p = view.pick(e.clientX, e.clientY);
  const b = p && lot.bayAt(p[0], p[1]);
  if (!b) return;
  cfg.bay = b.i;
  cfg.side = b.s > 0 ? 'left' : 'right';
  paintSides();
  save();
  reset();
  fit(false);
});

// ---------- the live cue ----------
const cue = $('cue');
function setCue(text) {
  cue.hidden = !text;
  if (text && cue.textContent !== text) cue.textContent = text;
}

/** Everything derived from the pose and settings: trace, ghosts, highlights and the cue. */
function derive() {
  const g = goal(cfg);
  view.setTrace(cfg.trace ? traceFrom(lot, cfg, pose).poses : null);
  const live = liveCue(lot, cfg, pose);
  let text = live.state === 'ahead' ? `Full Lock in ${live.dist.toFixed(1)} m`
    : live.state === 'now' ? 'Lock Now'
      : live.state === 'past' ? `${(-live.dist).toFixed(1)} m Past the Turn Point`
        : live.state === 'noSweep' ? 'No Single Sweep From This Lane' : null;

  // The turn point for the car's own lane while it is still square to the aisle, else the preset lane's.
  const tp = cfg.turn ? (live.tp || turnPoint(lot, cfg)) : null;
  view.setGhosts(tp && tp.ok ? [tp.start, tp.end] : null);

  const bad = [];
  const c = centrePos(pose);
  const inTarget = lot.bayAt(c[0], c[1]);
  if (inTarget && inTarget.s === g.s && inTarget.i === cfg.bay && v === 0) {
    const r = inBay(lot, g.s, cfg.bay, pose);
    if (r.over.near > 0) bad.push({ s: g.s, i: cfg.bay });
    if (r.over.far > 0) bad.push({ s: g.s, i: cfg.bay + 1 });
    if (r.over.back > 0) bad.push({ s: g.s, back: true });
    if (r.ok) text = 'In the Bay';
  }
  view.setHighlights({ target: { s: g.s, i: cfg.bay }, bad });
  setCue(text);
}

// ---------- loop ----------
/** Turns the wheel toward steerTarget at STEER_RATE; returns whether it moved. */
function turnWheel(dt) {
  const ds = steerTarget - steer;
  if (ds) steer = Math.abs(ds) <= STEER_RATE * dt ? steerTarget : steer + Math.sign(ds) * STEER_RATE * dt;
  return ds !== 0;
}

/** One frame of Park for Me: each leg sets the wheel at a standstill, then drives its length and stops on it. */
function autoFrame(dt) {
  const seg = auto.segs[auto.i];
  if (!seg) { stopAuto(); return true; }
  steerTarget = seg.steer;
  if (turnWheel(dt)) return true;
  const rem = seg.len - auto.done;
  if (rem <= 1e-9) { auto.i++; auto.done = 0; v = 0; return true; }
  const speed = Math.max(CREEP, Math.min(SPEED, Math.abs(v) + ACCEL * dt, Math.sqrt(2 * ACCEL * rem)));
  const move = Math.min(rem, speed * dt);
  pose = step(pose, steer, seg.dir * move);
  travelled += seg.dir * move;
  auto.done += move;
  v = seg.dir * speed;
  return true;
}

function manualFrame(dt) {
  const keyDrive = [...down].reduce((a, k) => a + (DRIVE_KEYS[k] || 0), 0);
  const keySteer = [...down].reduce((a, k) => a + (STEER_KEYS[k] || 0), 0);
  if (keySteer) steerTarget = Math.max(-1, Math.min(1, steerTarget + keySteer * KEY_STEER_RATE * dt));
  const want = (held.drive || Math.sign(keyDrive)) * SPEED;
  const dv = want - v;
  const wasMoving = v !== 0;
  v = Math.abs(dv) <= ACCEL * dt ? want : v + Math.sign(dv) * ACCEL * dt;
  const turned = turnWheel(dt);
  if (v !== 0) {
    pose = step(pose, steer, v * dt);
    travelled += v * dt;
  }
  // The stopping frame must derive too: the parked check only runs at v === 0.
  return v !== 0 || wasMoving || turned;
}

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (auto ? autoFrame(dt) : manualFrame(dt)) dirty = true;
  if (dirty) {
    derive();
    view.setCar(pose, steer, travelled);
    paintSteer();
    dirty = false;
    frameDirty = true;
  }
  view.render(now, frameDirty);
  frameDirty = false;
  requestAnimationFrame(frame);
}

function applyTheme() { view.setTheme(); frameDirty = true; }
new MutationObserver(applyTheme).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

// The cue sits under the preset panel and the tools above the bar, whatever their heights.
const root = document.documentElement.style;
const presetEl = $('preset'), bar = $('bar');
new ResizeObserver(() => {
  root.setProperty('--top-h', `${presetEl.getBoundingClientRect().bottom}px`);
  root.setProperty('--bar-h', `${bar.offsetHeight}px`);
}).observe(presetEl);
new ResizeObserver(() => root.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);
function onResize() { view.resize(); fit(true); frameDirty = true; }
addEventListener('resize', onResize);

applyTheme();
view.setLot(lot);
reset();
onResize();
view.ready.then(() => { dirty = true; }, () => _base.notify('Could Not Load the Car', false));
requestAnimationFrame(frame);
window.__pkBoot = true;
// Browser QA only (tests/park-qa.mjs): a page opened with #qa exposes its state.
if (location.hash === '#qa') {
  window.__pk = {
    cfg, lot: () => lot, ready: view.ready,
    get pose() { return pose; },
    set pose(p) { pose = p; dirty = true; },
    setSteer(s) { steer = steerTarget = s; dirty = true; },
    get v() { return v; },
    get auto() { return !!auto; },
  };
}
