// End-of-day screens: battle report (phase 'report'), plan tomorrow's fight (phase 'plan'),
// game over (phase 'over').
// Also exports widgets reused by the Adventurer tab and the Log tab: enemyCard, renderBattleReport,
// renderCombatLog, combatStatsTable and small gear/ring helpers.
// All game-state changes go through core actions inside ctx.act(). UI-only state lives in ctx.ui.plan*.
import { h, section, bar, num } from './dom.js';
import { SLOTS, GRADES, LEVELS } from '../config.js';
import * as Game from '../core/game.js';
import { enemyBase, enemyCombatant, knownLevels, ringTypeVisible, ringGradeVisible } from '../core/enemies.js';
import { estimateWinChance, loadouts } from '../core/sim.js';
import { adventurerCombatant, attackInterval, hitChance, hitDamage } from '../core/combat.js';
import { ringTotals, ringContributions, ringValue, ringDef, ringLabel, wornRings } from '../core/rings.js';
import { gearStats } from '../core/gear.js';
import { spendIntel, intelChance, nextIntelGain } from '../core/intel.js';
import { mixSeed } from '../core/rng.js';
import { cap } from '../core/util.js';

// ------------------------------------------------------------------ format ----
const f1 = (v) => num(v, 1);
const f2 = (v) => num(v, 2);
const pctf = (v, d = 1) => `${num(v, d)}%`;
const signedPct = (v) => `${v > 0 ? '+' : ''}${num(v, 1)}%`;
const LV = { low: 'Low', normal: 'Normal', high: 'High' };
const SCOUT_TRACKS = ['enemySight', 'ringTypeSight', 'ringGradeSight'];

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

