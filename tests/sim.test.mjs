import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS } from '../js/config.js';
import { CONFIG } from '../js/config.js';
import { loadouts, bestLoadout, estimateWinChance, estimateWinChanceSync, simCounts, pruneDominated, searchLoadout, loadoutEval, shownMargin } from '../js/core/sim.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { gearPower } from '../js/core/gear.js';
import { spendIntel, intelValueFor } from '../js/core/intel.js';
import { endDay, confirmPlan } from '../js/core/game.js';
import { allLevels, cfgWith, combatant, game, addGear, addRing, fullSet, WEAK_ENEMIES, DEADLY_ENEMIES } from './helpers.mjs';

// Nobody can hurt anybody (unarmed adventurer, harmless enemies) and fights are cut short: every fight is a draw.
const HARMLESS = cfgWith({ adventurer: { unarmedDamage: 0 }, enemies: { tiers: { normal: { damage: 0 }, elite: { damage: 0 }, champion: { damage: 0 } } }, combat: { safetyCapSeconds: 30 } });

let nextId = 1;
const item = (slot, material = 'copper', grade = 'D', gem = null) => ({ id: nextId++, slot, material, grade, gem, durability: 100, packed: true });
const set = (material, grade) => SLOTS.map((s) => item(s, material, grade));
const FAST = { samples: 8, fightsPerLoadout: 20, evalFights: 25 };
// Two swords that neither beats the other in every stat (so neither is pruned): a strong plain one and a weak one
// with an emerald (accuracy).
const TWO_SWORDS = () => [item('sword', 'iron', 'C'), item('sword', 'copper', 'D', { type: 'emerald', grade: 'D' })];

test('loadouts: one item per packed slot, count = product of per-slot options', () => {
  assert.deepEqual(loadouts([]), [[]]);
  const sw = [item('sword'), item('sword', 'iron')];
  const ch = [item('chest'), item('chest', 'iron')];
  const bt = [item('boots')];
  const combos = loadouts([...sw, ...ch, ...bt]);
  assert.equal(combos.length, 2 * 2 * 1);
  for (const c of combos) {
    assert.equal(c.length, 3);
    assert.deepEqual(c.map((g) => g.slot), ['sword', 'chest', 'boots']);
  }
  const keys = new Set(combos.map((c) => c.map((g) => g.id).join(',')));
  assert.equal(keys.size, 4, 'all combinations distinct');
  // two per slot in all 5 slots -> 32 combos (the documented maximum)
  const full = SLOTS.flatMap((s) => [item(s), item(s, 'iron')]);
  assert.equal(loadouts(full).length, 32);
  // a single item -> one combo with that item
  const one = item('helmet');
  assert.deepEqual(loadouts([one]), [[one]]);
});

test('bestLoadout picks the clearly better sword and armor', () => {
  const enemy = enemyCombatant('elite', 3, allLevels('normal'));
  const weak = item('sword', 'copper', 'D');
  const strong = item('sword', 'mythril', 'S');
  const combos = loadouts([weak, strong]);
  const pick = bestLoadout(combos, {}, enemy, 123, 60);
  assert.equal(combos[pick.index][0], strong);
  // order does not matter
  const combos2 = loadouts([strong, weak]);
  assert.equal(combos2[bestLoadout(combos2, {}, enemy, 123, 60).index][0], strong);
});

test('bestLoadout: when every loadout loses every simulated fight, the one that does more damage wins the tie', () => {
  // An enemy that cannot be killed: every loadout loses every fight. The better chest survives longer
  // and so removes more enemy HP.
  const champ = combatant({ hp: 1e9, damage: 25, accuracy: 120 });
  for (const order of [[1, 2], [2, 1]]) {
    const chests = { 1: item('chest', 'copper', 'D'), 2: item('chest', 'mythril', 'S') };
    const gear = [item('sword', 'steel', 'B'), ...order.map((k) => chests[k])];
    const c3 = loadouts(gear);
    const pick = bestLoadout(c3, {}, champ, 9, 60);
    assert.equal(pick.wins, 0);
    assert.equal(c3[pick.index].find((g) => g.slot === 'chest').material, 'mythril');
  }
});

test('bestLoadout: a single combo is returned without simulating', () => {
  const enemy = enemyCombatant('normal', 1, allLevels('normal'));
  assert.deepEqual(bestLoadout([[]], {}, enemy, 1, 10), { index: 0, wins: null });
});

test('bestLoadout is deterministic for a seed', () => {
  const enemy = enemyCombatant('elite', 4, allLevels('normal'));
  const gear = [item('sword', 'iron', 'C'), item('sword', 'steel', 'D'), item('boots', 'iron', 'D'), item('boots', 'copper', 'A')];
  const c = loadouts(gear);
  assert.deepEqual(bestLoadout(c, {}, enemy, 55, 40), bestLoadout(c, {}, enemy, 55, 40));
});

test('estimateWinChanceSync: 100% when the enemy cannot win, 0% when it cannot lose', () => {
  const weak = estimateWinChanceSync({ gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 }, FAST, cfgWith(WEAK_ENEMIES));
  assert.equal(weak.fights, FAST.samples * FAST.evalFights);
  assert.equal(weak.winPct, 100);
  const deadly = estimateWinChanceSync({ gearItems: set('mythril', 'S'), ringTotals: {}, tier: 'champion', day: 30, known: {}, seed: 1 }, FAST, cfgWith(DEADLY_ENEMIES));
  assert.equal(deadly.winPct, 0);
});

