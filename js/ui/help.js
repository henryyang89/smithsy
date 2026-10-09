// Help tab: short how-to-play, then a live NUMBERS reference built from CONFIG (ctx.cfg).
// Nothing here is hardcoded: every number is read from config or computed with the core formulas,
// so the page stays correct when js/config.js is rebalanced.
// UI-only state: ctx.ui.help_open = { sectionId: true } (which reference sections are expanded).
import { h, num } from './dom.js';
import { GRADES, BARS, GEMS, SLOTS, ARMOR_SLOTS, TIERS, LEVELS } from '../config.js';
import { hitChance, hitDamage, adventurerCombatant, attackInterval } from '../core/combat.js';
import { STAT_LABELS, fmtStat, craftMinutes, repairInfo, scrapReturn, wearLoss } from '../core/gear.js';
import { enemyCombatant } from '../core/enemies.js';
import { skillDefs, xpToNext, itemXp, xpPerUnit, effectText } from '../core/skills.js';
import { trackValueText, intelValue, nextIntelGain } from '../core/intel.js';
import { bannersText } from '../core/groups.js';
import { slotNoun } from '../core/pack.js';
import { sightRange, searchesToFinish, searchesText } from '../core/map.js';
import { simCounts } from '../core/sim.js';
import { GRADE_ORDER } from '../core/processing.js';
import { formatClock, formatDuration, cap } from '../core/util.js';
import { VERSION } from '../version.js';

// ------------------------------------------------------------------ helpers ----
// "5 guesses x 5 test fights per enemy" for this game (base + Battle simulation intel + the best Foresight ring).
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

