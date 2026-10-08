#!/usr/bin/env node
// ============================================================================
// SMITHSY BALANCE REPORT — is the pacing and difficulty sensible?
//
//   node tools/balance.mjs [--section economy|power|bot|benchmark|specials|estimator|all] [--seeds N] [--days N] [--samples N]
//                          [--minwin P] [--future F] [--ablate x,y] [--immortal] [--carry value|default]
//                          [--estimator game|bot] [--jobs N] [--quick] [--set path=value ...]
//
//   --section  which report to run (default: all = economy + power + bot; benchmark is separate)
//   --seeds    economy: generated maps (default 100); bot: runs (default 20; survival numbers move
//              by ~+-10 points between seed sets of this size, use 40+ to compare close what-ifs);
//              benchmark: runs (default 100, the fixed seed list mixSeed(31337, 0..N-1))
//   --days     bot: play up to this day (default 80; runs that are still alive then are cut off);
//              benchmark: default 100
//   --estimator  how the bot estimates win chances when it plans a fight. game = the in-game button: every
//              enemy, all packed gear, the game's own counts (CONFIG.sim + Battle simulation intel +
//              Foresight rings; the default for benchmark). bot = the bot's own larger two-stage estimate
//              (screen all 7, re-check the top 3; the default for the bot section, version-independent)
//   --jobs     benchmark: run the seeds in N parallel node processes (same numbers as 1 process)
//   --samples  power: hidden-attribute guesses per win-% cell (default 100, x50 fights each)
//   --minwin   bot: minimum estimated win % to accept a fight (default 90)
//   --future   bot: points one survival is worth when comparing fights (default 1000 = careful:
//              a 50-point champion needs >= 96% of the best normal's win chance)
//   --ablate   bot: play without some systems, comma separated: gems (never cut/infuse), rings (never
//              wear), skills (no skill levels), intel (never spend), repair (never repair)
//   --immortal bot: enemies deal no damage (memory only, set after the bot's value tables are built) and
//              the bot fights an elite every day without estimating, so no run ends early. Use it to see
//              how fast a surviving careful player uses up the finite map (the "Map supply" table)
//   --carry    what the bot (and the economy trips) take home from a field: 'value' (default) = the most
//              valuable items of bag + pile by the bot's value function, worthless items stay in the pile;
//              'default' = the game's defaultCarry (keep the bag, fill free slots with the rarest pile items)
//   --quick    small sample sizes (smoke test, a few seconds)
//   --set      what-if: override a CONFIG value in memory for this run only (repeatable). The path walks
//              object keys and array indices; '*' matches every key/index at that level; the value is
//              parsed as JSON (numbers, arrays, objects) and falls back to a plain string, e.g.
//                --set map.travelMinPerStep=30
//                --set field.byDistance.1.gemShare=0         (array index)
//                --set 'field.byDistance.*.ores.mythril=2'   (every row)
//                --set 'gear.durabilityLoss={"min":2,"max":4}'
//                --set 'refine.mythril.input={"mythril":2}'
//              js/config.js itself is never changed.
//
// Sections
//   economy  Uses the real map generation + search code on fresh games: items per search by field
//            distance, how much search effort goes into debris (searching clears it), what a trip finds
//            vs carries (finds go to the field's pile, a trip carries up to the bag size), ore/gem mix,
//            minutes per raw item including travel, bar and gem-cut grade odds, and the minutes needed to
//            mine + refine + smith a full set of each material.
//   power    Win % of loadouts vs each enemy tier over days (estimateWinChanceSync, all attributes
//            hidden = a typical enemy of the tier): the day-2 fight with day-1 gear, archetype sets,
//            the weakest full set that holds target win rates on each day, and how much each gem /
//            ring / gear slot is worth.
//   benchmark  Difficulty benchmark that works on any version: the careful bot (below) on a FIXED list of
//            seeds, reporting the SURVIVAL CURVE (% of runs still alive at day 5, 10, ... 100), the median
//            life and the mean score, as a table row, a one-line BENCHMARK summary and a markdown row for
//            docs/BENCHMARKS.md. Run the same command on two versions to compare how tough each is.
//   specials How dangerous each enemy special (magic, piercing, stun, slow) is and how much the matching
//            defence recovers, and how strong the adventurer's own gems and rings are against enemy
//            resistances: direct fight simulations of a plain C set (iron, steel, mythril) vs an elite on the
//            day that set wins about 55% (window of 7 days), one enemy attribute changed at a time.
//   estimator How accurate the in-game win-chance estimate is at 10x10, with a Foresight ring or Battle simulation
//            intel points, and at the old 40x30: wobble between presses and miss vs the true chance, at
//            several scouting levels (steel C set vs elites at about 55 / 75 / 90% true win).
//   bot      A scripted "careful" player that drives the real game API day by day (gather, refine,
//            cut, smith, repair, rings, intel; at night: the plan) and reports survival,
//            score, gear over time, the daily time split, rings, skills, the tiers it chose and how
//            much of the map's finite supply it has used (fields never refill).
//            In a field it searches (clearing debris on the way) until what is worth carrying fills the
//            bag, chooses what to carry (--carry) and leaves the rest in the field's pile; its trip choice
//            values items lying in piles (no search needed), so it comes back for them when worth it.
//
// Each section ends with a one-line SUMMARY that is easy to compare between what-if runs.
// Never edits config or core files. Every game state here is a throwaway copy; the yield
// measurements in `economy` reset the clock and bag of their scratch copies between searches.
// ============================================================================
import { CONFIG, BARS, GEMS, GRADES, SLOTS, ARMOR_SLOTS, TIERS, ORES } from '../js/config.js';
import { newGame, endDay, acknowledgeReport, confirmPlan } from '../js/core/game.js';
import {
  key, sameLoc, atCamp, currentField, areaCells, travelMinutes, returnMinutes, searchMinutes,
  searchEfficiencyRange, debrisClearMult, projectedLoad, fieldProgress, cellOpen,
  travel, search, defaultCarry, distanceRow, sightValue, sightShare, seenItems,
} from '../js/core/map.js';
import { adjustDistribution, blendCutTable, refineMinutes, cutMinutes, rollGrade, refine, cut } from '../js/core/processing.js';
import { gearStats, craftMinutes, smithMinutes, craft, repairInfo, repairPlan, repair, wearLoss } from '../js/core/gear.js';
import { ringDef, ringTotals, wornRings, toggleRing } from '../js/core/rings.js';
import { estimateWinChanceSync } from '../js/core/sim.js';
import { knownLevels, enemyCombatant, rollLevels } from '../js/core/enemies.js';
import { adventurerCombatant, fight } from '../js/core/combat.js';
import { spendIntel, intelValue } from '../js/core/intel.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { itemXp } from '../js/core/skills.js';
import { seededRng, mixSeed } from '../js/core/rng.js';
import { EPS, deepClone } from '../js/core/util.js';
import { VERSION } from '../js/version.js';
import * as mapMod from '../js/core/map.js'; // optional exports (freshCellCount, 1.2+) are read from here so this tool also runs on older versions
import * as simMod from '../js/core/sim.js'; // simCounts (1.2+): the in-game estimate sizes; older versions use CONFIG.sim
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

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
  const o = { section: 'all', seeds: null, days: null, samples: null, minwin: 90, future: 1000, quick: false, immortal: false, help: false, set: [], ablate: [], carry: 'value', estimator: null, jobs: 1, shard: null, emitJson: false };
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
    else if (a === '--estimator') {
      o.estimator = val();
      if (!['game', 'bot'].includes(o.estimator)) throw new Error('--estimator must be game or bot');
    } else if (a === '--jobs') o.jobs = Math.max(1, Math.floor(num()));
    else if (a === '--shard') {
      // internal: --shard i/k runs seeds i, i+k, ... (used by --jobs)
      const m = /^(\d+)\/(\d+)$/.exec(val());
      if (!m || +m[1] >= +m[2]) throw new Error('--shard needs i/k with i < k');
      o.shard = [+m[1], +m[2]];
    } else if (a === '--emit-json') o.emitJson = true; // internal: a --jobs child prints its raw run records as JSON
    else if (a === '--immortal') o.immortal = true;
    else if (a === '--carry') {
      o.carry = val();
      if (!['value', 'default'].includes(o.carry)) throw new Error('--carry must be value or default');
    }
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
  if (!['all', 'economy', 'power', 'bot', 'benchmark', 'specials', 'estimator'].includes(o.section)) throw new Error(`Unknown section ${o.section}`);
  if (o.days == null) o.days = o.section === 'benchmark' ? 100 : 80;
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
// The in-game estimate's sizes for this game state: simCounts (1.2+: CONFIG.sim + intel + Foresight rings);
// older versions have no such export and the estimator just uses CONFIG.sim.
const gameSimOpts = (st) => (simMod.simCounts ? simMod.simCounts(st) : {});

// Expected loot of one cell, from the documented field formula.
function lootPct(dist, debris) {
  return distanceRow(dist).loot + (debris ? cfg.field.debrisLootBonus : 0);
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
  const row = distanceRow(dist);
  const so = sum(Object.values(row.ores));
  const sg = sum(Object.values(f.gemWeights));
  const out = {};
  for (const [k, v] of Object.entries(row.ores)) out[`ore:${k}`] = ((1 - row.gemShare / 100) * v) / so;
  for (const [k, v] of Object.entries(f.gemWeights)) out[`gem:${k}`] = ((row.gemShare / 100) * v) / sg;
  return out;
}

// Expected % of a cell a search adds when `left` % is still unsearched: each cell rolls its own
// efficiency uniformly in [lo, hi] (searchEfficiencyRange), and a search never adds more than `left`.
// E[min(X, left)] for X ~ U(lo, hi).
function expectedSearched(lo, hi, left) {
  if (left <= lo + EPS) return left;
  if (hi - lo < EPS || left >= hi - EPS) return (lo + hi) / 2;
  return ((left * left - lo * lo) / 2 + left * (hi - left)) / (hi - lo);
}

// Search options for every 3x3 center of a field, using only what the player can see:
// the items the bot's sight shows count one by one; for the unseen part of a cell it uses the expected loot
// for the field's distance per item type, scaled by the share of that type the sight does NOT show
// (cellPrior x share_t x left/100 x (1 - sightShare(t, sight))); richer if the cell has or had debris.
// Boulders and finished cells are skipped.
// A cell's remaining value is spread evenly over the search effort it still needs: its debris
// (thickness / debris clear multiplier, cleared first) plus its unsearched %. Items have uniform
// hidden depths, so this is exact for the searched part and amortises debris clearing as progress
// (a search that only clears debris finds nothing now but brings the cell's items closer).
// A search puts E[min(eff, need)] effort into each cell (eff rolls per cell, see expectedSearched).
// `wasDebris` (WeakSet of cell objects) remembers cells the bot saw covered by debris.
function centerOptions(st, field, vf, wasDebris) {
  const n = cfg.field.size;
  const [lo, hi] = searchEfficiencyRange(st);
  const mult = debrisClearMult(st);
  const sMin = searchMinutes(st); // base minutes of a search (with the search-time reductions)
  const freshMin = cfg.field.freshCellMin || 0; // 1.2+: extra base minutes per never-searched cell in the 3x3
  const shares = itemShares(field.dist);
  const sight = sightValue(st);
  // value of the average unseen item of a type-mix at this sight: sum over types of share x (1 - sightShare) x value
  let unseenVal = 0;
  let unseenItems = 0;
  for (const [t, s] of Object.entries(shares)) {
    const u = s * (1 - sightShare(t, sight));
    unseenVal += u * vf(t);
    unseenItems += u;
  }
  const cv = field.cells.map((c) => {
    if (!cellOpen(c)) return null;
    if (c.debris > EPS) wasDebris.add(c);
    const left = 100 - c.searched;
    const need = c.debris / mult + left;
    const frac = expectedSearched(lo, hi, need) / need;
    const seen = seenItems(c, sight);
    let v = 0;
    for (const it of seen) v += vf(it.t);
    const prior = (cellPrior(field.dist, wasDebris.has(c)) * left) / 100;
    return { items: (seen.length + prior * unseenItems) * frac, val: (v + prior * unseenVal) * frac, debris: c.debris > EPS };
  });
  const out = [];
  for (let cy = 0; cy < n; cy++) {
    for (let cx = 0; cx < n; cx++) {
      let val = 0;
      let items = 0;
      let open = 0;
      let nd = 0;
      let fresh = 0;
      for (const i of areaCells(cx, cy)) {
        const c = cv[i];
        if (!c) continue;
        if (mapMod.freshCellCount && mapMod.cellFresh(field.cells[i])) fresh++;
        open++;
        if (c.debris) nd++;
        val += c.val;
        items += c.items;
      }
      // the game charges the reduced (base + freshCellMin x fresh cells); the reductions are a plain multiplier
      const minutes = Math.round((sMin * (cfg.field.searchMin + freshMin * fresh)) / cfg.field.searchMin * 10) / 10;
      if (open && val > EPS) out.push({ cx, cy, nd, val, items, minutes, fresh, rate: val / minutes });
    }
  }
  return out;
}

