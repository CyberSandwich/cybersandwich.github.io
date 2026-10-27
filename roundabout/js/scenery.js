/**
 * Scenery placement: pure (no three, no DOM), deterministic per (layout, quality).
 *
 *   boundaries(layout)          land edges between neighbouring arms, as [x, z] polylines with the land on the LEFT
 *   keepOut(layout, bounds)     { splays, test(p, r, opts) -> reason | null }: where nothing may stand
 *   placeScenery(layout, quality) -> { bounds, keepOut, items: { [kind]: Item[] } }
 *     Item = { x, z, y, yaw (rotation.y turning the model's +Z front), s: [sx, sy, sz], tint: [r, g, b], far,
 *              walk? { dx, dz, length, speed, phase }, plus kind fields (block w/d/h/roof, hedgeRun a/b, railing pts) }
 *     kind is a scenery model name (tree, terrace, man...) or a code-built one (light, tuft, hedgeRun, railing,
 *     block, car, statue). `far` marks background masses, which only ever get the cheap stand-in; the renderer
 *     picks full detail or stand-in for the rest by distance to the camera.
 *
 * Sightlines are the lesson: every item passes the keep-out filter (the ring, every arm's visibility splay to
 * the right of its give-way line, each sign's reading corridor, and the carriageway). The exceptions are the
 * tier's deliberate occluders from gen.js (mini's hedges and parked car), which stand exactly where gen put them.
 * Frame: geom.js (x east, z south, compass bearings, clockwise positive).
 */
import { createRng } from './rng.js';
import { TAU, dir, bearingOf, wrap2Pi, dot, len, corners, quadsOverlap } from './geom.js';

export const PAVEMENT = 2.2;
const FAR = 650; // axial reach of the arms into the fog

// Per-tier recipe. Counts are at high quality; QUALITY scales the optional and distant parts first.
export const RECIPES = {
  mini: {
    frontage: { kinds: { cottage: 1 }, gap: [5, 16], skip: 0.3, setback: [9, 14], reach: 130 },
    avenue: { spacing: [15, 24], chance: 0.45, kinds: { tree: 5, birch: 3, pine: 1 } },
    gardenHedges: 0.7, tufts: 260, lights: 34, people: 2, cars: 0.5, railings: false, bins: 1,
    background: { trees: 70, blocks: 14, roof: 1 },
  },
  easy: {
    frontage: { kinds: { cottage: 3, terrace: 1 }, gap: [3, 12], skip: 0.25, setback: [9, 14], reach: 140 },
    avenue: { spacing: [14, 22], chance: 0.55, kinds: { tree: 5, birch: 3, pine: 1 } },
    gardenHedges: 0.6, tufts: 240, lights: 32, people: 3, cars: 0.45, railings: false, bins: 2,
    background: { trees: 80, blocks: 20, roof: 0.8 },
  },
  medium: {
    frontage: { kinds: { terrace: 3, shopfront: 2, cottage: 1 }, gap: [0, 4], skip: 0.1, setback: [8, 12], reach: 160 },
    avenue: { spacing: [12, 18], chance: 0.6, kinds: { tree: 6, birch: 3, pine: 1 } },
    gardenHedges: 0.3, tufts: 200, lights: 30, people: 6, cars: 0.35, railings: true, bins: 3,
    background: { trees: 70, blocks: 34, roof: 0.5 },
  },
  hard: {
    frontage: { kinds: { terrace: 2, shopfront: 3 }, gap: [0, 2], skip: 0.05, setback: [8, 11], reach: 180 },
    avenue: { spacing: [12, 16], chance: 0.7, kinds: { tree: 6, birch: 2, pine: 2 } },
    gardenHedges: 0.15, tufts: 160, lights: 30, people: 8, cars: 0.3, railings: true, bins: 4,
    background: { trees: 60, blocks: 48, roof: 0.3 },
  },
};

export const QUALITY = {
  high: { far: 1, tufts: 1, people: 1, cars: 1 },
  medium: { far: 0.6, tufts: 0.5, people: 0.75, cars: 1 },
  low: { far: 0.3, tufts: 0, people: 0, cars: 0.5 },
};

