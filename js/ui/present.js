// Display helpers that need no DOM (so tests and tools can use them). Each turns game numbers into the text the
// player reads; the game itself keeps its own, more exact numbers.
import { CONFIG, SLOTS, BARS, GEMS, GRADES, TIERS } from '../config.js';
import { shownDurability, GEM_MATCH, gearName } from '../core/gear.js';
import { knownLevels } from '../core/enemies.js';
import { simCounts, shownMargin } from '../core/sim.js';
import { packOrder } from '../core/pack.js';
import { SEGMENTS } from '../core/replay.js';
import { clamp, formatClock, formatDuration, EPS } from '../core/util.js';

// Durability as the player reads it: a whole number ("63%"), never a decimal. Costs and times use the exact value.
export const durText = (d) => `${shownDurability(d)}%`;

// What a repair adds, as shown on the Repair button: the gap between the SHOWN durability and 100, so the shown
// durability plus the shown gain always add up to 100.
export const repairGainShown = (d) => 100 - shownDurability(d);

// A win chance in whole percent: "62%".
export const winText = (v) => `${Math.round(v)}%`;

// Item or ring ids as one sortable string: "3,7,12".
export const sortedIds = (ids) => [...ids].sort((a, b) => a - b).join(',');

// The cache key of one enemy's win estimate: everything that can change the result, and nothing else. That is the
// game and roster (seed, roster day), the enemy, the packed gear and worn rings (ids), what the player can see of the
// enemy (the visible attribute levels: the estimate guesses the rest) and the size of the simulation (guesses, test
// fights, fights per gear combination). The enemy the player has clicked on is not part of it: picking another
// column changes nothing about any estimate.
// scope = { gearIds, ringIds } (a plan selection, or the Adventurer tab's default pack). counts = simCounts(state).
export function estimateKey(state, scope, enemyIndex, cfg = CONFIG, counts = simCounts(state, cfg)) {
  const known = knownLevels(state, state.roster.enemies[enemyIndex], cfg);
  const knownSig = Object.keys(known).sort().map((k) => `${k}:${known[k]}`).join(',');
  return [state.seed, state.roster.day, enemyIndex, sortedIds(scope.gearIds), sortedIds(scope.ringIds), knownSig,
    counts.samples, counts.evalFights, counts.fightsPerLoadout].join('|');
}

// "62% ± 14 from 25 test fights (could be 48-76%; hidden attributes add more)." for the hover on an estimate.
export function estimateTip(res) {
  const m = shownMargin(res);
  if (m == null) return `${winText(res.winPct)} from ${res.fights} test fights.`;
  const lo = Math.max(0, Math.round(res.winPct - m));
  const hi = Math.min(100, Math.round(res.winPct + m));
  return `${winText(res.winPct)} ± ${m} from ${res.fights} test fights (could be ${lo}-${hi}%; hidden attributes add more).`;
}

// "62% ± 14" (or just "62%" when the estimate has no fights to measure a margin from).
export const winWithMargin = (res) => (shownMargin(res) != null ? `${winText(res.winPct)} ± ${shownMargin(res)}` : winText(res.winPct));

// Colour class of a win chance: 90 and up ok, 70 and up warn, else err.
export const winClass = (p) => (p >= 90 ? 'ok' : p >= 70 ? 'warn' : 'err');

// "Your answers" to the chosen enemy: for every High special you can SEE, whether the packed armor has the gem that
// answers it (ruby for Magical, diamond for Piercing, topaz for Stunning, sapphire for Chilling, emerald for Accurate).
// packed = the packed gear items, known = the visible attribute levels.
// Returns [{ gem, special (its name), ok, item ('ruby chest' or null) }] in the gems' order.
export function gearAnswers(packed, known, cfg = CONFIG) {
  const out = [];
  for (const [gem, [special]] of Object.entries(GEM_MATCH)) {
    if (known[special] !== 'high') continue;
    const armor = packed.find((g) => g.slot !== 'sword' && g.gem && g.gem.type === gem);
    out.push({ gem, special: cfg.enemies.attributes[special].name, ok: !!armor, item: armor ? `${gem} ${armor.slot}` : null });
  }
  return out;
}

// ----------------------------------------------------------- the work day ----
// The top bar's work-day bar: it fills from left to right as the day's minutes are used. { used, left, len } are minutes,
// frac is 0..1 (the fill width), tone is 'ok', 'mid' (from display.dayBarWarnPct used) or 'low' (from dayBarLowPct), and
// label is the sentence for the hover / screen readers.
export function dayProgress(state, cfg = CONFIG) {
  const start = cfg.time.dayStartMin;
  const len = cfg.time.dayEndMin - start;
  const used = clamp(state.time - start, 0, len);
  const left = len - used;
  const frac = len > 0 ? used / len : 1;
  const tone = frac * 100 >= cfg.display.dayBarLowPct - EPS ? 'low' : frac * 100 >= cfg.display.dayBarWarnPct - EPS ? 'mid' : 'ok';
  const label = left > EPS
    ? `${formatDuration(used)} of the ${formatDuration(len)} work day used, ${formatDuration(left)} left (${formatClock(start)}-${formatClock(cfg.time.dayEndMin)})`
    : 'The work day is over';
  return { used, left, len, frac, tone, label };
}

