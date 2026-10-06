# Smithsy — Balance Handbook

Every tunable number in the game lives in `js/config.js` (the `CONFIG` object). This handbook explains
what each number does, the exact formula the code uses, a worked example with real numbers, and what
happens if you change it.

- **The code is the truth.** Formulas below were copied from `js/core/*.js`. If this file and the code
  ever disagree, the code wins and this file should be fixed.
- **Units.** Percentages are written as whole numbers (`25` means 25%). Times are minutes for the work
  day and seconds inside a fight.
- **"Points" vs "%".** "+5 points" means add 5 to a percentage (40% → 45%). "+5%" means multiply by 1.05.
- **Example numbers** below come from the current config. The win-rate tables were produced with the core
  engine (`js/core/sim.js`, `js/core/combat.js`). Rerun `node tools/balance.mjs` after any change.

---

## Quick levers

These are the knobs with the biggest effect on difficulty and pacing, roughly in order of impact.

| Lever | Config path | Now | Raise it | Lower it |
|---|---|---|---|---|
| Enemy HP and damage growth per day | `CONFIG.enemies.growthPerDay.hpDamage` | 5 (+5%/day, linear) | Late game gets hard sooner, runs get shorter | Longer runs, gear stays useful longer |
| Enemy accuracy/dodge growth per day | `CONFIG.enemies.growthPerDay.ratings` | 2 (+2%/day) | Enemies hit you more and dodge more late on | Accuracy/dodge gear keeps its value longer |
| Enemy tier base stats | `CONFIG.enemies.tiers.<tier>.hp / damage / defense` | 60/6/10, 90/8/15, 130/10/20 | Every fight harder from day 2 | Easier start |
| Material power | `CONFIG.gear.materialMult` | copper 1, iron 1.5, steel 2, mythril 3 | Bigger jump per material tier | Flatter curve, grades matter more |
| Grade power | `CONFIG.gear.gradeMult` | D 1.0 … S 1.5 | Lucky refines matter more | Material matters more than luck |
| Refining luck | `CONFIG.refine.<bar>.dist` | F 10, D 30–45 | More weight on D/F: slower gear progress | More weight on S/A/B: faster gear progress |
| Mythril supply | `CONFIG.field.oreWeights` (mythril column) | 0 / 5 / 10 / 20 by distance | Mythril gear arrives earlier | Mythril stays rare |
| Field richness | `CONFIG.field.lootChance` | 40% +5/step, max 70% | More ore per search, slower map exhaustion | Scarcer, more travel |
| Search speed | `CONFIG.field.searchEfficiency`, `CONFIG.field.searchMin` | 25% per search, 30 min | Faster gathering | Slower gathering |
| Travel cost | `CONFIG.map.travelMinPerStep` | 20 min/step | Far (rich) fields cost more of the day | Far fields become the default |
| Bag size | `CONFIG.bag.slots` | 20 | Fewer trips home | More trips home, far fields less attractive |
| Adventurer HP | `CONFIG.adventurer.hp` | 100 | Survives longer in every fight | Fights get swingier |
| Hit-chance curve | `CONFIG.combat.hitK` | 0.25 | Everyone misses more; accuracy gear matters more | Hits land more; dodge matters less |
| Gear wear | `CONFIG.gear.durabilityLoss` | 3–7% per fight | More repair work, more bars spent | Gear lasts longer |
| Repair cost | `CONFIG.gear.repair.materialFraction` | 35% of the bars | Repairs eat into bar supply | Repair is almost free |
| Ring quality | `CONFIG.rings.gradeWeights` | see Rings | Shift weight to higher grades: faster ring power growth | Shift weight down: slower |
| Intel pace | `CONFIG.intel.daysPerPoint` | 5 days per point | Slower intel, more hidden attributes, more risk | Faster intel, fewer surprises |
| Starting scouting | `CONFIG.intel.tracks.enemySight.base` | 25% | Fewer surprises in fights | More hidden attributes, more risk |
| Day length | `CONFIG.time.dayStartMin / dayEndMin` | 8:00–18:00 (600 min) | Longer day: more work per fight, easier | Shorter day: harder |

**What the current numbers produce (snapshot, see Appendix A):** a full copper D set wins nearly every
normal fight through day 5 (82% on day 10); iron/steel sets are needed for elites by day 5–10; champions need
steel A or mythril early, and even a mythril S set drops to 35% against champions by day 20 (before gems and
rings). Enemy growth is linear and never stops, while gear tops out at mythril S, so every run ends
eventually. That is intended (endless, score-chasing).

---

## 1. Time

| Number | Config path | Value |
|---|---|---|
| Day start | `CONFIG.time.dayStartMin` | 480 (8:00, minutes after midnight) |
| Day end | `CONFIG.time.dayEndMin` | 1080 (18:00) |
| Cap on all time reductions | `CONFIG.processing.maxTimeReduction` | 75 (%) |

**Formula.** Working minutes per day = `dayEndMin − dayStartMin` = 600. Only actions cost time:

| Action | Base time | Can be reduced by |
|---|---|---|
| Travel | 20 min per map step (+1% per bag item) | Travel ring; Return travel skill (trips to camp only) |
| Search a 3x3 area | 30 min | Quick search ring + Search speed skill |
| Clear debris | 15 min per debris cell in the 3x3 area | Debris clearing skill |
| Refine one bar | 10 / 12 / 15 / 20 min (copper / iron / steel / mythril) | Refining ring + Refining speed skill |
| Cut one gem | 15 min | Refining ring + Cutting speed skill |
| Smith gear | 15 min per bar (+10 min with a gem) | nothing |
| Repair | 50% of smithing time × fraction repaired | nothing |

Every reduction is applied as `time = base × (1 − min(totalReduction%, 75) / 100)` and rounded to 0.1 min.

**Rules (from `js/core/map.js`, `processing.js`, `gear.js`, `game.js`):**
- Field actions (travel to a field, search, clear debris) are allowed only if
  `now + action minutes + walk home minutes ≤ 18:00`. The walk home is computed with the bag as it is
  *before* the action, so items found during a search can push the walk home a little past 18:00.
- The walk home to camp is always allowed, even if it ends after 18:00.
- Camp work (refine, cut, smith, repair) must finish by 18:00 (no overtime).
- Picking up and dropping items is free and has no time check.
- The day can only be ended at camp. Ending it sets the clock to `max(now, 18:00)`. Reaching 18:00 does
  not end the day by itself; the player presses "End day".

**Worked example.** 14:30 at a field 3 steps from camp with 8 items in the bag. Walk home =
3 × 20 × 1.08 = 64.8 min. A 30-minute search is allowed because 14:30 + 30 + 64.8 = 16:04.8 ≤ 18:00.
At 16:30 the same search would end at 17:00 and the walk home at 18:04.8, so it is refused.

**Tuning notes.** Day length scales everything that is "per day" (gathering, refining, smithing) against
everything that is "per fight" (wear, enemy growth). Longer days = easier game. The 75% cap only matters
once many rings and skills are stacked.

---

## 2. Map and travel

| Number | Config path | Value |
|---|---|---|
| Map size | `CONFIG.map.size` | 5 (5x5, camp in the center) |
| Blocked cells | `CONFIG.map.blockedCells` | 4 |
| Minutes per step | `CONFIG.map.travelMinPerStep` | 20 |
| Load penalty | `CONFIG.map.loadPenaltyPerItem` | 1 (% extra travel time per bag item) |

**Map generation.** 4 random non-camp cells are blocked; the map is re-rolled until every field can be
reached. That leaves **20 fields**. A field's *distance* is the number of up/down/left/right steps on the
shortest path around blocked cells (the camp cell can be walked through). Distance decides loot (section 3).
Over 2,000 generated maps the average map has 3.3 fields at distance 1, 6.0 at distance 2, 6.3 at
distance 3, 3.7 at distance 4 and about 0.6 at distance 5 or more (a detour can push a field as far as
10+ steps on rare maps).

**Formula** (`travelMinutes` in `js/core/map.js`):

```
base    = steps × travelMinPerStep × (1 + loadPenaltyPerItem × bagItems / 100)
minutes = round1( base × (1 − min(travelRing% + (going to camp ? returnSkill% : 0), 75) / 100) )
```

Travel between two fields is allowed and uses the path distance between them.

**Table: minutes by steps and bag load** (no bonuses)

