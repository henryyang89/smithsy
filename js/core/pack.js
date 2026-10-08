// What the adventurer can pack: the limit per gear type (2, plus pack mules won from banners), the default pack and the
// "leave worn gear home" button.
import { CONFIG, SLOTS, GRADES } from '../config.js';
import { couldBreak, gearPower, shownDurability, repairPlan } from './gear.js';

// Items of one gear type the adventurer can pack: plan.perSlot + the pack mules captured for that type.
export function packLimit(state, slot, cfg = CONFIG) {
  return cfg.plan.perSlot + ((state.groups && state.groups.extra && state.groups.extra[slot]) || 0);
}

const NOUNS = {
  sword: ['sword', 'swords'],
  chest: ['chest', 'chests'],
  helmet: ['helmet', 'helmets'],
  gloves: ['pair of gloves', 'pairs of gloves'],
  boots: ['pair of boots', 'pairs of boots'],
};

// "sword" / "3 swords" style names for running text: slotNoun('sword', 3) = 'swords'.
export const slotNoun = (slot, n = 1) => ((NOUNS[slot] || [slot, `${slot}s`])[n === 1 ? 0 : 1]);

// Best first: material x grade, then the higher gem grade, then the more durable item, then the lower id.
export function packOrder(cfg = CONFIG) {
  const gemRank = (g) => (g.gem ? GRADES.indexOf(g.gem.grade) : -1);
  return (a, b) => gearPower(b, cfg) - gearPower(a, cfg) || gemRank(b) - gemRank(a) || b.durability - a.durability || a.id - b.id;
}

// The pack the "Best per type" button and the Adventurer tab's estimate use: per gear type the best packLimit items,
// skipping an item that could break (couldBreak against `tier`, null = the toughest tier) while the type has another
// item that cannot. When every item of a type could break, the best ones are packed anyway. Returns item ids.
export function defaultPack(state, cfg = CONFIG, tier = null) {
  const order = packOrder(cfg);
  const ids = [];
  for (const slot of SLOTS) {
    const items = state.gear.filter((g) => g.slot === slot).sort(order);
    const safe = items.filter((g) => !couldBreak(g, state, tier, cfg));
    ids.push(...(safe.length ? safe : items).slice(0, packLimit(state, slot, cfg)).map((g) => g.id));
  }
  return ids;
}

// "Leave worn gear home": take out of `ids` the items below plan.leaveHomeBelow (shown durability) that the stock at
// hand can repair, but never empty a gear type: when all of its packed items would go, the best one stays. Item ids.
export function leaveWornHome(state, ids, cfg = CONFIG) {
  const order = packOrder(cfg);
  const out = [];
  for (const slot of SLOTS) {
    const items = state.gear.filter((g) => g.slot === slot && ids.includes(g.id)).sort(order);
    const worn = (g) => shownDurability(g.durability) < cfg.plan.leaveHomeBelow && repairPlan(state, g, cfg).ok;
    const keep = items.filter((g) => !worn(g));
    out.push(...(keep.length || !items.length ? keep : [items[0]]).map((g) => g.id));
  }
  return out;
}
