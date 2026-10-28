/**
 * The driver's head, pure: frame composition per aspect, where the cab parts sit, projection into the frame,
 * mirror refresh order and the automatic head-look scheduler. No three.js, no DOM; cockpit.js draws from it.
 *
 * Car frame: metres, x right, y up, -z forward, origin on the ground under the car's reference point.
 * Angles: yaw + = left, pitch + = up (radians). A "view" is { yaw, pitch } of the head.
 *
 *   povFor(aspect)                    -> Pov { hFov, vFov (deg), tanH, tanV, shift, horizon }
 *     horizontal FOV is the invariant (~90 deg, ~100 ultrawide); portrait trades it for vertical up to 100 deg.
 *     The horizon is placed by an off-centre frustum (camera.setViewOffset), never by pitching the head.
 *   project(p, view, pov)             -> { x, y } frame fractions from the top-left, or null behind the eye
 *   rearMirrorX(pov, width, height)   -> x of the rear-view glass: its true centreline mount when the frame
 *                                        holds it, slid toward the driver only as far as the frame needs
 *   mirrorPose(m, x?)                 -> { centre, normal, corners } of a mirror glass (CAB.rear/left/right)
 *   panelPose(m)                      -> the same for a panel facing the eye (CAB.speedo)
 *   pickMirror(ages, visible, period) -> index of the mirror to refresh this frame, or -1
 *   carPoint(car, x, z, y?)           -> a world point in the car frame; car = { x, z, heading }
 *   aim(p)                            -> the view that centres car-frame point p on the optical axis
 *   rightGaze(pointYaw, mirrorYaw, pov) -> head yaw for a right look at circulating traffic
 *
 *   const look = createHeadLook({ gentle })
 *   look.update(input, dt) -> { yaw, pitch, rate, key, zoom }   target view, the spring frequency to ease to it
 *                                                              (1/s, for easeTo), and camera zoom (1 except
 *                                                              the interior and left wing glances, LOOK.mirrorZoom)
 *   easeTo(s, to, w, dt) -> s         one critically damped step of s = { x, v } in place; head yaw, pitch and
 *                                      the mirror zoom all ease with it
 *   look.mirrors()         start the mirror-signal glances (interior, left wing, then the exit)
 *   look.reset()           at the start of every run (cockpit.resetLook); the only reset: a drive-less gap
 *                          mid-run (replay) keeps the scan where it was
 *   input = { phase, dist, goWindowOpen, steer, pov, focus?, points: { right, ahead, left, exit },
 *             signs: [{ id, dist, yaw, pitch }], mirrors: { rear, left, right } }
 *     phase: player phase or null (not driving); dist: m to the stop line; points/mirrors: views (aim()) or null.
 */

import { dir, wrapPi, indexAt } from './geom.js';

const DEG = Math.PI / 180;

// Cab geometry shared by the drawing (cockpit.js) and the frame tests. Polo Mk6, right-hand drive.
export const CAB = {
  // Eye at the top of a realistic seat range (1.12-1.20 m): road shows from ~7.3 m ahead over the dash crest.
  eye: [0.37, 1.2, 0.15],
  // Interior mirror glass on the windscreen centreline (x solved per aspect, see rearMirrorX).
  rear: { y: 1.3, z: -0.35, w: 0.245, h: 0.062, xMax: 0.3, aim: [0, -0.04, 1], widen: 1 },
  // Wing glasses on the door fronts, ahead of the A-pillar bases. Passenger side convex (UK), driver side near flat.
  // Aimed a little down so the road and the car behind fill the glass rather than sky. The driver's glass sits
  // close to the eye, so its true-size view is narrow: aimed only just below the horizon and widened, it shows
  // the lane and traffic behind rather than a patch of tarmac.
  left: { at: [-0.99, 1.04, -0.69], w: 0.16, h: 0.1, aim: [-0.1, -0.09, 1], widen: 1.9 },
  right: { at: [0.99, 1.04, -0.69], w: 0.16, h: 0.1, aim: [0.12, -0.035, 1], widen: 1.7 },
  // Speedometer in a hood above the wheel rim, so no spoke or the rim ever covers it.
  speedo: { at: [0.37, 1.0, -0.53], w: 0.14, h: 0.048 },
  wheel: { at: [0.37, 0.8, -0.33], tilt: -0.42, r: 0.185, tube: 0.021 },
  wheelbase: 2.55,
  // Dash top profile, [z, y]: windscreen base, crest, driver edge, as two quadratic curves (shape in cockpit.js).
  dash: { far: [-1.0, 0.95], c1: [-0.78, 1.0], crest: [-0.6, 0.985], c2: [-0.48, 0.97], near: [-0.46, 0.9] },
};

