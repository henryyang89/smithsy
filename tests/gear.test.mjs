import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SLOTS, GRADES, BARS } from '../js/config.js';
import * as GearModule from '../js/core/gear.js';
import {
  gearStats, craft, canCraft, craftCost, craftMinutes, smithMinutes, repairInfo, repairMinutes, repair, scrap, scrapReturn, gearName, barKey, statsText,
  repairPlan, substituteWarning, gearPower, shownDurability, worstWear, couldBreak, gearMatchNotes, GEM_MATCH, wearLoss,
} from '../js/core/gear.js';
import { endDay, acknowledgeReport, confirmPlan } from '../js/core/game.js';
import { xpToNext } from '../js/core/skills.js';
import { round1 } from '../js/core/util.js';
import { game, approx, addGear, standInBlankField, setSkillLevel, totalXp, cfgWith, WEAK_ENEMIES, DAY_END, DAY_START } from './helpers.mjs';

const item = (slot, material = 'copper', grade = 'D', gem = null, extra = {}) => ({ id: 1, slot, material, grade, gem, durability: 100, packed: false, ...extra });
const close = (a, b, msg = '') => assert.ok(approx(a, b, 1e-9), `${a} != ${b} ${msg}`);

// Pinned gear numbers: the hand-computed stats / costs / minutes below hold whatever CONFIG says.
const PG = cfgWith({
  gear: {
    materialMult: { copper: 1.0, iron: 1.5, steel: 2.0, mythril: 3.0 },
    gradeMult: { D: 1.0, C: 1.1, B: 1.2, A: 1.3, S: 1.5 },
    slots: {
      sword: { bars: 2, stats: { damage: 10, accuracy: 10 } },
      chest: { bars: 3, stats: { defense: 6 } },
      helmet: { bars: 2, stats: { defense: 4 } },
      gloves: { bars: 2, stats: { defense: 2, accuracy: 10 } },
      boots: { bars: 2, stats: { defense: 2, dodge: 10, speed: 3 } },
    },
    smithMinPerBar: 15,
    infuseMin: 10,
    gemArmorMult: { chest: 1.25, helmet: 1.1, gloves: 1.0, boots: 1.0 },
    repair: { materialFraction: 35, gemFraction: 35, timeFraction: 50 },
  },
  skills: {
    xpBase: 100,
    xpPerItem: { copper: 25, iron: 25, steel: 30, mythril: 50 },
    activity: { repairTime: { effects: { repairTime: 1 } } },
    perMaterial: { smith: { effects: { smithTime: 2, repairTime: 0.5 } }, repair: { xp: 1, effects: { repairTime: 3 } } },
  },
  gemEffects: {
    ruby: { weapon: { magicPct: [10, 15, 20, 25, 30] }, armor: { magicRes: [4, 6, 8, 10, 12] } },
    topaz: { weapon: { stunChance: [4, 6, 8, 10, 12], stunDur: [0.5, 0.6, 0.7, 0.8, 1.0] }, armor: { stunChanceRed: [4, 6, 8, 10, 12], stunDurRed: [4, 6, 8, 10, 12] } },
    emerald: { weapon: { accuracy: [10, 15, 20, 25, 30] }, armor: { dodge: [4, 6, 8, 10, 12] } },
    sapphire: { weapon: { slowPct: [10, 15, 20, 25, 30], slowDur: [1, 1.5, 2, 2.5, 3] }, armor: { slowRed: [4, 6, 8, 10, 12], slowDurRed: [4, 6, 8, 10, 12] } },
    diamond: { weapon: { pierce: [10, 15, 20, 25, 30] }, armor: { pierceRes: [4, 6, 8, 10, 12] } },
  },
});

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
  // spot checks (pinned numbers)
  close(gearStats(item('chest', 'iron', 'B'), PG).defense, 10.8); // 6 x 1.5 x 1.2
  assert.deepEqual(gearStats(item('sword', 'mythril', 'S'), PG), { damage: 45, accuracy: 45 });
  assert.deepEqual(gearStats(item('boots'), PG), { defense: 2, dodge: 10, speed: 3 });
  close(gearStats(item('gloves', 'steel', 'C'), PG).accuracy, 22);
});

test('better materials and grades never make gear weaker (config ordering)', () => {
  const { materialMult, gradeMult } = CONFIG.gear;
  for (let i = 1; i < BARS.length; i++) assert.ok(materialMult[BARS[i]] >= materialMult[BARS[i - 1]], BARS[i]);
  for (let i = 1; i < GRADES.length; i++) assert.ok(gradeMult[GRADES[i]] >= gradeMult[GRADES[i - 1]], GRADES[i]);
});

test('armor ordering: chest > helmet > gloves = boots defense', () => {
  const d = (slot) => gearStats(item(slot, 'iron', 'B')).defense;
  assert.ok(d('chest') > d('helmet'));
  assert.ok(d('helmet') > d('gloves'));
  assert.equal(d('gloves'), d('boots'));
  // gloves add accuracy, boots add speed and dodge, the sword adds damage and accuracy
  assert.ok(gearStats(item('gloves')).accuracy > 0);
  assert.ok(gearStats(item('boots')).speed > 0 && gearStats(item('boots')).dodge > 0);
  assert.ok(gearStats(item('sword')).damage > 0 && gearStats(item('sword')).accuracy > 0);
});

test('gems add their effect by gem grade (independent of gear grade), from the config tables', () => {
  for (const [type, fx] of Object.entries(CONFIG.gemEffects)) {
    GRADES.forEach((g, gi) => {
      for (const mat of ['copper', 'mythril']) {
        const sw = gearStats(item('sword', mat, 'S', { type, grade: g }));
        const plain = gearStats(item('sword', mat, 'S'));
        for (const [k, arr] of Object.entries(fx.weapon)) close(sw[k], (plain[k] || 0) + arr[gi], `${type} ${g} ${k}`);
        for (const slot of ['chest', 'helmet', 'gloves', 'boots']) {
          const ar = gearStats(item(slot, mat, 'D', { type, grade: g }));
          const base = gearStats(item(slot, mat, 'D'));
          for (const [k, arr] of Object.entries(fx.armor)) close(ar[k], (base[k] || 0) + arr[gi] * CONFIG.gear.gemArmorMult[slot], `${slot} ${type} ${g} ${k}`);
        }
      }
    });
  }
  // armor gem effects are stronger on chests than helmets, and on helmets than gloves/boots
  const M = CONFIG.gear.gemArmorMult;
  assert.ok(M.chest >= M.helmet && M.helmet >= M.gloves && M.gloves === M.boots);
});

