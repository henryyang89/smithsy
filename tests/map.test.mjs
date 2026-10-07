import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS } from '../js/config.js';
import { seededRng, makeRng } from '../js/core/rng.js';
import {
  generateMap, generateField, pathSteps, mapCell, key, travelMinutes, returnMinutes, travel, atCamp, timeLeft,
  rollCell, regrowFields, boulderCell, fieldProgress,
} from '../js/core/map.js';
import { game, cfgWith, customMap, addRing, setSkillLevel, DAY_END, DAY_START, fieldAt } from './helpers.mjs';

// Pinned travel numbers: the hand-computed minutes below hold whatever CONFIG says.
const TRAVEL = cfgWith({
  map: { travelMinPerStep: 20, loadPenaltyPerItem: 1 },
  processing: { maxTimeReduction: 75 },
  rings: { duplicateFactor: 0.5, types: { travelTime: { values: [5, 6, 7, 8, 10] } } },
  skills: { xpBase: 100, activity: { returnTravel: { perLevel: 0.5 } } },
});

// Independent BFS for cross-checking.
function bfs(map, from) {
  const dist = new Map([[key(from.x, from.y), 0]]);
  const q = [from];
  while (q.length) {
    const p = q.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = p.x + dx;
      const ny = p.y + dy;
      const c = mapCell(map, nx, ny);
      if (!c || c.type === 'blocked' || dist.has(key(nx, ny))) continue;
      dist.set(key(nx, ny), dist.get(key(p.x, p.y)) + 1);
      q.push({ x: nx, y: ny });
    }
  }
  return dist;
}

// --------------------------------------------------------------- generation --
test('generateMap: camp in the center, exact blocked count, every field reachable, dist = BFS steps', () => {
  for (let seed = 1; seed <= 60; seed++) {
    const map = generateMap(seededRng(seed));
    const n = CONFIG.map.size;
    assert.equal(map.size, n);
    assert.equal(map.cells.length, n * n);
    const c = Math.floor(n / 2);
    assert.deepEqual(map.camp, { x: c, y: c });
    assert.equal(mapCell(map, c, c).type, 'camp');
    const blocked = map.cells.filter((c) => c.type === 'blocked');
    const fields = map.cells.filter((c) => c.type === 'field');
    assert.equal(blocked.length, CONFIG.map.blockedCells);
    assert.equal(fields.length, n * n - 1 - CONFIG.map.blockedCells);
    const ref = bfs(map, map.camp);
    for (const f of fields) {
      assert.ok(ref.has(key(f.x, f.y)), `field ${f.x},${f.y} unreachable (seed ${seed})`);
      assert.equal(f.dist, ref.get(key(f.x, f.y)));
      assert.equal(f.dist, pathSteps(map, map.camp, f));
      assert.ok(f.dist >= 1);
      assert.ok(map.fields[key(f.x, f.y)], 'field contents missing');
      assert.equal(map.fields[key(f.x, f.y)].dist, f.dist);
      assert.equal(map.fields[key(f.x, f.y)].cells.length, CONFIG.field.size ** 2);
      assert.equal(map.fields[key(f.x, f.y)].cells.filter((c) => c.boulder).length, CONFIG.field.boulders, 'boulders per field');
      assert.deepEqual(map.fields[key(f.x, f.y)].pile, [], 'every field starts with an empty pile');
    }
    assert.equal(Object.keys(map.fields).length, fields.length, 'only fields have contents');
    // cells are stored row-major and know their coordinates
    for (const c of map.cells) assert.equal(mapCell(map, c.x, c.y), c);
  }
});

test('generateMap is deterministic for a seed', () => {
  assert.deepEqual(generateMap(seededRng(77)), generateMap(seededRng(77)));
  assert.notDeepEqual(generateMap(seededRng(77)), generateMap(seededRng(78)));
});

