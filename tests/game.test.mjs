import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS, BARS, GRADES } from '../js/config.js';
import {
  newGame, endDay, acknowledgeReport, validatePlan, confirmPlan, resolveBattle, rosterView, serialize, deserialize,
  adventurerRingTotals, logResult, addLog, packedSlotsSummary, migrateV1, SAVE_VERSION, MAX_LOG,
} from '../js/core/game.js';
import { ringLabel } from '../js/core/rings.js';
import { repair } from '../js/core/gear.js';
import { travel, search, setCarry, currentField, fieldProgress } from '../js/core/map.js';
import { VERSION } from '../js/version.js';
import { game, cfgWith, addGear, addRing, fullSet, fieldAt, fieldOf, idx, ringVal, WEAK_ENEMIES, DEADLY_ENEMIES, DAY_START, DAY_END } from './helpers.mjs';

const tierIndex = (s, tier) => s.roster.enemies.findIndex((e) => e.tier === tier);
const plan = (enemyIndex, gearIds = [], ringIds = []) => ({ enemyIndex, gearIds, ringIds });
// Fight outcomes fixed by config, so these tests check the day flow, not the balance.
const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);
const { min: LOSS_MIN, max: LOSS_MAX } = CONFIG.gear.durabilityLoss;
const rosterSize = Object.values(CONFIG.enemies.tiers).reduce((a, t) => a + t.count, 0);

// Day 1 -> plan -> confirm. Returns the state on day 2 (adventurer away).
function toDay2(s, p, cfg = CONFIG) {
  assert.equal(endDay(s, cfg).ok, true);
  const r = confirmPlan(s, typeof p === 'function' ? p(s) : p, cfg);
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
  assert.equal(s.roster.enemies.length, rosterSize);
  assert.equal(s.plan, null);
  assert.equal(s.report, null);
  assert.deepEqual(s.stats, { score: 0, wins: { normal: 0, elite: 0, champion: 0 }, fights: 0, bestDay: 1 });
  assert.equal(s.log.length, 1);
  assert.deepEqual(s.battles, []);
  assert.equal(s.map.cells.length, CONFIG.map.size ** 2);
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
  const max = CONFIG.rings.maxWorn;
  const advRings = Array.from({ length: max + 1 }, () => addRing(s, 'accuracy', 'D'));
  const smithRing = addRing(s, 'travelTime', 'S');
  assert.equal(validatePlan(s, plan(0, [], advRings.slice(0, max).map((r) => r.id))), null);
  assert.match(validatePlan(s, plan(0, [], advRings.map((r) => r.id))), new RegExp(`At most ${max} rings`));
  // the ring limit comes from the config
  assert.match(validatePlan(s, plan(0, [], advRings.slice(0, 3).map((r) => r.id)), cfgWith({ rings: { maxWorn: 2 } })), /At most 2 rings/);
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
  const packedIds = [...set.map((g) => g.id), spareSword.id];
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), packedIds), WIN);
  const enemy = s.plan.enemy;
  const ids0 = s.nextId;
  const r = endDay(s, WIN);
  assert.equal(r.ok, true);
  const rep = r.report;
  assert.equal(rep.win, true);
  assert.equal(rep.draw, false);
  assert.deepEqual(rep.packedIds, packedIds, 'report lists everything that was packed');
  assert.ok(rep.packedIds.includes(spareSword.id) && !rep.usedIds.includes(spareSword.id), 'packed but unused');
  for (const id of rep.usedIds) assert.ok(rep.packedIds.includes(id));
  assert.equal(rep.logTrimmed, 0);
  assert.equal(rep.log.length, rep.summary.A.attacks + rep.summary.E.attacks, 'short fights keep the whole log');
  assert.equal(rep.ringText, ringLabel(rep.ring));
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
    if (used) assert.ok(g.durability >= 100 - LOSS_MAX && g.durability <= 100 - LOSS_MIN, `${g.slot} at ${g.durability}`);
    else assert.equal(g.durability, 100);
    assert.equal(g.packed, false, 'gear comes home');
  }
  assert.equal(unpacked.durability, 100);
  assert.equal(rep.wear.length, 5);
  for (const w of rep.wear) assert.ok(w.loss >= LOSS_MIN && w.loss <= LOSS_MAX && w.left === 100 - w.loss);
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
  const spare = addGear(s, 'sword', 'copper', 'D', null, { durability: LOSS_MIN });
  for (const g of set) g.durability = LOSS_MIN; // every fight costs at least durabilityLoss.min
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), [...set.map((g) => g.id), spare.id]), WIN);
  const rep = endDay(s, WIN).report;
  assert.equal(rep.win, true);
  assert.equal(rep.destroyed.length, 5);
  for (const g of set) assert.ok(!s.gear.includes(g), `${g.slot} should be gone`);
  assert.ok(s.gear.includes(spare), 'unused item survives');
  assert.equal(spare.durability, LOSS_MIN);
  for (const w of rep.wear) assert.equal(w.left, 0);
});

