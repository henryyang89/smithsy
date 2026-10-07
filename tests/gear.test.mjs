import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SLOTS, GRADES, BARS } from '../js/config.js';
import {
  gearStats, craft, canCraft, craftCost, craftMinutes, repairInfo, repair, scrap, gearName, barKey, statsText,
  repairPlan, substituteWarning, isNight,
} from '../js/core/gear.js';
import { endDay, acknowledgeReport, confirmPlan } from '../js/core/game.js';
import { game, approx, addGear, standInBlankField, cfgWith, WEAK_ENEMIES, DAY_END, DAY_START } from './helpers.mjs';

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
    repair: { materialFraction: 35, timeFraction: 50 },
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

// ---------------------------------------------------------------- repair ----
test('repairInfo: 35% of bars (+gem) x missing fraction, rounded up to 0.01; time 50% x craft time x fraction', () => {
  const chest = item('chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
  assert.deepEqual(repairInfo(chest, PG), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:S': 0.07 }, minutes: 5.5 });
  // rounding up: 2 x 0.35 x 0.01 = 0.007 -> 0.01 bars
  const helm = item('helmet', 'copper', 'C', null, { durability: 99 });
  assert.deepEqual(repairInfo(helm, PG).bars, { 'copper:C': 0.01 });
  assert.deepEqual(repairInfo(helm, PG).gems, {});
  // 3 x 0.35 x 0.99 = 1.0395 -> 1.04
  assert.deepEqual(repairInfo(item('chest', 'iron', 'D', null, { durability: 1 }), PG).bars, { 'iron:D': 1.04 });
  // full repair from 0 would be 35% of everything and 50% of the time
  const z = repairInfo(item('sword', 'mythril', 'S', { type: 'topaz', grade: 'A' }, { durability: 0 }), PG);
  assert.deepEqual(z, { missing: 100, bars: { 'mythril:S': 0.7 }, gems: { 'topaz:A': 0.35 }, minutes: 20 });
  // exact hundredths are not bumped up: 2 x 0.35 x 0.5 = 0.35
  assert.deepEqual(repairInfo(item('boots', 'copper', 'D', null, { durability: 50 }), PG).bars, { 'copper:D': 0.35 });
  // nothing missing -> free
  assert.deepEqual(repairInfo(item('boots'), PG), { missing: 0, bars: { 'copper:D': 0 }, gems: {}, minutes: 0 });
});

test('repairInfo amounts never undercharge (ceil to 0.01) for every durability', () => {
  const f = CONFIG.gear.repair.materialFraction / 100;
  for (let dur = 0; dur <= 100; dur++) {
    for (const slot of SLOTS) {
      const info = repairInfo(item(slot, 'iron', 'B', { type: 'ruby', grade: 'D' }, { durability: dur }));
      const exactBars = CONFIG.gear.slots[slot].bars * f * ((100 - dur) / 100);
      const bars = info.bars['iron:B'];
      assert.ok(bars + 1e-9 >= exactBars, `${slot} ${dur}: ${bars} < ${exactBars}`);
      assert.ok(bars - exactBars < 0.01 + 1e-9, `${slot} ${dur}: overcharged ${bars} vs ${exactBars}`);
      assert.ok(approx(bars * 100, Math.round(bars * 100), 1e-6), 'multiple of 0.01');
      const exactGem = f * ((100 - dur) / 100);
      assert.ok(info.gems['ruby:D'] + 1e-9 >= exactGem);
      assert.ok(info.gems['ruby:D'] - exactGem < 0.01 + 1e-9);
      const exactMin = craftMinutes(slot, true) * (CONFIG.gear.repair.timeFraction / 100) * ((100 - dur) / 100);
      assert.ok(Math.abs(info.minutes - exactMin) <= 0.05 + 1e-9, 'minutes rounded to 0.1');
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

test('by day, repair requires camp (and time); after game over it is refused', () => {
  const s = game(1);
  const g = addGear(s, 'sword', 'copper', 'D', null, { durability: 50 });
  s.storage.bars['copper:D'] = 5;
  assert.equal(isNight(s), false);
  standInBlankField(s, 1);
  assert.match(repair(s, g.id, PG).msg, /camp/);
  assert.equal(g.durability, 50);
  assert.equal(s.storage.bars['copper:D'], 5);
  assert.equal(s.time, DAY_START);
  s.location = { ...s.map.camp };
  s.phase = 'over';
  assert.equal(isNight(s), false, 'game over is not night');
  assert.match(repair(s, g.id, PG).msg, /work day/);
  assert.equal(g.durability, 50);
  // by day the plan carries the full repair time
  s.phase = 'work';
  assert.equal(repairPlan(s, g, PG).minutes, repairInfo(g, PG).minutes);
  assert.ok(repairInfo(g, PG).minutes > 0);
});

test('at night (report and plan) repairs cost no time, work away from camp and do not move the clock', () => {
  for (const phase of ['report', 'plan']) {
    const s = game(1);
    const g = addGear(s, 'chest', 'iron', 'B', { type: 'ruby', grade: 'S' }, { durability: 80 });
    s.storage.bars['iron:B'] = 1;
    s.storage.cut['ruby:S'] = 1;
    s.phase = phase;
    s.time = DAY_END; // past the end of the work day: a daytime repair would not fit
    standInBlankField(s, 1); // not at camp
    assert.equal(isNight(s), true, phase);
    const plan = repairPlan(s, g, PG);
    assert.equal(plan.ok, true);
    assert.equal(plan.minutes, 0, phase);
    const r = repair(s, g.id, PG);
    assert.equal(r.ok, true, `${phase}: ${r.msg}`);
    assert.equal(r.minutes, 0);
    assert.match(r.msg, /night/);
    assert.equal(s.time, DAY_END, `${phase}: clock unchanged`);
    assert.equal(g.durability, 100);
    // materials are the same as by day: only the time is free
    assert.equal(s.storage.bars['iron:B'], 0.79);
    assert.equal(s.storage.cut['ruby:S'], 0.93);
    // the usual checks still apply at night
    assert.match(repair(s, g.id, PG).msg, /100%/);
    assert.equal(repair(s, 9999, PG).ok, false);
    g.durability = 1;
    s.storage.bars['iron:B'] = 0;
    assert.equal(repair(s, g.id, PG).ok, false, 'short on bars');
    assert.equal(g.durability, 1);
  }
});

test('night repair through the real day flow: gear used in the fight is home again and repairs for free', () => {
  const cfg = cfgWith(WEAK_ENEMIES);
  const s = game(5, cfg);
  const sw = addGear(s, 'sword', 'copper', 'D');
  s.storage.bars['copper:D'] = 5;
  assert.equal(endDay(s, cfg).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [sw.id], ringIds: [] }, cfg).ok, true);
  // day 2: the adventurer has the sword; packed gear is still refused by day
  sw.durability = 90;
  assert.match(repair(s, sw.id, cfg).msg, /adventurer/);
  assert.equal(sw.durability, 90);
  sw.durability = 100;
  assert.equal(endDay(s, cfg).ok, true);
  assert.equal(s.phase, 'report');
  assert.equal(sw.packed, false, 'home again');
  assert.ok(sw.durability < 100, 'the fight wore the sword');
  const t = s.time;
  const cost = repairInfo(sw, cfg).bars['copper:D'];
  const r = repair(s, sw.id, cfg);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, 0);
  assert.equal(s.time, t);
  assert.ok(approx(s.storage.bars['copper:D'], 5 - cost, 1e-9));
  // planning is night too
  assert.equal(acknowledgeReport(s).ok, true);
  sw.durability = 60;
  assert.equal(repair(s, sw.id, cfg).ok, true);
  assert.equal(s.time, t);
  // the next day still starts at the usual time
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }, cfg).ok, true);
  assert.equal(s.time, DAY_START);
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
  assert.deepEqual(plan, { ok: true, reason: null, bars: info.bars, gems: info.gems, substitutes: [], minutes: info.minutes, missing: info.missing });
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
  assert.equal(plan.minutes, repairInfo(g, PG).minutes);
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
  for (const phase of ['work', 'plan']) {
    const { s, g } = subSetup({ 'iron:B': 0.1, 'iron:A': 1, 'iron:S': 1 }, { 'ruby:C': 0, 'ruby:A': 0.5, 'ruby:S': 1 });
    s.phase = phase;
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
        assert.ok(approx(s.storage[store][k] || 0, (before[store][k] || 0) - (used[k] || 0), 1e-9), `${phase} ${store} ${k}`);
      }
    }
    // no benefit: the item keeps its own grades and stats
    assert.equal(g.grade, 'B');
    assert.deepEqual(g.gem, { type: 'ruby', grade: 'C' });
    assert.deepEqual(gearStats(g, PG), stats);
    assert.equal(g.durability, 100);
  }
  // exact grade: no substitutes, no warning
  const { s, g } = subSetup({ 'iron:B': 1, 'iron:S': 1 }, { 'ruby:C': 1 });
  const plan = repairPlan(s, g, PG);
  const r = repair(s, g.id, PG);
  assert.equal(r.ok, true);
  assert.deepEqual(r.substitutes, []);
  assert.equal(substituteWarning(plan), null);
  assert.equal(r.msg, `Repaired ${gearName(g)} to 100% (${plan.minutes}m).`);
  assert.equal(s.storage.bars['iron:S'], 1);
});

test('repairInfo still quotes the exact grade, whatever is in stock', () => {
  const { g } = subSetup({ 'iron:S': 10 }, { 'ruby:S': 10 });
  assert.deepEqual(repairInfo(g, PG), { missing: 20, bars: { 'iron:B': 0.21 }, gems: { 'ruby:C': 0.07 }, minutes: 5.5 });
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
