// The automatic win estimates (js/ui/estimates.js): one run at a time, cached under estimateKey, started by itself,
// restarted when the selection changes, never run twice for the same selection. Runs on the fake DOM; nothing
// here presses a button.
import test from 'node:test';
import assert from 'node:assert/strict';
import { installFakeDom, textOf, tipsOf } from './fakedom.mjs';
import { CONFIG } from '../js/config.js';
import { endDay } from '../js/core/game.js';
import { estimateWinChanceSync, simCounts } from '../js/core/sim.js';
import { ringTotals } from '../js/core/rings.js';
import { knownLevels } from '../js/core/enemies.js';
import { mixSeed } from '../js/core/rng.js';
import { estimateKey } from '../js/ui/present.js';
import {
  scheduleEstimates, cancelEstimates, clearEstimates, cachedEstimate, estimatesPending, estimateStatus, estimateCell, whenEstimatesDone, DEBOUNCE_MS,
} from '../js/ui/estimates.js';
import { game, addGear, addRing } from './helpers.mjs';

installFakeDom();

// A game at the plan phase with a little gear, and the ctx the app shell would pass (rerender counts its calls).
function setup(seed = 7) {
  const s = game(seed);
  const sword = addGear(s, 'sword', 'iron', 'C');
  const chest = addGear(s, 'chest', 'copper', 'D');
  endDay(s);
  const ctx = { state: s, cfg: CONFIG, ui: {}, rerenders: 0, rerender() { this.rerenders++; }, toast() {}, act: (f) => f() };
  return { s, ctx, sword, chest };
}
const scopeOf = (gear, rings = [], extra = {}) => ({ id: 'plan', gearIds: gear.map((g) => g.id), ringIds: rings.map((r) => r.id), ...extra });
const n = (ctx) => ctx.state.roster.enemies.length;

test('the first call with an empty cache starts at once and works through every enemy; nothing needs a button', async () => {
  const { ctx, sword, chest } = setup();
  const scope = scopeOf([sword, chest]);
  scheduleEstimates(ctx, scope);
  assert.equal(estimatesPending(ctx), true, 'working');
  assert.equal(estimateStatus(ctx), `Estimating 1 of ${n(ctx)}…`);
  assert.equal(cachedEstimate(ctx, scope, 0), null, 'nothing yet');
  await whenEstimatesDone(ctx);
  assert.equal(estimatesPending(ctx), false);
  assert.equal(estimateStatus(ctx), null);
  for (let i = 0; i < n(ctx); i++) {
    const r = cachedEstimate(ctx, scope, i);
    assert.ok(r && Number.isFinite(r.winPct), `enemy ${i}`);
    assert.equal(r.fights, ctx.state.roster.enemies.length ? simCounts(ctx.state).samples * simCounts(ctx.state).evalFights : 0);
    assert.deepEqual(r.counts, simCounts(ctx.state), 'the result says how big the simulation was');
  }
  assert.ok(ctx.rerenders >= 1, 'the screen is redrawn when the run is done');
});

test('a result equals the plain estimate for the same gear, rings, enemy and seed: the same selection always shows the same number', async () => {
  const { s, ctx, sword, chest } = setup();
  const ring = addRing(s, 'accuracy', 'A');
  const scope = scopeOf([sword, chest], [ring]);
  scheduleEstimates(ctx, scope);
  await whenEstimatesDone(ctx);
  // the first, a middle and the last enemy of however big the roster is (its size comes from the tier counts in CONFIG)
  for (const i of new Set([0, Math.floor((n(ctx) - 1) / 2), n(ctx) - 1])) {
    const enemy = s.roster.enemies[i];
    const direct = estimateWinChanceSync({
      gearItems: s.gear.filter((g) => scope.gearIds.includes(g.id)),
      ringTotals: ringTotals([ring], CONFIG),
      tier: enemy.tier,
      day: s.roster.day,
      known: knownLevels(s, enemy),
      seed: mixSeed(s.seed, s.roster.day, i),
    }, simCounts(s));
    const got = cachedEstimate(ctx, scope, i);
    assert.equal(got.winPct, direct.winPct, `enemy ${i}`);
    assert.equal(got.wins, direct.wins);
  }
});

test('a finished selection is cached: calling again starts nothing, and the plan screen and the Adventurer tab share the results', async () => {
  const { ctx, sword, chest } = setup();
  const plan = scopeOf([sword, chest], [], { id: 'plan', selected: 2 });
  scheduleEstimates(ctx, plan);
  await whenEstimatesDone(ctx);
  const cache = { ...ctx.ui.est_cache };
  scheduleEstimates(ctx, plan);
  assert.equal(estimatesPending(ctx), false, 'nothing to do');
  scheduleEstimates(ctx, { id: 'adv', gearIds: plan.gearIds, ringIds: plan.ringIds }); // the same selection from the other screen
  assert.equal(estimatesPending(ctx), false, 'the other screen reuses the results');
  assert.deepEqual(ctx.ui.est_cache, cache);
  for (let i = 0; i < n(ctx); i++) assert.ok(cachedEstimate(ctx, { id: 'adv', gearIds: plan.gearIds, ringIds: plan.ringIds }, i));
});

