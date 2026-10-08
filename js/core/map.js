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
// The contents row for a field at distance `dist` from camp (row 1 = distance 1). Fields farther than the
// last row use the last row.
export function distanceRow(dist, cfg = CONFIG) {
  const rows = cfg.field.byDistance;
  return rows[clamp(dist, 1, rows.length) - 1];
}

// A map is re-rolled when a field is unreachable or rocks make it more than cfg.map.maxDetour steps farther
// than the straight walk (|dx| + |dy|). Up to 500 attempts.
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
      const straight = Math.abs(cell.x - camp.x) + Math.abs(cell.y - camp.y);
      if (!Number.isFinite(cell.dist) || cell.dist - straight > cfg.map.maxDetour) ok = false;
    }
    if (!ok) continue;
    for (const cell of cells) if (cell.type === 'field') map.fields[key(cell.x, cell.y)] = generateField(rng, cell.dist, cfg);
    return map;
  }
  throw new Error('Could not generate a connected map');
}

// The sight range [lo, hi] an item type rolls its threshold in (every gem type shares one range).
export function sightRange(t, cfg = CONFIG) {
  return cfg.field.sight[itemKind(t) === 'gem' ? 'gem' : itemType(t)];
}

// An item's sight threshold: a whole number from lo + 1 up to hi.
export function rollSight(rng, t, cfg = CONFIG) {
  const [lo, hi] = sightRange(t, cfg);
  return rng.int(lo + 1, hi);
}

// Roll one fresh cell for a field at distance `dist` from camp.
// debris = remaining debris thickness in search effort (0 = clear).
// Each item: t = type, d = depth (found once "searched %" passes it, one decimal), s = sight threshold.
export function rollCell(rng, dist, cfg = CONFIG) {
  const f = cfg.field;
  const row = distanceRow(dist, cfg);
  const hasDebris = rng.chance(f.debrisChance);
  const debris = hasDebris ? rng.int(f.debrisAmount.min, f.debrisAmount.max) : 0;
  const items = [];
  if (rng.chance(row.loot + (hasDebris ? f.debrisLootBonus : 0))) {
    const n = Number(rng.weighted(f.itemCountWeights));
    for (let k = 0; k < n; k++) {
      const t = rng.chance(row.gemShare) ? `gem:${rng.weighted(f.gemWeights)}` : `ore:${rng.weighted(row.ores)}`;
      const d = round1(rng.float(0, 100));
      items.push({ t, d, s: rollSight(rng, t, cfg) });
    }
  }
  return { debris, boulder: false, searched: 0, items, touched: false };
}

// A cell covered by a boulder: can never be cleared or searched.
export function boulderCell() {
  return { debris: 0, boulder: true, searched: 0, items: [], touched: false };
}

// A field: size x size cells, then exactly the distance row's number of random cells become boulders.
export function generateField(rng, dist, cfg = CONFIG) {
  const n = cfg.field.size * cfg.field.size;
  const cells = [];
  for (let i = 0; i < n; i++) cells.push(rollCell(rng, dist, cfg));
  const spots = rng.shuffle([...Array(n).keys()]);
  const boulders = Math.min(distanceRow(dist, cfg).boulders || 0, n);
  for (let b = 0; b < boulders; b++) cells[spots[b]] = boulderCell();
  return { dist, cells, pile: [] };
}

// ------------------------------------------------------------------ sight ----
// Sight = Ore sight intel + worn Ore sight rings (smithBonuses().sight). Every item in the ground has a sight
// threshold `s`; in the field you stand in, you see an item once your sight reaches it. Sight sees through debris.
// Nothing is stored: seen items are worked out from the cell and your current sight.
export function sightValue(state, cfg = CONFIG) {
  return smithBonuses(state, cfg).sight;
}

export const isSeen = (item, sight) => item.s <= sight + EPS;

// The items of `cell` you can see at this sight.
export function seenItems(cell, sight) {
  return cell.items.filter((it) => isSeen(it, sight));
}

// The share (0..1) of items of type `t` ('ore:iron', 'gem:ruby') that a sight of `sight` sees: thresholds are
// spread evenly over lo + 1 .. hi, and sight counts as a whole number.
export function sightShare(t, sight, cfg = CONFIG) {
  const [lo, hi] = sightRange(t, cfg);
  return clamp((Math.floor(sight + EPS) - lo) / (hi - lo), 0, 1);
}

