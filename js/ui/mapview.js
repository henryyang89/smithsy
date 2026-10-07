// Map tab: the 5x5 world map, the 8x8 field grid with its actions, and the bag.
// All game-state changes go through core functions inside ctx.act(). UI-only state lives in
// ctx.ui under the map_ prefix (map_sel: selected cell per field, map_new: bag slots just found).
import { h, section, bar } from './dom.js';
import {
  travel, search, clearDebris, pickUp, dropItem, travelMinutes, returnMinutes, searchMinutes,
  searchEfficiency, debrisMinutesPerCell, fieldProgress, areaCells, atCamp, currentField, mapCell,
  itemKind, itemType, key, timeLeft, pickUpLimit,
} from '../core/map.js';
import { smithBonuses } from '../core/bonuses.js';
import { formatClock, formatDuration, cap, round1, clamp } from '../core/util.js';
import { ORES, GEMS } from '../config.js';

const EPS = 1e-9;
const ABBR = { copper: 'Cu', iron: 'Fe', coal: 'Co', mythril: 'My', ruby: 'Ru', topaz: 'To', sapphire: 'Sa', emerald: 'Em', diamond: 'Di' };

// ------------------------------------------------------------- formatting ----
const dur = (m) => (Number.isFinite(m) ? formatDuration(Math.max(0, m)) : 'no path');
const clock = (m) => formatClock(m);
// "3.5%" below 10, otherwise whole numbers rounded down (so 99.6% never reads as 100%).
const pctText = (v) => `${v > 0 && v < 10 ? round1(v) : Math.floor(v + 1e-6)}%`;
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function itemName(t) {
  const type = itemType(t);
  return itemKind(t) === 'ore' ? `${cap(type)} ore` : `Raw ${type}`;
}

function itemTag(t) {
  const type = itemType(t);
  return h('span', { class: `mv-item mv-${itemKind(t)} mv-t-${type}`, title: itemName(t) }, ABBR[type] || type.slice(0, 2));
}

// 1-based "(x,y)" label for a field cell index.
function cellLabel(idx, n) {
  return `(${(idx % n) + 1},${Math.floor(idx / n) + 1})`;
}

const isDone = (c) => !c.debris && c.searched >= 100 - EPS;
const groundCount = (field) => field.cells.reduce((a, c) => a + c.ground.length, 0);

// Same rule as core: a field action must leave time to walk home by the end of the day.
function fitsWithReturn(state, minutes, cfg) {
  return state.time + minutes + returnMinutes(state, state.location, state.bag.length, cfg) <= cfg.time.dayEndMin + EPS;
}

// ------------------------------------------------------------- selection ----
function getSel(ctx, fkey) {
  const n = ctx.cfg.field.size;
  const all = (ctx.ui.map_sel ||= {});
  if (!(fkey in all)) all[fkey] = n + 1; // default: cell (2,2), so the 3x3 area is the top-left corner
  return clamp(all[fkey], 0, n * n - 1);
}

function setSel(ctx, fkey, idx) {
  (ctx.ui.map_sel ||= {})[fkey] = idx;
}

// ---------------------------------------------------------------- actions ----
function doTravel(ctx, to) {
  ctx.ui.map_new = null;
  return ctx.act(() => travel(ctx.state, { x: to.x, y: to.y }));
}

function doSearch(ctx, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  return ctx.act(() => {
    const before = state.bag.length;
    const res = search(state, sel % n, Math.floor(sel / n));
    if (res.ok) ctx.ui.map_new = { start: before, end: state.bag.length };
    return res;
  }, { toast: true });
}

function doClear(ctx, sel) {
  const n = ctx.cfg.field.size;
  return ctx.act(() => clearDebris(ctx.state, sel % n, Math.floor(sel / n)), { toast: true });
}

function doPickUp(ctx, sel, groundIndex = null) {
  ctx.ui.map_new = null;
  return ctx.act(() => pickUp(ctx.state, sel, ctx.cfg, groundIndex));
}