test('the chosen enemy is worked out first, then the rest from left to right', async () => {
  const { ctx, sword } = setup();
  const order = [];
  const selected = Math.floor(n(ctx) / 2); // neither the first nor (with 3 or more enemies) the last
  assert.ok(selected > 0, 'the roster has at least two enemies, so the chosen one is not already first');
  const scope = scopeOf([sword], [], { selected });
  scheduleEstimates(ctx, scope);
  // watch the cache fill
  const seen = new Set();
  const poll = setInterval(() => {
    for (let i = 0; i < n(ctx); i++) if (!seen.has(i) && cachedEstimate(ctx, scope, i)) { seen.add(i); order.push(i); }
  }, 0);
  await whenEstimatesDone(ctx);
  clearInterval(poll);
  for (let i = 0; i < n(ctx); i++) if (!seen.has(i)) order.push(i);
  assert.equal(order[0], selected, 'the selected enemy comes first');
  assert.deepEqual(order.slice(1), Array.from({ length: n(ctx) }, (_, i) => i).filter((i) => i !== selected), 'the rest from left to right');
});

test('a changed selection waits out the debounce, cancels the old run and works out the new one', async () => {
  const { ctx, sword, chest } = setup();
  const first = scopeOf([sword]);
  scheduleEstimates(ctx, first);
  const oldRun = ctx.ui.est_run;
  assert.ok(oldRun);
  // the player ticks another item at once: a different selection
  const second = scopeOf([sword, chest]);
  scheduleEstimates(ctx, second);
  assert.equal(oldRun.cancelled, true, 'the run for the old gear is stopped');
  assert.equal(ctx.ui.est_run, null);
  assert.ok(ctx.ui.est_timer, 'the new one starts after the debounce');
  assert.equal(estimatesPending(ctx), true);
  assert.equal(estimateStatus(ctx), 'Estimating…');
  await whenEstimatesDone(ctx);
  assert.equal(estimatesPending(ctx), false);
  for (let i = 0; i < n(ctx); i++) {
    assert.ok(cachedEstimate(ctx, second, i), `new selection, enemy ${i}`);
    assert.equal(cachedEstimate(ctx, first, i), null, 'the cancelled run left nothing behind (stopped before its first enemy was done)');
  }
  assert.ok(Object.keys(ctx.ui.est_cache).length === n(ctx));
});

test('several quick changes cause one run: only the last selection is worked out', async () => {
  const { ctx, sword, chest } = setup();
  const a = scopeOf([sword]);
  const b = scopeOf([chest]);
  const c = scopeOf([sword, chest]);
  scheduleEstimates(ctx, a, { immediate: false });
  scheduleEstimates(ctx, b, { immediate: false });
  scheduleEstimates(ctx, c, { immediate: false });
  assert.equal(ctx.ui.est_run, null, 'still waiting');
  await whenEstimatesDone(ctx);
  assert.equal(Object.keys(ctx.ui.est_cache).length, n(ctx), 'results for one selection only');
  assert.ok(cachedEstimate(ctx, c, 0));
  assert.equal(cachedEstimate(ctx, a, 0), null);
  assert.equal(cachedEstimate(ctx, b, 0), null);
});

test('going back to a selection that is already cached stops the run of the one just left (no stale status, no extra redraw)', async () => {
  const { ctx, sword, chest } = setup();
  const a = scopeOf([sword, chest]);
  const b = scopeOf([sword]);
  scheduleEstimates(ctx, a);
  await whenEstimatesDone(ctx);
  scheduleEstimates(ctx, b); // a change: waits out the debounce, then B's run starts
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 20));
  const bRun = ctx.ui.est_run;
  assert.ok(bRun && !bRun.cancelled, 'B is being worked out');
  scheduleEstimates(ctx, a); // back to A, which is cached: nothing to work out
  assert.equal(bRun.cancelled, true, 'the run for B is stopped');
  assert.equal(ctx.ui.est_run, null);
  assert.equal(estimatesPending(ctx), false);
  assert.equal(estimateStatus(ctx), null, 'the status does not say Estimating over finished numbers');
  const before = ctx.rerenders;
  await whenEstimatesDone(ctx);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(ctx.rerenders, before, 'a stopped run does not redraw the screen when it ends');
  for (let i = 0; i < n(ctx); i++) assert.ok(cachedEstimate(ctx, a, i), `A, enemy ${i}`);
});

test('a run that outlives its screen fills the cache but does not redraw whatever tab is open; coming back shows the results', async () => {
  const { ctx, sword, chest } = setup();
  const scope = scopeOf([sword, chest], [], { selected: 1 });
  scheduleEstimates(ctx, scope);
  assert.equal(ctx.ui.est_screen, 'plan', 'the screen marks itself as the one being drawn');
  ctx.ui.est_screen = null; // main.js clears the mark at the start of every render; this render was another tab
  await whenEstimatesDone(ctx);
  assert.equal(ctx.rerenders, 0, 'neither the chosen enemy\'s finish nor the end of the run rebuilt the other tab');
  for (let i = 0; i < n(ctx); i++) assert.ok(cachedEstimate(ctx, scope, i), `enemy ${i}`);
  assert.equal(estimatesPending(ctx), false);
  // back on the estimating screen: it renders from the cache and starts nothing
  scheduleEstimates(ctx, scope);
  assert.equal(ctx.ui.est_screen, 'plan');
  assert.equal(estimatesPending(ctx), false);
  // a new game forgets the mark with everything else
  clearEstimates(ctx);
  assert.equal(ctx.ui.est_screen, null);
});

