// Randomized playthroughs: drive the core with a mix of legal and illegal actions and check
// invariants after every step. Catches crashes, NaN/negative stock, time rule violations, etc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS, SLOTS, GRADES, ORES } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import { newGame, endDay, acknowledgeReport, confirmPlan, serialize, deserialize } from '../js/core/game.js';
import {
  travel, search, setCarry, defaultCarry, moveToPile, takeFromPile, projectedLoad, returnMinutes, atCamp, currentField, distanceRow,
} from '../js/core/map.js';
import { refine, cut } from '../js/core/processing.js';
import { craft, repair, canCraft } from '../js/core/gear.js';
import { toggleRing, wornRings } from '../js/core/rings.js';
import { spendIntel } from '../js/core/intel.js';
import { scrap } from '../js/core/gear.js';
import { cfgWith, WEAK_ENEMIES } from './helpers.mjs';

const PHASES = ['work', 'report', 'plan', 'over'];

function checkInvariants(s, ctx, cfg = CONFIG) {
  const where = `${ctx} (day ${s.day}, phase ${s.phase})`;
  assert.ok(PHASES.includes(s.phase), where);
  assert.ok(Number.isFinite(s.time) && s.time >= cfg.time.dayStartMin, `time ${s.time} ${where}`);
  assert.ok(s.bag.length <= cfg.bag.slots, `bag ${s.bag.length} ${where}`);
  for (const [name, store] of Object.entries(s.storage)) {
    for (const [k, v] of Object.entries(store)) {
      assert.ok(Number.isFinite(v) && v >= 0, `storage.${name}.${k} = ${v} ${where}`);
      assert.ok(Math.abs(v * 100 - Math.round(v * 100)) < 1e-6, `storage.${name}.${k} = ${v} not in 0.01 steps ${where}`);
    }
  }
  for (const g of s.gear) {
    assert.ok(g.durability > 0 && g.durability <= 100, `durability ${g.durability} ${where}`);
    assert.ok(SLOTS.includes(g.slot) && GRADES.includes(g.grade));
  }
  assert.ok(wornRings(s, 'smith', cfg).length <= cfg.rings.maxWorn, where);
  assert.ok(wornRings(s, 'adventurer', cfg).length <= cfg.rings.maxWorn, where);
  const ids = [...s.gear.map((g) => g.id), ...s.rings.map((r) => r.id)];
  assert.equal(new Set(ids).size, ids.length, `duplicate ids ${where}`);
  assert.ok(ids.every((id) => id < s.nextId), where);
  if (s.phase === 'work' && s.day > 1) assert.ok(s.plan && s.plan.day === s.day, `missing plan ${where}`);
  if (s.phase === 'work') assert.equal(s.roster.day, s.day + 1, where);
  for (const k of Object.keys(s.skills)) assert.ok(s.skills[k].level >= 0 && s.skills[k].level <= cfg.skills.maxLevel);
  const validItem = (t) => {
    const [kind, type] = t.split(':');
    return kind === 'ore' ? ORES.includes(type) : kind === 'gem' && GEMS.includes(type);
  };
  for (const t of s.bag) assert.ok(validItem(t), `bag item ${t} ${where}`);
  for (const f of Object.values(s.map.fields)) {
    assert.ok(Array.isArray(f.pile), `pile ${where}`);
    for (const t of f.pile) assert.ok(validItem(t), `pile item ${t} ${where}`);
    assert.equal(f.cells.filter((c) => c.boulder).length, distanceRow(f.dist, cfg).boulders, `boulders ${where}`);
    for (const c of f.cells) {
      assert.ok(c.searched >= 0 && c.searched <= 100, `searched ${c.searched} ${where}`);
      assert.ok(Number.isFinite(c.debris) && c.debris >= 0, `debris ${c.debris} ${where}`);
      assert.ok(!(c.debris > 0 && c.searched > 0), `searched debris cell ${where}`);
      if (c.boulder) assert.ok(c.searched === 0 && c.debris === 0 && c.items.length === 0, `boulder changed ${where}`);
      assert.equal('revealed' in c, false, `cell has a revealed flag ${where}`);
      for (const it of c.items) assert.ok(Number.isInteger(it.s) && it.s >= 1 && it.s <= 100, `sight threshold ${it.s} ${where}`);
    }
  }
}

// Every raw item in the world: still hidden in cells, in a pile, in the bag, or in camp storage.
const rawTotal = (s) =>
  Object.values(s.map.fields).reduce((a, f) => a + f.pile.length + f.cells.reduce((b, c) => b + c.items.length, 0), 0) +
  s.bag.length + Object.values(s.storage.ore).reduce((a, b) => a + b, 0) + Object.values(s.storage.gem).reduce((a, b) => a + b, 0);

