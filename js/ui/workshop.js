// Workshop tab: storage and gear overview, refining ore, cutting gems, smithing gear, the gear list (repair / scrap).
// All game-state changes go through core actions inside ctx.act(). UI-only state lives in ctx.ui.ws_*.
// Order: status line, Storage and gear (ui/inventory.js), Refine, Cut, Smith, Gear (ui/gearlist.js).
import { h, section, num, tip } from './dom.js';
import { BARS, GEMS, SLOTS, GRADES } from '../config.js';
import { refine, cut, repeat, refineDistribution, cutDistribution, refineMinutes, cutMinutes, GRADE_ORDER } from '../core/processing.js';
import { craft, canCraft, craftCost, craftMinutes, smithMinutes, gearStats, gearName, STAT_LABELS, STAT_NAMES, fmtStat } from '../core/gear.js';
import { atCamp, timeLeft, returnMinutes } from '../core/map.js';
import { formatClock, formatDuration, cap, EPS } from '../core/util.js';
import { qty, repairAllInfo, repairAll } from './repairui.js';
import { processOutcome, processMessage, failedText } from './present.js';
import { inventoryPanel, keepInventoryScroll } from './inventory.js';
import { gearTable } from './gearlist.js';
import { gearStatsText } from './endday.js';

const OUTCOMES = GRADE_ORDER; // F D C B A S: lowest on the left, highest on the right
const BEST_FIRST = [...GRADES].reverse(); // S A B C D (for picking the best grade in stock)
const BASE_STATS = ['damage', 'accuracy', 'defense', 'dodge', 'speed'];

// ------------------------------------------------------------------ helpers ----
const enough = (have, need) => (have || 0) + EPS >= need;
const outcomeLabel = (g) => (g === 'F' ? 'Fail' : g);
// pierce resistance is a % of the enemy's piercing ignored
const statLabel = (k) => (k === 'pierceRes' ? 'Pierce resistance %' : STAT_LABELS[k] || k);
const mins = (m) => formatDuration(m);

// "Damage, accuracy and speed" from stat keys.
function listText(names) {
  const lower = names.map((n, i) => (i ? n.toLowerCase() : n));
  return lower.length < 2 ? lower.join('') : `${lower.slice(0, -1).join(', ')} and ${lower[lower.length - 1]}`;
}

// Small table. Cells: string | Node | { v, cls, title, span }. Rows: array of cells, or { attrs, cells }.
// A cell title is a tip(): it also opens on a tap.
function tbl(head, rows, cls = '') {
  const cell = (tag, c) => {
    if (c && typeof c === 'object' && !(c instanceof Node) && !Array.isArray(c) && 'v' in c) {
      return h(tag, { class: c.cls, colspan: c.span, ...(c.title ? tip(c.title) : {}) }, c.v);
    }
    return h(tag, {}, c);
  };
  return h('table', { class: `ws-table ${cls}` },
    head ? h('thead', {}, h('tr', {}, head.map((c) => cell('th', c)))) : null,
    h('tbody', {}, rows.map((r) => (Array.isArray(r) ? h('tr', {}, r.map((c) => cell('td', c))) : h('tr', r.attrs || {}, r.cells.map((c) => cell('td', c)))))));
}

// Why workshop actions are unavailable right now (null = available).
function blockReason(state) {
  if (state.phase !== 'work') return 'The work day is over.';
  if (!atCamp(state)) return 'You are out in a field.';
  return null;
}

function bestGrade(stock, prefix, need) {
  return BEST_FIRST.find((g) => enough(stock[`${prefix}:${g}`], need)) || null;
}

// Best grade with enough stock; else the grade with the most stock; else `current`.
function pickGrade(stock, prefix, need, current) {
  const best = bestGrade(stock, prefix, need);
  if (best) return best;
  let most = null;
  for (const g of BEST_FIRST) if ((stock[`${prefix}:${g}`] || 0) > EPS && (!most || stock[`${prefix}:${g}`] > stock[`${prefix}:${most}`])) most = g;
  return most || current;
}

