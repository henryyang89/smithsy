// Display helpers that need no DOM (js/ui/present.js). Batch 4: the estimate cache key and the estimate texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import {
  estimateKey, estimateTip, winWithMargin, winClass, winText, sortedIds, gearAnswers, durText, repairGainShown, dayProgress, clockStatus,
  processOutcome, processMessage, failedText, combatLogRows, gearMatrix, gemOverview, scoreBreakdown, outcomeSegments, fightSegment, whatIfText,
} from '../js/ui/present.js';
import { simCounts, shownMargin } from '../js/core/sim.js';
import { knownLevels } from '../js/core/enemies.js';
import { fight } from '../js/core/combat.js';
import { endDay, confirmPlan, endRun } from '../js/core/game.js';
import { formatClock, formatDuration } from '../js/core/util.js';
import { gearName } from '../js/core/gear.js';
import { SLOTS, BARS, GEMS, GRADES, TIERS } from '../js/config.js';
import { SEGMENTS } from '../js/core/replay.js';
import { game, cfgWith, addGear, addRing, combatant, scriptRand, WEAK_ENEMIES } from './helpers.mjs';

const scope = (gearIds, ringIds, extra = {}) => ({ id: 'plan', gearIds, ringIds, ...extra });

test('sortedIds: ids in ascending order as one string, whatever the input order', () => {
  assert.equal(sortedIds([12, 3, 7]), '3,7,12');
  assert.equal(sortedIds([]), '');
  assert.equal(sortedIds([10, 9]), '9,10', 'numerically, not as text');
});

test('estimateKey: the same selection gives the same key, in any id order, for the same enemy', () => {
  const s = game(3);
  const [a, b] = [addGear(s, 'sword'), addGear(s, 'chest')];
  const r = addRing(s, 'dodge', 'B');
  const k = estimateKey(s, scope([a.id, b.id], [r.id]), 0);
  assert.equal(estimateKey(s, scope([b.id, a.id], [r.id]), 0), k);
  assert.equal(estimateKey(s, scope([a.id, b.id], [r.id]), 0, CONFIG, simCounts(s, CONFIG)), k);
  assert.notEqual(estimateKey(s, scope([a.id, b.id], [r.id]), 1), k, 'another enemy has another key');
});

test('estimateKey changes with the gear, the rings, what the player can see of the enemy and the size of the simulation', () => {
  const s = game(3);
  const [a, b] = [addGear(s, 'sword'), addGear(s, 'chest')];
  const r1 = addRing(s, 'dodge', 'B');
  const r2 = addRing(s, 'accuracy', 'C');
  const base = estimateKey(s, scope([a.id], [r1.id]), 2);
  assert.notEqual(estimateKey(s, scope([a.id, b.id], [r1.id]), 2), base, 'more gear');
  assert.notEqual(estimateKey(s, scope([], [r1.id]), 2), base, 'less gear');
  assert.notEqual(estimateKey(s, scope([a.id], [r1.id, r2.id]), 2), base, 'another ring');
  assert.notEqual(estimateKey(s, scope([a.id], []), 2), base, 'no rings');
  // what the player sees: reveal everything about the enemy
  const enemy = s.roster.enemies[2];
  const before = Object.keys(knownLevels(s, enemy)).length;
  for (const k of Object.keys(enemy.sight)) enemy.sight[k] = 0;
  assert.ok(Object.keys(knownLevels(s, enemy)).length > before, 'more attributes are visible now');
  assert.notEqual(estimateKey(s, scope([a.id], [r1.id]), 2), base, 'more visible attributes');
  // the size of the simulation: Battle simulation intel (+1 each) and a Foresight ring
  const sized = estimateKey(s, scope([a.id], [r1.id]), 2);
  s.intel.spent.simDepth = 1;
  const withIntel = estimateKey(s, scope([a.id], [r1.id]), 2);
  assert.notEqual(withIntel, sized, 'Battle simulation intel');
  addRing(s, 'foresight', 'S', true);
  assert.notEqual(estimateKey(s, scope([a.id], [r1.id]), 2), withIntel, 'a worn Foresight ring');
  // a pinned config with other base counts
  const big = cfgWith({ sim: { samples: CONFIG.sim.samples + 3 } });
  assert.notEqual(estimateKey(s, scope([a.id], [r1.id]), 2, big), estimateKey(s, scope([a.id], [r1.id]), 2));
});

