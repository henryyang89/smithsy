import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS } from '../js/config.js';
import { skillDefs, newSkills, xpToNext, addXp, skillBonus, itemXp } from '../js/core/skills.js';
import { newIntel, gainForPoint, intelChanceFor, intelChance, nextIntelGain, spendIntel } from '../js/core/intel.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { debrisClearMult, searchMinutes, searchEfficiency, returnMinutes, search } from '../js/core/map.js';
import { refineDistribution, cutDistribution, blendCutTable, refineMinutes, cutMinutes, GRADE_ORDER } from '../js/core/processing.js';
import { game, approx, addRing, setSkillLevel, cfgWith, ringVal, fieldAt, standInBlankField, cell, idx } from './helpers.mjs';

// Pinned skill / intel numbers: the hand-computed expectations below hold whatever CONFIG says.
const SK = cfgWith({
  skills: {
    xpBase: 100, maxLevel: 10,
    activity: { returnTravel: { perLevel: 0.5 }, searchEff: { perLevel: 1 }, debris: { perLevel: 2 }, refineTime: { perLevel: 0.5 }, cutTime: { perLevel: 0.5 } },
    perMaterial: { oreGrade: { perLevel: 0.3 }, oreFail: { perLevel: 0.3 }, gemGrade: { perLevel: 10 }, gemFail: { perLevel: 0.3 } },
  },
  rings: { types: { processTime: { values: [5, 6, 7, 8, 10] }, oreGrade: { values: [2, 3, 4, 5, 6] }, gemGrade: { values: [2, 3, 4, 5, 6] } } },
});
const INTEL = cfgWith({
  intel: {
    gainsPerPoint: [10, 9, 8, 7, 6, 5, 4, 3, 2], minGain: 1, maxChance: 100,
    tracks: { oreSight: { base: 10 }, enemySight: { base: 25 }, ringTypeSight: { base: 25 }, ringGradeSight: { base: 25 } },
  },
});

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

test('XP curve: xpBase x (level + 1) per level', () => {
  const { xpBase, maxLevel } = CONFIG.skills;
  for (let L = 0; L < maxLevel; L++) assert.equal(xpToNext(L), xpBase * (L + 1));
  // pinned: 100, 200, 300, ... -> 5,500 XP to level 10
  for (let L = 0; L < 10; L++) assert.equal(xpToNext(L, SK), 100 * (L + 1));
  let total = 0;
  for (let L = 0; L < SK.skills.maxLevel; L++) total += xpToNext(L, SK);
  assert.equal(total, 5500);
});

test('addXp levels up at the right thresholds and carries the remainder', () => {
  const s = game(1);
  assert.equal(addXp(s, 'searchTime', 99, null, SK), 0);
  assert.deepEqual(s.skills.searchTime, { xp: 99, level: 0 });
  assert.equal(addXp(s, 'searchTime', 1, null, SK), 1);
  assert.deepEqual(s.skills.searchTime, { xp: 0, level: 1 });
  assert.equal(addXp(s, 'searchTime', 250, null, SK), 1); // 200 to level 2, 50 left
  assert.deepEqual(s.skills.searchTime, { xp: 50, level: 2 });
  assert.equal(addXp(s, 'searchTime', 250 + 400, null, SK), 2); // 300 + 400 -> level 4
  assert.deepEqual(s.skills.searchTime, { xp: 0, level: 4 });
  // default config: one level = xpBase
  const t = game(1);
  assert.equal(addXp(t, 'searchTime', CONFIG.skills.xpBase - 1), 0);
  assert.equal(addXp(t, 'searchTime', 1), 1);
  assert.deepEqual(t.skills.searchTime, { xp: 0, level: 1 });
});

