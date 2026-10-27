/**
 * Road-marking layout: pure (no three, no DOM).
 *
 *   giveWayBars(layout) -> [{ arm, row, a: [x, z], b: [x, z], width }]   every dash of every give-way marking
 *
 * Give way (TSM ch. 5, diagrams 1003.1 / 1003.3 at a roundabout): one marking per entry, the full width from the
 * nearside kerb to the offside edge, following the edge of the circulatory carriageway. The offside edge is the
 * splitter nose (or the centre line), on the arm axis. The entry's own offside kerb is not it: a flared entry
 * swings that kerb away from the nose and leaves an unmarked wedge. It is drawn from the kerb, not from the
 * lanes: lanes do not span a flared entry, and per-lane runs leave gaps where they meet. 600 mm marks, gaps stretched from 300 mm so a mark starts and ends at
 * each edge; rows 300 mm apart, two rows (1003.1) or one on a mini (1003.3).
 * Frame: geom.js (x east, z south, compass bearings, clockwise positive).
 */
import { dir, bearingOf, wrapPi, len } from './geom.js';

export const GIVE_WAY = { mark: 0.6, gap: 0.3, rowGap: 0.3 };

// Where a kerb polyline (running from far out toward the ring) first comes within radius r.
function crossing(pts, r) {
  for (let i = 1; i < pts.length; i++) {
    if (len(pts[i]) > r) continue;
    const a = pts[i - 1];
    const b = pts[i];
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 40; k++) {
      const m = (lo + hi) / 2;
      if (len([a[0] + (b[0] - a[0]) * m, a[1] + (b[1] - a[1]) * m]) > r) lo = m;
      else hi = m;
    }
    return [a[0] + (b[0] - a[0]) * hi, a[1] + (b[1] - a[1]) * hi];
  }
  return null;
}

// Nearside kerb crossing and the arm axis at radius r.
function entryEnds(arm, r) {
  const near = crossing(arm.kerbs.entryLeft, r);
  if (!near) return null;
  const d = dir(arm.bearing);
  return [near, [d[0] * r, d[1] * r]];
}

export function giveWayBars(layout) {
  const R = layout.outerRadius;
  const { mark, gap, rowGap } = GIVE_WAY;
  const bars = [];
  for (const gw of layout.markings.giveWay) {
    const arm = layout.arms[gw.arm];
    const rows = gw.diagram === '1003.3' ? 1 : 2;
    // Row centre radii: just outside the ring edge, the second row behind the first.
    const radii = Array.from({ length: rows }, (_, row) => R + gw.width / 2 + row * (gw.width + rowGap));
    // Each row spans its own kerb crossing: the nearside kerb sweeps into the ring, so the row nearer the ring can
    // be a metre wider than the one behind it, and a shared layout would stop short of the kerb.
    radii.forEach((r, row) => {
      const ends = entryEnds(arm, r);
      if (!ends) return;
      const start = bearingOf(ends[0][0], ends[0][1]);
      const sweep = wrapPi(bearingOf(ends[1][0], ends[1][1]) - start);
      const L = Math.abs(sweep) * r;
      if (L < mark) return;
      // Whole marks at both edges: n marks with the gaps nearest 300 mm that fill L exactly (never under 200 mm).
      let n = Math.max(1, Math.round((L + gap) / (mark + gap)));
      if (n > 1 && (L - n * mark) / (n - 1) < 0.2) n--;
      const g = n > 1 ? (L - n * mark) / (n - 1) : 0;
      const at = (s) => { const d = dir(start + (sweep * s) / L); return [d[0] * r, d[1] * r]; };
      for (let i = 0; i < n; i++) {
        const s0 = n > 1 ? i * (mark + g) : (L - mark) / 2;
        bars.push({ arm: gw.arm, row, a: at(s0), b: at(s0 + mark), width: gw.width });
      }
    });
  }
  return bars;
}
