import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import * as mapModule from '../js/core/map.js';
import {
  search, fieldProgress, areaCells, searchMinutes, searchEfficiency, searchEfficiencyRange, debrisClearMult,
  currentField, cellOpen, boulderCell, cellFresh, freshCellCount, rollCell, generateField, fitsWithReturn, returnMinutes,
} from '../js/core/map.js';
import { serialize, deserialize } from '../js/core/game.js';
import { seededRng } from '../js/core/rng.js';
import { round1 } from '../js/core/util.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { intelChance } from '../js/core/intel.js';
import { game, cfgWith, cell, boulder, blankField, idx, standInBlankField, addRing, setSkillLevel, ringVal, totalXp, approx, DAY_START, DAY_END } from './helpers.mjs';

// Pinned field numbers: the hand-computed times/percentages below hold whatever CONFIG says.
// searchRandomness 0: every cell gets exactly the efficiency, so exact search depths and debris
// clearing can be checked (the per-cell roll has its own tests below). freshCellMin 0: the extra time for
// never-searched cells has its own tests (FRESH below); everything else is about the base search time.
const PIN = {
  field: { size: 8, searchMin: 30, freshCellMin: 0, searchEfficiency: 25, searchRandomness: 0, debrisAmount: { min: 20, max: 60 }, boulders: 1 },
  map: { travelMinPerStep: 20, loadPenaltyPerItem: 1 },
  bag: { slots: 20 },
  processing: { maxTimeReduction: 75 },
  skills: { xpBase: 100, maxLevel: 10, activity: { searchTime: { perLevel: 0.5 }, searchEff: { perLevel: 1 }, debris: { perLevel: 10 }, returnTravel: { perLevel: 0.5 } } },
  rings: { duplicateFactor: 0.5, types: { searchTime: { values: [5, 6, 7, 8, 10] }, searchEff: { values: [10, 12, 14, 16, 20] }, reveal: { values: [3, 4, 5, 6, 7] }, travelTime: { values: [5, 6, 7, 8, 10] } } },
  intel: { gainsPerPoint: [10, 9, 8, 7, 6, 5, 4, 3, 2], minGain: 1, maxChance: 100, tracks: { oreSight: { base: 10 } } },
};
const CFG = cfgWith(PIN);
const NO_REVEAL = cfgWith(PIN, { intel: { tracks: { oreSight: { base: 0 } } } });
const ALL_REVEAL = cfgWith(PIN, { intel: { tracks: { oreSight: { base: 100 } } } });
const I = (x, y) => idx(x, y, CFG);
const area = (x, y) => areaCells(x, y, CFG);

// The smith standing in a blank pinned-size field (no items, debris or boulders).
function setup(seed = 3, cfg = CFG) {
  const s = game(seed);
  const f = standInBlankField(s, 1, cfg);
  return { s, f };
}

// Centers of disjoint 3x3 areas covering an n x n field.
const tiles = (n) => {
  const at = [];
  for (let c = 1; c - 1 < n; c += 3) at.push(Math.min(c, n - 1));
  return at.flatMap((y) => at.map((x) => [x, y]));
};

test('areaCells: 3x3 clipped to the field', () => {
  assert.equal(area(4, 4).length, 9);
  assert.deepEqual(area(0, 0).sort((a, b) => a - b), [0, 1, 8, 9]);
  assert.equal(area(7, 3).length, 6);
  assert.equal(area(7, 7).length, 4);
  assert.deepEqual(area(1, 1).sort((a, b) => a - b), [0, 1, 2, 8, 9, 10, 16, 17, 18]);
});

test('items are found exactly when the searched % passes their depth, and go to the field\'s pile', () => {
  const { s, f } = setup();
  f.cells[I(1, 1)] = cell([{ t: 'ore:copper', d: 10 }, { t: 'ore:iron', d: 25 }, { t: 'gem:ruby', d: 60 }, { t: 'ore:coal', d: 99.5 }]);
  const steps = [
    { searched: 25, found: ['ore:copper'] }, // d=25 is not yet passed at exactly 25%
    { searched: 50, found: ['ore:iron'] },
    { searched: 75, found: ['gem:ruby'] },
    { searched: 100, found: ['ore:coal'] },
  ];
  for (const st of steps) {
    const r = search(s, 1, 1, NO_REVEAL);
    assert.equal(r.ok, true, r.msg);
    assert.deepEqual(r.found, st.found);
    assert.equal(f.cells[I(1, 1)].searched, st.searched);
    assert.match(r.msg, /pile/);
  }
  assert.deepEqual(f.pile, ['ore:copper', 'ore:iron', 'gem:ruby', 'ore:coal']);
  assert.deepEqual(s.bag, [], 'found items are not carried until you choose to');
  assert.deepEqual(f.cells[I(1, 1)].items, []);
});

test('a search that completes a cell finds everything left in it', () => {
  const { s, f } = setup();
  f.cells[I(4, 4)] = cell([{ t: 'ore:mythril', d: 99.999 }, { t: 'gem:diamond', d: 95 }], { searched: 90 });
  const r = search(s, 4, 4, NO_REVEAL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.found.sort(), ['gem:diamond', 'ore:mythril']);
  assert.deepEqual([...f.pile].sort(), ['gem:diamond', 'ore:mythril']);
  assert.equal(f.cells[I(4, 4)].searched, 100);
});

