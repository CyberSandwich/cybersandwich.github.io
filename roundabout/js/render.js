/**
 * Everything drawn and measured each frame: the cameras, the preview orbit, the run and replay views, the run's
 * own looks (freeze culprit, guide focus, held arrow keys), the culprit's signal tag, size and quality. main.js
 * owns the state and the screens; this reads them through state() every frame and never keeps them.
 *
 *   const view = createView({ canvas, renderer, scene, cockpit, hud, reducedMotion, quality, onQuality, state })
 *     state() -> { run, preview, layout, world, vehicles, statics }
 *   view.frame(dt, alpha) -> camera    one frame of whatever screen is up, then the tag and the counters
 *   view.monitor(rawDt)                frame-rate sample; a slow focused page steps quality down (onQuality(q))
 *   view.glance.look(target, hold)     fixed glance at a run target (the freeze culprit), main turns the head
 *   view.glance.focus(target, hold?, { sign, arrows })   guide focus: the cab turns the head; the sign index or
 *                                      arm's lane arrows pulse while it holds. target = { id } | { x, z }
 *   view.clear()                       drop looks and highlights (the run ended)
 *   view.replayView(on)                the replay starts or ends: the eased camera restarts
 *   view.toggleDriverView() -> on      replay from the seat instead of above
 *   view.yawTo(x, z)                   yaw from the player to a world point (radians, + = left)
 *   view.held                          Set of held look keys: 'left' | 'right' | 'up'
 *   view.setQuality(q, { lock? })      lock true pins the tier (QA), false releases it; never saved here
 *   view.quality  view.resize()  view.stats  view.dispose()
 */
import * as THREE from 'three';
import { dir, wrapPi, bearingOf } from './geom.js';
import { LOOK } from './headlook.js';
import { edgeArrow, nextQuality, signalLabel } from './ui.js';

const PIXEL_RATIO = { low: 1, medium: 1.25, high: 1.5 };
const FPS_WINDOW = 2; // s per frame-rate sample
const FPS_SETTLE = 4; // s between quality steps
const LONG_FRAME = 0.1; // s: a frame this long is a stall (tab switch, throttling), not render cost
const SPEED_EVERY = 6; // frames between HUD speed updates (10 Hz)
const LOOK_RATE = 1.6; // rad/s of held arrow-key look
// Run states in which the cab's head-look scans; frozen and paused keep it so the rhythm resumes in step.
const DRIVING = new Set(['approach', 'atLine', 'onRing', 'exited', 'frozen', 'paused']);
const REPLAY_CAM = { back: 16, side: 9, up: 13, ease: 3 };

export const playerView = (snap) => snap?.vehicles.find((v) => v.isPlayer) ?? null;

function interpolated(a, b, alpha) {
  if (!a || !b) return b;
  return { ...b, x: a.x + (b.x - a.x) * alpha, z: a.z + (b.z - a.z) * alpha, heading: a.heading + wrapPi(b.heading - a.heading) * alpha, steer: a.steer + (b.steer - a.steer) * alpha, speed: a.speed + (b.speed - a.speed) * alpha };
}

function lookPoint(target, snap) {
  if (target.id === undefined) return target;
  const v = snap?.vehicles.find((w) => w.id === target.id);
  return v ? { x: v.x, z: v.z } : null;
}

