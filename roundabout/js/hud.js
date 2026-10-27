/**
 * HUD and sheets. DOM only, no three.js and no sim: main/run decide, this module shows. Copy comes from ui.js.
 *
 *   const hud = createHud(handlers)
 *     handlers: onTier(t) onShuffle() onStart() onAct() onRetry() onRetryMode(mode) onNew() onChangeTier() onShowReplay()
 *               onReplayAgain() onReplayView() onReplayNext() onKeepDriving() onMute() onSound(on) onTips(mode)
 *               onTraffic(level) onDrill(key|null) onSeed(text) onCopyLink()
 *   hud.screen('start' | 'run' | 'frozen' | 'replay' | 'analysis' | 'none')   which layer of the HUD is up
 *   hud.sheet(name | null) / hud.openSheet                         settings and about float over any screen
 *   hud.route(ui.routeView(layout))  hud.speed(mph, limitMph)  hud.telltale(left, right)  hud.keepDriving(on)
 *   hud.act(label, { enabled, inert })  hud.advice(tone)  hud.chip(text | null, { holdMs })  hud.paused(on)  hud.edge(pos | null)
 *   hud.leader({ x, y } | null)      the hint's target as 0..1 of the canvas, each frame: a thin line from the hint to it
 *   hud.tag({ x, y, text } | null)   the culprit's signal in words, pinned above it in a freeze or replay
 *   hud.analysis(view)  hud.toasts(plan, onTap)  hud.clearToasts()  hud.fade(opacity)
 *   hud.setTier/setSeed/setSound/setTips/setTraffic/setDrill/setReady/copied  hud.replayView(driverOn)
 */
import { COPY, hcLink, createToastQueue, leaderPath } from './ui.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const TOAST_OUT_MS = 200; // index.html .notif-pill.out
const TOAST_TONE = { err: 'nf-err', warn: 'nf-warn', ok: 'nf-ok', caption: 'nf-note' };
const COPIED_MS = 1500;

const svgEl = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function kvRow(k, v) {
  const row = document.createElement('div');
  row.className = 'srow static';
  const a = document.createElement('span');
  a.className = 'slbl';
  a.textContent = k;
  const b = document.createElement('span');
  b.className = 'val';
  b.textContent = v;
  row.append(a, b);
  return row;
}

function segSelect(row, value) {
  for (const b of row.querySelectorAll('.seg')) b.classList.toggle('active', b.dataset.v === value);
}

const onSeg = (id, fn) => $(id).addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) fn(b.dataset.v); });