test('found items go to the pile even with a full bag; the pile has no size limit', () => {
  const { s, f } = setup();
  s.bag = Array(CFG.bag.slots).fill('ore:copper');
  const many = Array.from({ length: CFG.bag.slots + 5 }, (_, i) => ({ t: i % 2 ? 'gem:topaz' : 'ore:iron', d: 1 + (i % 20) }));
  f.cells[I(2, 2)] = cell(many);
  const r = search(s, 2, 2, cfgWith(NO_REVEAL, { field: { searchEfficiency: 100 } }));
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.found.length, many.length);
  assert.equal(f.pile.length, many.length, 'more items than bag slots, all in the pile');
  assert.equal(s.bag.length, CFG.bag.slots, 'bag unchanged');
  assert.ok(s.bag.every((t) => t === 'ore:copper'));
  assert.equal(r.toGround, undefined, 'nothing is left "on the ground" any more');
});

test('efficiency 25 -> 4 searches fully search an area; a 5th is refused', () => {
  const { s, f } = setup();
  assert.equal(searchEfficiency(s, NO_REVEAL), 25);
  for (let i = 1; i <= 4; i++) {
    assert.equal(search(s, 3, 3, NO_REVEAL).ok, true);
    for (const c of area(3, 3)) assert.equal(f.cells[c].searched, Math.min(100, 25 * i));
  }
  const t = s.time;
  const r = search(s, 3, 3, NO_REVEAL);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Nothing left/);
  assert.equal(s.time, t, 'refused search costs no time');
});

test('search time / efficiency / debris clearing default to CONFIG with no bonuses', () => {
  const { s } = setup();
  assert.equal(searchMinutes(s), CONFIG.field.searchMin);
  assert.equal(searchEfficiency(s), CONFIG.field.searchEfficiency);
  const { searchEfficiency: E, searchRandomness: R } = CONFIG.field;
  assert.deepEqual(searchEfficiencyRange(s), [Math.max(0, E - R), Math.min(100, E + R)]);
  assert.equal(debrisClearMult(s), 1, 'no debris skill: 1 debris per point of effort');
});

test('search costs 30 minutes and gives search XP; overlapping searches only search unfinished cells', () => {
  const { s, f } = setup();
  assert.equal(searchMinutes(s, NO_REVEAL), 30);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.minutes, 30);
  assert.equal(s.time, DAY_START + 30);
  assert.equal(s.skills.searchTime.xp, 30);
  assert.equal(s.skills.searchEff.xp, 30);
  assert.equal(s.skills.debris.xp, 0, 'no debris, no debris XP');
  // finish (2,2) area, then search (3,2): 3 cells new, 6 already done -> those stay at 100
  for (let i = 0; i < 3; i++) search(s, 2, 2, NO_REVEAL);
  // 4 searches = 120 XP -> Search efficiency level 1 (+1%)
  assert.equal(s.skills.searchEff.level, 1);
  assert.equal(searchEfficiency(s, NO_REVEAL), 25.25);
  const r2 = search(s, 3, 2, NO_REVEAL);
  assert.equal(r2.ok, true);
  assert.match(r2.msg, /Searched 3 cells/);
  assert.equal(r2.searchedCells, 3);
  assert.equal(f.cells[I(4, 2)].searched, 25.25);
  assert.equal(f.cells[I(3, 2)].searched, 100);
});

test('search speed / efficiency bonuses from rings and skills', () => {
  const { s, f } = setup();
  addRing(s, 'searchTime', 'S', true); // 10%
  setSkillLevel(s, 'searchTime', 2); // +1%
  addRing(s, 'searchEff', 'S', true); // +20%
  setSkillLevel(s, 'searchEff', 4); // +4%
  assert.equal(searchMinutes(s, NO_REVEAL), 26.7); // 30 x 0.89
  assert.equal(searchEfficiency(s, NO_REVEAL), 31); // 25 x 1.24
  search(s, 4, 4, NO_REVEAL);
  assert.equal(f.cells[I(4, 4)].searched, 31);
  assert.equal(s.time, DAY_START + 26.7);
});

test('search is refused at camp and outside the work phase', () => {
  const s = game(3);
  assert.equal(currentField(s), null);
  assert.equal(search(s, 1, 1).ok, false);
  const f = standInBlankField(s, 1, CFG);
  for (const phase of ['report', 'plan', 'over']) {
    s.phase = phase;
    const r = search(s, 1, 1, CFG);
    assert.equal(r.ok, false, phase);
    assert.match(r.msg, /work day/);
  }
  assert.equal(s.time, DAY_START);
  assert.ok(f.cells.every((c) => c.searched === 0));
});

// ----------------------------------------------------------------- debris ----
test('cellOpen: a cell needs work while it has debris or is not fully searched; boulders never do', () => {
  assert.equal(cellOpen(cell()), true);
  assert.equal(cellOpen(cell([], { searched: 99 })), true);
  assert.equal(cellOpen(cell([], { searched: 100 })), false);
  assert.equal(cellOpen(cell([], { debris: 12 })), true);
  assert.equal(cellOpen(boulder()), false);
  assert.equal(cellOpen(boulderCell()), false);
});

test('search clears debris first; leftover effort searches the same cell in the same search (exact)', () => {
  const { s, f } = setup();
  const E = searchEfficiency(s, NO_REVEAL); // 25, randomness 0
  const D = 10;
  f.cells[I(2, 2)] = cell([{ t: 'ore:copper', d: 5 }, { t: 'ore:iron', d: 20 }], { debris: D });
  assert.equal(debrisClearMult(s, NO_REVEAL), 1);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.ok, true, r.msg);
  const c = f.cells[I(2, 2)];
  assert.equal(c.debris, 0);
  assert.equal(c.searched, E - D, 'leftover effort 25 - 10 = 15 searches the cell');
  assert.deepEqual(r.found, ['ore:copper'], 'depth 5 < 15 found, depth 20 not yet');
  assert.deepEqual(f.pile, ['ore:copper']);
  assert.equal(r.debrisCleared, D);
  assert.equal(r.cellsCleared, 1);
  assert.equal(r.searchedCells, 9, 'the debris cell was searched too');
  assert.match(r.msg, /Cleared 10 debris \(1 cell\(s\) now clear\)/);
  for (const i of area(2, 2)) if (i !== I(2, 2)) assert.equal(f.cells[i].searched, E);
  // the next search is a plain search
  const r2 = search(s, 2, 2, NO_REVEAL);
  assert.equal(c.searched, 2 * E - D);
  assert.deepEqual(r2.found, ['ore:iron']);
  assert.equal(r2.debrisCleared, 0);
  assert.equal(r2.cellsCleared, 0);
});

