// Map tab: the 7x7 world map, the 9x9 field grid (9 plots of 3x3) with its actions, the field's pile, the bag and
// the "choose what to carry" step when you leave a field.
// All game-state changes go through core functions inside ctx.act(). UI-only state lives in ctx.ui under
// the map_ prefix: map_sel (selected cell per field), map_new (pile items just found: { fkey, start, end }),
// map_leave (open carry step: { from, to, bag: [bag idx], pile: [pile idx] }), map_legend (legend open).
import { h, section, bar, clear } from './dom.js';
import {
  travel, search, moveToPile, takeFromPile, defaultCarry, travelMinutes, returnMinutes, searchMinutes, loadPenaltyPct,
  searchEfficiency, searchEfficiencyRange, expectedSearches, searchesText, debrisClearMult, projectedLoad, fitsWithReturn, cellOpen, cellFresh, freshCellCount,
  fieldProgress, areaCells, atCamp, currentField, mapCell, itemKind, itemType, key, timeLeft, sameLoc,
  distanceRow, sightValue, sightRange, sightShare, seenItems,
} from '../core/map.js';
import { intelValue } from '../core/intel.js';
import { smithRingTotals } from '../core/rings.js';
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
const rarestSeen = (items) => items.reduce((a, b) => (rarity(b.t) < rarity(a.t) ? b : a));

// ------------------------------------------------------------- formatting ----
const dur = (m) => (Number.isFinite(m) ? formatDuration(Math.max(0, m)) : 'no path');
const clock = (m) => formatClock(m);
// "3.5%" below 10, otherwise whole numbers rounded down (so 99.6% never reads as 100%).
const pctText = (v) => `${v > 0 && v < 10 ? round1(v) : Math.floor(v + 1e-6)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
// Remaining debris thickness, rounded up (0.3 left still reads as 1, never as 0).
const dn = (v) => String(Math.max(0, Math.ceil(v - 1e-6)));

// Minutes one never-searched ("fresh") cell adds to a search, after the search-time reductions.
const freshCost = (state, cfg) => round1(cfg.field.freshCellMin * (1 - clamp(smithBonuses(state, cfg).searchTimePct, 0, cfg.processing.maxTimeReduction) / 100));

// "34m (30 + 2 x 2 fresh cells)": the area's search time with the fresh-cell surcharge spelled out.
function searchTimeText(state, cfg, minutes, fresh) {
  const f = cfg.field;
  if (!(f.freshCellMin > 0)) return dur(minutes);
  const red = clamp(smithBonuses(state, cfg).searchTimePct, 0, cfg.processing.maxTimeReduction);
  if (fresh === 0) return `${dur(minutes)} (${f.searchMin}${red > EPS ? `, -${round1(red)}% bonuses` : ''}; no fresh cells)`;
  return `${dur(minutes)} (${f.searchMin} + ${f.freshCellMin} x ${plural(fresh, 'fresh cell')}${red > EPS ? `, -${round1(red)}% bonuses` : ''})`;
}

// Search depth per search: each cell rolls its own amount in [lo, hi] around the average.
// Returns { eff, lo, hi, range: '25–35%', avg: '30%', finish: '4' (about how many searches finish a cell) }.
function searchDepth(state, cfg) {
  const eff = searchEfficiency(state, cfg);
  const [lo, hi] = searchEfficiencyRange(state, cfg);
  const finish = searchesText(expectedSearches(state, cfg));
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

// ------------------------------------------------------------------ sight ----
// Sight = Ore sight intel + worn Ore sight rings. Every item in the ground has a sight threshold; you see it
// (in the field you stand in) once your sight reaches it. The threshold ranges come from config (field.sight).
const sightKeys = (cfg) => Object.keys(cfg.field.sight); // copper, iron, coal, gem, mythril
const sightLabel = (k) => (k === 'gem' ? 'gems' : k);
const sightProbe = (k) => (k === 'gem' ? 'gem:ruby' : `ore:${k}`); // any item of that kind

function sightParts(state, cfg) {
  const intel = intelValue(state, 'oreSight', cfg);
  const rings = smithRingTotals(state, cfg).reveal || 0;
  return { total: sightValue(state, cfg), intel, rings };
}

// "copper 1-40, iron 11-60, coal 21-70, gems 21-80, mythril 41-100"
function sightRangesText(cfg) {
  return sightKeys(cfg).map((k) => {
    const [lo, hi] = sightRange(sightProbe(k), cfg);
    return `${sightLabel(k)} ${lo + 1}-${hi}`;
  }).join(', ');
}

// "a, b and c" / "a, b or c"
const listText = (items, word) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} ${word} ${items[items.length - 1]}`);

