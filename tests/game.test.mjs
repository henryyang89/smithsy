import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS, BARS, GRADES, SLOTS } from '../js/config.js';
import * as GameModule from '../js/core/game.js';
import {
  newGame, endDay, acknowledgeReport, validatePlan, confirmPlan, rosterView, serialize, deserialize,
  adventurerRingTotals, logResult, addLog, packedSlotsSummary, saveKeyFor, SAVE_KEY, BEST_KEY, oldSaveKeys, MAX_LOG,
} from '../js/core/game.js';
import { ringLabel } from '../js/core/rings.js';
import { spendIntel, canSpendIntel } from '../js/core/intel.js';
import { generateRoster } from '../js/core/enemies.js';
import { makeRng } from '../js/core/rng.js';
import { repair } from '../js/core/gear.js';
import { travel } from '../js/core/map.js';
import { VERSION } from '../js/version.js';
import { game, cfgWith, addGear, addRing, fullSet, fieldAt, ringVal, spendAllIntel, WEAK_ENEMIES, DEADLY_ENEMIES, DAY_START, DAY_END } from './helpers.mjs';

const tierIndex = (s, tier) => s.roster.enemies.findIndex((e) => e.tier === tier);
const plan = (enemyIndex, gearIds = [], ringIds = []) => ({ enemyIndex, gearIds, ringIds });
// Fight outcomes fixed by config, so these tests check the day flow, not the balance.
const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);
// Durability loss per used item in a fight against a normal enemy with no Gear care: the roll x the tier multiplier, to one decimal, at least 1.
const { min: ROLL_MIN, max: ROLL_MAX } = CONFIG.gear.durabilityLoss;
const NORMAL_MULT = CONFIG.gear.durabilityLoss.tierMult?.normal ?? 1;
const LOSS_MIN = Math.max(1, Math.round(ROLL_MIN * NORMAL_MULT * 10) / 10);
const LOSS_MAX = Math.max(1, Math.round(ROLL_MAX * NORMAL_MULT * 10) / 10);
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
  assert.equal(s.version, VERSION);
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
  assert.deepEqual(Object.keys(s.groups.defeats), Object.keys(CONFIG.groups.list), 'one defeat counter per banner');
  assert.ok(Object.values(s.groups.defeats).every((n) => n === 0));
  assert.deepEqual(s.groups.extra, Object.fromEntries(SLOTS.map((sl) => [sl, 0])), 'no pack mules yet');
  assert.equal(s.groups.earned, 0);
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
test('validatePlan: enemy required, max packLimit gear per gear type, adventurer rings only, max 10 rings', () => {
  const s = game(1);
  const [sw1, sw2, sw3] = [addGear(s, 'sword'), addGear(s, 'sword'), addGear(s, 'sword')];
  const ch = addGear(s, 'chest');
  assert.equal(validatePlan(s, plan(7)), 'Pick an enemy.');
  assert.equal(validatePlan(s, plan(-1)), 'Pick an enemy.');
  assert.equal(validatePlan(s, plan(0, [sw1.id, sw2.id, ch.id])), null);
  const per = CONFIG.plan.perSlot;
  assert.equal(validatePlan(s, plan(0, [sw1.id, sw2.id, sw3.id])), `At most ${per} swords.`);
  // a pack mule for swords lifts the limit of that gear type only
  s.groups.extra.sword = 1;
  assert.equal(validatePlan(s, plan(0, [sw1.id, sw2.id, sw3.id])), null, 'three swords with a sword pack mule');
  assert.equal(validatePlan(s, plan(0, [sw1.id, sw2.id, sw3.id, addGear(s, 'sword').id])), `At most ${per + 1} swords.`);
  const [c1, c2, c3] = [ch, addGear(s, 'chest'), addGear(s, 'chest')];
  assert.equal(validatePlan(s, plan(0, [c1.id, c2.id, c3.id])), `At most ${per} chests.`, 'other gear types keep the base limit');
  s.groups.extra.sword = 0;
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
  assert.deepEqual(s.plan, { day: 2, enemy, gearIds: [sw.id], ringIds: [advA.id], shownEstimate: null });
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
  // snapshots: what was used, and what was packed but not used (the spare sword); the home boots are in neither
  assert.deepEqual(rep.used.map((g) => g.id), rep.usedIds);
  assert.deepEqual(rep.notUsed.map((g) => g.id), [spareSword.id]);
  assert.ok(![...rep.used, ...rep.notUsed].some((g) => g.id === unpacked.id), 'gear left at home is never listed');
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
  for (const w of rep.wear) assert.ok(w.loss >= LOSS_MIN && w.loss <= LOSS_MAX && w.left === Math.round((100 - w.loss) * 10) / 10);
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
  const spare = addGear(s, 'sword', 'copper', 'D', null, { durability: 1 });
  for (const g of set) g.durability = 1; // every fight costs every used item at least 1%
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), [...set.map((g) => g.id), spare.id]), WIN);
  const rep = endDay(s, WIN).report;
  assert.equal(rep.win, true);
  assert.equal(rep.destroyed.length, 5);
  for (const g of set) assert.ok(!s.gear.includes(g), `${g.slot} should be gone`);
  assert.ok(s.gear.includes(spare), 'unused item survives');
  assert.equal(spare.durability, 1);
  for (const w of rep.wear) assert.equal(w.left, 0);
});

