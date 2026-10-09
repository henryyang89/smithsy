// Loss analysis: "What went wrong?" on the run summary. After a lost fight the same fight is replayed many times (the
// same enemy, now fully known, with the same gear and rings), and the best gear the player owned is searched to see
// whether gear left at home would have helped. Screen only: nothing here runs inside resolveBattle, so bots and the
// benchmark never pay for it, and nothing here changes the game state.
import { CONFIG } from '../config.js';
import { seededRng, mixSeed } from './rng.js';
import { adventurerCombatant, fight } from './combat.js';
import { searchLoadout, loadoutEval } from './sim.js';

export const SEGMENTS = ['lostBadly', 'lostClose', 'draw', 'wonClose', 'wonEasily'];

// The fights of one replay run in steps, from one seeded random stream: running 500 fights in five steps of 100 gives
// exactly the numbers of one step of 500.
function replayRun(adv, enemyC, seed, cfg) {
  const rng = seededRng(seed);
  const cut = cfg.report.closeCut / 100;
  const t = { n: 0, wins: 0, draws: 0, losses: 0, seg: Object.fromEntries(SEGMENTS.map((k) => [k, 0])) };
  return {
    run(k) {
      for (let i = 0; i < k; i++) {
        const r = fight(adv, enemyC, rng.next, false, cfg);
        t.n += 1;
        if (r.win) {
          t.wins += 1;
          t.seg[r.advHp / adv.hp < cut ? 'wonClose' : 'wonEasily'] += 1;
        } else if (r.draw) {
          t.draws += 1;
          t.seg.draw += 1;
        } else {
          t.losses += 1;
          t.seg[r.enemyHp / enemyC.hp < cut ? 'lostClose' : 'lostBadly'] += 1;
        }
      }
    },
    result: () => ({ n: t.n, wins: t.wins, draws: t.draws, losses: t.losses, winPct: t.n ? (t.wins / t.n) * 100 : 0, seg: { ...t.seg } }),
  };
}

// n fights of `adv` against `enemyC`, seeded. Returns { n, wins, draws, losses, winPct, seg } where seg counts the fights
// by how they ended (report.closeCut is the % of HP left that splits "close" from "badly" and "easily"):
//   lostBadly: the enemy kept at least closeCut% of its HP · lostClose: less than that · draw: the safety time cap
//   wonClose: the adventurer kept less than closeCut% of its HP · wonEasily: at least that.
export function replayStats(adv, enemyC, n, seed, cfg = CONFIG) {
  const r = replayRun(adv, enemyC, seed, cfg);
  r.run(n);
  return r.result();
}

// The gear the player owned and did not pack for the fight (state.gear minus the report's packed ids). A destroyed item
// is gone from state.gear, but it was packed, so it is never "home gear". An item smithed on the fight day, after the
// packing was locked in, did not exist when the player chose (its id is above report.lastGearId): it is not home gear.
export function homeGear(state, report) {
  const packed = new Set(report.packedIds || []);
  const last = report.lastGearId;
  return state.gear.filter((g) => !packed.has(g.id) && (last == null || g.id <= last));
}

// A gear item as the analysis keeps it (no packed flag): enough to name it and to work out its stats.
const snap = (g) => ({ id: g.id, slot: g.slot, material: g.material, grade: g.grade, gem: g.gem ? { type: g.gem.type, grade: g.gem.grade } : null, durability: g.durability });

// The analysis as steps: each `yield` is the progress so far (0..1); the return value is the Analysis. The sync and the
// async versions both run this, so they give the same numbers.
function* analysisSteps(state, report, cfg) {
  const rc = cfg.report;
  const day = report.day;
  const seed = mixSeed(state.seed, day, 501); // replays of the used gear and of the best gear share it: the gain is not noise
  const STEP = Math.max(1, Math.round(rc.replayFights / 10));
  const replay = function* (adv, from, weight) {
    const run = replayRun(adv, report.enemyC, seed, cfg);
    for (let done = 0; done < rc.replayFights; done += STEP) {
      run.run(Math.min(STEP, rc.replayFights - done));
      yield from + (weight * Math.min(rc.replayFights, done + STEP)) / rc.replayFights;
    }
    return run.result();
  };

  const used = yield* replay(report.adv, 0, 0.3);
  const thisFight = {
    enemyHpPct: report.enemyMaxHp > 0 ? (report.enemyHp / report.enemyMaxHp) * 100 : 0,
    advHpPct: report.advMaxHp > 0 ? (report.advHp / report.advMaxHp) * 100 : 0,
  };

  // everything owned: what was used, what was packed and not used, what stayed home (one item per gear type in the end)
  const home = homeGear(state, report);
  const homeIds = new Set(home.map((g) => g.id));
  const candidates = [...(report.used || []), ...(report.notUsed || []), ...home];
  const rings = report.ringTotals || {};
  yield 0.35;
  const pick = candidates.length
    ? searchLoadout(candidates, loadoutEval(rings, report.enemyC, mixSeed(state.seed, day, 502), rc.whatIfFights, cfg), cfg)
    : { items: [] };
  yield 0.4;
  const bestAdv = adventurerCombatant(pick.items, rings, cfg);
  const best = yield* replay(bestAdv, 0.4, 0.6);

  const gain = best.winPct - used.winPct;
  const fromHome = pick.items.filter((g) => homeIds.has(g.id)).map(snap);
  const replaced = fromHome.map((g) => (report.used || []).find((u) => u.slot === g.slot)).filter(Boolean).map(snap);
  const verdict = !home.length ? 'noHome' : fromHome.length && gain >= rc.whatIfMinGain - 1e-9 ? 'helped' : 'notHelped';
  return {
    n: rc.replayFights,
    seed,
    used,
    thisFight,
    whatIf: { verdict, items: pick.items.map(snap), fromHome, replaced, best, gain },
  };
}

// The analysis, all at once (tests and tools).
export function analyzeLossSync(state, report, cfg = CONFIG) {
  const g = analysisSteps(state, report, cfg);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

// The same analysis for the screen: it gives the page a breath between steps and reports its progress (0..1) through
// onProgress(fraction); if onProgress returns false the work stops and the result is null. Reaches onProgress(1).
export async function analyzeLoss(state, report, cfg = CONFIG, onProgress = null) {
  const g = analysisSteps(state, report, cfg);
  let r = g.next();
  while (!r.done) {
    await new Promise((res) => setTimeout(res, 0));
    if (onProgress && onProgress(r.value) === false) return null;
    r = g.next();
  }
  if (onProgress && onProgress(1) === false) return null;
  return r.value;
}

// Keep a finished analysis on the report and on its entry in state.battles (the same fight, a separate object after a load).
export function cacheAnalysis(state, report, analysis) {
  report.analysis = analysis;
  const entry = state.battles.find((b) => b.day === report.day && b.enemy.name === report.enemy.name);
  if (entry && entry !== report) entry.analysis = analysis;
  return analysis;
}
