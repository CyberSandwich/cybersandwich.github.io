/**
 * Driver's seat: a code-built right-hand-drive Polo Mk6 interior, the head camera, the mirrors and the automatic
 * head-look. Pure geometry, framing and scheduling live in headlook.js (tested); this file only draws them.
 *
 *   const cockpit = createCockpit({ canvas, reducedMotion })
 *   cockpit.group                 add to the scene; sits at the player car (frame: forward -z, right +x)
 *   cockpit.camera                the eye; sees layers 0, 1 and 2 (the interior is on layer 1, so mirrors skip it)
 *   cockpit.update(view, dt)      view = the player's interpolated VehicleView { x, z, heading, steer, speed,
 *                                 accel, indicator, lamp }
 *   cockpit.setDrive(drive)       once per frame during a run, null otherwise:
 *                                 { phase, distToLine, goWindowOpen, layout, path, vehicles }
 *                                 phase = player.phase, distToLine = metres to the stop line (sim.player.stopS -
 *                                 sim.player.s), path = sim.player.path, vehicles = the snapshot's vehicles
 *   cockpit.focus(target, hold)   guided focus: { id } (a vehicle) or { x, z } (a world point), null to drop;
 *                                 overrides the scan for `hold` s (default LOOK.focusHold), renewed by calling again;
 *                                 returns the hold applied in s (0 when dropped)
 *   cockpit.look(yaw, pitch, hold)  fixed glance (radians, + = left / up) for `hold` s; beats the scheduler
 *   cockpit.glanceMirrors()       the mirror-signal glances: interior, left wing, then toward the exit
 *   cockpit.renderMirrors(renderer, scene)  refreshes at most one mirror per frame, only mirrors in view;
 *                                 mirror cameras see layer 0 only: road, signs, traffic (scenery is layer 2)
 *   cockpit.setTheme(palette)     world.js PALETTES entry (env.setTheme's return): tints the static mirror glass
 *                                 and lights the cabin by palette.cabFill; call once at boot
 *   cockpit.speedoInFrame        true while the whole speedometer face is in the frame (the HUD mph shows otherwise)
 *   cockpit.setAspect(a)  cockpit.setQuality(q)  cockpit.setVisible(on)  cockpit.resetLook()  cockpit.nudge(dYaw)
 *   cockpit.dispose()
 *
 * Head priority: drag or keys (auto resumes T.idle s after release) > look() > the scheduler (mirror-signal
 * glances > focus > scan). Yaw, pitch and the mirror zoom ease on headlook's critically damped spring (easeTo).
 * The A-pillars are solid and placed where a Polo's are: they hide cars, which is part of what is taught.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { COLOURS } from './traffic-data.js';
import { toMph } from './geom.js';
import {
  CAB, LOOK, povFor, aim, bonnetPoint, inFrame, mirrorPose, panelPose, mirrorCamera, rearMirrorX, pickMirror,
  routePoints, lookInputFor, createHeadLook, easeTo,
} from './headlook.js';

const EYE = new THREE.Vector3(...CAB.eye);

// Cab tunables. Angles in radians unless named deg.
const T = {
  steeringRatio: 15,
  yawLimit: THREE.MathUtils.degToRad(120),
  pitchLimit: THREE.MathUtils.degToRad(25),
  idle: 1.5, // s after a drag or key before the automatic head-look takes over again
  povRate: 15, // 1/s: frame changes on resize or rotation settle in ~200 ms
  // Mirror render targets (px at high; medium scales them) and refresh period in frames per tier.
  rt: { rear: [256, 64], left: [256, 160], right: [256, 160] },
  tiers: { high: { scale: 1, period: 2, live: ['rear', 'left', 'right'] }, medium: { scale: 0.75, period: 3, live: ['rear', 'left'] }, low: { scale: 0.75, period: Infinity, live: [] } },
  // Body motion is kept small: sway and shake in a moving view cause headaches. Reduced motion has none.
  accelPitch: 0.0012, // rad per m/s^2, capped at accelPitchMax: the nose dips under braking
  accelPitchMax: THREE.MathUtils.degToRad(0.25),
  bob: 0.0012, // m, head bob amplitude at walking pace and above
  vibration: 0.00012, // m at 30 mph
  lean: 0.0025, // rad of roll per m/s^2 of lateral acceleration, capped at leanMax
  leanMax: 0.012,
  stalkTravel: 0.14, // rad
};
const MIRRORS = ['rear', 'left', 'right'];

// Geometry with a flat vertex colour and no uv, so differently built parts merge into one draw.
function tint(g, hex) {
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) a.set([c.r, c.g, c.b], i * 3);
  g.setAttribute('color', new THREE.BufferAttribute(a, 3));
  return g;
}

// Box from a to b (centres of its end faces) with a cross-section w x t, long axis along b - a.
function beam(a, b, w, t, hex, up = new THREE.Vector3(0, 1, 0)) {
  const d = new THREE.Vector3().subVectors(b, a);
  const g = new THREE.BoxGeometry(w, t, d.length());
  const m = new THREE.Matrix4().lookAt(new THREE.Vector3(), d, up);
  g.applyMatrix4(m).translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return tint(g, hex);
}

const box = (w, h, d, x, y, z, hex) => tint(new THREE.BoxGeometry(w, h, d).translate(x, y, z), hex);
const V = (a) => new THREE.Vector3(...a);

// Rotation that turns a plane's +z toward `normal` (car frame), independent of where the car is.
function facing(normal) {
  const m = new THREE.Matrix4().lookAt(V(normal), new THREE.Vector3(), new THREE.Vector3(0, 1, 0));
  return new THREE.Quaternion().setFromRotationMatrix(m);
}

function dash() {
  const { far, c1, crest, c2, near } = CAB.dash;
  const s = new THREE.Shape();
  s.moveTo(...far);
  s.quadraticCurveTo(...c1, ...crest);
  s.quadraticCurveTo(...c2, ...near);
  s.lineTo(-0.44, 0.62);
  s.lineTo(-1.0, 0.62);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.56, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(-Math.PI / 2).translate(0.78, 0, 0);
  return tint(g, '#3a3c41');
}

// A mirror's black shell, behind its glass and turned with it.
function shell(m, pose, depth) {
  const g = tint(new THREE.BoxGeometry(m.w + 0.024, m.h + 0.024, depth).translate(0, 0, -depth / 2 - 0.002), '#1c1d20');
  g.applyQuaternion(facing(pose.normal)).translate(...pose.centre);
  return g;
}

function interior() {
  const pillar = '#38393d';
  const hood = '#26282c';
  const [sx, sy, sz] = CAB.speedo.at;
  const parts = [
    dash(),
    // Instrument hood: open toward the driver, its lip low enough to hide only bonnet, never road.
    box(0.19, 0.008, 0.1, sx, sy + 0.048, sz + 0.01, hood),
    box(0.01, 0.094, 0.1, sx - 0.095, sy - 0.003, sz + 0.01, hood),
    box(0.01, 0.094, 0.1, sx + 0.095, sy - 0.003, sz + 0.01, hood),
    box(0.19, 0.1, 0.01, sx, sy - 0.005, sz - 0.045, hood),
    box(0.19, 0.03, 0.1, sx, sy - 0.04, sz + 0.01, hood),
    beam(new THREE.Vector3(0.71, 0.97, -0.97), new THREE.Vector3(0.6, 1.41, -0.25), 0.09, 0.06, pillar),
    beam(new THREE.Vector3(-0.71, 0.97, -0.97), new THREE.Vector3(-0.6, 1.41, -0.25), 0.09, 0.06, pillar),
    // Header rail, sun visors, roof side rails, B-pillars.
    beam(new THREE.Vector3(-0.62, 1.41, -0.24), new THREE.Vector3(0.62, 1.41, -0.24), 0.08, 0.05, '#55534f'),
    box(0.36, 0.02, 0.16, 0.36, 1.375, -0.16, '#5f5c57'),
    box(0.36, 0.02, 0.16, -0.36, 1.375, -0.16, '#5f5c57'),
    beam(new THREE.Vector3(0.66, 1.42, -0.25), new THREE.Vector3(0.66, 1.42, 1.3), 0.08, 0.05, '#55534f'),
    beam(new THREE.Vector3(-0.66, 1.42, -0.25), new THREE.Vector3(-0.66, 1.42, 1.3), 0.08, 0.05, '#55534f'),
    beam(new THREE.Vector3(0.75, 0.98, 0.58), new THREE.Vector3(0.68, 1.42, 0.5), 0.12, 0.06, pillar),
    beam(new THREE.Vector3(-0.75, 0.98, 0.58), new THREE.Vector3(-0.68, 1.42, 0.5), 0.12, 0.06, pillar),
    box(1.44, 0.02, 1.6, 0, 1.44, 0.55, '#a29e97'),
    // Door cards with sills; centre console; the passenger seat seen when glancing left.
    box(0.06, 0.55, 1.5, 0.8, 0.7, -0.15, '#2b2d31'),
    box(0.06, 0.55, 1.5, -0.8, 0.7, -0.15, '#2b2d31'),
    box(0.09, 0.03, 1.5, 0.77, 0.985, -0.15, '#3c3e42'),
    box(0.09, 0.03, 1.5, -0.77, 0.985, -0.15, '#3c3e42'),
    box(0.24, 0.3, 0.9, 0, 0.47, -0.05, '#202225'),
    box(0.06, 0.1, 0.06, 0, 0.66, -0.12, '#141517'),
    box(0.5, 0.66, 0.14, -0.4, 0.92, 0.42, '#303236'),
    box(0.46, 0.14, 0.5, -0.4, 0.55, 0.15, '#303236'),
    // Footwell and floor: carpet, bulkhead under the dash, kick panels and lower door cards, so no road shows
    // below the dash at any aspect or head pose.
    box(1.62, 0.03, 1.9, 0, 0.285, -0.2, '#141517'),
    box(1.56, 0.36, 0.05, 0, 0.46, -0.97, '#1b1c1f'),
    tint(new THREE.BoxGeometry(1.56, 0.03, 0.5).rotateX(0.55).translate(0, 0.37, -0.8), '#17181a'),
    box(0.06, 0.72, 0.36, 0.8, 0.64, -1.05, '#232428'),
    box(0.06, 0.72, 0.36, -0.8, 0.64, -1.05, '#232428'),
    box(0.06, 0.16, 1.5, 0.8, 0.35, -0.15, '#232428'),
    box(0.06, 0.16, 1.5, -0.8, 0.35, -0.15, '#232428'),
    // Steering column under the wheel.
    beam(new THREE.Vector3(0.37, 0.74, -0.36), new THREE.Vector3(0.37, 0.66, -0.62), 0.07, 0.07, '#202225'),
    // Wing mirror shells, black plastic, each on a sail plate from the door's front corner.
    shell(CAB.left, mirrorPose(CAB.left), 0.07),
    shell(CAB.right, mirrorPose(CAB.right), 0.07),
    box(0.17, 0.05, 0.12, -0.885, 0.985, CAB.left.at[2] - 0.01, '#1c1d20'),
    box(0.17, 0.05, 0.12, 0.885, 0.985, CAB.right.at[2] - 0.01, '#1c1d20'),
  ];
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

// Bonnet with a slight crown, in the player's paint.
function bodywork() {
  const g = new THREE.PlaneGeometry(1.0, 1.0, 8, 6);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) p.setXYZ(i, ...bonnetPoint(p.getX(i) + 0.5, p.getY(i) + 0.5));
  g.computeVertexNormals();
  g.deleteAttribute('uv');
  return g;
}

function steeringWheel() {
  const { r, tube } = CAB.wheel;
  const parts = [
    new THREE.TorusGeometry(r, tube, 10, 40),
    new THREE.CylinderGeometry(0.065, 0.075, 0.06, 18).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(0.17, 0.035, 0.02).translate(-0.1, -0.01, 0),
    new THREE.BoxGeometry(0.17, 0.035, 0.02).translate(0.1, -0.01, 0),
    new THREE.BoxGeometry(0.035, 0.13, 0.02).translate(0, -0.11, 0),
  ].map((g) => tint(g.toNonIndexed(), '#18191b'));
  parts.push(tint(new THREE.BoxGeometry(0.05, 0.012, 0.022).translate(0, r - 0.005, 0.004).toNonIndexed(), '#5a5c60'));
  return mergeGeometries(parts);
}

// Indicator stalk on the left of the column (VW: down for left, up for right), pivoting at its root.
function stalk() {
  const parts = [
    new THREE.CylinderGeometry(0.007, 0.009, 0.15, 8).rotateZ(Math.PI / 2).translate(-0.075, 0, 0),
    new THREE.CylinderGeometry(0.011, 0.011, 0.035, 10).rotateZ(Math.PI / 2).translate(-0.16, 0, 0),
  ].map((g, i) => tint(g.toNonIndexed(), i ? '#3a3c40' : '#1c1d20'));
  return mergeGeometries(parts);
}

function speedoTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 88;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  let last = '';
  function draw(mph, left, right) {
    const key = `${mph}|${left}|${right}`;
    if (key === last) return;
    last = key;
    const x = c.getContext('2d');
    x.fillStyle = '#0a0b0d';
    x.fillRect(0, 0, 256, 88);
    x.fillStyle = '#e9e9e6';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.font = "600 54px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
    x.fillText(String(mph), 128, 58);
    x.fillStyle = '#8b8d90';
    x.font = "500 17px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
    x.fillText('mph', 128, 80);
    // Telltales: green arrows, lit with the shared blink clock (view.lamp).
    const arrow = (cx, s, on) => {
      x.fillStyle = on ? '#3ddc84' : '#1d2a22';
      x.beginPath();
      x.moveTo(cx + s * 24, 40);
      x.lineTo(cx, 22);
      x.lineTo(cx, 33);
      x.lineTo(cx - s * 16, 33);
      x.lineTo(cx - s * 16, 47);
      x.lineTo(cx, 47);
      x.lineTo(cx, 58);
      x.closePath();
      x.fill();
    };
    arrow(38, -1, left);
    arrow(218, 1, right);
    t.needsUpdate = true;
  }
  return { texture: t, draw };
}

export function createCockpit({ canvas, reducedMotion = false }) {
  const group = new THREE.Group();
  const inside = new THREE.Group();
  group.add(inside);
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // Emissive here is a share of the surface colour (palette.cabFill), not a flat glow: three adds emissive
  // unscaled. A little neutral self-light keeps shapes readable in dusk light while dark parts stay dark.
  const albedoFill = (m) => {
    m.onBeforeCompile = (shader) => {
      shader.fragmentShader = shader.fragmentShader.replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\n\ttotalEmissiveRadiance *= diffuseColor.rgb;');
    };
    return m;
  };
  const cabinMat = keep(albedoFill(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.4 })));
  inside.add(new THREE.Mesh(keep(interior()), cabinMat));
  // The player's car is white (sim.js insertPlayer).
  const paint = keep(new THREE.MeshStandardMaterial({ color: COLOURS.White, roughness: 0.32, metalness: 0.05 }));
  inside.add(new THREE.Mesh(keep(bodywork()), paint));

  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(...CAB.wheel.at);
  wheelPivot.rotation.x = CAB.wheel.tilt;
  const wheelMat = keep(albedoFill(new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 })));
  const wheel = new THREE.Mesh(keep(steeringWheel()), wheelMat);
  wheelPivot.add(wheel);
  inside.add(wheelPivot);

  const stalkPivot = new THREE.Group();
  stalkPivot.position.set(CAB.wheel.at[0] - 0.05, CAB.wheel.at[1] - 0.045, CAB.wheel.at[2] - 0.05);
  stalkPivot.add(new THREE.Mesh(keep(stalk()), wheelMat));
  inside.add(stalkPivot);
  let stalkAngle = 0;

  const speedo = speedoTexture();
  keep(speedo.texture);
  speedo.draw(0, false, false);
  const display = new THREE.Mesh(keep(new THREE.PlaneGeometry(CAB.speedo.w, CAB.speedo.h)), keep(new THREE.MeshBasicMaterial({ map: speedo.texture, fog: false, toneMapped: false })));
  display.position.set(...CAB.speedo.at);
  const speedoPose = panelPose(CAB.speedo);
  const speedoCorners = speedoPose.corners;
  const speedoView = { yaw: 0, pitch: 0 };
  display.quaternion.copy(facing(speedoPose.normal));
  inside.add(display);

  // ---------- mirrors ----------
  // Live glass shows a render target flipped left to right (a mirror image). Static glass carries a
  // sky-horizon-road gradient in vertex colours taken from the scene palette (setTheme), so it reads as a mirror,
  // never a slab; live glass ignores them. Rows run top to bottom: PlaneGeometry(w, h, 1, 2) has 2 vertices a row.
  const staticGlass = keep(new THREE.MeshBasicMaterial({ vertexColors: true, fog: false }));
  const glassGeometry = (m) => {
    const g = new THREE.PlaneGeometry(m.w, m.h, 1, 2);
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 3).fill(0.5), 3));
    return g;
  };
  function glassTheme(palette) {
    const horizon = new THREE.Color(palette.skyHorizon);
    const rows = [
      new THREE.Color(palette.skyTop).lerp(horizon, 0.4), // a mirror shows the low sky behind, not the zenith
      horizon,
      // The road behind: between the low sky and the ground light, dimmed; follows the theme's brightness.
      new THREE.Color(palette.skyBottom).lerp(new THREE.Color(palette.hemiGround), 0.5).multiplyScalar(0.7),
    ];
    for (const name of MIRRORS) {
      const c = mirrors[name].glass.geometry.getAttribute('color');
      for (let i = 0; i < c.count; i++) c.setXYZ(i, ...rows[Math.floor(i / 2)].toArray());
      c.needsUpdate = true;
    }
  }
  const mirrors = {};
  for (const name of MIRRORS) {
    const m = CAB[name];
    const rt = keep(new THREE.WebGLRenderTarget(...T.rt[name], { samples: 0 }));
    rt.texture.repeat.set(-1, 1);
    rt.texture.offset.set(1, 0);
    const live = keep(new THREE.MeshBasicMaterial({ map: rt.texture, color: 0xe4e4e4, fog: false }));
    const glass = new THREE.Mesh(keep(glassGeometry(m)), staticGlass);
    glass.geometry.computeBoundingSphere();
    const cam = new THREE.PerspectiveCamera(30, m.w / m.h, 0.5, 250);
    group.add(cam);
    mirrors[name] = { m, rt, live, glass, cam, pose: null, age: Infinity, on: false };
  }
  const glassAims = { rear: null, left: null, right: null }; // the scheduler's mirror views, kept by placeMirror
  // The interior mirror sits in its own mount (housing and stem) that slides with rearMirrorX.
  const rearMount = new THREE.Group();
  const housing = keep(tint(new THREE.BoxGeometry(CAB.rear.w + 0.02, CAB.rear.h + 0.02, 0.035).translate(0, 0, -0.019).toNonIndexed(), '#1e1f22'));
  const stem = keep(beam(new THREE.Vector3(0, CAB.rear.h / 2, -0.02), new THREE.Vector3(0, CAB.rear.h / 2 + 0.06, -0.06), 0.022, 0.022, '#16171a').toNonIndexed());
  rearMount.add(new THREE.Mesh(keep(mergeGeometries([housing, stem])), cabinMat), mirrors.rear.glass);
  inside.add(rearMount, mirrors.left.glass, mirrors.right.glass);

  function placeMirror(name, x) {
    const mr = mirrors[name];
    mr.pose = mirrorPose(mr.m, x);
    glassAims[name] = aim(mr.pose.centre);
    const holder = name === 'rear' ? rearMount : mr.glass;
    holder.position.set(...mr.pose.centre);
    holder.quaternion.copy(facing(mr.pose.normal));
    const c = mirrorCamera(mr.m, mr.pose);
    mr.cam.position.set(...c.pos);
    mr.cam.quaternion.setFromRotationMatrix(new THREE.Matrix4().lookAt(V(c.pos), V(c.pos).add(V(c.look)), new THREE.Vector3(0, 1, 0)));
    mr.cam.fov = c.fovV;
    mr.cam.aspect = c.aspect;
    mr.cam.updateProjectionMatrix();
  }
  placeMirror('left');
  placeMirror('right');
  placeMirror('rear', 0);

  inside.traverse((o) => o.layers.set(1));

  const head = new THREE.Group();
  head.position.copy(EYE);
  head.rotation.order = 'YXZ';
  const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 900);
  camera.layers.enable(1);
  camera.layers.enable(2);
  head.add(camera);
  group.add(head);

  // ---------- framing ----------
  let aspect = 1;
  let povTarget = povFor(1);
  const pov = { ...povTarget };
  let povSnap = true;

  function applyPov() {
    camera.fov = pov.vFov;
    camera.setViewOffset(aspect, 1, 0, pov.shift, aspect, 1);
    camera.updateProjectionMatrix();
  }

  function setAspect(a) {
    aspect = a;
    povTarget = povFor(a);
    const w = canvas.clientWidth || innerWidth;
    const h = canvas.clientHeight || innerHeight;
    placeMirror('rear', rearMirrorX(povTarget, w, h));
    if (povSnap) {
      Object.assign(pov, povTarget);
      povSnap = false;
    }
    applyPov();
  }

  function easePov(dt) {
    const k = 1 - Math.exp(-dt * T.povRate);
    let moved = false;
    for (const key of ['vFov', 'hFov', 'shift', 'tanH', 'tanV']) {
      const d = povTarget[key] - pov[key];
      if (Math.abs(d) > 1e-5) { pov[key] += d * k; moved = true; } else pov[key] = povTarget[key];
    }
    if (moved) applyPov();
  }

  // ---------- look-around ----------
  // Head yaw and pitch (radians) with their speeds (rad/s): springs for easeTo, and a drag's flick inertia.
  const yaw = { x: 0, v: 0 };
  const pitch = { x: 0, v: 0 };
  const zoom = { x: 1, v: 0 };
  let dragging = null;
  let userAt = -Infinity;
  let auto = null; // { yaw, pitch, until }
  let now = 0;
  let bobPhase = 0;
  let roll = 0;
  let accelPitch = 0;
  let quality = 'high';
  let mirrorsOn = true;
  let drive = null;
  let routeKey = null;
  let route = null; // world points for the current layout + path
  let focusTarget = null;
  let focusUntil = 0;
  let lastPlan = { key: 'rest', yaw: 0, pitch: 0, rate: 0 };
  const headLook = createHeadLook({ gentle: reducedMotion });

  const radPerPx = () => (2 * Math.atan(pov.tanH)) / Math.max(1, canvas.clientWidth);

  const onDown = (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
    yaw.v = pitch.v = 0;
    userAt = now;
  };
  const onMove = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const k = radPerPx();
    const t = performance.now();
    const dt = Math.max(1, t - dragging.t) / 1000;
    const dy = (e.clientX - dragging.x) * k;
    const dp = (e.clientY - dragging.y) * k;
    yaw.x = THREE.MathUtils.clamp(yaw.x + dy, -T.yawLimit, T.yawLimit);
    pitch.x = THREE.MathUtils.clamp(pitch.x + dp, -T.pitchLimit, T.pitchLimit);
    yaw.v = yaw.v * 0.5 + (dy / dt) * 0.5;
    pitch.v = pitch.v * 0.5 + (dp / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    dragging.t = t;
    userAt = now;
  };
  const release = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if (performance.now() - dragging.t > 80) yaw.v = pitch.v = 0;
    dragging = null;
    userAt = now;
  };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointermove', onMove);
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function nudge(dYaw) {
    yaw.x = THREE.MathUtils.clamp(yaw.x + dYaw, -T.yawLimit, T.yawLimit);
    userAt = now;
  }

  const focusPoint = { x: 0, z: 0, y: 1 };
  function lookInput(view) {
    let at = null;
    if (focusTarget && now < focusUntil) {
      const v = focusTarget.id !== undefined ? drive?.vehicles?.find((w) => w.id === focusTarget.id) : focusTarget;
      if (v) { focusPoint.x = v.x; focusPoint.z = v.z; at = focusPoint; }
    }
    return lookInputFor({ view, drive, route, pov, mirrors: glassAims, focusPoint: at });
  }

  function update(view, dt) {
    now += dt;
    easePov(dt);
    if (view) {
      group.position.set(view.x, 0, view.z);
      group.rotation.y = -view.heading;
      wheel.rotation.z = view.steer * T.steeringRatio;
      const mph = Math.round(toMph(view.speed));
      speedo.draw(mph, view.indicator === 'left' && view.lamp, view.indicator === 'right' && view.lamp);
      const stalkTo = view.indicator === 'left' ? T.stalkTravel : view.indicator === 'right' ? -T.stalkTravel : 0;
      stalkAngle += (stalkTo - stalkAngle) * Math.min(1, dt * 18);
      stalkPivot.rotation.z = stalkAngle;
    }

    // The scheduler always runs, so its rhythm stays in step while a drag or a fixed look overrides it.
    if (drive?.layout && drive.path) {
      const key = `${drive.layout.seed}|${drive.layout.tier}|${drive.path.id}`;
      if (key !== routeKey) { routeKey = key; route = routePoints(drive.layout, drive.path); }
    }
    const planned = view ? headLook.update(lookInput(view), dt) : null;
    if (planned) lastPlan = planned;
    const autoLook = auto && auto.until > now;
    // Mirror-glance zoom only while the scheduler, not the user or look(), has the head.
    const zoomTo = !dragging && now - userAt > T.idle && !autoLook ? planned?.zoom ?? 1 : 1;
    if (zoom.x !== zoomTo || zoom.v !== 0) {
      easeTo(zoom, zoomTo, LOOK.rate.mirror, dt);
      if (Math.abs(zoom.x - zoomTo) < 1e-4 && Math.abs(zoom.v) < 1e-3) { zoom.x = zoomTo; zoom.v = 0; }
      camera.zoom = zoom.x;
      camera.updateProjectionMatrix();
    }

    if (!dragging) {
      // After a drag, hold where the user looked (a flick coasts) for a moment, then ease to the current target.
      const t = now - userAt <= T.idle ? null : autoLook ? auto : planned;
      if (t) {
        easeTo(yaw, t.yaw, autoLook ? LOOK.rate.glance : t.rate, dt);
        easeTo(pitch, t.pitch, autoLook ? LOOK.rate.glance : t.rate, dt);
      } else {
        const decay = Math.exp(-dt * 5);
        yaw.x += yaw.v * dt;
        pitch.x += pitch.v * dt;
        yaw.v *= decay;
        pitch.v *= decay;
      }
      yaw.x = THREE.MathUtils.clamp(yaw.x, -T.yawLimit, T.yawLimit);
      pitch.x = THREE.MathUtils.clamp(pitch.x, -T.pitchLimit, T.pitchLimit);
    }

    let bob = 0;
    let lean = 0;
    let shake = 0;
    let surge = 0;
    if (!reducedMotion && view) {
      const v30 = Math.min(1, view.speed / 13.4);
      bobPhase += view.speed * dt * 1.6;
      bob = Math.sin(bobPhase) * T.bob * Math.min(1, view.speed / 8);
      shake = (Math.sin(now * 144.5) + 0.6 * Math.sin(now * 199.2)) * T.vibration * v30;
      const latAcc = (view.speed * view.speed * Math.tan(view.steer)) / CAB.wheelbase;
      lean = THREE.MathUtils.clamp(-latAcc * T.lean, -T.leanMax, T.leanMax);
      surge = THREE.MathUtils.clamp((view.accel ?? 0) * T.accelPitch, -T.accelPitchMax, T.accelPitchMax);
    }
    roll += (lean - roll) * Math.min(1, dt * 2);
    accelPitch += (surge - accelPitch) * Math.min(1, dt * 2);
    head.position.set(EYE.x + roll * 0.4, EYE.y + bob + shake, EYE.z);
    head.rotation.set(pitch.x + accelPitch, yaw.x, roll);
  }

  // ---------- mirror rendering ----------
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  let period = T.tiers.high.period;
  const ages = MIRRORS.map(() => Infinity);
  const visible = MIRRORS.map(() => false);

  function renderMirrors(renderer, scene) {
    group.updateMatrixWorld(true);
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    for (let j = 0; j < MIRRORS.length; j++) {
      const mr = mirrors[MIRRORS[j]];
      mr.age++;
      ages[j] = mr.age;
      visible[j] = mr.on && frustum.intersectsObject(mr.glass);
    }
    const i = pickMirror(ages, visible, period);
    if (i < 0) return;
    const mr = mirrors[MIRRORS[i]];
    mr.age = 0;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(mr.rt);
    renderer.render(scene, mr.cam);
    renderer.setRenderTarget(prev);
  }

  function setQuality(q) {
    quality = q;
    const tier = T.tiers[q] ?? T.tiers.high;
    period = tier.period;
    mirrorsOn = tier.live.length > 0;
    for (const name of MIRRORS) {
      const mr = mirrors[name];
      mr.on = tier.live.includes(name);
      const [w, h] = T.rt[name];
      mr.rt.setSize(Math.round(w * tier.scale), Math.round(h * tier.scale));
      mr.glass.material = mr.on ? mr.live : staticGlass;
      mr.age = Infinity;
    }
  }
  setQuality('high');

  function dispose() {
    canvas.removeEventListener('pointerdown', onDown);
    canvas.removeEventListener('pointermove', onMove);
    canvas.removeEventListener('pointerup', release);
    canvas.removeEventListener('pointercancel', release);
    for (const d of disposables) d.dispose();
    group.removeFromParent();
  }

  return {
    group,
    camera,
    update,
    renderMirrors,
    nudge,
    setDrive(d) { drive = d; if (!d) { route = null; routeKey = null; } },
    focus(target, hold = LOOK.focusHold) {
      focusTarget = target ?? null;
      focusUntil = target ? now + hold : 0;
      return target ? hold : 0;
    },
    look(y, p = 0, hold = 1.5) { auto = { yaw: y, pitch: p, until: now + hold }; },
    glanceMirrors() { headLook.mirrors(); },
    resetLook() {
      yaw.x = yaw.v = pitch.x = pitch.v = 0;
      auto = null;
      focusTarget = null;
      userAt = -Infinity;
      drive = null;
      route = null;
      routeKey = null;
      headLook.reset();
    },
    setAspect,
    setQuality,
    setVisible(on) { inside.visible = on; },
    setTheme(palette) {
      glassTheme(palette);
      for (const m of [cabinMat, wheelMat]) {
        m.emissive.set('#ffffff');
        m.emissiveIntensity = palette.cabFill;
      }
    },
    dispose,
    get quality() { return quality; },
    get mirrorsActive() { return mirrorsOn && inside.visible; },
    get yaw() { return yaw.x; },
    get yawRate() { return yaw.v; }, // QA: rad/s
    // True while the speedometer's whole face is in the frame; the HUD shows its own mph only when it is not.
    get speedoInFrame() {
      speedoView.yaw = yaw.x;
      speedoView.pitch = pitch.x + accelPitch;
      return inside.visible && inFrame(speedoCorners, speedoView, pov, 0);
    },
    // QA: what the head is doing and where the cab parts are.
    get lookKey() { return dragging || now - userAt <= T.idle ? 'user' : auto && auto.until > now ? 'look' : drive ? lastPlan.key : 'rest'; },
    get lookPlan() { return { ...lastPlan }; },
    get pov() { return { ...pov }; },
  };
}
