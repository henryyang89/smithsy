# Smithsy — Difficulty benchmarks

How tough is each version of the game, compared with the others? Not by comparing win-rate tables
(those change with every rebalance), but by asking one question that means the same in every version:

> **If the same player plays 100 fixed games, how many are still alive after 2, 3, 4, 5, 10, 15, ... days?**

That is the **survival curve**. Only the game changes between versions; the players and the seeds do
not, so a higher curve means an easier version and a lower one a harder version, and the *shape* shows
where the difficulty sits (early deaths, mid-game wall, or the late-game cliff).

**Which table to use.** 2.0 rebuilt the world, so its curves are a new baseline: compare 2.x versions only with each
other, and a persona only with the same persona. The 1.x tables are kept at the end as history.

## What is measured (2.0 and later)

- **The players** are three **personas** of the one bot in `tools/balance.mjs` (R46). They share the whole engine
  (gathering, refining, cutting, smithing, repairs by day, rings) and differ in who they fight, what they pack, how they
  spend intel and how much they work. Their settings are `PERSONAS` in the tool (tool settings, not game numbers); in
  short:
  - **Careful planner** (`careful`): reads the automatic win estimate and takes the fight with the best expected value
    (estimate x (score + 1,000)) among the enemies it is at least 90% sure of, else the surest one (the game needs a fight
    every day; the bot section counts these as "no-safe-option fights"). Rests worn gear so it can be repaired, packs the best
    items per gear type, wears the ring set with the most win value, spends intel on Enemy scouting (to 40%), Battle
    simulation (+3), Banner scouting (50%) and Ore sight (30), then on the track with the fewest points. Up to 5 trips a day.
  - **Champion hunter** (`champion`): goes for score. Takes a champion it is at least 70% sure of, else an elite at 80%+,
    else the best value among fights at 50%+ (estimate x (score + 150)). Rests only gear a champion fight could destroy (no wear threshold), weighs its
    sword 1.5 times as much when smithing, spends intel on Battle simulation, Enemy scouting and Ring type scouting first.
  - **Casual** (`casual`): never reads the estimate. Fights a normal enemy until it owns enough gear (gear types owned
    plus gear types owned in iron or better reaches 6), then an elite, never a champion; of those, the enemy that *looks*
    easiest (the fewest visible High attributes). Packs the game's default "best per type" pack, wears the best ring
    grades whatever the type, spreads intel over all tracks in turn, makes 2 trips a day and carries what the game's
    default carry gives.
- **The seeds** are fixed: `mixSeed(31337, 0..99)` (100 runs by default; the same list in every version and for every
  persona, so every persona gets the same maps and the same start). Newer versions give different maps for the same
  seed numbers than 1.x did.
- **The estimate they plan with** is, by default, **the game's own automatic estimate** with the version's numbers
  (2.0: 5 guesses x 5 test fights per enemy, plus the Battle simulation points and Foresight rings the bot has).
  `--estimator bot` uses the bot's own, larger estimate (independent of the game's) instead. The casual persona never reads it.
- **"Alive at day d"** = the run survived the fight of day d (day 1 has no fight). Days 2, 3 and 4 are columns from 2.0 on:
  the first fights are where a newcomer dies. A run that is still alive on the last day counts as alive.
- **Median life** = the day the middle run died (the bot never retires). **Mean score** = the score at death (10 / 25 / 50
  per normal / elite / champion win); it is secondary, because a version can change how much a win is worth without
  changing how hard it is. **Score/day** = the mean of score divided by the days survived. **Fights n/e/c** = the share of
  the fights taken that were normal / elite / champion. **Picked at** = the mean estimate of the fights taken.

## 2.0 and later (new world)

2.0 rebuilt the world (a 7x7 map with sight, repairs by day, new enemy numbers and banners, the automatic 5 x 5 estimate, new
skills), so its curves are a **new baseline**. The same seed numbers give different maps than in 1.x. Compare 2.x versions
only with each other, persona against the same persona.

Alive % at the end of day (100 seeds, each version with its own in-game estimate; one row per persona and version):

