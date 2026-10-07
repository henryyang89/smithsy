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
  supply numbers, `--section bot --seeds 40` for the bot results). Appendix B and C come from direct
  `fight()` simulations (20,000–50,000 fights each). Rerun the tool after any change; see
  [Balance targets and current results](#balance-targets-and-current-results). All numbers here match the
  config of **version 1.1** (commits e8886d2 and 247909d: field piles with a carry choice when leaving a
  field, debris cleared by searching (thickness 20–60), one boulder per field, gem cutting from a novice
  to a master table, equal gem odds, grades listed lowest to highest). Combat, enemies, gear and rings are
  unchanged since 1.0 (commit 1e53a91: all enemy tiers share base HP 80, damage 8 and defense 20%).
- **Grade order.** Like the game, outcome tables list grades from lowest to highest, left to right:
  Fail, D, C, B, A, S.

---

## Quick levers

These are the knobs with the biggest effect on difficulty and pacing, roughly in order of impact.

| Lever | Config path | Now | Raise it | Lower it |
|---|---|---|---|---|
| Enemy HP and damage growth per day | `CONFIG.enemies.growthPerDay.hpDamage` | 3 (+3%/day, linear) | Late game gets hard sooner, runs get shorter | Longer runs, gear stays useful longer |
| Enemy accuracy/dodge growth per day | `CONFIG.enemies.growthPerDay.ratings` | 1 (+1%/day) | Enemies hit you more and dodge more late on | Accuracy/dodge gear keeps its value longer |
| Enemy tier base stats | `CONFIG.enemies.tiers.<tier>.hp / damage / defense` | 80 / 8 / 20 for every tier (user decision: champions are no tougher than elites or normals in base stats) | Every fight harder from day 2 | Easier start |
| Enemy attribute spread | `CONFIG.enemies.attributes.<key>.values` | see 12.3 | Low/High further apart: tiers differ more (attribute levels are now the only difference between them), scouting matters more | Tiers closer together |
| Material power | `CONFIG.gear.materialMult` | copper 1, iron 1.5, steel 2, mythril 3 | Bigger jump per material tier | Flatter curve, grades matter more |
| Grade power | `CONFIG.gear.gradeMult` | D 1.0 … S 1.5 | Lucky refines matter more | Material matters more than luck |
| Refining luck | `CONFIG.refine.<bar>.dist` | F 10, D 30–45 | More weight on D/F: slower gear progress | More weight on S/A/B: faster gear progress |
| Gem cutting | `CONFIG.cut.<gem>.novice / master`, `CONFIG.skills.perMaterial.gemGrade.perLevel` | novice F 15 / D 45 / C 25 / B 10 / A 4 / S 1 → master F 10 / D 20 / C 25 / B 22 / A 15 / S 8; 10% of the way per grade-skill level | More weight on B–S: better gems (sooner, with a higher perLevel) | Gems weaker, practice matters more |
| Mythril supply | `CONFIG.field.oreWeights` (mythril column) | 0 / 0 / 0 / 5 by distance (only distance 4+; about 13–14 per map) | Mythril gear arrives earlier and the finite map holds more | Mythril stays rare |
| Coal supply (steel) | `CONFIG.field.oreWeights` (coal column) | 0 / 5 / 15 / 20 (about 122 per map) | Steel arrives earlier and lasts longer | Steel later |
| Field richness | `CONFIG.field.lootChance`, `CONFIG.field.itemCountWeights` | 50% +5/step, max 80%; 1/2/3 items weighted 30/40/30 (avg 2.0) | More ore per search and a bigger map (about 1,540 items now) | Scarcer, more travel, the map runs out sooner |
| Field regrowth | `CONFIG.field.regrowPctPerDay` | 0 (off: fields do not regrow) | Searched cells refill (5 = about 77 items a night on a fully searched map), so the map no longer caps a run | Already off: the map is a finite supply |
| Search speed | `CONFIG.field.searchEfficiency`, `CONFIG.field.searchRandomness`, `CONFIG.field.searchMin` | 35% ± 5 per cell per search (about 3 searches per cell), 30 min | Faster gathering, efficiency bonuses matter less | Slower gathering |
| Debris and boulders | `CONFIG.field.debrisChance`, `CONFIG.field.debrisAmount`, `CONFIG.field.boulders` | 15% of cells, 20–60 thick (search effort); 1 boulder per field | More search effort goes into clearing (about 5% now), fewer searchable cells | Faster gathering |
| Processing times | `CONFIG.refine.<bar>.minutes`, `CONFIG.cut.<gem>.minutes` | 15 / 20 / 25 / 30, gems 20 | Less of the day left for mining | More gear per day |
| Travel cost | `CONFIG.map.travelMinPerStep` | 20 min/step | Far (rich) fields cost more of the day | Far fields become the default |
| Bag size | `CONFIG.bag.slots` | 20 (carried per trip; finds wait in the field's pile) | Fewer trips home | More trips home (nothing is lost: the rest waits in the pile), far fields less attractive |
| Adventurer HP | `CONFIG.adventurer.hp` | 100 | Survives longer in every fight | Fights get swingier |
| Hit-chance curve | `CONFIG.combat.hitK` | 0.25 | Everyone misses more; accuracy gear matters more | Hits land more; dodge matters less |
| Gear wear | `CONFIG.gear.durabilityLoss` | 3–7% per fight | More repair work, more bars spent | Gear lasts longer |
| Repair cost | `CONFIG.gear.repair.materialFraction` | 35% of the bars | Repairs eat into bar supply | Repair is almost free |
| Ring quality | `CONFIG.rings.gradeWeights` | see Rings | Shift weight to higher grades: faster ring power growth | Shift weight down: slower |
| Intel pace | `CONFIG.intel.daysPerPoint` | 5 days per point | Slower intel, more hidden attributes, more risk | Faster intel, fewer surprises |
| Starting scouting | `CONFIG.intel.tracks.enemySight.base` | 10% | Fewer surprises in fights | More hidden attributes, more risk |
| Day length | `CONFIG.time.dayStartMin / dayEndMin` | 8:00–18:00 (600 min) | Longer day: more work per fight, easier | Shorter day: harder |
| Skill strength | `CONFIG.skills.activity.<key>.perLevel`, `CONFIG.skills.perMaterial.<key>.perLevel` | 0.6 / 1.2 per level (time / search efficiency; level 10 = a C-grade ring); bar grade 0.3, fail 0.5; debris clearing +10% power per level; gem grade 10% of the novice → master blend per level | Skills outgrow rings | Skills become a small extra |
| Champion reward | `CONFIG.enemies.tiers.champion.score` | 50 (normal 10, elite 25) | Champions even more attractive (the careful bot already takes one on about 70% of days 11–30) | Fewer champion picks; safe play dominates |

**What the current numbers produce (details in the next section and Appendix A):** all three enemy tiers
share the same base HP, damage and defense (80 / 8 / 20%), so they differ only by attribute levels, score
and ring grades. A copper C sword + chest + boots made on day 1 wins about 93% of day-2 normal fights, 63%
of elite fights and 22% of champion fights. A full iron C set stays at 90%+ against normals until about
day 10; steel C until day 20, mythril C until day 40, mythril S until day 60. Against elites the 70% line
falls at the same checkpoint for iron C and steel C (day 10 and day 20) and about 10 days earlier for
mythril (C day 30, S day 50). Enemy growth is linear and never stops while gear tops out at mythril S, so
every run ends eventually. That is intended (endless, score-chasing). The scripted "careful" bot lives a
median of 53 days and fights a champion on most mid-game days (about 70% of days 11–30), for a mean score
of about 1,200 (1,192 on the 40 standard seeds; 1,164 on 120 seeds, 3% under 1.0). Fields do not regrow, so
the map (about 1,540 items, only about 13–14 of them mythril) is the whole supply of a run: the bot has found
82% of it by day 40 (almost all the mythril) and 92% by day 50. Since 1.1 mines about 5–10% more
efficiently (debris is cleared by searching, finds wait in field piles), coal and mythril run low around
day 45–50, about 4–5 days sooner than in 1.0; after that even a perfect player cannot improve gear and
hits the enemy-growth wall around day 55–70 (see "Map supply" below).

---

## Balance targets and current results

### What the tuning aimed for

The targets are written into `tools/balance.mjs` and the tool flags results outside them, except the
win rates with on-pace gear, which are checked by reading the power tables:

| Target | Where the tool checks it | Aim | Now |
|---|---|---|---|
| Win rates with on-pace gear (the user's target, session 4) | `power` section 2: plain C sets late in their material window (iron C day 10, steel C day 20, mythril C day 40) | champion ~30–40%, elite ~60–70%, normal 90%+; erring on the high side (the user wanted higher win rates) | champion 48 / 32 / 21%, elite 83 / 74 / 63%, normal 99 / 95 / 92%; earlier in each window higher (steel C on day 15: 71 / 94 / 100%). On target or above, except mythril C on day 40 vs champions; the bot's real gear (gems, rings) is far above it (see "Champions" below). Unchanged in 1.1 (combat, enemies and gear did not change) |
| Day-2 fight with sensible day-1 gear (a few copper pieces) | `power` section 1 (`DAY2_TARGET`), bot "d2 typical est" | normal 85–98%, elite 50–75%, champion 15–40% (session-4 bands, slightly below the on-pace targets because day-1 gear trails the pace) | reference set 93 / 63 / 22 (inside all three); bot's own day-1 gear 94 / 69 / 33 |
| Material progression (first pieces / 3 of 5 slots) | bot "Progression milestones" (`PROGRESS_TARGET`) | iron day 5–8, steel day 12–18, mythril day 25+ | iron 3 / 6, steel 9 / 11, mythril 16 / 22 (first pieces before the window; mythril in 3 of 5 slots 3 days early, 23 in the 120-seed check, was 26 in 1.0) |
| Weakest plain set that holds a safe win rate | `power` section 3 | the elite ≥ 70% column should follow the progression above | copper B day 2–3, iron day 5–15, steel day 20–25, mythril day 30+: about 5 days behind the progression, so on-pace gear beats elites with room to spare |
| Run length for a careful player | bot "median life" | around 50 days, with most deaths from day 40 on (the endless ramp, not early bad luck) | median 53.0; 31 of 40 deaths on day 41 or later (on target; 9 runs die before day 40, 5 of them on day 2) |
| Every system worth using | `--ablate` runs | removing a system should cost survival or score | rings, gems, repair and skills clearly; intel within noise (see ablations below) |

There is no target yet for how long the finite map lasts (fields do not regrow); see "Map supply" below.

**All three tiers have the same base HP, damage and defense** (80 / 8 / 20%; user decision in session 4,
commit 1e53a91: "Champions shouldn't have higher HP, damage, or defense than the elites or normals. The
win rate is too low." Elites were 80 / 9 / 25 and champions 90 / 10 / 30). Difficulty comes only from
the attribute mix (normal: 6 Low + 6 Normal; elite: 3 Low + 6 Normal + 3 High; champion: 6 Normal + 6
High). With the same day-2 reference gear, elite wins rose from 37% to 63% and champion wins from 1% to
22%.

**Champions are the careful bot's main mid-game pick.** The bot takes the enemy with the best
`win% × (points + 1000)` among those estimated at 90%+, so a 50-point champion beats a 10-point normal once
its estimate is within about 4% of the normal's. With gems, rings and the better of the roster's two
champions, its best champion estimate is 95–99% on days 7–30 (table below), so it fights a champion on 30%
of days 6–10 and about 70% of days 11–30, wins 14.0 champions per run and scores 1,192 on average; the
champions' B–S rings feed back into its power. It costs a little safety: 0.3–0.6% of fights are lost on
days 11–40. If champions should be a rarer, riskier pick for a careful player, the levers are the
champion's score (section 16), its ring grades (`CONFIG.rings.gradeWeights.champion`, section 13) or the
High attribute values (section 12.3), not the base stats, which the user wants equal across tiers.

### What changed from 1.0 to 1.1

Version 1.1 changed the economy only (field piles and carrying, debris cleared by searching, boulders,
gem cutting from novice to master, equal gem odds). The power section prints exactly the same numbers as
in 1.0. To compare the bot, both versions were run on the same 120 seeds (`--section bot --seeds 120`,
1.0 from commit 985b656), because 40 runs are too noisy for a difference this small:

| 120 runs, same seeds | 1.0 | 1.1 | Reading |
|---|---|---|---|
| Median life | 53.0 | 52.0 | survival the same within noise |
| Alive day 40 / 50 / 60 | 73 / 58 / 11% | 76 / 56 / 13% | |
| Mean score | 1,204 | 1,164 (−3.3%) | slightly lower: weaker gems early (novice table), a few fewer champion fights (61–63% of days 11–30 instead of 64–70%) |
| Champion wins per run | 14.3 | 12.9 | |
| Gems cut per run: Fail / D / C or better | — | 13 / 34 / 52% | 1.0's fixed table: 10 / 30 / 60% before skills |
| Mythril in 3 of 5 slots (median day) | 26 | 23 | mythril a little earlier |
| Mining share of used time | 65% | 60% | |
| Mining minutes per found item, days 1–40 | 12.5–14.6 | 11.6–12.8 | mining about 5–10% more efficient (no clear action; finds beyond a full bag wait in the pile for the next trip; economy report: field minutes per copper / iron / steel unit −8–9%, items brought home per day of repeat trips +9–12% at distance 1–4) |
| Map found by day 40 / 50 | 73% / 89% | 81% / 92% | the map runs out about 4–5 days sooner |
| Idle minutes a day at day 60 | 103 | 253 | |

The 40-seed run below has five deaths on day 2 (one in 1.0's 40 seeds), so its mean score (1,192) is 10%
under 1.0's 40-seed result (1,323); over 120 seeds the gap is 3%. With `--immortal` (40 runs) the map runs
dry about 5 days sooner: 82% found by day 40 (1.0: 74%), finds fall to 15 a day on days 41–50 (1.0: 25)
and 1.6 on days 51–60 (1.0: 3.4); the gear the immortal bot ends with is the same (mythril B sword, 3.3 of
5 slots mythril).

### Current results (version 1.1)

**Economy** (`node tools/balance.mjs --section economy`, about 10 s):

```
ECONOMY SUMMARY | items/search by dist d1:1.89 d2:2.10 d3:2.27 d4:2.41 d5+:2.60 | debris % of effort d1:5 d2:5 d3:5 d4:5
d5+:5 | one trip d1/d3: 244/302 min for 20.0/20.0 items (found 21.9/22.1, pile left 1.9/2.1) | field min per unit: copper 23,
iron 53, steel pair 129, mythril 525, any gem 42 | full set >=D work days: copper 1.1, iron 1.9, steel 3.7, mythril 12.7 |
gem cut skill 0: F 15% C+ 40% effect 0.77 of C | map items/run 1541 (mythril 12.4, coal 120) | regrow off
```

The items/search figure now covers whole fields, debris cells included. 1.0's summary line (1.78 / 1.88 /
2.13 / 2.30 / 2.45) counted only debris-free cells and left the clearing minutes out, so the two summary
lines are not directly comparable: counting 1.0's clearing minutes as searches, 1.0 found 1.82 / 1.95 /
2.16 / 2.32 / 2.57 items per 30 minutes of field work, so 1.1 finds 1–8% more, because debris is cleared
by search effort (about 5% of it) instead of a 15-minute action per cell. Trips gain more: what a trip's
last search finds beyond a full bag waits in the pile and is carried next time, so one trip from 8:00
finds about 22 items and carries 20 home, and repeat trips bring home 9–12% more items a day at distance
1–4 (for example 42 instead of 38 at distance 2). Field minutes per unit fell from 25 / 58 / 142 (copper /
iron / steel pair) to 23 / 53 / 129, and per gem from 49 to 42 (every gem type is equally common now).
Mythril (525 min per ore) is unchanged within noise. The map holds 1,541 items on these 100 maps (1.0:
1,557; the 20 boulders hold nothing). A novice cuts gems at 15% failure and 40% C-or-better, worth 0.77 of
a C gem per cut on average (section 5).

**Power curve** (`node tools/balance.mjs --section power`, about 5 s; identical to 1.0):

```
POWER SUMMARY | day-2 ref (Copper C sword + C chest + C boots) n/e/c 93/63/22% | Cu D sword n/e/c 66/26/4% |
last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d2, Iron C d10, Steel C d20, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80 100/97%
```

The day-2 reference set wins 63% against elites and 22% against champions; the bot's own day-1 gear
(usually a gem in the sword) reaches 69% and 33%. Plain sets on pace with the progression target:

| Plain full set, day | vs normal | vs elite | vs champion |
|---|---|---|---|
| iron C, day 5 | 99.9 | 98.2 | 86.2 |
| iron C, day 10 | 98.6 | 83.4 | 47.9 |
| steel C, day 15 | 99.7 | 93.5 | 70.7 |
| steel C, day 20 | 95.0 | 73.9 | 32.1 |
| mythril C, day 30 | 99.7 | 93.6 | 71.5 |
| mythril C, day 40 | 91.7 | 63.2 | 20.6 |
| mythril S, day 50 | 99.7 | 90.0 | 58.6 |

**Careful bot** (`node tools/balance.mjs --section bot --seeds 40`, about 2–3 minutes). The bot gathers
(in a field it searches until what is worth carrying fills the bag, then carries the most valuable items
of bag + pile by its own values and leaves the rest in the pile), refines, cuts, smiths, repairs at night
(free of time), wears rings, spends intel and picks the fight with the best `win% × (points + 1000)` among
enemies estimated at 90%+ win (a champion needs about 96% of the best normal's estimate; it clears that on
most mid-game days):

```
BOT SUMMARY | alive d10:88% d20:85% d30:83% d40:78% d50:63% d60:3% d80:0% | median life 53.0 | score 1192 |
d2 typical est n/e/c 94/69/33 | first iron/steel/myth piece d3/9/16 | 3-slot iron/steel/myth d6/11/22 |
d11-30 fights n/e/c 2/29/69% | mining 60% trips/day 1.3 idle 32m | repair 1.4% bars 0.0% time, 4.8 night/run
(1.0 subst.) | map found d40:82% d60:93% d80:-% | field: 3.40 found/search, carried 51% of found (10.2/trip, 56
from old piles), piles at end 591 (2.7 worth), debris 3.9% of effort | gems cut 310.0/run F/D/C+ 13/34/53%, 29.6 infused
```

| Survival (end of day) | 2 | 5 | 10 | 15 | 20 | 30 | 40 | 50 | 60 | 70 | 80 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| % of runs alive | 88 | 88 | 88 | 85 | 85 | 83 | 78 | 63 | 3 | 0 | 0 |

Death days (40 runs): 2, 2, 2, 2, 2, 14, 24, 31, 33, 43, 43, 47, 50, 50, 50, 51, 51, 51, 52, 53, 53, 54, 54,
54, 55, 55, 55, 56, 56, 56, 57, 57, 58, 59, 59, 59, 59, 59, 60, 66.
Score: mean 1,192, median 1,328, max 1,840. Wins per run: 15.3 normal, 13.6 elite, 14.0 champion.
(The five day-2 deaths came at estimates of 88–97%; over 120 seeds 7% of runs die by day 2, as in 1.0.)

| Progression (median day, runs that got there) | first piece | sword | 3 of 5 slots | all 5 slots | target |
|---|---|---|---|---|---|
| iron or better | 3 (37/40 runs) | 4 (36/40) | 6 (35/40) | 9 (35/40) | 5–8 |
| steel or better | 9 (35/40) | 9 (35/40) | 11 (35/40) | 16 (34/40) | 12–18 |
| mythril | 16 (34/40) | 17 (34/40) | 22 (25/40) | 30 (7/40) | 25+ |

| Days | Fights: normal / elite / champion % | Mean est. win % | Actual win % | Losses per fight % | "No safe option" fights |
|---|---|---|---|---|---|
| 2–5 | 63 / 30 / 6 | 98.0 | 96.6 | 3.4 | 7 of 145 |
| 6–10 | 10 / 61 / 30 | 99.4 | 100.0 | 0.0 | 0 |
| 11–20 | 3 / 25 / 72 | 99.4 | 99.7 | 0.3 | 0 |
| 21–30 | 1 / 32 / 67 | 99.3 | 99.7 | 0.3 | 0 |
| 31–40 | 35 / 54 / 10 | 99.2 | 99.4 | 0.6 | 1 of 314 |
| 41–50 | 91 / 9 / 0 | 95.5 | 98.0 | 2.0 | 41 of 293 |
| 51–60 | 97 / 3 / 0 | 81.8 | 83.2 | 16.8 | 96 of 143 |
| 61–80 | 100 / 0 / 0 | 87.2 | 83.3 | 16.7 | 3 of 6 |

"No safe option" = even the best enemy on the roster was estimated below the bot's 90% line, so it took
the best one anyway.

| Best estimated win % on the roster, bot's own gear (mean over runs alive) | d2 | d3 | d5 | d7 | d10 | d15 | d20 | d25 | d30 | d35 | d40 | d50 | d60 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| normal | 94 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 99 | 91 | 79 |
| elite | 73 | 96 | 98 | 99 | 100 | 100 | 100 | 100 | 100 | 98 | 94 | 67 | 55 |
| champion | 35 | 77 | 88 | 95 | 96 | 98 | 99 | 98 | 96 | 89 | 75 | 34 | 20 |

(The best of the roster's two champions, with gems, rings and both packed items per slot, which is why
these numbers sit far above the plain-set table in the power section.)

| Daily time (minutes) | travel | search | of which clearing debris | refine | cut | smith | repair | idle | mining share of used time | trips/day |
|---|---|---|---|---|---|---|---|---|---|---|
| day 1 | 44 | 182 | 18 | 187 | 50 | 110 | 0 | 10 | 41% | 1.0 |
| days 2–5 | 49 | 158 | 11 | 175 | 97 | 100 | 0 | 10 | 37% | 1.0 |
| days 6–10 | 97 | 180 | 13 | 155 | 76 | 70 | 0 | 10 | 49% | 1.2 |
| days 11–20 | 174 | 184 | 9 | 120 | 59 | 44 | 0 | 10 | 62% | 1.5 |
| days 21–30 | 183 | 245 | 6 | 61 | 77 | 19 | 0 | 9 | 74% | 1.7 |
| days 31–40 | 169 | 296 | 6 | 16 | 99 | 5 | 0 | 8 | 80% | 1.8 |
| days 41–60 | 89 | 133 | 1 | 14 | 256 | 6 | 0 | 101 | 45% | 0.8 |
| days 61+ (few runs) | 157 | 157 | 2 | 4 | 272 | 0 | 0 | 7 | 53% | 1.2 |

("Of which clearing debris" = the share of the search minutes whose effort went into debris; it is not a
separate action any more, and the search column includes it. "Mining" = travel + search. The summary
line's 60% is the average over all days from day 2. Repairs show 0 minutes because the bot only repairs
at night, when they cost no time.)

**Field piles and carrying.** Per run the bot makes 351 searches that find 1,194 items (3.40 per search,
all into field piles) and carries 604 of them home (51%) on 59 trips (10.2 items per trip, 19% of trips
full); 56 of the carried items were picked up from piles left on earlier trips. At the end of a run about
590 items lie in field piles, almost all ores it no longer needs (371 copper, 186 iron, 33 coal; only 2.7
items per run are still worth carrying). 3.9% of its search effort goes into debris, and 19% of its finds
come from cells that had debris.

**Map supply** (fields do not regrow, so the map is the whole supply; the bot's 40 maps start with 1,537
hidden items: copper 561, iron 384, coal 123, mythril 13, gems 456). "Found" = taken out of cells by
searching (into the field's pile); "found/day" and "mining min per found item" cover the 10 days up to
that day:

| Day | Runs alive | Found so far | % of map | Still in piles | Coal left | Mythril left | Found/day | Mining min per found item | Idle min/day |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 35 | 219 | 14 | 41 | 116 | 14 | 21.9 | 11.7 | 10 |
| 20 | 34 | 508 | 33 | 157 | 82 | 7 | 28.8 | 12.8 | 10 |
| 30 | 33 | 843 | 55 | 338 | 52 | 2 | 33.7 | 12.9 | 9 |
| 40 | 31 | 1,261 | 82 | 613 | 20 | 1 | 41.6 | 11.3 | 8 |
| 50 | 28 | 1,434 | 92 | 723 | 8 | 0 | 17.3 | 16.9 | 22 |
| 60 | 2 | 1,540 | 93 | 837 | 8 | 1 | 12.8 | 17.4 | 253 |

The same bot with `--immortal` (enemies deal no damage, so all 40 runs reach day 80 and show how long the
map lasts for a careful player who never dies):

| Day | Found so far | % of map | Coal left | Mythril left | Found/day | Mining min per found item | Idle min/day |
|---|---|---|---|---|---|---|---|
| 30 | 838 | 55 | 50 | 2 | 33.0 | 13.3 | 9 |
| 40 | 1,252 | 82 | 21 | 1 | 41.4 | 11.3 | 8 |
| 50 | 1,401 | 91 | 9 | 0 | 14.9 | 16.6 | 45 |
| 60 | 1,417 | 92 | 7 | 0 | 1.6 | 21.5 | 447 |
| 70 | 1,420 | 92 | 7 | 0 | 0.3 | 32.0 | 579 |
| 80 | 1,420 | 92 | 7 | 0 | 0.1 | 43.2 | 596 |

**Finding: with no regrowth the map caps a run.** The bot finds 22–42 items a day until day 40 (more as it
moves to richer fields and its skills grow), by when 82% of the map and nearly all of its mythril (about 1
of 13 left) are gone; coal follows (about 8 left by day 50). Coal and mythril run low around day 45–50,
about 4–5 days sooner than in 1.0 because mining is faster: the immortal bot's finds fall from about 41 a
day (days 31–40) to 15 (days 41–50) and under 2 after that, its idle time jumps to 450–600 minutes a day,
and its gear stops improving around day 30–40 (best sword mythril B, about 3.3 of 5 slots mythril, as in
1.0). A map holds about 13 mythril while a set of matched mythril C-or-better pieces needs about 26 on
average (economy section 5), so even a perfect player hits a wall around day 55–70: the best plain set,
mythril S, holds 90% against normals only until day 60, and only the ceiling loadout (S gems, ten S rings)
still wins 97% at day 80 (Appendix A), which needs far more S-grade material than one map holds. The
careful bot dies at about the same time (median day 53), and the map is one of its limits: with regrowth
on it lives about 3–4 days longer. Regrowth can be re-enabled via `CONFIG.field.regrowPctPerDay`: with
`--set field.regrowPctPerDay=5` the bot keeps finding about 28–30 items a day after day 50, has nearly all
5 slots in mythril by day 60 (4.9 of 5) and lives longer (median 56.5 instead of 53.0; alive at day 60:
45% instead of 3%; mean score 1,234).

Other bot facts: about 43 rings per run (17.1 smith, 25.8 adventurer); 4.8 repairs per run, all at night,
costing 1.4% of the bars made (1.0 of them with a higher-grade substitute); 1.4 items per run destroyed by
wear (2.0% of bars made, mostly mythril that could not be repaired once the map's mythril was gone); 310
gems cut per run; 76% of the map searched by the end of a run; all intel goes to enemy scouting (8.4
points). Nine of 40 runs die before day 40, five of them on day 2. After day 40 deaths are a mix of unlucky
losses at 90–99% estimates and "no safe option" days; on days 51–60, 67% of the bot's fights have no safe
option.

**System ablations** (same 40 seeds, `--ablate <system>`, plus two what-ifs). Survival numbers still move
by several points from noise alone (the tool's help gives ±10 for 20 runs), so only large differences mean
something:

| Run | Median life | Alive d40 / d50 / d60 | Mean score | Note |
|---|---|---|---|---|
| full game | 53.0 | 78% / 63% / 3% | 1,192 | |
| `--ablate rings` | 42.5 | 58% / 18% / 3% | 683 | clear loss: rings are the main late-game power source, and without them the bot takes far fewer champions (4.1 instead of 14.0 wins per run; champions are 21% of its fights on days 11–30 instead of 69%) |
| `--ablate gems` | 43.5 | 65% / 10% / 0% | 1,124 | clear loss after day 40: without cutting and infusing the bot reaches mythril early (3 slots by day 15) and then has little worth doing: trips fall to 0.2–0.4 a day and it idles 420–520 min a day after day 20 (only 50% of the map found by day 40); almost every run dies by day 50 |
| `--ablate repair` | 45.0 | 65% / 30% / 5% | 1,091 | a clear loss (free night repairs keep the best gear alive) |
| `--ablate skills` | 49.5 | 70% / 45% / 8% | 1,062 | a loss (no debris, search or gem skills: 6.3% of search effort goes into debris instead of 3.9%, and gems stay at the novice table, F/D/C+ 16 / 44 / 40%) |
| `--ablate intel` | 52.0 | 75% / 55% / 8% | 1,065 | within noise |
| `--carry default` (the game's "Rarest first" default instead of the bot's value choice) | 50.0 | 73% / 48% / 13% | 1,054 | carries everything it finds (15.9 items per trip), including ore it no longer needs |
| `--set field.regrowPctPerDay=5` | 56.5 | 68% / 60% / 45% | 1,234 | regrowth keeps the late game supplied |

No ablation beats the full game. Compared with 1.0, repair moved from a small loss to a clear one (8 days
of median life instead of 4.5), the skills loss shrank (3.5 days instead of 7.5), and rings and gems cost
about as much as before (10.5 and 9.5 days; 1.0: 8.5 and 7.5, within noise).

### Running what-if experiments

```sh
node tools/balance.mjs --section power                       # power curve only (~5 s)
node tools/balance.mjs --section economy                     # mining / refining economy, map size (~10 s)
node tools/balance.mjs --section bot --seeds 40              # bot playthroughs (~2-3 min)
node tools/balance.mjs --section bot --seeds 40 --immortal   # bot can't lose: how fast the finite map runs out
node tools/balance.mjs --quick                               # smoke test of all sections

# Override any CONFIG value in memory for one run (js/config.js is never changed):
node tools/balance.mjs --section power --set enemies.growthPerDay.hpDamage=4
node tools/balance.mjs --section bot --set field.regrowPctPerDay=5               # turn field regrowth back on
node tools/balance.mjs --section bot --set field.oreWeights.3.mythril=10       # array index (row for distance 4+)
node tools/balance.mjs --section bot --set 'field.oreWeights.*.mythril=2'      # '*' = every row
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'
node tools/balance.mjs --section economy --set 'field.debrisAmount={"min":10,"max":30}'   # thinner debris
node tools/balance.mjs --section bot --seeds 40 --set 'cut.*.novice={"F":12,"D":40,"C":25,"B":14,"A":7,"S":2}'

# What the bot (and the economy trips) carry home: its own value choice (default) or the game's default
node tools/balance.mjs --section bot --seeds 40 --carry default

# Play the bot without a system: gems, rings, skills, intel, repair (comma separated)
node tools/balance.mjs --section bot --seeds 40 --ablate rings
node tools/balance.mjs --section bot --seeds 40 --ablate gems,repair
```

Other flags: `--seeds N` (economy: maps, default 100; bot: runs, default 20), `--days N` (bot day limit,
default 80), `--samples N` (power: attribute guesses per cell, default 100), `--minwin P` (bot: lowest
estimated win % it accepts, default 90), `--future F` (bot: how much one survival is worth when picking
fights, default 1000; lower = greedier), `--immortal` (bot: enemies deal no damage and the bot fights an
elite every day without estimating, so no run ends early; survival and fight numbers are meaningless then,
the "Map supply" table is the point), `--carry value|default` (bot and economy trips: carry the most
valuable items of bag + pile by the bot's own values, default, or use the game's "Rarest first"
`defaultCarry`). `--help` prints the full option list.

How to compare: each section ends with a one-line `ECONOMY SUMMARY`, `POWER SUMMARY` or `BOT SUMMARY`.
Run the baseline and the what-if with the same flags and compare those lines. The run prints the
overrides it applied at the top (`WHAT-IF overrides`). A `--set` path must already exist in `CONFIG`
(typos are rejected) and a number can only be replaced by a number. For close bot comparisons use
`--seeds 40` or more.

Example: `--set enemies.growthPerDay.hpDamage=4` moves the power summary to
`last day >=90% vs normal: ... Steel C d15, Mythril C d30, Mythril S d50 | >=70% vs elite: ... Iron C d5,
Steel C d15, Mythril C d20, Mythril S d40 | ceiling vs normal d60/d80 99/63%`, i.e. every tier loses 5–10
days.

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
| Search a 3x3 area (also clears debris, section 3.4) | 30 min | Quick search ring + Search speed skill |
| Refine one bar | 15 / 20 / 25 / 30 min (copper / iron / steel / mythril) | Refining ring + Refining speed skill |
| Cut one gem | 20 min | Refining ring + Cutting speed skill |
| Smith gear | 15 min per bar (+10 min with a gem) | nothing |
| Repair | by day: 50% of smithing time × fraction repaired; at night: no time | nothing (night repairs are free) |

Every reduction is applied as `time = base × (1 − min(totalReduction%, 75) / 100)` and rounded to 0.1 min.

**Rules (from `js/core/map.js`, `processing.js`, `gear.js`, `game.js`):**
- A search is allowed only if `now + search minutes + walk home minutes ≤ 18:00`, where the walk home
  assumes a **full load** (`projectedLoad`): the bag plus this field's pile, up to the bag size (20).
  Leaving items behind does not buy extra time. The load is taken *before* the search, so items found
  during it can push the walk home a little past 18:00.
- Travelling to a field (from camp or from another field) is allowed only if the trip there plus the walk
  from there to camp, both with the load being carried, end by 18:00.
- The walk home to camp is always allowed, even if it ends after 18:00.
- Camp work (refine, cut, smith, daytime repair) must finish by 18:00 (no overtime).
- Repairs at night (the battle report and plan screens, `isNight` in `gear.js`) cost no time, so they
  have no clock check and need no camp visit.
- Choosing what to carry and moving items between the bag and a field's pile is free and has no time
  check (section 4).
- **The day never ends by itself.** At 18:00 the clock shows "day over" and only the walk home and free
  moves between bag and pile remain possible. The player ends the day with the "End day" button, which
  works only at camp. Ending it sets the clock to `max(now, 18:00)`.

**Worked example.** 14:30 at a field 3 steps from camp with 8 items in the bag and 5 in the field's pile.
The check assumes a load of min(20, 8 + 5) = 13 items: walk home = 3 × 20 × 1.13 = 67.8 min. A 30-minute
search is allowed because 14:30 + 30 + 67.8 = 16:07.8 ≤ 18:00. At 16:30 the same search would end at 17:00
and the walk home at 18:07.8, so it is refused, even if the player meant to leave the 5 pile items behind.
With 15 in the bag and 9 in the pile the load is capped at 20 (+20%, 72 min).

**Tuning notes.** Day length scales everything that is "per day" (gathering, refining, smithing) against
everything that is "per fight" (wear, enemy growth). Longer days = easier game. The 75% cap only matters
once many rings and skills are stacked (the bot ends runs at about 8–14% total on each time bonus). The
Debris clearing skill is not a time reduction (it multiplies clearing power, section 3.4), so the cap does
not apply to it.

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

**Worked example.** 3 steps with 10 items, Travel ring S (10%) worn, Return travel skill level 10 (6%):
going out = 60 × 1.10 × (1 − 0.10) = **59.4 min**; coming home = 60 × 1.10 × (1 − 0.16) = 55.44 → **55.4 min**.
The Return travel skill matches a C-grade Travel ring in size (6%) but only counts on trips that end at
camp, so it is worth about half a ring.

**Tuning notes.** `travelMinPerStep` sets how much of the day a rich far field costs: at 20 min/step a
distance-4 round trip takes 160+ of the 600 minutes. Raising it pushes players to near fields (more copper,
fewer gems, no coal or mythril); lowering it makes far fields the obvious choice. `loadPenaltyPerItem` is a
small tax that interacts with bag size (a full 20-item load = +20% on the way home). The bot spends about
170–185 min a day travelling on days 11–40, less after that as the reachable fields run dry.

---

## 3. Fields, searching, regrowth (off), debris, boulders and ore sight

### 3.1 What a field holds

| Number | Config path | Value |
|---|---|---|
| Field size | `CONFIG.field.size` | 8 (8x8 = 64 cells, 63 of them searchable) |
| Boulders per field | `CONFIG.field.boulders` | 1 (never cleared or searched, holds nothing) |
| Loot chance per cell | `CONFIG.field.lootChance` | `{ base: 50, perDistance: 5, max: 80 }` |
| Debris chance per cell | `CONFIG.field.debrisChance` | 15 (%) |
| Debris thickness | `CONFIG.field.debrisAmount` | `{ min: 20, max: 60 }` (search effort, section 3.4) |
| Extra loot chance under debris | `CONFIG.field.debrisLootBonus` | 20 (points) |
| Items in a loot cell (weights) | `CONFIG.field.itemCountWeights` | 1: 30, 2: 40, 3: 30 (average 2.0) |
| Share of items that are ore | `CONFIG.field.oreShare` | 70 (%), the rest are gems |
| Ore weights by distance | `CONFIG.field.oreWeights` | rows for distance 1, 2, 3, 4+ |
| Gem weights | `CONFIG.field.gemWeights` | a single row used at every distance: every gem 20 (equally likely) |

**Formula** (`rollCell` and `generateField` in `js/core/map.js`), per cell:

```
lootChance = min(max, base + perDistance × (distance − 1))   + (debris ? debrisLootBonus : 0)
debris     = with debrisChance %: a whole-number thickness, uniform 20–60; else 0
items      = 1, 2 or 3 (weighted 30/40/30)                   if the loot roll succeeds
each item  = ore (70%) using oreWeights row, else gem using gemWeights row
each item gets a hidden depth d, uniform 0–100
then, per field: `boulders` (1) random cells are replaced by a boulder (no debris, no items)
```

Note: the `max` cap applies before the debris bonus, so a debris cell can exceed 80% (100% from distance 7).
Ore rows: distance 1 uses row 1, … distance 4 and farther use row 4. The gem table has one row, so it is
used at every distance (a table with more rows would work like the ore rows).

| Distance | Loot chance (normal / debris) | Expected items per field | Ores | Gems |
|---|---|---|---|---|
| 1 | 50% / 70% | 66.8 | 46.7 | 20.0 |
| 2 | 55% / 75% | 73.1 | 51.2 | 21.9 |
| 3 | 60% / 80% | 79.4 | 55.6 | 23.8 |
| 4 | 65% / 85% | 85.7 | 60.0 | 25.7 |
| 5 | 70% / 90% | 92.0 | 64.4 | 27.6 |

Expected items per field = 63 searchable cells × (0.85 × loot + 0.15 × (loot + 20)) / 100 × 2.0.

| Distance | Copper | Iron | Coal | Mythril | Each gem (ruby, topaz, sapphire, emerald, diamond) |
|---|---|---|---|---|---|
| weights 1 | 80 | 20 | 0 | 0 | 20 |
| weights 2 | 60 | 35 | 5 | 0 | 20 |
| weights 3 | 45 | 40 | 15 | 0 | 20 |
| weights 4+ | 35 | 40 | 20 | 5 | 20 |
| expected per d1 field | 37.4 | 9.3 | 0 | 0 | 4.0 |
| expected per d2 field | 30.7 | 17.9 | 2.6 | 0 | 4.4 |
| expected per d3 field | 25.0 | 22.2 | 8.3 | 0 | 4.8 |
| expected per d4 field | 21.0 | 24.0 | 12.0 | 3.0 | 5.1 |

So: no coal next to camp, mythril only in the farthest fields (distance 4+), and every gem type equally
likely everywhere (user decision in 1.1; in 1.0 near fields were ruby-heavy and diamonds rare: 35 / 30 /
20 / 10 / 5 at distance 1).

**Whole-map totals (average over 5,000 generated maps).** About **1,540 items** on a fresh map (1,544;
the economy report's 100 maps give 1,541): copper 560, iron 386, coal 122, mythril 13.5, and about 93 of
each gem (463 gems). That is about 20 items fewer than in 1.0 (the 20 boulders hold nothing). Fields do
not regrow (3.2), so **this is the whole supply of a run**. Coal limits steel (one coal per steel bar, so
at most about 122 steel bars) and mythril is the scarcest input by far: about 13–14 ore per map, while a
mythril set with every piece C or better needs about 26 ore on average (section 5).

**Tuning notes.** `lootChance` and `itemCountWeights` set total supply (with regrowth off, literally the
total for a run). They were raised from 40/5/70 and 50/35/15 when search efficiency fell from 50% to 35%,
to keep the pacing. The mythril column of `oreWeights` is the main gate on late-game power, and the coal
column gates steel. `oreShare` trades bars against gems; `gemWeights` sets the gem mix (equal now). Debris
adds richness but costs search effort (3.4); `boulders` removes searchable cells (each boulder costs a
field about 1.1–1.5 expected items).

### 3.2 Regrowth (off)

| Number | Config path | Value |
|---|---|---|
| Regrowth chance | `CONFIG.field.regrowPctPerDay` | 0 (off: fields do not regrow) |

**Off for now** (the user's call: the game is a first draft). The mechanism is kept: any value above 0
turns it back on with no other change.

**Formula** (`regrowFields` in `js/core/map.js`, run when the night's plan is confirmed and the next day
starts; it does nothing at 0). For every cell of every field with `searched > 0` (partly or fully searched)
that is not a boulder:

```
with regrowPctPerDay % chance: replace the cell by a freshly rolled cell (rollCell for the field's distance:
new debris roll and thickness, new hidden items and depths, searched 0, not revealed).
```

Boulders, never-searched cells (including debris cells whose debris is not cleared yet and cleared but
unsearched cells) and the field's pile do not change.

**Worked example (if it were set to 5).** A fully searched distance-3 field: each night about 63 × 5% =
3.15 cells regrow (the boulder never does), each holding (0.85 × 60% + 0.15 × 80%) × 2.0 = 1.26 items, so
about 4.0 new items per night. After 10 nights 1 − 0.95¹⁰ = 40% of its cells (about 25) are fresh again,
holding about 32 items. A searched cell has a 50% chance to have regrown after 14 nights. On a completely
searched map, about 63 cells (≈ 77 items) regrow per night across all 20 fields, which would be the
long-run supply once the map is spent.

**Tuning notes.** With regrowth off the map is a finite resource that caps the length of a run: the bot
has found 82% of the map by day 40 and 92% by day 50; mythril is nearly gone by day 30 and coal runs low
by day 45–50 (about 8 of 123 left at day 50; see "Map supply" in the results). Turning it back on (try
`--set field.regrowPctPerDay=5` in the balance tool) keeps the endless game supplied, mostly near camp,
where the player searches most; high values make near fields self-sufficient (less reason to travel).

### 3.3 Searching

| Number | Config path | Value |
|---|---|---|
| Search time | `CONFIG.field.searchMin` | 30 min per 3x3 search |
| Search efficiency | `CONFIG.field.searchEfficiency` | 35 (average % of each cell searched per search, before bonuses) |
| Search randomness | `CONFIG.field.searchRandomness` | 5 (each cell rolls efficiency ± 5 points per search: 30–40% at base) |

**Formula** (`search`, `searchEfficiency`, `searchEfficiencyRange` in `js/core/map.js`):

```
efficiency = searchEfficiency × (1 + (searchEffRing% + searchEffSkill%) / 100)        (the average)
range      = [clamp(efficiency − searchRandomness, 0, 100), clamp(efficiency + searchRandomness, 0, 100)]
minutes    = round1( searchMin × (1 − min(searchTimeRing% + searchTimeSkill%, 75) / 100) )
for each open cell in the 3x3 area (clipped at the field edge; open = not a boulder, and debris left or
not fully searched):
    effort   = clamp(efficiency + uniform(−searchRandomness, +searchRandomness), 0, 100)   (new roll per cell, per search)
    on a debris cell the effort clears debris first (section 3.4); only the leftover effort searches it
    searched = min(100, searched + effort)
    every hidden item with depth < searched is found (all items once searched reaches 100)
```

Found items go to **the field's pile** (section 4), never straight into the bag. A search costs the full
time even if some cells in the area are skipped (boulders, already done, or off the field edge) or all its
effort went into debris. It is refused only when no cell in the area is open. The map shows the current
range (for example "30–40%").

**Searches to finish a cell.** Bonuses multiply the average; the ± 5 spread stays the same. At base, one
search adds 30–40%, so 3 searches finish 83% of cells and 17% need a 4th (the chance that three rolls add
up to less than 100 is exactly 1/6). From a +9.6% bonus (average 38.3%, lowest roll 33.3%) every cell is
done in 3, and from about +28.6% (average 45%) the best rolls finish a cell in 2. Economy report,
section 1a (cells without debris; a debris cell takes about one more search, section 3.4):

| Search efficiency bonus | Per search (per cell) | Searches to finish a cell |
|---|---|---|
| +0% | 30–40% | 3.17 on average (3: 83%, 4: 17%) |
| +12% (skill level 10, or a C-grade Thorough search ring) | 34.2–44.2% | 3 |
| +20% (S ring) | 37–47% | 3 |
| +32% (S ring + skill level 10) | 41.2–51.2% | 2.97 (2: 3%, 3: 97%) |

The largest possible bonus is just under +52% (ten S Thorough search rings add 39.96 with the duplicate
penalty, the skill 12): 48.2–58.2% per search, so about 93% of cells finish in 2.

Within a cell, the first search finds on average 35% of its items (the efficiency, since depths are
uniform), the second another 35%, the third almost all of the rest. Bonuses move items into the earlier
searches and remove the 4th (and, with big stacks, the 3rd).

**Worked example.** A fresh, debris-free 3x3 area in a distance-2 field holds on average
9 × 0.55 × 2.0 = 9.9 items. At base efficiency the first 30-minute search finds about 3.5, the second about
3.5 and the third the remaining 2.9 (a tiny rest is left for a 4th search on 1 cell in 6). With a Thorough
search ring S (20%) and Search efficiency skill level 5 (6%), efficiency is 35 × 1.26 = 44.1% (39.1–49.1%
per cell): about 4.4 items in the first search, 4.4 in the second and 1.2 in the third, and no cell needs a
4th.

Covering a whole 8x8 field takes at least 9 areas × 3 searches = 27 searches (13.5 hours); greedy area
picks in the economy report use about 35 searches per field (35.0–35.9 by distance) because areas overlap
at the edges, some cells need a 4th search and debris cells need about one more (1.0: about 33 searches
plus about 140 minutes of clearing, about 37 searches' worth of time). On average a search finds 1.89 /
2.10 / 2.27 / 2.41 / 2.60 items at distance 1 / 2 / 3 / 4 / 5+, debris cells included (1.0, with its
clearing minutes counted as searches: 1.82 / 1.95 / 2.16 / 2.32 / 2.57).

**Tuning notes.** At 35% the efficiency bonus pays off twice: it moves items into the first searches
(better "skimming" of fresh areas) and it removes the 4th search (from +9.6%) and, with big stacks, the
3rd. `searchRandomness` makes cells finish unevenly; at 0 every cell would take exactly
`ceil(100 / efficiency)` searches (3 at 35%). Breakpoints of the average with ± 5: every cell in 3 from
38.3%, some cells in 2 from 45%, every cell in 2 from 55% (out of reach). `searchMin` and
`searchEfficiency` together set items per minute; the bag size (20) caps how much one trip carries, not
how much a search finds.

### 3.4 Debris

| Number | Config path | Value |
|---|---|---|
| Debris chance | `CONFIG.field.debrisChance` | 15 (% of cells) |
| Debris thickness | `CONFIG.field.debrisAmount` | `{ min: 20, max: 60 }`: a whole number, uniform, in search effort |
| Debris loot bonus | `CONFIG.field.debrisLootBonus` | +20 points loot chance |
| Debris clearing skill | `CONFIG.skills.activity.debris.perLevel` | 10 (% more debris cleared per search, per level) |

There is **no separate clear action** (1.0 had a 15-minute-per-cell "Clear debris" button). Debris is
cleared by searching (`search`, `debrisClearMult` in `js/core/map.js`):

```
clearMult = 1 + debrisSkill% / 100                 (skill level 5: ×1.5, level 10: ×2)
for each debris cell in the searched 3x3 area:
    effort  = the cell's normal effort roll (efficiency ± randomness, as in 3.3)
    power   = effort × clearMult
    cleared = min(debris, power)          debris = debris − cleared
    effort  = (power − cleared) / clearMult           (what is left over, back in search effort)
    if no debris is left and effort > 0: the cell is searched with that effort in the same search
Debris clearing XP = 1 per point of debris cleared (summed over the area)
```

A cell under debris cannot be searched until its debris is gone, and it gets no ore sight roll in a search
whose effort all went into debris. The number on the cell is the debris left (rounded up). A field has
about 9.4 debris cells (about 189 per map) with an average thickness of 40, so a map holds about 7,550
points of debris. A regrown cell (only when regrowth is on) rolls debris again.

**Searches to clear** (base efficiency: each cell rolls 30–40 effort; "left" = the effort that still
searches the cell in the clearing search):

| Thickness | Skill 0 (clearing power 30–40 per search) | Skill 5 (×1.5: 45–60) | Skill 10 (×2: 60–80) |
|---|---|---|---|
| 20 | 1 search, 10–20 left | 1 search, 17–27 left | 1 search, 20–30 left |
| 40 | 2 searches (the second one also searches the cell) | 1 search, 3–13 left | 1 search, 10–20 left |
| 60 | 2 searches | 2 searches | 1 search, 0–10 left |

The economy report puts the average searches to finish a debris cell at 4.50 with no skill, 4.08 at skill
5 and 3.99 at skill 10 (a clear cell takes 3.17).

**Worked example.** A 45-thick debris cell, Debris clearing skill level 5 (×1.5), and the cell rolls 35
effort: clearing power 35 × 1.5 = 52.5 removes all 45 debris; the leftover 7.5 power is 7.5 / 1.5 = 5
effort, so the cell ends the search 5% searched (items with depth below 5 are found) and the skill gets
45 XP. With no skill the same roll clears 35 and leaves 10 on the cell; the next search (say 35 effort)
clears those 10 and searches the cell 25%.

**Tuning notes.** A debris cell has +20 points loot chance (70% instead of 50% at distance 1), so it holds
about 1.4 expected items instead of 1.0. Clearing costs search effort instead of time: in the economy
report about 5% of all search effort on a field goes into debris (about 37 search-minutes per field,
against about 140 minutes per field for the old 15-minute clear action); together with the field piles
(finds beyond a full bag are carried on the next trip, section 4), that is why mining got about 5–10% more
efficient in 1.1; 19% of the bot's found items come from cells that had debris. The
thickness sets how much effort debris eats (mean 40, about 1.1 extra searches per cell at base). The Debris
clearing skill has no ring counterpart and is strong per level (+10%; at level 10 every debris cell clears
in one search); its XP is 1 per point cleared, so the first levels come quickly (level 1 after 100 points,
two or three debris cells), and the bot ends runs at level 8.7 (+87%). Raising `debrisChance` or
`debrisAmount` hides more of each field behind extra searches.

### 3.5 Boulders

| Number | Config path | Value |
|---|---|---|
| Boulders per field | `CONFIG.field.boulders` | 1 |

When a field is generated, `boulders` random cells (out of 64) are replaced by a boulder (`boulderCell`):
no items, no debris, never searchable, never regrown. The map draws it as a dark rock. Boulders are left
out of a field's searched % (`fieldProgress` averages over the other 63 cells) and a search area simply
skips them; an area made only of boulders and finished cells cannot be searched. Each boulder takes about
1.1–1.5 expected items out of its field (20 boulders = about 20–25 items per map).

### 3.6 Ore sight

| Number | Config path | Value |
|---|---|---|
| Base ore sight chance | `CONFIG.intel.tracks.oreSight.base` | 10 (%) |
| Ore sight ring | `CONFIG.rings.types.reveal.values` | 3 / 4 / 5 / 6 / 7 points (D…S) |

**Formula.** `revealChance = intelChance('oreSight') + oreSightRingTotal` (points). After every search,
each cell that the search actually searched (not one whose effort all went into debris), that is not yet
revealed and that the search did not finish (still below 100%), rolls this chance once. A revealed cell
shows every item still hidden in it, or that it is empty (you still have to search to collect them). There
is no cap: 100% or more always reveals. A regrown cell (only when regrowth is on) starts unrevealed again.

**Worked example.** Base 10% plus 2 intel points (+10, +9) plus an Ore sight ring B (5): 34% per cell, so a
9-cell search reveals about 3 cells on average.

**Tuning notes.** Ore sight is information, not loot: it tells the player when to stop digging an empty
cell. With about 3 searches per cell it can save up to two searches on a cell (one revealed after the
first search), so it is worth more than it used to be; the bot still never spends intel on it.

---

## 4. Bag, field piles and carrying

| Number | Config path | Value |
|---|---|---|
| Bag slots | `CONFIG.bag.slots` | 20 (1 raw ore or raw gem per slot; the most one trip can carry) |

**Rules** (`search`, `defaultCarry`, `setCarry`, `moveToPile`, `takeFromPile`, `projectedLoad`, `travel`
in `js/core/map.js`):
- **Everything a search finds goes to that field's pile** (no limit). A pile stays for the whole run (also
  overnight, and regrowth does not touch it); the world map shows a badge with each pile's size.
- In the field, single items move between the bag and the pile for free (`moveToPile`; `takeFromPile`
  only while the bag has a free slot).
- **Leaving a field** (to camp or to another field) while its pile has items opens "Choose what to carry":
  a checkbox per item of the bag and the pile, at most 20 ticked. The ticked items become the bag, the
  rest goes to the pile (`setCarry`, applied by `travel(state, to, cfg, carry)`). With an empty pile the
  bag simply goes along.
- **Default "Rarest first"** (`defaultCarry`): keep the bag (its first 20 items), then fill the free slots
  from the pile in the order mythril, diamond, emerald, sapphire, topaz, ruby, coal, iron, copper (ties: the
  pile's order). The step also offers "Keep current bag" and "Clear" (carry nothing).
- **Time.** Searching checks the walk home with a full load: min(20, bag + pile) items (`projectedLoad`,
  section 1). Travelling to another field checks the trip there and back to camp with the chosen load. The
  walk home is always allowed. Each carried item adds `loadPenaltyPerItem` (1%) to travel time.
- Arriving at camp unloads everything carried into unlimited camp storage.

**Worked example** (economy report, section 3a). One trip from 8:00 to a distance-2 field: 88 min of
travel (40 out, 48 back with 20 items) and about 6 searches (183 min; the effort of about 14 of those
minutes went into debris) find 22 items in 271 minutes; 20 are carried home and 2 wait in the pile for the
next trip there. Repeating trips the same day brings home about 42 items (distance 1: 46, distance 4: 32;
1.0: about 38 at distance 2 and 30 at distance 4).

**Tuning notes.** The bag caps what one trip carries, not what a search finds: the rest waits in the
field's pile. Raising it mostly helps far-field play (fewer trips per item). The careful bot
(which carries by its own item values, `--carry value`) carries home 51% of what it finds, 10.2 items per
trip (19% of trips full), takes 56 items per run from piles left on earlier trips and ends a run with
about 590 items in piles, almost all of them ores of materials it no longer needs (2.7 still worth
carrying). With the game's own default (`--carry default`, which fills every free slot) it carries home
everything it finds (15.9 items per trip) and does worse (median life 50 instead of 53, mean score 1,054
instead of 1,192): the default also carries ore the player no longer needs, at +1% travel time per item.

---

## 5. Refining and cutting

| Number | Config path | Value |
|---|---|---|
| Refining recipes and times | `CONFIG.refine.<bar>.input / minutes` | copper 1 copper, 15 min; iron 1 iron, 20 min; steel 1 iron + 1 coal, 25 min; mythril 1 mythril, 30 min |
| Refining outcome tables | `CONFIG.refine.<bar>.dist` | see table |
| Cutting times | `CONFIG.cut.<gem>.minutes` | 20 min for every gem |
| Cutting tables | `CONFIG.cut.<gem>.novice / master` | novice F 15, D 45, C 25, B 10, A 4, S 1; master F 10, D 20, C 25, B 22, A 15, S 8 (every gem) |
| Gem grade skill | `CONFIG.skills.perMaterial.gemGrade.perLevel` | 10 (% of the way from the novice to the master table, per level) |
| Gem cutting skill | `CONFIG.skills.perMaterial.gemFail.perLevel` | 0.5 (points less failure per level) |
| Time-reduction cap | `CONFIG.processing.maxTimeReduction` | 75 (%) |

**Base outcome tables (% chance, lowest to highest as in the game):**

| Bar / gem | Fail | D | C | B | A | S | Share of successes at B or better | Average grade multiplier of a success |
|---|---|---|---|---|---|---|---|---|
| Copper | 10 | 30 | 25 | 20 | 10 | 5 | 38.9% | 1.13 |
| Iron | 10 | 35 | 25 | 18 | 8 | 4 | 33.3% | 1.12 |
| Steel | 10 | 40 | 25 | 16 | 6 | 3 | 27.8% | 1.10 |
| Mythril | 10 | 45 | 25 | 14 | 4 | 2 | 22.2% | 1.08 |
| Any gem, novice (gem skills 0) | 15 | 45 | 25 | 10 | 4 | 1 | 17.6% | n/a |
| Any gem, master (gem skills 10) | 10 | 20 | 25 | 22 | 15 | 8 | 50.0% | n/a |

A failure destroys the input (ore or raw gem). XP is still gained on a failure.

**Formula: bars** (`adjustDistribution` in `js/core/processing.js`). Two modifiers are applied in order:

1. **Fail reduction** (skills such as "Copper refining", one per bar type): `r = min(failRed, F)` points
   move from F to D.
2. **Upgrade luck** u% (ring "Bar luck" + skills such as "Copper bar grade"): every success below S has a
   u% chance to go up one grade. S stays S.

```
F' = F                 D' = D·(1−u)           C' = C·(1−u) + D·u
B' = B·(1−u) + C·u     A' = A·(1−u) + B·u     S' = S + A·u      (u as a fraction, D already includes the moved fail points)
```

**Formula: gems** (`blendCutTable`, `cutDistribution`). Each gem has its own grade skill ("Ruby grade") and
cutting skill ("Ruby cutting"):

```
t      = gem grade skill % / 100            (10% per level: level 10 = 1 = the master table)
F      = novice F − cutting skill points    (0.5 per level: 15 → 10 at level 10)
raw_g  = novice_g + (master_g − novice_g) × t                    for g = D, C, B, A, S
g      = raw_g / (raw_D + raw_C + raw_B + raw_A + raw_S) × (100 − F)       (D..S fill what failure leaves)
then Gem luck rings: every success below S has u% chance to go up one grade (as for bars; no fail step)
```

The master table's F (10) is not read by the formula: failure is always the novice 15 minus the cutting
skill, which reaches 10 at cutting level 10. Every gem cut gives the same XP to that gem's grade skill and
its cutting skill, so in play both are always at the same level and the scaling step changes nothing: the
table is the straight-line blend of the novice and master tables, failure included. At gem skill level L:
F 15 − 0.5L, D 45 − 2.5L, C 25, B 10 + 1.2L, A 4 + 1.1L, S 1 + 0.7L.

| Gem skills (grade = cutting) level | Fail | D | C | B | A | S | B or better (of successes) | Min per C-or-better gem | Effect per cut vs a C gem |
|---|---|---|---|---|---|---|---|---|---|
| 0 (novice) | 15 | 45 | 25 | 10 | 4 | 1 | 17.6% | 50.0 | 0.77 |
| 2 | 14 | 40 | 25 | 12.4 | 6.2 | 2.4 | 24.4% | 43.5 | |
| 4 | 13 | 35 | 25 | 14.8 | 8.4 | 3.8 | 31.0% | 38.5 | |
| 5 | 12.5 | 32.5 | 25 | 16 | 9.5 | 4.5 | 34.3% | 36.4 | 0.92 |
| 6 | 12 | 30 | 25 | 17.2 | 10.6 | 5.2 | 37.5% | 34.5 | |
| 8 | 11 | 25 | 25 | 19.6 | 12.8 | 6.6 | 43.8% | 31.2 | |
| 10 (master) | 10 | 20 | 25 | 22 | 15 | 8 | 50.0% | 28.6 | 1.08 |
| 1.0's fixed table, for comparison | 10 | 30 | 25 | 20 | 10 | 5 | 38.9% | 33.3 | 0.98 |

("Effect per cut vs a C gem" = the average infusion effect of one gem cut, failures counting as 0, divided
by the effect of a C gem; economy report section 4.)

Time: `minutes = round1(base × (1 − min(processTimeRing% + refineTime/cutTime skill%, 75) / 100))`.
The Refining ring applies to both refining and cutting; the skills are separate.

**Worked example (bars).** Copper with Copper refining skill level 10 (5 points), Bar luck ring S (6) and
Copper bar grade skill level 10 (3), so u = 9%:
step 1: F 10 → 5, D 30 → 35.
step 2: F = **5**, D = 35×0.91 = **31.85**, C = 25×0.91 + 35×0.09 = **25.9**, B = 20×0.91 + 25×0.09 =
**20.45**, A = 10×0.91 + 20×0.09 = **10.9**, S = 5 + 10×0.09 = **5.9**.

The same bonuses on mythril: F 5, D 45.5, C 27.25, B 14.99, A 4.9, S 2.36.

**Worked example (gems).** Ruby with Ruby grade and Ruby cutting at level 5 and a Gem luck ring S (6%):
blend t = 0.5, F = 15 − 2.5 = 12.5, and D..S = 32.5 / 25 / 16 / 9.5 / 4.5 (they already sum to 87.5 =
100 − F). Gem luck: F **12.5**, D 32.5×0.94 = **30.55**, C 25×0.94 + 32.5×0.06 = **25.45**, B 16×0.94 +
25×0.06 = **16.54**, A 9.5×0.94 + 16×0.06 = **9.89**, S 4.5 + 9.5×0.06 = **5.07**.

**Why grades are hard.** Gear needs *all* bars of the same material **and** grade (2 or 3 bars). With the
mythril table only 2 in 90 successes are S, so matching grades is the real bottleneck, and lower grades are
what players will usually smith. The economy report puts the expected inputs for a full set at 13.5 ore
for any matched grade but 26.5 mythril ore for "every piece C or better". A gem only goes into one item,
so gem grades need no matching.

**Refining minutes per usable bar** (economy report, no bonuses): copper 25, iron 36, steel 50, mythril 67
minutes per C-or-better bar; gems 50 minutes per C-or-better cut gem for a novice, 36 at gem skill 5 and
29 for a master (33 with 1.0's fixed table).

**Tuning notes.** The D column is the main knob for bar quality: every point moved from D to a higher
grade makes matching sets of that grade more common. F is a flat material tax. Upgrade luck is weak per
point (each point moves 1% of each grade up one step), which is why rings give only 2–6. For gems the two
tables set where a cutter starts and ends, and `gemGrade.perLevel` how fast practice pays (10 = the master
table at level 10, after 220 ruby or topaz cuts, 184 sapphire, 138 emerald or 110 diamond). A novice's
gems are worth about a fifth less than with 1.0's fixed table and a master's about a tenth more; the bot
cuts about 310 gems per run (F 13%, D 34%, C 25%, B 15%, A 8%, S 4%) and ends with gem skills between 3.1
(topaz) and 5.8 (emerald). Processing times (15 → 30 min) were raised so that refining and cutting take a
real share of the day (the bot spends about 300–370 min a day at camp refining, cutting and smithing in
the first 10 days, falling to about 120 min on days 31–40 as it mines more; after day 40, with the map
running low, it spends about 255 min a day cutting stockpiled gems).

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

**How much each slot is worth** (power report, steel C set vs an elite on day 24, base 51.4%; the report
picks the day where this set is closest to 50%, which moved from day 20 to day 24 when elites lost their
extra damage and defense): upgrading one piece to mythril C adds sword +41.9, boots +14.6, chest +8.7,
gloves +7.0, helmet +6.1 points; removing it costs sword −51.4, boots −28.5, chest −15.1, gloves −14.0,
helmet −10.2.

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
24 (all attributes hidden, base 51.4%; power report):

| Gem | Sword C | Sword S | Chest C | All 4 armor pieces C |
|---|---|---|---|---|
| Ruby | +9.3 | +18.5 | +2.6 | +8.3 |
| Sapphire | +8.4 | +23.7 | +3.9 | +8.6 |
| Emerald | +6.7 | +12.8 | +3.6 | +13.6 |
| Diamond | +5.1 | +14.2 | +0.4 | +2.7 |
| Topaz | +4.0 | +10.5 | +0.9 | +2.9 |

**Tuning notes.** The sword gems were rebalanced (ruby halved from 10–30% to 5–15%; emerald and diamond
doubled; topaz stun chance raised from 4–12% to 10–20% and stuns from 0.5–1.0 s to 1–1.5 s; sapphire
unchanged) so that ruby, diamond and sapphire swords were close, with emerald and topaz a step behind.
Since every tier has 20% defense (elites had 25%, champions 30%), piercing has less defense to ignore and
the diamond sword fell from second to fourth (C +5.1, was +10.1); ruby and sapphire now lead.
Armor gems are much weaker except emerald (dodge) and sapphire (slow resistance against Chilling).
Diamond armor (pierce resistance) and topaz armor (stun resistance) are nearly worthless because enemy
Piercing (5–25% of your defense) and Stunning (5–15% chance of a 1 s stun) are small threats; see 10.4 and
10.6. To rebalance, scale the tables in `CONFIG.gemEffects`. Which grades the player gets comes from the
cutting tables (section 5): a novice cuts C or better on 40% of attempts, a master on 70%, and every gem
type is equally common in the fields.

---

## 8. Durability and repair

| Number | Config path | Value |
|---|---|---|
| Wear per fight | `CONFIG.gear.durabilityLoss` | `{ min: 3, max: 7 }` (whole %, uniform) |
| Repair material cost | `CONFIG.gear.repair.materialFraction` | 35 (% of the original bars and gem for a 0→100% repair) |
| Repair time | `CONFIG.gear.repair.timeFraction` | 50 (% of the original smithing time for a 0→100% repair; by day only) |

**Formula** (`resolveBattle` in `game.js`; `repairInfo`, `repairPlan`, `repair` in `gear.js`):

```
after each fight (win, draw or loss), every item the adventurer actually USED loses randInt(3, 7) durability
durability 0 → item destroyed (packed-but-unused items lose nothing)

missing     = 100 − durability
repair bars = ceil to 0.01 of ( slot bars × 35/100 × missing/100 )     item's material, its grade or higher (see below)
repair gem  = ceil to 0.01 of ( 1 × 35/100 × missing/100 )             only if the item has a gem; its grade or higher
repair time = by day:   round1( craftMinutes × 50/100 × missing/100 )  at camp, must end by 18:00
              at night: 0                                              battle report or plan screen
```

**When and where.** By day a repair is camp work: the smith must be at camp and the repair must end by
18:00. At night (the `report` and `plan` phases, `isNight`) a repair costs no time and has no camp or clock
check. All gear is home at night (the packed gear comes back when the day ends, and tomorrow's gear is
only packed when the plan is confirmed), so every item can be repaired then, including the pieces used in
today's fight. During the next day the packed items are away and cannot be repaired (or scrapped). The
game-over screen is not night. Repairs always go back to 100%. Durability does not lower an item's stats.
Scrapping an item gives nothing back.

**Higher grade as a substitute** (`repairPlan`, `substituteWarning`). A repair uses the item's own grade if
storage has enough of it for the whole amount; otherwise the lowest higher grade that has enough on its
own. Bars and gem are chosen separately. Grades are never combined: with 0.30 C and 0.30 B iron bars a
repair that needs 0.42 bars is refused, although there are 0.60 in total. The higher grade gives no
benefit (the item keeps its grade). The game warns: the repair line shows "Warning: Uses 0.42 B iron bars
instead of C — no extra benefit", "Repair all" asks for confirmation when any of its repairs would use a
substitute, and the result message repeats the warning.

**Worked example (substitute).** An iron C sword with a ruby B gem at 40% needs 0.42 iron C bars and
0.21 cut ruby B (12 min by day, no time at night). Storage: 0.10 iron C, 0.50 iron B, 2 iron A, no ruby B,
1 ruby S. The repair takes 0.42 iron **B** (the lowest higher grade with enough; the A bars and the 0.10 C
are untouched) and 0.21 ruby **S**, and reports "Uses higher grade: 0.42 B iron bars instead of C; 0.21 S
cut ruby instead of B (no extra benefit)."

**Worked examples** (iron C items, exact grade in stock):

| Item | Durability | Bars | Gem | Time by day (at night: 0) |
|---|---|---|---|---|
| Chest | 95% | 0.06 iron C (3 × 0.35 × 0.05 = 0.0525, rounded up) | none | 1.1 min |
| Chest | 50% | 0.53 iron C | none | 11.3 min |
| Sword + ruby B | 93% | 0.05 iron C | 0.03 ruby B | 1.4 min |
| Sword + ruby B | 40% | 0.42 iron C | 0.21 ruby B | 12 min |
| Boots + emerald C | 70% | 0.21 iron C | 0.11 emerald C | 6 min |

**Lifetime.** Average wear is 5% per fight, so an unrepaired item lasts about 20 fights (15 at worst,
34 at best). Repairing after every fight would cost about 1.75% of the item's bars per fight (plus
rounding), so roughly 57 fights of repairs cost as much as a new item.

**Night repairs and the packing rule.** Wear lands at the end of the fight day, and the next plan is made
right away. An item that is packed every night is never at home during a work day, so by day it could
never be repaired; the free night repair fixes that: the battle report offers Repair buttons for the gear
just used, and the plan screen for every item, before anything is packed. In the bot runs (the bot
repairs its two best items of each slot at night once they fall below 50%, or below 30% when only a higher
grade is in stock, and never repairs by day): 4.8 repairs per run, all at night, costing 1.4% of the bars
made; 1.0 of them use a higher-grade substitute (0.50 better bars per run). 1.4 items per run are still
destroyed by wear (2.0% of the bars made, mostly mythril): on about 16 nights per run a worn top item has
no bars of its material at its grade or higher, and once the finite map's mythril is gone, mythril gear
cannot be repaired at all.
`--ablate repair` costs the bot 8 days of median life (45 instead of 53) and 33 points of survival at
day 50 (30% instead of 63%), a clear loss (in 1.0 it was 4.5 days, a small loss).

**Tuning notes.** Wear and repair cost are the sinks for bars after the first sets are made. With free
night repairs only the materials count (35% of the bars for a full repair), and the real limit is having
bars of the item's grade or higher: late in a run the map's mythril is gone, so mythril gear can no longer
be repaired and wears out. Raising `durabilityLoss` (for example to 8–12) makes repairs a real drain on
bars; raising `materialFraction` makes new gear relatively cheaper than repairs. `timeFraction` only
matters for daytime repairs now.

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

**Worked example.** Elite Ogre on day 6 (damage 8 × 1.15 = 9.2) with High Piercing (25) vs adventurer
defense 18.9 (no pierce resistance): effective defense = 18.9 × 0.75 = 14.175; physical =
9.2 × (1 − 0.14175) = **7.90**.

**Tuning notes.** The best possible gear defense is 63% (mythril S set) and there are no defense rings, so
the cap is currently never reached. It only matters if slot defense values or multipliers go up. Enemy
defense is 20% for every tier (no daily growth).

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
resistance (40): 67 × 0.6 = 40.2% of its 20 defense ignored → effective defense 11.96, physical damage
×0.880 instead of ×0.80 (**+10%**).
Defending: a Pierce resistance ring S (10) + diamond S chest (15) = 25% against High Piercing (25):
25 × 0.75 = 18.75% of your defense ignored instead of 25%. With a steel C set (30.8 defense) that changes
damage taken from ×0.769 to ×0.750, only 2.5% less.

**Tuning notes.** Enemy defense (20% for every tier) caps what adventurer piercing can win: at most +25%
physical damage (all 20 points ignored), so a diamond sword is a mid-ranked gem (fourth of five at C in
section 7) and Piercing rings test at +1.3 to +1.4 points. Raising enemy defense (all tiers or one) would
make piercing matter more. The reverse is weak too: enemy Piercing ignores at most a quarter of your
defense, so pierce resistance protects very little (pierce resistance rings test at +0.4 to +0.8 points).
Raising the enemy Piercing values would make diamond armor and the ring matter.

### 10.5 Magic damage and magic resistance

**Formula.** `magic damage = attacker.damage × magicPct/100 × (1 − min(defender.magicRes, 75)/100)`.
Magic ignores defense and piercing. Cap: `CONFIG.combat.resistCap` = 75.

- Adventurer magicPct = ruby sword (5–15) + Magic damage rings (3–7), based on the *sword's* damage
  (unarmed: 4). Enemy magic resistance (`magicRes`) = 0 / 15 / 30.
- Enemy magicPct (`magical`) = 10 / 20 / 30 % of its damage. Adventurer magic resistance = ruby armor
  (4–15 per piece) + Magic resistance rings (3–7).

**Worked example.** Iron B sword (18) + ruby C (8%) vs an elite (defense 20) with Low magic resistance (0):
18 × 0.08 = **1.44** magic per hit on top of 18 × (1 − 0.20) = 14.4 physical = 15.84 total.

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
the moment a fighter would have died (in Appendix B's setup, a sapphire C sword wins 62.2% against Low
Slow resistance but 51.8% and 50.0% against Normal and High). To soften Chilling, lower its values or
`slowDuration`.

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
matched the actual win rate within about 1.5–2.5 points up to day 60, slightly on the pessimistic side
(95.5% estimated vs 98.0% won on days 41–50, 81.8% vs 83.2% on days 51–60; Balance targets section); the
6 fights after day 60 are too few to judge.

**Tuning notes.** More `samples` = better coverage of hidden attributes (with enemy scouting at its 10%
base, about 11 of 12 attributes are guesses). More `fightsPerLoadout` = the simulated gear choice matches
the real one (which uses 200) more often. With only 30 fights per loadout the estimate is slightly
pessimistic when many loadouts are packed. These numbers only affect UI speed and accuracy, not
difficulty. The balance tool's bot estimates all 7 roster enemies every day, which is why a 40-seed bot
run takes about 2–3 minutes.

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
80.5–90.3% / 69.6–83.8%, damage per hit 15.4–15.8 / 8.5–10.7, attacks every 1.94 s / 1.90–2.11 s,
expected damage per second 6.41–7.39 / 2.80–4.69, HP 100 / 82.8–101.2, rough time to win 11–16 s and to
lose 21–36 s.

---

## 12. Enemies

### 12.1 Tiers and the daily roster

| Tier | Per roster | Base HP | Base damage | Defense | Low / Normal / High attributes | Score | Ring grades |
|---|---|---|---|---|---|---|---|
| Normal | 2 | 80 | 8 | 20 | 6 / 6 / 0 | 10 | D–B |
| Elite | 3 | 80 | 8 | 20 | 3 / 6 / 3 | 25 | C–A |
| Champion | 2 | 80 | 8 | 20 | 0 / 6 / 6 | 50 | B–S |

Config: `CONFIG.enemies.tiers.<tier>.{count, hp, damage, defense, levels, score}`. The level counts must
add up to 12 (the number of attributes). **All three tiers share the same base HP, damage and defense**
(user decision, commit 1e53a91: champions should not have higher HP, damage or defense than elites or
normals, because win rates against them were too low; elites were 80 / 9 / 25 and champions 90 / 10 / 30).
The tiers now differ only by their attribute levels, their score and their ring grades
(`CONFIG.rings.gradeWeights`, section 13). Each morning a new roster of 7 is generated for the *next*
day's fight (the player picks one that evening). Names come from `CONFIG.enemies.names` (a duplicate within a
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

| Day | HP/damage × | Ratings × | HP / damage (every tier) | Accuracy & dodge |
|---|---|---|---|---|
| 2 | 1.03 | 1.01 | 82.4 / 8.24 | 101 |
| 5 | 1.12 | 1.04 | 89.6 / 8.96 | 104 |
| 10 | 1.27 | 1.09 | 101.6 / 10.16 | 109 |
| 15 | 1.42 | 1.14 | 113.6 / 11.36 | 114 |
| 20 | 1.57 | 1.19 | 125.6 / 12.56 | 119 |
| 30 | 1.87 | 1.29 | 149.6 / 14.96 | 129 |
| 40 | 2.17 | 1.39 | 173.6 / 17.36 | 139 |
| 50 | 2.47 | 1.49 | 197.6 / 19.76 | 149 |
| 60 | 2.77 | 1.59 | 221.6 / 22.16 | 159 |
| 80 | 3.37 | 1.79 | 269.6 / 26.96 | 179 |

Growth is linear: HP and damage double by about day 35 and triple by day 68. Because both HP and damage
grow, the enemy's "threat" (HP × damage) grows with the square: ×4 by day 35. Since the base numbers are
the same for every tier, the tiers differ only through their attributes: a normal has 6 Low attributes, so
a typical normal is weaker than this row (HP Low = 90%, Accurate Low = 80, ...), and a champion has 6 High
ones, so a typical champion is stronger (HP High = 110%, Accurate High = 120, ...).

**Worked example.** Elite "Ogre" on day 6 with HP Normal, Accurate Normal, Evasion High:
×1.15 / ×1.05 → HP 80 × 1.15 = **92**, damage 8 × 1.15 = **9.2**, accuracy 100 × 1.05 = **105**,
dodge 120 × 1.05 = **126**, defense 20.

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

**Tuning notes.** Appendix B shows how much each attribute swings a fight. HP, Accurate and Magical are
the biggest; Fast, Chilling and Evasion next; Stunning is mild. Piercing is lumpy: in Appendix B's setup
its Low − High swing is 16.8 points on day 24 but between about 3 and 18 on days 20–26, because a few
points of the adventurer's defense only matter when they change how many hits it survives. With equal
base stats the attribute levels are now the only thing that separates the tiers. The defensive attributes
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
rings), its grade comes from the tier's weights. No ring on a loss or draw. Smith rings apply at once but
can only be changed at the start of a day (8:00 at camp, before the first action) or while planning at night. Adventurer rings are chosen in the nightly plan (max 10); wearing or removing an
adventurer ring on the Rings tab only changes the default selection for tonight's plan, never today's fight.

| Ring | Owner | D / C / B / A / S | Effect (where it goes in the formulas) |
|---|---|---|---|
| Travel | smith | 5 / 6 / 7 / 8 / 10 | % less travel time (all trips) |
| Quick search | smith | 5 / 6 / 7 / 8 / 10 | % less search time |
| Thorough search | smith | 10 / 12 / 14 / 16 / 20 | % more searched per search (multiplies the 35% average; the ± 5 spread stays) |
| Ore sight | smith | 3 / 4 / 5 / 6 / 7 | points added to the ore sight chance |
| Refining | smith | 5 / 6 / 7 / 8 / 10 | % less refining **and** cutting time |
| Bar luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on bars |
| Gem luck | smith | 2 / 3 / 4 / 5 / 6 | % upgrade luck on gems (on top of the gem's novice → master table) |
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
24 (base 51.4%; power report, ±1–2 points of noise):

| Ring | One B ring | One S ring |
|---|---|---|
| Health | +7.5 | +9.6 |
| Speed | +5.3 | +6.1 |
| Magic damage | +4.3 | +7.8 |
| Dodge | +4.2 | +5.3 |
| Slow resistance | +3.8 | +4.6 |
| Accuracy | +2.2 | +2.6 |
| Magic resistance | +1.6 | +2.7 |
| Piercing | +1.3 | +1.4 |
| Stun resistance | +0.9 | +1.6 |
| Pierce resistance | +0.4 | +0.8 |

All 10 adventurer ring types at grade B together: +27.3 points.

**Tuning notes.** `duplicateFactor` decides whether stacking one type is worthwhile (0.5 = a second copy
is worth half). Grade weights set how fast ring power grows with fight difficulty; champion fights are the
only source of S rings. A level-10 skill equals a C-grade smith ring of the same kind (section 14), so
B-to-S smith rings still beat a maxed skill; adventurer rings have no skill counterpart. In the bot runs
removing rings clearly hurts (`--ablate rings`: median life 42.5 instead of 53, 18% alive at day 50
instead of 63%, mean score 683 instead of 1,192, and only 4.1 champion wins per run instead of 14.0). Since
the careful bot fights champions on most mid-game days, their B–S rings are a large part of its power.
Gem luck rings upgrade cut gems on top of the gem's novice → master table (section 5); unlike Bar luck,
they have no matching skill any more (the gem grade skill blends the table instead).
Pierce resistance and Stun resistance are near-dead picks (see 10.4 and 10.6).

---

## 14. Skills

| Number | Config path | Value |
|---|---|---|
| Max level | `CONFIG.skills.maxLevel` | 10 |
| XP curve base | `CONFIG.skills.xpBase` | 100 |
| XP per item (material skills) | `CONFIG.skills.xpPerItem` | copper 25, iron 25, steel 30, mythril 50; ruby 25, topaz 25, sapphire 30, emerald 40, diamond 50 |
| Activity skills | `CONFIG.skills.activity.<key>.perLevel` | see table |
| Material skills | `CONFIG.skills.perMaterial.<key>.perLevel` | bar grade 0.3, failure 0.5 (refining and cutting), gem grade 10 |

**Formula** (`xpToNext`, `addXp`, `skillBonus`, `itemXp` in `js/core/skills.js`):

```
XP to go from level L to L+1 = xpBase × (L + 1)          bonus = perLevel × level
activity skills: XP = actual minutes spent (after time reductions)
                 except Debris clearing: XP = points of debris cleared (1 per point)
material skills: XP = xpPerItem[material] per item refined/cut of that type (failures count);
                 both the grade and the failure skill of that material get the XP
```

`xpPerItem` may also be a single number for all materials. Several levels can be gained at once; XP stops
at level 10.

**Cumulative XP, and items needed per material:**

| Level | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 |
|---|---|---|---|---|---|---|---|---|---|---|
| Total XP (= minutes for activity skills, debris points for Debris clearing) | 100 | 300 | 600 | 1,000 | 1,500 | 2,100 | 2,800 | 3,600 | 4,500 | 5,500 |
| Copper, iron, ruby, topaz (25 XP) | 4 | 12 | 24 | 40 | 60 | 84 | 112 | 144 | 180 | 220 |
| Steel, sapphire (30 XP) | 4 | 10 | 20 | 34 | 50 | 70 | 94 | 120 | 150 | 184 |
| Emerald (40 XP) | 3 | 8 | 15 | 25 | 38 | 53 | 70 | 90 | 113 | 138 |
| Mythril, diamond (50 XP) | 2 | 6 | 12 | 20 | 30 | 42 | 56 | 72 | 90 | 110 |

**Skills and bonuses:**

| Skill | Per level | At level 10 | XP from | Applies to |
|---|---|---|---|---|
| Return travel | 0.6 | 6% | minutes travelling to camp | travel time on trips ending at camp (adds to the Travel ring) |
| Search speed | 0.6 | 6% | minutes searching | search time (adds to Quick search ring) |
| Search efficiency | 1.2 | 12% | minutes searching | efficiency multiplier (adds to Thorough search ring) |
| Debris clearing | 10 | +100% (×2) | 1 per point of debris cleared | debris cleared per point of search effort (no ring counterpart; section 3.4) |
| Refining speed | 0.6 | 6% | minutes refining | refining time (adds to Refining ring) |
| Cutting speed | 0.6 | 6% | minutes cutting | cutting time (adds to Refining ring) |
| Copper / Iron / Steel / Mythril bar grade (4 skills) | 0.3 | 3% | XP per bar of that type | upgrade luck for that bar (adds to Bar luck ring) |
| Copper / Iron / Steel / Mythril refining (4 skills) | 0.5 | 5 points | XP per bar of that type | failure → D for that bar |
| Ruby / Topaz / Sapphire / Emerald / Diamond grade (5 skills) | 10 | 100% (the master table) | XP per gem of that type | % of the way from the novice to the master cutting table for that gem (no ring counterpart; section 5) |
| Ruby / … / Diamond cutting (5 skills) | 0.5 | 5 points | XP per gem of that type | failure for that gem (novice 15% minus this; section 5) |

**A level-10 skill equals a C-grade ring of the same kind** (Travel C 6%, Quick search C 6%, Thorough
search C 12%, Refining C 6%, Bar luck C 3%; the Help and Skills tabs show this per skill). Two caveats:
Return travel only counts on trips that end at camp, so it is worth about half a Travel ring; and one
Refining ring covers both refining and cutting, which take two skills. Skills with no ring: Debris clearing
(+10% clearing power per level, twice the power at level 10), the refining failure skills (0.5 points per
level, −5 points at level 10, i.e. half of the 10% failure chance moves to D), the cutting failure skills
(0.5 points per level: gem failure 15% → 10%) and the gem grade skills (10% of the way from the novice to
the master table per level). Gem luck rings still exist and upgrade on top of the gem table. A gem's grade
and cutting skills always get the same XP, so they level together (section 5).

**Worked examples.** One 30-minute search gives 30 XP to both Search speed and Search efficiency; level 10
needs 191 searches (5,524 minutes ≈ 9.2 full days of nothing but searching; a few more than 5,500 / 30
because searches get faster as the skill grows and XP = minutes). Refining 60 mythril ore (failures count)
gives 3,000 XP: Mythril bar grade and Mythril refining reach level 7 = +2.1% upgrade luck and −3.5 failure
points. Cutting 60 rubies gives 1,500 XP: Ruby grade and Ruby cutting reach level 5, the halfway table
(F 12.5, D 32.5, C 25, B 16, A 9.5, S 4.5). Clearing one 40-thick debris cell gives 40 Debris clearing XP,
so level 1 (+10%) comes after two or three debris cells and level 3 (+30%, 600 XP) after about 15. A
field holds about 380 debris points, cleared over its ~35 searches, so a searcher working through whole
fields reaches level 3 after about 55 searches and level 5 after about 140 (a map holds about 7,550 debris
points, level 10 needs 5,500).

**What the bot reaches** by the end of a run (about day 53, mean levels): activity skills from 6 to 9
(search speed and efficiency 8.9, debris clearing 8.7, cutting 8.1, refining 6.9, return travel 6.3) and
material skills from 2.4 (mythril) to 5.8 (emerald); the gem skills are 3.1 (topaz) to 5.8 (emerald), so
its gems end about halfway to the master table. Its smith bonuses at the end (rings + skills):
search efficiency +29.1%, search time −14.2%, refining −11.9%, cutting −12.6%, travel −8.1% (plus −3.8% on
the way home), debris clearing power +87%.

**Tuning notes.** `xpBase` scales every skill's pace; `xpPerItem` sets the material skills' pace (rarer
materials give more XP per item because there are fewer of them). `perLevel` is set so that level 10
matches a C-grade ring (change the ring's C value and the skill together to keep that rule; the Help tab
says "equals a C-grade ring" only while every matched skill is exact). The Debris clearing skill is the
exception in size (+10% per level) and gets its XP quickly early on (see the worked example); lower its
`perLevel` if clearing should stay slow for longer (the XP, 1 per point cleared, is fixed in `search`).
`gemGrade.perLevel` sets how many cuts reach the master table (10 = level 10). In the bot runs removing
skills costs 3.5 days of median life (49.5 instead of 53), 8 points of survival at day 40 (70% instead of
78%) and 130 points of mean score (`--ablate skills`): without them 6.3% of the search effort goes into
debris instead of 3.9% and gems stay on the novice table (F / D / C or better 16 / 44 / 40% instead of 13
/ 34 / 53%). In 1.0 the loss was 7.5 days and 165 points.

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
noise for survival (median life 52 instead of 53), because the win-chance estimate already averages over
the hidden attributes; its mean score fell from 1,192 to 1,065, a gap of the same size as in 1.0 (1,212 vs
1,323), so intel may help the score a little (fewer champion fights without it). Lower the scouting
bases to make planning riskier; raise them to make the roster easier to read.

---

## 16. Score

| Number | Config path | Value |
|---|---|---|
| Points per win | `CONFIG.enemies.tiers.<tier>.score` | normal 10, elite 25, champion 50 |

**Formula.** Score = sum of points for every enemy defeated. A draw gives 0. A loss ends the run. The best
score is kept in the browser (localStorage) across new games.

**Worked example.** 10 days of fights: 4 normal, 5 elite, 1 champion = 40 + 125 + 50 = **215**.

**Tuning notes.** Champion = 5 normals. Since all tiers share the same base stats (session 4), a champion
is a fair fight for good gear: the careful bot's best estimate against a champion on its roster is 95–99%
on days 7–30 (it was 55–77% on days 7–30 with the old 90 / 10 / 30 champions), so it takes a champion on
about 70% of days 11–30, wins 14.0 per run (0.3 with the old champions) and scores 1,192 on average (777
with the old champions; 1,323 in 1.0 on the same 40 seeds, 3% apart over 120 seeds). Champions are still a
real risk early and late (the bot's best champion estimate is 35% on day 2, 77% on day 3, 75% on day 40
and 34% on day 50). If champions
should be a rarer, riskier pick again without touching base stats, lower this score, lower their ring
grades (`CONFIG.rings.gradeWeights.champion`) or widen the High attribute values (12.3). `--minwin` and
`--future` let the bot test riskier or safer play.

---

## Appendix A — Power curve snapshot

Win % of a loadout against a typical enemy of each tier (all attributes hidden, 100 attribute guesses ×
50 fights per cell; 200 guesses for the day-2 table). Generated with `node tools/balance.mjs --section power`
(deterministic: the same config always prints the same numbers; re-run for 1.1 and identical to 1.0, since
combat, enemies and gear did not change).

**Day-2 fight with day-1 gear** (target: normal 85–98%, elite 50–75%, champion 15–40%)

| Day-1 loadout | vs normal | vs elite | vs champion |
|---|---|---|---|
| Copper D sword | 65.5 | 26.2 | 4.2 |
| Copper C sword | 80.1 | 42.6 | 9.2 |
| Copper C sword + C boots | 91.0 | 59.1 | 19.1 |
| Copper C sword + C chest | 85.6 | 46.5 | 10.9 |
| **Copper C sword + C chest + C boots** (reference) | 92.8 | 63.5 | 21.9 |
| Copper D sword + D helmet + D gloves | 75.6 | 33.5 | 5.5 |
| Copper B sword + B chest + B boots | 98.0 | 80.3 | 39.9 |
| Copper C sword + ruby C + C boots | 96.3 | 74.1 | 33.4 |
| Copper C full set (lucky day 1) | 97.7 | 78.1 | 37.1 |
| Iron C sword + copper C boots | 99.8 | 96.7 | 80.8 |

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

**vs Elite** (base HP 80, damage 8, defense 20%, as for normals; 3 Low / 6 Normal / 3 High attributes)

| Loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Copper D sword only | 27.3 | 9.0 | 0.6 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper D full | 61.7 | 32.1 | 4.8 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper B full | 90.4 | 64.2 | 23.7 | 4.2 | 0.6 | 0 | 0 | 0 | 0 | 0 |
| Iron C full | 99.9 | 98.2 | 83.4 | 46.8 | 17.1 | 0.3 | 0 | 0 | 0 | 0 |
| Steel C full | 100 | 99.9 | 99.3 | 93.5 | 73.9 | 16.8 | 2.1 | 0.1 | 0 | 0 |
| Mythril C full | 100 | 100 | 100 | 100 | 100 | 93.6 | 63.2 | 18.7 | 3.6 | 0 |
| Mythril S full | 100 | 100 | 100 | 100 | 100 | 100 | 99.3 | 90.0 | 63.1 | 9.5 |
| Iron C + ruby C sword | 100 | 99.3 | 88.6 | 59.4 | 28.3 | 0.9 | 0.1 | 0 | 0 | 0 |
| Iron C + diamond C sword + emerald C armor | 100 | 99.6 | 92.8 | 69.4 | 39.4 | 3.7 | 0.2 | 0 | 0 | 0 |
| Steel C + ruby C sword + 10 C rings | 100 | 100 | 100 | 99.3 | 95.5 | 50.0 | 12.2 | 0.7 | 0 | 0 |
| Mythril C + ruby B sword + 10 B rings | 100 | 100 | 100 | 100 | 100 | 99.7 | 92.8 | 60.0 | 23.1 | 1.0 |
| Ceiling | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 99.8 | 98.5 | 73.5 |

**vs Champion** (base HP 80, damage 8, defense 20%, as for normals; 6 Normal / 6 High attributes)

| Loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Copper D sword only | 4.0 | 0.4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper D full | 19.0 | 4.3 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| Copper B full | 57.8 | 21.7 | 3.8 | 0.3 | 0 | 0 | 0 | 0 | 0 | 0 |
| Iron C full | 96.8 | 86.2 | 47.9 | 11.6 | 2.3 | 0 | 0 | 0 | 0 | 0 |
| Steel C full | 99.9 | 99.5 | 95.0 | 70.7 | 32.1 | 2.7 | 0.1 | 0 | 0 | 0 |
| Mythril C full | 100 | 100 | 100 | 99.8 | 97.9 | 71.5 | 20.6 | 2.5 | 0.1 | 0 |
| Mythril S full | 100 | 100 | 100 | 100 | 100 | 99.4 | 90.2 | 58.6 | 20.9 | 0.8 |
| Iron C + ruby C sword | 98.7 | 89.7 | 57.2 | 19.9 | 5.2 | 0.1 | 0 | 0 | 0 | 0 |
| Iron C + diamond C sword + emerald C armor | 99.1 | 94.4 | 68.0 | 29.2 | 8.9 | 0.4 | 0 | 0 | 0 | 0 |
| Steel C + ruby C sword + 10 C rings | 100 | 100 | 99.2 | 93.6 | 70.1 | 13.9 | 1.3 | 0 | 0 | 0 |
| Mythril C + ruby B sword + 10 B rings | 100 | 100 | 100 | 100 | 99.9 | 94.7 | 64.9 | 18.7 | 3.2 | 0.1 |
| Ceiling | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 98.4 | 87.2 | 34.1 |

**Weakest plain full set (no gems, no rings) that keeps a target win rate**

| Day | Normal ≥ 90% | Elite ≥ 70% | Champion ≥ 50% |
|---|---|---|---|
| 2 | copper D (91%) | copper B (89%) | copper B (57%) |
| 3 | copper B (98%) | copper B (86%) | iron D (87%) |
| 5 | copper B (93%) | iron D (94%) | iron D (69%) |
| 7 | iron D (99%) | iron D (89%) | iron D (57%) |
| 10 | iron D (94%) | iron C (82%) | iron B (67%) |
| 12 | iron C (95%) | iron B (83%) | iron A (66%) |
| 15 | iron B (93%) | iron A (81%) | steel C (69%) |
| 20 | steel C (95%) | steel B (83%) | steel A (71%) |
| 25 | steel B (90%) | steel A (78%) | mythril D (73%) |
| 30 | mythril D (98%) | mythril D (81%) | mythril C (71%) |
| 40 | mythril C (93%) | mythril B (78%) | mythril A (61%) |
| 50 | mythril A (93%) | mythril S (91%) | mythril S (58%) |
| 60 | mythril S (94%) | none (mythril S 63%) | none (mythril S 23%) |
| 70 | none (mythril S 73%) | none (mythril S 35%) | none (mythril S 6%) |
| 80 | none (mythril S 43%) | none (mythril S 11%) | none (mythril S 0%) |

Reading it: with the shared base stats the elite column now trails the progression target by about 5 days
(copper B on days 2–3, iron day 5–15, steel day 20–25, mythril day 30+, against a target of iron day 5–8,
steel day 12–18, mythril day 25+), so gear made on pace beats elites with room to spare. The champion
column (a 50% target) asks for one grade or material step more than the elite column on the same day (for
example steel C instead of iron A on day 15, mythril D instead of steel A on day 25). Gems (especially a
ruby or sapphire sword) and rings add a lot on top (sections 7 and 13).

## Appendix B — How much each enemy attribute matters

Steel C full set (no gems, no rings) vs an elite on day 24, the day the power report uses for its gem,
ring and slot tables (it moved from day 20 when elites lost their extra damage and defense: on day 20 this
set now wins 69% against an all-Normal elite, leaving little room above). All attributes Normal except the
one listed (20,000 fights each, the same random numbers for every cell). Baseline (all Normal): **45.5%**
win.

| Attribute | Low | Normal | High | Low − High |
|---|---|---|---|---|
| HP | 61.2% | 45.5% | 27.1% | 34.1 |
| Accurate | 64.3% | 45.5% | 32.2% | 32.1 |
| Magical | 63.9% | 45.5% | 36.9% | 27.0 |
| Fast | 54.0% | 45.5% | 33.6% | 20.4 |
| Chilling | 53.6% | 45.5% | 35.3% | 18.3 |
| Evasion | 54.2% | 45.5% | 36.0% | 18.2 |
| Piercing | 57.0% | 45.5% | 40.2% | 16.8 (lumpy: about 3–18 on days 20–26) |
| Stunning | 48.8% | 45.5% | 41.7% | 7.1 |
| Pierce res., Magic res., Stun res., Slow res. | 45.5% | 45.5% | 45.5% | 0 (no matching gear) |

Defensive attributes against a matching C sword gem (same set, same day):

| Sword gem | vs attribute | Low | Normal | High |
|---|---|---|---|---|
| Diamond C | Pierce resistance | 49.2% | 47.0% | 45.9% |
| Ruby C | Magic resistance | 57.3% | 51.8% | 47.9% |
| Emerald C | Evasion | 59.7% | 52.7% | 45.6% |
| Sapphire C | Slow resistance | 62.2% | 51.8% | 50.0% |
| Topaz C | Stun resistance | 52.7% | 49.0% | 47.2% |

## Appendix C — Worked fight, start to finish

Adventurer: iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots
(damage 18, accuracy 128, dodge 111, defense 18.9, speed 3.3%, magic 8%, HP 100).
Enemy: elite Ogre, day 6; Piercing High, Pierce res Normal, Magical Normal, Magic res Low, Stunning Low,
Stun res Normal, Accurate Normal, Evasion High, Chilling Low, Slow res Normal, Fast Normal, HP Normal
(HP 92, damage 9.2, accuracy 105, dodge 126, defense 20).

| Step | Adventurer → Ogre | Ogre → Adventurer |
|---|---|---|
| Hit chance | 128² / (128² + 0.25 × 126²) = 80.5% | 105² / (105² + 0.25 × 111²) = 78.2% |
| Piercing | none | 25 × (1 − 0) = 25% |
| Effective defense | 20% | 18.9 × 0.75 = 14.175% |
| Physical per hit | 18 × 0.80 = 14.4 | 9.2 × 0.858 = 7.90 |
| Magic per hit | 18 × 8% × (1 − 0) = 1.44 | 9.2 × 20% × (1 − 0) = 1.84 |
| Total per hit (before the 90–110% roll) | 15.84 | 9.74 |
| Attack every | 2 / 1.033 = 1.94 s | 2.0 s |
| Expected damage per second | 0.805 × 15.84 / 1.936 = 6.59 | 0.782 × 9.74 / 2 = 3.80 |
| Time to win | 92 / 6.59 ≈ 14.0 s | 100 / 3.80 ≈ 26.3 s |
| Side effects | none | 5% stun chance per hit (1.0 s); every hit slows the adventurer 10% for 2.0 s (≈ 0.18 s delay each) |

Simulated with the attributes known: **99.0%** win (50,000 fights on each of three seeds: 98.9–99.0%),
average fight about 15.9 s. (With the old elite base of damage 9 and defense 25 the same fight was 92.7%.)
