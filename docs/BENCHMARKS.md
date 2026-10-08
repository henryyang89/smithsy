# Smithsy — Difficulty benchmarks

How tough is each version of the game, compared with the others? Not by comparing win-rate tables
(those change with every rebalance), but by asking one question that means the same in every version:

> **If the same careful player plays 100 fixed games, how many are still alive after 5, 10, 15, ... days?**

That is the **survival curve**. Only the game changes between versions; the player and the seeds do
not, so a higher curve means an easier version and a lower one a harder version, and the *shape* shows
where the difficulty sits (early deaths, mid-game wall, or the late-game cliff).

## What is measured

- **The player** is the careful bot of `tools/balance.mjs` (gathers, refines, cuts, smiths, wears rings,
  repairs at night, plans every fight). It drives the real game API and only sees what a player sees.
  It fights an enemy only if its win-chance estimate is at least 90%, otherwise the best one.
- **The seeds** are fixed: `mixSeed(31337, 0..99)` (100 runs by default; the same list in every version,
  so every version gets the same maps and the same start).
- **The estimate it plans with** is, by default, **the in-game "Estimate all" button** with the version's
  own numbers: 1.1 used 40 guesses x 30 test fights, 1.2 starts at 10 x 10 (plus the Battle simulation
  intel track and Foresight rings if the bot has them; it only spends intel on enemy scouting, so in
  practice 10 x 10 plus Foresight rings). `--estimator bot` uses the bot's own, larger, version-independent
  estimate instead (screen all 7 enemies, re-check the top 3), which isolates the game rules from the
  estimate size.
- **"Alive at day d"** = the run survived the fight of day d (day 1 has no fight). A run that is still alive
  on day 100 counts as alive at day 100 (almost none are: enemies keep growing and the map runs out).
- **Median life** = the day the middle run died (the bot never retires). **Mean score** = the score at death
  (10 / 25 / 50 per normal / elite / champion win); it is secondary, because a version can change how much a
  win is worth without changing how hard it is.

## Results

