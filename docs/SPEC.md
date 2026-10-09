# Smithsy — Game Spec (requirements + decisions)

This is the source of truth for *what* the game does (version 2.0). Exact numbers live in `js/config.js`
and are explained in `docs/BALANCE.md`; the values changed for 2.0 and why are in `docs/TUNING-2.0.md`. Numbers quoted
here are the current defaults, for context. The user's requests (R1-R46), answers (A1-A4) and decisions (U1-U3) are
numbered in `docs/PLAN-2.0.md`; they are cited below as (R7), (A3) and so on.

## Premise
You are a miner/blacksmith supporting an adventurer. You gather ore and gems, refine them,
and smith gear. The adventurer fights one enemy per day with your gear. The game is about
numbers and luck: most numbers and chances are shown so the player can make informed decisions;
randomness adds luck and variety. Starting numbers are round.

## Run structure
- Endless. Each win scores points by tier (normal 10, elite 25, champion 50). **No score and no points are shown while
  the run goes on** (R32, U3): not in the top bar, the report, the Help or the Log. The run summary shows the score,
  explains how it is made up and shows the best score of this version (remembered per version).
- **A lost fight is game over** (permadeath). **End run** (top bar) retires the adventurer by choice and scores the run
  exactly like a lost fight would (R32); a fight planned for today does not happen. No time limit on fights. An internal
  safety cap (10 hours of fight time) only prevents infinite loops; reaching it is a draw: the adventurer survives, gets no
  ring and no score, and used gear still wears.
- Fights cannot be skipped: every day from day 2 the adventurer fights one enemy.
- After a lost fight the run summary replays it 500 times with the gear used (same enemy, now fully known, same rings) and
  shows the spread of outcomes as a bar (lost badly, lost close, drew, won close, won easily), where this fight sits in it
  and whether gear left at home would have helped (R27).

## Time
- Day runs 8:00 → 18:00 (600 minutes). Only activities cost time: travel, searching (which also clears debris; each
  never-searched "fresh" cell in the area adds 2 minutes, see Fields), refining, cutting, smithing and repairing.
  Choosing what to carry and moving items between the bag and a field's pile is free.
- Field actions are only allowed if there is still time to walk back to camp by 18:00 **with a full load**: a search needs
  time for the walk home carrying the bag plus this field's pile, up to the bag size (20). Leaving items behind does not
  buy extra time. Travelling out to a field (from camp or from another field) needs time for the trip there and back to camp
  with the most you could bring home: what you carry in plus what waits in the destination's pile, up to 20. The trip back to
  camp is always allowed (it may end past 18:00).
- Camp work (refine, cut, smith, repair) must finish by 18:00.
- **The day does not end by itself at 18:00.** The player presses "End day", which only works at camp.
- **Work-day bar.** A thin bar along the bottom edge of the top bar shows the share of the day that has passed: it fills
  from left to right (R15), yellow at 75% used, red at 90% (`display.dayBarWarnPct`, `dayBarLowPct`). The "Xh Ym left" text stays.
- Times read like "2h 1.8m" everywhere, including repair times.

## Day flow
- Day 1: the adventurer rests (no fight).
- Each morning the roster for **tomorrow's** fight is visible (7 enemies: 2 normal, 3 elite, 2 champion). A new roster is
  generated every day.
- End of day N ("End day" at camp):
  1. If the adventurer fought today: the fight is resolved and the battle report is shown (gear used and gear not used,
     wear, combat log, banner, ring, the win estimate the plan showed). A loss → game over.
  2. Every 5th day the adventurer survives: +1 intel point (a fight that ends the run awards none).
  3. Plan tomorrow: choose 1 enemy from the roster (a comparison table, see Battle), pack gear (up to **2 items per gear
     type**, more with pack mules), choose adventurer rings (up to 10). Confirm → day N+1 starts. **Intel points that can
     still raise a track must be spent first** (R45): confirming is refused until they are.
- While the battle report, plan or run summary is open, the Rings, Skills & Intel, Log and Help tabs stay available
  (reference while planning). The Map, Workshop and Adventurer tabs belong to the work day.
- **There are no night repairs** (A3). Repairs are made by day, at camp, cost time, and only on gear the adventurer does
  not have: packed gear is away all day and can be neither repaired nor scrapped. The plan screen warns about packed gear
  that could break in the chosen fight (R11) and has a "Leave worn gear home" button; the default pack skips items that
  need a rest.
