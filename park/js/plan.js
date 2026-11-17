/**
 * Bay-parking geometry: presets, the full-lock sweep, the turn point and its line cue. Pure: no three.js, no DOM.
 * It shows where full lock goes; it is not a method. The car always approaches along +x (lot.js frame).
 *
 * A sweep is full lock toward the bay (in the mode's direction) until the car is square to the bay, then straight
 * until the body is centred in the bay's length. Along a straight approach (h = 0) the sweep only translates with
 * the start x, so the turn point is solved exactly from one sweep, with no search.
 */
import { POLO, BODY, step, corners, wheels, toWorld, centrePos, curvature } from './polo.js';

export const MODES = ['reverse', 'forward'];
export const SIDES = ['left', 'right'];
export const LANES = ['left', 'centre', 'right'];
/** Clearance from the aisle edge to the body for a left or right lane start (an estimate of normal practice). */
export const LANE_CLEARANCE = 0.6;
/** Distance from the bay's centre to the start pose, back along the aisle (about 2 car lengths). */
export const START_BACK = 2 * POLO.length;
export const HEADING_TOL = 3 * Math.PI / 180;
/** Within this along-aisle distance of the turn point the cue reads Lock Now. */
export const LOCK_NOW = 0.15;

const DS = 0.05;
const MAX_LEN = 24;
const sideSign = (side) => (side === 'right' ? -1 : 1);
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

/** Lane offset y for a lane name. */
export function laneY(lot, lane) {
  const off = lot.aisle / 2 - LANE_CLEARANCE - BODY.HALF_W;
  return lane === 'left' ? off : lane === 'right' ? -off : 0;
}

/** The manoeuvre's constants: steer, direction of travel, target heading, row side. */
export function goal(cfg) {
  const s = sideSign(cfg.side);
  const fwd = cfg.mode === 'forward';
  return { s, steer: s, dir: fwd ? 1 : -1, targetH: s * (fwd ? 1 : -1) * Math.PI / 2 };
}

/** Start pose for a preset: in the chosen lane, heading along the aisle, START_BACK before the bay's centre. */
export function preset(lot, cfg) {
  return { x: lot.bayX(cfg.bay) - START_BACK, y: laneY(lot, cfg.lane), h: 0 };
}

/**
 * Poses along a sweep from pose: steer at full lock in direction dir until heading targetH, then straight until the
 * body centre reaches depthY. Returns { poses, lockEnd, overshoot } where overshoot > 0 means the lock alone carried the
 * centre past depthY (no single sweep lands centred). When the lock turns away from targetH the sweep is the lock
 * arc alone, MAX_LEN long.
 */
export function sweep(pose, { steer, dir, targetH, depthY }) {
  const poses = [pose];
  const add = (p, len, st = steer) => {
    for (let d = DS; d < len; d += DS) poses.push(step(p, st, dir * d));
    const end = step(p, st, dir * len);
    poses.push(end);
    return end;
  };
  const k = curvature(steer);
  const rate = Math.sign(k) * dir; // sign of dh per metre travelled
  const remaining = wrap(targetH - pose.h);
  if (k === 0 || (Math.abs(remaining) > 1e-9 && Math.sign(remaining) !== rate)) {
    const end = add(pose, MAX_LEN);
    return { poses, lockEnd: end, overshoot: Infinity, turnedAway: true };
  }
  // Exact lock length to land on targetH: |dh| = |kappa| * len.
  const lockLen = Math.min(MAX_LEN, Math.abs(remaining) / Math.abs(k));
  const lockEnd = lockLen > 0 ? add(pose, lockLen) : pose;
  const sq = { ...lockEnd, h: targetH };
  const cy = centrePos(sq)[1];
  const along = dir * Math.sin(targetH); // dy of the centre per metre of travel
  const straight = (depthY - cy) / along;
  if (straight < 0) return { poses, lockEnd: sq, overshoot: -straight };
  add(sq, Math.min(straight, MAX_LEN), 0);
  return { poses, lockEnd: sq, overshoot: 0 };
}

/** The sweep the scene traces from the car's current pose, toward the chosen bay. */
export function traceFrom(lot, cfg, pose) {
  const g = goal(cfg);
  return sweep(pose, { ...g, depthY: lot.rowCentreY(g.s) });
}

/**
 * Where a parked pose stands against bay i of row s: wheel overlap past each line (m, > 0 = a tyre over it),
 * the heading error and ok. ok needs every tyre inside the lines and heading within HEADING_TOL.
 */
export function inBay(lot, s, i, pose, faceIn) {
  const [xa, ya, xb, yb] = lot.bayRect(s, i);
  const tw = POLO.tyreHalfWidth;
  const over = { near: 0, far: 0, entry: 0, back: 0 };
  for (const [wx, wy] of wheels(pose)) {
    // Tyres are tw wide each side across the car; once square in the bay, across the car is along x.
    over.near = Math.max(over.near, xa - (wx - tw));
    over.far = Math.max(over.far, (wx + tw) - xb);
    const yIn = s > 0 ? wy - ya : yb - wy; // depth from the aisle edge
    const yBack = s > 0 ? yb - wy : wy - ya;
    over.entry = Math.max(over.entry, -yIn);
    over.back = Math.max(over.back, -yBack);
  }
  const want = faceIn === undefined ? null : s * (faceIn ? 1 : -1) * Math.PI / 2;
  const headingErr = want === null
    ? Math.min(Math.abs(wrap(pose.h - Math.PI / 2)), Math.abs(wrap(pose.h + Math.PI / 2)))
    : Math.abs(wrap(pose.h - want));
  const ok = over.near <= 0 && over.far <= 0 && over.entry <= 0 && over.back <= 0 && headingErr < HEADING_TOL;
  return { ok, over, headingErr };
}

