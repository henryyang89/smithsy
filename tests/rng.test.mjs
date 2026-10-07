import test from 'node:test';
import assert from 'node:assert/strict';
import { nextFloat, makeRng, seededRng, rngFor, mixSeed } from '../js/core/rng.js';

const seq = (rng, n) => Array.from({ length: n }, () => rng.next());

test('same seed gives the same sequence; different seeds differ', () => {
  assert.deepEqual(seq(seededRng(42), 50), seq(seededRng(42), 50));
  assert.notDeepEqual(seq(seededRng(42), 50), seq(seededRng(43), 50));
});

test('nextFloat stays in [0, 1) and advances the holder', () => {
  const h = { s: 99 };
  let prev = h.s;
  for (let i = 0; i < 5000; i++) {
    const v = nextFloat(h);
    assert.ok(v >= 0 && v < 1, `out of range: ${v}`);
    assert.notEqual(h.s, prev);
    prev = h.s;
  }
});

test('makeRng over a shared holder continues the stream (save state = holder.s)', () => {
  const a = { s: 7 };
  const r1 = makeRng(a);
  r1.next();
  r1.next();
  const saved = a.s;
  const third = makeRng(a).next(); // a new wrapper keeps going
  const replay = makeRng({ s: saved }).next();
  assert.equal(third, replay);
  // rngFor(state) uses state.rng
  const state = { rng: { s: 7 } };
  const x = rngFor(state);
  x.next();
  x.next();
  assert.equal(rngFor(state).next(), third);
});

test('seededRng(seed) matches makeRng({ s: seed })', () => {
  assert.deepEqual(seq(seededRng(123456), 20), seq(makeRng({ s: 123456 }), 20));
  // seeds are coerced to uint32
  assert.deepEqual(seq(seededRng(-1), 5), seq(seededRng(0xffffffff), 5));
});

test('int(min, max) is inclusive and never leaves the bounds', () => {
  const r = seededRng(1);
  const seen = new Set();
  for (let i = 0; i < 20000; i++) {
    const v = r.int(3, 7);
    assert.ok(Number.isInteger(v) && v >= 3 && v <= 7, `bad int ${v}`);
    seen.add(v);
  }
  assert.deepEqual([...seen].sort(), [3, 4, 5, 6, 7]);
  for (let i = 0; i < 100; i++) assert.equal(r.int(5, 5), 5);
  for (let i = 0; i < 1000; i++) {
    const v = r.int(-2, 2);
    assert.ok(v >= -2 && v <= 2);
  }
});

test('float(min, max) stays in [min, max)', () => {
  const r = seededRng(2);
  for (let i = 0; i < 5000; i++) {
    const v = r.float(10, 20);
    assert.ok(v >= 10 && v < 20);
  }
});

test('chance(0) never fires, chance(100) always fires, chance(30) ~30%', () => {
  const r = seededRng(3);
  let hits = 0;
  for (let i = 0; i < 10000; i++) {
    assert.equal(r.chance(0), false);
    assert.equal(r.chance(100), true);
    if (r.chance(30)) hits++;
  }
  assert.ok(Math.abs(hits / 10000 - 0.3) < 0.02, `chance(30) gave ${hits / 100}%`);
});

test('weighted never returns a zero (or negative) weight key', () => {
  const r = seededRng(4);
  for (let i = 0; i < 5000; i++) {
    assert.equal(r.weighted({ a: 0, b: 1, c: 0 }), 'b');
    assert.equal(r.weighted({ a: 1, b: 0 }), 'a'); // zero weight in last position
    assert.equal(r.weighted({ a: 0, b: 0, c: 5 }), 'c');
    assert.notEqual(r.weighted({ a: -5, b: 2, c: 2 }), 'a');
  }
});

test('weighted follows the weights', () => {
  const r = seededRng(5);
  const counts = { a: 0, b: 0, c: 0 };
  const N = 40000;
  for (let i = 0; i < N; i++) counts[r.weighted({ a: 0, b: 3, c: 1 })]++;
  assert.equal(counts.a, 0);
  assert.ok(Math.abs(counts.b / N - 0.75) < 0.015, `b=${counts.b / N}`);
  assert.ok(Math.abs(counts.c / N - 0.25) < 0.015, `c=${counts.c / N}`);
});

test('weighted returns null when every weight is zero', () => {
  assert.equal(seededRng(6).weighted({ a: 0, b: 0 }), null);
  assert.equal(seededRng(6).weighted({}), null);
});

test('pick returns members; shuffle is a deterministic permutation', () => {
  const r = seededRng(8);
  const arr = ['x', 'y', 'z'];
  for (let i = 0; i < 300; i++) assert.ok(arr.includes(r.pick(arr)));
  const a = seededRng(9).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  const b = seededRng(9).shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort((p, q) => p - q), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
});

test('mixSeed is deterministic, uint32, and sensitive to every argument and their order', () => {
  const v = mixSeed(1, 2, 3);
  assert.equal(v, mixSeed(1, 2, 3));
  assert.ok(Number.isInteger(v) && v >= 0 && v <= 0xffffffff);
  assert.notEqual(mixSeed(1, 2, 3), mixSeed(3, 2, 1));
  assert.notEqual(mixSeed(1, 2, 3), mixSeed(1, 2, 4));
  assert.notEqual(mixSeed(1, 2), mixSeed(1, 2, 0));
  assert.equal(mixSeed(), 2166136261); // FNV offset basis with no inputs
  const seen = new Set();
  for (let day = 0; day < 500; day++) seen.add(mixSeed(12345, day, 77));
  assert.equal(seen.size, 500, 'collisions across consecutive days');
});
