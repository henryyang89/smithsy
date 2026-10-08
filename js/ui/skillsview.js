// Skills & Intel tab: skill levels/XP/bonuses (grouped) and intel point spending.
// All game-state changes go through spendIntel() inside ctx.act(). No UI-only state needed.
import { h, num, bar } from './dom.js';
import { BARS, GEMS, GRADES } from '../config.js';
import { skillDefs, xpToNext, skillBonus, itemXp } from '../core/skills.js';
import { spendIntel, intelChance, intelChanceFor, nextIntelGain, gainForPoint } from '../core/intel.js';
import { smithRingTotals } from '../core/rings.js';
import { simCounts } from '../core/sim.js';

const GROUPS = [
  { id: 'activity', title: 'Activity skills' },
  { id: 'ore', title: 'Bar skills (one pair per bar type)' },
  { id: 'gem', title: 'Gem skills (one pair per gem type)' },
];

// ------------------------------------------------------- intel track values ----
// Most intel tracks are chances (%). "Battle simulation" is a COUNT: its value is the number of extra
// guesses and extra test fights per enemy in the win-chance estimate.
const COUNT_TRACKS = new Set(['simDepth']);
export const isCountTrack = (key) => COUNT_TRACKS.has(key);
// "35%" for a chance track, "+10" for a count track.
export const trackValueText = (key, v) => (isCountTrack(key) ? `+${v}` : `${v}%`);

// Spend an intel point; the core message says "now 10%", which is wrong for a count track, so reword it.
export function spendIntelAction(ctx, key) {
  const res = spendIntel(ctx.state, key, ctx.cfg);
  if (res.ok && isCountTrack(key)) {
    const c = simCounts(ctx.state, ctx.cfg);
    res.msg = `${ctx.cfg.intel.tracks[key].name} is now ${trackValueText(key, intelChance(ctx.state, key, ctx.cfg))}: the win-chance estimate uses ${c.samples} guesses x ${c.evalFights} test fights per enemy.`;
  }
  return res;
}

// ------------------------------------------------- skills vs smith rings ----
// The smith ring each skill matches. Skills without a ring: debris clearing, refining / cutting failure,
// and gem grade (it blends the cutting table from novice to master; Gem luck rings upgrade on top).
const SKILL_RING = {
  returnTravel: 'travelTime', searchTime: 'searchTime', searchEff: 'searchEff',
  refineTime: 'processTime', cutTime: 'processTime', oreGrade: 'oreGrade',
};

// Which ring grade a max-level skill equals: { ring, grade, value, top, exact } or null (no ring of that kind).
// key: a skill key ('searchEff', 'oreGrade_iron') or a config key ('oreGrade').
export function skillRingMatch(key, cfg) {
  const base = key.split('_')[0];
  const ring = SKILL_RING[base] && cfg.rings.types[SKILL_RING[base]];
  const def = cfg.skills.activity[base] || cfg.skills.perMaterial[base];
  if (!ring || !def) return null;
  const top = def.perLevel * cfg.skills.maxLevel;
  let gi = -1;
  ring.values.forEach((v, i) => {
    if (v <= top + 1e-9) gi = i;
  });
  return { ring: ring.name, grade: gi >= 0 ? GRADES[gi] : null, value: gi >= 0 ? ring.values[gi] : null, top, exact: gi >= 0 && Math.abs(ring.values[gi] - top) < 1e-9 };
}

// "= C-grade Travel ring", "above a C-grade Travel ring", "below a D-grade Travel ring"
export function skillRingText(m) {
  if (!m) return '';
  if (!m.grade) return `below a ${GRADES[0]}-grade ${m.ring} ring`;
  return m.exact ? `= ${m.grade}-grade ${m.ring} ring` : `above a ${m.grade}-grade ${m.ring} ring`;
}

// The grade every ring-matched skill reaches at max level, when they all agree exactly (else null).
export function commonSkillRingGrade(cfg) {
  const keys = [...Object.keys(cfg.skills.activity), ...Object.keys(cfg.skills.perMaterial)];
  const ms = keys.map((k) => skillRingMatch(k, cfg)).filter(Boolean);
  if (!ms.length || ms.some((m) => !m.exact || m.grade !== ms[0].grade)) return null;
  return ms[0].grade;
}

