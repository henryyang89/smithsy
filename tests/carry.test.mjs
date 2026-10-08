// Field piles and the carry choice (v1.1): found items go to the field's pile; you choose what to carry
// (up to the bag size) when you leave. Arriving at camp unloads only what you carry.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES } from '../js/config.js';
import {
  setCarry, defaultCarry, moveToPile, takeFromPile, travel, search, projectedLoad, fitsWithReturn, returnMinutes,
  travelMinutes, searchMinutes, currentField, atCamp, key,
} from '../js/core/map.js';
import { endDay, confirmPlan, serialize, deserialize } from '../js/core/game.js';
import { game, cfgWith, customMap, blankField, cell, idx, fieldAt, fieldOf, DAY_START, DAY_END } from './helpers.mjs';

// Pinned numbers: the hand-computed minutes below hold whatever CONFIG says.
const CFG = cfgWith({
  map: { size: 5, travelMinPerStep: 20, loadPenaltyPerItem: 1 }, // a small hand-built map (camp at 2,2) whatever the game's map size is
  bag: { slots: 20 },
  field: { size: 8, searchMin: 30, freshCellMin: 0, searchEfficiency: 25, searchRandomness: 0 }, // freshCellMin 0: these tests are about the base search time
  processing: { maxTimeReduction: 75 },
});
const SLOTS = CFG.bag.slots;
const NEAR = { x: 2, y: 3 }; // distance 1 (camp is at 2,2; a wall above it)
const FAR = { x: 2, y: 4 }; // distance 2

// Game on a hand-built map (wall above the camp), smith at camp.
function travelState() {
  const s = game(1);
  s.map = customMap([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], CFG);
  s.location = { ...s.map.camp };
  return s;
}

// Blank field at `at` with the given pile; the smith stands there.
function inField(s, at, pile = []) {
  const f = blankField(s.map.cells.find((c) => c.x === at.x && c.y === at.y).dist, CFG);
  f.pile = [...pile];
  s.map.fields[key(at.x, at.y)] = f;
  s.location = { ...at };
  return f;
}

const sorted = (a) => [...a].sort();
const fill = (n, t = 'ore:copper') => Array(n).fill(t);

// -------------------------------------------------------------- setCarry ----
test('setCarry: carry the chosen bag and pile items; everything else goes to this field\'s pile (free)', () => {
  const s = travelState();
  const f = inField(s, FAR, ['ore:mythril', 'ore:coal', 'gem:diamond']);
  s.bag = ['ore:copper', 'gem:ruby', 'ore:iron'];
  s.time = DAY_START + 100;
  const r = setCarry(s, { bag: [0, 2], pile: [2, 0] }, CFG);
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(sorted(s.bag), sorted(['ore:copper', 'ore:iron', 'gem:diamond', 'ore:mythril']));
  assert.deepEqual(sorted(f.pile), sorted(['ore:coal', 'gem:ruby']));
  assert.equal(s.time, DAY_START + 100, 'free');
  assert.match(r.msg, /Carrying 4 item\(s\); 2 left/);
  // carry nothing: everything ends up in the pile
  assert.equal(setCarry(s, { bag: [], pile: [] }, CFG).ok, true);
  assert.deepEqual(s.bag, []);
  assert.equal(f.pile.length, 6);
  // carry everything back
  assert.equal(setCarry(s, { pile: f.pile.map((_, i) => i) }, CFG).ok, true);
  assert.equal(s.bag.length, 6);
  assert.deepEqual(f.pile, []);
});

test('setCarry: at most bag.slots items; more is refused and nothing moves', () => {
  const s = travelState();
  const f = inField(s, NEAR, fill(SLOTS + 5, 'ore:iron'));
  const all = f.pile.map((_, i) => i);
  const r = setCarry(s, { bag: [], pile: all }, CFG);
  assert.equal(r.ok, false);
  assert.match(r.msg, new RegExp(`at most ${SLOTS}`));
  assert.deepEqual(s.bag, []);
  assert.equal(f.pile.length, SLOTS + 5);
  assert.equal(setCarry(s, { pile: all.slice(0, SLOTS) }, CFG).ok, true);
  assert.equal(s.bag.length, SLOTS);
  assert.equal(f.pile.length, 5);
  // full bag + one more from the pile is too many
  const over = setCarry(s, { bag: s.bag.map((_, i) => i), pile: [0] }, CFG);
  assert.equal(over.ok, false);
  assert.equal(s.bag.length, SLOTS);
  // a swap within the limit is fine
  assert.equal(setCarry(s, { bag: s.bag.map((_, i) => i).slice(1), pile: [0] }, CFG).ok, true);
  assert.equal(s.bag.length, SLOTS);
  assert.equal(f.pile.length, 5);
  // the limit is the configured bag size
  const small = cfgWith(CFG, { bag: { slots: 3 } });
  assert.equal(setCarry(s, { bag: [0, 1, 2, 3] }, small).ok, false);
  assert.equal(setCarry(s, { bag: [0, 1, 2] }, small).ok, true);
  assert.equal(s.bag.length, 3);
});