// "; elite 90%, champion 80% of the chance" for a { key: percent } multiplier table (empty when every value is 100).
function tierMultText(mult, what) {
  const bits = Object.entries(mult || {}).filter(([, v]) => v !== 100).map(([k, v]) => `${what === 'tier' ? k : `grade ${k}`} ${v}%`);
  return bits.length ? `; ${bits.join(', ')} of that` : '';
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

// Map distances worth listing: the longest straight walk on the map plus the detour a map may need.
function maxDistance(cfg) {
  return 2 * Math.floor(cfg.map.size / 2) + cfg.map.maxDetour;
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
  ['field', 'Fields, searching & sight', fieldSection],
  ['process', 'Workshop', workshopSection],
  ['gear', 'Gear, repairs & scrap', gearRepairSection],
  ['combat', 'Adventurer & combat', combatSection],
  ['enemies', 'Enemies', enemySection],
  ['banners', 'Banners', bannersSection],
  ['estimate', 'Win estimate', estimateSection],
  ['intel', 'Intel', intelSection],
  ['skills', 'Skills', skillSection],
  ['rings', 'Rings', ringSection],
  ['score', 'Score', scoreSection],
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
  const wear = cfg.gear.durabilityLoss;
  const tab = (id, label) => h('a', { href: '#', class: 'mi-link', onclick: (e) => { e.preventDefault(); ctx.setTab(id); } }, label);

  return h('section', { class: 'panel' },
    h('h3', {}, 'How to play'),
    h('p', {}, 'You are a miner and blacksmith. Your adventurer fights one enemy a day with the gear you make. ',
      h('b', {}, 'If the adventurer loses a fight, the run is over.'), ' Each win scores points and drops a ring. You see your score when the run ends (End run or a lost fight); see Score below.'),
    h('ol', { class: 'mi-steps' },
      h('li', {}, h('b', {}, `Work from ${formatClock(t.dayStartMin)} to ${formatClock(t.dayEndMin)} (${dayLen} minutes). `),
        'Only actions cost time. On the ', tab('map', 'Map'), ', travel to a field and search 3x3 areas for ore and gems. ',
        'Everything you find goes to that field\'s pile; when you leave you choose what to carry in your bag ',
        `(up to ${cfg.bag.slots} items, rarest first by default) and the rest stays in the pile for a later trip. `,
        `Debris (the number on a brown cell) is cleared by searching; boulders can never be searched. Field actions are only allowed while you can still walk back to camp by ${formatClock(t.dayEndMin)}. Arriving at camp unloads the bag into storage.`),
      h('li', {}, h('b', {}, 'At camp, use the '), tab('workshop', 'Workshop'), ': refine ore into bars, cut gems, smith gear from bars of one material and grade (optionally infusing a cut gem), and repair worn gear (it costs bars and time). Scrap gear you no longer need to get some bars back.'),
      h('li', {}, h('b', {}, 'End the day at camp. '), 'If the adventurer fought today you first see the battle report. Then plan tomorrow: pick 1 of ',
        `${rosterN} enemies (${rosterMix}; a new roster every day), pack up to ${cfg.plan.perSlot} items per gear type (more once your adventurer has captured pack mules, see Banners below), and choose up to ${cfg.rings.maxWorn} adventurer rings. `,
        'Plan ahead: ', h('b', {}, 'keep a spare of each item so you can leave one home to repair it'), '. Repairs happen by day, at camp, on gear the adventurer does not have.'),
      h('li', {}, h('b', {}, 'The next day the adventurer is away fighting. '),
        'When the fight starts it sees the enemy\'s real attributes and uses the best packed item for each slot. Packed gear cannot be repaired that day. ',
        `It comes back at the end of the day; every item that was used loses about ${p((wear.min + wear.max) / 2, 0)} durability (${wear.min}-${wear.max}% before the modifiers below), a little more against tougher enemies (${TIERS.map((t) => `${t} x${(wear.tierMult && wear.tierMult[t]) || 1}`).join(', ')}) and a little less with the ${cfg.skills.activity.gearCare ? cfg.skills.activity.gearCare.name : 'Gear care'} skill. At 0% it is destroyed.`),
      h('li', {}, h('b', {}, 'Day 1 is a rest day. '), 'From day 2 on there is a fight every day; it cannot be skipped.')),
    h('ul', { class: 'mi-list' },
      h('li', {}, 'Enemy attributes, reward rings and banners are partly hidden. Intel (1 point every ', String(cfg.intel.daysPerPoint), ' days, ', tab('skills', 'Skills & Intel'), ') raises the chance to see them. A point you can still spend must be spent before the next day starts.'),
      h('li', {}, 'Fights are automatic. Each side has an attack bar that fills (faster with more speed) and attacks when full; slows make the bar fill slower for a while, stuns stop it for a moment.'),
      h('li', {}, `Your win chance against every enemy is worked out by itself, on the plan screen and on the Adventurer tab: ${simSummary(ctx.state, cfg)}, shown in the win-estimate row of the comparison table. It is a small simulation, so it is a rough guide with some risk; Battle simulation intel and a Foresight ring make it bigger.`),
      h('li', {}, 'Wear rings on the ', tab('rings', 'Rings'), ' tab. Smith rings help you right away; adventurer rings are chosen for each fight.'),
      h('li', {}, 'Skills level up on their own as you work (', tab('skills', 'Skills & Intel'), '). Farther fields are richer but cost more travel time.'),
      h('li', {}, 'Every gem type is equally likely to be found. Cutting gets better with practice: the more you cut of a gem, the better its chances (Skills tab).'),
      h('li', {}, 'Grades are always listed from lowest to highest, left to right: ', OUTCOMES.map((g, i) => [i ? ' < ' : '', gradeSpan(g)]), ' (Fail is the lowest outcome).'),
      h('li', {}, 'In a field your sight shows some of the items still in the ground; it grows with Ore sight intel and Ore sight rings (on day 1 it is too low to see anything).'),
      h('li', {}, 'To stop playing before a loss, press End run in the top bar: the adventurer retires and the run is scored like a lost fight would be.')),
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
      ['Travel', `${mins(cfg.map.travelMinPerStep)} per map step, +${p(cfg.map.loadPenaltyPerItem)} per item you carry (the Carrying skill lowers the extra)`],
      ['Search a 3x3 area', `${mins(cfg.field.searchMin)}${cfg.field.freshCellMin > 0 ? ` + ${mins(cfg.field.freshCellMin)} for each fresh (never-searched) cell in the area` : ''} (also clears debris: no separate action)`],
      ['Refine a bar', byMinutes(cfg.refine)],
      ['Cut a gem', byMinutes(cfg.cut)],
      ['Smith gear', `${mins(g.smithMinPerBar)} per bar (${SLOTS.map((s) => `${s} ${mins(craftMinutes(s, false, cfg))}`).join(', ')}), +${mins(g.infuseMin)} to infuse a gem; the bar type's Smithing skill makes it faster`],
      ['Repair gear', `${p(g.repair.timeFraction)} of the smithing time x fraction repaired, by day at camp; the repair skills make it faster`],
      ['Scrap gear', 'no time'],
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
      ['Map', `${m.size} x ${m.size} map cells, camp in the center. ${m.blockedCells} cells are blocked (impassable); every field stays reachable, and a map is made again when the rocks force a field more than ${m.maxDetour} steps farther than the straight walk.`],
      ['Travel time', formula(`steps x ${m.travelMinPerStep}m x (1 + ${m.loadPenaltyPerItem}% x items carried)`, 'Steps = shortest path around blocked cells. You can travel field to field.')],
      ['Bag', `${cfg.bag.slots} slots, 1 raw ore or gem per slot. You choose what to carry each time you leave a field. A full bag adds ${p(m.loadPenaltyPerItem * cfg.bag.slots)} travel time. Camp storage is unlimited.`],
      ['Bonuses', `Travel rings and the Travel skill reduce every trip; the Carrying skill reduces the extra time per carried item. Total capped at ${p(cfg.processing.maxTimeReduction)}.`],
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
  const da = f.debrisAmount;
  const finishText = searchesText(searchesToFinish(effLo, effHi)); // base numbers, like the rest of Help (no bonuses)
  const debrisSkill = cfg.skills.activity.debris;
  const rows = f.byDistance;
  const last = rows.length;
  const boulders = rows.map((r) => r.boulders);
  const boulderText = Math.min(...boulders) === Math.max(...boulders) ? String(boulders[0]) : `${Math.min(...boulders)}-${Math.max(...boulders)} (more far from camp)`;
  // Searches needed to clear `t` debris at base power (each cell rolls effLo..effHi effort).
  const clearSearches = (t) => {
    if (effLo <= 0) return 'many searches';
    const a = Math.ceil(t / effHi - 1e-9);
    const b = Math.ceil(t / effLo - 1e-9);
    return `${a === b ? a : `${a}-${b}`} search${b === 1 ? '' : 'es'}`;
  };
  const lootRows = rows.map((r, i) => {
    const deb = Math.min(100, r.loot + f.debrisLootBonus);
    const perCell = ((1 - f.debrisChance / 100) * r.loot + (f.debrisChance / 100) * deb) / 100;
    const items = Math.max(0, cells - r.boulders) * perCell * avg;
    return [i === last - 1 ? `${i + 1}+` : String(i + 1), np(r.loot), np(deb), n(r.boulders, 0), n(items, 0), n(items * (1 - r.gemShare / 100), 0), n(items * (r.gemShare / 100), 0)];
  });
  const oreKeys = Object.keys(rows[0].ores);
  const oreTable = tbl(['Distance', ...oreKeys.map((k) => ({ v: cap(k), cls: 'num' })), { v: 'Gems', cls: 'num' }],
    rows.map((r, i) => {
      const pc = toPct(r.ores);
      return [i === last - 1 ? `${i + 1}+` : String(i + 1),
        ...oreKeys.map((k) => { const v = (pc[k] * (100 - r.gemShare)) / 100; return v > 0 ? np(v, 0) : { v: '·', cls: 'num muted' }; }),
        np(r.gemShare, 0)];
    }));
  const sightKeys = Object.keys(f.sight);
  const sightRows = sightKeys.map((k) => {
    const [lo, hi] = sightRange(k === 'gem' ? 'gem:ruby' : `ore:${k}`, cfg);
    return [h('b', {}, k === 'gem' ? 'Every gem' : cap(k)), { v: `${lo + 1}-${hi}`, cls: 'num' }];
  });
  const oreSight = cfg.intel.tracks.oreSight;
  return [
    kv([
      ['Field', `${f.size} x ${f.size} = ${cells} cells, drawn as ${(f.size / 3) ** 2} plots of 3x3 cells (the centre cell of each plot is a good place to search). Contents are hidden, except what your sight shows.`],
      f.freshCellMin > 0 ? ['Fresh cells', `A cell is fresh until a search works on it (clears some of its debris or searches it). Each fresh cell in the 3x3 area adds ${mins(f.freshCellMin)} to that search, so a search of an all-fresh area takes ${mins(f.searchMin)} + 9 x ${mins(f.freshCellMin)} = ${mins(f.searchMin + f.freshCellMin * 9)}, and finishing an area before moving on keeps searches near ${mins(f.searchMin)}. Search-time reductions (rings, skill) apply to the total. Fresh cells are marked with a small dot on the map; a boulder is never fresh.`] : null,
      ['Search', rnd > 0
        ? `A 3x3 area takes ${mins(f.searchMin)}${f.freshCellMin > 0 ? ` plus ${mins(f.freshCellMin)} per fresh cell` : ''}. Each search adds ${p(f.searchEfficiency)} ± ${num(rnd)} "searched" to every cell in the area: each cell rolls its own amount (${p(effLo)}-${p(effHi)}), so about ${finishText} searches finish a cell.`
        : `A 3x3 area takes ${mins(f.searchMin)}${f.freshCellMin > 0 ? ` plus ${mins(f.freshCellMin)} per fresh cell` : ''}. Each search adds ${p(f.searchEfficiency)} "searched" to every cell in the area, so about ${finishText} searches finish a cell.`],
      ['Search efficiency', `${cfg.rings.types.searchEff ? `${cfg.rings.types.searchEff.name} rings` : 'Rings'} and the ${cfg.skills.activity.searchEff ? cfg.skills.activity.searchEff.name : 'search efficiency'} skill raise the average: average = ${p(f.searchEfficiency)} x (1 + bonus %).${rnd > 0 ? ` The ± ${num(rnd)} spread per cell stays the same.` : ''} The Map shows your current range.`],
      ['Hidden depth', 'Each item has a hidden depth from 0 to 100. It is found once the cell\'s searched % passes its depth. A fully searched cell gives up everything.'],
      ['Sight', `In the field you stand in you see the items still in the ground whose sight threshold is at most your sight (a tag on the cell; nothing else about the ground is shown). Sight = ${oreSight.name} intel (starts at ${num(oreSight.base, 0)}) + ${cfg.rings.types.reveal.name} rings. Sight sees through debris. Each item rolls its threshold when the field is made; rarer items roll higher, so they need more sight:`],
    ]),
    tbl(['Item', { v: 'Sight needed', cls: 'num' }], sightRows),
    kv([
      ['Debris', `${p(f.debrisChance)} of cells, ${num(da.min)}-${num(da.max)} thick (in search effort; the number on the cell is what is left). There is no separate clear action: searching a debris cell spends that cell's effort roll (${p(f.searchEfficiency)} ± ${num(rnd)}) x debris clearing power (1 + ${debrisSkill ? debrisSkill.name : 'debris'} skill %) on the debris first; any effort left over searches the cell in the same search. At base power a ${num(da.min)}-thick cell takes ${clearSearches(da.min)} to clear, a ${num(da.max)}-thick one ${clearSearches(da.max)}. Debris cells are +${f.debrisLootBonus} points more likely to hold items.`],
      debrisSkill ? ['Debris clearing skill', `+${num(debrisSkill.effects.debrisClear, 2)}% debris cleared per search per level. XP: ${num(debrisSkill.xp)} per ${debrisSkill.xpUnit}.`] : null,
      ['Boulders', `${boulderText} cell${boulderText === '1' ? '' : 's'} per field (a dark rock): can never be cleared or searched and hold nothing. They do not count toward a field's searched %.`],
      ['Items per loot cell', `${Object.entries(countPct).map(([k, v]) => `${k} (${p(v, 0)})`).join(', ')}, average ${num(avg, 2)}`],
      ['Ores vs gems', `The share of gems among the items rises with distance, from ${p(rows[0].gemShare, 0)} to ${p(rows[last - 1].gemShare, 0)}; every gem type is equally likely.`],
      ['Field pile', `Everything you find goes to that field's pile (no limit; it stays there for the rest of the run, and the map shows how many items each field's pile holds). In the field you can move single items between your bag and the pile for free.`],
      ['Carrying', `When you leave a field you choose what to carry: up to ${cfg.bag.slots} items from your bag and the pile. Default "Rarest first": keep your bag and fill the free slots with the rarest items (mythril, then diamond, emerald, sapphire, topaz, ruby, coal, iron, copper). The rest stays in the pile.`],
    ]),
    sub('Richness by distance from camp'),
    tbl(['Distance', { v: 'Cell has items', cls: 'num' }, { v: 'Debris cell', cls: 'num' }, { v: 'Boulders', cls: 'num' }, { v: '≈ items / field', cls: 'num' }, { v: '≈ ores', cls: 'num' }, { v: '≈ gems', cls: 'num' }], lootRows),
    h('p', { class: 'mi-note' }, `Item estimates = the cells that are not boulders x average chance (incl. debris) x ${num(avg, 2)} items. Fields farther than ${last} steps use the distance-${last} row.`),
    sub('What the items are (% of the items found at that distance)'),
    oreTable,
  ];
}

// ---------------------------------------------------------------- workshop ----
// What the Workshop does and how its numbers work. The cutting chances are not listed here: the Workshop shows your
// current chances for every gem (and a hover has the starting ones), and the Skills tab explains how practice improves them.
function workshopSection(cfg) {
  const distCells = (dist) => OUTCOMES.map((g) => (dist[g] > 0 ? np(dist[g], 0) : { v: '·', cls: 'num muted' }));
  const outHead = () => OUTCOMES.map((g) => ({ v: gradeSpan(g), cls: 'num' })); // fresh nodes per table
  const sk = cfg.skills;
  const gemLuck = cfg.rings.types.gemGrade;
  const barLuck = cfg.rings.types.oreGrade;
  const barRows = BARS.map((b) => {
    const r = cfg.refine[b];
    return [h('b', {}, cap(b)), Object.entries(r.input).map(([o, k]) => `${k} ${o}`).join(' + '), n(r.minutes), ...distCells(r.dist)];
  });
  const gemRows = GEMS.map((g) => [h('b', {}, cap(g)), `1 raw ${g}`, n(cfg.cut[g].minutes)]);
  return [
    kv([
      ['Storage and gear', 'The top of the Workshop lists what you own: raw ores, bars by grade, gems (raw, cut by grade, and how many pieces of gear carry each) and a table of your gear by type and material with a tag for each gem, so you can see what to make next. Click a cell of the gear table or a gem to pick it in the smith form.'],
      ['Refining', 'Each bar rolls a grade from D (lowest) to S (highest). On a fail the ore is lost. The Workshop shows your chances now (rings and skills included); point at them for the starting chances. "Time each" is next to the buttons.'],
      ['Cutting', 'Each cut gem rolls a grade from D to S. On a fail the gem is lost. You get better the more you cut of each gem: its Grade skill raises the chance of better grades, its Cutting skill lowers the failure chance, and General cutting helps every gem a little.'],
      ['Result box', 'The message under a table is green when everything worked and red when any attempt failed (for example "2 of 5 failed").'],
      ['Smithing', 'Pick a gear type, a material, a bar grade and, if you like, a gem and its grade, then press Craft. All bars in one item are the same material and grade. A new item always starts at 100% durability.'],
    ]),
    sub('Refining: starting chances by bar (%)'),
    tbl(['Bar', 'Needs', { v: 'Minutes', cls: 'num' }, ...outHead()], barRows),
    sub('Cutting: time per gem'),
    tbl(['Gem', 'Needs', { v: 'Minutes', cls: 'num' }], gemRows),
    h('ul', { class: 'mi-list' },
      h('li', {}, 'Grades read from lowest (left) to highest (right). Fail = the material is lost.'),
      h('li', {}, 'Time: Refining rings (refining and cutting) and the General refining / General cutting skills, capped at ', p(cfg.processing.maxTimeReduction), '.'),
      h('li', {}, `Bars: ${barLuck ? `${barLuck.name} rings` : 'Rings'} and the bar grade skill give each successful bar a chance to go up one grade (S stays S). Failure chance is lowered by the bar type's refining skill and by General refining (every bar).`),
      h('li', {}, `Gems: ${gemLuck ? `${gemLuck.name} rings` : 'gem luck rings'} give each successful cut a chance to go up one grade, on top of the gem's own skills.`),
      sk.activity.refineTime ? h('li', {}, `${sk.activity.refineTime.name} and ${sk.activity.cutTime.name} help every material a little; the skills of one bar or gem type count far more for that material (Skills).`) : null),
  ];
}

// ----------------------------------------------------- gear, repairs & scrap ----
function gearRepairSection(cfg) {
  return [sub('Gear'), ...gearSection(cfg), sub('Gem infusions'), ...gemSection(cfg), sub('Durability, repair & scrap'), ...repairSection(cfg)];
}

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
      ['Materials overlap', 'The grades of one material reach into the next: a top-grade (S) piece of one material is a little better than a plain (D) piece of the next, but not as good as its C. A plain piece of a better material always beats a good piece of a worse one up to grade A.'],
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
      h('li', {}, 'Diamond: piercing (% of enemy defense ignored) / pierce resistance (% of enemy piercing ignored).'),
      h('li', {}, 'Bring the right gem: armor with a gem that answers an enemy\'s High special (ruby for Magical, diamond for Piercing, topaz for Stunning, sapphire for Chilling) beats emerald armor against that enemy, while emerald armor is the better choice against an enemy without that special. A sword gem is blunted by the matching High resistance of the enemy.')),
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
  return [...adventurerSection(cfg), ...combatDetails(cfg)];
}