test('generateMap with no blocked cells: dist = Manhattan distance', () => {
  const cfg = cfgWith({ map: { blockedCells: 0 } });
  const map = generateMap(seededRng(5), cfg);
  for (const c of map.cells) if (c.type === 'field') assert.equal(c.dist, Math.abs(c.x - map.camp.x) + Math.abs(c.y - map.camp.y));
});

test('mapCell returns null outside the map', () => {
  const map = generateMap(seededRng(1));
  assert.equal(mapCell(map, -1, 0), null);
  assert.equal(mapCell(map, 0, 5), null);
  assert.equal(mapCell(map, 5, 5), null);
});

// Ore/gem weight row and loot chance used for a field at distance d (rows past the table reuse the last one).
const weightRow = (rows, d) => rows[Math.max(0, Math.min(d, rows.length) - 1)];
const lootPct = (d, debris, cfg = CONFIG) => {
  const L = cfg.field.lootChance;
  return Math.min(100, Math.min(L.max, L.base + L.perDistance * (d - 1)) + (debris ? cfg.field.debrisLootBonus : 0));
};

test('generateField: valid items, depth 0..100, item count from itemCountWeights, zero-weight types never appear', () => {
  const rng = seededRng(11);
  const maxItems = Math.max(...Object.keys(CONFIG.field.itemCountWeights).map(Number));
  for (let i = 0; i < 60; i++) {
    const dist = 1 + (i % 5);
    const f = generateField(rng, dist);
    assert.equal(f.dist, dist);
    assert.equal(f.cells.length, CONFIG.field.size ** 2);
    const oreW = weightRow(CONFIG.field.oreWeights, dist);
    const gemW = weightRow(CONFIG.field.gemWeights, dist);
    assert.deepEqual(f.pile, []);
    for (const c of f.cells) {
      assert.equal(c.searched, 0);
      assert.equal(c.revealed, false);
      assert.equal('ground' in c, false, 'no per-cell ground items any more');
      assert.equal(typeof c.debris, 'number');
      assert.equal(typeof c.boulder, 'boolean');
      assert.ok(c.items.length <= maxItems);
      for (const it of c.items) {
        const [kind, type] = it.t.split(':');
        assert.ok(kind === 'ore' ? ORES.includes(type) : kind === 'gem' && GEMS.includes(type), it.t);
        assert.ok((kind === 'ore' ? oreW : gemW)[type] > 0, `${it.t} has weight 0 at distance ${dist}`);
        assert.ok(it.d >= 0 && it.d < 100);
      }
    }
  }
});

test('generateField with pinned weights: no mythril next to camp, distance picks the weight row', () => {
  const cfg = cfgWith({ field: { oreShare: 100, lootChance: { base: 100, perDistance: 0, max: 100 }, oreWeights: [{ copper: 1, iron: 0, coal: 0, mythril: 0 }, { copper: 0, iron: 0, coal: 0, mythril: 1 }] } });
  const rng = seededRng(13);
  const types = (d) => new Set(generateField(rng, d, cfg).cells.flatMap((c) => c.items.map((it) => it.t)));
  assert.deepEqual([...types(1)], ['ore:copper']);
  assert.deepEqual([...types(2)], ['ore:mythril']);
  assert.deepEqual([...types(6)], ['ore:mythril'], 'farther fields reuse the last row');
});

test('generateField: farther fields and debris cells hold more items on average', () => {
  const rng = seededRng(12);
  const stat = (dist) => {
    let cells = 0; let loot = 0; let dCells = 0; let dLoot = 0;
    for (let i = 0; i < 300; i++) {
      for (const c of generateField(rng, dist).cells) {
        if (c.boulder) continue;
        if (c.debris > 0) { dCells++; if (c.items.length) dLoot++; } else { cells++; if (c.items.length) loot++; }
      }
    }
    return { clear: loot / cells, debris: dLoot / dCells, debrisShare: dCells / (cells + dCells) };
  };
  const near = stat(1);
  const far = stat(4);
  assert.ok(Math.abs(near.clear - lootPct(1, false) / 100) < 0.02, `dist1 loot ${near.clear}`);
  assert.ok(Math.abs(far.clear - lootPct(4, false) / 100) < 0.02, `dist4 loot ${far.clear}`);
  assert.ok(Math.abs(near.debris - lootPct(1, true) / 100) < 0.03, `debris loot ${near.debris}`);
  assert.ok(Math.abs(near.debrisShare - CONFIG.field.debrisChance / 100) < 0.01, `debris share ${near.debrisShare}`);
  // the rule itself: farther fields and debris cells are at least as rich
  assert.ok(lootPct(4, false) >= lootPct(1, false));
  assert.ok(lootPct(1, true) >= lootPct(1, false));
});

