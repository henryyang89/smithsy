// The balance tool's player personas (R46), enemy choice, intel spending and command line (tools/balance.mjs).
// The tool only runs `main` when it is executed, so it can be imported here. The slow sections are only smoke-tested
// through the command line with --quick; their numbers are the tool's output, not test expectations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { CONFIG, GRADES, SLOTS } from '../js/config.js';
import { canSpendIntel, intelValue, intelValueFor, nextIntelGain } from '../js/core/intel.js';
import { endDay } from '../js/core/game.js';
import { defaultPack, packLimit } from '../js/core/pack.js';
import { ringValue } from '../js/core/rings.js';
import { mixSeed, seededRng } from '../js/core/rng.js';
import { adventurerCombatant, fight } from '../js/core/combat.js';
import { enemyCombatant, rollLevels } from '../js/core/enemies.js';
import { VERSION } from '../js/version.js';
import {
  PERSONAS, PERSONA_KEYS, PICK_KEYS, BENCH_DAYS, DEATH_BINS, parseArgs, pickEnemy, gearLevel, spendIntelPoints, botParams, valueTables, runBot,
  choosePlan, withSets, intelModeSets, judge, targetFlags, mapAttempts, truePct, TRUTH,
} from '../tools/balance.mjs';
import { game, addGear, addRing } from './helpers.mjs';

const TOOL = fileURLToPath(new URL('../tools/balance.mjs', import.meta.url));
const TRACKS = Object.keys(CONFIG.intel.tracks);
const NAMES = Object.keys(PERSONAS);
const VT = valueTables(10, 5); // small value tables: these tests are about decisions, not about the balance
const TIER_NAMES = Object.keys(CONFIG.enemies.tiers);

// Runs the tool's command line; the output is the evidence.
function runTool(...args) {
  const r = spawnSync(process.execPath, [TOOL, ...args], { encoding: 'utf8', timeout: 120000 });
  assert.equal(r.status, 0, `balance.mjs ${args.join(' ')} failed:\n${r.stderr}`);
  return r.stdout;
}

// ------------------------------------------------------------- the personas ----
test('PERSONAS: exactly careful, champion and casual, each with every key the bot reads', () => {
  assert.deepEqual([...NAMES].sort(), ['careful', 'casual', 'champion']);
  for (const [name, p] of Object.entries(PERSONAS)) {
    for (const k of PERSONA_KEYS) assert.ok(k in p, `${name} has ${k}`);
    assert.ok(PICK_KEYS[p.pick], `${name}: a known way to pick (${p.pick})`);
    for (const k of PICK_KEYS[p.pick]) assert.ok(Number.isFinite(p[k]), `${name} has the number ${k} that its pick reads`);
    assert.ok(typeof p.name === 'string' && p.name.length > 0);
    assert.ok(p.trips >= 1 && p.minRate > 0 && p.swordBias > 0);
    assert.ok(['score', 'default'].includes(p.pack) && ['value', 'grade'].includes(p.rings) && ['value', 'default'].includes(p.carry));
    assert.ok(p.intel === 'roundRobin' || (Array.isArray(p.intel) && p.intel.length > 0));
  }
});

test('PERSONAS: every intel entry names a track (or *) and ends so that no point can be left over', () => {
  for (const [name, p] of Object.entries(PERSONAS)) {
    if (p.intel === 'roundRobin') continue;
    for (const [t, target] of p.intel) {
      assert.ok(t === '*' || TRACKS.includes(t), `${name}: ${t} is a track`);
      if (t !== '*') assert.ok(Number.isFinite(target), `${name}: ${t} has a target value`);
    }
    assert.equal(p.intel[p.intel.length - 1][0], '*', `${name}: the list ends with the catch-all, so every point is spent`);
  }
});

test('botParams merges the persona: its numbers, the sword weight, and the command line overrides', () => {
  const careful = botParams(VT, { persona: 'careful' });
  for (const name of NAMES) {
    const P = botParams(VT, { persona: name });
    const p = PERSONAS[name];
    assert.equal(P.persona, name);
    assert.equal(P.pick, p.pick);
    assert.equal(P.trips, p.trips);
    assert.equal(P.minRate, p.minRate);
    assert.equal(P.carry, p.carry);
    assert.equal(P.pack, p.pack);
    assert.equal(P.rings, p.rings);
    assert.equal(P.restBelow, p.restBelow);
    assert.equal(P.repairBelow, p.repairBelow);
    assert.equal(P.subBelow, p.subBelow);
    assert.ok(Math.abs(P.slotW.sword / careful.slotW.sword - p.swordBias) < 1e-9, 'only the sword slot weight changes with swordBias');
    for (const s of SLOTS.filter((x) => x !== 'sword')) assert.equal(P.slotW[s], careful.slotW[s]);
    if (p.pick !== 'looks') assert.equal(P.future, p.future);
  }
  assert.equal(botParams(VT, {}).persona, 'careful', 'careful is the default');
  const over = botParams(VT, { persona: 'careful', minwin: 70, future: 5, carry: 'default' });
  assert.equal(over.minWin, 70);
  assert.equal(over.future, 5);
  assert.equal(over.carry, 'default');
});

// ----------------------------------------------------------------- pickEnemy ----
// evals as choosePlan builds them: roster order (normals, elites, champions), p = the estimate in %, ev = expected value.
const evalsOf = (rows) => rows.map(([tier, p, ev], i) => ({ i, tier, p, ev }));

