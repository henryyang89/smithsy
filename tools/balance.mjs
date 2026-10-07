#!/usr/bin/env node
// ============================================================================
// SMITHSY BALANCE REPORT — is the pacing and difficulty sensible?
//
//   node tools/balance.mjs [--section economy|power|bot|all] [--seeds N] [--days N] [--samples N]
//                          [--minwin P] [--future F] [--ablate x,y] [--quick] [--set path=value ...]
//
//   --section  which report to run (default: all)
//   --seeds    economy: generated maps (default 100); bot: runs (default 20; survival numbers move
//              by ~+-10 points between seed sets of this size, use 40+ to compare close what-ifs)
//   --days     bot: play up to this day (default 80; runs that are still alive then are cut off)
//   --samples  power: hidden-attribute guesses per win-% cell (default 100, x50 fights each)
//   --minwin   bot: minimum estimated win % to accept a fight (default 90)
//   --future   bot: points one survival is worth when comparing fights (default 1000 = careful:
//              a 50-point champion needs >= 96% of the best normal's win chance)
//   --ablate   bot: play without some systems, comma separated: gems (never cut/infuse), rings (never
//              wear), skills (no skill levels), intel (never spend), repair (never repair)
//   --quick    small sample sizes (smoke test, a few seconds)
//   --set      what-if: override a CONFIG value in memory for this run only (repeatable). The path walks
//              object keys and array indices; '*' matches every key/index at that level; the value is
//              parsed as JSON (numbers, arrays, objects) and falls back to a plain string, e.g.
//                --set map.travelMinPerStep=30
//                --set field.oreWeights.1.mythril=0          (array index)
//                --set 'field.oreWeights.*.mythril=2'        (every row)
//                --set 'gear.durabilityLoss={"min":2,"max":4}'
//                --set 'refine.mythril.input={"mythril":2}'
//              js/config.js itself is never changed.
//
// Sections
//   economy  Uses the real map generation + search code on fresh games: items per search by field
//            distance, ore/gem mix, minutes per raw item including travel, bars per grade per ore,
//            and the minutes needed to mine + refine + smith a full set of each material.
//   power    Win % of loadouts vs each enemy tier over days (estimateWinChanceSync, all attributes
//            hidden = a typical enemy of the tier): the day-2 fight with day-1 gear, archetype sets,
//            the weakest full set that holds target win rates on each day, and how much each gem /
//            ring / gear slot is worth.
//   bot      A scripted "careful" player that drives the real game API day by day (gather, refine,
//            cut, smith, repair, rings, intel, nightly plan) and reports survival, score, gear over
//            time, the daily time split, rings, skills and the tiers it chose.
//
// Each section ends with a one-line SUMMARY that is easy to compare between what-if runs.
// Never edits config or core files. Every game state here is a throwaway copy; the yield
// measurements in `economy` reset the clock and bag of their scratch copies between searches.
// ============================================================================
import { CONFIG, BARS, GEMS, GRADES, SLOTS, ARMOR_SLOTS, TIERS, ORES } from '../js/config.js';
import { newGame, endDay, acknowledgeReport, confirmPlan } from '../js/core/game.js';
import {
  key, sameLoc, atCamp, currentField, areaCells, travelMinutes, returnMinutes, searchMinutes,
  searchEfficiency, debrisMinutesPerCell, travel, search, clearDebris, pickUp, dropItem,
} from '../js/core/map.js';
import { adjustDistribution, refineMinutes, cutMinutes, rollGrade, refine, cut } from '../js/core/processing.js';
import { gearStats, craftMinutes, craft, repairInfo, repair } from '../js/core/gear.js';
import { ringDef, ringTotals, wornRings, toggleRing } from '../js/core/rings.js';
import { estimateWinChanceSync } from '../js/core/sim.js';
import { knownLevels } from '../js/core/enemies.js';
import { spendIntel, intelChance } from '../js/core/intel.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { itemXp } from '../js/core/skills.js';
import { seededRng, mixSeed } from '../js/core/rng.js';
import { EPS, deepClone } from '../js/core/util.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const IS_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const SET_LOG = [];
let ARGS;
try {
  ARGS = IS_MAIN ? parseArgs(process.argv.slice(2)) : parseArgs([]);
  for (const [path, value] of ARGS.set) SET_LOG.push(...applySet(path, value));
  // System ablations that are pure config switches (applied before anything reads CONFIG).
  if (ARGS.ablate.includes('skills')) SET_LOG.push(...applySet('skills.maxLevel', '0'));
} catch (err) {
  if (!IS_MAIN) throw err;
  console.error(`balance.mjs: ${err.message}`);
  process.exit(2);
}

const cfg = CONFIG;
const DAY_START = cfg.time.dayStartMin;
const DAY_END = cfg.time.dayEndMin;
const DAY_LEN = DAY_END - DAY_START;
const BAG = cfg.bag.slots;
const ADV_RINGS = Object.keys(cfg.rings.types).filter((t) => cfg.rings.types[t].owner === 'adventurer');
const TIME_CATS = ['travel', 'search', 'clear', 'refine', 'cut', 'smith', 'repair'];
const MINING = ['travel', 'search', 'clear'];

// ------------------------------------------------------------ formatting ----
const fx = (v, d) => (Number.isFinite(v) ? v.toFixed(d) : '-');
const f0 = (v) => fx(v, 0);
const f1 = (v) => fx(v, 1);
const f2 = (v) => fx(v, 2);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
const median = (a) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const quantile = (a, q) => {
  if (!a.length) return NaN;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))];
};

function h1(t) {
  console.log(`\n${'='.repeat(100)}\n${t}\n${'='.repeat(100)}`);
}
function h2(t) {
  console.log(`\n--- ${t} ${'-'.repeat(Math.max(0, 95 - t.length))}`);
}
function note(t) {
  for (const line of t.split('\n')) console.log(`  ${line}`);
}
function printTable(headers, rows) {
  const str = rows.map((r) => r.map((c) => (c == null ? '' : String(c))));
  const w = headers.map((h, i) => Math.max(h.length, ...str.map((r) => (r[i] || '').length)));
  const line = (cells) => cells.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  console.log(line(headers));
  console.log(w.map((x) => '-'.repeat(x)).join('  '));
  for (const r of str) console.log(line(r));
}

// ----------------------------------------------------------------- args ----
function parseArgs(argv) {
  const o = { section: 'all', seeds: null, days: 80, samples: null, minwin: 90, future: 1000, quick: false, help: false, set: [], ablate: [] };
  const ABLATIONS = ['gems', 'rings', 'skills', 'intel', 'repair'];
  for (let i = 0; i < argv.length; i++) {
    let a = argv[i];
    let v = null;
    if (a.startsWith('--') && a.includes('=')) [a, v] = [a.slice(0, a.indexOf('=')), a.slice(a.indexOf('=') + 1)];
    const val = () => {
      const x = v != null ? v : argv[++i];
      if (x == null) throw new Error(`${a} needs a value`);
      return x;
    };
    const num = () => {
      const n = Number(val());
      if (!Number.isFinite(n)) throw new Error(`${a} needs a number`);
      return n;
    };
    if (a === '--section') o.section = val();
    else if (a === '--seeds') o.seeds = num();
    else if (a === '--days') o.days = num();
    else if (a === '--samples') o.samples = num();
    else if (a === '--minwin') o.minwin = num();
    else if (a === '--future') o.future = num();
    else if (a === '--quick') o.quick = true;
    else if (a === '--ablate') {
      for (const x of val().split(',').map((y) => y.trim()).filter(Boolean)) {
        if (!ABLATIONS.includes(x)) throw new Error(`--ablate: unknown system ${x} (${ABLATIONS.join(', ')})`);
        o.ablate.push(x);
      }
    } else if (a === '--set') {
      const kv = val();
      const at = kv.indexOf('=');
      if (at < 1) throw new Error('--set needs path=value');
      o.set.push([kv.slice(0, at).trim(), kv.slice(at + 1).trim()]);
    } else if (a === '-h' || a === '--help') o.help = true;
    else throw new Error(`Unknown option ${a} (try --help)`);
  }
  if (!['all', 'economy', 'power', 'bot'].includes(o.section)) throw new Error(`Unknown section ${o.section}`);
  return o;
}

// Override CONFIG values in memory (what-if runs). Path segments are object keys or array indices;
// '*' matches every key / index at that level. The path must already exist (catches typos), and a
// number can only be replaced by a number. Returns ["path: old -> new", ...] for the report header.
function applySet(path, raw) {
  let value;
  try {
    value = JSON.parse(raw);
  } catch {
    value = raw;
  }
  const parts = path.split('.').filter((p) => p !== '');
  if (!parts.length) throw new Error('--set: empty path');
  const out = [];
  const walk = (obj, i, trail) => {
    const p = parts[i];
    if (obj == null || typeof obj !== 'object') throw new Error(`--set: ${trail.join('.') || 'CONFIG'} is not an object or array (in ${path})`);
    const keys = p === '*' ? Object.keys(obj) : [p];
    if (p !== '*' && !Object.prototype.hasOwnProperty.call(obj, p)) {
      const opts = Array.isArray(obj) ? `indices 0..${obj.length - 1}` : Object.keys(obj).join(', ');
      throw new Error(`--set: no CONFIG path ${[...trail, p].join('.')} (options here: ${opts})`);
    }
    for (const k of keys) {
      if (i < parts.length - 1) {
        walk(obj[k], i + 1, [...trail, k]);
        continue;
      }
      const old = obj[k];
      if (typeof old === 'number' && typeof value !== 'number') throw new Error(`--set: ${[...trail, k].join('.')} is a number; got ${JSON.stringify(value)}`);
      if (old !== null && typeof old === 'object' && (value === null || typeof value !== 'object')) {
        throw new Error(`--set: ${[...trail, k].join('.')} is an ${Array.isArray(old) ? 'array' : 'object'}; give JSON or set its fields`);
      }
      obj[k] = value !== null && typeof value === 'object' ? JSON.parse(JSON.stringify(value)) : value;
      out.push(`${[...trail, k].join('.')}: ${JSON.stringify(old)} -> ${JSON.stringify(value)}`);
    }
  };
  walk(CONFIG, 0, []);
  return out;
}

// ======================================================== shared helpers ====
const power = (material, grade) => cfg.gear.materialMult[material] * cfg.gear.gradeMult[grade];
const itemPower = (it) => power(it.material, it.grade);
let nextItemId = 1;
const mkItem = (slot, material, grade, gem = null) => ({ id: nextItemId++, slot, material, grade, gem, durability: 100, packed: false });
function setOf(material, grade, { swordGem = null, armorGem = null, slots = SLOTS } = {}) {
  return slots.map((s) => mkItem(s, material, grade, s === 'sword' ? swordGem : armorGem));
}
const ringSet = (grade, types = ADV_RINGS) => ringTotals(types.map((type) => ({ type, grade })));

// Expected loot of one cell, from the documented field formula.
function lootPct(dist, debris) {
  const L = cfg.field.lootChance;
  return Math.min(L.max, L.base + L.perDistance * (dist - 1)) + (debris ? cfg.field.debrisLootBonus : 0);
}
const ITEMS_PER_LOOT_CELL = (() => {
  let w = 0;
  let s = 0;
  for (const [k, v] of Object.entries(cfg.field.itemCountWeights)) {
    w += v;
    s += Number(k) * v;
  }
  return s / w;
})();
const cellPrior = (dist, debris) => (lootPct(dist, debris) / 100) * ITEMS_PER_LOOT_CELL;

