import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS } from '../js/config.js';
import { skillDefs, newSkills, xpToNext, addXp, skillBonus, itemXp } from '../js/core/skills.js';
import { newIntel, gainForPoint, intelValueFor, intelValue, nextIntelGain, spendIntel, trackValueText, canSpendIntel } from '../js/core/intel.js';
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
// Every track gets the same pinned steps (10, 9, 8, ... 2, then 1 for every later point), max 100.
const STEPS = { gains: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], max: 100 };
const INTEL = cfgWith({
  intel: {
    tracks: {
      oreSight: { base: 10, ...STEPS }, enemySight: { base: 25, ...STEPS }, ringTypeSight: { base: 25, ...STEPS }, ringGradeSight: { base: 25, ...STEPS },
      groupSight: { base: 20, ...STEPS }, simDepth: { base: 0, ...STEPS },
    },
  },
});

// ---------------------------------------------------------------- skills ----
test('skill list: 7 activity skills (incl. Gear care) + grade/fail per bar and per gem', () => {
  const defs = skillDefs();
  assert.equal(defs.length, 7 + 2 * BARS.length + 2 * GEMS.length);
  const keys = defs.map((d) => d.key);
  assert.equal(defs.filter((d) => d.group === 'activity').length, 7);
  assert.ok(keys.includes('gearCare'));
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
  assert.equal('revealPct' in b, false, 'no ore sight chance any more');
  assert.equal(b.sight, SK.intel.tracks.oreSight.base, 'sight = Ore sight intel (base) + Ore sight rings (none worn)');
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
  assert.equal(d.sight, CONFIG.intel.tracks.oreSight.base);
});

test('smithBonuses.sight = Ore sight intel + Ore sight rings', () => {
  const s = game(1);
  assert.equal(smithBonuses(s).sight, 0, 'a new game has no sight');
  s.intel.spent.oreSight = 2;
  assert.equal(smithBonuses(s, INTEL).sight, intelValueFor('oreSight', 2, INTEL));
  assert.equal(smithBonuses(s, INTEL).sight, 10 + 10 + 9);
  addRing(s, 'reveal', 'C', true);
  assert.equal(smithBonuses(s, INTEL).sight, 10 + 10 + 9 + ringVal('reveal', 'C', INTEL));
  assert.equal(smithBonuses(s).sight, intelValue(s, 'oreSight') + ringVal('reveal', 'C'));
});

test('smithBonuses.gearCarePct = Gear care perLevel x level; rings and intel do not change it', () => {
  const s = game(1);
  assert.equal(smithBonuses(s).gearCarePct, 0);
  const per = CONFIG.skills.activity.gearCare.perLevel;
  setSkillLevel(s, 'gearCare', 3);
  addRing(s, 'processTime', 'S', true);
  addRing(s, 'searchTime', 'S', true);
  s.intel.spent.enemySight = 5;
  assert.ok(approx(smithBonuses(s).gearCarePct, 3 * per));
  setSkillLevel(s, 'gearCare', CONFIG.skills.maxLevel);
  assert.ok(approx(smithBonuses(s).gearCarePct, CONFIG.skills.maxLevel * per));
  // pinned: 2% per level
  const two = cfgWith({ skills: { activity: { gearCare: { perLevel: 2 } } } });
  assert.equal(smithBonuses(s, two).gearCarePct, 2 * CONFIG.skills.maxLevel);
  // a save without the skill (not yet repaired by deserialize) reads as 0
  delete s.skills.gearCare;
  assert.equal(smithBonuses(s).gearCarePct, 0);
});

// ----------------------------------------------------------------- intel ----
const TRACKS = ['oreSight', 'enemySight', 'ringTypeSight', 'ringGradeSight', 'groupSight', 'simDepth'];