// "With sight 50 you see all the copper, about 80% of the iron, 40% of the coal and no mythril."
function sightShareText(sight, cfg) {
  const all = [];
  const some = [];
  const none = [];
  for (const k of sightKeys(cfg)) {
    const share = sightShare(sightProbe(k), sight, cfg);
    if (share <= 0) none.push(sightLabel(k));
    else if (share >= 1) all.push(sightLabel(k));
    else some.push(`${Math.min(99, Math.max(1, Math.round(share * 100)))}% of the ${sightLabel(k)}`);
  }
  const parts = [];
  if (all.length) parts.push(`all the ${listText(all, 'and')}`);
  some.forEach((t, i) => parts.push(i === 0 ? `about ${t}` : t));
  if (!parts.length) return `With sight ${round1(sight)} you see nothing yet.`;
  return `With sight ${round1(sight)} you see ${parts.join(', ')}${none.length ? ` and no ${listText(none, 'or')}` : ''}.`;
}

function sightTip(state, cfg) {
  const sp = sightParts(state, cfg);
  return `Sight ${round1(sp.total)} = Ore sight intel ${round1(sp.intel)} + rings ${round1(sp.rings)}. Every item in the ground has a sight threshold; you see it once your sight reaches it: ${sightRangesText(cfg)}. ${sightShareText(sp.total, cfg)}`;
}

