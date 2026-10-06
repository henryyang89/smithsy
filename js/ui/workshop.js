// Workshop tab: storage, refining ore, cutting gems, smithing gear, repairing/scrapping gear.
// All game-state changes go through core actions inside ctx.act(). UI-only state lives in ctx.ui.ws_*.
import { h, section, bar, num } from './dom.js';
import { BARS, GEMS, SLOTS, ORES, GRADES } from '../config.js';
import { refine, cut, repeat, refineDistribution, cutDistribution, refineMinutes, cutMinutes, GRADE_ORDER } from '../core/processing.js';
import { craft, canCraft, craftCost, craftMinutes, gearStats, gearName, statsText, repairInfo, repair, scrap, STAT_LABELS } from '../core/gear.js';
import { atCamp, timeLeft, returnMinutes } from '../core/map.js';
import { smithBonuses } from '../core/bonuses.js';
import { formatClock, formatDuration, cap, round2, EPS } from '../core/util.js';

const OUTCOMES = GRADE_ORDER; // S A B C D F
const GRADES_HI = GRADE_ORDER.filter((g) => g !== 'F'); // S A B C D (best first)
const BASE_STATS = ['damage', 'accuracy', 'defense', 'dodge', 'speed'];

// ------------------------------------------------------------------ helpers ----
// Quantities: whole numbers as-is, fractional ones (repairs use 0.01 bars) to 2 decimals.
const qty = (v) => {
  const r = round2(v || 0);
  return Number.isInteger(r) ? String(r) : r.toFixed(2);
};
const enough = (have, need) => (have || 0) + EPS >= need;
const outcomeLabel = (g) => (g === 'F' ? 'Fail' : g);
const statLabel = (k) => STAT_LABELS[k] || k;
const mins = (m) => formatDuration(m);

// Small table. Cells: string | Node | { v, cls, title, span }. Rows: array of cells, or { attrs, cells }.
function tbl(head, rows, cls = '') {
  const cell = (tag, c) => {
    if (c && typeof c === 'object' && !(c instanceof Node) && !Array.isArray(c) && 'v' in c) {
      return h(tag, { class: c.cls, title: c.title, colspan: c.span }, c.v);
    }
    return h(tag, {}, c);
  };
  return h('table', { class: `ws-table ${cls}` },
    head ? h('thead', {}, h('tr', {}, head.map((c) => cell('th', c)))) : null,
    h('tbody', {}, rows.map((r) => (Array.isArray(r) ? h('tr', {}, r.map((c) => cell('td', c))) : h('tr', r.attrs || {}, r.cells.map((c) => cell('td', c)))))));
}

const countCell = (n) => (n > EPS ? { v: qty(n), cls: 'num' } : { v: '·', cls: 'num ws-zero' });

// Why workshop actions are unavailable right now (null = available).
function blockReason(state) {
  if (state.phase !== 'work') return 'The work day is over.';
  if (!atCamp(state)) return 'You are out in a field.';
  return null;
}

function bestGrade(stock, prefix, need) {
  return GRADES_HI.find((g) => enough(stock[`${prefix}:${g}`], need)) || null;
}

// Best grade with enough stock; else the grade with the most stock; else `current`.
function pickGrade(stock, prefix, need, current) {
  const best = bestGrade(stock, prefix, need);
  if (best) return best;
  let most = null;
  for (const g of GRADES_HI) if ((stock[`${prefix}:${g}`] || 0) > EPS && (!most || stock[`${prefix}:${g}`] > stock[`${prefix}:${most}`])) most = g;
  return most || current;
}

// --------------------------------------------------------------------- main ----
export function renderWorkshop(root, ctx) {
  const blocked = blockReason(ctx.state);
  root.append(h('div', { class: 'ws' },
    statusBar(ctx, blocked),
    storagePanel(ctx),
    processPanel(ctx, 'refine', blocked),
    processPanel(ctx, 'cut', blocked),
    smithPanel(ctx, blocked),
    gearPanel(ctx, blocked)));
}