| Steps | Empty bag | 10 items | 20 items (full) |
|---|---|---|---|
| 1 | 20 | 22 | 24 |
| 2 | 40 | 44 | 48 |
| 3 | 60 | 66 | 72 |
| 4 | 80 | 88 | 96 |
| 5 | 100 | 110 | 120 |

**Worked example.** 3 steps with 10 items, Travel ring S (10%) worn, Return travel skill level 10 (5%):
going out = 60 × 1.10 × (1 − 0.10) = **59.4 min**; coming home = 60 × 1.10 × (1 − 0.15) = **56.1 min**.

**Tuning notes.** `travelMinPerStep` sets how much of the day a rich far field costs: at 20 min/step a
distance-4 round trip takes 160+ of the 600 minutes. Raising it pushes players to near fields (more copper,
fewer gems); lowering it makes far fields the obvious choice. `loadPenaltyPerItem` is a small tax that
interacts with bag size (a full 20-item bag = +20% on the way home).

---

## 3. Fields, searching, debris and ore sight

### 3.1 What a field holds

| Number | Config path | Value |
|---|---|---|
| Field size | `CONFIG.field.size` | 8 (8x8 = 64 cells) |
| Loot chance per cell | `CONFIG.field.lootChance` | `{ base: 40, perDistance: 5, max: 70 }` |
| Debris chance per cell | `CONFIG.field.debrisChance` | 15 (%) |
| Extra loot chance under debris | `CONFIG.field.debrisLootBonus` | 20 (points) |
| Items in a loot cell (weights) | `CONFIG.field.itemCountWeights` | 1: 50, 2: 35, 3: 15 (average 1.65) |
| Share of items that are ore | `CONFIG.field.oreShare` | 70 (%) — the rest are gems |
| Ore weights by distance | `CONFIG.field.oreWeights` | rows for distance 1, 2, 3, 4+ |
| Gem weights by distance | `CONFIG.field.gemWeights` | rows for distance 1, 2, 3, 4+ |

**Formula** (`generateField` in `js/core/map.js`), per cell:

```
lootChance = min(max, base + perDistance × (distance − 1))   + (debris ? debrisLootBonus : 0)
items      = 1, 2 or 3 (weighted 50/35/15)                   if the loot roll succeeds
each item  = ore (70%) using oreWeights row, else gem using gemWeights row
each item gets a hidden depth d, uniform 0–100
```

Note: the `max` cap applies before the debris bonus, so a debris cell can exceed 70%.
Rows: distance 1 uses row 1, … distance 4 and farther use row 4.

| Distance | Loot chance (normal / debris) | Expected items per field | Ores | Gems |
|---|---|---|---|---|
| 1 | 40% / 60% | 45.4 | 31.8 | 13.6 |
| 2 | 45% / 65% | 50.7 | 35.5 | 15.2 |
| 3 | 50% / 70% | 56.0 | 39.2 | 16.8 |
| 4 | 55% / 75% | 61.2 | 42.9 | 18.4 |
| 5 | 60% / 80% | 66.5 | 46.6 | 20.0 |

Expected items per field = 64 × (0.85 × loot + 0.15 × (loot + 20)) / 100 × 1.65.

| Distance | Copper | Iron | Coal | Mythril | Ruby | Topaz | Sapphire | Emerald | Diamond |
|---|---|---|---|---|---|---|---|---|---|
| weights 1 | 60 | 30 | 10 | 0 | 35 | 30 | 20 | 10 | 5 |
| weights 2 | 45 | 35 | 15 | 5 | 30 | 25 | 20 | 15 | 10 |
| weights 3 | 30 | 35 | 25 | 10 | 25 | 25 | 20 | 15 | 15 |
| weights 4+ | 20 | 30 | 30 | 20 | 20 | 20 | 20 | 20 | 20 |
| expected per d1 field | 19.1 | 9.5 | 3.2 | 0 | 4.8 | 4.1 | 2.7 | 1.4 | 0.7 |
| expected per d4 field | 8.6 | 12.9 | 12.9 | 8.6 | 3.7 | 3.7 | 3.7 | 3.7 | 3.7 |

**Whole-map totals (average over 500 maps).** About **1,080 items per run**: copper 271, iron 250,
coal 161, mythril 73, ruby 86, topaz 80, sapphire 65, emerald 50, diamond 44. Fields never regrow, so this
is the total supply for the whole run. With 10% refining failure, 73 mythril ore ≈ 65 mythril bars, of which
only about 1.5 are expected to be S grade. A full mythril S set (11 S bars) is therefore a theoretical
ceiling, not a realistic goal.

**Tuning notes.** `lootChance` and `itemCountWeights` set total supply (and how fast the map runs out).
The mythril column of `oreWeights` is the main gate on late-game power. `oreShare` trades bars against
gems. Debris adds richness but costs clearing time.

### 3.2 Searching

| Number | Config path | Value |
|---|---|---|
| Search time | `CONFIG.field.searchMin` | 30 min per 3x3 search |
| Search efficiency | `CONFIG.field.searchEfficiency` | 25 (% of each cell searched per search) |

**Formula** (`search` in `js/core/map.js`):

```
efficiency = searchEfficiency × (1 + (searchEffRing% + searchEffSkill%) / 100)
minutes    = round1( searchMin × (1 − min(searchTimeRing% + searchTimeSkill%, 75) / 100) )
for each cell in the 3x3 area (clipped at the field edge) that has no debris and is not fully searched:
    searched = min(100, searched + efficiency)
    every hidden item with depth < searched is found (all items once searched reaches 100)
```

Found items go into the bag; if the bag is full they land on the ground of that cell. A search costs the
full time even if some cells in the area are skipped (debris, already done, or off the field edge).
After `ceil(100 / efficiency)` searches a cell is fully searched: 4 searches at 25%.

**Worked example.** A fresh, debris-free 3x3 area in a distance-2 field holds on average
9 × 0.45 × 1.65 = 6.7 items. Each 30-minute search finds about a quarter of them (1.67 items).
With a Thorough search ring S (20%) and Search efficiency skill level 5 (5%), efficiency is
25 × 1.25 = 31.25% per search (still 4 searches to finish a cell, but more found per search).

Covering a whole 8x8 field takes 9 areas × 4 searches = 36 searches = 18 hours of searching, so a field is
several days of work.

**Tuning notes.** Efficiency has breakpoints: ≥ 33.4% (base × 1.334) finishes a cell in 3 searches,
≥ 50% in 2. `searchMin` and `searchEfficiency` together set items per minute; the bag size (20) caps how
much one trip can carry, so very fast searching mostly means more trips home.

### 3.3 Debris

| Number | Config path | Value |
|---|---|---|
| Debris chance | `CONFIG.field.debrisChance` | 15 (% of cells) |
| Clearing time | `CONFIG.field.debrisClearMin` | 15 min per debris cell |
| Debris loot bonus | `CONFIG.field.debrisLootBonus` | +20 points loot chance |

**Formula.** "Clear debris" clears **every** debris cell in the 3x3 area at once:
`minutes = round1( count × round1(debrisClearMin × (1 − min(debrisSkill%, 75)/100)) )`.
Debris cells cannot be searched until cleared. A field has about 9.6 debris cells (≈ 192 per map).

**Worked example.** An area with 3 debris cells and Debris clearing skill level 5 (10%):
per cell = 15 × 0.9 = 13.5 min, total 40.5 min.

**Tuning notes.** A debris cell has +20 points loot chance (60% instead of 40% at distance 1), so it holds
about 0.99 expected items instead of 0.66; clearing it costs 15 min on top of searching. Raising
`debrisChance` hides more of each field behind a time cost.

### 3.4 Ore sight

| Number | Config path | Value |
|---|---|---|
| Base ore sight chance | `CONFIG.intel.tracks.oreSight.base` | 10 (%) |
| Ore sight ring | `CONFIG.rings.types.reveal.values` | 3 / 4 / 5 / 6 / 7 points (D…S) |

**Formula.** `revealChance = intelChance('oreSight') + oreSightRingTotal` (points). After every search,
each searched cell that is not yet revealed rolls this chance once. A revealed cell shows every item still
hidden in it (you still have to search to collect them). There is no cap: 100% or more always reveals.

**Worked example.** Base 10% plus 2 intel points (+10, +9) plus an Ore sight ring B (5): 34% per cell, so a
9-cell search reveals about 3 cells on average.

**Tuning notes.** Ore sight is information, not loot: it tells the player when to stop digging an empty
cell. It matters more when fields are poor (low `lootChance`).

---

## 4. Bag and storage

