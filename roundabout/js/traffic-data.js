/**
 * Static traffic data: vehicle dimensions, colours, driver types, signal mix, spawn rates.
 * Dimensions in metres (length x width x height), accelerations in m/s^2.
 */

export const VEHICLE_TYPES = {
  hatch: { length: 4.05, width: 1.75, height: 1.45, wheelbase: 2.55, accel: 1.8, latComfort: 2.6 }, // VW Polo Mk6
  estate: { length: 4.7, width: 1.8, height: 1.5, wheelbase: 2.7, accel: 1.6, latComfort: 2.5 },
  van: { length: 5.4, width: 2.0, height: 2.5, wheelbase: 3.3, accel: 1.3, latComfort: 2.2 },
  bus: { length: 11.0, width: 2.55, height: 4.3, wheelbase: 5.9, accel: 1.0, latComfort: 1.8 },
  lorry: { length: 10.0, width: 2.55, height: 3.8, wheelbase: 5.8, accel: 0.9, latComfort: 1.8 }, // rigid HGV <= 12 m
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
  cautious: { weight: 0.25, T: 1.6, s0: 2.5, gapShift: 0.6, accelScale: 0.85, speedScale: 0.92 },
  normal: { weight: 0.55, T: 1.3, s0: 2.0, gapShift: 0, accelScale: 1, speedScale: 1 },
  assertive: { weight: 0.2, T: 1.0, s0: 1.6, gapShift: -0.6, accelScale: 1.15, speedScale: 1.05 },
};

/**
 * Signal behaviour vs true intent. UK survey: ~65% signal correctly, ~20-33% not at all, ~13% signal left
 * wrongly when going straight, ~9% late. The dishonest share keeps those proportions; honesty scales by tier.
 */
const DISHONEST = { none: 0.25, wrongLeft: 0.13, lateLeft: 0.09, leftNotCancelled: 0.04 };
export function signalMix(honesty) {
  const total = Object.values(DISHONEST).reduce((a, b) => a + b, 0);
  const mix = { correct: honesty };
  for (const [k, w] of Object.entries(DISHONEST)) mix[k] = ((1 - honesty) * w) / total;
  return mix;
}

// Arrivals per arm per second; types by tier. Medium also gets a scheduled bus.
export const TRAFFIC = {
  mini: { rate: 0.035, types: { hatch: 0.55, estate: 0.3, van: 0.15 }, busEvery: null },
  easy: { rate: 0.05, types: { hatch: 0.55, estate: 0.3, van: 0.15 }, busEvery: null },
  medium: { rate: 0.085, types: { hatch: 0.5, estate: 0.27, van: 0.23 }, busEvery: [40, 80] },
  hard: { rate: 0.09, types: { hatch: 0.44, estate: 0.22, van: 0.18, lorry: 0.11, bus: 0.05 }, busEvery: null },
};

export const INDICATOR_HZ = 1.5; // R48: 60-120 flashes per minute