// Share of items of each type ('ore:copper', 'gem:ruby', ...) at a field distance.
function itemShares(dist) {
  const f = cfg.field;
  const oreW = f.oreWeights[Math.max(0, Math.min(dist, f.oreWeights.length) - 1)];
  const gemW = f.gemWeights[Math.max(0, Math.min(dist, f.gemWeights.length) - 1)];
  const so = sum(Object.values(oreW));
  const sg = sum(Object.values(gemW));
  const out = {};
  for (const [k, v] of Object.entries(oreW)) out[`ore:${k}`] = ((f.oreShare / 100) * v) / so;
  for (const [k, v] of Object.entries(gemW)) out[`gem:${k}`] = ((1 - f.oreShare / 100) * v) / sg;
  return out;
}

// Search options for every 3x3 center of a field, using only what the player can see:
// revealed cells show their remaining items; every other cell uses the expected loot for the
// field's distance. Items have uniform hidden depths, so a search finds min(eff, left)/left of
// what is still in a cell. `clear` options clear the area's debris first; their rate spreads the
// clearing time over the searches the cleared cells will get (100/eff of them).
function centerOptions(st, field, vf, cleared) {
  const n = cfg.field.size;
  const eff = searchEfficiency(st);
  const sMin = searchMinutes(st);
  const cMin = debrisMinutesPerCell(st);
  const shares = itemShares(field.dist);
  let avgVal = 0;
  for (const [t, s] of Object.entries(shares)) avgVal += s * vf(t);
  const cv = field.cells.map((c, i) => {
    if (c.debris) {
      const it = (cellPrior(field.dist, true) * Math.min(eff, 100)) / 100;
      return { debris: true, items: it, val: it * avgVal };
    }
    if (c.searched >= 100 - EPS) return null;
    const left = 100 - c.searched;
    const frac = Math.min(eff, left) / left;
    if (c.revealed) {
      let v = 0;
      for (const it of c.items) v += vf(it.t);
      return { items: c.items.length * frac, val: v * frac };
    }
    const it = (cellPrior(field.dist, cleared.has(c)) * Math.min(eff, left)) / 100;
    return { items: it, val: it * avgVal };
  });
  const out = [];
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let sv = 0;
      let si = 0;
      let sc = 0;
      let dv = 0;
      let di = 0;
      let nd = 0;
      for (const i of areaCells(cx, cy)) {
        const c = cv[i];
        if (!c) continue;
        if (c.debris) {
          nd++;
          dv += c.val;
          di += c.items;
        } else {
          sc++;
          sv += c.val;
          si += c.items;
        }
      }
      if (sc && sv > EPS) out.push({ cx, cy, clear: false, nd: 0, val: sv, items: si, minutes: sMin, rate: sv / sMin });
      if (nd) {
        const amort = sMin + cMin * nd * Math.min(1, eff / 100);
        out.push({ cx, cy, clear: true, nd, val: sv + dv, items: si + di, minutes: sMin + cMin * nd, rate: (sv + dv) / amort });
      }
    }
  }
  return out;
}

// `reserve` = minutes to keep free at camp after walking home (time to process the haul).
function bestAction(st, field, vf, cleared, allowClear = true, reserve = 0) {
  const back = returnMinutes(st) + reserve;
  let best = null;
  for (const o of centerOptions(st, field, vf, cleared)) {
    if (o.clear && !allowClear) continue;
    if (st.time + o.minutes + back > DAY_END + EPS) continue;
    if (!best || o.rate > best.rate + 1e-12) best = o;
  }
  return best;
}

// Drop worthless items (onto cell 0, the dump) and pick up valuable items lying elsewhere.
function tidyBag(st, field, vf) {
  for (let i = st.bag.length - 1; i >= 0; i--) if (vf(st.bag[i]) <= 0) dropItem(st, i, 0);
  for (let i = 1; i < field.cells.length && st.bag.length < BAG; i++) {
    const c = field.cells[i];
    if (c.ground.length && c.ground.some((t) => vf(t) > 0)) pickUp(st, i);
  }
  for (let i = st.bag.length - 1; i >= 0; i--) if (vf(st.bag[i]) <= 0) dropItem(st, i, 0);
}

// One trip: walk to `target`, search (greedy best rate, clearing debris when worth it) until the
// bag is full, time runs out or the field is spent (optionally move on to another field), walk home.
function runTrip(st, target, p) {
  let r = travel(st, target);
  if (!r.ok) return { ok: false, msg: r.msg, carried: [], searches: 0, clears: 0 };
  p.log('travel', r.minutes);
  let moves = 0;
  let searches = 0;
  let clears = 0;
  let found = 0;
  for (let guard = 0; guard < 500; guard++) {
    const field = currentField(st);
    if (p.dump) tidyBag(st, field, p.vf);
    if (st.bag.length >= BAG) break;
    const act = bestAction(st, field, p.vf, p.cleared, p.allowClear !== false, p.reserve ? p.reserve(st) : 0);
    if (!act || act.rate < p.minRate) {
      if (p.allowMove && moves < 3 && p.chooseNext) {
        const next = p.chooseNext(st);
        if (next) {
          r = travel(st, next);
          if (r.ok) {
            p.log('travel', r.minutes);
            moves++;
            continue;
          }
        }
      }
      break;
    }
    if (act.clear) {
      const cells = areaCells(act.cx, act.cy).filter((i) => field.cells[i].debris);
      r = clearDebris(st, act.cx, act.cy);
      if (!r.ok) break;
      p.log('clear', r.minutes);
      clears++;
      for (const i of cells) p.cleared.add(field.cells[i]);
    }
    r = search(st, act.cx, act.cy);
    if (!r.ok) break;
    p.log('search', r.minutes);
    searches++;
    found += r.found.length + r.toGround.length;
  }
  const carried = [...st.bag];
  if (!atCamp(st)) {
    r = travel(st, st.map.camp);
    p.log('travel', r.minutes);
  }
  return { ok: true, carried, searches, clears, moves, found };
}

// ============================================================== ECONOMY =====
const BUCKETS = [1, 2, 3, 4, 5];
const bucketOf = (d) => Math.min(5, d);
const bucketLabel = (b) => (b === 5 ? '5+' : String(b));

function fieldsAt(st, b) {
  return st.map.cells.filter((c) => c.type === 'field' && bucketOf(c.dist) === b);
}

// Search a whole field (clock/bag reset before each action) to measure raw yield per search.
function exhaustField(st0, loc, clearAllDebris) {
  const st = deepClone(st0);
  st.location = { x: loc.x, y: loc.y };
  const field = currentField(st);
  const cleared = new WeakSet(); // cleared debris cells (cell objects: a regrown cell is a new object)
  let clearMin = 0;
  if (clearAllDebris) {
    const n = cfg.field.size;
    for (let cy = 1; cy < n + 1; cy += 3) {
      for (let cx = 1; cx < n + 1; cx += 3) {
        const x = Math.min(cx, n - 1);
        const y = Math.min(cy, n - 1);
        const cells = areaCells(x, y).filter((i) => field.cells[i].debris);
        if (!cells.length) continue;
        st.time = DAY_START;
        const r = clearDebris(st, x, y);
        if (r.ok) {
          clearMin += r.minutes;
          for (const i of cells) cleared.add(field.cells[i]);
        }
      }
    }
  }
  let searches = 0;
  let items = 0;
  for (let guard = 0; guard < 600; guard++) {
    st.time = DAY_START;
    st.bag = [];
    const act = bestAction(st, field, () => 1, cleared, false);
    if (!act) break;
    const r = search(st, act.cx, act.cy);
    if (!r.ok) break;
    searches++;
    items += r.found.length + r.toGround.length;
  }
  return { searches, items, clearMin };
}

