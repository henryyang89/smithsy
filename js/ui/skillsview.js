// Skills & Intel tab: skill levels/XP/bonuses (grouped) and intel point spending.
// All game-state changes go through spendIntel() inside ctx.act(). No UI-only state needed.
import { h, num, bar } from './dom.js';
import { BARS, GEMS } from '../config.js';
import { skillDefs, xpToNext, skillBonus } from '../core/skills.js';
import { spendIntel, intelChance, intelChanceFor, nextIntelGain, gainForPoint } from '../core/intel.js';
import { smithRingTotals } from '../core/rings.js';

const GROUPS = [
  { id: 'activity', title: 'Activity skills' },
  { id: 'ore', title: 'Bar skills (one pair per bar type)' },
  { id: 'gem', title: 'Gem skills (one pair per gem type)' },
];

// ------------------------------------------------------------------ helpers ----
// Split a config description into a unit and the rest: '% less search time' -> { unit: '%', text: 'less search time' }
function splitUnit(desc) {
  if (desc.startsWith('%')) return { unit: '%', text: desc.slice(1).trim() };
  if (desc.startsWith('points ')) return { unit: ' pts', text: desc.slice(7) };
  return { unit: '', text: desc };
}

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

function kpi(label, value, sub) {
  return h('div', { class: 'mi-kpi' }, h('div', { class: 'mi-kpi-label' }, label), h('div', { class: 'mi-kpi-value' }, value), sub ? h('div', { class: 'mi-kpi-sub' }, sub) : null);
}

// Material order inside the per-material groups: copper grade, copper refining, iron grade, ...
function materialSortKey(def) {
  const [kind, mat] = def.key.split('_');
  const list = def.group === 'ore' ? BARS : GEMS;
  const second = kind.endsWith('Fail') ? 1 : 0;
  return list.indexOf(mat) * 2 + second;
}

// --------------------------------------------------------------------- main ----
export function renderSkills(root, ctx) {
  root.append(h('div', { class: 'mi-root' }, skillsPanel(ctx), intelPanel(ctx)));
}

// ------------------------------------------------------------------- skills ----
function skillsPanel(ctx) {
  const { state, cfg } = ctx;
  const defs = skillDefs(cfg);
  const max = cfg.skills.maxLevel;
  let totalXp = 0;
  for (let l = 0; l < max; l++) totalXp += xpToNext(l, cfg);
  const levels = defs.reduce((a, d) => a + ((state.skills[d.key] && state.skills[d.key].level) || 0), 0);
  const maxed = defs.filter((d) => state.skills[d.key] && state.skills[d.key].level >= max).length;

  const groups = GROUPS.map((g) => {
    let list = defs.filter((d) => d.group === g.id);
    if (g.id !== 'activity') list = list.slice().sort((a, b) => materialSortKey(a) - materialSortKey(b));
    const note = g.id === 'activity'
      ? 'XP = minutes spent on the activity.'
      : `${cfg.skills.xpPerItem} XP per ${g.id === 'ore' ? 'bar refined' : 'gem cut'} of that type, failed attempts included. "Grade" raises the chance to upgrade the result one grade; "${g.id === 'ore' ? 'refining' : 'cutting'}" moves failure chance into grade D.`;
    return h('div', { class: 'mi-group' },
      h('h4', {}, g.title),
      h('p', { class: 'mi-note mi-intro' }, note),
      tbl(['Skill', { v: 'Level', cls: 'num' }, 'Progress to next level', { v: 'Bonus now', cls: 'num' }, { v: 'Next level', cls: 'num' }, 'How to earn XP'],
        list.map((d) => skillRow(state, cfg, d)), 'mi-skills'));
  });

  return h('section', { class: 'panel' },
    h('h3', {}, 'Skills'),
    h('div', { class: 'mi-kpis' },
      kpi('Skill levels', `${levels} / ${defs.length * max}`, `${defs.length} skills, max level ${max}`),
      kpi('Maxed', String(maxed), `of ${defs.length}`)),
    h('p', { class: 'mi-note' },
      `Skills level up automatically while you work. Level L to L+1 needs ${cfg.skills.xpBase} x (L+1) XP, so level ${max} takes ${totalXp.toLocaleString('en-US')} XP in total. `,
      'Skill bonuses add to the matching smith ring bonuses (time reductions are capped at ',
      `${cfg.processing.maxTimeReduction}% in total).`),
    groups);
}

function skillRow(state, cfg, d) {
  const sk = state.skills[d.key] || { xp: 0, level: 0 };
  const max = cfg.skills.maxLevel;
  const atMax = sk.level >= max;
  const need = xpToNext(sk.level, cfg);
  const now = skillBonus(state, d.key, cfg);
  const { unit, text } = splitUnit(d.desc);
  const next = atMax ? null : d.perLevel * (sk.level + 1);
  const progress = atMax
    ? h('span', { class: 'ok' }, 'Max level')
    : h('div', { class: 'mi-xp' },
      bar((sk.xp / need) * 100, 'mi-xpbar'),
      h('span', { class: 'mi-xpnum' }, `${num(sk.xp)} / ${need} XP`));
  return {
    attrs: { class: sk.level > 0 ? '' : 'mi-dim' },
    cells: [
      h('div', {}, h('b', {}, d.name), h('div', { class: 'mi-note' }, `${text} · +${num(d.perLevel, 2)}${unit} per level`)),
      { v: `${sk.level} / ${max}`, cls: 'num' },
      progress,
      { v: h('b', {}, `${num(now, 2)}${unit}`), cls: 'num' },
      { v: next === null ? '·' : `${num(next, 2)}${unit}`, cls: next === null ? 'num muted' : 'num' },
      h('span', { class: 'muted' }, d.xpFrom),
    ],
  };
}

