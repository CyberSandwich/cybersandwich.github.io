/**
 * The static world, from gen.js layout data.
 *
 *   const env = createEnvironment(renderer, scene)   sky, fog, lights, reflections; env.setTheme(name) -> palette
 *   const world = buildWorld(layout, { base })        road, kerbs, pavements, markings, signs (sync, fast)
 *   await world.dress(quality)                        scenery (call after the first frame); placement: scenery.js
 *   world.update(camera)                              every frame before rendering the main view: scenery culling + LOD
 *   world.setTheme(palette)  world.showRoute(on)  world.dispose()
 *
 * Draw budget: every static surface is merged by material: grass, asphalt, concrete (pavements, kerbs,
 * splitters, island edge), markings (one atlas: line texel + arrow tiles), sign faces x2, sign backs + posts.
 * Scenery is instanced per flattened part and refilled per frame with only what the camera sees (scenerySet);
 * it sits on layer 2, which the mirrors skip. Frame: geom.js (x east, z south, compass bearings).
 */
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { loadGlb, flatten, cluster } from './gltf.js';
import { createRng } from './rng.js';
import { TAU, dir, dot } from './geom.js';
import { placeScenery, boundaries, resample, leftOf2, norm2, arcLengths, trimIn, trimOut, extendOut, circle, PAVEMENT } from './scenery.js';
import { giveWayBars } from './markings.js';
import { blobTexture } from './vehicles.js';

export const PALETTES = {
  light: {
    skyTop: '#86a8c6', skyHorizon: '#dde4ea', skyBottom: '#b9c0b4', fogDensity: 0.0062,
    sun: '#fff3e0', sunI: 2.2, sunDir: [-0.45, 0.8, 0.4], hemiSky: '#e3ebf3', hemiGround: '#5f6650', hemiI: 1.15,
    envI: 0.55, shadow: 0.36, leds: 0, exposure: 1.0,
  },
  // Dusk, not night: low warm sun and a bright blue-grey sky fill, so kerbs, markings and paint still read.
  dark: {
    skyTop: '#1d2840', skyHorizon: '#616a7e', skyBottom: '#34363b', fogDensity: 0.006,
    sun: '#ffbf8a', sunI: 1.4, sunDir: [0.7, 0.22, 0.5], hemiSky: '#9aa3b6', hemiGround: '#575449', hemiI: 2.2,
    envI: 0.6, shadow: 0.45, leds: 2.2, exposure: 1.5,
  },
  sepia: {
    skyTop: '#b49e7a', skyHorizon: '#eedcbf', skyBottom: '#c2b08f', fogDensity: 0.0068,
    sun: '#ffd49a', sunI: 2.3, sunDir: [0.6, 0.45, 0.55], hemiSky: '#f1e1c3', hemiGround: '#6b5a40', hemiI: 1.0,
    envI: 0.5, shadow: 0.34, leds: 0, exposure: 1.0,
  },
};