test('thick debris takes several searches; the cell is not searched and keeps its items until clear', () => {
  const { s, f } = setup();
  const E = searchEfficiency(s, NO_REVEAL); // 25
  const D = 2 * E + 10; // 60: two full searches, then 10 more
  const c = I(5, 5);
  f.cells[c] = cell([{ t: 'gem:diamond', d: 0.5 }], { debris: D });
  const r1 = search(s, 5, 5, NO_REVEAL);
  assert.equal(f.cells[c].debris, D - E);
  assert.equal(f.cells[c].searched, 0);
  assert.deepEqual(r1.found, []);
  assert.equal(r1.debrisCleared, E);
  assert.equal(r1.cellsCleared, 0);
  assert.equal(r1.searchedCells, 8, 'the other 8 cells were searched');
  assert.equal(f.cells[c].items.length, 1);
  const r2 = search(s, 5, 5, NO_REVEAL);
  assert.equal(f.cells[c].debris, D - 2 * E);
  assert.equal(r2.debrisCleared, E);
  const r3 = search(s, 5, 5, NO_REVEAL);
  assert.equal(f.cells[c].debris, 0);
  assert.equal(r3.debrisCleared, D - 2 * E);
  assert.equal(r3.cellsCleared, 1);
  assert.equal(f.cells[c].searched, 3 * E - D, 'leftover of the third search');
  assert.deepEqual(r3.found, ['gem:diamond']);
  // XP: every debris point cleared, over the three searches
  assert.equal(totalXp(s, 'debris', NO_REVEAL), D);
});

test('an area where every cell is under thick debris can still be searched: it clears debris and costs the search time', () => {
  const { s, f } = setup();
  const E = searchEfficiency(s, NO_REVEAL);
  for (const c of area(0, 0)) f.cells[c] = cell([{ t: 'ore:iron', d: 1 }], { debris: E * 3 });
  const r = search(s, 0, 0, NO_REVEAL);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, searchMinutes(s, NO_REVEAL));
  assert.equal(s.time, DAY_START + r.minutes);
  assert.equal(r.searchedCells, 0);
  assert.deepEqual(r.found, []);
  assert.equal(r.debrisCleared, 4 * E);
  for (const c of area(0, 0)) {
    assert.equal(f.cells[c].debris, 2 * E);
    assert.equal(f.cells[c].searched, 0);
  }
});

test('debris skill: each search clears effort x debrisClearMult (1 + skill %) of debris', () => {
  const { s, f } = setup();
  const per = CFG.skills.activity.debris.perLevel; // 10
  setSkillLevel(s, 'debris', 5);
  const m = debrisClearMult(s, NO_REVEAL);
  assert.equal(m, 1 + (per * 5) / 100);
  assert.equal(m, 1.5);
  assert.equal(smithBonuses(s, NO_REVEAL).debrisPct, 50);
  const E = searchEfficiency(s, NO_REVEAL); // 25 -> 37.5 debris per search
  // debris 30: cleared in one search (power 37.5), leftover 7.5 debris power = 5 effort searches the cell
  f.cells[I(1, 1)] = cell([], { debris: 30 });
  // debris 50: 37.5 cleared now, 12.5 left
  f.cells[I(2, 2)] = cell([], { debris: 50 });
  const r = search(s, 1, 1, NO_REVEAL);
  assert.equal(f.cells[I(1, 1)].debris, 0);
  assert.equal(f.cells[I(1, 1)].searched, E - 30 / m);
  assert.equal(f.cells[I(1, 1)].searched, 5);
  assert.equal(f.cells[I(2, 2)].debris, 50 - E * m);
  assert.equal(f.cells[I(2, 2)].searched, 0);
  assert.equal(r.debrisCleared, 30 + E * m);
  assert.equal(r.cellsCleared, 1);
  // second search finishes the 12.5 and searches with what is left
  search(s, 2, 2, NO_REVEAL);
  assert.equal(f.cells[I(2, 2)].debris, 0);
  assert.ok(approx(f.cells[I(2, 2)].searched, E - 12.5 / m), `${f.cells[I(2, 2)].searched}`);
  // the same debris without the skill: 25 per search
  const { s: s0, f: f0 } = setup(4);
  f0.cells[I(1, 1)] = cell([], { debris: 30 });
  search(s0, 1, 1, NO_REVEAL);
  assert.equal(f0.cells[I(1, 1)].debris, 30 - E);
  assert.equal(f0.cells[I(1, 1)].searched, 0);
  // max level (+100%): twice the debris per search, so a 2E cell clears in one search with nothing left over
  const { s: s1, f: f1 } = setup(5);
  setSkillLevel(s1, 'debris', CFG.skills.maxLevel);
  assert.equal(debrisClearMult(s1, NO_REVEAL), 2);
  f1.cells[I(3, 3)] = cell([], { debris: 2 * E });
  const r1 = search(s1, 3, 3, NO_REVEAL);
  assert.equal(f1.cells[I(3, 3)].debris, 0);
  assert.equal(f1.cells[I(3, 3)].searched, 0, 'no effort left to search with');
  assert.equal(r1.cellsCleared, 1);
  assert.equal(r1.searchedCells, 8);
});

