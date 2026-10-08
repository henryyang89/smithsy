# Smithsy — Handoff

Everything needed to pick this project up in a fresh session.

## What it is
Browser game: you mine ore/gems on a 5x5 world map of 8x8 fields, refine and smith gear, and each
night plan your adventurer's next fight (1 enemy from a roster of 7). A loss is game over; score is
endless. Plain HTML + ES modules, no build step, hosted on GitHub Pages, **deployed from `main`**
(<https://henryyang89.github.io/smithsy/>, folder `/ (root)`; see README). Save in localStorage.

**Version:** this branch is **1.2** (`js/version.js`, shown in the top bar and Help). The live game on
`main` is 1.1 (pull request #2) until 1.2 is merged; `release/v1.0` and `release/v1.1` exist on GitHub. What
changed per version and how to roll back: `CHANGELOG.md`. State when this was written: 1.2 is on the work
branch (commits e446ef7 features, cd61042 balance); the review fixes and the docs refresh are uncommitted
changes on top (`git status`).

## Where things are
| Path | What |
|---|---|
| `js/config.js` | **Every tunable number.** Edit here to rebalance. |
| `js/version.js` | `VERSION` shown in the top bar and Help ('1.2'). Bump it for every release (see "Release process"). |
| `CHANGELOG.md` | What changed in each version (player terms) and the rollback steps. Read it, add to it each release. |
| `index.html` | Page shell + a plain-script start-up diagnostics box (shows captured errors and the browser if the game has not started a few seconds after load). |
| `docs/BALANCE.md` | Explains every number, formula, worked examples, tuning notes, current balance results (1.2). |
| `docs/BENCHMARKS.md` | **Difficulty of each version** as a survival curve: the share of 100 fixed simulated games (careful bot) still alive at day 5, 10, ... 100, per version, plus "Is 10 x 10 too low?" (accuracy of the win estimate) and how to add a version's row. Read before changing balance; re-run `--section benchmark` after. |
| `docs/SPEC.md` | Requirements + all design decisions agreed with the user. |
| `js/core/` | DOM-free game logic (works in Node). `game.js` = state, day flow, battle resolution (wear via `wearLoss`, Gear care XP), save (`SAVE_KEY` `smithsy-save-v3`, `SAVE_VERSION` 3, `LEGACY_SAVE_KEYS` `smithsy-save-v2` / `smithsy-save-v1`, `migrateV1` → v2, `migrateV2` → v3, `addMissingKeys`). |
| `js/core/map.js` | World map, fields (`generateField`: debris thickness, 1 boulder), travel (with an optional carry selection), search (depth mechanic, 35% ± 5 per cell; clears debris first via `debrisClearMult`; finds go to the field's `pile`; **fresh cells**: `cellFresh`, `freshCellCount`, `searchMinutes(state, cfg, cx, cy)` = base + `field.freshCellMin` per fresh cell, cells get `touched` when a search works on them), carrying (`defaultCarry`, `setCarry`, `moveToPile`, `takeFromPile`, `projectedLoad`, `fitsWithReturn`), `fieldProgress` (boulders excluded), nightly regrowth (off). |
| `js/core/processing.js` | Refining/cutting, grade distributions (bars: fail reduction + upgrade luck; gems: `blendCutTable` novice → master, then Gem luck), `GRADE_ORDER` F, D, C, B, A, S (low → high). |
| `js/core/gear.js` | Gear stats, crafting, wear (`wearLoss`, `wornDurability`: durability kept to one decimal, shared by the fight and the UI), repair (`isNight`, `repairPlan`: free at night, higher-grade substitutes; `substituteWarning`). |
| `js/core/combat.js` | Combatant stats, hit chance S-curve, event-driven attack-bar fight sim with log. |
| `js/core/sim.js` | Best-gear selection and win-chance estimate (samples hidden enemy attributes). 1.2: `simCounts` (10 x 10 base + Battle simulation intel + floor of the Foresight ring total), `winStandardError` (the margin: the estimate returns `se` and `perGuess`), and `estimateWinChance` stops and resolves `null` when `onProgress` returns `false`. |
| `js/core/enemies.js` | Roster generation, attribute levels, visibility, enemy stats. |
| `js/core/rings.js`, `skills.js`, `intel.js`, `bonuses.js` | Rings (stacking; 18 types incl. the smith ring Foresight), skills (XP; Gear care is an activity skill whose XP comes from fights), intel points (incl. the count track `simDepth` = Battle simulation), combined smith bonuses (`gearCarePct`). |
| `js/main.js` | UI shell (top bar with version, pile count and the work-day bar (`timeBar`, a 4 px strip on the bar's bottom edge), tabs, side log, phase screens, save/load: tries `smithsy-save-v3`, else migrates `smithsy-save-v2`, else `smithsy-save-v1`; a save that can't be loaded is kept as `smithsy-save-backup-<time>` and a new game starts; a render error offers "Start a new game"; `newGame` cancels a running Estimate all). |
| `js/ui/*.js` | One module per screen; `mapview.js` = world map (pile badges), field grid (debris numbers, boulders), pile and bag panels and the "Choose what to carry" step; `workshop.js` also shows the gem novice/master tables; `endday.js` = battle report + plan screen (incl. the roster comparison table `rosterTable`, **Estimate all** (`startEstimateAll`, `cancelRun`, `estKey`), the ± margin (`marginPts`), the Matchup table, wear text (`wearRange`, `wearText`) and night repairs); `adventurer.js` shows the same roster table; `repairui.js` = repair widgets shared by the workshop and the night screens; `skillsview.js` also holds the skill-vs-ring helpers used by Help; `dom.js` = tiny `h()` helper. |
| `tests/` | `npm test` (= `node --test tests/*.test.mjs`), **325 tests in 16 files** (+ `helpers.mjs`); `carry.test.mjs` (1.1, 19 tests) covers piles, carry choice and the projected-load rule; `durability.test.mjs` (new in 1.2, 20 tests) covers wear, Gear care, decimal durability and the v1.0/v1.1 save upgrades; the estimate margin, cancellation, `simCounts` and Foresight/Battle simulation are in `sim.test.mjs`, `rings.test.mjs`, `skills-intel.test.mjs`, the fresh-cell rule in `field.test.mjs`, save v3 in `game.test.mjs`. |
| `tools/balance.mjs` | Balance report: economy (incl. map size, debris effort, trips found vs carried, gem novice/master odds), power curve, bot playthrough (incl. field piles and "Map supply"), and (1.2) **benchmark** (survival curve on fixed seeds, `--jobs`, `--estimator game\|bot`), **specials** (enemy specials vs the matching defence and the adventurer's gems) and **estimator** (accuracy of the win estimate); `--set` what-ifs, `--ablate` systems, `--immortal`, `--carry value\|default`. The tool also runs on older versions (it reads optional exports such as `freshCellCount`/`simCounts` from the modules), which is how 1.1's benchmark row was made. |

## Release process
1. Bump `VERSION` in `js/version.js` (tenths for small changes, ones for big ones: user decision) and add a
   section for it to `CHANGELOG.md` in player terms (plus save notes if the save format changes).
2. Run `npm test` (all must pass); after balance-relevant changes re-run the balance tool and refresh the
   docs (BALANCE, SPEC, README, this file).
3. Merge into `main` through a pull request (the user allows auto-merge when the change is easy to roll
   back). GitHub Pages deploys from `main`.
4. Create the branch `release/vX.Y` from `main` after the merge and push it. Branches instead of tags,
   because git tags can't be pushed from this environment.
5. Rolling back = the steps in `CHANGELOG.md` (pull request from `release/vX.Y` into `main`, or revert the
   bad version's pull request).
6. If the save format changes: bump `SAVE_VERSION`, use a new `SAVE_KEY` and add a migration like
   `migrateV1`, so an older cached page can never overwrite a newer save.

The release process is unchanged in 1.2. Step 6 was followed for the new save format (key `smithsy-save-v3`,
`LEGACY_SAVE_KEYS` = v2 then v1, `migrateV2`). For step 2, the difficulty check after a balance change is
`node tools/balance.mjs --section benchmark --jobs 3` compared with the rows in `docs/BENCHMARKS.md`.

## Design decisions (from Q&A with the user)
- One enemy per day from a new daily roster (2 normal, 3 elite, 2 champion). No skipping.
- Loss = game over. Endless, score-based. No fight time limit (internal safety cap only; counts as a
  draw: survive, no ring, no score).
- Day 1: adventurer rests. The plan for day N+1 (enemy, up to 2 gear per slot, up to 10 rings) is made at
  the end of day N. The roster is visible in the morning for planning.
- The adventurer is away all of day N+1 with the packed gear; by day only unpacked gear can be repaired
  (at night all gear is home and repairs are free, see below).
- When the fight starts the adventurer sees the real attributes and uses the best packed item per slot.
- Optional win-chance simulation (player clicks); samples hidden attributes respecting tier counts and
  optimizes the gear for each sample. Since 1.2 one **Estimate all** button runs it for the whole roster at
  10 guesses x 10 test fights per enemy, with a ± margin (session 6 decisions below).
- Adventurer brings home a ring only. 20-slot bag (1 item per slot) for carrying; since session 5 finds go
  to a pile at the field and the player chooses what to carry when leaving. Unlimited camp storage.
- Persistent 5x5 map, camp in center, 4 blocked cells; travel time by path distance; map shows how much
  of each field is searched; farther fields are richer.
- Elite attribute split fixed to 3 low / 6 normal / 3 high (user's 3/9/3 summed to 15).
- Plain HTML/JS for GitHub Pages.

Adjustments the user asked for in session 3 (commits 4f45334, 5bcae94):
- **Fields do not regrow** ("the game is just a first draft"): `CONFIG.field.regrowPctPerDay = 0`. The
  mechanism stays in the code, switched off; any value above 0 turns it back on.
- **Search starts at 35% with randomness:** each cell rolls the efficiency ± `CONFIG.field.searchRandomness`
  (5) per search (30–40% at base), so efficiency bonuses matter more. About 3 searches finish a cell
  (about 17% of cells need a 4th at +0%; from +9.6% every cell is done in 3). The map shows the current range
  (`searchEfficiencyRange`).
- **A level-10 skill = at least a C-grade ring of the same kind:** time skills 0.6 per level, search
  efficiency 1.2, grade luck 0.3. Skills with no ring: debris clearing 5 per level (−50% at level 10),
  failure reduction 0.5 per level (−5 points). (Session 5 changed debris clearing to +10% clearing power
  per level and the gem grade skill to the novice → master blend; see below.)
- **Repairs at night cost no time** (battle report and plan screen, which both have Repair buttons);
  daytime repairs still cost time at camp.
- **A higher grade can substitute in repairs:** the exact grade if there is enough, else the lowest higher
  grade with enough (bars and gem chosen separately), with a warning; no benefit from the higher grade
  (`repairPlan` / `substituteWarning` in gear.js). Grades are never combined.
- **Keep the pacing** after these changes. Done with richer cells (the values are ours):
  `field.lootChance` 50/5/80 (was 40/5/70) and `field.itemCountWeights` 1:30 / 2:40 / 3:30 (was 50/35/15).
  Items per search stay within ~10% of before; the map now holds ~1,557 items (was ~1,080; ~1,540 since
  the boulders of session 5).

Adjustment the user asked for in session 4 (commit 1e53a91):
- **Enemy tiers share base stats** ("Champions shouldn't have higher HP, damage, or defense than the elites
  or normals. The win rate is too low."): all three tiers now have base HP 80, damage 8, defense 20% (was
  normal 80/8/20, elite 80/9/25, champion 90/10/30; defense is 25% since 1.2). Tiers differ only by attribute levels (normal 6 low /
  6 normal; elite 3 low / 6 normal / 3 high; champion 6 normal / 6 high), score (10 / 25 / 50) and ring
  grades (D–B / C–A / B–S). Target the user chose: champions ~30–40% win with on-pace gear, elites ~60–70%,
  normals 90%+, erring on the high side because the user wanted higher win rates. Result with plain C sets
  late in each material window (iron C day 10, steel C day 20, mythril C day 40; the 1.1 numbers): champions
  48 / 32 / 21%, elites 83 / 74 / 63%, normals 99 / 95 / 92% (1.2: see BALANCE "Balance targets and current
  results").

Decisions from the user, session 5 (version 1.1; commits e8886d2, 247909d). The change requests:
1. **Choose what to bring back** instead of the ground items and the time-limited pick-up rule.
2. **Debris cleared by searching**, with a random amount per cell, and some debris that can't be cleared.
3. **Gem cutting improves with practice:** start D-heavy with more failures, get better with the skill.
4. **Every gem type equally likely** to be found.
5. **Grades shown from lowest to highest, left to right** everywhere.
6. **Versions and rollback:** a version number, a changelog, and a way to go back to an earlier version.

Also handled in 1.1: the blank page reported in Firefox (start-up diagnostics box, `||=` removed; the cause
is not confirmed yet, see "Known concerns").

The user's answers to the follow-up questions:
- **Field pile, choice at departure:** everything found goes to a pile at that field (no limit); the
  player chooses what to carry (up to the bag size) when leaving the field. The rest stays in the pile.
- **Gem skill blends novice → master:** the gem's grade skill moves its cutting table from a novice table
  (F 15, D 45, C 25, B 10, A 4, S 1) to a master table (F 10, D 20, C 25, B 22, A 15, S 8).
- **Live = 1.0, this = 1.1.**
- **Debris:** a random amount of 20–60 per debris cell, plus 1 unclearable, visually noticeable debris
  space per field (the boulder).
- **Version numbers:** tenths for small changes, ones for big changes.
- **Merging:** auto-merge into `main` when the change is easy to roll back. Every release is kept as a
  branch `release/vX.Y` (git tags can't be pushed from this environment); rollback steps in CHANGELOG.

Decisions from the user, session 6 (version 1.2; commits e446ef7, cd61042, then the review fixes). The
change requests:
1. **Durability about 10% per fight**, scaling slightly with the enemy's tier, plus a passive **Gear care**
   skill (XP from the fights the adventurer survives).
2. **Tune magic, piercing, stun and slow** so each is dangerous and resistances matter; the adventurer's
   offense should be a little weaker than the enemy's.
3. **Win-chance estimate: 10 guesses x 10 test fights per enemy**, raised by a new intel track (**Battle
   simulation**) and a new ring (**Foresight**).
4. **One "Estimate all" button.**
5. **Roster comparison table:** one enemy per column, offense rows first, then defense rows.
6. **A visual day bar** in the top bar.
7. **Unarmed damage** so that an unarmed adventurer beats a normal enemy on day 2 about 50-65% of the time
   (swords raised too: unarmed 11, sword 16).
8. **+2 minutes per never-searched ("fresh") cell** in a search.
9. **Benchmark difficulty** by the % of simulated runs alive at each day
   (`tools/balance.mjs --section benchmark`, `docs/BENCHMARKS.md`), so versions can be compared.
10. **Firefox is ignored** (the user uses Chrome).

Review fixes on top (reviewers plus an independent verifier; nine findings, all fixed): durability kept to
**one decimal** (so every Gear care level counts), the estimate's **± margin** (also in the confirm bar and
the low-win warning), **Estimate-all cancellation** (gear/ring change, confirm, new roster, new game; a
stale result is never painted), a **thin** day bar (absolute strip, the top bar keeps its height), the
**save key v3** with v2 / v1 migration, the **magic retune** (enemy Magical 10 / 15 / 25, ruby sword 6-18),
the phone roster's Defense divider repeating the enemy names, "against an elite enemy" grammar, and the
Adventurer tab's wear note.

## Interpretations made without asking (flag to user if they disagree)
- **Search depth model:** each item has a hidden depth 0–100; a cell's "% searched" rises by the search
  efficiency each search, and items are found when % searched passes their depth. For the user's
  35% ± 5: the ± 5 is a continuous uniform roll per cell and per search; ring and skill bonuses multiply the
  35% average and the spread stays ± 5 (`searchEfficiencyRange` clamps to 0–100).
- **Ore mix by distance:** no coal next to camp, mythril only at distance 4+ (farthest fields).
- **Attack-bar combat model:** each side's bar fills in `interval / (1 + speed%)` and attacks when full.
  Slow = the bar fills X% slower for the duration; stun = the bar stops filling for the duration. Neither
  stacks (a new stun extends to the later end time; a new slow keeps the stronger strength and the later
  end). Ties: the adventurer attacks first.
- **Relative pierce resistance:** pierce resistance ignores a % of the attacker's piercing (not points
  subtracted). Piercing ignores a % of the defender's defense.
- **Enemy daily growth:** HP and damage +3.5%/day (3% before 1.2), accuracy and dodge +1%/day (linear),
  otherwise late-game hit chances saturate. (Tier base stats are no longer an interpretation: equal for all tiers, user
  decision in session 4, see above.)
- **Enemy Fast / HP steps:** small (±5% speed, 90/100/110% HP) as the user suggested.
- **Gem rebalance (sword):** ruby 5–15% magic (halved), emerald 20–60 accuracy and diamond 20–60% piercing
  (doubled), topaz 10–20% stun for 1–1.5 s, sapphire unchanged; aimed at ruby ≈ diamond ≈ sapphire swords.
  (1.2 retuned them against the new enemy specials: ruby 6–18, diamond 15–55, topaz 10–30% for 1–1.5 s,
  sapphire 10–30% for 1.5–2 s; see BALANCE section 7.)
- **Processing times:** copper 15, iron 20, steel 25, mythril 30 min per bar; gems 20 min ("slightly more
  time for better ores"); smithing 15 min per bar, +10 min to infuse a gem.
- **Durability:** only gear actually USED in the fight loses durability (packed-but-unused gear doesn't
  wear; since 1.2 about 10% a fight, to one decimal, see session 6). Repairs by day take 50% of the craft time × fraction repaired (at night: no time, user decision);
  smithing has no skill.
- **"Night" = the battle report and plan phases** (`isNight`); the game-over screen is not night. All gear
  is home then (packing is cleared when the day ends and set again when the plan is confirmed), so the
  pieces used in today's fight can be repaired before they are packed again. Night repairs skip the camp
  check (End day already requires camp).
- **Repair substitute warnings:** a single repair shows the warning on its repair line and in the result
  message (no dialog); "Repair all" asks for confirmation when any of its repairs uses a substitute.
- **Skill vs ring matching** (Help and Skills tabs): Return travel ↔ Travel ring, Search speed ↔ Quick
  search, Search efficiency ↔ Thorough search, Refining speed and Cutting speed ↔ Refining ring, bar
  grade skills ↔ Bar luck. Return travel matches the C ring's 6% but only counts on trips to camp. Since
  1.1 the gem grade skills have no ring (they blend the cutting table; Gem luck rings upgrade on top).
- Ore sight = chance per searched cell to reveal what's left in it (intel track + smith ring points).
- "Refining time" smith ring applies to refining and cutting.
- Sapphire armor "debuff reduction" = slow strength + slow duration reduction.
- Topaz/Sapphire armor: two stats with the same table values. Stun / Slow resistance rings count for both.
- Upgrade luck: after a successful roll, X% chance to go up one grade (S stays S).
- Bar skill "fail reduction" moves failure % into D. (Gems since 1.1: failure = novice F − cutting skill,
  and D..S are rescaled to fill the rest; see session 5 below.)
- The debris clearing skill has no ring counterpart (the user's ring list has none).
- Duplicate rings beyond the 3rd keep halving (12.5%, ...).
- Debris cells are 20 points more likely to hold items.
- The day does not auto-end at 18:00; the player presses End day at camp. Past 18:00 only the walk home
  (and free moves between bag and field pile) is possible.
- Smith rings apply at once but lock once the day's first action happens (changeable at 8:00 at camp
  or while planning at night); otherwise swapping before every action made the 10-ring limit meaningless.
  Adventurer ring toggles on the Rings tab outside the plan only change tonight's default selection, never
  today's fight (during planning they are mirrored into the plan selection).
- Ore sight only rolls on cells the search did not finish (still below 100%), so it is not wasted on
  finished cells.
- Confirmations: End day with 30+ minutes left; confirming a plan that packs nothing / leaves an owned
  slot empty / has an estimated win chance under 50%.
- A ring won today is pre-selected in tonight's plan when there is a free ring slot.
- During report/plan/game over, the Rings, Skills & Intel, Log and Help tabs stay available.

Interpretations in session 5 (1.1):
- **Default carry "Rarest first"** (`defaultCarry`): keep the bag, then fill free slots from the pile in
  the order mythril, diamond, emerald, sapphire, topaz, ruby, coal, iron, copper. The carry step only opens
  when the field's pile has items; with an empty pile the bag goes along. Single items can also be moved
  between bag and pile in the field (free).
- **Time rule with piles:** a search needs time for the walk home with a full load, bag + this field's
  pile up to 20 (`projectedLoad`), so leaving items behind does not buy time (replaces 1.0's
  `pickUpLimit`/`loadMark`). Field-to-field travel checks the trip there and back to camp with the chosen
  load; the walk home is always allowed.
- **Debris mechanics:** thickness is in search effort (a whole number 20–60); the Debris clearing skill
  multiplies clearing power (+10% per level, so ×2 at level 10; it has no ring, so the "level 10 = C ring"
  rule does not apply); leftover effort searches the cell in the same search; XP = 1 per point of debris
  cleared; a cell whose effort all went into debris gets no ore sight roll.
- **Boulder:** one random cell per field, drawn as a dark rock; holds nothing, never searched or regrown,
  left out of the field's searched %.
- **Gem tables:** failure = novice F (15) − cutting skill (0.5/level), so the master F (10) is reached at
  cutting level 10 (the config's master F is not read by the formula); D..S blend linearly by the grade
  skill (10%/level) and are scaled to fill 100 − F; Gem luck rings upgrade on top. Both gem skills get the
  same XP, so in play the table is a straight blend of the two tables.
- **Equal gem odds:** `gemWeights` is a single row used at every distance.
- **Grade order:** Fail, D, C, B, A, S left to right in every table, list and summary (`GRADE_ORDER`).
- **v1.0 saves:** ground items move to their field's pile, debris `true` becomes thickness 40 (the
  midpoint), old maps get no boulders, `loadMark` is dropped; the save moves to the new key
  `smithsy-save-v2` (the v1 key is left alone, so going back to 1.0 still finds the old save). A save that
  can't be loaded is backed up under `smithsy-save-backup-<time>` and a new game starts.
- **Start-up diagnostics:** a plain (non-module) script records errors and, if the top bar is still empty
  4 s after `load` (15 s fallback), shows a box with the errors, the browser and the page to send to the
  developer.

Interpretations in session 6 (1.2):
- **Wear numbers:** a whole-number roll 8-12 (avg 10), multiplier normal 1.0 / elite 1.1 / champion 1.2
  ("scaling slightly with the enemy tier" gave no numbers), times (1 - Gear care %), kept to one decimal,
  at least 1%. Gear care is 1% per level (10% at level 10, like a C ring would be), 100 XP per survived
  fight (win or draw; none on the losing fight), so level 10 comes after 55 fights.
- **Fresh cell** = an open cell no search has worked on (`touched` false and `searched` 0; clearing some
  debris counts as working on it). The surcharge is part of the base minutes, so Quick search rings and the
  Search speed skill reduce it. Cells in v2 saves have no flag, so any cell with searched % is touched.
- **Specials values** (Magical 10/15/25, Piercing 10/25/60, Stunning 5/15/35 for 1.5 s, Chilling 10/20/40
  for 2.5 s, resistances 0/20/40) and the gem and ring tables were set by tuning against the `specials`
  report's four checks (see BALANCE section 7), not given by the user. Enemy defense 20 -> 25% and growth 3
  -> 3.5% were set to keep the middle of the game in place after sword 16 / unarmed 11 (checked with the
  benchmark).
- **Estimate:** the margin is `max(1, round(2 x SE))` points, SE = the spread of the per-guess win fractions
  / sqrt(guesses); with one guess the binomial error. The three sizes (guesses, test fights, fights per
  loadout) all rise by the same extra. Battle simulation is a count with the usual +10, +9, ... gains
  (capped at 100); Foresight rings are 2/3/4/5/6, stacked like all rings, rounded down. Results are cached
  per exact selection and seeded, so they never change between presses; choosing another enemy column does
  not cancel a run, any gear/ring/intel/worn-ring change does.
- **Roster table:** the Defense divider is a row of the enemy names (small, muted, clickable) so a column
  can still be picked on a phone; the Adventurer tab shows the same table without the estimate row.
- **Day bar:** yellow at or below 25% of the day left, red at or below 10%; display only.
- **Benchmark:** the careful bot on `mixSeed(31337, 0..99)`, planning with the in-game estimate of that
  version (the bot wears Foresight rings but spends intel only on enemy scouting), fighting an enemy only at
  an estimate of 90% or more. `--estimator bot` swaps in the bot's own larger estimate to separate the game
  rules from the estimate size.
- **Saves:** 1.2 reads `smithsy-save-v3`; if none exists it tries `smithsy-save-v2`, then `smithsy-save-v1`,
  converts once and from then on saves under v3 only (the older key is never touched or re-read).

## Balance status (version 1.2)
Run `node tools/balance.mjs --section economy`, `--section power`, `--section bot --seeds 40`
(`--immortal` for how long the map lasts), `--section specials`, `--section estimator` and
`--section benchmark --jobs 3`; details and tables in `docs/BALANCE.md` → "Balance targets and current
results" and in `docs/BENCHMARKS.md`.

```
ECONOMY SUMMARY | items/search by dist d1:1.84 d2:2.05 d3:2.22 d4:2.36 d5+:2.55 | debris % of effort d1:5 d2:5 d3:5 d4:5
d5+:5 | one trip d1/d3: 312/348 min for 20.0/20.0 items (found 21.5/22.0, pile left 1.5/2.0) | field min per unit: copper 27,
iron 62, steel pair 115, mythril 666, any gem 49 | full set >=D work days: copper 1.2, iron 2.1, steel 3.4, mythril 15.8 |
gem cut skill 0: F 15% C+ 40% effect 0.77 of C | map items/run 1541 (mythril 12.4, coal 120) | regrow off

POWER SUMMARY | unarmed d2 vs normal 62% (target 50-65) | day-2 ref (Copper C sword + C chest + C boots) n/e/c 100/94/65% |
Cu D sword n/e/c 97/76/37% | last day >=90% vs normal: Copper B d10, Iron C d15, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d5, Iron C d15, Steel C d20, Mythril C d40, Mythril S d60 | ceiling vs normal d60/d80 100/99%

BOT SUMMARY | alive d10:93% d20:90% d30:73% d40:73% d50:58% d60:13% d80:0% | median life 51.5 | score 1219 | d2 typical est
n/e/c 100/95/76 | first iron/steel/myth piece d4/10/18 | 3-slot iron/steel/myth d7/13/27 | d11-30 fights n/e/c 1/39/60% |
mining 63% trips/day 1.3 idle 14m | repair 3.8% bars 0.0% time, 15.6 night/run (2.1 subst.) | map found d40:64% d60:91% d80:-% |
field: 3.29 found/search, carried 56% of found (10.5/trip, 68 from old piles), piles at end 486 (9.5 worth), debris 4.0% of
effort | gems cut 257.6/run F/D/C+ 13/35/52%, 31.0 infused

SPECIALS SUMMARY (steel C, N->H loss / recovered by 3 gems + B ring) | Magic -11 / 59% | Piercing -12 / 62% | Stun -14 / 82% | Slow -13 / 103%

BENCHMARK | v1.2 | seeds 100 | alive d5:97% d10:94% d15:85% d20:81% d25:77% d30:74% d40:70% d50:46% d60:13% d70:1% d80:0% d100:0% | median life 50.0 | mean score 1228 | estimator game 10x10
```

- **Difficulty of 1.2 equals 1.1** (the point of the tuning). Benchmark, in-game estimate of each version, 200
  seeds: alive d10 / d30 / d50 / d60 93 / 75 / 51 / 10% (1.1: 88 / 75 / 50 / 10%), median life 51.0 vs 50.0, mean
  score 1,246 vs 1,158. 100 seeds: 94 / 74 / 46 / 13% vs 85 / 73 / 46 / 5%, median 50.0 vs 48.5. With the bot's
  own larger estimate (`--estimator bot`): 94 / 78 / 58 / 12% vs 91 / 79 / 60 / 12%, median 52 vs 53. The shape
  moved only at the start: no day-2 deaths (14 of 200 in 1.1) but more on days 3-19 (34 of 200 vs 23); deaths
  before day 40 are 62 vs 59.
- **Bot, 40 seeds (own estimate), 1.1 → 1.2:** median life 53.0 → 51.5, score 1,192 → 1,219, champion wins 14.0 →
  13.8, first iron / steel / mythril piece day 3 / 9 / 16 → 4 / 10 / 18, 3 of 5 slots 6 / 11 / 22 → 7 / 13 / 27,
  map found by day 40 / 50 82% / 92% → 64% / 84% (the fresh-cell time slows mining by about 15%: a trip from
  8:00 takes 244 → 312 minutes at distance 1), repairs per run 4.8 → 15.6 (1.4% → 3.8% of the bars made), items
  destroyed by wear 1.4 → 4.2 (4.3 of the 10 mythril bars a run), gems cut 310 → 258.
- **Power curve:** unarmed beats a day-2 normal 62% (target 50-65%); the day-2 reference set wins 100 / 94 / 65%
  against normal / elite / champion (1.1: 93 / 63 / 22). Plain sets last longer: the last day with 70% against
  elites is iron C 15, steel C 20, mythril C 40, mythril S 60 (1.1: 10, 20, 30, 50). On-pace plain sets win
  more than the session-4 targets (steel C on day 20: 99 / 89 / 56% against normal / elite / champion).
- **Specials** (steel C, elite, day 28): Normal → High costs 11.3 / 12.2 / 14.5 / 13.1 win points for magic /
  piercing / stun / slow; the matching armor gems (C, 3 pieces) + a B ring win back 59 / 62 / 82 / 103% (mythril
  set: 48 / 52 / 98 / 98%); the S sword gems are 72 / 92 / 86 / 75% of the enemy's High value. Resistances take
  about 2 win points (Low → High) off a C ruby or diamond sword gem, 4-7 off a C topaz or sapphire sword and
  8-12 off an S gem.
- **Estimator** (steel C vs elites, true chance ~55%): at 10 x 10 and the 10% starting scouting a press-to-press
  wobble of 6.8 points and a typical miss of 15.0 points; 20 x 20 (one Battle simulation point) 4.2 / 14.2;
  1.1's 40 x 30 2.7 / 13.9; with 50% of the attributes visible the miss is 11.3 and with all visible 4.6 (at
  10 x 10), 2.5 (20 x 20). Most of the error is the hidden attributes, so scouting beats simulation size
  (`docs/BENCHMARKS.md`, "Is 10 x 10 too low?"). The simulation size still matters for survival: a 20 x 20
  in-game estimate (what one Battle simulation point gives) lifts the 100-seed curve by 9-12 points on days
  20-50 (median 52 vs 50) and `--estimator bot` by 12 at day 50, so the 10 x 10 noise costs about 2 days of
  median life. And the displayed ± margin covers the truth only 56% of the time at 10 x 10 and 10% scouting
  (see Known concerns).
- **Ablations** (40 seeds, `docs/BALANCE.md`): rings −4 days (median 47.5, champion wins 6.5 instead of 13.8),
  gems −9.5 days (42.0), repair 51.0, skills 52.0, intel 53.5, `--carry default` 51.5: only rings and gems are
  clear losses; `--set field.regrowPctPerDay=5` gives median 59.0 and 33% alive at day 60 (13% without).
- **Map:** 64% found by day 40, 84% by day 50, 91% by day 60; with `--immortal` gear plateaus at mythril B
  sword and 2.6 of 5 slots in mythril around day 40-60 and finds fall to 13 a day on days 51-60.

## Known concerns / ideas
- **Mythril upkeep with 10% wear.** Keeping a full mythril set whole costs about 0.39 mythril bars a fight
  (3.5% of its 11 bars); the map's ~13 ore (~12 bars) pay for about 30 fights of one set. The bot loses 4.3
  of the 10 mythril bars it makes to destroyed pieces, cannot repair a worn top item on 26.8 nights a run (no
  bars of its grade or higher), and the immortal bot ends with 2.6 of 5 mythril slots (1.1: 3.3). Options (the
  user's call): lower the wear multiplier for mythril or make the tier multipliers smaller, let repairs
  combine grades, more mythril in the map, regrowth, a faster Gear care.
- **Deaths shifted from day 2 to days 3-9 (and 10-19).** With no day-2 deaths (14 of 200 in 1.1), 34 of 200 benchmark runs
  die on days 3-19 (23 in 1.1: days 3-9 14 vs 10, days 10-19 20 vs 13), so deaths before day 40 are 62 vs 59.
  The new swords make the bot take elites and champions sooner, and its 10 x 10 estimate cannot tell a 97% fight
  from a 100% one (the bot section's early deaths are fights it estimated at 98-99%). What a bigger estimate
  buys is in `docs/BENCHMARKS.md`.
- **Estimator noise is mostly hidden attributes early.** At the 10% starting scouting the typical miss is 15
  points whatever the size (1.1's 40 x 30: 13.9); only scouting (50% visible: 11.3; all visible: 4.6) fixes it.
  The shown ± margin covers the simulation noise only (about 2 x the 5-7 point wobble), not the guesswork about
  attributes you cannot see: in a coverage check (200 elites, steel C set, true chance ~55%) the true chance lay
  inside the shown margin for only **56%** of 10 x 10 estimates at 10% scouting (69% at 50%, 93% with every
  attribute visible; 20 x 20 and 40 x 30 are worse at low scouting, 44% and 30%, because their margins shrink).
  The screen's wording was corrected before the 1.2 release (detail panel, cell tooltip, `estimateHow`, Help:
  the ± is how far the simulation alone could be off, about 9 times in 10 when every attribute is known;
  attributes you can't see add more uncertainty); the margin math is unchanged. Still open as options: widen
  the margin with the number of hidden attributes, a higher starting scouting.
- **Firefox is unresolved and ignored** (user decision, session 6: the user uses Chrome). The blank page
  reported in 1.0 was never confirmed to be the `||=` shorthand removed in 1.1; the code still uses `?.` and
  `??` (Firefox 74+), and the start-up box would show the error. Not tested since.
- **On-pace plain sets win more than the session-4 targets** (champion ~30-40%, elite ~60-70%): iron C day 15 /
  steel C day 20 / mythril C day 40 win 97 / 76 / 38%, 99 / 89 / 56%, 98 / 73 / 30% against normal / elite /
  champion. The benchmark equals 1.1's, so the difficulty probably comes from the specials, the wear upkeep and
  the noisy estimate rather than from raw plain-set power. Re-aim the targets or the damage scale if that matters.
- **Resistances matter modestly for C gems.** A High Pierce or Magic resistance takes only about 2 win points off
  a C ruby or diamond sword gem (8-12 off an S gem); the user's "resistances matter" is met mainly by stun and
  slow and by S gems. Sapphire armor + a Slow resistance ring win back 103-140% of a High Chilling, which may be
  too strong; the armor defence for magic (48%) and piercing (52%) on a mythril set is right at the "at least
  half" line.
- **Ruby is now the strongest sword gem:** +19.9 win points at S against +13.7 to +15.6 for the other sword
  gems (steel C set vs a typical elite; `power` report, `docs/BALANCE.md` special-gem table). Retune ruby
  (`CONFIG.gemEffects.ruby.weapon`) if it should sit with the rest.
- **Armor-gem recovery vs a High Chilling enemy is 98-140%** (mythril C set with 3-4 armor gems and a B
  ring; 103-121% on steel C): the defence can win back more than the special cost, maybe too strong.
- **Mythril armor recovers only about 48% vs High Magical and about 52% vs High Piercing** (3 armor gems and
  a B ring; the "at least half" line), because the mythril set already has so much defense.
- **`--ablate repair` and `--ablate skills` are within noise** (median 51.0 and 52.0 vs 51.5; in 1.1 they cost
  8 and 3.5 days): with 10% wear the bot rebuilds broken pieces, so repair and Gear care show in the bar bill
  (destroyed items 11.9% of the bars made without repair, 4.8% with), not in survival. Re-run on 200 seeds before
  concluding anything; the default carry also shows no cost any more (51.5 vs 51.5; the 1.1 concern "Default
  carry includes junk" is within noise).
- **Fresh cells in v2 saves:** cells have no `touched` flag, so a debris cell that was partly cleared but has
  0% searched counts as fresh once more. Harmless, small.
- **Debris skill XP comes fast early.** XP is 1 per point of debris cleared and the first levels cost
  100 / 200 / 300 XP, so level 1 (+10% clearing power) comes after two or three debris cells and +30%
  after about 15; each level is worth +10% (other activity skills 0.6–1.2%). The bot ends runs at level 8.9
  (+89%); at level 10 every debris cell clears in one search. If it should grow slower: lower
  `CONFIG.skills.activity.debris.perLevel` (the 1 XP per point is fixed in `search` in map.js).
- **The gem master table's failure value is not read.** Gem failure is always novice F − cutting skill;
  `CONFIG.cut.<gem>.master.F` only feeds the Help/Workshop label ("master at cutting level N"). Changing
  it alone changes no odds.
- **The finite map caps runs.** Fields do not regrow (user decision), so a map's ~1,540 items (~13–14
  mythril, ~122 coal) are the whole run. With the fresh-cell time the map lasts a little longer than in 1.1
  (64% found by day 40, 84% by day 50), coal and mythril still run low around day 40–50 and a perfect player
  hits a wall around day 60–70; a matched mythril C-or-better set alone needs ~26 mythril on average, twice
  what a map holds. Regrowth at 5% (`CONFIG.field.regrowPctPerDay`) lifts the bot's median life from 51.5 to
  59.0 (33% alive at day 60 instead of 13%). Options (the user's call): turn regrowth back on, add mythril, or
  keep the cap as a natural run length.
- **Repairs never combine grades.** A repair takes the whole amount from one grade (exact, else the lowest
  higher grade with enough), so 0.30 C + 0.30 B bars cannot pay a 0.42-bar repair and small leftovers of
  different grades pile up. At 10% wear this matters more (the bot has no usable bars for a worn top item on
  26.8 nights a run). Combining grades would need the user's OK.
- **The Return travel skill only applies to trips to camp.** At level 10 it equals a C-grade Travel ring
  in number (6%) and the UI says so, but the ring counts on every trip, so the skill is worth about half a
  ring. Apply it to all travel (or double it) if the user wants an exact match.
- **Late game is mostly mining, then nothing to mine.** The bot's mining share (travel + search) is 61% on
  days 11–20 and 69–75% on days 21–40; after day 40 the map runs dry and it spends ~160–175 min a day
  cutting stockpiled gems.
- **Intel and skills:** `--ablate intel` is within noise for survival and score (53.5, 1,217). The bot spends
  every point on enemy scouting (8.5 per run) and never buys Battle simulation.
- **Win-chance estimate cost:** 3,300 fights per enemy at 10 x 10 (23,100 for the roster; 1.1: 39,600 per
  enemy), about 0.01 s per enemy in Node, longer in the browser with a progress bar; 20 x 20 is 13,200. The
  real battle's gear choice runs 32 × 200 fights. The bot estimates all 7 enemies daily with its own larger
  estimate, so a 40-seed bot run takes ~2 min and a 100-seed benchmark ~2 min with `--jobs 3`.
- **Champions are the careful bot's main mid-game pick** since the tiers share base stats (session 4): best
  estimate 95–98% on days 7–30, champions are 69% of its fights on days 11–20 and 52% on days 21–30, 13.8
  champion wins per run. If the user wants champions to stay a rare, risky pick, the levers are the champion
  score, its ring grades (`CONFIG.rings.gradeWeights.champion`) or the attribute values, not base stats.
- Enemy growth is linear (3.5%/day) and unbounded while gear tops out at mythril S: every run ends (intended).
- About 0.7% of maps have a single distance-4+ field (the only mythril source); ~0.01% have none.
- Bot results are noisy (chaotic runs): compare what-ifs with `--seeds 40` or more and difficulty with the
  benchmark (100-200 seeds); differences under about 10 points on 100 runs are noise.

## Plan deviations
Where the 2.0 implementation (`docs/PLAN-2.0.md`, authoritative) was changed or read narrowly. Each entry says
what was done instead and which batch it touches.

**Batch 1 (foundation: version and saves, intel schema, world map, fields, sight, regrowth removal)**
- **No `tierMult` / `gradeMult` yet (B4).** Section 10 says the intel multipliers are B4 and the request map files
  R22 / R23 under B4, so `intel.tracks.enemySight` and `ringGradeSight` have no multiplier keys, and their `desc`
  does not promise "a little less for elites". `enemySightFor`, `ringGradeSightFor` and `hiddenGradeOdds` are B4
  too. B4 adds the keys together with the code that reads them (section 5 has the values).
- **`canSpendIntel` and `trackValueText(track, value, cfg)` are in `js/core/intel.js` now.** `canSpendIntel` is only
  used by tests until the B4 gate. `js/ui/skillsview.js` no longer exports `trackValueText` or `isCountTrack`
  (the unit is `intel.tracks[..].unit`); its `spendIntelAction` adds the guesses x test fights sentence to the core
  message for the count track.
- **`expectedSearches(state, cfg)` (new, `js/core/map.js`).** The Map UI said "3-4 searches finish a cell"
  (`ceil(100 / efficiency)` over the efficiency range); R37 wants "about 4". The new function is the exact expected
  number (Irwin-Hall sum of the per-search rolls: 3.98 at +0%, 3.44 at +12%), and the camp / action panels say
  "about N searches". It matches the economy tool's simulation. `searchesToFinish(lo, hi)` is the same maths for a
  given per-search range with no player bonuses (Help uses it, so Help's "about N searches finish a cell" follows
  `field.searchEfficiency` / `searchRandomness` instead of a fixed 4), and `searchesText` formats the number.
- **Intel UI trimmed.** The single gains schedule (`gainsPerPoint`) no longer exists, so the Skills tab's "gain per
  point" table and the "then 28%, 34% ..." preview are gone (R18: no full schedule); the intel table shows points
  spent, the current value (with the Ore sight ring part), the next gain and a Spend button. B4 reworks the layout.
  The plan screen's intel list shows all six tracks (it used `PLAN_TRACKS`, now `Object.keys(cfg.intel.tracks)`).
- **Map UI.** "What the fields hold, by distance" is a closed `<details>` with the plan's columns (the old
  "Searched" column is dropped; the world map tiles already show it); a plot background (light grey) and an 8 px gap
  make the 3x3 plots visible. The camp panel keeps its "Carrying" row (the plan's row list does not mention it).
  A debris cell that holds a seen item shows the item tag (+N) with a smaller debris number below it (sight sees
  through debris, section 4.3). The cell's hover tip lists the seen items rarest first (the same one as the tag),
  with their item names ("Raw ruby, Iron ore x2") rather than the plan's example "Iron ore, Ruby", to match the
  selected-cell panel. The sight tip says "all the copper, about 80% of the iron, ...". On phones (480 px and
  narrower) the world-map tiles drop their "dist N" line, so the note under the map says the distance shows "on a
  wider screen".
- **Start-up note** says `Smithsy ${VERSION} starts a fresh game: ...` instead of a literal "2.0".
- **`boulderCell()`** has `touched: false` like every other cell (Cell shape, section 6). Saves are per version, so
  `cellFresh` is just "open and not touched" (no fallback for cells without the flag), and the battle report screen
  assumes `packedIds` / `usedIds` exist.
- **Sim sizes are still 10 / 10 / 10 (B3 makes them 5 / 5 / 5)**, but `simDepth` already has the new schema
  (`gains: [1]`, `max: 3`), so a 1.2-style estimate gets at most +3 from intel until B3. `tests/sim.test.mjs` only
  had its pinned intel config rewritten to the new schema (a B1 consequence); the B3 rows are untouched.
- **Docs.** README: the regrowth lines are gone, and the map / sight / save paragraphs that B1 made false were
  rewritten; its other numbers (skills, repairs, estimate) are B7's. HANDOFF's file table, save keys and release
  step 6 are B7's too, so they still describe 1.2. `CHANGELOG.md` has no 2.0 section yet (B7).
- **`tools/balance.mjs` only runs on 2.0 trees now** (it imports `distanceRow`, `sightValue`, `sightShare`,
  `seenItems` directly; the 1.2-era optional-export guards that are still there are harmless). Economy buckets are
  1..6+ and its SUMMARY ends with `searches per clear cell`. The bot only had `intelChance` renamed (it still spends
  intel by its own short list: no R45 gate until B4) and its field search uses sight (`centerOptions`).
- **Batch 1 open notes**
  - [minor] Dead CSS left behind by the removed 1.2 UI: nothing in js/ uses `.mv-empty` / `.mv-done .mv-empty`
    (css/ui-map.css:103-104), `.mv-odds th.mv-group` (css/ui-map.css:192) or `.mi-sched` (css/ui-misc.css:77).
    Check: `grep -rn "mv-empty\|mv-group\|mi-sched" js` finds nothing. Expected: delete them.
  - [minor] Camp panel Debris row reads awkwardly: js/ui/mapview.js:419 builds `Boulders (${bMin}-${bMax}, more far
    away per field) can never be searched.` Wording only, for example "2-4 boulders per field (more far from camp)
    can never be searched."
  - [minor] The 'request pins' test hard-codes CONFIG numbers (documented exception to the house rule): 
    tests/spec-guards.test.mjs:103-115 asserts map.size 7, field.size 9, boulders 2-4, gemShare 15/25,
    groupSight.base 20 and oreSight.base 0. Listed in 'Tests (B1)' as deliberate; flagged so the user can accept or
    reject the exception.

**Tests (B1)**
- Hand-built geometry tests (`map.test.mjs` travel / pathSteps, `carry.test.mjs`) are pinned to a 5x5 map with
  `cfgWith({ map: { size: 5 } })` instead of moving every coordinate to the 7x7 map; `field.test.mjs` pins its
  field size to 9 (`PIN`) and lost its `NO_REVEAL` / `ALL_REVEAL` configs (there is no reveal chance any more).
- `spec-guards.test.mjs` bans the cell property `revealed` (`.revealed`, `revealed:` / `revealed =`) and `revealPct`
  in `js/`, not the English word (the battle report says "Enemy attributes (revealed)"). The CHANGELOG guard only
  checks a 2.0 section once it exists (B7).
- Tests do not hard-code CONFIG numbers (house rule), with one exception: `spec-guards.test.mjs` has a single "request
  pins" test for the numbers the user asked for in their own words (7x7 map, 9x9 fields, boulders 2 to 4, gem share
  15% to 25%, 20% base banner chance, sight 0 on day 1, about 4 searches per cell). Retuning one of those is a decision
  for the user, so it fails there alone. Every other test derives its numbers from CONFIG or pins them with `cfgWith`.
- `ui-render.test.mjs` renders the screens on `tests/fakedom.mjs` with `ctx.ui.estimates === 'off'` (nothing reads
  it before B4). Hand-checked in headless Chromium too: boot, the old-save start-up note (old key untouched), the
  7x7 map, the 9 plots, seen-item tags with sight, no console errors, no horizontal scroll at 390 px.

**Batch 2 (skills, travel and carrying, smithing time, repairs by day, scrap, Skills tab, tips)**
- **Skill hover, level 0.** The plan's template has a "Now:" line that reads "No effect yet." at level 0; the hover shows
  just "No effect yet." in its place (no "Now:" prefix), then the "Next level:" line. A skill at its highest level shows
  "XP: <xp> per <unit>. Highest level reached." on one line. The hover never prints a level-10 value (only the current and
  the next level; at level 9 the next level is of course the top one).
- **Skill defs.** `skillDefs` groups are `field`, `workshop`, `bars`, `gems` (the Skills tab sections) and each def also
  carries `label` (the per-material config key, e.g. `smith`). Extra exports used by the UI and the tests:
  `skillDef`, `skillEffectTotals` (one pass over the config; `smithBonuses` uses it so a dozen effects stay cheap),
  `skillNowText`, `effectText`. `skillEffects(state, key, cfg, level?)` takes an optional level.
- **Skills tab columns** are Skill, Level, Progress, Now as in the plan; Level is the plain number (no "/ 10", the max
  level is not shown anywhere), a maxed skill shows "Highest level" in the Progress column, and a skill without an
  effect yet says "no effect yet" under Now. The whole row (not only the name) carries the tip, so a tap anywhere on a
  row opens the popover. The "Skill levels" KPI is the total of all levels with "35 skills" under it.
- **Scrap messages.** `scrap(state, id, cfg)` names the item without its gem ("Scrapped C Copper Sword: got back 0.42
  Copper C bars. The Ruby B gem is lost."), as the plan's example does; the Workshop confirm and tip keep the gem in
  the name ("Scrap C Copper Sword +Ruby B? You get back ..."). Fractions are written with two decimals ("0.70", "1.05"),
  whole numbers without ("1"): `qtyText` in `js/core/util.js`, also used by the repair widgets.
- **`Repair all` is gone** (`repairAllButton`, `repairAllPreview`): it only existed for the night screens. The Workshop
  gear list has one Repair button per item. The shared gear table with the inline button is B5.
- **Workshop and Help still show the novice / master cutting tables** and the "level N" text that goes with them
  (Workshop "Cut gems" intro and rows, Help "Refining & cutting"); the plan files that under R18 / B5. Only the numbers
  they read were moved to the effects model (`gemGrade.effects.cutBlend`, `gemFail.effects.cutFail`; General cutting's
  blend is mentioned). The Skills tab, the skill hovers and Help's skills tables have no level-10 value.
- **Help** got the B2 rows (time, travel and Carrying, repair, scrap, skills tables "Skill | Per level | XP", "keep a
  spare of each item so you can leave one home to repair it"); B5 still owns the full Help pass.
- **Bot (tools/balance.mjs, 8.2 B2).** The personas are B6, so the careful persona's `restBelow 40 / repairBelow 60 /
  subBelow 30` sit in `botParams` for now. "Items a champion fight could destroy" is read as `durability <=
  wearLoss(max roll, champion multiplier, Gear care)` because `couldBreak` / `worstWear` are B3. The rest rule keeps at
  least one item of a slot packable. `campWork` repairs the unpacked top-3 items of a slot (best first) and adds the
  minutes to `ctx.tm.repair`. The bot section prints "Repairs: 0 at night ..." and the SUMMARY line ends its repair part
  with "0 at night". Economy / power / benchmark sections only had the skill config paths moved.
- **A same-version save written by the B1 tree** (25 skills) no longer passes `assertShape` (35 skills): `main.js` backs it
  up and starts a new game. No release has shipped 2.0, so nothing is lost for players.
- **Open notes**
  - [minor] `tests/sim.test.mjs:307` has two unused variables (`ring`, `ringText`) from 1.2; not touched here.
  - [minor] Help's skill table text for cutting reads "10% better cutting chances (of the way to a master cutter)" (the
    effect text in `skills.effects.cutBlend`); the hovers phrase it "better ruby cutting chances (30% of the way to a
    master cutter's)". Wording only.

- **Batch 2 open notes**
  - [minor] Skills tab at 390 px: the 'Now' column and the Repair matrix column are cut off. `css/ui-misc.css:67` sets `.mi-skills { min-width: 540px }`; the scroll box is 328 px wide at 390 px, so 'Now' and part of the XP number sit off-screen (Bar types matrix 355/328 cuts 'Repair'). No page overflow; tapping a row shows the same info. Plan 4.4 wants the four columns to fit (narrower Progress, or Now wrapping under the name). Screenshot: scratchpad/v2/review/skills390.png.
  - [minor] Touch popover stays open with out-of-date text after tapping an action button. `js/main.js:278-293` `installTips` opens `#tip` on every non-mouse pointerup in `[data-tip]`, buttons included; after an enabled 'Repair' tap the popover keeps the old text next to the toast. Fix: skip enabled buttons, or close the popover when `ctx.act` re-renders.
  - [minor] `[data-tip] { cursor: help }` (`css/style.css:106`) overrides the hand cursor on enabled buttons (`button { cursor: pointer }`, lines 74-75). Fix: `button[data-tip]:not(:disabled) { cursor: pointer; }`.
  - [minor] `craft()` and `repair()` compute XP without `xpPerUnit` (`js/core/gear.js:147`, `252-253`), so hover/Help can disagree with XP given, and removing `repair.xp` / `repairTime.xp` from config gives NaN. Use `xpPerUnit(skillDef(key))` in both.
  - [minor] `travelMinutes` (`js/core/map.js:189`) repeats the `loadPenaltyPct` formula (`map.js:179-181`) instead of calling it; `tests/carry.test.mjs` was not moved onto it (section 11). Make `travelMinutes` call `loadPenaltyPct`.
  - [minor] Some new tests hard-code default CONFIG numbers (`tests/ui-render.test.mjs` Copper sword scrap `0.42 ... 35% of its 2 bars x 60%` and smith panel `Base [\d.]+m (2 bars x \d+m)`). Pin with `cfgWith` or build the text from CONFIG.
  - [minor] Leftover single-item loop `for (const phase of ['work'])` in `tests/gear.test.mjs` ('repair consumes exactly what repairPlan chose...'); unwrap it.
  - [minor] Deferred items still visible after B2 (FYI): (1) `js/ui/workshop.js:148,187-188` and `js/ui/help.js:323-352` still show level-10 values and novice/master tables (R18, B2/B5; deferral recorded). (2) Most hovers outside B2's new elements are `title`-only, so touch users cannot see them (mapview 20, endday 17, workshop 13, skillsview intel Spend button); for B5. (3) `README.md:69,116,132,175,226` still describes free night repairs; README is B7's job.

**Tests (B2)**
- Skills: `skills-intel.test.mjs` pins its skill numbers with the effects model (`effects: { travelTime: 0.5 }` etc.);
  new tests for the 35 defs, `skillEffects` / `skillEffect` (activity skills count for every material, per-material
  skills only for their own), `xpPerUnit`, the hover texts (Travel level 3, Copper repair level 0, Carrying, a gem grade
  skill, the highest level) and `skillNowText`. Ring-matched main effects at max level reach the C ring value.
- Map / travel (`map.test.mjs`): the Travel ring and skill apply to every trip, Carrying lowers only the per-item
  penalty (capped at 100% of it), Travel XP = steps x xp and Carrying XP = items x steps x xp on every trip (none when
  empty-handed or refused). `returnTravel` no longer exists.
- Gear (`gear.test.mjs`): `smithMinutes`, craft XP, `repairInfo` (`baseMinutes`, `gemFraction`), `repairMinutes`
  (3 x Repair + 1 x General repair + 0.5 x Smithing, capped), repair XP (points x bars to `repair_<bar>` and General
  repair), repairs refused in the report / plan / over phases and away from camp, the real day flow (the unpacked worn
  sword is repaired at camp the next day, the packed one is refused; the plan's "game" row lives here because the test
  drives `endDay` / `confirmPlan` like `game.test.mjs` does), `scrapReturn` (0.42 / 0.41 / 0), scrap adds bars, loses the
  gem, takes no time, repair-then-scrap never gains bars for any slot and durability 1..99.
- Processing: General refining adds 0.1 failure points per level to every bar, General cutting adds 1% blend per level
  to every gem (capped at 100). The two long "outcomes match the table" tests switch the general skills' effects off too.
- `spec-guards.test.mjs`: no `isNight` / "free at night" / "no time tonight" / night banner in js, tools and css; the old
  skill names (`skillBonus`, `perLevel`, `returnTravel`, `xpFrom`, ...) are gone; the Skills tab source has no "Maxed";
  tips are wired (`#tip`, `installTips`, `pointerup`, `pointerType === 'mouse'`). The "request pins" part gained a B2
  test (R4 0.6% / 15 XP, R5 5% / 2 XP, R34 2%, R35 3% / 1% / 0.5%, R36 5x / 10x, A4 35% and the 0.42 / 0.41 / 0 scrap
  examples), the same documented exception to "tests never hard-code CONFIG numbers" as in B1.
- `ui-render.test.mjs`: Skills tab (grouped tables, one hoverable row per activity skill, a "Lv N" matrix cell with a
  hover for every per-material skill, no "Maxed", no level-10 text, in every phase), `tip()`, no night wording on any
  screen and no repair buttons on the plan / report screens, the Workshop gear list (Repair button with the skilled
  time, Scrap tip and confirm), a Copper sword at 60% scrapped through the real click handler gives 0.42 bars, the
  smith panel time and its hover, the Carrying text on the Map.
- `playthrough.test.mjs` checks that every repair at night (report and plan phases) is refused and changes nothing, and
  counts the repairs made by day.
- Hand-checked in headless Chromium: Skills tab at 1280 and 390 px (a tap on a row opens the popover, the next tap
  closes it, no horizontal scroll), Workshop Repair and Scrap buttons through a real click, the plan screen's repairs
  note, no console errors.

**Batch 3 (enemies, combat, gear multipliers, gems, durability display, gear search, margin, report snapshots)**
- **Head start uses no `rand()` when `combat.startFillMax` is 0.** Section 4.6 says "2 `rand()` calls"; with 0 the calls
  are skipped, so a scripted rand sequence (the hand-timed combat tests) gives exactly the old timing and "0 restores the
  old timing" holds for the random stream too. With a value above 0 the adventurer's bar is rolled first, then the enemy's.
- **`report.loadoutsTried` (new report field) and `searchLoadout(...).best`, `estimateWinChance(Sync)(...).evaluated`.** The
  plan wants a test that `resolveBattle` with 3 items per type stays within the search bound, but module exports cannot
  be wrapped, so `resolveBattle` stores how many gear combinations the adventurer thought through (`pick.evaluated`) in
  the report (a single number), and the estimates sum the same count over their guesses. `best` is the chosen loadout's
  `evalFn` result (null when there was nothing to choose).
- **`ringFactor(type, n, cfg)` (new, `js/core/rings.js`)** is the one place that knows a ring's weight (duplicate factor, or
  best-only for `stack: false`); `ringTotals` and `ringContributions` both use it.
- **`gearMatchNotes(item, enemy, known, cfg)` reads only `known`**; `enemy` is accepted for the plan's signature and
  deliberately not read, so a caller can pass the real enemy without leaking hidden attributes (a test pins that).
- **Fast Normal (0) still reads "0%", not "none".** Section 4.6 says a 0 value shows as "none": that is applied to every
  value of 0 except Fast, where 0 is a normal speed rather than an absent ability. Every Low special and resistance reads
  "Low · none". Accurate and Evasion chips and hovers take the fight day (`attrValueText(key, level, cfg, day)`); on the
  Adventurer tab the roster's day is tomorrow's fight day.
- **`estimateHow` does not say "Worked out automatically"** (the plan's wording): the estimate still runs from the
  Estimate all button until batch 4 removes it, so the text says "5 guesses x 5 test fights per enemy (base 5 x 5, +1 per
  Battle simulation point and Foresight ring step ...)" and the plan's sentence about the ± being the test fights' own
  noise. The "about 9 times in 10" claims are gone from the plan screen and from Help (they described the old margin).
  B4 only has to swap the first sentence.
- **Break risk UI is still B4's.** `couldBreak` / `worstWear` exist and the tool's rest rule uses `couldBreak`, but the plan
  screen's gear step keeps the 1.2 "could be destroyed" line and the red durability number (now whole numbers, compared
  with the worst wear of the chosen tier through `wearRange`); the warning icon, the default pack and the confirm-dialog
  line are B4. `wearRange` stays exact; only `wearText` / `durabilityNode` round (low end down, high end up).
- **Durability text everywhere is `durText`** (Workshop gear table and scrap math, repair button "+38%" = 100 minus the shown
  value, Adventurer tab, plan gear step, battle report "52% left", wear "-11%"). The Workshop scrap sentence ("35% of its 2
  bars × 63% durability") therefore uses the shown value while the bars returned use the exact one, so for a 63.4% item
  the arithmetic in the sentence can be 0.01 off the number it announces.
- **Topaz armor fallback (section 4.7) not applied.** A one-off measurement with the plan's reference method (iron / steel /
  mythril C sets vs an elite, reference day = all-Normal elite near 55%, 1,500 fights x 5 days): M2 topaz 3.9 mean (iron 3.9,
  steel 3.5, mythril 4.4), magic 7.7, pierce 6.9, slow 6.5; M3 about -2.5 to -3.0; M1 magic 14.6, pierce 18.3, stun 9.1, slow
  12.4. Topaz is on the +4 line, inside the noise (about +-0.8), so the start values stay and B7 decides with the real M1-M7
  instrument (B6).
- **`--section day2` reproduces the plan's reference numbers** (unarmed n/e/c 64/35/13, elite 0H/1H/2H+ 43/32/23, champion
  <=1H/2H/3H 15/10/8, Copper D sword 98/92/72). Not tuned yet (B7): 2 of 8 T-R7 cells are in band, the kit rows are far above
  T-GEAR (kit2 elite 94 / champion 77 vs 75-80 / 50-55). "kit3" (sword + chest + a C gem for every High special) puts the gems on the chest, then
  on extra plain Copper D helmet and gloves, because one chest holds one gem; the plan does not say where the second and
  third gem go. The section is not part of `--section all`.
- **Help got two extra B3 lines** ("Materials overlap" in Gear, "Bring the right gem" in Gem infusions) besides the growth
  table removal, the Low = none text and the head start sentence; B5 still owns the full Help pass.
- **Batch 3 open notes**
  - [minor] The battle report still lists the gear from `ctx.state.gear` ("Packed but not used") and the old "Gear the
    adventurer used" panel; the snapshots (`report.used` / `notUsed`) exist but the report layout is B5.
  - [minor] `tools/balance.mjs --section estimator` still describes 10x10 / 13x13 ... sizes (B6 rewrites it for 5x5 .. 10x10).
  - [minor] The Matchup table's "Rough time to win / to lose" can read "9-9s" (the range collapses to one number printed
    twice); pre-existing, not touched.
  - [minor] Topaz armor fallback not applied although the measured M2 is below +4. Plan 4.7: "Topaz armor fallback if M2 < +4:
    `stunChanceRed`/`stunDurRed` `[12, 18, 24, 30, 36]`." HANDOFF records a topaz M2 mean of 3.9 (steel 3.5), below +4, but
    js/config.js gemEffects.topaz.armor stays at [10,15,20,25,30]. The deviation is written up (inside the noise, batch 7
    tunes it with the batch 6 instrument), so it is a recorded choice, but the plan's condition is strictly met. Either apply
    the fallback, or make sure batch 7 decides it explicitly.
  - [minor] The lost-fight test was not given used/notUsed checks (section 11 row: "add `used`/`notUsed` asserts; `state.end`
    on a loss | B3, B5"). The day-2 win test got them (tests/game.test.mjs ~line 184); 'a lost fight is game over: no ring,
    no score' is unchanged. Expected: add `assert.deepEqual(r.report.used, [])` and `notUsed` checks, with a packed item.
  - [minor] Help attribute table shows Fast Normal as "none", unlike the roster chip. js/ui/help.js enemySection `lvCells`
    maps value 0 to 'none' for every attribute, so Fast renders "-2 / none / 2" (confirmed with tests/fakedom.mjs). The roster
    chip says "Normal · 0%" and Fast 0 is a normal speed. Expected: leave Fast out of the 'none' rule, as attrValueText does.
  - [minor] The 'could be destroyed' line can name a threshold that a listed-as-safe item meets. js/ui/endday.js:900 prints
    `At ${Math.ceil(maxLoss - 1e-9)}% or less, could be destroyed`, while listed items use `g.durability <= maxLoss + 1e-9`.
    Elite worst wear 13.2 and a chest at 14.9% (shown "14%"): the line reads "At 14% or less, could be destroyed if used
    against Dire Wolf: D Copper Helmet (1%)" and omits the chest. Batch 4 replaces it with the couldBreak icon; until then
    floor the threshold, or phrase it by exact wear.
  - [minor] Grammar in the estimate explanation: "1 attributes hidden". js/ui/endday.js estimateHow prints
    `(${nHidden} attributes hidden for ${sel.name})`; singular is needed when the count is 1.
  - [minor] Request-pins test hard-codes a number the user never asked for: tests/spec-guards.test.mjs 'request pins (batch 3)'
    has `assert.equal(CONFIG.combat.startFillMax, 50, ...)`. That is one of the changes the user did not ask for (section 13),
    so it goes beyond the documented pins exception. The other pins trace to user requests.
  - [minor] Report wear numbers are rounded separately, so they may not add up. js/ui/endday.js:502-503 shows
    `-${Math.round(w.loss)}%` and `${durText(w.left)} left`, with the starting durability floored: 63.9 before shows "63%",
    loss 10.5 shows "-11%", 53.4 after shows "53% left" (63 - 11 = 52). Cosmetic; batch 5's report rework could show the loss
    as the difference of the shown values.
  - [minor] README still describes the 1.2 estimate size: README.md:128 "(10 guesses of the hidden attributes x 10 test
    fights each)" and line 237 "estimator (v1.2) ... at 10 x 10"; the game now uses 5 x 5. Reminder for batch 7's docs pass.

**Tests (B3)**
- `helpers.mjs` has `NO_HEAD_START`; `combat.test.mjs` pins its hand-timed fights with it (`CFG` and `capAt`). New combat
  tests: Low Chilling / Magical / Stunning do nothing, `startFillMax` 0 = old timing, 50 = both bars in [0, 0.5) with
  exact first-attack times from a scripted rand, deterministic per rand source, and the default config really randomizes
  who strikes first.
- `rings.test.mjs`: Foresight has whole values and `stack: false`; D + C -> 1, B + A -> 2; `ringContributions` gives the
  others factor 0; Foresight is the only non-stacking type.
- `sim.test.mjs`: `simCounts` pinned with whole Foresight values and best-ring-only (+ one test with a stacking Foresight
  type for the float-epsilon case) and one with the real config (base, +1 per point up to the max, best ring on top);
  `pruneDominated` (plain vs gem chest, different gems both stay, identical items keep the lowest id, trade-offs stay),
  `searchLoadout` (equals `bestLoadout` on small cases, exact up to `maxExactCombos` inclusive, one type at a time above
  it, `evaluated` <= `searchPasses` x items + 1, early stop, start item rule, nothing to choose = nothing simulated),
  `loadoutEval`, usage keyed by ids, `res.wins`, and `shownMargin` (25/25 and 0/25 -> 14, 2 x se when larger, never below
  1, null without fights). Tests that need two swords to be a real choice use `TWO_SWORDS` (a strong plain sword and a
  weak emerald one): a plain copper sword next to an iron C sword is dominated and pruned now.
- `gear.test.mjs`: R21 position rule for each material pair and `A_N < D_{N+1}` (from CONFIG), `gearPower`, `shownDurability`
  (the plan's cases and a sweep over every stored value), `worstWear`, `couldBreak` (pinned wear, equal = true, sweep),
  `GEM_MATCH`, `gearMatchNotes` (visible High only, nothing for hidden / Normal / Low, nothing leaks from `enemy`).
- `enemies.test.mjs`: tier bases non-decreasing with a strict step, Low <= Normal <= High, Low = 0 for the four specials and
  four resistances, core stats stay small, growth only touches HP / damage / ratings.
- `durability.test.mjs`: an item at 0.1% fights exactly like one at 100% (same seed, same log) and is destroyed after; an
  item at exactly the worst wear is destroyed, one above survives. `game.test.mjs`: `report.used` / `notUsed` snapshots
  (SLOTS order, durability before the fight, own copies, home gear in neither), `analysis` / `planEstimate` null,
  `ringTotals`, and `resolveBattle` with 3 items per type stays within the search bound (32 combinations are all tried).
- `spec-guards.test.mjs`: no "Rating growth" / `ratingMult` in endday.js, Help does not read `growthPerDay` or `growth(`,
  no raw decimal durability printing in the gear screens, no `marginPts`, `resolveBattle` uses `searchLoadout`, one
  `gearPower`; a B3 "request pins" test (R6, R40, R41, head start 50, A2 5 x 5 with at most +5 = 10 x 10) - the same
  documented exception to "tests never hard-code CONFIG numbers" as in B1 and B2.
- `ui-render.test.mjs`: no growth text on any screen, "Low · none" and fight-day Accurate / Evasion chips (every rating chip
  checked), whole-number durability in the Workshop, Adventurer tab, plan, today's packed list and the report, whole-number
  wear text, the new estimate wording and the Foresight "only your best ring counts" text.
- Hand-checked in headless Chromium at 1280 and 390 px: the plan screen with worn gear (durabilities 63 / 99 / 12 / 1%), the
  roster with "Low · none" and fight-day ratings, Estimate all in a real DOM (100% ± 14, usage by ids), confirm, end day and
  the report, the Adventurer tab, Workshop, Rings and Help: no console errors, no horizontal overflow.

**Batch 4 (banners, intel multipliers and gate, automatic win estimate, plan screen)**
- **`estimateKey(state, scope, enemyIndex, cfg, counts)` has no `groupSig`.** The plan lists `groupSig?` in the key; the banner
  changes nothing about a fight, so putting it in would recompute estimates for no reason. A test pins that the banner and an
  item's wear are not part of the key. The key is `[seed, rosterDay, enemyIndex, sorted gear ids, sorted ring ids, visible
  `attr:level` pairs, samples, evalFights, fightsPerLoadout]`; the plan screen and the Adventurer tab share results when their
  gear and rings are the same (the screen id is not in the key).
- **`js/ui/estimates.js` API.** `scheduleEstimates(ctx, scope, { immediate })`, `cancelEstimates`, `cachedEstimate` as in the plan;
  `scope` also carries `selected` (the chosen enemy, worked out first; not part of the key). Extras: `clearEstimates` (cancel +
  empty the cache; main.js `newGame` calls it), `estimatesPending`, `estimateStatus` ("Estimating 3 of 7…"), `estimateCell` (moved
  here from endday.js), `whenEstimatesDone` (tests), `DEBOUNCE_MS` 300. State lives in `ctx.ui.est_*` (`est_cache`, `est_run`,
  `est_timer`, `est_scope`, `est_roster`, `est_first`). The default start is at once for the first run of a roster and after the
  debounce for later changes; the plan screen also passes `immediate` for the first render of a roster. Finished enemies are painted
  into the open roster table in place (`.rt td[data-est]`, `.est-status`); the chosen enemy's finish and the end of a run re-render
  the screen once. A run is not cancelled when the player leaves the tab (it is cheap and its results are cached for when they
  come back); the plan confirm and a new game cancel it. An estimate is not shown while it is being redone: its cell says "…".
- **`defaultPack(state, cfg, tier = null)` returns item ids** (not items) and passes `tier` to `couldBreak` (null = the toughest
  tier). When every item of a type could break, the best ones are packed anyway. `leaveWornHome(state, ids, cfg)` also returns ids.
  The Adventurer tab's estimate uses `defaultPack(state)` and the worn adventurer rings.
- **`confirmPlan` takes `plan.shownEstimate` from the UI** (`{ winPct, margin }`, anything else becomes null) and stores it in
  `state.plan.shownEstimate`; `resolveBattle` copies it to `report.planEstimate`. The gate message is checked after the phase check
  and before the plan check ("Spend your intel point first (Intel, at the top of this screen).").
- **Pack-limit message.** `validatePlan` says "At most 3 swords." (plural from `slotNoun`: swords, chests, helmets, pairs of gloves,
  pairs of boots); the 1.2 text "At most 2 items per slot (sword)." is gone.
- **Extra report fields:** `report.groupDefeats` (that banner's wins after the reward win) and `report.groupLimit` (the pack limit of
  the rewarded type), besides `groupReward` / `enemy.group`, so the pack-mule sentence stays right in an old report
  (`groupRewardText(report)` in `js/core/groups.js`, also logged). `bannersLine`, `bannersText` (the story, also Help) and
  `bannerLabel` live in groups.js too.
- **Tier points (U3).** B4 adds none: the new Banner row and the rewritten confirm bar have none ("Fight Orc Brute (elite)
  tomorrow", not "+25 pts"). The ones that were already there (roster Tier row "+10 pts", enemy card, the Today panel, report "+N
  points", Help) are still B5's to remove.
- **Confirm dialog** also says "The win estimate for X is not finished yet." when the chosen enemy has no result (for example with
  estimates off), and "N packed items could break in this fight: ..." uses `couldBreak` against the chosen tier for the packed items
  (items that stay unused do not wear, so this is the worst case, as the plan words it). The "Pack nothing" button stays next to the
  plan's two buttons.
- **Gear step.** Three columns (Pack, Item and stats, Durability); the one icon slot sits at the END OF THE DURABILITY CELL (a fixed
  22 px after the number, so the bars line up; `data-flag` is still on the icon). The first build had a 4th column, which put the
  icon 16 px (390 px screen) / 46 px (360 px) outside the scroll box; under 600 px the gem now wraps under the item name
  (`.adv-gbase` / `.adv-gem` keep "C Iron Sword" and "+Topaz C" whole) and the bar gives way, so the table is 328 px wide in a 328
  px box at 390 px and 298 px at 360 px (measured in Chromium). The icon is ⚠ for could-break or a sword gem blunted by a
  visible High resistance (the legend says both: "or a sword gem blunted by a High resistance you can see"; plan 4.14 only names
  could-break, kept as a deviation because a blunted gem is worth a visible cue), ✓ for an armor gem that answers a visible High
  special, with everything in the hover (`white-space: pre-line` popover shows the lines). The plan intro says the pack limit the way
  the gear step does ("You can pack up to 2 per gear type (3 swords: pack mule)", one `packLimitText`). "Your answers" covers the five gem matches (Accurate / emerald too, as `GEM_MATCH`). The 1.2
  red "could be destroyed" line under the table is gone (replaced by the icons), and `durabilityNode(g, cfg, wear, risky)` (Adventurer
  tab) now takes the could-break flag from `couldBreak` against the toughest tier.
- **Intel panel.** With a spendable point: highlighted panel, grid of `name value → next [Spend]` (2 columns, 1 on phones), tip from
  `intelTip` (desc + "Elites 90%, champions 80% of this." / "Better ring grades are harder to see: ..."); without one, the one
  line. A point on a track-less config (everything maxed) shows "every track is at its maximum" and does not block. The Skills tab
  lists the same rows with the same tips and "Spend points before you start the next day."
- **Hidden ring grade.** The enemy card and the roster cell say "Given that it is hidden: C 55%, B 33%, A 12% (better grades are
  harder to scout)." from `hiddenGradeOdds`; the plain tier odds are no longer shown for a hidden grade.
- **Help (B4 parts only).** New "Banners" section (the plan's story from config), the "Estimate all" sentences are now "worked out by
  itself", the intel section has the spend-first rule, the tier / grade multipliers and Banner scouting; "pack up to N per gear
  type". B5 still owns the full pass. The Help attribute table no longer calls Fast Normal "none" (B3 open note).
- **Bot (tools/balance.mjs, 8.2 B4).** Packs `packLimit` per type; `spendIntelPoints` follows the careful list `[['enemySight', 40],
  ['simDepth', 3], ['groupSight', 50], ['oreSight', 30], ['*']]` (in `botParams` until the personas of B6) and always spends every
  point; EV = `p/100 x (score + future + ringValue + bannerBonus)`. `ringValue` = ring value x weight (`ringW` win % per unit for
  adventurer rings, `smithW` for smith rings) x `ringPoints` (new, 1 point per weighted unit: the plan gives no scale; B6/B7 may
  retune), averaged over the types and grades a hidden ring could be (grades through `hiddenGradeOdds`); `bannerBonus` 10 when the
  enemy's banner is visible and is the bot's most-beaten one. `--ablate intel` now sets every track's gains to `[0]` in memory
  (nothing can be spent, so the gate stays open) instead of "never spend". The bot section prints pack mules earned per run.
- **Saves.** A same-version save written by the B3 tree has no `groups`, so `assertShape` rejects it (backed up, new game), like the
  B2 note. No release has shipped 2.0.
- **Earlier open notes fixed here (cheap, inside this batch's files):** "9-9s" in the Matchup time range (`fmt` compares the rounded
  numbers); "1 attributes hidden" grammar; the plan screen's could-destroy threshold line (replaced by the icons); Help Fast "none";
  the touch popover no longer opens on an enabled button / checkbox (`installTips`) and `[data-tip]` buttons keep the hand cursor;
  dead CSS `.mv-empty`, `.mv-group`, `.mi-sched`, `rt-sect-names` removed.
- **Batch 4 open notes**
  - [minor] README still describes the 1.2 plan screen ("Estimate all", pack 2 per slot, 10 x 10) and CHANGELOG has no 2.0 section
    (B7). The `Estimate all` guard in `tests/spec-guards.test.mjs` covers js and css only.
  - [minor] The bot's `ringPoints` 1 and `bannerBonus` 10 are untuned guesses; with them the careful bot picks about 15% elites and
    85% champions on days 11-30 (--quick, 3 seeds): look at it with the real benchmark in B6/B7.
  - [minor] Review fixes: the sticky confirm bar says the unspent-point sentence once ("You have 1 intel point: spend it before you start
    day 6."); the capitalised "Spend your intel point on a track below." now opens the Intel panel's text instead (the Batch 4
    ui-render test and the plan's "contains 'Spend your intel point'" read the whole screen). The bar is 128 px at 390 px (B3: 94 px,
    first B4 build: 144 px), 164 px at 360 px (first build 181 px).
  - [minor] Review fixes: a screen puts a scroll box back through `restoreScrollLeft` (js/ui/dom.js) and the tip popover's scroll
    listener skips that one event (`isRestoredScroll`). A first tap on a hover chip inside an unselected roster column selects the
    column, which re-renders the plan and restores `.rt-scroll`; that used to close the popover at once (measured at 390 px with
    touch: hidden after the first tap, shown after the second; now shown after the first). Checking "only set scrollLeft when it
    differs" was not enough: a re-rendered box is a new element that starts at 0, so the position always differs.
  - [minor] The roster's row-header hovers (Tier, Base HP, ..., Banner, Win estimate) are `title` only, so a phone cannot read them (the
    Banner "?" chip and the cells use `tip`). The Win estimate hover now says its own screen's gear (`opts.estimateTip`). Not
    changed here: giving every row header `tip()` is a one-line change for B5's pass.
  - [minor] A run keeps going when the player leaves the Adventurer tab; the final re-render then redraws whichever tab is open
    (harmless, but it does re-render once).
  - [minor] Hand-checked in headless Chromium (1280 and 390 px): Adventurer tab and plan screen fill the estimate row by themselves,
    the plan reuses the Adventurer tab's results, spending a point and ticking gear restarts it, Confirm passes the shown estimate to
    the Today panel and the report, no console errors, no horizontal overflow. The touch popover on the ⚠ / ✓ icons was not tapped
    on a real touch device.

**Tests (B4)**
- New: `tests/groups.test.mjs` (banners: a win counts, a draw / loss does not, a pack mule per `defeatsPerReward` wins of the most-
  beaten banner, distinct random types, never more than `maxExtraPerType`, 5 in all, seeded sequence, report fields and text,
  `groupProgress`, `bannersLine`, save roundtrip; pack: `packLimit`, `validatePlan` with and without a pack mule, `defaultPack`
  order / could-break / tier, `leaveWornHome`), `tests/present.test.mjs` (`estimateKey` changes with gear, rings, visible attributes
  and counts and not with the chosen column, the screen, wear or the banner; estimate texts; `gearAnswers`),
  `tests/estimates.test.mjs` (starts by itself, cached by key, same numbers as `estimateWinChanceSync`, selected enemy first, debounce
  and cancel on a changed selection, `cancelEstimates`, new roster clears, `estimates: 'off'`, intel makes only the changed enemies
  stale, `estimateCell`).
- Updated (section 11): game.test (newGame `groups`, validatePlan via `packLimit`, confirmPlan plan shape, the intel test spends each point
  before the next confirm, fields-unchanged test spends too, rosterView pins `tierMult` 100), enemies.test (visibility test enemy has a
  tier and ring; the base-chance test is tier-weighted; new tier / grade multiplier, `groupVisible`, `hiddenGradeOdds`, roster banner
  tests), playthrough.test (unspent point blocks and changes nothing, then spends; `packLimit`; banner invariants).
  Not in section 11, same R45 reason: `durability.test.mjs` (two confirms after day 5 spend the point first, via the new
  `spendAllIntel` in helpers.mjs); `ui-render.test.mjs` 'a Low special reads none' (makes the attributes visible by setting the
  rolls to 0: max intel no longer shows a champion's attributes), the Spend-button text, and the Adventurer durability cell text
  (the ⚠ icon).
- ui-render: Banner row and line, plain Defense section row, no "Estimate all" on any screen, unspent point text / highlighted
  panel / disabled Confirm / Spend buttons, "…" then % with estimates on (and the Adventurer tab shows the same), gear step headers,
  pack mule limit, ⚠ / ✓ icons and their hovers, "Your answers", banner chips and the "?" tip, hidden-grade odds, Adventurer tab
  banners / estimate / "Your plan showed", report banner and pack-mule line, Confirm dialog texts and `shownEstimate`, Help banners.
- Review fixes (B4): estimates.test derives the roster size, the chosen enemy and the enemies it compares from the state (no 7-enemy
  assumption, no empty `DEBOUNCE_MS > 0 && s` assert); groups.test pins `maxExtraPerType: 1` with `cfgWith` where distinct rewards are
  claimed and derives the "each type exactly maxExtraPerType times" check (both files also pass with a 1 / 4 / 3 roster and
  `maxExtraPerType: 2`); ui-render: three gear columns with the icon in the durability cell, the legend, the plan intro pack-mule
  wording, the Win estimate hover per screen, the confirm bar sentence once, `restoreScrollLeft` / `isRestoredScroll`; spec-guards: no
  direct `scrollLeft =` in js/ui, the popover scroll listener uses `isRestoredScroll`. The plan screen's "whole number" durability
  test strips the icon glyph (as the Adventurer tab's already did).
- spec-guards: no "Estimate all" / `startEstimateAll` / `cancelRun` / `plan_est` in js and css, only estimates.js calls
  `estimateWinChance`, no `namesRow`, packLimit / `canSpendIntel` / `recordDefeat` wiring, visibility only through the multiplier
  helpers, no tier points on the new rows, and a B4 "request pins" test (R13 three banners / 4 wins / +1 per type; R22 and R23 are
  checked as orderings, since the user gave no numbers).
- **Batch 4 open notes (minor review findings)**
  1. [minor] The end of an estimate run redraws whichever tab is open, losing focus and typed text. `js/ui/estimates.js`
     `runJobs`, `finally { ... if (!run.cancelled) ctx.rerender(); }`, plus the mid-run rerender for the chosen enemy. A
     run keeps going after the player leaves the Adventurer tab and rebuilds `#main` for whatever tab is open. Measured
     with `scratchpad/v2/review/rerender2-rr.cjs` (plan5 save, daytime): open Adventurer, switch to Log, type 'Copper
     ore' in the filter; the field ends with 'C' or 'Co' and focus on BODY. Without visiting Adventurer it keeps the
     text. A run took 191 ms; with 10x10 counts and more gear it is longer. The earlier "harmless" is not quite true.
     Expected: when the screen that started the run (`est_scope.id`) is not on screen, only update the cache and
     `paint()`, with no full re-render.
  2. [minor] Going back to a cached selection leaves the old run going, so the status says 'Estimating 1 of 7...' over
     finished numbers. `scheduleEstimates`: when `jobsFor(current scope)` is empty it clears the timer and returns but
     does not cancel `ctx.ui.est_run`. Repro: `scratchpad/v2/review/node/stale.mjs` (A finishes, switch to B and wait
     out the debounce, switch back to A): `estimatesPending` true, status 'Estimating 1 of 7...', B's run still going,
     one extra rerender at its end. Plan 4.9: one run at a time, jobs = enemies without a cached result for the CURRENT
     key. Expected: cancel a run whose sig differs from the current scope even when the current scope needs no jobs.
  3. [minor] The warning icon also marks a blunted sword gem, not only gear that could break (documented deviation).
     `js/ui/endday.js` `gearFlag`: `if (n.kind === 'warn' && !icon) icon = 'warn'`. Plan 4.14: ONE icon slot (warning =
     could break against the chosen enemy, else the toughest tier; check = its gem answers a visible High special), and
     the blunted note belongs in the hover. In play (plan5 vs Orc Brute) a 100% 'D Copper Sword +Topaz C' shows the same
     icon as the 3% helmet that could break; only the hover tells them apart. R11 asks for a warning next to gear that
     could break. The legend explains it. Expected: no icon for a blunted gem (hover only), or a different glyph.
  4. [minor] Adventurer tab gear table does not fit at 360 px (fits at 390). Measured with
     `scratchpad/v2/review/adv-rr.cjs` (plan5 save, after confirm). At 390 px the table is 328 px in a 328 px box; at
     360 px it is 325 px in a 298 px box, so the 'Packed (away)' / 'Home' column is cut off by 27 px and needs a
     sideways scroll (the warning icon is still visible, no page overflow). Contributing cause: `durabilityNode` adds
     the 22 px icon slot on could-break rows only (`css/ui-adventurer.css .adv-geartable .adv-dur span.adv-flag`), so
     bars on risky and safe rows do not line up. The shared `gearTable` is batch 5's (plan 4.18); FYI.

## Session log
- Session 1: built engine, UI, docs, tests, balance tool.
- Session 2 (commits fb1edcc → 22b062f): attack-bar combat model (fixes slows that never applied),
  relative pierce resistance, field regrowth, smaller skill bonuses with per-material XP, phase checks,
  draw handling; tests updated; balance tool finished (`--set` with wildcards, `--ablate`, SUMMARY lines);
  balance pass (enemy tiers/defense, growth 3%/1%, ore mix by distance, 2 searches per cell, regrowth
  5%/night, processing times, sword gem rebalance, enemy scouting base 10); plan screen Matchup table,
  reference tabs during report/plan/game over, paired attribute table in Help, debris skill 0.5/level.
  (Search depth, regrowth and skill values were changed again in session 3.)
- Session 2 docs refresh: BALANCE.md rewritten against the current code (all examples recomputed with
  the core modules, Appendix A/B/C regenerated, "Balance targets and current results" with bot runs and
  ablations); README (commands, balance flags, GitHub Pages steps), SPEC and this file updated.
- Session 2 review fixes (commit 86c4cab+): reviewers (spec, core correctness, E2E browser playtest) with
  adversarial verification. Fixed: drop-search-pickup time exploit (pickUpLimit), smith ring lock,
  ore sight wasted on finished cells, plan ring selection sync + today's ring preselect, confirmations
  (End day with time left, risky plans), per-item pick-up, formatDuration rounding, grammar, stat units,
  favicon, phone-width overflow on the battle report. 215 tests pass.
  Not changed (raise with the user): exact-grade repair materials make high-grade/infused gear hard to
  keep repaired; repairs rarely matter because the best gear is packed nightly. (Both addressed in
  session 3.)
- Session 3 (commits 4f45334, 5bcae94): user adjustments. Core: search 35% ± 5 per cell
  (`searchRandomness`, `searchEfficiencyRange`), regrowth off (`regrowPctPerDay` 0, mechanism kept),
  skills at C-ring strength (0.6 / 1.2 / debris 5 / grade 0.3 / fail 0.5 per level), free night repairs
  (`isNight`), higher-grade repair substitutes (`repairPlan`, `substituteWarning`). UI: Repair buttons with
  substitute warnings on the battle report and plan screen (`repairui.js`, shared with the workshop), the
  per-cell search range on the map, skill-vs-ring text in Help and Skills, long enemy names no longer widen
  the battle report on phones. Pacing re-tune: `lootChance` 50/5/80, `itemCountWeights` 30/40/30. Balance
  tool: the bot repairs at night, new "Map supply" table, `--immortal`. 235 tests pass.
- Session 3 docs refresh: BALANCE.md, SPEC.md, README.md and this file updated to commit 5bcae94 (every
  changed number, formula, worked example and table recomputed with the core modules); balance results
  regenerated (`--section economy`, `--section power`, `--section bot --seeds 40`, plus `--immortal`, all
  five ablations and a regrowth-5% what-if at 40 seeds).
- Session 4 (commit 1e53a91): user request "Champions shouldn't have higher HP, damage, or defense than
  the elites or normals. The win rate is too low." All three enemy tiers now share base HP 80, damage 8,
  defense 20% (25% since 1.2) (`CONFIG.enemies.tiers`); tiers differ only by attribute levels, score and ring grades.
- Session 4 docs refresh: BALANCE.md, SPEC.md and this file updated to commit 1e53a91 (enemy tier tables,
  quick levers, enemy section, defense/pierce/magic examples, matchup example, Appendix A/B/C, gem/ring/
  slot value tables, "Balance targets and current results"); results regenerated (`--section power`,
  `--section bot --seeds 40`, `--immortal`, all five ablations and the regrowth-5% what-if at 40 seeds;
  economy re-run, unchanged). Worked examples recomputed with the core modules. README needed no change.
- Session 5 (commits e8886d2, 247909d; version 1.1): six user change requests (see "Decisions from the
  user, session 5"). Core: field piles with a carry choice when leaving (`setCarry`, `defaultCarry`,
  `moveToPile`, `takeFromPile`; `projectedLoad` for the walk-home check; removed `pickUp`, `dropItem`,
  `pickUpLimit`, `clearDebris`, ground items and `loadMark`), debris cleared by searching (thickness
  20–60, effort × (1 + debris skill %) clears first, leftover searches the cell; debris skill +10%/level,
  XP 1 per point), 1 boulder per field (never searchable, left out of progress), gem cutting novice →
  master tables (`blendCutTable`; the gem grade skill = % of the blend, the cutting skill lowers F, Gem luck
  on top), equal gem odds (single `gemWeights` row), `GRADE_ORDER` F, D, C, B, A, S, save v2 with
  `migrateV1`. UI: carry step, pile panel and map badges, debris numbers and boulder rocks, gem tables in
  the Workshop, version label, start-up diagnostics box in `index.html`, broken saves backed up, `||=`
  removed (older Firefox), `CHANGELOG.md`, `js/version.js`. 274 tests pass (new `tests/carry.test.mjs`).
- Session 5 docs refresh: BALANCE.md, SPEC.md, README.md and this file updated to 1.1 (fields, debris,
  boulders, piles and carrying, time rule, gem tables and skills, grade order, saves, versions/rollback,
  start-up box); every changed number and worked example recomputed with the core modules; results
  regenerated (`--section economy`, `--section power` (identical to 1.0), `--section bot --seeds 40`, plus
  `--immortal`, all five ablations, the regrowth-5% and `--carry default` what-ifs at 40 seeds, and a
  1.0-vs-1.1 bot comparison on 120 seeds). The refresh was interrupted by a usage limit and finished in
  a second pass: all four files re-checked against the code, every bot/economy/power number re-run and
  matched, two small fixes (184 sapphire cuts for level 10; debris-skill pace about 55 / 140 searches to
  levels 3 / 5).
- Session 6 (commits e446ef7, cd61042 + review fixes; version 1.2): ten user change requests (see "Decisions
  from the user, session 6"). Core: durability about 10% a fight with tier multipliers and one-decimal
  rounding (`wearLoss`, `wornDurability`) and the Gear care skill; fresh cells (`cellFresh`, +2 min each);
  `simCounts` (Battle simulation intel track + Foresight ring), `winStandardError` and a cancellable
  `estimateWinChance`; unarmed 11 / sword 16, enemy defense 25%, growth 3.5%, the four specials, gems and
  rings retuned; save v3 (`migrateV2`, legacy keys v2 and v1). UI: one Estimate all button with the ± margin,
  the roster comparison table (one enemy per column, offense rows then defense rows, names repeated at the
  Defense divider), the work-day bar, wear notes. Tools: `--section benchmark` (fixed seeds, `--jobs`,
  `--estimator`), `specials`, `estimator`; `docs/BENCHMARKS.md`. Balance tuned until the benchmark curve
  matched 1.1's. Review: reviewers and an independent verifier found nine issues (Estimate-all run hygiene,
  thin day bar, grammar, margin, phone roster, wear note, decimal durability, magic tuning, save migration),
  all fixed; 325 tests pass (new `tests/durability.test.mjs`).
- Session 6 docs refresh: CHANGELOG.md (1.2 section, save table, rollback steps), BENCHMARKS.md (final-config
  rows on 100 and 200 seeds, `--estimator bot`, the 1.1 baseline kept, "Is 10 x 10 too low?"), BALANCE.md
  (every changed number, formula and worked example recomputed with the core modules; economy, power,
  specials, estimator, bot, immortal, five ablations, the carry-default and regrowth-5% what-ifs and the
  benchmark re-run on the final config), SPEC.md, README.md and this file updated to 1.2. The refresh was
  interrupted by a usage limit and finished in a second pass.
  (Update this section each session.)