test('setCarry ignores invalid and repeated indexes; a missing list means "none from there"', () => {
  const s = travelState();
  const f = inField(s, NEAR, ['gem:topaz', 'ore:coal']);
  s.bag = ['ore:copper', 'ore:iron'];
  assert.equal(setCarry(s, { bag: [0, 0, 5, -1, 0.5], pile: [1, 1, 99] }, CFG).ok, true);
  assert.deepEqual(sorted(s.bag), sorted(['ore:copper', 'ore:coal']));
  assert.deepEqual(sorted(f.pile), sorted(['gem:topaz', 'ore:iron']));
  assert.equal(setCarry(s, { pile: [0] }, CFG).ok, true, 'no bag list: bag items go to the pile');
  assert.equal(s.bag.length, 1);
  assert.equal(f.pile.length, 3);
  assert.equal(s.bag.length + f.pile.length, 4, 'nothing lost or duplicated');
});

test('setCarry with items carried in from another field: unchosen ones stay in this field\'s pile', () => {
  const s = travelState();
  const a = inField(s, NEAR, ['ore:mythril', 'ore:copper']);
  const b = blankField(2, CFG);
  b.pile = ['gem:topaz'];
  s.map.fields[key(FAR.x, FAR.y)] = b;
  const r = travel(s, FAR, CFG, { bag: [], pile: [0] }); // bring the mythril along
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(s.bag, ['ore:mythril']);
  assert.deepEqual(a.pile, ['ore:copper'], 'the rest stays where it was found');
  assert.equal(currentField(s), b);
  assert.equal(projectedLoad(s, CFG), 2, 'carried-in item + this pile');
  // at B: carry the topaz, leave the mythril here
  assert.equal(setCarry(s, { bag: [], pile: [0] }, CFG).ok, true);
  assert.deepEqual(s.bag, ['gem:topaz']);
  assert.deepEqual(b.pile, ['ore:mythril']);
  assert.deepEqual(a.pile, ['ore:copper'], 'the first field is not touched');
});

test('carry actions are refused at camp and outside the work phase (nothing moves)', () => {
  const s = travelState();
  assert.equal(atCamp(s), true);
  for (const r of [setCarry(s, { bag: [], pile: [] }, CFG), moveToPile(s, 0, CFG), takeFromPile(s, 0, CFG)]) {
    assert.equal(r.ok, false);
    assert.match(r.msg, /camp/);
  }
  const f = inField(s, NEAR, ['gem:ruby']);
  s.bag = ['ore:copper'];
  for (const phase of ['report', 'plan', 'over']) {
    s.phase = phase;
    for (const r of [setCarry(s, { bag: [], pile: [0] }, CFG), moveToPile(s, 0, CFG), takeFromPile(s, 0, CFG)]) {
      assert.equal(r.ok, false, phase);
      assert.match(r.msg, /work day/);
    }
    assert.deepEqual(s.bag, ['ore:copper']);
    assert.deepEqual(f.pile, ['gem:ruby']);
  }
});

// ----------------------------------------------------------- defaultCarry ----
test('defaultCarry keeps the whole bag and fills the free slots with the rarest pile items', () => {
  const s = travelState();
  const pile = ['ore:copper', 'ore:iron', 'gem:ruby', 'ore:mythril', 'ore:coal', 'gem:diamond', 'ore:mythril'];
  const f = inField(s, FAR, pile);
  s.bag = fill(SLOTS - 3);
  const before = structuredClone({ bag: s.bag, pile: f.pile });
  const sel = defaultCarry(s, CFG);
  assert.deepEqual(sel.bag, s.bag.map((_, i) => i), 'keeps every bag item');
  assert.deepEqual(sorted(sel.pile.map((i) => pile[i])), sorted(['ore:mythril', 'ore:mythril', 'gem:diamond']));
  assert.deepEqual({ bag: s.bag, pile: f.pile }, before, 'defaultCarry only suggests');
  // applied: the bag is kept and the picks are added
  assert.equal(setCarry(s, sel, CFG).ok, true);
  assert.equal(s.bag.length, SLOTS);
  assert.equal(s.bag.filter((t) => t === 'ore:copper').length, SLOTS - 3);
  assert.deepEqual(sorted(f.pile), sorted(['ore:copper', 'ore:iron', 'gem:ruby', 'ore:coal']));
});

