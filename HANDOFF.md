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
