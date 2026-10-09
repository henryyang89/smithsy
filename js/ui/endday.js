// End-of-day screens: battle report (phase 'report'), plan tomorrow's fight (phase 'plan'),
// run summary (phase 'over': how the run ended, how the score is worked out, what went wrong).
// Also exports widgets reused by the Adventurer tab and the Log tab: rosterTable (one enemy per column),
// enemyCard (a single enemy), renderBattleReport, renderCombatLog, combatStatsTable and small gear/ring helpers.
// All game-state changes go through core actions inside ctx.act(). UI-only state lives in ctx.ui.plan* (the selection)
// and ctx.ui.est_* (the automatic win estimates, ui/estimates.js).
import { h, section, bar, num, tip, restoreScrollLeft } from './dom.js';
import { SLOTS, GRADES, LEVELS, TIERS } from '../config.js';
import * as Game from '../core/game.js';
import { enemyBase, enemyCombatant, knownLevels, ringTypeVisible, ringGradeVisible, groupVisible, hiddenGradeOdds, growth } from '../core/enemies.js';
import { loadouts, simCounts, shownMargin } from '../core/sim.js';
import { adventurerCombatant, attackInterval, hitChance, hitDamage } from '../core/combat.js';
import { ringTotals, ringContributions, ringValue, ringDef, ringLabel, wornRings } from '../core/rings.js';
import { gearStats, gearPower, gearName, shownDurability, wearLoss, worstWear, couldBreak, gearMatchNotes, repairPlan } from '../core/gear.js';
import { analyzeLoss, cacheAnalysis } from '../core/replay.js';
import { smithBonuses } from '../core/bonuses.js';
import { intelValue, nextIntelGain, trackValueText, canSpendIntel } from '../core/intel.js';
import { bannerLabel, bannersLine, bannersText, groupRewardText } from '../core/groups.js';
import { packLimit, packOrder, slotNoun, defaultPack, leaveWornHome } from '../core/pack.js';
import { cap, qtyText } from '../core/util.js';
import { spendIntelAction, intelTip } from './skillsview.js';
import { durText, winText, winClass, winWithMargin, sortedIds, gearAnswers, combatLogRows, scoreBreakdown, outcomeSegments, fightSegment, whatIfText } from './present.js';
import { VERSION } from '../version.js';
import { scheduleEstimates, cancelEstimates, cachedEstimate, estimatesPending, estimateStatus, estimateCell } from './estimates.js';