function doDrop(ctx, bagIndex, sel) {
  ctx.ui.map_new = null;
  return ctx.act(() => dropItem(ctx.state, bagIndex, sel));
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
  const tag = (e.target && e.target.tagName) || '';
  if (/^(INPUT|SELECT|TEXTAREA)$/.test(tag) || (e.target && e.target.isContentEditable)) return;
  const { state, cfg } = ctx;
  if (state.phase !== 'work' || ctx.ui.tab !== 'map' || atCamp(state)) return;
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
  const k = e.key.toLowerCase();
  if (k === 's') doSearch(ctx, sel);
  else if (k === 'c') doClear(ctx, sel);
  else if (k === 'p') doPickUp(ctx, sel);
  else return;
  e.preventDefault();
}

// ----------------------------------------------------------------- render ----
export function renderMap(root, ctx) {
  keyCtx = ctx;
  bindKeys();
  const wrap = h('div', { class: 'mv-root' });
  root.append(wrap);
  if (ctx.state.phase !== 'work') {
    wrap.append(section('Map', h('p', { class: 'muted' }, 'The work day is over.')));
    return;
  }
  if (atCamp(ctx.state)) renderCamp(wrap, ctx);
  else renderFieldView(wrap, ctx);
}

function renderCamp(wrap, ctx) {
  const { state } = ctx;
  wrap.append(h('div', { class: 'mv-two' },
    section('World map', worldMap(ctx, false),
      h('p', { class: 'muted mv-note' }, 'Click a field to walk there. Each tile shows its distance from camp, how much of it you have searched, and the walk from here.')),
    section('Where to search?', campHint(ctx))));
  if (state.bag.length) wrap.append(bagPanel(ctx, null));
  wrap.append(section('What the fields hold, by distance from camp', oddsTable(ctx)));
  wrap.append(legend(ctx));
}

function renderFieldView(wrap, ctx) {
  const { state } = ctx;
  const field = currentField(state);
  const fkey = key(state.location.x, state.location.y);
  const sel = getSel(ctx, fkey);
  wrap.append(h('div', { class: 'mv-two' },
    h('div', {}, fieldPanel(ctx, field, fkey, sel)),
    h('div', {}, actionsPanel(ctx, field, sel), cellPanel(ctx, field, sel), bagPanel(ctx, sel))));
  wrap.append(h('div', { class: 'mv-two' },
    section('World map', worldMap(ctx, true),
      h('p', { class: 'muted mv-note' }, `Click a field to travel there directly, or the camp to go home. Times include your bag load (+${state.bag.length * ctx.cfg.map.loadPenaltyPerItem}%).`)),
    legend(ctx)));
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
  const items = state.bag.length;
  const load = items ? ` (with ${plural(items, 'item')} in the bag)` : '';
  if (c.type === 'blocked') {
    return h('div', { class: 'cell blocked', title: 'Impassable rock: paths go around it.' }, h('span', { class: 'mv-rock' }, ''));
  }
  if (c.type === 'camp') {
    const ret = here ? 0 : returnMinutes(state, state.location, items, cfg);
    return h('div', {
      class: `cell camp${here ? ' here' : ''}`,
      title: here ? 'Camp: you are here. Storage and workshop. The day can only be ended here.' : `Camp: walk back ${dur(ret)}${load}, arriving ${clock(state.time + ret)}. Unloads the bag into storage.`,
      onclick: here ? null : () => doTravel(ctx, c),
    }, h('span', { class: 'mv-wm' },
      h('span', { class: 'mv-wm-p' }, 'Camp'),
      h('span', { class: 'mv-wm-t' }, here ? 'you are here' : `back ${dur(ret)}`)));
  }
  const field = map.fields[key(c.x, c.y)];
  const prog = fieldProgress(field);
  const there = here ? 0 : travelMinutes(state, state.location, c, items, cfg);
  const back = travelMinutes(state, c, map.camp, items, cfg);
  const fits = here || state.time + there + back <= cfg.time.dayEndMin + EPS;
  const ground = groundCount(field);
  const title = [
    `Field (${c.x + 1},${c.y + 1}) · distance ${c.dist} from camp`,
    `Searched: ${pctText(prog)}`,
    here ? 'You are here.' : `Travel there: ${dur(there)}, then back to camp: ${dur(back)}${load}`,
    !here ? `Arrive ${clock(state.time + there)}${fits ? '' : ` - not enough time to get there and back by ${clock(cfg.time.dayEndMin)}`}` : null,
    ground ? `${plural(ground, 'item')} left on the ground` : null,
  ].filter(Boolean).join('\n');
  return h('div', {
    class: `cell field${here ? ' here' : ''}${fits ? '' : ' mv-far'}`,
    title,
    'data-x': c.x,
    'data-y': c.y,
    onclick: here ? null : () => doTravel(ctx, c),
  },
  h('div', { class: 'fill', style: { height: `${prog}%` } }),
  ground ? h('div', { class: 'mv-badge', title: `${plural(ground, 'item')} on the ground` }, String(ground)) : null,
  h('span', { class: 'mv-wm' },
    h('span', { class: 'mv-wm-d' }, `dist ${c.dist}`),
    h('span', { class: 'mv-wm-p' }, pctText(prog)),
    h('span', { class: 'mv-wm-t' }, here ? 'here' : dur(there))));
}

