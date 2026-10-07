# Smithsy — Handoff

Everything needed to pick this project up in a fresh session.

## What it is
Browser game: you mine ore/gems on a 5x5 world map of 8x8 fields, refine and smith gear, and each
night plan your adventurer's next fight (1 enemy from a roster of 7). A loss is game over; score is
endless. Plain HTML + ES modules, no build step, hosted on GitHub Pages
(<https://henryyang89.github.io/smithsy/> once Pages is enabled for branch
`claude/miner-blacksmith-game-tzd15o` or `main`, folder `/ (root)`; see README). Save in localStorage.

## Where things are
| Path | What |
|---|---|
| `js/config.js` | **Every tunable number.** Edit here to rebalance. |
| `docs/BALANCE.md` | Explains every number, formula, worked examples, tuning notes, current balance results. |
| `docs/SPEC.md` | Requirements + all design decisions agreed with the user. |
| `js/core/` | DOM-free game logic (works in Node). `game.js` = state, day flow, battle resolution, save. |
| `js/core/map.js` | World map, fields, travel, search (depth mechanic, 35% ± 5 per cell; `searchEfficiencyRange`), debris, nightly regrowth (off), bag. |
| `js/core/processing.js` | Refining/cutting, grade distributions (fail reduction + upgrade luck). |
| `js/core/gear.js` | Gear stats, crafting, repair (`isNight`, `repairPlan`: free at night, higher-grade substitutes; `substituteWarning`). |
| `js/core/combat.js` | Combatant stats, hit chance S-curve, event-driven attack-bar fight sim with log. |
| `js/core/sim.js` | Best-gear selection and win-chance estimate (samples hidden enemy attributes). |
| `js/core/enemies.js` | Roster generation, attribute levels, visibility, enemy stats. |
| `js/core/rings.js`, `skills.js`, `intel.js`, `bonuses.js` | Rings (stacking), skills (XP), intel points, combined smith bonuses. |
| `js/main.js` | UI shell (top bar, tabs, side log, phase screens, save). |
| `js/ui/*.js` | One module per screen; `endday.js` = battle report + plan screen (incl. Matchup table and night repairs); `repairui.js` = repair widgets shared by the workshop and the night screens; `skillsview.js` also holds the skill-vs-ring helpers used by Help; `dom.js` = tiny `h()` helper. |
| `tests/` | `npm test` (= `node --test tests/*.test.mjs`), 235 tests. |
| `tools/balance.mjs` | Balance report: economy (incl. map size), power curve, bot playthrough (incl. "Map supply"); `--set` what-ifs, `--ablate` systems, `--immortal`. |

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
- Adventurer brings home a ring only. Simple 20-slot bag (1 item per slot). Unlimited camp storage.
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
  failure reduction 0.5 per level (−5 points).
- **Repairs at night cost no time** (battle report and plan screen, which both have Repair buttons);
  daytime repairs still cost time at camp.
- **A higher grade can substitute in repairs:** the exact grade if there is enough, else the lowest higher
  grade with enough (bars and gem chosen separately), with a warning; no benefit from the higher grade
  (`repairPlan` / `substituteWarning` in gear.js). Grades are never combined.
- **Keep the pacing** after these changes. Done with richer cells (the values are ours):
  `field.lootChance` 50/5/80 (was 40/5/70) and `field.itemCountWeights` 1:30 / 2:40 / 3:30 (was 50/35/15).
  Items per search stay within ~10% of before; the map now holds ~1,557 items (was ~1,080).

Adjustment the user asked for in session 4 (commit 1e53a91):
- **Enemy tiers share base stats** ("Champions shouldn't have higher HP, damage, or defense than the elites
  or normals. The win rate is too low."): all three tiers now have base HP 80, damage 8, defense 20% (was
  normal 80/8/20, elite 80/9/25, champion 90/10/30). Tiers differ only by attribute levels (normal 6 low /
  6 normal; elite 3 low / 6 normal / 3 high; champion 6 normal / 6 high), score (10 / 25 / 50) and ring
  grades (D–B / C–A / B–S). Target the user chose: champions ~30–40% win with on-pace gear, elites ~60–70%,
  normals 90%+, erring on the high side because the user wanted higher win rates. Result with plain C sets
  late in each material window (iron C day 10, steel C day 20, mythril C day 40): champions 48 / 32 / 21%,
  elites 83 / 74 / 63%, normals 99 / 95 / 92% (details in BALANCE "Balance targets and current results").

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
  search, Search efficiency ↔ Thorough search, Refining speed and Cutting speed ↔ Refining ring, bar/gem
  grade skills ↔ Bar/Gem luck. Return travel matches the C ring's 6% but only counts on trips to camp.