function sightChip(state, cfg) {
  return h('span', { class: 'chip mv-sight', title: sightTip(state, cfg) }, `Sight ${round1(sightValue(state, cfg))}`);
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
      h('p', { class: 'muted mv-note' }, 'Click a field to walk there. Each tile shows how much of that field you have searched and the walk from here (on a wider screen also its distance from camp). A blue badge = items waiting in that field\'s pile.')),
    section('Where to search?', campHint(ctx))));
  if (state.bag.length) wrap.append(bagPanel(ctx));
  wrap.append(h('details', { class: 'panel mv-odds-box' },
    h('summary', {}, 'What the fields hold, by distance'),
    oddsTable(ctx)));
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
      h('p', { class: 'muted mv-note' }, `Click a field to travel there directly, or the camp to go home. You choose what to carry before you leave; times assume ${plural(load, 'item')} (+${round1(load * loadPenaltyPct(state, cfg))}% load), the most you can carry from here.`)),
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
  const st = state.storage;
  const stored = [...ORES.map((o) => [`ore:${o}`, st.ore[o] || 0]), ...GEMS.map((g) => [`gem:${g}`, st.gem[g] || 0])].filter(([, v]) => v > 0);
  const piles = fieldPiles(state);
  const pileTotal = piles.reduce((a, p) => a + p.n, 0);
  const boulderCounts = f.byDistance.map((r) => r.boulders);
  const bMin = Math.min(...boulderCounts);
  const bMax = Math.max(...boulderCounts);
  const sp = sightParts(state, cfg);
  return h('div', {},
    h('p', {}, 'Pick a field to search. ', h('b', {}, 'Farther fields are richer'), ' (more cells hold items, rarer ores) but the walk takes longer and eats into your day.'),
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Now'), h('span', {}, `${clock(state.time)} - ${left > 0 ? `${dur(left)} left` : 'day over'} (day ends ${clock(cfg.time.dayEndMin)})`),
      h('span', { class: 'muted' }, 'Walking'), h('span', {}, `${cfg.map.travelMinPerStep}m per step, +${round1(loadPenaltyPct(state, cfg))}% per item carried${b.loadPenaltyRed > EPS ? ` (${cfg.map.loadPenaltyPerItem}% before the Carrying skill)` : ''}${b.travelPct ? `, -${round1(b.travelPct)}% (Travel rings and skill)` : ''}`),
      h('span', { class: 'muted' }, 'Searching'), h('span', {}, (() => {
        const sd = searchDepth(state, cfg);
        const fresh = f.freshCellMin > 0 ? `, plus ${dur(freshCost(state, cfg))} for each never-searched (fresh) cell in it` : '';
        return sd.random
          ? `${dur(searchMinutes(state, cfg))} per 3x3 area${fresh}; each search digs ${sd.range} deeper into every cell (${sd.avg} avg, rolled per cell), so about ${sd.finish} searches finish a cell`
          : `${dur(searchMinutes(state, cfg))} per 3x3 area${fresh}; each search digs ${sd.avg} deeper into every cell, so about ${sd.finish} searches finish a cell`;
      })()),
      h('span', { class: 'muted' }, 'Sight'), h('span', { title: sightTip(state, cfg) }, `${round1(sp.total)} (Ore sight intel ${round1(sp.intel)} + rings ${round1(sp.rings)}). In a field you see the items still in the ground whose sight threshold is within your sight${sp.total <= EPS ? '; right now that is nothing' : ''}.`),
      h('span', { class: 'muted' }, 'Debris'), h('span', {}, `about ${f.debrisChance}% of cells, ${f.debrisAmount.min}-${f.debrisAmount.max} thick (number on the cell). Searching clears it first: ${pw.range} per cell per search${pw.skillPct > EPS ? ` (Debris clearing skill +${round1(pw.skillPct)}%)` : ''}; leftover effort searches the cell. Boulders (${bMin === bMax ? bMin : `${bMin}-${bMax}, more far away`} per field) can never be searched.`),
      h('span', { class: 'muted' }, 'Carrying'), h('span', {}, `Found items go to that field's pile (no limit). When you leave a field you choose up to ${cfg.bag.slots} to carry; the rest waits in the pile.`),
      h('span', { class: 'muted' }, 'Field piles'), piles.length
        ? h('span', {}, `${plural(pileTotal, 'item')} in ${plural(piles.length, 'field')}: `, piles.map((p, i) => [i ? ' · ' : '', h('b', {}, `(${p.c.x + 1},${p.c.y + 1})`), ` ${p.n}`]))
        : h('span', { class: 'muted' }, 'none: nothing left behind in the fields'),
      h('span', { class: 'muted' }, 'Reachable'), h('span', { class: reachable ? '' : 'warn' }, `${reachable} of ${fields.length} fields are close enough to go to and be back by ${clock(cfg.time.dayEndMin)}`)),
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

