#!/usr/bin/env node
// ============================================================================
// SMITHSY BALANCE REPORT — is the pacing and difficulty sensible?
//
//   node tools/balance.mjs [--section economy|power|day2|bot|benchmark|specials|estimator|intel|all]
//                          [--persona careful|champion|casual|all] [--intel persona|only:<track>|none]
//                          [--seeds N] [--days N] [--samples N] [--minwin P] [--future F] [--ablate x,y]
//                          [--immortal] [--carry value|default] [--estimator game|bot] [--jobs N] [--quick]
//                          [--set path=value ...]
//
//   --section  which report to run (default: all = economy + power + bot; the others are separate)
//   --persona  which kind of player the bot is (R46; see PERSONAS below): careful (Careful planner), champion
//              (Champion hunter), casual (Casual), or all. Default: careful; benchmark: all
//   --intel    how the bot spends intel points: persona (its own list, the default), only:<track> (that track first
//              until it is maxed, then the persona's list), none (every track's gains set to [0] in memory, so no
//              point can be spent and the plan gate stays open)
//   --seeds    economy: generated maps (default 100); bot: runs (default 20; survival numbers move
//              by ~+-10 points between seed sets of this size, use 40+ to compare close what-ifs);
//              benchmark and intel: runs (default 100, the fixed seed list mixSeed(31337, 0..N-1))
//   --days     bot: play up to this day (default 80; runs that are still alive then are cut off);
//              benchmark: default 100; intel: default 60
//   --estimator  how the bot estimates win chances when it plans a fight. game = the in-game automatic estimate
//              (every enemy, all packed gear, the game's own counts: CONFIG.sim + Battle simulation intel +
//              Foresight rings; the default for benchmark and intel). bot = the bot's own larger two-stage estimate
//              (screen all 7, re-check the top 3; the default for the bot section, independent of the game's own estimate). The casual
//              persona never reads an estimate
//   --jobs     benchmark and intel: run the seeds in N parallel node processes (same numbers as 1 process)
//   --samples  power: hidden-attribute guesses per win-% cell (default 100, x50 fights each)
//   --minwin   bot: minimum estimated win % to accept a fight (default: the persona's, careful 90)
//   --future   bot: points one survival is worth when comparing fights (default: the persona's, careful 1000 =
//              a 50-point champion needs >= 96% of the best normal's win chance)
//   --ablate   bot: play without some systems, comma separated: gems (never cut/infuse), rings (never
//              wear), skills (no skill levels), intel (never spend), repair (never repair)
//   --immortal bot: enemies deal no damage (memory only, set after the bot's value tables are built) and
//              the bot fights an elite every day without estimating, so no run ends early. Use it to see
//              how fast a surviving careful player uses up the finite map (the "Map supply" table)
//   --carry    what the bot (and the economy trips) take home from a field: 'value' = the most
//              valuable items of bag + pile by the bot's value function, worthless items stay in the pile;
//              'default' = the game's defaultCarry (keep the bag, fill free slots with the rarest pile items).
//              Default: the persona's (careful value, casual default)
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
// Sections (each ends with a one-line SUMMARY and prints the plan's targets, docs/PLAN-2.0.md section 9, with a flag)
//   economy  Uses the real map generation + search code on fresh games: items per search by field
//            distance, the map (fields per distance, attempts per map), how much search effort goes into debris
//            (searching clears it), what a trip finds vs carries (finds go to the field's pile, a trip carries up
//            to the bag size), what sight is worth (3c), ore/gem mix, minutes per raw item including travel, bar and
//            gem-cut grade odds, and the minutes needed to mine + refine + smith a full set of each material.
//            Targets T-E1..T-E5.
//   power    Win % of loadouts vs each enemy tier over days (estimateWinChanceSync, all attributes
//            hidden = a typical enemy of the tier): the day-2 fight with day-1 gear, archetype sets,
//            the weakest full set that holds target win rates on each day, how much each gem / ring / gear slot is
//            worth, and the daily-grid anchors (the last day a plain set wins 70% vs a typical elite). T-MID.
//   day2     The first fight (day 2) without equipment (R7), tier by tier: 600 enemies x 300 fights each, win % overall
//            and by how many of Magical / Stunning / Chilling are High, flagged against the targets in docs/PLAN-2.0.md
//            (T-R7); then the same with a day-1 kit (Copper D sword; sword + chest; sword + chest + one matching gem per
//            High special) as information and against T-GEAR. Prints a DAY2 summary line. Not part of `all`.
//   specials Gem balance (R33, T-R33 M1-M7): how much each enemy special costs (Normal to High), what the matching armor
//            gem wins back next to emerald armor, how much of a sword gem survives a High resistance, and whether
//            the five sword gems are about equally strong; iron / steel / mythril C sets vs an elite on the day that
//            set wins about 55% (window of 5 days).
//   estimator How accurate the in-game automatic win estimate is at 5x5, 6x6, 8x8 and 10x10 at 10% enemy scouting (shown
//            margin, miss vs the true chance, wobble), what it costs (fights per roster, ms) with 2 and 3 items
//            per gear type, and the margin floor. T-A2.
//   bot      A scripted player (--persona; default careful) that drives the real game API day by day (gather,
//            refine, cut, smith, repair by day, rings, intel, plan) and reports survival, score, gear over time,
//            the daily time split (with the load penalty), rings, skills at day 30, gem supply, repairs, the tiers
//            it chose and how much of the map's finite supply it has used (fields never refill). Targets T-B1..T-B5,
//            T-GEAR (c).
//            In a field it searches (clearing debris on the way) until what is worth carrying fills the
//            bag, chooses what to carry (--carry) and leaves the rest in the field's pile; its trip choice
//            values items lying in piles (no search needed), so it comes back for them when worth it.
//   benchmark  Difficulty benchmark: the personas on a FIXED list of seeds, reporting the
//            SURVIVAL CURVE (% of runs still alive at day 2, 3, 4, 5, 10, ... 100), the median life, the mean
//            score, score per day, the tiers fought and the estimate of the fights taken, as a table row, a
//            one-line BENCHMARK summary and a markdown row per persona for docs/BENCHMARKS.md. This tool only runs on
//            2.0 trees (it imports 2.0 functions); to compare with an older version, run that tree's own tool. Targets T-D, T-P.
//   intel    Does one intel track dominate? The careful persona on the same seeds in 8 modes (each track alone first,
//            the persona's own list, no intel at all): mean life and score per mode and the paired difference to the
//            best mode. Target T-R42.
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
  travel, search, defaultCarry, distanceRow, sightValue, sightShare, seenItems, generateMap, cellFresh,
} from '../js/core/map.js';
import { adjustDistribution, blendCutTable, refineMinutes, cutMinutes, rollGrade, refine, cut } from '../js/core/processing.js';
import { gearStats, craftMinutes, smithMinutes, craft, repairInfo, repairPlan, repair, couldBreak } from '../js/core/gear.js';
import { ringDef, ringValue, ringTotals, wornRings, toggleRing } from '../js/core/rings.js';
import { estimateWinChanceSync, shownMargin, pruneDominated, simCounts } from '../js/core/sim.js';
import { knownLevels, enemyCombatant, rollLevels, generateRoster, ringTypeVisible, ringGradeVisible, groupVisible, hiddenGradeOdds } from '../js/core/enemies.js';
import { adventurerCombatant, fight } from '../js/core/combat.js';
import { spendIntel, intelValue, nextIntelGain, canSpendIntel } from '../js/core/intel.js';
import { groupProgress } from '../js/core/groups.js';
import { packLimit, defaultPack } from '../js/core/pack.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { itemXp, skillDefs } from '../js/core/skills.js';
import { seededRng, mixSeed, makeRng } from '../js/core/rng.js';
import { EPS, deepClone } from '../js/core/util.js';
import { VERSION } from '../js/version.js';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';

// ============================================================== PERSONAS =====
// R46: one bot engine, three kinds of player. These are tool settings (how a bot plays), not game numbers, so they
// live here and not in js/config.js. Everything else in the bot (gathering, refining, cutting, smithing, repairs by
// day) is shared; a persona changes who it fights, what it packs, how it spends intel and how much it works.
//   pick          'ev': the best expected value among fights it is sure of (estimate >= minWin), else the surest;
//                 'champion': takes a champion it is 70% sure of, else an elite it is 80% sure of, else the best
//                 p x (score + future) over fights it is at least 50% sure of; 'looks': never reads an estimate, takes the
//                 enemy that looks easiest (fewest visible High attributes), normals until it owns enough gear
//   future        points one survival is worth when comparing fights (expected value = p x (score + future + extras))
//   intel         spend each point on the first entry whose track is below its target (and can still gain); '*' (and
//                 'roundRobin') = the track with the fewest points that can still gain (config order on ties). A
//                 persona always spends every point, because the next day cannot start while one can be spent
//   pack          'score': the best packLimit items per gear type by the bot's score, after the rest rule; 'default':
//                 the game's own default pack ("Best per type", skipping items that could break)
//   rings         'value': the ring set with the most win value (pickRings); 'grade': the best grades first, any type
//   restBelow / repairBelow / subBelow   the rest rule and the day repairs (see botParams)
//   trips         most trips a day; minRate: least value per minute worth a trip; carry: 'value' | 'default'
//   swordBias     multiplies the sword slot's weight when deciding what to smith
export const PERSONAS = {
  careful: { name: 'Careful planner', pick: 'ev', minWin: 90, future: 1000,
    intel: [['enemySight', 40], ['simDepth', 3], ['groupSight', 50], ['oreSight', 30], ['*']],
    pack: 'score', rings: 'value', restBelow: 40, repairBelow: 60, subBelow: 30, trips: 5, minRate: 0.003, carry: 'value', swordBias: 1 },
  champion: { name: 'Champion hunter', pick: 'champion', champMin: 70, eliteMin: 80, future: 150,
    intel: [['simDepth', 3], ['enemySight', 40], ['ringTypeSight', 49], ['*']],
    pack: 'score', rings: 'value', restBelow: 0, repairBelow: 30, subBelow: 15, trips: 5, minRate: 0.003, carry: 'value', swordBias: 1.5 },
  casual: { name: 'Casual', pick: 'looks', gearLevelForElites: 6, intel: 'roundRobin',
    pack: 'default', rings: 'grade', restBelow: 0, repairBelow: 30, subBelow: 0, trips: 2, minRate: 0.003, carry: 'default', swordBias: 1 },
};
// The keys every persona has, and the extra keys each way of picking an enemy reads (tests/personas.test.mjs).
export const PERSONA_KEYS = ['name', 'pick', 'intel', 'pack', 'rings', 'restBelow', 'repairBelow', 'subBelow', 'trips', 'minRate', 'carry', 'swordBias'];
export const PICK_KEYS = { ev: ['minWin', 'future'], champion: ['champMin', 'eliteMin', 'future'], looks: ['gearLevelForElites'] };
const PERSONA_NAMES = Object.keys(PERSONAS);
const isPersona = (name) => Object.prototype.hasOwnProperty.call(PERSONAS, name);

// The benchmark's survival days and the death-day bins (R46: days 2, 3 and 4 are in from 2.0 on).
export const BENCH_DAYS = [2, 3, 4, 5, 10, 15, 20, 25, 30, 40, 50, 60, 70, 80, 100];
export const DEATH_BINS = [[2, 2], [3, 3], [4, 4], [5, 9], [10, 19], [20, 29], [30, 39], [40, 49], [50, 59], [60, 79], [80, Infinity]];

const IS_MAIN = !!process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
const SET_LOG = [];
let ARGS;
try {
  ARGS = IS_MAIN ? parseArgs(process.argv.slice(2)) : parseArgs([]);
  for (const [path, value] of ARGS.set) SET_LOG.push(...applySet(path, value));
  // System ablations that are pure config switches (applied before anything reads CONFIG).
  if (ARGS.ablate.includes('skills')) SET_LOG.push(...applySet('skills.maxLevel', '0'));
  // Without intel no track can gain, so a point can never be spent and the plan gate (confirmPlan) stays open.
  if (ARGS.ablate.includes('intel')) SET_LOG.push(...applySet('intel.tracks.*.gains', '[0]'));
  for (const [path, value] of intelModeSets(ARGS.intel)) SET_LOG.push(...applySet(path, value)); // --intel none
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
// "+3.1" / "-0.4" / "0.0": a signed number that never prints "-0" for a value that rounds to zero.
const signed = (v, d = 0) => {
  const t = fx(v, d);
  return /^-0(\.0+)?$/.test(t) ? t.slice(1) : v > 0 && t !== '-' ? `+${t}` : t;
};
const sum = (a) => a.reduce((x, y) => x + y, 0);
const mean = (a) => (a.length ? sum(a) / a.length : NaN);
// Mean of the finite numbers (NaN when there are none): a persona that never reads an estimate has p = null.
const meanFinite = (a) => mean(a.filter(Number.isFinite));
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
// ------------------------------------------------------------- targets ----
// The plan's balance targets (docs/PLAN-2.0.md section 9). check() judges one measured value against [lo, hi] (null =
// open end) and remembers the row in `rows`; printTargets() shows a section's rows; targetFlags() is the short form for
// its SUMMARY line (one entry per id: ok, or how many of its rows missed).
export function judge(value, lo, hi) {
  if (!Number.isFinite(value)) return 'n/a';
  if (lo != null && value < lo - 1e-9) return 'LOW';
  if (hi != null && value > hi + 1e-9) return 'HIGH';
  return 'ok';
}
function check(rows, id, what, value, lo, hi, digits = 1) {
  const flag = judge(value, lo, hi);
  const target = lo != null && hi != null ? `${lo}-${hi}` : lo != null ? `>= ${lo}` : `<= ${hi}`;
  rows.push([id, what, fx(value, digits), target, flag]);
  return flag;
}
function printTargets(rows, title = 'Targets (docs/PLAN-2.0.md section 9)') {
  h2(title);
  printTable(['id', 'what', 'measured', 'target', 'flag'], [...rows].sort((a, b) => a[0].localeCompare(b[0])));
}
function targetFlags(rows) {
  const ids = [...new Set(rows.map((r) => r[0]))];
  return ids.map((id) => {
    const mine = rows.filter((r) => r[0] === id);
    const bad = mine.filter((r) => r[4] !== 'ok');
    return bad.length ? `${id} ${bad.every((r) => r[4] === 'n/a') ? 'n/a' : `MISS ${bad.length}/${mine.length}`}` : `${id} ok`;
  }).join(' ');
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
  const o = { section: 'all', seeds: null, days: null, samples: null, minwin: null, future: null, quick: false, immortal: false, help: false, set: [], ablate: [], carry: null, estimator: null, jobs: 1, shard: null, emitJson: false, persona: null, intel: 'persona' };
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
    } else if (a === '--persona') {
      o.persona = val();
      if (o.persona !== 'all' && !isPersona(o.persona)) throw new Error(`--persona: unknown persona ${o.persona} (${[...PERSONA_NAMES, 'all'].join(', ')})`);
    } else if (a === '--intel') {
      o.intel = val();
      const track = o.intel.startsWith('only:') ? o.intel.slice(5) : null;
      if (track != null) {
        if (!Object.prototype.hasOwnProperty.call(CONFIG.intel.tracks, track)) throw new Error(`--intel: unknown track ${track} (${Object.keys(CONFIG.intel.tracks).join(', ')})`);
      } else if (!['persona', 'none'].includes(o.intel)) throw new Error('--intel must be persona, none or only:<track>');
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
  if (!['all', 'economy', 'power', 'day2', 'bot', 'benchmark', 'specials', 'estimator', 'intel'].includes(o.section)) throw new Error(`Unknown section ${o.section}`);
  if (o.days == null) o.days = o.section === 'benchmark' ? 100 : o.section === 'intel' ? 60 : 80;
  // The benchmark runs every persona unless one is named; every other section plays the careful planner.
  if (o.persona == null) o.persona = o.section === 'benchmark' ? 'all' : 'careful';
  if (o.section === 'intel' && o.persona === 'all') throw new Error('--section intel runs one persona (default careful)');
  return o;
}

// The CONFIG switches an --intel mode needs: 'none' sets every track's gains to [0], so no point can be spent (the plan
// gate stays open) and intel does nothing. 'persona' and 'only:<track>' only change the order the bot spends in.
export function intelModeSets(mode) {
  return mode === 'none' ? [['intel.tracks.*.gains', '[0]']] : [];
}

// Override CONFIG values in memory (what-if runs). Path segments are object keys or array indices;
// '*' matches every key / index at that level. The path must already exist (catches typos), and a
// number can only be replaced by a number. Returns ["path: old -> new", ...] for the report header.
// With an `undo` array, every change also pushes a function that puts the old value back (withSets).
function applySet(path, raw, undo = null) {
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
      if (undo) undo.push(() => { obj[k] = old; });
      out.push(`${[...trail, k].join('.')}: ${JSON.stringify(old)} -> ${JSON.stringify(value)}`);
    }
  };
  walk(CONFIG, 0, []);
  return out;
}