test('estimateWinChanceSync: top gear beats unarmed against the same enemy (default config)', () => {
  const p = { ringTotals: {}, tier: 'elite', day: 3, known: {}, seed: 4 };
  const top = estimateWinChanceSync({ ...p, gearItems: set('mythril', 'S') }, FAST).winPct;
  const none = estimateWinChanceSync({ ...p, gearItems: [] }, FAST).winPct;
  assert.ok(top > none, `${top} > ${none}`);
});

test('estimateWinChanceSync counts draws (safety cap reached) as survival', () => {
  const r = estimateWinChanceSync({ gearItems: [], ringTotals: {}, tier: 'champion', day: 1, known: {}, seed: 3 }, FAST, HARMLESS);
  assert.equal(r.fights, FAST.samples * FAST.evalFights);
  assert.equal(r.winPct, 100);
});

test('estimateWinChance (async) counts draws as survival with full HP and time = safety cap', async () => {
  const r = await estimateWinChance({ gearItems: [], ringTotals: {}, tier: 'elite', day: 2, known: {}, seed: 3 }, FAST, null, HARMLESS);
  assert.equal(r.winPct, 100);
  assert.equal(r.avgTime, HARMLESS.combat.safetyCapSeconds);
  assert.equal(r.avgHpLeftPct, 100);
});

test('estimateWinChanceSync is deterministic and respects fully known attributes', () => {
  // HP is the only attribute that decides here: low HP enemies die at once, high HP enemies cannot be killed
  const cfg = cfgWith({ enemies: { attributes: { hp: { values: { low: 0.01, normal: 100, high: 1e9 } } } } });
  const p = { gearItems: [item('sword', 'iron', 'B'), item('chest', 'iron', 'B')], ringTotals: { health: 5 }, tier: 'elite', day: 4, known: {}, seed: 77 };
  const a = estimateWinChanceSync(p, FAST, cfg);
  assert.deepEqual(a, estimateWinChanceSync(p, FAST, cfg));
  // all attributes known (the tier's low/normal/high counts do not apply then)
  const lowAll = estimateWinChanceSync({ ...p, known: allLevels('low') }, FAST, cfg).winPct;
  const highAll = estimateWinChanceSync({ ...p, known: allLevels('high') }, FAST, cfg).winPct;
  assert.ok(lowAll > 95, `low ${lowAll}`);
  assert.equal(highAll, 0);
  // only HP known: the rest is sampled, but HP alone already decides
  assert.equal(estimateWinChanceSync({ ...p, known: { hp: 'high' } }, FAST, cfg).winPct, 0);
  // default config is deterministic too
  assert.deepEqual(estimateWinChanceSync(p, FAST), estimateWinChanceSync(p, FAST));
});

test('estimateWinChance (async) matches the sync version and reports progress', async () => {
  // two helmets that neither beats the other in every stat: plain iron B, or copper S with a ruby (magic resistance)
  const p = { gearItems: [item('sword', 'steel', 'C'), item('helmet', 'iron', 'B'), item('helmet', 'copper', 'S', { type: 'ruby', grade: 'A' })], ringTotals: {}, tier: 'elite', day: 3, known: { hp: 'high' }, seed: 5 };
  const progress = [];
  const r = await estimateWinChance(p, FAST, (f) => progress.push(f));
  assert.equal(r.winPct, estimateWinChanceSync(p, FAST).winPct);
  assert.equal(r.fights, FAST.samples * FAST.evalFights);
  assert.equal(progress.length, FAST.samples);
  assert.equal(progress[progress.length - 1], 1);
  assert.equal(r.usage.reduce((a, u) => a + u.count, 0), FAST.samples);
  // usage is keyed by the loadout's sorted item ids ('3,7'): one sword and one helmet each time
  const gearIds = p.gearItems.map((g) => g.id);
  for (const u of r.usage) {
    const ids = u.ids.split(',').map(Number);
    assert.equal(ids.length, 2);
    assert.deepEqual(ids, [...ids].sort((a, b) => a - b));
    assert.deepEqual(ids.map((id) => p.gearItems.find((g) => g.id === id).slot).sort(), ['helmet', 'sword']);
    assert.ok(ids.every((id) => gearIds.includes(id)));
  }
  assert.equal(new Set(r.usage.map((u) => u.ids)).size, r.usage.length, 'one entry per distinct loadout');
  assert.deepEqual(r.usage, estimateWinChanceSync(p, FAST).usage, 'the sync estimate reports the same usage');
  assert.ok(r.avgTime > 0);
  assert.ok(r.avgHpLeftPct >= 0 && r.avgHpLeftPct <= 100);
  // without a progress callback it still resolves to the same numbers
  const r2 = await estimateWinChance(p, FAST);
  assert.equal(r2.winPct, r.winPct);
});

// ------------------------------------------------------- simCounts (v1.2) ----
// Pinned: three different base counts (so each is checked on its own), the Battle simulation steps, and the
// Foresight ring values (whole numbers; only the best worn Foresight ring counts).
const SC = cfgWith({
  sim: { samples: 7, evalFights: 9, fightsPerLoadout: 11 },
  intel: { tracks: { simDepth: { base: 0, gains: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], max: 100 } } },
  rings: { duplicateFactor: 0.5, types: { foresight: { values: [1, 1, 2, 2, 3], stack: false } } },
});
const scGame = (cfg = SC) => game(1, cfg);

