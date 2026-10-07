# Smithsy — Handoff

Everything needed to pick this project up in a fresh session.

## What it is
Browser game: you mine ore/gems on a 5x5 world map of 8x8 fields, refine and smith gear, and each
night plan your adventurer's next fight (1 enemy from a roster of 7). A loss is game over; score is
endless. Plain HTML + ES modules, no build step, hosted on GitHub Pages, **deployed from `main`**
(<https://henryyang89.github.io/smithsy/>, folder `/ (root)`; see README). Save in localStorage.

**Version:** this branch is **1.1** (`js/version.js`, shown in the top bar and Help). The live game on
`main` is 1.0 until 1.1 is merged. What changed per version and how to roll back: `CHANGELOG.md`.

## Where things are
| Path | What |
|---|---|
| `js/config.js` | **Every tunable number.** Edit here to rebalance. |
| `js/version.js` | `VERSION` shown in the top bar and Help ('1.1'). Bump it for every release (see "Release process"). |
| `CHANGELOG.md` | What changed in each version (player terms) and the rollback steps. Read it, add to it each release. |
| `index.html` | Page shell + a plain-script start-up diagnostics box (shows captured errors and the browser if the game has not started a few seconds after load). |
| `docs/BALANCE.md` | Explains every number, formula, worked examples, tuning notes, current balance results. |
| `docs/SPEC.md` | Requirements + all design decisions agreed with the user. |
| `js/core/` | DOM-free game logic (works in Node). `game.js` = state, day flow, battle resolution, save (`SAVE_KEY` `smithsy-save-v2`, `SAVE_VERSION` 2, `migrateV1` for v1.0 saves). |
| `js/core/map.js` | World map, fields (`generateField`: debris thickness, 1 boulder), travel (with an optional carry selection), search (depth mechanic, 35% ± 5 per cell; clears debris first via `debrisClearMult`; finds go to the field's `pile`), carrying (`defaultCarry`, `setCarry`, `moveToPile`, `takeFromPile`, `projectedLoad`, `fitsWithReturn`), `fieldProgress` (boulders excluded), nightly regrowth (off). |
| `js/core/processing.js` | Refining/cutting, grade distributions (bars: fail reduction + upgrade luck; gems: `blendCutTable` novice → master, then Gem luck), `GRADE_ORDER` F, D, C, B, A, S (low → high). |
| `js/core/gear.js` | Gear stats, crafting, repair (`isNight`, `repairPlan`: free at night, higher-grade substitutes; `substituteWarning`). |
| `js/core/combat.js` | Combatant stats, hit chance S-curve, event-driven attack-bar fight sim with log. |
| `js/core/sim.js` | Best-gear selection and win-chance estimate (samples hidden enemy attributes). |
| `js/core/enemies.js` | Roster generation, attribute levels, visibility, enemy stats. |
| `js/core/rings.js`, `skills.js`, `intel.js`, `bonuses.js` | Rings (stacking), skills (XP), intel points, combined smith bonuses. |
| `js/main.js` | UI shell (top bar with version and pile count, tabs, side log, phase screens, save/load: reads `smithsy-save-v2`, else migrates `smithsy-save-v1`; a save that can't be loaded is kept as `smithsy-save-backup-<time>` and a new game starts; a render error offers "Start a new game"). |
| `js/ui/*.js` | One module per screen; `mapview.js` = world map (pile badges), field grid (debris numbers, boulders), pile and bag panels and the "Choose what to carry" step; `workshop.js` also shows the gem novice/master tables; `endday.js` = battle report + plan screen (incl. Matchup table and night repairs); `repairui.js` = repair widgets shared by the workshop and the night screens; `skillsview.js` also holds the skill-vs-ring helpers used by Help; `dom.js` = tiny `h()` helper. |
| `tests/` | `npm test` (= `node --test tests/*.test.mjs`), 274 tests in 15 files (+ `helpers.mjs`); `carry.test.mjs` (new in 1.1, 19 tests) covers piles, carry choice, travel with a carry and the projected-load time rule. |
| `tools/balance.mjs` | Balance report: economy (incl. map size, debris effort, trips found vs carried, gem novice/master odds), power curve, bot playthrough (incl. field piles and "Map supply"); `--set` what-ifs, `--ablate` systems, `--immortal`, `--carry value\|default`. |

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
  optimizes the gear for each sample.
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
  normal 80/8/20, elite 80/9/25, champion 90/10/30). Tiers differ only by attribute levels (normal 6 low /
  6 normal; elite 3 low / 6 normal / 3 high; champion 6 normal / 6 high), score (10 / 25 / 50) and ring
  grades (D–B / C–A / B–S). Target the user chose: champions ~30–40% win with on-pace gear, elites ~60–70%,
  normals 90%+, erring on the high side because the user wanted higher win rates. Result with plain C sets
  late in each material window (iron C day 10, steel C day 20, mythril C day 40): champions 48 / 32 / 21%,
  elites 83 / 74 / 63%, normals 99 / 95 / 92% (details in BALANCE "Balance targets and current results").

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
- **Enemy daily growth:** HP and damage +3%/day, accuracy and dodge +1%/day (linear), otherwise late-game
  hit chances saturate. (Tier base stats are no longer an interpretation: equal for all tiers, user
  decision in session 4, see above.)
- **Enemy Fast / HP steps:** small (±5% speed, 90/100/110% HP) as the user suggested.
- **Gem rebalance (sword):** ruby 5–15% magic (halved), emerald 20–60 accuracy and diamond 20–60% piercing
  (doubled), topaz 10–20% stun for 1–1.5 s, sapphire unchanged; aimed at ruby ≈ diamond ≈ sapphire swords.
- **Processing times:** copper 15, iron 20, steel 25, mythril 30 min per bar; gems 20 min ("slightly more
  time for better ores"); smithing 15 min per bar, +10 min to infuse a gem.
- **Durability:** only gear actually USED in the fight loses durability (packed-but-unused gear doesn't
  wear). Repairs by day take 50% of the craft time × fraction repaired (at night: no time, user decision);
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

## Balance status (version 1.1, commits e8886d2 + 247909d)
Run `node tools/balance.mjs --section economy`, `--section power` and `--section bot --seeds 40`
(`--immortal` for how long the map lasts); details and tables in `docs/BALANCE.md` → "Balance targets and
current results".

```
ECONOMY SUMMARY | items/search by dist d1:1.89 d2:2.10 d3:2.27 d4:2.41 d5+:2.60 | debris % of effort d1:5 d2:5 d3:5 d4:5
d5+:5 | one trip d1/d3: 244/302 min for 20.0/20.0 items (found 21.9/22.1, pile left 1.9/2.1) | field min per unit: copper 23,
iron 53, steel pair 129, mythril 525, any gem 42 | full set >=D work days: copper 1.1, iron 1.9, steel 3.7, mythril 12.7 |
gem cut skill 0: F 15% C+ 40% effect 0.77 of C | map items/run 1541 (mythril 12.4, coal 120) | regrow off

POWER SUMMARY | day-2 ref (Copper C sword + C chest + C boots) n/e/c 93/63/22% | Cu D sword n/e/c 66/26/4% |
last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d2, Iron C d10, Steel C d20, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80 100/97%

BOT SUMMARY | alive d10:88% d20:85% d30:83% d40:78% d50:63% d60:3% d80:0% | median life 53.0 | score 1192 |
d2 typical est n/e/c 94/69/33 | first iron/steel/myth piece d3/9/16 | 3-slot iron/steel/myth d6/11/22 |
d11-30 fights n/e/c 2/29/69% | mining 60% trips/day 1.3 idle 32m | repair 1.4% bars 0.0% time, 4.8 night/run
(1.0 subst.) | map found d40:82% d60:93% d80:-% | field: 3.40 found/search, carried 51% of found (10.2/trip, 56
from old piles), piles at end 591 (2.7 worth), debris 3.9% of effort | gems cut 310.0/run F/D/C+ 13/34/53%, 29.6 infused
```

- **1.0 vs 1.1** (both versions on the same 120 bot seeds, because 40 runs are too noisy here):
  survival the same within noise (median life 53.0 → 52.0; alive at day 40 / 50 / 60: 73 / 58 / 11% →
  76 / 56 / 13%); gems slightly weaker, so the mean score is 3% lower (1,204 → 1,164; champion wins 14.3 →
  12.9 per run); mining about 5–10% more efficient (mining minutes per found item on days 1–40 12.5–14.6 →
  11.6–12.8; economy: field minutes per copper / iron / steel unit −8–9%, items brought home per day +9–12%
  at distance 1–4); the map runs out about 4–5 days sooner (81% found by day 40 instead of 73%; immortal bot:
  finds fall to 15 a day on days 41–50 instead of 25). The power section is identical to 1.0 (combat,
  enemies and gear did not change). The 40-seed run above shows a 10% lower score than 1.0's 40 seeds
  (1,192 vs 1,323) only because 5 of its runs die on day 2 (noise; 7% die by day 2 over 120 seeds in both
  versions).
- **Careful: the economy SUMMARY's items/search changed meaning.** 1.0 counted only debris-free cells and
  left clearing minutes out (1.78 / 1.88 / 2.13 / 2.30 / 2.45); 1.1 counts whole fields with debris cleared
  by searching. On the same basis 1.0 was 1.82 / 1.95 / 2.16 / 2.32 / 2.57, so 1.1 finds 1–8% more per
  30 minutes of field work.
- **Win rates** (unchanged since session 4, equal tier base stats): plain C sets late in each material
  window (iron C day 10, steel C day 20, mythril C day 40) win 48 / 32 / 21% vs champions, 83 / 74 / 63% vs
  elites and 99 / 95 / 92% vs normals (target: champions ~30–40%, elites ~60–70%, normals 90%+, erring
  high).
- **Champions are the careful bot's main mid-game pick:** best champion estimate 95–99% on days 7–30,
  champions are ~70% of its fights on days 11–30 and it wins 14.0 per run; per-fight losses on days 11–40
  are 0.3–0.6%.
- Other targets: iron ~day 3–6, steel ~day 9–11, mythril ~day 16–22 (first piece / 3 of 5 slots; mythril a
  few days earlier than in 1.0); careful-bot median life 53, 31 of 40 deaths after day 40.
- **Gems:** the bot cuts ~310 gems per run (F 13 / D 34 / C+ 53%) and ends with gem skills of 3.1 (topaz)
  to 5.8 (emerald), about halfway to the master table. A novice's gems are worth 0.77 of a C gem per cut
  (1.0's fixed table: 0.98), a master's 1.08.
- **Field piles:** the bot carries home 51% of what it finds (10.2 items per trip) and ends a run with about
  590 items in piles, nearly all copper/iron/coal it no longer needs. With the game's own default carry
  (`--carry default`) it carries everything (15.9 per trip) and does worse: median 50, score 1,054.
- **Map exhaustion:** with no regrowth coal and mythril run low around day 45–50 (the bot has found 82% of
  the map by day 40, nearly all its ~13 mythril, and 92% by day 50; with `--immortal` finds drop from ~41 a
  day on days 31–40 to ~15 on days 41–50 and under 2 after that), so even a perfect player hits a wall
  around day 55–70. Regrowth at 5% (`CONFIG.field.regrowPctPerDay`) keeps ~28–30 finds a day and gives a
  median life of 56.5 instead of 53 (45% alive at day 60 instead of 3%).
- Ablations (40 seeds): `--ablate rings` (median 42.5, score 683), `--ablate gems` (median 43.5, almost
  every run dead by day 50), `--ablate repair` (median 45, score 1,091) and `--ablate skills` (median 49.5,
  score 1,062) clearly hurt; intel (52.0) is within noise for survival.

## Known concerns / ideas
- **Default carry includes junk.** "Rarest first" keeps the bag and then fills *every* free slot, so once
  the rare items are in, it tops the bag up with copper and iron the player may no longer need (each item
  +1% travel time). The bot with the game's default carries 15.9 items per trip instead of 10.2 and does
  worse (median life 50 vs 53, score 1,054 vs 1,192). Options (the user's call): stop the default at the
  rare items, skip materials with plenty in storage, or a per-type "don't carry" toggle.
- **Debris skill XP comes fast early.** XP is 1 per point of debris cleared and the first levels cost
  100 / 200 / 300 XP, so level 1 (+10% clearing power) comes after two or three debris cells and +30%
  after about 15; each level is worth +10% (other activity skills 0.6–1.2%). The bot ends runs at level 8.7
  (+87%); at level 10 every debris cell clears in one search. If it should grow slower: lower
  `CONFIG.skills.activity.debris.perLevel` (the 1 XP per point is fixed in `search` in map.js).
- **Firefox blank page: cause still unconfirmed.** 1.1 removed the `||=` shorthand (Firefox before 79
  can't parse it, a likely cause) and added the start-up diagnostics box; we are waiting for the box's text
  from the user to confirm. The code still uses `?.` and `??`, so Firefox before 74 would still fail (the
  box would say so).
- **The gem master table's failure value is not read.** Gem failure is always novice F − cutting skill;
  `CONFIG.cut.<gem>.master.F` only feeds the Help/Workshop label ("master at cutting level N"). Changing
  it alone changes no odds.
- **The finite map caps runs.** Fields do not regrow (user decision), so a map's ~1,540 items (~13–14
  mythril, ~122 coal) are the whole run. Coal and mythril run low around day 45–50 (4–5 days sooner than in
  1.0, because mining is faster) and a perfect player hits a wall around day 55–70; a matched mythril
  C-or-better set alone needs ~26 mythril on average, twice what a map holds. The careful bot dies around
  the same time (median 53) and regrowth at 5% would gain it ~3.5 days, so the map is one of its limits.
  Options (the user's call): turn regrowth back on (`CONFIG.field.regrowPctPerDay`), add mythril, or keep
  the cap as a natural run length.
- **Repairs never combine grades.** A repair takes the whole amount from one grade (exact, else the lowest
  higher grade with enough), so 0.30 C + 0.30 B bars cannot pay a 0.42-bar repair and small leftovers of
  different grades pile up. The bot has no usable bars for a worn top item on ~16 nights per run (mostly
  mythril once the map's mythril is gone) and still loses 1.4 items per run to wear. Combining grades would
  need the user's OK.
- **The Return travel skill only applies to trips to camp.** At level 10 it equals a C-grade Travel ring
  in number (6%) and the UI says so, but the ring counts on every trip, so the skill is worth about half a
  ring. Apply it to all travel (or double it) if the user wants an exact match.
- **Repairs matter.** Free night repairs: 4.8 repairs per run, all at night, 1.4% of bars;
  `--ablate repair` now costs ~8 days of median life (45 vs 53; 4.5 days in 1.0).
- **Pierce resistance and stun resistance are low value.** Enemy Piercing ignores at most 25% of your
  defense and Stunning is 5–15% for 1 s, so the Pierce/Stun resistance rings add ~0.4–1.6 win-% points
  and diamond/topaz armor almost nothing. Raise enemy Piercing/Stunning values to make them matter. With
  enemy defense at 20% for every tier, adventurer piercing is also modest now (the diamond sword is fourth
  of five sword gems; a Piercing ring adds +1.3–1.4).
- **Late game is mostly mining, then nothing to mine.** The bot's mining share (travel + search) is 62% on
  days 11–20 and 74–80% on days 21–40; after day 40 the map runs dry and it spends ~255 min a day cutting
  stockpiled gems and idles ~100 min.
- **Skills and intel:** `--ablate skills` costs ~3.5 days of median life and ~130 points of score (7.5 days
  in 1.0; the debris and gem skills now carry part of it). Intel still shows no measurable effect on the
  bot's survival (the estimate already averages hidden attributes); its score was ~11% lower without it,
  as in 1.0. Gems clearly pay (`--ablate gems`: median 43.5 instead of 53 and almost every run dies by day
  50; without gems the bot has nothing worth doing after mythril and idles most of the day).
- **Win-chance estimate cost:** up to 40 × (32 × 30 + 30) = 39,600 fights per estimate (~0.1 s in Node,
  longer in the browser, with a progress bar). The real battle's gear choice runs 32 × 200 fights. The bot
  estimates all 7 enemies daily, so a 40-seed bot run takes ~2–3 min.
- **Champions are the careful bot's main mid-game pick** since the tiers share base stats (session 4): best
  estimate 95–99% on days 7–30, ~70% of its fights on days 11–30, 14.0 champion wins per run. If the user
  wants champions to stay a rare, risky pick, the levers are the champion score, its ring grades
  (`CONFIG.rings.gradeWeights.champion`) or the attribute values, not base stats.
- Enemy growth is linear and unbounded while gear tops out at mythril S: every run ends (intended).
- About 0.7% of maps have a single distance-4+ field (the only mythril source); ~0.01% have none.
- Bot results are noisy (chaotic runs): compare what-ifs with `--seeds 40` or more; a difference as small
  as 1.0 vs 1.1 needed 120 seeds.

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
  defense 20% (`CONFIG.enemies.tiers`); tiers differ only by attribute levels, score and ring grades.
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
  (Update this section each session.)
