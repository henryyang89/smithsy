import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS, GRADES } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  adjustDistribution, refineDistribution, cutDistribution, blendCutTable, refineMinutes, cutMinutes, rollGrade, refine, cut,
  canRefine, repeat, GRADE_ORDER,
} from '../js/core/processing.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { itemXp, xpToNext } from '../js/core/skills.js';
import { round1 } from '../js/core/util.js';
import { game, cfgWith, approx, addRing, setSkillLevel, standInBlankField, ringVal, xpSpent, DAY_END, DAY_START } from './helpers.mjs';

const sum = (d) => GRADE_ORDER.reduce((a, g) => a + d[g], 0);
const closeDist = (a, b, eps = 1e-9) => GRADE_ORDER.every((g) => approx(a[g], b[g], eps));
// A fixed grade table for the pure adjustDistribution tests.
const BASE = { S: 5, A: 10, B: 20, C: 25, D: 30, F: 10 };
// Pinned processing numbers: the hand-computed minutes / XP below hold whatever CONFIG says.
// Per-material XP differs for every material so the tests can tell them apart.
const XP = { copper: 10, iron: 11, steel: 12, mythril: 40, ruby: 13, topaz: 14, sapphire: 15, emerald: 16, diamond: 17 };
const PIN = {
  refine: { copper: { minutes: 10 }, iron: { minutes: 12 }, steel: { minutes: 15 }, mythril: { minutes: 20 } },
  cut: Object.fromEntries(GEMS.map((g) => [g, { minutes: 15 }])),
  processing: { maxTimeReduction: 75 },
  rings: { types: { processTime: { values: [5, 6, 7, 8, 10] }, oreGrade: { values: [2, 3, 4, 5, 6] }, gemGrade: { values: [2, 3, 4, 5, 6] } } },
  skills: {
    xpBase: 100, maxLevel: 10, xpPerItem: XP,
    activity: { refineTime: { effects: { refineTime: 0.5, refineFail: 0.1 } }, cutTime: { effects: { cutTime: 0.5, cutBlend: 1 } } },
    perMaterial: { oreGrade: { effects: { refineUpgrade: 0.3 } }, oreFail: { effects: { refineFail: 0.3 } }, gemGrade: { effects: { cutBlend: 10 } }, gemFail: { effects: { cutFail: 0.5 } } },
  },
};
const CFG = cfgWith(PIN);
// CFG, plus every refine / cut lands on `grade` (gems: novice and master tables both forced).
const forced = (grade) => {
  const dist = { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0, [grade]: 100 };
  const refineCfg = Object.fromEntries(BARS.map((b) => [b, { dist }]));
  const cutCfg = Object.fromEntries(GEMS.map((g) => [g, { novice: dist, master: dist }]));
  return cfgWith(PIN, { refine: refineCfg, cut: cutCfg });
};
// A pinned gem table pair with equal failure, so blends are easy to hand-compute.
const TABLE = {
  novice: { F: 10, D: 50, C: 30, B: 10, A: 0, S: 0 },
  master: { F: 10, D: 10, C: 20, B: 30, A: 20, S: 10 },
};
const SUCCESS = ['D', 'C', 'B', 'A', 'S'];
// Average grade index of the successful outcomes (D = 0 .. S = 4), weighted by chance.
const meanGrade = (d) => SUCCESS.reduce((a, g, i) => a + d[g] * i, 0) / SUCCESS.reduce((a, g) => a + d[g], 0);

// --------------------------------------------------------- distributions ----
test('config grade tables each sum to 100 (bars, and the gem novice / master tables)', () => {
  for (const b of BARS) assert.equal(sum(CONFIG.refine[b].dist), 100, b);
  for (const g of GEMS) {
    assert.equal(sum(CONFIG.cut[g].novice), 100, `${g} novice`);
    assert.equal(sum(CONFIG.cut[g].master), 100, `${g} master`);
    assert.equal(CONFIG.cut[g].dist, undefined, `${g}: the old single table is gone`);
  }
});