// Model footprints (metres, unscaled): w along the road, d away from it; r is the keep-out radius.
export const MODELS = {
  tree: { h: 6.86, r: 3.2 }, birch: { h: 6.64, r: 1.5 }, pine: { h: 5.7, r: 1.7 },
  terrace: { w: 18.7, d: 12.12, h: 10.31 }, shopfront: { w: 7.23, d: 8.83, h: 10.98 }, cottage: { w: 8.84, d: 7.51, h: 6.9 },
  car: { w: 1.9, d: 4.4 },
};

const NEAR = 55; // metres beyond the ring where verge detail (tufts) stops
const FOG_LINE = 270; // beyond this from the centre the fog has swallowed everything
const SPLAY_BACK = 15; // CD 116: visibility to the right is measured from 15 m back from the give-way line

// ---------- polylines ----------

export const leftOf2 = (d) => [d[1], -d[0]];
export const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
export const arcLengths = (pts) => pts.reduce((acc, p, i) => (acc.push(i ? acc[i - 1] + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), acc), []);

// Resamples a polyline every `step` metres: [{ p, d (unit direction), s }].
export function resample(pts, step, from = 0) {
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

// Points of a kerb up to where it first reaches radius R (entry kerbs end inside the ring).
export function trimIn(pts, R) {
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
export function trimOut(pts, R) {
  for (let i = 0; i < pts.length; i++) {
    if (len(pts[i]) >= R) return [i > 0 ? onCircle(pts[i - 1], pts[i], R) : pts[i], ...pts.slice(i + 1)];
  }
  return pts.slice(-1);
}

// Continues a kerb end straight out along the arm axis to the fog.
export const extendOut = (p, bearing) => {
  const u = dir(bearing);
  const k = Math.max(0, FAR - dot(p, u));
  return [p[0] + u[0] * k, p[1] + u[1] * k];
};

// Interior points of the clockwise arc at radius R from bearing b0 to b1.
export function arcPoints(R, b0, b1, step = 1) {
  const sweep = wrap2Pi(b1 - b0);
  const n = Math.max(1, Math.ceil((sweep * R) / step));
  const out = [];
  for (let i = 1; i < n; i++) {
    const d = dir(b0 + (sweep * i) / n);
    out.push([d[0] * R, d[1] * R]);
  }
  return out;
}

export function circle(r, n = 64) {
  return Array.from({ length: n }, (_, i) => { const d = dir((i / n) * TAU); return [d[0] * r, d[1] * r]; });
}

// Land between arm i (its entry side) and arm i+1 (its exit side), traced with the land on the LEFT.
export function boundaries(layout) {
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

// Nearest-segment queries over many polylines through a coarse grid (long arm extensions span many cells).
function segmentIndex(lines, cell = 8) {
  const segs = [];
  const grid = new Map();
  const key = (i, j) => `${i},${j}`;
  for (const pts of lines) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const k = segs.length;
      segs.push([a, b]);
      const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const steps = Math.max(1, Math.ceil(L / (cell / 2)));
      const seen = new Set();
      for (let t = 0; t <= steps; t++) {
        const x = a[0] + ((b[0] - a[0]) * t) / steps;
        const z = a[1] + ((b[1] - a[1]) * t) / steps;
        const c = key(Math.floor(x / cell), Math.floor(z / cell));
        if (seen.has(c)) continue;
        seen.add(c);
        if (!grid.has(c)) grid.set(c, []);
        grid.get(c).push(k);
      }
    }
  }
  // Nearest segment within maxR: { d, side } (side > 0: on the segment's left, the land); null if none.
  function nearest(p, maxR) {
    const reach = Math.ceil(maxR / cell);
    const ci = Math.floor(p[0] / cell);
    const cj = Math.floor(p[1] / cell);
    const done = new Set();
    let best = null;
    for (let i = ci - reach; i <= ci + reach; i++) {
      for (let j = cj - reach; j <= cj + reach; j++) {
        for (const k of grid.get(key(i, j)) ?? []) {
          if (done.has(k)) continue;
          done.add(k);
          const [a, b] = segs[k];
          const ab = [b[0] - a[0], b[1] - a[1]];
          const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], ab) / (dot(ab, ab) || 1)));
          const d = Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
          const side = dot([p[0] - a[0], p[1] - a[1]], leftOf2(norm2(ab)));
          // At a shared vertex two segments tie; the one that sees the point more squarely decides the side.
          if (d <= maxR && (!best || d < best.d - 1e-9 || (Math.abs(d - best.d) <= 1e-9 && Math.abs(side) > Math.abs(best.side)))) best = { d, side };
        }
      }
    }
    return best;
  }
  return { nearest };
}

