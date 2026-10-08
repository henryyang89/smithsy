// Skills & Intel tab: skill levels/XP (grouped) and intel point spending.
// All game-state changes go through spendIntel() inside ctx.act(). No UI-only state needed.
import { h, num, bar, tip } from './dom.js';
import { BARS, GEMS } from '../config.js';
import { skillDefs, xpToNext, skillHoverText, skillNowText } from '../core/skills.js';
import { spendIntel, intelValue, nextIntelGain, trackValueText } from '../core/intel.js';
import { smithRingTotals } from '../core/rings.js';
import { simCounts } from '../core/sim.js';
import { cap } from '../core/util.js';

// ------------------------------------------------------- intel track values ----
// Each track has a unit (config intel.tracks[..].unit): '%' (a chance), 'sight' (sight points) or 'count'
// ("Battle simulation": the number of extra guesses and test fights per enemy in the win-chance estimate).
// trackValueText (core/intel.js) writes a value in its unit: "25%", "20 sight", "+3".

// The hover on an intel track: what it does, and what the multipliers do ("Elites 90%, champions 80% of this.").
export function intelTip(key, cfg) {
  const t = cfg.intel.tracks[key];
  const bits = [`${cap(t.desc)}.`];
  const mult = (m) => Object.entries(m).filter(([, v]) => v !== 100);
  if (t.tierMult && mult(t.tierMult).length) bits.push(`${cap(mult(t.tierMult).map(([tier, v]) => `${tier}s ${v}%`).join(', '))} of this.`);
  if (t.gradeMult && mult(t.gradeMult).length) bits.push(`Better ring grades are harder to see: ${mult(t.gradeMult).map(([g, v]) => `${g} ${v}%`).join(', ')} of this.`);
  return bits.join(' ');
}

// Spend an intel point. The core message says "Battle simulation is now +2."; for the count track it also says
// what that means for the win-chance estimate.
export function spendIntelAction(ctx, key) {
  const res = spendIntel(ctx.state, key, ctx.cfg);
  if (res.ok && ctx.cfg.intel.tracks[key].unit === 'count') {
    const c = simCounts(ctx.state, ctx.cfg);
    res.msg = `${res.msg} The win-chance estimate uses ${c.samples} guesses x ${c.evalFights} test fights per enemy.`;
  }
  return res;
}

// ------------------------------------------------------------------ helpers ----
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

// --------------------------------------------------------------------- main ----
export function renderSkills(root, ctx) {
  root.append(h('div', { class: 'mi-root' }, skillsPanel(ctx), intelPanel(ctx)));
}

// ------------------------------------------------------------------- skills ----
const GROUPS = [
  { id: 'field', title: 'Travel and fields' },
  { id: 'workshop', title: 'Workshop' },
];

function skillsPanel(ctx) {
  const { state, cfg } = ctx;
  const defs = skillDefs(cfg);
  const levels = defs.reduce((a, d) => a + ((state.skills[d.key] && state.skills[d.key].level) || 0), 0);

  const groups = GROUPS.map((g) => h('div', { class: 'mi-group' },
    h('h4', {}, g.title),
    tbl(['Skill', { v: 'Level', cls: 'num' }, 'Progress', 'Now'],
      defs.filter((d) => d.group === g.id).map((d) => skillRow(state, cfg, d)), 'mi-skills')));
  groups.push(matrix(state, cfg, 'Bar types', 'Bar type', BARS, 'bars'));
  groups.push(matrix(state, cfg, 'Gem types', 'Gem type', GEMS, 'gems'));

  return h('section', { class: 'panel' },
    h('h3', {}, 'Skills'),
    h('div', { class: 'mi-kpis' }, kpi('Skill levels', String(levels), `${defs.length} skills`)),
    h('p', { class: 'mi-note' }, 'Skills level up by themselves as you work. Hover or tap a skill for what it does and how to earn XP. ',
      `Skills add to the matching smith rings (time reductions are capped at ${cfg.processing.maxTimeReduction}% in total).`),
    groups);
}

// "Lv 3" and a thin progress bar for the next level (or the highest level).
function xpPct(state, cfg, d) {
  const sk = state.skills[d.key] || { xp: 0, level: 0 };
  return sk.level >= cfg.skills.maxLevel ? 100 : (sk.xp / xpToNext(sk.level, cfg)) * 100;
}

function skillRow(state, cfg, d) {
  const sk = state.skills[d.key] || { xp: 0, level: 0 };
  const atMax = sk.level >= cfg.skills.maxLevel;
  const progress = atMax
    ? h('span', { class: 'ok' }, 'Highest level')
    : h('div', { class: 'mi-xp' }, bar(xpPct(state, cfg, d), 'mi-xpbar'), h('span', { class: 'mi-xpnum' }, `${num(sk.xp)}/${xpToNext(sk.level, cfg)}`));
  const now = skillNowText(state, d.key, cfg);
  return {
    attrs: { class: sk.level > 0 ? '' : 'mi-dim', ...tip(skillHoverText(state, d.key, cfg)) },
    cells: [h('b', {}, d.name), { v: String(sk.level), cls: 'num' }, progress, now ? h('span', {}, now) : h('span', { class: 'muted' }, 'no effect yet')],
  };
}