test('GRADE_ORDER lists outcomes from lowest to highest: F, then the grades D..S', () => {
  assert.deepEqual(GRADE_ORDER, ['F', ...GRADES]);
  assert.deepEqual(GRADE_ORDER, ['F', 'D', 'C', 'B', 'A', 'S']);
  // gear multipliers confirm GRADES runs from worst to best
  for (let i = 1; i < GRADES.length; i++) assert.ok(CONFIG.gear.gradeMult[GRADES[i]] > CONFIG.gear.gradeMult[GRADES[i - 1]]);
});

test('repeat summarizes grades from lowest to highest', () => {
  const s = game(1);
  const script = ['S', 'D', 'F', 'B', 'S', 'C', 'A', 'D'];
  let i = 0;
  const r = repeat(s, () => (i < script.length ? { ok: true, grade: script[i++], minutes: 1, notes: [] } : { ok: false, msg: 'done' }));
  assert.equal(r.ok, true);
  assert.match(r.msg, /: Fx1 Dx2 Cx1 Bx1 Ax1 Sx2$/);
});

test('adjustDistribution always sums to 100 and never goes negative', () => {
  const rng = seededRng(1);
  const bases = [...BARS.map((b) => CONFIG.refine[b].dist), ...GEMS.flatMap((g) => [CONFIG.cut[g].novice, CONFIG.cut[g].master])];
  for (const base of bases) {
    for (let i = 0; i < 300; i++) {
      const failRed = rng.float(-5, 30);
      const up = rng.float(-10, 120);
      const d = adjustDistribution(base, failRed, up);
      assert.ok(approx(sum(d), 100, 1e-9), `sum ${sum(d)}`);
      for (const g of GRADE_ORDER) assert.ok(d[g] >= -1e-12, `${g} negative`);
    }
  }
});

test('adjustDistribution with no bonuses is the identity and does not mutate the base', () => {
  const base = { ...BASE };
  const copy = { ...base };
  assert.deepEqual(adjustDistribution(base, 0, 0), base);
  adjustDistribution(base, 5, 50);
  assert.deepEqual(base, copy);
});

test('fail reduction moves failure % into D (capped at the failure %)', () => {
  const base = BASE; // D 30, F 10
  const d = adjustDistribution(base, 3, 0);
  assert.equal(d.F, 7);
  assert.equal(d.D, 33);
  assert.equal(d.S, base.S);
  const all = adjustDistribution(base, 50, 0);
  assert.equal(all.F, 0);
  assert.equal(all.D, 40);
  const neg = adjustDistribution(base, -5, 0);
  assert.deepEqual(neg, base);
});

test('upgrade luck: each success has u% to move up one grade (S stays S)', () => {
  const base = BASE; // S5 A10 B20 C25 D30 F10
  const d = adjustDistribution(base, 0, 10);
  assert.ok(closeDist(d, { S: 6, A: 11, B: 20.5, C: 25.5, D: 27, F: 10 }), JSON.stringify(d));
  const full = adjustDistribution(base, 0, 100);
  assert.ok(closeDist(full, { S: 15, A: 20, B: 25, C: 30, D: 0, F: 10 }));
  // fail reduction is applied first, then the upgrade
  const both = adjustDistribution(base, 4, 50); // D becomes 34, F 6
  assert.ok(closeDist(both, { S: 10, A: 15, B: 22.5, C: 29.5, D: 17, F: 6 }), JSON.stringify(both));
});

test('refine distributions include smith rings and per-material skills (bars unchanged by v1.1)', () => {
  const s = game(1);
  assert.deepEqual(refineDistribution(s, 'iron', CFG), CFG.refine.iron.dist);
  addRing(s, 'oreGrade', 'S', true); // 6%
  setSkillLevel(s, 'oreGrade_iron', 10); // +3%
  setSkillLevel(s, 'oreFail_iron', 10); // -3 points failure
  const exp = adjustDistribution(CFG.refine.iron.dist, 3, 9);
  assert.ok(closeDist(refineDistribution(s, 'iron', CFG), exp));
  assert.ok(approx(refineDistribution(s, 'iron', CFG).F, Math.max(0, CFG.refine.iron.dist.F - 3)));
  // other bars only get the ring
  assert.ok(closeDist(refineDistribution(s, 'copper', CFG), adjustDistribution(CFG.refine.copper.dist, 0, 6)));
  // gem luck rings and gem skills never touch bars
  addRing(s, 'gemGrade', 'S', true);
  setSkillLevel(s, 'gemGrade_ruby', 10);
  assert.ok(closeDist(refineDistribution(s, 'iron', CFG), exp));
});

