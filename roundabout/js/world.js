/**
 * The static world, from gen.js layout data.
 *
 *   const env = createEnvironment(renderer, scene)   sky, fog, lights, reflections; env.setTheme(name) -> palette
 *   const world = buildWorld(layout, { base })        road, kerbs, pavements, markings, signs (sync, fast)
 *   await world.dress(quality)                        scenery GLBs (call after the first frame)
 *   world.setTheme(palette)  world.showRoute(on)  world.dispose()
 *
 * Draw budget: every static surface is merged by material: grass, asphalt, concrete (pavements, kerbs,
 * splitters, island edge), markings (one atlas: line texel + arrow tiles), sign faces x2, sign backs + posts.
 * Scenery is instanced per flattened part. Frame: geom.js (x east, z south, compass bearings).
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlb, flatten } from './gltf.js';
import { createRng } from './rng.js';
import { TAU, dir, bearingOf, wrap2Pi, wrapPi, dot, len } from './geom.js';
import { blobTexture } from './vehicles.js';

export const PALETTES = {
  light: {
    skyTop: '#86a8c6', skyHorizon: '#dde4ea', skyBottom: '#b9c0b4', fogDensity: 0.0062,
    sun: '#fff3e0', sunI: 2.2, sunDir: [-0.45, 0.8, 0.4], hemiSky: '#e3ebf3', hemiGround: '#5f6650', hemiI: 1.15,
    envI: 0.55, shadow: 0.36, leds: 0, exposure: 1.0,
  },
  dark: {
    skyTop: '#121927', skyHorizon: '#56505e', skyBottom: '#2b2a2c', fogDensity: 0.0078,
    sun: '#ffc79a', sunI: 0.55, sunDir: [0.7, 0.18, 0.5], hemiSky: '#6b7898', hemiGround: '#24231f', hemiI: 0.95,
    envI: 0.45, shadow: 0.5, leds: 2.2, exposure: 1.15,
  },
  sepia: {
    skyTop: '#b49e7a', skyHorizon: '#eedcbf', skyBottom: '#c2b08f', fogDensity: 0.0068,
    sun: '#ffd49a', sunI: 2.3, sunDir: [0.6, 0.45, 0.55], hemiSky: '#f1e1c3', hemiGround: '#6b5a40', hemiI: 1.0,
    envI: 0.5, shadow: 0.34, leds: 0, exposure: 1.0,
  },
};

const ROAD_TILE = 5;
const GRASS_TILE = 6;
const PAVE_TILE = 2.5;
const PAVEMENT = 2.2;
const KERB_H = 0.12;
const FAR = 650; // axial reach of the arms into the fog
const MARK_Y = 0.015;

// ---------- environment ----------

function skyMaterial() {
  return new THREE.ShaderMaterial({
    uniforms: { top: { value: new THREE.Color() }, horizon: { value: new THREE.Color() }, bottom: { value: new THREE.Color() } },
    vertexShader: `
      varying vec3 vDir;
      void main() {
        vDir = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        gl_Position.z = gl_Position.w;
      }`,
    fragmentShader: `
      uniform vec3 top; uniform vec3 horizon; uniform vec3 bottom; varying vec3 vDir;
      void main() {
        float h = normalize(vDir).y;
        vec3 c = h > 0.0 ? mix(horizon, top, pow(smoothstep(0.0, 1.0, h), 0.55)) : mix(horizon, bottom, smoothstep(0.0, 0.15, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide, depthWrite: false, fog: false,
  });
}

export function createEnvironment(renderer, scene) {
  const sky = new THREE.Mesh(new THREE.SphereGeometry(500, 32, 16), skyMaterial());
  sky.frustumCulled = false;
  sky.renderOrder = -1;
  sky.onBeforeRender = (r, s, camera) => { sky.position.copy(camera.position); sky.updateMatrixWorld(); };
  scene.add(sky);
  scene.fog = new THREE.FogExp2(0xffffff, 0.006);
  const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  scene.add(hemi, sun);

  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const envSky = new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), skyMaterial());
  envScene.add(envSky);
  let envRT = null;

  function setTheme(name) {
    const p = PALETTES[name] ?? PALETTES.light;
    for (const m of [sky.material, envSky.material]) {
      m.uniforms.top.value.set(p.skyTop);
      m.uniforms.horizon.value.set(p.skyHorizon);
      m.uniforms.bottom.value.set(p.skyBottom);
    }
    scene.fog.color.set(p.skyHorizon);
    scene.fog.density = p.fogDensity;
    hemi.color.set(p.hemiSky);
    hemi.groundColor.set(p.hemiGround);
    hemi.intensity = p.hemiI;
    sun.color.set(p.sun);
    sun.intensity = p.sunI;
    sun.position.set(...p.sunDir).multiplyScalar(100);
    renderer.toneMappingExposure = p.exposure;
    envRT?.dispose();
    envRT = pmrem.fromScene(envScene, 0, 0.1, 100);
    scene.environment = envRT.texture;
    scene.environmentIntensity = p.envI;
    return p;
  }
  return { setTheme, sky };
}

// ---------- textures ----------

const texCache = new Map();
function texture(url, tile) {
  if (!texCache.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    texCache.set(url, t);
  }
  const t = texCache.get(url);
  t.userData.tile = tile;
  return t;
}

// ---------- mesh building ----------

// Indexed triangles with position, normal, uv, colour; tri() orients each triangle to its first vertex's normal.
class Mesher {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; }
  v(x, y, z, nx, ny, nz, u, w, c = 1) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.c.push(c, c, c);
    return this.p.length / 3 - 1;
  }
  tri(a, b, c) {
    const P = this.p;
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const vx = P[c * 3] - P[a * 3], vy = P[c * 3 + 1] - P[a * 3 + 1], vz = P[c * 3 + 2] - P[a * 3 + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const N = this.n;
    if (nx * N[a * 3] + ny * N[a * 3 + 1] + nz * N[a * 3 + 2] < 0) this.i.push(a, c, b);
    else this.i.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.n, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.c, 3));
    g.setIndex(this.i);
    return g;
  }
}

// Flat polygon at height y (world-space uv / tile), triangulated by earcut.
function polygon(mesh, pts, y, tile, c = 1) {
  const base = pts.map(([x, z]) => mesh.v(x, y, z, 0, 1, 0, x / tile, -z / tile, c));
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, b, c2] of faces) mesh.tri(base[a], base[b], base[c2]);
}

const leftOf2 = (d) => [d[1], -d[0]];
const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

// Per-vertex left normals of a polyline (mitred, capped so tight bends cannot spike).
function leftNormals(pts) {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    const d0 = norm2(i > 0 ? [p[0] - a[0], p[1] - a[1]] : [b[0] - p[0], b[1] - p[1]]);
    const d1 = norm2(i < pts.length - 1 ? [b[0] - p[0], b[1] - p[1]] : d0);
    const n = norm2(leftOf2([d0[0] + d1[0], d0[1] + d1[1]]));
    const k = 1 / Math.max(0.6, dot(n, leftOf2(d0)));
    return [n[0] * k, n[1] * k];
  });
}

const offset = (pts, normals, d) => pts.map((p, i) => [p[0] + normals[i][0] * d, p[1] + normals[i][1] * d]);

// Cumulative arc length of a polyline.
const arcLengths = (pts) => pts.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), acc), []);

// Resamples a polyline every `step` metres: [{ p, d (unit direction), s }].
function resample(pts, step, from = 0) {
  const L = arcLengths(pts);
  const out = [];
  let j = 0;
  for (let s = from; s <= L[L.length - 1]; s += step) {
    while (j < pts.length - 2 && L[j + 1] < s) j++;
    const f = (s - L[j]) / (L[j + 1] - L[j] || 1);
    const a = pts[j];
    const b = pts[j + 1];
    out.push({ p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], d: norm2([b[0] - a[0], b[1] - a[1]]), s });
  }
  return out;
}

// Points of a kerb up to where it first reaches radius R (entry kerbs end inside the ring).
function trimIn(pts, R) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    if (len(pts[i]) <= R) {
      if (i > 0) out.push(onCircle(pts[i - 1], pts[i], R));
      return out;
    }
    out.push(pts[i]);
  }
  return out;
}
function trimOut(pts, R) {
  for (let i = 0; i < pts.length; i++) {
    if (len(pts[i]) >= R) return [i > 0 ? onCircle(pts[i - 1], pts[i], R) : pts[i], ...pts.slice(i + 1)];
  }
  return pts.slice(-1);
}
function onCircle(a, b, R) {
  let lo = 0;
  let hi = 1;
  const inside = len(a) < R;
  for (let k = 0; k < 30; k++) {
    const m = (lo + hi) / 2;
    const q = [a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m];
    if ((len(q) < R) === inside) lo = m;
    else hi = m;
  }
  return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
}

// Continues a kerb end straight out along the arm axis to the fog.
const extendOut = (p, bearing) => {
  const u = dir(bearing);
  const k = Math.max(0, FAR - dot(p, u));
  return [p[0] + u[0] * k, p[1] + u[1] * k];
};

function arcPoints(R, b0, b1, step = 1) {
  const sweep = wrap2Pi(b1 - b0);
  const n = Math.max(1, Math.ceil((sweep * R) / step));
  const out = [];
  for (let i = 1; i < n; i++) {
    const d = dir(b0 + (sweep * i) / n);
    out.push([d[0] * R, d[1] * R]);
  }
  return out;
}

// ---------- road, kerbs, pavements ----------

function roadSurface(layout) {
  const R = layout.outerRadius;
  const m = new Mesher();
  const n = 96;
  const inner = layout.type === 'mini' ? 0 : Math.max(0, layout.innerRadius - 0.6);
  const ring = [];
  for (let i = 0; i <= n; i++) {
    const d = dir((i / n) * TAU);
    const o = [d[0] * (R + 0.05), d[1] * (R + 0.05)];
    ring.push([m.v(o[0], 0, o[1], 0, 1, 0, o[0] / ROAD_TILE, -o[1] / ROAD_TILE), m.v(d[0] * inner, 0, d[1] * inner, 0, 1, 0, (d[0] * inner) / ROAD_TILE, (-d[1] * inner) / ROAD_TILE)]);
  }
  for (let i = 0; i < n; i++) m.quad(ring[i][0], ring[i + 1][0], ring[i + 1][1], ring[i][1]);
  for (const arm of layout.arms) {
    const entry = trimIn(arm.kerbs.entryLeft, R);
    const exit = trimOut(arm.kerbs.exitLeft, R);
    polygon(m, [extendOut(entry[0], arm.bearing), ...entry, ...exit, extendOut(exit[exit.length - 1], arm.bearing)], 0, ROAD_TILE);
  }
  return m.geometry();
}

// Land between arm i (its entry side) and arm i+1 (its exit side), traced with the land on the LEFT.
function boundaries(layout) {
  const R = layout.outerRadius;
  const n = layout.arms.length;
  return layout.arms.map((arm, i) => {
    const next = layout.arms[(i + 1) % n];
    const entry = trimIn(arm.kerbs.entryLeft, R);
    const exit = trimOut(next.kerbs.exitLeft, R);
    const a = entry[entry.length - 1];
    const b = exit[0];
    return [extendOut(entry[0], arm.bearing), ...entry, ...arcPoints(R, bearingOf(a[0], a[1]), bearingOf(b[0], b[1])), ...exit, extendOut(exit[exit.length - 1], next.bearing)];
  });
}

// Kerb face, kerb top and pavement along a boundary with the land on its left.
function kerbAndPavement(m, pts, width = PAVEMENT, kerbTop = 0.16) {
  const N = leftNormals(pts);
  const L = arcLengths(pts);
  const top = offset(pts, N, kerbTop);
  const back = offset(pts, N, width);
  for (let i = 0; i < pts.length - 1; i++) {
    const j = i + 1;
    const [ri, rj] = [[-N[i][0], -N[i][1]], [-N[j][0], -N[j][1]]];
    // Face toward the road.
    m.quad(
      m.v(pts[i][0], 0, pts[i][1], ri[0], 0, ri[1], L[i], 0, 0.72), m.v(pts[j][0], 0, pts[j][1], rj[0], 0, rj[1], L[j], 0, 0.72),
      m.v(pts[j][0], KERB_H, pts[j][1], rj[0], 0, rj[1], L[j], KERB_H, 0.72), m.v(pts[i][0], KERB_H, pts[i][1], ri[0], 0, ri[1], L[i], KERB_H, 0.72));
    const t = (p, c) => m.v(p[0], KERB_H, p[1], 0, 1, 0, p[0] / PAVE_TILE, -p[1] / PAVE_TILE, c);
    m.quad(t(pts[i], 1.08), t(pts[j], 1.08), t(top[j], 1.08), t(top[i], 1.08));
    m.quad(t(top[i], 0.94), t(top[j], 0.94), t(back[j], 0.94), t(back[i], 0.94));
    m.quad(
      m.v(back[i][0], KERB_H, back[i][1], N[i][0], 0, N[i][1], L[i], 0, 0.6), m.v(back[j][0], KERB_H, back[j][1], N[j][0], 0, N[j][1], L[j], 0, 0.6),
      m.v(back[j][0], -0.04, back[j][1], N[j][0], 0, N[j][1], L[j], 0.15, 0.6), m.v(back[i][0], -0.04, back[i][1], N[i][0], 0, N[i][1], L[i], 0.15, 0.6));
  }
  return back;
}

// Raised island outline: kerb faces outward and a flat top.
function raisedPolygon(m, pts, y, tile, topColour) {
  const c = pts.reduce((s, p) => [s[0] + p[0] / pts.length, s[1] + p[1] / pts.length], [0, 0]);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const o = norm2([b[1] - a[1], -(b[0] - a[0])]);
    const nOut = dot(o, [(a[0] + b[0]) / 2 - c[0], (a[1] + b[1]) / 2 - c[1]]) >= 0 ? o : [-o[0], -o[1]];
    m.quad(m.v(a[0], 0, a[1], nOut[0], 0, nOut[1], 0, 0, 0.72), m.v(b[0], 0, b[1], nOut[0], 0, nOut[1], 1, 0, 0.72),
      m.v(b[0], y, b[1], nOut[0], 0, nOut[1], 1, y, 0.72), m.v(a[0], y, a[1], nOut[0], 0, nOut[1], 0, y, 0.72));
  }
  polygon(m, pts, y, tile, topColour);
}

function circle(r, n = 64) {
  return Array.from({ length: n }, (_, i) => { const d = dir((i / n) * TAU); return [d[0] * r, d[1] * r]; });
}

// ---------- markings ----------

const ATLAS = 512;
const WHITE_UV = [8 / ATLAS, 1 - 8 / ATLAS];
const ARROW_TILE = { w: 80, h: 384, y: 96 };

function drawArrows(ctx, x0, combo) {
  const { w, h, y } = ARROW_TILE;
  const cx = x0 + w / 2;
  ctx.fillStyle = '#fff';
  ctx.strokeStyle = '#fff';
  ctx.lineWidth = 11;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(cx, y + h);
  ctx.lineTo(cx, y + (combo.includes('ahead') ? 100 : 200));
  ctx.stroke();
  const head = (x, yy, ang) => {
    ctx.save();
    ctx.translate(x, yy);
    ctx.rotate(ang);
    ctx.beginPath();
    ctx.moveTo(0, -96);
    ctx.lineTo(-19, 4);
    ctx.lineTo(19, 4);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  };
  if (combo.includes('ahead')) head(cx, y + 100, 0);
  for (const side of ['left', 'right']) {
    if (!combo.includes(side)) continue;
    const s = side === 'left' ? -1 : 1;
    const ex = cx + s * 22;
    const ey = y + 150;
    ctx.beginPath();
    ctx.moveTo(cx, y + 240);
    ctx.quadraticCurveTo(cx, y + 190, ex, ey);
    ctx.stroke();
    head(ex + s * 2, ey + 2, s * 0.42);
  }
}

function markingsAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = ATLAS;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, 16, 16);
  const combos = [['ahead'], ['left'], ['right'], ['left', 'ahead'], ['ahead', 'right'], ['left', 'ahead', 'right']];
  const tiles = new Map();
  combos.forEach((combo, k) => {
    const x0 = 24 + k * 80;
    drawArrows(ctx, x0, combo);
    tiles.set(combo.join('+'), [x0 / ATLAS, (x0 + ARROW_TILE.w) / ATLAS, 1 - (ARROW_TILE.y + ARROW_TILE.h) / ATLAS, 1 - ARROW_TILE.y / ATLAS]);
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return { texture: t, tiles };
}

function markings(layout, atlas) {
  const m = new Mesher();
  const [wu, wv] = WHITE_UV;
  const y = MARK_Y;
  const quad = (a, b, c, d) => m.quad(m.v(a[0], y, a[1], 0, 1, 0, wu, wv), m.v(b[0], y, b[1], 0, 1, 0, wu, wv), m.v(c[0], y, c[1], 0, 1, 0, wu, wv), m.v(d[0], y, d[1], 0, 1, 0, wu, wv));
  // Segment p->q as a bar `w` wide.
  const bar = (p, q, w) => {
    const l = leftOf2(norm2([q[0] - p[0], q[1] - p[1]]));
    const h = w / 2;
    quad([p[0] + l[0] * h, p[1] + l[1] * h], [q[0] + l[0] * h, q[1] + l[1] * h], [q[0] - l[0] * h, q[1] - l[1] * h], [p[0] - l[0] * h, p[1] - l[1] * h]);
  };
  const dashed = (pts, mark, gap, w) => {
    const S = resample(pts, 0.5);
    for (let i = 0; i < S.length - 1; i++) if ((S[i].s + 0.25) % (mark + gap) < mark) bar(S[i].p, S[i + 1].p, w);
  };

  // Give way: 1003.1 double broken line, 1003.3 (mini) single; 600 mm marks, 300 mm gaps, rows 300 mm apart.
  for (const gw of layout.markings.giveWay) {
    const arm = layout.arms[gw.arm];
    gw.lanes.forEach((ln, k) => {
      const back = dir(arm.giveWay[k].heading + Math.PI);
      const L = Math.hypot(ln.b[0] - ln.a[0], ln.b[1] - ln.a[1]);
      const u = [(ln.b[0] - ln.a[0]) / L, (ln.b[1] - ln.a[1]) / L];
      const rows = gw.diagram === '1003.3' ? 1 : 2;
      const count = Math.floor((L + 0.3) / 0.9);
      const start = (L - (count * 0.9 - 0.3)) / 2;
      for (let r = 0; r < rows; r++) {
        const off = gw.width / 2 + r * (gw.width + 0.3);
        for (let i = 0; i < count; i++) {
          const s0 = start + i * 0.9;
          const p = [ln.a[0] + u[0] * s0 + back[0] * off, ln.a[1] + u[1] * s0 + back[1] * off];
          bar(p, [p[0] + u[0] * 0.6, p[1] + u[1] * 0.6], gw.width);
        }
      }
    });
  }
  for (const l of layout.markings.laneLines) dashed(l.points, 2, 4, 0.1);
  for (const r of layout.markings.ringLines) dashed([...circle(r.radius, 180), circle(r.radius, 180)[0]], 2, 4, 0.1);
  for (const arm of layout.arms) {
    if (arm.splitter.kind !== 'painted') continue;
    const p = arm.splitter.polygon;
    for (let i = 0; i < p.length; i++) bar(p[i], p[(i + 1) % p.length], 0.1);
  }
  if (layout.markings.miniDisc) {
    const pts = circle(layout.markings.miniDisc.radius, 48);
    const c0 = m.v(0, y + 0.004, 0, 0, 1, 0, wu, wv);
    const ids = pts.map(([x, z]) => m.v(x, y + 0.004, z, 0, 1, 0, wu, wv));
    for (let i = 0; i < ids.length; i++) m.tri(c0, ids[i], ids[(i + 1) % ids.length]);
  }
  for (const a of layout.markings.arrows) {
    const t = atlas.tiles.get(a.arrows.join('+')) ?? atlas.tiles.get('ahead');
    const f = dir(a.heading);
    const l = leftOf2(f);
    const hl = 3;
    const hw = 0.66;
    const P = (fs, ls) => [a.x + f[0] * fs * hl + l[0] * ls * hw, a.z + f[1] * fs * hl + l[1] * ls * hw];
    const [u0, u1, v0, v1] = t;
    const q = [[P(1, 1), u0, v1], [P(1, -1), u1, v1], [P(-1, -1), u1, v0], [P(-1, 1), u0, v0]].map(([p, u, v]) => m.v(p[0], y, p[1], 0, 1, 0, u, v));
    m.quad(...q);
  }
  return m.geometry();
}

// ---------- signs ----------

const SIGN = {
  510: { file: '510', w: 0.95, h: 0.95, centre: 2.35, slot: 0 },
  602: { file: '602', w: 0.82, h: 0.82, centre: 1.95, slot: 1 },
  '611.1': { file: '611_1', w: 0.7, h: 0.7, centre: 1.95, slot: 2 },
};
const MAP_W = 2.4;
const MAP_H = 1.65;
const MAP_BOTTOM = 0.95;

function fitText(ctx, text, max, size, weight = 700) {
  let s = size;
  do ctx.font = `${weight} ${s}px -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif`;
  while (ctx.measureText(text).width > max && --s > 10);
}

// Advance direction sign (map type) for one arm: exits drawn in their true clock positions.
function drawMapSign(ctx, x0, y0, w, h, map) {
  ctx.save();
  ctx.translate(x0, y0);
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  ctx.strokeStyle = '#111';
  ctx.lineWidth = 9;
  ctx.strokeRect(10, 10, w - 20, h - 20);
  const cx = w / 2;
  const cy = h * 0.58;
  const ring = map.mini ? 13 : 30;
  ctx.fillStyle = '#111';
  ctx.strokeStyle = '#111';
  ctx.lineCap = 'butt';
  ctx.lineWidth = 16;
  ctx.beginPath();
  ctx.moveTo(cx, h - 24);
  ctx.lineTo(cx, cy + ring);
  ctx.stroke();
  ctx.lineWidth = 11;
  if (map.mini) {
    ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU); ctx.fill();
  } else {
    ctx.beginPath(); ctx.arc(cx, cy, ring, 0, TAU); ctx.stroke();
  }
  ctx.textBaseline = 'middle';
  for (const e of map.exits) {
    const a = e.relBearing;
    const d = [Math.sin(a), -Math.cos(a)];
    const reach = 74;
    ctx.beginPath();
    ctx.moveTo(cx + d[0] * ring, cy + d[1] * ring);
    ctx.lineTo(cx + d[0] * reach, cy + d[1] * reach);
    ctx.stroke();
    const tx = cx + d[0] * (reach + 12);
    const ty = cy + d[1] * (reach + 8);
    const align = d[0] > 0.35 ? 'left' : d[0] < -0.35 ? 'right' : 'center';
    ctx.textAlign = align;
    const room = align === 'center' ? w - 60 : align === 'left' ? w - 24 - tx : tx - 24;
    fitText(ctx, e.destination, room, 40);
    const above = d[1] < -0.35;
    const dy = above ? -26 : d[1] > 0.35 ? 22 : -12;
    ctx.fillText(e.destination, tx, ty + dy);
    fitText(ctx, e.name, room, 27, 500);
    ctx.fillText(e.name, tx, ty + dy + 34);
  }
  ctx.restore();
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

async function signs(layout, base) {
  const icons = await Promise.all(['510', '602', '611_1'].map((f) => loadImage(`${base}/assets/signs/${f}.webp`)));
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = 768;
  iconCanvas.height = 256;
  const ic = iconCanvas.getContext('2d');
  icons.forEach((img, i) => ic.drawImage(img, i * 256, 0, 256, 256));
  // Backs: the icons' silhouettes in sign-back grey, plus a solid block for posts and map-sign backs.
  const backCanvas = document.createElement('canvas');
  backCanvas.width = 1024;
  backCanvas.height = 256;
  const bc = backCanvas.getContext('2d');
  bc.drawImage(iconCanvas, 0, 0);
  bc.globalCompositeOperation = 'source-in';
  bc.fillStyle = '#8a8d90';
  bc.fillRect(0, 0, 768, 256);
  bc.globalCompositeOperation = 'source-over';
  bc.fillRect(768, 0, 256, 256);

  const maps = layout.signs.filter((s) => s.code === 'map');
  const mapCanvas = document.createElement('canvas');
  const TW = 512;
  const TH = Math.round((TW * MAP_H) / MAP_W);
  mapCanvas.width = 1024;
  mapCanvas.height = THREE.MathUtils.ceilPowerOfTwo(Math.ceil(maps.length / 2) * TH);
  const mc = mapCanvas.getContext('2d');
  maps.forEach((s, k) => drawMapSign(mc, (k % 2) * TW, Math.floor(k / 2) * TH, TW, TH, s.map));

  const faces = new Mesher();
  const mapFaces = new Mesher();
  const backs = new Mesher();
  const solid = [896 / 1024, 0.5];
  const quadAt = (mesh, s, w, h, cy, uv, back = false) => {
    // A viewer facing the sign looks along -f, so their right is leftOf2(f).
    const f = dir(s.facing);
    const r = back ? [-leftOf2(f)[0], -leftOf2(f)[1]] : leftOf2(f);
    const n = back ? [-f[0], -f[1]] : f;
    const o = back ? -0.015 : 0.0;
    const px = s.x + f[0] * o;
    const pz = s.z + f[1] * o;
    const [u0, u1, v0, v1] = uv;
    const V = (rs, ys, u, v) => mesh.v(px + r[0] * rs * w / 2, cy + ys * h / 2, pz + r[1] * rs * w / 2, n[0], 0, n[1], u, v);
    mesh.quad(V(-1, -1, u0, v0), V(1, -1, u1, v0), V(1, 1, u1, v1), V(-1, 1, u0, v1));
  };
  const post = (x, z, h) => {
    const g = new THREE.CylinderGeometry(0.04, 0.04, h, 6, 1, true);
    g.translate(x, h / 2, z);
    const p = g.getAttribute('position');
    const nn = g.getAttribute('normal');
    const ids = [];
    for (let i = 0; i < p.count; i++) ids.push(backs.v(p.getX(i), p.getY(i), p.getZ(i), nn.getX(i), nn.getY(i), nn.getZ(i), solid[0], solid[1], 0.8));
    const idx = g.index.array;
    for (let i = 0; i < idx.length; i += 3) backs.tri(ids[idx[i]], ids[idx[i + 1]], ids[idx[i + 2]]);
  };

  let k = 0;
  for (const s of layout.signs) {
    const f = dir(s.facing);
    if (s.code === 'map') {
      const col = k % 2;
      const row = Math.floor(k++ / 2);
      const H = mapCanvas.height;
      const uv = [col * 0.5, col * 0.5 + 0.5, 1 - ((row + 1) * TH) / H, 1 - (row * TH) / H];
      const cy = MAP_BOTTOM + MAP_H / 2;
      quadAt(mapFaces, s, MAP_W, MAP_H, cy, uv);
      quadAt(backs, s, MAP_W, MAP_H, cy, [solid[0], solid[0], solid[1], solid[1]], true);
      const r = leftOf2(f);
      for (const side of [-0.75, 0.75]) post(s.x + r[0] * side - f[0] * 0.05, s.z + r[1] * side - f[1] * 0.05, MAP_BOTTOM + MAP_H - 0.1);
    } else {
      const d = SIGN[s.code];
      const uv = [d.slot / 3, (d.slot + 1) / 3, 0, 1];
      quadAt(faces, s, d.w, d.h, d.centre, uv);
      quadAt(backs, s, d.w, d.h, d.centre, [(d.slot + 1) * 0.25, d.slot * 0.25, 0, 1], true);
      post(s.x - f[0] * 0.05, s.z - f[1] * 0.05, d.centre + d.h * 0.3);
    }
  }
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; };
  const out = [
    new THREE.Mesh(faces.geometry(), new THREE.MeshLambertMaterial({ map: tex(iconCanvas), alphaTest: 0.5 })),
    new THREE.Mesh(backs.geometry(), new THREE.MeshLambertMaterial({ map: tex(backCanvas), alphaTest: 0.5 })),
  ];
  if (maps.length) out.push(new THREE.Mesh(mapFaces.geometry(), new THREE.MeshLambertMaterial({ map: tex(mapCanvas) })));
  return out;
}

// ---------- buildings (hard tier blocks) ----------

let facadeTex = null;
async function facade(base) {
  if (facadeTex) return facadeTex;
  const brick = await loadImage(`${base}/assets/tex/brick.webp`);
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const x = c.getContext('2d');
  x.drawImage(brick, 0, 0, 256, 256);
  // Two storeys of two sash windows per 6 m tile.
  for (const fy of [26, 154]) {
    for (const fx of [34, 162]) {
      x.fillStyle = '#e8e4dc';
      x.fillRect(fx - 5, fy - 5, 70, 86);
      x.fillStyle = '#26303a';
      x.fillRect(fx, fy, 60, 76);
      x.fillStyle = '#e8e4dc';
      x.fillRect(fx, fy + 36, 60, 4);
      x.fillRect(fx + 28, fy, 4, 76);
    }
  }
  facadeTex = new THREE.CanvasTexture(c);
  facadeTex.colorSpace = THREE.SRGBColorSpace;
  facadeTex.wrapS = facadeTex.wrapT = THREE.RepeatWrapping;
  facadeTex.anisotropy = 4;
  return facadeTex;
}

function blocks(list) {
  const m = new Mesher();
  for (const b of list) {
    const f = dir(b.heading);
    const r = [-f[1], f[0]];
    const hw = b.w / 2;
    const hd = b.d / 2;
    const C = (fs, rs) => [b.x + f[0] * fs * hd + r[0] * rs * hw, b.z + f[1] * fs * hd + r[1] * rs * hw];
    const corners = [C(1, -1), C(1, 1), C(-1, 1), C(-1, -1)];
    for (let i = 0; i < 4; i++) {
      const a = corners[i];
      const c = corners[(i + 1) % 4];
      const n = norm2([(a[0] + c[0]) / 2 - b.x, (a[1] + c[1]) / 2 - b.z]);
      const wl = Math.hypot(c[0] - a[0], c[1] - a[1]);
      m.quad(m.v(a[0], 0, a[1], n[0], 0, n[1], 0, 0), m.v(c[0], 0, c[1], n[0], 0, n[1], wl / 6, 0),
        m.v(c[0], b.h, c[1], n[0], 0, n[1], wl / 6, b.h / 6), m.v(a[0], b.h, a[1], n[0], 0, n[1], 0, b.h / 6));
    }
    const top = corners.map(([x, z]) => m.v(x, b.h, z, 0, 1, 0, 0.02, 0.02, 0.22));
    m.quad(...top);
  }
  return m.geometry();
}

// ---------- scenery ----------

const MODEL_HEIGHT = { tree: 6.86, birch: 6.64, pine: 5.7 };

async function instanced(base, name, matrices, { flat = false, colour, palette } = {}) {
  if (!matrices.length) return [];
  const root = await loadGlb(`${base}/assets/models/scenery/${name}.glb`);
  const parts = flatten(root, { mergeGlass: true, flat, colour });
  return parts.map((p) => {
    let mat;
    if (p.key === 'flat') mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    else if (p.key === 'emissive') {
      mat = new THREE.MeshLambertMaterial({ map: p.material.map, emissive: 0xffffff, emissiveMap: p.material.emissiveMap, emissiveIntensity: palette?.leds ?? 0 });
      mat.userData.led = true;
    } else mat = new THREE.MeshLambertMaterial({ map: p.material.map });
    const im = new THREE.InstancedMesh(p.geometry, mat, matrices.length);
    matrices.forEach((mm, i) => im.setMatrixAt(i, mm));
    im.computeBoundingSphere();
    return im;
  });
}

const placeM = (x, z, rotY, sx = 1, sy = sx, sz = sx, y = 0) =>
  new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY), new THREE.Vector3(sx, sy, sz));
// rotation.y that turns a model's +Z toward the xz direction d.
const faceTo = (d) => Math.atan2(d[0], d[1]);

// Shortest distance from p to any polyline in `lines`.
function distToLines(p, lines) {
  let best = Infinity;
  for (const pts of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const ab = [b[0] - a[0], b[1] - a[1]];
      const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], ab) / (dot(ab, ab) || 1)));
      best = Math.min(best, Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t));
    }
  }
  return best;
}

// ---------- assembly ----------

export function buildWorld(layout, { base }) {
  const group = new THREE.Group();
  const disposables = [];
  const keep = (o) => { group.add(o); return o; };
  const R = layout.outerRadius;

  // Tints are linear multipliers: the grass source is dry summer grass, pushed to a UK verge green.
  const asphalt = new THREE.MeshLambertMaterial({ map: texture(`${base}/assets/tex/asphalt.webp`), color: new THREE.Color().setRGB(1.25, 1.25, 1.25) });
  const concrete = new THREE.MeshLambertMaterial({ map: texture(`${base}/assets/tex/pavement.webp`), vertexColors: true, color: new THREE.Color().setRGB(1.05, 1.08, 1.12) });
  const grass = new THREE.MeshLambertMaterial({ map: texture(`${base}/assets/tex/grass.webp`), color: new THREE.Color().setRGB(0.95, 1.7, 1.05) });
  for (const t of [asphalt.map, concrete.map, grass.map]) t.anisotropy = 8;

  keep(new THREE.Mesh(roadSurface(layout), asphalt));

  const pave = new Mesher();
  const bounds = boundaries(layout);
  for (const b of bounds) kerbAndPavement(pave, b);
  for (const arm of layout.arms) if (arm.splitter.kind === 'raised') raisedPolygon(pave, arm.splitter.polygon, KERB_H, PAVE_TILE, 0.95);

  const ground = new Mesher();
  const G = 1400;
  const gq = [[-G, -G], [G, -G], [G, G], [-G, G]].map(([x, z]) => ground.v(x, -0.04, z, 0, 1, 0, x / GRASS_TILE, -z / GRASS_TILE));
  ground.quad(...gq);
  const island = layout.island;
  if (island.kind === 'raised') {
    const ri = island.radius;
    const top = Math.max(0.5, ri - island.apron);
    if (island.apron > 0) {
      // Overrun apron: low, cobbled, for long vehicles.
      raisedPolygon(pave, circle(ri, 96), 0.06, 1.2, 0.8);
      raisedPolygon(ground, circle(top, 96), 0.22, GRASS_TILE, 1);
    } else {
      raisedPolygon(pave, circle(ri, 96), KERB_H + 0.04, PAVE_TILE, 0.9);
      polygon(ground, circle(ri - 0.6, 96), KERB_H + 0.06, GRASS_TILE);
    }
  }
  keep(new THREE.Mesh(pave.geometry(), concrete));
  keep(new THREE.Mesh(ground.geometry(), grass));

  const atlas = markingsAtlas();
  const markMat = new THREE.MeshLambertMaterial({ map: atlas.texture, alphaTest: 0.5, color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  keep(new THREE.Mesh(markings(layout, atlas), markMat));
  disposables.push(atlas.texture);

  const signsReady = signs(layout, base).then((meshes) => meshes.forEach(keep));

  // Route ribbon: the briefing shows the way through; hidden while driving.
  const path = layout.paths[layout.player.pathId];
  const rib = new Mesher();
  const from = Math.max(0, path.marks.giveWay - 50);
  const to = Math.min(path.length, path.marks.exitRing + 35);
  let prev = null;
  for (let s = from; s <= to; s += 1) {
    const i = Math.min(path.x.length - 1, Math.round(s / path.step));
    const d = dir(path.heading[i]);
    const l = leftOf2(d);
    const ids = [-0.3, 0.3].map((o) => rib.v(path.x[i] + l[0] * o, 0.03, path.z[i] + l[1] * o, 0, 1, 0, 0, 0));
    if (prev) rib.quad(prev[0], prev[1], ids[1], ids[0]);
    prev = ids;
  }
  const routeMat = new THREE.MeshBasicMaterial({ color: 0x2a9d8f, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3, fog: false });
  const route = keep(new THREE.Mesh(rib.geometry(), routeMat));
  route.renderOrder = 2;

  const ledMats = [];
  let palette = PALETTES.light;
  const treeShadowMat = new THREE.MeshBasicMaterial({ map: blobTexture(), color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });

  async function dress(quality = 'high') {
    const rng = createRng(`${layout.seed}|${layout.tier}|dress`);
    const sc = layout.scenery;
    const jobs = [];
    const add = (p) => jobs.push(p.then((meshes) => meshes.forEach((m) => { keep(m); if (m.material.userData.led) ledMats.push(m.material); })));

    // Street lights along every boundary near the junction, on the pavement, heads over the road.
    const lights = [];
    for (const b of bounds) {
      for (const q of resample(b, 30, 8)) {
        if (len(q.p) > 170) continue;
        const l = leftOf2(q.d);
        lights.push(placeM(q.p[0] + l[0] * 0.5, q.p[1] + l[1] * 0.5, faceTo([-l[0], -l[1]])));
      }
    }
    add(instanced(base, 'streetlight', lights, { palette }));

    const kinds = { tree: [], birch: [], pine: [] };
    const shadowM = [];
    sc.trees.forEach((t, i) => {
      const k = i % 10 < 6 ? 'tree' : i % 10 < 9 ? 'birch' : 'pine';
      const s = t.height / MODEL_HEIGHT[k];
      kinds[k].push(placeM(t.x, t.z, rng() * TAU, s));
      shadowM.push(placeM(t.x, t.z, 0, t.radius * 2.2, 1, t.radius * 2.2, 0.02));
    });

    // Islands: planting on compact, a statue on normal, a clock tower on large; bushes add the cross-ring occlusion.
    const bushes = [];
    const clumps = [];
    if (island.kind === 'raised') {
      const ri = island.radius - island.apron - 1.2;
      const n = Math.min(40, Math.round(ri * 1.6));
      for (let i = 0; i < n; i++) {
        const a = rng() * TAU;
        const r = ri * Math.sqrt(0.35 + 0.65 * rng());
        const d = dir(a);
        bushes.push(placeM(d[0] * r, d[1] * r, rng() * TAU, 1.1 + rng() * 0.9, 0.9 + rng() * 0.8, 1.1 + rng() * 0.9, KERB_H));
      }
      if (quality !== 'low') {
        for (let i = 0; i < n * 2; i++) {
          const d = dir(rng() * TAU);
          const r = ri * Math.sqrt(rng());
          clumps.push(placeM(d[0] * r, d[1] * r, rng() * TAU, 1.5, 1.5, 1.5, KERB_H));
        }
      }
      if (island.feature === 'clockTower') add(instanced(base, 'clocktower', [placeM(0, 0, rng() * TAU, 1, 1, 1, KERB_H)]));
      if (island.feature === 'statue') {
        const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6).translate(0, 0.8 + KERB_H, 0), new THREE.MeshLambertMaterial({ color: 0x9a958c }));
        keep(plinth);
        add(instanced(base, 'man', [placeM(0, 0, rng() * TAU, 1.5, 1.5, 1.5, 1.6 + KERB_H)], { flat: true, colour: () => new THREE.Color(0.16, 0.11, 0.06) }));
      }
    }

    const hedges = [];
    for (const h of sc.hedges) {
      const d = [h.b[0] - h.a[0], h.b[1] - h.a[1]];
      const L = Math.hypot(d[0], d[1]);
      const u = [d[0] / L, d[1] / L];
      for (let s = 0.9; s < L; s += 1.85) hedges.push(placeM(h.a[0] + u[0] * s, h.a[1] + u[1] * s, Math.atan2(-u[1], u[0]), 1, h.height / 1.05, h.thickness / 0.67));
    }

    const towardAxis = (p, bearing) => {
      const u = dir(bearing);
      const q = [u[0] * dot(p, u), u[1] * dot(p, u)];
      return norm2([q[0] - p[0], q[1] - p[1]]);
    };
    const nearestArm = (p) => layout.arms.reduce((a, b) => (Math.abs(wrapPi(bearingOf(p[0], p[1]) - b.bearing)) < Math.abs(wrapPi(bearingOf(p[0], p[1]) - a.bearing)) ? b : a));

    const terraces = [];
    for (const t of sc.terraces) {
      const d = [t.b[0] - t.a[0], t.b[1] - t.a[1]];
      const L = Math.hypot(d[0], d[1]);
      const u = [d[0] / L, d[1] / L];
      const mid = [(t.a[0] + t.b[0]) / 2, (t.a[1] + t.b[1]) / 2];
      const r = towardAxis(mid, nearestArm(mid).bearing);
      for (let s = 9.35; s <= L; s += 18.7) {
        terraces.push(placeM(t.a[0] + u[0] * s - r[0] * 4.6, t.a[1] + u[1] * s - r[1] * 4.6, faceTo(r), 1, t.height / 10.31, 1));
      }
    }

    // Cottages on the land between arms of the small tiers, clear of every kerb.
    const cottages = [];
    const people = [];
    if (layout.tier === 'mini' || layout.tier === 'easy') {
      for (let i = 0; i < layout.arms.length; i++) {
        const a0 = layout.arms[i].bearing;
        const a1 = layout.arms[(i + 1) % layout.arms.length].bearing;
        const mid = a0 + wrap2Pi(a1 - a0) / 2;
        for (let tries = 0; tries < 6; tries++) {
          const r = R + 18 + rng() * 26;
          const d = dir(mid + (rng() - 0.5) * 0.3);
          const p = [d[0] * r, d[1] * r];
          if (distToLines(p, bounds) > 8.5 && sc.trees.every((t) => Math.hypot(t.x - p[0], t.z - p[1]) > 7)) {
            cottages.push(placeM(p[0], p[1], faceTo(norm2([-p[0], -p[1]]))));
            break;
          }
        }
      }
    }

    // A bus stop and a few people on the player's approach on the busier tiers.
    const shelters = [];
    if (layout.tier === 'medium' || layout.tier === 'hard') {
      const b = bounds[layout.player.arm];
      const near = resample(b, 2).filter((q) => len(q.p) > R + 30 && len(q.p) < R + 45)[0];
      if (near) {
        const l = leftOf2(near.d);
        const p = [near.p[0] + l[0] * 1.3, near.p[1] + l[1] * 1.3];
        shelters.push(placeM(p[0], p[1], faceTo([-l[0], -l[1]]), 1, 1, 1, KERB_H));
        people.push(['woman', placeM(p[0] + near.d[0] * 2.2, p[1] + near.d[1] * 2.2, faceTo([-l[0], -l[1]]), 1, 1, 1, KERB_H)]);
      }
    }
    if (quality !== 'low') {
      for (const b of bounds) {
        if (rng() < 0.5) continue;
        const S = resample(b, 3).filter((q) => len(q.p) > R + 6 && len(q.p) < R + 30);
        if (!S.length) continue;
        const q = S[Math.floor(rng() * S.length)];
        const l = leftOf2(q.d);
        people.push([rng() < 0.5 ? 'man' : 'businessman', placeM(q.p[0] + l[0] * 1.2, q.p[1] + l[1] * 1.2, faceTo(rng() < 0.5 ? q.d : [-q.d[0], -q.d[1]]), 1, 1, 1, KERB_H)]);
      }
    }

    // Keep-left bollards on raised splitter noses.
    const bollards = [];
    for (const arm of layout.arms) {
      if (arm.splitter.kind !== 'raised') continue;
      const p = arm.splitter.polygon[0];
      const u = dir(arm.bearing);
      bollards.push(placeM(p[0] + u[0] * 0.9, p[1] + u[1] * 0.9, faceTo(u), 1.2, 1.1, 1.2, KERB_H));
    }

    if (sc.buildings.length) {
      const tex = await facade(base);
      const m = keep(new THREE.Mesh(blocks(sc.buildings), new THREE.MeshLambertMaterial({ map: tex, vertexColors: true })));
      disposables.push(m.geometry);
    }

    for (const [k, list] of Object.entries(kinds)) add(instanced(base, k, list));
    add(instanced(base, 'bush', bushes));
    add(instanced(base, 'grass', clumps));
    add(instanced(base, 'hedge', hedges));
    add(instanced(base, 'terrace', terraces));
    add(instanced(base, 'cottage', cottages));
    add(instanced(base, 'shelter', shelters));
    add(instanced(base, 'bollard', bollards));
    for (const name of ['man', 'woman', 'businessman']) add(instanced(base, name, people.filter((p) => p[0] === name).map((p) => p[1])));
    if (shadowM.length) {
      const sh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), treeShadowMat, shadowM.length);
      shadowM.forEach((mm, i) => sh.setMatrixAt(i, mm));
      sh.computeBoundingSphere();
      keep(sh);
    }
    await Promise.all(jobs);
    await signsReady;
  }

  function setTheme(p) {
    palette = p;
    for (const m of ledMats) m.emissiveIntensity = p.leds;
    treeShadowMat.opacity = p.shadow * 0.75;
    routeMat.color.set(getComputedStyle(document.documentElement).getPropertyValue('--rb-route').trim() || '#2A9D8F');
  }

  return {
    group,
    ready: signsReady,
    dress,
    setTheme,
    showRoute(on) { route.visible = on; },
    dispose() {
      group.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          for (const k of ['map', 'emissiveMap']) if (o.material[k] && ![...texCache.values()].includes(o.material[k]) && o.material[k] !== facadeTex) o.material[k].dispose();
          o.material.dispose();
        }
      });
      for (const d of disposables) d.dispose?.();
      group.removeFromParent();
    },
  };
}
