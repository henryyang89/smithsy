import { CONFIG, GRADES, SLOTS } from '../config.js';
import { round1, round2, EPS, cap, qtyText, formatDuration } from './util.js';
import { smithBonuses } from './bonuses.js';
import { addXp, skillDef, xpPerUnit } from './skills.js';

// Final stats for one gear item, including its gem infusion.
export function gearStats(item, cfg = CONFIG) {
  const slot = cfg.gear.slots[item.slot];
  const mult = cfg.gear.materialMult[item.material] * cfg.gear.gradeMult[item.grade];
  const stats = {};
  for (const [k, v] of Object.entries(slot.stats)) stats[k] = v * mult;
  if (item.gem) {
    const gi = GRADES.indexOf(item.gem.grade);
    const fx = cfg.gemEffects[item.gem.type];
    if (item.slot === 'sword') {
      for (const [k, arr] of Object.entries(fx.weapon)) stats[k] = (stats[k] || 0) + arr[gi];
    } else {
      const m = cfg.gear.gemArmorMult[item.slot];
      for (const [k, arr] of Object.entries(fx.armor)) stats[k] = (stats[k] || 0) + arr[gi] * m;
    }
  }
  return stats;
}

// Rough strength of an item: material multiplier x grade multiplier (ignores gems).
export const gearPower = (item, cfg = CONFIG) => cfg.gear.materialMult[item.material] * cfg.gear.gradeMult[item.grade];

export const STAT_LABELS = {
  damage: 'Damage',
  accuracy: 'Accuracy',
  defense: 'Defense %',
  dodge: 'Dodge',
  speed: 'Speed %',
  magicPct: 'Magic dmg % of weapon',
  magicRes: 'Magic resist %',
  stunChance: 'Stun chance %',
  stunDur: 'Stun duration s',
  stunChanceRed: 'Stun chance reduction %',
  stunDurRed: 'Stun duration reduction %',
  slowPct: 'Slow %',
  slowDur: 'Slow duration s',
  slowRed: 'Slow reduction %',
  slowDurRed: 'Slow duration reduction %',
  pierce: 'Piercing %',
  pierceRes: 'Pierce resistance %',
};

// Plain names and units for running text: "Defense 10.8%", "Stun duration 1s".
export const STAT_NAMES = {
  damage: ['Damage', ''],
  accuracy: ['Accuracy', ''],
  defense: ['Defense', '%'],
  dodge: ['Dodge', ''],
  speed: ['Speed', '%'],
  magicPct: ['Magic damage', '% of weapon'],
  magicRes: ['Magic resist', '%'],
  stunChance: ['Stun chance', '%'],
  stunDur: ['Stun duration', 's'],
  stunChanceRed: ['Stun chance reduction', '%'],
  stunDurRed: ['Stun duration reduction', '%'],
  slowPct: ['Slow', '%'],
  slowDur: ['Slow duration', 's'],
  slowRed: ['Slow reduction', '%'],
  slowDurRed: ['Slow duration reduction', '%'],
  pierce: ['Piercing', '%'],
  pierceRes: ['Pierce resistance', '%'],
};

export function fmtStat(k, v) {
  const [name, unit] = STAT_NAMES[k] || [k, ''];
  return `${name} ${round1(v)}${unit}`;
}

export function statsText(stats) {
  return Object.entries(stats)
    .map(([k, v]) => fmtStat(k, v))
    .join(', ');
}

export function gearName(item) {
  const gem = item.gem ? ` +${cap(item.gem.type)} ${item.gem.grade}` : '';
  return `${item.grade} ${cap(item.material)} ${cap(item.slot)}${gem}`;
}

export function barKey(material, grade) {
  return `${material}:${grade}`;
}

// Base smithing time of a new item (before skills).
export function craftMinutes(slot, hasGem, cfg = CONFIG) {
  return cfg.gear.slots[slot].bars * cfg.gear.smithMinPerBar + (hasGem ? cfg.gear.infuseMin : 0);
}

// Smithing time after the bar type's Smithing skill (the cut is capped by processing.maxTimeReduction).
export function smithMinutes(state, slot, material, hasGem, cfg = CONFIG) {
  const pct = Math.min(cfg.processing.maxTimeReduction, smithBonuses(state, cfg).smithTimePct(material));
  return round1(craftMinutes(slot, hasGem, cfg) * (1 - pct / 100));
}

// Material cost to craft (whole bars, 1 gem).
export function craftCost(spec, cfg = CONFIG) {
  const bars = { [barKey(spec.material, spec.grade)]: cfg.gear.slots[spec.slot].bars };
  const gems = spec.gem ? { [`${spec.gem.type}:${spec.gem.grade}`]: 1 } : {};
  return { bars, gems };
}

