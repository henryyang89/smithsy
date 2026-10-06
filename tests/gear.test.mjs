import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SLOTS, GRADES, BARS } from '../js/config.js';
import {
  gearStats, craft, canCraft, craftCost, craftMinutes, repairInfo, repair, scrap, gearName, barKey, statsText,
} from '../js/core/gear.js';
import { game, approx, addGear, standInBlankField, DAY_END, DAY_START } from './helpers.mjs';

const item = (slot, material = 'copper', grade = 'D', gem = null, extra = {}) => ({ id: 1, slot, material, grade, gem, durability: 100, packed: false, ...extra });
const close = (a, b, msg = '') => assert.ok(approx(a, b, 1e-9), `${a} != ${b} ${msg}`);

// ----------------------------------------------------------------- stats ----
test('gearStats = slot base x material multiplier x grade multiplier', () => {
  const G = CONFIG.gear;
  for (const slot of SLOTS) {
    for (const mat of BARS) {
      for (const grade of GRADES) {
        const st = gearStats(item(slot, mat, grade));
        const base = G.slots[slot].stats;
        assert.deepEqual(Object.keys(st).sort(), Object.keys(base).sort());
        for (const k of Object.keys(base)) close(st[k], base[k] * G.materialMult[mat] * G.gradeMult[grade]);
      }
    }
  }
  // spot checks
  close(gearStats(item('chest', 'iron', 'B')).defense, 10.8); // 6 x 1.5 x 1.2
  assert.deepEqual(gearStats(item('sword', 'mythril', 'S')), { damage: 45, accuracy: 45 });
  assert.deepEqual(gearStats(item('boots')), { defense: 2, dodge: 10, speed: 3 });
  close(gearStats(item('gloves', 'steel', 'C')).accuracy, 22);
});

test('armor ordering: chest > helmet > gloves = boots defense', () => {
  const d = (slot) => gearStats(item(slot, 'iron', 'B')).defense;
  assert.ok(d('chest') > d('helmet'));
  assert.ok(d('helmet') > d('gloves'));
  assert.equal(d('gloves'), d('boots'));
});

test('sword gems add weapon effects by gem grade (independent of gear grade)', () => {
  const fx = CONFIG.gemEffects;
  const sw = (type, grade) => gearStats(item('sword', 'copper', 'D', { type, grade }));
  assert.equal(sw('ruby', 'A').magicPct, fx.ruby.weapon.magicPct[3]);
  assert.deepEqual(sw('topaz', 'S'), { damage: 10, accuracy: 10, stunChance: 12, stunDur: 1.0 });
  assert.equal(sw('emerald', 'C').accuracy, 10 + 15, 'emerald adds to the sword accuracy');
  assert.deepEqual(sw('sapphire', 'B'), { damage: 10, accuracy: 10, slowPct: 20, slowDur: 2 });
  assert.equal(sw('diamond', 'D').pierce, 10);
  // no armor effects on a sword
  assert.equal(sw('ruby', 'S').magicRes, undefined);
});

test('armor gems: chest x1.25, helmet x1.1, gloves/boots x1', () => {
  const ar = (slot, type, grade) => gearStats(item(slot, 'copper', 'D', { type, grade }));
  close(ar('chest', 'ruby', 'S').magicRes, 15);
  close(ar('helmet', 'ruby', 'S').magicRes, 13.2);
  close(ar('gloves', 'ruby', 'S').magicRes, 12);
  close(ar('boots', 'ruby', 'S').magicRes, 12);
  const tz = ar('chest', 'topaz', 'B');
  close(tz.stunChanceRed, 10);
  close(tz.stunDurRed, 10);
  const sp = ar('helmet', 'sapphire', 'A');
  close(sp.slowRed, 11);
  close(sp.slowDurRed, 11);
  close(ar('boots', 'emerald', 'D').dodge, 10 + 4, 'emerald adds to the boots dodge');
  close(ar('chest', 'emerald', 'D').dodge, 5);
  close(ar('gloves', 'diamond', 'C').pierceRes, 6);
  assert.equal(ar('chest', 'diamond', 'S').pierce, undefined, 'no weapon effects on armor');
  close(ar('chest', 'diamond', 'S').defense, 6, 'gem does not change base stats');
});

test('gearName / statsText / barKey', () => {
  assert.equal(gearName(item('sword', 'steel', 'A', { type: 'ruby', grade: 'S' })), 'A Steel Sword +Ruby S');
  assert.equal(gearName(item('boots', 'copper', 'D')), 'D Copper Boots');
  assert.equal(barKey('iron', 'B'), 'iron:B');
  assert.equal(statsText({ damage: 13.333, accuracy: 10 }), 'Damage 13.3, Accuracy 10');
});