test('pickEnemy careful: the largest expected value among estimates >= minWin, otherwise the largest p', () => {
  const P = PERSONAS.careful;
  const hi = P.minWin + 5;
  // the normal is the surest, the elite is worth more: an estimate at minWin is enough for the larger expected value
  const evals = evalsOf([['normal', hi + 4, 900], ['elite', hi, 950], ['champion', P.minWin - 1, 5000]]);
  assert.equal(pickEnemy(P, null, evals).i, 1, 'max ev among p >= minWin (the champion is not sure enough)');
  assert.equal(pickEnemy(P, null, evalsOf([['normal', P.minWin, 500], ['elite', P.minWin, 500]])).i, 0, 'a tie keeps the lowest index');
  // nothing sure enough: the largest p, not the largest ev
  const none = evalsOf([['normal', P.minWin - 20, 100], ['elite', P.minWin - 10, 100], ['champion', P.minWin - 15, 9000]]);
  assert.equal(pickEnemy(P, null, none).i, 1);
  assert.equal(pickEnemy(P, null, []), null);
  // minWin itself is sure enough: the normal at exactly minWin beats the elite on value, the champion under it is out
  const edge = evalsOf([['normal', P.minWin, 10], ['elite', P.minWin + 3, 5], ['champion', P.minWin - 1, 9999]]);
  assert.equal(pickEnemy(P, null, edge).i, 0);
});

test('pickEnemy champion: a champion at champMin, else an elite at eliteMin, else the best value at 50%+, else the largest p', () => {
  const P = PERSONAS.champion;
  // a champion just over champMin beats a surer elite
  const a = evalsOf([['normal', 100, 160], ['elite', 99, 170], ['champion', P.champMin + 2, 130]]);
  assert.equal(pickEnemy(P, null, a).i, 2);
  // exactly champMin / eliteMin are enough
  assert.equal(pickEnemy(P, null, evalsOf([['elite', 99, 1], ['champion', P.champMin, 1]])).i, 1);
  assert.equal(pickEnemy(P, null, evalsOf([['normal', 99, 1000], ['elite', P.eliteMin, 1]])).i, 1);
  // two champions over the line: the surer one
  const b = evalsOf([['elite', 99, 1], ['champion', P.champMin + 2, 1], ['champion', P.champMin + 9, 1]]);
  assert.equal(pickEnemy(P, null, b).i, 2);
  // no champion that sure: the surest elite over eliteMin (a champion just under champMin does not count)
  const c = evalsOf([['normal', 99, 160], ['elite', P.eliteMin + 5, 1], ['elite', P.eliteMin + 9, 1], ['champion', P.champMin - 1, 1e6]]);
  assert.equal(pickEnemy(P, null, c).i, 2);
  // neither: the largest p/100 x (score + future) among p >= 50 (the elite is under eliteMin, the champion under champMin).
  // The plan's formula, not `ev`: the ring and banner extras that `ev` carries do not count here, so a big `ev` does not change the pick.
  const value = (x) => (x.p / 100) * (CONFIG.enemies.tiers[x.tier].score + P.future);
  const d = evalsOf([['normal', 90, 130], ['elite', P.eliteMin - 1, 150], ['champion', P.champMin - 1, 140]]);
  const dBest = d.reduce((best, x) => (value(x) > value(best) ? x : best));
  assert.equal(pickEnemy(P, null, d).i, dBest.i, 'the fallback uses p/100 x (score + future), not ev');
  const dMisled = d.map((x) => ({ ...x, ev: x.i === (dBest.i + 1) % d.length ? 1e6 : 0 }));
  assert.equal(pickEnemy(P, null, dMisled).i, dBest.i, 'ev (with ring and banner extras) is ignored by the champion fallback');
  // ... without ev given, it is the same formula with the champion persona's own future
  const e = evalsOf([['normal', 95], ['elite', 70], ['champion', 60]]).map((x) => ({ i: x.i, tier: x.tier, p: x.p }));
  const expected = e.reduce((best, x) => (value(x) > value(best) ? x : best));
  assert.equal(pickEnemy(P, null, e).i, expected.i);
  // nothing reaches 50%: the largest p
  const f = evalsOf([['normal', 40, 1e6], ['elite', 45, 1], ['champion', 20, 1]]);
  assert.equal(pickEnemy(P, null, f).i, 1);
});

// A game at the plan phase with gear that makes gearLevel exactly `level`: `level` <= 5 copper pieces in distinct gear types,
// above that all five types with (level - 5) of them in iron.
function gearedTo(level, seed = 11) {
  const s = game(seed);
  for (let i = 0; i < Math.min(5, level); i++) addGear(s, SLOTS[i], level > 5 && i < level - 5 ? 'iron' : 'copper', 'D');
  assert.equal(gearLevel(s), level);
  return s;
}
const lookEvals = (s) => s.roster.enemies.map((e, i) => ({ i, tier: e.tier, p: null, ev: null }));
// Make exactly `highs` of an enemy's attributes High and visible (every other attribute is Normal or hidden).
function showHighs(s, idx, highs) {
  const e = s.roster.enemies[idx];
  const keys = Object.keys(e.levels);
  keys.forEach((k, j) => {
    e.levels[k] = j < highs ? 'high' : 'normal';
    e.sight[k] = 0; // a roll of 0 is below any scouting chance above 0: visible
  });
}
function hideAll(s, idx) {
  const e = s.roster.enemies[idx];
  for (const k of Object.keys(e.sight)) e.sight[k] = 100.5; // never below the scouting chance
}