// Runs fn() with CONFIG changed in memory (sets = [[path, value], ...], see applySet) and puts everything back afterwards,
// also when fn throws. For a measurement that needs one number different (sight forced to 40, intel switched off).
export function withSets(sets, fn) {
  const undo = [];
  try {
    for (const [path, value] of sets) applySet(path, String(typeof value === 'string' ? value : JSON.stringify(value)), undo);
    return fn();
  } finally {
    for (const u of undo.reverse()) u();
  }
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
// The in-game estimate's sizes for this game state: simCounts (CONFIG.sim + intel + Foresight rings).
const gameSimOpts = (st) => simCounts(st);

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
        if (cellFresh(field.cells[i])) fresh++;
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
function planCarry(st, vf, mode = ARGS.carry ?? 'value') {
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
  // A walk. p.logLoad(minutes) is told how much of it the carried load added (the same walk with nothing carried is the rest).
  const walk = (dest, carry = null) => {
    const empty = travelMinutes(st, st.location, dest, 0);
    const res = travel(st, dest, cfg, carry);
    if (res.ok && p.logLoad) p.logLoad(Math.max(0, res.minutes - empty));
    return res;
  };
  let r = walk(target);
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
          r = walk(next, plan);
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
    r = walk(st.map.camp, plan);
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

// How many attempts generateMap needed for the map a game with this seed gets. It shuffles the candidate cells (every cell
// but the camp) once per attempt, and then each field shuffles its own cells once, so the attempts are the shuffles of that
// length. (A field with exactly as many cells as the candidates could not be told apart: NaN.)
function mapAttempts(seed) {
  const need = cfg.map.size ** 2 - 1;
  if (need === cfg.field.size ** 2) return NaN;
  const rng = makeRng({ s: seed >>> 0 });
  let attempts = 0;
  generateMap({ ...rng, shuffle: (arr) => { if (arr.length === need) attempts++; return rng.shuffle(arr); } }, cfg);
  return attempts;
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
    ['dist', 'fields/map', 'items/field', 'ores', 'gems', 'gem %', 'gem % set', 'boulders', 'debris cells', 'mean thickness', 'items under debris'],
    BUCKETS.map((b) => {
      const a = agg[b];
      const per = (v) => (a.fields ? v / a.fields : NaN);
      const ores = sum(Object.entries(a.types).filter(([t]) => t.startsWith('ore:')).map(([, v]) => v));
      return [bucketLabel(b), f2(a.fields / N), f1(per(a.items)), f1(per(ores)), f1(per(a.items - ores)), f0((100 * (a.items - ores)) / Math.max(1, a.items)), distanceRow(b).gemShare, f1(per(a.boulders)), f1(per(a.debrisCells)),
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
  // The map itself: how many fields, how far, and how many tries generateMap needs to find a map without long detours.
  const mapRows = states.map((st, si) => {
    const fields = st.map.cells.filter((c) => c.type === 'field');
    return { n: fields.length, far: fields.filter((c) => c.dist >= 5).length, attempts: mapAttempts(mixSeed(9001, si)) };
  });
  const attemptsMean = mean(mapRows.map((m) => m.attempts));
  const farOk = (100 * mapRows.filter((m) => m.far >= 6).length) / N;
  const fieldsPerMap = mean(mapRows.map((m) => m.n));
  note(`Map: ${cfg.map.size}x${cfg.map.size} with ${cfg.map.blockedCells} blocked cells and a detour limit of ${cfg.map.maxDetour}: ${f1(fieldsPerMap)} fields per map (` +
    BUCKETS.map((b) => `d${bucketLabel(b)} ${f1(agg[b].fields / N)}`).join(', ') + `); ${f1(mean(mapRows.map((m) => m.far)))} fields at distance 5+ ` +
    `(at least ${Math.min(...mapRows.map((m) => m.far))} on every map; ${f0(farOk)}% of maps have 6 or more); ${f2(attemptsMean)} attempts per map (at most ${Math.max(...mapRows.map((m) => m.attempts))}).`);
  const T_ROWS = [];
  check(T_ROWS, 'T-E3', 'fields per map', fieldsPerMap, 40, 40, 1);
  check(T_ROWS, 'T-E3', '% of maps with 6 or more fields at distance 5+', farOk, 99, null, 0);
  check(T_ROWS, 'T-E3', 'attempts per map (mean)', attemptsMean, null, 2, 2);
  let searchesPerCell = NaN;
  let searchesAtBonus = {};
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
    searchesAtBonus = { 0: meanKs[0], 12: meanKs[1], 32: meanKs[4] }; // +0 / +12 (skill 10) / +32% (S ring + skill 10)
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

  // ---- 3c. what sight is worth: the same trips with the Ore sight base forced to 0 / 20 / 40 / 60 / 100
  // One trip from 8:00 (as in 3a) to the same field with the bot's search choice (centerOptions weighs the items it sees),
  // carrying the most valuable items. Value per item: mythril 10, any gem 4, coal 3, iron 2, copper 0.5.
  const SIGHTS = [0, 20, 40, 60, 100];
  const SIGHT_BUCKETS = [2, 4, 5, 6];
  const itemValue = (t) => (t.startsWith('gem:') ? 4 : { 'ore:mythril': 10, 'ore:coal': 3, 'ore:iron': 2, 'ore:copper': 0.5 }[t] ?? 0);
  const sightRes = Object.fromEntries(SIGHT_BUCKETS.map((b) => [b, Object.fromEntries(SIGHTS.map((sg) => [sg, { n: 0, value: 0, min: 0, items: 0 }]))]));
  for (const sg of SIGHTS) {
    withSets([['intel.tracks.oreSight.base', sg]], () => {
      states.forEach((st0, si) => {
        const rng = seededRng(mixSeed(79, si)); // the same field for every sight value
        for (const b of SIGHT_BUCKETS) {
          const fs = fieldsAt(st0, b);
          if (!fs.length) continue;
          const c = rng.pick(fs);
          const st = deepClone(st0);
          const res = runTrip(st, c, { vf: itemValue, wasDebris: new WeakSet(), log: () => {}, minRate: 0.002, allowMove: false });
          const r = sightRes[b][sg];
          r.n++;
          r.value += sum(res.carried.map(itemValue));
          r.min += st.time - DAY_START;
          r.items += res.carried.length;
        }
      });
    });
  }
  const perHour = (cells) => (60 * sum(cells.map((r) => r.value))) / Math.max(EPS, sum(cells.map((r) => r.min)));
  const pooled = (sg, bs) => perHour(bs.map((b) => sightRes[b][sg]));
  h2('3c. What sight is worth: value carried per trip-hour (one trip from 8:00; sight forced via Ore sight base)');
  printTable(
    ['dist', ...SIGHTS.map((sg) => `sight ${sg}`), ...SIGHTS.slice(1).map((sg) => `+% at ${sg}`), 'trip min at 0 / 100', 'items carried at 0 / 100'],
    [...SIGHT_BUCKETS.map((b) => [bucketLabel(b), ...SIGHTS.map((sg) => f1(perHour([sightRes[b][sg]]))), ...SIGHTS.slice(1).map((sg) => signed(100 * (perHour([sightRes[b][sg]]) / perHour([sightRes[b][0]]) - 1), 1)),
      `${f0(sightRes[b][0].min / Math.max(1, sightRes[b][0].n))} / ${f0(sightRes[b][100].min / Math.max(1, sightRes[b][100].n))}`, `${f1(sightRes[b][0].items / Math.max(1, sightRes[b][0].n))} / ${f1(sightRes[b][100].items / Math.max(1, sightRes[b][100].n))}`]),
    ['5-6 together', ...SIGHTS.map((sg) => f1(pooled(sg, [5, 6]))), ...SIGHTS.slice(1).map((sg) => signed(100 * (pooled(sg, [5, 6]) / pooled(0, [5, 6]) - 1), 1)), '', '']],
  );
  note('Value per item: mythril 10, any gem 4, coal 3, iron 2, copper 0.5 (the trip carries the most valuable items and searches where the visible and expected value per minute is best). Targets (T-E5, distance 5-6): sight 60 vs 0 +15-30%, sight 20 vs 0 +3-8%.');
  const sightGain = (sg) => 100 * (pooled(sg, [5, 6]) / pooled(0, [5, 6]) - 1);
  check(T_ROWS, 'T-E5', 'value per trip-hour at distance 5-6, sight 60 vs 0 (%)', sightGain(60), 15, 30);
  check(T_ROWS, 'T-E5', 'value per trip-hour at distance 5-6, sight 20 vs 0 (%)', sightGain(20), 3, 8);

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

  check(T_ROWS, 'T-E1', 'searches per clear cell at +0% efficiency', searchesPerCell, 3.9, 4.1, 2);
  check(T_ROWS, 'T-E2', 'field minutes per copper', bestMin['ore:copper'].min, 23, 31);
  check(T_ROWS, 'T-E2', 'field minutes per iron', bestMin['ore:iron'].min, 53, 71);
  check(T_ROWS, 'T-E4', 'mythril per map', (totals['ore:mythril'] || 0) / N, 22, 32);
  printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-E1..T-E5)');

  console.log(`\nECONOMY SUMMARY | items/search by dist ${BUCKETS.filter((b) => ex[b].n).map((b) => `d${bucketLabel(b)}:${f2(ex[b].i / ex[b].s)}`).join(' ')}` +
    ` | debris % of effort ${BUCKETS.filter((b) => ex[b].n).map((b) => `d${bucketLabel(b)}:${f0(debrisShare(b))}`).join(' ')}` +
    ` | one trip d1/d3: ${f0(trip[1].min / trip[1].n)}/${trip[3].n ? f0(trip[3].min / trip[3].n) : '-'} min for ${f1(trip[1].items / trip[1].n)}/${trip[3].n ? f1(trip[3].items / trip[3].n) : '-'} items` +
    ` (found ${f1(trip[1].found / trip[1].n)}/${trip[3].n ? f1(trip[3].found / trip[3].n) : '-'}, pile left ${f1(trip[1].pile / trip[1].n)}/${trip[3].n ? f1(trip[3].pile / trip[3].n) : '-'})` +
    ` | field min per unit: ${['ore:copper', 'ore:iron', 'steel pair', 'ore:mythril', 'any gem'].map((r) => `${r.replace('ore:', '')} ${f0(bestMin[r].min)}`).join(', ')}` +
    ` | full set >=D work days: ${BARS.map((b) => `${b} ${f1(setDays[b])}`).join(', ')}` +
    ` | gem cut skill 0: F ${f0(gemCut.novice.F)}% C+ ${f0(gemCut.novice.S + gemCut.novice.A + gemCut.novice.B + gemCut.novice.C)}% effect ${f2(gemCut.eff0)} of C` +
    ` | map items/run ${f0(sum(Object.values(totals)) / N)} (mythril ${f1((totals['ore:mythril'] || 0) / N)}, coal ${f0((totals['ore:coal'] || 0) / N)})` +
    ` | searches per clear cell +0/+12/+32%: ${f2(searchesAtBonus[0])}/${f2(searchesAtBonus[12])}/${f2(searchesAtBonus[32])}` +
    ` | map ${f1(fieldsPerMap)} fields, ${f0(farOk)}% of maps with 6+ at d5+, ${f2(attemptsMean)} attempts` +
    ` | sight value/trip-hour d5-6 s20/s60 vs 0: ${signed(sightGain(20))}%/${signed(sightGain(60))}%` +
    ` | ${targetFlags(T_ROWS)}`);
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
// T-MID: the plain sets whose "last day with >= 70% vs a typical elite" the plan pins to 1.2's value (measured by this tool on 1.2's
// numbers: ref12), within +-ANCHOR_WINDOW days.
const ANCHORS = [
  { set: ['copper', 'B'], ref12: 8 }, { set: ['iron', 'C'], ref12: 15 }, { set: ['steel', 'C'], ref12: 23 },
  { set: ['mythril', 'C'], ref12: 41 }, { set: ['mythril', 'S'], ref12: 59 },
];
const ANCHOR_WINDOW = 3;
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

  // ---- 3b. the daily grid: the last day each plain set still wins 70% against a typical elite (T-MID)
  const AM = o.quick ? 40 : 120; // enemies per day (a typical elite = a random roll of the tier's attribute levels, everything hidden)
  const AF = o.quick ? 20 : 60; // fights per enemy
  const THR = 70;
  const anchorDay = ([mat, grade]) => {
    const adv = adventurerCombatant(setOf(mat, grade), {}, cfg);
    const meanWin = (d) => {
      const rng = seededRng(mixSeed(42, d));
      let w = 0;
      for (let i = 0; i < AM; i++) {
        const en = enemyCombatant('elite', d, rollLevels(rng, 'elite', cfg), 'Enemy', cfg);
        const fr = seededRng(mixSeed(3, d, i));
        for (let f = 0; f < AF; f++) {
          const r = fight(adv, en, fr.next, false, cfg);
          if (r.win || r.draw) w++;
        }
      }
      return (100 * w) / (AM * AF);
    };
    let last = NaN;
    let at = null;
    for (let d = 2; d <= 150; d++) {
      const w = meanWin(d);
      if (w >= THR) [last, at] = [d, w];
      else if (d > 5 && w < THR - 25) break; // far below the line: later days cannot come back
    }
    return { last, at };
  };
  const T_ROWS = [];
  h2(`3b. Anchors: the last day a plain full set still wins >= ${THR}% against a typical elite (${AM} enemies x ${AF} fights per day, all attributes hidden)`);
  const anchors = ANCHORS.map((a) => ({ ...a, ...anchorDay(a.set) }));
  printTable(['set', 'last day >= 70%', 'win % that day', '1.2 (same tool)', 'allowed window'],
    anchors.map((a) => [`${a.set[0]} ${a.set[1]}`, a.last, f1(a.at), a.ref12, `${a.ref12 - ANCHOR_WINDOW}-${a.ref12 + ANCHOR_WINDOW}`]));
  note(`T-MID: within +-${ANCHOR_WINDOW} days of the same measurement on 1.2's numbers (copper B 8, iron C 15, steel C 23, mythril C 41, mythril S 59). The lever is enemies.growthPerDay.hpDamage.`);
  for (const a of anchors) check(T_ROWS, 'T-MID', `${a.set[0]} ${a.set[1]}: last day >= ${THR}% vs a typical elite`, a.last, a.ref12 - ANCHOR_WINDOW, a.ref12 + ANCHOR_WINDOW, 0);
  printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-MID)');

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
    ` | ceiling vs normal d60/d80 ${f0(arch.normal[ARCH.length - 1][days.indexOf(60)])}/${f0(arch.normal[ARCH.length - 1][days.indexOf(80)])}%` +
    ` | anchors (last day >=70% vs elite) ${anchors.map((a) => `${a.set[0]} ${a.set[1]} d${a.last}`).join(', ')} | ${targetFlags(T_ROWS)}`);
  return VT;
}


// =============================================================== SPECIALS ====
// R33 / T-R33 (docs/PLAN-2.0.md sections 4.7 and 9): are the gems worth crafting for, and is the right gem worth bringing?
// Iron, steel and mythril C sets against an elite on the day that set wins about 55% against an all-Normal elite (a window of
// 5 days around it), one enemy attribute changed at a time (everything else Normal):
//   M1  what the enemy special costs: Normal -> High, in win points
//   M2  the matching armor gem (chest + helmet, C) minus emerald armor on the same two pieces, against a High special
//   M3  the same against a Low special (emerald armor must win there: bring the right gem to each fight)
//   M4  the share of the High special's cost won back by three matching armor pieces (chest, helmet, gloves) + one B ring
//   M5  how much of a sword gem's gain survives a High resistance of the enemy (gain at High / gain at Low), C and S
//   M6  the five sword gems are about equally strong (each within a few points of their mean), C and S
//   M7  emerald armor (chest + helmet, C) gains no more than the smallest M2
//   S   an S sword gem gains no more than the matching enemy special swings between Low and High
// Judged like the reference script (scratchpad/v2/cm/gems.mjs) and spec-combat 6.1: each value is the MEAN OF THE THREE SETS (iron,
// steel, mythril) for one special (M6: for one sword gem; M7: once), not each material on its own. The per-material tables stay as
// information (a 12-cell reading would be stricter than the plan: T-R33 says "each special", not "each special on each material").
const SPECIALS = [
  { name: 'Magic', off: 'magical', res: 'magicRes', gem: 'ruby', resRing: 'magicRes' },
  { name: 'Piercing', off: 'piercing', res: 'pierceRes', gem: 'diamond', resRing: 'pierceRes' },
  { name: 'Stun', off: 'stunning', res: 'stunRes', gem: 'topaz', resRing: 'stunRes' },
  { name: 'Slow', off: 'chilling', res: 'slowRes', gem: 'sapphire', resRing: 'slowRes' },
];
const R33 = {
  M1: [8, 20], M2: [4, null], M3: [null, -2], M4: [80, null], M5C: [null, 50], M5S: [null, 60], M6C: 3, M6S: 4,
};

// A metric row for the targets table: the range of the measured values and how many fall outside [lo, hi].
function metricRow(rows, id, what, values, lo, hi, digits = 1) {
  const bad = values.filter((v) => judge(v, lo, hi) !== 'ok');
  const target = lo != null && hi != null ? `${lo} to ${hi}` : lo != null ? `>= ${lo}` : `<= ${hi}`;
  const a = fx(Math.min(...values), digits);
  const b = fx(Math.max(...values), digits);
  rows.push([id, what, a === b ? a : `${a} to ${b}`, target, bad.length ? `MISS ${bad.length}/${values.length}` : 'ok']);
}

function specialsSection(o) {
  const n = o.quick ? 300 : 1500; // fights per cell (an enemy variant on one day)
  const WINDOW = 2; // reference day +- 2
  const tier = 'elite';
  const mats = ['iron', 'steel', 'mythril'];
  const lv = (over = {}) => Object.fromEntries(Object.keys(cfg.enemies.attributes).map((k) => [k, over[k] || 'normal']));
  const foe = (day, over) => enemyCombatant(tier, day, lv(over), 'Enemy', cfg);
  const winRate = (adv, en, count, seed) => {
    const rng = seededRng(seed);
    let w = 0;
    for (let i = 0; i < count; i++) {
      const r = fight(adv, en, rng.next, false, cfg);
      if (r.win || r.draw) w++;
    }
    return (100 * w) / count;
  };
  // The day that set wins about 55% against an all-Normal elite.
  const refDayOf = (gear) => {
    const adv = adventurerCombatant(gear, {}, cfg);
    let best = 2;
    let bd = Infinity;
    for (let d = 2; d <= 150; d++) {
      const dist = Math.abs(winRate(adv, foe(d, {}), 500, mixSeed(5, d)) - 55);
      if (dist < bd) [bd, best] = [dist, d];
    }
    return best;
  };
  const gemOn = (base, gem, slots, grade) => base.map((it) => (slots.includes(it.slot) ? { ...it, gem: { type: gem, grade } } : it));
  const ring = (type, grade) => ringTotals([{ type, grade }]);
  const pairOf = ['chest', 'helmet'];
  const trio = ['chest', 'helmet', 'gloves'];

  h1(`SPECIALS (R33) — gems and enemy specials: iron / steel / mythril C sets vs an ${tier} (${n} fights x ${2 * WINDOW + 1} days per cell)`);
  note('Each cell changes ONE enemy attribute (Low / Normal / High) and keeps the rest Normal. The per-material tables are information; the targets judge the mean of the three sets per special. Reference day = the day the plain C set wins about 55% against an all-Normal elite; the cell is the mean over ref-2..ref+2.');
  note('M1 cost Normal->High; M2/M3 matching armor gem minus emerald armor (chest + helmet, grade C) at a High / Low special; M4 recovered by 3 matching pieces + a B resistance ring; M5 sword gem kept at a High resistance (gain at High / gain at Low); M6 gain of a sword gem vs an all-Normal elite; M7 emerald armor; swing = the matching special Low->High.');
  // One entry per material (a "cell" = one special on one material): the targets are judged on the mean of the three sets
  // (docs/PLAN-2.0.md section 4.7, spec-combat 6.1: "the reported number is the mean of the three sets"), not on the cells.
  const perMat = [];
  const refs = [];
  for (const mat of mats) {
    const base = setOf(mat, 'C');
    const ref = refDayOf(base);
    refs.push(`${mat} d${ref}`);
    const cell = { M1: [], M2: [], M3: [], M4: [], M5C: [], M5S: [], S: [], gains: {}, m7: NaN };
    perMat.push(cell);
    const days = [];
    for (let d = ref - WINDOW; d <= ref + WINDOW; d++) if (d >= 2) days.push(d);
    // mean win % over the window; the same random numbers for every gear / enemy variant with the same salt (paired comparisons)
    const W = (gear, rings, over, salt = 1) => mean(days.map((d) => winRate(adventurerCombatant(gear, rings, cfg), foe(d, over), n, mixSeed(777, d, salt))));
    const swordGem = (gem, grade) => gemOn(base, gem, ['sword'], grade);
    const N0 = W(base, {}, {});
    const N0s = W(base, {}, {}, 2);
    h2(`${mat} C full set, reference day ${ref} (days ${days[0]}-${days[days.length - 1]}); all-Normal elite: ${f1(N0)}% win`);
    const rows = [];
    const sGain = {};
    for (const sp of SPECIALS) {
      const H = W(base, {}, { [sp.off]: 'high' });
      const Lo = W(base, {}, { [sp.off]: 'low' });
      const m1 = N0 - H;
      const high = { [sp.off]: 'high' };
      const low = { [sp.off]: 'low' };
      const m2 = W(gemOn(base, sp.gem, pairOf, 'C'), {}, high) - W(gemOn(base, 'emerald', pairOf, 'C'), {}, high);
      const m3 = W(gemOn(base, sp.gem, pairOf, 'C'), {}, low) - W(gemOn(base, 'emerald', pairOf, 'C'), {}, low);
      const def = W(gemOn(base, sp.gem, trio, 'C'), ring(sp.resRing, 'B'), high);
      const m4 = (100 * (def - H)) / Math.max(0.5, N0 - H);
      const keep = {};
      const gain = {};
      for (const g of ['C', 'S']) {
        const gl = W(swordGem(sp.gem, g), {}, { [sp.res]: 'low' }, 2) - W(base, {}, { [sp.res]: 'low' }, 2);
        const gh = W(swordGem(sp.gem, g), {}, { [sp.res]: 'high' }, 2) - W(base, {}, { [sp.res]: 'high' }, 2);
        keep[g] = (100 * gh) / Math.max(0.5, gl);
        gain[g] = W(swordGem(sp.gem, g), {}, {}, 2) - N0s;
      }
      sGain[sp.gem] = gain;
      const swing = Lo - H;
      cell.M1.push(m1);
      cell.M2.push(m2);
      cell.M3.push(m3);
      cell.M4.push(m4);
      cell.M5C.push(keep.C);
      cell.M5S.push(keep.S);
      cell.S.push(gain.S - swing); // <= 0 is the target
      rows.push([sp.name, sp.gem, f1(m1), (m2 >= 0 ? '+' : '') + f1(m2), (m3 >= 0 ? '+' : '') + f1(m3), `${f0(m4)}%`, `${f0(keep.C)}%`, `${f0(keep.S)}%`, f1(gain.C), f1(gain.S), f1(swing)]);
    }
    printTable(['special', 'gem', 'M1 N->H', 'M2 @High', 'M3 @Low', 'M4 recovered', 'M5 C kept', 'M5 S kept', 'M6 C gain', 'M6 S gain', 'swing L->H'], rows);
    // M6: the five sword gems; emerald has no resistance to keep
    const gains = { ...sGain, emerald: { C: W(swordGem('emerald', 'C'), {}, {}, 2) - N0s, S: W(swordGem('emerald', 'S'), {}, {}, 2) - N0s } };
    cell.gains = gains;
    const m7 = W(gemOn(base, 'emerald', pairOf, 'C'), {}, {}) - N0;
    cell.m7 = m7;
    const minM2 = Math.min(...cell.M2);
    note(`Sword gems vs an all-Normal elite (win points): ${Object.entries(gains).map(([g, x]) => `${g} C ${f1(x.C)} / S ${f1(x.S)}`).join(', ')}. Emerald armor on chest + helmet (M7): ${f1(m7)} (smallest M2 ${f1(minM2)}).`);
  }

  // The targets: one value per special (per sword gem for M6), each the mean over iron / steel / mythril.
  const overMats = (pick) => mean(perMat.map(pick));
  const bySpecial = (key) => SPECIALS.map((_, i) => overMats((c) => c[key][i]));
  const m = {
    M1: bySpecial('M1'), M2: bySpecial('M2'), M3: bySpecial('M3'), M4: bySpecial('M4'), M5C: bySpecial('M5C'), M5S: bySpecial('M5S'), S: bySpecial('S'), refs,
  };
  const gemNames = Object.keys(perMat[0].gains);
  for (const g of ['C', 'S']) {
    const gain = gemNames.map((gem) => overMats((c) => c.gains[gem][g])); // each gem's gain, mean of the three sets
    const mu = mean(gain);
    m[`M6${g}`] = gain.map((v) => Math.abs(v - mu));
  }
  const meanM7 = overMats((c) => c.m7);
  const minM2 = Math.min(...m.M2);
  m.M7 = [meanM7 - minM2]; // <= 0 is the target
  h2('Mean of the three sets (iron / steel / mythril), per special: the numbers the targets judge');
  printTable(['special', 'gem', 'M1 N->H', 'M2 @High', 'M3 @Low', 'M4 recovered', 'M5 C kept', 'M5 S kept', 'S gain - swing'],
    SPECIALS.map((sp, i) => [sp.name, sp.gem, f1(m.M1[i]), (m.M2[i] >= 0 ? '+' : '') + f1(m.M2[i]), (m.M3[i] >= 0 ? '+' : '') + f1(m.M3[i]), `${f0(m.M4[i])}%`, `${f0(m.M5C[i])}%`, `${f0(m.M5S[i])}%`, signed(m.S[i], 1)]));
  note(`Sword gem gain vs an all-Normal elite, mean of the three sets (C / S): ${gemNames.map((g) => `${g} ${f1(overMats((c) => c.gains[g].C))} / ${f1(overMats((c) => c.gains[g].S))}`).join(', ')}; ` +
    `distance from the mean of the five: C ${m.M6C.map((v) => f1(v)).join(' ')} | S ${m.M6S.map((v) => f1(v)).join(' ')}. Emerald armor (chest + helmet, C): ${f1(meanM7)} against the smallest M2 ${f1(minM2)}.`);

  const T_ROWS = [];
  metricRow(T_ROWS, 'T-R33', 'M1 N->H cost (points)', m.M1, ...R33.M1);
  metricRow(T_ROWS, 'T-R33', 'M2 matching - emerald armor at High', m.M2, ...R33.M2);
  metricRow(T_ROWS, 'T-R33', 'M3 the same at Low', m.M3, ...R33.M3);
  metricRow(T_ROWS, 'T-R33', 'M4 recovered by 3 pieces + B ring (%)', m.M4, ...R33.M4, 0);
  metricRow(T_ROWS, 'T-R33', 'M5 sword gem C kept at High resistance (%)', m.M5C, ...R33.M5C, 0);
  metricRow(T_ROWS, 'T-R33', 'M5 sword gem S kept at High resistance (%)', m.M5S, ...R33.M5S, 0);
  metricRow(T_ROWS, 'T-R33', 'M6 sword gem C: distance from the mean of the five', m.M6C, null, R33.M6C);
  metricRow(T_ROWS, 'T-R33', 'M6 sword gem S: distance from the mean of the five', m.M6S, null, R33.M6S);
  metricRow(T_ROWS, 'T-R33', 'M7 emerald armor gain - smallest M2', m.M7, null, 0);
  metricRow(T_ROWS, 'T-R33', 'S sword gem gain - matching Low->High swing', m.S, null, 0);
  printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-R33; each value is the mean of iron / steel / mythril: 4 specials, 5 sword gems for M6, 1 for M7)');
  const span = (v, d = 0) => (fx(Math.min(...v), d) === fx(Math.max(...v), d) ? fx(v[0], d) : `${fx(Math.min(...v), d)}..${fx(Math.max(...v), d)}`);
  console.log(`\nSPECIALS | ref ${m.refs.join(' ')} | M1 ${span(m.M1)} (8-20) | M2 ${span(m.M2, 1)} (>=4) | M3 ${span(m.M3, 1)} (<=-2) | M4 ${span(m.M4)}% (>=80) | M5 C ${span(m.M5C)}% S ${span(m.M5S)}% (<=50/60)` +
    ` | M6 C max ${fx(Math.max(...m.M6C), 1)} S max ${fx(Math.max(...m.M6S), 1)} (<=3/4) | M7 ${span(m.M7, 1)} (<=0) | S-swing ${span(m.S, 1)} (<=0) | ${targetFlags(T_ROWS)}`);
}

// ============================================================ ESTIMATOR =====
// A2 / T-A2: how good is the in-game automatic win estimate at a given size (guesses x test fights), and what does it cost?
// A plain steel C set against random elites on three days chosen so the average true win chance is about 55 / 75 / 90%.
// For each enemy: its TRUE win chance (4000 fights against its real attributes) and the estimate made when only the
// attributes that enemy scouting shows are visible (the starting 10% scouting, times the elite multiplier like the game does).
// Every estimate is made 3 times with different random draws.
//   shown +-   = the margin the game shows next to the estimate (shownMargin: twice the spread of the guesses, never less than the
//                Wilson floor of all the test fights), mean over the estimates
//   miss (rms) = root mean square of (estimate - true chance): the typical miss, which includes the guesswork about hidden attributes
//   wobble     = how much the same estimate moves between presses (sampling noise; shrinks with size)
//   inside +-  = the share of estimates whose true chance lies within the shown margin
// Sizes: 5x5 = the start, 6x6 / 8x8 = Battle simulation points or a Foresight ring, 10x10 = the most the game reaches (+3 intel, +2 ring).
function estimatorSection(o) {
  const M = o.quick ? 40 : 200; // enemies per target
  const tier = 'elite';
  const gear = setOf('steel', 'C');
  const base = cfg.sim.samples;
  const sizes = [[base, base], [base + 1, base + 1], [base + 3, base + 3], [base + 5, base + 5]]; // 5x5 6x6 8x8 10x10 (+1 per Battle simulation point and Foresight step)
  const scouting = cfg.intel.tracks.enemySight.base;
  const sightPct = (scouting * (((cfg.intel.tracks.enemySight.tierMult || {})[tier]) ?? 100)) / 100;
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
  const optsOf = ([S, E]) => ({ samples: S, evalFights: E, fightsPerLoadout: E });
  h1(`ESTIMATOR — how good is the automatic win estimate? (steel C set vs random ${tier}s; ${M} enemies per target, 3 estimates each, ${scouting}% enemy scouting = ${f1(sightPct)}% per attribute for ${tier}s)`);
  note(`Sizes are guesses x test fights: ${sizes.map(([S, E]) => `${S}x${E}`).join(', ')} (the game starts at ${base}x${base}; each Battle simulation point and each Foresight ring step adds 1, at most +${cfg.intel.tracks.simDepth.max} and +2). The gear search uses as many fights per gear combination as test fights.`);
  const acc = Object.fromEntries(sizes.map(([S, E]) => [`${S}x${E}`, { margin: [], miss2: [], wobble2: [], inside: [] }]));
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
      const a = acc[`${S}x${E}`];
      const margins = [];
      const miss2 = [];
      const wob2 = [];
      let inside = 0;
      let total = 0;
      enemies.forEach((e, i) => {
        const known = {};
        for (const k of Object.keys(e.levels)) if (e.sightRoll[k] < sightPct) known[k] = e.levels[k];
        const ests = [0, 1, 2].map((r) => estimateWinChanceSync({ gearItems: gear, ringTotals: {}, tier, day, known, seed: 1000 * i + r + 1 }, optsOf([S, E]), cfg));
        const pcts = ests.map((x) => x.winPct);
        const mu = mean(pcts);
        wob2.push(sum(pcts.map((x) => (x - mu) ** 2)) / 2);
        for (const x of ests) {
          const mg = shownMargin(x);
          margins.push(mg);
          miss2.push((x.winPct - e.truth) ** 2);
          total++;
          if (Math.abs(x.winPct - e.truth) <= mg) inside++;
        }
      });
      a.margin.push(...margins);
      a.miss2.push(...miss2);
      a.wobble2.push(...wob2);
      a.inside.push(inside / total);
      return [`${S}x${E}`, f1(mean(margins)), f1(Math.sqrt(mean(miss2))), f1(Math.sqrt(mean(wob2))), `${f0((100 * inside) / total)}%`];
    });
    printTable(['size', 'shown +-', 'miss (rms)', 'wobble', 'truth inside +-'], rows);
  }
  const keyOf = ([S, E]) => `${S}x${E}`;
  h2('All three targets together');
  printTable(['size', 'shown +- (mean)', 'miss (rms)', 'wobble', 'truth inside +-', 'margin when every test fight is won'],
    sizes.map(([S, E]) => {
      const a = acc[keyOf([S, E])];
      return [keyOf([S, E]), f1(mean(a.margin)), f1(Math.sqrt(mean(a.miss2))), f1(Math.sqrt(mean(a.wobble2))), `${f0(100 * mean(a.inside))}%`, shownMargin({ wins: S * E, fights: S * E, se: 0 })];
    }));
  note('The last column is the margin floor: a spread of 0 does not mean certainty, so all test fights won still shows a margin (25 of 25 -> 14, from the Wilson bound).');

  // ---- cost: simulated fights and milliseconds per roster of 7 enemies, with 2 and 3 items per gear type
  const rosterRng = seededRng(mixSeed(77, 1));
  const roster = generateRoster(rosterRng, 20, cfg).enemies;
  // trade-off items per gear type, none better than another in every stat (so the gear search keeps all of them)
  const variants = [() => ({ material: 'iron', grade: 'C', gem: null }), () => ({ material: 'copper', grade: 'C', gem: { type: 'ruby', grade: 'C' } }), () => ({ material: 'copper', grade: 'D', gem: { type: 'diamond', grade: 'C' } })];
  const gearOf = (counts) => SLOTS.flatMap((slot, si) => variants.slice(0, counts[si]).map((v) => ({ id: nextItemId++, slot, durability: 100, packed: false, ...v() })));
  // 2 per type = the pack limit; 3 per type = every pack mule; the third row is the dearest case: the largest number of combinations
  // that is still tried one by one (maxExactCombos), here a pack mule for the sword and 2 of every other type
  const gearCases = [['2 per type', [2, 2, 2, 2, 2]], ['3 per type', [3, 3, 3, 3, 3]], ['3 swords + 2 per type', [3, 2, 2, 2, 2]]];
  const costRows = [];
  const cost = {};
  for (const [gname, counts] of gearCases) {
    const items = gearOf(counts);
    const kept = pruneDominated(items, cfg).length;
    const combos = counts.reduce((a, b) => a * b, 1);
    for (const [label, size] of [['base', sizes[0]], ['max', sizes[sizes.length - 1]]]) {
      let fights = 0;
      let evaluated = 0;
      const t = process.hrtime.bigint();
      roster.forEach((e, i) => {
        const res = estimateWinChanceSync({ gearItems: items, ringTotals: {}, tier: e.tier, day: e.day, known: {}, seed: i + 1 }, optsOf(size), cfg);
        fights += res.evaluated * size[1] + size[0] * size[1];
        evaluated += res.evaluated;
      });
      const ms = Number(process.hrtime.bigint() - t) / 1e6;
      cost[`${gname}/${label}`] = { fights, ms };
      costRows.push([`${gname} (${combos} combinations${kept < items.length ? `, ${items.length - kept} items pruned!` : ''})`, `${label} ${keyOf(size)}`, f0(evaluated), f0(fights), f0(ms)]);
    }
  }
  h2(`Cost of one roster (${roster.length} enemies, nothing scouted): gear combinations tried, simulated fights, milliseconds`);
  printTable(['gear', 'size', 'gear combinations tried', 'fights per roster', 'ms per roster'], costRows);
  note(`Up to sim.maxExactCombos (${cfg.sim.maxExactCombos}) combinations every one is tried per guess; above it the gear is picked one type at a time (at most sim.searchPasses x items + 1 = ${cfg.sim.searchPasses * 15 + 1} tries for 15 items), which is why 3 per type costs less than 2 per type. ms depends on the machine.`);

  const T_ROWS = [];
  const maxFights = (label) => Math.max(...gearCases.map(([g]) => cost[`${g}/${label}`].fights));
  check(T_ROWS, 'T-A2', 'fights per roster at the base size (dearest gear case)', maxFights('base'), null, 10000, 0);
  check(T_ROWS, 'T-A2', 'fights per roster at the max size (10x10, dearest gear case)', maxFights('max'), null, 60000, 0);
  check(T_ROWS, 'T-A2', 'shown margin at the base size (+-)', mean(acc[keyOf(sizes[0])].margin), 15, 25);
  const marg = sizes.map((sz) => mean(acc[keyOf(sz)].margin));
  check(T_ROWS, 'T-A2', 'margin shrinks with every step: smallest drop between sizes', Math.min(...marg.slice(1).map((v, i) => marg[i] - v)), 0.01, null, 2);
  printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-A2)');
  console.log(`\nESTIMATOR SUMMARY (mean over the 55/75/90 targets, ${scouting}% scouting) | ${sizes.map((sz) => `${keyOf(sz)}: +-${f1(mean(acc[keyOf(sz)].margin))} miss ${f1(Math.sqrt(mean(acc[keyOf(sz)].miss2)))} wobble ${f1(Math.sqrt(mean(acc[keyOf(sz)].wobble2)))}`).join(' | ')}` +
    ` | fights/roster base ${f0(maxFights('base'))} max ${f0(maxFights('max'))} (dearest gear case; 2 per type ${f0(cost['2 per type/base'].fights)}/${f0(cost['2 per type/max'].fights)}, 3 per type ${f0(cost['3 per type/base'].fights)}/${f0(cost['3 per type/max'].fights)}) | ${targetFlags(T_ROWS)}`);
}