// ---------------------------------------------------------------- at camp ----
function campHint(ctx) {
  const { state, cfg } = ctx;
  const b = smithBonuses(state, cfg);
  const fields = state.map.cells.filter((c) => c.type === 'field');
  const reachable = fields.filter((c) => {
    const there = travelMinutes(state, state.location, c, 0, cfg);
    const back = travelMinutes(state, c, state.map.camp, 0, cfg);
    return state.time + there + back <= cfg.time.dayEndMin + EPS;
  }).length;
  const left = timeLeft(state, cfg);
  const regrow = cfg.field.regrowPctPerDay || 0;
  const st = state.storage;
  const stored = [...ORES.map((o) => [`ore:${o}`, st.ore[o] || 0]), ...GEMS.map((g) => [`gem:${g}`, st.gem[g] || 0])].filter(([, v]) => v > 0);
  return h('div', {},
    h('p', {}, 'Pick a field to search. ', h('b', {}, 'Farther fields are richer'), ' (more cells hold items, rarer ores and gems) but the walk takes longer and eats into your day.'),
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Now'), h('span', {}, `${clock(state.time)} - ${left > 0 ? `${dur(left)} left` : 'day over'} (day ends ${clock(cfg.time.dayEndMin)})`),
      h('span', { class: 'muted' }, 'Walking'), h('span', {}, `${cfg.map.travelMinPerStep}m per step, +${cfg.map.loadPenaltyPerItem}% per item in the bag${b.travelPct ? `, -${round1(b.travelPct)}% (rings)` : ''}${b.returnPct ? `, -${round1(b.returnPct)}% more on the way home (skill)` : ''}`),
      h('span', { class: 'muted' }, 'Searching'), h('span', {}, `${dur(searchMinutes(state, cfg))} per 3x3 area, each search digs ${round1(searchEfficiency(state, cfg))}% deeper into every cell`),
      h('span', { class: 'muted' }, 'Ore sight'), h('span', {}, `${round1(b.revealPct)}% chance per searched cell to reveal everything still in it`),
      h('span', { class: 'muted' }, 'Reachable'), h('span', { class: reachable ? '' : 'warn' }, `${reachable} of ${fields.length} fields are close enough to go to and be back by ${clock(cfg.time.dayEndMin)}`),
      regrow > 0 ? [h('span', { class: 'muted' }, 'Regrowth'), h('span', {}, `searched cells have a ${round1(regrow)}% chance each night to turn fresh and unsearched, with new hidden items`)] : null),
    h('p', { class: 'muted mv-note' }, `You may only head out, search or clear debris if there is still time to walk back by ${clock(cfg.time.dayEndMin)} with your current load. The walk home itself is always allowed. Arriving at camp unloads the bag (${cfg.bag.slots} slots) into storage.`),
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
  const cellsPerField = f.size * f.size;
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
    th('Walk out / back', { rowspan: 2, title: 'Walking time from camp and back, with an empty bag' }),
    th('Cells with items', { rowspan: 2, title: `Chance each cell holds items (in brackets: under debris, +${f.debrisLootBonus} points)` }),
    th('Items / field', { rowspan: 2, title: `Expected items in a whole ${f.size}x${f.size} field (${countRange} per loot cell, about ${round1(avgCount)} on average)` }),
    th('Searched', { rowspan: 2, title: 'Average % searched of your fields at this distance' }),
    h('th', { colspan: ORES.length, class: 'mv-group mv-sep-l' }, `Ores (${f.oreShare}% of items)`),
    h('th', { colspan: GEMS.length, class: 'mv-group' }, `Gems (${100 - f.oreShare}% of items)`));
  const headSub = h('tr', {},
    ...ORES.map((o) => h('th', { class: 'num mv-sep-l', title: `${cap(o)} ore` }, itemTag(`ore:${o}`))),
    ...GEMS.map((g) => h('th', { class: 'num', title: `Raw ${g}` }, itemTag(`gem:${g}`))));
  return h('div', {},
    h('div', { class: 'mv-scroll' }, h('table', { class: 'mv-odds' }, h('thead', {}, headTop, headSub), h('tbody', {}, rows))),
    h('p', { class: 'muted mv-note' }, `Ore and gem columns: chance that an item found at that distance is that type. Fields farther than ${f.oreWeights.length} steps use the last row of odds. Debris covers about ${f.debrisChance}% of cells.`));
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
  const debrisLeft = field.cells.filter((c) => c.debris).length;
  const done = field.cells.filter(isDone).length;
  const revealed = field.cells.filter((c) => c.revealed).length;
  const ground = groundCount(field);
  const d = field.dist;
  const loot = Math.min(f.lootChance.max, f.lootChance.base + f.lootChance.perDistance * (d - 1));
  return section(`Field (${state.location.x + 1},${state.location.y + 1}) · distance ${d} from camp`,
    h('div', { class: 'row mv-prog' }, bar(prog), h('b', {}, `${pctText(prog)} searched`)),
    h('div', { class: 'muted mv-stats' },
      `${plural(done, 'cell')} fully searched · ${debrisLeft} under debris · ${revealed} revealed · ${plural(ground, 'item')} on the ground`),
    grid,
    h('p', { class: 'muted mv-note' },
      `Click a cell to centre the 3x3 search area on it (selected: ${cellLabel(sel, n)}). At distance ${d}, about ${loot}% of cells hold items (${Math.min(100, loot + f.debrisLootBonus)}% under debris). Contents stay hidden until found or revealed by ore sight.`));
}