// One sentence on skills vs rings, all from config: "A level-10 skill equals a C-grade ring of the same kind. ..."
export function skillVsRingText(cfg) {
  const max = cfg.skills.maxLevel;
  const grade = commonSkillRingGrade(cfg);
  const parts = [grade
    ? `A level-${max} skill equals a ${grade}-grade smith ring of the same kind.`
    : `At level ${max}, skills compare with smith rings as shown in the table.`];
  // "debris clearing +100% more debris cleared per search", "gem grade 100% of the way from ...".
  const atMax = (d) => {
    const { unit, text } = splitUnit(d.desc);
    const v = num(d.perLevel * max, 2);
    if (unit === ' pts') return `−${v} points ${text.replace(/^less /, '')}`;
    if (unit === '%' && text.startsWith('more ')) return `+${v}% ${text.slice(5)}`;
    if (unit === '%' && text.startsWith('less ')) return `−${v}% ${text.slice(5)}`;
    if (unit === '%') return `${v}% ${text}`;
    return `${v} ${text}`;
  };
  const noRing = [];
  for (const [k, d] of Object.entries(cfg.skills.activity)) if (!SKILL_RING[k]) noRing.push(`${d.name.toLowerCase()} ${atMax(d)}`);
  const perMat = Object.entries(cfg.skills.perMaterial).filter(([k]) => !SKILL_RING[k]);
  for (const [k, d] of perMat) noRing.push(`${k.startsWith('ore') ? 'bar' : 'gem'} ${d.name} ${atMax(d)}`);
  if (noRing.length) parts.push(`Skills with no ring, at level ${max}: ${noRing.join('; ')}.`);
  return parts.join(' ');
}

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
    const mats = g.id === 'ore' ? BARS : GEMS;
    const xpList = mats.map((m) => `${m} ${num(itemXp(m, cfg))}`).join(', ');
    const pm = cfg.skills.perMaterial;
    const debris = cfg.skills.activity.debris;
    const masterLv = Math.min(max, Math.ceil(100 / Math.max(pm.gemGrade.perLevel, 1e-9) - 1e-9));
    let note;
    if (g.id === 'activity') {
      // activity skills earn XP from minutes spent, except the ones whose XP comes from something else
      const others = Object.values(cfg.skills.activity).filter((d) => !d.xpFrom.startsWith('minutes'));
      const gc = cfg.skills.activity.gearCare;
      note = `XP = minutes spent on the activity${others.length ? `, except ${others.map((d) => `${d.name}: ${d.xpFrom}`).join('; ')}` : ''}. `
        + `${debris ? `${debris.name} adds ${num(debris.perLevel, 2)}% debris cleared per search per level (+${num(debris.perLevel * max, 2)}% at level ${max}); debris is cleared by searching. ` : ''}`
        + `${gc ? `${gc.name} gives ${num(gc.perLevel, 2)}% less durability loss per level (${num(gc.perLevel * max, 2)}% at level ${max}); it earns ${cfg.skills.gearCareXpPerFight} XP for each fight the adventurer survives (win or draw).` : ''}`;
    } else if (g.id === 'ore') {
      note = `XP per bar refined of that type (rarer = more): ${xpList}. Failed attempts count too. "Grade" raises the chance to upgrade the bar one grade (${num(pm.oreGrade.perLevel, 2)}% per level); "refining" moves failure chance into grade D (${num(pm.oreFail.perLevel, 2)} points per level).`;
    } else {
      note = `XP per gem cut of that type (rarer = more): ${xpList}. Failed attempts count too. "Grade" blends that gem's cutting table from the novice table to the master table: ${num(pm.gemGrade.perLevel, 2)}% of the way per level, master at level ${masterLv} (the Workshop shows all three tables). "Cutting" lowers failure by ${num(pm.gemFail.perLevel, 2)} points per level. Gem luck rings add upgrade chances on top.`;
    }
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
      `${cfg.processing.maxTimeReduction}% in total). `, skillVsRingText(cfg)),
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
  const ring = skillRingMatch(d.key, cfg);
  const progress = atMax
    ? h('span', { class: 'ok' }, 'Max level')
    : h('div', { class: 'mi-xp' },
      bar((sk.xp / need) * 100, 'mi-xpbar'),
      h('span', { class: 'mi-xpnum' }, `${num(sk.xp)} / ${need} XP`));
  return {
    attrs: { class: sk.level > 0 ? '' : 'mi-dim' },
    cells: [
      h('div', {}, h('b', {}, d.name), h('div', { class: 'mi-note' }, `${text} · +${num(d.perLevel, 2)}${unit} per level`,
        ring ? ` · level ${max} ${skillRingText(ring)}` : ` · level ${max}: ${num(d.perLevel * max, 2)}${unit} (no ring)`)),
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
    const count = isCountTrack(key);
    const val = (v) => trackValueText(key, v);
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
      title: gain <= 0 ? 'Already at maximum' : pts < 1 ? `No intel points. Next point ${nextText}.` : `Spend 1 point: ${val(cur)} → ${val(cur + gain)}`,
      onclick: () => ctx.act(() => spendIntelAction(ctx, key), { toast: true }),
    }, 'Spend 1 point');
    let extra = null;
    if (key === 'oreSight' && ringReveal > 0) extra = h('div', { class: 'mi-note ok' }, `+ ${num(ringReveal, 2)} from Ore sight rings = ${num(cur + ringReveal, 2)}% per searched cell`);
    if (count) {
      const c = simCounts(state, cfg);
      extra = h('div', { class: 'mi-note ok' }, `${c.samples} guesses x ${c.evalFights} test fights per enemy now (base ${cfg.sim.samples}, +${cur} from intel${c.extra - cur > 0 ? `, +${c.extra - cur} from Foresight rings` : ''})`);
    }
    return [
      h('div', {}, h('b', {}, t.name), h('div', { class: 'mi-note' }, t.desc)),
      { v: count ? `+${t.base}` : `${t.base}%`, cls: 'num' },
      { v: String(spent), cls: 'num' },
      count
        ? h('div', { class: 'mi-chance' }, h('b', { class: 'mi-xpnum' }, val(cur)), extra)
        : h('div', { class: 'mi-chance' }, h('div', { class: 'mi-xp' }, bar(cur, 'mi-xpbar'), h('b', { class: 'mi-xpnum' }, `${cur}%`)), extra),
      gain > 0
        ? h('div', {},
          count ? [h('b', { class: 'ok' }, val(cur + gain)), cur > 0 ? h('span', { class: 'muted' }, ` (+${gain} more)`) : null] : [h('b', { class: 'ok' }, `+${gain}`), ` → ${val(cur + gain)}`],
          h('div', { class: 'mi-note' }, `then ${preview.slice(1).map((c) => val(c)).join(', ') || 'max'}`))
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
      `You earn 1 intel point every ${dpp} days. Spend it on one track. Each track counts its own points with diminishing returns (table below), up to ${ic.maxChance}% (or +${ic.maxChance} for Battle simulation). `,
      'Scouting is applied at once, including to the roster you can already see: each enemy\'s hidden rolls are fixed, so a higher chance reveals more of the same roster.'),
    tbl(['Track', { v: 'Base', cls: 'num' }, { v: 'Points spent', cls: 'num' }, 'Now', 'Next point', 'Spend'], rows, 'mi-intel'),
    h('p', { class: 'mi-note' }, `Battle simulation is not a chance: its value is the number of extra guesses and extra test fights per enemy in the plan screen's win-chance estimate (on top of the base ${cfg.sim.samples} x ${cfg.sim.evalFights}). Foresight smith rings add to it too.`),
    h('h4', {}, 'Gain per point spent on a track'),
    tbl(schedHead, [schedRow], 'mi-compact mi-sched'));
}

function ordinal(n) {
  const s = n % 100 >= 11 && n % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[n % 10] || 'th');
  return `${n}${s}`;
}
