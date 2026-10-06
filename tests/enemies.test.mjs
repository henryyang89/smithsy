import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, TIERS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  ATTR_KEYS, growth, rollLevels, generateRoster, attrVisible, ringTypeVisible, ringGradeVisible, knownLevels,
  sampleLevels, enemyBase, enemyCombatant,
} from '../js/core/enemies.js';
import { game, cfgWith, allLevels, countLevels, approx } from './helpers.mjs';

const EXPECTED = { normal: { low: 6, normal: 6, high: 0 }, elite: { low: 3, normal: 6, high: 3 }, champion: { low: 0, normal: 6, high: 6 } };

test('12 attributes in 6 offense|defense pairs', () => {
  assert.equal(ATTR_KEYS.length, 12);
  const paired = CONFIG.enemies.pairs.flat();
  assert.deepEqual([...paired].sort(), [...ATTR_KEYS].sort());
  for (const [o, d] of CONFIG.enemies.pairs) {
    assert.equal(CONFIG.enemies.attributes[o].side, 'O');
    assert.equal(CONFIG.enemies.attributes[d].side, 'D');
  }
});

test('roster: 2 normal, 3 elite, 2 champion with exact level counts per tier', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const roster = generateRoster(seededRng(seed), 4);
    assert.equal(roster.day, 4);
    assert.equal(roster.enemies.length, 7);
    assert.deepEqual(roster.enemies.map((e) => e.tier), ['normal', 'normal', 'elite', 'elite', 'elite', 'champion', 'champion']);
    for (const e of roster.enemies) {
      assert.equal(e.day, 4);
      assert.deepEqual(Object.keys(e.levels).sort(), [...ATTR_KEYS].sort());
      assert.deepEqual(countLevels(e.levels), EXPECTED[e.tier], `${e.tier} seed ${seed}`);
      assert.ok(CONFIG.enemies.names[e.tier].includes(e.name));
      for (const k of ATTR_KEYS) assert.ok(e.sight[k] >= 0 && e.sight[k] < 100);
      assert.ok(e.ringTypeRoll >= 0 && e.ringTypeRoll < 100);
      assert.ok(e.ringGradeRoll >= 0 && e.ringGradeRoll < 100);
      assert.ok(CONFIG.rings.types[e.ring.type]);
      assert.ok(Object.keys(CONFIG.rings.gradeWeights[e.tier]).includes(e.ring.grade));
    }
    for (const tier of TIERS) {
      const names = roster.enemies.filter((e) => e.tier === tier).map((e) => e.name);
      assert.equal(new Set(names).size, names.length, `duplicate ${tier} name (seed ${seed})`);
    }
  }
});

test('rollLevels: assignment is random (each attribute gets each allowed level sometimes)', () => {
  const rng = seededRng(2);
  const seen = Object.fromEntries(ATTR_KEYS.map((k) => [k, new Set()]));
  for (let i = 0; i < 400; i++) {
    const lv = rollLevels(rng, 'elite');
    for (const k of ATTR_KEYS) seen[k].add(lv[k]);
  }
  for (const k of ATTR_KEYS) assert.equal(seen[k].size, 3, k);
});

test('rollLevels throws if a tier\'s counts do not add up to 12', () => {
  const cfg = cfgWith({ enemies: { tiers: { elite: { levels: { low: 3, normal: 9, high: 3 } } } } });
  assert.throws(() => rollLevels(seededRng(1), 'elite', cfg), /add up to 12/);
});

test('sampleLevels keeps known levels and fills the rest to the exact tier counts', () => {
  const rng = seededRng(3);
  for (let i = 0; i < 300; i++) {
    const known = { piercing: 'high', hp: 'high', fast: 'low', magical: 'normal' };
    const out = sampleLevels(rng, 'elite', known);
    for (const [k, v] of Object.entries(known)) assert.equal(out[k], v);
    assert.deepEqual(countLevels(out), EXPECTED.elite);
  }
  // champion with all 6 highs known -> everything else must be normal
  const highs = Object.fromEntries(ATTR_KEYS.slice(0, 6).map((k) => [k, 'high']));
  const c = sampleLevels(rng, 'champion', highs);
  for (const k of ATTR_KEYS.slice(6)) assert.equal(c[k], 'normal');
  // nothing known -> a valid random assignment
  for (const tier of TIERS) assert.deepEqual(countLevels(sampleLevels(rng, tier, {})), EXPECTED[tier]);
  // everything known -> unchanged
  const full = rollLevels(rng, 'normal');
  assert.deepEqual(sampleLevels(rng, 'normal', full), full);
});