// The result box of the last action in an area: green, or red when it was refused or any attempt failed. The part of a
// batch message that says how many failed is bold.
function resultBox(last) {
  const parts = last.bold && last.msg.includes(last.bold) ? last.msg.split(last.bold) : null;
  return h('p', { class: `ws-last ws-result ${last.tone}`, 'data-tone': last.tone },
    h('span', { class: 'muted' }, 'Last: '),
    parts ? [parts[0], h('b', {}, last.bold), parts.slice(1).join(last.bold)] : last.msg);
}

// --------------------------------------------------------------------- main ----
export function renderWorkshop(root, ctx) {
  const blocked = blockReason(ctx.state);
  root.append(h('div', { class: 'ws' },
    statusBar(ctx, blocked),
    inventoryPanel(ctx, { onGear: (slot, material) => pickGear(ctx, slot, material), onGem: (gem) => pickGem(ctx, gem) }),
    processPanel(ctx, 'refine', blocked),
    processPanel(ctx, 'cut', blocked),
    smithPanel(ctx, blocked),
    gearPanel(ctx, blocked)));
  keepInventoryScroll(root, ctx); // a click in the overview re-renders: keep its scroll boxes where the player had them
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
      ? h('span', {}, h('b', {}, mins(left)), ` of work time left today (day ends ${formatClock(cfg.time.dayEndMin)})`)
      : h('span', { class: 'warn' }, 'No work time left today. End the day from the top bar.'));
}

// A click on a gear cell of the overview picks that gear type and material in the smith form; a click on a gem row picks the gem.
function pickGear(ctx, slot, material) {
  const ui = ctx.ui;
  ui.ws_slot = slot;
  ui.ws_mat = material;
  ui.ws_grade = pickGrade(ctx.state.storage.bars, material, ctx.cfg.gear.slots[slot].bars, ui.ws_grade);
  ctx.rerender();
}

function pickGem(ctx, gem) {
  ctx.ui.ws_gem = gem;
  ctx.ui.ws_gemGrade = pickGrade(ctx.state.storage.cut, gem, 1, ctx.ui.ws_gemGrade || 'D');
  ctx.rerender();
}

// ------------------------------------------------------- refine / cut panels ----
// Outcome header: Fail D C B A S, lowest on the left.
function distHeader() {
  return h('div', { class: 'ws-dist' }, h('div', {}, 'Outcome chance %'),
    h('div', { class: 'ws-dist-nums' }, OUTCOMES.map((g) => h('span', { class: `grade-${g}` }, outcomeLabel(g)))));
}

const distNums = (dist) => h('div', { class: 'ws-dist-nums' },
  OUTCOMES.map((g) => h('span', { class: !(dist[g] > EPS) ? 'ws-zero' : `grade-${g}` }, num(dist[g] || 0))));
const distSegs = (dist) => h('div', { class: 'ws-dist-bar' }, OUTCOMES.map((g) => (dist[g] > EPS
  ? h('span', { class: `ws-seg ws-seg-${g}`, style: { width: `${dist[g]}%` } })
  : null)));
const distText = (dist) => OUTCOMES.map((g) => `${outcomeLabel(g)} ${num(dist[g] || 0)}%`).join(', ');

// One bar and one row of numbers: your chances now. The hover has the base chances next to them.
function distView(dist, title) {
  return h('div', { class: 'ws-dist', ...tip(title) }, distSegs(dist), distNums(dist));
}