export function durabilityNode(g, cfg) {
  const d = g.durability;
  const { min, max } = cfg.gear.durabilityLoss;
  const risky = d <= max;
  const cls = risky ? 'adv-dur-low' : d < 50 ? 'adv-dur-mid' : '';
  return h('div', { class: 'adv-dur', title: risky ? `Could break in its next fight (each fight costs ${min}-${max}%; 0% = destroyed)` : `Each fight costs a used item ${min}-${max}% durability` },
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
  if (tv && gv) detail = `${ringValue(enemy.ring, cfg)} ${def.desc}`;
  else if (tv) {
    const vals = Object.keys(weights).map((g) => def.values[GRADES.indexOf(g)]);
    detail = `${Math.min(...vals)}-${Math.max(...vals)} ${def.desc}`;
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

// One enemy: name, tier, base numbers, 12 attributes in offense|defense pairs, tier mix, ring reward.
// opts: { reveal (show all levels), ring (default true), day, selected, onSelect, estimate (win % badge) }
export function enemyCard(ctx, enemy, opts = {}) {
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
  const stat = (label, value, title) => h('span', { class: 'adv-bstat', title }, h('span', { class: 'muted' }, `${label} `), h('b', {}, value));
  const growthPct = Math.round((base.ratingMult - 1) * 100);
  const baseLine = h('div', { class: 'adv-base' },
    stat('HP', hpText, `Base ${f1(base.hp)} (day ${day}) x HP attribute`),
    stat('Damage', f1(base.damage), 'Damage per hit before magic, defense and piercing'),
    stat('Defense', `${base.defense}%`, 'Reduces your physical damage (piercing ignores part of it)'),
    stat('Ratings', `x${f2(base.ratingMult)}`, `Accurate and Evasion values are multiplied by ${f2(base.ratingMult)} (+${growthPct}% daily growth)`));

  const cell = (k) => {
    const a = A[k];
    const lv = known[k];
    const range = LEVELS.map((l) => `${LV[l]} ${attrValueText(k, l, cfg)}`).join(' / ');
    const chip = lv
      ? h('span', { class: `adv-lv attr-${lv}` }, `${LV[lv]} · ${attrValueText(k, lv, cfg)}`)
      : h('span', { class: 'adv-lv attr-unknown' }, '?');
    return h('div', { class: 'adv-attr', title: `${a.name}: ${a.desc}. ${range}` }, h('span', { class: 'adv-an' }, a.name), chip);
  };
  const pairs = h('div', { class: 'adv-pairs' },
    h('div', { class: 'adv-ph' }, 'Offense'), h('div', { class: 'adv-ph' }, 'Defense'),
    cfg.enemies.pairs.flatMap(([o, d]) => [cell(o), cell(d)]));

  const mix = h('div', { class: 'adv-mix' }, `Tier mix: ${mixText(tierCfg.levels)}`,
    opts.reveal ? null : hidden > 0 ? h('span', {}, ` — ${hidden} hidden, among them: `, h('b', {}, mixText(rem))) : ' — all known');

  const est = opts.estimate;
  const head = h('div', { class: 'adv-ehead' },
    opts.onSelect ? h('input', { type: 'radio', name: 'adv-enemy', checked: !!opts.selected, tabindex: -1, 'aria-label': `Choose ${enemy.name}` }) : null,
    h('span', { class: 'adv-ename' }, enemy.name),
    h('span', { class: `adv-tier tier-${enemy.tier}` }, cap(enemy.tier)),
    h('span', { class: 'muted' }, `+${tierCfg.score} pts`),
    est ? h('span', { class: `adv-badge ${winClass(est.winPct)}`, title: 'Estimated win chance with the current gear and ring selection' }, `win ≈ ${f1(est.winPct)}%`) : null);

  const cls = ['enemy-card', 'adv-ecard', opts.onSelect ? 'adv-pick' : '', opts.selected ? 'selected' : ''].filter(Boolean).join(' ');
  return h('div', {
    class: cls,
    tabindex: opts.onSelect ? 0 : null,
    role: opts.onSelect ? 'button' : null,
    onclick: opts.onSelect || null,
    onkeydown: opts.onSelect ? (ev) => {
      if (ev.key === 'Enter' || ev.key === ' ') {
        ev.preventDefault();
        opts.onSelect();
      }
    } : null,
  }, head, baseLine, pairs, mix, opts.ring === false ? null : ringRewardNode(ctx, enemy));
}

const winClass = (p) => (p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'err');

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
  return h('table', { class: 'adv-stats adv-summary' },
    h('thead', {}, h('tr', {}, h('th', {}, ''), h('th', { class: 'num' }, `Adventurer → ${en}`), h('th', { class: 'num' }, `${en} → Adventurer`))),
    h('tbody', {},
      row('Attacks', (s) => String(s.st.attacks)),
      row('Hits', (s) => `${s.st.hits} (${s.st.attacks ? Math.round((s.st.hits / s.st.attacks) * 100) : 0}% landed)`),
      row('Hit chance', (s) => pctf(s.hit * 100, 0), `Accuracy vs dodge S-curve, clamped to ${c.minHitPct}-${c.maxHitPct}%`),
      row('Avg damage per hit', (s) => (s.st.hits ? f1(s.st.dmg / s.st.hits) : '—')),
      row('Per hit before roll', (s) => `${f1(s.dmg.phys)} phys + ${f1(s.dmg.magic)} magic`, `Each hit rolls ${c.damageRoll[0]}-${c.damageRoll[1]}% of this`),
      row('Target defense after piercing', (s) => pctf(s.dmg.effDef), 'Defense x (1 - effective piercing %); effective piercing = piercing x (1 - target\'s pierce resistance %)'),
      row('Total damage', (s) => f1(s.st.dmg)),
      row('Stuns landed', (s) => (s.st.stuns ? `${s.st.stuns} (${f1(s.foe.stunnedFor)}s total)` : '0'), 'A stun stops the target\'s attack bar for its duration (stuns do not stack; a new one refreshes the timer)'),
      row('Slows landed', (s) => String(s.st.slows), 'A slow makes the target\'s attack bar fill slower for its duration (slows do not stack; the stronger one is kept and the timer refreshes)')));
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
  const wearRows = (report.wear || []).map((w) => h('tr', {},
    h('td', {}, w.name),
    h('td', { class: 'num err' }, `-${w.loss}%`),
    h('td', { class: 'num' }, w.left <= 0 ? h('b', { class: 'err' }, 'Destroyed') : `${f1(w.left)}% left`)));
  // Packed but unused (report.packedIds; older saves may not have it). Unused items do not wear.
  const usedIds = report.usedIds || [];
  const unusedIds = Array.isArray(report.packedIds) ? report.packedIds.filter((id) => !usedIds.includes(id)) : [];
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
      : h('p', { class: 'adv-tight muted' }, Array.isArray(report.packedIds) && report.packedIds.length ? 'No gear used — fought unarmed.' : 'No gear — fought unarmed.'),
    unusedNode,
    wearRows.length ? h('table', { class: 'adv-stats' }, h('thead', {}, h('tr', {}, h('th', {}, 'Item'), h('th', { class: 'num' }, 'Wear'), h('th', { class: 'num' }, 'Durability'))), h('tbody', {}, wearRows)) : null,
    destroyed.length ? h('p', { class: 'err' }, `Destroyed (0% durability): ${destroyed.join(', ')}.`) : null,
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
  if (!p || p.rosterDay !== s.roster.day || p.seed !== s.seed) {
    p = ctx.ui.plan = { rosterDay: s.roster.day, seed: s.seed, enemyIndex: null, gearIds: defaultGearIds(s, cfg), ringIds: defaultRingIds(s, cfg) };
    ctx.ui.plan_est = {};
  }
  ctx.ui.plan_est ||= {};
  p.gearIds = p.gearIds.filter((id) => s.gear.some((g) => g.id === id));
  p.ringIds = p.ringIds.filter((id) => s.rings.some((r) => r.id === id && isAdvRing(r, cfg)));
  if (p.enemyIndex != null && !s.roster.enemies[p.enemyIndex]) p.enemyIndex = null;
  return p;
}

const sortedIds = (ids) => [...ids].sort((a, b) => a - b).join(',');

// Cache key for an estimate: everything that changes the result.
function estKey(state, p, enemyIndex = p.enemyIndex) {
  return [p.seed, p.rosterDay, enemyIndex, sortedIds(p.gearIds), sortedIds(p.ringIds), intelChance(state, 'enemySight')].join('|');
}

// UI-only selection change. Cached estimates are keyed by the full selection, so a changed
// selection never shows a stale result.
function changeSel(ctx, fn) {
  fn(ctx.ui.plan);
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

function setProgress(f) {
  const fill = document.getElementById('adv-est-fill');
  if (fill) fill.style.width = `${Math.round(f * 100)}%`;
  for (const id of ['adv-est-text', 'adv-est-btn']) {
    const el = document.getElementById(id);
    if (el) el.textContent = `Simulating… ${Math.round(f * 100)}%`;
  }
}

function startEstimate(ctx) {
  const p = ctx.ui.plan;
  if (ctx.ui.plan_run || !p || p.enemyIndex == null) return;
  const key = estKey(ctx.state, p);
  const params = estimateParams(ctx, p.enemyIndex);
  const run = { key, progress: 0 };
  ctx.ui.plan_run = run;
  ctx.rerender();
  estimateWinChance(params, {}, (f) => {
    run.progress = f;
    setProgress(f);
  })
    .then((res) => {
      if (ctx.ui.plan_est) ctx.ui.plan_est[key] = res;
    })
    .catch((e) => {
      console.error(e);
      ctx.toast(`Estimate failed: ${e.message}`, 'err');
    })
    .finally(() => {
      if (ctx.ui.plan_run === run) ctx.ui.plan_run = null;
      ctx.rerender();
    });
}

export function renderPlan(root, ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const p = planSel(ctx);
  const sel = p.enemyIndex != null ? s.roster.enemies[p.enemyIndex] : null;
  const selGear = s.gear.filter((g) => p.gearIds.includes(g.id));
  const advRings = s.rings.filter((r) => isAdvRing(r, cfg));
  const selRings = advRings.filter((r) => p.ringIds.includes(r.id));
  const key = sel ? estKey(s, p) : null;
  const est = key ? ctx.ui.plan_est[key] || null : null;
  const running = ctx.ui.plan_run;
  const plan = { enemyIndex: p.enemyIndex, gearIds: [...p.gearIds], ringIds: [...p.ringIds] };
  const err = Game.validatePlan(s, plan, cfg);

  root.append(h('div', { class: 'adv-plan' },
    h('section', { class: 'panel' },
      h('h2', { class: 'adv-h2' }, `Night of day ${s.day}: plan the fight for day ${s.roster.day}`),
      h('p', { class: 'adv-tight' }, 'Pick one enemy, pack gear (up to 2 items per slot) and choose the adventurer\'s rings. ',
        'When the fight starts the enemy is fully revealed and the adventurer uses the best packed item for each slot against it. ',
        h('b', {}, 'A lost fight ends the game.'))),
    intelPanel(ctx),
    section('1. Choose an enemy',
      h('div', { class: 'adv-roster' }, s.roster.enemies.map((e, i) => {
        const k = estKey(s, p, i);
        return enemyCard(ctx, e, {
          selected: p.enemyIndex === i,
          estimate: ctx.ui.plan_est[k] || null,
          onSelect: () => changeSel(ctx, (pl) => {
            pl.enemyIndex = i;
          }),
        });
      }))),
    h('div', { class: 'cols' }, gearStep(ctx, p, selGear), ringStep(ctx, p, advRings, selRings)),
    estimatePanel(ctx, p, sel, selGear, selRings, est, running, key),
    confirmBar(ctx, p, sel, selGear, selRings, est, running, key, err)));
}

function intelPanel(ctx) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const pts = s.intel.points;
  const per = cfg.intel.daysPerPoint;
  const nextDay = (Math.floor(s.day / per) + 1) * per;
  if (pts <= 0) {
    return h('section', { class: 'panel adv-intel' },
      h('span', { class: 'muted' }, 'Scouting: '),
      SCOUT_TRACKS.map((t, i) => [i ? ' · ' : '', `${cfg.intel.tracks[t].name} `, h('b', {}, `${intelChance(s, t, cfg)}%`)]),
      h('span', { class: 'muted' }, ` — no intel points (next one at the end of day ${nextDay}).`));
  }
  return section(`Intel: ${pts} point${pts > 1 ? 's' : ''} to spend`,
    h('p', { class: 'adv-tight muted' }, 'Spending a point reveals more of this roster right away (each attribute / ring type / ring grade has a fixed hidden roll; a higher chance uncovers more of them).'),
    h('table', { class: 'adv-stats' },
      h('tbody', {}, SCOUT_TRACKS.map((t) => {
        const tr = cfg.intel.tracks[t];
        const cur = intelChance(s, t, cfg);
        const gain = nextIntelGain(s, t, cfg);
        return h('tr', {},
          h('td', {}, h('b', {}, tr.name), h('div', { class: 'muted adv-small' }, tr.desc)),
          h('td', { class: 'num' }, `${cur}%`),
          h('td', { class: 'num' }, gain > 0
            ? h('button', {
              class: 'small',
              onclick: () => ctx.act(() => spendIntel(ctx.state, t, ctx.cfg), { toast: true }),
            }, `Spend 1 point: ${cur}% → ${cur + gain}%`)
            : h('span', { class: 'muted' }, 'maxed')));
      }))));
}

function gearStep(ctx, p, selGear) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const counts = {};
  for (const g of selGear) counts[g.slot] = (counts[g.slot] || 0) + 1;
  const maxLoss = cfg.gear.durabilityLoss.max;
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
      rows.push(h('tr', { class: on ? 'adv-on' : full ? 'adv-off' : '' },
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
        h('td', {}, durabilityNode(g, cfg))));
    }
  }
  const risky = selGear.filter((g) => g.durability <= maxLoss);
  const combos = loadouts(selGear).length;
  return section('2. Pack gear',
    h('p', { class: 'adv-tight muted' }, 'Packed gear is away with the adventurer all day tomorrow: it ',
      h('b', {}, 'can\'t be repaired'), ' until it comes back in the evening. Only the items actually used lose durability.'),
    h('div', { class: 'row adv-tight' },
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = defaultGearIds(ctx.state, ctx.cfg); }) }, 'Best 2 per slot'),
      h('button', { class: 'small', onclick: () => changeSel(ctx, (pl) => { pl.gearIds = []; }) }, 'Pack nothing'),
      h('span', { class: 'muted adv-small' }, `${selGear.length} packed · ${combos} gear combination${combos === 1 ? '' : 's'} for the adventurer to choose from`)),
    s.gear.length
      ? h('div', { class: 'adv-scroll' }, h('table', { class: 'adv-stats adv-geartable' },
        h('thead', {}, h('tr', {}, h('th', {}, 'Pack'), h('th', {}, 'Item and stats'), h('th', {}, 'Durability'))),
        h('tbody', {}, rows)))
      : h('p', { class: 'warn' }, 'You own no gear: the adventurer fights unarmed with no armor.'),
    risky.length ? h('p', { class: 'err adv-small' }, `At ${maxLoss}% or less, could be destroyed if used: ${risky.map((g) => `${g.grade} ${cap(g.material)} ${cap(g.slot)} (${f1(g.durability)}%)`).join(', ')}.`) : null);
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

