/**
 * Traffic simulation. Pure and deterministic for a given (layout, seed): no clocks, no DOM.
 *
 *   const sim = createSim(layout, { seed?, traffic = true, warmup = 45, player = true })
 *   sim.step(dt)              fixed step (60 Hz intended); advances every vehicle
 *   sim.t                     simulated seconds since creation (warm-up excluded)
 *   sim.snapshot()            { t, vehicles: [VehicleView] } plain data for rendering / interpolation
 *   sim.replay()              snapshots of the last 5 s, oldest first (30 Hz)
 *   sim.state()               { t, layout, playerId, vehicles: [VehicleState] } for judge.js
 *   sim.player                the player's VehicleState (null when player = false)
 *   sim.setPlayerControl({ accel, indicator })   player.js drives the player car through this
 *   sim.commitPlayer()        player has pressed Go: AI now treats it as entering
 *   sim.setPlayerLoops(n)     swap to the go-round-again path (shares samples up to the old diverge point)
 *   sim.leaderOf(id)          { id, gap, speed } nearest vehicle ahead, or { gap: Infinity }
 *   sim.allowedSpeed(id)      curvature/limit speed for the vehicle at its current position
 *   sim.debug                 { inject(spec), scenario(name), setTraffic(on), clearTraffic() }, see bottom
 *
 * VehicleView: { id, type, colour, colourHex, length, width, height, x, y, z, heading, speed, accel, steer,
 *   indicator: 'left'|'right'|null, lamp (indicator bulb lit now), brake, intent, signalBehaviour, isPlayer,
 *   pathId, s }. heading is a compass bearing (geom.js); steer is the front-wheel angle in radians, > 0 = left.
 * intent: { exitArm, exitNumber, direction }: the TRUE plan; the indicator follows signalBehaviour.
 *
 * Car-following is IDM. Leaders are found geometrically, so vehicles on different paths that share the
 * ring (or an approach or exit lane) see each other: on the ring by angle and radial overlap, on straights by
 * projection onto the arm axis. AI entry uses gap acceptance on true paths (kinematics.assessEntry).
 */
import { createRng } from './rng.js';
import { dir, wrapPi, sampleAt, sAtBearing, corners, bearingOf, indexAt } from './geom.js';
import { buildPath, pathId } from './gen.js';
import {
  speedProfile, allowedAt, assessEntry, entryConflicts, timeToReach, stopPoint, BRAKE_LIMIT,
} from './kinematics.js';
import {
  VEHICLE_TYPES, LARGE_TYPES, COLOURS, colourFor, CRITICAL_GAP, FOLLOW_UP, DRIVER_TYPES, signalMix, TRAFFIC, INDICATOR_HZ,
} from './traffic-data.js';

export const PLAYER_ID = 0;
const HISTORY_SECONDS = 5;
const HISTORY_EVERY = 2; // steps; 30 Hz at a 60 Hz step
const MAX_DECEL = 8;
const IDM_B = 2.0;
const DECISION_ZONE = 20; // metres before the line where an AI driver starts judging the gap
const LOCK_DECEL = 3; // once stopping would need more than this, a committed driver no longer reconsiders
const SIGNAL_FROM = 60; // metres before the line where approach signals start
// s an AI driver wants between clearing a conflict and the circulating car arriving: crossing a car's
// path makes its driver ease off well before the bodies meet.
const AI_CLEAR_MARGIN = 1.5;
const GO_ROUND_DECEL = 2.5; // m/s^2: an AI driver who would need more than this to yield before its exit goes round
const STEER_LAG = 0.25; // s, steering follows path curvature with this time constant
// Vehicles more crossed than this are not car-following pairs (an exit and the entry beside it cross at ~100 deg);
// crossing conflicts are settled by gap acceptance instead.
const MAX_HEADING_DIFF = (75 * Math.PI) / 180;

