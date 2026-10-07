import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import {
  search, clearDebris, pickUp, dropItem, fieldProgress, areaCells, searchMinutes, searchEfficiency,
  searchEfficiencyRange, debrisMinutesPerCell, returnMinutes, currentField,
} from '../js/core/map.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { intelChance } from '../js/core/intel.js';
import { game, cfgWith, cell, idx, standInBlankField, addRing, setSkillLevel, ringVal, DAY_END, DAY_START } from './helpers.mjs';

// Pinned field numbers: the hand-computed times/percentages below hold whatever CONFIG says.
// searchRandomness 0: every cell gets exactly the efficiency, so exact search depths can be checked
// (the per-cell roll has its own tests below).
const PIN = {
  field: { searchMin: 30, searchEfficiency: 25, searchRandomness: 0, debrisClearMin: 15 },
  map: { travelMinPerStep: 20, loadPenaltyPerItem: 1 },
  processing: { maxTimeReduction: 75 },
  skills: { xpBase: 100, maxLevel: 10, activity: { searchTime: { perLevel: 0.5 }, searchEff: { perLevel: 1 }, debris: { perLevel: 2 }, returnTravel: { perLevel: 0.5 } } },
  rings: { duplicateFactor: 0.5, types: { searchTime: { values: [5, 6, 7, 8, 10] }, searchEff: { values: [10, 12, 14, 16, 20] }, reveal: { values: [3, 4, 5, 6, 7] }, travelTime: { values: [5, 6, 7, 8, 10] } } },
  intel: { gainsPerPoint: [10, 9, 8, 7, 6, 5, 4, 3, 2], minGain: 1, maxChance: 100, tracks: { oreSight: { base: 10 } } },
};
const CFG = cfgWith(PIN);
const NO_REVEAL = cfgWith(PIN, { intel: { tracks: { oreSight: { base: 0 } } } });
const ALL_REVEAL = cfgWith(PIN, { intel: { tracks: { oreSight: { base: 100 } } } });

function setup(seed = 3) {
  const s = game(seed);
  const f = standInBlankField(s, 1);
  return { s, f };
}

test('areaCells: 3x3 clipped to the field', () => {
  assert.equal(areaCells(4, 4).length, 9);
  assert.deepEqual(areaCells(0, 0).sort((a, b) => a - b), [0, 1, 8, 9]);
  assert.equal(areaCells(7, 3).length, 6);
  assert.equal(areaCells(7, 7).length, 4);
  assert.deepEqual(areaCells(1, 1).sort((a, b) => a - b), [0, 1, 2, 8, 9, 10, 16, 17, 18]);
});

test('items are found exactly when the searched % passes their depth', () => {
  const { s, f } = setup();
  f.cells[idx(1, 1)] = cell([{ t: 'ore:copper', d: 10 }, { t: 'ore:iron', d: 25 }, { t: 'gem:ruby', d: 60 }, { t: 'ore:coal', d: 99.5 }]);
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
    assert.equal(f.cells[idx(1, 1)].searched, st.searched);
  }
  assert.deepEqual(s.bag, ['ore:copper', 'ore:iron', 'gem:ruby', 'ore:coal']);
  assert.deepEqual(f.cells[idx(1, 1)].items, []);
});

test('a search that completes a cell finds everything left in it', () => {
  const { s, f } = setup();
  f.cells[idx(4, 4)] = cell([{ t: 'ore:mythril', d: 99.999 }, { t: 'gem:diamond', d: 95 }], { searched: 90 });
  const r = search(s, 4, 4, NO_REVEAL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.found.sort(), ['gem:diamond', 'ore:mythril']);
  assert.equal(f.cells[idx(4, 4)].searched, 100);
});

test('efficiency 25 -> 4 searches fully search an area; a 5th is refused', () => {
  const { s, f } = setup();
  assert.equal(searchEfficiency(s, NO_REVEAL), 25);
  for (let i = 1; i <= 4; i++) {
    assert.equal(search(s, 3, 3, NO_REVEAL).ok, true);
    for (const c of areaCells(3, 3)) assert.equal(f.cells[c].searched, Math.min(100, 25 * i));
  }
  const t = s.time;
  const r = search(s, 3, 3, NO_REVEAL);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Nothing left/);
  assert.equal(s.time, t, 'refused search costs no time');
});

test('search time / efficiency default to CONFIG with no bonuses', () => {
  const { s } = setup();
  assert.equal(searchMinutes(s), CONFIG.field.searchMin);
  assert.equal(searchEfficiency(s), CONFIG.field.searchEfficiency);
  const { searchEfficiency: E, searchRandomness: R } = CONFIG.field;
  assert.deepEqual(searchEfficiencyRange(s), [Math.max(0, E - R), Math.min(100, E + R)]);
  assert.equal(debrisMinutesPerCell(s), CONFIG.field.debrisClearMin);
});

