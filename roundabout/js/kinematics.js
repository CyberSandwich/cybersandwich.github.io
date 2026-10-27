/**
 * Kinematics shared by sim, player and judge: curvature speed profiles, clearing-time prediction, and the
 * conflict assessment for a vehicle entering the ring. Assessment always uses each vehicle's TRUE path, never
 * its signal: the judge compares that truth with the cue the player saw.
 */
import { conflictRuns, indexAt, mph, sampleAt, wrapPi } from './geom.js';

const COMFORT_DECEL = 1.5; // m/s^2, used to slow ahead of bends
export const RING_CAP = mph(30);
const CONFLICT_CLEARANCE = 2.6; // m between parallel path centrelines that counts as a conflict
const CONFLICT_REACH = 3.0; // m of extra sweep for a body crossing at right angles (half a van)
// Long vehicles sweep further, so reach grows to half the longer vehicle. Cached per path pair and reach:
// conflictRuns keeps one reach per pair, and pairs of vehicles of different lengths on the same two paths
// would recompute it on every call.
const runsCache = new WeakMap();
export function entryConflicts(entryPath, otherPath, longest = 0) {
  const reach = Math.max(CONFLICT_REACH, longest / 2);
  let byOther = runsCache.get(entryPath);
  if (!byOther) runsCache.set(entryPath, (byOther = new WeakMap()));
  let byReach = byOther.get(otherPath);
  if (!byReach) byOther.set(otherPath, (byReach = new Map()));
  let runs = byReach.get(reach);
  if (!runs) byReach.set(reach, (runs = conflictRuns(entryPath, otherPath, CONFLICT_CLEARANCE, reach)));
  return runs;
}
export const BRAKE_LIMIT = 1.0; // m/s^2 a circulating driver should never be made to exceed
export const CLEAR_MARGIN = 0.5; // s after the entrant's rear clears before the other may arrive
export const SIGNAL_FROM = 60; // m before the line where approach signals start (AI and player)
export const CREEP_DISTANCE = 16; // m before the line where the player creeps and the Go window opens
export const PLAYER_ACCEL = 2.4; // m/s^2 the player's car pulling away (estimate: a brisk automatic Polo)

const profileCache = new WeakMap();

/**
 * Allowed speed per sample: posted limit on the straights, sqrt(aLat / |k|) on curves, capped on the ring,
 * then a backward pass so the vehicle can brake into every bend at COMFORT_DECEL.
 */
export function speedProfile(path, latComfort) {
  const key = Math.round(latComfort * 10);
  let byKey = profileCache.get(path);
  if (!byKey) profileCache.set(path, (byKey = new Map()));
  if (byKey.has(key)) return byKey.get(key);
  const { marks, limits } = path;
  const n = path.s.length;
  const v = new Array(n);
  for (let i = 0; i < n; i++) {
    const s = path.s[i];
    const cap = s < marks.giveWay ? limits.approach : s > marks.exitRing ? limits.exit : Math.min(RING_CAP, limits.approach);
    const k = Math.abs(path.k[i]);
    v[i] = k > 1e-6 ? Math.min(cap, Math.sqrt((key / 10) / k)) : cap;
  }
  for (let i = n - 2; i >= 0; i--) {
    const ds = path.s[i + 1] - path.s[i];
    v[i] = Math.min(v[i], Math.sqrt(v[i + 1] * v[i + 1] + 2 * COMFORT_DECEL * ds));
  }
  byKey.set(key, v);
  return v;
}

/**
 * Centre arc length at which a vehicle waits at the give-way line. Paths cross the ICD at an angle, so the
 * front corner on the ring side reaches the ring before the front centre does: hold back by that overhang,
 * plus STOP_MARGIN, which also keeps a waiting nose clear of a bus or lorry whose ends swing out on the ring.
 */