export function createSim(layout, opts = {}) {
  const { seed = layout.seed, traffic = true, warmup = 45, player = true } = opts;
  const rng = createRng(`${seed}|${layout.tier}|sim`);
  const cfg = TRAFFIC[layout.tier];
  const mix = signalMix(layout.honesty);
  const driverWeights = Object.fromEntries(Object.entries(DRIVER_TYPES).map(([k, d]) => [k, d.weight]));
  const vehicles = [];
  const history = [];
  const lastEntry = new Map();
  const signalLeftAt = new Map();
  const extraPaths = new Map();
  let nextId = 1;
  let steps = 0;
  let clock = 0;
  let trafficOn = traffic;
  const expDelay = () => -Math.log(1 - rng()) / cfg.rate;
  const nextSpawn = layout.arms.map(() => expDelay() * rng());
  let nextBus = cfg.busEvery ? rng.range(...cfg.busEvery) * 0.25 : Infinity;

  // ---------- vehicles ----------

  function makeVehicle({ path, type, colour, signalBehaviour, driver, s, v, isPlayer = false }) {
    const dims = VEHICLE_TYPES[type];
    const d = DRIVER_TYPES[driver];
    const vehicle = {
      id: isPlayer ? PLAYER_ID : nextId++,
      type,
      colour,
      ...dims,
      driver,
      signalBehaviour,
      isPlayer,
      path,
      s,
      v,
      a: 0,
      steer: 0,
      committed: false,
      locked: false,
      enteredAt: null,
      external: null,
      holdUntil: -Infinity,
      signalPhase: rng(),
      params: {
        T: d.T * rng.range(0.9, 1.1),
        s0: d.s0,
        a: dims.accel * d.accelScale * rng.range(0.9, 1.1),
        b: IDM_B,
        speedScale: d.speedScale * rng.range(0.95, 1.05),
        latComfort: Math.round(dims.latComfort * rng.range(0.9, 1.1) * 10) / 10,
        tc: Math.max(CRITICAL_GAP.min, rng.normal(CRITICAL_GAP.mean + d.gapShift, CRITICAL_GAP.sd)),
        tf: Math.max(FOLLOW_UP.min, rng.normal(FOLLOW_UP.mean + d.gapShift / 2, FOLLOW_UP.sd)),
      },
      geo: null,
      stopS: stopPoint(path, dims.length, dims.width),
    };
    vehicle.steer = steerTarget(vehicle);
    return vehicle;
  }

  const intentOf = (path) => ({ exitArm: path.exitArm, exitNumber: path.exitNumber, direction: path.direction });
  const profileOf = (v) => speedProfile(v.path, v.params.latComfort);
  const allowed = (v) => allowedAt(v.path, profileOf(v), v.s + 1) * (v.isPlayer ? 1 : v.params.speedScale);

  function steerTarget(v) {
    const k = sampleAt(v.path, v.s + v.wheelbase / 2).k;
    return Math.atan(v.wheelbase * k);
  }

  function spawnClear(arm, lane, length) {
    return vehicles.every((w) => !(w.path.arm === arm && w.path.lane === lane && w.s - w.length / 2 < length + 15));
  }

  // Entry speed that can still stop behind the last queued vehicle in that lane.
  function safeSpawnSpeed(path, length, vMax) {
    let nearest = Infinity;
    for (const w of vehicles) {
      if (w.path.arm === path.arm && w.path.lane === path.lane && w.s < w.path.marks.merge) nearest = Math.min(nearest, w.s - w.length / 2);
    }
    const room = nearest - length / 2 - 8;
    return Math.min(vMax, Math.sqrt(Math.max(0, 2 * 1.5 * room)));
  }

  function spawn(armIdx, typeOverride) {
    const arm = layout.arms[armIdx];
    const exitArm = Number(rng.pick(Object.keys(arm.exits)));
    const lane = arm.exits[exitArm].lane;
    const path = layout.paths[pathId(armIdx, lane, exitArm, 0)];
    const type = typeOverride ?? rng.weighted(cfg.types);
    if (!spawnClear(armIdx, lane, VEHICLE_TYPES[type].length)) return false;
    const v = makeVehicle({
      path, type, colour: colourFor(rng, type), signalBehaviour: rng.weighted(mix), driver: rng.weighted(driverWeights),
      s: VEHICLE_TYPES[type].length / 2, v: 0,
    });
    v.v = safeSpawnSpeed(path, v.length, allowed(v) * 0.9);
    vehicles.push(v);
    return true;
  }

  function spawnDue() {
    if (!trafficOn) return;
    layout.arms.forEach((arm, i) => {
      if (clock < nextSpawn[i]) return;
      nextSpawn[i] = clock + (spawn(i) ? expDelay() : 1);
    });
    if (clock >= nextBus) {
      const ok = spawn(rng.int(0, layout.arms.length - 1), 'bus');
      nextBus = clock + (ok ? rng.range(...cfg.busEvery) : 1);
    }
  }

  // ---------- geometry cache per step ----------

  function updateGeo(v) {
    const q = sampleAt(v.path, v.s);
    const m = v.path.marks;
    const box = corners(q.x, q.z, q.heading, v.length, v.width);
    const cb = box.map((c) => bearingOf(c[0], c[1]));
    const cr = box.map((c) => Math.hypot(c[0], c[1]));
    v.geo = {
      x: q.x, z: q.z, heading: q.heading, bearing: bearingOf(q.x, q.z), r: q.r, box, cb,
      rMin: Math.min(...cr), rMax: Math.max(...cr),
      approach: v.s <= m.merge,
      ring: v.s + v.length / 2 >= m.giveWay && v.s - v.length / 2 <= m.exitRing,
      exit: v.s + v.length / 2 >= m.diverge,
    };
  }

  function linearExtents(box, f, l) {
    let fMin = Infinity, fMax = -Infinity, lMin = Infinity, lMax = -Infinity;
    for (const c of box) {
      const a = c[0] * f[0] + c[1] * f[1];
      const b = c[0] * l[0] + c[1] * l[1];
      fMin = Math.min(fMin, a); fMax = Math.max(fMax, a); lMin = Math.min(lMin, b); lMax = Math.max(lMax, b);
    }
    return { fMin, fMax, lMin, lMax };
  }

  // Lateral clearance below which two vehicles count as sharing a lane. A bus or HGV sweeps wider on bends,
  // so nobody runs alongside one (HC 187).
  const sideMargin = (v, w) => (LARGE_TYPES.has(v.type) || LARGE_TYPES.has(w.type) ? 1.2 : 0.3);

  // Bodies overlapping lengthways are side by side in neighbouring lanes (the margins above are wider than
  // real contact), not one ahead of the other.
  const aheadOnly = (gap) => (gap < 0 ? Infinity : gap);

  // Gap along an arm-aligned frame (f forward, l lateral), or Infinity if w is not ahead within `m` sideways.
  function linearGap(v, w, f, l, m = sideMargin(v, w)) {
    const ev = linearExtents(v.geo.box, f, l);
    const ew = linearExtents(w.geo.box, f, l);
    if ((ew.fMin + ew.fMax) / 2 <= (ev.fMin + ev.fMax) / 2) return Infinity;
    if (ev.lMin > ew.lMax + m || ew.lMin > ev.lMax + m) return Infinity;
    return aheadOnly(ew.fMin - ev.fMax);
  }

  // Whether w's body (its centreline, padded by both half-widths) reaches v's own path within `ahead` metres:
  // a car turning off sees nothing beyond its exit.
  function onPathAhead(v, w, ahead) {
    const p = v.path;
    const reach = v.width / 2 + w.width / 2 + 0.3;
    const f = dir(w.geo.heading);
    const hl = w.length / 2;
    const ax = w.geo.x - f[0] * hl;
    const az = w.geo.z - f[1] * hl;
    const i0 = Math.floor(v.s / p.step);
    const i1 = Math.min(p.x.length - 1, Math.ceil((v.s + ahead) / p.step));
    for (let i = i0; i <= i1; i += 2) {
      const t = Math.max(0, Math.min(2 * hl, (p.x[i] - ax) * f[0] + (p.z[i] - az) * f[1]));
      if (Math.hypot(p.x[i] - ax - f[0] * t, p.z[i] - az - f[1] * t) < reach) return true;
    }
    return false;
  }

  function ringGap(v, w) {
    const rel = wrapPi(w.geo.bearing - v.geo.bearing);
    if (rel <= 0 || rel > Math.PI / 2) return Infinity;
    const m = sideMargin(v, w);
    if (v.geo.rMin > w.geo.rMax + m || w.geo.rMin > v.geo.rMax + m) return Infinity;
    if (!onPathAhead(v, w, rel * v.geo.r + w.length)) return Infinity;
    const vMax = Math.max(...v.geo.cb.map((b) => wrapPi(b - v.geo.bearing)));
    const wMin = Math.min(...w.geo.cb.map((b) => wrapPi(b - v.geo.bearing)));
    return aheadOnly(v.geo.r * (wMin - vMax));
  }

  function leaderOf(v) {
    let best = { id: null, gap: Infinity, speed: 0 };
    const armV = layout.arms[v.path.arm].bearing;
    const exitV = layout.arms[v.path.exitArm].bearing;
    for (const w of vehicles) {
      if (w === v) continue;
      const dh = wrapPi(w.geo.heading - v.geo.heading);
      if (Math.abs(dh) > MAX_HEADING_DIFF) continue;
      const large = LARGE_TYPES.has(v.type) || LARGE_TYPES.has(w.type);
      let gap = Infinity;
      // Same approach lane: shared entry geometry, so arc lengths compare directly. Adjacent lanes only
      // interact when a long vehicle sweeps across the lane line.
      if (v.geo.approach && w.geo.approach && w.path.arm === v.path.arm) {
        if (w.path.lane === v.path.lane) {
          if (w.s > v.s) gap = w.s - v.s - (v.length + w.length) / 2;
        } else if (large) {
          gap = linearGap(v, w, dir(armV + Math.PI), dir(armV + Math.PI / 2));
        }
      }
      if (v.geo.exit && w.geo.exit && w.path.exitArm === v.path.exitArm && (large || w.path.exitLane === v.path.exitLane)) {
        const f = dir(exitV);
        gap = Math.min(gap, w.path.exitLane === v.path.exitLane
          ? linearGap(v, w, f, dir(exitV + Math.PI / 2), Infinity)
          : linearGap(v, w, f, dir(exitV + Math.PI / 2)));
      }
      if (v.geo.ring && w.geo.ring) gap = Math.min(gap, ringGap(v, w));
      if (gap < best.gap) best = { id: w.id, gap, speed: Math.max(0, w.v * Math.cos(dh)) };
    }
    return best;
  }

  // ---------- AI decisions ----------

  function idm(v, v0, gap, vLead, p, s0 = p.s0) {
    const free = 1 - Math.pow(v / Math.max(v0, 0.5), 4);
    if (gap === Infinity) return p.a * free;
    const sStar = s0 + Math.max(0, v * p.T + (v * (v - vLead)) / (2 * Math.sqrt(p.a * p.b)));
    return p.a * (free - (sStar / Math.max(gap, 0.05)) ** 2);
  }

  const asEntrant = (v) => ({ path: v.path, s: v.s, v: v.v, length: v.length, accelMax: v.params.a, latComfort: v.params.latComfort });

  // Vehicles that are on the ring or committed to joining it; waiting vehicles will give way themselves.
  const activeOthers = (v) => vehicles.filter((w) => w !== v && (w.geo.ring || w.committed));

  function canEnter(v) {
    const tMe = Math.max(0, v.stopS - v.s) / Math.max(v.v, 2);
    const key = v.path.arm + ':' + v.path.lane;
    const followUp = clock - (lastEntry.get(key) ?? -Infinity) < v.params.tf + 1.5;
    const needGap = followUp ? v.params.tf : v.params.tc;
    for (const c of assessEntry(asEntrant(v), activeOthers(v), { minSpeed: 4 })) {
      if (c.inZone || c.eta < tMe + needGap || c.eta < c.tClear + AI_CLEAR_MARGIN || c.needDecel > BRAKE_LIMIT * 0.8) return false;
    }
    return true;
  }

  // Only the front vehicle of a lane queue judges the gap; the rest follow it.
  const queuedBehind = (v) => vehicles.some((w) =>
    w !== v && w.path.arm === v.path.arm && w.path.lane === v.path.lane && w.s > v.s && w.s < w.path.marks.merge);

  function decideEntry(v) {
    const toStop = v.stopS - v.s;
    if (toStop < -0.2) {
      if (v.enteredAt === null) {
        v.enteredAt = clock;
        v.committed = v.locked = true;
        lastEntry.set(v.path.arm + ':' + v.path.lane, clock);
      }
      return;
    }
    if (v.locked || v.isPlayer || toStop > DECISION_ZONE) return;
    v.committed = !queuedBehind(v) && canEnter(v);
    if (v.committed && toStop <= Math.max(1, (v.v * v.v) / (2 * LOCK_DECEL))) v.locked = true;
  }

  // An inner-lane vehicle about to cut across outer lanes waits for anything alongside on its left; if it
  // cannot stop comfortably before its exit it goes round again instead (never swerve).
  function crossingYield(v) {
    const m = v.path.marks;
    if (v.path.ringLane === 0 || v.s >= m.diverge || v.s < m.diverge - 30) return Infinity;
    let a = Infinity;
    for (const w of vehicles) {
      // A vehicle already following this one is held back by it; waiting for it would deadlock.
      if (w === v || !w.geo.ring || w.geo.r < v.geo.r + 1.5 || w.leaderId === v.id) continue;
      const off = v.geo.r * wrapPi(w.geo.bearing - v.geo.bearing);
      const reach = (v.length + w.length) / 2 + 1;
      if (off >= reach || off < -(reach + 4 + w.v)) continue;
      if (off > 0) {
        a = Math.min(a, idm(v.v, allowed(v), off - (v.length + w.length) / 2, w.v, v.params));
      } else if ((v.v * v.v) / (2 * Math.max(0.1, m.diverge - v.s)) > GO_ROUND_DECEL) {
        goRound(v);
        return Infinity;
      } else {
        a = Math.min(a, idm(v.v, allowed(v), Math.max(0.05, m.diverge - v.s), 0, v.params, 0.5));
      }
    }
    return a;
  }

  function goRound(v) {
    const p = v.path;
    v.path = pathFor(p.arm, p.lane, p.exitArm, p.loops + 1);
  }

  function aiAccel(v) {
    if (clock < v.holdUntil) return -MAX_DECEL;
    const lead = leaderOf(v);
    v.leaderId = lead.id;
    let a = idm(v.v, allowed(v), lead.gap, lead.speed, v.params);
    if (!v.committed && v.s < v.stopS + 0.5) {
      a = Math.min(a, idm(v.v, allowed(v), v.stopS - v.s, 0, v.params, 0.05));
    }
    a = Math.min(a, crossingYield(v));
    return Math.max(-MAX_DECEL, Math.min(v.params.a, a));
  }

  // ---------- signals ----------

  // Arc length at which an honest driver switches to a left signal: after passing the exit before theirs.
  function signalLeftPoint(path) {
    if (signalLeftAt.has(path.id)) return signalLeftAt.get(path.id);
    const n = layout.arms.length;
    const prev = (path.exitArm - 1 + n) % n;
    let s = -Infinity;
    if (prev !== path.arm || path.loops > 0) {
      const b = layout.arms[prev].divergeBearing[path.ringLane];
      const found = sAtBearing(path, b, path.marks.merge, path.marks.diverge);
      s = found === null ? -Infinity : found;
    }
    signalLeftAt.set(path.id, s);
    return s;
  }

  function indicatorFor(v) {
    if (v.isPlayer) return v.external?.indicator ?? null;
    const m = v.path.marks;
    const s = v.s;
    if (v.signalBehaviour === 'leftNotCancelled') return 'left';
    if (s < m.giveWay - SIGNAL_FROM || s > m.exitRing + 15) return null;
    const direction = v.path.direction;
    const afterPrev = s >= signalLeftPoint(v.path);
    switch (v.signalBehaviour) {
      case 'none': return null;
      case 'wrongLeft': return 'left';
      case 'lateLeft':
        if (s >= m.diverge - 3) return 'left';
        return direction === 'right' && !afterPrev ? 'right' : null;
      default:
        if (direction === 'left' || afterPrev) return 'left';
        return direction === 'right' ? 'right' : null;
    }
  }

  const lampOn = (v) => Math.floor((clock + v.signalPhase) * INDICATOR_HZ * 2) % 2 === 0;

  // ---------- step ----------

  function step(dt) {
    clock += dt;
    spawnDue();
    for (const v of vehicles) updateGeo(v);
    for (const v of vehicles) decideEntry(v);
    for (const v of vehicles) {
      if (v.isPlayer) {
        const lead = leaderOf(v);
        v.leaderId = lead.id;
        v.lead = lead;
        v.a = v.external?.accel ?? 0;
      } else {
        v.a = aiAccel(v);
      }
    }
    for (const v of vehicles) {
      const vNew = Math.max(0, v.v + v.a * dt);
      v.s += ((v.v + vNew) / 2) * dt;
      if (vNew === 0 && v.a < 0) v.a = 0;
      v.v = vNew;
      v.steer += (steerTarget(v) - v.steer) * Math.min(1, dt / STEER_LAG);
    }
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const v = vehicles[i];
      if (!v.isPlayer && v.s >= v.path.length - v.length / 2 - 1) vehicles.splice(i, 1);
    }
    for (const v of vehicles) updateGeo(v);
    steps++;
    if (steps % HISTORY_EVERY === 0) {
      history.push(snapshot());
      const keep = Math.round(HISTORY_SECONDS / (dt * HISTORY_EVERY));
      while (history.length > keep) history.shift();
    }
  }

  function view(v) {
    const g = v.geo;
    const indicator = indicatorFor(v);
    return {
      id: v.id, type: v.type, colour: v.colour, colourHex: COLOURS[v.colour] ?? '#888888',
      length: v.length, width: v.width, height: v.height,
      x: g.x, y: 0, z: g.z, heading: g.heading, speed: v.v, accel: v.a, steer: v.steer,
      indicator, lamp: indicator !== null && lampOn(v), brake: v.a < -0.4 || (v.v < 0.3 && v.a <= 0.05),
      intent: intentOf(v.path), signalBehaviour: v.signalBehaviour, isPlayer: v.isPlayer, pathId: v.path.id, s: v.s,
    };
  }

  function snapshot() {
    return { t: clock, vehicles: vehicles.map(view) };
  }

  function stateOf(v) {
    const indicator = indicatorFor(v);
    return {
      ...view(v),
      path: v.path, v: v.v, a: v.a, accelMax: v.params.a, latComfort: v.params.latComfort,
      committed: v.committed, entered: v.enteredAt !== null, enteredAt: v.enteredAt, stopS: v.stopS, inRing: v.geo.ring, bearing: v.geo.bearing, r: v.geo.r,
      indicator, leaderId: v.leaderId ?? null,
    };
  }

  // ---------- player ----------

  let playerVehicle = null;
  function insertPlayer() {
    const pl = layout.player;
    const path = layout.paths[pl.pathId];
    const s = Math.max(VEHICLE_TYPES.hatch.length / 2, path.marks.giveWay - 90);
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const w = vehicles[i];
      if (w.path.arm === pl.arm && w.s < w.path.marks.giveWay && Math.abs(w.s - s) < 30) vehicles.splice(i, 1);
    }
    playerVehicle = makeVehicle({ path, type: 'hatch', colour: 'White', signalBehaviour: 'correct', driver: 'normal', s, v: 0, isPlayer: true });
    playerVehicle.v = safeSpawnSpeed(path, playerVehicle.length, path.limits.approach);
    playerVehicle.external = { accel: 0, indicator: null };
    vehicles.push(playerVehicle);
    updateGeo(playerVehicle);
  }

  function pathFor(arm, lane, exitArm, loops) {
    const id = pathId(arm, lane, exitArm, loops);
    if (layout.paths[id]) return layout.paths[id];
    if (!extraPaths.has(id)) extraPaths.set(id, buildPath(layout, arm, lane, exitArm, loops));
    return extraPaths.get(id);
  }

  // ---------- debug ----------

  // Every movement from the other arms in any lane, arrows or not: a lane-discipline breaker is a real hazard,
  // and on two-lane rings only such a car may cross an outer-lane entry.
  function otherPaths() {
    const out = [];
    for (const arm of layout.arms) {
      if (arm.index === layout.player.arm) continue;
      for (let lane = 0; lane < arm.entryLanes; lane++) {
        for (const exitArm of Object.keys(arm.exits).map(Number)) out.push(pathFor(arm.index, lane, exitArm, 0));
      }
    }
    return out;
  }

  // Adds a committed vehicle at arc length s with speed v, clearing AI on the same path nearby.
  function placeAt(spec, path, s, speed) {
    const type = spec.type ?? 'hatch';
    const v = makeVehicle({
      path, type, colour: spec.colour ?? colourFor(rng, type), signalBehaviour: spec.signalBehaviour ?? 'correct',
      driver: spec.driver ?? 'normal', s, v: speed,
    });
    v.params.speedScale = 1;
    v.committed = v.locked = true;
    if (s > v.stopS) v.enteredAt = clock;
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const w = vehicles[i];
      if (!w.isPlayer && w.path === path && Math.abs(w.s - s) < 30) vehicles.splice(i, 1);
    }
    vehicles.push(v);
    updateGeo(v);
    return v;
  }

  // Places a vehicle on `path` so its front reaches arc length sTarget in `seconds`, driving its own profile.
  function placeToArrive(spec, path, sTarget, seconds) {
    const length = VEHICLE_TYPES[spec.type ?? 'hatch'].length;
    const prof = speedProfile(path, VEHICLE_TYPES[spec.type ?? 'hatch'].latComfort);
    const accel = VEHICLE_TYPES[spec.type ?? 'hatch'].accel;
    let lo = length / 2;
    let hi = sTarget - length / 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const t = timeToReach(path, prof, mid, allowedAt(path, prof, mid), accel, sTarget - length / 2, 60);
      if (t > seconds) lo = mid;
      else hi = mid;
    }
    return placeAt(spec, path, lo, allowedAt(path, prof, lo));
  }

  function playerTimeToLine() {
    const p = playerVehicle;
    return Math.max(0, p.stopS - p.s) / Math.max(p.v, 2);
  }

  // Paths that truly pass through the player's entry, most upstream arm first (longest run-up).
  function conflictingPaths(filter = () => true) {
    const pp = playerVehicle.path;
    const n = layout.arms.length;
    return otherPaths()
      .filter((p) => entryConflicts(pp, p).length && filter(p))
      .sort((a, b) => ((layout.player.arm - b.arm + n) % n) - ((layout.player.arm - a.arm + n) % n));
  }

  /**
   * inject({ path?, type, colour, signalBehaviour, arriveIn }): a vehicle whose front reaches the player's
   * entry conflict zone `arriveIn` seconds from now. Returns its id, or null when no path conflicts.
   */
  function inject(spec = {}) {
    const path = spec.path ?? conflictingPaths(spec.filter)[0];
    if (!path) return null;
    const run = entryConflicts(playerVehicle.path, path)[0];
    if (!run) return null;
    if (spec.isolate !== false) clearTraffic({ keepApproach: true });
    return placeToArrive(spec, path, run.sFrom, spec.arriveIn ?? playerTimeToLine() + 1).id;
  }

  function clearTraffic({ keepApproach = false } = {}) {
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const w = vehicles[i];
      if (w.isPlayer) continue;
      if (keepApproach && w.path.arm === layout.player.arm && w.s < w.path.marks.giveWay && !w.committed) continue;
      vehicles.splice(i, 1);
    }
  }

  /**
   * Named QA scenarios, timed against "Go tapped now":
   *   liar     car signalling left whose true path comes round into the player (expect unsafe, cue named)
   *   unsafe   honest car arriving too soon (expect unsafe)
   *   tight    car arriving inside the critical gap but with room (expect tight)
   *   bus      bus passing the player's entry, inner lane where there is one (expect notAllowed on 2+ lanes)
   *   blocked  stationary car just inside the player's entry (expect notAllowed)
   *   alongside car in the lane to the player's left, level with it (call on the ring; expect alongside)
   *   clear    no traffic at all (exit timing QA: early / late / missed)
   * Returns the injected vehicle id (or null).
   */
  function scenario(name) {
    const tLine = playerTimeToLine();
    switch (name) {
      case 'liar':
        return inject({ signalBehaviour: 'wrongLeft', colour: 'Silver', arriveIn: tLine + 1.2, filter: (p) => p.direction !== 'left' || p.exitArm !== layout.player.arm });
      case 'unsafe':
        return inject({ signalBehaviour: 'none', colour: 'Blue', arriveIn: tLine + 1.0 });
      case 'tight': {
        clearTraffic({ keepApproach: true });
        const me = stateOf(playerVehicle);
        for (const path of conflictingPaths()) {
          for (let arrive = 1.5; arrive < 8; arrive += 0.1) {
            const id = inject({ path, colour: 'Red', arriveIn: tLine + arrive, isolate: false });
            const c = assessEntry(me, [stateOf(vehicles.find((w) => w.id === id))])[0];
            if (c && c.needDecel <= BRAKE_LIMIT * 0.9 && c.eta - tLine < CRITICAL_GAP.mean) return id;
            vehicles.splice(vehicles.findIndex((w) => w.id === id), 1);
          }
        }
        return null;
      }
      case 'bus': return injectBus();
      case 'blocked': {
        clearTraffic({ keepApproach: true });
        const path = conflictingPaths()[0];
        if (!path) return null;
        const run = entryConflicts(playerVehicle.path, path)[0];
        const v = placeAt({ colour: 'Grey' }, path, run.sFrom - VEHICLE_TYPES.hatch.length / 2 + 1.5, 0);
        v.holdUntil = clock + 8;
        return v.id;
      }
      case 'alongside': return injectAlongside();
      case 'clear':
        trafficOn = false;
        clearTraffic();
        return null;
      default:
        throw new Error('unknown scenario ' + name);
    }
  }

  // A bus in the innermost lane level with the player's merge point, nudged just clear of the entry if its
  // path would otherwise cross it: alongside, but not a conflict.
  function injectBus() {
    clearTraffic({ keepApproach: true });
    const pp = playerVehicle.path;
    const inner = layout.circulatory.lanes - 1;
    const mergeBearing = pp.bearing[indexAt(pp, pp.marks.merge)];
    const length = VEHICLE_TYPES.bus.length;
    for (const path of otherPaths().filter((q) => q.ringLane === inner)) {
      let s = sAtBearing(path, mergeBearing, path.marks.merge, path.marks.diverge);
      if (s === null) continue;
      const run = entryConflicts(pp, path, length)[0];
      if (run) s = Math.max(s, run.sTo + length / 2 + 0.5);
      if (s > path.marks.diverge) continue;
      const prof = speedProfile(path, VEHICLE_TYPES.bus.latComfort);
      return placeAt({ type: 'bus', colour: 'Red', signalBehaviour: 'none' }, path, s, allowedAt(path, prof, s)).id;
    }
    return null;
  }

  function injectAlongside() {
    const p = playerVehicle;
    if (p.path.ringLane === 0) return null;
    const b = p.geo.bearing;
    const target = layout.arms[p.path.exitArm].divergeBearing[p.path.ringLane];
    const candidates = [];
    for (const arm of layout.arms) {
      for (let lane = 0; lane < p.path.ringLane; lane++) {
        for (const exitArm of Object.keys(arm.exits).map(Number)) candidates.push(pathFor(arm.index, lane, exitArm, 0));
      }
    }
    for (const q of candidates) {
      const s = sAtBearing(q, b, q.marks.merge, q.marks.diverge);
      if (s === null || sAtBearing(q, target + 0.15, s, q.marks.diverge) === null) continue;
      const v = makeVehicle({ path: q, type: 'hatch', colour: 'Black', signalBehaviour: 'none', driver: 'normal', s, v: p.v });
      v.committed = v.locked = true;
      v.enteredAt = clock;
      vehicles.push(v);
      updateGeo(v);
      return v.id;
    }
    return null;
  }

  // ---------- boot ----------

  for (let t = 0; t < warmup; t += 1 / 30) step(1 / 30);
  clock = 0;
  history.length = 0;
  lastEntry.clear();
  for (const v of vehicles) if (v.enteredAt !== null) v.enteredAt -= warmup;
  for (let i = 0; i < nextSpawn.length; i++) nextSpawn[i] = Math.max(0, nextSpawn[i] - warmup);
  nextBus = Math.max(0, nextBus - warmup);
  if (player) insertPlayer();

  return {
    get t() { return clock; },
    get player() { return playerVehicle && stateOf(playerVehicle); },
    get vehicleCount() { return vehicles.length; },
    step,
    snapshot,
    replay: () => history.slice(),
    state: () => ({ t: clock, layout, playerId: playerVehicle ? PLAYER_ID : null, vehicles: vehicles.map(stateOf) }),
    leaderOf: (id) => {
      const v = vehicles.find((w) => w.id === id);
      return v ? leaderOf(v) : { id: null, gap: Infinity, speed: 0 };
    },
    allowedSpeed: (id) => {
      const v = vehicles.find((w) => w.id === id);
      return v ? allowed(v) : 0;
    },
    setPlayerControl(control) { Object.assign(playerVehicle.external, control); },
    commitPlayer() { playerVehicle.committed = playerVehicle.locked = true; },
    setPlayerLoops(loops) {
      const p = playerVehicle.path;
      playerVehicle.path = pathFor(p.arm, p.lane, p.exitArm, loops);
      updateGeo(playerVehicle);
      return playerVehicle.path;
    },
    debug: { inject, scenario, setTraffic: (on) => { trafficOn = on; }, clearTraffic },
  };
}
