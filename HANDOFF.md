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
| `js/core/map.js` | World map, fields, travel, search (depth mechanic), debris, nightly regrowth, bag. |
| `js/core/processing.js` | Refining/cutting, grade distributions (fail reduction + upgrade luck). |
| `js/core/gear.js` | Gear stats, crafting, repair. |
| `js/core/combat.js` | Combatant stats, hit chance S-curve, event-driven attack-bar fight sim with log. |
| `js/core/sim.js` | Best-gear selection and win-chance estimate (samples hidden enemy attributes). |
| `js/core/enemies.js` | Roster generation, attribute levels, visibility, enemy stats. |
| `js/core/rings.js`, `skills.js`, `intel.js`, `bonuses.js` | Rings (stacking), skills (XP), intel points, combined smith bonuses. |
| `js/main.js` | UI shell (top bar, tabs, side log, phase screens, save). |
| `js/ui/*.js` | One module per screen; `endday.js` = battle report + plan screen (incl. Matchup table); `dom.js` = tiny `h()` helper. |
| `tests/` | `npm test` (= `node --test tests/*.test.mjs`), 209 tests. |
| `tools/balance.mjs` | Balance report: economy, power curve, bot playthrough; `--set` what-ifs, `--ablate` systems. |

## Design decisions (from Q&A with the user)
- One enemy per day from a new daily roster (2 normal, 3 elite, 2 champion). No skipping.
- Loss = game over. Endless, score-based. No fight time limit (internal safety cap only; counts as a
  draw: survive, no ring, no score).
- Day 1: adventurer rests. The plan for day N+1 (enemy, up to 2 gear per slot, up to 10 rings) is made at
  the end of day N. The roster is visible in the morning for planning.
- The adventurer is away all of day N+1 with the packed gear; only unpacked gear can be repaired.
- When the fight starts the adventurer sees the real attributes and uses the best packed item per slot.
- Optional win-chance simulation (player clicks); samples hidden attributes respecting tier counts and
  optimizes the gear for each sample.
- Adventurer brings home a ring only. Simple 20-slot bag (1 item per slot). Unlimited camp storage.
- Persistent 5x5 map, camp in center, 4 blocked cells; travel time by path distance; map shows how much
  of each field is searched; farther fields are richer.
- Elite attribute split fixed to 3 low / 6 normal / 3 high (user's 3/9/3 summed to 15).
- Plain HTML/JS for GitHub Pages.

## Interpretations made without asking (flag to user if they disagree)
- **Search depth model:** each item has a hidden depth 0–100; a cell's "% searched" rises by the search
  efficiency (50%) each search, so **2 searches finish a cell**; items are found when % searched passes
  their depth. Efficiency bonuses move items into the first search rather than removing the second.
- **Field regrowth 5%/night:** every searched cell has a 5% chance each night to become a fresh,
  unsearched cell with new hidden contents (ground items stay). Not in the original request; added so the
  endless game never runs out of ore.
- **Ore mix by distance:** no coal next to camp, mythril only at distance 4+ (farthest fields).
- **Attack-bar combat model:** each side's bar fills in `interval / (1 + speed%)` and attacks when full.
  Slow = the bar fills X% slower for the duration; stun = the bar stops filling for the duration. Neither
  stacks (a new stun extends to the later end time; a new slow keeps the stronger strength and the later
  end). Ties: the adventurer attacks first.
- **Relative pierce resistance:** pierce resistance ignores a % of the attacker's piercing (not points
  subtracted). Piercing ignores a % of the defender's defense.
- **Enemy tiers:** base HP/damage close together (80/8, 80/9, 90/10) because the attribute levels
  (6 low … 6 high) drive difficulty; defense 20/25/30% by tier. Daily growth: HP and damage +3%/day,
  accuracy and dodge +1%/day (linear), otherwise late-game hit chances saturate.
- **Enemy Fast / HP steps:** small (±5% speed, 90/100/110% HP) as the user suggested.
- **Gem rebalance (sword):** ruby 5–15% magic (halved), emerald 20–60 accuracy and diamond 20–60% piercing
  (doubled), topaz 10–20% stun for 1–1.5 s, sapphire unchanged; aimed at ruby ≈ diamond ≈ sapphire swords.
