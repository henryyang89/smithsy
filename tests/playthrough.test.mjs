// Randomized playthroughs: drive the core with a mix of legal and illegal actions and check
// invariants after every step. Catches crashes, NaN/negative stock, time rule violations, etc.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS, SLOTS, GRADES } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import { newGame, endDay, acknowledgeReport, confirmPlan, serialize, deserialize } from '../js/core/game.js';
import { travel, search, clearDebris, pickUp, dropItem, atCamp, currentField } from '../js/core/map.js';
import { refine, cut } from '../js/core/processing.js';
import { craft, repair, canCraft } from '../js/core/gear.js';
import { toggleRing, wornRings } from '../js/core/rings.js';
import { spendIntel } from '../js/core/intel.js';

const PHASES = ['work', 'report', 'plan', 'over'];

function checkInvariants(s, ctx) {
  const where = `${ctx} (day ${s.day}, phase ${s.phase})`;
  assert.ok(PHASES.includes(s.phase), where);
  assert.ok(Number.isFinite(s.time) && s.time >= CONFIG.time.dayStartMin, `time ${s.time} ${where}`);
  assert.ok(s.bag.length <= CONFIG.bag.slots, `bag ${s.bag.length} ${where}`);
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
  assert.ok(wornRings(s, 'smith').length <= CONFIG.rings.maxWorn, where);
  assert.ok(wornRings(s, 'adventurer').length <= CONFIG.rings.maxWorn, where);
  const ids = [...s.gear.map((g) => g.id), ...s.rings.map((r) => r.id)];
  assert.equal(new Set(ids).size, ids.length, `duplicate ids ${where}`);
  assert.ok(ids.every((id) => id < s.nextId), where);
  if (s.phase === 'work' && s.day > 1) assert.ok(s.plan && s.plan.day === s.day, `missing plan ${where}`);
  if (s.phase === 'work') assert.equal(s.roster.day, s.day + 1, where);
  for (const k of Object.keys(s.skills)) assert.ok(s.skills[k].level >= 0 && s.skills[k].level <= CONFIG.skills.maxLevel);
}

// Highest-power gear for each slot (up to 2), for a reasonable plan.
function pickGear(s) {
  const power = (g) => CONFIG.gear.materialMult[g.material] * CONFIG.gear.gradeMult[g.grade];
  const ids = [];
  for (const slot of SLOTS) {
    ids.push(...s.gear.filter((g) => g.slot === slot).sort((a, b) => power(b) - power(a)).slice(0, 2).map((g) => g.id));
  }
  return ids;
}

function playDay(s, rng, log) {
  const step = (name, fn) => {
    const before = s.time;
    const r = fn();
    assert.equal(typeof r.ok, 'boolean', name);
    if (!r.ok) assert.equal(s.time, before, `${name} failed but time moved`);
    if (r.ok && ['search', 'clear'].includes(name)) assert.ok(s.time <= CONFIG.time.dayEndMin + 1e-6, `${name} ended after 18:00`);
    if (r.ok && name === 'travelOut') assert.ok(s.time <= CONFIG.time.dayEndMin + 1e-6);
    checkInvariants(s, name);
    log.push(name + (r.ok ? '' : '!'));
    return r;
  };
  // Field trip(s)
  const trips = rng.int(0, 2);
  for (let t = 0; t < trips; t++) {
    const fields = s.map.cells.filter((c) => c.type === 'field');
    const target = rng.pick(fields);
    step('travelOut', () => travel(s, { x: target.x, y: target.y }));
    if (atCamp(s)) continue;
    const actions = rng.int(2, 14);
    for (let a = 0; a < actions; a++) {
      const roll = rng.next();
      const x = rng.int(0, 7);
      const y = rng.int(0, 7);
      if (roll < 0.65) step('search', () => search(s, x, y));
      else if (roll < 0.8) step('clear', () => clearDebris(s, x, y));
      else if (roll < 0.9) step('pickUp', () => pickUp(s, y * 8 + x));
      else if (s.bag.length) step('drop', () => dropItem(s, rng.int(0, s.bag.length - 1), y * 8 + x));
      if (rng.chance(10) && currentField(s)) {
        const others = fields.filter((c) => c.x !== s.location.x || c.y !== s.location.y);
        const o = rng.pick(others);
        step('travelOut', () => travel(s, { x: o.x, y: o.y }));
      }
    }
    step('return', () => travel(s, s.map.camp));
    assert.equal(atCamp(s), true, 'return must always succeed');
    assert.equal(s.bag.length, 0, 'bag unloaded');
  }
  // Workshop
  for (const bar of BARS) for (let i = 0; i < 4; i++) step('refine', () => refine(s, bar));
  for (const gem of GEMS) step('cut', () => cut(s, gem));
  for (const slot of SLOTS) {
    for (const bar of BARS) {
      for (const grade of GRADES) {
        if (canCraft(s, { slot, material: bar, grade }) === null && rng.chance(50)) step('craft', () => craft(s, { slot, material: bar, grade }));
      }
    }
  }
  for (const g of s.gear) if (g.durability < 100) step('repair', () => repair(s, g.id));
  for (const r of s.rings) if (rng.chance(30)) step('ring', () => toggleRing(s, r.id));
  if (s.intel.points) step('intel', () => spendIntel(s, rng.pick(Object.keys(CONFIG.intel.tracks))));
}

test('random playthroughs keep every invariant and never throw', () => {
  let daysPlayed = 0;
  let fights = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const s = newGame(seed);
    const rng = seededRng(seed * 31 + 7);
    const log = [];
    checkInvariants(s, 'newGame');
    for (let d = 0; d < 14 && s.phase !== 'over'; d++) {
      playDay(s, rng, log);
      const e = endDay(s);
      assert.equal(e.ok, true, e.msg);
      checkInvariants(s, 'endDay');
      daysPlayed++;
      if (e.report) fights++;
      if (s.phase === 'over') break;
      if (s.phase === 'report') assert.equal(acknowledgeReport(s).ok, true);
      // fight the weakest-looking enemy with the best gear and every adventurer ring (max 10)
      const enemyIndex = s.roster.enemies.findIndex((x) => x.tier === 'normal');
      const ringIds = s.rings.filter((r) => CONFIG.rings.types[r.type].owner === 'adventurer').slice(0, 10).map((r) => r.id);
      const c = confirmPlan(s, { enemyIndex, gearIds: pickGear(s), ringIds });
      assert.equal(c.ok, true, c.msg);
      checkInvariants(s, 'confirmPlan');
      const back = deserialize(serialize(s));
      assert.deepEqual(back, s);
    }
  }
  if (process.env.SMITHSY_DEBUG) console.log({ daysPlayed, fights });
  assert.ok(daysPlayed > 40, `only ${daysPlayed} days played`);
  assert.ok(fights > 20);
});