test('defaultCarry order: mythril, then gems, then rarer ores before commoner ones; ties keep pile order', () => {
  const s = travelState();
  const pile = ['ore:copper', 'ore:iron', 'ore:coal', 'gem:ruby', 'ore:mythril', 'ore:copper'];
  inField(s, NEAR, pile);
  const pick = (free) => {
    s.bag = fill(SLOTS - free, 'ore:iron');
    return defaultCarry(s, CFG).pile;
  };
  assert.deepEqual(pick(0), [], 'bag full: nothing from the pile');
  assert.deepEqual(pick(1).map((i) => pile[i]), ['ore:mythril']);
  assert.deepEqual(pick(2).map((i) => pile[i]), ['ore:mythril', 'gem:ruby']);
  // the remaining ores go rarest first (ORES lists them in increasing rarity)
  const oreOrder = [...ORES].reverse().filter((o) => o !== 'mythril').map((o) => `ore:${o}`);
  const rest = pick(6).slice(2).map((i) => pile[i]);
  assert.deepEqual(rest, oreOrder.flatMap((t) => pile.filter((p) => p === t)));
  // equal items: the earlier pile item first
  assert.deepEqual(pick(6).slice(-2), [0, 5]);
  // every gem beats every non-mythril ore
  inField(s, NEAR, ['ore:coal', 'gem:topaz', 'ore:iron', 'gem:emerald']);
  s.bag = fill(SLOTS - 2);
  assert.deepEqual(sorted(defaultCarry(s, CFG).pile), [1, 3]);
});

test('defaultCarry: everything when it fits; at camp only the bag', () => {
  const s = travelState();
  const f = inField(s, NEAR, ['ore:iron', 'gem:topaz']);
  s.bag = ['ore:coal'];
  const sel = defaultCarry(s, CFG);
  assert.deepEqual(sel.bag, [0]);
  assert.deepEqual(sorted(sel.pile), [0, 1]);
  assert.equal(setCarry(s, defaultCarry(s, CFG), CFG).ok, true);
  assert.equal(s.bag.length, 3);
  assert.deepEqual(f.pile, []);
  s.location = { ...s.map.camp };
  s.bag = [];
  assert.deepEqual(defaultCarry(s, CFG), { bag: [], pile: [] });
});

// --------------------------------------------------- moveToPile / takeFromPile ----
test('moveToPile / takeFromPile move exactly one item, for free; take needs a free slot', () => {
  const s = travelState();
  const f = inField(s, NEAR, ['ore:iron']);
  s.bag = ['ore:copper', 'gem:ruby', 'ore:coal'];
  s.time = DAY_END + 30; // free actions work at any hour
  const m = moveToPile(s, 1, CFG);
  assert.equal(m.ok, true, m.msg);
  assert.deepEqual(s.bag, ['ore:copper', 'ore:coal']);
  assert.deepEqual(f.pile, ['ore:iron', 'gem:ruby']);
  const t = takeFromPile(s, 0, CFG);
  assert.equal(t.ok, true, t.msg);
  assert.deepEqual(s.bag, ['ore:copper', 'ore:coal', 'ore:iron']);
  assert.deepEqual(f.pile, ['gem:ruby']);
  assert.equal(s.time, DAY_END + 30);
  for (const bad of [-1, 3, 99]) assert.equal(moveToPile(s, bad, CFG).ok, false);
  for (const bad of [-1, 1, 99]) assert.equal(takeFromPile(s, bad, CFG).ok, false);
  s.bag = fill(SLOTS);
  const full = takeFromPile(s, 0, CFG);
  assert.equal(full.ok, false);
  assert.match(full.msg, /full/);
  assert.deepEqual(f.pile, ['gem:ruby']);
});

