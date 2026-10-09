// Shared repair widgets for the Workshop gear list. Repairs happen by day, at camp, on gear the adventurer does not
// have (core repair()). All numbers come from core repairPlan()/repairInfo(); all state changes go through repair()
// in ctx.act(). CSS: css/ui-workshop.css (classes prefixed rp-).
import { h, tip } from './dom.js';
import { repairPlan, repairInfo, repair, gearName } from '../core/gear.js';
import { atCamp } from '../core/map.js';
import { packOrder } from '../core/pack.js';
import { cap, qtyText, round1, formatDuration, EPS } from '../core/util.js';
import { repairGainShown } from './present.js';

// Quantities: whole numbers as-is, fractional ones (repairs use 0.01 bars) to 2 decimals.
export const qty = qtyText;

// Everything the UI needs to show one item's repair: { plan, info, why } (why = null when it can be done now).
// opts.blocked: a reason from the caller (e.g. "Workshop closed: ...") that replaces the camp check.
export function repairCheck(state, item, cfg, opts = {}) {
  const plan = repairPlan(state, item, cfg);
  const info = repairInfo(item, cfg);
  let why = null;
  if (item.packed) why = 'With the adventurer today';
  else if (item.durability >= 100) why = 'At 100%';
  else if (opts.blocked) why = opts.blocked;
  else if (state.phase !== 'work') why = 'Not during the work day';
  else if (!atCamp(state)) why = 'Repairs only work at camp';
  else if (!plan.ok) why = plan.reason;
  else if (state.time + plan.minutes > cfg.time.dayEndMin + EPS) why = `Not enough time left today (needs ${formatDuration(plan.minutes)})`;
  return { plan, info, why };
}

// "Uses 0.21 B iron bars instead of C — no extra benefit" (one line per substitute), or null.
export function substituteText(plan) {
  if (!plan.substitutes || !plan.substitutes.length) return null;
  return plan.substitutes.map((x) => `Uses ${qty(x.qty)} ${x.use} ${x.kind} instead of ${x.need}`).join('; ') + ' — no extra benefit';
}

// What the repair will consume: the grade actually used (plan), else the exact grade it needs (shown as missing).
export function repairCostNodes(state, item, check) {
  const { plan, info } = check;
  const out = [];
  const subUse = (kindPrefix) => plan.substitutes.find((x) => x.kind.startsWith(kindPrefix));
  const used = Object.entries(plan.bars);
  const barEntries = used.length ? used : Object.entries(info.bars).filter(([, n]) => n > 0);
  for (const [k, n] of barEntries) {
    const [m, g] = k.split(':');
    const missing = !used.length;
    const sub = !missing && subUse(`${m} bars`);
    out.push(h('span', { class: missing ? 'err' : sub ? 'rp-sub' : '', ...tip(missing ? `Have ${qty(state.storage.bars[k] || 0)} of this grade` : `Have ${qty(state.storage.bars[k] || 0)}`) },
      `${qty(n)} ${cap(m)} `, h('b', { class: `grade-${g}` }, g), ` bar${n === 1 ? '' : 's'}`, sub ? ` (for ${sub.need})` : ''));
  }
  if (item.gem) {
    const usedG = Object.entries(plan.gems);
    const gemEntries = usedG.length ? usedG : Object.entries(info.gems).filter(([, n]) => n > 0);
    for (const [k, n] of gemEntries) {
      const [t, g] = k.split(':');
      const missing = !usedG.length;
      const sub = !missing && subUse(`cut ${t}`);
      out.push(h('span', { class: missing ? 'err' : sub ? 'rp-sub' : '', ...tip(`Have ${qty(state.storage.cut[k] || 0)}`) },
        `${qty(n)} cut ${cap(t)} `, h('b', { class: `grade-${g}` }, g), sub ? ` (for ${sub.need})` : ''));
    }
  }
  return out.map((c, i) => [i ? ' + ' : '', c]);
}

function doRepair(ctx, item) {
  return ctx.act(() => repair(ctx.state, item.id, ctx.cfg), { toast: true });
}

export function repairButton(ctx, item, check, cls = 'small') {
  const { plan, why } = check;
  const warn = substituteText(plan);
  return h('button', {
    class: cls,
    disabled: !!why,
    'data-repair': item.id,
    ...tip(why || `Repair ${gearName(item)} +${repairGainShown(item.durability)}% to 100% (${formatDuration(plan.minutes)})${warn ? `. ${warn}` : ''}`),
    onclick: () => doRepair(ctx, item),
  }, `Repair +${repairGainShown(item.durability)}%`);
}