function statusBar(ctx, blocked) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const left = Math.max(0, timeLeft(s, cfg));
  if (blocked) {
    const inField = s.phase === 'work' && !atCamp(s);
    return h('div', { class: 'panel ws-notice' },
      h('b', {}, 'Workshop closed. '),
      inField
        ? [`You are out in a field. Refining, cutting, smithing and repairs only work at camp. Walking back takes ${mins(returnMinutes(s))}. `,
          h('button', { class: 'small', onclick: () => ctx.setTab('map') }, 'Open map')]
        : blocked,
      h('div', { class: 'ws-sub' }, 'You can still look at everything below.'));
  }
  return h('div', { class: 'ws-status' },
    h('b', {}, 'At camp'), ' · ', formatClock(s.time), ' · ',
    left > 0
      ? h('span', {}, h('b', {}, mins(left)), ' of work time left today (day ends 18:00)')
      : h('span', { class: 'warn' }, 'No work time left today. End the day from the top bar.'));
}

// ------------------------------------------------------------------ storage ----
function storagePanel(ctx) {
  const st = ctx.state.storage;
  const gradeHead = (first) => [first, ...GRADES_HI.map((g) => ({ v: g, cls: `num grade-${g}` })), { v: 'Total', cls: 'num' }];
  const gradeRow = (store, k) => {
    const vals = GRADES_HI.map((g) => store[`${k}:${g}`] || 0);
    return [cap(k), ...vals.map(countCell), { ...countCell(vals.reduce((a, b) => a + b, 0)), cls: 'num ws-total' }];
  };
  return section('Storage',
    h('div', { class: 'ws-storage' },
      h('div', { class: 'ws-raw' }, h('h4', {}, 'Raw ores'), tbl(null, ORES.map((o) => [cap(o), countCell(st.ore[o] || 0)]), 'ws-compact')),
      h('div', { class: 'ws-raw' }, h('h4', {}, 'Raw gems'), tbl(null, GEMS.map((g) => [cap(g), countCell(st.gem[g] || 0)]), 'ws-compact')),
      h('div', { class: 'ws-graded' }, h('h4', {}, 'Bars by grade'), tbl(gradeHead('Bar'), BARS.map((b) => gradeRow(st.bars, b)), 'ws-compact')),
      h('div', { class: 'ws-graded' }, h('h4', {}, 'Cut gems by grade'), tbl(gradeHead('Gem'), GEMS.map((g) => gradeRow(st.cut, g)), 'ws-compact'))));
}

// ------------------------------------------------------- refine / cut panels ----
function distHeader() {
  return h('div', { class: 'ws-dist' },
    h('div', {}, 'Outcome chance %'),
    h('div', { class: 'ws-dist-nums' }, OUTCOMES.map((g) => h('span', { class: `grade-${g}` }, outcomeLabel(g)))));
}

function distView(dist, title) {
  return h('div', { class: 'ws-dist', title },
    h('div', { class: 'ws-dist-bar' }, OUTCOMES.map((g) => (dist[g] > EPS
      ? h('span', { class: `ws-seg ws-seg-${g}`, style: { width: `${dist[g]}%` }, title: `${outcomeLabel(g)}: ${num(dist[g])}%` })
      : null))),
    h('div', { class: 'ws-dist-nums' }, OUTCOMES.map((g) => h('span', { class: dist[g] > EPS ? `grade-${g}` : 'ws-zero' }, num(dist[g])))));
}

