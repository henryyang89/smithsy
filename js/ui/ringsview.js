// Rings tab: owned rings per wearer (smith / adventurer), wear toggles, stacking, totals, reference tables.
// All game-state changes go through toggleRing() inside ctx.act(). UI-only state: ctx.ui.rings_filter.
import { h, num } from './dom.js';
import { GRADES, TIERS } from '../config.js';
import { toggleRing, ringTotals, ringContributions, ringValue, ringDef, wornRings, smithRingLock } from '../core/rings.js';
import { cap } from '../core/util.js';

const OWNERS = ['smith', 'adventurer'];
const OWNER_TITLE = { smith: 'Smith rings (you)', adventurer: 'Adventurer rings' };
const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'worn', label: 'Worn' },
  { id: 'unworn', label: 'Not worn' },
];

// ------------------------------------------------------------------ helpers ----
// "10% less travel time" / "6 accuracy rating"
function effectText(v, desc) {
  return desc.startsWith('%') ? `${num(v, 2)}${desc}` : `${num(v, 2)} ${desc}`;
}

const gradeSpan = (g) => h('span', { class: `grade-${g}` }, g);
const fmtPct = (v) => `${num(v, 2)}%`;

// Table helper. Cells: string | Node | { v, cls, title, span }. Rows: array of cells or { attrs, cells }.
function tbl(head, rows, cls = '') {
  const cell = (tag, c) => {
    if (c && typeof c === 'object' && !(c instanceof Node) && !Array.isArray(c) && 'v' in c) {
      return h(tag, { class: c.cls, title: c.title, colspan: c.span }, c.v);
    }
    return h(tag, {}, c);
  };
  return h('div', { class: 'mi-scroll' },
    h('table', { class: `mi-table ${cls}` },
      head ? h('thead', {}, h('tr', {}, head.map((c) => cell('th', c)))) : null,
      h('tbody', {}, rows.map((r) => (Array.isArray(r)
        ? h('tr', {}, r.map((c) => cell('td', c)))
        : h('tr', r.attrs || {}, r.cells.map((c) => cell('td', c))))))));
}

function typeOrder(cfg) {
  const keys = Object.keys(cfg.rings.types);
  return (type) => keys.indexOf(type);
}

function ownedBy(state, owner, cfg) {
  return state.rings.filter((r) => ringDef(r.type, cfg) && ringDef(r.type, cfg).owner === owner);
}

// Stacking weights: 100%, 50%, 25%, ...
function stackWeights(cfg, n = 5) {
  return Array.from({ length: n }, (_, i) => cfg.rings.duplicateFactor ** i * 100);
}

// --------------------------------------------------------------------- main ----
export function renderRings(root, ctx) {
  const ui = ctx.ui;
  if (!ui.rings_filter) ui.rings_filter = { smith: 'all', adventurer: 'all' };
  root.append(h('div', { class: 'mi-root' },
    summaryPanel(ctx),
    ...OWNERS.map((o) => ownerPanel(ctx, o)),
    referencePanel(ctx)));
}

// ------------------------------------------------------------------ summary ----
function summaryPanel(ctx) {
  const { state, cfg } = ctx;
  const max = cfg.rings.maxWorn;
  const counts = Object.fromEntries(OWNERS.map((o) => [o, ownedBy(state, o, cfg).length]));
  const worn = Object.fromEntries(OWNERS.map((o) => [o, wornRings(state, o, cfg).length]));
  const weights = stackWeights(cfg).map((w, i) => `${ordinal(i + 1)} ${fmtPct(w)}`).join(', ');

  let today = null;
  if (state.plan) {
    const ids = state.plan.ringIds || [];
    const rings = state.rings.filter((r) => ids.includes(r.id));
    today = h('div', { class: 'mi-callout' },
      h('b', {}, `Today the adventurer is fighting ${state.plan.enemy.name}`),
      ` with the rings locked in last night${rings.length ? ':' : ' (none).'}`,
      rings.length ? h('div', { class: 'chips mi-chips' }, rings.map((r) => h('span', { class: 'chip' }, `${ringDef(r.type, cfg).name} `, gradeSpan(r.grade), ` (${num(ringValue(r, cfg), 2)})`))) : null,
      h('div', { class: 'mi-note' }, 'Changing adventurer rings below does not affect today\'s fight. It sets the default for tonight\'s plan.'));
  }

  return h('section', { class: 'panel' },
    h('h3', {}, 'Rings'),
    h('div', { class: 'mi-kpis' },
      kpi('Owned', String(state.rings.length), `${counts.smith} smith · ${counts.adventurer} adventurer`),
      kpi('Smith wears', `${worn.smith} / ${max}`, 'applies right now'),
      kpi('Adventurer wears', `${worn.adventurer} / ${max}`, 'default for tonight\'s plan')),
    h('ul', { class: 'mi-list' },
      h('li', {}, `Each wearer can wear up to ${max} rings. Rings of the same type stack with diminishing returns: the best counts ${weights}, and so on.`),
      h('li', {}, h('b', {}, 'Smith rings'), ' (travel, searching, refining, grade luck) apply at once, but can only be swapped at the start of a day (before your first action) or while planning at night, so the 10-ring limit is a real choice.'),
      h('li', {}, h('b', {}, 'Adventurer rings'), ' marked as worn are pre-selected on the plan screen at the end of the day. The plan screen decides what the adventurer actually takes.')),
    state.rings.length ? null : h('p', { class: 'muted' }, 'No rings yet. Each defeated enemy drops one ring (drop odds below).'),
    today);
}

