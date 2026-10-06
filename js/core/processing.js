import { CONFIG, GRADES } from '../config.js';
import { clamp, reduced, round1, EPS } from './util.js';
import { smithBonuses } from './bonuses.js';
import { addXp, itemXp } from './skills.js';
import { rngFor } from './rng.js';

const ORDER = ['S', 'A', 'B', 'C', 'D', 'F'];

// Apply failure reduction (moved into D) and upgrade luck (each success has u% to go up one grade).
export function adjustDistribution(base, failRed, upgradePct) {
  const d = { ...base };
  const red = clamp(failRed, 0, d.F);
  d.F -= red;
  d.D += red;
  const u = clamp(upgradePct, 0, 100) / 100;
  return {
    S: d.S + d.A * u,
    A: d.A * (1 - u) + d.B * u,
    B: d.B * (1 - u) + d.C * u,
    C: d.C * (1 - u) + d.D * u,
    D: d.D * (1 - u),
    F: d.F,
  };
}

export function refineDistribution(state, bar, cfg = CONFIG) {
  const b = smithBonuses(state, cfg);
  return adjustDistribution(cfg.refine[bar].dist, b.oreFailRed(bar), b.oreUpgrade(bar));
}

export function cutDistribution(state, gem, cfg = CONFIG) {
  const b = smithBonuses(state, cfg);
  return adjustDistribution(cfg.cut[gem].dist, b.gemFailRed(gem), b.gemUpgrade(gem));
}

export function refineMinutes(state, bar, cfg = CONFIG) {
  return round1(reduced(cfg.refine[bar].minutes, smithBonuses(state, cfg).refineTimePct, cfg.processing.maxTimeReduction));
}

export function cutMinutes(state, gem, cfg = CONFIG) {
  return round1(reduced(cfg.cut[gem].minutes, smithBonuses(state, cfg).cutTimePct, cfg.processing.maxTimeReduction));
}

export function rollGrade(rng, dist) {
  return rng.weighted(Object.fromEntries(ORDER.map((g) => [g, dist[g]])));
}

function atCampWorking(state) {
  if (state.phase !== 'work') return 'Not during the work day.';
  if (state.location.x !== state.map.camp.x || state.location.y !== state.map.camp.y) return 'You must be at camp.';
  return null;
}

export function canRefine(state, bar, cfg = CONFIG) {
  const input = cfg.refine[bar].input;
  return Object.entries(input).every(([ore, n]) => (state.storage.ore[ore] || 0) >= n);
}

export function refine(state, bar, cfg = CONFIG) {
  const err = atCampWorking(state);
  if (err) return { ok: false, msg: err };
  const r = cfg.refine[bar];
  if (!r) return { ok: false, msg: 'Unknown bar.' };
  if (!canRefine(state, bar, cfg)) return { ok: false, msg: `Not enough ore for a ${bar} bar.` };
  const minutes = refineMinutes(state, bar, cfg);
  if (state.time + minutes > cfg.time.dayEndMin + EPS) return { ok: false, msg: 'Not enough time left today.' };
  for (const [ore, n] of Object.entries(r.input)) state.storage.ore[ore] -= n;
  const grade = rollGrade(rngFor(state), refineDistribution(state, bar, cfg));
  state.time += minutes;
  const notes = [];
  addXp(state, 'refineTime', minutes, notes, cfg);
  addXp(state, `oreGrade_${bar}`, itemXp(bar, cfg), notes, cfg);
  addXp(state, `oreFail_${bar}`, itemXp(bar, cfg), notes, cfg);
  if (grade === 'F') return { ok: true, grade, minutes, notes, msg: `Refining ${bar} failed (${round1(minutes)}m). Ore lost.` };
  const k = `${bar}:${grade}`;
  state.storage.bars[k] = (state.storage.bars[k] || 0) + 1;
  return { ok: true, grade, minutes, notes, msg: `Refined a ${grade}-grade ${bar} bar (${round1(minutes)}m).` };
}

export function cut(state, gem, cfg = CONFIG) {
  const err = atCampWorking(state);
  if (err) return { ok: false, msg: err };
  if (!cfg.cut[gem]) return { ok: false, msg: 'Unknown gem.' };
  if ((state.storage.gem[gem] || 0) < 1) return { ok: false, msg: `No raw ${gem}.` };
  const minutes = cutMinutes(state, gem, cfg);
  if (state.time + minutes > cfg.time.dayEndMin + EPS) return { ok: false, msg: 'Not enough time left today.' };
  state.storage.gem[gem] -= 1;
  const grade = rollGrade(rngFor(state), cutDistribution(state, gem, cfg));
  state.time += minutes;
  const notes = [];
  addXp(state, 'cutTime', minutes, notes, cfg);
  addXp(state, `gemGrade_${gem}`, itemXp(gem, cfg), notes, cfg);
  addXp(state, `gemFail_${gem}`, itemXp(gem, cfg), notes, cfg);
  if (grade === 'F') return { ok: true, grade, minutes, notes, msg: `Cutting ${gem} failed (${round1(minutes)}m). Gem lost.` };
  const k = `${gem}:${grade}`;
  state.storage.cut[k] = (state.storage.cut[k] || 0) + 1;
  return { ok: true, grade, minutes, notes, msg: `Cut a ${grade}-grade ${gem} (${round1(minutes)}m).` };
}

// Repeat an action until it fails (out of material or time). Returns a combined result.
export function repeat(state, fn, maxTimes = Infinity) {
  const results = [];
  for (let i = 0; i < maxTimes; i++) {
    const r = fn();
    if (!r.ok) {
      if (!results.length) return r;
      break;
    }
    results.push(r);
  }
  const counts = {};
  for (const r of results) counts[r.grade] = (counts[r.grade] || 0) + 1;
  const summary = ORDER.filter((g) => counts[g]).map((g) => `${g}x${counts[g]}`).join(' ');
  const minutes = results.reduce((a, r) => a + r.minutes, 0);
  return { ok: true, msg: `Done ${results.length}x in ${round1(minutes)}m: ${summary}`, notes: results.flatMap((r) => r.notes || []), results };
}

export { GRADES, ORDER as GRADE_ORDER };