// -------------------------------------------------------------------- intel ----
function intelPanel(ctx) {
  const { state, cfg } = ctx;
  const ic = cfg.intel;
  const pts = state.intel.points;
  const dpp = ic.daysPerPoint;
  const nextDay = Math.ceil(state.day / dpp) * dpp;
  const inDays = nextDay - state.day;
  const nextText = inDays === 0 ? `at the end of today (day ${nextDay})` : `at the end of day ${nextDay} (in ${inDays} day${inDays === 1 ? '' : 's'})`;
  const ringReveal = smithRingTotals(state, cfg).reveal || 0;

  const rows = Object.entries(ic.tracks).map(([key, t]) => {
    const spent = state.intel.spent[key] || 0;
    const cur = intelChance(state, key, cfg);
    const gain = nextIntelGain(state, key, cfg);
    const preview = [];
    for (let i = 1; i <= 5; i++) {
      const c = intelChanceFor(key, spent + i, cfg);
      if (preview.length && c === preview[preview.length - 1]) break;
      preview.push(c);
      if (c >= ic.maxChance) break;
    }
    const canSpend = pts >= 1 && gain > 0;
    const btn = h('button', {
      class: canSpend ? 'small primary' : 'small',
      disabled: !canSpend,
      title: gain <= 0 ? 'Already at maximum' : pts < 1 ? `No intel points. Next point ${nextText}.` : `Spend 1 point: ${cur}% → ${cur + gain}%`,
      onclick: () => ctx.act(() => spendIntel(ctx.state, key, ctx.cfg), { toast: true }),
    }, 'Spend 1 point');
    const extra = key === 'oreSight' && ringReveal > 0
      ? h('div', { class: 'mi-note ok' }, `+ ${num(ringReveal, 2)} from Ore sight rings = ${num(cur + ringReveal, 2)}% per searched cell`)
      : null;
    return [
      h('div', {}, h('b', {}, t.name), h('div', { class: 'mi-note' }, t.desc)),
      { v: `${t.base}%`, cls: 'num' },
      { v: String(spent), cls: 'num' },
      h('div', { class: 'mi-chance' }, h('div', { class: 'mi-xp' }, bar(cur, 'mi-xpbar'), h('b', { class: 'mi-xpnum' }, `${cur}%`)), extra),
      gain > 0
        ? h('div', {}, h('b', { class: 'ok' }, `+${gain}`), ` → ${cur + gain}%`, h('div', { class: 'mi-note' }, `then ${preview.slice(1).map((c) => `${c}%`).join(', ') || 'max'}`))
        : h('span', { class: 'muted' }, 'max'),
      btn,
    ];
  });

  // Gains schedule: 1st point +10, 2nd +9, ... then minGain.
  const n = ic.gainsPerPoint.length;
  const schedHead = ['Point', ...ic.gainsPerPoint.map((_, i) => ({ v: ordinal(i + 1), cls: 'num' })), { v: `${ordinal(n + 1)}+`, cls: 'num' }];
  const schedRow = ['Gain', ...ic.gainsPerPoint.map((_, i) => ({ v: `+${gainForPoint(i + 1, cfg)}`, cls: 'num' })), { v: `+${gainForPoint(n + 1, cfg)}`, cls: 'num' }];

  return h('section', { class: 'panel' },
    h('h3', {}, 'Intel'),
    h('div', { class: 'mi-kpis' },
      kpi('Intel points', String(pts), pts ? 'ready to spend' : 'none to spend'),
      kpi('Next point', `Day ${nextDay}`, inDays === 0 ? 'at the end of today' : `in ${inDays} day${inDays === 1 ? '' : 's'}`),
      kpi('Rate', `1 per ${dpp} days`, `end of day ${dpp}, ${dpp * 2}, ${dpp * 3}, ...`)),
    h('p', { class: 'mi-note' },
      `You earn 1 intel point every ${dpp} days. Spend it on one track. Each track counts its own points with diminishing returns (table below), up to ${ic.maxChance}%. `,
      'Scouting is applied at once, including to the roster you can already see: each enemy\'s hidden rolls are fixed, so a higher chance reveals more of the same roster.'),
    tbl(['Track', { v: 'Base', cls: 'num' }, { v: 'Points spent', cls: 'num' }, 'Chance now', 'Next point', 'Spend'], rows, 'mi-intel'),
    h('h4', {}, 'Gain per point spent on a track'),
    tbl(schedHead, [schedRow], 'mi-compact mi-sched'));
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${s}`;
}