function processPanel(ctx, kind, blocked) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const isRefine = kind === 'refine';
  const b = smithBonuses(s, cfg);
  const left = timeLeft(s, cfg);
  const verb = isRefine ? 'Refine' : 'Cut';

  const rows = (isRefine ? BARS : GEMS).map((k) => {
    const def = isRefine ? cfg.refine[k] : cfg.cut[k];
    const inputs = isRefine
      ? Object.entries(def.input).map(([ore, n]) => ({ label: `${n} ${ore}`, need: n, have: s.storage.ore[ore] || 0 }))
      : [{ label: `1 raw ${k}`, need: 1, have: s.storage.gem[k] || 0 }];
    const minutes = isRefine ? refineMinutes(s, k, cfg) : cutMinutes(s, k, cfg);
    const dist = isRefine ? refineDistribution(s, k, cfg) : cutDistribution(s, k, cfg);
    const upPct = isRefine ? b.oreUpgrade(k) : b.gemUpgrade(k);
    const failRed = isRefine ? b.oreFailRed(k) : b.gemFailRed(k);
    const timePct = Math.min(isRefine ? b.refineTimePct : b.cutTimePct, cfg.processing.maxTimeReduction);
    const byMat = Math.min(...inputs.map((i) => Math.floor((i.have + EPS) / i.need)));
    const byTime = minutes > 0 ? Math.max(0, Math.floor((left + EPS) / minutes)) : Infinity;
    const n = Math.max(0, Math.min(byMat, byTime));

    const run = (max) => ctx.act(() => {
      const st = ctx.state;
      const one = () => (isRefine ? refine(st, k, cfg) : cut(st, k, cfg));
      const res = max === 1 ? one() : repeat(st, one, max);
      if (res.ok && res.results) res.msg = `${cap(k)}${isRefine ? ' bars' : ''}: ${res.msg}`;
      ctx.ui.ws_last = { area: kind, ok: res.ok, msg: res.msg };
      return res;
    }, { toast: true });

    const bonusBits = [];
    if (upPct > EPS) bonusBits.push(`+${num(upPct)}% upgrade luck`);
    if (failRed > EPS) bonusBits.push(`−${num(failRed)} fail`);
    if (timePct > EPS) bonusBits.push(`−${num(timePct)}% time`);
    const baseDist = OUTCOMES.map((g) => `${outcomeLabel(g)} ${def.dist[g]}%`).join(', ');

    let makeSub;
    if (byMat === 0) makeSub = h('div', { class: 'ws-sub' }, isRefine ? 'not enough ore' : 'no raw gems');
    else if (byTime < byMat) makeSub = h('div', { class: 'ws-sub warn' }, `time-limited (material for ${byMat})`);
    else makeSub = h('div', { class: 'ws-sub' }, `all: ${mins(n * minutes)}`);
    if (byMat > 0 && byTime < byMat && n > 0) makeSub = [makeSub, h('div', { class: 'ws-sub' }, `all: ${mins(n * minutes)}`)];

    const btn = (label, count, max) => h('button', {
      class: 'small',
      disabled: !!blocked || n < count,
      title: blocked ? `Workshop closed: ${blocked}`
        : n < count ? `Can make only ${n} right now`
          : `${verb} ${max === Infinity ? n : count} (${mins((max === Infinity ? n : count) * minutes)})`,
      onclick: () => run(max),
    }, label);

    return [
      h('div', {}, h('b', {}, cap(k), isRefine ? ' bar' : ''), bonusBits.length ? h('div', { class: 'ws-sub ok' }, bonusBits.join(' · ')) : null),
      h('div', {}, inputs.map((i) => h('div', {}, i.label, ' ',
        h('span', { class: enough(i.have, i.need) ? 'ok' : 'err' }, `(have ${qty(i.have)})`)))),
      { v: `${num(minutes)}m`, cls: 'num', title: `Base ${def.minutes}m${timePct > EPS ? `, −${num(timePct)}% from rings/skills` : ''}` },
      distView(dist, `Base chances: ${baseDist}.${bonusBits.length ? ` Your bonuses: ${bonusBits.join(', ')}.` : ''}`),
      h('div', {}, h('b', { class: 'ws-big' }, String(n)), makeSub),
      h('div', { class: 'ws-btns' }, btn(`${verb} 1`, 1, 1), btn(`${verb} 5`, 5, 5), btn(`${verb} all${n > 0 ? ` (${n})` : ''}`, 1, Infinity)),
    ];
  });

  const last = ctx.ui.ws_last && ctx.ui.ws_last.area === kind ? ctx.ui.ws_last : null;
  return section(isRefine ? 'Refine ore into bars' : 'Cut gems',
    h('p', { class: 'ws-sub ws-intro' }, isRefine
      ? 'Each bar rolls a grade (S best, D worst). Fail = the ore is lost. Chances already include your rings and skills.'
      : 'Each cut gem rolls a grade (S best, D worst). Fail = the gem is lost. Chances already include your rings and skills.'),
    h('div', { class: 'ws-scroll' },
      tbl([isRefine ? 'Bar' : 'Gem', 'Needs (you have)', { v: 'Time each', cls: 'num' }, distHeader(), 'You can make', ''], rows, 'ws-process')),
    last ? h('p', { class: `ws-last ${last.ok ? '' : 'err'}` }, h('span', { class: 'muted' }, 'Last: '), last.msg) : null);
}

