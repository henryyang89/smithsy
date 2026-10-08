// Help tab: short how-to-play, then a live NUMBERS reference built from CONFIG (ctx.cfg).
// Nothing here is hardcoded: every number is read from config or computed with the core formulas,
// so the page stays correct when js/config.js is rebalanced.
// UI-only state: ctx.ui.help_open = { sectionId: true } (which reference sections are expanded).
import { h, num } from './dom.js';
import { GRADES, BARS, GEMS, SLOTS, ARMOR_SLOTS, TIERS, LEVELS } from '../config.js';
import { hitChance, hitDamage, adventurerCombatant, attackInterval } from '../core/combat.js';
import { STAT_LABELS, fmtStat, craftMinutes, repairInfo, wearLoss } from '../core/gear.js';
import { enemyCombatant, growth } from '../core/enemies.js';
import { skillDefs, xpToNext, itemXp } from '../core/skills.js';
import { gainForPoint } from '../core/intel.js';
import { simCounts } from '../core/sim.js';
import { skillRingMatch, skillRingText, skillVsRingText, commonSkillRingGrade, isCountTrack } from './skillsview.js';
import { GRADE_ORDER, blendCutTable } from '../core/processing.js';
import { formatClock, formatDuration, cap } from '../core/util.js';
import { VERSION } from '../version.js';

// ------------------------------------------------------------------ helpers ----
// "10 guesses x 10 test fights per enemy" for this game (base + Battle simulation intel + Foresight rings).
const simSummary = (state, cfg) => {
  const c = simCounts(state, cfg);
  return `${c.samples} guesses x ${c.evalFights} test fights per enemy`;
};
const p = (v, d = 1) => `${num(v, d)}%`;
const mins = (m) => formatDuration(m);
const x = (v) => `×${num(v, 2)}`;
// pierce resistance is a % of the attacker's piercing ignored
const statLabel = (k) => (k === 'pierceRes' ? 'Pierce resistance %' : STAT_LABELS[k] || k);
const gradeSpan = (g) => h('span', { class: `grade-${g}` }, g === 'F' ? 'Fail' : g);
const gradeHead = () => GRADES.map((g) => ({ v: gradeSpan(g), cls: 'num' }));
const OUTCOMES = GRADE_ORDER; // F D C B A S: lowest on the left, highest on the right

function tbl(head, rows, cls = '') {
  const cell = (tag, c) => {
    if (c && typeof c === 'object' && !(c instanceof Node) && !Array.isArray(c) && 'v' in c) {
      return h(tag, { class: c.cls, title: c.title, colspan: c.span }, c.v);
    }
    return h(tag, {}, c);
  };
  return h('div', { class: 'mi-scroll' },
    h('table', { class: `mi-table mi-compact ${cls}` },
      head ? h('thead', {}, h('tr', {}, head.map((c) => cell('th', c)))) : null,
      h('tbody', {}, rows.map((r) => (Array.isArray(r)
        ? h('tr', {}, r.map((c) => cell('td', c)))
        : h('tr', r.attrs || {}, r.cells.map((c) => cell('td', c))))))));
}

const n = (v, d = 1) => ({ v: num(v, d), cls: 'num' });
const np = (v, d = 1) => ({ v: p(v, d), cls: 'num' });

// Label / value grid.
function kv(pairs) {
  return h('dl', { class: 'mi-kv' }, pairs.filter(Boolean).flatMap(([k, v]) => [h('dt', {}, k), h('dd', {}, v)]));
}

function formula(text, note) {
  return h('div', { class: 'mi-formula' }, h('code', {}, text.replace(/ x /g, ' × ')), note ? h('div', { class: 'mi-note' }, note) : null);
}

function sub(title) {
  return h('h4', {}, title);
}

// Weights -> percentages (same keys).
function toPct(weights) {
  const total = Object.values(weights).reduce((a, b) => a + Math.max(0, b), 0) || 1;
  return Object.fromEntries(Object.entries(weights).map(([k, w]) => [k, (Math.max(0, w) / total) * 100]));
}

function avgCount(weights) {
  const pc = toPct(weights);
  return Object.entries(pc).reduce((a, [k, v]) => a + Number(k) * (v / 100), 0);
}

function ordinal(i) {
  const s = i % 100 >= 11 && i % 100 <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[i % 10] || 'th');
  return `${i}${s}`;
}

// Map distances worth listing: enough rows to show the weight tables and the usual 5x5 detours.
function maxDistance(cfg) {
  return Math.max(cfg.field.oreWeights.length, cfg.field.gemWeights.length, 2 * Math.floor(cfg.map.size / 2) + 2);
}

function lootChance(cfg, d) {
  const l = cfg.field.lootChance;
  return Math.min(l.max, l.base + l.perDistance * (d - 1));
}

// A collapsible reference section. Open state survives re-renders via ctx.ui.help_open.
function det(ctx, id, title, ...body) {
  const open = !!(ctx.ui.help_open && ctx.ui.help_open[id]);
  const remember = (v) => {
    if (!ctx.ui.help_open) ctx.ui.help_open = {};
    ctx.ui.help_open[id] = v;
  };
  // click fires before the browser toggles (so the state is saved even if a re-render follows at once);
  // toggle also covers find-in-page auto-expanding.
  const d = h('details', { class: 'panel mi-det', open, id: `help-${id}` },
    h('summary', { onclick: () => remember(!d.open) }, title),
    h('div', { class: 'mi-det-body' }, ...body));
  d.addEventListener('toggle', () => remember(d.open));
  return d;
}

// --------------------------------------------------------------------- main ----
const SECTIONS = [
  ['time', 'Time', timeSection],
  ['map', 'World map & travel', mapSection],
  ['field', 'Fields & searching', fieldSection],
  ['process', 'Refining & cutting', processSection],
  ['gear', 'Gear', gearSection],
  ['gems', 'Gem infusions', gemSection],
  ['adventurer', 'Adventurer', adventurerSection],
  ['combat', 'Combat formulas', combatSection],
  ['enemies', 'Enemies', enemySection],
  ['rings', 'Rings', ringSection],
  ['skills', 'Skills', skillSection],
  ['intel', 'Intel', intelSection],
  ['repair', 'Durability & repair', repairSection],
];

export function renderHelp(root, ctx) {
  const setAll = (open) => {
    ctx.ui.help_open = Object.fromEntries(SECTIONS.map(([id]) => [id, open]));
    ctx.rerender();
  };
  root.append(h('div', { class: 'mi-root mi-help' },
    howToPlay(ctx),
    h('section', { class: 'panel mi-numbers-head' },
      h('div', { class: 'mi-head' },
        h('h3', {}, 'Numbers reference'),
        h('div', { class: 'row' },
          h('button', { class: 'small', onclick: () => setAll(true) }, 'Expand all'),
          h('button', { class: 'small', onclick: () => setAll(false) }, 'Collapse all'))),
      h('p', { class: 'mi-note' }, 'Every number below is read live from ', h('code', {}, 'js/config.js'),
        ' (or computed with the game\'s own formulas). To rebalance, edit that file; ', h('code', {}, 'docs/BALANCE.md'), ' explains each number.'),
      h('div', { class: 'chips' }, SECTIONS.map(([id, title]) => h('button', {
        class: 'small ghost',
        onclick: () => {
          if (!ctx.ui.help_open) ctx.ui.help_open = {};
          ctx.ui.help_open[id] = true;
          ctx.rerender();
          const el = document.getElementById(`help-${id}`);
          if (el) el.scrollIntoView({ block: 'start' });
        },
      }, title)))),
    SECTIONS.map(([id, title, fn]) => det(ctx, id, title, ...[].concat(fn(ctx.cfg, ctx)))),
    h('p', { class: 'mi-note mi-foot' }, 'Tuning: change numbers in js/config.js; see docs/BALANCE.md for what each one does and quick balance levers.')));
}

