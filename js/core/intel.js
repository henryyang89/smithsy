import { CONFIG } from '../config.js';

export function newIntel(cfg = CONFIG) {
  const spent = {};
  for (const k of Object.keys(cfg.intel.tracks)) spent[k] = 0;
  return { points: 0, spent };
}

// Gain from the n-th point (1-based): 10, 9, 8, ... then minGain.
export function gainForPoint(n, cfg = CONFIG) {
  const g = cfg.intel.gainsPerPoint;
  return n <= g.length ? g[n - 1] : cfg.intel.minGain;
}

// Total chance (%) for a track given points spent.
export function intelChanceFor(track, spent, cfg = CONFIG) {
  let c = cfg.intel.tracks[track].base;
  for (let i = 1; i <= spent; i++) c += gainForPoint(i, cfg);
  return Math.min(cfg.intel.maxChance, c);
}

export function intelChance(state, track, cfg = CONFIG) {
  return intelChanceFor(track, state.intel.spent[track] || 0, cfg);
}

export function nextIntelGain(state, track, cfg = CONFIG) {
  const cur = intelChance(state, track, cfg);
  const next = intelChanceFor(track, (state.intel.spent[track] || 0) + 1, cfg);
  return next - cur;
}

export function spendIntel(state, track, cfg = CONFIG) {
  if (!cfg.intel.tracks[track]) return { ok: false, msg: 'Unknown intel track.' };
  if (state.intel.points < 1) return { ok: false, msg: 'No intel points available.' };
  if (nextIntelGain(state, track, cfg) <= 0) return { ok: false, msg: 'Already at maximum.' };
  state.intel.points -= 1;
  state.intel.spent[track] = (state.intel.spent[track] || 0) + 1;
  return { ok: true, msg: `${cfg.intel.tracks[track].name} is now ${intelChance(state, track, cfg)}%.` };
}
