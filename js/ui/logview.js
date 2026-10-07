// Log tab: full activity log (newest first) and battle history with expandable reports.
// Read-only screen. UI-only state: ctx.ui.log_q (filter text), ctx.ui.log_open (open battle days).
import { h, section } from './dom.js';
import { renderBattleReport } from './endday.js';

export function renderLog(root, ctx) {
  root.append(h('div', { class: 'adv-logview' }, battlesPanel(ctx), activityPanel(ctx)));
}

function activityPanel(ctx) {
  const s = ctx.state;
  const items = s.log.slice().reverse();
  const q = ctx.ui.log_q || '';
  const lis = [];
  let lastDay = null;
  for (const l of items) {
    if (l.day !== lastDay) {
      lastDay = l.day;
      lis.push(h('li', { class: 'adv-logday', 'data-day': l.day }, `Day ${l.day}`));
    }
    lis.push(h('li', { 'data-text': `${l.text}`.toLowerCase(), 'data-day': l.day }, h('span', { class: 'muted' }, `${l.time} `), l.text));
  }
  const list = h('ul', { class: 'log adv-loglist' }, lis);
  const count = h('span', { class: 'muted adv-small' });
  // Filter in place (no re-render, so the input keeps focus).
  const apply = (text) => {
    const t = text.trim().toLowerCase();
    const visibleDays = new Set();
    let shown = 0;
    for (const li of list.children) {
      if (li.classList.contains('adv-logday')) continue;
      const ok = !t || li.dataset.text.includes(t);
      li.style.display = ok ? '' : 'none';
      if (ok) {
        shown++;
        visibleDays.add(li.dataset.day);
      }
    }
    for (const li of list.children) if (li.classList.contains('adv-logday')) li.style.display = visibleDays.has(li.dataset.day) ? '' : 'none';
    count.textContent = t ? `${shown} of ${items.length} entries` : `${items.length} entries (newest first)`;
  };
  const input = h('input', {
    type: 'search',
    placeholder: 'Filter log…',
    value: q,
    oninput: (ev) => {
      ctx.ui.log_q = ev.target.value;
      apply(ev.target.value);
    },
  });
  apply(q);
  return section('Activity log',
    h('div', { class: 'row adv-tight' }, input, count),
    items.length ? h('div', { class: 'adv-logbox' }, list) : h('p', { class: 'muted' }, 'Nothing yet.'));
}

function battlesPanel(ctx) {
  const s = ctx.state;
  const battles = s.battles.slice().reverse();
  ctx.ui.log_open = ctx.ui.log_open || {};
  if (!battles.length) return section('Battle history', h('p', { class: 'muted' }, 'No fights yet. The adventurer fights every day from day 2.'));
  return section(`Battle history (last ${battles.length})`,
    h('p', { class: 'adv-tight muted adv-small' }, 'Click a fight to see its full report and combat log.'),
    battles.map((r) => battleItem(ctx, r)));
}

function battleItem(ctx, r) {
  const kind = r.win ? 'win' : r.draw ? 'draw' : 'loss';
  const label = r.win ? 'Victory' : r.draw ? 'Draw' : 'Defeat';
  const open = !!ctx.ui.log_open[r.day];
  const body = h('div', { class: 'adv-bbody' });
  const fill = () => {
    if (!body.firstChild) body.append(renderBattleReport(r, ctx, { headline: false }));
  };
  const d = h('details', { class: 'adv-battle', open },
    h('summary', {},
      h('b', {}, `Day ${r.day}`), ' · ',
      h('span', { class: `adv-${kind}` }, label), ` vs ${r.enemy.name} `,
      h('span', { class: `tier-${r.enemy.tier}` }, `(${r.enemy.tier})`),
      h('span', { class: 'muted' }, ` · ${r.time.toFixed(1)}s · HP ${Math.round(r.advHp)}/${Math.round(r.advMaxHp)}`),
      r.ringText ? h('span', { class: 'muted' }, ' · ring: ', h('span', { class: `grade-${r.ring.grade}` }, r.ringText)) : null,
      r.destroyed && r.destroyed.length ? h('span', { class: 'err' }, ` · destroyed: ${r.destroyed.join(', ')}`) : null),
    body);
  if (open) fill();
  d.addEventListener('toggle', () => {
    ctx.ui.log_open[r.day] = d.open;
    if (d.open) fill();
  });
  return d;
}