// -------------------------------------------------------------- how to play ----
function howToPlay(ctx) {
  const cfg = ctx.cfg;
  const t = cfg.time;
  const dayLen = t.dayEndMin - t.dayStartMin;
  const tiers = cfg.enemies.tiers;
  const rosterN = TIERS.reduce((a, k) => a + tiers[k].count, 0);
  const rosterMix = TIERS.map((k) => `${tiers[k].count} ${k}`).join(', ');
  const scores = TIERS.map((k) => `${k} ${tiers[k].score}`).join(', ');
  const wear = cfg.gear.durabilityLoss;
  const tab = (id, label) => h('a', { href: '#', class: 'mi-link', onclick: (e) => { e.preventDefault(); ctx.setTab(id); } }, label);

  return h('section', { class: 'panel' },
    h('h3', {}, 'How to play'),
    h('p', {}, 'You are a miner and blacksmith. Your adventurer fights one enemy a day with the gear you make. ',
      h('b', {}, 'If the adventurer loses a fight, the run is over.'), ` Each win scores points (${scores}) and drops a ring.`),
    h('ol', { class: 'mi-steps' },
      h('li', {}, h('b', {}, `Work from ${formatClock(t.dayStartMin)} to ${formatClock(t.dayEndMin)} (${dayLen} minutes). `),
        'Only actions cost time. On the ', tab('map', 'Map'), ', travel to a field and search 3x3 areas for ore and gems. ',
        'Everything you find goes to that field\'s pile; when you leave you choose what to carry in your bag ',
        `(up to ${cfg.bag.slots} items, rarest first by default) and the rest stays in the pile for a later trip. `,
        `Debris (the number on a brown cell) is cleared by searching; boulders can never be searched. Field actions are only allowed while you can still walk back to camp by ${formatClock(t.dayEndMin)}. Arriving at camp unloads the bag into storage.`),
      h('li', {}, h('b', {}, 'At camp, use the '), tab('workshop', 'Workshop'), ': refine ore into bars, cut gems, smith gear from bars of one material and grade (optionally infusing a cut gem), and repair worn gear.'),
      h('li', {}, h('b', {}, 'End the day at camp. '), 'If the adventurer fought today you first see the battle report. Then plan tomorrow: pick 1 of ',
        `${rosterN} enemies (${rosterMix}; a new roster every day), pack up to 2 items per gear slot, and choose up to ${cfg.rings.maxWorn} adventurer rings. `,
        h('b', {}, 'Repair gear at night'), ' (battle report or plan screen): it costs materials but no time.'),
      h('li', {}, h('b', {}, 'The next day the adventurer is away fighting. '),
        'When the fight starts it sees the enemy\'s real attributes and uses the best packed item for each slot. Packed gear cannot be repaired that day. ',
        `It comes back at the end of the day; every item that was used loses about ${p((wear.min + wear.max) / 2, 0)} durability (${wear.min}-${wear.max}% before the modifiers below), a little more against tougher enemies (${TIERS.map((t) => `${t} x${(wear.tierMult && wear.tierMult[t]) || 1}`).join(', ')}) and a little less with the ${cfg.skills.activity.gearCare ? cfg.skills.activity.gearCare.name : 'Gear care'} skill. At 0% it is destroyed.`),
      h('li', {}, h('b', {}, 'Day 1 is a rest day. '), 'From day 2 on there is a fight every day; it cannot be skipped.')),
    h('ul', { class: 'mi-list' },
      h('li', {}, 'Enemy attributes and reward rings are partly hidden. Intel (1 point every ', String(cfg.intel.daysPerPoint), ' days, ', tab('skills', 'Skills & Intel'), ') raises the chance to see them.'),
      h('li', {}, 'Fights are automatic. Each side has an attack bar that fills (faster with more speed) and attacks when full; slows make the bar fill slower for a while, stuns stop it for a moment.'),
      h('li', {}, `The plan screen can simulate the fight to estimate your win chance before you confirm: one button, Estimate all, runs ${simSummary(ctx.state, cfg)} for every enemy of the roster and fills the win-estimate row of the comparison table. It is a small simulation, so it is a rough guide with some risk; Battle simulation intel and Foresight rings make it bigger.`),
      h('li', {}, 'Wear rings on the ', tab('rings', 'Rings'), ' tab. Smith rings help you right away; adventurer rings are chosen for each fight.'),
      h('li', {}, `Skills level up on their own as you work${commonSkillRingGrade(cfg) ? ` (a level-${cfg.skills.maxLevel} skill is as strong as a ${commonSkillRingGrade(cfg)}-grade ring of the same kind)` : ''}. Farther fields are richer but cost more travel time.`),
      h('li', {}, 'Every gem type is equally likely to be found. Cutting gets better with practice: each gem\'s grade skill moves its cutting table from the novice table toward the master table (Workshop and Refining & cutting below).'),
      h('li', {}, 'Grades are always listed from lowest to highest, left to right: ', OUTCOMES.map((g, i) => [i ? ' < ' : '', gradeSpan(g)]), ' (Fail is the lowest outcome).'),
      (cfg.field.regrowPctPerDay || 0) > 0
        ? h('li', {}, `Searched cells slowly regrow: each night every searched cell has a ${p(cfg.field.regrowPctPerDay)} chance to become fresh and unsearched again.`)
        : h('li', {}, 'Fields do not regrow: a searched cell stays searched for the rest of the run.')),
    h('p', { class: 'mi-note mi-version' }, `Smithsy v${VERSION}. What changed in each version (and how to go back to an older one): `,
      h('a', { href: 'CHANGELOG.md', target: '_blank', rel: 'noopener', class: 'mi-link' }, 'CHANGELOG.md'), '.'));
}

// -------------------------------------------------------------------- time ----
function timeSection(cfg) {
  const t = cfg.time;
  const g = cfg.gear;
  const byMinutes = (table) => {
    const groups = {};
    for (const [k, v] of Object.entries(table)) (groups[v.minutes] = groups[v.minutes] || []).push(k);
    const entries = Object.entries(groups);
    if (entries.length === 1) return `${mins(Number(entries[0][0]))} each`;
    return entries.map(([m, ks]) => `${ks.join(', ')} ${mins(Number(m))}`).join(' · ');
  };
  return [
    kv([
      ['Work day', `${formatClock(t.dayStartMin)} - ${formatClock(t.dayEndMin)} (${t.dayEndMin - t.dayStartMin} minutes)`],
      ['Time limit rule', `Field actions (travel out, search) need enough time left to walk back to camp by ${formatClock(t.dayEndMin)} with a full load: your bag plus the field's pile, up to ${cfg.bag.slots} items (leaving items behind does not buy extra time). The trip back is always allowed, even if it ends late. The day can only be ended at camp.`],
      ['Time bonuses', `Rings and skills reduce times; the total reduction is capped at ${p(cfg.processing.maxTimeReduction)}.`],
    ]),
    sub('What costs time (base, before bonuses)'),
    tbl(['Activity', 'Base time'], [
      ['Travel', `${mins(cfg.map.travelMinPerStep)} per map step, +${p(cfg.map.loadPenaltyPerItem)} per item in the bag`],
      ['Search a 3x3 area', `${mins(cfg.field.searchMin)}${cfg.field.freshCellMin > 0 ? ` + ${mins(cfg.field.freshCellMin)} for each fresh (never-searched) cell in the area` : ''} (also clears debris: no separate action)`],
      ['Refine a bar', byMinutes(cfg.refine)],
      ['Cut a gem', byMinutes(cfg.cut)],
      ['Smith gear', `${mins(g.smithMinPerBar)} per bar (${SLOTS.map((s) => `${s} ${mins(craftMinutes(s, false, cfg))}`).join(', ')}), +${mins(g.infuseMin)} to infuse a gem`],
      ['Repair gear', `by day: ${p(g.repair.timeFraction)} of the smithing time x fraction repaired; at night (battle report / plan): no time`],
      ['Choose what to carry, move items between bag and field pile, unload at camp', 'free'],
    ]),
  ];
}

