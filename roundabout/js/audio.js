/**
 * Zero-asset WebAudio: engine hum that follows speed and load, the player's indicator tick, and a faint
 * whoosh for traffic passing close by, panned to its side.
 *
 *   const audio = createAudio({ muted })
 *   audio.start()                  inside a user gesture (Start, Retry); browsers block audio before one
 *   audio.update(me, vehicles, state, timeScale)   every frame. me = player VehicleView (or null), vehicles =
 *                                  snapshot vehicles, state = run state or 'idle' (no run, a sheet open),
 *                                  timeScale = the run's time scale (the freeze slows it to 0)
 *   audio.horn(pan)                the culprit's horn on an unsafe Go (pan -1 left .. 1 right)
 *   audio.setMuted(on)  audio.suspend()  audio.resume()  audio.dispose()
 *   audioTargets(state, timeScale) pure: { engine, road, tick } levels 0..1 for a state (tested)
 * Every state has an explicit level and anything but driving is silence: gains ramp to 0 (no click), then the
 * context suspends until the next audible frame.
 * The indicator tick follows the player's `lamp` flag, the same blink clock the dash and HUD telltales read.
 * iOS: the context is created and resumed inside the Start tap; navigator.audioSession 'playback' (where
 * supported) lets Web Audio play with the ring/silent switch on.
 */
const GEARS = [[0, 6.2], [5, 3.6], [10, 2.5], [16, 1.9]]; // [from m/s, Hz per m/s] of a 4-cylinder in drive
const HORN_HZ = [405, 500];
const HORN_GAIN = 0.08;
const HORN_SECONDS = 0.7;
const FADE = 0.06; // s time constant of the fade to silence: ~95% gone in 180 ms
const IDLE_SUSPEND_MS = 400; // silent this long, the context suspends
const SILENT = { engine: 0, road: 0, tick: false };
const DRIVING = new Set(['approach', 'atLine', 'onRing', 'exited']);
export const AUDIO_STATES = ['approach', 'atLine', 'onRing', 'exited', 'frozen', 'replay', 'analysis', 'paused', 'idle'];

export function audioTargets(state, timeScale = 1) {
  if (DRIVING.has(state)) return { engine: 1, road: 1, tick: true };
  if (state === 'frozen') {
    const k = Math.max(0, Math.min(1, timeScale));
    return { engine: k, road: k, tick: false };
  }
  return SILENT;
}

function noiseBuffer(ctx) {
  const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = b.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return b;
}