test('debris XP = debris points cleared (not minutes, not effort spent)', () => {
  const { s, f } = setup();
  setSkillLevel(s, 'debris', 2); // x1.2
  const m = debrisClearMult(s, NO_REVEAL);
  const E = searchEfficiency(s, NO_REVEAL);
  f.cells[I(3, 3)] = cell([], { debris: 10 });
  f.cells[I(4, 3)] = cell([], { debris: 20 });
  f.cells[I(2, 4)] = cell([], { debris: 100 });
  const before = totalXp(s, 'debris', NO_REVEAL);
  const r = search(s, 3, 3, NO_REVEAL);
  const cleared = 10 + 20 + E * m;
  assert.ok(approx(r.debrisCleared, cleared));
  assert.ok(approx(totalXp(s, 'debris', NO_REVEAL) - before, cleared));
  assert.equal(s.skills.searchTime.xp, r.minutes, 'search XP is still minutes');
  // the real config gives the same 1 XP per debris point
  const { s: s2, f: f2 } = setup(6, CONFIG);
  f2.cells[idx(2, 2)] = cell([], { debris: 7 });
  const r2 = search(s2, 2, 2);
  assert.equal(r2.debrisCleared, 7);
  assert.equal(totalXp(s2, 'debris'), 7);
});

test('with random rolls, each cell\'s debris clearing is its own effort roll x debrisClearMult', () => {
  const R = 5;
  const rand = cfgWith(NO_REVEAL, { field: { searchRandomness: R } });
  const { s, f } = setup();
  setSkillLevel(s, 'debris', 3);
  const m = debrisClearMult(s, rand);
  const [lo, hi] = searchEfficiencyRange(s, rand);
  const BIG = 1000;
  for (const c of area(4, 4)) f.cells[c] = cell([], { debris: BIG });
  const r = search(s, 4, 4, rand);
  const cleared = area(4, 4).map((c) => BIG - f.cells[c].debris);
  for (const d of cleared) assert.ok(d >= lo * m - 1e-9 && d <= hi * m + 1e-9, `${d} outside [${lo * m}, ${hi * m}]`);
  assert.ok(new Set(cleared).size > 1, 'cells roll independently');
  assert.ok(approx(r.debrisCleared, cleared.reduce((a, b) => a + b, 0), 1e-6));
  // thin debris: what is left of each cell's roll searches it
  const { s: s2, f: f2 } = setup(4);
  for (const c of area(4, 4)) f2.cells[c] = cell([], { debris: 1 });
  search(s2, 4, 4, rand);
  for (const c of area(4, 4)) {
    const v = f2.cells[c].searched;
    assert.ok(v >= lo - 1 - 1e-9 && v <= hi - 1 + 1e-9, `${v}`);
    assert.equal(f2.cells[c].debris, 0);
  }
});

test('no separate debris clearing action: map.js has no clearDebris / pick-up / drop / loadMark API', () => {
  for (const name of ['clearDebris', 'debrisMinutesPerCell', 'pickUp', 'dropItem', 'pickUpLimit']) {
    assert.equal(name in mapModule, false, `${name} should be gone`);
  }
  assert.equal(CONFIG.field.debrisClearMin, undefined, 'no minutes-per-debris-cell setting');
  // searching never sets the old loadMark
  const { s } = setup();
  search(s, 1, 1, CFG);
  assert.equal('loadMark' in s, false);
});

// --------------------------------------------------------------- boulders ----
test('a boulder in the search area is skipped and never changes (even with hand-placed items)', () => {
  const { s, f } = setup();
  const b = I(2, 2);
  f.cells[b] = cell([{ t: 'ore:mythril', d: 1 }], { boulder: true });
  const before = structuredClone(f.cells[b]);
  for (let i = 1; i <= 4; i++) {
    const r = search(s, 2, 2, NO_REVEAL);
    assert.equal(r.ok, true, r.msg);
    assert.equal(r.searchedCells, 8);
    assert.match(r.msg, /1 cell\(s\) skipped/);
    assert.deepEqual(f.cells[b], before);
  }
  assert.deepEqual(f.pile, [], 'items under a boulder are never found');
  const r5 = search(s, 2, 2, NO_REVEAL);
  assert.equal(r5.ok, false, 'only the boulder is left: nothing to search');
  assert.deepEqual(f.cells[b], before);
});

test('an area of only boulders cannot be searched (no time spent)', () => {
  const { s, f } = setup();
  for (const c of area(0, 0)) f.cells[c] = boulder();
  const r = search(s, 0, 0, NO_REVEAL);
  assert.equal(r.ok, false);
  assert.match(r.msg, /boulder/);
  assert.equal(s.time, DAY_START);
});

// -------------------------------------------------------------- ore sight ----
test('ore sight 0% never reveals; 100% reveals every cell the search searched (not one still under debris)', () => {
  const { s, f } = setup();
  assert.equal(smithBonuses(s, NO_REVEAL).revealPct, 0);
  assert.equal(smithBonuses(s, ALL_REVEAL).revealPct, 100);
  for (let i = 0; i < 4; i++) search(s, 2, 2, NO_REVEAL);
  assert.equal(f.cells.filter((c) => c.revealed).length, 0);

  const { s: s2, f: f2 } = setup(4);
  const E = searchEfficiency(s2, ALL_REVEAL);
  f2.cells[I(5, 5)].debris = E * 4; // all effort goes into the debris
  f2.cells[I(4, 4)].debris = E / 5; // thin: searched with the leftover
  const r = search(s2, 5, 5, ALL_REVEAL);
  assert.equal(r.revealed, 8);
  for (const c of area(5, 5)) assert.equal(f2.cells[c].revealed, c !== I(5, 5));
  assert.equal(f2.cells.filter((c) => c.revealed).length, 8);
});

