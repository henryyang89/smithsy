// Shared repair widgets for the Workshop (by day) and the night screens (battle report, plan).
// All numbers come from core repairPlan()/repairInfo(); all state changes go through repair() in ctx.act().
// CSS: css/ui-workshop.css (classes prefixed rp-).
import { h, num } from './dom.js';
import { repairPlan, repairInfo, repair, isNight, gearName } from '../core/gear.js';
import { atCamp } from '../core/map.js';
import { cap, round2, EPS, deepClone } from '../core/util.js';

// Quantities: whole numbers as-is, fractional ones (repairs use 0.01 bars) to 2 decimals.
export const qty = (v) => {
  const r = round2(v || 0);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};

// Everything the UI needs to show one item's repair: { night, plan, info, why } (why = null when it can be done now).
// opts.blocked: a daytime reason from the caller (e.g. "Workshop closed: ...") that replaces the camp check.
export function repairCheck(state, item, cfg, opts = {}) {
  const night = isNight(state);
  const plan = repairPlan(state, item, cfg);
  const info = repairInfo(item, cfg);
  let why = null;
  if (item.packed) why = 'With the adventurer today';
  else if (item.durability >= 100) why = 'At 100%';
  else if (!night && opts.blocked) why = opts.blocked;
  else if (!night && state.phase !== 'work') why = 'Not during the work day';
  else if (!night && !atCamp(state)) why = 'Repairs by day only work at camp';
  else if (!plan.ok) why = plan.reason;
  else if (!night && state.time + plan.minutes > cfg.time.dayEndMin + EPS) why = `Not enough time left today (needs ${num(plan.minutes)}m)`;
  return { night, plan, info, why };
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
    out.push(h('span', { class: missing ? 'err' : sub ? 'rp-sub' : '', title: missing ? `Have ${qty(state.storage.bars[k] || 0)} of this grade` : `Have ${qty(state.storage.bars[k] || 0)}` },
      `${qty(n)} ${cap(m)} `, h('b', { class: `grade-${g}` }, g), ` bar${n === 1 ? '' : 's'}`, sub ? ` (for ${sub.need})` : ''));
  }
  if (item.gem) {
    const usedG = Object.entries(plan.gems);
    const gemEntries = usedG.length ? usedG : Object.entries(info.gems).filter(([, n]) => n > 0);
    for (const [k, n] of gemEntries) {
      const [t, g] = k.split(':');
      const missing = !usedG.length;
      const sub = !missing && subUse(`cut ${t}`);
      out.push(h('span', { class: missing ? 'err' : sub ? 'rp-sub' : '', title: `Have ${qty(state.storage.cut[k] || 0)}` },
        `${qty(n)} cut ${cap(t)} `, h('b', { class: `grade-${g}` }, g), sub ? ` (for ${sub.need})` : ''));
    }
  }
  return out.map((c, i) => [i ? ' + ' : '', c]);
}

function doRepair(ctx, item) {
  return ctx.act(() => repair(ctx.state, item.id, ctx.cfg), { toast: true });
}

export function repairButton(ctx, item, check, cls = 'small') {
  const { night, plan, info, why } = check;
  const timeText = night ? 'no time (night)' : `${num(plan.minutes)}m`;
  const warn = substituteText(plan);
  return h('button', {
    class: cls,
    disabled: !!why,
    'data-repair': item.id,
    title: why || `Repair ${gearName(item)} +${num(info.missing)}% to 100% (${timeText})${warn ? `. ${warn}` : ''}`,
    onclick: () => doRepair(ctx, item),
  }, `Repair +${num(info.missing)}%`);
}

// One compact block: [Repair +7%] 0.07 Iron C bars · no time tonight / 12m
//                     WARNING line when a higher grade substitutes, reason line when it can't be done.
export function repairLine(ctx, item, opts = {}) {
  const check = repairCheck(ctx.state, item, ctx.cfg, opts);
  const { night, plan, why } = check;
  const warn = substituteText(plan);
  const timeNode = night
    ? h('span', { class: 'ok' }, 'no time tonight')
    : h('span', { class: 'muted', title: 'Repairs at night (battle report / plan screen) cost no time' }, `${num(plan.minutes)}m (free at night)`);
  return h('div', { class: 'rp-line' },
    h('div', { class: 'rp-main' },
      repairButton(ctx, item, check),
      h('span', { class: 'rp-cost' }, repairCostNodes(ctx.state, item, check), ' · ', timeNode)),
    warn && !item.packed ? h('div', { class: 'rp-warn' }, h('b', {}, 'Warning: '), warn, '.') : null,
    why && why !== 'At 100%' ? h('div', { class: 'rp-why' }, why) : null);
}

// Dry run of repairing every worn item at home, in order, on a copy of the state (exact sequential result:
// an earlier repair may use up the stock a later one needed). Returns { ids, subs, failed }.
export function repairAllPreview(state, items, cfg) {
  const sim = deepClone(state);
  const ids = [];
  const subs = [];
  let failed = 0;
  for (const it of items) {
    const res = repair(sim, it.id, cfg);
    if (res.ok) {
      ids.push(it.id);
      for (const s of res.substitutes || []) subs.push({ ...s, name: gearName(it) });
    } else failed += 1;
  }
  return { ids, subs, failed };
}

// "Repair all" for the night screens. Skips items that can't be repaired.
export function repairAllButton(ctx, items) {
  const worn = items.filter((g) => !g.packed && g.durability < 100);
  if (worn.length < 2) return null;
  const pre = repairAllPreview(ctx.state, worn, ctx.cfg);
  const n = pre.ids.length;
  const subText = pre.subs.map((x) => `${x.name}: ${qty(x.qty)} ${x.use} ${x.kind} instead of ${x.need}`).join('; ');
  return h('button', {
    class: 'small',
    disabled: n === 0,
    title: n === 0 ? 'Not enough materials for any repair' : `Repair ${n} item${n === 1 ? '' : 's'} to 100%${pre.failed ? ` (${pre.failed} skipped: not enough materials)` : ''}${subText ? `. Higher grades used: ${subText} (no extra benefit)` : ''}`,
    onclick: () => {
      if (subText && !confirm(`Some repairs will use a higher grade (no extra benefit):\n${subText}\n\nRepair all anyway?`)) return;
      ctx.act(() => {
        const st = ctx.state;
        const names = [];
        const used = [];
        for (const id of pre.ids) {
          const item = st.gear.find((g) => g.id === id);
          const res = repair(st, id, ctx.cfg);
          if (res.ok) {
            names.push(gearName(item));
            for (const s of res.substitutes || []) used.push(`${qty(s.qty)} ${s.use} ${s.kind} instead of ${s.need}`);
          }
        }
        if (!names.length) return { ok: false, msg: 'Nothing could be repaired.' };
        const when = isNight(st) ? 'at night, no time' : 'by day';
        return { ok: true, msg: `Repaired ${names.join(', ')} to 100% (${when}).${used.length ? ` Uses higher grade: ${used.join('; ')} (no extra benefit).` : ''}` };
      }, { toast: true });
    },
  }, `Repair all (${n})`);
}
