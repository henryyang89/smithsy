import { CONFIG, SLOTS, GRADES } from '../config.js';
import { seededRng, mixSeed } from './rng.js';
import { adventurerCombatant, fight } from './combat.js';
import { enemyCombatant, sampleLevels } from './enemies.js';
import { intelValue } from './intel.js';
import { smithRingTotals } from './rings.js';
import { gearStats, gearPower } from './gear.js';

// Size of the win-chance estimate for this game: the base counts from CONFIG.sim plus `extra`, which
// is the Battle simulation intel track (a count, not a chance, capped by the track's max) plus the best worn
// Foresight ring (a type that does not stack: smithRingTotals only counts its best ring), rounded down. Callers
// pass the result as `opts` to estimateWinChance / estimateWinChanceSync.
export function simCounts(state, cfg = CONFIG) {
  const extra = intelValue(state, 'simDepth', cfg) + Math.floor((smithRingTotals(state, cfg).foresight || 0) + 1e-9);
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

// ------------------------------------------------------------ gear search ----
const STAT_EPS = 1e-9;

// Drop an item when another item of the same gear type is at least as good in every gearStats stat (every stat is
// "more is better", so the dropped item can never be the better choice). Identical items keep the lowest id. Exact:
// it never changes the best loadout, it only makes the search smaller. Keeps the input order.
export function pruneDominated(items, cfg = CONFIG) {
  const stats = new Map(items.map((g) => [g, gearStats(g, cfg)]));
  const atLeast = (a, b) => {
    const sa = stats.get(a);
    const sb = stats.get(b);
    return [...new Set([...Object.keys(sa), ...Object.keys(sb)])].every((k) => (sa[k] || 0) >= (sb[k] || 0) - STAT_EPS);
  };
  // o dominates g: as good everywhere, and either better somewhere or identical with a lower id
  const dominates = (o, g) => atLeast(o, g) && (!atLeast(g, o) || o.id < g.id);
  return items.filter((g) => !items.some((o) => o !== g && o.slot === g.slot && dominates(o, g)));
}

// The search starts from the strongest-looking item of a gear type: highest material x grade, then the higher gem
// grade, then the lower id.
function startItem(list, cfg) {
  const gemRank = (g) => (g.gem ? GRADES.indexOf(g.gem.grade) : -1);
  return list.slice().sort((a, b) => gearPower(b, cfg) - gearPower(a, cfg) || gemRank(b) - gemRank(a) || a.id - b.id)[0];
}

// How good a loadout is, from evalFn's { score, dealt }: more score first, then more enemy HP removed.
const better = (a, b) => a.score > b.score || (a.score === b.score && a.dealt > b.dealt);

// Find the best loadout (one item per gear type) among `items`, any number per type.
// evalFn(loadout) -> { score, dealt } (loadoutEval below; wins + hpLeft/(fights+1), ties by damage dealt).
// Prunes dominated items first. If the product of the per-type counts is at most sim.maxExactCombos every
// combination is tried; otherwise it starts from the strongest item of each type and, for up to sim.searchPasses
// passes, tries every alternative of one type at a time with the others fixed (SLOTS order), keeping improvements,
// and stops early on a pass that changes nothing. Evaluations are cached by the loadout's sorted ids, so
// `evaluated` (the number of evalFn calls) is at most searchPasses x items + 1 in the one-type-at-a-time search.
// Returns { items (SLOTS order), evaluated, best (evalFn's result for the chosen loadout, null if nothing was
// evaluated) }.
export function searchLoadout(items, evalFn, cfg = CONFIG) {
  const kept = pruneDominated(items, cfg);
  const lists = SLOTS.map((slot) => kept.filter((g) => g.slot === slot)).filter((l) => l.length);
  const combos = lists.reduce((n, l) => n * l.length, 1);
  if (combos === 1) return { items: lists.map((l) => l[0]), evaluated: 0, best: null }; // nothing to choose
  const cache = new Map();
  let evaluated = 0;
  const run = (lo) => {
    const key = lo.map((g) => g.id).sort((a, b) => a - b).join(',');
    let r = cache.get(key);
    if (!r) {
      r = evalFn(lo);
      cache.set(key, r);
      evaluated++;
    }
    return r;
  };

  if (combos <= cfg.sim.maxExactCombos) {
    let pick = null;
    let pickR = null;
    for (const lo of loadouts(lists.flat())) {
      const r = run(lo);
      if (!pickR || better(r, pickR)) {
        pick = lo;
        pickR = r;
      }
    }
    return { items: pick, evaluated, best: pickR };
  }

  const cur = lists.map((l) => startItem(l, cfg));
  let best = run(cur);
  for (let pass = 0; pass < cfg.sim.searchPasses; pass++) {
    let changed = false;
    lists.forEach((list, t) => {
      if (list.length < 2) return;
      let bestAlt = cur[t];
      let bestR = best;
      for (const alt of list) {
        if (alt === cur[t]) continue;
        const r = run(cur.map((g, i) => (i === t ? alt : g)));
        if (better(r, bestR)) {
          bestAlt = alt;
          bestR = r;
        }
      }
      if (bestAlt !== cur[t]) {
        cur[t] = bestAlt;
        best = bestR;
        changed = true;
      }
    });
    if (!changed) break;
  }
  return { items: cur, evaluated, best };
}

// evalFn for searchLoadout: `fights` simulated fights per loadout against `enemyC`, the same seed for every
// loadout (common random numbers, so loadouts are compared fairly). score = wins + average HP left / (fights + 1);
// dealt = the enemy HP removed in the fights not won (breaks ties when every loadout lost everything).
export function loadoutEval(ringTotals, enemyC, seed, fights, cfg = CONFIG) {
  return (lo) => {
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
    return { score: wins + hpLeft / (fights + 1), dealt, wins };
  };
}

// Pick the loadout with the most wins over `fights` simulated fights (same random seed for each
// loadout so they are compared fairly). Ties broken by average HP left, then (e.g. when every
// loadout lost every simulated fight) by how much enemy HP was removed in the fights not won.
// Tries every combination in `combos`; searchLoadout is the pruned/slot-by-slot version the game uses.
export function bestLoadout(combos, ringTotals, enemyC, seed, fights, cfg = CONFIG) {
  if (combos.length === 1) return { index: 0, wins: null };
  const evalFn = loadoutEval(ringTotals, enemyC, seed, fights, cfg);
  let best = -1;
  let bestR = null;
  combos.forEach((lo, i) => {
    const r = evalFn(lo);
    if (!bestR || better(r, bestR)) {
      bestR = r;
      best = i;
    }
  });
  return { index: best, wins: bestR.wins };
}

// ------------------------------------------------------------ the estimate ----
// Standard error of the win chance in percentage points: the spread (sample sd) of the per-guess win
// fractions divided by sqrt(guesses), x 100. More guesses and more test fights per guess both shrink it.
// With a single guess there is no spread to measure, so the plain binomial error of its fights is used.
export function winStandardError(fractions, evalFights = 1) {
  const n = fractions.length;
  if (!n) return 0;
  const mean = fractions.reduce((a, f) => a + f, 0) / n;
  if (n < 2) return Math.sqrt((mean * (1 - mean)) / Math.max(1, evalFights)) * 100;
  const variance = fractions.reduce((a, f) => a + (f - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance / n) * 100;
}

// The "±" shown next to an estimate, in whole points: twice the spread of the per-guess results (res.se), but
// never less than the gap between the result and the Wilson bound (z = 2) of ALL its test fights on the side that
// matters. A spread of 0 does not mean certainty: 25 wins out of 25 shows ± 14, not ± 1. null for a result without
// fights.
export function shownMargin(res) {
  const n = res && res.fights;
  if (!n) return null;
  const p = res.wins / n;
  const z = 2;
  const d = 1 + (z * z) / n;
  const c = p + (z * z) / (2 * n);
  const r = z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n));
  const gap = p >= 0.5 ? p - (c - r) / d : (c + r) / d - p;
  return Math.max(1, Math.round(2 * (res.se || 0)), Math.round(100 * gap));
}

