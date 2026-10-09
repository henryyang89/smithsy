# Smithsy changelog

Version numbers: the tenths place goes up for small changes (1.1, 1.2, …), the ones place for big ones
(2.0). The version shows in the game's top bar and in Help.

Every release is kept as a branch on GitHub named `release/vX.Y`, so any version can be played or
restored later.

## How to roll back to an earlier version

The live site is built from `main`. To put an older version back:

1. On GitHub, open **Pull requests → New pull request**.
2. Set **base: main** and **compare: release/vX.Y** (the version you want back).
3. If GitHub says it can't compare, use the other way instead: open the merged pull request of the bad
   version and press **Revert** (GitHub makes a pull request that undoes it), then merge that.
4. Merge it. The site updates within a few minutes.

To just *look at* an old version's files, switch the branch dropdown on the repo page to
`release/vX.Y`.

Branches that exist now: `release/v1.0` and `release/v1.1`. `release/v1.2` and `release/v2.0` are created
from `main` right after each is merged (see the release steps in `HANDOFF.md`); rolling 2.0 back means going to
`release/v1.2` with the steps above. A game saved in 2.0 stays in the browser while 1.2 is live, and a game
saved in 1.2 is still there when you come back to it (see the save table below).

Saves, going back and forth (each save format has its own browser-storage key, and a newer save is never
overwritten by an older version):

| Version | Reads | Saves under |
|---|---|---|
| 2.0 | **only its own save** (no conversion: it starts a fresh game and says so once; a 1.x save is left alone) | `smithsy-save-2.0` (best score: `smithsy-best-2.0`) |
| 1.2 | its own save; if there is none, converts a 1.1 save, else a 1.0 save | `smithsy-save-v3` |
| 1.1 | its own save; if there is none, converts a 1.0 save | `smithsy-save-v2` |
| 1.0 | its own save | `smithsy-save-v1` |

- An older version **cannot read** a newer save: if you roll back from 1.2 to 1.1, 1.1 shows its own
  save (or a new game if it never had one), not your 1.2 run. Your 1.2 run is not lost: it stays in the
  browser, and coming back to 1.2 picks it up again.
- A conversion is a copy made once, the first time the newer version starts without a save of its own.
  The older save is left untouched, so progress made later in the older version is not carried over.
- A save that can't be loaded is kept as a backup (`smithsy-save-backup-<time>`) and a new game starts.
- **From 2.0 on, every version starts fresh** (a save is only read by the version that wrote it, tenths
  included). Your 1.x save stays in the browser, untouched, and opens again in 1.2 (or 1.1 / 1.0 for theirs).

## 2.0

**2.0 starts a fresh game.** It does not read or convert a 1.x save: your 1.x run stays in the browser and opens
again when you go back to 1.2. It is also a **harder** game: a careful player lasts about 30-40 days (the
benchmark's median is about 32), and about 8 in 10 runs are alive at day 10.

The world:
- **A bigger map.** The world is 7x7 (camp in the middle, 40 fields, 8 blocked cells) and each field is 9x9
  cells. Fields have 2 to 4 boulders, more the farther they are; the share of gems among the finds rises from
  15% near camp to 25% far away. Searching is a little shallower: about four searches finish a cell.
- **Ore sight is always on, and starts blind.** Every ore and gem has a hidden sight threshold (rarer ones are
  higher). In the field you stand in you see the items within your sight (a tag on the cell, also under
  debris). Sight comes from the Ore sight intel track and Ore sight rings; on day 1 it is too low to see anything.
- **Walking has skills.** Travel (XP from the map steps you walk, both ways) replaces the old return-trip skill,
  and a new **Carrying** skill softens the extra travel time of a heavy bag (2.5% per item).

Smithing and repairs:
- **Repairs happen by day, at camp, and cost time.** There are no night repairs. Only gear the adventurer does not
  have can be repaired; a repair takes 2.5 times the smithing time (scaled by how much is repaired) and each bar
  type has its own **Repair** skill, a General repair skill and a little help from its Smithing skill. The Repair
  button now sits to the right of the item's durability, on the Workshop and the Adventurer tab.
- **Scrap gives bars back**: 35% of the item's bars times its durability (a 60% copper sword returns 0.42 copper
  bars). The gem is lost.
- **New skills.** Smithing skills per bar type make crafting faster; General refining and General cutting add
  small improvements for every material (the skills of the exact material count far more). 35 skills in all,
  shown as cards on a phone. Hover or tap a skill to see what it gives; the number of maxed skills is no longer shown.
