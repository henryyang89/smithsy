// Loss analysis (js/core/replay.js): replays of a lost fight and "would gear left at home have helped?".
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { endDay, confirmPlan, serialize } from '../js/core/game.js';
import { mixSeed } from '../js/core/rng.js';
import { adventurerCombatant } from '../js/core/combat.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { replayStats, homeGear, analyzeLoss, analyzeLossSync, cacheAnalysis, SEGMENTS } from '../js/core/replay.js';
import { game, cfgWith, addGear, DEADLY_ENEMIES } from './helpers.mjs';

const DEADLY = cfgWith(DEADLY_ENEMIES);
const N = CONFIG.report.replayFights;

// Day 2's fight against `tier`, lost. `setup(state)` adds the gear and returns the ids to pack. With `cfg` = DEADLY every fight
// is lost; with the real config the seed is searched until the fight is lost (the fight is random, not the replay).
function lostGame(setup, { tier = 'champion', cfg = CONFIG } = {}) {
  for (let seed = 1; seed < 400; seed++) {
    const s = game(seed, cfg);
    const packIds = setup(s);
    endDay(s, cfg);
    const idx = s.roster.enemies.findIndex((e) => e.tier === tier);
    assert.equal(confirmPlan(s, { enemyIndex: idx, gearIds: packIds, ringIds: [] }, cfg).ok, true);
    const { report } = endDay(s, cfg);
    if (!report.win && !report.draw) return { s, report, cfg };
  }
  throw new Error('no lost fight found');
}

test('replayStats is deterministic per seed, totals add up, the five parts add up to n', () => {
  const s = game(3);
  const adv = adventurerCombatant([], {}, CONFIG);
  const enemyC = enemyCombatant('elite', 2, Object.fromEntries(Object.keys(CONFIG.enemies.attributes).map((k) => [k, 'normal'])), 'E', CONFIG);
  const a = replayStats(adv, enemyC, 200, 77, CONFIG);
  const b = replayStats(adv, enemyC, 200, 77, CONFIG);
  assert.deepEqual(a, b);
  assert.equal(a.n, 200);
  assert.equal(a.wins + a.draws + a.losses, 200);
  assert.deepEqual(Object.keys(a.seg), SEGMENTS);
  assert.equal(Object.values(a.seg).reduce((x, y) => x + y, 0), 200);
  assert.equal(a.seg.lostBadly + a.seg.lostClose, a.losses);
  assert.equal(a.seg.wonClose + a.seg.wonEasily, a.wins);
  assert.equal(a.seg.draw, a.draws);
  assert.equal(a.winPct, (a.wins / 200) * 100);
  assert.notDeepEqual(replayStats(adv, enemyC, 200, 78, CONFIG), a, 'another seed, other luck');
  assert.equal(replayStats(adv, enemyC, 0, 1, CONFIG).winPct, 0);
  void s;
});

test('replayStats: an unbeatable enemy is lost badly every time; a harmless one is won easily every time', () => {
  const adv = adventurerCombatant([], {}, CONFIG);
  const lethal = enemyCombatant('champion', 2, Object.fromEntries(Object.keys(CONFIG.enemies.attributes).map((k) => [k, 'normal'])), 'E', DEADLY);
  const lost = replayStats(adv, lethal, 50, 1, DEADLY);
  assert.deepEqual([lost.wins, lost.losses, lost.seg.lostBadly], [0, 50, 50]);
  const weak = enemyCombatant('normal', 2, Object.fromEntries(Object.keys(CONFIG.enemies.attributes).map((k) => [k, 'normal'])), 'E', cfgWith({ enemies: { tiers: { normal: { hp: 0.01, damage: 1e-6 } } } }));
  const won = replayStats(adv, weak, 50, 1, CONFIG);
  assert.deepEqual([won.wins, won.seg.wonEasily], [50, 50]);
  assert.equal(won.winPct, 100);
});

test('closeCut splits "close" from "badly": a pinned cut moves fights between the two parts', () => {
  const adv = adventurerCombatant([], {}, CONFIG);
  const enemyC = enemyCombatant('champion', 2, Object.fromEntries(Object.keys(CONFIG.enemies.attributes).map((k) => [k, 'normal'])), 'E', CONFIG);
  const wide = replayStats(adv, enemyC, 300, 5, cfgWith({ report: { closeCut: 100 } }));
  assert.equal(wide.seg.lostBadly, 0, 'a cut of 100% leaves nothing "badly"');
  const none = replayStats(adv, enemyC, 300, 5, cfgWith({ report: { closeCut: 0 } }));
  assert.equal(none.seg.lostClose, 0);
  assert.equal(none.losses, wide.losses, 'the same fights, only sorted differently');
});

