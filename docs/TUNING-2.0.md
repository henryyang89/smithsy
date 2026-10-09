# Smithsy 2.0 — Batch 7 tuning log (config values only)

Order follows docs/PLAN-2.0.md section 9: economy, bot pace, day 2, mid-game anchors, specials, estimator, intel, benchmark.
Priority when targets conflict: (1) the user's numbers T-R7, T-GEAR, T-D; (2) T-R33; (3) everything else.
Baseline = the committed B5/B6 numbers (HANDOFF "First measurements with the B5 numbers"). `npm test` baseline: 589 tests, green.
Exploratory sweeps use `--set path=value` (in memory) or small scratch scripts that call the tool's own sections; only config.js values end up changed.

## Step 1 - economy (T-E2, T-E5)

Baseline economy: T-E1 3.98 ok; T-E2 copper 20.8 LOW (23-31), iron 59.8 ok; T-E3 ok; T-E4 28.2 ok; T-E5 sight 60 vs 0 +26.9 ok, sight 20 vs 0 -0.1 LOW (3-8).

1a. `field.sight.coal` [20,70] -> [15,70] and `field.sight.gem` [20,80] -> [15,80]. Why: at sight 20 the player saw only copper and iron, which are worth almost nothing per trip-hour; letting the first two Ore sight points (10 + 10 = 20) reach a slice of the coal and gems makes the first points matter. Sweep (sight 20 / 60 vs 0, distance 5-6): coal+gem to 10: +8.4 / +28.9 (HIGH at 20); coal to 10 only: +1.1 / +27.1; gem to 10 only: +6.9 / +27.2; coal+gem to 15: +4.7 / +27.7 (picked).
1b. `field.searchMin` 25 -> 27 and `field.byDistance[0].loot` 50 -> 46. Why: copper at distance 1 was too cheap (20.8 min per unit, band 23-31, 1.2: 27). searchMin alone needs 30 to reach 23.3 (iron then 68.3, close to 71 and a 20% slower economy); the d1 loot chance only changes the one distance that makes copper cheap. Sweep (copper / iron min per unit): searchMin 27: 21.4 / 63.2; 28: 22.1 / 64.3; 30: 23.3 / 68.3; d1 loot 46: 22.8 / 60.0; d1 loot 44: 23.4 / 60.2; d1 loot 46 + searchMin 27: 24.2 / 64.1 (picked).
1c. `field.sight.mythril` [40,100] -> [50,100]. Why: after 1a/1b sight 60 vs 0 crept to +30.9 (HIGH, band 15-30); mythril visible one tenth less often at sight 60.
After 1a-1c (100 maps; 200 maps in brackets): T-E2 copper 24.2 [23.7] iron 64.1 [62.4] ok; T-E5 sight 60 +27.7 [26.9] ok, sight 20 +5.9 [6.6] ok; T-E1, T-E3, T-E4 unchanged (they do not depend on these values).

## Step 2 - tool fix for T-GEAR (c) (tools/balance.mjs + tests/personas.test.mjs)

The bot section's "Win chance by tier" already averaged over ALL enemies of the day's roster (`meanP`), not only the fight the bot chose, but it was the bot's *estimate*: a cheap screen (24 guesses x 25 fights, best packed piece per slot, hidden attributes guessed). Added the TRUE win chance: `truePct(packed, rings, enemy, seed)` fights every roster enemy as it really is (all attributes known), with the loadout the adventurer would pick from the packed gear (`searchLoadout` on 50 test fights per loadout, then 100 fights, draws count as survival), mean per tier. The bot section sets `P.truth`; the benchmark does not (no extra cost). The T-GEAR (c) rows and the BOT SUMMARY (`d10-40 true e/c`) now judge the true chance; the estimate stays as a second column. New tests: `truePct` equals a plain fight loop, the best loadout is used, `choosePlan` records `trueP` for every roster enemy per tier (and `null` without `P.truth`), the quick bot run prints the new summary field.
Baseline with the new measure (economy of step 1, old enemies): mid-game elite 98.7 / champion 95.3 true (estimate 98.6 / 95.3 - the estimate and the truth agree to 1 point).
Two tests broke after step 1 and 3 and were fixed (neither hard-coded a CONFIG number):
- tests/personas.test.mjs "each persona plays": it needed seed 31337#1 to survive to day 6; with the slower economy the careful bot died on day 3 on that seed. It now takes the first of 40 seeds on which the persona is alive on day 6.
- tests/ui-render.test.mjs "Confirm asks about packed items...": it read `s.roster.enemies[0].name` AFTER the click, but confirming starts the next day and rolls a new roster; it passed only because both rosters happened to start with the same name. Now read before the click.

## Step 3 - day 2: T-R7 and T-GEAR (a, b)

