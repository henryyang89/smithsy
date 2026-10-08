import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, GRADES, TIERS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  ringValue, ringTotals, ringContributions, rollRing, toggleRing, wornRings, smithRingTotals, ringLabel, ringDef,
} from '../js/core/rings.js';
import { game, addRing, cfgWith } from './helpers.mjs';

const r = (type, grade, id = Math.random()) => ({ id, type, grade, worn: true });
// Pinned ring numbers: the hand-computed totals below hold whatever CONFIG says.
const RC = cfgWith({
  rings: {
    maxWorn: 10,
    duplicateFactor: 0.5,
    types: {
      accuracy: { values: [6, 7, 8, 9, 10] }, dodge: { values: [6, 7, 8, 9, 10] }, health: { values: [3, 4, 5, 6, 7] },
      travelTime: { values: [5, 6, 7, 8, 10] }, searchEff: { values: [10, 12, 14, 16, 20] }, speed: { values: [2, 2.5, 3, 3.5, 4] },
    },
  },
});

test('18 ring types, 8 smith + 10 adventurer, 5 values each, increasing with grade', () => {
  const types = Object.entries(CONFIG.rings.types);
  assert.equal(types.length, 18);
  assert.equal(types.filter(([, d]) => d.owner === 'smith').length, 8);
  assert.equal(types.filter(([, d]) => d.owner === 'adventurer').length, 10);
  for (const [k, d] of types) {
    assert.equal(d.values.length, 5, k);
    for (let i = 1; i < 5; i++) assert.ok(d.values[i] >= d.values[i - 1], `${k} not increasing`);
  }
});

test('ringValue maps grade D..S to the type\'s values', () => {
  for (const [type, d] of Object.entries(CONFIG.rings.types)) {
    GRADES.forEach((g, i) => assert.equal(ringValue({ type, grade: g }), d.values[i]));
  }
  assert.equal(ringValue({ type: 'speed', grade: 'C' }, RC), 2.5);
  assert.equal(ringValue({ type: 'travelTime', grade: 'S' }, RC), 10);
});

test('ringLabel: "Name G (value + description)", no space before a "%" description', () => {
  assert.equal(ringLabel({ type: 'travelTime', grade: 'S' }, RC), 'Travel S (10% less travel time)');
  assert.equal(ringLabel({ type: 'speed', grade: 'C' }, RC), 'Speed C (2.5% attack speed)');
  assert.equal(ringLabel({ type: 'accuracy', grade: 'S' }, RC), 'Accuracy S (10 accuracy rating)');
  assert.equal(ringLabel({ type: 'health', grade: 'D' }, RC), 'Health D (3% max HP)');
  const custom = cfgWith({ rings: { types: { reveal: { name: 'Ore sight', values: [1, 2, 3, 4, 5], desc: '% (points) chance to see' } } } });
  assert.equal(ringLabel({ type: 'reveal', grade: 'B' }, custom), 'Ore sight B (3% (points) chance to see)');
  // every type and grade with the default config
  for (const [type, d] of Object.entries(CONFIG.rings.types)) {
    for (const g of GRADES) {
      const label = ringLabel({ type, grade: g });
      const v = ringValue({ type, grade: g });
      assert.ok(label.startsWith(`${d.name} ${g} (${v}`), label);
      assert.ok(label.endsWith(`${d.desc})`), label);
      assert.ok(!label.includes(' %'), `stray space before %: ${label}`);
      assert.ok(!label.includes('  '), `double space: ${label}`);
      if (!d.desc.startsWith('%')) assert.ok(label.includes(`${v} ${d.desc}`), label);
    }
  }
});

