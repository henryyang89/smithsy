# Smithsy — Game Spec (requirements + decisions)

This is the source of truth for *what* the game does. Exact numbers live in `js/config.js`
and are explained in `docs/BALANCE.md`. Numbers quoted here are the current defaults, for context.

## Premise
You are a miner/blacksmith supporting an adventurer. You gather ore and gems, refine them,
and smith gear. The adventurer fights one enemy per day with your gear. The game is about
numbers and luck: most numbers and chances are shown so the player can make informed decisions;
randomness adds luck and variety. Starting numbers are round.

## Run structure
- Endless. Score = points per enemy defeated (normal 10, elite 25, champion 50). Best score saved.
- **A lost fight is game over** (permadeath). No time limit on fights. An internal safety cap
  (10 hours of fight time) only prevents infinite loops; reaching it is a draw: the adventurer
  survives, gets no ring and no score, and used gear still wears.
- Fights cannot be skipped: every day from day 2 the adventurer fights one enemy.

## Time
- Day runs 8:00 → 18:00 (600 minutes). Only activities cost time: travel, searching (which also
  clears debris), refining, cutting, smithing, repairing by day. Choosing what to carry and moving items
  between the bag and a field's pile is free, and so is the time for repairs made at night (see Gear).
- Field actions are only allowed if there is still time to walk back to camp by 18:00 **with a full
  load**: a search needs time for the walk home carrying the bag plus this field's pile, up to the bag size
  (20). Leaving items behind does not buy extra time. Travelling out to a field (from camp or from another
  field) needs time for the trip there and back to camp with the load you carry. The trip back to camp is
  always allowed (it may end past 18:00).
- Camp work (refine, cut, smith, daytime repair) must finish by 18:00.
- **The day does not end by itself at 18:00.** The player presses "End day", which only works at
  camp. Past 18:00 only the walk home (and free moves between the bag and the field's pile) is possible.

## Day flow
- Day 1: the adventurer rests (no fight).
- Each morning the roster for **tomorrow's** fight is visible (7 enemies: 2 normal, 3 elite, 2 champion).
  A new roster is generated every day.
- End of day N ("End day" at camp):
  1. If the adventurer fought today: the fight is resolved and the battle report is shown
     (combat log, durability wear, ring, and Repair buttons for the gear just used). Loss → game over.
  2. Every 5th day: +1 intel point.
  3. Plan tomorrow: repair any gear (Repair buttons), choose 1 enemy from the roster, pack gear
     (up to **2 items per slot**), choose adventurer rings (up to 10). Confirm → day N+1 starts.
- **Night = the battle report and plan screens.** All gear is home then, and repairs cost materials but
  **no time** (no camp visit needed). The game-over screen is not night.
- While the battle report, plan or game-over screen is open, the Rings, Skills & Intel, Log and
  Help tabs stay available (reference while planning). The map, workshop and adventurer tabs are not.
- During day N+1 the adventurer is away with the packed gear: **packed gear cannot be repaired**
  (or scrapped) that day. Unpacked gear at home can be repaired at camp (costs time). Gear comes back at
  the end of the day, in time for the free night repairs.
- When the fight starts, the enemy's attributes become fully known and the adventurer
  automatically uses the best packed item for each slot against that enemy (decided by simulation).
- Fields do not regrow (for now): nothing changes on the map overnight (see Fields).

## World map
- 5x5 map, camp in the center. 4 random map cells are blocked (impassable); every field stays
  reachable. The other 20 cells are fields.
- Travel time depends on path distance (steps around blocked cells). Travel between fields is allowed.
- Items carried slightly increase travel time (+1% per item).
- Farther fields are richer: more items per cell and rarer ores. No coal next to camp;
  mythril only in the farthest fields (distance 4+). **Every gem type is equally likely, at every
  distance** (user decision, v1.1).
- The map shows how much of each field has been searched and how many items wait in its pile. Fields
  persist for the whole run.

## Fields (8x8)
- Each cell may hold ores (copper, iron, coal, mythril — increasing rarity) and gems (ruby, topaz,
  sapphire, emerald, diamond). Contents are hidden.
- Search a 3x3 area (costs time). Each search only searches part of each cell (shown as
  "% searched" with a visual fill). Each item has a hidden depth; it is found when the cell's
  searched % passes its depth. **Each search adds 35% ± 5 to every cell in the area, and each cell
  rolls its own amount (30–40%), so about 3 searches finish a cell** (at base efficiency about 1 cell in
  6 needs a 4th). Search efficiency bonuses (ring + skill) raise the average and so matter more: from
  about +10% every cell finishes in 3 searches, and big stacks (about +29% and up) finish some cells in 2.
  The map shows the current range.
- Ore sight: each searched cell that the search did not finish (still below 100%) and that is not yet
  revealed has a chance to reveal everything still in it. (A debris cell only rolls once some of the
  search's effort reached the cell itself.)
- **Debris is cleared by searching (user decision, v1.1).** About 15% of cells are covered by debris with
  a random thickness of 20–60 (in search effort; a search gives each cell about 35). The thickness left is
  shown on the cell. There is no separate clear action: a search spends each debris cell's effort roll,
  multiplied by the debris clearing power (1 + Debris clearing skill %), on the debris first; any effort
  left over searches that cell in the same search. A cell under debris cannot be searched until its
  debris is gone. Debris cells are a bit richer.
- **Boulders (user decision, v1.1):** every field has 1 boulder cell, clearly visible (a dark rock), that
  can never be cleared or searched and holds nothing. Boulders do not count toward a field's searched %.
- **No regrowth (user decision, first draft):** fields do not regrow; a searched cell stays searched
  for the rest of the run, so the map (about 1,540 items) is the whole supply of a run. The mechanism
  is kept but off (`CONFIG.field.regrowPctPerDay` = 0). When it is above 0, each night every searched
  cell (partly or fully) has that % chance to become a fresh, unsearched cell with new hidden contents
  (and a new debris roll); boulders, never-searched cells and the field's pile do not change.
- **Field pile and choosing what to carry (user decision, v1.1):** everything a search finds goes to
  that field's pile (no limit; it stays for the rest of the run). In the field, single items can be moved
  between the bag and the pile for free. When the player leaves a field whose pile has items, a "Choose
  what to carry" step lists the bag and the pile with a checkbox per item: up to 20 items (1 raw ore or
  gem per slot) can be carried, and the rest stays in the pile. The default is "Rarest first": keep the
  bag, then fill the free slots from the pile in the order mythril, diamond, emerald, sapphire, topaz,
  ruby, coal, iron, copper. "Keep current bag" and "Clear" are one-click alternatives; the step shows the
  travel time for the chosen load and refuses a load that could not get back to camp by 18:00 (for a
  field-to-field trip). Arriving at camp unloads everything carried into unlimited storage.

## Processing
- Refine ores into bars: copper, iron, steel (iron + coal), mythril. Cut gems. Better ores take a bit
  longer (copper 15, iron 20, steel 25, mythril 30 minutes; gems 20).
- Outcomes are failure or a grade D, C, B, A, S. **Grades are always shown from lowest to highest, left to
  right (Fail, D, C, B, A, S)** (user decision, v1.1). Each bar type has its own distribution with 10%
  failure, more skewed toward D for better ores. The UI shows the (bonus-adjusted) distribution before
  each action.
- **Gem cutting goes from novice to master (user decision, v1.1).** Every gem starts on the novice table
  (Fail 15, D 45, C 25, B 10, A 4, S 1). The gem's grade skill blends it toward the master table (Fail 10,
  D 20, C 25, B 22, A 15, S 8): 10% of the way per level, the master table at level 10. Failure is the
  novice 15% minus the gem's cutting skill (0.5 points per level); D to S follow the blend and fill the
  rest. Gem luck rings then upgrade successes on top. The Workshop shows the novice and master tables.

