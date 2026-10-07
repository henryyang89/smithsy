// Game state, day flow, battle resolution, save/load.
// UI and tools call these functions; each action returns { ok, msg, ... }.
import { CONFIG, ORES, GEMS, BARS, GRADES, SLOTS } from '../config.js';
import { rngFor, seededRng, mixSeed } from './rng.js';
import { generateMap, atCamp, regrowFields } from './map.js';
import { newSkills } from './skills.js';
import { newIntel } from './intel.js';
import { generateRoster, enemyCombatant, knownLevels } from './enemies.js';
import { ringTotals, ringDef, wornRings, ringLabel } from './rings.js';
import { adventurerCombatant, fight } from './combat.js';
import { loadouts, bestLoadout } from './sim.js';
import { gearName } from './gear.js';
import { formatClock } from './util.js';

export const SAVE_VERSION = 2; // 2 = v1.1: field piles, debris thickness, boulders
export const MAX_LOG = 300;
export const MAX_BATTLES = 20;

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0, cfg = CONFIG) {
  const state = {
    version: SAVE_VERSION,
    seed,
    rng: { s: seed >>> 0 },
    day: 1,
    time: cfg.time.dayStartMin,
    phase: 'work', // 'work' | 'report' | 'plan' | 'over'
    location: null,
    map: null,
    bag: [],
    storage: {
      ore: Object.fromEntries(ORES.map((o) => [o, 0])),
      gem: Object.fromEntries(GEMS.map((g) => [g, 0])),
      bars: Object.fromEntries(BARS.flatMap((b) => GRADES.map((g) => [`${b}:${g}`, 0]))),
      cut: Object.fromEntries(GEMS.flatMap((b) => GRADES.map((g) => [`${b}:${g}`, 0]))),
    },
    gear: [],
    rings: [],
    nextId: 1,
    skills: newSkills(cfg),
    intel: newIntel(cfg),
    roster: null, // enemies for tomorrow's fight
    plan: null, // today's fight (adventurer is away): { day, enemy, gearIds, ringIds }
    report: null, // last battle report, shown at end of day
    stats: { score: 0, wins: { normal: 0, elite: 0, champion: 0 }, fights: 0, bestDay: 1 },
    log: [],
    battles: [],
  };
  const rng = rngFor(state);
  state.map = generateMap(rng, cfg);
  state.location = { ...state.map.camp };
  state.roster = generateRoster(rng, 2, cfg);
  addLog(state, 'Day 1. Your adventurer rests today. Gather ore, smith gear, and pick tomorrow\'s fight at the end of the day.');
  return state;
}

export function addLog(state, text) {
  state.log.push({ day: state.day, time: formatClock(state.time), text });
  if (state.log.length > MAX_LOG) state.log.splice(0, state.log.length - MAX_LOG);
}

// Log the result of an action (and any skill-up notes). Returns the result for chaining.
export function logResult(state, res) {
  if (!res) return res;
  if (res.msg && res.ok) addLog(state, res.msg);
  for (const n of res.notes || []) addLog(state, n);
  return res;
}

export function adventurerRingTotals(state, ringIds = null, cfg = CONFIG) {
  const rings = ringIds ? state.rings.filter((r) => ringIds.includes(r.id)) : wornRings(state, 'adventurer', cfg);
  return ringTotals(rings, cfg);
}

// ------------------------------------------------------------ end of day ----
// Ends the work day. Resolves today's fight (if any), awards intel, then moves to
// 'report' (fight happened), 'plan' (choose tomorrow's fight) or 'over' (adventurer died).
export function endDay(state, cfg = CONFIG) {
  if (state.phase !== 'work') return { ok: false, msg: 'The day is already over.' };
  if (!atCamp(state)) return { ok: false, msg: 'Return to camp before ending the day.' };
  state.time = Math.max(state.time, cfg.time.dayEndMin);
  let report = null;
  if (state.plan) report = resolveBattle(state, cfg);
  if (state.day % cfg.intel.daysPerPoint === 0) {
    state.intel.points += 1;
    addLog(state, `Day ${state.day} complete: +1 intel point.`);
  }
  state.report = report;
  if (report && !report.win && !report.draw) {
    state.phase = 'over';
    addLog(state, `GAME OVER on day ${state.day}. Final score ${state.stats.score}.`);
  } else {
    state.phase = report ? 'report' : 'plan';
  }
  return { ok: true, report };
}