// ================================================================== BOT =====
// A scripted player (a persona, default careful). It only sees what a player sees (visible enemy attributes, the items its sight
// shows, expected field loot) and uses the same API as the UI. Heuristics, not an optimiser.
const MAT_RANK = { none: 0, copper: 1, iron: 2, steel: 3, mythril: 4 };
// Grade a bar of this material must reach to still be worth gathering for an upgrade.
// The best material keeps being worth chasing up to A grade; older materials up to B.
const WORTH_GRADE = { copper: 'B', iron: 'B', steel: 'B', mythril: 'A' };

// The intel spending list of a persona, with an --intel only:<track> mode in front: that track first until it cannot
// gain any more, then the persona's own list. 'roundRobin' is the list ['*'].
function intelList(persona, mode = 'persona') {
  const base = persona.intel === 'roundRobin' ? [['*']] : persona.intel;
  return typeof mode === 'string' && mode.startsWith('only:') ? [[mode.slice(5), Infinity], ...base] : base;
}

// The bot's own (first-stage) estimate sizes; they do not depend on the persona or the value tables.
const botSimOpts = (o) => (o.quick ? { samples: 8, fightsPerLoadout: 1, evalFights: 15 } : { samples: 24, fightsPerLoadout: 1, evalFights: 25 });