// One guess of the hidden attributes: sample them, let the adventurer pick the best gear for that guess, then
// fight `evalFights` fresh fights. Returns { loadout (items), wins (wins + draws), time, hpFrac, evaluated }.
function oneGuess(params, o, rng, s, cfg) {
  const seed = params.seed ?? 1;
  const levels = sampleLevels(rng, params.tier, params.known || {}, cfg);
  const enemyC = enemyCombatant(params.tier, params.day, levels, 'Enemy', cfg);
  const pick = searchLoadout(params.gearItems, loadoutEval(params.ringTotals, enemyC, mixSeed(seed, s, 1), o.fightsPerLoadout, cfg), cfg);
  const adv = adventurerCombatant(pick.items, params.ringTotals, cfg);
  const er = seededRng(mixSeed(seed, s, 2));
  let wins = 0;
  let time = 0;
  let hpFrac = 0;
  for (let f = 0; f < o.evalFights; f++) {
    const r = fight(adv, enemyC, er.next, false, cfg);
    time += r.time;
    if (r.win || r.draw) {
      wins++;
      hpFrac += r.advHp / adv.hp;
    }
  }
  return { loadout: pick.items, wins, time, hpFrac, evaluated: pick.evaluated };
}

// Folds the guesses of one estimate into its result.
function newTally() {
  return { wins: 0, fights: 0, time: 0, hp: 0, fractions: [], usage: new Map(), evaluated: 0 };
}