function has(storage, key, n) {
  return (storage[key] || 0) + EPS >= n;
}

function take(storage, key, n) {
  storage[key] = round2((storage[key] || 0) - n);
  if (Math.abs(storage[key]) < EPS) storage[key] = 0;
}

function campWork(state) {
  if (state.phase !== 'work') return 'Not during the work day.';
  if (state.location.x !== state.map.camp.x || state.location.y !== state.map.camp.y) return 'You must be at camp.';
  return null;
}

export function canCraft(state, spec, cfg = CONFIG) {
  if (!SLOTS.includes(spec.slot)) return 'Unknown slot.';
  const { bars, gems } = craftCost(spec, cfg);
  for (const [k, n] of Object.entries(bars)) if (!has(state.storage.bars, k, n)) return `Need ${n} ${k.replace(':', ' ')} bars.`;
  for (const [k, n] of Object.entries(gems)) if (!has(state.storage.cut, k, n)) return `Need a cut ${k.replace(':', ' ')}.`;
  return null;
}

export function craft(state, spec, cfg = CONFIG) {
  const err = campWork(state) || canCraft(state, spec, cfg);
  if (err) return { ok: false, msg: err };
  const minutes = smithMinutes(state, spec.slot, spec.material, !!spec.gem, cfg);
  if (state.time + minutes > cfg.time.dayEndMin + EPS) return { ok: false, msg: 'Not enough time left today.' };
  const { bars, gems } = craftCost(spec, cfg);
  for (const [k, n] of Object.entries(bars)) take(state.storage.bars, k, n);
  for (const [k, n] of Object.entries(gems)) take(state.storage.cut, k, n);
  const item = {
    id: state.nextId++,
    slot: spec.slot,
    material: spec.material,
    grade: spec.grade,
    gem: spec.gem ? { type: spec.gem.type, grade: spec.gem.grade } : null,
    durability: 100,
    packed: false,
  };
  state.gear.push(item);
  state.time += minutes;
  const notes = [];
  const smithKey = `smith_${spec.material}`;
  addXp(state, smithKey, cfg.gear.slots[spec.slot].bars * xpPerUnit(skillDef(smithKey, cfg), cfg), notes, cfg);
  return { ok: true, item, minutes, notes, msg: `Crafted ${gearName(item)} (${minutes}m).` };
}

// Durability one used item loses in one fight: the roll x the enemy tier's multiplier x (1 - Gear care %),
// kept to one decimal (so every Gear care level changes the loss), at least 1. Shared by resolveBattle
// (core/game.js) and the UI's wear ranges so they can never disagree.
export function wearLoss(base, tierMult = 1, carePct = 0) {
  const red = Math.min(100, Math.max(0, carePct));
  return Math.max(1, Math.round(base * tierMult * (1 - red / 100) * 10) / 10);
}

// Durability after losing `loss`, kept to one decimal (no float drift) and never below 0.
export function wornDurability(durability, loss) {
  return Math.max(0, Math.round((durability - loss) * 10) / 10);
}

// Durability as the player sees it: a whole number, rounded down, at least 1 while the item exists, and 100 only when
// it is full. The game keeps one decimal inside; costs and times always use that value, never this one.
export function shownDurability(d) {
  return d >= 100 ? 100 : d <= 0 ? 0 : Math.max(1, Math.floor(d + 1e-9));
}

// The most durability one fight can take from a used item against `tier` (null = the toughest tier): the highest
// roll through the same wearLoss() the fight uses, with the Gear care skill.
export function worstWear(state, tier, cfg = CONFIG) {
  const dl = cfg.gear.durabilityLoss;
  const tm = dl.tierMult || {};
  const all = Object.values(tm);
  const mult = tier ? tm[tier] || 1 : all.length ? Math.max(...all) : 1;
  return wearLoss(dl.max, mult, smithBonuses(state, cfg).gearCarePct);
}

// True when a fight against `tier` (null = the toughest) could take the item to 0%, so it is destroyed after the
// fight. It always lasts the whole fight: wear is applied afterwards.
export function couldBreak(item, state, tier, cfg = CONFIG) {
  return worstWear(state, tier, cfg) >= item.durability - 1e-9;
}