test('gearLevel: gear types owned plus gear types owned in iron or better', () => {
  assert.equal(gearLevel(game(1)), 0);
  const s = game(1);
  addGear(s, 'sword', 'copper', 'S');
  addGear(s, 'sword', 'copper', 'D');
  assert.equal(gearLevel(s), 1, 'two swords are one gear type');
  addGear(s, 'chest', 'iron', 'D');
  assert.equal(gearLevel(s), 3, 'a new type, in iron');
  addGear(s, 'helmet', 'steel', 'D');
  addGear(s, 'gloves', 'mythril', 'D');
  assert.equal(gearLevel(s), 7);
  addGear(s, 'boots', 'copper', 'B');
  assert.equal(gearLevel(s), 8);
  addGear(s, 'sword', 'iron', 'D', null, { durability: 3 });
  assert.equal(gearLevel(s), 9, 'a worn iron sword still counts as iron');
});

test('pickEnemy casual: ignores p; normals below the gear level, elites from it, never champions; fewest visible High, then lowest index', () => {
  const P = PERSONAS.casual;
  const L = P.gearLevelForElites;
  // below the level: a normal, and the lowest index among normals (they have no High attribute at all)
  const low = gearedTo(L - 1);
  const pickLow = pickEnemy(P, low, lookEvals(low));
  assert.equal(pickLow.tier, 'normal');
  assert.equal(pickLow.i, low.roster.enemies.findIndex((e) => e.tier === 'normal'));
  // from the level on: an elite
  const high = gearedTo(L);
  assert.equal(pickEnemy(P, high, lookEvals(high)).tier, 'elite');
  // among elites the fewest VISIBLE High attributes: the first elite shows 3, the second 1, the third hides its Highs
  const elites = high.roster.enemies.map((e, i) => i).filter((i) => high.roster.enemies[i].tier === 'elite');
  assert.ok(elites.length >= 3);
  showHighs(high, elites[0], 3);
  showHighs(high, elites[1], 1);
  hideAll(high, elites[2]);
  for (const k of Object.keys(high.roster.enemies[elites[2]].levels)) high.roster.enemies[elites[2]].levels[k] = 'high'; // hidden, so it does not count
  assert.equal(pickEnemy(P, high, lookEvals(high)).i, elites[2]);
  // a tie goes to the lowest index
  hideAll(high, elites[1]);
  assert.equal(pickEnemy(P, high, lookEvals(high)).i, elites[1]);
  // never a champion, whatever it shows
  for (const i of high.roster.enemies.map((e, j) => j)) {
    if (high.roster.enemies[i].tier === 'champion') hideAll(high, i);
    else showHighs(high, i, 12);
  }
  assert.notEqual(pickEnemy(P, high, lookEvals(high)).tier, 'champion');
  // p is never read: the same pick with a nonsense p
  const noisy = lookEvals(high).map((x) => ({ ...x, p: x.tier === 'champion' ? 100 : 0, ev: x.tier === 'champion' ? 1e9 : 0 }));
  assert.equal(pickEnemy(P, high, noisy).i, pickEnemy(P, high, lookEvals(high)).i);
  assert.equal(pickEnemy(P, high, lookEvals(high).map((x) => ({ i: x.i, tier: x.tier }))).i, pickEnemy(P, high, lookEvals(high)).i, 'p and ev may be missing');
});

// ----------------------------------------------------------- spending intel ----
// A reference for the plan's rule, written separately from the tool: the first listed track below its target that can still gain,
// '*' = the track with the fewest points that can still gain (config order on ties).
function expectedTrack(state, list) {
  const canGain = (t) => nextIntelGain(state, t) > 0;
  for (const [t, target] of list) {
    if (t === '*') {
      const open = TRACKS.filter(canGain);
      return open.length ? open.reduce((a, b) => (state.intel.spent[b] < state.intel.spent[a] ? b : a)) : null;
    }
    if (canGain(t) && intelValue(state, t) < target) return t;
  }
  return TRACKS.find(canGain) ?? null;
}

// Spend `points` one at a time, returning the track each went to.
function spendOneByOne(state, P, points) {
  const order = [];
  for (let i = 0; i < points; i++) {
    state.intel.points = 1;
    const before = { ...state.intel.spent };
    spendIntelPoints(state, P);
    const moved = TRACKS.filter((t) => state.intel.spent[t] !== before[t]);
    assert.ok(moved.length <= 1);
    order.push(moved[0] ?? null);
  }
  return order;
}

test('spendIntelPoints follows each persona\'s list, point by point', () => {
  for (const name of NAMES) {
    const P = botParams(VT, { persona: name });
    const list = PERSONAS[name].intel === 'roundRobin' ? [['*']] : PERSONAS[name].intel;
    const s = game(5);
    const ref = game(5);
    const order = spendOneByOne(s, P, 40);
    for (let i = 0; i < order.length; i++) {
      const want = expectedTrack(ref, list);
      assert.equal(order[i], want, `${name}: point ${i + 1} goes to ${want}`);
      if (want) {
        ref.intel.points = 1;
        ref.intel.spent[want] += 1;
        ref.intel.points = 0;
      }
    }
  }
});

test('spendIntelPoints: the careful list reaches its targets in order (the targets are real values of the tracks)', () => {
  const P = botParams(VT, { persona: 'careful' });
  const s = game(6);
  const order = spendOneByOne(s, P, 40);
  // the first entries in order: enemy scouting up to its target, then Battle simulation, then banner scouting, then ore sight
  const firstOf = (t) => order.indexOf(t);
  const [a, b, c, d] = PERSONAS.careful.intel;
  assert.equal(order[0], a[0]);
  assert.ok(firstOf(a[0]) < firstOf(b[0]) && firstOf(b[0]) < firstOf(c[0]) && firstOf(c[0]) < firstOf(d[0]));
  const pointsFor = (t, target) => { let n = 0; while (intelValueFor(t, n) < target && nextIntelGain({ intel: { spent: { [t]: n } } }, t) > 0) n++; return n; };
  assert.equal(order.slice(0, pointsFor(a[0], a[1])).every((t) => t === a[0]), true, 'enemy scouting first, up to its target');
  assert.equal(s.intel.points, 0);
});

