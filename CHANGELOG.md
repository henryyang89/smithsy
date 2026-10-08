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

Branches that exist now: `release/v1.0` and `release/v1.1`. `release/v1.2` is created from `main` right
after 1.2 is merged (see the release steps in `HANDOFF.md`); rolling 1.2 back means going to `release/v1.1`
with the steps above. A game saved in 1.2 stays in the browser while 1.1 is live (see the save table below).

Saves, going back and forth (each save format has its own browser-storage key, and a newer save is never
overwritten by an older version):

| Version | Reads | Saves under |
|---|---|---|
| 1.2 | its own save; if there is none, converts a 1.1 save, else a 1.0 save | `smithsy-save-v3` |
| 1.1 | its own save; if there is none, converts a 1.0 save | `smithsy-save-v2` |
| 1.0 | its own save | `smithsy-save-v1` |

- An older version **cannot read** a newer save: if you roll back from 1.2 to 1.1, 1.1 shows its own
  save (or a new game if it never had one), not your 1.2 run. Your 1.2 run is not lost: it stays in the
  browser, and coming back to 1.2 picks it up again.
- A conversion is a copy made once, the first time the newer version starts without a save of its own.
  The older save is left untouched, so progress made later in the older version is not carried over.
- A save that can't be loaded is kept as a backup (`smithsy-save-backup-<time>`) and a new game starts.

## 1.2

Fights and gear:
- **Gear wears much faster, and a new skill slows it down.** Every item the adventurer uses now loses
  about 10% durability per fight (a roll of 8-12%, was 3-7%), a little more against tougher enemies
  (elite x1.1, champion x1.2). Wear is shown with one decimal. The new **Gear care** skill takes 1% off
  the wear per level (10% off at level 10) and earns its XP from every fight the adventurer survives
  (100 XP per fight, so level 10 comes after about 55 fights). Why: repairs and spare bars now matter all
  game, and you get a way to lower the bill.
- **Enemy specials are dangerous and resistances matter.** Magic, Piercing, Stunning and Chilling were
  all raised (Magical 10/15/25 %, Piercing 10/25/60 %, Stunning 5/15/35 % for 1.5 s, Chilling
  10/20/40 % for 2.5 s; every resistance is 0/20/40 %). Switching one special from Normal to High now
  costs a mid-game set about 11-20 win points, and the matching armor gem and resistance ring win back
  about half to all of it. Why: before, Piercing and Stunning were almost harmless, so their gems, armor
  and resistance rings were not worth wearing.
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
  picked and fills a "Win estimate" row under the roster table. Changing the gear or rings, confirming, or
  starting a new game stops a run that is no longer valid; choosing another enemy does not.
- **A smaller, honest estimate.** It now runs 10 guesses of the hidden attributes x 10 test fights per
  enemy (was 40 x 30), so it is faster and a little noisy. Every estimate shows its margin (for example
  "62% +/- 12": how much the simulation alone could be off; attributes you cannot see add more
  uncertainty on top, so scout the enemy before trusting a close call).
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