test('debris: a debris cell gets a whole-number thickness within debrisAmount; clear cells have 0', () => {
  const { min, max } = CONFIG.field.debrisAmount;
  assert.ok(min > 0 && max >= min);
  const rng = seededRng(14);
  const seen = new Set();
  let debris = 0;
  let total = 0;
  for (let i = 0; i < 200; i++) {
    for (const c of generateField(rng, 1 + (i % 4)).cells) {
      if (c.boulder) continue;
      total++;
      if (c.debris === 0) continue;
      debris++;
      assert.ok(Number.isInteger(c.debris), `${c.debris}`);
      assert.ok(c.debris >= min && c.debris <= max, `${c.debris} outside [${min}, ${max}]`);
      seen.add(c.debris);
    }
  }
  assert.ok(Math.abs(debris / total - CONFIG.field.debrisChance / 100) < 0.01, `debris share ${debris / total}`);
  assert.ok(seen.has(min) && seen.has(max), 'both ends of the range occur');
  // pinned range: every thickness lands in it
  const cfg = cfgWith({ field: { debrisChance: 100, debrisAmount: { min: 7, max: 9 } } });
  const cells = generateField(seededRng(3), 2, cfg).cells.filter((c) => !c.boulder);
  assert.deepEqual([...new Set(cells.map((c) => c.debris))].sort(), [7, 8, 9]);
  assert.ok(generateField(seededRng(3), 2, cfgWith({ field: { debrisChance: 0 } })).cells.every((c) => c.debris === 0));
});

test('boulders: exactly CONFIG.field.boulders per field, at random spots, with no items and no debris', () => {
  const rng = seededRng(15);
  const spots = new Set();
  for (let i = 0; i < 100; i++) {
    const f = generateField(rng, 1 + (i % 4));
    const b = f.cells.map((c, k) => (c.boulder ? k : -1)).filter((k) => k >= 0);
    assert.equal(b.length, CONFIG.field.boulders);
    for (const k of b) {
      spots.add(k);
      assert.deepEqual(f.cells[k], boulderCell());
      assert.deepEqual(f.cells[k].items, []);
      assert.equal(f.cells[k].debris, 0);
      assert.equal(f.cells[k].searched, 0);
    }
    for (const c of f.cells) if (!c.boulder) assert.equal(c.boulder, false);
  }
  if (CONFIG.field.boulders > 0) assert.ok(spots.size > 20, 'boulders are placed randomly');
  // the count is a config number (capped at the field size)
  for (const n of [0, 3]) {
    const f = generateField(seededRng(2), 2, cfgWith({ field: { boulders: n } }));
    assert.equal(f.cells.filter((c) => c.boulder).length, n);
  }
  const size = CONFIG.field.size ** 2;
  assert.equal(generateField(seededRng(2), 2, cfgWith({ field: { boulders: size + 5 } })).cells.filter((c) => c.boulder).length, size);
  assert.ok(Number.isInteger(CONFIG.field.boulders) && CONFIG.field.boulders >= 1, 'spec: every field has a boulder');
});

test('boulders are excluded from fieldProgress', () => {
  const f = generateField(seededRng(16), 1, cfgWith({ field: { boulders: 2 } }));
  for (const c of f.cells) if (!c.boulder) c.searched = 50;
  assert.equal(fieldProgress(f), 50);
  for (const c of f.cells) if (!c.boulder) c.searched = 100;
  assert.equal(fieldProgress(f), 100);
});

