// Rules added after the review pass: time-limited free pick-ups, picking a single ground item,
// smith ring lock, ore sight only on unfinished cells, duration formatting.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { pickUp, dropItem, search, pickUpLimit, returnMinutes } from '../js/core/map.js';
import { toggleRing, smithRingLock } from '../js/core/rings.js';
import { formatDuration } from '../js/core/util.js';
import { endDay } from '../js/core/game.js';
import { game, standInBlankField, idx, addRing, cfgWith } from './helpers.mjs';

const DAY_END = CONFIG.time.dayEndMin;

test('dropping the bag cannot be used to search late and then pick everything back up', () => {
  const s = game(1);
  const field = standInBlankField(s, 4);
  const c = idx(2, 2);
  // late in the day with a full bag of copper
  s.bag = Array(CONFIG.bag.slots).fill('ore:copper');
  s.loadMark = s.bag.length;
  // find a time where a search is refused with the full bag but allowed with an empty one
  const full = returnMinutes(s, s.location, CONFIG.bag.slots);
  const empty = returnMinutes(s, s.location, 0);
  s.time = DAY_END - CONFIG.field.searchMin - (full + empty) / 2;
  assert.equal(search(s, 2, 2).ok, false);
  while (s.bag.length) dropItem(s, 0, c);
  assert.equal(search(s, 2, 2).ok, true);
  // after the search the walk home must still end by day end
  const limit = pickUpLimit(s);
  assert.ok(limit < CONFIG.bag.slots);
  pickUp(s, c);
  assert.equal(s.bag.length, limit);
  assert.ok(s.time + returnMinutes(s) <= DAY_END + 1e-9);
  assert.equal(pickUp(s, c).ok, false);
  assert.ok(field.cells[c].ground.length > 0);
});

test('a late swap (drop one, pick one) is still allowed up to the bag size of the last timed action', () => {
  const s = game(2);
  standInBlankField(s, 4);
  const c = idx(1, 1);
  s.bag = Array(10).fill('ore:copper');
  s.loadMark = 10;
  s.time = DAY_END - 1; // the walk home already ends after day end
  s.map.fields[`${s.location.x},${s.location.y}`].cells[c].ground.push('ore:mythril');
  dropItem(s, 0, c);
  const r = pickUp(s, c, CONFIG, s.map.fields[`${s.location.x},${s.location.y}`].cells[c].ground.indexOf('ore:mythril'));
  assert.equal(r.ok, true);
  assert.equal(s.bag.length, 10);
  assert.ok(s.bag.includes('ore:mythril'));
  assert.equal(pickUp(s, c).ok, false); // cannot exceed the mark late in the day
});

test('pickUp with groundIndex takes exactly that item', () => {
  const s = game(3);
  const field = standInBlankField(s, 1);
  const c = idx(0, 0);
  field.cells[c].ground.push('ore:copper', 'gem:diamond', 'ore:iron');
  const r = pickUp(s, c, CONFIG, 1);
  assert.equal(r.ok, true);
  assert.deepEqual(s.bag, ['gem:diamond']);
  assert.deepEqual(field.cells[c].ground, ['ore:copper', 'ore:iron']);
  assert.equal(pickUp(s, c, CONFIG, 5).ok, false);
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
