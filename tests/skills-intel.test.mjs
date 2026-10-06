import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS } from '../js/config.js';
import { skillDefs, newSkills, xpToNext, addXp, skillBonus } from '../js/core/skills.js';
import { newIntel, gainForPoint, intelChanceFor, intelChance, nextIntelGain, spendIntel } from '../js/core/intel.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { game, approx, addRing, setSkillLevel } from './helpers.mjs';

// ---------------------------------------------------------------- skills ----
test('skill list: 6 activity skills + grade/fail per bar and per gem', () => {
  const defs = skillDefs();
  assert.equal(defs.length, 6 + 2 * BARS.length + 2 * GEMS.length);
  const keys = defs.map((d) => d.key);
  assert.equal(new Set(keys).size, keys.length);
  for (const b of BARS) assert.ok(keys.includes(`oreGrade_${b}`) && keys.includes(`oreFail_${b}`));
  for (const g of GEMS) assert.ok(keys.includes(`gemGrade_${g}`) && keys.includes(`gemFail_${g}`));
  const s = newSkills();
  assert.deepEqual(Object.keys(s).sort(), [...keys].sort());
  for (const v of Object.values(s)) assert.deepEqual(v, { xp: 0, level: 0 });
});

test('XP curve: 100, 200, 300, ... per level (5,500 XP to level 10)', () => {
  for (let L = 0; L < 10; L++) assert.equal(xpToNext(L), 100 * (L + 1));
  let total = 0;
  for (let L = 0; L < CONFIG.skills.maxLevel; L++) total += xpToNext(L);
  assert.equal(total, 5500);
});

test('addXp levels up at the right thresholds and carries the remainder', () => {
  const s = game(1);
  assert.equal(addXp(s, 'searchTime', 99), 0);
  assert.deepEqual(s.skills.searchTime, { xp: 99, level: 0 });
  assert.equal(addXp(s, 'searchTime', 1), 1);
  assert.deepEqual(s.skills.searchTime, { xp: 0, level: 1 });
  assert.equal(addXp(s, 'searchTime', 250), 1); // 200 to level 2, 50 left
  assert.deepEqual(s.skills.searchTime, { xp: 50, level: 2 });
  assert.equal(addXp(s, 'searchTime', 250 + 400), 2); // 300 + 400 -> level 4
  assert.deepEqual(s.skills.searchTime, { xp: 0, level: 4 });
});

test('max level 10: XP stops there, one big gain can go several levels', () => {
  const s = game(1);
  assert.equal(addXp(s, 'debris', 5499), 9);
  assert.deepEqual(s.skills.debris, { xp: 999, level: 9 });
  assert.equal(addXp(s, 'debris', 1), 1);
  assert.deepEqual(s.skills.debris, { xp: 0, level: 10 });
  assert.equal(addXp(s, 'debris', 100000), 0);
  assert.deepEqual(s.skills.debris, { xp: 0, level: 10 });
  assert.equal(addXp(s, 'refineTime', 1e9), 10);
  assert.deepEqual(s.skills.refineTime, { xp: 0, level: 10 });
});

test('addXp ignores unknown skills and non-positive amounts; writes level-up notes', () => {
  const s = game(1);
  assert.equal(addXp(s, 'nope', 500), 0);
  assert.equal(addXp(s, 'cutTime', 0), 0);
  assert.equal(addXp(s, 'cutTime', -50), 0);
  assert.deepEqual(s.skills.cutTime, { xp: 0, level: 0 });
  const notes = [];
  addXp(s, 'oreGrade_steel', 300, notes);
  assert.deepEqual(notes, ['Skill up: Steel bar grade is now level 2.']);
});

test('skillBonus = perLevel x level', () => {
  const s = game(1);
  assert.equal(skillBonus(s, 'returnTravel'), 0);
  setSkillLevel(s, 'returnTravel', 4);
  assert.equal(skillBonus(s, 'returnTravel'), 2);
  setSkillLevel(s, 'debris', 10);
  assert.equal(skillBonus(s, 'debris'), 20);
  setSkillLevel(s, 'oreFail_mythril', 10);
  assert.ok(approx(skillBonus(s, 'oreFail_mythril'), 3));
  setSkillLevel(s, 'searchEff', 7);
  assert.equal(skillBonus(s, 'searchEff'), 7);
  assert.equal(skillBonus(s, 'unknown'), 0);
});