## Gear
- Sword (2 bars), chest (3), helmet (2), gloves (2), boots (2). All bars must be the same material
  and grade; the gear's grade equals the bars' grade.
- Armor: defense (% damage reduction). Chest > helmet > gloves = boots.
  Gloves add accuracy. Boots add speed and dodge. Sword: damage and accuracy.
- Optional: consume a cut gem when smithing to infuse a bonus (grade of gem independent of gear):
  - Ruby: weapon magic damage (% of weapon damage, ignores defense) / armor magic resistance
  - Topaz: weapon stun chance + duration / armor stun chance + duration reduction
  - Emerald: weapon accuracy / armor dodge
  - Sapphire: weapon slow + duration on hit / armor slow strength + duration reduction
  - Diamond: weapon piercing / armor pierce resistance
  - Armor gem effects are 25% stronger on chests and 10% stronger on helmets.
- Durability: each fight costs every item the adventurer actually *used* a random small % (3–7).
  Packed-but-unused items do not wear. 0% = destroyed.
  Repair only to 100%; cost = 35% of original materials (bars + gem) × fraction repaired
  (fractional materials, 0.01 precision).
  - **By day:** at camp, and it costs time (50% of the smithing time × fraction repaired).
  - **At night** (battle report and plan screen): any gear, materials only, **no time**.
  - **Higher grade as a substitute:** a repair uses bars (and gem) of the item's own grade if there is
    enough; otherwise the lowest higher grade that has enough on its own. Bars and gem are chosen
    separately, and the UI shows a warning. There is no benefit: the item keeps its grade.
    Grades are never combined (0.1 C + 0.3 B bars do not make a 0.4-bar repair).

## Enemies
- 7 per roster: 2 normal, 3 elite, 2 champion. HP and damage grow slowly each day (linear), accuracy
  and dodge grow more slowly.
- **All tiers share the same base HP, damage and defense** (currently 80 / 8 / 20%; user decision:
  champions must not have higher HP, damage or defense than elites or normals, because win rates were too
  low). Tiers differ only through their attribute levels (below), their score and their ring grades.
- 12 attributes, each Low / Normal / High, displayed in pairs (offense left, defense right):
  Piercing | Pierce resistance, Magical | Magic resistance, Stunning | Stun resistance,
  Accurate | Evasion, Chilling | Slow resistance, Fast | HP.
  Fast and HP have small steps between levels.