function fieldCell(ctx, fkey, cell, i, selected, inArea) {
  const n = ctx.cfg.field.size;
  const done = isDone(cell);
  const partial = !cell.debris && !done && cell.searched > EPS;
  const cls = ['cell'];
  if (cell.debris) cls.push('debris');
  if (done) cls.push('mv-done');
  if (partial) cls.push('mv-partial');
  if (cell.revealed && !done) cls.push('mv-revealed');
  if (selected) cls.push('sel');
  if (inArea) cls.push('area');

  let content;
  if (cell.revealed && !done) content = cell.items.length ? cell.items.map((it) => itemTag(it.t)) : h('span', { class: 'mv-empty' }, 'empty');
  else if (cell.debris) content = h('span', { class: 'mv-debris-l' }, 'debris');
  else if (done) content = h('span', { class: 'mv-done-l' }, 'done');
  else if (partial) content = h('span', { class: 'mv-pct' }, pctText(cell.searched));
  else content = null;

  const title = [
    `Cell ${cellLabel(i, n)}: ${pctText(cell.searched)} searched`,
    cell.debris ? 'Covered by debris: clear it before searching.' : null,
    cell.revealed && !done ? `Revealed: ${cell.items.length ? cell.items.map((it) => itemName(it.t)).join(', ') : 'nothing left'}` : null,
    done ? 'Fully searched: nothing hidden left.' : null,
    cell.ground.length ? `On the ground: ${cell.ground.map(itemName).join(', ')}` : null,
  ].filter(Boolean).join('\n');

  return h('div', {
    class: cls.join(' '),
    title,
    'data-idx': i,
    onclick: () => {
      setSel(ctx, fkey, i);
      ctx.rerender();
    },
  },
  partial ? h('div', { class: 'fill', style: { height: `${cell.searched}%` } }) : null,
  cell.ground.length ? h('div', { class: 'mv-badge', title: `${plural(cell.ground.length, 'item')} on the ground` }, String(cell.ground.length)) : null,
  h('span', { class: 'mv-cc' }, content));
}