test('refine distributions with the default CONFIG follow the same rule', () => {
  const s = game(1);
  const P = CONFIG.skills.perMaterial;
  addRing(s, 'oreGrade', 'A', true);
  setSkillLevel(s, 'oreGrade_steel', 7);
  setSkillLevel(s, 'oreFail_steel', 4);
  const exp = adjustDistribution(CONFIG.refine.steel.dist, P.oreFail.effects.refineFail * 4, ringVal('oreGrade', 'A') + P.oreGrade.effects.refineUpgrade * 7);
  assert.ok(closeDist(refineDistribution(s, 'steel'), exp));
});

test('General refining removes failure chance for every bar type, on top of the bar\'s own refining skill', () => {
  const s = game(1);
  const per = CFG.skills.activity.refineTime.effects.refineFail; // pinned 0.1 per level
  setSkillLevel(s, 'refineTime', 7);
  const b = smithBonuses(s, CFG);
  for (const bar of BARS) {
    assert.ok(approx(b.oreFailRed(bar), per * 7), bar);
    assert.ok(closeDist(refineDistribution(s, bar, CFG), adjustDistribution(CFG.refine[bar].dist, per * 7, 0)), bar);
  }
  // with the bar's own skill: both add (iron only)
  setSkillLevel(s, 'oreFail_iron', 4);
  const own = CFG.skills.perMaterial.oreFail.effects.refineFail;
  assert.ok(approx(smithBonuses(s, CFG).oreFailRed('iron'), per * 7 + own * 4));
  assert.ok(approx(smithBonuses(s, CFG).oreFailRed('copper'), per * 7));
  assert.ok(approx(refineDistribution(s, 'iron', CFG).F, Math.max(0, CFG.refine.iron.dist.F - (per * 7 + own * 4))));
  // it never lowers failure below 0
  setSkillLevel(s, 'refineTime', 10);
  const huge = cfgWith(CFG, { skills: { activity: { refineTime: { effects: { refineFail: 50 } } } } });
  assert.equal(refineDistribution(s, 'copper', huge).F, 0);
  assert.ok(approx(sum(refineDistribution(s, 'copper', huge)), 100));
});

test('General cutting adds to the blend toward the master table for every gem (capped at 100%)', () => {
  const s = game(1);
  const per = CFG.skills.activity.cutTime.effects.cutBlend; // pinned 1% per level
  setSkillLevel(s, 'cutTime', 6);
  for (const gem of GEMS) {
    assert.equal(smithBonuses(s, CFG).gemBlend(gem), per * 6, gem);
    assert.ok(closeDist(cutDistribution(s, gem, CFG), blendCutTable(CFG.cut[gem], (per * 6) / 100, 0)), gem);
  }
  // with a gem's own grade skill: both add (ruby only)
  setSkillLevel(s, 'gemGrade_ruby', 4);
  const own = CFG.skills.perMaterial.gemGrade.effects.cutBlend;
  assert.equal(smithBonuses(s, CFG).gemBlend('ruby'), per * 6 + own * 4);
  assert.equal(smithBonuses(s, CFG).gemBlend('topaz'), per * 6);
  assert.ok(closeDist(cutDistribution(s, 'ruby', CFG), blendCutTable(CFG.cut.ruby, (per * 6 + own * 4) / 100, 0)));
  // capped: more than 100% of the way is the master table, not beyond
  setSkillLevel(s, 'gemGrade_ruby', 10);
  setSkillLevel(s, 'cutTime', 10);
  const big = cfgWith(CFG, { skills: { activity: { cutTime: { effects: { cutBlend: 30 } } } } });
  assert.equal(smithBonuses(s, big).gemBlend('ruby'), 100);
  assert.ok(closeDist(cutDistribution(s, 'ruby', big), blendCutTable(CFG.cut.ruby, 1, 0)));
  // General cutting does not touch failure
  assert.ok(approx(cutDistribution(s, 'topaz', CFG).F, CFG.cut.topaz.novice.F), 'General cutting at its top level still leaves failure alone');
});