| Number | Config path | Value |
|---|---|---|
| Bag slots | `CONFIG.bag.slots` | 20 (1 raw ore or raw gem per slot) |

**Rules.** When the bag is full, found items stay on the ground of their cell (visible, free to pick up
later). Items can be dropped onto a cell in the current field for free. Arriving at camp unloads the whole
bag into unlimited camp storage. Each item in the bag adds `loadPenaltyPerItem` (1%) to travel time.

**Worked example.** A day at a distance-2 field: 40 min out, 48 min back with a full bag, 512 minutes left
= 17 searches ≈ 28 items found in fresh ground. Only 20 fit, so either walk home once mid-day or leave
items on the ground for tomorrow.

**Tuning notes.** Bag size is a soft cap on items per trip and pushes players toward near fields or mid-day
trips home. Raising it mostly helps far-field play.

---

## 5. Refining and cutting

| Number | Config path | Value |
|---|---|---|
| Refining recipes and times | `CONFIG.refine.<bar>.input / minutes` | copper 1 copper, 10 min; iron 1 iron, 12 min; steel 1 iron + 1 coal, 15 min; mythril 1 mythril, 20 min |
| Refining outcome tables | `CONFIG.refine.<bar>.dist` | see table |
| Cutting times | `CONFIG.cut.<gem>.minutes` | 15 min for every gem |
| Cutting outcome tables | `CONFIG.cut.<gem>.dist` | S 5, A 10, B 20, C 25, D 30, F 10 for every gem |
| Time-reduction cap | `CONFIG.processing.maxTimeReduction` | 75 (%) |

**Base outcome tables (% chance):**

| Bar / gem | S | A | B | C | D | Fail | Share of successes at B or better | Average grade multiplier of a success |
|---|---|---|---|---|---|---|---|---|
| Copper | 5 | 10 | 20 | 25 | 30 | 10 | 38.9% | 1.13 |
| Iron | 4 | 8 | 18 | 25 | 35 | 10 | 33.3% | 1.12 |
| Steel | 3 | 6 | 16 | 25 | 40 | 10 | 27.8% | 1.10 |
| Mythril | 2 | 4 | 14 | 25 | 45 | 10 | 22.2% | 1.08 |
| Any gem | 5 | 10 | 20 | 25 | 30 | 10 | 38.9% | — |

A failure destroys the input (ore or raw gem). XP is still gained on a failure.

**Formula: bonuses** (`adjustDistribution` in `js/core/processing.js`). Two modifiers are applied in order:

1. **Fail reduction** (skills such as "Copper refining" / "Ruby cutting", one per bar or gem type): `r = min(failRed, F)` points move from
   F to D.
2. **Upgrade luck** u% (ring "Bar luck"/"Gem luck" + skills such as "Copper bar grade" / "Ruby grade"): every success
   below S has a u% chance to go up one grade. S stays S.

```
S' = S + A·u        A' = A·(1−u) + B·u     B' = B·(1−u) + C·u
C' = C·(1−u) + D·u  D' = D·(1−u)           F' = F         (u as a fraction, D already includes the moved fail points)
```

Time: `minutes = round1(base × (1 − min(processTimeRing% + refineTime/cutTime skill%, 75) / 100))`.
The Refining ring applies to both refining and cutting; the skills are separate.

**Worked example.** Copper with copper refining skill level 10 (3 points) and Bar luck ring S (6) + copper
bar grade skill level 10 (3) = u 9%:
step 1: F 10 → 7, D 30 → 33.
step 2: S = 5 + 10×0.09 = **5.9**, A = 10×0.91 + 20×0.09 = **10.9**, B = 20×0.91 + 25×0.09 = **20.45**,
C = 25×0.91 + 33×0.09 = **25.72**, D = 33×0.91 = **30.03**, F = **7**.

The same bonuses on mythril: S 2.36, A 4.9, B 14.99, C 27.07, D 43.68, F 7.

**Why grades are hard.** Gear needs *all* bars of the same material **and** grade (2 or 3 bars). With the
mythril table only 2 in 90 successes are S, so matching grades is the real bottleneck, and lower grades are
what players will usually smith.

**Tuning notes.** The D column is the main knob for gear quality: every point moved from D to a higher
grade makes matching sets of that grade more common. F is a flat material tax. Upgrade luck is weak per point (each point moves 1% of
each grade up one step), which is why rings give only 2–6. Better ores also take longer (10 → 20 min),
which interacts with day length.

---

## 6. Gear (smithing)

| Number | Config path | Value |
|---|---|---|
| Material multiplier | `CONFIG.gear.materialMult` | copper 1.0, iron 1.5, steel 2.0, mythril 3.0 |
| Grade multiplier | `CONFIG.gear.gradeMult` | D 1.0, C 1.1, B 1.2, A 1.3, S 1.5 |
| Sword | `CONFIG.gear.slots.sword` | 2 bars; damage 10, accuracy 10 |
| Chest | `CONFIG.gear.slots.chest` | 3 bars; defense 6 |
| Helmet | `CONFIG.gear.slots.helmet` | 2 bars; defense 4 |
| Gloves | `CONFIG.gear.slots.gloves` | 2 bars; defense 2, accuracy 10 |
| Boots | `CONFIG.gear.slots.boots` | 2 bars; defense 2, dodge 10, speed 3 |
| Smithing time | `CONFIG.gear.smithMinPerBar` | 15 min per bar |
| Gem infusion time | `CONFIG.gear.infuseMin` | +10 min |

**Formula** (`gearStats`, `craftMinutes` in `js/core/gear.js`):

```
stat         = slot base stat × materialMult[material] × gradeMult[grade]
craftMinutes = bars × smithMinPerBar + (gem ? infuseMin : 0)
```

Smithing time has no bonuses. Sword 30 min (40 with a gem), chest 45 (55), helmet/gloves/boots 30 (40).
A full 5-piece set uses 11 bars and 165 minutes.

**Combined multiplier (material × grade):**

| | D | C | B | A | S |
|---|---|---|---|---|---|
| Copper | 1.0 | 1.1 | 1.2 | 1.3 | 1.5 |
| Iron | 1.5 | 1.65 | 1.8 | 1.95 | 2.25 |
| Steel | 2.0 | 2.2 | 2.4 | 2.6 | 3.0 |
| Mythril | 3.0 | 3.3 | 3.6 | 3.9 | 4.5 |

Multiply any slot base stat by this. Examples: sword damage/accuracy = 10 × mult (copper D 10, iron B 18,
steel A 26, mythril S 45). Chest defense = 6 × mult (copper D 6, iron C 9.9, steel A 15.6, mythril S 27).
Helmet defense = 4 × mult (4 … 18). Gloves = 2 defense and 10 accuracy × mult. Boots = 2 defense, 10 dodge
and 3 speed × mult (mythril S boots: 9 defense, 45 dodge, 13.5% speed).

**Full set (all 5 slots, same material and grade, no gems, no rings) → adventurer stats:**

| Set | Damage | Accuracy | Defense % | Dodge | Speed % | Attack every |
|---|---|---|---|---|---|---|
| none | 4 | 100 | 0 | 100 | 0 | 2.00 s |
| Copper D | 10 | 120 | 14.0 | 110 | 3.0 | 1.94 s |
| Copper S | 15 | 130 | 21.0 | 115 | 4.5 | 1.91 s |
| Iron D | 15 | 130 | 21.0 | 115 | 4.5 | 1.91 s |
| Iron C | 16.5 | 133 | 23.1 | 116.5 | 4.95 | 1.91 s |
| Iron A | 19.5 | 139 | 27.3 | 119.5 | 5.85 | 1.89 s |
| Steel D | 20 | 140 | 28.0 | 120 | 6.0 | 1.89 s |
| Steel A | 26 | 152 | 36.4 | 126 | 7.8 | 1.86 s |
| Steel S | 30 | 160 | 42.0 | 130 | 9.0 | 1.83 s |
| Mythril C | 33 | 166 | 46.2 | 133 | 9.9 | 1.82 s |
| Mythril A | 39 | 178 | 54.6 | 139 | 11.7 | 1.79 s |
| Mythril S | 45 | 190 | 63.0 | 145 | 13.5 | 1.76 s |

Note that "copper S" equals "iron D" and "steel S" equals "mythril D": one material step is worth roughly
the whole D-to-S grade range.

**Worked example.** Steel A chest: 6 × 2.0 × 1.3 = **15.6% defense**, costs 3 steel A bars and 45 min.