test('analyzeLossSync on a lost game: the replay is replayStats of the report\'s fight with seed mixSeed(seed, day, 501)', () => {
  const { s, report } = lostGame((st) => [addGear(st, 'sword', 'copper', 'D').id]);
  const a = analyzeLossSync(s, report, CONFIG);
  const want = replayStats(report.adv, report.enemyC, N, mixSeed(s.seed, report.day, 501), CONFIG);
  assert.deepEqual(a.used, want);
  assert.equal(a.n, N);
  assert.equal(a.seed, mixSeed(s.seed, report.day, 501));
  assert.deepEqual(a.thisFight, { enemyHpPct: (report.enemyHp / report.enemyMaxHp) * 100, advHpPct: (report.advHp / report.advMaxHp) * 100 });
  assert.equal(analyzeLossSync(s, report, CONFIG).used.wins, a.used.wins, 'deterministic');
});

test('a mythril S sword at home against a copper D sword used: the verdict is "helped", with the gain and the swap', () => {
  const cfg = cfgWith({ combat: { bestGearFights: 50 } });
  let home;
  let used;
  const { s, report } = lostGame((st) => {
    used = addGear(st, 'sword', 'copper', 'D');
    home = addGear(st, 'sword', 'mythril', 'S', { type: 'ruby', grade: 'S' });
    return [used.id];
  }, { cfg });
  const a = analyzeLossSync(s, report, cfg);
  assert.deepEqual(homeGear(s, report).map((g) => g.id), [home.id]);
  assert.equal(a.whatIf.verdict, 'helped');
  assert.ok(a.whatIf.gain >= cfg.report.whatIfMinGain);
  assert.equal(a.whatIf.gain, a.whatIf.best.winPct - a.used.winPct);
  assert.deepEqual(a.whatIf.fromHome.map((g) => g.id), [home.id]);
  assert.deepEqual(a.whatIf.replaced.map((g) => g.id), [used.id]);
  assert.ok(a.whatIf.items.some((g) => g.id === home.id));
  assert.ok(a.whatIf.best.winPct > a.used.winPct);
});

test('everything owned was packed: "noHome", and the best of the packed gear is still worked out', () => {
  const { s, report } = lostGame((st) => [addGear(st, 'sword', 'copper', 'D').id, addGear(st, 'sword', 'iron', 'C').id], { cfg: DEADLY });
  assert.deepEqual(homeGear(s, report), []);
  const a = analyzeLossSync(s, report, DEADLY);
  assert.equal(a.whatIf.verdict, 'noHome');
  assert.deepEqual(a.whatIf.fromHome, []);
  assert.ok(a.whatIf.items.length >= 1);
});

test('only weaker gear at home: "notHelped" (the used sword wins some fights, the home sword loses the comparison)', () => {
  // The real enemies, a bit tougher: the used mythril S sword wins part of its fights, so the verdict comes from comparing
  // loadouts that really score differently (under DEADLY_ENEMIES every loadout wins 0% and "notHelped" would be automatic).
  const tough = cfgWith({ enemies: { tiers: Object.fromEntries(Object.entries(CONFIG.enemies.tiers).map(([t, v]) => [t, { hp: v.hp * 2.5, damage: v.damage * 2.5 }])) } });
  let strong;
  let weak;
  const { s, report } = lostGame((st) => {
    strong = addGear(st, 'sword', 'mythril', 'S');
    weak = addGear(st, 'sword', 'iron', 'C'); // stays at home
    return [strong.id];
  }, { cfg: tough });
  const a = analyzeLossSync(s, report, tough);
  assert.deepEqual(homeGear(s, report).map((g) => g.id), [weak.id]);
  assert.ok(a.used.winPct > 0 && a.used.winPct < 100, `the used sword wins some of its fights (${a.used.winPct}%)`);
  const homeOnly = replayStats(adventurerCombatant([weak], {}, tough), report.enemyC, N, a.seed, tough);
  assert.ok(homeOnly.winPct < a.used.winPct, `the home sword really is weaker (${homeOnly.winPct}% against ${a.used.winPct}%)`);
  assert.equal(a.whatIf.verdict, 'notHelped');
  assert.deepEqual(a.whatIf.fromHome, []);
  assert.deepEqual(a.whatIf.items.map((g) => g.id), [strong.id], 'the best loadout is the sword that was used');
  assert.ok(a.whatIf.gain < tough.report.whatIfMinGain);
});