function combatDetails(cfg) {
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
      `Base interval: adventurer ${num(a.attackInterval, 2)}s, enemies ${num(cfg.enemies.attackInterval, 2)}s.${c.startFillMax > 0 ? ` Both attack bars start the fight partly filled (a random 0-${p(c.startFillMax, 0)} each), so who strikes first is luck.` : ''} If both bars are full at the same moment, the adventurer attacks first.`),
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
      ['Gear choice', `When the fight starts the adventurer tries the combinations of packed gear (${num(c.bestGearFights, 0)} simulated fights each) and uses the best. An item that another packed item of the same type beats in every stat is skipped; if more than ${cfg.sim.maxExactCombos} combinations are left, it improves one gear type at a time instead.`],
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
      LEVELS.map((lv) => d.levels[lv]).join(' / '),
      Object.entries(ringPct).filter(([, v]) => v > 0).map(([g, v]) => `${g} ${p(v, 0)}`).join(', ')];
  });
  // One row per pair: offense on the left, its matching defense on the right. A value of 0 (Low specials and
  // resistances) reads "none": the enemy does not have it.
  const lvCells = (a, key) => LEVELS.map((lv) => ({ v: a.values[lv] === 0 && key !== 'fast' ? 'none' : num(a.values[lv], 2), cls: `num attr-${lv}` })); // Fast 0 is a normal speed, not a missing ability
  const attrRows = e.pairs.map(([o, d]) => {
    const ao = e.attributes[o];
    const ad = e.attributes[d];
    return [h('b', {}, ao.name), ...lvCells(ao, o), ao.desc, h('b', {}, ad.name), ...lvCells(ad, d), ad.desc];
  });
  const rosterN = TIERS.reduce((a, t) => a + e.tiers[t].count, 0);
  return [
    kv([
      ['Roster', `${rosterN} enemies each day (${TIERS.map((t) => `${e.tiers[t].count} ${t}`).join(', ')}). You pick one for tomorrow.`],
      ['Attack bar', `fills in ${num(e.attackInterval, 2)}s at 0% speed (the Fast attribute changes speed)`],
      ['Stun / slow', `An enemy stun stops your attack bar for ${num(e.stunDuration, 2)}s; a Chilling hit makes your bar fill slower (by its Chilling %) for ${num(e.slowDuration, 2)}s. Both before your resistances; neither stacks.`],
      ['Getting stronger', 'Enemies get a little stronger every day.'],
      ['Attributes', `${Object.keys(e.attributes).length} attributes, each Low / Normal / High, assigned at random to match the tier's counts. Each one is visible with your Enemy scouting chance (${p(cfg.intel.tracks.enemySight.base, 0)} base${tierMultText(cfg.intel.tracks.enemySight.tierMult, 'tier')}).`],
      ['Low', 'Low means the enemy does not have that ability at all (shown as none): a Low Magical enemy deals no magic damage, a Low Chilling enemy never slows you, a Low resistance resists nothing. Accurate, Evasion, Fast and HP are core stats and only move a little between levels.'],
    ]),
    sub('Tiers (base values on day 1; enemies grow stronger every day)'),
    tbl(['Tier', { v: 'Per roster', cls: 'num' }, { v: 'HP', cls: 'num' }, { v: 'Damage', cls: 'num' }, { v: 'Defense', cls: 'num' }, 'Low / Normal / High', 'Ring grade odds'], tierRows),
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
      ['Wearing', `Smith and adventurer each wear up to ${r.maxWorn} rings. Smith rings apply at once and can be swapped at the start of a day (before your first action) or while you plan the next fight; adventurer rings are chosen in the plan before each fight.`],
      ['Stacking', `Same type, best first: ${weights.join(', ')}, ... (each extra ring counts ${x(r.duplicateFactor)} the previous one).${types.some(([, d]) => d.stack === false) ? ` Exception: ${types.filter(([, d]) => d.stack === false).map(([, d]) => d.name).join(', ')} counts only your best ring.` : ''}`],
      r.types.foresight ? [r.types.foresight.name, `A smith ring: your best Foresight ring adds ${r.types.foresight.values.map((v) => `+${v}`).join(' / ')} (${GRADES.join(' / ')}) guesses AND test fights per enemy to the plan screen's win-chance estimate.${r.types.foresight.stack === false ? ' Only your best Foresight ring counts; more of them add nothing.' : ''}${r.types.foresight.values.some((v, i) => i && v === r.types.foresight.values[i - 1]) ? ' Guesses and test fights come in whole numbers, so some neighbouring grades give the same.' : ''} It does nothing in the fight itself.`] : null,
    ]),
    tbl(['Ring', 'Wearer', ...gradeHead(), 'Effect'], typeRows),
    sub('Ring grade odds by enemy tier'),
    tbl(['Tier', ...gradeHead()], oddsRows),
  ];
}

