/**
 * Plane geometry and path queries shared by gen, sim, player and judge.
 *
 * Frame: right-handed, y up, metres. x = east, z = south, so north is -z.
 * Angles are compass bearings in radians: 0 = north (-z), PI/2 = east (+x), increasing CLOCKWISE seen from above.
 * dir(b) = [sin b, -cos b]. A three.js object whose model faces -z gets rotation.y = -heading.
 * Curvature k is signed: k > 0 turns LEFT, k < 0 turns RIGHT (UK roundabout circulation is a right turn).
 *
 * Path = { x[], z[], s[], heading[], k[], bearing[], r[], step, length, marks, ... }
 *   s is cumulative arc length; bearing is the UNWRAPPED compass bearing of the point seen from the centre
 *   (increases monotonically around the ring); r its distance from the centre.
 */

export const TAU = Math.PI * 2;
export const SAMPLE_STEP = 0.5;

export const dir = (b) => [Math.sin(b), -Math.cos(b)];
export const bearingOf = (x, z) => Math.atan2(x, -z);
export const wrapPi = (a) => a - TAU * Math.floor((a + Math.PI) / TAU);
export const wrap2Pi = (a) => a - TAU * Math.floor(a / TAU);
export const leftOf = (h) => dir(h - Math.PI / 2);
export const mph = (v) => v * 0.44704;
export const toMph = (v) => v / 0.44704;

export const rotate = ([x, z], b) => [x * Math.cos(b) - z * Math.sin(b), x * Math.sin(b) + z * Math.cos(b)];
export const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
export const scale = (a, k) => [a[0] * k, a[1] * k];
export const len = (a) => Math.hypot(a[0], a[1]);
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1];

// Unit-vector helpers (leftOf above takes a heading; leftOf2 takes a unit direction).
export const leftOf2 = (d) => [d[1], -d[0]];
export const norm2 = (v) => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };

/**
 * Polylines are arrays of [x, z]. Entry kerbs run from far out toward the ring, exit kerbs from the ring out.
 */
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

// Points of a kerb from where it first reaches radius R outward.
export function trimOut(pts, R) {
  for (let i = 0; i < pts.length; i++) {
    if (len(pts[i]) >= R) return i > 0 ? [onCircle(pts[i - 1], pts[i], R), ...pts.slice(i)] : pts.slice(i);
  }
  return pts.slice(-1);
}

export const ARM_REACH = 650; // axial reach of the arms into the fog

// Continues a kerb end straight out along the arm axis to the fog.
export const extendOut = (p, bearing) => {
  const u = dir(bearing);
  const k = Math.max(0, ARM_REACH - dot(p, u));
  return [p[0] + u[0] * k, p[1] + u[1] * k];
};

export function circle(r, n = 64) {
  return Array.from({ length: n }, (_, i) => { const d = dir((i / n) * TAU); return [d[0] * r, d[1] * r]; });
}

