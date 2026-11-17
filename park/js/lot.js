/**
 * A UK car park aisle with two facing rows of 90 degree bays. Pure: no three.js, no DOM.
 * Sources: BPA Parking Know-How 2016 (2.4 x 4.8 m bays, 100 mm lines, 6.0 m two-way aisle),
 * IStructE Design Recommendations for Car Parks (6.95 m two-way aisle, 2.5 x 5.0 m bays).
 *
 * Frame (polo.js's): the aisle centre line is the x axis, driving is along +x, y is to the driver's left.
 * Row side s = +1 is the left row (y > 0), s = -1 the right row. Line i (0..nBays) of a row has its centre at
 * lineX(i); bay i lies between lines i and i + 1, so travelling along +x a bay's near line is i and its far line i + 1.
 */

export const LOT_DEFAULTS = { aisle: 6.0, bayW: 2.4, bayL: 4.8, nBays: 8, lineW: 0.1 };
export const AISLES = [6.0, 6.95];
export const BAYS = [{ bayW: 2.4, bayL: 4.8 }, { bayW: 2.5, bayL: 5.0 }];
/** Driving room past each end of the rows. */
export const RUN_OUT = 14;

export function makeLot(opts = {}) {
  const o = { ...LOT_DEFAULTS, ...opts };
  const pitch = o.bayW + o.lineW;
  const x0 = -(o.nBays / 2) * pitch;
  const lineX = (i) => x0 + i * pitch;
  const bayX = (i) => x0 + (i + 0.5) * pitch;
  const edgeY = (s) => s * o.aisle / 2; // the aisle edge, where a row's bay lines start
  const backY = (s) => s * (o.aisle / 2 + o.bayL); // the centre of the back line
  const rowCentreY = (s) => s * (o.aisle / 2 + o.bayL / 2);
  const xMin = lineX(0), xMax = lineX(o.nBays);

  // Painted marks as axis-aligned rectangles [xa, ya, xb, yb] (xa < xb, ya < yb).
  const rect = (xa, ya, xb, yb) => [Math.min(xa, xb), Math.min(ya, yb), Math.max(xa, xb), Math.max(ya, yb)];
  const marks = [];
  for (const s of [1, -1]) {
    for (let i = 0; i <= o.nBays; i++) {
      const x = lineX(i);
      marks.push({ kind: 'side', s, i, r: rect(x - o.lineW / 2, edgeY(s), x + o.lineW / 2, backY(s) + s * o.lineW / 2) });
    }
    marks.push({ kind: 'back', s, r: rect(xMin - o.lineW / 2, backY(s) - o.lineW / 2, xMax + o.lineW / 2, backY(s) + o.lineW / 2) });
  }
  // Dashed centre line (1 m dash, 1 m gap) and one arrow per direction (each in its own lane).
  const dashes = [];
  for (let x = xMin - RUN_OUT + 1; x + 1 <= xMax + RUN_OUT - 1; x += 2) dashes.push(rect(x, -o.lineW / 2, x + 1, o.lineW / 2));
  const arrows = [
    { x: xMin - 6, y: o.aisle / 4, h: 0 },
    { x: xMax + 6, y: -o.aisle / 4, h: Math.PI },
  ];

  return {
    ...o, pitch, lineX, bayX, edgeY, backY, rowCentreY, xMin, xMax, marks, dashes, arrows,
    bounds: { xMin: xMin - RUN_OUT, xMax: xMax + RUN_OUT, yMin: backY(-1) - 1.5, yMax: backY(1) + 1.5 },
    /** The bay's clear interior (inside the line edges) [xa, ya, xb, yb]. */
    bayRect(s, i) {
      return rect(lineX(i) + o.lineW / 2, edgeY(s), lineX(i + 1) - o.lineW / 2, backY(s) - s * o.lineW / 2);
    },
    /** The bay (side s) under a plane point, or null. */
    bayAt(x, y) {
      for (const s of [1, -1]) {
        const ya = Math.min(edgeY(s), backY(s)), yb = Math.max(edgeY(s), backY(s));
        if (y < ya || y > yb) continue;
        const i = Math.floor((x - xMin) / pitch);
        if (i >= 0 && i < o.nBays) return { s, i };
      }
      return null;
    },
  };
}
