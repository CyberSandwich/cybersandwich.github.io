/**
 * Driver's seat: a code-built right-hand-drive Polo-ish interior, the head camera and the mirrors.
 *
 *   const cockpit = createCockpit({ canvas, reducedMotion })
 *   cockpit.group                 add to the scene; sits at the player car (frame: forward -z, right +x)
 *   cockpit.camera                the eye; sees layers 0 and 1 (the interior is on layer 1, so mirrors skip it)
 *   cockpit.update(view, dt)      view = the player's interpolated VehicleView
 *   cockpit.look(yaw, pitch, hold)  automatic glance (radians, + = left / up) for `hold` s; a drag overrides it
 *   cockpit.rest(yaw)             resting yaw while waiting at the line (null to face ahead)
 *   cockpit.glanceMirrors()       rear-view then left wing mirror, as before signalling left
 *   cockpit.renderMirrors(renderer, scene, frame)   every other frame; off when quality is low
 *   cockpit.setAspect(a)  cockpit.setQuality(q)  cockpit.setVisible(on)  cockpit.resetLook()
 *
 * The A-pillars are solid and placed where a Polo's are: they hide cars, which is part of what is taught.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export const EYE = new THREE.Vector3(0.37, 1.15, 0.15);
const H_FOV = THREE.MathUtils.degToRad(98);
const V_FOV_MIN = 50;
const V_FOV_MAX = 80;
const STEERING_RATIO = 15;
const YAW_LIMIT = THREE.MathUtils.degToRad(120);
const PITCH_LIMIT = THREE.MathUtils.degToRad(25);
const BASE_PITCH = THREE.MathUtils.degToRad(-3);

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

function dash() {
  const s = new THREE.Shape();
  s.moveTo(-1.0, 0.95);
  s.quadraticCurveTo(-0.78, 1.0, -0.6, 0.985);
  s.quadraticCurveTo(-0.48, 0.97, -0.46, 0.9);
  s.lineTo(-0.44, 0.62);
  s.lineTo(-1.0, 0.62);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: 1.56, bevelEnabled: false, curveSegments: 6 });
  g.rotateY(-Math.PI / 2).translate(0.78, 0, 0);
  return tint(g.toNonIndexed(), '#25272b');
}

function interior() {
  const pillar = '#38393d';
  const parts = [
    dash(),
    // Instrument hood over the speedometer.
    tint(new THREE.CylinderGeometry(0.15, 0.15, 0.2, 14, 1, true, -Math.PI / 2, Math.PI).rotateX(Math.PI / 2).scale(1, 0.55, 1).translate(0.37, 0.975, -0.56).toNonIndexed(), '#1c1d20'),
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
    box(1.44, 0.02, 1.6, 0, 1.44, 0.55, '#6c6964'),
    // Door cards with sills; centre console; the passenger seat seen when glancing left.
    box(0.06, 0.55, 1.5, 0.8, 0.7, -0.15, '#2b2d31'),
    box(0.06, 0.55, 1.5, -0.8, 0.7, -0.15, '#2b2d31'),
    box(0.09, 0.03, 1.5, 0.77, 0.985, -0.15, '#3c3e42'),
    box(0.09, 0.03, 1.5, -0.77, 0.985, -0.15, '#3c3e42'),
    box(0.24, 0.3, 0.9, 0, 0.47, -0.05, '#202225'),
    box(0.06, 0.1, 0.06, 0, 0.66, -0.12, '#141517'),
    box(0.5, 0.66, 0.14, -0.4, 0.92, 0.42, '#303236'),
    box(0.46, 0.14, 0.5, -0.4, 0.55, 0.15, '#303236'),
    // Rear-view mirror housing and stem.
    box(0.27, 0.075, 0.035, 0, 1.31, -0.67, '#16171a'),
    box(0.025, 0.07, 0.025, 0, 1.37, -0.66, '#16171a'),
  ];
  return mergeGeometries(parts.map((g) => (g.index ? g.toNonIndexed() : g)));
}

// Bonnet with a slight crown, plus both wing mirror housings, in the player's paint.
function bodywork() {
  const g = new THREE.PlaneGeometry(1.0, 1.0, 8, 6);
  const p = g.getAttribute('position');
  for (let i = 0; i < p.count; i++) {
    const u = p.getX(i) + 0.5; // 0..1 across
    const v = p.getY(i) + 0.5; // 0 at the windscreen, 1 at the nose
    const halfW = 0.8 - 0.16 * v * v;
    const x = (u - 0.5) * 2 * halfW;
    const z = -0.98 - v * 1.08;
    const y = 0.935 - 0.13 * v * v + 0.025 * (1 - ((u - 0.5) * 2) ** 2);
    p.setXYZ(i, x, y, z);
  }
  g.computeVertexNormals();
  const housing = (x) => new THREE.BoxGeometry(0.09, 0.12, 0.18).translate(x, 1.02, -0.79);
  return mergeGeometries([g, housing(-0.99), housing(0.99)].map((x) => {
    const n = x.toNonIndexed();
    n.deleteAttribute('uv');
    return n;
  }));
}

function steeringWheel() {
  const parts = [
    new THREE.TorusGeometry(0.185, 0.021, 10, 40),
    new THREE.CylinderGeometry(0.065, 0.075, 0.06, 18).rotateX(Math.PI / 2),
    new THREE.BoxGeometry(0.17, 0.035, 0.02).translate(-0.1, -0.01, 0),
    new THREE.BoxGeometry(0.17, 0.035, 0.02).translate(0.1, -0.01, 0),
    new THREE.BoxGeometry(0.035, 0.13, 0.02).translate(0, -0.11, 0),
  ].map((g) => tint(g.toNonIndexed(), '#18191b'));
  parts.push(tint(new THREE.BoxGeometry(0.05, 0.012, 0.022).translate(0, 0.18, 0.004).toNonIndexed(), '#5a5c60'));
  return mergeGeometries(parts);
}

function speedoTexture() {
  const c = document.createElement('canvas');
  c.width = 256;
  c.height = 96;
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  let last = '';
  function draw(mph, left, right) {
    const key = `${mph}|${left}|${right}`;
    if (key === last) return;
    last = key;
    const x = c.getContext('2d');
    x.fillStyle = '#0a0b0d';
    x.fillRect(0, 0, 256, 96);
    x.fillStyle = '#e9e9e6';
    x.textAlign = 'center';
    x.textBaseline = 'alphabetic';
    x.font = "600 52px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
    x.fillText(String(mph), 128, 62);
    x.fillStyle = '#8b8d90';
    x.font = "500 17px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif";
    x.fillText('mph', 128, 84);
    const arrow = (cx, s, on) => {
      x.fillStyle = on ? '#3ddc84' : '#1d2a22';
      x.beginPath();
      x.moveTo(cx + s * 22, 44);
      x.lineTo(cx, 28);
      x.lineTo(cx, 38);
      x.lineTo(cx - s * 16, 38);
      x.lineTo(cx - s * 16, 50);
      x.lineTo(cx, 50);
      x.lineTo(cx, 60);
      x.closePath();
      x.fill();
    };
    arrow(36, -1, left);
    arrow(220, 1, right);
    t.needsUpdate = true;
  }
  return { texture: t, draw };
}

function mirror(w, h, rt) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false }));
  m.userData.rt = rt;
  if (rt) {
    // Mirrors show the world flipped left to right.
    rt.texture.repeat.set(-1, 1);
    rt.texture.offset.set(1, 0);
    m.material.map = rt.texture;
  } else {
    m.material.color.set('#3a4048');
  }
  return m;
}

export function createCockpit({ canvas, reducedMotion = false }) {
  const group = new THREE.Group();
  const inside = new THREE.Group();
  group.add(inside);
  const cabinMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0, envMapIntensity: 0.4 });
  inside.add(new THREE.Mesh(interior(), cabinMat));
  const paint = new THREE.MeshStandardMaterial({ color: '#f2f2f0', roughness: 0.32, metalness: 0.05 });
  inside.add(new THREE.Mesh(bodywork(), paint));

  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(0.37, 0.92, -0.41);
  wheelPivot.rotation.x = -0.42;
  const wheel = new THREE.Mesh(steeringWheel(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7 }));
  wheelPivot.add(wheel);
  inside.add(wheelPivot);

  const speedo = speedoTexture();
  speedo.draw(0, false, false);
  const display = new THREE.Mesh(new THREE.PlaneGeometry(0.2, 0.075), new THREE.MeshBasicMaterial({ map: speedo.texture, fog: false, toneMapped: false }));
  display.position.set(0.37, 0.958, -0.53);
  display.lookAt(EYE);
  inside.add(display);

  const rtOpts = { samples: 0 };
  const rearRT = new THREE.WebGLRenderTarget(256, 128, rtOpts);
  const wingRT = new THREE.WebGLRenderTarget(256, 160, rtOpts);
  const rearGlass = mirror(0.245, 0.062, rearRT);
  rearGlass.position.set(0, 1.31, -0.65);
  rearGlass.lookAt(new THREE.Vector3(EYE.x, EYE.y, EYE.z + 0.6));
  const wingGlass = mirror(0.15, 0.095, wingRT);
  wingGlass.position.set(-0.99, 1.02, -0.69);
  wingGlass.lookAt(EYE);
  const rightGlass = mirror(0.15, 0.095, null);
  rightGlass.position.set(0.99, 1.02, -0.69);
  rightGlass.lookAt(EYE);
  inside.add(rearGlass, wingGlass, rightGlass);

  const rearCam = new THREE.PerspectiveCamera(13, 2, 0.5, 250);
  rearCam.position.set(0, 1.3, 0.4);
  rearCam.rotation.y = Math.PI;
  const wingCam = new THREE.PerspectiveCamera(17, 1.6, 0.5, 200);
  wingCam.position.set(-0.99, 1.02, -0.7);
  wingCam.rotation.y = Math.PI - 0.2;
  group.add(rearCam, wingCam);

  inside.traverse((o) => o.layers.set(1));

  const head = new THREE.Group();
  head.position.copy(EYE);
  head.rotation.order = 'YXZ';
  const camera = new THREE.PerspectiveCamera(60, 1, 0.03, 900);
  camera.layers.enable(1);
  head.add(camera);
  group.add(head);

  // ---------- look-around ----------
  let yaw = 0;
  let pitch = 0;
  let vYaw = 0;
  let vPitch = 0;
  let dragging = null;
  let userAt = -Infinity;
  let auto = null; // { yaw, pitch, until }
  let restYaw = null;
  const glances = [];
  let now = 0;
  let bobPhase = 0;
  let roll = 0;
  let quality = 'high';
  let mirrorsOn = true;

  const radPerPx = () => (2 * Math.atan(Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * camera.aspect)) / Math.max(1, canvas.clientWidth);

  canvas.addEventListener('pointerdown', (e) => {
    dragging = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now() };
    canvas.setPointerCapture(e.pointerId);
    vYaw = vPitch = 0;
    glances.length = 0;
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    const k = radPerPx();
    const t = performance.now();
    const dt = Math.max(1, t - dragging.t) / 1000;
    const dy = (e.clientX - dragging.x) * k;
    const dp = (e.clientY - dragging.y) * k;
    yaw = THREE.MathUtils.clamp(yaw + dy, -YAW_LIMIT, YAW_LIMIT);
    pitch = THREE.MathUtils.clamp(pitch + dp, -PITCH_LIMIT, PITCH_LIMIT);
    vYaw = vYaw * 0.5 + (dy / dt) * 0.5;
    vPitch = vPitch * 0.5 + (dp / dt) * 0.5;
    dragging.x = e.clientX;
    dragging.y = e.clientY;
    dragging.t = t;
    userAt = now;
  });
  const release = (e) => {
    if (!dragging || e.pointerId !== dragging.id) return;
    if (performance.now() - dragging.t > 80) vYaw = vPitch = 0;
    dragging = null;
    userAt = now;
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  function nudge(dYaw) {
    yaw = THREE.MathUtils.clamp(yaw + dYaw, -YAW_LIMIT, YAW_LIMIT);
    userAt = now;
  }

  function target() {
    while (glances.length && glances[0].until <= now) glances.shift();
    if (glances.length) return glances[0];
    if (auto && auto.until > now) return auto;
    return { yaw: restYaw ?? 0, pitch: 0 };
  }

  function update(view, dt) {
    now += dt;
    if (view) {
      group.position.set(view.x, 0, view.z);
      group.rotation.y = -view.heading;
      wheel.rotation.z = view.steer * STEERING_RATIO;
      const mph = Math.round(view.speed / 0.44704);
      speedo.draw(mph, view.indicator === 'left' && view.lamp, view.indicator === 'right' && view.lamp);
    }

    if (!dragging) {
      const idle = now - userAt;
      yaw += vYaw * dt;
      pitch += vPitch * dt;
      const decay = Math.exp(-dt * 5);
      vYaw *= decay;
      vPitch *= decay;
      // After a drag, hold where the user looked for a moment, then ease back to the current target.
      if (idle > 1.4) {
        const t = target();
        const k = 1 - Math.exp(-dt * (glances.length ? 7 : 2.6));
        yaw += (t.yaw - yaw) * k;
        pitch += (t.pitch - pitch) * k;
      }
      yaw = THREE.MathUtils.clamp(yaw, -YAW_LIMIT, YAW_LIMIT);
      pitch = THREE.MathUtils.clamp(pitch, -PITCH_LIMIT, PITCH_LIMIT);
    }

    let bob = 0;
    let lean = 0;
    if (!reducedMotion && view) {
      bobPhase += view.speed * dt * 1.6;
      bob = Math.sin(bobPhase) * 0.0035 * Math.min(1, view.speed / 8);
      const latAcc = view.speed * view.speed * Math.tan(view.steer) / 2.55;
      lean = THREE.MathUtils.clamp(-latAcc * 0.006, -0.03, 0.03);
    }
    roll += (lean - roll) * Math.min(1, dt * 4);
    head.position.set(EYE.x + roll * 0.4, EYE.y + bob, EYE.z);
    head.rotation.set(BASE_PITCH + pitch, yaw, roll);
  }

  function renderMirrors(renderer, scene, frame) {
    if (!mirrorsOn || !inside.visible || frame % 2) return;
    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rearRT);
    renderer.render(scene, rearCam);
    renderer.setRenderTarget(wingRT);
    renderer.render(scene, wingCam);
    renderer.setRenderTarget(prev);
  }

  function setMirrors(on) {
    mirrorsOn = on;
    for (const g of [rearGlass, wingGlass]) {
      g.material.map = on ? g.userData.rt.texture : null;
      g.material.color.set(on ? '#ffffff' : '#3a4048');
      g.material.needsUpdate = true;
    }
  }

  return {
    group,
    camera,
    update,
    renderMirrors,
    nudge,
    look(y, p = 0, hold = 1.5) { auto = { yaw: y, pitch: p, until: now + hold }; },
    rest(y) { restYaw = y; },
    glanceMirrors() {
      glances.length = 0;
      // Angles from the eye to the rear-view glass, then to the left wing glass.
      glances.push({ yaw: 0.43, pitch: 0.22, until: now + 0.5 }, { yaw: 1.01, pitch: -0.03, until: now + 1.2 });
    },
    resetLook() { yaw = pitch = vYaw = vPitch = 0; auto = null; restYaw = null; glances.length = 0; userAt = -Infinity; },
    setAspect(a) {
      camera.aspect = a;
      const v = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(H_FOV / 2) / a));
      camera.fov = THREE.MathUtils.clamp(v, V_FOV_MIN, V_FOV_MAX);
      camera.updateProjectionMatrix();
    },
    setQuality(q) { quality = q; setMirrors(q !== 'low'); },
    get quality() { return quality; },
    setVisible(on) { inside.visible = on; },
    setPaint(hex) { paint.color.set(hex); },
    get yaw() { return yaw; },
  };
}