// ------------------------------------------------------------------ travel ----
test('travel with a carry selection takes exactly that; travel time uses the carried count', () => {
  const s = travelState();
  const f = inField(s, FAR, ['ore:mythril', 'ore:coal', 'gem:ruby', ...fill(10, 'ore:iron')]);
  s.bag = ['ore:copper', 'ore:copper'];
  const carry = { bag: [0], pile: [0, 2] }; // 1 copper, mythril, ruby
  const r = travel(s, s.map.camp, CFG, carry);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, travelMinutes(s, FAR, s.map.camp, 3, CFG));
  assert.equal(r.minutes, 41.2); // 2 steps x 20 x 1.03
  assert.match(r.msg, /Unloaded 3 items/);
  assert.deepEqual(s.bag, []);
  assert.equal(s.storage.ore.copper, 1);
  assert.equal(s.storage.ore.mythril, 1);
  assert.equal(s.storage.gem.ruby, 1);
  assert.equal(s.storage.ore.iron, 0);
  assert.deepEqual(sorted(f.pile), sorted(['ore:copper', 'ore:coal', ...fill(10, 'ore:iron')]), 'the rest stays in the field');
});

test('travel without a carry takes the current bag; arriving at camp unloads only the bag', () => {
  const s = travelState();
  const f = inField(s, NEAR, ['gem:diamond', 'ore:iron']);
  s.bag = ['ore:copper'];
  const r = travel(s, s.map.camp, CFG);
  assert.equal(r.ok, true);
  assert.equal(r.minutes, travelMinutes(s, NEAR, s.map.camp, 1, CFG));
  assert.equal(s.storage.ore.copper, 1);
  assert.equal(s.storage.gem.diamond, 0);
  assert.deepEqual(f.pile, ['gem:diamond', 'ore:iron'], 'the pile stays in the field');
});

test('travel with a carry over the bag size is refused and nothing changes', () => {
  const s = travelState();
  const f = inField(s, NEAR, fill(SLOTS + 1, 'ore:iron'));
  const r = travel(s, s.map.camp, CFG, { bag: [], pile: f.pile.map((_, i) => i) });
  assert.equal(r.ok, false);
  assert.match(r.msg, /at most/);
  assert.deepEqual(s.location, NEAR);
  assert.equal(s.time, DAY_START);
  assert.deepEqual(s.bag, []);
  assert.equal(f.pile.length, SLOTS + 1);
});

test('field-to-field travel checks the way back with the carried count; a refusal moves nothing', () => {
  const s = travelState();
  const f = inField(s, NEAR, fill(SLOTS, 'ore:copper'));
  const all = { bag: [], pile: f.pile.map((_, i) => i) };
  // to FAR carrying 20: 24 there + 48 back = 72; carrying nothing: 20 + 40 = 60
  s.time = DAY_END - 65;
  const r = travel(s, FAR, CFG, all);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Not enough time/);
  assert.equal(f.pile.length, SLOTS);
  assert.deepEqual(s.bag, []);
  assert.equal(travel(s, FAR, CFG, { bag: [], pile: [] }).ok, true, 'leaving the load behind fits');
  assert.equal(s.time, DAY_END - 45);
  assert.equal(f.pile.length, SLOTS);
});

test('travel: a partial carry works, repeated indexes do not add travel time, a carry passed at camp is ignored', () => {
  const s = travelState();
  const f = inField(s, FAR, ['ore:iron', 'ore:coal']);
  s.bag = ['ore:copper'];
  const r = travel(s, s.map.camp, CFG, { pile: [1, 1, 1, 7] });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, travelMinutes(s, FAR, s.map.camp, 1, CFG), 'one item carried');
  assert.equal(s.storage.ore.coal, 1);
  assert.equal(s.storage.ore.copper, 0);
  assert.deepEqual(sorted(f.pile), ['ore:copper', 'ore:iron']);
  // from camp (bag already unloaded) any carry selection is ignored
  const out = travel(s, NEAR, CFG, { bag: [], pile: [] });
  assert.equal(out.ok, true, out.msg);
  assert.deepEqual(s.location, NEAR);
  assert.equal(out.minutes, travelMinutes(s, s.map.camp, NEAR, 0, CFG));
});

test('the pile stays in its field across days and through save/load', () => {
  const s = game(8);
  const c = fieldAt(s, 1);
  assert.equal(travel(s, { x: c.x, y: c.y }).ok, true);
  const f = currentField(s);
  assert.deepEqual(f.pile, []);
  f.pile.push('ore:mythril', 'gem:emerald', 'ore:coal');
  assert.equal(travel(s, s.map.camp, CONFIG, { bag: [], pile: [1] }).ok, true);
  assert.equal(s.storage.gem.emerald, 1);
  assert.deepEqual(fieldOf(s, c).pile, ['ore:mythril', 'ore:coal']);
  assert.equal(endDay(s).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }).ok, true);
  assert.equal(s.day, 2);
  assert.deepEqual(fieldOf(s, c).pile, ['ore:mythril', 'ore:coal'], 'overnight');
  const back = deserialize(serialize(s));
  assert.deepEqual(fieldOf(back, c).pile, ['ore:mythril', 'ore:coal'], 'after save/load');
  assert.equal(travel(back, { x: c.x, y: c.y }).ok, true);
  assert.equal(takeFromPile(back, 0).ok, true);
  assert.deepEqual(back.bag, ['ore:mythril']);
  assert.equal(travel(back, back.map.camp).ok, true);
  assert.equal(back.storage.ore.mythril, 1);
  assert.deepEqual(fieldOf(back, c).pile, ['ore:coal']);
});

