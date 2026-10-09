// Workshop "Storage and gear": what you own, so you can see what to make next. Raw ores, bars by grade, gems (raw, cut by
// grade, in gear) and a gear table (gear type x material, with gem tags). Clicking a gear cell or a gem row selects it in
// the smith form (the Workshop passes the two handlers). Classes: ws- and inv- (css/ui-workshop.css).
import { h, section, tip, restoreScrollLeft } from './dom.js';
import { BARS, GEMS, ORES, GRADES } from '../config.js';
import { gearName, shownDurability } from '../core/gear.js';
import { cap, EPS } from '../core/util.js';
import { qty } from './repairui.js';
import { durText, gearMatrix, gemOverview } from './present.js';

// "Ru To Sa Em Di": the two-letter tag of a gem type (its first two letters).
export const gemTag = (gem) => cap(gem).slice(0, 2);

const countCell = (n) => (n > EPS ? h('td', { class: 'num' }, qty(n)) : h('td', { class: 'num ws-zero' }, '·'));

function smallTable(head, rows, cls = '') {
  return h('table', { class: `ws-table ws-compact ${cls}` },
    head ? h('thead', {}, h('tr', {}, head)) : null,
    h('tbody', {}, rows));
}

// The red dot of a chip: the durability the player reads ("30%") is at or below this (plan 4.12).
export const LOW_DURABILITY = 30;

// One item as a chip: its grade letter and gem tag. The hover has the whole name, the durability and whether it is away.
// A packed item has a dotted underline, one at 30% or less a red dot. The dot follows the SHOWN (rounded down) durability, so
// an item whose hover says "30%" always has it.
export function gearChip(item, cfg) {
  const low = shownDurability(item.durability) <= LOW_DURABILITY;
  const text = `${gearName(item)} · ${durText(item.durability)}${item.packed ? ' · with the adventurer today' : ''}`;
  return h('span', { class: `chip inv-chip${item.packed ? ' inv-packed' : ''}${low ? ' inv-low' : ''}`, 'data-gear': item.id, ...tip(text) },
    h('b', { class: `grade-${item.grade}` }, item.grade),
    item.gem ? h('span', { class: `inv-gem gem-${item.gem.type}` }, gemTag(item.gem.type)) : null,
    low ? h('i', { class: 'inv-dot' }) : null);
}