const STOP_MARGIN = 0.8;
export function stopPoint(path, length, width) {
  const q = sampleAt(path, path.marks.giveWay);
  const phi = Math.abs(wrapPi(q.heading - (q.bearing + Math.PI / 2)));
  const overhang = ((width / 2) * Math.abs(Math.cos(phi))) / Math.max(0.3, Math.sin(phi));
  return path.marks.giveWay - overhang - STOP_MARGIN - length / 2;
}

export const allowedAt = (path, profile, s) => profile[indexAt(path, s)];

/** Seconds until a vehicle at (s, v) accelerating at up to aMax along its profile reaches sTarget. */
export function timeToReach(path, profile, s, v, aMax, sTarget, horizon = 20) {
  const dt = 0.05;
  let t = 0;
  while (s < sTarget && t < horizon) {
    const vMax = allowedAt(path, profile, s);
    const a = Math.max(-COMFORT_DECEL, Math.min(aMax, (vMax - v) / 0.5));
    v = Math.max(0, v + a * dt);
    s += v * dt;
    t += dt;
  }
  return t;
}

/** Least constant deceleration that keeps a vehicle at speed v from covering more than d metres in T seconds. */
export function requiredDecel(v, d, T) {
  if (d <= 0) return Infinity;
  if (v * T <= d) return 0;
  if (v * T <= 2 * d) return (2 * (v * T - d)) / (T * T);
  return (v * v) / (2 * d);
}

/**
 * For an entrant about to use its entry section, every other vehicle whose true path crosses it.
 * entrant: { path, s, v, length, accelMax, latComfort }; others: { path, s, v, length }.
 * Returns [{ other, run, inZone, distance, eta, needDecel, tClear }], soonest first (run: the entryConflicts
 * run). By default only each vehicle's next pass; allRuns: one result per remaining pass (the judge: a vehicle
 * passing in front may cross the entry again).
 * eta uses max(v, minSpeed) so a vehicle crawling now is not treated as never arriving. With cruise, a
 * vehicle still picking up speed is assumed to reach CRUISE_SHARE of its bend speed at the conflict, for
 * both eta and needDecel (AI caution; the judge uses speeds as they are).
 */
const CRUISE_SHARE = 0.9;
const CRUISE_LAT = 3.0; // m/s^2 when a vehicle's own comfort is unknown

export function assessEntry(entrant, others, { minSpeed = 0, startDelay = 0, cruise = false, allRuns = false } = {}) {
  const profile = speedProfile(entrant.path, entrant.latComfort);
  const out = [];
  for (const o of others) {
    // A vehicle sharing this approach lane is queued with the entrant: car-following handles it. One beside
    // it on the same approach that has not crossed its line yet is no circulating traffic either (counting it
    // deadlocks two lanes waiting on each other).
    if (o.path.arm === entrant.path.arm) {
      if (o.path.lane === entrant.path.lane && o.s < o.path.marks.entryEnd) continue;
      if (o.s + o.length / 2 < o.path.marks.giveWay) continue;
    }
    for (const run of entryConflicts(entrant.path, o.path, Math.max(entrant.length, o.length))) {
      const front = o.s + o.length / 2;
      const rear = o.s - o.length / 2;
      if (rear > run.sTo) continue;
      const tClear = startDelay + timeToReach(entrant.path, profile, entrant.s, entrant.v, entrant.accelMax, run.sEntryMax + entrant.length / 2);
      if (front >= run.sFrom) {
        out.push({ other: o, run, inZone: true, distance: 0, eta: 0, needDecel: Infinity, tClear });
      } else {
        const distance = run.sFrom - front;
        const lat = o.latComfort ?? o.params?.latComfort ?? CRUISE_LAT;
        const v = cruise ? Math.max(o.v, CRUISE_SHARE * allowedAt(o.path, speedProfile(o.path, lat), run.sFrom)) : o.v;
        const eta = distance / Math.max(v, minSpeed, 0.1);
        out.push({ other: o, run, inZone: false, distance, eta, needDecel: requiredDecel(v, distance, tClear + CLEAR_MARGIN), tClear });
      }
      if (!allRuns) break;
    }
  }
  return out.sort((a, b) => a.eta - b.eta);
}