// The same flag as the player reads it, in whole numbers: durability rounded down, the worst wear rounded up (the numbers
// the flag text and the wear tooltips print). An item that shows no more than the wear a fight can take is always flagged,
// so the screen never contradicts itself; it is a little stricter than couldBreak (the decimals decide what really breaks),
// so an item can show the flag and still survive by a fraction. Used by the screens' warnings and the plan's confirm.
export function couldBreakShown(item, state, tier, cfg = CONFIG) {
  return shownDurability(item.durability) <= Math.ceil(worstWear(state, tier, cfg) - 1e-9);
}

// Which enemy attributes a gem is about: [the offensive special its ARMOR answers, the resistance that blunts its
// SWORD]. Structural (a rule of the game, not a number), so it lives in code.
export const GEM_MATCH = {
  ruby: ['magical', 'magicRes'],
  diamond: ['piercing', 'pierceRes'],
  topaz: ['stunning', 'stunRes'],
  sapphire: ['chilling', 'slowRes'],
  emerald: ['accurate', 'evasion'],
};

// Short notes about how an item's gem fits an enemy, from the attributes the player can see only (`known` = visible
// attribute -> level; `enemy` is the enemy being looked at and is not read, so nothing hidden can leak):
//   armor whose gem answers a visible High special: { kind: 'ok', text: 'answers High Magical' }
//   sword whose gem is blunted by a visible High resistance: { kind: 'warn', text: 'blunted by High Magic resistance' }
export function gearMatchNotes(item, enemy, known = {}, cfg = CONFIG) {
  const notes = [];
  if (!item.gem || !GEM_MATCH[item.gem.type]) return notes;
  const [special, resist] = GEM_MATCH[item.gem.type];
  const A = cfg.enemies.attributes;
  if (item.slot === 'sword') {
    if (known[resist] === 'high') notes.push({ kind: 'warn', text: `blunted by High ${A[resist].name}` });
  } else if (known[special] === 'high') {
    notes.push({ kind: 'ok', text: `answers High ${A[special].name}` });
  }
  return notes;
}

// Round up to 0.01 (tiny tolerance for float noise). Math.max avoids returning -0 for a 0 amount.
const ceil2 = (v) => Math.max(0, Math.ceil(v * 100 - 1e-7) / 100);

// Cost and base time to repair an item back to 100% (no skills): the missing % of 35% of the bars (and of the gem),
// and the same share of the smithing time. repairMinutes() applies the repair skills.
export function repairInfo(item, cfg = CONFIG) {
  const r = cfg.gear.repair;
  const missing = 100 - item.durability;
  const frac = missing / 100;
  const bars = { [barKey(item.material, item.grade)]: ceil2(cfg.gear.slots[item.slot].bars * (r.materialFraction / 100) * frac) };
  const gems = item.gem ? { [`${item.gem.type}:${item.gem.grade}`]: ceil2((r.gemFraction / 100) * frac) } : {};
  const baseMinutes = round1(craftMinutes(item.slot, !!item.gem, cfg) * (r.timeFraction / 100) * frac);
  return { missing, bars, gems, baseMinutes };
}

// Repair time after the repair skills (3 x Repair + 1 x General repair + 0.5 x Smithing per level), capped.
export function repairMinutes(state, item, cfg = CONFIG) {
  const pct = Math.min(cfg.processing.maxTimeReduction, smithBonuses(state, cfg).repairTimePct(item.material));
  return round1(repairInfo(item, cfg).baseMinutes * (1 - pct / 100));
}

// Which stock a repair will actually use: the exact grade if there is enough, otherwise the lowest
// higher grade that has enough (no benefit from the higher grade). Returns
// { ok, reason, bars, gems, substitutes: [{ kind, need, use, qty }], minutes, missing }.
export function repairPlan(state, item, cfg = CONFIG) {
  const info = repairInfo(item, cfg);
  const pick = (storage, type, grade, qty) => {
    const gi = GRADES.indexOf(grade);
    for (let i = gi; i < GRADES.length; i++) {
      const k = `${type}:${GRADES[i]}`;
      if (has(storage, k, qty)) return GRADES[i];
    }
    return null;
  };
  const out = { ok: true, reason: null, bars: {}, gems: {}, substitutes: [], minutes: repairMinutes(state, item, cfg), missing: info.missing };
  const barQty = Object.values(info.bars)[0] || 0;
  if (barQty > 0) {
    const g = pick(state.storage.bars, item.material, item.grade, barQty);
    if (!g) {
      out.ok = false;
      out.reason = `Need ${barQty} ${item.material} bars of grade ${item.grade} or higher.`;
    } else {
      out.bars[barKey(item.material, g)] = barQty;
      if (g !== item.grade) out.substitutes.push({ kind: `${item.material} bars`, need: item.grade, use: g, qty: barQty });
    }
  }
  if (item.gem) {
    const gemQty = Object.values(info.gems)[0] || 0;
    if (gemQty > 0) {
      const g = pick(state.storage.cut, item.gem.type, item.gem.grade, gemQty);
      if (!g) {
        out.ok = false;
        out.reason = (out.reason ? `${out.reason} ` : '') + `Need ${gemQty} cut ${item.gem.type} of grade ${item.gem.grade} or higher.`;
      } else {
        out.gems[`${item.gem.type}:${g}`] = gemQty;
        if (g !== item.gem.grade) out.substitutes.push({ kind: `cut ${item.gem.type}`, need: item.gem.grade, use: g, qty: gemQty });
      }
    }
  }
  return out;
}

