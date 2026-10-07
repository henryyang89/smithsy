import { CONFIG } from '../config.js';
import { clamp, reduced, round1, EPS, formatClock } from './util.js';
import { smithBonuses } from './bonuses.js';
import { addXp } from './skills.js';
import { rngFor } from './rng.js';

// ---------------------------------------------------------------- helpers ----
export const key = (x, y) => `${x},${y}`;
export const sameLoc = (a, b) => a.x === b.x && a.y === b.y;
export const atCamp = (state) => sameLoc(state.location, state.map.camp);
export const itemKind = (t) => t.split(':')[0]; // 'ore' | 'gem'
export const itemType = (t) => t.split(':')[1];

export function mapCell(map, x, y) {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return null;
  return map.cells[y * map.size + x];
}

export function currentField(state) {
  return atCamp(state) ? null : state.map.fields[key(state.location.x, state.location.y)];
}

// BFS steps between two map cells over non-blocked cells. Infinity if unreachable.
export function pathSteps(map, from, to) {
  if (sameLoc(from, to)) return 0;
  const seen = new Set([key(from.x, from.y)]);
  let frontier = [from];
  let steps = 0;
  while (frontier.length) {
    steps++;
    const next = [];
    for (const p of frontier) {
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = p.x + dx;
        const ny = p.y + dy;
        const c = mapCell(map, nx, ny);
        if (!c || c.type === 'blocked' || seen.has(key(nx, ny))) continue;
        if (nx === to.x && ny === to.y) return steps;
        seen.add(key(nx, ny));
        next.push({ x: nx, y: ny });
      }
    }
    frontier = next;
  }
  return Infinity;
}

// ------------------------------------------------------------- generation ----
export function generateMap(rng, cfg = CONFIG) {
  const size = cfg.map.size;
  const c = Math.floor(size / 2);
  const camp = { x: c, y: c };
  for (let attempt = 0; attempt < 500; attempt++) {
    const cells = [];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) cells.push({ x, y, type: x === c && y === c ? 'camp' : 'field', dist: 0 });
    const candidates = rng.shuffle(cells.filter((cell) => cell.type === 'field'));
    for (let i = 0; i < cfg.map.blockedCells && i < candidates.length; i++) candidates[i].type = 'blocked';
    const map = { size, camp, cells, fields: {} };
    let ok = true;
    for (const cell of cells) {
      if (cell.type !== 'field') continue;
      cell.dist = pathSteps(map, camp, cell);
      if (!Number.isFinite(cell.dist)) ok = false;
    }
    if (!ok) continue;
    for (const cell of cells) if (cell.type === 'field') map.fields[key(cell.x, cell.y)] = generateField(rng, cell.dist, cfg);
    return map;
  }
  throw new Error('Could not generate a connected map');
}

// Roll one fresh cell for a field at distance `dist` from camp.
export function rollCell(rng, dist, cfg = CONFIG) {
  const f = cfg.field;
  const oreW = f.oreWeights[Math.max(0, Math.min(dist, f.oreWeights.length) - 1)];
  const gemW = f.gemWeights[Math.max(0, Math.min(dist, f.gemWeights.length) - 1)];
  const baseLoot = Math.min(f.lootChance.max, f.lootChance.base + f.lootChance.perDistance * (dist - 1));
  const debris = rng.chance(f.debrisChance);
  const items = [];
  if (rng.chance(baseLoot + (debris ? f.debrisLootBonus : 0))) {
    const n = Number(rng.weighted(f.itemCountWeights));
    for (let k = 0; k < n; k++) {
      const t = rng.chance(f.oreShare) ? `ore:${rng.weighted(oreW)}` : `gem:${rng.weighted(gemW)}`;
      items.push({ t, d: rng.float(0, 100) }); // d = depth: found once "searched %" passes it
    }
  }
  return { debris, searched: 0, items, revealed: false, ground: [] };
}