// Best search by value per minute that still lets the bot walk home by 18:00 with the load the game's
// time rule assumes (projectedLoad = bag + this field's pile, up to the bag size). `reserve` = minutes
// to keep free at camp after walking home (time to process the haul).
function bestAction(st, field, vf, wasDebris, reserve = 0) {
  const back = returnMinutes(st, st.location, projectedLoad(st)) + reserve;
  let best = null;
  for (const o of centerOptions(st, field, vf, wasDebris)) {
    if (st.time + o.minutes + back > DAY_END + EPS) continue;
    if (!best || o.rate > best.rate + 1e-12) best = o;
  }
  return best;
}

// search() plus where its effort went: debris effort (debris cleared / clear multiplier) vs searching
// (% searched added), items found in cells that had debris, and the search minutes split by that share
// ("clear" = the part of searching spent on debris; there is no separate clearing action any more).
function trackedSearch(st, cx, cy, wasDebris) {
  const field = currentField(st);
  const before = areaCells(cx, cy).map((i) => {
    const c = field.cells[i];
    if (c.debris > EPS) wasDebris.add(c);
    return { c, s: c.searched, n: c.items.length, deb: wasDebris.has(c) };
  });
  const mult = debrisClearMult(st); // before the search: XP from it may raise the skill
  const r = search(st, cx, cy);
  if (!r.ok) return { r };
  const searchEff = sum(before.map((b) => b.c.searched - b.s));
  const debrisEff = r.debrisCleared / mult;
  const fromDebris = sum(before.filter((b) => b.deb).map((b) => b.n - b.c.items.length));
  const share = debrisEff + searchEff > EPS ? debrisEff / (debrisEff + searchEff) : 0;
  return { r, searchEff, debrisEff, fromDebris, clearMin: r.minutes * share, searchMin: r.minutes * (1 - share) };
}

// What to carry when leaving a field: { bag: [bag idx], pile: [pile idx], items: [types] }.
//   'value'   (default) the most valuable items of bag + pile by the bot's value function, only items
//             worth something (vf > 0), ties broken rarest first; worthless items stay in the pile.
//   'default' the game's defaultCarry: keep the bag, fill free slots with the rarest pile items.
const CARRY_RANK = ['ore:mythril', 'gem:diamond', 'gem:emerald', 'gem:sapphire', 'gem:topaz', 'gem:ruby', 'ore:coal', 'ore:iron', 'ore:copper'];
const carryRank = (t) => (CARRY_RANK.includes(t) ? CARRY_RANK.indexOf(t) : CARRY_RANK.length);
function planCarry(st, vf, mode = ARGS.carry) {
  const f = currentField(st);
  if (!f) return { bag: st.bag.map((_, i) => i), pile: [], items: [...st.bag] };
  if (mode === 'default') {
    const d = defaultCarry(st);
    return { ...d, items: [...d.bag.map((i) => st.bag[i]), ...d.pile.map((i) => f.pile[i])] };
  }
  const all = [...st.bag.map((t, i) => ({ t, src: 'bag', i })), ...f.pile.map((t, i) => ({ t, src: 'pile', i }))]
    .map((x) => ({ ...x, v: vf(x.t) }))
    .filter((x) => x.v > 0)
    .sort((a, b) => b.v - a.v || carryRank(a.t) - carryRank(b.t) || (a.src === b.src ? a.i - b.i : a.src === 'bag' ? -1 : 1));
  const take = all.slice(0, BAG);
  return { bag: take.filter((x) => x.src === 'bag').map((x) => x.i), pile: take.filter((x) => x.src === 'pile').map((x) => x.i), items: take.map((x) => x.t) };
}

// One trip: walk to `target`, search (greedy best rate; searching clears debris on the way) until what
// is worth carrying (bag + this field's pile) fills the bag, time runs out or the field is spent
// (optionally move on to another field, carrying the chosen items), then choose what to carry and walk
// home. Found items go to the field's pile; whatever is not carried stays there for a later trip, and
// items already in a pile when the bot arrives are picked up like fresh finds (no search needed).
function runTrip(st, target, p) {
  const z = { carried: [], searches: 0, found: 0, fromDebris: 0, debrisEff: 0, searchEff: 0, fromOldPile: 0, moves: 0 };
  let r = travel(st, target);
  if (!r.ok) return { ok: false, msg: r.msg, ...z };
  p.log('travel', r.minutes);
  let pileAtArrival = currentField(st).pile.length;
  // pile indexes below pileAtArrival were there before this visit (searches append to the pile)
  const tally = (plan) => (z.fromOldPile += plan.pile.filter((i) => i < pileAtArrival).length);
  for (let guard = 0; guard < 500; guard++) {
    const field = currentField(st);
    const plan = planCarry(st, p.vf, p.carry);
    if (plan.items.length >= BAG) break;
    const act = bestAction(st, field, p.vf, p.wasDebris, p.reserve ? p.reserve(st, plan.items) : 0);
    if (!act || act.rate < p.minRate) {
      if (p.allowMove && z.moves < 3 && p.chooseNext) {
        const next = p.chooseNext(st, plan.items);
        if (next) {
          r = travel(st, next, cfg, plan);
          if (r.ok) {
            tally(plan);
            p.log('travel', r.minutes);
            z.moves++;
            pileAtArrival = currentField(st).pile.length;
            continue;
          }
        }
      }
      break;
    }
    const s = trackedSearch(st, act.cx, act.cy, p.wasDebris);
    if (!s.r.ok) break;
    p.log('search', s.searchMin);
    p.log('clear', s.clearMin);
    z.searches++;
    z.found += s.r.found.length;
    z.fromDebris += s.fromDebris;
    z.debrisEff += s.debrisEff;
    z.searchEff += s.searchEff;
  }
  if (!atCamp(st)) {
    const plan = planCarry(st, p.vf, p.carry);
    r = travel(st, st.map.camp, cfg, plan);
    if (r.ok) {
      tally(plan);
      z.carried = plan.items;
      p.log('travel', r.minutes);
    }
  }
  return { ok: true, ...z };
}

// ============================================================== ECONOMY =====
const NB = cfg.field.byDistance.length; // buckets 1..NB; farther fields count in the last (the game uses the last row for them)
const BUCKETS = Array.from({ length: NB }, (_, i) => i + 1);
const bucketOf = (d) => Math.min(NB, d);
const bucketLabel = (b) => (b === NB ? `${NB}+` : String(b));

function fieldsAt(st, b) {
  return st.map.cells.filter((c) => c.type === 'field' && bucketOf(c.dist) === b);
}

// Search a whole field (clock reset before each search) to measure raw yield per search and where the
// search effort goes (debris vs searching). Debris is cleared by the searches themselves.
function exhaustField(st0, loc) {
  const st = deepClone(st0);
  st.location = { x: loc.x, y: loc.y };
  const field = currentField(st);
  const wasDebris = new WeakSet();
  const o = { searches: 0, items: 0, minutes: 0, debrisEff: 0, searchEff: 0, fromDebris: 0, clearMin: 0, debrisSearches: 0 };
  for (let guard = 0; guard < 600; guard++) {
    st.time = DAY_START;
    const act = bestAction(st, field, () => 1, wasDebris);
    if (!act) break;
    const s = trackedSearch(st, act.cx, act.cy, wasDebris);
    if (!s.r.ok) break;
    o.searches++;
    o.items += s.r.found.length;
    o.minutes += cfg.field.searchMin + (cfg.field.freshCellMin || 0) * (act.fresh || 0); // base time + fresh-cell surcharge (counted before the search; no skill speed-up)
    o.debrisEff += s.debrisEff;
    o.searchEff += s.searchEff;
    o.fromDebris += s.fromDebris;
    o.clearMin += s.clearMin;
    if (s.r.debrisCleared > 0) o.debrisSearches++;
  }
  o.left = sum(field.cells.map((c) => c.items.length));
  return o;
}