test('gear smithed on the fight day, after the packing, is not "left at home" (it did not exist when the player chose)', () => {
  let packedSword;
  let atHome;
  const { s, report } = lostGame((st) => {
    packedSword = addGear(st, 'sword', 'copper', 'D');
    atHome = addGear(st, 'sword', 'iron', 'C'); // really left at home
    return [packedSword.id];
  }, { cfg: DEADLY });
  // the fight is resolved at the end of the day, so something smithed on that day comes after the plan was confirmed
  assert.equal(report.lastGearId, atHome.id, 'the report remembers the highest gear id when the plan was confirmed');
  const late = addGear(s, 'sword', 'mythril', 'S'); // smithed after the plan was confirmed: its id is past lastGearId
  assert.ok(late.id > report.lastGearId);
  assert.deepEqual(homeGear(s, report).map((g) => g.id), [atHome.id], 'only the item that existed at the packing counts');
  const a = analyzeLossSync(s, report, DEADLY);
  assert.equal(a.whatIf.items.some((g) => g.id === late.id), false);
  assert.equal(a.whatIf.fromHome.some((g) => g.id === late.id), false);
});

test('a destroyed used item is still a candidate (its snapshot is what is tried)', () => {
  let worn;
  const { s, report } = lostGame((st) => {
    worn = addGear(st, 'sword', 'mythril', 'S', null, { durability: 1 });
    return [worn.id];
  }, { cfg: DEADLY });
  assert.equal(s.gear.some((g) => g.id === worn.id), false, 'the sword broke in the fight');
  assert.deepEqual(report.destroyed.length, 1);
  const a = analyzeLossSync(s, report, DEADLY);
  assert.deepEqual(a.whatIf.items.map((g) => g.id), [worn.id]);
  assert.equal(a.whatIf.verdict, 'noHome');
});

test('analyzeLoss (async) gives the same analysis as the sync one, progress rises to 1, and false cancels', async () => {
  const { s, report } = lostGame((st) => {
    const ids = [addGear(st, 'sword', 'copper', 'D').id, addGear(st, 'chest', 'iron', 'C').id];
    addGear(st, 'sword', 'iron', 'B'); // some gear at home too
    return ids;
  }, { cfg: DEADLY });
  const want = analyzeLossSync(s, report, DEADLY);
  const seen = [];
  const got = await analyzeLoss(s, report, DEADLY, (f) => { seen.push(f); });
  assert.deepEqual(got, want);
  assert.equal(seen[seen.length - 1], 1);
  assert.ok(seen.length > 3, 'several steps');
  for (let i = 1; i < seen.length; i++) assert.ok(seen[i] >= seen[i - 1], 'progress never goes back');
  assert.ok(seen.every((f) => f >= 0 && f <= 1));
  let calls = 0;
  assert.equal(await analyzeLoss(s, report, DEADLY, () => (++calls < 2)), null, 'a cancelled analysis has no result');
  assert.equal(calls, 2);
  assert.deepEqual(await analyzeLoss(s, report, DEADLY), want, 'without a progress callback too');
});

test('the analysis never changes the game (state serializes the same before and after) and cacheAnalysis keeps it on the report and its battle entry', () => {
  const { s, report } = lostGame((st) => {
    const ids = [addGear(st, 'sword', 'copper', 'D').id];
    addGear(st, 'sword', 'iron', 'B'); // at home
    return ids;
  }, { cfg: DEADLY });
  const before = serialize(s);
  const a = analyzeLossSync(s, report, DEADLY);
  assert.equal(serialize(s), before);
  assert.equal(report.analysis, null);
  cacheAnalysis(s, report, a);
  assert.equal(report.analysis, a);
  assert.equal(s.battles[s.battles.length - 1].analysis, a);
  // after a save and load the report and its battle entry are separate objects: both get it
  const loaded = JSON.parse(serialize(s));
  assert.notEqual(loaded.report, loaded.battles[loaded.battles.length - 1]);
  loaded.report.analysis = null;
  loaded.battles[loaded.battles.length - 1].analysis = null;
  cacheAnalysis(loaded, loaded.report, a);
  assert.deepEqual(loaded.battles[loaded.battles.length - 1].analysis, a);
});