function economySection(o) {
  const N = o.seeds ?? (o.quick ? 30 : 100);
  h1(`ECONOMY — ${N} generated maps, fresh games (skills 0, no rings, base intel)`);
  const states = [];
  for (let s = 0; s < N; s++) states.push(newGame(mixSeed(9001, s)));

  // ---- 1. field contents by distance
  const agg = Object.fromEntries(BUCKETS.map((b) => [b, { fields: 0, items: 0, debrisCells: 0, debrisItems: 0, types: {} }]));
  for (const st of states) {
    for (const c of st.map.cells) {
      if (c.type !== 'field') continue;
      const a = agg[bucketOf(c.dist)];
      a.fields++;
      for (const cell of st.map.fields[key(c.x, c.y)].cells) {
        if (cell.debris) {
          a.debrisCells++;
          a.debrisItems += cell.items.length;
        }
        for (const it of cell.items) {
          a.items++;
          a.types[it.t] = (a.types[it.t] || 0) + 1;
        }
      }
    }
  }
  h2('1a. What a field holds, by distance from camp (generated maps)');
  printTable(
    ['dist', 'fields/map', 'items/field', 'ores', 'gems', 'debris cells', 'items under debris'],
    BUCKETS.map((b) => {
      const a = agg[b];
      const per = (v) => (a.fields ? v / a.fields : NaN);
      const ores = sum(Object.entries(a.types).filter(([t]) => t.startsWith('ore:')).map(([, v]) => v));
      return [bucketLabel(b), f2(a.fields / N), f1(per(a.items)), f1(per(ores)), f1(per(a.items - ores)), f1(per(a.debrisCells)), f1(per(a.debrisItems))];
    }),
  );
  const totals = {};
  for (const b of BUCKETS) for (const [t, v] of Object.entries(agg[b].types)) totals[t] = (totals[t] || 0) + v;
  note(`Whole map, per run: ${f0(sum(Object.values(totals)) / N)} items = ` +
    [...ORES.map((x) => `ore:${x}`), ...GEMS.map((x) => `gem:${x}`)].map((t) => `${t.split(':')[1]} ${f0((totals[t] || 0) / N)}`).join(', ') + '.');
  {
    const cellsPerMap = sum(BUCKETS.map((b) => agg[b].fields)) / N * cfg.field.size ** 2;
    const itemsPerMap = sum(Object.values(totals)) / N;
    const r = cfg.field.regrowPctPerDay || 0;
    note(`Regrowth: each searched cell has ${r}%/night to refill. On a fully searched map that is ~${f0((cellsPerMap * r) / 100)} fresh cells ` +
      `(~${f1((itemsPerMap * r) / 100)} items) per night across all fields, i.e. the long-run supply cap once the map is spent.`);
  }

  h2('1b. Ore / gem mix: expected count per field (and % of items)');
  const typeCols = [...ORES.map((x) => `ore:${x}`), ...GEMS.map((x) => `gem:${x}`)];
  printTable(
    ['dist', ...typeCols.map((t) => t.split(':')[1])],
    BUCKETS.map((b) => {
      const a = agg[b];
      return [bucketLabel(b), ...typeCols.map((t) => (a.fields ? `${f1((a.types[t] || 0) / a.fields)} (${f0((100 * (a.types[t] || 0)) / Math.max(1, a.items))}%)` : '-'))];
    }),
  );

  // ---- 2. full-field yield per search (no travel), with and without clearing debris
  const ex = Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, s: 0, i: 0, sD: 0, iD: 0, cD: 0 }]));
  states.forEach((st, si) => {
    const rng = seededRng(mixSeed(77, si));
    for (const b of BUCKETS) {
      const fs = fieldsAt(st, b);
      if (!fs.length) continue;
      const c = rng.pick(fs);
      const a = exhaustField(st, c, false);
      const d = exhaustField(st, c, true);
      const e = ex[b];
      e.n++;
      e.s += a.searches;
      e.i += a.items;
      e.sD += d.searches;
      e.iD += d.items;
      e.cD += d.clearMin;
    }
  });
  const sMin = cfg.field.searchMin;
  h2(`2. Searching a whole field (greedy 3x3 picks, ${sMin} min/search, ${cfg.field.searchEfficiency}% per search, no travel)`);
  printTable(
    ['dist', 'searches (no debris)', 'items', 'items/search', 'min/item', '| debris: clear min', 'extra searches', 'extra items', 'min/extra item'],
    BUCKETS.filter((b) => ex[b].n).map((b) => {
      const e = ex[b];
      const k = (v) => v / e.n;
      const extraS = k(e.sD - e.s);
      const extraI = k(e.iD - e.i);
      return [bucketLabel(b), f1(k(e.s)), f1(k(e.i)), f2(e.i / e.s), f1((e.s * sMin) / e.i), f0(k(e.cD)), f1(extraS), f1(extraI), f1((k(e.cD) + extraS * sMin) / extraI)];
    }),
  );
  note('min/extra item = (clearing minutes + the extra searches the cleared cells need) / items found under debris.\n' +
    'Lower than plain searching means clearing debris is a good deal (debris cells are richer and share searches).');

  // ---- 3. trips and days including travel
  const trip = Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, min: 0, items: 0, full: 0, tm: { travel: 0, search: 0, clear: 0 }, dayN: 0, dayItems: 0, dayMin: 0, dayTypes: {} }]));
  const vf1 = () => 1;
  states.forEach((st0, si) => {
    const rng = seededRng(mixSeed(78, si));
    for (const b of BUCKETS) {
      const fs = fieldsAt(st0, b);
      if (!fs.length) continue;
      const c = rng.pick(fs);
      const T = trip[b];
      // one trip from 8:00
      {
        const st = deepClone(st0);
        const tm = { travel: 0, search: 0, clear: 0 };
        const res = runTrip(st, c, { vf: vf1, cleared: new WeakSet(), log: (k, m) => (tm[k] += m), minRate: 0.002, allowMove: false, dump: false });
        T.n++;
        T.min += st.time - DAY_START;
        T.items += res.carried.length;
        if (res.carried.length >= BAG) T.full++;
        for (const k of Object.keys(tm)) T.tm[k] += tm[k];
      }
      // a whole day of repeated trips to that field
      {
        const st = deepClone(st0);
        const cleared = new WeakSet();
        let items = 0;
        for (let t = 0; t < 6; t++) {
          const res = runTrip(st, c, { vf: vf1, cleared, log: () => {}, minRate: 0.002, allowMove: false, dump: false });
          if (!res.ok || !res.carried.length) break;
          items += res.carried.length;
          for (const it of res.carried) T.dayTypes[it] = (T.dayTypes[it] || 0) + 1;
        }
        T.dayN++;
        T.dayItems += items;
        T.dayMin += st.time - DAY_START;
      }
    }
  });
  h2(`3a. One trip from 8:00: walk out, search until the bag (${BAG}) is full or time is up, walk home`);
  printTable(
    ['dist', 'trip min', 'items', 'min/item', 'bag full %', 'travel min', 'search min', 'clear min', '| items/day (repeat trips)', 'min used/day'],
    BUCKETS.filter((b) => trip[b].n).map((b) => {
      const T = trip[b];
      return [bucketLabel(b), f0(T.min / T.n), f1(T.items / T.n), f1(T.min / T.items), f0((100 * T.full) / T.n), f0(T.tm.travel / T.n), f0(T.tm.search / T.n), f0(T.tm.clear / T.n), f1(T.dayItems / T.dayN), f0(T.dayMin / T.dayN)];
    }),
  );

  // minutes per unit of each raw material (all of a day's minutes charged to that material)
  const minPer = {};
  const rowsType = ['ore:copper', 'ore:iron', 'ore:coal', 'ore:mythril', 'steel pair', 'any gem', 'any item'];
  for (const r of rowsType) minPer[r] = {};
  for (const b of BUCKETS) {
    const T = trip[b];
    if (!T.dayN) continue;
    const ty = T.dayTypes;
    const gems = sum(GEMS.map((g) => ty[`gem:${g}`] || 0));
    for (const t of ['ore:copper', 'ore:iron', 'ore:coal', 'ore:mythril']) minPer[t][b] = ty[t] ? T.dayMin / ty[t] : Infinity;
    const pairs = Math.min(ty['ore:iron'] || 0, ty['ore:coal'] || 0);
    minPer['steel pair'][b] = pairs ? T.dayMin / pairs : Infinity;
    minPer['any gem'][b] = gems ? T.dayMin / gems : Infinity;
    minPer['any item'][b] = T.dayItems ? T.dayMin / T.dayItems : Infinity;
  }
  const bestMin = {};
  for (const r of rowsType) {
    let best = Infinity;
    let bb = null;
    for (const b of BUCKETS) if (minPer[r][b] < best) [best, bb] = [minPer[r][b], b];
    bestMin[r] = { min: best, b: bb };
  }
  h2('3b. Minutes of field work per unit of a material (a whole day at that distance charged to it)');
  printTable(
    ['material', ...BUCKETS.map((b) => `d${bucketLabel(b)}`), 'best'],
    rowsType.map((r) => [r.replace('ore:', ''), ...BUCKETS.map((b) => f1(minPer[r][b])), `${f1(bestMin[r].min)} @d${bestMin[r].b ? bucketLabel(bestMin[r].b) : '-'}`]),
  );
  note('Upper bound: by-products (other ores, gems) are ignored. "steel pair" = 1 iron + 1 coal.');

  // ---- 4. refining / cutting outcomes
  h2('4. Refining and cutting: outcome % per input, minutes, and minutes per C-or-better bar');
  const rows = [];
  for (const bar of BARS) {
    const r = cfg.refine[bar];
    const d = r.dist;
    const pC = (d.S + d.A + d.B + d.C) / 100;
    const pB = (d.S + d.A + d.B) / 100;
    const inp = Object.entries(r.input).map(([k, v]) => `${v} ${k}`).join(' + ');
    rows.push([`${bar} bar`, inp, r.minutes, d.S, d.A, d.B, d.C, d.D, d.F, f2((100 - d.F) / 100), f1(r.minutes / pC), f1(r.minutes / pB)]);
  }
  for (const gem of GEMS) {
    const r = cfg.cut[gem];
    const d = r.dist;
    rows.push([`${gem} cut`, `1 ${gem}`, r.minutes, d.S, d.A, d.B, d.C, d.D, d.F, f2((100 - d.F) / 100), f1(r.minutes / ((d.S + d.A + d.B + d.C) / 100)), f1(r.minutes / ((d.S + d.A + d.B) / 100))]);
  }
  printTable(['output', 'input', 'min', 'S%', 'A%', 'B%', 'C%', 'D%', 'F%', 'out/in', 'min per C+', 'min per B+'], rows);
  const maxSk = cfg.skills.maxLevel;
  const up10 = cfg.skills.perMaterial.oreGrade.perLevel * maxSk;
  const fail10 = cfg.skills.perMaterial.oreFail.perLevel * maxSk;
  const ringUp = cfg.rings.types.oreGrade.values[4] * (1 + cfg.rings.duplicateFactor);
  const adj = (bar, f, u) => adjustDistribution(cfg.refine[bar].dist, f, u);
  printTable(
    ['bar', 'base S/A/B/C/D/F', `skill ${maxSk} (+${f1(up10)}% up, -${f1(fail10)} fail)`, `+2 S bar-luck rings (+${f1(ringUp)}% up)`],
    BARS.map((bar) => {
      const show = (d) => ['S', 'A', 'B', 'C', 'D', 'F'].map((g) => f1(d[g])).join('/');
      return [bar, show(cfg.refine[bar].dist), show(adj(bar, fail10, up10)), show(adj(bar, fail10, up10 + ringUp))];
    }),
  );
  const xpL10 = (cfg.skills.xpBase * maxSk * (maxSk + 1)) / 2;
  note(`Per-material skills need ${xpL10} XP for level ${maxSk} = items of that one material: ` +
    [...BARS, ...GEMS].map((m) => `${m} ${f0(xpL10 / Math.max(1e-9, itemXp(m, cfg)))}`).join(', ') + '.');

  // ---- 5. full sets
  h2('5. A full 5-piece set (sword 2 + chest 3 + helmet 2 + gloves 2 + boots 2 = 11 bars)');
  note('Each piece needs all its bars of ONE grade. "matched >= G" = every piece grade G or better (pieces may differ).\n' +
    '"all-G" = 11 bars of exactly grade G (a uniform set): expected inputs = 11 / P(G).');
  const trials = o.quick ? 300 : 2000;
  const setRows = [];
  const minRows = [];
  const setDays = {};
  for (const bar of BARS) {
    const dist = cfg.refine[bar].dist;
    const rng = seededRng(mixSeed(55, BARS.indexOf(bar)));
    const ore = {};
    for (const gmin of [0, 1, 2, 3]) {
      let tot = 0;
      for (let t = 0; t < trials; t++) {
        const cnt = [0, 0, 0, 0, 0];
        let n = 0;
        while (!canBuildSet(cnt, gmin) && n < 20000) {
          n++;
          const g = rollGrade(rng, dist);
          if (g !== 'F') cnt[GRADES.indexOf(g)]++;
        }
        tot += n;
      }
      ore[gmin] = tot / trials;
    }
    const allC = 11 / (dist.C / 100);
    const allS = 11 / (dist.S / 100);
    const unit = bar === 'steel' ? 'pairs' : 'ore';
    setRows.push([bar, unit, f1(ore[0]), f1(ore[1]), f1(ore[2]), f1(ore[3]), f0(allC), f0(allS)]);
    const mineKey = bar === 'steel' ? 'steel pair' : `ore:${bar}`;
    const mm = bestMin[mineKey].min;
    const rm = cfg.refine[bar].minutes;
    const smith = 11 * cfg.gear.smithMinPerBar;
    for (const [lbl, g] of [['>=D', 0], ['>=C', 1], ['>=B', 2]]) {
      const mine = ore[g] * mm;
      const ref = ore[g] * rm;
      const total = mine + ref + smith;
      minRows.push([`${bar} ${lbl}`, f0(ore[g]), f0(mine), f0(ref), f0(smith), f0(total), f1(total / DAY_LEN)]);
      if (g === 0) setDays[bar] = total / DAY_LEN;
    }
  }
  printTable(['material', 'input', 'matched >=D', 'matched >=C', 'matched >=B', 'matched >=A', 'all-C', 'all-S'], setRows);
  printTable(['set', 'inputs', 'mining min', 'refining min', 'smithing min', 'total min', `work days (${DAY_LEN} min)`], minRows);
  note('Mining minutes use the best distance from 3b (dedicated trips, by-products ignored, skills 0).\n' +
    'Versus the 11-bar minimum, "matched >=D" shows the overhead from failures and grade spread.');

  console.log(`\nECONOMY SUMMARY | items/search by dist ${BUCKETS.filter((b) => ex[b].n).map((b) => `d${bucketLabel(b)}:${f2(ex[b].i / ex[b].s)}`).join(' ')}` +
    ` | one trip d1/d3: ${f0(trip[1].min / trip[1].n)}/${trip[3].n ? f0(trip[3].min / trip[3].n) : '-'} min for ${f1(trip[1].items / trip[1].n)}/${trip[3].n ? f1(trip[3].items / trip[3].n) : '-'} items` +
    ` | field min per unit: ${['ore:copper', 'ore:iron', 'steel pair', 'ore:mythril', 'any gem'].map((r) => `${r.replace('ore:', '')} ${f0(bestMin[r].min)}`).join(', ')}` +
    ` | full set >=D work days: ${BARS.map((b) => `${b} ${f1(setDays[b])}`).join(', ')}` +
    ` | map mythril/run ${f1((totals['ore:mythril'] || 0) / N)}`);
  return { bestMin };
}

// Can the bar counts (index = grade D..S) build chest (3) + four 2-bar pieces, each from one grade >= gmin?
function canBuildSet(cnt, gmin) {
  for (let g = gmin; g < 5; g++) {
    if (cnt[g] < 3) continue;
    let pairs = 0;
    for (let h = gmin; h < 5; h++) pairs += Math.floor((cnt[h] - (h === g ? 3 : 0)) / 2);
    if (pairs >= 4) return true;
  }
  return false;
}