const ROAD_TILE = 3;
const GRASS_TILE = 6;
const PAVE_TILE = 2.5;
const KERB_H = 0.12;
const MARK_Y = 0.015;
// Lane and circulatory lane lines, diagram 1004 (40 mph or less): 4 m mark, 2 m gap (TSM ch. 5).
const LANE_DASH = [4, 2];

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
        // Finite slope at the horizon (no crease); below it the bottom colour (the visible sky keeps bottom = horizon).
        vec3 c = h > 0.0 ? mix(horizon, top, 1.0 - pow(1.0 - h, 2.2)) : mix(horizon, bottom, smoothstep(0.0, 0.15, -h));
        gl_FragColor = vec4(c, 1.0);
        #include <colorspace_fragment>
        // Half-level dither: a dark gradient over a tall screen otherwise bands in 8 bits.
        gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
      }`,
    // three mixes fog in after tone mapping, so fully fogged land shows the fog colour untouched; a tone-mapped
    // sky would sit darker than it at the horizon (Neutral subtracts up to 0.04) and leave a hard edge.
    side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
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
    }
    // Below the horizon the visible sky is the fog colour: wherever the ground ends or the far plane clips it,
    // fully fogged ground meets sky of the same colour, so there is no edge at any pitch. Reflections keep a
    // darker ground (skyBottom) so paint does not glow from below.
    sky.material.uniforms.bottom.value.set(p.skyHorizon);
    envSky.material.uniforms.bottom.value.set(p.skyBottom);
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

// Phones pay for anisotropic taps per pixel at high DPR; 4 keeps the road crisp at a glance.
const ANISO = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 4 : 8;

const texCache = new Map();
// Shared across layouts (never disposed): uvs are world metres / tile, so one texture serves every surface.
function texture(url) {
  if (!texCache.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = ANISO;
    texCache.set(url, t);
  }
  return texCache.get(url);
}

/**
 * Asphalt, drawn once at runtime (zero bytes on the wire): 512 px over ROAD_TILE metres (~6 mm a texel), so
 * the near road shows aggregate streaming past, which is what reads as speed. Stone speckle over a binder grey,
 * wrapped at the edges so the tile is seamless. Shared across layouts, never disposed.
 */
let asphaltTex = null;
function asphaltTexture() {
  if (asphaltTex) return asphaltTex;
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const x = c.getContext('2d');
  x.fillStyle = '#4b4b4a';
  x.fillRect(0, 0, S, S);
  const rng = createRng('asphalt');
  const speck = (px, py, r, g) => {
    x.fillStyle = `rgb(${g},${g},${g - 2})`;
    for (const ox of [0, -S, S]) for (const oy of [0, -S, S]) if (px + ox > -r && px + ox < S + r && py + oy > -r && py + oy < S + r) x.fillRect(px + ox, py + oy, r, r);
  };
  // Binder blotches, then dark pits, then light stones (most numerous, smallest).
  for (let i = 0; i < 900; i++) speck(rng() * S, rng() * S, 3 + rng() * 6, 66 + Math.floor(rng() * 14));
  for (let i = 0; i < 4000; i++) speck(rng() * S, rng() * S, 1 + Math.floor(rng() * 2), 50 + Math.floor(rng() * 14));
  for (let i = 0; i < 10000; i++) speck(rng() * S, rng() * S, 1 + Math.floor(rng() * 2.4), 84 + Math.floor(rng() * 36));
  asphaltTex = new THREE.CanvasTexture(c);
  asphaltTex.colorSpace = THREE.SRGBColorSpace;
  asphaltTex.wrapS = asphaltTex.wrapT = THREE.RepeatWrapping;
  asphaltTex.anisotropy = ANISO;
  return asphaltTex;
}

// Smooth value noise, 64 px, tiled every MACRO_TILE metres: breaks the asphalt tile's repeat with patches.
const MACRO_TILE = 70;
let macroTex = null;
function macroTexture() {
  if (macroTex) return macroTex;
  const N = 64;
  const rng = createRng('macro');
  const grid = Array.from({ length: 8 * 8 }, () => rng());
  const at = (i, j) => grid[((j + 8) % 8) * 8 + ((i + 8) % 8)];
  const data = new Uint8Array(N * N * 4);
  for (let y = 0; y < N; y++) {
    for (let xx = 0; xx < N; xx++) {
      const fx = (xx / N) * 8;
      const fy = (y / N) * 8;
      const i = Math.floor(fx);
      const j = Math.floor(fy);
      const sx = (fx - i) * (fx - i) * (3 - 2 * (fx - i));
      const sy = (fy - j) * (fy - j) * (3 - 2 * (fy - j));
      const v = (at(i, j) * (1 - sx) + at(i + 1, j) * sx) * (1 - sy) + (at(i, j + 1) * (1 - sx) + at(i + 1, j + 1) * sx) * sy;
      data.set([v * 255, v * 255, v * 255, 255], (y * N + xx) * 4);
    }
  }
  macroTex = new THREE.DataTexture(data, N, N);
  macroTex.wrapS = macroTex.wrapT = THREE.RepeatWrapping;
  macroTex.magFilter = macroTex.minFilter = THREE.LinearFilter;
  macroTex.needsUpdate = true;
  return macroTex;
}

/**
 * Macro patches over a tiled map, sampled in the map's own uv space (world metres / tile): brightness swings
 * between lo and hi, and with `hue` the bright patches lean yellow-green, the dark ones blue-green (grass).
 */
function patchy(material, tile, lo, hi, hue = 0) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.macroMap = { value: macroTexture() };
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D macroMap;')
      .replace('#include <map_fragment>', `#include <map_fragment>
        float macro = texture2D(macroMap, vMapUv * ${(tile / MACRO_TILE).toFixed(5)}).r;
        diffuseColor.rgb *= mix(${lo.toFixed(3)}, ${hi.toFixed(3)}, macro) * mix(vec3(1.0), vec3(1.0 + ${hue.toFixed(3)}, 1.0, 1.0 - ${hue.toFixed(3)}), macro - 0.5);`);
  };
  material.customProgramCacheKey = () => `rb-patchy-${tile}-${lo}-${hi}-${hue}`;
  return material;
}

// ---------- mesh building ----------

// Indexed triangles with position, normal, uv, colour; tri() orients each triangle to its first vertex's normal.
// `tag` (set before emitting) marks the vertices of one sign or one arm's arrows for the guided focus pulse.
class Mesher {
  constructor() { this.p = []; this.n = []; this.uv = []; this.c = []; this.i = []; this.t = []; this.tag = -1; }
  v(x, y, z, nx, ny, nz, u, w, c = 1) {
    this.p.push(x, y, z); this.n.push(nx, ny, nz); this.uv.push(u, w); this.c.push(c, c, c); this.t.push(this.tag);
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
    // Always present: a missing attribute reads as 0, which would light the first sign or arm.
    g.setAttribute('aTag', new THREE.Float32BufferAttribute(this.t, 1));
    g.setIndex(this.i);
    return g;
  }
}

/**
 * Guided focus: vertices whose aTag equals focus.id brighten in a slow pulse (up to +35% of their own colour,
 * never a new hue). One shared { id, pulse } uniform pair per world.
 */
function focusable(material, focus) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uFocus = focus.id;
    sh.uniforms.uPulse = focus.pulse;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aTag;\nvarying float vTag;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTag = aTag;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform float uFocus;\nuniform float uPulse;\nvarying float vTag;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += diffuseColor.rgb * uPulse * (1.0 - step(0.5, abs(vTag - uFocus)));');
  };
  material.customProgramCacheKey = () => 'rb-focus';
  return material;
}

// Flat polygon at height y (world-space uv / tile), triangulated by earcut.
function polygon(mesh, pts, y, tile, c = 1) {
  const base = pts.map(([x, z]) => mesh.v(x, y, z, 0, 1, 0, x / tile, -z / tile, c));
  const faces = THREE.ShapeUtils.triangulateShape(pts.map(([x, z]) => new THREE.Vector2(x, z)), []);
  for (const [a, b, c2] of faces) mesh.tri(base[a], base[b], base[c2]);
}

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
  t.anisotropy = ANISO;
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

  // Give way, kerb to kerb along the ICD (1003.1 / 1003.3): layout in markings.js.
  for (const g of giveWayBars(layout)) bar(g.a, g.b, g.width);
  for (const l of layout.markings.laneLines) dashed(l.points, LANE_DASH[0], LANE_DASH[1], 0.1);
  for (const r of layout.markings.ringLines) dashed([...circle(r.radius, 180), circle(r.radius, 180)[0]], LANE_DASH[0], LANE_DASH[1], 0.1);
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
    m.tag = a.arm;
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

// Icon atlas: one 256 px slot per face; the back atlas shares the layout and keeps its last slot solid.
const SLOTS = 8;
const SOLID_SLOT = SLOTS - 1;
const LIMITS = [20, 30, 40, 50, 60];
// Faces (metres) by the arm's limit, TSM chapters 3-4 bands: the smaller size up to 30 mph, the next above.
// Every sign is over a footway, so the lower edge is 2.1 m.
const SIGN = {
  510: { slot: 0, size: [0.75, 0.9] },
  602: { slot: 1, size: [0.75, 0.9] },
  '611.1': { slot: 2, size: [0.75, 0.75] },
  limit: { size: [0.75, 0.9] }, // slot 3 + LIMITS index
};
const SIGN_LOWER_EDGE = 2.1;
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

// Diagram 670 speed limit roundel in a 256 px slot: white disc, red ring, black numerals.
function drawLimit(ctx, x0, mph) {
  const c = x0 + 128;
  ctx.fillStyle = '#c8102e';
  ctx.beginPath(); ctx.arc(c, 128, 124, 0, TAU); ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.beginPath(); ctx.arc(c, 128, 96, 0, TAU); ctx.fill();
  ctx.fillStyle = '#111';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  fitText(ctx, String(mph), 150, 118, 800);
  ctx.fillText(String(mph), c, 134);
}

function loadImage(url) {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
}

async function signs(layout, base, focus) {
  const icons = await Promise.all(['510', '602', '611_1'].map((f) => loadImage(`${base}/assets/signs/${f}.webp`)));
  const W = SLOTS * 256;
  const iconCanvas = document.createElement('canvas');
  iconCanvas.width = W;
  iconCanvas.height = 256;
  const ic = iconCanvas.getContext('2d');
  icons.forEach((img, i) => ic.drawImage(img, i * 256, 0, 256, 256));
  LIMITS.forEach((mph, i) => drawLimit(ic, (3 + i) * 256, mph));
  // Backs: the icons' silhouettes in sign-back grey, plus a solid block for posts and map-sign backs.
  const backCanvas = document.createElement('canvas');
  backCanvas.width = W;
  backCanvas.height = 256;
  const bc = backCanvas.getContext('2d');
  bc.drawImage(iconCanvas, 0, 0);
  bc.globalCompositeOperation = 'source-in';
  bc.fillStyle = '#8a8d90';
  bc.fillRect(0, 0, W, 256);
  bc.globalCompositeOperation = 'source-over';
  bc.fillRect(SOLID_SLOT * 256, 0, 256, 256);

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
  const solid = [(SOLID_SLOT + 0.5) / SLOTS, 0.5];
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
  layout.signs.forEach((s, si) => {
    faces.tag = si;
    mapFaces.tag = si;
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
    } else if (SIGN[s.code]) {
      const d = SIGN[s.code];
      const mph = s.mph ?? layout.arms[s.arm].limitMph;
      const slot = s.code === 'limit' ? 3 + Math.max(0, LIMITS.indexOf(mph)) : d.slot;
      const size = d.size[mph <= 30 ? 0 : 1];
      const centre = SIGN_LOWER_EDGE + size / 2;
      quadAt(faces, s, size, size, centre, [slot / SLOTS, (slot + 1) / SLOTS, 0, 1]);
      quadAt(backs, s, size, size, centre, [(slot + 1) / SLOTS, slot / SLOTS, 0, 1], true);
      post(s.x - f[0] * 0.05, s.z - f[1] * 0.05, centre + size * 0.3);
    }
  });
  const tex = (c) => { const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = ANISO; return t; };
  const out = [
    new THREE.Mesh(faces.geometry(), focusable(new THREE.MeshLambertMaterial({ map: tex(iconCanvas), alphaTest: 0.5 }), focus)),
    new THREE.Mesh(backs.geometry(), new THREE.MeshLambertMaterial({ map: tex(backCanvas), alphaTest: 0.5 })),
  ];
  if (maps.length) out.push(new THREE.Mesh(mapFaces.geometry(), focusable(new THREE.MeshLambertMaterial({ map: tex(mapCanvas) }), focus)));
  return out;
}

// ---------- buildings ----------

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

const ROOF_UV = [0.02, 0.02]; // a mortar-dark texel of the facade, darkened further by vertex colour
const ROOF_SHADE = 0.3;

/**
 * A house in model space: width along x, depth along z (front +Z), walls to wallH and, with ridge > wallH, a
 * gable roof along the width. Facade uvs are metres / 6 (one window tile).
 */
function house(w, d, wallH, ridge = wallH) {
  const m = new Mesher();
  const hw = w / 2;
  const hd = d / 2;
  const C = [[-hw, hd], [hw, hd], [hw, -hd], [-hw, -hd]];
  for (let i = 0; i < 4; i++) {
    const a = C[i];
    const b = C[(i + 1) % 4];
    const n = norm2([(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]);
    const wl = Math.hypot(b[0] - a[0], b[1] - a[1]);
    m.quad(m.v(a[0], 0, a[1], n[0], 0, n[1], 0, 0), m.v(b[0], 0, b[1], n[0], 0, n[1], wl / 6, 0),
      m.v(b[0], wallH, b[1], n[0], 0, n[1], wl / 6, wallH / 6), m.v(a[0], wallH, a[1], n[0], 0, n[1], 0, wallH / 6));
  }
  const [ru, rv] = ROOF_UV;
  if (ridge > wallH + 0.01) {
    const rise = ridge - wallH;
    const ny = hd / Math.hypot(hd, rise);
    const nz = rise / Math.hypot(hd, rise);
    for (const s of [1, -1]) {
      m.quad(m.v(-hw, wallH, s * hd, 0, ny, s * nz, ru, rv, ROOF_SHADE), m.v(hw, wallH, s * hd, 0, ny, s * nz, ru, rv, ROOF_SHADE),
        m.v(hw, ridge, 0, 0, ny, s * nz, ru, rv, ROOF_SHADE), m.v(-hw, ridge, 0, 0, ny, s * nz, ru, rv, ROOF_SHADE));
      // Gable end: brick up to the ridge.
      const gx = s * hw;
      m.tri(m.v(gx, wallH, hd, s, 0, 0, 0, wallH / 6), m.v(gx, wallH, -hd, s, 0, 0, d / 6, wallH / 6), m.v(gx, ridge, 0, s, 0, 0, d / 12, ridge / 6));
    }
  } else {
    m.quad(m.v(-hw, wallH, hd, 0, 1, 0, ru, rv, ROOF_SHADE), m.v(hw, wallH, hd, 0, 1, 0, ru, rv, ROOF_SHADE),
      m.v(hw, wallH, -hd, 0, 1, 0, ru, rv, ROOF_SHADE), m.v(-hw, wallH, -hd, 0, 1, 0, ru, rv, ROOF_SHADE));
  }
  return m.geometry();
}

const itemMatrix = (it) => new THREE.Matrix4().compose(
  new THREE.Vector3(it.x, it.y ?? 0, it.z),
  new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.yaw ?? 0),
  new THREE.Vector3(...(it.s ?? [1, 1, 1])),
);

// Background masses and gen's blocks: one merged mesh, each block tinted through its vertex colours.
function blocks(list) {
  const parts = list.map((b) => {
    const g = house(b.w, b.d, b.roof ? b.h * 0.7 : b.h, b.h);
    const c = g.getAttribute('color');
    for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * b.tint[0], c.getY(i) * b.tint[1], c.getZ(i) * b.tint[2]);
    return g.applyMatrix4(itemMatrix(b));
  });
  return mergeGeometries(parts);
}

// ---------- code-built props ----------

// Vertex-coloured geometry: every vertex gets `hex` (sRGB), shaded by `shade(y)`.
function coloured(g, hex, shade = () => 1) {
  if (g.index) g = g.toNonIndexed();
  g.deleteAttribute('uv');
  const c = new THREE.Color(hex);
  const p = g.getAttribute('position');
  const out = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) { const k = shade(p.getY(i), i); out.set([c.r * k, c.g * k, c.b * k], i * 3); }
  g.setAttribute('color', new THREE.BufferAttribute(out, 3));
  return g;
}

// Deterministic per-vertex wobble so stand-in canopies are lumpy, not geodesic.
function lumpy(g, amount, seed) {
  const p = g.getAttribute('position');
  const rng = createRng(`lumpy|${seed}`);
  const byKey = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!byKey.has(key)) byKey.set(key, 1 + (rng() - 0.5) * 2 * amount);
    const k = byKey.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k, p.getZ(i) * k);
  }
  // Welded before normals so the blob shades smooth, not faceted.
  g.deleteAttribute('normal');
  g.deleteAttribute('uv');
  const welded = mergeVertices(g);
  welded.computeVertexNormals();
  return welded;
}

const vertexMat = () => new THREE.MeshLambertMaterial({ vertexColors: true });

// Far stand-ins for the three tree models: ~90 triangles each, sized to the models' bounds (meta.json).
function treeStandIn(kind) {
  const trunk = (h, r, hex) => coloured(new THREE.CylinderGeometry(r * 0.7, r, h, 6, 1, true).translate(0, h / 2, 0), hex);
  const canopy = (r, sy, y, seed, hex, detail = 1) => coloured(lumpy(new THREE.IcosahedronGeometry(r, detail), 0.14, seed).scale(1, sy, 1).translate(0, y, 0), hex,
    (py) => 0.72 + 0.4 * THREE.MathUtils.clamp((py - y + r * sy) / (2 * r * sy), 0, 1));
  if (kind === 'pine') {
    const cone = (r, h, y) => coloured(new THREE.ConeGeometry(r, h, 7, 1, true).translate(0, y + h / 2, 0), '#2f4a2a', (py) => 0.7 + 0.35 * (py - y) / h);
    return mergeGeometries([trunk(1.4, 0.16, '#4a3a2c'), cone(1.7, 3.2, 0.9), cone(1.2, 2.6, 2.9)]);
  }
  if (kind === 'birch') return mergeGeometries([trunk(3.2, 0.12, '#c9c4b8'), canopy(1.45, 1.6, 4.4, 'birch', '#6f8a46')]);
  // Oak: three overlapping lobes read as a crown, one sphere reads as a ball.
  // Lobes at icosahedron detail 0 (20 faces, smooth-shaded): the overlap carries the shape, ~70 triangles a tree.
  const lobe = (r, x, y, z, seed) => canopy(r, 0.85, y, seed, '#4f6b35', 0).translate(x, 0, z);
  return mergeGeometries([trunk(2.6, 0.22, '#4f3f30'), lobe(2.5, -0.9, 4.2, 0.4, 'oak1'), lobe(2.3, 1.1, 4.5, -0.3, 'oak2'), lobe(2.1, 0.1, 5.4, -0.2, 'oak3')]);
}

// Parked-car stand-in: body and cabin; the body is white so instance paint shows, the glass stays dark.
function carStandIn() {
  const body = coloured(new THREE.BoxGeometry(1.75, 0.72, 4.0).translate(0, 0.62, 0), '#ffffff');
  const cabin = coloured(new THREE.BoxGeometry(1.5, 0.5, 2.1).translate(0, 1.22, -0.25), '#1a1d21');
  return mergeGeometries([body, cabin]);
}

// Grass tuft: five blades leaning out from the root, dark at the base and light at the tip.
function tuftGeometry() {
  const p = [];
  const c = [];
  const base = new THREE.Color('#3e5a26');
  const tip = new THREE.Color('#9fb565');
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * TAU + 0.3;
    const lean = 0.12 + (i % 2) * 0.1;
    const h = 0.32 + (i % 3) * 0.08;
    const d = [Math.cos(a), Math.sin(a)];
    const side = [-d[1] * 0.035, d[0] * 0.035];
    p.push(side[0], 0, side[1], -side[0], 0, -side[1], d[0] * lean, h, d[1] * lean);
    c.push(base.r, base.g, base.b, base.r, base.g, base.b, tip.r, tip.g, tip.b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(c, 3));
  // Up-facing normals: a blade lit like the grass it stands in, from either side.
  g.setAttribute('normal', new THREE.Float32BufferAttribute(p.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  return g;
}

// Hedge runs as one merged, lumpy extrusion, shaded per vertex.
function hedgeRuns(runs) {
  const m = new Mesher();
  // Half-profile across the hedge (lateral, height) as fractions of thickness/height; mirrored for the far side.
  const prof = [[0.5, 0], [0.52, 0.55], [0.42, 0.88], [0.18, 1], [-0.18, 1], [-0.42, 0.88], [-0.52, 0.55], [-0.5, 0]];
  for (const r of runs) {
    const rng = createRng(`hedge|${r.a.join(',')}`);
    const d = [r.b[0] - r.a[0], r.b[1] - r.a[1]];
    const L = Math.hypot(d[0], d[1]);
    if (L < 0.5) continue;
    const u = [d[0] / L, d[1] / L];
    const l = leftOf2(u);
    const n = Math.max(1, Math.round(L / 0.6));
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const s = (L * i) / n;
      const bump = 1 + (rng() - 0.5) * 0.16;
      const ids = prof.map(([lat, y], k) => {
        const end = i === 0 || i === n ? 0.85 : 1;
        const w = lat * r.thickness * bump * end;
        const h = y * r.height * (y > 0 ? bump * end : 1);
        const nl = Math.sign(lat) * (y < 0.9 ? 1 : 0.4);
        const ny = y > 0.5 ? 0.9 : 0.2;
        const shade = (0.62 + 0.4 * y) * (k > 3 ? 0.92 : 1) * (0.88 + rng() * 0.24);
        return m.v(r.a[0] + u[0] * s + l[0] * w, h, r.a[1] + u[1] * s + l[1] * w, l[0] * nl, ny, l[1] * nl, s / 1.2, h / 1.2, shade);
      });
      if (prev) for (let k = 0; k < prof.length - 1; k++) m.quad(prev[k], ids[k], ids[k + 1], prev[k + 1]);
      prev = ids;
    }
  }
  const g = m.geometry();
  const c = g.getAttribute('color');
  // Each run keeps one tint: written per vertex as the shade times the run's foliage tint.
  let v = 0;
  for (const r of runs) {
    const L = Math.hypot(r.b[0] - r.a[0], r.b[1] - r.a[1]);
    if (L < 0.5) continue;
    const count = (Math.max(1, Math.round(L / 0.6)) + 1) * prof.length;
    for (let i = 0; i < count; i++, v++) c.setXYZ(v, c.getX(v) * r.tint[0], c.getY(v) * r.tint[1], c.getZ(v) * r.tint[2]);
  }
  return g;
}

// Pedestrian guard railing: posts every 2 m, three rails; one merged mesh for every run.
function railings(runs) {
  const parts = [];
  const box = (a, b, y0, y1, t) => {
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const g = new THREE.BoxGeometry(t, y1 - y0, L).translate(0, (y0 + y1) / 2, L / 2);
    g.rotateY(Math.atan2(b[0] - a[0], b[1] - a[1])).translate(a[0], KERB_H, a[1]);
    return coloured(g, '#9aa0a6');
  };
  for (const r of runs) {
    const pts = r.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      for (const [y, t] of [[0.98, 0.05], [0.55, 0.035], [0.15, 0.035]]) parts.push(box(pts[i], pts[i + 1], y - t / 2, y + t / 2, t));
      if (i % 2 === 0) parts.push(box(pts[i], [pts[i][0] + 0.001, pts[i][1] + 0.05], 0, 1.0, 0.05));
    }
  }
  return parts.length ? mergeGeometries(parts) : null;
}

// Street light, code-built (~100 triangles against the model's 2000): pole, outreach arm, lantern; the
// lantern's lens is a separate part so it can glow at dusk.
function streetlightParts() {
  const arm = new THREE.BoxGeometry(0.07, 0.07, 1.6);
  arm.rotateX(-0.12).translate(0, 7.72, 0.72);
  const body = mergeGeometries([
    coloured(new THREE.CylinderGeometry(0.06, 0.1, 7.7, 8).translate(0, 3.85, 0), '#7a7d80'),
    coloured(arm, '#7a7d80'),
    coloured(new THREE.BoxGeometry(0.26, 0.11, 0.62).translate(0, 7.84, 1.6), '#4b4e52'),
  ]);
  const lens = new THREE.PlaneGeometry(0.2, 0.5).rotateX(Math.PI / 2).translate(0, 7.78, 1.6);
  return [
    { geometry: body, material: vertexMat() },
    { geometry: lens, material: new THREE.MeshBasicMaterial({ color: 0xfff1d6 }), tint: false },
  ];
}

// ---------- scenery sets ----------

/**
 * Per kind: full detail within `near` metres of the camera, the stand-in out to `far`, nothing beyond.
 * Distances are for high quality; LOD_SCALE shortens them. Background (`far`) items only ever get the stand-in.
 */
const LOD = {
  // Stand-ins end at 240 m: past that the fog (density ~0.0065) has taken over 90% of the colour.
  tree: { near: 45, far: 240 }, birch: { near: 45, far: 240 }, pine: { near: 45, far: 240 },
  terrace: { near: 40, far: 240 }, shopfront: { near: 40, far: 240 }, cottage: { near: 40, far: 240 },
  car: { near: 16, far: 150 },
  man: { near: 45 }, woman: { near: 45 }, businessman: { near: 45 }, statue: { near: 400 },
  tuft: { near: 38 }, bin: { near: 60 }, bollard: { near: 90 }, shelter: { near: 160 }, light: { near: 260 },
  bush: { near: 30, far: 200 }, clocktower: { near: 400 }, shadow: { near: 110 },
};
const LOD_SCALE = { high: 1, medium: 0.8, low: 0.6 };
const WALKERS = new Set(['man', 'woman', 'businessman']);
const STAND_IN = {
  tree: () => treeStandIn('tree'), birch: () => treeStandIn('birch'), pine: () => treeStandIn('pine'),
  terrace: () => house(18.7, 12.1, 7.4, 10.3), shopfront: () => house(7.2, 8.8, 11, 11), cottage: () => house(8.8, 7.5, 4.6, 6.9),
  car: carStandIn,
  bush: () => coloured(lumpy(new THREE.IcosahedronGeometry(0.62, 1), 0.16, 'bush').translate(0, 0.5, 0), '#4f6b35', (y) => 0.7 + 0.35 * y),
};

/**
 * Walkers: a slow out-and-back along the pavement with a small bob, in the vertex shader from one time
 * uniform. aWalk = (length m, speed m/s, phase m). The return leg turns the model round (xz negated).
 */
function walking(material, time) {
  material.onBeforeCompile = (sh) => {
    sh.uniforms.uWalkTime = time;
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', `#include <common>
        attribute vec3 aWalk; uniform float uWalkTime;
        vec3 walkLeg() {
          float t = uWalkTime * aWalk.y + aWalk.z;
          float c = mod(t, 2.0 * aWalk.x);
          return c < aWalk.x ? vec3(1.0, c, t) : vec3(-1.0, 2.0 * aWalk.x - c, t);
        }`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvec3 leg = walkLeg();\nobjectNormal.xz *= leg.x;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\ntransformed.xz *= leg.x;\ntransformed.z += leg.y;\ntransformed.y += abs(sin(leg.z * 3.3)) * 0.035;');
  };
  material.customProgramCacheKey = () => 'rb-walk';
  return material;
}

// Parked-car paint: the instance colour reaches only vertices with aMask = 1 (the paint), not tyres or trim.
function paintMasked(material) {
  material.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aMask;')
      .replace('#include <color_vertex>', '#include <color_vertex>\n#ifdef USE_INSTANCING_COLOR\nvColor.xyz = color.xyz * mix(vec3(1.0), instanceColor.xyz, aMask);\n#endif');
  };
  material.customProgramCacheKey = () => 'rb-parked-paint';
  return material;
}

/**
 * One kind's instances, drawn as up to two groups of parts (near detail, far stand-in). Every part is an
 * InstancedMesh with room for all items and frustumCulled off: update() does per-instance culling and LOD
 * into shared instance buffers, so parts of a group cost one upload.
 */
function scenerySet(items, nearParts, farParts, { near, far = 0, extra = [], name = '' }) {
  const n = items.length;
  const M = new Float32Array(n * 16);
  items.forEach((it, i) => itemMatrix(it).toArray(M, i * 16));
  const tints = new Float32Array(n * 3);
  items.forEach((it, i) => tints.set(it.tint ?? [1, 1, 1], i * 3));
  const centres = [];
  const radii = [];
  const allParts = [...(nearParts ?? []), ...(farParts ?? [])];
  const sphere = new THREE.Sphere();
  const box = new THREE.Box3();
  for (const p of allParts) { p.geometry.computeBoundingBox(); box.union(p.geometry.boundingBox); }
  box.getBoundingSphere(sphere);
  items.forEach((it) => {
    const s = Math.max(...(it.s ?? [1, 1, 1]));
    const walk = it.walk ? it.walk.length / 2 : 0;
    centres.push(new THREE.Vector3(it.x + (it.walk ? it.walk.dx * walk : 0), (it.y ?? 0) + sphere.center.y * s, it.z + (it.walk ? it.walk.dz * walk : 0)));
    radii.push(sphere.radius * s + walk + 0.5);
  });

  const group = (parts, label) => {
    if (!parts?.length) return null;
    const matrix = new THREE.InstancedBufferAttribute(new Float32Array(n * 16), 16).setUsage(THREE.DynamicDrawUsage);
    const colour = new THREE.InstancedBufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage);
    const attrs = extra.map((e) => ({ ...e, attr: new THREE.InstancedBufferAttribute(new Float32Array(n * e.size), e.size).setUsage(THREE.DynamicDrawUsage) }));
    const meshes = parts.map((p) => {
      const g = p.geometry;
      for (const a of attrs) g.setAttribute(a.name, a.attr);
      const im = new THREE.InstancedMesh(g, p.material, n);
      im.instanceMatrix = matrix;
      if (p.tint !== false) im.instanceColor = colour;
      im.frustumCulled = false;
      im.count = 0;
      im.layers.set(2);
      im.name = label; // kind, and "~" for the stand-in: renderer.info audits by name
      return im;
    });
    return { meshes, matrix, colour, attrs, k: 0 };
  };
  const groups = [group(nearParts, name), group(farParts, `${name}~`)];
  const values = extra.map((e) => items.map(e.value));

  const put = (g, i) => {
    const k = g.k++;
    g.matrix.array.set(M.subarray(i * 16, i * 16 + 16), k * 16);
    g.colour.array.set(tints.subarray(i * 3, i * 3 + 3), k * 3);
    g.attrs.forEach((a, j) => g.attrs[j].attr.array.set(values[j][i], k * a.size));
  };
  return {
    meshes: groups.flatMap((g) => g?.meshes ?? []),
    update(eye, frustum) {
      for (const g of groups) if (g) g.k = 0;
      const [gn, gf] = groups;
      for (let i = 0; i < n; i++) {
        sphere.set(centres[i], radii[i]);
        if (!frustum.intersectsSphere(sphere)) continue;
        const d = eye.distanceTo(centres[i]) - radii[i];
        if (gn && !items[i].far && d < near) put(gn, i);
        else if (gf && d < far) put(gf, i);
      }
      for (const g of groups) {
        if (!g) continue;
        for (const m of g.meshes) m.count = g.k;
        g.matrix.needsUpdate = true;
        g.colour.needsUpdate = true;
        for (const a of g.attrs) a.attr.needsUpdate = true;
      }
    },
  };
}

// Untextured detail (frames, doors, planters) on the frontage models, clustered at 10 cm: about half the
// triangles and no visible change from the road; textured parts keep full detail (clustering smears atlas uvs).
const FLAT_CLUSTER = { terrace: 0.1, shopfront: 0.1 };

/**
 * The Grab3D facades come in seaside pastels (sky blue, pink, lemon). Muting pulls the map toward its own
 * luminance, so the per-instance tint (scenery.js FINISHES) reads as brick or render instead of paint.
 */
const MUTED = { terrace: 0.8, cottage: 0.6, shopfront: 0.7 };
function muted(material, amount) {
  material.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      diffuseColor.rgb = mix(diffuseColor.rgb, vec3(dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114))), ${amount.toFixed(2)});`);
  };
  material.customProgramCacheKey = () => `rb-muted-${amount}`;
  return material;
}