**Tuning notes.** `materialMult` is the backbone of the power curve. Enemies grow without limit while
materials stop at mythril, so these values set how many days each material stays viable (Appendix A). `gradeMult` decides how much refining luck matters. Slot base stats set the role
of each piece; boots' speed is small on purpose because speed multiplies all damage.

---

## 7. Gem infusion

Infusing consumes one cut gem when smithing (+10 min). The gem's grade is independent of the gear's grade.
Sword gems use the **weapon** values as written. Armor gems use the **armor** values multiplied by the slot
factor.

| Number | Config path | Value |
|---|---|---|
| Armor gem slot factor | `CONFIG.gear.gemArmorMult` | chest 1.25, helmet 1.1, gloves 1.0, boots 1.0 |
| Gem effect tables | `CONFIG.gemEffects.<gem>.weapon / armor` | indexed by gem grade [D, C, B, A, S] |

| Gem | Sword effect (D / C / B / A / S) | Armor effect (D / C / B / A / S, before slot factor) |
|---|---|---|
| Ruby | +10 / 15 / 20 / 25 / 30 magic damage, % of weapon damage | +4 / 6 / 8 / 10 / 12 % magic resistance |
| Topaz | +4 / 6 / 8 / 10 / 12 % stun chance per hit, stun 0.5 / 0.6 / 0.7 / 0.8 / 1.0 s | +4 / 6 / 8 / 10 / 12 % less stun chance **and** % shorter stuns |
| Emerald | +10 / 15 / 20 / 25 / 30 accuracy | +4 / 6 / 8 / 10 / 12 dodge |
| Sapphire | +10 / 15 / 20 / 25 / 30 % slower enemy attacks for 1 / 1.5 / 2 / 2.5 / 3 s per hit | +4 / 6 / 8 / 10 / 12 % weaker slows **and** % shorter slows |
| Diamond | +10 / 15 / 20 / 25 / 30 % of enemy defense ignored | +4 / 6 / 8 / 10 / 12 points subtracted from enemy piercing |

**Formula.** `armorGemValue = armorTable[grade] × gemArmorMult[slot]`. Sword gem values are not scaled by
material or grade.

**Armor values after the slot factor (grade S):** chest 15, helmet 13.2, gloves 12, boots 12
(grade D: chest 5, helmet 4.4, gloves 4, boots 4).

**Worked example.** Emerald S on a chest: 12 × 1.25 = **+15 dodge**. Ruby C on a sword: magic damage +15%
of the sword's damage. On an iron B sword (18 damage) that is 2.7 extra magic damage per hit before the
enemy's magic resistance.

**How strong is each gem right now?** Iron C set vs an elite on day 8 with all-normal attributes
(baseline 58.6% win):

| Gem | On the sword, D / S | On the chest, D / S |
|---|---|---|
| Ruby | 73.7% / 91.5% | 59.8% / 60.4% |
| Sapphire | 68.8% / 82.1% | 61.5% / 73.8% |
| Emerald | 62.7% / 68.8% | 61.4% / 68.3% |
| Topaz | 59.4% / 64.1% | 58.9% / 60.3% |
| Diamond | 58.6% / 59.3% | 59.9% / 60.4% |

**Tuning notes.** Ruby on swords is the strongest gem because magic damage ignores defense and enemy
magic resistance is at most 30%. Diamond is weak because enemy defense is only 10/15/20 and enemy pierce
resistance (0/10/20) cancels most of a sword's piercing. Sapphire armor is strong because enemy slows land
on every hit (see 10.7). To rebalance, scale the weapon tables (`CONFIG.gemEffects.*.weapon`) or raise enemy defense.

---

## 8. Durability and repair

| Number | Config path | Value |
|---|---|---|
| Wear per fight | `CONFIG.gear.durabilityLoss` | `{ min: 3, max: 7 }` (whole %, uniform) |
| Repair material cost | `CONFIG.gear.repair.materialFraction` | 35 (% of the original bars and gem for a 0→100% repair) |
| Repair time | `CONFIG.gear.repair.timeFraction` | 50 (% of the original smithing time for a 0→100% repair) |

**Formula** (`resolveBattle` in `game.js`, `repairInfo` in `gear.js`):

```
after each fight, every item the adventurer actually USED loses randInt(3, 7) durability
durability 0 → item destroyed (packed-but-unused items lose nothing)

missing     = 100 − durability
repair bars = ceil to 0.01 of ( slot bars × 35/100 × missing/100 )     same material and grade as the item
repair gem  = ceil to 0.01 of ( 1 × 35/100 × missing/100 )             only if the item has a gem
repair time = round1( craftMinutes × 50/100 × missing/100 )
```

Repairs always go back to 100%. Durability does not lower an item's stats. Packed items are away with the
adventurer and cannot be repaired (or scrapped) that day. Scrapping an item gives nothing back.

**Worked examples** (iron C items):

| Item | Durability | Bars | Gem | Time |
|---|---|---|---|---|
| Chest | 95% | 0.06 iron C (3 × 0.35 × 0.05 = 0.0525, rounded up) | — | 1.1 min |
| Chest | 50% | 0.53 iron C | — | 11.3 min |
| Sword + ruby B | 93% | 0.05 iron C | 0.03 ruby B | 1.4 min |
| Sword + ruby B | 40% | 0.42 iron C | 0.21 ruby B | 12 min |
| Boots + emerald C | 70% | 0.21 iron C | 0.11 emerald C | 6 min |

**Lifetime.** Average wear is 5% per fight, so an unrepaired item lasts about 20 fights (15 at worst,
34 at best). Repairing after every fight costs about 1.75% of the item's bars per fight (plus rounding), so
roughly 57 fights of repairs cost as much as a new item.

**Tuning notes.** Wear and repair cost are the main sinks for bars after the first sets are made. Raising
`durabilityLoss` forces more refining of the *same grade* as old gear (players need to keep matching
bars); raising `materialFraction` makes new gear relatively cheaper than repairs.

---

## 9. Adventurer base stats

| Number | Config path | Value |
|---|---|---|
| HP | `CONFIG.adventurer.hp` | 100 |
| Unarmed damage | `CONFIG.adventurer.unarmedDamage` | 4 |
| Attack interval | `CONFIG.adventurer.attackInterval` | 2.0 s |
| Accuracy | `CONFIG.adventurer.accuracy` | 100 |
| Dodge | `CONFIG.adventurer.dodge` | 100 |

**Formula** (`adventurerCombatant` in `js/core/combat.js`):

```
damage   = sword damage (replaces unarmed 4) ; no sword → 4
accuracy = 100 + sword + gloves + emerald-sword accuracy + Accuracy rings
dodge    = 100 + boots + emerald-armor dodge + Dodge rings
defense  = sum of armor defense
speed    = boots speed + Speed rings
HP       = 100 × (1 + Health rings% / 100)
pierce, pierceRes, magicPct, magicRes, stun and slow stats = gem effects + matching rings
   (Stun resistance ring adds to both stun chance and stun duration reduction; same for Slow resistance)
```

**Worked example.** Iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots:
damage 18, accuracy 100 + 18 + 10 = 128, dodge 100 + 11 = 111, defense 9.9 + 4.8 + 2 + 2.2 = 18.9,
speed 3.3%, magic 15% of weapon damage, HP 100.

**Tuning notes.** HP is the cleanest difficulty knob for the player side: +10 HP is about +10% time to die
in every fight. Base accuracy/dodge 100 sets where the hit-chance curve starts (80% both ways vs a "normal"
day-1 enemy).

---

## 10. Combat

A fight is simulated event by event (`fight` in `js/core/combat.js`). Each side attacks on its own timer.
The fight ends when one side reaches 0 HP.

### 10.1 Hit chance (S-curve)

| Number | Config path | Value |
|---|---|---|
| Curve constant | `CONFIG.combat.hitK` | 0.25 |
| Minimum hit chance | `CONFIG.combat.minHitPct` | 5 |
| Maximum hit chance | `CONFIG.combat.maxHitPct` | 95 |

**Formula** (`hitChance`):

```
hit% = acc² / (acc² + hitK × dodge²), clamped to 5%..95%        (acc and dodge are at least 1)
     = r² / (r² + 0.25) with r = acc / dodge
```

Only the *ratio* matters. Equal ratings → 80%. The 95% cap is reached at r ≈ 2.18; the 5% floor at r ≈ 0.11.