// -------------------------------------------------------------------- smith ----
function initSmith(ctx) {
  const ui = ctx.ui;
  const st = ctx.state.storage;
  if (!SLOTS.includes(ui.ws_slot)) ui.ws_slot = 'sword';
  const need = ctx.cfg.gear.slots[ui.ws_slot].bars;
  if (!BARS.includes(ui.ws_mat)) {
    ui.ws_mat = [...BARS].reverse().find((m) => bestGrade(st.bars, m, need)) || BARS[0];
    ui.ws_grade = null;
  }
  if (!GRADES_HI.includes(ui.ws_grade)) ui.ws_grade = pickGrade(st.bars, ui.ws_mat, need, 'D');
  if (ui.ws_gem !== '' && !GEMS.includes(ui.ws_gem)) ui.ws_gem = '';
  if (!GRADES_HI.includes(ui.ws_gemGrade)) ui.ws_gemGrade = ui.ws_gem ? pickGrade(st.cut, ui.ws_gem, 1, 'D') : 'D';
}

function gradeButtons(selected, counts, need, onPick, unit) {
  return h('div', { class: 'ws-gbtns' }, GRADES_HI.map((g) => {
    const have = counts[g] || 0;
    const short = !enough(have, need);
    return h('button', {
      class: `ws-gbtn${g === selected ? ' sel' : ''}${short ? ' short' : ''}`,
      title: `${qty(have)} ${unit(g)} in stock${short ? ` (need ${need})` : ''}`,
      onclick: () => onPick(g),
    }, h('b', { class: `grade-${g}` }, g), ' ', h('span', { class: short ? 'ws-zero' : '' }, qty(have)));
  }));
}

function fxText(effects, gi, mult = 1) {
  return Object.entries(effects).map(([k, arr]) => `${statLabel(k)} ${num(arr[gi] * mult)}`).join(', ');
}

