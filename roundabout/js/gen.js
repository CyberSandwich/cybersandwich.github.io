/**
 * Roundabout generator: generate(tier, seed, overrides?) -> plain JSON-able layout. Pure, deterministic per (tier, seed).
 *
 * Frame and angles: see geom.js (x east, z south, y up, metres, compass bearings in radians, clockwise positive).
 * Centre of the roundabout is the origin. UK: drive on the LEFT, circulate CLOCKWISE seen from above, give way
 * to the RIGHT. Arms are listed in clockwise order; "next" arm = next clockwise.
 *
 * Lane indices count from the LEFT as the driver sees them: entry lane 0 is by the kerb, ring lane 0 is the
 * outer lane, exit lane 0 is by the kerb. Entry lane k feeds ring lane k.
 *
 * Geometry per entry lane: straight approach -> deflection arc (left) -> give-way point G -> fillet arc (left,
 * radius = entry radius) tangent to the ring lane at merge point M -> clockwise ring arc -> fillet arc (left,
 * radius = exit radius) leaving the ring at diverge point D -> straight exit. Entry angle is the angle between
 * the path at G and the ring tangent there (CD 116 range 20-60 deg). Flare is kerb-only: lane centrelines do
 * not shift along the flare.
 *
 * Layout (all lengths metres, angles radians):
 *   tier, seed, type ('mini'|'compact'|'normal'|'large'), icd, outerRadius, innerRadius, spiral
 *   circulatory { lanes, width, laneWidth, ratio, laneRadii[] }   island { kind, radius, diameter, feature, apron }
 *   arms[] { index, bearing, name, destination, limitMph, entryLanes, laneWidth, entryWidth, approachWidth,
 *     flareLength, exitLanes, exitLaneWidth, exitWidth, entryAngle, entryAngles[], entryRadius (kerb),
 *     entryPathRadius, exitRadius, splitter { kind, width, length, polygon }, kerbs { entryLeft, entryRight,
 *     exitLeft, exitRight } as [x, z] polylines, giveWay[lane] { x, z, heading }, giveWayS[lane],
 *     mergeBearing[ringLane], divergeBearing[ringLane], exits { [armIdx]: { exitNumber, direction, lane } },
 *     laneArrows[lane] (['left'|'ahead'|'right']), arrowsOverride, footprint, entrySegs, exitSegs }
 *   paths { id: Path }  one per legal movement; Path = geom.js Path + { id, arm, lane, exitArm, exitLane,
 *     ringLane, loops, exitNumber, direction, limits { approach, exit } (m/s),
 *     marks { giveWay, conflict, merge, entryEnd, diverge, exitRing, end } (arc lengths) }
 *   player { arm, exitArm, exitNumber, direction, lane, pathId, route { exitNumber, road, destination } }
 *   markings { giveWay[], laneLines[], arrows[], ringLines[], miniDisc }
 *   signs[] { arm, code ('map'|'510'|'611.1'|'602'), x, z, facing, side, map? { mini, exits[] } }
 *   scenery { trees[], hedges[], terraces[], buildings[], parkedCar, islandFeature }
 *
 * overrides (debug/QA): { arms, lanes, playerArm, targetArm, icd }
 * buildPath(layout, arm, lane, exitArm, loops) builds extra movement paths (the player's go-round-again variants);
 * paths with the same (arm, lane, exitArm) share their samples up to the earlier one's diverge point.
 */
import { createRng } from './rng.js';
import { entryConflicts } from './kinematics.js';
import {
  TAU, SAMPLE_STEP, dir, bearingOf, wrapPi, wrap2Pi, leftOf, mph, rotate, add, scale, len, dot,
  line, arc, segLength, segEnd, segPoint, rotateSeg, samplePath, pointInPolygon,
} from './geom.js';

const DEG = Math.PI / 180;
const APPROACH_LENGTH = 200; // long enough for the speed-limit, 510 and map signs ahead of the player's start
const EXIT_LENGTH = 80;
const KERB_REACH = 35; // radius beyond the ICD within which neighbouring arms' kerbs must not meet
const PAVEMENT = 1.5; // minimum kerb-to-kerb gap between neighbouring arms at the ICD, metres
const RING_MARGIN = 2; // minimum ring arc between one arm's merge and the next arm's diverge, metres

export const TIERS = {
  mini: {
    // CD 116 fixes only ICD <= 28 m and a 1-4 m disc. Typical residential minis (estimates): ICD ~14-20 m,
    // 6.5-7.3 m single carriageways, rarely a splitter (a short painted one at most), kerb radii ~4-8 m, and
    // none of the entry-angle and deflection design of a normal roundabout.
    type: 'mini', icd: [14, 28], icdSkew: 1.8, icdTail: { from: 22, chance: 0.1 }, arms: [3, 4], lanes: [1], limits: [20, 30], exitRadius: [3.5, 6.5],
    laneWidth: [3.25, 3.65], deflectRadius: [6, 10], entryAngle: null,
    splitter: { kind: 'painted', chance: 0.3, width: [0.4, 1.0], length: [3, 6] },
  },
  easy: {
    type: 'compact', icd: [28, 36], arms: [3, 4], lanes: [1], limits: [20, 30, 30], exitRadius: [10, 20],
    deflectRadius: [15, 30], splitter: { kind: 'raised', width: [1.5, 3.0], length: [10, 20] }, entryAngle: [20, 60],
  },
  medium: {
    type: 'normal', icd: [40, 60], arms: [4, 4], lanes: [2], limits: [30, 30, 40], exitRadius: [15, 35],
    deflectRadius: [15, 35], splitter: { kind: 'raised', width: [1.5, 3.0], length: [12, 25] }, entryAngle: [20, 60],
  },
  hard: {
    type: 'large', icd: [60, 90], arms: [4, 5], lanes: [2, 3], limits: [30, 40, 40], exitRadius: [20, 45],
    deflectRadius: [15, 35], splitter: { kind: 'raised', width: [2.0, 4.0], length: [15, 30] }, entryAngle: [20, 60],
  },
};

