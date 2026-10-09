// Adventurer tab: today's fight, owned gear, adventurer stats and rings, tomorrow's roster.
// The only game action here is a gear repair (the Repair button of the shared gear list, ui/gearlist.js, through ctx.act);
// the other shared widgets come from endday.js.
import { h, section } from './dom.js';
import { SLOTS } from '../config.js';
import { adventurerCombatant } from '../core/combat.js';
import { adventurerRingTotals } from '../core/game.js';
import { wornRings, ringContributions, ringDef, ringValue } from '../core/rings.js';
import { intelValue, trackValueText } from '../core/intel.js';
import { defaultPack } from '../core/pack.js';
import { bannerLabel } from '../core/groups.js';
import { groupVisible } from '../core/enemies.js';
import { cap } from '../core/util.js';
import { durText, winText, planEstimateText, enemySightText } from './present.js';
import { scheduleEstimates, cachedEstimate, estimatesPending } from './estimates.js';
import { gearTable } from './gearlist.js';
import { enemyCard, rosterTable, bannersNote, gearNameNode, wearRange, wearText, bestPerSlot, combatStatsTable, ringNameNode } from './endday.js';

const f2 = (v) => String(Math.round(v * 100) / 100);

export function renderAdventurer(root, ctx) {
  root.append(h('div', { class: 'adv' },
    todayPanel(ctx),
    h('div', { class: 'cols' }, gearPanel(ctx), statsPanel(ctx)),
    rosterPanel(ctx)));
}

function todayPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  if (s.plan) {
    const e = s.plan.enemy;
    const packed = s.gear.filter((g) => s.plan.gearIds.includes(g.id));
    const rings = s.rings.filter((r) => s.plan.ringIds.includes(r.id));
    const bySlot = SLOTS.map((slot) => {
      const items = packed.filter((g) => g.slot === slot);
      return h('tr', {},
        h('td', {}, cap(slot)),
        h('td', {}, items.length ? items.map((g, i) => [i ? ', ' : '', gearNameNode(g), h('span', { class: 'muted' }, ` (${durText(g.durability)})`)]) : h('span', { class: 'muted' }, slot === 'sword' ? 'none (unarmed)' : 'none')));
    });
    return section(`Today (day ${s.day}): fighting ${e.name}`,
      h('p', { class: 'adv-tight' }, 'The adventurer is away fighting ', h('b', {}, e.name), ' ', h('span', { class: `tier-${e.tier}` }, `(${e.tier})`),
        '. The result comes in when you end the day. The packed gear is away and can\'t be repaired today.'),
      h('p', { class: 'adv-tight muted adv-small' },
        groupVisible(s, e, cfg) && cfg.groups.list[e.group] ? ['Banner: ', h('b', { class: `bn bn-${e.group}` }, bannerLabel(e.group, cfg)), '. '] : 'Banner: unknown (the battle report shows it). ',
        s.plan.shownEstimate ? `Your plan showed ${planEstimateText(s.plan.shownEstimate)}.` : 'Your plan had no finished win estimate.'),
      h('div', { class: 'cols' },
        enemyCard(ctx, e),
        h('div', {},
          h('h4', { class: 'adv-h4' }, `Packed gear (${packed.length})`),
          h('table', { class: 'adv-stats' }, h('tbody', {}, bySlot)),
          h('p', { class: 'muted adv-small' }, 'The adventurer will use the best packed item per slot once the enemy is known.'),
          h('h4', { class: 'adv-h4' }, `Rings (${rings.length}/${cfg.rings.maxWorn})`),
          rings.length ? h('div', { class: 'chips' }, rings.map((r) => h('span', { class: 'chip' }, ringNameNode(r, cfg)))) : h('p', { class: 'muted adv-small' }, 'No rings.'))));
  }
  if (s.day === 1) {
    return section('Today (day 1)',
      h('p', { class: 'adv-tight' }, 'Your adventurer ', h('b', {}, 'rests today'), '. Gather ore and smith gear; at the end of the day you pick tomorrow\'s fight from the roster below.'));
  }
  return section(`Today (day ${s.day})`, h('p', { class: 'adv-tight muted' }, 'No fight today.'));
}

function gearPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  if (!s.gear.length) {
    return section('Gear',
      h('p', { class: 'muted' }, 'No gear yet. Smith some in the Workshop: the adventurer fights unarmed without it.'),
      h('button', { class: 'small', onclick: () => ctx.setTab('workshop') }, 'Go to Workshop'));
  }
  const wear = wearRange(s, cfg); // the toughest tier: the could-break flag is against the toughest enemy
  const packed = s.gear.filter((g) => g.packed).length;
  return section(`Gear (${s.gear.length} items${packed ? `, ${packed} packed` : ''})`,
    h('p', { class: 'adv-tight muted adv-small' }, `Wear: each item the adventurer uses loses ${wearText(s, cfg)}.${wear.red > 0 ? '' : ' The Gear care skill reduces it.'} `,
      h('span', { class: 'warn' }, '⚠'), ' = could break in a fight against the toughest enemy. Repairs work at camp, by day, on gear the adventurer does not have today.'),
    gearTable(ctx, s.gear, { scrap: false, repair: true, flags: true }));
}

function statsPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const rt = adventurerRingTotals(s, null, cfg);
  const best = bestPerSlot(s.gear, 1, cfg);
  const worn = wornRings(s, 'adventurer', cfg);
  const contrib = ringContributions(worn, cfg);
  const a = cfg.adventurer;
  return section('Adventurer',
    h('p', { class: 'adv-tight muted adv-small' },
      `Base: ${a.hp} HP, ${a.unarmedDamage} damage unarmed, attack bar fills in ${a.attackInterval}s (attacks when full), accuracy ${a.accuracy}, dodge ${a.dodge}. `,
      best.length ? `"Best gear" = the strongest-looking owned item per slot (${best.length}).` : 'No gear owned yet.'),
    combatStatsTable([
      { label: 'Base', c: adventurerCombatant([], {}, cfg) },
      { label: "+ tonight's rings", c: adventurerCombatant([], rt, cfg) },
      { label: '+ best gear', c: adventurerCombatant(best, rt, cfg) },
    ], cfg),
    h('h4', { class: 'adv-h4' }, `Worn adventurer rings (${worn.length}/${cfg.rings.maxWorn})`),
    worn.length
      ? h('table', { class: 'adv-stats' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Ring'), h('th', { class: 'num' }, 'Value'), h('th', { class: 'num' }, 'Counts as'), h('th', {}, 'Effect'))),
        h('tbody', {}, worn
          .slice()
          .sort((x, y) => ringDef(x.type, cfg).name.localeCompare(ringDef(y.type, cfg).name) || ringValue(y, cfg) - ringValue(x, cfg))
          .map((r) => {
            const c = contrib[r.id];
            return h('tr', {},
              h('td', {}, ringNameNode(r, cfg)),
              h('td', { class: 'num' }, String(c.value)),
              h('td', { class: 'num' }, `+${f2(c.effective)}`, c.factor < 1 ? h('span', { class: 'warn' }, ` (${f2(c.factor * 100)}%)`) : null),
              h('td', { class: 'muted adv-small' }, ringDef(r.type, cfg).desc));
          })))
      : h('p', { class: 'muted adv-small' }, 'None. Adventurer rings are chosen in the nightly plan.'),
    Object.keys(rt).length
      ? h('div', { class: 'chips adv-totals' }, Object.entries(rt).map(([type, v]) => h('span', { class: 'chip' }, `${ringDef(type, cfg).name} +${f2(v)}`)))
      : null);
}

// The Adventurer tab's estimate: the best gear per gear type (defaultPack: all owned gear, what could break left out
// when the type has another item) and the adventurer's worn rings. The gear is chosen tonight on the plan screen.
function advScope(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  return { id: 'adv', gearIds: defaultPack(s, cfg), ringIds: wornRings(s, 'adventurer', cfg).map((r) => r.id), selected: null };
}

function rosterPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const r = s.roster;
  if (!r) return section('Tomorrow\'s roster', h('p', { class: 'muted' }, 'No roster.'));
  const chance = (t) => h('b', {}, trackValueText(t, intelValue(s, t, cfg), cfg));
  const scope = advScope(ctx);
  scheduleEstimates(ctx, scope);
  const estimates = r.enemies.map((e, i) => cachedEstimate(ctx, scope, i));
  return section(`Tomorrow's roster (fight on day ${r.day})`,
    h('p', { class: 'adv-tight muted adv-small' },
      'You choose one of these enemies when you end the day. Scouting: each attribute visible ', h('b', {}, enemySightText(s, cfg)),
      ', ring type ', chance('ringTypeSight'), ', ring grade ', chance('ringGradeSight'), ', banner ', chance('groupSight'),
      '. Each column is one enemy, so a row compares one attribute across all of them. ',
      h('span', { class: 'attr-low' }, 'Green = Low'), ' (weaker), ', h('span', { class: 'attr-high' }, 'red = High'), ' (stronger), ? = hidden. Hover a row name for what it does.'),
    h('p', { class: 'adv-tight muted adv-small' }, 'The win estimate is worked out by itself with your best gear (the best per gear type) and the adventurer\'s worn rings. You choose the gear tonight.'),
    rosterTable(ctx, r.enemies, { day: r.day, estimates, pending: estimatesPending(ctx), estimateTip: 'Worked out automatically: your win chance with your best gear (the best item of each gear type) and the rings the adventurer wears, from test fights against guesses of the hidden attributes. You choose the gear tonight.' }),
    bannersNote(ctx));
}