function economySection(o) {
  const N = o.seeds ?? (o.quick ? 30 : 100);
  h1(`ECONOMY — ${N} generated maps, fresh games (skills 0, no rings, base intel)`);
  const states = [];
  for (let s = 0; s < N; s++) states.push(newGame(mixSeed(9001, s)));

  // ---- 1. field contents by distance
  const agg = Object.fromEntries(BUCKETS.map((b) => [b, { fields: 0, items: 0, debrisCells: 0, debrisAmt: 0, debrisItems: 0, boulders: 0, types: {} }]));
  for (const st of states) {
    for (const c of st.map.cells) {
      if (c.type !== 'field') continue;
      const a = agg[bucketOf(c.dist)];
      a.fields++;
      for (const cell of st.map.fields[key(c.x, c.y)].cells) {
        if (cell.boulder) a.boulders++;
        if (cell.debris > 0) {
          a.debrisCells++;
          a.debrisAmt += cell.debris;
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
    ['dist', 'fields/map', 'items/field', 'ores', 'gems', 'gem %', 'boulders', 'debris cells', 'mean thickness', 'items under debris'],
    BUCKETS.map((b) => {
      const a = agg[b];
      const per = (v) => (a.fields ? v / a.fields : NaN);
      const ores = sum(Object.entries(a.types).filter(([t]) => t.startsWith('ore:')).map(([, v]) => v));
      return [bucketLabel(b), f2(a.fields / N), f1(per(a.items)), f1(per(ores)), f1(per(a.items - ores)), f0((100 * (a.items - ores)) / Math.max(1, a.items)), f1(per(a.boulders)), f1(per(a.debrisCells)),
        f0(a.debrisCells ? a.debrisAmt / a.debrisCells : NaN), f1(per(a.debrisItems))];
    }),
  );
  note(`Debris thickness ${cfg.field.debrisAmount.min}-${cfg.field.debrisAmount.max} search effort (a search gives each cell ~${cfg.field.searchEfficiency}); ` +
    `boulders (${cfg.field.byDistance.map((r) => r.boulders).join('/')} per field at distance 1..${NB}+) can never be searched and hold nothing.`);
  const totals = {};
  for (const b of BUCKETS) for (const [t, v] of Object.entries(agg[b].types)) totals[t] = (totals[t] || 0) + v;
  note(`Whole map, per run: ${f0(sum(Object.values(totals)) / N)} items = ` +
    [...ORES.map((x) => `ore:${x}`), ...GEMS.map((x) => `gem:${x}`)].map((t) => `${t.split(':')[1]} ${f0((totals[t] || 0) / N)}`).join(', ') + '.');
  {
    const cellsPerMap = sum(BUCKETS.map((b) => agg[b].fields)) / N * cfg.field.size ** 2;
    const itemsPerMap = sum(Object.values(totals)) / N;
    note(`Fields never refill: the ~${f0(itemsPerMap)} items in ${f0(cellsPerMap)} cells are the whole ` +
      `supply of a run (ore: ${ORES.map((x) => `${x} ${f0((totals[`ore:${x}`] || 0) / N)}`).join(', ')}). The bot's "Map supply" table shows how fast it is used.`);
  }
  let searchesPerCell = NaN;
  {
    // Searches needed to finish one cell (each search rolls eff +/- searchRandomness for that cell).
    const rng = seededRng(mixSeed(4040, 1));
    const r = cfg.field.searchRandomness || 0;
    const meanKs = [];
    const effSkill = cfg.skills.activity.searchEff.effects.searchEff * cfg.skills.maxLevel; // % at the highest skill level
    const rows = [0, effSkill, cfg.rings.types.searchEff.values[1], cfg.rings.types.searchEff.values[4],
      cfg.rings.types.searchEff.values[4] + effSkill].map((bonus) => {
      const eff = cfg.field.searchEfficiency * (1 + bonus / 100);
      const hist = {};
      const T = 20000;
      for (let t = 0; t < T; t++) {
        let sdone = 0;
        let k = 0;
        while (sdone < 100 - EPS && k < 100) {
          sdone += Math.max(0, Math.min(100, eff + (r > 0 ? rng.float(-r, r) : 0)));
          k++;
        }
        hist[k] = (hist[k] || 0) + 1;
      }
      const meanK = sum(Object.entries(hist).map(([k, c]) => Number(k) * c)) / T;
      meanKs.push(meanK);
      return `+${f0(bonus)}% -> ${f1(Math.max(0, eff - r))}-${f1(Math.min(100, eff + r))}% per search, ${f2(meanK)} searches (` +
        Object.entries(hist).sort((a, b) => a[0] - b[0]).map(([k, c]) => `${k}: ${f0((100 * c) / T)}%`).join(', ') + ')';
    });
    note(`Searches per clear cell, by search-efficiency bonus (0 / skill ${cfg.skills.maxLevel} / C ring / S ring / S ring + skill ${cfg.skills.maxLevel}):\n  ` + rows.join('\n  '));
    searchesPerCell = meanKs[0]; // at +0% efficiency
    // ... and a debris cell (mean thickness), by debris skill level
    const dm = (cfg.field.debrisAmount.min + cfg.field.debrisAmount.max) / 2;
    const dRows = [0, 5, 10].map((lv) => {
      const mult = 1 + (cfg.skills.activity.debris.effects.debrisClear * lv) / 100;
      let tot = 0;
      const T = 20000;
      for (let t = 0; t < T; t++) {
        let deb = rng.float(cfg.field.debrisAmount.min, cfg.field.debrisAmount.max);
        let sdone = 0;
        let k = 0;
        while (sdone < 100 - EPS && k < 100) {
          let e = Math.max(0, Math.min(100, cfg.field.searchEfficiency + (r > 0 ? rng.float(-r, r) : 0)));
          if (deb > EPS) {
            const used = Math.min(deb, e * mult);
            deb -= used;
            e = (e * mult - used) / mult;
          }
          if (deb <= EPS) sdone += e;
          k++;
        }
        tot += k;
      }
      return `debris skill ${lv} (x${f1(mult)}): ${f2(tot / T)} searches`;
    });
    note(`Searches to finish a debris cell (thickness ${cfg.field.debrisAmount.min}-${cfg.field.debrisAmount.max}, mean ${f0(dm)}; no search bonus): ${dRows.join(', ')}.`);
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

  // ---- 2. full-field yield per search (no travel); debris is cleared by the searches
  const ex = Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, s: 0, i: 0, min: 0, de: 0, se: 0, fd: 0, cm: 0, ds: 0, left: 0 }]));
  states.forEach((st, si) => {
    const rng = seededRng(mixSeed(77, si));
    for (const b of BUCKETS) {
      const fs = fieldsAt(st, b);
      if (!fs.length) continue;
      const c = rng.pick(fs);
      const a = exhaustField(st, c);
      const e = ex[b];
      e.n++;
      e.s += a.searches;
      e.i += a.items;
      e.min += a.minutes;
      e.de += a.debrisEff;
      e.se += a.searchEff;
      e.fd += a.fromDebris;
      e.cm += a.clearMin;
      e.ds += a.debrisSearches;
      e.left += a.left;
    }
  });
  const sMin = cfg.field.searchMin;
  const debrisShare = (b) => (100 * ex[b].de) / Math.max(EPS, ex[b].de + ex[b].se);
  h2(`2. Searching a whole field (greedy 3x3 picks, ${sMin} min/search + ${cfg.field.freshCellMin || 0} min per never-searched cell in the area, ${cfg.field.searchEfficiency}% +/-${cfg.field.searchRandomness || 0} per cell per search, no travel)`);
  printTable(
    ['dist', 'searches', 'items', 'items/search', 'min/item', 'searches touching debris', 'debris % of effort', 'debris min', 'items from debris cells', 'items left'],
    BUCKETS.filter((b) => ex[b].n).map((b) => {
      const e = ex[b];
      const k = (v) => v / e.n;
      return [bucketLabel(b), f1(k(e.s)), f1(k(e.i)), f2(e.i / e.s), f1(e.min / e.i), f1(k(e.ds)), f1(debrisShare(b)), f0(k(e.cm)), f1(k(e.fd)), f1(k(e.left))];
    }),
  );
  note('Debris is cleared by searching: each search gives each open cell an effort roll; on a debris cell it clears\n' +
    'debris first (x debris skill) and the rest searches the cell. "debris % of effort" = effort spent on debris /\n' +
    '(debris + searching) effort; "debris min" charges that share of each search\'s minutes to debris. "min/item" charges\n' +
    `the base search time plus the fresh-cell surcharge (freshCellMin per never-searched cell, once per cell: about ${f0((cfg.field.freshCellMin || 0) * cfg.field.size ** 2)} min\n` +
    'per field), with no search-skill speed-up.\n' +
    'Items left = still hidden when no search can add anything (only boulders are never searched, and they hold nothing).');

  // ---- 3. trips and days including travel
  const trip = Object.fromEntries(BUCKETS.map((b) => [b, { n: 0, min: 0, found: 0, items: 0, pile: 0, full: 0, searches: 0, tm: { travel: 0, search: 0, clear: 0 }, dayN: 0, dayItems: 0, dayFound: 0, dayMin: 0, dayPile: 0, dayTypes: {} }]));
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
        const res = runTrip(st, c, { vf: vf1, wasDebris: new WeakSet(), log: (k, m) => (tm[k] += m), minRate: 0.002, allowMove: false });
        T.n++;
        T.min += st.time - DAY_START;
        T.found += res.found;
        T.items += res.carried.length;
        T.searches += res.searches;
        T.pile += st.map.fields[key(c.x, c.y)].pile.length;
        if (res.carried.length >= BAG) T.full++;
        for (const k of Object.keys(tm)) T.tm[k] += tm[k];
      }
      // a whole day of repeated trips to that field (each trip first takes what the last one left)
      {
        const st = deepClone(st0);
        const wasDebris = new WeakSet();
        let items = 0;
        let found = 0;
        for (let t = 0; t < 6; t++) {
          const res = runTrip(st, c, { vf: vf1, wasDebris, log: () => {}, minRate: 0.002, allowMove: false });
          if (!res.ok || !res.carried.length) break;
          items += res.carried.length;
          found += res.found;
          for (const it of res.carried) T.dayTypes[it] = (T.dayTypes[it] || 0) + 1;
        }
        T.dayN++;
        T.dayItems += items;
        T.dayFound += found;
        T.dayPile += st.map.fields[key(c.x, c.y)].pile.length;
        T.dayMin += st.time - DAY_START;
      }
    }
  });
  h2(`3a. One trip from 8:00: walk out, search until bag + pile reach the bag size (${BAG}) or time is up, carry ${BAG}, walk home`);
  printTable(
    ['dist', 'trip min', 'searches', 'found', 'carried', 'left in pile', 'min/carried item', 'bag full %', 'travel min', 'search min', 'debris min', '| day (repeat trips): found', 'carried', 'pile left', 'min used'],
    BUCKETS.filter((b) => trip[b].n).map((b) => {
      const T = trip[b];
      return [bucketLabel(b), f0(T.min / T.n), f1(T.searches / T.n), f1(T.found / T.n), f1(T.items / T.n), f1(T.pile / T.n), f1(T.min / T.items), f0((100 * T.full) / T.n),
        f0(T.tm.travel / T.n), f0(T.tm.search / T.n), f0(T.tm.clear / T.n), f1(T.dayFound / T.dayN), f1(T.dayItems / T.dayN), f1(T.dayPile / T.dayN), f0(T.dayMin / T.dayN)];
    }),
  );
  note('Found items go to the field\'s pile; the trip ends once the pile holds a full bag, so the last search can overshoot\n' +
    'by a few items: those stay in the pile and the next trip to that field takes them first.');

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
  // Gem cutting blends novice -> master by the gem's grade skill; failure falls with its cutting skill.
  // Gems with identical tables share rows. "effect vs C" = mean infusion effect per gem cut (grade-weighted,
  // failures count as 0) relative to one C gem, averaged over the group's weapon and armor effects.
  const gemGroups = {};
  for (const gem of GEMS) (gemGroups[JSON.stringify({ ...cfg.cut[gem] })] ||= []).push(gem);
  const effVsC = (gems, d) => mean(gems.flatMap((g) => ['weapon', 'armor'].map((side) => {
    const arr = Object.values(cfg.gemEffects[g][side])[0];
    return sum(GRADES.map((gr, i) => (d[gr] / 100) * arr[i])) / arr[1];
  })));
  const gemCut = {};
  for (const gems of Object.values(gemGroups)) {
    const c = cfg.cut[gems[0]];
    const lvls = c.novice ? [0, 5, cfg.skills.maxLevel] : [0];
    for (const lv of lvls) {
      const d = c.novice
        ? blendCutTable(c, (cfg.skills.perMaterial.gemGrade.effects.cutBlend * lv) / 100, cfg.skills.perMaterial.gemFail.effects.cutFail * lv)
        : adjustDistribution(c.dist, cfg.skills.perMaterial.gemFail.effects.cutFail * lv, 0);
      const name = `${gems.length === GEMS.length ? 'any gem' : gems.join('/')} cut${c.novice ? `, skill ${lv}` : ''}`;
      if (lv === 0) gemCut.novice = d;
      if (lv === cfg.skills.maxLevel) gemCut.master = d;
      gemCut.eff0 ??= effVsC(gems, d);
      rows.push([name, `1 gem`, c.minutes, ...['S', 'A', 'B', 'C', 'D', 'F'].map((g) => f1(d[g])), f2((100 - d.F) / 100),
        f1(c.minutes / ((d.S + d.A + d.B + d.C) / 100)), f1(c.minutes / ((d.S + d.A + d.B) / 100)), f2(effVsC(gems, d))]);
    }
  }
  printTable(['output', 'input', 'min', 'S%', 'A%', 'B%', 'C%', 'D%', 'F%', 'out/in', 'min per C+', 'min per B+', 'gem effect vs C'], rows);
  note(`Gem skill N = grade skill N (${cfg.skills.perMaterial.gemGrade.effects.cutBlend}%/level of the way from novice to master) and cutting skill N ` +
    `(-${cfg.skills.perMaterial.gemFail.effects.cutFail} fail/level); gem luck rings upgrade on top. "gem effect vs C" = mean effect per gem cut / a C gem.`);
  const maxSk = cfg.skills.maxLevel;
  const up10 = cfg.skills.perMaterial.oreGrade.effects.refineUpgrade * maxSk;
  const fail10 = cfg.skills.perMaterial.oreFail.effects.refineFail * maxSk;
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
    [...BARS, ...GEMS].map((m) => `${m} ${Math.ceil(xpL10 / Math.max(1e-9, itemXp(m, cfg)) - 1e-9)}`).join(', ') + '.');

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
    ` | debris % of effort ${BUCKETS.filter((b) => ex[b].n).map((b) => `d${bucketLabel(b)}:${f0(debrisShare(b))}`).join(' ')}` +
    ` | one trip d1/d3: ${f0(trip[1].min / trip[1].n)}/${trip[3].n ? f0(trip[3].min / trip[3].n) : '-'} min for ${f1(trip[1].items / trip[1].n)}/${trip[3].n ? f1(trip[3].items / trip[3].n) : '-'} items` +
    ` (found ${f1(trip[1].found / trip[1].n)}/${trip[3].n ? f1(trip[3].found / trip[3].n) : '-'}, pile left ${f1(trip[1].pile / trip[1].n)}/${trip[3].n ? f1(trip[3].pile / trip[3].n) : '-'})` +
    ` | field min per unit: ${['ore:copper', 'ore:iron', 'steel pair', 'ore:mythril', 'any gem'].map((r) => `${r.replace('ore:', '')} ${f0(bestMin[r].min)}`).join(', ')}` +
    ` | full set >=D work days: ${BARS.map((b) => `${b} ${f1(setDays[b])}`).join(', ')}` +
    ` | gem cut skill 0: F ${f0(gemCut.novice.F)}% C+ ${f0(gemCut.novice.S + gemCut.novice.A + gemCut.novice.B + gemCut.novice.C)}% effect ${f2(gemCut.eff0)} of C` +
    ` | map items/run ${f0(sum(Object.values(totals)) / N)} (mythril ${f1((totals['ore:mythril'] || 0) / N)}, coal ${f0((totals['ore:coal'] || 0) / N)})` +
    ` | searches per clear cell ${f2(searchesPerCell)}`);
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
  { name: 'Unarmed, no gear', gear: () => [], unarmed: true },
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
// Day-2 bands. 1.2 (user, session 6): an UNARMED adventurer beats a typical normal enemy on day 2 about 50-65%
// of the time, and a copper D sword is ~+50% over unarmed, so the sensible day-1 sets sit well above the
// 1.1 bands (normal 85-98, elite 50-75, champion 15-40). The mid-game targets (power section 2/3) did not change.
const UNARMED_TARGET = [50, 65];
const DAY2_TARGET = { normal: [95, 100], elite: [75, 95], champion: [40, 75] };