Alive % at the end of day (100 seeds, each version with its own in-game estimate):

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 2026-10-08 | 100 | 90 | 85 | 85 | 79 | 76 | 73 | 67 | 46 | 5 | 0 | 0 | 0 | 48.5 | 1110 | In-game estimate 40 x 30 (1.1's own). 9 runs die on day 2 (the unarmed adventurer did 4 damage). |
| **1.2** | 2026-10-08 | 100 | 97 | 94 | 85 | 81 | 77 | 74 | 70 | 46 | 13 | 1 | 0 | 0 | 50.0 | 1228 | In-game estimate 10 x 10 (1.2's own), final config. No day-2 deaths, 6 deaths on days 3-9. |

The same two versions on 200 seeds (the first 100 are the seeds above), which halves the noise:

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 2026-10-08 | 200 | 92 | 88 | 87 | 82 | 78 | 75 | 70 | 50 | 10 | 0 | 0 | 0 | 50.0 | 1158 | In-game estimate 40 x 30. Deaths: day 2 14, days 3-9 10. |
| **1.2** | 2026-10-08 | 200 | 97 | 93 | 87 | 83 | 80 | 75 | 69 | 51 | 10 | 1 | 0 | 0 | 51.0 | 1246 | In-game estimate 10 x 10. Deaths: day 2 0, days 3-9 14. |

Reference runs (100 seeds) that separate the game rules from the size of the estimate:

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 2026-10-07 | 100 | 91 | 91 | 87 | 83 | 81 | 79 | 75 | 60 | 12 | 0 | 0 | 0 | 53.0 | 1172 | `--estimator bot`: the bot's own larger estimate, the same in every version |
| 1.2 | 2026-10-08 | 100 | 99 | 94 | 90 | 88 | 83 | 78 | 76 | 58 | 12 | 1 | 0 | 0 | 52.0 | 1231 | `--estimator bot`. Easier than 1.1 up to day 25 (no day-2 deaths, +5-8 points), the same from day 30. |
| 1.2 | 2026-10-08 | 100 | 98 | 95 | 92 | 90 | 86 | 83 | 79 | 58 | 13 | 0 | 0 | 0 | 52.0 | 1243 | A 20 x 20 in-game estimate (`--set sim.samples=20 --set sim.evalFights=20 --set sim.fightsPerLoadout=20`: what one Battle simulation point gives). Nearly all of the way to the bot's estimate: +9 to +12 points alive on days 20-50 over 10 x 10, median +2. |
| 1.1 | 2026-10-07 | 100 | 90 | 84 | 81 | 79 | 73 | 66 | 59 | 33 | 6 | 0 | 0 | 0 | 45.0 | 1098 | 1.1's rules with the estimate cut to 10 x 10 (`--set sim.samples=10 --set sim.evalFights=10 --set sim.fightsPerLoadout=10`): a noisier estimate alone costs about 3.5 days of median life. |

Sensitivity (200 seeds, 1.2, in-game 10 x 10): `--set enemies.growthPerDay.hpDamage=3` (instead of 3.5)

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.2 | 2026-10-08 | 200 | 95 | 92 | 90 | 88 | 83 | 76 | 69 | 59 | 34 | 4 | 0 | 0 | 56.0 | 1487 | enemy HP/damage growth 3 %/day: the early and mid game stay the same within noise, day 50 +8, day 60 +24, median +5 days |

### Reading the table

- **Noise.** One alive % from 100 runs has a standard error of up to 5 points (3.5 with 200 runs), so
  treat differences under about **10 points** as noise and compare the shape of the curve and the median
  life. Runs are chaotic: a tiny change can move one column by 5-8 points either way.
- **1.2 vs 1.1 (headline): the same difficulty.** From day 15 on the curves agree within noise at every
  column, on 100 seeds (d15 85 vs 85, d30 74 vs 73, d40 70 vs 67, d50 46 vs 46, d60 13 vs 5; median life 50.0
  vs 48.5) and on 200 (d15 87 vs 87, d30 75 vs 75, d40 69 vs 70, d50 51 vs 50, d60 10 vs 10; median 51 vs 50;
  mean score 1,246 vs 1,158, +8%). The 1.2 rebalance was meant to keep the difficulty and it does. With the
  bot's own large estimate for both versions the picture is the same (1.2: d30 78, d50 58, median 52; 1.1: 79,
  60, 53).
- **The shape moved at the start only.** The day-2 deaths of 1.1 (the unarmed adventurer did 4 damage: 14 of
  200 runs) are gone, so 1.2 is 5-9 points higher through day 10; deaths on days 3-19 rise a little to make
  up for it. Deaths by day range, 200 seeds:

| deaths on day | 2 | 3-9 | 10-19 | 20-29 | 30-39 | 40-49 | 50-59 | 60-79 |
|---|---|---|---|---|---|---|---|---|
| 1.1 | 14 | 10 | 13 | 12 | 10 | 34 | 82 | 25 |
| 1.2 | 0 | 14 | 20 | 12 | 16 | 31 | 80 | 27 |

  Before day 40 that is 62 deaths against 59. The new swords let the bot take elites and champions sooner,
  and its 10 x 10 estimate cannot tell a 97% fight from a 100% one.
- **Late game.** Both versions end the same way: about half of the runs reach day 50, one in ten day 60,
  almost none day 65. The wall is the finite map (no regrowth: mythril and coal run low around day 40-50), enemy
  growth, and in 1.2 the mythril upkeep of 10% wear (the bot's immortal runs end with 2.6 of 5 slots in
  mythril instead of 3.3). Sensitivity: the growth sensitivity row above (3 instead of 3.5 %/day) leaves days
  5-40 the same and lifts d50 to 59, d60 to 34 and the median to 56.
- **What the estimate costs.** With the in-game 10 x 10 estimate 1.2 loses 12 points at day 50 and 2 days of
  median life against the bot's large estimate (46% vs 58% alive, 50.0 vs 52.0); in 1.1's rules, going from
  40 x 30 to 10 x 10 costs 13 points at day 50 and 3.5 days (46% to 33%, 48.5 to 45.0). A 20 x 20 estimate
  (one Battle simulation point) buys back almost all of it in 1.2. That is the intended risk of a small
  estimate. The next section says why the benchmark reacts to the estimate's noise more than the average
  accuracy would suggest.

## Is 10 x 10 too low?

The in-game estimate runs **10 guesses x 10 test fights per enemy** (1.1: 40 x 30). Is that too few to plan
with, and what do one Battle simulation intel point (+10: 20 x 20) or a Foresight ring (+2 to +6) change? Run
`node tools/balance.mjs --section estimator` (about 25 s). Setup: a steel C set against random elites, on the
three days where such an elite is beaten about 55% / 75% / 90% of the time on average (days 27 / 23 / 19);
200 enemies per target; for each enemy its **true** win chance (4,000 fights against its real attributes) and
an estimate made when only a share of its attributes is visible ("sight": enemy scouting starts at 10%, about
50% after five intel points on it, i.e. around day 25, 100% = the fight itself). Every estimate is made three
times with different random draws. *Repeat sd* = how much the same estimate wobbles between draws; *error
sd* = the typical miss against the true chance (adds the guesswork about hidden attributes); *>10 pts* = share
of estimates that miss by more than 10 points.

**Error at 10 x 10 by scouting level** (error sd in points, then the share missing by more than 10 points):

| True win chance (target) | sight 10% (start) | sight 50% | sight 100% (all known) |
|---|---|---|---|
| ~55% | 15.0 (52%) | 11.3 (36%) | 4.6 (4%) |
| ~75% | 12.1 (37%) | 9.5 (32%) | 4.0 (1%) |
| ~90% | 6.6 (11%) | 5.1 (7%) | 2.8 (0%) |

**What a bigger estimate buys** (true chance ~55%; repeat sd / error sd):

| Size | How you get it | sight 10% | sight 50% | sight 100% |
|---|---|---|---|---|
| 10 x 10 | the start | 6.8 / 15.0 | 5.6 / 11.3 | 4.8 / 4.6 |
| 13 x 13 | one Foresight ring C | 5.4 / 14.4 | 4.4 / 11.0 | 3.6 / 3.8 |
| 16 x 16 | one Foresight ring S | 4.8 / 14.1 | 3.7 / 10.6 | 2.9 / 3.0 |
| 20 x 20 | 1 Battle simulation point | 4.2 / 14.2 | 3.0 / 10.4 | 2.4 / 2.5 |
| 29 x 29 | 2 points | 3.2 / 14.0 | 2.3 / 10.2 | 1.7 / 1.7 |
| 40 x 30 | what 1.1 used | 2.7 / 13.9 | 2.0 / 10.0 | 1.4 / 1.5 |

Averaged over the three targets at 10% sight (repeat sd / error sd): 10 x 10 5.1 / 11.2, 13 x 13 4.2 / 10.9,
16 x 16 3.6 / 10.8, 20 x 20 3.1 / 10.7, 29 x 29 2.4 / 10.5, 40 x 30 2.0 / 10.4. Risk at 90%: of the estimates
of 90 or more at 10% sight, the share whose true chance is under 80% is 6% at 10 x 10 and 7-8% at every other
size, so a bigger simulation does not make "safe" estimates safer either.

**Findings**

1. **At the starting scouting the hidden attributes dominate the error, not the simulation size.** The typical
   miss is 15.0 points at 10 x 10 and 13.9 at 1.1's 40 x 30: 10 x 10 costs about one point of miss, and only
   about a fifth of the miss's variance (6.8² of 15.0²) is simulation noise. The rest is that the enemy
   fought is one particular completion of its 11 hidden attributes, which no number of guesses can know.
2. **Scouting is what shrinks the error.** At 10 x 10, 50% sight cuts the miss from 15.0 to 11.3 (about 0.9
   points per +10% of sight, i.e. about one point per intel point spent on enemy scouting at the start) and all
   attributes known to 4.6. Once the enemy is fully known, size matters again: 4.6 (10 x 10) to 2.5 (one
   point) to 1.5 (40 x 30).
3. **A Battle simulation point or a Foresight ring mainly steadies the estimate.** One point (20 x 20) cuts the
   press-to-press wobble from 6.8 to 4.2 (-38%) but the miss only from 15.0 to 14.2; a C / S Foresight ring
   (13 x 13 / 16 x 16) cuts the wobble to 5.4 / 4.8 and the miss to 14.4 / 14.1. A second point (29 x 29)
   takes only 0.2 more points off the miss. The miss itself moves about as much per Battle simulation point (-0.8) as per
   scouting point (about -0.9), but the point on scouting also shows the roster, the point on simulation shows
   a steadier number.
4. **Even so, steadier matters for the benchmark.** The 20 x 20 what-if lifts 1.2's survival (day 30: 74% to
   83%, day 50: 46% to 58%, median 50 to 52 days) far more than the 0.8 points of average miss suggest. The
   likely reason (not isolated by an experiment): a player, and the bot, picks the enemy with the highest
   estimate out of seven, which favours whichever enemy got lucky draws; a smaller wobble cuts that selection
   bias.
