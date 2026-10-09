// UI render smoke test: every screen module renders, in the main game states, without throwing, and the
// text a player can read (plus hover texts) says what this version promises. Runs on a minimal fake DOM
// (tests/fakedom.mjs): nothing is laid out and no events fire, so this checks structure and wording only.
//
// Each batch adds its own text assertions here (e.g. no "regrow" anywhere, nothing seen on day 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, BARS, GEMS, SLOTS } from '../js/config.js';
import { VERSION } from '../js/version.js';
import { installFakeDom, textOf, tipsOf, withClass, findAll, countTags } from './fakedom.mjs';
import { renderMap } from '../js/ui/mapview.js';
import { renderWorkshop } from '../js/ui/workshop.js';
import { LOW_DURABILITY } from '../js/ui/inventory.js';
import { renderAdventurer } from '../js/ui/adventurer.js';
import { renderRings } from '../js/ui/ringsview.js';
import { renderSkills, spendIntelAction } from '../js/ui/skillsview.js';
import { renderLog } from '../js/ui/logview.js';
import { renderHelp } from '../js/ui/help.js';
import { renderPlan, renderReport, renderRunSummary } from '../js/ui/endday.js';
import { endDay, confirmPlan, acknowledgeReport, endRun } from '../js/core/game.js';
import { analyzeLossSync } from '../js/core/replay.js';
import { tip, restoreScrollLeft, isRestoredScroll } from '../js/ui/dom.js';
import { scrapReturn, smithMinutes, repairMinutes, wearLoss } from '../js/core/gear.js';
import { skillDefs, skillHoverText } from '../js/core/skills.js';
import { intelValue } from '../js/core/intel.js';
import { growth } from '../js/core/enemies.js';
import { durText, repairGainShown, winText } from '../js/ui/present.js';
import { attrValueText, wearText } from '../js/ui/endday.js';
import { whenEstimatesDone } from '../js/ui/estimates.js';
import { bannersLine, bannerLabel, bannersText, groupRewardText } from '../js/core/groups.js';
import { hiddenGradeOdds } from '../js/core/enemies.js';
import { canSpendIntel } from '../js/core/intel.js';
import { travel, search, currentField, sightValue, seenItems, expectedSearches, searchesText, searchesToFinish } from '../js/core/map.js';
import { game, cfgWith, addGear, addRing, fieldAt, setSkillLevel, WEAK_ENEMIES, DEADLY_ENEMIES, DAY_START } from './helpers.mjs';
import { renderCombatLog } from '../js/ui/endday.js';

installFakeDom();

const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);

// What the app's shell passes to every screen (js/main.js), with the side effects turned into no-ops.
function makeCtx(state, cfg = CONFIG) {
  return { state, cfg, ui: { estimates: 'off', analysis: 'off' }, act: (f) => f(), rerender() {}, save() {}, toast() {}, newGame() {}, setTab() {} };
}

function render(fn, state, cfg = CONFIG, ctx = makeCtx(state, cfg)) {
  const root = document.createElement('div');
  fn(root, ctx);
  return root;
}

// Everything a player can read on a screen: visible text and hover texts.
const readable = (root) => `${textOf(root)}\n${tipsOf(root)}`;

// ---------------------------------------------------------------- states ----
const stateDay1 = () => game(7);

// Standing in a field at distance 1 after one search, with `ring` Ore sight rings worn (0 = none).
function stateInField(ringGrade = null) {
  const s = game(7);
  if (ringGrade) addRing(s, 'reveal', ringGrade, true);
  const c = fieldAt(s, 1);
  assert.equal(travel(s, { x: c.x, y: c.y }).ok, true);
  assert.equal(search(s, 1, 1).ok, true);
  return s;
}

// Day 1 ended: the plan screen (no fight happened today, so no report).
function statePlan(points = 0) {
  const s = game(7);
  addGear(s, 'sword', 'copper', 'D');
  assert.equal(endDay(s).ok, true);
  assert.equal(s.phase, 'plan');
  s.intel.points = points;
  return s;
}

// Day 2's fight is won: the report phase.
function stateReport() {
  const s = game(7, WIN);
  assert.equal(endDay(s, WIN).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }, WIN).ok, true);
  const r = endDay(s, WIN);
  assert.equal(r.report.win, true);
  assert.equal(s.phase, 'report');
  return s;
}

// Day 2's fight is lost: game over.
function stateOver() {
  const s = game(7, LOSE);
  assert.equal(endDay(s, LOSE).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }, LOSE).ok, true);
  endDay(s, LOSE);
  assert.equal(s.phase, 'over');
  return s;
}

const WORK_SCREENS = { map: renderMap, workshop: renderWorkshop, adventurer: renderAdventurer, rings: renderRings, skills: renderSkills, log: renderLog, help: renderHelp };
const REFERENCE_SCREENS = { rings: renderRings, skills: renderSkills, log: renderLog, help: renderHelp };

test('every work-phase screen renders on day 1 at camp and in a field after a search', () => {
  for (const [label, make] of [['day 1 at camp', stateDay1], ['in a field', () => stateInField()], ['in a field with an Ore sight ring', () => stateInField('S')]]) {
    for (const [name, fn] of Object.entries(WORK_SCREENS)) {
      const root = render(fn, make());
      assert.ok(root.childNodes.length > 0, `${name} (${label}) rendered nothing`);
      assert.ok(textOf(root).length > 40, `${name} (${label}) has no text`);
    }
  }
});

test('the plan, report and game-over screens render, and the reference tabs render in those phases', () => {
  const phases = [['plan', statePlan(), () => renderPlan], ['plan with an intel point', statePlan(1), () => renderPlan],
    ['report', stateReport(), () => renderReport], ['over', stateOver(), () => renderRunSummary]];
  for (const [label, s, pick] of phases) {
    const root = render(pick(), s);
    assert.ok(textOf(root).length > 40, `${label} has no text`);
    for (const [name, fn] of Object.entries(REFERENCE_SCREENS)) {
      assert.ok(textOf(render(fn, s)).length > 40, `${name} in the ${label} phase`);
    }
  }
});

// -------------------------------------------------------------- no regrowth ----
test('nothing a player can read mentions regrowth (R25)', () => {
  const states = [['day 1', stateDay1()], ['in a field', stateInField()], ['plan', statePlan(1)], ['report', stateReport()], ['over', stateOver()]];
  for (const [label, s] of states) {
    const screens = s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : s.phase === 'report' ? renderReport : renderRunSummary]];
    for (const [name, fn] of screens) {
      const text = readable(render(fn, s));
      assert.doesNotMatch(text, /regrow|grow back|refill|reset overnight/i, `${name} (${label})`);
    }
  }
});

// --------------------------------------------------------- map: world, plots ----
test('the world map is map.size square and the camp panel explains walking, searching (about N searches), sight and debris', () => {
  const s = stateDay1();
  const root = render(renderMap, s);
  const n = CONFIG.map.size;
  assert.equal(withClass(root, 'mv-worldmap').length, 1, 'one world map on the camp screen');
  const tiles = withClass(withClass(root, 'mv-worldmap')[0], 'cell');
  assert.equal(tiles.length, n * n);
  assert.equal(tiles.filter((t) => t.classList.contains('blocked')).length, CONFIG.map.blockedCells);
  assert.equal(tiles.filter((t) => t.classList.contains('camp')).length, 1);
  const text = textOf(root);
  assert.match(text, new RegExp(`${CONFIG.map.travelMinPerStep}m per step, \\+${CONFIG.map.loadPenaltyPerItem}% per item carried`));
  assert.match(text, new RegExp(`about ${searchesText(expectedSearches(s, CONFIG))} searches finish a cell`));
  // phones hide the "dist N" line of the tiles (css/ui-map.css), so the note must not promise it everywhere
  assert.match(text, /shows how much of that field you have searched and the walk from here \(on a wider screen also its distance from camp\)/);
  assert.match(text, /Sight/);
  assert.match(text, /\d+(-\d+)? boulders per field( \(more far from camp\))? can never be searched/);
  assert.doesNotMatch(text, /chance per searched cell|reveal everything/i);
  // the by-distance table is a closed <details> with one row per distance on this map and a Boulders column
  const details = findAll(root, (el) => el.tagName === 'DETAILS' && el.classList.contains('mv-odds-box'));
  assert.equal(details.length, 1);
  assert.equal('open' in details[0].attributes, false, 'closed by default');
  assert.match(textOf(details[0]), /Boulders/);
  assert.match(textOf(details[0]), new RegExp(`Fields farther than ${CONFIG.field.byDistance.length} steps use the distance-${CONFIG.field.byDistance.length} row`));
});

test('Help and the camp panel both derive "about N searches finish a cell" from the config; Help ignores your bonuses, the Map includes them', () => {
  const texts = new Set();
  for (const field of [{ searchEfficiency: 50, searchRandomness: 0 }, { searchEfficiency: 20, searchRandomness: 5 }, { searchEfficiency: 35, searchRandomness: 5 }]) {
    const cfg = cfgWith({ field });
    const s = stateDay1();
    const want = `about ${searchesText(expectedSearches(s, cfg))} searches finish a cell`;
    texts.add(want);
    assert.match(textOf(render(renderMap, s, cfg)), new RegExp(want), 'Map');
    assert.match(textOf(render(renderHelp, s, cfg)), new RegExp(want), 'Help');
  }
  assert.equal(texts.size, 3, 'the number really follows the config');
  // a worn Thorough search ring changes what the Map says (your numbers) but not Help (the base rules)
  const cfg = cfgWith({ field: { searchEfficiency: 30, searchRandomness: 5 } });
  const s = stateDay1();
  const base = `about ${searchesText(searchesToFinish(25, 35))} searches finish a cell`;
  addRing(s, 'searchEff', 'S', true);
  assert.ok(expectedSearches(s, cfg) < searchesToFinish(25, 35), 'the ring needs fewer searches');
  assert.match(textOf(render(renderHelp, s, cfg)), new RegExp(base), 'Help: base rules');
  assert.match(textOf(render(renderMap, s, cfg)), new RegExp(`about ${searchesText(expectedSearches(s, cfg))} searches finish a cell`), 'Map: with the ring');
});

test('a field is drawn as 9 plots of 3x3 cells', () => {
  const s = stateInField();
  const root = render(renderMap, s);
  const grids = withClass(root, 'mv-fieldgrid');
  assert.equal(grids.length, 1);
  const plots = withClass(grids[0], 'mv-plot');
  assert.equal(plots.length, (CONFIG.field.size / 3) ** 2);
  for (const p of plots) assert.equal(withClass(p, 'cell').length, 9, 'each plot holds 3x3 cells');
  assert.equal(withClass(grids[0], 'cell').length, CONFIG.field.size ** 2);
  // the default selection is the first plot's centre, label (2,2)
  const sel = withClass(grids[0], 'sel');
  assert.equal(sel.length, 1);
  assert.equal(sel[0].attributes['data-idx'], String(CONFIG.field.size + 1));
  assert.match(textOf(root), /selected: \(2,2\)/);
});

// -------------------------------------------------------------- map: sight ----
test('with no sight (day 1: spec-guards pins the config to it) nothing is seen: "0 items seen" and no seen tags (Sight 0)', () => {
  const NO_SIGHT = cfgWith({ intel: { tracks: { oreSight: { base: 0 } } } });
  const s = stateInField();
  assert.equal(sightValue(s, NO_SIGHT), 0);
  const root = render(renderMap, s, NO_SIGHT);
  assert.match(textOf(root), /0 items seen/);
  assert.equal(withClass(withClass(root, 'mv-fieldgrid')[0], 'mv-seen').length, 0, 'no cell of the field shows a seen item');
  assert.match(textOf(root), /Sight 0/);
  assert.match(tipsOf(root), /Sight 0 = Ore sight intel 0 \+ rings 0/);
  // the selected cell says so too
  assert.match(textOf(root), /Nothing seen \(sight 0\)/);
});

test('with sight, cells show the rarest seen item (+N for more) and the header counts the items seen', () => {
  const s = stateInField('S'); // an S Ore sight ring
  const sight = sightValue(s);
  assert.ok(sight > 0);
  const f = currentField(s);
  const seenCount = f.cells.reduce((a, c) => a + seenItems(c, sight).length, 0);
  assert.ok(seenCount > 0, 'something to see in this field');
  const root = render(renderMap, s);
  const text = textOf(root);
  assert.match(text, new RegExp(`${seenCount} items? seen`));
  const seenCells = withClass(withClass(root, 'mv-fieldgrid')[0], 'mv-seen');
  assert.ok(seenCells.length > 0 && seenCells.length <= seenCount);
  assert.match(tipsOf(root), new RegExp(`Seen \\(sight ${sight}\\):`));
  const intel = intelValue(s, 'oreSight');
  assert.match(tipsOf(root), new RegExp(`Sight ${sight} = Ore sight intel ${intel} \\+ rings ${sight - intel}`));
  // the Sight chip explains the thresholds and how much of each item type is seen
  assert.match(tipsOf(root), /you see it once your sight reaches it: copper \d+-\d+, iron \d+-\d+, coal \d+-\d+, gems \d+-\d+, mythril \d+-\d+/);
  assert.match(tipsOf(root), /With sight .+ you see (all the copper|about \d+% of the copper)/);
  // legend: one "Seen item" swatch replaces the two "Revealed" ones
  assert.match(text, /Seen item/);
  assert.doesNotMatch(text, /Revealed/);
});