function powerSection(o, T) {
  const S = o.samples ?? (o.quick ? 20 : 100);
  const E = o.quick ? 20 : 50;
  h1(`POWER CURVE — win % vs a typical enemy of each tier: all attributes hidden (${S} attribute guesses x ${E} fights per cell)`);

  // ---- 1. the first fight
  const S2 = o.quick ? 40 : 200;
  h2(`1. Day-2 fight with day-1 gear (unarmed vs normal ${UNARMED_TARGET.join('-')}%; sets: normal ${DAY2_TARGET.normal.join('-')}%, elite ${DAY2_TARGET.elite.join('-')}%, champion ${DAY2_TARGET.champion.join('-')}%; ${S2} x ${E} fights)`);
  const day2 = DAY1_LOADOUTS.map((l) => ({ ...l, w: Object.fromEntries(TIERS.map((t, ti) => [t, winPct(l.gear(), {}, t, 2, S2, E, mixSeed(222, ti))])) }));
  const mark = (t, v, l) => {
    // the unarmed row is only judged against normal enemies (target 50-65%); other tiers are shown for reference
    const [lo, hi] = l.unarmed ? (t === 'normal' ? UNARMED_TARGET : [0, 100]) : DAY2_TARGET[t];
    return v < lo - EPS ? ' (low)' : v > hi + EPS ? ' (high)' : '';
  };
  printTable(['day-1 loadout', ...TIERS.map((t) => `vs ${t}`)], day2.map((l) => [`${l.ref ? '* ' : '  '}${l.name}`, ...TIERS.map((t) => `${f1(l.w[t])}${mark(t, l.w[t], l)}`)]));
  note('* = the reference "sensible day 1" used in the summary line. (low)/(high) = outside the target band (unarmed vs normal: ' + UNARMED_TARGET.join('-') + '%).');

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
  const unarmed = day2.find((l) => l.unarmed);
  const cuD = day2.find((l) => l.name === 'Copper D sword');
  console.log(`\nPOWER SUMMARY | unarmed d2 vs normal ${f0(unarmed.w.normal)}% (target ${UNARMED_TARGET.join('-')})` +
    ` | day-2 ref (${ref.name}) n/e/c ${TIERS.map((t) => f0(ref.w[t])).join('/')}%` +
    ` | Cu D sword n/e/c ${TIERS.map((t) => f0(cuD.w[t])).join('/')}%` +
    ` | last day >=90% vs normal: ${['Copper B full', 'Iron C full', 'Steel C full', 'Mythril C full', 'Mythril S full'].map((n) => `${n.replace(' full', '')} d${lastDay('normal', archIdx(n), 90)}`).join(', ')}` +
    ` | >=70% vs elite: ${['Copper B full', 'Iron C full', 'Steel C full', 'Mythril C full', 'Mythril S full'].map((n) => `${n.replace(' full', '')} d${lastDay('elite', archIdx(n), 70)}`).join(', ')}` +
    ` | ceiling vs normal d60/d80 ${f0(arch.normal[ARCH.length - 1][days.indexOf(60)])}/${f0(arch.normal[ARCH.length - 1][days.indexOf(80)])}%`);
  return VT;
}


// =============================================================== SPECIALS ====
// Targets (v1.2): switching ONE enemy offensive special from Normal to High (everything else Normal) costs a
// mid-game set (steel C) roughly 10-20 win points, the matching defence (the armor gem at C on 3 pieces plus
// one B ring) recovers at least half of that, and the adventurer's own S gem is a little weaker than the
// enemy's High value (and enemy resistances blunt it).
const SPECIALS = [
  { name: 'Magic', off: 'magical', field: 'magicPct', res: 'magicRes', gem: 'ruby', resRing: 'magicRes', offRing: 'magicDmg' },
  { name: 'Piercing', off: 'piercing', field: 'pierce', res: 'pierceRes', gem: 'diamond', resRing: 'pierceRes', offRing: 'pierce' },
  { name: 'Stun', off: 'stunning', field: 'stunChance', res: 'stunRes', gem: 'topaz', resRing: 'stunRes', offRing: null },
  { name: 'Slow', off: 'chilling', field: 'slowPct', res: 'slowRes', gem: 'sapphire', resRing: 'slowRes', offRing: null },
];

function specialsSection(o) {
  const n = o.quick ? 1500 : 6000; // fights per cell per day
  const WINDOW = 3; // reference day +- 3
  const tier = 'elite';
  const lv = (over = {}) => Object.fromEntries(Object.keys(cfg.enemies.attributes).map((k) => [k, over[k] || 'normal']));
  const foe = (day, over) => enemyCombatant(tier, day, lv(over), 'Enemy', cfg);
  const wins = (gear, rings, day, over, salt, edit = null) => {
    const adv = adventurerCombatant(gear, rings, cfg);
    const en = foe(day, over);
    if (edit) edit(en);
    const rng = seededRng(mixSeed(777, day, salt));
    let w = 0;
    for (let i = 0; i < n; i++) {
      const r = fight(adv, en, rng.next, false, cfg);
      if (r.win || r.draw) w++;
    }
    return (100 * w) / n;
  };
  const refDayOf = (gear) => {
    let best = 2;
    let bd = Infinity;
    for (let d = 2; d <= 90; d++) {
      const adv = adventurerCombatant(gear, {}, cfg);
      const en = foe(d, {});
      const rng = seededRng(mixSeed(5, d));
      let w = 0;
      for (let i = 0; i < 600; i++) if (fight(adv, en, rng.next, false, cfg).win) w++;
      const dist = Math.abs((100 * w) / 600 - 55);
      if (dist < bd) [bd, best] = [dist, d];
    }
    return best;
  };
  const armorOn = (mat, gem, pieces) => setOf(mat, 'C').map((it) => (ARMOR_SLOTS.slice(0, pieces).includes(it.slot) ? { ...it, gem: { type: gem, grade: 'C' } } : it));
  const ring = (type, grade) => ringTotals([{ type, grade }]);

  h1(`SPECIALS — enemy specials vs matching defence, and the adventurer's own gems (plain C set vs an ${tier}; ${n} fights x ${2 * WINDOW + 1} days per cell)`);
  note('Each enemy special is set to Low / Normal / High with all other attributes Normal. "def" = the armor gem at grade C on 3 pieces (chest, helmet, gloves) plus one B ring of the matching resistance.');
  note('N->H = win points lost going from Normal to High. recovered = how much of that loss the defence wins back at High (2 / 3 / 4 gem pieces + the ring).');
  const summary = [];
  for (const mat of ['iron', 'steel', 'mythril']) {
    const base = setOf(mat, 'C');
    const ref = refDayOf(base);
    const days = [];
    for (let d = ref - WINDOW; d <= ref + WINDOW; d++) if (d >= 2) days.push(d);
    const W = (gear, rings, over) => mean(days.map((d) => wins(gear, rings, d, over, 1)));
    h2(`${mat} C full set vs ${tier}, reference day ${ref} (days ${days[0]}-${days[days.length - 1]}); all-Normal enemy: ${f1(W(base, {}, {}))}% win`);
    const rows = SPECIALS.map((sp) => {
      const v = cfg.enemies.attributes[sp.off].values;
      const none = ['low', 'normal', 'high'].map((l) => W(base, {}, { [sp.off]: l }));
      const rg = ring(sp.resRing, 'B');
      const def = ['low', 'normal', 'high'].map((l) => W(armorOn(mat, sp.gem, 3), rg, { [sp.off]: l }));
      const loss = none[1] - none[2];
      const rec = (p) => (100 * (W(armorOn(mat, sp.gem, p), rg, { [sp.off]: 'high' }) - none[2])) / Math.max(EPS, loss);
      const recs = [rec(2), def[2] - none[2] > 0 ? (100 * (def[2] - none[2])) / Math.max(EPS, loss) : 0, rec(4)];
      if (mat === 'steel') summary.push(`${sp.name} -${f0(loss)} / ${f0(recs[1])}%`);
      return [sp.name, `${v.low}/${v.normal}/${v.high}`, ...none.map(f1), `-${f1(loss)}`, ...def.map(f1), recs.map((x) => `${f0(x)}%`).join(' / ')];
    });
    printTable(['special', 'low/normal/high', 'no def L', 'N', 'H', 'N->H', 'def L', 'N', 'H', 'recovered (2/3/4 gems)'], rows);
  }

  // ---- the adventurer's own offence
  const mat = 'steel';
  const base = setOf(mat, 'C');
  const ref = refDayOf(base);
  const days = [];
  for (let d = ref - WINDOW; d <= ref + WINDOW; d++) if (d >= 2) days.push(d);
  const W = (gear, rings, over, edit = null) => mean(days.map((d) => wins(gear, rings, d, over, 2, edit)));
  h2(`The adventurer's own specials: win-point gain of a sword gem / one ring over the same ${mat} C set without it, by the enemy's matching resistance (day ${ref}, all else Normal)`);
  const advRows = [];
  const gains = (gear, rings, res) => ['low', 'normal', 'high'].map((l) => W(gear, rings, { [res]: l }) - W(base, {}, { [res]: l }));
  for (const sp of SPECIALS) {
    const rv = cfg.enemies.attributes[sp.res].values;
    const eff = cfg.gemEffects[sp.gem].weapon;
    const key = Object.keys(eff)[0];
    const highEnemy = cfg.enemies.attributes[sp.off].values.high;
    for (const g of ['C', 'S']) {
      const gi = GRADES.indexOf(g);
      const units = Object.entries(eff).map(([k, a]) => `${a[gi]}${k.endsWith('Dur') ? 's' : '%'}`).join(' / ');
      const gn = gains(setOf(mat, 'C', { swordGem: { type: sp.gem, grade: g } }), {}, sp.res);
      advRows.push([`${sp.gem} sword ${g}`, units, g === 'S' ? `${f0((100 * eff[key][gi]) / highEnemy)}%` : '', `${rv.low}/${rv.normal}/${rv.high}`, ...gn.map((x) => (x >= 0 ? '+' : '') + f1(x))]);
    }
    if (sp.offRing) {
      for (const g of ['B', 'S']) {
        const val = cfg.rings.types[sp.offRing].values[GRADES.indexOf(g)];
        const gn = gains(base, ring(sp.offRing, g), sp.res);
        advRows.push([`${sp.offRing} ring ${g}`, `${val}%`, '', `${rv.low}/${rv.normal}/${rv.high}`, ...gn.map((x) => (x >= 0 ? '+' : '') + f1(x))]);
      }
    }
  }
  printTable(['gem / ring', 'effect', 'S / enemy High', 'enemy resist L/N/H', 'gain vs L', 'N', 'H'], advRows);
  note('"S / enemy High" = the S gem\'s main number as a share of the enemy\'s High value for the same special (target: below 100%, a little weaker).');

  // ---- enemy special vs the adventurer's equivalent, in win points
  h2(`Adventurer offence vs the enemy's equivalent special, in win points (${mat} C set vs an all-Normal ${tier}, day ${ref})`);
  const normalW = W(base, {}, {});
  const cmpRows = SPECIALS.map((sp) => {
    const ev = cfg.enemies.attributes[sp.off].values;
    const absent = W(base, {}, {}, (en) => { en[sp.field] = 0; });
    const high = W(base, {}, { [sp.off]: 'high' });
    const eff = cfg.gemEffects[sp.gem].weapon;
    const mainKey = Object.keys(eff)[0];
    const gS = W(setOf(mat, 'C', { swordGem: { type: sp.gem, grade: 'S' } }), {}, {}) - normalW;
    const gC = W(setOf(mat, 'C', { swordGem: { type: sp.gem, grade: 'C' } }), {}, {}) - normalW;
    const costN = absent - normalW;
    const costH = absent - high;
    const unit = (g) => Object.entries(eff).map(([k, a]) => `${a[GRADES.indexOf(g)]}${k.endsWith('Dur') ? 's' : '%'}`).join('/');
    return [sp.name, `${ev.normal} / ${ev.high}`, `-${f1(costN)} / -${f1(costH)}`, `${sp.gem} C ${unit('C')} | S ${unit('S')}`, `+${f1(gC)} / +${f1(gS)}`, `${f0((100 * eff[mainKey][4]) / ev.high)}%`, `${f0((100 * gS) / costN)}% / ${f0((100 * gS) / costH)}%`];
  });
  printTable(['special', 'enemy Normal / High', 'enemy costs you vs none (Normal / High)', 'adventurer gem (C | S)', 'gem gain (C / S)', 'S value / enemy High', 'S gain / enemy cost (Normal / High)'], cmpRows);
  note('Target: the adventurer\'s top gem is a little weaker than the enemy\'s High special, both in the number shown (S value / enemy High, below 100%) and in win points (S gain below the enemy\'s High cost, about the enemy\'s Normal cost).');

  // ---- defensive rings in their matchup
  h2(`Defensive and other adventurer rings: gain of ONE ring (B / S) vs an all-Normal ${tier} and vs an ${tier} with the matching attribute High (${mat} C set, day ${ref})`);
  const rrows = [];
  const base0 = W(base, {}, {});
  for (const t of ADV_RINGS) {
    const sp = SPECIALS.find((x) => x.resRing === t);
    const bH = sp ? W(base, {}, { [sp.off]: 'high' }) : null;
    const cell = (g) => `${f1(W(base, ring(t, g), {}) - base0)}${sp ? ` / ${f1(W(base, ring(t, g), { [sp.off]: 'high' }) - bH)}` : ''}`;
    rrows.push([t, cfg.rings.types[t].values[2], cfg.rings.types[t].values[4], cell('B'), cell('S')]);
  }
  printTable(['ring', 'B value', 'S value', 'B: normal / vs High', 'S: normal / vs High'], rrows);
  console.log(`\nSPECIALS SUMMARY (steel C, N->H loss / recovered by 3 gems + B ring) | ${summary.join(' | ')}`);
}

