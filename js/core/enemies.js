import { CONFIG, TIERS, LEVELS } from '../config.js';
import { rollRing } from './rings.js';
import { intelValue, enemySightFor, ringGradeSightFor } from './intel.js';

export const ATTR_KEYS = Object.keys(CONFIG.enemies.attributes);

export function growth(day, cfg = CONFIG) {
  const g = cfg.enemies.growthPerDay;
  return { hpDamage: 1 + (g.hpDamage / 100) * (day - 1), ratings: 1 + (g.ratings / 100) * (day - 1) };
}

// Assign levels to the 12 attributes so the tier's low/normal/high counts are exact.
export function rollLevels(rng, tier, cfg = CONFIG) {
  const counts = cfg.enemies.tiers[tier].levels;
  const pool = [];
  for (const lv of LEVELS) for (let i = 0; i < counts[lv]; i++) pool.push(lv);
  const keys = Object.keys(cfg.enemies.attributes);
  if (pool.length !== keys.length) throw new Error(`Tier ${tier} levels must add up to ${keys.length}`);
  rng.shuffle(pool);
  return Object.fromEntries(keys.map((k, i) => [k, pool[i]]));
}

// One roster = the enemies available for the fight on `day`.
// Visibility rolls are stored (0..100) so spending intel later reveals more of the same roster. Every enemy also
// marches under one banner (config groups.list), random and not tied to its name; it has no effect on its attributes.
export function generateRoster(rng, day, cfg = CONFIG) {
  const enemies = [];
  for (const tier of TIERS) {
    const t = cfg.enemies.tiers[tier];
    const usedNames = new Set();
    for (let i = 0; i < t.count; i++) {
      let name = rng.pick(cfg.enemies.names[tier]);
      for (let tries = 0; usedNames.has(name) && tries < 10; tries++) name = rng.pick(cfg.enemies.names[tier]);
      usedNames.add(name);
      const levels = rollLevels(rng, tier, cfg);
      const sight = Object.fromEntries(Object.keys(levels).map((k) => [k, rng.float(0, 100)]));
      const ring = rollRing(rng, tier, cfg);
      const ringTypeRoll = rng.float(0, 100);
      const ringGradeRoll = rng.float(0, 100);
      const group = rng.pick(Object.keys(cfg.groups.list));
      const groupRoll = rng.float(0, 100);
      enemies.push({ tier, name, day, levels, sight, ring, ringTypeRoll, ringGradeRoll, group, groupRoll });
    }
  }
  return { day, enemies };
}

// An attribute is visible when its fixed roll is below the Enemy scouting chance that applies to the enemy's tier
// (normal 100%, elite 90%, champion 80% of the track's value).
export function attrVisible(state, enemy, attr, cfg = CONFIG) {
  return enemy.sight[attr] < enemySightFor(state, enemy.tier, cfg);
}

export function ringTypeVisible(state, enemy, cfg = CONFIG) {
  return enemy.ringTypeRoll < intelValue(state, 'ringTypeSight', cfg);
}

// The ring's grade is visible when its roll is below the Ring grade scouting chance that applies to that grade
// (better grades are harder to scout).
export function ringGradeVisible(state, enemy, cfg = CONFIG) {
  return !!enemy.ring && enemy.ringGradeRoll < ringGradeSightFor(state, enemy.ring.grade, cfg);
}

// The banner is visible when its roll is below the Banner scouting chance (the battle report always shows it).
export function groupVisible(state, enemy, cfg = CONFIG) {
  return enemy.groupRoll < intelValue(state, 'groupSight', cfg);
}

// What the player can work out about a ring grade that is still hidden: the odds of each grade GIVEN that it is hidden.
// A grade g was hidden with chance 1 - c x m_g (c = Ring grade scouting, m_g = its grade multiplier), so
// P(g) is proportional to weight_g x (1 - c x m_g), over the tier's grade weights. Returns { grade: percent } adding
// up to 100, in the weights' order (low grade first); better grades gain share as the scouting chance rises.
export function hiddenGradeOdds(state, enemy, cfg = CONFIG) {
  const weights = cfg.rings.gradeWeights[enemy.tier];
  const t = cfg.intel.tracks.ringGradeSight;
  const c = intelValue(state, 'ringGradeSight', cfg);
  const raw = Object.fromEntries(Object.entries(weights).map(([g, w]) => {
    const seen = Math.min(100, (c * ((t.gradeMult && t.gradeMult[g]) ?? 100)) / 100);
    return [g, w * (1 - seen / 100)];
  }));
  let total = Object.values(raw).reduce((a, b) => a + b, 0);
  const src = total > 0 ? raw : weights; // every grade surely seen (cannot happen below the track's max): fall back to the plain odds
  total = Object.values(src).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(src).map(([g, v]) => [g, (v / total) * 100]));
}

// Known attribute levels (others undefined) as the player sees them.
export function knownLevels(state, enemy, cfg = CONFIG) {
  const out = {};
  for (const k of Object.keys(enemy.levels)) if (attrVisible(state, enemy, k, cfg)) out[k] = enemy.levels[k];
  return out;
}

// Fill unknown attributes randomly, consistent with the tier's exact low/normal/high counts.
export function sampleLevels(rng, tier, known, cfg = CONFIG) {
  const counts = { ...cfg.enemies.tiers[tier].levels };
  for (const lv of Object.values(known)) counts[lv] -= 1;
  const pool = [];
  for (const lv of LEVELS) for (let i = 0; i < Math.max(0, counts[lv]); i++) pool.push(lv);
  rng.shuffle(pool);
  const out = { ...known };
  let i = 0;
  for (const k of Object.keys(cfg.enemies.attributes)) if (!(k in out)) out[k] = pool[i++] ?? 'normal';
  return out;
}

// Base numbers shown for every enemy (before the HP attribute).
export function enemyBase(tier, day, cfg = CONFIG) {
  const t = cfg.enemies.tiers[tier];
  const g = growth(day, cfg);
  return { hp: t.hp * g.hpDamage, damage: t.damage * g.hpDamage, defense: t.defense, ratingMult: g.ratings };
}

// Combat stats for an enemy with the given attribute levels.
export function enemyCombatant(tier, day, levels, name = 'Enemy', cfg = CONFIG) {
  const A = cfg.enemies.attributes;
  const v = (k) => A[k].values[levels[k]];
  const base = enemyBase(tier, day, cfg);
  return {
    name,
    hp: base.hp * (v('hp') / 100),
    damage: base.damage,
    interval: cfg.enemies.attackInterval,
    speed: v('fast'),
    accuracy: v('accurate') * base.ratingMult,
    dodge: v('evasion') * base.ratingMult,
    defense: base.defense,
    magicPct: v('magical'),
    magicRes: v('magicRes'),
    pierce: v('piercing'),
    pierceRes: v('pierceRes'),
    stunChance: v('stunning'),
    stunDur: cfg.enemies.stunDuration,
    stunChanceRed: v('stunRes'),
    stunDurRed: v('stunRes'),
    slowPct: v('chilling'),
    slowDur: cfg.enemies.slowDuration,
    slowRed: v('slowRes'),
    slowDurRed: v('slowRes'),
  };
}