test('ore sight chance = intel + smith ring; about that share of cells get revealed', () => {
  const s = game(5);
  assert.equal(smithBonuses(s).revealPct, CONFIG.intel.tracks.oreSight.base);
  assert.equal(smithBonuses(s, CFG).revealPct, 10);
  addRing(s, 'reveal', 'S', true); // +7
  s.intel.spent.oreSight = 2; // +10 +9
  assert.equal(smithBonuses(s, CFG).revealPct, 10 + 7 + 19);
  // default config: same rule
  assert.equal(smithBonuses(s).revealPct, intelChance(s, 'oreSight') + ringVal('reveal', 'S'));
  // statistical check at 36%
  let cells = 0;
  let revealed = 0;
  for (let k = 0; k < 40; k++) {
    const f = standInBlankField(s, 1, CFG);
    s.time = DAY_START;
    for (const [x, y] of [[1, 1], [4, 1], [1, 4], [4, 4], [1, 7]]) search(s, x, y, CFG); // disjoint areas
    cells += f.cells.filter((c) => c.searched > 0).length;
    revealed += f.cells.filter((c) => c.revealed).length;
  }
  assert.ok(Math.abs(revealed / cells - 0.36) < 0.05, `revealed ${revealed / cells}`);
});

// --------------------------------------------------------------- progress ----
test('fieldProgress = average searched % over the cells that can be searched (boulders excluded)', () => {
  const { s, f } = setup();
  const n = f.cells.length;
  assert.equal(fieldProgress(f), 0);
  search(s, 2, 2, NO_REVEAL);
  assert.equal(fieldProgress(f), (9 * 25) / n);
  search(s, 0, 0, NO_REVEAL); // 4 cells, 1 overlapping (1,1)
  assert.equal(fieldProgress(f), (8 * 25 + 50 + 3 * 25) / n);
  // a boulder drops out of the average
  f.cells[I(7, 7)] = boulder();
  assert.equal(fieldProgress(f), (8 * 25 + 50 + 3 * 25) / (n - 1));
  for (const c of f.cells) if (!c.boulder) c.searched = 100;
  assert.equal(fieldProgress(f), 100, 'every searchable cell done = 100% even with a boulder at 0');
  for (let i = 0; i < n; i++) f.cells[i] = boulder();
  assert.equal(fieldProgress(f), 100, 'an all-boulder field counts as done');
});

test('searching a generated field: debris is cleared by searching alone and every item ends up in the pile', () => {
  const cfg = cfgWith({ intel: { tracks: { oreSight: { base: 0 } } } }); // the real field rules
  const s = game(21);
  const fieldCell = s.map.cells.find((c) => c.type === 'field' && c.dist === 1);
  s.location = { x: fieldCell.x, y: fieldCell.y };
  const f = currentField(s);
  assert.ok(f.cells.some((c) => c.debris > 0), 'the field has debris');
  const boulders = f.cells.map((c, i) => (c.boulder ? i : -1)).filter((i) => i >= 0);
  assert.equal(boulders.length, CONFIG.field.boulders);
  const boulderBefore = boulders.map((i) => structuredClone(f.cells[i]));
  const total = f.cells.reduce((a, c) => a + c.items.length, 0);
  let got = 0;
  let cleared = 0;
  for (let pass = 0; pass < 30 && fieldProgress(f) < 100; pass++) {
    for (const [x, y] of tiles(CONFIG.field.size)) {
      s.time = DAY_START; // ignore the clock for this sweep
      const r = search(s, x, y, cfg);
      if (r.ok) {
        got += r.found.length;
        cleared += r.debrisCleared;
      }
    }
  }
  assert.equal(fieldProgress(f), 100);
  assert.equal(got, total);
  assert.equal(f.pile.length, total);
  assert.deepEqual(s.bag, []);
  for (const c of f.cells) {
    if (c.boulder) continue;
    assert.equal(c.debris, 0);
    assert.equal(c.searched, 100);
    assert.deepEqual(c.items, []);
  }
  boulders.forEach((i, k) => assert.deepEqual(f.cells[i], boulderBefore[k], 'boulders untouched'));
  assert.ok(cleared > 0);
  assert.ok(s.skills.debris.level < CONFIG.skills.maxLevel);
  assert.ok(approx(totalXp(s, 'debris'), cleared, 1e-6), 'debris XP = every debris point cleared');
});

// ------------------------------------------------------ search randomness ----
// Each cell rolls its own efficiency per search: eff + uniform(-r, +r), clamped to 0..100.
const R = 5;
const RAND = cfgWith(PIN, { field: { searchRandomness: R } }, { intel: { tracks: { oreSight: { base: 0 } } } });
const EPS_PCT = 1e-9;

// Search every tile once and return the per-cell searched % gained. The clock is reset so time never
// runs out, and the search skills are held at their level (searching gives XP, which would otherwise
// raise the efficiency part-way through the sweep).
function sweep(s, f, cfg) {
  const before = f.cells.map((c) => c.searched);
  const levels = { searchEff: s.skills.searchEff.level, searchTime: s.skills.searchTime.level };
  for (const [x, y] of tiles(cfg.field.size)) {
    s.time = DAY_START;
    const r = search(s, x, y, cfg);
    assert.equal(r.ok, true, r.msg);
    for (const [k, lv] of Object.entries(levels)) setSkillLevel(s, k, lv);
  }
  return f.cells.map((c, i) => c.searched - before[i]);
}