test('every gem type is equally likely at every distance', () => {
  for (const row of CONFIG.field.gemWeights) {
    assert.deepEqual(Object.keys(row).sort(), [...GEMS].sort());
    const w = Object.values(row);
    assert.ok(w[0] > 0);
    assert.ok(w.every((x) => x === w[0]), JSON.stringify(row));
  }
  // in generated fields, at several distances
  const cfg = cfgWith({ field: { oreShare: 0, lootChance: { base: 100, perDistance: 0, max: 100 } } });
  const rng = seededRng(17);
  for (const dist of [1, 2, 4, 6]) {
    const counts = Object.fromEntries(GEMS.map((g) => [g, 0]));
    let n = 0;
    for (let i = 0; i < 40; i++) {
      for (const c of generateField(rng, dist, cfg).cells) {
        for (const it of c.items) {
          counts[it.t.split(':')[1]]++;
          n++;
        }
      }
    }
    for (const g of GEMS) assert.ok(Math.abs(counts[g] / n - 1 / GEMS.length) < 0.02, `${g} at distance ${dist}: ${counts[g] / n}`);
  }
});

// ---------------------------------------------------------------- pathSteps --
test('pathSteps walks around blocked cells', () => {
  // wall above the camp: (1,1) (2,1) (3,1)
  const map = customMap([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }]);
  const camp = map.camp;
  assert.equal(pathSteps(map, camp, camp), 0);
  assert.equal(pathSteps(map, camp, { x: 2, y: 3 }), 1);
  assert.equal(pathSteps(map, camp, { x: 2, y: 0 }), 6); // around the wall, not 2
  assert.equal(pathSteps(map, camp, { x: 0, y: 1 }), 3);
  assert.equal(pathSteps(map, { x: 2, y: 0 }, camp), 6, 'symmetric');
  assert.equal(pathSteps(map, camp, { x: 2, y: 1 }), Infinity, 'cannot step onto a blocked cell');
  assert.equal(mapCell(map, 2, 0).dist, 6);
});

test('pathSteps returns Infinity for a walled-off cell', () => {
  const map = customMap([{ x: 1, y: 0 }, { x: 0, y: 1 }]);
  assert.equal(pathSteps(map, map.camp, { x: 0, y: 0 }), Infinity);
});

// ------------------------------------------------------------ travelMinutes --
function travelState(blocked = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }]) {
  const s = game(1);
  s.map = customMap(blocked);
  s.location = { ...s.map.camp };
  return s;
}

test('travelMinutes defaults: steps x travelMinPerStep', () => {
  const s = travelState();
  const camp = s.map.camp;
  assert.equal(travelMinutes(s, camp, { x: 2, y: 3 }, 0), CONFIG.map.travelMinPerStep);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 0 }, 0), 6 * CONFIG.map.travelMinPerStep);
});

test('travelMinutes = steps x 20 min (no load, no bonuses)', () => {
  const s = travelState();
  const camp = s.map.camp;
  assert.equal(travelMinutes(s, camp, { x: 2, y: 3 }, 0, TRAVEL), 20);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 0 }, 0, TRAVEL), 120); // 6 steps around the wall
  assert.equal(travelMinutes(s, { x: 0, y: 0 }, { x: 4, y: 0 }, 0, TRAVEL), 80);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 1 }, 0, TRAVEL), Infinity);
});

test('travelMinutes: +1% per bag item', () => {
  const s = travelState();
  const camp = s.map.camp;
  assert.equal(travelMinutes(s, camp, { x: 2, y: 3 }, 10, TRAVEL), 22);
  assert.equal(travelMinutes(s, { x: 2, y: 0 }, camp, 20, TRAVEL), 144);
  assert.equal(returnMinutes(s, { x: 2, y: 4 }, 5, TRAVEL), 42);
});

