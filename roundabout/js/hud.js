/**
 * HUD and sheets. DOM only: main.js decides, this module shows.
 *
 *   const hud = createHud(handlers)   handlers: onTier, onStart, onAct, onRetry, onNew, onChangeTier, onExplain,
 *                                     onExplainDone, onReplay, onMute, onSound, onTips, onSeed
 *   hud.mode('start' | 'run' | 'analysis' | 'explain' | 'none')
 *   hud.route(layout)  hud.act(label, enabled)  hud.tip(text | null)  hud.fade(opacity)
 *   hud.analysis(data)  hud.explain(verdict)  hud.toast(msg, kind, onTap)
 */
const $ = (id) => document.getElementById(id);
const NS = 'http://www.w3.org/2000/svg';
const HC_PAGE = 'https://www.gov.uk/guidance/the-highway-code/using-the-road-159-to-203';

export function hcLink(ref) {
  const m = /^HC (\d+)$/.exec(ref ?? '');
  if (m) return { text: `Highway Code Rule ${m[1]}`, href: `${HC_PAGE}#rule${m[1]}` };
  if (ref && /hesitation/i.test(ref)) return { text: 'Driving Test Fault: Undue Hesitation', href: null };
  return null;
}

const el = (tag, attrs = {}, parent) => {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
  parent?.appendChild(e);
  return e;
};

function kvRow(k, v) {
  const row = document.createElement('div');
  row.className = 'kv';
  const a = document.createElement('span');
  a.textContent = k;
  const b = document.createElement('b');
  b.textContent = v;
  row.append(a, b);
  return row;
}

function segSelect(row, value) {
  for (const b of row.querySelectorAll('.seg')) b.classList.toggle('active', (b.dataset.v ?? b.dataset.tier) === value);
}