// Bonnet surface: u 0..1 across, v 0 at the windscreen to 1 at the nose, with a slight crown.
export function bonnetPoint(u, v) {
  const halfW = 0.8 - 0.16 * v * v;
  const x = (u - 0.5) * 2 * halfW;
  return [x, 0.935 - 0.13 * v * v + 0.025 * (1 - ((u - 0.5) * 2) ** 2), -0.98 - v * 1.08];
}

export const FRAME = {
  hFov: 90, // deg, landscape and desktop
  hFovWide: 100, // deg, reached by ultrawide
  wideFrom: 1.8, // aspect where widening starts ...
  wideTo: 2.4, // ... and ends
  vFovMax: 100, // deg: portrait gives up horizontal FOV past this
  horizonPortrait: 0.4, // fraction from the top
  horizonLandscape: 0.45,
  portraitAt: 0.75, // aspect at or below which the horizon is fully portrait ...
  landscapeAt: 1.25, // ... and at or above which it is fully landscape
  margin: 0.02, // frame fraction a mirror keeps clear of the edge
  hudCorner: 72, // px: the round Back / Settings buttons' top-corner squares
  rearYawSlack: 0.08, // rad: the curve lead's right limit, inside which the interior mirror stays whole
};

export const LOOK = {
  signRead: [12, 38], // m ahead of the eye where a sign gets its one glance
  signHold: 1.1, // s
  armsAt: 50, // m to the line: one look at the ahead and left arms, before the right scan
  armHold: 1.0,
  rightAt: 28, // m to the line: scanning right starts here or when the Go window opens
  // The line scan is right, one brief left check, then right for the rest of the wait: traffic comes from the
  // right, so a driver who has checked left once keeps watching right.
  firstRightHold: 2.4, // s
  leftHold: 1.0, // s, the one left check
  leftMax: 0.7, // rad: the left check turns no further than this; the left arm is still in the frame
  goRightHold: 0.7, // s: the last right look as the car pulls away, when Go came while the head was not right
  // s: interior mirror, left wing mirror, toward the exit. The first two fit the shortest leaving phase (~1.6 s
  // on a first exit), so the exit glance always comes before the ring is left.
  mirrorHolds: [0.65, 0.75, 1.0],
  focusHold: 2.2, // s a guided focus holds unless renewed
  focusRight: 0.2, // rad: a focus this far right of ahead counts as a look right (for the pull-away look)
  focusRetarget: 1.5, // s: at the line a right focus re-aims the held pose at most this often
  rightScreenX: 0.3, // NDC where a right look puts the upstream point: room for traffic beyond it
  rightEdgeX: 0.45, // NDC the point may drift to so the right wing mirror stays in the frame
  mirrorEdgeX: 0.9, // NDC a mirror's far edge may reach
  rightUpstream: 25, // m: the right look aims at the ring this far upstream of the merge
  exitAhead: 8, // m past where the path leaves the ring: the exit glance's point
  leadDistance: 10, // m: the curve look-ahead
  leadMax: 0.5, // rad, leading left; leading right stops at FRAME.rearYawSlack
  // Natural frequency (1/s) of the critically damped head spring (easeTo): w lands a glance 95% in 4.74 / w s
  // with no velocity jump; peak speed is w * swing / e. Fast eases cause headaches.
  // mirror: the small, quick mirror-signal glances (they must fit the leaving phase).
  rate: { glance: 3.6, settle: 4.2, drift: 2, mirror: 5 },
  gentle: 0.7, // reduced motion: same glances, softer spring
  // Camera zoom during the interior and left wing mirror glances, so a true-size glass can be read on a phone.
  mirrorZoom: 1.6,
};