test('config: six intel tracks, each with a unit, base, gains list, max and description', () => {
  assert.deepEqual(Object.keys(CONFIG.intel.tracks), TRACKS);
  for (const [k, t] of Object.entries(CONFIG.intel.tracks)) {
    assert.ok(t.name && t.desc, k);
    assert.ok(['%', 'sight', 'count'].includes(t.unit), `${k}: unit ${t.unit}`);
    assert.ok(Array.isArray(t.gains) && t.gains.length >= 1, `${k}: gains list`);
    assert.ok(t.base >= 0 && t.max > t.base, `${k}: base < max`);
  }
  assert.equal(CONFIG.intel.tracks.oreSight.unit, 'sight');
  assert.equal(CONFIG.intel.tracks.simDepth.unit, 'count');
  for (const k of ['enemySight', 'ringTypeSight', 'ringGradeSight', 'groupSight']) assert.equal(CONFIG.intel.tracks[k].unit, '%', k);
});

test('Battle simulation (simDepth) intel track: a count of extra guesses / test fights that grows like the other tracks', () => {
  const t = CONFIG.intel.tracks.simDepth;
  assert.ok(t && t.name && t.desc);
  assert.ok(t.base >= 0);
  assert.equal(newIntel().spent.simDepth, 0);
  assert.equal(intelValueFor('simDepth', 0), Math.min(t.max, t.base));
  // pinned: base 0 + the steps 10, 9, 8, ... (then 1 each), capped at the track's max
  const P = cfgWith(INTEL, { intel: { tracks: { simDepth: { base: 0, max: 100 } } } });
  assert.deepEqual([0, 1, 2, 3, 10].map((n) => intelValueFor('simDepth', n, P)), [0, 10, 19, 27, 10 + 9 + 8 + 7 + 6 + 5 + 4 + 3 + 2 + 1]);
  assert.equal(intelValueFor('simDepth', 1000, P), P.intel.tracks.simDepth.max);
  const s = game(1);
  s.intel.points = 2;
  assert.equal(spendIntel(s, 'simDepth', P).ok, true);
  assert.equal(intelValue(s, 'simDepth', P), 10);
  assert.equal(nextIntelGain(s, 'simDepth', P), 9);
  assert.equal(s.intel.points, 1);
  assert.equal(intelValue(s, 'enemySight', P), P.intel.tracks.enemySight.base, 'other tracks unchanged');
});

test('newIntel: no points, nothing spent on any track', () => {
  const i = newIntel();
  assert.equal(i.points, 0);
  assert.deepEqual(Object.keys(i.spent).sort(), [...TRACKS].sort());
  for (const v of Object.values(i.spent)) assert.equal(v, 0);
});

test('gainForPoint follows each track\'s list, then repeats the last value', () => {
  assert.deepEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => gainForPoint('enemySight', n, INTEL)), [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  for (let n = 11; n < 60; n++) assert.equal(gainForPoint('enemySight', n, INTEL), 1, 'the last value repeats');
  // every track of the default config: its own list, then the last value forever
  for (const [k, t] of Object.entries(CONFIG.intel.tracks)) {
    t.gains.forEach((g, i) => assert.equal(gainForPoint(k, i + 1), g, `${k} point ${i + 1}`));
    for (let n = t.gains.length + 1; n < t.gains.length + 10; n++) assert.equal(gainForPoint(k, n), t.gains[t.gains.length - 1], `${k} point ${n}`);
  }
  // tracks have different lists (R44: the gain per point varies by track)
  const lists = new Set(Object.values(CONFIG.intel.tracks).map((t) => JSON.stringify(t.gains)));
  assert.ok(lists.size >= 4, 'tracks do not all share one list');
  // a one-entry list repeats from the first point
  const flat = cfgWith(INTEL, { intel: { tracks: { groupSight: { gains: [7] } } } });
  assert.deepEqual([1, 2, 50].map((n) => gainForPoint('groupSight', n, flat)), [7, 7, 7]);
});

