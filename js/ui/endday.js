// End-of-day screens: battle report (phase 'report'), plan tomorrow's fight (phase 'plan'),
// game over (phase 'over').
// Also exports widgets reused by the Adventurer tab and the Log tab: rosterTable (one enemy per column),
// enemyCard (a single enemy), renderBattleReport, renderCombatLog, combatStatsTable and small gear/ring helpers.
// All game-state changes go through core actions inside ctx.act(). UI-only state lives in ctx.ui.plan*.
import { h, section, bar, num } from './dom.js';
import { SLOTS, GRADES, LEVELS, TIERS } from '../config.js';
import * as Game from '../core/game.js';
import { enemyBase, enemyCombatant, knownLevels, ringTypeVisible, ringGradeVisible } from '../core/enemies.js';
import { estimateWinChance, loadouts, simCounts } from '../core/sim.js';
import { adventurerCombatant, attackInterval, hitChance, hitDamage } from '../core/combat.js';
import { ringTotals, ringContributions, ringValue, ringDef, ringLabel, wornRings } from '../core/rings.js';
import { gearStats, isNight, wearLoss } from '../core/gear.js';
import { smithBonuses } from '../core/bonuses.js';
import { intelValue, nextIntelGain, trackValueText } from '../core/intel.js';
import { mixSeed } from '../core/rng.js';
import { cap } from '../core/util.js';
import { repairLine, repairAllButton } from './repairui.js';
import { spendIntelAction } from './skillsview.js';