test('sword gems add weapon effects by gem grade (independent of gear grade)', () => {
  const fx = PG.gemEffects;
  const sw = (type, grade) => gearStats(item('sword', 'copper', 'D', { type, grade }), PG);
  assert.equal(sw('ruby', 'A').magicPct, fx.ruby.weapon.magicPct[3]);
  assert.deepEqual(sw('topaz', 'S'), { damage: 10, accuracy: 10, stunChance: 12, stunDur: 1.0 });
  assert.equal(sw('emerald', 'C').accuracy, 10 + 15, 'emerald adds to the sword accuracy');
  assert.deepEqual(sw('sapphire', 'B'), { damage: 10, accuracy: 10, slowPct: 20, slowDur: 2 });
  assert.equal(sw('diamond', 'D').pierce, 10);
  // no armor effects on a sword
  assert.equal(sw('ruby', 'S').magicRes, undefined);
});

test('armor gems: chest x1.25, helmet x1.1, gloves/boots x1', () => {
  const ar = (slot, type, grade) => gearStats(item(slot, 'copper', 'D', { type, grade }), PG);
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
  assert.equal(craftMinutes('sword', false, PG), 30);
  assert.equal(craftMinutes('chest', false, PG), 45);
  assert.equal(craftMinutes('chest', true, PG), 55);
  assert.equal(craftMinutes('boots', true, PG), 40);
  // default config
  const C = CONFIG.gear;
  for (const slot of SLOTS) {
    assert.equal(craftMinutes(slot, false), C.slots[slot].bars * C.smithMinPerBar);
    assert.equal(craftMinutes(slot, true), C.slots[slot].bars * C.smithMinPerBar + C.infuseMin);
  }
});

test('craftCost: bars of one material+grade, plus one cut gem', () => {
  assert.deepEqual(craftCost({ slot: 'chest', material: 'iron', grade: 'B' }, PG), { bars: { 'iron:B': 3 }, gems: {} });
  assert.deepEqual(craftCost({ slot: 'sword', material: 'steel', grade: 'S', gem: { type: 'topaz', grade: 'C' } }, PG), { bars: { 'steel:S': 2 }, gems: { 'topaz:C': 1 } });
  for (const slot of SLOTS) assert.deepEqual(craftCost({ slot, material: 'copper', grade: 'D' }), { bars: { 'copper:D': CONFIG.gear.slots[slot].bars }, gems: {} });
});

test('craft requires same-grade bars (mixed grades do not count)', () => {
  const s = game(1);
  s.storage.bars['iron:B'] = 1;
  s.storage.bars['iron:A'] = 1;
  s.storage.bars['copper:B'] = 5;
  const spec = { slot: 'sword', material: 'iron', grade: 'B' };
  assert.match(canCraft(s, spec, PG), /Need 2 iron B bars/);
  const r = craft(s, spec, PG);
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
  const r = craft(s, { slot: 'chest', material: 'iron', grade: 'B' }, PG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.storage.bars['iron:B'], 2);
  assert.deepEqual(r.item, { id: id0, slot: 'chest', material: 'iron', grade: 'B', gem: null, durability: 100, packed: false });
  assert.equal(s.nextId, id0 + 1);
  assert.equal(s.gear.length, 1);
  assert.equal(s.time, DAY_START + 45);
  assert.equal(r.minutes, 45);
  assert.equal(canCraft(s, { slot: 'chest', material: 'iron', grade: 'B' }, PG) !== null, true, 'only 2 bars left');
});

test('craft with a gem needs and consumes the cut gem (+10 minutes)', () => {
  const s = game(1);
  s.storage.bars['steel:A'] = 2;
  const spec = { slot: 'sword', material: 'steel', grade: 'A', gem: { type: 'ruby', grade: 'S' } };
  s.storage.cut['ruby:B'] = 3;
  assert.match(canCraft(s, spec, PG), /cut ruby S/);
  assert.equal(craft(s, spec, PG).ok, false);
  assert.equal(s.storage.bars['steel:A'], 2, 'bars untouched when the gem is missing');
  s.storage.cut['ruby:S'] = 1;
  const r = craft(s, spec, PG);
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
  const sword = { slot: 'sword', material: 'copper', grade: 'D' };
  assert.equal(craft(s, { slot: 'ring', material: 'copper', grade: 'D' }, PG).ok, false);
  s.time = DAY_END - 29;
  assert.equal(craft(s, sword, PG).ok, false);
  assert.equal(s.storage.bars['copper:D'], 10);
  s.time = DAY_END - 30;
  assert.equal(craft(s, sword, PG).ok, true);
  s.time = DAY_START;
  s.phase = 'over';
  assert.equal(craft(s, sword, PG).ok, false);
  s.phase = 'work';
  standInBlankField(s, 1);
  assert.equal(craft(s, sword, PG).ok, false);
});

test('smithMinutes: craft time x (1 - the bar type\'s Smithing skill), capped; craft spends it and says so', () => {
  const s = game(1);
  assert.equal(smithMinutes(s, 'sword', 'iron', false, PG), craftMinutes('sword', false, PG));
  assert.equal(smithMinutes(s, 'sword', 'iron', true, PG), craftMinutes('sword', true, PG));
  setSkillLevel(s, 'smith_iron', 5); // 2% per level -> 10% less
  assert.equal(smithMinutes(s, 'chest', 'iron', false, PG), round1(craftMinutes('chest', false, PG) * 0.9)); // 45 -> 40.5
  assert.equal(smithMinutes(s, 'chest', 'iron', true, PG), round1(craftMinutes('chest', true, PG) * 0.9)); // 55 -> 49.5
  assert.equal(smithMinutes(s, 'chest', 'copper', false, PG), craftMinutes('chest', false, PG), 'only iron gear gets the iron skill');
  // capped at maxTimeReduction
  const capped = cfgWith(PG, { processing: { maxTimeReduction: 5 } });
  assert.equal(smithMinutes(s, 'chest', 'iron', false, capped), round1(craftMinutes('chest', false, capped) * 0.95));
  // craft uses it
  s.storage.bars['iron:B'] = 3;
  const r = craft(s, { slot: 'chest', material: 'iron', grade: 'B' }, PG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, 40.5);
  assert.equal(s.time, DAY_START + 40.5);
  assert.match(r.msg, /\(40\.5m\)/);
  // the time check uses the skilled time too: 40.5 fits where 45 would not
  const t = game(1);
  setSkillLevel(t, 'smith_iron', 5);
  t.storage.bars['iron:B'] = 3;
  t.time = DAY_END - 41;
  assert.equal(craft(t, { slot: 'chest', material: 'iron', grade: 'B' }, PG).ok, true);
  const u = game(1);
  u.storage.bars['iron:B'] = 3;
  u.time = DAY_END - 41;
  assert.equal(craft(u, { slot: 'chest', material: 'iron', grade: 'B' }, PG).ok, false);
});

