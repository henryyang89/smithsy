import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, GRADES, TIERS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  ringValue, ringTotals, ringContributions, rollRing, toggleRing, wornRings, smithRingTotals, ringLabel, ringDef,
} from '../js/core/rings.js';
import { game, addRing } from './helpers.mjs';

const r = (type, grade, id = Math.random()) => ({ id, type, grade, worn: true });

test('17 ring types, 7 smith + 10 adventurer, 5 values each, increasing with grade', () => {
  const types = Object.entries(CONFIG.rings.types);
  assert.equal(types.length, 17);
  assert.equal(types.filter(([, d]) => d.owner === 'smith').length, 7);
  assert.equal(types.filter(([, d]) => d.owner === 'adventurer').length, 10);
  for (const [k, d] of types) {
    assert.equal(d.values.length, 5, k);
    for (let i = 1; i < 5; i++) assert.ok(d.values[i] >= d.values[i - 1], `${k} not increasing`);
  }
});

test('ringValue maps grade D..S to the type\'s values', () => {
  GRADES.forEach((g, i) => assert.equal(ringValue({ type: 'travelTime', grade: g }), CONFIG.rings.types.travelTime.values[i]));
  assert.equal(ringValue({ type: 'speed', grade: 'C' }), 2.5);
  assert.match(ringLabel({ type: 'accuracy', grade: 'S' }), /^Accuracy S \(10 /);
});

test('ringTotals: same type stacks 1 / 0.5 / 0.25 / 0.125, best first regardless of input order', () => {
  // accuracy: D=6, B=8, S=10 given in a scrambled order
  const t = ringTotals([r('accuracy', 'D'), r('accuracy', 'S'), r('accuracy', 'B')]);
  assert.equal(t.accuracy, 10 + 8 * 0.5 + 6 * 0.25);
  const t4 = ringTotals([r('dodge', 'D'), r('dodge', 'D'), r('dodge', 'D'), r('dodge', 'D')]);
  assert.equal(t4.dodge, 6 * (1 + 0.5 + 0.25 + 0.125));
  assert.equal(ringTotals([r('health', 'A')]).health, 6);
});

test('ringTotals: different types do not interact; empty list -> {}', () => {
  const t = ringTotals([r('accuracy', 'S'), r('dodge', 'S'), r('accuracy', 'S'), r('travelTime', 'D')]);
  assert.deepEqual(t, { accuracy: 15, dodge: 10, travelTime: 5 });
  assert.deepEqual(ringTotals([]), {});
});

test('ringContributions gives each ring its factor (sorted high -> low)', () => {
  const rings = [r('accuracy', 'D', 1), r('accuracy', 'S', 2), r('accuracy', 'B', 3), r('dodge', 'C', 4)];
  const c = ringContributions(rings);
  assert.deepEqual(c[2], { value: 10, factor: 1, effective: 10 });
  assert.deepEqual(c[3], { value: 8, factor: 0.5, effective: 4 });
  assert.deepEqual(c[1], { value: 6, factor: 0.25, effective: 1.5 });
  assert.deepEqual(c[4], { value: 7, factor: 1, effective: 7 });
  const sum = [1, 2, 3].reduce((a, id) => a + c[id].effective, 0);
  assert.equal(sum, ringTotals(rings).accuracy);
});

test('smithRingTotals only counts worn smith rings', () => {
  const s = game(1);
  addRing(s, 'travelTime', 'S', true);
  addRing(s, 'travelTime', 'A', false);
  addRing(s, 'accuracy', 'S', true); // adventurer ring: not a smith bonus
  addRing(s, 'searchEff', 'C', true);
  assert.deepEqual(smithRingTotals(s), { travelTime: 10, searchEff: 12 });
  assert.equal(wornRings(s, 'smith').length, 2);
  assert.equal(wornRings(s, 'adventurer').length, 1);
});

test('rollRing: grades stay within the tier range and lower grades are more likely; types are uniform', () => {
  const rng = seededRng(5);
  const N = 6000;
  const allowed = { normal: ['D', 'C', 'B'], elite: ['C', 'B', 'A'], champion: ['B', 'A', 'S'] };
  for (const tier of TIERS) {
    const grades = {};
    const types = {};
    for (let i = 0; i < N; i++) {
      const ring = rollRing(rng, tier);
      assert.ok(ringDef(ring.type), `unknown type ${ring.type}`);
      assert.ok(allowed[tier].includes(ring.grade), `${tier} rolled ${ring.grade}`);
      grades[ring.grade] = (grades[ring.grade] || 0) + 1;
      types[ring.type] = (types[ring.type] || 0) + 1;
    }
    const [lo, mid, hi] = allowed[tier];
    assert.ok(grades[lo] > grades[mid] && grades[mid] > grades[hi], `${tier}: ${JSON.stringify(grades)}`);
    assert.ok(Math.abs(grades[lo] / N - 0.6) < 0.03);
    assert.ok(Math.abs(grades[hi] / N - 0.1) < 0.02);
    assert.equal(Object.keys(types).length, 17);
    for (const n of Object.values(types)) assert.ok(Math.abs(n / N - 1 / 17) < 0.02);
  }
});

test('toggleRing: max 10 worn per owner, independently for smith and adventurer', () => {
  const s = game(1);
  const smith = Array.from({ length: 12 }, () => addRing(s, 'searchTime', 'D'));
  const adv = Array.from({ length: 11 }, () => addRing(s, 'dodge', 'D'));
  for (let i = 0; i < 10; i++) assert.equal(toggleRing(s, smith[i].id).ok, true);
  const r11 = toggleRing(s, smith[10].id);
  assert.equal(r11.ok, false);
  assert.match(r11.msg, /smith already wears 10/);
  assert.equal(smith[10].worn, false);
  for (let i = 0; i < 10; i++) assert.equal(toggleRing(s, adv[i].id).ok, true, 'adventurer has its own 10');
  assert.equal(toggleRing(s, adv[10].id).ok, false);
  // removing one frees a slot
  assert.equal(toggleRing(s, smith[0].id).ok, true);
  assert.equal(smith[0].worn, false);
  assert.equal(toggleRing(s, smith[10].id).ok, true);
  assert.equal(wornRings(s, 'smith').length, 10);
  assert.equal(toggleRing(s, 424242).ok, false);
});