// ------------------------------------------------------------------ skills ----
function skillSection(cfg) {
  const s = cfg.skills;
  let total = 0;
  for (let l = 0; l < s.maxLevel; l++) total += xpToNext(l, cfg);
  const defs = skillDefs(cfg);
  // What one level of a skill gives, e.g. "0.6% less travel time"
  const levelGain = (effects) => Object.entries(effects).map(([e, v]) => `${num(v, 2)}${s.effects[e].unit === 'pts' ? ' points' : '%'} ${s.effects[e].text}`).join('; ');
  const xpRange = (mats) => {
    const xs = mats.map((m) => itemXp(m, cfg));
    const lo = Math.min(...xs);
    const hi = Math.max(...xs);
    return lo === hi ? num(lo) : `${num(lo)}-${num(hi)}`;
  };
  const actRows = defs.filter((d) => !d.material).map((d) => [h('b', {}, d.name), levelGain(d.effects), `${num(xpPerUnit(d, cfg))} per ${d.xpUnit}`]);
  const matRows = Object.entries(s.perMaterial).map(([k, d]) => {
    const mats = d.materials === 'bars' ? BARS : GEMS;
    return [h('b', {}, `${d.materials === 'bars' ? 'Bar' : 'Gem'} ${d.label.replace(/^bar /, '')}`), levelGain(d.effects),
      d.xp !== undefined ? `${num(d.xp)} per ${d.xpUnit}` : `${xpRange(mats)} per ${d.xpUnit} (by material, table below)`];
  });
  // XP per item by material, and how many items one skill needs to reach its highest level.
  const xpTable = (mats, what) => tbl([what, { v: 'XP per item', cls: 'num' }, { v: 'Items for the highest level', cls: 'num' }],
    mats.map((m) => {
      const xp = itemXp(m, cfg);
      return [h('b', {}, cap(m)), n(xp, 0), xp > 0 ? n(Math.ceil(total / xp), 0) : { v: '·', cls: 'num muted' }];
    }));
  return [
    kv([
      ['Levels', 'Skills level up automatically from doing the activity. Point at (or tap) a skill on the Skills & Intel tab for what it gives now, what the next level gives and how to earn XP.'],
      ['XP per level', formula(`XP for level L → L+1 = ${s.xpBase} x (L + 1)`, 'Each level needs a little more XP than the one before.')],
      ['Who it works for', `Skills of an activity (Travel, Carrying, searching, General refining / cutting / repair, Gear care) work for every material. The skills of one bar type or gem type only work for that material, and count far more than the general ones: for example a bar type\'s own refining skill removes ${num(s.perMaterial.oreFail.effects.refineFail / s.activity.refineTime.effects.refineFail, 2)} times the failure chance that General refining does.`],
      ['Bonuses', `Skill bonuses add to the matching smith ring bonuses; time reductions from rings and skills together are capped at ${p(cfg.processing.maxTimeReduction)}.`],
    ]),
    sub('Skills of an activity'),
    tbl(['Skill', 'Per level', 'XP'], actRows),
    sub('Skills of one bar type or gem type (one of each per material)'),
    tbl(['Skill', 'Per level', 'XP'], matRows),
    sub('Per-material XP (rarer materials give more; failed attempts count)'),
    h('div', { class: 'mi-two' },
      h('div', {}, xpTable(BARS, 'Bar refined')),
      h('div', {}, xpTable(GEMS, 'Gem cut'))),
    h('p', { class: 'mi-note' }, 'Each refined bar gives this XP to both refining skills of that bar type (grade and refining); each bar smithed into gear gives it to that bar type\'s Smithing skill; each cut gem gives it to both skills of that gem.'),
    h('ul', { class: 'mi-list' },
      s.activity.debris ? h('li', {}, `${s.activity.debris.name}: debris is cleared by searching (see Fields & searching).`) : null,
      h('li', {}, `Gem grade has no ring; Gem luck rings add upgrade chances on top (see Refining & cutting).`),
      s.activity.carrying ? h('li', {}, `${s.activity.carrying.name}: ${effectText('loadPenalty', s.activity.carrying.effects.loadPenalty, cfg)} for the first level (the Skills tab shows your current penalty).`) : null),
  ];
}