- When the fight starts, the enemy's attributes become fully known and the adventurer automatically uses the best packed
  item for each slot against that enemy (decided by simulation).
- The map does not change overnight: a searched cell stays searched for the whole run, so the map is the whole supply.

## World map
- 7x7 map, camp in the center (R2). 8 random map cells are blocked (impassable); every field stays reachable, and a map is
  made again when the rocks force any field more than 2 steps farther than the straight walk. The other 40 cells are fields.
- Travel is 15 minutes per step of the shortest path around blocked cells, plus 2.5% for every carried item. Travel between
  fields is allowed. The **Travel** skill (XP: 15 per map step walked, on every trip) shortens travel; the **Carrying** skill
  (XP: 2 per item carried one map step) cuts the extra time per item (R4, R5).
- Farther fields are richer: more items per cell, more coal, mythril only at distance 5+, gems rising from 15% to 25% of the
  finds (R29); every gem type is equally likely at every distance.
- The map shows how much of each field has been searched and how many items wait in its pile.

## Fields (9x9)
- Each field is 9x9 cells, drawn as 9 plots of 3x3 (any cell may be the centre of a search). Each cell may hold ores (copper,
  iron, coal, mythril — increasing rarity) and gems (ruby, topaz, sapphire, emerald, diamond), each with a hidden depth and a
  hidden **sight threshold**.
- **Sight (R31).** Ore sight is always on: in the field you stand in you see the items still in the ground whose sight
  threshold is at most your sight (a tag on the cell; nothing else about the ground is shown; sight sees through debris).
  Sight = Ore sight intel + Ore sight rings, and it is 0 on day 1. Thresholds (whole numbers above the first value up to the
  second): copper 1-40, iron 11-60, coal 16-70, gems 16-80 (all gems share one range), mythril 51-100.
- Search a 3x3 area (costs time): 27 minutes plus 2 minutes for every **fresh** cell in the area (a cell no search has worked
  on yet; marked with a dot), before the search-time reductions. Each search adds 30% ± 5 to every cell in the area (each cell
  rolls its own amount), so about four searches finish a cell (R37); an item is found when the cell's searched % passes its
  depth. Search efficiency bonuses (ring + skill) raise the average; the map shows the current range.
- **Debris** covers about 15% of cells with a thickness of 20-60 (in search effort; a search gives each cell about 30),
  shown on the cell. There is no clear action: a search spends each debris cell's effort roll, multiplied by the debris
  clearing power (1 + Debris clearing skill %), on the debris first; leftover effort searches the cell in the same search.
  Debris cells are a bit richer.
- **Boulders:** 2 per field near camp, up to 4 far away (fixed per distance, R3), clearly visible, never searchable, hold
  nothing and do not count toward a field's searched %.
- **Field pile and choosing what to carry:** everything a search finds goes to that field's pile (no limit; it stays for the
  rest of the run). In the field, single items can be moved between the bag and the pile for free. When the player leaves a
  field whose pile has items, a "Choose what to carry" step lists the bag and the pile with a checkbox per item: up to 20
  items (1 raw ore or gem per slot) can be carried and the rest stays in the pile. The default is "Rarest first". The step
  shows the travel time for the chosen load and refuses a load that could not get back to camp by 18:00 for a
  field-to-field trip. Arriving at camp unloads everything carried into unlimited storage.
- On a phone the field screen shows **Search area** and **Return to camp** right under the grid.

## Processing
- Refine ores into bars: copper, iron, steel (iron + coal), mythril. Cut gems. Better ores take longer (copper 17, iron 23,
  steel 29, mythril 35 minutes; gems 20).
- Outcomes are failure or a grade D, C, B, A, S, always shown **from lowest to highest, left to right (Fail, D, C, B, A, S)**.
  Each bar type has its own distribution with 10% failure, more skewed toward D for better ores. The Workshop shows the
  (bonus-adjusted) distribution before each action and the time each attempt takes, next to the buttons (R17, R30); for gems
  it shows only the **current** chances (R18). The result box is red when any attempt in a batch failed (R16).