test('simCounts: with no intel and no rings it is the CONFIG.sim base (default config too)', () => {
  assert.deepEqual(simCounts(scGame(), SC), { samples: 7, evalFights: 9, fightsPerLoadout: 11, extra: 0 });
  const d = simCounts(game(1));
  const base = CONFIG.intel.tracks.simDepth.base;
  assert.deepEqual(d, {
    samples: CONFIG.sim.samples + base, evalFights: CONFIG.sim.evalFights + base, fightsPerLoadout: CONFIG.sim.fightsPerLoadout + base, extra: base,
  });
  assert.ok(CONFIG.sim.samples >= 1 && CONFIG.sim.evalFights >= 1 && CONFIG.sim.fightsPerLoadout >= 1);
});

test('simCounts: Battle simulation intel points add their gains to all three counts (the track base counts too)', () => {
  const s = scGame();
  s.intel.points = 5;
  let total = 0;
  [10, 9, 8, 7, 6].forEach((gain, i) => {
    assert.equal(spendIntel(s, 'simDepth', SC).ok, true);
    total += gain;
    assert.equal(intelValueFor('simDepth', i + 1, SC), total, 'the track value is the number of extra guesses / fights');
    assert.deepEqual(simCounts(s, SC), { samples: 7 + total, evalFights: 9 + total, fightsPerLoadout: 11 + total, extra: total });
  });
  // a track base is extra from the start
  const withBase = cfgWith(SC, { intel: { tracks: { simDepth: { base: 3 } } } });
  assert.equal(simCounts(scGame(withBase), withBase).extra, 3);
  // the track's maximum caps the extra count
  const capped = cfgWith(SC, { intel: { tracks: { simDepth: { max: 25 } } } });
  const c = scGame(capped);
  c.intel.spent.simDepth = 1000;
  assert.deepEqual(simCounts(c, capped), { samples: 7 + 25, evalFights: 9 + 25, fightsPerLoadout: 11 + 25, extra: 25 });
  // other intel tracks do not change it
  const o = scGame();
  o.intel.spent.enemySight = 5;
  o.intel.spent.oreSight = 5;
  assert.equal(simCounts(o, SC).extra, 0);
});

test('simCounts: only the best worn smith Foresight ring counts (whole numbers, no halved extras)', () => {
  const fv = SC.rings.types.foresight.values; // [1, 1, 2, 2, 3] for D C B A S
  const extraWith = (rings, worn = true) => {
    const s = scGame();
    for (const g of rings) addRing(s, 'foresight', g, worn);
    return simCounts(s, SC);
  };
  assert.equal(extraWith(['D']).extra, fv[0]);
  assert.equal(extraWith(['S']).extra, fv[4]);
  assert.deepEqual(extraWith(['S']), { samples: 7 + fv[4], evalFights: 9 + fv[4], fightsPerLoadout: 11 + fv[4], extra: fv[4] });
  assert.equal(extraWith(['D', 'C']).extra, fv[1], 'D + C: the best one only');
  assert.equal(extraWith(['B', 'A']).extra, fv[3], 'B + A: the best one only');
  assert.equal(extraWith(['S', 'S']).extra, fv[4], 'a second ring adds nothing');
  assert.equal(extraWith(['D', 'S', 'A', 'B']).extra, fv[4]);
  // a ring that is not worn does nothing
  assert.equal(extraWith(['S'], false).extra, 0);
  // rings of other types (smith or adventurer) do nothing
  const s = scGame();
  addRing(s, 'searchEff', 'S', true);
  addRing(s, 'health', 'S', true);
  assert.equal(simCounts(s, SC).extra, 0);
  // the real config follows the same rule: the best ring's value, nothing for the others
  const real = game(1);
  addRing(real, 'foresight', 'B', true);
  addRing(real, 'foresight', 'C', true);
  const best = CONFIG.rings.types.foresight.values[2];
  assert.equal(simCounts(real).extra, best);
});

test('simCounts: Foresight sums that are a hair under a whole number (floating point) still count the whole number', () => {
  // a Foresight type that DOES stack (not the real one): duplicate factor 1/3, values 5 + 5/3 + 3/9 = 7 exactly,
  // but the floating-point sum is 6.999999999999999
  const cfg = cfgWith(SC, { rings: { duplicateFactor: 1 / 3, types: { foresight: { values: [3, 4, 5, 6, 7], stack: true } } } });
  const s = scGame(cfg);
  addRing(s, 'foresight', 'B', true);
  addRing(s, 'foresight', 'B', true);
  addRing(s, 'foresight', 'D', true);
  assert.equal(simCounts(s, cfg).extra, 7);
});

test('simCounts: intel and Foresight rings add up', () => {
  const s = scGame();
  s.intel.points = 2;
  spendIntel(s, 'simDepth', SC);
  spendIntel(s, 'simDepth', SC); // 10 + 9
  addRing(s, 'foresight', 'S', true);
  addRing(s, 'foresight', 'A', true); // only the best counts
  const fore = SC.rings.types.foresight.values[4];
  assert.deepEqual(simCounts(s, SC), { samples: 7 + 19 + fore, evalFights: 9 + 19 + fore, fightsPerLoadout: 11 + 19 + fore, extra: 19 + fore });
});