test('search costs 30 minutes and gives search XP; overlapping searches only search unfinished cells', () => {
  const { s, f } = setup();
  assert.equal(searchMinutes(s, NO_REVEAL), 30);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.minutes, 30);
  assert.equal(s.time, DAY_START + 30);
  assert.equal(s.skills.searchTime.xp, 30);
  assert.equal(s.skills.searchEff.xp, 30);
  // finish (2,2) area, then search (3,2): 3 cells new, 6 already done -> those stay at 100
  for (let i = 0; i < 3; i++) search(s, 2, 2, NO_REVEAL);
  // 4 searches = 120 XP -> Search efficiency level 1 (+1%)
  assert.equal(s.skills.searchEff.level, 1);
  assert.equal(searchEfficiency(s, NO_REVEAL), 25.25);
  const r2 = search(s, 3, 2, NO_REVEAL);
  assert.equal(r2.ok, true);
  assert.match(r2.msg, /Searched 3 cells/);
  assert.equal(f.cells[idx(4, 2)].searched, 25.25);
  assert.equal(f.cells[idx(3, 2)].searched, 100);
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
  assert.equal(f.cells[idx(4, 4)].searched, 31);
  assert.equal(s.time, DAY_START + 26.7);
});

test('debris cells are skipped by a search and keep their items', () => {
  const { s, f } = setup();
  f.cells[idx(2, 2)] = cell([{ t: 'ore:iron', d: 1 }], { debris: true });
  f.cells[idx(1, 1)] = cell([{ t: 'ore:copper', d: 1 }]);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.ok, true);
  assert.deepEqual(r.found, ['ore:copper']);
  assert.match(r.msg, /1 cell\(s\) skipped/);
  assert.equal(f.cells[idx(2, 2)].searched, 0);
  assert.equal(f.cells[idx(2, 2)].items.length, 1);
  assert.equal(f.cells[idx(1, 1)].searched, 25);
});

test('an area fully covered by debris cannot be searched', () => {
  const { s, f } = setup();
  for (const c of areaCells(0, 0)) f.cells[c].debris = true;
  const r = search(s, 0, 0, NO_REVEAL);
  assert.equal(r.ok, false);
  assert.equal(s.time, DAY_START);
});

test('clearDebris clears every debris cell in the 3x3 area (15 min each) and grants XP', () => {
  const { s, f } = setup();
  for (const c of [idx(0, 0), idx(1, 0), idx(1, 1), idx(5, 5)]) f.cells[c].debris = true;
  f.cells[idx(1, 1)].items = [{ t: 'gem:topaz', d: 5 }];
  assert.equal(debrisMinutesPerCell(s, CFG), 15);
  const r = clearDebris(s, 0, 0, CFG);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, 45);
  assert.equal(s.time, DAY_START + 45);
  assert.equal(f.cells[idx(0, 0)].debris, false);
  assert.equal(f.cells[idx(1, 1)].debris, false);
  assert.equal(f.cells[idx(5, 5)].debris, true, 'outside the area');
  assert.equal(s.skills.debris.xp, 45);
  assert.equal(f.cells[idx(1, 1)].searched, 0, 'clearing does not search');
  const r2 = search(s, 0, 0, NO_REVEAL);
  assert.deepEqual(r2.found, ['gem:topaz']);
  assert.equal(clearDebris(s, 0, 0, CFG).ok, false, 'no debris left there');
});

test('debris skill reduces clearing time', () => {
  const { s, f } = setup();
  setSkillLevel(s, 'debris', 5); // 10%
  f.cells[idx(3, 3)].debris = true;
  f.cells[idx(4, 4)].debris = true;
  assert.equal(debrisMinutesPerCell(s, CFG), 13.5);
  assert.equal(clearDebris(s, 3, 3, CFG).minutes, 27);
});

test('search / clear require time to walk back by 18:00 at the current load', () => {
  const { s, f } = setup();
  const back = returnMinutes(s, s.location, s.bag.length, CFG);
  assert.equal(back, 20);
  s.time = DAY_END - 30 - back + 0.5;
  assert.equal(search(s, 2, 2, NO_REVEAL).ok, false);
  s.bag = Array(10).fill('ore:copper'); // 22 min back
  s.time = DAY_END - 30 - 22;
  assert.equal(search(s, 2, 2, NO_REVEAL).ok, true, 'exact fit allowed');
  f.cells[idx(6, 6)].debris = true;
  assert.equal(clearDebris(s, 6, 6, CFG).ok, false);
  s.time = DAY_END - 15 - 22;
  assert.equal(clearDebris(s, 6, 6, CFG).ok, true);
});

