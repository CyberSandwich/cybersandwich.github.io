/**
 * three.js view of the car park: ground, painted lines, the car, the full-lock trace and the turn-point ghosts.
 * Plane (x, y) from lot.js and polo.js maps to three as X = x, Z = -y, Y up, so a top view with -Z up the screen is
 * the plane as drawn on paper. The Grab3D hatch faces +Z with +X its left; rotation.y = h + PI/2 points it along h.
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { POLO, CENTRE_U, corners, wheelAngles } from './polo.js';

// Shared with /roundabout (built by scripts/build-roundabout-assets.sh).
const CAR_URL = '/roundabout/assets/models/hatch.glb';
// The model's own wheelbase and front track (roundabout/assets/models/meta.json): scaled to the Polo's.
const MODEL = { axleZ: 1.28, track: 1.44, wheelR: 0.31 };
const SZ = POLO.wheelbase / (2 * MODEL.axleZ);
const SX = POLO.trackFront / MODEL.track;
const H = { ground: 0, bay: 0.002, mark: 0.004, over: 0.006, band: 0.01, ribbon: 0.012 };
const FOV = 40;

/** Triangles for axis-aligned plane rects [xa, ya, xb, yb] at height h. */
function rectsGeometry(rects, h) {
  const pos = [];
  for (const [xa, ya, xb, yb] of rects) {
    const a = [xa, h, -ya], b = [xb, h, -ya], c = [xb, h, -yb], d = [xa, h, -yb];
    pos.push(...a, ...b, ...c, ...a, ...c, ...d);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
}

/** Triangles for plane polygons (each a convex loop of [x, y]) at height h. */
function polysGeometry(polys, h) {
  const pos = [];
  for (const p of polys) for (let i = 1; i < p.length - 1; i++) {
    for (const q of [p[0], p[i], p[i + 1]]) pos.push(q[0], h, -q[1]);
  }
  return new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
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

// Double-sided: z = -y mirrors winding, so a loop clockwise on the plane (corners(), ribbons) faces down.
const basic = (opts) => new THREE.MeshBasicMaterial({ depthWrite: false, side: THREE.DoubleSide, ...opts });

export function createScene(canvas) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.maxPolarAngle = Math.PI * 0.47;
  controls.minDistance = 6;
  controls.maxDistance = 90;
  controls.screenSpacePanning = true;

  scene.add(new THREE.HemisphereLight(0xffffff, 0x666666, 1.6));
  const sun = new THREE.DirectionalLight(0xffffff, 1.6);
  sun.position.set(-8, 20, 6);
  scene.add(sun);

  const colours = {};
  const mats = {
    ground: new THREE.MeshBasicMaterial(),
    mark: basic({}),
    target: basic({ transparent: true, opacity: 0.16 }),
    cue: basic({}),
    bad: basic({}),
    ribbon: basic({ transparent: true, opacity: 0.9 }),
    // The swept band: the stencil lets each pixel blend once, so overlapping footprints read as one even tint.
    band: basic({
      transparent: true, opacity: 0.22, stencilWrite: true, stencilRef: 1,
      stencilFunc: THREE.NotEqualStencilFunc, stencilZPass: THREE.ReplaceStencilOp,
    }),
    ghost: new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.32, roughness: 0.6 }),
    ghostEdge: basic({ transparent: true, opacity: 0.9 }),
    shadow: basic({ color: 0x000000, transparent: true, opacity: 0.22 }),
  };

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), mats.ground);
  scene.add(ground);
  const lotGroup = new THREE.Group();
  const overGroup = new THREE.Group();
  const traceGroup = new THREE.Group();
  const ghostGroup = new THREE.Group();
  scene.add(lotGroup, overGroup, traceGroup, ghostGroup);

  const dispose = (group) => {
    for (const o of [...group.children]) {
      group.remove(o);
      o.traverse?.((c) => { if (c.geometry && !c.userData.shared) c.geometry.dispose(); });
    }
  };

  let lot = null;
  function setLot(l) {
    lot = l;
    dispose(lotGroup);
    const geo = rectsGeometry([...l.marks.map((m) => m.r), ...l.dashes], H.mark);
    lotGroup.add(new THREE.Mesh(geo, mats.mark));
    lotGroup.add(new THREE.Mesh(polysGeometry(l.arrows.flatMap(arrowPolys), H.mark), mats.mark));
  }

  /** Overlays: the target bay's tint, the cue line, and lines with a tyre over them. */
  function setHighlights({ target, cueLine, bad = [] }) {
    dispose(overGroup);
    if (target) overGroup.add(new THREE.Mesh(rectsGeometry([lot.bayRect(target.s, target.i)], H.bay), mats.target));
    const rectOf = (s, i) => lot.marks.find((m) => m.kind === 'side' && m.s === s && m.i === i).r;
    if (cueLine) overGroup.add(new THREE.Mesh(rectsGeometry([rectOf(cueLine.s, cueLine.i)], H.over), mats.cue));
    if (bad.length) overGroup.add(new THREE.Mesh(rectsGeometry(bad.map((b) => b.back
      ? lot.marks.find((m) => m.kind === 'back' && m.s === b.s).r : rectOf(b.s, b.i)), H.over + 0.001), mats.bad));
  }

  // The car: loaded once; ghosts are clones in one translucent material.
  let car = null, carModel = null;
  const carRoot = new THREE.Group();
  // In the root's frame +Z is the nose and the origin the rear axle, so the body centre is at Z = CENTRE_U.
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(POLO.width + 0.1, POLO.length + 0.2).rotateX(-Math.PI / 2), mats.shadow);
  shadow.position.set(0, H.band, CENTRE_U);
  carRoot.add(shadow);
  scene.add(carRoot);
  const ready = new GLTFLoader().setMeshoptDecoder(MeshoptDecoder).loadAsync(CAR_URL).then((g) => {
    carModel = g.scene;
    carModel.scale.set(SX, SZ, SZ);
    carModel.position.z = MODEL.axleZ * SZ;
    const holder = new THREE.Group();
    holder.add(carModel);
    const wheels = {};
    carModel.traverse((o) => {
      if (/^wheel_/.test(o.name)) { o.rotation.order = 'YXZ'; wheels[o.name] = o; }
      if (o.isMesh && /paint/i.test(o.material.name)) { o.material = o.material.clone(); o.userData.paint = true; }
    });
    car = { holder, wheels };
    carRoot.add(holder);
    applyPaint();
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

  function ghostAt(pose) {
    const g = new THREE.Group();
    placeRoot(g, pose);
    if (carModel) {
      const c = carModel.clone(true);
      c.traverse((o) => { if (o.isMesh) { o.material = mats.ghost; o.userData.shared = true; } });
      g.add(c);
    }
    const loop = corners({ x: 0, y: 0, h: 0 });
    // Outline in the root frame: plane (u, v) -> model (X = v, Z = u).
    const outline = ribbon([...loop, loop[0]].map(([u, v]) => [v, -u]), 0.05);
    g.add(new THREE.Mesh(polysGeometry(outline, H.ribbon), mats.ghostEdge));
    return g;
  }

  /** Ghost cars at the given poses (turn point and end), or none. */
  function setGhosts(poses) {
    dispose(ghostGroup);
    for (const p of poses || []) ghostGroup.add(ghostAt(p));
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
    carModel?.traverse((o) => { if (o.userData.paint) o.material.color.set(colours.paint); });
  }
  function setTheme() {
    for (const k of ['ground', 'line', 'trace', 'ghost', 'bad', 'target', 'paint']) colours[k] = new THREE.Color(css(`--pk-${k}`) || '#888');
    mats.ground.color.copy(colours.ground);
    mats.mark.color.copy(colours.line);
    mats.target.color.copy(colours.target);
    mats.cue.color.copy(colours.trace);
    mats.bad.color.copy(colours.bad);
    mats.band.color.copy(colours.trace);
    mats.ribbon.color.copy(colours.trace);
    mats.ghost.color.copy(colours.ghost);
    mats.ghostEdge.color.copy(colours.ghost);
    renderer.setClearColor(colours.ground);
    applyPaint();
  }

  // Camera: the top view fits both rows; portrait turns the aisle up the screen so the car drives "up".
  let anim = null;
  function topView(instant) {
    const w = canvas.clientWidth, h = canvas.clientHeight;
    const aspect = w / h;
    const portrait = aspect < 1;
    const spanX = lot.xMax - lot.xMin + 6, spanY = lot.bounds.yMax - lot.bounds.yMin;
    const [across, along] = portrait ? [spanY, spanX] : [spanX, spanY];
    const t = Math.tan(FOV * Math.PI / 360);
    // Room for the panels: about a third of the height is UI on a phone.
    const dist = Math.max(along / 2 / t / (portrait ? 0.62 : 0.72), across / 2 / t / aspect / 0.94);
    const target = new THREE.Vector3((lot.xMin + lot.xMax) / 2, 0, 0);
    const pos = target.clone().add(portrait ? new THREE.Vector3(-1e-3, dist, 0) : new THREE.Vector3(0, dist, 1e-3));
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

  /** Draws a frame when forced or when the camera moved (orbit, damping, the Top animation); idle frames cost nothing. */
  function render(now, force) {
    const animating = !!anim;
    if (anim) {
      const k = Math.min(1, (now - anim.t0) / 500), e = k * k * (3 - 2 * k);
      camera.position.lerpVectors(anim.from, anim.pos, e);
      controls.target.lerpVectors(anim.fromT, anim.target, e);
      if (k === 1) anim = null;
    }
    const moved = controls.update();
    if (force || animating || moved) renderer.render(scene, camera);
  }

  return { ready, controls, setLot, setHighlights, setCar, setGhosts, setTrace, setTheme, topView, resize, pick, render };
}