function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}

function distToSegment(p, a, b) {
  const ab = [b[0] - a[0], b[1] - a[1]];
  const t = Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], ab) / (dot(ab, ab) || 1)));
  return Math.hypot(p[0] - a[0] - ab[0] * t, p[1] - a[1] - ab[1] * t);
}

function distToPolygonEdge(p, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length; i++) best = Math.min(best, distToSegment(p, poly[i], poly[(i + 1) % poly.length]));
  return best;
}

// ---------- keep-out ----------

// CD 116 visibility to the right along the circulatory carriageway, by ICD (below 40 m: all of it up to the
// arm on the right).
function rightVisibility(icd) {
  if (icd < 40) return Infinity;
  if (icd <= 60) return 40;
  if (icd <= 100) return 50;
  return 70;
}

/**
 * Splays: for every arm, two fans (from 15 m back and from the give-way line itself, both at the offside lane)
 * to the near side of the circulatory carriageway upstream to the right, plus the right-hand arm's give-way
 * line, where a joining car shields traffic. Each fan is { arm, eye, targets, tris: [[eye, a, b]...] }.
 */
export function splays(layout) {
  const R = layout.outerRadius;
  const n = layout.arms.length;
  const ringR = R - layout.circulatory.laneWidth / 2;
  const raised = layout.island.kind === 'raised';
  const out = [];
  for (const arm of layout.arms) {
    const G = arm.giveWay[arm.giveWay.length - 1];
    const back = dir(G.heading + Math.PI);
    const eyes = [[G.x + back[0] * SPLAY_BACK, G.z + back[1] * SPLAY_BACK], [G.x, G.z]];
    const right = layout.arms[(arm.index - 1 + n) % n];
    const bG = bearingOf(G.x, G.z);
    const bRight = bearingOf(right.giveWay[0].x, right.giveWay[0].z);
    // Upstream is anticlockwise (traffic circulates clockwise), never past the arm on the right.
    const toRight = wrap2Pi(bG - bRight);
    const sweep = Math.min(toRight, rightVisibility(layout.icd) / ringR);
    const steps = Math.max(2, Math.ceil((sweep * ringR) / 2));
    for (const eye of eyes) {
      const targets = [];
      for (let i = 0; i <= steps; i++) {
        const d = dir(bG - (sweep * i) / steps);
        const P = [d[0] * ringR, d[1] * ringR];
        // A raised island hides the far side of the ring; over a painted mini disc the whole ring is in view.
        if (!raised || dot(P, [eye[0] - P[0], eye[1] - P[1]]) > 0) targets.push(P);
      }
      if (sweep >= toRight - 1e-9) targets.push(...right.giveWay.map((g) => [g.x, g.z]));
      // A fan of triangles, not one polygon: the right arm's give-way points can fold the outline over itself.
      const tris = targets.slice(1).map((t, k) => [eye, targets[k], t]);
      if (tris.length) out.push({ arm: arm.index, eye, targets, tris });
    }
  }
  return out;
}

// Each sign's reading corridor: from the sign 35 m out along its arm (where a driver reads it), 2.5 m wide.
function signCorridors(layout) {
  return layout.signs.map((s) => {
    const u = dir(layout.arms[s.arm].bearing);
    return [[s.x, s.z], [s.x + u[0] * 35, s.z + u[1] * 35]];
  });
}

/**
 * keepOut(layout, bounds).test(p, r, { pavement }) -> 'ring' | 'splay' | 'sign' | 'road' | null.
 * r is the item's footprint radius. Pavement items (lights, people, railings, bins) may stand on the
 * pavement; everything else keeps PAVEMENT + r off every kerb and on the land side.
 */
