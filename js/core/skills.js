import { CONFIG, BARS, GEMS } from '../config.js';
import { cap } from './util.js';

// Skills (config: skills). Every skill has `effects` = { effect: amount per level }. Activity skills work for every
// material; per-material skills (one per bar type or gem type) only for their own material.

// XP a per-material skill gets for one bar refined / gem cut / bar smithed of that material.
export function itemXp(material, cfg = CONFIG) {
  const x = cfg.skills.xpPerItem;
  return typeof x === 'number' ? x : x[material] ?? 0;
}

// Build the flat skill list from config: the activity skills, then every per-material skill for each of its materials.
// { key, name, group: 'field' | 'workshop' | 'bars' | 'gems', material: bar / gem key or null, effects, xp (null =
//   itemXp of the material), xpUnit, label (per-material skills: the config key's label) }
export function skillDefs(cfg = CONFIG) {
  const s = cfg.skills;
  const defs = [];
  for (const [key, d] of Object.entries(s.activity)) {
    defs.push({ key, name: d.name, group: d.group, material: null, effects: d.effects, xp: d.xp ?? null, xpUnit: d.xpUnit, label: null });
  }
  for (const [prefix, d] of Object.entries(s.perMaterial)) {
    for (const mat of d.materials === 'bars' ? BARS : GEMS) {
      defs.push({ key: `${prefix}_${mat}`, name: `${cap(mat)} ${d.label}`, group: d.materials, material: mat, effects: d.effects, xp: d.xp ?? null, xpUnit: d.xpUnit, label: prefix });
    }
  }
  return defs;
}

export function skillDef(key, cfg = CONFIG) {
  return skillDefs(cfg).find((d) => d.key === key) || null;
}

export function newSkills(cfg = CONFIG) {
  const out = {};
  for (const d of skillDefs(cfg)) out[d.key] = { xp: 0, level: 0 };
  return out;
}

// XP needed to go from `level` to `level + 1`.
export function xpToNext(level, cfg = CONFIG) {
  return cfg.skills.xpBase * (level + 1);
}

// XP a skill earns per one of its xpUnit (its own `xp`, else the material's xpPerItem).
export function xpPerUnit(def, cfg = CONFIG) {
  return def.xp ?? itemXp(def.material, cfg);
}

// Adds XP; returns the number of levels gained. Pushes level-up messages into `notes` if given.
export function addXp(state, key, amount, notes, cfg = CONFIG) {
  const sk = state.skills[key];
  if (!sk || amount <= 0) return 0;
  const max = cfg.skills.maxLevel;
  if (sk.level >= max) return 0;
  sk.xp += amount;
  let gained = 0;
  while (sk.level < max && sk.xp >= xpToNext(sk.level, cfg)) {
    sk.xp -= xpToNext(sk.level, cfg);
    sk.level += 1;
    gained += 1;
  }
  if (sk.level >= max) sk.xp = 0;
  if (gained && notes) {
    const def = skillDef(key, cfg);
    notes.push(`Skill up: ${def ? def.name : key} is now level ${sk.level}.`);
  }
  return gained;
}

const levelOf = (state, key) => (state.skills[key] && state.skills[key].level) || 0;

// What a skill gives at its current level (or at `level`): { effect: amountPerLevel x level }.
export function skillEffects(state, key, cfg = CONFIG, level = levelOf(state, key)) {
  const def = skillDef(key, cfg);
  const out = {};
  if (def) for (const [e, per] of Object.entries(def.effects)) out[e] = per * level;
  return out;
}

// Every effect of every skill at its current level, added up:
//   { all: { effect: sum over the activity skills }, byMaterial: { material: { effect: sum over its own skills } } }
// One pass over the config, so smithBonuses() can ask for a dozen effects cheaply.
export function skillEffectTotals(state, cfg = CONFIG) {
  const s = cfg.skills;
  const all = {};
  const byMaterial = {};
  const add = (target, effects, level) => {
    if (level <= 0) return;
    for (const [e, per] of Object.entries(effects)) target[e] = (target[e] || 0) + per * level;
  };
  for (const [key, d] of Object.entries(s.activity)) add(all, d.effects, levelOf(state, key));
  for (const [prefix, d] of Object.entries(s.perMaterial)) {
    for (const mat of d.materials === 'bars' ? BARS : GEMS) add((byMaterial[mat] = byMaterial[mat] || {}), d.effects, levelOf(state, `${prefix}_${mat}`));
  }
  return { all, byMaterial };
}