test('craft XP: bars in the item x xpPerItem of the material, to that bar type\'s Smithing skill only', () => {
  const s = game(1);
  s.storage.bars['steel:C'] = 5;
  s.storage.bars['copper:D'] = 5;
  const X = PG.skills.xpPerItem;
  assert.equal(craft(s, { slot: 'chest', material: 'steel', grade: 'C' }, PG).ok, true);
  assert.equal(totalXp(s, 'smith_steel', PG), PG.gear.slots.chest.bars * X.steel);
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }, PG).ok, true);
  assert.equal(totalXp(s, 'smith_copper', PG), PG.gear.slots.sword.bars * X.copper);
  assert.equal(s.skills.smith_iron.xp, 0);
  // a level is reported in the result's notes
  s.storage.bars['copper:D'] = 20;
  s.skills.smith_copper.xp = xpToNext(0, PG) - 1;
  const r = craft(s, { slot: 'helmet', material: 'copper', grade: 'D' }, PG);
  assert.ok(r.notes.includes('Skill up: Copper smithing is now level 1.'), JSON.stringify(r.notes));
  // a refused craft earns nothing
  const t = game(1);
  assert.equal(craft(t, { slot: 'sword', material: 'copper', grade: 'D' }, PG).ok, false);
  assert.equal(t.skills.smith_copper.xp, 0);
});

// ---------------------------------------------------------------- repair ----
test('repairInfo: materialFraction of the bars and gemFraction of the gem x missing fraction, rounded up to 0.01; timeFraction x craft time x fraction', () => {
  const chest = item('chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  assert.deepEqual(repairInfo(chest, PG), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:S': 0.07 }, baseMinutes: 5.5 });
  // the gem has its own fraction: 10% of the gem x 20% missing = 0.02 (the bars still cost 35%)
  const gemCheap = cfgWith(PG, { gear: { repair: { gemFraction: 10 } } });
  assert.deepEqual(repairInfo(chest, gemCheap), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:S': 0.02 }, baseMinutes: 5.5 });
  // gemFraction 0: repairs cost bars only
  const noGem = cfgWith(PG, { gear: { repair: { gemFraction: 0 } } });
  assert.deepEqual(repairInfo(chest, noGem).gems, { 'ruby:S': 0 });
  // the time follows timeFraction
  const full = cfgWith(PG, { gear: { repair: { timeFraction: 100 } } });
  assert.equal(repairInfo(chest, full).baseMinutes, 11);
  // rounding up: 2 x 0.35 x 0.01 = 0.007 -> 0.01 bars
  const helm = item('helmet', 'copper', 'C', null, { durability: 99 });
  assert.deepEqual(repairInfo(helm, PG).bars, { 'copper:C': 0.01 });
  assert.deepEqual(repairInfo(helm, PG).gems, {});
  // 3 x 0.35 x 0.99 = 1.0395 -> 1.04
  assert.deepEqual(repairInfo(item('chest', 'iron', 'D', null, { durability: 1 }), PG).bars, { 'iron:D': 1.04 });
  // full repair from 0 would be 35% of everything and 50% of the time
  const z = repairInfo(item('sword', 'mythril', 'S', { type: 'topaz', grade: 'A' }, { durability: 0 }), PG);
  assert.deepEqual(z, { missing: 100, bars: { 'mythril:S': 0.7 }, gems: { 'topaz:A': 0.35 }, baseMinutes: 20 });
  // exact hundredths are not bumped up: 2 x 0.35 x 0.5 = 0.35
  assert.deepEqual(repairInfo(item('boots', 'copper', 'D', null, { durability: 50 }), PG).bars, { 'copper:D': 0.35 });
  // nothing missing -> free
  assert.deepEqual(repairInfo(item('boots'), PG), { missing: 0, bars: { 'copper:D': 0 }, gems: {}, baseMinutes: 0 });
});

test('repairInfo amounts never undercharge (ceil to 0.01) for every durability', () => {
  const f = CONFIG.gear.repair.materialFraction / 100;
  const gf = CONFIG.gear.repair.gemFraction / 100;
  for (let dur = 0; dur <= 100; dur++) {
    for (const slot of SLOTS) {
      const info = repairInfo(item(slot, 'iron', 'B', { type: 'ruby', grade: 'D' }, { durability: dur }));
      const exactBars = CONFIG.gear.slots[slot].bars * f * ((100 - dur) / 100);
      const bars = info.bars['iron:B'];
      assert.ok(bars + 1e-9 >= exactBars, `${slot} ${dur}: ${bars} < ${exactBars}`);
      assert.ok(bars - exactBars < 0.01 + 1e-9, `${slot} ${dur}: overcharged ${bars} vs ${exactBars}`);
      assert.ok(approx(bars * 100, Math.round(bars * 100), 1e-6), 'multiple of 0.01');
      const exactGem = gf * ((100 - dur) / 100);
      assert.ok(info.gems['ruby:D'] + 1e-9 >= exactGem);
      assert.ok(info.gems['ruby:D'] - exactGem < 0.01 + 1e-9);
      const exactMin = craftMinutes(slot, true) * (CONFIG.gear.repair.timeFraction / 100) * ((100 - dur) / 100);
      assert.ok(Math.abs(info.baseMinutes - exactMin) <= 0.05 + 1e-9, 'minutes rounded to 0.1');
    }
  }
});

test('repair consumes fractional bars and gems, restores 100% and spends time', () => {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  s.storage.bars['iron:B'] = 1;
  s.storage.cut['ruby:S'] = 1;
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(g.durability, 100);
  assert.equal(s.storage.bars['iron:B'], 0.79);
  assert.equal(s.storage.cut['ruby:S'], 0.93);
  assert.equal(s.time, DAY_START + 5.5);
  assert.equal(repair(s, g.id, PG).ok, false, 'already at 100%');
});

test('repeated fractional repairs keep clean 0.01 amounts and can use the last fraction', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 90 }); // 0.07 bars each
  s.storage.bars['copper:D'] = 0.21;
  for (let i = 0; i < 3; i++) {
    g.durability = 90;
    assert.equal(repair(s, g.id, PG).ok, true, `repair ${i}`);
  }
  assert.equal(s.storage.bars['copper:D'], 0);
  g.durability = 90;
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Need 0.07/);
});

test('repair refuses when materials are short (nothing consumed)', () => {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  s.storage.bars['iron:B'] = 0.2; // need 0.21
  s.storage.cut['ruby:S'] = 1;
  assert.equal(repair(s, g.id, PG).ok, false);
  s.storage.bars['iron:B'] = 0.21;
  s.storage.cut['ruby:S'] = 0.06; // need 0.07
  assert.equal(repair(s, g.id, PG).ok, false);
  assert.equal(s.storage.bars['iron:B'], 0.21);
  assert.equal(g.durability, 80);
  assert.equal(s.time, DAY_START);
});