export function keepOut(layout, bounds = boundaries(layout)) {
  const R = layout.outerRadius;
  const ringIn = layout.island.kind === 'raised' ? layout.innerRadius - 1.5 : 0;
  const fans = splays(layout);
  const signs = signCorridors(layout);
  const index = segmentIndex(bounds);
  function test(p, r = 0, { pavement = false } = {}) {
    const l = len(p);
    if (l + r > ringIn && l - r < R + 1) return 'ring';
    for (const f of fans) for (const t of f.tris) if (pointInPolygon(p, t) || distToPolygonEdge(p, t) < r) return 'splay';
    for (const [a, b] of signs) if (distToSegment(p, a, b) < 2.5 + r) return 'sign';
    if (l < ringIn) return null; // the island
    const near = index.nearest(p, 40);
    if (near && near.side <= 0) return 'road';
    if (near && !pavement && near.d < PAVEMENT + r) return 'road';
    return null;
  }
  return { splays: fans, test };
}

// ---------- placement ----------

const weightedPick = (rng, weights) => rng.weighted(weights);
const tintFoliage = (rng) => { const b = 0.82 + rng() * 0.3; return [b * (0.94 + rng() * 0.1), b, b * (0.9 + rng() * 0.12)]; };
const tintBuilding = (rng) => { const b = 0.85 + rng() * 0.25; return [b * (0.97 + rng() * 0.08), b, b * (0.95 + rng() * 0.06)]; };
// UK house finishes as multipliers on a desaturated facade (world.js mutes the model's pastel paints):
// red brick, cream render, white render, buff brick, grey pebbledash.
const FINISHES = [[1.18, 0.74, 0.6], [1.1, 1.02, 0.84], [1.08, 1.07, 1.03], [1.1, 0.96, 0.76], [0.9, 0.91, 0.92]];
const tintFinish = (rng) => { const f = FINISHES[Math.floor(rng() * FINISHES.length)]; const b = 0.9 + rng() * 0.14; return f.map((c) => c * b); };
const tintPlain = (rng) => { const b = 0.9 + rng() * 0.18; return [b, b, b]; };
// UK paint mix (linear multipliers on a white paint base): silver, grey, black, white, blue, red.
const PAINTS = [[0.55, 0.56, 0.58], [0.22, 0.23, 0.25], [0.03, 0.03, 0.035], [0.85, 0.85, 0.83], [0.05, 0.12, 0.35], [0.45, 0.04, 0.03]];
const faceTo = (d) => Math.atan2(d[0], d[1]); // rotation.y turning a model's +Z toward d
// Recipe trees: uniform scale in SCALE, height a little either way, still inside SCALE.
export const SCALE = [0.85, 1.2];
const treeScale = (s, rng) => [s, Math.min(SCALE[1], Math.max(SCALE[0], s * (0.92 + rng() * 0.16))), s];