// ------------------------------------------------------------------ format ----
const f1 = (v) => num(v, 1);
const f2 = (v) => num(v, 2);
const pctf = (v, d = 1) => `${num(v, d)}%`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${num(v, 1)}%`;
const LV = { low: 'Low', normal: 'Normal', high: 'High' };

// "25%", "101", "+2%", "none" — the attribute's value with its unit (pierce resistance is a % of your piercing
// ignored). A value of 0 (every Low special and resistance) reads "none": the enemy simply does not have it. With
// `day`, Accurate and Evasion show the value on that fight day (the daily growth is never shown as a number).
export function attrValueText(key, level, cfg, day = null) {
  const v = cfg.enemies.attributes[key].values[level];
  if (key === 'accurate' || key === 'evasion') return String(day == null ? v : Math.round(v * growth(day, cfg).ratings));
  if (key === 'fast') return `${v > 0 ? '+' : ''}${v}%`;
  if (v === 0) return 'none';
  return `${v}%`;
}

const mixText = (c) => `${c.low} low · ${c.normal} normal · ${c.high} high`;

// -------------------------------------------------------------- gear/ring ----
// Rough strength of an item: material multiplier x grade multiplier (ignores gems). Lives in core/gear.js.
export { gearPower };

// Up to n items per slot: highest power first, then highest durability.
export function bestPerSlot(items, n, cfg) {
  const out = [];
  for (const slot of SLOTS) {
    const list = items
      .filter((g) => g.slot === slot)
      .sort((a, b) => gearPower(b, cfg) - gearPower(a, cfg) || b.durability - a.durability || a.id - b.id);
    out.push(...list.slice(0, n));
  }
  return out;
}

// Compact, plain-English stat line for one item: "Damage 18 · Accuracy 18 · Magic +20% of damage".
export function gearStatsText(g, cfg) {
  const s = gearStats(g, cfg);
  const v = (k) => s[k] || 0;
  const parts = [];
  if (v('damage')) parts.push(`Damage ${f1(v('damage'))}`);
  if (v('accuracy')) parts.push(`Accuracy ${f1(v('accuracy'))}`);
  if (v('defense')) parts.push(`Defense ${f1(v('defense'))}%`);
  if (v('dodge')) parts.push(`Dodge ${f1(v('dodge'))}`);
  if (v('speed')) parts.push(`Speed ${signedPct(v('speed'))}`);
  if (v('magicPct')) parts.push(`Magic +${f1(v('magicPct'))}% of damage`);
  if (v('magicRes')) parts.push(`Magic resist ${f1(v('magicRes'))}%`);
  if (v('pierce')) parts.push(`Piercing ${f1(v('pierce'))}%`);
  if (v('pierceRes')) parts.push(`Pierce resist ${f1(v('pierceRes'))}% of enemy piercing`);
  if (v('stunChance')) parts.push(`Stun ${f1(v('stunChance'))}% for ${f2(v('stunDur'))}s`);
  if (v('stunChanceRed')) parts.push(`Stun resist ${f1(v('stunChanceRed'))}% chance / ${f1(v('stunDurRed'))}% duration`);
  if (v('slowPct')) parts.push(`Slow ${f1(v('slowPct'))}% for ${f2(v('slowDur'))}s`);
  if (v('slowRed')) parts.push(`Slow resist ${f1(v('slowRed'))}% strength / ${f1(v('slowDurRed'))}% duration`);
  return parts.join(' · ');
}

// Name on the first line, stats below (small).
export function gearCell(g, cfg) {
  return [
    gearNameNode(g),
    h('span', { class: 'muted adv-small', ...tip('Material x grade multiplier') }, ` x${f2(gearPower(g, cfg))}`),
    h('div', { class: 'adv-gstats' }, gearStatsText(g, cfg)),
  ];
}

export function gearNameNode(g) {
  return h('span', { class: 'adv-gname' },
    h('span', { class: 'adv-gbase' }, h('span', { class: `grade-${g.grade}` }, g.grade), ` ${cap(g.material)} ${cap(g.slot)}`),
    g.gem ? [' ', h('span', { class: 'adv-gem' }, `+${cap(g.gem.type)} `, h('span', { class: `grade-${g.gem.grade}` }, g.gem.grade))] : null);
}

// What one fight can cost a used item, using the same wearLoss() as resolveBattle in core/game.js:
// roll x the enemy tier's multiplier x (1 - Gear care %), to one decimal, at least 1.
// With tier = null the range covers every tier (lowest multiplier .. highest) and avg is null; with a tier,
// avg is the mean loss over the possible rolls.
export function wearRange(state, cfg, tier = null) {
  const dl = cfg.gear.durabilityLoss;
  const tm = dl.tierMult || {};
  const mults = tier ? [tm[tier] || 1] : TIERS.map((t) => tm[t] || 1);
  const red = Math.min(100, smithBonuses(state, cfg).gearCarePct || 0);
  const at = (roll, m) => wearLoss(roll, m, red);
  let avg = null;
  if (tier) {
    let sum = 0;
    let n = 0;
    for (let roll = dl.min; roll <= dl.max; roll++, n++) sum += at(roll, mults[0]);
    avg = n ? sum / n : at(dl.min, mults[0]);
  }
  return { min: at(dl.min, Math.min(...mults)), max: at(dl.max, Math.max(...mults)), red, avg };
}

// Whole numbers, the low end rounded down and the high end up: "9-13% per fight (avg 11%; more against tougher
// enemies: x1 / x1.1 / x1.2 ...; 5% less from Gear care)" for notes and tooltips.
export function wearText(state, cfg, tier = null) {
  const w = wearRange(state, cfg, tier);
  const dl = cfg.gear.durabilityLoss;
  const extra = [];
  if (w.avg != null) extra.push(`avg ${Math.round(w.avg)}%`);
  if (!tier && dl.tierMult) extra.push(`more against tougher enemies: x${TIERS.map((t) => dl.tierMult[t] || 1).join(' / x')} for ${TIERS.join(' / ')}`);
  if (tier && dl.tierMult && (dl.tierMult[tier] || 1) !== 1) extra.push(`x${dl.tierMult[tier]} against ${/^[aeiou]/i.test(tier) ? 'an' : 'a'} ${tier} enemy`);
  if (w.red > 0) extra.push(`${num(w.red, 1)}% less from Gear care`);
  return `${Math.floor(w.min + 1e-9)}-${Math.ceil(w.max - 1e-9)}% per fight${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

// The could-break flag: a used item loses up to `worstWear` in a fight (against `tier`, null = the toughest), so an item
// at or below that could be destroyed. Whole numbers, rounded up. Always lasts the whole fight: wear comes after it.
export function couldBreakText(state, cfg, item, enemyName = null, tier = null) {
  const worst = Math.ceil(worstWear(state, tier, cfg) - 1e-9);
  return `Could break: against ${enemyName || 'the toughest enemy'} it can lose up to ${worst}% (it has ${durText(item.durability)}). At 0% it is destroyed after the fight; it always lasts the whole fight.`;
}

export function ringNameNode(r, cfg) {
  const d = ringDef(r.type, cfg);
  return h('span', { class: 'adv-rname', ...tip(ringLabel(r, cfg)) }, `${d.name} `, h('span', { class: `grade-${r.grade}` }, r.grade));
}

// -------------------------------------------------------------- stat table ----
const STAT_ROWS = [
  { k: 'hp', label: 'Max HP', fmt: f1, always: true },
  { k: 'damage', label: 'Damage per hit', fmt: f1, always: true },
  { k: 'interval', label: 'Attack bar fills in', fmt: (v) => `${f2(v)}s`, get: (c) => attackInterval(c, false, 0), always: true },
  { k: 'accuracy', label: 'Accuracy', fmt: f1, always: true },
  { k: 'dodge', label: 'Dodge', fmt: f1, always: true },
  { k: 'defense', label: 'Defense (damage reduction)', fmt: pctf, always: true },
  { k: 'speed', label: 'Attack speed', fmt: signedPct },
  { k: 'magicPct', label: 'Magic damage (% of damage)', fmt: pctf },
  { k: 'magicRes', label: 'Magic resistance', fmt: pctf },
  { k: 'pierce', label: 'Piercing (% of defense ignored)', fmt: pctf },
  { k: 'pierceRes', label: 'Pierce resistance (% of piercing ignored)', fmt: pctf },
  { k: 'stunChance', label: 'Stun chance per hit', fmt: pctf },
  { k: 'stunDur', label: 'Stun duration (bar stops)', fmt: (v) => `${f2(v)}s` },
  { k: 'stunChanceRed', label: 'Stun chance reduction', fmt: pctf },
  { k: 'stunDurRed', label: 'Stun duration reduction', fmt: pctf },
  { k: 'slowPct', label: 'Slow on hit (bar fills slower)', fmt: pctf },
  { k: 'slowDur', label: 'Slow duration', fmt: (v) => `${f2(v)}s` },
  { k: 'slowRed', label: 'Slow strength reduction', fmt: pctf },
  { k: 'slowDurRed', label: 'Slow duration reduction', fmt: pctf },
];

// cols: [{ label, c }] where c is a combatant (adventurerCombatant / enemyCombatant).
// Rows that are zero in every column are hidden (except the core ones).
export function combatStatsTable(cols) {
  const val = (r, c) => (r.get ? r.get(c) : c[r.k] || 0);
  const rows = STAT_ROWS.filter((r) => r.always || cols.some((col) => Math.abs(val(r, col.c)) > 1e-9));
  return h('table', { class: 'adv-stats' },
    h('thead', {}, h('tr', {}, h('th', {}, 'Stat'), cols.map((col) => h('th', { class: 'num' }, col.label)))),
    h('tbody', {}, rows.map((r) => h('tr', {},
      h('td', {}, r.label),
      cols.map((col) => h('td', { class: 'num' }, r.fmt(val(r, col.c))))))));
}

// ------------------------------------------------------------ enemy views ----
// What the player knows about one enemy: known levels, the tier mix still hidden, base numbers, HP text.
// opts: { reveal (all levels known), day }
function enemyView(ctx, enemy, opts = {}) {
  const { state, cfg } = ctx;
  const A = cfg.enemies.attributes;
  const tierCfg = cfg.enemies.tiers[enemy.tier];
  const day = opts.day ?? enemy.day ?? state.day;
  const base = enemyBase(enemy.tier, day, cfg);
  const known = opts.reveal ? { ...enemy.levels } : knownLevels(state, enemy, cfg);
  const hidden = Object.keys(A).length - Object.keys(known).length;
  const rem = { ...tierCfg.levels };
  for (const lv of Object.values(known)) rem[lv] -= 1;
  const possible = LEVELS.filter((lv) => rem[lv] > 0);
  // HP after the HP attribute (a range while it is hidden)
  let hpText;
  if ('hp' in known) hpText = f1((base.hp * A.hp.values[known.hp]) / 100);
  else {
    const vals = (possible.length ? possible : ['normal']).map((lv) => (base.hp * A.hp.values[lv]) / 100);
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    hpText = lo === hi ? f1(lo) : `${f1(lo)}-${f1(hi)}`;
  }
  return { A, tierCfg, day, base, known, hidden, rem, possible, hpText };
}

// "Normal · 15%" chip ("Low · none" for a special the enemy does not have), or "?" while the level is hidden.
// day = the fight day: Accurate and Evasion show their value on that day.
function levelChip(cfg, key, lv, day = null) {
  return lv
    ? h('span', { class: `adv-lv attr-${lv}` }, `${LV[lv]} · ${attrValueText(key, lv, cfg, day)}`)
    : h('span', { class: 'adv-lv attr-unknown' }, '?');
}

// Tooltip for an attribute: what it does and the value at each level.
function attrTitle(cfg, key, day = null) {
  const a = cfg.enemies.attributes[key];
  return `${a.name}: ${a.desc}. ${LEVELS.map((l) => `${LV[l]} ${attrValueText(key, l, cfg, day)}`).join(' / ')}`;
}

const remText = (rem) => LEVELS.filter((l) => rem[l] > 0).map((l) => `${rem[l]} ${l}`).join(' · ');

// -------------------------------------------------------------- enemy card ----
function ringRewardNode(ctx, enemy) {
  const { state, cfg } = ctx;
  if (!enemy.ring) return null;
  const tv = ringTypeVisible(state, enemy, cfg);
  const gv = ringGradeVisible(state, enemy, cfg);
  const weights = cfg.rings.gradeWeights[enemy.tier];
  const def = tv ? ringDef(enemy.ring.type, cfg) : null;
  const nTypes = Object.keys(cfg.rings.types).length;
  const odds = hiddenOddsText(state, enemy, cfg);
  let detail = null;
  if (tv && gv) detail = ringEffectText(def, ringValue(enemy.ring, cfg));
  else if (tv) {
    const vals = Object.keys(weights).map((g) => def.values[GRADES.indexOf(g)]);
    detail = ringEffectText(def, `${Math.min(...vals)}-${Math.max(...vals)}`);
  }
  return h('div', { class: 'adv-ring' },
    h('span', { class: 'muted' }, 'Ring reward: '),
    tv ? h('b', { ...tip(def.desc) }, def.name) : h('span', { class: 'adv-lv attr-unknown', ...tip(`Type hidden: any of ${nTypes} ring types (equally likely)`) }, '? type'),
    ' ',
    gv ? h('span', { class: `adv-lv grade-${enemy.ring.grade}` }, enemy.ring.grade)
      : h('span', { class: 'adv-lv attr-unknown', ...tip(hiddenGradeTip(odds)) }, '? grade'),
    gv ? null : h('span', { class: 'muted' }, ` (${odds})`),
    detail ? h('span', { class: 'muted' }, ` = ${detail}`) : null,
    tv ? h('span', { class: def.owner === 'adventurer' ? 'adv-owner' : 'adv-owner muted' }, ` · ${def.owner} ring`) : null);
}

// The odds of each ring grade GIVEN that the grade is hidden (better grades are harder to scout, so they are likelier
// than the plain tier odds once you know the grade was not seen): "C 55%, B 33%, A 12%".
const hiddenOddsText = (state, enemy, cfg) => Object.entries(hiddenGradeOdds(state, enemy, cfg)).map(([g, v]) => `${g} ${Math.round(v)}%`).join(', ');
const hiddenGradeTip = (odds) => `Grade hidden. Given that it is hidden: ${odds} (better grades are harder to scout).`;

// "6% less travel time" / "6 more guesses ..." (value + the ring type's description)
const ringEffectText = (def, v) => (def.desc.startsWith('%') ? `${v}${def.desc}` : `${v} ${def.desc}`);

// One enemy: name, tier, base numbers, 12 attributes in offense|defense pairs, tier mix, ring reward.
// Used for a single enemy (today's opponent, the battle report); rosters use rosterTable.
// opts: { reveal (show all levels), ring (default true), day }
export function enemyCard(ctx, enemy, opts = {}) {
  const { cfg } = ctx;
  const v = enemyView(ctx, enemy, opts);
  const { A, tierCfg, day, base, known, hidden, rem, hpText } = v;
  const stat = (label, value, title) => h('span', { class: 'adv-bstat', ...tip(title) }, h('span', { class: 'muted' }, `${label} `), h('b', {}, value));
  const baseLine = h('div', { class: 'adv-base' },
    stat('HP', hpText, `Base ${f1(base.hp)} x HP attribute`),
    stat('Damage', f1(base.damage), 'Damage per hit before magic, defense and piercing'),
    stat('Defense', `${base.defense}%`, 'Reduces your physical damage (piercing ignores part of it)'));

  const cell = (k) => h('div', { class: 'adv-attr', ...tip(attrTitle(cfg, k, day)) }, h('span', { class: 'adv-an' }, A[k].name), levelChip(cfg, k, known[k], day));
  const pairs = h('div', { class: 'adv-pairs' },
    h('div', { class: 'adv-ph' }, 'Offense'), h('div', { class: 'adv-ph' }, 'Defense'),
    cfg.enemies.pairs.flatMap(([o, d]) => [cell(o), cell(d)]));

  const mix = h('div', { class: 'adv-mix' }, `Tier mix: ${mixText(tierCfg.levels)}`,
    opts.reveal ? null : hidden > 0 ? h('span', {}, ` — ${hidden} hidden, among them: `, h('b', {}, mixText(rem))) : ' — all known');

  const head = h('div', { class: 'adv-ehead' },
    h('span', { class: 'adv-ename' }, enemy.name),
    h('span', { class: `adv-tier tier-${enemy.tier}` }, cap(enemy.tier)));

  return h('div', { class: 'enemy-card adv-ecard' }, head, baseLine, pairs, mix, opts.ring === false ? null : ringRewardNode(ctx, enemy));
}

// ----------------------------------------------------------- roster table ----
// All enemies of a roster side by side, ONE ENEMY PER COLUMN, so every row compares the same thing:
// name, tier, base numbers, ring reward, banner, hidden attributes, (win estimate), then the 6 offensive attributes, a
// divider, the 6 defensive ones. Cells show Low / Normal / High + value, "?" while hidden.
// opts: { day, selected (column index), onSelect(i) (columns become choosable), estimates: [result|null] per
//         column (adds the "Win estimate" row), pending (the estimates are being worked out: "…" instead of "—"),
//         estimateTip (the hover of the Win estimate row header: each screen says which gear and rings it used) }
export function rosterTable(ctx, enemies, opts = {}) {
  const { cfg } = ctx;
  const A = cfg.enemies.attributes;
  const views = enemies.map((e) => enemyView(ctx, e, { day: opts.day }));
  const sel = opts.selected ?? null;
  const pick = opts.onSelect || null;
  const nCols = enemies.length;

  const colCls = (i, extra = '') => `rt-c${i === sel ? ' rt-sel' : ''}${pick ? ' rt-pick' : ''}${extra ? ` ${extra}` : ''}`;
  const colAttrs = (i, extra) => ({ class: colCls(i, extra), 'data-col': i, onclick: pick ? () => pick(i) : null });
  const rowHead = (label, title) => h('th', { class: 'rt-row', scope: 'row', ...tip(title) }, label);
  const row = (label, title, fn, cls = '') => h('tr', { class: cls }, rowHead(label, title), enemies.map((e, i) => h('td', colAttrs(i), fn(e, views[i], i))));

  const names = h('tr', { class: 'rt-names' },
    h('th', { class: 'rt-row rt-corner' }, pick ? 'Choose' : 'Enemy'),
    enemies.map((e, i) => h('th', { ...colAttrs(i, 'rt-head'), scope: 'col' },
      h('div', { class: 'rt-hd' },
        pick ? h('input', {
          type: 'radio',
          name: 'adv-enemy',
          checked: i === sel,
          'data-enemy': i,
          'aria-label': `Choose ${e.name}`,
          onclick: (ev) => ev.stopPropagation(), // the radio's own change event picks the column (and keeps its focus)
          onchange: () => pick(i, true),
        }) : null,
        h('span', { class: 'rt-name' }, e.name)))));

  const tier = row('Tier', 'The enemy\'s tier: Normal, Elite or Champion. Tougher tiers have more High attributes (hover the tier for the exact mix)', (e, v) => h('div', { class: `adv-tier tier-${e.tier}`, ...tip(`Tier mix: ${mixText(v.tierCfg.levels)}`) }, cap(e.tier)));
  const baseHp = row('Base HP', 'Base HP on the fight day, before the HP attribute (see the HP row below)', (e, v) => f1(v.base.hp));
  const baseDmg = row('Damage', 'Damage per hit before magic, defense and piercing', (e, v) => f1(v.base.damage));
  const baseDef = row('Defense', 'Reduces your physical damage (piercing ignores part of it)', (e, v) => `${v.base.defense}%`);
  const ring = row('Ring reward', 'The ring a win drops (hidden until your ring scouting reveals it)', (e) => ringRewardCell(ctx, e));
  const banner = row('Banner', `The banner this enemy marches under (Red, Black or Gold). Banner scouting: ${trackValueText('groupSight', intelValue(ctx.state, 'groupSight', cfg), cfg)} to see it. Wins against your most-beaten banner earn pack mules.`, (e) => bannerChip(ctx, e));
  const hiddenRow = row('Hidden attributes', 'How many of the 12 attributes you cannot see yet, and the Low / Normal / High levels they can still have', (e, v) => (v.hidden > 0
    ? [h('b', {}, String(v.hidden)), h('div', { class: 'muted rt-sm' }, remText(v.rem))]
    : h('span', { class: 'muted' }, 'none')));

  const rows = [tier, baseHp, baseDmg, baseDef, ring, banner, hiddenRow];
  if (opts.estimates) {
    rows.push(h('tr', { class: 'rt-est' }, rowHead('Win estimate', opts.estimateTip || 'Worked out automatically: your win chance, from test fights against guesses of the hidden attributes'),
      enemies.map((e, i) => h('td', { ...colAttrs(i), 'data-est': i }, estimateCell(opts.estimates[i], opts.pending)))));
  }

  const sectionRow = (label, sub) => h('tr', { class: 'rt-sect' }, h('th', { class: 'rt-row', scope: 'rowgroup' }, label), h('td', { colspan: nCols }, h('span', { class: 'rt-sect-sub' }, sub)));
  const attrRow = (key, last) => row(A[key].name, attrTitle(cfg, key, views.length ? views[0].day : opts.day), (e, v) => {
    const chip = levelChip(cfg, key, v.known[key], v.day);
    if (key !== 'hp') return chip;
    return [chip, h('div', { class: 'muted rt-sm', ...tip(`HP = base ${f1(v.base.hp)} x the HP attribute`) }, `= ${v.hpText} HP`)];
  }, last ? 'rt-last' : '');
  const offense = cfg.enemies.pairs.map(([o]) => o);
  const defense = cfg.enemies.pairs.map(([, d]) => d);

  const table = h('table', { class: 'rt', style: { width: `calc(var(--rt-label) + ${nCols} * var(--rt-col))` } },
    h('thead', {}, names),
    h('tbody', {},
      rows,
      sectionRow('Offense', 'what it does to you'),
      offense.map((k) => attrRow(k)),
      sectionRow('Defense', 'how well it resists your attacks'),
      defense.map((k, i) => attrRow(k, i === defense.length - 1))));
  return h('div', { class: 'adv-scroll rt-scroll', 'data-rt': '1' }, table);
}

// Compact ring reward for a table column: "Ore sight B" + "smith ring", or "? type ? grade" while hidden.
function ringRewardCell(ctx, enemy) {
  const { state, cfg } = ctx;
  if (!enemy.ring) return h('span', { class: 'muted' }, 'none');
  const tv = ringTypeVisible(state, enemy, cfg);
  const gv = ringGradeVisible(state, enemy, cfg);
  const weights = cfg.rings.gradeWeights[enemy.tier];
  const odds = hiddenOddsText(state, enemy, cfg);
  const def = tv ? ringDef(enemy.ring.type, cfg) : null;
  const nTypes = Object.keys(cfg.rings.types).length;
  let title;
  if (tv && gv) title = `${def.name} ${enemy.ring.grade}: ${ringEffectText(def, ringValue(enemy.ring, cfg))}`;
  else if (tv) {
    const vals = Object.keys(weights).map((g) => def.values[GRADES.indexOf(g)]);
    title = `${def.name}. ${hiddenGradeTip(odds)} ${ringEffectText(def, `${Math.min(...vals)}-${Math.max(...vals)}`)}`;
  } else title = `Type hidden (any of ${nTypes} types, equally likely). ${gv ? `Grade ${enemy.ring.grade}.` : hiddenGradeTip(odds)}`;
  return h('div', { class: 'rt-ring', ...tip(title) },
    h('div', {},
      tv ? h('b', {}, def.name) : h('span', { class: 'adv-lv attr-unknown' }, '? type'),
      ' ',
      gv ? h('span', { class: `adv-lv grade-${enemy.ring.grade}` }, enemy.ring.grade) : h('span', { class: 'adv-lv attr-unknown' }, '? grade')),
    tv ? h('div', { class: 'muted rt-sm' }, `${def.owner} ring`) : null);
}

// The banner chip of a roster column: the colour when the banner is seen, "?" when it is not.
function bannerChip(ctx, enemy) {
  const { state, cfg } = ctx;
  const chance = trackValueText('groupSight', intelValue(state, 'groupSight', cfg), cfg);
  if (groupVisible(state, enemy, cfg) && enemy.group in cfg.groups.list) {
    return h('span', { class: `bn bn-${enemy.group}`, ...tip(`${cfg.groups.list[enemy.group].name}. Banner scouting: ${chance}.`) }, bannerLabel(enemy.group, cfg));
  }
  const names = Object.keys(cfg.groups.list).map((k) => bannerLabel(k, cfg));
  const list = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
  return h('span', { class: 'bn bn-unknown', ...tip(`Banner unknown: ${list} (equally likely). Banner scouting: ${chance}.`) }, '?');
}

// One line under the roster (plan screen and Adventurer tab): the wins per banner, the next pack mule and the pack mules
// so far. The hover has the story.
export function bannersNote(ctx) {
  return h('p', { class: 'adv-tight muted adv-small adv-banners', ...tip(bannersText(ctx.cfg)) }, bannersLine(ctx.state, ctx.cfg));
}

// -------------------------------------------------------------- combat log ----
// The combat log is a fixed-column table (css .clog): Time · Attacker · Result · Effects · You · Foe. Every row shows both
// HP values after the attack, in the same columns, and the one that dropped is bold. The rows come from combatLogRows().
// Under 640 px the Effects column is hidden (its text is added to Result) and so is the muted detail of a hit.
const fx1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

export function renderCombatLog(report) {
  const en = report.enemy.name;
  const all = combatLogRows(report);
  const row = (r) => h('tr', { class: `${r.side}${r.hit ? '' : ' miss'}` },
    h('td', { class: 'clog-t' }, r.time),
    h('td', { class: 'clog-att' }, r.attacker),
    h('td', { class: 'clog-res' }, r.result,
      r.detail ? h('span', { class: 'clog-detail' }, ` (${r.detail})`) : null,
      r.effects ? h('span', { class: 'clog-fx-inline' }, ` · ${r.effects}`) : null),
    h('td', { class: 'clog-fx', ...(r.effects ? { title: r.effects } : {}) }, r.effects),
    h('td', { class: 'num' }, r.hitSide === 'A' ? h('b', {}, fx1(r.hpA)) : fx1(r.hpA)),
    h('td', { class: 'num' }, r.hitSide === 'E' ? h('b', {}, fx1(r.hpE)) : fx1(r.hpE)));
  const note = (cls, text) => h('tr', { class: cls }, h('td', { colspan: 6 }, text));
  // Very long fights: show the start and the end. Saved reports of very long fights are already
  // trimmed by the core (report.logTrimmed = attacks from the middle that were not saved).
  const HEAD = 1000;
  const TAIL = 300;
  const trimmed = report.logTrimmed > 0 ? report.logTrimmed : 0;
  let shown = all.map(row);
  if (all.length > HEAD + TAIL) {
    const hiddenHere = all.length - HEAD - TAIL;
    const more = hiddenHere + trimmed;
    shown = [...all.slice(0, HEAD).map(row),
      note('clog-note clog-gap muted', `… ${more} more attacks${trimmed ? ` (${trimmed} not saved: log trimmed)` : ''} …`),
      ...all.slice(-TAIL).map(row)];
  }
  const end = report.win ? `${en} is defeated after ${f1(report.time)}s.` : report.draw ? `Safety time cap reached after ${f1(report.time)}s — draw.` : `The adventurer falls after ${f1(report.time)}s.`;
  return h('div', { class: 'combatlog' },
    h('table', { class: 'clog' },
      h('colgroup', {}, ['c-time', 'c-att', 'c-res', 'c-fx', 'c-you', 'c-foe'].map((c) => h('col', { class: c }))),
      h('thead', {}, h('tr', {},
        h('th', {}, 'Time'), h('th', {}, 'Attacker'), h('th', {}, 'Result'), h('th', { class: 'clog-fx' }, 'Effects'),
        h('th', { class: 'num', ...tip('The adventurer\'s HP after the attack') }, 'You'),
        h('th', { class: 'num', ...tip(`${en}'s HP after the attack`) }, 'Foe'))),
      h('tbody', {},
        note('clog-note muted', `Fight starts: Adventurer ${f1(report.advMaxHp)} HP vs ${en} ${f1(report.enemyMaxHp)} HP.`),
        shown,
        note(`clog-note clog-end ${report.win ? 'ok' : report.draw ? 'warn' : 'err'}`, end))));
}

// ----------------------------------------------------------- battle report ----
function hpRow(label, hp, max, cls) {
  return h('div', { class: 'adv-hprow' },
    h('span', { class: 'adv-hplabel' }, label),
    bar(max > 0 ? (hp / max) * 100 : 0, cls),
    h('span', { class: 'adv-hpnum' }, `${f1(hp)} / ${f1(max)} HP`));
}

function summaryTable(report, cfg) {
  const S = report.summary;
  const c = cfg.combat;
  const en = report.enemy.name;
  if (!S) return h('p', { class: 'muted' }, 'No summary recorded.');
  const sides = [
    { st: S.A, foe: S.E, hit: S.hitAE, dmg: S.dmgAE },
    { st: S.E, foe: S.A, hit: S.hitEA, dmg: S.dmgEA },
  ];
  const row = (label, fn, title) => h('tr', { ...tip(title) }, h('td', {}, label), sides.map((s) => h('td', { class: 'num' }, fn(s))));
  return h('div', { class: 'adv-scroll' }, h('table', { class: 'adv-stats adv-summary' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Adventurer → ', h('wbr'), en), h('th', { class: 'num' }, `${en} → `, h('wbr'), 'Adventurer'))),
    h('tbody', {},
      row('Attacks', (s) => String(s.st.attacks)),
      row('Hits', (s) => `${s.st.hits} (${s.st.attacks ? Math.round((s.st.hits / s.st.attacks) * 100) : 0}% landed)`),
      row('Hit chance', (s) => pctf(s.hit * 100, 0), `Accuracy vs dodge S-curve, clamped to ${c.minHitPct}-${c.maxHitPct}%`),
      row('Avg damage per hit', (s) => (s.st.hits ? f1(s.st.dmg / s.st.hits) : '—')),
      row('Per hit before roll', (s) => `${f1(s.dmg.phys)} phys + ${f1(s.dmg.magic)} magic`, `Each hit rolls ${c.damageRoll[0]}-${c.damageRoll[1]}% of this`),
      row('Target defense after piercing', (s) => pctf(s.dmg.effDef), 'Defense x (1 - effective piercing %); effective piercing = piercing x (1 - target\'s pierce resistance %)'),
      row('Total damage', (s) => f1(s.st.dmg)),
      row('Stuns landed', (s) => (s.st.stuns ? `${s.st.stuns} (${f1(s.foe.stunnedFor)}s total)` : '0'), 'A stun stops the target\'s attack bar for its duration (stuns do not stack; a new one refreshes the timer)'),
      row('Slows landed', (s) => String(s.st.slows), 'A slow makes the target\'s attack bar fill slower for its duration (slows do not stack; the stronger one is kept and the timer refreshes)'))));
}


// "rolled 8% x 1.10 (elite enemy) x 0.95 (Gear care -5%)": how one item's wear came about (older reports lack the detail).
function wearDetail(w, tier) {
  if (w.base == null) return null;
  const bits = [`rolled ${w.base}%`];
  if (w.tierMult && w.tierMult !== 1) bits.push(`x ${f2(w.tierMult)} (${tier} enemy)`);
  if (w.skillRed > 0) bits.push(`x ${f2(1 - w.skillRed / 100)} (Gear care -${num(w.skillRed, 1)}%)`);
  return bits.join(' ');
}

// "Gear used in the fight (3)": what the adventurer used, with its wear (the difference of the two shown durabilities, so
// the numbers add up on screen) and what is left. Then "Brought but not used (no wear)" chips. Gear left at home is never listed.
function gearUsedPanel(report, ctx) {
  const { cfg } = ctx;
  const tier = report.enemy.tier;
  const used = report.used || [];
  const notUsed = report.notUsed || [];
  const wearOf = (id) => (report.wear || []).find((w) => w.id === id);
  const wearRows = used.map((snap) => {
    const w = wearOf(snap.id);
    const before = shownDurability(snap.durability);
    const left = w ? w.left : snap.durability;
    const after = left <= 0 ? 0 : shownDurability(left);
    return h('tr', { 'data-gear': snap.id },
      h('td', {}, gearNameNode(snap), w && wearDetail(w, tier) ? h('div', { class: 'muted adv-small' }, wearDetail(w, tier)) : null),
      h('td', { class: 'num err' }, `-${Math.max(0, before - after)}%`),
      h('td', { class: 'num' }, after <= 0 ? h('b', { class: 'err' }, 'Destroyed') : `${after}% left`));
  });
  const destroyed = report.destroyed || [];
  const survived = report.win || report.draw;
  const care = cfg.skills.activity.gearCare;
  const gearCareNode = survived && Array.isArray(report.notes) && care
    ? h('p', { class: 'adv-tight muted adv-small' }, `${care.name} +${care.xp} XP`, report.notes.map((n) => [' · ', h('b', { class: 'ok' }, n)]))
    : null;
  return section(`Gear used in the fight (${used.length})`,
    used.length
      ? h('table', { class: 'adv-stats' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'Wear'), h('th', { class: 'num' }, 'Durability'))), h('tbody', {}, wearRows))
      : h('p', { class: 'adv-tight muted' }, 'No gear used: the adventurer fought unarmed.'),
    destroyed.length ? h('p', { class: 'err adv-tight' }, `Destroyed (0% durability): ${destroyed.join(', ')}.`) : null,
    notUsed.length
      ? [h('h4', { class: 'adv-h4' }, 'Brought but not used (no wear)'),
        h('div', { class: 'chips adv-notused' }, notUsed.map((snap) => h('span', { class: 'chip', 'data-gear': snap.id }, gearNameNode(snap), h('span', { class: 'muted' }, ` ${durText(snap.durability)}`))))]
      : null,
    gearCareNode,
    h('h4', { class: 'adv-h4' }, 'Reward'),
    report.ring
      ? h('p', { class: 'adv-tight' }, 'Ring gained: ', h('b', { class: `grade-${report.ring.grade}` }, report.ringText),
        h('span', { class: 'muted' }, ringDef(report.ring.type, cfg).owner === 'adventurer' ? ' — an adventurer ring: you can give it to the adventurer in the next plan.' : ' — a smith ring: wear it on the Rings tab.'))
      : h('p', { class: 'adv-tight muted' }, report.draw ? 'No ring (draw).' : 'No ring.'),
    report.groupReward ? h('p', { class: 'adv-tight ok' }, groupRewardText(report, cfg)) : null);
}