test('spendIntelPoints: roundRobin = the track with the fewest points, skipping tracks that cannot gain', () => {
  const P = botParams(VT, { persona: 'casual' });
  assert.equal(PERSONAS.casual.intel, 'roundRobin');
  const s = game(7);
  const order = spendOneByOne(s, P, TRACKS.length * 3);
  assert.deepEqual(order.slice(0, TRACKS.length), TRACKS, 'one point each, in config order');
  // after every full round the counts differ by at most one among tracks that can still gain
  const gaining = TRACKS.filter((t) => nextIntelGain(s, t) > 0);
  const spent = gaining.map((t) => s.intel.spent[t]);
  assert.ok(Math.max(...spent) - Math.min(...spent) <= 1);
  // a maxed track is skipped for good: Battle simulation maxes after its max count of points
  const sim = s.intel.spent.simDepth;
  assert.equal(nextIntelGain(s, 'simDepth') > 0, sim < CONFIG.intel.tracks.simDepth.max / (CONFIG.intel.tracks.simDepth.gains[0] || 1));
});

test('spendIntelPoints always leaves nothing spendable, for every persona and --intel mode, whatever the point count', () => {
  for (const mode of ['persona', `only:${TRACKS[0]}`, `only:${TRACKS[TRACKS.length - 1]}`]) {
    for (const name of NAMES) {
      for (const points of [0, 1, 2, 7, 25, 400]) {
        const s = game(8);
        s.intel.points = points;
        spendIntelPoints(s, botParams(VT, { persona: name, intel: mode }));
        assert.equal(canSpendIntel(s), false, `${name} ${mode} ${points} points`);
        assert.ok(s.intel.points >= 0);
        for (const t of TRACKS) assert.ok(intelValue(s, t) <= CONFIG.intel.tracks[t].max, `${t} never above its max`);
      }
    }
  }
  // with enough points every track ends at its maximum
  const s = game(9);
  s.intel.points = 400;
  spendIntelPoints(s, botParams(VT, { persona: 'casual' }));
  for (const t of TRACKS) assert.equal(intelValue(s, t), CONFIG.intel.tracks[t].max);
  assert.ok(s.intel.points > 0, 'the points that cannot be spent stay');
});

test('--intel only:<track> spends on that track first, until it is maxed, then follows the persona', () => {
  const track = 'oreSight';
  const P = botParams(VT, { persona: 'careful', intel: `only:${track}` });
  assert.deepEqual(P.intel[0], [track, Infinity]);
  const s = game(10);
  const order = spendOneByOne(s, P, 30);
  const toMax = order.indexOf(order.find((t) => t !== track)); // the first point that went elsewhere
  assert.ok(toMax > 0);
  assert.ok(order.slice(0, toMax).every((t) => t === track));
  assert.equal(intelValue(s, track), CONFIG.intel.tracks[track].max, 'maxed before anything else');
  assert.equal(order[toMax], PERSONAS.careful.intel[0][0], 'then the persona\'s own list');
});

test('--intel none: no track can gain, so canSpendIntel is false and the plan gate stays open; the config comes back afterwards', () => {
  const s = game(12);
  s.intel.points = 3;
  assert.equal(canSpendIntel(s), true);
  assert.deepEqual(intelModeSets('persona'), []);
  assert.deepEqual(intelModeSets('only:oreSight'), []);
  withSets(intelModeSets('none'), () => {
    assert.equal(canSpendIntel(s), false);
    for (const t of TRACKS) assert.equal(nextIntelGain(s, t), 0);
    spendIntelPoints(s, botParams(VT, { persona: 'careful', intel: 'none' }));
    assert.equal(s.intel.points, 3, 'nothing is spent');
  });
  assert.equal(canSpendIntel(s), true, 'withSets restores the config');
  // also when the callback throws
  assert.throws(() => withSets(intelModeSets('none'), () => { throw new Error('boom'); }), /boom/);
  assert.equal(canSpendIntel(s), true);
  assert.equal(parseArgs(['--intel', 'none']).intel, 'none');
});

test('withSets changes CONFIG in memory and puts every value back (arrays, objects and numbers)', () => {
  const before = JSON.stringify(CONFIG.intel.tracks);
  withSets([['intel.tracks.oreSight.base', 40], ['intel.tracks.*.gains', '[0]']], () => {
    assert.equal(CONFIG.intel.tracks.oreSight.base, 40);
    assert.deepEqual(CONFIG.intel.tracks.enemySight.gains, [0]);
  });
  assert.equal(JSON.stringify(CONFIG.intel.tracks), before);
  assert.throws(() => withSets([['intel.tracks.nope.base', 1]], () => {}), /no CONFIG path/);
  assert.equal(JSON.stringify(CONFIG.intel.tracks), before);
});