test('searchEfficiencyRange = efficiency +/- searchRandomness, clamped to 0..100', () => {
  const s = game(3);
  assert.deepEqual(searchEfficiencyRange(s, RAND), [25 - R, 25 + R]);
  assert.deepEqual(searchEfficiencyRange(s, CFG), [25, 25], 'randomness 0: a single value');
  assert.deepEqual(searchEfficiencyRange(s, cfgWith(RAND, { field: { searchEfficiency: 98 } })), [98 - R, 100]);
  assert.deepEqual(searchEfficiencyRange(s, cfgWith(RAND, { field: { searchEfficiency: 2 } })), [0, 2 + R]);
  // efficiency past 100 + r (huge bonuses): every roll is 100, so the range is [100, 100], never inverted
  assert.deepEqual(searchEfficiencyRange(s, cfgWith(RAND, { field: { searchEfficiency: 120 } })), [100, 100]);
});

test('each cell rolls its own search % within searchEfficiencyRange, and the rolls vary between cells', () => {
  const { s, f } = setup();
  const [lo, hi] = searchEfficiencyRange(s, RAND);
  const gained = sweep(s, f, RAND);
  for (const g of gained) assert.ok(g >= lo - EPS_PCT && g <= hi + EPS_PCT, `${g} outside [${lo}, ${hi}]`);
  assert.ok(new Set(gained).size > f.cells.length / 2, 'cells roll independently');
  assert.ok(Math.max(...gained) - Math.min(...gained) > (hi - lo) / 2, 'rolls spread over the range');
  const mean = gained.reduce((a, b) => a + b, 0) / gained.length;
  assert.ok(Math.abs(mean - searchEfficiency(s, RAND)) < R / 3, `mean ${mean} centred on the efficiency`);
  // a second search rolls again (not the same amount as the first time)
  const again = sweep(s, f, RAND);
  for (const g of again) assert.ok(g >= lo - EPS_PCT && g <= hi + EPS_PCT);
  assert.ok(again.some((g, i) => Math.abs(g - gained[i]) > EPS_PCT), 'fresh roll per search');
});

test('with searchRandomness 0 every cell gets exactly the efficiency', () => {
  const { s, f } = setup();
  const e = searchEfficiency(s, CFG);
  for (const g of sweep(s, f, CFG)) assert.equal(g, e);
});

test('efficiency bonuses shift the whole roll range', () => {
  const { s, f } = setup();
  const [lo0, hi0] = searchEfficiencyRange(s, RAND);
  addRing(s, 'searchEff', 'S', true); // +20%
  setSkillLevel(s, 'searchEff', 4); // +4%
  const e = searchEfficiency(s, RAND);
  assert.equal(e, 31); // 25 x 1.24
  const [lo, hi] = searchEfficiencyRange(s, RAND);
  assert.deepEqual([lo, hi], [e - R, e + R]);
  assert.equal(lo - lo0, 6);
  assert.equal(hi - hi0, 6);
  const gained = sweep(s, f, RAND);
  for (const g of gained) assert.ok(g >= lo - EPS_PCT && g <= hi + EPS_PCT, `${g} outside [${lo}, ${hi}]`);
  assert.ok(gained.some((g) => g > hi0), 'bonus reaches past the old maximum');
});

test('rolls near the limits are clamped: never below 0, never past 100', () => {
  const high = cfgWith(RAND, { field: { searchEfficiency: 98 } });
  const { s, f } = setup();
  sweep(s, f, high);
  for (const c of f.cells) assert.ok(c.searched >= 98 - R - EPS_PCT && c.searched <= 100);
  assert.ok(f.cells.some((c) => c.searched === 100), 'rolls of 100 or more finish the cell');
  const low = cfgWith(RAND, { field: { searchEfficiency: 2 } });
  const { s: s2, f: f2 } = setup(4);
  const gained = sweep(s2, f2, low);
  for (const g of gained) assert.ok(g >= 0 && g <= 2 + R + EPS_PCT, `${g}`);
});

test('with random rolls, items are still found exactly when the cell\'s searched % passes their depth', () => {
  const { s, f } = setup();
  const depths = Array.from({ length: 20 }, (_, i) => i * 5 + 0.5); // 0.5, 5.5, ... 95.5
  for (const c of area(3, 3)) f.cells[c] = cell(depths.map((d) => ({ t: 'ore:copper', d })));
  const r = search(s, 3, 3, RAND);
  assert.equal(r.ok, true, r.msg);
  let expected = 0;
  for (const c of area(3, 3)) {
    const cl = f.cells[c];
    expected += depths.filter((d) => d < cl.searched).length;
    for (const it of cl.items) assert.ok(it.d >= cl.searched, `item at ${it.d} should have been found (searched ${cl.searched})`);
    assert.equal(cl.items.length, depths.filter((d) => d >= cl.searched).length);
  }
  assert.equal(r.found.length, expected);
  assert.equal(f.pile.length, expected);
});

test('default config: every cell\'s roll stays within searchEfficiencyRange', () => {
  const s = game(3);
  const f = standInBlankField(s, 1);
  const [lo, hi] = searchEfficiencyRange(s);
  const gained = sweep(s, f, CONFIG);
  for (const g of gained) assert.ok(g >= lo - EPS_PCT && g <= hi + EPS_PCT, `${g} outside [${lo}, ${hi}]`);
  if (CONFIG.field.searchRandomness > 0) assert.ok(new Set(gained).size > 1, 'rolls vary');
});

test('spec: base search efficiency is in the 30-40% range, with some per-cell randomness', () => {
  assert.ok(CONFIG.field.searchEfficiency >= 30 && CONFIG.field.searchEfficiency <= 40);
  assert.ok(CONFIG.field.searchRandomness > 0);
});

