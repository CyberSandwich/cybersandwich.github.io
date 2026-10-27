/**
 * HUD and sheets. DOM only, no three.js and no sim: main/run decide, this module shows. Copy comes from ui.js.
 *
 *   const hud = createHud(handlers)
 *     handlers: onTier(t) onShuffle() onStart() onAct() onRetry() onRetryMode(mode) onNew() onChangeTier() onShowReplay()
 *               onReplayAgain() onReplayView() onReplayNext() onMute() onSound(on) onTips(mode) onTraffic(level) onDrill(key|null)
 *               onSeed(text) onCopyLink() onSheet(name | null)
 *   hud.screen('start' | 'run' | 'replay' | 'analysis' | 'none')   which layer of the HUD is up
 *   hud.sheet(name | null) / hud.openSheet                         settings and about float over any screen
 *   hud.route(layout)  hud.speed(mph, limitMph, showMph)  hud.telltale(left, right)
 *   hud.act(label, { enabled, inert })  hud.advice(tone)  hud.chip(text | null, { caption })  hud.edge(pos | null)
 *   hud.tag({ x, y, text } | null)   the culprit's signal in words, pinned above it in a freeze or replay
 *   hud.analysis(view)  hud.toasts(plan, onTap)  hud.resumeToasts()  hud.clearToasts()  hud.fade(opacity)
 *   hud.setTier/setSeed/setSound/setTips/setTraffic/setDrill/setReady/copied/replayView
 */
import { hcLink } from './ui.js';