test('simCounts with the real config: base sizes, Battle simulation steps capped at its max, best Foresight ring on top', () => {
  const sd = CONFIG.intel.tracks.simDepth;
  const base = CONFIG.sim;
  const s = game(1);
  assert.deepEqual(simCounts(s), { samples: base.samples, evalFights: base.evalFights, fightsPerLoadout: base.fightsPerLoadout, extra: 0 });
  // every point adds its gain to all three sizes, up to the track's max (the plan: +1 per point, at most +3)
  s.intel.points = sd.max + 3;
  let value = 0;
  for (let i = 1; i <= sd.max + 3; i++) {
    const res = spendIntel(s, 'simDepth');
    if (!res.ok) break;
    value = intelValueFor('simDepth', i);
    assert.equal(simCounts(s).extra, value);
  }
  assert.equal(value, sd.max, 'stops at the maximum');
  assert.equal(spendIntel(s, 'simDepth').ok, false, 'a further point is refused');
  assert.equal(simCounts(s).extra, sd.max);
  // the best Foresight ring adds on top
  addRing(s, 'foresight', 'S', true);
  addRing(s, 'foresight', 'D', true);
  const top = CONFIG.rings.types.foresight.values[4];
  assert.equal(simCounts(s).extra, sd.max + top);
  assert.equal(simCounts(s).samples, base.samples + sd.max + top);
});

// A copy of `cfg` that counts the fights simulated with it (combat.js reads damageRoll once per fight).
function counting(cfg) {
  const c = structuredClone(cfg);
  const roll = c.combat.damageRoll;
  const box = { fights: 0 };
  Object.defineProperty(c.combat, 'damageRoll', { get() { box.fights += 1; return roll; }, enumerable: true });
  return { cfg: c, box };
}

test('estimateWinChanceSync honours simCounts: guesses, test fights per gear combination, and fights per guess', () => {
  const s = scGame();
  s.intel.points = 1;
  spendIntel(s, 'simDepth', SC); // +10
  addRing(s, 'foresight', 'D', true); // + the D value
  const counts = simCounts(s, SC);
  assert.equal(counts.extra, 10 + SC.rings.types.foresight.values[0]);
  const w = cfgWith(SC, WEAK_ENEMIES);
  // one gear combination: no gear choice to simulate, so only the evaluation fights run
  const one = { gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 5 };
  const c1 = counting(w);
  const r1 = estimateWinChanceSync(one, counts, c1.cfg);
  assert.equal(r1.fights, counts.samples * counts.evalFights);
  assert.equal(c1.box.fights, counts.samples * counts.evalFights);
  // two swords that neither beats the other in every stat = two combinations: each guess also simulates
  // fightsPerLoadout fights per combination
  const two = { ...one, gearItems: [...set('copper', 'D').filter((g) => g.slot !== 'sword'), ...TWO_SWORDS()] };
  const c2 = counting(w);
  const r2 = estimateWinChanceSync(two, counts, c2.cfg);
  assert.equal(r2.fights, counts.samples * counts.evalFights, 'the reported win % is over the evaluation fights only');
  assert.equal(c2.box.fights, counts.samples * (2 * counts.fightsPerLoadout + counts.evalFights));
  // without opts the config's base counts are used; opts override them
  const c3 = counting(w);
  assert.equal(estimateWinChanceSync(one, {}, c3.cfg).fights, 7 * 9);
  assert.equal(c3.box.fights, 7 * 9);
  // the same counts as a plain object work too, and the extra field is ignored
  const { samples, evalFights, fightsPerLoadout } = counts;
  assert.equal(estimateWinChanceSync(one, { samples, evalFights, fightsPerLoadout }, w).fights, samples * evalFights);
  assert.equal(estimateWinChanceSync(one, counts, w).winPct, 100);
});

test('estimateWinChance (async) honours simCounts too: progress per guess, fights and gear usage', async () => {
  const s = scGame();
  addRing(s, 'foresight', 'B', true);
  const counts = simCounts(s, SC);
  assert.equal(counts.extra, SC.rings.types.foresight.values[2]);
  const w = cfgWith(SC, WEAK_ENEMIES);
  const p = { gearItems: [...set('copper', 'D').filter((g) => g.slot !== 'sword'), ...TWO_SWORDS()], ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 2 };
  const { cfg, box } = counting(w);
  const progress = [];
  const r = await estimateWinChance(p, counts, (f) => progress.push(f), cfg);
  assert.equal(progress.length, counts.samples);
  assert.equal(progress.at(-1), 1);
  assert.equal(r.fights, counts.samples * counts.evalFights);
  assert.equal(r.usage.reduce((a, u) => a + u.count, 0), counts.samples);
  assert.equal(box.fights, counts.samples * (2 * counts.fightsPerLoadout + counts.evalFights));
  // and it matches the sync estimate for the same counts
  assert.equal(r.winPct, estimateWinChanceSync(p, counts, w).winPct);
});

test('the default estimate size is CONFIG.sim (before intel and rings)', () => {
  const p = { gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 };
  const w = cfgWith(WEAK_ENEMIES);
  assert.equal(estimateWinChanceSync(p, {}, w).fights, CONFIG.sim.samples * CONFIG.sim.evalFights);
  assert.equal(estimateWinChanceSync(p, simCounts(game(1)), w).fights, (CONFIG.sim.samples + CONFIG.intel.tracks.simDepth.base) * (CONFIG.sim.evalFights + CONFIG.intel.tracks.simDepth.base));
});

test('the real fight is unaffected by Battle simulation intel and Foresight rings (gear choice keeps combat.bestGearFights)', () => {
  const run = (boosted) => {
    const s = game(21);
    fullSet(s, 'iron', 'B');
    addGear(s, 'sword', 'copper', 'D');
    addGear(s, 'chest', 'steel', 'C');
    const ids = s.gear.map((g) => g.id);
    if (boosted) {
      s.intel.spent.simDepth = 5;
      addRing(s, 'foresight', 'S', true); // after the gear, so the gear ids match
    }
    endDay(s);
    const e = s.roster.enemies.findIndex((x) => x.tier === 'normal');
    assert.equal(confirmPlan(s, { enemyIndex: e, gearIds: ids, ringIds: [] }).ok, true);
    const report = { ...endDay(s).report };
    delete report.ring; // a won fight's reward ring gets a different id (the Foresight ring took one)
    delete report.ringText;
    return report;
  };
  assert.deepEqual(run(true), run(false));
});

