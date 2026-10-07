// Seeded random numbers (mulberry32). The game's RNG state lives in state.rng = { s }
// so saves reproduce exactly. Simulations use their own throwaway RNGs.

export function nextFloat(holder) {
  holder.s = (holder.s + 0x6d2b79f5) >>> 0;
  let t = holder.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

// Wraps a holder ({ s }) with helpers. Every call advances holder.s.
export function makeRng(holder) {
  const next = () => nextFloat(holder);
  return {
    next,
    // integer in [min, max] inclusive
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    float: (min, max) => min + next() * (max - min),
    // p is a percentage 0..100
    chance: (pct) => next() * 100 < pct,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // weights: { key: weight }. Returns a key.
    weighted: (weights) => {
      let total = 0;
      for (const k in weights) total += Math.max(0, weights[k]);
      let roll = next() * total;
      let last = null;
      for (const k in weights) {
        const w = Math.max(0, weights[k]);
        if (w <= 0) continue;
        last = k;
        if (roll < w) return k;
        roll -= w;
      }
      return last;
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
  };
}

// Standalone RNG from a numeric seed (for simulations).
export function seededRng(seed) {
  return makeRng({ s: seed >>> 0 });
}

export function rngFor(state) {
  return makeRng(state.rng);
}

// Mix several integers into one 32-bit seed.
export function mixSeed(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) {
    h ^= n >>> 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
  }
  return h >>> 0;
}