test('a lost fight is game over: no ring, no score', () => {
  const s = game(3);
  toDay2(s, (st) => plan(tierIndex(st, 'champion')), LOSE);
  const r = endDay(s, LOSE);
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
  assert.ok(s.log.some((l) => /fell to/.test(l.text)));
});

test('a fight that hits the safety cap is a draw: adventurer survives, no ring', () => {
  // a cap shorter than any first attack: nobody even swings
  const cfg = cfgWith({ combat: { safetyCapSeconds: 0.01 } });
  const s = game(3);
  const sw = addGear(s, 'sword');
  endDay(s, cfg);
  confirmPlan(s, plan(tierIndex(s, 'champion'), [sw.id]), cfg);
  const r = endDay(s, cfg);
  assert.equal(r.report.draw, true);
  assert.equal(r.report.win, false);
  assert.equal(r.report.time, 0.01);
  assert.equal(r.report.advHp, r.report.advMaxHp);
  assert.equal(s.phase, 'report');
  assert.equal(s.rings.length, 0);
  assert.equal(r.report.ring, null);
  assert.equal(s.stats.score, 0);
  assert.equal(s.stats.fights, 1);
  assert.ok(sw.durability < 100, 'used gear still wears');
  const last = s.log.filter((l) => l.day === 2).map((l) => l.text).join('\n');
  assert.doesNotMatch(last, /fell to/, 'a draw is not reported as a death');
  assert.match(last, /draw/i);
  assert.equal(acknowledgeReport(s).ok, true, 'the run goes on');
});

test('battle report: logs of very long fights are capped (first 1500 + last 500 lines)', () => {
  // nobody can hurt anybody and the cap is far away: thousands of attacks
  const cfg = cfgWith({ adventurer: { unarmedDamage: 0 }, enemies: { tiers: { normal: { damage: 0 } } }, combat: { safetyCapSeconds: 4000 } });
  const s = game(3);
  toDay2(s, (st) => plan(tierIndex(st, 'normal')), cfg);
  const rep = endDay(s, cfg).report;
  assert.equal(rep.draw, true);
  const total = rep.summary.A.attacks + rep.summary.E.attacks;
  assert.ok(total > 2000, `only ${total} attacks`);
  assert.equal(rep.log.length, 2000);
  assert.equal(rep.logTrimmed, total - 2000);
  // the kept lines are the first 1500 and the last 500, in order
  for (let i = 1; i < rep.log.length; i++) assert.ok(rep.log[i].t >= rep.log[i - 1].t);
  assert.ok(rep.log[0].t <= 2.5, 'starts with the first attacks');
  assert.ok(rep.log[1999].t > cfg.combat.safetyCapSeconds - 3, 'ends with the last attacks');
  assert.ok(rep.log[1500].t - rep.log[1499].t > 100, 'a gap where the middle was cut');
  assert.equal(rep.time, cfg.combat.safetyCapSeconds);
  // the capped report is what gets saved
  assert.equal(s.battles[s.battles.length - 1].log.length, 2000);
  assert.deepEqual(deserialize(serialize(s)).battles.at(-1).logTrimmed, rep.logTrimmed);
});

test('battle uses the plan\'s rings (health ring raises max HP)', () => {
  const s = game(11);
  const set = fullSet(s, 'mythril', 'S');
  const hp = addRing(s, 'health', 'S');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), set.map((g) => g.id), [hp.id]), WIN);
  assert.deepEqual(adventurerRingTotals(s), { health: ringVal('health', 'S') });
  assert.deepEqual(adventurerRingTotals(s, []), {});
  const rep = endDay(s, WIN).report;
  assert.ok(Math.abs(rep.advMaxHp - CONFIG.adventurer.hp * (1 + ringVal('health', 'S') / 100)) < 1e-9);
});

