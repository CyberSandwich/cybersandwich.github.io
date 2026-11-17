/**
 * Page state, input and the frame loop. Geometry lives in polo, lot and plan; drawing in scene.
 */
import { POLO, step, centrePos } from './polo.js';
import { makeLot, AISLES, BAYS } from './lot.js';
import { preset, traceFrom, turnPoint, liveCue, inBay, cueText, goal } from './plan.js';
import { createScene } from './scene.js';

const KEY = 'park:state';
const DEFAULTS = { mode: 'reverse', side: 'left', lane: 'left', bay: 4, aisle: 0, bays: 0, trace: true, turn: false };
const SPEED = 1.2; // m/s, walking pace
const ACCEL = 2.5; // m/s^2 to and from SPEED
const STEER_RATE = 2; // lock fractions per second: straight to full lock in half a second
const KEY_STEER_RATE = 1.2;
const SWING_MIN = 0.05; // m: smaller intrusions are within the line's own width

const $ = (id) => document.getElementById(id);
const saved = _base.load(KEY, {});
const cfg = { ...DEFAULTS, ...Object.fromEntries(Object.entries(saved).filter(([k]) => k in DEFAULTS)) };
cfg.aisle = AISLES[cfg.aisle] ? cfg.aisle : 0;
cfg.bays = BAYS[cfg.bays] ? cfg.bays : 0;

const view = createScene($('gl'));
let lot, pose, steer = 0, steerTarget = 0, v = 0, travelled = 0, dirty = true, frameDirty = true;
const held = { drive: 0 };

function save() { _base.save(KEY, cfg); }

function rebuild() {
  lot = makeLot({ aisle: AISLES[cfg.aisle], ...BAYS[cfg.bays] });
  cfg.bay = Math.max(0, Math.min(lot.nBays - 1, cfg.bay));
  view.setLot(lot);
  reset();
}

function reset() {
  pose = preset(lot, cfg);
  steer = steerTarget = 0;
  v = 0;
  dirty = true;
}

// ---------- segmented controls ----------
function bindSeg(id, key, parse = (s) => s, after = reset) {
  const row = $(id);
  const paint = () => row.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', parse(b.dataset.v) === cfg[key]));
  row.addEventListener('click', (e) => {
    const b = e.target.closest('.seg');
    if (!b) return;
    cfg[key] = parse(b.dataset.v);
    paint();
    save();
    after();
  });
  paint();
  return paint;
}
bindSeg('mode-seg', 'mode');
const paintSides = bindSeg('side-seg', 'side');
bindSeg('lane-seg', 'lane');
bindSeg('aisle-seg', 'aisle', Number, rebuild);
bindSeg('bays-seg', 'bays', Number, rebuild);

function bindToggle(id, key) {
  const b = $(id);
  const paint = () => b.classList.toggle('on', cfg[key]);
  b.addEventListener('click', () => { cfg[key] = !cfg[key]; paint(); save(); dirty = true; });
  paint();
  return () => { cfg[key] = !cfg[key]; paint(); save(); dirty = true; };
}
const toggleTrace = bindToggle('trace-btn', 'trace');
const toggleTurn = bindToggle('turn-btn', 'turn');
$('top-btn').addEventListener('click', () => view.topView(false));
$('reset-btn').addEventListener('click', reset);

// ---------- settings sheet ----------
const sheet = $('settings');
$('settings-btn').addEventListener('click', () => { sheet.hidden = !sheet.hidden; });
$('settings-done').addEventListener('click', () => { sheet.hidden = true; });

// ---------- steering ----------
const slider = $('steer');
const wheelIcon = $('wheel');
const steerSeg = $('steer-seg');
steerSeg.addEventListener('click', (e) => {
  const b = e.target.closest('.seg');
  if (b) steerTarget = Number(b.dataset.v);
});
slider.addEventListener('input', () => { steerTarget = -Number(slider.value) / 100; });

function paintSteer() {
  slider.value = String(Math.round(-steerTarget * 100));
  // Lock to lock is an assumption (polo.js), used only here.
  wheelIcon.style.transform = `rotate(${-steer * POLO.lockToLockTurns * 180}deg)`;
  steerSeg.querySelectorAll('.seg').forEach((b) => b.classList.toggle('active', Number(b.dataset.v) === steerTarget));
}