// ---- "What went wrong?" (lost fights): 500 replays, the outcome bar, and whether gear left at home would have helped.
// The work runs in the background (core/replay.js) the first time the screen is shown and is kept on the report.
// ctx.ui.analysis === 'off' (render tests) turns the automatic start off; ctx.ui.loss_run is the run that is going.
export function cancelAnalysis(ctx) {
  if (ctx.ui.loss_run) ctx.ui.loss_run.cancelled = true;
  ctx.ui.loss_run = null;
}

const hpLeftText = (pct) => (pct < 1 ? 'less than 1%' : `${Math.round(pct)}%`);

function analysisNode(ctx, report, a) {
  const { cfg } = ctx;
  const segs = outcomeSegments(a.used);
  const here = fightSegment(report, cfg);
  const hereSeg = segs.find((x) => x.key === here);
  let x = 0;
  let centre = null;
  for (const sg of segs) {
    if (sg.key === here) centre = x + sg.pct / 2;
    x += sg.pct;
  }
  const en = report.enemy.name;
  const w = whatIfText(a);
  return h('section', { class: 'panel loss', 'data-loss': 'done' },
    h('h3', {}, 'What went wrong?'),
    h('p', { class: 'adv-tight' }, `In ${a.n} replays of this fight (same gear and rings, the enemy now fully known) the adventurer won `, h('b', {}, winText(a.used.winPct)), '.'),
    h('div', { class: 'oc' },
      h('div', { class: 'oc-bar' }, segs.map((sg) => (sg.count ? h('span', { class: `oc-seg oc-${sg.key}`, style: { width: `${sg.pct}%` }, ...tip(`${sg.label}: ${Math.round(sg.pct)}%`) }) : null))),
      centre != null ? h('div', { class: 'oc-mark', style: { left: `${centre}%` } }, '▲') : null),
    h('p', { class: 'adv-tight adv-small oc-here' }, `▲ This fight: ${hereSeg.label.toLowerCase()} (${en} had ${hpLeftText(a.thisFight.enemyHpPct)} HP left).`),
    h('p', { class: 'adv-tight adv-small' }, segs.filter((sg) => sg.count > 0).map((sg, i) => [i ? ' · ' : '', h('span', { class: `oc-key oc-${sg.key}-t` }, `${sg.label} ${Math.round(sg.pct)}%`)])),
    report.planEstimate ? h('p', { class: 'adv-tight adv-small' }, `Your plan showed ${winText(report.planEstimate.winPct)}${report.planEstimate.margin != null ? ` ± ${report.planEstimate.margin}` : ''}.`) : null,
    h('h4', { class: 'adv-h4' }, 'Would gear left at home have helped?'),
    h('p', { class: `adv-tight loss-${w.verdict}` }, w.text),
    h('details', { class: 'adv-details' }, h('summary', {}, 'How this was worked out'),
      h('p', { class: 'adv-tight muted adv-small' }, `The fight was replayed ${a.n} times with the enemy exactly as it was (every attribute known), the gear the adventurer used and the rings it wore; each replay has its own luck, so the result is a chance, not a story. `,
        `Then every piece of gear you owned was tried (${cfg.report.whatIfFights} fights per combination) to find the best set, and that set was replayed ${a.n} times with the same luck, so the difference comes from the gear alone. `,
        `Gear counts as "would have helped" when it adds ${cfg.report.whatIfMinGain} win points or more. "Close" means the loser had less than ${cfg.report.closeCut}% of its HP left.`)));
}

