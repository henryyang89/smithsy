import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  generateMap, generateField, pathSteps, mapCell, key, travelMinutes, returnMinutes, travel, atCamp, timeLeft,
} from '../js/core/map.js';
import { game, cfgWith, customMap, addRing, setSkillLevel, DAY_END, DAY_START, fieldAt } from './helpers.mjs';

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
    assert.deepEqual(map.camp, { x: 2, y: 2 });
    assert.equal(mapCell(map, 2, 2).type, 'camp');
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
  for (const c of map.cells) if (c.type === 'field') assert.equal(c.dist, Math.abs(c.x - 2) + Math.abs(c.y - 2));
});

test('mapCell returns null outside the map', () => {
  const map = generateMap(seededRng(1));
  assert.equal(mapCell(map, -1, 0), null);
  assert.equal(mapCell(map, 0, 5), null);
  assert.equal(mapCell(map, 5, 5), null);
});

test('generateField: valid items, depth 0..100, 1-3 items per loot cell, no mythril next to camp', () => {
  const rng = seededRng(11);
  for (let i = 0; i < 60; i++) {
    const dist = 1 + (i % 4);
    const f = generateField(rng, dist);
    assert.equal(f.dist, dist);
    for (const c of f.cells) {
      assert.equal(c.searched, 0);
      assert.equal(c.revealed, false);
      assert.deepEqual(c.ground, []);
      assert.ok(c.items.length <= 3);
      for (const it of c.items) {
        const [kind, type] = it.t.split(':');
        assert.ok(kind === 'ore' ? ORES.includes(type) : kind === 'gem' && GEMS.includes(type), it.t);
        assert.ok(it.d >= 0 && it.d < 100);
        if (dist === 1) assert.notEqual(it.t, 'ore:mythril');
      }
    }
  }
});

test('generateField: farther fields and debris cells hold more items on average', () => {
  const rng = seededRng(12);
  const stat = (dist) => {
    let cells = 0; let loot = 0; let dCells = 0; let dLoot = 0;
    for (let i = 0; i < 300; i++) {
      for (const c of generateField(rng, dist).cells) {
        if (c.debris) { dCells++; if (c.items.length) dLoot++; } else { cells++; if (c.items.length) loot++; }
      }
    }
    return { clear: loot / cells, debris: dLoot / dCells, debrisShare: dCells / (cells + dCells) };
  };
  const near = stat(1);
  const far = stat(4);
  assert.ok(Math.abs(near.clear - 0.40) < 0.02, `dist1 loot ${near.clear}`);
  assert.ok(Math.abs(far.clear - 0.55) < 0.02, `dist4 loot ${far.clear}`);
  assert.ok(Math.abs(near.debris - 0.60) < 0.03, `debris loot ${near.debris}`);
  assert.ok(Math.abs(near.debrisShare - 0.15) < 0.01, `debris share ${near.debrisShare}`);
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

test('travelMinutes = steps x 20 min (no load, no bonuses)', () => {
  const s = travelState();
  const camp = s.map.camp;
  assert.equal(travelMinutes(s, camp, { x: 2, y: 3 }, 0), 20);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 0 }, 0), 120); // 6 steps around the wall
  assert.equal(travelMinutes(s, { x: 0, y: 0 }, { x: 4, y: 0 }, 0), 80);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 1 }, 0), Infinity);
});

test('travelMinutes: +1% per bag item', () => {
  const s = travelState();
  const camp = s.map.camp;
  assert.equal(travelMinutes(s, camp, { x: 2, y: 3 }, 10), 22);
  assert.equal(travelMinutes(s, { x: 2, y: 0 }, camp, 20), 144);
  assert.equal(returnMinutes(s, { x: 2, y: 4 }, 5), 42);
});

test('travelMinutes: travel ring applies everywhere, return skill only when going to camp', () => {
  const s = travelState();
  const camp = s.map.camp;
  addRing(s, 'travelTime', 'S', true); // 10%
  setSkillLevel(s, 'returnTravel', 4); // 4 x 0.5 = 2%
  // out to a field: only the ring
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0), 36); // 40 x 0.9
  // field to field: only the ring
  assert.equal(travelMinutes(s, { x: 0, y: 0 }, { x: 4, y: 0 }, 0), 72);
  // back to camp: ring + skill = 12%
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, camp, 0), 35.2); // 40 x 0.88
  // with load: 40 x 1.1 x 0.88 = 38.72 -> 38.7
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, camp, 10), 38.7);
});

test('travelMinutes: unworn rings do not count; duplicate rings stack 1 / 0.5', () => {
  const s = travelState();
  const camp = s.map.camp;
  addRing(s, 'travelTime', 'S', false);
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0), 40);
  addRing(s, 'travelTime', 'S', true);
  addRing(s, 'travelTime', 'S', true); // 10 + 5 = 15%
  assert.equal(travelMinutes(s, camp, { x: 2, y: 4 }, 0), 34);
});

test('travelMinutes: time reductions are capped at 75%', () => {
  const cfg = cfgWith({ skills: { activity: { returnTravel: { perLevel: 20 } } } });
  const s = travelState();
  setSkillLevel(s, 'returnTravel', 10); // 200% -> capped at 75%
  assert.equal(travelMinutes(s, { x: 2, y: 4 }, s.map.camp, 0, cfg), 10);
});

// ------------------------------------------------------------------- travel --
test('travel to a field spends the travel time and moves the smith', () => {
  const s = travelState();
  const r = travel(s, { x: 2, y: 4 });
  assert.equal(r.ok, true, r.msg);
  assert.equal(r.minutes, 40);
  assert.equal(s.time, DAY_START + 40);
  assert.deepEqual(s.location, { x: 2, y: 4 });
  assert.equal(atCamp(s), false);
  // field to field
  const r2 = travel(s, { x: 4, y: 4 });
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
  const r = travel(s, { x: 2, y: 4 });
  assert.equal(r.ok, false);
  assert.match(r.msg, /Not enough time/);
  assert.deepEqual(s.location, s.map.camp);
  s.time = DAY_END - 80;
  assert.equal(travel(s, { x: 2, y: 4 }).ok, true, 'exactly enough time is allowed');
  assert.equal(s.time, DAY_END - 40);
});

test('field-to-field travel checks the way back from the destination (with current load)', () => {
  const s = travelState();
  s.location = { x: 2, y: 3 }; // dist 1
  s.bag = Array(10).fill('ore:copper');
  // to (2,4): 22 there + 44 back from (2,4) = 66
  s.time = DAY_END - 65;
  assert.equal(travel(s, { x: 2, y: 4 }).ok, false);
  s.time = DAY_END - 66;
  assert.equal(travel(s, { x: 2, y: 4 }).ok, true);
});

test('returning to camp is always allowed, even if it ends after 18:00', () => {
  const s = travelState();
  s.location = { x: 2, y: 0 }; // 6 steps = 120 min
  s.time = DAY_END - 10;
  const r = travel(s, s.map.camp);
  assert.equal(r.ok, true, r.msg);
  assert.equal(s.time, DAY_END + 110);
  assert.equal(atCamp(s), true);
  assert.equal(timeLeft(s), -110);
});

test('arriving at camp unloads the bag into storage and grants return-travel XP', () => {
  const s = travelState();
  s.location = { x: 2, y: 4 };
  s.bag = ['ore:copper', 'ore:copper', 'ore:mythril', 'gem:ruby', 'gem:diamond'];
  const r = travel(s, s.map.camp);
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
  assert.equal(travel(s, { x: 2, y: 4 }).ok, true);
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