const STREETS = [
  'Bexley Road', 'Erith Road', 'Lower Road', 'Station Road', 'High Street', 'Church Lane', 'Victoria Road',
  'Mill Road', 'Park Avenue', 'London Road', 'Queens Road', 'Kings Road', 'Manor Road', 'Brook Street',
  'Northumberland Way', 'Bronze Age Way', 'Picardy Road', 'Abbey Road', 'Woolwich Road', 'Belvedere Road',
  'Crayford Way', 'Heath Road', 'Mayplace Road', 'Pier Road', 'Fraser Road', 'West Street', 'Nuxley Road',
  'Hill Road', 'Green Lane', 'Albert Road', 'Avenue Road', 'Bedonwell Road',
];
const DESTINATIONS = [
  'Erith', 'Belvedere', 'Bexleyheath', 'Crayford', 'Dartford', 'Abbey Wood', 'Thamesmead', 'Welling',
  'Slade Green', 'Woolwich', 'Sidcup', 'Barnehurst', 'Town Centre', 'Retail Park', 'Station', 'Hospital',
];

export const giveWayWidth = (limitMph) => (limitMph <= 40 ? 0.2 : 0.3);

export function directionOf(delta) {
  if (delta < 135 * DEG) return 'left';
  if (delta <= 225 * DEG) return 'ahead';
  return 'right';
}

// ---------- arm-local geometry (arm axis pointing north, bearing 0) ----------

const U = dir(0);
const L = dir(Math.PI / 2);
const H_IN = Math.PI;

/**
 * Approach + deflection for all entry lanes of an arm. Lane k runs k lane-widths right of the kerb lane on a
 * concentric deflection arc (radius Re + k*w), so lanes stay exactly one width apart and share one straight
 * give-way line, placed so its midpoint sits on the ICD circle.
 */
function deflection(off0, w, n, delta, Re, R) {
  const a0 = H_IN + Math.PI / 2;
  const radial = dir(a0 - delta);
  const tail = (rho) => add(add(scale(L, off0), scale(L, Re)), scale(radial, rho));
  const midTail = tail(Re + ((n - 1) * w) / 2);
  const ut = dot(U, midTail);
  const disc = ut * ut - dot(midTail, midTail) + R * R;
  if (disc < 0) return null;
  const aA = -ut + Math.sqrt(disc);
  const hG = H_IN - delta;
  const lanes = [];
  for (let k = 0; k < n; k++) {
    const A = add(scale(U, aA), scale(L, off0 - k * w));
    const segs = [line(add(A, scale(U, APPROACH_LENGTH)), A)];
    if (delta > 1e-6) segs.push(arc(add(scale(U, aA), scale(L, off0 + Re)), Re + k * w, a0, -delta));
    lanes.push({ segs, G: add(scale(U, aA), tail(Re + k * w)) });
  }
  const mid = add(scale(U, aA), midTail);
  const phi = wrapPi(hG - (bearingOf(mid[0], mid[1]) + Math.PI / 2));
  return { lanes, hG, phi };
}

// Left fillet from G (heading hG) tangent to the ring lane circle rc.
function entryFillet(G, hG, rc) {
  const n = leftOf(hG);
  const denom = rc - dot(G, n);
  if (denom <= 0.3) return null;
  const rho = (dot(G, G) - rc * rc) / (2 * denom);
  const Cf = add(G, scale(n, rho));
  const M = scale(Cf, rc / len(Cf));
  const a0 = hG + Math.PI / 2;
  const aM = bearingOf(M[0] - Cf[0], M[1] - Cf[1]);
  return { seg: arc(Cf, rho, a0, -wrap2Pi(a0 - aM)), M, rho };
}

// Left fillet from ring lane rc onto the exit lane at offset ox on the arm's exit side.
function exitFillet(rc, ox, rhoX) {
  if (rc <= ox) return null;
  const a = Math.sqrt((rc + rhoX) ** 2 - (ox + rhoX) ** 2);
  const C = add(scale(U, a), scale(L, -(ox + rhoX)));
  const D = scale(C, rc / len(C));
  const X = add(scale(U, a), scale(L, -ox));
  const aD = bearingOf(D[0] - C[0], D[1] - C[1]);
  const fillet = arc(C, rhoX, aD, -wrap2Pi(aD - Math.PI / 2));
  return { segs: [fillet, line(X, add(X, scale(U, EXIT_LENGTH)))], D, X };
}

function solveDelta(off0, w, n, Re, R, phiTarget) {
  let lo = 0;
  let hi = 45 * DEG;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    const d = deflection(off0, w, n, mid, Re, R);
    if (d && d.phi > phiTarget) lo = mid;
    else hi = mid;
  }
  return lo;
}