function lossPanel(ctx, report) {
  if (report.analysis) return analysisNode(ctx, report, report.analysis);
  const run = ctx.ui.loss_run;
  const key = `${ctx.state.seed}:${report.day}`;
  const text = (f) => `Working out what happened… ${Math.round(f * 100)}%`;
  const progress = h('p', { class: 'adv-tight muted loss-progress' }, text(run && run.key === key ? run.pct : 0));
  if (run && run.key === key && !run.cancelled) {
    run.node = progress; // the run updates the newest screen's text
  } else if (ctx.ui.analysis !== 'off') {
    const r = { key, cancelled: false, pct: 0, node: progress };
    ctx.ui.loss_run = r;
    analyzeLoss(ctx.state, report, ctx.cfg, (f) => {
      if (r.cancelled) return false;
      r.pct = f;
      if (r.node) r.node.textContent = text(f);
      return true;
    }).then((a) => {
      if (ctx.ui.loss_run === r) ctx.ui.loss_run = null;
      if (!a || r.cancelled) return;
      cacheAnalysis(ctx.state, report, a);
      ctx.save();
      ctx.rerender();
    }).catch((e) => console.error(e));
  }
  return h('section', { class: 'panel loss', 'data-loss': 'working' }, h('h3', {}, 'What went wrong?'), progress);
}