// ============================================================ ESTIMATOR =====
// How accurate is the in-game win-chance estimate at a given size (guesses x test fights)? A plain steel C set
// vs random elites on three days chosen so the average true win chance is about 55 / 75 / 90%. For each
// enemy: its TRUE win chance (4000 fights against its real attributes) and the estimate made when only a
// share of its attributes is visible (enemy scouting: the base is CONFIG.intel.tracks.enemySight.base; 50 and
// 100 show what better scouting does). Every estimate is made 3 times with different random draws.
//   repeat sd  = how much the same estimate wobbles between presses (sampling noise; shrinks with size)
//   error sd   = typical miss of the estimate vs the true chance (adds the hidden-attribute guesswork,
//                which more guesses do not remove)
//   >10 pts    = share of estimates that miss by more than 10 points
// Sizes: 10x10 = start of the game; 13x13 / 16x16 = a C / S Foresight ring (+3 / +6); 20x20 = 1 Battle
// simulation intel point (+10); 29x29 = 2 points (+10 +9); 40x30 = the 1.1 estimate.
function estimatorSection(o) {
  const M = o.quick ? 40 : 200; // enemies per target
  const tier = 'elite';
  const gear = setOf('steel', 'C');
  const sizes = [[10, 10], [13, 13], [16, 16], [20, 20], [29, 29], [40, 30]];
  const base = cfg.intel.tracks.enemySight.base;
  const sights = [...new Set([base, 50, 100])];
  const lvOf = (rng) => rollLevels(rng, tier, cfg);
  const trueWin = (day, levels, n, seed) => {
    const adv = adventurerCombatant(gear, {}, cfg);
    const en = enemyCombatant(tier, day, levels, 'Enemy', cfg);
    const rng = seededRng(seed);
    let w = 0;
    for (let i = 0; i < n; i++) {
      const r = fight(adv, en, rng.next, false, cfg);
      if (r.win || r.draw) w++;
    }
    return (100 * w) / n;
  };
  const dayFor = (target) => {
    let best = 2;
    let bd = Infinity;
    for (let d = 2; d <= 90; d++) {
      const rng = seededRng(mixSeed(5, d));
      let t = 0;
      for (let i = 0; i < 30; i++) t += trueWin(d, lvOf(rng), 150, mixSeed(6, d, i));
      const dist = Math.abs(t / 30 - target);
      if (dist < bd) [bd, best] = [dist, d];
    }
    return best;
  };
  h1(`ESTIMATOR — how far off is the win-chance estimate? (steel C set vs random ${tier}s; ${M} enemies per target, 3 estimates each)`);
  note('Sizes are guesses x test fights. 13x13 / 16x16 = a C / S Foresight ring, 20x20 = 1 Battle simulation intel point, 29x29 = 2 points, 40x30 = what 1.1 used.');
  note(`Sight = the share of the enemy's attributes visible (enemy scouting; ${base}% is the starting value). repeat sd = wobble of the same estimate between presses; error sd = miss vs the true chance (includes the guesswork about hidden attributes).`);
  const summary = [];
  for (const target of [55, 75, 90]) {
    const day = dayFor(target);
    const rng = seededRng(mixSeed(1234, target));
    const enemies = [];
    for (let i = 0; i < M; i++) {
      const levels = lvOf(rng);
      enemies.push({ levels, truth: trueWin(day, levels, 4000, mixSeed(9, target, i)), sightRoll: Object.fromEntries(Object.keys(levels).map((k) => [k, rng.float(0, 100)])) });
    }
    const mt = mean(enemies.map((e) => e.truth));
    const sdT = Math.sqrt(mean(enemies.map((e) => (e.truth - mt) ** 2)));
    h2(`target ~${target}%: steel C set vs ${tier} on day ${day}; mean true win ${f1(mt)}% (true spread sd ${f1(sdT)})`);
    const rows = sizes.map(([S, E]) => {
      const cells = [];
      for (const sight of sights) {
        const errs = [];
        const reps = [];
        let hi = 0;
        let falseSafe = 0;
        enemies.forEach((e, i) => {
          const known = {};
          for (const k of Object.keys(e.levels)) if (e.sightRoll[k] < sight) known[k] = e.levels[k];
          const ests = [0, 1, 2].map((r) => estimateWinChanceSync({ gearItems: gear, ringTotals: {}, tier, day, known, seed: 1000 * i + r + 1 }, { samples: S, evalFights: E, fightsPerLoadout: E }, cfg).winPct);
          const m = mean(ests);
          reps.push(Math.sqrt(sum(ests.map((x) => (x - m) ** 2)) / 2));
          errs.push(ests[0] - e.truth);
          if (ests[0] >= 90) {
            hi++;
            if (e.truth < 80) falseSafe++;
          }
        });
        const me = mean(errs);
        const sdE = Math.sqrt(mean(errs.map((x) => (x - me) ** 2)));
        const repSd = Math.sqrt(mean(reps.map((x) => x * x)));
        const over10 = (100 * errs.filter((x) => Math.abs(x) > 10).length) / errs.length;
        cells.push(f1(repSd), f1(sdE), `${f0(over10)}%`);
        if (target === 90 && sight === base) summary.push({ S, E, falseSafe: hi ? (100 * falseSafe) / hi : NaN, hi });
        if (sight === base) summary.push({ S, E, target, repSd, sdE, over10 });
      }
      return [`${S}x${E}`, ...cells];
    });
    printTable(['size', ...sights.flatMap((sg) => [`sight ${sg}%: repeat sd`, 'error sd', '>10 pts'])], rows);
    if (target === 90) {
      const fs = summary.filter((x) => x.falseSafe !== undefined && x.target === undefined);
      note(`Risk at 90%: of the estimates >= 90 (sight ${base}%), the share whose true chance is under 80: ` + fs.map((x) => `${x.S}x${x.E} ${Number.isFinite(x.falseSafe) ? f0(x.falseSafe) + '%' : '-'}`).join(', ') + '.');
    }
  }
  const line = (S, E) => {
    const xs = summary.filter((x) => x.target && x.S === S && x.E === E);
    return `${S}x${E}: repeat sd ${f1(mean(xs.map((x) => x.repSd)))}, error sd ${f1(mean(xs.map((x) => x.sdE)))}`;
  };
  console.log(`\nESTIMATOR SUMMARY (mean over the 55/75/90 targets, sight ${base}%, points) | ${sizes.map(([S, E]) => line(S, E)).join(' | ')}`);
}

// ================================================================== BOT =====
// A careful scripted player. It only sees what a player sees (visible enemy attributes, the items its sight
// shows, expected field loot) and uses the same API as the UI. Heuristics, not an optimiser.
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
  const smithW = { travelTime: 1, searchTime: 1, searchEff: 0.5, reveal: 0.4, processTime: 1, oreGrade: 1.2, gemGrade: 0.3, foresight: 1 };
  const ablate = new Set(o.ablate || []);
  const gemOrder = ablate.has('gems') ? [] : GEMS.filter((g) => Math.max(gemSword[g], gemArmor[g]) >= 2).sort((a, b) => Math.max(gemSword[b], gemArmor[b]) - Math.max(gemSword[a], gemArmor[a]));
  return {
    slotW, gemSword, gemArmor, ringW, smithW, gemOrder, ablate,
    minWin: o.minwin, future: o.future, immortal: !!o.immortal, carry: o.carry, estimator: o.estimator ?? 'bot',
    simOpts: o.quick ? { samples: 8, fightsPerLoadout: 1, evalFights: 15 } : { samples: 24, fightsPerLoadout: 1, evalFights: 25 },
    verifyOpts: o.quick ? { samples: 10, fightsPerLoadout: 4, evalFights: 15 } : { samples: 30, fightsPerLoadout: 6, evalFights: 30 },
    verifyTop: 3,
    minRate: 0.003, minCraftGain: 1.0, minGemGain: 1.0, cutCap: 3, ironReserve: 4, reserveCap: 240,
    // Repairs happen by day, at camp, on gear that stayed home (they cost time). Rest rule: before packing, an item
    // below restBelow % that the stock can repair tomorrow, or one a champion fight could destroy, stays home when its
    // slot has another item to pack. At camp the bot repairs the top-3 unpacked items of a slot once they are below
    // repairBelow % (exact-grade bars), or below subBelow % when only a higher grade is in stock (a substitute uses
    // up better bars for no benefit).
    usableDur: 15, restBelow: 40, repairBelow: 60, subBelow: 30,
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

// Bars still needed to fully repair the best item of each slot, per material:
// { iron: { need: 0.7, minGrade: 1 } } (minGrade = lowest grade index among the worn items).
function repairNeed(st, P) {
  const need = {};
  if (P.ablate.has('repair')) return need;
  for (const s of SLOTS) {
    const g = st.gear.filter((x) => x.slot === s).sort((a, b) => score(b, P) - score(a, P))[0];
    if (!g || g.durability >= 100) continue;
    const n = sum(Object.values(repairInfo(g).bars));
    const e = (need[g.material] ||= { need: 0, minGrade: 4 });
    e.need += n;
    e.minGrade = Math.min(e.minGrade, GRADES.indexOf(g.grade));
  }
  return need;
}
// Materials whose repair stock is short: less than one full repair of the worn best items, counting
// bars of the item's grade or higher (repairs may use a higher grade as a substitute).
function repairShort(st, P) {
  const short = new Set();
  for (const [m, e] of Object.entries(repairNeed(st, P))) {
    const stock = sum(GRADES.slice(e.minGrade).map((g) => st.storage.bars[`${m}:${g}`] || 0));
    if (stock + EPS < e.need) short.add(m);
  }
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
          if (st.time + smithMinutes(st, slot, m, !!useGem) > DAY_END + EPS) continue;
          if (!best || gain > best.gain + 1e-9) best = { slot, material: m, grade: g, gem: useGem ? { type: useGem.type, grade: useGem.grade } : null, gain };
        }
      }
    }
  }
  return best;
}

