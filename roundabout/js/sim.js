/**
 * Traffic simulation. Pure and deterministic for a given (layout, trafficSeed, options): no clocks, no DOM.
 * Each arm's sequence of arrivals (what, route, signal habit, driver) and the intervals between them depend
 * only on trafficSeed and density, never on what the player does. An arrival due on a blocked or full lane
 * (LANE_QUEUE_CAP) waits for room, which delays it and the rest of that arm's sequence; the sequence itself
 * never changes.
 *
 *   const sim = createSim(layout, { trafficSeed?, density = 'normal', preset?, warmup = 45, player = true })
 *     trafficSeed  traffic randomness, separate from the layout seed (rerun the same junction, new traffic);
 *                  defaults to layout.seed
 *     density      'none' | 'light' | 'normal' | 'heavy' (traffic-data arrivalRate and PLAYER_FACING routes)
 *     preset       a traffic-data PRESETS key: 'exitPractice' | 'liarCars'; its options fill in the rest
 *     honesty      share of correct signallers, overriding the real-world HONESTY (tests only)
 *     rate         arrivals per arm per second, overriding the density's (tuning and tests only)
 *   sim.step(dt)              fixed step (60 Hz intended); advances every vehicle
 *   sim.t                     simulated seconds since creation (warm-up excluded)
 *   sim.snapshot()            { t, vehicles: [VehicleView] } plain data for rendering / interpolation
 *   sim.replay()              snapshots of the last 5 s, oldest first (30 Hz)
 *   sim.spawns()              [{ t, id, arm, type, exitArm, signalBehaviour, driver }] arrivals since warm-up
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
  speedProfile, allowedAt, assessEntry, entryConflicts, timeToReach, stopPoint, BRAKE_LIMIT, SIGNAL_FROM, CREEP_DISTANCE, PLAYER_ACCEL,
} from './kinematics.js';
import {
  VEHICLE_TYPES, LARGE_TYPES, COLOURS, colourFor, CRITICAL_GAP, FOLLOW_UP, DRIVER_TYPES, signalMix, TRAFFIC, INDICATOR_HZ,
  PRESETS, PLAYER_FACING, LANE_QUEUE_CAP, DISHONEST, arrivalRate,
} from './traffic-data.js';

export const PLAYER_ID = 0;
const HISTORY_SECONDS = 5;
const HISTORY_EVERY = 2; // steps; 30 Hz at a 60 Hz step
const MAX_DECEL = 8;
const IDM_B = 2.0;
const ACC_COOLNESS = 0.99; // Treiber and Kesting's c: weight of the constant-acceleration heuristic in follow()
const DECISION_ZONE = 20; // metres before the line where an AI driver starts judging the gap
const LOCK_DECEL = 3; // once stopping would need more than this, a committed driver no longer reconsiders
// s an AI driver wants between clearing a conflict and the circulating car arriving: crossing a car's
// path makes its driver ease off well before the bodies meet.
const AI_CLEAR_MARGIN = 1.2;
// s a ring vehicle must be clear of an entrant's conflict zone before the entrant arrives to hold on rather
// than yield: judge.js PASS_MARGIN, the same rule the player's Go is judged by.
const PASS_IN_FRONT = 1.0;
const LARGE_EXIT_ROOM = 12; // m before its diverge point from which a bus or lorry turning off is given room
// Estimates, not sourced: after `ramp` s stopped at the front of its queue a driver accepts gaps `gap` s
// shorter and lets circulating traffic brake up to the full BRAKE_LIMIT (from brakeShare of it).
const IMPATIENCE = { ramp: 30, gap: 1.0, brakeShare: 0.8 };
// A car holding before its exit for a car level with it may stop a little past the diverge point (a late
// hold brakes past it); below `speed` within `metres` of it, it is still holding, not leaving.
const HOLD_OVERRUN = { speed: 2, metres: 2 };
const GO_ROUND_DECEL = 2.5; // m/s^2: an AI driver who would need more than this to yield before its exit goes round
const EXIT_LANE_MARGIN = 1.0; // m of side clearance under which two vehicles bound for one exit lane interact
const LARGE_BESIDE_MARGIN = 2.5; // m of side clearance on an approach under which a bus or lorry next door counts
const STEER_LAG = 0.25; // s, steering follows path curvature with this time constant
const LIAR_RETRY = 0.5; // s until the liarCars drill looks again for room to place a liar
// Vehicles more crossed than this are not car-following pairs (an exit and the entry beside it cross at ~100 deg);
// crossing conflicts are settled by gap acceptance instead.
const MAX_HEADING_DIFF = (75 * Math.PI) / 180;

export function createSim(layout, opts = {}) {
  const preset = opts.preset ? PRESETS[opts.preset] : {};
  const { warmup = 45, player = true } = opts;
  const trafficSeed = opts.trafficSeed ?? layout.seed;
  const density = opts.density ?? 'normal';
  // Arrivals come from their own streams (one per arm, one for the scheduled bus), each drawing a whole
  // arrival at once, so the same trafficSeed brings the same vehicles whatever the player does; a blocked
  // spawn only waits. `rng` serves everything the player can influence (drills, debug injections).
  const streamSeed = `${trafficSeed}|${layout.tier}`;
  const rng = createRng(`${streamSeed}|sim`);
  const cfg = TRAFFIC[layout.tier];
  const rate = opts.rate ?? arrivalRate(layout.tier, density);
  const mix = signalMix(opts.honesty);
  const driverWeights = Object.fromEntries(Object.entries(DRIVER_TYPES).map(([k, d]) => [k, d.weight]));
  const vehicles = [];
  const spawnLog = [];
  const history = createHistory();
  const lastEntry = new Map();
  const signalLeftAt = new Map();
  const extraPaths = new Map();
  let nextId = 1;
  let steps = 0;
  let clock = 0;
  let trafficOn = rate > 0;
  const armStreams = layout.arms.map((_, i) => createRng(`${streamSeed}|arm${i}`));
  const busStream = createRng(`${streamSeed}|bus`);

  // The player's road is the minor arm and routes that pass its entry are favoured, so the player has gaps
  // to read and reject; PLAYER_FACING.routes also weights the routes into the player's road.
  const playerPath = layout.paths[layout.player.pathId];
  const routeWeights = PLAYER_FACING.routes[density] ?? PLAYER_FACING.routes.normal;
  const exitWeights = layout.arms.map((arm, i) => Object.fromEntries(Object.entries(arm.exits).map(([exitArm, e]) => {
    if (i === layout.player.arm) return [exitArm, 1];
    const passes = entryConflicts(playerPath, layout.paths[pathId(i, e.lane, Number(exitArm), 0)]).length > 0;
    return [exitArm, passes ? routeWeights.passes : Number(exitArm) === layout.player.arm ? routeWeights.into : 1];
  })));
  const armRate = (i) => rate * (i === layout.player.arm ? PLAYER_FACING.ownArm : 1);
  const unitDelay = (r) => -Math.log(1 - r());

  // pending[i]: { at, arrival } the next vehicle due on arm i
  const pending = layout.arms.map((_, i) => (rate > 0 ? { at: (unitDelay(armStreams[i]) * armStreams[i]()) / armRate(i), arrival: drawArrival(armStreams[i], i) } : null));
  let pendingBus = cfg.busEvery && rate > 0
    ? { at: busStream.range(...cfg.busEvery) * 0.25, arrival: drawArrival(busStream, busStream.int(0, layout.arms.length - 1), 'bus') }
    : null;
  let nextLiar = preset.liarLag ? 0 : Infinity;

  function drawArrival(r, arm, typeOverride) {
    const exits = layout.arms[arm].exits;
    const exitArm = Number(r.weighted(exitWeights[arm]));
    const type = typeOverride ?? r.weighted(cfg.types);
    return {
      arm, exitArm, lane: exits[exitArm].lane, type, colour: colourFor(r, type), signalBehaviour: r.weighted(mix),
      driver: r.weighted(driverWeights), seed: r(),
    };
  }

  // ---------- vehicles ----------

  // r: the stream for this vehicle's own draws (signal phase, driver variation).
  function makeVehicle({ path, type, colour, signalBehaviour, driver, s, v, isPlayer = false, r = rng }) {
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
      waitingSince: null,
      external: null,
      holdUntil: -Infinity,
      signalPhase: r(),
      params: {
        T: d.T * r.range(0.9, 1.1),
        s0: d.s0,
        a: dims.accel * d.accelScale * r.range(0.9, 1.1),
        b: IDM_B,
        speedScale: d.speedScale * r.range(0.95, 1.05),
        latComfort: Math.round(dims.latComfort * d.latScale * r.range(0.9, 1.1) * 10) / 10,
        tc: Math.max(CRITICAL_GAP.min, r.normal(CRITICAL_GAP.mean + d.gapShift, CRITICAL_GAP.sd)),
        tf: Math.max(FOLLOW_UP.min, r.normal(FOLLOW_UP.mean + d.gapShift / 2, FOLLOW_UP.sd)),
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

  // Vehicles in an approach lane that have not yet joined the ring.
  const waitingIn = (arm, lane) => vehicles.reduce((n, w) => n + (w.path.arm === arm && w.path.lane === lane && w.enteredAt === null ? 1 : 0), 0);

  function spawn(a) {
    if (!spawnClear(a.arm, a.lane, VEHICLE_TYPES[a.type].length) || waitingIn(a.arm, a.lane) >= LANE_QUEUE_CAP) return false;
    const path = layout.paths[pathId(a.arm, a.lane, a.exitArm, 0)];
    const v = makeVehicle({ ...a, path, s: VEHICLE_TYPES[a.type].length / 2, v: 0, r: createRng(a.seed) });
    v.v = safeSpawnSpeed(path, v.length, allowed(v) * 0.9);
    vehicles.push(v);
    spawnLog.push({ t: clock, id: v.id, arm: a.arm, type: a.type, exitArm: a.exitArm, signalBehaviour: a.signalBehaviour, driver: a.driver });
    return true;
  }

  // A blocked arrival keeps its draw and retries a second later; the next is due an interval after it spawns.
  function spawnDue() {
    liarDue();
    if (!trafficOn) return;
    layout.arms.forEach((arm, i) => {
      const p = pending[i];
      if (!p || clock < p.at) return;
      if (!spawn(p.arrival)) { p.at = clock + 1; return; }
      const r = armStreams[i];
      pending[i] = { at: p.at + unitDelay(r) / armRate(i), arrival: drawArrival(r, i) };
    });
    if (pendingBus && clock >= pendingBus.at) {
      if (!spawn(pendingBus.arrival)) pendingBus.at = clock + 1;
      else pendingBus = { at: clock + busStream.range(...cfg.busEvery), arrival: drawArrival(busStream, busStream.int(0, layout.arms.length - 1), 'bus') };
    }
  }

  // liarCars drill: while the player waits near the line, a liar arrives preset.liarLag seconds later. With
  // no room for one now, it tries again shortly.
  function liarDue() {
    const p = playerVehicle;
    if (!p || clock < nextLiar || p.committed || p.stopS - p.s > CREEP_DISTANCE) return;
    const id = inject({ signalBehaviour: rng.weighted(DISHONEST), arriveIn: playerTimeToLine() + rng.range(...preset.liarLag), isolate: false, room: true });
    nextLiar = clock + (id === null ? LIAR_RETRY : preset.liarEvery);
  }

  // ---------- geometry cache per step ----------

  // geo caches where v is, for every pair test this step; `at` and `path` say which position it describes.
  function updateGeo(v) {
    const q = sampleAt(v.path, v.s);
    const m = v.path.marks;
    const box = corners(q.x, q.z, q.heading, v.length, v.width);
    v.geo = {
      at: v.s, path: v.path, x: q.x, z: q.z, heading: q.heading, fwd: dir(q.heading), bearing: bearingOf(q.x, q.z), r: q.r, box,
      cb: box.map((c) => bearingOf(c[0], c[1])),
      approach: v.s <= m.merge,
      ring: v.s + v.length / 2 >= m.giveWay && v.s - v.length / 2 <= m.exitRing,
      exit: v.s + v.length / 2 >= m.diverge,
      extents: null, // Map frame -> linearExtents, filled on demand
    };
  }
  const geoCurrent = (v) => v.geo !== null && v.geo.at === v.s && v.geo.path === v.path;

  // Arm-aligned frames, fixed by the layout: `in` runs down an approach towards the ring, `out` along an exit.
  const armFrames = layout.arms.map((arm) => ({
    in: { f: dir(arm.bearing + Math.PI), l: dir(arm.bearing + Math.PI / 2) },
    out: { f: dir(arm.bearing), l: dir(arm.bearing + Math.PI / 2) },
  }));

  function linearExtents(v, frame) {
    v.geo.extents ??= new Map();
    let e = v.geo.extents.get(frame);
    if (e) return e;
    const { f, l } = frame;
    let fMin = Infinity, fMax = -Infinity, lMin = Infinity, lMax = -Infinity;
    for (const c of v.geo.box) {
      const a = c[0] * f[0] + c[1] * f[1];
      const b = c[0] * l[0] + c[1] * l[1];
      fMin = Math.min(fMin, a); fMax = Math.max(fMax, a); lMin = Math.min(lMin, b); lMax = Math.max(lMax, b);
    }
    e = { fMin, fMax, lMin, lMax };
    v.geo.extents.set(frame, e);
    return e;
  }

  // Lateral clearance below which two vehicles count as sharing a lane. A bus or HGV sweeps wider on bends,
  // so nobody runs alongside one (HC 187).
  const sideMargin = (v, w) => (LARGE_TYPES.has(v.type) || LARGE_TYPES.has(w.type) ? 1.2 : 0.3);

  // Bodies overlapping lengthways are side by side in neighbouring lanes (the margins above are wider than
  // real contact), not one ahead of the other.
  const aheadOnly = (gap) => (gap < 0 ? Infinity : gap);

  // Gap along an arm-aligned frame (f forward, l lateral), or Infinity if w is not ahead within `m` sideways.
  // alongside: the gap to report when the bodies already overlap lengthways (Infinity = side by side is fine).
  function linearGap(v, w, frame, m = sideMargin(v, w), alongside = Infinity) {
    const ev = linearExtents(v, frame);
    const ew = linearExtents(w, frame);
    if ((ew.fMin + ew.fMax) / 2 <= (ev.fMin + ev.fMax) / 2) return Infinity;
    if (ev.lMin > ew.lMax + m || ew.lMin > ev.lMax + m) return Infinity;
    const gap = ew.fMin - ev.fMax;
    return gap < 0 ? alongside : gap;
  }

  // Arc length on v's own path, within `ahead` metres, where w's body (its centreline, padded by both
  // half-widths) first reaches it, or null: a car turning off sees nothing beyond its exit.
  function pathHit(v, w, ahead) {
    const p = v.path;
    const reach = v.width / 2 + w.width / 2 + 0.3;
    const hl = w.length / 2;
    // Every sample scanned lies within ahead + a step of v's centre (chord <= arc): w's body farther off than
    // that plus its reach cannot touch one.
    if (Math.hypot(w.geo.x - v.geo.x, w.geo.z - v.geo.z) > ahead + 2 * p.step + reach + hl) return null;
    const f = w.geo.fwd;
    const ax = w.geo.x - f[0] * hl;
    const az = w.geo.z - f[1] * hl;
    const i0 = Math.floor(v.s / p.step);
    const i1 = Math.min(p.x.length - 1, Math.ceil((v.s + ahead) / p.step));
    for (let i = i0; i <= i1; i += 2) {
      const t = Math.max(0, Math.min(2 * hl, (p.x[i] - ax) * f[0] + (p.z[i] - az) * f[1]));
      if (Math.hypot(p.x[i] - ax - f[0] * t, p.z[i] - az - f[1] * t) < reach) return p.s[i];
    }
    return null;
  }

  // A vehicle already out on the exit v is heading for, while v is still on the ring: neither the ring nor the
  // exit test covers that stretch, and on a mini it is most of the way out.
  function exitAheadGap(v, w) {
    const hit = pathHit(v, w, v.path.marks.exitRing - v.s + w.length + 10);
    return hit === null ? Infinity : aheadOnly(hit - (v.s + v.length / 2));
  }

  function ringGap(v, w) {
    const rel = wrapPi(w.geo.bearing - v.geo.bearing);
    if (rel <= 0 || rel > Math.PI / 2) return Infinity;
    // No radial-overlap test: an inner-lane car heading for its exit must follow the outer-lane car it is about
    // to cut in behind as soon as its own path runs into that body, not once the bodies overlap radially (by
    // then the gap is a few metres and it has to stamp on the brakes).
    if (pathHit(v, w, rel * v.geo.r + w.length) === null) return Infinity;
    let vMax = -Infinity;
    let wMin = Infinity;
    for (const b of v.geo.cb) vMax = Math.max(vMax, wrapPi(b - v.geo.bearing));
    for (const b of w.geo.cb) wMin = Math.min(wMin, wrapPi(b - v.geo.bearing));
    return aheadOnly(v.geo.r * (wMin - vMax));
  }

  // An inner-lane vehicle already leaving across v's lane ahead (past its diverge point, so it will not stop for
  // v): when v would reach the crossing before it has cleared it, it is followed from the crossing in good time,
  // not once its body is on v's path (a lorry crawling across left the car behind braking at 7 m/s^2). A bus or
  // lorry counts from LARGE_EXIT_ROOM before its diverge point: traffic behind gives a long vehicle room to turn
  // off (HC 187) rather than leave it holding at its exit while heavy traffic streams past; once v follows it,
  // its own crossingYield passes over v, so it goes.
  function cutAcrossGap(v, w) {
    const from = w.path.marks.diverge - (LARGE_TYPES.has(w.type) ? LARGE_EXIT_ROOM : 0);
    // v circulating (past its merge): at its line it judges the gap instead, and its approach is its own lane's.
    if (v.s < v.path.marks.merge || w.path.ringLane <= v.path.ringLane || w.s < from || w.s >= w.path.marks.exitRing || w.geo.r >= v.geo.r) return Infinity;
    // v must be wholly behind w: a v level with any of w's body (a long vehicle's rear still in the inner lane) is
    // alongside, and w keeps yielding to it (crossingYield), as a follower it would not.
    const front = v.s + v.length / 2;
    const rearS = sAtBearing(v.path, w.geo.bearing - w.length / 2 / Math.max(w.geo.r, 1), v.s, v.path.marks.exitRing);
    if (rearS == null || rearS < front) return Infinity;
    const x = crossingAt(w, v.geo.r - (v.width + w.width) / 2 - 0.3);
    const sx = x && sAtBearing(v.path, x.bearing, v.s, v.path.marks.exitRing);
    // Bound for the same exit, w may sweep across v's lane only beyond v's own exit mouth: v holds behind its rear.
    if (sx == null && w.path.exitArm !== v.path.exitArm) return Infinity;
    const gap = sx == null ? rearS - front : Math.min(rearS - front, sx - front - w.width / 2);
    if (gap < 0) return Infinity;
    // Until its rear is across v's lane, or (same exit, no crossing on the ring) out past its exit mouth.
    const clearS = x ? x.s + w.length + w.width : w.path.marks.exitRing + w.length / 2;
    const wClear = (clearS - w.s) / Math.max(w.v, 1);
    return gap / Math.max(v.v, 1) < wClear + 0.5 ? gap : Infinity;
  }

  function leaderOf(v) {
    let best = { id: null, gap: Infinity, speed: 0 };
    const approachFrame = armFrames[v.path.arm].in;
    const exitFrame = armFrames[v.path.exitArm].out;
    for (const w of vehicles) {
      if (w === v) continue;
      const dh = wrapPi(w.geo.heading - v.geo.heading);
      if (Math.abs(dh) > MAX_HEADING_DIFF) continue;
      const large = LARGE_TYPES.has(v.type) || LARGE_TYPES.has(w.type);
      let gap = Infinity;
      // Same approach lane: shared entry geometry up to the merge, so arc lengths compare directly while the
      // leader's rear is still on it (its centre may already be on the ring). Adjacent lanes only interact
      // when a long vehicle sweeps across the lane line.
      if (v.geo.approach && w.path.arm === v.path.arm && w.s - w.length / 2 <= w.path.marks.merge) {
        if (w.path.lane === v.path.lane) {
          if (w.s > v.s) gap = w.s - v.s - (v.length + w.length) / 2;
        } else if (large && w.geo.approach && !v.isPlayer) {
          // (The player's approach is player.js's: it pulls up to its own line whatever is in the next lane.)
          // Never draw up alongside a bus or lorry in the next lane (HC 187): its rear swings across as it turns
          // off. The side margin spans a whole lane so the queue beside it holds back behind its rear in good
          // time, rather than finding itself alongside. Once committed to joining it has judged the gap and goes.
          gap = v.committed
            ? linearGap(v, w, approachFrame)
            : linearGap(v, w, approachFrame, LARGE_BESIDE_MARGIN, 0.05);
        }
      }
      if (v.geo.exit && w.geo.exit && w.path.exitArm === v.path.exitArm && (large || w.path.exitLane === v.path.exitLane)) {
        // Same exit lane: a wider side margin catches two paths converging into it, but a finite one, since on
        // a mini 'exit' starts on the ring side and a car across the junction projects ahead on the exit axis.
        gap = Math.min(gap, linearGap(v, w, exitFrame,
          w.path.exitLane === v.path.exitLane ? Math.max(EXIT_LANE_MARGIN, sideMargin(v, w)) : sideMargin(v, w)));
      }
      if (v.geo.ring && w.geo.ring) gap = Math.min(gap, ringGap(v, w), cutAcrossGap(v, w));
      if (v.geo.ring && !v.geo.exit && w.geo.exit && w.path.exitArm === v.path.exitArm) gap = Math.min(gap, exitAheadGap(v, w));
      if (gap < best.gap) best = { id: w.id, gap, speed: Math.max(0, w.v * Math.cos(dh)), accel: w.a };
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

  /**
   * Car-following toward a moving leader: IDM blended with the constant-acceleration heuristic (Treiber and
   * Kesting's ACC model). Plain IDM brakes at up to MAX_DECEL when a vehicle appears a few metres ahead (a
   * joiner, or the outer-lane car an inner-lane car cuts in behind) even if it is pulling away; the heuristic
   * asks only for what the kinematics need, so such cut-ins cost about IDM_B, while a closing gap still gets
   * full IDM braking. A (nearly) stopped leader gets plain IDM: the heuristic would stop right at its bumper,
   * without the s0 margin.
   */
  function follow(v, v0, lead, p) {
    const a = idm(v, v0, lead.gap, lead.speed, p);
    if (lead.gap === Infinity || lead.speed < 1) return a;
    const s = Math.max(lead.gap, 0.05);
    const aLead = Math.min(lead.accel ?? 0, p.a);
    const dv = v - lead.speed;
    const denom = lead.speed * lead.speed - 2 * s * aLead;
    const cah = lead.speed * dv <= -2 * s * aLead && denom > 1e-6
      ? (v * v * aLead) / denom
      : aLead - (dv > 0 ? (dv * dv) / (2 * s) : 0);
    if (a >= cah) return a;
    // IDM's term is unbounded as the gap closes; clipped, its 1% share cannot swamp the blend.
    const aIdm = Math.max(a, -MAX_DECEL);
    return (1 - ACC_COOLNESS) * aIdm + ACC_COOLNESS * (cah + p.b * Math.tanh((aIdm - cah) / p.b));
  }

  const asEntrant = (v) => ({ path: v.path, s: v.s, v: v.v, length: v.length, accelMax: v.params.a, latComfort: v.params.latComfort });

  // Vehicles that are on the ring or committed to joining it; waiting vehicles will give way themselves.
  const activeOthers = (v) => vehicles.filter((w) => w !== v && (w.geo.ring || w.committed));

  // A joiner reads the player's route from its indicator, not its intent: until the player signals left on the
  // ring it may leave at its exit or go round again (a missed Exit), so the joiner keeps clear of both. AI
  // vehicles keep their true paths, as the judge reads them.
  const asSeen = (w) => {
    if (!w.isPlayer || w.s < w.path.marks.merge || w.s >= w.path.marks.diverge || w.external?.indicator === 'left') return [w];
    const p = w.path;
    return [w, Object.assign(Object.create(w), { path: pathFor(p.arm, p.lane, p.exitArm, p.loops + 1) })];
  };

  // Waiting drivers accept shorter gaps (gap acceptance falls with waiting time), within limits that still
  // never make circulating traffic brake harder than BRAKE_LIMIT. Without this a bus or lorry at a busy ring
  // can wait minutes and starve its arm.
  function canEnter(v) {
    const tMe = Math.max(0, v.stopS - v.s) / Math.max(v.v, 2);
    const key = v.path.arm + ':' + v.path.lane;
    const followUp = clock - (lastEntry.get(key) ?? -Infinity) < v.params.tf + 1.5;
    const impatience = v.waitingSince === null ? 0 : Math.min(1, (clock - v.waitingSince) / IMPATIENCE.ramp);
    const needGap = (followUp ? v.params.tf : v.params.tc) - IMPATIENCE.gap * impatience;
    const brakeOk = BRAKE_LIMIT * (IMPATIENCE.brakeShare + (1 - IMPATIENCE.brakeShare) * impatience);
    for (const c of assessEntry(asEntrant(v), activeOthers(v).flatMap(asSeen), { minSpeed: 4, cruise: true })) {
      if (c.inZone || c.eta < tMe + needGap || c.eta < c.tClear + AI_CLEAR_MARGIN || c.needDecel > brakeOk) return false;
    }
    return true;
  }

  // Only the front undecided vehicle of a lane queue judges the gap; the rest follow it. A vehicle behind one
  // already committed judges the same gap as it rolls up (follow-up), rather than stopping at the line first.
  const queuedBehind = (v) => vehicles.some((w) =>
    w !== v && w.path.arm === v.path.arm && w.path.lane === v.path.lane && w.s > v.s && w.s < w.path.marks.merge && !w.committed);

  function decideEntry(v) {
    const toStop = v.stopS - v.s;
    // The player only enters on Go: creeping a little past its stop point while waiting is not entering, and
    // ring traffic yielding to it then would deadlock the junction.
    if (toStop < -0.2 && !(v.isPlayer && !v.committed)) {
      if (v.enteredAt === null) {
        v.enteredAt = clock;
        v.committed = v.locked = true;
        lastEntry.set(v.path.arm + ':' + v.path.lane, clock);
      }
      return;
    }
    // A held vehicle (debug) does not commit: the ring would yield to a car that is not moving.
    if (v.locked || v.isPlayer || toStop > DECISION_ZONE || clock < v.holdUntil) return;
    const front = !queuedBehind(v);
    if (front && v.waitingSince === null && v.v < 0.5) v.waitingSince = clock;
    v.committed = front && canEnter(v);
    if (v.committed && toStop <= Math.max(1, (v.v * v.v) / (2 * LOCK_DECEL))) v.locked = true;
  }

  // Arc length and bearing where v's path first reaches radius r on its way out, or null.
  function crossingAt(v, r) {
    const p = v.path;
    const end = Math.min(p.s.length - 1, indexAt(p, p.marks.exitRing));
    for (let i = indexAt(p, v.s); i <= end; i++) if (p.r[i] >= r) return { s: p.s[i], bearing: p.bearing[i] };
    return null;
  }

  // An inner-lane vehicle cutting across outer lanes to its exit, judged both now and where and when it
  // reaches each outer car's lane. A car that will be just ahead there is followed until this one is out of
  // the ring (it slots in behind); one alongside or just behind makes it wait before the exit, or, if it
  // cannot stop comfortably, go round again (never swerve).
  function crossingYield(v) {
    const m = v.path.marks;
    if (v.path.ringLane === 0 || v.s >= m.exitRing || v.s < m.diverge - 30) return Infinity;
    let a = Infinity;
    for (const w of vehicles) {
      // A vehicle already following this one is held back by it, and one still waiting at its line (nose over
      // it) waits for this one: yielding to either would deadlock.
      if (w === v || !w.geo.ring || !w.committed || w.geo.r < v.geo.r + 1.5 || w.leaderId === v.id) continue;
      // Already peeling off at an earlier exit: gone before this one crosses its lane.
      if (w.s > w.path.marks.diverge && w.path.exitArm !== v.path.exitArm) continue;
      // Leaving side by side into the other lane of a two-lane exit: the paths never cross (unless a bus or
      // lorry sweeps across the lane line).
      const large = LARGE_TYPES.has(v.type) || LARGE_TYPES.has(w.type);
      if (!large && w.path.exitArm === v.path.exitArm && w.path.exitLane !== v.path.exitLane && w.path.marks.diverge - w.s < 40) continue;
      const reach = (v.length + w.length) / 2 + 1;
      const off = v.geo.r * wrapPi(w.geo.bearing - v.geo.bearing);
      const x = crossingAt(v, w.geo.r);
      // Timed as v really moves (pulling away from a hold at its exit takes seconds, not distance / 1 m/s), and
      // a car still behind must stay behind for as long as v takes to get its body across w's lane.
      const prof = profileOf(v);
      const tAt = x ? timeToReach(v.path, prof, v.s, v.v, v.params.a, x.s) : 0;
      const tAcross = x ? timeToReach(v.path, prof, v.s, v.v, v.params.a, x.s + v.length) - tAt : 0;
      const behind = -(reach + 4 + w.v * Math.max(1, tAcross));
      const offAtCross = x ? w.geo.r * wrapPi(w.geo.bearing - x.bearing) + w.v * tAt : null;
      const ahead = (off > 0 && off < reach) || (offAtCross !== null && offAtCross >= 0 && offAtCross < reach + 2 * v.v);
      const level = (off <= 0 && off >= behind) || (offAtCross !== null && offAtCross < 0 && offAtCross >= behind);
      if (ahead && off > 0) {
        const gap = w.geo.r * wrapPi(w.geo.bearing - v.geo.bearing) - (v.length + w.length) / 2;
        a = Math.min(a, follow(v.v, allowed(v), { gap: Math.max(0.05, gap), speed: w.v, accel: w.a }, v.params));
      } else if (!level || (v.s >= m.diverge && !(v.v < HOLD_OVERRUN.speed && v.s < m.diverge + HOLD_OVERRUN.metres))) {
        continue;
      } else if (v.s >= m.diverge) {
        // Slid just past its exit point while holding: still waiting, not leaving across the level car.
        a = Math.min(a, idm(v.v, allowed(v), 0.05, 0, v.params, 0.5));
      } else if (goRoundIfGentler(v, (v.v * v.v) / (2 * Math.max(0.1, m.diverge - v.s)))) {
        return Infinity;
      } else {
        a = Math.min(a, idm(v.v, allowed(v), Math.max(0.05, m.diverge - v.s), 0, v.params, 0.5));
      }
    }
    return a;
  }

  // Going round only when stopping short of the exit would need more than GO_ROUND_DECEL, and only if the
  // lap ahead does not need even harder braking for a car that has already pulled out onto it (it judged
  // its gap on this vehicle leaving).
  function goRoundIfGentler(v, stopNeed) {
    if (stopNeed <= GO_ROUND_DECEL) return false;
    const p = v.path;
    v.path = pathFor(p.arm, p.lane, p.exitArm, p.loops + 1);
    if (-Math.min(0, entrantYield(v)) <= stopNeed) return true;
    v.path = p;
    return false;
  }

  function aiAccel(v) {
    if (clock < v.holdUntil) return -MAX_DECEL;
    const lead = leaderOf(v);
    v.leaderId = lead.id;
    let a = follow(v.v, allowed(v), lead, v.params);
    if (!v.committed && v.s < v.stopS + 0.5) {
      a = Math.min(a, idm(v.v, allowed(v), v.stopS - v.s, 0, v.params, 0.05));
    }
    a = Math.min(a, crossingYield(v), entrantYield(v));
    return Math.max(-MAX_DECEL, Math.min(v.params.a, a));
  }

  // A circulating driver eases off for a vehicle already pulling out across its path that will not clear in
  // time (one that misjudged the gap, or that it surprised by going round again). Only true conflicts count.
  // Vehicles joining side by side from one arm are a lane-discipline matter, not a crossing; and of two
  // vehicles each yielding to the other, only the first keeps yielding (either would deadlock both).
  function entrantYield(v) {
    v.yieldTo = null;
    if (!v.geo.ring) return Infinity;
    const front = v.s + v.length / 2;
    let a = Infinity;
    for (const w of vehicles) {
      if (w === v || !w.locked || w.s - w.length / 2 > w.path.marks.entryEnd) continue;
      if (w.path.arm === v.path.arm || w.yieldTo === v.id) continue;
      for (const run of entryConflicts(w.path, v.path, Math.max(v.length, w.length))) {
        if (front > run.sFrom || v.s - v.length / 2 > run.sTo) continue;
        const gap = run.sFrom - front;
        if (gap > 60) break;
        // Passing in front, point by point as judge.goAssessment tests it: at present speed this vehicle's rear
        // clears each point of the run PASS_IN_FRONT before the entrant's front reaches the matching entry
        // point. Holding on keeps it clear (the entrant follows it in); braking would leave it crawling across.
        const rear = v.s - v.length / 2;
        const arrive = new Map(); // entry point -> s until the entrant's front gets there (pairs repeat points)
        const arriveAt = (sEntry) => {
          if (!arrive.has(sEntry)) arrive.set(sEntry, timeToReach(w.path, profileOf(w), w.s, w.v, w.params?.a ?? 2, sEntry - w.length / 2, 15));
          return arrive.get(sEntry);
        };
        const passes = run.pairs.every(([sOther, sEntry]) => sOther <= rear || (sOther - rear) / Math.max(v.v, 1) + PASS_IN_FRONT <= arriveAt(sEntry));
        if (passes) break;
        const wClear = timeToReach(w.path, profileOf(w), w.s, w.v, w.params?.a ?? 2, run.sEntryMax + w.length / 2, 15);
        if (wClear <= 0) break; // its body is already past every entry point of this run: nothing left to yield to
        if (gap / Math.max(v.v, 1) < wClear + 0.5) {
          // The entrant moves on as it joins: only its speed along this vehicle's heading holds the zone up.
          const along = Math.max(0, Math.cos(wrapPi(w.geo.heading - v.geo.heading)));
          const need = follow(v.v, allowed(v), { gap: Math.max(0.05, gap), speed: w.v * along, accel: w.a * along }, v.params);
          if (need < a) { a = need; v.yieldTo = w.id; }
        }
        break;
      }
    }
    return a;
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
      case 'rightEarly': return s < m.diverge ? 'right' : null; // as if going further round, then off
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
    // Geometry from the end of the last step still holds unless a vehicle is new or was moved since.
    for (const v of vehicles) if (!geoCurrent(v)) updateGeo(v);
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
    if (steps % HISTORY_EVERY === 0) history.push(snapshot(), Math.round(HISTORY_SECONDS / (dt * HISTORY_EVERY)));
  }

  // The last `keep` snapshots, overwriting the oldest in place; frames() unrolls them oldest first.
  function createHistory() {
    let items = [];
    let start = 0;
    const frames = () => items.slice(start).concat(items.slice(0, start));
    return {
      push(item, keep) {
        if (items.length > keep) { items = frames().slice(-keep); start = 0; }
        if (items.length < keep) { items.push(item); return; }
        items[start] = item;
        start = (start + 1) % keep;
      },
      frames,
      clear() { items = []; start = 0; },
    };
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
    // Far enough out to read the speed-limit, 510 and map signs on the way in. Nothing is left queued ahead in
    // the player's lane: the wait belongs at the line, judging the ring, not behind its own arm's queue.
    const s = Math.max(VEHICLE_TYPES.hatch.length / 2, path.marks.giveWay - 185);
    for (let i = vehicles.length - 1; i >= 0; i--) {
      const w = vehicles[i];
      if (w.path.arm !== pl.arm || w.enteredAt !== null) continue;
      if (Math.abs(w.s - s) < 30 || (w.path.lane === path.lane && w.s > s)) vehicles.splice(i, 1);
    }
    playerVehicle = makeVehicle({ path, type: 'hatch', colour: 'White', signalBehaviour: 'correct', driver: 'normal', s, v: 0, isPlayer: true });
    playerVehicle.v = safeSpawnSpeed(path, playerVehicle.length, path.limits.approach);
    playerVehicle.params.a = PLAYER_ACCEL; // the player's real pull-away, so judging and scenarios time it right
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

  // Arc length (and speed there) on `path` from which a vehicle driving its own profile brings its front to
  // sTarget in `seconds`.
  function arrivalPoint(type, path, sTarget, seconds) {
    const { length, latComfort, accel } = VEHICLE_TYPES[type];
    const prof = speedProfile(path, latComfort);
    let lo = length / 2;
    let hi = sTarget - length / 2;
    for (let i = 0; i < 40; i++) {
      const mid = (lo + hi) / 2;
      const t = timeToReach(path, prof, mid, allowedAt(path, prof, mid), accel, sTarget - length / 2, 60);
      if (t > seconds) lo = mid;
      else hi = mid;
    }
    return { s: lo, speed: allowedAt(path, prof, lo) };
  }

  // Whether a committed vehicle dropped at s on `path` among live traffic would land clear of every body and
  // not behind a queue in its own lane. Such a queue never moves for it (it waits for the ring, while the ring
  // yields to the committed newcomer), so that would lock the junction.
  function roomAt(type, path, s) {
    const q = sampleAt(path, s);
    const length = VEHICLE_TYPES[type].length;
    const before = s < path.marks.merge;
    return vehicles.every((w) => Math.hypot(w.geo.x - q.x, w.geo.z - q.z) > (length + w.length) / 2 + 4
      && !(before && !w.committed && w.path.arm === path.arm && w.path.lane === path.lane && w.s > s));
  }

  function playerTimeToLine() {
    const p = playerVehicle;
    return Math.max(0, p.stopS - p.s) / Math.max(p.v, 2);
  }

  // Seconds until the player's centre reaches arc length s if it pulled away now (as judge times a Go).
  function playerTimeTo(s) {
    const p = playerVehicle;
    return timeToReach(p.path, profileOf(p), p.s, p.v, PLAYER_ACCEL, s);
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
   * inject({ path?, filter?, type, colour, signalBehaviour, arriveIn, withPlayer?, isolate = true, room = false }): a
   * vehicle whose front reaches the player's entry conflict zone `arriveIn` seconds from now, or `withPlayer`
   * seconds after the player's front would, pulling away now at PLAYER_ACCEL. isolate clears the other
   * traffic first; room (among live traffic) tries each conflicting path, most upstream first, and places it
   * only where roomAt allows. Returns its id, or null when no path conflicts (or none has room).
   */
  function inject(spec = {}) {
    const type = spec.type ?? 'hatch';
    const paths = spec.path ? [spec.path] : conflictingPaths(spec.filter);
    for (const path of spec.room ? paths : paths.slice(0, 1)) {
      const run = entryConflicts(playerVehicle.path, path)[0];
      if (!run) continue;
      const arriveIn = spec.withPlayer !== undefined ? playerTimeTo(run.sEntryMin - playerVehicle.length / 2) + spec.withPlayer
        : spec.arriveIn ?? playerTimeToLine() + 1;
      if (spec.isolate !== false) clearTraffic({ keepApproach: true });
      const at = arrivalPoint(type, path, run.sFrom, arriveIn);
      if (spec.room && !roomAt(type, path, at.s)) continue;
      return placeAt({ ...spec, type }, path, at.s, at.speed).id;
    }
    return null;
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
   *   shield   car joining from the right and turning off at the player's road, holding up a car behind it
   *   farRight van from the far arm signalling right whose true path comes past the player
   *   leftLiar van from the left arm signalling right that turns off before reaching the player
   *   alongside car in the lane to the player's left, level with it (call on the ring; expect alongside)
   *   queued   car waiting 8 s at the player's own line, ahead of it (call on the approach; expect Go disabled)
   *   clear    no traffic at all (exit timing QA: early / late / missed)
   * Returns the injected vehicle id (or null).
   */
  function scenario(name) {
    const tLine = playerTimeToLine();
    switch (name) {
      case 'liar':
        return inject({ signalBehaviour: 'wrongLeft', colour: 'Silver', withPlayer: 0.2, filter: (p) => p.exitArm !== layout.player.arm });
      case 'unsafe':
        return inject({ signalBehaviour: 'none', colour: 'Blue', withPlayer: 0 });
      case 'tight': {
        clearTraffic({ keepApproach: true });
        const me = stateOf(playerVehicle);
        // Of every conflicting path's arrivals that read tight, the one asking least braking: tight turns unsafe
        // as the car closes in, and a person needs time to tap.
        let best = null;
        for (const path of conflictingPaths()) {
          for (let arrive = 1.5; arrive < 8; arrive += 0.05) {
            const id = inject({ path, colour: 'Red', arriveIn: tLine + arrive, isolate: false });
            const c = assessEntry(me, [stateOf(vehicles.find((w) => w.id === id))])[0];
            vehicles.splice(vehicles.findIndex((w) => w.id === id), 1);
            if (c && c.eta - tLine >= CRITICAL_GAP.mean) break;
            if (c && c.needDecel <= BRAKE_LIMIT * 0.9 && (!best || c.needDecel < best.needDecel)) best = { path, arrive, needDecel: c.needDecel };
          }
        }
        return best && inject({ path: best.path, colour: 'Red', arriveIn: tLine + best.arrive, isolate: false });
      }
      case 'bus': return injectBus();
      case 'shield': return injectShield();
      case 'farRight': return injectFarSignaller(true);
      case 'leftLiar': return injectFarSignaller(false);
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
      case 'queued': {
        // Traffic never queues ahead of the player in its lane (insertPlayer), so the Go gating needs one placed.
        const path = playerVehicle.path;
        const { length, width } = VEHICLE_TYPES.hatch;
        const s = stopPoint(path, length, width);
        if (playerVehicle.s + playerVehicle.length / 2 > s - length / 2 - 2) return null;
        const v = makeVehicle({ path, type: 'hatch', colour: 'Grey', signalBehaviour: 'correct', driver: 'normal', s, v: 0 });
        v.holdUntil = clock + 8;
        vehicles.push(v);
        updateGeo(v);
        return v.id;
      }
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
      // Level with the player's merge point when the player, pulling away now, gets there.
      const at = arrivalPoint('bus', path, s + length / 2, playerTimeTo(pp.marks.merge));
      return placeAt({ type: 'bus', colour: 'Red', signalBehaviour: 'none' }, path, at.s, at.speed).id;
    }
    return null;
  }

  // A car joining from the arm to the player's right and leaving at the player's road (so it never crosses
  // the player), with a circulating car close behind that it holds up.
  function injectShield() {
    clearTraffic({ keepApproach: true });
    const n = layout.arms.length;
    const p = layout.player.arm;
    const right = (p - 1 + n) % n;
    const shieldPath = pathFor(right, 0, p, 0);
    const shield = placeAt({ colour: 'Blue', signalBehaviour: 'correct' }, shieldPath, shieldPath.marks.merge - 2, 2);
    for (const path of otherPaths().filter((q) => q.arm !== right && q.ringLane === 0)) {
      const s = sAtBearing(path, shield.geo.bearing, path.marks.merge, path.marks.diverge);
      if (s === null || s - 10 < path.marks.merge) continue;
      placeAt({ colour: 'White', signalBehaviour: 'none' }, path, s - 10, 4);
      break;
    }
    return shield.id;
  }

  // A car that has just joined from an arm further round, honestly signalling right. comes = true: from the
  // farthest arm, its true path passes the player's entry. comes = false: from the arm on the player's left,
  // it turns off at the player's road, so its right signal does not mean it reaches the player.
  function injectFarSignaller(comes) {
    clearTraffic({ keepApproach: true });
    const n = layout.arms.length;
    const p = layout.player.arm;
    const arms = comes ? [(p + 2) % n, (p + 1) % n] : [(p + 1) % n];
    for (const arm of arms) {
      if (arm === (p - 1 + n) % n) continue;
      for (const exitArm of Object.keys(layout.arms[arm].exits).map(Number)) {
        const path = pathFor(arm, 0, exitArm, 0);
        if (path.direction !== 'right' || (entryConflicts(playerVehicle.path, path).length > 0) !== comes) continue;
        const s = path.marks.merge + 2;
        const prof = speedProfile(path, VEHICLE_TYPES.van.latComfort);
        return placeAt({ type: 'van', colour: 'White', signalBehaviour: 'correct' }, path, s, allowedAt(path, prof, s)).id;
      }
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
  const warmed = clock;
  clock = 0;
  history.clear();
  lastEntry.clear();
  spawnLog.length = 0;
  for (const v of vehicles) if (v.enteredAt !== null) v.enteredAt -= warmed;
  for (const p of [...pending, pendingBus]) if (p) p.at = Math.max(0, p.at - warmed);
  if (player) insertPlayer();

  return {
    get t() { return clock; },
    layout,
    density,
    get player() { return playerVehicle && stateOf(playerVehicle); },
    get vehicleCount() { return vehicles.length; },
    spawns: () => spawnLog.slice(),
    step,
    snapshot,
    replay: () => history.frames(),
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
