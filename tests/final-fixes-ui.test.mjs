// Screen fixes from the final review of 2.0, on the minimal fake DOM (structure and wording; the layout fixes -- the Repair
// button on the durability line at 1024 / 1280, the phone quick actions, the intel cards -- were checked in Chromium).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { installFakeDom, textOf, tipsOf, withClass, findAll } from './fakedom.mjs';
import { renderMap } from '../js/ui/mapview.js';
import { renderWorkshop } from '../js/ui/workshop.js';
import { renderAdventurer } from '../js/ui/adventurer.js';
import { renderSkills } from '../js/ui/skillsview.js';
import { renderPlan, combatStatsTable, renderCombatLog } from '../js/ui/endday.js';
import { estimateCell } from '../js/ui/estimates.js';
import { marginPart, planEstimateText, estimateTip, winWithMargin, segPctText, enemySightText, enemySightPct } from '../js/ui/present.js';
import { adventurerCombatant } from '../js/core/combat.js';
import { endDay, confirmPlan } from '../js/core/game.js';
import { travel, search } from '../js/core/map.js';
import { enemySightFor, intelValue } from '../js/core/intel.js';
import { game, addGear, fieldAt, cfgWith, DEADLY_ENEMIES } from './helpers.mjs';

installFakeDom();

function makeCtx(state, cfg = CONFIG) {
  return { state, cfg, ui: { estimates: 'off', analysis: 'off' }, act: (f) => f(), rerender() {}, save() {}, toast() {}, newGame() {}, setTab() {} };
}
function render(fn, state, cfg = CONFIG) {
  const root = document.createElement('div');
  fn(root, makeCtx(state, cfg));
  return root;
}
const readable = (root) => `${textOf(root)}\n${tipsOf(root)}`;

// ---------------------------------------------------------- estimates (E2E-8) ----
test('a margin never reads past 0 or 100: "100% (-14)" and "0% (+10)", "62% ± 14" in between', () => {
  assert.equal(marginPart(62, 14), '± 14');
  assert.equal(marginPart(99.6, 14), '(−14)', '99.6% shows as 100%, so it can only be lower');
  assert.equal(marginPart(100, 14), '(−14)');
  assert.equal(marginPart(0, 10), '(+10)');
  assert.equal(marginPart(0.4, 10), '(+10)');
  assert.equal(marginPart(50, null), null);
  assert.equal(planEstimateText({ winPct: 100, margin: 8 }), '100% (−8)');
  assert.equal(planEstimateText({ winPct: 0, margin: 10 }), '0% (+10)');
  assert.equal(planEstimateText({ winPct: 62, margin: 14 }), '62% ± 14');
  assert.equal(planEstimateText({ winPct: 62, margin: null }), '62%');
});