export function generateField(rng, dist, cfg = CONFIG) {
  const cells = [];
  for (let i = 0; i < cfg.field.size * cfg.field.size; i++) cells.push(rollCell(rng, dist, cfg));
  return { dist, cells };
}

// Nightly regrowth: each searched cell has regrowPctPerDay % chance to become a fresh cell.
// Items lying on the ground stay where they are. Returns the number of regrown cells.
export function regrowFields(state, rng, cfg = CONFIG) {
  const pct = cfg.field.regrowPctPerDay || 0;
  if (pct <= 0) return 0;
  let n = 0;
  for (const field of Object.values(state.map.fields)) {
    field.cells.forEach((cell, i) => {
      if (cell.searched <= 0 || !rng.chance(pct)) return;
      const fresh = rollCell(rng, field.dist, cfg);
      fresh.ground = cell.ground;
      field.cells[i] = fresh;
      n++;
    });
  }
  return n;
}

// % of the field searched (debris cells count as unsearched until cleared and searched).
export function fieldProgress(field) {
  const total = field.cells.reduce((a, c) => a + c.searched, 0);
  return total / field.cells.length;
}

// Cells covered by a 3x3 search centered at (cx, cy), clipped to the field.
export function areaCells(cx, cy, cfg = CONFIG) {
  const out = [];
  const n = cfg.field.size;
  for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) if (x >= 0 && y >= 0 && x < n && y < n) out.push(y * n + x);
  return out;
}

// ----------------------------------------------------------------- timing ----
export function timeLeft(state, cfg = CONFIG) {
  return cfg.time.dayEndMin - state.time;
}

export function travelMinutes(state, from, to, items, cfg = CONFIG) {
  const steps = pathSteps(state.map, from, to);
  if (!Number.isFinite(steps)) return Infinity;
  const b = smithBonuses(state, cfg);
  const toCamp = sameLoc(to, state.map.camp);
  const base = steps * cfg.map.travelMinPerStep * (1 + (cfg.map.loadPenaltyPerItem * items) / 100);
  return round1(reduced(base, b.travelPct + (toCamp ? b.returnPct : 0), cfg.processing.maxTimeReduction));
}

export function returnMinutes(state, from = state.location, items = state.bag.length, cfg = CONFIG) {
  return travelMinutes(state, from, state.map.camp, items, cfg);
}

export function searchMinutes(state, cfg = CONFIG) {
  return round1(reduced(cfg.field.searchMin, smithBonuses(state, cfg).searchTimePct, cfg.processing.maxTimeReduction));
}

// Average % of each cell searched per search (base x bonuses). Each cell rolls +/- searchRandomness.
export function searchEfficiency(state, cfg = CONFIG) {
  return cfg.field.searchEfficiency * (1 + smithBonuses(state, cfg).searchEffPct / 100);
}

// [min, max] % a single cell can get from one search.
export function searchEfficiencyRange(state, cfg = CONFIG) {
  const e = searchEfficiency(state, cfg);
  const r = cfg.field.searchRandomness || 0;
  return [clamp(e - r, 0, 100), clamp(e + r, 0, 100)];
}

export function debrisMinutesPerCell(state, cfg = CONFIG) {
  return round1(reduced(cfg.field.debrisClearMin, smithBonuses(state, cfg).debrisPct, cfg.processing.maxTimeReduction));
}

// Can a field action of `minutes` start now and still leave time to walk home?
function fitsWithReturn(state, minutes, cfg) {
  return state.time + minutes + returnMinutes(state, state.location, state.bag.length, cfg) <= cfg.time.dayEndMin + EPS;
}

const endClock = (cfg) => formatClock(cfg.time.dayEndMin);