test('estimateKey does not change with the selected column, the screen it is for or the order things are listed in', () => {
  const s = game(4);
  const g = addGear(s, 'sword');
  const r = addRing(s, 'dodge', 'B');
  const k = estimateKey(s, scope([g.id], [r.id], { selected: 0 }), 3);
  assert.equal(estimateKey(s, scope([g.id], [r.id], { selected: 5 }), 3), k, 'the chosen column is not an input');
  assert.equal(estimateKey(s, { id: 'adv', gearIds: [g.id], ringIds: [r.id] }, 3), k, 'the plan screen and the Adventurer tab share results');
  // another game or another roster day never matches
  const t = game(5);
  const g2 = addGear(t, 'sword');
  assert.notEqual(estimateKey(t, scope([g2.id], []), 3), estimateKey(s, scope([g.id], []), 3));
  const day = estimateKey(s, scope([g.id], [r.id]), 3);
  s.roster.day += 1;
  assert.notEqual(estimateKey(s, scope([g.id], [r.id]), 3), day);
});

test('estimateKey ignores what does not change the fight: the item\'s wear and the banner', () => {
  const s = game(6);
  const g = addGear(s, 'sword');
  const k = estimateKey(s, scope([g.id], []), 1);
  g.durability = 31.4;
  s.roster.enemies[1].group = 'gold';
  s.roster.enemies[1].groupRoll = 0;
  assert.equal(estimateKey(s, scope([g.id], []), 1), k);
});

test('win text helpers: whole percent, the ± from shownMargin, and the colour of a chance', () => {
  const res = { winPct: 62.4, wins: 15, fights: 25, se: 5 };
  assert.equal(winText(62.4), '62%');
  assert.equal(winWithMargin(res), `62% ± ${shownMargin(res)}`);
  assert.equal(winWithMargin({ winPct: 62.4, fights: 0 }), '62%', 'no fights, no margin');
  const tip = estimateTip(res);
  assert.ok(tip.startsWith(`62% ± ${shownMargin(res)} from 25 test fights (could be `) && tip.includes('hidden attributes add more'), tip);
  const m = shownMargin(res);
  assert.ok(tip.includes(`${Math.max(0, Math.round(62.4 - m))}-${Math.min(100, Math.round(62.4 + m))}%`), tip);
  assert.equal(estimateTip({ winPct: 100, wins: 25, fights: 25, se: 0 }).includes('could be'), true);
  assert.equal(winClass(90), 'ok');
  assert.equal(winClass(89.9), 'warn');
  assert.equal(winClass(70), 'warn');
  assert.equal(winClass(69.9), 'err');
});

test('gearAnswers: for each High special you can see, does the packed armor have the gem that answers it', () => {
  const s = game(7);
  const ruby = addGear(s, 'chest', 'iron', 'C', { type: 'ruby', grade: 'B' });
  const emerald = addGear(s, 'helmet', 'iron', 'C', { type: 'emerald', grade: 'C' });
  const topazSword = addGear(s, 'sword', 'iron', 'C', { type: 'topaz', grade: 'C' });
  const known = { magical: 'high', stunning: 'high', chilling: 'normal', piercing: 'low', accurate: 'high' };
  const out = gearAnswers([ruby, emerald, topazSword], known);
  const A = CONFIG.enemies.attributes;
  assert.deepEqual(out.map((a) => [a.gem, a.special, a.ok, a.item]), [
    ['ruby', A.magical.name, true, 'ruby chest'],
    ['topaz', A.stunning.name, false, null], // a topaz SWORD does not answer Stunning
    ['emerald', A.accurate.name, true, 'emerald helmet'],
  ]);
  assert.deepEqual(gearAnswers([ruby], {}), [], 'nothing hidden is listed');
  assert.deepEqual(gearAnswers([], { magical: 'normal' }), [], 'only High specials count');
});