test('search / clear are refused at camp and outside the work phase', () => {
  const s = game(3);
  assert.equal(currentField(s), null);
  assert.equal(search(s, 1, 1).ok, false);
  assert.equal(clearDebris(s, 1, 1).ok, false);
  standInBlankField(s, 1);
  s.phase = 'report';
  assert.equal(search(s, 1, 1).ok, false);
  assert.equal(clearDebris(s, 1, 1).ok, false);
});

test('bag overflow: found items beyond 20 slots stay on the ground', () => {
  const { s, f } = setup();
  s.bag = Array(CONFIG.bag.slots - 1).fill('ore:copper');
  f.cells[idx(2, 2)] = cell([{ t: 'gem:ruby', d: 1 }, { t: 'gem:topaz', d: 2 }, { t: 'ore:iron', d: 3 }]);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.ok, true);
  assert.equal(s.bag.length, CONFIG.bag.slots);
  assert.deepEqual(r.found, ['gem:ruby']);
  assert.deepEqual(r.toGround, ['gem:topaz', 'ore:iron']);
  assert.deepEqual(f.cells[idx(2, 2)].ground, ['gem:topaz', 'ore:iron']);
  assert.deepEqual(f.cells[idx(2, 2)].items, []);
  assert.match(r.msg, /found 3 item/);
  assert.match(r.msg, /2 left on the ground/);
});

test('pickUp takes as many ground items as fit; dropItem puts a bag item on the ground', () => {
  const { s, f } = setup();
  const c = idx(2, 2);
  f.cells[c].ground = ['gem:topaz', 'ore:iron', 'ore:coal'];
  s.bag = Array(CONFIG.bag.slots).fill('ore:copper');
  assert.equal(pickUp(s, c).ok, false, 'bag full');
  // drop two coppers onto another cell
  assert.equal(dropItem(s, 0, idx(5, 5)).ok, true);
  assert.equal(dropItem(s, 0, idx(5, 5)).ok, true);
  assert.equal(s.bag.length, CONFIG.bag.slots - 2);
  assert.deepEqual(f.cells[idx(5, 5)].ground, ['ore:copper', 'ore:copper']);
  const r = pickUp(s, c);
  assert.equal(r.ok, true);
  assert.match(r.msg, /Picked up 2/);
  assert.deepEqual(f.cells[c].ground, ['ore:coal']);
  assert.deepEqual(s.bag.slice(-2), ['gem:topaz', 'ore:iron']);
  assert.equal(pickUp(s, idx(7, 7)).ok, false, 'nothing there');
  assert.equal(dropItem(s, 99, 0).ok, false, 'no such bag item');
  assert.equal(dropItem(s, -1, 0).ok, false);
  // drop removes exactly the chosen item
  s.bag = ['ore:copper', 'gem:ruby', 'ore:iron'];
  dropItem(s, 1, 0);
  assert.deepEqual(s.bag, ['ore:copper', 'ore:iron']);
  assert.deepEqual(f.cells[0].ground, ['gem:ruby']);
});

test('pickUp / dropItem at camp are refused', () => {
  const s = game(3);
  s.bag = ['ore:copper'];
  assert.equal(pickUp(s, 0).ok, false);
  assert.equal(dropItem(s, 0, 0).ok, false);
  assert.deepEqual(s.bag, ['ore:copper']);
});

test('pickUp / dropItem are refused outside the work phase (nothing moves)', () => {
  const { s, f } = setup();
  f.cells[3].ground = ['gem:ruby'];
  s.bag = ['ore:copper'];
  for (const phase of ['report', 'plan', 'over']) {
    s.phase = phase;
    const p = pickUp(s, 3);
    assert.equal(p.ok, false, phase);
    assert.match(p.msg, /work day/);
    const d = dropItem(s, 0, 5);
    assert.equal(d.ok, false, phase);
    assert.match(d.msg, /work day/);
    assert.deepEqual(s.bag, ['ore:copper']);
    assert.deepEqual(f.cells[3].ground, ['gem:ruby']);
    assert.deepEqual(f.cells[5].ground, []);
  }
  s.phase = 'work';
  assert.equal(pickUp(s, 3).ok, true);
  assert.equal(dropItem(s, 0, 5).ok, true);
});

test('ore sight 0% never reveals, 100% reveals every searched (non-debris) cell', () => {
  const { s, f } = setup();
  assert.equal(smithBonuses(s, NO_REVEAL).revealPct, 0);
  assert.equal(smithBonuses(s, ALL_REVEAL).revealPct, 100);
  for (let i = 0; i < 4; i++) search(s, 2, 2, NO_REVEAL);
  assert.equal(f.cells.filter((c) => c.revealed).length, 0);

  const { s: s2, f: f2 } = setup(4);
  f2.cells[idx(5, 5)].debris = true;
  const r = search(s2, 5, 5, ALL_REVEAL);
  assert.equal(r.revealed, 8);
  for (const c of areaCells(5, 5)) assert.equal(f2.cells[c].revealed, c !== idx(5, 5));
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
    const f = standInBlankField(s, 1);
    s.time = DAY_START;
    for (const [x, y] of [[1, 1], [4, 1], [1, 4], [4, 4], [1, 7]]) search(s, x, y, CFG); // disjoint areas
    cells += f.cells.filter((c) => c.searched > 0).length;
    revealed += f.cells.filter((c) => c.revealed).length;
  }
  assert.ok(Math.abs(revealed / cells - 0.36) < 0.05, `revealed ${revealed / cells}`);
});