test('max level: XP stops there, one big gain can go several levels', () => {
  const s = game(1);
  assert.equal(addXp(s, 'debris', 5499, null, SK), 9);
  assert.deepEqual(s.skills.debris, { xp: 999, level: 9 });
  assert.equal(addXp(s, 'debris', 1, null, SK), 1);
  assert.deepEqual(s.skills.debris, { xp: 0, level: 10 });
  assert.equal(addXp(s, 'debris', 100000, null, SK), 0);
  assert.deepEqual(s.skills.debris, { xp: 0, level: 10 });
  assert.equal(addXp(s, 'refineTime', 1e9, null, SK), 10);
  assert.deepEqual(s.skills.refineTime, { xp: 0, level: 10 });
  // default config
  assert.equal(addXp(s, 'cutTime', 1e12), CONFIG.skills.maxLevel);
  assert.deepEqual(s.skills.cutTime, { xp: 0, level: CONFIG.skills.maxLevel });
});

test('addXp ignores unknown skills and non-positive amounts; writes level-up notes', () => {
  const s = game(1);
  assert.equal(addXp(s, 'nope', 500, null, SK), 0);
  assert.equal(addXp(s, 'cutTime', 0, null, SK), 0);
  assert.equal(addXp(s, 'cutTime', -50, null, SK), 0);
  assert.deepEqual(s.skills.cutTime, { xp: 0, level: 0 });
  const notes = [];
  addXp(s, 'oreGrade_steel', 300, notes, SK);
  assert.deepEqual(notes, ['Skill up: Steel bar grade is now level 2.']);
});

test('skillBonus = perLevel x level', () => {
  const s = game(1);
  assert.equal(skillBonus(s, 'returnTravel', SK), 0);
  setSkillLevel(s, 'returnTravel', 4);
  assert.equal(skillBonus(s, 'returnTravel', SK), 2);
  setSkillLevel(s, 'debris', 10);
  assert.equal(skillBonus(s, 'debris', SK), 20);
  setSkillLevel(s, 'oreFail_mythril', 10);
  assert.ok(approx(skillBonus(s, 'oreFail_mythril', SK), 3));
  setSkillLevel(s, 'searchEff', 7);
  assert.equal(skillBonus(s, 'searchEff', SK), 7);
  assert.equal(skillBonus(s, 'unknown', SK), 0);
  // default config
  const A = CONFIG.skills.activity;
  const P = CONFIG.skills.perMaterial;
  assert.ok(approx(skillBonus(s, 'returnTravel'), A.returnTravel.perLevel * 4));
  assert.ok(approx(skillBonus(s, 'debris'), A.debris.perLevel * 10));
  assert.ok(approx(skillBonus(s, 'searchEff'), A.searchEff.perLevel * 7));
  assert.ok(approx(skillBonus(s, 'oreFail_mythril'), P.oreFail.perLevel * 10));
  setSkillLevel(s, 'gemGrade_topaz', 6);
  assert.ok(approx(skillBonus(s, 'gemGrade_topaz'), P.gemGrade.perLevel * 6));
});

test('itemXp: per-material XP from the xpPerItem table', () => {
  const X = CONFIG.skills.xpPerItem;
  for (const m of [...BARS, ...GEMS]) {
    assert.equal(itemXp(m), X[m], m);
    assert.ok(itemXp(m) > 0, `${m} gives XP`);
  }
  assert.equal(itemXp('bronze'), 0, 'unknown material');
  const cfg = cfgWith({ skills: { xpPerItem: { copper: 7, diamond: 99 } } });
  assert.equal(itemXp('copper', cfg), 7);
  assert.equal(itemXp('diamond', cfg), 99);
  // a plain number still works (same XP for everything)
  const flat = cfgWith({ skills: { xpPerItem: 12 } });
  assert.equal(itemXp('mythril', flat), 12);
  assert.equal(itemXp('ruby', flat), 12);
});

