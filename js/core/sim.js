import { CONFIG, SLOTS } from '../config.js';
import { seededRng, mixSeed } from './rng.js';
import { adventurerCombatant, fight } from './combat.js';
import { enemyCombatant, sampleLevels } from './enemies.js';
import { intelChance } from './intel.js';
import { smithRingTotals } from './rings.js';

// Size of the win-chance estimate for this game: the base counts from CONFIG.sim plus `extra`, which
// is the Battle simulation intel track (a count, not a chance) plus the worn Foresight rings (rounded
// down). Callers pass the result as `opts` to estimateWinChance / estimateWinChanceSync.
export function simCounts(state, cfg = CONFIG) {
  const extra = intelChance(state, 'simDepth', cfg) + Math.floor((smithRingTotals(state, cfg).foresight || 0) + 1e-9);
  const b = cfg.sim;
  return { samples: b.samples + extra, evalFights: b.evalFights + extra, fightsPerLoadout: b.fightsPerLoadout + extra, extra };
}

// All gear combinations: one item (or nothing, if none packed) per slot.
export function loadouts(gearItems) {
  let combos = [[]];
  for (const slot of SLOTS) {
    const opts = gearItems.filter((g) => g.slot === slot);
    if (!opts.length) continue;
    const next = [];
    for (const c of combos) for (const o of opts) next.push([...c, o]);
    combos = next;
  }
  return combos;
}

// Pick the loadout with the most wins over `fights` simulated fights (same random seed for each
// loadout so they are compared fairly). Ties broken by average HP left, then (e.g. when every
// loadout lost every simulated fight) by how much enemy HP was removed in the fights not won.
export function bestLoadout(combos, ringTotals, enemyC, seed, fights, cfg = CONFIG) {
  if (combos.length === 1) return { index: 0, wins: null };
  let best = -1;
  let bestScore = -Infinity;
  let bestDealt = -Infinity;
  let bestWins = 0;
  combos.forEach((lo, i) => {
    const adv = adventurerCombatant(lo, ringTotals, cfg);
    const rng = seededRng(seed);
    let wins = 0;
    let hpLeft = 0;
    let dealt = 0;
    for (let f = 0; f < fights; f++) {
      const r = fight(adv, enemyC, rng.next, false, cfg);
      if (r.win) {
        wins++;
        hpLeft += r.advHp / adv.hp;
      } else dealt += 1 - r.enemyHp / enemyC.hp;
    }
    const score = wins + hpLeft / (fights + 1);
    if (score > bestScore || (score === bestScore && dealt > bestDealt)) {
      bestScore = score;
      bestDealt = dealt;
      best = i;
      bestWins = wins;
    }
  });
  return { index: best, wins: bestWins };
}

// Estimate win chance against an enemy whose attributes are partly hidden.
// For each sample: guess the hidden attributes (respecting the tier's low/normal/high counts),
// let the adventurer pick the best packed gear for that guess, then run fresh fights.
// params: { gearItems, ringTotals, tier, day, known, seed }
// Returns a Promise; onProgress(fraction) is called between samples.
export async function estimateWinChance(params, opts = {}, onProgress = null, cfg = CONFIG) {
  const o = { ...cfg.sim, ...opts };
  const combos = loadouts(params.gearItems);
  const rng = seededRng(mixSeed(params.seed ?? 1, 0xabc));
  let wins = 0;
  let fights = 0;
  let timeSum = 0;
  let hpSum = 0;
  const usage = new Array(combos.length).fill(0);
  for (let s = 0; s < o.samples; s++) {
    const levels = sampleLevels(rng, params.tier, params.known || {}, cfg);
    const enemyC = enemyCombatant(params.tier, params.day, levels, 'Enemy', cfg);
    const pick = bestLoadout(combos, params.ringTotals, enemyC, mixSeed(params.seed ?? 1, s, 1), o.fightsPerLoadout, cfg);
    usage[pick.index]++;
    const adv = adventurerCombatant(combos[pick.index], params.ringTotals, cfg);
    const er = seededRng(mixSeed(params.seed ?? 1, s, 2));
    for (let f = 0; f < o.evalFights; f++) {
      const r = fight(adv, enemyC, er.next, false, cfg);
      fights++;
      timeSum += r.time;
      if (r.win || r.draw) {
        wins++;
        hpSum += r.advHp / adv.hp;
      }
    }
    if (onProgress) {
      onProgress((s + 1) / o.samples);
      await new Promise((res) => setTimeout(res, 0));
    }
  }
  return {
    winPct: fights ? (wins / fights) * 100 : 0,
    fights,
    avgTime: fights ? timeSum / fights : 0,
    avgHpLeftPct: wins ? (hpSum / wins) * 100 : 0,
    usage: combos.map((lo, i) => ({ items: lo.map((g) => g.id), count: usage[i] })).filter((u) => u.count > 0).sort((a, b) => b.count - a.count),
  };
}

// Synchronous variant for tools/tests.
export function estimateWinChanceSync(params, opts = {}, cfg = CONFIG) {
  const o = { ...cfg.sim, ...opts };
  const combos = loadouts(params.gearItems);
  const rng = seededRng(mixSeed(params.seed ?? 1, 0xabc));
  let wins = 0;
  let fights = 0;
  for (let s = 0; s < o.samples; s++) {
    const levels = sampleLevels(rng, params.tier, params.known || {}, cfg);
    const enemyC = enemyCombatant(params.tier, params.day, levels, 'Enemy', cfg);
    const pick = bestLoadout(combos, params.ringTotals, enemyC, mixSeed(params.seed ?? 1, s, 1), o.fightsPerLoadout, cfg);
    const adv = adventurerCombatant(combos[pick.index], params.ringTotals, cfg);
    const er = seededRng(mixSeed(params.seed ?? 1, s, 2));
    for (let f = 0; f < o.evalFights; f++) {
      const r = fight(adv, enemyC, er.next, false, cfg);
      if (r.win || r.draw) wins++;
      fights++;
    }
  }
  return { winPct: fights ? (wins / fights) * 100 : 0, fights };
}