test('travelMinutes: travel ring applies everywhere, return skill only when going to camp', () => {
  const s = travelState();
  const camp = s.map.camp;
  addRing(s, 'travelTime', 'S', true); // 10%
  setSkillLevel(s, 'returnTravel', 4); // 4 x 0.5 = 2%
  // out to a field: only the ring
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0, TRAVEL), 36); // 40 x 0.9
  // field to field: only the ring
  assert.equal(travelMinutes(s, { x: 0, y: 0 }, { x: 4, y: 0 }, 0, TRAVEL), 72);
  // back to camp: ring + skill = 12%
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, camp, 0, TRAVEL), 35.2); // 40 x 0.88
  // with load: 40 x 1.1 x 0.88 = 38.72 -> 38.7
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, camp, 10, TRAVEL), 38.7);
});

test('travelMinutes: unworn rings do not count; duplicate rings stack 1 / 0.5', () => {
  const s = travelState();
  const camp = s.map.camp;
  addRing(s, 'travelTime', 'S', false);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0, TRAVEL), 40);
  addRing(s, 'travelTime', 'S', true);
  addRing(s, 'travelTime', 'S', true); // 10 + 5 = 15%
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0, TRAVEL), 34);
});

test('travelMinutes: time reductions are capped at maxTimeReduction', () => {
  const cfg = cfgWith(TRAVEL, { skills: { activity: { returnTravel: { perLevel: 20 } } } });
  const s = travelState();
  setSkillLevel(s, 'returnTravel', 10); // 200% -> capped at 75%
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, s.map.camp, 0, cfg), 10);
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, s.map.camp, 0, cfgWith(cfg, { processing: { maxTimeReduction: 50 } })), 20);
});

// ------------------------------------------------------------------- travel --
test('travel to a field spends the travel time and moves the smith', () => {
  const s = travelState();
  const r = travel(s, { x: 2, y: 4 }, TRAVEL);
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, 40);
  assert.equal(s.time, DAY_START + 40);
  assert.deepEqual(s.location, { x: 2, y: 4 });
  assert.equal(atCamp(s), false);
  // field to field
  const r2 = travel(s, { x: 4, y: 4 }, TRAVEL);
  assert.equal(r2.ok, true, r2.msg);
  assert.equal(s.time, DAY_START + 80);
});

test('travel refuses blocked cells, off-map cells and the current cell', () => {
  const s = travelState();
  assert.equal(travel(s, { x: 2, y: 1 }).ok, false);
  assert.equal(travel(s, { x: 5, y: 2 }).ok, false);
  assert.equal(travel(s, { x: -1, y: 2 }).ok, false);
  assert.equal(travel(s, { x: 2, y: 2 }).ok, false);
  assert.equal(s.time, DAY_START);
  assert.deepEqual(s.location, s.map.camp);
});

test('travel refuses outside the work phase', () => {
  const s = travelState();
  s.phase = 'plan';
  assert.equal(travel(s, { x: 2, y: 3 }).ok, false);
});

test('cannot leave for a field without time to walk back by 18:00', () => {
  const s = travelState();
  // (2,4): 40 there + 40 back = 80
  s.time = DAY_END - 79;
  const r = travel(s, { x: 2, y: 4 }, TRAVEL);
  assert.equal(r.ok, false);
  assert.match(r.msg, /Not enough time/);
  assert.deepEqual(s.location, s.map.camp);
  s.time = DAY_END - 80;
  assert.equal(travel(s, { x: 2, y: 4 }, TRAVEL).ok, true, 'exactly enough time is allowed');
  assert.equal(s.time, DAY_END - 40);
});

test('field-to-field travel checks the way back from the destination (with current load)', () => {
  const s = travelState();
  s.location = { x: 2, y: 3 }; // dist 1
  s.bag = Array(10).fill('ore:copper');
  // to (2,4): 22 there + 44 back from (2,4) = 66
  s.time = DAY_END - 65;
  assert.equal(travel(s, { x: 2, y: 4 }, TRAVEL).ok, false);
  s.time = DAY_END - 66;
  assert.equal(travel(s, { x: 2, y: 4 }, TRAVEL).ok, true);
});