- Ore sight = chance per searched cell to reveal what's left in it (intel track + smith ring points).
- "Refining time" smith ring applies to refining and cutting.
- Sapphire armor "debuff reduction" = slow strength + slow duration reduction.
- Topaz/Sapphire armor: two stats with the same table values. Stun / Slow resistance rings count for both.
- Upgrade luck: after a successful roll, X% chance to go up one grade (S stays S).
- Skill "fail reduction" moves failure % into D.
- The debris clearing skill has no ring counterpart (the user's ring list has none).
- Duplicate rings beyond the 3rd keep halving (12.5%, ...).
- Debris cells are 20 points more likely to hold items.
- The day does not auto-end at 18:00; the player presses End day at camp. Past 18:00 only the walk home
  (and free pick-up/drop) is possible.
- Smith rings apply at once but lock once the day's first action happens (changeable at 8:00 at camp
  or while planning at night); otherwise swapping before every action made the 10-ring limit meaningless.
  Adventurer ring toggles on the Rings tab outside the plan only change tonight's default selection, never
  today's fight (during planning they are mirrored into the plan selection).
- Free pick-ups are time-limited (see SPEC "Bag"); a specific ground item can be picked up by clicking it.
- Ore sight only rolls on cells the search did not finish (still below 100%), so it is not wasted on
  finished cells.
- Confirmations: End day with 30+ minutes left; confirming a plan that packs nothing / leaves an owned
  slot empty / has an estimated win chance under 50%.
- A ring won today is pre-selected in tonight's plan when there is a free ring slot.
- During report/plan/game over, the Rings, Skills & Intel, Log and Help tabs stay available.

## Balance status (current config, commit 1e53a91)
Run `node tools/balance.mjs --section economy`, `--section power` and `--section bot --seeds 40`
(`--immortal` for how long the map lasts); details and tables in `docs/BALANCE.md` → "Balance targets and
current results".

```
ECONOMY SUMMARY | items/search by dist d1:1.78 d2:1.88 d3:2.13 d4:2.30 d5+:2.45 | one trip d1/d3: 255/307 min
for 20.0/20.0 items | field min per unit: copper 25, iron 58, steel pair 142, mythril 520, any gem 49 |
full set >=D work days: copper 1.2, iron 2.0, steel 4.0, mythril 12.5 | map items/run 1557 (mythril 12.0, coal 120) |
regrow off

POWER SUMMARY | day-2 ref (Copper C sword + C chest + C boots) n/e/c 93/63/22% | Cu D sword n/e/c 66/26/4% |
last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d2, Iron C d10, Steel C d20, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80 100/97%

BOT SUMMARY | alive d10:95% d20:90% d30:85% d40:78% d50:65% d60:10% d80:0% | median life 53.5 | score 1323 |
d2 typical est n/e/c 93/68/32 | first iron/steel/myth piece d3/8/17 | 3-slot iron/steel/myth d6/12/26 |
d11-30 fights n/e/c 2/26/72% | mining 65% trips/day 1.3 idle 18m | repair 1.5% bars 0.0% time, 5.1 night/run
(1.1 subst.) | map found d40:74% d60:94% d80:-%
```

- **Win rates (session 4, equal tier base stats):** plain C sets late in each material window (iron C
  day 10, steel C day 20, mythril C day 40) win 48 / 32 / 21% vs champions, 83 / 74 / 63% vs elites and
  99 / 95 / 92% vs normals (target: champions ~30–40%, elites ~60–70%, normals 90%+, erring high). The
  day-2 reference set went from 93 / 37 / 1% to 93 / 63 / 22%; the normal tier did not change.
- **The careful bot now picks champions on most mid-game days** (47% of fights on days 6–10, ~70% on days
  11–30; was 0–3%): with gems, rings and the better of two champions its best champion estimate is 93–98%
  on days 7–35, and a champion gives 50 points and B–S rings at acceptable risk. It wins 16.5 champions per
  run (was 0.3) and scores 1,323 on average (was 777); per-fight losses on days 11–40 rose to 0.5–0.9%
  (was 0.3–0.5%) and 9 of 40 runs die before day 40 (was 5). Possible future lever if champions should
  be rarer: champion score / ring value or attribute values, not base stats (the user wants those equal).
- Other targets: iron ~day 3–6, steel ~day 8–12, mythril ~day 17–26 (on target); careful-bot median life
  53.5 days, 31 of 40 deaths after day 40. The weakest plain set that keeps 70% vs elites now trails the
  progression by ~5 days (on-pace gear has room to spare). The tool's `DAY2_TARGET` now uses the
  session-4 bands (normal 85–98%, elite 50–75%, champion 15–40%); the reference set is inside all three.
