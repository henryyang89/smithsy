// The gear list shared by the Workshop (with Scrap and the repair buttons) and the Adventurer tab (read only, with the
// could-break flag). One group per gear type, the strongest item first. The durability cell is one wrapping line:
//   [bar] 63%  [Repair +37%] 0.26 Iron C bars · 14.8m          (a packed item: "63% · with the adventurer today")
// Classes: gl- (css/ui-workshop.css). Repairs and scrapping go through core actions inside ctx.act().
import { h, bar, tip } from './dom.js';
import { SLOTS } from '../config.js';
import { scrap, scrapReturn, couldBreak, gearName } from '../core/gear.js';
import { packOrder } from '../core/pack.js';
import { cap, EPS } from '../core/util.js';
import { qty, repairLine } from './repairui.js';
import { durText } from './present.js';
import { gearCell, couldBreakText } from './endday.js';

const tone = (d) => (d >= 60 ? 'hi' : d >= 30 ? 'mid' : 'lo');

// "You get back 0.42 Copper C bars (35% of its 2 bars × 60% durability). The gem is lost."
function scrapNote(item, cfg) {
  const back = scrapReturn(item, cfg);
  const [bm, bg] = back.key.split(':');
  const backText = back.qty > EPS ? `${qty(back.qty)} ${cap(bm)} ${bg} bar${back.qty === 1 ? '' : 's'}` : 'nothing';
  const math = `${cfg.gear.repair.materialFraction}% of its ${cfg.gear.slots[item.slot].bars} bars × ${durText(item.durability)} durability`;
  return `You get back ${backText} (${math}).${item.gem ? ' The gem is lost.' : ''}`;
}

// The durability bar and number, as the first nodes of the durability line.
const durLead = (item, extra = null) => [bar(item.durability, `gl-bar ${tone(item.durability)}`), h('span', { class: 'gl-pct' }, durText(item.durability)), extra];

function durabilityCell(ctx, item, opts) {
  const { state, cfg } = ctx;
  // could-break flag (Adventurer tab): against the toughest enemy tier
  const flag = opts.flags && couldBreak(item, state, null, cfg)
    ? h('span', { class: 'adv-flag warn', 'data-flag': 'warn', ...tip(couldBreakText(state, cfg, item)) }, '⚠')
    : null;
  if (item.packed) {
    return h('div', { class: 'gl-dur gl-away', ...tip('Repair it on a day you leave it at home.') }, durLead(item, flag), h('span', { class: 'muted gl-where' }, ' · with the adventurer today'));
  }
  if (item.durability >= 100 || !opts.repair) return h('div', { class: 'gl-dur' }, durLead(item, flag));
  return repairLine(ctx, item, { blocked: opts.blocked ? `Workshop closed: ${opts.blocked}` : null, lead: durLead(item, flag) });
}

// items: the gear to list (any order). opts: { scrap (a Scrap column and button), repair (the repair buttons), blocked (why
// the workshop is closed, or null), flags (the could-break flag) }. repair defaults to the value of scrap.
export function gearTable(ctx, items, opts = {}) {
  const { cfg } = ctx;
  const o = { scrap: false, repair: opts.scrap === true, blocked: null, flags: false, ...opts };
  const order = packOrder(cfg);
  const rows = [];
  for (const slot of SLOTS) {
    const mine = items.filter((g) => g.slot === slot).sort(order);
    rows.push(h('tr', { class: 'gl-group' }, h('td', { colspan: o.scrap ? 3 : 2 },
      h('b', {}, cap(slot)), mine.length ? ` · ${mine.length} owned` : h('span', { class: 'muted' }, ' · none owned'))));
    for (const item of mine) {
      const scrapWhy = item.packed ? 'With the adventurer today' : o.blocked ? `Workshop closed: ${o.blocked}` : null;
      const note = scrapNote(item, cfg);
      rows.push(h('tr', { class: `gl-row${item.packed ? ' gl-packed' : ''}`, 'data-gear': item.id },
        h('td', { class: 'gl-item' }, gearCell(item, cfg)),
        h('td', { class: 'gl-durcell' }, durabilityCell(ctx, item, o)),
        o.scrap
          ? h('td', { class: 'gl-scrapcell' }, h('button', {
            class: 'small ghost ws-scrap',
            disabled: !!scrapWhy,
            'data-scrap': item.id,
            ...tip(scrapWhy || `Scrap this item. ${note}`),
            onclick: () => {
              if (confirm(`Scrap ${gearName(item)}? ${note}`)) ctx.act(() => scrap(ctx.state, item.id, cfg), { toast: true });
            },
          }, 'Scrap'))
          : null));
    }
  }
  return h('div', { class: 'ws-scroll' }, h('table', { class: `gl-table${o.scrap ? ' gl-hasscrap' : ''}` },
    h('thead', {}, h('tr', {}, h('th', {}, 'Item and stats'), h('th', {}, 'Durability'), o.scrap ? h('th', {}, 'Scrap') : null)),
    h('tbody', {}, rows)));
}