// ----------------------------------------------------------------- craft ----
test('craftMinutes: 15 per bar (+10 with a gem)', () => {
  assert.equal(craftMinutes('sword', false), 30);
  assert.equal(craftMinutes('chest', false), 45);
  assert.equal(craftMinutes('chest', true), 55);
  assert.equal(craftMinutes('boots', true), 40);
});

test('craftCost: bars of one material+grade, plus one cut gem', () => {
  assert.deepEqual(craftCost({ slot: 'chest', material: 'iron', grade: 'B' }), { bars: { 'iron:B': 3 }, gems: {} });
  assert.deepEqual(craftCost({ slot: 'sword', material: 'steel', grade: 'S', gem: { type: 'topaz', grade: 'C' } }), { bars: { 'steel:S': 2 }, gems: { 'topaz:C': 1 } });
});

test('craft requires same-grade bars (mixed grades do not count)', () => {
  const s = game(1);
  s.storage.bars['iron:B'] = 1;
  s.storage.bars['iron:A'] = 1;
  s.storage.bars['copper:B'] = 5;
  const spec = { slot: 'sword', material: 'iron', grade: 'B' };
  assert.match(canCraft(s, spec), /Need 2 iron B bars/);
  const r = craft(s, spec);
  assert.equal(r.ok, false);
  assert.equal(s.storage.bars['iron:B'], 1);
  assert.equal(s.storage.bars['iron:A'], 1);
  assert.equal(s.gear.length, 0);
  assert.equal(s.time, DAY_START);
});

test('craft consumes bars, creates the item with the bars\' grade and spends time', () => {
  const s = game(1);
  s.storage.bars['iron:B'] = 5;
  const id0 = s.nextId;
  const r = craft(s, { slot: 'chest', material: 'iron', grade: 'B' });
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.storage.bars['iron:B'], 2);
  assert.deepEqual(r.item, { id: id0, slot: 'chest', material: 'iron', grade: 'B', gem: null, durability: 100, packed: false });
  assert.equal(s.nextId, id0 + 1);
  assert.equal(s.gear.length, 1);
  assert.equal(s.time, DAY_START + 45);
  assert.equal(canCraft(s, { slot: 'chest', material: 'iron', grade: 'B' }) !== null, true, 'only 2 bars left');
});

test('craft with a gem needs and consumes the cut gem (+10 minutes)', () => {
  const s = game(1);
  s.storage.bars['steel:A'] = 2;
  const spec = { slot: 'sword', material: 'steel', grade: 'A', gem: { type: 'ruby', grade: 'S' } };
  s.storage.cut['ruby:B'] = 3;
  assert.match(canCraft(s, spec), /cut ruby S/);
  assert.equal(craft(s, spec).ok, false);
  assert.equal(s.storage.bars['steel:A'], 2, 'bars untouched when the gem is missing');
  s.storage.cut['ruby:S'] = 1;
  const r = craft(s, spec);
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.item.gem, { type: 'ruby', grade: 'S' });
  assert.notEqual(r.item.gem, spec.gem, 'gem object is copied');
  assert.equal(s.storage.cut['ruby:S'], 0);
  assert.equal(s.storage.cut['ruby:B'], 3);
  assert.equal(s.storage.bars['steel:A'], 0);
  assert.equal(s.time, DAY_START + 40);
});

test('craft requires camp, work phase, a valid slot and enough time', () => {
  const s = game(1);
  s.storage.bars['copper:D'] = 10;
  assert.equal(craft(s, { slot: 'ring', material: 'copper', grade: 'D' }).ok, false);
  s.time = DAY_END - 29;
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }).ok, false);
  assert.equal(s.storage.bars['copper:D'], 10);
  s.time = DAY_END - 30;
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }).ok, true);
  s.time = DAY_START;
  s.phase = 'over';
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }).ok, false);
  s.phase = 'work';
  standInBlankField(s, 1);
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }).ok, false);
});