| Accuracy ÷ dodge | 0.25 | 0.4 | 0.5 | 0.6 | 0.75 | 0.9 | 1.0 | 1.1 | 1.25 | 1.5 | 2.0 | 3.0 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Hit chance | 20% | 39% | 50% | 59% | 69.2% | 76.4% | 80% | 82.9% | 86.2% | 90% | 94.1% | 95% |

| Accuracy ↓ / Dodge → | 50 | 80 | 100 | 120 | 150 | 200 | 250 |
|---|---|---|---|---|---|---|---|
| 50 | 80 | 61 | 50 | 41 | 30.8 | 20 | 13.8 |
| 80 | 91.1 | 80 | 71.9 | 64 | 53.2 | 39 | 29.1 |
| 100 | 94.1 | 86.2 | 80 | 73.5 | 64 | 50 | 39 |
| 120 | 95 | 90 | 85.2 | 80 | 71.9 | 59 | 48 |
| 150 | 95 | 93.4 | 90 | 86.2 | 80 | 69.2 | 59 |
| 200 | 95 | 95 | 94.1 | 91.7 | 87.7 | 80 | 71.9 |
| 250 | 95 | 95 | 95 | 94.6 | 91.7 | 86.2 | 80 |

**Worked example.** Adventurer accuracy 128 vs an elite with high Evasion on day 6 (120 × 1.10 = 132 dodge):
128² / (128² + 0.25 × 132²) = 16,384 / 20,740 = **79.0%**.

**Tuning notes.** Raising `hitK` shifts the whole curve down (more misses for both sides) and makes
accuracy/dodge more valuable. It interacts with enemy rating growth (+2%/day): without it, late-game adventurer accuracy (up to ~190
from gear, more with emeralds and rings) against a fixed 100 dodge would sit at or near the 95% cap.

### 10.2 Damage roll

| Number | Config path | Value |
|---|---|---|
| Damage roll | `CONFIG.combat.damageRoll` | `[90, 110]` (% of listed damage) |

**Formula.** One uniform roll between 90% and 110% per landed hit, applied to both the physical and the
magic part. Example: a hit that lists 18 damage deals 16.2 to 19.8.

**Tuning notes.** A wider roll makes close fights swingier; it does not change average damage.

### 10.3 Defense and the defense cap

| Number | Config path | Value |
|---|---|---|
| Defense cap | `CONFIG.combat.defenseCap` | 75 (% max physical reduction) |

**Formula.** `effectiveDefense = min(defense, 75) × (1 − pierce%/100)`;
`physical damage = damage × (1 − effectiveDefense/100)`.

**Worked example.** Ogre damage 10 vs adventurer defense 18.9 and Ogre piercing 25:
effective defense = 18.9 × 0.75 = 14.175; physical = 10 × (1 − 0.14175) = **8.58**.

**Tuning notes.** The best possible gear defense is 63% (mythril S set) and there are no defense rings, so
the cap is currently never reached. It only matters if slot defense values or multipliers go up.

### 10.4 Piercing

Attacker's piercing = % of the defender's defense ignored, after subtracting the defender's pierce resistance.

**Formula.** `pierce% = clamp(attacker.pierce − defender.pierceRes, 0, 100)`.

- Adventurer piercing = diamond sword (10–30) + Piercing rings (3–7). Enemy pierce resistance
  (`CONFIG.enemies.attributes.pierceRes.values`) = 0 / 10 / 20.
- Enemy piercing (`CONFIG.enemies.attributes.piercing.values`) = 5 / 15 / 25. Adventurer pierce
  resistance = diamond armor (4–15 after slot factor) + Pierce resistance rings (3–7).

**Worked example.** Diamond S sword (30) + Piercing ring S (7) = 37 vs a champion with high pierce
resistance (20): 17% of 20 defense ignored → effective defense 16.6, damage ×0.834 instead of ×0.80
(+4.25% damage).

**Tuning notes.** Enemy defense is low (10/15/20), so adventurer piercing barely matters; enemy piercing
grows in value as the adventurer's defense grows. Raise enemy `defense` per tier to make diamonds useful.

### 10.5 Magic damage and magic resistance

**Formula.** `magic damage = attacker.damage × magicPct/100 × (1 − min(defender.magicRes, 75)/100)`.
Magic ignores defense and piercing. Cap: `CONFIG.combat.resistCap` = 75.

- Adventurer magicPct = ruby sword (10–30) + Magic damage rings (3–7), based on the *sword's* damage
  (unarmed: 4). Enemy magic resistance (`magicRes`) = 0 / 15 / 30.
- Enemy magicPct (`magical`) = 10 / 20 / 30 % of its damage. Adventurer magic resistance = ruby armor
  (4–15) + Magic resistance rings (3–7).

**Worked example.** Iron B sword (18) + ruby C (15%) vs an enemy with low magic resistance (0):
18 × 0.15 = **2.7** magic per hit on top of 18 × (1 − 0.15) = 15.3 physical vs 15 defense = 18.0 total.

**Tuning notes.** Because enemy defense is low, magic is roughly "+X% damage". Enemy Magical is one of the
most dangerous attributes (see Appendix B) because adventurer magic resistance is scarce.

### 10.6 Stun

| Number | Config path | Value |
|---|---|---|
| Enemy stun duration | `CONFIG.enemies.stunDuration` | 1.0 s |
| Resist cap | `CONFIG.combat.resistCap` | 75 |

**Formula.** Only on a landed hit:

```
stun chance = attacker.stunChance × (1 − min(defender.stunChanceRed, 75)/100)
stun length = attacker.stunDur   × (1 − min(defender.stunDurRed, 75)/100)
on a stun: the defender's next attack is pushed back by the stun length (stuns can stack)
```

- Adventurer stuns come only from a topaz sword (4–12% chance, 0.5–1.0 s). Enemy Stun resistance
  (`stunRes`) = 0 / 25 / 50 reduces both chance and length.
- Enemy Stunning (`stunning`) = 5 / 10 / 15% per hit, 1.0 s. Adventurer reduction = topaz armor (4–15
  each) + Stun resistance rings (5–10, counted for both chance and length).

**Worked examples.** Topaz S sword vs normal Stun resistance (25): 12 × 0.75 = **9%** per hit, 1.0 × 0.75 =
**0.75 s**. High Stunning enemy (15%) vs topaz S chest (15) + Stun resistance ring S (10) = 25% reduction:
**11.25%** per hit, **0.75 s**.

**Tuning notes.** Stuns are short relative to the ~2 s attack interval, so they are mild. Raise
`stunDuration` or the topaz weapon table to make them matter.

### 10.7 Slow

| Number | Config path | Value |
|---|---|---|
| Enemy slow duration | `CONFIG.enemies.slowDuration` | 2.0 s |

**Formula.** Every landed hit from an attacker with slowPct > 0 applies a slow (no chance roll):

```
slow strength = attacker.slowPct × (1 − min(defender.slowRed, 75)/100)
slow length   = attacker.slowDur × (1 − min(defender.slowDurRed, 75)/100)
the slow lasts until (hit time + slow length); a new slow refreshes it (the stronger one is kept while active)
```

**Exact timing rule (important).** A slow does not change an attack that is already scheduled. When the
slowed fighter makes its next attack, *if that attack happens strictly before the slow ends*, the interval
to its following attack is multiplied by `1 + strength/100`.

- Adventurer slows come from a sapphire sword (10–30% for 1–3 s). Enemy Slow resistance (`slowRes`) =
  0 / 25 / 50.
- Enemy Chilling (`chilling`) = 10 / 20 / 30% for 2.0 s. Adventurer reduction = sapphire armor + Slow
  resistance rings.

**Worked example.** High Chilling (30%) vs sapphire S chest (15) + Slow resistance ring A (8) = 23%:
strength 30 × 0.77 = **23.1%**, length 2 × 0.77 = **1.54 s**.

**Tuning notes.** Every landed hit applies the slow (there is no chance roll), and a 2.0 s slow covers
about one adventurer attack, so Chilling slows a large share of attacks: for an iron C set against a
High-Chilling elite, about 65% of the adventurer's attack gaps are slowed. That is why Chilling, sapphire
armor and Slow resistance rings test strong in Appendix B. To soften it, lower the Chilling values or
`CONFIG.enemies.slowDuration`.

Edge case: the check is "strictly before the slow ends". An adventurer whose interval is exactly 2.0 s (no
boots, no speed rings) fighting an enemy with exactly 2.0 s stays in lockstep with it, and each slow ends at
the exact moment the adventurer attacks, so only about 9% of attack gaps are slowed (after a stun shifts the
timing). Boots therefore make the adventurer *more* exposed to Chilling, though their other stats still
make them worth wearing.