// Polyline of a segment chain offset sideways (positive = left of travel), between arc lengths from..to.
function offsetPolyline(segs, offset, from = 0, to = Infinity, step = 1) {
  const pts = [];
  let base = 0;
  for (const seg of segs) {
    const Ls = segLength(seg);
    const t0 = Math.max(0, from - base);
    const t1 = Math.min(Ls, to - base);
    // Counted steps plus the exact end: stepping a float up to t1 can land a hair short of it forever.
    const steps = t1 >= t0 ? Math.floor((t1 - t0) / step) : -1;
    for (let i = 0; i <= steps + 1 && steps >= 0; i++) {
      const q = segPoint(seg, i <= steps ? t0 + i * step : t1);
      const p = add(q.p, scale(leftOf(q.heading), offset));
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(p[0] - last[0], p[1] - last[1]) > 0.05) pts.push(p);
    }
    base += Ls;
  }
  return pts;
}

const chainLength = (segs) => segs.reduce((sum, s) => sum + segLength(s), 0);

// First point along a segment chain at or inside radius R: { s, p, heading }.
function firstInside(segs, R) {
  const total = chainLength(segs);
  // The first segment is the long straight approach: skip its far end, which is well outside the ICD.
  let s = Math.max(0, segLength(segs[0]) - (2 * R + 60));
  const step = 1;
  while (s < total && len(pointOnChain(segs, s).p) > R) s += step;
  let lo = Math.max(0, s - step);
  let hi = s;
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    if (len(pointOnChain(segs, mid).p) > R) lo = mid;
    else hi = mid;
  }
  const q = pointOnChain(segs, hi);
  return { s: hi, p: q.p, heading: q.heading };
}

// ---------- layout ----------

function pickArmParams(rng, tier, n, isSingle) {
  const t = TIERS[tier];
  const round2 = (x) => Math.round(x * 100) / 100;
  const laneWidth = t.laneWidth ? round2(rng.range(...t.laneWidth)) : isSingle ? 4.5 : round2(rng.range(3.0, 3.5));
  const exitLanes = isSingle ? 1 : (tier === 'hard' ? 2 : rng.int(1, 2));
  const exitLaneWidth = t.laneWidth ? laneWidth : exitLanes === 1 ? round2(rng.range(4.0, 4.5)) : 3.5;
  const approachLaneWidth = t.laneWidth ? laneWidth : isSingle ? 3.65 : Math.min(laneWidth, 3.0);
  const hasSplitter = t.splitter.chance === undefined || rng.chance(t.splitter.chance);
  return {
    limitMph: rng.pick(t.limits),
    entryLanes: n,
    laneWidth,
    entryWidth: laneWidth * n,
    approachWidth: approachLaneWidth * n,
    flareLength: approachLaneWidth * n < laneWidth * n - 0.01 ? Math.round(rng.range(5, 25)) : 0,
    exitLanes,
    exitLaneWidth,
    exitWidth: exitLaneWidth * exitLanes,
    splitter: hasSplitter
      ? { kind: t.splitter.kind, width: round2(rng.range(...t.splitter.width)), length: Math.round(rng.range(...t.splitter.length)) }
      : { kind: 'none', width: 0, length: 0 },
    deflectRadius: rng.range(...t.deflectRadius),
    exitRadius: rng.range(...t.exitRadius),
  };
}

// Builds one arm in local coordinates; null when the parameters cannot make valid geometry.
function buildArmLocal(rng, p, R, ringRadii, entryAngle) {
  const s2 = p.splitter.width / 2;
  const n = p.entryLanes;
  const w = p.laneWidth;
  const off0 = s2 + (n - 0.5) * w;
  const d0 = deflection(off0, w, n, 0, p.deflectRadius, R);
  const d1 = deflection(off0, w, n, 45 * DEG, p.deflectRadius, R);
  if (!d0 || !d1) return null;
  // Within ~8 deg of aiming tangent to the outer ring lane the fillet radius blows up. Minis have no
  // entry-angle design range (entryAngle null): any angle the geometry allows.
  const [angleLo, angleHi] = entryAngle ?? [0, 90];
  const phiLo = Math.max(angleLo * DEG, d1.phi, Math.acos(Math.min(1, ringRadii[0] / R)) + 8 * DEG);
  const phiHi = Math.min(angleHi * DEG, d0.phi);
  if (phiLo > phiHi) return null;

  // A left-turning fillet only reaches a ring lane if the entry heading aims inside it; flatter entries give
  // gentler paths, so start low and steepen until every lane's fillet exists.
  const entryFor = (phi) => {
    const d = deflection(off0, w, n, solveDelta(off0, w, n, p.deflectRadius, R, phi), p.deflectRadius, R);
    if (!d) return null;
    const out = [];
    for (let k = 0; k < n; k++) {
      const f = entryFillet(d.lanes[k].G, d.hG, ringRadii[k]);
      if (!f || f.rho > 80) return null;
      out.push({ segs: [...d.lanes[k].segs, f.seg], G: d.lanes[k].G, hG: d.hG, phi: d.phi, M: f.M, entryRadius: f.rho });
    }
    return out;
  };
  let entries = null;
  if (entryAngle) {
    const start = phiLo + (Math.min(phiHi, phiLo + 25 * DEG) - phiLo) * rng() ** 1.5;
    for (let phi = start; phi <= phiHi + 1e-9 && !entries; phi += 2 * DEG) entries = entryFor(phi);
  } else {
    // Minis: arms run nearly straight into the circle, so start at the least deflection and flatten from there.
    for (let phi = phiHi; phi >= phiLo - 1e-9 && !entries; phi -= 2 * DEG) entries = entryFor(phi);
  }
  if (!entries) return null;
  // Each lane gives way where it meets the ICD, so a waiting vehicle never pokes into the ring.
  for (const e of entries) e.stop = firstInside(e.segs, R);

  const exits = [];
  for (let c = 0; c < ringRadii.length; c++) {
    const x = Math.min(c, p.exitLanes - 1);
    const ox = s2 + (p.exitLanes - x - 0.5) * p.exitLaneWidth;
    const f = exitFillet(ringRadii[c], ox, p.exitRadius);
    if (!f) return null;
    exits.push({ segs: f.segs, D: f.D, exitLane: x });
  }

  // Kerbs: outer edges of the outermost lanes; the splitter-side edges stop at the ICD.
  const e0 = entries[0];
  const eN = entries[p.entryLanes - 1];
  const entryLeft = offsetPolyline(e0.segs, p.laneWidth / 2);
  const entryRight = offsetPolyline(eN.segs, -p.laneWidth / 2, 0, eN.stop.s);
  const x0 = exits[0];
  const xLast = exits[exits.findIndex((e) => e.exitLane === p.exitLanes - 1)];
  const exitLeft = offsetPolyline(x0.segs, p.exitLaneWidth / 2);
  const exitRight = offsetPolyline(xLast.segs, -p.exitLaneWidth / 2).filter((q) => len(q) >= R - 0.01);

  const within = (q) => len(q) <= R + KERB_REACH;
  const entryExtent = Math.max(...entryLeft.filter(within).map((q) => bearingOf(q[0], q[1])),
    ...entries.map((e) => bearingOf(e.M[0], e.M[1]) + RING_MARGIN / 2 / len(e.M)));
  const exitExtent = Math.max(...exitLeft.filter(within).map((q) => -bearingOf(q[0], q[1])),
    ...exits.map((e) => -bearingOf(e.D[0], e.D[1]) + RING_MARGIN / 2 / len(e.D)));

  return { entries, exits, kerbs: { entryLeft, entryRight, exitLeft, exitRight }, entryExtent, exitExtent };
}