// GLB scenery parts: textured groups keep their map, the rest bake to vertex colours.
async function glbParts(url, { flatCell, ...opts } = {}) {
  const root = await loadGlb(url);
  return flatten(root, { mergeGlass: true, ...opts }).map((p) => ({
    geometry: flatCell && p.key === 'flat' ? cluster(p.geometry, flatCell) : p.geometry,
    material: p.key === 'flat' ? new THREE.MeshLambertMaterial({ vertexColors: true }) : new THREE.MeshLambertMaterial({ map: p.material.map }),
    key: p.key,
  }));
}

// ---------- assembly ----------

export function buildWorld(layout, { base }) {
  const group = new THREE.Group();
  const own = []; // textures made for this layout (GLB and shared textures are cached elsewhere)
  const keep = (o) => { group.add(o); return o; };
  // Scenery sits on layer 2, which the mirror cameras skip.
  const scenery = (o) => { o.layers.set(2); return keep(o); };
  const sets = [];
  const walkTime = { value: 0 };
  const frustum = new THREE.Frustum();
  const viewProj = new THREE.Matrix4();
  const eye = new THREE.Vector3();

  // Tints are linear multipliers: the grass source is dry summer grass, pushed to a UK verge green.
  const asphalt = patchy(new THREE.MeshLambertMaterial({ map: asphaltTexture(), color: new THREE.Color().setRGB(1.18, 1.18, 1.18) }), ROAD_TILE, 0.92, 1.08);
  const concrete = new THREE.MeshLambertMaterial({ map: texture(`${base}/assets/tex/pavement.webp`), vertexColors: true, color: new THREE.Color().setRGB(1.05, 1.08, 1.12) });
  // Mown verge with worn and lush patches: the swing hides the 6 m tile, the hue lean reads as real turf.
  const grass = patchy(new THREE.MeshLambertMaterial({ map: texture(`${base}/assets/tex/grass.webp`), color: new THREE.Color().setRGB(0.95, 1.7, 1.05) }), GRASS_TILE, 0.82, 1.1, 0.12);

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
  // Guided focus pulses: sign ids index layout.signs, arrow ids are arm indices (separate uniforms).
  const signFocus = { id: { value: -1 }, pulse: { value: 0 } };
  const arrowFocus = { id: { value: -1 }, pulse: { value: 0 } };
  const markMat = focusable(new THREE.MeshLambertMaterial({ map: atlas.texture, alphaTest: 0.5, color: 0xf2f2ee, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }), arrowFocus);
  keep(new THREE.Mesh(markings(layout, atlas), markMat));
  own.push(atlas.texture);

  const signsReady = signs(layout, base, signFocus).then((meshes) => meshes.forEach((m) => { own.push(m.material.map); keep(m); }));

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

  let lensMat = null;
  // Lit lanterns only at dusk; by day the lens is the lantern's own grey.
  const setLens = () => lensMat?.color.set(palette.leds ? '#fff1d6' : '#8d9093');
  let palette = PALETTES.light;
  const blob = blobTexture(); // a fresh texture per call: this world owns it
  own.push(blob);
  const treeShadowMat = new THREE.MeshBasicMaterial({ map: blob, color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  let disposed = false;

  async function dress(quality = 'high') {
    const { items } = placeScenery(layout, quality);
    const scale = LOD_SCALE[quality] ?? 1;
    const add = (set) => { if (disposed || !set.meshes.length) return; sets.push(set); set.meshes.forEach(scenery); };
    const lod = (kind) => ({ near: (LOD[kind]?.near ?? 100) * scale, far: (LOD[kind]?.far ?? 0) * scale, name: kind });
    const jobs = [];
    const model = (name) => `${base}/assets/models/scenery/${name}.glb`;

    // GLB kinds with an optional code-built stand-in.
    for (const kind of ['tree', 'birch', 'pine', 'terrace', 'shopfront', 'cottage', 'bush', 'bin', 'bollard', 'shelter', 'clocktower']) {
      const list = items[kind];
      if (!list?.length) continue;
      jobs.push((async () => {
        const facadeMap = ['terrace', 'shopfront', 'cottage'].includes(kind) ? await facade(base) : null;
        const far = STAND_IN[kind] ? [{ geometry: STAND_IN[kind](), material: facadeMap ? new THREE.MeshLambertMaterial({ map: facadeMap, vertexColors: true }) : vertexMat() }] : null;
        const nearParts = await glbParts(model(kind), { flatCell: FLAT_CLUSTER[kind] }).catch(() => null);
        if (MUTED[kind]) for (const p of nearParts ?? []) if (p.material.map) muted(p.material, MUTED[kind]);
        add(scenerySet(list, nearParts, far, lod(kind)));
      })());
    }
    // Walkers and the statue (the man model cast in bronze on a plinth).
    for (const kind of WALKERS) {
      const list = items[kind];
      if (!list?.length) continue;
      jobs.push(glbParts(model(kind)).then((parts) => {
        const walkers = list.filter((it) => it.walk);
        const still = list.filter((it) => !it.walk);
        if (walkers.length) {
          const wparts = parts.map((p) => ({ geometry: p.geometry.clone(), material: walking(p.material.clone(), walkTime) }));
          add(scenerySet(walkers, wparts, null, { ...lod(kind), extra: [{ name: 'aWalk', size: 3, value: (it) => [it.walk.length, it.walk.speed, it.walk.phase] }] }));
        }
        if (still.length) add(scenerySet(still, parts, null, lod(kind)));
      }));
    }
    if (items.statue?.length) {
      const s = items.statue[0];
      if (!disposed) scenery(new THREE.Mesh(new THREE.BoxGeometry(1.6, 1.6, 1.6).translate(s.x, 0.8 + s.y, s.z), new THREE.MeshLambertMaterial({ color: 0x9a958c })));
      jobs.push(glbParts(model('man'), { flat: true, colour: () => new THREE.Color(0.16, 0.11, 0.06) }).then((parts) => {
        add(scenerySet([{ ...s, y: s.y + 1.6, s: [1.5, 1.5, 1.5] }], parts, null, lod('statue')));
      }));
    }
    // Parked cars: the hatch model, paint by instance colour; a box stand-in further out.
    if (items.car?.length) {
      jobs.push(loadGlb(`${base}/assets/models/hatch.glb`).then((root) => {
        // A parked car is never closer than its drive: the untextured body clusters at 5 cm (10k -> ~5k triangles).
        const parts = flatten(root, { mergeGlass: true, colour: (mat) => (/paint/i.test(mat.name) ? new THREE.Color(1, 1, 1) : mat.color), mask: (mat) => (/paint/i.test(mat.name) ? 1 : 0) })
          .map((p) => (p.key === 'flat'
            ? { geometry: cluster(p.geometry, 0.05), material: paintMasked(vertexMat()) }
            : { geometry: p.geometry, material: new THREE.MeshLambertMaterial({ map: p.material.map }), tint: false }));
        add(scenerySet(items.car, parts, [{ geometry: carStandIn(), material: vertexMat() }], lod('car')));
      }));
    }

    // Code-built kinds.
    if (items.light?.length) {
      const parts = streetlightParts();
      lensMat = parts[1].material;
      setLens();
      add(scenerySet(items.light, parts, null, lod('light')));
    }
    if (items.tuft?.length) add(scenerySet(items.tuft, [{ geometry: tuftGeometry(), material: new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }) }], null, lod('tuft')));
    const shadows = ['tree', 'birch', 'pine'].flatMap((k) => (items[k] ?? []).filter((it) => it.shadow && !it.far))
      .map((it) => ({ x: it.x, z: it.z, y: 0.02, yaw: 0, s: [it.shadow * 2.2, 1, it.shadow * 2.2] }));
    if (shadows.length) add(scenerySet(shadows, [{ geometry: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), material: treeShadowMat, tint: false }], null, lod('shadow')));
    if (items.hedgeRun?.length) {
      // Privet green; the lumps and per-vertex shade carry the leafiness (the model's atlas does not tile).
      scenery(new THREE.Mesh(hedgeRuns(items.hedgeRun), new THREE.MeshLambertMaterial({ color: '#4d6b34', vertexColors: true })));
    }
    if (items.railing?.length) {
      const g = railings(items.railing);
      if (g) scenery(new THREE.Mesh(g, vertexMat()));
    }
    if (items.block?.length) {
      const tex = await facade(base);
      if (!disposed) scenery(new THREE.Mesh(blocks(items.block), new THREE.MeshLambertMaterial({ map: tex, vertexColors: true })));
    }
    await Promise.all(jobs);
    await signsReady;
  }

  function setTheme(p) {
    palette = p;
    setLens();
    treeShadowMat.opacity = p.shadow * 0.75;
    routeMat.color.set(getComputedStyle(document.documentElement).getPropertyValue('--rb-route').trim() || '#2A9D8F');
  }

  // Per frame, before render: refill every scenery set with what this camera sees, near or stand-in.
  function update(camera) {
    const t = performance.now() / 1000;
    walkTime.value = t;
    // Soft 1.4 s breathing, 0.08-0.35: visible at a glance, never a flash.
    const pulse = 0.08 + 0.27 * (0.5 - 0.5 * Math.cos((t * TAU) / 1.4));
    signFocus.pulse.value = signFocus.id.value >= 0 ? pulse : 0;
    arrowFocus.pulse.value = arrowFocus.id.value >= 0 ? pulse : 0;
    // The cockpit camera rides in the car's group: bring its parents up to date before reading it.
    camera.updateWorldMatrix(true, false);
    viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(viewProj);
    eye.setFromMatrixPosition(camera.matrixWorld);
    for (const s of sets) s.update(eye, frustum);
  }

  return {
    group,
    ready: signsReady,
    dress,
    update,
    setTheme,
    showRoute(on) { route.visible = on; },
    // Guided focus: index into layout.signs, or null.
    highlightSign(index) { signFocus.id.value = index ?? -1; },
    // Guided focus: the lane arrows painted on one arm's approach, or null.
    highlightArrows(arm) { arrowFocus.id.value = arm ?? -1; },
    dispose() {
      disposed = true;
      const seen = new Set();
      group.traverse((o) => {
        if (o.geometry && !seen.has(o.geometry)) { seen.add(o.geometry); o.geometry.dispose(); }
        if (o.material && !seen.has(o.material)) { seen.add(o.material); o.material.dispose(); }
      });
      for (const t of own) t?.dispose();
      group.removeFromParent();
    },
  };
}