// --------------------------------------------------------------------- map ----
function mapSection(cfg) {
  const m = cfg.map;
  const loads = [0, Math.round(cfg.bag.slots / 2), cfg.bag.slots];
  const rows = [];
  for (let d = 1; d <= maxDistance(cfg); d++) {
    rows.push([String(d), ...loads.map((items) => n(d * m.travelMinPerStep * (1 + (m.loadPenaltyPerItem * items) / 100)))]);
  }
  return [
    kv([
      ['Map', `${m.size} x ${m.size} fields, camp in the center. ${m.blockedCells} cells are blocked (impassable); every field stays reachable.`],
      ['Travel time', formula(`steps x ${m.travelMinPerStep}m x (1 + ${m.loadPenaltyPerItem}% x items in bag)`, 'Steps = shortest path around blocked cells. You can travel field to field.')],
      ['Bag', `${cfg.bag.slots} slots, 1 raw ore or gem per slot. You choose what to carry each time you leave a field. A full bag adds ${p(m.loadPenaltyPerItem * cfg.bag.slots)} travel time. Camp storage is unlimited.`],
      ['Bonuses', `Travel rings reduce every trip; the Return travel skill reduces trips to camp. Total capped at ${p(cfg.processing.maxTimeReduction)}.`],
    ]),
    sub('Base travel minutes by distance and bag load'),
    tbl(['Steps', ...loads.map((l) => ({ v: l === 0 ? 'Empty bag' : `${l} items`, cls: 'num' }))], rows),
  ];
}

// ------------------------------------------------------------------- field ----
function fieldSection(cfg) {
  const f = cfg.field;
  const cells = f.size * f.size;
  const avg = avgCount(f.itemCountWeights);
  const countPct = toPct(f.itemCountWeights);
  const rnd = f.searchRandomness || 0;
  const effLo = Math.max(0, f.searchEfficiency - rnd);
  const effHi = Math.min(100, f.searchEfficiency + rnd);
  const toFinish = (e) => (e > 0 ? String(Math.ceil(100 / e - 1e-9)) : '?');
  const searchesToFinish = toFinish(effHi) === toFinish(effLo) ? toFinish(effHi) : `${toFinish(effHi)}-${toFinish(effLo)}`;
  const regrow = f.regrowPctPerDay || 0;
  const da = f.debrisAmount;
  const debrisSkill = cfg.skills.activity.debris;
  const boulders = f.boulders || 0;
  const searchCells = Math.max(0, cells - boulders); // boulders hold nothing
  const gemsEqual = f.gemWeights.every((w) => new Set(Object.values(w)).size === 1);
  // Searches needed to clear `t` debris at base power (each cell rolls effLo..effHi effort).
  const clearSearches = (t) => {
    if (effLo <= 0) return 'many searches';
    const a = Math.ceil(t / effHi - 1e-9);
    const b = Math.ceil(t / effLo - 1e-9);
    return `${a === b ? a : `${a}-${b}`} search${b === 1 ? '' : 'es'}`;
  };
  const lootRows = [];
  for (let d = 1; d <= maxDistance(cfg); d++) {
    const base = lootChance(cfg, d);
    const deb = Math.min(100, base + f.debrisLootBonus);
    const perCell = ((1 - f.debrisChance / 100) * base + (f.debrisChance / 100) * deb) / 100;
    const items = searchCells * perCell * avg;
    lootRows.push([String(d), np(base), np(deb), n(items, 0), n(items * (f.oreShare / 100), 0), n(items * (1 - f.oreShare / 100), 0)]);
  }
  const weightTable = (rows, keys) => tbl(['Distance', ...keys.map((k) => ({ v: cap(k), cls: 'num' }))],
    rows.map((w, i) => {
      const pc = toPct(w);
      const label = i === rows.length - 1 ? `${i + 1}+` : String(i + 1);
      return [label, ...keys.map((k) => (pc[k] > 0 ? np(pc[k], 0) : { v: '·', cls: 'num muted' }))];
    }));
  const oreKeys = Object.keys(f.oreWeights[0]);
  const gemKeys = Object.keys(f.gemWeights[0]);
  return [
    kv([
      ['Field', `${f.size} x ${f.size} = ${cells} cells. Contents are hidden.`],
      f.freshCellMin > 0 ? ['Fresh cells', `A cell is fresh until a search works on it (clears some of its debris or searches it). Each fresh cell in the 3x3 area adds ${mins(f.freshCellMin)} to that search, so a search of an all-fresh area takes ${mins(f.searchMin)} + 9 x ${mins(f.freshCellMin)} = ${mins(f.searchMin + f.freshCellMin * 9)}, and finishing an area before moving on keeps searches near ${mins(f.searchMin)}. Search-time reductions (rings, skill) apply to the total. Fresh cells are marked with a small dot on the map; a boulder is never fresh.`] : null,
      ['Search', rnd > 0
        ? `A 3x3 area takes ${mins(f.searchMin)}${f.freshCellMin > 0 ? ` plus ${mins(f.freshCellMin)} per fresh cell` : ''}. Each search adds ${p(f.searchEfficiency)} ± ${num(rnd)} "searched" to every cell in the area: each cell rolls its own amount (${p(effLo)}-${p(effHi)}), so ${searchesToFinish} searches finish a cell.`
        : `A 3x3 area takes ${mins(f.searchMin)}${f.freshCellMin > 0 ? ` plus ${mins(f.freshCellMin)} per fresh cell` : ''}. Each search adds ${p(f.searchEfficiency)} "searched" to every cell in the area, so ${searchesToFinish} searches finish a cell.`],
      ['Search efficiency', `${cfg.rings.types.searchEff ? `${cfg.rings.types.searchEff.name} rings` : 'Rings'} and the ${cfg.skills.activity.searchEff ? cfg.skills.activity.searchEff.name : 'search efficiency'} skill raise the average: average = ${p(f.searchEfficiency)} x (1 + bonus %).${rnd > 0 ? ` The ± ${num(rnd)} spread per cell stays the same.` : ''} The Map shows your current range.`],
      ['Hidden depth', 'Each item has a hidden depth from 0 to 100. It is found once the cell\'s searched % passes its depth. A fully searched cell gives up everything.'],
      ['Debris', `${p(f.debrisChance)} of cells, ${num(da.min)}-${num(da.max)} thick (in search effort; the number on the cell is what is left). There is no separate clear action: searching a debris cell spends that cell's effort roll (${p(f.searchEfficiency)} ± ${num(rnd)}) x debris clearing power (1 + ${debrisSkill ? debrisSkill.name : 'debris'} skill %) on the debris first; any effort left over searches the cell in the same search. At base power a ${num(da.min)}-thick cell takes ${clearSearches(da.min)} to clear, a ${num(da.max)}-thick one ${clearSearches(da.max)}. Debris cells are +${f.debrisLootBonus} points more likely to hold items.`],
      debrisSkill ? ['Debris clearing skill', `+${num(debrisSkill.perLevel, 2)}% debris cleared per search per level (+${num(debrisSkill.perLevel * cfg.skills.maxLevel, 2)}% at level ${cfg.skills.maxLevel}). XP: ${debrisSkill.xpFrom}.`] : null,
      boulders ? ['Boulders', `${boulders} cell${boulders === 1 ? '' : 's'} per field (a dark rock): can never be cleared or searched and hold nothing. They do not count toward a field's searched %.`] : null,
      ['Ore sight', `Each searched cell has a chance to reveal everything still in it: ${p(cfg.intel.tracks.oreSight.base)} base (intel), plus intel points and Ore sight rings.`],
      ['Items per loot cell', `${Object.entries(countPct).map(([k, v]) => `${k} (${p(v, 0)})`).join(', ')}, average ${num(avg, 2)}`],
      ['Ores vs gems', `${p(f.oreShare, 0)} ores, ${p(100 - f.oreShare, 0)} gems`],
      ['Field pile', `Everything you find goes to that field's pile (no limit; it stays there for the rest of the run, and the map shows how many items each field's pile holds). In the field you can move single items between your bag and the pile for free.`],
      ['Carrying', `When you leave a field you choose what to carry: up to ${cfg.bag.slots} items from your bag and the pile. Default "Rarest first": keep your bag and fill the free slots with the rarest items (mythril, then diamond, emerald, sapphire, topaz, ruby, coal, iron, copper). The rest stays in the pile.`],
      ['Regrowth', regrow > 0
        ? `Each night, every searched cell (even partly searched) has a ${p(regrow)} chance to become a fresh, unsearched cell with new hidden contents rolled for its distance (it may get debris again). The field's pile stays. A fully searched field regrows about ${num((cells * regrow) / 100, 2)} cells per night.`
        : 'Off: fields do not regrow. A searched cell stays searched for the rest of the run.'],
    ]),
    sub('Richness by distance from camp'),
    tbl(['Distance', { v: 'Cell has items', cls: 'num' }, { v: 'Debris cell', cls: 'num' }, { v: '≈ items / field', cls: 'num' }, { v: '≈ ores', cls: 'num' }, { v: '≈ gems', cls: 'num' }], lootRows),
    h('p', { class: 'mi-note' }, `Cell chance = ${f.lootChance.base}% + ${f.lootChance.perDistance}% per step beyond the first, max ${f.lootChance.max}%. Item estimates = ${searchCells} cells${boulders ? ` (${cells} minus ${boulders} boulder${boulders === 1 ? '' : 's'})` : ''} x average chance (incl. debris) x ${num(avg, 2)} items.`),
    h('div', { class: 'mi-two' },
      h('div', {}, sub('Ore mix by distance'), weightTable(f.oreWeights, oreKeys)),
      h('div', {}, sub('Gem mix by distance'), weightTable(f.gemWeights, gemKeys),
        gemsEqual ? h('p', { class: 'mi-note' }, 'Every gem type is equally likely, at every distance.') : null)),
  ];
}