// How many items the bag may hold after a free pick-up: as many as still let you walk home by day
// end, but never fewer than the bag held after the last timed field action (state.loadMark), so
// late swaps stay possible. This closes "drop everything, search, pick it all back up for free".
export function pickUpLimit(state, cfg = CONFIG) {
  const mark = state.loadMark ?? state.bag.length;
  let byTime = 0;
  for (let n = cfg.bag.slots; n > 0; n--) {
    if (state.time + returnMinutes(state, state.location, n, cfg) <= cfg.time.dayEndMin + EPS) {
      byTime = n;
      break;
    }
  }
  return Math.min(cfg.bag.slots, Math.max(mark, byTime));
}

// ---------------------------------------------------------------- actions ----
function requireWork(state) {
  if (state.phase !== 'work') return { ok: false, msg: 'Not during the work day.' };
  return null;
}

export function travel(state, to, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const target = mapCell(state.map, to.x, to.y);
  if (!target || target.type === 'blocked') return { ok: false, msg: 'Cannot travel there.' };
  if (sameLoc(state.location, to)) return { ok: false, msg: 'Already there.' };
  const items = state.bag.length;
  const minutes = travelMinutes(state, state.location, to, items, cfg);
  if (!Number.isFinite(minutes)) return { ok: false, msg: 'No path.' };
  const toCamp = target.type === 'camp';
  if (!toCamp) {
    const back = travelMinutes(state, to, state.map.camp, items, cfg);
    if (state.time + minutes + back > cfg.time.dayEndMin + EPS) {
      return { ok: false, msg: `Not enough time: ${round1(minutes)}m there + ${round1(back)}m back would pass ${endClock(cfg)}.` };
    }
  }
  const notes = [];
  state.time += minutes;
  state.location = { x: to.x, y: to.y };
  if (toCamp) {
    addXp(state, 'returnTravel', minutes, notes, cfg);
    const unloaded = unloadBag(state);
    return { ok: true, msg: `Returned to camp (${round1(minutes)}m).${unloaded ? ` Unloaded ${unloaded} items.` : ''}`, notes, minutes };
  }
  state.loadMark = state.bag.length;
  return { ok: true, msg: `Travelled to field (${to.x + 1},${to.y + 1}) in ${round1(minutes)}m.`, notes, minutes };
}

export function unloadBag(state) {
  const n = state.bag.length;
  for (const t of state.bag) {
    const kind = itemKind(t);
    const type = itemType(t);
    const store = kind === 'ore' ? state.storage.ore : state.storage.gem;
    store[type] = (store[type] || 0) + 1;
  }
  state.bag = [];
  return n;
}

export function search(state, cx, cy, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const field = currentField(state);
  if (!field) return { ok: false, msg: 'You are at camp. Travel to a field first.' };
  const minutes = searchMinutes(state, cfg);
  if (!fitsWithReturn(state, minutes, cfg)) return { ok: false, msg: `Not enough time to search and still get back by ${endClock(cfg)}.` };
  const idxs = areaCells(cx, cy, cfg);
  const searchable = idxs.filter((i) => !field.cells[i].debris && field.cells[i].searched < 100 - EPS);
  if (!searchable.length) return { ok: false, msg: 'Nothing left to search here (fully searched or covered by debris).' };
  const eff = searchEfficiency(state, cfg);
  const revealPct = smithBonuses(state, cfg).revealPct;
  const rng = rngFor(state);
  const found = [];
  const toGround = [];
  let revealed = 0;
  for (const i of searchable) {
    const cell = field.cells[i];
    const r = cfg.field.searchRandomness || 0;
    const cellEff = r > 0 ? clamp(eff + rng.float(-r, r), 0, 100) : eff;
    const s1 = Math.min(100, cell.searched + cellEff);
    const full = s1 >= 100 - EPS;
    const keep = [];
    for (const it of cell.items) {
      if (full || it.d < s1) {
        if (state.bag.length < cfg.bag.slots) {
          state.bag.push(it.t);
          found.push(it.t);
        } else {
          cell.ground.push(it.t);
          toGround.push(it.t);
        }
      } else keep.push(it);
    }
    cell.items = keep;
    cell.searched = full ? 100 : s1;
    // ore sight only rolls on cells that still have something to reveal (not just finished)
    if (!full && !cell.revealed && rng.chance(revealPct)) {
      cell.revealed = true;
      revealed++;
    }
  }
  state.time += minutes;
  state.loadMark = state.bag.length;
  const notes = [];
  addXp(state, 'searchTime', minutes, notes, cfg);
  addXp(state, 'searchEff', minutes, notes, cfg);
  const skipped = idxs.length - searchable.length;
  let msg = `Searched ${searchable.length} cells (${round1(minutes)}m): found ${found.length + toGround.length} item(s).`;
  if (toGround.length) msg += ` Bag full: ${toGround.length} left on the ground.`;
  if (revealed) msg += ` Ore sight revealed ${revealed} cell(s).`;
  if (skipped) msg += ` ${skipped} cell(s) skipped (debris or done).`;
  return { ok: true, msg, notes, found, toGround, revealed, minutes };
}

