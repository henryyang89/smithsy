import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS } from '../js/config.js';
import { CONFIG } from '../js/config.js';
import { loadouts, bestLoadout, estimateWinChance, estimateWinChanceSync, simCounts } from '../js/core/sim.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { spendIntel, intelChanceFor } from '../js/core/intel.js';
import { endDay, confirmPlan } from '../js/core/game.js';
import { allLevels, cfgWith, combatant, game, addGear, addRing, fullSet, WEAK_ENEMIES, DEADLY_ENEMIES } from './helpers.mjs';

// Nobody can hurt anybody (unarmed adventurer, harmless enemies) and fights are cut short: every fight is a draw.
const HARMLESS = cfgWith({ adventurer: { unarmedDamage: 0 }, enemies: { tiers: { normal: { damage: 0 }, elite: { damage: 0 }, champion: { damage: 0 } } }, combat: { safetyCapSeconds: 30 } });

let nextId = 1;
const item = (slot, material = 'copper', grade = 'D', gem = null) => ({ id: nextId++, slot, material, grade, gem, durability: 100, packed: true });
const set = (material, grade) => SLOTS.map((s) => item(s, material, grade));
const FAST = { samples: 8, fightsPerLoadout: 20, evalFights: 25 };

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
  const p = { gearItems: [item('sword', 'steel', 'C'), item('helmet', 'iron', 'B'), item('helmet', 'copper', 'S')], ringTotals: {}, tier: 'elite', day: 3, known: { hp: 'high' }, seed: 5 };
  const progress = [];
  const r = await estimateWinChance(p, FAST, (f) => progress.push(f));
  assert.equal(r.winPct, estimateWinChanceSync(p, FAST).winPct);
  assert.equal(r.fights, FAST.samples * FAST.evalFights);
  assert.equal(progress.length, FAST.samples);
  assert.equal(progress[progress.length - 1], 1);
  assert.equal(r.usage.reduce((a, u) => a + u.count, 0), FAST.samples);
  for (const u of r.usage) assert.equal(u.items.length, 2);
  assert.ok(r.avgTime > 0);
  assert.ok(r.avgHpLeftPct >= 0 && r.avgHpLeftPct <= 100);
  // without a progress callback it still resolves to the same numbers
  const r2 = await estimateWinChance(p, FAST);
  assert.equal(r2.winPct, r.winPct);
});

// ------------------------------------------------------- simCounts (v1.2) ----
// Pinned: three different base counts (so each is checked on its own), the shared intel gains, and the
// Foresight ring values with the usual halving for duplicates.
const SC = cfgWith({
  sim: { samples: 7, evalFights: 9, fightsPerLoadout: 11 },
  intel: { gainsPerPoint: [10, 9, 8, 7, 6, 5, 4, 3, 2], minGain: 1, maxChance: 100, tracks: { simDepth: { base: 0 } } },
  rings: { duplicateFactor: 0.5, types: { foresight: { values: [2, 3, 4, 5, 6] } } },
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
    assert.equal(intelChanceFor('simDepth', i + 1, SC), total, 'the track value is the number of extra guesses / fights');
    assert.deepEqual(simCounts(s, SC), { samples: 7 + total, evalFights: 9 + total, fightsPerLoadout: 11 + total, extra: total });
  });
  // a track base is extra from the start
  const withBase = cfgWith(SC, { intel: { tracks: { simDepth: { base: 3 } } } });
  assert.equal(simCounts(scGame(withBase), withBase).extra, 3);
  // the intel maximum caps the extra count
  const capped = cfgWith(SC, { intel: { maxChance: 25 } });
  const c = scGame(capped);
  c.intel.spent.simDepth = 1000;
  assert.deepEqual(simCounts(c, capped), { samples: 7 + 25, evalFights: 9 + 25, fightsPerLoadout: 11 + 25, extra: 25 });
  // other intel tracks do not change it
  const o = scGame();
  o.intel.spent.enemySight = 5;
  o.intel.spent.oreSight = 5;
  assert.equal(simCounts(o, SC).extra, 0);
});

test('simCounts: worn smith Foresight rings add their value, rounded down; duplicates are halved', () => {
  const extraWith = (rings, worn = true) => {
    const s = scGame();
    for (const g of rings) addRing(s, 'foresight', g, worn);
    return simCounts(s, SC);
  };
  assert.equal(extraWith(['D']).extra, 2);
  assert.equal(extraWith(['S']).extra, 6);
  assert.deepEqual(extraWith(['S']), { samples: 7 + 6, evalFights: 9 + 6, fightsPerLoadout: 11 + 6, extra: 6 });
  assert.equal(extraWith(['S', 'S']).extra, 6 + 3, 'second ring counts half');
  assert.equal(extraWith(['D', 'S']).extra, 6 + 1, 'best first: 6 + 2 x 0.5');
  assert.equal(extraWith(['A', 'A']).extra, 7, '5 + 2.5 = 7.5 rounds down');
  assert.equal(extraWith(['S', 'S', 'S']).extra, 6 + 3 + 1, '6 + 3 + 1.5 -> 10');
  assert.equal(extraWith(['S', 'S', 'S', 'S']).extra, 11, '6 + 3 + 1.5 + 0.75 = 11.25 -> 11');
  // a ring that is not worn does nothing
  assert.equal(extraWith(['S'], false).extra, 0);
  // rings of other types (smith or adventurer) do nothing
  const s = scGame();
  addRing(s, 'searchEff', 'S', true);
  addRing(s, 'health', 'S', true);
  assert.equal(simCounts(s, SC).extra, 0);
});

test('simCounts: Foresight sums that are a hair under a whole number (floating point) still count the whole number', () => {
  // duplicate factor 1/3: values 5 + 5/3 + 3/9 = 7 exactly, but the floating-point sum is 6.999999999999999
  const cfg = cfgWith(SC, { rings: { duplicateFactor: 1 / 3, types: { foresight: { values: [3, 4, 5, 6, 7] } } } });
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
  addRing(s, 'foresight', 'A', true); // 6 + 2.5
  assert.deepEqual(simCounts(s, SC), { samples: 7 + 19 + 8, evalFights: 9 + 19 + 8, fightsPerLoadout: 11 + 19 + 8, extra: 27 });
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
  addRing(s, 'foresight', 'D', true); // +2
  const counts = simCounts(s, SC);
  assert.equal(counts.extra, 12);
  const w = cfgWith(SC, WEAK_ENEMIES);
  // one gear combination: no gear choice to simulate, so only the evaluation fights run
  const one = { gearItems: set('copper', 'D'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 5 };
  const c1 = counting(w);
  const r1 = estimateWinChanceSync(one, counts, c1.cfg);
  assert.equal(r1.fights, counts.samples * counts.evalFights);
  assert.equal(c1.box.fights, counts.samples * counts.evalFights);
  // two swords = two combinations: each guess also simulates fightsPerLoadout fights per combination
  const two = { ...one, gearItems: [...set('copper', 'D'), item('sword', 'iron', 'C')] };
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
  addRing(s, 'foresight', 'B', true); // +4
  const counts = simCounts(s, SC);
  assert.equal(counts.extra, 4);
  const w = cfgWith(SC, WEAK_ENEMIES);
  const p = { gearItems: [...set('copper', 'D'), item('sword', 'iron', 'C')], ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 2 };
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
    const { ring, ringText, ...rest } = endDay(s).report; // a won fight's reward ring gets a different id (the Foresight ring took one)
    return rest;
  };
  assert.deepEqual(run(true), run(false));
});