function topIds(st, P, n) {
  const ids = new Set();
  for (const s of SLOTS) {
    st.gear.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P)).slice(0, n).forEach((g) => ids.add(g.id));
  }
  return ids;
}

// Should this item be repaired now, and with what? Uses the game's own repairPlan (exact grade if in stock,
// else the lowest higher grade). Returns { want, plan, why } (why: 'ok' | 'none' | 'deferred' | 'fine').
function repairChoice(st, item, P) {
  if (item.packed || item.durability >= P.repairBelow) return { want: false, why: 'fine' };
  const plan = repairPlan(st, item);
  if (!plan.ok) return { want: false, plan, why: 'none' };
  if (plan.substitutes.length && item.durability >= P.subBelow) return { want: false, plan, why: 'deferred' };
  return { want: true, plan, why: 'ok' };
}

// Repair candidates: the top-3 items of each slot, most important first (best item of the slot,
// then by win-% weight).
function repairCandidates(st, P) {
  const top = topIds(st, P, 3);
  const best = new Set(SLOTS.map((s) => st.gear.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P))[0]).filter(Boolean).map((g) => g.id));
  return st.gear
    .filter((g) => top.has(g.id))
    .sort((a, b) => (best.has(b.id) ? 1 : 0) - (best.has(a.id) ? 1 : 0) || score(b, P) * P.slotW[b.slot] - score(a, P) * P.slotW[a.slot]);
}

function doRepair(st, item, plan, rec) {
  const r = repair(st, item.id);
  if (!r.ok) return r;
  rec.repaired++;
  rec.repairBars += sum(Object.values(plan.bars));
  rec.repairPct += plan.missing;
  if (r.substitutes && r.substitutes.length) {
    rec.subRepairs++;
    rec.subBars += sum(r.substitutes.map((x) => (x.kind.endsWith('bars') ? x.qty : 0)));
  }
  return r;
}

// The rest rule (run when packing): items that stay home tonight so they can be repaired tomorrow (below restBelow %
// and repairable with the stock at hand) or because a champion fight could destroy them. An item only rests while
// its slot keeps another item that does not rest.
function restingIds(st, P) {
  const rest = new Set();
  if (P.ablate.has('repair')) return rest;
  const dl = cfg.gear.durabilityLoss;
  const worst = wearLoss(dl.max, (dl.tierMult && dl.tierMult.champion) || 1, smithBonuses(st).gearCarePct);
  for (const slot of SLOTS) {
    const items = st.gear.filter((g) => g.slot === slot).sort((a, b) => score(b, P) - score(a, P));
    for (const it of items) {
      const wants = (it.durability < P.restBelow && repairPlan(st, it).ok) || it.durability <= worst;
      if (wants && items.some((o) => o !== it && !rest.has(o.id))) rest.add(it.id);
    }
  }
  return rest;
}

// Repairs by day (camp + time): unpacked top-3 items below repairBelow %, best item first. Each item is counted
// once per day in the blocked / deferred tallies, however often the bot is at camp.
function dayRepairs(st, ctx, rec) {
  const P = ctx.P;
  if (P.ablate.has('repair')) return;
  for (const it of repairCandidates(st, P)) {
    const c = repairChoice(st, it, P);
    const seen = (what) => {
      const k = `${what}:${st.day}:${it.id}`;
      if (ctx.seen.has(k)) return true;
      ctx.seen.add(k);
      return false;
    };
    if (c.why === 'none' && !seen('blocked')) rec.repairBlocked[st.day] = (rec.repairBlocked[st.day] || 0) + 1;
    if (c.why === 'deferred' && !seen('deferred')) rec.subDeferred++;
    if (!c.want) continue;
    const r = doRepair(st, it, c.plan, rec);
    if (r.ok) ctx.tm.repair += r.minutes;
  }
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
    const r = log('cut', cut(st, g));
    if (!r.ok) break;
    rec.cuts[r.grade] = (rec.cuts[r.grade] || 0) + 1;
  }
  while (tryCraft());
  dayRepairs(st, ctx, rec);
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

// Camp minutes needed to process the haul (`items`: what the bot will carry home; default the bag)
// and smith, so the haul becomes gear today.
function campReserve(st, P, items = st.bag) {
  const worth = worthFn(st, P);
  const noSword = !hasSword(st, P);
  const missing = SLOTS.filter((s) => bestScore(st, s, P) <= 0).length;
  let m = craftMinutes('helmet', false) * Math.max(1, Math.min(3, missing)); // smithing: one 2-bar piece, or up to 3 missing pieces
  for (const t of items) {
    const [kind, type] = t.split(':');
    if (kind === 'gem') m += !noSword && P.gemOrder.includes(type) ? cutMinutes(st, type) : 0;
    else if (type === 'mythril') m += noSword || worth('mythril') ? refineMinutes(st, 'mythril') : 0;
    else if (type === 'coal') m += !noSword && worth('steel') ? refineMinutes(st, 'steel') : 0;
    else if (type === 'iron') m += noSword || worth('iron') ? refineMinutes(st, 'iron') : 0;
    else if (type === 'copper') m += noSword || worth('copper') ? refineMinutes(st, 'copper') : 0;
  }
  return Math.min(P.reserveCap, m);
}

// Camp minutes to process one carried item: refine/cut time plus half a bar's smithing for an ore.
const ORE_BAR = { copper: 'copper', iron: 'iron', coal: 'steel', mythril: 'mythril' };
function procMinutes(st, t) {
  const [kind, type] = t.split(':');
  return kind === 'gem' ? cutMinutes(st, type) : refineMinutes(st, ORE_BAR[type]) + 0.5 * cfg.gear.smithMinPerBar;
}
// Expected camp minutes per item found at a field distance (worthless items are left in the pile).
function procPerFoundItem(st, P, dist, vf) {
  let m = 0;
  for (const [t, share] of Object.entries(itemShares(dist))) if (vf(t) > 0) m += share * procMinutes(st, t);
  return m;
}

// Best field for the next trip (or the next leg of one, from a field while carrying `carrying` items):
// value per minute of what the bot would bring home. Items already in a field's pile (left there on
// earlier trips) count at full value and need no search, only the walk; searches fill the rest of the bag.
function chooseField(st, ctx, vf, from, carrying = []) {
  const P = ctx.P;
  // camp time already committed (processing what is carried + smithing) and the rough processing
  // time of each item a search will add, so the planned haul still becomes gear today
  const committed = campReserve(st, P, carrying);
  let best = null;
  // No sword yet (day 1): stay at the closest fields (most copper, short walks, more time to smith).
  const fields = st.map.cells.filter((c) => c.type === 'field');
  const maxDist = hasSword(st, P) ? Infinity : Math.min(...fields.map((c) => c.dist)) + 1;
  const space = Math.max(0, BAG - carrying.length);
  for (const c of fields) {
    if (sameLoc(c, from) || c.dist > maxDist) continue;
    const tOut = travelMinutes(st, from, c, carrying.length);
    const tBack = travelMinutes(st, c, st.map.camp, BAG);
    const field = st.map.fields[key(c.x, c.y)];
    // the pile: best items first, as many as fit
    const pileTake = field.pile.filter((t) => vf(t) > 0).sort((a, b) => vf(b) - vf(a)).slice(0, space);
    const pileGain = sum(pileTake.map(vf));
    const avail = DAY_END - st.time - committed - tOut - tBack - sum(pileTake.map((t) => procMinutes(st, t)));
    if (avail < 0) continue;
    const left = space - pileTake.length;
    let nNeed = 0;
    let searchGain = 0;
    let sMin = 0;
    const opts = left > 0 ? centerOptions(st, field, vf, ctx.wasDebris).sort((a, b) => b.rate - a.rate) : [];
    if (opts.length) {
      const top0 = opts.slice(0, 4);
      sMin = mean(top0.map((x) => x.minutes)); // minutes of a typical good search here (fresh cells cost extra)
      const itemsPerSearch = mean(top0.map((x) => x.items));
      const perSearch = sMin + Math.min(P.reserveCap, itemsPerSearch * procPerFoundItem(st, P, c.dist, vf));
      const nAvail = Math.floor(avail / perSearch);
      if (nAvail >= 1) {
        const top = opts.slice(0, Math.max(1, Math.ceil(nAvail / 4)));
        const ratePerMin = mean(top.map((x) => x.rate));
        nNeed = Math.min(nAvail, Math.ceil(left / Math.max(0.1, itemsPerSearch)));
        searchGain = ratePerMin * nNeed * sMin;
      }
    }
    if (!nNeed && !pileTake.length) continue;
    const rate = (pileGain + searchGain) / (tOut + tBack + nNeed * sMin);
    if (rate >= P.minRate && (!best || rate > best.rate)) best = { loc: { x: c.x, y: c.y }, rate, pile: pileTake.length, searches: nNeed };
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
      vf, wasDebris: ctx.wasDebris, log: (c, m) => (ctx.tm[c] += m), minRate: ctx.P.minRate, allowMove: true, carry: ctx.P.carry,
      reserve: (s, items) => campReserve(s, ctx.P, items),
      chooseNext: (s, items) => {
        const n = chooseField(s, ctx, vf, s.location, items);
        return n ? n.loc : null;
      },
    });
    if (!res.ok) break;
    rec.tripDist.push(st.map.cells.find((c) => sameLoc(c, target.loc)).dist);
    rec.tripItems.push(res.carried.length);
    rec.found += res.found;
    rec.searches += res.searches;
    rec.carried += res.carried.length;
    rec.fromOldPile += res.fromOldPile;
    rec.fromDebris += res.fromDebris;
    rec.debrisEff += res.debrisEff;
    rec.searchEff += res.searchEff;
    if (!res.searches) rec.pileTrips++;
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
    rec.cuts[r.grade] = (rec.cuts[r.grade] || 0) + 1;
    cutAny = true;
  }
  if (cutAny) campWork(st, ctx, rec);
}

function spendIntelPoints(st, P) {
  if (P.ablate.has('intel')) return;
  for (let guard = 0; guard < 20 && st.intel.points >= 1; guard++) {
    const track = intelValue(st, 'enemySight') < 80 ? 'enemySight' : intelValue(st, 'oreSight') < 40 ? 'oreSight' : 'ringTypeSight';
    if (!spendIntel(st, track).ok) break;
  }
}