// % of the field searched, over the cells that can be searched (boulders excluded).
export function fieldProgress(field) {
  const cells = field.cells.filter((c) => !c.boulder);
  if (!cells.length) return 100;
  return cells.reduce((a, c) => a + c.searched, 0) / cells.length;
}

// A cell that still needs work (debris to clear or unsearched part left).
export const cellOpen = (c) => !c.boulder && (c.debris > EPS || c.searched < 100 - EPS);

// A "fresh" cell has never been worked on: no search has cleared debris from it or searched it
// (`touched` is set by the first search that works on it). Searching fresh cells costs extra time (field.freshCellMin).
export const cellFresh = (c) => cellOpen(c) && !c.touched;

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

// Fresh (never worked on) cells in the 3x3 search area centered at (cx, cy) of `field`.
export function freshCellCount(field, cx, cy, cfg = CONFIG) {
  if (!field) return 0;
  return areaCells(cx, cy, cfg).filter((i) => cellFresh(field.cells[i])).length;
}

// Minutes for one 3x3 search: the base time, plus freshCellMin per fresh cell in the area (only when the
// area's center cx, cy is given; without it this is the base time), then the search-time reductions.
export function searchMinutes(state, cfg = CONFIG, cx, cy) {
  let base = cfg.field.searchMin;
  if (cx !== undefined && cy !== undefined) base += (cfg.field.freshCellMin || 0) * freshCellCount(currentField(state), cx, cy, cfg);
  return round1(reduced(base, smithBonuses(state, cfg).searchTimePct, cfg.processing.maxTimeReduction));
}

// Average % of each cell searched per search (base x bonuses). Each cell rolls +/- searchRandomness.
export function searchEfficiency(state, cfg = CONFIG) {
  return cfg.field.searchEfficiency * (1 + smithBonuses(state, cfg).searchEffPct / 100);
}

// Expected number of searches that finish a clear cell: each search adds `efficiency +/- randomness` % to
// the cell (uniform), so this is 1 + the sum over k of P(the first k searches add up to less than 100%).
// Exact (Irwin-Hall); about 4 at the base 30 +/- 5, about 3.4 with +12% search efficiency.
export function expectedSearches(state, cfg = CONFIG) {
  const [lo, hi] = searchEfficiencyRange(state, cfg);
  return searchesToFinish(lo, hi);
}

// The same for a given per-search range [lo, hi] (% of a cell), with no player bonuses: what Help shows.
export function searchesToFinish(lo, hi) {
  if (hi <= EPS) return Infinity;
  if (hi - lo <= EPS) return Math.ceil(100 / hi - 1e-9);
  const width = hi - lo;
  let total = 1; // the first search always happens
  for (let k = 1; k < 1000; k++) {
    const x = (100 - k * lo) / width; // sum of k uniforms on [lo, hi] < 100  <=>  Irwin-Hall(k) < x
    if (x <= 0) break;
    if (x >= k) {
      total += 1;
      continue;
    }
    let cdf = 0;
    let binom = 1;
    let fact = 1;
    for (let i = 2; i <= k; i++) fact *= i;
    for (let j = 0; j <= Math.floor(x); j++) {
      cdf += ((j % 2 ? -1 : 1) * binom * (x - j) ** k) / fact;
      binom = (binom * (k - j)) / (j + 1);
    }
    total += cdf;
  }
  return total;
}

// A search count for display: "4" (within 0.15 of a whole number), otherwise one decimal ("3.4"), "?" when
// no number of searches can finish a cell.
export function searchesText(searches) {
  if (!Number.isFinite(searches)) return '?';
  return String(Math.abs(searches - Math.round(searches)) < 0.15 ? Math.round(searches) : round1(searches));
}

// [min, max] % a single cell can get from one search.
export function searchEfficiencyRange(state, cfg = CONFIG) {
  const e = searchEfficiency(state, cfg);
  const r = cfg.field.searchRandomness || 0;
  return [clamp(e - r, 0, 100), clamp(e + r, 0, 100)];
}

// Debris cleared per point of search effort (1 + debris skill %).
export function debrisClearMult(state, cfg = CONFIG) {
  return 1 + smithBonuses(state, cfg).debrisPct / 100;
}

// Load used for the "can still walk home" check in a field: as much as you could carry
// (bag + this field's pile, up to the bag size). Leaving items behind doesn't buy extra time.
export function projectedLoad(state, cfg = CONFIG) {
  const f = currentField(state);
  return Math.min(cfg.bag.slots, state.bag.length + (f ? f.pile.length : 0));
}