// A random carry choice: some bag items and some pile items, at most the bag size (sometimes too many).
function randomCarry(s, rng, cfg) {
  const f = currentField(s);
  const pick = (n) => Array.from({ length: n }, (_, i) => i).filter(() => rng.chance(50));
  const sel = { bag: pick(s.bag.length), pile: f ? pick(f.pile.length) : [] };
  if (!rng.chance(10)) sel.pile = sel.pile.slice(0, Math.max(0, cfg.bag.slots - sel.bag.length));
  return sel;
}

// Highest-power gear for each slot (up to 2), for a reasonable plan.
function pickGear(s, cfg = CONFIG) {
  const power = (g) => cfg.gear.materialMult[g.material] * cfg.gear.gradeMult[g.grade];
  const ids = [];
  for (const slot of SLOTS) {
    ids.push(...s.gear.filter((g) => g.slot === slot).sort((a, b) => power(b) - power(a)).slice(0, 2).map((g) => g.id));
  }
  return ids;
}

function playDay(s, rng, log, cfg = CONFIG) {
  const step = (name, fn) => {
    const before = s.time;
    const items = rawTotal(s);
    const load = projectedLoad(s, cfg);
    const r = fn();
    assert.equal(typeof r.ok, 'boolean', name);
    if (!r.ok) assert.equal(s.time, before, `${name} failed but time moved`);
    if (r.ok && name === 'search') {
      assert.ok(s.time <= cfg.time.dayEndMin + 1e-6, `${name} ended after 18:00`);
      assert.ok(s.time + returnMinutes(s, s.location, load, cfg) <= cfg.time.dayEndMin + 1e-6, 'walk home with the projected load fits');
    }
    if (r.ok && name === 'travelOut') assert.ok(s.time <= cfg.time.dayEndMin + 1e-6);
    if (['carry', 'toPile', 'take'].includes(name)) assert.equal(s.time, before, `${name} is free`);
    if (!['refine', 'cut'].includes(name)) assert.equal(rawTotal(s), items, `${name} lost or made items`);
    checkInvariants(s, name, cfg);
    log.push(name + (r.ok ? '' : '!'));
    return r;
  };
  const carryChoice = () => (rng.chance(50) ? defaultCarry(s, cfg) : randomCarry(s, rng, cfg));
  // Field trip(s)
  const trips = rng.int(0, 2);
  for (let t = 0; t < trips; t++) {
    const fields = s.map.cells.filter((c) => c.type === 'field');
    const target = rng.pick(fields);
    step('travelOut', () => travel(s, { x: target.x, y: target.y }, cfg));
    if (atCamp(s)) continue;
    const actions = rng.int(2, 14);
    for (let a = 0; a < actions; a++) {
      const roll = rng.next();
      const x = rng.int(0, 7);
      const y = rng.int(0, 7);
      const pile = currentField(s).pile;
      if (roll < 0.7) step('search', () => search(s, x, y, cfg));
      else if (roll < 0.8) step('carry', () => setCarry(s, randomCarry(s, rng, cfg), cfg));
      else if (roll < 0.9) step('toPile', () => moveToPile(s, rng.int(-1, s.bag.length), cfg));
      else step('take', () => takeFromPile(s, rng.int(-1, pile.length), cfg));
      if (rng.chance(10) && currentField(s)) {
        const others = fields.filter((c) => c.x !== s.location.x || c.y !== s.location.y);
        const o = rng.pick(others);
        step('travelOut', () => travel(s, { x: o.x, y: o.y }, cfg, rng.chance(70) ? carryChoice() : null));
      }
    }
    const left = currentField(s);
    const sel = rng.chance(80) ? carryChoice() : null;
    let r = step('return', () => travel(s, s.map.camp, cfg, sel));
    if (!r.ok) r = step('return', () => travel(s, s.map.camp, cfg)); // a too-big carry choice is refused
    assert.equal(r.ok, true, `return must always succeed: ${r.msg}`);
    assert.equal(atCamp(s), true);
    assert.equal(s.bag.length, 0, 'bag unloaded');
    assert.ok(Array.isArray(left.pile), 'the pile stays in the field');
  }
  // Workshop
  for (const bar of BARS) for (let i = 0; i < 4; i++) step('refine', () => refine(s, bar, cfg));
  for (const gem of GEMS) step('cut', () => cut(s, gem, cfg));
  for (const slot of SLOTS) {
    for (const bar of BARS) {
      for (const grade of GRADES) {
        if (canCraft(s, { slot, material: bar, grade }, cfg) === null && rng.chance(50)) step('craft', () => craft(s, { slot, material: bar, grade }, cfg));
      }
    }
  }
  for (const g of s.gear) if (g.durability < 100) step('repair', () => repair(s, g.id, cfg));
  // scrap the weakest unpacked item now and then when there is plenty of gear
  if (s.gear.length > 12 && rng.chance(30)) {
    const unpacked = s.gear.filter((g) => !g.packed);
    if (unpacked.length) step('scrap', () => scrap(s, unpacked[0].id));
  }
  for (const r of s.rings) if (rng.chance(30)) step('ring', () => toggleRing(s, r.id, cfg));
  if (s.intel.points) step('intel', () => spendIntel(s, rng.pick(Object.keys(cfg.intel.tracks)), cfg));
}

