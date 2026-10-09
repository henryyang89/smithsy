# Smithsy

Smithsy is a browser game about numbers and luck. You are a miner and blacksmith: you dig ore and gems
out of the fields around your camp, refine them into bars, and smith gear for your adventurer, who fights
one enemy every day with what you made. Pick fights wisely: one lost fight ends the run, and enemies get
stronger every day.

It is a static site (plain HTML + ES modules, no build step, no dependencies) and saves in your browser.
Current version: **2.0** (shown in the game's top bar and in Help; see [Versions & rollback](#versions--rollback)).

**Play:** <https://henryyang89.github.io/smithsy/> (once GitHub Pages is switched on, see below).

## Play locally

ES modules do not load from `file://`, so serve the folder with any static web server:

```sh
cd smithsy
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Other servers work too (for example `npx serve .`).

## Deploy on GitHub Pages

The repository is `henryyang89/smithsy`. GitHub Pages serves the files as they are; there is nothing to
build. **The live site is deployed from `main`.** Work happens on other branches and reaches `main`
through a pull request (see [Versions & rollback](#versions--rollback)).

1. Make sure the game is on `main` (merge the pull request of the version you want live).
2. In the repository open **Settings → Pages**.
3. Under **Build and deployment** set **Source: Deploy from a branch**.
4. Pick the branch **`main`** and the folder **/ (root)**. Click **Save**.
5. After a minute or two the game is live at <https://henryyang89.github.io/smithsy/>. Every later merge
   into `main` redeploys it automatically.

The empty `.nojekyll` file in the root tells GitHub Pages to skip Jekyll processing and serve every file
as is. All paths in the game are relative, so it works from the `/smithsy/` sub-path.

## Versions & rollback

- The version number lives in `js/version.js` and shows in the top bar and in Help. The tenths place goes
  up for small changes (1.1, 1.2, …), the ones place for big ones (2.0). The live version is the one on
  `main`; a version only goes live when its pull request is merged.
- **[`CHANGELOG.md`](CHANGELOG.md)** lists what changed in each version and has the step-by-step
  **rollback** instructions (open a pull request from `release/vX.Y` into `main`, or revert the bad
  version's pull request).
- Every release is kept on GitHub as a branch named `release/vX.Y` (branches instead of tags, because tags
  can't be pushed from the environment the game is built in), so any version can be looked at, played
  locally or put back.
- Saves are per version: a version only loads the save it wrote itself (key `smithsy-save-<version>`, for
  example `smithsy-save-2.0`). A new version starts a fresh game and leaves the older version's save
  untouched in the browser, so going back to that version finds it again (see [Save data](#save-data)).
  **2.0 starts a fresh game**: it does not read or convert a 1.x save, and a 1.x save left in the browser
  opens again in 1.2.

## Start-up problems (blank page, older Firefox)

If the game has not started a few seconds after the page loads, a red box **"Smithsy failed to start in
this browser"** appears with the error messages, the browser version and the page address. Please copy
that text and send it to the developer. Reloading or trying another browser may help.

The game is developed and played in Chrome. Version 1.1 removed the `||=` shorthand, which Firefox before
version 79 cannot read (one possible cause of a blank page there), but Firefox has not been checked since
that report and the cause is not confirmed. The game still uses `?.` and `??`, so it needs at least Firefox
74, Chrome/Edge 80 or Safari 13.1.

## How to play

**The day.** Each day runs from 8:00 to 18:00 (600 minutes). Only actions cost time: travelling,
searching, refining, cutting, smithing and repairing. The top bar shows the version, the day, the clock,
where you are, your bag (and, in a field, that field's pile and the walk home), a chip when you have an intel
point to spend, the **End day** button and **End run**; a thin **bar along its bottom edge** fills from left to
right as the work day passes (it turns yellow, then red). The day does **not** end by itself at 18:00: walk back
to camp and press **End day** (it only works at camp). **There is no score on screen while you play**: you see it
when the run ends, in the run summary.

**Day loop**

1. **Map tab: gather.** The 7x7 world map has your camp in the center and 40 fields around it (8 map cells
   are blocked, and a map is made again if the rocks force a long detour). Farther fields are richer (more
   items, more coal and gems; mythril only in the farthest fields) but take longer to reach: a step is 15
   minutes, plus 2.5% for every item you carry. Click a field to travel there. Inside a field (9x9 cells,
   drawn as 9 plots of 3x3), click a cell and press **Search area** (on a phone the button is right under the
   grid) to search the 3x3 area around it. Each search digs about 30% into every cell (30% ± 5, rolled
   separately for each cell, shown as "% searched"), so about four searches finish a cell; hidden ores and
   gems are found once the search passes their depth. A search takes 27 minutes **plus 2 minutes for every
   fresh cell** in its 3x3 area (a cell nobody has worked on yet, marked with a small dot), so finish an area
   before moving on.
   - **Sight.** Every item in the ground has a hidden sight threshold (copper 1-40, iron 11-60, coal 16-70,
     gems 16-80, mythril 51-100). In the field you stand in, you see the items whose threshold is within your
     sight (a tag on the cell, also under debris). Sight = Ore sight intel + Ore sight rings; it is 0 on day 1,
     so at first you see nothing and search blind.
   - **Debris** (brown striped cells, the number is how much is left, 20-60 to start) is cleared by searching:
     a search spends that cell's effort on the debris first, and any leftover effort searches the cell in the
     same search. The Debris clearing skill makes each search clear more.
   - **Boulders** (dark rocks; 2 per field near camp, up to 4 far away) can never be cleared or searched and
     hold nothing; they do not count toward a field's searched %.
   - **Field pile.** Everything you find goes to that field's pile (no limit; the world map shows a badge with
     the number of items waiting in each field's pile). In the field you can move single items between your bag
     and the pile for free.
   - **Choose what to carry.** When you leave a field whose pile has items, you tick up to 20 items to carry
     from your bag and the pile ("Rarest first" is the default). The rest stays in that field's pile for a later
     trip. The **Travel** skill shortens every trip and the **Carrying** skill softens the 2.5% per item.
   - A search can only start if you can still walk home by 18:00 with a full load: your bag plus this field's
     pile, up to 20 items (leaving items behind does not buy extra time). Travelling out to a field needs time
     to get there and back by 18:00, counting what you carry in and what waits in the destination's pile. The
     walk home is always allowed. Walking back to camp unloads what you carry into storage.
   - A searched cell stays searched, so the map is the whole supply for the run.
2. **Workshop tab: refine, cut, smith, repair.** At camp, refine ore into bars (copper, iron, steel = iron +
   coal, mythril) and cut gems. Each attempt rolls a grade or fails, listed lowest to highest: Fail, D, C, B, A,
   S. The Workshop shows your chances as they are now (skills and rings included), and the time for each
   attempt next to the buttons; hover a skill on the Skills & Intel tab for what it gives. A message under a
   table turns red when any attempt failed. Cutting gets better with practice (each gem has its own grade and
   cutting skill). Smith gear by clicking a gear type, a material, a bar grade and, if you like, a gem and its
   grade; all bars of an item share one material and grade. The overview at the top lists your ore, bars, gems and a
   table of your gear by type and material with a tag for each gem, so you can see what to make next. A top
   grade (S) piece of one material is a little better than a plain (D) piece of the next, but never as good as
   its C. After a craft the gem choice goes back to "none".
   - **Repairs happen by day, at camp, and cost time.** Only gear the adventurer does not have can be repaired
     (packed gear is away all day). A repair always goes back to 100% and costs 35% of the item's bars (and cut gem)
     for a full repair, scaled by the % repaired, and 2.5 times the smithing time, scaled the same way; the
     repair skills of the bar type and General repair make it faster. The **Repair** button sits to the right of the
     item's durability (Workshop and Adventurer tab). If you do not have enough bars or gems of the item's own
     grade, the lowest higher grade you have enough of is used instead, with a warning; it gives no benefit.
   - **Scrap** destroys an item and returns bars only: 35% of its bars times its durability (a 60% copper sword
     returns 0.42 copper bars). The gem is lost.
3. **Adventurer tab.** See today's fight, your gear (with a warning where an item could break), the rings the
   adventurer wears, the statistics, and **tomorrow's roster** of 7 enemies (2 normal, 3 elite, 2 champion) as one
   comparison table: one enemy per column, offense rows first, then the defense rows. Most enemy attributes are
   hidden until you scout them with intel; elites are a little harder to scout than normals and champions harder
   still (the per-tier chances are shown).
4. **End day** (at camp). If the adventurer fought today you get the battle report: the gear used and the gear
   not used (separately), the wear of each used item, the full combat log, the enemy's banner and the ring
   reward. A loss ends the run: the run summary shows the score, the days survived, a replay of the fight as a
   spread of outcomes, and whether gear you left at home could have helped.
5. **Plan tomorrow.** Pick one enemy (click its column in the roster table), pack up to 2 items per gear type
   (the adventurer uses the best one for each type once the real enemy is known; **pack mules** raise the limit,
   see below), choose up to 10 adventurer rings, and check the **Matchup** table (hit chances, damage per hit,
   attack speed, damage per second, HP and a rough time to win or lose; hidden attributes show as ranges). A
   **warning mark** sits next to packed gear that could break in that fight; **Leave worn gear home** unpacks the
   items that need a repair. Your **win chance against every enemy is worked out by itself** (5 guesses of the hidden
   attributes x 5 test fights each) and shown in the table's win-estimate row. It is small on purpose, so each
   result shows its margin ("62% ± 12", or "100% (−12)" when it can only be lower): a rough guide, not a promise,
   and a lost fight ends the run. The **Battle simulation** intel track and **Foresight** smith rings add guesses and
   test fights. **Spend your intel points first: the next day cannot start while a point that can still raise a
   track is unspent.** Confirm to start the next day. Day 1 is a rest day; from day 2 on there is a fight every day.

**Banners.** Every enemy marches under one of three banners (Red, Black, Gold), at random; you only sometimes
know which (Banner scouting raises the chance, and the battle report always shows it). For every 4 fighters your
adventurer beats from the banner it has beaten most, it captures a pack mule and can carry one more item of one
gear type (random type, each type once).

**Wear and repairs.** Each fight, every item the adventurer used loses about 10% durability (a roll of 8-12%,
times 1.1 against an elite and 1.2 against a champion, times one minus the **Gear care** skill). Durability is
shown as a whole number (the game tracks the decimals); an item always lasts the whole fight it is used in, and
at 0% afterwards it is destroyed.

While the battle report, the plan screen or the run summary is open, the **Rings**, **Skills & Intel**, **Log** and
**Help** tabs stay available so you can check numbers before deciding.

**Other tabs.** **Rings**: wear up to 10 smith rings (they speed up and improve your own work and apply at once;
swap them at the start of a day or while planning). Adventurer rings marked as worn there are only the default
selection for the plan; the plan screen decides what the adventurer actually wears.
**Skills & Intel**: 35 skills level up automatically as you work (travel, carrying, searching, debris, general
refining / cutting / repair, Gear care, and for each bar type and gem type its own grade, refining or cutting,
smithing and repair skills); an intel point arrives every 5 days and improves enemy scouting, ring type scouting,
ring grade scouting, banner scouting, ore sight or **Battle simulation**. Each track has its own steps, and the
steps get smaller as you spend more on it.
**Log**: everything that happened. **Help**: the rules plus a live reference of every number in the game, the
version number and a link to the changelog.

**Ending a run.** A lost fight ends the run. To stop earlier, press **End run** in the top bar: the adventurer
retires and the run is scored like a lost fight would be. The run summary explains how the score is made up and
shows your best score for this version. Each win adds points by tier (tougher tiers are worth more); no points are
shown anywhere before the run ends.

## Project structure

```
index.html            page shell; loads css/ and js/main.js; start-up diagnostics box (plain script)
.nojekyll             tells GitHub Pages to serve files as they are
CHANGELOG.md          what changed in each version, and how to roll back
css/style.css         shared styles; css/ui-*.css per screen
js/config.js          EVERY tunable number (the place to rebalance)
js/version.js         the version number shown in the game (bump it for each release)
js/main.js            UI shell: top bar (with the work-day bar), tabs, side log, phase screens, save/load
                      (per-version saves, backups, a second open tab is locked out)
js/core/              game logic, no DOM (runs in the browser and in Node)
  game.js             state, day flow, battle resolution, End run, save format (per version, no migrations)
  map.js              world map, fields, travel, search (clears debris), boulders, field piles and
                      choosing what to carry, sight
  processing.js       refining and cutting, grade odds (gem novice -> master tables)
  gear.js             gear stats, smithing, wear, could-break flag, repair by day (higher-grade substitutes), scrap
  combat.js           combat stats, hit chance, attack-bar fight simulation with log
  sim.js              best-gear choice, win-chance estimate and its margin, simCounts (intel + Foresight)
  enemies.js          rosters, attributes, enemy stats, banners and what you can see of them
  groups.js pack.js   banners and pack mules; what the adventurer can pack
  replay.js           the loss analysis: replays of a lost fight and "would other gear have helped?"
  rings.js skills.js intel.js bonuses.js rng.js util.js
js/ui/                one module per screen (mapview, workshop, adventurer, ringsview, skillsview, logview,
                      help, endday = battle report + plan + run summary) + shared widgets: gearlist.js (the gear
                      list with Repair and Scrap), repairui.js, inventory.js (the storage and gear overview),
                      estimates.js (the automatic win estimates), present.js (text helpers), dom.js
tests/                tests for the core and the screens (node:test), 625 tests in 25 files (+ two helper modules)
tools/balance.mjs     balance report (economy, power curve, day 2, bot playthrough with three player personas,
                      difficulty benchmark, specials, estimator accuracy, intel, what-ifs)
docs/SPEC.md          requirements and design decisions
docs/BALANCE.md       every number explained: formulas, examples, tuning notes, current results, known misses
docs/BENCHMARKS.md    difficulty of each version: survival curve of 100 fixed games per version and persona
docs/TUNING-2.0.md    the 2.0 tuning log: every config value changed and why, every target and its result
docs/PLAN-2.0.md      the 2.0 implementation plan (requests R1-R46, answers A1-A4 and U1-U3)
HANDOFF.md            notes for picking the project up in a new session
package.json          script shortcuts only (npm test, npm run balance); no dependencies
```

## Tweaking numbers

All game numbers are in **`js/config.js`**. Edit a value, reload the page, and the game, the Help tab and
the tools all use the new number. **`docs/BALANCE.md`** explains every number: its config path, the exact
formula, a worked example, and what raising or lowering it does. Start with its "Quick levers" table, and
use the balance tool's `--set` flag (below) to try a change before editing the file.

Note: an existing save keeps its already generated map and rosters; start a **New game** to see changes
that affect generation (field loot, debris, boulders, map layout, enemy rosters).

## Tests

Requires Node.js 18 or newer. From the repository root:

```sh
npm test                       # runs: node --test tests/*.test.mjs
node --test tests/*.test.mjs   # same, without npm
```

(`node --test tests/` works on Node 18/20 but not on Node 22+, which treats the folder as a file.)
There are no dependencies to install; `package.json` only holds these script shortcuts.

## Balance tool

`tools/balance.mjs` runs the real core engine in Node and prints a balance report. It never edits
`js/config.js`. Every section ends with a one-line SUMMARY and prints the 2.0 targets
(`docs/PLAN-2.0.md` section 9) with an ok / LOW / HIGH flag.

- **economy**: what a field holds (debris, boulders) and how big the finite map is, items per search, how
  much search effort goes into clearing debris, what sight is worth, what one trip finds and carries (finds go
  to the field's pile), minutes per item, refining and gem-cutting odds, and the time needed to mine, refine and
  smith a full set of each material (about 10 s). Targets T-E1 to T-E5.
- **power**: win chances of different gear against each enemy tier from day 2 to day 80, the weakest set that
  stays safe on each day, and how much each gem, ring and gear slot is worth (about 5 s). T-MID.
- **day2**: the first fight (day 2) with no equipment, tier by tier, by how many of Magical / Stunning /
  Chilling the enemy has at High, then with a day-1 kit (a copper sword, sword and chest, plus matching gems).
  Targets T-R7 and T-GEAR (a) / (b) (about 3 s).
- **bot**: a scripted player runs whole games through the real game API (it repairs by day at camp, in a field it
  searches, then chooses what to carry and leaves the rest in the pile); shows survival, score, material
  progression, the daily time split, field piles, repairs, how fast it uses up the map's finite supply, rings,
  skills, intel, and the true win chance of its packed gear against every roster enemy (T-GEAR (c)) (about 2
  minutes for 40 runs). `--persona` picks the player: **careful** (reads the estimate, fights only fights it is
  at least 90% sure of), **champion** (goes for score) or **casual** (never reads the estimate, fights normals,
  then elites).
- **benchmark** (separate, not part of `all`): the difficulty of this version as one number you can compare
  with other 2.x versions. All three personas play 100 fixed games (the same seeds in every version) with the
  in-game automatic estimate, and the report shows the **share of runs still alive at day 2, 3, 4, 5, 10, 15,
  ... 100**, the median life, the mean score and a ready-made row for
  [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) (about 2 minutes with `--jobs 4`).
- **specials**: how dangerous each enemy special (magic, piercing, stun, slow) is, how much the matching armor
  gem and ring win back, and how the adventurer's own gems compare (T-R33; about 10 s).
- **estimator**: how far off the automatic win estimate is at 5 x 5 and larger sizes at several scouting
  levels (T-A2; about 30 s).
- **intel**: does the choice of intel track matter? Plays the bot with each track first, with the persona's own
  list and with none (T-R42; about 5 minutes with `--jobs 4`).

```sh
node tools/balance.mjs                                  # economy + power + bot (or: npm run balance)
node tools/balance.mjs --section day2                   # one section: economy | power | day2 | bot | benchmark | specials | estimator | intel | all
node tools/balance.mjs --section bot --persona casual --seeds 40   # 40 runs of one persona (default careful, 20 runs)
node tools/balance.mjs --section bot --immortal         # bot can't lose: how long the finite map lasts
node tools/balance.mjs --section benchmark --jobs 4     # difficulty benchmark: 3 personas x 100 fixed games
node tools/balance.mjs --section intel --jobs 4         # intel tracks compared (100 games per variant)
node tools/balance.mjs --quick                          # small samples, smoke test in a few seconds
node tools/balance.mjs --help                           # full option list
```

| Flag | What it does |
|---|---|
| `--section S` | `economy`, `power`, `day2`, `bot`, `benchmark`, `specials`, `estimator`, `intel` or `all` (= economy + power + bot; default) |
| `--persona P` | `careful` (default), `champion`, `casual` or `all` (benchmark default) |
| `--intel I` | how the bot spends intel: `persona` (its own list, default), `only:<track>` (that track first) or `none` |
| `--seeds N` | economy: generated maps (default 100); bot: runs (default 20; use 40+ to compare close what-ifs); benchmark and intel: runs (default 100, the fixed seed list `mixSeed(31337, 0..N-1)`) |
| `--days N` | bot: last day to play (default 80); benchmark: default 100; intel: default 60 |
| `--estimator game\|bot` | how the bot estimates win chances. `game` (benchmark default) = the in-game automatic estimate of that version; `bot` (bot-section default) = the bot's own larger, version-independent estimate |
| `--jobs N` | benchmark and intel: run the seeds in N parallel processes (same numbers as 1 process) |
| `--samples N` | power: hidden-attribute guesses per cell (default 100, x 50 fights each) |
| `--minwin P` | bot: lowest estimated win % it accepts for a fight (default: the persona's, careful 90) |
| `--future F` | bot: points one survival is worth when choosing fights (default: the persona's) |
| `--ablate x,y` | bot: play without systems: `gems`, `rings`, `skills`, `intel`, `repair` |
| `--immortal` | bot: enemies deal no damage and the bot fights an elite every day, so no run ends early; shows how fast a surviving careful player uses up the map ("Map supply" table) |
| `--carry value\|default` | bot (and the economy trips): what to take home from a field. `value` = the most valuable items of bag + pile by the bot's own values; `default` = the game's "Rarest first" default (casual's own choice) |
| `--set path=value` | what-if: override a `CONFIG` value in memory for this run (repeatable) |
| `--quick` | small sample sizes |

`--set` examples (the path walks object keys and array indices, `*` matches every key or index, the value
is parsed as JSON; a path that does not exist in `CONFIG` is rejected):

```sh
node tools/balance.mjs --section day2 --set enemies.tiers.champion.hp=90
node tools/balance.mjs --section bot --set 'field.byDistance.*.ores.mythril=2'
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'
node tools/balance.mjs --section economy --set 'field.debrisAmount={"min":10,"max":30}'
node tools/balance.mjs --section bot --seeds 40 --ablate rings,skills
node tools/balance.mjs --section specials --set 'gemEffects.topaz.weapon.stunChance=[15,20,24,25,26]'
```

Each section ends with a one-line `ECONOMY SUMMARY`, `DAY2`, `POWER SUMMARY`, `BOT SUMMARY`, `SPECIALS`,
`ESTIMATOR SUMMARY`, `INTEL` or `BENCHMARK` line; run the baseline and the what-if with the same flags and
compare those lines. The 2.0 tuning log, with every target and its measured value, is `docs/TUNING-2.0.md`;
the targets that are not met and why are in `docs/BALANCE.md` ("Known misses"); the version-to-version
difficulty table is in `docs/BENCHMARKS.md`.

## Save data

The game saves automatically after every action in your browser's `localStorage` (key
`smithsy-save-<version>`, for example `smithsy-save-2.0`; best score in `smithsy-best-<version>`). Saves
stay on your device and are per browser and per site address. **New game** (top bar, or after a game over)
replaces the current run; the best score is kept. To wipe everything, clear the site's data in your browser.

- **Saves are per version.** A save is only loaded by the game version that wrote it. A new version does not
  read or convert older saves: it starts a fresh game and says so once. The older version's save is left
  untouched in the browser, so that version still finds it when you go back to it, and it never overwrites
  a newer version's save either.
- **A save that can't be loaded** (not JSON, the wrong version, or a save with a missing part such as the
  roster) is kept as a backup (key `smithsy-save-backup-<time>`, never deleted) and a new game starts, with a
  message, instead of a blank page. The same backup is made before "Start a new game" on the error screen.
- **One tab at a time.** If the game is open in two tabs, the tab that did not save last locks itself ("This game
  is open in another tab") and stops saving, so it can't overwrite the newer game or replay a result the other
  tab already used.

For debugging, the browser console has `window.smithsy` (`ctx`, `Game`, `CONFIG`).

## More docs

- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version and how to roll back.
- [`docs/SPEC.md`](docs/SPEC.md): what the game does and the design decisions behind it.
- [`docs/BALANCE.md`](docs/BALANCE.md): the tuning handbook and current balance results.
- [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md): how tough each version is, as a survival curve of the
  careful bot on 100 fixed games, and how to add a version's row.
- [`HANDOFF.md`](HANDOFF.md): project status, known concerns and a session log.