// One row per distance on this map: how many fields, the walk, and what a field at that distance holds
// (all read from field.byDistance through distanceRow). Ore and gem columns are % of the items found there.
function oddsTable(ctx) {
  const { state, cfg } = ctx;
  const f = cfg.field;
  const fields = state.map.cells.filter((c) => c.type === 'field');
  const dists = [...new Set(fields.map((c) => c.dist))].sort((a, b) => a - b);
  const countW = Object.entries(f.itemCountWeights);
  const avgCount = countW.reduce((a, [k, w]) => a + Number(k) * w, 0) / countW.reduce((a, [, w]) => a + w, 0);
  const counts = countW.filter(([, w]) => w > 0).map(([k]) => Number(k));
  const countRange = counts.length ? (Math.min(...counts) === Math.max(...counts) ? String(counts[0]) : `${Math.min(...counts)}-${Math.max(...counts)}`) : '0';
  const pctCell = (v) => (v > 0 ? `${Math.round(v)}%` : '-');
  const rows = dists.map((d) => {
    const at = fields.filter((c) => c.dist === d);
    const row = distanceRow(d, cfg);
    const lootDebris = Math.min(100, row.loot + f.debrisLootBonus);
    const cellsPerField = Math.max(0, f.size * f.size - row.boulders); // boulders hold nothing
    const expItems = cellsPerField * (((100 - f.debrisChance) * row.loot + f.debrisChance * lootDebris) / 10000) * avgCount;
    const oreW = normalize(row.ores);
    const out = travelMinutes(state, state.map.camp, at[0], 0, cfg);
    const back = travelMinutes(state, at[0], state.map.camp, 0, cfg);
    return h('tr', {},
      h('td', { class: 'num' }, h('b', {}, String(d))),
      h('td', { class: 'num' }, String(at.length)),
      h('td', { class: 'num' }, `${dur(out)} / ${dur(back)}`),
      h('td', { class: 'num' }, `${row.loot}%`, h('span', { class: 'muted' }, ` (${lootDebris}%)`)),
      h('td', { class: 'num' }, String(row.boulders)),
      h('td', { class: 'num' }, `~${Math.round(expItems)}`),
      ...ORES.map((o, i) => h('td', { class: `num${i === 0 ? ' mv-sep-l' : ''}` }, pctCell(((100 - row.gemShare) * (oreW[o] || 0)) / 100))),
      h('td', { class: 'num mv-sep-l' }, pctCell(row.gemShare)));
  });
  const th = (label, attrs = {}) => h('th', { class: 'num', ...attrs }, label);
  const head = h('tr', {},
    th('Distance', { title: 'Steps from camp, walking around blocked cells' }),
    th('Fields', { title: 'Number of fields at this distance on your map' }),
    th('Walk out / back', { title: 'Walking time from camp and back, carrying nothing' }),
    th('Cells with items', { title: `Chance each cell holds items (in brackets: under debris, +${f.debrisLootBonus} points)` }),
    th('Boulders', { title: 'Boulder cells in each field at this distance: they can never be searched and hold nothing' }),
    th('Items / field', { title: `Expected items in a whole ${f.size}x${f.size} field (${countRange} per loot cell, about ${round1(avgCount)} on average)` }),
    ...ORES.map((o, i) => h('th', { class: `num${i === 0 ? ' mv-sep-l' : ''}`, title: `${cap(o)} ore: % of the items found at this distance` }, itemTag(`ore:${o}`))),
    h('th', { class: 'num mv-sep-l', title: 'Raw gems (every gem type equally likely): % of the items found at this distance' }, 'Gems'));
  const last = f.byDistance.length;
  return h('div', {},
    h('div', { class: 'mv-scroll' }, h('table', { class: 'mv-odds' }, h('thead', {}, head), h('tbody', {}, rows))),
    h('p', { class: 'muted mv-note' }, `Ore and gem columns: % of the items found at that distance (ore columns are ores, the last column is gems; every gem type is equally likely). Fields farther than ${last} steps use the distance-${last} row. Debris covers about ${f.debrisChance}% of cells (${f.debrisAmount.min}-${f.debrisAmount.max} thick).`));
}

// ---------------------------------------------------------------- field ----
// The field grid. A field whose size is a multiple of 3 is drawn as plots of 3x3 cells (a wider gap between plots,
// a narrow one inside): the plot centres are the cells (1,1), (4,1), ... so 9 searches cover a 9x9 field exactly
// once. Any cell may still be a search centre.
function fieldGrid(ctx, field, fkey, sel, sight) {
  const n = ctx.cfg.field.size;
  const area = new Set(areaCells(sel % n, Math.floor(sel / n), ctx.cfg));
  const cellAt = (i) => fieldCell(ctx, fkey, field.cells[i], i, i === sel, area.has(i), sight);
  if (n % 3 !== 0) {
    const grid = h('div', { class: 'grid mv-field mv-fieldgrid', style: { gridTemplateColumns: `repeat(${n}, 1fr)` } });
    field.cells.forEach((_, i) => grid.append(cellAt(i)));
    return grid;
  }
  const plots = n / 3;
  const grid = h('div', { class: 'grid mv-field mv-fieldgrid mv-plots', style: { gridTemplateColumns: `repeat(${plots}, 1fr)` } });
  for (let py = 0; py < plots; py++) {
    for (let px = 0; px < plots; px++) {
      const plot = h('div', { class: 'mv-plot', 'data-plot': `${px},${py}` });
      for (let y = py * 3; y < py * 3 + 3; y++) for (let x = px * 3; x < px * 3 + 3; x++) plot.append(cellAt(y * n + x));
      grid.append(plot);
    }
  }
  return grid;
}