// ----------------------------------------------------------------- banners ----
function bannersSection(cfg) {
  const g = cfg.groups;
  const max = SLOTS.length * g.maxExtraPerType;
  return [
    h('p', { class: 'mi-note' }, bannersText(cfg)),
    kv([
      ['Banner', 'Random for each enemy. It has no effect on the enemy\'s attributes, and it is not tied to its name.'],
      ['Banner scouting', `Intel track: ${trackValueText('groupSight', cfg.intel.tracks.groupSight.base, cfg)} to start with, up to ${trackValueText('groupSight', cfg.intel.tracks.groupSight.max, cfg)}. The battle report always shows the banner.`],
      ['Pack mules', `Every ${g.defeatsPerReward} wins against the banner your adventurer has beaten most: 1 more item of one gear type (${SLOTS.map((s) => slotNoun(s, 2)).join(', ')}) can be packed from then on, up to ${max} pack mules in all. Wins over different banners do not add up, and a draw or a loss counts for nothing. A pack mule is never taken back.`],
      ['Packing', `Without pack mules the adventurer can pack ${cfg.plan.perSlot} items of each gear type. The plan screen's gear step shows the limit per type.`],
    ]),
  ];
}

// ------------------------------------------------------------------- intel ----
function intelSection(cfg, ctx) {
  const ic = cfg.intel;
  const st = ctx.state;
  const trackRows = Object.entries(ic.tracks).map(([k, t]) => {
    const gain = nextIntelGain(st, k, cfg);
    return [h('b', {}, t.name), { v: trackValueText(k, intelValue(st, k, cfg), cfg), cls: 'num' }, { v: gain > 0 ? `+${trackValueText(k, gain, cfg).replace(/^\+/, '')}` : 'maxed', cls: 'num' }, t.desc];
  });
  const sd = ic.tracks.simDepth;
  return [
    kv([
      ['Earning', `1 intel point at the end of every ${ordinal(ic.daysPerPoint)} day (day ${ic.daysPerPoint}, ${ic.daysPerPoint * 2}, ${ic.daysPerPoint * 3}, ...).`],
      ['Spending', 'Each point raises one track. Every track has its own steps, and the steps get smaller as you spend more on the same track. The table below shows each track now and what the next point adds. A point that can still raise a track must be spent before the next day can start (the plan screen has the buttons at the top).'],
      ['Elites and champions', `Enemy scouting counts for less against tougher enemies${tierMultText(ic.tracks.enemySight.tierMult, 'tier') ? `: ${tierMultText(ic.tracks.enemySight.tierMult, 'tier').replace(/^; /, '')}` : ''}. Ring grade scouting counts for less against better ring grades${tierMultText(ic.tracks.ringGradeSight.gradeMult, 'grade') ? `: ${tierMultText(ic.tracks.ringGradeSight.gradeMult, 'grade').replace(/^; /, '')}` : ''}.`],
      ['Banner scouting', `The chance to see which banner an enemy marches under (see Banners). Starts at ${trackValueText('groupSight', ic.tracks.groupSight.base, cfg)}.`],
      ['Ore sight', 'Your sight in the fields (see Fields, searching & sight). Ore sight rings add to it.'],
      ['Battle simulation', `Not a chance: its value is the number of extra guesses and extra test fights per enemy in the win estimate (see Win estimate). Each point gives +${sd.gains[0]}, up to +${sd.max}; every extra guess and fight also makes the estimate slower to run.`],
    ]),
    tbl(['Track', { v: 'Now', cls: 'num' }, { v: 'Next point', cls: 'num' }, 'What it does'], trackRows),
  ];
}