function actionsPanel(ctx, field, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  const b = smithBonuses(state, cfg);
  const cells = areaCells(sel % n, Math.floor(sel / n), cfg).map((i) => field.cells[i]);
  const searchable = cells.filter((c) => !c.debris && c.searched < 100 - EPS).length;
  const debris = cells.filter((c) => c.debris).length;
  const done = cells.filter(isDone).length;
  const sMin = searchMinutes(state, cfg);
  const eff = searchEfficiency(state, cfg);
  const per = debrisMinutesPerCell(state, cfg);
  const cMin = round1(per * debris);
  const items = state.bag.length;
  const ret = returnMinutes(state, state.location, items, cfg);
  const left = timeLeft(state, cfg);
  const latest = cfg.time.dayEndMin - ret;
  const spare = latest - state.time;
  const free = cfg.bag.slots - items;
  const cell = field.cells[sel];
  const lateMsg = (m) => `Not enough time: done at ${clock(state.time + m)}, home at ${clock(state.time + m + ret)} (after ${clock(cfg.time.dayEndMin)}).`;

  // Search
  const sFits = fitsWithReturn(state, sMin, cfg);
  const sParts = [`${dur(sMin)}: ${plural(searchable, 'cell')} get +${round1(eff)}% searched`];
  if (debris) sParts.push(`${debris} under debris skipped`);
  if (done) sParts.push(`${done} already done`);
  if (searchable) sParts.push(`done at ${clock(state.time + sMin)}`);
  const sWhy = !searchable ? 'Nothing left to search in this area.' : !sFits ? lateMsg(sMin) : !free ? 'Bag is full: anything found stays on the ground.' : null;
  const bonusBits = [];
  if (sMin < cfg.field.searchMin - EPS) bonusBits.push(`time ${cfg.field.searchMin}m -${round1(b.searchTimePct)}%`);
  if (eff > cfg.field.searchEfficiency + EPS) bonusBits.push(`depth ${cfg.field.searchEfficiency}% +${round1(b.searchEffPct)}%`);

  // Clear debris
  const cFits = debris > 0 && fitsWithReturn(state, cMin, cfg);
  const cWhy = debris && !cFits ? lateMsg(cMin) : null;

  // Pick up
  const g = cell.ground.length;
  const pLimit = pickUpLimit(state, cfg);
  const pWhy = !g ? `Nothing on the ground in cell ${cellLabel(sel, n)}.` : !free ? 'Bag is full: drop something first.'
    : state.bag.length >= pLimit ? `Carrying more would make the walk home end after ${clock(cfg.time.dayEndMin)}.` : null;

  const actRow = (label, onclick, disabled, info, why, extra, attrs = {}) => h('div', { class: 'mv-act' },
    h('button', { class: attrs.primary ? 'primary' : '', disabled, onclick, title: why || info, 'data-act': attrs.id }, label),
    h('div', {},
      h('div', {}, info),
      why ? h('div', { class: 'warn mv-why' }, why) : null,
      extra ? h('div', { class: 'muted mv-why' }, extra) : null));

  const timeCls = spare <= 0 ? 'err' : spare < sMin ? 'warn' : '';
  return section(`Actions on the 3x3 area around ${cellLabel(sel, n)}`,
    h('div', { class: 'mv-kv mv-time' },
      h('span', { class: 'muted' }, 'Now'), h('span', {}, `${clock(state.time)} - ${left > 0 ? `${dur(left)} left (day ends ${clock(cfg.time.dayEndMin)})` : 'the day is over'}`),
      h('span', { class: 'muted' }, 'Walk home'), h('span', {}, `${dur(ret)} with ${plural(items, 'item')} in the bag`),
      h('span', { class: 'muted' }, 'Deadline'), h('span', { class: timeCls }, spare > EPS
        ? `Field work must be done by ${clock(latest)}: ${dur(spare)} to spare`
        : `Past ${clock(Math.max(latest, cfg.time.dayStartMin))}: only the walk home is possible now`)),
    h('div', { class: 'mv-actions' },
      actRow('Search area', () => doSearch(ctx, sel), !searchable || !sFits, sParts.join(' · '), sWhy,
        `Ore sight: ${round1(b.revealPct)}% chance per searched cell to reveal everything still in it.${bonusBits.length ? ` Bonuses: ${bonusBits.join(', ')}.` : ''}`, { primary: true, id: 'search' }),
      actRow('Clear debris', () => doClear(ctx, sel), !cFits, debris ? `${debris} × ${dur(per)} = ${dur(cMin)} · done at ${clock(state.time + cMin)}` : '0 debris cells in this area', cWhy, null, { id: 'clear' }),
      actRow('Pick up', () => doPickUp(ctx, sel), !!pWhy, `${plural(g, 'item')} on the ground in ${cellLabel(sel, n)} · no time · ${plural(free, 'free slot')}`, g ? pWhy : null, null, { id: 'pickup' }),
      actRow('Return to camp', () => doTravel(ctx, state.map.camp), false, `${dur(ret)} · arrive ${clock(state.time + ret)}${items ? ` · unloads ${plural(items, 'item')} into storage` : ''}`, null, null, { id: 'return' })),
    h('p', { class: 'muted mv-note' }, `Each search digs ${round1(eff)}% deeper into every searchable cell of the area. Hidden items are found once the searched % passes their random depth (0-100%).`));
}