test('sight sees through debris: a debris cell with seen items shows the rarest tag, +N and the debris number', () => {
  const s = stateInField('S');
  const f = currentField(s);
  const n = CONFIG.field.size;
  const sight = sightValue(s);
  assert.ok(sight >= 1);
  const grid = (st) => withClass(render(renderMap, st), 'mv-fieldgrid')[0];
  const at = (g, i) => withClass(g, 'cell').find((c) => c.attributes['data-idx'] === String(i));
  // cell 2: debris over a Copper ore and a Ruby (both seen, thresholds 1); cell 3: debris over nothing; cell 4: no debris, two seen items
  const [a, b, c] = [2, 3, 4].map((i) => (i + 3 * n) % (n * n)); // away from the cell the search touched
  Object.assign(f.cells[a], { boulder: false, searched: 0, debris: 33, items: [{ t: 'ore:copper', d: 40, s: 1 }, { t: 'gem:ruby', d: 50, s: 1 }] });
  Object.assign(f.cells[b], { boulder: false, searched: 0, debris: 21, items: [{ t: 'ore:iron', d: 40, s: sight + 1 }] });
  Object.assign(f.cells[c], { boulder: false, searched: 0, debris: 0, items: [{ t: 'ore:copper', d: 40, s: 1 }, { t: 'ore:iron', d: 50, s: 1 }] });
  const g = grid(s);
  const withItems = at(g, a);
  assert.ok(withItems.classList.contains('debris') && withItems.classList.contains('mv-seen'), 'a debris cell can be a seen cell');
  assert.equal(withClass(withItems, 'mv-item').length, 1, 'one tag: the rarest seen item');
  assert.equal(textOf(withClass(withItems, 'mv-item')[0]), 'Ru', 'the ruby, not the copper');
  assert.equal(textOf(withClass(withItems, 'mv-more')[0]), '+1');
  assert.equal(textOf(withClass(withItems, 'mv-debris-n')[0]), '33', 'the debris number stays');
  assert.match(withItems.attributes.title, /Debris: 33 left/);
  assert.match(withItems.attributes.title, /Seen \(sight [\d.]+\): Raw ruby, Copper ore\./, 'tip lists the rarest first, like the tag');
  // debris over nothing seen: just the number; a seen cell without debris: just the tag
  const bare = at(g, b);
  assert.equal(bare.classList.contains('mv-seen'), false);
  assert.equal(withClass(bare, 'mv-item').length, 0);
  assert.equal(textOf(withClass(bare, 'mv-debris-n')[0]), '21');
  const clear = at(g, c);
  assert.equal(withClass(clear, 'mv-debris-n').length, 0);
  assert.equal(textOf(withClass(clear, 'mv-item')[0]), 'Fe', 'iron is rarer than copper');
  // the header counts what the grid shows: every seen item is under some cell with a tag
  const seenCount = f.cells.reduce((acc, cell) => acc + seenItems(cell, sight).length, 0);
  assert.match(textOf(render(renderMap, s)), new RegExp(`${seenCount} items seen`));
  const tagged = withClass(g, 'mv-seen').length;
  assert.equal(tagged, f.cells.filter((cell) => seenItems(cell, sight).length && !(cell.searched >= 100)).length, 'every cell with a seen item shows a tag, debris or not');
});

test('the sight tip reads naturally: "all the copper", about N% only once', () => {
  // pinned thresholds and sight 40: all the copper, 60% of the iron, 40% of the coal, 33% of the gems, no mythril
  const cfg = cfgWith({
    field: { sight: { copper: [0, 40], iron: [10, 60], coal: [20, 70], gem: [20, 80], mythril: [40, 100] } },
    intel: { tracks: { oreSight: { base: 40, max: 100 } } },
  });
  const s = stateInField();
  const text = tipsOf(render(renderMap, s, cfg));
  assert.match(text, /With sight 40 you see all the copper, about 60% of the iron, 40% of the coal, 33% of the gems and no mythril\./);
  assert.doesNotMatch(text, /about all/);
  // sight 0 sees nothing; a sight that sees every kind has no "no ..." part
  const none = tipsOf(render(renderMap, s, cfgWith(cfg, { intel: { tracks: { oreSight: { base: 0 } } } })));
  assert.match(none, /With sight 0 you see nothing yet\./);
  const lots = tipsOf(render(renderMap, s, cfgWith(cfg, { intel: { tracks: { oreSight: { base: 100 } } } })));
  assert.match(lots, /With sight 100 you see all the copper, iron, coal, gems and mythril\./);
});

test('Ore sight intel raises the sight shown on the map', () => {
  const s = stateInField();
  s.intel.spent.oreSight = 3;
  const sight = sightValue(s);
  assert.equal(sight, CONFIG.intel.tracks.oreSight.gains.slice(0, 3).reduce((a, b) => a + b, CONFIG.intel.tracks.oreSight.base));
  assert.match(textOf(render(renderMap, s)), new RegExp(`Sight ${sight}`));
});

// ------------------------------------------------------- skills & intel tab ----
test('the Skills & Intel tab lists all six intel tracks with values in their own units', () => {
  const s = stateDay1();
  s.intel.points = 1;
  const root = render(renderSkills, s);
  const text = textOf(root);
  for (const t of Object.values(CONFIG.intel.tracks)) assert.ok(text.includes(t.name), `track ${t.name}`);
  assert.equal(Object.keys(CONFIG.intel.tracks).length, 6);
  assert.match(text, new RegExp(`${CONFIG.intel.tracks.oreSight.base} sight`), 'Ore sight is a sight value');
  assert.match(text, new RegExp(`\\+${CONFIG.intel.tracks.simDepth.base}\\b`), 'Battle simulation is a count');
  assert.match(text, new RegExp(`${CONFIG.intel.tracks.enemySight.base}%`));
  assert.match(text, new RegExp(`${CONFIG.intel.tracks.groupSight.base}%`));
  assert.doesNotMatch(text, /Gain per point spent|1st|2nd|3rd/, 'no full gains schedule');
  assert.doesNotMatch(text, /chance per searched cell/);
});

test('the plan screen offers all six intel tracks, with or without a point to spend', () => {
  for (const pts of [0, 1]) {
    const root = render(renderPlan, statePlan(pts));
    const text = textOf(root);
    for (const t of Object.values(CONFIG.intel.tracks)) assert.ok(text.includes(t.name), `${pts} points: ${t.name}`);
    assert.match(text, new RegExp(`${CONFIG.intel.tracks.oreSight.base} sight`));
  }
  assert.match(textOf(render(renderPlan, statePlan(1))), new RegExp(`${CONFIG.intel.tracks.oreSight.base} sight → \\d+ sight`));
  // one Spend button per track while a point is in hand, none without
  const spendButtons = (pts) => findAll(render(renderPlan, statePlan(pts)), (el) => el.tagName === 'BUTTON' && el.attributes['data-intel'] !== undefined);
  assert.equal(spendButtons(1).length, Object.keys(CONFIG.intel.tracks).length);
  assert.equal(spendButtons(0).length, 0);
});

test('spending intel says the new value in the track\'s unit', () => {
  const s = stateDay1();
  s.intel.points = 3;
  const ctx = makeCtx(s);
  assert.equal(spendIntelAction(ctx, 'oreSight').msg, `Ore sight is now ${CONFIG.intel.tracks.oreSight.base + CONFIG.intel.tracks.oreSight.gains[0]} sight.`);
  assert.match(spendIntelAction(ctx, 'enemySight').msg, /^Enemy scouting is now \d+%\.$/);
  const sim = spendIntelAction(ctx, 'simDepth');
  assert.match(sim.msg, /^Battle simulation is now \+\d+\. The win-chance estimate uses \d+ guesses x \d+ test fights per enemy\.$/);
});

// -------------------------------------------------------------------- help ----
test('Help describes sight and the by-distance tables, and has no regrowth, ore-sight chance or intel gains table', () => {
  const root = render(renderHelp, stateDay1());
  const text = textOf(root);
  assert.match(text, /your sight shows some of the items still in the ground/i);
  assert.match(text, /Sight needed/);
  assert.match(text, /Richness by distance/);
  assert.doesNotMatch(text, /regrow/i);
  assert.doesNotMatch(text, /Gain per point spent/);
  assert.doesNotMatch(text, /chance to reveal everything/i);
});

// ------------------------------------------------------ skills tab (batch 2) ----
test('the Skills tab: grouped skill tables, Skill levels (no Maxed), hovers on every skill, no level-10 value anywhere', () => {
  const s = stateDay1();
  setSkillLevel(s, 'travel', 3);
  s.skills.travel.xp = 40;
  setSkillLevel(s, 'repair_iron', 2);
  const root = render(renderSkills, s);
  const text = textOf(root);
  const all = readable(root);
  assert.match(text, /Skill levels/);
  assert.match(text, new RegExp(`${skillDefs().length} skills`));
  assert.doesNotMatch(all, /Maxed/, 'R43: no Maxed KPI');
  assert.doesNotMatch(all, /level[ -]10/i, 'R18: no level-10 value');
  assert.doesNotMatch(all, /vs rings|no ring\b|= C-grade/i, 'the level-10 vs ring columns are gone');
  assert.match(text, /Skills level up by themselves as you work\. Hover or tap a skill for what it does and how to earn XP\./);
  for (const title of ['Travel and fields', 'Workshop', 'Bar types', 'Gem types', 'Intel']) assert.ok(text.includes(title), title);
  // every activity skill is a table row with its name, level and a tap / hover text
  const rows = findAll(root, (el) => el.tagName === 'TR' && el.attributes['data-tip']);
  const activity = skillDefs().filter((d) => !d.material);
  assert.equal(rows.length, activity.length, 'one hoverable row per activity skill');
  for (const d of activity) assert.ok(text.includes(d.name), d.name);
  const travelRow = rows.find((r) => textOf(r).startsWith('Travel'));
  assert.equal(travelRow.attributes['data-tip'], skillHoverText(s, 'travel'));
  assert.equal(travelRow.attributes.title, travelRow.attributes['data-tip'], 'a mouse gets the same text as the title');
  assert.match(textOf(travelRow), /40\/\d+/, 'XP progress');
  assert.match(textOf(travelRow), /3[\s\S]*% less travel time/, 'level and the effect now');
  // bar types and gem types: a matrix of "Lv N" cells, each with a hover
  const matrixCells = findAll(root, (el) => el.classList.contains('mi-lv'));
  const perMaterial = skillDefs().filter((d) => d.material);
  assert.equal(matrixCells.length, perMaterial.length);
  assert.ok(matrixCells.every((c) => /^Lv \d+$/.test(textOf(c)) && c.attributes['data-tip']));
  assert.ok(matrixCells.some((c) => textOf(c) === 'Lv 2' && /^Iron repair: level 2\./.test(c.attributes['data-tip'])));
  for (const head of ['Grade', 'Refining', 'Smithing', 'Repair', 'Cutting']) assert.ok(text.includes(head), head);
  // the hover texts say what it does and how to earn XP
  assert.match(all, /Travel: level 3\.\nNow: [\d.]+% less travel time\.\nNext level: [\d.]+% less travel time\.\nXP: \d+ per map step walked \(40 \/ \d+ to level 4\)\./);
  assert.match(all, /Copper repair: level 0\.\nNo effect yet\./);
  assert.match(all, /Only for copper gear\./);
  // in the other phases too
  for (const st of [statePlan(), stateReport(), stateOver()]) assert.doesNotMatch(readable(render(renderSkills, st)), /Maxed|level[ -]10/i);
});

test('hover details use tip(): the same text as the title and as data-tip (so a tap can open it)', () => {
  assert.deepEqual(tip('Why'), { title: 'Why', 'data-tip': 'Why' });
  const root = render(renderSkills, stateDay1());
  const withTip = findAll(root, (el) => el.attributes['data-tip']);
  assert.ok(withTip.length >= skillDefs().length);
  for (const el of withTip) assert.equal(el.attributes.title, el.attributes['data-tip']);
});

// ---------------------------------------------- repairs by day, scrap (batch 2) ----
const NIGHT_WORDS = /free at night|no time tonight|repairs? (at|by) night|repair tonight|cost materials but no time|repairs tonight/i;

test('no screen talks about night repairs; the plan screen says repairs happen at camp by day and has no repair buttons', () => {
  const worn = (s) => {
    addGear(s, 'sword', 'copper', 'D', null, { durability: 60 });
    addGear(s, 'chest', 'iron', 'C', { type: 'ruby', grade: 'B' }, { durability: 35 });
    return s;
  };
  const states = [['day 1', worn(stateDay1())], ['in a field', worn(stateInField())], ['plan', worn(statePlan(1))], ['report', worn(stateReport())], ['over', stateOver()]];
  for (const [label, s] of states) {
    const screens = s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : s.phase === 'report' ? renderReport : renderRunSummary]];
    for (const [name, fn] of screens) assert.doesNotMatch(readable(render(fn, s)), NIGHT_WORDS, `${name} (${label})`);
  }
  for (const [label, s] of states.filter(([, st]) => st.phase === 'plan' || st.phase === 'report')) {
    const root = render(s.phase === 'plan' ? renderPlan : renderReport, s);
    assert.equal(findAll(root, (el) => el.attributes['data-repair'] !== undefined).length, 0, `${label}: no repair buttons`);
  }
  const plan = textOf(render(renderPlan, states[2][1]));
  assert.match(plan, /Repairs happen at camp during the day, on gear the adventurer does not have\. To repair an item, leave it home: tomorrow you can repair it in the Workshop\./);
});