test('fieldProgress = average searched % over all 64 cells', () => {
  const { s, f } = setup();
  assert.equal(fieldProgress(f), 0);
  search(s, 2, 2, NO_REVEAL);
  assert.equal(fieldProgress(f), (9 * 25) / 64);
  search(s, 0, 0, NO_REVEAL); // 4 cells, 1 overlapping (1,1)
  assert.equal(fieldProgress(f), (8 * 25 + 50 + 3 * 25) / 64);
  for (const c of f.cells) c.searched = 100;
  assert.equal(fieldProgress(f), 100);
});

test('searching a generated field: every item ends up in the bag or on the ground after a full sweep', () => {
  const s = game(21);
  const fieldCell = s.map.cells.find((c) => c.type === 'field' && c.dist === 1);
  s.location = { x: fieldCell.x, y: fieldCell.y };
  const f = currentField(s);
  for (const c of f.cells) c.debris = false;
  const total = f.cells.reduce((a, c) => a + c.items.length, 0);
  const centers = [1, 4, 6].flatMap((y) => [1, 4, 6].map((x) => [x, y]));
  let got = 0;
  for (let pass = 0; pass < 4; pass++) {
    for (const [x, y] of centers) {
      s.time = DAY_START; // ignore the clock for this sweep
      const r = search(s, x, y, NO_REVEAL);
      if (r.ok) got += r.found.length + r.toGround.length;
    }
  }
  assert.equal(fieldProgress(f), 100);
  assert.equal(got, total);
  assert.equal(f.cells.reduce((a, c) => a + c.items.length, 0), 0);
  assert.equal(s.bag.length + f.cells.reduce((a, c) => a + c.ground.length, 0), total);
});

// ------------------------------------------------------ search randomness ----
// Each cell rolls its own efficiency per search: eff + uniform(-r, +r), clamped to 0..100.
const R = 5;
const RAND = cfgWith(PIN, { field: { searchRandomness: R } }, { intel: { tracks: { oreSight: { base: 0 } } } });
// Nine disjoint 3x3 areas that together cover the whole 8x8 field.
const TILES = [1, 4, 7].flatMap((y) => [1, 4, 7].map((x) => [x, y]));
const EPS_PCT = 1e-9;

// Search every tile once and return the per-cell searched % gained. The clock is reset so time never
// runs out, and the search skills are held at their level (searching gives XP, which would otherwise
// raise the efficiency part-way through the sweep).
function sweep(s, f, cfg) {
  const before = f.cells.map((c) => c.searched);
  const levels = { searchEff: s.skills.searchEff.level, searchTime: s.skills.searchTime.level };
  for (const [x, y] of TILES) {
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
  for (const c of areaCells(3, 3)) f.cells[c] = cell(depths.map((d) => ({ t: 'ore:copper', d })));
  s.bag = [];
  const r = search(s, 3, 3, cfgWith(RAND, { bag: { slots: 1000 } }));
  assert.equal(r.ok, true, r.msg);
  let expected = 0;
  for (const c of areaCells(3, 3)) {
    const cl = f.cells[c];
    expected += depths.filter((d) => d < cl.searched).length;
    for (const it of cl.items) assert.ok(it.d >= cl.searched, `item at ${it.d} should have been found (searched ${cl.searched})`);
    assert.equal(cl.items.length, depths.filter((d) => d >= cl.searched).length);
  }
  assert.equal(r.found.length, expected);
});

test('default config: every cell\'s roll stays within searchEfficiencyRange', () => {
  const { s, f } = setup();
  const [lo, hi] = searchEfficiencyRange(s);
  const gained = sweep(s, f, CONFIG);
  for (const g of gained) assert.ok(g >= lo - EPS_PCT && g <= hi + EPS_PCT, `${g} outside [${lo}, ${hi}]`);
  if (CONFIG.field.searchRandomness > 0) assert.ok(new Set(gained).size > 1, 'rolls vary');
});

test('spec: base search efficiency is in the 30-40% range, with some per-cell randomness', () => {
  assert.ok(CONFIG.field.searchEfficiency >= 30 && CONFIG.field.searchEfficiency <= 40);
  assert.ok(CONFIG.field.searchRandomness > 0);
});
