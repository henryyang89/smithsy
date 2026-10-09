# Smithsy — Handoff

Everything needed to pick this project up in a fresh session.

## What it is
Browser game: you mine ore/gems on a 7x7 world map of 9x9 fields (camp in the middle, 40 fields, 8 rocks), refine and
smith gear, repair it by day at camp, and each evening plan your adventurer's next fight (1 enemy from a roster of 7, which
you can only partly see). A loss (or End run) ends the run; the score is only shown in the run summary. Plain HTML + ES
modules, no build step, hosted on GitHub Pages, **deployed from `main`** (<https://henryyang89.github.io/smithsy/>, folder
`/ (root)`; see README). Save in localStorage, one key per version.

**Version:** this branch is **2.0** (`js/version.js`, shown in the top bar and Help). 2.0 starts a fresh game and never reads a
1.x save (A1). `release/v1.0` and `release/v1.1` exist on GitHub; `release/v1.2` and `release/v2.0` are created from `main`
after each is merged. What changed per version and how to roll back: `CHANGELOG.md`. The implementation plan is
`docs/PLAN-2.0.md` (section 1 has the user's answers U1-U3, which override defaults); the tuning record is
`docs/TUNING-2.0.md`; where the implementation differs from the plan: "Plan deviations" below. State when this was written: the
batches 1-7b are committed (the last commit is "v2.0 batch 7b"); the final review's fixes and the docs pass (7c) are
uncommitted changes on top (`git status`) until they are committed.

## Where things are
| Path | What |
|---|---|
| `js/config.js` | **Every tunable number.** Edit here to rebalance (and re-run the whole target set: `docs/TUNING-2.0.md`). |
| `js/version.js` | `VERSION` shown in the top bar and Help ('2.0'). Bump it for every release (see "Release process"). |
| `CHANGELOG.md` | What changed in each version (player terms), the save table and the rollback steps. Read it, add to it each release. |
| `README.md` | How to play, the project structure, tests, the balance tool and its flags, save data. |
| `index.html` | Page shell + a plain-script start-up diagnostics box (shows captured errors and the browser if the game has not started a few seconds after load). |
| `docs/SPEC.md` | Requirements and design decisions of 2.0 (R1-R46, A1-A4, U1-U3 cited). |
| `docs/BALANCE.md` | Quick levers, targets and results, **Known misses**, what changed from 1.2 to 2.0, what-if commands (all 2.0); chapters 1-16 and the appendices are 1.2 reference text with a "2.0:" note under each heading. |
| `docs/BENCHMARKS.md` | Difficulty of each version as survival curves: the 2.0 table (three personas, 100 seeds; careful at 200) and the 1.x history. Re-run `--section benchmark --jobs 4` after balance changes. |
| `docs/TUNING-2.0.md` | The tuning log: every config value changed, why, every target and its result, the notes on the misses. |
| `docs/PLAN-2.0.md` | The 2.0 plan: requests, answers, per-batch files and tests, targets (section 9), the 1.2 tests that had to change (section 11). |
| `js/core/` | DOM-free game logic (works in Node). `game.js` = state, day flow, battle resolution, `endRun`, save (`SAVE_KEY` `smithsy-save-2.0`, `deserialize` refuses another version's save and a save with a broken shape: `assertShape` / `assertStructure`). |
| `js/core/map.js` | World map (7x7, `maxDetour`), fields (`generateField`: debris, boulders, sight thresholds), travel (`loadOnArrival`: the walk home counts the destination's pile), search (30% ± 5, fresh cells), carrying, sight (`sightValue`, `seenItems`, `sightShare`). |
| `js/core/gear.js` | Gear stats, smithing, wear (`wearLoss`, `shownDurability`), `couldBreak` (stored value) and `couldBreakShown` (the whole numbers on screen, used by the warnings), repair by day (`repairPlan`, higher-grade substitutes), scrap (bars only). |
| `js/core/groups.js`, `pack.js` | Banners and pack mules; the packing limit per gear type and the default pack. |
| `js/core/replay.js` | The loss analysis: 500 replays of a lost fight and "would other gear have helped?". |
| `js/core/sim.js`, `enemies.js`, `combat.js`, `processing.js`, `rings.js`, `skills.js`, `intel.js`, `bonuses.js` | As their names say; `simCounts` = 5 x 5 + Battle simulation + Foresight; `intel.js` has per-track gains, `tierMult` / `gradeMult` and the plan gate. |
| `js/main.js` | UI shell: top bar with the version, the work-day bar, tabs, side log, phase screens, save/load (a save that can't be loaded is kept as `smithsy-save-backup-<time>` and a new game starts; the render-error screen backs the save up before "Start a new game"; a `storage` event from another tab locks this tab), toasts that are dropped when the phase changes. |
| `js/ui/*.js` | One module per screen; `endday.js` = battle report, plan screen, run summary; `estimates.js` the automatic win estimates; `present.js` text helpers (`marginPart`, `segPctText`, `enemySightText`); `gearlist.js` / `repairui.js` the gear list with Repair and Scrap; `inventory.js` the storage and gear overview; `dom.js` has `h()` and `tip()` (title + `data-tip`: a tap popover). |
| `tests/` | `npm test` (= `node --test tests/*.test.mjs`), **625 tests in 25 files** (+ `helpers.mjs`, `fakedom.mjs`); `spec-guards.test.mjs` pins removed names and wording, `personas.test.mjs` the balance tool, `final-fixes*.test.mjs` the final review's fixes. |
| `tools/balance.mjs` | Balance report: sections economy, power, day2, bot, benchmark, specials, estimator, intel; three personas (`--persona`), `--intel`, `--set` what-ifs, `--ablate`, `--immortal`, `--carry`. The 2.0 tool only runs on 2.0 trees; older versions are measured with the tool that shipped with them. |

## Release process
1. Bump `VERSION` in `js/version.js` (tenths for small changes, ones for big ones: user decision) and add a
   section for it to `CHANGELOG.md` in player terms (plus a row in its save table).
2. Run `npm test` (all must pass); after balance-relevant changes re-run the whole target set (the sections of
   `docs/PLAN-2.0.md` section 9, see `docs/TUNING-2.0.md` for the commands) and refresh the docs (BALANCE, SPEC, README, this
   file). The difficulty check is `node tools/balance.mjs --section benchmark --jobs 4` compared with `docs/BENCHMARKS.md`.
3. Merge into `main` through a pull request (the user allows auto-merge when the change is easy to roll back). GitHub Pages
   deploys from `main`.
4. Create the branch `release/vX.Y` from `main` after the merge and push it. Branches instead of tags, because git tags can't
   be pushed from this environment.
5. Rolling back = the steps in `CHANGELOG.md` (pull request from `release/vX.Y` into `main`, or revert the bad version's pull
   request).
6. **Saves are per version (A1).** A new version uses its own key (`smithsy-save-<version>`, `smithsy-best-<version>`), starts
   a fresh game and leaves older keys untouched: there are no migrations and no legacy keys (a guard test forbids them). A
   code-only fix may keep `VERSION`. Say so in the CHANGELOG save table.

## Decisions from the user for 2.0 (session 7)
The full request list (R1-R46) and the plan's open questions are in `docs/PLAN-2.0.md`; the answers that shape everything:
- **A1** 2.0 starts fresh; a save is only loaded by the version that wrote it (1.x saves stay in the browser and open again in
  1.2). **A2** the win estimate is automatic, 5 guesses x 5 test fights per enemy; rings and intel only add slightly.
  **A3** no night repairs: repairs by day, at camp, cost time, only on gear the adventurer does not have. **A4** scrap returns
  bars only (the repair cost share of the remaining durability); the gem is lost.
- **U1** the ranges "elite 30-50%, champion 0-25%" are for a literally unarmed adventurer on day 2; "gearing should make elites
  75-90% and champions 50-75% depending on how well the player has found or crafted their gear". **U2** harder overall (the
  careful bot's median life about 30-40 days, about 80% alive at day 10). **U3** no score numbers anywhere until the run summary
  (the tier points are hidden too).
- Everything below this block up to "Plan deviations" is the history of sessions 1-6 (versions up to 1.2): where 2.0 differs
  (5x5 map, 8x8 fields, night repairs, regrowth, Estimate all, the Return travel skill, the 1.2 numbers) the 2.0 docs above
  and the code are right.

## Design decisions (from Q&A with the user, sessions 1-6, history)
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

## Balance status (version 2.0)
Run `node tools/balance.mjs --section economy`, `--section power`, `--section day2`, `--section bot --persona careful --seeds 40`
(`--immortal` for how long the map lasts), `--section specials`, `--section estimator`, `--section intel --jobs 4` and
`--section benchmark --jobs 4`; the targets, the measured values and the **Known misses** are in `docs/BALANCE.md`, the reasons
for every value in `docs/TUNING-2.0.md`, the survival curves in `docs/BENCHMARKS.md`. Summary lines of the final config (economy,
power and estimator are unchanged by the final review's fixes and are the ones in `docs/TUNING-2.0.md`):

```
DAY2 | unarmed n/e/c 85/42/18 | elite 0H/1H/2H+ 50/40/31 | champ <=1H/2H/3H 20/17/14 | kit1 n/e/c 96/70/45 | kit2 n/e/c 98/77/53 | kit3 n/e/c 98/82/66 | T-R7 in band 5/8 | T-R7 MISS 3/8 T-GEAR MISS 1/4
SPECIALS | ref iron d12 steel d19 mythril d31 | M1 9..13 (8-20) | M2 4.7..8.8 (>=4) | M3 -4.1..-3.6 (<=-2) | M4 130..170% (>=80) | M5 C 28..45% S 26..49% (<=50/60) | M6 C max 1.3 S max 3.3 (<=3/4) | M7 -1.0 (<=0) | S-swing -8.2..-1.3 (<=0) | T-R33 ok
BOT SUMMARY | careful | alive d10:90% d20:80% d30:70% d40:38% d50:0% d60:0% d80:0% | median life 38.0 | score 618 | d2 typical true n/e/c 99/90/76 | d10-40 true e/c 85/72 | d10-40 est e/c 85/71 | first iron/steel/myth piece d3/9/21 | 3-slot iron/steel/myth d6/13/29 | d11-30 fights n/e/c 67/21/12% | mining 59% trips/day 1.2 idle 12m | d11-40 travel 28% load 8.4% of travel | repair 2.9% bars 2.6% time (d11-40 3.5%), by day only (0.7 subst., 0.0 destroyed) | skills d30 travel/carry/repair 7.9/6.4/5.3 | answer cover d25 3.6/4 | map found d40:25% d60:-% d80:-% | field: 3.20 found/search, carried 52% of found (9.9/trip, 29 from old piles), piles at end 368 (8.3 worth), debris 4.7% of effort | gems cut 133.7/run F/D/C+ 14/39/48%, 29.9 infused | T-GEAR ok T-B1 ok T-B2 ok T-B3 ok T-B5 ok T-B4 ok
INTEL | best only:oreSight | spread life 1.1d score 6% | default -1.3d | worst vs none -1.1d | seeds 100 days 60 | T-R42 ok
BENCHMARK SUMMARY | v2.0 | seeds 100 | wall 1.3 min (4 jobs) | careful life 32.5 d10 84% | champion life 15.0 d10 62% | casual life 25.0 d10 90% | T-D ok T-P MISS 1/8
BENCHMARK SUMMARY | v2.0 | seeds 200 | wall 1.0 min (4 jobs) | careful life 31.5 d10 80% | T-D ok
```

Targets met: T-E, T-B, T-D, T-GEAR (a) and (c) as a mean, T-R33, T-A2, T-R42 and all T-P rows but one. **Not met** (details and what each
would take in `docs/BALANCE.md` "Known misses"): T-R7 champion sub-bands (champions never reach the low end of 0-25: they never roll
a Low special), T-GEAR (b) elite 82 vs 85-90, T-GEAR (c) by window (gear outruns the enemies for days 3-20 and falls behind after day
30), T-MID 4 of 5, T-P careful - casual at day 20. The items marked "for the user" there (the champion low end, the early power curve,
the uneven normal-to-elite step, the flat Battle simulation steps) need a decision before anything is changed.

## Known concerns / ideas
**2.0 open items:** see "Balance status (version 2.0)" above and the "Final review pass" at the end of "Plan deviations" (which finding was fixed,
which was only documented, and why). Not fixed and worth knowing: the Adventurer tab's gear list drops to the card layout whenever its box is
narrower than 500 px (a container query), the top bar on a 360 px phone is 4 rows tall when a fight and an intel point are showing, and
`docs/BALANCE.md` chapters 1-16 still hold 1.2's worked examples (regenerate them with the core modules when time allows).

**The list below was written for 1.2** (history): the items about regrowth, night repairs, the Return travel skill, the 10 x 10 estimate and the
1.2 numbers no longer apply to 2.0.
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
  `seenItems` directly; the 1.2-era optional-export guards (`mapMod.freshCellCount`, `simMod.simCounts`) were removed in the B6 review: `cellFresh` and `simCounts` are plain imports). Economy buckets are
  1..6+ and its SUMMARY ends with `searches per clear cell`. The bot only had `intelChance` renamed (it still spends
  intel by its own short list: no R45 gate until B4) and its field search uses sight (`centerOptions`).
- **Batch 1 open notes**
  - [minor] Dead CSS left behind by the removed 1.2 UI: nothing in js/ uses `.mv-empty` / `.mv-done .mv-empty`
    (css/ui-map.css:103-104), `.mv-odds th.mv-group` (css/ui-map.css:192) or `.mi-sched` (css/ui-misc.css:77).
    Check: `grep -rn "mv-empty\|mv-group\|mi-sched" js` finds nothing. Expected: delete them. **[7b]** fixed (removed in B4; `grep -rn "mv-empty\|mv-group\|mi-sched" js css` finds nothing; re-checked in 7b).
  - [minor] Camp panel Debris row reads awkwardly: js/ui/mapview.js:419 builds `Boulders (${bMin}-${bMax}, more far
    away per field) can never be searched.` Wording only, for example "2-4 boulders per field (more far from camp)
    can never be searched." **[7b]** fixed: the row now reads "2-4 boulders per field (more far from camp) can never be searched." (`js/ui/mapview.js`; the ui-render regex follows).
  - [minor] The 'request pins' test hard-codes CONFIG numbers (documented exception to the house rule): 
    tests/spec-guards.test.mjs:103-115 asserts map.size 7, field.size 9, boulders 2-4, gemShare 15/25,
    groupSight.base 20 and oreSight.base 0. Listed in 'Tests (B1)' as deliberate; flagged so the user can accept or
    reject the exception. **[7b]** kept: the documented exception (numbers the user gave in their own words, one test per batch); the user decides whether to accept it.

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
  - [minor] `tests/sim.test.mjs:307` has two unused variables (`ring`, `ringText`) from 1.2; not touched here. **[7b]** fixed: the report is copied and `ring` / `ringText` are `delete`d (no unused bindings).
  - [minor] Help's skill table text for cutting reads "10% better cutting chances (of the way to a master cutter)" (the
    effect text in `skills.effects.cutBlend`); the hovers phrase it "better ruby cutting chances (30% of the way to a
    master cutter's)". Wording only. **[7b]** fixed: `skills.effects.cutBlend.text` is now "of the way to a master cutter's cutting chances", so Help's per-level column reads "10% of the way to a master cutter's cutting chances" and the hovers keep their own wording (`effectText`).

- **Batch 2 open notes**
  - [minor] Skills tab at 390 px: the 'Now' column and the Repair matrix column are cut off. `css/ui-misc.css:67` sets `.mi-skills { min-width: 540px }`; the scroll box is 328 px wide at 390 px, so 'Now' and part of the XP number sit off-screen (Bar types matrix 355/328 cuts 'Repair'). No page overflow; tapping a row shows the same info. Plan 4.4 wants the four columns to fit (narrower Progress, or Now wrapping under the name). Screenshot: scratchpad/v2/review/skills390.png. **[7b]** fixed in B5 (cards under 560 px, tighter matrices).
  - [minor] Touch popover stays open with out-of-date text after tapping an action button. `js/main.js:278-293` `installTips` opens `#tip` on every non-mouse pointerup in `[data-tip]`, buttons included; after an enabled 'Repair' tap the popover keeps the old text next to the toast. Fix: skip enabled buttons, or close the popover when `ctx.act` re-renders. **[7b]** fixed in B4 (`installTips` skips enabled buttons and inputs).
  - [minor] `[data-tip] { cursor: help }` (`css/style.css:106`) overrides the hand cursor on enabled buttons (`button { cursor: pointer }`, lines 74-75). Fix: `button[data-tip]:not(:disabled) { cursor: pointer; }`. **[7b]** fixed in B4.
  - [minor] `craft()` and `repair()` compute XP without `xpPerUnit` (`js/core/gear.js:147`, `252-253`), so hover/Help can disagree with XP given, and removing `repair.xp` / `repairTime.xp` from config gives NaN. Use `xpPerUnit(skillDef(key))` in both. **[7b]** fixed: both read `xpPerUnit(skillDef(key))` (smith_<bar>, repair_<bar>, repairTime); a new gear test sets a skill's own `xp` and a missing one (no NaN) and fails on the old code.
  - [minor] `travelMinutes` (`js/core/map.js:189`) repeats the `loadPenaltyPct` formula (`map.js:179-181`) instead of calling it; `tests/carry.test.mjs` was not moved onto it (section 11). Make `travelMinutes` call `loadPenaltyPct`. **[7b]** fixed: `loadPenaltyPct(state, cfg, b)` takes the caller's bonuses and `travelMinutes` calls it; `carry.test.mjs` checks the 3-item walk through `loadPenaltyPct`.
  - [minor] Some new tests hard-code default CONFIG numbers (`tests/ui-render.test.mjs` Copper sword scrap `0.42 ... 35% of its 2 bars x 60%` and smith panel `Base [\d.]+m (2 bars x \d+m)`). Pin with `cfgWith` or build the text from CONFIG. **[7b]** fixed: the smith panel test in B5; the Copper sword scrap test now pins its 2-bar sword and 35% with `cfgWith`.
  - [minor] Leftover single-item loop `for (const phase of ['work'])` in `tests/gear.test.mjs` ('repair consumes exactly what repairPlan chose...'); unwrap it. **[7b]** fixed: unwrapped (the exact-grade half of the test got its own variable names).
  - [minor] Deferred items still visible after B2 (FYI): (1) `js/ui/workshop.js:148,187-188` and `js/ui/help.js:323-352` still show level-10 values and novice/master tables (R18, B2/B5; deferral recorded). (2) Most hovers outside B2's new elements are `title`-only, so touch users cannot see them (mapview 20, endday 17, workshop 13, skillsview intel Spend button); for B5. (3) `README.md:69,116,132,175,226` still describes free night repairs; README is B7's job. **[7b]** (1) fixed in B5. (2) mostly fixed: B5 did the roster, report and Workshop hovers, 7b the top bar (clock, work-day bar, version, pile, return), the map's Sight chip / sight row / by-distance column headers / count chips, the Rings "+N if worn" and the repair previews' "Have N" (all `tip()`); kept for the rest: they sit on buttons or on clickable cells and rows, where a tap must do its action instead of opening a popover. (3) kept: README is the docs pass (7c).

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
    adventurer used" panel; the snapshots (`report.used` / `notUsed`) exist but the report layout is B5. **[7b]** fixed in B5 (report uses the snapshots).
  - [minor] `tools/balance.mjs --section estimator` still describes 10x10 / 13x13 ... sizes (B6 rewrites it for 5x5 .. 10x10). **[7b]** fixed in B6.
  - [minor] The Matchup table's "Rough time to win / to lose" can read "9-9s" (the range collapses to one number printed
    twice); pre-existing, not touched. **[7b]** fixed in B4.
  - [minor] Topaz armor fallback not applied although the measured M2 is below +4. Plan 4.7: "Topaz armor fallback if M2 < +4:
    `stunChanceRed`/`stunDurRed` `[12, 18, 24, 30, 36]`." HANDOFF records a topaz M2 mean of 3.9 (steel 3.5), below +4, but
    js/config.js gemEffects.topaz.armor stays at [10,15,20,25,30]. The deviation is written up (inside the noise, batch 7
    tunes it with the batch 6 instrument), so it is a recorded choice, but the plan's condition is strictly met. Either apply
    the fallback, or make sure batch 7 decides it explicitly. **[7b]** fixed in 7a: topaz armor is now [15,22,30,37,45], above the plan's fallback [12,18,24,30,36]; M2 measures +4.7 to +8.8 (docs/TUNING-2.0.md).
  - [minor] The lost-fight test was not given used/notUsed checks (section 11 row: "add `used`/`notUsed` asserts; `state.end`
    on a loss | B3, B5"). The day-2 win test got them (tests/game.test.mjs ~line 184); 'a lost fight is game over: no ring,
    no score' is unchanged. Expected: add `assert.deepEqual(r.report.used, [])` and `notUsed` checks, with a packed item. **[7b]** fixed in B5.
  - [minor] Help attribute table shows Fast Normal as "none", unlike the roster chip. js/ui/help.js enemySection `lvCells`
    maps value 0 to 'none' for every attribute, so Fast renders "-2 / none / 2" (confirmed with tests/fakedom.mjs). The roster
    chip says "Normal · 0%" and Fast 0 is a normal speed. Expected: leave Fast out of the 'none' rule, as attrValueText does. **[7b]** fixed in B4.
  - [minor] The 'could be destroyed' line can name a threshold that a listed-as-safe item meets. js/ui/endday.js:900 prints
    `At ${Math.ceil(maxLoss - 1e-9)}% or less, could be destroyed`, while listed items use `g.durability <= maxLoss + 1e-9`.
    Elite worst wear 13.2 and a chest at 14.9% (shown "14%"): the line reads "At 14% or less, could be destroyed if used
    against Dire Wolf: D Copper Helmet (1%)" and omits the chest. Batch 4 replaces it with the couldBreak icon; until then
    floor the threshold, or phrase it by exact wear. **[7b]** fixed in B4 (replaced by the icons).
  - [minor] Grammar in the estimate explanation: "1 attributes hidden". js/ui/endday.js estimateHow prints
    `(${nHidden} attributes hidden for ${sel.name})`; singular is needed when the count is 1. **[7b]** fixed in B4.
  - [minor] Request-pins test hard-codes a number the user never asked for: tests/spec-guards.test.mjs 'request pins (batch 3)'
    has `assert.equal(CONFIG.combat.startFillMax, 50, ...)`. That is one of the changes the user did not ask for (section 13),
    so it goes beyond the documented pins exception. The other pins trace to user requests. **[7b]** fixed: the `startFillMax` pin is gone from `spec-guards.test.mjs`; `combat.test.mjs` already checks the head start is on (`> 0`, `<= 100`) without a number.
  - [minor] Report wear numbers are rounded separately, so they may not add up. js/ui/endday.js:502-503 shows
    `-${Math.round(w.loss)}%` and `${durText(w.left)} left`, with the starting durability floored: 63.9 before shows "63%",
    loss 10.5 shows "-11%", 53.4 after shows "53% left" (63 - 11 = 52). Cosmetic; batch 5's report rework could show the loss
    as the difference of the shown values. **[7b]** fixed in B5 (the loss is the difference of the shown values).
  - [minor] README still describes the 1.2 estimate size: README.md:128 "(10 guesses of the hidden attributes x 10 test
    fights each)" and line 237 "estimator (v1.2) ... at 10 x 10"; the game now uses 5 x 5. Reminder for batch 7's docs pass. **[7b]** kept: README is the docs pass (7c).

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
  `gearPower`; a B3 "request pins" test (R6, R40, R41, A2 5 x 5 with at most +5 = 10 x 10; the head start 50 pin was removed in 7b: the user never asked for that number) - the same
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
    (B7). The `Estimate all` guard in `tests/spec-guards.test.mjs` covers js and css only. **[7b]** kept: README / CHANGELOG are the docs pass (7c).
  - [minor] The bot's `ringPoints` 1 and `bannerBonus` 10 are untuned guesses; with them the careful bot picks about 15% elites and
    85% champions on days 11-30 (--quick, 3 seeds): look at it with the real benchmark in B6/B7. **[7b]** kept: tool settings, not game numbers; B6 measured that the champion rule makes them matter little.
  - [minor] Review fixes: the sticky confirm bar says the unspent-point sentence once ("You have 1 intel point: spend it before you start
    day 6."); the capitalised "Spend your intel point on a track below." now opens the Intel panel's text instead (the Batch 4
    ui-render test and the plan's "contains 'Spend your intel point'" read the whole screen). The bar is 128 px at 390 px (B3: 94 px,
    first B4 build: 144 px), 164 px at 360 px (first build 181 px). **[7b]** fixed in the B4 review.
  - [minor] Review fixes: a screen puts a scroll box back through `restoreScrollLeft` (js/ui/dom.js) and the tip popover's scroll
    listener skips that one event (`isRestoredScroll`). A first tap on a hover chip inside an unselected roster column selects the
    column, which re-renders the plan and restores `.rt-scroll`; that used to close the popover at once (measured at 390 px with
    touch: hidden after the first tap, shown after the second; now shown after the first). Checking "only set scrollLeft when it
    differs" was not enough: a re-rendered box is a new element that starts at 0, so the position always differs. **[7b]** fixed in the B4 review.
  - [minor] The roster's row-header hovers (Tier, Base HP, ..., Banner, Win estimate) are `title` only, so a phone cannot read them (the
    Banner "?" chip and the cells use `tip`). The Win estimate hover now says its own screen's gear (`opts.estimateTip`). Not
    changed here: giving every row header `tip()` is a one-line change for B5's pass. **[7b]** fixed in B5 (`tip()`).
  - [minor] A run keeps going when the player leaves the Adventurer tab; the final re-render then redraws whichever tab is open
    (harmless, but it does re-render once). **[7b]** fixed in 7b (see numbered note 1: a run only redraws the screen that started it).
  - [minor] Hand-checked in headless Chromium (1280 and 390 px): Adventurer tab and plan screen fill the estimate row by themselves,
    the plan reuses the Adventurer tab's results, spending a point and ticking gear restarts it, Confirm passes the shown estimate to
    the Today panel and the report, no console errors, no horizontal overflow. The touch popover on the ⚠ / ✓ icons was not tapped
    on a real touch device. **[7b]** the touch popover on the warning icon is now checked: with touch emulation at 390 px a tap on the plan screen's warning icon opens the popover with its "Could break ..." lines (7b).

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
     `paint()`, with no full re-render. **[7b]** fixed in 7b: `scheduleEstimates` marks `ctx.ui.est_screen`, `render()` clears it, and a run only calls `ctx.rerender()` while its own screen is the one shown (otherwise it paints). Repro (`rerender.cjs`, plan6 save, Adventurer then Log, type "Copper ore"): before, focus on BODY and "C"; after, focus kept and the full text. Two new estimates tests.
  2. [minor] Going back to a cached selection leaves the old run going, so the status says 'Estimating 1 of 7...' over
     finished numbers. `scheduleEstimates`: when `jobsFor(current scope)` is empty it clears the timer and returns but
     does not cancel `ctx.ui.est_run`. Repro: `scratchpad/v2/review/node/stale.mjs` (A finishes, switch to B and wait
     out the debounce, switch back to A): `estimatesPending` true, status 'Estimating 1 of 7...', B's run still going,
     one extra rerender at its end. Plan 4.9: one run at a time, jobs = enemies without a cached result for the CURRENT
     key. Expected: cancel a run whose sig differs from the current scope even when the current scope needs no jobs. **[7b]** fixed in 7b: `scheduleEstimates` cancels a run whose signature differs from the current selection even when the current selection needs no jobs; new test (status null, no extra redraw).
  3. [minor] The warning icon also marks a blunted sword gem, not only gear that could break (documented deviation).
     `js/ui/endday.js` `gearFlag`: `if (n.kind === 'warn' && !icon) icon = 'warn'`. Plan 4.14: ONE icon slot (warning =
     could break against the chosen enemy, else the toughest tier; check = its gem answers a visible High special), and
     the blunted note belongs in the hover. In play (plan5 vs Orc Brute) a 100% 'D Copper Sword +Topaz C' shows the same
     icon as the 3% helmet that could break; only the hover tells them apart. R11 asks for a warning next to gear that
     could break. The legend explains it. Expected: no icon for a blunted gem (hover only), or a different glyph. **[7b]** kept: a documented deviation (the legend names both reasons and a test pins it); hover-only would leave a sword gem blunted by a visible High resistance with no cue, and a second glyph needs a plan change (4.14 has one icon slot).
  4. [minor] Adventurer tab gear table does not fit at 360 px (fits at 390). Measured with
     `scratchpad/v2/review/adv-rr.cjs` (plan5 save, after confirm). At 390 px the table is 328 px in a 328 px box; at
     360 px it is 325 px in a 298 px box, so the 'Packed (away)' / 'Home' column is cut off by 27 px and needs a
     sideways scroll (the warning icon is still visible, no page overflow). Contributing cause: `durabilityNode` adds
     the 22 px icon slot on could-break rows only (`css/ui-adventurer.css .adv-geartable .adv-dur span.adv-flag`), so
     bars on risky and safe rows do not line up. The shared `gearTable` is batch 5's (plan 4.18); FYI. **[7b]** fixed in B5.

**Batch 5 (player-facing UI: workshop, gear list, inventory, battle report and loss analysis, combat log, score, top bar, Help)**
- **New files:** `js/core/replay.js` (loss analysis), `js/ui/inventory.js` (Storage and gear), `js/ui/gearlist.js` (the shared `gearTable`),
  `tests/replay.test.mjs`. `renderGameOver` is now `renderRunSummary` (tab label "Run summary"). New config blocks `display` and `report`.
- **`endRun` returns `{ ok: true }` without a message** and writes the log line itself ("Run ended on day 23: you retired the adventurer. Final
  score 485."): `ctx.act` logs a returned `msg`, so a message would have been logged twice. `state.end` for a lost fight is set in `endDay` (next to
  `phase = 'over'`), not in `resolveBattle`, so a tool or test that calls `resolveBattle` directly gets no `end`. `recordBest()` (main.js) stores
  `end.prevBest` once, only when `localStorage` can be read; with storage blocked `prevBest` stays unset and the summary does not claim "New best
  score!". A same-version 'over' save without `end` (written by the B4 tree) is worked out from the last report by `renderRunSummary`.
- **Loss analysis (`js/core/replay.js`).** `replayStats` returns the five parts as COUNTS (`seg`), `outcomeSegments` (present.js) turns them into
  percentages. The analysis is a generator, so `analyzeLossSync` and the async `analyzeLoss` give identical numbers; `analyzeLoss` calls
  `onProgress(1)` at the end and returns `null` when `onProgress` returns false. Candidates are the report's `used` and `notUsed` snapshots plus the real
  `homeGear` (so a destroyed used item is still tried); `whatIf.items / fromHome / replaced` are snapshots (no `packed` flag). `cacheAnalysis`
  (new helper) keeps the result on `report.analysis` and on the matching `state.battles` entry (after a load they are separate objects). The screen
  starts the work the first time a lost report is shown (`ctx.ui.loss_run`, cancelled by a new game through `cancelAnalysis`); `ctx.ui.analysis === 'off'`
  turns the automatic start off (render tests). The analysis panel appears once: in the run summary above "The fatal battle" (whose report is shown with
  `analysis: false`), and inside a lost report in the Log tab.
- **Score words.** The plan says work-phase screens contain no "Score", but Help has a "Score" section (4.19), so the render guard checks the Rings,
  Map, Workshop, Adventurer, Skills, Log screens and the plan / report screens for the word, and Help for score NUMBERS (`+25 pts`, `score 85`,
  "N points per ..."). The run summary shows the points per tier (`scoreBreakdown`, the one reader of `tiers[].score` in js/ui); the roster Tier row,
  enemy card, Today panel, report header and Rings "Score" column no longer have them. Help's Score section says tougher tiers are worth more, with no number.
- **Workshop.** Smith form: tiles for gear type, material, bar grade, gem and gem grade (no `<select>`). A material tile's small line lists the grades in
  stock ("D 5 · C 2"), dashed when no grade has enough bars. The "gem grade (reference)" buttons moved into the closed "Compare all gear types and gem
  effects" `<details>` (the plan has no place for them once the grade row only shows with a gem). Refine / cut rows are `Bar | Needs | Outcome chance |
  You can make | Time each | buttons`; the outcome hover for a gem says "Chances for a first-time cutter" (`cut[gem].novice`), the time hover says "Base 20m.
  Your skills and rings make it faster (see Skills)." Result box: `ws_last = { area, tone, msg, bold }`; the action result carries `tone` and `ctx.act` toasts
  `res.tone || (ok ? 'ok' : 'err')`; the log gets the batch message ("Copper: refined 5 in 1h 15m: 3 bars (D 2, C 1), 2 of 5 failed (ore lost)."), without bold.
- **Repair all is back, by day only** (`repairAllInfo` / `repairAll` in `js/ui/repairui.js`, a UI helper; B2 had removed the night version). The label's
  count and minutes come from a preview that counts the bars down item by item and skips what does not fit (so a cheaper later item may still go);
  the real run repairs the same list in order through `repair()` and stops at the first failure. The minutes can differ by a fraction (a skill level
  gained from the first repair makes the next one faster: measured 53.2m shown, 52.6m done).
- **Gear list on the Adventurer tab has the inline Repair button too** (R24 lists both screens; the plan text of 4.13 / 4.18 only says "scrap off"), plus the
  could-break flag against the toughest tier. The Workshop passes `blocked` ("Workshop closed: ..."); the Adventurer tab lets `repairCheck` give the reason
  (not at camp / not during the work day). The old "Where" column is folded into the durability cell ("63% · with the adventurer today").
- **Report wear** is shown as the difference of the two shown durabilities (B3 open note), so "63% - 11% = 52% left" always adds up; a destroyed item shows
  "-<shown before>%" and "Destroyed". The roll detail ("rolled 8% x 1.10 ...") stays under the name.
- **Combat log.** One `<table class="clog">` with a `<colgroup>`; `combatLogRows` gives the rows (all of them; the 1000 / 300 trimming and the gap row stay in
  the screen). Effects text is compact ("Stun 1.5s", "Slow 5% 2.5s"). Under 640 px the Effects column is collapsed to zero width and its text is added to
  Result (which may wrap), and the muted magic detail is hidden. Checked in Chromium at 390 px: no page overflow, the HP columns stay aligned.
- **Help (4.19).** Sections: Time, World map & travel, Fields searching & sight, Workshop, Gear repairs & scrap (gear + gem infusions + durability),
  Adventurer & combat (kept: it holds the formulas; not in the plan's list), Enemies, Banners, Win estimate (new; moved out of Combat), Intel (a live table:
  Now and Next point per track, no schedule), Skills, Rings, Score (new). No novice / master tables, no gem blend table, no level-10 values, no tier points,
  no "night" (rings text reworded); the skill effect text for Cutting still says "(of the way to a master cutter)" in the Skills tables and the skill hovers (the
  hover test pins it), which is not a table.
- **Phone width (checked in Chromium, no page overflow at 390 / 360 px):** the Storage and gear overview sits in a horizontal scroll box (gear table min
  width 470 px); refine / cut rows and gear rows are cards under 640 px; the combat log fits (above); the Skills tab (done-when: skills matrix) now shows each
  activity skill as a small card under 560 px (name and level, progress, what it gives now) and the bar-type / gem-type matrix has tighter cells, so every
  column is on screen (the B2 open note about the cut-off "Now" and "Repair" columns). The Adventurer tab's gear list fits at 360 px (the B4 open note).
- **Earlier open notes fixed here:** report wear numbers that did not add up (B3); the Adventurer gear table too wide at 360 px (B4); the roster row-header and
  attribute hovers are `tip()` now, so a phone can read them (B4); Skills tab columns cut off at 390 px (B2); the smith panel time test no longer hard-codes
  numbers (B2).
- **Review fixes (after the batch 5 review)**
  - **Top bar after a finished run.** `clockStatus(state, left, cfg)` (present.js) gives the top bar's clock. When `phase === 'over'` (retired in the middle of
    a work day, or lost) it shows "Run over" with no clock and no work-day bar; the plan has no wording for this, so it is a small addition to 4.17. Before it
    read "Day 7 16:47 1h 12.2m left" with a yellow bar next to [New game].
  - **Combat log, Attacker column.** The 640 px rule no longer narrows it (6.4em cut "Adventurer" to "Adventur..." on every adventurer row at 390 px); it keeps the
    plan's 7em, and the Result column (which may wrap) gives up the 7 px. Measured at 390 and 360 px: the text fits (scrollWidth = clientWidth), no page overflow.
  - **Overview red dot** follows the SHOWN durability (`shownDurability(d) <= LOW_DURABILITY`, 30, a UI constant exported by inventory.js), so a chip whose hover says
    "30%" always has the dot (the item was at 30.4%).
  - **Overview scroll boxes keep their position across the re-render** a tap causes (`keepInventoryScroll(root, ctx)` in inventory.js, called by `renderWorkshop`
    once the screen is in the page; the gear table and the gem table are marked `data-scroll="gear"` / `"gems"`; positions in `ctx.ui.inv_scroll`). Same pattern as
    the plan screen's roster (`restoreScrollLeft`). Checked in Chromium at 390 px with touch: scrolled to the Steel column, a tap on a cell and on a gem row both leave
    `scrollLeft` at 140 (it jumped to 0 before).
  - **Workshop repair intro** reads both levers: "N% of the item's bars (and M% of its gem)" from `repair.materialFraction` / `repair.gemFraction`; the gem part is
    left out when `gemFraction` is 0 (critique #10: repairs may stop costing gems).
  - **"Would have helped" text** names a home item that fills an empty slot separately: "With S Mythril Sword +Ruby S from home (instead of D Copper Sword), plus C Iron
    Chest from home, ...". `whatIfText` tells the two apart by `replaced[].slot`; `replaced` itself is unchanged.
  - **Dead CSS** `.adv-where` (the old Adventurer "Where" column) deleted.
  - **Tests no longer hard-code CONFIG numbers** in the new Workshop tests (house rule): the hover strings come from `CONFIG.refine` / `CONFIG.cut`, tile counts from
    `SLOTS` / `BARS` / `GEMS`, the sword's bar count from `CONFIG.gear.slots.sword.bars`, the best-score label from `VERSION`; the R16 result-box test pins
    `input` and `minutes` of copper with `cfgWith` next to its `dist` (its "refined 5" / 6 ore assume one ore and 15 minutes per bar).
- **Review fixes (second batch 5 review)**
  - **Workshop "Compare all gear types and gem effects" panel keeps its open state** in `ctx.ui.ws_refOpen` (same click + toggle pattern as Help's `det()`), so
    the gem-grade buttons inside it and the smith tiles no longer close it on each redraw. It still starts closed (plan 4.12). Checked in Chromium at 1280 / 390 / 360 px.
  - **Skills matrix phone rule.** The unconditional `.mi-matrix { min-width: 300px }` now comes before the `@media (max-width: 560px)` block, so the block's
    `min-width: 0` and tighter cells apply (measured at 360 px: matrix 298 px in a 298 px box, was 300 px; no page overflow at 390 / 360).
  - **"Gear left at home" ignores gear smithed after the packing** (deviation from the 4.15 formula `state.gear` minus `report.packedIds`, a cheap guard from the
    review). `confirmPlan` records `plan.lastGearId` (the highest gear id then, 0 with no gear), `resolveBattle` copies it to `report.lastGearId`, and `homeGear`
    only counts items with `id <= lastGearId`. An item smithed on the fight day, after the packing was locked in, is therefore never "from home". A report without
    `lastGearId` (null) keeps the old formula. The highest GEAR id is used (not `state.nextId`) so a ring picked up earlier does not change the report of an
    otherwise identical fight (the "real fight is unaffected by intel and Foresight rings" test compares whole reports). `state.plan` has one new key (game.test.mjs
    pins it).
- **Batch 5 open notes**
  - [minor] Not changed: B4 note 3 (the warning icon also marks a blunted sword gem). The plan has one ⚠ for could-break; B4 kept a second reason on the same icon
    and a test pins it. Changing it means a different glyph or hover-only (a sword with a blunted gem would then have no visible cue). **[7b]** kept (see B4 note 3).
  - [minor] Not changed (not in this batch's files): B2 `craft()` / `repair()` XP without `xpPerUnit`; `travelMinutes` repeating the `loadPenaltyPct` formula; B3
    `startFillMax` pinned in the request-pins test; B4 estimate re-render notes (estimates.js). **[7b]** fixed in 7b: the two B2 notes, the `startFillMax` pin and both estimate re-render notes (each marked above).
  - [minor] The Workshop scrap sentence still uses the shown durability for the arithmetic ("35% of its 2 bars x 63%") while the bars returned use the exact value
    (B3 note, unchanged). **[7b]** kept: durability is shown whole by house rule (R9) and the exact value is never printed, so the sentence's arithmetic can be 0.01 off the bars returned; a fix would print decimals or change the scrap rule.
  - [minor] README (night repairs, 10 x 10 estimate, Estimate all) and CHANGELOG are B7's. **[7b]** kept: the docs pass (7c).
  - [minor] Top-bar clock and work-day bar hovers are title-only, so a phone cannot read them: `js/main.js:157` (timebar `title: day.label`) and `js/main.js:174`
    (`.timestat` `title: clock.label`) use a plain `title` instead of the `tip()` helper (house rule: hover details also work on touch; plan 4.17 gives dayProgress's
    label as the hover text). Both lines were also title-only in 1.2. The visible "08:00 10h left" text covers most of it. Fix: spread `...tip(clock.label)` /
    `...tip(day.label)`. **[7b]** fixed in 7b: `...tip(clock.label)` / `...tip(day.label)` (also the version label, the pile count and the Return time); a spec guard pins the two; Chromium touch at 390 px: a tap on the clock, the bar and the version opens the popover, a second tap on the clock closes it.
  - [minor] Storage and gear: the gem table scrolls by 2 px at 390 px. `css/ui-workshop.css` `.inv-gemtable { min-width: 330px; }` sits in a 328 px `.ws-scroll` box
    at 390 px (Chromium: scrollWidth 330 vs clientWidth 328). The page does not overflow, but the gem block gets a scrollbar. Lower the min-width to about 320 px or
    tighten the cell padding; at 360 px the scroll box is still needed. **[7b]** fixed in 7b: `.inv-gemtable { min-width: 280px }` (its content needs about 252 px); Chromium: scrollWidth = clientWidth at 390 (328) and 360 (298), the table still scrolls in a narrower box.

**Tests (B5)**
- New `tests/replay.test.mjs`: `replayStats` (deterministic, totals and the five parts add up, a lethal / harmless enemy, `closeCut`), `analyzeLossSync` equals
  `replayStats(report.adv, report.enemyC, 500, mixSeed(seed, day, 501))`, verdicts `helped` (a mythril S sword at home against a copper D sword used; the
  lost fight is found by looking through seeds, so no number is pinned) / `noHome` / `notHelped` (the real enemies at 2.5x hp and damage, so the used mythril S sword
  wins part of its fights and the weaker iron C home sword really scores lower; under `DEADLY_ENEMIES` every loadout scores 0 and the verdict would be automatic),
  gear smithed after the packing is not home gear (`lastGearId`), a destroyed used item is a candidate, async equals sync with
  progress reaching 1 and a `false` cancelling to `null`, the state is unchanged (serialize equal) and `cacheAnalysis`.
- `tests/present.test.mjs`: `durText` / `repairGainShown` (sum 100 for every durability), `dayProgress` (8:00, half way, the warn / low thresholds, past 18:00,
  a patched config), `processOutcome`, `processMessage`, `failedText`, `combatLogRows` (both HP on every row and never rising, `hitSide`, effects iff stun / slow),
  `gearMatrix`, `gemOverview`, `scoreBreakdown` (total = `stats.score` after real wins), `outcomeSegments`, `fightSegment`, `whatIfText`.
- `tests/game.test.mjs`: `newGame` has `end: null`; the lost-fight test checks `used` / `notUsed` and `state.end`; `endRun` from work (with a planned fight), plan and
  report, refused when over, logged once, survives a save.
- `tests/ui-render.test.mjs`: no score or tier points on any screen but the run summary; Help promises (the sentences, the sections in order, nothing forbidden); the
  Workshop has no `<select>`, no luck / fail / time text, tiles, one bar and one row of numbers per row, the hovers; the result box green / red and the toast tone; the
  gem picker back on None after a craft (and the grade re-picked); the preview; the Storage and gear overview (chips, `+N`, `none yet`, packed / low marks, clicks);
  the gear list (groups, Repair inline right of the bar and number, packed text, Scrap column) and Repair all; the report (used / brought but not used, no home
  gear, wear adds up, header line); the combat log table and its trimming; the run summary (retired, fatal, New best score, the analysis working then done, the
  automatic start and `cancelAnalysis`); the Log tab shows the analysis. Updated: renamed `renderGameOver`, the Workshop intro text, the smith time hover, the
  durability cell selector (`gl-pct`).
- Second review-fix tests: the Workshop reference panel stays open across redraws (grade button, tile, summary click, toggle event) and a fresh screen starts closed;
  the overview `+N` chip test adds `chipsPerCell + 1` iron swords and expects `+1` whatever `display.chipsPerCell` is.
- Review-fix tests: `clockStatus` (present.test.mjs: work day, day over, run over with no bar), `whatIfText` with a swap plus an empty-slot item, the overview's red dot
  at the shown limit and the scroll boxes restored through `renderWorkshop` (ui-render.test.mjs), the repair intro with pinned `materialFraction` / `gemFraction`.
- `tests/spec-guards.test.mjs`: no running score and no tier points in js/ui, top bar (End run, confirm text, `dayProgress`, `clockStatus`, toast tone, `recordBest`, Run summary),
  deleted names stay deleted, no drop-downs in the Workshop, Help source guards, `replay.js` is screen-only and writes nothing to the state, the report guards, a B5
  "request pins" test (R15 fill = fraction used, R28 columns, R30 column order).
- Hand-checked in headless Chromium (1280, 390 and 360 px): Workshop, report, run summary (lost with the analysis, retired), Adventurer tab, Skills tab; an
  end-to-end click through craft, refine, Repair all, End run (confirm text, `end.prevBest`, a reload shows the same summary) and New game: no console errors.

**Batch 6 (balance tool: personas, sections, benchmark)**
- **Only `tools/balance.mjs`, `tests/personas.test.mjs` and `docs/BENCHMARKS.md` changed** (no game code, no config). Every number the tool uses for targets is the plan's
  (section 9) and sits in the tool next to the check, because they are measuring instruments, not game numbers.
- **Personas (`PERSONAS`, `PERSONA_KEYS`, `PICK_KEYS`, exported).** Section 8.3 verbatim (careful, champion, casual). The persona merges into the bot through `botParams(T, o)`: `o.persona`
  (default careful), `--minwin`, `--future` and `--carry` are `null` by default and only override the persona when given. `slotW.sword` is multiplied by `swordBias`; `trips`, `minRate`,
  `restBelow` / `repairBelow` / `subBelow` and `carry` come from the persona. `--intel only:<track>` puts `[track, Infinity]` in front of the persona's list.
- **`pickEnemy(P, st, evals)` (pure, exported)** returns the chosen element of `evals`. Ties keep the lowest index. `ev` may be missing. The champion fallback always computes the plan's `p/100 x (score + future)` over `p >= 50` and ignores `ev` (which also counts the reward ring and the banner bonus; fixed in the B6 review, the first version used `ev`); the careful rule uses `ev`.
  **Reading chosen for the casual persona (a deviation):** the plan says "G < 6: normals, else normals and elites; fewest visible High, ties -> lowest index". Taken literally the casual player
  would never fight an elite, because a normal has no High attribute at all (0 visible), so a normal always wins the "fewest visible High" and the tie-break goes to the lower index (normals come
  first in the roster). The plan's own test list says "elites from 6", and the UI spec behind it says "G < 6: normals; else elites", so from `gearLevelForElites` on the pool is the elites (the normals
  only when the roster has no elite), still never champions, still fewest visible High then lowest index. `gearLevel(st)` is exported.
- **Casual details the plan leaves open.** `pack: 'default'` is the game's `defaultPack(state, cfg)` and has no rest rule (the default pack leaves out an item that could break; the casual persona
  repairs it at camp when it is below `repairBelow` 30). Crafting is the shared engine for all three personas. The casual persona's picks have `p: null`, `bestP` / `meanP` / `safe` null; the tables print "-" for it.
- **Casual rings (a deviation).** Plan 8.3 says "`grade` = highest ring value first, any type". `gradeRings` sorts by **grade first**, then by ring value, then by the older ring, for adventurer AND smith rings.
  Raw ring values cannot be compared across types (a health ring is 3-7, a slow-resistance ring 6-18, so "highest value first" would just mean "always the slow-resistance ring"), and grade is what a casual player
  can read off a ring. Within a grade the larger value wins, so the plan's rule is the tie-break. The test pins the grade order.
- **The "bot" estimator (`--estimator bot`)** still re-checks the best three by expected value for the careful persona; the champion persona re-checks all seven (its rule needs the p of every
  enemy, not only the three with the best expected value). The benchmark and intel sections use the in-game estimate (`--estimator game`) by default, as before.
- **`spendIntelPoints`** accepts the list or `'roundRobin'`, skips tracks that cannot gain, and a list without `*` falls back to the first track that can gain, so a persona never leaves a spendable point.
  `rec.rested` counts the items the rest rule kept home ("rested item-days"): only items the pack would otherwise have taken (within the best `packLimit` of their type; a worn third or fourth spare that the
  pack limit leaves at home anyway is not counted, fixed in the B6 review), `rec.repairGems` the gems repairs used (gem units; a repair costs a fraction of a gem), `rec.atDay[d]` (days 10, 20, 25, 30, 40)
  the skill levels, the main bar and the answer-gem armor cover.
- **Sections.**
  - **economy:** 1a gets a "gem % set" column next to the measured one; a **Map** note (fields per distance, fields at distance 5+, % of maps with 6 or more, attempts per map); **3c Sight**
    (sight forced through `intel.tracks.oreSight.base` with `withSets`, the same field and the same maps for every sight value, value per trip-hour, "5-6 together" row for T-E5); the SUMMARY ends with
    the searches per clear cell at +0 / +12 / +32%, the map note and the sight gain, then the T-E flags. Attempts per map are counted without touching the game: `mapAttempts(seed)` wraps the rng, counting
    the shuffles of the candidate cells (one per attempt in `generateMap`); it returns NaN if a field had exactly as many cells as the candidates.
  - **power:** "3b Anchors" (120 enemies x 60 fights per day, a typical elite = a random roll of the tier's attribute levels, last day with >= 70%, scanned until a day is 25 points under the line), five sets,
    flagged against 1.2's numbers (8 / 15 / 23 / 41 / 59) within 3 days (T-MID). Elite only (curve.mjs also did normal and champion).
  - **specials:** rewritten for M1-M7 (T-R33) and the S-swing check; iron / steel / mythril C sets, reference day = the day the plain set wins about 55% against an all-Normal elite (win or draw, 500 fights per
    day), window of 5 days, 1,500 fights per cell (300 with `--quick`), the same random numbers for every gear variant of a cell (paired). M5 is measured for the four gems with a resistance (emerald has none);
    M6 is "distance from the mean of the five sword gems" (C <= 3, S <= 4); M7 compares the emerald armor gain with the smallest M2; the S check is S sword gem gain minus the
    matching special's Low-to-High swing. **Judged on the mean of the three sets (B6 review fix):** every target value is the mean over iron / steel / mythril for one special (M6: for one sword gem; M7: one value, the mean
    M7 against the smallest per-special mean M2), the reading of the reference script (`scratchpad/v2/cm/gems.mjs`) and spec-combat 6.1 ("the reported number is the mean of the three sets"). The first version flagged each of the
    12 cells (15 for M6, 3 for M7) on its own, which is stricter than the plan and printed `T-R33 MISS 8/10` where the plan's reading gives 2 (topaz M2 3.9 and 2 of 4 S-swing checks). The per-material tables stay as
    information, followed by a table of the means. The old 1.2 tables (rings, offence vs equivalent special) are gone with the old section.
  - **estimator:** rewritten for 5x5 / 6x6 / 8x8 / 10x10 (derived from `sim.samples`) at the starting 10% scouting times the elite multiplier (what the game would show, 9% per attribute): shown margin,
    rms miss, wobble, how often the truth lies inside the shown margin, the margin floor, and the **cost table**. The plan's "max (10x10, 3 per type)" is not the dearest case: with 3 items per type the gear search
    is one type at a time (<= 31 tries per guess) and costs LESS than 2 items per type, which are all tried (32 combinations). The dearest case is the largest exact search, 3 swords + 2 of the other
    types (48 combinations = `maxExactCombos`), so the table has that third row and T-A2's two limits check the dearest row at base and at max.
  - **bot:** persona title and pick text, "Win chance by tier" (T-GEAR c, the mean estimate over the roster's enemies of each tier on the days the bot planned), progression with T-B1 ranges, the **load**
    column (travel minutes the carried items add = the walk minus the same walk with nothing carried; `ctx.tm.load` is not a time category, so idle is unchanged), travel % of the minutes worked and load % of
    travel (T-B2), the Repairs line from the plan, repair time % on days 11-40 and items destroyed (T-B3), **Gem supply** (T-B5), **Skills at day 30** (T-B4, "main bar" = the bar type the run has smithed the
    most items from by then), and a targets table. T-B / T-GEAR (c) rows are only judged for the careful persona; other personas get a note.
  - **benchmark:** personas (default all; `--persona` one), `BENCH_DAYS` (2, 3, 4, 5, 10, ...) and `DEATH_BINS` exported, columns median life, mean score, score/day (mean of score / (days survived), day 1 has
    no fight), fights n/e/c %, picked at; per persona a `BENCHMARK | v2.0 | <persona> | ...` line and a markdown row; wall time; T-D and T-P rows (T-P rows that need a persona pair only when both ran).
    `--jobs` shards every persona; the children get `--persona X --intel M --section benchmark --emit-json` and the parent's other flags. Same numbers as one process (a test compares them).
  - **intel (new):** 6 `only:` modes + `persona` + `none`, the same seeds, life (alive at `--days` counts as days + 1), score, paired differences to the best mode and to `none`, T-R42 rows, the INTEL line.
    `--intel none` is a CONFIG switch (`intelModeSets`), applied for the whole process when given on the command line and with `withSets` (undone afterwards) inside the intel section.
  - **day2** only got flags (T-R7 / T-GEAR) on its DAY2 line. **kit3 is an upper bound for T-GEAR (b)** (plan: "one matching gem per *visible* High special"): the B3 code gems every High special, hidden ones too, and adds an
    extra Copper D helmet and gloves with 2+ Highs. B6 judges it against the 85-90 / 65-75 bands anyway; its label and a note now say "all scouted: upper bound", so a miss on the high end of (b) is read as "the ceiling", not
    "a typical scouted player". A version with only the visible Highs gemmed would sit between kit2 and kit3. `--section all` is still economy + power + bot (benchmark, intel, day2, specials, estimator are separate), as the header always said.
- **Earlier open notes fixed here (inside this batch's files):** B3 "`--section estimator` still describes 10x10 / 13x13 sizes" (rewritten). B4's "ringPoints 1 and bannerBonus 10 are untuned guesses": measured below, not changed.

- **First measurements with the B5 numbers (untuned; these are B7's inputs, full runs, flags as the tool prints them).**
  - `economy` (100 maps, 24 s): T-E1 3.98 ok; T-E2 copper 21 (LOW, 23-31), iron 60 ok; T-E3 ok (40 fields, every map has 7+ at distance 5+, 1.70 attempts); T-E4 mythril 28.2 ok; T-E5 sight 60 vs 0 +27% ok,
    sight 20 vs 0 about 0% (LOW, 3-8).
  - `day2` (3 s): unchanged from B3: T-R7 in band 2 of 8; T-GEAR kit2 94 / 77 and kit3 96 / 85 (elite / champion), all four above their bands.
  - `power` (5 s): T-MID ok on all five anchors (copper B d9, iron C d15, steel C d25, mythril C d38, mythril S d59).
  - `specials` (2 s), judged on the mean of the three sets per special (after the B6 review; the first per-cell reading gave `T-R33 MISS 8/10`): M1 9.1-18.3 ok, M2 3.9-7.7 (topaz 3.9, just under 4: the case plan 4.7's
    topaz fallback covers), M3 -3.0..-2.5 ok, M4 96-125% ok, M5 C 32-49% and S 41-48% ok, M6 C max 2.4 / S max 3.7 ok, M7 3.1 against the smallest M2 3.9 ok, S-swing -17.0..+4.0 (topaz and sapphire sword gems S gain 4 more
    than the swing; the mythril diamond / ruby swings are huge, so the other direction is fine): `T-R33 MISS 2/10`. Per cell (information) 1-4 of the 12 cells of M1, M2, M3, M5-C and M6 are outside the bands.
  - `estimator` (4 s): +-20.7 / 17.2 / 12.8 / 10.3 at 5x5 / 6x6 / 8x8 / 10x10, miss 13.1 / 12.3 / 11.1 / 10.5, wobble 9.3 / 8.1 / 6.2 / 5.0; dearest cost 8,575 fights (base) and 34,300 (max) per roster; T-A2 ok.
  - `bot --persona careful --seeds 40` (bot estimator, 128 s): median life 49.5, alive d2 95% / d10 95%; T-B1 first pieces ok, 3-of-5-slots iron 5 and steel 11.5 a day early; T-B2 travel 29% ok, load 6.9% of travel (LOW);
    T-B3 repairs 1.9% of the time (LOW), 0.0 destroyed; T-B4 Travel 8.2 (HIGH), General repair 3.8 and main-bar repair 2.4 (LOW); T-B5 cover 3.5 of 4 ok, repairs use 2.3% of the gems cut; T-GEAR (c) elite 98.5 /
    champion 94.9 (both HIGH: the careful bot is far safer than the 75-90 / 50-75 bands).
  - `intel --seeds 100 --days 60 --jobs 3` (544 s): all eight modes lie within 2.7 days of life (standard error 1.3-1.6): none 43.7, the persona's list 43.8, best only:groupSight 44.1, worst only:oreSight 41.4. T-R42 is
    met, but only because intel hardly moves survival in the bot's hands; B7 may want the gains to matter more. (Spending on Ore sight alone is the one mode a little below none, -2.3 +- 1.4 days.)
  - `benchmark --jobs 4` (100 seeds x 3 personas, 134 s wall, T-P limit 15 min): careful d2 96 / d4 96 / d10 95 / d20 94 / d30 85 / d40 67, median life 48 (T-D wants 30-40 and 75-85% at d10: HIGH); champion median 38,
    score/day 44.3 = 1.22x the careful planner's, 99% champions on days 11-40; casual d4 100, 0% champions, median 42. T-P misses: careful - casual at d20 is -5 points (casual 99%, careful 94%: the careful
    planner loses 4 of 100 runs on day 2, every time to a champion that its 5 x 5 estimate put at 100%: 25 of 25 test fights won, and the bot, like the plan's rule, ignores the shown +-14); d40 +11 ok. `--section benchmark --persona careful --quick` takes 8 s.
- **B6 review fixes (recorded here, all inside `tools/balance.mjs`, `tests/personas.test.mjs`, `docs/BENCHMARKS.md`).**
  - `--section benchmark --estimator bot` crashed with the default `--persona all` (the header called `botParams` with `persona: 'all'`); the bot's first-stage estimate sizes are now `botSimOpts(o)`, which needs no persona and
    no value tables (the `--jobs` parent no longer builds them either). A test runs it in one process and with `--jobs`.
  - T-R33 is judged on the mean of the three sets per special (see **specials** above); the champion fallback uses `p/100 x (score + future)` (see `pickEnemy`); "rested item-days" count only items in the pack's top `packLimit` (the 40-seed careful run: 108 -> 71.7 per run; nothing else in that run changed: median life 49.5, same T-B flags).
  - Targets on a day after `--days` print n/a, not 0 / LOW: `alivePct(d)` is NaN for `d > D`; the T-B2 / T-B3 windows (days 11-40) and the benchmark's fight shares are NaN when no day / fight falls in the range.
  - The casual persona's BENCHMARK line and markdown row say `estimator no estimate` (it never reads one); the others say `game 5x5` / `bot`.
  - The champion hunter does rest gear (docs/BENCHMARKS.md said it did not): `restingIds` keeps home any item a champion fight could destroy for every persona with `pack: 'score'`; only the `restBelow` wear threshold is off for it (0).
    The sentence now says so. The plan is silent; the spec says "keeps break-risk items".
  - Comments and docs that said the tool runs on older versions are corrected (the optional-export guards for `freshCellCount` / `simCounts` are plain imports now; BENCHMARKS.md "Adding a new version" step 3 says to run the old tree's own tool).
- **Batch 6 open notes**
  - [minor] The careful persona prefers champions as soon as its estimate is 90%+ (expected value p x (score + 1000) is larger for a champion): 62% of its fights overall and 71% on days 11-40 are champions, 4 of 100 runs
    die on day 2 (seeds 15, 18, 38 and 42 of the benchmark list, each against a champion estimated at 100%). That is the plan's rule with the plan's numbers, not a bot bug; B7's difficulty pass (T-D) sets the picture. **[7b]** kept: the plan's rule with the plan's numbers, not a bot bug; recorded as the T-P miss (docs/TUNING-2.0.md note 4).
  - [minor] `bannerBonus` 10 and `ringPoints` 1 (B4 guesses) are still untuned; with the champion rule above they hardly matter. `--set` cannot reach them (they are tool settings in `botParams`). **[7b]** kept (tool settings; see the B4 note).
  - [minor] The tool's `--section all` stays economy + power + bot; running all eight sections of section 9 is eight commands (about 14 minutes in all with `--jobs`). A one-command "everything" would need the benchmark's
    child processes to be shared, so it was left out. **[7b]** kept: a design choice stated in the tool's header; a one-command run of everything needs the benchmark's child processes shared.
  - [minor] `README.md` (the `--section` list, `--persona`, `--intel`), `docs/BALANCE.md` and the HANDOFF file table and "Balance status" still describe 1.2's tool: B7. `docs/BENCHMARKS.md` is restructured (2.0 table empty on purpose,
    the 1.x text moved unchanged under "1.x (old world, history only)"). **[7b]** kept: the docs pass (7c).
  - [minor] `tests/sim.test.mjs:307` unused variables (B2 note) and the B2 `craft()` / `repair()` XP note are outside this batch's files and not touched. **[7b]** fixed in 7b (both).
  - [minor] SUMMARY flags count n/a target rows as misses: `tools/balance.mjs:239-246` `targetFlags()` uses `bad = mine.filter((r) => r[4] !== 'ok')`, so an 'n/a' row adds to `MISS k/n` when another row of the same id is LOW or HIGH. Repro: `node tools/balance.mjs --section benchmark --quick --seeds 2 --days 5` (table: T-D 3 LOW + 1 n/a, summary `T-D MISS 4/4`; T-P 1 LOW + 3 n/a, summary `T-P MISS 4/8`; with `--days 1` `T-P MISS 7/8`). Expected: MISS counts only LOW / HIGH, n/a apart (for example `MISS 1/5, 3 n/a`). Full-length runs are not affected. **[7b]** fixed in 7b: `targetFlags` (now exported) counts only LOW / HIGH rows out of the rows that could be judged and prints n/a rows apart (`T-D MISS 2/2 (2 n/a)`, `T-B1 ok (1 n/a)`, all n/a -> `n/a`); unit test plus the `--days 5` run.
  - [minor] Median-life targets are judged when the median is cut off by `--days`: `tools/balance.mjs:2967` `lifeNum = (st) => (st.medLife === Infinity ? D + 1 : st.medLife)`. With more than half the runs alive at `--days` only '>D' is known, yet 'careful: median life (days)' prints D+1 and LOW, and 'careful - champion: median life (days)' prints 0.0 and LOW when both are cut off (`--section benchmark --quick --seeds 1 --days 3`). Expected: n/a, the rule the B6 review applied to alive % after `--days`. The 100-day benchmark is not affected today. **[7b]** fixed in 7b: `lifeNum` is NaN when more than half the runs are alive at `--days`, so "careful: median life" and "careful - champion: median life" print n/a; asserted in the `--days 5` benchmark test.
  - [minor] `docs/BENCHMARKS.md:21` says the careful planner 'fights only when it is at least 90%'. The game needs a fight every day: `pickEnemy` (`tools/balance.mjs:2229-2230`) takes the largest p when no enemy reaches minWin (the bot section counts these as 'no-safe-option fights'; plan 8.3: 'none -> max p'). Suggested wording: 'takes the fight with the best expected value among those it is at least 90% sure of, else the surest one'. **[7b]** fixed in 7b: "takes the fight with the best expected value among the enemies it is at least 90% sure of, else the surest one" (the tool's pick text says the same). Line 86 sits in the 1.x history, where it is accurate.
  - [minor] Economy SUMMARY hard-codes the +12 / +32% efficiency labels: `tools/balance.mjs:758` `searchesAtBonus = { 0: meanKs[0], 12: meanKs[1], 32: meanKs[4] }` and line 1078 prints 'searches per clear cell +0/+12/+32%'. The bonuses come from CONFIG (`skills.activity.searchEff.effects.searchEff` x maxLevel = 1.2 x 10, and the S ring 20 + 12), so if B7 changes either value the label and keys go stale. Expected: build the label from effSkill and from S ring + effSkill. **[7b]** fixed in 7b: the keys and the label come from the bonuses in CONFIG (skill effect x max level; S ring + that skill); a test moves the skill value with `--set` and checks the label follows.

**Tests (B6)**
- New `tests/personas.test.mjs` (28 tests; 16 s because eight of them run the tool's command line): `PERSONAS` shape (exactly careful / champion / casual, every key the bot reads, every pick's own keys, lists end in the catch-all); `botParams`
  merges persona values, scales only the sword weight, `--minwin` / `--future` / `--carry` override; `pickEnemy` (careful: max ev among p >= minWin, boundary included, fallback max p; champion: champion at champMin, elite at eliteMin,
  best value at 50%+, else max p, the value formula without `ev`; casual: p ignored / missing, normals below the gear level, elites from it, never champions, fewest visible High, hidden Highs do not count, ties lowest index) and `gearLevel`;
  `spendIntelPoints` against a separately written reference for all three lists point by point, the careful targets, round robin, maxed tracks skipped, nothing spendable left for any persona / `--intel` mode / point count, `only:<track>`,
  `--intel none` (and `withSets` restoring the config, also after a throw); `parseArgs` (persona, intel, section defaults, benchmark default `all`); `BENCH_DAYS` / `DEATH_BINS`; `judge`; `mapAttempts`; each persona plays 12 days of the real
  game (trip cap, estimate use, every intel point spent); `choosePlan` for casual (the game's default pack, best-grade rings) and careful (rest rule); the benchmark through child processes gives the same line as one process; the intel,
  day2, power, specials, estimator, economy and bot sections run with `--quick` and print their SUMMARY lines with target flags. Mutation-checked: off-by-one in the casual gear level, `>` for `>=` in the careful rule, `<=` for `<` in the
  intel targets, a missing sword bias and an uncounted rested item each fail a test.
- B6 review additions: `--estimator bot` with the default persona (one process and `--jobs`), n/a for targets after `--days` and the casual row's `estimator no estimate`, T-R33 judged out of 4 / 5 / 1 values (the mean of the three sets), the champion fallback ignoring `ev`, and the exact rested count (a worn spare beyond `packLimit` is not counted). Each was mutation-checked (the old code fails its test).
- No existing test changed. `npm test`: 589 tests (561 + 28), all green.

**Batch 7 (tuning) — Batch 7 tuning open notes**
- [minor] T-GEAR (c) is in band only as an average: above the bands on days 10-20, below on days 31-40. Bot section (40 seeds, true chance vs every roster enemy): days 10-20 elite 96.9 / champion 90.5 (above 90 / 75); days 21-30 87.0 / 71.9 (in band); days 31-40 65.7 / 43.1 (below 75 / 50). Unmeasured days 3-9: 98.6-98.8 / 94-96. The plan defines (c) as the mean over days 10-40 (86.3 / 73.3), so not a miss. But for about the first 20 days of a run with median length about 31 days, a careful player wins about 95% against champions, and the user's geared range is 50-75. The log reports only the mean. Mostly structural (linear enemy growth, stepwise gear). Untried lever: T-B1 sits at the fast edge of every band (first iron day 3 vs 3-6, 3 iron slots day 6 vs 6-9, first steel day 9 vs 8-12, 3 steel slots day 13 vs 12-16); a slower early economy plus lower growth could flatten the curve. At minimum, record the per-window spread in BALANCE.md Known misses. **[7b]** fixed in the log (docs/TUNING-2.0.md note 5 has the per-window spread and the untried lever); no value changed. The BALANCE.md "Known misses" entry goes with the docs pass (7c).
- [minor] T-P careful - casual at day 20 is a real miss of about 11 points, not noise. +7 (73 vs 66) at 100 seeds; at 200 seeds careful 66% vs casual 67% = -1 (target >= +10). At day 10: 81 vs 90 = -9. The careful planner is not safer than casual until about day 20, because of early champion picks made on the noisy 5x5 estimate. Priority 3, predates tuning (B5: -5). The log's 'within noise' and 'MISS (-3)' should say the miss is real and give the 200-seed numbers. **[7b]** fixed in the log: the table row and note 4 now say the miss is real and give the 200-seed numbers (-1, 66 vs 67; day 10 -9).
- [minor] T-GEAR (b) elite 82.1 vs 85-90: priority-1 miss, conflict confirmed by in-memory --set runs. Triple-strength armor gems give kit3 85.9 (matches log) but kit3 champion 75.8 and resistances pass their cap. unarmedDamage 13.5 + elite 85.5/9.75: kit3 85.3, kit2 81.4 (above 80), unarmed elite 0H 54 (above user's 50). unarmedDamage 13 + same elite: kit2 81.4, unarmed 2H+ 26.5 (below user's 30). unarmedDamage 13.5 + elite 86/9.8: kit2 80.6, kit3 84.7, 0H 52.2. kit3 reaches 85 only when kit2 is about 81+, and 0H/2H+ elite groups then leave 30-50. Conflicts with T-GEAR (a) and T-R7. Add these numbers to the log and BALANCE.md. **[7b]** fixed in the log (note 2 has the sweep numbers); BALANCE.md entry with the docs pass (7c).
- [minor] T-R7 champion sub-band misses confirmed as forced; log note 1 misstates the step size. Measured: champion mean 18.4 (8-16), 2H 17.0 (8-16), 3H 13.9 (0-6); all inside the user's 0-25 and hard limit 27. Conflict with T-GEAR (a): champion 90/10.2 (+1.1% HP / +1% damage) gives champion mean 16, 3H 12, kit2 champion 47 (below 50), kit3 champion 61 (below 65). At +1.7% (90.5/10.25) kit2 champion 44, 3H still 11.4. These match the log's 'about 15.5 / 12 / 47' but come from a +1% step, not the '+1.5-2%' the log says, so the conflict is stronger than stated. Champion spread is only 14-20, so the user's 0-13 'low end' is never reached by any group. **[7b]** fixed in the log: note 1 now gives the +1.1% / +1.7% steps and their effect (the "+1.5-2%" wording is gone).
- [minor] Config comments: wrong multipliers in the gemEffects comment; tiers comment contradicts itself. js/config.js gemEffects: 'resistances are about 3.75x their 1.2 values (diamond 6x...)'. Against 1.2 (997fc00), ruby magicRes is 4.5x (4..12 -> 18..54), topaz and sapphire 3.75x, diamond pierceRes 2.67x (6..18 -> 16..48), not 6x; diamond is 2x the B6 value. 'Sword gems are about as strong as before' omits the emerald accuracy rise of 40-50% ([20..60] -> [28..90]). Tiers comment: 'Fights are steep ..., so the steps are small on purpose' contradicts 'Normals sit about 7% below elites' (normal-to-elite step is +7.3% HP / +8.7% damage, about 25-30 win points). **[7b]** fixed: the gemEffects comment gives ruby 4.5x, topaz / sapphire 3.75x, diamond 2.67x for armor, and the sword-gem changes (emerald accuracy up, ruby down, topaz / sapphire flatter at S); the tiers comment separates the small elite-to-champion step from the large normal-to-elite one (comments only).
- [minor] Normals made much easier early and R6 stretched; the 1.2 unarmed-vs-normal band is broken and the power section still flags it. Elite base is +7.3% HP / +8.7% damage over normal (plan 4.6: tiers 'rise a little', starting step 1.25%), champion only about +1% over elite. Unarmed vs a day-2 normal is 85-86% (B5: 64; 1.2 user decision in BALANCE.md: 50-65). POWER SUMMARY still prints 'unarmed d2 vs normal 86% (target 50-65)', and section 1 flags several day-1 sets (high)/(low) against 1.2 DAY2_TARGET bands. Section 9 only asks normal >= elite + 15, so not a target miss, but the log never mentions the broken band. Stated reason is the careful bot's 90% minimum win (a game value bent around a bot threshold). The careful bot fights 89% / 99% normals on days 21-30 / 31-40. Either retire the stale power bands in the tool and docs or note the deviation. **[7b]** fixed: noted in the log (note 6) and the config comment; the tool's power section no longer prints (low) / (high) against 1.2's day-1 bands or "target 50-65" (the day-2 targets that count are `--section day2`).
- [minor] Topaz and sapphire sword gems: grade S is identical to A. Topaz weapon stunChance [15,20,24,26,26] / stunDur [1,1.5,1.5,1.5,1.5]; sapphire weapon slowPct [11,16,18,19,19] / slowDur [2,2,2,2,2]. S gives nothing over A on a sword; Help's gem table shows identical columns; sapphire's whole D-S sword range is 11-19. Price of the S-swing check (headroom -1.3 topaz / -1.5 sapphire), a T-R33 trade-off; the log should state it as a feel cost. **[7b]** fixed in the log (note 7 states it as a feel cost); no value changed.
- [minor] Mid- and late-game feel: mythril arrives after it is obsolete; nobody survives past about day 50. T-MID misses 4/5 (iron C 10, steel C 17, mythril C 28, mythril S 44 vs 12-18 / 20-26 / 38-44 / 56-62), accepted as a consequence of T-D and T-GEAR (c) ('then recheck T-MID'). A full mythril C set stops beating a typical elite (70%) at day 28, while the careful bot reaches 3 mythril slots at day 30 (20/40 runs) and all 5 at day 36 (4/40). Alive at day 50: 0% in the bot section, 1% at 200 seeds. Per-cell T-R33 is weakest late: with the mythril set, High Chilling costs 5.3 points and sapphire armor beats emerald by only 2.6, less than emerald's own 3.0 (M7), so 'bring the matching gem' is wrong for Chilling at mythril. Pass on the plan's means; known limits. **[7b]** kept: the plan's means pass and the cause is T-D / T-GEAR (c); recorded in the log (note 9); balance values are frozen.
- [minor] Repairs: timeFraction raised 100 -> 250 (the plan's knob ran the other way); wear still destroys nothing. A full repair takes 2.5x the smithing time (a gemmed chest: 55 min to smith, 137 min to repair 0 to 100 before skills). Repair time is 3.4% of work time (T-B3 3-6%, low edge) and 0.0 items destroyed per run (1.2: 3.9). Acceptable (the only other lever, restBelow, is a bot setting), but 'repairing takes longer than making it' is counter-intuitive and should be stated in BALANCE.md. **[7b]** fixed in the log (note 8 says repairing takes longer than making and why); the sentence in BALANCE.md goes with the docs pass (7c).
- [minor] Several priority-1 and other targets sit on a band edge: T-D d10 85 (top edge at 100 seeds; 81 at 200), median 31.0 (log saw 29.0 in neighbouring settings), elite 0H 49.9 (<= 50), elite 2H+ 30.7 (>= 30), T-GEAR (c) champion 73.3 (<= 75), T-B1 iron 3.0 / 6.0 (lower edges), T-B4 General repair 5.1 (>= 5), main-bar smithing 3.2 / repair 3.3 (>= 3). Any later change can flip these, so re-run the full set right before committing. The 200-seed careful row (31.0 / 81 / 96 / 89) is the more robust T-D evidence and is what BENCHMARKS.md asks for. **[7b]** kept: recorded in the log (note 10). 7b changes no game value (a 4-seed careful bot run before and after is identical apart from the labels), so no re-run was needed; any later value change must re-run the full set.

**Batch 7b (clear the open review notes; no game number changed)**
- Every note of the "open notes" lists above is marked **[7b]** fixed or kept, with the reason. Kept ones: the documented request-pins exception (B1), the ⚠ icon for a blunted sword gem
  (B4 note 3), the scrap sentence's 0.01 rounding (R9 whole-number durability), the tool settings `ringPoints` / `bannerBonus`, the champion rule of the careful bot, `--section all`, the
  mid- and late-game feel and the band-edge warning (known limits, logged), and everything that is the docs pass (README, CHANGELOG, BALANCE.md, SPEC.md, the file table / save keys / release
  step 6 above): that is the next step (7c), not a minor note.
- **Code:** `craft()` / `repair()` XP read `xpPerUnit(skillDef(...))`; `travelMinutes` calls `loadPenaltyPct` (which takes the caller's `smithBonuses`); the top bar's clock, work-day bar,
  version label, pile count and Return time use `tip()`; the map's Sight chip / sight row / by-distance headers / count chips, the Rings "+N if worn" and the repair previews' "Have N" use
  `tip()` too; estimate runs only redraw the screen that started them (`ctx.ui.est_screen`, set by `scheduleEstimates`, cleared at the start of `render()`) and a run for a selection that
  was left is cancelled even when the new selection is cached; the Debris row sentence; Help's cutting text (`skills.effects.cutBlend.text`, a string); `.inv-gemtable` min-width 330 -> 280
  px; config comments (gemEffects multipliers, tiers) rewritten, no value touched. A 4-seed careful bot run (`--section bot --persona careful --seeds 4 --days 20`) before and after
  prints identical numbers, labels aside.
- **Tool and docs:** `targetFlags` (exported) counts only LOW / HIGH rows, "(k n/a)" apart; median-life targets are n/a when `--days` cuts the median off; the economy SUMMARY label and keys come
  from CONFIG; the careful pick text says "else the highest win%"; the power section no longer judges 1.2's day-1 bands (information only; T-R7 / T-GEAR live in `--section day2`);
  `docs/BENCHMARKS.md` careful-planner wording; `docs/TUNING-2.0.md` has the review's numbers (T-P real miss, T-GEAR (b) sweep, champion step size, per-window T-GEAR (c), S = A swords,
  repair time, mid/late game, band edges) as notes 5-10.
- **Tests:** 592 -> 597 (+5: craft / repair XP reads the skill definitions, two estimate tests, the `targetFlags` unit test, the economy label test); new assertions inside existing tests (the n/a /
  median-life checks in `personas.test.mjs`, top bar `tip()` and `est_screen` guards in `spec-guards.test.mjs`, the 3-item walk through `loadPenaltyPct` in `carry.test.mjs`, the pinned scrap
  example in `ui-render.test.mjs`). The new XP and estimates tests fail on the old code (checked); the tool tests need the new exports. The `startFillMax` pin and the single-item loop are gone, the unused variables rewritten.
- **Hand-checked in Chromium (390 and 1280 px; 360 px for the table):** no page overflow, no console errors; the gem table fits its box (328 / 298 px) with no scrollbar; a touch tap on the
  clock, the work-day bar and the version label opens the popover, a second tap closes it; a tap on the plan screen's ⚠ icon shows its lines (the B4 "not tapped on a touch device" FYI);
  typing in the Log filter right after leaving the Adventurer tab keeps focus and text (before: focus on BODY, one letter left).

**Docs pass (7c) is done:** every "[7b] kept: the docs pass (7c)" note above is resolved by the final review pass below (README, CHANGELOG, BENCHMARKS,
SPEC, the top of BALANCE.md, TUNING-2.0.md and this file); BALANCE.md chapters 1-16 and Appendices A-C stay 1.2 reference text with a "2.0:" note per
chapter (the open work: regenerate their worked examples).

### Final review pass (verified findings of the last review; no other balance value changed)
Fixed (with tests where it is a real bug; `tests/final-fixes.test.mjs`, `tests/final-fixes-ui.test.mjs`, edited ui-render / carry / field tests):
- **CORE-CFG1 / REQ-R33 (S = A on topaz and sapphire sword gems):** topaz stunChance A 26 -> 25, sapphire slowPct B 18 -> 17 and A 19 -> 18 (C and S unchanged);
  specials and day2 output identical, so T-R33 / T-R7 / T-GEAR (a) (b) did not move (T-GEAR (c) 86.3 / 73.3 -> 85.1 / 71.6, T-D ok). A test checks every gem table rises.
- **REQ-R24:** the durability bar, number and Repair button are one non-wrapping group (`.rp-dur`); the gear list is a container (`.gl-box`) that becomes cards below 500 px,
  so the button is right of the durability on both tabs at 390 to 1920 px (Chromium check at 1024 and 1280 among them).
- **REQ-R18:** a gem's outcome hover shows only your current chances. **NUM-1:** the Adventurer tab, the plan screen, the Skills tab and the roster's Hidden-attributes row
  show scouting per tier. **NUM-2:** a defence past the cap shows the capped value with "(cap)". **E2E-8:** margins read "100% (-14)" / "0% (+10)". **E2E-9:** "<1%" instead of "0%".
- **R28-1 / E2E-3:** the combat log's Attacker and Effects columns are wider (the Result text wraps instead of being cut at any width). **E2E-4:** the Wear column's note says it is the
  fall in the whole numbers shown and can differ by 1% from the roll (the roll is not changed). **CORE-DUR2:** the scrap note says "its durability (shown as 66%, rounded down)" when
  the stored value has decimals. **CORE-DUR1:** `couldBreakShown` flags by the whole numbers on screen (warnings and the confirm); `couldBreak` (stored value) stays for the real break.
- **PLAIN-1 / E2E-10:** real plurals, "found nothing", whole debris numbers in the search and carry messages. **TIME-1:** repair times use `formatDuration`.
- **R38-1:** the Gems column is second in the gear overview. **E2E-5:** a gem tile is dashed when no grade has a whole cut gem. **E2E-6:** the intel table is cards at 560 px and below.
- **E2E-2:** Search area and Return to camp sit right under the field grid on phones (the 4-row top bar at 360 px is left as it is). **E2E-7:** a toast is dropped when the phase changes.
- **TOUCH-1:** `tip()` on the rock, the field item tags, the combat log Effects cell, the disabled Spend button (on a wrapper) and the ring-limit reason (on the row).
- **CORE-TIME1:** `loadOnArrival`: travelling into a field counts min(bag, carried + its pile) in the walk home (the travel check, the map tooltips and the carry dialog use it).
  A search's own finds are still not counted in its reserve (small, left). **CORE-INTEL1:** no intel point on a day that ends the run; `spendIntel` refuses in `over`.
- **CORE-SAVE1:** `assertStructure` refuses a same-version save with a broken phase, roster, map, storage, gear, plan, ...; the error screen backs the save up first.
  **CORE-SAVE2:** a `storage` event from another tab locks the stale tab (`stale` in `js/main.js`); checked in Chromium with two tabs.
- **CORE-CFG2 (Foresight [1,1,2,2,2]):** kept (whole-number counts, A2's cap); Help says neighbouring grades can be equal, BALANCE.md Known misses 8.
- **DOCS-1:** README ("How to play", structure, tests, balance tool, save data), CHANGELOG (2.0 section, save table row), BENCHMARKS (2.0 rows), SPEC (rewritten for 2.0),
  BALANCE.md top (levers, targets, Known misses, 1.2 -> 2.0 changes), TUNING-2.0.md (notes 1, 4, 5, 7, final table, final pass), this file.
Not fixed, documented (each needs a decision or is not a defect):
- **REQ-R7** (champions never reach the bottom of 0-25: they never roll Low specials; 10% are above 25) and **REQ-U1 / E2E-1** (gear outruns the enemies on days 3-20, falls behind after
  day 30; one Iron D sword puts day-3 champions at 85-91%): changing them means changing the design or the economy, which the instruction for the pass forbade. Numbers and options are in
  BALANCE.md Known misses 1 and 3 and TUNING notes 1 and 5. **REQ-R6** (uneven base steps), **REQ-R44** (flat Battle simulation steps), **REQ-R33** (late-game Chilling): Known misses 6, 7, 9.
- Left small: the top bar on a 360 px phone (4 rows with a fight and an intel point), the search reserve not counting its own finds, `docs/BALANCE.md` chapter worked examples.

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

- Session 7 (version 2.0; commits 60de81b ... d7dadb0, then the final review fixes): the 46 requests R1-R46 and the answers A1-A4 / U1-U3 (see "Decisions from the
  user for 2.0"), built in seven batches from `docs/PLAN-2.0.md` (foundation, skills / travel / repairs, enemies / combat / gems, banners and the automatic
  estimate, player-facing UI, the balance tool's personas, tuning). Final review: a team of reviewers and verifiers checked the shipped game against the
  requests; the verified findings were fixed (see "Final review pass" in "Plan deviations"): the topaz and sapphire sword gem tables rise to S, the Adventurer tab
  keeps the Repair button on the durability line, the phone field screen has its search buttons under the grid, scouting is shown per tier, a defence past the
  cap shows the capped value, margins never read past 0 and 100, the walk home counts a destination's pile, a lost fight awards no intel point, broken saves are
  refused and backed up, a stale second tab is locked, and the docs pass 7c (README, CHANGELOG, BENCHMARKS, SPEC, BALANCE, TUNING, this file) was done.
  (Update this section each session.)
