import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, ORES, GEMS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  generateMap, generateField, pathSteps, mapCell, key, travelMinutes, returnMinutes, travel, atCamp, timeLeft,
  rollSight, boulderCell, fieldProgress, distanceRow, sightRange,
} from '../js/core/map.js';
import { game, cfgWith, customMap, addRing, setSkillLevel, DAY_END, DAY_START, fieldAt } from './helpers.mjs';

// Pinned travel numbers: the hand-computed minutes below hold whatever CONFIG says.
const TRAVEL = cfgWith({
  map: { travelMinPerStep: 20, loadPenaltyPerItem: 1 },
  processing: { maxTimeReduction: 75 },
  rings: { duplicateFactor: 0.5, types: { travelTime: { values: [5, 6, 7, 8, 10] } } },
  skills: { xpBase: 100, activity: { returnTravel: { perLevel: 0.5 } } },
});

// The hand-built maps below are 5x5 (camp at 2,2) whatever the game's map size is: the travel maths does not
// depend on the size, and the coordinates stay easy to read.
const SMALL = cfgWith({ map: { size: 5 } });

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
test('generateMap: camp in the center, exact blocked count, every field reachable, dist = BFS steps, detour <= maxDetour', () => {
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
      const straight = Math.abs(f.x - map.camp.x) + Math.abs(f.y - map.camp.y);
      assert.ok(f.dist - straight <= CONFIG.map.maxDetour, `field ${f.x},${f.y}: ${f.dist} steps vs ${straight} straight (seed ${seed})`);
      assert.ok(map.fields[key(f.x, f.y)], 'field contents missing');
      assert.equal(map.fields[key(f.x, f.y)].dist, f.dist);
      assert.equal(map.fields[key(f.x, f.y)].cells.length, CONFIG.field.size ** 2);
      assert.equal(map.fields[key(f.x, f.y)].cells.filter((c) => c.boulder).length, distanceRow(f.dist).boulders, 'boulders per field = the distance row');
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

test('generateMap with maxDetour 0: rocks may never lengthen a walk, so dist = Manhattan distance', () => {
  const cfg = cfgWith({ map: { maxDetour: 0 } });
  for (let seed = 1; seed <= 25; seed++) {
    const map = generateMap(seededRng(seed), cfg);
    assert.equal(map.cells.filter((c) => c.type === 'blocked').length, cfg.map.blockedCells);
    for (const c of map.cells) if (c.type === 'field') assert.equal(c.dist, Math.abs(c.x - map.camp.x) + Math.abs(c.y - map.camp.y), `seed ${seed}`);
  }
});

test('generateMap: a looser maxDetour allows longer detours than a strict one (the rule really filters maps)', () => {
  const worst = (cfg, seeds) => {
    let w = 0;
    for (const seed of seeds) {
      const map = generateMap(seededRng(seed), cfg);
      for (const c of map.cells) if (c.type === 'field') w = Math.max(w, c.dist - (Math.abs(c.x - map.camp.x) + Math.abs(c.y - map.camp.y)));
    }
    return w;
  };
  const seeds = Array.from({ length: 80 }, (_, i) => i + 1);
  assert.ok(worst(cfgWith({ map: { maxDetour: 99 } }), seeds) > CONFIG.map.maxDetour, 'unfiltered maps do have long detours');
  assert.ok(worst(CONFIG, seeds) <= CONFIG.map.maxDetour);
});

test('generateMap gives up with an error when no map can satisfy the rules', () => {
  // a detour can never be shorter than 0, so a limit of -1 rejects every attempt
  assert.throws(() => generateMap(seededRng(1), cfgWith({ map: { maxDetour: -1 } })), /Could not generate/);
});

test('mapCell returns null outside the map', () => {
  const map = generateMap(seededRng(1));
  const n = CONFIG.map.size;
  assert.equal(mapCell(map, -1, 0), null);
  assert.equal(mapCell(map, 0, n), null);
  assert.equal(mapCell(map, n, n), null);
  assert.ok(mapCell(map, n - 1, n - 1));
});

// ------------------------------------------------------------ distanceRow --
test('distanceRow: row 1 is distance 1; farther fields reuse the last row', () => {
  const rows = CONFIG.field.byDistance;
  assert.ok(rows.length >= 2);
  rows.forEach((r, i) => assert.equal(distanceRow(i + 1), r, `distance ${i + 1}`));
  for (const d of [rows.length + 1, rows.length + 2, 20]) assert.equal(distanceRow(d), rows[rows.length - 1], `distance ${d}`);
  assert.equal(distanceRow(0), rows[0], 'never below the first row');
  const cfg = cfgWith({ field: { byDistance: [{ loot: 1, boulders: 1, gemShare: 1, ores: { copper: 1 } }, { loot: 2, boulders: 2, gemShare: 2, ores: { copper: 1 } }] } });
  assert.equal(distanceRow(1, cfg).loot, 1);
  assert.equal(distanceRow(2, cfg).loot, 2);
  assert.equal(distanceRow(9, cfg).loot, 2);
});

test('config: boulders never decrease with distance and the gem share rises with it (the requested end points are pinned in spec-guards)', () => {
  const rows = CONFIG.field.byDistance;
  const b = rows.map((r) => r.boulders);
  assert.ok(b.every((v) => Number.isInteger(v) && v >= 0), 'whole, non-negative boulder counts');
  b.forEach((v, i) => i && assert.ok(v >= b[i - 1], 'boulders never decrease with distance'));
  assert.ok(b[b.length - 1] > b[0], 'and farther fields have more');
  const g = rows.map((r) => r.gemShare);
  g.forEach((v, i) => i && assert.ok(v > g[i - 1], 'gem share rises with distance'));
  assert.ok(g.every((v) => v > 0 && v < 100), 'a share, so a percentage between 0 and 100');
});

test('generateField: valid items, depth 0..100, item count from itemCountWeights, zero-weight types never appear', () => {
  const rng = seededRng(11);
  const maxItems = Math.max(...Object.keys(CONFIG.field.itemCountWeights).map(Number));
  for (let i = 0; i < 60; i++) {
    const dist = 1 + (i % 5);
    const f = generateField(rng, dist);
    assert.equal(f.dist, dist);
    assert.equal(f.cells.length, CONFIG.field.size ** 2);
    const oreW = distanceRow(dist).ores;
    const gemW = CONFIG.field.gemWeights;
    assert.deepEqual(f.pile, []);
    for (const c of f.cells) {
      assert.equal(c.searched, 0);
      assert.equal('revealed' in c, false, 'cells no longer have a revealed flag (sight replaced it)');
      assert.equal('ground' in c, false, 'no per-cell ground items any more');
      assert.equal(typeof c.debris, 'number');
      assert.equal(typeof c.boulder, 'boolean');
      assert.ok(c.items.length <= maxItems);
      for (const it of c.items) {
        const [kind, type] = it.t.split(':');
        assert.ok(kind === 'ore' ? ORES.includes(type) : kind === 'gem' && GEMS.includes(type), it.t);
        assert.ok((kind === 'ore' ? oreW : gemW)[type] > 0, `${it.t} has weight 0 at distance ${dist}`);
        assert.ok(it.d >= 0 && it.d <= 100);
        assert.ok(Math.abs(it.d * 10 - Math.round(it.d * 10)) < 1e-6, `depth ${it.d} has more than one decimal`);
        assert.ok(Number.isInteger(it.s), `sight threshold ${it.s} is a whole number`);
        const [lo, hi] = sightRange(it.t);
        assert.ok(it.s > lo && it.s <= hi, `${it.t}: sight threshold ${it.s} outside (${lo}, ${hi}]`);
      }
    }
  }
});

test('every item has a sight threshold in (lo, hi] for its type (every gem shares the gem range); rarer ores roll higher', () => {
  const S = CONFIG.field.sight;
  for (const ore of ORES) assert.ok(S[ore], `sight range for ${ore}`);
  assert.ok(S.gem);
  for (const [k, [lo, hi]] of Object.entries(S)) assert.ok(Number.isInteger(lo) && Number.isInteger(hi) && hi > lo && lo >= 0 && hi <= 100, k);
  assert.ok(S.copper[1] < S.mythril[1] && S.copper[0] < S.mythril[0], 'mythril thresholds are higher than copper');
  // rollSight itself, for every type, hits both ends of (lo, hi]
  const rng = seededRng(21);
  for (const t of [...ORES.map((o) => `ore:${o}`), ...GEMS.map((g) => `gem:${g}`)]) {
    const [lo, hi] = sightRange(t);
    const seen = new Set();
    for (let i = 0; i < 4000; i++) {
      const v = rollSight(rng, t);
      assert.ok(Number.isInteger(v) && v > lo && v <= hi, `${t}: ${v}`);
      seen.add(v);
    }
    assert.ok(seen.has(lo + 1) && seen.has(hi), `${t}: both ends of the range occur`);
  }
  // sight ranges are config numbers
  const cfg = cfgWith({ field: { sight: { copper: [10, 12] } } });
  const v = new Set(Array.from({ length: 200 }, () => rollSight(rng, 'ore:copper', cfg)));
  assert.deepEqual([...v].sort(), [11, 12]);
});

test('generateField with pinned rows: no mythril next to camp, distance picks the row', () => {
  const cfg = cfgWith({ field: { byDistance: [
    { loot: 100, boulders: 0, gemShare: 0, ores: { copper: 1, iron: 0, coal: 0, mythril: 0 } },
    { loot: 100, boulders: 0, gemShare: 0, ores: { copper: 0, iron: 0, coal: 0, mythril: 1 } },
  ] } });
  const rng = seededRng(13);
  const types = (d) => new Set(generateField(rng, d, cfg).cells.flatMap((c) => c.items.map((it) => it.t)));
  assert.deepEqual([...types(1)], ['ore:copper']);
  assert.deepEqual([...types(2)], ['ore:mythril']);
  assert.deepEqual([...types(6)], ['ore:mythril'], 'farther fields reuse the last row');
});

// Loot chance of a cell at distance d: the distance row's `loot`, plus the debris bonus under debris.
const lootPct = (d, debris, cfg = CONFIG) => Math.min(100, distanceRow(d, cfg).loot + (debris ? cfg.field.debrisLootBonus : 0));

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

test('boulders: exactly the distance row\'s count per field, at random spots, with no items and no debris', () => {
  const rng = seededRng(15);
  const spots = new Set();
  for (let i = 0; i < 100; i++) {
    const dist = 1 + (i % (CONFIG.field.byDistance.length + 1)); // the last distance uses the last row
    const f = generateField(rng, dist);
    const b = f.cells.map((c, k) => (c.boulder ? k : -1)).filter((k) => k >= 0);
    assert.equal(b.length, distanceRow(dist).boulders, `distance ${dist}`);
    for (const k of b) {
      spots.add(k);
      assert.deepEqual(f.cells[k], boulderCell());
      assert.deepEqual(f.cells[k].items, []);
      assert.equal(f.cells[k].debris, 0);
      assert.equal(f.cells[k].searched, 0);
    }
    for (const c of f.cells) if (!c.boulder) assert.equal(c.boulder, false);
  }
  assert.ok(spots.size > 20, 'boulders are placed randomly');
  // the count is a config number per row (capped at the field size)
  const rows = (n) => ({ field: { byDistance: [{ loot: 50, boulders: n, gemShare: 10, ores: { copper: 1 } }] } });
  for (const n of [0, 3]) {
    const f = generateField(seededRng(2), 2, cfgWith(rows(n)));
    assert.equal(f.cells.filter((c) => c.boulder).length, n);
  }
  const size = CONFIG.field.size ** 2;
  assert.equal(generateField(seededRng(2), 2, cfgWith(rows(size + 5))).cells.filter((c) => c.boulder).length, size);
});

test('boulders are excluded from fieldProgress', () => {
  const f = generateField(seededRng(16), 1);
  assert.ok(f.cells.some((c) => c.boulder));
  for (const c of f.cells) if (!c.boulder) c.searched = 50;
  assert.equal(fieldProgress(f), 50);
  for (const c of f.cells) if (!c.boulder) c.searched = 100;
  assert.equal(fieldProgress(f), 100);
});

test('every gem type is equally likely at every distance', () => {
  const row = CONFIG.field.gemWeights;
  assert.deepEqual(Object.keys(row).sort(), [...GEMS].sort());
  const w = Object.values(row);
  assert.ok(w[0] > 0);
  assert.ok(w.every((x) => x === w[0]), JSON.stringify(row));
  // in generated fields (every item a gem), at several distances
  const cfg = cfgWith({ field: { byDistance: CONFIG.field.byDistance.map((r) => ({ ...r, loot: 100, gemShare: 100 })) } });
  const rng = seededRng(17);
  for (const dist of [1, 2, 4, 6]) {
    const counts = Object.fromEntries(GEMS.map((g) => [g, 0]));
    let n = 0;
    for (let i = 0; i < 40; i++) {
      for (const c of generateField(rng, dist, cfg).cells) {
        for (const it of c.items) {
          assert.equal(it.t.split(':')[0], 'gem');
          counts[it.t.split(':')[1]]++;
          n++;
        }
      }
    }
    for (const g of GEMS) assert.ok(Math.abs(counts[g] / n - 1 / GEMS.length) < 0.02, `${g} at distance ${dist}: ${counts[g] / n}`);
  }
});

test('gemShare: pinned to 0 every item is an ore, pinned to 100 every item is a gem; in between it is the share of items', () => {
  const withShare = (g) => cfgWith({ field: { byDistance: CONFIG.field.byDistance.map((r) => ({ ...r, loot: 100, gemShare: g })) } });
  const kinds = (cfg, dist, seed) => generateField(seededRng(seed), dist, cfg).cells.flatMap((c) => c.items.map((it) => it.t.split(':')[0]));
  for (const dist of [1, 3, 6, 9]) {
    const none = kinds(withShare(0), dist, 5);
    const all = kinds(withShare(100), dist, 6);
    assert.ok(none.length > 100 && none.every((k) => k === 'ore'), `distance ${dist}: no gems at share 0`);
    assert.ok(all.length > 100 && all.every((k) => k === 'gem'), `distance ${dist}: only gems at share 100`);
  }
  // the configured shares come out of the generator (many fields per distance)
  CONFIG.field.byDistance.forEach((row, i) => {
    let gems = 0;
    let n = 0;
    const rng = seededRng(30 + i);
    for (let k = 0; k < 40; k++) {
      for (const c of generateField(rng, i + 1).cells) for (const it of c.items) { n++; if (it.t.startsWith('gem:')) gems++; }
    }
    assert.ok(Math.abs((100 * gems) / n - row.gemShare) < 1.5, `distance ${i + 1}: ${(100 * gems) / n}% gems vs ${row.gemShare}%`);
  });
});

// ---------------------------------------------------------------- pathSteps --
test('pathSteps walks around blocked cells', () => {
  // wall above the camp: (1,1) (2,1) (3,1)
  const map = customMap([{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }], SMALL);
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
  const map = customMap([{ x: 1, y: 0 }, { x: 0, y: 1 }], SMALL);
  assert.equal(pathSteps(map, map.camp, { x: 0, y: 0 }), Infinity);
});

// ------------------------------------------------------------ travelMinutes --
function travelState(blocked = [{ x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }]) {
  const s = game(1);
  s.map = customMap(blocked, SMALL);
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