// -------------------------------------------------------------- processing ----
function processSection(cfg) {
  const distCells = (dist) => OUTCOMES.map((g) => (dist[g] > 0 ? np(dist[g], 0) : { v: '·', cls: 'num muted' }));
  const distCells1 = (dist) => OUTCOMES.map((g) => (dist[g] > 0.05 ? np(dist[g], 1) : { v: '·', cls: 'num muted' }));
  const outHead = () => OUTCOMES.map((g) => ({ v: gradeSpan(g), cls: 'num' })); // fresh nodes per table
  const sk = cfg.skills;
  const gg = sk.perMaterial.gemGrade;
  const gf = sk.perMaterial.gemFail;
  const masterLv = Math.min(sk.maxLevel, Math.ceil(100 / Math.max(gg.perLevel, 1e-9) - 1e-9));
  const gemLuck = cfg.rings.types.gemGrade;
  const barLuck = cfg.rings.types.oreGrade;
  const barRows = BARS.map((b) => {
    const r = cfg.refine[b];
    return [h('b', {}, cap(b)), Object.entries(r.input).map(([o, k]) => `${k} ${o}`).join(' + '), n(r.minutes), ...distCells(r.dist)];
  });
  // Gems that share the same tables are listed together.
  const groups = [];
  for (const g of GEMS) {
    const c = cfg.cut[g];
    const sig = JSON.stringify([c.minutes, c.novice, c.master, c.dist]);
    const found = groups.find((x) => x.sig === sig);
    if (found) found.gems.push(g);
    else groups.push({ sig, gems: [g], c });
  }
  const gemLabel = (gems) => (gems.length === GEMS.length ? 'All gems' : gems.map(cap).join(', '));
  // Failure only depends on the cutting skill: the master table's failure is reached at this cutting level.
  const failLv = (c) => Math.min(sk.maxLevel, Math.max(0, Math.ceil((c.novice.F - c.master.F) / Math.max(gf.perLevel, 1e-9) - 1e-9)));
  const gemRows = groups.flatMap(({ gems, c }) => (c.novice
    ? [
      [h('b', {}, gemLabel(gems)), 'Novice (grade skill 0)', n(c.minutes), ...distCells(c.novice)],
      [h('b', {}, gemLabel(gems)), `Master (grade skill ${masterLv}, cutting skill ${failLv(c)})`, n(c.minutes), ...distCells(c.master)],
    ]
    : [[h('b', {}, gemLabel(gems)), 'Fixed table', n(c.minutes), ...distCells(c.dist)]]));
  // How the gem grade skill blends the table (no cutting skill, no rings), for the first tiered gem.
  const tiered = groups.find((x) => x.c.novice);
  const levels = [];
  for (let l = 0; l <= sk.maxLevel; l += Math.max(1, Math.floor(sk.maxLevel / 5))) levels.push(l);
  if (levels[levels.length - 1] !== sk.maxLevel) levels.push(sk.maxLevel);
  const blendRows = tiered ? levels.map((l) => {
    const t = Math.min(100, gg.perLevel * l);
    return [n(l, 0), np(t, 0), ...distCells1(blendCutTable(tiered.c, t / 100, 0))];
  }) : [];
  return [
    sub('Refining ore into bars'),
    tbl(['Bar', 'Needs', { v: 'Minutes', cls: 'num' }, ...outHead()], barRows),
    sub('Cutting gems: novice and master tables'),
    tbl(['Gem', 'Table', { v: 'Minutes', cls: 'num' }, ...outHead()], gemRows),
    tiered ? [
      sub(`Gem table by grade skill level (${tiered.gems.length === GEMS.length ? 'all gems' : gemLabel(tiered.gems)}; before the cutting skill and rings)`),
      tbl([{ v: 'Grade skill level', cls: 'num' }, { v: 'Of the way to master', cls: 'num' }, ...outHead()], blendRows),
    ] : null,
    h('ul', { class: 'mi-list' },
      h('li', {}, 'Grades read from lowest (left) to highest (right). Fail = the material is lost. The Workshop shows these chances already adjusted by your rings and skills.'),
      h('li', {}, 'Time: Refining rings (refining and cutting) + Refining / Cutting speed skills, capped at ', p(cfg.processing.maxTimeReduction), '.'),
      h('li', {}, `Bars: ${barLuck ? `${barLuck.name} rings` : 'Rings'} + the bar grade skill (${num(sk.perMaterial.oreGrade.perLevel, 2)}% per level) give each successful bar that % chance to go up one grade (S stays S). The refining skill for that bar moves failure chance into grade D (${num(sk.perMaterial.oreFail.perLevel, 2)} points per level).`),
      tiered ? h('li', {}, `Gems: each gem's grade skill blends its table from novice to master, ${num(gg.perLevel, 2)}% of the way per level (master at level ${masterLv}). D to S follow the blend and fill whatever failure leaves. Failure = the novice failure chance minus the gem's cutting skill (${num(gf.perLevel, 2)} points per level, ${num(gf.perLevel * sk.maxLevel, 2)} at level ${sk.maxLevel}). Then ${gemLuck ? `${gemLuck.name} rings` : 'gem luck rings'} give each successful cut their % chance to go up one grade, on top.`) : null),
  ];
}