// ------------------------------------------------------------ the command line ----
test('parseArgs: --persona', () => {
  assert.equal(parseArgs(['--persona', 'champion']).persona, 'champion');
  assert.equal(parseArgs(['--persona=casual']).persona, 'casual');
  assert.equal(parseArgs(['--persona', 'all']).persona, 'all');
  assert.throws(() => parseArgs(['--persona', 'hoarder']), /unknown persona hoarder/);
  assert.throws(() => parseArgs(['--persona']), /needs a value/);
  // the defaults: every section plays the careful planner, except the benchmark, which runs all of them
  assert.equal(parseArgs([]).persona, 'careful');
  assert.equal(parseArgs(['--section', 'bot']).persona, 'careful');
  assert.equal(parseArgs(['--section', 'benchmark']).persona, 'all');
  assert.equal(parseArgs(['--section', 'benchmark', '--persona', 'careful']).persona, 'careful');
  assert.throws(() => parseArgs(['--section', 'intel', '--persona', 'all']), /one persona/);
});

test('parseArgs: --intel, --section and the defaults that depend on the section', () => {
  assert.equal(parseArgs([]).intel, 'persona');
  assert.equal(parseArgs(['--intel', 'only:enemySight']).intel, 'only:enemySight');
  assert.throws(() => parseArgs(['--intel', 'only:nothing']), /unknown track/);
  assert.throws(() => parseArgs(['--intel', 'sometimes']), /persona, none or only/);
  assert.equal(parseArgs(['--section', 'intel']).section, 'intel');
  assert.throws(() => parseArgs(['--section', 'regrowth']), /Unknown section/);
  assert.equal(parseArgs(['--section', 'benchmark']).days, 100);
  assert.equal(parseArgs(['--section', 'intel']).days, 60);
  assert.equal(parseArgs(['--section', 'bot']).days, 80);
  assert.equal(parseArgs(['--section', 'intel', '--days', '30']).days, 30);
  // the persona's own minWin / future / carry unless the command line says otherwise
  const o = parseArgs([]);
  assert.equal(o.minwin, null);
  assert.equal(o.future, null);
  assert.equal(o.carry, null);
  assert.equal(parseArgs(['--minwin', '80', '--future', '5', '--carry', 'default']).minwin, 80);
});

test('BENCH_DAYS starts with days 2, 3, 4, 5, 10 and the death bins split the early days', () => {
  assert.deepEqual(BENCH_DAYS.slice(0, 5), [2, 3, 4, 5, 10]);
  assert.deepEqual(BENCH_DAYS, [...BENCH_DAYS].sort((a, b) => a - b));
  assert.deepEqual(DEATH_BINS.slice(0, 4).map(([a, b]) => [a, b]), [[2, 2], [3, 3], [4, 4], [5, 9]]);
  // the bins cover every day from 2 on exactly once
  for (let d = 2; d <= 200; d++) assert.equal(DEATH_BINS.filter(([a, b]) => d >= a && d <= b).length, 1, `day ${d}`);
});

test('judge: a value against a target range (ends included, null = open)', () => {
  assert.equal(judge(5, 5, 10), 'ok');
  assert.equal(judge(10, 5, 10), 'ok');
  assert.equal(judge(4.99, 5, 10), 'LOW');
  assert.equal(judge(10.01, 5, 10), 'HIGH');
  assert.equal(judge(1000, 5, null), 'ok');
  assert.equal(judge(-1000, null, 0), 'ok');
  assert.equal(judge(1, null, 0), 'HIGH');
  assert.equal(judge(NaN, 0, 1), 'n/a');
});

test('targetFlags: n/a rows are never misses; MISS counts the LOW / HIGH rows out of the rows that could be judged', () => {
  const row = (id, flag) => [id, 'what', '1', '1', flag];
  assert.equal(targetFlags([row('A', 'ok'), row('A', 'ok')]), 'A ok');
  assert.equal(targetFlags([row('A', 'ok'), row('A', 'LOW'), row('A', 'HIGH')]), 'A MISS 2/3');
  assert.equal(targetFlags([row('A', 'LOW'), row('A', 'n/a'), row('A', 'n/a')]), 'A MISS 1/1 (2 n/a)');
  assert.equal(targetFlags([row('A', 'ok'), row('A', 'n/a')]), 'A ok (1 n/a)');
  assert.equal(targetFlags([row('A', 'n/a'), row('A', 'n/a')]), 'A n/a');
  assert.equal(targetFlags([row('A', 'ok'), row('B', 'LOW'), row('A', 'ok')]), 'A ok B MISS 1/1', 'one flag per id, in the order the ids first appear');
  assert.equal(targetFlags([]), '');
});

test('mapAttempts counts the tries generateMap needed for the seed\'s map (at least one, not many)', () => {
  const tries = [];
  for (let i = 0; i < 20; i++) tries.push(mapAttempts(mixSeed(9001, i)));
  assert.ok(tries.every((n) => Number.isInteger(n) && n >= 1 && n <= 500));
  assert.ok(tries.reduce((a, b) => a + b, 0) / tries.length < 4);
  assert.equal(mapAttempts(mixSeed(9001, 3)), tries[3], 'deterministic');
});