// ================================================================ POWER =====
function winPct(gear, rings, tier, day, S, E, seed) {
  return estimateWinChanceSync({ gearItems: gear, ringTotals: rings, tier, day, known: {}, seed }, { samples: S, fightsPerLoadout: 10, evalFights: E }).winPct;
}

const LADDER = [
  ['copper', 'D'], ['copper', 'B'], ['iron', 'D'], ['iron', 'C'], ['iron', 'B'], ['iron', 'A'],
  ['steel', 'D'], ['steel', 'C'], ['steel', 'B'], ['steel', 'A'],
  ['mythril', 'D'], ['mythril', 'C'], ['mythril', 'B'], ['mythril', 'A'], ['mythril', 'S'],
];

// How much each gem / ring / slot is worth: win-% change vs a reference fight (steel C full set vs
// an elite on the day that set wins about half the time). Also used by the bot to weigh choices.
function valueTables(S, E) {
  const base = setOf('steel', 'C');
  let refDay = 2;
  let bestDiff = Infinity;
  for (let d = 2; d <= 60; d++) {
    const w = winPct(base, {}, 'elite', d, 30, 20, mixSeed(7, d));
    if (Math.abs(w - 50) < bestDiff) [bestDiff, refDay] = [Math.abs(w - 50), d];
    if (w < 25) break;
  }
  const seed = mixSeed(4242, refDay);
  const W = (gear, rings = {}) => winPct(gear, rings, 'elite', refDay, S, E, seed);
  const baseW = W(base);
  const withGem = (slots, type, grade) => base.map((it) => (slots.includes(it.slot) ? { ...it, gem: { type, grade } } : it));
  const gems = {};
  for (const g of GEMS) {
    gems[g] = {
      swordC: W(withGem(['sword'], g, 'C')) - baseW,
      swordS: W(withGem(['sword'], g, 'S')) - baseW,
      chestC: W(withGem(['chest'], g, 'C')) - baseW,
      armor4C: W(withGem(ARMOR_SLOTS, g, 'C')) - baseW,
    };
  }
  const rings = {};
  for (const t of ADV_RINGS) {
    rings[t] = {
      B: W(base, ringTotals([{ type: t, grade: 'B' }])) - baseW,
      S: W(base, ringTotals([{ type: t, grade: 'S' }])) - baseW,
    };
  }
  const all10B = W(base, ringSet('B')) - baseW;
  const slots = {};
  for (const s of SLOTS) {
    slots[s] = {
      up: W(base.map((it) => (it.slot === s ? { ...it, material: 'mythril' } : it))) - baseW,
      remove: W(base.filter((it) => it.slot !== s)) - baseW,
    };
  }
  return { refDay, baseW, gems, rings, all10B, slots, S, E };
}

function printValueTables(T) {
  h2(`Value of gems, rings and slots: win-% change for a steel C full set vs an elite on day ${T.refDay} (base ${f1(T.baseW)}%)`);
  printTable(
    ['gem', 'sword C', 'sword S', 'chest C', 'all 4 armor C', 'weapon effect (C)', 'armor effect (C)'],
    GEMS.map((g) => {
      const e = cfg.gemEffects[g];
      const show = (side) => Object.entries(e[side]).map(([k, arr]) => `${k} ${arr[1]}`).join(', ');
      return [g, f1(T.gems[g].swordC), f1(T.gems[g].swordS), f1(T.gems[g].chestC), f1(T.gems[g].armor4C), show('weapon'), show('armor')];
    }),
  );
  printTable(
    ['adventurer ring', 'one B ring', 'one S ring', 'B value', 'desc'],
    ADV_RINGS.map((t) => [t, f1(T.rings[t].B), f1(T.rings[t].S), cfg.rings.types[t].values[2], cfg.rings.types[t].desc]),
  );
  note(`All 10 adventurer ring types at grade B together: ${f1(T.all10B)} points.`);
  printTable(['slot', 'steel C -> mythril C', 'remove the piece'], SLOTS.map((s) => [s, f1(T.slots[s].up), f1(T.slots[s].remove)]));
}

// Day-1 gear the player can realistically smith (one trip + refining leaves time for 1-3 pieces).
const DAY1_LOADOUTS = [
  { name: 'Copper D sword', gear: () => [mkItem('sword', 'copper', 'D')] },
  { name: 'Copper C sword', gear: () => [mkItem('sword', 'copper', 'C')] },
  { name: 'Copper C sword + C boots', gear: () => setOf('copper', 'C', { slots: ['sword', 'boots'] }) },
  { name: 'Copper C sword + C chest', gear: () => setOf('copper', 'C', { slots: ['sword', 'chest'] }) },
  { name: 'Copper C sword + C chest + C boots', gear: () => setOf('copper', 'C', { slots: ['sword', 'chest', 'boots'] }), ref: true },
  { name: 'Copper D sword + D helmet + D gloves', gear: () => setOf('copper', 'D', { slots: ['sword', 'helmet', 'gloves'] }) },
  { name: 'Copper B sword + B chest + B boots', gear: () => setOf('copper', 'B', { slots: ['sword', 'chest', 'boots'] }) },
  { name: 'Copper C sword +ruby C + C boots', gear: () => setOf('copper', 'C', { swordGem: { type: 'ruby', grade: 'C' }, slots: ['sword', 'boots'] }) },
  { name: 'Copper C full set (lucky day 1)', gear: () => setOf('copper', 'C') },
  { name: 'Iron C sword + copper C boots', gear: () => [mkItem('sword', 'iron', 'C'), mkItem('boots', 'copper', 'C')] },
];
const DAY2_TARGET = { normal: [85, 95], elite: [40, 65], champion: [0, 20] };

function powerSection(o, T) {
  const S = o.samples ?? (o.quick ? 20 : 100);
  const E = o.quick ? 20 : 50;
  h1(`POWER CURVE — win % vs a typical enemy of each tier: all attributes hidden (${S} attribute guesses x ${E} fights per cell)`);

  // ---- 1. the first fight
  const S2 = o.quick ? 40 : 200;
  h2(`1. Day-2 fight with day-1 gear (target: normal ${DAY2_TARGET.normal.join('-')}%, elite ${DAY2_TARGET.elite.join('-')}%, champion < ${DAY2_TARGET.champion[1]}%; ${S2} x ${E} fights)`);
  const day2 = DAY1_LOADOUTS.map((l) => ({ ...l, w: Object.fromEntries(TIERS.map((t, ti) => [t, winPct(l.gear(), {}, t, 2, S2, E, mixSeed(222, ti))])) }));
  const mark = (t, v) => (v < DAY2_TARGET[t][0] - EPS ? ' (low)' : v > DAY2_TARGET[t][1] + EPS ? ' (high)' : '');
  printTable(['day-1 loadout', ...TIERS.map((t) => `vs ${t}`)], day2.map((l) => [`${l.ref ? '* ' : '  '}${l.name}`, ...TIERS.map((t) => `${f1(l.w[t])}${mark(t, l.w[t])}`)]));
  note('* = the reference "sensible day 1" used in the summary line. (low)/(high) = outside the target band.');

  // ---- 2. archetypes over time
  const days = [2, 5, 10, 15, 20, 30, 40, 50, 60, 80];
  const C = (t, gr) => ({ type: t, grade: gr });
  const ARCH = [
    { name: 'Unarmed', gear: [] },
    { name: 'Copper D sword only', gear: [mkItem('sword', 'copper', 'D')] },
    { name: 'Copper D full', gear: setOf('copper', 'D') },
    { name: 'Copper B full', gear: setOf('copper', 'B') },
    { name: 'Iron C full', gear: setOf('iron', 'C') },
    { name: 'Steel C full', gear: setOf('steel', 'C') },
    { name: 'Mythril C full', gear: setOf('mythril', 'C') },
    { name: 'Mythril S full', gear: setOf('mythril', 'S') },
    { name: 'Iron C + ruby C sword', gear: setOf('iron', 'C', { swordGem: C('ruby', 'C') }) },
    { name: 'Iron C + diamond C sword + emerald C armor', gear: setOf('iron', 'C', { swordGem: C('diamond', 'C'), armorGem: C('emerald', 'C') }) },
    { name: 'Steel C + ruby C sword + 10 C rings', gear: setOf('steel', 'C', { swordGem: C('ruby', 'C') }), rings: ringSet('C') },
    { name: 'Mythril C + ruby B sword + 10 B rings', gear: setOf('mythril', 'C', { swordGem: C('ruby', 'B') }), rings: ringSet('B') },
    { name: 'CEILING: Mythril S + ruby S + emerald S armor + 10 S rings', gear: setOf('mythril', 'S', { swordGem: C('ruby', 'S'), armorGem: C('emerald', 'S') }), rings: ringSet('S') },
  ];
  const arch = {};
  for (const [ti, tier] of TIERS.entries()) {
    const t = cfg.enemies.tiers[tier];
    h2(`2${'abc'[ti]}. vs ${tier.toUpperCase()} (base HP ${t.hp}, damage ${t.damage}, defense ${t.defense}%, +${cfg.enemies.growthPerDay.hpDamage}%/day HP & damage, +${cfg.enemies.growthPerDay.ratings}%/day acc & dodge)`);
    arch[tier] = ARCH.map((a) => days.map((d) => winPct(a.gear, a.rings || {}, tier, d, S, E, mixSeed(ti, d))));
    printTable(['loadout', ...days.map((d) => `d${d}`)], ARCH.map((a, i) => [a.name, ...arch[tier][i].map(f1)]));
  }

  // ---- 3. weakest full set per day that keeps the target win rate
  const targets = { normal: 90, elite: 70, champion: 50 };
  const ldays = [2, 3, 5, 7, 10, 12, 15, 20, 25, 30, 40, 50, 60, 70, 80];
  h2(`3. Weakest plain full set (no gems, no rings) that keeps >= ${targets.normal}% vs normal / ${targets.elite}% vs elite / ${targets.champion}% vs champion`);
  const sets = LADDER.map(([m, g]) => setOf(m, g));
  const rows = [];
  const weakest = {};
  for (const d of ldays) {
    const row = [`day ${d}`];
    for (const [ti, tier] of TIERS.entries()) {
      const cache = {};
      const w = (i) => (cache[i] ??= winPct(sets[i], {}, tier, d, S, E, mixSeed(100 + ti, d)));
      let lo = 0;
      let hi = LADDER.length - 1;
      if (w(hi) < targets[tier]) {
        row.push(`none (myth S ${f0(w(hi))}%)`);
        (weakest[tier] ||= {})[d] = null;
        continue;
      }
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (w(mid) >= targets[tier]) hi = mid;
        else lo = mid + 1;
      }
      (weakest[tier] ||= {})[d] = lo;
      row.push(`${LADDER[lo][0]} ${LADDER[lo][1]} (${f0(w(lo))}%)`);
    }
    rows.push(row);
  }
  printTable(['day', `normal >=${targets.normal}%`, `elite >=${targets.elite}%`, `champion >=${targets.champion}%`], rows);
  note('Ladder by power (material x grade): ' + LADDER.map(([m, g]) => `${m[0].toUpperCase()}${g}=${f2(power(m, g))}`).join(' '));
  note('Reading: the target progression (iron ~d5-8, steel ~d12-18, mythril ~d25+) should roughly match the "elite" column.');

  const VT = T ?? valueTables(o.quick ? 40 : 200, o.quick ? 20 : 50);
  printValueTables(VT);

  const ref = day2.find((l) => l.ref);
  const lastDay = (tier, idx, thr) => {
    let last = '-';
    days.forEach((d, j) => {
      if (arch[tier][idx][j] >= thr) last = d;
    });
    return last;
  };
  const archIdx = (name) => ARCH.findIndex((a) => a.name === name);
  console.log(`\nPOWER SUMMARY | day-2 ref (${ref.name}) n/e/c ${TIERS.map((t) => f0(ref.w[t])).join('/')}%` +
    ` | Cu D sword n/e/c ${TIERS.map((t) => f0(day2[0].w[t])).join('/')}%` +
    ` | last day >=90% vs normal: ${['Copper B full', 'Iron C full', 'Steel C full', 'Mythril C full', 'Mythril S full'].map((n) => `${n.replace(' full', '')} d${lastDay('normal', archIdx(n), 90)}`).join(', ')}` +
    ` | >=70% vs elite: ${['Copper B full', 'Iron C full', 'Steel C full', 'Mythril C full', 'Mythril S full'].map((n) => `${n.replace(' full', '')} d${lastDay('elite', archIdx(n), 70)}`).join(', ')}` +
    ` | ceiling vs normal d60/d80 ${f0(arch.normal[ARCH.length - 1][days.indexOf(60)])}/${f0(arch.normal[ARCH.length - 1][days.indexOf(80)])}%`);
  return VT;
}