function addGuess(t, g, o) {
  t.wins += g.wins;
  t.fights += o.evalFights;
  t.time += g.time;
  t.hp += g.hpFrac;
  t.evaluated += g.evaluated;
  t.fractions.push(o.evalFights ? g.wins / o.evalFights : 0);
  const ids = g.loadout.map((x) => x.id).sort((a, b) => a - b).join(',');
  t.usage.set(ids, (t.usage.get(ids) || 0) + 1);
}

function tallyResult(t, o) {
  return {
    winPct: t.fights ? (t.wins / t.fights) * 100 : 0,
    wins: t.wins,
    fights: t.fights,
    se: winStandardError(t.fractions, o.evalFights),
    perGuess: t.fractions.map((f) => f * 100),
    avgTime: t.fights ? t.time / t.fights : 0,
    avgHpLeftPct: t.wins ? (t.hp / t.wins) * 100 : 0,
    evaluated: t.evaluated, // loadouts tried while picking gear (all guesses)
    // which gear the adventurer picked, most common first: ids = the loadout's sorted item ids, e.g. '3,7,12'
    usage: [...t.usage].map(([ids, count]) => ({ ids, count })).sort((a, b) => b.count - a.count),
  };
}

// Estimate win chance against an enemy whose attributes are partly hidden.
// For each sample: guess the hidden attributes (respecting the tier's low/normal/high counts),
// let the adventurer pick the best packed gear for that guess (searchLoadout), then run fresh fights.
// params: { gearItems, ringTotals, tier, day, known, seed }
// Returns a Promise; onProgress(fraction) is called between samples. If it returns false the run stops
// and the Promise resolves to null (a cancelled run has no result).
// Result: { winPct, wins (wins + draws), fights, se (see winStandardError; shownMargin turns a result into the
// "±"), perGuess (win % of each guess), avgTime, avgHpLeftPct, evaluated, usage: [{ ids, count }] }
export async function estimateWinChance(params, opts = {}, onProgress = null, cfg = CONFIG) {
  const o = { ...cfg.sim, ...opts };
  const rng = seededRng(mixSeed(params.seed ?? 1, 0xabc));
  const t = newTally();
  for (let s = 0; s < o.samples; s++) {
    addGuess(t, oneGuess(params, o, rng, s, cfg), o);
    if (onProgress) {
      await new Promise((res) => setTimeout(res, 0)); // let the page breathe (and handle a cancel click)
      if (onProgress((s + 1) / o.samples) === false) return null;
    }
  }
  return tallyResult(t, o);
}

// Synchronous variant for tools/tests (same result, same numbers for the same seed).
export function estimateWinChanceSync(params, opts = {}, cfg = CONFIG) {
  const o = { ...cfg.sim, ...opts };
  const rng = seededRng(mixSeed(params.seed ?? 1, 0xabc));
  const t = newTally();
  for (let s = 0; s < o.samples; s++) addGuess(t, oneGuess(params, o, rng, s, cfg), o);
  return tallyResult(t, o);
}