function smithPanel(ctx, blocked) {
  initSmith(ctx);
  const s = ctx.state;
  const cfg = ctx.cfg;
  const ui = ctx.ui;
  const st = s.storage;
  const { ws_slot: slot, ws_mat: mat, ws_grade: grade } = ui;
  const need = cfg.gear.slots[slot].bars;
  const gem = ui.ws_gem ? { type: ui.ws_gem, grade: ui.ws_gemGrade } : null;
  const spec = { slot, material: mat, grade, gem };
  const left = timeLeft(s, cfg);

  const pick = (fn) => {
    fn();
    ctx.rerender();
  };
  const matTotal = (m) => GRADES_HI.reduce((a, g) => a + (st.bars[`${m}:${g}`] || 0), 0);
  const gemTotal = (t) => GRADES_HI.reduce((a, g) => a + (st.cut[`${t}:${g}`] || 0), 0);

  // ---- form
  const form = h('div', { class: 'ws-form' },
    h('label', { for: 'ws-slot' }, 'Slot'),
    h('select', {
      id: 'ws-slot',
      onchange: (e) => pick(() => {
        ui.ws_slot = e.target.value;
        const n = cfg.gear.slots[ui.ws_slot].bars;
        if (!enough(st.bars[`${ui.ws_mat}:${ui.ws_grade}`], n)) ui.ws_grade = pickGrade(st.bars, ui.ws_mat, n, ui.ws_grade);
      }),
    }, SLOTS.map((sl) => h('option', { value: sl, selected: sl === slot }, `${cap(sl)} — ${cfg.gear.slots[sl].bars} bars, ${craftMinutes(sl, false, cfg)}m`))),

    h('label', { for: 'ws-mat' }, 'Material'),
    h('select', {
      id: 'ws-mat',
      onchange: (e) => pick(() => {
        ui.ws_mat = e.target.value;
        ui.ws_grade = pickGrade(st.bars, ui.ws_mat, need, ui.ws_grade);
      }),
    }, BARS.map((m) => h('option', { value: m, selected: m === mat }, `${cap(m)} (stats ×${cfg.gear.materialMult[m]}) — ${qty(matTotal(m))} bars`))),

    h('span', {}, 'Bar grade'),
    h('div', {},
      gradeButtons(grade, Object.fromEntries(GRADES_HI.map((g) => [g, st.bars[`${mat}:${g}`]])), need,
        (g) => pick(() => (ui.ws_grade = g)), (g) => `${mat} ${g} bars`),
      h('div', { class: 'ws-sub' }, `Needs ${need} ${mat} bars of one grade. Grade multiplies stats: `,
        GRADES_HI.slice().reverse().map((g) => `${g} ×${cfg.gear.gradeMult[g]}`).join(', '), '.')),

    h('label', { for: 'ws-gem' }, 'Gem'),
    h('select', {
      id: 'ws-gem',
      onchange: (e) => pick(() => {
        ui.ws_gem = e.target.value;
        if (ui.ws_gem) ui.ws_gemGrade = pickGrade(st.cut, ui.ws_gem, 1, ui.ws_gemGrade);
      }),
    },
    h('option', { value: '', selected: !gem }, 'None'),
    GEMS.map((t) => h('option', { value: t, selected: gem && gem.type === t }, `${cap(t)} — ${qty(gemTotal(t))} cut`))),

    h('span', {}, gem ? 'Gem grade' : 'Gem grade (reference)'),
    h('div', {},
      gem
        ? gradeButtons(ui.ws_gemGrade, Object.fromEntries(GRADES_HI.map((g) => [g, st.cut[`${gem.type}:${g}`]])), 1,
          (g) => pick(() => (ui.ws_gemGrade = g)), (g) => `cut ${gem.type} ${g}`)
        : h('div', { class: 'ws-gbtns' }, GRADES_HI.map((g) => h('button', {
          class: `ws-gbtn${g === ui.ws_gemGrade ? ' sel' : ''}`,
          title: 'Grade used for the gem effect reference',
          onclick: () => pick(() => (ui.ws_gemGrade = g)),
        }, h('b', { class: `grade-${g}` }, g)))),
      h('div', { class: 'ws-sub' }, gem ? `Infusing adds ${cfg.gear.infuseMin}m and uses 1 cut gem.` : 'Optional. Pick a gem to infuse a bonus.')));

  // ---- preview
  const mock = { slot, material: mat, grade, gem };
  const stats = gearStats(mock, cfg);
  const base = gearStats({ ...mock, gem: null }, cfg);
  const minutes = craftMinutes(slot, !!gem, cfg);
  const cost = craftCost(spec, cfg);
  let reason = blocked ? `Workshop closed: ${blocked}` : canCraft(s, spec, cfg);
  if (!reason && s.time + minutes > cfg.time.dayEndMin + EPS) reason = `Not enough time left today (needs ${minutes}m, ${mins(Math.max(0, left))} left).`;

  const statRows = Object.entries(stats).map(([k, v]) => {
    const fromGem = v - (base[k] || 0);
    const split = gem && fromGem > EPS && base[k] ? h('span', { class: 'muted' }, ` (${num(base[k])} + ${num(fromGem)} gem)`) : gem && !base[k] ? h('span', { class: 'muted' }, ' (gem)') : null;
    return [statLabel(k), { v: [h('b', {}, num(v)), split], cls: 'num' }];
  });
  const costLines = [
    ...Object.entries(cost.bars).map(([k, n]) => {
      const [m, g] = k.split(':');
      return { text: `${n} × ${cap(m)} ${g} bar${n === 1 ? '' : 's'}`, have: st.bars[k] || 0, n };
    }),
    ...Object.entries(cost.gems).map(([k, n]) => {
      const [t, g] = k.split(':');
      return { text: `${n} × cut ${cap(t)} ${g}`, have: st.cut[k] || 0, n };
    }),
  ];
  const timeParts = `${need} bars × ${cfg.gear.smithMinPerBar}m${gem ? ` + ${cfg.gear.infuseMin}m gem` : ''}`;

  const preview = h('div', { class: 'ws-preview' },
    h('div', { class: 'ws-preview-name' }, 'Result: ', h('b', { class: `grade-${grade}` }, gearName(mock)), h('span', { class: 'muted' }, ' · 100% durability')),
    tbl(null, statRows, 'ws-compact ws-stats'),
    h('div', { class: 'ws-cost' },
      h('div', {}, h('span', { class: 'muted' }, 'Cost: '), costLines.map((c, i) => [i ? ', ' : '', c.text, ' ',
        h('span', { class: enough(c.have, c.n) ? 'ok' : 'err' }, `(have ${qty(c.have)})`)])),
      h('div', {}, h('span', { class: 'muted' }, 'Time: '), h('b', {}, `${minutes}m`), ` (${timeParts})`,
        !blocked && !reason ? h('span', { class: 'muted' }, ` · done at ${formatClock(s.time + minutes)}`) : null)),
    h('div', { class: 'row ws-craft-row' },
      h('button', {
        class: 'primary',
        disabled: !!reason,
        title: reason || `Craft ${gearName(mock)}`,
        onclick: () => ctx.act(() => {
          const res = craft(ctx.state, spec, cfg);
          ctx.ui.ws_last = { area: 'smith', ok: res.ok, msg: res.msg };
          return res;
        }, { toast: true }),
      }, `Craft (${minutes}m)`),
      reason ? h('span', { class: 'err ws-reason' }, reason) : h('span', { class: 'ok ws-reason' }, 'Ready to craft.')),
    ui.ws_last && ui.ws_last.area === 'smith' ? h('p', { class: `ws-last ${ui.ws_last.ok ? '' : 'err'}` }, h('span', { class: 'muted' }, 'Last: '), ui.ws_last.msg) : null);

  // ---- reference: every slot at this material/grade
  const mult = cfg.gear.materialMult[mat] * cfg.gear.gradeMult[grade];
  const slotRef = tbl(
    ['Slot', { v: 'Bars', cls: 'num' }, { v: 'Time', cls: 'num' }, ...BASE_STATS.map((k) => ({ v: statLabel(k), cls: 'num' }))],
    SLOTS.map((sl) => {
      const st2 = gearStats({ slot: sl, material: mat, grade, gem: null }, cfg);
      return {
        attrs: { class: sl === slot ? 'ws-selrow' : '' },
        cells: [cap(sl), { v: String(cfg.gear.slots[sl].bars), cls: 'num' }, { v: `${craftMinutes(sl, false, cfg)}m`, cls: 'num' },
          ...BASE_STATS.map((k) => (st2[k] ? { v: num(st2[k]), cls: 'num' } : { v: '–', cls: 'num ws-zero' }))],
      };
    }), 'ws-compact');

  // ---- reference: gem effects at the chosen gem grade
  const gGrade = ui.ws_gemGrade;
  const gi = GRADES.indexOf(gGrade); // config tables are indexed D..S
  let gemRef;
  if (gem) {
    const fx = cfg.gemEffects[gem.type];
    gemRef = [
      h('h4', {}, `${cap(gem.type)} ${gGrade} infusion by slot`),
      h('div', { class: 'ws-scroll' }, tbl(['Slot', { v: 'Strength', cls: 'num' }, 'Bonus added'], SLOTS.map((sl) => {
        const m = sl === 'sword' ? 1 : cfg.gear.gemArmorMult[sl];
        return {
          attrs: { class: sl === slot ? 'ws-selrow' : '' },
          cells: [`${cap(sl)} (${sl === 'sword' ? 'weapon' : 'armor'})`, { v: `×${m}`, cls: 'num' }, fxText(sl === 'sword' ? fx.weapon : fx.armor, gi, m)],
        };
      }), 'ws-compact')),
    ];
  } else {
    gemRef = [
      h('h4', {}, `Gem effects at grade ${gGrade}`),
      h('div', { class: 'ws-scroll' }, tbl(['Gem', 'On a sword', 'On armor (×1)'], GEMS.map((t) => [cap(t), fxText(cfg.gemEffects[t].weapon, gi), fxText(cfg.gemEffects[t].armor, gi)]), 'ws-compact')),
    ];
  }
  const armorMults = Object.entries(cfg.gear.gemArmorMult).filter(([, m]) => m !== 1).map(([sl, m]) => `${sl} ×${m}`).join(', ');

  const reference = h('div', { class: 'ws-ref' },
    h('h4', {}, `All slots at ${grade} ${cap(mat)} (stats ×${num(mult, 2)})`),
    h('div', { class: 'ws-scroll' }, slotRef),
    gemRef,
    h('div', { class: 'ws-sub' }, `Armor gem effects are stronger on some slots: ${armorMults}. The gem's grade does not depend on the bars' grade.`));

  return section('Smith gear',
    h('div', { class: 'ws-smith' }, h('div', {}, form, preview), reference));
}