- **Gem cutting goes from novice to master.** Every gem starts on the novice table (Fail 15, D 45, C 25, B 10, A 4, S 1). The
  gem's grade skill blends it toward the master table (Fail 10, D 20, C 25, B 22, A 15, S 8): 10% of the way per level.
  Failure is the novice 15% minus the gem's cutting skill (0.5 points per level). Gem luck rings upgrade successes on top.
- **General refining and General cutting skills (R36)** slightly lower failure and time (and, for cutting, move the blend a
  little) for every material; the skills of the exact bar or gem type count far more.

## Gear
- Sword (2 bars), chest (3), helmet (2), gloves (2), boots (2). All bars must be the same material and grade; the gear's
  grade equals the bars' grade. Stat = slot base × material multiplier (copper 1, iron 1.45, steel 2.1, mythril 3) × grade
  multiplier (D 1, C 1.1, B 1.2, A 1.3, S 1.55). **Materials overlap (R21):** an S piece of one material is better than a D
  piece of the next and worse than its C.
- Armor: defense (% damage reduction). Chest > helmet > gloves = boots. Gloves add accuracy. Boots add speed and dodge. Sword:
  damage (16) and accuracy.
- Smithing takes 15 minutes per bar (+10 to infuse a gem); each bar type's **Smithing skill** makes it faster (R34). Gear is
  chosen by clicking type, material, grade and gem tiles (R19); durability is not shown when crafting (R20) and the gem goes
  back to "none" after a craft (R26).
- Optional: consume a cut gem when smithing to infuse a bonus (the gem's grade, not the gear's, sets the strength):
  - Ruby: weapon magic damage (% of weapon damage, ignores defense) / armor magic resistance
  - Topaz: weapon stun chance and duration / armor stun chance and duration reduction
  - Emerald: weapon accuracy / armor dodge
  - Sapphire: weapon slow and duration on hit / armor slow strength and duration reduction
  - Diamond: weapon piercing / armor pierce resistance
  - Armor gem effects are 25% stronger on chests and 10% stronger on helmets. Every gem table rises from D to S (S is never
    worth the same as A on every stat). Against a High special, armor with the matching gem beats emerald armor against that
    enemy (R33); a sword gem is blunted by the matching High resistance.
- **Gear view (R38):** the Workshop's overview lists, per gear type, the items by material with a tag for each gem, and the
  gem types that type carries (the Gems column comes right after the type, so it is the first thing seen on a phone).
- **Durability.** Each fight costs every item the adventurer actually *used* a whole-number roll of 8-12%, times the enemy
  tier's multiplier (normal 1, elite 1.1, champion 1.2), times (1 − Gear care %), kept to one decimal inside and at least 1%.
  **The screen shows whole numbers, rounded down (R9)**; costs and times use the exact value. Packed-but-unused items do not
  wear. An item always lasts the whole fight it is used in; at 0% afterwards it is destroyed. The could-break flag compares
  the whole numbers on screen: an item showing no more durability than the fight's worst wear (rounded up) is flagged.
  **Repair** only to 100%; cost = 35% of the original bars (and cut gem) × the fraction repaired, in fractional materials
  (0.01 precision), and time = 2.5 × the smithing time × the fraction repaired, cut by the repair skills (the bar type's
  Repair 3% per level, its Smithing 0.5%, General repair 1%; capped at 75%). The Repair button sits to the right of the
  item's durability (R24). A repair uses bars (and gem) of the item's own grade if there is enough; otherwise the lowest
  higher grade that has enough on its own, with a warning; no benefit.
- **Scrap (A4, R10):** destroys the item and returns bars only: 35% × its bars × its stored durability, of its own material and
  grade, rounded down to 0.01. The gem is lost. No time. It cannot be done on packed gear.

## Enemies
- 7 per roster: 2 normal, 3 elite, 2 champion. HP and damage grow each day (linear, +6.3% a day), accuracy and dodge grow
  more slowly (+0.3% a day). The growth is never shown (R8).
- Base stats on day 1 (HP / damage / defense): normal 82 / 9.2 / 22%, elite 88 / 10 / 23%, champion 89 / 10.1 / 24% (R6:
  elites a little tougher than normals, champions a little more than elites; the real effect of the first step is large, see
  `docs/BALANCE.md` "Known misses"). Tiers also differ by attribute levels, score and ring grades.
