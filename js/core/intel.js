import { CONFIG } from '../config.js';

// Intel tracks (config: intel.tracks). Each track has a unit ('%', 'sight' or 'count'), a base value, a list
// of gains (what each point spent on the track adds; the last value repeats) and a max.

export function newIntel(cfg = CONFIG) {
  const spent = {};
  for (const k of Object.keys(cfg.intel.tracks)) spent[k] = 0;
  return { points: 0, spent };
}

// What the n-th point (1-based) spent on `track` adds. The last value of the track's list repeats.
export function gainForPoint(track, n, cfg = CONFIG) {
  const g = cfg.intel.tracks[track].gains;
  return g[Math.min(Math.max(1, n), g.length) - 1];
}

// A track's value after `spent` points: min(max, base + the gains of the points spent).
export function intelValueFor(track, spent, cfg = CONFIG) {
  const t = cfg.intel.tracks[track];
  let v = t.base;
  for (let i = 1; i <= spent; i++) {
    if (v >= t.max) break; // maxed: more points change nothing (and a huge `spent` stays cheap)
    v += gainForPoint(track, i, cfg);
  }
  return Math.min(t.max, v);
}

export function intelValue(state, track, cfg = CONFIG) {
  return intelValueFor(track, state.intel.spent[track] || 0, cfg);
}

// What the next point on `track` would add (0 at the max).
export function nextIntelGain(state, track, cfg = CONFIG) {
  const cur = intelValue(state, track, cfg);
  const next = intelValueFor(track, (state.intel.spent[track] || 0) + 1, cfg);
  return next - cur;
}

// "25%" for a chance, "20 sight" for sight, "+3" for a count.
export function trackValueText(track, value, cfg = CONFIG) {
  const unit = cfg.intel.tracks[track].unit;
  if (unit === 'sight') return `${value} sight`;
  if (unit === 'count') return `+${value}`;
  return `${value}%`;
}

// True when the player has a point and at least one track that it could still raise.
export function canSpendIntel(state, cfg = CONFIG) {
  return state.intel.points >= 1 && Object.keys(cfg.intel.tracks).some((k) => nextIntelGain(state, k, cfg) > 0);
}

export function spendIntel(state, track, cfg = CONFIG) {
  if (!cfg.intel.tracks[track]) return { ok: false, msg: 'Unknown intel track.' };
  if (state.intel.points < 1) return { ok: false, msg: 'No intel points available.' };
  if (nextIntelGain(state, track, cfg) <= 0) return { ok: false, msg: 'Already at maximum.' };
  state.intel.points -= 1;
  state.intel.spent[track] = (state.intel.spent[track] || 0) + 1;
  return { ok: true, msg: `${cfg.intel.tracks[track].name} is now ${trackValueText(track, intelValue(state, track, cfg), cfg)}.` };
}