// ------------------------------------------------------------------ format ----
const f1 = (v) => num(v, 1);
const f2 = (v) => num(v, 2);
const pctf = (v, d = 1) => `${num(v, d)}%`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${num(v, 1)}%`;
const LV = { low: 'Low', normal: 'Normal', high: 'High' };
const planTracks = (cfg) => Object.keys(cfg.intel.tracks); // the plan screen offers every intel track

// "25%", "120", "+5%" — the attribute's value with its unit (pierce resistance is a % of your piercing ignored).
export function attrValueText(key, level, cfg) {
  const v = cfg.enemies.attributes[key].values[level];
  if (key === 'accurate' || key === 'evasion') return String(v);
  if (key === 'fast') return `${v > 0 ? '+' : ''}${v}%`;
  return `${v}%`;
}

const mixText = (c) => `${c.low} low · ${c.normal} normal · ${c.high} high`;

// -------------------------------------------------------------- gear/ring ----
// Rough strength of an item: material multiplier x grade multiplier (ignores gems).
export const gearPower = (g, cfg) => cfg.gear.materialMult[g.material] * cfg.gear.gradeMult[g.grade];

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
    h('span', { class: 'muted adv-small', title: 'Material x grade multiplier' }, ` x${f2(gearPower(g, cfg))}`),
    h('div', { class: 'adv-gstats' }, gearStatsText(g, cfg)),
  ];
}

export function gearNameNode(g) {
  return h('span', { class: 'adv-gname' },
    h('span', { class: `grade-${g.grade}` }, g.grade), ` ${cap(g.material)} ${cap(g.slot)}`,
    g.gem ? h('span', { class: 'adv-gem' }, ` +${cap(g.gem.type)} `, h('span', { class: `grade-${g.gem.grade}` }, g.gem.grade)) : null);
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

// "8.8-13.2% per fight (avg 10.6%; more against tougher enemies: x1 / x1.1 / x1.2 ...; 5% less from Gear care)" for notes and tooltips.
export function wearText(state, cfg, tier = null) {
  const w = wearRange(state, cfg, tier);
  const dl = cfg.gear.durabilityLoss;
  const extra = [];
  if (w.avg != null) extra.push(`avg ${num(w.avg, 1)}%`);
  if (!tier && dl.tierMult) extra.push(`more against tougher enemies: x${TIERS.map((t) => dl.tierMult[t] || 1).join(' / x')} for ${TIERS.join(' / ')}`);
  if (tier && dl.tierMult && (dl.tierMult[tier] || 1) !== 1) extra.push(`x${dl.tierMult[tier]} against ${/^[aeiou]/i.test(tier) ? 'an' : 'a'} ${tier} enemy`);
  if (w.red > 0) extra.push(`${num(w.red, 1)}% less from Gear care`);
  return `${num(w.min, 1)}-${num(w.max, 1)}% per fight${extra.length ? ` (${extra.join('; ')})` : ''}`;
}

// wear: { min, max } from wearRange (defaults to the raw config range).
export function durabilityNode(g, cfg, wear) {
  const d = g.durability;
  const { min, max } = wear || cfg.gear.durabilityLoss;
  const risky = d <= max;
  const cls = risky ? 'adv-dur-low' : d < 50 ? 'adv-dur-mid' : '';
  return h('div', { class: 'adv-dur', title: risky ? `Could break in its next fight (a used item loses ${num(min, 1)}-${num(max, 1)}% per fight; 0% = destroyed)` : `A used item loses ${num(min, 1)}-${num(max, 1)}% durability per fight` },
    bar(d, cls), h('span', { class: risky ? 'err' : '' }, `${f1(d)}%`));
}

export function ringNameNode(r, cfg) {
  const d = ringDef(r.type, cfg);
  return h('span', { class: 'adv-rname', title: ringLabel(r, cfg) }, `${d.name} `, h('span', { class: `grade-${r.grade}` }, r.grade));
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

// "Normal · 15%" chip, or "?" while the level is hidden.
function levelChip(cfg, key, lv) {
  return lv
    ? h('span', { class: `adv-lv attr-${lv}` }, `${LV[lv]} · ${attrValueText(key, lv, cfg)}`)
    : h('span', { class: 'adv-lv attr-unknown' }, '?');
}

// Tooltip for an attribute: what it does and the value at each level.
function attrTitle(cfg, key) {
  const a = cfg.enemies.attributes[key];
  return `${a.name}: ${a.desc}. ${LEVELS.map((l) => `${LV[l]} ${attrValueText(key, l, cfg)}`).join(' / ')}`;
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
  const odds = Object.entries(weights).map(([g, w]) => `${g} ${w}%`).join(', ');
  let detail = null;
  if (tv && gv) detail = ringEffectText(def, ringValue(enemy.ring, cfg));
  else if (tv) {
    const vals = Object.keys(weights).map((g) => def.values[GRADES.indexOf(g)]);
    detail = ringEffectText(def, `${Math.min(...vals)}-${Math.max(...vals)}`);
  }
  return h('div', { class: 'adv-ring' },
    h('span', { class: 'muted' }, 'Ring reward: '),
    tv ? h('b', { title: def.desc }, def.name) : h('span', { class: 'adv-lv attr-unknown', title: `Type hidden: any of ${nTypes} ring types (equally likely)` }, '? type'),
    ' ',
    gv ? h('span', { class: `adv-lv grade-${enemy.ring.grade}` }, enemy.ring.grade)
      : h('span', { class: 'adv-lv attr-unknown', title: `Grade hidden. ${cap(enemy.tier)} odds: ${odds}` }, '? grade'),
    gv ? null : h('span', { class: 'muted' }, ` (${odds})`),
    detail ? h('span', { class: 'muted' }, ` = ${detail}`) : null,
    tv ? h('span', { class: def.owner === 'adventurer' ? 'adv-owner' : 'adv-owner muted' }, ` · ${def.owner} ring`) : null);
}

// "6% less travel time" / "6 more guesses ..." (value + the ring type's description)
const ringEffectText = (def, v) => (def.desc.startsWith('%') ? `${v}${def.desc}` : `${v} ${def.desc}`);

// One enemy: name, tier, base numbers, 12 attributes in offense|defense pairs, tier mix, ring reward.
// Used for a single enemy (today's opponent, the battle report); rosters use rosterTable.
// opts: { reveal (show all levels), ring (default true), day }
export function enemyCard(ctx, enemy, opts = {}) {
  const { cfg } = ctx;
  const v = enemyView(ctx, enemy, opts);
  const { A, tierCfg, day, base, known, hidden, rem, hpText } = v;
  const stat = (label, value, title) => h('span', { class: 'adv-bstat', title }, h('span', { class: 'muted' }, `${label} `), h('b', {}, value));
  const growthPct = Math.round((base.ratingMult - 1) * 100);
  const baseLine = h('div', { class: 'adv-base' },
    stat('HP', hpText, `Base ${f1(base.hp)} (day ${day}) x HP attribute`),
    stat('Damage', f1(base.damage), 'Damage per hit before magic, defense and piercing'),
    stat('Defense', `${base.defense}%`, 'Reduces your physical damage (piercing ignores part of it)'),
    stat('Ratings', `x${f2(base.ratingMult)}`, `Accurate and Evasion values are multiplied by ${f2(base.ratingMult)} (+${growthPct}% daily growth)`));

  const cell = (k) => h('div', { class: 'adv-attr', title: attrTitle(cfg, k) }, h('span', { class: 'adv-an' }, A[k].name), levelChip(cfg, k, known[k]));
  const pairs = h('div', { class: 'adv-pairs' },
    h('div', { class: 'adv-ph' }, 'Offense'), h('div', { class: 'adv-ph' }, 'Defense'),
    cfg.enemies.pairs.flatMap(([o, d]) => [cell(o), cell(d)]));

  const mix = h('div', { class: 'adv-mix' }, `Tier mix: ${mixText(tierCfg.levels)}`,
    opts.reveal ? null : hidden > 0 ? h('span', {}, ` — ${hidden} hidden, among them: `, h('b', {}, mixText(rem))) : ' — all known');

  const head = h('div', { class: 'adv-ehead' },
    h('span', { class: 'adv-ename' }, enemy.name),
    h('span', { class: `adv-tier tier-${enemy.tier}` }, cap(enemy.tier)),
    h('span', { class: 'muted' }, `+${tierCfg.score} pts`));

  return h('div', { class: 'enemy-card adv-ecard' }, head, baseLine, pairs, mix, opts.ring === false ? null : ringRewardNode(ctx, enemy));
}

// ----------------------------------------------------------- roster table ----
// All enemies of a roster side by side, ONE ENEMY PER COLUMN, so every row compares the same thing:
// name, tier, base numbers, ring reward, (win estimate), then the 6 offensive attributes, a divider,
// the 6 defensive ones. Cells show Low / Normal / High + value, "?" while hidden.
// opts: { day, selected (column index), onSelect(i) (columns become choosable), estimates: [result|null] per
//         column (adds the "Win estimate" row), running (an estimate run is in progress) }
export function rosterTable(ctx, enemies, opts = {}) {
  const { cfg } = ctx;
  const A = cfg.enemies.attributes;
  const views = enemies.map((e) => enemyView(ctx, e, { day: opts.day }));
  const sel = opts.selected ?? null;
  const pick = opts.onSelect || null;
  const nCols = enemies.length;

  const colCls = (i, extra = '') => `rt-c${i === sel ? ' rt-sel' : ''}${pick ? ' rt-pick' : ''}${extra ? ` ${extra}` : ''}`;
  const colAttrs = (i, extra) => ({ class: colCls(i, extra), 'data-col': i, onclick: pick ? () => pick(i) : null });
  const rowHead = (label, title) => h('th', { class: 'rt-row', scope: 'row', title }, label);
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

  const tier = row('Tier', 'Tier and the score for a win', (e, v) => [
    h('div', { class: `adv-tier tier-${e.tier}`, title: `Tier mix: ${mixText(v.tierCfg.levels)}` }, cap(e.tier)),
    h('div', { class: 'muted rt-sm' }, `+${v.tierCfg.score} pts`)]);
  const baseHp = row('Base HP', 'Base HP on the fight day, before the HP attribute (see the HP row below)', (e, v) => f1(v.base.hp));
  const baseDmg = row('Damage', 'Damage per hit before magic, defense and piercing', (e, v) => f1(v.base.damage));
  const baseDef = row('Defense', 'Reduces your physical damage (piercing ignores part of it)', (e, v) => `${v.base.defense}%`);
  const growth = row('Rating growth', 'Accurate and Evasion values below are multiplied by this (daily growth)', (e, v) => `x${f2(v.base.ratingMult)}`);
  const ring = row('Ring reward', 'The ring a win drops (hidden until your ring scouting reveals it)', (e) => ringRewardCell(ctx, e));
  const hiddenRow = row('Hidden attributes', 'How many of the 12 attributes you cannot see yet, and the Low / Normal / High levels they can still have', (e, v) => (v.hidden > 0
    ? [h('b', {}, String(v.hidden)), h('div', { class: 'muted rt-sm' }, remText(v.rem))]
    : h('span', { class: 'muted' }, 'none')));

  const rows = [tier, baseHp, baseDmg, baseDef, growth, ring, hiddenRow];
  if (opts.estimates) {
    rows.push(h('tr', { class: 'rt-est' }, rowHead('Win estimate', 'Estimated win chance with the current gear and ring selection (press Estimate all)'),
      enemies.map((e, i) => h('td', { ...colAttrs(i), 'data-est': i }, estimateCell(opts.estimates[i], opts.running)))));
  }

  const sectionRow = (label, sub) => h('tr', { class: 'rt-sect' }, h('th', { class: 'rt-row', scope: 'rowgroup' }, label), h('td', { colspan: nCols }, h('span', { class: 'rt-sect-sub' }, sub)));
  // The Defense divider repeats the enemy names (one small muted name per column; clicking or highlighting works
  // like the column's other cells), so the names stay in view while comparing the defensive rows far below the header.
  const namesRow = (label, sub) => h('tr', { class: 'rt-sect rt-sect-names' },
    h('th', { class: 'rt-row', scope: 'rowgroup', title: sub }, label),
    enemies.map((e, i) => h('td', { ...colAttrs(i, 'rt-nm'), title: `${e.name}: ${sub}` }, e.name)));
  const attrRow = (key, last) => row(A[key].name, attrTitle(cfg, key), (e, v) => {
    const chip = levelChip(cfg, key, v.known[key]);
    if (key !== 'hp') return chip;
    return [chip, h('div', { class: 'muted rt-sm', title: `HP = base ${f1(v.base.hp)} x the HP attribute` }, `= ${v.hpText} HP`)];
  }, last ? 'rt-last' : '');
  const offense = cfg.enemies.pairs.map(([o]) => o);
  const defense = cfg.enemies.pairs.map(([, d]) => d);

  const table = h('table', { class: 'rt', style: { width: `calc(var(--rt-label) + ${nCols} * var(--rt-col))` } },
    h('thead', {}, names),
    h('tbody', {},
      rows,
      sectionRow('Offense', 'what it does to you'),
      offense.map((k) => attrRow(k)),
      namesRow('Defense', 'how well it resists your attacks'),
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
  const odds = Object.entries(weights).map(([g, w]) => `${g} ${w}%`).join(', ');
  const def = tv ? ringDef(enemy.ring.type, cfg) : null;
  const nTypes = Object.keys(cfg.rings.types).length;
  let title;
  if (tv && gv) title = `${def.name} ${enemy.ring.grade}: ${ringEffectText(def, ringValue(enemy.ring, cfg))}`;
  else if (tv) {
    const vals = Object.keys(weights).map((g) => def.values[GRADES.indexOf(g)]);
    title = `${def.name}, grade hidden (${cap(enemy.tier)} odds: ${odds}): ${ringEffectText(def, `${Math.min(...vals)}-${Math.max(...vals)}`)}`;
  } else title = `Type hidden (any of ${nTypes} types, equally likely). ${gv ? `Grade ${enemy.ring.grade}.` : `Grade hidden (${cap(enemy.tier)} odds: ${odds}).`}`;
  return h('div', { class: 'rt-ring', title },
    h('div', {},
      tv ? h('b', {}, def.name) : h('span', { class: 'adv-lv attr-unknown' }, '? type'),
      ' ',
      gv ? h('span', { class: `adv-lv grade-${enemy.ring.grade}` }, enemy.ring.grade) : h('span', { class: 'adv-lv attr-unknown' }, '? grade')),
    tv ? h('div', { class: 'muted rt-sm' }, `${def.owner} ring`) : null);
}

// A cell of the "Win estimate" row: the win % (colour by chance) with its margin, "…" while that estimate runs, "—" if none.
function estimateCell(res, running) {
  if (res) {
    const m = marginPts(res);
    return h('div', { class: 'rt-ec' },
      h('span', { class: `adv-badge ${winClass(res.winPct)}`, title: `${winWithMargin(res)}${m != null ? ` point${m === 1 ? '' : 's'}` : ''} from ${res.fights} simulated fights${m != null ? ` (the ± is how far the simulation alone could be off; hidden attributes add more)` : ''}` }, winText(res.winPct)),
      m != null ? h('div', { class: 'muted rt-sm rt-pm' }, `± ${m}`) : null);
  }
  if (running) return h('span', { class: 'muted', title: 'Simulating…' }, '…');
  return h('span', { class: 'muted', title: 'Not estimated yet for this selection: press Estimate all' }, '—');
}

const winClass = (p) => (p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'err');
const winText = (v) => `${Math.round(v)}%`;

// Margin of an estimate in points: twice the standard error, shown in whole points and never below 1. It covers
// the simulation's own noise only (about 9 times in 10 when every attribute is known), not the guesswork about
// hidden attributes. null for results without one (nothing simulated).
export const marginPts = (res) => (res && Number.isFinite(res.se) ? Math.max(1, Math.round(2 * res.se)) : null);
// "62% ± 12" (or just "62%" without a margin)
const winWithMargin = (res) => (marginPts(res) != null ? `${winText(res.winPct)} ± ${marginPts(res)}` : winText(res.winPct));

// -------------------------------------------------------------- combat log ----
// Backpack-Battles style log lines. Returns a DOM node.
export function renderCombatLog(report) {
  const en = report.enemy.name;
  const nameOf = (side) => (side === 'A' ? 'Adventurer' : en);
  const maxHp = { A: report.advMaxHp, E: report.enemyMaxHp };
  const entries = report.log || [];
  const line = (e) => {
    const att = nameOf(e.side);
    const defSide = e.side === 'A' ? 'E' : 'A';
    const def = nameOf(defSide);
    let text;
    if (e.hit) {
      text = `${att} hits ${def} for ${f1(e.dmg)}`;
      if (e.magic > 0.005) text += ` (${f1(e.phys)} phys + ${f1(e.magic)} magic)`;
      if (e.stun) text += ` — stun ${f2(e.stun)}s`;
      if (e.slow) text += ` — slow ${f1(e.slow.pct)}% for ${f1(e.slow.dur)}s`;
      text += ` — ${def} ${f1(defSide === 'A' ? e.hpA : e.hpE)}/${f1(maxHp[defSide])}`;
    } else {
      text = `${att} misses (${Math.round(e.hitPct)}% to hit)`;
    }
    return h('div', { class: `adv-line ${e.side}${e.hit ? '' : ' miss'}` }, h('span', { class: 't' }, `[${e.t.toFixed(1)}s] `), text);
  };
  // Very long fights: show the start and the end. Saved reports of very long fights are already
  // trimmed by the core (report.logTrimmed = attacks from the middle that were not saved).
  const HEAD = 1000;
  const TAIL = 300;
  const trimmed = report.logTrimmed > 0 ? report.logTrimmed : 0;
  let shown = entries.map(line);
  if (entries.length > HEAD + TAIL) {
    const hiddenHere = entries.length - HEAD - TAIL;
    const more = hiddenHere + trimmed;
    shown = [...entries.slice(0, HEAD).map(line),
      h('div', { class: 'adv-line muted adv-gap' }, `… ${more} more attacks${trimmed ? ` (${trimmed} not saved: log trimmed)` : ''} …`),
      ...entries.slice(-TAIL).map(line)];
  }
  const end = report.win ? `${en} is defeated after ${f1(report.time)}s.` : report.draw ? `Safety time cap reached after ${f1(report.time)}s — draw.` : `The adventurer falls after ${f1(report.time)}s.`;
  return h('div', { class: 'combatlog' },
    h('div', { class: 'adv-line muted' }, `[0.0s] Fight starts: Adventurer ${f1(report.advMaxHp)} HP vs ${en} ${f1(report.enemyMaxHp)} HP.`),
    shown,
    h('div', { class: `adv-line adv-end ${report.win ? 'ok' : report.draw ? 'warn' : 'err'}` }, end));
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
  const row = (label, fn, title) => h('tr', { title }, h('td', {}, label), sides.map((s) => h('td', { class: 'num' }, fn(s))));
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

// Full report body. opts: { headline (default true), log (default true) }
export function renderBattleReport(report, ctx, opts = {}) {
  const cfg = ctx.cfg;
  const en = report.enemy.name;
  const tier = report.enemy.tier;
  const kind = report.win ? 'win' : report.draw ? 'draw' : 'loss';
  const title = report.win ? `Victory over ${en}!` : report.draw ? `Draw against ${en}` : `Defeat — the adventurer fell to ${en}`;
  const score = cfg.enemies.tiers[tier]?.score || 0;

  const head = h('section', { class: `panel adv-rhead adv-${kind}` },
    opts.headline === false ? null : h('div', { class: `adv-headline adv-${kind}` }, title),
    h('div', { class: 'muted' }, `Day ${report.day} fight vs ${en} (${tier}) · lasted ${f1(report.time)}s`, report.win ? ` · +${score} points` : ''),
    report.draw ? h('p', { class: 'warn' }, 'The fight reached the safety time cap: the adventurer survives, but gets no ring.') : null,
    h('div', { class: 'adv-hpbars' },
      hpRow('Adventurer', report.advHp, report.advMaxHp, 'adv-hp-a'),
      hpRow(en, report.enemyHp, report.enemyMaxHp, 'adv-hp-e')));

  const destroyed = report.destroyed || [];
  // how much wear each item took: the roll, x the enemy tier's multiplier, x (1 - Gear care) (older reports lack the detail)
  const wearDetail = (w) => {
    if (w.base == null) return null;
    const bits = [`rolled ${w.base}%`];
    if (w.tierMult && w.tierMult !== 1) bits.push(`x ${f2(w.tierMult)} (${tier} enemy)`);
    if (w.skillRed > 0) bits.push(`x ${f2(1 - w.skillRed / 100)} (Gear care -${num(w.skillRed, 1)}%)`);
    return bits.join(' ');
  };
  const wearRows = (report.wear || []).map((w) => h('tr', {},
    h('td', {}, w.name, wearDetail(w) ? h('div', { class: 'muted adv-small' }, wearDetail(w)) : null),
    h('td', { class: 'num err' }, `-${f1(w.loss)}%`),
    h('td', { class: 'num' }, w.left <= 0 ? h('b', { class: 'err' }, 'Destroyed') : `${f1(w.left)}% left`)));
  const survived = report.win || report.draw;
  const gearCareNode = survived && Array.isArray(report.notes) && cfg.skills.gearCareXpPerFight && cfg.skills.activity.gearCare
    ? h('p', { class: 'adv-tight muted adv-small' }, `${cfg.skills.activity.gearCare.name}: +${cfg.skills.gearCareXpPerFight} XP for surviving the fight.`,
      report.notes.map((n) => [' ', h('b', { class: 'ok' }, n)]))
    : null;
  // Packed but unused (report.packedIds). Unused items do not wear.
  const unusedIds = report.packedIds.filter((id) => !report.usedIds.includes(id));
  const unusedNode = unusedIds.length
    ? h('p', { class: 'adv-tight muted adv-small' }, `Packed but not used (no wear): `,
      unusedIds.map((id, i) => {
        const g = ctx.state.gear.find((x) => x.id === id);
        return [i ? ', ' : '', g ? gearNameNode(g) : 'an item you no longer own'];
      }), '.')
    : null;
  const gearPanel = section('Gear the adventurer used',
    report.usedNames.length
      ? h('p', { class: 'adv-tight' }, 'Picked from the packed gear after seeing the enemy: ', h('b', {}, report.usedNames.join(', ')), '.')
      : h('p', { class: 'adv-tight muted' }, report.packedIds.length ? 'No gear used — fought unarmed.' : 'No gear — fought unarmed.'),
    unusedNode,
    wearRows.length ? h('table', { class: 'adv-stats' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'Wear'), h('th', { class: 'num' }, 'Durability'))), h('tbody', {}, wearRows)) : null,
    gearCareNode,
    destroyed.length ? h('p', { class: 'err' }, `Destroyed (0% durability): ${destroyed.join(', ')}.`) : null,
    opts.repair && isNight(ctx.state) ? reportRepair(ctx, report) : null,
    h('h4', { class: 'adv-h4' }, 'Reward'),
    report.ring
      ? h('p', { class: 'adv-tight' }, 'Ring gained: ', h('b', { class: `grade-${report.ring.grade}` }, report.ringText),
        h('span', { class: 'muted' }, ringDef(report.ring.type, cfg).owner === 'adventurer' ? ' — an adventurer ring: you can give it to the adventurer in tonight\'s plan.' : ' — a smith ring: wear it on the Rings tab.'))
      : h('p', { class: 'adv-tight muted' }, report.draw ? 'No ring (draw).' : 'No ring.'));

  const enemyPanel = section('Enemy attributes (revealed)',
    enemyCard(ctx, { name: en, tier, levels: report.enemy.levels, day: report.day }, { reveal: true, ring: false, day: report.day }));

  const parts = [
    head,
    h('div', { class: 'cols' }, gearPanel, enemyPanel),
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

// Tonight's repairs for the gear the adventurer just used (battle report screen only).
function reportRepair(ctx, report) {
  const ids = (report.wear || []).map((w) => w.id);
  const items = ids.map((id) => ctx.state.gear.find((g) => g.id === id)).filter(Boolean);
  if (!items.length) return null;
  const worn = items.filter((g) => g.durability < 100);
  return h('div', { class: 'rp-report' },
    h('h4', { class: 'adv-h4' }, 'Repair tonight'),
    h('p', { class: 'rp-night' }, h('b', {}, 'Repairs tonight cost materials but no time. '),
      'You can also repair any gear on the plan screen.'),
    items.map((g) => h('div', { class: 'rp-item' },
      h('div', {}, gearNameNode(g), ' ', g.durability >= 100
        ? h('span', { class: 'ok adv-small' }, 'repaired: 100%')
        : h('span', { class: 'muted adv-small' }, `${f1(g.durability)}% now`)),
      g.durability < 100 ? repairLine(ctx, g) : null)),
    worn.length > 1 ? h('div', { class: 'row adv-tight' }, repairAllButton(ctx, worn)) : null);
}

// ---------------------------------------------------------------- screens ----
export function renderReport(root, ctx) {
  const s = ctx.state;
  const r = s.report;
  const cont = (cls) => h('button', { class: `primary ${cls || ''}`, onclick: () => ctx.act(() => Game.acknowledgeReport(ctx.state)) }, 'Continue to tomorrow\'s plan');
  root.append(h('div', { class: 'adv-screen' },
    h('div', { class: 'adv-titlebar' }, h('h2', {}, `End of day ${s.day}: battle report`), cont()),
    s.day % ctx.cfg.intel.daysPerPoint === 0 ? h('p', { class: 'ok' }, `Day ${s.day} complete: +1 intel point (spend it in the plan).`) : null,
    r ? renderBattleReport(r, ctx, { repair: true }) : h('p', { class: 'muted' }, 'No battle report.'),
    h('div', { class: 'row adv-bottom' }, cont())));
}

export function renderGameOver(root, ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const r = s.report || s.battles[s.battles.length - 1] || null;
  let best = s.stats.score;
  try {
    best = Math.max(best, Number(localStorage.getItem(Game.BEST_KEY) || 0));
  } catch {
    /* storage unavailable */
  }
  const totalWins = Object.values(s.stats.wins).reduce((a, b) => a + b, 0);
  const tierRows = Object.entries(cfg.enemies.tiers).map(([tier, t]) => h('tr', {},
    h('td', { class: `tier-${tier}` }, cap(tier)),
    h('td', { class: 'num' }, String(s.stats.wins[tier] || 0)),
    h('td', { class: 'num' }, `x ${t.score}`),
    h('td', { class: 'num' }, String((s.stats.wins[tier] || 0) * t.score))));
  root.append(h('div', { class: 'adv-screen' },
    h('section', { class: 'panel adv-over' },
      h('div', { class: 'adv-headline adv-loss' }, 'Game over'),
      h('p', {}, r ? `Your adventurer fell to ${r.enemy.name} (${r.enemy.tier}) on day ${s.day}.` : `Your adventurer fell on day ${s.day}.`),
      h('div', { class: 'adv-bignums' },
        h('div', {}, h('div', { class: 'adv-big' }, String(s.stats.score)), h('div', { class: 'muted' }, 'final score')),
        h('div', {}, h('div', { class: 'adv-big' }, String(Math.max(0, s.day - 1))), h('div', { class: 'muted' }, 'days survived')),
        h('div', {}, h('div', { class: 'adv-big' }, String(totalWins)), h('div', { class: 'muted' }, 'fights won')),
        h('div', {}, h('div', { class: 'adv-big' }, String(best)), h('div', { class: 'muted' }, 'best score'))),
      h('table', { class: 'adv-stats adv-wins' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Wins by tier'), h('th', { class: 'num' }, 'Wins'), h('th', { class: 'num' }, 'Points each'), h('th', { class: 'num' }, 'Points'))),
        h('tbody', {}, tierRows)),
      h('div', { class: 'row adv-bottom' }, h('button', { class: 'primary', onclick: () => ctx.newGame() }, 'New game'))),
    r ? h('h3', { class: 'adv-subtitle' }, 'The fatal battle') : null,
    r ? renderBattleReport(r, ctx) : null));
}

// ------------------------------------------------------------------- plan ----
const isAdvRing = (r, cfg) => ringDef(r.type, cfg).owner === 'adventurer';

function defaultGearIds(state, cfg) {
  return bestPerSlot(state.gear, 2, cfg).map((g) => g.id);
}

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
    cancelRun(ctx); // a run for the previous roster / game must not paint or block this one
    const ringIds = [...wornNow];
    // a ring won today is pre-selected when there is room (the player can untick it)
    const won = s.report && s.report.ring;
    if (won && isAdvRing(won, cfg) && !ringIds.includes(won.id) && ringIds.length < cfg.rings.maxWorn && s.rings.some((r) => r.id === won.id)) ringIds.push(won.id);
    p = ctx.ui.plan = { rosterDay: s.roster.day, seed: s.seed, enemyIndex: null, gearIds: defaultGearIds(s, cfg), ringIds, wornKey: sortedIds(wornNow) };
    ctx.ui.plan_est = {};
  } else if (p.wornKey !== sortedIds(wornNow)) {
    // rings worn / removed on the Rings tab while planning: apply the difference to the plan
    const before = new Set((p.wornKey || '').split(',').filter(Boolean).map(Number));
    const now = new Set(wornNow);
    p.ringIds = p.ringIds.filter((id) => !(before.has(id) && !now.has(id)));
    for (const id of wornNow) if (!before.has(id) && !p.ringIds.includes(id) && p.ringIds.length < cfg.rings.maxWorn) p.ringIds.push(id);
    p.wornKey = sortedIds(wornNow);
    cancelRun(ctx); // the ring selection changed under a running estimate
  }
  ctx.ui.plan_est = ctx.ui.plan_est || {};
  p.gearIds = p.gearIds.filter((id) => s.gear.some((g) => g.id === id));
  p.ringIds = p.ringIds.filter((id) => s.rings.some((r) => r.id === id && isAdvRing(r, cfg)));
  if (p.enemyIndex != null && !s.roster.enemies[p.enemyIndex]) p.enemyIndex = null;
  return p;
}

const sortedIds = (ids) => [...ids].sort((a, b) => a - b).join(',');

// Cache key for one enemy's estimate: everything that changes the result (the selection, what the
// player can see of the enemy, and the size of the simulation).
function estKey(ctx, p, enemyIndex, counts = simCounts(ctx.state, ctx.cfg)) {
  return [p.seed, p.rosterDay, enemyIndex, sortedIds(p.gearIds), sortedIds(p.ringIds), intelValue(ctx.state, 'enemySight', ctx.cfg),
    counts.samples, counts.evalFights, counts.fightsPerLoadout].join('|');
}

// Stop the running "Estimate all" (if any): its remaining work is for a selection / roster / game that is
// gone. The run loop and the estimator's progress callback both check run.cancelled and bail out, so nothing
// more is simulated or painted. Exported for main.js (new game).
export function cancelRun(ctx) {
  const r = ctx.ui.plan_run;
  if (r) {
    r.cancelled = true;
    ctx.ui.plan_run = null;
  }
}

// The part of the selection an estimate depends on (gear + rings): picking another enemy column does not change it.
const selKey = (p) => `${sortedIds(p.gearIds)}|${sortedIds(p.ringIds)}`;

// UI-only selection change. Cached estimates are keyed by the full selection, so a changed
// selection never shows a stale result; a run that was started for the old gear / rings is cancelled
// (choosing another enemy column keeps it going).
function changeSel(ctx, fn) {
  const before = selKey(ctx.ui.plan);
  fn(ctx.ui.plan);
  if (selKey(ctx.ui.plan) !== before) cancelRun(ctx);
  ctx.rerender();
}

function estimateParams(ctx, enemyIndex) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const p = ctx.ui.plan;
  const enemy = s.roster.enemies[enemyIndex];
  const day = s.roster.day;
  return {
    gearItems: s.gear.filter((g) => p.gearIds.includes(g.id)),
    ringTotals: ringTotals(s.rings.filter((r) => p.ringIds.includes(r.id)), cfg),
    tier: enemy.tier,
    day,
    known: knownLevels(s, enemy, cfg),
    seed: mixSeed(s.seed, day, enemyIndex),
  };
}

// Update the progress widgets in place (the run can outlive several re-renders).
function setProgress(run) {
  if (run.cancelled) return;
  const pct = Math.round(run.progress * 100);
  const text = `Simulating ${run.name} (${Math.min(run.index + 1, run.total)} of ${run.total})… ${pct}%`;
  for (const fill of document.querySelectorAll('.adv-est-fill')) fill.style.width = `${pct}%`;
  for (const el of document.querySelectorAll('.adv-est-text')) el.textContent = text;
  const btn = document.getElementById('adv-est-btn');
  if (btn) btn.textContent = `Simulating… ${pct}%`;
}

// Put one finished estimate into its table cell without re-rendering the screen.
function paintEstimate(i, res, running) {
  const td = document.querySelector(`.rt td[data-est="${i}"]`);
  if (td) td.replaceChildren(estimateCell(res, running));
}

// ONE button for the whole roster: estimate every enemy, one after the other, with the current gear and
// ring selection (snapshotted now, so changing the selection mid-run cannot mix up the results).
// Hygiene: results are stored under their own key whatever happens, but painted only if that key is still the
// current selection's; cancelRun (gear / ring change, confirming, a new roster or game) stops the loop and
// the simulation at the next guess.
function startEstimateAll(ctx) {
  const p = ctx.ui.plan;
  if (ctx.ui.plan_run || !p) return;
  const enemies = ctx.state.roster.enemies;
  const counts = simCounts(ctx.state, ctx.cfg);
  const opts = { samples: counts.samples, evalFights: counts.evalFights, fightsPerLoadout: counts.fightsPerLoadout };
  const est = ctx.ui.plan_est;
  const jobs = enemies.map((e, i) => ({ i, name: e.name, key: estKey(ctx, p, i, counts), params: estimateParams(ctx, i) })).filter((j) => !est[j.key]);
  if (!jobs.length) return;
  const run = { jobs, total: jobs.length, index: 0, progress: 0, name: jobs[0].name, cancelled: false, sig: estKey(ctx, p, 0, counts) };
  ctx.ui.plan_run = run;
  ctx.rerender();
  (async () => {
    try {
      for (let n = 0; n < jobs.length; n++) {
        if (run.cancelled) return;
        const job = jobs[n];
        run.index = n;
        run.name = job.name;
        const res = await estimateWinChance(job.params, opts, (f) => {
          if (run.cancelled) return false; // stops the simulation at the next guess
          run.progress = (n + f) / jobs.length;
          setProgress(run);
          return true;
        });
        if (run.cancelled || !res) return; // cancelled mid-job: no result
        est[job.key] = { ...res, counts };
        const cur = ctx.ui.plan;
        if (cur && job.key === estKey(ctx, cur, job.i)) paintEstimate(job.i, est[job.key], true);
      }
    } catch (e) {
      console.error(e);
      ctx.toast(`Estimate failed: ${e.message}`, 'err');
    } finally {
      if (!run.cancelled) {
        if (ctx.ui.plan_run === run) ctx.ui.plan_run = null;
        ctx.rerender();
      }
    }
  })();
}

export function renderPlan(root, ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const p = planSel(ctx);
  // anything that changed what a running estimate is for (rings worn on the Rings tab, spent intel, ...)
  if (ctx.ui.plan_run && ctx.ui.plan_run.sig !== estKey(ctx, p, 0)) cancelRun(ctx);
  const sel = p.enemyIndex != null ? s.roster.enemies[p.enemyIndex] : null;
  const selGear = s.gear.filter((g) => p.gearIds.includes(g.id));
  const advRings = s.rings.filter((r) => isAdvRing(r, cfg));
  const selRings = advRings.filter((r) => p.ringIds.includes(r.id));
  const counts = simCounts(s, cfg);
  const estimates = s.roster.enemies.map((e, i) => ctx.ui.plan_est[estKey(ctx, p, i, counts)] || null);
  const est = p.enemyIndex != null ? estimates[p.enemyIndex] : null;
  const running = ctx.ui.plan_run;
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
      h('p', { class: 'adv-tight' }, 'Pick one enemy, pack gear (up to 2 items per slot) and choose the adventurer\'s rings. ',
        'When the fight starts the enemy is fully revealed and the adventurer uses the best packed item for each slot against it. ',
        h('b', {}, 'A lost fight ends the game.'))),
    intelPanel(ctx),
    section('1. Choose an enemy',
      h('p', { class: 'adv-tight muted adv-small' }, 'Click a column to choose that enemy. Each row compares one attribute across the roster: ',
        h('span', { class: 'attr-low' }, 'green = Low'), ' (weaker enemy), ', h('span', { class: 'attr-high' }, 'red = High'), ' (stronger), ? = hidden. ',
        'Offense = what it does to you, defense = how well it resists your attacks. Press ', h('b', {}, 'Estimate all'), ` (bottom bar) to fill the win-estimate row: ${counts.samples} guesses x ${counts.evalFights} test fights per enemy (raise with Battle simulation intel and Foresight rings).`),
      running ? progressBlock(running) : null,
      rosterTable(ctx, s.roster.enemies, { day: s.roster.day, selected: p.enemyIndex, onSelect: select, estimates, running: !!running })),
    h('div', { class: 'cols' }, gearStep(ctx, p, selGear, sel), ringStep(ctx, p, advRings, selRings)),
    estimatePanel(ctx, p, sel, selGear, selRings, est, running, counts),
    confirmBar(ctx, p, sel, selGear, selRings, est, running, err, estimates)));

  // restore what a re-render would otherwise reset: the table's horizontal scroll and the radio focus
  const scroller = root.querySelector('.rt-scroll');
  if (scroller) {
    if (ctx.ui.plan_scroll) scroller.scrollLeft = ctx.ui.plan_scroll;
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

// Overall progress of an Estimate all run.
function progressBlock(run) {
  const pct = Math.round(run.progress * 100);
  return h('div', { class: 'adv-estrun' },
    h('div', { class: 'bar adv-progress' }, h('div', { class: 'bar-fill adv-est-fill', style: { width: `${pct}%` } })),
    h('div', { class: 'adv-est-text muted adv-small' }, `Simulating ${run.name} (${Math.min(run.index + 1, run.total)} of ${run.total})… ${pct}%`));
}

function intelPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const pts = s.intel.points;
  const per = cfg.intel.daysPerPoint;
  const nextDay = (Math.floor(s.day / per) + 1) * per;
  if (pts <= 0) {
    return h('section', { class: 'panel adv-intel' },
      h('span', { class: 'muted' }, 'Intel: '),
      planTracks(cfg).map((t, i) => [i ? ' · ' : '', `${cfg.intel.tracks[t].name} `, h('b', {}, trackValueText(t, intelValue(s, t, cfg), cfg))]),
      h('span', { class: 'muted' }, ` — no intel points (next one at the end of day ${nextDay}).`));
  }
  return section(`Intel: ${pts} point${pts > 1 ? 's' : ''} to spend`,
    h('p', { class: 'adv-tight muted' }, 'Spending a point on scouting reveals more of this roster right away (each attribute / ring type / ring grade has a fixed hidden roll; a higher chance uncovers more of them). Ore sight shows more of the items still in the ground when you stand in a field. Battle simulation adds guesses and test fights to the win-chance estimate.'),
    h('table', { class: 'adv-stats' },
      h('tbody', {}, planTracks(cfg).map((t) => {
        const tr = cfg.intel.tracks[t];
        const cur = intelValue(s, t, cfg);
        const gain = nextIntelGain(s, t, cfg);
        return h('tr', {},
          h('td', {}, h('b', {}, tr.name), h('div', { class: 'muted adv-small' }, tr.desc)),
          h('td', { class: 'num' }, trackValueText(t, cur, cfg)),
          h('td', { class: 'num' }, gain > 0
            ? h('button', {
              class: 'small',
              onclick: () => ctx.act(() => spendIntelAction(ctx, t), { toast: true }),
            }, `Spend 1 point: ${trackValueText(t, cur, cfg)} → ${trackValueText(t, cur + gain, cfg)}`)
            : h('span', { class: 'muted' }, 'maxed')));
      }))));
}

function gearStep(ctx, p, selGear, sel) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const counts = {};
  for (const g of selGear) counts[g.slot] = (counts[g.slot] || 0) + 1;
  const wear = wearRange(s, cfg, sel ? sel.tier : null); // the chosen enemy's tier, else any tier
  const maxLoss = wear.max;
  const rows = [];
  for (const slot of SLOTS) {
    const items = s.gear
      .filter((g) => g.slot === slot)
      .sort((a, b) => gearPower(b, cfg) - gearPower(a, cfg) || b.durability - a.durability || a.id - b.id);
    const n = counts[slot] || 0;
    rows.push(h('tr', { class: 'adv-slotrow' }, h('td', { colspan: 3 },
      h('b', {}, cap(slot)), h('span', { class: 'muted' }, ` · ${n}/2 packed`),
      items.length === 0 ? h('span', { class: 'muted' }, slot === 'sword' ? ` · none owned (unarmed: ${num(cfg.adventurer.unarmedDamage, 2)} damage)` : ' · none owned')
        : n === 0 ? h('span', { class: 'warn' }, ` · nothing packed (you own ${items.length})`) : null)));
    for (const g of items) {
      const on = p.gearIds.includes(g.id);
      const full = !on && n >= 2;
      const needsRepair = g.durability < 100;
      rows.push(h('tr', { class: `${on ? 'adv-on' : full ? 'adv-off' : ''}${needsRepair ? ' adv-hasrepair' : ''}` },
        h('td', {}, h('input', {
          type: 'checkbox',
          checked: on,
          disabled: full,
          title: full ? 'Already 2 items packed for this slot' : '',
          'data-gear': g.id,
          onchange: () => changeSel(ctx, (pl) => {
            pl.gearIds = on ? pl.gearIds.filter((id) => id !== g.id) : [...pl.gearIds, g.id];
          }),
        })),
        h('td', {}, gearCell(g, cfg)),
        h('td', {}, durabilityNode(g, cfg, wear))));
      // free of time tonight: repair right here before packing
      if (needsRepair) rows.push(h('tr', { class: `adv-repairrow${on ? ' adv-on' : ''}` }, h('td', {}), h('td', { colspan: 2 }, repairLine(ctx, g))));
    }
  }
  const risky = selGear.filter((g) => g.durability <= maxLoss);
  const combos = loadouts(selGear).length;
  const worn = s.gear.filter((g) => g.durability < 100);
  const night = isNight(s);
  return section('2. Pack gear',
    night ? h('div', { class: 'rp-night' },
      h('b', {}, 'Repairs tonight cost materials but no time.'),
      worn.length
        ? [` ${worn.length} item${worn.length === 1 ? '' : 's'} below 100%: use the Repair buttons below. `, repairAllButton(ctx, worn)]
        : ' All your gear is at 100%.') : null,
    h('p', { class: 'adv-tight muted' }, 'Packed gear is away with the adventurer all day tomorrow: it ',
      h('b', {}, 'can\'t be repaired'), ' until it comes back in the evening, so repair it tonight. Only the items actually used lose durability: ',
      wearText(s, cfg, sel ? sel.tier : null), '.'),
    h('div', { class: 'row adv-tight' },
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = defaultGearIds(ctx.state, ctx.cfg); }) }, 'Best 2 per slot'),
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = []; }) }, 'Pack nothing'),
      h('span', { class: 'muted adv-small' }, `${selGear.length} packed · ${combos} gear combination${combos === 1 ? '' : 's'} for the adventurer to choose from`)),
    s.gear.length
      ? h('div', { class: 'adv-scroll' }, h('table', { class: 'adv-stats adv-geartable' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pack'), h('th', {}, 'Item and stats'), h('th', {}, 'Durability'))),
        h('tbody', {}, rows)))
      : h('p', { class: 'warn' }, 'You own no gear: the adventurer fights unarmed with no armor.'),
    risky.length ? h('p', { class: 'err adv-small' }, `At ${maxLoss}% or less, could be destroyed if used${sel ? ` against ${sel.name}` : ''}: ${risky.map((g) => `${g.grade} ${cap(g.material)} ${cap(g.slot)} (${f1(g.durability)}%)`).join(', ')}.`) : null);
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

// Matchup numbers the player can check without simulating: hit chances, damage per hit,
// attack speed, HP and a rough time-to-kill each way. Hidden attributes show as a range.
function matchupTable(ctx, sel, preview) {
  const cfg = ctx.cfg;
  const known = knownLevels(ctx.state, sel, cfg);
  const advInt = attackInterval(preview, false, 0);
  const R = (keys, fn) => rangeOver(cfg, sel, known, keys, fn);
  const fmt = ([lo, hi], d, unit = '') => (Math.abs(hi - lo) < 10 ** -d / 2 ? `${num(lo, d)}${unit}` : `${num(lo, d)}–${num(hi, d)}${unit}`);
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
      h('tbody', {}, rows.map((r) => h('tr', {}, h('td', {}, r[0]), h('td', { class: 'num' }, r[1]), h('td', { class: 'num' }, r[2]))))),
    h('p', { class: 'adv-tight muted adv-small' }, 'Uses the preview gear above. Ranges cover the levels hidden attributes could still have. Ignores stuns, slows and damage rolls — run the estimate for the full picture.'));
}

// "10 guesses x 10 test fights per enemy" and how to raise it. counts = simCounts(state); est = the chosen
// enemy's finished estimate (or null): the caveat then states its actual margin.
function estimateHow(ctx, sel, counts, est = null) {
  const { state, cfg } = ctx;
  const known = sel ? knownLevels(state, sel, cfg) : null;
  const nHidden = known ? Object.keys(cfg.enemies.attributes).length - Object.keys(known).length : null;
  const intelPart = intelValue(state, 'simDepth', cfg);
  const ringPart = counts.extra - intelPart;
  const o = cfg.sim;
  const m = marginPts(est);
  return h('div', { class: 'adv-how' },
    h('p', { class: 'muted adv-small' },
      h('b', {}, `${counts.samples} guesses x ${counts.evalFights} test fights per enemy`),
      ` (base ${o.samples} x ${o.evalFights}${counts.extra ? `, +${intelPart} from Battle simulation intel${ringPart ? ` and +${ringPart} from Foresight rings` : ''}` : ''}). `,
      `For each guess of the hidden attributes${nHidden != null ? ` (${nHidden} hidden for ${sel.name})` : ''}, consistent with the tier mix, the adventurer picks the best packed gear (${counts.fightsPerLoadout} test fights per combination), then fights ${counts.evalFights} fresh fights: ${counts.samples * counts.evalFights} fights per enemy. A draw (safety time cap) counts as survival.`),
    h('p', { class: 'muted adv-small', 'data-margin-note': m != null ? m : null },
      m != null
        ? ['A small simulation is noisy: this estimate is ', h('b', {}, winWithMargin(est)), ` point${m === 1 ? '' : 's'}. The ± is how far the simulation alone could be off (about 9 times in 10 when every attribute is known); attributes you can't see add more uncertainty. It is a rough guide, and a risk you take on. `]
        : 'A small simulation is noisy: every estimate shows its margin of error (± points), and it is a rough guide, a risk you take on. ',
      'To make it steadier, spend intel on ',
      h('b', {}, cfg.intel.tracks.simDepth.name), ' (Skills & Intel) or wear ', h('b', {}, cfg.rings.types.foresight.name), ' smith rings (Rings tab). Both add guesses and test fights, which tightens the margin (about 4 times as many guesses halve it) and makes the run slower.'));
}