- **Processing times:** copper 15, iron 20, steel 25, mythril 30 min per bar; gems 20 min ("slightly more
  time for better ores"); smithing 15 min per bar, +10 min to infuse a gem.
- **Durability:** only gear actually USED in the fight loses durability (packed-but-unused gear doesn't
  wear). Repairs take 50% of the craft time × fraction repaired; smithing has no skill.
- Ore sight = chance per searched cell to reveal what's left in it (intel track + smith ring points).
- "Refining time" smith ring applies to refining and cutting.
- Sapphire armor "debuff reduction" = slow strength + slow duration reduction.
- Topaz/Sapphire armor: two stats with the same table values. Stun / Slow resistance rings count for both.
- Upgrade luck: after a successful roll, X% chance to go up one grade (S stays S).
- Skill "fail reduction" moves failure % into D.
- The debris clearing skill has no ring counterpart (the user's ring list has none).
- Skills are deliberately weak: a level-10 skill is a bit weaker than a D-grade ring of the same kind.
- Duplicate rings beyond the 3rd keep halving (12.5%, ...).
- Debris cells are 20 points more likely to hold items.
- The day does not auto-end at 18:00; the player presses End day at camp. Past 18:00 only the walk home
  (and free pick-up/drop) is possible.
- Smith rings apply at once. Adventurer ring toggles on the Rings tab outside the plan only change
  tonight's default selection, never today's fight.
- During report/plan/game over, the Rings, Skills & Intel, Log and Help tabs stay available.

## Balance status (current config, commit 22b062f)
Run `node tools/balance.mjs --section power` and `--section bot --seeds 24`; details and tables in
`docs/BALANCE.md` → "Balance targets and current results".

```
POWER SUMMARY | day-2 ref (Copper C sword + C chest + C boots) n/e/c 93/37/1% | Cu D sword n/e/c 66/10/0% |
last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d20, Mythril C d40, Mythril S d60 |
>=70% vs elite: Copper B d-, Iron C d5, Steel C d15, Mythril C d30, Mythril S d50 | ceiling vs normal d60/d80 100/97%

BOT SUMMARY | alive d10:88% d20:79% d30:79% d40:79% d50:50% d60:8% d80:0% | median life 50.5 | score 640 |
d2 typical est n/e/c 93/43/4 | first iron/steel/myth piece d4/8/19 | 3-slot iron/steel/myth d6/11/30 |
d11-30 fights n/e/c 31/69/0% | mining 68% trips/day 1.3 idle 9m | repair 0.4% bars 0.1% time
```

- Targets met: day-2 normal ~93%, elite 37–43% (low edge of 40–65%), champion < 5%; iron ~day 4–6,
  steel ~day 8–11, mythril ~day 19–30; careful-bot median life ~50 days, most deaths after day 40.
- Ablations (24 seeds): only `--ablate rings` clearly hurts (median life 44.5, score 513). Gems, repair,
  intel and skills are within noise (±10 points of survival between seed sets).

## Known concerns / ideas
- **Repairs rarely matter.** Under the user's rule that only unpacked gear can be repaired, the best gear
  is packed every night, so it is never home during a work day. Bot: 1.5 repairs per run (0.4% of bars),
  1.5 items destroyed by wear per run; `--ablate repair` is within noise. Options (need the user's call):
  bigger wear, a rest-day incentive, or allowing repair in the evening before packing.
- **Pierce resistance and stun resistance are low value.** Enemy Piercing ignores at most 25% of your
  defense and Stunning is 5–15% for 1 s, so the Pierce/Stun resistance rings add ~0.3–1.1 win-% points
  and diamond/topaz armor almost nothing. Raise enemy Piercing/Stunning values to make them matter.
- **Late game is mostly mining.** The bot's mining share (travel + search + clear) is 61% on days 11–20 and
  72–79% after day 20; refining falls to ~30 min/day after day 30 because mythril is scarce
  (about 10 per fresh map, distance 4+ only).
- **Skills barely move results** (`--ablate skills` within noise; per-level values are tiny by design).
  Intel also shows no measurable effect for the bot (the estimate already averages hidden attributes).
  Gems only pay for their own time (without them the bot has 3 mythril slots by day 19 instead of 30,
  but then idles ~90 min a day).
- **Win-chance estimate cost:** up to 40 × (32 × 30 + 30) = 39,600 fights per estimate (~0.1 s in Node,
  longer in the browser, with a progress bar). The real battle's gear choice runs 32 × 200 fights. The bot
  estimates all 7 enemies daily, so a 24-seed bot run takes ~80 s.
- Champions are almost never worth it for a careful player (best estimate 55–71% on days 7–30).
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
- Session 2 docs refresh: BALANCE.md rewritten against the current code (all examples recomputed with
  the core modules, Appendix A/B/C regenerated, "Balance targets and current results" with bot runs and
  ablations); README (commands, balance flags, GitHub Pages steps), SPEC and this file updated.
  (Update this section each session.)