test('the Workshop gear list: Repair buttons by day (time and bars), a Scrap button that says what comes back, no night banner', () => {
  const s = stateDay1();
  const sword = addGear(s, 'sword', 'copper', 'D', { type: 'ruby', grade: 'B' }, { durability: 60 });
  s.storage.bars['copper:D'] = 3;
  s.storage.cut['ruby:B'] = 1;
  setSkillLevel(s, 'repair_copper', 2);
  const root = render(renderWorkshop, s);
  const text = textOf(root);
  const all = readable(root);
  assert.doesNotMatch(all, NIGHT_WORDS);
  assert.equal(withClass(root, 'rp-night').length, 0);
  const minutes = repairMinutes(s, sword, CONFIG);
  const btn = findAll(root, (el) => el.attributes['data-repair'] === String(sword.id))[0];
  assert.ok(btn, 'a Repair button for the worn sword');
  assert.equal(btn.disabled, undefined, 'it can be done now');
  assert.match(textOf(btn), /^Repair \+40%$/);
  assert.ok(text.includes(`${minutes}m`), 'the repair time with the repair skills');
  assert.match(all, /Repairing takes [\d.]+m; your repair skills cut it to [\d.]+m/);
  // Scrap: the tip says what comes back
  const back = scrapReturn(sword, CONFIG);
  const qtyStr = String(back.qty);
  const scrapBtn = withClass(root, 'ws-scrap')[0];
  assert.match(scrapBtn.attributes.title, new RegExp(`You get back ${qtyStr.length === 3 ? qtyStr + '0' : qtyStr} Copper D bars \\(${CONFIG.gear.repair.materialFraction}% of its ${CONFIG.gear.slots.sword.bars} bars × 60% durability\\)\\. The gem is lost\\.`));
  assert.equal(scrapBtn.attributes['data-tip'], scrapBtn.attributes.title);
  assert.match(text, /You can repair at camp during the day, only gear the adventurer does not have today/);
});

test('a Copper sword at 60% scrapped from the Workshop returns 0.42 bars (confirm text and the click through ctx.act)', () => {
  const s = stateDay1();
  addGear(s, 'sword', 'copper', 'D', null, { durability: 60 });
  // the A4 example, pinned: a 2-bar sword, 35% of its bars, 60% durability
  const cfg = cfgWith({ gear: { slots: { sword: { bars: 2 } }, repair: { materialFraction: 35 } } });
  const ctx = makeCtx(s, cfg);
  const confirms = [];
  globalThis.confirm = (m) => {
    confirms.push(m);
    return true;
  };
  try {
    const root = render(renderWorkshop, s, cfg, ctx);
    const scrapBtn = withClass(root, 'ws-scrap')[0];
    assert.equal(scrapBtn.disabled, undefined);
    scrapBtn.listeners.click[0]();
  } finally {
    delete globalThis.confirm;
  }
  assert.equal(confirms.length, 1);
  assert.match(confirms[0], /^Scrap D Copper Sword\? You get back 0\.42 Copper D bars \(35% of its 2 bars × 60% durability\)\./);
  assert.equal(s.storage.bars['copper:D'], 0.42);
  assert.deepEqual(s.gear, []);
});

test('the Workshop smith panel shows the skilled smithing time with its reduction in the hover', () => {
  const s = stateDay1();
  s.storage.bars['copper:D'] = 5;
  setSkillLevel(s, 'smith_copper', 5);
  const root = render(renderWorkshop, s);
  const m = smithMinutes(s, 'sword', 'copper', false, CONFIG);
  assert.ok(m < CONFIG.gear.slots.sword.bars * CONFIG.gear.smithMinPerBar, 'the skill really makes it faster');
  assert.match(textOf(root), new RegExp(`Craft \\(${m}m\\)`));
  const base = CONFIG.gear.slots.sword.bars * CONFIG.gear.smithMinPerBar;
  assert.ok(tipsOf(root).includes(`${CONFIG.gear.slots.sword.bars} bars × ${CONFIG.gear.smithMinPerBar}m = ${base}m before your Copper smithing skill.`), 'the hover shows the time before the skill');
});

test('the map explains the Carrying skill: the load penalty per item shrinks and the base is mentioned', () => {
  const s = stateDay1();
  setSkillLevel(s, 'carrying', 4);
  const text = textOf(render(renderMap, s));
  assert.match(text, new RegExp(`${CONFIG.map.travelMinPerStep}m per step, \\+[\\d.]+% per item carried \\(${CONFIG.map.loadPenaltyPerItem}% before the Carrying skill\\)`));
  assert.doesNotMatch(text, /way home \(skill\)|Return travel/i);
});

// ------------------------------------------- enemies, durability, margin (batch 3) ----
const ALL_SCREENS = (s) => (s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : s.phase === 'report' ? renderReport : renderRunSummary]]);

test('enemy growth is never shown: no "Rating growth" row, no "Ratings x1.05" stat, no growth table or formula anywhere (R8)', () => {
  const plan = statePlan(1);
  const states = [['day 1', stateDay1()], ['plan', plan], ['report', stateReport()], ['over', stateOver()]];
  for (const [label, s] of states) {
    for (const [name, fn] of ALL_SCREENS(s)) {
      const text = readable(render(fn, s));
      assert.doesNotMatch(text, /rating growth|ratings x\d|growth by day|daily growth|\+\d+(\.\d+)?% x \(day/i, `${name} (${label})`);
    }
  }
  // the roster still exists, and Help only says the plain thing
  assert.match(textOf(render(renderPlan, plan)), /Base HP/);
  assert.match(textOf(render(renderHelp, plan)), /Enemies get a little stronger every day\./);
});

test('a Low special reads "none", and Accurate / Evasion show the value on the fight day', () => {
  const s = statePlan(0);
  for (const e of s.roster.enemies) for (const k of Object.keys(e.sight)) e.sight[k] = 0; // every attribute visible
  // a late fight day, so that the day's rating growth moves the rounded values (a small growth per day does not on day 2)
  s.roster.day = 40;
  for (const e of s.roster.enemies) e.day = 40;
  const day = s.roster.day;
  const A = CONFIG.enemies.attributes;
  const text = textOf(render(renderPlan, s));
  assert.match(text, /Low · none/, 'a Low special is none');
  assert.doesNotMatch(text, /Low · 0%/);
  // fight-day ratings: the base value x the day's growth, rounded; never the growth itself. The rating chips
  // (Accurate / Evasion) are the only ones with a plain number and no "%".
  const fightDay = (lv) => Math.round(A.accurate.values[lv] * growth(day).ratings);
  const root = render(renderPlan, s);
  const chips = withClass(root, 'adv-lv').map(textOf).filter((t) => /^(Low|Normal|High) · \d+$/.test(t));
  const enemies = s.roster.enemies.length;
  assert.equal(chips.length, enemies * 2, 'Accurate and Evasion for every enemy, all visible');
  for (const t of chips) {
    const [level, value] = t.split(' · ');
    assert.equal(Number(value), fightDay(level.toLowerCase()), t);
  }
  assert.ok(day > 1 && growth(day).ratings > 1);
  assert.ok(chips.some((t) => Number(t.split(' · ')[1]) !== A.accurate.values[t.split(' · ')[0].toLowerCase()]), 'the fight-day value differs from the base value');
  // the helper itself
  for (const k of ['piercing', 'pierceRes', 'magical', 'magicRes', 'stunning', 'stunRes', 'chilling', 'slowRes']) assert.equal(attrValueText(k, 'low', CONFIG), 'none', k);
  assert.equal(attrValueText('magical', 'high', CONFIG), `${A.magical.values.high}%`);
  assert.equal(attrValueText('fast', 'high', CONFIG), `+${A.fast.values.high}%`);
  assert.equal(attrValueText('fast', 'low', CONFIG), `${A.fast.values.low}%`);
  assert.equal(attrValueText('accurate', 'normal', CONFIG), String(A.accurate.values.normal), 'without a day: the base value');
  assert.equal(attrValueText('accurate', 'high', CONFIG, 30), String(Math.round(A.accurate.values.high * growth(30).ratings)));
  assert.equal(attrValueText('evasion', 'low', CONFIG, 12), String(Math.round(A.evasion.values.low * growth(12).ratings)));
  // the Adventurer tab roster and the battle report's enemy card use the same wording
  assert.match(textOf(render(renderAdventurer, (() => { const t = stateDay1(); t.intel.spent.enemySight = 1000; return t; })())), /Low · none/);
  assert.match(textOf(render(renderReport, stateReport())), /Low · none/);
});

test('durability is shown as a whole number on every screen (never a decimal followed by %)', () => {
  const addWorn = (s) => {
    addGear(s, 'sword', 'iron', 'B', null, { durability: 63.4 });
    addGear(s, 'sword', 'copper', 'D', null, { durability: 99.6 });
    addGear(s, 'chest', 'iron', 'C', { type: 'ruby', grade: 'B' }, { durability: 12.7 });
    addGear(s, 'helmet', 'copper', 'D', null, { durability: 0.4 });
    return s;
  };
  const whole = /^\d+%$/;
  // Workshop gear table + Adventurer tab gear table
  for (const [label, fn] of [['Workshop', renderWorkshop], ['Adventurer tab', renderAdventurer]]) {
    const root = render(fn, addWorn(stateDay1()));
    const cells = withClass(root, 'gl-pct'); // the shared gear list: the number beside each durability bar
    assert.equal(cells.length, 4, `${label}: one durability number per item`);
    const shown = cells.map((c) => textOf(c));
    assert.deepEqual(shown.sort(), ['1%', '12%', '63%', '99%'], label);
    for (const t of shown) assert.match(t, whole);
    assert.doesNotMatch(readable(root), /\d\.\d+%\s*(durability|left)/i, label);
  }
  // Workshop repair buttons: the gain is 100 minus the shown durability
  const wk = render(renderWorkshop, addWorn(stateDay1()));
  const gains = findAll(wk, (el) => el.attributes['data-repair'] !== undefined).map(textOf).sort();
  assert.deepEqual(gains, ['Repair +1%', 'Repair +37%', 'Repair +88%', 'Repair +99%'].sort());
  // plan screen (pack gear step): durability bars and the could-be-destroyed list
  const plan = addWorn(statePlan(0));
  const planRoot = render(renderPlan, plan);
  const planDur = withClass(planRoot, 'adv-dur').map((c) => textOf(c).replace(/[⚠✓]/g, '')); // the icon sits at the end of the cell
  assert.ok(planDur.length >= 4);
  for (const t of planDur) assert.match(t, whole);
  assert.doesNotMatch(readable(planRoot), /\d\.\d+%\s*(durability|left)|\(\d+\.\d+%\)/i);
  // today's packed gear on the Adventurer tab while the adventurer is away
  const away = stateDay1();
  const sw = addGear(away, 'sword', 'iron', 'B', null, { durability: 63.4 });
  assert.equal(endDay(away).ok, true);
  assert.equal(confirmPlan(away, { enemyIndex: 0, gearIds: [sw.id], ringIds: [] }).ok, true);
  assert.match(textOf(render(renderAdventurer, away)), /\(63%\)/);
  assert.doesNotMatch(textOf(render(renderAdventurer, away)), /63\.4/);
});

test('the battle report shows wear and what is left as whole numbers', () => {
  const s = game(7, WIN);
  const sw = addGear(s, 'sword', 'mythril', 'S', null, { durability: 80.3 });
  assert.equal(endDay(s, WIN).ok, true);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [sw.id], ringIds: [] }, WIN).ok, true);
  const rep = endDay(s, WIN).report;
  const w = rep.wear[0];
  const root = render(renderReport, s);
  const cells = findAll(root, (el) => el.tagName === 'TD' && /left$|Destroyed$/.test(textOf(el)));
  assert.equal(cells.length, 1);
  assert.equal(textOf(cells[0]), `${durText(w.left)} left`);
  assert.match(textOf(cells[0]), /^\d+% left$/);
  const loss = findAll(root, (el) => el.tagName === 'TD' && /^-\d+(\.\d+)?%$/.test(textOf(el)));
  assert.equal(textOf(loss[0]), `-${Math.round(w.loss)}%`);
  assert.doesNotMatch(textOf(loss[0]), /\./);
});