// Bar types / gem types: one row per material, one column per skill kind. Each cell is "Lv 3" + a thin XP bar.
function matrix(state, cfg, title, firstHead, materials, kind) {
  const prefixes = Object.entries(cfg.skills.perMaterial).filter(([, d]) => d.materials === kind);
  const defs = skillDefs(cfg);
  const head = [firstHead, ...prefixes.map(([, d]) => ({ v: cap(d.label.replace(/^bar /, '')), cls: 'mi-c' }))];
  const rows = materials.map((m) => [
    h('b', {}, cap(m)),
    ...prefixes.map(([prefix]) => {
      const d = defs.find((x) => x.key === `${prefix}_${m}`);
      const sk = state.skills[d.key] || { xp: 0, level: 0 };
      return {
        v: h('div', { class: `mi-lv${sk.level > 0 ? '' : ' mi-dim'}`, ...tip(skillHoverText(state, d.key, cfg)) }, `Lv ${sk.level}`, bar(xpPct(state, cfg, d), 'mi-thin')),
        cls: 'mi-c',
      };
    }),
  ]);
  return h('div', { class: 'mi-group' }, h('h4', {}, title), tbl(head, rows, 'mi-matrix'));
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
    const val = (v) => trackValueText(key, v, cfg);
    const spent = state.intel.spent[key] || 0;
    const cur = intelValue(state, key, cfg);
    const gain = nextIntelGain(state, key, cfg);
    const canSpend = pts >= 1 && gain > 0;
    const btn = h('button', {
      class: canSpend ? 'small primary' : 'small',
      disabled: !canSpend,
      title: gain <= 0 ? 'Already at maximum' : pts < 1 ? `No intel points. Next point ${nextText}.` : `Spend 1 point: ${val(cur)} → ${val(cur + gain)}`,
      onclick: () => ctx.act(() => spendIntelAction(ctx, key), { toast: true }),
    }, 'Spend 1 point');
    let extra = null;
    if (key === 'oreSight' && ringReveal > 0) extra = h('div', { class: 'mi-note ok' }, `+ ${num(ringReveal, 2)} from Ore sight rings = ${num(cur + ringReveal, 2)} sight`);
    if (t.unit === 'count') {
      const c = simCounts(state, cfg);
      extra = h('div', { class: 'mi-note ok' }, `${c.samples} guesses x ${c.evalFights} test fights per enemy now (base ${cfg.sim.samples}, +${cur} from intel${c.extra - cur > 0 ? `, +${c.extra - cur} from your best Foresight ring` : ''})`);
    }
    return [
      h('div', tip(intelTip(key, cfg)), h('b', {}, t.name), h('div', { class: 'mi-note' }, t.desc)),
      { v: String(spent), cls: 'num' },
      t.unit === '%'
        ? h('div', { class: 'mi-chance' }, h('div', { class: 'mi-xp' }, bar(cur, 'mi-xpbar'), h('b', { class: 'mi-xpnum' }, val(cur))), extra)
        : h('div', { class: 'mi-chance' }, h('b', { class: 'mi-xpnum' }, val(cur)), extra),
      gain > 0
        ? h('div', {}, h('b', { class: 'ok' }, `+${gain}`), ` → ${val(cur + gain)}`)
        : h('span', { class: 'muted' }, 'max'),
      btn,
    ];
  });

  return h('section', { class: 'panel' },
    h('h3', {}, 'Intel'),
    h('div', { class: 'mi-kpis' },
      kpi('Intel points', String(pts), pts ? 'ready to spend' : 'none to spend'),
      kpi('Next point', `Day ${nextDay}`, inDays === 0 ? 'at the end of today' : `in ${inDays} day${inDays === 1 ? '' : 's'}`),
      kpi('Rate', `1 per ${dpp} days`, `end of day ${dpp}, ${dpp * 2}, ${dpp * 3}, ...`)),
    h('p', { class: 'mi-note' },
      `You earn 1 intel point every ${dpp} days. Spend it on one track; each track has its own steps. Spend points before you start the next day: the plan screen will not start it while a point can still be spent. `,
      'Scouting is applied at once, including to the roster you can already see: each enemy\'s hidden rolls are fixed, so a higher chance reveals more of the same roster.'),
    tbl(['Track', { v: 'Points spent', cls: 'num' }, 'Now', 'Next point', 'Spend'], rows, 'mi-intel'),
    h('p', { class: 'mi-note' }, `Ore sight is your sight: the higher it is, the more of the items still in the ground you see in a field (Map tab). Battle simulation is not a chance: its value is the number of extra guesses and extra test fights per enemy in the plan screen's win-chance estimate (on top of the base ${cfg.sim.samples} x ${cfg.sim.evalFights}). Your best Foresight smith ring adds to it too (only one counts).`));
}

