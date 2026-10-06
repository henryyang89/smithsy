import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS, BARS, GRADES } from '../js/config.js';
import {
  newGame, endDay, acknowledgeReport, validatePlan, confirmPlan, resolveBattle, rosterView, serialize, deserialize,
  adventurerRingTotals, logResult, addLog, packedSlotsSummary, SAVE_VERSION, MAX_LOG,
} from '../js/core/game.js';
import { repair } from '../js/core/gear.js';
import { travel } from '../js/core/map.js';
import { game, cfgWith, addGear, addRing, fullSet, fieldAt, DAY_START, DAY_END } from './helpers.mjs';

const tierIndex = (s, tier) => s.roster.enemies.findIndex((e) => e.tier === tier);
const plan = (enemyIndex, gearIds = [], ringIds = []) => ({ enemyIndex, gearIds, ringIds });

// Day 1 -> plan -> confirm. Returns the state on day 2 (adventurer away).
function toDay2(s, p) {
  assert.equal(endDay(s).ok, true);
  const r = confirmPlan(s, typeof p === 'function' ? p(s) : p);
  assert.equal(r.ok, true, r.msg);
  return s;
}

// --------------------------------------------------------------- new game ----
test('newGame: initial state shape', () => {
  const s = newGame(4242);
  assert.equal(s.version, SAVE_VERSION);
  assert.equal(s.seed, 4242);
  assert.equal(typeof s.rng.s, 'number');
  assert.equal(s.day, 1);
  assert.equal(s.time, DAY_START);
  assert.equal(s.phase, 'work');
  assert.deepEqual(s.location, s.map.camp);
  assert.notEqual(s.location, s.map.camp, 'location is a copy');
  assert.deepEqual(s.bag, []);
  assert.deepEqual(Object.keys(s.storage.ore), ORES);
  assert.deepEqual(Object.keys(s.storage.gem), GEMS);
  assert.equal(Object.keys(s.storage.bars).length, BARS.length * GRADES.length);
  assert.equal(Object.keys(s.storage.cut).length, GEMS.length * GRADES.length);
  for (const store of Object.values(s.storage)) for (const v of Object.values(store)) assert.equal(v, 0);
  assert.ok('steel:S' in s.storage.bars && 'diamond:D' in s.storage.cut);
  assert.deepEqual(s.gear, []);
  assert.deepEqual(s.rings, []);
  assert.equal(s.nextId, 1);
  assert.equal(s.intel.points, 0);
  assert.equal(s.roster.day, 2, 'roster is for tomorrow');
  assert.equal(s.roster.enemies.length, 7);
  assert.equal(s.plan, null);
  assert.equal(s.report, null);
  assert.deepEqual(s.stats, { score: 0, wins: { normal: 0, elite: 0, champion: 0 }, fights: 0, bestDay: 1 });
  assert.equal(s.log.length, 1);
  assert.deepEqual(s.battles, []);
  assert.equal(s.map.cells.length, 25);
});

test('newGame is deterministic for a seed', () => {
  assert.equal(serialize(newGame(77)), serialize(newGame(77)));
  assert.notEqual(serialize(newGame(77)), serialize(newGame(78)));
});

// ---------------------------------------------------------------- end day ----
test('day 1: endDay -> plan (no fight, no report), clock set to 18:00', () => {
  const s = game(1);
  const r = endDay(s);
  assert.equal(r.ok, true);
  assert.equal(r.report, null);
  assert.equal(s.phase, 'plan');
  assert.equal(s.report, null);
  assert.equal(s.time, DAY_END);
  assert.equal(s.stats.fights, 0);
  assert.equal(endDay(s).ok, false, 'cannot end twice');
  assert.equal(acknowledgeReport(s).ok, false, 'no report to close');
});

test('endDay requires being at camp; a late return keeps the later clock', () => {
  const s = game(1);
  const f = fieldAt(s, 1);
  s.location = { x: f.x, y: f.y };
  const r = endDay(s);
  assert.equal(r.ok, false);
  assert.match(r.msg, /camp/);
  assert.equal(s.phase, 'work');
  s.time = DAY_END - 5;
  travel(s, s.map.camp); // back past 18:00
  assert.ok(s.time > DAY_END);
  const t = s.time;
  assert.equal(endDay(s).ok, true);
  assert.equal(s.time, t);
});