// Full report body. opts: { headline (default true), log (default true), analysis (default true: the "What went wrong?" panel
// of a lost fight) }
export function renderBattleReport(report, ctx, opts = {}) {
  const cfg = ctx.cfg;
  const en = report.enemy.name;
  const tier = report.enemy.tier;
  const kind = report.win ? 'win' : report.draw ? 'draw' : 'loss';
  const title = report.win ? `Victory over ${en}!` : report.draw ? `Draw against ${en}` : `Defeat — the adventurer fell to ${en}`;

  const head = h('section', { class: `panel adv-rhead adv-${kind}` },
    opts.headline === false ? null : h('div', { class: `adv-headline adv-${kind}` }, title),
    h('div', { class: 'muted' }, `Day ${report.day} · ${tier} · lasted ${f1(report.time)}s`,
      report.enemy.group && cfg.groups.list[report.enemy.group] ? [' · Banner: ', h('b', { class: `bn bn-${report.enemy.group}` }, bannerLabel(report.enemy.group, cfg))] : null),
    report.planEstimate ? h('div', { class: 'muted' }, `Your plan showed ${winText(report.planEstimate.winPct)}${report.planEstimate.margin != null ? ` ± ${report.planEstimate.margin}` : ''}.`) : null,
    report.draw ? h('p', { class: 'warn' }, 'The fight reached the safety time cap: the adventurer survives, but gets no ring.') : null,
    h('div', { class: 'adv-hpbars' },
      hpRow('Adventurer', report.advHp, report.advMaxHp, 'adv-hp-a'),
      hpRow(en, report.enemyHp, report.enemyMaxHp, 'adv-hp-e')));

  const enemyPanel = section('Enemy attributes (revealed)',
    enemyCard(ctx, { name: en, tier, levels: report.enemy.levels, day: report.day }, { reveal: true, ring: false, day: report.day }));

  const parts = [
    head,
    h('div', { class: 'cols' }, gearUsedPanel(report, ctx), enemyPanel),
    !report.win && !report.draw && opts.analysis !== false ? lossPanel(ctx, report) : null,
    section('Summary', summaryTable(report, cfg),
      report.adv && report.enemyC
        ? h('details', { class: 'adv-details' }, h('summary', {}, 'Combat stats of both sides'),
          combatStatsTable([{ label: 'Adventurer', c: report.adv }, { label: en, c: report.enemyC }]))
        : null),
  ];
  if (opts.log !== false) {
    const attacks = (report.log || []).length + (report.logTrimmed > 0 ? report.logTrimmed : 0);
    parts.push(section(`Combat log (${attacks} attacks${report.logTrimmed > 0 ? ', log trimmed' : ''})`,
      report.logTrimmed > 0
        ? h('p', { class: 'adv-tight muted adv-small' }, `Very long fight: ${report.logTrimmed} attacks from the middle were not saved (log trimmed). The start and the end are shown.`)
        : null,
      renderCombatLog(report)));
  }
  return h('div', { class: 'adv-report' }, parts);
}

// ---------------------------------------------------------------- screens ----
export function renderReport(root, ctx) {
  const s = ctx.state;
  const r = s.report;
  const cont = (cls) => h('button', { class: `primary ${cls || ''}`, onclick: () => ctx.act(() => Game.acknowledgeReport(ctx.state)) }, 'Continue to tomorrow\'s plan');
  root.append(h('div', { class: 'adv-screen' },
    h('div', { class: 'adv-titlebar' }, h('h2', {}, `End of day ${s.day}: battle report`), cont()),
    s.day % ctx.cfg.intel.daysPerPoint === 0 ? h('p', { class: 'ok' }, `Day ${s.day} complete: +1 intel point (spend it in the plan).`) : null,
    r ? renderBattleReport(r, ctx) : h('p', { class: 'muted' }, 'No battle report.'),
    h('div', { class: 'row adv-bottom' }, cont())));
}

// The run summary (phase 'over'): how the run ended, the score and how it is worked out, and for a lost run what went wrong.
// This is the only place the score is shown: nothing about it appears while the run is going.
export function renderRunSummary(root, ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const lost = s.report && !s.report.win && !s.report.draw ? s.report : null;
  // saves from before `end` existed: work it out from the last report
  const end = s.end || { reason: lost ? 'fell' : 'retired', day: s.day, daysSurvived: Math.max(0, s.day - 1), enemy: lost ? { name: lost.enemy.name, tier: lost.enemy.tier } : null, cancelled: null };
  const fell = end.reason === 'fell';
  const fatal = fell ? lost : null;
  const score = s.stats.score;
  const totalWins = Object.values(s.stats.wins).reduce((a, b) => a + b, 0);
  const best = Math.max(score, end.prevBest || 0);
  const newBest = end.prevBest != null && score > end.prevBest;
  const bd = scoreBreakdown(s, cfg);
  const tierRows = bd.rows.map((r) => h('tr', {},
    h('td', { class: `tier-${r.tier}` }, cap(r.tier)),
    h('td', { class: 'num' }, String(r.wins)),
    h('td', { class: 'num' }, `× ${r.each}`),
    h('td', { class: 'num' }, String(r.points))));
  root.append(h('div', { class: 'adv-screen' },
    h('section', { class: `panel adv-over${fell ? '' : ' adv-retired'}` },
      h('div', { class: `adv-headline ${fell ? 'adv-loss' : ''}` }, fell ? 'Game over' : 'Run ended'),
      h('p', {}, fell
        ? (end.enemy ? `Your adventurer fell to ${end.enemy.name} (${end.enemy.tier}) on day ${end.day}.` : `Your adventurer fell on day ${end.day}.`)
        : [`You retired the adventurer on day ${end.day}.`, end.cancelled ? ` Today's fight against ${end.cancelled.name} (${end.cancelled.tier}) did not happen.` : '', ' The run is scored the same as a lost fight.']),
      h('div', { class: 'adv-bignums' },
        h('div', {}, h('div', { class: 'adv-big', id: 'run-score' }, String(score)), h('div', { class: 'muted' }, 'final score')),
        h('div', {}, h('div', { class: 'adv-big' }, String(end.daysSurvived)), h('div', { class: 'muted' }, 'days survived')),
        h('div', {}, h('div', { class: 'adv-big' }, String(totalWins)), h('div', { class: 'muted' }, 'fights won')),
        h('div', {}, h('div', { class: 'adv-big' }, String(best)), h('div', { class: 'muted' }, `best score (v${VERSION})`))),
      newBest ? h('p', { class: 'ok adv-newbest' }, h('b', {}, 'New best score!')) : null,
      h('h4', { class: 'adv-h4' }, 'How your score is worked out'),
      h('table', { class: 'adv-stats adv-wins' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Enemy tier'), h('th', { class: 'num' }, 'Wins'), h('th', { class: 'num' }, 'Points per win'), h('th', { class: 'num' }, 'Points'))),
        h('tbody', {}, tierRows, h('tr', { class: 'adv-total' }, h('td', {}, h('b', {}, 'Score')), h('td', { colspan: 2 }), h('td', { class: 'num' }, h('b', {}, String(bd.total)))))),
      h('p', { class: 'adv-tight muted' }, 'Each win adds points for the enemy\'s tier. Draws and losses add nothing. Every day alive is another chance to win.'),
      h('div', { class: 'row adv-bottom' }, h('button', { class: 'primary', onclick: () => ctx.newGame() }, 'New game'))),
    fatal ? lossPanel(ctx, fatal) : null,
    fatal ? h('h3', { class: 'adv-subtitle' }, 'The fatal battle') : null,
    fatal ? renderBattleReport(fatal, ctx, { analysis: false }) : null));
}

// ------------------------------------------------------------------- plan ----
const isAdvRing = (r, cfg) => ringDef(r.type, cfg).owner === 'adventurer';

function defaultRingIds(state, cfg) {
  return wornRings(state, 'adventurer', cfg).slice(0, cfg.rings.maxWorn).map((r) => r.id);
}

// The plan selection lives in ctx.ui.plan; reset when a new roster (or a new game) appears.
function planSel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  let p = ctx.ui.plan;
  const wornNow = defaultRingIds(s, cfg);
  if (!p || p.rosterDay !== s.roster.day || p.seed !== s.seed) {
    const ringIds = [...wornNow];
    // a ring won today is pre-selected when there is room (the player can untick it)
    const won = s.report && s.report.ring;
    if (won && isAdvRing(won, cfg) && !ringIds.includes(won.id) && ringIds.length < cfg.rings.maxWorn && s.rings.some((r) => r.id === won.id)) ringIds.push(won.id);
    p = ctx.ui.plan = { rosterDay: s.roster.day, seed: s.seed, enemyIndex: null, gearIds: defaultPack(s, cfg), ringIds, wornKey: sortedIds(wornNow), fresh: true };
  } else if (p.wornKey !== sortedIds(wornNow)) {
    // rings worn / removed on the Rings tab while planning: apply the difference to the plan
    const before = new Set((p.wornKey || '').split(',').filter(Boolean).map(Number));
    const now = new Set(wornNow);
    p.ringIds = p.ringIds.filter((id) => !(before.has(id) && !now.has(id)));
    for (const id of wornNow) if (!before.has(id) && !p.ringIds.includes(id) && p.ringIds.length < cfg.rings.maxWorn) p.ringIds.push(id);
    p.wornKey = sortedIds(wornNow);
  }
  p.gearIds = p.gearIds.filter((id) => s.gear.some((g) => g.id === id));
  p.ringIds = p.ringIds.filter((id) => s.rings.some((r) => r.id === id && isAdvRing(r, cfg)));
  if (p.enemyIndex != null && !s.roster.enemies[p.enemyIndex]) p.enemyIndex = null;
  return p;
}