// Can a field action of `minutes` start now and still leave time to walk home with a full load?
export function fitsWithReturn(state, minutes, cfg = CONFIG) {
  return state.time + minutes + returnMinutes(state, state.location, projectedLoad(state, cfg), cfg) <= cfg.time.dayEndMin + EPS;
}

const endClock = (cfg) => formatClock(cfg.time.dayEndMin);

// ---------------------------------------------------------------- actions ----
function requireWork(state) {
  if (state.phase !== 'work') return { ok: false, msg: 'Not during the work day.' };
  return null;
}

// Travel to a map cell. `carry` (optional, when leaving a field) picks what to take first:
// { bag: [bag indexes], pile: [pile indexes] } — see setCarry. Without it you take your current bag.
export function travel(state, to, cfg = CONFIG, carry = null) {
  const err = requireWork(state);
  if (err) return err;
  const target = mapCell(state.map, to.x, to.y);
  if (!target || target.type === 'blocked') return { ok: false, msg: 'Cannot travel there.' };
  if (sameLoc(state.location, to)) return { ok: false, msg: 'Already there.' };
  const field = currentField(state);
  const sel = carry && field ? carrySelection(state, field, carry) : null; // at camp there is nothing to choose
  const items = sel ? sel.bag.length + sel.pile.length : state.bag.length;
  const minutes = travelMinutes(state, state.location, to, items, cfg);
  if (!Number.isFinite(minutes)) return { ok: false, msg: 'No path.' };
  const toCamp = target.type === 'camp';
  if (!toCamp) {
    const back = travelMinutes(state, to, state.map.camp, items, cfg);
    if (state.time + minutes + back > cfg.time.dayEndMin + EPS) {
      return { ok: false, msg: `Not enough time: ${round1(minutes)}m there + ${round1(back)}m back would pass ${endClock(cfg)}.` };
    }
  }
  if (sel) {
    const res = setCarry(state, sel, cfg);
    if (!res.ok) return res;
  }
  const notes = [];
  state.time += minutes;
  state.location = { x: to.x, y: to.y };
  if (toCamp) {
    addXp(state, 'returnTravel', minutes, notes, cfg);
    const unloaded = unloadBag(state);
    return { ok: true, msg: `Returned to camp (${round1(minutes)}m).${unloaded ? ` Unloaded ${unloaded} items.` : ''}`, notes, minutes };
  }
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

// Search a 3x3 area. Each open cell gets its own effort roll (efficiency +/- randomness). On a debris
// cell the effort clears debris first (x debris skill); leftover effort searches the cell. Found items go
// to this field's pile; choose what to carry when you leave.
export function search(state, cx, cy, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const field = currentField(state);
  if (!field) return { ok: false, msg: 'You are at camp. Travel to a field first.' };
  const freshCells = freshCellCount(field, cx, cy, cfg); // counted before this search touches them
  const minutes = searchMinutes(state, cfg, cx, cy);
  if (!fitsWithReturn(state, minutes, cfg)) return { ok: false, msg: `Not enough time to search and still get back by ${endClock(cfg)}.` };
  const idxs = areaCells(cx, cy, cfg);
  const open = idxs.filter((i) => cellOpen(field.cells[i]));
  if (!open.length) return { ok: false, msg: 'Nothing left to search here (fully searched or boulders).' };
  const eff = searchEfficiency(state, cfg);
  const clearMult = debrisClearMult(state, cfg);
  const r = cfg.field.searchRandomness || 0;
  const rng = rngFor(state);
  const found = [];
  let debrisCleared = 0;
  let cellsCleared = 0;
  let searchedCells = 0;
  for (const i of open) {
    const cell = field.cells[i];
    let effort = r > 0 ? clamp(eff + rng.float(-r, r), 0, 100) : eff;
    if (effort > EPS) cell.touched = true; // the first search that works on a cell ends its fresh cost
    if (cell.debris > EPS) {
      const power = effort * clearMult;
      const used = Math.min(cell.debris, power);
      cell.debris -= used;
      debrisCleared += used;
      if (cell.debris <= EPS) {
        cell.debris = 0;
        cellsCleared++;
      }
      effort = (power - used) / clearMult; // leftover effort goes into searching
    }
    if (cell.debris > 0 || effort <= EPS || cell.searched >= 100 - EPS) continue;
    searchedCells++;
    const s1 = Math.min(100, cell.searched + effort);
    const full = s1 >= 100 - EPS;
    const keep = [];
    for (const it of cell.items) {
      if (full || it.d < s1) {
        field.pile.push(it.t);
        found.push(it.t);
      } else keep.push(it);
    }
    cell.items = keep;
    cell.searched = full ? 100 : s1;
  }
  state.time += minutes;
  const notes = [];
  addXp(state, 'searchTime', minutes, notes, cfg);
  addXp(state, 'searchEff', minutes, notes, cfg);
  if (debrisCleared > 0) addXp(state, 'debris', debrisCleared, notes, cfg);
  const skipped = idxs.length - open.length;
  let msg = `Searched ${open.length} cells (${round1(minutes)}m): found ${found.length} item(s), now in this field's pile.`;
  if (debrisCleared > 0) msg += ` Cleared ${round1(debrisCleared)} debris${cellsCleared ? ` (${cellsCleared} cell(s) now clear)` : ''}.`;
  if (skipped) msg += ` ${skipped} cell(s) skipped (done or boulder).`;
  return { ok: true, msg, notes, found, debrisCleared, cellsCleared, searchedCells, minutes, freshCells };
}

// ------------------------------------------------------------ carrying ----
// Rough value order for the default carry choice: rarest first.
const CARRY_ORDER = ['ore:mythril', 'gem:diamond', 'gem:emerald', 'gem:sapphire', 'gem:topaz', 'gem:ruby', 'ore:coal', 'ore:iron', 'ore:copper'];
const carryRank = (t) => {
  const i = CARRY_ORDER.indexOf(t);
  return i < 0 ? CARRY_ORDER.length : i;
};

// Default selection when leaving a field: keep the bag, fill free slots with the rarest pile items.
export function defaultCarry(state, cfg = CONFIG) {
  const f = currentField(state);
  const bag = state.bag.map((_, i) => i).slice(0, cfg.bag.slots);
  const pile = [];
  if (f) {
    const order = f.pile.map((t, i) => ({ t, i })).sort((a, b) => carryRank(a.t) - carryRank(b.t) || a.i - b.i);
    for (const { i } of order) {
      if (bag.length + pile.length >= cfg.bag.slots) break;
      pile.push(i);
    }
  }
  return { bag, pile };
}

// A carry selection with invalid and repeated indexes removed.
function carrySelection(state, f, sel) {
  return {
    bag: [...new Set(sel.bag || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < state.bag.length),
    pile: [...new Set(sel.pile || [])].filter((i) => Number.isInteger(i) && i >= 0 && i < f.pile.length),
  };
}

// Choose what to carry from the bag and this field's pile (free). Unchosen items go to the pile.
export function setCarry(state, sel, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const f = currentField(state);
  if (!f) return { ok: false, msg: 'You are at camp: your load was unloaded into storage.' };
  const { bag: bagSel, pile: pileSel } = carrySelection(state, f, sel);
  if (bagSel.length + pileSel.length > cfg.bag.slots) return { ok: false, msg: `You can carry at most ${cfg.bag.slots} items.` };
  const newBag = [...bagSel.map((i) => state.bag[i]), ...pileSel.map((i) => f.pile[i])];
  const newPile = [...f.pile.filter((_, i) => !pileSel.includes(i)), ...state.bag.filter((_, i) => !bagSel.includes(i))];
  state.bag = newBag;
  f.pile = newPile;
  return { ok: true, msg: `Carrying ${newBag.length} item(s); ${newPile.length} left in this field's pile.` };
}

// Move one carried item to this field's pile (free).
export function moveToPile(state, bagIndex, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const f = currentField(state);
  if (!f) return { ok: false, msg: 'You are at camp.' };
  if (bagIndex < 0 || bagIndex >= state.bag.length) return { ok: false, msg: 'No such item.' };
  const [t] = state.bag.splice(bagIndex, 1);
  f.pile.push(t);
  return { ok: true, msg: `Left ${itemType(t)} in the pile.` };
}

// Take one item from this field's pile into the bag (free, if there is room).
export function takeFromPile(state, pileIndex, cfg = CONFIG) {
  const err = requireWork(state);
  if (err) return err;
  const f = currentField(state);
  if (!f) return { ok: false, msg: 'You are at camp.' };
  if (pileIndex < 0 || pileIndex >= f.pile.length) return { ok: false, msg: 'No such item in the pile.' };
  if (state.bag.length >= cfg.bag.slots) return { ok: false, msg: 'Bag is full: leave something in the pile first.' };
  const [t] = f.pile.splice(pileIndex, 1);
  state.bag.push(t);
  return { ok: true, msg: `Picked up ${itemType(t)}.` };
}
