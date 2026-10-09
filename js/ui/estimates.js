// The win estimate, worked out by itself. The plan screen and the Adventurer tab show an estimate for every enemy of the
// roster; nobody presses a button. One run at a time works through the enemies that have no result for the CURRENT
// selection (the one the player has chosen first, then left to right), reusing estimateWinChance (async: it yields
// between guesses, and a run stops at the next guess when it is cancelled).
//
// A screen calls scheduleEstimates(ctx, scope) every time it renders:
//   scope = { id: 'plan' | 'adv', gearIds, ringIds, selected? }   the gear and rings the estimate is for (selected = the
//                                                                  chosen enemy's index, worked out first)
// Results are cached in ctx.ui.est_cache under estimateKey (ui/present.js), so the same selection never runs twice
// and a screen can read a result at any time with cachedEstimate. The cache starts empty for every new roster / game.
// ctx.ui.estimates === 'off' switches the whole thing off (render tests).
import { h, tip } from './dom.js';
import { estimateWinChance, simCounts, shownMargin } from '../core/sim.js';
import { ringTotals } from '../core/rings.js';
import { knownLevels } from '../core/enemies.js';
import { mixSeed } from '../core/rng.js';
import { estimateKey, estimateTip, winText, winClass } from './present.js';

export const DEBOUNCE_MS = 300; // a gear / ring change waits this long for the next one before a run starts

const off = (ctx) => ctx.ui.estimates === 'off';

const snapshot = (scope) => ({ id: scope.id, gearIds: [...scope.gearIds], ringIds: [...scope.ringIds], selected: scope.selected ?? null });

function keyFor(ctx, scope, i, counts) {
  return estimateKey(ctx.state, scope, i, ctx.cfg, counts);
}

// The finished result for enemy `i` of the roster under this selection, or null.
export function cachedEstimate(ctx, scope, i) {
  const cache = ctx.ui.est_cache;
  if (!cache || !ctx.state.roster || !ctx.state.roster.enemies[i]) return null;
  return cache[keyFor(ctx, scope, i)] || null;
}

// True while a run is going or about to start (a gear change is waiting out the debounce).
export const estimatesPending = (ctx) => !!(ctx.ui.est_run || ctx.ui.est_timer);

// "Estimating 3 of 7…" while working, else null.
export function estimateStatus(ctx) {
  const run = ctx.ui.est_run;
  if (run) return `Estimating ${Math.min(run.index + 1, run.total)} of ${run.total}…`;
  if (ctx.ui.est_timer) return 'Estimating…';
  return null;
}

// Stop everything: a pending start, and a run in progress (its remaining work is for a selection / roster / game
// that is gone). Nothing more is simulated or painted. Called when a plan is confirmed and by main.js for a new game.
export function cancelEstimates(ctx) {
  if (ctx.ui.est_timer) clearTimeout(ctx.ui.est_timer);
  ctx.ui.est_timer = null;
  if (ctx.ui.est_run) ctx.ui.est_run.cancelled = true;
  ctx.ui.est_run = null;
}

// Forget every result (a new roster or a new game).
export function clearEstimates(ctx) {
  cancelEstimates(ctx);
  ctx.ui.est_cache = {};
  ctx.ui.est_roster = null;
  ctx.ui.est_scope = null;
  ctx.ui.est_first = false;
  ctx.ui.est_screen = null;
}

function jobsFor(ctx, scope, counts) {
  const { state, cfg } = ctx;
  const cache = ctx.ui.est_cache;
  const order = state.roster.enemies.map((e, i) => i);
  if (scope.selected != null && order.includes(scope.selected)) order.unshift(...order.splice(order.indexOf(scope.selected), 1));
  return order
    .map((i) => ({ i, key: keyFor(ctx, scope, i, counts), enemy: state.roster.enemies[i] }))
    .filter((j) => !cache[j.key])
    .map((j) => ({ ...j, params: {
      gearItems: state.gear.filter((g) => scope.gearIds.includes(g.id)),
      ringTotals: ringTotals(state.rings.filter((r) => scope.ringIds.includes(r.id)), cfg),
      tier: j.enemy.tier,
      day: state.roster.day,
      known: knownLevels(state, j.enemy, cfg),
      seed: mixSeed(state.seed, state.roster.day, j.i), // the same enemy and selection always give the same estimate
    } }));
}

// Everything the current selection would need, as one string: a run that was started for another one is stale.
function signature(ctx, scope, counts) {
  return ctx.state.roster.enemies.map((e, i) => keyFor(ctx, scope, i, counts)).join('#');
}

// The estimate cell of the roster table: the win % (coloured by chance) with its ± under it, "…" while it is being
// worked out, "—" when it is not (estimates off).
export function estimateCell(res, pending = false) {
  if (res) {
    const m = shownMargin(res);
    return h('div', { class: 'rt-ec' },
      h('span', { class: `adv-badge ${winClass(res.winPct)}`, ...tip(estimateTip(res)) }, winText(res.winPct)),
      m != null ? h('div', { class: 'muted rt-sm rt-pm' }, `± ${m}`) : null);
  }
  if (pending) return h('span', { class: 'muted', ...tip('Working out the win chance…') }, '…');
  return h('span', { class: 'muted', ...tip('Not worked out yet.') }, '—');
}

