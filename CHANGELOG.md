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

Saves: v1.1 reads v1.0 saves and converts them. v1.0 can't read v1.1 saves, but v1.1 saves under a
different browser-storage key, so going back to v1.0 doesn't break or overwrite a v1.1 save.

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