// ---------------------------------------------- margin of error (v1.2) ----
// se = spread of the per-guess win fractions / sqrt(guesses), in percentage points: more guesses and more
// test fights tighten it, so Battle simulation intel and Foresight rings visibly pay off.
const sd = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
};

// A matchup that is neither a sure win nor a sure loss on the current balance: scan the days for one where
// a full iron C set wins roughly half of its fights (so the test does not depend on a particular day).
function midMatchup() {
  const gearItems = set('iron', 'C');
  let best = null;
  for (let day = 2; day <= 120; day++) {
    const p = { gearItems, ringTotals: {}, tier: 'elite', day, known: {}, seed: 11 };
    const w = estimateWinChanceSync(p, { samples: 12, evalFights: 20, fightsPerLoadout: 10 }).winPct;
    const dist = Math.abs(w - 50);
    if (!best || dist < best.dist) best = { dist, p };
    if (dist < 8) break;
  }
  return best.p;
}

test('estimateWinChanceSync returns se and the per-guess win %, se = sd(per-guess fractions) / sqrt(guesses) x 100', () => {
  const p = midMatchup();
  const r = estimateWinChanceSync(p, FAST);
  assert.equal(r.perGuess.length, FAST.samples);
  for (const g of r.perGuess) assert.ok(g >= 0 && g <= 100);
  assert.ok(r.perGuess.some((g) => g > 0 && g < 100), 'a matchup with some spread');
  const mean = r.perGuess.reduce((a, b) => a + b, 0) / r.perGuess.length;
  assert.ok(Math.abs(mean - r.winPct) < 1e-9, 'the win % is the mean of the guesses');
  const expected = (sd(r.perGuess.map((g) => g / 100)) / Math.sqrt(FAST.samples)) * 100;
  assert.ok(Math.abs(r.se - expected) < 1e-9, `${r.se} vs ${expected}`);
  assert.ok(r.se > 0);
  // the async estimate reports the same numbers
  return estimateWinChance(p, FAST).then((a) => {
    assert.equal(a.se, r.se);
    assert.deepEqual(a.perGuess, r.perGuess);
    assert.equal(a.winPct, r.winPct);
  });
});

test('se is 0 when every guess agrees (sure win, sure loss)', () => {
  const win = estimateWinChanceSync({ gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 }, FAST, cfgWith(WEAK_ENEMIES));
  assert.equal(win.winPct, 100);
  assert.equal(win.se, 0);
  const lose = estimateWinChanceSync({ gearItems: [], ringTotals: {}, tier: 'champion', day: 9, known: {}, seed: 1 }, FAST, cfgWith(DEADLY_ENEMIES));
  assert.equal(lose.winPct, 0);
  assert.equal(lose.se, 0);
});

test('se shrinks as guesses are added (Battle simulation intel / Foresight rings make the estimate steadier)', () => {
  const p = midMatchup();
  const base = { samples: CONFIG.sim.samples, evalFights: CONFIG.sim.evalFights, fightsPerLoadout: CONFIG.sim.fightsPerLoadout };
  const more = { ...base, samples: base.samples * 16 };
  const seeds = [1, 2, 3, 4, 5, 6];
  const mean = (opts) => seeds.reduce((a, seed) => a + estimateWinChanceSync({ ...p, seed }, opts).se, 0) / seeds.length;
  const small = mean(base);
  const big = mean(more);
  assert.ok(small > 0 && big > 0);
  assert.ok(big < small * 0.6, `16x the guesses should roughly quarter the margin: ${small} -> ${big}`);
  // and through simCounts: a game with Battle simulation intel and a Foresight ring gets a smaller margin than one without
  const s0 = game(3);
  const s1 = game(3);
  s1.intel.spent.simDepth = 6;
  addRing(s1, 'foresight', 'S', true);
  const c0 = simCounts(s0);
  const c1 = simCounts(s1);
  assert.ok(c1.samples > c0.samples);
  const seMean = (counts) => seeds.reduce((a, seed) => a + estimateWinChanceSync({ ...p, seed }, counts).se, 0) / seeds.length;
  assert.ok(seMean(c1) < seMean(c0), 'a bigger estimate has a smaller margin');
});

test('se with a single guess falls back to the binomial error of its fights; no fights gives 0', () => {
  const p = midMatchup();
  const one = estimateWinChanceSync(p, { samples: 1, evalFights: 40, fightsPerLoadout: 10 });
  const q = one.winPct / 100;
  assert.ok(Math.abs(one.se - Math.sqrt((q * (1 - q)) / 40) * 100) < 1e-9);
  const none = estimateWinChanceSync(p, { samples: 3, evalFights: 0, fightsPerLoadout: 10 });
  assert.equal(none.fights, 0);
  assert.equal(none.se, 0);
});