test('the report keeps snapshots of the gear used and not used: SLOTS order, durability before the fight, own copies', () => {
  const s = game(11);
  // added out of slot order on purpose; every item has a distinct durability and some have gems
  const boots = addGear(s, 'boots', 'mythril', 'S', null, { durability: 91.3 });
  const chest = addGear(s, 'chest', 'mythril', 'S', { type: 'ruby', grade: 'B' }, { durability: 77.7 });
  const sword = addGear(s, 'sword', 'mythril', 'S', { type: 'diamond', grade: 'A' }, { durability: 64.2 });
  const spareChest = addGear(s, 'chest', 'copper', 'D', null, { durability: 55.5 });
  const spareBoots = addGear(s, 'boots', 'copper', 'D', null, { durability: 33.3 });
  const home = addGear(s, 'helmet', 'copper', 'D', null, { durability: 22.2 });
  const packedIds = [boots.id, chest.id, sword.id, spareChest.id, spareBoots.id];
  const rings = [addRing(s, 'health', 'B', false), addRing(s, 'dodge', 'C', false)];
  const before = new Map(s.gear.map((g) => [g.id, g.durability]));
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), packedIds, rings.map((r) => r.id)), WIN);
  const rep = endDay(s, WIN).report;
  assert.equal(rep.win, true);
  const slotRank = (g) => ['sword', 'chest', 'helmet', 'gloves', 'boots'].indexOf(g.slot);
  // used: the best item per slot, in SLOTS order, ids = usedIds
  assert.deepEqual(rep.used.map((g) => g.id), rep.usedIds);
  assert.deepEqual(rep.used.map((g) => g.id), [sword.id, chest.id, boots.id]);
  assert.deepEqual(rep.used.map(slotRank), [...rep.used.map(slotRank)].sort((a, b) => a - b));
  // notUsed = packed - used, also in SLOTS order; home gear is in neither
  assert.deepEqual(rep.notUsed.map((g) => g.id), [spareChest.id, spareBoots.id]);
  assert.deepEqual([...rep.used, ...rep.notUsed].map((g) => g.id).sort((a, b) => a - b), [...packedIds].sort((a, b) => a - b));
  assert.deepEqual([...rep.used.map((g) => g.id), ...rep.notUsed.map((g) => g.id)].filter((id) => id === home.id), []);
  // a snapshot is a full description with the durability BEFORE the fight
  for (const snap of [...rep.used, ...rep.notUsed]) {
    assert.deepEqual(Object.keys(snap).sort(), ['durability', 'gem', 'grade', 'id', 'material', 'slot']);
    assert.equal(snap.durability, before.get(snap.id), `#${snap.id} before the fight`);
    const live = s.gear.find((g) => g.id === snap.id);
    if (live) {
      assert.equal(snap.slot, live.slot);
      assert.equal(snap.material, live.material);
      assert.equal(snap.grade, live.grade);
      assert.deepEqual(snap.gem, live.gem);
      if (live.gem) assert.notEqual(snap.gem, live.gem, 'the gem is copied, not shared');
    }
  }
  // the used items wore, the snapshots did not change with them
  assert.ok(s.gear.find((g) => g.id === sword.id).durability < before.get(sword.id));
  assert.equal(rep.used[0].durability, before.get(sword.id));
  assert.equal(rep.used.find((g) => g.id === chest.id).gem.type, 'ruby');
  // the other new report fields start out empty/filled as planned
  assert.equal(rep.analysis, null);
  assert.equal(rep.planEstimate, null);
  assert.deepEqual(rep.ringTotals, adventurerRingTotals(s, rings.map((r) => r.id)));
  assert.ok(rep.ringTotals.health > 0 && rep.ringTotals.dodge > 0);
  assert.equal(JSON.parse(JSON.stringify(rep)).used.length, 3, 'snapshots survive a save');
  assert.equal(s.battles.at(-1), rep);
});