function cellPanel(ctx, field, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  const cell = field.cells[sel];
  const done = isDone(cell);
  const area = areaCells(sel % n, Math.floor(sel / n), cfg).map((i) => field.cells[i]);
  const avg = area.reduce((a, c) => a + c.searched, 0) / area.length;
  let contents;
  if (cell.revealed && !done) {
    contents = cell.items.length
      ? h('span', { class: 'chips' }, cell.items.map((it) => h('span', { class: 'chip' }, itemTag(it.t), ` ${itemName(it.t)}`)))
      : h('span', {}, 'Revealed: nothing left in this cell.');
  } else if (cell.debris) contents = h('span', { class: 'muted' }, 'Hidden under debris (debris cells are a bit richer).');
  else if (done) contents = h('span', {}, 'Fully searched: nothing hidden left.');
  else contents = h('span', { class: 'muted' }, 'Hidden. Search deeper, or hope ore sight reveals it.');
  return section(`Selected cell ${cellLabel(sel, n)}`,
    h('div', { class: 'mv-kv' },
      h('span', { class: 'muted' }, 'Searched'), h('span', { class: 'row' }, bar(cell.searched), pctText(cell.searched)),
      h('span', { class: 'muted' }, 'Debris'), h('span', {}, cell.debris ? `Yes: clear it first (${dur(debrisMinutesPerCell(state, cfg))})` : 'No'),
      h('span', { class: 'muted' }, 'Contents'), contents,
      h('span', { class: 'muted' }, 'On the ground'), cell.ground.length
        ? h('span', {},
          h('span', { class: 'chips' }, cell.ground.map((t, gi) => h('button', {
            class: 'chip clickable',
            title: `Pick up this ${itemName(t)} (free)`,
            disabled: state.phase !== 'work' || state.bag.length >= Math.min(cfg.bag.slots, pickUpLimit(state, cfg)),
            onclick: () => doPickUp(ctx, sel, gi),
          }, itemTag(t), ` ${itemName(t)}`))),
          h('div', { class: 'muted' }, 'Click an item to pick up just that one.'))
        : h('span', { class: 'muted' }, 'nothing'),
      h('span', { class: 'muted' }, '3x3 area'), h('span', {}, `${area.length} cells, ${pctText(avg)} searched on average, ${area.filter((c) => c.debris).length} under debris, ${area.filter(isDone).length} fully searched`)));
}

// ------------------------------------------------------------------- bag ----
function bagPanel(ctx, sel) {
  const { state, cfg } = ctx;
  const n = cfg.field.size;
  const items = state.bag.length;
  const pen = cfg.map.loadPenaltyPerItem;
  const inField = !atCamp(state);
  const fresh = ctx.ui.map_new;
  const slots = h('div', { class: 'slots mv-bag' });
  for (let i = 0; i < cfg.bag.slots; i++) {
    const t = state.bag[i];
    if (!t) {
      slots.append(h('div', { class: 'slot empty' }));
      continue;
    }
    const isNew = fresh && i >= fresh.start && i < fresh.end;
    slots.append(h('div', {
      class: `slot mv-slot mv-${itemKind(t)} mv-t-${itemType(t)}${isNew ? ' mv-new' : ''}`,
      title: inField ? `${itemName(t)}: click to drop it on cell ${cellLabel(sel, n)}` : itemName(t),
      'data-bag': i,
      onclick: inField ? () => doDrop(ctx, i, sel) : null,
    }, ABBR[itemType(t)] || itemType(t).slice(0, 2)));
  }
  const counts = {};
  for (const t of state.bag) counts[t] = (counts[t] || 0) + 1;
  const ret = inField ? returnMinutes(state, state.location, items, cfg) : 0;
  const retEmpty = inField ? returnMinutes(state, state.location, 0, cfg) : 0;
  return section(`Bag ${items}/${cfg.bag.slots}`,
    slots,
    Object.keys(counts).length ? h('div', { class: 'chips mv-counts' }, Object.entries(counts).map(([t, v]) => h('span', { class: 'chip', title: itemName(t) }, itemTag(t), ` ×${v}`))) : null,
    h('p', { class: 'mv-note' },
      `Load: ${plural(items, 'item')} × ${pen}% = `, h('b', {}, `+${items * pen}% travel time`),
      inField ? `. Walk home ${dur(ret)} now, ${dur(retEmpty)} with an empty bag.` : '.'),
    h('p', { class: 'muted mv-note' }, inField
      ? `Click an item to drop it on the selected cell ${cellLabel(sel, n)} (you can pick it up later). When the bag is full, found items stay on the ground.`
      : 'Arriving at camp unloads the bag into storage.'));
}

