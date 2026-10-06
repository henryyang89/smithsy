import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import {
  search, clearDebris, pickUp, dropItem, fieldProgress, areaCells, searchMinutes, searchEfficiency,
  debrisMinutesPerCell, returnMinutes, currentField,
} from '../js/core/map.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { game, cfgWith, cell, idx, standInBlankField, addRing, setSkillLevel, DAY_END, DAY_START } from './helpers.mjs';

const NO_REVEAL = cfgWith({ intel: { tracks: { oreSight: { base: 0 } } } });
const ALL_REVEAL = cfgWith({ intel: { tracks: { oreSight: { base: 100 } } } });

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
  assert.equal(searchEfficiency(s), 25);
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

test('search costs 30 minutes and gives search XP; overlapping searches only search unfinished cells', () => {
  const { s, f } = setup();
  assert.equal(searchMinutes(s), CONFIG.field.searchMin);
  const r = search(s, 2, 2, NO_REVEAL);
  assert.equal(r.minutes, 30);
  assert.equal(s.time, DAY_START + 30);
  assert.equal(s.skills.searchTime.xp, 30);
  assert.equal(s.skills.searchEff.xp, 30);
  // finish (2,2) area, then search (3,2): 3 cells new, 6 already done -> those stay at 100
  for (let i = 0; i < 3; i++) search(s, 2, 2, NO_REVEAL);
  // 4 searches = 120 XP -> Search efficiency level 1 (+1%)
  assert.equal(s.skills.searchEff.level, 1);
  assert.equal(searchEfficiency(s), 25.25);
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
  assert.equal(searchMinutes(s), 26.7); // 30 x 0.89
  assert.equal(searchEfficiency(s), 31); // 25 x 1.24
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
  assert.equal(debrisMinutesPerCell(s), 15);
  const r = clearDebris(s, 0, 0);
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
  assert.equal(clearDebris(s, 0, 0).ok, false, 'no debris left there');
});

test('debris skill reduces clearing time', () => {
  const { s, f } = setup();
  setSkillLevel(s, 'debris', 5); // 10%
  f.cells[idx(3, 3)].debris = true;
  f.cells[idx(4, 4)].debris = true;
  assert.equal(debrisMinutesPerCell(s), 13.5);
  assert.equal(clearDebris(s, 3, 3).minutes, 27);
});

test('search / clear require time to walk back by 18:00 at the current load', () => {
  const { s, f } = setup();
  const back = returnMinutes(s);
  assert.equal(back, 20);
  s.time = DAY_END - 30 - back + 0.5;
  assert.equal(search(s, 2, 2, NO_REVEAL).ok, false);
  s.bag = Array(10).fill('ore:copper'); // 22 min back
  s.time = DAY_END - 30 - 22;
  assert.equal(search(s, 2, 2, NO_REVEAL).ok, true, 'exact fit allowed');
  f.cells[idx(6, 6)].debris = true;
  assert.equal(clearDebris(s, 6, 6).ok, false);
  s.time = DAY_END - 15 - 22;
  assert.equal(clearDebris(s, 6, 6).ok, true);
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

test('ore sight 0% never reveals, 100% reveals every searched (non-debris) cell', () => {
  const { s, f } = setup();
  assert.equal(smithBonuses(s, NO_REVEAL).revealPct, 0);
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
  addRing(s, 'reveal', 'S', true); // +7
  s.intel.spent.oreSight = 2; // +10 +9
  assert.equal(smithBonuses(s).revealPct, 10 + 7 + 19);
  // statistical check at 36%
  let cells = 0;
  let revealed = 0;
  for (let k = 0; k < 40; k++) {
    const f = standInBlankField(s, 1);
    s.time = DAY_START;
    for (const [x, y] of [[1, 1], [4, 1], [1, 4], [4, 4], [1, 7]]) search(s, x, y); // disjoint areas
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