// What the automatic estimates are for: the plan's gear and rings (the chosen enemy is worked out first).
const planScope = (p) => ({ id: 'plan', gearIds: p.gearIds, ringIds: p.ringIds, selected: p.enemyIndex });

// UI-only selection change. The estimates follow by themselves: renderPlan asks scheduleEstimates for the new
// selection, which cancels a run for the old one and starts again after the debounce.
function changeSel(ctx, fn) {
  fn(ctx.ui.plan);
  ctx.rerender();
}

export function renderPlan(root, ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const p = planSel(ctx);
  const sel = p.enemyIndex != null ? s.roster.enemies[p.enemyIndex] : null;
  const selGear = s.gear.filter((g) => p.gearIds.includes(g.id));
  const advRings = s.rings.filter((r) => isAdvRing(r, cfg));
  const selRings = advRings.filter((r) => p.ringIds.includes(r.id));
  const counts = simCounts(s, cfg);
  const scope = planScope(p);
  scheduleEstimates(ctx, scope, { immediate: !!p.fresh }); // the first render of a roster starts at once, later changes wait out the debounce
  p.fresh = false;
  const estimates = s.roster.enemies.map((e, i) => cachedEstimate(ctx, scope, i));
  const est = p.enemyIndex != null ? estimates[p.enemyIndex] : null;
  const pending = estimatesPending(ctx);
  const plan = { enemyIndex: p.enemyIndex, gearIds: [...p.gearIds], ringIds: [...p.ringIds] };
  const err = Game.validatePlan(s, plan, cfg);

  const select = (i, fromKeyboard) => {
    if (fromKeyboard) ctx.ui.plan_focus = i; // the radio group (arrow keys, space): keep the focus after the re-render
    if (p.enemyIndex === i) return;
    changeSel(ctx, (pl) => {
      pl.enemyIndex = i;
    });
  };

  root.append(h('div', { class: 'adv-plan' },
    h('section', { class: 'panel' },
      h('h2', { class: 'adv-h2' }, `Night of day ${s.day}: plan the fight for day ${s.roster.day}`),
      h('p', { class: 'adv-tight' }, `Pick one enemy, pack gear and choose the adventurer's rings. You can pack ${packLimitText(s, cfg)}. `,
        'When the fight starts the enemy is fully revealed and the adventurer uses the best packed item for each gear type. ',
        h('b', {}, 'A lost fight ends the game.'))),
    intelPanel(ctx),
    section('1. Choose an enemy',
      h('p', { class: 'adv-tight muted adv-small' }, 'Click a column to choose that enemy. Each row compares one attribute across the roster: ',
        h('span', { class: 'attr-low' }, 'green = Low'), ' (weaker enemy), ', h('span', { class: 'attr-high' }, 'red = High'), ' (stronger), ? = hidden. ',
        'Offense = what it does to you, defense = how well it resists your attacks. The win-estimate row is worked out automatically for the gear and rings chosen below: ',
        `${counts.samples} guesses x ${counts.evalFights} test fights per enemy (raise with Battle simulation intel and a Foresight ring).`),
      rosterTable(ctx, s.roster.enemies, { day: s.roster.day, selected: p.enemyIndex, onSelect: select, estimates, pending, estimateTip: 'Worked out automatically: your win chance with the gear and rings you have chosen below this table, from test fights against guesses of the hidden attributes' }),
      bannersNote(ctx)),
    h('div', { class: 'cols' }, gearStep(ctx, p, selGear, sel), ringStep(ctx, p, advRings, selRings)),
    estimatePanel(ctx, p, sel, selGear, selRings, est, pending, counts),
    confirmBar(ctx, p, sel, selGear, selRings, est, err)));

  // restore what a re-render would otherwise reset: the table's horizontal scroll and the radio focus
  const scroller = root.querySelector('.rt-scroll');
  if (scroller) {
    restoreScrollLeft(scroller, ctx.ui.plan_scroll);
    scroller.addEventListener('scroll', () => {
      ctx.ui.plan_scroll = scroller.scrollLeft;
    }, { passive: true });
  }
  if (ctx.ui.plan_focus != null) {
    const radio = root.querySelector(`input[data-enemy="${ctx.ui.plan_focus}"]`);
    if (radio) radio.focus({ preventScroll: true });
    ctx.ui.plan_focus = null;
  }
}

// "You have 1 intel point: spend it before you start day 7."
const unspentText = (ctx) => {
  const pts = ctx.state.intel.points;
  return `You have ${pts} intel point${pts === 1 ? '' : 's'}: spend ${pts === 1 ? 'it' : 'them'} before you start day ${ctx.state.roster.day}.`;
};

function intelPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const pts = s.intel.points;
  const per = cfg.intel.daysPerPoint;
  const nextDay = (Math.floor(s.day / per) + 1) * per;
  const tracks = Object.keys(cfg.intel.tracks);
  if (!canSpendIntel(s, cfg)) {
    return h('section', { class: 'panel adv-intel' },
      h('span', { class: 'muted' }, 'Intel: '),
      tracks.map((t, i) => [i ? ' · ' : '', `${cfg.intel.tracks[t].name} `, h('b', {}, trackValueText(t, intelValue(s, t, cfg), cfg))]),
      h('span', { class: 'muted' }, pts > 0 ? ' — every track is at its maximum.' : ` — no intel points (next one at the end of day ${nextDay}).`));
  }
  return h('section', { class: 'panel adv-intel adv-intel-hl' },
    h('h3', {}, 'Intel'),
    h('p', { class: 'adv-tight adv-intel-need' }, h('b', {}, unspentText(ctx))),
    h('p', { class: 'adv-tight muted adv-small' }, `Spend your intel point${pts === 1 ? '' : 's'} on a track below. Spending a point on scouting reveals more of this roster right away (each attribute / ring type / ring grade / banner has a fixed hidden roll; a higher chance uncovers more of them). Ore sight shows more of the items still in the ground when you stand in a field. Battle simulation adds guesses and test fights to the win estimate.`),
    h('div', { class: 'adv-intel-grid' }, tracks.map((t) => {
      const cur = intelValue(s, t, cfg);
      const gain = nextIntelGain(s, t, cfg);
      return h('div', { class: 'adv-intel-item', ...tip(intelTip(t, cfg)) },
        h('span', { class: 'adv-intel-name' }, h('b', {}, cfg.intel.tracks[t].name), ' ', trackValueText(t, cur, cfg), gain > 0 ? ` → ${trackValueText(t, cur + gain, cfg)}` : ''),
        gain > 0
          ? h('button', {
            class: 'small primary',
            'data-intel': t,
            onclick: () => ctx.act(() => spendIntelAction(ctx, t), { toast: true }),
          }, 'Spend')
          : h('span', { class: 'muted adv-small' }, 'maxed'));
    })));
}

// The icon of one gear row (⚠ or ✓) and everything the hover says about the item. Could-break comes first.
function gearFlag(ctx, g, sel, known) {
  const { state: s, cfg } = ctx;
  const tier = sel ? sel.tier : null;
  const lines = [];
  let icon = null;
  const risk = couldBreak(g, s, tier, cfg);
  if (risk) {
    icon = 'warn';
    lines.push(couldBreakText(s, cfg, g, sel ? sel.name : null, tier));
  }
  for (const n of gearMatchNotes(g, sel, known, cfg)) {
    if (n.kind === 'warn' && !icon) icon = 'warn';
    if (n.kind === 'ok' && !icon) icon = 'ok';
    lines.push(`${cap(n.text)}.`);
  }
  if (g.durability < 100) lines.push(repairHomeText(s, g, cfg));
  return { icon, risk, text: lines.join('\n') };
}

// "If left home: repair ~11.6m, 0.32 Iron C bars." (what repairing it tomorrow would cost), or why it cannot be done yet.
function repairHomeText(state, g, cfg) {
  const plan = repairPlan(state, g, cfg);
  if (!plan.ok) return `If left home: it cannot be repaired yet. ${plan.reason}`;
  const parts = Object.entries(plan.bars).map(([k, n]) => {
    const [m, gr] = k.split(':');
    return `${qtyText(n)} ${cap(m)} ${gr} ${n === 1 ? 'bar' : 'bars'}`;
  });
  for (const [k, n] of Object.entries(plan.gems)) {
    const [t, gr] = k.split(':');
    parts.push(`${qtyText(n)} cut ${cap(t)} ${gr}`);
  }
  return `If left home: repair ~${num(plan.minutes)}m${parts.length ? `, ${parts.join(' + ')}` : ''}.`;
}

// "up to 2 per gear type (3 swords: pack mule)": the pack limit as it stands, with the types a pack mule has raised.
function packLimitText(s, cfg) {
  const mules = SLOTS.filter((slot) => packLimit(s, slot, cfg) > cfg.plan.perSlot);
  const raised = mules.map((slot) => `${packLimit(s, slot, cfg)} ${slotNoun(slot, packLimit(s, slot, cfg))}`).join(', ');
  return `up to ${cfg.plan.perSlot} per gear type${mules.length ? ` (${raised}: pack mule${mules.length === 1 ? '' : 's'})` : ''}`;
}