function tryLayout(rng, tier, overrides) {
  const t = TIERS[tier];
  const icd = overrides.icd;
  const R = icd / 2;
  const nArms = overrides.arms;
  const nLanes = overrides.lanes ?? rng.pick(t.lanes);
  const isSingle = nLanes === 1;

  const params = [];
  for (let i = 0; i < nArms; i++) params.push(pickArmParams(rng, tier, nLanes, isSingle));
  const maxEntry = Math.max(...params.map((p) => p.entryWidth));
  const circRatio = rng.range(1.0, 1.2);
  const circWidth = circRatio * maxEntry;
  const ringLaneWidth = circWidth / nLanes;
  const ringRadii = [];
  for (let c = 0; c < nLanes; c++) ringRadii.push(R - (c + 0.5) * ringLaneWidth);
  const innerRadius = R - circWidth;
  if (innerRadius < 1) return null;

  const locals = [];
  for (const p of params) {
    const local = buildArmLocal(rng, p, R, ringRadii, t.entryAngle);
    if (!local) return null;
    locals.push(local);
  }

  // Clockwise spacing: each gap must fit this arm's entry side plus the next arm's exit side.
  const needs = locals.map((a, i) => a.entryExtent + locals[(i + 1) % nArms].exitExtent + PAVEMENT / R);
  const slack = TAU - needs.reduce((x, y) => x + y, 0);
  if (slack < 0.05) return null;
  const weights = needs.map(() => rng.range(0.3, 1));
  const wSum = weights.reduce((x, y) => x + y, 0);
  const bearings = [rng.range(0, TAU)];
  for (let i = 0; i < nArms - 1; i++) bearings.push(bearings[i] + needs[i] + (slack * weights[i]) / wSum);

  return { icd, R, nArms, nLanes, circRatio, circWidth, ringLaneWidth, ringRadii, innerRadius, params, locals, needs, bearings: bearings.map(wrap2Pi) };
}

function laneAssignment(rng, tier, arms, i, nLanes) {
  const out = {};
  const overrideAhead = nLanes > 1 && rng.chance(0.35);
  for (let step = 1; step < arms.length; step++) {
    const j = (i + step) % arms.length;
    const delta = wrap2Pi(arms[j].bearing - arms[i].bearing);
    const direction = directionOf(delta);
    let lane;
    if (nLanes === 1 || direction === 'left') lane = 0;
    else if (direction === 'right') lane = nLanes - 1;
    else if (nLanes === 3) lane = overrideAhead ? 0 : 1;
    else {
      const clockLane = delta <= Math.PI + 15 * DEG ? 0 : 1; // HC 186 clock rule: up to 12 o'clock -> left lane
      lane = overrideAhead ? 1 - clockLane : clockLane;
    }
    out[j] = { exitNumber: step, direction, lane, delta };
  }
  return { byExit: out, arrowsOverride: overrideAhead };
}

function arrowsForLanes(byExit, nLanes) {
  const lanes = [];
  for (let k = 0; k < nLanes; k++) {
    const dirs = new Set(Object.values(byExit).filter((e) => e.lane === k).map((e) => e.direction));
    lanes.push(['left', 'ahead', 'right'].filter((d) => dirs.has(d)));
  }
  return lanes;
}

// The habit being broken: "1st = left, 2nd = ahead, 3rd = right", whatever the roundabout looks like.
export const naiveDirection = (exitNumber) => ['left', 'ahead', 'right'][Math.min(exitNumber, 3) - 1];