// ---------------------------------------------------------------- estimate ----
function estimateSection(cfg, ctx) {
  const o = cfg.sim;
  const sd = cfg.intel.tracks.simDepth;
  return [
    kv([
      ['Always on', `Your win chance against every enemy is worked out by itself, on the plan screen and on the Adventurer tab (the Win estimate row of the comparison table). Right now it is ${simSummary(ctx.state, cfg)}.`],
      ['How', `For each enemy: ${o.samples} guesses of the hidden attributes (respecting the tier's Low / Normal / High counts) x ${o.evalFights} test fights each, after the adventurer has picked its gear with ${o.fightsPerLoadout} fights per combination. That is ${o.samples * o.evalFights} fights per enemy. Draws count as survival.`],
      ['The ±', 'Every estimate shows a ± (for example 62% ± 14): how far the test fights alone could be off. At 100% it can only be lower and at 0% only higher, so those read like 100% (−14) and 0% (+10). Hidden attributes can make the real chance higher or lower. Even 25 wins out of 25 shows a ±, because a few test fights can never be sure.'],
      ['A risk you take', 'The estimate is small on purpose: it is a rough guide, not a promise, and a lost fight ends the run. The plan shows the estimate it was made with, and the battle report reminds you of it.'],
      ['Making it steadier', `The Battle simulation intel track adds its value as extra guesses AND extra test fights per enemy (+${sd.gains[0]} per point, up to +${sd.max}), and your best Foresight smith ring adds more of each (only the best one counts).`],
      ['Gear', `The estimate uses the gear and rings chosen on the plan screen. On the Adventurer tab it uses your best gear (the best item of each gear type) and the rings the adventurer wears; you choose the gear when you plan. If more than ${o.maxExactCombos} gear combinations are packed, the adventurer improves one gear type at a time instead of trying them all.`],
    ]),
  ];
}

