/**
 * Watch and Guided modes: narrates the run and reads the junction like a good driver. Pure and deterministic:
 * same states in, same cues out.
 *
 *   const guide = createGuide(layout, { tier, mode: 'watch' | 'guided' })
 *     watch   the guide drives: go and exit cues are its taps, with brief slow motion at each
 *     guided  the learner taps: no go/exit cues; captions, focus, slow on a liar, plus live advice cues
 *   guide.update(state, playerPhase) -> Cue[]   once per sim step, with sim.state() and player.phase
 *   guide.done                                  true once the player has left at the target exit
 *   guide.dispose()
 *
 * Cue: { t, kind, topic?, text?, focusId?, focusPoint?, signCode?, hcRef?, holdMs?, advice? }
 *   caption  text to show (Title Case, one pill line: <= CAPTION_MAX chars); at most one every CAPTION_GAP seconds
 *   focus    look at and highlight focusId (a vehicle in this state) or focusPoint { x, z } (world metres)
 *   slow     brief slow motion for holdMs at a key moment (the guide's taps, a liar callout)
 *   go       the guide's Go tap: call judgeGo(...) then player.go(), exactly as for a human tap (watch)
 *   exit     the guide's Exit tap: call judgeExit(...) then player.exit() (watch)
 *   advice   (guided) the decision in front of the learner changed: advice = { go, exit, cueId }
 *            go: 'safe' | 'tight' | 'unsafe' | null   judgeGo now, while the Go window is open
 *            exit: 'early' | 'ok' | 'late' | null     judgeExit now, on the ring with an exit decision
 *            cueId: the vehicle behind a non-safe value (judge culprit), else null
 *            A new value must hold ADVICE_HOLD seconds before it is sent, except a switch away from
 *            safe/ok (green never outlives judgeGo/judgeExit saying ok) or to unsafe/early,
 *            which is sent at once. Keep the latest advice until the next advice cue replaces it.
 *   topic    what a caption or focus is about: 'route' | 'sign' | 'lane' | 'signal' | 'lookRight' | 'lookAhead'
 *            | 'farCar' | 'blocker' | 'liar' | 'traffic' | 'go' | 'ring' | 'exit'
 *   signCode the layout.signs code a 'sign' cue reads ('limit' | '510' | 'map' | '602' | '611.1')
 *
 * The scan follows a good driver: signs early (limit, 510, map), the lane arrows, the give-way, then look
 * right, read the far arms first, then the arm on the right, then the nearest circulating car; a look ahead
 * at the entry, and back right to go. When cues compete, safety beats a blocker or far car, which beat signs,
 * which beat lane advice. The guide only taps when the judge would say 'ok' with margin to spare, and every
 * caption describes the state it was emitted with: signals, wheels and true paths come from the sim.
 */
import { entryConflicts, CREEP_DISTANCE } from './kinematics.js';
import { goAssessment, judgeGo, judgeExit, previousExitS, queuedBehind, vehicleName, TIGHT_GAP, CLEAR_GAP } from './judge.js';
import { indexAt, wrapPi, dir } from './geom.js';
import { LARGE_TYPES } from './traffic-data.js';

export const CAPTION_GAP = 1.2; // s between captions
const CAPTION_HOLD = 1800; // ms a caption stays up
export const SLOW_HOLD = 2000; // ms (wall clock) of slow motion at a key moment; its caption stays up as long
const GO_MARGIN = 0.5; // s beyond the critical gap the guide insists on
const GO_DECEL = 0.5; // m/s^2: the most any circulating driver may need to ease off for the guide
const PATIENCE = 25; // s at the line before the guide settles for any 'ok' gap with no margin
const ROLL_IN = 12; // m from the line within which the guide may Go while still rolling
const LIAR_HORIZON = 8; // s: a misleading signal this close is worth calling out
const QUIET_BEFORE_EXIT = 1.4; // s before the exit cue during which lesser captions are held back
const GAP_FOCUS_DELAY = 1.0; // s after naming a blocker before looking at the gap it opens
const BLOCKER_REACH = 25; // m of ring behind a joining car within which a braking car counts as held by it
export const ADVICE_HOLD = 0.25; // s a changed advice must persist before it is sent (unsafe/early: at once)
const GO_ADVICE = { ok: 'safe', tight: 'tight', unsafe: 'unsafe', notAllowed: 'unsafe' };
const EXIT_ADVICE = { ok: 'ok', lateSignal: 'late', late: 'late', early: 'early', alongside: 'early' };