// ================================================================== BOT =====
// A careful scripted player. It only sees what a player sees (visible enemy attributes, revealed
// cells, expected field loot) and uses the same API as the UI. Heuristics, not an optimiser.
const MAT_RANK = { none: 0, copper: 1, iron: 2, steel: 3, mythril: 4 };
// Grade a bar of this material must reach to still be worth gathering for an upgrade.
// The best material keeps being worth chasing up to A grade; older materials up to B.
const WORTH_GRADE = { copper: 'B', iron: 'B', steel: 'B', mythril: 'A' };

function botParams(T, o) {
  // win % per unit of slot power (upgrade steel C 2.2 -> mythril C 3.3)
  const dp = power('mythril', 'C') - power('steel', 'C');
  const slotW = {};
  for (const s of SLOTS) slotW[s] = Math.max(1, T.slots[s].up) / dp;
  const gemSword = {};
  const gemArmor = {};
  for (const g of GEMS) {
    gemSword[g] = Math.max(0, T.gems[g].swordC);
    gemArmor[g] = Math.max(0, T.gems[g].chestC) / cfg.gear.gemArmorMult.chest;
  }
  const ringW = {};
  for (const t of ADV_RINGS) ringW[t] = Math.max(0.01, T.rings[t].B) / cfg.rings.types[t].values[2];
  const smithW = { travelTime: 1, searchTime: 1, searchEff: 0.5, reveal: 0.4, processTime: 1, oreGrade: 1.2, gemGrade: 0.3 };
  const ablate = new Set(o.ablate || []);
  const gemOrder = ablate.has('gems') ? [] : GEMS.filter((g) => Math.max(gemSword[g], gemArmor[g]) >= 2).sort((a, b) => Math.max(gemSword[b], gemArmor[b]) - Math.max(gemSword[a], gemArmor[a]));
  return {
    slotW, gemSword, gemArmor, ringW, smithW, gemOrder, ablate,
    minWin: o.minwin, future: o.future,
    simOpts: o.quick ? { samples: 8, fightsPerLoadout: 1, evalFights: 15 } : { samples: 24, fightsPerLoadout: 1, evalFights: 25 },
    verifyOpts: o.quick ? { samples: 10, fightsPerLoadout: 4, evalFights: 15 } : { samples: 30, fightsPerLoadout: 6, evalFights: 30 },
    verifyTop: 3,
    minRate: 0.003, minCraftGain: 1.0, minGemGain: 1.0, cutCap: 3, ironReserve: 4, reserveCap: 240,
    usableDur: 15, repairBelow: 85, restBelow: 40,
  };
}

function gradeScale(type, side, grade) {
  const arr = Object.values(cfg.gemEffects[type][side])[0];
  return arr[GRADES.indexOf(grade)] / arr[1];
}

// Gem bonus in "slot power" units so it can be compared with material x grade.
function gemBonus(gem, slot, P) {
  if (!gem) return 0;
  if (slot === 'sword') return (P.gemSword[gem.type] * gradeScale(gem.type, 'weapon', gem.grade)) / P.slotW.sword;
  return (P.gemArmor[gem.type] * cfg.gear.gemArmorMult[slot] * gradeScale(gem.type, 'armor', gem.grade)) / P.slotW[slot];
}
const score = (it, P) => itemPower(it) + gemBonus(it.gem, it.slot, P);

function bestScore(st, slot, P) {
  let best = 0;
  for (const g of st.gear) if (g.slot === slot && g.durability > P.usableDur) best = Math.max(best, score(g, P));
  return best;
}
function slotBestPower(st, P) {
  const out = {};
  for (const s of SLOTS) out[s] = 0;
  for (const g of st.gear) if (g.durability > P.usableDur) out[g.slot] = Math.max(out[g.slot], itemPower(g));
  return out;
}
const hasSword = (st, P) => bestScore(st, 'sword', P) > 0;

// Bars still needed to fully repair the best item of each slot, by bar key ('iron:C': 0.7, ...).
function repairNeed(st, P) {
  const need = {};
  if (P.ablate.has('repair')) return need;
  for (const s of SLOTS) {
    const g = st.gear.filter((x) => x.slot === s).sort((a, b) => score(b, P) - score(a, P))[0];
    if (!g || g.durability >= 100) continue;
    for (const [k, n] of Object.entries(repairInfo(g).bars)) need[k] = (need[k] || 0) + n;
  }
  return need;
}
// Materials whose repair stock is short (less than one full repair of the worn items in storage).
function repairShort(st, P) {
  const short = new Set();
  for (const [k, n] of Object.entries(repairNeed(st, P))) if ((st.storage.bars[k] || 0) + EPS < n) short.add(k.split(':')[0]);
  return short;
}

// Which bars are still worth making: an upgrade for some slot, or repair stock for worn gear.
function worthFn(st, P) {
  const best = slotBestPower(st, P);
  const short = repairShort(st, P);
  return (bar) => short.has(bar) || SLOTS.some((s) => best[s] < power(bar, WORTH_GRADE[bar]) - EPS);
}

function cutStock(st, gem) {
  return sum(GRADES.map((g) => st.storage.cut[`${gem}:${g}`] || 0));
}

// Item value while gathering (0 = drop it).
function makeValueFn(st, P) {
  const v = {};
  if (!hasSword(st, P)) {
    // first sword: anything that makes a pair of same-grade bars soon
    Object.assign(v, { 'ore:copper': 1, 'ore:iron': 1, 'ore:coal': 0.2, 'ore:mythril': 0.5 });
    for (const g of GEMS) v[`gem:${g}`] = P.gemOrder.includes(g) ? 0.1 : 0;
    return (t) => v[t] ?? 0;
  }
  const worth = worthFn(st, P);
  v['ore:copper'] = worth('copper') ? 1 : 0;
  // iron for steel only while there is coal to pair it with (plus a small reserve)
  const ironForSteel = worth('steel') && st.storage.ore.iron < st.storage.ore.coal * ((cfg.refine.steel.input.iron || 1) / (cfg.refine.steel.input.coal || 1)) + P.ironReserve;
  v['ore:iron'] = Math.max(worth('iron') ? 1.5 : 0, ironForSteel ? 1 : 0);
  v['ore:coal'] = worth('steel') ? 1.5 : 0;
  v['ore:mythril'] = worth('mythril') ? 3 : 0.5;
  for (const g of GEMS) {
    const useful = P.gemOrder.includes(g);
    v[`gem:${g}`] = useful ? (cutStock(st, g) + (st.storage.gem[g] || 0) < P.cutCap + 2 ? 0.8 : 0.2) : 0;
  }
  return (t) => v[t] ?? 0;
}

const refineUnits = (st, bar) => Math.min(...Object.entries(cfg.refine[bar].input).map(([ore, n]) => Math.floor((st.storage.ore[ore] || 0) / n)));

function nextRefine(st, P) {
  const ore = st.storage.ore;
  if (!hasSword(st, P)) {
    // no sword yet: refine the material with the most ore first (best odds of a same-grade pair)
    const opts = BARS.filter((b) => refineUnits(st, b) >= 1).sort((a, b) => refineUnits(st, b) - refineUnits(st, a) || BARS.indexOf(b) - BARS.indexOf(a));
    return opts[0] || null;
  }
  const worth = worthFn(st, P);
  if (refineUnits(st, 'mythril') >= 1 && worth('mythril')) return 'mythril';
  if (refineUnits(st, 'steel') >= 1 && worth('steel')) return 'steel';
  const coalPerSteel = cfg.refine.steel.input.coal || 1;
  const ironPerSteel = cfg.refine.steel.input.iron || 0;
  const reserve = worth('steel') ? Math.ceil((ore.coal / coalPerSteel) * ironPerSteel) + P.ironReserve : 0;
  if (ore.iron - reserve >= (cfg.refine.iron.input.iron || 1) && worth('iron')) return 'iron';
  if (refineUnits(st, 'copper') >= 1 && worth('copper')) return 'copper';
  return null;
}

function nextCut(st, P) {
  if (!hasSword(st, P)) return null;
  for (const g of P.gemOrder) if ((st.storage.gem[g] || 0) >= 1 && cutStock(st, g) < P.cutCap) return g;
  return null;
}

function bestGem(st, slot, P) {
  let best = null;
  for (const [k, n] of Object.entries(st.storage.cut)) {
    if (n + EPS < 1) continue;
    const [type, grade] = k.split(':');
    const bonus = gemBonus({ type, grade }, slot, P);
    if (bonus * P.slotW[slot] < P.minGemGain) continue;
    if (!best || bonus > best.bonus) best = { type, grade, bonus };
  }
  return best;
}

function bestCraft(st, P) {
  let best = null;
  for (const slot of SLOTS) {
    const cur = bestScore(st, slot, P);
    const need = cfg.gear.slots[slot].bars;
    const gem = P.ablate.has('gems') ? null : bestGem(st, slot, P);
    for (const m of BARS) {
      for (const g of GRADES) {
        if ((st.storage.bars[`${m}:${g}`] || 0) + EPS < need) continue;
        for (const useGem of gem ? [gem, null] : [null]) {
          const sc = power(m, g) + (useGem ? useGem.bonus : 0);
          const gain = (sc - cur) * P.slotW[slot];
          if (gain < P.minCraftGain) continue;
          if (st.time + craftMinutes(slot, !!useGem) > DAY_END + EPS) continue;
          if (!best || gain > best.gain + 1e-9) best = { slot, material: m, grade: g, gem: useGem ? { type: useGem.type, grade: useGem.grade } : null, gain };
        }
      }
    }
  }
  return best;
}

function topTwoIds(st, P) {
  const ids = new Set();
  for (const s of SLOTS) {
    st.gear.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P)).slice(0, 2).forEach((g) => ids.add(g.id));
  }
  return ids;
}

function repairAffordable(st, item) {
  const info = repairInfo(item);
  for (const [k, n] of Object.entries(info.bars)) if ((st.storage.bars[k] || 0) + EPS < n) return false;
  for (const [k, n] of Object.entries(info.gems)) if ((st.storage.cut[k] || 0) + EPS < n) return false;
  return true;
}

function nextRepair(st, P, tried) {
  if (P.ablate.has('repair')) return null;
  const top = topTwoIds(st, P);
  const c = st.gear
    .filter((g) => !g.packed && !tried.has(g.id) && top.has(g.id) && g.durability < P.repairBelow && repairAffordable(st, g))
    .sort((a, b) => score(b, P) * P.slotW[b.slot] - score(a, P) * P.slotW[a.slot]);
  return c[0] || null;
}