function estimatePanel(ctx, p, sel, selGear, selRings, est, running, key) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const preview = adventurerCombatant(bestPerSlot(selGear, 1, cfg), ringTotals(selRings, cfg), cfg);
  const left = h('div', {},
    h('h4', { class: 'adv-h4' }, 'Adventurer preview'),
    h('p', { class: 'adv-tight muted adv-small' }, 'With the strongest-looking packed item per slot and the selected rings (the real choice is made by simulation once the enemy is known).'),
    combatStatsTable([{ label: 'Adventurer', c: preview }]),
    sel ? matchupTable(ctx, sel, preview) : null);

  let right;
  if (!sel) {
    right = h('p', { class: 'muted' }, 'Pick an enemy to estimate your win chance.');
  } else {
    const known = knownLevels(s, sel, cfg);
    const nHidden = Object.keys(cfg.enemies.attributes).length - Object.keys(known).length;
    const o = cfg.sim;
    const how = h('p', { class: 'muted adv-small' },
      `${o.samples} guesses of the ${nHidden} hidden attribute${nHidden === 1 ? '' : 's'} (consistent with the tier mix). For each guess the adventurer picks the best packed gear (${o.fightsPerLoadout} test fights per combination), then fights ${o.evalFights} fresh fights: ${o.samples * o.evalFights} fights in total. A draw (safety time cap) counts as survival.`);
    if (running && running.key === key) {
      right = h('div', {},
        h('div', { class: 'bar adv-progress' }, h('div', { id: 'adv-est-fill', class: 'bar-fill', style: { width: `${Math.round(running.progress * 100)}%` } })),
        h('p', { id: 'adv-est-text', class: 'muted' }, `Simulating… ${Math.round(running.progress * 100)}%`),
        how);
    } else if (est) {
      const name = (id) => {
        const g = s.gear.find((x) => x.id === id);
        return g ? gearNameNode(g) : `#${id}`;
      };
      right = h('div', {},
        h('div', { class: 'adv-bignums' },
          h('div', {}, h('div', { class: `adv-big ${winClass(est.winPct)}` }, `${f1(est.winPct)}%`), h('div', { class: 'muted' }, 'win chance')),
          h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgTime)}s`), h('div', { class: 'muted' }, 'avg fight time')),
          h('div', {}, h('div', { class: 'adv-big' }, `${f1(est.avgHpLeftPct)}%`), h('div', { class: 'muted' }, 'avg HP left (wins)'))),
        h('p', { class: 'adv-small muted' }, `${est.fights} simulated fights vs ${sel.name}.`),
        h('h4', { class: 'adv-h4' }, 'Gear the adventurer would use'),
        est.usage.length && est.usage[0].items.length
          ? h('table', { class: 'adv-stats' },
            h('thead', {}, h('tr', {}, h('th', { class: 'num' }, 'Guesses'), h('th', {}, 'Items'))),
            h('tbody', {}, est.usage.slice(0, 6).map((u) => h('tr', {},
              h('td', { class: 'num' }, `${Math.round((u.count / o.samples) * 100)}%`),
              h('td', {}, u.items.map((id, i) => [i ? ', ' : '', name(id)]))))))
          : h('p', { class: 'muted' }, 'No gear packed (unarmed).'),
        est.usage.length > 6 ? h('p', { class: 'muted adv-small' }, `… and ${est.usage.length - 6} more combinations.`) : null,
        how);
    } else {
      right = h('div', {},
        h('p', {}, 'Not estimated for this selection yet. ', h('button', { class: 'small', disabled: !!running, onclick: () => startEstimate(ctx) }, 'Estimate win chance')),
        how);
    }
  }
  return section(sel ? `Win chance vs ${sel.name}` : 'Win chance', h('div', { class: 'cols' }, left, h('div', {}, h('h4', { class: 'adv-h4' }, 'Estimate'), right)));
}

function confirmBar(ctx, p, sel, selGear, selRings, est, running, key, err) {
  const s = ctx.state;
  const cfg = ctx.cfg;
  const isRunningHere = running && running.key === key;
  const estLabel = isRunningHere ? `Simulating… ${Math.round(running.progress * 100)}%` : running ? 'Simulating…' : est ? 'Estimated' : 'Estimate win chance';
  return h('div', { class: 'adv-bar' },
    h('div', { class: 'adv-bar-info' },
      sel ? [h('b', {}, sel.name), ' ', h('span', { class: `tier-${sel.tier}` }, `(${sel.tier}, +${cfg.enemies.tiers[sel.tier].score} pts)`)] : h('span', { class: 'warn' }, 'No enemy chosen'),
      h('span', { class: 'muted' }, ` · ${selGear.length} gear packed · ${selRings.length}/${cfg.rings.maxWorn} rings`),
      est ? h('span', {}, ' · win ≈ ', h('b', { class: winClass(est.winPct) }, `${f1(est.winPct)}%`)) : null,
      err ? h('div', { class: 'warn adv-small' }, err) : null),
    h('button', {
      id: 'adv-est-btn',
      disabled: !sel || !!running || !!est,
      title: !sel ? 'Pick an enemy first' : est ? 'Already estimated for this selection' : 'Simulate many fights with this selection',
      onclick: () => startEstimate(ctx),
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
        const res = ctx.act(() => Game.confirmPlan(ctx.state, plan, ctx.cfg));
        if (res && res.ok) {
          ctx.ui.plan = null;
          ctx.ui.plan_est = {};
        }
      },
    }, `Confirm & start day ${s.roster.day}`));
}