5. **The displayed ± margin is not a 95% interval when attributes are hidden.** The game shows twice the
   standard error of the guesses, which tracks the wobble (about ±13 at 10 x 10, ±9 at 20 x 20, ±6 at 40 x 30
   for a steel C set against an elite with nothing scouted) and says "about 19 times in 20 the true chance is
   within it". Checked against the truth (200 enemies, true chance ~55%), the true chance lay inside the
   margin:

| Size | sight 10% | sight 50% | sight 100% |
|---|---|---|---|
| 10 x 10 | 56% | 69% | 93% |
| 20 x 20 | 44% | 46% | 94% |
| 40 x 30 | 30% | 33% | 90% |

   (63-75% / 64-77% / 89-94% at 10 x 10 for the 75% and 90% targets.) With every attribute known it is close to
   the advertised 95% (83-95%); with few known it is much lower, and bigger simulations look *worse* because
   their margins shrink while the guesswork stays. This was measured with a one-off script that reuses the
   estimator section's setup (it is not part of the tool). It is a UI wording/behaviour mismatch to decide
   on (HANDOFF, known concerns).

**Verdict.** 10 x 10 is not too low as a *design*: it is within about a point of 1.1's estimate in average miss
at the starting scouting, it is 12 times cheaper, and it leaves a real role for the Battle simulation track
and Foresight rings (steadier numbers, better picks). It *is* noisy, and the noise costs survival (about 2-3.5
days of median life; section above). The levers: enemy scouting shrinks the miss, a bigger estimate (the
intel track, the ring, or `CONFIG.sim`) shrinks the wobble and the pick of the best of seven. If the estimate
should be less of a gamble the options are a larger `CONFIG.sim` (20 x 20 recovers most of the survival),
more starting scouting, or widening the displayed margin by the number of hidden attributes.

