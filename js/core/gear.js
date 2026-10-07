import { CONFIG, GRADES, SLOTS } from '../config.js';
import { round1, round2, EPS, cap } from './util.js';

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

export function craftMinutes(slot, hasGem, cfg = CONFIG) {
  return cfg.gear.slots[slot].bars * cfg.gear.smithMinPerBar + (hasGem ? cfg.gear.infuseMin : 0);
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
  const minutes = craftMinutes(spec.slot, !!spec.gem, cfg);
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
  return { ok: true, item, minutes, msg: `Crafted ${gearName(item)} (${minutes}m).` };
}

// Round up to 0.01 (tiny tolerance for float noise). Math.max avoids returning -0 for a 0 amount.
const ceil2 = (v) => Math.max(0, Math.ceil(v * 100 - 1e-7) / 100);

// Cost and time to repair an item back to 100%.
export function repairInfo(item, cfg = CONFIG) {
  const missing = 100 - item.durability;
  const frac = missing / 100;
  const matFrac = cfg.gear.repair.materialFraction / 100;
  const bars = { [barKey(item.material, item.grade)]: ceil2(cfg.gear.slots[item.slot].bars * matFrac * frac) };
  const gems = item.gem ? { [`${item.gem.type}:${item.gem.grade}`]: ceil2(matFrac * frac) } : {};
  const minutes = round1(craftMinutes(item.slot, !!item.gem, cfg) * (cfg.gear.repair.timeFraction / 100) * frac);
  return { missing, bars, gems, minutes };
}

// Is it night (after the fight report, while planning)? Repairs then cost no time and need no camp visit.
export function isNight(state) {
  return state.phase === 'report' || state.phase === 'plan';
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
  const out = { ok: true, reason: null, bars: {}, gems: {}, substitutes: [], minutes: isNight(state) ? 0 : info.minutes, missing: info.missing };
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

// Repair to 100%. By day: at camp, costs time. At night (report/plan): free of time, anywhere.
export function repair(state, id, cfg = CONFIG) {
  const night = isNight(state);
  if (!night) {
    const err = campWork(state);
    if (err) return { ok: false, msg: err };
  }
  const item = state.gear.find((g) => g.id === id);
  if (!item) return { ok: false, msg: 'No such gear.' };
  if (item.packed) return { ok: false, msg: 'The adventurer has this item today.' };
  if (item.durability >= 100) return { ok: false, msg: 'Already at 100%.' };
  const plan = repairPlan(state, item, cfg);
  if (!plan.ok) return { ok: false, msg: plan.reason };
  if (!night && state.time + plan.minutes > cfg.time.dayEndMin + EPS) return { ok: false, msg: 'Not enough time left today.' };
  for (const [k, n] of Object.entries(plan.bars)) take(state.storage.bars, k, n);
  for (const [k, n] of Object.entries(plan.gems)) take(state.storage.cut, k, n);
  item.durability = 100;
  state.time += plan.minutes;
  const warn = substituteWarning(plan);
  return {
    ok: true,
    minutes: plan.minutes,
    substitutes: plan.substitutes,
    msg: `Repaired ${gearName(item)} to 100% (${night ? 'at night, no time' : `${plan.minutes}m`}).${warn ? ` ${warn}` : ''}`,
  };
}

// Destroy (scrap) an item at home. No refund.
export function scrap(state, id) {
  const err = campWork(state);
  if (err) return { ok: false, msg: err };
  const i = state.gear.findIndex((g) => g.id === id);
  if (i < 0) return { ok: false, msg: 'No such gear.' };
  if (state.gear[i].packed) return { ok: false, msg: 'The adventurer has this item today.' };
  const [item] = state.gear.splice(i, 1);
  return { ok: true, msg: `Scrapped ${gearName(item)}.` };
}