Baseline day 2 (old values): unarmed n/e/c 64 / 34.8 / 12.6; elite 0H/1H/2H+ 42.7 / 32.0 / 23.5; champion <=1H/2H/3H 15.2 / 10.5 / 7.8; Copper D sword + chest (kit2) elite 93.9 / champion 77.1 (bands 75-80 / 50-55: far ABOVE); kit3 95.7 / 84.9.
Diagnosis: one fight is steep (+1% enemy HP and damage = -3.5 win points), and the first sword (damage 16 against 11 for fists, +45%) moved a fight from 35% to 94%. The user's two numbers (35-45% unarmed, 75-80% with a day-1 kit) need the sword to be a step of about +15% over fists.
3a. `adventurer.unarmedDamage` 11 -> 14 (the sword stays 16, so the whole later game is untouched; only fists and the first sword change).
3b. Enemy base stats up to keep fists near 40%: `enemies.tiers` normal 80/9 -> 90/10, elite 81/9.1 -> 91/10.1, champion 82/9.2 -> 91.5/10.2 (HP/damage; defense 22/23/24 unchanged). Searched with a scratch optimizer that calls the tool's own day-2 logic (coordinate descent over unarmedDamage, tier HP/damage, champion step, the three High values; common random numbers; score = squared distance to the bands, user ranges and hard limits heavier).
3c. `enemies.attributes` High values: magical 12 -> 10, stunning 15 -> 16, chilling 15 -> 12. Why: one High special costs an unarmed adventurer 12-16 points at 12/15/15, which spreads elites from 0H 50 to 2H+ 27 (below the user's 30); at 10/16/12 the three cost about 10-12 each (stun is the weakest per point, so it went up, magic and chilling down) and the spread is 18. M1 (N->H cost in the armored sets) stays inside 8-20 (9.3-18.2); lower magic (9) or chilling (11) broke M1 (7.2 / 7.8).
Result (tool, 600 enemies x 300 fights): unarmed n/e/c 65 / 41.1 / 17.5; elite 0H/1H/2H+ 48.4 / 38.7 / 29.8 (bands 44-50 / 36-44 / 30-36); champion 19.5 / 15.9 / 12.8; kit2 elite 76.7 champion 50.8 (ok, ok); kit3 80.5 / 61.2 (below 85-90 / 65-75).
Open after this step: elite 2H+ 29.8 (0.2 under its band), champion mean 17.5 (band 8-16) and champion 3H 12.8 (band 0-6) - see the limits note in the final table; T-GEAR (b) is a gem-table matter (step 4).

## Step 4 - gems (T-GEAR b, T-R33) and a second pass over the day-2 values

Why: kit3 (kit + a matching C gem per High special) was 80.5 / 61.2 (bands 85-90 / 65-75) and T-R33 had MISS 4/10 after step 3 (M2 3.4 for ruby and sapphire, M7 +0.3, M6 S +4.8, S-swing 3 of 4).
Sweep of the armor gems, kit3 elite / champion: x1 80.5 / 61.2, x1.25 81.2 / 62.6, x1.5 81.9 / 64.2, x2 82.8 / 66.6, x3 84.4 / 70.9. The elite number cannot reach 85: the elites with no High special (0H, about 37% of them) have nothing to answer and sit at kit2 level (83.0); even three times the gem strength gets 84.4. So the elite part of T-GEAR (b) is a ceiling set by kit2 (a): reported as a miss, not pushed.
4a. Armor gems x1.5 for the three that answer a day-2 special (diamond stays; its M2 was already 6.6): ruby `magicRes` [12,18,24,30,36] -> [18,27,36,45,54]; topaz `stunChanceRed` / `stunDurRed` [10,15,20,25,30] -> [15,22,30,37,45]; sapphire `slowRed` / `slowDurRed` the same. M2 3.4-6.6 -> 5.6-8.4 (>= 4), M7 +0.3 -> -1.8, kit3 champion 61 -> 65.5. M3 (-3.5..-2.9) and M4 (94-138%) stay ok.
4b. Sword gems down at the top so that S stays below the special it answers (M6 S, S-swing): ruby `magicPct` [5,7,9,11,15] -> [5,7,9,11,13]; topaz `stunChance` [15,20,25,30,30] -> [15,20,24,26,27] and `stunDur` [1,1.5,1.5,1.5,2] -> [1,1.5,1.5,1.5,1.5]; sapphire `slowPct` [15,20,25,30,30] -> [15,20,22,23,23] and `slowDur` [2,2,2,2,2.5] -> [2,2,2,2,2]. Sapphire is the tight one: the chilling Low->High swing is only about 14 points, so its S sword gem is only a little better than its C gem.
4c. Second pass over the enemy numbers so that every elite group sits inside the user's 30-50 with the new gems: High stunning 16 -> 15, High chilling 12 -> 13 (a bigger chilling swing makes room for the sapphire S gem), enemies.tiers normal 90/10 -> 89/10, elite 91/10.1 -> 90.5/10.1, champion 91.5/10.2 -> 91/10.2.
Result: DAY2 unarmed n/e/c 66 / 41.9 / 18.5; elite 0H/1H/2H+ 49.6 / 39.4 / 30.1 (all four elite rows ok); champion <=1H 20.7 (ok), 2H 16.7, 3H 13.9, mean 18.5; kit2 77.2 / 52.1 (ok, ok); kit3 82.2 (below 85) / 65.5 (ok). SPECIALS: M1 10.4-18.0, M2 5.6-8.4, M3 -3.5..-2.9, M4 94-138%, M5 C 27-45 S 27-49, M6 C 2.4 S 1.8, M7 -1.8, S-swing <= -0.1: T-R33 ok (0 of 10 missed). npm test 592 green.

## Step 5 - difficulty and the mid-game: T-D and T-GEAR (c) together

Starting point (steps 1-4, growth 4.5%/day, ratings 1%/day): careful (benchmark, 100 seeds, the game's own 5x5 estimate) median life 32.5, alive d10 85; bot section (40 seeds): mid-game true win chance elite 93.6 / champion 85.1 (bands 75-90 / 50-75, both HIGH). The two numbers pull apart if only the daily growth is used: growth 5.0 gives median 35 but T-GEAR (c) 94/85; growth 6.0 gives T-GEAR (c) 87/73 (ok) but median 23.5 (benchmark) because the bot's noisy 5x5 estimate then finds "safe" fights less often.
Benchmark sweeps, careful, 100 seeds (median life / alive d10): growth 5.0: 35.0 / 87; 5.5: 27.5-29.0 / 79-87; 6.0: 23.5 / 88; ratings growth 0.5 instead of 1: growth 6.0 25.5 / 79, 5.5 32.5 / 86; ratings 0: 6.0 30.0 / 82, 6.5 28.0 / 81, 7.0 25.5 / 78, 8.0 22.0 / 82. The accuracy/dodge growth is a large part of the late cliff (hit chance falls to 50% and 94%), so lowering it lets the daily HP and damage growth rise.
5a. `enemies.growthPerDay.hpDamage` 4.5 -> 6.3 and `.ratings` 1 -> 0.3 (accuracy and dodge +0.3% a day). The bigger HP/damage growth is what puts the mid-game win chances into the user's bands; the smaller rating growth keeps the late cliff from arriving at day 25.
5b. `enemies.tiers.normal` 89/10 -> 82/9.2 (HP/damage). Why: the careful planner survives by always having one safe fight; with the mid-game elite at 86% the safe fight has to be a normal at 99%, which needs a wider gap between a normal and an elite (about 8% in HP and damage; the old gap was 1.7%). Effect (benchmark, growth 6, ratings 0): normal 89 -> 84/9.4 lifted the median life 30.0 -> 38.5 and 7.0: 25.5 -> 28.0; 82/9.2 with growth 6.3 gave 34.0 (200 seeds). R6 asks for elites "slightly" above normals: 8% is the largest step I would defend; champions stay only about 0.6% above elites in HP (their difficulty is the six High attributes).
5c. Day 2 re-tuned for the new growth (day-2 enemies are base x (1 + growth)): elite 90.5/10.1 -> 89/10, champion 91.5/10.2 -> 89.5/10.1. Final day 2: unarmed n/e/c 86 / 41.6 / 18.2; elite 0H/1H/2H+ 48.8 / 39.2 / 30.6 (all ok); champion <=1H 20.0 (ok), 2H 16.9, 3H 14.3, mean 18.2; kit2 76.7 / 51.4 (ok, ok); kit3 82.2 (below 85) / 65.3 (ok).
Result (200 seeds benchmark / 60 seeds bot section): median life 30.5-34, alive d2 97-98%, d4 90-92%, d10 77-84% (T-D ok, ok, ok, ok); T-GEAR (c) elite 85.6-86.8, champion 72.2-73.8 (ok, ok).

## Step 6 - bot pace (T-B2, T-B3, T-B4)

After step 5 (60 seeds, careful): T-B2 load 7.3% of travel (LOW), T-B3 repairs 1.5% of the work time (LOW), T-B4 General repair 3.4 and main-bar repair 2.1 (LOW).
6a. `map.loadPenaltyPerItem` 2 -> 2.5: load 7.3 -> 8.5-8.7% (8-15).
6b. `gear.repair.timeFraction` 100 -> 250: repairs 1.5 -> 3.0 -> 3.8% of the work time on days 11-40 (3-6; 200 gave 2.97).
6c. `skills.activity.repairTime.xp` and `skills.perMaterial.repair.xp` 1 -> 2 (XP per durability point repaired per bar): General repair 3.4 -> 5.2 (5-7), main-bar repair 2.1 -> 3.0-3.4 (3-6). Travel 7.9-8.0 and Carrying 6.6-7.0 were already ok.
Left alone: T-B1 first steel piece median day 7 (8-12) and 3 of 5 slots iron day 5-6 (6-9): one day early. Slowing it needs fewer iron / coal in the near fields, which pushes copper minutes per unit below T-E2's 23 (the field minutes sit at 24.2 with the step-1 values).
Two more tests changed (derive from CONFIG, neither hard-coded the old number): tests/gear.test.mjs "repair earns XP" expected General repair level 1 after one repair (the XP per point doubled; it now derives the level from the XP); tests/ui-render.test.mjs "a Low special reads none ... fight day" needed a rounding difference of the fight-day rating on day 2 (0.3% a day rounds away); it now uses a day-40 roster. npm test: 592 green.

## Step 7 - refining time (T-B1, T-D alive at day 10)

After step 6 the early game was a day too fast: T-B1 first steel piece day 7 (8-12) and 3 of 5 slots iron day 5 (6-9) LOW, and the 100-seed benchmark had alive d10 89% (HIGH, band 75-85).
7a. `refine.*.minutes` copper 15 -> 17, iron 20 -> 23, steel 25 -> 29, mythril 30 -> 35 (about +15%). Why: refining is 30% of the day in days 1-5 (177 min), so it is the cheapest lever on the first ten days, and it leaves the field economy (T-E) alone.
Result: T-B1 all six rows ok (iron day 3 / 6, steel 8-9 / 13, mythril 19-20 / 30-31.5); benchmark 100 seeds: median 31.0, alive d2 95 / d4 92 / d10 81; T-GEAR (c) 84.3 / 70.3.

## Step 8 - gems and specials again after the harder growth (T-R33), keeping T-R7 clean

The specials section (R33) re-measures at "the day a plain C set wins 55% against an all-Normal elite" and the harder growth moved those days from 14 / 24 / 38 to 11 / 19 / 30. At that point T-R33 read MISS 5/10: M2 for diamond +0.3, M6 emerald sword gem 3.0 / 4.2 away from the mean, M7 +3.1, S-swing +1.4, stun M1 7.9. Causes: the slower rating growth made accuracy (emerald sword gem) and dodge worth less, and diamond armor (the only answer to Piercing) had not been raised in step 4.
8a. `gemEffects.diamond.armor.pierceRes` [8,12,16,20,24] -> [16,24,32,40,48] (x2; step 4 had left diamond alone): M2 diamond +0.3 -> +8.6.
8b. `gemEffects.emerald.weapon.accuracy` [20,30,40,50,60] -> [28,42,56,72,90]: emerald sword gem C / S 5.2 / 8.3 -> 7.1 / 10.2 points, within 1.3 / 3.3 of the mean of the five gems (<= 3 / 4).
8c. `enemies.stunDuration` 1.5 -> 1.8 and `enemies.slowDuration` 2.5 -> 3 (and the Chilling description). Why: M1 stun (7.9) and the S-swing of the sapphire/topaz sword gems (swing = what the special costs from Low to High) need the specials to matter more in armored sets; a longer stun/slow raises that cost without raising the High chance (which would widen the day-2 elite spread).
8d. `enemies.attributes` High: magical 10 -> 9, stunning 16 -> 15 (kept), chilling 13 -> 12 (after trying 14 for the swing); `gemEffects.sapphire.weapon.slowPct` [15,20,22,23,23] -> [11,16,18,19,19]; topaz `stunChance` S 27 -> 26. Day 2 is the limit: an elite with no High special wins about 50% and with two or more about 30%; every point the High values rise widens that spread, and the user's window (30-50) is 20 points wide. A search over magical 9-10 / stunning 13-15 / chilling 12-14 (day-2 elite spread and M1 min, each with the base re-centred): spread 18.3 with M1 stun 6.9 (MISS), 19.6 with M1 8.6 (ok, chosen: magical 9 / stunning 15 / chilling 12), 21.3 with every M1 ok but the elite 0H group 0.7 over 50 and 2H+ 0.7 under 30. The user's numbers come first, so the 19.6 version won; the price is a weak sapphire sword gem (C 8.3 -> S 10.2 points; the sword gems of the other four rise 7-9 -> 12-16).
8e. Day 2 re-centred for 8c/8d: elite hp 89 -> 88, champion 89.5 -> 89.
Result: SPECIALS ref iron d12 steel d19 mythril d31 | M1 9..13 | M2 4.7..8.8 | M3 -4.1..-3.6 | M4 130..170% | M5 C 28..45 S 26..49 | M6 C 1.3 S 3.3 | M7 -1.0 | S-swing <= -1.3 | T-R33 ok. DAY2: elite 0H/1H/2H+ 49.9 / 40.0 / 30.7 (all ok), kit2 77.2 / 52.8 (ok, ok), kit3 82.1 / 66.0.
Final checks on this config (60 seeds bot, 200 seeds benchmark): T-GEAR (c) 86.3 / 73.2; T-D median 31.0, d10 81, d2 96, d4 89. `npm test` 592 green. Repair XP per bar skill 2 -> 2.5 (main-bar repair 2.9 -> 3.3, band 3-6).
Not changed (tried): `ratings` growth 0.3 vs 0.1 vs 0 on the final config: median 31 / 32 / 29, alive d10 81 / 79 / 80 (200 seeds): inside the noise. Normal 78/8.8 with growth 6.3 / 6.6 for the T-P d20 row: careful - casual at d20 +7 / +1 (noise, no trend).

## Final measurements on the final config (summary lines pasted from the tool; files in scratchpad/v2/tune/final/)

Commands: `node tools/balance.mjs --section economy | day2 | power | specials | estimator`, `--section bot --persona careful --seeds 40` (1 m 52 s), `--section intel --seeds 100 --days 60 --jobs 4` (328 s), `--section benchmark --jobs 4` (87 s wall, 100 seeds x 3 personas).

```
ECONOMY SUMMARY | items/search by dist d1:1.48 d2:1.72 d3:1.79 d4:1.81 d5:1.88 d6+:2.04 | debris % of effort d1:5 d2:5 d3:5 d4:5 d5:5 d6+:5 | one trip d1/d3: 333/364 min for 20.0/20.0 items (found 21.3/21.2, pile left 1.3/1.2) | field min per unit: copper 24, iron 65, steel pair 162, mythril 586, any gem 93 | full set >=D work days: copper 1.2, iron 2.3, steel 4.6, mythril 14.1 | gem cut skill 0: F 15% C+ 40% effect 0.77 of C | map items/run 3759 (mythril 28.0, coal 316) | searches per clear cell +0/+12/+32%: 3.98/3.44/3.00 | map 40.0 fields, 100% of maps with 6+ at d5+, 1.70 attempts | sight value/trip-hour d5-6 s20/s60 vs 0: +6%/+27% | T-E3 ok T-E5 ok T-E1 ok T-E2 ok T-E4 ok
DAY2 | unarmed n/e/c 85/42/18 | elite 0H/1H/2H+ 50/40/31 | champ <=1H/2H/3H 20/17/14 | kit1 n/e/c 96/70/45 | kit2 n/e/c 98/77/53 | kit3 n/e/c 98/82/66 | T-R7 in band 5/8 | T-R7 MISS 3/8 T-GEAR MISS 1/4
POWER SUMMARY | unarmed d2 vs normal 86% (target 50-65) | day-2 ref (Copper C sword + C chest + C boots) n/e/c 100/93/77% | Cu D sword n/e/c 96/70/44% | last day >=90% vs normal: Copper B d5, Iron C d10, Steel C d15, Mythril C d30, Mythril S d50 | >=70% vs elite: Copper B d5, Iron C d10, Steel C d15, Mythril C d20, Mythril S d40 | ceiling vs normal d60/d80 98/71% | anchors (last day >=70% vs elite) copper B d6, iron C d10, steel C d17, mythril C d28, mythril S d44 | T-MID MISS 4/5
SPECIALS | ref iron d12 steel d19 mythril d31 | M1 9..13 (8-20) | M2 4.7..8.8 (>=4) | M3 -4.1..-3.6 (<=-2) | M4 130..170% (>=80) | M5 C 28..45% S 26..49% (<=50/60) | M6 C max 1.3 S max 3.3 (<=3/4) | M7 -1.0 (<=0) | S-swing -8.2..-1.3 (<=0) | T-R33 ok
ESTIMATOR SUMMARY (mean over the 55/75/90 targets, 10% scouting) | 5x5: +-20.6 miss 12.7 wobble 9.2 | 6x6: +-17.2 miss 11.7 wobble 7.8 | 8x8: +-12.7 miss 10.9 wobble 6.1 | 10x10: +-10.3 miss 10.2 wobble 5.1 | fights/roster base 8575 max 34300 (dearest gear case; 2 per type 5775/23100, 3 per type 2960/12020) | T-A2 ok
BOT SUMMARY | careful | alive d10:93% d20:83% d30:60% d40:30% d50:0% d60:0% d80:0% | median life 36.5 | score 617 | d2 typical true n/e/c 99/90/76 | d10-40 true e/c 86/73 | d10-40 est e/c 86/73 | first iron/steel/myth piece d3/9/19 | 3-slot iron/steel/myth d6/13/30 | d11-30 fights n/e/c 63/23/14% | mining 59% trips/day 1.2 idle 12m | d11-40 travel 28% load 8.5% of travel | repair 2.7% bars 2.5% time (d11-40 3.4%), by day only (0.7 subst., 0.0 destroyed) | skills d30 travel/carry/repair 8.0/6.4/5.1 | answer cover d25 3.6/4 | map found d40:25% d60:-% d80:-% | field: 3.18 found/search, carried 53% of found (10.1/trip, 29 from old piles), piles at end 345 (4.0 worth), debris 4.8% of effort | gems cut 127.4/run F/D/C+ 14/38/48%, 29.6 infused | T-GEAR ok T-B1 ok T-B2 ok T-B3 ok T-B5 ok T-B4 ok
INTEL | best only:simDepth | spread life 1.4d score 5% | default -1.5d | worst vs none -0.3d | seeds 100 days 60 | T-R42 ok
BENCHMARK SUMMARY | v2.0 | seeds 100 | wall 1.5 min (4 jobs) | careful life 31.0 d10 85% | champion life 15.5 d10 61% | casual life 25.5 d10 90% | T-D ok T-P MISS 1/8
BENCHMARK | v2.0 | careful | seeds 100 | alive d2:97% d3:95% d4:93% d5:92% d10:85% d15:81% d20:73% d25:66% d30:52% d40:16% d50:0% d60:0% d70:0% d80:0% d100:0% | median life 31.0 | mean score 686 | score/day 25.2 | fights n/e/c 43/27/30% | picked at 98% | estimator game 5x5
BENCHMARK | v2.0 | champion | seeds 100 | alive d2:86% d3:81% d4:77% d5:76% d10:61% d15:50% d20:36% d25:20% d30:11% d40:4% d50:0% d60:0% d70:0% d80:0% d100:0% | median life 15.5 | mean score 658 | score/day 36.3 | fights n/e/c 6/5/89% | picked at 94% | estimator game 5x5
BENCHMARK | v2.0 | casual | seeds 100 | alive d2:99% d3:98% d4:98% d5:98% d10:90% d15:84% d20:66% d25:50% d30:27% d40:0% d50:0% d60:0% d70:0% d80:0% d100:0% | median life 25.5 | mean score 521 | score/day 21.6 | fights n/e/c 9/91/0% | picked at - | estimator no estimate
```

## Final table: every section-9 target on the final config

ok = inside the band as the tool prints it. Numbers are from the runs pasted above (economy 100 maps, day2 600 enemies x 300 fights, bot careful 40 seeds, benchmark and intel 100 seeds).

| Id | Target | Measured | Flag | Reason for a miss |
|---|---|---|---|---|
| T-E1 | 3.9-4.1 searches per clear cell | 3.98 | ok | |
| T-E2 | copper field min per unit 23-31 | 24.3 | ok | |
| T-E2 | iron 53-71 | 65.0 | ok | |
| T-E3 | 40 fields per map | 40.0 | ok | |
| T-E3 | >= 6 fields at distance 5+ on >= 99% of maps | 100% | ok | |
| T-E3 | <= 2 attempts per map | 1.70 | ok | |
| T-E4 | mythril 22-32 per map | 28.0 | ok | |
| T-E5 | sight 60 vs 0 at distance 5-6: +15-30% | +27.4% | ok | |
| T-E5 | sight 20 vs 0: +3-8% | +5.8% | ok | |
| T-B1 | first iron piece median day 3-6 | 3.0 | ok | |
| T-B1 | 3 of 5 slots iron 6-9 | 6.0 | ok | |
| T-B1 | first steel piece 8-12 | 9.0 | ok | |
| T-B1 | 3 of 5 slots steel 12-16 | 13.0 | ok | |
| T-B1 | first mythril piece 15-21 | 19.0 | ok | |
| T-B1 | 3 of 5 slots mythril 24-32 | 30.0 | ok | |
| T-B2 | travel 25-35% of work time, days 11-40 | 27.8% | ok | |
| T-B2 | load 8-15% of travel minutes | 8.5% | ok | |
| T-B3 | repairs 3-6% of work time, days 11-40 | 3.4% | ok | |
| T-B3 | items destroyed by wear <= 5 per run | 0.0 | ok | |
| T-B4 | Travel 6-8 at day 30 | 8.0 | ok | |
| T-B4 | Carrying 5-8 | 6.4 | ok | |
| T-B4 | General repair 5-7 | 5.1 | ok | |
| T-B4 | main-bar smithing 3-6 | 3.2 | ok | |
| T-B4 | main-bar repair 3-6 | 3.3 | ok | |
| T-B5 | answer-gem armor cover at day 25 >= 2.5 of 4 | 3.63 | ok | |
| T-B5 | gems used by repairs <= 25% of gems cut | 1.6% | ok | |
| T-R7 | unarmed day 2, elite mean 38-45 | 42.4 | ok | |
| T-R7 | elite 0 High specials 44-50 | 49.9 | ok | |
| T-R7 | elite 1 High 36-44 | 40.0 | ok | |
| T-R7 | elite 2+ High 30-36 | 30.7 | ok | |
| T-R7 | champion 0-1 High 18-25 | 20.4 | ok | |
| T-R7 | champion mean 8-16 | 18.4 | MISS (+2.4) | See note 1. Inside the user's 0-25. |
| T-R7 | champion 2 High 8-16 | 17.0 | MISS (+1.0) | Note 1. |
| T-R7 | champion 3 High 0-6 | 13.9 | MISS (+7.9) | Note 1. |
| T-R7 | normal mean >= elite mean + 15 (info) | 85.3 vs 57.4 | ok | |
| T-R7 | hard limits: every elite group 28-52, every champion group <= 27 | elite 30.7-49.9, champion <= 20.4 | ok | |
| T-GEAR (a) | day-1 kit (Copper D sword + chest) elite 75-80 | 77.2 | ok | |
| T-GEAR (a) | the same, champion 50-55 | 52.8 | ok | |
| T-GEAR (b) | kit + a matching C gem per High special, elite 85-90 | 82.1 | MISS (-2.9) | Note 2. Inside the user's 75-90. |
| T-GEAR (b) | the same, champion 65-75 | 66.0 | ok | |
| T-GEAR (c) | careful's packed gear vs ALL roster elites, days 10-40: 75-90 | 86.3 (true chance) | ok | |
| T-GEAR (c) | vs ALL roster champions: 50-75 | 73.3 | ok | |
| T-D | careful median life 30-40 | 31.0 | ok | Thin margin: 200 seeds give 31.0 too (29.0-34.5 in neighbouring settings). |
| T-D | alive at day 10: 75-85% | 85% | ok | Thin: 81-85% over 100-200 seeds. |
| T-D | alive at day 2 >= 95% | 97% | ok | |
| T-D | alive at day 4 >= 85% | 93% | ok | |
| T-MID | copper B last day >= 70% vs typical elite 5-11 | 6 | ok | |
| T-MID | iron C 12-18 | 10 | MISS | Note 3. |
| T-MID | steel C 20-26 | 17 | MISS | Note 3. |
| T-MID | mythril C 38-44 | 28 | MISS | Note 3. |
| T-MID | mythril S 56-62 | 44 | MISS | Note 3. |
| T-R33 | M1 N->H cost 8-20 | 8.8 to 12.8 | ok | |
| T-R33 | M2 matching - emerald armor at High >= +4 | +4.7 to +8.8 | ok | |
| T-R33 | M3 the same at Low <= -2 | -4.1 to -3.6 | ok | |
| T-R33 | M4 3 pieces + B ring recover >= 80% | 130-170% | ok | |
| T-R33 | M5 sword gem C kept at High resistance <= 50% | 28-45% | ok | |
| T-R33 | M5 sword gem S kept <= 60% | 26-49% | ok | |
| T-R33 | M6 sword gem C within +-3 of the mean | 0.2 to 1.3 | ok | |
| T-R33 | M6 sword gem S within +-4 | 0.8 to 3.3 | ok | |
| T-R33 | M7 emerald armor gain <= smallest M2 | -1.0 | ok | |
| T-R33 | S sword gem gain <= matching special's Low->High swing | -8.2 to -1.3 | ok | |
| T-A2 | <= 10,000 fights per roster at the base size | 8,575 | ok | |
| T-A2 | <= 60,000 at the max size | 34,300 | ok | |
| T-A2 | shown margin at 5x5 about +-20 (15-25) | +-20.6 | ok | |
| T-A2 | margin shrinks with every step | smallest drop 2.43 | ok | |
| T-R42 | (1) best only: mode - median only: mode <= 4 days / <= 10% score | 1.4 d / 5.0% | ok | |
| T-R42 | (2) no only: mode below none by more than 2 paired se | -0.3 to +1.1 paired se over the six tracks | ok | |
| T-R42 | (3) persona list >= best only: - 3 days | -1.5 | ok | |
| T-P | casual alive at day 4 >= 70% | 98% | ok | |
| T-P | casual 0% champion fights | 0.0% | ok | |
| T-P | careful - casual alive at day 20 >= +10 points | +7 (73 vs 66) | MISS (-3) | Note 4. |
| T-P | careful - casual alive at day 40 >= +10 | +16 | ok | |
| T-P | champion score/day >= 1.2 x careful's | 1.44x | ok | |
| T-P | careful - champion median life >= 3 days | 15.5 | ok | |
| T-P | champion fights >= 40% champions, days 11-40 | 85% | ok | |
| T-P | benchmark wall time <= 15 min with --jobs 4 | 1.5 min | ok | |

Notes on the misses (every one is below the user's numbers in priority, or inside them):
1. **T-R7 champion sub-bands.** A High special costs a champion and an elite the same amount on the log-odds scale, but a champion sits at 18% where a point of log-odds is worth fewer points of win chance. The plan's champion bands (18-25 with 0-1 Highs, 0-6 with 3) ask for an 18-point drop where the elite window (50 -> 30) allows 20 points for the same Highs, so the champion would need about 2.5 times the elite's effect. With the elite groups held inside the user's 30-50 the champion groups fall only from 20.4 (0-1 High) to 13.9 (3 High). Making the whole champion harder (about +1.5-2% HP and damage; tried on the way) brings the champion mean to about 15.5 and 3 High to about 12, but it drops the day-1 kit champion to about 47 (the user's geared champion band starts at 50), so it was not taken. Every champion group is inside the user's 0-25 and under the hard limit of 27.
2. **T-GEAR (b) elite.** 37% of elites (the 0H group, 220 of 600) have no High among Magical / Stunning / Chilling and a matching gem has nothing to answer there, so they stay at the day-1 kit's own level, 83.6; kit3 gives 83.6 / 81.4 / 80.6 for 0 / 1 / 2+ High, mean 82.1. Armor gems three times as strong as the current ones would reach 85.9 (resistances far beyond the 75 cap) and a stronger kit would push (a) above 80, so neither was taken. The elite number is inside the user's 75-90; the champion half of (b) is ok.
3. **T-MID.** The anchors are 1.2's numbers (median life about 50). The user chose Harder (U2: median life 30-40, 80% alive at day 10), and T-GEAR (c) wants the mid-game elite at 75-90. At median life 31 a full iron / steel / mythril set stops beating a typical elite (70%) after 10 / 17 / 28 days, about 30% earlier than in 1.2 (6 / 15, 17 / 23, 28 / 41, 44 / 59 days). The plan itself says T-D is tuned first, "then recheck T-MID".
4. **T-P careful - casual at day 20.** A persona-behaviour row, not a game number. The two are within noise of each other for the first 20 days (100 seeds: standard error of the difference about 6 points); the casual's elites-only diet starts killing it after day 20 (+25 at day 30 and +16 at day 40 in the same 100 seeds). Not tuned: the only levers are bot settings (the careful minimum win 90), which the brief forbids tuning to pass a game target.

## Config changes (old -> new), all in js/config.js

| Key | Old | New |
|---|---|---|
| field.searchMin | 25 | 27 |
| field.byDistance[0].loot | 50 | 46 |
| field.sight.coal / gem / mythril | [20,70] / [20,80] / [40,100] | [15,70] / [15,80] / [50,100] |
| map.loadPenaltyPerItem | 2 | 2.5 |
| refine.copper / iron / steel / mythril .minutes | 15 / 20 / 25 / 30 | 17 / 23 / 29 / 35 |
| gear.repair.timeFraction | 100 | 250 |
| skills.activity.repairTime.xp (General repair) | 1 | 2 |
| skills.perMaterial.repair.xp | 1 | 2.5 |
| adventurer.unarmedDamage | 11 | 14 |
| enemies.tiers.normal hp / damage | 80 / 9 | 82 / 9.2 |
| enemies.tiers.elite hp / damage | 81 / 9.1 | 88 / 10 |
| enemies.tiers.champion hp / damage | 82 / 9.2 | 89 / 10.1 |
| enemies.growthPerDay.hpDamage / ratings | 4.5 / 1 | 6.3 / 0.3 |
| enemies.stunDuration / slowDuration | 1.5 / 2.5 | 1.8 / 3 |
| enemies.attributes.magical.values.high | 12 | 9 |
| enemies.attributes.chilling.values.high (and its description: 3s) | 15 (2.5s) | 12 (3s) |
| gemEffects.ruby weapon magicPct / armor magicRes | [5,7,9,11,15] / [12,18,24,30,36] | [5,7,9,11,13] / [18,27,36,45,54] |
| gemEffects.topaz weapon stunChance / stunDur | [15,20,25,30,30] / [1,1.5,1.5,1.5,2] | [15,20,24,26,26] / [1,1.5,1.5,1.5,1.5] |
| gemEffects.topaz armor stunChanceRed / stunDurRed | [10,15,20,25,30] | [15,22,30,37,45] |
| gemEffects.emerald weapon accuracy | [20,30,40,50,60] | [28,42,56,72,90] |
| gemEffects.sapphire weapon slowPct / slowDur | [15,20,25,30,30] / [2,2,2,2,2.5] | [11,16,18,19,19] / [2,2,2,2,2] |
| gemEffects.sapphire armor slowRed / slowDurRed | [10,15,20,25,30] | [15,22,30,37,45] |
| gemEffects.diamond armor pierceRes | [8,12,16,20,24] | [16,24,32,40,48] |

Unchanged on purpose: enemies.attributes.stunning.values.high (15), the tier defense values, gear/material multipliers, intel tracks (T-R42 ok without touching them), sim counts (the user's 5 x 5), persona/bot settings.

## Tool and test changes
- tools/balance.mjs: `truePct` / `TRUTH` and `trueP` (T-GEAR (c) now judged on the true win chance of every roster enemy with the packed gear; the estimate stays as a second column; BOT SUMMARY has `d10-40 true e/c` and `d2 typical true`).
- tests/personas.test.mjs: 3 new tests for it, 1 summary-line case, and the persona-plays test picks a survivor seed. tests/gear.test.mjs and tests/ui-render.test.mjs: 2 tests made independent of the tuned numbers and 1 real test bug fixed (roster read after the day rolled). npm test: 592 green (589 + 3 new).
- Not touched (docs come later): README still says searches take 25 minutes (now 27); docs/BALANCE.md, SPEC.md and BENCHMARKS.md describe 1.2 numbers; the HANDOFF "Plan deviations" list should get: the new true-win measure, the 8% normal-to-elite gap, the rating growth 0.3, the day-2 numbers, and T-R7 champion / T-GEAR (b) elite / T-MID / T-P misses with the reasons above.
