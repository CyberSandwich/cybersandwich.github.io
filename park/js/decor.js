/**
 * The diorama's dressing, kept apart from the scene graph: where the props stand, which models they are, and how
 * car paint is recoloured. Plane frame as lot.js; Grab3D models face +Z.
 */
import * as THREE from 'three';

// Shared with /roundabout (scripts/build-roundabout-assets.sh builds both; park's own props are its `park` step).
export const CAR_URL = '/roundabout/assets/models/hatch.glb';
export const PROP_URLS = {
  estate: '/roundabout/assets/models/estate.glb',
  bush: '/roundabout/assets/models/scenery/bush.glb',
  hedge: '/roundabout/assets/models/scenery/hedge.glb',
  bin: '/roundabout/assets/models/scenery/bin.glb',
  light: '/roundabout/assets/models/scenery/streetlight.glb',
  cherry: '/park/assets/models/cherry.glb',
  maple: '/park/assets/models/maple.glb',
  vending: '/park/assets/models/vending.glb',
  ticket: '/park/assets/models/ticket.glb',
  bench: '/park/assets/models/bench.glb',
};

/** Paving past the back lines to the kerb (m). */
export const PAVE = 0.6;

/** Small seeded PRNG (mulberry32): the dressing is the same on every load. */
export function rng(seed) {
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Where the props stand, as plane placements { name, x, y, h, k } (h: heading the model faces, k: scale): a loose
 * row of cherry and maple trees behind each row's kerb with bushes between, and street furniture on the grass past
 * the row ends, facing the aisle.
 */
export function dressingFor(l) {
  const r = rng(7);
  const out = [];
  const put = (name, x, y, h, k = 1) => out.push({ name, x, y, h, k });
  const { xMin: X0, xMax: X1 } = l.bounds;
  const rx0 = l.xMin - PAVE, rx1 = l.xMax + PAVE;
  for (const s of [1, -1]) {
    const kerb = l.backY(s) + s * PAVE;
    const face = -s * Math.PI / 2; // toward the aisle
    for (let x = X0 + 2.5 + r() * 2; x < X1 - 2; x += 5 + r() * 2.5) {
      put(r() < 0.6 ? 'cherry' : 'maple', x, kerb + s * (3 + r() * 0.6), r() * Math.PI * 2, 0.55 + r() * 0.15);
      if (r() < 0.75) put('bush', x + 2.4 + r(), kerb + s * (1 + r() * 0.5), r() * Math.PI * 2, 0.8 + r() * 0.3);
    }
    // Hedges along the grass beside the aisle, past each end of the row.
    for (const [xa, xb] of [[X0 + 1, rx0 - 3], [rx1 + 6, X1 - 1]]) {
      for (let x = xa; x < xb; x += 2) put('hedge', x + 1, l.edgeY(s) + s * 0.9, 0);
    }
    put('light', s > 0 ? rx0 - 1 : rx1 + 1, l.edgeY(s) + s * 0.8, face, 0.55);
  }
  // A pay machine where you walk in, and a corner to sit at the far end.
  put('ticket', rx0 - 1.2, l.edgeY(1) + 2.4, -Math.PI / 2);
  put('vending', rx1 + 1.3, l.edgeY(1) + 1.8, -Math.PI / 2);
  put('bench', rx1 + 3, l.edgeY(1) + 1.8, -Math.PI / 2);
  put('bin', rx1 + 4.4, l.edgeY(1) + 1.6, 0);
  put('bench', rx0 - 3, l.edgeY(-1) - 1.8, Math.PI / 2);
  put('cherry', rx1 + 4, l.edgeY(-1) - 4.5, 1, 0.7);
  put('maple', rx0 - 6, l.edgeY(-1) - 4.8, 2, 0.6);
  return out;
}

/**
 * Repaints a car body texture: its dominant saturated hue is the paint, and those pixels take the new colour at their
 * own brightness; lights, trim and grilles keep theirs. Returns hex -> texture.
 */
function recolourer(tex) {
  const img = tex.image, w = img.width, h = img.height;
  const cv = Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(img, 0, 0);
  const src = ctx.getImageData(0, 0, w, h);
  const d = src.data, n = w * h;
  const hue = new Float32Array(n), val = new Float32Array(n), sat = new Float32Array(n);
  const bins = new Float32Array(36);
  for (let i = 0; i < n; i++) {
    const r = d[4 * i] / 255, g = d[4 * i + 1] / 255, b = d[4 * i + 2] / 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), c = mx - mn;
    val[i] = mx;
    sat[i] = mx ? c / mx : 0;
    let hh = 0;
    if (c) hh = mx === r ? ((g - b) / c) % 6 : mx === g ? (b - r) / c + 2 : (r - g) / c + 4;
    hue[i] = (hh * 60 + 360) % 360;
    if (sat[i] > 0.2) bins[Math.floor(hue[i] / 10)] += sat[i];
  }
  const paintHue = (bins.indexOf(Math.max(...bins)) + 0.5) * 10;
  const isPaint = (i) => sat[i] > 0.15 && Math.abs(((hue[i] - paintHue + 540) % 360) - 180) < 18;
  let sum = 0, cnt = 0;
  for (let i = 0; i < n; i++) if (isPaint(i)) { sum += val[i]; cnt++; }
  const base = cnt ? sum / cnt : 1;
  const out = new THREE.Color(), rgb = {};
  return (hex) => {
    out.set(hex).getRGB(rgb, THREE.SRGBColorSpace);
    const img2 = new ImageData(new Uint8ClampedArray(d), w, h);
    const o = img2.data;
    for (let i = 0; i < n; i++) {
      if (!isPaint(i)) continue;
      const k = val[i] / base * 255;
      o[4 * i] = rgb.r * k; o[4 * i + 1] = rgb.g * k; o[4 * i + 2] = rgb.b * k;
    }
    ctx.putImageData(img2, 0, 0);
    const t = new THREE.CanvasTexture(Object.assign(document.createElement('canvas'), { width: w, height: h }));
    t.image.getContext('2d').drawImage(cv, 0, 0);
    Object.assign(t, { flipY: tex.flipY, colorSpace: tex.colorSpace, wrapS: tex.wrapS, wrapT: tex.wrapT });
    return t;
  };
}

/**
 * A car model's paint kit: hex -> a function that repaints one mesh of a clone (the textured body and the flat paint
 * parts). Materials are cached per colour and shared by every car in that colour.
 */
export function paintKit(root) {
  let body = null, flat = null;
  root.traverse((o) => {
    if (!o.isMesh) return;
    if (/body_pbr/.test(o.material.name) && o.material.map) body = o.material;
    else if (/paint/i.test(o.material.name)) flat = o.material;
  });
  const recolour = body && recolourer(body.map);
  const cache = new Map();
  return (hex) => {
    if (!cache.has(hex)) {
      const b = body && Object.assign(body.clone(), { map: recolour(hex) });
      const f = flat && flat.clone();
      f?.color.set(hex);
      cache.set(hex, { b, f });
    }
    const { b, f } = cache.get(hex);
    return (o) => {
      if (!o.isMesh) return;
      if (b && o.material.name === body.name) o.material = b;
      else if (f && o.material.name === flat.name) o.material = f;
    };
  };
}

