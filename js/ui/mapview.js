// Map tab: the 5x5 world map, the 8x8 field grid with its actions, the field's pile, the bag and the
// "choose what to carry" step when you leave a field.
// All game-state changes go through core functions inside ctx.act(). UI-only state lives in ctx.ui under
// the map_ prefix: map_sel (selected cell per field), map_new (pile items just found: { fkey, start, end }),
// map_leave (open carry step: { from, to, bag: [bag idx], pile: [pile idx] }), map_legend (legend open).
import { h, section, bar, clear } from './dom.js';
import {
  travel, search, moveToPile, takeFromPile, defaultCarry, travelMinutes, returnMinutes, searchMinutes,
  searchEfficiency, searchEfficiencyRange, debrisClearMult, projectedLoad, fitsWithReturn, cellOpen,
  fieldProgress, areaCells, atCamp, currentField, mapCell, itemKind, itemType, key, timeLeft, sameLoc,
} from '../core/map.js';
import { smithBonuses } from '../core/bonuses.js';
import { formatClock, formatDuration, cap, round1, clamp } from '../core/util.js';
import { ORES, GEMS } from '../config.js';

const EPS = 1e-9;
const ABBR = { copper: 'Cu', iron: 'Fe', coal: 'Co', mythril: 'My', ruby: 'Ru', topaz: 'To', sapphire: 'Sa', emerald: 'Em', diamond: 'Di' };
// Display order, rarest first (the same order core defaultCarry uses for "Rarest first").
const RARITY = ['ore:mythril', 'gem:diamond', 'gem:emerald', 'gem:sapphire', 'gem:topaz', 'gem:ruby', 'ore:coal', 'ore:iron', 'ore:copper'];
const rarity = (t) => {
  const i = RARITY.indexOf(t);
  return i < 0 ? RARITY.length : i;
};