// ---------------------------------------------------------------- legend ----
function swatch(cls, inner, opts = {}) {
  return h('div', { class: `grid mv-sw${opts.big ? ' mv-sw-big' : ''}` },
    h('div', { class: `cell ${cls}` },
      opts.fill ? h('div', { class: 'fill', style: { height: `${opts.fill}%` } }) : null,
      opts.badge ? h('div', { class: 'mv-badge' }, opts.badge) : null,
      h('span', { class: opts.wm ? 'mv-wm' : 'mv-cc' }, inner)));
}

function legend(ctx) {
  const item = (sw, text) => h('div', { class: 'mv-leg' }, sw, h('span', {}, text));
  const open = ctx.ui.map_legend !== false; // remembered per session, open by default
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
      item(swatch('field here', h('span', { class: 'mv-wm-t' }, 'here'), { big: true, wm: true }), 'You are here'),
      item(swatch('field mv-far', h('span', { class: 'mv-wm-t' }, '2h'), { big: true, wm: true }), `Faded: not enough time to go there and get back by ${clock(ctx.cfg.time.dayEndMin)}`),
      item(swatch('blocked', '', { big: true }), 'Impassable rock'),
      item(swatch('camp', h('span', { class: 'mv-wm-p' }, 'Camp'), { big: true, wm: true }), 'Camp: storage and workshop; end the day here')),
    h('div', { class: 'mv-leg-title muted' }, 'Field cells'),
    h('div', { class: 'mv-legend mv-field' },
      item(swatch('', ''), 'Not searched yet'),
      item(swatch('mv-partial', h('span', { class: 'mv-pct' }, '50%'), { fill: 50 }), 'Partly searched: the fill rises with % searched'),
      item(swatch('mv-done', h('span', { class: 'mv-done-l' }, 'done')), (ctx.cfg.field.regrowPctPerDay || 0) > 0 ? 'Fully searched: nothing hidden left (until it regrows overnight)' : 'Fully searched: nothing hidden left'),
      item(swatch('debris', h('span', { class: 'mv-debris-l' }, 'debris')), 'Debris: clear before searching (a bit richer)'),
      item(swatch('mv-revealed', [itemTag('ore:iron'), itemTag('gem:ruby')]), 'Revealed by ore sight: what is still in the cell'),
      item(swatch('mv-revealed', h('span', { class: 'mv-empty' }, 'empty')), 'Revealed and empty'),
      item(swatch('', '', { badge: '2' }), 'Items lying on the ground (pick up / dropped / bag was full)'),
      item(h('div', { class: 'mv-sw-pair' }, swatch('area', ''), swatch('sel area', '')), 'Selected cell (orange border) and its 3x3 search area (tinted)')),
    h('div', { class: 'mv-leg-title muted' }, 'Items (square = ore, round = gem)'),
    h('div', { class: 'chips' },
      ORES.map((o) => h('span', { class: 'chip' }, itemTag(`ore:${o}`), ` ${cap(o)}`)),
      GEMS.map((g) => h('span', { class: 'chip' }, itemTag(`gem:${g}`), ` ${cap(g)}`))),
    h('p', { class: 'muted mv-note' }, 'Keys in a field: arrow keys move the selection, S searches, C clears debris, P picks up.'));
}