function choosePlan(st, ctx, rec) {
  const P = ctx.P;
  const rest = restingIds(st, P);
  const gearIds = [];
  for (const slot of SLOTS) {
    const items = st.gear.filter((g) => g.slot === slot).sort((a, b) => score(b, P) - score(a, P));
    // the rest rule: worn items stay home so they can be repaired tomorrow (when the slot keeps another item)
    gearIds.push(...items.filter((g) => !rest.has(g.id)).slice(0, 2).map((g) => g.id));
  }
  const advRings = P.ablate.has('rings') ? [] : st.rings.filter((r) => ringDef(r.type).owner === 'adventurer');
  const ringIds = pickRings(advRings, P.ringW, cfg.rings.maxWorn).map((r) => r.id);
  const rings = ringTotals(st.rings.filter((r) => ringIds.includes(r.id)));
  const packed = st.gear.filter((g) => gearIds.includes(g.id));
  if (P.immortal) {
    // no estimates: every fight is won; take an elite (the careful bot's usual mid-game pick)
    const i = Math.max(0, st.roster.enemies.findIndex((e) => e.tier === 'elite'));
    const all = Object.fromEntries(TIERS.map((t) => [t, 100]));
    rec.picks.push({ day: st.day + 1, tier: st.roster.enemies[i].tier, p: 100, safe: true, bestP: all, meanP: all });
    return { enemyIndex: i, gearIds, ringIds };
  }
  // Screen all 7 with the best packed piece per slot (fast, a slight underestimate), then
  // re-estimate the top candidates with all packed gear and fresh seeds (removes the
  // "picked the luckiest estimate" bias) and choose among those.
  const primary = SLOTS.map((s) => packed.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P))[0]).filter(Boolean);
  const est = (gear, e, i, salt, opts) => estimateWinChanceSync({ gearItems: gear, ringTotals: rings, tier: e.tier, day: e.day, known: knownLevels(st, e), seed: mixSeed(ctx.seed, st.day, i, salt) }, opts).winPct;
  const evOf = (x) => (x.p / 100) * (cfg.enemies.tiers[x.tier].score + P.future);
  let evals;
  let pool;
  if (P.estimator === 'game') {
    // The in-game "estimate win chances" button: every enemy, all packed gear, the game's own counts
    // (CONFIG.sim + Battle simulation intel + Foresight rings). Its noise is part of the risk.
    const gopts = gameSimOpts(st);
    evals = st.roster.enemies.map((e, i) => {
      const x = { i, tier: e.tier, p: est(packed, e, i, 3, gopts) };
      x.ev = evOf(x);
      return x;
    });
    pool = [...evals];
  } else {
    evals = st.roster.enemies.map((e, i) => {
      const x = { i, tier: e.tier, p: est(primary, e, i, 1, P.simOpts) };
      x.ev = evOf(x);
      return x;
    });
    const order = [...evals].sort((a, b) => b.ev - a.ev);
    for (const x of order.slice(0, P.verifyTop)) {
      x.p = est(packed, st.roster.enemies[x.i], x.i, 2, P.verifyOpts);
      x.ev = evOf(x);
    }
    pool = order.slice(0, P.verifyTop);
  }
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
  const gemGrades = SLOTS.filter((s) => best[s] && best[s].gem).map((s) => GRADES.indexOf(best[s].gem.grade));
  return { score: st.stats.score, swordDmg, defense, powers, mats, label, gems, gemGrade: gemGrades.length ? mean(gemGrades) : NaN, rings: st.rings.length };
}

// What is still in the map: hidden items by type, items in field piles, % searched, finished cells
// (boulders are not counted as cells: they can never be searched).
function mapStats(st) {
  const out = { hidden: 0, pile: 0, ore: Object.fromEntries(ORES.map((o) => [o, 0])), gems: 0, searched: 0, done: 0, cells: 0 };
  for (const f of Object.values(st.map.fields)) {
    out.pile += f.pile.length;
    for (const c of f.cells) {
      if (c.boulder) continue;
      out.cells++;
      out.searched += c.searched;
      if (c.searched >= 100 - EPS) out.done++;
      for (const it of c.items) {
        out.hidden++;
        const [kind, type] = it.t.split(':');
        if (kind === 'ore') out.ore[type]++;
        else out.gems++;
      }
    }
  }
  out.searched /= Math.max(1, out.cells);
  return out;
}

function runBot(seed, D, P) {
  const st = newGame(seed);
  const ctx = { P, wasDebris: new WeakSet(), seed, tm: null, seen: new Set() };
  const rec = {
    seed, deathDay: null, lastDay: 1, timeByDay: {}, tripsByDay: {}, snaps: {}, picks: [], gathered: {}, bars: {},
    crafted: 0, repaired: 0, subRepairs: 0, subBars: 0, subDeferred: 0, repairBars: 0, repairPct: 0, gemsUsed: 0, destroyed: 0,
    craftLog: [], tripDist: [], tripItems: [], wornOut: 0, wornOutMat: {}, repairBlocked: {},
    found: 0, foundByDay: {}, mapByDay: {}, mapStart: null,
    searches: 0, carried: 0, fromOldPile: 0, fromDebris: 0, debrisEff: 0, searchEff: 0, pileTrips: 0, cuts: {},
  };
  rec.mapStart = mapStats(st);
  for (;;) {
    const day = st.day;
    ctx.tm = Object.fromEntries(TIME_CATS.map((c) => [c, 0]));
    workDay(st, ctx, rec);
    rec.timeByDay[day] = ctx.tm;
    rec.foundByDay[day] = rec.found;
    rec.mapByDay[day] = mapStats(st);
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
  rec.mapProgress = mean(Object.values(st.map.fields).map(fieldProgress));
  // what is left lying in field piles at the end, and how much of it the bot would still carry
  const vfEnd = makeValueFn(st, P);
  rec.pileEnd = {};
  rec.pileEndWorth = 0;
  for (const f of Object.values(st.map.fields)) {
    for (const t of f.pile) {
      rec.pileEnd[t] = (rec.pileEnd[t] || 0) + 1;
      if (vfEnd(t) > 0) rec.pileEndWorth++;
    }
  }
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
  // --immortal: enemies deal no damage from here on (the value tables above used the real numbers)
  const immortalLog = o.immortal ? applySet('enemies.tiers.*.damage', '0') : [];
  h1(`BOT — ${N} runs x up to ${D} days (pick: max win% x (points + ${P.future}) among enemies with est. win >= ${P.minWin}%)` +
    (P.ablate.size ? `  ABLATED: ${[...P.ablate].join(', ')}` : ''));
  if (o.immortal) note(`IMMORTAL: ${immortalLog.join(', ')}; the bot fights an elite every day (no estimates). Survival/fight numbers are meaningless here.`);
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
    TIERS.map((t) => `${t} ${f0(mean(d2picks.map((x) => x.meanP[t])))}%`).join(', ') + ` (target ${DAY2_TARGET.normal.join('-')} / ${DAY2_TARGET.elite.join('-')} / ${DAY2_TARGET.champion.join('-')}).`);
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
  note('gem grade = mean grade of the gems in the best item of each slot (0=D, 1=C, 2=B, 3=A, 4=S).');
  printTable(
    ['day', 'alive', 'sword dmg', 'total def %', ...SLOTS.map((s) => `${s} pow`), 'slots>=iron', '>=steel', '>=myth', 'gems', 'gem grade', 'common sword', 'common chest', 'rings', 'score'],
    gdays.map((d) => {
      const sn = recs.map((r) => r.snaps[d]).filter(Boolean);
      return [d, sn.length, f1(mean(sn.map((x) => x.swordDmg))), f1(mean(sn.map((x) => x.defense))), ...SLOTS.map((s) => f2(mean(sn.map((x) => x.powers[s])))),
        f1(mean(sn.map((x) => slotsAtLeast(x, 'iron')))), f1(mean(sn.map((x) => slotsAtLeast(x, 'steel')))), f1(mean(sn.map((x) => slotsAtLeast(x, 'mythril')))),
        f1(mean(sn.map((x) => x.gems))), f2(mean(sn.map((x) => x.gemGrade).filter(Number.isFinite))), modal(sn.map((x) => x.label.sword)), modal(sn.map((x) => x.label.chest)), f1(mean(sn.map((x) => x.rings))), f0(mean(sn.map((x) => x.score)))];
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
  note('clear = the share of search minutes whose effort went into debris (searching clears it; no separate action).');
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
    ['left in field piles', ...types.map((t) => f0(mean(recs.map((r) => r.pileEnd[t] || 0))))],
  ]);
  const fw = {
    searches: mean(recs.map((r) => r.searches)),
    found: mean(recs.map((r) => r.found)),
    carried: mean(recs.map((r) => r.carried)),
    oldPile: mean(recs.map((r) => r.fromOldPile)),
    pileTrips: mean(recs.map((r) => r.pileTrips)),
    trips: mean(recs.map((r) => r.tripItems.length)),
    debrisPct: (100 * sum(recs.map((r) => r.debrisEff))) / Math.max(EPS, sum(recs.map((r) => r.debrisEff + r.searchEff))),
    fromDebrisPct: (100 * sum(recs.map((r) => r.fromDebris))) / Math.max(1, sum(recs.map((r) => r.found))),
    pileEnd: mean(recs.map((r) => sum(Object.values(r.pileEnd)))),
    pileEndWorth: mean(recs.map((r) => r.pileEndWorth)),
  };
  note(`Field work per run: ${f0(fw.searches)} searches found ${f0(fw.found)} items (${f2(fw.found / Math.max(1, fw.searches))}/search) into field piles; ` +
    `${f0(fw.carried)} carried home (${f0((100 * fw.carried) / Math.max(1, fw.found))}% of found) on ${f1(fw.trips)} trips (${f1(fw.carried / Math.max(1, fw.trips))}/trip), ` +
    `${f0(fw.oldPile)} of them picked up from piles left on earlier trips; ${f1(fw.pileTrips)} trips were pure pile pickups (no search). Carry: ${P.carry}.`);
  note(`Piles at the end: ${f0(fw.pileEnd)} items left lying in fields, ${f1(fw.pileEndWorth)} of them still worth carrying to the bot (the rest: ` +
    `ores of materials it no longer needs, surplus gems). Debris: ${f1(fw.debrisPct)}% of search effort went into clearing debris; ` +
    `${f0(fw.fromDebrisPct)}% of found items came from cells that had debris.`);
  const cutsAll = Object.fromEntries(['F', 'D', 'C', 'B', 'A', 'S'].map((g) => [g, mean(recs.map((r) => r.cuts[g] || 0))]));
  const cutN = sum(Object.values(cutsAll));
  note(`Gems cut per run: ${f1(cutN)} (${['F', 'D', 'C', 'B', 'A', 'S'].map((g) => `${g} ${f0((100 * cutsAll[g]) / Math.max(EPS, cutN))}%`).join(', ')}); gem order: ${P.gemOrder.join(' > ') || '(none)'}.`);
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
  const repairDays = (r) => Object.entries(r.timeByDay).filter(([d]) => Number(d) >= 2);
  note(`Repairs: 0 at night (repairs only happen by day) and ${f1(mean(recs.map((r) => r.repaired)))} by day per run, ` +
    `${f1(mean(recs.map((r) => sum(Object.values(r.timeByDay).map((t) => t.repair)))))} repair minutes per run (${f1(mean(recs.flatMap((r) => repairDays(r).map(([, t]) => t.repair))))} min a day)` +
    ` (the bot repairs an unpacked top-3 item below ${P.repairBelow}%, or below ${P.subBelow}% if only a higher grade is in stock; ` +
    `items below ${P.restBelow}% that it can repair stay home, as do items a champion fight could destroy).` +
    ` With a higher-grade substitute: ${f1(mean(recs.map((r) => r.subRepairs)))} repairs/run (${f2(mean(recs.map((r) => r.subBars)))} better bars used);` +
    ` deferred because only a higher grade was in stock: ${f1(mean(recs.map((r) => r.subDeferred)))} item-days/run.`);
  note(`Repair blocked (a worn top-3 item below ${P.repairBelow}% with no bars of its material at its grade or higher): ` +
    `${f1(mean(recs.map((r) => Object.keys(r.repairBlocked).length)))} days/run, ${f1(mean(recs.map((r) => sum(Object.values(r.repairBlocked)))))} item-days/run.`);
  note('Trips per run by field distance: ' + BUCKETS.map((d) => `d${bucketLabel(d)} ${f1(mean(recs.map((r) => r.tripDist.filter((x) => bucketOf(x) === d).length)))}`).join(', ') +
    `; mean trip distance ${f2(mean(recs.flatMap((r) => r.tripDist)))}.`);

  // ---- map supply (finite: fields never refill)
  h2('Map supply (the map is the whole supply; runs alive on that day; window = the 10 days up to it)');
  const start = {
    items: mean(recs.map((r) => r.mapStart.hidden)),
    ore: Object.fromEntries(ORES.map((o) => [o, mean(recs.map((r) => r.mapStart.ore[o]))])),
  };
  note(`A map starts with ${f0(start.items)} hidden items: ` + ORES.map((o) => `${o} ${f0(start.ore[o])}`).join(', ') + `, gems ${f0(mean(recs.map((r) => r.mapStart.gems)))}.`);
  const mdays = dayList([5, 10, 15, 20, 30, 40, 50, 60, 70, 80, 100, 120, 150]);
  const supply = {};
  printTable(
    ['day', 'alive', 'found (cum)', '% of map', 'cells done %', 'searched %', 'in piles', ...ORES.map((o) => `${o} left`), 'trips/day', 'found/trip', 'found/day', 'mining min/found item', 'idle min'],
    mdays.map((d) => {
      const rs = recs.filter((r) => r.mapByDay[d]);
      const w0 = Math.max(0, d - 10);
      const win = (r, f) => {
        const out = [];
        for (let x = w0 + 1; x <= d; x++) if (r.timeByDay[x]) out.push(f(x));
        return out;
      };
      const foundW = rs.map((r) => (r.foundByDay[d] - (r.foundByDay[w0] || 0)) / Math.max(1, win(r, () => 1).length));
      const mineW = rs.map((r) => sum(win(r, (x) => sum(MINING.map((c) => r.timeByDay[x][c])))));
      const foundSum = rs.map((r) => r.foundByDay[d] - (r.foundByDay[w0] || 0));
      const tripsW = rs.flatMap((r) => win(r, (x) => r.tripsByDay[x] || 0));
      const idleW = rs.flatMap((r) => win(r, (x) => DAY_LEN - sum(TIME_CATS.map((c) => r.timeByDay[x][c]))));
      const pct = rs.map((r) => (100 * r.foundByDay[d]) / Math.max(1, r.mapStart.hidden));
      supply[d] = { pct: mean(pct), n: rs.length };
      return [d, rs.length, f0(mean(rs.map((r) => r.foundByDay[d]))), f0(mean(pct)), f0(mean(rs.map((r) => (100 * r.mapByDay[d].done) / r.mapByDay[d].cells))),
        f0(mean(rs.map((r) => r.mapByDay[d].searched))), f0(mean(rs.map((r) => r.mapByDay[d].pile))), ...ORES.map((o) => f0(mean(rs.map((r) => r.mapByDay[d].ore[o])))),
        f1(mean(tripsW)), f1(sum(foundSum) / Math.max(1, sum(tripsW))), f1(mean(foundW)), f1(sum(mineW) / Math.max(1, sum(foundSum))), f0(mean(idleW))];
    }),
  );
  note('found = items taken out of cells by searching (into the field\'s pile). "in piles" = found items still lying in field piles.\n' +
    '"x left" = still hidden in the map (unfound).\n' +
    'Rising mining minutes per found item, falling trips/day or rising idle time mean the reachable supply is running low.');

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
    ` | repair ${f1((100 * repairBars) / Math.max(1, barsMade))}% bars ${f1((100 * repairMin) / Math.max(1, usedMin))}% time, 0 at night (${f1(mean(recs.map((r) => r.subRepairs)))} subst.)` +
    ` | map found ${[40, 60, 80].filter((d) => supply[d]).map((d) => `d${d}:${f0(supply[d].pct)}%`).join(' ') || '-'}` +
    ` | field: ${f2(fw.found / Math.max(1, fw.searches))} found/search, carried ${f0((100 * fw.carried) / Math.max(1, fw.found))}% of found (${f1(fw.carried / Math.max(1, fw.trips))}/trip, ${f0(fw.oldPile)} from old piles),` +
    ` piles at end ${f0(fw.pileEnd)} (${f1(fw.pileEndWorth)} worth), debris ${f1(fw.debrisPct)}% of effort` +
    ` | gems cut ${f1(cutN)}/run F/D/C+ ${f0((100 * cutsAll.F) / Math.max(EPS, cutN))}/${f0((100 * cutsAll.D) / Math.max(EPS, cutN))}/${f0((100 * (cutN - cutsAll.F - cutsAll.D)) / Math.max(EPS, cutN))}%, ${f1(mean(recs.map((r) => r.gemsUsed)))} infused`);
  return recs;
}