// ------------------------------------------------------------ durability (B3, B5) ----
test('durText is a whole number with a percent sign, and the shown durability plus the shown repair gain is 100 for every durability', () => {
  assert.equal(durText(63.4), '63%');
  assert.equal(durText(100), '100%');
  assert.equal(durText(0.4), '1%', 'never 0% while the item exists');
  for (let d = 0.1; d <= 100 + 1e-9; d += 0.1) {
    assert.match(durText(d), /^\d+%$/, `durability ${d}`);
    assert.equal(Number.parseInt(durText(d), 10) + repairGainShown(d), 100, `durability ${d}`);
  }
  for (const d of [1e-9, 0.04, 59.99999999, 60 - 1e-12, 99.95, 100]) assert.equal(Number.parseInt(durText(d), 10) + repairGainShown(d), 100, `durability ${d}`);
});

// -------------------------------------------------------------- the work day ----
test('dayProgress: empty at the start, fills with the minutes used, tones from the display config, over after the day', () => {
  const t0 = CONFIG.time.dayStartMin;
  const len = CONFIG.time.dayEndMin - t0;
  const at = (time, cfg = CONFIG) => dayProgress({ ...game(1), time }, cfg);
  const start = at(t0);
  assert.equal(start.used, 0);
  assert.equal(start.left, len);
  assert.equal(start.len, len);
  assert.equal(start.frac, 0);
  assert.equal(start.tone, 'ok');
  assert.match(start.label, /^0m of the \d+h work day used, \d+h left \(\d\d:\d\d-\d\d:\d\d\)$/);
  const half = at(t0 + len / 2);
  assert.equal(half.frac, 0.5);
  assert.equal(half.used + half.left, len);
  // the bar grows left to right: a later time is never a smaller fraction
  let last = -1;
  for (let m = 0; m <= len + 120; m += 15) {
    const f = at(t0 + m).frac;
    assert.ok(f >= last, `at +${m}m`);
    last = f;
  }
  // tones from the display config
  const warn = CONFIG.display.dayBarWarnPct;
  const low = CONFIG.display.dayBarLowPct;
  assert.equal(at(t0 + (len * (warn - 0.5)) / 100).tone, 'ok');
  assert.equal(at(t0 + (len * warn) / 100).tone, 'mid');
  assert.equal(at(t0 + (len * (low - 0.5)) / 100).tone, 'mid');
  assert.equal(at(t0 + (len * low) / 100).tone, 'low');
  // past the end: full, over, nothing left
  const over = at(CONFIG.time.dayEndMin + 40);
  assert.equal(over.frac, 1);
  assert.equal(over.left, 0);
  assert.equal(over.used, len);
  assert.equal(over.label, 'The work day is over');
  assert.equal(at(CONFIG.time.dayEndMin).label, 'The work day is over');
  // a patched config: another day length and other thresholds
  const cfg = cfgWith({ time: { dayStartMin: 600, dayEndMin: 900 }, display: { dayBarWarnPct: 50, dayBarLowPct: 80 } });
  assert.equal(at(600, cfg).frac, 0);
  assert.equal(at(750, cfg).frac, 0.5);
  assert.equal(at(749, cfg).tone, 'ok');
  assert.equal(at(750, cfg).tone, 'mid');
  assert.equal(at(840, cfg).tone, 'low');
  assert.equal(at(750, cfg).label, '2h 30m of the 5h work day used, 2h 30m left (10:00-15:00)');
});

