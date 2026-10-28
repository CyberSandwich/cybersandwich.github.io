/**
 * Static traffic data: vehicle dimensions, colours, driver types, signal mix, spawn rates.
 * Dimensions in metres (length x width x height), accelerations in m/s^2.
 */

// accel (pull-away) and latComfort (cornering) are engineering estimates of typical UK driving, not sourced
// figures; never quote them to the learner.
export const VEHICLE_TYPES = {
  hatch: { length: 4.05, width: 1.75, height: 1.45, wheelbase: 2.55, accel: 2.3, latComfort: 3.5 }, // VW Polo Mk6
  estate: { length: 4.7, width: 1.8, height: 1.5, wheelbase: 2.7, accel: 2.1, latComfort: 3.4 },
  van: { length: 5.4, width: 2.0, height: 2.5, wheelbase: 3.3, accel: 1.7, latComfort: 2.8 },
  bus: { length: 11.0, width: 2.55, height: 4.3, wheelbase: 5.9, accel: 1.1, latComfort: 2.1 },
  lorry: { length: 10.0, width: 2.55, height: 3.8, wheelbase: 5.8, accel: 1.0, latComfort: 2.0 }, // rigid HGV <= 12 m
};

export const LARGE_TYPES = new Set(['bus', 'lorry']);

export const COLOURS = {
  Grey: '#6b6f75', Black: '#1d1f22', White: '#f2f2f0', Blue: '#2a4f8f', Silver: '#c0c4c8',
  Red: '#a82a2a', Green: '#2f5d3a', Orange: '#c8642a',
};
const CAR_COLOUR_WEIGHTS = { Grey: 22, Black: 18, White: 17, Blue: 15, Silver: 12, Red: 9, Green: 4, Orange: 3 };
const VAN_COLOUR_WEIGHTS = { White: 70, Silver: 12, Grey: 10, Blue: 8 };

export function colourFor(rng, type) {
  if (type === 'bus') return 'Red';
  if (type === 'lorry') return 'White';
  return rng.weighted(type === 'van' ? VAN_COLOUR_WEIGHTS : CAR_COLOUR_WEIGHTS);
}

/**
 * Gap acceptance: critical gap ~ N(4.5, 0.6) s and follow-up ~ 2.7 s are HCM (US) figures, not UK-measured;
 * there is no published UK equivalent, so treat them as placeholders. Driver types shift them.
 */
export const CRITICAL_GAP = { mean: 4.5, sd: 0.6, min: 3.0 };
export const FOLLOW_UP = { mean: 2.7, sd: 0.3, min: 2.0 };

export const DRIVER_TYPES = {
  cautious: { weight: 0.15, T: 1.6, s0: 2.5, gapShift: 0.6, accelScale: 0.85, speedScale: 0.92, latScale: 0.9 },
  normal: { weight: 0.5, T: 1.3, s0: 2.0, gapShift: 0, accelScale: 1, speedScale: 1, latScale: 1 },
  assertive: { weight: 0.35, T: 1.0, s0: 1.6, gapShift: -0.6, accelScale: 1.2, speedScale: 1.05, latScale: 1.1 },
};

/**
 * Signal behaviour vs true intent, as shares of all cars (tasks/roundabout-status/liar-research.md). Correct
 * stays at the Tempcover 2025 survey's 65%. The rest leans to no signal and late signals: observed counts (AA
 * Streetwatchers, 33% of turns not indicated) outweigh the survey's self-reported 13% who signal left going
 * straight on, which is a misunderstanding on approach more than a left signal on the ring. So none 17%,
 * lateLeft 11%, wrongLeft 4%; leftNotCancelled (2%) and rightEarly (signals right, leaves at an earlier exit,
 * 1%) are estimates with no published figure. Every tier and drill uses the same mix.
 *   none  no signal at all          wrongLeft  left while coming round     lateLeft  left only at the exit
 *   leftNotCancelled  left throughout       rightEarly  right until it peels off, no left signal
 */
export const HONESTY = 0.65;
export const DISHONEST = { none: 0.17, wrongLeft: 0.04, lateLeft: 0.11, leftNotCancelled: 0.02, rightEarly: 0.01 };
export function signalMix(honesty = HONESTY) {
  const total = Object.values(DISHONEST).reduce((a, b) => a + b, 0);
  const mix = { correct: honesty };
  for (const [k, w] of Object.entries(DISHONEST)) mix[k] = ((1 - honesty) * w) / total;
  return mix;
}

/**
 * The player's own arm gets ownArm x the rate (it is the minor road). Routes from the other arms are weighted
 * by how they meet the player's entry, per density (light uses normal's):
 *   passes  routes that cross the player's entry: the traffic it has to judge
 *   into    routes that turn into the player's road: they use up the entry capacity of the arms that feed
 *           the player's entry without ever crossing it, so heavy keeps them rare
 */
export const PLAYER_FACING = {
  ownArm: 0.5,
  routes: { normal: { passes: 2, into: 1 }, heavy: { passes: 6, into: 0.15 } },
};

/**
 * TRAFFIC[tier].rate is arrivals per arm per second at 'normal' (DENSITY scales it); TRAFFIC[tier].heavy is
 * the rate at 'heavy'. Normal sits close to what each tier clears without arm queues growing. Heavy runs the
 * other arms at or past capacity, so it is tuned at the player's line instead (tests/test-roundabout-sim.js):
 * few clear gaps, yet a gap-accepting driver still gets out (median wait under 40 s). No approach lane ever holds
 * more than LANE_QUEUE_CAP vehicles that have not joined: an arrival due on a full lane waits its turn, so
 * queues cannot grow without bound. Medium's scheduled bus and hard's lorries run at every density but 'none'.
 */
export const LANE_QUEUE_CAP = 5;
const DENSITY = { none: 0, light: 0.5, normal: 1 };
export function arrivalRate(tier, density = 'normal') {
  return density === 'heavy' ? TRAFFIC[tier].heavy : TRAFFIC[tier].rate * DENSITY[density];
}

/**
 * Drill presets the HUD can offer. Each lists sim options; autoGo means the HUD taps Go itself.
 *   exitPractice: traffic as set, Go handled for you (on an ok gap): practise only the exit.
 *   liarCars: the real signal mix, plus a liar (behaviour drawn from DISHONEST's wrong-signal shares) timed
 *             to arrive 3-6 s after you reach the line, every liarEvery s while you wait.
 */
export const PRESETS = {
  exitPractice: { autoGo: true },
  liarCars: { liarLag: [3, 6], liarEvery: 12 },
};

export const TRAFFIC = {
  mini: { rate: 0.05, heavy: 0.13, types: { hatch: 0.55, estate: 0.3, van: 0.15 }, busEvery: null },
  easy: { rate: 0.08, heavy: 0.26, types: { hatch: 0.55, estate: 0.3, van: 0.15 }, busEvery: null },
  medium: { rate: 0.095, heavy: 0.13, types: { hatch: 0.5, estate: 0.27, van: 0.23 }, busEvery: [40, 80] },
  hard: { rate: 0.085, heavy: 0.24, types: { hatch: 0.44, estate: 0.22, van: 0.18, lorry: 0.11, bus: 0.05 }, busEvery: null },
};

export const INDICATOR_HZ = 1.5; // R48: 60-120 flashes per minute
