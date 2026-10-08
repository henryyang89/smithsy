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
| **1.2** | 2026-10-08 | 100 | 96 | 85 | 82 | 79 | 78 | 75 | 70 | 45 | 7 | 0 | 0 | 0 | 49.0 | 1098 | In-game estimate 10 x 10 (1.2's own). No day-2 deaths, 14 deaths on days 3-9. |

The same two versions on 200 seeds (the first 100 are the seeds above), which halves the noise:

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 2026-10-08 | 200 | 92 | 88 | 87 | 82 | 78 | 75 | 70 | 50 | 10 | 0 | 0 | 0 | 50.0 | 1158 | In-game estimate 40 x 30. Deaths: day 2 14, days 3-9 10. |
| **1.2** | 2026-10-08 | 200 | 94 | 86 | 82 | 79 | 75 | 73 | 67 | 46 | 9 | 0 | 0 | 0 | 49.0 | 1090 | In-game estimate 10 x 10. Deaths: day 2 1, days 3-9 27. |

Reference runs (100 seeds) that separate the game rules from the size of the estimate:

| version | date | seeds | d5 | d10 | d15 | d20 | d25 | d30 | d40 | d50 | d60 | d70 | d80 | d100 | median life | mean score | notes |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1.1 | 2026-10-07 | 100 | 91 | 91 | 87 | 83 | 81 | 79 | 75 | 60 | 12 | 0 | 0 | 0 | 53.0 | 1172 | `--estimator bot`: the bot's own larger estimate, the same in every version |
| 1.2 | 2026-10-08 | 100 | 96 | 95 | 93 | 90 | 87 | 84 | 80 | 47 | 13 | 0 | 0 | 0 | 50.0 | 1116 | `--estimator bot`. Easier than 1.1 through day 45, then the 10% durability loss (mythril upkeep) bites. |
| 1.1 | 2026-10-07 | 100 | 90 | 84 | 81 | 79 | 73 | 66 | 59 | 33 | 6 | 0 | 0 | 0 | 45.0 | 1098 | 1.1's rules with the estimate cut to 10 x 10 (`--set sim.samples=10 --set sim.evalFights=10 --set sim.fightsPerLoadout=10`): a noisier estimate alone costs about 3.5 days of median life. |

### Reading the table

- **Noise.** One alive % from 100 runs has a standard error of up to 5 points (3.5 with 200 runs), so
  treat differences under about **10 points** as noise and compare the shape of the curve and the median
  life. Runs are chaotic: a tiny change can move one column by 5-8 points either way.
- **1.2 vs 1.1 (headline).** The curves agree within noise at every column on 100 seeds (d10 85 vs 85,
  d30 75 vs 73, d40 70 vs 67, d50 45 vs 46, d60 7 vs 5; median life 49.0 vs 48.5). On 200 seeds 1.2 sits 2-5
  points below 1.1 between day 15 and day 50 (median 49 vs 50), about one standard error: equal, with a
  hint of harder. The 1.2 rebalance was meant to keep the difficulty and it does.
- **The shape moved a little.** Deaths shifted from day 2 (14 of 200 in 1.1: the unarmed adventurer did 4
  damage) to days 3-9 (27 of 200 in 1.2 vs 10). The new gear is stronger early, so the bot takes elites and
  champions sooner, and its 10 x 10 estimate cannot tell a 97% fight from a 100% one. From day 15 to day 50
  both versions lose the same number of runs (36 vs 37 points on 200 seeds).
- **Late game.** Both versions end the same way: about half of the runs reach day 50, one in ten day 60,
  almost none day 65. The wall is the finite map (no regrowth: mythril and coal run out around day 45-50) plus enemy
  growth. Sensitivity (200 seeds, 1.2): `--set enemies.growthPerDay.hpDamage=3` (instead of 3.5) leaves
  days 5-40 about the same (within noise) but lifts d50 to 55, d60 to 23 and the median to 53.

## How to run

```
node tools/balance.mjs --section benchmark --jobs 3
```

- `--jobs N` runs the seeds in N parallel processes with identical results (1.2: about 2.5 minutes with
  3 jobs on 4 cores; 1.1 takes about 10 minutes because its 40 x 30 estimate is 12 times bigger).
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
  Foresight rings or Battle simulation intel points, and at 1.1's 40 x 30.
- `node tools/balance.mjs --section specials`: how dangerous each enemy special is and how much the
  matching defence and the adventurer's own gems are worth.
- `node tools/balance.mjs --section power`, `--section economy`, `--section bot`: the older reports.