function fieldPanel(ctx, field, fkey, sel) {
  const { state, cfg } = ctx;
  const f = cfg.field;
  const n = f.size;
  const sight = sightValue(state, cfg);
  const grid = fieldGrid(ctx, field, fkey, sel, sight);
  const prog = fieldProgress(field);
  const debrisLeft = field.cells.filter(hasDebris).length;
  const boulders = field.cells.filter((c) => c.boulder).length;
  const done = field.cells.filter(isDone).length;
  const seenN = field.cells.reduce((a, c) => a + seenItems(c, sight).length, 0);
  const freshTotal = field.cells.filter(cellFresh).length;
  const pileN = pileOf(field).length;
  const d = field.dist;
  const row = distanceRow(d, cfg);
  return section(`Field (${state.location.x + 1},${state.location.y + 1}) · distance ${d} from camp`,
    h('div', { class: 'row mv-prog' }, bar(prog), h('b', {}, `${pctText(prog)} searched`)),
    h('div', { class: 'muted mv-stats' },
      `${plural(done, 'cell')} done · ${debrisLeft} under debris · ${plural(boulders, 'boulder')} · ${plural(seenN, 'item')} seen${f.freshCellMin > 0 ? ` · ${freshTotal} fresh` : ''} · ${pileN} in the pile `,
      sightChip(state, cfg)),
    grid,
    h('p', { class: 'muted mv-note' },
      `Click a cell to centre the 3x3 search area on it (selected: ${cellLabel(sel, n)}); the nine plots of 3x3 cells cover the field exactly once. At distance ${d}, about ${row.loot}% of cells hold items (${Math.min(100, row.loot + f.debrisLootBonus)}% under debris). You see the items still in the ground whose sight threshold is within your sight (a tag on the cell, also under debris); everything else stays hidden until found. Numbers on brown striped cells are the debris left to clear (a seen item's tag sits above the number). Boulders (dark rocks) can never be searched.${f.freshCellMin > 0 ? ` A small dot marks a fresh cell, one nothing has worked on yet: each fresh cell in the 3x3 area adds ${f.freshCellMin}m to that search, so thoroughly finishing an area is cheaper than skipping around.` : ''}`));
}