test('returning to camp is always allowed, even if it ends after 18:00', () => {
  const s = travelState();
  s.location = { x: 2, y: 0 }; // 6 steps = 120 min
  s.time = DAY_END - 10;
  const r = travel(s, s.map.camp, TRAVEL);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.time, DAY_END + 110);
  assert.equal(atCamp(s), true);
  assert.equal(timeLeft(s), -110);
});

test('arriving at camp unloads the bag into storage and grants return-travel XP', () => {
  const s = travelState();
  s.location = { x: 2, y: 4 };
  s.bag = ['ore:copper', 'ore:copper', 'ore:mythril', 'gem:ruby', 'gem:diamond'];
  const r = travel(s, s.map.camp, TRAVEL);
  assert.equal(r.ok, true);
  assert.match(r.msg, /Unloaded 5 items/);
  assert.deepEqual(s.bag, []);
  assert.equal(s.storage.ore.copper, 2);
  assert.equal(s.storage.ore.mythril, 1);
  assert.equal(s.storage.gem.ruby, 1);
  assert.equal(s.storage.gem.diamond, 1);
  assert.equal(r.minutes, 42); // 40 x 1.05
  assert.equal(s.skills.returnTravel.xp, 42);
  assert.equal(s.skills.returnTravel.level, 0);
});

test('travelling out does not unload or grant return XP', () => {
  const s = travelState();
  s.location = { x: 2, y: 3 };
  s.bag = ['ore:iron'];
  assert.equal(travel(s, { x: 2, y: 4 }, TRAVEL).ok, true);
  assert.deepEqual(s.bag, ['ore:iron']);
  assert.equal(s.storage.ore.iron, 0);
  assert.equal(s.skills.returnTravel.xp, 0);
});

test('travel works on a generated map: every field can be reached on day 1 from camp', () => {
  const s = game(99);
  for (const c of s.map.cells.filter((x) => x.type === 'field')) {
    s.location = { ...s.map.camp };
    s.time = DAY_START;
    const r = travel(s, { x: c.x, y: c.y });
    assert.equal(r.ok, true, `field ${c.x},${c.y}: ${r.msg}`);
    assert.equal(r.minutes, c.dist * CONFIG.map.travelMinPerStep);
  }
  assert.ok(fieldAt(s, 1));
});

// ----------------------------------------------------------------- regrowth --
// A game whose fields have a mix of searched / unsearched cells (boulders untouched), with a pile in each.
function regrowState(seed = 3) {
  const s = game(seed);
  const rng = seededRng(seed + 100);
  for (const f of Object.values(s.map.fields)) {
    f.cells.forEach((c, i) => {
      if (c.boulder) return;
      if (i % 3 === 0) { c.searched = 100; c.items = []; c.revealed = rng.chance(50); c.debris = 0; }
      else if (i % 3 === 1) { c.searched = rng.float(1, 99); c.debris = 0; }
    });
    f.pile = ['ore:copper', 'gem:ruby'];
  }
  return s;
}
const searchedCount = (s) => Object.values(s.map.fields).reduce((a, f) => a + f.cells.filter((c) => c.searched > 0).length, 0);

test('regrowFields at 0% does nothing (and uses no randomness)', () => {
  const s = regrowState();
  const before = structuredClone(s.map);
  const holder = { s: 42 };
  assert.equal(regrowFields(s, makeRng(holder), cfgWith({ field: { regrowPctPerDay: 0 } })), 0);
  assert.deepEqual(s.map, before);
  assert.equal(holder.s, 42);
});

