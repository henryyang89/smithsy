// Display helpers that need no DOM (so tests and tools can use them). Each turns game numbers into the text the
// player reads; the game itself keeps its own, more exact numbers.
import { CONFIG } from '../config.js';
import { shownDurability, GEM_MATCH } from '../core/gear.js';
import { knownLevels } from '../core/enemies.js';
import { simCounts, shownMargin } from '../core/sim.js';

// Durability as the player reads it: a whole number ("63%"), never a decimal. Costs and times use the exact value.
export const durText = (d) => `${shownDurability(d)}%`;

// What a repair adds, as shown on the Repair button: the gap between the SHOWN durability and 100, so the shown
// durability plus the shown gain always add up to 100.
export const repairGainShown = (d) => 100 - shownDurability(d);

// A win chance in whole percent: "62%".
export const winText = (v) => `${Math.round(v)}%`;

// Item or ring ids as one sortable string: "3,7,12".
export const sortedIds = (ids) => [...ids].sort((a, b) => a - b).join(',');

// The cache key of one enemy's win estimate: everything that can change the result, and nothing else. That is the
// game and roster (seed, roster day), the enemy, the packed gear and worn rings (ids), what the player can see of the
// enemy (the visible attribute levels: the estimate guesses the rest) and the size of the simulation (guesses, test
// fights, fights per gear combination). The enemy the player has clicked on is not part of it: picking another
// column changes nothing about any estimate.
// scope = { gearIds, ringIds } (a plan selection, or the Adventurer tab's default pack). counts = simCounts(state).
export function estimateKey(state, scope, enemyIndex, cfg = CONFIG, counts = simCounts(state, cfg)) {
  const known = knownLevels(state, state.roster.enemies[enemyIndex], cfg);
  const knownSig = Object.keys(known).sort().map((k) => `${k}:${known[k]}`).join(',');
  return [state.seed, state.roster.day, enemyIndex, sortedIds(scope.gearIds), sortedIds(scope.ringIds), knownSig,
    counts.samples, counts.evalFights, counts.fightsPerLoadout].join('|');
}

// "62% ± 14 from 25 test fights (could be 48-76%; hidden attributes add more)." for the hover on an estimate.
export function estimateTip(res) {
  const m = shownMargin(res);
  if (m == null) return `${winText(res.winPct)} from ${res.fights} test fights.`;
  const lo = Math.max(0, Math.round(res.winPct - m));
  const hi = Math.min(100, Math.round(res.winPct + m));
  return `${winText(res.winPct)} ± ${m} from ${res.fights} test fights (could be ${lo}-${hi}%; hidden attributes add more).`;
}

// "62% ± 14" (or just "62%" when the estimate has no fights to measure a margin from).
export const winWithMargin = (res) => (shownMargin(res) != null ? `${winText(res.winPct)} ± ${shownMargin(res)}` : winText(res.winPct));

// Colour class of a win chance: 90 and up ok, 70 and up warn, else err.
export const winClass = (p) => (p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'err');

// "Your answers" to the chosen enemy: for every High special you can SEE, whether the packed armor has the gem that
// answers it (ruby for Magical, diamond for Piercing, topaz for Stunning, sapphire for Chilling, emerald for Accurate).
// packed = the packed gear items, known = the visible attribute levels.
// Returns [{ gem, special (its name), ok, item ('ruby chest' or null) }] in the gems' order.
export function gearAnswers(packed, known, cfg = CONFIG) {
  const out = [];
  for (const [gem, [special]] of Object.entries(GEM_MATCH)) {
    if (known[special] !== 'high') continue;
    const armor = packed.find((g) => g.slot !== 'sword' && g.gem && g.gem.type === gem);
    out.push({ gem, special: cfg.enemies.attributes[special].name, ok: !!armor, item: armor ? `${gem} ${armor.slot}` : null });
  }
  return out;
}