// One compact block: [Repair +7%] 0.07 Iron C bars · 12m
//                     WARNING line when a higher grade substitutes, reason line when it can't be done.
// opts.lead: nodes placed first on the line (the gear list puts the durability bar and number there, so the button sits
// right of the durability). The lead and the button are one group that never wraps (R24), also in the half-width gear
// list of the Adventurer tab; its bar gives way first when the cell is narrow.
export function repairLine(ctx, item, opts = {}) {
  const check = repairCheck(ctx.state, item, ctx.cfg, opts);
  const { plan, info, why } = check;
  const warn = substituteText(plan);
  const timeNode = h('span', {
    class: 'muted',
    ...tip(plan.minutes < info.baseMinutes - EPS
      ? `Repairing takes ${formatDuration(info.baseMinutes)}; your repair skills cut it to ${formatDuration(plan.minutes)}. See the Skills tab.`
      : `Repairing takes ${formatDuration(info.baseMinutes)}. Repair skills (Skills tab) make it faster.`),
  }, formatDuration(plan.minutes));
  return h('div', { class: 'rp-line' },
    h('div', { class: 'rp-main' },
      // the durability and the button stay on one line (the cost text is what wraps below them)
      h('span', { class: 'rp-dur' }, opts.lead || null, repairButton(ctx, item, check)),
      h('span', { class: 'rp-cost' }, repairCostNodes(ctx.state, item, check), ' · ', timeNode)),
    warn && !item.packed ? h('div', { class: 'rp-warn' }, h('b', {}, 'Warning: '), warn, '.') : null,
    why && why !== 'At 100%' ? h('div', { class: 'rp-why' }, why) : null);
}

// "Repair all": which items would be repaired right now, in order (best first), and how long that takes. The stock is
// counted down item by item, so two items that need the same bars are not both promised; an item that does not fit
// (no bars, no time left) is skipped and a cheaper one after it may still go. Nothing is changed. Returns { ids, minutes }.
export function repairAllInfo(state, cfg) {
  const shadow = { ...state, storage: { ...state.storage, bars: { ...state.storage.bars }, cut: { ...state.storage.cut } } };
  const ids = [];
  let minutes = 0;
  for (const g of state.gear.filter((x) => !x.packed && x.durability < 100).sort(packOrder(cfg))) {
    const plan = repairPlan(shadow, g, cfg);
    if (!plan.ok || state.time + minutes + plan.minutes > cfg.time.dayEndMin + EPS) continue;
    for (const [k, n] of Object.entries(plan.bars)) shadow.storage.bars[k] = (shadow.storage.bars[k] || 0) - n;
    for (const [k, n] of Object.entries(plan.gems)) shadow.storage.cut[k] = (shadow.storage.cut[k] || 0) - n;
    ids.push(g.id);
    minutes += plan.minutes;
  }
  return { ids, minutes: round1(minutes) };
}

// Do the repairs repairAllInfo listed, one after the other (each through the normal repair()), and stop at the first one
// that fails. Returns { ok, msg, notes }.
export function repairAll(state, cfg) {
  const { ids } = repairAllInfo(state, cfg);
  if (!ids.length) return { ok: false, msg: 'Nothing can be repaired right now.' };
  const done = [];
  const notes = [];
  let minutes = 0;
  let substitute = false;
  let stopped = null;
  for (const id of ids) {
    const item = state.gear.find((g) => g.id === id);
    const res = repair(state, id, cfg);
    if (!res.ok) {
      stopped = res.msg;
      break;
    }
    done.push(gearName(item));
    minutes += res.minutes;
    notes.push(...(res.notes || []));
    if (res.substitutes && res.substitutes.length) substitute = true;
  }
  if (!done.length) return { ok: false, msg: stopped };
  return {
    ok: true,
    minutes,
    notes,
    msg: `Repaired ${done.length} item${done.length === 1 ? '' : 's'} to 100% in ${formatDuration(minutes)}: ${done.join(', ')}.${substitute ? ' Some used a higher grade (no extra benefit).' : ''}${stopped ? ` Stopped: ${stopped}` : ''}`,
  };
}