export function acknowledgeReport(state) {
  if (state.phase !== 'report') return { ok: false, msg: 'No report to close.' };
  state.phase = 'plan';
  return { ok: true };
}

// Validate a battle plan. gearIds: up to 2 items per slot. ringIds: up to maxWorn adventurer rings.
export function validatePlan(state, plan, cfg = CONFIG) {
  if (!state.roster || !state.roster.enemies[plan.enemyIndex]) return 'Pick an enemy.';
  const perSlot = {};
  for (const id of plan.gearIds) {
    const g = state.gear.find((x) => x.id === id);
    if (!g) return 'Unknown gear selected.';
    perSlot[g.slot] = (perSlot[g.slot] || 0) + 1;
    if (perSlot[g.slot] > 2) return `At most 2 items per slot (${g.slot}).`;
  }
  if (plan.ringIds.length > cfg.rings.maxWorn) return `At most ${cfg.rings.maxWorn} rings.`;
  for (const id of plan.ringIds) {
    const r = state.rings.find((x) => x.id === id);
    if (!r || ringDef(r.type, cfg).owner !== 'adventurer') return 'Only adventurer rings can be given to the adventurer.';
  }
  return null;
}

// Lock in tomorrow's fight and start the next day.
export function confirmPlan(state, plan, cfg = CONFIG) {
  if (state.phase !== 'plan') return { ok: false, msg: 'Not planning right now.' };
  const err = validatePlan(state, plan, cfg);
  if (err) return { ok: false, msg: err };
  const enemy = state.roster.enemies[plan.enemyIndex];
  for (const g of state.gear) g.packed = plan.gearIds.includes(g.id);
  for (const r of state.rings) if (ringDef(r.type, cfg).owner === 'adventurer') r.worn = plan.ringIds.includes(r.id);
  state.plan = { day: state.day + 1, enemy, gearIds: [...plan.gearIds], ringIds: [...plan.ringIds] };
  state.day += 1;
  state.time = cfg.time.dayStartMin;
  state.phase = 'work';
  state.report = null;
  state.stats.bestDay = Math.max(state.stats.bestDay, state.day);
  state.roster = generateRoster(rngFor(state), state.day + 1, cfg);
  const regrown = regrowFields(state, rngFor(state), cfg);
  if (regrown) addLog(state, `Overnight, ${regrown} searched cell(s) across the map regrew.`);
  const packed = state.gear.filter((g) => g.packed).map(gearName);
  addLog(state, `Day ${state.day}. The adventurer heads out to fight ${enemy.name} (${enemy.tier}) with ${packed.length ? packed.join(', ') : 'no gear'}.`);
  return { ok: true };
}