function estimatePanel(ctx, p, sel, selGear, selRings, est, running, counts) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const preview = adventurerCombatant(bestPerSlot(selGear, 1, cfg), ringTotals(selRings, cfg), cfg);
  const left = h('div', {},
    h('h4', { class: 'adv-h4' }, 'Adventurer preview'),
    h('p', { class: 'adv-tight muted adv-small' }, 'With the strongest-looking packed item per slot and the selected rings (the real choice is made by simulation once the enemy is known).'),
    combatStatsTable([{ label: 'Adventurer', c: preview }]),
    sel ? matchupTable(ctx, sel, preview) : null);

  let right;
  const how = estimateHow(ctx, sel, counts, est && !running ? est : null);
  if (!sel) {
    right = h('div', {}, h('p', { class: 'muted' }, 'Pick an enemy to see the details of its estimate. ', h('b', {}, 'Estimate all'), ' (bottom bar) simulates every enemy of the roster at once.'), how);
  } else if (running) {
    right = h('div', {}, h('p', { class: 'muted' }, 'Simulating the roster… (progress in the bar above and at the bottom)'), how);
  } else if (est) {
    const c = est.counts || counts;
    const name = (id) => {
      const g = s.gear.find((x) => x.id === id);
      return g ? gearNameNode(g) : `#${id}`;
    };
    right = h('div', {},
      h('div', { class: 'adv-bignums' },
        h('div', {}, h('div', { class: `adv-big ${winClass(est.winPct)}`, title: marginPts(est) != null ? `± ${marginPts(est)} is how far the simulation alone could be off (about 9 times in 10 when every attribute is known). Attributes you can't see add more uncertainty.` : null },
          winText(est.winPct), marginPts(est) != null ? h('span', { class: 'adv-pm' }, ` ± ${marginPts(est)}`) : null), h('div', { class: 'muted' }, marginPts(est) != null ? 'win chance (± points)' : 'win chance')),
        h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgTime)}s`), h('div', { class: 'muted' }, 'avg fight time')),
        h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgHpLeftPct)}%`), h('div', { class: 'muted' }, 'avg HP left (wins)'))),
      h('p', { class: 'adv-small muted' }, `${est.fights} simulated fights vs ${sel.name} (${c.samples} guesses x ${c.evalFights}).`),
      h('h4', { class: 'adv-h4' }, 'Gear the adventurer would use'),
      est.usage.length && est.usage[0].items.length
        ? h('table', { class: 'adv-stats' },
          h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Guesses'), h('th', {}, 'Items'))),
          h('tbody', {}, est.usage.slice(0, 6).map((u) => h('tr', {},
            h('td', { class: 'num' }, `${Math.round((u.count / c.samples) * 100)}%`),
            h('td', {}, u.items.map((id, i) => [i ? ', ' : '', name(id)]))))))
        : h('p', { class: 'muted' }, 'No gear packed (unarmed).'),
      est.usage.length > 6 ? h('p', { class: 'muted adv-small' }, `… and ${est.usage.length - 6} more combinations.`) : null,
      how);
  } else {
    right = h('div', {}, h('p', {}, `${sel.name} is not estimated for this selection yet. Press `, h('b', {}, 'Estimate all'), ' (bottom bar): it simulates every enemy of the roster.'), how);
  }
  return section(sel ? `Win chance vs ${sel.name}` : 'Win chance', h('div', { class: 'cols' }, left, h('div', {}, h('h4', { class: 'adv-h4' }, 'Estimate'), right)));
}