test('the estimate cell, its hover and the confirm-bar text use the same one-sided margin', () => {
  const res = { winPct: 100, wins: 25, fights: 25, avgTime: 10, avgHpLeftPct: 50 };
  const cell = estimateCell(res);
  assert.doesNotMatch(textOf(cell), /100%\s*± \d+/);
  assert.match(textOf(cell), /^100%\(−\d+\)$/);
  assert.match(estimateTip(res), /^100% \(−\d+\) from 25 test fights \(could be \d+-100%/);
  assert.match(winWithMargin(res), /^100% \(−\d+\)$/);
  const mid = { ...res, winPct: 60, wins: 15 };
  assert.match(textOf(estimateCell(mid)), /^60%± \d+$/);
});

// ------------------------------------------------- loss analysis legend (E2E-9) ----
test('a replay share that rounds to 0 reads "<1%", never "0%"', () => {
  assert.equal(segPctText(0), '0%');
  assert.equal(segPctText(0.2), '<1%');
  assert.equal(segPctText(0.49), '<1%');
  assert.equal(segPctText(0.5), '1%');
  assert.equal(segPctText(37.4), '37%');
  assert.equal(segPctText(100), '100%');
});

// --------------------------------------------------- enemy scouting (NUM-1) ----
test('enemy scouting is shown per tier: the base number, then elites and champions with their reduction', () => {
  const s = game(7);
  const base = intelValue(s, 'enemySight');
  const elite = enemySightFor(s, 'elite');
  const champ = enemySightFor(s, 'champion');
  assert.ok(elite < base && champ < elite, 'the multiplier from the config makes elites and champions harder to scout');
  assert.equal(enemySightText(s), `${base}% (elites ${enemySightPct(s, 'elite')}, champions ${enemySightPct(s, 'champion')})`);
  assert.match(enemySightText(s), /^\d+% \(elites [\d.]+%, champions [\d.]+%\)$/);
  // the Adventurer tab and the plan screen print the per-tier numbers, not just the base
  assert.match(textOf(render(renderAdventurer, s)), /each attribute visible \d+% \(elites [\d.]+%, champions [\d.]+%\)/);
  const plan = game(7);
  addGear(plan, 'sword', 'copper', 'D');
  assert.equal(endDay(plan).ok, true);
  assert.match(textOf(render(renderPlan, plan)), /Enemy scouting \d+% \(elites [\d.]+%, champions [\d.]+%\)/);
  // the roster's "Hidden attributes" row says what chance each enemy's attributes had of being seen
  assert.match(tipsOf(render(renderPlan, plan)), /Each attribute is visible with your Enemy scouting chance: \d+% \(elites/);
  assert.match(tipsOf(render(renderPlan, plan)), /Each attribute of this (normal|elite|champion) is visible with a [\d.]+% chance/);
});

// -------------------------------------------------- pierce resistance cap (NUM-2) ----
test('a defence past the combat cap shows the capped value and says so (no "110.4%" of piercing ignored)', () => {
  const adv = adventurerCombatant([], {}, CONFIG);
  const over = { ...adv, pierceRes: 110.4, magicRes: 40, stunChanceRed: 80 };
  const table = combatStatsTable([{ label: 'Adventurer', c: over }], CONFIG);
  const text = textOf(table);
  assert.doesNotMatch(text, /110\.4/);
  assert.match(text, /Pierce resistance \(% of piercing ignored\)75%\s*\(cap\)/);
  assert.match(text, /Stun chance reduction75%\s*\(cap\)/);
  assert.match(tipsOf(table), /Your gear and rings give 110\.4%, but combat counts at most 75%/);
  // a value under the cap is shown as it is, without the "(cap)" note
  assert.doesNotMatch(textOf(combatStatsTable([{ label: 'A', c: { ...adv, pierceRes: 60 } }], CONFIG)).replace(/Defense[^\n]*/g, ''), /\(cap\)/);
});

// ----------------------------------------------------- scrap note (CORE-DUR2) ----
test('the scrap note does not print a sum that is off by a hundredth: a fractional durability says it is rounded down', () => {
  const s = game(3);
  const chest = addGear(s, 'chest', 'iron', 'D', null, { durability: 66.9 });
  const whole = addGear(s, 'sword', 'iron', 'C', null, { durability: 60 });
  const root = render(renderWorkshop, s);
  const scrap = (id) => findAll(root, (el) => el.attributes['data-scrap'] === String(id))[0].attributes.title;
  assert.match(scrap(chest.id), /35% of its 3 bars × its durability \(shown as 66%, rounded down\)/);
  assert.doesNotMatch(scrap(chest.id), /× 66% durability/);
  assert.match(scrap(whole.id), /35% of its 2 bars × 60% durability/);
});

// ------------------------------------------------- repair times (TIME-1) ----
test('long repair times read like the rest of the game: "2h 1.8m", never "121.8m"', () => {
  const s = game(3);
  s.storage.bars['iron:D'] = 5;
  s.storage.cut['diamond:C'] = 3;
  addGear(s, 'chest', 'iron', 'D', { type: 'diamond', grade: 'C' }, { durability: 6 });
  const root = render(renderWorkshop, s);
  const rows = withClass(root, 'gl-row');
  const text = readable(root);
  assert.match(textOf(rows[1] || rows[0]), /\d+h \d/, 'the cost line of the repair');
  assert.doesNotMatch(text, /\b1\d\d\.\dm\b/, 'no raw minutes past 100');
  assert.doesNotMatch(text, /needs \d{3,}/);
});

// -------------------------------------------------- gem tile (E2E-5) ----
test('a gem tile is marked short when no grade has a whole cut gem (repairs leave 0.82 of one)', () => {
  const s = game(3);
  s.storage.cut['topaz:B'] = 0.82;
  s.storage.cut['ruby:C'] = 2;
  const root = render(renderWorkshop, s);
  const tile = (gem) => findAll(root, (el) => el.tagName === 'BUTTON' && el.attributes['data-gem'] === gem)[0];
  assert.ok(tile('topaz').classList.contains('short'), '0.82 of a gem cannot be infused');
  assert.match(tile('topaz').attributes.title, /No grade has a whole gem left/);
  assert.ok(tile('diamond').classList.contains('short'), 'none at all');
  assert.ok(!tile('ruby').classList.contains('short'), '2 whole gems');
  s.storage.cut['topaz:A'] = 1;
  assert.ok(!findAll(render(renderWorkshop, s), (el) => el.tagName === 'BUTTON' && el.attributes['data-gem'] === 'topaz')[0].classList.contains('short'), 'a whole gem of another grade makes it usable');
});

// --------------------------------------- gem outcome hover (R18) ----
test('a gem row hover shows only your current chances (no first-time cutter / novice / master table)', () => {
  const s = game(3);
  s.storage.gem.ruby = 2;
  const text = tipsOf(render(renderWorkshop, s));
  assert.match(text, /Your chances: Fail [\d.]+%, D [\d.]+%, C [\d.]+%, B [\d.]+%, A [\d.]+%, S [\d.]+%\. Your skills and rings make the difference/);
  assert.doesNotMatch(text, /first-time cutter|novice|master/i);
});

// ----------------------------------------------------- phone quick actions (E2E-2) ----
test('in a field the grid is followed by Search area and Return to camp (shown on phones only, by css)', () => {
  const s = game(7);
  const c = fieldAt(s, 1);
  assert.equal(travel(s, { x: c.x, y: c.y }).ok, true);
  const root = render(renderMap, s);
  const quick = withClass(root, 'mv-quick')[0];
  assert.ok(quick, 'a quick action row');
  const btns = findAll(quick, (el) => el.tagName === 'BUTTON');
  assert.deepEqual(btns.map((b) => b.attributes['data-quick']), ['search', 'return']);
  assert.match(textOf(btns[0]), /^Search area · /);
  assert.equal(btns[0].hasAttribute('disabled'), false);
  // the row sits right after the grid, before the long explanation
  const panel = quick.parentNode;
  const kids = panel.childNodes;
  const gridAt = kids.findIndex((k) => k.classList && k.classList.contains('mv-fieldgrid') || (k.classList && k.classList.contains('grid')));
  assert.ok(gridAt >= 0 && kids.indexOf(quick) === gridAt + 1, 'directly under the grid');
  // the same action as the Actions panel: one search is made
  const before = s.time;
  const r = search(s, 4, 4);
  assert.equal(r.ok, true);
  assert.ok(s.time > before);
});

// ------------------------------------------------------ touch explanations (TOUCH-1) ----
test('a rock on the world map explains itself with a tap popover, not only a title', () => {
  const s = game(7);
  const map = render(renderMap, s);
  const world = withClass(map, 'mv-worldmap')[0];
  const rocks = findAll(world, (el) => el.classList.contains('cell') && el.classList.contains('blocked'));
  assert.ok(rocks.length > 0, 'the map has rock');
  for (const r of rocks) {
    assert.equal(r.attributes['data-tip'], 'Impassable rock: paths go around it.');
    assert.equal(r.attributes.title, r.attributes['data-tip']);
  }
});

test('the combat log Effects cell carries the full stun / slow text as a tap popover', () => {
  const log = [
    { t: 1.5, side: 'E', hit: true, dmg: 17.8, phys: 16.8, magic: 1, slow: { pct: 4.6, dur: 2.7 }, hpA: 82.2, hpE: 170.6 },
    { t: 3.6, side: 'A', hit: true, dmg: 30.2, phys: 30.2, magic: 0, stun: 1.5, hpA: 67.2, hpE: 110.3 },
    { t: 5.5, side: 'A', hit: true, dmg: 32.1, phys: 32.1, magic: 0, hpA: 67.2, hpE: 78.3 },
  ];
  const node = renderCombatLog({ enemy: { name: 'Bandit Captain' }, log, advMaxHp: 100, enemyMaxHp: 170.6, win: true, time: 11 });
  const cells = withClass(node, 'clog-fx').filter((c) => c.tagName === 'TD');
  assert.equal(cells.length, 3);
  assert.equal(cells[0].attributes['data-tip'], 'Slow 4.6% 2.7s');
  assert.equal(cells[1].attributes['data-tip'], 'Stun 1.5s');
  assert.equal(cells[2].hasAttribute('data-tip'), false, 'no effect, nothing to explain');
});

test('intel: the Spend button of a finished run is off and says why on a wrapper that takes a tap', () => {
  const lose = cfgWith(DEADLY_ENEMIES);
  const s = game(5, lose);
  assert.equal(endDay(s, lose).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }, lose).ok, true);
  endDay(s, lose);
  assert.equal(s.phase, 'over');
  s.intel.points = 1;
  const root = render(renderSkills, s, lose);
  const spend = findAll(root, (el) => el.tagName === 'BUTTON' && /Spend 1 point/.test(textOf(el)));
  assert.ok(spend.length > 0);
  for (const b of spend) {
    assert.equal(b.hasAttribute('disabled'), true, 'nothing left to spend a point on');
    assert.equal(b.parentNode.attributes['data-tip'], 'The run is over.');
  }
  // the top bar's intel chip is for a run that goes on: see js/main.js
});