export function substituteWarning(plan) {
  if (!plan.substitutes.length) return null;
  return `Uses higher grade: ${plan.substitutes.map((x) => `${x.qty} ${x.use} ${x.kind} instead of ${x.need}`).join('; ')} (no extra benefit).`;
}

// Repair to 100%: by day only, at camp, on gear the adventurer does not have today. Costs bars (and gem) and time;
// the time is cut by the repair skills. XP: 1 per durability point repaired per bar in the item, to the bar type's
// Repair skill and to General repair.
export function repair(state, id, cfg = CONFIG) {
  const err = campWork(state);
  if (err) return { ok: false, msg: err };
  const item = state.gear.find((g) => g.id === id);
  if (!item) return { ok: false, msg: 'No such gear.' };
  if (item.packed) return { ok: false, msg: 'The adventurer has this item today.' };
  if (item.durability >= 100) return { ok: false, msg: 'Already at 100%.' };
  const plan = repairPlan(state, item, cfg);
  if (!plan.ok) return { ok: false, msg: plan.reason };
  if (state.time + plan.minutes > cfg.time.dayEndMin + EPS) return { ok: false, msg: 'Not enough time left today.' };
  for (const [k, n] of Object.entries(plan.bars)) take(state.storage.bars, k, n);
  for (const [k, n] of Object.entries(plan.gems)) take(state.storage.cut, k, n);
  item.durability = 100;
  state.time += plan.minutes;
  const notes = [];
  const points = plan.missing * cfg.gear.slots[item.slot].bars;
  const repairKey = `repair_${item.material}`;
  addXp(state, repairKey, points * xpPerUnit(skillDef(repairKey, cfg), cfg), notes, cfg);
  addXp(state, 'repairTime', points * xpPerUnit(skillDef('repairTime', cfg), cfg), notes, cfg);
  const warn = substituteWarning(plan);
  return {
    ok: true,
    minutes: plan.minutes,
    substitutes: plan.substitutes,
    notes,
    msg: `Repaired ${gearName(item)} to 100% (${formatDuration(plan.minutes)}).${warn ? ` ${warn}` : ''}`,
  };
}

// Round down to 0.01 (tiny tolerance for float noise).
const floor2 = (v) => Math.floor(v * 100 + 1e-7) / 100;

// What scrapping an item gives back: the item's bars (material and grade) x 35% x its durability, rounded down to
// 0.01. The gem is lost. Always at most what a repair of the same item costs, so repairing first never pays.
export function scrapReturn(item, cfg = CONFIG) {
  const bars = cfg.gear.slots[item.slot].bars;
  return { key: barKey(item.material, item.grade), qty: floor2(bars * (cfg.gear.repair.materialFraction / 100) * (item.durability / 100)) };
}

// Scrap an item at home: it is destroyed and returns bars (scrapReturn). No time. The gem is lost.
export function scrap(state, id, cfg = CONFIG) {
  const err = campWork(state);
  if (err) return { ok: false, msg: err };
  const i = state.gear.findIndex((g) => g.id === id);
  if (i < 0) return { ok: false, msg: 'No such gear.' };
  if (state.gear[i].packed) return { ok: false, msg: 'The adventurer has this item today.' };
  const [item] = state.gear.splice(i, 1);
  const back = scrapReturn(item, cfg);
  if (back.qty > 0) state.storage.bars[back.key] = round2((state.storage.bars[back.key] || 0) + back.qty);
  const [m, g] = back.key.split(':');
  const got = back.qty > 0 ? `got back ${qtyText(back.qty)} ${cap(m)} ${g} ${back.qty === 1 ? 'bar' : 'bars'}` : 'nothing came back';
  return { ok: true, back, msg: `Scrapped ${gearName({ ...item, gem: null })}: ${got}.${item.gem ? ` The ${cap(item.gem.type)} ${item.gem.grade} gem is lost.` : ''}` };
}
