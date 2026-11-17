/**
 * VW Polo Mk6 (AW, 2021 facelift) geometry and kinematics. Pure: no three.js, no DOM.
 * Sources: VW UK 2021 spec guide, VW SA 2022 brochure, CarExpert (length, widths, wheelbase, tracks, turning circle).
 *
 * Frame: metres, plane coords (x, y), y to the left of +x. A pose { x, y, h } is the centre of the rear axle,
 * h the heading in radians anticlockwise from +x. Body-local coords: u forward from the rear axle, v to the left.
 * steer is a fraction of full lock in [-1, 1], positive to the left.
 */

export const POLO = {
  length: 4.074,
  width: 1.751,
  widthMirrors: 1.964,
  wheelbase: 2.552,
  trackFront: 1.5,
  trackRear: 1.483,
  turningCircle: 10.6, // kerb to kerb, at the outer front tyre
  // Estimates: VW publishes only their sum (length - wheelbase = 1.522).
  overhangFront: 0.842,
  overhangRear: 0.68,
  tyreHalfWidth: 0.1, // estimate (195-215 mm tyres)
  // Estimates for a right-hand-drive driver, measured back from the front bumper and from the centreline.
  eyeBack: 1.9,
  shoulderBack: 2.1,
  driverRight: 0.37,
  mirrorBack: 1.55,
  lockToLockTurns: 2.7, // assumption, unsourced: drives only the on-screen steering wheel
};

const L = POLO.wheelbase;
/** Rear-axle-centre radius at full lock, from the kerb-to-kerb circle at the outer front tyre. */
export const R_MIN = Math.sqrt((POLO.turningCircle / 2) ** 2 - L ** 2) - POLO.trackFront / 2;
/** Effective (bicycle-model) road-wheel angle at full lock. */
export const DELTA_MAX = Math.atan(L / R_MIN);

const FRONT = L + POLO.overhangFront; // u of the front bumper
const REAR = -POLO.overhangRear; // u of the rear bumper
const HALF_W = POLO.width / 2;
/** u of the body's centre: a car "centred in the bay" has this point on the bay centre. */
export const CENTRE_U = (FRONT + REAR) / 2;

/** Curvature (1/m) of the rear-axle path for a steer fraction; signed like steer. */
export function curvature(steer) {
  const s = Math.max(-1, Math.min(1, steer));
  return Math.tan(s * DELTA_MAX) / L;
}

/** Road-wheel angles (rad) of the front wheels for a steer fraction (Ackermann). */
export function wheelAngles(steer) {
  const k = curvature(steer);
  if (Math.abs(k) < 1e-12) return { left: 0, right: 0 };
  const r = 1 / k; // signed: positive centre on the left
  return { left: Math.atan(L / (r - POLO.trackFront / 2)), right: Math.atan(L / (r + POLO.trackFront / 2)) };
}

/** Exact arc integration of the rear-axle centre over signed distance ds (negative = reverse). */
export function step(pose, steer, ds) {
  const k = curvature(steer);
  const { x, y, h } = pose;
  if (Math.abs(k) < 1e-12) return { x: x + ds * Math.cos(h), y: y + ds * Math.sin(h), h };
  const h2 = h + k * ds;
  return { x: x + (Math.sin(h2) - Math.sin(h)) / k, y: y - (Math.cos(h2) - Math.cos(h)) / k, h: h2 };
}

/** Body-local (u, v) to plane coords. */
export function toWorld(pose, u, v) {
  const c = Math.cos(pose.h), s = Math.sin(pose.h);
  return [pose.x + u * c - v * s, pose.y + u * s + v * c];
}

/** The 4 body corners: front left, front right, rear right, rear left (a closed loop). */
export function corners(pose) {
  return [[FRONT, HALF_W], [FRONT, -HALF_W], [REAR, -HALF_W], [REAR, HALF_W]].map(([u, v]) => toWorld(pose, u, v));
}

/** Wheel centres: FL, FR, RL, RR. */
export function wheels(pose) {
  const f = POLO.trackFront / 2, r = POLO.trackRear / 2;
  return [[L, f], [L, -f], [0, r], [0, -r]].map(([u, v]) => toWorld(pose, u, v));
}

/** Left door mirror tip (the passenger side, the one a right-hand-drive driver watches for a left bay). */
export function mirrorPos(pose, side = 1) {
  return toWorld(pose, FRONT - POLO.mirrorBack, side * POLO.widthMirrors / 2);
}

/** Driver's shoulder, on the right of the centreline. */
export function shoulderPos(pose) {
  return toWorld(pose, FRONT - POLO.shoulderBack, -POLO.driverRight);
}

/** Body centre in plane coords. */
export function centrePos(pose) {
  return toWorld(pose, CENTRE_U, 0);
}

export const BODY = { FRONT, REAR, HALF_W };