// The bot's settings: the value tables (T) turned into weights, plus the persona (PERSONAS[o.persona], default
// careful) and the command line. --minwin, --future and --carry override the persona's own values.
function botParams(T, o) {
  const persona = PERSONAS[o.persona || 'careful'];
  // win % per unit of slot power (upgrade steel C 2.2 -> mythril C 3.3)
  const dp = power('mythril', 'C') - power('steel', 'C');
  const slotW = {};
  for (const s of SLOTS) slotW[s] = Math.max(1, T.slots[s].up) / dp;
  slotW.sword *= persona.swordBias; // a persona that cares about its sword weighs the sword slot more when it chooses what to smith
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
    persona: o.persona || 'careful', personaName: persona.name, pick: persona.pick, champMin: persona.champMin, eliteMin: persona.eliteMin,
    gearLevelForElites: persona.gearLevelForElites, pack: persona.pack, rings: persona.rings, trips: persona.trips, swordBias: persona.swordBias,
    minWin: o.minwin ?? persona.minWin, future: o.future ?? persona.future, immortal: !!o.immortal, carry: o.carry ?? persona.carry, estimator: o.estimator ?? 'bot',
    simOpts: botSimOpts(o),
    verifyOpts: o.quick ? { samples: 10, fightsPerLoadout: 4, evalFights: 15 } : { samples: 30, fightsPerLoadout: 6, evalFights: 30 },
    verifyTop: 3,
    // Intel: spend each point on the first entry whose track is below its target value and can still gain; '*' = the
    // track with the fewest points that can still gain (config order on ties). Every point is spent (confirmPlan refuses
    // while one can be). The persona's list (docs/PLAN-2.0.md 8.3), with --intel only:<track> in front.
    intel: intelList(persona, o.intel),
    // Fight choice: EV = p/100 x (score + future + ringValue + bannerBonus). ringPoints = score points per unit of
    // (win % per ring value) x ring value; bannerBonus = points when the enemy's banner is seen and is the most-beaten one.
    ringPoints: 1, bannerBonus: 10,
    minRate: persona.minRate, minCraftGain: 1.0, minGemGain: 1.0, cutCap: 3, ironReserve: 4, reserveCap: 240,
    // Repairs happen by day, at camp, on gear that stayed home (they cost time). Rest rule: before packing, an item
    // below restBelow % that the stock can repair tomorrow, or one a champion fight could destroy, stays home when its
    // slot has another item to pack. At camp the bot repairs the top-3 unpacked items of a slot once they are below
    // repairBelow % (exact-grade bars), or below subBelow % when only a higher grade is in stock (a substitute uses
    // up better bars for no benefit). A persona that packs the game's default pack has no rest rule: the default pack
    // itself leaves out an item that could break.
    usableDur: 15, restBelow: persona.restBelow, repairBelow: persona.repairBelow, subBelow: persona.subBelow,
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
  rec.repairGems += sum(Object.values(plan.gems));
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
  for (const slot of SLOTS) {
    const items = st.gear.filter((g) => g.slot === slot).sort((a, b) => score(b, P) - score(a, P));
    for (const it of items) {
      const wants = (it.durability < P.restBelow && repairPlan(st, it).ok) || couldBreak(it, st, 'champion', cfg);
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

// The casual player's rings: the best grades first, any type (ties: the larger ring value, then the older ring).
function gradeRings(rings, max) {
  return [...rings].sort((a, b) => GRADES.indexOf(b.grade) - GRADES.indexOf(a.grade) || ringValue(b) - ringValue(a) || a.id - b.id).slice(0, max);
}

function wearSmithRings(st, P) {
  if (P.ablate.has('rings')) return;
  const mine = st.rings.filter((r) => ringDef(r.type).owner === 'smith');
  const want = new Set((P.rings === 'grade' ? gradeRings(mine, cfg.rings.maxWorn) : pickRings(mine, P.smithW, cfg.rings.maxWorn)).map((r) => r.id));
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
  for (; trips < ctx.P.trips; trips++) {
    const vf = makeValueFn(st, ctx.P);
    const target = chooseField(st, ctx, vf, st.map.camp);
    if (!target) break;
    const res = runTrip(st, target.loc, {
      vf, wasDebris: ctx.wasDebris, log: (c, m) => (ctx.tm[c] += m), logLoad: (m) => (ctx.tm.load += m), minRate: ctx.P.minRate, allowMove: true, carry: ctx.P.carry,
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

// Spends EVERY intel point (the plan gate refuses the next day while a point can still be spent), following P.intel.
function spendIntelPoints(st, P) {
  if (P.ablate.has('intel')) return; // no track can gain: nothing to spend
  const tracks = Object.keys(cfg.intel.tracks);
  const canGain = (t) => nextIntelGain(st, t) > 0;
  const list = P.intel === 'roundRobin' ? [['*']] : P.intel;
  for (let guard = 0; guard < 200 && canSpendIntel(st); guard++) {
    let track = null;
    for (const [t, target] of list) {
      if (t === '*') {
        track = tracks.filter(canGain).sort((a, b) => (st.intel.spent[a] || 0) - (st.intel.spent[b] || 0) || tracks.indexOf(a) - tracks.indexOf(b))[0] || null;
        break;
      }
      if (canGain(t) && intelValue(st, t) < target) {
        track = t;
        break;
      }
    }
    if (!track) track = tracks.find(canGain); // the list ran out (no '*' entry): never leave a point
    if (!track || !spendIntel(st, track).ok) break;
  }
}

// The reward ring as the bot values it, in score points: the ring's value x its weight (win % per unit for adventurer
// rings, smithW for smith rings) x ringPoints. A hidden type or grade counts as its expectation (the grade through the
// odds given that it is hidden).
function ringValueOf(st, e, P) {
  if (!e.ring) return 0;
  const types = ringTypeVisible(st, e) ? [e.ring.type] : Object.keys(cfg.rings.types);
  const grades = ringGradeVisible(st, e) ? { [e.ring.grade]: 100 } : hiddenGradeOdds(st, e);
  let total = 0;
  for (const t of types) {
    const def = cfg.rings.types[t];
    const w = def.owner === 'adventurer' ? P.ringW[t] || 0 : P.smithW[t] || 0;
    for (const [g, pct] of Object.entries(grades)) total += w * def.values[GRADES.indexOf(g)] * (pct / 100);
  }
  return (total / types.length) * P.ringPoints;
}

// What winning against this enemy is worth besides its score: the reward ring, and the banner when it is the one the
// adventurer has beaten most (it earns the next pack mule sooner).
function winExtras(st, e, P) {
  const top = groupProgress(st).top;
  const banner = top && groupVisible(st, e) && e.group === top ? P.bannerBonus : 0;
  return ringValueOf(st, e, P) + banner;
}

// How hostile an enemy looks: how many of its attributes the player can see at High.
const visibleHighs = (st, e) => Object.values(knownLevels(st, e)).filter((lv) => lv === 'high').length;

// How well geared the adventurer is, 0-10: the gear types it owns (0-5) plus the gear types it owns in iron or better (0-5).
export function gearLevel(st) {
  const owned = SLOTS.filter((s) => st.gear.some((g) => g.slot === s)).length;
  const iron = SLOTS.filter((s) => st.gear.some((g) => g.slot === s && MAT_RANK[g.material] >= MAT_RANK.iron)).length;
  return owned + iron;
}

// Which enemy a persona fights. Pure: evals = [{ i, tier, p, ev }] in roster order (p = the win estimate in %, ev = the
// expected value; either may be missing when the persona does not use it), st = the game state (only the casual
// persona reads it: its roster, visible attributes and gear). Returns the chosen element of evals (the first one on a tie,
// so the lowest index), or null for an empty list.
//   ev (careful):  among estimates >= minWin the largest ev; none that sure -> the largest p
//   champion:      a champion with p >= champMin -> the highest p; else an elite with p >= eliteMin -> the highest p;
//                  else the largest p/100 x (score + future) among p >= 50 (the plan's formula: the ring and banner extras
//                  in `ev` are not counted here); else the largest p
//   looks (casual): never reads p. Below gearLevelForElites it takes a normal, from there on an elite (a normal when the
//                  roster has no elite), never a champion; of those the enemy with the fewest VISIBLE High attributes,
//                  ties -> the lowest index
export function pickEnemy(P, st, evals) {
  if (!evals.length) return null;
  const best = (list, f) => list.reduce((a, b) => (f(b) > f(a) ? b : a));
  const planValue = (x) => (x.p / 100) * (cfg.enemies.tiers[x.tier].score + P.future);
  const evOf = (x) => (Number.isFinite(x.ev) ? x.ev : planValue(x));
  if (P.pick === 'looks') {
    const level = gearLevel(st);
    const tiers = level < P.gearLevelForElites ? ['normal'] : ['elite'];
    let pool = evals.filter((x) => tiers.includes(x.tier));
    if (!pool.length) pool = evals.filter((x) => x.tier === 'normal');
    if (!pool.length) pool = evals.filter((x) => x.tier !== 'champion');
    if (!pool.length) pool = evals;
    return pool.reduce((a, b) => {
      const ha = visibleHighs(st, st.roster.enemies[a.i]);
      const hb = visibleHighs(st, st.roster.enemies[b.i]);
      return hb < ha || (hb === ha && b.i < a.i) ? b : a;
    });
  }
  if (P.pick === 'champion') {
    const champs = evals.filter((x) => x.tier === 'champion' && x.p >= P.champMin);
    if (champs.length) return best(champs, (x) => x.p);
    const elites = evals.filter((x) => x.tier === 'elite' && x.p >= P.eliteMin);
    if (elites.length) return best(elites, (x) => x.p);
    const fair = evals.filter((x) => x.p >= 50);
    if (fair.length) return best(fair, planValue);
    return best(evals, (x) => x.p);
  }
  const safe = evals.filter((x) => x.p >= P.minWin);
  return safe.length ? best(safe, evOf) : best(evals, (x) => x.p);
}

function choosePlan(st, ctx, rec) {
  const P = ctx.P;
  const rest = P.pack === 'default' ? new Set() : restingIds(st, P);
  let gearIds;
  if (P.pack === 'default') gearIds = defaultPack(st, cfg);
  else {
    gearIds = [];
    for (const slot of SLOTS) {
      const items = st.gear.filter((g) => g.slot === slot).sort((a, b) => score(b, P) - score(a, P));
      // "rested item-days" count only items the pack would otherwise have taken: a worn spare beyond packLimit stays home anyway
      rec.rested += items.slice(0, packLimit(st, slot)).filter((g) => rest.has(g.id)).length;
      // the rest rule: worn items stay home so they can be repaired tomorrow (when the slot keeps another item)
      gearIds.push(...items.filter((g) => !rest.has(g.id)).slice(0, packLimit(st, slot)).map((g) => g.id));
    }
  }
  const advRings = P.ablate.has('rings') ? [] : st.rings.filter((r) => ringDef(r.type).owner === 'adventurer');
  const ringIds = (P.rings === 'grade' ? gradeRings(advRings, cfg.rings.maxWorn) : pickRings(advRings, P.ringW, cfg.rings.maxWorn)).map((r) => r.id);
  const rings = ringTotals(st.rings.filter((r) => ringIds.includes(r.id)));
  const packed = st.gear.filter((g) => gearIds.includes(g.id));
  if (P.immortal) {
    // no estimates: every fight is won; take an elite (the careful bot's usual mid-game pick)
    const i = Math.max(0, st.roster.enemies.findIndex((e) => e.tier === 'elite'));
    const all = Object.fromEntries(TIERS.map((t) => [t, 100]));
    rec.picks.push({ day: st.day + 1, tier: st.roster.enemies[i].tier, p: 100, safe: true, bestP: all, meanP: all });
    return { enemyIndex: i, gearIds, ringIds };
  }
  const reads = P.pick !== 'looks'; // the casual persona never reads an estimate
  // Screen all 7 with the best packed piece per slot (fast, a slight underestimate), then
  // re-estimate the top candidates with all packed gear and fresh seeds (removes the
  // "picked the luckiest estimate" bias) and choose among those.
  const primary = SLOTS.map((s) => packed.filter((g) => g.slot === s).sort((a, b) => score(b, P) - score(a, P))[0]).filter(Boolean);
  const est = (gear, e, i, salt, opts) => estimateWinChanceSync({ gearItems: gear, ringTotals: rings, tier: e.tier, day: e.day, known: knownLevels(st, e), seed: mixSeed(ctx.seed, st.day, i, salt) }, opts).winPct;
  const evOf = (x) => (x.p / 100) * (cfg.enemies.tiers[x.tier].score + P.future + winExtras(st, st.roster.enemies[x.i], P));
  let evals;
  let pool;
  if (!reads) {
    evals = st.roster.enemies.map((e, i) => ({ i, tier: e.tier, p: null, ev: null }));
    pool = evals;
  } else if (P.estimator === 'game') {
    // The in-game automatic estimate: every enemy, all packed gear, the game's own counts
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
    // the careful planner re-checks its three best; a persona that looks at every tier re-checks them all
    const order = P.pick === 'ev' ? [...evals].sort((a, b) => b.ev - a.ev).slice(0, P.verifyTop) : [...evals];
    for (const x of order) {
      x.p = est(packed, st.roster.enemies[x.i], x.i, 2, P.verifyOpts);
      x.ev = evOf(x);
    }
    pool = order;
  }
  const pick = pickEnemy(P, st, pool);
  let bestP = null;
  let meanP = null;
  if (reads) {
    bestP = {};
    meanP = {};
    for (const t of TIERS) {
      bestP[t] = Math.max(...evals.filter((x) => x.tier === t).map((x) => x.p));
      meanP[t] = mean(evals.filter((x) => x.tier === t).map((x) => x.p));
    }
  }
  // "safe" = the pick was one the persona is sure of (the careful planner: p >= minWin; the champion hunter: p >= 50)
  const sureP = P.pick === 'ev' ? P.minWin : P.pick === 'champion' ? 50 : null;
  rec.picks.push({ day: st.day + 1, tier: pick.tier, p: pick.p, safe: sureP == null ? null : pick.p >= sureP, bestP, meanP });
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

// The days on which a run records its skill levels, main bar and answer-gem armor (the Skills at day 30 and Gem supply tables).
const SNAP_DAYS = [10, 20, 25, 30, 40];
// The gems that answer an enemy special when infused into armor (emerald answers no special): GEM_MATCH without emerald.
const ANSWER_GEMS = GEMS.filter((g) => g !== 'emerald');
function daySnapshot(st, rec) {
  // main bar: the bar type the run has smithed the most items from so far
  const made = {};
  for (const c of rec.craftLog) made[c.material] = (made[c.material] || 0) + 1;
  const mainBar = Object.entries(made).sort((a, b) => b[1] - a[1] || BARS.indexOf(b[0]) - BARS.indexOf(a[0]))[0];
  return {
    skills: Object.fromEntries(Object.entries(st.skills).map(([k, v]) => [k, v.level])),
    mainBar: mainBar ? mainBar[0] : null,
    // how many of the 4 answer gems the run owns on a chest or a helmet
    cover: ANSWER_GEMS.filter((g) => st.gear.some((it) => (it.slot === 'chest' || it.slot === 'helmet') && it.gem && it.gem.type === g)).length,
    gems: sum(GEMS.map((g) => st.storage.gem[g] || 0)) + sum(GEMS.flatMap((g) => GRADES.map((gr) => st.storage.cut[`${g}:${gr}`] || 0))),
  };
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
    seed, deathDay: null, lastDay: 1, timeByDay: {}, tripsByDay: {}, snaps: {}, atDay: {}, picks: [], gathered: {}, bars: {},
    crafted: 0, repaired: 0, subRepairs: 0, subBars: 0, subDeferred: 0, repairBars: 0, repairGems: 0, repairPct: 0, rested: 0, gemsUsed: 0, destroyed: 0,
    craftLog: [], tripDist: [], tripItems: [], wornOut: 0, wornOutMat: {}, repairBlocked: {},
    found: 0, foundByDay: {}, mapByDay: {}, mapStart: null,
    searches: 0, carried: 0, fromOldPile: 0, fromDebris: 0, debrisEff: 0, searchEff: 0, pileTrips: 0, cuts: {},
  };
  rec.mapStart = mapStats(st);
  for (;;) {
    const day = st.day;
    ctx.tm = Object.fromEntries(TIME_CATS.map((c) => [c, 0]));
    ctx.tm.load = 0; // the part of the travel minutes that the carried load added (not a time category of its own)
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
    if (SNAP_DAYS.includes(day) && st.phase !== 'over') rec.atDay[day] = daySnapshot(st, rec);
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
  rec.groups = { earned: st.groups.earned, top: Math.max(...Object.values(st.groups.defeats)) };
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
// T-B1: the median day of the careful persona's first piece of a material, and of having 3 of 5 slots in it (1.2: 4/10/18 and 7/14/28).
const PROGRESS_TARGET = {
  iron: { first: [3, 6], three: [6, 9] },
  steel: { first: [8, 12], three: [12, 16] },
  mythril: { first: [15, 21], three: [24, 32] },
};

// One line on how a persona chooses its fight (the BOT section's title).
const PICK_TEXT = {
  ev: (P) => `pick: max win% x (points + ${P.future}) among enemies with est. win >= ${P.minWin}%`,
  champion: (P) => `pick: a champion at est. win >= ${P.champMin}%, else an elite at >= ${P.eliteMin}%, else max win% x (points + ${P.future}) at >= 50%`,
  looks: (P) => `pick: no estimate; a normal until its gear level is ${P.gearLevelForElites}, then an elite, the fewest visible High attributes`,
};

function botSection(o, T) {
  const N = o.seeds ?? (o.quick ? 3 : 20);
  const D = o.quick ? Math.min(o.days, 40) : o.days;
  const VT = T ?? valueTables(o.quick ? 30 : 150, o.quick ? 15 : 40);
  const P = botParams(VT, o);
  // --immortal: enemies deal no damage from here on (the value tables above used the real numbers)
  const immortalLog = o.immortal ? applySet('enemies.tiers.*.damage', '0') : [];
  const persona = PERSONAS[P.persona];
  h1(`BOT — ${persona.name}: ${N} runs x up to ${D} days (${PICK_TEXT[P.pick](P)})` +
    (P.ablate.size ? `  ABLATED: ${[...P.ablate].join(', ')}` : '') + (o.intel !== 'persona' ? `  INTEL: ${o.intel}` : ''));
  const careful = P.persona === 'careful';
  const reads = P.pick !== 'looks'; // the casual persona never reads an estimate
  const T_ROWS = []; // the plan's targets for this run (they are written for the careful persona)
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
      f1(meanFinite(pk.map((x) => x.p))), f1((100 * pk.filter((x) => x.win || x.draw).length) / Math.max(1, pk.length)), f1((100 * losses) / Math.max(1, pk.length)), reads ? pk.filter((x) => x.safe === false).length : '-']),
  );
  // the estimate of a tier on a day: the best / the mean over the roster's enemies of the tier (the casual persona has none)
  const tierP = (x, kind, t) => (x[kind] ? x[kind][t] : NaN);
  h2("Best estimated win % on each day's roster with the bot's own gear (mean over runs alive)");
  const pdays = dayList([2, 3, 5, 7, 10, 15, 20, 25, 30, 35, 40, 50, 60, 70, 80]);
  printTable(
    ['tier', ...pdays.map((d) => `d${d}`)],
    TIERS.map((t) => [t, ...pdays.map((d) => f0(meanFinite(recs.flatMap((r) => r.picks.filter((x) => x.day === d).map((x) => tierP(x, 'bestP', t))))))]),
  );
  h2('Win chance by tier: the mean estimate over the roster\'s enemies of the tier, with the gear the bot packed (T-GEAR c)');
  const gearRanges = [[2, 2], [3, 5], [6, 9], [10, 20], [21, 30], [31, 40], [41, 60]].filter(([a]) => a <= D);
  printTable(
    ['fight days', 'runs x days', ...TIERS.map((t) => `${t} est. %`)],
    gearRanges.map(([a, b]) => {
      const pk = recs.flatMap((r) => r.picks.filter((x) => x.day >= a && x.day <= b));
      return [a === b ? String(a) : `${a}-${b}`, pk.length, ...TIERS.map((t) => f1(meanFinite(pk.map((x) => tierP(x, 'meanP', t)))))];
    }),
  );
  const midPicks = recs.flatMap((r) => r.picks.filter((x) => x.day >= 10 && x.day <= 40));
  if (reads) {
    note(`Estimate: ${P.estimator === 'game' ? `the game's own (${cfg.sim.samples} x ${cfg.sim.evalFights} plus intel)` : `the bot's screen (${P.simOpts.samples} x ${P.simOpts.evalFights} with the best packed piece per slot, a slight underestimate)`}. Targets (T-GEAR c): days 10-40 mean elite 75-90, mean champion 50-75.`);
    if (careful) {
      check(T_ROWS, 'T-GEAR', 'elite, days 10-40 (mean estimate)', meanFinite(midPicks.map((x) => tierP(x, 'meanP', 'elite'))), 75, 90);
      check(T_ROWS, 'T-GEAR', 'champion, days 10-40 (mean estimate)', meanFinite(midPicks.map((x) => tierP(x, 'meanP', 'champion'))), 50, 75);
    }
  } else note('The casual persona never reads an estimate, so there is no win chance to show.');
  const d2picks = recs.flatMap((r) => r.picks.filter((x) => x.day === 2));
  const day1 = recs.map((r) => r.craftLog.filter((c) => c.day === 1));
  const d1label = (c) => `${c.material[0].toUpperCase()}${c.grade} ${c.slot}`;
  if (reads) {
    note(`Day-2 fight with the bot's day-1 gear, TYPICAL enemy (mean est. over the roster's enemies of the tier): ` +
      TIERS.map((t) => `${t} ${f0(meanFinite(d2picks.map((x) => tierP(x, 'meanP', t))))}%`).join(', ') + ` (T-GEAR kit rows: node tools/balance.mjs --section day2).`);
  }
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
  h2('Progression milestones (median day over runs that got there; T-B1 target in brackets)');
  const prog = {};
  const progRows = ['iron', 'steel', 'mythril'].map((m) => {
    const first = recs.map((r) => (r.craftLog.find((c) => MAT_RANK[c.material] >= MAT_RANK[m]) || { day: NaN }).day).filter(Number.isFinite);
    const sword = recs.map((r) => firstDay(r, (sn) => MAT_RANK[sn.mats.sword] >= MAT_RANK[m])).filter(Number.isFinite);
    const three = recs.map((r) => firstDay(r, (sn) => slotsAtLeast(sn, m) >= 3)).filter(Number.isFinite);
    const all = recs.map((r) => firstDay(r, (sn) => slotsAtLeast(sn, m) >= 5)).filter(Number.isFinite);
    prog[m] = { first: median(first), three: median(three) };
    const fmt = (a) => `${f0(median(a))} (${a.length}/${N})`;
    const tg = PROGRESS_TARGET[m];
    if (careful) {
      check(T_ROWS, 'T-B1', `first ${m} piece, median day`, prog[m].first, tg.first[0], tg.first[1]);
      check(T_ROWS, 'T-B1', `3 of 5 slots ${m}, median day`, prog[m].three, tg.three[0], tg.three[1]);
    }
    return [`${m} >=`, `${fmt(first)} [${tg.first.join('-')}]`, fmt(sword), `${fmt(three)} [${tg.three.join('-')}]`, fmt(all)];
  });
  printTable(['material', 'first piece', 'sword', '3 of 5 slots', 'all 5 slots'], progRows);

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
  const workMin = (days) => sum(days.map((x) => sum(TIME_CATS.map((c) => x.t[c]))));
  // NaN when the range holds no day (a short --days run): the T-B2 / T-B3 rows then print n/a, not 0 / LOW
  const travelPct = (days) => (days.length ? (100 * sum(days.map((x) => x.t.travel))) / Math.max(1, workMin(days)) : NaN);
  const loadPct = (days) => (days.length ? (100 * sum(days.map((x) => x.t.load))) / Math.max(EPS, sum(days.map((x) => x.t.travel))) : NaN);
  printTable(
    ['days', ...TIME_CATS, 'idle', 'load (in travel)', 'travel % of used', 'load % of travel', 'mining % of used', 'trips/day'],
    tr.map(([a, b]) => {
      const days = daysIn(a, b);
      const m = (c) => mean(days.map((x) => x.t[c]));
      const used = sum(TIME_CATS.map(m));
      return [`${a}-${b}`, ...TIME_CATS.map((c) => f0(m(c))), f0(DAY_LEN - used), f0(m('load')), f0(travelPct(days)), f1(loadPct(days)), f0(miningPct(days)), f1(mean(days.map((x) => x.trips)))];
    }),
  );
  note('load = the part of the travel minutes that the carried items add (the same walks with nothing carried make up the rest of travel). Targets (T-B2, days 11-40): travel 25-35% of the minutes worked, load 8-15% of the travel minutes.');
  if (careful) {
    check(T_ROWS, 'T-B2', 'travel, % of work time, days 11-40', travelPct(daysIn(11, 40)), 25, 35);
    check(T_ROWS, 'T-B2', 'load, % of travel minutes, days 11-40', loadPct(daysIn(11, 40)), 8, 15);
  }
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
  // Repairs happen by day only (no night repairs). Days 11-40 are the plan's measuring window (T-B3).
  const midDays = daysIn(11, 40);
  const repMidMin = midDays.length ? mean(midDays.map((x) => x.t.repair)) : NaN;
  const repMidPct = midDays.length ? (100 * sum(midDays.map((x) => x.t.repair))) / Math.max(1, workMin(midDays)) : NaN;
  note(`Repairs: ${f1(mean(recs.map((r) => r.repaired)))} by day per run (${f1(repMidMin)} min a day on days 11-40), ${f1(mean(recs.map((r) => r.rested)))} rested item-days, ` +
    `${f1(mean(recs.map((r) => r.subRepairs)))} substitutes (${f2(mean(recs.map((r) => r.subBars)))} better bars used); ` +
    `${f1(mean(recs.map((r) => sum(Object.values(r.timeByDay).map((t) => t.repair)))))} repair minutes per run. ` +
    `The bot repairs an unpacked top-3 item below ${P.repairBelow}%, or below ${P.subBelow}% if only a higher grade is in stock` +
    (P.pack === 'default' ? "; it packs the game's default pack, so only an item the default pack left out (it could break) is repaired. " : `; items below ${P.restBelow}% that it can repair stay home, as do items a champion fight could destroy. `) +
    `Deferred because only a higher grade was in stock: ${f1(mean(recs.map((r) => r.subDeferred)))} item-days/run.`);
  note(`Repair time is ${f1(repMidPct)}% of the minutes worked on days 11-40 (T-B3: 3-6%), ${f1(mean(recs.map((r) => r.destroyed)))} items destroyed by wear per run (T-B3: at most 5; 1.2: 3.9).`);
  if (careful) {
    check(T_ROWS, 'T-B3', 'repair time, % of work time, days 11-40', repMidPct, 3, 6);
    check(T_ROWS, 'T-B3', 'items destroyed by wear per run', mean(recs.map((r) => r.destroyed)), null, 5);
  }
  note(`Repair blocked (a worn top-3 item below ${P.repairBelow}% with no bars of its material at its grade or higher): ` +
    `${f1(mean(recs.map((r) => Object.keys(r.repairBlocked).length)))} days/run, ${f1(mean(recs.map((r) => sum(Object.values(r.repairBlocked)))))} item-days/run.`);
  note('Trips per run by field distance: ' + BUCKETS.map((d) => `d${bucketLabel(d)} ${f1(mean(recs.map((r) => r.tripDist.filter((x) => bucketOf(x) === d).length)))}`).join(', ') +
    `; mean trip distance ${f2(mean(recs.flatMap((r) => r.tripDist)))}.`);

  // ---- gem supply (R29 cut the gems, R33 wants more of them: do the bot's gems cover what it wants?)
  h2('Gem supply (per run; answer gems: ruby, diamond, topaz, sapphire)');
  const gemsFound = mean(recs.map((r) => sum(GEMS.map((g) => r.gathered[`gem:${g}`] || 0))));
  const gemsCutOk = mean(recs.map((r) => sum(GRADES.map((g) => r.cuts[g] || 0))));
  const repGems = mean(recs.map((r) => r.repairGems));
  const at25 = recs.map((r) => r.atDay[25]).filter(Boolean);
  const cover25 = mean(at25.map((x) => x.cover));
  printTable(['raw gems carried home', 'cut (cuts that worked)', 'infused into gear', 'used by repairs', 'repairs % of cut', 'answer-gem armor cover at day 25 (of 4)', 'runs alive at day 25'],
    [[f1(gemsFound), f1(gemsCutOk), f1(mean(recs.map((r) => r.gemsUsed))), f2(repGems), f1((100 * repGems) / Math.max(EPS, gemsCutOk)), f2(cover25), `${at25.length}/${N}`]]);
  note('cover = how many of the 4 answer gems the run owns on a chest or a helmet (what T-R33 M2 says to bring to a fight against a High special). Repair gems are fractions: a repair costs gemFraction % of the item\'s gem, scaled by the % repaired.');
  if (careful) {
    check(T_ROWS, 'T-B5', 'answer-gem armor cover at day 25, runs alive (of 4)', cover25, 2.5, null, 2);
    check(T_ROWS, 'T-B5', 'gems used by repairs, % of gems cut', (100 * repGems) / Math.max(EPS, gemsCutOk), null, 25);
  }

  // ---- skills at day 30 (T-B4)
  h2('Skills at day 30 (mean level over the runs alive on day 30)');
  const at30 = recs.map((r) => r.atDay[30]).filter(Boolean);
  const lv = (key) => mean(at30.map((x) => x.skills[key]));
  const defs = skillDefs();
  const actKeys = defs.filter((d) => !d.material).map((d) => d.key);
  if (!at30.length) note('No run was alive on day 30 (use --days 30 or more, without --quick).');
  else {
    printTable(['activity skill', 'mean level'], actKeys.map((k) => [defs.find((d) => d.key === k).name, f1(lv(k))]));
    printTable(['bar type', 'bar grade', 'refining', 'smithing', 'repair', 'runs with it as main bar'],
      BARS.map((b) => [b, f1(lv(`oreGrade_${b}`)), f1(lv(`oreFail_${b}`)), f1(lv(`smith_${b}`)), f1(lv(`repair_${b}`)), `${at30.filter((x) => x.mainBar === b).length}/${at30.length}`]));
    printTable(['gem type', 'grade', 'cutting'], GEMS.map((g) => [g, f1(lv(`gemGrade_${g}`)), f1(lv(`gemFail_${g}`))]));
    const main = (prefix) => mean(at30.filter((x) => x.mainBar).map((x) => x.skills[`${prefix}_${x.mainBar}`]));
    note(`Main bar = the bar type the run has smithed the most items from (smithing ${f1(main('smith'))}, repair ${f1(main('repair'))}). Targets (T-B4, day 30): Travel 6-8, Carrying 5-8, General repair 5-7, main bar smithing 3-6, main bar repair 3-6.`);
    if (careful) {
      check(T_ROWS, 'T-B4', 'Travel, mean level at day 30', lv('travel'), 6, 8);
      check(T_ROWS, 'T-B4', 'Carrying', lv('carrying'), 5, 8);
      check(T_ROWS, 'T-B4', 'General repair', lv('repairTime'), 5, 7);
      check(T_ROWS, 'T-B4', 'main bar smithing', main('smith'), 3, 6);
      check(T_ROWS, 'T-B4', 'main bar repair', main('repair'), 3, 6);
    }
  }

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
  note(`Banners: ${f1(mean(recs.map((r) => r.groups.earned)))} pack mules earned per run (of ${SLOTS.length * cfg.groups.maxExtraPerType}), the most-beaten banner has ${f1(mean(recs.map((r) => r.groups.top)))} wins at the end.`);

  // ---- the plan's targets, then the one-line summary for comparing what-if runs
  if (careful) printTargets(T_ROWS, 'Targets for the careful persona (docs/PLAN-2.0.md section 9: T-B1..T-B5, T-GEAR c)');
  else note(`The bot targets (T-B1..T-B5, T-GEAR c) are written for the careful persona; this run is ${persona.name}. Persona behaviour (T-P) is checked by --section benchmark.`);
  const mid = recs.flatMap((r) => r.picks.filter((x) => x.day >= 11 && x.day <= 30 && x.win !== undefined));
  const share = (arr, t) => f0((100 * arr.filter((x) => x.tier === t).length) / Math.max(1, arr.length));
  const d2 = recs.flatMap((r) => r.picks.filter((x) => x.day === 2));
  const life = median(recs.map((r) => r.deathDay ?? Infinity));
  const repairPct = (100 * repairMin) / Math.max(1, usedMin);
  console.log(`\nBOT SUMMARY | ${P.persona} | alive ${dayList([10, 20, 30, 40, 50, 60, 80]).map((d) => `d${d}:${f0(alivePct(d))}%`).join(' ')}` +
    ` | median life ${life === Infinity ? `>${D}` : f1(life)} | score ${f0(mean(scores))}` +
    ` | d2 typical est n/e/c ${reads ? TIERS.map((t) => f0(meanFinite(d2.map((x) => tierP(x, 'meanP', t))))).join('/') : '-'}` +
    ` | d10-40 est e/c ${reads ? `${f0(meanFinite(midPicks.map((x) => tierP(x, 'meanP', 'elite'))))}/${f0(meanFinite(midPicks.map((x) => tierP(x, 'meanP', 'champion'))))}` : '-'}` +
    ` | first iron/steel/myth piece d${f0(prog.iron.first)}/${f0(prog.steel.first)}/${f0(prog.mythril.first)}` +
    ` | 3-slot iron/steel/myth d${f0(prog.iron.three)}/${f0(prog.steel.three)}/${f0(prog.mythril.three)}` +
    ` | d11-30 fights n/e/c ${TIERS.map((t) => share(mid, t)).join('/')}%` +
    ` | mining ${f0(miningPct(daysIn(2, D)))}% trips/day ${f1(mean(daysIn(2, D).map((x) => x.trips)))} idle ${f0(mean(daysIn(2, D).map((x) => DAY_LEN - sum(TIME_CATS.map((c) => x.t[c])))))}m` +
    ` | d11-40 travel ${f0(travelPct(midDays))}% load ${f1(loadPct(midDays))}% of travel` +
    ` | repair ${f1((100 * repairBars) / Math.max(1, barsMade))}% bars ${f1(repairPct)}% time (d11-40 ${f1(repMidPct)}%), by day only (${f1(mean(recs.map((r) => r.subRepairs)))} subst., ${f1(mean(recs.map((r) => r.destroyed)))} destroyed)` +
    ` | skills d30 travel/carry/repair ${at30.length ? `${f1(lv('travel'))}/${f1(lv('carrying'))}/${f1(lv('repairTime'))}` : '-'}` +
    ` | answer cover d25 ${f1(cover25)}/4` +
    ` | map found ${[40, 60, 80].filter((d) => supply[d]).map((d) => `d${d}:${f0(supply[d].pct)}%`).join(' ') || '-'}` +
    ` | field: ${f2(fw.found / Math.max(1, fw.searches))} found/search, carried ${f0((100 * fw.carried) / Math.max(1, fw.found))}% of found (${f1(fw.carried / Math.max(1, fw.trips))}/trip, ${f0(fw.oldPile)} from old piles),` +
    ` piles at end ${f0(fw.pileEnd)} (${f1(fw.pileEndWorth)} worth), debris ${f1(fw.debrisPct)}% of effort` +
    ` | gems cut ${f1(cutN)}/run F/D/C+ ${f0((100 * cutsAll.F) / Math.max(EPS, cutN))}/${f0((100 * cutsAll.D) / Math.max(EPS, cutN))}/${f0((100 * (cutN - cutsAll.F - cutsAll.D)) / Math.max(EPS, cutN))}%, ${f1(mean(recs.map((r) => r.gemsUsed)))} infused` +
    (careful ? ` | ${targetFlags(T_ROWS)}` : ''));
  return recs;
}


// ============================================================ BENCHMARK =====
// The difficulty benchmark: the personas (PERSONAS) on a FIXED list of seeds (mixSeed(31337, 0..N-1); the same
// seeds in every version and for every persona), reporting the survival curve = % of runs still alive at the end of day d.
// Only the game changes between versions, so the curve shows how tough each version is. The numbers
// that matter are the alive% columns and the median life; the mean score is secondary.
// Noise: with 100 runs one alive% has a standard error of up to 5 points (so compare versions by the
// shape of the curve, and treat differences under about 10 points as noise).
const BENCH_SEED_BASE = 31337;

// One finished run as a small record (a --jobs child sends these as JSON): when it ended, its score, and how many fights it
// took of each tier (all days, and on days 11-40), plus the sum and count of the estimates the fights were taken at.
function lightRecord(i, r) {
  const fought = r.picks.filter((x) => x.win !== undefined); // planned fights that happened (the last plan may not)
  const byTier = (picks) => Object.fromEntries(TIERS.map((t) => [t, picks.filter((x) => x.tier === t).length]));
  const ps = fought.map((x) => x.p).filter(Number.isFinite);
  return {
    i, deathDay: r.deathDay, lastDay: r.lastDay, score: r.score, wins: r.wins,
    fights: byTier(fought), fightsMid: byTier(fought.filter((x) => x.day >= 11 && x.day <= 40)), pSum: sum(ps), pN: ps.length,
  };
}

// Runs benchmark seeds i = from, from + step, ... (< N) and returns light records.
function benchRuns(N, D, P, shard) {
  const [from, step] = shard || [0, 1];
  const out = [];
  for (let i = from; i < N; i += step) out.push(lightRecord(i, runBot(mixSeed(BENCH_SEED_BASE, i), D, P)));
  return out;
}

// The value tables the bot's weights come from (one set for every persona and intel mode: they only read the game numbers).
function benchTables(o) {
  return valueTables(o.quick ? 30 : 150, o.quick ? 15 : 40);
}

// --jobs: the same command in k child processes, each running every k-th seed of one persona (and intel mode); results
// are merged (a run only depends on its seed and the config, so this equals one process).
function benchViaChildren(o, N, D, persona, intelMode) {
  const argv = process.argv.slice(2);
  const base = [];
  const SKIP = new Set(['--jobs', '--seeds', '--days', '--persona', '--intel', '--section', '--shard']);
  for (let i = 0; i < argv.length; i++) {
    const name = argv[i].includes('=') && argv[i].startsWith('--') ? argv[i].slice(0, argv[i].indexOf('=')) : argv[i];
    if (SKIP.has(name)) {
      if (!argv[i].includes('=')) i += 1; // its value is the next argument
    } else if (name !== '--emit-json') base.push(argv[i]);
  }
  const script = fileURLToPath(import.meta.url);
  const children = [];
  for (let k = 0; k < o.jobs; k++) {
    children.push(new Promise((resolve, reject) => {
      const args = [script, ...base, '--section', 'benchmark', '--persona', persona, '--intel', intelMode, '--seeds', String(N), '--days', String(D), '--shard', `${k}/${o.jobs}`, '--emit-json'];
      const c = spawn(process.execPath, args, { stdio: ['ignore', 'pipe', 'inherit'] });
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

// The light records of N seeds for one persona and intel mode: in this process, or --jobs children.
async function benchPersona(o, N, D, persona, intelMode, estimator, tables) {
  let recs;
  if (o.jobs > 1) recs = await benchViaChildren(o, N, D, persona, intelMode);
  else {
    const P = botParams(tables, { ...o, persona, intel: intelMode, estimator });
    recs = withSets(intelModeSets(intelMode), () => benchRuns(N, D, P, null));
  }
  recs.sort((a, b) => a.i - b.i);
  if (recs.length !== N) throw new Error(`benchmark: expected ${N} runs, got ${recs.length}`);
  return recs;
}

// Everything the benchmark reports about one persona's records.
function benchStats(recs, N, D) {
  const alive = (r, d) => r.lastDay >= d && !(r.deathDay != null && r.deathDay <= d);
  // NaN after the last day played: nothing is known about a day d > D (a target on it prints n/a, not 0 / LOW)
  const alivePct = (d) => (d > D ? NaN : (100 * recs.filter((r) => alive(r, d)).length) / N);
  const life = recs.map((r) => r.deathDay ?? Infinity).sort((a, b) => a - b);
  const fightShare = (key) => {
    const total = sum(recs.map((r) => sum(TIERS.map((t) => r[key][t]))));
    return Object.fromEntries(TIERS.map((t) => [t, total ? (100 * sum(recs.map((r) => r[key][t]))) / total : NaN])); // NaN: no fight in range (n/a, not 0)
  };
  const pN = sum(recs.map((r) => r.pN));
  return {
    alivePct, life, medLife: median(life), meanScore: mean(recs.map((r) => r.score)),
    scorePerDay: mean(recs.map((r) => r.score / Math.max(1, r.lastDay - 1))), // score per day survived (day 1 has no fight)
    fights: fightShare('fights'), fightsMid: fightShare('fightsMid'), pickedAt: pN ? sum(recs.map((r) => r.pSum)) / pN : NaN,
  };
}

async function benchmarkSection(o) {
  const N = o.seeds ?? (o.quick ? 6 : 100);
  const D = o.quick ? Math.min(o.days, 40) : o.days;
  const estimator = o.estimator ?? 'game';
  if (o.emitJson) {
    // a --jobs child: one persona (and intel mode), the seeds of its shard
    const P = botParams(benchTables(o), { ...o, estimator });
    console.log('BENCH_JSON ' + JSON.stringify(benchRuns(N, D, P, o.shard)));
    return null;
  }
  const personas = o.persona === 'all' ? PERSONA_NAMES : [o.persona];
  const t0 = Date.now();
  const sim0 = gameSimOpts(newGame(1));
  const simText = `${sim0.samples ?? cfg.sim.samples} guesses x ${sim0.evalFights ?? cfg.sim.evalFights} test fights, gear picked with ${sim0.fightsPerLoadout ?? cfg.sim.fightsPerLoadout} fights per loadout`;
  const estText = estimator === 'game'
    ? `the in-game automatic estimate (${simText}, plus the bot's Battle simulation points and Foresight rings)`
    : (() => {
      const sim = botSimOpts(o); // not botParams: --persona all is no persona, and the tables are not needed for a header
      return `the bot's own two-stage estimate (${sim.samples} guesses x ${sim.evalFights} fights screen, the best 3 re-checked)`;
    })();
  h1(`BENCHMARK — version ${VERSION}: ${personas.map((n) => PERSONAS[n].name).join(', ')}; ${N} fixed seeds x up to ${D} days`);
  note(`Seeds: mixSeed(${BENCH_SEED_BASE}, 0..${N - 1}), the same maps for every persona. Estimate: ${estText}; the casual persona never reads it.`);
  note(personas.map((n) => `${PERSONAS[n].name}: ${PICK_TEXT[PERSONAS[n].pick]({ ...PERSONAS[n], minWin: o.minwin ?? PERSONAS[n].minWin, future: o.future ?? PERSONAS[n].future })}`).join('. ') + '.');
  if (o.quick) note('QUICK run (few seeds, 40 days): the target flags below are only a smoke test.');
  const tables = o.jobs > 1 ? null : benchTables(o);
  const recsBy = {};
  for (const name of personas) {
    const t = Date.now();
    recsBy[name] = await benchPersona(o, N, D, name, o.intel, estimator, tables);
    note(`(${PERSONAS[name].name}: ${((Date.now() - t) / 1000).toFixed(1)}s${o.jobs > 1 ? `, ${o.jobs} processes` : ''})`);
  }
  const wallS = (Date.now() - t0) / 1000;
  note(`Wall time ${wallS.toFixed(1)}s (${f1(wallS / 60)} min, ${o.jobs} process${o.jobs > 1 ? 'es' : ''}).`);
  const stats = Object.fromEntries(personas.map((n) => [n, benchStats(recsBy[n], N, D)]));

  const days = BENCH_DAYS.filter((d) => d <= D);
  const medText = (st) => (st.medLife === Infinity ? `>${D}` : f1(st.medLife));
  const mixText = (m) => TIERS.map((t) => f0(m[t])).join('/');
  const pctText = (v) => (Number.isFinite(v) ? `${f0(v)}%` : '-');
  h2('Survival curve: % of runs alive at the end of day d');
  printTable(['persona', ...days.map((d) => `d${d}`), 'median life', 'mean score', 'score/day', 'fights n/e/c %', 'picked at'],
    personas.map((n) => {
      const st = stats[n];
      return [PERSONAS[n].name, ...days.map((d) => f0(st.alivePct(d))), medText(st), f0(st.meanScore), f1(st.scorePerDay), mixText(st.fights), pctText(st.pickedAt)];
    }));
  note('score/day = the mean of score / (days survived), day 1 has no fight. fights n/e/c % = the share of the fights taken that were normal / elite / champion. picked at = the mean estimate of the fights taken (the casual persona has none).');
  const bins = DEATH_BINS.filter(([a]) => a <= D);
  const binText = ([a, b]) => (b === Infinity ? `${a}+` : a === b ? String(a) : `${a}-${b}`);
  h2('Deaths by day (runs)');
  printTable(['persona', ...bins.map(binText), 'deaths'],
    personas.map((n) => {
      const deaths = recsBy[n].filter((r) => r.deathDay != null);
      return [PERSONAS[n].name, ...bins.map(([a, b]) => deaths.filter((r) => r.deathDay >= a && r.deathDay <= b).length), `${deaths.length}/${N}`];
    }));
  for (const n of personas) {
    const st = stats[n];
    const q = (p) => {
      const v = quantile(st.life, p);
      return v === Infinity ? `>${D}` : f1(v);
    };
    const scores = recsBy[n].map((r) => r.score);
    note(`${PERSONAS[n].name}: life (day of death; runs alive at day ${D} count as >${D}) p10 ${q(0.1)}, p25 ${q(0.25)}, median ${medText(st)}, p75 ${q(0.75)}, p90 ${q(0.9)}. ` +
      `Score mean ${f0(st.meanScore)}, median ${f0(median(scores))}, min ${Math.min(...scores)}, max ${Math.max(...scores)}. Wins per run: ${TIERS.map((t) => `${t} ${f1(mean(recsBy[n].map((r) => r.wins[t])))}`).join(', ')}. ` +
      `Fights on days 11-40 n/e/c %: ${mixText(st.fightsMid)}.`);
  }
  note(`Noise: one alive% has a standard error of ${f1(50 / Math.sqrt(N))} points at 50% (100 runs: 5); treat differences under about 10 points as noise.`);

  // ---- the plan's targets: T-D (difficulty, the careful persona) and T-P (the personas behave)
  const T_ROWS = [];
  const lifeNum = (st) => (st.medLife === Infinity ? D + 1 : st.medLife); // alive at the end counts as one day longer than the run
  const st = stats;
  if (st.careful) {
    check(T_ROWS, 'T-D', 'careful: median life (days)', lifeNum(st.careful), 30, 40);
    check(T_ROWS, 'T-D', 'careful: alive at day 10 (%)', st.careful.alivePct(10), 75, 85, 0);
    check(T_ROWS, 'T-D', 'careful: alive at day 2 (%)', st.careful.alivePct(2), 95, null, 0);
    check(T_ROWS, 'T-D', 'careful: alive at day 4 (%)', st.careful.alivePct(4), 85, null, 0);
  }
  if (st.casual) {
    check(T_ROWS, 'T-P', 'casual: alive at day 4 (%)', st.casual.alivePct(4), 70, null, 0);
    check(T_ROWS, 'T-P', 'casual: share of champion fights (%)', st.casual.fights.champion, null, 0);
  }
  if (st.careful && st.casual) {
    check(T_ROWS, 'T-P', 'careful - casual: alive at day 20 (points)', st.careful.alivePct(20) - st.casual.alivePct(20), 10, null, 0);
    check(T_ROWS, 'T-P', 'careful - casual: alive at day 40 (points)', st.careful.alivePct(40) - st.casual.alivePct(40), 10, null, 0);
  }
  if (st.careful && st.champion) {
    check(T_ROWS, 'T-P', "champion: score/day relative to careful's (x)", st.champion.scorePerDay / Math.max(EPS, st.careful.scorePerDay), 1.2, null, 2);
    check(T_ROWS, 'T-P', "careful - champion: median life (days)", lifeNum(st.careful) - lifeNum(st.champion), 3, null);
  }
  if (st.champion) check(T_ROWS, 'T-P', 'champion: champions among its fights, days 11-40 (%)', st.champion.fightsMid.champion, 40, null, 0);
  if (personas.length > 1) check(T_ROWS, 'T-P', `benchmark wall time with ${o.jobs} jobs (minutes)`, wallS / 60, null, 15);
  if (T_ROWS.length) printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-D, T-P)');

  // ---- one line and one markdown row per persona
  const estShort0 = estimator === 'game' ? `game ${sim0.samples ?? cfg.sim.samples}x${sim0.evalFights ?? cfg.sim.evalFights}` : 'bot';
  const estShort = (n) => (PERSONAS[n].pick === 'looks' ? 'no estimate' : estShort0); // the casual persona never reads one
  for (const n of personas) {
    const s = stats[n];
    console.log(`\nBENCHMARK | v${VERSION} | ${n} | seeds ${N} | alive ${days.map((d) => `d${d}:${f0(s.alivePct(d))}%`).join(' ')} | median life ${medText(s)} | mean score ${f0(s.meanScore)} | score/day ${f1(s.scorePerDay)} | fights n/e/c ${mixText(s.fights)}% | picked at ${pctText(s.pickedAt)} | estimator ${estShort(n)}`);
  }
  console.log('\nMarkdown rows for docs/BENCHMARKS.md (add your own notes at the end):');
  for (const n of personas) {
    const s = stats[n];
    console.log(`| ${VERSION} | ${new Date().toISOString().slice(0, 10)} | ${PERSONAS[n].name} | ${N} | ${BENCH_DAYS.map((d) => (d <= D ? f0(s.alivePct(d)) : '-')).join(' | ')} | ${medText(s)} | ${f0(s.meanScore)} | ${f1(s.scorePerDay)} | ${mixText(s.fights)} | ${pctText(s.pickedAt)} | estimator ${estShort(n)} |`);
  }
  console.log(`\nBENCHMARK SUMMARY | v${VERSION} | seeds ${N} | wall ${f1(wallS / 60)} min (${o.jobs} jobs) | ${personas.map((n) => `${n} life ${medText(stats[n])} d10 ${f0(stats[n].alivePct(10))}%`).join(' | ')}${T_ROWS.length ? ` | ${targetFlags(T_ROWS)}` : ''}`);
  return recsBy;
}

// =============================================================== INTEL ======
// R42 / T-R42: is the choice of what to upgrade obvious? The careful persona plays the same seeds in 8 modes: each
// track alone first (only:<track>: that track until it is maxed, then the persona's own list), the persona's own list,
// and no intel at all (every track's gains set to [0], so the gate opens and intel does nothing). A run that is still
// alive at --days counts as days + 1. The differences are paired by seed.
async function intelSection(o) {
  const N = o.seeds ?? (o.quick ? 4 : 100);
  const D = o.quick ? Math.min(o.days, 25) : o.days;
  const estimator = o.estimator ?? 'game';
  const persona = o.persona;
  const tracks = Object.keys(cfg.intel.tracks);
  const modes = [...tracks.map((t) => `only:${t}`), 'persona', 'none'];
  const t0 = Date.now();
  h1(`INTEL — does one track dominate? ${PERSONAS[persona].name}, ${N} fixed seeds x up to ${D} days, ${modes.length} modes on the same seeds`);
  note(`Modes: ${modes.join(', ')}. only:<track> spends on that track until it is maxed, then follows the persona's list (${intelList(PERSONAS[persona]).map(([t, v]) => (t === '*' ? 'fewest points' : `${t} ${v}`)).join(', ')}); none = no intel at all.`);
  note(`Seeds: mixSeed(${BENCH_SEED_BASE}, 0..${N - 1}), the same for every mode. Life = the day of death; alive at day ${D} counts as ${D + 1}. Differences are paired by seed: mean +- standard error.`);
  if (o.quick) note('QUICK run (few seeds, short): the target flags below are only a smoke test.');
  const tables = o.jobs > 1 ? null : benchTables(o);
  const recsBy = {};
  for (const mode of modes) {
    const t = Date.now();
    recsBy[mode] = await benchPersona(o, N, D, persona, mode, estimator, tables);
    note(`(${mode}: ${((Date.now() - t) / 1000).toFixed(1)}s)`);
  }
  const lifeOf = (r) => (r.deathDay != null && r.deathDay <= D ? r.deathDay : D + 1);
  const life = Object.fromEntries(modes.map((m) => [m, recsBy[m].map(lifeOf)]));
  const scoreOf = Object.fromEntries(modes.map((m) => [m, recsBy[m].map((r) => r.score)]));
  const se = (a) => (a.length > 1 ? Math.sqrt(a.reduce((x, v) => x + (v - mean(a)) ** 2, 0) / (a.length - 1) / a.length) : NaN);
  const diff = (a, b) => a.map((v, i) => v - b[i]); // paired by seed
  const meanLife = Object.fromEntries(modes.map((m) => [m, mean(life[m])]));
  const meanScore = Object.fromEntries(modes.map((m) => [m, mean(scoreOf[m])]));
  const onlyModes = modes.filter((m) => m.startsWith('only:'));
  const bestMode = modes.reduce((a, b) => (meanLife[b] > meanLife[a] ? b : a));
  const bestOnly = onlyModes.reduce((a, b) => (meanLife[b] > meanLife[a] ? b : a));
  const pm = (a, d = 1) => `${a.length ? fx(mean(a), d) : '-'} +- ${fx(se(a), d)}`;
  h2('Mean life and score per mode, and the paired differences');
  printTable(['mode', 'mean life', 'mean score', `life vs best (${bestMode})`, 'score vs best, %', 'life vs none'],
    modes.map((m) => [m, f1(meanLife[m]), f0(meanScore[m]), pm(diff(life[m], life[bestMode])), f1((100 * (meanScore[m] - meanScore[bestMode])) / Math.max(EPS, meanScore[bestMode])), pm(diff(life[m], life.none))]));
  note(`Best mode by mean life: ${bestMode}; best single track: ${bestOnly}.`);

  // ---- T-R42
  const T_ROWS = [];
  const lifeSpread = meanLife[bestOnly] - median(onlyModes.map((m) => meanLife[m]));
  const medOnlyScore = median(onlyModes.map((m) => meanScore[m]));
  const scoreSpread = (100 * (Math.max(...onlyModes.map((m) => meanScore[m])) - medOnlyScore)) / Math.max(EPS, medOnlyScore);
  check(T_ROWS, 'T-R42', '(1) best only: mode - median only: mode, mean life (days)', lifeSpread, null, 4);
  check(T_ROWS, 'T-R42', '(1) the same in mean score (%)', scoreSpread, null, 10);
  let worstVsNone = Infinity;
  for (const m of onlyModes) {
    const d = diff(life[m], life.none);
    worstVsNone = Math.min(worstVsNone, mean(d));
    check(T_ROWS, 'T-R42', `(2) ${m} vs none, in paired se (days / se)`, mean(d) / Math.max(EPS, se(d)), -2, null);
  }
  const defaultVsBest = meanLife.persona - meanLife[bestOnly];
  check(T_ROWS, 'T-R42', "(3) the persona's own list - best only: mode (days)", defaultVsBest, -3, null);
  printTargets(T_ROWS, 'Targets (docs/PLAN-2.0.md section 9: T-R42)');
  const sgn = (v) => signed(v, 1);
  console.log(`\nINTEL | best ${bestOnly} | spread life ${f1(lifeSpread)}d score ${f0(scoreSpread)}% | default ${sgn(defaultVsBest)}d | worst vs none ${sgn(worstVsNone)}d | seeds ${N} days ${D} | ${targetFlags(T_ROWS)}`);
  note(`(${((Date.now() - t0) / 1000).toFixed(1)}s total)`);
  return { meanLife, meanScore };
}

// ================================================================= DAY 2 =====
// R7 / T-R7 / T-GEAR (docs/PLAN-2.0.md section 9): the first fight of the game (day 2) against the whole range of enemies
// of each tier, with everything hidden (the adventurer fights each enemy as it is), first with no equipment at all, then
// with a day-1 kit. Win % counts draws as survival, like everywhere else in the tool.
const DAY2_SPECIALS = ['magical', 'stunning', 'chilling']; // the specials that matter on day 2 (a High one is what an unarmed adventurer cannot answer)
const DAY2_GEM = { magical: 'ruby', stunning: 'topaz', chilling: 'sapphire' }; // the armor gem that answers each
// T-R7 (unarmed): group = how many of the three specials are High; [label, lo, hi]. mean = the tier's overall target band,
// hard = limits that hold for every group even when the bands cannot all be met.
const DAY2_TARGETS = {
  elite: { group: (nh) => (nh >= 2 ? '2H+' : `${nh}H`), groups: [['0H', 44, 50], ['1H', 36, 44], ['2H+', 30, 36]], mean: [38, 45], hard: [28, 52] },
  champion: { group: (nh) => (nh <= 1 ? '<=1H' : `${nh}H`), groups: [['<=1H', 18, 25], ['2H', 8, 16], ['3H', 0, 6]], mean: [8, 16], hard: [0, 27] },
};
// T-GEAR: [lo, hi] win % for elites and champions with the day-1 kit (sword + chest) and with the kit plus matching gems.
const DAY2_GEAR_TARGETS = { kit2: { elite: [75, 80], champion: [50, 55] }, kit3: { elite: [85, 90], champion: [65, 75] } };

function day2Section(o) {
  const N = o.quick ? 200 : 600; // enemies per tier
  const F = o.quick ? 100 : 300; // fights per enemy
  const DAY = 2;
  const GEM_GRADE = 'C';
  const band = (v, lo, hi) => (v < lo - 1e-9 ? 'below' : v > hi + 1e-9 ? 'ABOVE' : 'ok');
  // The gear an adventurer has for one enemy. The kit variants do not depend on the enemy except kit3, which puts one
  // matching armor gem on the chest for the first High special and on an extra plain Copper D helmet / gloves for the next ones.
  const copperD = (slot, gem = null) => mkItem(slot, 'copper', 'D', gem);
  const kits = {
    unarmed: () => [],
    kit1: () => [copperD('sword')],
    kit2: () => [copperD('sword'), copperD('chest')],
    kit3: (nh, lv) => {
      const highs = DAY2_SPECIALS.filter((k) => lv[k] === 'high');
      const slots = ['chest', 'helmet', 'gloves'];
      const gearBySlot = highs.map((k, i) => copperD(slots[i], { type: DAY2_GEM[k], grade: GEM_GRADE }));
      return [copperD('sword'), ...(gearBySlot.some((g) => g.slot === 'chest') ? [] : [copperD('chest')]), ...gearBySlot];
    },
  };
  const LABEL = { unarmed: 'Unarmed', kit1: 'Copper D sword', kit2: 'Copper D sword + Copper D chest', kit3: 'kit + a matching gem per High special (all scouted: upper bound)' };

  // per variant and tier: { all: [win%], groups: { label: [win%] } }
  const results = {};
  for (const [variant, gearFor] of Object.entries(kits)) {
    results[variant] = {};
    for (const [ti, tier] of TIERS.entries()) {
      const rng = seededRng(mixSeed(99, ti));
      const all = [];
      const groups = {};
      for (let i = 0; i < N; i++) {
        const lv = rollLevels(rng, tier, cfg);
        const nh = DAY2_SPECIALS.filter((k) => lv[k] === 'high').length;
        const adv = adventurerCombatant(gearFor(nh, lv), {}, cfg);
        const en = enemyCombatant(tier, DAY, lv, 'Enemy', cfg);
        const fr = seededRng(mixSeed(5, i, ti));
        let w = 0;
        for (let f = 0; f < F; f++) {
          const r = fight(adv, en, fr.next, false, cfg);
          if (r.win || r.draw) w++;
        }
        const pct = (100 * w) / F;
        all.push(pct);
        const tg = DAY2_TARGETS[tier];
        if (tg) (groups[tg.group(nh)] ||= []).push(pct);
      }
      results[variant][tier] = { all, groups };
    }
  }

  h1(`DAY 2 — the first fight (day ${DAY}) with no equipment, then with a day-1 kit (${N} enemies per tier x ${F} fights each; everything hidden)`);
  note('Win % counts a draw as survival. "nH" = how many of Magical / Stunning / Chilling the enemy has at High (an unarmed adventurer cannot answer them).');
  note('Targets (T-R7, docs/PLAN-2.0.md section 9): the user asked for elites at 30-50% and champions at 0-25% without equipment; the bands below keep every group inside that.');
  let hits = 0;
  let checks = 0;
  const T_ROWS = []; // the same judgements, for the DAY2 line
  const flagCell = (v, lo, hi, hardLo, hardHi) => {
    const f = band(v, lo, hi);
    const hard = v < hardLo - 1e-9 || v > hardHi + 1e-9;
    checks++;
    if (f === 'ok') hits++;
    return hard ? `${f} (HARD LIMIT ${hardLo}-${hardHi})` : f;
  };
  h2('Unarmed (T-R7)');
  const rows = [];
  const un = results.unarmed;
  const normalMean = mean(un.normal.all);
  const eliteMean = mean(un.elite.all);
  rows.push(['normal', 'all', String(un.normal.all.length), f1(normalMean), `${f0(quantile(un.normal.all, 0.1))}-${f0(quantile(un.normal.all, 0.9))}`, `>= elite mean + 15 (${f1(eliteMean + 15)})`, normalMean >= eliteMean + 15 ? 'ok' : 'info: not clearly easier than elites']);
  for (const tier of ['elite', 'champion']) {
    const tg = DAY2_TARGETS[tier];
    const r = un[tier];
    rows.push([tier, 'all', String(r.all.length), f1(mean(r.all)), `${f0(quantile(r.all, 0.1))}-${f0(quantile(r.all, 0.9))}`, `${tg.mean[0]}-${tg.mean[1]}`, flagCell(mean(r.all), tg.mean[0], tg.mean[1], tg.hard[0], tg.hard[1])]);
    check(T_ROWS, 'T-R7', `${tier} mean`, mean(r.all), tg.mean[0], tg.mean[1]);
    for (const [label, lo, hi] of tg.groups) {
      const g = r.groups[label] || [];
      check(T_ROWS, 'T-R7', `${tier} ${label}`, g.length ? mean(g) : NaN, lo, hi);
      rows.push([tier, label, String(g.length), g.length ? f1(mean(g)) : '-', g.length ? `${f0(quantile(g, 0.1))}-${f0(quantile(g, 0.9))}` : '-', `${lo}-${hi}`, g.length ? flagCell(mean(g), lo, hi, tg.hard[0], tg.hard[1]) : 'no enemies']);
    }
  }
  printTable(['tier', 'group', 'enemies', 'win %', 'p10-p90', 'target', 'flag'], rows);
  note('Hard limits if the bands cannot all be met: every elite group within 28-52, every champion group at most 27.');

  h2('With a day-1 kit (information; T-GEAR for the last two)');
  const kitRows = Object.keys(kits).map((variant) => {
    const r = results[variant];
    const cell = (tier) => {
      const m = mean(r[tier].all);
      const t = DAY2_GEAR_TARGETS[variant] && DAY2_GEAR_TARGETS[variant][tier];
      if (t) check(T_ROWS, 'T-GEAR', `${variant} ${tier}`, m, t[0], t[1]);
      return `${f1(m)}${t ? ` (target ${t[0]}-${t[1]}: ${band(m, t[0], t[1])})` : ''}`;
    };
    return [LABEL[variant], cell('normal'), cell('elite'), cell('champion')];
  });
  printTable(['gear', 'normal', 'elite', 'champion'], kitRows);
  note(`kit3 puts a ${GEM_GRADE} gem that answers each High special on the chest, then on an extra plain Copper D helmet and gloves (a chest holds one gem). T-GEAR: kit2 elite 75-80 / champion 50-55, kit3 elite 85-90 / champion 65-75.`);
  note('kit3 is an UPPER BOUND for T-GEAR (b), "one matching gem per VISIBLE High special": it gems every High special, hidden ones too (as if everything were scouted), and with 2 or more Highs it also has the extra Copper D helmet and gloves. A real player sees only some of the Highs, so the real number lies between kit2 and kit3.');

  const m = (variant, tier) => f0(mean(results[variant][tier].all));
  const g = (tier, label) => f0(mean(un[tier].groups[label] || [NaN]));
  console.log(`\nDAY2 | unarmed n/e/c ${m('unarmed', 'normal')}/${m('unarmed', 'elite')}/${m('unarmed', 'champion')} | elite 0H/1H/2H+ ${g('elite', '0H')}/${g('elite', '1H')}/${g('elite', '2H+')} | champ <=1H/2H/3H ${g('champion', '<=1H')}/${g('champion', '2H')}/${g('champion', '3H')} | kit1 n/e/c ${m('kit1', 'normal')}/${m('kit1', 'elite')}/${m('kit1', 'champion')} | kit2 n/e/c ${m('kit2', 'normal')}/${m('kit2', 'elite')}/${m('kit2', 'champion')} | kit3 n/e/c ${m('kit3', 'normal')}/${m('kit3', 'elite')}/${m('kit3', 'champion')} | T-R7 in band ${hits}/${checks} | ${targetFlags(T_ROWS)}`);
  return results;
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
  if (o.section === 'all' || o.section === 'bot') {
    for (const name of o.persona === 'all' ? PERSONA_NAMES : [o.persona]) await run(o.persona === 'all' ? `bot ${name}` : 'bot', () => botSection({ ...o, persona: name }, T));
  }
  if (o.section === 'day2') await run('day2', () => day2Section(o));
  if (o.section === 'benchmark') await run('benchmark', () => benchmarkSection(o));
  if (o.section === 'intel') await run('intel', () => intelSection(o));
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
  applySet, parseArgs, workDay, choosePlan, spendIntelPoints, snapshot, runBot, botParams, valueTables, economySection, powerSection, day2Section, botSection, benchmarkSection,
  specialsSection, estimatorSection, intelSection, centerOptions, chooseField, makeValueFn, campReserve, winPct, setOf, mkItem, mapAttempts,
};

if (IS_MAIN) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