function fieldCell(ctx, fkey, cell, i, selected, inArea, sight) {
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
  const seen = done ? [] : seenItems(cell, sight);
  if (seen.length) cls.push('mv-seen');
  const fresh = cellFresh(cell);
  if (fresh && ctx.cfg.field.freshCellMin > 0) cls.push('mv-fresh');
  if (selected) cls.push('sel');
  if (inArea) cls.push('area');

  // Sight sees through debris: a debris cell with seen items shows the item tag over a small debris number.
  const seenTag = seen.length ? h('span', { class: 'mv-seentag' }, itemTag(rarestSeen(seen).t), seen.length > 1 ? h('span', { class: 'mv-more' }, `+${seen.length - 1}`) : null) : null;
  let content;
  if (debris && seenTag) content = [seenTag, h('span', { class: 'mv-debris-n mv-debris-sm' }, dn(cell.debris))];
  else if (debris) content = h('span', { class: 'mv-debris-n' }, dn(cell.debris));
  else if (seenTag) content = seenTag;
  else if (done) content = h('span', { class: 'mv-done-l' }, 'done');
  else if (partial) content = h('span', { class: 'mv-pct' }, pctText(cell.searched));
  else content = null;

  const title = [
    `Cell ${cellLabel(i, n)}: ${pctText(cell.searched)} searched`,
    debris ? `Debris: ${dn(cell.debris)} left. Searching clears debris first; leftover effort searches the cell.` : null,
    seen.length ? `Seen (sight ${round1(sight)}): ${groupByType(seen.map((it) => it.t)).map((g) => `${itemName(g.t)}${g.idxs.length > 1 ? ` x${g.idxs.length}` : ''}`).join(', ')}. Items above your sight stay hidden until found.` : null,
    done ? 'Fully searched: nothing hidden left.' : null,
    fresh && ctx.cfg.field.freshCellMin > 0 ? `Fresh: never searched. A search that includes it takes ${ctx.cfg.field.freshCellMin}m longer, once.` : null,
  ].filter(Boolean).join('\n');

  return h('div', { class: cls.join(' '), title, 'data-idx': i, onclick: select },
    partial ? h('div', { class: 'fill', style: { height: `${cell.searched}%` } }) : null,
    h('span', { class: debris && seenTag ? 'mv-cc mv-cc-stack' : 'mv-cc' }, content));
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
  const freshN = freshCellCount(field, sel % n, Math.floor(sel / n), cfg);
  const sMin = searchMinutes(state, cfg, sel % n, Math.floor(sel / n));
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
    h('div', {}, `${searchTimeText(state, cfg, sMin, freshN)} · done at ${clock(state.time + sMin)} · ${open.length} of ${cells.length} cells to work on`),
    freshN && cfg.field.freshCellMin > 0 ? h('div', { class: 'muted' }, `${plural(freshN, 'fresh cell')} (small dot on the grid) ${freshN === 1 ? 'has' : 'have'} never been searched: each adds ${dur(freshCost(state, cfg))} the first time. Finish the area before moving on and it stays cheap.`) : null,
    clearCells ? h('div', {}, `${plural(clearCells, 'clear cell')}: +${sd.range} searched each${sd.random ? ` (${sd.avg} avg)` : ''}`) : null,
    debrisCells.length ? h('div', {}, `${debrisCells.length} under debris (${debrisCells.map((c) => dn(c.debris)).join(', ')} left): clears ${pw.range} debris each first, leftover effort searches the cell. ${forecast}.`) : null,
    skipped ? h('div', { class: 'muted' }, `Skipped: ${skipped}.`) : null);
  const sWhy = !open.length ? 'Nothing left to search in this area.' : !sFits ? lateMsg(sMin) : null;
  const bonusBits = [];
  if (b.searchTimePct > EPS) bonusBits.push(`time -${round1(Math.min(b.searchTimePct, cfg.processing.maxTimeReduction))}% (also on the fresh-cell time)`);
  if (sd.eff > cfg.field.searchEfficiency + EPS) bonusBits.push(`depth ${cfg.field.searchEfficiency}% avg +${round1(b.searchEffPct)}% = ${sd.avg} avg`);
  const sExtra = `Debris clearing power: effort ${sd.range.replace('%', '')} × ${round1(pw.mult * 100) / 100} (Debris clearing skill +${round1(pw.skillPct)}%) = ${pw.range} debris per cell per search. Sight ${round1(sightValue(state, cfg))}: you see the items in this area whose sight threshold is within it.${bonusBits.length ? ` Bonuses: ${bonusBits.join(', ')}.` : ''}`;

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
  const sight = sightValue(state, cfg);
  const seen = done ? [] : seenItems(cell, sight);
  let contents;
  if (done) contents = h('span', {}, 'Fully searched: nothing hidden left.');
  else if (seen.length) {
    contents = h('span', {},
      h('span', { class: 'chips' }, seen.map((it) => h('span', { class: 'chip' }, itemTag(it.t), ` ${itemName(it.t)}`))),
      h('span', { class: 'muted' }, ` Seen at sight ${round1(sight)}; more may be hidden.`));
  } else contents = h('span', { class: 'muted' }, `Nothing seen (sight ${round1(sight)}).${hasDebris(cell) ? ' Under debris (debris cells are a bit richer).' : ''}`);
  const searchesToClear = pw.avg > EPS ? Math.ceil(cell.debris / pw.avg - 1e-9) : Infinity;
  return section(`Selected cell ${cellLabel(sel, n)}`,
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Searched'), h('span', { class: 'row' }, bar(cell.searched), pctText(cell.searched)),
      h('span', { class: 'muted' }, 'Debris'), hasDebris(cell)
        ? h('span', {}, h('b', {}, `${dn(cell.debris)} left`), ` · each search clears ${pw.range} (about ${Number.isFinite(searchesToClear) ? plural(searchesToClear, 'search') : 'never'}), leftover effort searches the cell`)
        : h('span', {}, 'none'),
      h('span', { class: 'muted' }, 'Contents'), contents,
      cfg.field.freshCellMin > 0 ? h('span', { class: 'muted' }, 'Fresh') : null,
      cfg.field.freshCellMin > 0 ? (cellFresh(cell) ? h('span', {}, `Yes, never searched: a search that includes it takes ${cfg.field.freshCellMin}m longer (once)`) : h('span', {}, 'No, already worked on: no extra time')) : null,
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
  const pen = loadPenaltyPct(state, cfg);
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
      `Load: ${plural(items, 'item')} × ${round1(pen)}% = `, h('b', {}, `+${round1(items * pen)}% travel time`),
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
  const pen = loadPenaltyPct(state, cfg);
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
      h('div', {}, `Travel to ${dest}: `, h('b', {}, dur(there)), ` (+${round1(nSel * pen)}% load) · arrive ${clock(state.time + there)}`,
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
    h('p', { class: 'mv-note' }, `Leaving field (${state.location.x + 1},${state.location.y + 1}) for ${dest}. Carry up to ${slots} raw ores or gems (+${round1(pen)}% travel time each). Whatever you leave stays in this field's pile for a later trip.`),
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
      'Field: % searched (also shown as the fill), travel time from where you are now, and on a wider screen the distance from camp'),
    item(swatch('field', h('span', { class: 'mv-wm-p' }, '60%'), { big: true, wm: true, fill: 60, badge: '7' }), 'Blue badge: items left in that field\'s pile'),
    item(swatch('field here', h('span', { class: 'mv-wm-t' }, 'here'), { big: true, wm: true }), 'You are here'),
    item(swatch('field mv-far', h('span', { class: 'mv-wm-t' }, '2h'), { big: true, wm: true }), `Faded: not enough time to go there and get back by ${clock(cfg.time.dayEndMin)}`),
    item(swatch('blocked', '', { big: true }), 'Impassable rock'),
    item(swatch('camp', h('span', { class: 'mv-wm-p' }, 'Camp'), { big: true, wm: true }), 'Camp: storage and workshop; end the day here')),
  h('div', { class: 'mv-leg-title muted' }, 'Field cells'),
  h('div', { class: 'mv-legend mv-field' },
    item(swatch('', ''), 'Not searched yet'),
    cfg.field.freshCellMin > 0 ? item(swatch('mv-fresh', ''), `Small dot = fresh: no search has worked on this cell yet. A search that includes it takes ${cfg.field.freshCellMin}m longer (once per cell), so finish an area before moving on.`) : null,
    item(swatch('mv-partial', h('span', { class: 'mv-pct' }, `${Math.round(cfg.field.searchEfficiency)}%`), { fill: cfg.field.searchEfficiency }), 'Partly searched: the fill rises with % searched'),
    item(swatch('mv-done', h('span', { class: 'mv-done-l' }, 'done')), 'Fully searched: nothing hidden left'),
    item(swatch('debris', h('span', { class: 'mv-debris-n' }, String(Math.round((da.min + da.max) / 2)))), `Debris (brown stripes): the number is the debris left (${da.min}-${da.max} at first). Searching clears it first, then searches with the leftover effort. A bit richer.`),
    item(swatch('mv-boulder', null, { rock: true }), 'Boulder: can never be cleared or searched, holds nothing'),
    item(swatch('mv-seen', [itemTag('ore:iron'), h('span', { class: 'mv-more' }, '+1')]), 'Seen item: your sight reaches it (the rarest seen item, +N for more; under debris the tag sits above the debris number). Hover the cell for the list'),
    item(h('div', { class: 'mv-sw-pair' }, swatch('area', ''), swatch('sel area', '')), 'Selected cell (orange border) and its 3x3 search area (tinted)')),
  h('div', { class: 'mv-leg-title muted' }, 'Items (square = ore, round = gem)'),
  h('div', { class: 'chips' },
    ORES.map((o) => h('span', { class: 'chip' }, itemTag(`ore:${o}`), ` ${cap(o)}`)),
    GEMS.map((g) => h('span', { class: 'chip' }, itemTag(`gem:${g}`), ` ${cap(g)}`))),
  h('p', { class: 'muted mv-note' }, 'Keys in a field: arrow keys move the selection, S searches, Esc closes the carry step.'));
}