// ---------- driving: hold to move ----------
function holdButton(btn, dir) {
  const release = () => { if (held.drive === dir) held.drive = 0; btn.classList.remove('held'); };
  btn.addEventListener('pointerdown', (e) => {
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
  if (k in DRIVE_KEYS || k in STEER_KEYS) { e.preventDefault(); down.add(k); }
});
addEventListener('keyup', (e) => { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; down.delete(k); });
addEventListener('blur', () => { down.clear(); held.drive = 0; });
_base.onKey({
  q: () => { steerTarget = 1; },
  e: () => { steerTarget = -1; },
  c: () => { steerTarget = 0; },
  r: reset,
  v: () => view.topView(false),
  g: toggleTrace,
  p: toggleTurn,
  Escape: () => { sheet.hidden = true; },
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
});

// ---------- cue chips ----------
const chips = $('chips');
function setChips(lines) {
  const html = lines.join('\n');
  if (chips.dataset.v === html) return;
  chips.dataset.v = html;
  chips.replaceChildren(...lines.map((t) => {
    const d = document.createElement('div');
    d.className = 'chip-line panel';
    d.textContent = t;
    return d;
  }));
}

/** Everything derived from the pose and settings: trace, ghosts, highlights and cue text. */
function derive() {
  const g = goal(cfg);
  const target = { s: g.s, i: cfg.bay };
  view.setTrace(cfg.trace ? traceFrom(lot, cfg, pose).poses : null);
  const live = liveCue(lot, cfg, pose);
  const lines = [];
  if (live.state === 'ahead') lines.push(`Full Lock in ${live.dist.toFixed(1)} m`);
  else if (live.state === 'now') lines.push('Lock Now');
  else if (live.state === 'past') lines.push(`${(-live.dist).toFixed(1)} m Past the Turn Point`);
  else if (live.state === 'noSweep') lines.push('No Single Sweep From This Lane');

  // The turn point for the car's own lane while it is still square to the aisle, else the preset lane's.
  const tp = cfg.turn ? (live.tp || turnPoint(lot, cfg)) : null;
  view.setGhosts(tp && tp.ok ? [tp.start, tp.end] : null);
  if (tp && tp.ok) {
    lines.push(cueText('Mirror', tp.cue.mirror), cueText('Shoulder', tp.cue.shoulder));
    // On test the other bays count as occupied: say when the sweep crosses into one.
    if (tp.neighbour >= SWING_MIN) lines.push(`Cuts ${tp.neighbour.toFixed(1)} m Into a Neighbouring Bay`);
    if (tp.opposite >= SWING_MIN) lines.push(`Front Swings ${tp.opposite.toFixed(1)} m Over the Opposite Bays`);
  }

  const bad = [];
  const c = centrePos(pose);
  const inTarget = lot.bayAt(c[0], c[1]);
  if (inTarget && inTarget.s === g.s && inTarget.i === cfg.bay && v === 0) {
    const r = inBay(lot, g.s, cfg.bay, pose);
    if (r.over.near > 0) bad.push({ s: g.s, i: cfg.bay });
    if (r.over.far > 0) bad.push({ s: g.s, i: cfg.bay + 1 });
    if (r.over.back > 0) bad.push({ s: g.s, back: true });
    if (r.ok) lines.push('In the Bay');
  }
  view.setHighlights({ target, cueLine: tp && tp.ok ? { s: g.s, i: tp.cue.mirror.line } : null, bad });
  setChips(lines);
}

// ---------- loop ----------
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  const keyDrive = [...down].reduce((a, k) => a + (DRIVE_KEYS[k] || 0), 0);
  const keySteer = [...down].reduce((a, k) => a + (STEER_KEYS[k] || 0), 0);
  if (keySteer) steerTarget = Math.max(-1, Math.min(1, steerTarget + keySteer * KEY_STEER_RATE * dt));
  const want = (held.drive || Math.sign(keyDrive)) * SPEED;
  const dv = want - v;
  const wasMoving = v !== 0;
  v = Math.abs(dv) <= ACCEL * dt ? want : v + Math.sign(dv) * ACCEL * dt;
  const ds = steerTarget - steer;
  if (ds) steer = Math.abs(ds) <= STEER_RATE * dt ? steerTarget : steer + Math.sign(ds) * STEER_RATE * dt;
  // The stopping frame must derive too: the parked check only runs at v === 0.
  if (v !== 0 || wasMoving || ds) {
    if (v !== 0) {
      pose = step(pose, steer, v * dt);
      travelled += v * dt;
    }
    dirty = true;
  }
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

function onResize() { view.resize(); frameDirty = true; }
addEventListener('resize', onResize);
// The cue lines and the tool column sit just above the bar, whatever its height.
const bar = $('bar');
new ResizeObserver(() => document.documentElement.style.setProperty('--bar-h', `${bar.offsetHeight}px`)).observe(bar);

applyTheme();
rebuild();
onResize();
view.topView(true);
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
  };
}