test('packed gear cannot be repaired; unknown ids and time are checked', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 50, packed: true });
  s.storage.bars['copper:D'] = 5;
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, false);
  assert.match(r.msg, /adventurer/);
  assert.equal(g.durability, 50);
  assert.equal(repair(s, 9999, PG).ok, false);
  g.packed = false;
  s.time = DAY_END - 7; // needs 7.5
  assert.equal(repair(s, g.id, PG).ok, false);
  s.time = DAY_END - 7.5;
  assert.equal(repair(s, g.id, PG).ok, true);
});

test('repair requires camp and the work phase; there is no night repair (report, plan and over refuse)', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 50 });
  s.storage.bars['copper:D'] = 5;
  standInBlankField(s, 1);
  assert.match(repair(s, g.id, PG).msg, /camp/);
  assert.equal(g.durability, 50);
  assert.equal(s.storage.bars['copper:D'], 5);
  assert.equal(s.time, DAY_START);
  s.location = { ...s.map.camp };
  for (const phase of ['report', 'plan', 'over']) {
    s.phase = phase;
    const r = repair(s, g.id, PG);
    assert.equal(r.ok, false, phase);
    assert.match(r.msg, /work day/, phase);
    assert.equal(g.durability, 50, phase);
    assert.equal(s.storage.bars['copper:D'], 5, phase);
    assert.equal(s.time, DAY_START, phase);
  }
  // by day the plan carries the repair time
  s.phase = 'work';
  assert.equal(repairPlan(s, g, PG).minutes, repairInfo(g, PG).baseMinutes);
  assert.ok(repairInfo(g, PG).baseMinutes > 0);
  assert.equal('isNight' in GearModule, false, 'the night rule is gone');
});

test('repairMinutes: base time x (1 - repair skills), the skills of the item\'s bar type, capped at maxTimeReduction', () => {
  const s = game(1);
  const g = item('chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  const base = repairInfo(g, PG).baseMinutes; // 5.5
  assert.equal(repairMinutes(s, g, PG), base);
  // 3 x Iron repair + 1 x General repair + 0.5 x Iron smithing, per level
  setSkillLevel(s, 'repair_iron', 2); // 6%
  setSkillLevel(s, 'repairTime', 3); // 3%
  setSkillLevel(s, 'smith_iron', 4); // 2%
  assert.equal(repairMinutes(s, g, PG), round1(base * (1 - 0.11)));
  assert.equal(repairPlan(s, g, PG).minutes, round1(base * (1 - 0.11)), 'the plan quotes the same time');
  // other bar types: General repair only
  const copper = item('chest', 'copper', 'B', null, { durability: 80 });
  assert.equal(repairMinutes(s, copper, PG), round1(repairInfo(copper, PG).baseMinutes * (1 - 0.03)));
  // capped
  const capped = cfgWith(PG, { processing: { maxTimeReduction: 10 } });
  assert.equal(repairMinutes(s, g, capped), round1(base * 0.9));
  const big = cfgWith(PG, { skills: { perMaterial: { repair: { effects: { repairTime: 99 } } } } });
  assert.equal(repairMinutes(s, g, big), round1(base * (1 - PG.processing.maxTimeReduction / 100)));
  // repair() spends the skilled time and says so
  const t = game(1);
  const it = addGear(t, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  t.storage.bars['iron:B'] = 1;
  t.storage.cut['ruby:S'] = 1;
  setSkillLevel(t, 'repair_iron', 2);
  const want = repairMinutes(t, it, PG);
  const r = repair(t, it.id, PG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, want);
  assert.equal(t.time, DAY_START + want);
});

test('repair earns XP: durability points x bars in the item, to the bar type\'s Repair skill and to General repair', () => {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', null, { durability: 80 }); // 20 points, 3 bars
  s.storage.bars['iron:B'] = 5;
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, true, r.msg);
  const points = 20 * PG.gear.slots.chest.bars;
  assert.equal(totalXp(s, 'repair_iron', PG), points * PG.skills.perMaterial.repair.xp);
  assert.equal(totalXp(s, 'repairTime', PG), points * PG.skills.activity.repairTime.xp);
  assert.equal(s.skills.repair_copper.xp, 0, 'other bar types get nothing');
  // a level gained is reported in the result's notes
  const t = game(1);
  const sw = addGear(t, 'sword', 'copper', 'D', null, { durability: 0.1 });
  t.storage.bars['copper:D'] = 5;
  t.skills.repair_copper.xp = xpToNext(0, PG) - 1;
  const r2 = repair(t, sw.id, PG);
  assert.equal(r2.ok, true, r2.msg);
  assert.equal(t.skills.repair_copper.level, 1);
  // General repair got the same repair's XP (its own xp per point); the level it reached follows from the config
  let generalXp = totalXp(t, 'repairTime', PG);
  let generalLevel = 0;
  while (generalXp >= xpToNext(generalLevel, PG)) generalXp -= xpToNext(generalLevel++, PG);
  assert.ok(generalLevel >= 1, 'this repair is worth at least General repair level 1');
  assert.equal(t.skills.repairTime.level, generalLevel);
  assert.deepEqual(r2.notes, ['Skill up: Copper repair is now level 1.', `Skill up: General repair is now level ${generalLevel}.`]);
  // a refused repair earns nothing
  const u = game(1);
  const it = addGear(u, 'sword', 'copper', 'D', null, { durability: 50 });
  assert.equal(repair(u, it.id, PG).ok, false, 'no bars');
  assert.equal(u.skills.repair_copper.xp, 0);
  assert.equal(u.skills.repairTime.xp, 0);
});

test('craft and repair XP read the skill definitions: a skill\'s own xp replaces the material\'s xpPerItem, and removing repair.xp does not give NaN', () => {
  const own = cfgWith({ skills: { xpPerItem: { copper: 25 }, perMaterial: { smith: { xp: 7 }, repair: { xp: 3 } }, activity: { repairTime: { xp: 4 } } } });
  const s = game(1);
  s.storage.bars['copper:D'] = 10;
  assert.equal(craft(s, { slot: 'sword', material: 'copper', grade: 'D' }, own).ok, true);
  assert.equal(totalXp(s, 'smith_copper', own), own.gear.slots.sword.bars * 7, 'the smithing skill\'s own xp, not xpPerItem');
  const g = addGear(s, 'chest', 'copper', 'D', null, { durability: 80 });
  assert.equal(repair(s, g.id, own).ok, true);
  const points = 20 * own.gear.slots.chest.bars;
  assert.equal(totalXp(s, 'repair_copper', own), points * 3);
  assert.equal(totalXp(s, 'repairTime', own), points * 4);
  // a repair skill without an xp of its own falls back to the material's xpPerItem (never NaN)
  const bare = cfgWith({ skills: { xpPerItem: { copper: 25 }, perMaterial: { repair: { xp: null } }, activity: { repairTime: { xp: null } } } });
  const t = game(1);
  t.storage.bars['copper:D'] = 10;
  const h = addGear(t, 'chest', 'copper', 'D', null, { durability: 80 });
  assert.equal(repair(t, h.id, bare).ok, true);
  assert.equal(totalXp(t, 'repair_copper', bare), 20 * bare.gear.slots.chest.bars * 25);
  assert.ok(Number.isFinite(t.skills.repairTime.xp));
});

test('repair through the real day flow: used gear that is not packed again can be repaired at camp the next day; packed gear cannot', () => {
  const cfg = cfgWith(WEAK_ENEMIES);
  const s = game(5, cfg);
  const sw = addGear(s, 'sword', 'copper', 'D');
  const spare = addGear(s, 'sword', 'copper', 'D');
  s.storage.bars['copper:D'] = 5;
  assert.equal(endDay(s, cfg).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [sw.id], ringIds: [] }, cfg).ok, true);
  // day 2: the adventurer has the sword; packed gear is refused by day, the spare is home
  sw.durability = 90;
  assert.match(repair(s, sw.id, cfg).msg, /adventurer/);
  assert.equal(sw.durability, 90);
  sw.durability = 100;
  assert.equal(endDay(s, cfg).ok, true);
  assert.equal(s.phase, 'report');
  assert.equal(sw.packed, false, 'home again');
  assert.ok(sw.durability < 100, 'the fight wore the sword');
  // night: no repairs, in the report or in the plan
  assert.equal(repair(s, sw.id, cfg).ok, false);
  assert.equal(acknowledgeReport(s).ok, true);
  assert.equal(repair(s, sw.id, cfg).ok, false);
  // tomorrow: leave the worn sword home (pack the spare) -> it can be repaired at camp, for time and bars
  const worn = sw.durability;
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [spare.id], ringIds: [] }, cfg).ok, true);
  assert.equal(s.time, DAY_START);
  assert.equal(sw.durability, worn);
  assert.equal(repair(s, spare.id, cfg).ok, false, 'the packed spare is away');
  const cost = repairInfo(sw, cfg).bars['copper:D'];
  const minutes = repairMinutes(s, sw, cfg);
  assert.ok(minutes > 0);
  const r = repair(s, sw.id, cfg);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, minutes);
  assert.equal(s.time, DAY_START + minutes);
  assert.equal(sw.durability, 100);
  assert.ok(approx(s.storage.bars['copper:D'], 5 - cost, 1e-9));
});