// ------------------------------------------------- fresh cells (v1.2) ----
// A cell is "fresh" until a search works on it (clears debris or searches it); a 3x3 search costs
// freshCellMin extra minutes per fresh cell in its area. Pinned to 3 here (not the config's number) so the
// arithmetic below is unambiguous; searchMin is 30 (PIN).
const F = 3;
// searchTime skill 0 per level: the search XP these tests earn must not shave the times they check.
const FRESH = cfgWith(NO_REVEAL, { field: { freshCellMin: F }, skills: { activity: { searchTime: { perLevel: 0 } } } });
const WITH_SKILL = cfgWith(FRESH, { skills: { activity: { searchTime: { perLevel: 0.5 } } } });
const BASE = 30;

test('rollCell / generateField: new cells are untouched; legacy cells (no flag) are fresh only while unsearched', () => {
  const rng = seededRng(5);
  for (let i = 0; i < 50; i++) assert.equal(rollCell(rng, 1 + (i % 3)).touched, false);
  const f = generateField(seededRng(6), 2);
  for (const c of f.cells) {
    assert.equal(c.touched === undefined || c.touched === false, true);
    assert.equal(cellFresh(c), !c.boulder, 'every non-boulder cell of a new field is fresh');
  }
  // an older save: no touched flag at all
  const legacy = cell([], { searched: 0 });
  delete legacy.touched;
  assert.equal(cellFresh(legacy), true);
  legacy.searched = 0.5;
  assert.equal(cellFresh(legacy), false, 'any search progress means it was worked on');
});

test('cellFresh / freshCellCount: only open cells nobody has worked on count; edges are clipped', () => {
  const f = blankField(1, FRESH);
  assert.equal(freshCellCount(f, 4, 4, FRESH), 9);
  assert.equal(freshCellCount(f, 0, 0, FRESH), 4);
  assert.equal(freshCellCount(f, 7, 3, FRESH), 6);
  assert.equal(freshCellCount(f, 7, 7, FRESH), 4);
  assert.equal(freshCellCount(null, 4, 4, FRESH), 0, 'no field (at camp)');
  assert.equal(freshCellCount(f, 4, 4), 9, 'defaults to CONFIG');
  const c = (x, y) => f.cells[idx(x, y, FRESH)];
  c(3, 3).touched = true;
  assert.equal(freshCellCount(f, 4, 4, FRESH), 8, 'touched');
  c(4, 3).searched = 100;
  assert.equal(freshCellCount(f, 4, 4, FRESH), 7, 'fully searched (not open)');
  f.cells[idx(5, 3, FRESH)] = boulder();
  assert.equal(freshCellCount(f, 4, 4, FRESH), 6, 'a boulder is never fresh');
  f.cells[idx(3, 4, FRESH)] = cell([], { debris: 30 });
  assert.equal(freshCellCount(f, 4, 4, FRESH), 6, 'untouched debris cell is fresh');
  f.cells[idx(3, 4, FRESH)].touched = true;
  assert.equal(freshCellCount(f, 4, 4, FRESH), 5, 'debris cleared a bit but not searched: touched, not fresh');
  delete c(5, 4).touched;
  c(5, 4).searched = 25;
  assert.equal(freshCellCount(f, 4, 4, FRESH), 4, 'legacy cell with progress');
  assert.equal(freshCellCount(f, 4, 4, FRESH), areaCells(4, 4, FRESH).filter((i) => cellFresh(f.cells[i])).length);
});

test('searchMinutes: the base time, plus freshCellMin per fresh cell when the area is given', () => {
  const { s, f } = setup(3, FRESH);
  assert.equal(searchMinutes(s, FRESH), BASE, 'no area: the base time');
  assert.equal(searchMinutes(s, FRESH, 4, 4), BASE + F * 9);
  assert.equal(searchMinutes(s, FRESH, 0, 0), BASE + F * 4);
  assert.equal(searchMinutes(s, FRESH, 7, 7), BASE + F * 4);
  f.cells[idx(4, 4, FRESH)].touched = true;
  f.cells[idx(5, 5, FRESH)] = boulder();
  assert.equal(searchMinutes(s, FRESH, 4, 4), BASE + F * 7);
  assert.equal(searchMinutes(s, FRESH, 4, 4), BASE + F * freshCellCount(f, 4, 4, FRESH));
  // freshCellMin 0 or absent: always the base time
  assert.equal(searchMinutes(s, cfgWith(FRESH, { field: { freshCellMin: 0 } }), 4, 4), BASE);
  const absent = cfgWith(FRESH);
  delete absent.field.freshCellMin;
  assert.equal(searchMinutes(s, absent, 4, 4), BASE);
  // at camp there is no field: just the base time
  const camp = game(2);
  assert.equal(searchMinutes(camp, FRESH, 4, 4), BASE);
  // x and y are given together; a zero coordinate counts as given
  assert.equal(searchMinutes(s, FRESH, 0, 7), BASE + F * 4);
});

test('searchMinutes: search-time reductions (rings, skill, the cap) apply to the whole total, surcharge included', () => {
  const { s } = setup(3, WITH_SKILL);
  addRing(s, 'searchTime', 'S', true); // 10% (PIN)
  setSkillLevel(s, 'searchTime', 2); // +1%
  const total = BASE + F * 9; // 57
  assert.equal(smithBonuses(s, WITH_SKILL).searchTimePct, 11);
  assert.equal(searchMinutes(s, WITH_SKILL, 4, 4), round1(total * 0.89));
  assert.equal(searchMinutes(s, WITH_SKILL), round1(BASE * 0.89), 'no area: base only, still reduced');
  // capped reduction: 11% would apply, but at most 10%
  const capped = cfgWith(WITH_SKILL, { processing: { maxTimeReduction: 10 } });
  assert.equal(searchMinutes(s, capped, 4, 4), round1(total * 0.9));
  // and a search charges that reduced total
  const r = search(s, 4, 4, WITH_SKILL);
  assert.equal(r.minutes, round1(total * 0.89));
});