export function createView({ canvas, renderer, scene, cockpit, hud, reducedMotion, quality, onQuality, state }) {
  const aerial = new THREE.PerspectiveCamera(45, 1, 0.5, 900);
  aerial.layers.enable(2);
  const projected = new THREE.Vector3();
  const held = new Set();
  const stats = { calls: 0, triangles: 0, fps: 0 };
  const fps = { t: 0, n: 0, since: 0 };
  let pin = null; // { target, until, fixed }: the freeze culprit (fixed: this turns the head) or guide focus (the cab does)
  let marked = { sign: null, arrows: null };
  let replayCam = null;
  let driverView = false;
  let locked = false;
  let frame = 0;
  let s = null; // this frame's state()

  function yawTo(x, z) {
    const me = playerView(state().run?.curr);
    return me ? wrapPi(me.heading - bearingOf(x - me.x, z - me.z)) : 0;
  }

  // Guide focus on road furniture: the sign or lane arrows pulse while the focus holds.
  function mark(sign, arrows) {
    if (sign === marked.sign && arrows === marked.arrows) return;
    marked = { sign, arrows };
    state().world?.highlightSign?.(sign);
    state().world?.highlightArrows?.(arrows);
  }

  // What the cab's head-look scheduler reads each frame; null outside the drive.
  function driveOf(run) {
    if (!DRIVING.has(run.state)) return null;
    const p = run.sim.player;
    return { phase: run.player.phase, distToLine: p.stopS - p.s, goWindowOpen: run.player.goWindowOpen, layout: s.layout, path: p.path, vehicles: run.curr.vehicles };
  }

  // The one draw path. world.update rebins scenery instances for this camera, so it runs before any render
  // (mirrors included): three uploads instance buffers before onBeforeRender.
  function present(camera, mirrors = false) {
    s.world?.update?.(camera);
    if (s.vehicles) {
      if (mirrors && cockpit.mirrorsActive) {
        s.vehicles.commit(true);
        cockpit.renderMirrors(renderer, scene);
      }
      s.vehicles.commit(false, camera);
    }
    renderer.render(scene, camera);
    return camera;
  }

  function render(dt, alpha) {
    const { run, preview, layout, vehicles, statics } = s;
    if (!vehicles) {
      orbit(dt);
      return present(aerial);
    }
    const rf = run?.state === 'replay' ? run.replayFrame() : null;
    if (rf) return renderReplay(dt, rf);
    if (!run) {
      vehicles.update(preview?.prev, preview?.curr, alpha, { dt, statics, eye: aerial.position });
      orbit(dt);
      return present(aerial);
    }
    const me = interpolated(playerView(run.prev), playerView(run.curr), alpha);
    vehicles.update(run.prev, run.curr, alpha, { dt: dt * (run.state === 'frozen' ? 0 : 1), statics, eye: me ?? aerial.position });
    steerLook(dt, run);
    cockpit.setDrive(driveOf(run));
    cockpit.update(me, dt);
    if (me && frame % SPEED_EVERY === 0) {
      const limit = me.s > (run.sim.player.path.marks.merge ?? 0) ? layout.arms[layout.player.exitArm].limitMph : layout.arms[layout.player.arm].limitMph;
      hud.speed(Math.round(me.speed / 0.44704), limit, !cockpit.speedoInFrame);
    }
    if (me) hud.telltale(me.indicator === 'left' && me.lamp, me.indicator === 'right' && me.lamp);
    return present(cockpit.camera, true);
  }

  // Run and guide focus: keep turning the head toward a moving target and point at it when it is off screen.
  function steerLook(dt, run) {
    for (const k of held) cockpit.nudge((k === 'left' ? 1 : -1) * LOOK_RATE * dt);
    if (held.has('up')) cockpit.glanceMirrors();
    const p = pin && performance.now() < pin.until ? lookPoint(pin.target, run.curr) : null;
    if (!p) { hud.edge(null); mark(null, null); return; }
    if (pin.fixed) cockpit.look(THREE.MathUtils.clamp(yawTo(p.x, p.z), -2, 2), 0, 0.25);
    projected.set(p.x, 0.8, p.z).project(cockpit.camera);
    hud.edge(edgeArrow({ x: projected.x, y: projected.y, behind: projected.z > 1 }));
  }

  // Frozen or replaying a red verdict: the culprit's signal in words above its roof, as seen at that instant.
  // After the render, so the camera's matrices are this frame's.
  function tagCulprit(camera) {
    const { run } = s;
    const rf = run?.state === 'replay' ? run.replayFrame() : null;
    const snap = rf ? rf.b : run?.state === 'frozen' ? run.curr : null;
    const v = snap && run.culpritId != null ? snap.vehicles.find((w) => w.id === run.culpritId) : null;
    if (!v) { hud.tag(null); return; }
    projected.set(v.x, (v.height ?? 1.5) + 0.4, v.z).project(camera);
    if (projected.z > 1 || Math.abs(projected.x) > 1 || Math.abs(projected.y) > 1) { hud.tag(null); return; }
    hud.tag({ x: (projected.x + 1) / 2, y: (1 - projected.y) / 2, text: signalLabel(v.indicator) });
  }

  function orbit(dt) {
    const { layout, preview } = s;
    if (!layout) return;
    if (preview && !reducedMotion) preview.angle += dt * 0.035;
    const R = layout.outerRadius;
    const d = dir(preview?.angle ?? 0);
    aerial.position.set(d[0] * (R * 1.5 + 34), R * 0.75 + 24, d[1] * (R * 1.5 + 34));
    aerial.lookAt(0, 0, 0);
  }

  // "What Went Wrong": a high three-quarter view of the conflict, eased in from the seat, or the seat itself.
  function renderReplay(dt, rf) {
    s.vehicles.update(rf.a, rf.b, rf.alpha, { showPlayer: !driverView, ghosts: false, statics: s.statics, eye: aerial.position });
    const me = interpolated(playerView(rf.a), playerView(rf.b), rf.alpha);
    const culprit = rf.b.vehicles.find((v) => v.id === rf.culpritId);
    cockpit.setDrive(null);
    if (driverView && me) {
      cockpit.update(me, dt);
      if (culprit) cockpit.look(THREE.MathUtils.clamp(wrapPi(me.heading - bearingOf(culprit.x - me.x, culprit.z - me.z)), -2, 2), 0, 0.25);
      return present(cockpit.camera);
    }
    if (me) {
      const fwd = dir(me.heading);
      const c = culprit ? { x: (me.x + culprit.x) / 2, z: (me.z + culprit.z) / 2 } : { x: me.x + fwd[0] * 8, z: me.z + fwd[1] * 8 };
      const pos = new THREE.Vector3(c.x - fwd[0] * REPLAY_CAM.back + fwd[1] * REPLAY_CAM.side, REPLAY_CAM.up, c.z - fwd[1] * REPLAY_CAM.back - fwd[0] * REPLAY_CAM.side);
      if (!replayCam) {
        cockpit.camera.updateMatrixWorld();
        replayCam = { pos: new THREE.Vector3().setFromMatrixPosition(cockpit.camera.matrixWorld), look: new THREE.Vector3(c.x, 0.5, c.z) };
      }
      const k = Math.min(1, dt * REPLAY_CAM.ease);
      replayCam.pos.lerp(pos, k);
      replayCam.look.lerp(new THREE.Vector3(c.x, 0.5, c.z), k);
      aerial.position.copy(replayCam.pos);
      aerial.lookAt(replayCam.look);
    }
    return present(aerial);
  }

  function measure(camera) {
    if (s.vehicles) s.vehicles.lampUniforms.uPxWorld.value = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / Math.max(1, canvas.clientHeight);
    stats.calls = renderer.info.render.calls;
    stats.triangles = renderer.info.render.triangles;
    renderer.info.reset();
  }

  // Quality: sampled over 2 s windows; below ~45 fps the tier steps down (never up on its own). Only windows of a
  // focused, visible page with no stalled frame count: a background or throttled tab is slow for reasons the tier
  // cannot fix, and a downgrade measured there would be saved for good.
  function restartSample() { fps.t = fps.n = 0; }
  function monitor(dt) {
    if (locked || document.hidden || !document.hasFocus() || dt > LONG_FRAME) { restartSample(); return; }
    fps.t += dt;
    fps.n++;
    fps.since += dt;
    if (fps.t < FPS_WINDOW) return;
    stats.fps = fps.n / fps.t;
    const next = nextQuality(quality, stats.fps);
    if (next !== quality && fps.since > FPS_SETTLE) {
      setQuality(next);
      onQuality(next);
      fps.since = 0;
    }
    restartSample();
  }

  // lock (QA): true pins the tier and stops the monitor stepping it down; undefined leaves the lock as it is.
  function setQuality(q, { lock } = {}) {
    if (lock !== undefined) locked = lock;
    quality = q;
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, PIXEL_RATIO[quality]));
    cockpit.setQuality(quality);
    resize();
  }

  // The canvas fills the large viewport (under iOS's floating toolbar); cameras take its real size.
  function resize() {
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    renderer.setSize(w, h, false);
    cockpit.setAspect(w / h);
    aerial.aspect = w / h;
    aerial.fov = THREE.MathUtils.clamp(2 * THREE.MathUtils.radToDeg(Math.atan(Math.tan(THREE.MathUtils.degToRad(35)) / Math.min(1, w / h))), 45, 75);
    aerial.updateProjectionMatrix();
  }

  const listeners = [[document, 'visibilitychange'], [window, 'focus'], [window, 'blur']];
  for (const [t, e] of listeners) t.addEventListener(e, restartSample);

  return {
    frame(dt, alpha) {
      s = state();
      frame++;
      const camera = render(dt, alpha);
      tagCulprit(camera);
      measure(camera);
      return camera;
    },
    monitor,
    glance: {
      look(target, hold) { pin = target ? { target, until: performance.now() + hold * 1000, fixed: true } : null; },
      focus(target, hold = LOOK.focusHold, { sign = null, arrows = null } = {}) {
        cockpit.focus(target, hold);
        pin = target ? { target, until: performance.now() + hold * 1000, fixed: false } : null;
        mark(pin ? sign : null, pin ? arrows : null);
      },
    },
    clear() {
      pin = null;
      mark(null, null);
      cockpit.setDrive(null);
      cockpit.focus(null);
      replayCam = null;
    },
    replayView(on) {
      replayCam = null;
      cockpit.setVisible(!on || driverView);
    },
    toggleDriverView() {
      driverView = !driverView;
      cockpit.setVisible(driverView);
      return driverView;
    },
    yawTo,
    held,
    setQuality,
    get quality() { return quality; },
    resize,
    stats,
    dispose() { for (const [t, e] of listeners) t.removeEventListener(e, restartSample); },
  };
}