// The total of one effect for `material` (null = a general effect): all activity skills with that effect, plus the
// material's own skills.
export function skillEffect(state, effect, material = null, cfg = CONFIG) {
  const t = skillEffectTotals(state, cfg);
  return (t.all[effect] || 0) + (material && t.byMaterial[material] ? t.byMaterial[material][effect] || 0 : 0);
}

// ---------------------------------------------------------------- hover text ----
const num2 = (v) => String(Math.round(v * 100) / 100);

// One effect at a value, in plain English: "3.6% less travel time", "0.3 points less refining failure chance".
// Two effects read differently: Carrying shows the resulting per-item penalty, cutting chances show the way to a
// master cutter.
export function effectText(effect, value, cfg = CONFIG, def = null) {
  const e = cfg.skills.effects[effect];
  if (effect === 'loadPenalty') {
    const base = cfg.map.loadPenaltyPerItem;
    return `each carried item adds ${num2(base * (1 - Math.min(100, value) / 100))}% travel time instead of ${num2(base)}%`;
  }
  if (effect === 'cutBlend') {
    const mine = def && def.material ? `${def.material} ` : '';
    return `better ${mine}cutting chances (${num2(Math.min(100, value))}% of the way to a master cutter's)`;
  }
  return `${num2(value)}${e.unit === 'pts' ? ' points' : '%'} ${e.text}`;
}

const effectsText = (effects, level, cfg, def) => Object.entries(effects).map(([e, per]) => effectText(e, per * level, cfg, def)).join('; ');

// What a skill gives right now, in plain English ("1.8% less travel time"), or null at level 0.
export function skillNowText(state, key, cfg = CONFIG) {
  const def = skillDef(key, cfg);
  const level = (state.skills[key] && state.skills[key].level) || 0;
  return def && level > 0 ? effectsText(def.effects, level, cfg, def) : null;
}

// Who the skill works for.
function scopeLine(def, cfg) {
  const a = cfg.skills.activity;
  const mat = def.material;
  if (mat) return def.label === 'smith' || def.label === 'repair' ? `Only for ${mat} gear.` : `Only for ${mat}.`;
  if (def.key === 'refineTime') return 'Works for every bar type; each bar type\'s own skills count far more.';
  if (def.key === 'cutTime') return 'Works for every gem type; each gem type\'s own skills count far more.';
  if (def.key === 'repairTime') {
    const times = cfg.skills.perMaterial.repair.effects.repairTime / a.repairTime.effects.repairTime;
    return `Works for all gear; each bar type's own Repair skill counts ${num2(times)} times as much.`;
  }
  return null;
}

// The text shown when you point at (or tap) a skill. No value for any other level than the current and next one.
//   <Name>: level <L>.
//   Now: <effects>.   (level 0: "No effect yet.")
//   Next level: <effects>.   (not at the maximum)
//   <who it works for>
//   XP: <xp> per <unit> (<xp now> / <xp needed> to level <L+1>).   (maximum: "Highest level reached.")
export function skillHoverText(state, key, cfg = CONFIG) {
  const def = skillDef(key, cfg);
  if (!def) return '';
  const sk = state.skills[key] || { xp: 0, level: 0 };
  const max = cfg.skills.maxLevel;
  const lines = [`${def.name}: level ${sk.level}.`];
  lines.push(sk.level > 0 ? `Now: ${effectsText(def.effects, sk.level, cfg, def)}.` : 'No effect yet.');
  if (sk.level < max) lines.push(`Next level: ${effectsText(def.effects, sk.level + 1, cfg, def)}.`);
  const scope = scopeLine(def, cfg);
  if (scope) lines.push(scope);
  const unit = `${num2(xpPerUnit(def, cfg))} per ${def.xpUnit}`;
  lines.push(sk.level < max ? `XP: ${unit} (${num2(sk.xp)} / ${xpToNext(sk.level, cfg)} to level ${sk.level + 1}).` : `XP: ${unit}. Highest level reached.`);
  return lines.join('\n');
}