// Paint the finished results into the roster table that is on screen, and the status text, without re-rendering the
// screen (so a scroll position, a focused checkbox or a click in progress is not disturbed).
function paint(ctx) {
  const scope = ctx.ui.est_scope;
  if (typeof document === 'undefined') return;
  if (scope) {
    for (const td of document.querySelectorAll('.rt td[data-est]')) {
      const i = Number(td.getAttribute('data-est'));
      const res = cachedEstimate(ctx, scope, i);
      td.replaceChildren(estimateCell(res, estimatesPending(ctx)));
    }
  }
  const text = estimateStatus(ctx) || '';
  for (const el of document.querySelectorAll('.est-status')) el.textContent = text;
}

// Redraw the whole screen only while the screen that asked for this run is still the one shown. scheduleEstimates marks
// it (ctx.ui.est_screen) every time that screen renders and main.js clears the mark at the start of every render, so a
// run that outlives a tab change fills the cache and paints (nothing, then) instead of rebuilding another tab and costing
// it its focus and typed text.
function redraw(ctx, run) {
  if (ctx.ui.est_screen === run.screen) ctx.rerender();
  else paint(ctx);
}

async function runJobs(ctx, run) {
  const { cfg } = ctx;
  try {
    for (let n = 0; n < run.jobs.length; n++) {
      if (run.cancelled) return;
      const job = run.jobs[n];
      run.index = n;
      const res = await estimateWinChance(job.params, run.opts, (f) => {
        if (run.cancelled) return false; // stops the simulation at the next guess
        run.progress = (n + f) / run.jobs.length;
        return true;
      }, cfg);
      if (run.cancelled || !res) return; // cancelled in the middle of a job: no result
      ctx.ui.est_cache[job.key] = { ...res, counts: run.counts };
      if (run.selected != null && job.i === run.selected && n + 1 < run.jobs.length) redraw(ctx, run); // the chosen enemy: show its details now
      else paint(ctx);
    }
  } catch (e) {
    console.error(e);
    if (ctx.toast) ctx.toast(`Estimate failed: ${e.message}`, 'err');
  } finally {
    if (ctx.ui.est_run === run) ctx.ui.est_run = null;
    if (!run.cancelled) redraw(ctx, run);
  }
}

function startRun(ctx) {
  ctx.ui.est_timer = null;
  const scope = ctx.ui.est_scope;
  if (!scope || !ctx.state.roster) return;
  const counts = simCounts(ctx.state, ctx.cfg);
  const jobs = jobsFor(ctx, scope, counts);
  if (!jobs.length) return;
  const run = {
    jobs, total: jobs.length, index: 0, progress: 0, cancelled: false, selected: scope.selected, counts, screen: scope.id,
    sig: signature(ctx, scope, counts),
    opts: { samples: counts.samples, evalFights: counts.evalFights, fightsPerLoadout: counts.fightsPerLoadout },
  };
  ctx.ui.est_run = run;
  ctx.ui.est_first = true; // later changes of this roster's selection wait out the debounce
  run.done = runJobs(ctx, run);
  paint(ctx);
}

// Make sure every enemy of the roster gets an estimate for this selection. Cheap to call on every render: it does
// nothing when everything is cached or the right run is already going; otherwise it (re)starts after the debounce
// (opts.immediate: at once; the default is at once for the first run of a roster and after the debounce for every later change).
export function scheduleEstimates(ctx, scope, opts = {}) {
  if (off(ctx) || !ctx.state.roster) return;
  const id = `${ctx.state.seed}|${ctx.state.roster.day}`;
  if (ctx.ui.est_roster !== id) {
    clearEstimates(ctx); // a new roster or game: nothing from the old one counts
    ctx.ui.est_roster = id;
  }
  if (!ctx.ui.est_cache) ctx.ui.est_cache = {};
  const scoped = snapshot(scope);
  ctx.ui.est_scope = scoped;
  ctx.ui.est_screen = scoped.id; // this screen is the one being drawn (see redraw)
  const counts = simCounts(ctx.state, ctx.cfg);
  const run = ctx.ui.est_run;
  const stale = !!run && !run.cancelled && run.sig !== signature(ctx, scoped, counts); // a run for another selection
  if (!jobsFor(ctx, scoped, counts).length) {
    if (ctx.ui.est_timer) clearTimeout(ctx.ui.est_timer);
    ctx.ui.est_timer = null;
    if (stale) cancelEstimates(ctx); // back on a finished selection: the other one's run is no longer wanted
    return;
  }
  if (run && !run.cancelled) {
    if (!stale) return; // already working on exactly this
    cancelEstimates(ctx); // the selection changed under it
  }
  if (ctx.ui.est_timer) clearTimeout(ctx.ui.est_timer);
  if (opts.immediate ?? !ctx.ui.est_first) startRun(ctx);
  else ctx.ui.est_timer = setTimeout(() => startRun(ctx), DEBOUNCE_MS);
}

// Resolves when the current run (if any) has finished; for tests and tools.
export async function whenEstimatesDone(ctx) {
  for (let guard = 0; guard < 50; guard++) {
    if (ctx.ui.est_timer) {
      await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 20));
      continue;
    }
    const run = ctx.ui.est_run;
    if (!run) return;
    await run.done;
  }
}