// -------------------------------------------------------------------- gear ----
function gearSection(cfg) {
  const g = cfg.gear;
  const mats = Object.keys(g.materialMult);
  const slotRows = SLOTS.map((s) => {
    const def = g.slots[s];
    return [h('b', {}, cap(s)), n(def.bars, 0), { v: mins(craftMinutes(s, false, cfg)), cls: 'num' },
      Object.entries(def.stats).map(([k, v]) => fmtStat(k, v)).join(', ')];
  });
  // One small card per slot stat: material x grade.
  const cards = [];
  for (const s of SLOTS) {
    for (const [stat, base] of Object.entries(g.slots[s].stats)) {
      cards.push(h('div', { class: 'mi-card' },
        h('div', { class: 'mi-card-title' }, `${cap(s)}: ${statLabel(stat)}`),
        tbl(['', ...gradeHead()], mats.map((m) => [cap(m), ...GRADES.map((gr) => n(base * g.materialMult[m] * g.gradeMult[gr]))]))));
    }
  }
  return [
    kv([
      ['Stat formula', formula('stat = slot base x material multiplier x grade multiplier')],
      ['Bars', 'All bars in one item must be the same material and grade. The item\'s grade is the bars\' grade.'],
      ['Smithing time', `${mins(g.smithMinPerBar)} per bar, +${mins(g.infuseMin)} to infuse a cut gem (optional, any gem grade).`],
      ['Armor', 'Defense % reduces physical damage (defense from all armor pieces adds up, capped in combat). Gloves add accuracy; boots add dodge and speed.'],
    ]),
    sub('Slots (base stats = copper, grade D)'),
    tbl(['Slot', { v: 'Bars', cls: 'num' }, { v: 'Smith time', cls: 'num' }, 'Base stats'], slotRows),
    h('div', { class: 'mi-two' },
      h('div', {}, sub('Material multiplier'), tbl(mats.map((m) => ({ v: cap(m), cls: 'num' })), [mats.map((m) => ({ v: x(g.materialMult[m]), cls: 'num' }))])),
      h('div', {}, sub('Grade multiplier'), tbl(gradeHead(), [GRADES.map((gr) => ({ v: x(g.gradeMult[gr]), cls: 'num' }))]))),
    sub('Resulting stats by material and grade (before gems)'),
    h('div', { class: 'mi-cards' }, cards),
  ];
}

// -------------------------------------------------------------------- gems ----
function gemSection(cfg) {
  const mult = cfg.gear.gemArmorMult;
  const special = ARMOR_SLOTS.filter((s) => mult[s] !== 1);
  const rows = [];
  for (const gem of GEMS) {
    const fx = cfg.gemEffects[gem];
    for (const [k, arr] of Object.entries(fx.weapon)) {
      rows.push([h('b', {}, cap(gem)), 'Sword', statLabel(k), ...arr.map((v) => n(v, 2))]);
    }
    for (const [k, arr] of Object.entries(fx.armor)) {
      rows.push([h('b', {}, cap(gem)), 'Armor', statLabel(k), ...arr.map((v) => ({
        v: h('span', {}, num(v, 2), special.length ? h('span', { class: 'mi-sub' }, special.map((s) => `${s} ${num(v * mult[s], 2)}`).join(' · ')) : null),
        cls: 'num',
      }))]);
    }
  }
  return [
    h('p', {}, 'Infusing a cut gem while smithing adds a bonus. The gem\'s grade (not the gear\'s) sets the strength. Swords get the weapon effect, armor the armor effect.'),
    special.length ? h('p', { class: 'mi-note' }, `Armor effects are multiplied by slot: ${ARMOR_SLOTS.map((s) => `${s} ${x(mult[s])}`).join(', ')} (small numbers under each value).`) : null,
    tbl(['Gem', 'On', 'Effect', ...gradeHead()], rows, 'mi-gems'),
    h('ul', { class: 'mi-list' },
      h('li', {}, 'Ruby: magic damage = % of weapon damage, ignores defense / armor magic resistance.'),
      h('li', {}, 'Topaz: chance per hit to stun (the target\'s attack bar stops filling for the duration) / reduces enemy stun chance and duration.'),
      h('li', {}, 'Emerald: accuracy rating / dodge rating.'),
      h('li', {}, 'Sapphire: on hit, the target\'s attack bar fills slower (by the slow %) for a few seconds / reduces enemy slow strength and duration.'),
      h('li', {}, 'Diamond: piercing (% of enemy defense ignored) / pierce resistance (% of enemy piercing ignored).')),
  ];
}

// -------------------------------------------------------------- adventurer ----
function adventurerSection(cfg) {
  const a = cfg.adventurer;
  return [
    kv([
      ['HP', num(a.hp)],
      ['Unarmed damage', `${num(a.unarmedDamage)} per hit (a sword replaces this)`],
      ['Attack bar', `fills in ${num(a.attackInterval, 2)}s at 0% speed (${num(1 / a.attackInterval, 2)} attacks per second); speed makes it fill faster`],
      ['Accuracy', num(a.accuracy)],
      ['Dodge', num(a.dodge)],
    ]),
    h('p', { class: 'mi-note' }, 'Gear stats and worn adventurer ring totals add on top. Health rings raise max HP by a %. The adventurer uses at most one item per slot in a fight.'),
  ];
}