// Resolve today's planned fight. The adventurer sees the enemy's real attributes,
// picks the best packed gear (one per slot), then fights with the game's RNG.
export function resolveBattle(state, cfg = CONFIG) {
  const plan = state.plan;
  const e = plan.enemy;
  const enemyC = enemyCombatant(e.tier, e.day, e.levels, e.name, cfg);
  const packed = state.gear.filter((g) => plan.gearIds.includes(g.id));
  const rings = adventurerRingTotals(state, plan.ringIds, cfg);
  const combos = loadouts(packed);
  const pick = bestLoadout(combos, rings, enemyC, mixSeed(state.seed, state.day, 77), cfg.combat.bestGearFights, cfg);
  const used = combos[pick.index];
  const adv = adventurerCombatant(used, rings, cfg);
  const rng = rngFor(state);
  const result = fight(adv, enemyC, rng.next, true, cfg);
  state.stats.fights += 1;

  // durability loss on the items actually used
  const wear = [];
  for (const g of used) {
    const loss = rng.int(cfg.gear.durabilityLoss.min, cfg.gear.durabilityLoss.max);
    g.durability = Math.max(0, g.durability - loss);
    wear.push({ id: g.id, name: gearName(g), loss, left: g.durability });
  }
  const destroyed = state.gear.filter((g) => g.durability <= 0).map(gearName);
  state.gear = state.gear.filter((g) => g.durability > 0);
  for (const g of state.gear) g.packed = false;

  let ring = null;
  if (result.win) {
    ring = { id: state.nextId++, type: e.ring.type, grade: e.ring.grade, worn: false };
    state.rings.push(ring);
    state.stats.score += cfg.enemies.tiers[e.tier].score;
    state.stats.wins[e.tier] += 1;
  }
  const report = {
    day: state.day,
    enemy: { name: e.name, tier: e.tier, levels: e.levels },
    win: result.win,
    draw: result.draw,
    time: result.time,
    advHp: result.advHp,
    advMaxHp: adv.hp,
    enemyHp: result.enemyHp,
    enemyMaxHp: enemyC.hp,
    adv,
    enemyC,
    usedIds: used.map((g) => g.id),
    usedNames: used.map(gearName),
    wear,
    destroyed,
    ring: ring ? { ...ring } : null,
    ringText: ring ? ringLabel(ring, cfg) : null,
    // keep saves small: very long fights keep the first 1500 and last 500 lines
    log: result.log.length > 2000 ? [...result.log.slice(0, 1500), ...result.log.slice(-500)] : result.log,
    logTrimmed: result.log.length > 2000 ? result.log.length - 2000 : 0,
    packedIds: [...plan.gearIds],
    summary: result.summary,
  };
  state.battles.push(report);
  if (state.battles.length > MAX_BATTLES) state.battles.splice(0, state.battles.length - MAX_BATTLES);
  addLog(state, result.win
    ? `Victory over ${e.name} in ${result.time.toFixed(1)}s. Got ring: ${report.ringText}.`
    : result.draw
      ? `The fight with ${e.name} was called off after ${result.time.toFixed(1)}s: a draw (the adventurer survives, no ring).`
      : `The adventurer fell to ${e.name} after ${result.time.toFixed(1)}s.`);
  if (destroyed.length) addLog(state, `Destroyed (0% durability): ${destroyed.join(', ')}.`);
  state.plan = null;
  return report;
}

// Info the player can see about each roster enemy.
export function rosterView(state, cfg = CONFIG) {
  return state.roster.enemies.map((e, i) => ({ index: i, enemy: e, known: knownLevels(state, e, cfg) }));
}

// ------------------------------------------------------------- save/load ----
// v1.1 saves use a new key so an old cached v1.0 page can never overwrite them; v1.0 saves are read
// from the legacy key once and migrated.
export const SAVE_KEY = 'smithsy-save-v2';
export const LEGACY_SAVE_KEYS = ['smithsy-save-v1'];
export const BEST_KEY = 'smithsy-best-v1';

export function serialize(state) {
  return JSON.stringify(state);
}

export function deserialize(text) {
  const s = JSON.parse(text);
  if (!s || typeof s.version !== 'number') throw new Error('Incompatible save');
  if (s.version === 1) migrateV1(s);
  if (s.version !== SAVE_VERSION) throw new Error('Incompatible save');
  return s;
}

// v1.0 saves: per-cell ground items -> the field's pile; debris true/false -> thickness; no boulders.
export function migrateV1(s, cfg = CONFIG) {
  const mid = Math.round((cfg.field.debrisAmount.min + cfg.field.debrisAmount.max) / 2);
  for (const f of Object.values(s.map.fields)) {
    f.pile = f.pile || [];
    for (const c of f.cells) {
      if (Array.isArray(c.ground)) f.pile.push(...c.ground);
      delete c.ground;
      c.debris = c.debris === true ? mid : typeof c.debris === 'number' ? c.debris : 0;
      c.boulder = !!c.boulder;
    }
  }
  delete s.loadMark;
  s.version = 2;
  return s;
}

export function packedSlotsSummary(state) {
  return SLOTS.map((slot) => ({ slot, items: state.gear.filter((g) => g.packed && g.slot === slot) }));
}