// One step of a critically damped spring s = { x, v } toward `to` at natural frequency w, in place (the cab runs
// it every frame). Exact for any dt, so it never overshoots or goes unstable on a slow frame; v stays continuous
// when `to` jumps.
export function easeTo(s, to, w, dt) {
  const d = s.x - to;
  const c = s.v + w * d;
  const e = Math.exp(-w * dt);
  s.x = to + (d + c * dt) * e;
  s.v = (s.v - w * c * dt) * e;
  return s;
}

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const smooth = (a, b, v) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const addv = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a) => mul(a, 1 / Math.hypot(a[0], a[1], a[2]));

export function povFor(aspect) {
  const a = clamp(aspect, 0.2, 5);
  let hFov = FRAME.hFov + (FRAME.hFovWide - FRAME.hFov) * smooth(FRAME.wideFrom, FRAME.wideTo, a);
  let vFov = 2 * Math.atan(Math.tan((hFov * DEG) / 2) / a) / DEG;
  if (vFov > FRAME.vFovMax) {
    vFov = FRAME.vFovMax;
    hFov = 2 * Math.atan(Math.tan((vFov * DEG) / 2) * a) / DEG;
  }
  const horizon = FRAME.horizonPortrait + (FRAME.horizonLandscape - FRAME.horizonPortrait) * smooth(FRAME.portraitAt, FRAME.landscapeAt, a);
  return { aspect: a, hFov, vFov, tanH: Math.tan((hFov * DEG) / 2), tanV: Math.tan((vFov * DEG) / 2), shift: 0.5 - horizon, horizon };
}

// Inverse of the head rotation (three.js order YXZ: yaw, then pitch) applied to an eye-relative vector.
function toHead(d, yaw, pitch) {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const x = cy * d[0] - sy * d[2];
  const z1 = sy * d[0] + cy * d[2];
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  return [x, d[1] * cp + z1 * sp, -d[1] * sp + z1 * cp];
}

export function project(p, view, pov, eye = CAB.eye) {
  const [x, y, z] = toHead(sub(p, eye), view.yaw, view.pitch);
  if (z > -1e-6) return null;
  return { x: 0.5 + x / -z / (2 * pov.tanH), y: 0.5 - pov.shift - y / -z / (2 * pov.tanV) };
}

export function aim(p, eye = CAB.eye) {
  const d = sub(p, eye);
  return { yaw: Math.atan2(-d[0], -d[2]), pitch: Math.atan2(d[1], Math.hypot(d[0], d[2])) };
}

// The cab's top silhouette straight ahead of the eye (dash crest or bonnet, whichever stands higher in view),
// the road it hides, and the frame fraction left for road between it and the horizon at rest.
export function roadBand(pov, eye = CAB.eye) {
  const quad = (a, c, b, t) => a.map((_, i) => (1 - t) ** 2 * a[i] + 2 * (1 - t) * t * c[i] + t * t * b[i]);
  const { far, c1, crest, c2, near } = CAB.dash;
  const pts = [];
  for (let i = 0; i <= 20; i++) {
    const [z1, y1] = quad(far, c1, crest, i / 20);
    const [z2, y2] = quad(crest, c2, near, i / 20);
    pts.push([eye[0], y1, z1], [eye[0], y2, z2]);
  }
  const halfW = (v) => 0.8 - 0.16 * v * v;
  for (let i = 0; i <= 20; i++) {
    const v = i / 20;
    pts.push(bonnetPoint(0.5 + eye[0] / (2 * halfW(v)), v));
  }
  const elev = Math.max(...pts.map((p) => aim(p, eye).pitch));
  const nearest = eye[1] / Math.tan(-elev);
  return { elev, nearest, band: Math.tan(-elev) / (2 * pov.tanV) };
}

// The glass faces the bisector of "to the eye" and "where it should show", so the eye sees along `aim`.
export function mirrorPose(m, x) {
  const centre = m.at ?? [x, m.y, m.z];
  const normal = norm(addv(norm(sub(CAB.eye, centre)), norm(m.aim)));
  const u = norm(cross([0, 1, 0], normal));
  const v = cross(normal, u);
  const corners = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([i, j]) => addv(centre, addv(mul(u, (i * m.w) / 2), mul(v, (j * m.h) / 2))));
  return { centre, normal, corners };
}

// A flat panel (the speedometer) square on to the eye.
export function panelPose(m) {
  return mirrorPose({ ...m, aim: sub(CAB.eye, m.at) });
}