test('resolveBattle is reproducible from a saved state', () => {
  const s = game(21);
  const set = fullSet(s, 'iron', 'B');
  toDay2(s, (st) => plan(tierIndex(st, 'elite'), set.map((g) => g.id)));
  const copy = deserialize(serialize(s));
  const a = endDay(s).report;
  const b = endDay(copy).report;
  assert.deepEqual(a, b);
  assert.deepEqual(a.packedIds, set.map((g) => g.id));
});

// ------------------------------------------------------------ intel + days ----
test('intel point at the end of every daysPerPoint-th day, not on other days', () => {
  for (const dpp of [CONFIG.intel.daysPerPoint, 3]) {
    const cfg = cfgWith(WEAK_ENEMIES, { intel: { daysPerPoint: dpp } });
    const last = 2 * dpp;
    const s = game(31, cfg);
    const set = fullSet(s, 'mythril', 'S');
    let day = 1;
    while (day <= last) {
      const r = endDay(s, cfg);
      assert.equal(r.ok, true);
      if (r.report) {
        assert.equal(r.report.win, true, `day ${day} fight lost`);
        acknowledgeReport(s);
      }
      assert.equal(s.intel.points, Math.floor(day / dpp), `after day ${day} (every ${dpp} days)`);
      for (const g of set) g.durability = 100; // keep the test about intel, not wear
      const res = confirmPlan(s, plan(tierIndex(s, 'normal'), set.map((g) => g.id)), cfg);
      assert.equal(res.ok, true, res.msg);
      day += 1;
      assert.equal(s.day, day);
      assert.equal(s.roster.day, day + 1);
      assert.equal(s.plan.day, day);
      assert.equal(s.plan.enemy.day, day, 'the enemy was generated for the fight day');
    }
    const fights = last - 1;
    assert.equal(s.stats.fights, fights);
    assert.equal(s.stats.wins.normal, fights);
    assert.equal(s.stats.score, fights * CONFIG.enemies.tiers.normal.score);
    assert.equal(s.rings.length, fights);
    assert.equal(new Set(s.rings.map((r) => r.id)).size, fights);
    assert.equal(s.stats.bestDay, last + 1);
  }
});

test('score: each win adds the enemy tier\'s score', () => {
  for (const tier of Object.keys(CONFIG.enemies.tiers)) {
    const s = game(5);
    toDay2(s, (st) => plan(tierIndex(st, tier)), WIN);
    endDay(s, WIN);
    assert.equal(s.stats.score, CONFIG.enemies.tiers[tier].score, tier);
    assert.equal(s.stats.wins[tier], 1);
  }
});

// -------------------------------------------------------------- regrowth ----
test('confirmPlan regrows searched cells overnight (regrowPctPerDay); piles and boulders stay', () => {
  const searchedCells = (s) => Object.values(s.map.fields).flatMap((f) => f.cells).filter((c) => c.searched > 0);
  const prep = (cfg) => {
    const s = game(8, cfg);
    for (const f of Object.values(s.map.fields)) {
      f.cells.filter((c) => !c.boulder).slice(0, 5).forEach((c) => { c.searched = 100; c.items = []; c.debris = 0; });
      f.pile = ['ore:iron'];
    }
    endDay(s, cfg);
    return s;
  };
  const none = cfgWith({ field: { regrowPctPerDay: 0 } });
  const s0 = prep(none);
  const n = searchedCells(s0).length;
  assert.ok(n > 0);
  confirmPlan(s0, plan(0), none);
  assert.equal(searchedCells(s0).length, n, '0%: nothing regrows');
  assert.ok(!s0.log.some((l) => /regrew/.test(l.text)));

  const all = cfgWith({ field: { regrowPctPerDay: 100 } });
  const s1 = prep(all);
  confirmPlan(s1, plan(0), all);
  assert.equal(searchedCells(s1).length, 0, '100%: every searched cell is fresh');
  for (const f of Object.values(s1.map.fields)) {
    assert.deepEqual(f.pile, ['ore:iron'], 'the pile stays');
    assert.equal(f.cells.filter((c) => c.boulder).length, CONFIG.field.boulders, 'boulders stay');
  }
  assert.match(s1.log.find((l) => /regrew/.test(l.text)).text, new RegExp(`${n} searched cell`));
  // regrowth happens once per night, and the roster is unaffected by it
  assert.equal(s1.day, 2);
  assert.equal(s1.roster.day, 3);
});