function processPanel(ctx, kind, blocked) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const isRefine = kind === 'refine';
  const left = timeLeft(s, cfg);
  const verb = isRefine ? 'Refine' : 'Cut';

  const rows = (isRefine ? BARS : GEMS).map((k) => {
    const def = isRefine ? cfg.refine[k] : cfg.cut[k];
    const inputs = isRefine
      ? Object.entries(def.input).map(([ore, n]) => ({ label: `${n} ${ore}`, need: n, have: s.storage.ore[ore] || 0 }))
      : [{ label: `1 raw ${k}`, need: 1, have: s.storage.gem[k] || 0 }];
    const minutes = isRefine ? refineMinutes(s, k, cfg) : cutMinutes(s, k, cfg);
    const dist = isRefine ? refineDistribution(s, k, cfg) : cutDistribution(s, k, cfg);
    const byMat = Math.min(...inputs.map((i) => Math.floor((i.have + EPS) / i.need)));
    const byTime = minutes > 0 ? Math.max(0, Math.floor((left + EPS) / minutes)) : Infinity;
    const n = Math.max(0, Math.min(byMat, byTime));

    const run = (max) => ctx.act(() => {
      const st = ctx.state;
      const one = () => (isRefine ? refine(st, k, cfg) : cut(st, k, cfg));
      const res = max === 1 ? one() : repeat(st, one, max);
      const out = processOutcome(res);
      res.msg = processMessage(kind, k, res);
      res.tone = out.tone; // the toast takes the same colour as the result box
      ctx.ui.ws_last = { area: kind, tone: out.tone, msg: res.msg, bold: failedText(res) };
      return res;
    }, { toast: true });

    // your chances now; refining's hover adds the base chances. A gem shows only your current chances (R18): no novice or master table.
    const outcomeTip = isRefine
      ? `Your chances: ${distText(dist)}. Base chances: ${distText(def.dist)}. Your skills and rings make the difference (see Skills).`
      : `Your chances: ${distText(dist)}. Your skills and rings make the difference (see Skills).`;

    let makeSub;
    if (byMat === 0) makeSub = h('div', { class: 'ws-sub' }, isRefine ? 'not enough ore' : 'no raw gems');
    else if (byTime < byMat) makeSub = h('div', { class: 'ws-sub warn' }, `time-limited (material for ${byMat})`);
    else makeSub = h('div', { class: 'ws-sub' }, `all: ${mins(n * minutes)}`);
    if (byMat > 0 && byTime < byMat && n > 0) makeSub = [makeSub, h('div', { class: 'ws-sub' }, `all: ${mins(n * minutes)}`)];

    const btn = (label, count, max) => h('button', {
      class: 'small',
      disabled: !!blocked || n < count,
      'data-run': `${kind}:${k}:${max === Infinity ? 'all' : max}`,
      ...tip(blocked ? `Workshop closed: ${blocked}`
        : n < count ? `Can make only ${n} right now`
          : `${verb} ${max === Infinity ? n : count} (${mins((max === Infinity ? n : count) * minutes)})`),
      onclick: () => run(max),
    }, label);

    // Bar | Needs (you have) | Outcome chance | You can make | Time each | buttons
    return [
      h('div', {}, h('b', {}, cap(k), isRefine ? ' bar' : '')),
      h('div', {}, inputs.map((i) => h('div', {}, i.label, ' ',
        h('span', { class: enough(i.have, i.need) ? 'ok' : 'err' }, `(have ${qty(i.have)})`)))),
      distView(dist, outcomeTip),
      h('div', {}, h('b', { class: 'ws-big' }, String(n)), makeSub),
      { v: `${num(minutes)}m`, cls: 'num', title: `Base ${def.minutes}m. Your skills and rings make it faster (see Skills).` },
      h('div', { class: 'ws-btns' }, btn(`${verb} 1`, 1, 1), btn(`${verb} 5`, 5, 5), btn(`${verb} all${n > 0 ? ` (${n})` : ''}`, 1, Infinity)),
    ];
  });

  const last = ctx.ui.ws_last && ctx.ui.ws_last.area === kind ? ctx.ui.ws_last : null;
  return section(isRefine ? 'Refine ore into bars' : 'Cut gems',
    h('p', { class: 'ws-sub ws-intro' }, isRefine
      ? 'Each bar rolls a grade from D (lowest) to S (highest). On a fail the ore is lost.'
      : 'Each cut gem rolls a grade from D to S. On a fail the gem is lost. You get better the more you cut of each gem.'),
    h('div', { class: 'ws-scroll' },
      tbl([isRefine ? 'Bar' : 'Gem', 'Needs (you have)', distHeader(), 'You can make', { v: 'Time each', cls: 'num' }, ''], rows, 'ws-process')),
    last ? resultBox(last) : null);
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
  if (!GRADES.includes(ui.ws_grade)) ui.ws_grade = pickGrade(st.bars, ui.ws_mat, need, 'D');
  if (ui.ws_gem !== '' && !GEMS.includes(ui.ws_gem)) ui.ws_gem = '';
  if (!GRADES.includes(ui.ws_gemGrade)) ui.ws_gemGrade = ui.ws_gem ? pickGrade(st.cut, ui.ws_gem, 1, 'D') : 'D';
}