export function createHud(h) {
  const act = $('act');
  const tipEl = $('tip');
  const sheets = { start: $('start'), analysis: $('analysis'), explain: $('explain'), about: $('about') };
  let tipTimer = 0;

  $('tiers').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) h.onTier(b.dataset.tier); });
  $('start-btn').addEventListener('click', () => h.onStart());
  act.addEventListener('click', () => { act.blur(); h.onAct(); });
  $('more-btn').addEventListener('click', (e) => {
    const open = $('more').hidden;
    $('more').hidden = !open;
    e.currentTarget.setAttribute('aria-expanded', String(open));
  });
  $('seed').addEventListener('change', (e) => h.onSeed(e.target.value.trim()));
  $('seed').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.target.blur(); e.stopPropagation(); });
  $('sound-seg').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) h.onSound(b.dataset.v === 'on'); });
  $('tips-seg').addEventListener('click', (e) => { const b = e.target.closest('.seg'); if (b) h.onTips(b.dataset.v === 'on'); });
  $('about-btn').addEventListener('click', () => { sheets.start.hidden = true; sheets.about.hidden = false; });
  $('about-done').addEventListener('click', () => { sheets.about.hidden = true; sheets.start.hidden = false; });
  $('mute').addEventListener('click', () => h.onMute());
  $('a-retry').addEventListener('click', () => h.onRetry());
  $('a-new').addEventListener('click', () => h.onNew());
  $('a-tier').addEventListener('click', () => h.onChangeTier());
  $('a-explain').addEventListener('click', () => h.onExplain());
  $('e-done').addEventListener('click', () => h.onExplainDone());
  $('e-replay').addEventListener('click', () => h.onReplay());

  function mode(m) {
    for (const [k, s] of Object.entries(sheets)) s.hidden = k !== m;
    const run = m === 'run';
    $('route').hidden = !(run || m === 'analysis' || m === 'explain');
    act.hidden = !run;
    $('mute').hidden = m === 'start';
    $('theme-btn').hidden = m !== 'start';
    if (!run) tip(null);
    document.querySelector('.notif')?.remove();
  }

  // Clock-face pip: the player's arm at six o'clock, the target exit picked out.
  function route(layout) {
    const pl = layout.player;
    const me = layout.arms[pl.arm];
    const pip = $('pip');
    pip.replaceChildren();
    const ring = 6.5;
    if (layout.type === 'mini') el('circle', { r: 4.5, fill: 'currentColor', stroke: 'none' }, pip);
    else el('circle', { r: ring, 'stroke-width': 2.4 }, pip);
    for (const arm of layout.arms) {
      const a = arm.bearing - (me.bearing + Math.PI);
      const d = [Math.sin(a), -Math.cos(a)];
      const target = arm.index === pl.exitArm;
      const g = el('g', target ? { class: 'tgt' } : {}, pip);
      el('line', { x1: d[0] * ring, y1: d[1] * ring, x2: d[0] * 16, y2: d[1] * 16, 'stroke-width': target ? 3 : 2.2 }, g);
      if (target) el('circle', { cx: d[0] * 16, cy: d[1] * 16, r: 3, fill: 'currentColor', stroke: 'none' }, g);
    }
    $('r-exit').textContent = `Exit ${pl.exitNumber}`;
    const lanes = layout.circulatory.lanes;
    $('r-lane').textContent = lanes > 1 ? `${['Left', lanes === 3 ? 'Middle' : 'Right', 'Right'][pl.lane]} Lane` : '';
    $('r-dest').textContent = `${pl.route.destination} (${pl.route.road})`;
  }

  function setAct(label, enabled) {
    act.textContent = label;
    act.disabled = !enabled;
  }

  function tip(text) {
    clearTimeout(tipTimer);
    if (!text) {
      tipEl.classList.add('off');
      tipTimer = setTimeout(() => { tipEl.hidden = true; }, 350);
      return;
    }
    tipEl.textContent = text;
    tipEl.hidden = false;
    requestAnimationFrame(() => tipEl.classList.remove('off'));
  }

  function gapsChart(g) {
    const svg = $('a-gaps');
    svg.replaceChildren();
    const span = Math.max(0.5, g.end - g.start);
    const x = (t) => ((t - g.start) / span) * 300;
    for (const gap of g.gaps) {
      const x0 = x(gap.start) + (gap.start > g.start ? 1.5 : 0);
      const w = Math.max(2, x(gap.end) - x0);
      const tone = gap.taken ? 100 : gap.length > 6 ? 34 : 14;
      el('rect', { x: x0, y: 14, width: w, height: 14, rx: 4, style: `fill:color-mix(in srgb, var(--t1) ${tone}%, transparent);stroke:none` }, svg);
      if (w > 28) {
        const t = el('text', { x: x0 + w / 2, y: 9, 'text-anchor': 'middle', stroke: 'none' }, svg);
        t.textContent = `${gap.length.toFixed(1)} s`;
      }
      if (gap.taken) {
        const t = el('text', { x: Math.min(296, x0 + w), y: 39, 'text-anchor': 'end', stroke: 'none' }, svg);
        t.textContent = 'Go';
      }
    }
  }

  function analysis(d) {
    $('a-title').textContent = d.title;
    $('a-reason').textContent = d.reason;
    $('a-reason').hidden = !d.reason;
    $('a-explain').hidden = !d.explain;
    $('a-gap-sec').hidden = !d.gaps;
    if (d.gaps) gapsChart(d.gaps);
    $('a-react').textContent = d.reactText ?? '';
    $('a-car-sec').hidden = !d.cars.length;
    $('a-cars').replaceChildren(...d.cars.map((c) => kvRow(c.name, c.value)));
    $('a-dec').replaceChildren(...d.decisions.map(([k, v]) => kvRow(k, v)));
    mode('analysis');
    sheets.analysis.scrollTop = 0;
  }

  function explain(v, title) {
    $('e-title').textContent = title;
    $('e-reason').textContent = v.reason;
    const ref = hcLink(v.hcRef);
    const a = $('e-ref');
    a.hidden = !ref;
    if (ref) {
      a.textContent = ref.text;
      if (ref.href) a.href = ref.href;
      else a.removeAttribute('href');
    }
    mode('explain');
  }

  return {
    mode,
    route,
    act: setAct,
    tip,
    analysis,
    explain,
    fade(o) { $('fade').style.opacity = String(o); },
    toast(msg, kind, onTap) { window._base.notify(msg, kind === 'ok' ? true : kind === 'warn' ? 'warn' : false, onTap); },
    setTier(t) { segSelect($('tiers'), t); },
    setStreak(text) { $('streak').textContent = text; },
    setReady(on, label = 'Start') { $('start-btn').disabled = !on; $('start-btn').textContent = on ? label : 'Loading'; },
    setSeed(s) { $('seed').value = s; },
    setSound(on) { segSelect($('sound-seg'), on ? 'on' : 'off'); $('mute').classList.toggle('muted', !on); },
    setTips(on) { segSelect($('tips-seg'), on ? 'on' : 'off'); },
    get actEnabled() { return !act.hidden && !act.disabled; },
  };
}