// The top bar's clock: { clock, note, label, bar }. In a work day "16:47" + "1h 12.2m left" (the bar and its hover are
// dayProgress's); once the day's time is used "18:00 day over". A finished run (retired mid-day, or lost) has no work day
// any more: no clock, "Run over" and no bar. `left` is the minutes left today (timeLeft).
export function clockStatus(state, left, cfg = CONFIG) {
  if (state.phase === 'over') return { clock: null, note: 'Run over', label: null, bar: false };
  return {
    clock: formatClock(Math.min(state.time, cfg.time.dayEndMin)),
    note: left > EPS ? `${formatDuration(left)} left` : 'day over',
    label: dayProgress(state, cfg).label,
    bar: true,
  };
}

// ------------------------------------------------------ refine / cut results ----
const GRADE_LOW_TO_HIGH = GRADES; // D C B A S

// What a refine / cut action did, for the result box and its colour. res is the core result of one action
// ({ ok, grade, ... }) or of a batch ({ ok, results: [...] }). Returns { tone: 'ok' | 'err', made, failed, grades }:
// made = successes, failed = lost attempts, grades = { D: 2, C: 1 } (successes only). The tone is 'err' when the action
// was refused or any attempt failed.
export function processOutcome(res) {
  const list = res && res.results ? res.results : res && res.ok && res.grade ? [res] : [];
  const grades = {};
  let made = 0;
  let failed = 0;
  for (const r of list) {
    if (r.grade === 'F') failed += 1;
    else {
      made += 1;
      grades[r.grade] = (grades[r.grade] || 0) + 1;
    }
  }
  return { tone: !res || !res.ok || failed > 0 ? 'err' : 'ok', made, failed, grades };
}

// "2 of 5 failed", the part of a batch message the result box shows in bold; null when nothing failed or for one attempt.
export function failedText(res) {
  if (!res || !res.results) return null;
  const { failed } = processOutcome(res);
  return failed > 0 ? `${failed} of ${res.results.length} failed` : null;
}

// The text of the result box. One attempt: the core message. A batch: "Copper: refined 5 in 1h 15m: 3 bars (D 2, C 1),
// 2 of 5 failed (ore lost)." (grades from lowest to highest, none with a zero count). kind is 'refine' or 'cut'.
export function processMessage(kind, material, res) {
  if (!res || !res.results) return res ? res.msg : '';
  const { made, failed, grades } = processOutcome(res);
  const n = res.results.length;
  const minutes = res.results.reduce((a, r) => a + (r.minutes || 0), 0);
  const refine = kind === 'refine';
  const unit = refine ? (made === 1 ? 'bar' : 'bars') : (made === 1 ? 'gem' : 'gems');
  const list = GRADE_LOW_TO_HIGH.filter((g) => grades[g]).map((g) => `${g} ${grades[g]}`).join(', ');
  const name = material.charAt(0).toUpperCase() + material.slice(1);
  return `${name}: ${refine ? 'refined' : 'cut'} ${n} in ${formatDuration(minutes)}: ${made} ${unit}${list ? ` (${list})` : ''}${failed ? `, ${failedText(res)} (${refine ? 'ore' : 'gems'} lost)` : ''}.`;
}

// ------------------------------------------------------------- combat log ----
// One row per attack of a fight, for the combat log table (Time · Attacker · Result · Effects · You · Foe). Both HP values
// are those after the attack; hitSide is the side whose HP dropped ('A' you, 'E' the foe) on a hit, null on a miss.
// detail is the muted "6.0 + 2.2 magic" part of a hit; effects is the stun / slow text of a hit, '' when there is none.
export function combatLogRows(report) {
  const en = report.enemy.name;
  const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
  const trim = (v, d) => String(Math.round(v * 10 ** d) / 10 ** d); // 5 not 5.0, 1.5 as it is
  return (report.log || []).map((e) => {
    const effects = [];
    if (e.hit && e.stun) effects.push(`Stun ${trim(e.stun, 2)}s`);
    if (e.hit && e.slow) effects.push(`Slow ${trim(e.slow.pct, 1)}% ${trim(e.slow.dur, 1)}s`);
    return {
      t: e.t,
      time: `${e.t.toFixed(1)}s`,
      side: e.side,
      attacker: e.side === 'A' ? 'Adventurer' : en,
      hit: !!e.hit,
      result: e.hit ? `Hit for ${f1(e.dmg)}` : `Miss (${Math.round(e.hitPct)}% to hit)`,
      detail: e.hit && e.magic > 0.005 ? `${f1(e.phys)} + ${f1(e.magic)} magic` : '',
      effects: effects.join(' · '),
      hpA: e.hpA,
      hpE: e.hpE,
      hitSide: e.hit ? (e.side === 'A' ? 'E' : 'A') : null,
    };
  });
}