| version | date | persona | seeds | d2 | d3 | d4 | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | score/day | fights n/e/c % | picked at | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.0 | 2026-10-09 | Careful planner | 100 | 97 | 95 | 93 | 92 | 84 | 80 | 71 | 65 | 59 | 18 | 0 | 0 | 0 | 0 | 0 | 32.5 | 691 | 24.9 | 43/28/29 | 98% | estimator game 5x5 |
| 2.0 | 2026-10-09 | Careful planner | 200 | 96 | 93 | 89 | 88 | 80 | 72 | 65 | 60 | 54 | 19 | 1 | 0 | 0 | 0 | 0 | 31.5 | 651 | 24.4 | 44/26/30 | 98% | estimator game 5x5; the more robust T-D evidence (standard error 3.5 points at 50%) |
| 2.0 | 2026-10-09 | Champion hunter | 100 | 86 | 81 | 77 | 76 | 62 | 49 | 34 | 21 | 14 | 6 | 0 | 0 | 0 | 0 | 0 | 15.0 | 658 | 36.1 | 7/5/87 | 94% | estimator game 5x5 |
| 2.0 | 2026-10-09 | Casual | 100 | 99 | 98 | 98 | 98 | 90 | 83 | 66 | 47 | 23 | 0 | 0 | 0 | 0 | 0 | 0 | 25.0 | 506 | 21.5 | 10/90/0 | - | estimator no estimate |

Deaths by day (runs), per persona:

| version | persona | seeds | 2 | 3 | 4 | 5-9 | 10-19 | 20-29 | 30-39 | 40-49 | 50-59 | 60-79 | 80+ |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 2.0 | Careful planner | 100 | 3 | 2 | 2 | 9 | 12 | 11 | 38 | 23 | 0 | 0 | 0 |
| 2.0 | Careful planner | 200 | 8 | 6 | 8 | 15 | 33 | 17 | 69 | 40 | 4 | 0 | 0 |
| 2.0 | Champion hunter | 100 | 14 | 5 | 4 | 13 | 25 | 25 | 8 | 6 | 0 | 0 | 0 |
| 2.0 | Casual | 100 | 1 | 1 | 0 | 7 | 20 | 42 | 28 | 1 | 0 | 0 | 0 |

The rows are from the final 2.0 config (`node tools/balance.mjs --section benchmark --jobs 4` for the three personas at
100 seeds, and `--section benchmark --persona careful --seeds 200 --jobs 4` for the 200-seed row). Reading them: the
careful planner's median life is 31.5-32.5 days with 80-84% alive at day 10, 96-97% at day 2 and 89-93% at day 4 (T-D,
all inside the bands; the 200-seed row is the safer evidence, the 100-seed day-10 value sits near the top edge of its
band). The champion hunter lives about 15 days and scores 1.45 times the careful planner's score per day survived; the
casual player lives 25 days and is never asked to fight a champion. One persona row is a known miss: the careful planner
is only 5 points above the casual one at day 20 (target 10; docs/TUNING-2.0.md note 4). What the rows should show
(targets T-D and T-P in `docs/PLAN-2.0.md`, section 9; the tool prints a flag next to each):

- Careful planner: median life 30-40 days, alive at day 10 about 80% (75-85%), alive at day 2 at least 95% and at day 4 at
  least 85%.
- Casual: alive at day 4 at least 70%; the careful planner is at least 10 points above it at day 20 and at day 40; no
  champion fights.
- Champion hunter: score per day survived at least 1.2 times the careful planner's, median life at least 3 days below the
  careful planner's, and at least 40% champions among its fights on days 11-40.
- The whole benchmark (3 personas x 100 seeds) takes at most 15 minutes with `--jobs 4`.

## 1.x (old world, history only)

> **Not comparable with 2.0:** a different map, enemies, repairs and estimate. The tables below are kept unchanged to show
> how 1.0 - 1.2 compared with each other. They are one persona (the careful planner of 1.x, which repaired at night and
> pressed "Estimate all").

### What was measured

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


### Results

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

#### Reading the table

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


### Is 10 x 10 too low?

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
5. **The displayed ± margin is not a 95% interval; with attributes hidden it covers much less.** The game shows twice the
   standard error of the guesses, which tracks the wobble (about ±13 at 10 x 10, ±9 at 20 x 20, ±6 at 40 x 30
   for a steel C set against an elite with nothing scouted). The screen used to say "about 19 times in 20 the
   true chance is within it"; it now says the ± is how far the simulation alone could be off (about 9 times in
   10 when every attribute is known) and that attributes you can't see add more uncertainty. Checked against
   the truth (200 enemies, true chance ~55%), the true chance lay inside the margin:

| Size | sight 10% | sight 50% | sight 100% |
|---|---|---|---|
| 10 x 10 | 56% | 69% | 93% |
| 20 x 20 | 44% | 46% | 94% |
| 40 x 30 | 30% | 33% | 90% |

   (63-75% / 64-77% / 89-94% at 10 x 10 for the 75% and 90% targets.) With every attribute known it is about 9 times
   in 10 (90-94% here, 83-95% across seeds), not 19 in 20; with few known it is much lower, and bigger simulations look *worse* because
   their margins shrink while the guesswork stays. This was measured with a one-off script that reuses the
   estimator section's setup (it is not part of the tool). The wording was corrected in 1.2; the margin math is
   unchanged.

**Verdict.** 10 x 10 is not too low as a *design*: it is within about a point of 1.1's estimate in average miss
at the starting scouting, it is 12 times cheaper, and it leaves a real role for the Battle simulation track
and Foresight rings (steadier numbers, better picks). It *is* noisy, and the noise costs survival (about 2-3.5
days of median life; section above). The levers: enemy scouting shrinks the miss, a bigger estimate (the
intel track, the ring, or `CONFIG.sim`) shrinks the wobble and the pick of the best of seven. If the estimate
should be less of a gamble the options are a larger `CONFIG.sim` (20 x 20 recovers most of the survival),
more starting scouting, or widening the displayed margin by the number of hidden attributes.


## How to run

```
node tools/balance.mjs --section benchmark --jobs 4
```

- Runs every persona (`--persona careful|champion|casual|all`, default all) on the same 100 seeds and prints the survival
  table with days 2, 3, 4, 5, 10, ... 100, the deaths by day, the targets with flags, one `BENCHMARK | v2.0 | <persona> | ...`
  line and one markdown row per persona, and the wall time.
- `--jobs N` shards each persona's seeds over N parallel processes with identical results (about 2.5 seconds of
  CPU per run, so the whole benchmark takes a few minutes with 4 jobs on 4 cores; the tool prints its wall time).
- `--seeds N` (default 100; the seed list is a prefix, so 200 runs include the first 100), `--days N` (default 100),
  `--estimator game|bot` (default `game`), `--minwin P` / `--future F` (override the persona's own values).
- `--intel persona|only:<track>|none` changes how the bot spends intel; `--set path=value` runs a what-if on the same seeds,
  e.g. `--set enemies.growthPerDay.hpDamage=4`.
- `--quick` is a smoke test (6 seeds, 40 days, about 20 seconds for all personas).
- The intel check (`--section intel`) runs the careful planner on the same seeds in eight modes; see below.

### Adding a new version

1. Finish the version and run `npm test`.
2. `node tools/balance.mjs --section benchmark --jobs 4` (on the release commit) and paste the three markdown rows into the
   2.0 table, with notes.
3. If you also want to compare with an older version, extract the old release and run **that tree's own**
   `tools/balance.mjs` there. The 2.0 tool imports 2.0 functions (`distanceRow`, `sightValue`, `simCounts`, ...) and only
   runs on 2.0 trees; a version before 2.0 has no personas, so its numbers come from the 1.x tool that shipped with it:

```
mkdir -p /tmp/smithsy-old && git archive <old-commit> | tar -x -C /tmp/smithsy-old
(cd /tmp/smithsy-old && node tools/balance.mjs --section benchmark --jobs 3)
```

   Keep the seeds, the estimator and `--minwin` the same, and add the version's own row only after checking that the
   previous rows still reproduce.
4. Note anything that changes the *player* (a smarter bot, a new action it uses, a changed persona) in the notes column:
   a change to the bot invalidates comparisons with older rows, so rerun the older versions with the new
   bot before comparing.

## Related checks

- `node tools/balance.mjs --section economy | power | day2 | specials | estimator`: the instruments for pacing (T-E), the power
  curve and its anchors (T-MID), the first fight without equipment (T-R7, T-GEAR), the gem balance (T-R33) and the automatic
  estimate (T-A2). Each ends with a one-line SUMMARY that carries the target flags.
- `node tools/balance.mjs --section bot --persona careful --seeds 40`: progression, time split, repairs, skills at day 30 and
  gem supply (T-B1 .. T-B5, T-GEAR).
- `node tools/balance.mjs --section intel --seeds 100 --days 60 --jobs 4`: does one intel track dominate? (T-R42). The careful
  planner plays the same seeds with each track first, with its own list and with no intel; the INTEL line gives the best
  single track, the spread between tracks, and how the persona's own list compares.