test('every default gains list is positive and never increases (diminishing returns, in steps)', () => {
  for (const [k, t] of Object.entries(CONFIG.intel.tracks)) {
    assert.ok(t.gains.every((g) => g > 0), `${k}: every gain is above 0`);
    for (let i = 1; i < t.gains.length; i++) assert.ok(t.gains[i] <= t.gains[i - 1], `${k}: gain ${i + 1} is not above gain ${i}`);
    for (let n = 2; n < t.gains.length + 5; n++) assert.ok(gainForPoint(k, n) <= gainForPoint(k, n - 1), `${k} point ${n}`);
  }
  // "in steps": the scouting tracks repeat each value for three points (3 points per step), only simDepth is flat
  for (const k of ['enemySight', 'ringTypeSight', 'ringGradeSight', 'groupSight', 'oreSight']) {
    const g = CONFIG.intel.tracks[k].gains;
    assert.equal(g[0], g[1], `${k}: first step lasts at least 2 points`);
    assert.equal(g[0], g[2], `${k}: first step lasts 3 points`);
    assert.ok(g[3] < g[0], `${k}: then it drops`);
  }
});

test('intelValueFor: base + cumulative gains of the points spent, capped at the track\'s max', () => {
  assert.equal(intelValueFor('enemySight', 0, INTEL), 25);
  assert.equal(intelValueFor('enemySight', 1, INTEL), 35);
  assert.equal(intelValueFor('enemySight', 2, INTEL), 44);
  assert.equal(intelValueFor('enemySight', 9, INTEL), 25 + 54);
  assert.equal(intelValueFor('enemySight', 10, INTEL), 80);
  assert.equal(intelValueFor('enemySight', 30, INTEL), 100);
  assert.equal(intelValueFor('enemySight', 31, INTEL), 100);
  assert.equal(intelValueFor('enemySight', 500, INTEL), 100);
  assert.equal(intelValueFor('oreSight', 9, INTEL), 64);
  assert.equal(intelValueFor('oreSight', 45, INTEL), 100);
  assert.equal(intelValueFor('oreSight', 44, INTEL), 99);
  // the cap is the track's own max
  assert.equal(intelValueFor('oreSight', 45, cfgWith(INTEL, { intel: { tracks: { oreSight: { max: 90 } } } })), 90);
  assert.equal(intelValueFor('enemySight', 45, cfgWith(INTEL, { intel: { tracks: { oreSight: { max: 90 } } } })), 100, 'other tracks keep theirs');
  // a base above the max is cut down to it
  assert.equal(intelValueFor('groupSight', 0, cfgWith(INTEL, { intel: { tracks: { groupSight: { base: 50, max: 40 } } } })), 40);
  // default config: every track starts at its base and ends at its max
  for (const [k, t] of Object.entries(CONFIG.intel.tracks)) {
    assert.equal(intelValueFor(k, 0), Math.min(t.max, t.base));
    assert.equal(intelValueFor(k, 1000), t.max);
  }
  // a stepped list (three points per step), pinned here: 10, 10, 10, 8, 8, 8, 6, 6, 6, then 4 for every later point
  const stepped = cfgWith({ intel: { tracks: { oreSight: { base: 0, gains: [10, 10, 10, 8, 8, 8, 6, 6, 6, 4], max: 100 } } } });
  assert.deepEqual([0, 1, 3, 4, 6, 7, 9, 10, 11].map((n) => intelValueFor('oreSight', n, stepped)), [0, 10, 30, 38, 54, 60, 72, 76, 80]);
  assert.equal(intelValueFor('oreSight', 1000, stepped), 100);
});

test('intelValue reads the points spent on the track from the game', () => {
  const s = game(1);
  assert.equal(intelValue(s, 'enemySight', INTEL), 25);
  s.intel.spent.enemySight = 2;
  assert.equal(intelValue(s, 'enemySight', INTEL), 44);
  delete s.intel.spent.enemySight;
  assert.equal(intelValue(s, 'enemySight', INTEL), 25, 'a track with no entry counts as nothing spent');
});