// ------------------------------------------------- repair with higher grades ----
// Chest, iron B + ruby C, 80% -> needs 0.21 iron bars and 0.07 cut ruby (pinned PG numbers).
function subSetup(bars = {}, cut = {}) {
  const s = game(1);
  const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'C' }, { durability: 80 });
  Object.assign(s.storage.bars, bars);
  Object.assign(s.storage.cut, cut);
  return { s, g };
}

test('repairPlan uses the exact grade when there is enough, even with higher grades in stock', () => {
  const { s, g } = subSetup({ 'iron:B': 1, 'iron:A': 5, 'iron:S': 5 }, { 'ruby:C': 1, 'ruby:S': 1 });
  const info = repairInfo(g, PG);
  const plan = repairPlan(s, g, PG);
  assert.deepEqual(plan, { ok: true, reason: null, bars: info.bars, gems: info.gems, substitutes: [], minutes: info.baseMinutes, missing: info.missing });
  assert.deepEqual(plan.bars, { 'iron:B': 0.21 });
  assert.deepEqual(plan.gems, { 'ruby:C': 0.07 });
  assert.equal(substituteWarning(plan), null);
});

test('repairPlan falls back to the lowest higher grade with enough stock (bars and gem independently)', () => {
  // bars: B short, A short, S enough (lower grades never count); gem exact
  let { s, g } = subSetup({ 'iron:D': 9, 'iron:C': 9, 'iron:B': 0.2, 'iron:A': 0.1, 'iron:S': 5 }, { 'ruby:C': 1 });
  let plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.bars, { 'iron:S': 0.21 });
  assert.deepEqual(plan.gems, { 'ruby:C': 0.07 });
  assert.equal(plan.substitutes.length, 1);
  const [sub] = plan.substitutes;
  assert.deepEqual([sub.need, sub.use, sub.qty], ['B', 'S', 0.21]);
  assert.match(sub.kind, /iron/);
  // A has exactly enough -> A (the lowest higher grade), not S
  ({ s, g } = subSetup({ 'iron:B': 0.2, 'iron:A': 0.21, 'iron:S': 5 }, { 'ruby:C': 1 }));
  assert.deepEqual(repairPlan(s, g, PG).bars, { 'iron:A': 0.21 });
  // gem substituted, bars exact
  ({ s, g } = subSetup({ 'iron:B': 1 }, { 'ruby:D': 5, 'ruby:C': 0.06, 'ruby:B': 0.5, 'ruby:A': 1 }));
  plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.bars, { 'iron:B': 0.21 });
  assert.deepEqual(plan.gems, { 'ruby:B': 0.07 });
  assert.equal(plan.substitutes.length, 1);
  assert.equal(plan.substitutes[0].need, 'C');
  assert.equal(plan.substitutes[0].use, 'B');
  assert.equal(plan.substitutes[0].qty, 0.07);
  assert.match(plan.substitutes[0].kind, /ruby/);
  // both substituted: one entry each, the warning names both
  ({ s, g } = subSetup({ 'iron:A': 1 }, { 'ruby:S': 1 }));
  plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.bars, { 'iron:A': 0.21 });
  assert.deepEqual(plan.gems, { 'ruby:S': 0.07 });
  assert.deepEqual(plan.substitutes.map((x) => [x.need, x.use]), [['B', 'A'], ['C', 'S']]);
  const warn = substituteWarning(plan);
  assert.equal(typeof warn, 'string');
  for (const x of plan.substitutes) assert.ok(warn.includes(x.kind) && warn.includes(x.use) && warn.includes(String(x.qty)), warn);
  // substitutes use the same amount as the exact grade would, and the plan's time is unchanged
  assert.equal(plan.minutes, repairInfo(g, PG).baseMinutes);
});