function campWork(st, ctx, rec) {
  const P = ctx.P;
  if (!atCamp(st) || st.phase !== 'work') return;
  const log = (cat, r) => {
    if (r && r.ok && r.minutes) ctx.tm[cat] += r.minutes;
    return r;
  };
  const tryCraft = () => {
    const c = bestCraft(st, P);
    if (!c) return false;
    const r = log('smith', craft(st, c));
    if (!r.ok) return false;
    rec.crafted++;
    if (c.gem) rec.gemsUsed++;
    rec.craftLog.push({ day: st.day, slot: c.slot, material: c.material, grade: c.grade, gem: c.gem ? `${c.gem.type} ${c.gem.grade}` : '' });
    return true;
  };
  // Refine everything worth refining first so the best bars are known before choosing what to craft;
  // craft as soon as bars allow when there is no sword yet or time is getting short.
  for (let guard = 0; guard < 300; guard++) {
    const job = nextRefine(st, P);
    if (!job) break;
    if (!hasSword(st, P) || refineUnits(st, job) * refineMinutes(st, job) + 60 > DAY_END - st.time) while (tryCraft());
    const r = log('refine', refine(st, job));
    if (!r.ok) break;
    if (r.grade !== 'F') rec.bars[job] = (rec.bars[job] || 0) + 1;
  }
  // Cut gems first only if that still leaves an hour for smithing; otherwise smith first.
  const cutAll = GEMS.reduce((a, g) => a + (P.gemOrder.includes(g) ? (st.storage.gem[g] || 0) * cutMinutes(st, g) : 0), 0);
  if (DAY_END - st.time < 60 + cutAll) while (tryCraft());
  for (let guard = 0; guard < 100; guard++) {
    const g = nextCut(st, P);
    if (!g) break;
    if (!log('cut', cut(st, g)).ok) break;
  }
  while (tryCraft());
  const tried = new Set();
  if (!P.ablate.has('repair')) {
    // item-days where a worn top item could not be repaired for lack of same material+grade bars
    const top = topTwoIds(st, P);
    for (const g of st.gear) if (top.has(g.id) && !g.packed && g.durability < P.repairBelow && !repairAffordable(st, g)) rec.repairBlocked[st.day] = (rec.repairBlocked[st.day] || 0) + 1;
  }
  for (let guard = 0; guard < 50; guard++) {
    const it = nextRepair(st, P, tried);
    if (!it) break;
    tried.add(it.id);
    const info = repairInfo(it);
    const r = log('repair', repair(st, it.id));
    if (r.ok) {
      rec.repaired++;
      rec.repairBars += sum(Object.values(info.bars));
      rec.repairPct += info.missing;
    }
  }
}

// Greedy ring choice with the duplicate penalty. weights = value per unit of ring value.
function pickRings(rings, weights, max) {
  const chosen = [];
  const left = rings.filter((r) => (weights[r.type] || 0) > 0);
  for (let k = 0; k < max; k++) {
    const cur = ringTotals(chosen);
    let best = null;
    let bestGain = 1e-9;
    for (const r of left) {
      if (chosen.includes(r)) continue;
      const gain = ((ringTotals([...chosen.filter((c) => c.type === r.type), r])[r.type] || 0) - (cur[r.type] || 0)) * weights[r.type];
      if (gain > bestGain) [best, bestGain] = [r, gain];
    }
    if (!best) break;
    chosen.push(best);
  }
  return chosen;
}

function wearSmithRings(st, P) {
  if (P.ablate.has('rings')) return;
  const mine = st.rings.filter((r) => ringDef(r.type).owner === 'smith');
  const want = new Set(pickRings(mine, P.smithW, cfg.rings.maxWorn).map((r) => r.id));
  for (const r of wornRings(st, 'smith')) if (!want.has(r.id)) toggleRing(st, r.id);
  for (const r of mine) if (want.has(r.id) && !r.worn) toggleRing(st, r.id);
}

// Camp minutes needed to process what is in the bag and smith, so the haul becomes gear today.
function campReserve(st, P) {
  const worth = worthFn(st, P);
  const noSword = !hasSword(st, P);
  const missing = SLOTS.filter((s) => bestScore(st, s, P) <= 0).length;
  let m = craftMinutes('helmet', false) * Math.max(1, Math.min(3, missing)); // smithing: one 2-bar piece, or up to 3 missing pieces
  for (const t of st.bag) {
    const [kind, type] = t.split(':');
    if (kind === 'gem') m += !noSword && P.gemOrder.includes(type) ? cutMinutes(st, type) : 0;
    else if (type === 'mythril') m += noSword || worth('mythril') ? refineMinutes(st, 'mythril') : 0;
    else if (type === 'coal') m += !noSword && worth('steel') ? refineMinutes(st, 'steel') : 0;
    else if (type === 'iron') m += noSword || worth('iron') ? refineMinutes(st, 'iron') : 0;
    else if (type === 'copper') m += noSword || worth('copper') ? refineMinutes(st, 'copper') : 0;
  }
  return Math.min(P.reserveCap, m);
}

// Expected camp minutes per item found at a field distance: refine/cut time of the items worth
// keeping (worthless ones are dropped) plus half a bar's smithing for each ore kept.
function procPerFoundItem(st, P, dist, vf) {
  const bar = { copper: 'copper', iron: 'iron', coal: 'steel', mythril: 'mythril' };
  let m = 0;
  for (const [t, share] of Object.entries(itemShares(dist))) {
    if (vf(t) <= 0) continue;
    const [kind, type] = t.split(':');
    m += share * (kind === 'gem' ? cutMinutes(st, type) : refineMinutes(st, bar[type]) + 0.5 * cfg.gear.smithMinPerBar);
  }
  return m;
}

function chooseField(st, ctx, vf, from) {
  const P = ctx.P;
  const sMin = searchMinutes(st);
  // camp time already committed (processing the current bag + smithing) and the rough processing
  // time of each item a search will add, so the planned haul still becomes gear today
  const committed = campReserve(st, P);
  let best = null;
  // No sword yet (day 1): stay at the closest fields (most copper, short walks, more time to smith).
  const fields = st.map.cells.filter((c) => c.type === 'field');
  const maxDist = hasSword(st, P) ? Infinity : Math.min(...fields.map((c) => c.dist)) + 1;
  for (const c of fields) {
    if (sameLoc(c, from) || c.dist > maxDist) continue;
    const tOut = travelMinutes(st, from, c, st.bag.length);
    const tBack = travelMinutes(st, c, st.map.camp, BAG);
    const field = st.map.fields[key(c.x, c.y)];
    const opts = centerOptions(st, field, vf, ctx.cleared).sort((a, b) => b.rate - a.rate);
    if (!opts.length) continue;
    const top0 = opts.slice(0, 4);
    const itemsPerSearch = mean(top0.map((x) => (x.items * sMin) / x.minutes));
    const perSearch = sMin + Math.min(P.reserveCap, itemsPerSearch * procPerFoundItem(st, P, c.dist, vf));
    const avail = DAY_END - st.time - committed - tOut - tBack;
    const nAvail = Math.floor(avail / perSearch);
    if (nAvail < 1) continue;
    const top = opts.slice(0, Math.max(1, Math.ceil(nAvail / 4)));
    const ratePerMin = mean(top.map((x) => x.rate));
    const space = Math.max(0, BAG - st.bag.length);
    const nNeed = Math.min(nAvail, Math.ceil(space / Math.max(0.1, itemsPerSearch)));
    const gain = ratePerMin * nNeed * sMin;
    const rate = gain / (tOut + tBack + nNeed * sMin);
    if (rate >= P.minRate && (!best || rate > best.rate)) best = { loc: { x: c.x, y: c.y }, rate };
  }
  return best;
}

function workDay(st, ctx, rec) {
  wearSmithRings(st, ctx.P);
  campWork(st, ctx, rec);
  let trips = 0;
  for (; trips < 5; trips++) {
    const vf = makeValueFn(st, ctx.P);
    const target = chooseField(st, ctx, vf, st.map.camp);
    if (!target) break;
    const res = runTrip(st, target.loc, {
      vf, cleared: ctx.cleared, log: (c, m) => (ctx.tm[c] += m), minRate: ctx.P.minRate, allowMove: true, dump: true,
      reserve: (s) => campReserve(s, ctx.P),
      chooseNext: (s) => {
        const n = chooseField(s, ctx, vf, s.location);
        return n ? n.loc : null;
      },
    });
    if (!res.ok) break;
    rec.tripDist.push(st.map.cells.find((c) => sameLoc(c, target.loc)).dist);
    rec.tripItems.push(res.carried.length);
    for (const t of res.carried) rec.gathered[t] = (rec.gathered[t] || 0) + 1;
    campWork(st, ctx, rec);
  }
  rec.tripsByDay[st.day] = trips;
  spareTime(st, ctx, rec);
}

// Nothing left worth a trip: cut the remaining useful raw gems (better grades for infusions), then
// smith any upgrade that made possible. A player with spare minutes at camp would do the same.
function spareTime(st, ctx, rec) {
  const P = ctx.P;
  if (!atCamp(st) || !hasSword(st, P)) return;
  let cutAny = false;
  for (let guard = 0; guard < 100; guard++) {
    const g = P.gemOrder.find((x) => (st.storage.gem[x] || 0) >= 1);
    if (!g) break;
    const r = cut(st, g);
    if (!r.ok) break;
    ctx.tm.cut += r.minutes;
    cutAny = true;
  }
  if (cutAny) campWork(st, ctx, rec);
}

function spendIntelPoints(st, P) {
  if (P.ablate.has('intel')) return;
  for (let guard = 0; guard < 20 && st.intel.points >= 1; guard++) {
    const track = intelChance(st, 'enemySight') < 80 ? 'enemySight' : intelChance(st, 'oreSight') < 40 ? 'oreSight' : 'ringTypeSight';
    if (!spendIntel(st, track).ok) break;
  }
}

function choosePlan(st, ctx, rec) {
  const P = ctx.P;
  const gearIds = [];
  for (const slot of SLOTS) {
    const items = st.gear.filter((g) => g.slot === slot).sort((a, b) => score(b, P) - score(a, P));
    let pick = items.slice(0, 2);
    // leave a worn-out best piece home for a day so it can be repaired (packed gear can't be)
    if (items.length >= 2 && items[0].durability <= P.restBelow && repairAffordable(st, items[0]) && !P.ablate.has('repair')) pick = items.slice(1, 3);
    gearIds.push(...pick.map((g) => g.id));
  }
  const advRings = P.ablate.has('rings') ? [] : st.rings.filter((r) => ringDef(r.type).owner === 'adventurer');
  const ringIds = pickRings(advRings, P.ringW, cfg.rings.maxWorn).map((r) => r.id);
  const rings = ringTotals(st.rings.filter((r) => ringIds.includes(r.id)));
  const packed = st.gear.filter((g) => gearIds.includes(g.id));
  // Screen all 7 with the best packed piece per slot (fast, a slight underestimate), then
  // re-estimate the top candidates with all packed gear and fresh seeds (removes the
  // "picked the luckiest estimate" bias) and choose among those.
  const primary = SLOTS.map((s) => packed.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P))[0]).filter(Boolean);
  const est = (gear, e, i, salt, opts) => estimateWinChanceSync({ gearItems: gear, ringTotals: rings, tier: e.tier, day: e.day, known: knownLevels(st, e), seed: mixSeed(ctx.seed, st.day, i, salt) }, opts).winPct;
  const evOf = (x) => (x.p / 100) * (cfg.enemies.tiers[x.tier].score + P.future);
  const evals = st.roster.enemies.map((e, i) => {
    const x = { i, tier: e.tier, p: est(primary, e, i, 1, P.simOpts) };
    x.ev = evOf(x);
    return x;
  });
  const order = [...evals].sort((a, b) => b.ev - a.ev);
  for (const x of order.slice(0, P.verifyTop)) {
    x.p = est(packed, st.roster.enemies[x.i], x.i, 2, P.verifyOpts);
    x.ev = evOf(x);
  }
  const pool = order.slice(0, P.verifyTop);
  const safe = pool.filter((x) => x.p >= P.minWin);
  const pick = safe.length ? safe.reduce((a, b) => (b.ev > a.ev ? b : a)) : pool.reduce((a, b) => (b.p > a.p ? b : a));
  const bestP = {};
  const meanP = {};
  for (const t of TIERS) {
    bestP[t] = Math.max(...evals.filter((x) => x.tier === t).map((x) => x.p));
    meanP[t] = mean(evals.filter((x) => x.tier === t).map((x) => x.p));
  }
  rec.picks.push({ day: st.day + 1, tier: pick.tier, p: pick.p, safe: safe.length > 0, bestP, meanP });
  return { enemyIndex: pick.i, gearIds, ringIds };
}