/** The part of a convex loop with s * y >= s * edge (Sutherland-Hodgman against one line). */
function clipRow(loop, s, edge) {
  const out = [];
  const inside = (p) => s * (p[1] - edge) >= 0;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length];
    if (inside(a)) out.push(a);
    if (inside(a) !== inside(b)) {
      const t = (edge - a[1]) / (b[1] - a[1]);
      out.push([a[0] + t * (b[0] - a[0]), edge]);
    }
  }
  return out;
}

/**
 * Deepest excursions of the body (m) during a sweep: past the opposite row's aisle edge, past the target row's back
 * line, and into the target row's neighbouring bays (past the centre of bay b's near or far line). On test the other
 * bays count as occupied, so each is a cue, not a failure of the geometry.
 */
function excursions(lot, s, b, poses) {
  let opposite = 0, back = 0, neighbour = 0;
  const oppEdge = lot.edgeY(-s), backEdge = lot.backY(s) - s * lot.lineW / 2;
  const near = lot.lineX(b), far = lot.lineX(b + 1);
  for (const p of poses) {
    const loop = corners(p);
    for (const [, y] of loop) {
      opposite = Math.max(opposite, -s * (y - oppEdge));
      back = Math.max(back, s * (y - backEdge));
    }
    for (const [x] of clipRow(loop, s, lot.edgeY(s))) neighbour = Math.max(neighbour, x - far, near - x);
  }
  return { opposite, back, neighbour };
}

const ORD = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th'];
const ord = (n) => ORD[n] || `${n}th`;

/** Name of line i relative to bay b (travelling along +x). */
export function lineName(b, i) {
  if (i === b) return "Your Bay's Near Line";
  if (i === b + 1) return "Your Bay's Far Line";
  return i > b + 1 ? `the ${ord(i - b - 1)} Line Past Your Bay` : `the ${ord(b - i)} Line Before Your Bay`;
}

/** The nearest painted line of the row to plane x, and the signed offset (> 0 = past it along +x). */
export function cueAt(lot, b, x) {
  let best = 0;
  for (let i = 1; i <= lot.nBays; i++) if (Math.abs(x - lot.lineX(i)) < Math.abs(x - lot.lineX(best))) best = i;
  const off = x - lot.lineX(best);
  return { line: best, off, name: lineName(b, best) };
}

/** "Mirror 0.4 m Past the 2nd Line Past Your Bay", "Shoulder Level With Your Bay's Far Line". */
export function cueText(who, cue) {
  const m = Math.abs(cue.off);
  if (m < LOCK_NOW) return `${who} Level With ${cue.name}`;
  const d = `${m.toFixed(1)} m`;
  return `${who} ${d} ${cue.off > 0 ? 'Past' : 'Short of'} ${cue.name}`;
}

/**
 * The turn point for a straight approach at lane offset y0: the x where full lock should start so the sweep ends
 * centred in bay cfg.bay. Returns { ok, reason, start, end, poses, cue: { shoulder, mirror }, opposite, neighbour, check }.
 * reason is 'noSingleSweep' when the lock alone carries the car past the bay's centre (a shuffle would be needed).
 */
export function turnPoint(lot, cfg, y0 = laneY(lot, cfg.lane)) {
  const g = goal(cfg);
  const depthY = lot.rowCentreY(g.s);
  const probe = sweep({ x: 0, y: y0, h: 0 }, { ...g, depthY });
  const endProbe = probe.poses[probe.poses.length - 1];
  const dx = lot.bayX(cfg.bay) - centrePos(endProbe)[0];
  const shift = (p) => ({ ...p, x: p.x + dx });
  const poses = probe.poses.map(shift);
  const start = poses[0], end = poses[poses.length - 1];
  const check = inBay(lot, g.s, cfg.bay, end, cfg.mode === 'forward');
  const ex = excursions(lot, g.s, cfg.bay, poses);
  const ok = probe.overshoot === 0 && check.ok && ex.back <= 0;
  const reason = ok ? null : probe.overshoot > 0 || ex.back > 0 ? 'noSingleSweep' : 'outsideLines';
  const mirrorX = toWorld(start, BODY.FRONT - POLO.mirrorBack, 0)[0];
  const shoulderX = toWorld(start, BODY.FRONT - POLO.shoulderBack, 0)[0];
  return {
    ok, reason, start, end, poses, check, opposite: ex.opposite, neighbour: ex.neighbour,
    cue: { mirror: cueAt(lot, cfg.bay, mirrorX), shoulder: cueAt(lot, cfg.bay, shoulderX) },
  };
}

/**
 * The live cue for the car's pose: while it is still square to the aisle, how far it is from the turn point for its
 * own lane offset. { state: 'ahead' | 'now' | 'past' | 'noSweep' | 'turning', dist, tp }.
 */
export function liveCue(lot, cfg, pose) {
  if (Math.abs(wrap(pose.h)) > 5 * Math.PI / 180) return { state: 'turning' };
  const tp = turnPoint(lot, cfg, pose.y);
  if (!tp.ok) return { state: 'noSweep', tp };
  // Rear-axle x along the aisle: the turn point is ahead while dist > 0 (both modes approach along +x first).
  const dist = tp.start.x - pose.x;
  return { state: Math.abs(dist) < LOCK_NOW ? 'now' : dist > 0 ? 'ahead' : 'past', dist, tp };
}