- **Gems and grades.** Materials overlap a little: an S piece of one material is better than a D piece of the next
  and worse than its C. Gem effects were retuned so crafting a variety of gems matters, and every gem grade is
  worth more than the one below it. The Workshop shows only your current chances for a gem, not the novice and master
  tables.
- **Workshop and gear view.** Gear type, material, grade and gem are picked by clicking tiles instead of drop-down
  lists. Refining and cutting show "Time each" next to the buttons and no longer mention luck or time bonuses (the
  outcome bar and the time already include them). A failed attempt turns the result box red. After a craft the gem
  choice goes back to "none". The gear overview shows which gem types each gear type carries and a tag for every
  gem, and a gem tile is dashed when no grade has a whole cut gem left (repairs use parts of one).
- **Durability is a whole number** on screen (the game keeps the decimals). A warning mark appears next to gear that
  could break in the planned fight.

Fights and planning:
- **Enemies.** Elites are a little tougher than normals and champions a little tougher than elites. Low Magical means
  no magic damage and Low Chilling means no slowing at all. Enemy scouting is a bit harder for elites and harder for
  champions, and grades of rings are harder to scout the higher they are. The enemies' daily growth is hidden.
- **Banners.** Every enemy marches under the Red, Black or Gold banner (you can learn which with Banner scouting;
  the battle report always shows it). For every 4 fighters you beat from your most-beaten banner your adventurer
  captures a **pack mule**: one more item of one gear type can be packed (random type, each type once).
- **The win chance is always shown.** It is worked out by itself for every enemy (5 guesses x 5 test fights; there is no
  Estimate all button any more) on the plan screen and the Adventurer tab. It is small on purpose, so a lost fight
  can follow a 90% estimate, and rings or intel only make it a little steadier. A margin never reads past 0 or 100:
  "100% (-12)".
- **Intel.** Each intel track has its own step sizes that shrink as you spend (the old +10, +9, ... for all tracks
  is gone), enemy scouting gains less per point, and the new **Banner scouting** track shows banners. **You must
  spend your intel points before the next day can start.**
- **Battle report.** It lists the gear used and the gear not used, separately, and the wear of each item. After a
  lost fight the run summary replays the fight 500 times to show how it could have gone, and whether gear you left at
  home would have helped. The combat log keeps its columns aligned; hover or tap an effect to read it in full.
- **No score until the run ends.** No score or points are shown while you play. **End run** (top bar) retires the
  adventurer; the run summary explains how the score is made up.

Smaller things: the day bar fills from left to right; search and travel messages use proper plurals; times read
like "2h 1.8m"; every hover explanation also works with a tap on a phone; the field screen has Search area and Return
to camp right under the grid on a phone; the Skills & Intel table is a list of cards on a phone.

Saves:
- **2.0 uses its own save** (`smithsy-save-2.0`) and starts a fresh game. A save that can't be loaded (or has a
  missing part) is kept as a backup. If the game is open in two tabs, the older tab locks itself instead of overwriting
  the newer one.

For developers: `node tools/balance.mjs` has three player personas (`--persona careful|champion|casual`), the
benchmark now includes days 2, 3 and 4, and the new `day2` and `intel` sections check the first fight and the
intel tracks (`docs/TUNING-2.0.md` is the tuning log; `docs/BALANCE.md` lists the targets that are not met).

## 1.2

Fights and gear:
- **Gear wears much faster, and a new skill slows it down.** Every item the adventurer uses now loses
  about 10% durability per fight (a roll of 8-12%, was 3-7%), a little more against tougher enemies
  (elite x1.1, champion x1.2). Wear is shown with one decimal. The new **Gear care** skill takes 1% off
  the wear per level (10% off at level 10) and earns its XP from every fight the adventurer survives
  (100 XP per fight, so level 10 comes after about 55 fights). Why: repairs and spare bars now matter all
  game, and you get a way to lower the bill.
- **Enemy specials are dangerous and resistances matter.** Piercing, Stunning and Chilling were raised
  and Magical was retuned down at Normal and High (Magical 10/15/25 %, was 10/20/30; Piercing 10/25/60 %,
  Stunning 5/15/35 % for 1.5 s, Chilling 10/20/40 % for 2.5 s; every resistance is 0/20/40 %).
  Switching one special from Normal to High now costs a mid-game set about 11-20 win points, and the
  matching armor gem and resistance ring win back about half to all of it. Why: before, Piercing and
  Stunning were almost harmless, so their gems, armor and resistance rings were not worth wearing.
- **Your own gems and rings follow.** Ruby 6-18 % magic, diamond 15-55 % piercing, topaz 10-30 % stun
  for 1-1.5 s, sapphire 10-30 % slow for 1.5-2 s; the Piercing, Pierce resistance, Magic resistance, Stun
  resistance and Slow resistance rings were retuned (mostly stronger). Your best (S) gem is a little weaker
  than the enemy's matching High special: the adventurer's offense stays a little below the enemy's.