test('the report says "no gear used" with empty snapshots when the adventurer fights unarmed (and lists nothing from home)', () => {
  const s = game(11);
  const home = addGear(s, 'sword', 'mythril', 'S');
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), []), WIN);
  const rep = endDay(s, WIN).report;
  assert.deepEqual(rep.used, []);
  assert.deepEqual(rep.notUsed, []);
  assert.equal(home.durability, 100);
});

test('resolveBattle with 3 items per gear type stays bounded: the adventurer thinks through at most searchPasses x items + 1 gear combinations', () => {
  const s = game(11);
  // 3 non-dominated items in each of the 5 gear types (the same base with a different gem): 243 combinations
  const gems = ['ruby', 'topaz', 'sapphire'];
  const items = SLOTS.flatMap((slot) => gems.map((t) => addGear(s, slot, 'iron', 'C', { type: t, grade: 'C' })));
  assert.equal(items.length, 15);
  assert.ok(3 ** 5 > CONFIG.sim.maxExactCombos);
  toDay2(s, (st) => plan(tierIndex(st, 'normal'), []), WIN);
  // the plan screen allows 2 per type until banners; the battle itself must cope with any packed set
  s.plan.gearIds = items.map((g) => g.id);
  for (const g of items) g.packed = true;
  const rep = endDay(s, WIN).report;
  assert.equal(rep.usedIds.length, 5, 'one item per type');
  assert.equal(rep.used.length + rep.notUsed.length, 15);
  assert.equal(rep.notUsed.length, 10);
  const cap = CONFIG.sim.searchPasses * items.length + 1;
  assert.ok(rep.loadoutsTried >= 1 && rep.loadoutsTried <= cap, `${rep.loadoutsTried} combinations tried (at most ${cap})`);
  // that is at most (maxExactCombos + searchPasses x 15) x bestGearFights simulated fights
  assert.ok(rep.loadoutsTried * CONFIG.combat.bestGearFights <= (CONFIG.sim.maxExactCombos + CONFIG.sim.searchPasses * items.length) * CONFIG.combat.bestGearFights);
  // with 2 per type (32 combinations) every combination is tried
  const t = game(11);
  const two = SLOTS.flatMap((slot) => gems.slice(0, 2).map((g) => addGear(t, slot, 'iron', 'C', { type: g, grade: 'C' })));
  toDay2(t, (st) => plan(tierIndex(st, 'normal'), two.map((g) => g.id)), WIN);
  assert.equal(endDay(t, WIN).report.loadoutsTried, 2 ** 5);
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
test('intel point at the end of every daysPerPoint-th day, not on other days; it must be spent before the next day', () => {
  for (const dpp of [CONFIG.intel.daysPerPoint, 3]) {
    const cfg = cfgWith(WEAK_ENEMIES, { intel: { daysPerPoint: dpp } });
    const last = 2 * dpp;
    const s = game(31, cfg);
    const set = fullSet(s, 'mythril', 'S');
    let day = 1;
    let spent = 0;
    while (day <= last) {
      const r = endDay(s, cfg);
      assert.equal(r.ok, true);
      if (r.report) {
        assert.equal(r.report.win, true, `day ${day} fight lost`);
        acknowledgeReport(s);
      }
      assert.equal(s.intel.points, Math.floor(day / dpp) - spent, `after day ${day} (every ${dpp} days)`);
      for (const g of set) g.durability = 100; // keep the test about intel, not wear
      const p = plan(tierIndex(s, 'normal'), set.map((g) => g.id));
      if (s.intel.points > 0) {
        const refused = confirmPlan(s, p, cfg);
        assert.equal(refused.ok, false, `day ${day}: an unspent point blocks the next day`);
        assert.match(refused.msg, /Spend your intel point/);
        assert.equal(s.phase, 'plan');
        assert.equal(s.day, day, 'nothing changed');
        spent += s.intel.points;
        spendAllIntel(s, cfg);
        assert.equal(s.intel.points, 0);
      }
      const res = confirmPlan(s, p, cfg);
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
    assert.equal(spent, 2, 'two points were earned and spent');
  }
});

test('confirmPlan refuses while an intel point can be spent, succeeds after spending, and when every track is maxed', () => {
  const s = game(14, WIN);
  endDay(s, WIN);
  s.intel.points = 1;
  const before = serialize(s);
  const refused = confirmPlan(s, plan(0), WIN);
  assert.equal(refused.ok, false);
  assert.equal(refused.msg, 'Spend your intel point first (Intel, at the top of this screen).');
  assert.equal(serialize(s), before, 'a refused confirm changes nothing');
  assert.equal(s.phase, 'plan');
  // the gate comes before the plan check: an invalid plan also says to spend the point first
  assert.match(confirmPlan(s, plan(99), WIN).msg, /Spend your intel point/);
  spendAllIntel(s, WIN);
  assert.equal(s.intel.points, 0);
  assert.equal(confirmPlan(s, plan(0), WIN).ok, true);
  // several points: all of them must go
  const t = game(15, WIN);
  endDay(t, WIN);
  t.intel.points = 3;
  assert.equal(confirmPlan(t, plan(0), WIN).ok, false);
  const first = Object.keys(WIN.intel.tracks)[0];
  assert.equal(spendIntel(t, first, WIN).ok, true);
  assert.equal(confirmPlan(t, plan(0), WIN).ok, false, 'two points left');
  assert.equal(spendIntel(t, first, WIN).ok, true);
  assert.equal(confirmPlan(t, plan(0), WIN).ok, false, 'one point left');
  spendAllIntel(t, WIN);
  assert.equal(confirmPlan(t, plan(0), WIN).ok, true);
  // every track maxed: a point cannot be spent, so it does not block the day
  const u = game(16, WIN);
  endDay(u, WIN);
  for (const k of Object.keys(WIN.intel.tracks)) u.intel.spent[k] = 1000;
  u.intel.points = 2;
  assert.equal(canSpendIntel(u, WIN), false);
  assert.equal(confirmPlan(u, plan(0), WIN).ok, true);
  assert.equal(u.intel.points, 2, 'the unspendable points stay');
});

test('the win estimate the plan screen showed goes to the battle report as planEstimate; missing or broken values become null', () => {
  const run = (shownEstimate) => {
    const s = game(17, WIN);
    endDay(s, WIN);
    const p = { ...plan(0), ...(shownEstimate === undefined ? {} : { shownEstimate }) };
    assert.equal(confirmPlan(s, p, WIN).ok, true);
    return { planned: s.plan.shownEstimate, report: endDay(s, WIN).report };
  };
  const shown = run({ winPct: 72, margin: 14 });
  assert.deepEqual(shown.planned, { winPct: 72, margin: 14 });
  assert.deepEqual(shown.report.planEstimate, { winPct: 72, margin: 14 });
  assert.deepEqual(run({ winPct: 100, margin: null }).report.planEstimate, { winPct: 100, margin: null });
  assert.equal(run(undefined).report.planEstimate, null, 'not finished when confirmed');
  assert.equal(run(null).report.planEstimate, null);
  assert.equal(run({ winPct: 'lots' }).report.planEstimate, null);
  // the estimate is part of the save while the fight is pending
  const s = game(18, WIN);
  endDay(s, WIN);
  confirmPlan(s, { ...plan(0), shownEstimate: { winPct: 55.5, margin: 20 } }, WIN);
  assert.deepEqual(deserialize(serialize(s)).plan.shownEstimate, { winPct: 55.5, margin: 20 });
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

// ------------------------------------------------------- fields at night ----
test('confirmPlan leaves every field unchanged: searched cells stay searched, piles and boulders stay, nothing is logged about it', () => {
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
    spendAllIntel(s, cfg);
    assert.equal(confirmPlan(s, plan(0), cfg).ok, true);
    assert.deepEqual(s.map.fields, fields, `night ${night + 1}`);
  }
  assert.ok(!s.log.some((l) => /overnight|regrew|grew back/i.test(l.text)));
});

test('confirmPlan draws from the game\'s random generator only for the new roster (no rolls for the fields)', () => {
  const s = game(12);
  endDay(s);
  const holder = { s: s.rng.s }; // the generator's state before confirming
  assert.equal(confirmPlan(s, plan(0)).ok, true);
  // replaying just the roster draw from that state gives the same roster and leaves the generator in the same place
  const roster = generateRoster(makeRng(holder), s.day + 1, CONFIG);
  assert.deepEqual(s.roster, roster);
  assert.equal(s.rng.s, holder.s, 'nothing else advanced the generator');
});

// --------------------------------------------------------------- roster view --
test('rosterView: known levels follow intel', () => {
  const s = game(8);
  const v = rosterView(s);
  assert.equal(v.length, 7);
  for (const row of v) for (const [k, lv] of Object.entries(row.known)) assert.equal(row.enemy.levels[k], lv);
  s.intel.spent.enemySight = 1000; // far past the cap: the track's max (100%)
  // elites and champions see a little less of that (tierMult); with every tier at 100% all attributes are known
  const all = cfgWith({ intel: { tracks: { enemySight: { tierMult: { normal: 100, elite: 100, champion: 100 } } } } });
  for (const row of rosterView(s, all)) assert.deepEqual(row.known, row.enemy.levels);
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

test('versions: VERSION is 2.0 and a new game is saved as that version (saves are per version)', () => {
  assert.equal(typeof VERSION, 'string');
  assert.match(VERSION, /^\d+\.\d+$/);
  assert.equal(VERSION, '2.0');
  assert.equal(newGame(1).version, VERSION);
  assert.equal(JSON.parse(serialize(newGame(1))).version, '2.0');
});

test('save keys: the save and best-score keys carry the game version', () => {
  assert.equal(saveKeyFor('2.0'), 'smithsy-save-2.0');
  assert.equal(saveKeyFor('1.2'), 'smithsy-save-1.2');
  assert.equal(SAVE_KEY, 'smithsy-save-2.0');
  assert.equal(SAVE_KEY, saveKeyFor(VERSION));
  assert.equal(BEST_KEY, 'smithsy-best-2.0');
  assert.equal(BEST_KEY, `smithsy-best-${VERSION}`);
  assert.notEqual(SAVE_KEY, BEST_KEY);
});

test('deserialize only loads a save of this very version: another version, a number, no version or junk all throw', () => {
  const s = game(9);
  const withVersion = (v) => JSON.stringify({ ...s, version: v });
  // 3 was 1.2's save format number; '1.2' is the old game version; '2.1' a future one
  for (const v of [3, 2, 1, 0, -1, '3', '1.2', '1.1', '2.1', '2.0.1', '3.0', 2.0, VERSION + ' ', '', null, true]) {
    assert.throws(() => deserialize(withVersion(v)), /Incompatible/, `version ${JSON.stringify(v)}`);
  }
  const noVersion = { ...s };
  delete noVersion.version;
  assert.throws(() => deserialize(JSON.stringify(noVersion)), /Incompatible/, 'missing version');
  assert.throws(() => deserialize('null'), /Incompatible/);
  assert.throws(() => deserialize('42'), /Incompatible/);
  assert.throws(() => deserialize('"2.0"'), /Incompatible/);
  assert.throws(() => deserialize('[]'), /Incompatible/);
  assert.throws(() => deserialize('{not json'));
  assert.throws(() => deserialize(''));
  assert.deepEqual(deserialize(withVersion('2.0')), s, 'this version loads');
});

test('deserialize: a save of this version whose skills or intel tracks do not match the config is refused (dev safety net)', () => {
  const s = game(9);
  const clone = () => JSON.parse(serialize(s));
  const bad = [];
  let a = clone(); delete a.skills.gearCare; bad.push(['a skill key removed', a]);
  a = clone(); delete a.skills.searchTime; bad.push(['another skill key removed', a]);
  a = clone(); a.skills.bogusSkill = { xp: 0, level: 0 }; bad.push(['an unknown skill key added', a]);
  a = clone(); delete a.intel.spent.groupSight; bad.push(['an intel track removed', a]);
  a = clone(); delete a.intel.spent.oreSight; bad.push(['ore sight removed', a]);
  a = clone(); a.intel.spent.bogusTrack = 0; bad.push(['an unknown intel track added', a]);
  a = clone(); delete a.intel; bad.push(['no intel at all', a]);
  a = clone(); delete a.skills; bad.push(['no skills at all', a]);
  for (const [why, save] of bad) assert.throws(() => deserialize(JSON.stringify(save)), /Save|skills|intel/, why);
  // a config with an extra track no longer matches a save written without it
  const more = cfgWith({ intel: { tracks: { newTrack: { name: 'New', unit: '%', base: 0, gains: [1], max: 10, desc: 'x' } } } });
  assert.throws(() => deserialize(serialize(s), more), /intel/);
  assert.doesNotThrow(() => deserialize(serialize(s)));
});

test('oldSaveKeys: keeps the keys of other versions\' saves, drops the current key, backups and unrelated keys', () => {
  const keys = ['smithsy-save-v1', 'smithsy-save-v2', 'smithsy-save-v3', 'smithsy-save-1.0', 'smithsy-save-2.1', SAVE_KEY,
    'smithsy-save-backup-1727000000000', 'smithsy-best-2.0', 'smithsy-best-v1', 'other-app', 'smithsy-saved', 'xsmithsy-save-v3'];
  assert.deepEqual(oldSaveKeys(keys), ['smithsy-save-v1', 'smithsy-save-v2', 'smithsy-save-v3', 'smithsy-save-1.0', 'smithsy-save-2.1']);
  assert.deepEqual(oldSaveKeys([SAVE_KEY]), []);
  assert.deepEqual(oldSaveKeys(['smithsy-save-backup-1', 'smithsy-save-backup-2.0']), [], 'backups are not saves of another version');
  assert.deepEqual(oldSaveKeys([]), []);
  assert.deepEqual(oldSaveKeys(['smithsy-save-2.0']), []);
  assert.deepEqual(oldSaveKeys(['smithsy-save-2.0'], 'smithsy-save-3.0'), ['smithsy-save-2.0'], 'the current key can be given');
  // it reads an array-like list without changing it
  const input = ['smithsy-save-v3', SAVE_KEY];
  oldSaveKeys(input);
  assert.deepEqual(input, ['smithsy-save-v3', SAVE_KEY]);
});

test('a new game\'s save is small: under 450,000 characters of JSON', () => {
  for (const seed of [1, 2, 3]) {
    const len = serialize(newGame(seed)).length;
    assert.ok(len < 450000, `seed ${seed}: ${len} characters`);
  }
});

test('migrations are gone: the game module exports no migrateV1, migrateV2, addMissingKeys, SAVE_VERSION or LEGACY_SAVE_KEYS', () => {
  for (const name of ['migrateV1', 'migrateV2', 'addMissingKeys', 'SAVE_VERSION', 'LEGACY_SAVE_KEYS']) {
    assert.equal(name in GameModule, false, `${name} should be gone`);
  }
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