function pickTarget(rng, arm, forced) {
  if (forced !== undefined) return forced;
  const options = Object.entries(arm.exits).map(([j, e]) => ({ j: Number(j), ...e }));
  const surprising = options.filter((o) => o.direction !== naiveDirection(o.exitNumber));
  return (surprising.length && rng.chance(0.6) ? rng.pick(surprising) : rng.pick(options)).j;
}

// Routes from the other arms that cross the player's path at its entry (entryConflicts, cut-outs included),
// leaving aside those that turn into the player's own road.
export function crossingRoutes(layout, arm, exitArm) {
  const me = layout.paths[pathId(arm, layout.arms[arm].exits[exitArm].lane, exitArm, 0)];
  return Object.values(layout.paths).filter((p) => p.arm !== arm && !p.loops && p.exitArm !== arm && entryConflicts(me, p).length).length;
}

// A drawn route that no other route crosses (a left turn into the outer lane while every other route keeps to
// the inner lane) leaves nothing to judge at the line, however heavy the traffic: the first route on that arm
// with crossing traffic replaces it, else the first on the next arm round. No random draw, so every other
// layout, and the scenery of this one, stays as it was.
function routeWithTraffic(layout, arm, target) {
  if (crossingRoutes(layout, arm, target) > 0) return [arm, target];
  const n = layout.arms.length;
  for (let k = 0; k < n; k++) {
    const a = (arm + k) % n;
    const exits = Object.entries(layout.arms[a].exits).sort(([, x], [, y]) => x.exitNumber - y.exitNumber);
    const found = exits.find(([j]) => crossingRoutes(layout, a, Number(j)) > 0);
    if (found) return [a, Number(found[0])];
  }
  return [arm, target];
}

// ICD in [icd0, icd1], skewed toward the small end; a tier with icdTail draws that fraction uniformly from the
// tail beyond `from`, so large minis stay rare without dragging the median up.
function pickIcd(rng, t) {
  const [lo, hi] = t.icd;
  const tail = t.icdTail;
  const inTail = tail && rng.chance(tail.chance);
  const v = inTail ? rng.range(tail.from, hi) : lo + ((tail ? tail.from : hi) - lo) * rng() ** (t.icdSkew ?? 1);
  return Math.round(v * 10) / 10;
}

export function generate(tier, seed, overrides = {}) {
  if (!TIERS[tier]) throw new Error('unknown tier ' + tier);
  const rng = createRng(seed + '|' + tier);
  const t = TIERS[tier];
  // ICD and arm count are drawn once, then kept if any geometry fits: retrying with fresh ICDs would favour
  // the large ones that fit most easily. Only if nothing fits does the arm count drop, then the ICD grow.
  let raw = null;
  const wanted = overrides.arms ?? rng.int(...t.arms);
  const icd0 = overrides.icd ?? pickIcd(rng, t);
  for (let icd = icd0; !raw && icd <= Math.max(icd0, t.icd[1]); icd = Math.round((icd + 1) * 10) / 10) {
    for (let arms = wanted; !raw && arms >= (overrides.arms ?? t.arms[0]); arms--) {
      for (let attempt = 0; attempt < 100 && !raw; attempt++) raw = tryLayout(rng, tier, { ...overrides, arms, icd });
    }
  }
  if (!raw) throw new Error('no valid layout for ' + tier + ' seed ' + seed);

  const names = rng.shuffle(STREETS);
  const dests = rng.shuffle(DESTINATIONS);
  const arms = raw.params.map((p, i) => {
    const b = raw.bearings[i];
    const local = raw.locals[i];
    const rot = (q) => rotate(q, b);
    return {
      index: i,
      bearing: b,
      name: names[i],
      destination: dests[i],
      limitMph: p.limitMph,
      entryLanes: p.entryLanes,
      laneWidth: p.laneWidth,
      entryWidth: p.entryWidth,
      approachWidth: p.approachWidth,
      flareLength: p.flareLength,
      exitLanes: p.exitLanes,
      exitLaneWidth: p.exitLaneWidth,
      exitWidth: p.exitWidth,
      entryAngle: local.entries[0].phi,
      entryAngles: local.entries.map((e) => e.phi),
      entryRadius: p.deflectRadius,
      entryPathRadius: Math.min(...local.entries.map((e) => e.entryRadius)),
      exitRadius: p.exitRadius,
      splitter: { ...p.splitter, polygon: p.splitter.kind === 'none' ? [] : splitterPolygon(p.splitter, raw.R).map(rot) },
      footprint: { entryExtent: local.entryExtent, exitExtent: local.exitExtent },
      kerbs: Object.fromEntries(Object.entries(local.kerbs).map(([k, pts]) => [k, pts.map(rot)])),
      entrySegs: local.entries.map((e) => e.segs.map((s) => rotateSeg(s, b))),
      exitSegs: local.exits.map((e) => e.segs.map((s) => rotateSeg(s, b))),
      exitLaneOfRing: local.exits.map((e) => e.exitLane),
      giveWayS: local.entries.map((e) => e.stop.s),
      // Per-lane give-way point: where the lane meets the ICD, and the heading there.
      giveWay: local.entries.map((e) => {
        const G = rot(e.stop.p);
        return { x: G[0], z: G[1], heading: e.stop.heading + b };
      }),
      mergeBearing: local.entries.map((e) => wrap2Pi(bearingOf(...e.M) + b)),
      divergeBearing: local.exits.map((e) => wrap2Pi(bearingOf(...e.D) + b)),
    };
  });

  for (const arm of arms) {
    const a = laneAssignment(rng, tier, arms, arm.index, raw.nLanes);
    arm.exits = a.byExit;
    arm.arrowsOverride = a.arrowsOverride;
    arm.laneArrows = arrowsForLanes(a.byExit, raw.nLanes);
  }

  const layout = {
    tier,
    seed,
    type: t.type,
    icd: raw.icd,
    outerRadius: raw.R,
    innerRadius: raw.innerRadius,
    circulatory: { lanes: raw.nLanes, width: raw.circWidth, laneWidth: raw.ringLaneWidth, ratio: raw.circRatio, laneRadii: raw.ringRadii },
    island: islandOf(rng, tier, raw),
    spiral: tier === 'hard',
    arms,
    paths: {},
  };

  for (const arm of arms) {
    for (const j of Object.keys(arm.exits).map(Number)) {
      const p = buildPath(layout, arm.index, arm.exits[j].lane, j, 0);
      layout.paths[p.id] = p;
    }
  }

  const drawnArm = overrides.playerArm ?? rng.int(0, arms.length - 1);
  const drawnTarget = pickTarget(rng, arms[drawnArm], overrides.targetArm);
  const forced = overrides.playerArm !== undefined || overrides.targetArm !== undefined;
  const [playerArm, targetArm] = forced ? [drawnArm, drawnTarget] : routeWithTraffic(layout, drawnArm, drawnTarget);
  const ex = arms[playerArm].exits[targetArm];
  layout.player = {
    arm: playerArm,
    exitArm: targetArm,
    exitNumber: ex.exitNumber,
    direction: ex.direction,
    lane: ex.lane,
    pathId: pathId(playerArm, ex.lane, targetArm, 0),
    // First exit: signal left on approach and keep it on (HC 186), so there is no Exit decision to make.
    route: { exitNumber: ex.exitNumber, road: arms[targetArm].name, destination: arms[targetArm].destination, exitDecision: ex.exitNumber !== 1 },
  };

  layout.markings = markingsOf(layout);
  layout.signs = signsOf(layout);
  layout.scenery = sceneryOf(rng, layout);
  return layout;
}