### 10.8 Attack interval and speed

| Number | Config path | Value |
|---|---|---|
| Adventurer interval | `CONFIG.adventurer.attackInterval` | 2.0 s |
| Enemy interval | `CONFIG.enemies.attackInterval` | 2.0 s |
| Enemy speed (Fast) | `CONFIG.enemies.attributes.fast.values` | −5 / 0 / +5 % |

**Formula** (`attackInterval`): `interval = baseInterval / (1 + speed/100) × (slowed ? 1 + slow/100 : 1)`.

**Worked examples.** Mythril S boots (13.5%) + Speed ring S (4%) = 17.5% → 2 / 1.175 = **1.70 s**.
Enemy Fast high: 2 / 1.05 = 1.905 s; Fast low: 2 / 0.95 = 2.105 s.

**Tuning notes.** Speed is a multiplier on all damage dealt, so keep speed sources small.

### 10.9 Fight order and ties

Both fighters make their first attack after one full interval (not at time 0). The fighter whose next
attack time is earlier goes first; **on an exact tie the adventurer attacks first**. After every attack
the defender's HP is checked, so there are no double knock-outs.

**Tuning notes.** The tie rule gives the adventurer a small edge when both intervals are 2.0 s.

### 10.10 Safety cap

| Number | Config path | Value |
|---|---|---|
| Safety cap | `CONFIG.combat.safetyCapSeconds` | 36,000 s (10 hours of fight time) |

If no one has won when the next attack would happen after 36,000 s, the fight is a **draw**: the adventurer
survives, gets no ring and no score. Both sides always deal some damage (defense is capped at 75% and hit
chance never drops below 5%), so in practice fights end in under a few minutes and draws do not occur.

---

## 11. Best-gear selection and the win-chance simulation

| Number | Config path | Value |
|---|---|---|
| Fights per loadout in the real battle | `CONFIG.combat.bestGearFights` | 200 |
| Win-chance samples | `CONFIG.sim.samples` | 40 |
| Fights per loadout per sample | `CONFIG.sim.fightsPerLoadout` | 30 |
| Evaluation fights per sample | `CONFIG.sim.evalFights` | 30 |

**Best gear** (`loadouts`, `bestLoadout` in `js/core/sim.js`). Up to 2 items per slot can be packed, so
there are up to 2⁵ = 32 loadouts (one item per slot; a slot is empty only if nothing was packed for it).
When the real fight starts the enemy's true attributes are known. Each loadout fights it 200 times with the
**same** random numbers, and the loadout with the best score wins:

```
score = wins + (sum of HP% left in won fights) / (fights + 1)
```

Wins always come first; HP left only breaks ties. A remaining tie keeps the first loadout in slot order.
Real battle cost: up to 32 × 200 = 6,400 quick fights.

**Win-chance estimate** (`estimateWinChance`, optional, the player clicks to run it). For each of 40
samples:
1. Guess the hidden attributes: known ones are kept; hidden ones are filled at random so that the tier's exact
   low/normal/high counts still hold (e.g. an elite with 1 known High has exactly 2 more Highs among its hidden
   attributes).
2. Pick the best packed loadout for that guess (30 fights per loadout).
3. Run 30 fresh fights with it.

Reported win % = wins / (40 × 30 = 1,200 fights). Cost: up to 40 × (32 × 30 + 30) ≈ 39,600 fights.

**Worked example.** At a true 50% the sampling error of 1,200 fights is about ±1.4 points (one standard
deviation), a bit more in practice because the 40 guesses are shared.

**Tuning notes.** More `samples` = better coverage of hidden attributes; more `fightsPerLoadout` = the
simulated gear choice matches the real one (which uses 200) more often. With only 30 fights per loadout the
estimate is slightly pessimistic when many loadouts are packed. A draw counts as a non-win in the estimate
but as survival in the real game (irrelevant in practice). These numbers only affect UI speed and accuracy,
not difficulty.

---

## 12. Enemies

### 12.1 Tiers and the daily roster

| Tier | Per roster | Base HP | Base damage | Defense | Low / Normal / High attributes | Score |
|---|---|---|---|---|---|---|
| Normal | 2 | 60 | 6 | 10 | 6 / 6 / 0 | 10 |
| Elite | 3 | 90 | 8 | 15 | 3 / 6 / 3 | 25 |
| Champion | 2 | 130 | 10 | 20 | 0 / 6 / 6 | 50 |

Config: `CONFIG.enemies.tiers.<tier>.{count, hp, damage, defense, levels, score}`. The level counts must
add up to 12 (the number of attributes). Each morning a new roster of 7 is generated for the *next* day's
fight (the player picks one that evening). Names come from `CONFIG.enemies.names` (unique within a tier
when possible). Each enemy's ring reward is rolled when the roster is made.

### 12.2 Daily growth

| Number | Config path | Value |
|---|---|---|
| HP and damage growth | `CONFIG.enemies.growthPerDay.hpDamage` | 5 (%/day) |
| Accuracy and dodge growth | `CONFIG.enemies.growthPerDay.ratings` | 2 (%/day) |

**Formula** (`growth`, `enemyCombatant` in `js/core/enemies.js`; *day* = the day of the fight):

```
hpDamageMult = 1 + 5/100 × (day − 1)          ratingMult = 1 + 2/100 × (day − 1)
HP       = tier HP × hpDamageMult × (HP attribute %)/100
damage   = tier damage × hpDamageMult
accuracy = Accurate value × ratingMult        dodge = Evasion value × ratingMult
defense  = tier defense (no growth)
```

**Enemy numbers with all attributes Normal:**

| Day | HP/damage × | Ratings × | Normal HP / dmg | Elite HP / dmg | Champion HP / dmg | Accuracy & dodge |
|---|---|---|---|---|---|---|
| 2 | 1.05 | 1.02 | 63 / 6.3 | 94.5 / 8.4 | 136.5 / 10.5 | 102 |
| 5 | 1.20 | 1.08 | 72 / 7.2 | 108 / 9.6 | 156 / 12 | 108 |
| 10 | 1.45 | 1.18 | 87 / 8.7 | 130.5 / 11.6 | 188.5 / 14.5 | 118 |
| 15 | 1.70 | 1.28 | 102 / 10.2 | 153 / 13.6 | 221 / 17 | 128 |
| 20 | 1.95 | 1.38 | 117 / 11.7 | 175.5 / 15.6 | 253.5 / 19.5 | 138 |
| 30 | 2.45 | 1.58 | 147 / 14.7 | 220.5 / 19.6 | 318.5 / 24.5 | 158 |
| 40 | 2.95 | 1.78 | 177 / 17.7 | 265.5 / 23.6 | 383.5 / 29.5 | 178 |
| 50 | 3.45 | 1.98 | 207 / 20.7 | 310.5 / 27.6 | 448.5 / 34.5 | 198 |

Growth is linear: HP and damage double by day 21 and triple by day 41. Because both HP and damage grow, the
enemy's "threat" (HP × damage) grows with the square: ×4 by day 21.

**Worked example.** Elite "Ogre" on day 6 with HP Normal, Accurate Normal, Evasion High:
×1.25 / ×1.10 → HP 90 × 1.25 = **112.5**, damage 8 × 1.25 = **10**, accuracy 100 × 1.1 = **110**,
dodge 120 × 1.1 = **132**, defense 15.

**Tuning notes.** `hpDamage` is the single most important difficulty number: it sets how many days each
gear tier stays good. `ratings` keeps hit chances from saturating as the adventurer's accuracy grows.

### 12.3 Attributes

Each enemy has 12 attributes, each Low / Normal / High (`CONFIG.enemies.attributes.<key>.values`), shown in
pairs (offense left, defense right). Levels are dealt from the tier's exact counts at random, with no
correlation between attributes.

| Pair | Offense: Low / Normal / High | Defense: Low / Normal / High |
|---|---|---|
| Piercing / Pierce resistance | 5 / 15 / 25 % of your defense ignored | 0 / 10 / 20 points off your piercing |
| Magical / Magic resistance | 10 / 20 / 30 % of its damage as extra magic | 0 / 15 / 30 % magic damage reduction |
| Stunning / Stun resistance | 5 / 10 / 15 % stun chance per hit (1.0 s) | 0 / 25 / 50 % less stun chance and length |
| Accurate / Evasion | 80 / 100 / 120 accuracy (× daily growth) | 80 / 100 / 120 dodge (× daily growth) |
| Chilling / Slow resistance | 10 / 20 / 30 % slower attacks for 2.0 s on hit | 0 / 25 / 50 % weaker and shorter slows |
| Fast / HP | −5 / 0 / +5 % attack speed | 90 / 100 / 110 % of base HP |