// ----------------------------------------------- the personas in the real game ----
// A few days of each persona on the real game API. Cheap (small value tables, the in-game estimate), so these catch a persona that
// no longer runs, breaks the plan gate, or ignores its own rules.
test('each persona plays: the plan gate is respected, trips are capped, and it fights what its rules say', () => {
  for (const name of NAMES) {
    const P = botParams(VT, { persona: name, estimator: 'game', quick: true });
    const rec = runBot(mixSeed(31337, 1), 12, P);
    assert.ok(rec.lastDay >= 2, `${name} played`);
    assert.ok(Math.max(0, ...Object.values(rec.tripsByDay)) <= PERSONAS[name].trips, `${name}: at most ${PERSONAS[name].trips} trips a day`);
    assert.ok(rec.picks.length > 0);
    if (PERSONAS[name].pick === 'looks') {
      assert.ok(rec.picks.every((x) => x.p === null && x.tier !== 'champion'), 'casual reads no estimate and fights no champion');
      assert.ok(rec.picks.every((x) => x.bestP === null && x.safe === null));
    } else {
      assert.ok(rec.picks.every((x) => Number.isFinite(x.p)), `${name} reads the estimate`);
    }
    // a point comes at the end of every fifth day and is spent in that day's plan (not when the run ended that day)
    const spent = Object.values(rec.intel).reduce((a, b) => a + b, 0);
    assert.equal(spent, Math.floor(((rec.deathDay ?? rec.lastDay) - 1) / CONFIG.intel.daysPerPoint), `${name}: every point is spent`);
  }
  // the first points go where the list says (a seed on which the persona is still alive on day 6, so the balance does not decide the test)
  const first = (name) => {
    for (let k = 1; k <= 40; k++) {
      const r = runBot(mixSeed(31337, k), 6, botParams(VT, { persona: name, estimator: 'game', quick: true }));
      if (r.deathDay == null) return r.intel;
    }
    throw new Error(`${name} died before day 6 on all 40 seeds`);
  };
  const c = PERSONAS.careful.intel[0][0];
  assert.equal(first('careful')[c], 1);
  const h = PERSONAS.champion.intel[0][0];
  assert.equal(first('champion')[h], 1);
  assert.equal(Object.values(first('casual')).filter((n) => n === 1).length, 1, 'round robin: the first point goes to the first track');
});

test('choosePlan: the casual persona packs the game\'s default pack and wears its best grades; the careful one rests worn gear', () => {
  const setup = (name) => {
    const s = game(21);
    endDay(s); // day 1 -> the plan phase
    for (const slot of SLOTS) {
      // ranked by score (stable): iron C, iron C (worn), copper D, copper D (worn); the pack takes the best two (packLimit)
      addGear(s, slot, 'iron', 'C');
      addGear(s, slot, 'iron', 'C', null, { durability: 2 }); // would be destroyed in a fight: stays home, though it is in the best two
      addGear(s, slot, 'copper', 'D');
      addGear(s, slot, 'copper', 'D', null, { durability: 2 }); // would be destroyed too, but the pack would not have taken it (4th of 4)
    }
    // adventurer rings: more than can be worn, grades and types mixed
    const types = Object.keys(CONFIG.rings.types).filter((t) => CONFIG.rings.types[t].owner === 'adventurer');
    for (let i = 0; i < CONFIG.rings.maxWorn + 4; i++) addRing(s, types[i % types.length], GRADES[i % GRADES.length]);
    const P = botParams(VT, { persona: name, estimator: 'game', quick: true });
    const rec = { picks: [], rested: 0 };
    const plan = choosePlan(s, { P, wasDebris: new WeakSet(), seed: 3, tm: null, seen: new Set() }, rec);
    return { s, plan, rec };
  };
  const casual = setup('casual');
  assert.deepEqual([...casual.plan.gearIds].sort((a, b) => a - b), [...defaultPack(casual.s)].sort((a, b) => a - b), 'the game\'s default pack');
  for (const slot of SLOTS) assert.ok(casual.plan.gearIds.filter((id) => casual.s.gear.find((g) => g.id === id).slot === slot).length <= packLimit(casual.s, slot));
  // rings: the best grades first (any type), as many as it may wear
  const worn = casual.plan.ringIds.map((id) => casual.s.rings.find((r) => r.id === id));
  assert.equal(worn.length, CONFIG.rings.maxWorn);
  const rest = casual.s.rings.filter((r) => !casual.plan.ringIds.includes(r.id) && CONFIG.rings.types[r.type].owner === 'adventurer');
  const lowestWorn = Math.min(...worn.map((r) => GRADES.indexOf(r.grade)));
  assert.ok(rest.every((r) => GRADES.indexOf(r.grade) <= lowestWorn), 'no better-grade ring was left at home');
  assert.ok(worn.every((r) => ringValue(r) > 0));
  assert.equal(casual.rec.picks.length, 1);
  assert.equal(casual.rec.picks[0].p, null);
  assert.equal(casual.rec.rested, 0, 'the default pack has no rest rule');

  const careful = setup('careful');
  // the 2% pieces could be destroyed and stay home (the type keeps better items to pack)
  const packed = careful.plan.gearIds.map((id) => careful.s.gear.find((g) => g.id === id));
  assert.ok(packed.every((g) => g.durability > 2), 'items a champion fight could destroy stay home');
  assert.equal(packed.length, SLOTS.length * packLimit(careful.s, 'sword'), 'the best two of every type are packed');
  // "rested item-days" count the items the pack would otherwise have taken: the worn iron C of each type, not the worn copper D
  // spare that the pack limit would have left at home anyway
  assert.equal(careful.rec.rested, SLOTS.length, 'one rested item per gear type');
  assert.ok(careful.plan.enemyIndex >= 0 && careful.plan.enemyIndex < careful.s.roster.enemies.length);
});

// ------------------------------------------- T-GEAR (c): the true win chance over the whole roster ----
// A real enemy of a tier (all attributes known), made without a game state.
const realEnemy = (tier, day, seed) => ({ tier, day, name: 'Test', levels: rollLevels(seededRng(seed), tier, CONFIG) });