export const pathId = (arm, lane, exitArm, loops) => `${arm}:${lane}:${exitArm}:${loops}`;

/** Movement path: approach lane `lane` of `armIdx`, round the ring (plus `loops` full turns), out at `exitArm`. */
export function buildPath(layout, armIdx, lane, exitArm, loops = 0) {
  const arm = layout.arms[armIdx];
  const out = layout.arms[exitArm];
  const ringLane = lane;
  const rc = layout.circulatory.laneRadii[ringLane];
  const entry = arm.entrySegs[lane];
  const M = segEnd(entry[entry.length - 1]);
  const exit = out.exitSegs[ringLane];
  const fillet = exit[0];
  const D = segPoint(fillet, 0).p;
  const bM = bearingOf(M[0], M[1]);
  const sweep = wrap2Pi(bearingOf(D[0], D[1]) - bM) + loops * TAU;
  const ringSeg = arc([0, 0], rc, bM, sweep);
  const segs = [...entry, ringSeg, ...exit];
  const path = samplePath(segs);

  const giveWay = arm.giveWayS[lane];
  const merge = chainLength(entry);
  const diverge = merge + segLength(ringSeg);
  let exitRing = path.length;
  for (let i = Math.floor(diverge / SAMPLE_STEP); i < path.r.length; i++) {
    if (path.r[i] >= layout.outerRadius) { exitRing = path.s[i]; break; }
  }
  // First reach of the outer ring lane's centreline (an outer-lane entry only touches it at the merge).
  let conflict = merge;
  for (let i = Math.floor(giveWay / SAMPLE_STEP); path.s[i] < merge; i++) {
    if (path.r[i] <= layout.circulatory.laneRadii[0]) { conflict = path.s[i]; break; }
  }
  const info = arm.exits[exitArm];
  return {
    id: pathId(armIdx, lane, exitArm, loops),
    arm: armIdx,
    lane,
    exitArm,
    exitLane: out.exitLaneOfRing[ringLane],
    ringLane,
    loops,
    exitNumber: info.exitNumber,
    direction: info.direction,
    limits: { approach: mph(arm.limitMph), exit: mph(out.limitMph) },
    marks: { giveWay, conflict, merge, entryEnd: merge + 12, diverge, exitRing, end: path.length },
    ...path,
  };
}

function splitterPolygon(sp, R) {
  const w = sp.width / 2;
  const nose = R + 0.6;
  return [
    [0, -nose],
    [w * 0.5, -(nose + 1.5)],
    [w, -(nose + 4)],
    [w * 0.7, -(nose + sp.length)],
    [-w * 0.7, -(nose + sp.length)],
    [-w, -(nose + 4)],
    [-w * 0.5, -(nose + 1.5)],
  ];
}

function islandOf(rng, tier, raw) {
  if (tier === 'mini') {
    // Domed white disc (1003.4), 1-4 m across; scales with the junction (estimate: ~12-20% of the ICD).
    const diameter = Math.min(4, 2 * raw.innerRadius, Math.max(1, raw.icd * rng.range(0.12, 0.2)));
    return { kind: 'painted', radius: diameter / 2, diameter, feature: 'none', apron: 0 };
  }
  const apron = tier === 'easy' ? rng.range(1, 2) : 0;
  const feature = { easy: 'planting', medium: 'statue', hard: 'clockTower' }[tier];
  return { kind: 'raised', radius: raw.innerRadius, diameter: raw.innerRadius * 2, feature, apron };
}