**Visibility (intel).** Each attribute gets a hidden roll of 0–100 when the roster is made. It is visible
if `roll < enemySight chance` (base 25%). The ring reward's type and grade have their own rolls and
chances. Because the rolls are stored, spending intel reveals more of the *current* roster immediately.
Once the fight starts, every attribute is known.

**Worked example.** At 44% enemy sight (2 intel points), an enemy shows on average 5.3 of its 12 attributes.

**Tuning notes.** Appendix B shows how much each attribute swings a fight. HP, Magical, Accurate and Fast
are the biggest; Piercing and Stunning are mild. To make an attribute matter more, widen its Low/High spread.

---

## 13. Rings

| Number | Config path | Value |
|---|---|---|
| Max rings worn | `CONFIG.rings.maxWorn` | 10 for the smith, 10 for the adventurer |
| Duplicate factor | `CONFIG.rings.duplicateFactor` | 0.5 |
| Grade odds by tier | `CONFIG.rings.gradeWeights` | normal D 60 / C 30 / B 10; elite C 60 / B 30 / A 10; champion B 60 / A 30 / S 10 |
| Types and values | `CONFIG.rings.types.<type>.values` | [D, C, B, A, S], see table |

Every defeated enemy drops one ring. Its type is uniform over all 17 types (5.9% each; 7 of 17 are smith
rings), its grade comes from the tier's weights. No ring on a loss or draw. Smith rings can be changed any
time; adventurer rings are chosen in the nightly plan (max 10).

| Ring | Owner | D / C / B / A / S | Effect (where it goes in the formulas) |
|---|---|---|---|
| Travel | smith | 5 / 6 / 7 / 8 / 10 | % less travel time (all trips) |
| Quick search | smith | 5 / 6 / 7 / 8 / 10 | % less search time |
| Thorough search | smith | 10 / 12 / 14 / 16 / 20 | % more searched per search (multiplies the 25%) |
| Ore sight | smith | 3 / 4 / 5 / 6 / 7 | points added to the ore sight chance |
| Refining | smith | 5 / 6 / 7 / 8 / 10 | % less refining **and** cutting time |
| Bar luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on bars |
| Gem luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on gems |
| Piercing | adventurer | 3 / 4 / 5 / 6 / 7 | % of enemy defense ignored |
| Pierce resistance | adventurer | 3 / 4 / 5 / 6 / 7 | points off enemy piercing |
| Magic damage | adventurer | 3 / 4 / 5 / 6 / 7 | % of weapon damage added as magic |
| Magic resistance | adventurer | 3 / 4 / 5 / 6 / 7 | % magic damage reduction |
| Stun resistance | adventurer | 5 / 6 / 7 / 8 / 10 | % less stun chance and stun length |
| Accuracy | adventurer | 6 / 7 / 8 / 9 / 10 | accuracy rating |
| Dodge | adventurer | 6 / 7 / 8 / 9 / 10 | dodge rating |
| Slow resistance | adventurer | 5 / 6 / 7 / 8 / 10 | % weaker and shorter slows |
| Speed | adventurer | 2 / 2.5 / 3 / 3.5 / 4 | % attack speed |
| Health | adventurer | 3 / 4 / 5 / 6 / 7 | % max HP |

**Stacking formula** (`ringTotals` in `js/core/rings.js`). Rings of the same type are sorted best first:

```
total = v1 × 1 + v2 × 0.5 + v3 × 0.25 + v4 × 0.125 + ...      (duplicateFactor ^ position)
```

Different types simply add up in their own formulas.

**Worked examples.** Accuracy rings S, A, B, D: 10 + 9 × 0.5 + 8 × 0.25 + 6 × 0.125 = **17.25** accuracy.
Ten Health S rings: 7 × (1 + 0.5 + … ) = **13.99%** HP (the limit is 2 × the best ring). Chance that a
champion drops a specific ring type at S grade: 1/17 × 10% = 0.59%.

**How strong is one ring right now?** Iron C set vs elite day 8, all-normal attributes (baseline 58.6%):
Slow resistance S 68.2%, Speed S 65.5%, Dodge S 65.0%, Health S 64.2%, Magic damage S 64.1%,
Accuracy S 62.7%, Pierce resistance S 60.0%, Magic resistance S 59.9%, Stun resistance S 59.4%,
Piercing S 58.6% (no effect: 7 piercing minus 10 enemy pierce resistance = 0).

**Tuning notes.** `duplicateFactor` decides whether stacking one type is worthwhile (0.5 = no, a second copy
is worth half). Grade weights set how fast ring power grows with fight difficulty; champion fights are the
only source of S rings. Ring values are deliberately bigger than skill bonuses.

---

## 14. Skills

| Number | Config path | Value |
|---|---|---|
| Max level | `CONFIG.skills.maxLevel` | 10 |
| XP curve base | `CONFIG.skills.xpBase` | 100 |
| XP per item (material skills) | `CONFIG.skills.xpPerItem` | 10 |
| Activity skills | `CONFIG.skills.activity.<key>.perLevel` | see table |
| Material skills | `CONFIG.skills.perMaterial.<key>.perLevel` | 0.3 each |

**Formula** (`xpToNext`, `addXp`, `skillBonus` in `js/core/skills.js`):

```
XP to go from level L to L+1 = xpBase × (L + 1)          bonus = perLevel × level
activity skills: XP = actual minutes spent (after time reductions)
material skills: XP = 10 per item refined/cut of that type (failures count); both the grade and
                 the failure skill of that material get the XP
```

Several levels can be gained at once; XP stops at level 10.

**Cumulative XP:**

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Total XP | 100 | 300 | 600 | 1,000 | 1,500 | 2,100 | 2,800 | 3,600 | 4,500 | 5,500 |
| Activity: minutes of work | 100 | 300 | 600 | 1,000 | 1,500 | 2,100 | 2,800 | 3,600 | 4,500 | 5,500 |
| Material: items processed | 10 | 30 | 60 | 100 | 150 | 210 | 280 | 360 | 450 | 550 |

**Skills and bonuses:**

| Skill | Per level | At level 10 | XP from | Applies to |
|---|---|---|---|---|
| Return travel | 0.5 | 5% | minutes travelling to camp | travel time on trips ending at camp (adds to the Travel ring) |
| Search speed | 0.5 | 5% | minutes searching | search time (adds to Quick search ring) |
| Search efficiency | 1 | 10% | minutes searching | efficiency multiplier (adds to Thorough search ring) |
| Debris clearing | 2 | 20% | minutes clearing | debris time |
| Refining speed | 0.5 | 5% | minutes refining | refining time (adds to Refining ring) |
| Cutting speed | 0.5 | 5% | minutes cutting | cutting time (adds to Refining ring) |
| Copper / Iron / Steel / Mythril bar grade (4 skills) | 0.3 | 3% | 10 XP per bar of that type | upgrade luck for that bar (adds to Bar luck ring) |
| Copper / Iron / Steel / Mythril refining (4 skills) | 0.3 | 3 points | 10 XP per bar of that type | failure → D for that bar |
| Ruby / Topaz / Sapphire / Emerald / Diamond grade (5 skills) | 0.3 | 3% | 10 XP per gem of that type | upgrade luck for that gem (adds to Gem luck ring) |
| Ruby / … / Diamond cutting (5 skills) | 0.3 | 3 points | 10 XP per gem of that type | failure → D for that gem |

**Worked examples.** One 30-minute search gives 30 XP to both Search speed and Search efficiency; level 10
needs about 184 searches (≈ 9 full days of nothing but searching; a bit more once the search gets faster,
because XP = minutes). Refining 60 mythril ore (failures count) reaches Mythril bar grade level 3 = +0.9%
upgrade luck.

**Ceilings from finite resources.** Fields never regrow (≈ 1,080 items per run, ≈ 192 debris cells), so some
skills cannot reach level 10 in any run: clearing every debris cell on the map gives about 2,650 XP (level 6,
because clearing gets faster as the skill grows and XP = minutes); a whole map's mythril (≈ 73) reaches
level 3; diamonds (≈ 44) level 2.

