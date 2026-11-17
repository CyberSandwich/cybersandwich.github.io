/**
 * three.js view of the car park as a diorama: a raised plinth with the paved lot, kerbed verges, trees and street
 * furniture, two parked cars, the car and the full-lock trace.
 * Plane (x, y) from lot.js and polo.js maps to three as X = x, Z = -y, Y up, so a top view with -Z up the screen is
 * the plane as drawn on paper. Grab3D models face +Z with +X their left; rotation.y = h + PI/2 points one along h.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { POLO, CENTRE_U, corners, wheelAngles } from './polo.js';
import { CAR_URL, PROP_URLS, PAVE, rng, dressingFor, paintKit } from './decor.js';

// The model's own wheelbase and front track (roundabout/assets/models/meta.json): scaled to the Polo's.
const MODEL = { axleZ: 1.28, track: 1.44, wheelR: 0.31 };
const SZ = POLO.wheelbase / (2 * MODEL.axleZ);
const SX = POLO.trackFront / MODEL.track;
const H = { pave: 0.001, bay: 0.003, mark: 0.004, over: 0.006, band: 0.01, ribbon: 0.012 };
const FOV = 40;
/** The default view leans this far off vertical (rad), enough to see the plinth's sides and the trees standing. */
const TILT = 0.36;
/** Plinth (m): verge width past the kerb, depth, kerb size. */
const VERGE = 5, PLINTH = 1.4, KERB = { w: 0.18, h: 0.12 };

/** Flat geometry facing up from triangles given as plane points. */
function flatGeometry(pos) {
  const g = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const n = new Float32Array(pos.length);
  for (let i = 1; i < n.length; i += 3) n[i] = 1;
  return g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
}

