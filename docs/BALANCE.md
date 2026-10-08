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
  supply numbers, `--section bot --seeds 40` for the bot results, `--section specials` for the enemy
  specials and `--section estimator` for the win-chance estimate's accuracy, `--section benchmark` for the
  survival curve in `docs/BENCHMARKS.md`). Appendix B and C come from direct `fight()` simulations
  (10,000–50,000 fights each). Rerun the tool after any change; see
  [Balance targets and current results](#balance-targets-and-current-results). All numbers here match the
  config of **version 1.2** (session 6: features in commit e446ef7, balance in cd61042, then the review fixes:
  durability kept to one decimal, the estimate's margin of error, Estimate-all cancellation, enemy
  Magical 10 / 15 / 25 and ruby sword 6-18, save key v3). It changed, against 1.1: durability about 10% a
  fight and the Gear care skill, the four enemy specials and their gems and rings, sword damage 16 and
  unarmed damage 11, enemy defense 25% and growth 3.5%, +2 minutes per fresh search cell, the 10 × 10
  win-chance estimate with Battle simulation intel and Foresight rings. Field generation, refining and
  cutting, rings other than the retuned ones, the hit-chance curve and the economy of carrying are as in 1.1
  (all enemy tiers share base HP 80 and damage 8 since commit 1e53a91).
- **Grade order.** Like the game, outcome tables list grades from lowest to highest, left to right:
  Fail, D, C, B, A, S.

---

## Quick levers

These are the knobs with the biggest effect on difficulty and pacing, roughly in order of impact.

| Lever | Config path | Now | Raise it | Lower it |
|---|---|---|---|---|
| Enemy HP and damage growth per day | `CONFIG.enemies.growthPerDay.hpDamage` | 3.5 (+3.5%/day, linear; 1.1: 3) | Late game gets hard sooner, runs get shorter (3 instead of 3.5: median life +5 days on 200 benchmark seeds) | Longer runs, gear stays useful longer |
| Enemy accuracy/dodge growth per day | `CONFIG.enemies.growthPerDay.ratings` | 1 (+1%/day) | Enemies hit you more and dodge more late on | Accuracy/dodge gear keeps its value longer |
| Enemy tier base stats | `CONFIG.enemies.tiers.<tier>.hp / damage / defense` | 80 / 8 / 25 for every tier (user decision: champions are no tougher than elites or normals in base stats; defense 20 → 25 in 1.2) | Every fight harder from day 2 | Easier start |
| Enemy attribute spread and the four specials | `CONFIG.enemies.attributes.<key>.values`, `CONFIG.enemies.stunDuration / slowDuration` | see 12.3: Magical 10/15/25, Piercing 10/25/60, Stunning 5/15/35 (1.5 s), Chilling 10/20/40 (2.5 s), resistances 0/20/40 | Low/High further apart: tiers differ more (attribute levels are the only difference between them), scouting matters more; a special at High costs a mid-game set 11-20 win points | Tiers closer together, specials matter less |
| Damage scale | `CONFIG.gear.slots.sword.stats.damage`, `CONFIG.adventurer.unarmedDamage` | sword 16, unarmed 11 (1.1: 10 and 4; user decision: an unarmed adventurer beats a day-2 normal 50-65%: 62%) | Fights end sooner, gear matters less per point | Fights last longer, unarmed day 2 is lost |
| Material power | `CONFIG.gear.materialMult` | copper 1, iron 1.5, steel 2, mythril 3 | Bigger jump per material tier | Flatter curve, grades matter more |
| Grade power | `CONFIG.gear.gradeMult` | D 1.0 … S 1.5 | Lucky refines matter more | Material matters more than luck |
| Refining luck | `CONFIG.refine.<bar>.dist` | F 10, D 30–45 | More weight on D/F: slower gear progress | More weight on S/A/B: faster gear progress |
| Gem cutting | `CONFIG.cut.<gem>.novice / master`, `CONFIG.skills.perMaterial.gemGrade.perLevel` | novice F 15 / D 45 / C 25 / B 10 / A 4 / S 1 → master F 10 / D 20 / C 25 / B 22 / A 15 / S 8; 10% of the way per grade-skill level | More weight on B–S: better gems (sooner, with a higher perLevel) | Gems weaker, practice matters more |
| Mythril supply | `CONFIG.field.oreWeights` (mythril column) | 0 / 0 / 0 / 5 by distance (only distance 4+; about 13–14 per map) | Mythril gear arrives earlier and the finite map holds more | Mythril stays rare |
| Coal supply (steel) | `CONFIG.field.oreWeights` (coal column) | 0 / 5 / 15 / 20 (about 122 per map) | Steel arrives earlier and lasts longer | Steel later |
| Field richness | `CONFIG.field.lootChance`, `CONFIG.field.itemCountWeights` | 50% +5/step, max 80%; 1/2/3 items weighted 30/40/30 (avg 2.0) | More ore per search and a bigger map (about 1,540 items now) | Scarcer, more travel, the map runs out sooner |
| Field regrowth | `CONFIG.field.regrowPctPerDay` | 0 (off: fields do not regrow) | Searched cells refill (5 = about 77 items a night on a fully searched map), so the map no longer caps a run | Already off: the map is a finite supply |
| Search speed | `CONFIG.field.searchEfficiency`, `CONFIG.field.searchRandomness`, `CONFIG.field.searchMin`, `CONFIG.field.freshCellMin` | 35% ± 5 per cell per search (about 3 searches per cell), 30 min + 2 min per fresh (never-searched) cell (126 min more per fully searched field; v1.2) | Faster gathering, efficiency bonuses matter less (a bigger `freshCellMin` makes breadth dearer) | Slower gathering |
| Debris and boulders | `CONFIG.field.debrisChance`, `CONFIG.field.debrisAmount`, `CONFIG.field.boulders` | 15% of cells, 20–60 thick (search effort); 1 boulder per field | More search effort goes into clearing (about 5% now), fewer searchable cells | Faster gathering |
| Processing times | `CONFIG.refine.<bar>.minutes`, `CONFIG.cut.<gem>.minutes` | 15 / 20 / 25 / 30, gems 20 | Less of the day left for mining | More gear per day |
| Travel cost | `CONFIG.map.travelMinPerStep` | 20 min/step | Far (rich) fields cost more of the day | Far fields become the default |
| Bag size | `CONFIG.bag.slots` | 20 (carried per trip; finds wait in the field's pile) | Fewer trips home | More trips home (nothing is lost: the rest waits in the pile), far fields less attractive |
| Adventurer HP | `CONFIG.adventurer.hp` | 100 | Survives longer in every fight | Fights get swingier |
| Hit-chance curve | `CONFIG.combat.hitK` | 0.25 | Everyone misses more; accuracy gear matters more | Hits land more; dodge matters less |
| Gear wear | `CONFIG.gear.durabilityLoss`, `CONFIG.skills.activity.gearCare` | 8–12% per fight (avg 10) x 1.0 / 1.1 / 1.2 by enemy tier, minus 1% per Gear care level (1.1: 3–7%) | More repair work, more bars spent, mythril upkeep bites sooner | Gear lasts longer |
| Win-chance estimate size | `CONFIG.sim.samples / evalFights / fightsPerLoadout`, Battle simulation intel, Foresight rings | 10 guesses x 10 test fights per enemy (1.1: 40 x 30); +10, +9, ... per intel point; +2…+6 per Foresight ring | Steadier estimate (margin ± 13 → ± 9 at 20 x 20), slower | Noisier, more risk to plan with |
| Repair cost | `CONFIG.gear.repair.materialFraction` | 35% of the bars | Repairs eat into bar supply | Repair is almost free |
| Ring quality | `CONFIG.rings.gradeWeights` | see Rings | Shift weight to higher grades: faster ring power growth | Shift weight down: slower |
| Intel pace | `CONFIG.intel.daysPerPoint` | 5 days per point | Slower intel, more hidden attributes, more risk | Faster intel, fewer surprises |
| Starting scouting | `CONFIG.intel.tracks.enemySight.base` | 10% | Fewer surprises in fights | More hidden attributes, more risk |
| Day length | `CONFIG.time.dayStartMin / dayEndMin` | 8:00–18:00 (600 min) | Longer day: more work per fight, easier | Shorter day: harder |
| Skill strength | `CONFIG.skills.activity.<key>.perLevel`, `CONFIG.skills.perMaterial.<key>.perLevel` | 0.6 / 1.2 per level (time / search efficiency; level 10 = a C-grade ring); bar grade 0.3, fail 0.5; debris clearing +10% power per level; gem grade 10% of the novice → master blend per level; Gear care 1% less wear per level | Skills outgrow rings | Skills become a small extra |
| Champion reward | `CONFIG.enemies.tiers.champion.score` | 50 (normal 10, elite 25) | Champions even more attractive (the careful bot already takes one on about 60% of days 11–30) | Fewer champion picks; safe play dominates |

**What the current numbers produce (details in the next section and Appendix A):** all three enemy tiers
share the same base HP, damage and defense (80 / 8 / 25%), so they differ only by attribute levels, score
and ring grades. With no gear at all the adventurer beats a typical normal enemy on day 2 in 62% of fights
(elites 20%, champions 2%). A copper C sword + chest + boots made on day 1 wins about 100% of day-2 normal
fights, 94% of elite fights and 65% of champion fights. A full iron C set stays at 90%+ against normals until
about day 15; steel C until day 20, mythril C until day 40, mythril S until day 60. Against elites the 70% line
falls at day 15 for iron C, day 20 for steel C, day 40 for mythril C and day 60 for mythril S. Enemy growth is
linear (+3.5% a day) and never stops while gear tops out at mythril S, so every run ends eventually. That is
intended (endless, score-chasing). The scripted "careful" bot lives a median of 51.5 days (40 seeds; 51.0 on
200 benchmark seeds) and fights a champion on about 60% of days 11–30, for a mean score of about 1,220. Fields
do not regrow, so the map (about 1,540 items, only about 13–14 of them mythril) is the whole supply of a run:
the bot has found 64% of it by day 40 and 84% by day 50 (1.1: 82% and 92%; the fresh-cell time of 1.2 slows
mining about 15%), and coal and mythril run low around day 40–50. With wear at 10% a fight the upkeep of the
last mythril competes with new gear: the immortal bot ends with 2.6 of 5 slots in mythril (1.1: 3.3) and the
gear it has plateaus around day 40–60, so even a perfect player hits the enemy-growth wall around day 60–70
(see "Map supply" below).

---

## Balance targets and current results

### What the tuning aimed for

The targets are written into `tools/balance.mjs` and the tool flags results outside them, except the
win rates with on-pace gear, which are checked by reading the power tables:

| Target | Where the tool checks it | Aim | Now |
|---|---|---|---|
| Win rates with on-pace gear (the user's target, session 4) | `power` section 2: plain C sets late in their material window (iron C day 15, steel C day 20, mythril C day 40: the last day the set holds 70% vs elites) | champion ~30–40%, elite ~60–70%, normal 90%+; erring on the high side (the user wanted higher win rates) | champion 38 / 56 / 30%, elite 76 / 89 / 73%, normal 97 / 99 / 98%. Normals and elites on target or above; champions 30–56% (steel C is above the band). In 1.1 the 70%-vs-elite checkpoints were days 10 / 20 / 30 (iron C / steel C / mythril C): plain sets now last longer because the swords are stronger. The bot's real gear (gems, rings) is above these plain sets (see "Champions" below) |
| Day-2 fight with sensible day-1 gear (a few copper pieces) | `power` section 1 (`DAY2_TARGET`), bot "d2 typical est" | normal 95–100%, elite 75–95%, champion 40–75% (raised in 1.2 with the damage scale; unarmed vs a normal 50–65%) | reference set 100 / 94 / 65 (inside all three); unarmed vs a normal 62%; bot's own day-1 gear 100 / 95 / 76 (champion a point over the band) |
| Material progression (first pieces / 3 of 5 slots) | bot "Progression milestones" (`PROGRESS_TARGET`) | iron day 5–8, steel day 12–18, mythril day 25+ | iron 4 / 7, steel 10 / 13, mythril 18 / 27 (first pieces before the window, 3 of 5 slots inside it; 1.1: 3 / 6, 9 / 11, 16 / 22: about 1–5 days later in 1.2, probably from the slower mining of the fresh-cell time) |
| Weakest plain set that holds a safe win rate | `power` section 3 | the elite ≥ 70% column should follow the progression above | copper D-B days 2–7, iron D-C days 10–15, steel B day 25, mythril D–C days 30–40: about 5–10 days behind the progression, so on-pace gear beats elites with room to spare (more room than in 1.1) |
| Run length for a careful player | bot "median life", `docs/BENCHMARKS.md` | around 50 days, with most deaths from day 40 on (the endless ramp, not early bad luck) | median 51.5 (40 seeds), 50.0 / 51.0 (100 / 200 benchmark seeds); 29 of 40 deaths on day 43 or later, 11 before day 40 (none on day 2, 3 on days 3–9) |
| Every system worth using | `--ablate` runs | removing a system should cost survival or score | rings and gems clearly; repair, skills and intel within noise on survival (see ablations below; repair and skills still show in the bar bill, section 8) |
| Enemy specials (user decision, v1.2) | `specials` section | one special at High instead of Normal costs a plain C set 10–20 win points; the matching armor gem (C, three pieces) + a B ring win back at least half; the adventurer's S sword gem is below the enemy's High value | N → H −11.3 to −14.5 on steel (−11.3 to −20.5 over iron, steel and mythril); recovered 59 / 62 / 82 / 103% on steel (48 / 52 on mythril for magic and piercing); S gems 72–92% of the enemy's High value (section 7) |
| Difficulty of 1.2 against 1.1 | `benchmark` section, `docs/BENCHMARKS.md` | the same: the share of runs alive at each day within noise of 1.1 | 100 seeds: alive d10 / d30 / d50 / d60 94 / 74 / 46 / 13% (1.1: 85 / 73 / 46 / 5%), median 50.0 vs 48.5; 200 seeds: 93 / 75 / 51 / 10% vs 88 / 75 / 50 / 10%, median 51 vs 50: the same, with no day-2 deaths (1.1: 14 of 200) |

There is no target yet for how long the finite map lasts (fields do not regrow); see "Map supply" below.

**All three tiers have the same base HP, damage and defense** (80 / 8 / 25%; user decision in session 4,
commit 1e53a91: "Champions shouldn't have higher HP, damage, or defense than the elites or normals. The
win rate is too low." Elites were 80 / 9 / 25 and champions 90 / 10 / 30; the shared defense was 20% until
1.2). Difficulty comes only from the attribute mix (normal: 6 Low + 6 Normal; elite: 3 Low + 6 Normal + 3
High; champion: 6 Normal + 6 High).

**Champions are the careful bot's main mid-game pick.** The bot takes the enemy with the best
`win% × (points + 1000)` among those estimated at 90%+, so a 50-point champion beats a 10-point normal once
its estimate is within about 4% of the normal's. With gems, rings and the better of the roster's two
champions, its best champion estimate is 95–98% on days 7–30 (table below), so it fights a champion on 52%
of days 6–10, 69% of days 11–20 and 52% of days 21–30, wins 13.8 champions per run and scores 1,219 on
average; the champions' B–S rings feed back into its power. It costs a little safety: 1.6–2.1% of fights are
lost on days 6–10 and 21–30 (0.3% on days 11–20). If champions should be a rarer, riskier pick for a careful
player, the levers are the champion's score (section 16), its ring grades
(`CONFIG.rings.gradeWeights.champion`, section 13) or the High attribute values (section 12.3), not the base
stats, which the user wants equal across tiers.

### What changed from 1.1 to 1.2

Version 1.2 changed fights and planning (durability, specials, damage scale, estimate), and made searching
a little dearer (fresh cells). The first column is the 1.1 result, the second 1.2, both on the same 40 bot
seeds (`--section bot --seeds 40`, the bot's own larger estimate) unless noted; the benchmark rows use the
in-game estimate of each version:

| Measure | 1.1 | 1.2 | Reading |
|---|---|---|---|
| Median life (bot, 40 seeds) | 53.0 | 51.5 | the same within noise |
| Alive day 10 / 20 / 30 / 40 / 50 / 60 | 88 / 85 / 83 / 78 / 63 / 3% | 93 / 90 / 73 / 73 / 58 / 13% | no early deaths; 10 points fewer alive at day 30 on these 40 seeds (4 runs: noise, the 200-seed benchmark has 75% vs 75%) and the same from day 40 |
| Benchmark, in-game estimate, 100 seeds: alive d10 / d30 / d50 / d60, median | 85 / 73 / 46 / 5%, 48.5 | 94 / 74 / 46 / 13%, 50.0 | the same shape (`docs/BENCHMARKS.md`) |
| Deaths on day 2 | 5 of 40 bot runs; 14 of 200 benchmark runs | 0 of 40; 0 of 200 | the unarmed adventurer no longer does 4 damage |
| Mean score | 1,192 | 1,219 | |
| Champion wins per run | 14.0 | 13.8 | |
| Power: unarmed vs a normal on day 2 | 0% | 62% | target 50–65% |
| Power: day-2 reference set vs normal / elite / champion | 93 / 63 / 22% | 100 / 94 / 65% | the bands were raised with the damage scale |
| Power: last day ≥ 70% vs elites, iron C / steel C / mythril C / mythril S | 10 / 20 / 30 / 50 | 15 / 20 / 40 / 60 | plain sets last longer |
| First iron / steel / mythril piece (median day) | 3 / 9 / 16 | 4 / 10 / 18 | a day or two later |
| 3 of 5 slots iron / steel / mythril | 6 / 11 / 22 | 7 / 13 / 27 | |
| Map found by day 40 / 50 | 82% / 92% | 64% / 84% | the fresh-cell time slows mining |
| One trip from 8:00, distance 1 / 3 (minutes for 20 items) | 244 / 302 | 312 / 348 | +2 minutes per fresh cell |
| Repairs per run (all at night), bars spent | 4.8, 1.4% of bars made | 15.6, 3.8% | 10% wear |
| Items destroyed by wear per run | 1.4 (2.0% of bars) | 4.2 (4.8% of bars, 4.3 mythril bars) | |
| Gems cut per run | 310 | 258 | the bot mines less |
| Immortal bot: slots in mythril at day 80 | 3.3 | 2.6 | mythril goes to upkeep |
| Estimate cost per enemy | 39,600 fights | 3,300 | 12 times smaller (10 × 10) |

Why the curve did not move although the middle of the game did: the unarmed fix removes the day-2 deaths
(14 of 200 benchmark runs in 1.1), so 1.2 starts 5–9 points higher through day 10; from day 15 on the two
curves agree within noise, with the stronger swords on one side and the stronger specials, 10% wear and the
noisier 10 × 10 planner (about 2–3.5 days of median life, `docs/BENCHMARKS.md`) on the other. The balance was
tuned with the benchmark as the check.

### What changed from 1.0 to 1.1 (history)

Version 1.1 changed the economy only (field piles and carrying, debris cleared by searching, boulders,
gem cutting from novice to master, equal gem odds). Both versions were run on the same 120 seeds
(`--section bot --seeds 120`, 1.0 from commit 985b656), because 40 runs are too noisy for a difference this
small:

| 120 runs, same seeds | 1.0 | 1.1 | Reading |
|---|---|---|---|
| Median life | 53.0 | 52.0 | survival the same within noise |
| Alive day 40 / 50 / 60 | 73 / 58 / 11% | 76 / 56 / 13% | |
| Mean score | 1,204 | 1,164 (−3.3%) | slightly lower: weaker gems early (novice table), a few fewer champion fights |
| Mining minutes per found item, days 1–40 | 12.5–14.6 | 11.6–12.8 | mining about 5–10% more efficient (no clear action; finds beyond a full bag wait in the pile) |
| Map found by day 40 / 50 | 73% / 89% | 81% / 92% | the map ran out about 4–5 days sooner |

### Current results (version 1.2)

**Economy** (`node tools/balance.mjs --section economy`, about 12 s):

```
ECONOMY SUMMARY | items/search by dist d1:1.84 d2:2.05 d3:2.22 d4:2.36 d5+:2.55 | debris % of effort d1:5 d2:5 d3:5 d4:5
d5+:5 | one trip d1/d3: 312/348 min for 20.0/20.0 items (found 21.5/22.0, pile left 1.5/2.0) | field min per unit: copper 27,
iron 62, steel pair 115, mythril 666, any gem 49 | full set >=D work days: copper 1.2, iron 2.1, steel 3.4, mythril 15.8 |
gem cut skill 0: F 15% C+ 40% effect 0.77 of C | map items/run 1541 (mythril 12.4, coal 120) | regrow off
```

Against 1.1 (244 / 302 minutes for a trip, field minutes per unit 23 / 53 / 129 / 525 / 42, full sets in 1.1 /
1.9 / 3.7 / 12.7 work days) the fresh-cell time adds 2 minutes per never-searched cell: a trip from 8:00 takes
28% longer at distance 1 and 15% at distance 3, field minutes per copper, iron, mythril and gem unit rise
by 17%, 17%, 27% and 17% (best distances); the steel pair at distance 3, where it was cheapest in 1.1, rises
from 129 to 155, and its best distance is now the thin distance-5+ bucket (0.47 fields a map; 115, mostly
sample noise). The map holds 1,541 items on these 100 maps, unchanged; items per search fell about 3% (1.84 vs
1.89 at distance 1). A novice cuts gems at 15% failure and 40% C-or-better, worth 0.77 of a C gem per cut
(section 5). Section 2 (a whole field, no travel) charges the 30-minute base per search plus 2 minutes per
never-searched cell, once per cell (126 minutes a field), without the search-skill speed-up; sections 3a and
3b charge the game's own search time.

**Power curve** (`node tools/balance.mjs --section power`, about 5 s):

```
POWER SUMMARY | unarmed d2 vs normal 62% (target 50-65) | day-2 ref (Copper C sword + C chest + C boots) n/e/c 100/94/65% | Cu D sword n/e/c 97/76/37% | last day >=90% vs normal: Copper B d10, Iron C d15, Steel C d20, Mythril C d40, Mythril S d60 | >=70% vs elite: Copper B d5, Iron C d15, Steel C d20, Mythril C d40, Mythril S d60 | ceiling vs normal d60/d80 100/99%
```

The day-2 reference set wins 94% against elites and 65% against champions; the bot's own day-1 gear
(usually a gem in the sword) reaches 95% and 76%. Plain sets on pace with the progression target:

| Plain full set, day | vs normal | vs elite | vs champion |
|---|---|---|---|
| iron C, day 10 | 99.9 | 94.9 | 71.7 |
| iron C, day 15 | 96.6 | 76.1 | 37.7 |
| steel C, day 20 | 99.2 | 88.6 | 55.8 |
| steel C, day 30 | 79.9 | 39.8 | 10.4 |
| mythril C, day 30 | 99.8 | 95.0 | 70.1 |
| mythril C, day 40 | 97.7 | 73.3 | 30.0 |
| mythril S, day 50 | 99.7 | 87.9 | 52.3 |
| mythril S, day 60 | 96.3 | 70.0 | 26.1 |

**Specials** (`node tools/balance.mjs --section specials`, about 10 s): the tables are in section 7;
the summary line (steel C, Normal → High loss / recovered by 3 armor gems + a B ring):

```
SPECIALS SUMMARY (steel C, N->H loss / recovered by 3 gems + B ring) | Magic -11 / 59% | Piercing -12 / 62% | Stun -14 / 82% | Slow -13 / 103%
```

**Estimator** (`node tools/balance.mjs --section estimator`, about 25 s): the tables are in
`docs/BENCHMARKS.md` ("Is 10 × 10 too low?"); the summary line (mean over the 55 / 75 / 90% targets, 10%
scouting, points):

```
ESTIMATOR SUMMARY (mean over the 55/75/90 targets, sight 10%, points) | 10x10: repeat sd 5.1, error sd 11.2 | 13x13: repeat sd 4.2, error sd 10.9 | 16x16: repeat sd 3.6, error sd 10.8 | 20x20: repeat sd 3.1, error sd 10.7 | 29x29: repeat sd 2.4, error sd 10.5 | 40x30: repeat sd 2.0, error sd 10.4
```

**Careful bot** (`node tools/balance.mjs --section bot --seeds 40`, about 2 minutes). The bot gathers
(in a field it searches until what is worth carrying fills the bag, then carries the most valuable items
of bag + pile by its own values and leaves the rest in the pile), refines, cuts, smiths, repairs at night
(free of time), wears rings (including Foresight), spends intel (all on enemy scouting) and picks the fight
with the best `win% × (points + 1000)` among enemies estimated at 90%+ win (a champion needs about 96% of
the best normal's estimate; it clears that on most mid-game days). For this section it uses its own larger
estimate (`--estimator bot`), not the in-game 10 × 10:

```
BOT SUMMARY | alive d10:93% d20:90% d30:73% d40:73% d50:58% d60:13% d80:0% | median life 51.5 | score 1219 | d2 typical est n/e/c 100/95/76 | first iron/steel/myth piece d4/10/18 | 3-slot iron/steel/myth d7/13/27 | d11-30 fights n/e/c 1/39/60% | mining 63% trips/day 1.3 idle 14m | repair 3.8% bars 0.0% time, 15.6 night/run (2.1 subst.) | map found d40:64% d60:91% d80:-% | field: 3.29 found/search, carried 56% of found (10.5/trip, 68 from old piles), piles at end 486 (9.5 worth), debris 4.0% of effort | gems cut 257.6/run F/D/C+ 13/35/52%, 31.0 infused
```

| Survival (end of day) | 2 | 5 | 10 | 15 | 20 | 30 | 40 | 50 | 60 | 70 | 80 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| % of runs alive | 100 | 100 | 93 | 90 | 90 | 73 | 73 | 58 | 13 | 0 | 0 |

Death days (40 runs): 6, 7, 7, 13, 24, 24, 25, 27, 29, 30, 30, 43, 47, 48, 50, 50, 50, 51, 51, 51, 52, 53, 53,
53, 53, 55, 55, 55, 57, 57, 57, 58, 58, 60, 60, 62, 62, 67, 68, 69.
Score: mean 1,219, median 1,333, max 1,690. Wins per run: 14.4 normal, 15.5 elite, 13.8 champion.
(Eleven of 40 runs die before day 40, none on day 2. The tool lists the first 12 runs: its early deaths there
are a champion on day 7 (estimate 99%), a champion on day 25 (98%), a champion on day 29 (98%) and an
elite on day 30 (99%), unlucky fights at estimates over 98%.)

| Progression (median day, runs that got there) | first piece | sword | 3 of 5 slots | all 5 slots | target |
|---|---|---|---|---|---|
| iron or better | 4 (40/40 runs) | 4 (40/40) | 7 (39/40) | 13 (36/40) | 5–8 |
| steel or better | 10 (37/40) | 11 (37/40) | 13 (37/40) | 19 (36/40) | 12–18 |
| mythril | 18 (35/40) | 18 (35/40) | 27 (20/40) | 41 (3/40) | 25+ |

| Days | Fights: normal / elite / champion % | Mean est. win % | Actual win % | Losses per fight % | "No safe option" fights |
|---|---|---|---|---|---|
| 2–5 | 29 / 58 / 14 | 99.5 | 100.0 | 0.0 | 0 of 160 |
| 6–10 | 0 / 48 / 52 | 99.3 | 98.4 | 1.6 | 0 |
| 11–20 | 0 / 31 / 69 | 99.3 | 99.7 | 0.3 | 0 |
| 21–30 | 1 / 47 / 52 | 99.2 | 97.9 | 2.1 | 0 |
| 31–40 | 42 / 52 / 5 | 99.4 | 100.0 | 0.0 | 0 |
| 41–50 | 96 / 4 / 0 | 96.3 | 97.8 | 2.2 | 22 of 278 |
| 51–60 | 100 / 0 / 0 | 86.9 | 87.1 | 12.9 | 74 of 139 |
| 61–80 | 96 / 4 / 0 | 71.9 | 82.1 | 17.9 | 21 of 28 |

"No safe option" = even the best enemy on the roster was estimated below the bot's 90% line, so it took
the best one anyway.

| Best estimated win % on the roster, bot's own gear (mean over runs alive) | d2 | d3 | d5 | d7 | d10 | d15 | d20 | d25 | d30 | d35 | d40 | d50 | d60 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| normal | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 99 | 91 | 78 |
| elite | 96 | 99 | 100 | 100 | 100 | 100 | 100 | 100 | 100 | 98 | 94 | 68 | 45 |
| champion | 78 | 90 | 97 | 97 | 98 | 98 | 98 | 97 | 95 | 86 | 72 | 34 | 19 |

(The best of the roster's two champions, with gems, rings and both packed items per slot, which is why
these numbers sit far above the plain-set table in the power section.)

| Daily time (minutes) | travel | search | of which clearing debris | refine | cut | smith | repair | idle | mining share of used time | trips/day |
|---|---|---|---|---|---|---|---|---|---|---|
| day 1 | 44 | 220 | 22 | 174 | 25 | 107 | 0 | 9 | 48% | 1.0 |
| days 2–5 | 44 | 185 | 14 | 163 | 94 | 89 | 0 | 11 | 41% | 1.0 |
| days 6–10 | 87 | 198 | 13 | 163 | 72 | 58 | 0 | 10 | 50% | 1.1 |
| days 11–20 | 156 | 195 | 11 | 119 | 70 | 40 | 0 | 9 | 61% | 1.3 |
| days 21–30 | 178 | 220 | 10 | 85 | 75 | 24 | 0 | 9 | 69% | 1.5 |
| days 31–40 | 159 | 273 | 9 | 36 | 102 | 13 | 0 | 9 | 75% | 1.5 |
| days 41–60 | 135 | 253 | 7 | 26 | 161 | 8 | 0 | 11 | 67% | 1.3 |
| days 61+ (few runs) | 74 | 66 | 1 | 2 | 175 | 6 | 0 | 277 | 43% | 0.4 |

("Of which clearing debris" = the share of the search minutes whose effort went into debris; it is not a
separate action, and the search column includes it. "Mining" = travel + search. The summary line's 63% is the
average over all days from day 2. Repairs show 0 minutes because the bot only repairs at night, when they
cost no time. The search column includes the fresh-cell minutes.)

**Field piles and carrying.** Per run the bot makes 338 searches that find 1,113 items (3.29 per search,
all into field piles) and carries 627 of them home (56%) on 59.6 trips (10.5 items per trip, 16% of trips
full); 68 of the carried items were picked up from piles left on earlier trips. At the end of a run about
486 items lie in field piles, almost all ores it no longer needs (323 copper, 145 iron, 17 coal; only 9.5
items per run are still worth carrying). 4.0% of its search effort goes into debris, and 20% of its finds
come from cells that had debris. With the game's own default carry (`--carry default`, "Rarest first") it
carries 99% of what it finds (15.9 items per trip) and the run is no worse in this sample (median 51.5,
score 1,224): the 1.1 concern that the default carries too much junk shows no cost in 1.2 within noise.

**Map supply** (fields do not regrow, so the map is the whole supply; the bot's 40 maps start with 1,537
hidden items: copper 561, iron 384, coal 123, mythril 13, gems 456). "Found" = taken out of cells by
searching (into the field's pile); "found/day" and "mining min per found item" cover the 10 days up to
that day:

| Day | Runs alive | Found so far | % of map | Still in piles | Coal left | Mythril left | Found/day | Mining min per found item | Idle min/day |
|---|---|---|---|---|---|---|---|---|---|
| 10 | 37 | 182 | 12 | 18 | 119 | 13 | 18.2 | 15.0 | 10 |
| 20 | 36 | 412 | 27 | 92 | 92 | 9 | 22.9 | 15.8 | 9 |
| 30 | 31 | 677 | 44 | 210 | 61 | 4 | 26.3 | 15.4 | 9 |
| 40 | 29 | 978 | 64 | 385 | 40 | 1 | 30.3 | 14.6 | 9 |
| 50 | 26 | 1,292 | 84 | 590 | 17 | 1 | 32.0 | 13.3 | 8 |
| 60 | 7 | 1,440 | 91 | 640 | 9 | 0 | 16.0 | 21.6 | 24 |

The same bot with `--immortal` (enemies deal no damage, so all 40 runs reach day 80 and show how long the
map lasts for a careful player who never dies):

| Day | Found so far | % of map | Coal left | Mythril left | Found/day | Mining min per found item | Idle min/day |
|---|---|---|---|---|---|---|---|
| 30 | 684 | 45 | 64 | 4 | 27.1 | 15.0 | 9 |
| 40 | 996 | 65 | 39 | 2 | 31.2 | 14.0 | 9 |
| 50 | 1,289 | 84 | 17 | 1 | 29.3 | 14.5 | 10 |
| 60 | 1,423 | 93 | 7 | 0 | 13.4 | 18.8 | 114 |
| 70 | 1,438 | 94 | 6 | 0 | 1.5 | 27.9 | 450 |
| 80 | 1,441 | 94 | 5 | 0 | 0.3 | 44.3 | 576 |

**Finding: with no regrowth the map still caps a run, but later than in 1.1.** The bot finds 18–32 items a
day until day 50 (more as it moves to richer fields and its skills grow); by day 40 it has found 64% of the
map and all but about 1 of its 13 mythril, and by day 50 84% with 17 of 123 coal left. The immortal bot's
finds fall from about 29 a day (days 41–50) to 13 (days 51–60) and under 2 after day 60, its idle time jumps
to 450–580 minutes a day, and its gear stops improving around day 40–60 (best sword mythril B, 2.6 of 5 slots
mythril; in 1.1 3.3 slots): with 10% wear the map's last mythril goes into repairs (40 repairs a run, 7.6% of the
bars made) as well as into new pieces. A map holds about 13 mythril while a set of matched mythril C-or-better
pieces needs about 26 on average (economy section 5), so even a perfect player hits a wall around day 60–70:
the best plain set, mythril S, holds 90% against normals until day 60 and 70% against elites until day 60 and
no longer from day 70 (Appendix A), and only the ceiling loadout (S gems, ten S rings) still wins 99% against
normals at day 80, which needs far more S-grade material than one map holds. The careful bot dies at about the
same time (median day 51.5), and the map is one of its limits: with regrowth on (`--set
field.regrowPctPerDay=5`) it keeps finding 23–26 items a day after day 40, has 3.7 of 5 slots in mythril by
day 50 and 4.7 by day 70 (1.8 at day 50 without regrowth) and lives longer (median 59.0 instead of 51.5;
alive at day 60: 33% instead of 13%; mean score 1,377).

Other bot facts: about 44 rings per run (19.2 smith, 24.4 adventurer); 15.6 repairs per run, all at night,
costing 3.8% of the bars made (2.1 of them with a higher-grade substitute); 4.2 items per run destroyed by
wear (4.8% of bars made, 4.3 of the 10 mythril bars; on 26.8 nights a worn top item has no bars of its grade
or better to be repaired with); 258 gems cut per run; 71% of the map searched by the end of a run; all intel
goes to enemy scouting (8.5 points). Eleven of 40 runs die before day 40, none on day 2. After day 40
deaths are a mix of unlucky losses at 90–99% estimates and "no safe option" days; on days 51–60 53% of the
bot's fights (74 of 139) have no safe option.

**System ablations** (same 40 seeds, `--ablate <system>`, plus three what-ifs). Survival numbers still move
by several points from noise alone (the tool's help gives ±10 for 20 runs), so only large differences mean
something:

| Run | Median life | Alive d40 / d50 / d60 | Mean score | Note |
|---|---|---|---|---|
| full game | 51.5 | 73% / 58% / 13% | 1,219 | |
| `--ablate rings` | 47.5 | 80% / 35% / 8% | 958 | a loss: rings are the main late-game power source, and without them the bot takes far fewer champions (6.5 instead of 13.8 wins per run; champions are 24% of its fights on days 11–30 instead of 60%) |
| `--ablate gems` | 42.0 | 65% / 18% / 0% | 1,192 | a clear loss after day 35: without cutting and infusing the bot idles 217 minutes a day on average and only 49% of the map is found by day 40; no run lives past day 57 |
| `--ablate repair` | 51.0 | 80% / 55% / 8% | 1,214 | no loss in survival or score in this sample (1.1: −8 days): the bot rebuilds instead; destroyed items take 11.9% of the bars made instead of 4.8% (10.9 items a run instead of 4.2) |
| `--ablate skills` | 52.0 | 80% / 60% / 10% | 1,189 | no loss in survival, 2% less score (1.1: −3.5 days): 6.0% of the search effort goes into debris instead of 4.0%, gems stay on the novice table (F / D / C+ 15 / 44 / 41%) and wear is not reduced (5.3 items destroyed a run) |
| `--ablate intel` | 53.5 | 83% / 68% / 15% | 1,217 | within noise |
| `--carry default` (the game's "Rarest first" default instead of the bot's value choice) | 51.5 | 78% / 53% / 8% | 1,224 | the same: carries everything it finds (15.9 items per trip), including ore it no longer needs (1.1: worse) |
| `--set field.regrowPctPerDay=5` | 59.0 | 85% / 78% / 33% | 1,377 | regrowth keeps the late game supplied |

Only rings and gems are clear losses. Compared with 1.1, repair and skills moved from losses (8 and 3.5 days
of median life) to within noise, rings from −10.5 to −4 days and gems stayed at about −9.5 days. Repair and
skills still pay in bars (section 8), but with 10% wear and the bot rebuilding broken pieces they no longer
decide who survives; `--ablate repair` is worth re-running on 200 seeds before reading anything into it.

### Benchmark: how hard is each version?

The bot section is a balance check; the **benchmark section** is the version-to-version yardstick. It plays
100 fixed games (the same seeds in every version) with the in-game estimate of that version and reports the
share of runs still alive at day 5, 10, ... 100 (`node tools/balance.mjs --section benchmark --jobs 3`, about
2 minutes). Results, how to read them, the noise and how to add a version are in
[`docs/BENCHMARKS.md`](BENCHMARKS.md). The 1.2 line:

```
BENCHMARK | v1.2 | seeds 100 | alive d5:97% d10:94% d15:85% d20:81% d25:77% d30:74% d40:70% d50:46% d60:13% d70:1% d80:0% d100:0% | median life 50.0 | mean score 1228 | estimator game 10x10
```

1.1 on the same 100 seeds: 90 / 85 / 85 / 79 / 76 / 73 / 67 / 46 / 5 / 0 (d5 ... d60, then d70) and median 48.5:
the curves agree within noise at every column.

### Running what-if experiments

```sh
node tools/balance.mjs --section power                       # power curve only (~5 s)
node tools/balance.mjs --section economy                     # mining / refining economy, map size (~12 s)
node tools/balance.mjs --section specials                    # enemy specials vs matching defence and the adventurer's gems (~10 s)
node tools/balance.mjs --section estimator                   # accuracy of the win-chance estimate (~25 s)
node tools/balance.mjs --section bot --seeds 40              # bot playthroughs (~2 min)
node tools/balance.mjs --section bot --seeds 40 --immortal   # bot can't lose: how fast the finite map runs out
node tools/balance.mjs --section benchmark --jobs 3          # difficulty benchmark: 100 fixed games, survival by day (~2 min)
node tools/balance.mjs --section benchmark --seeds 200 --jobs 3 --estimator bot   # more seeds / the bot's own estimate
node tools/balance.mjs --quick                               # smoke test of the sections

# Override any CONFIG value in memory for one run (js/config.js is never changed):
node tools/balance.mjs --section power --set enemies.growthPerDay.hpDamage=4
node tools/balance.mjs --section bot --set field.regrowPctPerDay=5               # turn field regrowth back on
node tools/balance.mjs --section bot --set field.oreWeights.3.mythril=10       # array index (row for distance 4+)
node tools/balance.mjs --section bot --set 'field.oreWeights.*.mythril=2'      # '*' = every row
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'   # replaces the whole object: no tier multipliers
node tools/balance.mjs --section benchmark --jobs 3 --set sim.samples=20 --set sim.evalFights=20 --set sim.fightsPerLoadout=20   # what a 20 x 20 estimate does
node tools/balance.mjs --section economy --set 'field.debrisAmount={"min":10,"max":30}'   # thinner debris
node tools/balance.mjs --section bot --seeds 40 --set 'cut.*.novice={"F":12,"D":40,"C":25,"B":14,"A":7,"S":2}'

# What the bot (and the economy trips) carry home: its own value choice (default) or the game's default
node tools/balance.mjs --section bot --seeds 40 --carry default

# Play the bot without a system: gems, rings, skills, intel, repair (comma separated)
node tools/balance.mjs --section bot --seeds 40 --ablate rings
node tools/balance.mjs --section bot --seeds 40 --ablate gems,repair
```

Other flags: `--seeds N` (economy: maps, default 100; bot: runs, default 20; benchmark: runs, default 100),
`--days N` (bot day limit, default 80; benchmark 100), `--estimator game|bot` and `--jobs N` (benchmark), `--samples N` (power: attribute guesses per cell, default 100), `--minwin P` (bot: lowest
estimated win % it accepts, default 90), `--future F` (bot: how much one survival is worth when picking
fights, default 1000; lower = greedier), `--immortal` (bot: enemies deal no damage and the bot fights an
elite every day without estimating, so no run ends early; survival and fight numbers are meaningless then,
the "Map supply" table is the point), `--carry value|default` (bot and economy trips: carry the most
valuable items of bag + pile by the bot's own values, default, or use the game's "Rarest first"
`defaultCarry`). `--help` prints the full option list.

How to compare: each section ends with a one-line `ECONOMY SUMMARY`, `POWER SUMMARY`, `BOT SUMMARY`,
`SPECIALS SUMMARY`, `ESTIMATOR SUMMARY` or `BENCHMARK` line.
Run the baseline and the what-if with the same flags and compare those lines. The run prints the
overrides it applied at the top (`WHAT-IF overrides`). A `--set` path must already exist in `CONFIG`
(typos are rejected) and a number can only be replaced by a number. For close bot comparisons use
`--seeds 40` or more.

Example: `--set enemies.growthPerDay.hpDamage=4` (from 3.5) moves the power summary to
`last day >=90% vs normal: Copper B d10, Iron C d15, Steel C d20, Mythril C d40, Mythril S d50 | >=70% vs
elite: Copper B d5, Iron C d10, Steel C d20, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80
100/96%`, i.e. the late checkpoints lose 5–10 days (mythril S vs normals d60 → d50; iron C, mythril C and
mythril S vs elites d15 → d10, d40 → d30, d60 → d50).

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
| Search a 3x3 area (also clears debris, section 3.4) | 30 min + 2 min per fresh (never-searched) cell in the area (section 3.3) | Quick search ring + Search speed skill (on the whole total) |
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
The check assumes a load of min(20, 8 + 5) = 13 items: walk home = 3 × 20 × 1.13 = 67.8 min. A search of
an area with 4 fresh cells takes 30 + 4 × 2 = 38 min and is allowed because 14:30 + 38 + 67.8 = 16:15.8 ≤
18:00. At 16:30 the same search would end at 17:08 and the walk home at 18:15.8, so it is refused, even if
the player meant to leave the 5 pile items behind. With 15 in the bag and 9 in the pile the load is capped
at 20 (+20%, 72 min).

**Work-day bar (UI, v1.2).** The top bar shows the share of the 600 minutes that is left as a thin bar along
its bottom edge (full at 8:00, empty at 18:00; yellow at or below 25% left, red at or below 10%), next to the
"Xh Ym left" text. It is display only.

**Tuning notes.** Day length scales everything that is "per day" (gathering, refining, smithing) against
everything that is "per fight" (wear, enemy growth). Longer days = easier game. The 75% cap only matters
once many rings and skills are stacked (the bot ends runs at about 8–15% total on each time bonus). The
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
155–180 min a day travelling on days 11–40, less after that as the reachable fields run dry.

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
has found 64% of the map by day 40 and 84% by day 50 (1.1: 82% and 92%; the fresh-cell time of 1.2 slows
mining a little); mythril is nearly gone by day 40 and coal runs low by day 50–60 (about 17 of 123 left at
day 50 and 9 at day 60; see "Map supply" in the results). Turning it back on (try
`--set field.regrowPctPerDay=5` in the balance tool) keeps the endless game supplied, mostly near camp,
where the player searches most; high values make near fields self-sufficient (less reason to travel).

### 3.3 Searching

| Number | Config path | Value |
|---|---|---|
| Search time | `CONFIG.field.searchMin` | 30 min per 3x3 search |
| Fresh-cell time | `CONFIG.field.freshCellMin` | 2 (extra minutes per never-searched cell in the 3x3 area, v1.2) |
| Search efficiency | `CONFIG.field.searchEfficiency` | 35 (average % of each cell searched per search, before bonuses) |
| Search randomness | `CONFIG.field.searchRandomness` | 5 (each cell rolls efficiency ± 5 points per search: 30–40% at base) |

**Formula** (`search`, `searchEfficiency`, `searchEfficiencyRange` in `js/core/map.js`):

```
efficiency = searchEfficiency × (1 + (searchEffRing% + searchEffSkill%) / 100)        (the average)
range      = [clamp(efficiency − searchRandomness, 0, 100), clamp(efficiency + searchRandomness, 0, 100)]
minutes    = round1( (searchMin + freshCellMin × freshCells) × (1 − min(searchTimeRing% + searchTimeSkill%, 75) / 100) )
             freshCells = open cells in the 3x3 area that no search has worked on yet (see "Fresh cells" below)
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
range (for example "30–40%") and, for the selected area, the time with its fresh cells spelled out
("38m (30 + 2 × 4 fresh cells)").

**Fresh cells (user decision, v1.2: "+2 min per never-searched cell in a search").** `cellFresh` in
`js/core/map.js`: a cell is fresh while it is open (not a boulder, not finished) and no search has worked
on it: `touched` is false and `searched` is 0. `search` sets `touched` on every open cell whose effort roll
is above 0 (so clearing some debris counts, even if nothing is searched yet), after counting the fresh
cells for the price. Cells in saves from before 1.2 have no `touched` flag, so they count as touched as
soon as they have any searched %. The surcharge is paid **once per cell**, so a fully searched field costs
63 × 2 = **126 extra minutes** spread over its searches (about +3.5 minutes on each of its ~36 searches; the
first search of an all-fresh area takes 48 minutes, a finished area costs 30). The search-time ring and skill
reduce the whole total, surcharge included. Fresh cells show a small dot on the field grid. The point is to
reward finishing an area before moving to a new one and to make a fresh field cost a little more than a
half-worked one.

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
9 × 0.55 × 2.0 = 9.9 items. At base efficiency the first search takes 30 + 9 × 2 = 48 minutes and finds about
3.5 items, the second (30 minutes, no fresh cells left) finds about 3.5 and the third the remaining 2.9 (a
tiny rest is left for a 4th search on 1 cell in 6): 108 minutes in all. With a Thorough search ring S (20%),
Search efficiency skill level 5 (6%) and a Quick search ring S (10%), efficiency is 35 × 1.26 = 44.1%
(39.1–49.1% per cell): about 4.4 items in the first search (43.2 minutes: 48 × 0.9), 4.4 in the second (27
minutes) and 1.2 in the third, and no cell needs a 4th.

Covering a whole 8x8 field takes at least 9 areas × 3 searches = 27 searches (13.5 hours); greedy area
picks in the economy report use about 36 searches per field (36.0–36.7 by distance) because areas overlap
at the edges, some cells need a 4th search and debris cells need about one more. On average a search finds
1.84 / 2.05 / 2.22 / 2.36 / 2.55 items at distance 1 / 2 / 3 / 4 / 5+, debris cells included (1.1: 1.89 /
2.10 / 2.27 / 2.41 / 2.60: about one search more per field, probably because the economy report's greedy
area picks now weigh the fresh-cell minutes). Its `min/item` column charges the 30-minute base plus the
fresh-cell surcharge (126 minutes a field), so a whole field costs 18.2 / 16.4 / 15.1 / 14.2 / 13.1 minutes
per item at distance 1 / 2 / 3 / 4 / 5+ (a flat 30 minutes per search would give 16.3 / 14.6 / 13.5 / 12.7 /
11.8). The trip tables (3a, 3b) include the surcharge too.

**Tuning notes.** `freshCellMin` is a flat tax on every cell the first time a search works on it: a fully
searched field costs 126 minutes more (about 11% on top of ~36 searches × 30 minutes), and the first search
of a new area costs up to 48 instead of 30 minutes. Raise it to make breadth (new fields, scattered
searches) dearer than finishing areas; 0 brings the 1.1 rules back. The Quick search ring and skill reduce
it with the rest. At 35% the efficiency bonus pays off twice: it moves items into the first searches
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
report about 5% of all search effort on a field goes into debris (about 60 search-minutes per field,
fresh-cell time included; 1.1: 37; 1.0 had a 15-minute clear action costing about 140 minutes per field);
together with the field piles (finds beyond a full bag are carried on the next trip, section 4), that is why
mining got about 5–10% more efficient in 1.1; 20% of the bot's found items come from cells that had debris. The
thickness sets how much effort debris eats (mean 40, about 1.1 extra searches per cell at base). The Debris
clearing skill has no ring counterpart and is strong per level (+10%; at level 10 every debris cell clears
in one search); its XP is 1 per point cleared, so the first levels come quickly (level 1 after 100 points,
two or three debris cells), and the bot ends runs at level 8.9 (+89%). Raising `debrisChance` or
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
travel (40 out, 48 back with 20 items) and about 6.3 searches (233 min including the fresh-cell time; the
effort of about 15 of those minutes went into debris) find 22 items in 321 minutes; 20 are carried home and
about 2 wait in the pile for the next trip there. Repeating trips the same day brings home about 36 items
(distance 1: 39, distance 4: 26). In 1.1 the same trips took 271 minutes and brought home 42 items at
distance 2 (distance 1: 46, distance 4: 32): the fresh-cell time cuts what a day of repeat trips brings home by 14-18%.

**Tuning notes.** The bag caps what one trip carries, not what a search finds: the rest waits in the
field's pile. Raising it mostly helps far-field play (fewer trips per item). The careful bot
(which carries by its own item values, `--carry value`) carries home 56% of what it finds, 10.5 items per
trip (16% of trips full), takes 68 items per run from piles left on earlier trips and ends a run with
about 486 items in piles, almost all of them ores of materials it no longer needs (9.5 still worth
carrying). With the game's own default (`--carry default`, which fills every free slot) it carries home
everything it finds (15.9 items per trip, +1% travel time per item) and does as well in this sample (median
life 51.5 and mean score 1,224, against 51.5 and 1,219; in 1.1 it did worse, 50 against 53): any cost of
carrying ore it no longer needs is below the noise of 40 runs.

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
| 2 | 14 | 40 | 25 | 12.4 | 6.2 | 2.4 | 24.4% | 43.5 | 0.83 |
| 4 | 13 | 35 | 25 | 14.8 | 8.4 | 3.8 | 31.0% | 38.5 | 0.90 |
| 5 | 12.5 | 32.5 | 25 | 16 | 9.5 | 4.5 | 34.3% | 36.4 | 0.93 |
| 6 | 12 | 30 | 25 | 17.2 | 10.6 | 5.2 | 37.5% | 34.5 | 0.96 |
| 8 | 11 | 25 | 25 | 19.6 | 12.8 | 6.6 | 43.8% | 31.2 | 1.03 |
| 10 (master) | 10 | 20 | 25 | 22 | 15 | 8 | 50.0% | 28.6 | 1.09 |
| 1.0's fixed table, for comparison | 10 | 30 | 25 | 20 | 10 | 5 | 38.9% | 33.3 | 0.98 |

("Effect per cut vs a C gem" = the average infusion effect of one gem cut, failures counting as 0, divided
by the effect of a C gem, averaged over the five gems' sword and armor effects; economy report section 4. It
moved from 0.92 / 1.08 (skill 5 / 10) in 1.1 to 0.93 / 1.09 because the gem effect tables changed, section 7.)

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
cuts about 258 gems per run (F 13%, D 35%, C 26%, B 14%, A 8%, S 4%; 1.1: 310) and ends with gem skills
between 1.8 (topaz) and 6.8 (diamond). Processing times (15 → 30 min) were raised so that refining and
cutting take a real share of the day (the bot spends about 290–350 min a day at camp refining, cutting and
smithing in the first 10 days, falling to about 150 min on days 31–40 as it mines more; from day 41, with
the map running low, it spends 160–175 min a day cutting stockpiled gems).

---

## 6. Gear (smithing)

| Number | Config path | Value |
|---|---|---|
| Material multiplier | `CONFIG.gear.materialMult` | copper 1.0, iron 1.5, steel 2.0, mythril 3.0 |
| Grade multiplier | `CONFIG.gear.gradeMult` | D 1.0, C 1.1, B 1.2, A 1.3, S 1.5 |
| Sword | `CONFIG.gear.slots.sword` | 2 bars; damage 16 (1.1: 10), accuracy 10 |
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

Multiply any slot base stat by this. Examples: sword damage = 16 × mult (copper D 16, iron B 28.8, steel A
41.6, mythril S 72) and sword accuracy = 10 × mult (copper D 10, iron B 18, steel A 26, mythril S 45). Chest
defense = 6 × mult (copper D 6, iron C 9.9, steel A 15.6, mythril S 27).
Helmet defense = 4 × mult (4 … 18). Gloves = 2 defense and 10 accuracy × mult. Boots = 2 defense, 10 dodge
and 3 speed × mult (mythril S boots: 9 defense, 45 dodge, 13.5% speed).

**Full set (all 5 slots, same material and grade, no gems, no rings) → adventurer stats:**

| Set | Damage | Accuracy | Defense % | Dodge | Speed % | Attack every |
|---|---|---|---|---|---|---|
| none (unarmed) | 11 | 100 | 0 | 100 | 0 | 2.00 s |
| Copper D | 16 | 120 | 14.0 | 110 | 3.0 | 1.94 s |
| Copper S | 24 | 130 | 21.0 | 115 | 4.5 | 1.91 s |
| Iron D | 24 | 130 | 21.0 | 115 | 4.5 | 1.91 s |
| Iron C | 26.4 | 133 | 23.1 | 116.5 | 4.95 | 1.91 s |
| Iron A | 31.2 | 139 | 27.3 | 119.5 | 5.85 | 1.89 s |
| Steel D | 32 | 140 | 28.0 | 120 | 6.0 | 1.89 s |
| Steel C | 35.2 | 144 | 30.8 | 122 | 6.6 | 1.88 s |
| Steel A | 41.6 | 152 | 36.4 | 126 | 7.8 | 1.86 s |
| Steel S | 48 | 160 | 42.0 | 130 | 9.0 | 1.83 s |
| Mythril C | 52.8 | 166 | 46.2 | 133 | 9.9 | 1.82 s |
| Mythril A | 62.4 | 178 | 54.6 | 139 | 11.7 | 1.79 s |
| Mythril S | 72 | 190 | 63.0 | 145 | 13.5 | 1.76 s |

Note that "copper S" equals "iron D" and "steel S" equals "mythril D": one material step is worth roughly
the whole D-to-S grade range.

**Worked example.** Steel A chest: 6 × 2.0 × 1.3 = **15.6% defense**, costs 3 steel A bars and 45 min.

**How much each slot is worth** (power report, steel C set vs an elite on day 29, base 44.2%; the report
picks the day where this set is closest to 50%, which moved from day 24 in 1.1 to day 29 with the new damage
scale): upgrading one piece to mythril C adds sword +43.9, boots +12.3, chest +5.4, gloves +5.2, helmet +3.5
points; removing it costs sword −44.2, boots −22.7, gloves −12.2, chest −12.0, helmet −9.9.

**Tuning notes.** `materialMult` is the backbone of the power curve. Enemies grow without limit while
materials stop at mythril, so these values set how many days each material stays viable (Appendix A).
`gradeMult` decides how much refining luck matters. Slot base stats set the role of each piece: the sword
dominates (damage multiplies everything), boots are second because speed and dodge both scale. Boots'
speed is small on purpose because speed multiplies all damage. Sword base damage 16 (1.1: 10) is one of the
two numbers behind "an unarmed adventurer beats a day-2 normal about 6 times in 10" (section 9): it keeps
the sword's share of a fight roughly where it was now that bare hands hit for 11 instead of 4.

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
| Ruby | +6 / 9 / 12 / 15 / 18 magic damage, % of weapon damage | +4 / 6 / 8 / 10 / 12 % magic resistance |
| Topaz | +10 / 15 / 20 / 25 / 30 % stun chance per hit, stun 1 / 1 / 1.5 / 1.5 / 1.5 s | +4 / 6 / 8 / 10 / 12 % less stun chance **and** % shorter stuns |
| Emerald | +20 / 30 / 40 / 50 / 60 accuracy | +4 / 6 / 8 / 10 / 12 dodge |
| Sapphire | +10 / 15 / 20 / 25 / 30 % slower enemy attack bar for 1.5 / 1.5 / 1.5 / 1.5 / 2 s per hit | +4 / 6 / 8 / 10 / 12 % weaker slows **and** % shorter slows |
| Diamond | +15 / 25 / 35 / 45 / 55 % of enemy defense ignored (before its pierce resistance) | +6 / 9 / 12 / 15 / 18 % of enemy piercing ignored |

**Formula.** `armorGemValue = armorTable[grade] × gemArmorMult[slot]`. Sword gem values are not scaled by
material or grade. Armor gem effects from several pieces add up.

**Armor values after the slot factor (grade S):** chest 15, helmet 13.2, gloves 12, boots 12
(grade D: chest 5, helmet 4.4, gloves 4, boots 4). Diamond armor has its own, larger table: grade S chest
22.5, helmet 19.8, gloves 18, boots 18 (grade D: 7.5, 6.6, 6, 6).

**Worked example.** Emerald S on a chest: 12 × 1.25 = **+15 dodge**. Ruby C on a sword: magic damage +9%
of the sword's damage. On an iron B sword (28.8 damage) that is 2.59 extra magic damage per hit before the
enemy's magic resistance.

**How strong is each gem right now?** Win-% change for a steel C full set against a typical elite on day
29 (all attributes hidden, base 44.2%; power report):

| Gem | Sword C | Sword S | Chest C | All 4 armor pieces C |
|---|---|---|---|---|
| Ruby | +11.7 | +21.8 | +1.2 | +4.4 |
| Sapphire | +5.9 | +16.0 | +1.5 | +6.9 |
| Emerald | +6.7 | +12.4 | +3.4 | +13.6 |
| Diamond | +7.8 | +17.2 | +1.3 | +4.2 |
| Topaz | +5.7 | +17.3 | +1.1 | +5.7 |

**Specials: enemy against adventurer (user decision, v1.2).** The request was: tune magic, piercing, stun
and slow so each is dangerous, resistances matter, and the adventurer's offense is a little weaker than the
enemy's. Four checks (`node tools/balance.mjs --section specials`; direct fight simulations of a plain C set
against an elite on the 7 days around the day that set wins about 55%; one attribute changed at a time, all
others Normal):

1. *Dangerous:* one enemy special at High instead of Normal should cost a mid-game set about 10-20 win
   points.
2. *The defence works:* the matching armor gem at grade C on three pieces plus one B resistance ring should
   win back at least half of that.
3. *Offense a little weaker:* the adventurer's S sword gem should be below the enemy's High value of the
   same special.
4. *Resistances matter:* the enemy's matching resistance should visibly trim the adventurer's gem.

Steel C set, reference day 28 (days 25-31), all-Normal elite 55.3% win:

| Special | Low / Normal / High | Win % at Low / Normal / High | Normal → High | With the defence (3 C gems + B ring): Low / Normal / High | Recovered at High with 2 / 3 / 4 gems |
|---|---|---|---|---|---|
| Magic (Magical) | 10 / 15 / 25 | 64.0 / 55.3 / 44.0 | −11.3 | 67.1 / 62.6 / 50.7 | 42 / 59 / 78% |
| Piercing | 10 / 25 / 60 | 63.0 / 55.3 / 43.1 | −12.2 | 65.3 / 60.7 / 50.7 | 45 / 62 / 81% |
| Stun (Stunning) | 5 / 15 / 35 | 64.8 / 55.3 / 40.8 | −14.5 | 66.7 / 61.6 / 52.7 | 58 / 82 / 100% |
| Slow (Chilling) | 10 / 20 / 40 | 64.8 / 55.3 / 42.2 | −13.1 | 70.1 / 64.8 / 55.7 | 87 / 103 / 121% |

The same on the other sets (Normal → High loss, then recovered with 2 / 3 / 4 gems): iron C (day 19): magic
−14.3 (54 / 71 / 84%), piercing −11.9 (58 / 73 / 86%), stun −18.3 (76 / 84 / 92%), slow −16.4 (64 / 94 /
115%); mythril C (day 45): magic −13.7 (29 / 48 / 76%), piercing −20.5 (36 / 52 / 76%), stun −14.4 (88 / 98 /
108%), slow −12.4 (73 / 98 / 140%). So check 1 holds everywhere (−11 to −20) and check 2 holds on every set
for stun and slow and for magic and piercing on iron and steel; on mythril magic (48%) and piercing (52%)
are right at the line, because the mythril set has so much defense that a small gem is a small share of it.

The adventurer's own offense (steel C set, win-point gain over the same set without it, by the enemy's
matching resistance Low / Normal / High = 0 / 20 / 40):

| Gem or ring | Value | S value vs enemy High | Gain at resistance Low | Normal | High |
|---|---|---|---|---|---|
| Ruby sword C | 9% | | +11.4 | +9.7 | +9.0 |
| Ruby sword S | 18% | 72% of 25 | +26.1 | +19.9 | +13.6 |
| Magic damage ring B / S | 5% / 7% | | +8.7 / +9.6 | +7.9 / +9.1 | +6.8 / +8.0 |
| Diamond sword C | 25% | | +9.3 | +8.7 | +7.6 |
| Diamond sword S | 55% | 92% of 60 | +18.6 | +13.7 | +10.5 |
| Piercing ring B / S | 10% / 14% | | +5.7 / +7.4 | +4.8 / +6.1 | +3.8 / +5.1 |
| Topaz sword C | 15% for 1 s | | +7.3 | +5.7 | +3.6 |
| Topaz sword S | 30% for 1.5 s | 86% of 35 | +20.9 | +14.0 | +8.7 |
| Sapphire sword C | 15% for 1.5 s | | +10.3 | +6.8 | +3.4 |
| Sapphire sword S | 30% for 2 s | 75% of 40 | +20.6 | +15.6 | +9.8 |

Check 3 holds in both measures against a High enemy special: every S gem's number is below the enemy's
High value (72-92%), and its win-point gain is about half of what that special costs you
(S gain ÷ enemy cost at High: magic 58%, piercing 56%, stun 47%, slow 54%). Against a *Normal* enemy
special the S gem is about as strong as the special (86% / 112% / 94% / 98%): the diamond sword is the one
case slightly over (+13.7 against the −12.2 a Normal Piercing costs). Check 4: going from a Low to a High resistance
takes about 2 win points off a C ruby or diamond sword gem, 4-7 off a C topaz or sapphire sword, and 8-12
off an S gem (ruby S +26.1 → +13.6, sapphire S +20.6 → +9.8), so resistances matter most for good gems
and for the effects that depend on a chance and a duration. Defensive rings (steel C set; one ring B / S, win
points against an all-Normal elite and against an elite with the matching attribute High): Pierce
resistance +1.7 / +2.6 and +2.3 / +3.3, Magic resistance +2.3 / +3.3 and +1.8 / +2.8, Stun resistance +2.9
/ +3.1 and +5.4 / +6.8, Slow resistance +2.1 / +2.9 and +2.8 / +6.0. Stun and Slow resistance are now worth
a ring slot against the matching High enemy; Pierce and Magic resistance stay modest (about 2-3 points).

**Tuning notes.** The sword gems were first rebalanced in 1.0 → 1.1 (ruby halved, emerald and diamond
doubled, topaz stun chance raised, stuns made longer) and again for 1.2: ruby 5-15 → 6-18, diamond
20-60 → 15-55 (its S value now sits just under the enemy's High Piercing of 60), topaz 10-20% for 1-1.5 s →
10-30% for 1-1.5 s, sapphire 1-3 s → 1.5-2 s (the low grades got a longer slow, the top grades a shorter
one), and the armor side of diamond raised by half (4-12 → 6-18). With enemy defense now 25% (1.1: 20%)
and the bigger sword, the five sword gems give +5.7 to +11.7 win points at C and +12.4 to +21.8 at S, ruby
on top because magic ignores defense and its value scales with the sword's damage. Armor gems are weaker than sword gems
except emerald (dodge, +13.6 for four pieces) and sapphire (slow resistance, +6.9). Diamond armor
(pierce resistance) and topaz armor (stun resistance) stopped being near-worthless once enemy Piercing
reached 60% and Stunning 35% for 1.5 s (check 2 above). To rebalance, scale the tables in
`CONFIG.gemEffects` and re-run `--section specials`. Which grades the player gets comes from the cutting
tables (section 5): a novice cuts C or better on 40% of attempts, a master on 70%, and every gem type is
equally common in the fields.

---

## 8. Durability and repair

| Number | Config path | Value |
|---|---|---|
| Wear per fight | `CONFIG.gear.durabilityLoss` | `{ min: 8, max: 12, tierMult: { normal: 1.0, elite: 1.1, champion: 1.2 } }` (a whole-number roll, uniform; 1.1: 3-7, no multipliers) |
| Gear care skill | `CONFIG.skills.activity.gearCare` | 1 (% less wear per level; 10% at level 10) |
| Gear care XP | `CONFIG.skills.gearCareXpPerFight` | 100 per fight the adventurer survives |
| Repair material cost | `CONFIG.gear.repair.materialFraction` | 35 (% of the original bars and gem for a 0→100% repair) |
| Repair time | `CONFIG.gear.repair.timeFraction` | 50 (% of the original smithing time for a 0→100% repair; by day only) |

**Formula** (`wearLoss`, `wornDurability` in `gear.js`; `resolveBattle` in `game.js`; `repairInfo`,
`repairPlan`, `repair` in `gear.js`):

```
after each fight (win, draw or loss), every item the adventurer actually USED loses
    loss       = max(1, round1( randInt(8, 12) × tierMult[enemy tier] × (1 − min(100, GearCare%) / 100) ))
    durability = max(0, round1(durability − loss))          one decimal, no float drift
durability 0 → item destroyed (packed-but-unused items lose nothing)
Gear care XP: +100 for every fight the adventurer survives (win or draw); none when the run ends

missing     = 100 − durability                                  (fractions are fine: 89.4% → 10.6)
repair bars = ceil to 0.01 of ( slot bars × 35/100 × missing/100 )     item's material, its grade or higher (see below)
repair gem  = ceil to 0.01 of ( 1 × 35/100 × missing/100 )             only if the item has a gem; its grade or higher
repair time = by day:   round1( craftMinutes × 50/100 × missing/100 )  at camp, must end by 18:00
              at night: 0                                              battle report or plan screen
```

`resolveBattle` and the UI's wear ranges both call `wearLoss`, so what the plan screen quotes ("8.8-13.2%
per fight against an elite") is exactly what the fight takes. Durability is stored and shown with one
decimal (89.4%), and a repair quotes exactly the fractional amount it takes.

**Why 10% and why one decimal (user decision, v1.2).** The request was "about 10% a fight, scaling slightly
with the enemy's tier, and a passive Gear care skill". With whole-number losses a 1% reduction on a roll
of 10 (9.9) would round back to 10, so the first levels of Gear care would do nothing; keeping one decimal
makes every level count. Average loss per used item per fight by tier and Gear care level (mean over the
rolls 8-12; the range is the lowest to the highest roll):

| Gear care level | Normal (x1.0) | Elite (x1.1) | Champion (x1.2) |
|---|---|---|---|
| 0 | 10.0 (8.0-12.0) | 11.0 (8.8-13.2) | 12.0 (9.6-14.4) |
| 1 | 9.9 | 10.9 | 11.9 |
| 3 | 9.7 (7.8-11.6) | 10.7 (8.5-12.8) | 11.6 (9.3-14.0) |
| 5 | 9.5 | 10.5 | 11.4 |
| 8 | 9.2 | 10.1 | 11.0 |
| 10 | 9.0 (7.2-10.8) | 9.9 (7.9-11.9) | 10.8 (8.6-13.0) |

(Means of the one-decimal losses, so the steps are slightly uneven: level 2 against an elite averages 10.78.)
The bot's mean Gear care level at the end of a run is 8.2 (100 XP a fight, so level 10 comes after 55
fights).

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

**Worked examples** (iron C items, exact grade in stock; recomputed with `repairInfo`):

| Item | Durability | Bars | Gem | Time by day (at night: 0) |
|---|---|---|---|---|
| Chest | 95% | 0.06 iron C (3 × 0.35 × 0.05 = 0.0525, rounded up) | none | 1.1 min |
| Chest | 89.4% (one normal fight's wear of 10.6) | 0.12 iron C | none | 2.4 min |
| Chest | 50% | 0.53 iron C | none | 11.3 min |
| Sword + ruby B | 93.4% | 0.05 iron C | 0.03 ruby B | 1.3 min |
| Sword + ruby B | 40% | 0.42 iron C | 0.21 ruby B | 12 min |
| Boots + emerald C | 70% | 0.21 iron C | 0.11 emerald C | 6 min |

One fight's wear costs 0.07 bars on a 2-bar sword (10%), 0.11 on a 3-bar chest (10%), 0.08 on a 2-bar helmet
(11%, an elite) and 0.13 on a chest after a champion (12%).

**Lifetime.** Average wear is about 10% against a normal, 11% against an elite and 12% against a champion
(1.1: 5%), so an unrepaired item lasts about 10 / 9 / 8 fights (1.1: about 20). Repairing after every
fight costs about 3.5% of the item's bars per fight (0.35 × 10%; 1.1: 1.75%), so roughly 29 fights of
repairs cost as much as a new item (1.1: 57).

**Night repairs and the packing rule.** Wear lands at the end of the fight day, and the next plan is made
right away. An item that is packed every night is never at home during a work day, so by day it could
never be repaired; the free night repair fixes that: the battle report offers Repair buttons for the gear
just used, and the plan screen for every item, before anything is packed. In the bot runs (the bot
repairs its two best items of each slot at night once they fall below 50%, or below 30% when only a higher
grade is in stock, and never repairs by day): 15.6 repairs per run (1.1: 4.8), all at night, costing 3.8% of
the bars made (1.1: 1.4%); 2.1 of them use a higher-grade substitute (0.90 better bars per run). 4.2 items
per run are still destroyed by wear (9.2 bars, 4.8% of the bars made; by material: copper 1.1, iron 1.1, steel
2.7, **mythril 4.3** bars of the 10 mythril bars it makes). On 26.8 nights per run a worn top item has no
bars of its material at its grade or higher (49.5 item-nights), and once the finite map's mythril is gone,
mythril gear cannot be repaired at all.

**Tuning notes.** Wear and repair cost are the sinks for bars after the first sets are made. With free
night repairs only the materials count (35% of the bars for a full repair), and the real limit is having
bars of the item's grade or higher: late in a run the map's mythril is gone, so mythril gear can no longer
be repaired and wears out. At 10% a fight the upkeep is no longer a rounding error: keeping a full mythril
set whole takes about 0.39 mythril bars per fight (3.5% of its 11 bars), so the map's roughly 13 mythril
ore (about 12 bars) would pay for only about 30 fights of upkeep of one set, and a destroyed piece is
2-3 more bars. In the bot runs the average number of mythril slots (of 5, runs still alive) rises to 2.2
around day 40 and then falls to 1.8 at day 50 and 1.7 at day 60, with 4.3 mythril bars per run lost in
destroyed pieces (section "Current results"). Raising
`durabilityLoss` makes repairs a bigger drain; raising `materialFraction` makes new gear relatively cheaper
than repairs; `timeFraction` only matters for daytime repairs now. `--ablate repair`: see the results
section; the cost of skipping repairs shows in the bar bill (11.9% of the bars made instead of 4.8% go into
destroyed items) rather than in survival.

---

## 9. Adventurer base stats

| Number | Config path | Value |
|---|---|---|
| HP | `CONFIG.adventurer.hp` | 100 |
| Unarmed damage | `CONFIG.adventurer.unarmedDamage` | 11 (1.1: 4) |
| Attack interval | `CONFIG.adventurer.attackInterval` | 2.0 s |
| Accuracy | `CONFIG.adventurer.accuracy` | 100 |
| Dodge | `CONFIG.adventurer.dodge` | 100 |

**Formula** (`adventurerCombatant` in `js/core/combat.js`):

```
damage   = sword damage (replaces unarmed 11) ; no sword → 11
accuracy = 100 + sword + gloves + emerald-sword accuracy + Accuracy rings
dodge    = 100 + boots + emerald-armor dodge + Dodge rings
defense  = sum of armor defense
speed    = boots speed + Speed rings
HP       = 100 × (1 + Health rings% / 100)
pierce, pierceRes, magicPct, magicRes, stun and slow stats = gem effects + matching rings
   (Stun resistance ring adds to both stun chance and stun duration reduction; same for Slow resistance)
```

**Worked example.** Iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots:
damage 28.8 (16 × 1.5 × 1.2), accuracy 100 + 18 + 10 = 128, dodge 100 + 11 = 111, defense 9.9 + 4.8 + 2 + 2.2 =
18.9, speed 3.3%, magic 9% of weapon damage (ruby C), HP 100.

**Unarmed damage (user decision, v1.2).** An adventurer with no sword hit for 4 in 1.1, so a bare-handed
day 2 was lost in almost every fight (14 of 200 benchmark runs died on day 2). The target for 1.2 was that
an unarmed adventurer beats a typical normal enemy on day 2 in **50-65%** of fights; 11 damage gives
**61.8%** (and 20.0% against an elite, 1.9% against a champion; power report, section 1). Swords were raised
with it (10 → 16) so that a copper D sword is still a clear step up (97% vs a normal on day 2).

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

**Worked example.** Elite Ogre on day 6 (damage 8 × 1.175 = 9.4) with High Piercing (60) vs adventurer
defense 18.9 (no pierce resistance): effective defense = 18.9 × 0.40 = 7.56; physical =
9.4 × (1 − 0.0756) = **8.69** (with Normal Piercing, 25: defense 14.2 and 8.07).

**Tuning notes.** The best possible gear defense is 63% (mythril S set) and there are no defense rings, so
the cap is currently never reached. It only matters if slot defense values or multipliers go up. Enemy
defense is 25% for every tier (1.1: 20%; no daily growth).

### 10.4 Piercing and pierce resistance

Piercing = % of the defender's defense ignored. Pierce resistance = % of the *attacker's piercing* ignored
(a relative reduction, not a subtraction).

**Formula** (`hitDamage`):

```
pierce% = clamp(attacker.pierce, 0, 100) × (1 − min(defender.pierceRes, 75) / 100)
effectiveDefense = min(defender.defense, 75) × (1 − pierce% / 100)
```

- Adventurer piercing = diamond sword (15–55) + Piercing rings (6–14). Enemy pierce resistance
  (`CONFIG.enemies.attributes.pierceRes.values`) = 0 / 20 / 40 %.
- Enemy piercing (`CONFIG.enemies.attributes.piercing.values`) = 10 / 25 / 60 (1.1: 5 / 15 / 25). Adventurer
  pierce resistance = diamond armor (6–18 per piece before the slot factor, summed) + Pierce resistance
  rings (6–18), capped at 75.

**Worked examples.** Diamond S sword (55) + Piercing ring S (14) = 69 vs a champion with High pierce
resistance (40): 69 × 0.6 = 41.4% of its 25 defense ignored → effective defense 14.65, physical damage
×0.853 instead of ×0.75 (**+13.8%**).
Defending: a Pierce resistance ring S (18) + diamond S chest (18 × 1.25 = 22.5) = 40.5% against High
Piercing (60): 60 × 0.595 = 35.7% of your defense ignored instead of 60%. With a steel C set (30.8 defense)
that changes damage taken from ×0.877 to ×0.802, **8.5% less**.

**Tuning notes (user decision, v1.2: Piercing must be dangerous).** In 1.1 enemy Piercing ignored at most a
quarter of your defense, so it cost a mid-game set about 1 win point and pierce resistance protected almost
nothing. At 10 / 25 / 60 a High-Piercing elite takes a steel C set from 55.3% to 43.1% (−12.2 points) and an
iron or mythril set −11.9 / −20.5; three diamond C armor pieces plus one B Pierce resistance ring win back
62% of the steel loss (section 7). The adventurer's own piercing is capped by enemy defense (25%): at most
+33% physical damage (all 25 points ignored). A diamond S sword (55%) is worth +13.7 against a Normal-
resistance elite and +10.5 against High resistance; a Piercing ring B / S +4.8 / +6.1. Raising enemy
defense would make piercing matter more.

### 10.5 Magic damage and magic resistance

**Formula.** `magic damage = attacker.damage × magicPct/100 × (1 − min(defender.magicRes, 75)/100)`.
Magic ignores defense and piercing. Cap: `CONFIG.combat.resistCap` = 75.

- Adventurer magicPct = ruby sword (6–18) + Magic damage rings (3–7), based on the *sword's* damage
  (unarmed: 11). Enemy magic resistance (`magicRes`) = 0 / 20 / 40 (1.1: 0 / 15 / 30).
- Enemy magicPct (`magical`) = 10 / 15 / 25 % of its damage (1.1: 10 / 20 / 30). Adventurer magic
  resistance = ruby armor (4–12 per piece before the slot factor) + Magic resistance rings (4–12).

**Worked example.** Iron B sword (28.8) + ruby C (9%) vs an elite (defense 25) with Low magic resistance (0):
28.8 × 0.09 = **2.59** magic per hit on top of 28.8 × (1 − 0.25) = 21.6 physical = 24.19 total. Against
Normal magic resistance (20): 2.07 magic, 23.67 total.

**Tuning notes (user decision, v1.2).** Magic is "+X% damage that ignores defense", so it gains value as
enemy defense rises. In 1.1 High Magical (30% of its damage) was the third most dangerous attribute
(Appendix B: swing 27.0 points, behind HP and Accurate), and the retune from 20 / 30 to 15 / 25 brings it
into the same band as the other specials (swing 19.9): Normal → High costs
a steel C set 11.3 win points (iron 14.3, mythril 13.7). Because magic ignores defense and the ruby's
value scales with the sword's damage, the ruby sword gem is the strongest sword gem (C +11.7, S +21.8 in
the power report); its S value (18%) is 72% of the enemy's High value (25%). The ruby armor and Magic
resistance ring win back 59% of the steel loss at High (48% on a mythril set).

### 10.6 Stun

| Number | Config path | Value |
|---|---|---|
| Enemy stun duration | `CONFIG.enemies.stunDuration` | 1.5 s (1.1: 1.0) |
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

- Adventurer stuns come only from a topaz sword (10–30% chance, 1–1.5 s). Enemy Stun resistance
  (`stunRes`) = 0 / 20 / 40 (1.1: 0 / 25 / 50) reduces both chance and length.
- Enemy Stunning (`stunning`) = 5 / 15 / 35% per hit (1.1: 5 / 10 / 15), 1.5 s. Adventurer reduction = topaz
  armor (4–12 per piece before the slot factor, both stats) + Stun resistance rings (4–12, counted for both
  chance and length).

**Worked examples.** Topaz S sword vs Normal Stun resistance (20): 30 × 0.8 = **24%** per hit,
1.5 × 0.8 = **1.2 s**, about half an enemy attack lost per stun. High Stunning enemy (35%) vs topaz S
chest (12 × 1.25 = 15) + Stun resistance ring S (12) = 27% reduction: **25.55%** per hit, **1.095 s**.

**Tuning notes (user decision, v1.2).** A High-Stunning enemy that lands 80% of its hits costs the
adventurer about 0.8 × 35% × 1.5 s = 0.42 s per enemy attack, about 21% of its attack time (1.1: 0.8 ×
15% × 1.0 s = 0.12 s, 6%), which is why Stunning went from the mildest attribute to one of the strongest
(Appendix B: Low − High 23.4 points, was 7.1). Normal → High costs a steel C set 14.5 win points (iron
18.3, mythril 14.4); topaz armor plus a Stun resistance ring win back 82% at High (98% on mythril), and a
Stun resistance ring alone is worth +5.4 (B) / +6.8 (S) against a High-Stunning enemy. The topaz S
sword (30% for 1.5 s) is 86% of the enemy's High value. Raise `stunDuration` or the Stunning values to make
stuns matter more.

### 10.7 Slow

| Number | Config path | Value |
|---|---|---|
| Enemy slow duration | `CONFIG.enemies.slowDuration` | 2.5 s (1.1: 2.0) |

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

- Adventurer slows come from a sapphire sword (10–30% for 1.5–2 s). Enemy Slow resistance (`slowRes`) =
  0 / 20 / 40 (1.1: 0 / 25 / 50).
- Enemy Chilling (`chilling`) = 10 / 20 / 40% (1.1: 10 / 20 / 30) for 2.5 s (1.1: 2.0). Adventurer
  reduction = sapphire armor (4–12 per piece before the slot factor, both stats) + Slow resistance rings
  (6–18, both stats).

**Worked example.** High Chilling (40%) vs sapphire S chest (12 × 1.25 = 15) + Slow resistance ring A (15) =
30%: strength 40 × 0.7 = **28%**, length 2.5 × 0.7 = **1.75 s**, delay 1.75 × 28 / 128 = **0.38 s** per
landed hit. Unresisted it is 2.5 × 40 / 140 = 0.71 s per landed hit.

**Tuning notes (user decision, v1.2).** Enemy slows last 2.5 s and the enemy attacks about every 2.0 s, so an
enemy that lands most of its hits keeps the adventurer slowed nearly all the time: unresisted High
Chilling is close to −29% attack speed (1/1.4). Normal → High costs a steel C set 13.1 win points (iron
16.4, mythril 12.4); the sapphire armor and a Slow resistance ring win back all of it at High (103% on
steel, 98% on mythril), the most effective defence of the four, and a Slow resistance ring alone is worth
+2.8 (B) / +6.0 (S) against a High-Chilling enemy. The sapphire S sword (30% for 2 s) is 75% of the enemy's
High value, and a High Slow resistance cuts a C sapphire sword's gain from +10.3 to +3.4 (S: +20.6 to
+9.8). Small slows are lumpy: they only change the result when they push an attack past the moment a
fighter would have died, which is why single-day tables jump around (the appendices average a window of
days). To soften Chilling, lower its values or `slowDuration`.

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
| Win-chance guesses per enemy (`samples`) | `CONFIG.sim.samples` | 10 (1.1: 40) |
| Test fights per guess (`evalFights`) | `CONFIG.sim.evalFights` | 10 (1.1: 30) |
| Fights per loadout per guess (`fightsPerLoadout`) | `CONFIG.sim.fightsPerLoadout` | 10 (1.1: 30) |
| Battle simulation intel (extra guesses and test fights) | `CONFIG.intel.tracks.simDepth` | base 0; +10, +9, +8, ... per point (section 15) |
| Foresight smith ring (extra guesses and test fights) | `CONFIG.rings.types.foresight.values` | 2 / 3 / 4 / 5 / 6 for D / C / B / A / S (section 13) |

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

**Win-chance estimate** (`estimateWinChance`, `estimateWinChanceSync`, `simCounts` in `js/core/sim.js`; the
**Estimate all** button on the plan screen runs it for the whole roster). The size of one enemy's
estimate is `simCounts(state)`:

```
extra            = Battle simulation intel (a count, 0 / 10 / 19 / 27 / ...) + floor(Foresight ring total)
samples          = CONFIG.sim.samples         + extra        10 guesses at the start
evalFights       = CONFIG.sim.evalFights      + extra        10 test fights per guess
fightsPerLoadout = CONFIG.sim.fightsPerLoadout + extra       10 fights per gear combination
```

For each of the `samples` guesses:
1. Guess the hidden attributes: known ones are kept; hidden ones are filled at random so that the tier's exact
   low/normal/high counts still hold (e.g. an elite with 1 known High has exactly 2 more Highs among its hidden
   attributes).
2. Pick the best packed loadout for that guess (`fightsPerLoadout` fights per loadout).
3. Run `evalFights` fresh fights with it.

Reported win % = (wins + draws) / (samples × evalFights fights), plus the **margin**: the standard error of
the per-guess win fractions (`winStandardError`: the sample standard deviation of the `samples` fractions
divided by √samples, ×100; with a single guess the binomial error of its fights), shown in the game as
`max(1, round(2 × SE))` points ("62% ± 12"; the screen says it is how far the simulation alone could be off,
about 9 times in 10 when every attribute is known, and that attributes you can't see add more uncertainty;
see the worked example). Cost per
enemy: samples × (loadouts × fightsPerLoadout + evalFights) = 10 × (32 × 10 + 10) = **3,300 fights** with 32
loadouts (1.1: 40 × (32 × 30 + 30) = 39,600), 23,100 for the whole roster; in the browser it runs in steps
(one `setTimeout` per guess) with a progress bar.

| Size (guesses × test fights) | How you get it | Fights per enemy (32 loadouts) | Typical margin shown |
|---|---|---|---|
| 10 × 10 | the start | 3,300 | ± 13 (9-20) |
| 13 × 13 / 16 × 16 | one Foresight ring C / S | 5,577 / 8,448 | |
| 20 × 20 | 1 Battle simulation point | 13,200 | ± 9 |
| 29 × 29 | 2 points | 27,753 | |
| 40 × 30 | what 1.1 used | 39,600 | ± 6 |

(Margins: steel C set vs an elite on day 29, nothing scouted, 30 / 12 seeds. Two S Foresight rings give
+9 = 19 × 19; ten S rings 11.99 → +11 = 21 × 21; Battle simulation points give +10, +19, +27, +34, +40 ...)

**What an estimate cancels and keeps (UI, `js/ui/endday.js`).** Results are cached per exact selection
(enemy, the gear and ring ids, the enemy-scouting level, the three sizes), and the simulation is seeded, so
pressing the button twice gives the same numbers; the button reads "Estimated" and is disabled when all 7
are done. A run in progress is cancelled (`cancelRun`: the loop and the estimator's progress callback stop
at the next guess, nothing more is painted) when the gear or ring selection changes, when the plan is
confirmed, for a new roster or new game, and when spent intel or worn rings change the estimate key under
it; choosing another enemy column does not cancel it. Finished results are stored under their own key and
painted only if that key is still the current selection's.

**Worked example.** At a true 50% the sampling error of 100 fights is 5 points (one standard deviation),
so a 10 × 10 estimate typically reads 40-60% and shows "± 13"; 400 fights (20 × 20) halve the variance and
show about ± 9. The margin is the noise of the simulation. It is **not** the whole error against the true
chance when many attributes are hidden: at the starting 10% scouting the typical miss is 15 points (target
~55%, steel C set vs elites), because the enemy being fought is one particular completion of the hidden
attributes and no number of guesses can tell which. The same estimate made again with different random draws
would differ by about 5-7 points (the "repeat sd"; in the game the draws are seeded, so pressing the button
again gives the same numbers), so the margin and the repeat wobble agree; the error against the truth is
larger at low scouting and almost the same as the wobble at full scouting (4.6 vs 4.8). Coverage check (200 elites, steel
C set, true chance ~55%): the true chance lay inside the displayed margin for **56%** of 10 × 10 estimates
at the 10% starting scouting, 69% at 50% and 93% at 100% (about 9 in 10 is all the margin promises, even with nothing hidden); for 20 × 20 it is 44% / 46% /
94% and for 40 × 30 30% / 33% / 90%, because a bigger simulation shrinks the margin but not the guesswork
about hidden attributes. Details, by scouting level and size, in `docs/BENCHMARKS.md` ("Is 10 × 10 too
low?"). In the bot runs (which use the bot's own larger
estimate, not the in-game button) the mean estimate matched the actual win rate within about 1.5 points on
days 2-60: optimistic by 0.9 and 1.3 points on days 6-10 and 21-30, pessimistic by 1.5 on days 41-50 (96.3%
estimated vs 97.8% won) and equal on days 51-60 (86.9% vs 87.1%; the fights table under the bot summary in the results).

**Tuning notes.** More `samples` = better coverage of hidden attributes (with enemy scouting at its 10%
base, about 11 of 12 attributes are guesses) and a tighter margin; more `fightsPerLoadout` = the simulated
gear choice matches the real one (which uses 200) more often (at 10 fights per loadout the pick is noisier
than at 1.1's 30). Unlike in 1.1 these numbers are a
design choice, not just UI speed: the estimate is meant to be a little noisy, a risk the player takes (user
decision, v1.2: 10 guesses x 10 test fights per enemy, raised by a new intel track and a ring), and they do
not change any fight. The benchmark shows what the noise costs: with the bot's own larger estimate instead of
10 × 10 the 1.2 curve is 2 days of median life higher and 12 points higher at day 50 (52.0 vs 50.0; 58% vs
46%, 100 seeds). The balance tool's bot (its own estimate) estimates all 7 roster enemies every day, which
is why a 40-seed bot run takes about 2 minutes.

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
80.5–90.3% / 69.6–83.8%, damage per hit 23.2–24.2 / 8.7–11.0, attacks every 1.94 s / 1.90–2.11 s,
expected damage per second 9.6–11.3 / 2.9–4.9, HP 100 / 84.6–103.4, rough time to win 7.5–10.7 s and to
lose 20.6–34.6 s.

---

## 12. Enemies

### 12.1 Tiers and the daily roster

| Tier | Per roster | Base HP | Base damage | Defense | Low / Normal / High attributes | Score | Ring grades |
|---|---|---|---|---|---|---|---|
| Normal | 2 | 80 | 8 | 25 | 6 / 6 / 0 | 10 | D–B |
| Elite | 3 | 80 | 8 | 25 | 3 / 6 / 3 | 25 | C–A |
| Champion | 2 | 80 | 8 | 25 | 0 / 6 / 6 | 50 | B–S |

Config: `CONFIG.enemies.tiers.<tier>.{count, hp, damage, defense, levels, score}`. The level counts must
add up to 12 (the number of attributes). **All three tiers share the same base HP, damage and defense**
(user decision, commit 1e53a91: champions should not have higher HP, damage or defense than elites or
normals, because win rates against them were too low; elites were 80 / 9 / 25 and champions 90 / 10 / 30).
Version 1.2 raised the shared defense from 20% to 25% to keep the middle of the game in place after swords
and unarmed damage went up (section 6, 9). The tiers differ only by their attribute levels, their score and
their ring grades
(`CONFIG.rings.gradeWeights`, section 13). Each morning a new roster of 7 is generated for the *next*
day's fight (the player picks one that evening). Names come from `CONFIG.enemies.names` (a duplicate within a
tier is re-rolled up to 10 times). Each enemy's ring reward is rolled when the roster is made.

### 12.2 Daily growth

| Number | Config path | Value |
|---|---|---|
| HP and damage growth | `CONFIG.enemies.growthPerDay.hpDamage` | 3.5 (%/day; 1.1: 3) |
| Accuracy and dodge growth | `CONFIG.enemies.growthPerDay.ratings` | 1 (%/day) |

**Formula** (`growth`, `enemyCombatant` in `js/core/enemies.js`; *day* = the day of the fight):

```
hpDamageMult = 1 + 3.5/100 × (day − 1)        ratingMult = 1 + 1/100 × (day − 1)
HP       = tier HP × hpDamageMult × (HP attribute %)/100
damage   = tier damage × hpDamageMult
accuracy = Accurate value × ratingMult        dodge = Evasion value × ratingMult
defense  = tier defense (no growth)
```

**Enemy numbers with the HP, Accurate and Evasion attributes at Normal:**

| Day | HP/damage × | Ratings × | HP / damage (every tier) | Accuracy & dodge |
|---|---|---|---|---|
| 2 | 1.03 | 1.01 | 82.8 / 8.28 | 101 |
| 5 | 1.14 | 1.04 | 91.2 / 9.12 | 104 |
| 10 | 1.32 | 1.09 | 105.2 / 10.52 | 109 |
| 15 | 1.49 | 1.14 | 119.2 / 11.92 | 114 |
| 20 | 1.67 | 1.19 | 133.2 / 13.32 | 119 |
| 30 | 2.02 | 1.29 | 161.2 / 16.12 | 129 |
| 40 | 2.37 | 1.39 | 189.2 / 18.92 | 139 |
| 50 | 2.72 | 1.49 | 217.2 / 21.72 | 149 |
| 60 | 3.07 | 1.59 | 245.2 / 24.52 | 159 |
| 80 | 3.77 | 1.79 | 301.2 / 30.12 | 179 |

Growth is linear: HP and damage double by about day 30 and triple by day 58 (1.1: day 35 and 68). Because
both HP and damage grow, the enemy's "threat" (HP × damage) grows with the square: ×4 by day 30. Since the base numbers are
the same for every tier, the tiers differ only through their attributes: a normal has 6 Low attributes, so
a typical normal is weaker than this row (HP Low = 90%, Accurate Low = 80, ...), and a champion has 6 High
ones, so a typical champion is stronger (HP High = 110%, Accurate High = 120, ...).

**Worked example.** Elite "Ogre" on day 6 with HP Normal, Accurate Normal, Evasion High:
×1.175 / ×1.05 → HP 80 × 1.175 = **94**, damage 8 × 1.175 = **9.4**, accuracy 100 × 1.05 = **105**,
dodge 120 × 1.05 = **126**, defense 25.

**Tuning notes.** `hpDamage` is the single most important difficulty number: it sets how many days each
gear tier stays good. Moving it from 3.5 to 4 (`--set enemies.growthPerDay.hpDamage=4`) pulls the
"last day at or above the target" checkpoints of iron C vs elites, mythril C vs elites and mythril S 5–10
days earlier (iron C d15 → d10, mythril C d40 → d30, mythril S d60 → d50). Moving it down to 3 (the 1.1
value) lifts the benchmark: on the same 200 seeds the alive share at day 50 goes from 51% to 59%, at day 60
from 10% to 34% and the median life from 51 to 56 days (`docs/BENCHMARKS.md`). `ratings` keeps hit chances
from saturating as the adventurer's accuracy grows.

### 12.3 Attributes

Each enemy has 12 attributes, each Low / Normal / High (`CONFIG.enemies.attributes.<key>.values`), shown in
pairs (offense left, defense right). Levels are dealt from the tier's exact counts at random, with no
correlation between attributes.

| Pair | Offense: Low / Normal / High | Defense: Low / Normal / High |
|---|---|---|
| Piercing / Pierce resistance | 10 / 25 / 60 % of your defense ignored (1.1: 5 / 15 / 25) | 0 / 20 / 40 % of your piercing ignored |
| Magical / Magic resistance | 10 / 15 / 25 % of its damage as extra magic (1.1: 10 / 20 / 30) | 0 / 20 / 40 % magic damage reduction (1.1: 0 / 15 / 30) |
| Stunning / Stun resistance | 5 / 15 / 35 % stun chance per hit, 1.5 s (1.1: 5 / 10 / 15, 1.0 s) | 0 / 20 / 40 % less stun chance and length (1.1: 0 / 25 / 50) |
| Accurate / Evasion | 80 / 100 / 120 accuracy (× daily growth) | 80 / 100 / 120 dodge (× daily growth) |
| Chilling / Slow resistance | 10 / 20 / 40 % slower attack bar for 2.5 s on hit (1.1: 10 / 20 / 30, 2.0 s) | 0 / 20 / 40 % weaker and shorter slows (1.1: 0 / 25 / 50) |
| Fast / HP | −5 / 0 / +5 % attack speed | 90 / 100 / 110 % of base HP |

**Visibility (intel).** Each attribute gets a hidden roll of 0–100 when the roster is made. It is visible
if `roll < enemySight chance` (base 10%). The ring reward's type and grade have their own rolls and
chances (base 25% each). Because the rolls are stored, spending intel reveals more of the *current*
roster immediately. Once the fight starts, every attribute is known.

**Worked example.** At the 10% base an enemy shows on average 1.2 of its 12 attributes; at 29% (2 intel
points) 3.5; at 44% (4 points) 5.3.

**Tuning notes.** Appendix B shows how much each attribute swings a fight (Low − High, steel C set vs an
elite, average of 7 days). HP (25.8 points), Accurate (23.9) and Stunning (23.4) are the biggest,
then Chilling (21.7), Piercing (20.2) and Magical (19.9); Evasion (16.6) and Fast (13.4) are next. In 1.1
Stunning (7.1) and Piercing (16.8) were the weak ones; the four specials were retuned so each swings a
fight by about 20 points, like the HP and accuracy attributes. With equal base stats the attribute
levels are the only thing that separates the tiers. The defensive attributes only matter against the
matching adventurer gem or ring: a High resistance takes 2-12 win points off the matching sword gem
(section 7). To make an attribute matter more, widen its Low/High spread.

---

## 13. Rings

| Number | Config path | Value |
|---|---|---|
| Max rings worn | `CONFIG.rings.maxWorn` | 10 for the smith, 10 for the adventurer |
| Duplicate factor | `CONFIG.rings.duplicateFactor` | 0.5 |
| Grade odds by tier | `CONFIG.rings.gradeWeights` | normal D 60 / C 30 / B 10; elite C 60 / B 30 / A 10; champion B 60 / A 30 / S 10 |
| Types and values | `CONFIG.rings.types.<type>.values` | [D, C, B, A, S], see table |

Every defeated enemy drops one ring. Its type is uniform over all 18 types (5.6% each; 8 of 18 are smith
rings, 1.1: 17 types), its grade comes from the tier's weights. No ring on a loss or draw. Smith rings apply at once but
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
| **Foresight** (new in 1.2) | smith | 2 / 3 / 4 / 5 / 6 | extra guesses AND extra test fights per enemy in the win-chance estimate (the stacked total is rounded down; section 11). No effect in a fight |
| Piercing | adventurer | 6 / 8 / 10 / 12 / 14 | % of enemy defense ignored (1.1: 3-7) |
| Pierce resistance | adventurer | 6 / 9 / 12 / 15 / 18 | % of enemy piercing ignored (1.1: 5-10) |
| Magic damage | adventurer | 3 / 4 / 5 / 6 / 7 | % of weapon damage added as magic |
| Magic resistance | adventurer | 4 / 6 / 8 / 10 / 12 | % magic damage reduction (1.1: 3-7) |
| Stun resistance | adventurer | 4 / 6 / 8 / 10 / 12 | % less stun chance and stun length (1.1: 5-10) |
| Accuracy | adventurer | 6 / 7 / 8 / 9 / 10 | accuracy rating |
| Dodge | adventurer | 6 / 7 / 8 / 9 / 10 | dodge rating |
| Slow resistance | adventurer | 6 / 9 / 12 / 15 / 18 | % weaker and shorter slows (1.1: 5-10) |
| Speed | adventurer | 2 / 2.5 / 3 / 3.5 / 4 | % attack speed |
| Health | adventurer | 3 / 4 / 5 / 6 / 7 | % max HP |

**Stacking formula** (`ringTotals` in `js/core/rings.js`). Rings of the same type are sorted best first:

```
total = v1 × 1 + v2 × 0.5 + v3 × 0.25 + v4 × 0.125 + ...      (duplicateFactor ^ position)
```

Different types simply add up in their own formulas.

**Worked examples.** Accuracy rings S, A, B, D: 10 + 9 × 0.5 + 8 × 0.25 + 6 × 0.125 = **17.25** accuracy.
Ten Health S rings: 7 × (1 + 0.5 + … ) = **13.99%** HP (the limit is 2 × the best ring). Foresight rings S +
S: 6 + 3 = 9 extra guesses and test fights (19 × 19); S + A: 8.5, counted as 8; ten S rings: 11.99, counted
as 11. Chance that a champion drops a specific ring type at S grade: 1/18 × 10% = 0.56%.

**How strong is one ring right now?** Win-% change for a steel C full set against a typical elite on day
29 (all attributes hidden, base 44.2%; power report, ±1–2 points of noise):

| Ring | One B ring | One S ring |
|---|---|---|
| Magic damage | +6.2 | +9.0 |
| Health | +4.8 | +6.3 |
| Piercing | +4.5 | +5.5 |
| Speed | +3.8 | +5.7 |
| Dodge | +3.6 | +4.6 |
| Slow resistance | +2.8 | +3.6 |
| Accuracy | +2.2 | +2.5 |
| Pierce resistance | +1.4 | +1.9 |
| Magic resistance | +1.4 | +2.3 |
| Stun resistance | +1.2 | +2.6 |

All 10 adventurer ring types at grade B together: +30.0 points. The four resistance rings are measured
against an enemy whose matching attribute is hidden, so they look small here; against a High enemy special
they are worth more (section 7: Stun resistance +5.4 / +6.8 and Slow resistance +2.8 / +6.0 for B / S
against a High Stunning / Chilling elite).

**Tuning notes.** `duplicateFactor` decides whether stacking one type is worthwhile (0.5 = a second copy
is worth half). Grade weights set how fast ring power grows with fight difficulty; champion fights are the
only source of S rings. A level-10 skill equals a C-grade smith ring of the same kind (section 14), so
B-to-S smith rings still beat a maxed skill; adventurer rings have no skill counterpart. In the bot runs
removing rings clearly hurts (`--ablate rings`: median life 47.5 instead of 51.5, 35% alive at day 50
instead of 58%, mean score 958 instead of 1,219, and only 6.5 champion wins per run instead of 13.8). Since
the careful bot fights champions on about half of its mid-game days, their B–S rings are a large part of
its power. Foresight does nothing in a fight: a ring slot spent on it (the bot does wear them, weight 1)
is a slot not spent on Speed or Health, in exchange for a steadier estimate (section 11).
Gem luck rings upgrade cut gems on top of the gem's novice → master table (section 5); unlike Bar luck,
they have no matching skill any more (the gem grade skill blends the table instead).
Since the specials were retuned in 1.2, the Pierce / Magic / Stun / Slow resistance rings are situational
rather than dead: worth a slot against a High special you cannot avoid (sections 7 and 10.4-10.7).

---

## 14. Skills

| Number | Config path | Value |
|---|---|---|
| Max level | `CONFIG.skills.maxLevel` | 10 |
| XP curve base | `CONFIG.skills.xpBase` | 100 |
| XP per item (material skills) | `CONFIG.skills.xpPerItem` | copper 25, iron 25, steel 30, mythril 50; ruby 25, topaz 25, sapphire 30, emerald 40, diamond 50 |
| Activity skills | `CONFIG.skills.activity.<key>.perLevel` | see table (7 of them since 1.2: Gear care) |
| Gear care XP | `CONFIG.skills.gearCareXpPerFight` | 100 per fight the adventurer survives |
| Material skills | `CONFIG.skills.perMaterial.<key>.perLevel` | bar grade 0.3, failure 0.5 (refining and cutting), gem grade 10 |

**Formula** (`xpToNext`, `addXp`, `skillBonus`, `itemXp` in `js/core/skills.js`):

```
XP to go from level L to L+1 = xpBase × (L + 1)          bonus = perLevel × level
activity skills: XP = actual minutes spent (after time reductions)
                 except Debris clearing: XP = points of debris cleared (1 per point)
                 and Gear care: XP = gearCareXpPerFight (100) per fight survived (win or draw), none otherwise
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
| **Gear care** (new in 1.2) | 1 | 10% | 100 per fight survived (55 fights to level 10) | % less durability loss per used item per fight (no ring counterpart; section 8) |
| Refining speed | 0.6 | 6% | minutes refining | refining time (adds to Refining ring) |
| Cutting speed | 0.6 | 6% | minutes cutting | cutting time (adds to Refining ring) |
| Copper / Iron / Steel / Mythril bar grade (4 skills) | 0.3 | 3% | XP per bar of that type | upgrade luck for that bar (adds to Bar luck ring) |
| Copper / Iron / Steel / Mythril refining (4 skills) | 0.5 | 5 points | XP per bar of that type | failure → D for that bar |
| Ruby / Topaz / Sapphire / Emerald / Diamond grade (5 skills) | 10 | 100% (the master table) | XP per gem of that type | % of the way from the novice to the master cutting table for that gem (no ring counterpart; section 5) |
| Ruby / … / Diamond cutting (5 skills) | 0.5 | 5 points | XP per gem of that type | failure for that gem (novice 15% minus this; section 5) |

**A level-10 skill equals a C-grade ring of the same kind** (Travel C 6%, Quick search C 6%, Thorough
search C 12%, Refining C 6%, Bar luck C 3%; the Help and Skills tabs show this per skill). Two caveats:
Return travel only counts on trips that end at camp, so it is worth about half a Travel ring; and one
Refining ring covers both refining and cutting, which take two skills. Skills with no ring: Gear care (1%
less wear per level, 10% at level 10; it earns XP from fights, so it is the one activity skill that does not
grow with the work day: level 3 after 6 fights, level 5 after 15, level 10 after 55), Debris clearing
(+10% clearing power per level, twice the power at level 10), the refining failure skills (0.5 points per
level, −5 points at level 10, i.e. half of the 10% failure chance moves to D), the cutting failure skills
(0.5 points per level: gem failure 15% → 10%) and the gem grade skills (10% of the way from the novice to
the master table per level). Gem luck rings still exist and upgrade on top of the gem table. A gem's grade
and cutting skills always get the same XP, so they level together (section 5).

**Worked examples.** One search gives its minutes as XP to both Search speed and Search efficiency (30 for a
finished area, up to 48 for an all-fresh one, section 3.3); level 10 needs about 5,500 minutes of searching
(9.2 full days of nothing but searching), roughly 165 searches of the average 33 minutes (1.1: 191 searches
of 30; a few more than 5,500 / 30 because searches get faster as the skill grows and XP = minutes). Refining 60 mythril ore (failures count)
gives 3,000 XP: Mythril bar grade and Mythril refining reach level 7 = +2.1% upgrade luck and −3.5 failure
points. Cutting 60 rubies gives 1,500 XP: Ruby grade and Ruby cutting reach level 5, the halfway table
(F 12.5, D 32.5, C 25, B 16, A 9.5, S 4.5). Clearing one 40-thick debris cell gives 40 Debris clearing XP,
so level 1 (+10%) comes after two or three debris cells and level 3 (+30%, 600 XP) after about 15. A
field holds about 380 debris points, cleared over its ~36 searches, so a searcher working through whole
fields reaches level 3 after about 57 searches and level 5 after about 142 (a map holds about 7,550 debris
points, level 10 needs 5,500).

**What the bot reaches** by the end of a run (about day 52, mean levels): activity skills from 6.6 to 9.4
(search speed and efficiency 9.4, debris clearing 8.9, Gear care 8.2, cutting 7.9, refining 7.8, return
travel 6.6) and material skills from 2.4 (mythril) to 5.4 (steel); the gem skills are 1.8 (topaz) to 6.8
(diamond), so its gems end less than halfway to the master table on average (it cuts fewer gems in 1.2:
258 a run). Its smith bonuses at the end (rings + skills): search efficiency +26.9%, search time −13.8%,
refining −14.5%, cutting −14.6%, travel −8.4% (plus −4.0% on the way home), debris clearing power +89%, Gear
care −8.2% wear.

**Tuning notes.** `xpBase` scales every skill's pace; `xpPerItem` sets the material skills' pace (rarer
materials give more XP per item because there are fewer of them). `perLevel` is set so that level 10
matches a C-grade ring (change the ring's C value and the skill together to keep that rule; the Help tab
says "equals a C-grade ring" only while every matched skill is exact). The Debris clearing skill is the
exception in size (+10% per level) and gets its XP quickly early on (see the worked example); lower its
`perLevel` if clearing should stay slow for longer (the XP, 1 per point cleared, is fixed in `search`).
`gemGrade.perLevel` sets how many cuts reach the master table (10 = level 10). In the bot runs removing
skills no longer shows a loss in survival (`--ablate skills`: median 52.0 instead of 51.5, alive at day 50
60% instead of 58%, within noise; it cost 3.5 days in 1.1 and 7.5 in 1.0) and takes 30 points of mean score
(1,189 instead of 1,219): without them 6.0% of the search effort goes into debris instead of 4.0%, gems stay
on the novice table (F / D / C or better 15 / 44 / 41% instead of 13 / 35 / 52%) and wear is not reduced
(5.3 items destroyed per run instead of 4.2).

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
| **Battle simulation** base (new in 1.2) | `CONFIG.intel.tracks.simDepth.base` | 0 (not a chance: a count of extra guesses and test fights per enemy) |

**Formula** (`intelChanceFor` in `js/core/intel.js`):
`chance = min(100, base + sum of gains for points 1..n)`; the n-th point on a track gives `gainsPerPoint[n−1]`,
or 1 after the list runs out. Each track counts its own points. Battle simulation uses the same gains but its
value is a *count*: `simCounts` adds it to the base guesses and test fights (10 × 10), so 1 point = +10 (20 ×
20), 2 points = +19 (29 × 29), 3 = +27, 4 = +34, 5 = +40, 10 = +55; it is capped at +100 (55 points).

**Cumulative chance by points spent on one track:**

| Points | 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 12 | to reach 100% |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| Base 10 tracks (ore sight, enemy scouting) | 10 | 20 | 29 | 37 | 44 | 50 | 55 | 59 | 62 | 64 | 65 | 67 | 45 points (day 225) |
| Base 25 tracks (ring type, ring grade) | 25 | 35 | 44 | 52 | 59 | 65 | 70 | 74 | 77 | 79 | 80 | 82 | 30 points (day 150) |

**Worked example.** By the end of day 20 the player has earned 4 points. All four on Enemy scouting:
10 → 44%, so about 5.3 of 12 attributes are visible on each enemy. All four on Battle simulation instead:
the estimate runs 44 × 44 test fights per enemy, which steadies it but shows no new attribute.

**Tuning notes.** `daysPerPoint` is the pace; the first few points are worth the most, which favors
spreading points over tracks. The bot puts every point into enemy scouting (8.5 points a run; it never buys
Battle simulation), and `--ablate intel` is within noise (median life 53.5 instead of 51.5, mean score
1,217 instead of 1,219), because the win-chance estimate already averages over the hidden attributes.
Which track is worth a point is the 1.2 question: scouting shrinks the part of the estimate's error that
simulation cannot reach (the estimator report, 10 × 10, true chance near 55%: a typical miss of 15 points
at the 10% start, 11 at 50% sight and 5 at 100%, and a bigger simulation barely moves the first two), while
a Battle simulation point (20 × 20) only trims the wobble between estimates from about 6.8 to 4.2 points
and the miss from 15.0 to 14.2 (`docs/BENCHMARKS.md`). Lower
the scouting bases to make planning riskier; raise them to make the roster easier to read.

---

## 16. Score

| Number | Config path | Value |
|---|---|---|
| Points per win | `CONFIG.enemies.tiers.<tier>.score` | normal 10, elite 25, champion 50 |

**Formula.** Score = sum of points for every enemy defeated. A draw gives 0. A loss ends the run. The best
score is kept in the browser (localStorage) across new games.

**Worked example.** 10 days of fights: 4 normal, 5 elite, 1 champion = 40 + 125 + 50 = **215**.

**Tuning notes.** Champion = 5 normals. Since all tiers share the same base stats (session 4), a champion
is a fair fight for good gear: the careful bot's best estimate against a champion on its roster is 95–98%
on days 7–30 (it was 55–77% on days 7–30 with the old 90 / 10 / 30 champions), so it takes a champion on
about 60% of days 11–30 (1.1: 70%), wins 13.8 per run (0.3 with the old champions) and scores 1,219 on
average (777 with the old champions; 1,192 in 1.1 on the same 40 seeds). Champions are still a real risk
early and late (the bot's best champion estimate is 78% on day 2, 90% on day 3, 72% on day 40 and 34% on day
50). If champions
should be a rarer, riskier pick again without touching base stats, lower this score, lower their ring
grades (`CONFIG.rings.gradeWeights.champion`) or widen the High attribute values (12.3). `--minwin` and
`--future` let the bot test riskier or safer play.

---

## Appendix A — Power curve snapshot

Win % of a loadout against a typical enemy of each tier (all attributes hidden, 100 attribute guesses ×
50 fights per cell; 200 guesses for the day-2 table). Generated with `node tools/balance.mjs --section power`
(deterministic: the same config always prints the same numbers). Version 1.2 changed the damage scale (sword
16, unarmed 11), enemy defense (25%), daily growth (3.5%) and the four specials, so every table below moved
from 1.1.

**Day-2 fight with day-1 gear** (targets: unarmed vs a normal 50–65%; sets: normal 95–100%, elite 75–95%,
champion 40–75%)

| Day-1 loadout | vs normal | vs elite | vs champion |
|---|---|---|---|
| Unarmed, no gear | 61.8 | 20.0 | 1.9 |
| Copper D sword | 96.9 | 76.2 | 36.5 (below the band) |
| Copper C sword | 98.9 | 84.7 | 46.9 |
| Copper C sword + C boots | 99.6 | 90.7 | 59.2 |
| Copper C sword + C chest | 99.3 | 87.8 | 51.6 |
| **Copper C sword + C chest + C boots** (reference) | 99.8 | 93.5 | 65.3 |
| Copper D sword + D helmet + D gloves | 98.7 | 83.5 | 44.6 |
| Copper B sword + B chest + B boots | 99.9 | 97.1 (above) | 78.1 (above) |
| Copper C sword + ruby C + C boots | 99.8 | 95.0 | 71.4 |
| Copper C full set (lucky day 1) | 100.0 | 96.1 (above) | 74.5 |
| Iron C sword + copper C boots | 100.0 | 99.3 (above) | 93.0 (above) |

**vs Normal** (base HP 80, damage 8, defense 25%, +3.5%/day HP and damage, +1%/day accuracy and dodge)

| loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Unarmed | 62.3 | 28.7 | 2.7 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D sword only | 96.8 | 86.0 | 42.5 | 9.3 | 1.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D full | 99.9 | 97.9 | 75.0 | 28.5 | 6.6 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper B full | 100.0 | 99.8 | 93.4 | 59.7 | 22.9 | 1.1 | 0.0 | 0.0 | 0.0 | 0.0 |
| Iron C full | 100.0 | 100.0 | 99.9 | 96.6 | 84.8 | 21.0 | 2.0 | 0.0 | 0.0 | 0.0 |
| Steel C full | 100.0 | 100.0 | 100.0 | 99.9 | 99.2 | 79.9 | 28.0 | 5.0 | 0.3 | 0.0 |
| Mythril C full | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.8 | 97.7 | 80.4 | 39.8 | 3.5 |
| Mythril S full | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.7 | 96.3 | 58.4 |
| Iron C + ruby C sword | 100.0 | 100.0 | 99.9 | 98.6 | 90.7 | 38.6 | 4.5 | 0.2 | 0.0 | 0.0 |
| Iron C + diamond C sword + emerald C armor | 100.0 | 100.0 | 99.9 | 99.4 | 94.8 | 51.3 | 9.2 | 0.8 | 0.1 | 0.0 |
| Steel C + ruby C sword + 10 C rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 97.2 | 73.7 | 25.7 | 5.8 | 0.1 |
| Mythril C + ruby B sword + 10 B rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.9 | 97.8 | 85.2 | 24.4 |
| Ceiling: Mythril S + ruby S + emerald S armor + 10 S rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 98.6 |

**vs Elite** (same base stats; 3 Low / 6 Normal / 3 High attributes)

| loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Unarmed | 21.2 | 5.5 | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D sword only | 77.2 | 48.7 | 11.2 | 1.4 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D full | 92.3 | 75.0 | 30.6 | 6.2 | 0.7 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper B full | 98.5 | 91.9 | 57.9 | 19.8 | 4.9 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 |
| Iron C full | 99.9 | 99.6 | 94.9 | 76.1 | 45.5 | 3.7 | 0.3 | 0.0 | 0.0 | 0.0 |
| Steel C full | 100.0 | 100.0 | 99.8 | 97.9 | 88.6 | 39.8 | 7.3 | 0.4 | 0.0 | 0.0 |
| Mythril C full | 100.0 | 100.0 | 100.0 | 100.0 | 99.6 | 95.0 | 73.3 | 32.7 | 10.3 | 0.2 |
| Mythril S full | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.9 | 98.2 | 87.9 | 70.0 | 15.3 |
| Iron C + ruby C sword | 100.0 | 99.8 | 97.2 | 83.5 | 55.8 | 7.1 | 0.6 | 0.0 | 0.0 | 0.0 |
| Iron C + diamond C sword + emerald C armor | 100.0 | 100.0 | 98.3 | 88.1 | 66.2 | 14.1 | 1.6 | 0.1 | 0.0 | 0.0 |
| Steel C + ruby C sword + 10 C rings | 100.0 | 100.0 | 100.0 | 99.9 | 97.9 | 77.9 | 31.1 | 4.9 | 0.9 | 0.0 |
| Mythril C + ruby B sword + 10 B rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.7 | 95.7 | 76.7 | 45.0 | 4.1 |
| Ceiling: Mythril S + ruby S + emerald S armor + 10 S rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.8 | 99.2 | 81.3 |

**vs Champion** (same base stats; 6 Normal / 6 High attributes)

| loadout | d2 | d5 | d10 | d15 | d20 | d30 | d40 | d50 | d60 | d80 |
|---|---|---|---|---|---|---|---|---|---|---|
| Unarmed | 2.0 | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D sword only | 37.6 | 11.2 | 1.2 | 0.1 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper D full | 64.8 | 31.8 | 4.9 | 0.5 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Copper B full | 86.3 | 60.9 | 19.5 | 3.4 | 0.4 | 0.0 | 0.0 | 0.0 | 0.0 | 0.0 |
| Iron C full | 98.5 | 94.7 | 71.7 | 37.7 | 10.7 | 0.2 | 0.0 | 0.0 | 0.0 | 0.0 |
| Steel C full | 99.9 | 99.7 | 95.9 | 84.8 | 55.8 | 10.4 | 0.6 | 0.0 | 0.0 | 0.0 |
| Mythril C full | 100.0 | 100.0 | 100.0 | 99.1 | 97.3 | 70.1 | 30.0 | 6.5 | 0.7 | 0.0 |
| Mythril S full | 100.0 | 100.0 | 100.0 | 100.0 | 99.9 | 97.6 | 86.8 | 52.3 | 26.1 | 1.5 |
| Iron C + ruby C sword | 99.3 | 96.9 | 79.0 | 46.6 | 15.8 | 0.5 | 0.0 | 0.0 | 0.0 | 0.0 |
| Iron C + diamond C sword + emerald C armor | 99.4 | 98.4 | 85.8 | 59.6 | 26.5 | 2.1 | 0.1 | 0.0 | 0.0 | 0.0 |
| Steel C + ruby C sword + 10 C rings | 100.0 | 100.0 | 99.7 | 96.5 | 84.5 | 36.0 | 5.3 | 0.3 | 0.0 | 0.0 |
| Mythril C + ruby B sword + 10 B rings | 100.0 | 100.0 | 100.0 | 100.0 | 99.8 | 96.6 | 71.4 | 37.8 | 9.9 | 0.3 |
| Ceiling: Mythril S + ruby S + emerald S armor + 10 S rings | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 100.0 | 99.8 | 97.5 | 89.2 | 41.9 |

**Weakest plain full set (no gems, no rings) that keeps a target win rate**

| day | normal >=90% | elite >=70% | champion >=50% |
|---|---|---|---|
| day 2 | copper D (100%) | copper D (92%) | copper D (62%) |
| day 3 | copper D (99%) | copper D (89%) | copper D (50%) |
| day 5 | copper D (98%) | copper D (73%) | copper B (61%) |
| day 7 | copper D (91%) | copper B (86%) | iron D (80%) |
| day 10 | copper B (93%) | iron D (88%) | iron D (58%) |
| day 12 | iron D (98%) | iron D (80%) | iron C (57%) |
| day 15 | iron D (93%) | iron C (77%) | iron B (51%) |
| day 20 | iron B (93%) | iron A (73%) | steel C (56%) |
| day 25 | steel C (95%) | steel B (78%) | steel A (51%) |
| day 30 | steel B (92%) | mythril D (88%) | mythril D (56%) |
| day 40 | mythril C (97%) | mythril C (72%) | mythril A (64%) |
| day 50 | mythril B (91%) | mythril A (72%) | mythril S (52%) |
| day 60 | mythril S (97%) | none (myth S 66%) | none (myth S 29%) |
| day 70 | none (myth S 85%) | none (myth S 43%) | none (myth S 8%) |
| day 80 | none (myth S 59%) | none (myth S 15%) | none (myth S 2%) |

Reading it: the elite column trails the progression target by about 5–10 days (copper D to B on days 2–7,
iron D to C on days 10–15, iron A on day 20, steel B on day 25, mythril D on day 30, mythril C on day 40,
mythril A on day 50, against a target of iron day 5–8, steel day 12–18, mythril day 25+), so gear made on
pace beats elites with room to spare, more than in 1.1 (iron C held 70% until day 10 then, day 15 now). The
champion column (a 50% target) asks for one grade or material step more than the elite column on the same
day (for example steel C instead of iron A on day 20, mythril A instead of mythril C on day 40). Gems
(especially a ruby sword) and rings add a lot on top (sections 7 and 13); from day 60 even mythril S no
longer holds 70% against elites.

## Appendix B — How much each enemy attribute matters

Steel C full set (no gems, no rings) vs an elite on the seven days 26–32 around day 29, the day the power
report uses for its gem, ring and slot tables (a single day is too lumpy: this set falls from 69% on day 27
to 46% on day 29 and 30% on day 31 against an all-Normal elite, so every cell averages 10,000 fights on each
of the 7 days with the same random numbers). All attributes Normal except the one listed. Baseline
(all Normal): **48.4%** win.

| Attribute | Low | Normal | High | Low − High |
|---|---|---|---|---|
| HP | 61.4% | 48.4% | 35.6% | 25.8 |
| Accurate | 62.7% | 48.4% | 38.8% | 23.9 |
| Stunning | 57.6% | 48.4% | 34.2% | 23.4 |
| Chilling | 57.5% | 48.4% | 35.8% | 21.7 |
| Piercing | 56.8% | 48.4% | 36.6% | 20.2 |
| Magical | 57.3% | 48.4% | 37.3% | 19.9 |
| Evasion | 56.8% | 48.4% | 40.2% | 16.6 |
| Fast | 57.7% | 48.4% | 44.3% | 13.4 |
| Pierce res., Magic res., Stun res., Slow res. | 48.4% | 48.4% | 48.4% | 0 (no matching gear) |

(1.1, day 24, single day: HP 34.1, Accurate 32.1, Magical 27.0, Fast 20.4, Chilling 18.3, Evasion 18.2,
Piercing 16.8, Stunning 7.1. The four specials now swing a fight by 20–23 points, like HP and Accurate.)

Defensive attributes against a matching C sword gem (same set, same 7 days):

| Sword gem | vs attribute | Low | Normal | High |
|---|---|---|---|---|
| Diamond C | Pierce resistance | 60.2% | 59.2% | 57.6% |
| Ruby C | Magic resistance | 61.8% | 60.8% | 59.8% |
| Emerald C | Evasion | 61.4% | 55.6% | 48.8% |
| Sapphire C | Slow resistance | 58.6% | 55.5% | 51.3% |
| Topaz C | Stun resistance | 56.4% | 54.2% | 52.1% |

## Appendix C — Worked fight, start to finish

Adventurer: iron B sword + ruby C, iron C chest, copper B helmet, copper D gloves, copper C boots
(damage 28.8, accuracy 128, dodge 111, defense 18.9, speed 3.3%, magic 9%, HP 100).
Enemy: elite Ogre, day 6; Piercing High, Pierce res Normal, Magical Normal, Magic res Low, Stunning Low,
Stun res Normal, Accurate Normal, Evasion High, Chilling Low, Slow res Normal, Fast Normal, HP Normal
(HP 94, damage 9.4, accuracy 105, dodge 126, defense 25).
(The attribute mix above, 3 Low / 7 Normal / 2 High, is illustrative: an actual elite always rolls exactly
3 Low / 6 Normal / 3 High.)

| Step | Adventurer → Ogre | Ogre → Adventurer |
|---|---|---|
| Hit chance | 128² / (128² + 0.25 × 126²) = 80.5% | 105² / (105² + 0.25 × 111²) = 78.2% |
| Piercing | none | 60 × (1 − 0) = 60% |
| Effective defense | 25% | 18.9 × 0.40 = 7.56% |
| Physical per hit | 28.8 × 0.75 = 21.6 | 9.4 × 0.924 = 8.69 |
| Magic per hit | 28.8 × 9% × (1 − 0) = 2.59 | 9.4 × 15% × (1 − 0) = 1.41 |
| Total per hit (before the 90–110% roll) | 24.19 | 10.10 |
| Attack every | 2 / 1.033 = 1.94 s | 2.0 s |
| Expected damage per second | 0.805 × 24.19 / 1.936 = 10.06 | 0.782 × 10.10 / 2 = 3.95 |
| Time to win | 94 / 10.06 ≈ 9.3 s | 100 / 3.95 ≈ 25.3 s |
| Side effects | none | 5% stun chance per hit (1.5 s); every hit slows the adventurer 10% for 2.5 s (≈ 0.23 s delay each) |

Simulated with the attributes known: **99.9%** win (50,000 fights on each of three seeds: 99.8–99.9%),
average fight about 11 s. (In 1.1 the same fight was a 99.0% win with a 15.9 s average fight: the bigger
sword, 28.8 damage instead of 18, ends it in 9 s of expected time instead of 14, while the Ogre's expected
damage per second only rises from 3.80 to 3.95.) This is a deliberately easy day-6 fight with iron-and-copper
gear; a fight near the 50% line looks the same on paper and then turns on the stuns, slows and damage rolls
that the table leaves out.