test('repairPlan fails with a reason when no grade at or above the needed one has enough', () => {
  // bars: only lower grades, a different material, and two short higher stacks (they do not combine)
  let { s, g } = subSetup({ 'iron:D': 10, 'iron:C': 10, 'iron:B': 0.2, 'iron:A': 0.1, 'steel:S': 10 }, { 'ruby:C': 1 });
  let plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /0\.21 iron/);
  assert.match(plan.reason, /\bB\b/);
  // gem: lower grade and a different gem type do not help
  ({ s, g } = subSetup({ 'iron:B': 1 }, { 'ruby:D': 5, 'topaz:S': 5 }));
  plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /0\.07 cut ruby/);
  assert.doesNotMatch(plan.reason, /iron/);
  // both missing -> both named
  ({ s, g } = subSetup({}, {}));
  plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, false);
  assert.match(plan.reason, /iron/);
  assert.match(plan.reason, /ruby/);
  // an S item needs S
  const s2 = game(1);
  const top = addGear(s2, 'sword', 'steel', 'S', null, { durability: 50 });
  s2.storage.bars['steel:A'] = 10;
  assert.equal(repairPlan(s2, top, PG).ok, false);
  // repair refuses with that reason and changes nothing
  ({ s, g } = subSetup({ 'iron:A': 0.1 }, { 'ruby:S': 1 }));
  const before = structuredClone(s.storage);
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, false);
  assert.equal(r.msg, repairPlan(s, g, PG).reason);
  assert.deepEqual(s.storage, before);
  assert.equal(g.durability, 80);
  assert.equal(s.time, DAY_START);
});

test('repair consumes exactly what repairPlan chose and reports substitutes + the warning (no benefit)', () => {
  const { s, g } = subSetup({ 'iron:B': 0.1, 'iron:A': 1, 'iron:S': 1 }, { 'ruby:C': 0, 'ruby:A': 0.5, 'ruby:S': 1 });
  const stats = gearStats(g, PG);
  const plan = repairPlan(s, g, PG);
  assert.equal(plan.ok, true);
  assert.deepEqual(plan.bars, { 'iron:A': 0.21 });
  assert.deepEqual(plan.gems, { 'ruby:A': 0.07 });
  const before = structuredClone(s.storage);
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(r.substitutes, plan.substitutes);
  assert.ok(r.msg.includes(substituteWarning(plan)), r.msg);
  assert.equal(r.minutes, plan.minutes);
  for (const store of ['bars', 'cut']) {
    const used = store === 'bars' ? plan.bars : plan.gems;
    for (const k of new Set([...Object.keys(before[store]), ...Object.keys(s.storage[store])])) {
      assert.ok(approx(s.storage[store][k] || 0, (before[store][k] || 0) - (used[k] || 0), 1e-9), `${store} ${k}`);
    }
  }
  // no benefit: the item keeps its own grades and stats
  assert.equal(g.grade, 'B');
  assert.deepEqual(g.gem, { type: 'ruby', grade: 'C' });
  assert.deepEqual(gearStats(g, PG), stats);
  assert.equal(g.durability, 100);
  // exact grade: no substitutes, no warning
  const exact = subSetup({ 'iron:B': 1, 'iron:S': 1 }, { 'ruby:C': 1 });
  const exactPlan = repairPlan(exact.s, exact.g, PG);
  const exactRepair = repair(exact.s, exact.g.id, PG);
  assert.equal(exactRepair.ok, true);
  assert.deepEqual(exactRepair.substitutes, []);
  assert.equal(substituteWarning(exactPlan), null);
  assert.equal(exactRepair.msg, `Repaired ${gearName(exact.g)} to 100% (${exactPlan.minutes}m).`);
  assert.equal(exact.s.storage.bars['iron:S'], 1);
});