// ============================================================ BENCHMARK =====
// The difficulty benchmark: the careful bot on a FIXED list of seeds (mixSeed(31337, 0..N-1); the same
// seeds in every version), reporting the survival curve = % of runs still alive at the end of day d.
// Only the game changes between versions, so the curve shows how tough each version is. The numbers
// that matter are the alive% columns and the median life; the mean score is secondary.
// Noise: with 100 runs one alive% has a standard error of up to 5 points (so compare versions by the
// shape of the curve, and treat differences under about 10 points as noise).
const BENCH_DAYS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];
const BENCH_SEED_BASE = 31337;

// Runs benchmark seeds i = from, from + step, ... (< N) and returns light records.
function benchRuns(o, N, D, P, shard) {
  const [from, step] = shard || [0, 1];
  const out = [];
  for (let i = from; i < N; i += step) {
    const r = runBot(mixSeed(BENCH_SEED_BASE, i), D, P);
    out.push({ i, deathDay: r.deathDay, lastDay: r.lastDay, score: r.score, wins: r.wins });
  }
  return out;
}

// --jobs: the same command in k child processes, each running every k-th seed; results are merged
// (a run only depends on its seed and the config, so this equals one process).
function benchViaChildren(o, N) {
  const argv = process.argv.slice(2);
  const base = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--jobs' || argv[i] === '--seeds') i += 1; // skipped here: children get --seeds N and their --shard
    else if (argv[i].startsWith('--jobs=') || argv[i].startsWith('--seeds=')) continue;
    else base.push(argv[i]);
  }
  const script = fileURLToPath(import.meta.url);
  const children = [];
  for (let k = 0; k < o.jobs; k++) {
    children.push(new Promise((resolve, reject) => {
      const c = spawn(process.execPath, [script, ...base, '--seeds', String(N), '--shard', `${k}/${o.jobs}`, '--emit-json'], { stdio: ['ignore', 'pipe', 'inherit'] });
      let out = '';
      c.stdout.on('data', (d) => (out += d));
      c.on('error', reject);
      c.on('close', (code) => {
        const line = out.split('\n').find((l) => l.startsWith('BENCH_JSON '));
        if (code !== 0 || !line) reject(new Error(`benchmark child ${k} failed (exit ${code})`));
        else resolve(JSON.parse(line.slice('BENCH_JSON '.length)));
      });
    }));
  }
  return Promise.all(children).then((parts) => parts.flat());
}

async function benchmarkSection(o) {
  const N = o.seeds ?? (o.quick ? 6 : 100);
  const D = o.quick ? Math.min(o.days, 40) : o.days;
  const estimator = o.estimator ?? 'game';
  if (o.emitJson) {
    const VT = valueTables(o.quick ? 30 : 150, o.quick ? 15 : 40);
    const P = botParams(VT, { ...o, estimator });
    console.log('BENCH_JSON ' + JSON.stringify(benchRuns(o, N, D, P, o.shard)));
    return null;
  }
  const t0 = Date.now();
  const sim0 = gameSimOpts(newGame(1));
  const estText = estimator === 'game'
    ? `in-game estimate (${sim0.samples ?? cfg.sim.samples} guesses x ${sim0.evalFights ?? cfg.sim.evalFights} test fights, gear picked with ${sim0.fightsPerLoadout ?? cfg.sim.fightsPerLoadout} fights per loadout${simMod.simCounts ? ", plus the bot's Foresight rings" : ''})`
    : "the bot's own two-stage estimate (24 guesses x 25 fights screen, top 3 re-checked with 30 x 30)";
  h1(`BENCHMARK — version ${VERSION}: careful bot, ${N} fixed seeds x up to ${D} days`);
  note(`Seeds: mixSeed(${BENCH_SEED_BASE}, 0..${N - 1}). Estimator: ${estText}. The bot fights an enemy only if its estimate is >= ${o.minwin}% (else the best one).`);
  let recs;
  if (o.jobs > 1) recs = await benchViaChildren(o, N);
  else {
    const VT = valueTables(o.quick ? 30 : 150, o.quick ? 15 : 40);
    const P = botParams(VT, { ...o, estimator });
    recs = benchRuns(o, N, D, P, null);
  }
  recs.sort((a, b) => a.i - b.i);
  if (recs.length !== N) throw new Error(`benchmark: expected ${N} runs, got ${recs.length}`);
  note(`(${((Date.now() - t0) / 1000).toFixed(1)}s${o.jobs > 1 ? `, ${o.jobs} processes` : ''})`);

  const alive = (r, d) => r.lastDay >= d && !(r.deathDay != null && r.deathDay <= d);
  const alivePct = (d) => (100 * recs.filter((r) => alive(r, d)).length) / N;
  const days = BENCH_DAYS.filter((d) => d <= D);
  const life = recs.map((r) => r.deathDay ?? Infinity).sort((a, b) => a - b);
  const q = (p) => {
    const v = quantile(life, p);
    return v === Infinity ? `>${D}` : f1(v);
  };
  const medLife = median(life);
  const medText = medLife === Infinity ? `>${D}` : f1(medLife);
  const meanScore = mean(recs.map((r) => r.score));

  h2('Survival curve: % of runs alive at the end of day d');
  printTable(['day', ...days.map(String), 'median life', 'mean score'], [['% alive', ...days.map((d) => f0(alivePct(d))), medText, f0(meanScore)]]);
  const fine = [];
  for (let d = 5; d <= D; d += 5) fine.push(d);
  note('Every 5 days: ' + fine.map((d) => `d${d} ${f0(alivePct(d))}`).join(' | '));
  note(`Life (day of death; runs alive at day ${D} count as >${D}): p10 ${q(0.1)}, p25 ${q(0.25)}, median ${medText}, p75 ${q(0.75)}, p90 ${q(0.9)}.`);
  const deaths = recs.filter((r) => r.deathDay != null);
  const bins = [[2, 2], [3, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 79], [80, 200]].filter(([a]) => a <= D);
  note(`Deaths ${deaths.length}/${N}. By day: ` + bins.map(([a, b]) => `${a === b ? a : `${a}-${b}`}: ${deaths.filter((r) => r.deathDay >= a && r.deathDay <= b).length}`).join(', ') + '.');
  const scores = recs.map((r) => r.score);
  note(`Score: mean ${f0(meanScore)}, median ${f0(median(scores))}, min ${Math.min(...scores)}, max ${Math.max(...scores)}. ` +
    `Wins per run: ${TIERS.map((t) => `${t} ${f1(mean(recs.map((r) => r.wins[t])))}`).join(', ')}.`);
  note(`Noise: one alive% has a standard error of ${f1(50 / Math.sqrt(N))} points at 50% (100 runs: 5); treat differences under about 10 points as noise.`);

  const estShort = estimator === 'game' ? `game ${sim0.samples ?? cfg.sim.samples}x${sim0.evalFights ?? cfg.sim.evalFights}` : 'bot';
  console.log(`\nBENCHMARK | v${VERSION} | seeds ${N} | alive ${days.map((d) => `d${d}:${f0(alivePct(d))}%`).join(' ')} | median life ${medText} | mean score ${f0(meanScore)} | estimator ${estShort}`);
  console.log('\nMarkdown row for docs/BENCHMARKS.md (add your own notes at the end):');
  console.log(`| ${VERSION} | ${new Date().toISOString().slice(0, 10)} | ${N} | ${BENCH_DAYS.map((d) => (d <= D ? f0(alivePct(d)) : '-')).join(' | ')} | ${medText} | ${f0(meanScore)} | estimator ${estShort} |`);
  return recs;
}

// ================================================================= MAIN =====
async function main() {
  const o = ARGS;
  if (o.help) {
    console.log(readHelp());
    return;
  }
  if (SET_LOG.length && !o.emitJson) console.log(`WHAT-IF overrides (memory only):\n${SET_LOG.map((x) => `  ${x}`).join('\n')}`);
  const t0 = Date.now();
  let T = null;
  const run = async (name, fn) => {
    const t = Date.now();
    await fn();
    console.log(`\n[${name}: ${((Date.now() - t) / 1000).toFixed(1)}s]`);
  };
  if (o.emitJson) {
    await benchmarkSection(o);
    return;
  }
  if (o.section === 'all' || o.section === 'economy') await run('economy', () => economySection(o));
  if (o.section === 'all' || o.section === 'power') await run('power', () => (T = powerSection(o, null)));
  if (o.section === 'all' || o.section === 'bot') await run('bot', () => botSection(o, T));
  if (o.section === 'benchmark') await run('benchmark', () => benchmarkSection(o));
  if (o.section === 'specials') await run('specials', () => specialsSection(o));
  if (o.section === 'estimator') await run('estimator', () => estimatorSection(o));
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
  applySet, parseArgs, workDay, choosePlan, spendIntelPoints, snapshot, runBot, botParams, valueTables, economySection, powerSection, botSection, benchmarkSection,
  centerOptions, chooseField, makeValueFn, campReserve, winPct, setOf, mkItem,
};

if (IS_MAIN) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