function snapshot(st, P) {
  const best = {};
  for (const s of SLOTS) {
    const items = st.gear.filter((g) => g.slot === s && g.durability > 0).sort((a, b) => score(b, P) - score(a, P));
    best[s] = items[0] || null;
  }
  const swordDmg = best.sword ? gearStats(best.sword).damage : cfg.adventurer.unarmedDamage;
  const defense = sum(ARMOR_SLOTS.map((s) => (best[s] ? gearStats(best[s]).defense || 0 : 0)));
  const powers = Object.fromEntries(SLOTS.map((s) => [s, best[s] ? itemPower(best[s]) : 0]));
  const mats = Object.fromEntries(SLOTS.map((s) => [s, best[s] ? best[s].material : 'none']));
  const label = Object.fromEntries(SLOTS.map((s) => [s, best[s] ? `${best[s].material} ${best[s].grade}${best[s].gem ? '+' + best[s].gem.type[0] : ''}` : '-']));
  const gems = SLOTS.filter((s) => best[s] && best[s].gem).length;
  return { score: st.stats.score, swordDmg, defense, powers, mats, label, gems, rings: st.rings.length };
}

function runBot(seed, D, P) {
  const st = newGame(seed);
  const ctx = { P, cleared: new WeakSet(), seed, tm: null };
  const rec = {
    seed, deathDay: null, lastDay: 1, timeByDay: {}, tripsByDay: {}, snaps: {}, picks: [], gathered: {}, bars: {},
    crafted: 0, repaired: 0, repairBars: 0, repairPct: 0, gemsUsed: 0, destroyed: 0, craftLog: [], tripDist: [], tripItems: [],
    wornOut: 0, wornOutMat: {}, repairBlocked: {},
  };
  for (;;) {
    const day = st.day;
    ctx.tm = Object.fromEntries(TIME_CATS.map((c) => [c, 0]));
    workDay(st, ctx, rec);
    rec.timeByDay[day] = ctx.tm;
    const before = st.gear.map((g) => ({ id: g.id, slot: g.slot, material: g.material }));
    const r = endDay(st);
    for (const g of before) {
      if (st.gear.some((x) => x.id === g.id)) continue; // gone after the fight = worn down to 0%
      rec.wornOut += cfg.gear.slots[g.slot].bars;
      rec.wornOutMat[g.material] = (rec.wornOutMat[g.material] || 0) + cfg.gear.slots[g.slot].bars;
    }
    if (!r.ok) throw new Error(`seed ${seed} day ${day}: endDay failed: ${r.msg}`);
    if (r.report) {
      const pk = rec.picks.find((x) => x.day === day);
      if (pk) {
        pk.win = r.report.win;
        pk.draw = r.report.draw;
      }
      rec.destroyed += r.report.destroyed.length;
    }
    rec.lastDay = day;
    rec.snaps[day] = snapshot(st, P);
    if (st.phase === 'over') {
      rec.deathDay = day;
      break;
    }
    if (st.phase === 'report') acknowledgeReport(st);
    if (day >= D) break;
    spendIntelPoints(st, P);
    const c = confirmPlan(st, choosePlan(st, ctx, rec));
    if (!c.ok) throw new Error(`seed ${seed} day ${day}: confirmPlan failed: ${c.msg}`);
  }
  rec.score = st.stats.score;
  rec.wins = { ...st.stats.wins };
  rec.rings = st.rings.map((r) => ({ type: r.type, grade: r.grade, worn: r.worn }));
  rec.skills = Object.fromEntries(Object.entries(st.skills).map(([k, v]) => [k, v.level]));
  rec.intel = { ...st.intel.spent };
  rec.oreLeft = { ...st.storage.ore };
  rec.gemLeft = { ...st.storage.gem };
  const sb = smithBonuses(st);
  rec.smithBonus = Object.fromEntries(Object.entries(sb).filter(([, v]) => typeof v === 'number'));
  rec.advRingTotals = P.ablate.has('rings') ? {} : ringTotals(pickRings(st.rings.filter((r) => ringDef(r.type).owner === 'adventurer'), P.ringW, cfg.rings.maxWorn));
  rec.fieldsTouched = Object.values(st.map.fields).filter((f) => f.cells.some((c) => c.searched > 0)).length;
  rec.mapProgress = mean(Object.values(st.map.fields).map((f) => mean(f.cells.map((c) => c.searched))));
  return rec;
}

// First day (end of day) on which pred(snapshot) holds, or NaN.
function firstDay(r, pred) {
  for (let d = 1; d <= r.lastDay; d++) if (r.snaps[d] && pred(r.snaps[d])) return d;
  return NaN;
}
const slotsAtLeast = (sn, m) => SLOTS.filter((s) => MAT_RANK[sn.mats[s]] >= MAT_RANK[m]).length;
const PROGRESS_TARGET = { iron: '5-8', steel: '12-18', mythril: '25+' };