- **A bare-handed adventurer can win on day 2.** Swords are stronger (base damage 16, was 10) and
  an unarmed adventurer hits for 11 (was 4): with no gear at all the adventurer now beats a normal enemy
  on day 2 about 6 times in 10. To keep the middle of the game where it was, enemies have 25 % defense
  (was 20 %) and grow 3.5 % a day (was 3 %).

Planning the fight:
- **One "Estimate all" button.** It simulates every enemy of the roster with the gear and rings you have
  picked and fills a "Win estimate" row in the roster table (after the Hidden attributes row). Changing
  the gear or rings, confirming, or starting a new game stops a run that is no longer valid; choosing
  another enemy does not.
- **A smaller, honest estimate.** It now runs 10 guesses of the hidden attributes x 10 test fights per
  enemy (was 40 x 30), so it is faster and a little noisy. Every estimate shows its margin (for example
  "62% +/- 12": how far the simulation alone could be off, about 9 times in 10 when every attribute is
  known; attributes you cannot see add more uncertainty on top, so scout the enemy before trusting a
  close call).
- **Two ways to make it steadier.** A new intel track, **Battle simulation** (first point +10, then +9,
  +8, ...), adds guesses and test fights per enemy, and a new smith ring, **Foresight** (+2 to +6, rounded
  down when stacked), does the same. Most of the estimate's error early on comes from attributes you
  cannot see, so spending intel on Enemy scouting steadies it too.
- **Roster comparison table.** The roster is one table with one enemy per column and one attribute per
  row: offense rows first, then a Defense divider (it repeats the enemy names, so you can pick a column
  from the lower half on a phone) and the defense rows. Click a column to choose that enemy. It is also on
  the Adventurer tab.

Map and time:
- **Fresh cells cost 2 extra minutes.** Each cell of the 3x3 search area that no search has worked on yet
  adds 2 minutes to that search (once per cell, so a whole field costs about 126 minutes more than before,
  spread over its searches). Fresh cells have a small dot on the map, and the search panel shows the
  total. Finishing an area before moving on keeps searches cheap.
- **Work-day bar.** A thin bar along the bottom of the top bar shows how much of the 08:00-18:00 day is
  left (it turns yellow, then red, as the day runs out).

Saves:
- **1.2 saves use a new key** (`smithsy-save-v3`). 1.1 can't read them, but it won't overwrite them
  either. A 1.1 save (or a 1.0 save) is converted the first time 1.2 starts without a save of its own.
  Durability stored as whole numbers stays valid.

For developers: `node tools/balance.mjs --section benchmark` plays 100 fixed games with the careful bot
and reports the share of runs still alive at each day, so every version's difficulty can be compared
(`docs/BENCHMARKS.md`); new `specials` and `estimator` reports check the tuning above.

## 1.1

Field and processing changes:
- **Choose what to bring back.** Everything you find goes to a pile at that field, with no limit. When
  you leave a field you tick up to 20 items to carry ("rarest first" is the default); the rest stays in
  that field's pile for later. Piles show on the world map.
- **Debris is cleared by searching.** There is no separate Clear button. Each debris cell has a
  thickness of 20–60 (shown on the cell); a search spends its effort clearing debris first, and any
  leftover effort searches that cell in the same search.
- **Boulders.** Every field has one boulder cell that can never be cleared or searched.
- **Debris clearing skill** now adds +10% clearing power per level (+100% at level 10). Its XP is 1 per
  point of debris cleared.
- **Gem cutting** starts D-heavy with 15% failure (novice table: Fail 15, D 45, C 25, B 10, A 4, S 1).
  The gem's grade skill blends toward the master table (Fail 10, D 20, C 25, B 22, A 15, S 8) as it
  levels; the cutting skill lowers failure. Gem luck rings upgrade on top.
- **Every gem type is equally likely** to be found.
- **Grades are shown lowest to highest, left to right** (Fail, D, C, B, A, S) everywhere.

Other:
- Version number in the top bar and Help.
- Start-up problems now show an on-screen message with the error, instead of a blank page.
- A save that can't be loaded is kept as a backup and a new game starts, instead of a blank page.
- Works in older browsers too (removed a newer JavaScript shorthand that older Firefox can't read).

## 1.0

First playable release: world map and fields, searching, refining and cutting, smithing with gem
infusion, rings, skills, intel, daily enemy roster and fights with a combat log, win-chance estimate,
night repairs, balance tools and documentation.