function gearStep(ctx, p, selGear, sel) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const tier = sel ? sel.tier : null;
  const known = sel ? knownLevels(s, sel, cfg) : {};
  const counts = {};
  for (const g of selGear) counts[g.slot] = (counts[g.slot] || 0) + 1;
  const wear = wearRange(s, cfg, tier); // the chosen enemy's tier, else any tier
  const order = packOrder(cfg);
  const rows = [];
  for (const slot of SLOTS) {
    const items = s.gear.filter((g) => g.slot === slot).sort(order);
    const limit = packLimit(s, slot, cfg);
    const n = counts[slot] || 0;
    rows.push(h('tr', { class: 'adv-slotrow' }, h('td', { colspan: 3 },
      h('b', {}, cap(slot)), h('span', { class: 'muted' }, ` ${n}/${limit} packed`),
      items.length === 0 ? h('span', { class: 'muted' }, slot === 'sword' ? ` · none owned (unarmed: ${num(cfg.adventurer.unarmedDamage, 2)} damage)` : ' · none owned')
        : n === 0 ? h('span', { class: 'warn' }, ` · nothing packed (you own ${items.length})`) : null)));
    for (const g of items) {
      const on = p.gearIds.includes(g.id);
      const full = !on && n >= limit;
      const flag = gearFlag(ctx, g, sel, known);
      rows.push(h('tr', { class: on ? 'adv-on' : full ? 'adv-off' : '' },
        h('td', {}, h('input', {
          type: 'checkbox',
          checked: on,
          disabled: full,
          ...(full ? tip(`Already ${limit} ${slotNoun(slot, limit)} packed`) : {}),
          'data-gear': g.id,
          onchange: () => changeSel(ctx, (pl) => {
            pl.gearIds = on ? pl.gearIds.filter((id) => id !== g.id) : [...pl.gearIds, g.id];
          }),
        })),
        h('td', {}, gearCell(g, cfg)),
        // the ⚠ / ✓ icon sits at the end of the durability cell (a column of its own did not fit a phone)
        h('td', {}, h('div', { class: 'adv-dur', ...tip(`A used item loses ${Math.floor(wear.min + 1e-9)}-${Math.ceil(wear.max - 1e-9)}% durability per fight`) },
          bar(g.durability, flag.risk ? 'adv-dur-low' : g.durability < 50 ? 'adv-dur-mid' : ''), h('span', { class: flag.risk ? 'err' : '' }, durText(g.durability)),
          h('span', { class: `adv-flag ${flag.icon || ''}`, 'data-flag': flag.icon || 'none', ...(flag.text ? tip(flag.text) : {}) }, flag.icon === 'warn' ? '⚠' : flag.icon === 'ok' ? '✓' : '')))));
    }
  }
  const combos = loadouts(selGear).length;
  return section('2. Pack gear',
    h('p', { class: 'adv-tight' }, `Pack ${packLimitText(s, cfg)}.`),
    h('p', { class: 'adv-tight muted' }, 'Repairs happen at camp during the day, on gear the adventurer does not have. To repair an item, leave it home: tomorrow you can repair it in the Workshop.'),
    h('p', { class: 'adv-tight muted' }, 'Packed gear is away with the adventurer all day tomorrow. Only the items actually used lose durability: ',
      wearText(s, cfg, tier), '. ', h('span', { class: 'warn' }, '⚠'), ' = could break against ', sel ? sel.name : 'the toughest enemy', ' (an item always lasts the whole fight), or a sword gem blunted by a High resistance you can see; ', h('span', { class: 'ok' }, '✓'), ' = its gem answers a High special you can see. Hover or tap an icon for the details.'),
    h('div', { class: 'row adv-tight' },
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = defaultPack(ctx.state, ctx.cfg, sel ? sel.tier : null); }) }, 'Best per type'),
      h('button', { class: 'small', ...tip(`Takes out the items below ${cfg.plan.leaveHomeBelow}% that you have the bars to repair tomorrow. The best item of each gear type always stays.`), onclick: () => changeSel(ctx, (pl) => { pl.gearIds = leaveWornHome(ctx.state, pl.gearIds, ctx.cfg); }) }, `Leave worn gear home (below ${cfg.plan.leaveHomeBelow}%)`),
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = []; }) }, 'Pack nothing'),
      h('span', { class: 'muted adv-small' }, `${selGear.length} packed · ${combos} gear combination${combos === 1 ? '' : 's'} for the adventurer to choose from`)),
    s.gear.length
      ? h('div', { class: 'adv-scroll' }, h('table', { class: 'adv-stats adv-geartable' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pack'), h('th', {}, 'Item and stats'), h('th', { ...tip('Durability, then a warning (⚠) or a match (✓)') }, 'Durability'))),
        h('tbody', {}, rows)))
      : h('p', { class: 'warn' }, 'You own no gear: the adventurer fights unarmed with no armor.'));
}

function ringStep(ctx, p, advRings, selRings) {
  const cfg = ctx.cfg;
  const max = cfg.rings.maxWorn;
  const contrib = ringContributions(selRings, cfg);
  const totals = ringTotals(selRings, cfg);
  const full = selRings.length >= max;
  const sorted = advRings.slice().sort((a, b) => ringDef(a.type, cfg).name.localeCompare(ringDef(b.type, cfg).name) || ringValue(b, cfg) - ringValue(a, cfg) || a.id - b.id);
  const rows = sorted.map((r) => {
    const d = ringDef(r.type, cfg);
    const on = p.ringIds.includes(r.id);
    let eff;
    if (on) {
      const c = contrib[r.id];
      eff = h('span', {}, h('b', {}, `+${f2(c.effective)}`), c.factor < 1 ? h('span', { class: 'warn' }, ` (${num(c.factor * 100, 1)}%: duplicate)`) : null);
    } else {
      const add = (ringTotals([...selRings, r], cfg)[r.type] || 0) - (totals[r.type] || 0);
      eff = h('span', { class: 'muted' }, `would add +${f2(add)}`);
    }
    return h('tr', { class: on ? 'adv-on' : full ? 'adv-off' : '' },
      h('td', {}, h('input', {
        type: 'checkbox',
        checked: on,
        disabled: !on && full,
        title: !on && full ? `The adventurer can wear at most ${max} rings` : '',
        'data-ring': r.id,
        onchange: () => changeSel(ctx, (pl) => {
          pl.ringIds = on ? pl.ringIds.filter((id) => id !== r.id) : [...pl.ringIds, r.id];
        }),
      })),
      h('td', {}, ringNameNode(r, cfg)),
      h('td', { class: 'num' }, String(ringValue(r, cfg))),
      h('td', {}, eff),
      h('td', { class: 'muted adv-small' }, d.desc));
  });
  const totalList = Object.entries(totals).map(([type, v]) => {
    const d = ringDef(type, cfg);
    return h('span', { class: 'chip' }, `${d.name} +${f2(v)}`, h('span', { class: 'muted' }, ` ${d.desc}`));
  });
  return section(`3. Adventurer rings (${selRings.length}/${max})`,
    h('p', { class: 'adv-tight muted' }, `Same type: the best counts 100%, the 2nd ${cfg.rings.duplicateFactor * 100}%, the 3rd ${cfg.rings.duplicateFactor ** 2 * 100}%, … Smith rings don't help in fights.`),
    advRings.length
      ? [
        h('div', { class: 'row adv-tight' },
          h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.ringIds = defaultRingIds(ctx.state, ctx.cfg); }) }, 'Currently worn'),
          h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.ringIds = []; }) }, 'None')),
        h('div', { class: 'adv-scroll' }, h('table', { class: 'adv-stats' },
          h('thead', {}, h('tr', {}, h('th', {}, 'Wear'), h('th', {}, 'Ring'), h('th', { class: 'num' }, 'Value'), h('th', {}, 'Counts as'), h('th', {}, 'Effect'))),
          h('tbody', {}, rows))),
        h('div', { class: 'chips adv-totals' }, totalList.length ? totalList : h('span', { class: 'muted' }, 'No rings selected.')),
      ]
      : h('p', { class: 'muted' }, 'No adventurer rings yet. Defeated enemies drop rings.'));
}

// Levels a hidden attribute could still have, given the tier's exact low/normal/high counts.
function possibleLevels(cfg, tier, known, key) {
  if (key in known) return [known[key]];
  const counts = { ...cfg.enemies.tiers[tier].levels };
  for (const lv of Object.values(known)) counts[lv] -= 1;
  return LEVELS.filter((lv) => counts[lv] > 0);
}

// [min, max] of fn(enemyCombatant) over every possible level of the given attributes.
function rangeOver(cfg, enemy, known, keys, fn) {
  const lists = keys.map((k) => possibleLevels(cfg, enemy.tier, known, k));
  let lo = Infinity;
  let hi = -Infinity;
  const base = Object.fromEntries(Object.keys(cfg.enemies.attributes).map((k) => [k, 'normal']));
  const rec = (i, lv) => {
    if (i === keys.length) {
      const v = fn(enemyCombatant(enemy.tier, enemy.day, { ...base, ...lv }, enemy.name, cfg));
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
      return;
    }
    for (const l of lists[i]) rec(i + 1, { ...lv, [keys[i]]: l });
  };
  rec(0, {});
  return [lo, hi];
}

// "✓ Magical (ruby chest) · ✗ Stunning (no topaz armor packed)": the High specials you can see and whether the packed armor answers them.
function answersNodes(answers) {
  if (!answers.length) return h('span', { class: 'muted' }, 'No High special to answer that you can see.');
  return answers.map((a, i) => [i ? ' · ' : '', a.ok
    ? h('span', { class: 'ok' }, `✓ ${a.special} (${a.item})`)
    : h('span', { class: 'err' }, `✗ ${a.special} (no ${a.gem} armor packed)`)]);
}

// Matchup numbers the player can check without simulating: hit chances, damage per hit,
// attack speed, HP and a rough time-to-kill each way. Hidden attributes show as a range.
function matchupTable(ctx, sel, preview, packed = []) {
  const cfg = ctx.cfg;
  const known = knownLevels(ctx.state, sel, cfg);
  const advInt = attackInterval(preview, false, 0);
  const R = (keys, fn) => rangeOver(cfg, sel, known, keys, fn);
  const fmt = ([lo, hi], d, unit = '') => (num(lo, d) === num(hi, d) ? `${num(lo, d)}${unit}` : `${num(lo, d)}–${num(hi, d)}${unit}`);
  const myHit = (e) => hitChance(preview.accuracy, e.dodge, cfg) * 100;
  const enHit = (e) => hitChance(e.accuracy, preview.dodge, cfg) * 100;
  const myDmg = (e) => hitDamage(preview, e, cfg).total;
  const enDmg = (e) => hitDamage(e, preview, cfg).total;
  const myDps = (e) => (myHit(e) / 100) * myDmg(e) / advInt;
  const enDps = (e) => (enHit(e) / 100) * enDmg(e) / attackInterval(e, false, 0);
  const rows = [
    ['Hit chance', fmt(R(['evasion'], myHit), 1, '%'), fmt(R(['accurate'], enHit), 1, '%')],
    ['Damage per hit (avg)', fmt(R(['pierceRes', 'magicRes'], myDmg), 1), fmt(R(['piercing', 'magical'], enDmg), 1)],
    ['Attacks every', `${num(advInt, 2)}s`, fmt(R(['fast'], (e) => attackInterval(e, false, 0)), 2, 's')],
    ['Expected damage / second', fmt(R(['evasion', 'pierceRes', 'magicRes'], myDps), 2), fmt(R(['accurate', 'piercing', 'magical', 'fast'], enDps), 2)],
    ['HP', num(preview.hp, 1), fmt(R(['hp'], (e) => e.hp), 1)],
    ['Rough time to win / to lose', fmt(R(['hp', 'evasion', 'pierceRes', 'magicRes'], (e) => e.hp / Math.max(1e-9, myDps(e))), 0, 's'), fmt(R(['accurate', 'piercing', 'magical', 'fast'], (e) => preview.hp / Math.max(1e-9, enDps(e))), 0, 's')],
  ];
  return h('div', {},
    h('h4', { class: 'adv-h4' }, `Matchup vs ${sel.name}`),
    h('table', { class: 'adv-stats' },
      h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, 'Adventurer'), h('th', { class: 'num' }, sel.name))),
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r[0]), h('td', { class: 'num' }, r[1]), h('td', { class: 'num' }, r[2]))),
        h('tr', { class: 'adv-answers' }, h('td', {}, 'Your answers'), h('td', { colspan: 2, class: 'adv-answers-cell' }, answersNodes(gearAnswers(packed, known, cfg)))))),
    h('p', { class: 'adv-tight muted adv-small' }, 'Uses the preview gear above. Ranges cover the levels hidden attributes could still have. Ignores stuns, slows and damage rolls — run the estimate for the full picture.'));
}