function markingsOf(layout) {
  const mini = layout.type === 'mini';
  const giveWay = layout.arms.map((arm) => ({
    arm: arm.index,
    diagram: mini ? '1003.3' : '1003.1',
    width: giveWayWidth(arm.limitMph),
  }));
  const laneLines = [];
  const arrows = [];
  for (const arm of layout.arms) {
    for (let k = 0; k < arm.entryLanes; k++) {
      const segs = arm.entrySegs[k];
      const gw = arm.giveWayS[k];
      if (k < arm.entryLanes - 1) laneLines.push({ arm: arm.index, kind: 'entry', points: offsetPolyline(segs, -arm.laneWidth / 2, 0, gw - 0.5) });
      for (const back of [15, 45]) {
        const q = pointOnChain(segs, gw - back);
        arrows.push({ arm: arm.index, lane: k, x: q.p[0], z: q.p[1], heading: q.heading, arrows: arm.laneArrows[k] });
      }
    }
    for (let x = 0; x < arm.exitLanes - 1; x++) {
      const c = arm.exitLaneOfRing.indexOf(x);
      laneLines.push({ arm: arm.index, kind: 'exit', points: offsetPolyline(arm.exitSegs[c], -arm.exitLaneWidth / 2, segLength(arm.exitSegs[c][0])) });
    }
  }
  const ringLines = [];
  for (let c = 1; c < layout.circulatory.lanes; c++) ringLines.push({ radius: layout.outerRadius - c * layout.circulatory.laneWidth, dashed: true });
  return {
    giveWay,
    laneLines,
    arrows,
    ringLines,
    miniDisc: mini ? { diagram: '1003.4', radius: layout.island.radius } : null,
  };
}

function pointOnChain(segs, s) {
  let base = 0;
  for (const seg of segs) {
    const Ls = segLength(seg);
    if (s <= base + Ls) return segPoint(seg, Math.max(0, s - base));
    base += Ls;
  }
  const last = segs[segs.length - 1];
  return segPoint(last, segLength(last));
}

// Nearest point on a polyline: { d, q }.
export function nearestOnPolyline(poly, p) {
  let best = { d: Infinity, q: null };
  for (let i = 0; i + 1 < poly.length; i++) {
    const a = poly[i];
    const ab = [poly[i + 1][0] - a[0], poly[i + 1][1] - a[1]];
    const l2 = dot(ab, ab);
    const t = l2 > 0 ? Math.max(0, Math.min(1, dot([p[0] - a[0], p[1] - a[1]], ab) / l2)) : 0;
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
    if (d < best.d) best = { d, q };
  }
  return best;
}

// An arm's carriageway outline: the outer entry kerb in, the outer exit kerb out (the splitter lies inside).
export const carriagewayOutline = (arm) => [...arm.kerbs.entryLeft, ...arm.kerbs.exitLeft];

const POST_CLEAR = 0.3; // a sign post stands at least this far from any carriageway edge

// Metres before the give-way line, by approach limit: the 510 warning ~100 m out at 30 mph, the map sign
// 50-80 m, the limit roundel beyond both (estimates scaled for 20 and 40 mph).
export const SIGN_DISTANCES = {
  20: { limit: 110, 510: 70, map: 50 },
  30: { limit: 140, 510: 100, map: 65 },
  40: { limit: 165, 510: 120, map: 80 },
};

function signsOf(layout) {
  const R = layout.outerRadius;
  const mini = layout.type === 'mini';
  const signs = [];
  const outlines = layout.arms.flatMap((a) => [a.kerbs.entryLeft, a.kerbs.exitLeft]);
  const roads = layout.arms.map(carriagewayOutline);
  const clear = (p) => len(p) >= R + POST_CLEAR && !roads.some((poly) => pointInPolygon(p, poly))
    && outlines.every((k) => nearestOnPolyline(k, p).d >= POST_CLEAR);
  for (const arm of layout.arms) {
    const gwAxial = -dot(rotate([arm.giveWay[0].x, arm.giveWay[0].z], -arm.bearing), [0, 1]);
    // Nearside sign `distance` m before the give-way line on the kerb lane: stands `offsets[0]` m beyond the
    // real kerb polyline, nudged by the alternatives where a neighbouring arm's kerb is too close.
    const at = (distance, code, offsets) => {
      const q = pointOnChain(arm.entrySegs[0], arm.giveWayS[0] - distance);
      const kerb = nearestOnPolyline(arm.kerbs.entryLeft, add(q.p, scale(leftOf(q.heading), arm.laneWidth / 2))).q;
      const outward = scale([kerb[0] - q.p[0], kerb[1] - q.p[1]], 1 / Math.hypot(kerb[0] - q.p[0], kerb[1] - q.p[1]));
      const spots = offsets.map((o) => add(kerb, scale(outward, o)));
      const p = spots.find(clear) ?? spots[0];
      return { arm: arm.index, code, x: p[0], z: p[1], facing: arm.bearing, side: 'left', distance };
    };
    const d = SIGN_DISTANCES[arm.limitMph];
    const limit = at(d.limit, 'limit', [0.8, 0.6, 1.0]);
    limit.mph = arm.limitMph;
    limit.diagram = '670';
    // The map sign is wide: its nearer post sits 0.75 m inboard of the centre.
    const map = at(d.map, 'map', [1.7, 1.5, 2.0]);
    map.map = {
      mini,
      exits: Object.entries(arm.exits).map(([j, e]) => ({
        arm: Number(j),
        exitNumber: e.exitNumber,
        name: layout.arms[j].name,
        destination: layout.arms[j].destination,
        relBearing: wrapPi(layout.arms[j].bearing - (arm.bearing + Math.PI)),
      })),
    };
    signs.push(limit, at(d[510], '510', [0.8, 0.6, 1.0]), map, at(1.5, mini ? '611.1' : '602', [0.8, 0.6, 1.0]));
    // Offside repeater on the raised splitter, on its axis a few metres past the nose.
    if (arm.splitter.kind === 'raised') {
      const axial = R + 0.6 + 3;
      const p = rotate(scale(U, axial), arm.bearing);
      signs.push({ arm: arm.index, code: '602', x: p[0], z: p[1], facing: arm.bearing, side: 'right', distance: axial - gwAxial });
    }
  }
  return signs;
}

