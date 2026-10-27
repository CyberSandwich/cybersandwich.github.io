/**
 * Zero-asset WebAudio: engine hum that follows speed and load, the player's indicator tick, and a faint
 * whoosh for traffic passing close by, panned to its side.
 *
 *   const audio = createAudio({ muted })
 *   audio.start()                  inside a user gesture (the Start tap); browsers block audio before one
 *   audio.update(me, vehicles)     me = player VehicleView (or null), vehicles = snapshot vehicles
 *   audio.setMuted(on)  audio.suspend()  audio.resume()
 */
const GEARS = [[0, 6.2], [5, 3.6], [10, 2.5], [16, 1.9]]; // [from m/s, Hz per m/s] of a 4-cylinder in drive

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

  function loopNoise() {
    const s = ctx.createBufferSource();
    s.buffer = noise;
    s.loop = true;
    s.start();
    return s;
  }

  function start() {
    if (ctx) { resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    ctx = new AC();
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

  function update(me, vehicles) {
    if (!ctx || ctx.state !== 'running') return;
    const t = ctx.currentTime;
    const v = me ? me.speed : 0;
    const [from, k] = GEARS.reduce((g, x) => (v >= x[0] ? x : g), GEARS[0]);
    const f = 30 + (v - from) * k + (from > 0 ? 9 : 0);
    const load = me ? Math.max(0, Math.min(1, me.accel / 1.5)) : 0;
    osc1.frequency.setTargetAtTime(f, t, 0.12);
    osc2.frequency.setTargetAtTime(f * 0.5, t, 0.12);
    engineFilter.frequency.setTargetAtTime(200 + f * 3 + load * 260, t, 0.15);
    engineGain.gain.setTargetAtTime(0.035 + load * 0.03 + Math.min(v, 15) * 0.0012, t, 0.2);
    roadGain.gain.setTargetAtTime(Math.min(v, 15) * 0.006, t, 0.3);

    const lamp = !!(me && me.indicator && me.lamp);
    if (me && me.indicator && lamp !== lastLamp) tick(lamp);
    lastLamp = lamp;

    let level = 0;
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
        level += e;
        // Right of the driver is +pan: cross of forward with the offset.
        pan += e * Math.sign(fx * dz - fz * dx);
      }
    }
    whooshGain.gain.setTargetAtTime(Math.min(0.06, level * 0.004), t, 0.15);
    if (whooshPan.pan) whooshPan.pan.setTargetAtTime(level > 0 ? Math.max(-1, Math.min(1, pan / level)) : 0, t, 0.2);
  }

  function setMuted(on) {
    isMuted = on;
    if (master) master.gain.setTargetAtTime(on ? 0 : 0.9, ctx.currentTime, 0.05);
  }
  function suspend() { ctx?.suspend(); }
  function resume() { if (ctx && ctx.state !== 'running') ctx.resume(); }

  return { start, update, setMuted, suspend, resume, get muted() { return isMuted; } };
}