test('estimateWinChance (async): a progress callback that returns false cancels the run (no result, no more progress calls)', async () => {
  const p = midMatchup();
  const calls = [];
  const r = await estimateWinChance(p, FAST, (f) => {
    calls.push(f);
    return calls.length < 3;
  });
  assert.equal(r, null, 'a cancelled run has no result');
  assert.equal(calls.length, 3, 'stopped right after the callback said so');
  assert.deepEqual(calls, [1 / FAST.samples, 2 / FAST.samples, 3 / FAST.samples]);
  // returning nothing (or true) keeps going: existing callers are unaffected
  const progress = [];
  const done = await estimateWinChance(p, FAST, (f) => { progress.push(f); });
  assert.equal(progress.length, FAST.samples);
  assert.ok(done && done.fights === FAST.samples * FAST.evalFights);
  assert.equal(done.winPct, estimateWinChanceSync(p, FAST).winPct);
  // cancelling at the very first callback
  assert.equal(await estimateWinChance(p, FAST, () => false), null);
});

// ------------------------------------------------ gear search (B3) ----
// A gem type for each of the first few items of a type: the same base item with a different gem is never beaten
// in every stat by another one, so nothing here is pruned.
const GEM_TYPES = ['ruby', 'topaz', 'sapphire', 'emerald', 'diamond'];
const gemmed = (slot, n, material = 'iron', grade = 'C') => GEM_TYPES.slice(0, n).map((t) => item(slot, material, grade, { type: t, grade: 'C' }));
const kit = (perType) => SLOTS.flatMap((slot) => gemmed(slot, perType));
const idsOf = (lo) => lo.map((g) => g.id).sort((a, b) => a - b).join(',');

test('pruneDominated: drops a plain chest when the same chest with a gem is packed', () => {
  const plain = item('chest', 'iron', 'C');
  const ruby = item('chest', 'iron', 'C', { type: 'ruby', grade: 'D' });
  assert.deepEqual(pruneDominated([plain, ruby]), [ruby]);
  assert.deepEqual(pruneDominated([ruby, plain]), [ruby], 'order does not matter');
  // a worse material / grade is dropped too, a better one with a different stat mix is not
  const copperD = item('chest', 'copper', 'D');
  const mythrilS = item('chest', 'mythril', 'S');
  assert.deepEqual(pruneDominated([copperD, plain, mythrilS]), [mythrilS]);
});

test('pruneDominated: keeps items that are better in some stat; two chests with different gems both stay', () => {
  const ruby = item('chest', 'iron', 'C', { type: 'ruby', grade: 'C' });
  const diamond = item('chest', 'iron', 'C', { type: 'diamond', grade: 'C' });
  assert.deepEqual(pruneDominated([ruby, diamond]), [ruby, diamond]);
  // trade-off: much stronger plain sword vs weak sword with an emerald (accuracy)
  const [strong, emerald] = TWO_SWORDS();
  assert.deepEqual(pruneDominated([strong, emerald]), [strong, emerald]);
  // the same gem at a higher grade beats the lower one
  const lowRuby = item('chest', 'iron', 'C', { type: 'ruby', grade: 'D' });
  const highRuby = item('chest', 'iron', 'C', { type: 'ruby', grade: 'S' });
  assert.deepEqual(pruneDominated([lowRuby, highRuby]), [highRuby]);
});

test('pruneDominated: of two identical items the lowest id stays; different gear types never prune each other', () => {
  const a = item('helmet', 'steel', 'B');
  const b = item('helmet', 'steel', 'B');
  assert.ok(a.id < b.id);
  assert.deepEqual(pruneDominated([b, a]), [a]);
  assert.deepEqual(pruneDominated([a, b, { ...b, id: b.id + 1000 }]), [a]);
  assert.deepEqual(pruneDominated([{ ...a, id: a.id + 2000 }, b]), [b], 'the lowest id of the pair, whatever the order');
  const chest = item('chest', 'copper', 'D');
  const boots = item('boots', 'mythril', 'S');
  assert.deepEqual(pruneDominated([chest, boots]), [chest, boots]);
  assert.deepEqual(pruneDominated([]), []);
  // exact: whatever is dropped, the survivors beat it in every stat of gearStats
  const all = [...kit(3), ...kit(2).map((g) => ({ ...g, id: nextId++, gem: null }))];
  const kept = pruneDominated(all);
  for (const g of all.filter((x) => !kept.includes(x))) {
    assert.ok(kept.some((k) => k.slot === g.slot && gearPower(k) >= gearPower(g) - 1e-9), `a survivor covers #${g.id}`);
  }
});

test('searchLoadout: with few combinations it equals the exact search (bestLoadout over every combination)', () => {
  const enemy = enemyCombatant('elite', 3, allLevels('normal'));
  const gear = [...TWO_SWORDS(), item('chest', 'iron', 'B'), item('helmet', 'iron', 'B'), item('helmet', 'copper', 'S', { type: 'ruby', grade: 'A' }), item('boots', 'copper', 'C')];
  assert.equal(pruneDominated(gear).length, gear.length, 'nothing to prune here');
  for (const seed of [1, 2, 3]) {
    const exact = bestLoadout(loadouts(gear), {}, enemy, seed, 30);
    const found = searchLoadout(gear, loadoutEval({}, enemy, seed, 30));
    assert.equal(idsOf(found.items), idsOf(loadouts(gear)[exact.index]), `seed ${seed}`);
    assert.equal(found.evaluated, 2 * 2 * 1 * 1, 'every combination tried once');
  }
});