// ------------------------------------------------------------- formatting ----
const dur = (m) => (Number.isFinite(m) ? formatDuration(Math.max(0, m)) : 'no path');
const clock = (m) => formatClock(m);
// "3.5%" below 10, otherwise whole numbers rounded down (so 99.6% never reads as 100%).
const pctText = (v) => `${v > 0 && v < 10 ? round1(v) : Math.floor(v + 1e-6)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Remaining debris thickness, rounded up (0.3 left still reads as 1, never as 0).
const dn = (v) => String(Math.max(0, Math.ceil(v - 1e-6)));

// Search depth per search: each cell rolls its own amount in [lo, hi] around the average.
// Returns { eff, lo, hi, range: '30–40%', avg: '35%', finish: '3–4' (searches to finish a cell) }.
function searchDepth(state, cfg) {
  const eff = searchEfficiency(state, cfg);
  const [lo, hi] = searchEfficiencyRange(state, cfg);
  const toFinish = (e) => (e > 0 ? String(Math.ceil(100 / e - 1e-9)) : '?');
  const finish = toFinish(hi) === toFinish(lo) ? toFinish(hi) : `${toFinish(hi)}–${toFinish(lo)}`;
  return {
    eff, lo, hi,
    range: hi - lo > EPS ? `${round1(lo)}–${round1(hi)}%` : `${round1(eff)}%`,
    avg: `${round1(eff)}%`,
    random: hi - lo > EPS,
    finish,
  };
}

// Debris clearing power per cell per search = the cell's effort roll x (1 + debris skill %).
function clearPower(state, cfg) {
  const mult = debrisClearMult(state, cfg);
  const eff = searchEfficiency(state, cfg);
  const [lo, hi] = searchEfficiencyRange(state, cfg);
  return {
    mult,
    skillPct: (mult - 1) * 100,
    lo: lo * mult,
    hi: hi * mult,
    avg: eff * mult,
    range: hi - lo > EPS ? `${round1(lo * mult)}–${round1(hi * mult)}` : `${round1(eff * mult)}`,
  };
}

function itemName(t) {
  const type = itemType(t);
  return itemKind(t) === 'ore' ? `${cap(type)} ore` : `Raw ${type}`;
}

function itemTag(t) {
  const type = itemType(t);
  return h('span', { class: `mv-item mv-${itemKind(t)} mv-t-${type}`, title: itemName(t) }, ABBR[type] || type.slice(0, 2));
}

// [{ t, idxs: [indexes into list] }], rarest type first.
function groupByType(list) {
  const m = new Map();
  list.forEach((t, i) => {
    if (!m.has(t)) m.set(t, []);
    m.get(t).push(i);
  });
  return [...m.entries()].map(([t, idxs]) => ({ t, idxs })).sort((a, b) => rarity(a.t) - rarity(b.t));
}

// "Di ×3, Em ×1" chips for a list of item strings.
function countChips(list) {
  return groupByType(list).map((g) => h('span', { class: 'chip', title: itemName(g.t) }, itemTag(g.t), ` ×${g.idxs.length}`));
}

// 1-based "(x,y)" label for a field cell index.
function cellLabel(idx, n) {
  return `(${(idx % n) + 1},${Math.floor(idx / n) + 1})`;
}

const hasDebris = (c) => !c.boulder && c.debris > EPS;
const isDone = (c) => !c.boulder && !hasDebris(c) && c.searched >= 100 - EPS;
const pileOf = (field) => (field && field.pile) || [];

// ------------------------------------------------------------- selection ----
function getSel(ctx, fkey) {
  const n = ctx.cfg.field.size;
  const all = (ctx.ui.map_sel = ctx.ui.map_sel || {});
  if (!(fkey in all)) all[fkey] = n + 1; // default: cell (2,2), so the 3x3 area is the top-left corner
  return clamp(all[fkey], 0, n * n - 1);
}

function setSel(ctx, fkey, idx) {
  (ctx.ui.map_sel = ctx.ui.map_sel || {})[fkey] = idx;
}

// ---------------------------------------------------------------- actions ----
function doTravel(ctx, to, carry = null) {
  ctx.ui.map_new = null;
  return ctx.act(() => {
    const res = travel(ctx.state, { x: to.x, y: to.y }, ctx.cfg, carry);
    if (res.ok) ctx.ui.map_leave = null;
    return res;
  });
}

// Leaving a field: open the "choose what to carry" step when this field's pile has anything in it.
function startLeave(ctx, to) {
  const { state, cfg } = ctx;
  const field = currentField(state);
  if (!field || !pileOf(field).length) return doTravel(ctx, to);
  const sel = defaultCarry(state, cfg);
  ctx.ui.map_leave = { from: key(state.location.x, state.location.y), to: { x: to.x, y: to.y }, bag: sel.bag, pile: sel.pile };
  ctx.rerender();
  return null;
}

function cancelLeave(ctx) {
  ctx.ui.map_leave = null;
  ctx.rerender();
}

function doSearch(ctx, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  return ctx.act(() => {
    const field = currentField(state);
    const before = pileOf(field).length;
    const res = search(state, sel % n, Math.floor(sel / n), cfg);
    if (res.ok) ctx.ui.map_new = { fkey: key(state.location.x, state.location.y), start: before, end: pileOf(field).length };
    return res;
  }, { toast: true });
}

function doTake(ctx, pileIndex) {
  ctx.ui.map_new = null;
  return ctx.act(() => takeFromPile(ctx.state, pileIndex, ctx.cfg));
}

function doMoveToPile(ctx, bagIndex) {
  ctx.ui.map_new = null;
  return ctx.act(() => moveToPile(ctx.state, bagIndex, ctx.cfg));
}

// --------------------------------------------------------------- keyboard ----
let keyCtx = null;
let keysBound = false;

function bindKeys() {
  if (keysBound || typeof document === 'undefined') return;
  keysBound = true;
  document.addEventListener('keydown', onKey);
}

function onKey(e) {
  const ctx = keyCtx;
  if (!ctx || e.ctrlKey || e.metaKey || e.altKey) return;
  const { state, cfg } = ctx;
  if (state.phase !== 'work' || ctx.ui.tab !== 'map' || atCamp(state)) return;
  if (ctx.ui.map_leave) {
    if (e.key === 'Escape' && document.querySelector('.mv-root .mv-modal')) {
      e.preventDefault();
      cancelLeave(ctx);
    }
    return; // the carry step is open: no field shortcuts
  }
  const tag = (e.target && e.target.tagName) || '';
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
  if (!document.querySelector('.mv-root .mv-fieldgrid')) return;
  const n = cfg.field.size;
  const fkey = key(state.location.x, state.location.y);
  const sel = getSel(ctx, fkey);
  const moves = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (moves[e.key]) {
    const [dx, dy] = moves[e.key];
    const x = clamp((sel % n) + dx, 0, n - 1);
    const y = clamp(Math.floor(sel / n) + dy, 0, n - 1);
    setSel(ctx, fkey, y * n + x);
    e.preventDefault();
    ctx.rerender();
    return;
  }
  if (e.key.toLowerCase() === 's') {
    e.preventDefault();
    doSearch(ctx, sel);
  }
}

// ----------------------------------------------------------------- render ----
export function renderMap(root, ctx) {
  keyCtx = ctx;
  bindKeys();
  const wrap = h('div', { class: 'mv-root' });
  root.append(wrap);
  if (ctx.state.phase !== 'work') {
    ctx.ui.map_leave = null;
    wrap.append(section('Map', h('p', { class: 'muted' }, 'The work day is over.')));
    return;
  }
  if (atCamp(ctx.state)) {
    ctx.ui.map_leave = null;
    renderCamp(wrap, ctx);
  } else renderFieldView(wrap, ctx);
}

function renderCamp(wrap, ctx) {
  const { state } = ctx;
  wrap.append(h('div', { class: 'mv-two' },
    section('World map', worldMap(ctx, false),
      h('p', { class: 'muted mv-note' }, 'Click a field to walk there. Each tile shows its distance from camp, how much of it you have searched, and the walk from here. A blue badge = items waiting in that field\'s pile.')),
    section('Where to search?', campHint(ctx))));
  if (state.bag.length) wrap.append(bagPanel(ctx));
  wrap.append(section('What the fields hold, by distance from camp', oddsTable(ctx)));
  wrap.append(legend(ctx));
}

function renderFieldView(wrap, ctx) {
  const { state, cfg } = ctx;
  const field = currentField(state);
  const fkey = key(state.location.x, state.location.y);
  const sel = getSel(ctx, fkey);
  const load = projectedLoad(state, cfg);
  wrap.append(h('div', { class: 'mv-two' },
    h('div', {}, fieldPanel(ctx, field, fkey, sel)),
    h('div', {}, actionsPanel(ctx, field, sel), pilePanel(ctx, field, fkey), bagPanel(ctx), cellPanel(ctx, field, sel))));
  wrap.append(h('div', { class: 'mv-two' },
    section('World map', worldMap(ctx, true),
      h('p', { class: 'muted mv-note' }, `Click a field to travel there directly, or the camp to go home. You choose what to carry before you leave; times assume ${plural(load, 'item')} (+${load * cfg.map.loadPenaltyPerItem}% load), the most you can carry from here.`)),
    legend(ctx)));
  const leave = validLeave(ctx, field, fkey);
  if (leave) wrap.append(carryDialog(ctx, field, leave));
}

// -------------------------------------------------------------- world map ----
function worldMap(ctx, compact) {
  const { state } = ctx;
  const map = state.map;
  const grid = h('div', { class: `grid mv-world mv-worldmap${compact ? ' mv-compact' : ''}`, style: { gridTemplateColumns: `repeat(${map.size}, 1fr)` } });
  for (let y = 0; y < map.size; y++) for (let x = 0; x < map.size; x++) grid.append(worldTile(ctx, mapCell(map, x, y)));
  return grid;
}

function worldTile(ctx, c) {
  const { state, cfg } = ctx;
  const map = state.map;
  const here = state.location.x === c.x && state.location.y === c.y;
  const inField = !atCamp(state);
  // From a field, times assume the most you can carry (bag + this pile, up to the bag size).
  const items = inField ? projectedLoad(state, cfg) : state.bag.length;
  const load = items ? ` (carrying ${plural(items, 'item')})` : '';
  const go = (to) => (inField ? startLeave(ctx, to) : doTravel(ctx, to));
  if (c.type === 'blocked') {
    return h('div', { class: 'cell blocked', title: 'Impassable rock: paths go around it.' }, h('span', { class: 'mv-rock' }, ''));
  }
  if (c.type === 'camp') {
    const ret = here ? 0 : returnMinutes(state, state.location, items, cfg);
    return h('div', {
      class: `cell camp${here ? ' here' : ''}`,
      title: here ? 'Camp: you are here. Storage and workshop. The day can only be ended here.' : `Camp: walk back ${dur(ret)}${load}, arriving ${clock(state.time + ret)}. You choose what to carry first; arriving unloads it into storage.`,
      'data-camp': '1',
      onclick: here ? null : () => go(c),
    }, h('span', { class: 'mv-wm' },
      h('span', { class: 'mv-wm-p' }, 'Camp'),
      h('span', { class: 'mv-wm-t' }, here ? 'you are here' : `back ${dur(ret)}`)));
  }
  const field = map.fields[key(c.x, c.y)];
  const prog = fieldProgress(field);
  const there = here ? 0 : travelMinutes(state, state.location, c, items, cfg);
  const back = travelMinutes(state, c, map.camp, items, cfg);
  const fits = here || state.time + there + back <= cfg.time.dayEndMin + EPS;
  const pileN = pileOf(field).length;
  const title = [
    `Field (${c.x + 1},${c.y + 1}) · distance ${c.dist} from camp`,
    `Searched: ${pctText(prog)}`,
    here ? 'You are here.' : `Travel there: ${dur(there)}, then back to camp: ${dur(back)}${load}`,
    !here ? `Arrive ${clock(state.time + there)}${fits ? '' : ` - not enough time to get there and back by ${clock(cfg.time.dayEndMin)}`}` : null,
    pileN ? `${plural(pileN, 'item')} waiting in this field's pile` : null,
  ].filter(Boolean).join('\n');
  return h('div', {
    class: `cell field${here ? ' here' : ''}${fits ? '' : ' mv-far'}`,
    title,
    'data-x': c.x,
    'data-y': c.y,
    onclick: here ? null : () => go(c),
  },
  h('div', { class: 'fill', style: { height: `${prog}%` } }),
  pileN ? h('div', { class: 'mv-badge', title: `${plural(pileN, 'item')} in this field's pile` }, String(pileN)) : null,
  h('span', { class: 'mv-wm' },
    h('span', { class: 'mv-wm-d' }, `dist ${c.dist}`),
    h('span', { class: 'mv-wm-p' }, pctText(prog)),
    h('span', { class: 'mv-wm-t' }, here ? 'here' : dur(there))));
}