test('cancelEstimates stops a pending start and a run in progress; nothing more is cached', async () => {
  const { ctx, sword } = setup();
  scheduleEstimates(ctx, scopeOf([sword]));
  const run = ctx.ui.est_run;
  cancelEstimates(ctx);
  assert.equal(run.cancelled, true);
  assert.equal(estimatesPending(ctx), false);
  await run.done;
  assert.equal(Object.keys(ctx.ui.est_cache).length, 0, 'a cancelled run leaves no result');
  // a pending (debounced) start is dropped too
  const other = scopeOf([sword], [], { selected: 1 });
  ctx.ui.est_cache = ctx.ui.est_cache || {};
  scheduleEstimates(ctx, other, { immediate: false });
  assert.ok(ctx.ui.est_timer);
  cancelEstimates(ctx);
  assert.equal(ctx.ui.est_timer, null);
  await new Promise((r) => setTimeout(r, DEBOUNCE_MS + 50));
  assert.equal(Object.keys(ctx.ui.est_cache).length, 0, 'the timer never fired');
});

test('a new game or a new roster starts with an empty cache', async () => {
  const { s, ctx, sword } = setup();
  scheduleEstimates(ctx, scopeOf([sword]));
  await whenEstimatesDone(ctx);
  assert.ok(Object.keys(ctx.ui.est_cache).length > 0);
  // a new roster (tomorrow's: the day moves on)
  s.roster = { ...s.roster, day: s.roster.day + 1 };
  scheduleEstimates(ctx, scopeOf([sword]));
  const keys = Object.keys(ctx.ui.est_cache);
  assert.equal(keys.length, 0, 'nothing from the old roster is kept');
  assert.equal(estimatesPending(ctx), true, 'and the new one is being worked out');
  await whenEstimatesDone(ctx);
  assert.ok(Object.keys(ctx.ui.est_cache).every((k) => k.includes(`|${s.roster.day}|`)));
  // clearEstimates (what the New game button calls)
  clearEstimates(ctx);
  assert.deepEqual(ctx.ui.est_cache, {});
  assert.equal(estimatesPending(ctx), false);
});

test('ctx.ui.estimates === "off" switches the whole thing off', async () => {
  const { ctx, sword } = setup();
  ctx.ui.estimates = 'off';
  scheduleEstimates(ctx, scopeOf([sword]), { immediate: true });
  assert.equal(estimatesPending(ctx), false);
  assert.equal(ctx.ui.est_cache, undefined);
  assert.equal(cachedEstimate(ctx, scopeOf([sword]), 0), null);
});

test('intel that shows more of an enemy makes its estimate stale: it is worked out again, the others stay', async () => {
  const { s, ctx, sword } = setup(11);
  const scope = scopeOf([sword]);
  scheduleEstimates(ctx, scope);
  await whenEstimatesDone(ctx);
  const before = Object.fromEntries(Array.from({ length: n(ctx) }, (_, i) => [i, estimateKey(s, scope, i)]));
  s.intel.spent.enemySight = 3; // a lot more attributes visible
  const changed = [];
  for (let i = 0; i < n(ctx); i++) if (estimateKey(s, scope, i) !== before[i]) changed.push(i);
  assert.ok(changed.length > 0, 'some enemy shows more now');
  for (const i of changed) assert.equal(cachedEstimate(ctx, scope, i), null, `enemy ${i} needs a new estimate`);
  scheduleEstimates(ctx, scope, { immediate: true });
  const run = ctx.ui.est_run;
  assert.equal(run.total, changed.length, 'only the enemies that changed are worked out again');
  await whenEstimatesDone(ctx);
  for (let i = 0; i < n(ctx); i++) assert.ok(cachedEstimate(ctx, scope, i));
});

test('estimateCell: the % and its ±, "…" while pending, "—" when it is not worked out', () => {
  const res = { winPct: 84.4, wins: 21, fights: 25, se: 3 };
  const inCell = (node) => {
    const td = document.createElement('td');
    td.append(node);
    return td;
  };
  const done = inCell(estimateCell(res));
  assert.match(textOf(done), /^84%± \d+$/);
  assert.match(tipsOf(done), /84% ± \d+ from 25 test fights \(could be \d+-\d+%; hidden attributes add more\)\./);
  assert.equal(textOf(inCell(estimateCell(null, true))), '…');
  assert.equal(textOf(inCell(estimateCell(null, false))), '—');
  assert.match(tipsOf(inCell(estimateCell(null, true))), /Working out/);
});