test('repairInfo still quotes the exact grade, whatever is in stock', () => {
  const { g } = subSetup({ 'iron:S': 10 }, { 'ruby:S': 10 });
  assert.deepEqual(repairInfo(g, PG), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:C': 0.07 }, baseMinutes: 5.5 });
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

test('scrapReturn: the item\'s bars x materialFraction x durability, rounded down to 0.01 (60% copper sword 0.42, 59.6% 0.41, 0% 0)', () => {
  const sword = (dur, extra = {}) => item('sword', 'copper', 'C', null, { durability: dur, ...extra });
  assert.deepEqual(scrapReturn(sword(60), PG), { key: 'copper:C', qty: 0.42 });
  assert.deepEqual(scrapReturn(sword(59.6), PG), { key: 'copper:C', qty: 0.41 });
  assert.deepEqual(scrapReturn(sword(0), PG), { key: 'copper:C', qty: 0 });
  assert.deepEqual(scrapReturn(sword(100), PG), { key: 'copper:C', qty: 0.7 }, '2 bars x 35%');
  assert.deepEqual(scrapReturn(item('chest', 'steel', 'A', null), PG), { key: 'steel:A', qty: 1.05 }, '3 bars x 35%');
  // material and grade of the item; the gem does not change the bars
  assert.equal(scrapReturn(item('helmet', 'mythril', 'S', { type: 'ruby', grade: 'S' }, { durability: 50 }), PG).key, 'mythril:S');
  assert.equal(scrapReturn(item('helmet', 'mythril', 'S', { type: 'ruby', grade: 'S' }, { durability: 50 }), PG).qty, 0.35);
  // the fraction comes from the config
  const half = cfgWith(PG, { gear: { repair: { materialFraction: 50 } } });
  assert.equal(scrapReturn(sword(60), half).qty, 0.6);
  // default config, every slot and durability: never more than the bars x fraction, a multiple of 0.01, never negative
  for (const slot of SLOTS) {
    for (let d = 0; d <= 100; d += 0.5) {
      const q = scrapReturn(item(slot, 'iron', 'B', null, { durability: d })).qty;
      const exact = CONFIG.gear.slots[slot].bars * (CONFIG.gear.repair.materialFraction / 100) * (d / 100);
      assert.ok(q >= 0 && q <= exact + 1e-9 && exact - q < 0.01 + 1e-9, `${slot} ${d}: ${q} vs ${exact}`);
      assert.ok(approx(q * 100, Math.round(q * 100), 1e-6), `${slot} ${d}: multiple of 0.01`);
    }
  }
});

test('scrap adds the bars to storage, loses the gem, takes no time and says what came back', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'C', { type: 'ruby', grade: 'B' }, { durability: 60 });
  s.storage.bars['copper:C'] = 1;
  const gemsBefore = JSON.stringify(s.storage.cut);
  const t = s.time;
  const r = scrap(s, g.id, PG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.msg, 'Scrapped C Copper Sword: got back 0.42 Copper C bars. The Ruby B gem is lost.');
  assert.equal(s.storage.bars['copper:C'], 1.42);
  assert.equal(JSON.stringify(s.storage.cut), gemsBefore, 'the gem does not come back');
  assert.equal(s.time, t, 'scrapping takes no time');
  assert.deepEqual(s.gear, []);
  // no gem: no gem sentence; fractions are written with two decimals
  const h = addGear(s, 'helmet', 'iron', 'A', null, { durability: 100 });
  const r2 = scrap(s, h.id, PG);
  assert.equal(r2.msg, 'Scrapped A Iron Helmet: got back 0.70 Iron A bars.');
  assert.equal(s.storage.bars['iron:A'], 0.7);
  // fractions add up cleanly (no float drift)
  const a = addGear(s, 'boots', 'iron', 'A', null, { durability: 50 });
  scrap(s, a.id, PG);
  assert.equal(s.storage.bars['iron:A'], 1.05);
  // 0%: nothing comes back, and it still works (the item is gone)
  const z = addGear(s, 'sword', 'copper', 'D', { type: 'ruby', grade: 'D' }, { durability: 0 });
  const rz = scrap(s, z.id, PG);
  assert.equal(rz.ok, true);
  assert.match(rz.msg, /nothing came back/);
  assert.equal(s.storage.bars['copper:D'], 0);
});

test('repairing an item and then scrapping it never gains bars (every slot, durability 1..99)', () => {
  for (const slot of SLOTS) {
    for (let d = 1; d <= 99; d++) {
      const s = game(1);
      const g = addGear(s, slot, 'iron', 'B', null, { durability: d });
      s.storage.bars['iron:B'] = 10;
      const direct = scrapReturn({ ...g }).qty; // scrapping it as it is
      const r = repair(s, g.id);
      assert.equal(r.ok, true, `${slot} ${d}: ${r.msg}`);
      assert.equal(scrap(s, g.id).ok, true);
      const net = s.storage.bars['iron:B'] - 10; // bars after repair + scrap, relative to before
      assert.ok(net <= direct + 1e-9, `${slot} at ${d}%: repair then scrap ${net} > scrap now ${direct}`);
    }
  }
});

test('scrap requires the work phase and being at camp', () => {
  const s = game(1);
  const a = addGear(s, 'sword');
  for (const phase of ['report', 'plan', 'over']) {
    s.phase = phase;
    const r = scrap(s, a.id);
    assert.equal(r.ok, false, phase);
    assert.match(r.msg, /work day/);
  }
  s.phase = 'work';
  standInBlankField(s, 1);
  const r = scrap(s, a.id);
  assert.equal(r.ok, false);
  assert.match(r.msg, /camp/);
  assert.deepEqual(s.gear.map((g) => g.id), [a.id], 'nothing scrapped');
  s.location = { ...s.map.camp };
  assert.equal(scrap(s, a.id).ok, true);
  assert.deepEqual(s.gear, []);
});

// ------------------------------------------------ materials and grades (R21) ----
test('R21: an S item of one material sits between D and C of the next one, closer to C; A stays below the next D', () => {
  const { materialMult: M, gradeMult: G } = CONFIG.gear;
  for (let i = 0; i < BARS.length - 1; i++) {
    const lo = BARS[i];
    const hi = BARS[i + 1];
    const sTop = M[lo] * G.S;
    const dNext = M[hi] * G.D;
    const cNext = M[hi] * G.C;
    const position = (sTop - dNext) / (cNext - dNext); // 0 = the next material's D, 1 = its C
    assert.ok(position > 0.5 && position < 1, `${lo} S sits ${Math.round(position * 100)}% of the way from ${hi} D to ${hi} C`);
    assert.ok(M[lo] * G.A < dNext, `${lo} A (${M[lo] * G.A}) stays below ${hi} D (${dNext})`);
  }
  // the same through gearPower and the stats of a real item
  assert.ok(gearPower(item('chest', 'copper', 'S')) > gearPower(item('chest', 'iron', 'D')));
  assert.ok(gearPower(item('chest', 'copper', 'S')) < gearPower(item('chest', 'iron', 'C')));
  assert.ok(gearStats(item('chest', 'iron', 'S')).defense > gearStats(item('chest', 'steel', 'D')).defense);
  assert.ok(gearStats(item('chest', 'iron', 'A')).defense < gearStats(item('chest', 'steel', 'D')).defense);
});

test('gearPower = material multiplier x grade multiplier (defaults to CONFIG, ignores the gem)', () => {
  for (const m of BARS) for (const g of GRADES) close(gearPower(item('sword', m, g)), CONFIG.gear.materialMult[m] * CONFIG.gear.gradeMult[g]);
  close(gearPower(item('sword', 'iron', 'B', { type: 'ruby', grade: 'S' })), gearPower(item('sword', 'iron', 'B')));
  close(gearPower(item('sword', 'iron', 'B'), PG), 1.5 * 1.2);
});

// ----------------------------------------------- durability display (R9) ----
test('shownDurability: whole numbers rounded down, at least 1 while the item exists, 100 only when full', () => {
  assert.equal(shownDurability(100), 100);
  assert.equal(shownDurability(99.6), 99);
  assert.equal(shownDurability(99.9), 99, '99.9 is not full');
  assert.equal(shownDurability(90.1), 90);
  assert.equal(shownDurability(63), 63);
  assert.equal(shownDurability(0.4), 1);
  assert.equal(shownDurability(0.1), 1);
  assert.equal(shownDurability(0), 0);
  assert.equal(shownDurability(-3), 0);
  assert.equal(shownDurability(120), 100);
  // a hair under a whole number (float noise) is that whole number; a real fraction below it is not
  assert.equal(shownDurability(60 - 1e-12), 60);
  assert.equal(shownDurability(59.99999), 59);
  assert.equal(shownDurability(59.9), 59);
  // every stored value (one decimal) maps to its floor
  for (let tenths = 1; tenths < 1000; tenths++) {
    const d = tenths / 10;
    assert.equal(shownDurability(d), Math.max(1, Math.floor(tenths / 10)), `${d}`);
  }
});

// -------------------------------------------------------- break risk (R11) ----
const WEAR = { gear: { durabilityLoss: { min: 8, max: 12, tierMult: { normal: 1, elite: 1.1, champion: 1.2 } } } };

test('worstWear: the highest roll x the tier multiplier x (1 - Gear care), through the same wearLoss as the fight', () => {
  const cfg = cfgWith(WEAR);
  const s = game(1, cfg);
  close(worstWear(s, 'normal', cfg), 12);
  close(worstWear(s, 'elite', cfg), 13.2);
  close(worstWear(s, 'champion', cfg), 14.4);
  close(worstWear(s, null, cfg), 14.4, 'no tier = the toughest');
  assert.equal(worstWear(s, 'elite', cfg), wearLoss(12, 1.1, 0));
  // Gear care: 10 levels of 1% less loss
  s.skills.gearCare.level = 10;
  const red = 10 * cfg.skills.activity.gearCare.effects.wear;
  close(worstWear(s, 'champion', cfg), wearLoss(12, 1.2, red));
  assert.ok(worstWear(s, 'champion', cfg) < 14.4);
  // a tier without a multiplier counts as x1
  const odd = cfgWith(WEAR, { gear: { durabilityLoss: { tierMult: { elite: 2 } } } });
  close(worstWear(game(1, odd), 'normal', odd), 12);
});

test('couldBreak is true exactly when the worst wear reaches the durability', () => {
  const cfg = cfgWith(WEAR);
  const s = game(1, cfg);
  const at = (d) => item('sword', 'copper', 'D', null, { durability: d });
  assert.equal(couldBreak(at(13.2), s, 'elite', cfg), true, 'equal: a worst roll takes it to 0');
  assert.equal(couldBreak(at(13.3), s, 'elite', cfg), false);
  assert.equal(couldBreak(at(13.1), s, 'elite', cfg), true);
  assert.equal(couldBreak(at(12), s, 'normal', cfg), true);
  assert.equal(couldBreak(at(12.1), s, 'normal', cfg), false);
  assert.equal(couldBreak(at(100), s, 'champion', cfg), false);
  assert.equal(couldBreak(at(1), s, 'normal', cfg), true);
  // no tier = the toughest one
  assert.equal(couldBreak(at(14.4), s, null, cfg), true);
  assert.equal(couldBreak(at(14.5), s, null, cfg), false);
  // property: couldBreak === (worstWear >= durability) over a sweep
  for (const tier of [null, 'normal', 'elite', 'champion']) {
    for (let tenths = 1; tenths <= 1000; tenths += 7) {
      const d = tenths / 10;
      assert.equal(couldBreak(at(d), s, tier, cfg), worstWear(s, tier, cfg) >= d - 1e-9, `${tier} ${d}`);
    }
  }
  // Gear care makes fewer items risky
  const careful = game(1, cfg);
  careful.skills.gearCare.level = 10;
  assert.equal(couldBreak(at(worstWear(s, 'champion', cfg)), careful, 'champion', cfg), false);
});

// ----------------------------------------------- gem matches (R33 notes) ----
test('GEM_MATCH: each gem is about one offensive special (its armor answers it) and one resistance (it blunts the sword)', () => {
  assert.deepEqual(Object.keys(GEM_MATCH).sort(), Object.keys(CONFIG.gemEffects).sort());
  for (const [gem, [special, resist]] of Object.entries(GEM_MATCH)) {
    assert.equal(CONFIG.enemies.attributes[special].side, 'O', `${gem}: ${special} is an offensive attribute`);
    assert.equal(CONFIG.enemies.attributes[resist].side, 'D', `${gem}: ${resist} is a defensive attribute`);
    assert.ok(CONFIG.enemies.pairs.some(([o, d]) => o === special && d === resist), `${gem}: ${special} and ${resist} are a pair`);
  }
});

test('gearMatchNotes: a ruby chest answers a visible High Magical; a ruby sword is blunted by a visible High Magic resistance', () => {
  const enemy = { name: 'Lich', tier: 'champion' };
  const rubyChest = item('chest', 'iron', 'C', { type: 'ruby', grade: 'B' });
  const rubySword = item('sword', 'iron', 'C', { type: 'ruby', grade: 'B' });
  assert.deepEqual(gearMatchNotes(rubyChest, enemy, { magical: 'high' }), [{ kind: 'ok', text: 'answers High Magical' }]);
  assert.deepEqual(gearMatchNotes(rubySword, enemy, { magicRes: 'high' }), [{ kind: 'warn', text: 'blunted by High Magic resistance' }]);
  // the other side of the pair does not matter for that slot
  assert.deepEqual(gearMatchNotes(rubyChest, enemy, { magicRes: 'high' }), []);
  assert.deepEqual(gearMatchNotes(rubySword, enemy, { magical: 'high' }), []);
  // every armor slot answers; every other gem uses its own pair
  for (const slot of ['chest', 'helmet', 'gloves', 'boots']) assert.equal(gearMatchNotes(item(slot, 'iron', 'C', { type: 'diamond', grade: 'D' }), enemy, { piercing: 'high' })[0].kind, 'ok', slot);
  assert.equal(gearMatchNotes(item('chest', 'iron', 'C', { type: 'topaz', grade: 'D' }), enemy, { stunning: 'high' })[0].text, 'answers High Stunning');
  assert.equal(gearMatchNotes(item('helmet', 'iron', 'C', { type: 'sapphire', grade: 'D' }), enemy, { chilling: 'high' })[0].text, 'answers High Chilling');
  assert.equal(gearMatchNotes(item('boots', 'iron', 'C', { type: 'emerald', grade: 'D' }), enemy, { accurate: 'high' })[0].text, 'answers High Accurate');
  assert.equal(gearMatchNotes(item('sword', 'iron', 'C', { type: 'diamond', grade: 'D' }), enemy, { pierceRes: 'high' })[0].text, 'blunted by High Pierce resistance');
  assert.equal(gearMatchNotes(item('sword', 'iron', 'C', { type: 'emerald', grade: 'D' }), enemy, { evasion: 'high' })[0].text, 'blunted by High Evasion');
  // a gem for another pair says nothing
  assert.deepEqual(gearMatchNotes(item('chest', 'iron', 'C', { type: 'topaz', grade: 'D' }), enemy, { magical: 'high' }), []);
});

test('gearMatchNotes: only visible High attributes count - hidden, Normal and Low say nothing, and nothing leaks from the enemy', () => {
  const rubyChest = item('chest', 'iron', 'C', { type: 'ruby', grade: 'B' });
  const rubySword = item('sword', 'iron', 'C', { type: 'ruby', grade: 'B' });
  // the enemy object carries the real levels, but only `known` (what the player sees) is read
  const enemy = { name: 'Lich', tier: 'champion', levels: { magical: 'high', magicRes: 'high' } };
  assert.deepEqual(gearMatchNotes(rubyChest, enemy, {}), [], 'hidden');
  assert.deepEqual(gearMatchNotes(rubySword, enemy, {}), [], 'hidden');
  assert.deepEqual(gearMatchNotes(rubyChest, enemy), [], 'no known levels at all');
  assert.deepEqual(gearMatchNotes(rubyChest, enemy, { magical: 'normal' }), []);
  assert.deepEqual(gearMatchNotes(rubyChest, enemy, { magical: 'low' }), []);
  assert.deepEqual(gearMatchNotes(rubySword, enemy, { magicRes: 'low' }), []);
  // gear without a gem has no notes
  assert.deepEqual(gearMatchNotes(item('chest', 'iron', 'C'), enemy, { magical: 'high' }), []);
});