function gradeButtons(selected, counts, need, onPick, unit) {
  return h('div', { class: 'ws-gbtns' }, GRADES.map((g) => {
    const have = counts[g] || 0;
    const short = !enough(have, need);
    return h('button', {
      class: `ws-gbtn${g === selected ? ' sel' : ''}${short ? ' short' : ''}`,
      'data-grade': g,
      ...tip(`${qty(have)} ${unit(g)} in stock${short ? ` (need ${need})` : ''}`),
      onclick: () => onPick(g),
    }, h('b', { class: `grade-${g}` }, g), ' ', h('span', { class: short ? 'ws-zero' : '' }, qty(have)));
  }));
}

// A choosable tile: a label and a small line under it. `short` draws it dashed (you cannot make it from what you have).
function tile(label, sub, { sel, short, hover, onPick, data }) {
  return h('button', {
    class: `ws-tile${sel ? ' sel' : ''}${short ? ' short' : ''}`,
    ...(data || {}),
    ...(hover ? tip(hover) : {}),
    onclick: onPick,
  }, h('b', {}, label), sub ? h('span', { class: 'ws-tile-sub' }, sub) : null);
}

function fxText(effects, gi, mult = 1) {
  return Object.entries(effects).map(([k, arr]) => fmtStat(k, arr[gi] * mult)).join(', ');
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
  const matGrades = (m) => GRADES.filter((g) => (st.bars[`${m}:${g}`] || 0) > EPS);
  const matTotal = (m) => GRADES.reduce((a, g) => a + (st.bars[`${m}:${g}`] || 0), 0);
  const gemTotal = (t) => GRADES.reduce((a, g) => a + (st.cut[`${t}:${g}`] || 0), 0);

  // ---- form: tiles, no drop-downs
  const slotTiles = SLOTS.map((sl) => {
    const n = cfg.gear.slots[sl].bars;
    const stats = listText(Object.keys(cfg.gear.slots[sl].stats).map((k) => (STAT_NAMES[k] ? STAT_NAMES[k][0] : k)));
    return tile(cap(sl), `${n} bars`, {
      sel: sl === slot,
      data: { 'data-slot': sl },
      hover: `${cap(sl)}: ${n} bars, ${num(smithMinutes(s, sl, mat, false, cfg))}m to smith. ${stats}.`,
      onPick: () => pick(() => {
        ui.ws_slot = sl;
        if (!enough(st.bars[`${ui.ws_mat}:${ui.ws_grade}`], n)) ui.ws_grade = pickGrade(st.bars, ui.ws_mat, n, ui.ws_grade);
      }),
    });
  });
  const matTiles = BARS.map((m) => {
    const short = !bestGrade(st.bars, m, need);
    const have = matGrades(m);
    return tile(cap(m), have.length ? have.map((g) => `${g} ${qty(st.bars[`${m}:${g}`])}`).join(' · ') : 'none', {
      sel: m === mat,
      short,
      data: { 'data-material': m },
      hover: `${cap(m)}: stats ×${cfg.gear.materialMult[m]}. You have ${qty(matTotal(m))} ${m} bars.${short ? ` Not enough of one grade for a ${slot} (needs ${need}).` : ''}`,
      onPick: () => pick(() => {
        ui.ws_mat = m;
        ui.ws_grade = pickGrade(st.bars, m, need, ui.ws_grade);
      }),
    });
  });
  const gemTiles = [
    tile('None', 'no gem', { sel: !gem, data: { 'data-gem': 'none' }, hover: 'No gem: a plain item.', onPick: () => pick(() => { ui.ws_gem = ''; }) }),
    ...GEMS.map((t) => {
      // a repair uses a part of a cut gem, so the stock can be 0.82 of one: not enough to infuse (it takes a whole gem of one grade)
      const short = !bestGrade(st.cut, t, 1);
      return tile(cap(t), `${qty(gemTotal(t))} cut`, {
        sel: !!gem && gem.type === t,
        short,
        data: { 'data-gem': t },
        hover: `${cap(t)}: ${qty(gemTotal(t))} cut gems in stock.${short && gemTotal(t) > EPS ? ' No grade has a whole gem left (repairs use parts of one), so there is nothing to infuse.' : ''} Infusing adds ${cfg.gear.infuseMin}m and uses 1 cut gem.`,
        onPick: () => pick(() => {
          ui.ws_gem = t;
          ui.ws_gemGrade = pickGrade(st.cut, t, 1, ui.ws_gemGrade);
        }),
      });
    }),
  ];

  const form = h('div', { class: 'ws-form' },
    h('span', {}, 'Gear type'), h('div', { class: 'ws-tiles' }, slotTiles),
    h('span', {}, 'Material'), h('div', { class: 'ws-tiles' }, matTiles),
    h('span', {}, 'Bar grade'),
    h('div', {},
      gradeButtons(grade, Object.fromEntries(GRADES.map((g) => [g, st.bars[`${mat}:${g}`]])), need,
        (g) => pick(() => (ui.ws_grade = g)), (g) => `${mat} ${g} bars`),
      h('div', { class: 'ws-sub' }, `Needs ${need} ${mat} bars of one grade. Grade multiplies stats: `,
        GRADES.map((g) => `${g} ×${cfg.gear.gradeMult[g]}`).join(', '), '.')),
    h('span', {}, 'Gem'), h('div', { class: 'ws-tiles' }, gemTiles),
    gem ? h('span', {}, 'Gem grade') : null,
    gem
      ? h('div', {},
        gradeButtons(ui.ws_gemGrade, Object.fromEntries(GRADES.map((g) => [g, st.cut[`${gem.type}:${g}`]])), 1,
          (g) => pick(() => (ui.ws_gemGrade = g)), (g) => `cut ${gem.type} ${g}`),
        h('div', { class: 'ws-sub' }, `Infusing adds ${cfg.gear.infuseMin}m and uses 1 cut gem.`))
      : null);

  // ---- preview: no durability (a new item is always at 100%)
  const mock = { slot, material: mat, grade, gem };
  const baseMinutes = craftMinutes(slot, !!gem, cfg);
  const minutes = smithMinutes(s, slot, mat, !!gem, cfg);
  const cost = craftCost(spec, cfg);
  let reason = blocked ? `Workshop closed: ${blocked}` : canCraft(s, spec, cfg);
  if (!reason && s.time + minutes > cfg.time.dayEndMin + EPS) reason = `Not enough time left today (needs ${mins(minutes)}, ${mins(Math.max(0, left))} left).`;

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
  const timeTip = `${need} bars × ${cfg.gear.smithMinPerBar}m${gem ? ` + ${cfg.gear.infuseMin}m gem` : ''} = ${mins(baseMinutes)} before your ${cap(mat)} smithing skill.`;

  const preview = h('div', { class: 'ws-preview' },
    h('div', { class: 'ws-preview-name' }, 'Result: ', h('b', { class: `grade-${grade}` }, gearName(mock))),
    h('div', { class: 'ws-statsline' }, gearStatsText(mock, cfg)),
    h('div', { class: 'ws-cost' },
      h('div', {}, h('span', { class: 'muted' }, 'Cost: '), costLines.map((c, i) => [i ? ', ' : '', c.text, ' ',
        h('span', { class: enough(c.have, c.n) ? 'ok' : 'err' }, `(have ${qty(c.have)})`)])),
      h('div', { class: 'ws-time' }, h('span', { class: 'muted' }, 'Time: '), h('b', { ...tip(timeTip) }, mins(minutes)),
        !blocked && !reason ? h('span', { class: 'muted' }, ` · done at ${formatClock(s.time + minutes)}`) : null)),
    h('div', { class: 'row ws-craft-row' },
      h('button', {
        class: 'primary',
        id: 'ws-craft',
        disabled: !!reason,
        ...tip(reason || `Craft ${gearName(mock)}`),
        onclick: () => ctx.act(() => {
          const res = craft(ctx.state, spec, cfg);
          ctx.ui.ws_last = { area: 'smith', tone: res.ok ? 'ok' : 'err', msg: res.msg };
          if (res.ok) {
            // the next item starts plain: the gem picker goes back to None, and the bar grade is re-picked if it ran short
            ctx.ui.ws_gem = '';
            ctx.ui.ws_gemGrade = null;
            if (!enough(ctx.state.storage.bars[`${mat}:${grade}`], need)) ctx.ui.ws_grade = pickGrade(ctx.state.storage.bars, mat, need, grade);
          }
          return res;
        }, { toast: true }),
      }, `Craft (${mins(minutes)})`),
      reason ? h('span', { class: 'err ws-reason' }, reason) : h('span', { class: 'ok ws-reason' }, 'Ready to craft.')),
    ui.ws_last && ui.ws_last.area === 'smith' ? resultBox(ui.ws_last) : null);

  // ---- reference (closed): every gear type at this material and grade, and the gem effects
  const mult = cfg.gear.materialMult[mat] * cfg.gear.gradeMult[grade];
  const slotRef = tbl(
    ['Gear type', { v: 'Bars', cls: 'num' }, { v: 'Time', cls: 'num' }, ...BASE_STATS.map((k) => ({ v: statLabel(k), cls: 'num' }))],
    SLOTS.map((sl) => {
      const st2 = gearStats({ slot: sl, material: mat, grade, gem: null }, cfg);
      return {
        attrs: { class: sl === slot ? 'ws-selrow' : '' },
        cells: [cap(sl), { v: String(cfg.gear.slots[sl].bars), cls: 'num' }, { v: `${num(smithMinutes(s, sl, mat, false, cfg))}m`, cls: 'num' },
          ...BASE_STATS.map((k) => (st2[k] ? { v: num(st2[k]), cls: 'num' } : { v: '–', cls: 'num ws-zero' }))],
      };
    }), 'ws-compact');

  const gGrade = ui.ws_gemGrade;
  const gi = GRADES.indexOf(gGrade); // config tables are indexed D..S
  let gemRef;
  if (gem) {
    const fx = cfg.gemEffects[gem.type];
    gemRef = [
      h('h4', {}, `${cap(gem.type)} ${gGrade} infusion by gear type`),
      h('div', { class: 'ws-scroll' }, tbl(['Gear type', { v: 'Strength', cls: 'num' }, 'Bonus added'], SLOTS.map((sl) => {
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
      h('div', { class: 'ws-gbtns' }, GRADES.map((g) => h('button', {
        class: `ws-gbtn${g === gGrade ? ' sel' : ''}`,
        ...tip('Grade used for this table'),
        onclick: () => pick(() => (ui.ws_gemGrade = g)),
      }, h('b', { class: `grade-${g}` }, g)))),
      h('div', { class: 'ws-scroll' }, tbl(['Gem', 'On a sword', 'On armor (×1)'], GEMS.map((t) => [cap(t), fxText(cfg.gemEffects[t].weapon, gi), fxText(cfg.gemEffects[t].armor, gi)]), 'ws-compact')),
    ];
  }
  const armorMults = Object.entries(cfg.gear.gemArmorMult).filter(([, m]) => m !== 1).map(([sl, m]) => `${sl} ×${m}`).join(', ');

  // the panel starts closed but keeps its state in ctx.ui.ws_refOpen: picking a tile or a grade redraws the tab
  const remember = (v) => { ui.ws_refOpen = v; };
  const reference = h('details', { class: 'ws-refbox', open: !!ui.ws_refOpen },
    h('summary', { onclick: () => remember(!reference.open) }, 'Compare all gear types and gem effects'),
    h('div', { class: 'ws-ref' },
      h('h4', {}, `All gear types at ${grade} ${cap(mat)} (stats ×${num(mult, 2)})`),
      h('div', { class: 'ws-scroll' }, slotRef),
      gemRef,
      h('div', { class: 'ws-sub' }, `Armor gem effects are stronger on some gear types: ${armorMults}. The gem's grade does not depend on the bars' grade.`)));
  // click fires before the browser toggles (so the state is saved even if a redraw follows at once); toggle also covers find-in-page
  reference.addEventListener('toggle', () => remember(reference.open));

  return section('Smith gear', h('div', { class: 'ws-smith' }, form, preview), reference);
}

// --------------------------------------------------------------------- gear ----
function gearPanel(ctx, blocked) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const packedCount = s.gear.filter((g) => g.packed).length;
  const title = `Gear (${s.gear.length} item${s.gear.length === 1 ? '' : 's'}${packedCount ? `, ${packedCount} with the adventurer today` : ''})`;
  if (!s.gear.length) return section(title, h('p', { class: 'muted' }, 'No gear yet. Smith something above.'));

  const all = repairAllInfo(s, cfg);
  const rep = cfg.gear.repair;
  // the gem is its own lever (gemFraction), not the bars' share: say it separately, and leave it out when repairs cost no gem
  const gemShare = rep.gemFraction > 0 ? ` (and ${rep.gemFraction}% of its gem)` : '';
  const allWhy = blocked ? `Workshop closed: ${blocked}` : !all.ids.length ? 'Nothing can be repaired right now (everything is at 100%, with the adventurer, or short of bars or time).' : null;
  return section(title,
    h('p', { class: 'ws-sub ws-intro' }, `Repairs always go back to 100%. You can repair at camp during the day, only gear the adventurer does not have today. A full repair costs ${rep.materialFraction}% of the item's bars${gemShare} and ${rep.timeFraction}% of the time it takes to smith it, scaled by the % repaired; the repair skills make it faster. `,
      'If you lack the item\'s own grade, the lowest higher grade you have enough of is used instead (no extra benefit). Scrapping gives back ',
      `${rep.materialFraction}% of the bars, scaled by the durability left (the gem is lost).`),
    h('div', { class: 'row ws-repairall' }, h('button', {
      disabled: !!allWhy,
      id: 'ws-repair-all',
      ...tip(allWhy || `Repair ${all.ids.length} item${all.ids.length === 1 ? '' : 's'}, best first, until the bars or the time run out.`),
      onclick: () => ctx.act(() => repairAll(ctx.state, cfg), { toast: true }),
    }, all.ids.length ? `Repair all (${all.ids.length}) · ${mins(all.minutes)}` : 'Repair all')),
    gearTable(ctx, s.gear, { scrap: true, blocked }));
}