// -------------------------------------------------------------- gem tables ----
test('blendCutTable: t = 0 is the novice table, t = 1 with failRed = novice F - master F is the master table', () => {
  for (const gem of GEMS) {
    const c = CONFIG.cut[gem];
    assert.ok(closeDist(blendCutTable(c, 0, 0), c.novice), `${gem} novice`);
    assert.ok(closeDist(blendCutTable(c, 1, c.novice.F - c.master.F), c.master), `${gem} master`);
    assert.ok(c.master.F <= c.novice.F, 'masters fail no more often');
  }
  assert.ok(closeDist(blendCutTable(TABLE, 0, 0), TABLE.novice));
  assert.ok(closeDist(blendCutTable(TABLE, 1, 0), TABLE.master));
});

test('blendCutTable: D..S blend linearly and fill 100 - F; F = novice F - failRed (clamped)', () => {
  // halfway, equal failure: a plain average
  assert.ok(closeDist(blendCutTable(TABLE, 0.5, 0), { F: 10, D: 30, C: 25, B: 20, A: 10, S: 5 }));
  // failure reduced by 4 points: the successes are scaled up to fill 94
  const d = blendCutTable(TABLE, 0.5, 4);
  assert.ok(approx(d.F, 6));
  const k = 94 / 90;
  assert.ok(closeDist(d, { F: 6, D: 30 * k, C: 25 * k, B: 20 * k, A: 10 * k, S: 5 * k }), JSON.stringify(d));
  // failure cannot go below 0; t is clamped to 0..1
  assert.equal(blendCutTable(TABLE, 0.5, 50).F, 0);
  assert.ok(closeDist(blendCutTable(TABLE, 2, 0), TABLE.master));
  assert.ok(closeDist(blendCutTable(TABLE, -1, 0), TABLE.novice));
  // the input tables are not changed
  assert.deepEqual(TABLE.novice, { F: 10, D: 50, C: 30, B: 10, A: 0, S: 0 });
});

test('blendCutTable always sums to 100, never goes negative, and shifts monotonically toward S as t rises', () => {
  const rng = seededRng(4);
  for (const c of [TABLE, ...GEMS.map((g) => CONFIG.cut[g])]) {
    for (let i = 0; i < 200; i++) {
      const d = blendCutTable(c, rng.float(0, 1), rng.float(0, c.novice.F));
      assert.ok(approx(sum(d), 100, 1e-9), `sum ${sum(d)}`);
      for (const g of GRADE_ORDER) assert.ok(d[g] >= -1e-12);
    }
    // with failure fixed, the chance of "grade X or better" never drops as t rises (for every X above D)
    let prev = null;
    for (let t = 0; t <= 1 + 1e-9; t += 0.05) {
      const d = blendCutTable(c, t, 0);
      const atLeast = SUCCESS.map((_, i) => SUCCESS.slice(i).reduce((a, g) => a + d[g], 0));
      if (prev) for (let i = 1; i < SUCCESS.length; i++) assert.ok(atLeast[i] >= prev[i] - 1e-9, `${SUCCESS[i]}+ dropped at t=${t}`);
      prev = atLeast;
    }
    assert.ok(blendCutTable(c, 1, 0).S > blendCutTable(c, 0, 0).S, 'more S at master level');
    assert.ok(meanGrade(blendCutTable(c, 1, 0)) > meanGrade(blendCutTable(c, 0, 0)));
  }
});