test('search charges the area\'s own time: fresh cells cost extra once, touched cells never again', () => {
  const { s, f } = setup(3, FRESH);
  const fresh = (x, y) => areaCells(x, y, FRESH).filter((i) => cellFresh(f.cells[i])).length;
  let t = s.time;
  // 1. a brand-new area: all 9 cells fresh
  const r1 = search(s, 4, 4, FRESH);
  assert.equal(r1.ok, true, r1.msg);
  assert.equal(r1.freshCells, 9);
  assert.equal(r1.minutes, BASE + F * 9);
  assert.equal(s.time, t + r1.minutes);
  assert.equal(s.skills.searchTime.xp, r1.minutes, 'search XP follows the minutes spent');
  for (const i of areaCells(4, 4, FRESH)) assert.equal(f.cells[i].touched, true);
  // 2. the same area again: nothing fresh
  t = s.time;
  const r2 = search(s, 4, 4, FRESH);
  assert.equal(r2.freshCells, 0);
  assert.equal(r2.minutes, BASE);
  assert.equal(s.time, t + BASE);
  // 3. overlapping area one column over: only the new column is fresh
  assert.equal(fresh(5, 4), 3);
  const r3 = search(s, 5, 4, FRESH);
  assert.equal(r3.freshCells, 3);
  assert.equal(r3.minutes, BASE + F * 3);
  // 4. a corner area has only 4 cells
  const r4 = search(s, 0, 0, FRESH);
  assert.equal(r4.freshCells, 4);
  assert.equal(r4.minutes, BASE + F * 4);
  // 5. an area nobody touched but cells elsewhere are untouched
  assert.equal(f.cells[idx(7, 7, FRESH)].touched, false);
  assert.equal(fresh(7, 7), 4);
});

test('touched: set by clearing debris (cell not yet searched) and by searching; not by skipping boulders or finished cells', () => {
  const { s, f } = setup(3, FRESH);
  const E = searchEfficiency(s, FRESH); // 25
  f.cells[idx(4, 4, FRESH)] = cell([], { debris: 3 * E }); // thick debris, only cleared a bit per search
  f.cells[idx(3, 3, FRESH)] = boulder();
  f.cells[idx(5, 5, FRESH)] = cell([], { searched: 100 });
  assert.equal(freshCellCount(f, 4, 4, FRESH), 9 - 2, 'boulder and finished cell are not fresh');
  const r = search(s, 4, 4, FRESH);
  assert.equal(r.minutes, BASE + F * 7);
  const c = (x, y) => f.cells[idx(x, y, FRESH)];
  assert.equal(c(4, 4).debris, 2 * E);
  assert.equal(c(4, 4).searched, 0, 'only debris was cleared');
  assert.equal(c(4, 4).touched, true, 'clearing debris counts as working on the cell');
  assert.equal(c(3, 3).touched, false, 'boulder untouched');
  assert.equal(c(5, 5).touched, false, 'finished cell untouched');
  assert.equal(freshCellCount(f, 4, 4, FRESH), 0);
  assert.equal(search(s, 4, 4, FRESH).minutes, BASE, 'the second search of the area has no surcharge');
});

test('fresh surcharge: the whole time (incl. surcharge) must fit before the day ends', () => {
  const { s, f } = setup(3, FRESH);
  const back = returnMinutes(s, s.location, 0, FRESH);
  s.time = DAY_END - BASE - back; // exactly enough for a search without a surcharge
  assert.equal(fitsWithReturn(s, BASE, FRESH), true);
  const t = s.time;
  const r = search(s, 4, 4, FRESH);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Not enough time/);
  assert.equal(s.time, t, 'a refused search costs nothing');
  assert.ok(f.cells.every((c) => !c.touched && c.searched === 0), 'and does not touch the cells');
  // the same area once it has been worked on (no surcharge) fits exactly
  for (const i of areaCells(4, 4, FRESH)) f.cells[i].touched = true;
  const ok = search(s, 4, 4, FRESH);
  assert.equal(ok.ok, true, ok.msg);
  assert.equal(ok.minutes, BASE);
  assert.equal(s.time, DAY_END - back);
});

test('every cell pays the surcharge exactly once, however the searches overlap; the minutes always match the fresh count', () => {
  const { s, f } = setup(5, FRESH);
  const rng = seededRng(99);
  let freshTotal = 0;
  let searches = 0;
  while (fieldProgress(f) < 100 && searches < 500) {
    s.time = DAY_START; // time is not what this test is about
    const x = rng.int(0, 7);
    const y = rng.int(0, 7);
    const before = freshCellCount(f, x, y, FRESH);
    const r = search(s, x, y, FRESH);
    searches++;
    if (!r.ok) continue; // nothing left in that area
    assert.equal(r.freshCells, before);
    assert.equal(r.minutes, BASE + F * before);
    freshTotal += r.freshCells;
  }
  assert.equal(fieldProgress(f), 100);
  assert.equal(freshTotal, FRESH.field.size ** 2, 'all 64 cells were charged once');
  assert.ok(f.cells.every((c) => c.touched));
});

test('touched is saved with the game: a reloaded game does not charge for the same cells again', () => {
  const { s, f } = setup(3, FRESH);
  search(s, 4, 4, FRESH);
  s.time = DAY_START;
  const back = deserialize(serialize(s));
  const g = currentField(back);
  assert.deepEqual(g, f);
  assert.equal(freshCellCount(g, 4, 4, FRESH), 0);
  assert.equal(search(back, 4, 4, FRESH).minutes, BASE);
  assert.equal(search(back, 4, 5, FRESH).freshCells, 3);
});