// Reflected eye and view direction for a mirror camera; fovV in degrees.
export function mirrorCamera(m, pose) {
  const n = pose.normal;
  const e = sub(CAB.eye, pose.centre);
  const pos = sub(CAB.eye, mul(n, 2 * dot3(e, n)));
  const d = sub(pose.centre, CAB.eye);
  const look = sub(d, mul(n, 2 * dot3(d, n)));
  const dist = Math.hypot(d[0], d[1], d[2]);
  return { pos, look: norm(look), fovV: (2 * Math.atan(m.h / 2 / dist) * m.widen) / DEG, aspect: m.w / m.h };
}

export function inFrame(points, view, pov, margin = FRAME.margin) {
  return points.every((p) => {
    const q = project(p, view, pov);
    return q && q.x >= margin && q.x <= 1 - margin && q.y >= margin && q.y <= 1 - margin;
  });
}

// Pixel rectangle [l, t, r, b] of points in the frame, for keep-out checks.
export function rectOf(points, view, pov, width, height) {
  const q = points.map((p) => project(p, view, pov));
  if (q.some((v) => !v)) return null;
  const xs = q.map((v) => v.x * width);
  const ys = q.map((v) => v.y * height);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export const overlaps = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];

// The glass stays whole from rest to the most the head leads right (FRAME.rearYawSlack, which caps leadYaw);
// on frames too narrow for that within xMax, whole at rest only.
export function rearMirrorX(pov, width, height) {
  const corner = [0, 0, FRAME.hudCorner, FRAME.hudCorner];
  const fits = (views) => {
    for (let x = 0; x < CAB.rear.xMax; x += 0.005) {
      const { corners } = mirrorPose(CAB.rear, x);
      if (!views.every((yaw) => inFrame(corners, { yaw, pitch: 0 }, pov))) continue;
      if (!overlaps(rectOf(corners, { yaw: 0, pitch: 0 }, pov, width, height), corner)) return x;
    }
    return null;
  };
  return fits([0, -FRAME.rearYawSlack]) ?? fits([0]) ?? CAB.rear.xMax;
}

export function pickMirror(ages, visible, period) {
  let best = -1;
  for (let i = 0; i < ages.length; i++) {
    if (visible[i] && ages[i] >= period && (best < 0 || ages[i] > ages[best])) best = i;
  }
  return best;
}

export function carPoint(car, x, z, y = 0) {
  const dx = x - car.x;
  const dz = z - car.z;
  const c = Math.cos(car.heading);
  const s = Math.sin(car.heading);
  // Forward is compass `heading` (x east, z south); car-frame right is heading + 90 deg.
  return [dx * c + dz * s, y, -(dx * s - dz * c)];
}

// Head yaw for a right look: the upstream point sits right of centre with room for traffic beyond it, and the
// head stops short when that also keeps the right wing mirror in the frame. Narrow frames turn further.
export function rightGaze(pointYaw, mirrorYaw, pov) {
  const atScreen = (ndc) => pointYaw + Math.atan(ndc * pov.tanH);
  const preferred = atScreen(LOOK.rightScreenX);
  if (mirrorYaw === null || mirrorYaw === undefined) return preferred;
  // Any gaze at or left of this (larger yaw) shows the whole glass, whose far edge is ~5 deg left of its centre.
  const showsMirror = mirrorYaw + 5 * DEG - Math.atan(LOOK.mirrorEdgeX * pov.tanH);
  if (preferred >= showsMirror) return preferred;
  // Turning less moves the point right on screen; it may go as far as rightEdgeX, never off the traffic.
  return showsMirror <= atScreen(LOOK.rightEdgeX) ? showsMirror : preferred;
}

// World points the scheduler looks at for one layout and player path ({ x, z, y } each; signs carry an id).
export function routePoints(layout, path) {
  const pl = layout.player;
  const arms = layout.arms;
  const bm = path.bearing[indexAt(path, path.marks.merge)];
  const r = layout.circulatory.laneRadii[0];
  const up = dir(bm - Math.min(1.3, LOOK.rightUpstream / r));
  const offAxis = (a) => Math.abs(wrapPi(a.bearing - arms[pl.arm].bearing - Math.PI));
  const ahead = arms.filter((a) => a.index !== pl.arm).reduce((best, a) => (offAxis(a) < offAxis(best) ? a : best));
  const left = arms[(pl.arm + 1) % arms.length];
  const gw = (a) => ({ x: a.giveWay[0].x, z: a.giveWay[0].z, y: 1 });
  const ie = indexAt(path, path.marks.exitRing + LOOK.exitAhead);
  return {
    right: { x: up[0] * r, z: up[1] * r, y: 1 },
    ahead: gw(ahead),
    left: gw(left),
    exit: { x: path.x[ie], z: path.z[ie], y: 1 },
    signs: layout.signs.filter((s) => s.arm === pl.arm && s.distance >= 15).map((s) => ({ id: s.code, x: s.x, z: s.z, y: 2 })),
  };
}