test('spec: fields do not regrow (regrowPctPerDay is 0), so nights leave every field untouched', () => {
  assert.equal(CONFIG.field.regrowPctPerDay, 0);
  // WEAK_ENEMIES only changes the enemies, so the field rules are the real ones
  const cfg = WIN;
  assert.deepEqual(cfg.field, CONFIG.field);
  const s = game(8, cfg);
  for (const f of Object.values(s.map.fields)) {
    f.cells.filter((c) => !c.boulder).slice(0, 10).forEach((c, i) => { c.searched = i < 5 ? 100 : 40; c.debris = 0; });
    f.pile = ['ore:iron'];
  }
  const fields = structuredClone(s.map.fields);
  for (let night = 0; night < 10; night++) {
    assert.equal(endDay(s, cfg).ok, true);
    if (s.phase === 'report') acknowledgeReport(s);
    assert.equal(confirmPlan(s, plan(0), cfg).ok, true);
    assert.deepEqual(s.map.fields, fields, `night ${night + 1}`);
  }
  assert.ok(!s.log.some((l) => /regrew/.test(l.text)));
});

// --------------------------------------------------------------- roster view --
test('rosterView: known levels follow intel', () => {
  const s = game(8);
  const v = rosterView(s);
  assert.equal(v.length, 7);
  for (const row of v) for (const [k, lv] of Object.entries(row.known)) assert.equal(row.enemy.levels[k], lv);
  s.intel.spent.enemySight = 1000; // far past the cap: maxChance (100%)
  for (const row of rosterView(s)) assert.deepEqual(row.known, row.enemy.levels);
});

// ------------------------------------------------------------------ save ----
test('serialize / deserialize roundtrip (fresh game and mid-run)', () => {
  const s = game(9);
  assert.deepEqual(deserialize(serialize(s)), s);
  const set = fullSet(s, 'mythril', 'S');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), set.map((g) => g.id)), WIN);
  endDay(s, WIN);
  assert.equal(s.phase, 'report');
  const back = deserialize(serialize(s));
  assert.deepEqual(back, s);
  // the restored state keeps playing identically
  assert.equal(acknowledgeReport(s).ok, true);
  assert.equal(acknowledgeReport(back).ok, true);
  const p = plan(tierIndex(s, 'elite'), set.filter((g) => s.gear.includes(g)).map((g) => g.id));
  assert.equal(confirmPlan(s, p, WIN).ok, true);
  assert.equal(confirmPlan(back, p, WIN).ok, true);
  assert.equal(serialize(back), serialize(s));
});

test('deserialize rejects other save versions and junk', () => {
  const s = game(9);
  assert.throws(() => deserialize(JSON.stringify({ ...s, version: SAVE_VERSION + 1 })), /Incompatible/);
  assert.throws(() => deserialize(JSON.stringify({ ...s, version: 0 })), /Incompatible/);
  assert.throws(() => deserialize(JSON.stringify({ ...s, version: String(SAVE_VERSION) })), /Incompatible/);
  assert.throws(() => deserialize('null'), /Incompatible/);
  assert.throws(() => deserialize('{not json'));
});

test('versions: the game version is exported; saves are version 2 (v1.1 field model)', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+$/);
  assert.ok(Number(VERSION) >= 1.1, VERSION);
  assert.ok(SAVE_VERSION >= 2);
  assert.equal(newGame(1).version, SAVE_VERSION);
});

// ------------------------------------------------------------ v1.0 saves ----
// Turn a current game into what v1.0 saved: no piles, items on the ground of cells, debris true/false,
// no boulders, a loadMark, version 1.
function toV1(s) {
  const v1 = structuredClone(s);
  v1.version = 1;
  v1.loadMark = v1.bag.length;
  for (const f of Object.values(v1.map.fields)) {
    delete f.pile;
    for (const c of f.cells) {
      c.debris = c.debris > 0;
      delete c.boulder;
      c.ground = [];
    }
  }
  return v1;
}