- 12 attributes, each Low / Normal / High, displayed in pairs (offense left, defense right): Piercing | Pierce resistance,
  Magical | Magic resistance, Stunning | Stun resistance, Accurate | Evasion, Chilling | Slow resistance, Fast | HP. **Low
  means none** for every special and resistance (R40, R41): a Low Magical enemy deals no magic damage and a Low Chilling enemy
  never slows. Accurate, Evasion, Fast and HP are core stats and only move a little.
- Counts: normal = 6 low + 6 normal; elite = 3 low + 6 normal + 3 high; champion = 6 normal + 6 high. Assignment is random.
- The specials at Low / Normal / High: Magical 0 / 5 / 9 % of its damage as extra magic; Piercing 0 / 20 / 45 % of your defense
  ignored; Stunning 0 / 5 / 15 % chance per hit for 1.8 s; Chilling 0 / 5 / 12 % slower for 3 s; Pierce resistance 0 / 25 / 60,
  Magic resistance 0 / 25 / 60, Stun resistance and Slow resistance 0 / 20 / 40.
- **Scouting.** Each attribute is independently visible with the Enemy scouting chance (10% base) × the tier's share (normal
  100%, elite 90%, champion 80%, R23); the ring reward's type is visible with the Ring type scouting chance and its grade
  with the Ring grade scouting chance × the grade's share (D 100%, C 90%, B 80%, A 70%, S 60%, R22). The per-tier numbers are
  shown on the Adventurer tab, the plan screen and the Skills & Intel tab.
- **Banners (R13, R14).** Every enemy marches under the Red, Black or Gold banner (random, no effect on its attributes). The
  banner is visible with the Banner scouting chance (20% base) and always shown in the battle report. For every 4 wins against
  the banner the adventurer has beaten most, it captures a **pack mule**: from then on it can pack one more item of one gear type
  (random type, each type at most once, so 5 pack mules at most). Wins over different banners do not add up; a draw or a loss
  counts for nothing.

## Battle
- **Attack bars.** Each side has an attack bar that fills in `interval / (1 + speed%)` seconds and attacks when full, then
  starts again. Both bars start the fight a random 0-50% full, so who strikes first is luck. If both fill at the same moment,
  the adventurer attacks first; a side at 0 HP does not attack.
- Hit chance uses an S-curve on accuracy vs dodge (diminishing returns), clamped to 5-95%. Damage is reduced by defense.
  **Piercing** ignores a % of the defender's defense. **Pierce resistance** ignores a % of the attacker's piercing (relative,
  not a subtraction). Magic damage ignores defense but is reduced by magic resistance. Defense and every resistance count at
  most 75% in combat; the screens show the capped value with "(cap)".
- **Stun:** on a landed hit, a chance to stop the target's attack bar from filling for a duration. **Slow:** every landed hit
  makes the target's bar fill X% slower for a duration. Neither stacks: a new stun extends the current one to the later end
  time; a new slow keeps the stronger strength and the later end time. Resistances reduce both the chance/strength and the
  duration.
- Full combat log with the "life remaining" columns aligned (R28), and a summary.
- **Gear used and not used (R27, R39).** The battle report lists the gear the adventurer used (with its wear) and the packed
  gear it did not use, separately. Gear left at home is not listed, except in the loss analysis when it would have helped.
- **Win-chance estimate (A2, R12).** It is worked out **automatically** for every enemy, on the plan screen and the Adventurer
  tab, with no button: **5 guesses x 5 test fights** per enemy (the adventurer picks the best packed gear for each guess with
  5 fights per combination, then fights 5 fresh fights). Draws count as survival. It is deliberately small and noisy, so every
  estimate shows its margin of error: "62% ± 14", written "100% (−14)" at 100% and "0% (+10)" at 0% so it never reads past the
  limits. Results are kept per selection (same gear, rings, intel and sizes always give the same numbers); changing the gear or
  ring selection cancels a run in progress. The plan keeps the estimate it showed, and the battle report reminds the player of it.
- **Two ways to make it steadier, only slightly (A2).** The **Battle simulation** intel track (+1 guess and +1 test fight per
  point, up to +3) and the **Foresight** smith ring (+1 / +1 / +2 / +2 / +2 for D to S, only the best ring counts) add to the
  base counts. Foresight does nothing in a fight.