// ------------------------------------------------------------------- score ----
function scoreSection() {
  return [
    kv([
      ['When you see it', 'You see your score when the run ends (End run or a lost fight). There is no running score while you play, and no points are shown for any enemy.'],
      ['How it works', 'Each win adds points for the enemy\'s tier: tougher tiers are worth more. Draws and losses add nothing, and every win drops a ring. Every day alive is another chance to win.'],
      ['End run', 'The End run button in the top bar retires the adventurer and scores the run exactly like a lost fight would. A fight planned for today does not happen. You cannot continue the run afterwards.'],
      ['Run summary', 'The run summary shows the score, the days survived, the fights won and your best score for this version. It lists the wins and points of each tier, and after a lost fight it replays the fight to show what went wrong and whether gear you left at home would have helped.'],
    ]),
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
    const scrapNew = scrapReturn({ slot: s, material: 'x', grade: GRADES[0], durability: 100 }, cfg).qty;
    const scrapOld = scrapReturn({ slot: s, material: 'x', grade: GRADES[0], durability: 50 }, cfg).qty;
    return [h('b', {}, cap(s)), n(g.slots[s].bars, 0), { v: `${fmtBars(full.bars)} bars`, cls: 'num' }, { v: mins(full.baseMinutes), cls: 'num' },
      { v: `${fmtBars(one.bars)} bars`, cls: 'num' }, { v: mins(one.baseMinutes), cls: 'num' },
      { v: `${num(scrapNew, 2)} bars`, cls: 'num' }, { v: `${num(scrapOld, 2)} bars`, cls: 'num' }];
  });
  const tierMult = loss.tierMult || {};
  const wearRows = TIERS.map((t) => {
    const m = tierMult[t] || 1;
    const lo = wearLoss(loss.min, m);
    const hi = wearLoss(loss.max, m);
    return [h('span', { class: `tier-${t}` }, cap(t)), { v: `x${num(m, 2)}`, cls: 'num' }, { v: `${Math.floor(lo + 1e-9)}-${Math.ceil(hi - 1e-9)}%`, cls: 'num' }, { v: p(avgLoss * m, 0), cls: 'num' }];
  });
  const gemFull = repairInfo({ slot: 'chest', material: 'x', grade: GRADES[0], gem: { type: 'gem', grade: GRADES[0] }, durability: 0 }, cfg);
  const gemExtra = Object.values(gemFull.gems)[0] || 0;
  return [
    kv([
      ['Wear', `Each fight, every item the adventurer actually used loses a durability roll of ${loss.min}-${loss.max}% (average ${num(avgLoss, 0)}%), times the enemy tier's multiplier (${TIERS.map((t) => `${t} x${(loss.tierMult && loss.tierMult[t]) || 1}`).join(', ')}), times (1 - Gear care %). The game keeps one decimal inside so every Gear care level counts, and the loss is at least 1%; durability is always shown as a whole number (rounded down, never 0% while the item exists). Packed but unused items do not wear. An item always lasts the whole fight it is used in; at 0% afterwards it is destroyed.`],
      cfg.skills.activity.gearCare ? [cfg.skills.activity.gearCare.name, `Skill: ${num(cfg.skills.activity.gearCare.effects.wear, 2)}% less wear per level. It earns ${cfg.skills.activity.gearCare.xp} XP for every fight the adventurer survives (win or draw), so it grows as you win.`] : null,
      ['Repair', 'Only back to 100%, only by day, at camp (Workshop), and only on gear the adventurer does not have: it is away when packed. It costs bars and time. Keep a spare of each item so you can leave one home to repair it.'],
      ['Cost', formula(`${g.repair.materialFraction}% x original bars (and ${g.repair.gemFraction}% x its gem) x fraction repaired`, 'Same material and grade as the item; rounded up to 0.01. If you do not have enough of that grade, the lowest higher grade you have enough of is used instead, with a warning: no extra benefit, the item keeps its own grade.')],
      ['Time', formula(`${g.repair.timeFraction}% x smithing time x fraction repaired, less your repair skills`, `Each bar type's Repair skill cuts the time of gear of that bar type by ${num(cfg.skills.perMaterial.repair.effects.repairTime, 2)}% per level, its Smithing skill by ${num(cfg.skills.perMaterial.smith.effects.repairTime, 2)}%, General repair by ${num(cfg.skills.activity.repairTime.effects.repairTime, 2)}% (all gear). The total is capped at ${p(cfg.processing.maxTimeReduction)}. Repairs must finish by ${formatClock(cfg.time.dayEndMin)}.`)],
      ['With a gem', `Also costs ${num(gemExtra, 2)} of the same cut gem for a full repair (scaled the same way) and the infusion time counts in the repair time.`],
      ['Scrap', formula(`${g.repair.materialFraction}% x original bars x durability`, 'Destroys the item and gives back bars of its material and grade, rounded down to 0.01; the gem is lost. It takes no time, and the Workshop shows what you get before you confirm. Repairing an item just to scrap it never pays.')],
    ]),
    sub('Wear per fight by enemy tier (before Gear care)'),
    tbl(['Enemy tier', { v: 'Multiplier', cls: 'num' }, { v: 'Loss per used item', cls: 'num' }, { v: 'Average', cls: 'num' }], wearRows),
    sub('Repair cost and scrap return by slot (item without a gem; base times before the repair skills)'),
    tbl(['Slot', { v: 'Bars', cls: 'num' }, { v: 'Full repair (0→100%)', cls: 'num' }, { v: 'Time', cls: 'num' }, { v: `After an average fight (−${num(avgLoss, 0)}%)`, cls: 'num' }, { v: 'Time', cls: 'num' }, { v: 'Scrap at 100%', cls: 'num' }, { v: 'Scrap at 50%', cls: 'num' }], rows),
  ];
}