**Tuning notes.** `xpBase` scales every skill's pace. Per-level values are intentionally small (a maxed
skill ≈ a D or C ring). If you want material skills to reach high levels, raise `xpPerItem`.

---

## 15. Intel

| Number | Config path | Value |
|---|---|---|
| Days per point | `CONFIG.intel.daysPerPoint` | 5 (a point at the end of day 5, 10, 15, …) |
| Gain per point | `CONFIG.intel.gainsPerPoint` | 10, 9, 8, 7, 6, 5, 4, 3, 2 |
| Gain after that | `CONFIG.intel.minGain` | 1 |
| Maximum chance | `CONFIG.intel.maxChance` | 100 |
| Ore sight base | `CONFIG.intel.tracks.oreSight.base` | 10 |
| Enemy scouting base | `CONFIG.intel.tracks.enemySight.base` | 25 |
| Ring type scouting base | `CONFIG.intel.tracks.ringTypeSight.base` | 25 |
| Ring grade scouting base | `CONFIG.intel.tracks.ringGradeSight.base` | 25 |

**Formula** (`intelChanceFor` in `js/core/intel.js`):
`chance = min(100, base + sum of gains for points 1..n)`; the n-th point on a track gives `gainsPerPoint[n−1]`,
or 1 after the list runs out. Each track counts its own points.

**Cumulative chance by points spent on one track:**

| Points | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | to reach 100% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Base 25 tracks | 25 | 35 | 44 | 52 | 59 | 65 | 70 | 74 | 77 | 79 | 80 | 82 | 30 points (day 150) |
| Ore sight (base 10) | 10 | 20 | 29 | 37 | 44 | 50 | 55 | 59 | 62 | 64 | 65 | 67 | 45 points (day 225) |

**Worked example.** By the end of day 20 the player has earned 4 points. All four on Enemy scouting:
25 → 59%, so about 7 of 12 attributes are visible on each enemy.

**Tuning notes.** `daysPerPoint` is the pace; the first few points are worth the most, which favors spreading
points over tracks. Lower the scouting bases to make planning riskier (the win-chance simulation then has
to guess more).

---

## 16. Score

| Number | Config path | Value |
|---|---|---|
| Points per win | `CONFIG.enemies.tiers.<tier>.score` | normal 10, elite 25, champion 50 |

**Formula.** Score = sum of points for every enemy defeated. A draw gives 0. A loss ends the run. The best
score is kept in the browser (localStorage) across new games.

**Worked example.** 10 days of fights: 4 normal, 5 elite, 1 champion = 40 + 125 + 50 = **215**.

**Tuning notes.** Champion = 5 normals. With the current power curve, champions are often a real risk of
game over, so this ratio sets how much risk a score-chaser takes. Raising the champion score pushes
riskier play.

---

## Appendix A — Power curve snapshot

Win % of a full 5-piece set (no gems, no rings) against an enemy whose attributes are all hidden
(60 attribute guesses × 50 fights each, current config):

**Normal enemies**

| Set | Day 2 | Day 5 | Day 10 | Day 15 | Day 20 | Day 30 |
|---|---|---|---|---|---|---|
| No gear | 22.3 | 0.9 | 0 | 0 | 0 | 0 |
| Copper D | 100 | 99.7 | 82.5 | 20.5 | 1.3 | 0 |
| Copper B | 100 | 100 | 96.4 | 59.5 | 12.8 | 0 |
| Iron C | 100 | 100 | 100 | 97.6 | 73.6 | 5.3 |
| Iron A | 100 | 100 | 100 | 99.9 | 95.3 | 24.3 |
| Steel C | 100 | 100 | 100 | 100 | 99.1 | 58.6 |
| Steel A | 100 | 100 | 100 | 100 | 99.9 | 88.8 |
| Mythril C | 100 | 100 | 100 | 100 | 100 | 99.7 |
| Mythril S | 100 | 100 | 100 | 100 | 100 | 100 |

**Elite enemies**

| Set | Day 2 | Day 5 | Day 10 | Day 15 | Day 20 | Day 30 |
|---|---|---|---|---|---|---|
| Copper D | 39.4 | 5.3 | 0 | 0 | 0 | 0 |
| Copper B | 76.7 | 27.4 | 0.7 | 0 | 0 | 0 |
| Iron C | 99.6 | 90.6 | 22.6 | 1.8 | 0 | 0 |
| Iron A | 100 | 98.3 | 64.9 | 10.2 | 0.6 | 0 |
| Steel C | 100 | 99.8 | 86.9 | 29 | 4 | 0 |
| Steel A | 100 | 100 | 98.3 | 75.4 | 27.5 | 0.5 |
| Mythril C | 100 | 100 | 100 | 98.2 | 80.8 | 12.4 |
| Mythril S | 100 | 100 | 100 | 100 | 99.9 | 87.5 |

**Champion enemies**

| Set | Day 2 | Day 5 | Day 10 | Day 15 | Day 20 | Day 30 |
|---|---|---|---|---|---|---|
| Copper B | 0 | 0 | 0 | 0 | 0 | 0 |
| Iron C | 10.1 | 0.8 | 0 | 0 | 0 | 0 |
| Iron A | 41.2 | 7 | 0.1 | 0 | 0 | 0 |
| Steel C | 69.3 | 22.8 | 0.4 | 0 | 0 | 0 |
| Steel A | 93.1 | 58.1 | 6.6 | 0.2 | 0 | 0 |
| Mythril C | 99.8 | 97.1 | 51.3 | 7.5 | 0.7 | 0 |
| Mythril S | 100 | 100 | 99.3 | 81.2 | 34.7 | 1.4 |

Reading it: one gear tier stays safe against normals for about 10 more days than the previous one. Gems
(especially a ruby sword) and rings add a lot on top (Appendix B, sections 7 and 13). Remember the
supply limit from section 3.1: mythril S sets are almost unreachable.

## Appendix B — How much each enemy attribute matters

Iron C full set vs an elite on day 8. All attributes Normal except the one listed (20,000 fights each).
Baseline (all Normal): **58.6%** win.

| Attribute | Low | Normal | High |
|---|---|---|---|
| HP | 76.6% | 58.6% | 38.7% |
| Magical | 74.5% | 58.6% | 40.4% |
| Accurate | 76.0% | 58.6% | 44.8% |
| Fast | 73.8% | 58.6% | 46.8% |
| Evasion | 69.8% | 58.6% | 47.7% |
| Chilling | 67.7% | 58.6% | 48.3% |
| Stunning | 63.0% | 58.6% | 54.9% |
| Piercing | 60.1% | 58.6% | 51.2% |

The defensive attributes Pierce resistance, Magic resistance, Stun resistance and Slow resistance only
matter against the matching adventurer gems and rings.

## Appendix C — Worked fight, start to finish

Adventurer: iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots
(damage 18, accuracy 128, dodge 111, defense 18.9, speed 3.3%, magic 15%, HP 100).
Enemy: elite Ogre, day 6; Piercing High, Pierce res Normal, Magical Normal, Magic res Low, Stunning Low,
Stun res Normal, Accurate Normal, Evasion High, Chilling Low, Slow res Normal, Fast Normal, HP Normal
(HP 112.5, damage 10, accuracy 110, dodge 132, defense 15).

| Step | Adventurer → Ogre | Ogre → Adventurer |
|---|---|---|
| Hit chance | 128² / (128² + 0.25 × 132²) = 79.0% | 110² / (110² + 0.25 × 111²) = 79.7% |
| Piercing | 0 − 10 → 0% | 25 − 0 → 25% |
| Effective defense | 15% | 18.9 × 0.75 = 14.175% |
| Physical per hit | 18 × 0.85 = 15.3 | 10 × 0.858 = 8.58 |
| Magic per hit | 18 × 15% × (1 − 0) = 2.7 | 10 × 20% × (1 − 0) = 2.0 |
| Total per hit (before the 90–110% roll) | 18.0 | 10.58 |
| Attack every | 2 / 1.033 = 1.94 s | 2.0 s |
| Expected damage per second | 0.79 × 18 / 1.94 = 7.34 | 0.797 × 10.58 / 2 = 4.22 |
| Time to win | 112.5 / 7.34 ≈ 15.3 s | 100 / 4.22 ≈ 23.7 s |
| Side effects | — | 5% stun chance (1.0 s); slow 10% for 2.0 s on hit |

Simulated with the attributes known: **92.7%** win.