test('cutDistribution: gem grade skill blends novice -> master, cutting skill lowers failure, only gem luck RINGS upgrade', () => {
  const s = game(1);
  const P = CFG.skills.perMaterial;
  const c = CFG.cut.ruby;
  assert.ok(closeDist(cutDistribution(s, 'ruby', CFG), c.novice), 'no skills, no rings: the novice table');
  setSkillLevel(s, 'gemGrade_ruby', 4); // 40% of the way to master
  setSkillLevel(s, 'gemFail_ruby', 6); // 3 points less failure
  const b = smithBonuses(s, CFG);
  assert.equal(b.gemBlend('ruby'), P.gemGrade.effects.cutBlend * 4);
  assert.equal(b.gemFailRed('ruby'), P.gemFail.effects.cutFail * 6);
  assert.equal(b.gemUpgrade('ruby'), 0, 'the grade skill is not an upgrade chance');
  const base = blendCutTable(c, (P.gemGrade.effects.cutBlend * 4) / 100, P.gemFail.effects.cutFail * 6);
  assert.ok(closeDist(cutDistribution(s, 'ruby', CFG), base));
  assert.ok(approx(cutDistribution(s, 'ruby', CFG).F, c.novice.F - 3));
  // a gem luck ring upgrades on top of the blended table
  addRing(s, 'gemGrade', 'B', true);
  const u = ringVal('gemGrade', 'B', CFG);
  assert.equal(smithBonuses(s, CFG).gemUpgrade('ruby'), u);
  assert.ok(closeDist(cutDistribution(s, 'ruby', CFG), adjustDistribution(base, 0, u)));
  // other gems: only the ring (skills are per gem)
  assert.ok(closeDist(cutDistribution(s, 'topaz', CFG), adjustDistribution(CFG.cut.topaz.novice, 0, u)));
  // bar luck rings and bar skills do not affect gems
  addRing(s, 'oreGrade', 'S', true);
  setSkillLevel(s, 'oreGrade_copper', 10);
  assert.ok(closeDist(cutDistribution(s, 'topaz', CFG), adjustDistribution(CFG.cut.topaz.novice, 0, u)));
});

test('cutDistribution with the default CONFIG follows the same rule', () => {
  const s = game(1);
  const P = CONFIG.skills.perMaterial;
  addRing(s, 'gemGrade', 'C', true);
  setSkillLevel(s, 'gemGrade_emerald', 3);
  setSkillLevel(s, 'gemFail_emerald', 9);
  const base = blendCutTable(CONFIG.cut.emerald, (P.gemGrade.effects.cutBlend * 3) / 100, P.gemFail.effects.cutFail * 9);
  assert.ok(closeDist(cutDistribution(s, 'emerald'), adjustDistribution(base, 0, ringVal('gemGrade', 'C'))));
  assert.ok(approx(sum(cutDistribution(s, 'emerald')), 100));
});

test('cutDistribution: a higher gem grade skill never lowers the chance of any grade-or-better', () => {
  const s = game(1);
  let prev = null;
  for (let L = 0; L <= CONFIG.skills.maxLevel; L++) {
    setSkillLevel(s, 'gemGrade_diamond', L);
    const d = cutDistribution(s, 'diamond');
    assert.ok(approx(d.F, CONFIG.cut.diamond.novice.F), 'the grade skill does not change failure');
    const atLeast = SUCCESS.map((_, i) => SUCCESS.slice(i).reduce((a, g) => a + d[g], 0));
    if (prev) for (let i = 1; i < SUCCESS.length; i++) assert.ok(atLeast[i] >= prev[i] - 1e-9, `level ${L}: ${SUCCESS[i]}+`);
    prev = atLeast;
  }
});

test('rollGrade follows the distribution and never returns a 0% grade', () => {
  const rng = seededRng(3);
  const N = 40000;
  const dist = CONFIG.refine.steel.dist;
  const counts = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
  for (let i = 0; i < N; i++) counts[rollGrade(rng, dist)]++;
  for (const g of GRADE_ORDER) assert.ok(Math.abs((counts[g] / N) * 100 - dist[g]) < 1, `${g}: ${(counts[g] / N) * 100}`);
  const noFail = adjustDistribution(dist, 100, 0);
  for (let i = 0; i < 5000; i++) assert.notEqual(rollGrade(rng, noFail), 'F');
});

// ----------------------------------------------------------------- times ----
test('refine / cut minutes default to the config; better ores take (at least) as long', () => {
  const s = game(1);
  assert.deepEqual(BARS.map((b) => refineMinutes(s, b)), BARS.map((b) => CONFIG.refine[b].minutes));
  for (const g of GEMS) assert.equal(cutMinutes(s, g), CONFIG.cut[g].minutes);
  for (let i = 1; i < BARS.length; i++) assert.ok(CONFIG.refine[BARS[i]].minutes >= CONFIG.refine[BARS[i - 1]].minutes, BARS[i]);
  // default config: rings + skills reduce the time
  addRing(s, 'processTime', 'B', true);
  setSkillLevel(s, 'refineTime', 6);
  const pct = ringVal('processTime', 'B') + CONFIG.skills.activity.refineTime.effects.refineTime * 6;
  assert.equal(refineMinutes(s, 'iron'), round1(CONFIG.refine.iron.minutes * (1 - pct / 100)));
});