export function createAudio({ muted = false } = {}) {
  let ctx = null;
  let master, engineGain, engineFilter, osc1, osc2, roadGain, whooshGain, whooshPan, noise;
  let lastLamp = false;
  let isMuted = muted;
  let idleTimer = 0;
  let idle = false; // suspended by silence (not by the page being hidden)
  let hornUntil = 0;
  const sources = [];

  function loopNoise() {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start();
    sources.push(s);
    return s;
  }

  function start() {
    if (ctx) { idle = false; resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* older Safari: silent switch applies */ }
    ctx = new AC();
    ctx.resume();
    noise = noiseBuffer(ctx);
    master = ctx.createGain();
    master.gain.value = isMuted ? 0 : 0.9;
    master.connect(ctx.destination);

    engineFilter = ctx.createBiquadFilter();
    engineFilter.type = 'lowpass';
    engineFilter.frequency.value = 240;
    engineFilter.Q.value = 0.7;
    engineGain = ctx.createGain();
    engineGain.gain.value = 0.05;
    osc1 = ctx.createOscillator();
    osc1.type = 'sawtooth';
    osc2 = ctx.createOscillator();
    osc2.type = 'triangle';
    osc1.connect(engineFilter);
    osc2.connect(engineFilter);
    engineFilter.connect(engineGain).connect(master);
    osc1.start();
    osc2.start();
    sources.push(osc1, osc2);

    const road = ctx.createBiquadFilter();
    road.type = 'bandpass';
    road.frequency.value = 380;
    road.Q.value = 0.6;
    roadGain = ctx.createGain();
    roadGain.gain.value = 0;
    loopNoise().connect(road).connect(roadGain).connect(master);

    const wf = ctx.createBiquadFilter();
    wf.type = 'bandpass';
    wf.frequency.value = 850;
    wf.Q.value = 0.8;
    whooshGain = ctx.createGain();
    whooshGain.gain.value = 0;
    whooshPan = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    loopNoise().connect(wf).connect(whooshGain).connect(whooshPan).connect(master);
  }

  function tick(on) {
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'square';
    o.frequency.value = on ? 2300 : 1700;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.03);
    o.connect(g).connect(master);
    o.start(t);
    o.stop(t + 0.04);
  }

  // Ramp every continuous voice to 0, then suspend once the ramp has run its course.
  function silence() {
    const t = ctx.currentTime;
    for (const g of [engineGain, roadGain, whooshGain]) g.gain.setTargetAtTime(0, t, FADE);
    lastLamp = false;
    if (!idle && !idleTimer && ctx.state === 'running') {
      // A horn still sounding (it starts with the freeze) finishes before the context sleeps.
      const wait = Math.max(IDLE_SUSPEND_MS, (hornUntil - t) * 1000 + 100);
      idleTimer = setTimeout(() => { idleTimer = 0; idle = true; ctx?.suspend(); }, wait);
    }
  }

  function update(me, vehicles, state = 'idle', timeScale = 1) {
    if (!ctx) return;
    const level = audioTargets(state, timeScale);
    if (!level.engine && !level.road) { if (!idle) silence(); return; }
    clearTimeout(idleTimer);
    idleTimer = 0;
    if (idle) { idle = false; ctx.resume(); }
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = me ? me.speed : 0;
    const [from, k] = GEARS.reduce((g, x) => (v >= x[0] ? x : g), GEARS[0]);
    const f = (30 + (v - from) * k + (from > 0 ? 9 : 0)) * (0.5 + 0.5 * level.engine);
    const load = me ? Math.max(0, Math.min(1, me.accel / 1.5)) : 0;
    osc1.frequency.setTargetAtTime(f, t, 0.12);
    osc2.frequency.setTargetAtTime(f * 0.5, t, 0.12);
    engineFilter.frequency.setTargetAtTime(200 + f * 3 + load * 260, t, 0.15);
    engineGain.gain.setTargetAtTime((0.035 + load * 0.03 + Math.min(v, 15) * 0.0012) * level.engine, t, level.engine < 1 ? FADE : 0.2);
    roadGain.gain.setTargetAtTime(Math.min(v, 15) * 0.006 * level.road, t, level.road < 1 ? FADE : 0.3);

    const lamp = !!(level.tick && me && me.indicator && me.lamp);
    if (level.tick && me && me.indicator && lamp !== lastLamp) tick(lamp);
    lastLamp = lamp;

    let near = 0;
    let pan = 0;
    if (me) {
      const fx = Math.sin(me.heading);
      const fz = -Math.cos(me.heading);
      for (const w of vehicles) {
        if (w.isPlayer) continue;
        const dx = w.x - me.x;
        const dz = w.z - me.z;
        const d2 = dx * dx + dz * dz;
        if (d2 > 1600) continue;
        const e = w.speed / (1 + d2 / 30);
        near += e;
        // Right of the driver is +pan: cross of forward with the offset.
        pan += e * Math.sign(fx * dz - fz * dx);
      }
    }
    whooshGain.gain.setTargetAtTime(Math.min(0.06, near * 0.004) * level.road, t, 0.15);
    if (whooshPan.pan) whooshPan.pan.setTargetAtTime(near > 0 ? Math.max(-1, Math.min(1, pan / near)) : 0, t, 0.2);
  }

  // Two-tone horn (about 400 and 500 Hz square, like a car's pair), panned to the culprit's side.
  function horn(pan = 0) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    hornUntil = t + HORN_SECONDS;
    const g = ctx.createGain();
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    if (p) p.pan.value = Math.max(-1, Math.min(1, pan));
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(HORN_GAIN, t + 0.02);
    g.gain.setValueAtTime(HORN_GAIN, t + HORN_SECONDS - 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + HORN_SECONDS);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    for (const f of HORN_HZ) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + HORN_SECONDS);
    }
    lp.connect(g);
    (p ? g.connect(p) : g).connect(master);
  }

  function setMuted(on) {
    isMuted = on;
    if (master) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.05);
  }
  function suspend() { ctx?.suspend(); }
  function resume() { if (ctx && !idle && ctx.state !== 'running') ctx.resume(); }

  function dispose() {
    clearTimeout(idleTimer);
    for (const s of sources) { try { s.stop(); } catch (_) { /* never started */ } s.disconnect(); }
    sources.length = 0;
    ctx?.close();
    ctx = null;
  }

  return {
    start, update, horn, setMuted, suspend, resume, dispose,
    get muted() { return isMuted; },
    // QA: the context state and the continuous voices' current gains.
    get qa() { return ctx ? { state: ctx.state, engine: engineGain.gain.value, road: roadGain.gain.value } : null; },
  };
}