// ------------------------------------------------- refine / cut result box ----
const one = (grade, minutes = 15) => ({ ok: true, grade, minutes, notes: [], msg: `core ${grade}` });
const batch = (...grades) => ({ ok: true, msg: 'Done', notes: [], results: grades.map((g) => one(g)) });

test('processOutcome: single success / single fail / all-ok batch / mixed batch / refused', () => {
  assert.deepEqual(processOutcome(one('C')), { tone: 'ok', made: 1, failed: 0, grades: { C: 1 } });
  assert.deepEqual(processOutcome(one('F')), { tone: 'err', made: 0, failed: 1, grades: {} });
  assert.deepEqual(processOutcome(batch('D', 'D', 'C')), { tone: 'ok', made: 3, failed: 0, grades: { D: 2, C: 1 } });
  assert.deepEqual(processOutcome(batch('D', 'F', 'C', 'F', 'D')), { tone: 'err', made: 3, failed: 2, grades: { D: 2, C: 1 } });
  assert.equal(processOutcome({ ok: false, msg: 'Not enough ore' }).tone, 'err');
  assert.equal(processOutcome(null).tone, 'err');
});

test('processMessage: a single attempt keeps the core message; a batch lists the grades low to high and how many failed', () => {
  assert.equal(processMessage('refine', 'copper', one('C')), 'core C');
  assert.equal(processMessage('refine', 'copper', { ok: false, msg: 'Not enough ore' }), 'Not enough ore');
  const mixed = { ok: true, results: ['S', 'D', 'F', 'C', 'F', 'D'].map((g) => one(g, 12.5)) };
  const text = processMessage('refine', 'copper', mixed);
  assert.equal(text, 'Copper: refined 6 in 1h 15m: 4 bars (D 2, C 1, S 1), 2 of 6 failed (ore lost).');
  assert.equal(failedText(mixed), '2 of 6 failed');
  assert.ok(text.indexOf('D 2') < text.indexOf('C 1') && text.indexOf('C 1') < text.indexOf('S 1'), 'lowest grade first');
  assert.doesNotMatch(text, /[A-Z] 0\b/, 'no zero counts');
  // all ok: nothing about failures
  const ok = processMessage('cut', 'ruby', batch('B', 'B'));
  assert.equal(ok, 'Ruby: cut 2 in 30m: 2 gems (B 2).');
  assert.equal(failedText(batch('B', 'B')), null);
  assert.equal(failedText(one('F')), null, 'a single attempt has no "N of M"');
  // all failed: no grade list at all
  assert.equal(processMessage('cut', 'ruby', batch('F', 'F')), 'Ruby: cut 2 in 30m: 0 gems, 2 of 2 failed (gems lost).');
  assert.match(processMessage('refine', 'iron', batch('C')), /^Iron: refined 1 in 15m: 1 bar \(C 1\)\.$/);
});