test('refine / cut minutes: rings and skills reduce time (rounded to 0.1)', () => {
  const s = game(1);
  assert.deepEqual(BARS.map((b) => refineMinutes(s, b, CFG)), [10, 12, 15, 20]);
  assert.equal(cutMinutes(s, 'ruby', CFG), 15);
  addRing(s, 'processTime', 'S', true); // 10% on both
  setSkillLevel(s, 'refineTime', 4); // 2% refining only
  setSkillLevel(s, 'cutTime', 2); // 1% cutting only
  assert.equal(refineMinutes(s, 'mythril', CFG), 17.6); // 20 x 0.88
  assert.equal(cutMinutes(s, 'ruby', CFG), 13.4); // 15 x 0.89 = 13.35 -> 13.4
});

test('processing time reduction is capped at maxTimeReduction', () => {
  const cfg = cfgWith(PIN, { skills: { activity: { refineTime: { effects: { refineTime: 50 } } } } });
  const s = game(1);
  setSkillLevel(s, 'refineTime', 10);
  assert.equal(refineMinutes(s, 'mythril', cfg), 5);
  assert.equal(refineMinutes(s, 'mythril', cfgWith(cfg, { processing: { maxTimeReduction: 40 } })), 12);
});

// ---------------------------------------------------------------- refine ----
test('refine consumes the ore, adds a bar of the rolled grade, spends time and grants XP', () => {
  const cfg = forced('B');
  const s = game(1);
  s.storage.ore.copper = 2;
  const r = refine(s, 'copper', cfg);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.grade, 'B');
  assert.equal(s.storage.ore.copper, 1);
  assert.equal(s.storage.bars['copper:B'], 1);
  assert.equal(r.minutes, 10);
  assert.equal(s.time, DAY_START + 10);
  assert.equal(s.skills.refineTime.xp, 10);
  assert.equal(s.skills.oreGrade_copper.xp, XP.copper);
  assert.equal(s.skills.oreFail_copper.xp, XP.copper);
  assert.equal(s.skills.oreGrade_iron.xp, 0);
  // steel: XP goes to the steel skills (not iron / coal)
  s.storage.ore.iron = 1;
  s.storage.ore.coal = 1;
  refine(s, 'steel', cfg);
  assert.equal(s.skills.oreGrade_steel.xp, XP.steel);
  assert.equal(s.skills.oreFail_steel.xp, XP.steel);
  assert.equal(s.skills.oreGrade_iron.xp, 0);
});

test('refine / cut grant itemXp(material) per item with the default CONFIG', () => {
  const s = game(1);
  for (const bar of BARS) for (const [ore, n] of Object.entries(CONFIG.refine[bar].input)) s.storage.ore[ore] += n;
  for (const gem of GEMS) s.storage.gem[gem] = 1;
  for (const bar of BARS) {
    s.time = DAY_START;
    assert.equal(refine(s, bar).ok, true);
    const xp = itemXp(bar);
    assert.ok(xp > 0, bar);
    assert.equal(s.skills[`oreGrade_${bar}`].xp + xpSpent(s.skills[`oreGrade_${bar}`].level), xp, bar);
    assert.equal(s.skills[`oreFail_${bar}`].xp + xpSpent(s.skills[`oreFail_${bar}`].level), xp, bar);
  }
  for (const gem of GEMS) {
    s.time = DAY_START;
    assert.equal(cut(s, gem).ok, true);
    const xp = itemXp(gem);
    assert.ok(xp > 0, gem);
    assert.equal(s.skills[`gemGrade_${gem}`].xp + xpSpent(s.skills[`gemGrade_${gem}`].level), xp, gem);
    assert.equal(s.skills[`gemFail_${gem}`].xp + xpSpent(s.skills[`gemFail_${gem}`].level), xp, gem);
  }
});

