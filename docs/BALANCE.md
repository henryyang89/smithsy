# Smithsy — Balance Handbook

Every tunable number in the game lives in `js/config.js` (the `CONFIG` object). This handbook explains
what each number does, the exact formula the code uses, a worked example with real numbers, and what
happens if you change it.

- **The code is the truth.** Formulas below were copied from `js/core/*.js`. If this file and the code
  ever disagree, the code wins and this file should be fixed.
- **Units.** Percentages are written as whole numbers (`25` means 25%). Times are minutes for the work
  day and seconds inside a fight.
- **"Points" vs "%".** "+5 points" means add 5 to a percentage (40% → 45%). "+5%" means multiply by 1.05.
- **Where the example numbers come from.** Worked examples were computed by calling the real core modules
  (`js/core/*.js`) with the current config. Win-rate tables come from `node tools/balance.mjs`
  (`--section power` for Appendix A and the gem/ring/slot value tables, `--section economy` for the
  supply numbers, `--section bot --seeds 24` for the bot results). Appendix B and C come from direct
  `fight()` simulations (20,000–50,000 fights each). Rerun the tool after any change; see
  [Balance targets and current results](#balance-targets-and-current-results). All numbers here match the
  config as of commit 22b062f (debris skill 0.5 per level).

---

## Quick levers

These are the knobs with the biggest effect on difficulty and pacing, roughly in order of impact.

| Lever | Config path | Now | Raise it | Lower it |
|---|---|---|---|---|
| Enemy HP and damage growth per day | `CONFIG.enemies.growthPerDay.hpDamage` | 3 (+3%/day, linear) | Late game gets hard sooner, runs get shorter | Longer runs, gear stays useful longer |
| Enemy accuracy/dodge growth per day | `CONFIG.enemies.growthPerDay.ratings` | 1 (+1%/day) | Enemies hit you more and dodge more late on | Accuracy/dodge gear keeps its value longer |
| Enemy tier base stats | `CONFIG.enemies.tiers.<tier>.hp / damage / defense` | normal 80/8/20, elite 80/9/25, champion 90/10/30 | Every fight harder from day 2 | Easier start |
| Enemy attribute spread | `CONFIG.enemies.attributes.<key>.values` | see 12.3 | Low/High further apart: tiers differ more, scouting matters more | Tiers closer together |
| Material power | `CONFIG.gear.materialMult` | copper 1, iron 1.5, steel 2, mythril 3 | Bigger jump per material tier | Flatter curve, grades matter more |
| Grade power | `CONFIG.gear.gradeMult` | D 1.0 … S 1.5 | Lucky refines matter more | Material matters more than luck |
| Refining luck | `CONFIG.refine.<bar>.dist` | F 10, D 30–45 | More weight on D/F: slower gear progress | More weight on S/A/B: faster gear progress |
| Mythril supply | `CONFIG.field.oreWeights` (mythril column) | 0 / 0 / 0 / 5 by distance (only distance 4+) | Mythril gear arrives earlier | Mythril stays rare |
| Coal supply (steel) | `CONFIG.field.oreWeights` (coal column) | 0 / 5 / 15 / 20 | Steel arrives earlier | Steel later |
| Field richness | `CONFIG.field.lootChance` | 40% +5/step, max 70% | More ore per search | Scarcer, more travel |
| Field regrowth | `CONFIG.field.regrowPctPerDay` | 5 (%/night per searched cell) | Near fields refill faster, less travel | Map runs dry, forces far trips |
| Search speed | `CONFIG.field.searchEfficiency`, `CONFIG.field.searchMin` | 50% per search (2 searches per cell), 30 min | Faster gathering | Slower gathering |
| Processing times | `CONFIG.refine.<bar>.minutes`, `CONFIG.cut.<gem>.minutes` | 15 / 20 / 25 / 30, gems 20 | Less of the day left for mining | More gear per day |
| Travel cost | `CONFIG.map.travelMinPerStep` | 20 min/step | Far (rich) fields cost more of the day | Far fields become the default |
| Bag size | `CONFIG.bag.slots` | 20 | Fewer trips home | More trips home, far fields less attractive |
| Adventurer HP | `CONFIG.adventurer.hp` | 100 | Survives longer in every fight | Fights get swingier |
| Hit-chance curve | `CONFIG.combat.hitK` | 0.25 | Everyone misses more; accuracy gear matters more | Hits land more; dodge matters less |
| Gear wear | `CONFIG.gear.durabilityLoss` | 3–7% per fight | More repair work, more bars spent | Gear lasts longer |
| Repair cost | `CONFIG.gear.repair.materialFraction` | 35% of the bars | Repairs eat into bar supply | Repair is almost free |
| Ring quality | `CONFIG.rings.gradeWeights` | see Rings | Shift weight to higher grades: faster ring power growth | Shift weight down: slower |
| Intel pace | `CONFIG.intel.daysPerPoint` | 5 days per point | Slower intel, more hidden attributes, more risk | Faster intel, fewer surprises |
| Starting scouting | `CONFIG.intel.tracks.enemySight.base` | 10% | Fewer surprises in fights | More hidden attributes, more risk |
| Day length | `CONFIG.time.dayStartMin / dayEndMin` | 8:00–18:00 (600 min) | Longer day: more work per fight, easier | Shorter day: harder |
| Skill strength | `CONFIG.skills.activity.<key>.perLevel`, `CONFIG.skills.perMaterial.<key>.perLevel` | 0.4 / 0.8 / 0.5 per level (time / search efficiency / debris); grade 0.15, fail 0.3 | Skills feel rewarding | Skills stay a small extra (now: no measurable effect on the bot) |
| Champion reward | `CONFIG.enemies.tiers.champion.score` | 50 (normal 10, elite 25) | Risky picks pay more | Safe play dominates |

**What the current numbers produce (details in the next section and Appendix A):** a copper C sword +
chest + boots made on day 1 wins about 93% of day-2 normal fights and 37% of elite fights. A full iron C
set stays at 90%+ against normals until about day 10; steel C until day 20, mythril C until day 40,
mythril S until day 60. Against elites the 70% line falls about 5–10 days earlier per tier. Enemy growth
is linear and never stops while gear tops out at mythril S, so every run ends eventually. That is
intended (endless, score-chasing). The scripted "careful" bot lives a median of 50.5 days.

---

## Balance targets and current results

### What the tuning aimed for

The targets are written into `tools/balance.mjs` and the tool flags results outside them:

| Target | Where the tool checks it | Aim | Now |
|---|---|---|---|
| Day-2 fight with sensible day-1 gear (a few copper pieces) | `power` section 1 (`DAY2_TARGET`), bot "d2 typical est" | normal 85–95%, elite 40–65%, champion < 20% | reference set 93 / 37 / 1; bot's own day-1 gear 93 / 43 / 4 (on target, elite at the low edge) |
| Material progression (first pieces / 3 of 5 slots) | bot "Progression milestones" (`PROGRESS_TARGET`) | iron day 5–8, steel day 12–18, mythril day 25+ | iron 4 / 6, steel 8 / 11, mythril 19 / 30 (first pieces 1–6 days before the window; 3 of 5 slots inside it or 1 day early) |
| Weakest plain set that holds a safe win rate | `power` section 3 | the elite ≥ 70% column should follow the progression above | iron day 2–12, steel day 15–20, mythril day 25+ (on target) |
| Run length for a careful player | bot "median life" | around 50 days, with most deaths from day 40 on (the endless ramp, not early bad luck) | median 50.5; 19 of 24 deaths on day 42 or later (on target) |
| Every system worth using | `--ablate` runs | removing a system should cost survival or score | only rings pass clearly; gems, repair, intel and skills are within noise (see ablations below) |

The tiers are deliberately close in base HP and damage (80/80/90 HP, 8/9/10 damage). Difficulty comes
mostly from the attribute mix (normal: 6 Low + 6 Normal; champion: 6 Normal + 6 High) and from defense
(20/25/30%).

### Current results (current `js/config.js`)

**Power curve** (`node tools/balance.mjs --section power`, about 5 s):

```
POWER SUMMARY | day-2 ref (Copper C sword + C chest + C boots) n/e/c 93/37/1% | Cu D sword n/e/c 66/10/0% |
last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d-, Iron C d5, Steel C d15, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80 100/97%
```

The day-2 reference set sits at 37% vs elites, just under the 40–65% band. The bot's own day-1 gear
(usually a gem in the sword) reaches 43%.

**Careful bot** (`node tools/balance.mjs --section bot --seeds 24`, about 80 s). The bot gathers, refines,
cuts, smiths, repairs, wears rings, spends intel and picks the fight with the best
`win% × (points + 1000)` among enemies estimated at 90%+ win (so it almost never risks a champion):

```
BOT SUMMARY | alive d10:88% d20:79% d30:79% d40:79% d50:50% d60:8% d80:0% | median life 50.5 | score 640 |
d2 typical est n/e/c 93/43/4 | first iron/steel/myth piece d4/8/19 | 3-slot iron/steel/myth d6/11/30 |
d11-30 fights n/e/c 31/69/0% | mining 68% trips/day 1.3 idle 9m | repair 0.4% bars 0.1% time
```

| Survival (end of day) | 2 | 5 | 10 | 15 | 20 | 30 | 40 | 50 | 60 | 70 | 80 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| % of runs alive | 92 | 92 | 88 | 83 | 79 | 79 | 79 | 50 | 8 | 0 | 0 |

Death days (24 runs): 2, 2, 6, 11, 19, 42, 45, 46, 48, 50, 50, 50, 51, 52, 52, 56, 56, 57, 57, 57, 58, 58, 62, 65.
Score: mean 640, median 788, max 1,000. Wins per run: 27.1 normal, 14.7 elite, 0.0 champion.

| Progression (median day) | first piece | sword | 3 of 5 slots | all 5 slots | target |
|---|---|---|---|---|---|
| iron or better | 4 | 4 | 6 | 9 | 5–8 |
| steel or better | 8 | 8 | 11 | 20 | 12–18 |
| mythril | 19 | 22 | 30 (17/24 runs) | 37 (8/24 runs) | 25+ |

| Days | Fights: normal / elite / champion % | Mean est. win % | Actual win % | Losses per fight % | "No safe option" fights |
|---|---|---|---|---|---|
| 2–5 | 91 / 9 / 0 | 98.1 | 97.8 | 2.2 | 7 of 90 |
| 6–10 | 44 / 55 / 1 | 99.6 | 99.1 | 0.9 | 0 |
| 11–20 | 22 / 78 / 0 | 99.7 | 99.0 | 1.0 | 0 |
| 21–30 | 41 / 59 / 0 | 99.6 | 100.0 | 0.0 | 0 |
| 31–40 | 90 / 10 / 0 | 99.4 | 100.0 | 0.0 | 2 of 190 |
| 41–50 | 100 / 0 / 0 | 97.1 | 95.9 | 4.1 | 12 of 171 |
| 51–60 | 100 / 0 / 0 | 89.5 | 86.5 | 13.5 | 32 of 74 |
| 61–80 | 100 / 0 / 0 | 78.7 | 71.4 | 28.6 | 5 of 7 |

"No safe option" = even the best enemy on the roster was estimated below the bot's 90% line, so it took
the best one anyway.

| Daily time (minutes) | travel | search | clear | refine | cut | smith | repair | idle | mining share of used time |
|---|---|---|---|---|---|---|---|---|---|
| day 1 | 44 | 210 | 1 | 181 | 50 | 105 | 0 | 10 | 43% |
| days 2–5 | 52 | 178 | 9 | 168 | 82 | 100 | 0 | 10 | 41% |
| days 6–10 | 107 | 185 | 5 | 154 | 73 | 66 | 0 | 9 | 50% |
| days 11–20 | 151 | 198 | 13 | 124 | 64 | 40 | 0 | 11 | 61% |
| days 21–30 | 167 | 219 | 40 | 73 | 72 | 20 | 0 | 9 | 72% |
| days 31–40 | 165 | 231 | 62 | 35 | 83 | 13 | 1 | 9 | 78% |
| days 41–60 | 161 | 263 | 45 | 27 | 84 | 10 | 1 | 9 | 79% |

("Mining" = travel + search + clear. The summary line's 68% is the average over all days from day 2.)

Other bot facts: about 42 rings per run (16.7 smith, 25.1 adventurer); 1.5 repairs per run costing 0.4%
of the bars made; 1.5 items per run destroyed by wear (2% of bars made); 31% of the map searched by the
end of a run; all intel goes to enemy scouting (8.3 points). Five of 24 runs die before day 20, including
two day-2 losses where even the best roster enemy was estimated at only 86–90% with the day-1 gear. After
day 40 deaths are a mix of unlucky losses at 90–99% estimates and "no safe option" days; from day 51 on,
43% of the bot's fights have no safe option.

**System ablations** (same 24 seeds, `--ablate <system>`). With 24 runs, survival numbers move by about
±10 points from noise alone, so only large differences mean something:

| Run | Median life | Alive d40 / d50 / d60 | Mean score | Note |
|---|---|---|---|---|
| full game | 50.5 | 79% / 50% / 8% | 640 | |
| `--ablate rings` | 44.5 | 79% / 21% / 8% | 513 | clear loss: rings are the main late-game power source (fewer elite wins: 7.5 vs 14.7 per run) |
| `--ablate gems` | 51.5 | 71% / 58% / 8% | 643 | no net loss: without cutting and infusing the bot reaches mythril much sooner (3 slots by day 19 instead of 30) but then sits idle about 90 min a day (157 min after day 40) |
| `--ablate repair` | 54.5 | 79% / 63% / 25% | 714 | within noise (repairs are rare anyway, see section 8) |
| `--ablate intel` | 54.5 | 88% / 63% / 25% | 721 | within noise |
| `--ablate skills` | 54.5 | 88% / 58% / 25% | 743 | within noise (no measurable benefit from skills) |

Three ablations came out slightly *better* than the full game. That is the noise level of 24 chaotic runs
(any change reshuffles every later random roll), not a real gain; it does show that repair, intel and
skills currently add nothing measurable for this bot, and that gems only pay for their own time.

### Running what-if experiments

```sh
node tools/balance.mjs --section power                       # power curve only (~5 s)
node tools/balance.mjs --section economy                     # mining / refining economy (~10 s)
node tools/balance.mjs --section bot --seeds 24              # bot playthroughs (~80 s)
node tools/balance.mjs --quick                               # smoke test of all sections

# Override any CONFIG value in memory for one run (js/config.js is never changed):
node tools/balance.mjs --section power --set enemies.growthPerDay.hpDamage=4
node tools/balance.mjs --section bot --set field.oreWeights.3.mythril=10       # array index (row for distance 4+)
node tools/balance.mjs --section bot --set 'field.oreWeights.*.mythril=2'      # '*' = every row
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'

# Play the bot without a system: gems, rings, skills, intel, repair (comma separated)
node tools/balance.mjs --section bot --seeds 24 --ablate rings
node tools/balance.mjs --section bot --seeds 24 --ablate gems,repair
```

Other flags: `--seeds N` (economy: maps, default 100; bot: runs, default 20), `--days N` (bot day limit,
default 80), `--samples N` (power: attribute guesses per cell, default 100), `--minwin P` (bot: lowest
estimated win % it accepts, default 90), `--future F` (bot: how much one survival is worth when picking
fights, default 1000; lower = greedier). `--help` prints the full option list.

How to compare: each section ends with a one-line `ECONOMY SUMMARY`, `POWER SUMMARY` or `BOT SUMMARY`.
Run the baseline and the what-if with the same flags and compare those lines. The run prints the
overrides it applied at the top (`WHAT-IF overrides`). A `--set` path must already exist in `CONFIG`
(typos are rejected) and a number can only be replaced by a number. For close bot comparisons use
`--seeds 40` or more.

Example: `--set enemies.growthPerDay.hpDamage=4` moves the power summary to
`last day >=90% vs normal: ... Steel C d15, Mythril C d30, Mythril S d50 | >=70% vs elite: ... Steel C d10,
Mythril C d20, Mythril S d40 | ceiling vs normal d60/d80 99/63%`, i.e. every tier loses 5–10 days.

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
| Refine one bar | 15 / 20 / 25 / 30 min (copper / iron / steel / mythril) | Refining ring + Refining speed skill |
| Cut one gem | 20 min | Refining ring + Cutting speed skill |
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
- **The day never ends by itself.** At 18:00 the clock shows "day over" and only the walk home and free
  pick-up/drop remain possible. The player ends the day with the "End day" button, which works only at
  camp. Ending it sets the clock to `max(now, 18:00)`.

**Worked example.** 14:30 at a field 3 steps from camp with 8 items in the bag. Walk home =
3 × 20 × 1.08 = 64.8 min. A 30-minute search is allowed because 14:30 + 30 + 64.8 = 16:04.8 ≤ 18:00.
At 16:30 the same search would end at 17:00 and the walk home at 18:04.8, so it is refused.

**Tuning notes.** Day length scales everything that is "per day" (gathering, refining, smithing) against
everything that is "per fight" (wear, enemy growth). Longer days = easier game. The 75% cap only matters
once many rings and skills are stacked (the bot ends runs at about 10% total on each time bonus).

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
distance 3, 3.7 at distance 4 and 0.7 at distance 5 or more (a detour can push a field as far as 12 steps
on rare maps). Because mythril only appears at distance 4+, about 0.7% of maps have a single mythril
field and about 0.01% have none (all four corners blocked).

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

**Worked example.** 3 steps with 10 items, Travel ring S (10%) worn, Return travel skill level 10 (4%):
going out = 60 × 1.10 × (1 − 0.10) = **59.4 min**; coming home = 60 × 1.10 × (1 − 0.14) = 56.76 → **56.8 min**.

**Tuning notes.** `travelMinPerStep` sets how much of the day a rich far field costs: at 20 min/step a
distance-4 round trip takes 160+ of the 600 minutes. Raising it pushes players to near fields (more copper,
fewer gems, no coal or mythril); lowering it makes far fields the obvious choice. `loadPenaltyPerItem` is a
small tax that interacts with bag size (a full 20-item bag = +20% on the way home). The bot spends about
150–170 min a day travelling from day 11 on.

---

## 3. Fields, searching, regrowth, debris and ore sight

### 3.1 What a field holds

| Number | Config path | Value |
|---|---|---|
| Field size | `CONFIG.field.size` | 8 (8x8 = 64 cells) |
| Loot chance per cell | `CONFIG.field.lootChance` | `{ base: 40, perDistance: 5, max: 70 }` |
| Debris chance per cell | `CONFIG.field.debrisChance` | 15 (%) |
| Extra loot chance under debris | `CONFIG.field.debrisLootBonus` | 20 (points) |
| Items in a loot cell (weights) | `CONFIG.field.itemCountWeights` | 1: 50, 2: 35, 3: 15 (average 1.65) |
| Share of items that are ore | `CONFIG.field.oreShare` | 70 (%), the rest are gems |
| Ore weights by distance | `CONFIG.field.oreWeights` | rows for distance 1, 2, 3, 4+ |
| Gem weights by distance | `CONFIG.field.gemWeights` | rows for distance 1, 2, 3, 4+ |

**Formula** (`rollCell` in `js/core/map.js`), per cell:

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
| weights 1 | 80 | 20 | 0 | 0 | 35 | 30 | 20 | 10 | 5 |
| weights 2 | 60 | 35 | 5 | 0 | 30 | 25 | 20 | 15 | 10 |
| weights 3 | 45 | 40 | 15 | 0 | 25 | 25 | 20 | 15 | 15 |
| weights 4+ | 35 | 40 | 20 | 5 | 20 | 20 | 20 | 20 | 20 |
| expected per d1 field | 25.4 | 6.4 | 0 | 0 | 4.8 | 4.1 | 2.7 | 1.4 | 0.7 |
| expected per d2 field | 21.3 | 12.4 | 1.8 | 0 | 4.6 | 3.8 | 3.0 | 2.3 | 1.5 |
| expected per d3 field | 17.6 | 15.7 | 5.9 | 0 | 4.2 | 4.2 | 3.4 | 2.5 | 2.5 |
| expected per d4 field | 15.0 | 17.1 | 8.6 | 2.1 | 3.7 | 3.7 | 3.7 | 3.7 | 3.7 |

So: no coal next to camp, and mythril only in the farthest fields (distance 4+).

**Whole-map totals (average over 1,000 generated maps).** About **1,081 items** on a fresh map: copper 391,
iron 271, coal 86, mythril 10, ruby 86, topaz 79, sapphire 65, emerald 50, diamond 44. Regrowth (3.2) adds
more over time, so this is not a hard cap. Coal limits steel (one coal per steel bar) and mythril is the
scarcest input by far: about 10 ore on a fresh map, plus about 2 mythril per distance-4 field refill.

**Tuning notes.** `lootChance` and `itemCountWeights` set total supply. The mythril column of `oreWeights`
is the main gate on late-game power, and the coal column gates steel. `oreShare` trades bars against gems.
Debris adds richness but costs clearing time.

### 3.2 Regrowth

| Number | Config path | Value |
|---|---|---|
| Regrowth chance | `CONFIG.field.regrowPctPerDay` | 5 (% per searched cell per night) |

**Formula** (`regrowFields` in `js/core/map.js`, run when the night's plan is confirmed and the next day
starts). For every cell of every field with `searched > 0` (partly or fully searched):

```
with regrowPctPerDay % chance: replace the cell by a freshly rolled cell (rollCell for the field's distance:
new debris roll, new hidden items and depths, searched 0, not revealed). Items lying on the ground stay.
```

Never-searched cells (including cleared but unsearched debris cells) do not change.

**Worked example.** A fully searched distance-3 field: each night about 64 × 5% = 3.2 cells regrow, each
holding (0.85 × 50% + 0.15 × 70%) × 1.65 = 0.87 items, so about 2.8 new items per night. After 10 nights
1 − 0.95¹⁰ = 40% of its cells (about 26) are fresh again, holding about 22 items. A searched cell has a
50% chance to have regrown after 14 nights. On a completely searched map, about 64 cells (≈ 54 items)
regrow per night across all 20 fields, which is the long-run supply once the map is spent.

**Tuning notes.** Regrowth keeps the endless game supplied, mostly near camp, where the player searches
most. The bot only searches about 31% of the map before it dies, so it rarely depends on regrowth.
Raising it makes near fields self-sufficient (less reason to travel); setting it to 0 turns fields into a
finite resource.

### 3.3 Searching

| Number | Config path | Value |
|---|---|---|
| Search time | `CONFIG.field.searchMin` | 30 min per 3x3 search |
| Search efficiency | `CONFIG.field.searchEfficiency` | 50 (% of each cell searched per search) |

**Formula** (`search` in `js/core/map.js`):

```
efficiency = searchEfficiency × (1 + (searchEffRing% + searchEffSkill%) / 100)
minutes    = round1( searchMin × (1 − min(searchTimeRing% + searchTimeSkill%, 75) / 100) )
for each cell in the 3x3 area (clipped at the field edge) that has no debris and is not fully searched:
    searched = min(100, searched + efficiency)
    every hidden item with depth < searched is found (all items once searched reaches 100)
```

Found items go into the bag; if the bag is full they land on the ground of that cell. A search costs the
full time even if some cells in the area are skipped (debris, already done, or off the field edge). It is
refused only when no cell in the area can be searched.

After `ceil(100 / efficiency)` searches a cell is fully searched: **2 searches at 50%**. Bonuses do not
change that count, because finishing in 1 search would need efficiency 100 (+100% bonus) and the best
possible stack is below +48% (Thorough search rings add at most 2 × 20 with the duplicate penalty, the skill
8). Instead they move items into the first search: at 62% the first search finds 62% of a cell's items
and the second the remaining 38%.

**Worked example.** A fresh, debris-free 3x3 area in a distance-2 field holds on average
9 × 0.45 × 1.65 = 6.7 items. The first 30-minute search finds about half (3.3), the second the rest.
With a Thorough search ring S (20%) and Search efficiency skill level 5 (4%), efficiency is
50 × 1.24 = 62% per search: about 4.1 items in the first search and 2.5 in the second.

Covering a whole 8x8 field takes at least 9 areas × 2 searches = 18 searches (9 hours); greedy area picks
in the economy report use about 20.4 searches per field because areas overlap at the edges.

**Tuning notes.** The efficiency bonus pays off for "skimming": searching fresh areas once and moving on
(the first pass then yields 24% more at 62%). It does nothing for a player who always finishes cells.
Breakpoints of the base value: 50–99 = 2 searches per cell, 34–49 = 3, 25–33 = 4. `searchMin` and
`searchEfficiency` together set items per minute; the bag size (20) caps how much one trip can carry.

### 3.4 Debris

| Number | Config path | Value |
|---|---|---|
| Debris chance | `CONFIG.field.debrisChance` | 15 (% of cells) |
| Clearing time | `CONFIG.field.debrisClearMin` | 15 min per debris cell |
| Debris loot bonus | `CONFIG.field.debrisLootBonus` | +20 points loot chance |

**Formula.** "Clear debris" clears **every** debris cell in the 3x3 area at once:
`minutes = round1( count × round1(debrisClearMin × (1 − min(debrisSkill%, 75)/100)) )`.
Debris cells cannot be searched until cleared. A field has about 9.6 debris cells (≈ 192 per map), and a
regrown cell rolls debris again.

**Worked example.** An area with 3 debris cells and Debris clearing skill level 5 (5 × 0.5 = 2.5%):
per cell = round1(15 × 0.975) = 14.6 min, total 3 × 14.6 = **43.8 min**. At skill level 10 (5%) a cell takes
14.3 min.

**Tuning notes.** A debris cell has +20 points loot chance (60% instead of 40% at distance 1), so it holds
about 0.99 expected items instead of 0.66; clearing it costs 15 min on top of searching. In the economy
report the minutes per extra item found under debris (11–19) are close to plain searching (11–17), so
clearing is roughly break-even. Raising `debrisChance` hides more of each field behind a time cost. The
Debris clearing skill is deliberately small (0.5% per level, 5% at level 10) and has no ring counterpart;
the bot ends runs at about level 4 (2% faster).

### 3.5 Ore sight

| Number | Config path | Value |
|---|---|---|
| Base ore sight chance | `CONFIG.intel.tracks.oreSight.base` | 10 (%) |
| Ore sight ring | `CONFIG.rings.types.reveal.values` | 3 / 4 / 5 / 6 / 7 points (D…S) |

**Formula.** `revealChance = intelChance('oreSight') + oreSightRingTotal` (points). After every search,
each searched cell that is not yet revealed rolls this chance once. A revealed cell shows every item still
hidden in it (you still have to search to collect them). There is no cap: 100% or more always reveals.
A regrown cell starts unrevealed again.

**Worked example.** Base 10% plus 2 intel points (+10, +9) plus an Ore sight ring B (5): 34% per cell, so a
9-cell search reveals about 3 cells on average.

**Tuning notes.** Ore sight is information, not loot: it tells the player when to stop digging an empty
cell. With only 2 searches per cell it saves at most one search on a cell, so it is weak; the bot never
spends intel on it.

---

## 4. Bag and storage

| Number | Config path | Value |
|---|---|---|
| Bag slots | `CONFIG.bag.slots` | 20 (1 raw ore or raw gem per slot) |

**Rules.** When the bag is full, found items stay on the ground of their cell (visible, free to pick up
later). Items can be dropped onto a cell in the current field for free. Arriving at camp unloads the whole
bag into unlimited camp storage. Each item in the bag adds `loadPenaltyPerItem` (1%) to travel time.

**Worked example** (economy report, section 3a). One trip from 8:00 to a distance-2 field: 88 min of
travel (40 out, 48 back with a full bag) and about 200 min of searching fill the bag (20 items) in about
290 minutes. A second trip the same afternoon brings the day to about 34 items. At distance 4 the travel
eats more of the day: about 29 items/day.

**Tuning notes.** Bag size is a soft cap on items per trip and pushes players toward near fields or mid-day
trips home. Raising it mostly helps far-field play. The bot makes 1.3 trips a day on average and its
trips carry 9.7 items; only 13% of its trips fill the bag (it heads home when the rest of the day is better
spent refining).

---

## 5. Refining and cutting

| Number | Config path | Value |
|---|---|---|
| Refining recipes and times | `CONFIG.refine.<bar>.input / minutes` | copper 1 copper, 15 min; iron 1 iron, 20 min; steel 1 iron + 1 coal, 25 min; mythril 1 mythril, 30 min |
| Refining outcome tables | `CONFIG.refine.<bar>.dist` | see table |
| Cutting times | `CONFIG.cut.<gem>.minutes` | 20 min for every gem |
| Cutting outcome tables | `CONFIG.cut.<gem>.dist` | S 5, A 10, B 20, C 25, D 30, F 10 for every gem |
| Time-reduction cap | `CONFIG.processing.maxTimeReduction` | 75 (%) |

**Base outcome tables (% chance):**

| Bar / gem | S | A | B | C | D | Fail | Share of successes at B or better | Average grade multiplier of a success |
|---|---|---|---|---|---|---|---|---|
| Copper | 5 | 10 | 20 | 25 | 30 | 10 | 38.9% | 1.13 |
| Iron | 4 | 8 | 18 | 25 | 35 | 10 | 33.3% | 1.12 |
| Steel | 3 | 6 | 16 | 25 | 40 | 10 | 27.8% | 1.10 |
| Mythril | 2 | 4 | 14 | 25 | 45 | 10 | 22.2% | 1.08 |
| Any gem | 5 | 10 | 20 | 25 | 30 | 10 | 38.9% | n/a |

A failure destroys the input (ore or raw gem). XP is still gained on a failure.

**Formula: bonuses** (`adjustDistribution` in `js/core/processing.js`). Two modifiers are applied in order:

1. **Fail reduction** (skills such as "Copper refining" / "Ruby cutting", one per bar or gem type):
   `r = min(failRed, F)` points move from F to D.
2. **Upgrade luck** u% (ring "Bar luck"/"Gem luck" + skills such as "Copper bar grade" / "Ruby grade"):
   every success below S has a u% chance to go up one grade. S stays S.

```
S' = S + A·u        A' = A·(1−u) + B·u     B' = B·(1−u) + C·u
C' = C·(1−u) + D·u  D' = D·(1−u)           F' = F         (u as a fraction, D already includes the moved fail points)
```

Time: `minutes = round1(base × (1 − min(processTimeRing% + refineTime/cutTime skill%, 75) / 100))`.
The Refining ring applies to both refining and cutting; the skills are separate.

**Worked example.** Copper with Copper refining skill level 10 (3 points), Bar luck ring S (6) and Copper
bar grade skill level 10 (1.5), so u = 7.5%:
step 1: F 10 → 7, D 30 → 33.
step 2: S = 5 + 10×0.075 = **5.75**, A = 10×0.925 + 20×0.075 = **10.75**, B = 20×0.925 + 25×0.075 = **20.375**,
C = 25×0.925 + 33×0.075 = **25.6**, D = 33×0.925 = **30.525**, F = **7**.

The same bonuses on mythril: S 2.3, A 4.75, B 14.825, C 26.725, D 44.4, F 7.

**Why grades are hard.** Gear needs *all* bars of the same material **and** grade (2 or 3 bars). With the
mythril table only 2 in 90 successes are S, so matching grades is the real bottleneck, and lower grades are
what players will usually smith. The economy report puts the expected inputs for a full set at 13.5 ore
for any matched grade but 26 mythril ore for "every piece C or better".

**Refining minutes per usable bar** (economy report, no bonuses): copper 25, iron 36, steel 50, mythril 67
minutes per C-or-better bar; gems 33 minutes per C-or-better cut gem.

**Tuning notes.** The D column is the main knob for gear quality: every point moved from D to a higher
grade makes matching sets of that grade more common. F is a flat material tax. Upgrade luck is weak per
point (each point moves 1% of each grade up one step), which is why rings give only 2–6. Processing times
(15 → 30 min) were raised so that refining and cutting take a real share of the day (the bot spends about
290–350 min a day at camp refining, cutting and smithing in the first 10 days, falling to about 120–130 min
after day 30 as it mines more).

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
| Steel C | 22 | 144 | 30.8 | 122 | 6.6 | 1.88 s |
| Steel A | 26 | 152 | 36.4 | 126 | 7.8 | 1.86 s |
| Steel S | 30 | 160 | 42.0 | 130 | 9.0 | 1.83 s |
| Mythril C | 33 | 166 | 46.2 | 133 | 9.9 | 1.82 s |
| Mythril A | 39 | 178 | 54.6 | 139 | 11.7 | 1.79 s |
| Mythril S | 45 | 190 | 63.0 | 145 | 13.5 | 1.76 s |

Note that "copper S" equals "iron D" and "steel S" equals "mythril D": one material step is worth roughly
the whole D-to-S grade range.

**Worked example.** Steel A chest: 6 × 2.0 × 1.3 = **15.6% defense**, costs 3 steel A bars and 45 min.

**How much each slot is worth** (power report, steel C set vs an elite on day 20, base 46.2%): upgrading
one piece to mythril C adds sword +45.0, boots +14.8, chest +10.8, helmet +6.5, gloves +6.1 points;
removing it costs sword −46.2, boots −24.5, chest −13.6, gloves −10.4, helmet −9.2.

**Tuning notes.** `materialMult` is the backbone of the power curve. Enemies grow without limit while
materials stop at mythril, so these values set how many days each material stays viable (Appendix A).
`gradeMult` decides how much refining luck matters. Slot base stats set the role of each piece: the sword
dominates (damage multiplies everything), boots are second because speed and dodge both scale. Boots'
speed is small on purpose because speed multiplies all damage.

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
| Ruby | +5 / 8 / 10 / 12 / 15 magic damage, % of weapon damage | +4 / 6 / 8 / 10 / 12 % magic resistance |
| Topaz | +10 / 12 / 15 / 18 / 20 % stun chance per hit, stun 1 / 1 / 1.2 / 1.4 / 1.5 s | +4 / 6 / 8 / 10 / 12 % less stun chance **and** % shorter stuns |
| Emerald | +20 / 30 / 40 / 50 / 60 accuracy | +4 / 6 / 8 / 10 / 12 dodge |
| Sapphire | +10 / 15 / 20 / 25 / 30 % slower enemy attack bar for 1 / 1.5 / 2 / 2.5 / 3 s per hit | +4 / 6 / 8 / 10 / 12 % weaker slows **and** % shorter slows |
| Diamond | +20 / 30 / 40 / 50 / 60 % of enemy defense ignored (before its pierce resistance) | +4 / 6 / 8 / 10 / 12 % of enemy piercing ignored |

**Formula.** `armorGemValue = armorTable[grade] × gemArmorMult[slot]`. Sword gem values are not scaled by
material or grade. Armor gem effects from several pieces add up.

**Armor values after the slot factor (grade S):** chest 15, helmet 13.2, gloves 12, boots 12
(grade D: chest 5, helmet 4.4, gloves 4, boots 4).

**Worked example.** Emerald S on a chest: 12 × 1.25 = **+15 dodge**. Ruby C on a sword: magic damage +8%
of the sword's damage. On an iron B sword (18 damage) that is 1.44 extra magic damage per hit before the
enemy's magic resistance.

**How strong is each gem right now?** Win-% change for a steel C full set against a typical elite on day
20 (all attributes hidden, base 46.2%; power report):

| Gem | Sword C | Sword S | Chest C | All 4 armor pieces C |
|---|---|---|---|---|
| Ruby | +11.3 | +21.1 | +2.5 | +8.8 |
| Diamond | +10.1 | +20.5 | +0.3 | +0.9 |
| Sapphire | +8.1 | +24.8 | +4.3 | +9.2 |
| Emerald | +7.1 | +11.0 | +4.1 | +15.9 |
| Topaz | +4.8 | +11.9 | +0.5 | +2.6 |

**Tuning notes.** The sword gems were rebalanced (ruby halved from 10–30% to 5–15%; emerald and diamond
doubled; topaz stun chance raised from 4–12% to 10–20% and stuns from 0.5–1.0 s to 1–1.5 s; sapphire
unchanged) so that ruby, diamond and sapphire swords are close, with emerald and topaz a step behind.
Armor gems are much weaker except emerald (dodge) and sapphire (slow resistance against Chilling).
Diamond armor (pierce resistance) and topaz armor (stun resistance) are nearly worthless because enemy
Piercing (5–25% of your defense) and Stunning (5–15% chance of a 1 s stun) are small threats; see 10.4 and
10.6. To rebalance, scale the tables in `CONFIG.gemEffects`.

---

## 8. Durability and repair

| Number | Config path | Value |
|---|---|---|
| Wear per fight | `CONFIG.gear.durabilityLoss` | `{ min: 3, max: 7 }` (whole %, uniform) |
| Repair material cost | `CONFIG.gear.repair.materialFraction` | 35 (% of the original bars and gem for a 0→100% repair) |
| Repair time | `CONFIG.gear.repair.timeFraction` | 50 (% of the original smithing time for a 0→100% repair) |

**Formula** (`resolveBattle` in `game.js`, `repairInfo` in `gear.js`):

```
after each fight (win, draw or loss), every item the adventurer actually USED loses randInt(3, 7) durability
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
| Chest | 95% | 0.06 iron C (3 × 0.35 × 0.05 = 0.0525, rounded up) | none | 1.1 min |
| Chest | 50% | 0.53 iron C | none | 11.3 min |
| Sword + ruby B | 93% | 0.05 iron C | 0.03 ruby B | 1.4 min |
| Sword + ruby B | 40% | 0.42 iron C | 0.21 ruby B | 12 min |
| Boots + emerald C | 70% | 0.21 iron C | 0.11 emerald C | 6 min |

**Lifetime.** Average wear is 5% per fight, so an unrepaired item lasts about 20 fights (15 at worst,
34 at best). Repairing after every fight would cost about 1.75% of the item's bars per fight (plus
rounding), so roughly 57 fights of repairs cost as much as a new item.

**The packing rule.** Wear lands at the end of the fight day, and the next plan is made right away. An
item that is packed every night is therefore never at home during a work day and can never be repaired.
To repair it, leave it home for a day (pack a backup in that slot instead). In the bot runs this makes
repairs rare: 1.5 repairs per run costing 0.4% of the bars made, 1.5 items per run destroyed by wear
(2% of the bars made), and `--ablate repair` shows no measurable difference. Gear is usually replaced by
better gear before it wears out.

**Tuning notes.** Wear and repair cost were meant to be the main sinks for bars after the first sets are
made. Under the packing rule they hardly bite. Raising `durabilityLoss` (for example to 8–12) makes items
wear out within the life of a material tier and forces backup items and rest days; raising
`materialFraction` makes new gear relatively cheaper than repairs.

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
speed 3.3%, magic 8% of weapon damage, HP 100.

**Tuning notes.** HP is the cleanest difficulty knob for the player side: +10 HP is about +10% time to die
in every fight. Base accuracy/dodge 100 sets where the hit-chance curve starts (80% both ways vs a "normal"
day-1 enemy).

---

## 10. Combat

A fight is simulated event by event (`fight` in `js/core/combat.js`). **Each side has an attack bar** that
fills from 0 to 1 and attacks when full; then it empties and starts again. Slows make the bar fill more
slowly for a while; stuns stop it from filling for a while. The fight ends when one side reaches 0 HP.

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

**Worked example.** Adventurer accuracy 128 vs an elite with High Evasion on day 6 (120 × 1.05 = 126 dodge):
128² / (128² + 0.25 × 126²) = 16,384 / 20,353 = **80.5%**.

**Tuning notes.** Raising `hitK` shifts the whole curve down (more misses for both sides) and makes
accuracy/dodge more valuable. It interacts with enemy rating growth (+1%/day): late-game adventurer
accuracy (190 from a mythril S set, more with emeralds and rings) against 120–180 enemy dodge stays below
the 95% cap.

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

**Formula.** `effectiveDefense = min(defense, 75) × (1 − pierce%/100)` (pierce% from 10.4);
`physical damage = damage × (1 − effectiveDefense/100)`.

**Worked example.** Elite Ogre on day 6 (damage 9 × 1.15 = 10.35) with High Piercing (25) vs adventurer
defense 18.9 (no pierce resistance): effective defense = 18.9 × 0.75 = 14.175; physical =
10.35 × (1 − 0.14175) = **8.88**.

**Tuning notes.** The best possible gear defense is 63% (mythril S set) and there are no defense rings, so
the cap is currently never reached. It only matters if slot defense values or multipliers go up. Enemy
defense is 20 / 25 / 30% by tier (no daily growth).

### 10.4 Piercing and pierce resistance

Piercing = % of the defender's defense ignored. Pierce resistance = % of the *attacker's piercing* ignored
(a relative reduction, not a subtraction).

**Formula** (`hitDamage`):

```
pierce% = clamp(attacker.pierce, 0, 100) × (1 − min(defender.pierceRes, 75) / 100)
effectiveDefense = min(defender.defense, 75) × (1 − pierce% / 100)
```

- Adventurer piercing = diamond sword (20–60) + Piercing rings (3–7). Enemy pierce resistance
  (`CONFIG.enemies.attributes.pierceRes.values`) = 0 / 20 / 40 %.
- Enemy piercing (`CONFIG.enemies.attributes.piercing.values`) = 5 / 15 / 25. Adventurer pierce
  resistance = diamond armor (4–15 per piece after the slot factor, summed) + Pierce resistance rings
  (5–10), capped at 75.

**Worked examples.** Diamond S sword (60) + Piercing ring S (7) = 67 vs a champion with High pierce
resistance (40): 67 × 0.6 = 40.2% of its 30 defense ignored → effective defense 17.94, physical damage
×0.821 instead of ×0.70 (**+17%**).
Defending: a Pierce resistance ring S (10) + diamond S chest (15) = 25% against High Piercing (25):
25 × 0.75 = 18.75% of your defense ignored instead of 25%. With a steel C set (30.8 defense) that changes
damage taken from ×0.769 to ×0.750, only 2.5% less.

**Tuning notes.** Enemy defense (20/25/30) makes adventurer piercing worthwhile (a diamond sword is one of
the best gems). The reverse is weak: enemy Piercing ignores at most a quarter of your defense, so pierce
resistance protects very little (pierce resistance rings test at +0.3 to +0.4 points). Raising the enemy
Piercing values would make diamond armor and the ring matter.

### 10.5 Magic damage and magic resistance

**Formula.** `magic damage = attacker.damage × magicPct/100 × (1 − min(defender.magicRes, 75)/100)`.
Magic ignores defense and piercing. Cap: `CONFIG.combat.resistCap` = 75.

- Adventurer magicPct = ruby sword (5–15) + Magic damage rings (3–7), based on the *sword's* damage
  (unarmed: 4). Enemy magic resistance (`magicRes`) = 0 / 15 / 30.
- Enemy magicPct (`magical`) = 10 / 20 / 30 % of its damage. Adventurer magic resistance = ruby armor
  (4–15 per piece) + Magic resistance rings (3–7).

**Worked example.** Iron B sword (18) + ruby C (8%) vs an elite (defense 25) with Low magic resistance (0):
18 × 0.08 = **1.44** magic per hit on top of 18 × (1 − 0.25) = 13.5 physical = 14.94 total.

**Tuning notes.** Magic is "+X% damage that ignores defense", so it gains value as enemy defense rises.
Enemy Magical is the most dangerous attribute (Appendix B) because adventurer magic resistance is scarce.

### 10.6 Stun

| Number | Config path | Value |
|---|---|---|
| Enemy stun duration | `CONFIG.enemies.stunDuration` | 1.0 s |
| Resist cap | `CONFIG.combat.resistCap` | 75 |

**Formula.** Only on a landed hit by an attacker with stun chance:

```
stun chance = attacker.stunChance × (1 − min(defender.stunChanceRed, 75)/100)
stun length = attacker.stunDur   × (1 − min(defender.stunDurRed, 75)/100)
on a stun: the defender's attack bar stops filling until (hit time + stun length)
```

Stuns do not stack: a stun that lands while one is running only extends it to the later end time. A
fighter whose bar is already full when stunned waits until the stun ends and then attacks. So one stun
(not overlapping another) delays all of the defender's later attacks by the stun length.

- Adventurer stuns come only from a topaz sword (10–20% chance, 1–1.5 s). Enemy Stun resistance
  (`stunRes`) = 0 / 25 / 50 reduces both chance and length.
- Enemy Stunning (`stunning`) = 5 / 10 / 15% per hit, 1.0 s. Adventurer reduction = topaz armor (4–15
  per piece, both stats) + Stun resistance rings (5–10, counted for both chance and length).

**Worked examples.** Topaz S sword vs Normal Stun resistance (25): 20 × 0.75 = **15%** per hit,
1.5 × 0.75 = **1.125 s**, about half an enemy attack lost per stun. High Stunning enemy (15%) vs topaz S
chest (15) + Stun resistance ring S (10) = 25% reduction: **11.25%** per hit, **0.75 s**.

**Tuning notes.** A High-Stunning enemy that lands 80% of its hits costs the adventurer about
0.8 × 15% × 1.0 s = 0.12 s per enemy attack, about 6% of its attack time, which is why stun resistance
(armor or rings) is worth so little. Raise `stunDuration` or the Stunning values to make it matter.

### 10.7 Slow

| Number | Config path | Value |
|---|---|---|
| Enemy slow duration | `CONFIG.enemies.slowDuration` | 2.0 s |

**Formula.** Every landed hit from an attacker with slowPct > 0 applies a slow (no chance roll):

```
slow strength s = attacker.slowPct × (1 − min(defender.slowRed, 75)/100)
slow length     = attacker.slowDur × (1 − min(defender.slowDurRed, 75)/100)
while slowed, the defender's attack bar fills at 1 / (1 + s/100) of its normal rate
```

Slows do not stack: if the defender is still slowed, the strength becomes the larger of the two and the
slow ends at the later of the two end times; if it is not slowed, the new slow simply applies. One slow
(not overlapping another) pushes all of the defender's later attacks back by
`length × s / (100 + s)` seconds. A stun during a slow stops the bar completely; the slow's timer keeps
running.

- Adventurer slows come from a sapphire sword (10–30% for 1–3 s). Enemy Slow resistance (`slowRes`) =
  0 / 25 / 50.
- Enemy Chilling (`chilling`) = 10 / 20 / 30% for 2.0 s. Adventurer reduction = sapphire armor (both
  stats) + Slow resistance rings (both stats).

**Worked example.** High Chilling (30%) vs sapphire S chest (15) + Slow resistance ring A (8) = 23%:
strength 30 × 0.77 = **23.1%**, length 2 × 0.77 = **1.54 s**, delay 1.54 × 23.1 / 123.1 = **0.29 s** per
landed hit. Unresisted it is 2.0 × 30 / 130 = 0.46 s per landed hit.

**Tuning notes.** Enemy slows last 2.0 s and the enemy attacks about every 2.0 s, so an enemy that lands
most of its hits keeps the adventurer slowed nearly all the time: unresisted High Chilling is close to
−23% attack speed (1/1.3). That is why Chilling, sapphire armor and Slow resistance rings matter more than
their stun counterparts. Small slows are lumpy: they only change the result when they push an attack past
the moment a fighter would have died (in Appendix B's setup, a sapphire C sword against Normal or High
Slow resistance gives the same win rate). To soften Chilling, lower its values or `slowDuration`.

### 10.8 Attack interval and speed

| Number | Config path | Value |
|---|---|---|
| Adventurer interval | `CONFIG.adventurer.attackInterval` | 2.0 s |
| Enemy interval | `CONFIG.enemies.attackInterval` | 2.0 s |
| Enemy speed (Fast) | `CONFIG.enemies.attributes.fast.values` | −5 / 0 / +5 % |

**Formula** (`attackInterval`; the bar fill time):
`interval = baseInterval / (1 + speed/100) × (slowed ? 1 + slow/100 : 1)`, plus any time spent stunned.

**Worked examples.** Mythril S boots (13.5%) + Speed ring S (4%) = 17.5% → 2 / 1.175 = **1.70 s**.
Enemy Fast High: 2 / 1.05 = 1.905 s; Fast Low: 2 / 0.95 = 2.105 s.

**Tuning notes.** Speed is a multiplier on all damage dealt, so keep speed sources small. Speed rings are
among the best adventurer rings per point (Rings, section 13).

### 10.9 Fight order and ties

Both bars start empty, so each fighter's first attack comes after one full interval (not at time 0).
When both bars fill at the same moment, **the adventurer attacks first**; if that kills the enemy, the
enemy does not attack. After every attack the defender's HP is checked, so there are no double knock-outs.

**Tuning notes.** The tie rule gives the adventurer a small edge when both intervals are 2.0 s (no boots,
no speed rings, enemy Fast Normal).

### 10.10 Safety cap and draws

| Number | Config path | Value |
|---|---|---|
| Safety cap | `CONFIG.combat.safetyCapSeconds` | 36,000 s (10 hours of fight time) |

If no one has won when the next event would happen after 36,000 s, the fight is a **draw**: the adventurer
survives, gets no ring and no score; used gear still loses durability. The battle report and log say it
was called off. The win-chance estimate counts a draw as survival; the best-gear choice counts it as a
non-win. Both sides always deal some damage (defense is capped at 75% and hit chance never drops below
5%), so in practice fights end within a few minutes and draws do not occur.

---

## 11. Best-gear selection, win-chance simulation and matchup table

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
score = wins + (sum of HP fraction left in won fights) / (fights + 1)
tie → the loadout that removed more enemy HP in the fights it did not win; still tied → the first loadout listed
```

Wins always come first; HP left breaks ties; damage dealt breaks ties when every loadout loses. The random
seed is derived from the game seed and the day, so the choice is reproducible. Real battle cost: up to
32 × 200 = 6,400 quick fights (about 15 ms in Node).

**Win-chance estimate** (`estimateWinChance`, optional, the player clicks to run it). For each of 40
samples:
1. Guess the hidden attributes: known ones are kept; hidden ones are filled at random so that the tier's exact
   low/normal/high counts still hold (e.g. an elite with 1 known High has exactly 2 more Highs among its hidden
   attributes).
2. Pick the best packed loadout for that guess (30 fights per loadout).
3. Run 30 fresh fights with it.

Reported win % = (wins + draws) / (40 × 30 = 1,200 fights). Cost: up to 40 × (32 × 30 + 30) = 39,600
fights, about 0.1 s in Node with 32 loadouts; in the browser it runs in steps with a progress bar.

**Worked example.** At a true 50% the sampling error of 1,200 fights is about ±1.4 points (one standard
deviation), a bit more in practice because the 40 guesses are shared. In the bot runs the mean estimate
matched the actual win rate within about 1 point up to day 40 (Balance targets section).

**Tuning notes.** More `samples` = better coverage of hidden attributes (with enemy scouting at its 10%
base, about 11 of 12 attributes are guesses). More `fightsPerLoadout` = the simulated gear choice matches
the real one (which uses 200) more often. With only 30 fights per loadout the estimate is slightly
pessimistic when many loadouts are packed. These numbers only affect UI speed and accuracy, not
difficulty. The balance tool's bot estimates all 7 roster enemies every day, which is why a 24-seed bot
run takes about 80 s.

**Matchup table (plan screen, no simulation).** Under the adventurer preview the plan screen shows quick
numbers for the selected enemy, computed with the same formulas as the fight (`hitChance`, `hitDamage`,
`attackInterval` in `combat.js`). The preview uses the packed item with the highest material × grade
multiplier in each slot (ties: higher durability) plus the selected rings.

```
hit chance          = hitChance(your accuracy, enemy dodge)     and the reverse
damage per hit      = hitDamage(...).total (physical after defense and piercing + magic after resistance)
attacks every       = interval / (1 + speed/100)
expected damage/s   = hit chance × damage per hit / attacks every
rough time to win   = enemy HP / your expected damage per second
rough time to lose  = your HP / enemy expected damage per second
```

A hidden attribute is shown as a range over every level it could still have (respecting the tier's exact
low/normal/high counts); each row varies only the attributes that affect it, the others are taken as
Normal. Stuns, slows and the 90–110% damage roll are ignored, so use the win-chance estimate for the full
picture. Example: the Appendix C gear against a day-6 elite with nothing scouted shows hit chance
80.5–90.3% / 69.6–83.8%, damage per hit 14.5–14.9 / 9.5–12.0, attacks every 1.94 s / 1.90–2.11 s,
expected damage per second 6.03–6.97 / 3.15–5.27, HP 100 / 82.8–101.2, rough time to win 12–17 s and to
lose 19–32 s.

---

## 12. Enemies

### 12.1 Tiers and the daily roster

| Tier | Per roster | Base HP | Base damage | Defense | Low / Normal / High attributes | Score |
|---|---|---|---|---|---|---|
| Normal | 2 | 80 | 8 | 20 | 6 / 6 / 0 | 10 |
| Elite | 3 | 80 | 9 | 25 | 3 / 6 / 3 | 25 |
| Champion | 2 | 90 | 10 | 30 | 0 / 6 / 6 | 50 |

Config: `CONFIG.enemies.tiers.<tier>.{count, hp, damage, defense, levels, score}`. The level counts must
add up to 12 (the number of attributes). Base HP and damage are close on purpose: the tiers differ mostly
by their attribute levels and defense. Each morning a new roster of 7 is generated for the *next* day's
fight (the player picks one that evening). Names come from `CONFIG.enemies.names` (a duplicate within a
tier is re-rolled up to 10 times). Each enemy's ring reward is rolled when the roster is made.

### 12.2 Daily growth

| Number | Config path | Value |
|---|---|---|
| HP and damage growth | `CONFIG.enemies.growthPerDay.hpDamage` | 3 (%/day) |
| Accuracy and dodge growth | `CONFIG.enemies.growthPerDay.ratings` | 1 (%/day) |

**Formula** (`growth`, `enemyCombatant` in `js/core/enemies.js`; *day* = the day of the fight):

```
hpDamageMult = 1 + 3/100 × (day − 1)          ratingMult = 1 + 1/100 × (day − 1)
HP       = tier HP × hpDamageMult × (HP attribute %)/100
damage   = tier damage × hpDamageMult
accuracy = Accurate value × ratingMult        dodge = Evasion value × ratingMult
defense  = tier defense (no growth)
```

**Enemy numbers with the HP, Accurate and Evasion attributes at Normal:**

| Day | HP/damage × | Ratings × | Normal HP / dmg | Elite HP / dmg | Champion HP / dmg | Accuracy & dodge |
|---|---|---|---|---|---|---|
| 2 | 1.03 | 1.01 | 82.4 / 8.24 | 82.4 / 9.27 | 92.7 / 10.3 | 101 |
| 5 | 1.12 | 1.04 | 89.6 / 8.96 | 89.6 / 10.08 | 100.8 / 11.2 | 104 |
| 10 | 1.27 | 1.09 | 101.6 / 10.16 | 101.6 / 11.43 | 114.3 / 12.7 | 109 |
| 15 | 1.42 | 1.14 | 113.6 / 11.36 | 113.6 / 12.78 | 127.8 / 14.2 | 114 |
| 20 | 1.57 | 1.19 | 125.6 / 12.56 | 125.6 / 14.13 | 141.3 / 15.7 | 119 |
| 30 | 1.87 | 1.29 | 149.6 / 14.96 | 149.6 / 16.83 | 168.3 / 18.7 | 129 |
| 40 | 2.17 | 1.39 | 173.6 / 17.36 | 173.6 / 19.53 | 195.3 / 21.7 | 139 |
| 50 | 2.47 | 1.49 | 197.6 / 19.76 | 197.6 / 22.23 | 222.3 / 24.7 | 149 |
| 60 | 2.77 | 1.59 | 221.6 / 22.16 | 221.6 / 24.93 | 249.3 / 27.7 | 159 |
| 80 | 3.37 | 1.79 | 269.6 / 26.96 | 269.6 / 30.33 | 303.3 / 33.7 | 179 |

Growth is linear: HP and damage double by about day 35 and triple by day 68. Because both HP and damage
grow, the enemy's "threat" (HP × damage) grows with the square: ×4 by day 35. A normal-tier enemy has 6
Low attributes, so a typical normal is weaker than its row suggests (HP Low = 90%, Accurate Low = 80, ...).

**Worked example.** Elite "Ogre" on day 6 with HP Normal, Accurate Normal, Evasion High:
×1.15 / ×1.05 → HP 80 × 1.15 = **92**, damage 9 × 1.15 = **10.35**, accuracy 100 × 1.05 = **105**,
dodge 120 × 1.05 = **126**, defense 25.

**Tuning notes.** `hpDamage` is the single most important difficulty number: it sets how many days each
gear tier stays good (`--set enemies.growthPerDay.hpDamage=4` costs every tier 5–10 days of safety).
`ratings` keeps hit chances from saturating as the adventurer's accuracy grows.

### 12.3 Attributes

Each enemy has 12 attributes, each Low / Normal / High (`CONFIG.enemies.attributes.<key>.values`), shown in
pairs (offense left, defense right). Levels are dealt from the tier's exact counts at random, with no
correlation between attributes.

| Pair | Offense: Low / Normal / High | Defense: Low / Normal / High |
|---|---|---|
| Piercing / Pierce resistance | 5 / 15 / 25 % of your defense ignored | 0 / 20 / 40 % of your piercing ignored |
| Magical / Magic resistance | 10 / 20 / 30 % of its damage as extra magic | 0 / 15 / 30 % magic damage reduction |
| Stunning / Stun resistance | 5 / 10 / 15 % stun chance per hit (1.0 s) | 0 / 25 / 50 % less stun chance and length |
| Accurate / Evasion | 80 / 100 / 120 accuracy (× daily growth) | 80 / 100 / 120 dodge (× daily growth) |
| Chilling / Slow resistance | 10 / 20 / 30 % slower attack bar for 2.0 s on hit | 0 / 25 / 50 % weaker and shorter slows |
| Fast / HP | −5 / 0 / +5 % attack speed | 90 / 100 / 110 % of base HP |

**Visibility (intel).** Each attribute gets a hidden roll of 0–100 when the roster is made. It is visible
if `roll < enemySight chance` (base 10%). The ring reward's type and grade have their own rolls and
chances (base 25% each). Because the rolls are stored, spending intel reveals more of the *current*
roster immediately. Once the fight starts, every attribute is known.

**Worked example.** At the 10% base an enemy shows on average 1.2 of its 12 attributes; at 29% (2 intel
points) 3.5; at 44% (4 points) 5.3.

**Tuning notes.** Appendix B shows how much each attribute swings a fight. Magical, HP and Accurate are
the biggest; Fast, Chilling and Evasion next; Stunning and Piercing are mild. The defensive attributes
only matter against the matching adventurer gem or ring. To make an attribute matter more, widen its
Low/High spread.

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
time and apply at once. Adventurer rings are chosen in the nightly plan (max 10); wearing or removing an
adventurer ring on the Rings tab only changes the default selection for tonight's plan, never today's fight.

| Ring | Owner | D / C / B / A / S | Effect (where it goes in the formulas) |
|---|---|---|---|
| Travel | smith | 5 / 6 / 7 / 8 / 10 | % less travel time (all trips) |
| Quick search | smith | 5 / 6 / 7 / 8 / 10 | % less search time |
| Thorough search | smith | 10 / 12 / 14 / 16 / 20 | % more searched per search (multiplies the 50%) |
| Ore sight | smith | 3 / 4 / 5 / 6 / 7 | points added to the ore sight chance |
| Refining | smith | 5 / 6 / 7 / 8 / 10 | % less refining **and** cutting time |
| Bar luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on bars |
| Gem luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on gems |
| Piercing | adventurer | 3 / 4 / 5 / 6 / 7 | % of enemy defense ignored |
| Pierce resistance | adventurer | 5 / 6 / 7 / 8 / 10 | % of enemy piercing ignored |
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

**How strong is one ring right now?** Win-% change for a steel C full set against a typical elite on day
20 (base 46.2%; power report, ±1–2 points of noise):

| Ring | One B ring | One S ring |
|---|---|---|
| Health | +8.2 | +11.9 |
| Magic damage | +5.8 | +9.3 |
| Speed | +5.8 | +6.1 |
| Dodge | +4.5 | +6.2 |
| Slow resistance | +3.9 | +5.2 |
| Accuracy | +2.8 | +2.9 |
| Magic resistance | +1.5 | +2.2 |
| Piercing | +0.6 | +1.0 |
| Stun resistance | +0.3 | +1.1 |
| Pierce resistance | +0.4 | +0.3 |

All 10 adventurer ring types at grade B together: +31.4 points.

**Tuning notes.** `duplicateFactor` decides whether stacking one type is worthwhile (0.5 = a second copy
is worth half). Grade weights set how fast ring power grows with fight difficulty; champion fights are the
only source of S rings. Ring values are deliberately bigger than skill bonuses. In the bot runs rings are
the only system whose removal clearly hurts (`--ablate rings`: median life 44.5 instead of 50.5, 21% alive
at day 50 instead of 50%, mean score 513 instead of 640).
Pierce resistance and Stun resistance are near-dead picks (see 10.4 and 10.6).

---

## 14. Skills

| Number | Config path | Value |
|---|---|---|
| Max level | `CONFIG.skills.maxLevel` | 10 |
| XP curve base | `CONFIG.skills.xpBase` | 100 |
| XP per item (material skills) | `CONFIG.skills.xpPerItem` | copper 25, iron 25, steel 30, mythril 50; ruby 25, topaz 25, sapphire 30, emerald 40, diamond 50 |
| Activity skills | `CONFIG.skills.activity.<key>.perLevel` | see table |
| Material skills | `CONFIG.skills.perMaterial.<key>.perLevel` | grade 0.15, failure 0.3 |

**Formula** (`xpToNext`, `addXp`, `skillBonus`, `itemXp` in `js/core/skills.js`):

```
XP to go from level L to L+1 = xpBase × (L + 1)          bonus = perLevel × level
activity skills: XP = actual minutes spent (after time reductions)
material skills: XP = xpPerItem[material] per item refined/cut of that type (failures count);
                 both the grade and the failure skill of that material get the XP
```

`xpPerItem` may also be a single number for all materials. Several levels can be gained at once; XP stops
at level 10.

**Cumulative XP, and items needed per material:**

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Total XP (= minutes for activity skills) | 100 | 300 | 600 | 1,000 | 1,500 | 2,100 | 2,800 | 3,600 | 4,500 | 5,500 |
| Copper, iron, ruby, topaz (25 XP) | 4 | 12 | 24 | 40 | 60 | 84 | 112 | 144 | 180 | 220 |
| Steel, sapphire (30 XP) | 4 | 10 | 20 | 34 | 50 | 70 | 94 | 120 | 150 | 184 |
| Emerald (40 XP) | 3 | 8 | 15 | 25 | 38 | 53 | 70 | 90 | 113 | 138 |
| Mythril, diamond (50 XP) | 2 | 6 | 12 | 20 | 30 | 42 | 56 | 72 | 90 | 110 |

**Skills and bonuses:**

| Skill | Per level | At level 10 | XP from | Applies to |
|---|---|---|---|---|
| Return travel | 0.4 | 4% | minutes travelling to camp | travel time on trips ending at camp (adds to the Travel ring) |
| Search speed | 0.4 | 4% | minutes searching | search time (adds to Quick search ring) |
| Search efficiency | 0.8 | 8% | minutes searching | efficiency multiplier (adds to Thorough search ring) |
| Debris clearing | 0.5 | 5% | minutes clearing | debris time (no ring counterpart) |
| Refining speed | 0.4 | 4% | minutes refining | refining time (adds to Refining ring) |
| Cutting speed | 0.4 | 4% | minutes cutting | cutting time (adds to Refining ring) |
| Copper / Iron / Steel / Mythril bar grade (4 skills) | 0.15 | 1.5% | XP per bar of that type | upgrade luck for that bar (adds to Bar luck ring) |
| Copper / Iron / Steel / Mythril refining (4 skills) | 0.3 | 3 points | XP per bar of that type | failure → D for that bar |
| Ruby / Topaz / Sapphire / Emerald / Diamond grade (5 skills) | 0.15 | 1.5% | XP per gem of that type | upgrade luck for that gem (adds to Gem luck ring) |
| Ruby / … / Diamond cutting (5 skills) | 0.3 | 3 points | XP per gem of that type | failure → D for that gem |

A level-10 skill is a bit weaker than a D-grade ring of the same kind (Travel D 5%, Quick search D 5%,
Thorough search D 10%, Refining D 5%, Bar/Gem luck D 2%). Debris clearing and the failure skills have no
ring counterpart.

**Worked examples.** One 30-minute search gives 30 XP to both Search speed and Search efficiency; level 10
needs 188 searches (5,504 minutes ≈ 9.2 full days of nothing but searching; a few more than 5,500 / 30
because searches get faster as the skill grows and XP = minutes). Refining 60 mythril ore (failures count)
gives 3,000 XP: Mythril bar grade and Mythril refining reach level 7 = +1.05% upgrade luck and −2.1 failure
points.

**What the bot reaches** by the end of a run (about day 50, mean levels): activity skills 4–9 (search 8.8,
return travel 6.5, refining 7.3, cutting 6.7, debris 4.1) and material skills from 0.6 (topaz) to 5.3
(diamond), with steel, ruby and copper around 4.5.

**Tuning notes.** `xpBase` scales every skill's pace; `xpPerItem` sets the material skills' pace (rarer
materials give more XP per item because there are fewer of them). Per-level values are intentionally small.
In the bot runs skills make no measurable difference (`--ablate skills` is within noise of the full game).
If skills should feel rewarding, raise `perLevel`: making a level-10 skill equal to a B-grade ring needs
about 1.75× the current values for the time and search skills (Travel B 7% vs 4%, Thorough search B 14% vs
8%) and about 2.7× for the grade skills (Bar luck B 4% vs 1.5%).

---

## 15. Intel

| Number | Config path | Value |
|---|---|---|
| Days per point | `CONFIG.intel.daysPerPoint` | 5 (a point at the end of day 5, 10, 15, …) |
| Gain per point | `CONFIG.intel.gainsPerPoint` | 10, 9, 8, 7, 6, 5, 4, 3, 2 |
| Gain after that | `CONFIG.intel.minGain` | 1 |
| Maximum chance | `CONFIG.intel.maxChance` | 100 |
| Ore sight base | `CONFIG.intel.tracks.oreSight.base` | 10 |
| Enemy scouting base | `CONFIG.intel.tracks.enemySight.base` | 10 |
| Ring type scouting base | `CONFIG.intel.tracks.ringTypeSight.base` | 25 |
| Ring grade scouting base | `CONFIG.intel.tracks.ringGradeSight.base` | 25 |

**Formula** (`intelChanceFor` in `js/core/intel.js`):
`chance = min(100, base + sum of gains for points 1..n)`; the n-th point on a track gives `gainsPerPoint[n−1]`,
or 1 after the list runs out. Each track counts its own points.

**Cumulative chance by points spent on one track:**

| Points | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | to reach 100% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Base 10 tracks (ore sight, enemy scouting) | 10 | 20 | 29 | 37 | 44 | 50 | 55 | 59 | 62 | 64 | 65 | 67 | 45 points (day 225) |
| Base 25 tracks (ring type, ring grade) | 25 | 35 | 44 | 52 | 59 | 65 | 70 | 74 | 77 | 79 | 80 | 82 | 30 points (day 150) |

**Worked example.** By the end of day 20 the player has earned 4 points. All four on Enemy scouting:
10 → 44%, so about 5.3 of 12 attributes are visible on each enemy.

**Tuning notes.** `daysPerPoint` is the pace; the first few points are worth the most, which favors
spreading points over tracks. The bot puts every point into enemy scouting, and `--ablate intel` is within
noise, because the win-chance estimate already averages over the hidden attributes. Lower the scouting
bases to make planning riskier; raise them to make the roster easier to read.

---

## 16. Score

| Number | Config path | Value |
|---|---|---|
| Points per win | `CONFIG.enemies.tiers.<tier>.score` | normal 10, elite 25, champion 50 |

**Formula.** Score = sum of points for every enemy defeated. A draw gives 0. A loss ends the run. The best
score is kept in the browser (localStorage) across new games.

**Worked example.** 10 days of fights: 4 normal, 5 elite, 1 champion = 40 + 125 + 50 = **215**.

**Tuning notes.** Champion = 5 normals. Champions are a real risk of game over at every stage: the bot's
best estimate against a champion on its roster averages 55–71% between days 7 and 30 and never gets near
its 90% line, so the careful bot (almost) never takes one and scores 640 on average. Raising the champion
score pushes riskier play; `--minwin` and `--future` let the bot test that.

---

## Appendix A — Power curve snapshot

Win % of a loadout against a typical enemy of each tier (all attributes hidden, 100 attribute guesses ×
50 fights per cell; 200 guesses for the day-2 table). Generated with `node tools/balance.mjs --section power`
(deterministic: the same config always prints the same numbers).

**Day-2 fight with day-1 gear** (target: normal 85–95%, elite 40–65%, champion < 20%)

| Day-1 loadout | vs normal | vs elite | vs champion |
|---|---|---|---|
| Copper D sword | 65.5 | 9.6 | 0.0 |
| Copper C sword | 80.1 | 18.5 | 0.1 |
| Copper C sword + C boots | 91.0 | 33.1 | 0.4 |
| Copper C sword + C chest | 85.6 | 23.4 | 0.2 |
| **Copper C sword + C chest + C boots** (reference) | 92.8 | 37.4 | 0.6 |
| Copper D sword + D helmet + D gloves | 75.6 | 15.4 | 0.1 |
| Copper B sword + B chest + B boots | 98.0 | 50.2 | 1.6 |
| Copper C sword + ruby C + C boots | 96.3 | 43.3 | 1.2 |
| Copper C full set (lucky day 1) | 97.7 | 52.9 | 1.2 |
| Iron C sword + copper C boots | 99.8 | 87.7 | 18.8 |

**vs Normal** (base HP 80, damage 8, defense 20%)

| Loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Unarmed | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper D sword only | 65.2 | 34.6 | 4.8 | 0.6 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper D full | 92.9 | 70.8 | 23.4 | 3.9 | 0.3 | 0 | 0 | 0 | 0 | 0 |
| Copper B full | 99.4 | 93.7 | 63.9 | 22.5 | 4.0 | 0 | 0 | 0 | 0 | 0 |
| Iron C full | 100 | 99.9 | 98.6 | 85.5 | 49.0 | 3.5 | 0.2 | 0 | 0 | 0 |
| Steel C full | 100 | 100 | 100 | 99.7 | 95.0 | 53.3 | 11.0 | 0.6 | 0 | 0 |
| Mythril C full | 100 | 100 | 100 | 100 | 100 | 99.7 | 91.7 | 61.3 | 16.9 | 0.4 |
| Mythril S full | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 99.7 | 93.3 | 45.8 |
| Iron C + ruby C sword | 100 | 100 | 98.9 | 91.6 | 66.0 | 7.3 | 0.4 | 0 | 0 | 0 |
| Iron C + diamond C sword + emerald C armor | 100 | 100 | 99.4 | 93.6 | 75.0 | 17.5 | 1.1 | 0.1 | 0 | 0 |
| Steel C + ruby C sword + 10 C rings | 100 | 100 | 100 | 100 | 99.7 | 87.7 | 38.3 | 7.6 | 0.6 | 0 |
| Mythril C + ruby B sword + 10 B rings | 100 | 100 | 100 | 100 | 100 | 100 | 99.3 | 92.6 | 62.8 | 8.1 |
| Ceiling: Mythril S + ruby S + emerald S armor + 10 S rings | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 96.6 |

**vs Elite** (base HP 80, damage 9, defense 25%)

| Loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Copper D sword only | 10.4 | 2.4 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper D full | 33.0 | 13.3 | 1.0 | 0.1 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper B full | 68.4 | 41.1 | 7.5 | 0.7 | 0 | 0 | 0 | 0 | 0 | 0 |
| Iron C full | 98.4 | 90.7 | 55.7 | 19.0 | 5.5 | 0.1 | 0 | 0 | 0 | 0 |
| Steel C full | 100 | 99.9 | 96.1 | 79.8 | 51.1 | 5.3 | 0.3 | 0 | 0 | 0 |
| Mythril C full | 100 | 100 | 100 | 100 | 99.2 | 79.7 | 36.3 | 6.0 | 1.0 | 0 |
| Mythril S full | 100 | 100 | 100 | 100 | 100 | 99.9 | 95.9 | 74.5 | 40.4 | 2.5 |
| Iron C + ruby C sword | 99.2 | 95.3 | 70.5 | 31.4 | 9.2 | 0.3 | 0 | 0 | 0 | 0 |
| Iron C + diamond C sword + emerald C armor | 99.8 | 97.8 | 82.2 | 49.1 | 20.0 | 1.1 | 0 | 0 | 0 | 0 |
| Steel C + ruby C sword + 10 C rings | 100 | 100 | 99.7 | 96.8 | 84.1 | 25.3 | 3.4 | 0.1 | 0 | 0 |
| Mythril C + ruby B sword + 10 B rings | 100 | 100 | 100 | 100 | 100 | 98.0 | 80.7 | 37.0 | 10.7 | 0.3 |
| Ceiling | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 99.3 | 94.8 | 53.6 |

**vs Champion** (base HP 90, damage 10, defense 30%)

| Loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Copper D full | 0.2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper B full | 3.5 | 0.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Iron C full | 47.9 | 20.4 | 2.6 | 0.2 | 0 | 0 | 0 | 0 | 0 | 0 |
| Steel C full | 95.5 | 78.1 | 35.6 | 8.4 | 1.4 | 0.1 | 0 | 0 | 0 | 0 |
| Mythril C full | 100 | 99.9 | 98.8 | 88.4 | 60.9 | 9.0 | 0.6 | 0 | 0 | 0 |
| Mythril S full | 100 | 100 | 100 | 99.9 | 99.1 | 83.9 | 36.0 | 8.3 | 0.7 | 0 |
| Iron C + ruby C sword | 58.1 | 31.2 | 5.1 | 0.5 | 0.1 | 0 | 0 | 0 | 0 | 0 |
| Iron C + diamond C sword + emerald C armor | 74.8 | 48.5 | 13.2 | 2.1 | 0.3 | 0 | 0 | 0 | 0 | 0 |
| Steel C + ruby C sword + 10 C rings | 99.6 | 96.6 | 76.2 | 38.0 | 14.2 | 0.6 | 0 | 0 | 0 | 0 |
| Mythril C + ruby B sword + 10 B rings | 100 | 100 | 99.9 | 99.0 | 94.9 | 51.2 | 10.2 | 1.1 | 0 | 0 |
| Ceiling | 100 | 100 | 100 | 100 | 100 | 99.8 | 95.6 | 74.8 | 40.0 | 4.0 |

**Weakest plain full set (no gems, no rings) that keeps a target win rate**

| Day | Normal ≥ 90% | Elite ≥ 70% | Champion ≥ 50% |
|---|---|---|---|
| 2 | copper D (91%) | iron D (94%) | iron B (62%) |
| 3 | copper B (98%) | iron D (92%) | iron B (56%) |
| 5 | copper B (93%) | iron D (79%) | iron A (55%) |
| 7 | iron D (99%) | iron C (85%) | steel C (65%) |
| 10 | iron D (94%) | iron B (73%) | steel B (59%) |
| 12 | iron C (95%) | iron A (72%) | steel A (60%) |
| 15 | iron B (93%) | steel C (81%) | mythril D (72%) |
| 20 | steel C (95%) | steel A (79%) | mythril C (61%) |
| 25 | steel B (90%) | mythril D (83%) | mythril B (50%) |
| 30 | mythril D (98%) | mythril C (80%) | mythril S (83%) |
| 40 | mythril C (93%) | mythril A (77%) | none (mythril S 36%) |
| 50 | mythril A (93%) | mythril S (76%) | none (mythril S 8%) |
| 60 | mythril S (94%) | none (mythril S 39%) | none (mythril S 1%) |
| 70 | none (mythril S 73%) | none (mythril S 15%) | none (mythril S 0%) |
| 80 | none (mythril S 43%) | none (mythril S 3%) | none (mythril S 0%) |

Reading it: the elite column follows the progression target (iron from day 2–12, steel day 15–20,
mythril day 25+). Gems (especially a ruby, diamond or sapphire sword) and rings add a lot on top
(sections 7 and 13).

## Appendix B — How much each enemy attribute matters

Steel C full set (no gems, no rings) vs an elite on day 20. All attributes Normal except the one listed
(20,000 fights each). Baseline (all Normal): **45.3%** win.

| Attribute | Low | Normal | High | Low − High |
|---|---|---|---|---|
| Magical | 65.7% | 45.3% | 28.7% | 37.0 |
| HP | 63.8% | 45.3% | 27.2% | 36.6 |
| Accurate | 64.9% | 45.3% | 30.9% | 34.0 |
| Fast | 52.6% | 45.3% | 32.7% | 20.0 |
| Chilling | 52.6% | 45.3% | 35.6% | 17.0 |
| Evasion | 52.6% | 45.3% | 36.2% | 16.4 |
| Stunning | 48.4% | 45.3% | 41.9% | 6.5 |
| Piercing | 47.0% | 45.3% | 44.8% | 2.2 |
| Pierce res., Magic res., Stun res., Slow res. | 45.3% | 45.3% | 45.3% | 0 (no matching gear) |

Defensive attributes against a matching C sword gem (same set, same day):

| Sword gem | vs attribute | Low | Normal | High |
|---|---|---|---|---|
| Diamond C | Pierce resistance | 60.6% | 53.2% | 47.8% |
| Ruby C | Magic resistance | 62.6% | 57.6% | 51.2% |
| Emerald C | Evasion | 58.0% | 51.5% | 45.2% |
| Sapphire C | Slow resistance | 62.6% | 50.6% | 50.6% |
| Topaz C | Stun resistance | 51.7% | 48.5% | 46.8% |

## Appendix C — Worked fight, start to finish

Adventurer: iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots
(damage 18, accuracy 128, dodge 111, defense 18.9, speed 3.3%, magic 8%, HP 100).
Enemy: elite Ogre, day 6; Piercing High, Pierce res Normal, Magical Normal, Magic res Low, Stunning Low,
Stun res Normal, Accurate Normal, Evasion High, Chilling Low, Slow res Normal, Fast Normal, HP Normal
(HP 92, damage 10.35, accuracy 105, dodge 126, defense 25).

| Step | Adventurer → Ogre | Ogre → Adventurer |
|---|---|---|
| Hit chance | 128² / (128² + 0.25 × 126²) = 80.5% | 105² / (105² + 0.25 × 111²) = 78.2% |
| Piercing | none | 25 × (1 − 0) = 25% |
| Effective defense | 25% | 18.9 × 0.75 = 14.175% |
| Physical per hit | 18 × 0.75 = 13.5 | 10.35 × 0.858 = 8.88 |
| Magic per hit | 18 × 8% × (1 − 0) = 1.44 | 10.35 × 20% × (1 − 0) = 2.07 |
| Total per hit (before the 90–110% roll) | 14.94 | 10.95 |
| Attack every | 2 / 1.033 = 1.94 s | 2.0 s |
| Expected damage per second | 0.805 × 14.94 / 1.94 = 6.21 | 0.782 × 10.95 / 2 = 4.28 |
| Time to win | 92 / 6.21 ≈ 14.8 s | 100 / 4.28 ≈ 23.4 s |
| Side effects | none | 5% stun chance per hit (1.0 s); every hit slows the adventurer 10% for 2.0 s (≈ 0.18 s delay each) |

Simulated with the attributes known: **92.7%** win (50,000 fights on each of three seeds: 92.5–92.9%),
average fight about 17.7 s.