test('skill bonuses are smaller than the matching best ring', () => {
  const R = CONFIG.rings.types;
  const A = CONFIG.skills.activity;
  const max = CONFIG.skills.maxLevel;
  assert.ok(A.searchTime.perLevel * max <= R.searchTime.values[4]);
  assert.ok(A.searchEff.perLevel * max <= R.searchEff.values[4]);
  assert.ok(A.refineTime.perLevel * max <= R.processTime.values[4]);
  assert.ok(CONFIG.skills.perMaterial.oreGrade.perLevel * max <= R.oreGrade.values[4]);
});

test('smithBonuses combines rings, skills and intel', () => {
  const s = game(1);
  addRing(s, 'processTime', 'B', true); // 7
  setSkillLevel(s, 'refineTime', 2); // 1
  setSkillLevel(s, 'cutTime', 4); // 2
  addRing(s, 'oreGrade', 'A', true); // 5
  setSkillLevel(s, 'oreGrade_copper', 5); // 1.5
  setSkillLevel(s, 'gemFail_diamond', 3); // 0.9
  const b = smithBonuses(s);
  assert.equal(b.refineTimePct, 8);
  assert.equal(b.cutTimePct, 9);
  assert.equal(b.oreUpgrade('copper'), 6.5);
  assert.equal(b.oreUpgrade('iron'), 5);
  assert.ok(approx(b.gemFailRed('diamond'), 0.9));
  assert.equal(b.gemFailRed('ruby'), 0);
  assert.equal(b.revealPct, CONFIG.intel.tracks.oreSight.base);
  assert.equal(b.travelPct, 0);
});

// ----------------------------------------------------------------- intel ----
test('newIntel: no points, nothing spent on any track', () => {
  const i = newIntel();
  assert.equal(i.points, 0);
  assert.deepEqual(Object.keys(i.spent).sort(), Object.keys(CONFIG.intel.tracks).sort());
  for (const v of Object.values(i.spent)) assert.equal(v, 0);
});

test('intel gains: +10, +9, +8, ... +2, then +1 per point', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => gainForPoint(n)), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  for (let n = 10; n < 60; n++) assert.equal(gainForPoint(n), 1);
});

test('intel chance: base + cumulative gains, capped at 100', () => {
  assert.equal(intelChanceFor('enemySight', 0), 25);
  assert.equal(intelChanceFor('enemySight', 1), 35);
  assert.equal(intelChanceFor('enemySight', 2), 44);
  assert.equal(intelChanceFor('enemySight', 9), 25 + 54);
  assert.equal(intelChanceFor('enemySight', 10), 80);
  assert.equal(intelChanceFor('enemySight', 30), 100);
  assert.equal(intelChanceFor('enemySight', 31), 100);
  assert.equal(intelChanceFor('enemySight', 500), 100);
  assert.equal(intelChanceFor('oreSight', 9), 64);
  assert.equal(intelChanceFor('oreSight', 45), 100);
  assert.equal(intelChanceFor('oreSight', 44), 99);
});

test('spendIntel uses a point, raises the track, and stops at the maximum', () => {
  const s = game(1);
  assert.equal(spendIntel(s, 'enemySight').ok, false, 'no points');
  assert.equal(spendIntel(s, 'bogus').ok, false, 'unknown track');
  s.intel.points = 3;
  assert.equal(nextIntelGain(s, 'enemySight'), 10);
  const r = spendIntel(s, 'enemySight');
  assert.equal(r.ok, true);
  assert.match(r.msg, /35%/);
  assert.equal(s.intel.points, 2);
  assert.equal(s.intel.spent.enemySight, 1);
  assert.equal(intelChance(s, 'enemySight'), 35);
  assert.equal(nextIntelGain(s, 'enemySight'), 9);
  assert.equal(nextIntelGain(s, 'ringTypeSight'), 10, 'tracks are independent');
  // at the cap
  s.intel.spent.ringGradeSight = 30;
  assert.equal(intelChance(s, 'ringGradeSight'), 100);
  assert.equal(nextIntelGain(s, 'ringGradeSight'), 0);
  const capped = spendIntel(s, 'ringGradeSight');
  assert.equal(capped.ok, false);
  assert.match(capped.msg, /maximum/);
  assert.equal(s.intel.points, 2, 'point not consumed at the cap');
  // the last point before the cap only adds what is left
  s.intel.spent.ringTypeSight = 29; // 99%
  assert.equal(nextIntelGain(s, 'ringTypeSight'), 1);
});
