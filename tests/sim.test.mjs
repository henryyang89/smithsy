import test from 'node:test';
import assert from 'node:assert/strict';
import { SLOTS } from '../js/config.js';
import { loadouts, bestLoadout, estimateWinChance, estimateWinChanceSync } from '../js/core/sim.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { allLevels } from './helpers.mjs';

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
  // ~0.25% (copper chest) vs ~0.55% (mythril chest) true win chance: 60 fights see 0 wins for both.
  const champ = enemyCombatant('champion', 5, allLevels('high'));
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

test('estimateWinChanceSync: ~100% with top gear vs a day-1 normal enemy', () => {
  const r = estimateWinChanceSync({ gearItems: set('mythril', 'S'), ringTotals: {}, tier: 'normal', day: 1, known: {}, seed: 1 }, FAST);
  assert.equal(r.fights, FAST.samples * FAST.evalFights);
  assert.ok(r.winPct >= 99, `win ${r.winPct}%`);
});

test('estimateWinChanceSync: ~0% unarmed vs a late champion', () => {
  const r = estimateWinChanceSync({ gearItems: [], ringTotals: {}, tier: 'champion', day: 30, known: {}, seed: 1 }, FAST);
  assert.ok(r.winPct <= 1, `win ${r.winPct}%`);
});

test('estimateWinChanceSync is deterministic and respects fully known attributes', () => {
  const p = { gearItems: [item('sword', 'iron', 'B'), item('chest', 'iron', 'B')], ringTotals: { health: 5 }, tier: 'elite', day: 4, known: {}, seed: 77 };
  const a = estimateWinChanceSync(p, FAST);
  assert.deepEqual(a, estimateWinChanceSync(p, FAST));
  assert.ok(a.winPct > 0 && a.winPct < 100, `expected a contested fight, got ${a.winPct}%`);
  // all attributes known: high everything is harder than low everything (same tier: elite counts ignored when fully known)
  const lowAll = estimateWinChanceSync({ ...p, known: allLevels('low') }, FAST).winPct;
  const highAll = estimateWinChanceSync({ ...p, known: allLevels('high') }, FAST).winPct;
  assert.ok(lowAll > highAll, `${lowAll} > ${highAll}`);
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