test('sampleLevels does not mutate the known object', () => {
  const known = { piercing: 'low' };
  sampleLevels(seededRng(1), 'normal', known);
  assert.deepEqual(known, { piercing: 'low' });
});

test('growth: HP/damage +5% per day, ratings +2% per day', () => {
  assert.deepEqual(growth(1), { hpDamage: 1, ratings: 1 });
  const g = growth(11);
  assert.ok(approx(g.hpDamage, 1.5));
  assert.ok(approx(g.ratings, 1.2));
});

test('enemyCombatant: tier base stats with all-normal attributes on day 1', () => {
  const e = enemyCombatant('champion', 1, allLevels('normal'), 'Lich');
  assert.equal(e.name, 'Lich');
  assert.equal(e.hp, 130);
  assert.equal(e.damage, 10);
  assert.equal(e.defense, 20);
  assert.equal(e.interval, 2);
  assert.equal(e.speed, 0);
  assert.equal(e.accuracy, 100);
  assert.equal(e.dodge, 100);
  assert.equal(e.magicPct, 20);
  assert.equal(e.magicRes, 15);
  assert.equal(e.pierce, 15);
  assert.equal(e.pierceRes, 10);
  assert.equal(e.stunChance, 10);
  assert.equal(e.stunDur, CONFIG.enemies.stunDuration);
  assert.equal(e.stunChanceRed, 25);
  assert.equal(e.stunDurRed, 25);
  assert.equal(e.slowPct, 20);
  assert.equal(e.slowDur, CONFIG.enemies.slowDuration);
  assert.equal(e.slowRed, 25);
  assert.equal(e.slowDurRed, 25);
});

test('enemyCombatant: attribute levels and daily growth', () => {
  const hi = enemyCombatant('normal', 11, allLevels('high'));
  assert.ok(approx(hi.hp, 60 * 1.5 * 1.1));
  assert.ok(approx(hi.damage, 6 * 1.5));
  assert.ok(approx(hi.accuracy, 120 * 1.2));
  assert.ok(approx(hi.dodge, 120 * 1.2));
  assert.equal(hi.speed, 5);
  assert.equal(hi.defense, 10, 'defense does not grow');
  const lo = enemyCombatant('elite', 1, allLevels('low'));
  assert.ok(approx(lo.hp, 90 * 0.9));
  assert.equal(lo.speed, -5);
  assert.equal(lo.pierce, 5);
  assert.equal(lo.magicRes, 0);
  assert.equal(lo.accuracy, 80);
  const b = enemyBase('elite', 3);
  assert.ok(approx(b.hp, 99));
  assert.ok(approx(b.damage, 8.8));
  assert.equal(b.defense, 15);
  assert.ok(approx(b.ratingMult, 1.04));
});

test('attribute visibility: stored roll < intel chance (25% base, rises when intel is spent)', () => {
  const s = game(1);
  const e = { levels: allLevels('normal'), sight: Object.fromEntries(ATTR_KEYS.map((k, i) => [k, i * 8.5])), ringTypeRoll: 24.99, ringGradeRoll: 25 };
  // rolls: 0, 8.5, 17, 25.5, 34, ...
  assert.equal(attrVisible(s, e, 'piercing'), true);
  assert.equal(attrVisible(s, e, 'magical'), true); // 17 < 25
  assert.equal(attrVisible(s, e, 'magicRes'), false); // 25.5
  assert.deepEqual(Object.keys(knownLevels(s, e)), ATTR_KEYS.slice(0, 3));
  assert.equal(ringTypeVisible(s, e), true);
  assert.equal(ringGradeVisible(s, e), false, 'roll equal to the chance is hidden');
  s.intel.spent.enemySight = 1; // 35%
  assert.equal(attrVisible(s, e, 'magicRes'), true);
  assert.equal(Object.keys(knownLevels(s, e)).length, 5); // 0..34
  s.intel.spent.ringGradeSight = 1;
  assert.equal(ringGradeVisible(s, e), true);
  // maximum intel shows everything (rolls are < 100)
  s.intel.spent.enemySight = 100;
  e.sight.hp = 99.999;
  assert.deepEqual(knownLevels(s, e), e.levels);
});

test('about 25% of attributes are visible at base intel', () => {
  const s = game(2);
  let vis = 0;
  let total = 0;
  for (let seed = 1; seed <= 100; seed++) {
    for (const e of generateRoster(seededRng(seed), 2).enemies) {
      vis += Object.keys(knownLevels(s, e)).length;
      total += 12;
    }
  }
  assert.ok(Math.abs(vis / total - 0.25) < 0.03, `${vis / total}`);
});