test('ringTotals: same type stacks 1 / 0.5 / 0.25 / 0.125, best first regardless of input order', () => {
  // accuracy: D=6, B=8, S=10 given in a scrambled order
  const t = ringTotals([r('accuracy', 'D'), r('accuracy', 'S'), r('accuracy', 'B')], RC);
  assert.equal(t.accuracy, 10 + 8 * 0.5 + 6 * 0.25);
  const t4 = ringTotals([r('dodge', 'D'), r('dodge', 'D'), r('dodge', 'D'), r('dodge', 'D')], RC);
  assert.equal(t4.dodge, 6 * (1 + 0.5 + 0.25 + 0.125));
  assert.equal(ringTotals([r('health', 'A')], RC).health, 6);
  // the factor comes from the config
  const third = cfgWith(RC, { rings: { duplicateFactor: 1 / 3 } });
  assert.ok(Math.abs(ringTotals([r('accuracy', 'S'), r('accuracy', 'S')], third).accuracy - (10 + 10 / 3)) < 1e-9);
  // default config: best ring + duplicateFactor x second best
  const f = CONFIG.rings.duplicateFactor;
  const v = CONFIG.rings.types.accuracy.values;
  assert.ok(Math.abs(ringTotals([r('accuracy', 'D'), r('accuracy', 'S')]).accuracy - (v[4] + v[0] * f)) < 1e-9);
});

test('ringTotals: different types do not interact; empty list -> {}', () => {
  const t = ringTotals([r('accuracy', 'S'), r('dodge', 'S'), r('accuracy', 'S'), r('travelTime', 'D')], RC);
  assert.deepEqual(t, { accuracy: 15, dodge: 10, travelTime: 5 });
  assert.deepEqual(ringTotals([]), {});
});

test('ringContributions gives each ring its factor (sorted high -> low)', () => {
  const rings = [r('accuracy', 'D', 1), r('accuracy', 'S', 2), r('accuracy', 'B', 3), r('dodge', 'C', 4)];
  const c = ringContributions(rings, RC);
  assert.deepEqual(c[2], { value: 10, factor: 1, effective: 10 });
  assert.deepEqual(c[3], { value: 8, factor: 0.5, effective: 4 });
  assert.deepEqual(c[1], { value: 6, factor: 0.25, effective: 1.5 });
  assert.deepEqual(c[4], { value: 7, factor: 1, effective: 7 });
  const sum = [1, 2, 3].reduce((a, id) => a + c[id].effective, 0);
  assert.equal(sum, ringTotals(rings, RC).accuracy);
  // default config: contributions always add up to the totals
  const d = ringContributions(rings);
  assert.ok(Math.abs([1, 2, 3].reduce((a, id) => a + d[id].effective, 0) - ringTotals(rings).accuracy) < 1e-9);
});

test('smithRingTotals only counts worn smith rings', () => {
  const s = game(1);
  addRing(s, 'travelTime', 'S', true);
  addRing(s, 'travelTime', 'A', false);
  addRing(s, 'accuracy', 'S', true); // adventurer ring: not a smith bonus
  addRing(s, 'searchEff', 'C', true);
  assert.deepEqual(smithRingTotals(s, RC), { travelTime: 10, searchEff: 12 });
  assert.deepEqual(Object.keys(smithRingTotals(s)).sort(), ['searchEff', 'travelTime']);
  assert.equal(wornRings(s, 'smith').length, 2);
  assert.equal(wornRings(s, 'adventurer').length, 1);
});

test('rollRing: grades stay within the tier\'s weights, follow them, and types are uniform', () => {
  const rng = seededRng(5);
  const N = 6000;
  const nTypes = Object.keys(CONFIG.rings.types).length;
  for (const tier of TIERS) {
    const W = CONFIG.rings.gradeWeights[tier];
    const total = Object.values(W).reduce((a, b) => a + Math.max(0, b), 0);
    const grades = {};
    const types = {};
    for (let i = 0; i < N; i++) {
      const ring = rollRing(rng, tier);
      assert.ok(ringDef(ring.type), `unknown type ${ring.type}`);
      assert.ok(W[ring.grade] > 0, `${tier} rolled ${ring.grade}`);
      grades[ring.grade] = (grades[ring.grade] || 0) + 1;
      types[ring.type] = (types[ring.type] || 0) + 1;
    }
    for (const [g, w] of Object.entries(W)) assert.ok(Math.abs((grades[g] || 0) / N - Math.max(0, w) / total) < 0.03, `${tier} ${g}`);
    assert.equal(Object.keys(types).length, nTypes);
    for (const n of Object.values(types)) assert.ok(Math.abs(n / N - 1 / nTypes) < 0.02);
  }
});