// -------------------------------------------------------------- combat log ----
test('combatLogRows: one row per attack, both HP on every row (never rising), hitSide on hits only, effects only for stun / slow', () => {
  const adv = combatant({ name: 'Adventurer', hp: 100, damage: 30, interval: 1, accuracy: 300, magicPct: 20, stunChance: 100, stunDur: 0.5 });
  const foe = combatant({ name: 'Foe', hp: 300, damage: 8, interval: 0.3, accuracy: 100, dodge: 100, slowPct: 100, slowDur: 2 });
  const r = fight(adv, foe, scriptRand([], 0.01), true, cfgWith({ combat: { startFillMax: 0 } }));
  const report = { enemy: { name: 'Foe' }, log: r.log };
  const rows = combatLogRows(report);
  assert.equal(rows.length, r.log.length);
  assert.ok(rows.length >= 4);
  let hpA = Infinity;
  let hpE = Infinity;
  rows.forEach((row, i) => {
    const e = r.log[i];
    assert.equal(typeof row.hpA, 'number');
    assert.equal(typeof row.hpE, 'number');
    assert.ok(row.hpA <= hpA && row.hpE <= hpE, `row ${i}: HP never increases`);
    hpA = row.hpA;
    hpE = row.hpE;
    assert.equal(row.attacker, e.side === 'A' ? 'Adventurer' : 'Foe');
    assert.equal(row.hitSide, e.hit ? (e.side === 'A' ? 'E' : 'A') : null, 'the side whose HP dropped, hits only');
    assert.equal(row.effects !== '', !!(e.hit && (e.stun || e.slow)), 'effects iff the hit stunned or slowed');
    assert.equal(row.detail !== '', !!(e.hit && e.magic > 0.005), 'the muted detail is the magic split of a hit');
    assert.match(row.time, /^\d+\.\ds$/);
  });
  assert.ok(rows.some((x) => /^Stun /.test(x.effects)) && rows.some((x) => /^Slow /.test(x.effects)), 'both effects show up in this fight');
  // a miss row
  const miss = combatLogRows({ enemy: { name: 'Foe' }, log: [{ t: 1, side: 'E', hit: false, hitPct: 62.4, hpA: 100, hpE: 50 }] })[0];
  assert.equal(miss.result, 'Miss (62% to hit)');
  assert.equal(miss.hitSide, null);
  assert.equal(miss.effects, '');
});

// ------------------------------------------------------- gear and gem tables ----
test('gearMatrix: every item once, best first in its cell, gems in GEMS order', () => {
  const s = game(2);
  const items = [
    addGear(s, 'sword', 'iron', 'C', { type: 'diamond', grade: 'D' }),
    addGear(s, 'sword', 'iron', 'S'),
    addGear(s, 'sword', 'iron', 'D'),
    addGear(s, 'sword', 'copper', 'B', { type: 'ruby', grade: 'C' }),
    addGear(s, 'chest', 'mythril', 'A', { type: 'emerald', grade: 'S' }),
    addGear(s, 'chest', 'steel', 'D', { type: 'ruby', grade: 'D' }),
    addGear(s, 'boots', 'copper', 'D'),
  ];
  const m = gearMatrix(s.gear, CONFIG);
  assert.deepEqual(m.rows.map((r) => r.slot), SLOTS, 'one row per gear type');
  assert.equal(m.total, items.length);
  const seen = m.rows.flatMap((r) => BARS.flatMap((b) => r.cells[b]));
  assert.deepEqual(seen.map((g) => g.id).sort((a, b) => a - b), items.map((g) => g.id).sort((a, b) => a - b), 'every item exactly once');
  for (const row of m.rows) {
    assert.equal(row.total, BARS.reduce((n, b) => n + row.cells[b].length, 0));
    for (const b of BARS) assert.ok(row.cells[b].every((g) => g.slot === row.slot && g.material === b), 'in the right cell');
  }
  const iron = m.rows[0].cells.iron;
  assert.deepEqual(iron.map((g) => g.grade), ['S', 'C', 'D'], 'best first');
  assert.deepEqual(m.rows[0].gems.map((g) => g.gem), ['ruby', 'diamond'], 'gems in GEMS order');
  assert.deepEqual(m.rows[1].gems.map((g) => g.gem), ['ruby', 'emerald']);
  assert.deepEqual(m.rows[1].gems.map((g) => g.count), [1, 1]);
  assert.equal(GEMS.indexOf('ruby') < GEMS.indexOf('diamond'), true);
  assert.deepEqual(m.rows[2].gems, [], 'a type with no gem has none');
  assert.equal(m.rows[2].total, 0);
  assert.equal(gearMatrix([], CONFIG).total, 0);
});