// The scheduler's input for one frame. view = the player's VehicleView; drive as cockpit.setDrive; mirrors =
// aims of the glasses; focusPoint = the guided focus as a world point or null.
export function lookInputFor({ view, drive, route, pov, mirrors, focusPoint = null }) {
  const car = { x: view.x, z: view.z, heading: view.heading };
  const at = (p) => (p ? aim(carPoint(car, p.x, p.z, p.y)) : null);
  const input = {
    phase: drive?.phase ?? null,
    dist: drive?.distToLine ?? Infinity,
    goWindowOpen: !!drive?.goWindowOpen,
    steer: view.steer ?? 0,
    pov,
    focus: at(focusPoint),
    points: {},
    signs: [],
    mirrors,
  };
  if (route) {
    for (const k of ['right', 'ahead', 'left', 'exit']) input.points[k] = at(route[k]);
    input.signs = route.signs.map((s) => {
      const p = carPoint(car, s.x, s.z, s.y);
      return { id: s.id, dist: CAB.eye[2] - p[2], ...aim(p) };
    });
  }
  return input;
}

export function leadYaw(steer) {
  return clamp((LOOK.leadDistance * Math.tan(steer)) / (2 * CAB.wheelbase), -FRAME.rearYawSlack, LOOK.leadMax);
}

