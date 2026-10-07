import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  adjustDistribution, refineDistribution, cutDistribution, refineMinutes, cutMinutes, rollGrade, refine, cut,
  canRefine, repeat, GRADE_ORDER,
} from '../js/core/processing.js';
import { itemXp, xpToNext } from '../js/core/skills.js';
import { round1 } from '../js/core/util.js';
import { game, cfgWith, approx, addRing, setSkillLevel, standInBlankField, ringVal, DAY_END, DAY_START } from './helpers.mjs';

const sum = (d) => GRADE_ORDER.reduce((a, g) => a + d[g], 0);
// Total XP spent to reach `level` (so xp + xpSpent(level) = all XP ever gained, below max level).
const xpSpent = (level, cfg = CONFIG) => Array.from({ length: level }, (_, L) => xpToNext(L, cfg)).reduce((a, b) => a + b, 0);
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
    activity: { refineTime: { perLevel: 0.5 }, cutTime: { perLevel: 0.5 } },
    perMaterial: { oreGrade: { perLevel: 0.3 }, oreFail: { perLevel: 0.3 }, gemGrade: { perLevel: 0.3 }, gemFail: { perLevel: 0.3 } },
  },
};
const CFG = cfgWith(PIN);
// CFG, plus every refine / cut lands on `grade`.
const forced = (grade) => {
  const dist = { S: 0, A: 0, B: 0, C: 0, D: 0, F: 0, [grade]: 100 };
  const refineCfg = Object.fromEntries(BARS.map((b) => [b, { dist }]));
  const cutCfg = Object.fromEntries(GEMS.map((g) => [g, { dist }]));
  return cfgWith(PIN, { refine: refineCfg, cut: cutCfg });
};

// --------------------------------------------------------- distributions ----
test('config grade tables each sum to 100', () => {
  for (const b of BARS) assert.equal(sum(CONFIG.refine[b].dist), 100, b);
  for (const g of GEMS) assert.equal(sum(CONFIG.cut[g].dist), 100, g);
});

test('adjustDistribution always sums to 100 and never goes negative', () => {
  const rng = seededRng(1);
  const bases = [...BARS.map((b) => CONFIG.refine[b].dist), ...GEMS.map((g) => CONFIG.cut[g].dist)];
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

test('refine/cut distributions include smith rings and per-material skills', () => {
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
  // gem luck ring + gem skills
  addRing(s, 'gemGrade', 'D', true); // 2%
  setSkillLevel(s, 'gemFail_ruby', 5); // 1.5
  setSkillLevel(s, 'gemGrade_ruby', 5); // 1.5
  assert.ok(closeDist(cutDistribution(s, 'ruby', CFG), adjustDistribution(CFG.cut.ruby.dist, 1.5, 3.5)));
  assert.ok(closeDist(cutDistribution(s, 'topaz', CFG), adjustDistribution(CFG.cut.topaz.dist, 0, 2)));
});

test('refine/cut distributions with the default CONFIG follow the same rule', () => {
  const s = game(1);
  const P = CONFIG.skills.perMaterial;
  addRing(s, 'oreGrade', 'A', true);
  setSkillLevel(s, 'oreGrade_steel', 7);
  setSkillLevel(s, 'oreFail_steel', 4);
  const exp = adjustDistribution(CONFIG.refine.steel.dist, P.oreFail.perLevel * 4, ringVal('oreGrade', 'A') + P.oreGrade.perLevel * 7);
  assert.ok(closeDist(refineDistribution(s, 'steel'), exp));
  addRing(s, 'gemGrade', 'C', true);
  setSkillLevel(s, 'gemGrade_emerald', 3);
  setSkillLevel(s, 'gemFail_emerald', 9);
  const expG = adjustDistribution(CONFIG.cut.emerald.dist, P.gemFail.perLevel * 9, ringVal('gemGrade', 'C') + P.gemGrade.perLevel * 3);
  assert.ok(closeDist(cutDistribution(s, 'emerald'), expG));
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
  const pct = ringVal('processTime', 'B') + CONFIG.skills.activity.refineTime.perLevel * 6;
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
  const cfg = cfgWith(PIN, { skills: { activity: { refineTime: { perLevel: 50 } } } });
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
  const cfg = cfgWith({ skills: { perMaterial: { oreGrade: { perLevel: 0 }, oreFail: { perLevel: 0 } } } });
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