test('ring grade weights: lower grades are more likely; better tiers drop better rings', () => {
  const allowed = (tier) => GRADES.filter((g) => CONFIG.rings.gradeWeights[tier][g] > 0);
  for (const tier of TIERS) {
    const W = CONFIG.rings.gradeWeights[tier];
    const gs = allowed(tier);
    for (let i = 1; i < gs.length; i++) assert.ok(W[gs[i - 1]] > W[gs[i]], `${tier}: ${gs[i - 1]} more likely than ${gs[i]}`);
  }
  const best = (tier) => Math.max(...allowed(tier).map((g) => GRADES.indexOf(g)));
  const worst = (tier) => Math.min(...allowed(tier).map((g) => GRADES.indexOf(g)));
  assert.ok(best('normal') <= best('elite') && best('elite') <= best('champion'));
  assert.ok(worst('normal') <= worst('elite') && worst('elite') <= worst('champion'));
});

test('toggleRing: max worn per owner, independently for smith and adventurer', () => {
  for (const cfg of [RC, cfgWith({ rings: { maxWorn: 3 } })]) {
    const max = cfg.rings.maxWorn;
    const s = game(1);
    const smith = Array.from({ length: max + 2 }, () => addRing(s, 'searchTime', 'D'));
    const adv = Array.from({ length: max + 1 }, () => addRing(s, 'dodge', 'D'));
    for (let i = 0; i < max; i++) assert.equal(toggleRing(s, smith[i].id, cfg).ok, true);
    const over = toggleRing(s, smith[max].id, cfg);
    assert.equal(over.ok, false);
    assert.match(over.msg, new RegExp(`smith already wears ${max}`));
    assert.equal(smith[max].worn, false);
    for (let i = 0; i < max; i++) assert.equal(toggleRing(s, adv[i].id, cfg).ok, true, 'adventurer has its own slots');
    assert.equal(toggleRing(s, adv[max].id, cfg).ok, false);
    // removing one frees a slot
    assert.equal(toggleRing(s, smith[0].id, cfg).ok, true);
    assert.equal(smith[0].worn, false);
    assert.equal(toggleRing(s, smith[max].id, cfg).ok, true);
    assert.equal(wornRings(s, 'smith').length, max);
    assert.equal(toggleRing(s, 424242, cfg).ok, false);
  }
});

test('Foresight: a smith ring (more guesses and test fights in the win-chance estimate), 5 whole-number values', () => {
  const d = CONFIG.rings.types.foresight;
  assert.equal(d.owner, 'smith');
  assert.equal(d.values.length, 5);
  assert.ok(d.name && d.desc);
  assert.match(ringLabel({ type: 'foresight', grade: 'S' }), new RegExp(`^${d.name} S \\(${d.values[4]} `));
  // worn smith rings: it shows up in the smith totals, stacking like any smith ring
  const s = game(1);
  addRing(s, 'foresight', 'S', true);
  addRing(s, 'foresight', 'D', true);
  addRing(s, 'health', 'S', true); // adventurer ring: not in the smith totals
  assert.ok(Math.abs(smithRingTotals(s).foresight - (d.values[4] + d.values[0] * CONFIG.rings.duplicateFactor)) < 1e-9);
  assert.equal(smithRingTotals(s).health, undefined);
  // enemies can drop it
  const rng = seededRng(11);
  const seen = new Set();
  for (let i = 0; i < 3000; i++) seen.add(rollRing(rng, 'normal').type);
  assert.deepEqual([...seen].sort(), Object.keys(CONFIG.rings.types).sort());
});