test('trackValueText writes a value in the track\'s unit: % for a chance, sight, +N for a count', () => {
  assert.equal(trackValueText('enemySight', 25), '25%');
  assert.equal(trackValueText('groupSight', 30), '30%');
  assert.equal(trackValueText('oreSight', 20), '20 sight');
  assert.equal(trackValueText('oreSight', 0), '0 sight');
  assert.equal(trackValueText('simDepth', 3), '+3');
  assert.equal(trackValueText('simDepth', 0), '+0');
  const odd = cfgWith({ intel: { tracks: { enemySight: { unit: 'sight' } } } });
  assert.equal(trackValueText('enemySight', 7, odd), '7 sight', 'the unit comes from the config');
});

test('spendIntel uses a point, raises the track, says the new value in the track\'s unit, and stops at the maximum', () => {
  const s = game(1);
  assert.equal(spendIntel(s, 'enemySight', INTEL).ok, false, 'no points');
  assert.equal(spendIntel(s, 'bogus', INTEL).ok, false, 'unknown track');
  s.intel.points = 5;
  assert.equal(nextIntelGain(s, 'enemySight', INTEL), 10);
  const r = spendIntel(s, 'enemySight', INTEL);
  assert.equal(r.ok, true);
  assert.equal(r.msg, 'Enemy scouting is now 35%.');
  assert.equal(s.intel.points, 4);
  assert.equal(s.intel.spent.enemySight, 1);
  assert.equal(intelValue(s, 'enemySight', INTEL), 35);
  assert.equal(nextIntelGain(s, 'enemySight', INTEL), 9);
  assert.equal(nextIntelGain(s, 'ringTypeSight', INTEL), 10, 'tracks are independent');
  // messages per unit
  assert.equal(spendIntel(s, 'oreSight', INTEL).msg, 'Ore sight is now 20 sight.');
  assert.equal(spendIntel(s, 'simDepth', INTEL).msg, 'Battle simulation is now +10.');
  assert.equal(spendIntel(s, 'groupSight', INTEL).msg, 'Banner scouting is now 30%.');
  assert.equal(s.intel.points, 1);
  // at the max
  s.intel.spent.ringGradeSight = 30;
  assert.equal(intelValue(s, 'ringGradeSight', INTEL), 100);
  assert.equal(nextIntelGain(s, 'ringGradeSight', INTEL), 0);
  const capped = spendIntel(s, 'ringGradeSight', INTEL);
  assert.equal(capped.ok, false);
  assert.match(capped.msg, /maximum/);
  assert.equal(s.intel.points, 1, 'point not consumed at the max');
  // the last point before the max only adds what is left
  s.intel.spent.ringTypeSight = 29; // 99%
  assert.equal(nextIntelGain(s, 'ringTypeSight', INTEL), 1);
});

test('spendIntel refuses at the default config\'s max too (Battle simulation: +1 per point up to its max)', () => {
  const t = CONFIG.intel.tracks.simDepth;
  const s = game(1);
  s.intel.points = t.max + 3;
  for (let i = 1; i <= t.max; i++) {
    assert.equal(spendIntel(s, 'simDepth').ok, true, `point ${i}`);
    assert.equal(intelValue(s, 'simDepth'), Math.min(t.max, t.base + i * t.gains[0]));
  }
  const r = spendIntel(s, 'simDepth');
  assert.equal(r.ok, false);
  assert.match(r.msg, /maximum/);
  assert.equal(s.intel.points, 3);
});

test('canSpendIntel: a point and a track that can still gain', () => {
  const s = game(1);
  assert.equal(canSpendIntel(s), false, 'no points');
  s.intel.points = 1;
  assert.equal(canSpendIntel(s), true);
  // every track maxed: nothing to spend a point on
  for (const k of TRACKS) s.intel.spent[k] = 1000;
  assert.equal(canSpendIntel(s), false);
  // one track below its max is enough
  s.intel.spent.groupSight = 0;
  assert.equal(canSpendIntel(s), true);
  s.intel.points = 0;
  assert.equal(canSpendIntel(s), false);
});