// ------------------------------------------------------------------ combat ----
function combatSection(cfg) {
  const c = cfg.combat;
  const a = cfg.adventurer;
  const [lo, hi] = c.damageRoll;
  const ratios = [0.5, 0.75, 1, 1.5, 2];
  const hitRows = ratios.map((r) => [n(r, 2), `${num(a.accuracy * r)} vs ${num(a.dodge)}`, np(hitChance(a.accuracy * r, a.dodge, cfg) * 100)]);

  // Worked examples using the real combat formulas (day 1, every enemy attribute Normal).
  const allNormal = Object.fromEntries(Object.keys(cfg.enemies.attributes).map((k) => [k, 'normal']));
  const enemies = TIERS.map((t) => ({ tier: t, c: enemyCombatant(t, 1, allNormal, t, cfg) }));
  const mats = Object.keys(cfg.gear.materialMult);
  const lowM = mats[0];
  const highM = mats[mats.length - 1];
  const lowG = GRADES[0];
  const highG = GRADES[GRADES.length - 1];
  const sword = (m, gr) => adventurerCombatant([{ slot: 'sword', material: m, grade: gr, gem: null }], {}, cfg);
  const swords = [
    { label: 'No sword', c: adventurerCombatant([], {}, cfg) },
    { label: `${lowG} ${cap(lowM)} sword`, c: sword(lowM, lowG) },
    { label: `${highG} ${cap(highM)} sword`, c: sword(highM, highG) },
  ];
  const armorSet = (m, gr) => adventurerCombatant(ARMOR_SLOTS.map((s) => ({ slot: s, material: m, grade: gr, gem: null })), {}, cfg);
  const sets = [
    { label: 'No armor', c: adventurerCombatant([], {}, cfg) },
    { label: `${lowG} ${cap(lowM)} armor set`, c: armorSet(lowM, lowG) },
    { label: `${highG} ${cap(highM)} armor set`, c: armorSet(highM, highG) },
  ];
  const outRows = enemies.map((e) => [h('span', { class: `tier-${e.tier}` }, cap(e.tier)), np(e.c.defense, 0),
    ...swords.map((s) => n(hitDamage(s.c, e.c, cfg).total)), np(hitChance(a.accuracy, e.c.dodge, cfg) * 100, 0)]);
  const inRows = enemies.map((e) => [h('span', { class: `tier-${e.tier}` }, cap(e.tier)), n(e.c.damage),
    ...sets.map((s) => n(hitDamage(e.c, s.c, cfg).total)), np(hitChance(e.c.accuracy, a.dodge, cfg) * 100, 0)]);
  const normalAttr = (k) => cfg.enemies.attributes[k].values.normal;

  // Attack bar fill time by speed and slow (core attackInterval).
  const speeds = [-5, 0, 5, 10, 20];
  const slows = [0, ...cfg.gemEffects.sapphire.weapon.slowPct.filter((_, i) => i % 2 === 0)];
  const barRows = speeds.map((sp) => [{ v: `${sp > 0 ? '+' : ''}${sp}%`, cls: 'num' },
    ...slows.map((sl) => ({ v: `${num(attackInterval({ interval: a.attackInterval, speed: sp }, sl > 0, sl), 2)}s`, cls: 'num' }))]);

  // Piercing vs pierce resistance (core hitDamage), against each tier's defense.
  const pierceVals = [0, ...cfg.gemEffects.diamond.weapon.pierce.filter((_, i) => i % 2 === 0)];
  const resLevels = LEVELS.map((lv) => ({ lv, v: cfg.enemies.attributes.pierceRes.values[lv] }));
  const effDef = (pierce, pierceRes, defense) => hitDamage({ damage: 1, pierce, magicPct: 0 }, { defense, pierceRes, magicRes: 0 }, cfg).effDef;
  const pierceRows = resLevels.map(({ lv, v }) => [h('span', { class: `attr-${lv}` }, `${cap(lv)} (${p(v, 0)})`),
    ...pierceVals.map((pv) => {
      const effPierce = c.defenseCap > 0 ? (1 - effDef(pv, v, c.defenseCap) / c.defenseCap) * 100 : Math.min(pv, 100) * (1 - Math.min(v, c.resistCap) / 100);
      return {
        v: h('span', {}, p(effPierce), h('span', { class: 'mi-sub' }, `defense ${TIERS.map((t) => num(effDef(pv, v, cfg.enemies.tiers[t].defense), 1)).join(' / ')}%`)),
        cls: 'num',
      };
    })]);

  return [
    sub('Attack bars'),
    formula('attack bar fills in base interval / (1 + speed% / 100) seconds; a full bar attacks and starts again from empty',
      `Base interval: adventurer ${num(a.attackInterval, 2)}s, enemies ${num(cfg.enemies.attackInterval, 2)}s. If both bars fill at the same moment, the adventurer attacks first.`),
    formula('slowed by X%: the bar fills X% slower (fill rate / (1 + X / 100)) until the slow ends',
      `X = slow% x (1 - min(slow reduction, ${c.resistCap}) / 100); duration x (1 - min(slow duration reduction, ${c.resistCap}) / 100).`),
    formula('stunned: the bar stops filling until the stun ends (progress is kept)',
      `stun chance per hit = stun% x (1 - min(stun chance reduction, ${c.resistCap}) / 100); duration x (1 - min(stun duration reduction, ${c.resistCap}) / 100).`),
    h('p', { class: 'mi-note' }, 'Stuns and slows do not stack: a new one while one is active refreshes the timer (it ends at whichever end is later). For slows the stronger strength is kept while the slow lasts.'),
    sub('Hits and damage'),
    formula(`hit chance = acc² / (acc² + ${c.hitK} x dodge²), clamped to ${c.minHitPct}%..${c.maxHitPct}%`, 'An S-curve: more accuracy always helps, with diminishing returns.'),
    formula(`damage roll: each hit deals ${lo}%..${hi}% of the listed damage`),
    formula(`effective pierce = min(piercing, 100) x (1 - min(pierce resistance, ${c.resistCap}) / 100)`,
      'Pierce resistance is the % of the attacker\'s piercing that is ignored (not points subtracted).'),
    formula(`effective defense = min(defense, ${c.defenseCap}) x (1 - effective pierce / 100)`),
    formula('physical = damage x (1 - effective defense / 100)'),
    formula(`magic = damage x magic% / 100 x (1 - min(magic resist, ${c.resistCap}) / 100)`, 'Magic ignores defense. A hit deals physical + magic.'),
    kv([
      ['Caps', `Defense ${p(c.defenseCap, 0)}. Pierce resistance, magic resistance and all stun / slow reductions ${p(c.resistCap, 0)}.`],
      ['No time limit', `A safety cap of ${num(c.safetyCapSeconds, 0)}s only stops endless loops; reaching it counts as a draw (adventurer survives, no ring).`],
      ['Gear choice', `When the fight starts the adventurer tries every combination of packed gear (${num(c.bestGearFights, 0)} simulated fights each) and uses the best.`],
      ['Win-chance estimate', `Plan screen, one button (Estimate all) for the whole roster. For each enemy: ${cfg.sim.samples} guesses of the hidden attributes (respecting the tier's low/normal/high counts) x ${cfg.sim.evalFights} fights each, after picking gear with ${cfg.sim.fightsPerLoadout} fights per combination, i.e. ${cfg.sim.samples * cfg.sim.evalFights} fights per enemy. That is small on purpose: the result is noisy, a little risk you plan with. Every estimate shows its margin of error (for example 62% ± 12: the simulation alone could be off by about 12 points, which holds about 9 times in 10 when every attribute is known; attributes you can't see add more uncertainty); more guesses and test fights shrink it. The Battle simulation intel track adds its value as extra guesses AND extra test fights per enemy (+${cfg.intel.gainsPerPoint[0]} for the first point, then +${cfg.intel.gainsPerPoint[1]}, ...), and each point of Foresight smith ring adds one more of each (rounded down). Draws count as survival.`],
    ]),
    sub(`Attack bar fill time (adventurer, ${num(a.attackInterval, 2)}s base)`),
    tbl([{ v: 'Speed', cls: 'num' }, ...slows.map((sl) => ({ v: sl > 0 ? `Slowed ${p(sl, 0)}` : 'Not slowed', cls: 'num' }))], barRows),
    sub('Effective piercing vs enemy pierce resistance'),
    tbl(['Enemy pierce resistance', ...pierceVals.map((pv) => ({ v: pv > 0 ? `Your piercing ${p(pv, 0)}` : 'No piercing', cls: 'num' }))], pierceRows),
    h('p', { class: 'mi-note' }, `Small numbers: the enemy's defense after piercing for ${TIERS.join(' / ')} enemies (${TIERS.map((t) => p(cfg.enemies.tiers[t].defense, 0)).join(' / ')} base defense). Piercing values shown are diamond sword grades ${GRADES.filter((_, i) => i % 2 === 0).join(', ')}.`),
    sub('Hit chance by accuracy / dodge ratio'),
    tbl([{ v: 'Ratio', cls: 'num' }, 'Example', { v: 'Hit chance', cls: 'num' }], hitRows),
    sub('Your average damage per hit (day 1 enemies, all attributes Normal)'),
    tbl(['Enemy', { v: 'Defense', cls: 'num' }, ...swords.map((s) => ({ v: s.label, cls: 'num' })), { v: 'Your hit chance', cls: 'num' }], outRows),
    sub('Enemy average damage per hit on you (day 1, all attributes Normal)'),
    tbl(['Enemy', { v: 'Damage', cls: 'num' }, ...sets.map((s) => ({ v: s.label, cls: 'num' })), { v: 'Its hit chance', cls: 'num' }], inRows),
    h('p', { class: 'mi-note' }, `Normal enemies here have ${p(normalAttr('piercing'), 0)} piercing, ${p(normalAttr('pierceRes'), 0)} pierce resistance and ${p(normalAttr('magical'), 0)} extra magic damage. Hit chances use base accuracy ${num(a.accuracy)} / dodge ${num(a.dodge)} (no gloves, boots or emeralds).`),
  ];
}

