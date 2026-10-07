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
- Day runs 8:00 → 18:00 (600 minutes). Only activities cost time: travel, searching, clearing
  debris, refining, cutting, smithing, repairing by day. Picking up and dropping items is free, and so is
  the time for repairs made at night (see Gear).
- Field actions (travel out, search, clear) are only allowed if there is still time to walk
  back to camp by 18:00 with the current bag. The trip back is always allowed (it may end past 18:00).
- Camp work (refine, cut, smith, daytime repair) must finish by 18:00.
- **The day does not end by itself at 18:00.** The player presses "End day", which only works at
  camp. Past 18:00 only the walk home (and free pick-up/drop) is possible.

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
- Items in the bag slightly increase travel time (+1% per item).
- Farther fields are richer: more items per cell and rarer ores/gems. No coal next to camp;
  mythril only in the farthest fields (distance 4+).
- The map shows how much of each field has been searched. Fields persist for the whole run.

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
  revealed has a chance to reveal everything still in it.
- Debris covers some cells; it blocks searching until cleared (costs time). Debris cells are a bit richer.
- **No regrowth (user decision, first draft):** fields do not regrow; a searched cell stays searched
  for the rest of the run, so the map (about 1,560 items) is the whole supply of a run. The mechanism
  is kept but off (`CONFIG.field.regrowPctPerDay` = 0). When it is above 0, each night every searched
  cell (partly or fully) has that % chance to become a fresh, unsearched cell with new hidden contents
  (and a new debris roll); items lying on the ground stay and never-searched cells do not change.
- Bag: 20 slots, 1 raw item per slot. If full, found items stay on the ground (visible, can pick up later).
  Items can be dropped, and picked up one by one or all at once (free). A free pick-up may not make the
  walk home end after 18:00, except to refill the bag to the size it had after the last timed field action
  (so "drop everything, search, pick it all back up" doesn't beat the time rule, but late swaps work).
  Arriving at camp unloads the bag into unlimited storage.

## Processing
- Refine ores into bars: copper, iron, steel (iron + coal), mythril. Cut gems. Better ores take a bit
  longer (copper 15, iron 20, steel 25, mythril 30 minutes; gems 20).
- Outcome grades S, A, B, C, D or failure (10%). Each bar type has its own distribution, more skewed
  toward D for better ores. The UI shows the (bonus-adjusted) distribution before each action.

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
  (time skills 0.6% per level = 6%, search efficiency 1.2% per level = 12%, grade luck 0.3% per level
  = 3%). Skills with no ring: debris clearing 5% per level (−50% time at level 10), refining/cutting
  failure 0.5 points per level (−5 points at level 10). Return travel only counts on trips to camp.
- Return travel time, search time, search efficiency, debris clearing (no ring counterpart), refining
  time, cutting time, bar grade (per bar type), gem grade (per gem), refining failure (per bar type),
  cutting failure (per gem).

## Intel
- 1 intel point every 5 days. Spend on: ore sight chance, enemy attribute sight, ring type sight,
  ring grade sight. Diminishing returns (+10, +9, +8, ... points). Spending reveals more of the
  current roster immediately.

## Tech
- Static site (plain HTML + ES modules, no build) for GitHub Pages (`.nojekyll` in the root).
  Saves in localStorage.
- `js/core/*` is DOM-free game logic (usable from Node for tests/balance tools).
- `js/ui/*` renders screens; `js/main.js` is the shell.