- **Map exhaustion:** with no regrowth coal and mythril run low around day 50–55 (the bot has found 74% of
  the map by day 40, nearly all its ~13 mythril, and 90% by day 50; with `--immortal` finds drop from ~25 a
  day to ~3 after day 50 and gear stops improving), so even a perfect player hits a wall around day 55–70.
  Regrowth can be re-enabled via `CONFIG.field.regrowPctPerDay` (at 5: the bot keeps finding ~27 items a
  day, median life 58.5 instead of 53.5, 48% alive at day 60 instead of 10%), so the map is now one of the
  careful bot's limits.
- Ablations (40 seeds): `--ablate rings` (median 45, score 783), `--ablate gems` (median 46, almost every
  run dies on days 40–50) and `--ablate skills` (median 46, score 1,158) clearly hurt; repair (49) is a
  small loss; intel (52.5) is within noise.

## Known concerns / ideas
- **The finite map caps runs.** Fields do not regrow (user decision), so a map's ~1,560 items (~13 mythril,
  ~122 coal) are the whole run. Coal and mythril run low around day 50–55 and a perfect player hits a wall
  around day 55–70; a matched mythril C-or-better set alone needs ~26 mythril on average, twice what a map
  holds. The careful bot dies around the same time (median 53.5) and regrowth at 5% would gain it ~5 days,
  so the map is now one of its limits. Options (the user's call): turn regrowth back on
  (`CONFIG.field.regrowPctPerDay`), add mythril, or keep the cap as a natural run length.
- **Repairs never combine grades.** A repair takes the whole amount from one grade (exact, else the lowest
  higher grade with enough), so 0.30 C + 0.30 B bars cannot pay a 0.42-bar repair and small leftovers of
  different grades pile up. The bot has no usable bars for a worn top item on ~18 nights per run (mostly
  mythril once the map's mythril is gone) and still loses 1.5 items per run to wear. Combining grades would
  need the user's OK.
- **The Return travel skill only applies to trips to camp.** At level 10 it equals a C-grade Travel ring
  in number (6%) and the UI says so, but the ring counts on every trip, so the skill is worth about half a
  ring. Apply it to all travel (or double it) if the user wants an exact match.
- **Repairs now matter a little.** Free night repairs replaced the old packing problem (best gear was never
  home by day): 5.1 repairs per run, all at night, 1.5% of bars; `--ablate repair` costs ~4.5 days of
  median life (a small loss).
- **Pierce resistance and stun resistance are low value.** Enemy Piercing ignores at most 25% of your
  defense and Stunning is 5–15% for 1 s, so the Pierce/Stun resistance rings add ~0.4–1.6 win-% points
  and diamond/topaz armor almost nothing. Raise enemy Piercing/Stunning values to make them matter. With
  enemy defense at 20% for every tier, adventurer piercing is also modest now (the diamond sword is fourth
  of five sword gems; a Piercing ring adds +1.3–1.4).
- **Late game is mostly mining, then nothing to mine.** The bot's mining share (travel + search + clear)
  is 63% on days 11–20 and 75–82% on days 21–40; after day 40 the map runs dry and it spends ~190 min a day
  cutting stockpiled gems.
- **Skills and intel:** skills now match C-grade rings; `--ablate skills` costs ~7.5 days of median life and
  ~165 points of score (was ~2 days before the tier change). Intel still shows no measurable effect for the
  bot (the estimate already averages hidden attributes). Gems clearly pay (`--ablate gems`: median 46
  instead of 53.5 and almost every run dies on days 40–50; without gems the bot has nothing worth doing
  after mythril and idles most of the day).
- **Win-chance estimate cost:** up to 40 × (32 × 30 + 30) = 39,600 fights per estimate (~0.1 s in Node,
  longer in the browser, with a progress bar). The real battle's gear choice runs 32 × 200 fights. The bot
  estimates all 7 enemies daily, so a 40-seed bot run takes ~3 min.
- **Champions are the careful bot's main mid-game pick** since the tiers share base stats (session 4): best
  estimate 93–98% on days 7–35, ~70% of its fights on days 11–30, 16.5 champion wins per run. If the user
  wants champions to stay a rare, risky pick, the levers are the champion score, its ring grades
  (`CONFIG.rings.gradeWeights.champion`) or the attribute values, not base stats.
- Enemy growth is linear and unbounded while gear tops out at mythril S: every run ends (intended).
- About 0.7% of maps have a single distance-4+ field (the only mythril source); ~0.01% have none.
- Bot results are noisy (chaotic runs): compare what-ifs with `--seeds 40` or more.

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
  (Update this section each session.)