test('searchLoadout: returns one item per gear type in SLOTS order; nothing to choose = nothing simulated', () => {
  const never = () => { throw new Error('evalFn must not be called'); };
  assert.deepEqual(searchLoadout([], never), { items: [], evaluated: 0, best: null });
  const one = [item('boots'), item('sword'), item('helmet')];
  const r = searchLoadout(one, never);
  assert.deepEqual(r.items.map((g) => g.slot), ['sword', 'helmet', 'boots']);
  assert.equal(r.evaluated, 0);
  // a dominated spare is pruned first: still a single combination, still nothing simulated
  const spare = searchLoadout([...one, item('sword', 'steel', 'D')], never);
  assert.equal(spare.evaluated, 0);
  assert.equal(spare.items[0].material, 'steel', 'the better sword was kept');
  // the loadout of a search over many items also has one item per type in SLOTS order
  const many = searchLoadout(kit(3), (lo) => ({ score: lo.length, dealt: 0 }));
  assert.deepEqual(many.items.map((g) => g.slot), SLOTS);
});

test('searchLoadout: tries every combination up to sim.maxExactCombos, then switches to one type at a time', () => {
  const calls = [];
  // additive score: each item has a value, so the best loadout is the best item of every type
  const value = new Map();
  const evalFn = (lo) => {
    calls.push(idsOf(lo));
    return { score: lo.reduce((a, g) => a + (value.get(g.id) ?? 0), 0), dealt: 0 };
  };
  const items = kit(2); // 2 per type in 5 types = 32 combinations
  items.forEach((g, i) => value.set(g.id, (i * 7) % 5)); // an arbitrary spread
  const best = SLOTS.map((slot) => items.filter((g) => g.slot === slot).sort((a, b) => value.get(b.id) - value.get(a.id))[0]);
  const exact = searchLoadout(items, evalFn);
  assert.equal(exact.evaluated, 32);
  assert.equal(calls.length, 32);
  assert.equal(new Set(calls).size, 32, 'no loadout is simulated twice');
  assert.equal(idsOf(exact.items), idsOf(best));

  // the same items with a lower limit: one type at a time
  const small = cfgWith({ sim: { maxExactCombos: 31 } });
  calls.length = 0;
  const greedy = searchLoadout(items, evalFn, small);
  assert.ok(greedy.evaluated < 32);
  assert.equal(calls.length, greedy.evaluated);
  assert.equal(idsOf(greedy.items), idsOf(best), 'an additive score is solved exactly one type at a time');
  // and the limit itself is inclusive
  calls.length = 0;
  assert.equal(searchLoadout(items, evalFn, cfgWith({ sim: { maxExactCombos: 32 } })).evaluated, 32);
});

test('searchLoadout: 3 items per type (243 combinations) calls evalFn at most searchPasses x items + 1 times', () => {
  const items = kit(3);
  assert.equal(items.length, 15);
  assert.ok(3 ** 5 > CONFIG.sim.maxExactCombos);
  let calls = 0;
  const evalFn = (lo) => {
    calls += 1;
    return { score: lo.reduce((a, g) => a + ((g.id * 37) % 11), 0), dealt: 0 };
  };
  const r = searchLoadout(items, evalFn);
  assert.equal(calls, r.evaluated);
  assert.ok(calls <= CONFIG.sim.searchPasses * items.length + 1, `${calls} calls`);
  assert.ok(calls >= 1 + 5 * 2, 'at least the start loadout and every alternative once');
  assert.equal(r.items.length, 5);
  // a lower pass limit means fewer evaluations and never more than the bound
  const one = cfgWith({ sim: { searchPasses: 1 } });
  calls = 0;
  searchLoadout(items, evalFn, one);
  assert.ok(calls <= items.length + 1);
  // it stops early on a pass that changes nothing: a constant score never improves, so only the first pass runs
  calls = 0;
  searchLoadout(items, () => { calls += 1; return { score: 0, dealt: 0 }; });
  assert.equal(calls, 1 + 5 * 2, 'start loadout + every alternative of every type once, then it stops');
});

test('searchLoadout: starts from the strongest-looking item of each type (power, then gem grade, then lower id)', () => {
  const flat = () => ({ score: 0, dealt: 0 });
  // iron C (power 1.45 x 1.1) beats copper S (1.0 x 1.55); neither is pruned because the copper one has a gem
  const iron = item('chest', 'iron', 'C');
  const copperS = item('chest', 'copper', 'S', { type: 'ruby', grade: 'D' });
  assert.ok(gearPower(iron) > gearPower(copperS));
  const cfg = cfgWith({ sim: { maxExactCombos: 1 } }); // force the one-type-at-a-time path
  const sw = TWO_SWORDS();
  const r = searchLoadout([copperS, iron, ...sw], flat, cfg);
  assert.equal(r.items.find((g) => g.slot === 'chest'), iron);
  assert.equal(r.items.find((g) => g.slot === 'sword'), sw[0], 'the stronger sword');
  // same power: the higher gem grade, then the lower id
  const lowGem = item('helmet', 'iron', 'C', { type: 'ruby', grade: 'C' });
  const highGem = item('helmet', 'iron', 'C', { type: 'topaz', grade: 'A' });
  assert.equal(searchLoadout([lowGem, highGem, ...sw], flat, cfg).items.find((g) => g.slot === 'helmet'), highGem);
  const sameA = item('boots', 'iron', 'C', { type: 'ruby', grade: 'C' });
  const sameB = item('boots', 'iron', 'C', { type: 'sapphire', grade: 'C' });
  assert.equal(searchLoadout([sameB, sameA, ...sw], flat, cfg).items.find((g) => g.slot === 'boots'), sameA);
});