test('per-material skill descriptions show that material\'s XP', () => {
  const cfg = cfgWith({ skills: { xpPerItem: { copper: 7, iron: 8, steel: 9, mythril: 10, ruby: 11, topaz: 12, sapphire: 13, emerald: 14, diamond: 15 } } });
  const defs = Object.fromEntries(skillDefs(cfg).map((d) => [d.key, d]));
  assert.equal(defs.oreGrade_mythril.xpFrom, '10 XP per mythril bar refined');
  assert.equal(defs.oreFail_copper.xpFrom, '7 XP per copper bar refined');
  assert.equal(defs.gemGrade_diamond.xpFrom, '15 XP per diamond cut');
  assert.equal(defs.gemFail_ruby.xpFrom, '11 XP per ruby cut');
  for (const d of skillDefs()) if (d.group !== 'activity') assert.match(d.xpFrom, /^\d+(\.\d+)? XP per /, d.key);
});

// ---------------------------------------------------- spec rules (real config) ----
// A level-10 (max level) skill is at least as strong as a C-grade ring of the same kind. Skills with
// no ring: debris clearing at least +100% debris per search, failure skills at least -5 points.
// The gem grade skill is not an upgrade chance any more: at max level it reaches the master cut table.
const MAX = CONFIG.skills.maxLevel;
const allSkillsMax = () => {
  const s = game(1);
  for (const k of Object.keys(s.skills)) setSkillLevel(s, k, MAX);
  return s;
};
const closeTo = (a, b, eps = 1e-9) => GRADE_ORDER.every((g) => approx(a[g], b[g], eps));

test('spec: every max-level skill with a matching smith ring is at least that ring\'s C value', () => {
  const A = CONFIG.skills.activity;
  const P = CONFIG.skills.perMaterial;
  const pairs = [
    ['returnTravel', A.returnTravel.perLevel, 'travelTime'],
    ['searchTime', A.searchTime.perLevel, 'searchTime'],
    ['searchEff', A.searchEff.perLevel, 'searchEff'],
    ['refineTime', A.refineTime.perLevel, 'processTime'],
    ['cutTime', A.cutTime.perLevel, 'processTime'],
    ['oreGrade', P.oreGrade.perLevel, 'oreGrade'],
  ];
  for (const [skill, perLevel, ring] of pairs) {
    assert.equal(CONFIG.rings.types[ring].owner, 'smith', ring);
    assert.ok(perLevel * MAX >= ringVal(ring, 'C') - 1e-9, `${skill} at level ${MAX} = ${perLevel * MAX} < ${ring} C ring ${ringVal(ring, 'C')}`);
  }
});

test('spec: in play, max-level skills give at least what worn C-grade smith rings give', () => {
  const sk = allSkillsMax();
  const rg = game(1);
  for (const type of ['travelTime', 'searchTime', 'searchEff', 'processTime', 'oreGrade', 'gemGrade']) addRing(rg, type, 'C', true);
  const a = smithBonuses(sk);
  const b = smithBonuses(rg);
  const ge = (x, y, what) => assert.ok(x >= y - 1e-9, `${what}: skill ${x} < ring ${y}`);
  ge(a.returnPct, b.travelPct, 'return travel vs travel ring');
  ge(a.searchTimePct, b.searchTimePct, 'search time');
  ge(a.searchEffPct, b.searchEffPct, 'search efficiency');
  ge(a.refineTimePct, b.refineTimePct, 'refine time');
  ge(a.cutTimePct, b.cutTimePct, 'cut time');
  for (const bar of BARS) ge(a.oreUpgrade(bar), b.oreUpgrade(bar), `${bar} bar grade`);
  // gems: the master table (max skills) beats the novice table with a C gem luck ring, grade for grade
  for (const gem of GEMS) {
    const dSk = cutDistribution(sk, gem);
    const dRg = cutDistribution(rg, gem);
    assert.ok(dSk.F <= dRg.F + 1e-9, `${gem} failure`);
    const succ = GRADE_ORDER.filter((g) => g !== 'F');
    for (let i = 1; i < succ.length; i++) {
      const atLeast = (d) => succ.slice(i).reduce((x, g) => x + d[g], 0);
      ge(atLeast(dSk), atLeast(dRg), `${gem} ${succ[i]} or better`);
    }
  }
  // and the actual times / efficiency the player sees
  assert.ok(searchMinutes(sk) <= searchMinutes(rg) + 1e-9);
  assert.ok(searchEfficiency(sk) >= searchEfficiency(rg) - 1e-9);
  for (const bar of BARS) assert.ok(refineMinutes(sk, bar) <= refineMinutes(rg, bar) + 1e-9, bar);
  for (const gem of GEMS) assert.ok(cutMinutes(sk, gem) <= cutMinutes(rg, gem) + 1e-9, gem);
  const far = fieldAt(sk, 2);
  assert.ok(returnMinutes(sk, far, 0) <= returnMinutes(rg, far, 0) + 1e-9, 'walk home');
});