export function pointInPolygon(p, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i];
    const [xj, zj] = poly[j];
    if ((zi > p[1]) !== (zj > p[1]) && p[0] < ((xj - xi) * (p[1] - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Segments: { kind: 'line', p0, p1 } or { kind: 'arc', c, r, a0, sweep }.
 * Arc points are c + r * dir(a), a = a0 + sweep * t / |sweep|; sweep > 0 is clockwise (right turn).
 */
export const line = (p0, p1) => ({ kind: 'line', p0, p1 });
export const arc = (c, r, a0, sweep) => ({ kind: 'arc', c, r, a0, sweep });

export function segLength(seg) {
  return seg.kind === 'line' ? len([seg.p1[0] - seg.p0[0], seg.p1[1] - seg.p0[1]]) : Math.abs(seg.sweep) * seg.r;
}

export function rotateSeg(seg, b) {
  if (seg.kind === 'line') return line(rotate(seg.p0, b), rotate(seg.p1, b));
  return arc(rotate(seg.c, b), seg.r, seg.a0 + b, seg.sweep);
}

// Point, heading and curvature at arc length t into a segment.
export function segPoint(seg, t) {
  if (seg.kind === 'line') {
    const L = segLength(seg);
    const d = [(seg.p1[0] - seg.p0[0]) / L, (seg.p1[1] - seg.p0[1]) / L];
    return { p: [seg.p0[0] + d[0] * t, seg.p0[1] + d[1] * t], heading: Math.atan2(d[0], -d[1]), k: 0 };
  }
  const cw = seg.sweep > 0;
  const a = seg.a0 + (cw ? 1 : -1) * (t / seg.r);
  return { p: add(seg.c, scale(dir(a), seg.r)), heading: a + (cw ? 1 : -1) * Math.PI / 2, k: (cw ? -1 : 1) / seg.r };
}

export function segEnd(seg) {
  return segPoint(seg, segLength(seg)).p;
}

/**
 * Samples segments every SAMPLE_STEP metres of cumulative arc length. Sample positions depend only on the
 * segments before them, so two paths sharing a prefix of segments share those samples exactly.
 */
export function samplePath(segments) {
  const out = { x: [], z: [], s: [], heading: [], k: [], bearing: [], r: [], step: SAMPLE_STEP };
  const starts = [];
  let total = 0;
  for (const seg of segments) {
    starts.push(total);
    total += segLength(seg);
  }
  const n = Math.floor(total / SAMPLE_STEP);
  let si = 0;
  const push = (s) => {
    while (si < segments.length - 1 && s > starts[si] + segLength(segments[si])) si++;
    const q = segPoint(segments[si], Math.min(s - starts[si], segLength(segments[si])));
    out.x.push(q.p[0]);
    out.z.push(q.p[1]);
    out.s.push(s);
    out.heading.push(q.heading);
    out.k.push(q.k);
    out.r.push(len(q.p));
    const b = bearingOf(q.p[0], q.p[1]);
    const prev = out.bearing.length ? out.bearing[out.bearing.length - 1] : b;
    out.bearing.push(prev + wrapPi(b - prev));
  };
  for (let i = 0; i <= n; i++) push(i * SAMPLE_STEP);
  if (total - n * SAMPLE_STEP > 1e-6) push(total);
  out.length = total;
  out.segStarts = starts;
  return out;
}

export function indexAt(path, s) {
  const i = Math.floor(s / path.step);
  return Math.max(0, Math.min(path.x.length - 2, i));
}

// Linear interpolation of every per-sample field at arc length s (clamped to the path).
export function sampleAt(path, s) {
  const i = indexAt(path, s);
  const s0 = path.s[i];
  const s1 = path.s[i + 1];
  const f = Math.max(0, Math.min(1, (s - s0) / (s1 - s0)));
  const lerp = (arr) => arr[i] + (arr[i + 1] - arr[i]) * f;
  return {
    x: lerp(path.x),
    z: lerp(path.z),
    heading: path.heading[i] + wrapPi(path.heading[i + 1] - path.heading[i]) * f,
    k: f < 0.5 ? path.k[i] : path.k[i + 1],
    bearing: lerp(path.bearing),
    r: lerp(path.r),
  };
}

/**
 * First s >= fromS (and <= toS) at which the path's unwrapped bearing reaches the given compass bearing
 * (any multiple of 2PI). Bearing must be increasing over [fromS, toS]; null if not reached.
 */
export function sAtBearing(path, bearing, fromS, toS = path.length) {
  const i0 = indexAt(path, fromS);
  const i1 = indexAt(path, toS) + 1;
  const b0 = path.bearing[i0];
  const target = b0 + wrap2Pi(bearing - b0);
  if (target > path.bearing[i1]) return null;
  let lo = i0;
  let hi = i1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (path.bearing[mid] < target) lo = mid;
    else hi = mid;
  }
  const f = (target - path.bearing[lo]) / (path.bearing[hi] - path.bearing[lo] || 1);
  return path.s[lo] + (path.s[hi] - path.s[lo]) * Math.max(0, Math.min(1, f));
}

/**
 * Where an other path's vehicle comes close enough to the entering section of `entry` (its give-way line to
 * `entryEnd`) to touch a vehicle on it. Returns runs [{ sFrom, sTo, sEntryMin, sEntryMax }] along `other`:
 * sFrom/sTo bound the stretch of `other` inside the conflict area, sEntryMin/sEntryMax the nearest and farthest
 * points of `entry` it touches; pairs [[sOther, sEntryFirst, sEntryLast]] has one entry per `other` sample in the run, the
 * first and last `entry` arc lengths that sample conflicts with (a merge runs on alongside the ring, so a run's ends alone
 * are not enough).
 * Two paths conflict where centrelines are within `clearance` plus `reach * |sin(crossing angle)|`: a body
 * crossing at an angle sweeps its half-length sideways. Cached per path pair (geometry is immutable).
 */
const conflictCache = new WeakMap();
export function conflictRuns(entry, other, clearance, reach) {
  let byOther = conflictCache.get(entry);
  if (!byOther) conflictCache.set(entry, (byOther = new WeakMap()));
  const hit = byOther.get(other);
  if (hit && hit.clearance === clearance && hit.reach === reach) return hit.runs;

  const e0 = indexAt(entry, entry.marks.giveWay);
  const e1 = indexAt(entry, entry.marks.entryEnd) + 1;
  const o0 = indexAt(other, other.marks.giveWay);
  const o1 = indexAt(other, other.marks.exitRing) + 1;
  const far = (clearance + reach) ** 2;
  const runs = [];
  let open = null;
  for (let j = o0; j <= o1; j++) {
    let touchedMin = -1;
    let touchedMax = -1;
    for (let i = e0; i <= e1; i++) {
      const dx = other.x[j] - entry.x[i];
      const dz = other.z[j] - entry.z[i];
      const d2 = dx * dx + dz * dz;
      if (d2 >= far) continue;
      const c = clearance + reach * Math.abs(Math.sin(other.heading[j] - entry.heading[i]));
      if (d2 < c * c) {
        if (touchedMin < 0) touchedMin = i;
        touchedMax = i;
      }
    }
    if (touchedMax >= 0) {
      if (!open) open = { sFrom: other.s[j], sTo: other.s[j], sEntryMin: entry.s[touchedMin], sEntryMax: entry.s[touchedMax], pairs: [] };
      open.sTo = other.s[j];
      open.sEntryMin = Math.min(open.sEntryMin, entry.s[touchedMin]);
      open.pairs.push([other.s[j], entry.s[touchedMin], entry.s[touchedMax]]);
      open.sEntryMax = Math.max(open.sEntryMax, entry.s[touchedMax]);
    } else if (open) {
      runs.push(open);
      open = null;
    }
  }
  if (open) runs.push(open);
  byOther.set(other, { clearance, reach, runs });
  return runs;
}

// Four corners of a box centred at (x, z) facing heading, as [[x, z] x4].
export function corners(x, z, heading, length, width) {
  const f = dir(heading);
  const l = leftOf(heading);
  const hl = length / 2;
  const hw = width / 2;
  return [
    [x + f[0] * hl + l[0] * hw, z + f[1] * hl + l[1] * hw],
    [x + f[0] * hl - l[0] * hw, z + f[1] * hl - l[1] * hw],
    [x - f[0] * hl - l[0] * hw, z - f[1] * hl - l[1] * hw],
    [x - f[0] * hl + l[0] * hw, z - f[1] * hl + l[1] * hw],
  ];
}

// Separating-axis test for two convex quads.
export function quadsOverlap(a, b) {
  for (const poly of [a, b]) {
    for (let i = 0; i < 4; i++) {
      const p = poly[i];
      const q = poly[(i + 1) % 4];
      const axis = [q[1] - p[1], p[0] - q[0]];
      let aMin = Infinity, aMax = -Infinity, bMin = Infinity, bMax = -Infinity;
      for (const v of a) { const d = dot(v, axis); aMin = Math.min(aMin, d); aMax = Math.max(aMax, d); }
      for (const v of b) { const d = dot(v, axis); bMin = Math.min(bMin, d); bMax = Math.max(bMax, d); }
      if (aMax < bMin || bMax < aMin) return false;
    }
  }
  return true;
}