test('the intel track of a working run: a point can be spent and the button needs no wrapper', () => {
  const s = game(5);
  s.intel.points = 1;
  const root = render(renderSkills, s);
  const spend = findAll(root, (el) => el.tagName === 'BUTTON' && /Spend 1 point/.test(textOf(el)) && !el.hasAttribute('disabled'));
  assert.ok(spend.length > 0, 'an enabled Spend button');
  assert.ok(!spend[0].parentNode.attributes['data-tip'], 'the enabled button is the tap target itself');
});

// ------------------------------------------------------ gear matrix (R38-1) ----
test('the gear overview puts the Gems column right after the gear type (first on a phone, where the box scrolls sideways)', () => {
  const s = game(3);
  addGear(s, 'sword', 'iron', 'C', { type: 'topaz', grade: 'C' });
  const root = render(renderWorkshop, s);
  const table = withClass(root, 'inv-geartable')[0];
  const heads = findAll(table, (el) => el.tagName === 'TH').map(textOf);
  assert.deepEqual(heads, ['Gear', 'Gems', 'Copper', 'Iron', 'Steel', 'Mythril']);
  const sword = findAll(table, (el) => el.tagName === 'TR').find((r) => /^Sword/.test(textOf(r)));
  assert.match(textOf(sword.childNodes[1]), /To/, 'the gem summary is the second cell');
});
