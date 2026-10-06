import { CONFIG, TIERS, LEVELS } from '../config.js';
import { rollRing } from './rings.js';
import { intelChance } from './intel.js';

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
// Visibility rolls are stored (0..100) so spending intel later reveals more of the same roster.
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
      enemies.push({ tier, name, day, levels, sight, ring: rollRing(rng, tier, cfg), ringTypeRoll: rng.float(0, 100), ringGradeRoll: rng.float(0, 100) });
    }
  }
  return { day, enemies };
}

export function attrVisible(state, enemy, attr, cfg = CONFIG) {
  return enemy.sight[attr] < intelChance(state, 'enemySight', cfg);
}

export function ringTypeVisible(state, enemy, cfg = CONFIG) {
  return enemy.ringTypeRoll < intelChance(state, 'ringTypeSight', cfg);
}

export function ringGradeVisible(state, enemy, cfg = CONFIG) {
  return enemy.ringGradeRoll < intelChance(state, 'ringGradeSight', cfg);
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
