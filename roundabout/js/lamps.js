/**
 * Vehicle lamps, pure: which lamps a vehicle shows and how each one looks. No three.js, no DOM; vehicles.js
 * draws from it and tests/test-roundabout-ui.js proves the mapping.
 *
 *   lampsFor(view, { forceOn, tails }) -> { indL, indR, brake, tail }
 *     view     a sim VehicleView { indicator, lamp, brake }
 *     forceOn  the freeze holds this vehicle's indicator lit whatever the blink phase (only if one is set)
 *     tails    the scene has its lights on (dark theme): steady dim tail lights
 *   LAMP      colour (sRGB 0..1), size (m), softness and placement of each lamp kind
 *
 * Indicators are the cue the trainer teaches, so nothing else may read as one: amber only ever comes from a
 * real indicator; brake and tail lights are red, steady, inboard of the indicators and softer edged.
 */

const rgb = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);

export const LAMP = {
  indicator: { colour: rgb('#FF9A1F'), size: 0.62, soft: 0 }, // at the outer corners (meta.json indicators)
  brake: { colour: rgb('#E0202A'), size: 0.8, soft: 1, intensity: 1 },
  tail: { colour: rgb('#E0202A'), size: 0.8, soft: 1, intensity: 0.32 },
  // Brake and tail sit this far inboard of (m), and above (m), the rear indicator, so the two never share a spot.
  inboard: 0.26,
  raise: 0.06,
};

export function lampsFor(view, { forceOn = false, tails = false } = {}) {
  const lit = Boolean(view.indicator) && (Boolean(view.lamp) || forceOn);
  const brake = Boolean(view.brake);
  return {
    indL: lit && view.indicator === 'left',
    indR: lit && view.indicator === 'right',
    brake,
    tail: tails && !brake,
  };
}