// ----------------------------------------------------------- validatePlan ----
test('validatePlan: enemy required, max 2 gear per slot, adventurer rings only, max 10 rings', () => {
  const s = game(1);
  const [sw1, sw2, sw3] = [addGear(s, 'sword'), addGear(s, 'sword'), addGear(s, 'sword')];
  const ch = addGear(s, 'chest');
  assert.equal(validatePlan(s, plan(7)), 'Pick an enemy.');
  assert.equal(validatePlan(s, plan(-1)), 'Pick an enemy.');
  assert.equal(validatePlan(s, plan(0, [sw1.id, sw2.id, ch.id])), null);
  assert.match(validatePlan(s, plan(0, [sw1.id, sw2.id, sw3.id])), /At most 2 items per slot \(sword\)/);
  assert.equal(validatePlan(s, plan(0, [999])), 'Unknown gear selected.');
  const advRings = Array.from({ length: 11 }, () => addRing(s, 'accuracy', 'D'));
  const smithRing = addRing(s, 'travelTime', 'S');
  assert.equal(validatePlan(s, plan(0, [], advRings.slice(0, 10).map((r) => r.id))), null);
  assert.match(validatePlan(s, plan(0, [], advRings.map((r) => r.id))), /At most 10 rings/);
  assert.match(validatePlan(s, plan(0, [], [smithRing.id])), /Only adventurer rings/);
  assert.match(validatePlan(s, plan(0, [], [12345])), /Only adventurer rings/);
});

// ------------------------------------------------------------ confirmPlan ----
test('confirmPlan: advances the day, packs gear, sets adventurer rings, new roster for day+1', () => {
  const s = game(5);
  const sw = addGear(s, 'sword', 'iron', 'B');
  const home = addGear(s, 'chest', 'iron', 'B');
  const advA = addRing(s, 'dodge', 'S', false);
  const advB = addRing(s, 'health', 'S', true); // worn before, not in the plan
  const smith = addRing(s, 'travelTime', 'S', true);
  assert.equal(confirmPlan(s, plan(0)).ok, false, 'only during planning');
  endDay(s);
  const oldRoster = s.roster;
  const enemy = s.roster.enemies[3];
  assert.equal(confirmPlan(s, plan(99)).ok, false, 'invalid plan refused');
  assert.equal(s.phase, 'plan');
  const r = confirmPlan(s, plan(3, [sw.id], [advA.id]));
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.day, 2);
  assert.equal(s.time, DAY_START);
  assert.equal(s.phase, 'work');
  assert.equal(s.stats.bestDay, 2);
  assert.equal(sw.packed, true);
  assert.equal(home.packed, false);
  assert.equal(advA.worn, true);
  assert.equal(advB.worn, false);
  assert.equal(smith.worn, true, 'smith rings untouched');
  assert.deepEqual(s.plan, { day: 2, enemy, gearIds: [sw.id], ringIds: [advA.id] });
  assert.equal(s.roster.day, 3);
  assert.notEqual(s.roster, oldRoster);
  assert.notDeepEqual(s.roster.enemies.map((e) => e.levels), oldRoster.enemies.map((e) => e.levels));
  assert.deepEqual(packedSlotsSummary(s).find((p) => p.slot === 'sword').items, [sw]);
});

test('packed gear cannot be repaired while the adventurer is away; home gear can', () => {
  const s = game(5);
  const away = addGear(s, 'sword', 'copper', 'D', null, { durability: 50 });
  const home = addGear(s, 'helmet', 'copper', 'D', null, { durability: 50 });
  s.storage.bars['copper:D'] = 5;
  toDay2(s, plan(0, [away.id]));
  assert.equal(repair(s, away.id).ok, false);
  assert.equal(repair(s, home.id).ok, true);
});