// Distance-from-road test in each arm's local frame; the ring plus each arm's carriageway with a margin.
function clearOfRoad(layout, p, margin) {
  const R = layout.outerRadius;
  if (len(p) < R + margin) return false;
  for (const arm of layout.arms) {
    const q = rotate(p, -arm.bearing);
    const axial = -q[1];
    const lateral = q[0];
    if (axial <= 0) continue;
    const entryMax = Math.max(...arm.kerbs.entryLeft.map((k) => rotate(k, -arm.bearing)[0]));
    const exitMax = arm.splitter.width / 2 + arm.exitWidth;
    if (lateral < entryMax + margin && lateral > -exitMax - margin) return false;
  }
  return true;
}

function sceneryOf(rng, layout) {
  const tier = layout.tier;
  const R = layout.outerRadius;
  const counts = {
    mini: { trees: [0, 3], hedges: [4, 8], terraces: [0, 0], buildings: [0, 0] },
    easy: { trees: [4, 8], hedges: [0, 2], terraces: [0, 0], buildings: [0, 0] },
    medium: { trees: [10, 20], hedges: [0, 2], terraces: [2, 4], buildings: [0, 0] },
    hard: { trees: [25, 40], hedges: [0, 0], terraces: [0, 2], buildings: [4, 8] },
  }[tier];
  const placed = [];
  const free = (p, gap) => placed.every((q) => Math.hypot(p[0] - q[0], p[1] - q[1]) > gap);
  const sample = (minR, maxR, margin, gap) => {
    for (let i = 0; i < 60; i++) {
      const b = rng.range(0, TAU);
      const p = scale(dir(b), rng.range(R + minR, R + maxR));
      if (clearOfRoad(layout, p, margin) && free(p, gap)) { placed.push(p); return p; }
    }
    return null;
  };

  const trees = [];
  for (let i = rng.int(...counts.trees); i > 0; i--) {
    const p = sample(6, 70, 4, 4);
    if (p) trees.push({ x: p[0], z: p[1], height: rng.range(6, 12), radius: rng.range(2, 4) });
  }
  const buildings = [];
  for (let i = rng.int(...counts.buildings); i > 0; i--) {
    const p = sample(20, 80, 15, 18);
    if (p) buildings.push({ x: p[0], z: p[1], w: rng.range(12, 25), d: rng.range(10, 20), h: rng.range(10, 25), heading: bearingOf(-p[0], -p[1]) });
  }

  // Hedges and terraces run alongside arms, on the verge beyond the kerb.
  const alongArm = (arm, side, lateralExtra, axial0, length) => {
    const lat = side > 0
      ? Math.max(...arm.kerbs.entryLeft.map((k) => rotate(k, -arm.bearing)[0])) + lateralExtra
      : -(arm.splitter.width / 2 + arm.exitWidth + lateralExtra);
    const a = rotate(add(scale(U, axial0), scale(L, lat)), arm.bearing);
    const b = rotate(add(scale(U, axial0 + length), scale(L, lat)), arm.bearing);
    return { a, b };
  };
  const hedges = [];
  for (let i = rng.int(...counts.hedges); i > 0; i--) {
    const arm = rng.pick(layout.arms);
    const seg = alongArm(arm, rng.pick([-1, 1]), 2.5, R + rng.range(4, 15), rng.range(10, 40));
    hedges.push({ ...seg, height: rng.range(1.4, 2.2), thickness: 1 });
  }
  const terraces = [];
  for (let i = rng.int(...counts.terraces); i > 0; i--) {
    const arm = rng.pick(layout.arms);
    const length = rng.range(30, 60);
    const seg = alongArm(arm, rng.pick([-1, 1]), 10, R + rng.range(15, 30), length);
    terraces.push({ ...seg, houses: Math.round(length / 5.5), depth: 8, height: rng.range(7, 9) });
  }

  let parkedCar = null;
  if (tier === 'mini') {
    // On the verge of the arm to the player's right: it hides cars coming from there.
    const right = layout.arms[(layout.player.arm - 1 + layout.arms.length) % layout.arms.length];
    const lat = Math.max(...right.kerbs.entryLeft.map((k) => rotate(k, -right.bearing)[0])) + 1.2;
    const p = rotate(add(scale(U, R + rng.range(8, 16)), scale(L, lat)), right.bearing);
    parkedCar = { x: p[0], z: p[1], heading: wrap2Pi(right.bearing + Math.PI), type: 'hatch', arm: right.index };
  }

  return { trees, hedges, terraces, buildings, parkedCar, islandFeature: layout.island.feature };
}