test('steel needs iron + coal and consumes one of each', () => {
  const cfg = forced('S');
  const s = game(1);
  s.storage.ore.iron = 2;
  assert.equal(canRefine(s, 'steel'), false);
  const r0 = refine(s, 'steel', cfg);
  assert.equal(r0.ok, false);
  assert.equal(s.storage.ore.iron, 2, 'nothing consumed on failure to start');
  assert.equal(s.time, DAY_START);
  s.storage.ore.coal = 1;
  assert.equal(canRefine(s, 'steel'), true);
  const r = refine(s, 'steel', cfg);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.storage.ore.iron, 1);
  assert.equal(s.storage.ore.coal, 0);
  assert.equal(s.storage.bars['steel:S'], 1);
  assert.equal(s.storage.bars['iron:S'], 0);
  assert.equal(s.time, DAY_START + 15);
  assert.deepEqual(Object.keys(CONFIG.refine.steel.input).sort(), ['coal', 'iron'], 'steel = iron + coal');
});

test('a failed refine loses the ore and makes no bar (still costs time and gives XP)', () => {
  const cfg = forced('F');
  const s = game(1);
  s.storage.ore.mythril = 1;
  const r = refine(s, 'mythril', cfg);
  assert.equal(r.ok, true);
  assert.equal(r.grade, 'F');
  assert.match(r.msg, /failed/);
  assert.equal(s.storage.ore.mythril, 0);
  assert.equal(Object.values(s.storage.bars).reduce((a, b) => a + b, 0), 0);
  assert.equal(s.time, DAY_START + 20);
  assert.equal(s.skills.refineTime.xp, 20);
  assert.equal(s.skills.oreFail_mythril.xp, XP.mythril, 'failures give the same per-material XP');
  assert.equal(s.skills.oreGrade_mythril.xp, XP.mythril);
});

test('refine requires camp, the work phase, a known bar and enough time', () => {
  const s = game(1);
  s.storage.ore.copper = 5;
  assert.equal(refine(s, 'bronze', CFG).ok, false);
  s.time = DAY_END - 9;
  assert.equal(refine(s, 'copper', CFG).ok, false);
  assert.equal(s.storage.ore.copper, 5);
  s.time = DAY_END - 10;
  assert.equal(refine(s, 'copper', CFG).ok, true, 'exact fit allowed');
  s.time = DAY_START;
  s.phase = 'plan';
  assert.equal(refine(s, 'copper', CFG).ok, false);
  s.phase = 'work';
  standInBlankField(s, 1);
  const r = refine(s, 'copper', CFG);
  assert.equal(r.ok, false);
  assert.match(r.msg, /camp/);
});

test('refine outcomes match the table over many refines (game RNG)', () => {
  // per-material skill bonuses switched off so the table stays fixed while XP piles up
  const cfg = cfgWith({ skills: { activity: { refineTime: { effects: { refineFail: 0 } } }, perMaterial: { oreGrade: { effects: { refineUpgrade: 0 } }, oreFail: { effects: { refineFail: 0 } } } } });
  const N = 3000;
  const s = game(9);
  s.storage.ore.copper = N;
  const counts = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
  for (let i = 0; i < N; i++) {
    s.time = DAY_START;
    counts[refine(s, 'copper', cfg).grade]++;
  }
  const dist = CONFIG.refine.copper.dist;
  for (const g of GRADE_ORDER) assert.ok(Math.abs((counts[g] / N) * 100 - dist[g]) < 2, `${g}: ${(counts[g] / N) * 100}% vs ${dist[g]}%`);
  const bars = GRADE_ORDER.filter((g) => g !== 'F').reduce((a, g) => a + s.storage.bars[`copper:${g}`], 0);
  assert.equal(bars, N - counts.F);
  assert.equal(s.storage.ore.copper, 0);
  // N x itemXp XP -> the level it buys
  let xp = N * itemXp('copper');
  let level = 0;
  while (level < CONFIG.skills.maxLevel && xp >= xpToNext(level)) xp -= xpToNext(level++);
  assert.equal(s.skills.oreGrade_copper.level, level);
});