// ------------------------------------------------------ storage and gear ----
// The gear of the Workshop overview: one row per gear type, the items of each material best first (packOrder), and the
// gem types that type has on some item (GEMS order, with counts). Every item is in exactly one cell.
// Returns { rows: [{ slot, total, cells: { copper: [item...], ... }, gems: [{ gem, count }] }], total }.
export function gearMatrix(items, cfg = CONFIG) {
  const order = packOrder(cfg);
  const rows = SLOTS.map((slot) => {
    const mine = items.filter((g) => g.slot === slot).sort(order);
    return {
      slot,
      total: mine.length,
      cells: Object.fromEntries(BARS.map((m) => [m, mine.filter((g) => g.material === m)])),
      gems: GEMS.map((gem) => ({ gem, count: mine.filter((g) => g.gem && g.gem.type === gem).length })).filter((x) => x.count > 0),
    };
  });
  return { rows, total: rows.reduce((a, r) => a + r.total, 0) };
}

// The gem table of the Workshop overview: per gem type the raw gems, the cut gems by grade (D..S) and how many gear items
// carry that gem. [{ gem, raw, cut: { D, C, B, A, S }, inGear }] in GEMS order.
export function gemOverview(state) {
  return GEMS.map((gem) => ({
    gem,
    raw: state.storage.gem[gem] || 0,
    cut: Object.fromEntries(GRADES.map((g) => [g, state.storage.cut[`${gem}:${g}`] || 0])),
    inGear: state.gear.filter((it) => it.gem && it.gem.type === gem).length,
  }));
}

// ------------------------------------------------------- score and report ----
// How the score is worked out, for the run summary: per enemy tier the wins, the points one win gives and their product.
// { rows: [{ tier, wins, each, points }], total } (total = the run's score). Draws and losses add nothing.
export function scoreBreakdown(state, cfg = CONFIG) {
  const rows = TIERS.map((tier) => {
    const wins = state.stats.wins[tier] || 0;
    const each = cfg.enemies.tiers[tier].score;
    return { tier, wins, each, points: wins * each };
  });
  return { rows, total: rows.reduce((a, r) => a + r.points, 0) };
}

const SEGMENT_LABELS = { lostBadly: 'Lost badly', lostClose: 'Lost close', draw: 'Draw', wonClose: 'Won close', wonEasily: 'Won easily' };

// The five parts of the outcome bar of a replay (replayStats result): [{ key, label, count, pct }] in a fixed order, from
// the worst outcome to the best; zero parts are included (the screen leaves them out). The counts add up to stats.n.
export function outcomeSegments(stats) {
  return SEGMENTS.map((key) => ({ key, label: SEGMENT_LABELS[key], count: stats.seg[key] || 0, pct: stats.n ? ((stats.seg[key] || 0) / stats.n) * 100 : 0 }));
}

// Which part of the outcome bar the real fight belongs to: 'lostBadly', 'lostClose', 'draw', 'wonClose' or 'wonEasily'.
export function fightSegment(report, cfg = CONFIG) {
  const cut = cfg.report.closeCut / 100;
  if (report.win) return report.advMaxHp > 0 && report.advHp / report.advMaxHp < cut ? 'wonClose' : 'wonEasily';
  if (report.draw) return 'draw';
  return report.enemyMaxHp > 0 && report.enemyHp / report.enemyMaxHp < cut ? 'lostClose' : 'lostBadly';
}

const names = (list) => list.map(gearName).join(', ');

// The answer to "Would gear left at home have helped?": { verdict, text } from an Analysis (core/replay.js).
export function whatIfText(analysis) {
  const w = analysis.whatIf;
  const best = winText(w.best.winPct);
  if (w.verdict === 'noHome') return { verdict: w.verdict, text: 'You had no other gear at home: everything you owned was packed.' };
  if (w.verdict === 'helped') {
    const pts = Math.round(w.gain);
    // a home item swaps a used one only when something of its type was used; one that fills an empty slot replaced nothing
    // and is named on its own, so the sentence never reads as a one-for-one swap that did not happen
    const swaps = w.fromHome.filter((g) => w.replaced.some((r) => r.slot === g.slot));
    const adds = w.fromHome.filter((g) => !swaps.includes(g));
    const swapText = swaps.length ? `${names(swaps)} from home (instead of ${names(w.replaced)})` : '';
    const addText = adds.length ? `${names(adds)} from home` : '';
    const who = swapText && addText ? `${swapText}, plus ${addText}` : swapText || addText;
    return { verdict: w.verdict, text: `Yes. With ${who}, the best gear you owned wins about ${best} (+${pts} point${pts === 1 ? '' : 's'}).` };
  }
  return { verdict: w.verdict, text: `No. Nothing you left at home would have helped much: the best gear you owned wins about ${best}.` };
}