- Counts: normal = 6 low + 6 normal; elite = 3 low + 6 normal + 3 high; champion = 6 normal + 6 high.
  Assignment is random (uncorrelated).
- Each attribute is independently visible with a chance (intel). The ring reward's type and grade
  are also each visible with a chance.

## Battle
- **Attack bars.** Each side has an attack bar that fills in `interval / (1 + speed%)` seconds and
  attacks when full, then starts again. Both bars start empty. If both fill at the same moment,
  the adventurer attacks first; a side at 0 HP does not attack.
- Hit chance uses an S-curve on accuracy vs dodge (diminishing returns), clamped to 5–95%.
- Damage is reduced by defense. **Piercing** ignores a % of the defender's defense. **Pierce
  resistance** ignores a % of the attacker's piercing (relative, not a subtraction). Magic damage
  ignores defense but is reduced by magic resistance.
- **Stun:** on a landed hit, a chance to stop the target's attack bar from filling for a duration.
  **Slow:** every landed hit makes the target's bar fill X% slower for a duration. Neither stacks:
  a new stun extends the current one to the later end time; a new slow keeps the stronger strength
  and the later end time. Resistances reduce both the chance/strength and the duration.
- Full combat log (Backpack-Battles style) + summary.
- Optional pre-fight win-chance simulation (player clicks to run). Hidden attributes are sampled
  consistently with the tier's low/normal/high counts; for each sample the adventurer picks the best
  packed gear. Draws count as survival.
- The plan screen also shows a **Matchup** table without simulating: hit chances, damage per hit,
  attack interval, damage per second, HP and a rough time to win/lose, with ranges for hidden attributes.

## Rings
- Each defeated enemy drops 1 ring (type uniform among all 17 types). Grade D/C/B/A/S maps to the
  type's 5 values. Lower grades are more likely. Normal: D–B, elite: C–A, champion: B–S.
- Smith and adventurer each wear up to 10 rings. Same type: best counts 100%, 2nd 50%, 3rd 25%, ...
- Smith rings: travel time, search time, search efficiency, ore sight (see all items in a cell),
  refining/cutting time, bar grade luck, gem grade luck.
- Adventurer rings: piercing, pierce resistance, magic damage, magic resistance, stun resistance,
  accuracy, dodge, slow resistance, speed, health.
- Smith rings apply at once but can only be swapped at the start of a day (8:00 at camp, before the first
  action) or while planning at night, so the 10-ring limit is a real choice. Adventurer rings are chosen as part of the
  nightly plan; toggling an adventurer ring on the Rings tab outside the plan only changes the default
  selection for tonight's plan, never today's fight.

## Skills (automatic XP)
- Level 0–10, XP from doing the activity. **A level-10 skill equals a C-grade ring of the same kind**
  (time skills 0.6% per level = 6%, search efficiency 1.2% per level = 12%, bar grade luck 0.3% per level
  = 3%). Skills with no ring: debris clearing +10% debris cleared per search per level (+100%, twice as
  much, at level 10; XP = 1 per point of debris cleared), refining/cutting failure 0.5 points per level
  (−5 points at level 10), gem grade 10% of the way from the novice to the master cutting table per level
  (the master table at level 10). Return travel only counts on trips to camp.
- Return travel time, search time, search efficiency, debris clearing, refining time, cutting time, bar
  grade (per bar type), gem grade (per gem), refining failure (per bar type), cutting failure (per gem).

## Intel
- 1 intel point every 5 days. Spend on: ore sight chance, enemy attribute sight, ring type sight,
  ring grade sight. Diminishing returns (+10, +9, +8, ... points). Spending reveals more of the
  current roster immediately.

## Versions and releases (user decisions, v1.1)
- The live game (GitHub Pages, deployed from `main`) is version 1.0; this release is 1.1. The version is
  in `js/version.js` and shows in the top bar and in Help.
- Version numbers: the tenths place goes up for small changes (1.1, 1.2, …), the ones place for big ones
  (2.0).
- A release is merged into `main` (automatically, via pull request) when it is easy to roll back. Every
  release is kept as a branch `release/vX.Y` (git tags can't be pushed from the build environment), and
  `CHANGELOG.md` lists the changes per version and the rollback steps.

## Tech
- Static site (plain HTML + ES modules, no build) for GitHub Pages (`.nojekyll` in the root).
  Saves in localStorage under `smithsy-save-v2`; a v1.0 save (`smithsy-save-v1`) is converted on first
  load (ground items → field pile, debris → thickness 40, no boulders on the old map), and a save that
  can't be loaded is kept as a backup while a new game starts.
- `index.html` has a plain (non-module) start-up diagnostics script: if the game has not started a few
  seconds after load, it shows a box with the captured errors and the browser version to send to the
  developer. The code avoids the `||=` shorthand so older browsers (Firefox before 79) can read it; it
  still uses `?.` and `??` (Firefox 74+).
- `js/core/*` is DOM-free game logic (usable from Node for tests/balance tools).
- `js/ui/*` renders screens; `js/main.js` is the shell.