// Fields with items left in their pile: [{ c, n }], most first.
function fieldPiles(state) {
  return state.map.cells
    .filter((c) => c.type === 'field')
    .map((c) => ({ c, n: pileOf(state.map.fields[key(c.x, c.y)]).length }))
    .filter((p) => p.n > 0)
    .sort((a, b) => b.n - a.n || a.c.y - b.c.y || a.c.x - b.c.x);
}

// ---------------------------------------------------------------- at camp ----
function campHint(ctx) {
  const { state, cfg } = ctx;
  const f = cfg.field;
  const b = smithBonuses(state, cfg);
  const pw = clearPower(state, cfg);
  const fields = state.map.cells.filter((c) => c.type === 'field');
  const reachable = fields.filter((c) => {
    const there = travelMinutes(state, state.location, c, 0, cfg);
    const back = travelMinutes(state, c, state.map.camp, 0, cfg);
    return state.time + there + back <= cfg.time.dayEndMin + EPS;
  }).length;
  const left = timeLeft(state, cfg);
  const regrow = f.regrowPctPerDay || 0;
  const st = state.storage;
  const stored = [...ORES.map((o) => [`ore:${o}`, st.ore[o] || 0]), ...GEMS.map((g) => [`gem:${g}`, st.gem[g] || 0])].filter(([, v]) => v > 0);
  const piles = fieldPiles(state);
  const pileTotal = piles.reduce((a, p) => a + p.n, 0);
  const boulders = f.boulders || 0;
  return h('div', {},
    h('p', {}, 'Pick a field to search. ', h('b', {}, 'Farther fields are richer'), ' (more cells hold items, rarer ores) but the walk takes longer and eats into your day.'),
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Now'), h('span', {}, `${clock(state.time)} - ${left > 0 ? `${dur(left)} left` : 'day over'} (day ends ${clock(cfg.time.dayEndMin)})`),
      h('span', { class: 'muted' }, 'Walking'), h('span', {}, `${cfg.map.travelMinPerStep}m per step, +${cfg.map.loadPenaltyPerItem}% per item carried${b.travelPct ? `, -${round1(b.travelPct)}% (rings)` : ''}${b.returnPct ? `, -${round1(b.returnPct)}% more on the way home (skill)` : ''}`),
      h('span', { class: 'muted' }, 'Searching'), h('span', {}, (() => {
        const sd = searchDepth(state, cfg);
        return sd.random
          ? `${dur(searchMinutes(state, cfg))} per 3x3 area; each search digs ${sd.range} deeper into every cell (${sd.avg} avg, rolled per cell), so ${sd.finish} searches finish a cell`
          : `${dur(searchMinutes(state, cfg))} per 3x3 area; each search digs ${sd.avg} deeper into every cell, so ${sd.finish} searches finish a cell`;
      })()),
      h('span', { class: 'muted' }, 'Debris'), h('span', {}, `about ${f.debrisChance}% of cells, ${f.debrisAmount.min}-${f.debrisAmount.max} thick (number on the cell). Searching clears it first: ${pw.range} per cell per search${pw.skillPct > EPS ? ` (Debris clearing skill +${round1(pw.skillPct)}%)` : ''}; leftover effort searches the cell.${boulders ? ` ${plural(boulders, 'boulder')} per field can never be searched.` : ''}`),
      h('span', { class: 'muted' }, 'Carrying'), h('span', {}, `Found items go to that field's pile (no limit). When you leave a field you choose up to ${cfg.bag.slots} to carry; the rest waits in the pile.`),
      h('span', { class: 'muted' }, 'Field piles'), piles.length
        ? h('span', {}, `${plural(pileTotal, 'item')} in ${plural(piles.length, 'field')}: `, piles.map((p, i) => [i ? ' · ' : '', h('b', {}, `(${p.c.x + 1},${p.c.y + 1})`), ` ${p.n}`]))
        : h('span', { class: 'muted' }, 'none: nothing left behind in the fields'),
      h('span', { class: 'muted' }, 'Ore sight'), h('span', {}, `${round1(b.revealPct)}% chance per searched cell to reveal everything still in it`),
      h('span', { class: 'muted' }, 'Reachable'), h('span', { class: reachable ? '' : 'warn' }, `${reachable} of ${fields.length} fields are close enough to go to and be back by ${clock(cfg.time.dayEndMin)}`),
      h('span', { class: 'muted' }, 'Regrowth'), regrow > 0
        ? h('span', {}, `searched cells have a ${round1(regrow)}% chance each night to turn fresh and unsearched, with new hidden items`)
        : h('span', {}, 'none: fields do not regrow, a searched cell stays searched')),
    h('p', { class: 'muted mv-note' }, `You may only head out or search if there is still time to walk back by ${clock(cfg.time.dayEndMin)} with a full load (your bag plus the field's pile, up to ${cfg.bag.slots} items). The walk home itself is always allowed. Arriving at camp unloads what you carry into storage.`),
    h('div', { class: 'mv-stored' }, h('span', { class: 'muted' }, 'In storage: '),
      stored.length ? stored.map(([t, v]) => h('span', { class: 'chip' }, itemTag(t), ` ${v}`)) : h('span', { class: 'muted' }, 'no raw ore or gems yet')));
}

function normalize(weights) {
  const total = Object.values(weights).reduce((a, w) => a + Math.max(0, w), 0) || 1;
  const out = {};
  for (const [k, w] of Object.entries(weights)) out[k] = (Math.max(0, w) / total) * 100;
  return out;
}

