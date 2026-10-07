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
  for (const f of Object.values(s.map.fields)) {
    for (const c of f.cells) {
      assert.ok(c.searched >= 0 && c.searched <= 100, `searched ${c.searched} ${where}`);
      assert.ok(!(c.debris && c.searched > 0), `searched debris cell ${where}`);
    }
  }
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
    const r = fn();
    assert.equal(typeof r.ok, 'boolean', name);
    if (!r.ok) assert.equal(s.time, before, `${name} failed but time moved`);
    if (r.ok && ['search', 'clear'].includes(name)) assert.ok(s.time <= cfg.time.dayEndMin + 1e-6, `${name} ended after 18:00`);
    if (r.ok && name === 'travelOut') assert.ok(s.time <= cfg.time.dayEndMin + 1e-6);
    checkInvariants(s, name, cfg);
    log.push(name + (r.ok ? '' : '!'));
    return r;
  };
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
      if (roll < 0.65) step('search', () => search(s, x, y, cfg));
      else if (roll < 0.8) step('clear', () => clearDebris(s, x, y, cfg));
      else if (roll < 0.9) step('pickUp', () => pickUp(s, y * 8 + x, cfg));
      else if (s.bag.length) step('drop', () => dropItem(s, rng.int(0, s.bag.length - 1), y * 8 + x, cfg));
      if (rng.chance(10) && currentField(s)) {
        const others = fields.filter((c) => c.x !== s.location.x || c.y !== s.location.y);
        const o = rng.pick(others);
        step('travelOut', () => travel(s, { x: o.x, y: o.y }, cfg));
      }
    }
    step('return', () => travel(s, s.map.camp, cfg));
    assert.equal(atCamp(s), true, 'return must always succeed');
    assert.equal(s.bag.length, 0, 'bag unloaded');
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
      assert.equal(pickUp(s, 0, cfg).ok, false);
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
  // regrowth turned up so fields reset during the run too
  const cfg = cfgWith(WEAK_ENEMIES, { field: { regrowPctPerDay: 25 } });
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