// "5 guesses x 5 test fights per enemy" and how to raise it. counts = simCounts(state); est = the chosen
// enemy's finished estimate (or null): the caveat then states its actual margin.
function estimateHow(ctx, sel, counts, est = null) {
  const { state, cfg } = ctx;
  const known = sel ? knownLevels(state, sel, cfg) : null;
  const nHidden = known ? Object.keys(cfg.enemies.attributes).length - Object.keys(known).length : null;
  const o = cfg.sim;
  const m = shownMargin(est);
  const intelPart = intelValue(state, 'simDepth', cfg);
  const ringPart = counts.extra - intelPart;
  return h('div', { class: 'adv-how' },
    h('p', { class: 'muted adv-small' },
      h('b', {}, `Worked out automatically: ${counts.samples} guesses of the hidden attributes x ${counts.evalFights} test fights each`),
      ` (base ${o.samples} x ${o.evalFights}, +1 per Battle simulation point and Foresight ring step${counts.extra ? `; now +${counts.extra}: ${[intelPart ? `+${intelPart} from Battle simulation intel` : null, ringPart ? `+${ringPart} from your Foresight ring` : null].filter(Boolean).join(' and ')}` : ''}). `,
      `For each guess${nHidden != null ? ` (${nHidden} ${nHidden === 1 ? 'attribute' : 'attributes'} hidden for ${sel.name})` : ''}, consistent with the tier mix, the adventurer picks the best packed gear (${counts.fightsPerLoadout} test fights per gear combination it tries), then fights ${counts.evalFights} fresh fights: ${counts.samples * counts.evalFights} fights per enemy. A draw (safety time cap) counts as survival.`),
    h('p', { class: 'muted adv-small', 'data-margin-note': m != null ? m : null },
      m != null
        ? ['This estimate is ', h('b', {}, winWithMargin(est)), ` point${m === 1 ? '' : 's'}. `]
        : null,
      'The ± is how far the test fights alone could be off; hidden attributes can make the real chance higher or lower. It is a rough guide, and a risk you take on. To make it steadier, spend intel on ',
      h('b', {}, cfg.intel.tracks.simDepth.name), ' (Skills & Intel) or wear a ', h('b', {}, cfg.rings.types.foresight.name), ` smith ring (Rings tab; only your best one counts). Both add guesses and test fights, which tightens the ± and makes the work slower.`));
}

function estimatePanel(ctx, p, sel, selGear, selRings, est, pending, counts) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const preview = adventurerCombatant(bestPerSlot(selGear, 1, cfg), ringTotals(selRings, cfg), cfg);
  const left = h('div', {},
    h('h4', { class: 'adv-h4' }, 'Adventurer preview'),
    h('p', { class: 'adv-tight muted adv-small' }, 'With the strongest-looking packed item per gear type and the selected rings (the real choice is made by simulation once the enemy is known).'),
    combatStatsTable([{ label: 'Adventurer', c: preview }]),
    sel ? matchupTable(ctx, sel, preview, selGear) : null);

  let right;
  const how = estimateHow(ctx, sel, counts, est);
  if (!sel) {
    right = h('div', {}, h('p', { class: 'muted' }, 'Pick an enemy to see the details of its estimate. The win-estimate row of the table above is worked out for every enemy by itself.'), how);
  } else if (est) {
    const c = est.counts || counts;
    const name = (id) => {
      const g = s.gear.find((x) => x.id === id);
      return g ? gearNameNode(g) : `#${id}`;
    };
    right = h('div', {},
      h('div', { class: 'adv-bignums' },
        h('div', {}, h('div', { class: `adv-big ${winClass(est.winPct)}`, ...(shownMargin(est) != null ? tip(`± ${shownMargin(est)} is how far the test fights alone could be off. Hidden attributes can make the real chance higher or lower.`) : {}) },
          winText(est.winPct), shownMargin(est) != null ? h('span', { class: 'adv-pm' }, ` ± ${shownMargin(est)}`) : null), h('div', { class: 'muted' }, shownMargin(est) != null ? 'win chance (± points)' : 'win chance')),
        h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgTime)}s`), h('div', { class: 'muted' }, 'avg fight time')),
        h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgHpLeftPct)}%`), h('div', { class: 'muted' }, 'avg HP left (wins)'))),
      h('p', { class: 'adv-small muted' }, `${est.fights} simulated fights vs ${sel.name} (${c.samples} guesses x ${c.evalFights}).`),
      h('h4', { class: 'adv-h4' }, 'Gear the adventurer would use'),
      est.usage.length && est.usage[0].ids
        ? h('table', { class: 'adv-stats' },
          h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Guesses'), h('th', {}, 'Items'))),
          h('tbody', {}, est.usage.slice(0, 6).map((u) => h('tr', {},
            h('td', { class: 'num' }, `${Math.round((u.count / c.samples) * 100)}%`),
            h('td', {}, u.ids.split(',').map((id, i) => [i ? ', ' : '', name(Number(id))]))))))
        : h('p', { class: 'muted' }, 'No gear packed (unarmed).'),
      est.usage.length > 6 ? h('p', { class: 'muted adv-small' }, `… and ${est.usage.length - 6} more combinations.`) : null,
      how);
  } else {
    right = h('div', {}, h('p', { class: 'muted' }, pending ? `Working out the win chance against ${sel.name}…` : `${sel.name} has no estimate for this selection.`), how);
  }
  return section(sel ? `Win chance vs ${sel.name}` : 'Win chance', h('div', { class: 'cols' }, left, h('div', {}, h('h4', { class: 'adv-h4' }, 'Estimate'), right)));
}

function confirmBar(ctx, p, sel, selGear, selRings, est, err) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const blocked = canSpendIntel(s, cfg);
  const status = estimateStatus(ctx);
  return h('div', { class: 'adv-bar' },
    h('div', { class: 'adv-bar-info' },
      sel ? ['Fight ', h('b', {}, sel.name), ' ', h('span', { class: `tier-${sel.tier}` }, `(${sel.tier})`), ' tomorrow'] : h('span', { class: 'warn' }, 'No enemy chosen'),
      h('span', { class: 'muted' }, ` · ${selGear.length} gear packed · ${selRings.length}/${cfg.rings.maxWorn} rings`),
      est ? h('span', {}, ' · win ≈ ', h('b', { class: winClass(est.winPct) }, winWithMargin(est))) : sel ? h('span', { class: 'muted' }, estimatesPending(ctx) ? ' · working out the win chance…' : ' · no estimate') : null,
      blocked ? h('div', { class: 'warn adv-small adv-intel-block' }, unspentText(ctx)) : null,
      err ? h('div', { class: 'warn adv-small' }, err) : null,
      h('div', { class: 'muted adv-small est-status' }, status || '')),
    h('button', {
      class: 'primary',
      id: 'adv-confirm',
      disabled: blocked,
      ...(blocked ? tip(unspentText(ctx)) : {}),
      onclick: () => confirmClicked(ctx, p),
    }, `Confirm & start day ${s.roster.day}`));
}

// The Confirm button: check the plan, ask once about anything risky (a loss ends the game), then lock it in.
function confirmClicked(ctx, p) {
  const st = ctx.state;
  const cfg = ctx.cfg;
  const sel = p.enemyIndex != null ? st.roster.enemies[p.enemyIndex] : null;
  const chosen = sel ? cachedEstimate(ctx, planScope(p), p.enemyIndex) : null;
  const plan = {
    enemyIndex: p.enemyIndex,
    gearIds: [...p.gearIds],
    ringIds: [...p.ringIds],
    shownEstimate: chosen ? { winPct: chosen.winPct, margin: shownMargin(chosen) } : null,
  };
  const e2 = Game.validatePlan(st, plan, cfg);
  if (e2) {
    ctx.toast(e2, 'err');
    return;
  }
  const warn = [];
  if (st.gear.length && !plan.gearIds.length) warn.push('You own gear but packed none.');
  for (const slot of SLOTS) {
    if (st.gear.some((g) => g.slot === slot) && !plan.gearIds.some((id) => st.gear.find((g) => g.id === id)?.slot === slot)) warn.push(`No ${slot} packed, though you own one.`);
  }
  const breaking = st.gear.filter((g) => plan.gearIds.includes(g.id) && couldBreak(g, st, sel.tier, cfg));
  if (breaking.length) warn.push(`${breaking.length} packed item${breaking.length === 1 ? '' : 's'} could break in this fight: ${breaking.map(gearName).join(', ')}.`);
  if (!chosen) warn.push(`The win estimate for ${sel.name} is not finished yet.`);
  else if (chosen.winPct < 50) warn.push(`Estimated win chance is only ${winWithMargin(chosen)}.`);
  if (warn.length && !confirm(`${warn.join('\n')}\n\nA lost fight ends the game. Confirm anyway?`)) return;
  const res = ctx.act(() => Game.confirmPlan(ctx.state, plan, ctx.cfg));
  if (res && res.ok) {
    cancelEstimates(ctx);
    ctx.ui.plan = null;
  }
}