/** Triangles for axis-aligned plane rects [xa, ya, xb, yb] at height h (counter-clockwise from above). */
function rectsGeometry(rects, h) {
  const pos = [];
  for (const [xa, ya, xb, yb] of rects) {
    const a = [xa, h, -ya], b = [xb, h, -ya], c = [xb, h, -yb], d = [xa, h, -yb];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return flatGeometry(pos);
}

/** Triangles for plane polygons (each a convex loop of [x, y]) at height h. */
function polysGeometry(polys, h) {
  const pos = [];
  for (const p of polys) for (let i = 1; i < p.length - 1; i++) {
    for (const q of [p[0], p[i], p[i + 1]]) pos.push(q[0], h, -q[1]);
  }
  return flatGeometry(pos);
}

/** A flat strip of width w along a plane polyline, as convex quads. */
function ribbon(points, w) {
  const quads = [];
  for (let i = 0; i < points.length - 1; i++) {
    const [ax, ay] = points[i], [bx, by] = points[i + 1];
    const dx = bx - ax, dy = by - ay, l = Math.hypot(dx, dy);
    if (l < 1e-6) continue;
    const nx = -dy / l * w / 2, ny = dx / l * w / 2;
    quads.push([[ax + nx, ay + ny], [bx + nx, by + ny], [bx - nx, by - ny], [ax - nx, ay - ny]]);
  }
  return quads;
}

/** Arrow pointing along heading h from (x, y): a 2 m stem and a 1 m head (painted-arrow proportions, scaled down). */
function arrowPolys({ x, y, h }) {
  const c = Math.cos(h), s = Math.sin(h);
  const at = ([u, v]) => [x + u * c - v * s, y + u * s + v * c];
  return [
    [[-1.5, -0.15], [0.5, -0.15], [0.5, 0.15], [-1.5, 0.15]].map(at),
    [[0.5, -0.5], [1.5, 0], [0.5, 0.5]].map(at),
  ];
}

// Overlays are double-sided: z = -y mirrors winding, so a loop clockwise on the plane (corners(), ribbons) faces down.
const basic = (opts) => new THREE.MeshBasicMaterial({ depthWrite: false, side: THREE.DoubleSide, ...opts });
const lit = (opts) => new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0, ...opts });

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(0x000000, 0);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.45;
  controls.minDistance = 6;
  controls.maxDistance = 120;
  controls.screenSpacePanning = true;

  const hemi = new THREE.HemisphereLight(0xffffff, 0xffffff, 1.4);
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  Object.assign(sun.shadow.camera, { left: -32, right: 32, top: 32, bottom: -32, near: 1, far: 120 });
  scene.add(hemi, sun, sun.target);

  const colours = {};
  const mats = {
    pave: lit({}),
    grass: lit({}),
    soil: lit({}),
    kerb: lit({}),
    mark: lit({ roughness: 0.7 }),
    target: basic({ transparent: true, opacity: 0.18 }),
    bad: basic({}),
    ribbon: basic({ transparent: true, opacity: 0.9 }),
    // The swept band: the stencil lets each pixel blend once, so overlapping footprints read as one even tint.
    band: basic({
      transparent: true, opacity: 0.24, stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }),
    contact: basic({ color: 0x000000, transparent: true, opacity: 0.16 }),
  };
  const parkedPaint = [];
  let changed = true; // async content landed: the next render() draws

  const lotGroup = new THREE.Group();
  const dressGroup = new THREE.Group();
  const parkedGroup = new THREE.Group();
  const overGroup = new THREE.Group();
  const traceGroup = new THREE.Group();
  scene.add(lotGroup, dressGroup, parkedGroup, overGroup, traceGroup);

  const dispose = (group) => {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse?.((c) => { if (c.geometry && !c.userData.shared) c.geometry.dispose(); });
    }
  };
  const box = new THREE.BoxGeometry(1, 1, 1);
  const contactGeo = new THREE.PlaneGeometry(POLO.width + 0.1, POLO.length + 0.2).rotateX(-Math.PI / 2);
  const mesh = (g, m, { cast = true, receive = true, keep = false } = {}) => {
    const o = new THREE.Mesh(g, m);
    o.castShadow = cast;
    o.receiveShadow = receive;
    if (keep) o.userData.shared = true;
    return o;
  };

  /** A box from plane rect [xa, ya, xb, yb] and heights y0..y1. */
  function block([xa, ya, xb, yb], y0, y1, m) {
    const o = mesh(box, m, { keep: true });
    o.scale.set(xb - xa, y1 - y0, yb - ya);
    o.position.set((xa + xb) / 2, (y0 + y1) / 2, -(ya + yb) / 2);
    return o;
  }

  /** A model clone placed on the plane facing heading h; clones share the source's geometry. */
  function placed(src, { x, y, h, k = 1 }) {
    const o = src.clone(true);
    o.traverse((c) => { if (c.isMesh) c.userData.shared = true; });
    o.scale.multiplyScalar(k);
    o.position.set(x, 0, -y);
    o.rotation.y = h + Math.PI / 2;
    return o;
  }

  // Props load after the car, each on its own: a missing one leaves a gap, never a broken scene.
  const loader = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
  const props = {};
  const shadowed = (root) => { root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } }); return root; };

  let lot = null, dressing = [];
  function dress() {
    dispose(dressGroup);
    for (const d of dressing) if (props[d.name]) dressGroup.add(placed(props[d.name], d));
    changed = true;
  }

  function setLot(l) {
    lot = l;
    dispose(lotGroup);
    const { xMin: X0, xMax: X1 } = l.bounds;
    const yOut = (s) => l.backY(s) + s * (PAVE + VERGE);
    const kerbY = (s) => l.backY(s) + s * PAVE;
    // Plinth: grass on top, soil on the sides.
    const plinth = mesh(new THREE.BoxGeometry(X1 - X0, PLINTH, yOut(1) - yOut(-1)),
      [mats.soil, mats.soil, mats.grass, mats.soil, mats.soil, mats.soil], { cast: false });
    plinth.position.set((X0 + X1) / 2, -PLINTH / 2, 0);
    lotGroup.add(plinth);
    // Paving: the aisle end to end, and the two rows out to their kerbs.
    const rx0 = l.xMin - PAVE, rx1 = l.xMax + PAVE;
    lotGroup.add(mesh(rectsGeometry([
      [X0, l.edgeY(-1), X1, l.edgeY(1)],
      [rx0, l.edgeY(1), rx1, kerbY(1)],
      [rx0, kerbY(-1), rx1, l.edgeY(-1)],
    ], H.pave), mats.pave, { cast: false }));
    // Kerbs round each row: along the back and down both ends to the aisle.
    for (const s of [1, -1]) {
      const yk = kerbY(s);
      const ya = Math.min(yk, yk + s * KERB.w), yb = Math.max(yk, yk + s * KERB.w);
      lotGroup.add(block([rx0 - KERB.w, ya, rx1 + KERB.w, yb], 0, KERB.h, mats.kerb));
      const ye = l.edgeY(s);
      const [ea, eb] = [Math.min(ye, yk), Math.max(ye, yk)];
      lotGroup.add(block([rx0 - KERB.w, ea, rx0, eb], 0, KERB.h, mats.kerb));
      lotGroup.add(block([rx1, ea, rx1 + KERB.w, eb], 0, KERB.h, mats.kerb));
    }
    const marks = mesh(rectsGeometry([...l.marks.map((m) => m.r), ...l.dashes], H.mark), mats.mark, { cast: false });
    marks.add(mesh(polysGeometry(l.arrows.flatMap(arrowPolys), H.mark), mats.mark, { cast: false }));
    lotGroup.add(marks);
    dressing = dressingFor(l);
    dress();

    // Light from behind the left shoulder of the top view, aimed at the lot's centre.
    const cx = (X0 + X1) / 2;
    sun.target.position.set(cx, 0, 0);
    sun.position.set(cx - 16, 34, 18);
    parkedKey = null;
    if (pendingTarget) setParked(pendingTarget);
  }

  // The car: loaded first; ghosts and parked cars are clones.
  let car = null, carModel = null;
  const carRoot = new THREE.Group();
  // In the root's frame +Z is the nose and the origin the rear axle, so the body centre is at Z = CENTRE_U.
  const contactAt = (parent, z) => {
    const c = mesh(contactGeo, mats.contact, { cast: false, receive: false, keep: true });
    c.position.set(0, H.band, z);
    parent.add(c);
  };
  contactAt(carRoot, CENTRE_U);
  scene.add(carRoot);
  const kits = {}; // model name -> paintKit, built from the untouched source
  const ready = loader.loadAsync(CAR_URL).then((g) => {
    carModel = shadowed(g.scene);
    kits.hatch = paintKit(carModel);
    carModel.scale.set(SX, SZ, SZ);
    carModel.position.z = MODEL.axleZ * SZ;
    const holder = new THREE.Group();
    holder.add(carModel);
    const wheels = {};
    carModel.traverse((o) => { if (/^wheel_/.test(o.name)) { o.rotation.order = 'YXZ'; wheels[o.name] = o; } });
    car = { holder, wheels };
    carRoot.add(holder);
    applyPaint();
    if (pendingTarget) setParked(pendingTarget);
    for (const [name, url] of Object.entries(PROP_URLS)) {
      loader.loadAsync(url).then((p) => {
        props[name] = shadowed(p.scene);
        if (name === 'estate') { kits.estate = paintKit(props.estate); parkedKey = null; setParked(pendingTarget); } else dress();
      }, () => {});
    }
  });

  function placeRoot(obj, pose) {
    obj.position.set(pose.x, 0, -pose.y);
    obj.rotation.y = pose.h + Math.PI / 2;
  }

  function setCar(pose, steer, travelled) {
    placeRoot(carRoot, pose);
    if (!car) return;
    const a = wheelAngles(steer);
    const spin = travelled / MODEL.wheelR;
    for (const [name, w] of Object.entries(car.wheels)) {
      w.rotation.x = spin;
      w.rotation.y = name === 'wheel_FL' ? a.left : name === 'wheel_FR' ? a.right : 0;
    }
  }

  /**
   * Two parked cars: one beside the target (the far side, or the near side at the row's end), where a wide sweep
   * would hit it, and one across the aisle. Model, paint and nose in or out are seeded. The models' origin is midway
   * between the axles, close to the body centre.
   */
  let parkedKey = null, pendingTarget = null;
  function setParked(target) {
    if (!target) return;
    pendingTarget = target;
    const key = `${target.s}:${target.i}`;
    if (!carModel || !lot || key === parkedKey) return;
    parkedKey = key;
    dispose(parkedGroup);
    const r = rng(11);
    const beside = target.i + 1 < lot.nBays ? target.i + 1 : target.i - 1;
    const across = target.i > 0 ? target.i - 1 : target.i + 1;
    for (const [s, i] of [[target.s, beside], [-target.s, across]]) {
      const [nose, jitter, paint, estate] = [r() < 0.5, r() - 0.5, Math.floor(r() * 64), r() < 0.35];
      const model = estate && props.estate ? 'estate' : 'hatch';
      const h = s * (nose ? 1 : -1) * Math.PI / 2 + jitter * 0.05;
      const g = new THREE.Group();
      placeRoot(g, { x: lot.bayX(i) + jitter * 0.15, y: lot.rowCentreY(s), h });
      const c = (model === 'estate' ? props.estate : carModel).clone(true);
      // The own car's clone carries its Polo scaling and axle offset: undo the offset to centre it.
      if (model === 'hatch') c.position.z = 0;
      const repaint = parkedPaint.length ? kits[model](parkedPaint[paint % parkedPaint.length]) : null;
      c.traverse((o) => { if (o.isMesh) { o.userData.shared = true; repaint?.(o); } });
      g.add(c);
      contactAt(g, 0);
      parkedGroup.add(g);
    }
    changed = true;
  }

  /** Overlays: the target bay's tint and lines with a tyre over them; parked cars fill the other bays. */
  function setHighlights({ target, bad = [] }) {
    dispose(overGroup);
    setParked(target);
    overGroup.add(new THREE.Mesh(rectsGeometry([lot.bayRect(target.s, target.i)], H.bay), mats.target));
    const rectOf = (s, i) => lot.marks.find((m) => m.kind === 'side' && m.s === s && m.i === i).r;
    if (bad.length) overGroup.add(new THREE.Mesh(rectsGeometry(bad.map((b) => b.back
      ? lot.marks.find((m) => m.kind === 'back' && m.s === b.s).r : rectOf(b.s, b.i)), H.over), mats.bad));
  }

  /** The swept band and corner paths of a sweep's poses. */
  function setTrace(poses) {
    dispose(traceGroup);
    if (!poses || poses.length < 2) return;
    const pick = poses.filter((_, i) => i % 2 === 0 || i === poses.length - 1);
    traceGroup.add(new THREE.Mesh(polysGeometry(pick.map(corners), H.band), mats.band));
    const paths = [[], [], [], []];
    for (const p of poses) corners(p).forEach((c, k) => paths[k].push(c));
    traceGroup.add(new THREE.Mesh(polysGeometry(paths.flatMap((p) => ribbon(p, 0.05)), H.ribbon), mats.ribbon));
  }

  function css(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }
  function applyPaint() {
    if (carModel) carModel.traverse(kits.hatch(css('--pk-paint')));
  }
  const TOKENS = ['pave', 'grass', 'soil', 'kerb', 'line', 'sky', 'sun', 'trace', 'bad', 'target', 'paint'];
  function setTheme() {
    for (const k of TOKENS) colours[k] = new THREE.Color(css(`--pk-${k}`) || '#888');
    for (const k of ['pave', 'grass', 'soil', 'kerb', 'target', 'bad']) mats[k].color.copy(colours[k]);
    mats.mark.color.copy(colours.line);
    mats.band.color.copy(colours.trace);
    mats.ribbon.color.copy(colours.trace);
    hemi.color.copy(colours.sky);
    hemi.groundColor.copy(colours.grass);
    sun.color.copy(colours.sun);
    renderer.toneMappingExposure = Number(css('--pk-exposure')) || 1;
    const cars = css('--pk-cars').split(',').map((c) => c.trim()).filter(Boolean);
    if (cars.join() !== parkedPaint.join()) { parkedPaint.splice(0, Infinity, ...cars); parkedKey = null; setParked(pendingTarget); }
    applyPaint();
    changed = true;
  }

  // Camera: fitted so `focus` (a plane rect) fills the free screen area between the panels, then leaned back by TILT
  // for the diorama look (the fit is exact top down and close at this lean). Portrait turns the aisle up the screen
  // so the car drives "up".
  let anim = null;
  function topView(instant, focus, free) {
    const W = canvas.clientWidth, Hh = canvas.clientHeight;
    const portrait = W < Hh;
    const t = Math.tan(FOV * Math.PI / 360);
    const fw = Math.max(120, free.r - free.l), fh = Math.max(120, free.b - free.t);
    const spanX = focus.x1 - focus.x0, spanY = focus.y1 - focus.y0;
    const [vert, hor] = portrait ? [spanX, spanY] : [spanY, spanX];
    const dist = Math.max(vert * Hh / (2 * t * fh), hor * Hh / (2 * t * fw));
    const wpp = 2 * dist * t / Hh; // metres per pixel on the ground
    // Screen up and right as world directions.
    const up = portrait ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, -1);
    const right = portrait ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const fx = (free.l + free.r) / 2 - W / 2, fy = (free.t + free.b) / 2 - Hh / 2;
    const target = new THREE.Vector3((focus.x0 + focus.x1) / 2, 0, -(focus.y0 + focus.y1) / 2)
      .addScaledVector(right, -fx * wpp).addScaledVector(up, fy * wpp);
    const pos = target.clone().addScaledVector(new THREE.Vector3(0, 1, 0), dist * Math.cos(TILT))
      .addScaledVector(up, -dist * Math.sin(TILT));
    if (instant) { camera.position.copy(pos); controls.target.copy(target); controls.update(); anim = null; return; }
    anim = { t0: performance.now(), from: camera.position.clone(), fromT: controls.target.clone(), pos, target };
  }

  function resize() {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  const ray = new THREE.Raycaster();
  const flat = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  /** Plane point under a client position, or null. */
  function pick(cx, cy) {
    const r = canvas.getBoundingClientRect();
    ray.setFromCamera(new THREE.Vector2((cx - r.left) / r.width * 2 - 1, -((cy - r.top) / r.height) * 2 + 1), camera);
    const hit = ray.ray.intersectPlane(flat, new THREE.Vector3());
    return hit ? [hit.x, -hit.z] : null;
  }

  /** Draws a frame when forced, when content landed, or when the camera moved; idle frames cost nothing. */
  function render(now, force) {
    const animating = !!anim;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / 500), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(anim.from, anim.pos, e);
      controls.target.lerpVectors(anim.fromT, anim.target, e);
      if (k === 1) anim = null;
    }
    const moved = controls.update();
    if (force || changed || animating || moved) renderer.render(scene, camera);
    changed = false;
  }

  return { ready, controls, setLot, setHighlights, setCar, setTrace, setTheme, topView, resize, pick, render };
}