// --------------------------------------------------------------------- gear ----
function repairBlock(s, item, info, blocked, cfg) {
  if (item.packed) return 'With the adventurer today';
  if (item.durability >= 100) return 'At 100%';
  if (blocked) return `Workshop closed: ${blocked}`;
  for (const [k, n] of Object.entries(info.bars)) {
    if (!enough(s.storage.bars[k], n)) return `Need ${qty(n)} ${k.replace(':', ' ')} bars (have ${qty(s.storage.bars[k] || 0)})`;
  }
  for (const [k, n] of Object.entries(info.gems)) {
    if (!enough(s.storage.cut[k], n)) return `Need ${qty(n)} cut ${k.replace(':', ' ')} (have ${qty(s.storage.cut[k] || 0)})`;
  }
  if (s.time + info.minutes > cfg.time.dayEndMin + EPS) return 'Not enough time left today';
  return null;
}

function gearPanel(ctx, blocked) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const power = (g) => cfg.gear.materialMult[g.material] * cfg.gear.gradeMult[g.grade];
  const items = [...s.gear].sort((a, b) => SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot) || power(b) - power(a) || a.id - b.id);
  const packedCount = items.filter((g) => g.packed).length;
  const title = `Gear (${items.length} item${items.length === 1 ? '' : 's'}${packedCount ? `, ${packedCount} with the adventurer today` : ''})`;
  if (!items.length) return section(title, h('p', { class: 'muted' }, 'No gear yet. Smith something above.'));

  const rows = items.map((item) => {
    const info = repairInfo(item, cfg);
    const why = repairBlock(s, item, info, blocked, cfg);
    const d = item.durability;
    const costBits = [
      ...Object.entries(info.bars).map(([k, n]) => {
        const [m, g] = k.split(':');
        return h('span', { class: enough(s.storage.bars[k], n) ? '' : 'err' }, `${qty(n)} ${cap(m)} ${g} bar`);
      }),
      ...Object.entries(info.gems).map(([k, n]) => {
        const [t, g] = k.split(':');
        return h('span', { class: enough(s.storage.cut[k], n) ? '' : 'err' }, `${qty(n)} cut ${cap(t)} ${g}`);
      }),
    ];
    const repairCell = d >= 100
      ? h('span', { class: 'muted' }, 'Full durability')
      : h('div', {},
        h('div', {}, costBits.map((c, i) => [i ? ' + ' : '', c]), h('span', { class: 'muted' }, ` · ${num(info.minutes)}m`)),
        h('div', { class: 'row ws-repair-row' },
          h('button', {
            class: 'small',
            disabled: !!why,
            title: why || `Repair ${info.missing}% for ${num(info.minutes)}m`,
            onclick: () => ctx.act(() => repair(ctx.state, item.id, cfg), { toast: true }),
          }, `Repair +${info.missing}%`),
          why ? h('span', { class: 'ws-reason muted' }, why) : null));
    const scrapWhy = item.packed ? 'With the adventurer today' : blocked ? `Workshop closed: ${blocked}` : null;
    return {
      attrs: { class: item.packed ? 'ws-packed' : '' },
      cells: [
        h('div', {}, h('b', { class: `grade-${item.grade}` }, gearName(item)),
          item.packed ? h('div', {}, h('span', { class: 'chip ws-chip-packed' }, 'with the adventurer today')) : null),
        h('span', { class: 'ws-statstext' }, statsText(gearStats(item, cfg))),
        h('div', { class: 'ws-durcell' }, bar(d, `ws-dur ${d >= 60 ? 'hi' : d >= 30 ? 'mid' : 'lo'}`), h('span', { class: 'num' }, `${num(d)}%`)),
        repairCell,
        h('button', {
          class: 'small ghost ws-scrap',
          disabled: !!scrapWhy,
          title: scrapWhy || 'Destroy this item. No materials are returned.',
          onclick: () => {
            if (confirm(`Scrap ${gearName(item)}? It is destroyed and no materials are returned.`)) ctx.act(() => scrap(ctx.state, item.id), { toast: true });
          },
        }, 'Scrap'),
      ],
    };
  });

  return section(title,
    h('p', { class: 'ws-sub ws-intro' }, `Repairs always go back to 100%. A full repair costs ${cfg.gear.repair.materialFraction}% of the original bars (and gem) and ${cfg.gear.repair.timeFraction}% of the smithing time, scaled by the % repaired.`),
    h('div', { class: 'ws-scroll' }, tbl(['Item', 'Stats', 'Durability', 'Repair to 100%', ''], rows, 'ws-gear')));
}