function oddsTable(ctx) {
  const { state, cfg } = ctx;
  const f = cfg.field;
  const fields = state.map.cells.filter((c) => c.type === 'field');
  const dists = [...new Set(fields.map((c) => c.dist))].sort((a, b) => a - b);
  const countW = Object.entries(f.itemCountWeights);
  const avgCount = countW.reduce((a, [k, w]) => a + Number(k) * w, 0) / countW.reduce((a, [, w]) => a + w, 0);
  const counts = countW.filter(([, w]) => w > 0).map(([k]) => Number(k));
  const countRange = counts.length ? (Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : `${Math.min(...counts)}-${Math.max(...counts)}`) : '0';
  const cellsPerField = Math.max(0, f.size * f.size - (f.boulders || 0)); // boulders hold nothing
  const pctCell = (v) => (v > 0 ? `${Math.round(v)}%` : '-');
  const rows = dists.map((d) => {
    const at = fields.filter((c) => c.dist === d);
    const loot = Math.min(f.lootChance.max, f.lootChance.base + f.lootChance.perDistance * (d - 1));
    const lootDebris = Math.min(100, loot + f.debrisLootBonus);
    const expItems = cellsPerField * (((100 - f.debrisChance) * loot + f.debrisChance * lootDebris) / 10000) * avgCount;
    const oreW = normalize(f.oreWeights[Math.max(0, Math.min(d, f.oreWeights.length) - 1)]);
    const gemW = normalize(f.gemWeights[Math.max(0, Math.min(d, f.gemWeights.length) - 1)]);
    const out = travelMinutes(state, state.map.camp, at[0], 0, cfg);
    const back = travelMinutes(state, at[0], state.map.camp, 0, cfg);
    const avgSearched = at.reduce((a, c) => a + fieldProgress(state.map.fields[key(c.x, c.y)]), 0) / at.length;
    return h('tr', {},
      h('td', { class: 'num' }, h('b', {}, String(d))),
      h('td', { class: 'num' }, String(at.length)),
      h('td', { class: 'num' }, `${dur(out)} / ${dur(back)}`),
      h('td', { class: 'num' }, `${loot}%`, h('span', { class: 'muted' }, ` (${lootDebris}%)`)),
      h('td', { class: 'num' }, `~${Math.round(expItems)}`),
      h('td', { class: 'num' }, pctText(avgSearched)),
      ...ORES.map((o) => h('td', { class: 'num mv-sep-l' }, pctCell(oreW[o]))),
      ...GEMS.map((g) => h('td', { class: 'num' }, pctCell(gemW[g]))));
  });
  const th = (label, attrs = {}) => h('th', { class: 'num', ...attrs }, label);
  const headTop = h('tr', {},
    th('Distance', { rowspan: 2, title: 'Steps from camp, walking around blocked cells' }),
    th('Fields', { rowspan: 2, title: 'Number of fields at this distance on your map' }),
    th('Walk out / back', { rowspan: 2, title: 'Walking time from camp and back, carrying nothing' }),
    th('Cells with items', { rowspan: 2, title: `Chance each cell holds items (in brackets: under debris, +${f.debrisLootBonus} points)` }),
    th('Items / field', { rowspan: 2, title: `Expected items in a whole ${f.size}x${f.size} field (${countRange} per loot cell, about ${round1(avgCount)} on average)` }),
    th('Searched', { rowspan: 2, title: 'Average % searched of your fields at this distance' }),
    h('th', { colspan: ORES.length, class: 'mv-group mv-sep-l' }, `Ores (${f.oreShare}% of items)`),
    h('th', { colspan: GEMS.length, class: 'mv-group' }, `Gems (${100 - f.oreShare}% of items)`));
  const headSub = h('tr', {},
    ...ORES.map((o) => h('th', { class: 'num mv-sep-l', title: `${cap(o)} ore` }, itemTag(`ore:${o}`))),
    ...GEMS.map((g) => h('th', { class: 'num', title: `Raw ${g}` }, itemTag(`gem:${g}`))));
  const gemsEqual = f.gemWeights.every((w) => new Set(GEMS.map((g) => w[g] || 0)).size === 1);
  return h('div', {},
    h('div', { class: 'mv-scroll' }, h('table', { class: 'mv-odds' }, h('thead', {}, headTop, headSub), h('tbody', {}, rows))),
    h('p', { class: 'muted mv-note' }, `Ore and gem columns: chance that an item found at that distance is that type.${gemsEqual ? ' Every gem type is equally likely, at every distance.' : ''} Fields farther than ${f.oreWeights.length} steps use the last row of ore odds. Debris covers about ${f.debrisChance}% of cells (${f.debrisAmount.min}-${f.debrisAmount.max} thick)${f.boulders ? ` and each field has ${plural(f.boulders, 'boulder')}` : ''}.`));
}