test('spec: debris clearing at max level clears at least twice the debris per search (+100%)', () => {
  const bonus = CONFIG.skills.activity.debris.perLevel * MAX;
  assert.ok(bonus >= 100, `debris skill at level ${MAX}: ${bonus}%`);
  const s = game(1);
  setSkillLevel(s, 'debris', MAX);
  assert.ok(approx(smithBonuses(s).debrisPct, bonus));
  assert.ok(debrisClearMult(s) >= 2 - 1e-9, `x${debrisClearMult(s)}`);
  // in play (real rules, rolls fixed): a cell with two searches' worth of debris clears in one search
  const cfg = cfgWith({ field: { searchRandomness: 0 } });
  for (const [lv, searches] of [[0, 2], [MAX, 1]]) {
    const t = game(2);
    setSkillLevel(t, 'debris', lv);
    const f = standInBlankField(t, 1);
    f.cells[idx(3, 3)] = cell([], { debris: 2 * searchEfficiency(t, cfg) });
    let n = 0;
    while (f.cells[idx(3, 3)].debris > 0 && n < 5) {
      setSkillLevel(t, 'debris', lv);
      assert.equal(search(t, 3, 3, cfg).ok, true);
      n++;
    }
    assert.equal(n, searches, `debris level ${lv}`);
  }
});

test('spec: the gem grade skill at max level reaches the master cut table', () => {
  const P = CONFIG.skills.perMaterial;
  assert.ok(P.gemGrade.perLevel * MAX >= 100 - 1e-9, `gem grade at level ${MAX}: ${P.gemGrade.perLevel * MAX}% of the way`);
  const s = allSkillsMax();
  for (const gem of GEMS) {
    const c = CONFIG.cut[gem];
    const d = cutDistribution(s, gem);
    // grades D..S in the master table's proportions
    const succ = ['D', 'C', 'B', 'A', 'S'];
    const tot = (x) => succ.reduce((a, g) => a + x[g], 0);
    for (const g of succ) assert.ok(approx(d[g] / tot(d), c.master[g] / tot(c.master), 1e-9), `${gem} ${g}`);
    // and the max cutting skill brings failure down to (at least) the master failure
    assert.ok(d.F <= c.master.F + 1e-9, `${gem} failure ${d.F} > master ${c.master.F}`);
    assert.ok(approx(d.F, Math.max(0, c.novice.F - P.gemFail.perLevel * MAX)));
    assert.ok(closeTo(d, blendCutTable(c, 1, P.gemFail.perLevel * MAX)));
  }
  // with today's numbers that is exactly the master table
  for (const gem of GEMS) {
    const c = CONFIG.cut[gem];
    if (Math.abs(c.novice.F - P.gemFail.perLevel * MAX - c.master.F) < 1e-9) assert.ok(closeTo(cutDistribution(s, gem), c.master), gem);
  }
  // level 0 = the novice table
  const n = game(1);
  for (const gem of GEMS) assert.ok(closeTo(cutDistribution(n, gem), CONFIG.cut[gem].novice), gem);
});