export function createHeadLook({ gentle = false } = {}) {
  let t = 0;
  let phase = null;
  let scanAt = null;
  let msmAt = null;
  let glance = null; // { key, until, next? }
  let armsDone = false;
  let lastOnRight = false; // the last output looked right (a right look or a right focus)
  let lastRightUntil = 0; // the pull-away right look runs until this t
  let focusPose = null; // { yaw, pitch, at }: the latched right-hold pose of a focus at the line
  const signsDone = new Set();
  const k = gentle ? LOOK.gentle : 1;

  function reset() {
    t = 0;
    phase = null;
    scanAt = null;
    msmAt = null;
    glance = null;
    armsDone = false;
    lastOnRight = false;
    lastRightUntil = 0;
    focusPose = null;
    signsDone.clear();
  }

  const out = (view, rate, key) => {
    const yaw = view?.yaw ?? 0;
    lastOnRight = key === 'right' || (key === 'focus' && yaw <= -LOOK.focusRight);
    return {
      yaw, pitch: view?.pitch ?? 0, rate: rate * k, key,
      zoom: key === 'rear' || key === 'leftWing' ? LOOK.mirrorZoom : 1,
    };
  };

  // Which beat of the line scan `since` seconds into it falls in.
  const rhythm = (since) => (since >= LOOK.firstRightHold && since < LOOK.firstRightHold + LOOK.leftHold ? 'left' : 'right');

  function target(key, input) {
    const p = input.points;
    if (key === 'right') {
      if (!p.right) return null;
      return { yaw: rightGaze(p.right.yaw, input.mirrors.right?.yaw ?? null, input.pov), pitch: 0 };
    }
    if (key === 'ahead') return p.ahead ?? { yaw: 0, pitch: 0 };
    if (key === 'left') {
      const v = p.left ?? p.ahead ?? { yaw: 0, pitch: 0 };
      return v.yaw > LOOK.leftMax ? { yaw: LOOK.leftMax, pitch: v.pitch } : v;
    }
    if (key === 'rear' || key === 'leftWing') return input.mirrors[key === 'rear' ? 'rear' : 'left'];
    if (key === 'exit') return p.exit;
    if (key.startsWith('sign:')) return input.signs.find((s) => 'sign:' + s.id === key) ?? null;
    return null;
  }

  function update(input, dt) {
    t += dt;
    // Only reset() starts a run over: phase null mid-run (a replay at the line) must not replay the arms check.
    if (input.phase !== phase) {
      if (input.phase === 'leaving' && (msmAt === null || t - msmAt > 1)) msmAt = t;
      // Go is the player's and may come mid left check: a driver always takes a last look right moving off.
      lastRightUntil = input.phase === 'going' && !lastOnRight ? t + LOOK.goRightHold : 0;
      phase = input.phase;
      glance = null;
    }
    const lead = { yaw: leadYaw(input.steer ?? 0), pitch: 0 };

    // Mirror-signal glances outrank everything, guided focus included: they are the lesson on the way out.
    if (msmAt !== null) {
      const [a, b, c] = LOOK.mirrorHolds;
      const s = t - msmAt;
      const key = s < a ? 'rear' : s < a + b ? 'leftWing' : s < a + b + c ? 'exit' : null;
      const v = key && target(key, input);
      if (v) return out(v, key === 'exit' ? LOOK.rate.glance : LOOK.rate.mirror, key);
      if (!key) msmAt = null;
    }
    // While scanning, the rhythm owns the head: a focus only replaces the right hold (see the scan below). The scan
    // starts on distance or the Go window alone, so a focus running then cannot postpone it.
    const approaching = phase === 'approach' || phase === 'waiting';
    if (approaching && scanAt === null && (input.dist <= LOOK.rightAt || input.goWindowOpen || phase === 'waiting')) scanAt = t;
    const scanning = approaching && scanAt !== null;
    if (!input.focus) focusPose = null;
    else if (!scanning) return out(input.focus, LOOK.rate.glance, 'focus');
    // After the mirror glances the head stays on the way out until the car has left the ring.
    if (phase === 'leaving' && input.points.exit) return out(input.points.exit, LOOK.rate.drift, 'exit');

    if (phase === 'approach' || phase === 'waiting') {
      // A glance under way (sign, arms check) finishes first; the scan starts after it.
      if (glance && t < glance.until) {
        const v = target(glance.key, input);
        if (v) return out(v, LOOK.rate.glance, glance.key);
      }
      if (glance?.next && t >= glance.until) {
        glance = { key: glance.next, until: t + LOOK.armHold };
        return out(target(glance.key, input) ?? lead, LOOK.rate.glance, glance.key);
      }
      glance = null;
      // The arms check always happens once, whatever the Go window does: cars there signalling right come past.
      if (!armsDone && input.dist <= LOOK.armsAt) {
        armsDone = true;
        const twoArms = input.points.left && input.points.ahead && Math.abs(input.points.left.yaw - input.points.ahead.yaw) > 0.15;
        glance = { key: 'ahead', until: t + LOOK.armHold, next: twoArms ? 'left' : null };
        return out(target('ahead', input), LOOK.rate.glance, 'ahead');
      }
      if (scanning) {
        const key = rhythm(t - scanAt);
        // A guide focus takes the right hold's place (only the one left check outranks it), holding one pose
        // re-aimed at most every focusRetarget s, so a guide switching between cars never makes the head hunt.
        if (key === 'right' && input.focus) {
          if (!focusPose || t - focusPose.at >= LOOK.focusRetarget) focusPose = { yaw: input.focus.yaw, pitch: input.focus.pitch, at: t };
          return out(focusPose, LOOK.rate.glance, 'focus');
        }
        const v = target(key, input);
        return out(v ?? lead, LOOK.rate.glance, v ? key : 'lead');
      }
      const sign = input.signs.find((s) => !signsDone.has(s.id) && s.dist >= LOOK.signRead[0] && s.dist <= LOOK.signRead[1]);
      if (sign) {
        signsDone.add(sign.id);
        glance = { key: 'sign:' + sign.id, until: t + LOOK.signHold };
        return out(sign, LOOK.rate.glance, glance.key);
      }
      return out(lead, LOOK.rate.drift, 'lead');
    }
    if (phase === 'going') {
      const right = t < lastRightUntil && target('right', input);
      return right ? out(right, LOOK.rate.glance, 'right') : out(lead, LOOK.rate.settle, 'lead');
    }
    if (phase === 'ring' || phase === 'leaving' || phase === 'exited') return out(lead, LOOK.rate.drift, 'lead');
    return out({ yaw: 0, pitch: 0 }, LOOK.rate.drift, 'rest');
  }

  return {
    update,
    reset,
    // A held key calls this every frame: it restarts the glances only once they have finished.
    mirrors() { if (msmAt === null) msmAt = t; },
  };
}
