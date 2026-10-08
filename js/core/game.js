// Game state, day flow, battle resolution, save/load.
// UI and tools call these functions; each action returns { ok, msg, ... }.
import { CONFIG, ORES, GEMS, BARS, GRADES, SLOTS } from '../config.js';
import { rngFor, mixSeed } from './rng.js';
import { generateMap, atCamp } from './map.js';
import { newSkills, skillDefs, addXp } from './skills.js';
import { newIntel, canSpendIntel } from './intel.js';
import { newGroups, recordDefeat, groupRewardText } from './groups.js';
import { packLimit, slotNoun } from './pack.js';
import { smithBonuses } from './bonuses.js';
import { generateRoster, enemyCombatant, knownLevels } from './enemies.js';
import { ringTotals, ringDef, wornRings, ringLabel } from './rings.js';
import { adventurerCombatant, fight } from './combat.js';
import { searchLoadout, loadoutEval } from './sim.js';
import { gearName, wearLoss, wornDurability } from './gear.js';
import { formatClock } from './util.js';
import { VERSION } from '../version.js';

export const MAX_LOG = 300;
export const MAX_BATTLES = 20;

export function newGame(seed = (Math.random() * 2 ** 32) >>> 0, cfg = CONFIG) {
  const state = {
    version: VERSION,
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
    groups: newGroups(cfg), // banners beaten and the pack mules they paid: { defeats, extra, earned }
    roster: null, // enemies for tomorrow's fight
    plan: null, // today's fight (adventurer is away): { day, enemy, gearIds, ringIds, shownEstimate }
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

// Validate a battle plan. gearIds: up to packLimit items per gear type (2, plus pack mules). ringIds: up to maxWorn
// adventurer rings.
export function validatePlan(state, plan, cfg = CONFIG) {
  if (!state.roster || !state.roster.enemies[plan.enemyIndex]) return 'Pick an enemy.';
  const perSlot = {};
  for (const id of plan.gearIds) {
    const g = state.gear.find((x) => x.id === id);
    if (!g) return 'Unknown gear selected.';
    perSlot[g.slot] = (perSlot[g.slot] || 0) + 1;
    const limit = packLimit(state, g.slot, cfg);
    if (perSlot[g.slot] > limit) return `At most ${limit} ${slotNoun(g.slot, limit)}.`;
  }
  if (plan.ringIds.length > cfg.rings.maxWorn) return `At most ${cfg.rings.maxWorn} rings.`;
  for (const id of plan.ringIds) {
    const r = state.rings.find((x) => x.id === id);
    if (!r || ringDef(r.type, cfg).owner !== 'adventurer') return 'Only adventurer rings can be given to the adventurer.';
  }
  return null;
}

// A win estimate the plan screen showed, as the plan keeps it: { winPct, margin } (margin may be null), or null.
function cleanEstimate(e) {
  if (!e || !Number.isFinite(e.winPct)) return null;
  return { winPct: e.winPct, margin: Number.isFinite(e.margin) ? e.margin : null };
}

// Lock in tomorrow's fight and start the next day. An intel point that can still be spent must be spent first.
// plan.shownEstimate = { winPct, margin } is the win estimate the screen showed for this enemy (null if it was not
// finished); it goes to the battle report as report.planEstimate.
export function confirmPlan(state, plan, cfg = CONFIG) {
  if (state.phase !== 'plan') return { ok: false, msg: 'Not planning right now.' };
  if (canSpendIntel(state, cfg)) return { ok: false, msg: 'Spend your intel point first (Intel, at the top of this screen).' };
  const err = validatePlan(state, plan, cfg);
  if (err) return { ok: false, msg: err };
  const enemy = state.roster.enemies[plan.enemyIndex];
  for (const g of state.gear) g.packed = plan.gearIds.includes(g.id);
  for (const r of state.rings) if (ringDef(r.type, cfg).owner === 'adventurer') r.worn = plan.ringIds.includes(r.id);
  state.plan = { day: state.day + 1, enemy, gearIds: [...plan.gearIds], ringIds: [...plan.ringIds], shownEstimate: cleanEstimate(plan.shownEstimate) };
  state.day += 1;
  state.time = cfg.time.dayStartMin;
  state.phase = 'work';
  state.report = null;
  state.stats.bestDay = Math.max(state.stats.bestDay, state.day);
  state.roster = generateRoster(rngFor(state), state.day + 1, cfg);
  const packed = state.gear.filter((g) => g.packed).map(gearName);
  addLog(state, `Day ${state.day}. The adventurer heads out to fight ${enemy.name} (${enemy.tier}) with ${packed.length ? packed.join(', ') : 'no gear'}.`);
  return { ok: true };
}

// A gear item as the report keeps it: what it was and how worn it was BEFORE the fight.
export function gearSnapshot(g) {
  return { id: g.id, slot: g.slot, material: g.material, grade: g.grade, gem: g.gem ? { type: g.gem.type, grade: g.gem.grade } : null, durability: g.durability };
}

// Resolve today's planned fight. The adventurer sees the enemy's real attributes,
// picks the best packed gear (one per slot: searchLoadout, bestGearFights fights per combination tried),
// then fights with the game's RNG. Wear is applied after the fight, so every item lasts the whole fight.
export function resolveBattle(state, cfg = CONFIG) {
  const plan = state.plan;
  const e = plan.enemy;
  const enemyC = enemyCombatant(e.tier, e.day, e.levels, e.name, cfg);
  const packed = state.gear.filter((g) => plan.gearIds.includes(g.id));
  const rings = adventurerRingTotals(state, plan.ringIds, cfg);
  const pick = searchLoadout(packed, loadoutEval(rings, enemyC, mixSeed(state.seed, state.day, 77), cfg.combat.bestGearFights, cfg), cfg);
  const used = pick.items;
  // snapshots from before the wear: what was used, and what was packed but not used (both in SLOTS order)
  const usedSnap = used.map(gearSnapshot);
  const notUsedSnap = SLOTS.flatMap((slot) => packed.filter((g) => g.slot === slot && !used.includes(g))).map(gearSnapshot);
  const adv = adventurerCombatant(used, rings, cfg);
  const rng = rngFor(state);
  const result = fight(adv, enemyC, rng.next, true, cfg);
  state.stats.fights += 1;

  // durability loss on the items actually used: roll x enemy tier multiplier x (1 - Gear care %), to one decimal
  const dl = cfg.gear.durabilityLoss;
  const tierMult = (dl.tierMult && dl.tierMult[e.tier]) || 1;
  const skillRed = Math.min(100, smithBonuses(state, cfg).gearCarePct); // % less loss from the Gear care skill
  const wear = [];
  for (const g of used) {
    const base = rng.int(dl.min, dl.max);
    const loss = wearLoss(base, tierMult, skillRed);
    g.durability = wornDurability(g.durability, loss);
    wear.push({ id: g.id, name: gearName(g), loss, base, tierMult, skillRed, left: g.durability });
  }
  // Gear care XP for every fight the adventurer survives (win or draw)
  const notes = [];
  if (result.win || result.draw) addXp(state, 'gearCare', cfg.skills.activity.gearCare.xp, notes, cfg);
  const destroyed = state.gear.filter((g) => g.durability <= 0).map(gearName);
  state.gear = state.gear.filter((g) => g.durability > 0);
  for (const g of state.gear) g.packed = false;

  let ring = null;
  let groupReward = null; // the gear type that won a pack mule with this win
  if (result.win) {
    ring = { id: state.nextId++, type: e.ring.type, grade: e.ring.grade, worn: false };
    state.rings.push(ring);
    state.stats.score += cfg.enemies.tiers[e.tier].score;
    state.stats.wins[e.tier] += 1;
    groupReward = recordDefeat(state, e, rng, cfg).reward;
  }
  const report = {
    day: state.day,
    enemy: { name: e.name, tier: e.tier, levels: e.levels, group: e.group || null },
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
    used: usedSnap, // snapshots of the gear used and of the packed gear that was not (durability before the fight)
    notUsed: notUsedSnap,
    ringTotals: { ...rings }, // the adventurer's ring totals in this fight
    loadoutsTried: pick.evaluated, // gear combinations the adventurer thought through
    planEstimate: plan.shownEstimate || null, // the win estimate the plan screen showed: { winPct, margin }, or null
    groupReward, // gear type that got a pack mule from this win (config groups), else null
    groupDefeats: groupReward && e.group ? state.groups.defeats[e.group] : null, // that banner's defeats after this win
    groupLimit: groupReward ? packLimit(state, groupReward, cfg) : null, // how many of that type the adventurer can pack now
    analysis: null, // the loss analysis (computed on the run summary screen when needed)
    wear,
    notes,
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
  if (groupReward) addLog(state, groupRewardText(report, cfg));
  for (const n of notes) addLog(state, n);
  state.plan = null;
  return report;
}

// Info the player can see about each roster enemy.
export function rosterView(state, cfg = CONFIG) {
  return state.roster.enemies.map((e, i) => ({ index: i, enemy: e, known: knownLevels(state, e, cfg) }));
}

// ------------------------------------------------------------- save/load ----
// Saves are per version: a save is only loaded by the game version that wrote it (state.version === VERSION).
// Bumping VERSION starts every player fresh and leaves the older version's save untouched in the browser, so
// going back to that version still finds it. Other versions' saves are never read, converted or deleted.
export const saveKeyFor = (v) => `smithsy-save-${v}`;
export const SAVE_KEY = saveKeyFor(VERSION); // 'smithsy-save-2.0'
export const BEST_KEY = `smithsy-best-${VERSION}`; // 'smithsy-best-2.0'

// The storage keys of saves written by other versions (only used to word a one-time start-up note; they are
// never read). Crash backups ('smithsy-save-backup-<time>') are not saves of another version.
export function oldSaveKeys(keys, current = SAVE_KEY) {
  return [...keys].filter((k) => /^smithsy-save-/.test(k) && k !== current && !k.startsWith('smithsy-save-backup-'));
}

export function serialize(state) {
  return JSON.stringify(state);
}

// Reads a save of THIS version only. Throws for anything else (another version, junk, a save whose shape
// does not match the config).
export function deserialize(text, cfg = CONFIG) {
  const s = JSON.parse(text);
  if (!s || typeof s !== 'object' || s.version !== VERSION) throw new Error('Incompatible save');
  assertShape(s, cfg);
  return s;
}

// A same-version save must list exactly the config's skills, intel tracks and banners. Only a developer who changed
// the config without bumping VERSION can ever trip this: it is a safety net, not a migration.
function assertShape(s, cfg) {
  const sameKeys = (obj, want, what) => {
    if (!obj || typeof obj !== 'object') throw new Error(`Save is missing ${what}`);
    const have = Object.keys(obj).sort().join(',');
    if (have !== [...want].sort().join(',')) throw new Error(`Save ${what} do not match the config`);
  };
  sameKeys(s.skills, skillDefs(cfg).map((d) => d.key), 'skills');
  sameKeys(s.intel && s.intel.spent, Object.keys(cfg.intel.tracks), 'intel tracks');
  sameKeys(s.groups && s.groups.defeats, Object.keys(cfg.groups.list), 'banners');
  sameKeys(s.groups && s.groups.extra, SLOTS, 'pack mule slots');
}

export function packedSlotsSummary(state) {
  return SLOTS.map((slot) => ({ slot, items: state.gear.filter((g) => g.packed && g.slot === slot) }));
}