test('wear ranges in the gear notes are whole numbers (low end rounded down, high end up)', () => {
  const s = statePlan(0);
  const dl = CONFIG.gear.durabilityLoss;
  const mults = Object.values(dl.tierMult);
  const lo = wearLoss(dl.min, Math.min(...mults), 0);
  const hi = wearLoss(dl.max, Math.max(...mults), 0);
  const t = wearText(s, CONFIG);
  assert.equal(t.split(' (')[0], `${Math.floor(lo + 1e-9)}-${Math.ceil(hi - 1e-9)}% per fight`);
  // against one tier, with the average
  const eliteMult = dl.tierMult.elite;
  const elite = wearText(s, CONFIG, 'elite');
  assert.equal(elite.split(' (')[0], `${Math.floor(wearLoss(dl.min, eliteMult, 0) + 1e-9)}-${Math.ceil(wearLoss(dl.max, eliteMult, 0) - 1e-9)}% per fight`);
  assert.match(elite, /\(avg \d+%/);
  assert.doesNotMatch(elite, /avg \d+\.\d/);
  // the plan screen and the Adventurer tab say the same thing
  assert.ok(textOf(render(renderPlan, s)).includes(wearText(s, CONFIG)));
  assert.ok(textOf(render(renderAdventurer, s)).includes(wearText(s, CONFIG)));
});

test('the estimate panel talks about the test fights\' own noise (the ±), not "9 times in 10", and Foresight counts only the best ring', () => {
  const s = statePlan(0);
  addRing(s, 'foresight', 'D', false);
  const plan = render(renderPlan, s);
  const text = readable(plan);
  assert.match(text, /test fights alone could be off/);
  assert.match(text, /hidden attributes can make the real chance higher or lower/);
  assert.doesNotMatch(text, /9 times in 10/);
  assert.match(text, /only your best one counts/);
  const help = readable(render(renderHelp, s));
  assert.match(help, /Only your best Foresight ring counts/);
  assert.doesNotMatch(help, /9 times in 10/);
  assert.match(help, /Both attack bars start the fight partly filled/);
  assert.match(help, /Low means the enemy does not have that ability at all/);
  // the Rings tab
  const worn = game(7);
  addRing(worn, 'foresight', 'S', true);
  addRing(worn, 'foresight', 'D', true);
  const rings = textOf(render(renderRings, worn));
  assert.match(rings, /only your best Foresight ring counts/);
});

test('winText is the whole-percent text used by the estimates', () => {
  assert.equal(winText(61.6), '62%');
  assert.equal(winText(0), '0%');
  assert.equal(winText(100), '100%');
  assert.equal(repairGainShown(99.6), 1);
  assert.equal(durText(99.6), '99%');
});

test('the day clock still starts at the configured time (sanity for the shared test states)', () => {
  assert.equal(stateDay1().time, DAY_START);
});

// ------------------------------------------------------------ batch 4 ----
const ids = (items) => items.map((g) => g.id);
const clickOf = (el) => (el.listeners.click || [])[0];
const buttonById = (root, id) => findAll(root, (el) => el.tagName === 'BUTTON' && el.attributes.id === id)[0];
const isDisabled = (el) => el.hasAttribute('disabled');

// Make every attribute of a roster enemy visible and set the levels named in `levels` (the rest Normal).
function reveal(enemy, levels = {}) {
  for (const k of Object.keys(enemy.sight)) enemy.sight[k] = 0;
  enemy.levels = { ...Object.fromEntries(Object.keys(enemy.levels).map((k) => [k, 'normal'])), ...levels };
}

// The plan screen with an enemy already chosen (the selection lives in ctx.ui.plan).
function chosenPlanCtx(s, enemyIndex, gearIds, cfg = CONFIG) {
  const ctx = makeCtx(s, cfg);
  ctx.ui.plan = { rosterDay: s.roster.day, seed: s.seed, enemyIndex, gearIds: [...gearIds], ringIds: [], wornKey: '', fresh: false };
  return ctx;
}

test('the plan screen has a Banner row, a banners line, a plain Defense section row and no Estimate all anywhere', () => {
  const s = statePlan(0);
  const root = render(renderPlan, s);
  const text = readable(root);
  assert.match(textOf(root), /Banner/);
  assert.match(textOf(root), new RegExp(bannersLine(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')), 'the banners line under the roster');
  assert.ok(text.includes(bannersText(CONFIG)), 'the hover tells the story of the banners');
  assert.doesNotMatch(text, /Estimate all/i);
  // Defense is a section row (a single row header, then one cell spanning the columns), not a row of enemy names
  const rows = findAll(root, (el) => el.tagName === 'TR' && el.classList.contains('rt-sect'));
  assert.deepEqual(rows.map((r) => textOf(r.children[0])), ['Offense', 'Defense']);
  for (const r of rows) assert.equal(r.children.length, 2, 'a label and one cell spanning the columns');
  const defense = rows[1];
  for (const e of s.roster.enemies) assert.ok(!textOf(defense).includes(e.name), `no ${e.name} in the Defense row`);
  assert.equal(findAll(root, (el) => el.classList.contains('rt-sect-names')).length, 0);
  // no screen of any phase says Estimate all
  for (const state of [stateDay1(), statePlan(1), stateReport(), stateOver()]) {
    const screens = state.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', state.phase === 'plan' ? renderPlan : state.phase === 'report' ? renderReport : renderRunSummary]];
    for (const [name, fn] of screens) assert.doesNotMatch(readable(render(fn, state)), /Estimate all/i, name);
  }
});

test('an unspent intel point: the plan says to spend it (visible text), the Intel panel is highlighted and Confirm is disabled', () => {
  const s = statePlan(1);
  const root = render(renderPlan, s);
  assert.match(textOf(root), /Spend your intel point/);
  assert.match(textOf(root), new RegExp(`You have 1 intel point: spend it before you start day ${s.roster.day}\\.`));
  assert.ok(withClass(root, 'adv-intel-hl').length === 1, 'highlighted panel');
  const confirm = buttonById(root, 'adv-confirm');
  assert.ok(isDisabled(confirm), 'Confirm is disabled');
  assert.equal(canSpendIntel(s), true);
  // with no point the panel is one line of the current values and Confirm is enabled
  const quiet = render(renderPlan, statePlan(0));
  assert.doesNotMatch(textOf(quiet), /Spend your intel point/);
  assert.equal(withClass(quiet, 'adv-intel-hl').length, 0);
  assert.ok(!isDisabled(buttonById(quiet, 'adv-confirm')));
  for (const t of Object.values(CONFIG.intel.tracks)) assert.ok(textOf(quiet).includes(`${t.name} `), t.name);
  // every track maxed: a point cannot be spent, so nothing is blocked
  const maxed = statePlan(2);
  for (const k of Object.keys(CONFIG.intel.tracks)) maxed.intel.spent[k] = 1000;
  const m = render(renderPlan, maxed);
  assert.ok(!isDisabled(buttonById(m, 'adv-confirm')));
  assert.doesNotMatch(textOf(m), /Spend your intel point/);
  // Spend buttons spend through the core, then the gate opens
  const ctx = makeCtx(statePlan(1));
  const live = render(renderPlan, ctx.state, CONFIG, ctx);
  const spend = findAll(live, (el) => el.attributes['data-intel'] === 'enemySight')[0];
  clickOf(spend)();
  assert.equal(ctx.state.intel.points, 0);
  assert.ok(!isDisabled(buttonById(render(renderPlan, ctx.state, CONFIG, ctx), 'adv-confirm')));
  // the hover of a track names the tier / grade multipliers
  const tipText = tipsOf(render(renderPlan, statePlan(1)));
  for (const [tier, v] of Object.entries(CONFIG.intel.tracks.enemySight.tierMult)) if (v !== 100) assert.ok(tipText.includes(`${tier}s ${v}%`.replace(/^./, (c) => c.toUpperCase())) || tipText.toLowerCase().includes(`${tier}s ${v}%`), tier);
  assert.match(tipText, /Better ring grades are harder to see/);
});

test('the Skills & Intel tab tells you to spend points before the next day and keeps the six track rows', () => {
  const text = readable(render(renderSkills, statePlan(1)));
  assert.match(text, /Spend points before you start the next day/);
  for (const t of Object.values(CONFIG.intel.tracks)) assert.ok(text.includes(t.name), t.name);
});

test('with estimates on, the Win estimate row shows "…" while it is worked out and a % with its ± afterwards', async () => {
  const s = statePlan(0);
  const ctx = makeCtx(s);
  ctx.ui = {}; // estimates on
  const first = render(renderPlan, s, CONFIG, ctx);
  const row = (root) => findAll(root, (el) => el.tagName === 'TR' && el.classList.contains('rt-est'))[0];
  assert.match(textOf(row(first)), /Win estimate…+/);
  assert.match(textOf(first), /Estimating \d+ of \d+…/, 'the bottom status');
  await whenEstimatesDone(ctx);
  const later = render(renderPlan, s, CONFIG, ctx);
  const cells = findAll(row(later), (el) => el.tagName === 'TD');
  assert.equal(cells.length, s.roster.enemies.length);
  for (const c of cells) assert.match(textOf(c), /^\d+%(± \d+|\(−\d+\)|\(\+\d+\))$/);
  assert.doesNotMatch(textOf(later), /Estimating \d+ of/);
  assert.match(tipsOf(row(later)), /test fights \(could be \d+-\d+%; hidden attributes add more\)/);
  // the Adventurer tab shows the same numbers (same selection: the default pack and the worn rings)
  const adv = render(renderAdventurer, s, CONFIG, ctx);
  assert.match(textOf(row(adv)), /^Win estimate\d+%/);
});

// The hover text of one gear row's icon on the plan screen with enemy `idx` chosen and `items` packed.
function flagText(s, idx, items) {
  const root = render(renderPlan, s, CONFIG, chosenPlanCtx(s, idx, ids(items)));
  return findAll(root, (el) => el.attributes['data-flag'] !== undefined).map((el) => el.attributes.title || '').join('\n');
}

test('the gear step: "Sword 1/2 packed" per type, pack mules raise the limit, one icon per item (⚠ could break, ✓ answers a High special)', () => {
  const s = game(7);
  const sword = addGear(s, 'sword', 'iron', 'C');
  const ruby = addGear(s, 'chest', 'iron', 'C', { type: 'ruby', grade: 'B' });
  const worn = addGear(s, 'helmet', 'copper', 'D', null, { durability: 3 });
  const plain = addGear(s, 'boots', 'copper', 'D');
  assert.equal(endDay(s).ok, true);
  reveal(s.roster.enemies[2], { magical: 'high', stunning: 'high' });
  assert.match(flagText(s, 2, [worn]), /If left home: it cannot be repaired yet\. Need [\d.]+ copper bars of grade D or higher\./, 'no bars in stock: why it cannot be repaired');
  s.storage.bars['copper:D'] = 5;
  const ctx = chosenPlanCtx(s, 2, ids([sword, ruby, worn]));
  const root = render(renderPlan, s, CONFIG, ctx);
  const text = textOf(root);
  const per = CONFIG.plan.perSlot;
  assert.ok(text.includes(`Sword 1/${per} packed`) && text.includes(`Chest 1/${per} packed`) && text.includes(`Boots 0/${per} packed`), 'a header per gear type');
  assert.ok(text.includes(`Pack up to ${per} per gear type.`));
  const byGear = findAll(root, (el) => el.tagName === 'TR' && el.children[0] && el.children[0].children[0] && el.children[0].children[0].attributes && el.children[0].children[0].attributes['data-gear'] !== undefined);
  const flagOf = (g) => findAll(byGear.find((r) => r.children[0].children[0].attributes['data-gear'] === String(g.id)), (el) => el.attributes['data-flag'])[0];
  assert.equal(flagOf(ruby).attributes['data-flag'], 'ok', 'the ruby chest answers the visible High Magical');
  assert.equal(textOf(flagOf(ruby)), '✓');
  assert.match(flagOf(ruby).attributes.title, /Answers High Magical\./);
  assert.equal(flagOf(worn).attributes['data-flag'], 'warn', 'a 3% helmet could break');
  assert.equal(textOf(flagOf(worn)), '⚠');
  assert.match(flagOf(worn).attributes.title, new RegExp(`Could break: against ${s.roster.enemies[2].name} it can lose up to \\d+% \\(it has 3%\\)\\. At 0% it is destroyed after the fight; it always lasts the whole fight\\.`));
  assert.match(flagOf(worn).attributes.title, /If left home: repair ~(\d+h )?[\d.]+m?, [\d.]+ Copper D bars\./);
  assert.equal(flagOf(sword).attributes['data-flag'], 'none', 'a sound sword with no gem has no icon');
  assert.equal(flagOf(plain).attributes['data-flag'], 'none');
  // a pack mule for swords: limit 3, and the header says why
  s.groups.extra.sword = 1;
  const t = textOf(render(renderPlan, s, CONFIG, chosenPlanCtx(s, 2, ids([sword, ruby, worn]))));
  assert.ok(t.includes(`Sword 1/${per + 1} packed`));
  assert.ok(t.includes(`(${per + 1} swords: pack mule)`), 'the one-line explanation names the pack mule');
  assert.ok(t.includes(`Chest 1/${per} packed`));
  // a sword whose gem is blunted by a visible High resistance gets the warning icon
  const s2 = game(7);
  const topaz = addGear(s2, 'sword', 'iron', 'C', { type: 'topaz', grade: 'C' });
  endDay(s2);
  reveal(s2.roster.enemies[0], { stunRes: 'high' });
  const r2 = render(renderPlan, s2, CONFIG, chosenPlanCtx(s2, 0, [topaz.id]));
  const f2 = findAll(r2, (el) => el.attributes['data-flag'] === 'warn');
  assert.equal(f2.length, 1);
  assert.match(f2[0].attributes.title, /Blunted by High Stun resistance\./);
});

test('the gear step table has three columns: the icon sits at the end of the durability cell, so it fits a phone', () => {
  const s = game(7);
  const sword = addGear(s, 'sword', 'iron', 'C', { type: 'topaz', grade: 'C' });
  const worn = addGear(s, 'helmet', 'copper', 'D', null, { durability: 3 });
  const plain = addGear(s, 'boots', 'copper', 'D');
  assert.equal(endDay(s).ok, true);
  reveal(s.roster.enemies[0], { stunRes: 'high' });
  const root = render(renderPlan, s, CONFIG, chosenPlanCtx(s, 0, ids([sword, worn, plain])));
  const table = findAll(root, (el) => el.tagName === 'TABLE' && el.classList.contains('adv-geartable'))[0];
  assert.ok(table, 'the gear table');
  assert.deepEqual(findAll(table, (el) => el.tagName === 'TH').map(textOf), ['Pack', 'Item and stats', 'Durability']);
  const itemRows = findAll(table, (el) => el.tagName === 'TR' && el.children[0] && findAll(el.children[0], (c) => c.attributes['data-gear'] !== undefined).length === 1);
  assert.equal(itemRows.length, 3);
  for (const r of itemRows) {
    assert.equal(r.children.length, 3, 'pack box, item, durability');
    assert.equal(withClass(r.children[2], 'adv-flag').length, 1, 'the icon slot is inside the durability cell');
  }
  assert.equal(findAll(root, (el) => el.classList.contains('adv-flagcell')).length, 0, 'no column of its own');
  // the section rows span all three columns
  for (const r of findAll(table, (el) => el.tagName === 'TR' && el.classList.contains('adv-slotrow'))) assert.equal(String(r.children[0].attributes.colspan), '3');
  // the icon is still found by its data-flag, with the same hover
  const flags = findAll(root, (el) => el.attributes['data-flag'] !== undefined).map((el) => el.attributes['data-flag']).sort();
  assert.deepEqual(flags, ['none', 'warn', 'warn'], 'the 3% helmet could break; the topaz sword is blunted by the High stun resistance');
});

test('the gear step legend says what the warning icon marks: could break, or a sword gem blunted by a visible High resistance', () => {
  const s = game(7);
  const sword = addGear(s, 'sword', 'iron', 'C', { type: 'topaz', grade: 'C' });
  assert.equal(endDay(s).ok, true);
  reveal(s.roster.enemies[0], { stunRes: 'high' });
  const root = render(renderPlan, s, CONFIG, chosenPlanCtx(s, 0, ids([sword])));
  const icon = findAll(root, (el) => el.attributes['data-flag'] === 'warn');
  assert.equal(icon.length, 1, 'a sound 100% sword shows the warning icon because of its blunted gem');
  assert.match(icon[0].attributes.title, /Blunted by High Stun resistance\./);
  assert.doesNotMatch(icon[0].attributes.title, /Could break/);
  const text = textOf(root);
  assert.match(text, /could break against .*, or a sword gem blunted by a High resistance you can see/, 'the legend names both reasons');
});

test('the plan intro states the pack limit the way the gear step does: with a pack mule it is no longer "2 items per gear type"', () => {
  const s = game(7);
  addGear(s, 'sword');
  assert.equal(endDay(s).ok, true);
  const per = CONFIG.plan.perSlot;
  const before = textOf(render(renderPlan, s));
  assert.ok(before.includes(`You can pack up to ${per} per gear type.`), 'no pack mule: the plain limit');
  s.groups.extra.sword = 1;
  const after = textOf(render(renderPlan, s));
  const mule = `(${per + 1} swords: pack mule)`;
  assert.equal(after.split(mule).length - 1, 2, 'the intro and the gear step both name the pack mule');
  assert.ok(!after.includes(`up to ${per} items per gear type`));
});

test('the Win estimate row hover names the gear of its own screen: "below this table" only on the plan screen', () => {
  const s = statePlan(0);
  const head = (root) => findAll(findAll(root, (el) => el.tagName === 'TR' && el.classList.contains('rt-est'))[0], (el) => el.tagName === 'TH')[0].attributes.title;
  const plan = head(render(renderPlan, s));
  assert.match(plan, /gear and rings you have chosen below this table/);
  const adv = head(render(renderAdventurer, s));
  assert.doesNotMatch(adv, /below this table|shown below/, 'on the Adventurer tab the gear is above the roster');
  assert.match(adv, /your best gear \(the best item of each gear type\) and the rings the adventurer wears/);
});

test('the sticky confirm bar says the unspent-point sentence once, not twice', () => {
  const s = statePlan(1);
  const bar = withClass(render(renderPlan, s), 'adv-bar')[0];
  const t = textOf(bar);
  const sentence = `You have 1 intel point: spend it before you start day ${s.roster.day}.`;
  assert.equal(t.split(sentence).length - 1, 1, t);
  assert.doesNotMatch(t, /Spend your intel point first/);
  assert.ok(isDisabled(buttonById(bar, 'adv-confirm')), 'Confirm stays disabled');
});

test('restoreScrollLeft: the scroll event that follows a restored position is the screen\'s, not the player\'s', () => {
  // a scroll box that clamps like a real one
  const box = (max) => {
    let x = 0;
    return { get scrollLeft() { return x; }, set scrollLeft(v) { x = Math.max(0, Math.min(max, v)); } };
  };
  const el = box(100);
  restoreScrollLeft(el, 8);
  assert.equal(el.scrollLeft, 8);
  assert.equal(isRestoredScroll(el), true, 'the scroll event our own scrollLeft fires');
  assert.equal(isRestoredScroll(el), false, 'only once');
  el.scrollLeft = 20; // the player scrolls
  assert.equal(isRestoredScroll(el), false);
  // nothing moved: nothing is marked (0 = nothing to restore, or nothing to scroll)
  const flat = box(0);
  restoreScrollLeft(flat, 8);
  assert.equal(isRestoredScroll(flat), false);
  restoreScrollLeft(el, 0);
  restoreScrollLeft(el, 20); // already there
  assert.equal(isRestoredScroll(el), false);
  // the player scrolls on before the restore's event is handled: that position is theirs
  const busy = box(100);
  restoreScrollLeft(busy, 8);
  busy.scrollLeft = 30;
  assert.equal(isRestoredScroll(busy), false);
  assert.equal(isRestoredScroll({ scrollLeft: 0 }), false, 'a box that was never restored');
});

test('"Your answers": the High specials you can see, answered or not by the packed armor', () => {
  const s = game(7);
  const ruby = addGear(s, 'chest', 'iron', 'C', { type: 'ruby', grade: 'B' });
  const sword = addGear(s, 'sword', 'iron', 'C');
  endDay(s);
  reveal(s.roster.enemies[1], { magical: 'high', stunning: 'high' });
  const root = render(renderPlan, s, CONFIG, chosenPlanCtx(s, 1, ids([ruby, sword])));
  const row = findAll(root, (el) => el.tagName === 'TR' && el.classList.contains('adv-answers'))[0];
  assert.ok(row, 'a row in the matchup table');
  const t = textOf(row);
  assert.match(t, /^Your answers/);
  assert.ok(t.includes(`✓ ${CONFIG.enemies.attributes.magical.name} (ruby chest)`), t);
  assert.ok(t.includes(`✗ ${CONFIG.enemies.attributes.stunning.name} (no topaz armor packed)`), t);
  // nothing visible: a plain sentence
  const s2 = game(7);
  addGear(s2, 'sword');
  endDay(s2);
  const r2 = render(renderPlan, s2, CONFIG, chosenPlanCtx(s2, 0, []));
  const row2 = findAll(r2, (el) => el.classList.contains('adv-answers'))[0];
  assert.match(textOf(row2), /No High special to answer that you can see/);
});

test('banner chips: the colour when scouted, "?" with the odds text when not; the report always shows it', () => {
  const s = statePlan(0);
  const [seen, hidden] = s.roster.enemies;
  seen.group = 'black';
  seen.groupRoll = 0;
  hidden.group = 'gold';
  hidden.groupRoll = 99.9;
  const root = render(renderPlan, s);
  const chips = findAll(root, (el) => el.classList.contains('bn'));
  const chip = chips.find((c) => c.classList.contains('bn-black'));
  assert.ok(chip, 'a black chip');
  assert.equal(textOf(chip), bannerLabel('black'));
  const unknown = chips.find((c) => c.classList.contains('bn-unknown'));
  assert.equal(textOf(unknown), '?');
  const names = Object.keys(CONFIG.groups.list).map((k) => bannerLabel(k));
  assert.equal(unknown.attributes.title, `Banner unknown: ${names.slice(0, -1).join(', ')} or ${names[names.length - 1]} (equally likely). Banner scouting: ${CONFIG.intel.tracks.groupSight.base}%.`);
  assert.ok(!chips.some((c) => c.classList.contains('bn-gold')), 'the hidden banner is not revealed');
  // the report shows the banner whatever the scouting was
  const rs = stateReport();
  assert.match(textOf(render(renderReport, rs)), new RegExp(`Banner: ${bannerLabel(rs.report.enemy.group)}`));
  // and after the win the pack mule text when one was earned
  const g = game(9, WIN);
  endDay(g, WIN);
  for (let n = 0; n < CONFIG.groups.defeatsPerReward; n++) {
    spendAll(g, WIN);
    g.roster.enemies[0].group = 'red';
    assert.equal(confirmPlan(g, { enemyIndex: 0, gearIds: [], ringIds: [] }, WIN).ok, true);
    endDay(g, WIN);
    if (g.phase === 'report' && n < CONFIG.groups.defeatsPerReward - 1) acknowledgeReport(g);
  }
  assert.ok(g.report.groupReward);
  const rtext = textOf(render(renderReport, g, WIN));
  assert.ok(rtext.includes(groupRewardText(g.report, WIN)), 'the pack mule line');
  assert.match(rtext, /capture a pack mule: from now on the adventurer can pack \d+ /);
});

function spendAll(s, cfg) {
  for (const k of Object.keys(cfg.intel.tracks)) while (canSpendIntel(s, cfg)) { s.intel.spent[k] = (s.intel.spent[k] || 0) + 1; s.intel.points -= 1; }
}

test('a hidden ring grade says the odds of each grade given that it is hidden', () => {
  const s = statePlan(0);
  const e = s.roster.enemies.find((x) => x.tier === 'champion');
  e.ringGradeRoll = 99.9; // hidden whatever the scouting
  e.ringTypeRoll = 99.9;
  const root = render(renderPlan, s);
  const odds = Object.entries(hiddenGradeOdds(s, e)).map(([g, v]) => `${g} ${Math.round(v)}%`).join(', ');
  assert.ok(readable(root).includes(`Grade hidden. Given that it is hidden: ${odds} (better grades are harder to scout).`), odds);
});

test('the Adventurer tab: a banners line, the Banner row, the estimate row and today\'s planned estimate', () => {
  const s = stateDay1();
  const root = render(renderAdventurer, s);
  assert.ok(textOf(root).includes(bannersLine(s)));
  assert.match(textOf(root), /Banner/);
  assert.match(textOf(root), /worked out by itself with your best gear/);
  assert.match(textOf(root), /Win estimate/);
  assert.doesNotMatch(readable(root), /Estimate all|plan screen at the end of the day/);
  // with a fight planned: "Your plan showed 72% ± 14."
  const t = game(7, WIN);
  endDay(t, WIN);
  const plan = { enemyIndex: 0, gearIds: [], ringIds: [], shownEstimate: { winPct: 72, margin: 14 } };
  assert.equal(confirmPlan(t, plan, WIN).ok, true);
  assert.match(textOf(render(renderAdventurer, t, WIN)), /Your plan showed 72% ± 14\./);
  const u = game(7, WIN);
  endDay(u, WIN);
  assert.equal(confirmPlan(u, { enemyIndex: 0, gearIds: [], ringIds: [] }, WIN).ok, true);
  assert.match(textOf(render(renderAdventurer, u, WIN)), /Your plan had no finished win estimate\./);
  // the report keeps what the plan showed
  const rep = endDay(t, WIN).report;
  assert.deepEqual(rep.planEstimate, { winPct: 72, margin: 14 });
  assert.match(textOf(render(renderReport, t, WIN)), /Your plan showed 72% ± 14\./);
  // an item that could break against the toughest enemy has the warning icon on the Adventurer tab
  const w = stateDay1();
  addGear(w, 'sword', 'iron', 'C', null, { durability: 2 });
  assert.match(textOf(render(renderAdventurer, w)), /2%⚠/);
});

test('Confirm asks about packed items that could break and a win estimate that is not finished; it passes the shown estimate on', async () => {
  const asked = [];
  globalThis.confirm = (msg) => { asked.push(msg); return true; };
  try {
    const s = game(7, WIN);
    const worn = addGear(s, 'sword', 'iron', 'C', null, { durability: 2 });
    const boots = addGear(s, 'boots', 'copper', 'D', null, { durability: 1 });
    endDay(s, WIN);
    const ctx = chosenPlanCtx(s, 0, ids([worn, boots]), WIN);
    const root = render(renderPlan, s, WIN, ctx);
    const chosenName = s.roster.enemies[0].name; // read before the click: confirming starts the next day, which rolls a new roster
    clickOf(buttonById(root, 'adv-confirm'))();
    assert.equal(asked.length, 1);
    const names = [worn, boots].map((g) => `${g.grade} ${g.material[0].toUpperCase()}${g.material.slice(1)} ${g.slot[0].toUpperCase()}${g.slot.slice(1)}`);
    assert.match(asked[0], /2 packed items could break in this fight: /);
    for (const n of names) assert.ok(asked[0].includes(n), n);
    assert.ok(asked[0].includes(`The win estimate for ${chosenName} is not finished yet.`));
    assert.match(asked[0], /A lost fight ends the game\. Confirm anyway\?/);
    assert.equal(s.phase, 'work', 'the plan was confirmed after the yes');
    assert.equal(s.plan.shownEstimate, null, 'no finished estimate to pass on');
    // with a finished estimate and sound gear there is no question, and the estimate goes into the plan
    const t = game(7, WIN);
    const sword = addGear(t, 'sword', 'iron', 'C');
    endDay(t, WIN);
    const live = makeCtx(t, WIN);
    live.ui = {};
    live.ui.plan = { rosterDay: t.roster.day, seed: t.seed, enemyIndex: 0, gearIds: [sword.id], ringIds: [], wornKey: '', fresh: false };
    render(renderPlan, t, WIN, live);
    await whenEstimatesDone(live);
    asked.length = 0;
    const shown = render(renderPlan, t, WIN, live);
    clickOf(buttonById(shown, 'adv-confirm'))();
    assert.equal(asked.length, 0, 'nothing risky: no question');
    const planned = t.plan.shownEstimate;
    assert.ok(planned && Number.isFinite(planned.winPct) && Number.isFinite(planned.margin));
    assert.deepEqual(endDay(t, WIN).report.planEstimate, planned, 'the report keeps what the plan showed');
  } finally {
    delete globalThis.confirm;
  }
});

test('Help has a Banners section and the intel notes (multipliers, spend first), and no Estimate all', () => {
  const text = readable(render(renderHelp, stateDay1()));
  assert.ok(text.includes(bannersText(CONFIG)));
  assert.match(text, /must be spent before the next day can start/);
  assert.match(text, /Banner scouting/);
  assert.doesNotMatch(text, /Estimate all/i);
  assert.match(text, /worked out by itself/i);
});


// ----------------------------------------------- batch 5: score, workshop, report ----
const byId = (root, id) => findAll(root, (el) => el.attributes.id === id)[0];
const SCORE_NUMBERS = /\+\d+ ?pts|\d+ ?pts\b|\bscore\b/i;

test('no screen shows a score while the run is going: no "Score", no points per enemy tier (R32, U3)', () => {
  const plan = statePlan(0);
  const states = [['day 1', stateDay1()], ['in a field', stateInField()], ['plan', plan], ['report', stateReport()]];
  // an adventurer away fighting an enemy today
  const away = game(7);
  endDay(away);
  confirmPlan(away, { enemyIndex: 0, gearIds: [], ringIds: [] });
  states.push(['away', away]);
  // some wins, so a score exists to hide
  const rich = stateReport();
  rich.stats.score = 85;
  states.push(['with a score', rich]);
  for (const [label, s] of states) {
    const screens = s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : renderReport]];
    for (const [name, fn] of screens) {
      const text = readable(render(fn, s));
      if (name === 'help') assert.doesNotMatch(text, /\+\d+ ?pts|\d+ ?pts\b|score \d|\d+ points per/i, `help (${label}) has no score numbers`);
      else assert.doesNotMatch(text, SCORE_NUMBERS, `${name} (${label})`);
    }
  }
});

test('Help: no regrowth, no night, no novice or master tables, no level 10, no Estimate all, no growth numbers; the promised sentences are there', () => {
  for (const s of [stateDay1(), statePlan(1), stateReport(), stateOver()]) {
    const text = readable(render(renderHelp, s));
    assert.doesNotMatch(text, /regrow|night|novice|master table|level 10|lv 10|estimate all|growth|grow(s)? \d|\d+(\.\d+)?% (a|per) day/i, s.phase);
    assert.match(text, /keep a spare of each item so you can leave one home to repair it/);
    assert.match(text, /In a field your sight shows some of the items still in the ground; it grows with Ore sight intel and Ore sight rings/);
    assert.match(text, /Low means the enemy does not have that ability at all/);
    assert.match(text, /Both attack bars start the fight partly filled/);
    assert.match(text, /Enemies get a little stronger every day/);
    assert.match(text, /You see your score when the run ends \(End run or a lost fight\)/);
    assert.ok(text.includes(bannersText(CONFIG)));
    assert.match(text, /5 guesses of the hidden attributes|guesses of the hidden attributes/);
    assert.match(text, /Skill\s*Per level\s*XP/);
  }
  // every section of the plan is there, in order
  const sections = ['Time', 'World map & travel', 'Fields, searching & sight', 'Workshop', 'Gear, repairs & scrap', 'Enemies', 'Banners', 'Win estimate', 'Intel', 'Skills', 'Rings', 'Score'];
  const root = render(renderHelp, stateDay1());
  const titles = findAll(root, (el) => el.tagName === 'SUMMARY').map(textOf);
  let at = -1;
  for (const t of sections) {
    const i = titles.indexOf(t);
    assert.ok(i > at, `Help section "${t}" in order`);
    at = i;
  }
  // intel: current value and next gain per track, no schedule
  const intelText = textOf(root);
  assert.match(intelText, /Next point/);
});

test('Workshop: tiles instead of drop-downs, no upgrade luck / fail / time bonus text, no novice or master tables (R17-R19)', () => {
  const s = stateDay1();
  s.storage.bars['copper:D'] = 3;
  setSkillLevel(s, 'oreGrade_copper', 3);
  setSkillLevel(s, 'oreFail_copper', 3);
  setSkillLevel(s, 'gemGrade_ruby', 5);
  setSkillLevel(s, 'refineTime', 4);
  addRing(s, 'oreGrade', 'B', true);
  const root = render(renderWorkshop, s);
  assert.equal(countTags(root, 'select'), 0, 'no <select> anywhere');
  const all = readable(root);
  assert.doesNotMatch(all, /upgrade luck|−\d|-\d+(\.\d+)? ?fail|\d% time|novice|master|Grade skill lv|Cutting skill lv|level \d/i);
  assert.equal(findAll(root, (el) => el.attributes['data-slot'] && el.tagName === 'BUTTON').length, SLOTS.length, 'a tile per gear type');
  assert.equal(findAll(root, (el) => el.attributes['data-material'] && el.tagName === 'BUTTON').length, BARS.length, 'a tile per material');
  assert.equal(findAll(root, (el) => el.attributes['data-gem'] && el.tagName === 'BUTTON').length, GEMS.length + 1, 'None and one tile per gem');
  // refine / cut rows: columns Bar | Needs | Outcome chance | You can make | Time each | buttons
  const heads = findAll(root, (el) => el.tagName === 'TABLE' && el.classList.contains('ws-process'))[0];
  const heading = findAll(heads, (el) => el.tagName === 'TH').map((th) => textOf(th).replace(/\s+/g, ' '));
  assert.match(heading[0], /^Bar$/);
  assert.match(heading[1], /^Needs/);
  assert.match(heading[2], /^Outcome chance/);
  assert.match(heading[3], /^You can make/);
  assert.match(heading[4], /^Time each$/);
  // one bar and one row of numbers per row, for bars and gems alike (one "now" row per gem)
  for (const kind of ['ws-process']) {
    const tables = findAll(root, (el) => el.tagName === 'TABLE' && el.classList.contains(kind));
    assert.equal(tables.length, 2);
    for (const t of tables) for (const tr of findAll(t, (el) => el.tagName === 'TR' && findAll(el, (c) => c.tagName === 'TD').length)) {
      assert.equal(withClass(tr, 'ws-dist-bar').length, 1);
      assert.equal(withClass(tr, 'ws-dist-nums').length, 1);
    }
  }
  // hovers: your chances next to the base chances, base minutes only (every number comes from CONFIG)
  const hovers = tipsOf(root);
  const shown = (v) => String(Math.round(v * 10) / 10);
  const refineBase = CONFIG.refine[BARS[0]];
  assert.ok(hovers.includes(`Base chances: Fail ${shown(refineBase.dist.F)}%, D ${shown(refineBase.dist.D)}%`), 'the base chances of the first bar');
  assert.match(hovers, /Your chances: Fail [\d.]+%, D [\d.]+%.* Base chances: Fail/);
  // a gem shows only the CURRENT chances (R18): no first-time cutter / novice table in any hover
  assert.doesNotMatch(hovers, /first-time cutter|novice|master/i, 'no novice or master table for gems');
  assert.match(hovers, new RegExp(`Your chances: Fail [\\d.]+%, D [\\d.]+%, C [\\d.]+%, B [\\d.]+%, A [\\d.]+%, S [\\d.]+%\\. Your skills and rings make the difference \\(see Skills\\)\\.`), 'the gem hover: your chances, then the pointer to Skills');
  assert.match(hovers, /Your skills and rings make the difference \(see Skills\)\./);
  assert.ok(hovers.includes(`Base ${refineBase.minutes}m.`), 'the base minutes of the first bar');
});

test('the result box is green when everything worked and red when any attempt failed; the toast takes the same tone (R16)', () => {
  const run = (cfg, button) => {
    const s = stateDay1();
    s.storage.ore.copper = 6;
    const ctx = makeCtx(s, cfg);
    const root = render(renderWorkshop, s, cfg, ctx);
    const btn = findAll(root, (el) => el.attributes['data-run'] === button)[0];
    const res = clickOf(btn)();
    const after = render(renderWorkshop, s, cfg, ctx);
    return { res, box: withClass(after, 'ws-result')[0], ctx };
  };
  // the hand-written expectations below ("refined 5", 6 ore) assume one ore and 15 minutes per bar: pin them
  const copper = (dist) => cfgWith({ refine: { copper: { input: { copper: 1 }, minutes: 15, dist } } });
  const allOk = copper({ S: 0, A: 0, B: 0, C: 0, D: 100, F: 0 });
  const allFail = copper({ S: 0, A: 0, B: 0, C: 0, D: 0, F: 100 });
  const ok = run(allOk, 'refine:copper:5');
  assert.equal(ok.res.tone, 'ok');
  assert.ok(ok.box.classList.contains('ok') && !ok.box.classList.contains('err'));
  assert.match(textOf(ok.box), /Copper: refined 5 in .*: 5 bars \(D 5\)\./);
  const bad = run(allFail, 'refine:copper:5');
  assert.equal(bad.res.tone, 'err');
  assert.ok(bad.box.classList.contains('err'));
  assert.match(textOf(bad.box), /5 of 5 failed \(ore lost\)/);
  assert.equal(findAll(bad.box, (el) => el.tagName === 'B').map(textOf).join(), '5 of 5 failed', 'the count is bold');
  // a single attempt too
  assert.equal(run(allFail, 'refine:copper:1').box.classList.contains('err'), true);
  assert.equal(run(allOk, 'refine:copper:1').box.classList.contains('ok'), true);
  // a mixed batch (some failed) is red
  const mixed = copper({ S: 0, A: 0, B: 0, C: 0, D: 50, F: 50 });
  let sawErr = false;
  for (let seed = 1; seed < 20 && !sawErr; seed++) {
    const s = game(seed);
    s.storage.ore.copper = 8;
    const ctx = makeCtx(s, mixed);
    const root = render(renderWorkshop, s, mixed, ctx);
    const res = clickOf(findAll(root, (el) => el.attributes['data-run'] === 'refine:copper:all')[0])();
    if (/of \d+ failed/.test(res.msg)) {
      sawErr = true;
      assert.equal(res.tone, 'err');
    }
  }
  assert.ok(sawErr, 'a batch with some failures came up');
});

test('after a craft the gem picker is back on None (and the bar grade is re-picked when it ran short) (R26)', () => {
  const s = stateDay1();
  const need = CONFIG.gear.slots.sword.bars; // exactly one sword's worth of D bars, so the D bars run out
  s.storage.bars['copper:D'] = need;
  s.storage.bars['copper:C'] = need;
  s.storage.cut['ruby:D'] = 1;
  const ctx = makeCtx(s);
  Object.assign(ctx.ui, { ws_slot: 'sword', ws_mat: 'copper', ws_grade: 'D', ws_gem: 'ruby', ws_gemGrade: 'D' });
  const root = render(renderWorkshop, s, CONFIG, ctx);
  assert.match(textOf(root), /Result: D Copper Sword \+Ruby D/);
  const res = clickOf(byId(root, 'ws-craft'))();
  assert.equal(res.ok, true);
  assert.equal(s.gear.length, 1);
  assert.deepEqual(s.gear[0].gem, { type: 'ruby', grade: 'D' }, 'the sword got the gem');
  assert.equal(ctx.ui.ws_gem, '');
  assert.equal(ctx.ui.ws_gemGrade, null);
  assert.equal(ctx.ui.ws_grade, 'C', 'the D bars ran out: the next best grade is picked');
  const after = render(renderWorkshop, s, CONFIG, ctx);
  assert.match(textOf(after), /Result: C Copper Sword(?! \+)/);
  const none = findAll(after, (el) => el.attributes['data-gem'] === 'none')[0];
  assert.ok(none.classList.contains('sel'), 'the None tile is selected');
  assert.equal(withClass(after, 'ws-result')[0].classList.contains('ok'), true);
});

test('the smith preview has no durability, one stats line, the cost and "Time: 37m · done at 11:20"', () => {
  const s = stateDay1();
  const need = CONFIG.gear.slots.sword.bars;
  s.storage.bars['copper:D'] = need;
  const ctx = makeCtx(s);
  const root = render(renderWorkshop, s, CONFIG, ctx);
  const prev = withClass(root, 'ws-preview')[0];
  const text = textOf(prev);
  assert.doesNotMatch(text, /durability|100%/i);
  assert.match(text, /Result: D Copper Sword/);
  assert.equal(withClass(prev, 'ws-statsline').length, 1);
  assert.match(text, new RegExp(`Cost: ${need} × Copper D bars? \\(have ${need}\\)`));
  const m = smithMinutes(s, 'sword', 'copper', false, CONFIG);
  assert.ok(text.includes(`Time: ${m}m · done at `), text);
  assert.match(textOf(byId(root, 'ws-craft')), new RegExp(`^Craft \\(${m}m\\)$`));
  // the reference is a closed <details>
  const det = findAll(root, (el) => el.tagName === 'DETAILS' && el.classList.contains('ws-refbox'))[0];
  assert.ok(det && !det.attributes.open, 'closed by default');
  assert.match(textOf(det), /Compare all gear types and gem effects/);
});

test('the Workshop reference panel starts closed and stays open while the player works in it (a tile or a gem grade redraws the tab)', () => {
  const s = stateDay1();
  const ctx = makeCtx(s);
  const panelOf = (r) => findAll(r, (el) => el.tagName === 'DETAILS' && el.classList.contains('ws-refbox'))[0];
  let root = render(renderWorkshop, s, CONFIG, ctx);
  assert.ok(!panelOf(root).hasAttribute('open'), 'closed at first');
  // a click on the summary is seen before the browser flips `open`
  let panel = panelOf(root);
  panel.open = false;
  clickOf(findAll(panel, (el) => el.tagName === 'SUMMARY')[0])();
  assert.equal(ctx.ui.ws_refOpen, true);
  // a gem grade button inside the panel redraws the tab: the panel comes back open
  root = render(renderWorkshop, s, CONFIG, ctx);
  assert.ok(panelOf(root).hasAttribute('open'), 'still open after a redraw');
  const sGrade = findAll(root, (el) => el.tagName === 'BUTTON' && el.classList.contains('ws-gbtn') && textOf(el) === 'S')[0];
  assert.ok(sGrade, 'the gem grade buttons are in the panel');
  assert.ok(panelOf(root).contains(sGrade));
  clickOf(sGrade)();
  assert.equal(ctx.ui.ws_gemGrade, 'S');
  root = render(renderWorkshop, s, CONFIG, ctx);
  assert.ok(panelOf(root).hasAttribute('open'), 'open after picking a grade');
  // picking a tile (here: the None gem tile) keeps it open too
  clickOf(findAll(root, (el) => el.attributes['data-gem'] === 'none')[0])();
  root = render(renderWorkshop, s, CONFIG, ctx);
  assert.ok(panelOf(root).hasAttribute('open'), 'open after picking a tile');
  // closing it is remembered as well: by the summary click, and by the toggle event (find-in-page opens it the same way)
  panel = panelOf(root);
  panel.open = true;
  clickOf(findAll(panel, (el) => el.tagName === 'SUMMARY')[0])();
  assert.equal(ctx.ui.ws_refOpen, false);
  panel.open = true;
  panel.listeners.toggle[0]();
  assert.equal(ctx.ui.ws_refOpen, true);
  assert.ok(!panelOf(render(renderWorkshop, stateDay1(), CONFIG, makeCtx(s))).hasAttribute('open'), 'a fresh screen starts closed again');
});

test('Storage and gear: the overview lists gear by type and material with gem tags, "none yet", packed and low marks; a click picks it in the smith form (R38)', () => {
  const s = stateDay1();
  const a = addGear(s, 'sword', 'iron', 'C', { type: 'ruby', grade: 'B' });
  addGear(s, 'sword', 'iron', 'D');
  addGear(s, 'sword', 'iron', 'B');
  addGear(s, 'sword', 'iron', 'S');
  // always one more iron sword than the cell shows, whatever display.chipsPerCell is (the lowest grade goes last, so it is the one hidden)
  while (s.gear.filter((g) => g.slot === 'sword' && g.material === 'iron').length <= CONFIG.display.chipsPerCell) addGear(s, 'sword', 'iron', 'D');
  const ironSwords = s.gear.filter((g) => g.slot === 'sword' && g.material === 'iron').length;
  const low = addGear(s, 'chest', 'copper', 'D', { type: 'topaz', grade: 'C' }, { durability: 20, packed: true });
  s.storage.gem.ruby = 2;
  s.storage.cut['ruby:C'] = 1;
  const ctx = makeCtx(s);
  const root = render(renderWorkshop, s, CONFIG, ctx);
  const table = withClass(root, 'inv-geartable')[0];
  const rowText = (slot) => textOf(findAll(table, (el) => el.tagName === 'TR').find((tr) => textOf(tr).startsWith(slot[0].toUpperCase() + slot.slice(1))));
  assert.match(rowText('gloves'), /none yet/);
  assert.match(rowText('boots'), /none yet/);
  assert.match(rowText('sword'), /Ru/, 'the ruby tag');
  assert.match(rowText('chest'), /To/, 'the topaz tag');
  // at most chipsPerCell chips, then +N
  const chips = withClass(table, 'inv-chip').filter((c) => c.attributes['data-gear'] && s.gear.find((g) => g.id === Number(c.attributes['data-gear'])).slot === 'sword');
  assert.equal(chips.length, CONFIG.display.chipsPerCell);
  assert.equal(textOf(withClass(table, 'inv-more')[0]), `+${ironSwords - CONFIG.display.chipsPerCell}`);
  // the packed chest has the dotted mark, the 20% one the red dot; the hover has the whole story
  const chest = withClass(table, 'inv-chip').find((c) => c.attributes['data-gear'] === String(low.id));
  assert.ok(chest.classList.contains('inv-packed') && chest.classList.contains('inv-low'));
  assert.match(chest.attributes.title, /^D Copper Chest \+Topaz C · 20% · with the adventurer today$/);
  assert.equal(withClass(chest, 'inv-dot').length, 1);
  // gems: Gem | Raw | D C B A S | In gear
  const gems = withClass(root, 'inv-gemtable')[0];
  assert.match(textOf(gems), /Gem\s*Raw\s*D\s*C\s*B\s*A\s*S\s*In gear/);
  const ruby = findAll(gems, (el) => el.tagName === 'TR' && el.attributes['data-gem'] === 'ruby')[0];
  assert.match(textOf(ruby), /Ruby2·1···1/, 'raw 2, one C cut, one in gear');
  // a click on a gear cell picks the type and material in the smith form; a click on a gem row picks the gem
  const cell = findAll(table, (el) => el.attributes['data-slot'] === 'sword' && el.attributes['data-material'] === 'iron')[0];
  s.storage.bars['iron:C'] = 2;
  clickOf(cell)();
  assert.equal(ctx.ui.ws_slot, 'sword');
  assert.equal(ctx.ui.ws_mat, 'iron');
  assert.equal(ctx.ui.ws_grade, 'C', 'the grade you can make');
  clickOf(ruby)();
  assert.equal(ctx.ui.ws_gem, 'ruby');
  assert.equal(ctx.ui.ws_gemGrade, 'C');
  void a;
});

test('Storage and gear: the red dot follows the shown durability, not the exact one (plan 4.12)', () => {
  const s = stateDay1();
  const edge = addGear(s, 'chest', 'copper', 'D', null, { durability: LOW_DURABILITY + 0.4 }); // reads "30%"
  const above = addGear(s, 'helmet', 'copper', 'D', null, { durability: LOW_DURABILITY + 1.4 }); // reads "31%"
  const exact = addGear(s, 'gloves', 'copper', 'D', null, { durability: LOW_DURABILITY });
  const root = render(renderWorkshop, s);
  const chip = (item) => withClass(root, 'inv-chip').find((c) => c.attributes['data-gear'] === String(item.id));
  assert.match(chip(edge).attributes.title, new RegExp(`· ${LOW_DURABILITY}%$`), 'the hover shows the rounded-down number');
  assert.ok(chip(edge).classList.contains('inv-low') && withClass(chip(edge), 'inv-dot').length === 1, 'shown at the limit: red dot');
  assert.ok(chip(exact).classList.contains('inv-low'));
  assert.ok(!chip(above).classList.contains('inv-low') && withClass(chip(above), 'inv-dot').length === 0, 'shown above the limit: no dot');
});

test('Storage and gear: a tap re-renders the Workshop, and the scrolled gear table and gem table keep their position', () => {
  const s = stateDay1();
  addGear(s, 'sword', 'steel', 'C');
  // a root whose querySelectorAll finds the scroll boxes (the fake DOM has no selectors)
  const mount = (ctx) => {
    const root = document.createElement('div');
    root.querySelectorAll = (sel) => (sel === '[data-scroll]' ? findAll(root, (el) => el.attributes['data-scroll']) : []);
    renderWorkshop(root, ctx);
    return root;
  };
  const boxOf = (root, name) => findAll(root, (el) => el.attributes['data-scroll'] === name)[0];
  const ctx = makeCtx(s);
  const first = mount(ctx);
  assert.ok(withClass(boxOf(first, 'gear'), 'inv-geartable').length === 1, 'the gear table is inside the gear scroll box');
  assert.ok(withClass(boxOf(first, 'gems'), 'inv-gemtable').length === 1, 'the gem table is inside the gem scroll box');
  assert.equal(boxOf(first, 'gear').scrollLeft || 0, 0);
  // the player scrolls the gear table to the Steel column, then taps a cell
  const gear = boxOf(first, 'gear');
  gear.scrollLeft = 140;
  for (const fn of gear.listeners.scroll || []) fn();
  assert.equal(ctx.ui.inv_scroll.gear, 140);
  const second = mount(ctx);
  assert.equal(boxOf(second, 'gear').scrollLeft, 140, 'the new gear box starts where the old one was');
  assert.ok(!boxOf(second, 'gems').scrollLeft, 'the gem table was not scrolled');
});

test('Workshop repair intro: the bars and the gem each use their own repair lever', () => {
  const s = stateDay1();
  addGear(s, 'sword', 'copper', 'D');
  const intro = (repair) => textOf(withClass(render(renderWorkshop, s, cfgWith({ gear: { repair } })), 'ws-intro').pop());
  // pinned to different numbers: the gem share is not the bars' share
  assert.match(intro({ materialFraction: 40, gemFraction: 20 }), /A full repair costs 40% of the item's bars \(and 20% of its gem\) and /);
  // repairs that cost no gem do not mention one
  const free = intro({ materialFraction: 40, gemFraction: 0 });
  assert.match(free, /A full repair costs 40% of the item's bars and /);
  assert.doesNotMatch(free, /of its gem/);
  // today's config: both numbers come from it
  const now = intro({});
  assert.ok(now.includes(`${CONFIG.gear.repair.materialFraction}% of the item's bars`), now);
});

test('the gear list (Workshop): grouped by type, the Repair button right of the durability, packed items say so, a Scrap column; Repair all', () => {
  const s = stateDay1();
  addGear(s, 'sword', 'iron', 'C', null, { durability: 63.4 });
  addGear(s, 'sword', 'copper', 'D');
  const away = addGear(s, 'chest', 'copper', 'D', null, { durability: 40, packed: true });
  s.storage.bars['iron:C'] = 3;
  const root = render(renderWorkshop, s);
  const list = withClass(root, 'gl-table')[0];
  assert.ok(list.classList.contains('gl-hasscrap'));
  const groups = withClass(list, 'gl-group').map(textOf);
  assert.deepEqual(groups.map((g) => g.split(' ·')[0]), ['Sword', 'Chest', 'Helmet', 'Gloves', 'Boots']);
  assert.match(groups[0], /Sword · 2 owned/);
  assert.match(groups[2], /Helmet · none owned/);
  assert.deepEqual(findAll(list, (el) => el.tagName === 'TH').map(textOf), ['Item and stats', 'Durability', 'Scrap']);
  // strongest first
  const rows = withClass(list, 'gl-row');
  assert.match(textOf(rows[0]), /^C Iron Sword/);
  // the bar, the number and the Repair button sit on one line, in this order
  const line = withClass(rows[0], 'rp-main')[0];
  // ... inside one group (.rp-dur) that never wraps, so the button cannot drop below the bar in a narrow cell (R24); the cost text is a sibling
  const group = line.children[0];
  assert.ok(group.classList.contains('rp-dur'));
  assert.deepEqual(group.children.map((c) => c.tagName + (c.classList.contains('gl-pct') ? ':pct' : '')), ['DIV', 'SPAN:pct', 'BUTTON']);
  assert.ok(line.children[1].classList.contains('rp-cost'), 'the cost text follows the group');
  assert.match(textOf(line), /63%Repair \+37%/);
  // a packed item: "63% · with the adventurer today", no Repair button, no Scrap
  const packed = rows.find((r) => r.attributes['data-gear'] === String(away.id));
  assert.match(textOf(packed), /40% · with the adventurer today/);
  assert.equal(findAll(packed, (el) => el.attributes['data-repair'] !== undefined).length, 0);
  assert.equal(withClass(packed, 'ws-scrap')[0].hasAttribute('disabled'), true);
  assert.match(tipsOf(packed), /Repair it on a day you leave it at home\./);
  // Repair all
  const all = byId(root, 'ws-repair-all');
  assert.match(textOf(all), /^Repair all \(1\) · [\d.]+m$/);
  assert.equal(all.hasAttribute('disabled'), false);
});

test('Repair all repairs what it promised, best first, and the Adventurer tab has the same list without Scrap but with the inline Repair button', () => {
  const s = stateDay1();
  const sw = addGear(s, 'sword', 'iron', 'C', null, { durability: 50 });
  const ch = addGear(s, 'chest', 'copper', 'D', null, { durability: 50 });
  s.storage.bars['iron:C'] = 2;
  s.storage.bars['copper:D'] = 2;
  const ctx = makeCtx(s);
  const root = render(renderWorkshop, s, CONFIG, ctx);
  const res = clickOf(byId(root, 'ws-repair-all'))();
  assert.equal(res.ok, true);
  assert.equal(sw.durability, 100);
  assert.equal(ch.durability, 100);
  assert.match(res.msg, /^Repaired 2 items to 100% in (\d+h )?[\d.]+m?: C Iron Sword, D Copper Chest\./);
  // nothing left: the button is off
  const again = render(renderWorkshop, s, CONFIG, ctx);
  assert.equal(byId(again, 'ws-repair-all').hasAttribute('disabled'), true);
  // the Adventurer tab
  s.gear[0].durability = 5;
  const adv = render(renderAdventurer, s);
  const list = withClass(adv, 'gl-table')[0];
  assert.equal(list.classList.contains('gl-hasscrap'), false);
  assert.deepEqual(findAll(list, (el) => el.tagName === 'TH').map(textOf), ['Item and stats', 'Durability']);
  assert.equal(withClass(adv, 'ws-scrap').length, 0);
  // the Repair button is inline here too (R24); the 5% sword can be repaired from this tab
  const repairs = findAll(adv, (el) => el.attributes['data-repair'] !== undefined);
  assert.equal(repairs.length, 1);
  assert.equal(repairs[0].hasAttribute('disabled'), false);
  assert.match(textOf(repairs[0]), /^Repair \+95%$/);
  assert.ok(findAll(adv, (el) => el.attributes['data-flag'] === 'warn').length >= 1, 'the 5% sword could break against the toughest enemy');
});

test('the battle report: "Gear used in the fight" and "Brought but not used" are separate, home gear is never listed (R27, R39)', () => {
  const s = game(7, WIN);
  const used = addGear(s, 'sword', 'iron', 'C');
  const spare = addGear(s, 'sword', 'copper', 'D');
  const home = addGear(s, 'helmet', 'mythril', 'S', { type: 'diamond', grade: 'S' });
  endDay(s, WIN);
  assert.equal(confirmPlan(s, { enemyIndex: 0, gearIds: [used.id, spare.id], ringIds: [] }, WIN).ok, true);
  const r = endDay(s, WIN).report;
  assert.equal(r.win, true);
  const root = render(renderReport, s, WIN);
  const text = textOf(root);
  assert.match(text, /Gear used in the fight \(1\)/);
  assert.match(text, /Brought but not used \(no wear\)/i);
  assert.equal(r.used.length, 1);
  assert.equal(r.notUsed.length, 1);
  const usedPanel = findAll(root, (el) => el.tagName === 'SECTION' && /^Gear used in the fight/.test(textOf(el)))[0];
  const usedRows = findAll(usedPanel, (el) => el.tagName === 'TR' && el.attributes['data-gear']);
  assert.deepEqual(usedRows.map((tr) => tr.attributes['data-gear']), [String(r.usedIds[0])]);
  const chips = withClass(usedPanel, 'adv-notused')[0];
  assert.match(textOf(chips), r.usedIds[0] === used.id ? /D Copper Sword/ : /C Iron Sword/, 'the other sword is "not used"');
  assert.doesNotMatch(readable(root), /Mythril|Diamond/, 'gear left at home is never listed');
  assert.doesNotMatch(text, /Packed but not used/);
  // no tier points, the banner and the day in the header line
  assert.doesNotMatch(text, /points|pts/i);
  assert.match(textOf(withClass(root, 'adv-rhead')[0]), new RegExp(`Day ${r.day} · ${r.enemy.tier} · lasted [\\d.]+s`));
  void home;
  // nothing used: unarmed
  const t = game(7, WIN);
  endDay(t, WIN);
  confirmPlan(t, { enemyIndex: 0, gearIds: [], ringIds: [] }, WIN);
  endDay(t, WIN);
  const none = textOf(render(renderReport, t, WIN));
  assert.match(none, /Gear used in the fight \(0\)/);
  assert.match(none, /No gear used: the adventurer fought unarmed\./);
  assert.doesNotMatch(none, /Brought but not used/);
});

test('report wear: the loss is the difference of the two shown durabilities, so the numbers add up', () => {
  const s = game(7, WIN);
  const sw = addGear(s, 'sword', 'iron', 'C', null, { durability: 63.9 });
  endDay(s, WIN);
  confirmPlan(s, { enemyIndex: 0, gearIds: [sw.id], ringIds: [] }, WIN);
  const r = endDay(s, WIN).report;
  const row = findAll(render(renderReport, s, WIN), (el) => el.tagName === 'TR' && el.attributes['data-gear'] === String(sw.id))[0];
  const cells = findAll(row, (el) => el.tagName === 'TD').map(textOf);
  const before = 63;
  const after = Number.parseInt(cells[2], 10);
  assert.equal(cells[1], `-${before - after}%`);
  assert.equal(r.wear.length, 1);
});

test('the combat log is a fixed-column table: Time · Attacker · Result · Effects · You · Foe, both HP on every row, the dropped one bold (R28)', () => {
  const s = stateReport();
  const report = s.report;
  const root = renderCombatLog(report);
  const table = withClass(root, 'clog')[0];
  assert.deepEqual(findAll(table, (el) => el.tagName === 'TH').map(textOf), ['Time', 'Attacker', 'Result', 'Effects', 'You', 'Foe']);
  assert.equal(findAll(table, (el) => el.tagName === 'COL').length, 6, 'a colgroup with a column each');
  const rows = findAll(table, (el) => el.tagName === 'TR' && el.classList.contains('A') || el.classList.contains('E'));
  assert.equal(rows.length, report.log.length);
  report.log.forEach((e, i) => {
    const tds = findAll(rows[i], (el) => el.tagName === 'TD');
    assert.equal(tds.length, 6, 'six cells on every row');
    assert.match(textOf(tds[4]), /^\d+\.\d$/);
    assert.match(textOf(tds[5]), /^\d+\.\d$/);
    const bold = tds.map((td, c) => (findAll(td, (el) => el.tagName === 'B').length ? c : -1)).filter((c) => c >= 0);
    assert.deepEqual(bold, e.hit ? [e.side === 'A' ? 5 : 4] : [], 'on a hit the HP that dropped is bold; a miss has none');
  });
  assert.match(textOf(table), /Fight starts: Adventurer/);
  assert.match(textOf(table), /is defeated after/);
});

test('a very long log is trimmed to the first 1000 and last 300 rows with a gap row', () => {
  const log = Array.from({ length: 1500 }, (_, i) => ({ t: i / 10, side: i % 2 ? 'E' : 'A', hit: true, dmg: 1, phys: 1, magic: 0, hpA: 1000 - i / 2, hpE: 1000 - i / 2 }));
  const report = { enemy: { name: 'Foe' }, win: true, draw: false, time: 150, advMaxHp: 1000, enemyMaxHp: 1000, log, logTrimmed: 200 };
  const table = withClass(renderCombatLog(report), 'clog')[0];
  assert.equal(findAll(table, (el) => el.tagName === 'TR' && (el.classList.contains('A') || el.classList.contains('E'))).length, 1300);
  assert.match(textOf(withClass(table, 'clog-gap')[0]), /… 400 more attacks \(200 not saved: log trimmed\) …/);
});

function retiredState(score = 85, prevBest = undefined) {
  const s = game(7);
  s.stats.score = score;
  s.stats.wins = { normal: 3, elite: 2, champion: 1 };
  endRun(s);
  if (prevBest !== undefined) s.end.prevBest = prevBest;
  return s;
}

test('run summary: how it ended, score and days, "How your score is worked out" with points per tier, New game (R32)', () => {
  const s = retiredState(130);
  const root = render(renderRunSummary, s);
  const text = textOf(root);
  assert.match(text, /Run ended/);
  assert.match(text, /You retired the adventurer on day 1\./);
  assert.match(text, /How your score is worked out/);
  assert.match(text, /Each win adds points for the enemy's tier\. Draws and losses add nothing\. Every day alive is another chance to win\./);
  for (const tier of ['Normal', 'Elite', 'Champion']) assert.match(text, new RegExp(tier));
  for (const t of Object.values(CONFIG.enemies.tiers)) assert.ok(text.includes(`× ${t.score}`), 'points per win');
  assert.equal(textOf(byId(root, 'run-score')), '130');
  assert.match(text, /days survived/);
  assert.match(text, /fights won/);
  assert.match(text, new RegExp(`best score \\(v${VERSION.replace('.', '\\.')}\\)`));
  assert.equal(findAll(root, (el) => el.tagName === 'BUTTON').map(textOf).includes('New game'), true);
  assert.doesNotMatch(text, /What went wrong|fatal battle/, 'a retired run has no fatal battle');
  // a fight planned for today that did not happen
  const t = game(7);
  endDay(t);
  confirmPlan(t, { enemyIndex: 0, gearIds: [], ringIds: [] });
  const name = t.plan.enemy.name;
  endRun(t);
  assert.match(textOf(render(renderRunSummary, t)), new RegExp(`Today's fight against ${name} \\(\\w+\\) did not happen\\.`));
  // "New best score!" only when this run beat the best from before
  assert.match(textOf(render(renderRunSummary, retiredState(130, 50))), /New best score!/);
  assert.doesNotMatch(textOf(render(renderRunSummary, retiredState(130, 130))), /New best score!/);
  assert.doesNotMatch(textOf(render(renderRunSummary, retiredState(130, 500))), /New best score!/);
  assert.doesNotMatch(textOf(render(renderRunSummary, retiredState(130))), /New best score!/, 'no best known: no claim');
  assert.match(textOf(render(renderRunSummary, retiredState(130, 500))), /500best score/);
});

test('the run summary of a lost run: the fatal battle, the loss analysis (working, then done), and the tab is called Run summary', async () => {
  const s = stateOver();
  const text = textOf(render(renderRunSummary, s));
  assert.match(text, /Game over/);
  assert.match(text, /Your adventurer fell to .* on day 2\./);
  assert.match(text, /The fatal battle/);
  assert.match(text, /What went wrong\?/);
  assert.match(text, /Working out what happened… 0%/, 'no analysis yet and the automatic start is off');
  assert.equal(s.report.analysis, null);
  // with the analysis cached the panel says what the plan promises
  const a = analyzeLossSync(s, s.report, LOSE);
  s.report.analysis = a;
  const done = render(renderRunSummary, s, LOSE);
  const panel = textOf(done);
  assert.match(panel, new RegExp(`In ${CONFIG.report.replayFights} replays of this fight \\(same gear and rings, the enemy now fully known\\) the adventurer won 0%\\.`));
  assert.match(panel, /▲ This fight: lost badly \(.* had \d+% HP left\)\./);
  assert.match(panel, /Lost badly 100%/);
  assert.doesNotMatch(panel, /Won easily 0%|Draw 0%/, 'zero parts are left out');
  assert.match(panel, /Would gear left at home have helped\?/);
  assert.match(panel, /You had no other gear at home: everything you owned was packed\./);
  assert.match(panel, /How this was worked out/);
  assert.equal(withClass(done, 'oc-seg').length, 1, 'one part in the bar');
  // the analysis is shown once, not again inside the fatal battle
  assert.equal((panel.match(/What went wrong\?/g) || []).length, 1);
  // the automatic start (a real run): it works in the background, keeps the result on the report and re-renders
  const live = stateOver();
  const ctx = makeCtx(live, LOSE);
  ctx.ui = {};
  let renders = 0;
  ctx.rerender = () => { renders += 1; };
  let saves = 0;
  ctx.save = () => { saves += 1; };
  render(renderRunSummary, live, LOSE, ctx);
  assert.ok(ctx.ui.loss_run && !ctx.ui.loss_run.cancelled, 'a run started');
  for (let i = 0; i < 200 && !live.report.analysis; i++) await new Promise((r) => setTimeout(r, 10));
  assert.ok(live.report.analysis, 'the analysis finished');
  assert.deepEqual(live.battles[live.battles.length - 1].analysis, live.report.analysis);
  assert.equal(renders, 1);
  assert.equal(saves, 1);
  assert.equal(ctx.ui.loss_run, null);
  // a new game cancels a run that is going
  const other = stateOver();
  const ctx2 = makeCtx(other, LOSE);
  ctx2.ui = {};
  render(renderRunSummary, other, LOSE, ctx2);
  const run = ctx2.ui.loss_run;
  const { cancelAnalysis } = await import('../js/ui/endday.js');
  cancelAnalysis(ctx2);
  assert.equal(run.cancelled, true);
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(other.report.analysis, null, 'a cancelled run leaves nothing behind');
});

test('the fatal battle in the Log tab of a lost run shows the same analysis panel', () => {
  const s = stateOver();
  s.report.analysis = analyzeLossSync(s, s.report, LOSE);
  s.battles[s.battles.length - 1].analysis = s.report.analysis;
  const ctx = makeCtx(s, LOSE);
  ctx.ui.log_open = { [s.report.day]: true };
  assert.match(textOf(render(renderLog, s, LOSE, ctx)), /What went wrong\?/);
});

test('the roster and the enemy card show no points for a win (U3), and the Rings tab has no Score column', () => {
  const s = statePlan(0);
  const plan = render(renderPlan, s);
  assert.doesNotMatch(readable(plan), /pts|points per|\+\d+ points/i);
  const rings = textOf(render(renderRings, s));
  assert.doesNotMatch(rings, /Score/);
  const adv = game(7);
  endDay(adv);
  confirmPlan(adv, { enemyIndex: 0, gearIds: [], ringIds: [] });
  assert.doesNotMatch(readable(render(renderAdventurer, adv)), /pts|\+\d+ points/i);
});
