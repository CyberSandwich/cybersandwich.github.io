/**
 * Seeded PRNG (mulberry32). Same seed, same sequence, on every platform.
 *
 *   const r = createRng('abc' | 42)
 *   r()                 float in [0, 1)
 *   r.range(a, b)       float in [a, b)
 *   r.int(a, b)         integer in [a, b] inclusive
 *   r.pick(arr)         one element
 *   r.weighted({k: w})  one key, chance proportional to its weight
 *   r.normal(mu, sd)    Box-Muller
 *   r.chance(p)         true with probability p
 *   r.shuffle(arr)      new shuffled array
 *   r.fork(label)       independent stream derived from this seed and label
 */

function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const s = String(seed);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function createRng(seed) {
  const base = hashSeed(seed);
  let state = base;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (a, b) => a + (b - a) * next();
  next.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  next.pick = (arr) => arr[Math.floor(next() * arr.length)];
  next.chance = (p) => next() < p;
  next.normal = (mu = 0, sd = 1) => {
    const u = 1 - next(); // (0, 1]: log(0) would be -Infinity
    const v = next();
    return mu + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };
  next.weighted = (weights) => {
    const keys = Object.keys(weights);
    const total = keys.reduce((sum, k) => sum + weights[k], 0);
    let x = next() * total;
    for (const k of keys) {
      x -= weights[k];
      if (x < 0) return k;
    }
    return keys[keys.length - 1];
  };
  next.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };
  next.fork = (label) => createRng(base + ':' + label);
  return next;
}
