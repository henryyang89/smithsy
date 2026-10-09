// Fixes from the final review of 2.0: gem tables that rise to S, the walk home from a field with a full pile, plain plurals in
// the search messages, intel after the run is over, saves with a broken shape, the could-break flag in whole numbers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, GRADES } from '../js/config.js';
import { travel, search, setCarry, takeFromPile, travelMinutes, loadOnArrival, key } from '../js/core/map.js';
import { endDay, newGame, serialize, deserialize } from '../js/core/game.js';
import { spendIntel, canSpendIntel } from '../js/core/intel.js';
import { couldBreak, couldBreakShown, worstWear, shownDurability } from '../js/core/gear.js';
import { plural } from '../js/core/util.js';
import { game, standInBlankField, fieldAt, DAY_END, DAY_START, cfgWith, DEADLY_ENEMIES, addGear, cell, idx } from './helpers.mjs';

// ---------------------------------------------------------------- gem tables ----
test('every gem table rises at every grade step on at least one stat and never falls (S beats A: the rarest cut is never worth the same as the one below it)', () => {
  for (const [gem, sides] of Object.entries(CONFIG.gemEffects)) {
    for (const [side, stats] of Object.entries(sides)) {
      const cols = Object.entries(stats);
      for (const [stat, arr] of cols) assert.equal(arr.length, GRADES.length, `${gem} ${side} ${stat} has a value per grade`);
      for (let i = 1; i < GRADES.length; i++) {
        const label = `${gem} ${side}: ${GRADES[i - 1]} -> ${GRADES[i]}`;
        assert.ok(cols.every(([, arr]) => arr[i] >= arr[i - 1]), `${label}: no stat falls`);
        assert.ok(cols.some(([, arr]) => arr[i] > arr[i - 1]), `${label}: some stat rises`);
      }
    }
  }
});

// ---------------------------------------------------------- walk home / piles ----
// A far field holds a full pile from an earlier day. Arriving empty-handed must plan the walk home with that pile, because
// picking it up is free: otherwise arriving at a full pile would buy extra time.
function farFieldWithPile(seed = 4242, n = 20) {
  const s = game(seed);
  const far = s.map.cells.filter((c) => c.type === 'field').sort((a, b) => b.dist - a.dist)[0];
  const f = s.map.fields[key(far.x, far.y)];
  f.pile = Array(n).fill('ore:iron');
  return { s, far, f };
}

test('travel into a field counts the destination pile in the walk home (no arriving empty-handed at a full pile to buy time)', () => {
  const { s, far, f } = farFieldWithPile();
  const there = travelMinutes(s, s.map.camp, far, 0);
  const backEmpty = travelMinutes(s, far, s.map.camp, 0);
  const backFull = travelMinutes(s, far, s.map.camp, CONFIG.bag.slots);
  assert.ok(backFull > backEmpty, 'a full load walks slower');
  assert.equal(loadOnArrival(s, far, 0), Math.min(CONFIG.bag.slots, f.pile.length));
  // exactly enough time for an empty-handed walk there and back: refused, because the pile could be carried home
  s.time = DAY_END - there - backEmpty;
  const r = travel(s, far);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Not enough time/);
  assert.deepEqual(s.location, s.map.camp, 'did not move');
  // enough time for the full-load walk: allowed, and taking the whole pile still gets home by the end of the day
  s.time = DAY_END - there - backFull;
  assert.equal(travel(s, far).ok, true);
  while (s.bag.length < CONFIG.bag.slots && f.pile.length) takeFromPile(s, 0);
  const home = travel(s, s.map.camp);
  assert.equal(home.ok, true);
  assert.ok(s.time <= DAY_END + 1e-6, `home at ${s.time} (day ends ${DAY_END})`);
});