test('migrateV1: ground items -> the field\'s pile, debris true/false -> thickness, no boulders, no loadMark', () => {
  const s = game(31);
  const v1 = toV1(s);
  const keys = Object.keys(v1.map.fields);
  // ground items in two cells of one field and one cell of another
  v1.map.fields[keys[0]].cells[3].ground = ['ore:copper', 'gem:ruby'];
  v1.map.fields[keys[0]].cells[40].ground = ['ore:mythril'];
  v1.map.fields[keys[1]].cells[0].ground = ['gem:diamond'];
  const wasDebris = Object.fromEntries(keys.map((k) => [k, v1.map.fields[k].cells.map((c) => c.debris)]));
  assert.ok(Object.values(wasDebris).flat().some((d) => d === true), 'some v1 debris to convert');
  const m = migrateV1(structuredClone(v1));
  assert.equal(m.version, SAVE_VERSION);
  assert.equal('loadMark' in m, false);
  assert.deepEqual(m.map.fields[keys[0]].pile, ['ore:copper', 'gem:ruby', 'ore:mythril']);
  assert.deepEqual(m.map.fields[keys[1]].pile, ['gem:diamond']);
  const { min, max } = CONFIG.field.debrisAmount;
  const thick = new Set();
  for (const k of keys) {
    const f = m.map.fields[k];
    assert.ok(Array.isArray(f.pile));
    if (k !== keys[0] && k !== keys[1]) assert.deepEqual(f.pile, []);
    f.cells.forEach((c, i) => {
      assert.equal('ground' in c, false);
      assert.equal(c.boulder, false, 'v1 fields had no boulders');
      if (wasDebris[k][i]) {
        assert.ok(Number.isInteger(c.debris) && c.debris >= min && c.debris <= max, `${c.debris}`);
        thick.add(c.debris);
      } else assert.equal(c.debris, 0);
    });
  }
  assert.equal(thick.size, 1, 'every old debris cell gets the same thickness');
  // the thickness follows the config's range
  const cfg = cfgWith({ field: { debrisAmount: { min: 100, max: 110 } } });
  const m2 = migrateV1(structuredClone(v1), cfg);
  const d2 = Object.values(m2.map.fields).flatMap((f) => f.cells).map((c) => c.debris).filter((d) => d > 0);
  assert.ok(d2.length > 0 && d2.every((d) => d >= 100 && d <= 110));
  // other parts of the save are kept
  assert.deepEqual(m.storage, s.storage);
  assert.deepEqual(m.skills, s.skills);
  assert.deepEqual(m.roster, s.roster);
  assert.deepEqual(m.rng, s.rng);
});

test('deserialize accepts a v1.0 save, migrates it, and the game plays on', () => {
  const s = game(32);
  const c = fieldAt(s, 1);
  assert.equal(travel(s, { x: c.x, y: c.y }).ok, true);
  const v1 = toV1(s);
  const fv1 = fieldOf(v1, c);
  fv1.cells[0].ground = ['ore:iron', 'ore:coal'];
  fv1.cells.forEach((cl) => { cl.debris = false; });
  fv1.cells[idx(1, 1)].debris = true; // the center of the search below
  const back = deserialize(JSON.stringify(v1));
  assert.equal(back.version, SAVE_VERSION);
  const f = currentField(back);
  assert.deepEqual(f.pile, ['ore:iron', 'ore:coal']);
  assert.ok(f.cells[idx(1, 1)].debris > 0);
  // search: clears the old debris first; found items join the pile
  const r = search(back, 1, 1);
  assert.equal(r.ok, true, r.msg);
  assert.ok(r.debrisCleared > 0);
  assert.ok(fieldProgress(f) > 0);
  assert.equal(f.pile.length, 2 + r.found.length);
  // carry the pile home
  assert.equal(setCarry(back, { pile: f.pile.map((_, i) => i) }).ok, true);
  const before = back.storage.ore.iron;
  assert.equal(travel(back, back.map.camp).ok, true);
  assert.equal(back.storage.ore.iron, before + 1 + r.found.filter((t) => t === 'ore:iron').length);
  assert.deepEqual(f.pile, []);
  // a migrated save serializes as the current version
  assert.equal(JSON.parse(serialize(back)).version, SAVE_VERSION);
  assert.deepEqual(deserialize(serialize(back)), back);
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
