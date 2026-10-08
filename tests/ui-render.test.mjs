// UI render smoke test: every screen module renders, in the main game states, without throwing, and the
// text a player can read (plus hover texts) says what this version promises. Runs on a minimal fake DOM
// (tests/fakedom.mjs): nothing is laid out and no events fire, so this checks structure and wording only.
//
// Each batch adds its own text assertions here (e.g. no "regrow" anywhere, nothing seen on day 1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { installFakeDom, textOf, tipsOf, withClass, findAll } from './fakedom.mjs';
import { renderMap } from '../js/ui/mapview.js';
import { renderWorkshop } from '../js/ui/workshop.js';
import { renderAdventurer } from '../js/ui/adventurer.js';
import { renderRings } from '../js/ui/ringsview.js';
import { renderSkills, spendIntelAction } from '../js/ui/skillsview.js';
import { renderLog } from '../js/ui/logview.js';
import { renderHelp } from '../js/ui/help.js';
import { renderPlan, renderReport, renderGameOver } from '../js/ui/endday.js';
import { endDay, confirmPlan } from '../js/core/game.js';
import { tip } from '../js/ui/dom.js';
import { scrapReturn, smithMinutes, repairMinutes } from '../js/core/gear.js';
import { skillDefs, skillHoverText } from '../js/core/skills.js';
import { intelValue } from '../js/core/intel.js';
import { travel, search, currentField, sightValue, seenItems, expectedSearches, searchesText, searchesToFinish } from '../js/core/map.js';
import { game, cfgWith, addGear, addRing, fieldAt, setSkillLevel, WEAK_ENEMIES, DEADLY_ENEMIES, DAY_START } from './helpers.mjs';

installFakeDom();

const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);

// What the app's shell passes to every screen (js/main.js), with the side effects turned into no-ops.
function makeCtx(state, cfg = CONFIG) {
  return { state, cfg, ui: { estimates: 'off' }, act: (f) => f(), rerender() {}, save() {}, toast() {}, newGame() {}, setTab() {} };
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
    ['report', stateReport(), () => renderReport], ['over', stateOver(), () => renderGameOver]];
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
    const screens = s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : s.phase === 'report' ? renderReport : renderGameOver]];
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
  assert.match(text, /Boulders \(\d+(-\d+, more far away)? per field\) can never be searched/);
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
  assert.match(textOf(render(renderPlan, statePlan(1))), new RegExp(`Spend 1 point: ${CONFIG.intel.tracks.oreSight.base} sight → \\d+ sight`));
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
    const screens = s.phase === 'work' ? Object.entries(WORK_SCREENS) : [...Object.entries(REFERENCE_SCREENS), ['phase', s.phase === 'plan' ? renderPlan : s.phase === 'report' ? renderReport : renderGameOver]];
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
  assert.match(text, /Repairs happen here by day, at camp, on gear the adventurer does not have/);
});

test('a Copper sword at 60% scrapped from the Workshop returns 0.42 bars (confirm text and the click through ctx.act)', () => {
  const s = stateDay1();
  addGear(s, 'sword', 'copper', 'D', null, { durability: 60 });
  const ctx = makeCtx(s);
  const confirms = [];
  globalThis.confirm = (m) => {
    confirms.push(m);
    return true;
  };
  try {
    const root = render(renderWorkshop, s, CONFIG, ctx);
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
  assert.match(tipsOf(root), /Base [\d.]+m \(2 bars × \d+m\); your Copper smithing skill cuts it to [\d.]+m/);
});

test('the map explains the Carrying skill: the load penalty per item shrinks and the base is mentioned', () => {
  const s = stateDay1();
  setSkillLevel(s, 'carrying', 4);
  const text = textOf(render(renderMap, s));
  assert.match(text, new RegExp(`${CONFIG.map.travelMinPerStep}m per step, \\+[\\d.]+% per item carried \\(${CONFIG.map.loadPenaltyPerItem}% before the Carrying skill\\)`));
  assert.doesNotMatch(text, /way home \(skill\)|Return travel/i);
});

test('the day clock still starts at the configured time (sanity for the shared test states)', () => {
  assert.equal(stateDay1().time, DAY_START);
});