// ---------------------------------------------------------------- field ----
function fieldPanel(ctx, field, fkey, sel) {
  const { state, cfg } = ctx;
  const f = cfg.field;
  const n = f.size;
  const area = new Set(areaCells(sel % n, Math.floor(sel / n), cfg));
  const grid = h('div', { class: 'grid mv-field mv-fieldgrid', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
  field.cells.forEach((cell, i) => grid.append(fieldCell(ctx, fkey, cell, i, i === sel, area.has(i))));
  const prog = fieldProgress(field);
  const debrisLeft = field.cells.filter(hasDebris).length;
  const boulders = field.cells.filter((c) => c.boulder).length;
  const done = field.cells.filter(isDone).length;
  const revealed = field.cells.filter((c) => c.revealed && !c.boulder).length;
  const pileN = pileOf(field).length;
  const d = field.dist;
  const loot = Math.min(f.lootChance.max, f.lootChance.base + f.lootChance.perDistance * (d - 1));
  return section(`Field (${state.location.x + 1},${state.location.y + 1}) · distance ${d} from camp`,
    h('div', { class: 'row mv-prog' }, bar(prog), h('b', {}, `${pctText(prog)} searched`)),
    h('div', { class: 'muted mv-stats' },
      `${plural(done, 'cell')} fully searched · ${debrisLeft} under debris · ${plural(boulders, 'boulder')} · ${revealed} revealed · ${plural(pileN, 'item')} in the pile`),
    grid,
    h('p', { class: 'muted mv-note' },
      `Click a cell to centre the 3x3 search area on it (selected: ${cellLabel(sel, n)}). At distance ${d}, about ${loot}% of cells hold items (${Math.min(100, loot + f.debrisLootBonus)}% under debris). Contents stay hidden until found or revealed by ore sight. Numbers on brown striped cells are the debris left to clear. Boulders (dark rocks) can never be searched.`));
}

function fieldCell(ctx, fkey, cell, i, selected, inArea) {
  const n = ctx.cfg.field.size;
  const select = () => {
    setSel(ctx, fkey, i);
    ctx.rerender();
  };
  if (cell.boulder) {
    const cls = ['cell', 'mv-boulder'];
    if (selected) cls.push('sel');
    if (inArea) cls.push('area');
    return h('div', {
      class: cls.join(' '),
      title: `Cell ${cellLabel(i, n)}: boulder. It can never be cleared or searched and holds nothing. (Clicking centres the 3x3 search area here; the cells around it can still be searched.)`,
      'data-idx': i,
      'data-boulder': '1',
      onclick: select,
    }, h('div', { class: 'mv-rockshape' }));
  }
  const debris = hasDebris(cell);
  const done = isDone(cell);
  const partial = !debris && !done && cell.searched > EPS;
  const cls = ['cell'];
  if (debris) cls.push('debris');
  if (done) cls.push('mv-done');
  if (partial) cls.push('mv-partial');
  if (cell.revealed && !done) cls.push('mv-revealed');
  if (selected) cls.push('sel');
  if (inArea) cls.push('area');

  let content;
  if (debris) content = h('span', { class: 'mv-debris-n' }, dn(cell.debris));
  else if (cell.revealed && !done) content = cell.items.length ? cell.items.map((it) => itemTag(it.t)) : h('span', { class: 'mv-empty' }, 'empty');
  else if (done) content = h('span', { class: 'mv-done-l' }, 'done');
  else if (partial) content = h('span', { class: 'mv-pct' }, pctText(cell.searched));
  else content = null;

  const title = [
    `Cell ${cellLabel(i, n)}: ${pctText(cell.searched)} searched`,
    debris ? `Debris: ${dn(cell.debris)} left. Searching clears debris first; leftover effort searches the cell.` : null,
    cell.revealed && !done ? `Revealed: ${cell.items.length ? cell.items.map((it) => itemName(it.t)).join(', ') : 'nothing left'}` : null,
    done ? 'Fully searched: nothing hidden left.' : null,
  ].filter(Boolean).join('\n');

  return h('div', { class: cls.join(' '), title, 'data-idx': i, onclick: select },
    partial ? h('div', { class: 'fill', style: { height: `${cell.searched}%` } }) : null,
    h('span', { class: 'mv-cc' }, content));
}

function actionsPanel(ctx, field, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  const b = smithBonuses(state, cfg);
  const cells = areaCells(sel % n, Math.floor(sel / n), cfg).map((i) => field.cells[i]);
  const open = cells.filter(cellOpen);
  const debrisCells = open.filter(hasDebris);
  const clearCells = open.length - debrisCells.length;
  const boulders = cells.filter((c) => c.boulder).length;
  const done = cells.filter(isDone).length;
  const sMin = searchMinutes(state, cfg);
  const sd = searchDepth(state, cfg);
  const pw = clearPower(state, cfg);
  const bagN = state.bag.length;
  const pileN = pileOf(field).length;
  const load = projectedLoad(state, cfg);
  const retBag = returnMinutes(state, state.location, bagN, cfg);
  const retLoad = returnMinutes(state, state.location, load, cfg);
  const left = timeLeft(state, cfg);
  const latest = cfg.time.dayEndMin - retLoad;
  const spare = latest - state.time;
  const lateMsg = (m) => `Not enough time: done at ${clock(state.time + m)}, home with a full load at ${clock(state.time + m + retLoad)} (after ${clock(cfg.time.dayEndMin)}).`;

  // Search (clears debris first, leftover effort searches)
  const sFits = fitsWithReturn(state, sMin, cfg);
  let sure = 0;
  let maybe = 0;
  let more = 0;
  for (const c of debrisCells) {
    if (c.debris <= pw.lo + EPS) sure++;
    else if (c.debris <= pw.hi + EPS) maybe++;
    else more++;
  }
  const forecast = [sure ? `${sure} will be clear` : null, maybe ? `${maybe} may be clear` : null, more ? `${more} need${more === 1 ? 's' : ''} more searches` : null].filter(Boolean).join(', ');
  const skipped = [boulders ? plural(boulders, 'boulder') : null, done ? `${done} already done` : null].filter(Boolean).join(', ');
  const sInfo = h('div', {},
    h('div', {}, `${dur(sMin)} · done at ${clock(state.time + sMin)} · ${open.length} of ${cells.length} cells to work on`),
    clearCells ? h('div', {}, `${plural(clearCells, 'clear cell')}: +${sd.range} searched each${sd.random ? ` (${sd.avg} avg)` : ''}`) : null,
    debrisCells.length ? h('div', {}, `${debrisCells.length} under debris (${debrisCells.map((c) => dn(c.debris)).join(', ')} left): clears ${pw.range} debris each first, leftover effort searches the cell. ${forecast}.`) : null,
    skipped ? h('div', { class: 'muted' }, `Skipped: ${skipped}.`) : null);
  const sWhy = !open.length ? 'Nothing left to search in this area.' : !sFits ? lateMsg(sMin) : null;
  const bonusBits = [];
  if (sMin < cfg.field.searchMin - EPS) bonusBits.push(`time ${cfg.field.searchMin}m -${round1(b.searchTimePct)}%`);
  if (sd.eff > cfg.field.searchEfficiency + EPS) bonusBits.push(`depth ${cfg.field.searchEfficiency}% avg +${round1(b.searchEffPct)}% = ${sd.avg} avg`);
  const sExtra = `Debris clearing power: effort ${sd.range.replace('%', '')} × ${round1(pw.mult * 100) / 100} (Debris clearing skill +${round1(pw.skillPct)}%) = ${pw.range} debris per cell per search. Ore sight: ${round1(b.revealPct)}% chance per searched cell to reveal everything still in it.${bonusBits.length ? ` Bonuses: ${bonusBits.join(', ')}.` : ''}`;

  // Return to camp (opens the carry step when the pile has items)
  const camp = state.map.camp;
  const rInfo = pileN
    ? `Choose what to carry first (up to ${cfg.bag.slots}). With ${plural(load, 'item')}: ${dur(retLoad)}, arrive ${clock(state.time + retLoad)}.`
    : `${dur(retBag)} · arrive ${clock(state.time + retBag)}${bagN ? ` · unloads ${plural(bagN, 'item')} into storage` : ''}`;

  const actRow = (label, onclick, disabled, info, why, extra, attrs = {}) => h('div', { class: 'mv-act' },
    h('button', { class: attrs.primary ? 'primary' : '', disabled, onclick, title: why || (typeof info === 'string' ? info : label), 'data-act': attrs.id }, label),
    h('div', {},
      typeof info === 'string' ? h('div', {}, info) : info,
      why ? h('div', { class: 'warn mv-why' }, why) : null,
      extra ? h('div', { class: 'muted mv-why' }, extra) : null));

  const timeCls = spare <= 0 ? 'err' : spare < sMin ? 'warn' : '';
  return section(`Actions on the 3x3 area around ${cellLabel(sel, n)}`,
    h('div', { class: 'mv-kv mv-time' },
      h('span', { class: 'muted' }, 'Now'), h('span', {}, `${clock(state.time)} - ${left > 0 ? `${dur(left)} left (day ends ${clock(cfg.time.dayEndMin)})` : 'the day is over'}`),
      h('span', { class: 'muted' }, 'Walk home'), h('span', {}, load > bagN
        ? `${dur(retLoad)} with a full load (${plural(load, 'item')}: bag + pile, max ${cfg.bag.slots}); ${dur(retBag)} with just your bag`
        : `${dur(retBag)} with ${plural(bagN, 'item')} in the bag`),
      h('span', { class: 'muted' }, 'Deadline'), h('span', { class: timeCls }, spare > EPS
        ? `Field work must be done by ${clock(latest)}: ${dur(spare)} to spare`
        : `Past ${clock(Math.max(latest, cfg.time.dayStartMin))}: only the walk home is possible now`)),
    h('div', { class: 'mv-actions' },
      actRow('Search area', () => doSearch(ctx, sel), !open.length || !sFits, sInfo, sWhy, sExtra, { primary: true, id: 'search' }),
      actRow('Return to camp', () => startLeave(ctx, camp), false, rInfo, null, null, { id: 'return' })),
    h('p', { class: 'muted mv-note' }, sd.random
      ? `Each search gives every cell of the area its own effort roll: ${sd.range} (${sd.avg} on average, ±${cfg.field.searchRandomness}), so ${sd.finish} searches finish a clear cell. `
      : `Each search gives every cell of the area ${sd.avg} effort, so ${sd.finish} searches finish a clear cell. `,
    'On a debris cell the effort (x debris clearing power) clears debris first, and what is left over searches the cell in the same search. ',
    'Hidden items are found once the searched % passes their random depth (0-100%); they go to this field\'s pile.'));
}

function cellPanel(ctx, field, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  const cell = field.cells[sel];
  const done = isDone(cell);
  const area = areaCells(sel % n, Math.floor(sel / n), cfg).map((i) => field.cells[i]);
  const searchable = area.filter((c) => !c.boulder);
  const avg = searchable.length ? searchable.reduce((a, c) => a + c.searched, 0) / searchable.length : 0;
  const areaBoulders = area.length - searchable.length;
  const areaText = `${area.length} cells, ${pctText(avg)} searched on average, ${area.filter(hasDebris).length} under debris${areaBoulders ? `, ${plural(areaBoulders, 'boulder')}` : ''}, ${area.filter(isDone).length} fully searched`;
  if (cell.boulder) {
    return section(`Selected cell ${cellLabel(sel, n)}: boulder`,
      h('div', { class: 'mv-kv' },
        h('span', { class: 'muted' }, 'Boulder'), h('span', {}, 'Can never be cleared or searched, and holds nothing. It does not count toward the field\'s searched %.'),
        h('span', { class: 'muted' }, '3x3 area'), h('span', {}, areaText)));
  }
  const pw = clearPower(state, cfg);
  let contents;
  if (cell.revealed && !done) {
    contents = cell.items.length
      ? h('span', { class: 'chips' }, cell.items.map((it) => h('span', { class: 'chip' }, itemTag(it.t), ` ${itemName(it.t)}`)))
      : h('span', {}, 'Revealed: nothing left in this cell.');
  } else if (hasDebris(cell)) contents = h('span', { class: 'muted' }, 'Hidden under debris (debris cells are a bit richer).');
  else if (done) contents = h('span', {}, 'Fully searched: nothing hidden left.');
  else contents = h('span', { class: 'muted' }, 'Hidden. Search deeper, or hope ore sight reveals it.');
  const searchesToClear = pw.avg > EPS ? Math.ceil(cell.debris / pw.avg - 1e-9) : Infinity;
  return section(`Selected cell ${cellLabel(sel, n)}`,
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Searched'), h('span', { class: 'row' }, bar(cell.searched), pctText(cell.searched)),
      h('span', { class: 'muted' }, 'Debris'), hasDebris(cell)
        ? h('span', {}, h('b', {}, `${dn(cell.debris)} left`), ` · each search clears ${pw.range} (about ${Number.isFinite(searchesToClear) ? plural(searchesToClear, 'search') : 'never'}), leftover effort searches the cell`)
        : h('span', {}, 'none'),
      h('span', { class: 'muted' }, 'Contents'), contents,
      h('span', { class: 'muted' }, '3x3 area'), h('span', {}, areaText)));
}

// ------------------------------------------------------------ field pile ----
function pilePanel(ctx, field, fkey) {
  const { state, cfg } = ctx;
  const pile = pileOf(field);
  const free = cfg.bag.slots - state.bag.length;
  const fresh = ctx.ui.map_new && ctx.ui.map_new.fkey === fkey ? ctx.ui.map_new : null;
  const groups = groupByType(pile);
  const freshN = fresh ? Math.max(0, Math.min(pile.length, fresh.end) - fresh.start) : 0;
  const chips = groups.map((g) => {
    const newN = fresh ? g.idxs.filter((i) => i >= fresh.start && i < fresh.end).length : 0;
    return h('button', {
      class: `chip clickable mv-pchip${newN ? ' mv-new' : ''}`,
      disabled: free <= 0,
      title: free > 0 ? `Put 1 ${itemName(g.t)} in your bag (free)` : 'Your bag is full: put something back in the pile first.',
      'data-pile': g.t,
      onclick: () => doTake(ctx, g.idxs[0]),
    }, itemTag(g.t), ` ${itemName(g.t)} `, h('b', {}, `×${g.idxs.length}`), newN ? h('span', { class: 'mv-newn' }, ` +${newN} new`) : null);
  });
  return section(`This field's pile: ${plural(pile.length, 'item')}`,
    pile.length
      ? h('div', { class: 'chips mv-pile' }, chips)
      : h('p', { class: 'muted mv-note' }, 'Empty. Everything you find in this field goes here.'),
    freshN ? h('p', { class: 'mv-note ok' }, `Last search found ${plural(freshN, 'item')} (marked "new").`) : null,
    h('p', { class: 'muted mv-note' }, `Found items wait here (no limit). Click one to put it in your bag now (free, ${plural(Math.max(0, free), 'free slot')}). When you leave the field you choose what to carry (up to ${cfg.bag.slots}); the rest stays in this pile for a later trip.`));
}

// ------------------------------------------------------------------- bag ----
function bagPanel(ctx) {
  const { state, cfg } = ctx;
  const items = state.bag.length;
  const pen = cfg.map.loadPenaltyPerItem;
  const inField = !atCamp(state);
  const slots = h('div', { class: 'slots mv-bag' });
  for (let i = 0; i < cfg.bag.slots; i++) {
    const t = state.bag[i];
    if (!t) {
      slots.append(h('div', { class: 'slot empty' }));
      continue;
    }
    slots.append(h('div', {
      class: `slot mv-slot mv-${itemKind(t)} mv-t-${itemType(t)}`,
      title: inField ? `${itemName(t)}: click to put it in this field's pile` : itemName(t),
      'data-bag': i,
      onclick: inField ? () => doMoveToPile(ctx, i) : null,
    }, ABBR[itemType(t)] || itemType(t).slice(0, 2)));
  }
  const ret = inField ? returnMinutes(state, state.location, items, cfg) : 0;
  const retEmpty = inField ? returnMinutes(state, state.location, 0, cfg) : 0;
  return section(`Bag ${items}/${cfg.bag.slots}`,
    slots,
    items ? h('div', { class: 'chips mv-counts' }, countChips(state.bag)) : null,
    h('p', { class: 'mv-note' },
      `Load: ${plural(items, 'item')} × ${pen}% = `, h('b', {}, `+${items * pen}% travel time`),
      inField ? `. Walk home ${dur(ret)} with this bag, ${dur(retEmpty)} empty.` : '.'),
    h('p', { class: 'muted mv-note' }, inField
      ? 'Click an item to put it back in this field\'s pile (free). You choose your final load when you leave.'
      : 'Arriving at camp unloads the bag into storage.'));
}

// ------------------------------------------------------ carry step (modal) ----
function validLeave(ctx, field, fkey) {
  const lv = ctx.ui.map_leave;
  if (!lv) return null;
  const { state } = ctx;
  const target = mapCell(state.map, lv.to.x, lv.to.y);
  if (lv.from !== fkey || !target || target.type === 'blocked' || sameLoc(lv.to, state.location)) {
    ctx.ui.map_leave = null;
    return null;
  }
  const pile = pileOf(field);
  lv.bag = [...new Set(lv.bag)].filter((i) => i >= 0 && i < state.bag.length);
  lv.pile = [...new Set(lv.pile)].filter((i) => i >= 0 && i < pile.length);
  return lv;
}

function carryDialog(ctx, field, leave) {
  const { state, cfg } = ctx;
  const slots = cfg.bag.slots;
  const pile = pileOf(field);
  const pen = cfg.map.loadPenaltyPerItem;
  const toCamp = sameLoc(leave.to, state.map.camp);
  const dest = toCamp ? 'camp' : `field (${leave.to.x + 1},${leave.to.y + 1})`;
  const sel = { bag: new Set(leave.bag), pile: new Set(leave.pile) };
  const boxes = []; // { src, idx, input, label }
  const groupCounts = []; // { src, idxs, el }
  const total = state.bag.length + pile.length;
  const count = () => sel.bag.size + sel.pile.size;
  const chosen = () => [...[...sel.bag].map((i) => state.bag[i]), ...[...sel.pile].map((i) => pile[i])];

  const summary = h('div', { class: 'mv-carry-sum', 'aria-live': 'polite' });
  const confirmBtn = h('button', { class: 'primary', 'data-act': 'carry-confirm' }, 'Confirm');
  const setSelection = (s) => {
    sel.bag = new Set(s.bag);
    sel.pile = new Set(s.pile);
    refresh();
  };

  function refresh() {
    const nSel = count();
    const full = nSel >= slots;
    for (const b of boxes) {
      const on = sel[b.src].has(b.idx);
      b.input.checked = on;
      b.input.disabled = !on && full;
      b.label.classList.toggle('on', on);
      b.label.classList.toggle('off', !on && full);
    }
    for (const g of groupCounts) g.el.textContent = `${g.idxs.filter((i) => sel[g.src].has(i)).length}/${g.idxs.length}`;
    const there = travelMinutes(state, state.location, leave.to, nSel, cfg);
    const back = toCamp ? 0 : travelMinutes(state, leave.to, state.map.camp, nSel, cfg);
    const fits = toCamp || state.time + there + back <= cfg.time.dayEndMin + EPS;
    const fitsEmpty = toCamp || state.time + travelMinutes(state, state.location, leave.to, 0, cfg) + travelMinutes(state, leave.to, state.map.camp, 0, cfg) <= cfg.time.dayEndMin + EPS;
    const leftBehind = total - nSel;
    clear(summary).append(...[
      h('div', {}, h('b', { class: full ? 'warn' : '' }, `Carrying ${nSel} / ${slots}`), ` · ${plural(leftBehind, 'item')} stay${leftBehind === 1 ? 's' : ''} in this field's pile`),
      h('div', {}, `Travel to ${dest}: `, h('b', {}, dur(there)), ` (+${nSel * pen}% load) · arrive ${clock(state.time + there)}`,
        toCamp ? (nSel ? ` · unloads ${plural(nSel, 'item')} into storage` : '') : ` · then back to camp ${dur(back)}`),
      !fits ? h('div', { class: 'err' }, fitsEmpty
        ? `Not enough time: with this load you could not get back to camp by ${clock(cfg.time.dayEndMin)}. Carry less, or go home instead.`
        : `Not enough time: even carrying nothing you could not get there and back to camp by ${clock(cfg.time.dayEndMin)}. Go home instead.`) : null,
      nSel ? h('div', { class: 'chips mv-carry-chosen' }, countChips(chosen())) : h('div', { class: 'muted' }, 'Carrying nothing.'),
    ].filter(Boolean));
    confirmBtn.disabled = !fits;
    confirmBtn.title = fits ? `Leave with ${plural(nSel, 'item')}` : 'Not enough time to get there and back';
    confirmBtn.textContent = `Carry ${nSel} and go (${dur(there)})`;
    leave.bag = [...sel.bag];
    leave.pile = [...sel.pile];
  }

  confirmBtn.addEventListener('click', () => doTravel(ctx, leave.to, { bag: [...sel.bag], pile: [...sel.pile] }));

  // One block per source (bag / pile): a row per item type, one checkbox per item.
  const sourceBlock = (src, list, title) => {
    if (!list.length) return null;
    const rows = groupByType(list).map((g) => {
      const cnt = h('span', { class: 'mv-ck-count' });
      groupCounts.push({ src, idxs: g.idxs, el: cnt });
      const checks = g.idxs.map((i) => {
        const input = h('input', { type: 'checkbox', 'data-src': src, 'data-idx': i, 'aria-label': `${itemName(g.t)} (${src} item ${i + 1})` });
        input.addEventListener('change', () => {
          if (input.checked) {
            if (count() >= slots) input.checked = false;
            else sel[src].add(i);
          } else sel[src].delete(i);
          refresh();
        });
        const label = h('label', { class: 'mv-ck', title: itemName(g.t) }, input, itemTag(g.t));
        boxes.push({ src, idx: i, input, label });
        return label;
      });
      return h('div', { class: 'mv-ck-group' },
        h('div', { class: 'mv-ck-head' }, itemTag(g.t), h('span', {}, ` ${itemName(g.t)} `), cnt),
        h('div', { class: 'mv-ck-items' }, checks));
    });
    return h('div', { class: 'mv-ck-src' }, h('h4', {}, title), rows);
  };

  const quick = (label, fn, title) => h('button', { class: 'small', title, onclick: () => setSelection(fn()) }, label);
  const dialog = h('div', { class: 'panel mv-dialog', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Choose what to carry' },
    h('h3', {}, 'Choose what to carry'),
    h('p', { class: 'mv-note' }, `Leaving field (${state.location.x + 1},${state.location.y + 1}) for ${dest}. Carry up to ${slots} raw ores or gems (+${pen}% travel time each). Whatever you leave stays in this field's pile for a later trip.`),
    h('div', { class: 'row mv-carry-quick' },
      quick('Rarest first', () => defaultCarry(state, cfg), 'Keep your bag and fill the free slots with the rarest items in the pile (default)'),
      quick('Keep current bag', () => ({ bag: state.bag.map((_, i) => i).slice(0, slots), pile: [] }), 'Carry only what is in your bag now'),
      quick('Clear', () => ({ bag: [], pile: [] }), 'Carry nothing (everything stays in the pile)')),
    summary,
    h('div', { class: 'mv-ck-wrap' },
      sourceBlock('bag', state.bag, `In your bag (${state.bag.length})`),
      sourceBlock('pile', pile, `In this field's pile (${pile.length})`)),
    h('div', { class: 'row mv-carry-foot' },
      h('button', { class: 'ghost', 'data-act': 'carry-cancel', onclick: () => cancelLeave(ctx) }, 'Cancel'),
      confirmBtn));
  refresh();
  return h('div', { class: 'mv-modal' }, dialog);
}

// ---------------------------------------------------------------- legend ----
function swatch(cls, inner, opts = {}) {
  return h('div', { class: `grid mv-sw${opts.big ? ' mv-sw-big' : ''}` },
    h('div', { class: `cell ${cls}` },
      opts.fill ? h('div', { class: 'fill', style: { height: `${opts.fill}%` } }) : null,
      opts.badge ? h('div', { class: 'mv-badge' }, opts.badge) : null,
      opts.rock ? h('div', { class: 'mv-rockshape' }) : null,
      inner === null ? null : h('span', { class: opts.wm ? 'mv-wm' : 'mv-cc' }, inner)));
}

function legend(ctx) {
  const cfg = ctx.cfg;
  const item = (sw, text) => h('div', { class: 'mv-leg' }, sw, h('span', {}, text));
  const open = ctx.ui.map_legend !== false; // remembered per session, open by default
  const da = cfg.field.debrisAmount;
  return h('details', {
    class: 'panel mv-legend-box',
    open,
    ontoggle: (e) => { ctx.ui.map_legend = e.currentTarget.open; },
  },
  h('summary', {}, 'Legend'),
  h('div', { class: 'mv-leg-title muted' }, 'World map'),
  h('div', { class: 'mv-legend mv-world' },
    item(swatch('field', [h('span', { class: 'mv-wm-d' }, 'dist 2'), h('span', { class: 'mv-wm-p' }, '35%'), h('span', { class: 'mv-wm-t' }, '40m')], { big: true, wm: true, fill: 35 }),
      'Field: distance from camp, % searched (also shown as the fill), travel time from where you are now'),
    item(swatch('field', h('span', { class: 'mv-wm-p' }, '60%'), { big: true, wm: true, fill: 60, badge: '7' }), 'Blue badge: items left in that field\'s pile'),
    item(swatch('field here', h('span', { class: 'mv-wm-t' }, 'here'), { big: true, wm: true }), 'You are here'),
    item(swatch('field mv-far', h('span', { class: 'mv-wm-t' }, '2h'), { big: true, wm: true }), `Faded: not enough time to go there and get back by ${clock(cfg.time.dayEndMin)}`),
    item(swatch('blocked', '', { big: true }), 'Impassable rock'),
    item(swatch('camp', h('span', { class: 'mv-wm-p' }, 'Camp'), { big: true, wm: true }), 'Camp: storage and workshop; end the day here')),
  h('div', { class: 'mv-leg-title muted' }, 'Field cells'),
  h('div', { class: 'mv-legend mv-field' },
    item(swatch('', ''), 'Not searched yet'),
    item(swatch('mv-partial', h('span', { class: 'mv-pct' }, `${Math.round(cfg.field.searchEfficiency)}%`), { fill: cfg.field.searchEfficiency }), 'Partly searched: the fill rises with % searched'),
    item(swatch('mv-done', h('span', { class: 'mv-done-l' }, 'done')), (cfg.field.regrowPctPerDay || 0) > 0 ? 'Fully searched: nothing hidden left (until it regrows overnight)' : 'Fully searched: nothing hidden left'),
    item(swatch('debris', h('span', { class: 'mv-debris-n' }, String(Math.round((da.min + da.max) / 2)))), `Debris (brown stripes): the number is the debris left (${da.min}-${da.max} at first). Searching clears it first, then searches with the leftover effort. A bit richer.`),
    item(swatch('mv-boulder', null, { rock: true }), 'Boulder: can never be cleared or searched, holds nothing'),
    item(swatch('mv-revealed', [itemTag('ore:iron'), itemTag('gem:ruby')]), 'Revealed by ore sight: what is still in the cell'),
    item(swatch('mv-revealed', h('span', { class: 'mv-empty' }, 'empty')), 'Revealed and empty'),
    item(h('div', { class: 'mv-sw-pair' }, swatch('area', ''), swatch('sel area', '')), 'Selected cell (orange border) and its 3x3 search area (tinted)')),
  h('div', { class: 'mv-leg-title muted' }, 'Items (square = ore, round = gem)'),
  h('div', { class: 'chips' },
    ORES.map((o) => h('span', { class: 'chip' }, itemTag(`ore:${o}`), ` ${cap(o)}`)),
    GEMS.map((g) => h('span', { class: 'chip' }, itemTag(`gem:${g}`), ` ${cap(g)}`))),
  h('p', { class: 'muted mv-note' }, 'Keys in a field: arrow keys move the selection, S searches, Esc closes the carry step.'));
}