// ----------------------------------------------------------------- enemies ----
function enemySection(cfg) {
  const e = cfg.enemies;
  const tierRows = TIERS.map((t) => {
    const d = e.tiers[t];
    const ringPct = toPct(cfg.rings.gradeWeights[t] || {});
    return [h('b', { class: `tier-${t}` }, cap(t)), n(d.count, 0), n(d.hp), n(d.damage), np(d.defense, 0),
      LEVELS.map((lv) => d.levels[lv]).join(' / '), n(d.score, 0),
      Object.entries(ringPct).filter(([, v]) => v > 0).map(([g, v]) => `${g} ${p(v, 0)}`).join(', ')];
  });
  const days = [1, 5, 10, 20, 30, 50];
  const growthRows = days.map((day) => {
    const gr = growth(day, cfg);
    return [n(day, 0), { v: x(gr.hpDamage), cls: 'num' }, { v: x(gr.ratings), cls: 'num' },
      ...TIERS.map((t) => ({ v: `${num(e.tiers[t].hp * gr.hpDamage, 0)} / ${num(e.tiers[t].damage * gr.hpDamage)}`, cls: 'num' }))];
  });
  // One row per pair: offense on the left, its matching defense on the right.
  const lvCells = (a) => LEVELS.map((lv) => ({ v: num(a.values[lv], 2), cls: `num attr-${lv}` }));
  const attrRows = e.pairs.map(([o, d]) => {
    const ao = e.attributes[o];
    const ad = e.attributes[d];
    return [h('b', {}, ao.name), ...lvCells(ao), ao.desc, h('b', {}, ad.name), ...lvCells(ad), ad.desc];
  });
  const rosterN = TIERS.reduce((a, t) => a + e.tiers[t].count, 0);
  return [
    kv([
      ['Roster', `${rosterN} enemies each day (${TIERS.map((t) => `${e.tiers[t].count} ${t}`).join(', ')}). You pick one for tomorrow.`],
      ['Attack bar', `fills in ${num(e.attackInterval, 2)}s at 0% speed (the Fast attribute changes speed)`],
      ['Stun / slow', `An enemy stun stops your attack bar for ${num(e.stunDuration, 2)}s; a Chilling hit makes your bar fill slower (by its Chilling %) for ${num(e.slowDuration, 2)}s. Both before your resistances; neither stacks.`],
      ['Daily growth', formula(`HP & damage x (1 + ${e.growthPerDay.hpDamage}% x (day - 1)); accuracy & dodge x (1 + ${e.growthPerDay.ratings}% x (day - 1))`)],
      ['Attributes', `${Object.keys(e.attributes).length} attributes, each Low / Normal / High, assigned at random to match the tier's counts. Each one is visible with your Enemy scouting chance (${p(cfg.intel.tracks.enemySight.base, 0)} base).`],
    ]),
    sub('Tiers (base values on day 1)'),
    tbl(['Tier', { v: 'Per roster', cls: 'num' }, { v: 'HP', cls: 'num' }, { v: 'Damage', cls: 'num' }, { v: 'Defense', cls: 'num' }, 'Low / Normal / High', { v: 'Score', cls: 'num' }, 'Ring grade odds'], tierRows),
    sub('Growth by day (HP / damage per tier, before the HP attribute)'),
    tbl([{ v: 'Day', cls: 'num' }, { v: 'HP & dmg', cls: 'num' }, { v: 'Acc & dodge', cls: 'num' }, ...TIERS.map((t) => ({ v: cap(t), cls: 'num' }))], growthRows),
    sub('Attributes (shown in pairs: offense | defense)'),
    tbl(['Offense', ...LEVELS.map((lv) => ({ v: cap(lv), cls: `num attr-${lv}` })), 'Meaning', 'Defense', ...LEVELS.map((lv) => ({ v: cap(lv), cls: `num attr-${lv}` })), 'Meaning'], attrRows),
  ];
}

// ------------------------------------------------------------------- rings ----
function ringSection(cfg) {
  const r = cfg.rings;
  const types = Object.entries(r.types);
  const weights = Array.from({ length: 5 }, (_, i) => p(r.duplicateFactor ** i * 100, 2));
  const typeRows = types.map(([, d]) => [h('b', {}, d.name), cap(d.owner), ...d.values.map((v) => n(v, 2)), d.desc]);
  const oddsRows = TIERS.map((t) => {
    const pc = toPct(r.gradeWeights[t] || {});
    return [h('span', { class: `tier-${t}` }, cap(t)), ...GRADES.map((g) => (pc[g] > 0 ? np(pc[g], 0) : { v: '·', cls: 'num muted' }))];
  });
  return [
    kv([
      ['Source', `Each defeated enemy drops 1 ring. Type: uniform over all ${types.length} types (${p(100 / types.length)} each). Grade: by tier (below).`],
      ['Wearing', `Smith and adventurer each wear up to ${r.maxWorn} rings. Smith rings apply at once and can be swapped at the start of a day (before your first action) or while planning at night; adventurer rings are chosen in each night's plan.`],
      ['Stacking', `Same type, best first: ${weights.join(', ')}, ... (each extra ring counts ${x(r.duplicateFactor)} the previous one).`],
      r.types.foresight ? [r.types.foresight.name, `A smith ring: every point of the stacked total adds one guess AND one test fight per enemy to the plan screen's win-chance estimate (the total is rounded down: ${r.types.foresight.values.map((v) => v).join(' / ')} for ${GRADES.join(' / ')} rings). It does nothing in the fight itself.`] : null,
    ]),
    tbl(['Ring', 'Wearer', ...gradeHead(), 'Effect'], typeRows),
    sub('Ring grade odds by enemy tier'),
    tbl(['Tier', ...gradeHead()], oddsRows),
  ];
}

// ------------------------------------------------------------------ skills ----
function skillSection(cfg) {
  const s = cfg.skills;
  const xpRow = [];
  let total = 0;
  for (let l = 0; l < s.maxLevel; l++) {
    xpRow.push(xpToNext(l, cfg));
    total += xpToNext(l, cfg);
  }
  const defs = skillDefs(cfg);
  const activity = defs.filter((d) => d.group === 'activity');
  const ringCell = (key) => {
    const m = skillRingMatch(key, cfg);
    return m ? skillRingText(m) : h('span', { class: 'muted' }, 'no ring');
  };
  const actRows = activity.map((d) => [h('b', {}, d.name), { v: num(d.perLevel, 2), cls: 'num' }, { v: num(d.perLevel * s.maxLevel, 2), cls: 'num' }, ringCell(d.key), d.desc, d.xpFrom]);
  const xpRange = (mats) => {
    const xs = mats.map((m) => itemXp(m, cfg));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? num(lo) : `${num(lo)}-${num(hi)}`;
  };
  const matRows = Object.entries(s.perMaterial).map(([k, d]) => {
    const isOre = k.startsWith('ore');
    const label = `${isOre ? 'Bar' : 'Gem'} ${d.name}`;
    return [h('b', {}, label), { v: num(d.perLevel, 2), cls: 'num' }, { v: num(d.perLevel * s.maxLevel, 2), cls: 'num' }, ringCell(k), d.desc,
      `${xpRange(isOre ? BARS : GEMS)} XP per ${isOre ? 'bar refined' : 'gem cut'} of that type (by material, table below)`];
  });
  // XP per item by material, and how many items one skill needs to reach max level.
  const xpTable = (mats, what) => tbl([what, { v: 'XP per item', cls: 'num' }, { v: `Items to level ${s.maxLevel}`, cls: 'num' }],
    mats.map((m) => {
      const xp = itemXp(m, cfg);
      return [h('b', {}, cap(m)), n(xp, 0), xp > 0 ? n(Math.ceil(total / xp), 0) : { v: '·', cls: 'num muted' }];
    }));
  return [
    kv([
      ['Levels', `0 to ${s.maxLevel}. Skills level up automatically from doing the activity.`],
      ['XP per level', formula(`XP for level L → L+1 = ${s.xpBase} x (L + 1)`, `${xpRow.join(', ')} (total ${total.toLocaleString('en-US')} XP to reach level ${s.maxLevel})`)],
      ['Bonus', `per-level value x level; skill bonuses add to ring bonuses. ${skillVsRingText(cfg)}`],
    ]),
    sub('Activity skills'),
    tbl(['Skill', { v: 'Per level', cls: 'num' }, { v: `At level ${s.maxLevel}`, cls: 'num' }, `Level ${s.maxLevel} vs rings`, 'Effect', 'XP from'], actRows),
    sub('Per-material skills (one of each per bar type / gem type)'),
    tbl(['Skill', { v: 'Per level', cls: 'num' }, { v: `At level ${s.maxLevel}`, cls: 'num' }, `Level ${s.maxLevel} vs rings`, 'Effect', 'XP from'], matRows),
    sub('Per-material XP (rarer materials give more; failed attempts count)'),
    h('div', { class: 'mi-two' },
      h('div', {}, xpTable(BARS, 'Bar refined')),
      h('div', {}, xpTable(GEMS, 'Gem cut'))),
    h('p', { class: 'mi-note' }, 'Each refined bar gives this XP to both skills of that bar type (grade and refining); each cut gem to both skills of that gem.'),
    h('ul', { class: 'mi-list' },
      s.activity.debris ? h('li', {}, `${s.activity.debris.name}: +${num(s.activity.debris.perLevel, 2)}% debris cleared per search per level (+${num(s.activity.debris.perLevel * s.maxLevel, 2)}% at level ${s.maxLevel}). XP: ${s.activity.debris.xpFrom}. Debris is cleared by searching (see Fields & searching).`) : null,
      h('li', {}, `Gem grade: ${num(s.perMaterial.gemGrade.perLevel, 2)}% of the way from the novice to the master cutting table per level (see Refining & cutting). It has no ring; Gem luck rings add upgrade chances on top.`)),
  ];
}