test('spec: max-level refining / cutting skills cut the failure chance by at least 5 points', () => {
  const P = CONFIG.skills.perMaterial;
  assert.ok(P.oreFail.perLevel * MAX >= 5 - 1e-9, `oreFail at level ${MAX}: ${P.oreFail.perLevel * MAX}`);
  assert.ok(P.gemFail.perLevel * MAX >= 5 - 1e-9, `gemFail at level ${MAX}: ${P.gemFail.perLevel * MAX}`);
  const s = allSkillsMax();
  const plain = game(1);
  for (const bar of BARS) {
    const base = refineDistribution(plain, bar).F;
    assert.ok(refineDistribution(s, bar).F <= Math.max(0, base - 5) + 1e-9, bar);
  }
  for (const gem of GEMS) {
    const base = cutDistribution(plain, gem).F;
    assert.ok(cutDistribution(s, gem).F <= Math.max(0, base - 5) + 1e-9, gem);
  }
});

test('smithBonuses combines rings, skills and intel', () => {
  const s = game(1);
  addRing(s, 'processTime', 'B', true); // 7
  setSkillLevel(s, 'refineTime', 2); // 1
  setSkillLevel(s, 'cutTime', 4); // 2
  addRing(s, 'oreGrade', 'A', true); // 5
  setSkillLevel(s, 'oreGrade_copper', 5); // 1.5
  setSkillLevel(s, 'gemFail_diamond', 3); // 0.9
  setSkillLevel(s, 'gemGrade_topaz', 4); // 40% of the way to the master table
  setSkillLevel(s, 'debris', 3); // +6% debris per search
  addRing(s, 'gemGrade', 'C', true); // 3
  const b = smithBonuses(s, SK);
  assert.equal(b.gemBlend('topaz'), 40);
  assert.equal(b.gemBlend('ruby'), 0);
  assert.equal(b.gemUpgrade('topaz'), 3, 'gem upgrade luck is rings only');
  assert.equal(b.gemUpgrade('ruby'), 3);
  assert.equal(b.debrisPct, 6);
  assert.equal(b.refineTimePct, 8);
  assert.equal(b.cutTimePct, 9);
  assert.equal(b.oreUpgrade('copper'), 6.5);
  assert.equal(b.oreUpgrade('iron'), 5);
  assert.ok(approx(b.gemFailRed('diamond'), 0.9));
  assert.equal(b.gemFailRed('ruby'), 0);
  assert.equal(b.revealPct, SK.intel.tracks.oreSight.base);
  assert.equal(b.travelPct, 0);
  // default config: same sums
  const A = CONFIG.skills.activity;
  const P = CONFIG.skills.perMaterial;
  const d = smithBonuses(s);
  assert.ok(approx(d.refineTimePct, ringVal('processTime', 'B') + A.refineTime.perLevel * 2));
  assert.ok(approx(d.cutTimePct, ringVal('processTime', 'B') + A.cutTime.perLevel * 4));
  assert.ok(approx(d.oreUpgrade('copper'), ringVal('oreGrade', 'A') + P.oreGrade.perLevel * 5));
  assert.ok(approx(d.oreUpgrade('iron'), ringVal('oreGrade', 'A')));
  assert.ok(approx(d.gemFailRed('diamond'), P.gemFail.perLevel * 3));
  assert.ok(approx(d.gemBlend('topaz'), P.gemGrade.perLevel * 4));
  assert.ok(approx(d.gemUpgrade('topaz'), ringVal('gemGrade', 'C')));
  assert.ok(approx(d.debrisPct, CONFIG.skills.activity.debris.perLevel * 3));
  assert.equal(d.revealPct, CONFIG.intel.tracks.oreSight.base);
});

// ----------------------------------------------------------------- intel ----
test('newIntel: no points, nothing spent on any track', () => {
  const i = newIntel();
  assert.equal(i.points, 0);
  assert.deepEqual(Object.keys(i.spent).sort(), Object.keys(CONFIG.intel.tracks).sort());
  for (const v of Object.values(i.spent)) assert.equal(v, 0);
});