// opts: { onGear(slot, material), onGem(gem) }: what a click on a gear cell / gem row does (select it in the smith form).
export function inventoryPanel(ctx, opts = {}) {
  const { state: s, cfg } = ctx;
  const st = s.storage;
  const gradeHead = (first) => [h('th', {}, first), ...GRADES.map((g) => h('th', { class: `num grade-${g}` }, g)), h('th', { class: 'num' }, 'Total')];
  const gradeRow = (store, k) => {
    const vals = GRADES.map((g) => store[`${k}:${g}`] || 0);
    const total = vals.reduce((a, b) => a + b, 0);
    return h('tr', {}, h('td', {}, cap(k)), vals.map(countCell), total > EPS ? h('td', { class: 'num ws-total' }, qty(total)) : h('td', { class: 'num ws-zero' }, '·'));
  };

  // gems: raw, cut by grade, how many pieces of gear carry it. Clicking a row picks that gem in the smith form.
  const gemRows = gemOverview(s).map((g) => h('tr', { class: 'inv-gemrow', 'data-gem': g.gem, onclick: opts.onGem ? () => opts.onGem(g.gem) : null, ...tip(`Pick ${cap(g.gem)} in the smith form`) },
    h('td', {}, h('span', { class: `inv-gem gem-${g.gem}` }, gemTag(g.gem)), ' ', cap(g.gem)),
    countCell(g.raw),
    GRADES.map((gr) => countCell(g.cut[gr])),
    countCell(g.inGear)));

  // gear: one row per gear type, one column per material; each cell lists the items best first
  const matrix = gearMatrix(s.gear, cfg);
  const maxChips = cfg.display.chipsPerCell;
  const gearRows = matrix.rows.map((row) => {
    const head = h('td', { class: 'inv-type' }, h('b', {}, cap(row.slot)), row.total ? h('span', { class: 'muted' }, ` ${row.total}`) : null);
    if (!row.total) return h('tr', {}, head, h('td', { colspan: BARS.length + 1, class: 'inv-none warn' }, 'none yet'));
    const cells = BARS.map((m) => {
      const list = row.cells[m];
      const more = list.length - maxChips;
      return h('td', { class: `inv-cell${list.length ? ' inv-pick' : ''}`, 'data-slot': row.slot, 'data-material': m, onclick: opts.onGear ? () => opts.onGear(row.slot, m) : null },
        list.length
          ? [list.slice(0, maxChips).map((it) => gearChip(it, cfg)), more > 0 ? h('span', { class: 'chip inv-more', ...tip(list.slice(maxChips).map(gearName).join('\n')) }, `+${more}`) : null]
          : h('span', { class: 'ws-zero' }, '·'));
    });
    const gems = h('td', { class: 'inv-gems' },
      row.gems.length
        ? row.gems.map((g) => h('span', { class: 'inv-gemcount', ...tip(`${g.count} ${cap(row.slot)} with ${cap(g.gem)}`) }, h('span', { class: `inv-gem gem-${g.gem}` }, gemTag(g.gem)), g.count > 1 ? `×${g.count}` : ''))
        : h('span', { class: 'ws-zero' }, 'no gems'));
    return h('tr', {}, head, cells, gems);
  });

  return section('Storage and gear',
    h('div', { class: 'ws-storage' },
      h('div', { class: 'ws-raw' }, h('h4', {}, 'Raw ores'), smallTable(null, ORES.map((o) => h('tr', {}, h('td', {}, cap(o)), countCell(st.ore[o] || 0))))),
      h('div', { class: 'ws-graded' }, h('h4', {}, 'Bars by grade'), smallTable(gradeHead('Bar'), BARS.map((b) => gradeRow(st.bars, b)))),
      h('div', { class: 'ws-graded inv-gems-block' }, h('h4', {}, 'Gems'),
        h('div', { class: 'ws-scroll', 'data-scroll': 'gems' }, smallTable([h('th', {}, 'Gem'), h('th', { class: 'num' }, 'Raw'), GRADES.map((g) => h('th', { class: `num grade-${g}` }, g)), h('th', { class: 'num' }, 'In gear')], gemRows, 'inv-gemtable')))),
    h('h4', { class: 'inv-gear-h' }, `Gear (${matrix.total})`),
    h('p', { class: 'ws-sub' }, 'Each chip is one item: its grade, and its gem tag (',
      GEMS.map((g, i) => [i ? ' ' : '', h('span', { class: `inv-gem gem-${g}` }, gemTag(g))]),
      '). Click a cell to pick that gear type and material in the smith form below.'),
    h('div', { class: 'ws-scroll', 'data-scroll': 'gear' }, smallTable([h('th', {}, 'Gear'), BARS.map((m) => h('th', {}, cap(m))), h('th', {}, 'Gems')], gearRows, 'inv-geartable')));
}

// A tap on a gear cell or a gem row re-renders the Workshop, and the new scroll boxes start at 0: on a phone the gear table
// (wider than the screen) would jump back to the Copper column. Put each box back where the player had it, like the plan
// screen's roster does. Call it once the screen is in the page (scrollLeft only sticks on a laid-out box).
export function keepInventoryScroll(root, ctx) {
  const saved = ctx.ui.inv_scroll || (ctx.ui.inv_scroll = {});
  for (const box of root.querySelectorAll('[data-scroll]')) {
    const name = box.getAttribute('data-scroll');
    restoreScrollLeft(box, saved[name]);
    box.addEventListener('scroll', () => {
      saved[name] = box.scrollLeft;
    }, { passive: true });
  }
}