// ------------------------------------------------------------------- intel ----
function intelSection(cfg) {
  const ic = cfg.intel;
  const k = ic.gainsPerPoint.length;
  const head = ['Point', ...ic.gainsPerPoint.map((_, i) => ({ v: ordinal(i + 1), cls: 'num' })), { v: `${ordinal(k + 1)}+`, cls: 'num' }];
  const row = ['Gain', ...ic.gainsPerPoint.map((_, i) => ({ v: `+${gainForPoint(i + 1, cfg)}`, cls: 'num' })), { v: `+${gainForPoint(k + 1, cfg)}`, cls: 'num' }];
  const trackRows = Object.entries(ic.tracks).map(([k, t]) => [h('b', {}, t.name), { v: isCountTrack(k) ? `+${t.base}` : p(t.base, 0), cls: 'num' }, t.desc]);
  return [
    kv([
      ['Earning', `1 intel point at the end of every ${ordinal(ic.daysPerPoint)} day (day ${ic.daysPerPoint}, ${ic.daysPerPoint * 2}, ${ic.daysPerPoint * 3}, ...).`],
      ['Spending', `Each point raises one track. Diminishing returns per track (below), max ${p(ic.maxChance, 0)}.`],
      ['Battle simulation', `Not a chance: its value is the number of extra guesses and extra test fights per enemy in the win-chance estimate (base ${cfg.sim.samples} guesses x ${cfg.sim.evalFights} fights). The first point gives +${gainForPoint(1, cfg)}, so ${cfg.sim.samples + gainForPoint(1, cfg)} x ${cfg.sim.evalFights + gainForPoint(1, cfg)}; every extra guess and fight also makes the estimate slower to run.`],
    ]),
    tbl(['Track', { v: 'Base', cls: 'num' }, 'What it does'], trackRows),
    sub('Gain per point spent on the same track'),
    tbl(head, [row]),
  ];
}

// ------------------------------------------------------------------ repair ----
function repairSection(cfg) {
  const g = cfg.gear;
  const loss = g.durabilityLoss;
  const avgLoss = (loss.min + loss.max) / 2;
  const fmtBars = (bars) => Object.values(bars).map((v) => num(v, 2)).join(' + ');
  const rows = SLOTS.map((s) => {
    const full = repairInfo({ slot: s, material: 'x', grade: GRADES[0], gem: null, durability: 0 }, cfg);
    const one = repairInfo({ slot: s, material: 'x', grade: GRADES[0], gem: null, durability: 100 - avgLoss }, cfg);
    return [h('b', {}, cap(s)), n(g.slots[s].bars, 0), { v: `${fmtBars(full.bars)} bars`, cls: 'num' }, { v: mins(full.minutes), cls: 'num' },
      { v: `${fmtBars(one.bars)} bars`, cls: 'num' }, { v: mins(one.minutes), cls: 'num' }];
  });
  const tierMult = loss.tierMult || {};
  const wearRows = TIERS.map((t) => {
    const m = tierMult[t] || 1;
    const lo = wearLoss(loss.min, m);
    const hi = wearLoss(loss.max, m);
    return [h('span', { class: `tier-${t}` }, cap(t)), { v: `x${num(m, 2)}`, cls: 'num' }, { v: `${num(lo, 1)}-${num(hi, 1)}%`, cls: 'num' }, { v: p(avgLoss * m, 1), cls: 'num' }];
  });
  const gemFull = repairInfo({ slot: 'chest', material: 'x', grade: GRADES[0], gem: { type: 'gem', grade: GRADES[0] }, durability: 0 }, cfg);
  const gemExtra = Object.values(gemFull.gems)[0] || 0;
  return [
    kv([
      ['Wear', `Each fight, every item the adventurer actually used loses a durability roll of ${loss.min}-${loss.max}% (average ${num(avgLoss)}%), times the enemy tier's multiplier (${TIERS.map((t) => `${t} x${(loss.tierMult && loss.tierMult[t]) || 1}`).join(', ')}), times (1 - Gear care %). The result is kept to one decimal (for example 9.6%) so every Gear care level counts, and is at least 1%. Packed but unused items do not wear. At 0% the item is destroyed.`],
      cfg.skills.activity.gearCare ? [cfg.skills.activity.gearCare.name, `Skill: ${num(cfg.skills.activity.gearCare.perLevel, 2)}% less wear per level (${num(cfg.skills.activity.gearCare.perLevel * cfg.skills.maxLevel, 2)}% at level ${cfg.skills.maxLevel}). It earns ${cfg.skills.gearCareXpPerFight} XP for every fight the adventurer survives (win or draw), so it grows as you win.`] : null,
      ['Repair', 'Only back to 100%, and not while the item is packed for today\'s fight. By day: at camp (Workshop), costs time. At night (battle report or plan screen): any gear at home, no time, materials only.'],
      ['Cost', formula(`${g.repair.materialFraction}% x original bars (and gem) x fraction repaired`, 'Same material and grade as the item; rounded up to 0.01. If you do not have enough of that grade, the lowest higher grade you have enough of is used instead, with a warning: no extra benefit, the item keeps its own grade.')],
      ['Time', formula(`${g.repair.timeFraction}% x smithing time x fraction repaired`, 'By day only. Repairs at night cost no time.')],
      ['With a gem', `Also costs ${num(gemExtra, 2)} of the same cut gem for a full repair (scaled the same way) and, by day, the infusion time counts in the repair time.`],
    ]),
    sub('Wear per fight by enemy tier (before Gear care)'),
    tbl(['Enemy tier', { v: 'Multiplier', cls: 'num' }, { v: 'Loss per used item', cls: 'num' }, { v: 'Average', cls: 'num' }], wearRows),
    sub('Repair cost by slot (item without a gem)'),
    tbl(['Slot', { v: 'Bars', cls: 'num' }, { v: 'Full repair (0→100%)', cls: 'num' }, { v: 'Time by day', cls: 'num' }, { v: `After an average fight (−${num(avgLoss)}%)`, cls: 'num' }, { v: 'Time by day', cls: 'num' }], rows),
  ];
}