// ------------------------------------------------------------- time checks ----
test('projectedLoad = min(bag slots, bag + this field\'s pile); at camp just the bag', () => {
  const s = travelState();
  assert.equal(projectedLoad(s, CFG), 0);
  const f = inField(s, NEAR, fill(5, 'ore:iron'));
  s.bag = fill(3);
  assert.equal(projectedLoad(s, CFG), 8);
  // moving items between bag and pile does not change it
  moveToPile(s, 0, CFG);
  assert.equal(projectedLoad(s, CFG), 8);
  setCarry(s, { bag: [], pile: [] }, CFG);
  assert.equal(projectedLoad(s, CFG), 8);
  f.pile.push(...fill(30));
  assert.equal(projectedLoad(s, CFG), SLOTS, 'capped at the bag size');
  assert.equal(projectedLoad(s, cfgWith(CFG, { bag: { slots: 4 } })), 4);
});

test('search time check uses the projected load: dropping items into the pile does not buy time', () => {
  const s = travelState();
  inField(s, FAR);
  const S = searchMinutes(s, CFG); // 30
  const back0 = returnMinutes(s, FAR, 0, CFG); // 40
  const backFull = returnMinutes(s, FAR, SLOTS, CFG); // 48
  assert.ok(backFull > back0);
  s.bag = fill(SLOTS);
  s.time = DAY_END - S - (back0 + backFull) / 2;
  assert.equal(fitsWithReturn(s, S, CFG), false);
  assert.equal(search(s, 2, 2, CFG).ok, false);
  while (s.bag.length) moveToPile(s, 0, CFG);
  assert.equal(projectedLoad(s, CFG), SLOTS);
  const r = search(s, 2, 2, CFG);
  assert.equal(r.ok, false, 'leaving the load in the pile does not help');
  assert.match(r.msg, /Not enough time/);
  // the exact fit with a full load is allowed
  s.time = DAY_END - S - backFull;
  assert.equal(fitsWithReturn(s, S, CFG), true);
  assert.equal(search(s, 2, 2, CFG).ok, true);
});

test('search time check: found items in the pile count like a full bag; an empty field and bag use the empty walk', () => {
  const s = travelState();
  const f = inField(s, FAR, fill(SLOTS, 'gem:ruby'));
  const S = searchMinutes(s, CFG);
  const back0 = returnMinutes(s, FAR, 0, CFG);
  const backFull = returnMinutes(s, FAR, SLOTS, CFG);
  s.time = DAY_END - S - back0;
  assert.deepEqual(s.bag, []);
  assert.equal(search(s, 2, 2, CFG).ok, false, 'pile of 20: as if carrying 20');
  f.pile = [];
  assert.equal(search(s, 2, 2, CFG).ok, true, 'nothing to carry: the empty walk home');
  // fitsWithReturn = time + minutes + walk home with the projected load <= day end
  f.pile = fill(7);
  for (const t of [DAY_START, DAY_END - 100, DAY_END - 60]) {
    s.time = t;
    assert.equal(fitsWithReturn(s, S, CFG), t + S + returnMinutes(s, FAR, 7, CFG) <= DAY_END + 1e-9);
  }
  assert.ok(backFull > returnMinutes(s, FAR, 7, CFG));
});

test('found items join the pile (and the projected load) right away', () => {
  const s = travelState();
  const f = inField(s, NEAR);
  f.cells[idx(2, 2, CFG)] = cell([{ t: 'ore:iron', d: 1 }, { t: 'gem:ruby', d: 2 }]);
  s.bag = ['ore:copper'];
  assert.equal(projectedLoad(s, CFG), 1);
  const r = search(s, 2, 2, CFG);
  assert.equal(r.ok, true, r.msg);
  assert.deepEqual(f.pile, ['ore:iron', 'gem:ruby']);
  assert.deepEqual(s.bag, ['ore:copper']);
  assert.equal(projectedLoad(s, CFG), 3);
});
