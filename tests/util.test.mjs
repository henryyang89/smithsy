import test from 'node:test';
import assert from 'node:assert/strict';
import { clamp, round1, round2, gradeIndex, cap, formatClock, formatDuration, reduced, fmtNum, deepClone } from '../js/core/util.js';

test('clamp / round1 / round2 / gradeIndex / cap', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
  assert.equal(round1(1.25), 1.3);
  assert.equal(round1(38.72), 38.7);
  assert.equal(round2(0.21 - 0.07), 0.14);
  assert.equal(gradeIndex('D'), 0);
  assert.equal(gradeIndex('S'), 4);
  assert.equal(gradeIndex('X'), -1);
  assert.equal(cap('mythril'), 'Mythril');
});

test('formatClock', () => {
  assert.equal(formatClock(480), '08:00');
  assert.equal(formatClock(1080), '18:00');
  assert.equal(formatClock(1085.9), '18:05');
  assert.equal(formatClock(599.9999999999), '10:00', 'float noise does not show 09:59');
});

test('formatDuration', () => {
  assert.equal(formatDuration(12.5), '12.5m');
  assert.equal(formatDuration(60), '1h');
  assert.equal(formatDuration(85), '1h 25m');
  assert.equal(formatDuration(130.25), '2h 10.3m');
});

test('reduced applies a capped % reduction', () => {
  assert.equal(reduced(100, 10), 90);
  assert.equal(reduced(100, 90), 25, 'default cap 75%');
  assert.equal(reduced(100, 90, 50), 50);
  assert.equal(reduced(100, -20), 100, 'negative reductions ignored');
});

test('fmtNum / deepClone', () => {
  assert.equal(fmtNum(3.14159), '3.1');
  assert.equal(fmtNum(3.14159, 2), '3.14');
  const o = { a: [1, { b: 2 }] };
  const c = deepClone(o);
  assert.deepEqual(c, o);
  assert.notEqual(c.a, o.a);
});