## How to run

```
node tools/balance.mjs --section benchmark --jobs 3
```

- `--jobs N` runs the seeds in N parallel processes with identical results (1.2: 100 seeds take about 2
  minutes with 3 jobs on 4 cores, 200 seeds about 4 minutes, a 20 x 20 estimate about 4 minutes with 4 jobs;
  1.1 takes about 10 minutes for 100 seeds because its 40 x 30 estimate is 12 times bigger).
- `--seeds N` (default 100; the seed list is a prefix, so 200 runs include the first 100), `--days N`
  (default 100), `--estimator game|bot` (default `game`), `--minwin P` (default 90).
- `--set path=value` runs a what-if on the same seeds, e.g. `--set enemies.growthPerDay.hpDamage=3.2`.
- `--quick` is a smoke test (6 seeds, 40 days, about 20 seconds).
- The last lines of the output are a one-line `BENCHMARK | ...` summary and a ready-made markdown row for
  the table above; paste the row and add your notes. The report also prints the survival curve every 5
  days, the life quantiles (p10 ... p90), deaths by day range, and wins per run.

### Adding a new version

1. Finish the version and run `npm test`.
2. `node tools/balance.mjs --section benchmark --jobs 3` (on the release commit) and paste the row.
3. If you also want to compare with an older version, extract the old release and run the *same* tool
   there (the tool adapts to older versions: no `simCounts` means it uses `CONFIG.sim`):

```
mkdir -p /tmp/smithsy-old && git archive <old-commit> | tar -x -C /tmp/smithsy-old
cp tools/balance.mjs /tmp/smithsy-old/tools/balance.mjs
(cd /tmp/smithsy-old && node tools/balance.mjs --section benchmark --jobs 3)
```

   (1.1 is commit `5e2423c`.) Keep the seeds, the estimator and `--minwin` the same, and add the version's
   own row only after checking that the previous rows still reproduce.
4. Note anything that changes the *player* (a smarter bot, a new action it uses) in the notes column:
   a change to the bot invalidates comparisons with older rows, so rerun the older versions with the new
   bot before comparing.

## Related checks

- `node tools/balance.mjs --section estimator`: how accurate the win-chance estimate is at 10 x 10, with
  Foresight rings or Battle simulation intel points, and at 1.1's 40 x 30 (the tables in "Is 10 x 10 too
  low?" above).
- `node tools/balance.mjs --section specials`: how dangerous each enemy special is and how much the
  matching defence and the adventurer's own gems are worth.
- `node tools/balance.mjs --section power`, `--section economy`, `--section bot`: the older reports.