// ---------------------------------------------------------------- repair ----
test('repairInfo: 35% of bars (+gem) x missing fraction, rounded up to 0.01; time 50% x craft time x fraction', () => {
  const chest = item('chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  assert.deepEqual(repairInfo(chest), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:S': 0.07 }, minutes: 5.5 });
  // rounding up: 2 x 0.35 x 0.01 = 0.007 -> 0.01 bars
  const helm = item('helmet', 'copper', 'C', null, { durability: 99 });
  assert.deepEqual(repairInfo(helm).bars, { 'copper:C': 0.01 });
  assert.deepEqual(repairInfo(helm).gems, {});
  // 3 x 0.35 x 0.99 = 1.0395 -> 1.04
  assert.deepEqual(repairInfo(item('chest', 'iron', 'D', null, { durability: 1 })).bars, { 'iron:D': 1.04 });
  // full repair from 0 would be 35% of everything and 50% of the time
  const z = repairInfo(item('sword', 'mythril', 'S', { type: 'topaz', grade: 'A' }, { durability: 0 }));
  assert.deepEqual(z, { missing: 100, bars: { 'mythril:S': 0.7 }, gems: { 'topaz:A': 0.35 }, minutes: 20 });
  // exact hundredths are not bumped up: 2 x 0.35 x 0.5 = 0.35
  assert.deepEqual(repairInfo(item('boots', 'copper', 'D', null, { durability: 50 })).bars, { 'copper:D': 0.35 });
  // nothing missing -> free
  assert.deepEqual(repairInfo(item('boots')), { missing: 0, bars: { 'copper:D': 0 }, gems: {}, minutes: 0 });
});

test('repairInfo amounts never undercharge (ceil to 0.01) for every durability', () => {
  for (let dur = 0; dur <= 100; dur++) {
    for (const slot of SLOTS) {
      const info = repairInfo(item(slot, 'iron', 'B', { type: 'ruby', grade: 'D' }, { durability: dur }));
      const exactBars = CONFIG.gear.slots[slot].bars * 0.35 * ((100 - dur) / 100);
      const bars = info.bars['iron:B'];
      assert.ok(bars + 1e-9 >= exactBars, `${slot} ${dur}: ${bars} < ${exactBars}`);
      assert.ok(bars - exactBars < 0.01 + 1e-9, `${slot} ${dur}: overcharged ${bars} vs ${exactBars}`);
      assert.ok(approx(bars * 100, Math.round(bars * 100), 1e-6), 'multiple of 0.01');
      const exactGem = 0.35 * ((100 - dur) / 100);
      assert.ok(info.gems['ruby:D'] + 1e-9 >= exactGem);
      assert.ok(info.gems['ruby:D'] - exactGem < 0.01 + 1e-9);
    }
  }
});

test('repair consumes fractional bars and gems, restores 100% and spends time', () => {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  s.storage.bars['iron:B'] = 1;
  s.storage.cut['ruby:S'] = 1;
  const r = repair(s, g.id);
  assert.equal(r.ok, true, r.msg);
  assert.equal(g.durability, 100);
  assert.equal(s.storage.bars['iron:B'], 0.79);
  assert.equal(s.storage.cut['ruby:S'], 0.93);
  assert.equal(s.time, DAY_START + 5.5);
  assert.equal(repair(s, g.id).ok, false, 'already at 100%');
});

test('repeated fractional repairs keep clean 0.01 amounts and can use the last fraction', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 90 }); // 0.07 bars each
  s.storage.bars['copper:D'] = 0.21;
  for (let i = 0; i < 3; i++) {
    g.durability = 90;
    assert.equal(repair(s, g.id).ok, true, `repair ${i}`);
  }
  assert.equal(s.storage.bars['copper:D'], 0);
  g.durability = 90;
  const r = repair(s, g.id);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Need 0.07/);
});

test('repair refuses when materials are short (nothing consumed)', () => {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  s.storage.bars['iron:B'] = 0.2; // need 0.21
  s.storage.cut['ruby:S'] = 1;
  assert.equal(repair(s, g.id).ok, false);
  s.storage.bars['iron:B'] = 0.21;
  s.storage.cut['ruby:S'] = 0.06; // need 0.07
  assert.equal(repair(s, g.id).ok, false);
  assert.equal(s.storage.bars['iron:B'], 0.21);
  assert.equal(g.durability, 80);
  assert.equal(s.time, DAY_START);
});

test('packed gear cannot be repaired; unknown ids and time are checked', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 50, packed: true });
  s.storage.bars['copper:D'] = 5;
  const r = repair(s, g.id);
  assert.equal(r.ok, false);
  assert.match(r.msg, /adventurer/);
  assert.equal(g.durability, 50);
  assert.equal(repair(s, 9999).ok, false);
  g.packed = false;
  s.time = DAY_END - 7; // needs 7.5
  assert.equal(repair(s, g.id).ok, false);
  s.time = DAY_END - 7.5;
  assert.equal(repair(s, g.id).ok, true);
});

test('scrap removes unpacked gear only', () => {
  const s = game(1);
  const a = addGear(s, 'sword');
  const b = addGear(s, 'boots', 'copper', 'D', null, { packed: true });
  assert.equal(scrap(s, b.id).ok, false);
  assert.equal(scrap(s, a.id).ok, true);
  assert.deepEqual(s.gear.map((g) => g.id), [b.id]);
  assert.equal(scrap(s, a.id).ok, false);
});