// ---------------------------------------------------------------- battles ----
test('day 2 win: report phase, ring + score, durability lost only on used items', () => {
  const s = game(11);
  const set = fullSet(s, 'mythril', 'S');
  const spareSword = addGear(s, 'sword', 'copper', 'D');
  const unpacked = addGear(s, 'boots', 'copper', 'D');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), [...set.map((g) => g.id), spareSword.id]));
  const enemy = s.plan.enemy;
  const ids0 = s.nextId;
  const r = endDay(s);
  assert.equal(r.ok, true);
  const rep = r.report;
  assert.equal(rep.win, true, 'top gear should beat a day-2 normal enemy');
  assert.equal(s.phase, 'report');
  assert.equal(s.report, rep);
  assert.equal(s.plan, null);
  assert.equal(s.stats.fights, 1);
  assert.equal(s.stats.score, CONFIG.enemies.tiers.normal.score);
  assert.equal(s.stats.wins.normal, 1);
  // ring reward = the roster's ring, new id, not worn
  assert.equal(s.rings.length, 1);
  assert.deepEqual(s.rings[0], { id: ids0, type: enemy.ring.type, grade: enemy.ring.grade, worn: false });
  assert.deepEqual(rep.ring, s.rings[0]);
  assert.equal(s.nextId, ids0 + 1);
  // used = best packed item per slot; the spare copper sword stays unused
  assert.equal(rep.usedIds.length, 5);
  assert.ok(!rep.usedIds.includes(spareSword.id));
  for (const g of s.gear) {
    const used = rep.usedIds.includes(g.id);
    if (used) assert.ok(g.durability >= 93 && g.durability <= 97, `${g.slot} at ${g.durability}`);
    else assert.equal(g.durability, 100);
    assert.equal(g.packed, false, 'gear comes home');
  }
  assert.equal(unpacked.durability, 100);
  assert.equal(rep.wear.length, 5);
  for (const w of rep.wear) assert.ok(w.loss >= 3 && w.loss <= 7 && w.left === 100 - w.loss);
  assert.equal(s.battles.length, 1);
  assert.ok(rep.log.length > 0);
  assert.equal(rep.enemy.name, enemy.name);
  // close the report -> plan
  assert.equal(acknowledgeReport(s).ok, true);
  assert.equal(s.phase, 'plan');
});

test('gear at 0% durability is destroyed after the fight', () => {
  const s = game(11);
  const set = fullSet(s, 'mythril', 'S');
  const spare = addGear(s, 'sword', 'copper', 'D', null, { durability: 3 });
  for (const g of set) g.durability = 3; // every fight costs at least 3%
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), [...set.map((g) => g.id), spare.id]));
  const rep = endDay(s).report;
  assert.equal(rep.win, true);
  assert.equal(rep.destroyed.length, 5);
  for (const g of set) assert.ok(!s.gear.includes(g), `${g.slot} should be gone`);
  assert.ok(s.gear.includes(spare), 'unused item survives');
  assert.equal(spare.durability, 3);
  for (const w of rep.wear) assert.equal(w.left, 0);
});

test('a lost fight is game over: no ring, no score', () => {
  const s = game(3);
  toDay2(s, (st) => plan(tierIndex(st, 'champion')));
  const r = endDay(s);
  assert.equal(r.report.win, false);
  assert.equal(r.report.draw, false);
  assert.equal(s.phase, 'over');
  assert.equal(s.rings.length, 0);
  assert.equal(s.stats.score, 0);
  assert.equal(s.stats.fights, 1);
  assert.equal(r.report.advHp, 0);
  assert.deepEqual(r.report.usedIds, []);
  assert.equal(acknowledgeReport(s).ok, false);
  assert.equal(endDay(s).ok, false);
  assert.match(s.log[s.log.length - 1].text, /GAME OVER/);
});

test('a fight that hits the safety cap is a draw: adventurer survives, no ring', () => {
  const cfg = cfgWith({ combat: { safetyCapSeconds: 1 } });
  const s = game(3);
  const sw = addGear(s, 'sword');
  endDay(s, cfg);
  confirmPlan(s, plan(tierIndex(s, 'champion'), [sw.id]), cfg);
  const r = endDay(s, cfg);
  assert.equal(r.report.draw, true);
  assert.equal(r.report.win, false);
  assert.equal(s.phase, 'report');
  assert.equal(s.rings.length, 0);
  assert.equal(s.stats.score, 0);
  assert.ok(sw.durability < 100, 'used gear still wears');
});

test('battle uses the plan\'s rings (health ring raises max HP)', () => {
  const s = game(11);
  const set = fullSet(s, 'mythril', 'S');
  const hp = addRing(s, 'health', 'S');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), set.map((g) => g.id), [hp.id]));
  assert.deepEqual(adventurerRingTotals(s), { health: 7 });
  assert.deepEqual(adventurerRingTotals(s, []), {});
  const rep = endDay(s).report;
  assert.equal(rep.advMaxHp, 107);
});

