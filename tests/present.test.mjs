// Display helpers that need no DOM (js/ui/present.js). Batch 4: the estimate cache key and the estimate texts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { estimateKey, estimateTip, winWithMargin, winClass, winText, sortedIds, gearAnswers } from '../js/ui/present.js';
import { simCounts, shownMargin } from '../js/core/sim.js';
import { knownLevels } from '../js/core/enemies.js';
import { game, cfgWith, addGear, addRing } from './helpers.mjs';

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