test('gemOverview: raw gems, cut gems by grade and the pieces of gear that carry the gem', () => {
  const s = game(2);
  s.storage.gem.ruby = 4;
  s.storage.cut['ruby:C'] = 2;
  s.storage.cut['topaz:S'] = 1;
  addGear(s, 'sword', 'copper', 'D', { type: 'ruby', grade: 'D' });
  addGear(s, 'chest', 'copper', 'D', { type: 'ruby', grade: 'B' });
  addGear(s, 'helmet', 'copper', 'D', { type: 'emerald', grade: 'B' });
  addGear(s, 'boots', 'copper', 'D');
  const o = gemOverview(s);
  assert.deepEqual(o.map((g) => g.gem), GEMS, 'GEMS order');
  const ruby = o[0];
  assert.equal(ruby.raw, 4);
  assert.deepEqual(Object.keys(ruby.cut), GRADES);
  assert.equal(ruby.cut.C, 2);
  assert.equal(ruby.cut.D, 0);
  assert.equal(ruby.inGear, 2);
  assert.equal(o.find((g) => g.gem === 'topaz').cut.S, 1);
  assert.equal(o.find((g) => g.gem === 'emerald').inGear, 1);
  assert.equal(o.find((g) => g.gem === 'diamond').inGear, 0);
});

// ------------------------------------------------------------ score, outcome bar ----
test('scoreBreakdown: wins and points per tier, and a total equal to the run\'s score', () => {
  const WIN = cfgWith(WEAK_ENEMIES);
  const s = game(9, WIN);
  endDay(s, WIN);
  for (let day = 2; day <= 5; day++) {
    const tier = TIERS[day % TIERS.length];
    const idx = s.roster.enemies.findIndex((e) => e.tier === tier);
    assert.equal(confirmPlan(s, { enemyIndex: idx, gearIds: [], ringIds: [] }, WIN).ok, true);
    assert.equal(endDay(s, WIN).report.win, true);
    s.phase = 'plan'; // skip the report screen: this test is about the score
    s.intel.points = 0;
  }
  assert.ok(s.stats.score > 0);
  const b = scoreBreakdown(s, WIN);
  assert.deepEqual(b.rows.map((r) => r.tier), TIERS);
  assert.equal(b.total, s.stats.score);
  for (const r of b.rows) {
    assert.equal(r.wins, s.stats.wins[r.tier]);
    assert.equal(r.each, WIN.enemies.tiers[r.tier].score);
    assert.equal(r.points, r.wins * r.each);
  }
  assert.equal(b.rows.reduce((a, r) => a + r.points, 0), b.total);
  assert.equal(scoreBreakdown(game(1)).total, 0);
});

test('outcomeSegments: five parts in a fixed order from worst to best, counts add up, zero parts are kept', () => {
  const stats = { n: 200, wins: 90, draws: 10, losses: 100, winPct: 45, seg: { lostBadly: 60, lostClose: 40, draw: 10, wonClose: 30, wonEasily: 60 } };
  const segs = outcomeSegments(stats);
  assert.deepEqual(segs.map((x) => x.key), SEGMENTS);
  assert.deepEqual(segs.map((x) => x.key), ['lostBadly', 'lostClose', 'draw', 'wonClose', 'wonEasily']);
  assert.equal(segs.reduce((a, x) => a + x.count, 0), stats.n);
  assert.ok(Math.abs(segs.reduce((a, x) => a + x.pct, 0) - 100) < 1e-9);
  assert.equal(segs[0].pct, 30);
  assert.deepEqual(segs.map((x) => x.label), ['Lost badly', 'Lost close', 'Draw', 'Won close', 'Won easily']);
  const none = outcomeSegments({ n: 10, seg: { lostBadly: 10 } });
  assert.equal(none.length, 5);
  assert.equal(none[4].count, 0);
});