// Plays up to `days` days for each seed; returns { daysPlayed, fights, nightRepairs }.
function playRuns(seeds, days, cfg = CONFIG) {
  let daysPlayed = 0;
  let fights = 0;
  let nightRepairs = 0;
  for (const seed of seeds) {
    const s = newGame(seed, cfg);
    const rng = seededRng(seed * 31 + 7);
    const log = [];
    checkInvariants(s, 'newGame', cfg);
    for (let d = 0; d < days && s.phase !== 'over'; d++) {
      playDay(s, rng, log, cfg);
      const e = endDay(s, cfg);
      assert.equal(e.ok, true, e.msg);
      checkInvariants(s, 'endDay', cfg);
      // actions that need the work day are refused between days
      assert.equal(setCarry(s, { bag: [], pile: [] }, cfg).ok, false);
      assert.equal(takeFromPile(s, 0, cfg).ok, false);
      assert.equal(search(s, 1, 1, cfg).ok, false);
      if (s.gear.length) assert.equal(scrap(s, s.gear[0].id).ok, false);
      daysPlayed++;
      if (e.report) fights++;
      if (s.phase === 'over') break;
      // night repairs (some while the report is open, the rest while planning): free of time, all gear home
      const nightRepair = (share) => {
        for (const g of s.gear) {
          if (g.durability >= 100 || !rng.chance(share)) continue;
          assert.equal(g.packed, false, 'all gear is home at night');
          const t = s.time;
          const r = repair(s, g.id, cfg);
          assert.equal(typeof r.ok, 'boolean');
          assert.equal(s.time, t, 'night repair costs no time');
          if (r.ok) {
            assert.equal(r.minutes, 0);
            nightRepairs++;
          }
          checkInvariants(s, 'nightRepair', cfg);
        }
      };
      nightRepair(50);
      if (s.phase === 'report') assert.equal(acknowledgeReport(s).ok, true);
      nightRepair(100);
      // fight the weakest-looking enemy with the best gear and every adventurer ring (max)
      const enemyIndex = s.roster.enemies.findIndex((x) => x.tier === 'normal');
      const ringIds = s.rings.filter((r) => cfg.rings.types[r.type].owner === 'adventurer').slice(0, cfg.rings.maxWorn).map((r) => r.id);
      const c = confirmPlan(s, { enemyIndex, gearIds: pickGear(s, cfg), ringIds }, cfg);
      assert.equal(c.ok, true, c.msg);
      checkInvariants(s, 'confirmPlan', cfg);
      const back = deserialize(serialize(s));
      assert.deepEqual(back, s);
    }
  }
  return { daysPlayed, fights, nightRepairs };
}

test('random playthroughs keep every invariant and never throw (long runs: the adventurer always wins)', () => {
  const cfg = cfgWith(WEAK_ENEMIES);
  const seeds = Array.from({ length: 8 }, (_, i) => i + 1);
  const days = 14;
  const { daysPlayed, fights, nightRepairs } = playRuns(seeds, days, cfg);
  if (process.env.SMITHSY_DEBUG) console.log({ daysPlayed, fights, nightRepairs });
  assert.equal(daysPlayed, seeds.length * days, 'nobody died');
  assert.ok(nightRepairs > 0, 'night repairs happened');
  assert.equal(fights, seeds.length * (days - 1), 'a fight every day from day 2');
});

test('random playthroughs with the default config keep every invariant and never throw', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => i + 1);
  const { daysPlayed, fights } = playRuns(seeds, 14);
  if (process.env.SMITHSY_DEBUG) console.log({ daysPlayed, fights });
  assert.ok(daysPlayed >= seeds.length);
  assert.ok(fights <= daysPlayed);
});