- **Roster comparison table.** The roster of 7 is one table with **one enemy per column**: name, tier, base HP, damage,
  defense, ring reward, banner, how many attributes are hidden (and what chance each had of being seen), the Win estimate
  row (plan screen and Adventurer tab), then the offense rows and, below a Defense divider, the defense rows (R1: the enemy
  names are not repeated at the Defense section). On the plan screen a column (or its radio button) chooses the enemy.
- The plan screen also shows a **Matchup** table without simulating: hit chances, damage per hit, attack interval, damage per
  second, HP and a rough time to win/lose, with ranges for hidden attributes.

## Rings
- Each defeated enemy drops 1 ring (type uniform among all 18 types). Grade D/C/B/A/S maps to the type's 5 values. Normal: D-B,
  elite: C-A, champion: B-S.
- Smith and adventurer each wear up to 10 rings. Same type: best counts 100%, 2nd 50%, 3rd 25%, ... Foresight counts only the best.
- Smith rings: travel time, search time, search efficiency, ore sight (adds to sight), refining/cutting time, bar grade luck,
  gem grade luck, Foresight. Adventurer rings: piercing, pierce resistance, magic damage, magic resistance, stun resistance,
  accuracy, dodge, slow resistance, speed, health.
- Smith rings apply at once but can only be swapped at the start of a day or while planning, so the 10-ring limit is a real
  choice. Adventurer rings are chosen as part of the plan; toggling one on the Rings tab outside the plan only changes the
  default selection for the plan.

## Skills (automatic XP)
- Level 0-10, XP from doing the activity (XP for level L → L+1 = 100 × (L + 1)). **A level-10 skill equals a C-grade ring of the
  same kind** where a ring exists. 35 skills; hovering or tapping a skill shows what it gives now, what the next level gives and how
  to earn XP, and the screens do not list effects at level 10 or the number of maxed skills (R18, R43).
- Activity skills (work for every material): Travel, Carrying, Search speed, Search efficiency, Debris clearing, General
  refining, General cutting, General repair, **Gear care** (1% less wear per level; XP: 100 per fight the adventurer survives).
- Per bar type (copper, iron, steel, mythril): bar grade, refining, smithing, repair. Per gem type: grade, cutting.

## Intel
- 1 intel point at the end of every 5th day the adventurer survives (R45: it must be spent before the next day starts, whenever
  a track can still be raised). Six tracks: Ore sight, Enemy scouting, Ring type scouting, Ring grade scouting, Banner scouting
  and Battle simulation. **Each track has its own steps that shrink as points are spent (R44)** (for example Enemy scouting
  +6, +6, +6, +4, +4, +4, +3, ... from 10%, to a maximum of 100%; Battle simulation is a flat +1, up to +3, because its value is a
  whole number of guesses and fights). Enemy scouting gains less per point than before (R42). Spending reveals more of the
  current roster immediately. A point cannot be spent once the run is over.

## Versions, saves and releases
- The version is in `js/version.js` ('2.0') and shows in the top bar and in Help. The tenths place goes up for small changes,
  the ones place for big ones.
- **Saves are per version (A1).** A save is only loaded by the game version that wrote it, under its own key
  (`smithsy-save-2.0`, best score `smithsy-best-2.0`). 2.0 does not read or convert 1.x saves: it starts a fresh game and says so
  once, and leaves the 1.x keys untouched, so going back to 1.2 finds its save. Future versions likewise start fresh (a
  code-only fix may keep the version). A save that can't be loaded, or has a missing part (roster, map, gear, plan, ...), is
  kept as a backup (`smithsy-save-backup-<time>`) while a new game starts. If the game is open in two tabs, the tab that did not
  save last locks itself and stops saving.
- A release is merged into `main` through a pull request when it is easy to roll back. Every release is kept as a branch
  `release/vX.Y`, and `CHANGELOG.md` lists the changes per version and the rollback steps.

## Tech
- Static site (plain HTML + ES modules, no build) for GitHub Pages (`.nojekyll` in the root).
- `index.html` has a plain (non-module) start-up diagnostics script: if the game has not started a few seconds after load, it
  shows a box with the captured errors and the browser version. The code avoids the `||=` shorthand so older browsers (Firefox
  before 79) can read it; it still uses `?.` and `??` (Firefox 74+).
- `js/core/*` is DOM-free game logic (usable from Node for tests and the balance tool). `js/ui/*` renders screens; `js/main.js` is
  the shell. Every hover explanation is set with `tip()` (title + `data-tip`), which opens a popover on a tap.