// ------------------------------------------------------------------- cut ----
test('cut consumes a raw gem and adds a cut gem; failure loses the gem', () => {
  const s = game(1);
  s.storage.gem.ruby = 2;
  const r = cut(s, 'ruby', forced('A'));
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.storage.gem.ruby, 1);
  assert.equal(s.storage.cut['ruby:A'], 1);
  assert.equal(s.time, DAY_START + 15);
  assert.equal(s.skills.cutTime.xp, 15);
  assert.equal(s.skills.gemGrade_ruby.xp, XP.ruby);
  assert.equal(s.skills.gemFail_ruby.xp, XP.ruby);
  const f = cut(s, 'ruby', forced('F'));
  assert.equal(f.ok, true);
  assert.equal(f.grade, 'F');
  assert.equal(s.storage.gem.ruby, 0);
  assert.equal(s.storage.cut['ruby:A'], 1);
  assert.equal(s.skills.gemFail_ruby.xp, 2 * XP.ruby);
  assert.equal(s.skills.gemGrade_topaz.xp, 0);
  assert.equal(cut(s, 'ruby', CFG).ok, false, 'no raw ruby left');
  assert.equal(cut(s, 'opal', CFG).ok, false, 'unknown gem');
  // diamond XP is its own number
  s.storage.gem.diamond = 1;
  cut(s, 'diamond', forced('C'));
  assert.equal(s.skills.gemGrade_diamond.xp, XP.diamond);
});

test('cut outcomes match the blended table over many cuts (game RNG)', () => {
  // gem skills (and General cutting's blend) switched off so the table stays fixed while XP piles up; a gem luck ring on top
  const cfg = cfgWith({ skills: { activity: { cutTime: { effects: { cutBlend: 0 } } }, perMaterial: { gemGrade: { effects: { cutBlend: 0 } }, gemFail: { effects: { cutFail: 0 } } } } });
  const N = 3000;
  const s = game(10);
  addRing(s, 'gemGrade', 'A', true);
  s.storage.gem.sapphire = N;
  const counts = Object.fromEntries(GRADE_ORDER.map((g) => [g, 0]));
  for (let i = 0; i < N; i++) {
    s.time = DAY_START;
    counts[cut(s, 'sapphire', cfg).grade]++;
  }
  const dist = adjustDistribution(CONFIG.cut.sapphire.novice, 0, ringVal('gemGrade', 'A'));
  assert.ok(closeDist(cutDistribution(s, 'sapphire', cfg), dist));
  for (const g of GRADE_ORDER) assert.ok(Math.abs((counts[g] / N) * 100 - dist[g]) < 2, `${g}: ${(counts[g] / N) * 100}% vs ${dist[g]}%`);
  const cutGems = GRADES.reduce((a, g) => a + s.storage.cut[`sapphire:${g}`], 0);
  assert.equal(cutGems, N - counts.F);
});

test('cut requires camp, the work phase and enough time', () => {
  const s = game(1);
  s.storage.gem.topaz = 1;
  s.time = DAY_END - 14.9;
  assert.equal(cut(s, 'topaz', CFG).ok, false);
  assert.equal(s.storage.gem.topaz, 1);
  s.time = DAY_START;
  s.phase = 'report';
  assert.equal(cut(s, 'topaz', CFG).ok, false);
  s.phase = 'work';
  standInBlankField(s, 1);
  assert.match(cut(s, 'topaz', CFG).msg, /camp/);
  assert.equal(s.storage.gem.topaz, 1);
});

test('repeat runs until materials or time run out and summarizes the grades', () => {
  const s = game(1);
  s.storage.ore.copper = 4;
  const cfg = forced('C');
  const r = repeat(s, () => refine(s, 'copper', cfg));
  assert.equal(r.ok, true);
  assert.equal(r.results.length, 4);
  assert.match(r.msg, /Done 4x in 40m: Cx4/);
  assert.equal(s.storage.bars['copper:C'], 4);
  const none = repeat(s, () => refine(s, 'copper', cfg));
  assert.equal(none.ok, false, 'first failure is returned as-is');
  s.storage.ore.copper = 100;
  s.time = DAY_END - 35;
  const t = repeat(s, () => refine(s, 'copper', cfg));
  assert.equal(t.results.length, 3, 'stops when out of time');
  s.time = DAY_START;
  assert.equal(repeat(s, () => refine(s, 'copper', cfg), 2).results.length, 2, 'maxTimes respected');
});