export function createHud(h) {
  const act = $('act');
  const hudEl = $('hud');
  const canvasEl = $('gl');
  const leaderEl = $('leader');
  const leaderLine = leaderEl.querySelector('line');
  const leaderDot = leaderEl.querySelector('circle');
  const sheets = { settings: $('settings'), about: $('about') };
  // The freeze shows the replay bar with only Keep Driving and See Analysis (index.html .frozen).
  const screens = { start: $('start'), analysis: $('analysis'), replay: $('replaybar'), frozen: $('replaybar') };
  let current = 'none';
  let openSheet = null;
  let leaderTarget = null;
  let underPause = null; // the hint the Paused hint covers, with its hold left
  const toastsEl = $('toasts');
  const toastQueue = createToastQueue({ now: () => performance.now() });
  let toastTimer = 0;
  let toastTap = null;

  onSeg('tiers', h.onTier);
  onSeg('sound-seg', (v) => h.onSound(v === 'on'));
  onSeg('tips-seg', h.onTips);
  onSeg('traffic-seg', h.onTraffic);
  onSeg('drill-seg', (v) => h.onDrill(v || null));
  const click = (id, fn) => $(id).addEventListener('click', fn);
  click('start-btn', () => h.onStart());
  click('shuffle-start', () => h.onShuffle());
  click('shuffle', () => h.onShuffle());
  act.addEventListener('click', () => { act.blur(); h.onAct(); });
  click('settings-btn', () => sheet(openSheet === 'settings' ? null : 'settings'));
  click('settings-done', () => sheet(null));
  click('about-btn', () => sheet('about'));
  click('about-done', () => sheet('settings'));
  click('copy-link', () => h.onCopyLink());
  click('mute', () => h.onMute());
  click('a-retry', () => h.onRetry());
  click('a-new', () => h.onNew());
  click('a-guided', () => h.onRetryMode('guided'));
  click('a-watch', () => h.onRetryMode('watch'));
  click('a-tier', () => h.onChangeTier());
  click('a-show', () => h.onShowReplay());
  click('r-again', () => h.onReplayAgain());
  click('r-view', () => h.onReplayView());
  click('r-next', () => h.onReplayNext());
  click('r-keep', () => h.onKeepDriving());
  $('seed').addEventListener('change', (e) => h.onSeed(e.target.value));
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); });
  for (const id of ['copy-link', 'about-btn']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); $(id).click(); } });
  // Labels that change at run time start from the same COPY entries they change between.
  function setReady(on) { $('start-btn').disabled = !on; $('start-btn').textContent = on ? COPY.start : COPY.loading; }
  setReady(false);
  $('copy-l').textContent = COPY.link.copy;
  $('r-again').textContent = COPY.replay.again;
  $('r-next').textContent = COPY.replay.next;
  $('r-keep').textContent = COPY.replay.keep;
  $('r-view').textContent = COPY.replay.driver;

  // A tap outside an open sheet closes it (the canvas and HUD gaps both count as outside).
  document.addEventListener('pointerdown', (e) => {
    if (openSheet && !sheets[openSheet].contains(e.target) && !e.target.closest('.corner')) sheet(null);
  }, true);

  function sheet(name) {
    openSheet = name;
    for (const [k, s] of Object.entries(sheets)) s.hidden = k !== name;
    for (const s of new Set(Object.values(screens))) s.hidden = true;
    if (!name && screens[current]) screens[current].hidden = false;
  }

  // 'frozen' is the red-verdict freeze inside a run: the scene stays, the run controls give way to the bar.
  function screen(name) {
    current = name;
    const run = name === 'run';
    const inRun = run || name === 'frozen' || name === 'replay';
    act.hidden = !run;
    $('route').hidden = name === 'none' || name === 'replay';
    $('speed').hidden = !run;
    $('mute').hidden = !run;
    $('theme-btn').hidden = inRun;
    $('settings-btn').hidden = inRun;
    $('replaybar').classList.toggle('frozen', name === 'frozen');
    if (!inRun) chip(null);
    if (name !== 'run') edge(null);
    if (!inRun) tag(null);
    sheet(null);
    // Toasts sit above the freeze/replay bar while it shows (index.html #toasts).
    const bar = $('replaybar');
    hudEl.style.setProperty('--bar-h', bar.hidden ? '0px' : `${bar.offsetHeight}px`);
  }

  // Clock-face pip from ui.routeView: the player's arm at six o'clock, the target exit picked out.
  function route(v) {
    const pip = $('pip');
    pip.replaceChildren();
    const ring = 6.5;
    if (v.mini) svgEl('circle', { r: 4.5, fill: 'currentColor', stroke: 'none' }, pip);
    else svgEl('circle', { r: ring, 'stroke-width': 2.4 }, pip);
    for (const { angle, target } of v.spokes) {
      const d = [Math.sin(angle), -Math.cos(angle)];
      const g = svgEl('g', target ? { class: 'tgt' } : {}, pip);
      svgEl('line', { x1: d[0] * ring, y1: d[1] * ring, x2: d[0] * 15, y2: d[1] * 15, 'stroke-width': target ? 3 : 2.2 }, g);
      if (target) svgEl('circle', { cx: d[0] * 15, cy: d[1] * 15, r: 3, fill: 'currentColor', stroke: 'none' }, g);
    }
    $('r-exit').textContent = v.exitText;
    $('r-lane').textContent = v.laneText;
    $('r-dest').textContent = v.destText;
  }

  // The hint line (guide and tip captions, replay captions, Paused) is the toast stack's caption: same place, one
  // line, below any verdict. holdMs: it clears itself after that long; a later call replaces it and its hold.
  function chip(text, { holdMs = 0 } = {}) {
    toastQueue.setCaption(text, { holdMs });
    syncToasts();
  }

  // The leader line from the hint to its target: target { x, y } as 0..1 of the canvas, or null. Drawn only while
  // a hint shows; render calls this every run frame, so the line follows the target.
  function leader(target) {
    leaderTarget = target;
    const note = toastQueue.caption;
    const el = note && pills.get(note.id);
    let p = null;
    if (el && target && !el.classList.contains('out')) {
      const gl = canvasEl.getBoundingClientRect();
      const box = hudEl.getBoundingClientRect();
      p = leaderPath(el.getBoundingClientRect(), { x: gl.left + target.x * gl.width, y: gl.top + target.y * gl.height }, { width: box.width, height: box.height });
    }
    leaderEl.classList.toggle('on', Boolean(p));
    if (!p) return;
    leaderLine.setAttribute('x1', p.x1);
    leaderLine.setAttribute('y1', p.y1);
    leaderLine.setAttribute('x2', p.x2);
    leaderLine.setAttribute('y2', p.y2);
    leaderDot.setAttribute('cx', p.x2);
    leaderDot.setAttribute('cy', p.y2);
  }

  function edge(pos) {
    const e = $('edge');
    if (!pos) { e.hidden = true; return; }
    e.hidden = false;
    e.style.left = `${pos.x * 100}%`;
    e.style.top = `${pos.y * 100}%`;
    e.firstElementChild.style.transform = `rotate(${-pos.angle}rad)`;
  }

  // A short label pinned above a vehicle on screen: pos { x, y (0..1 of the viewport), text } or null.
  function tag(pos) {
    const e = $('tag');
    if (!pos) { e.hidden = true; return; }
    if (e.textContent !== pos.text) e.textContent = pos.text;
    e.style.left = `${pos.x * 100}%`;
    e.style.top = `${pos.y * 100}%`;
    e.hidden = false;
  }

  function gapsChart(g) {
    const svg = $('a-gaps');
    svg.replaceChildren();
    const taken = g.gaps.find((x) => x.taken);
    const hasLag = taken?.lag != null; // null when nothing was coming
    const end = Math.max(g.end, hasLag ? taken.end + taken.lag : g.end);
    const span = Math.max(0.5, end - g.start);
    const x = (t) => ((t - g.start) / span) * 300;
    for (const gap of g.gaps) {
      const x0 = x(gap.start) + (gap.start > g.start ? 1.5 : 0);
      const w = Math.max(2, x(gap.end) - x0);
      const tone = gap.taken ? 100 : gap.clear ? 34 : 14;
      svgEl('rect', { x: x0, y: 14, width: w, height: 14, rx: 4, style: `fill:color-mix(in srgb, var(--t1) ${tone}%, transparent);stroke:none` }, svg);
      // The taken bar only spans opening-to-tap, not a gap between cars, so it carries no length.
      if (w > 30 && !gap.taken) svgEl('text', { x: x0 + w / 2, y: 9, 'text-anchor': 'middle', stroke: 'none' }, svg).textContent = `${gap.length.toFixed(1)} s`;
    }
    if (hasLag) {
      const xn = x(taken.end + taken.lag);
      svgEl('line', { x1: xn, y1: 12, x2: xn, y2: 30, 'stroke-width': 2, style: 'stroke:var(--t1)' }, svg);
      svgEl('text', { x: Math.min(296, xn), y: 39, 'text-anchor': 'end', stroke: 'none' }, svg).textContent = COPY.taken.next(taken.lag);
    }
  }

  function analysis(v) {
    $('a-title').textContent = v.title;
    $('a-reason').textContent = v.reason;
    $('a-reason').hidden = !v.reason;
    $('a-notes').textContent = v.notes.join(', ');
    $('a-notes').hidden = !v.notes.length;
    const ref = hcLink(v.ref);
    const a = $('a-ref');
    a.hidden = !ref;
    if (ref) {
      a.textContent = ref.text;
      a.href = ref.href;
    }
    $('a-show').hidden = !v.explain;
    $('a-gap-sec').hidden = !v.gaps;
    if (v.gaps) gapsChart(v.gaps);
    $('a-taken').textContent = v.takenLines.join('\n');
    $('a-taken').hidden = !v.takenLines.length;
    $('a-car-sec').hidden = !v.cars.length;
    $('a-cars').replaceChildren(...v.cars.map((c) => kvRow(c.name, c.value)));
    $('a-dec').replaceChildren(...v.decisions.map(([k, val]) => kvRow(k, val)));
    screen('analysis');
    screens.analysis.scrollTop = 0;
  }

  // The stack's rules are ui.createToastQueue's; this keeps one pill per visible toast, keyed by id, so a pill
  // that stays never re-animates, and one timer armed at the queue's next change.
  const pills = new Map();
  function drawToasts() {
    const want = new Set(toastQueue.visible.map((t) => t.id));
    for (const [id, el] of pills) {
      if (want.has(id)) continue;
      pills.delete(id);
      el.classList.add('out');
      setTimeout(() => el.remove(), TOAST_OUT_MS);
    }
    toastQueue.visible.forEach((t, i) => {
      let el = pills.get(t.id);
      if (!el) {
        el = document.createElement(t.kind === 'caption' ? 'div' : 'button');
        el.className = `notif-pill ${TOAST_TONE[t.kind]}`;
        el.textContent = t.title;
        if (t.kind !== 'caption') {
          el.addEventListener('click', () => {
            const item = toastQueue.tap(t.id);
            syncToasts();
            if (item) toastTap?.(item);
          });
        }
        pills.set(t.id, el);
      }
      // Moved only when out of place: re-inserting a node restarts its entry animation.
      const ref = [...toastsEl.children].filter((c) => !c.classList.contains('out'))[i];
      if (ref !== el) toastsEl.insertBefore(el, ref ?? null);
    });
    leader(leaderTarget);
  }
  function syncToasts() {
    clearTimeout(toastTimer);
    drawToasts();
    const at = toastQueue.nextChange();
    if (at != null) toastTimer = setTimeout(() => { toastQueue.tick(); syncToasts(); }, Math.max(0, at - performance.now()));
  }

  return {
    screen,
    sheet,
    get openSheet() { return openSheet; },
    route,
    act(label, { enabled = true, inert = false } = {}) {
      $('act-l').textContent = label;
      act.disabled = !enabled;
      act.classList.toggle('inert', inert);
      act.title = `${label} (Space)`;
    },
    // Guided light: 'go' | 'caution' | 'stop' | null (neutral); the label stays Go/Exit.
    advice(tone) {
      if (tone) act.dataset.tone = tone;
      else delete act.dataset.tone;
    },
    chip,
    leader,
    // Paused covers the hint; unpausing brings that hint back with the hold it had left.
    paused(on) {
      if (on) {
        const note = toastQueue.caption;
        underPause = note && { text: note.title, timed: note.until != null, left: note.until == null ? 0 : note.until - performance.now() };
        chip(COPY.paused);
        return;
      }
      const prev = underPause;
      underPause = null;
      if (prev && (!prev.timed || prev.left > 0)) chip(prev.text, { holdMs: prev.left });
      else chip(null);
    },
    // Keep Driving is offered only while the run can carry on from its freeze (run.canKeepDriving).
    keepDriving(on) { $('r-keep').hidden = !on; },
    edge,
    tag,
    analysis,
    // Speed always shows beside the limit, whether or not the cab's speedometer is in frame.
    speed(mph, limit) {
      $('mph').textContent = COPY.mph(mph);
      $('limit-n').textContent = String(limit);
    },
    telltale(left, right) {
      $('ind-l').classList.toggle('on', left);
      $('ind-r').classList.toggle('on', right);
    },
    toasts(plan, onTap) {
      toastTap = onTap;
      toastQueue.push(plan);
      syncToasts();
    },
    clearToasts() {
      toastQueue.clear();
      syncToasts();
    },
    toast(msg, kind) { window._base.notify(msg, kind === 'ok' ? true : kind === 'warn' ? 'warn' : false); },
    fade(o) { $('fade').style.opacity = String(o); },
    // The view button names the view it switches to.
    replayView(driver) { $('r-view').textContent = driver ? COPY.replay.above : COPY.replay.driver; },
    setTier(t) { segSelect($('tiers'), t); },
    setSeed(s) { $('seed').value = s; },
    setSound(on) { segSelect($('sound-seg'), on ? 'on' : 'off'); $('mute').classList.toggle('muted', !on); },
    setTips(mode) { segSelect($('tips-seg'), mode); },
    setTraffic(level) { segSelect($('traffic-seg'), level); },
    setDrill(drill) { segSelect($('drill-seg'), drill ?? ''); },
    setReady,
    copied() {
      $('copy-l').textContent = COPY.link.copied;
      setTimeout(() => { $('copy-l').textContent = COPY.link.copy; }, COPIED_MS);
    },
  };
}