test('regrowFields at 100% resets every searched cell, keeps the pile and boulders, leaves unsearched cells alone', () => {
  const s = regrowState();
  const before = structuredClone(s.map.fields);
  const n0 = searchedCount(s);
  assert.ok(n0 > 0);
  const n = regrowFields(s, seededRng(9), cfgWith({ field: { regrowPctPerDay: 100 } }));
  assert.equal(n, n0, 'returns the number of regrown cells');
  assert.equal(searchedCount(s), 0, 'every searched cell is fresh');
  for (const [k, f] of Object.entries(s.map.fields)) {
    assert.equal(f.dist, before[k].dist);
    assert.deepEqual(f.pile, before[k].pile, 'the pile stays');
    f.cells.forEach((c, i) => {
      const old = before[k].cells[i];
      if (old.boulder) assert.deepEqual(c, old, 'boulders never regrow');
      if (old.searched > 0) {
        assert.equal(c.boulder, false);
        assert.equal(c.searched, 0);
        assert.equal(c.revealed, false);
        assert.ok(Array.isArray(c.items));
        for (const it of c.items) assert.ok(it.d >= 0 && it.d < 100);
      } else {
        assert.deepEqual(c, old, 'unsearched cell untouched');
      }
    });
  }
});

test('regrowFields: a regrown cell is a fresh roll for its field\'s distance', () => {
  // replay: per searched cell the regrowth uses one chance roll, then rollCell(rng, field.dist)
  const cfg = cfgWith({ field: { regrowPctPerDay: 100 } });
  const s = regrowState(5);
  const before = structuredClone(s.map.fields);
  regrowFields(s, seededRng(77), cfg);
  const replay = seededRng(77);
  for (const [k, f] of Object.entries(before)) {
    f.cells.forEach((old, i) => {
      if (old.searched <= 0) return;
      replay.next(); // the regrowth chance roll
      assert.deepEqual(s.map.fields[k].cells[i], rollCell(replay, f.dist, cfg));
    });
  }
  // semantic check: with distance-specific ore tables, regrown cells follow their field's distance
  const pinned = cfgWith({ field: { regrowPctPerDay: 100, debrisChance: 0, oreShare: 100, lootChance: { base: 100, perDistance: 0, max: 100 }, oreWeights: [{ copper: 1, iron: 0, coal: 0, mythril: 0 }, { copper: 0, iron: 0, coal: 0, mythril: 1 }] } });
  const s2 = regrowState(6);
  const before2 = structuredClone(s2.map.fields);
  regrowFields(s2, seededRng(1), pinned);
  assert.ok(new Set(Object.values(s2.map.fields).map((f) => f.dist)).size > 1, 'fields at several distances');
  for (const [k, f] of Object.entries(s2.map.fields)) {
    f.cells.forEach((c, i) => {
      if (before2[k].cells[i].searched <= 0) return;
      assert.ok(c.items.length > 0, 'loot chance 100%');
      for (const it of c.items) assert.equal(it.t, f.dist === 1 ? 'ore:copper' : 'ore:mythril');
    });
  }
});

test('regrowFields skips boulders, even one marked as searched (hand-edited save)', () => {
  const s = regrowState(4);
  const spots = [];
  for (const [k, f] of Object.entries(s.map.fields)) {
    f.cells.forEach((c, i) => {
      if (c.boulder) {
        c.searched = 100;
        spots.push([k, i]);
      }
    });
  }
  assert.equal(spots.length, Object.keys(s.map.fields).length * CONFIG.field.boulders);
  const n0 = searchedCount(s);
  const n = regrowFields(s, seededRng(5), cfgWith({ field: { regrowPctPerDay: 100 } }));
  assert.equal(n, n0 - spots.length, 'boulders are not counted as regrown');
  for (const [k, i] of spots) {
    assert.equal(s.map.fields[k].cells[i].boulder, true);
    assert.equal(s.map.fields[k].cells[i].searched, 100);
  }
});

test('regrowFields: about regrowPctPerDay % of searched cells regrow each night', () => {
  const s = regrowState(7);
  const n0 = searchedCount(s);
  const n = regrowFields(s, seededRng(3), cfgWith({ field: { regrowPctPerDay: 30 } }));
  assert.ok(Math.abs(n / n0 - 0.3) < 0.05, `${n}/${n0}`);
  assert.equal(searchedCount(s), n0 - n);
  // the configured default is a sane percentage
  assert.ok(CONFIG.field.regrowPctPerDay >= 0 && CONFIG.field.regrowPctPerDay <= 100);
});