// Distance bands (metres before the stop point) for the approach looks.
const BANDS = {
  sign: [8, 45], // a sign is read while it is this far ahead
  lane: [35, 58],
  giveWay: [30, 44],
  lookRight: [25, 34],
  scan: 80, // far-arm traffic is worth reading from here in
  lookAhead: [0, 22],
};

const PRIORITY = { safety: 50, blocker: 40, farCar: 35, lookRight: 30, sign: 20, lane: 10, route: 5 };

// Site Title Case: every word capitalised except these minor words, which stay lowercase unless they open a
// phrase (the string, or after . : ! or ?) or close one (the string's end, or right before punctuation: with
// no object a preposition is a particle, as in "Wheels In,"). Other letters are kept, so 'HC' stays 'HC'.
export const MINOR_WORDS = new Set(['a', 'an', 'the', 'and', 'or', 'nor', 'but', 'of', 'in', 'on', 'at', 'to', 'for', 'by', 'per', 'as', 'via', 'from']);
const OPENS_AFTER = /[.:!?]$/;
const CLOSES = /[.,;:!?)]$/;
export function titleCase(s) {
  const words = s.split(' ');
  return words.map((w, i) => {
    const core = w.replace(/^[^A-Za-z0-9']+|[^A-Za-z0-9']+$/g, '');
    if (!core) return w;
    const edge = i === 0 || i === words.length - 1 || OPENS_AFTER.test(words[i - 1]) || CLOSES.test(w);
    const minor = !edge && MINOR_WORDS.has(core.toLowerCase());
    return w.replace(core, minor ? core.toLowerCase() : core[0].toUpperCase() + core.slice(1));
  }).join(' ');
}
const nameOf = (v) => titleCase(vehicleName(v));

const SIGNAL_WORDS = { left: 'Signal Left', right: 'Signal Right' };
const DIRECTION_WORDS = { left: 'on Your Left', ahead: 'Straight Ahead', right: 'on Your Right' };
const LANE_NAMES = { 1: ['Single'], 2: ['Left', 'Right'], 3: ['Left', 'Middle', 'Right'] };

// All guide copy, written in site Title Case (caption() still normalises names and words filled in). Each
// caption is one pill line: at most CAPTION_MAX characters with the longest names filled in ("Orange Estate",
// the longest road and destination), which tests/test-roundabout-guide.js checks.
// Each entry takes the facts it states.
export const CAPTION_MAX = 40;
export const COPY = {
  route: (n, road) => `Exit ${n}: ${road}`,
  limit: (mph) => `${mph} Limit`,
  roundaboutAhead: () => 'Roundabout Ahead',
  mapSign: (n, dest, lane) => `Map: Exit ${n} ${dest}, ${lane === 'Single' ? 'One Lane' : `${lane} Lane`}`,
  giveWay: () => 'Give Way to Traffic from the Right',
  miniGiveWay: () => 'Mini Roundabout: Give Way to the Right',
  singleLane: (n, dir) => `Single Lane In: Exit ${n} Is ${DIRECTION_WORDS[dir]}`,
  clockLane: (n, dir, lane) => `Exit ${n} Is ${DIRECTION_WORDS[dir]}: ${lane} Lane`,
  arrowLane: (n, lane) => `Arrows Show the ${lane} Lane for Exit ${n}`,
  signalLeft: () => 'Signal Left as You Approach',
  signalRight: () => 'Signal Right as You Approach',
  noSignal: () => 'Straight On: No Signal on Approach',
  lookRight: () => 'Look Right: Right Has Priority',
  farHonest: (name) => `${name}: Signal Right, Coming Past`,
  farLeaving: (name) => `${name}: Turning Off Before You`,
  farLiar: (name) => `${name}: Left Signal, Still Coming`,
  waitFor: (name, signal) => `${name}: ${signal}, Comes Round`,
  liar: (name) => `Don't Trust ${name}'s Left Signal`,
  blocker: (name) => `Blocker: ${name} Holds Traffic`,
  crossing: (name) => `${name} Crossing Your Entry: Wait`,
  turningIn: (name) => `${name} Turning Into Your Road`,
  stopped: (name) => `${name} Stopped in Your Way: Wait`,
  large: (type) => `${type} Alongside: Give It Room`,
  lookAhead: () => 'Check Ahead: Your Entry Is Clear',
  goAfter: (name) => `Back Right: Gap After ${name}. Go.`,
  goClear: () => 'Back Right: Clear. Go.',
  // Guided: the learner makes the call.
  gapAfter: (name) => `Back Right: Gap After ${name}`,
  gapClear: () => 'Back Right: Clear',
  firstExit: () => 'First Exit: Keep Signalling Left',
  passing: (k, dest) => `Passing Exit ${k} (${dest})`,
  exitNext: (n) => `Exit ${n} Next: Mirror, Signal Left`,
  alongside: (name) => `${name} Alongside: Hold Your Lane`,
  missed: () => 'Missed It: Go Round Again, Never Swerve',
  exited: (n, road) => `Off at Exit ${n}: ${road}`,
};

