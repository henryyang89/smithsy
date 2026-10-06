# Smithsy — Game Spec (requirements + decisions)

This is the source of truth for *what* the game does. Exact numbers live in `js/config.js`
and are explained in `docs/BALANCE.md`.

## Premise
You are a miner/blacksmith supporting an adventurer. You gather ore and gems, refine them,
and smith gear. The adventurer fights one enemy per day with your gear. The game is about
numbers and luck: most numbers and chances are shown so the player can make informed decisions;
randomness adds luck and variety. Starting numbers are round.

## Run structure
- Endless. Score = points per enemy defeated (normal 10, elite 25, champion 50). Best score saved.
- **A lost fight is game over** (permadeath). No time limit on fights (an internal safety cap only
  prevents infinite loops; reaching it counts as a draw: adventurer survives, no ring).
- Fights cannot be skipped: every day from day 2 the adventurer fights one enemy.

## Time
- Day runs 8:00 → 18:00 (600 minutes). Only activities cost time: travel, searching, clearing
  debris, refining, cutting, smithing, repairing.
- Field actions (travel out, search, clear) are only allowed if there is still time to walk
  back to camp by 18:00 at the current load. The trip back is always allowed (may end past 18:00).
- The day can only be ended at camp.

## Day flow
- Day 1: the adventurer rests (no fight).
- Each morning the roster for **tomorrow's** fight is visible (7 enemies: 2 normal, 3 elite, 2 champion).
  A new roster is generated every day.
- End of day N (18:00 or "End day"):
  1. If the adventurer fought today: show the battle report (combat log, durability wear, ring).
     Loss → game over.
  2. Every 5th day: +1 intel point.
  3. Plan tomorrow: choose 1 enemy from the roster, pack gear (up to **2 items per slot**),
     choose adventurer rings (up to 10). Confirm → day N+1 starts.
- During day N+1 the adventurer is away with the packed gear: **packed gear cannot be repaired**
  that day. Unpacked gear at home can be repaired. Gear comes back at the end of the day.
- When the fight starts, the enemy's attributes become fully known and the adventurer
  automatically uses the best packed item for each slot against that enemy (decided by simulation).

## World map
- 5x5 map, camp in the center. Some map cells are blocked (impassable). Each other cell is a field.
- Travel time depends on path distance (steps around blocked cells). Travel between fields is allowed.
- Items in the bag slightly increase travel time.
- Farther fields are richer (more items, rarer ores/gems).
- The map shows how much of each field has been searched. Fields persist for the whole run.

## Fields (8x8)
- Each cell may hold ores (copper, iron, coal, mythril — increasing rarity) and gems (ruby, topaz,
  sapphire, emerald, diamond). Contents are hidden.
- Search a 3x3 area (costs time). Each search only searches part of each cell (shown as
  "% searched" with a visual fill). Items are found as the searched % passes their hidden depth.
- Ore sight: each searched cell has a chance to reveal everything still in it.
- Debris covers some cells; it blocks searching until cleared (costs time). Debris cells are a bit richer.
- Bag: 20 slots, 1 raw item per slot. If full, found items stay on the ground (visible, can pick up later).
  Items can be dropped. Arriving at camp unloads the bag into unlimited storage.

## Processing
- Refine ores into bars: copper, iron, steel (iron + coal), mythril. Cut gems. Better ores take a bit longer.
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
  - Sapphire: weapon slow + duration on hit / armor slow + duration reduction
  - Diamond: weapon piercing / armor pierce resistance
  - Armor gem effects are 25% stronger on chests and 10% stronger on helmets.
- Durability: each fight costs every *used* item a random small % (3–7). 0% = destroyed.
  Repair only to 100%; cost = 35% of original materials (bars + gem) × fraction repaired
  (fractional materials, 0.01 precision); time scales with amount repaired.

## Enemies
- 7 per roster: 2 normal, 3 elite, 2 champion. HP and damage grow slowly each day.
- 12 attributes, each Low / Normal / High, displayed in pairs (offense left, defense right):
  Piercing | Pierce resistance, Magical | Magic resistance, Stunning | Stun resistance,
  Accurate | Evasion, Chilling | Slow resistance, Fast | HP.
- Counts: normal = 6 low + 6 normal; elite = 3 low + 6 normal + 3 high; champion = 6 normal + 6 high.
  Assignment is random (uncorrelated).
- Each attribute is independently visible with a chance (intel). The ring reward's type and grade
  are also each visible with a chance.

## Battle
- Each side attacks every X seconds (speed shortens it). Hit chance uses an S-curve on
  accuracy vs dodge (diminishing returns). Damage reduced by defense (piercing ignores part of it);
  magic damage ignores defense but is reduced by magic resistance. Stuns delay the target's next attack;
  slows lengthen the target's attack interval for a duration.
- Full combat log (Backpack-Battles style) + summary.
- Optional pre-fight win-chance simulation (player clicks to run). Hidden attributes are sampled
  consistently with the tier's low/normal/high counts; for each sample the adventurer picks the best packed gear.

## Rings
- Each defeated enemy drops 1 ring (type uniform among all 17 types). Grade D/C/B/A/S maps to the
  type's 5 values. Lower grades are more likely. Normal: D–B, elite: C–A, champion: B–S.
- Smith and adventurer each wear up to 10 rings. Same type: best counts 100%, 2nd 50%, 3rd 25%, ...
- Smith rings: travel time, search time, search efficiency, ore sight (see all items in a cell),
  refining/cutting time, bar grade luck, gem grade luck.
- Adventurer rings: piercing, pierce resistance, magic damage, magic resistance, stun resistance,
  accuracy, dodge, slow resistance, speed, health.
- Adventurer rings are chosen as part of the nightly plan; smith rings can be swapped any time.

## Skills (automatic XP)
- Level 0–10, XP from doing the activity. Small bonuses (smaller than rings).
- Return travel time, search time, search efficiency, debris clearing, refining time, cutting time,
  bar grade (per bar type), gem grade (per gem), refining failure (per bar type), cutting failure (per gem).

## Intel
- 1 intel point every 5 days. Spend on: ore sight chance, enemy attribute sight, ring type sight,
  ring grade sight. Diminishing returns (+10, +9, +8, ... points).

## Tech
- Static site (plain HTML + ES modules, no build) for GitHub Pages. Saves in localStorage.
- `js/core/*` is DOM-free game logic (usable from Node for tests/balance tools).
- `js/ui/*` renders screens; `js/main.js` is the shell.