test('truePct: the plain win rate of the packed gear against the enemy as it really is (draws count as survival)', () => {
  const s = game(5);
  const e = realEnemy('elite', 2, 77);
  const sword = addGear(s, 'sword', 'copper', 'D');
  // one item per slot -> no loadout choice, so the number is the plain win rate of that adventurer with the tool's own seeds
  const adv = adventurerCombatant([sword], {}, CONFIG);
  const enemyC = enemyCombatant(e.tier, e.day, e.levels, e.name, CONFIG);
  const rng = seededRng(mixSeed(11, 2));
  let wins = 0;
  for (let f = 0; f < TRUTH.fights; f++) {
    const r = fight(adv, enemyC, rng.next, false, CONFIG);
    if (r.win || r.draw) wins++;
  }
  assert.equal(truePct([sword], {}, e, 11), (100 * wins) / TRUTH.fights);
  assert.equal(truePct([sword], {}, e, 11), truePct([sword], {}, e, 11), 'deterministic');
});

test('truePct: the adventurer packs the best loadout (a weak spare sword changes nothing), and more gear never lowers the chance by much', () => {
  const s = game(5);
  const e = realEnemy('champion', 2, 91);
  const good = addGear(s, 'sword', 'mythril', 'S');
  const bad = addGear(s, 'sword', 'copper', 'D');
  assert.equal(truePct([good, bad], {}, e, 4), truePct([good], {}, e, 4), 'the spare is not used');
  const none = truePct([], {}, e, 4);
  const withSword = truePct([good], {}, e, 4);
  assert.ok(withSword > none, `a mythril S sword beats fists (${withSword} vs ${none})`);
  assert.ok(withSword >= 0 && withSword <= 100 && none >= 0 && none <= 100);
});

test('choosePlan with P.truth records the true win chance of EVERY roster enemy per tier (not only the chosen one); without it, nothing', () => {
  const s = game(21);
  endDay(s); // day 1 -> the plan phase
  addGear(s, 'sword', 'copper', 'D'); // a day-1 sword: strong enough to win some fights, weak enough that the tiers differ
  const run = (truth) => {
    const P = botParams(VT, { persona: 'careful', estimator: 'game', quick: true });
    P.truth = truth;
    const rec = { picks: [], rested: 0 };
    const ctx = { P, wasDebris: new WeakSet(), seed: 3, tm: null, seen: new Set() };
    const plan = choosePlan(s, ctx, rec);
    return { rec, plan, ctx };
  };
  assert.equal(run(false).rec.picks[0].trueP, null);
  const { rec, plan } = run(true);
  const t = rec.picks[0].trueP;
  assert.deepEqual(Object.keys(t), TIER_NAMES);
  const packed = s.gear.filter((g) => plan.gearIds.includes(g.id));
  for (const tier of TIER_NAMES) {
    const own = s.roster.enemies.map((e, i) => ({ e, i })).filter((x) => x.e.tier === tier);
    assert.ok(own.length > 1, 'the roster has several enemies of the tier');
    // the same number, worked out one roster enemy at a time with the same seeds (rings: none worn)
    const expect = own.map(({ e, i }) => truePct(packed, {}, e, mixSeed(3, s.day, i, 5))).reduce((a, b) => a + b, 0) / own.length;
    assert.ok(Math.abs(t[tier] - expect) < 1e-9, `${tier}: ${t[tier]} vs ${expect}`);
  }
  // a plain sword beats a normal more often than a champion
  assert.ok(t.normal > t.champion);
});

// ------------------------------------------------------- the sections run ----
test('the benchmark runs every persona on the same seeds (also in child processes) and prints its lines and targets', () => {
  const out = runTool('--section', 'benchmark', '--quick', '--seeds', '2', '--days', '8', '--jobs', '2');
  for (const name of NAMES) assert.match(out, new RegExp(`BENCHMARK \\| v${VERSION.replace('.', '\\.')} \\| ${name} \\| seeds 2 \\|`));
  assert.match(out, /Markdown rows for docs\/BENCHMARKS\.md/);
  assert.match(out, /BENCHMARK SUMMARY \|/);
  assert.match(out, /Wall time/);
  assert.match(out, /T-P/);
  for (const name of Object.values(PERSONAS).map((p) => p.name)) assert.ok(out.includes(name), `${name} has a row`);
  // d2, d3, d4 are columns
  assert.match(out, /persona\s+d2\s+d3\s+d4\s+d5/);
  // the same numbers from one process and from children
  const one = runTool('--section', 'benchmark', '--quick', '--seeds', '2', '--days', '8', '--persona', 'careful');
  const two = runTool('--section', 'benchmark', '--quick', '--seeds', '2', '--days', '8', '--persona', 'careful', '--jobs', '2');
  const line = (t) => t.split('\n').find((l) => l.startsWith('BENCHMARK | '));
  assert.equal(line(one), line(two));
});