test('fightSegment: which part of the bar the real fight belongs to (closeCut % HP left)', () => {
  const cut = CONFIG.report.closeCut;
  const f = (over) => fightSegment({ win: false, draw: false, advHp: 0, advMaxHp: 100, enemyHp: 50, enemyMaxHp: 100, ...over }, CONFIG);
  assert.equal(f({ enemyHp: cut + 1 }), 'lostBadly');
  assert.equal(f({ enemyHp: cut - 1 }), 'lostClose');
  assert.equal(f({ win: true, advHp: cut - 1, enemyHp: 0 }), 'wonClose');
  assert.equal(f({ win: true, advHp: cut + 1, enemyHp: 0 }), 'wonEasily');
  assert.equal(f({ draw: true }), 'draw');
});

test('whatIfText: the three verdicts say what the plan promises', () => {
  const sword = { id: 1, slot: 'sword', material: 'iron', grade: 'B', gem: { type: 'ruby', grade: 'C' }, durability: 100 };
  const old = { id: 2, slot: 'sword', material: 'copper', grade: 'C', gem: null, durability: 100 };
  const base = { best: { winPct: 71.4 }, gain: 33.2, items: [], fromHome: [], replaced: [] };
  const helped = whatIfText({ whatIf: { ...base, verdict: 'helped', fromHome: [sword], replaced: [old] } });
  assert.equal(helped.verdict, 'helped');
  assert.equal(helped.text, `Yes. With ${gearName(sword)} from home (instead of ${gearName(old)}), the best gear you owned wins about 71% (+33 points).`);
  assert.equal(whatIfText({ whatIf: { ...base, verdict: 'helped', fromHome: [sword] } }).text, `Yes. With ${gearName(sword)} from home, the best gear you owned wins about 71% (+33 points).`);
  // a home item that fills an empty slot replaced nothing: it is named separately, not as part of a swap
  const chest = { id: 3, slot: 'chest', material: 'iron', grade: 'C', gem: null, durability: 100 };
  assert.equal(whatIfText({ whatIf: { ...base, verdict: 'helped', fromHome: [sword, chest], replaced: [old] } }).text,
    `Yes. With ${gearName(sword)} from home (instead of ${gearName(old)}), plus ${gearName(chest)} from home, the best gear you owned wins about 71% (+33 points).`);
  assert.equal(whatIfText({ whatIf: { ...base, verdict: 'helped', fromHome: [chest], replaced: [old] } }).text,
    `Yes. With ${gearName(chest)} from home, the best gear you owned wins about 71% (+33 points).`, 'a sword swapped out is not this chest\'s');
  assert.equal(whatIfText({ whatIf: { ...base, verdict: 'notHelped' } }).text, 'No. Nothing you left at home would have helped much: the best gear you owned wins about 71%.');
  assert.equal(whatIfText({ whatIf: { ...base, verdict: 'noHome' } }).text, 'You had no other gear at home: everything you owned was packed.');
});

test('clockStatus: the clock and time left in a work day, "day over" when the time is used, "Run over" with no clock and no bar once the run ended', () => {
  const s = game(5);
  const left = (state) => CONFIG.time.dayEndMin - state.time;
  const work = clockStatus(s, left(s));
  assert.equal(work.clock, formatClock(s.time));
  assert.equal(work.note, `${formatDuration(left(s))} left`);
  assert.equal(work.bar, true);
  assert.equal(work.label, dayProgress(s).label);
  s.time = CONFIG.time.dayEndMin;
  assert.deepEqual([clockStatus(s, 0).clock, clockStatus(s, 0).note], [formatClock(CONFIG.time.dayEndMin), 'day over']);
  // retired in the middle of the work day: the day's clock does not describe a finished run
  const t = game(5);
  t.time = CONFIG.time.dayStartMin + 0.8 * (CONFIG.time.dayEndMin - CONFIG.time.dayStartMin);
  endRun(t);
  assert.equal(t.phase, 'over');
  const over = clockStatus(t, left(t));
  assert.deepEqual(over, { clock: null, note: 'Run over', label: null, bar: false });
});