test('a field with an empty pile still counts only what you carry in; a small pile only adds its size', () => {
  const { s, far } = farFieldWithPile(4242, 0);
  const there = travelMinutes(s, s.map.camp, far, 0);
  const backEmpty = travelMinutes(s, far, s.map.camp, 0);
  assert.equal(loadOnArrival(s, far, 0), 0);
  s.time = DAY_END - there - backEmpty;
  assert.equal(travel(s, far).ok, true, 'nothing waiting there: the empty-handed walk is enough');
  const t = farFieldWithPile(4242, 3);
  assert.equal(loadOnArrival(t.s, t.far, 2), 5, 'carried plus pile');
  assert.equal(loadOnArrival(t.s, t.far, CONFIG.bag.slots), CONFIG.bag.slots, 'never more than the bag holds');
});

test('travelling between fields plans the walk home with what you carry plus the next field\'s pile', () => {
  const { s, far, f } = farFieldWithPile(77, 12);
  // stand in another field with a few items, then move on to the far one
  const near = s.map.cells.find((c) => c.type === 'field' && c.dist === 1);
  s.location = { x: near.x, y: near.y };
  const nf = s.map.fields[key(near.x, near.y)];
  nf.pile = ['ore:copper', 'ore:copper'];
  const carry = { bag: [], pile: [0, 1] };
  const there = travelMinutes(s, near, far, 2);
  const backWith = travelMinutes(s, far, s.map.camp, loadOnArrival(s, far, 2));
  assert.equal(loadOnArrival(s, far, 2), 14);
  s.time = DAY_END - there - backWith + 0.5; // just short of the walk with the pile, enough for the walk with only 2 items
  const r = travel(s, far, CONFIG, carry);
  assert.equal(r.ok, false);
  assert.deepEqual(s.location, { x: near.x, y: near.y });
  assert.equal(nf.pile.length, 2, 'a refused trip changes nothing');
  assert.ok(f.pile.length === 12);
});

// -------------------------------------------------------------- plain plurals ----
test('plural: a count with its noun', () => {
  assert.equal(plural(0, 'item'), '0 items');
  assert.equal(plural(1, 'cell'), '1 cell');
  assert.equal(plural(2, 'cell'), '2 cells');
});