test('intel gains: +10, +9, +8, ... +2, then +1 per point', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => gainForPoint(n, INTEL)), [10, 9, 8, 7, 6, 5, 4, 3, 2]);
  for (let n = 10; n < 60; n++) assert.equal(gainForPoint(n, INTEL), 1);
  // default config: the table, then minGain; gains never increase
  const { gainsPerPoint, minGain } = CONFIG.intel;
  gainsPerPoint.forEach((g, i) => assert.equal(gainForPoint(i + 1), g));
  assert.equal(gainForPoint(gainsPerPoint.length + 1), minGain);
  for (let n = 2; n < 40; n++) assert.ok(gainForPoint(n) <= gainForPoint(n - 1), 'diminishing returns');
});

test('intel chance: base + cumulative gains, capped at maxChance', () => {
  assert.equal(intelChanceFor('enemySight', 0, INTEL), 25);
  assert.equal(intelChanceFor('enemySight', 1, INTEL), 35);
  assert.equal(intelChanceFor('enemySight', 2, INTEL), 44);
  assert.equal(intelChanceFor('enemySight', 9, INTEL), 25 + 54);
  assert.equal(intelChanceFor('enemySight', 10, INTEL), 80);
  assert.equal(intelChanceFor('enemySight', 30, INTEL), 100);
  assert.equal(intelChanceFor('enemySight', 31, INTEL), 100);
  assert.equal(intelChanceFor('enemySight', 500, INTEL), 100);
  assert.equal(intelChanceFor('oreSight', 9, INTEL), 64);
  assert.equal(intelChanceFor('oreSight', 45, INTEL), 100);
  assert.equal(intelChanceFor('oreSight', 44, INTEL), 99);
  assert.equal(intelChanceFor('oreSight', 45, cfgWith(INTEL, { intel: { maxChance: 90 } })), 90);
  // default config: every track starts at its base and ends at maxChance
  for (const [k, t] of Object.entries(CONFIG.intel.tracks)) {
    assert.equal(intelChanceFor(k, 0), Math.min(CONFIG.intel.maxChance, t.base));
    assert.equal(intelChanceFor(k, 1000), CONFIG.intel.maxChance);
  }
});

test('spendIntel uses a point, raises the track, and stops at the maximum', () => {
  const s = game(1);
  assert.equal(spendIntel(s, 'enemySight', INTEL).ok, false, 'no points');
  assert.equal(spendIntel(s, 'bogus', INTEL).ok, false, 'unknown track');
  s.intel.points = 3;
  assert.equal(nextIntelGain(s, 'enemySight', INTEL), 10);
  const r = spendIntel(s, 'enemySight', INTEL);
  assert.equal(r.ok, true);
  assert.match(r.msg, /35%/);
  assert.equal(s.intel.points, 2);
  assert.equal(s.intel.spent.enemySight, 1);
  assert.equal(intelChance(s, 'enemySight', INTEL), 35);
  assert.equal(nextIntelGain(s, 'enemySight', INTEL), 9);
  assert.equal(nextIntelGain(s, 'ringTypeSight', INTEL), 10, 'tracks are independent');
  // at the cap
  s.intel.spent.ringGradeSight = 30;
  assert.equal(intelChance(s, 'ringGradeSight', INTEL), 100);
  assert.equal(nextIntelGain(s, 'ringGradeSight', INTEL), 0);
  const capped = spendIntel(s, 'ringGradeSight', INTEL);
  assert.equal(capped.ok, false);
  assert.match(capped.msg, /maximum/);
  assert.equal(s.intel.points, 2, 'point not consumed at the cap');
  // the last point before the cap only adds what is left
  s.intel.spent.ringTypeSight = 29; // 99%
  assert.equal(nextIntelGain(s, 'ringTypeSight', INTEL), 1);
});
