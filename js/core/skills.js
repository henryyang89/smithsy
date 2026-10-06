import { CONFIG, BARS, GEMS } from '../config.js';
import { cap } from './util.js';

// XP a per-material skill gets for one bar refined / gem cut of that material.
export function itemXp(material, cfg = CONFIG) {
  const x = cfg.skills.xpPerItem;
  return typeof x === 'number' ? x : x[material] ?? 0;
}

// Build the flat skill list from config: activity skills + one skill per material.
export function skillDefs(cfg = CONFIG) {
  const s = cfg.skills;
  const defs = [];
  for (const [key, d] of Object.entries(s.activity)) {
    defs.push({ key, name: d.name, perLevel: d.perLevel, desc: d.desc, xpFrom: d.xpFrom, group: 'activity' });
  }
  for (const bar of BARS) {
    defs.push({ key: `oreGrade_${bar}`, name: `${cap(bar)} bar grade`, perLevel: s.perMaterial.oreGrade.perLevel, desc: s.perMaterial.oreGrade.desc, xpFrom: `${itemXp(bar, cfg)} XP per ${bar} bar refined`, group: 'ore' });
  }
  for (const bar of BARS) {
    defs.push({ key: `oreFail_${bar}`, name: `${cap(bar)} refining`, perLevel: s.perMaterial.oreFail.perLevel, desc: s.perMaterial.oreFail.desc, xpFrom: `${itemXp(bar, cfg)} XP per ${bar} bar refined`, group: 'ore' });
  }
  for (const gem of GEMS) {
    defs.push({ key: `gemGrade_${gem}`, name: `${cap(gem)} grade`, perLevel: s.perMaterial.gemGrade.perLevel, desc: s.perMaterial.gemGrade.desc, xpFrom: `${itemXp(gem, cfg)} XP per ${gem} cut`, group: 'gem' });
  }
  for (const gem of GEMS) {
    defs.push({ key: `gemFail_${gem}`, name: `${cap(gem)} cutting`, perLevel: s.perMaterial.gemFail.perLevel, desc: s.perMaterial.gemFail.desc, xpFrom: `${itemXp(gem, cfg)} XP per ${gem} cut`, group: 'gem' });
  }
  return defs;
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
    const def = skillDefs(cfg).find((d) => d.key === key);
    notes.push(`Skill up: ${def ? def.name : key} is now level ${sk.level}.`);
  }
  return gained;
}

// Current bonus from a skill (perLevel x level), in the skill's unit.
export function skillBonus(state, key, cfg = CONFIG) {
  const sk = state.skills[key];
  if (!sk) return 0;
  const def = skillDefs(cfg).find((d) => d.key === key);
  return def ? def.perLevel * sk.level : 0;
}