export function placeScenery(layout, quality = 'high') {
  // One stream per stage, and quality only ever drops items after their draws: the same seed gives the same
  // street at every quality, with less of it.
  const base = createRng(`${layout.seed}|${layout.tier}|scenery`);
  let rng = base.fork('gen');
  const recipe = RECIPES[layout.tier];
  const q = QUALITY[quality] ?? QUALITY.high;
  const R = layout.outerRadius;
  const bounds = boundaries(layout);
  const ko = keepOut(layout, bounds);
  const items = {};
  const push = (kind, item) => (items[kind] ??= []).push({ y: 0, s: [1, 1, 1], tint: [1, 1, 1], far: false, ...item });
  const footprints = []; // building and car quads, so nothing overlaps
  const samples = bounds.map((b) => resample(b, 1));
  const clear = (quad) => footprints.every((f) => !quadsOverlap(f, quad));
  const quadFree = (quad, centre, r) => !ko.test(centre, r) && quad.every((c) => !ko.test(c, 0)) && clear(quad);

  // Gen's scenery first: deliberate occluders verbatim, the rest through the filter.
  const sc = layout.scenery;
  sc.trees.forEach((t, i) => {
    const kind = i % 10 < 6 ? 'tree' : i % 10 < 9 ? 'birch' : 'pine';
    const s = t.height / MODELS[kind].h;
    if (ko.test([t.x, t.z], MODELS[kind].r * s * 0.6)) return;
    push(kind, { x: t.x, z: t.z, yaw: rng() * TAU, s: [s, s, s], tint: tintFoliage(rng), shadow: t.radius });
  });
  for (const h of sc.hedges) {
    if (layout.tier !== 'mini' && (ko.test(h.a, 0.5) || ko.test(h.b, 0.5))) continue;
    push('hedgeRun', { a: h.a, b: h.b, height: h.height, thickness: h.thickness, x: (h.a[0] + h.b[0]) / 2, z: (h.a[1] + h.b[1]) / 2, yaw: 0, tint: tintFoliage(rng), deliberate: layout.tier === 'mini' });
  }
  for (const b of sc.buildings) {
    const quad = corners(b.x, b.z, b.heading, b.d, b.w);
    if (!quadFree(quad, [b.x, b.z], 0)) continue;
    footprints.push(quad);
    push('block', { x: b.x, z: b.z, yaw: faceTo(dir(b.heading)), w: b.w, d: b.d, h: b.h, roof: 0, tint: tintBuilding(rng) });
  }

  // Frontage runs along every land edge, set back and facing the road.
  const F = recipe.frontage;
  rng = base.fork('frontage');
  const carRng = base.fork('cars');
  for (const S of samples) {
    let i = 0;
    while (i < S.length) {
      const l = len(S[i].p);
      if (l < R + 10 || l > R + F.reach) { i += 2; continue; }
      if (rng() < F.skip) { i += Math.round(rng.range(6, 14)); continue; }
      const kind = weightedPick(rng, F.kinds);
      const M = MODELS[kind];
      const setback = rng.range(...F.setback);
      const mid = S[Math.min(S.length - 1, i + Math.round(M.w / 2))];
      const dm = mid.d;
      const lm = leftOf2(dm);
      const c = [mid.p[0] + lm[0] * (setback + M.d / 2), mid.p[1] + lm[1] * (setback + M.d / 2)];
      const quad = corners(c[0], c[1], bearingOf(dm[0], dm[1]), M.w, M.d);
      if (quadFree(quad, c, 0)) {
        footprints.push(quad);
        const yaw = faceTo([-lm[0], -lm[1]]);
        const sy = 0.92 + rng() * 0.16;
        push(kind, { x: c[0], z: c[1], yaw, s: [1, sy, 1], tint: tintFinish(rng) });
        // Suburban fronts: a garden hedge along the pavement with a gap for the path, and maybe a car on the drive.
        if (kind === 'cottage' && rng() < recipe.gardenHedges) {
          const hb = setback - 2.6;
          const a0 = [mid.p[0] + lm[0] * hb - dm[0] * (M.w / 2), mid.p[1] + lm[1] * hb - dm[1] * (M.w / 2)];
          const a1 = [mid.p[0] + lm[0] * hb - dm[0] * 0.8, mid.p[1] + lm[1] * hb - dm[1] * 0.8];
          if (!ko.test(a0, 0.5) && !ko.test(a1, 0.5)) push('hedgeRun', { a: a0, b: a1, height: 1.1, thickness: 0.7, x: (a0[0] + a1[0]) / 2, z: (a0[1] + a1[1]) / 2, yaw: 0, tint: tintFoliage(rng) });
        }
        // A car on the drive: drawn whatever the quality (the footprint is kept either way), shown if it allows.
        const [roll, nose, model, paint] = [carRng(), carRng(), carRng(), carRng()];
        if ((kind === 'cottage' || kind === 'terrace') && roll < recipe.cars) {
          const cp = [mid.p[0] + lm[0] * (setback - 3.4) + dm[0] * (M.w / 2 - 2), mid.p[1] + lm[1] * (setback - 3.4) + dm[1] * (M.w / 2 - 2)];
          const cq = corners(cp[0], cp[1], bearingOf(lm[0], lm[1]), MODELS.car.d, MODELS.car.w);
          if (quadFree(cq, cp, 0)) {
            footprints.push(cq);
            if (roll < recipe.cars * q.cars) push('car', { x: cp[0], z: cp[1], yaw: faceTo(nose < 0.5 ? lm : [-lm[0], -lm[1]]), model: model < 0.6 ? 'hatch' : 'estate', tint: PAINTS[Math.floor(paint * PAINTS.length)] });
          }
        }
        i += Math.round(M.w + rng.range(...F.gap));
      } else {
        i += 3;
      }
    }
  }

  // Avenue trees on the verge between the pavement and the frontage.
  const A = recipe.avenue;
  rng = base.fork('avenue');
  for (const S of samples) {
    for (let s = rng.range(4, 10); s < S.length; s += rng.range(...A.spacing)) {
      const { p, d } = S[Math.floor(s)];
      if (len(p) > R + F.reach) continue;
      if (len(p) < R + 6 || rng() > A.chance) continue;
      const l = leftOf2(d);
      const lat = PAVEMENT + 1.4 + rng() * 1.2;
      const c = [p[0] + l[0] * lat + d[0] * rng.range(-1.5, 1.5), p[1] + l[1] * lat + d[1] * rng.range(-1.5, 1.5)];
      const kind = weightedPick(rng, A.kinds);
      const sc0 = SCALE[0] + rng() * (SCALE[1] - SCALE[0]);
      const r = MODELS[kind].r * sc0 * 0.6;
      if (ko.test(c, r, { pavement: true }) || footprints.some((f) => pointInPolygon(c, f))) continue;
      push(kind, { x: c[0], z: c[1], yaw: rng() * TAU, s: treeScale(sc0, rng), tint: tintFoliage(rng), shadow: r * 1.4 });
    }
  }

  // Street lights on the pavement every ~30 m, heads over the road.
  for (const b of bounds) {
    for (const s of resample(b, recipe.lights, 8)) {
      if (len(s.p) > 170) continue;
      const l = leftOf2(s.d);
      const c = [s.p[0] + l[0] * 0.5, s.p[1] + l[1] * 0.5];
      if (ko.test(c, 0.2, { pavement: true })) continue;
      push('light', { x: c[0], z: c[1], yaw: faceTo([-l[0], -l[1]]) });
    }
  }

  // Guard railing on the kerb edge near the junction (medium and hard), in short runs.
  if (recipe.railings) {
    for (const b of bounds) {
      let run = [];
      const flush = () => { if (run.length > 3) push('railing', { pts: run, x: run[0][0], z: run[0][1], yaw: 0 }); run = []; };
      for (const s of resample(b, 1)) {
        const l = leftOf2(s.d);
        const c = [s.p[0] + l[0] * 0.35, s.p[1] + l[1] * 0.35];
        if (len(c) < R + 25 && !ko.test(c, 0.1, { pavement: true })) run.push(c);
        else flush();
      }
      flush();
    }
  }

  // People on the pavements near the junction, walking slow loops.
  rng = base.fork('people');
  const people = Math.round(recipe.people * q.people);
  for (let k = 0, tries = 0; k < people && tries < people * 20; tries++) {
    const S = rng.pick(samples).filter((s) => len(s.p) > R + 6 && len(s.p) < R + 70);
    if (!S.length) continue;
    const s = rng.pick(S);
    const l = leftOf2(s.d);
    const c = [s.p[0] + l[0] * 1.2, s.p[1] + l[1] * 1.2];
    const length = rng.range(6, 14);
    const way = rng() < 0.5 ? 1 : -1;
    const e = [c[0] + s.d[0] * length * way, c[1] + s.d[1] * length * way];
    const m = [(c[0] + e[0]) / 2, (c[1] + e[1]) / 2];
    if ([c, m, e].some((pt) => ko.test(pt, 0.4, { pavement: true }))) continue;
    const kind = rng.pick(['man', 'woman', 'businessman']);
    const speed = rng.range(0.9, 1.3);
    push(kind, { x: c[0], z: c[1], yaw: faceTo([s.d[0] * way, s.d[1] * way]), s: [1, 0.95 + rng() * 0.1, 1], tint: tintPlain(rng), walk: { dx: s.d[0] * way, dz: s.d[1] * way, length, speed, phase: rng() * 100 } });
    k++;
  }

  // A bus stop with someone waiting on the player's approach (medium and hard), and bins on the pavements.
  rng = base.fork('stop');
  if (layout.tier === 'medium' || layout.tier === 'hard') {
    const b = bounds[layout.player.arm];
    const near = resample(b, 2).filter((s) => len(s.p) > R + 30 && len(s.p) < R + 45).find((s) => {
      const l = leftOf2(s.d);
      return !ko.test([s.p[0] + l[0] * 1.3, s.p[1] + l[1] * 1.3], 2, { pavement: true });
    });
    if (near) {
      const l = leftOf2(near.d);
      const c = [near.p[0] + l[0] * 1.3, near.p[1] + l[1] * 1.3];
      push('shelter', { x: c[0], z: c[1], y: 0.12, yaw: faceTo([-l[0], -l[1]]) });
      push(rng() < 0.5 ? 'woman' : 'man', { x: c[0] + near.d[0] * 2.2, z: c[1] + near.d[1] * 2.2, y: 0.12, yaw: faceTo([-l[0], -l[1]]) });
    }
  }
  rng = base.fork('bins');
  for (let k = 0, tries = 0; k < recipe.bins && tries < 30; tries++) {
    const S = rng.pick(samples).filter((s) => len(s.p) > R + 8 && len(s.p) < R + 60);
    if (!S.length) continue;
    const s = rng.pick(S);
    const l = leftOf2(s.d);
    const c = [s.p[0] + l[0] * (PAVEMENT - 0.4), s.p[1] + l[1] * (PAVEMENT - 0.4)];
    if (ko.test(c, 0.4, { pavement: true })) continue;
    push('bin', { x: c[0], z: c[1], y: 0.12, yaw: faceTo([-l[0], -l[1]]), tint: tintPlain(rng) });
    k++;
  }

  // Keep-left bollards on raised splitter noses (on the island, inside the road by design).
  for (const arm of layout.arms) {
    if (arm.splitter.kind !== 'raised') continue;
    const p = arm.splitter.polygon[0];
    const u = dir(arm.bearing);
    push('bollard', { x: p[0] + u[0] * 0.9, z: p[1] + u[1] * 0.9, y: 0.12, yaw: faceTo(u), s: [1.2, 1.1, 1.2] });
  }

  // Grass tufts on the verges and in the grass near the road.
  rng = base.fork('tufts');
  const tufts = Math.round(recipe.tufts * q.tufts);
  const nearVerge = samples.map((S) => S.filter((s) => len(s.p) > R + 2 && len(s.p) < R + NEAR));
  for (let k = 0, tries = 0; k < tufts && tries < tufts * 4; tries++) {
    const S = rng.pick(nearVerge);
    if (!S.length) continue;
    const s = rng.pick(S);
    const l = leftOf2(s.d);
    const lat = PAVEMENT + 0.2 + Math.pow(rng(), 1.6) * 9;
    const c = [s.p[0] + l[0] * lat, s.p[1] + l[1] * lat];
    if (ko.test(c, 0.2) || footprints.some((f) => pointInPolygon(c, f))) continue;
    const sz = 0.7 + rng() * 0.8;
    push('tuft', { x: c[0], z: c[1], yaw: rng() * TAU, s: [sz, sz * (0.7 + rng() * 0.6), sz], tint: tintFoliage(rng) });
    k++;
  }

  // Island: planting, a statue or a clock tower, kept inside its own edge.
  rng = base.fork('island');
  const island = layout.island;
  if (island.kind === 'raised') {
    // 2 m clear of the island kerb: planting crowns stay off the circulatory carriageway's sightlines.
    const ri = island.radius - island.apron - 2;
    const n = Math.min(12, Math.round(ri * 0.7));
    for (let i = 0; i < n; i++) {
      const d = dir(rng() * TAU);
      const r = ri * Math.sqrt(0.35 + 0.65 * rng());
      push('bush', { x: d[0] * r, z: d[1] * r, y: 0.12, yaw: rng() * TAU, s: [1.1 + rng() * 0.9, 0.9 + rng() * 0.8, 1.1 + rng() * 0.9], tint: tintFoliage(rng) });
    }
    // Large islands (hard, ICD 60 m and up) are landscaped: a shrub bed ringing the feature and tree clumps in the
    // inner part, which hide the far side of the ring the way real ones do; the outer 2 m stays clear.
    if (layout.tier === 'hard') {
      const bed = island.feature === 'clockTower' ? 5 : 3.5;
      const around = Math.round(bed * 3);
      for (let i = 0; i < around; i++) {
        const d = dir((i / around) * TAU + rng() * 0.2);
        const r = bed + rng() * 1.2;
        push('bush', { x: d[0] * r, z: d[1] * r, y: 0.12, yaw: rng() * TAU, s: [1 + rng() * 0.5, 0.9 + rng() * 0.5, 1 + rng() * 0.5], tint: tintFoliage(rng) });
      }
      // Three pairs: enough to read as planting, within the triangle budget at the line (~15k).
      const clumps = 3;
      for (let c = 0; c < clumps; c++) {
        const d = dir((c / clumps) * TAU + rng() * 0.8);
        const cr = ri * (0.4 + rng() * 0.25);
        for (let k = 0; k < 2; k++) {
          const p = [d[0] * cr + rng.range(-3, 3), d[1] * cr + rng.range(-3, 3)];
          const kind = rng() < 0.65 ? 'tree' : 'birch';
          const s0 = SCALE[0] + rng() * (SCALE[1] - SCALE[0]);
          // Crowns (tree ~3.2 m radius at scale 1) must stay inside the clear outer band.
          if (len(p) + MODELS[kind].r * s0 > ri) continue;
          push(kind, { x: p[0], z: p[1], y: 0.12, yaw: rng() * TAU, s: treeScale(s0, rng), tint: tintFoliage(rng), shadow: MODELS[kind].r * s0 * 0.85 });
        }
      }
    }
    // Long grass on the island: tufts, dropped with the verge tufts on low.
    for (let i = 0; i < Math.round(ri * 4); i++) {
      const d = dir(rng() * TAU);
      const r = ri * Math.sqrt(rng());
      const item = { x: d[0] * r, z: d[1] * r, y: 0.12, yaw: rng() * TAU, s: [1.8, 1.4 + rng() * 0.8, 1.8], tint: tintFoliage(rng) };
      if (q.tufts > 0) push('tuft', item);
    }
    if (island.feature === 'clockTower') push('clocktower', { x: 0, z: 0, y: 0.12, yaw: rng() * TAU });
    if (island.feature === 'statue') push('statue', { x: 0, z: 0, y: 0.12, yaw: rng() * TAU });
  }

  // Background masses out to the fog line: tree clumps and simple blocks, cheapest first to go.
  const BG = recipe.background;
  rng = base.fork('bgTrees');
  const bgTrees = Math.round(BG.trees * q.far);
  for (let k = 0, tries = 0; k < bgTrees && tries < bgTrees * 6; tries++) {
    const p = (() => { const d = dir(rng() * TAU); const r = R + F.reach * 0.6 + rng() * (FOG_LINE - R - F.reach * 0.6); return [d[0] * r, d[1] * r]; })();
    const kind = weightedPick(rng, A.kinds);
    const s0 = SCALE[0] + rng() * (SCALE[1] - SCALE[0]);
    if (ko.test(p, 3) || footprints.some((f) => pointInPolygon(p, f))) continue;
    // Clumps: a few trees round each seed point.
    for (let j = 0; j < 1 + Math.floor(rng() * 4) && k < bgTrees; j++) {
      const c = [p[0] + rng.range(-7, 7), p[1] + rng.range(-7, 7)];
      if (ko.test(c, 3)) continue;
      push(kind, { x: c[0], z: c[1], yaw: rng() * TAU, s: treeScale(s0, rng), tint: tintFoliage(rng), far: true });
      k++;
    }
  }
  rng = base.fork('blocks');
  const blocks = Math.round(BG.blocks * q.far);
  for (let k = 0, tries = 0; k < blocks && tries < blocks * 8; tries++) {
    const d = dir(rng() * TAU);
    const r = R + F.reach * 0.7 + rng() * (FOG_LINE - R - F.reach * 0.7);
    const c = [d[0] * r, d[1] * r];
    const w = rng.range(9, 22);
    const dd = rng.range(8, 13);
    const heading = bearingOf(-c[0], -c[1]) + rng.range(-0.3, 0.3);
    const quad = corners(c[0], c[1], heading, dd, w);
    if (!quadFree(quad, c, 0)) continue;
    footprints.push(quad);
    // Pitched-roof houses, or taller flat-roofed blocks.
    const pitched = rng() < BG.roof;
    push('block', { x: c[0], z: c[1], yaw: faceTo(dir(heading)), w, d: dd, h: rng.range(5.5, 9) * (pitched ? 1 : 1.6), roof: pitched ? 1 : 0, tint: tintBuilding(rng), far: true });
    k++;
  }

  return { bounds, keepOut: ko, items };
}