test('resolveBattle is reproducible from a saved state', () => {
  const s = game(21);
  const set = fullSet(s, 'iron', 'B');
  toDay2(s, (st) => plan(tierIndex(st, 'elite'), set.map((g) => g.id)));
  const copy = deserialize(serialize(s));
  const a = endDay(s).report;
  const b = endDay(copy).report;
  assert.deepEqual(a, b);
});

// ------------------------------------------------------------ intel + days ----
test('intel point at the end of day 5 (and 10), not on other days', () => {
  const s = game(31);
  const set = fullSet(s, 'mythril', 'S');
  let day = 1;
  while (day <= 10) {
    const r = endDay(s);
    assert.equal(r.ok, true);
    if (r.report) {
      assert.equal(r.report.win, true, `day ${day} fight lost`);
      acknowledgeReport(s);
    }
    assert.equal(s.intel.points, day >= 10 ? 2 : day >= 5 ? 1 : 0, `after day ${day}`);
    for (const g of set) g.durability = 100; // keep the test about intel, not wear
    const res = confirmPlan(s, plan(tierIndex(s, 'normal'), set.map((g) => g.id)));
    assert.equal(res.ok, true, res.msg);
    day += 1;
    assert.equal(s.day, day);
    assert.equal(s.roster.day, day + 1);
    assert.equal(s.plan.day, day);
    assert.equal(s.plan.enemy.day, day, 'the enemy was generated for the fight day');
  }
  assert.equal(s.stats.fights, 9);
  assert.equal(s.stats.wins.normal, 9);
  assert.equal(s.stats.score, 90);
  assert.equal(s.rings.length, 9);
  assert.equal(new Set(s.rings.map((r) => r.id)).size, 9);
  assert.equal(s.stats.bestDay, 11);
});

// --------------------------------------------------------------- roster view --
test('rosterView: known levels follow intel', () => {
  const s = game(8);
  const v = rosterView(s);
  assert.equal(v.length, 7);
  for (const row of v) for (const [k, lv] of Object.entries(row.known)) assert.equal(row.enemy.levels[k], lv);
  s.intel.spent.enemySight = 30; // 100%
  for (const row of rosterView(s)) assert.deepEqual(row.known, row.enemy.levels);
});

// ------------------------------------------------------------------ save ----
test('serialize / deserialize roundtrip (fresh game and mid-run)', () => {
  const s = game(9);
  assert.deepEqual(deserialize(serialize(s)), s);
  const set = fullSet(s, 'mythril', 'S');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), set.map((g) => g.id)));
  endDay(s);
  const back = deserialize(serialize(s));
  assert.deepEqual(back, s);
  // the restored state keeps playing identically
  acknowledgeReport(s);
  acknowledgeReport(back);
  const p = plan(tierIndex(s, 'elite'), set.filter((g) => s.gear.includes(g)).map((g) => g.id));
  confirmPlan(s, p);
  confirmPlan(back, p);
  assert.equal(serialize(back), serialize(s));
});

test('deserialize rejects other save versions and junk', () => {
  const s = game(9);
  assert.throws(() => deserialize(JSON.stringify({ ...s, version: SAVE_VERSION + 1 })), /Incompatible/);
  assert.throws(() => deserialize('null'), /Incompatible/);
  assert.throws(() => deserialize('{not json'));
});

// ------------------------------------------------------------------- log ----
test('log: logResult logs successes and notes; the log is capped', () => {
  const s = game(1);
  const n = s.log.length;
  logResult(s, { ok: false, msg: 'nope', notes: ['note A'] });
  assert.equal(s.log.length, n + 1, 'failed msg not logged, notes are');
  logResult(s, { ok: true, msg: 'did it' });
  assert.equal(s.log[s.log.length - 1].text, 'did it');
  assert.equal(s.log[s.log.length - 1].time, '08:00');
  for (let i = 0; i < MAX_LOG + 50; i++) addLog(s, `x${i}`);
  assert.equal(s.log.length, MAX_LOG);
  assert.equal(s.log[s.log.length - 1].text, `x${MAX_LOG + 49}`);
});