const SIGN_ORDER = ['limit', '510', 'map', '602', '611.1'];

// Arc lengths along the player's ring where it passes each other arm's exit, in order.
function exitPasses(layout, path) {
  const out = [];
  const i0 = indexAt(path, path.marks.merge);
  const i1 = indexAt(path, path.marks.diverge);
  for (const arm of layout.arms) {
    const b = arm.divergeBearing[path.ringLane];
    for (let i = i0; i < i1; i++) {
      const crossed = Math.floor((path.bearing[i] - b) / (2 * Math.PI)) !== Math.floor((path.bearing[i + 1] - b) / (2 * Math.PI));
      if (crossed) out.push({ s: path.s[i + 1], arm: arm.index });
    }
  }
  return out.sort((x, y) => x.s - y.s);
}

const ringPoint = (layout, bearing) => {
  const p = dir(bearing);
  return { x: p[0] * layout.outerRadius, z: p[1] * layout.outerRadius };
};

export function createGuide(layout, { tier, mode = 'watch' } = {}) {
  const watch = mode === 'watch';
  const pl = layout.player;
  const nArms = layout.arms.length;
  const rightArm = (pl.arm - 1 + nArms) % nArms;
  const entry = layout.arms[pl.arm];
  const target = layout.arms[pl.exitArm];
  // Approach order: furthest from the line first (code order breaks ties).
  const signs = layout.signs.filter((s) => s.arm === pl.arm)
    .sort((a, b) => b.distance - a.distance || SIGN_ORDER.indexOf(a.code) - SIGN_ORDER.indexOf(b.code));
  const rightEntryPoint = ringPoint(layout, layout.arms[rightArm].mergeBearing[0]);
  const myEntryPoint = ringPoint(layout, entry.mergeBearing[pl.lane]);
  const giveWayPoint = { x: entry.giveWay[pl.lane].x, z: entry.giveWay[pl.lane].z };

  let lastCaption = -Infinity;
  let cues = [];
  let t = 0;
  const said = new Set(); // one-off topics and per-vehicle callouts already made
  let narrated = null;
  let lastBlockerId = null;
  let waitingSince = null;
  let wentAt = null;
  let pendingFocus = null;
  let exitTapped = false;
  let pathId = null;
  let passes = [];
  let passIndex = 0;
  let loopsSeen = 0;
  let done = false;

  const push = (cue) => cues.push({ t, ...cue });
  const captionFree = () => t - lastCaption >= CAPTION_GAP - 1e-9;
  function caption(text, { topic, hcRef = null, focusId, focusPoint, signCode } = {}) {
    if (!captionFree()) return false;
    lastCaption = t;
    push({ kind: 'caption', topic, text: titleCase(text), hcRef, holdMs: CAPTION_HOLD, ...(signCode ? { signCode } : {}) });
    if (focusId !== undefined) push({ kind: 'focus', topic, focusId });
    if (focusPoint) push({ kind: 'focus', topic, focusPoint, ...(signCode ? { signCode } : {}) });
    return true;
  }
  // Slow motion for the moment just captioned: that caption stays up for the whole slow span.
  function slow() {
    const cap = cues.findLast((c) => c.kind === 'caption');
    if (cap) cap.holdMs = Math.max(cap.holdMs, SLOW_HOLD);
    push({ kind: 'slow', holdMs: SLOW_HOLD });
  }
  // Highest-priority candidate gets the caption slot; one-offs are remembered by key.
  function best(candidates) {
    if (!captionFree() || !candidates.length) return null;
    const c = candidates.reduce((a, b) => (b.priority > a.priority ? b : a));
    c.before?.();
    if (caption(c.text, c)) {
      if (c.key) said.add(c.key);
      c.after?.();
      return c;
    }
    return null;
  }

  function laneText() {
    const n = entry.entryLanes;
    if (n === 1) return COPY.singleLane(pl.exitNumber, pl.direction);
    const lane = LANE_NAMES[n][pl.lane];
    return entry.arrowsOverride && pl.direction === 'ahead' ? COPY.arrowLane(pl.exitNumber, lane) : COPY.clockLane(pl.exitNumber, pl.direction, lane);
  }

  function signText(sign) {
    if (sign.code === 'limit') return COPY.limit(sign.mph);
    if (sign.code === '510') return COPY.roundaboutAhead();
    if (sign.code === 'map') return COPY.mapSign(pl.exitNumber, target.destination, LANE_NAMES[entry.entryLanes][pl.lane]);
    return sign.code === '611.1' ? COPY.miniGiveWay() : COPY.giveWay();
  }

  // Approach looks: signs, lane arrows, give-way, look right. Each fires once inside its band.
  function approachCandidates(me, d) {
    const out = [];
    const inBand = (x, [lo, hi]) => x >= lo && x <= hi;
    if (!said.has('route') && d > BANDS.lane[1]) out.push({ key: 'route', topic: 'route', priority: PRIORITY.route, text: COPY.route(pl.exitNumber, target.name) });
    for (const sign of signs) {
      const key = 'sign:' + sign.code;
      const band = sign.code === '602' || sign.code === '611.1' ? BANDS.giveWay : BANDS.sign;
      const ahead = sign.code === '602' || sign.code === '611.1' ? d : d - sign.distance;
      if (said.has(key) || !inBand(ahead, band)) continue;
      const hcRef = sign.code === '611.1' ? 'HC 188' : sign.code === '602' ? 'HC 185' : sign.code === 'map' ? 'HC 186' : null;
      const giveWay = sign.code === '602' || sign.code === '611.1';
      out.push({
        key, topic: 'sign', signCode: sign.code, priority: PRIORITY.sign, text: signText(sign), hcRef, focusPoint: { x: sign.x, z: sign.z },
        // The sign, then the give-way markings it goes with.
        after: giveWay ? () => { pendingFocus = { at: t + GAP_FOCUS_DELAY, point: giveWayPoint, topic: 'sign' }; } : undefined,
      });
    }
    if (!said.has('lane') && inBand(d, BANDS.lane)) {
      // The lane's arrow marking nearest to the car (they sit 15 and 45 m before the line).
      const mark = layout.markings.arrows.filter((a) => a.arm === pl.arm && a.lane === pl.lane)
        .sort((p, q) => Math.hypot(p.x - me.x, p.z - me.z) - Math.hypot(q.x - me.x, q.z - me.z))[0];
      out.push({ key: 'lane', topic: 'lane', priority: PRIORITY.lane, text: laneText(), hcRef: 'HC 186', focusPoint: mark && { x: mark.x, z: mark.z } });
    }
    if (!said.has('signal') && said.has('lane') && d < 60) {
      const want = pl.route.exitDecision ? (pl.direction === 'right' ? 'right' : null) : 'left';
      if (me.indicator === want) {
        const text = want === 'left' ? COPY.signalLeft() : want === 'right' ? COPY.signalRight() : COPY.noSignal();
        out.push({ key: 'signal', topic: 'signal', priority: PRIORITY.lane, text, hcRef: 'HC 186' });
      }
    }
    if (!said.has('lookRight') && inBand(d, BANDS.lookRight)) {
      out.push({ key: 'lookRight', topic: 'lookRight', priority: PRIORITY.lookRight, text: COPY.lookRight(), hcRef: 'HC 185', focusPoint: rightEntryPoint });
    }
    return out;
  }

  // Cars from further round: read them early, far arms first.
  function farCandidates(state, me) {
    const out = [];
    for (const w of state.vehicles) {
      if (w.isPlayer || !w.inRing || !w.entered || !w.indicator) continue;
      if (w.path.arm === pl.arm || w.path.arm === rightArm || said.has('far:' + w.id)) continue;
      const comes = entryConflicts(me.path, w.path, Math.max(me.length, w.length)).some((run) => w.s - w.length / 2 <= run.sTo);
      // A left signal is worth naming only when it lies: the car keeps coming round past the player's road.
      if (w.indicator === 'left' && (!comes || w.path.exitArm === pl.arm)) continue;
      const armsAway = (w.path.arm - pl.arm + nArms) % nArms; // further clockwise from us = read first
      const text = w.indicator === 'left' ? COPY.farLiar(nameOf(w)) : comes ? COPY.farHonest(nameOf(w)) : COPY.farLeaving(nameOf(w));
      out.push({ key: 'far:' + w.id, topic: 'farCar', priority: PRIORITY.farCar + armsAway * 0.1, text, hcRef: 'HC 185', focusId: w.id });
    }
    return out;
  }

  // Blocker: a car joining from the right arm that holds circulating traffic back, opening a gap.
  function blockerCandidates(state) {
    const out = [];
    for (const w of state.vehicles) {
      if (w.isPlayer || w.path.arm !== rightArm || said.has('blocker:' + w.id)) continue;
      const joining = w.s > w.stopS && w.s < w.path.marks.merge + w.length;
      // Held: a circulating car following it, or just upstream of it on the ring and braking or nearly
      // stopped (yielding to it as it pulls out).
      const holding = state.vehicles.some((u) => {
        if (u.isPlayer || !u.inRing || u.path.arm === rightArm) return false;
        if (u.leaderId === w.id) return true;
        if (u.a > -0.5 && u.v > 2) return false;
        const behind = u.r * wrapPi(w.bearing - u.bearing);
        return behind > 0 && behind < BLOCKER_REACH;
      });
      if (!joining || !holding) continue;
      out.push({
        key: 'blocker:' + w.id, topic: 'blocker', priority: PRIORITY.blocker, text: COPY.blocker(nameOf(w)), hcRef: 'HC 185', focusId: w.id,
        after: () => { pendingFocus = { at: t + GAP_FOCUS_DELAY, point: rightEntryPoint, topic: 'blocker' }; },
      });
    }
    return out;
  }

  // The vehicle that stops the guide going, with what to say about it; null when the gap is good.
  function holdUp(state, me, list, tLine, minGap) {
    const verdict = judgeGo(state).verdict;
    const hit = list.find((c) => c.inZone);
    if (hit) return { car: hit.other, text: hit.other.v < 1.5 ? COPY.stopped(nameOf(hit.other)) : COPY.crossing(nameOf(hit.other)) };
    // A gap the judge would call clear (lag >= CLEAR_GAP) is taken at once: waiting in it is hesitation.
    const clear = !list.length || list[0].eta >= CLEAR_GAP;
    const close = list.find((c) => c.eta - tLine < minGap || (!clear && c.needDecel > GO_DECEL));
    if (close) {
      const o = close.other;
      // Turning off into the player's road yet still crossing its entry (tight minis): honest, not coming round.
      if (o.path.exitArm === pl.arm) return { car: o, text: COPY.turningIn(nameOf(o)) };
      return {
        car: o, liar: o.indicator === 'left' && close.eta < LIAR_HORIZON,
        text: COPY.waitFor(nameOf(o), SIGNAL_WORDS[o.indicator] ?? 'No Signal'),
      };
    }
    if (verdict === 'notAllowed') {
      const big = state.vehicles.find((w) => !w.isPlayer && w.inRing && LARGE_TYPES.has(w.type));
      return { car: big ?? null, text: big ? COPY.large(big.type === 'bus' ? 'Bus' : 'Lorry') : null };
    }
    return verdict === 'ok' ? null : { car: null, text: null };
  }

  function nearLine(state, me, phase, d) {
    const scanning = said.has('lookRight') || phase === 'waiting' || d < BANDS.lookRight[0];
    if (!scanning) return [];
    const canGo = !queuedBehind(state, me) && (phase === 'waiting' || (phase === 'approach' && d < ROLL_IN));
    if (canGo && waitingSince === null) waitingSince = t;
    // The judge's own view of this Go (a vehicle passing in front is already left out), so advice and verdict agree.
    const { list, tLine } = goAssessment(state);
    const minGap = waitingSince !== null && t - waitingSince > PATIENCE ? TIGHT_GAP : TIGHT_GAP + GO_MARGIN;
    const h = holdUp(state, me, list, tLine, minGap);
    const out = [];

    if (h?.liar && !said.has('liar:' + h.car.id)) {
      out.push({
        key: 'liar:' + h.car.id, topic: 'liar', priority: PRIORITY.safety + 1, text: COPY.liar(nameOf(h.car)), hcRef: 'HC 185', focusId: h.car.id,
        after: () => { lastBlockerId = h.car.id; slow(); },
      });
    } else if (h?.car && h.text && h.car.id + '|' + h.text !== narrated) {
      const key = h.car.id + '|' + h.text;
      out.push({ topic: 'traffic', priority: PRIORITY.safety, text: h.text, hcRef: 'HC 185', focusId: h.car.id, after: () => { narrated = key; lastBlockerId = h.car.id; } });
    }
    // One look ahead at the entry while creeping in (only when it really is clear), then back right to go.
    if (!said.has('lookAhead') && !list.some((c) => c.inZone) && d <= BANDS.lookAhead[1]) {
      // Ahead of the wait narration: done while creeping, it never delays the Go once the gap comes.
      out.push({ key: 'lookAhead', topic: 'lookAhead', priority: PRIORITY.safety + 2, text: COPY.lookAhead(), focusPoint: myEntryPoint });
    }
    if (!h) {
      if (canGo) {
        const passed = lastBlockerId !== null && state.vehicles.find((v) => v.id === lastBlockerId && !list.some((c) => c.other.id === v.id));
        const text = watch ? (passed ? COPY.goAfter(nameOf(passed)) : COPY.goClear()) : passed ? COPY.gapAfter(nameOf(passed)) : COPY.gapClear();
        if (!watch && said.has('gap:' + text)) return out;
        out.push({
          key: watch ? undefined : 'gap:' + text,
          topic: 'go', priority: PRIORITY.safety + 3, text, hcRef: 'HC 185', focusPoint: rightEntryPoint,
          // No time for a separate look ahead once the gap is there: glance ahead, then back right.
          before: () => {
            if (said.has('lookAhead') || !captionFree()) return;
            said.add('lookAhead');
            push({ kind: 'focus', topic: 'lookAhead', focusPoint: myEntryPoint });
          },
          after: () => {
            if (!watch) return;
            slow();
            push({ kind: 'go' });
            wentAt = t;
          },
        });
      }
    }
    return out;
  }

  function onRing(state, me) {
    if (me.path.id !== pathId) {
      if (pathId !== null && me.path.loops > loopsSeen) {
        loopsSeen = me.path.loops;
        exitTapped = false;
        caption(COPY.missed(), { topic: 'ring' });
      }
      pathId = me.path.id;
      passes = exitPasses(layout, me.path);
      passIndex = passes.findIndex((p) => p.s > me.s + me.length / 2);
      if (passIndex < 0) passIndex = passes.length;
    }
    if (exitTapped) return;
    const front = me.s + me.length / 2;
    const sPrev = previousExitS(layout, me.path);
    const toPrev = (sPrev - front) / Math.max(me.v, 1);

    // Name exits as they go by, except the one just before ours: the exit cue speaks for that one.
    while (passIndex < passes.length && passes[passIndex].s <= front) {
      const p = passes[passIndex++];
      const ex = entry.exits[p.arm];
      const isPrev = Math.abs(p.s - sPrev) < 1;
      if (ex && !isPrev && !(toPrev > 0 && toPrev < QUIET_BEFORE_EXIT)) caption(COPY.passing(ex.exitNumber, layout.arms[p.arm].destination), { topic: 'ring' });
    }

    const v = judgeExit(state);
    // Tap as soon as it is fully right; settle for a late signal only when no better moment is left.
    const lastChance = (me.path.marks.diverge - me.s) / Math.max(me.v, 1) < 1.6;
    if (v.verdict === 'ok' || (v.verdict === 'lateSignal' && lastChance)) {
      const p = me.path;
      const i = indexAt(p, p.marks.exitRing);
      if (!watch) {
        // Guided: say it once per lap and leave the tap to the learner.
        if (caption(COPY.exitNext(pl.exitNumber), { topic: 'exit', hcRef: 'HC 186', focusPoint: { x: p.x[i], z: p.z[i] } })) exitTapped = true;
        return;
      }
      caption(COPY.exitNext(pl.exitNumber), { topic: 'exit', hcRef: 'HC 186', focusPoint: { x: p.x[i], z: p.z[i] } });
      slow();
      push({ kind: 'exit' });
      exitTapped = true;
    } else if (v.verdict === 'alongside' && !said.has('along:' + v.culpritId)) {
      const car = state.vehicles.find((w) => w.id === v.culpritId);
      if (car && caption(COPY.alongside(nameOf(car)), { topic: 'ring', hcRef: 'HC 187', focusId: car.id })) said.add('along:' + v.culpritId);
    }
  }

  // Guided: the judge's verdict on a tap now, with hysteresis so the light does not flicker.
  const NO_ADVICE = { go: null, exit: null, cueId: null };
  let advice = NO_ADVICE;
  let pending = null; // { advice, since }
  const sameAdvice = (a, b) => a.go === b.go && a.exit === b.exit && a.cueId === b.cueId;
  function advise(state, phase, me) {
    const d = me.stopS - me.s;
    let raw = NO_ADVICE;
    if ((phase === 'approach' || phase === 'waiting') && d < CREEP_DISTANCE && !queuedBehind(state, me)) {
      const v = judgeGo(state);
      const go = GO_ADVICE[v.verdict] ?? null;
      raw = { go, exit: null, cueId: go === 'safe' ? null : v.culpritId ?? null };
    } else if (phase === 'ring' && pl.route.exitDecision) {
      const v = judgeExit(state);
      const exit = EXIT_ADVICE[v.verdict] ?? null;
      raw = { go: null, exit, cueId: exit === 'ok' ? null : v.culpritId ?? null };
    }
    if (sameAdvice(raw, advice)) { pending = null; return; }
    if (!pending || !sameAdvice(pending.advice, raw)) pending = { advice: raw, since: t };
    // Green never outlives the verdict: leaving safe/ok is sent at once, like a switch to unsafe/early; only a
    // change towards green (or between cautions) waits, so a tap on green is always judged ok.
    const leavesGreen = advice.go === 'safe' || advice.exit === 'ok';
    if (leavesGreen || raw.go === 'unsafe' || raw.exit === 'early' || t - pending.since >= ADVICE_HOLD - 1e-9) {
      advice = raw;
      pending = null;
      push({ kind: 'advice', advice });
    }
  }

  function update(state, playerPhase) {
    cues = [];
    t = state.t;
    const me = state.vehicles.find((v) => v.isPlayer);
    if (!me || done) return cues;
    if (!watch) advise(state, playerPhase, me);
    if (pendingFocus && t >= pendingFocus.at) {
      push({ kind: 'focus', topic: pendingFocus.topic, focusPoint: pendingFocus.point });
      pendingFocus = null;
    }
    const d = me.stopS - me.s;
    if ((playerPhase === 'approach' || playerPhase === 'waiting') && wentAt === null) {
      const candidates = [...approachCandidates(me, d), ...blockerCandidates(state)];
      if (d < BANDS.scan) candidates.push(...farCandidates(state, me));
      candidates.push(...nearLine(state, me, playerPhase, d));
      // A blocker is named before the Go it makes possible, and in place of plain wait narration about the
      // same car; a different hazard still outranks it.
      for (const b of candidates.filter((c) => c.topic === 'blocker')) {
        const same = candidates.find((c) => c.topic === 'traffic' && c.focusId === b.focusId);
        const go = candidates.find((c) => c.topic === 'go');
        if (same) { b.priority = same.priority; same.priority = -1; }
        else if (go) b.priority = go.priority + 1;
      }
      best(candidates);
    } else if (playerPhase === 'ring' || playerPhase === 'leaving') {
      if (!pl.route.exitDecision) {
        if (!said.has('firstExit') && caption(COPY.firstExit(), { topic: 'exit', hcRef: 'HC 186' })) said.add('firstExit');
      } else if (playerPhase === 'ring') {
        onRing(state, me);
      }
    } else if (playerPhase === 'exited') {
      if (caption(COPY.exited(pl.exitNumber, target.name), { topic: 'exit' })) done = true;
    }
    return cues;
  }

  return {
    update,
    get done() { return done; },
    tier,
    mode,
    dispose() { cues = []; said.clear(); },
  };
}