function confirmBar(ctx, p, sel, selGear, selRings, est, running, err, estimates) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const allDone = estimates.every(Boolean);
  const estLabel = running ? `Simulating… ${Math.round(running.progress * 100)}%` : allDone ? 'Estimated' : 'Estimate all';
  return h('div', { class: 'adv-bar' },
    h('div', { class: 'adv-bar-info' },
      sel ? [h('b', {}, sel.name), ' ', h('span', { class: `tier-${sel.tier}` }, `(${sel.tier}, +${cfg.enemies.tiers[sel.tier].score} pts)`)] : h('span', { class: 'warn' }, 'No enemy chosen'),
      h('span', { class: 'muted' }, ` · ${selGear.length} gear packed · ${selRings.length}/${cfg.rings.maxWorn} rings`),
      est ? h('span', {}, ' · win ≈ ', h('b', { class: winClass(est.winPct) }, winWithMargin(est))) : sel ? h('span', { class: 'muted' }, ' · not estimated') : null,
      err ? h('div', { class: 'warn adv-small' }, err) : null,
      running ? progressBlock(running) : null),
    h('button', {
      id: 'adv-est-btn',
      disabled: !!running || allDone,
      title: running ? 'Simulating the roster…' : allDone ? 'Every enemy is already estimated for this selection (the same selection always gives the same result)' : 'Simulate every enemy of the roster with the current gear and ring selection',
      onclick: () => startEstimateAll(ctx),
    }, estLabel),
    h('button', {
      class: 'primary',
      id: 'adv-confirm',
      onclick: () => {
        const plan = { enemyIndex: p.enemyIndex, gearIds: [...p.gearIds], ringIds: [...p.ringIds] };
        const e2 = Game.validatePlan(ctx.state, plan, ctx.cfg);
        if (e2) {
          ctx.toast(e2, 'err');
          return;
        }
        // A loss ends the game, so double-check risky plans.
        const warn = [];
        const st = ctx.state;
        if (st.gear.length && !plan.gearIds.length) warn.push('You own gear but packed none.');
        for (const slot of SLOTS) {
          if (st.gear.some((g) => g.slot === slot) && !plan.gearIds.some((id) => st.gear.find((g) => g.id === id)?.slot === slot)) warn.push(`No ${slot} packed, though you own one.`);
        }
        const chosen = ctx.ui.plan_est && ctx.ui.plan_est[estKey(ctx, p, p.enemyIndex)];
        if (chosen && chosen.winPct < 50) warn.push(`Estimated win chance is only ${winWithMargin(chosen)}.`);
        if (warn.length && !confirm(`${warn.join('\n')}\n\nA lost fight ends the game. Confirm anyway?`)) return;
        const res = ctx.act(() => Game.confirmPlan(ctx.state, plan, ctx.cfg));
        if (res && res.ok) {
          cancelRun(ctx);
          ctx.ui.plan = null;
          ctx.ui.plan_est = {};
        }
      },
    }, `Confirm & start day ${s.roster.day}`));
}
