// Shared test helpers (not a test file itself: `node --test tests/*.test.mjs` skips it).
// Tests may set up state directly; only UI code is restricted to core actions.
//
// Balance numbers in js/config.js get re-tuned often. Tests therefore never hardcode a CONFIG number:
// they either derive the expectation from CONFIG, or pass an explicit config (cfgWith) that pins the
// numbers a hand-computed expectation depends on, or use hand-built combatants.
import { CONFIG, GRADES } from '../js/config.js';
import { newGame } from '../js/core/game.js';
import { seededRng } from '../js/core/rng.js';
import { xpToNext } from '../js/core/skills.js';
import { pathSteps, generateField, key } from '../js/core/map.js';

export const DAY_START = CONFIG.time.dayStartMin;
export const DAY_END = CONFIG.time.dayEndMin;

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

function merge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (isObj(v) && isObj(target[k])) merge(target[k], v);
    else target[k] = isObj(v) ? structuredClone(v) : v;
  }
  return target;
}

// A deep copy of CONFIG with each patch deep-merged in, in order (arrays and scalars replace).
export function cfgWith(...patches) {
  const cfg = structuredClone(CONFIG);
  for (const p of patches) merge(cfg, p);
  return cfg;
}

// A ring type's value at a grade, read from a config.
export const ringVal = (type, grade, cfg = CONFIG) => cfg.rings.types[type].values[GRADES.indexOf(grade)];

// Scripted rand() for fights: returns `values` in order, then `rest` forever.
// (0.99 is above the 95% hit cap, so with the default rest every later attack misses.)
export function scriptRand(values, rest = 0.99) {
  let i = 0;
  return () => (i < values.length ? values[i++] : rest);
}

// Config patches for tests about rules (day flow, reports, estimates), not balance:
// with WEAK_ENEMIES the adventurer always wins (even unarmed), with DEADLY_ENEMIES it always loses.
const tiersWith = (stats) => Object.fromEntries(Object.keys(CONFIG.enemies.tiers).map((t) => [t, { ...stats }]));
export const WEAK_ENEMIES = { enemies: { tiers: tiersWith({ hp: 0.01, damage: 1e-6 }) } };
export const DEADLY_ENEMIES = { enemies: { tiers: tiersWith({ hp: 1e9, damage: 1e6 }) } };

export function game(seed = 12345, cfg = CONFIG) {
  return newGame(seed, cfg);
}

export const approx = (actual, expected, eps = 1e-9) => Math.abs(actual - expected) <= eps;

// A field cell with given items: [{ t, d, s? }] (d = depth, s = sight threshold, 0 = seen at any sight).
// debris = remaining thickness (0 = clear).
export function cell(items = [], extra = {}) {
  return { debris: 0, boulder: false, searched: 0, items: items.map((i) => ({ s: 0, ...i })), touched: false, ...extra };
}

// A boulder cell (never searched or cleared).
export const boulder = () => cell([], { boulder: true });

// Empty field of cfg.field.size squared (no items, no debris, no boulders, empty pile).
export function blankField(dist = 1, cfg = CONFIG) {
  const n = cfg.field.size;
  return { dist, cells: Array.from({ length: n * n }, () => cell()), pile: [] };
}

export const idx = (x, y, cfg = CONFIG) => y * cfg.field.size + x;

// The field contents at a map cell ({ x, y }).
export const fieldOf = (state, c) => state.map.fields[key(c.x, c.y)];

// Find a field map cell at the given distance from camp.
export function fieldAt(state, dist) {
  return state.map.cells.find((c) => c.type === 'field' && c.dist === dist);
}

// Put the smith in a field (replacing its contents with a blank field) and return that field.
export function standInBlankField(state, dist = 1, cfg = CONFIG) {
  const c = fieldAt(state, dist);
  if (!c) throw new Error(`no field at distance ${dist}`);
  const f = blankField(c.dist, cfg);
  state.map.fields[key(c.x, c.y)] = f;
  state.location = { x: c.x, y: c.y };
  return f;
}

// Hand-built map (cfg.map.size squared) with the given blocked cells (camp at center).
export function customMap(blocked = [], cfg = CONFIG, seed = 7) {
  const size = cfg.map.size;
  const c = Math.floor(size / 2);
  const camp = { x: c, y: c };
  const isBlocked = (x, y) => blocked.some((b) => b.x === x && b.y === y);
  const cells = [];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      cells.push({ x, y, type: x === c && y === c ? 'camp' : isBlocked(x, y) ? 'blocked' : 'field', dist: 0 });
    }
  }
  const map = { size, camp, cells, fields: {} };
  const rng = seededRng(seed);
  for (const cl of cells) {
    if (cl.type !== 'field') continue;
    cl.dist = pathSteps(map, camp, cl);
    if (Number.isFinite(cl.dist)) map.fields[key(cl.x, cl.y)] = generateField(rng, cl.dist, cfg);
  }
  return map;
}

// Add a gear item directly (no crafting cost/time).
export function addGear(state, slot, material = 'copper', grade = 'D', gem = null, extra = {}) {
  const item = { id: state.nextId++, slot, material, grade, gem, durability: 100, packed: false, ...extra };
  state.gear.push(item);
  return item;
}

export function addRing(state, type, grade = 'D', worn = false) {
  const ring = { id: state.nextId++, type, grade, worn };
  state.rings.push(ring);
  return ring;
}

export function fullSet(state, material = 'mythril', grade = 'S') {
  return ['sword', 'chest', 'helmet', 'gloves', 'boots'].map((s) => addGear(state, s, material, grade));
}

// Total XP spent to reach `level` (so xp + xpSpent(level) = all XP ever gained, below max level).
export function xpSpent(level, cfg = CONFIG) {
  let t = 0;
  for (let L = 0; L < level; L++) t += xpToNext(L, cfg);
  return t;
}

// All XP a skill has gained (below max level).
export const totalXp = (state, k, cfg = CONFIG) => state.skills[k].xp + xpSpent(state.skills[k].level, cfg);

export function setSkillLevel(state, k, level) {
  state.skills[k].level = level;
  state.skills[k].xp = 0;
}

// A plain combatant for combat tests.
export function combatant(over = {}) {
  return {
    name: 'X', hp: 100, damage: 10, interval: 2, speed: 0, accuracy: 100, dodge: 100, defense: 0,
    magicPct: 0, magicRes: 0, pierce: 0, pierceRes: 0,
    stunChance: 0, stunDur: 0, stunChanceRed: 0, stunDurRed: 0,
    slowPct: 0, slowDur: 0, slowRed: 0, slowDurRed: 0,
    ...over,
  };
}

export const allLevels = (lv) => Object.fromEntries(Object.keys(CONFIG.enemies.attributes).map((k) => [k, lv]));

export function countLevels(levels) {
  const out = { low: 0, normal: 0, high: 0 };
  for (const v of Object.values(levels)) out[v] += 1;
  return out;
}