const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const CHIP_FADE_MS = 350;
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
  const chipEl = $('chip');
  const sheets = { settings: $('settings'), about: $('about') };
  const screens = { start: $('start'), analysis: $('analysis'), replay: $('replaybar') };
  let current = 'none';
  let openSheet = null;
  let chipTimer = 0;
  const queue = { items: [], timer: 0, onTap: null, paused: false };

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
  $('seed').addEventListener('change', (e) => h.onSeed(e.target.value));
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); });
  for (const id of ['copy-link', 'about-btn']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); $(id).click(); } });
  // A tap outside an open sheet closes it (the canvas and HUD gaps both count as outside).
  document.addEventListener('pointerdown', (e) => {
    if (openSheet && !sheets[openSheet].contains(e.target) && !e.target.closest('.corner')) sheet(null);
  }, true);

  function sheet(name) {
    openSheet = name;
    for (const [k, s] of Object.entries(sheets)) s.hidden = k !== name;
    for (const [k, s] of Object.entries(screens)) s.hidden = Boolean(name) || k !== current;
    h.onSheet(name);
  }

  function screen(name) {
    current = name;
    const run = name === 'run';
    act.hidden = !run;
    $('route').hidden = name === 'none' || name === 'replay';
    $('speed').hidden = !run;
    $('mute').hidden = !run;
    $('theme-btn').hidden = run || name === 'replay';
    $('settings-btn').hidden = run || name === 'replay';
    if (!run && name !== 'replay') chip(null);
    if (name !== 'run') edge(null);
    if (name !== 'run' && name !== 'replay') tag(null);
    sheet(null);
  }

  // Clock-face pip: the player's arm at six o'clock, the target exit picked out.
  function route(layout) {
    const pl = layout.player;
    const me = layout.arms[pl.arm];
    const pip = $('pip');
    pip.replaceChildren();
    const ring = 6.5;
    if (layout.type === 'mini') svgEl('circle', { r: 4.5, fill: 'currentColor', stroke: 'none' }, pip);
    else svgEl('circle', { r: ring, 'stroke-width': 2.4 }, pip);
    for (const arm of layout.arms) {
      const a = arm.bearing - (me.bearing + Math.PI);
      const d = [Math.sin(a), -Math.cos(a)];
      const target = arm.index === pl.exitArm;
      const g = svgEl('g', target ? { class: 'tgt' } : {}, pip);
      svgEl('line', { x1: d[0] * ring, y1: d[1] * ring, x2: d[0] * 15, y2: d[1] * 15, 'stroke-width': target ? 3 : 2.2 }, g);
      if (target) svgEl('circle', { cx: d[0] * 15, cy: d[1] * 15, r: 3, fill: 'currentColor', stroke: 'none' }, g);
    }
    $('r-exit').textContent = `Exit ${pl.exitNumber}`;
    const lanes = layout.circulatory.lanes;
    $('r-lane').textContent = lanes > 1 ? `${['Left', lanes === 3 ? 'Middle' : 'Right', 'Right'][pl.lane]} Lane` : '';
    $('r-dest').textContent = `${pl.route.destination} (${pl.route.road})`;
  }

  function chip(text, { caption = false } = {}) {
    clearTimeout(chipTimer);
    if (!text) {
      chipEl.classList.add('off');
      chipTimer = setTimeout(() => { chipEl.hidden = true; }, CHIP_FADE_MS);
      return;
    }
    chipEl.classList.toggle('caption', caption);
    const show = () => {
      chipEl.textContent = text;
      chipEl.hidden = false;
      requestAnimationFrame(() => chipEl.classList.remove('off'));
    };
    // A new line replaces a showing one through a short fade.
    if (!chipEl.hidden && !chipEl.classList.contains('off') && chipEl.textContent !== text) {
      chipEl.classList.add('off');
      chipTimer = setTimeout(show, CHIP_FADE_MS);
    } else show();
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
      const tone = gap.taken ? 100 : gap.length > 6 ? 34 : 14;
      svgEl('rect', { x: x0, y: 14, width: w, height: 14, rx: 4, style: `fill:color-mix(in srgb, var(--t1) ${tone}%, transparent);stroke:none` }, svg);
      // The taken bar only spans opening-to-tap, not a gap between cars, so it carries no length.
      if (w > 30 && !gap.taken) svgEl('text', { x: x0 + w / 2, y: 9, 'text-anchor': 'middle', stroke: 'none' }, svg).textContent = `${gap.length.toFixed(1)} s`;
    }
    if (hasLag) {
      const xn = x(taken.end + taken.lag);
      svgEl('line', { x1: xn, y1: 12, x2: xn, y2: 30, 'stroke-width': 2, style: 'stroke:var(--t1)' }, svg);
      svgEl('text', { x: Math.min(296, xn), y: 39, 'text-anchor': 'end', stroke: 'none' }, svg).textContent = `Next Car ${taken.lag.toFixed(1)} s`;
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

  // Page-local toast queue over base.js's one-at-a-time notify: one verdict per toast, red first (ui.toastPlan).
  function nextToast() {
    clearTimeout(queue.timer);
    if (queue.paused || !queue.items.length) return;
    const item = queue.items.shift();
    window._base.notify(item.title, item.kind === 'ok' ? true : item.kind === 'warn' ? 'warn' : false, () => {
      queue.paused = true;
      queue.onTap?.(item);
    });
    queue.timer = setTimeout(nextToast, item.ms);
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
    edge,
    tag,
    analysis,
    // The mph readout only stands in for the cab's speedometer when that is out of frame; the limit always shows.
    speed(mph, limit, showMph = true) {
      $('mph').textContent = `${mph} mph`;
      $('mph').classList.toggle('off', !showMph);
      $('limit-n').textContent = String(limit);
    },
    telltale(left, right) {
      $('ind-l').classList.toggle('on', left);
      $('ind-r').classList.toggle('on', right);
    },
    toasts(plan, onTap) {
      queue.items.push(...plan);
      queue.onTap = onTap;
      if (!document.querySelector('.notif')) nextToast();
    },
    resumeToasts() { queue.paused = false; nextToast(); },
    clearToasts() { queue.items = []; clearTimeout(queue.timer); document.querySelector('.notif')?.remove(); },
    toast(msg, kind) { window._base.notify(msg, kind === 'ok' ? true : kind === 'warn' ? 'warn' : false); },
    fade(o) { $('fade').style.opacity = String(o); },
    replayView(label) { $('r-view').textContent = label; },
    setTier(t) { segSelect($('tiers'), t); },
    setSeed(s) { $('seed').value = s; },
    setSound(on) { segSelect($('sound-seg'), on ? 'on' : 'off'); $('mute').classList.toggle('muted', !on); },
    setTips(mode) { segSelect($('tips-seg'), mode); },
    setTraffic(level) { segSelect($('traffic-seg'), level); },
    setDrill(drill) { segSelect($('drill-seg'), drill ?? ''); },
    setReady(on) { $('start-btn').disabled = !on; $('start-btn').textContent = on ? 'Start' : 'Loading'; },
    copied() {
      $('copy-l').textContent = 'Copied';
      setTimeout(() => { $('copy-l').textContent = 'Copy Link'; }, COPIED_MS);
    },
  };
}