test('search and carry messages use real plurals, say "found nothing", and show whole debris numbers', () => {
  const s = game(21);
  const f = standInBlankField(s, 1);
  const r = search(s, 4, 4);
  assert.equal(r.ok, true, r.msg);
  assert.match(r.msg, /^Searched 9 cells \(/);
  assert.match(r.msg, /found nothing\./);
  assert.doesNotMatch(r.msg, /\(s\)|found 0 item/);
  // one item found, one boulder skipped, one cell cleared of 10.6 debris
  const g = standInBlankField(s, 1);
  g.cells[idx(4, 4)] = cell([{ t: 'ore:iron', d: 1 }], { debris: 0 });
  g.cells[idx(3, 3)] = cell([], { boulder: true });
  g.cells[idx(5, 5)] = cell([], { debris: 1.4 });
  s.time = DAY_START;
  const r2 = search(s, 4, 4);
  assert.equal(r2.ok, true, r2.msg);
  assert.match(r2.msg, /Searched 8 cells/);
  assert.match(r2.msg, /found 1 item, now in this field's pile\./);
  assert.match(r2.msg, /Cleared 1 debris \(1 cell now clear\)\./);
  assert.match(r2.msg, /1 cell skipped \(done or boulder\)\./);
  assert.doesNotMatch(r2.msg, /\(s\)/);
  g.pile = ['ore:copper'];
  s.bag = [];
  assert.match(setCarry(s, { bag: [], pile: [0] }).msg, /^Carrying 1 item; 0 left/);
  assert.equal(f.pile.length, 0 + f.pile.length);
});

// ---------------------------------------------------------------- intel ----
test('intel: a point cannot be spent after the run is over, and a lost fight on an intel day does not award one', () => {
  const cfg = cfgWith(DEADLY_ENEMIES);
  const s = newGame(5, cfg);
  s.day = cfg.intel.daysPerPoint; // an intel day
  s.plan = { day: s.day, enemy: s.roster.enemies[0], gearIds: [], ringIds: [], shownEstimate: null };
  const r = endDay(s, cfg);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.phase, 'over');
  assert.equal(s.intel.points, 0, 'no point for a day that ended the run');
  // a point left unspent when the player retires cannot be spent afterwards either
  s.intel.points = 1;
  assert.equal(canSpendIntel(s, cfg), false);
  const track = Object.keys(cfg.intel.tracks)[0];
  const spent = spendIntel(s, track, cfg);
  assert.equal(spent.ok, false);
  assert.match(spent.msg, /run is over/i);
  assert.equal(s.intel.points, 1);
  assert.equal(s.intel.spent[track], 0);
});

test('intel: a day the adventurer lives through still awards the point', () => {
  const s = newGame(6);
  s.day = CONFIG.intel.daysPerPoint;
  s.plan = null; // nobody fights today
  endDay(s);
  assert.equal(s.intel.points, 1);
  assert.equal(canSpendIntel(s), true);
});

// ------------------------------------------------------------ broken saves ----
test('deserialize refuses a same-version save with a broken shape (instead of loading a blank page)', () => {
  const s = newGame(8);
  const text = serialize(s);
  assert.doesNotThrow(() => deserialize(text));
  const broken = {
    'no roster': (x) => { x.roster = null; },
    'no enemies in the roster': (x) => { x.roster.enemies = []; },
    'no gear list': (x) => { delete x.gear; },
    'no rings list': (x) => { x.rings = 'none'; },
    'gear without a slot': (x) => { x.gear = [{ id: 1, durability: 50 }]; },
    'no random state': (x) => { delete x.rng; },
    'no map': (x) => { x.map = null; },
    'map without cells': (x) => { x.map.cells = []; },
    'no location': (x) => { x.location = null; },
    'no storage bars': (x) => { delete x.storage.bars; },
    'unknown phase': (x) => { x.phase = 'lunch'; },
    'report phase without a report': (x) => { x.phase = 'report'; x.report = null; },
    'over without an end': (x) => { x.phase = 'over'; x.end = null; },
    'no stats': (x) => { x.stats = null; },
    'fight plan without an enemy': (x) => { x.plan = { gearIds: [], ringIds: [] }; },
    'no id counter': (x) => { delete x.nextId; },
    'no log': (x) => { x.log = null; },
  };
  for (const [why, mutate] of Object.entries(broken)) {
    const copy = JSON.parse(text);
    mutate(copy);
    assert.throws(() => deserialize(JSON.stringify(copy)), /Save/, why);
  }
});

// ------------------------------------------------------------ could break ----
test('couldBreakShown flags what the whole numbers on screen say: durability shown <= the worst wear shown (rounded up)', () => {
  const s = game(1);
  const at = (d) => ({ slot: 'sword', material: 'iron', grade: 'C', gem: null, durability: d });
  // elite worst wear 13.2 -> "up to 14%"; champion 14.4 -> "up to 15%"
  assert.equal(worstWear(s, 'elite'), 13.2);
  for (const d of [13.2, 13.5, 13.9, 14.0, 14.9]) assert.equal(couldBreakShown(at(d), s, 'elite'), true, `elite ${d} shows ${shownDurability(d)}%`);
  for (const d of [15, 15.5, 100]) assert.equal(couldBreakShown(at(d), s, 'elite'), false, `elite ${d}`);
  for (const d of [14.4, 14.5, 15, 15.9]) assert.equal(couldBreakShown(at(d), s, 'champion'), true, `champion ${d}`);
  assert.equal(couldBreakShown(at(16), s, 'champion'), false);
  // never misses an item that really could break
  for (const tier of [null, 'normal', 'elite', 'champion']) {
    for (let tenths = 1; tenths <= 1000; tenths += 3) {
      const item = at(tenths / 10);
      if (couldBreak(item, s, tier)) assert.equal(couldBreakShown(item, s, tier), true, `${tier} ${tenths / 10}`);
    }
  }
});