test('loadoutEval: same seed gives the same result for the same loadout (common random numbers), wins <= fights', () => {
  const enemy = enemyCombatant('elite', 4, allLevels('normal'));
  const ev = loadoutEval({}, enemy, 17, 40);
  const lo = [item('sword', 'iron', 'B'), item('chest', 'iron', 'B')];
  assert.deepEqual(ev(lo), ev(lo));
  assert.deepEqual(ev(lo), loadoutEval({}, enemy, 17, 40)(lo));
  const r = ev(lo);
  assert.ok(Number.isInteger(r.wins) && r.wins >= 0 && r.wins <= 40);
  assert.ok(r.score >= r.wins && r.score < r.wins + 1, 'score = wins + average HP left / (fights + 1)');
  assert.ok(r.dealt >= 0);
  // the strong set wins at least as often as no gear
  assert.ok(loadoutEval({}, enemy, 17, 40)([item('sword', 'mythril', 'S'), item('chest', 'mythril', 'S')]).wins >= ev([]).wins);
});

test('estimates with 3 items per gear type stay small: the gear search is bounded and the usage is keyed by ids', () => {
  const gearItems = kit(3);
  const p = { gearItems, ringTotals: {}, tier: 'elite', day: 3, known: {}, seed: 8 };
  const r = estimateWinChanceSync(p, FAST);
  assert.ok(r.evaluated <= FAST.samples * (CONFIG.sim.searchPasses * gearItems.length + 1), `${r.evaluated} loadouts tried`);
  assert.ok(r.evaluated < FAST.samples * 3 ** 5, 'far fewer than trying all 243 for every guess');
  for (const u of r.usage) {
    const ids = u.ids.split(',').map(Number);
    assert.equal(ids.length, 5);
    assert.deepEqual(SLOTS.map((slot) => gearItems.find((g) => g.id === ids.find((id) => gearItems.find((x) => x.id === id).slot === slot)).slot), SLOTS);
  }
  assert.equal(r.usage.reduce((a, u) => a + u.count, 0), FAST.samples);
  // an empty pack: one loadout without items, key ''
  const none = estimateWinChanceSync({ ...p, gearItems: [] }, FAST);
  assert.deepEqual(none.usage, [{ ids: '', count: FAST.samples }]);
  assert.equal(none.evaluated, 0);
});

test('the result counts wins including draws: res.wins / res.fights is the win %', () => {
  const draws = estimateWinChanceSync({ gearItems: [], ringTotals: {}, tier: 'champion', day: 1, known: {}, seed: 3 }, FAST, HARMLESS);
  assert.equal(draws.wins, draws.fights);
  const p = midMatchup();
  for (const r of [estimateWinChanceSync(p, FAST), estimateWinChanceSync(p, { ...FAST, samples: 3 })]) {
    assert.ok(Number.isInteger(r.wins) && r.wins <= r.fights);
    assert.ok(Math.abs(r.winPct - (100 * r.wins) / r.fights) < 1e-9);
  }
});

// -------------------------------------------------- shown margin (B3) ----
test('shownMargin: a spread of 0 is not certainty - 25 wins of 25 and 0 of 25 both show about 14', () => {
  const all = shownMargin({ wins: 25, fights: 25, se: 0 });
  const none = shownMargin({ wins: 0, fights: 25, se: 0 });
  assert.equal(all, 14);
  assert.equal(none, 14);
  assert.ok(all >= 10 && none >= 10);
  // more fights make the floor smaller
  assert.ok(shownMargin({ wins: 100, fights: 100, se: 0 }) < all);
  assert.ok(shownMargin({ wins: 400, fights: 400, se: 0 }) < shownMargin({ wins: 100, fights: 100, se: 0 }));
});

test('shownMargin: twice the spread (2 x se) when that is larger, the Wilson gap otherwise; never below 1', () => {
  const mid = { wins: 12, fights: 25 };
  const floor = shownMargin({ ...mid, se: 0 });
  assert.ok(floor >= 10 && floor <= 25, `wilson gap ${floor}`);
  assert.equal(shownMargin({ ...mid, se: 15 }), 30, '2 x se wins');
  assert.equal(shownMargin({ ...mid, se: 1 }), floor, 'a small spread cannot go below the floor');
  assert.equal(shownMargin({ ...mid, se: 12.4 }), Math.max(floor, 25));
  // symmetric around 50%
  assert.equal(shownMargin({ wins: 13, fights: 25, se: 0 }), floor);
  assert.ok(Number.isInteger(floor));
  assert.ok(shownMargin({ wins: 50000, fights: 100000, se: 0 }) >= 1);
});

test('shownMargin: null without fights; works on real estimates and is never below the floor', () => {
  assert.equal(shownMargin(null), null);
  assert.equal(shownMargin({ wins: 0, fights: 0, se: 0 }), null);
  const none = estimateWinChanceSync({ gearItems: [], ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 }, { samples: 3, evalFights: 0, fightsPerLoadout: 5 });
  assert.equal(shownMargin(none), null);
  // a sure win over the base sizes shows the floor, not 1
  const sure = estimateWinChanceSync({ gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 }, { samples: CONFIG.sim.samples, evalFights: CONFIG.sim.evalFights, fightsPerLoadout: 5 }, cfgWith(WEAK_ENEMIES));
  assert.equal(sure.winPct, 100);
  assert.equal(sure.se, 0);
  assert.equal(shownMargin(sure), shownMargin({ wins: sure.fights, fights: sure.fights, se: 0 }));
  assert.ok(shownMargin(sure) > 1);
  // and it matches the formula on a mixed result
  const p = midMatchup();
  const r = estimateWinChanceSync(p, FAST);
  assert.ok(shownMargin(r) >= Math.round(2 * r.se));
  assert.equal(shownMargin(r), shownMargin({ wins: r.wins, fights: r.fights, se: r.se }));
});