test('benchmark: --estimator bot works with the default persona (all), in one process and with --jobs', () => {
  for (const jobs of [[], ['--jobs', '2']]) {
    const out = runTool('--section', 'benchmark', '--estimator', 'bot', '--quick', '--seeds', '2', '--days', '3', ...jobs);
    assert.match(out, /the bot's own two-stage estimate \(\d+ guesses x \d+ fights screen/);
    for (const name of NAMES) assert.match(out, new RegExp(`BENCHMARK \\| v${VERSION.replace('.', '\\.')} \\| ${name} \\| seeds 2 \\|`));
  }
});

test('benchmark: a target on a day after --days prints n/a (not 0 / LOW); the casual persona has no estimator text', () => {
  const out = runTool('--section', 'benchmark', '--quick', '--seeds', '2', '--days', '5');
  assert.match(out, /careful: alive at day 10 \(%\)\s+-\s+75-85\s+n\/a/);
  assert.match(out, /careful - casual: alive at day 20 \(points\)\s+-\s+>= 10\s+n\/a/);
  assert.match(out, /careful - casual: alive at day 40 \(points\)\s+-\s+>= 10\s+n\/a/);
  assert.doesNotMatch(out, /alive at day (10|20|40)[^\n]*LOW/);
  // a median life that --days cuts off (more than half the runs alive at the end) is only known as ">D": n/a, not judged on D + 1 or as 0.0
  const careful = out.split('\n').find((l) => /^BENCHMARK \| .* \| careful \|/.test(l));
  assert.match(careful, /median life >5/, 'the careful bot outlives five days on these seeds, so its median is cut off');
  assert.match(out, /careful: median life \(days\)\s+-\s+30-40\s+n\/a/);
  assert.match(out, /careful - champion: median life \(days\)\s+-\s+>= 3\s+n\/a/);
  // the SUMMARY counts only LOW / HIGH rows as misses, and says how many rows were n/a
  const summary = out.split('\n').find((l) => l.startsWith('BENCHMARK SUMMARY'));
  assert.match(summary, /T-D MISS \d\/2 \(2 n\/a\)/, summary);
  assert.match(summary, /T-P (ok|MISS \d\/\d) \(\d n\/a\)/, summary);
  assert.doesNotMatch(summary, /T-D MISS 4\/4|T-P MISS \d\/8/, 'n/a rows used to count as misses (T-D MISS 4/4, T-P MISS 4/8)');
  const casual = out.split('\n').filter((l) => /casual/.test(l) && /estimator/.test(l));
  assert.ok(casual.length >= 1);
  for (const l of casual) assert.match(l, /estimator no estimate/, 'casual never reads an estimate');
  assert.match(out.split('\n').find((l) => /^BENCHMARK \| .* \| careful \|/.test(l)), /estimator game \d+x\d+/);
});

test('the economy SUMMARY labels the searches per clear cell with the bonuses CONFIG gives (skill at its top level; S ring + skill), not +12 / +32', () => {
  const eff = CONFIG.skills.activity.searchEff.effects.searchEff;
  const sRing = CONFIG.rings.types.searchEff.values[4];
  const label = (out) => out.split('\n').find((l) => l.startsWith('ECONOMY SUMMARY')).match(/searches per clear cell (\+[\d./+]+)%/)[1];
  const bonus = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
  const top = CONFIG.skills.maxLevel;
  assert.equal(label(runTool('--section', 'economy', '--quick', '--seeds', '4')), `+0/+${bonus(eff * top)}/+${bonus(sRing + eff * top)}`);
  // a different skill value moves the label with it
  const out = runTool('--section', 'economy', '--quick', '--seeds', '4', '--set', 'skills.activity.searchEff.effects.searchEff=2');
  assert.equal(label(out), `+0/+${bonus(2 * top)}/+${bonus(sRing + 2 * top)}`);
});

test('the intel section plays the same seeds in every mode and prints the INTEL line with its flags', () => {
  const out = runTool('--section', 'intel', '--quick', '--seeds', '2', '--days', '6');
  for (const t of TRACKS) assert.ok(out.includes(`only:${t}`));
  assert.ok(out.includes('persona') && out.includes('none'));
  assert.match(out, /INTEL \| best only:\w+ \| spread life [\d.]+d score \d+% \| default [+-]?[\d.]+d \| worst vs none [+-]?[\d.]+d/);
  assert.match(out, /T-R42/);
});

test('every other section runs (--quick) and ends with a SUMMARY line that carries the target flags', () => {
  const cases = [
    [['--section', 'day2'], /^DAY2 \|.*T-GEAR/m],
    [['--section', 'power'], /^POWER SUMMARY \|.*T-MID/m],
    [['--section', 'specials'], /^SPECIALS \|.*T-R33/m],
    [['--section', 'estimator'], /^ESTIMATOR SUMMARY .*T-A2/m],
    [['--section', 'economy', '--seeds', '4'], /^ECONOMY SUMMARY \|.*T-E1/m],
    [['--section', 'bot', '--persona', 'casual', '--seeds', '1', '--days', '8'], /^BOT SUMMARY \| casual \|/m],
    [['--section', 'bot', '--persona', 'careful', '--seeds', '1', '--days', '12'], /^BOT SUMMARY \| careful \|.* d10-40 true e\/c \d+\/\d+ \| d10-40 est e\/c/m],
  ];
  for (const [args, pattern] of cases) assert.match(runTool(...args, '--quick'), pattern, args.join(' '));
});

test('specials: T-R33 is judged on the mean of the three sets per special (4 values, 5 sword gems for M6, 1 for M7), not per material cell', () => {
  const out = runTool('--section', 'specials', '--quick');
  const row = (name) => out.split('\n').find((l) => l.startsWith('T-R33') && l.includes(name));
  for (const name of ['M1 N->H', 'M2 matching', 'M3 the same', 'M4 recovered', 'M5 sword gem C', 'M5 sword gem S', 'S sword gem gain']) {
    assert.match(row(name), /(ok|MISS \d\/4)\s*$/, `${name}: out of 4 specials`);
  }
  for (const name of ['M6 sword gem C', 'M6 sword gem S']) assert.match(row(name), /(ok|MISS \d\/5)\s*$/, `${name}: out of 5 sword gems`);
  assert.match(row('M7 emerald'), /(ok|MISS 1\/1)\s*$/, 'M7 is one value');
  assert.match(out, /Mean of the three sets \(iron \/ steel \/ mythril\), per special/);
});

test('--help lists the new options and sections', () => {
  const out = runTool('--help');
  for (const w of ['--persona', '--intel', 'only:<track>', 'intel', 'casual', 'T-R42']) assert.ok(out.includes(w), w);
});