export function clearDebris(state, cx, cy, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const field = currentField(state);
  if (!field) return { ok: false, msg: 'You are at camp.' };
  const idxs = areaCells(cx, cy, cfg).filter((i) => field.cells[i].debris);
  if (!idxs.length) return { ok: false, msg: 'No debris in that area.' };
  const per = debrisMinutesPerCell(state, cfg);
  const minutes = round1(per * idxs.length);
  if (!fitsWithReturn(state, minutes, cfg)) return { ok: false, msg: `Not enough time to clear and still get back by ${endClock(cfg)}.` };
  for (const i of idxs) field.cells[i].debris = false;
  state.time += minutes;
  const notes = [];
  addXp(state, 'debris', minutes, notes, cfg);
  state.loadMark = state.bag.length;
  return { ok: true, msg: `Cleared ${idxs.length} debris cell(s) in ${round1(minutes)}m.`, notes, minutes };
}

// Pick up items lying on the ground in a cell (free). Takes as many as fit (see pickUpLimit),
// or only the item at groundIndex when given.
export function pickUp(state, cellIndex, cfg = CONFIG, groundIndex = null) {
  const err = requireWork(state);
  if (err) return err;
  const field = currentField(state);
  if (!field) return { ok: false, msg: 'You are at camp.' };
  const cell = field.cells[cellIndex];
  if (!cell || !cell.ground.length) return { ok: false, msg: 'Nothing on the ground there.' };
  if (groundIndex != null && (groundIndex < 0 || groundIndex >= cell.ground.length)) return { ok: false, msg: 'No such item on the ground.' };
  const limit = pickUpLimit(state, cfg);
  if (state.bag.length >= cfg.bag.slots) return { ok: false, msg: 'Bag is full.' };
  if (state.bag.length >= limit) return { ok: false, msg: `Carrying more would make the walk home end after ${endClock(cfg)}.` };
  let n = 0;
  if (groundIndex != null) {
    state.bag.push(cell.ground.splice(groundIndex, 1)[0]);
    n = 1;
  } else {
    while (cell.ground.length && state.bag.length < limit) {
      state.bag.push(cell.ground.shift());
      n++;
    }
  }
  return { ok: true, msg: `Picked up ${n} item(s).${cell.ground.length ? ` ${cell.ground.length} still on the ground.` : ''}` };
}

// Drop a bag item onto the ground of a cell in the current field (free).
export function dropItem(state, bagIndex, cellIndex, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const field = currentField(state);
  if (!field) return { ok: false, msg: 'Drop items in a field (at camp they are stored automatically).' };
  if (bagIndex < 0 || bagIndex >= state.bag.length) return { ok: false, msg: 'No such item.' };
  const idx = clamp(cellIndex ?? 0, 0, field.cells.length - 1);
  const [t] = state.bag.splice(bagIndex, 1);
  field.cells[idx].ground.push(t);
  return { ok: true, msg: `Dropped ${itemType(t)}.` };
}