function botSection(o, T) {
  const N = o.seeds ?? (o.quick ? 3 : 20);
  const D = o.quick ? Math.min(o.days, 40) : o.days;
  const VT = T ?? valueTables(o.quick ? 30 : 150, o.quick ? 15 : 40);
  const P = botParams(VT, o);
  h1(`BOT — ${N} runs x up to ${D} days (pick: max win% x (points + ${P.future}) among enemies with est. win >= ${P.minWin}%)` +
    (P.ablate.size ? `  ABLATED: ${[...P.ablate].join(', ')}` : ''));
  note(`Gem order: ${P.gemOrder.join(' > ') || '(none)'}; slot weights (win% per power unit): ` + SLOTS.map((s) => `${s} ${f1(P.slotW[s])}`).join(', '));
  note(`Adventurer ring weights (win% per ring point): ` + ADV_RINGS.map((t) => `${t} ${f2(P.ringW[t])}`).join(', '));
  const t0 = Date.now();
  const recs = [];
  for (let s = 0; s < N; s++) recs.push(runBot(mixSeed(31337, s), D, P));
  note(`(${((Date.now() - t0) / 1000).toFixed(1)}s)`);
  const dayList = (arr) => arr.filter((d) => d <= D);

  // ---- survival
  h2('Survival');
  const checkDays = dayList([2, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80, 100]);
  const alive = (r, d) => r.lastDay >= d && !(r.deathDay != null && r.deathDay <= d);
  const alivePct = (d) => (100 * recs.filter((r) => alive(r, d)).length) / N;
  printTable(['day', ...checkDays.map(String)], [['% alive (end of day)', ...checkDays.map((d) => f0(alivePct(d)))]]);
  const deaths = recs.filter((r) => r.deathDay != null);
  const deathDays = deaths.map((r) => r.deathDay).sort((a, b) => a - b);
  note(`Deaths: ${deaths.length}/${N} by day ${D}. Death days: ${deathDays.join(', ') || 'none'}; median ${f1(median(deathDays))}` +
    ` (runs alive at day ${D} count as > ${D}: median lifetime ${median(recs.map((r) => r.deathDay ?? Infinity)) === Infinity ? `> ${D}` : f1(median(recs.map((r) => r.deathDay ?? Infinity)))}).`);
  for (const r of deaths.slice(0, 12)) {
    const pk = r.picks.find((x) => x.day === r.deathDay);
    const sn = r.snaps[r.deathDay - 1] || {};
    note(`  seed#${recs.indexOf(r)} died day ${r.deathDay} vs ${pk ? pk.tier : '?'} (est. win ${pk ? f0(pk.p) : '?'}%${pk && !pk.safe ? ', no safe option' : ''}); gear: ${sn.label ? SLOTS.map((s) => sn.label[s]).join(' / ') : '?'}`);
  }

  h2('Score');
  const scores = recs.map((r) => r.score);
  note(`Score: mean ${f0(mean(scores))}, median ${f0(median(scores))}, min ${Math.min(...scores)}, max ${Math.max(...scores)}. ` +
    `Wins per run: ${TIERS.map((t) => `${t} ${f1(mean(recs.map((r) => r.wins[t])))}`).join(', ')}.`);

  // ---- tiers chosen + calibration + risk
  h2('Fights chosen (share per day range), estimate vs result, and risk per fight');
  const ranges = [[2, 5], [6, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 80], [81, 120]].filter(([a]) => a <= D);
  const pickRows = ranges.map(([a, b]) => {
    const pk = recs.flatMap((r) => r.picks.filter((x) => x.day >= a && x.day <= b && x.win !== undefined));
    const losses = pk.filter((x) => !x.win && !x.draw).length;
    return { a, b, pk, losses };
  });
  printTable(
    ['days', 'fights', ...TIERS.map((t) => `${t} %`), 'mean est. win %', 'actual win %', 'loss per fight %', 'no-safe-option fights'],
    pickRows.map(({ a, b, pk, losses }) => [`${a}-${b}`, pk.length, ...TIERS.map((t) => f0((100 * pk.filter((x) => x.tier === t).length) / Math.max(1, pk.length))),
      f1(mean(pk.map((x) => x.p))), f1((100 * pk.filter((x) => x.win || x.draw).length) / Math.max(1, pk.length)), f1((100 * losses) / Math.max(1, pk.length)), pk.filter((x) => !x.safe).length]),
  );
  h2("Best estimated win % on each day's roster with the bot's own gear (mean over runs alive)");
  const pdays = dayList([2, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80]);
  printTable(
    ['tier', ...pdays.map((d) => `d${d}`)],
    TIERS.map((t) => [t, ...pdays.map((d) => f0(mean(recs.flatMap((r) => r.picks.filter((x) => x.day === d).map((x) => x.bestP[t])))))]),
  );
  const d2picks = recs.flatMap((r) => r.picks.filter((x) => x.day === 2));
  const day1 = recs.map((r) => r.craftLog.filter((c) => c.day === 1));
  const d1label = (c) => `${c.material[0].toUpperCase()}${c.grade} ${c.slot}`;
  note(`Day-2 fight with the bot's day-1 gear, TYPICAL enemy (mean est. over the roster's enemies of the tier): ` +
    TIERS.map((t) => `${t} ${f0(mean(d2picks.map((x) => x.meanP[t])))}%`).join(', ') + ` (target ${DAY2_TARGET.normal.join('-')} / ${DAY2_TARGET.elite.join('-')} / <${DAY2_TARGET.champion[1]}).`);
  note(`Day-1 smithing: ${f1(mean(day1.map((c) => c.length)))} pieces/run; e.g. ${day1.slice(0, 6).map((cs) => cs.map(d1label).join(' + ') || 'nothing').join(' | ')}`);

  // ---- gear over time
  h2('Gear over time (end of day, runs still alive)');
  const gdays = dayList([1, 2, 3, 5, 7, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80]);
  const modal = (arr) => {
    const c = {};
    for (const x of arr) c[x] = (c[x] || 0) + 1;
    const e = Object.entries(c).sort((a, b) => b[1] - a[1])[0];
    return e ? e[0] : '-';
  };
  printTable(
    ['day', 'alive', 'sword dmg', 'total def %', ...SLOTS.map((s) => `${s} pow`), 'slots>=iron', '>=steel', '>=myth', 'gems', 'common sword', 'common chest', 'rings', 'score'],
    gdays.map((d) => {
      const sn = recs.map((r) => r.snaps[d]).filter(Boolean);
      return [d, sn.length, f1(mean(sn.map((x) => x.swordDmg))), f1(mean(sn.map((x) => x.defense))), ...SLOTS.map((s) => f2(mean(sn.map((x) => x.powers[s])))),
        f1(mean(sn.map((x) => slotsAtLeast(x, 'iron')))), f1(mean(sn.map((x) => slotsAtLeast(x, 'steel')))), f1(mean(sn.map((x) => slotsAtLeast(x, 'mythril')))),
        f1(mean(sn.map((x) => x.gems))), modal(sn.map((x) => x.label.sword)), modal(sn.map((x) => x.label.chest)), f1(mean(sn.map((x) => x.rings))), f0(mean(sn.map((x) => x.score)))];
    }),
  );
  h2('Progression milestones (median day over runs that got there; target in brackets)');
  const prog = {};
  const progRows = ['iron', 'steel', 'mythril'].map((m) => {
    const first = recs.map((r) => (r.craftLog.find((c) => MAT_RANK[c.material] >= MAT_RANK[m]) || { day: NaN }).day).filter(Number.isFinite);
    const sword = recs.map((r) => firstDay(r, (sn) => MAT_RANK[sn.mats.sword] >= MAT_RANK[m])).filter(Number.isFinite);
    const three = recs.map((r) => firstDay(r, (sn) => slotsAtLeast(sn, m) >= 3)).filter(Number.isFinite);
    const all = recs.map((r) => firstDay(r, (sn) => slotsAtLeast(sn, m) >= 5)).filter(Number.isFinite);
    prog[m] = { first: median(first), three: median(three) };
    const fmt = (a) => `${f0(median(a))} (${a.length}/${N})`;
    return [`${m} [${PROGRESS_TARGET[m]}]`, fmt(first), fmt(sword), fmt(three), fmt(all)];
  });
  printTable(['material >=', 'first piece', 'sword', '3 of 5 slots', 'all 5 slots'], progRows);

  // ---- time split
  h2(`Daily time split (minutes per day, mean over days in range; day = ${DAY_LEN} min)`);
  const tr = [[1, 1], [2, 5], [6, 10], [11, 20], [21, 30], [31, 40], [41, 60], [61, 120]].filter(([a]) => a <= D);
  const daysIn = (a, b) => recs.flatMap((r) => Object.entries(r.timeByDay).filter(([d]) => d >= a && d <= b).map(([d, t]) => ({ t, trips: r.tripsByDay[d] || 0 })));
  const miningPct = (days) => {
    const mine = sum(days.map((x) => sum(MINING.map((c) => x.t[c]))));
    const used = sum(days.map((x) => sum(TIME_CATS.map((c) => x.t[c]))));
    return (100 * mine) / Math.max(1, used);
  };
  printTable(
    ['days', ...TIME_CATS, 'idle', 'mining % of used', 'trips/day'],
    tr.map(([a, b]) => {
      const days = daysIn(a, b);
      const m = (c) => mean(days.map((x) => x.t[c]));
      const used = sum(TIME_CATS.map(m));
      return [`${a}-${b}`, ...TIME_CATS.map((c) => f0(m(c))), f0(DAY_LEN - used), f0(miningPct(days)), f1(mean(days.map((x) => x.trips)))];
    }),
  );
  const tripHist = [0, 1, 2, 3, 4, 5].map((n) => [n, recs.flatMap((r) => Object.values(r.tripsByDay)).filter((x) => x === n).length]);
  const nDays = sum(tripHist.map(([, c]) => c));
  note(`Trips per day: ${tripHist.filter(([, c]) => c).map(([n, c]) => `${n}: ${f0((100 * c) / nDays)}%`).join(', ')}; items per trip: mean ${f1(mean(recs.flatMap((r) => r.tripItems)))}` +
    ` (bag ${BAG}; full ${f0((100 * recs.flatMap((r) => r.tripItems).filter((x) => x >= BAG).length) / Math.max(1, recs.flatMap((r) => r.tripItems).length))}% of trips).`);

  // ---- economy of the bot
  h2('What the bot gathered and made (per run)');
  const types = [...ORES.map((x) => `ore:${x}`), ...GEMS.map((x) => `gem:${x}`)];
  printTable(['raw item', ...types.map((t) => t.split(':')[1])], [
    ['gathered', ...types.map((t) => f0(mean(recs.map((r) => r.gathered[t] || 0))))],
    ['left unprocessed', ...types.map((t) => f0(mean(recs.map((r) => (t.startsWith('ore:') ? r.oreLeft[t.slice(4)] : r.gemLeft[t.slice(4)]) || 0))))],
  ]);
  const barsMade = mean(recs.map((r) => sum(Object.values(r.bars))));
  const repairBars = mean(recs.map((r) => r.repairBars));
  const repairMin = mean(recs.map((r) => sum(Object.values(r.timeByDay).map((t) => t.repair))));
  const usedMin = mean(recs.map((r) => sum(Object.values(r.timeByDay).map((t) => sum(TIME_CATS.map((c) => t[c]))))));
  note(`Bars made: ${BARS.map((b) => `${b} ${f0(mean(recs.map((r) => r.bars[b] || 0)))}`).join(', ')}. ` +
    `Crafted ${f1(mean(recs.map((r) => r.crafted)))} items (${f1(mean(recs.map((r) => r.gemsUsed)))} with gems). ` +
    `Map searched: ${f0(mean(recs.map((r) => r.mapProgress)))}% (fields touched ${f1(mean(recs.map((r) => r.fieldsTouched)))}).`);
  const wornOut = mean(recs.map((r) => r.wornOut));
  note(`Durability: ${f1(mean(recs.map((r) => r.repaired)))} repairs/run (${f0(mean(recs.map((r) => r.repairPct)))} durability points), ` +
    `${f1(repairBars)} bars spent on repairs = ${f1((100 * repairBars) / Math.max(1, barsMade))}% of bars made, repair time ${f1((100 * repairMin) / Math.max(1, usedMin))}% of working time; ` +
    `${f1(mean(recs.map((r) => r.destroyed)))} items destroyed by wear (${f1(wornOut)} bars = ${f1((100 * wornOut) / Math.max(1, barsMade))}% of bars made; ` +
    BARS.map((b) => `${b} ${f1(mean(recs.map((r) => r.wornOutMat[b] || 0)))}`).join(', ') + ').');
  note(`Repair blocked (a worn top-2 item below ${P.repairBelow}% with no bars of its exact material+grade in storage): ` +
    `${f1(mean(recs.map((r) => Object.keys(r.repairBlocked).length)))} days/run, ${f1(mean(recs.map((r) => sum(Object.values(r.repairBlocked)))))} item-days/run.`);
  note('Trips per run by field distance: ' + [1, 2, 3, 4, 5].map((d) => `d${d === 5 ? '5+' : d} ${f1(mean(recs.map((r) => r.tripDist.filter((x) => Math.min(5, x) === d).length)))}`).join(', ') +
    `; mean trip distance ${f2(mean(recs.flatMap((r) => r.tripDist)))}.`);

  // ---- rings, skills, intel
  h2('Rings, skills, intel (end of run)');
  const gi = (g) => GRADES.indexOf(g);
  note(`Rings collected: ${f1(mean(recs.map((r) => r.rings.length)))} (smith ${f1(mean(recs.map((r) => r.rings.filter((x) => ringDef(x.type).owner === 'smith').length)))}, ` +
    `adventurer ${f1(mean(recs.map((r) => r.rings.filter((x) => ringDef(x.type).owner === 'adventurer').length)))}); mean grade ${f2(mean(recs.flatMap((r) => r.rings.map((x) => gi(x.grade)))))} (0=D..4=S).`);
  note('Adventurer ring totals worn at the end (mean): ' + ADV_RINGS.map((t) => `${t} ${f1(mean(recs.map((r) => r.advRingTotals[t] || 0)))}`).join(', '));
  note('Smith bonuses at the end (mean %, rings + skills + intel): ' + Object.keys(recs[0].smithBonus).map((k) => `${k} ${f1(mean(recs.map((r) => r.smithBonus[k])))}`).join(', '));
  const skillKeys = Object.keys(recs[0].skills);
  const act = skillKeys.filter((k) => !k.includes('_'));
  const per = skillKeys.filter((k) => k.includes('_'));
  note('Activity skill levels: ' + act.map((k) => `${k} ${f1(mean(recs.map((r) => r.skills[k])))}`).join(', '));
  const perTop = per.map((k) => [k, mean(recs.map((r) => r.skills[k]))]).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  note('Per-material skill levels (non-zero): ' + (perTop.map(([k, v]) => `${k} ${f1(v)}`).join(', ') || 'none'));
  note('Intel spent: ' + Object.keys(recs[0].intel).map((k) => `${k} ${f1(mean(recs.map((r) => r.intel[k])))}`).join(', '));

  // ---- one-line summary for comparing what-if runs
  const mid = recs.flatMap((r) => r.picks.filter((x) => x.day >= 11 && x.day <= 30 && x.win !== undefined));
  const share = (arr, t) => f0((100 * arr.filter((x) => x.tier === t).length) / Math.max(1, arr.length));
  const d2 = recs.flatMap((r) => r.picks.filter((x) => x.day === 2));
  const life = median(recs.map((r) => r.deathDay ?? Infinity));
  console.log(`\nBOT SUMMARY | alive ${dayList([10, 20, 30, 40, 50, 60, 80]).map((d) => `d${d}:${f0(alivePct(d))}%`).join(' ')}` +
    ` | median life ${life === Infinity ? `>${D}` : f1(life)} | score ${f0(mean(scores))}` +
    ` | d2 typical est n/e/c ${TIERS.map((t) => f0(mean(d2.map((x) => x.meanP[t])))).join('/')}` +
    ` | first iron/steel/myth piece d${f0(prog.iron.first)}/${f0(prog.steel.first)}/${f0(prog.mythril.first)}` +
    ` | 3-slot iron/steel/myth d${f0(prog.iron.three)}/${f0(prog.steel.three)}/${f0(prog.mythril.three)}` +
    ` | d11-30 fights n/e/c ${TIERS.map((t) => share(mid, t)).join('/')}%` +
    ` | mining ${f0(miningPct(daysIn(2, D)))}% trips/day ${f1(mean(daysIn(2, D).map((x) => x.trips)))} idle ${f0(mean(daysIn(2, D).map((x) => DAY_LEN - sum(TIME_CATS.map((c) => x.t[c])))))}m` +
    ` | repair ${f1((100 * repairBars) / Math.max(1, barsMade))}% bars ${f1((100 * repairMin) / Math.max(1, usedMin))}% time`);
  return recs;
}

// ================================================================= MAIN =====
function main() {
  const o = ARGS;
  if (o.help) {
    console.log(readHelp());
    return;
  }
  if (SET_LOG.length) console.log(`WHAT-IF overrides (memory only):\n${SET_LOG.map((x) => `  ${x}`).join('\n')}`);
  const t0 = Date.now();
  let T = null;
  const run = (name, fn) => {
    const t = Date.now();
    fn();
    console.log(`\n[${name}: ${((Date.now() - t) / 1000).toFixed(1)}s]`);
  };
  if (o.section === 'all' || o.section === 'economy') run('economy', () => economySection(o));
  if (o.section === 'all' || o.section === 'power') run('power', () => (T = powerSection(o, null)));
  if (o.section === 'all' || o.section === 'bot') run('bot', () => botSection(o, T));
  console.log(`\n[total ${((Date.now() - t0) / 1000).toFixed(1)}s]`);
}

function readHelp() {
  const src = readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n');
  const out = [];
  for (const line of src.slice(2)) {
    if (!line.startsWith('//')) break;
    if (line.startsWith('// ====')) break;
    out.push(line.replace(/^\/\/ ?/, ''));
  }
  return out.join('\n');
}

export {
  applySet, parseArgs, workDay, choosePlan, spendIntelPoints, snapshot, runBot, botParams, valueTables, economySection, powerSection, botSection,
  centerOptions, chooseField, makeValueFn, campReserve, winPct, setOf, mkItem,
};

if (IS_MAIN) main();
