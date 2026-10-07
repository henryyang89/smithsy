// Rules added after the review pass: leaving items behind cannot beat the walk-home rule (v1.1: the
// projected load), free late swaps, taking a single pile item, smith ring lock, ore sight only on
// unfinished cells, duration formatting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { moveToPile, takeFromPile, setCarry, search, returnMinutes, projectedLoad, currentField } from '../js/core/map.js';
import { toggleRing, smithRingLock } from '../js/core/rings.js';
import { formatDuration } from '../js/core/util.js';
import { endDay } from '../js/core/game.js';
import { game, standInBlankField, addRing, cfgWith } from './helpers.mjs';

const DAY_END = CONFIG.time.dayEndMin;
const SLOTS = CONFIG.bag.slots;

test('leaving the load in the pile cannot be used to search late and then carry everything home in time', () => {
  const s = game(1);
  const field = standInBlankField(s, 4);
  s.bag = Array(SLOTS).fill('ore:copper');
  // find a time where a search is refused with a full load but would fit with an empty one
  const full = returnMinutes(s, s.location, SLOTS);
  const empty = returnMinutes(s, s.location, 0);
  assert.ok(full > empty);
  s.time = DAY_END - CONFIG.field.searchMin - (full + empty) / 2;
  assert.equal(search(s, 2, 2).ok, false);
  while (s.bag.length) moveToPile(s, 0);
  assert.equal(field.pile.length, SLOTS);
  assert.equal(projectedLoad(s), SLOTS, 'the pile still counts as load you could carry');
  assert.equal(search(s, 2, 2).ok, false, 'dropping everything does not buy time');
  assert.equal(setCarry(s, { bag: [], pile: [] }).ok, true);
  assert.equal(search(s, 2, 2).ok, false, 'neither does an empty carry choice');
});

test('a late swap (leave one, take one) is free at any hour, up to the bag size', () => {
  const s = game(2);
  standInBlankField(s, 4);
  const f = currentField(s);
  s.bag = Array(10).fill('ore:copper');
  f.pile.push('ore:mythril');
  s.time = DAY_END - 1; // the walk home already ends after day end
  assert.equal(moveToPile(s, 0).ok, true);
  const r = takeFromPile(s, f.pile.indexOf('ore:mythril'));
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.bag.length, 10);
  assert.ok(s.bag.includes('ore:mythril'));
  assert.equal(s.time, DAY_END - 1, 'free');
  // filling the bag late is allowed too (the pile already counted toward the projected load)
  f.pile.push(...Array(SLOTS).fill('ore:iron'));
  while (s.bag.length < SLOTS) assert.equal(takeFromPile(s, f.pile.length - 1).ok, true);
  assert.equal(takeFromPile(s, 0).ok, false, 'never past the bag size');
});

test('takeFromPile takes exactly the chosen item', () => {
  const s = game(3);
  const field = standInBlankField(s, 1);
  field.pile.push('ore:copper', 'gem:diamond', 'ore:iron');
  const r = takeFromPile(s, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(s.bag, ['gem:diamond']);
  assert.deepEqual(field.pile, ['ore:copper', 'ore:iron']);
  assert.equal(takeFromPile(s, 5).ok, false);
});

test('smith rings lock once the work day has started; adventurer rings do not', () => {
  const s = game(4);
  const smith = addRing(s, 'travelTime', 'D');
  const adv = addRing(s, 'health', 'D');
  assert.equal(smithRingLock(s), null); // 8:00 at camp
  assert.equal(toggleRing(s, smith.id).ok, true);
  s.time += 1;
  assert.ok(smithRingLock(s));
  assert.equal(toggleRing(s, smith.id).ok, false);
  assert.equal(smith.worn, true);
  assert.equal(toggleRing(s, adv.id).ok, true);
  // unlocked again while planning at night
  endDay(s);
  assert.equal(s.phase, 'plan');
  assert.equal(toggleRing(s, smith.id).ok, true);
  assert.equal(smith.worn, false);
});

test('ore sight never rolls on a cell the same search finishes', () => {
  // randomness 0: efficiency 100 finishes every cell in one search
  const cfg = cfgWith({ field: { searchEfficiency: 100, searchRandomness: 0 } }, { intel: { tracks: { oreSight: { base: 100 } } } });
  const s = game(5, cfg);
  const field = standInBlankField(s, 1, cfg);
  const r = search(s, 3, 3, cfg);
  assert.equal(r.ok, true);
  assert.equal(r.revealed, 0);
  for (const cl of field.cells) assert.equal(cl.revealed, false);
});

test('ore sight with random search rolls: finished cells are never revealed, unfinished ones roll as usual', () => {
  // efficiency 100 +/- 10: some cells roll 100 (finished), others 90..100 (not finished)
  const cfg = cfgWith({ field: { searchEfficiency: 100, searchRandomness: 10 } }, { intel: { tracks: { oreSight: { base: 100 } } } });
  const s = game(5, cfg);
  const field = standInBlankField(s, 1, cfg);
  let finished = 0;
  let open = 0;
  for (const [x, y] of [[1, 1], [4, 1], [1, 4], [4, 4], [1, 7], [4, 7]]) {
    s.time = CONFIG.time.dayStartMin;
    const r = search(s, x, y, cfg);
    assert.equal(r.ok, true, r.msg);
  }
  for (const cl of field.cells) {
    if (cl.searched === 0) continue;
    if (cl.searched >= 100) {
      finished++;
      assert.equal(cl.revealed, false, 'finished cell revealed');
    } else {
      open++;
      assert.equal(cl.revealed, true, 'unfinished cell not revealed at 100% ore sight');
    }
  }
  assert.ok(finished > 0 && open > 0, `both kinds of cells occur (${finished} finished, ${open} open)`);
});

test('formatDuration rounds before splitting hours', () => {
  assert.equal(formatDuration(119.96), '2h');
  assert.equal(formatDuration(59.96), '1h');
  assert.equal(formatDuration(239.9999999), '4h');
  assert.equal(formatDuration(85), '1h 25m');
  assert.equal(formatDuration(12.5), '12.5m');
});