function kpi(label, value, sub) {
  return h('div', { class: 'mi-kpi' }, h('div', { class: 'mi-kpi-label' }, label), h('div', { class: 'mi-kpi-value' }, value), sub ? h('div', { class: 'mi-kpi-sub' }, sub) : null);
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${s}`;
}

// -------------------------------------------------------------- owner panel ----
function ownerPanel(ctx, owner) {
  const { state, cfg, ui } = ctx;
  const max = cfg.rings.maxWorn;
  const order = typeOrder(cfg);
  const all = ownedBy(state, owner, cfg);
  const worn = all.filter((r) => r.worn);
  const contrib = ringContributions(worn, cfg);
  const totals = ringTotals(worn, cfg);
  const full = worn.length >= max;
  const filter = ui.rings_filter[owner] || 'all';

  const shown = all
    .filter((r) => (filter === 'worn' ? r.worn : filter === 'unworn' ? !r.worn : true))
    .sort((a, b) => order(a.type) - order(b.type) || ringValue(b, cfg) - ringValue(a, cfg) || (b.worn - a.worn) || a.id - b.id);

  const toggle = (r) => ctx.act(() => toggleRing(ctx.state, r.id, ctx.cfg));
  const removeAll = () => ctx.act(() => {
    const st = ctx.state;
    let n = 0;
    for (const r of wornRings(st, owner, ctx.cfg)) if (toggleRing(st, r.id, ctx.cfg).ok) n++;
    return { ok: true, msg: `Removed all ${n} ${owner} ring(s).` };
  });

  const rows = shown.map((r) => {
    const def = ringDef(r.type, cfg);
    const v = ringValue(r, cfg);
    let counts;
    if (r.worn) {
      const c = contrib[r.id];
      counts = h('span', {}, h('b', {}, num(c.effective, 2)), ' ', h('span', { class: 'muted' }, def.stack === false && c.factor === 0 ? `(only your best ${def.name} ring counts)` : `(${fmtPct(c.factor * 100)})`));
    } else {
      const gain = ringTotals([...worn, r], cfg)[r.type] - (totals[r.type] || 0);
      counts = h('span', { class: 'muted', title: 'How much the total for this type would rise if you wore it now' }, `+${num(gain, 2)} if worn`);
    }
    const lock = owner === 'smith' ? smithRingLock(state, cfg) : null;
    const btn = h('button', {
      class: r.worn ? 'small ghost' : 'small',
      disabled: !!lock || (!r.worn && full),
      title: lock || (r.worn ? 'Take this ring off' : full ? `Already wearing ${max} ${owner} rings. Remove one first.` : 'Put this ring on'),
      onclick: () => toggle(r),
    }, r.worn ? 'Remove' : 'Wear');
    return {
      attrs: { class: r.worn ? 'mi-worn' : '', title: r.worn ? 'Worn' : 'Not worn' },
      cells: [
        btn,
        { v: def.name, cls: 'mi-name' },
        { v: gradeSpan(r.grade), cls: 'mi-c' },
        effectText(v, def.desc),
        { v: counts, cls: 'num' },
      ],
    };
  });

  const filterChips = h('div', { class: 'mi-seg' }, FILTERS.map((f) => {
    const n = f.id === 'worn' ? worn.length : f.id === 'unworn' ? all.length - worn.length : all.length;
    return h('button', {
      class: `small ${filter === f.id ? 'sel' : ''}`,
      onclick: () => {
        ui.rings_filter[owner] = f.id;
        ctx.rerender();
      },
    }, `${f.label} (${n})`);
  }));

  const listBody = all.length === 0
    ? h('p', { class: 'muted' }, `No ${owner} rings owned yet.`)
    : rows.length === 0
      ? h('p', { class: 'muted' }, 'No rings match this filter.')
      : tbl(['', 'Ring', { v: 'Grade', cls: 'mi-c' }, 'Value', { v: 'Counts as (weight)', cls: 'num' }], rows, 'mi-rings');

  // Totals per type, with the stacked breakdown "10 + 5 + 2.5".
  const typeKeys = Object.keys(totals).sort((a, b) => order(a) - order(b));
  const totalRows = typeKeys.map((type) => {
    const def = ringDef(type, cfg);
    const parts = worn.filter((r) => r.type === type).map((r) => contrib[r.id]).sort((a, b) => b.effective - a.effective);
    // Foresight counts whole guesses / test fights, and only your best Foresight ring counts
    const rounded = type === 'foresight' ? h('div', { class: 'mi-note ok' }, `only your best Foresight ring counts: +${Math.floor(totals[type] + 1e-9)} in the estimate`) : null;
    return [
      h('span', {}, def.name, h('div', { class: 'mi-note' }, parts.map((p) => num(p.effective, 2)).join(' + '))),
      { v: String(parts.length), cls: 'num' },
      h('div', {}, h('b', {}, effectText(totals[type], def.desc)), rounded),
    ];
  });
  const totalsBody = totalRows.length
    ? tbl(['Type', { v: 'Rings', cls: 'num' }, 'Total effect'], totalRows, 'mi-totals')
    : h('p', { class: 'muted' }, 'Nothing worn.');

  const note = owner === 'smith'
    ? (smithRingLock(state, cfg) ? 'Worn smith rings apply on top of your skills. Locked for today: change them at the start of a day or while planning at night.' : 'Worn smith rings apply on top of your skills. You can change them now (start of day or night planning); they lock once you start working.')
    : state.plan
      ? 'Worn = the default selection for tonight\'s plan (today\'s fight already has its rings).'
      : 'Worn = the default selection for tonight\'s plan.';

  return h('section', { class: 'panel' },
    h('div', { class: 'mi-head' },
      h('h3', {}, OWNER_TITLE[owner], ' ', h('span', { class: full ? 'warn' : 'muted' }, `· ${worn.length} / ${max} worn`)),
      h('div', { class: 'row' },
        filterChips,
        h('button', { class: 'small ghost', disabled: worn.length === 0, onclick: removeAll, title: `Take off all ${owner} rings` }, 'Remove all'))),
    h('p', { class: 'mi-note mi-intro' }, note),
    h('div', { class: 'mi-owner' },
      h('div', { class: 'mi-owner-list' }, h('h4', {}, 'Owned'), listBody),
      h('div', { class: 'mi-owner-totals' }, h('h4', {}, 'Totals while worn'), totalsBody)));
}

// ---------------------------------------------------------------- reference ----
function referencePanel(ctx) {
  const { state, cfg } = ctx;
  const types = Object.entries(cfg.rings.types);
  const owned = (type) => state.rings.filter((r) => r.type === type);

  const typeRows = types.map(([type, d]) => {
    const mine = owned(type);
    const wornN = mine.filter((r) => r.worn).length;
    return [
      h('b', {}, d.name),
      cap(d.owner),
      ...d.values.map((v) => ({ v: num(v, 2), cls: 'num' })),
      d.desc,
      { v: mine.length ? `${mine.length} (${wornN})` : '·', cls: mine.length ? 'num' : 'num muted' },
    ];
  });

  const oddsRows = TIERS.map((tier) => {
    const w = cfg.rings.gradeWeights[tier] || {};
    const total = Object.values(w).reduce((a, b) => a + Math.max(0, b), 0) || 1;
    return [
      h('span', { class: `tier-${tier}` }, cap(tier)),
      ...GRADES.map((g) => (w[g] > 0 ? { v: fmtPct((w[g] / total) * 100), cls: 'num' } : { v: '·', cls: 'num muted' })),
      { v: String(cfg.enemies.tiers[tier].score), cls: 'num' },
    ];
  });

  const nTypes = types.length;
  const weights = stackWeights(cfg, 6).map(fmtPct).join(' · ');
  // fresh header cells per table (a DOM node can only live in one table)
  const gradeHead = () => GRADES.map((g) => ({ v: gradeSpan(g), cls: 'num' }));

  return h('section', { class: 'panel' },
    h('h3', {}, 'Ring reference'),
    h('div', { class: 'mi-ref' },
      h('div', {},
        h('h4', {}, `All ${nTypes} ring types (value by grade)`),
        tbl(['Ring', 'Wearer', ...gradeHead(), 'Effect', { v: 'Owned (worn)', cls: 'num' }], typeRows, 'mi-compact mi-reftypes'),
        h('p', { class: 'mi-note' }, `Same-type stacking weights (best first): ${weights} ...`)),
      h('div', {},
        h('h4', {}, 'Drop odds: ring grade by enemy tier'),
        tbl(['Tier', ...gradeHead(), { v: 'Score', cls: 'num' }], oddsRows, 'mi-compact'),
        h('p', { class: 'mi-note' }, `Every defeated enemy drops one ring. Its type is uniform: each of the ${nTypes} types has a ${fmtPct(100 / nTypes)} chance. The roster shows each enemy's reward ring if your ring scouting reveals it.`))));
}
