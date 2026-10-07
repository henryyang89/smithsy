# Smithsy

Smithsy is a browser game about numbers and luck. You are a miner and blacksmith: you dig ore and gems
out of the fields around your camp, refine them into bars, and smith gear for your adventurer, who fights
one enemy every day with what you made. Pick fights wisely: one lost fight ends the run, and enemies get
stronger every day.

It is a static site (plain HTML + ES modules, no build step, no dependencies) and saves in your browser.
Current version: **1.1** (shown in the game's top bar and in Help; see [Versions & rollback](#versions--rollback)).

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
  up for small changes (1.1, 1.2, …), the ones place for big ones (2.0). The live version is 1.0 until
  1.1 is merged into `main`.
- **[`CHANGELOG.md`](CHANGELOG.md)** lists what changed in each version and has the step-by-step
  **rollback** instructions (open a pull request from `release/vX.Y` into `main`, or revert the bad
  version's pull request).
- Every release is kept on GitHub as a branch named `release/vX.Y` (branches instead of tags, because tags
  can't be pushed from the environment the game is built in), so any version can be looked at, played
  locally or put back.
- Saves: v1.1 reads v1.0 saves and converts them (see [Save data](#save-data)); v1.1 saves use a new
  storage key, so going back to v1.0 neither breaks nor overwrites them.

## Start-up problems (blank page, older Firefox)

If the game has not started a few seconds after the page loads, a red box **"Smithsy failed to start in
this browser"** appears with the error messages, the browser version and the page address. Please copy
that text and send it to the developer. Reloading or trying another browser may help.

Version 1.1 removed the `||=` shorthand, which Firefox before version 79 cannot read (one possible cause
of a blank page there). The game still uses `?.` and `??`, so it needs at least Firefox 74, Chrome/Edge 80
or Safari 13.1. Whether `||=` was the cause of the blank page reported in Firefox is not confirmed yet: the
text from the start-up box will tell.

## How to play

**The day.** Each day runs from 8:00 to 18:00 (600 minutes). Only actions cost time: travelling,
searching, refining, cutting, smithing and repairing by day (repairs at night are free of time). The top
bar shows the version, the day, the clock, where you are, your bag (and, in a field, that field's pile),
your score, and the **End day** button. The day does **not** end by itself at 18:00: walk back to camp and
press **End day** (it only works at camp).

**Day loop**

1. **Map tab: gather.** The 5x5 world map has your camp in the center and 20 fields around it (4 map
   cells are blocked). Farther fields are richer (more items and more coal; mythril only in the farthest
   fields) but take longer to reach. Every gem type is equally likely everywhere. Click a field to travel
   there. Inside a field (8x8 cells), click a cell and press **Search area** to search the 3x3 area around
   it. Each search digs about a third into every cell (35% ± 5, rolled separately for each cell, shown as
   "% searched"), so about three searches finish a cell (sometimes four); hidden ores and gems are found
   once the search passes their depth. Search efficiency rings and the skill raise the average; the map
   shows your current range.
   - **Debris** (brown striped cells, the number is how much is left, 20–60 to start) is cleared by
     searching: a search spends that cell's effort on the debris first, and any leftover effort searches
     the cell in the same search. The Debris clearing skill makes each search clear more.
   - **Boulders** (one dark rock per field) can never be cleared or searched and hold nothing; they do not
     count toward a field's searched %.
   - **Field pile.** Everything you find goes to that field's pile (no limit; the world map shows a badge
     with the number of items waiting in each field's pile). In the field you can move single items
     between your bag and the pile for free.
   - **Choose what to carry.** When you leave a field whose pile has items, you tick up to 20 items to
     carry from your bag and the pile ("Rarest first" is the default: keep your bag, then fill the free
     slots with mythril, diamond, emerald, sapphire, topaz, ruby, coal, iron, copper in that order). The
     rest stays in that field's pile for a later trip. Each carried item adds 1% travel time.
   - A search can only start if you can still walk home by 18:00 with a full load: your bag plus this
     field's pile, up to 20 items (leaving items behind does not buy extra time). Travelling out to a field
     needs time to get there and back by 18:00. The walk home is always allowed. Walking back to camp
     unloads what you carry into storage.
   - Fields do **not** regrow: a searched cell stays searched, so the map is the whole supply for the run.
2. **Workshop tab: refine, cut and smith.** At camp, refine ore into bars (copper, iron, steel = iron +
   coal, mythril) and cut gems. Each attempt rolls a grade or fails, listed lowest to highest: Fail, D, C,
   B, A, S. Bars fail 10% of the time. **Gem cutting improves with practice:** each gem starts on a
   novice table (Fail 15, D 45, C 25, B 10, A 4, S 1) and that gem's grade skill moves it toward the master
   table (Fail 10, D 20, C 25, B 22, A 15, S 8); the cutting skill lowers failure and Gem luck rings
   upgrade on top. The Workshop shows the odds (with your bonuses) before you click, and the novice and
   master tables. Smith gear from bars of the same material and grade (sword 2, chest 3, helmet 2,
   gloves 2, boots 2), optionally infusing a cut gem for a bonus. You can repair worn gear here by day
   (it costs time, and only gear at home, not the gear the adventurer took today), but repairs at night
   are free of time (steps 4 and 5).
3. **Adventurer tab.** See today's fight, your gear and **tomorrow's roster** of 7 enemies (2 normal,
   3 elite, 2 champion). Most enemy attributes are hidden until you scout them with intel.
4. **End day** (at camp). If the adventurer fought today you get the battle report: full combat log, gear
   wear, **Repair** buttons for the gear just used, and the ring reward. A loss is game over.
5. **Plan tomorrow.** Pick one enemy, pack up to 2 items per gear slot (the adventurer uses the best one
   for each slot once the real enemy is known), choose up to 10 adventurer rings, check the **Matchup**
   table (hit chances, damage per hit, attack speed, damage per second, HP and a rough time to win or lose;
   hidden attributes show as ranges), and optionally run the win-chance simulation. Confirm to start the
   next day. **Repair** any gear here before packing: at night (battle report and plan screen) repairs
   cost materials but no time. Packed gear is away all day and cannot be repaired; only the items
   actually used lose durability.

**Repairs** always go back to 100% and cost 35% of the item's bars (and gem) for a full repair, scaled by
the % repaired. If you do not have enough bars or gems of the item's own grade, the lowest higher grade you
have enough of is used instead, with a warning; it gives no benefit (the item keeps its grade), and grades
are never mixed within one repair.

While the battle report, the plan screen or the game-over screen is open, the **Rings**, **Skills & Intel**,
**Log** and **Help** tabs stay available so you can check numbers before deciding.

**Other tabs.** **Rings**: wear up to 10 smith rings (they speed up and improve your own work and apply at
once; swap them at the start of a day or while planning at night). Adventurer rings marked as worn there are only the default selection for tonight's plan; the plan
screen decides what the adventurer actually wears, and changes never affect today's fight.
**Skills & Intel**: skills level up automatically as you work (a level-10 skill is as strong as a C-grade
ring of the same kind; debris clearing, the refining/cutting failure skills and the gem grade skills have
no ring); an intel point arrives every 5 days and improves enemy scouting, ring scouting or ore sight.
**Log**: everything that happened. **Help**: rules plus a live reference of every number in the game, the
version number and a link to the changelog.

**Score.** Each win scores points: normal 10, elite 25, champion 50. A draw (only possible at an internal
safety time cap) scores nothing but the run goes on. The run is endless; your best score is remembered.

## Project structure

```
index.html            page shell; loads css/ and js/main.js; start-up diagnostics box (plain script)
.nojekyll             tells GitHub Pages to serve files as they are
CHANGELOG.md          what changed in each version, and how to roll back
css/style.css         shared styles; css/ui-*.css per screen
js/config.js          EVERY tunable number (the place to rebalance)
js/version.js         the version number shown in the game (bump it for each release)
js/main.js            UI shell: top bar, tabs, side log, phase screens, save/load (v1.0 save migration, backups)
js/core/              game logic, no DOM (runs in the browser and in Node)
  game.js             state, day flow, battle resolution, save format (v1.0 -> v1.1 migration)
  map.js              world map, fields, travel, search (clears debris), boulders, field piles and
                      choosing what to carry, regrowth (off)
  processing.js       refining and cutting, grade odds (gem novice -> master tables)
  gear.js             gear stats, smithing, repair (night = free, higher-grade substitutes)
  combat.js           combat stats, hit chance, attack-bar fight simulation with log
  sim.js              best-gear choice and win-chance estimate
  enemies.js          rosters, attributes, enemy stats
  rings.js skills.js intel.js bonuses.js rng.js util.js
js/ui/                one module per screen (mapview, workshop, adventurer, ringsview,
                      skillsview, logview, help, endday) + repairui.js (repair widgets shared
                      by the workshop and the night screens) + dom.js helpers
tests/                unit tests for the core (node:test), 274 tests
tools/balance.mjs     balance report (economy, power curve, bot playthrough, what-ifs)
docs/SPEC.md          requirements and design decisions
docs/BALANCE.md       every number explained: formulas, examples, tuning notes, current results
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
`js/config.js`.

- **economy**: what a field holds (debris, boulders) and how big the finite map is, items per search, how
  much search effort goes into clearing debris, what one trip finds and carries (finds go to the field's
  pile), minutes per item, refining and gem-cutting odds (novice, halfway and master tables), and the time
  needed to mine, refine and smith a full set of each material (about 10 s).
- **power**: win chances of different gear against each enemy tier from day 2 to day 80, the weakest set
  that stays safe on each day, and how much each gem, ring and gear slot is worth (about 5 s).
- **bot**: a scripted careful player runs whole games through the real game API (it repairs at night, for
  free; in a field it searches, then chooses what to carry and leaves the rest in the pile); shows
  survival, score, material progression, the daily time split, field piles, repairs, how fast it uses up
  the map's finite supply ("Map supply"), rings, skills and intel (about 2–3 minutes for 40 runs).

```sh
node tools/balance.mjs                                  # all sections (or: npm run balance)
node tools/balance.mjs --section power                  # one section: economy | power | bot | all
node tools/balance.mjs --section bot --seeds 40         # 40 bot runs (default 20)
node tools/balance.mjs --section bot --immortal         # bot can't lose: how long the finite map lasts
node tools/balance.mjs --quick                          # small samples, smoke test in a few seconds
node tools/balance.mjs --help                           # full option list
```

| Flag | What it does |
|---|---|
| `--section S` | `economy`, `power`, `bot` or `all` (default `all`) |
| `--seeds N` | economy: generated maps (default 100); bot: runs (default 20; use 40+ to compare close what-ifs) |
| `--days N` | bot: last day to play (default 80) |
| `--samples N` | power: hidden-attribute guesses per cell (default 100, × 50 fights each) |
| `--minwin P` | bot: lowest estimated win % it accepts for a fight (default 90) |
| `--future F` | bot: points one survival is worth when choosing fights (default 1000; lower = greedier) |
| `--ablate x,y` | bot: play without systems: `gems`, `rings`, `skills`, `intel`, `repair` |
| `--immortal` | bot: enemies deal no damage and the bot fights an elite every day, so no run ends early; shows how fast a surviving careful player uses up the map ("Map supply" table) |
| `--carry value\|default` | bot (and the economy trips): what to take home from a field. `value` (default) = the most valuable items of bag + pile by the bot's own values, worthless items stay in the pile; `default` = the game's "Rarest first" default |
| `--set path=value` | what-if: override a `CONFIG` value in memory for this run (repeatable) |
| `--quick` | small sample sizes |

`--set` examples (the path walks object keys and array indices, `*` matches every key or index, the value
is parsed as JSON; a path that does not exist in `CONFIG` is rejected):

```sh
node tools/balance.mjs --section power --set enemies.growthPerDay.hpDamage=4
node tools/balance.mjs --section bot --set 'field.oreWeights.*.mythril=2'
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'
node tools/balance.mjs --section economy --set 'field.debrisAmount={"min":10,"max":30}'
node tools/balance.mjs --section bot --seeds 40 --ablate rings,skills
node tools/balance.mjs --section bot --seeds 40 --set field.regrowPctPerDay=5   # turn regrowth back on
```

Each section ends with a one-line `ECONOMY SUMMARY`, `POWER SUMMARY` or `BOT SUMMARY`; run the baseline and
the what-if with the same flags and compare those lines. The current results and how to read them are in
`docs/BALANCE.md` ("Balance targets and current results").

## Save data

The game saves automatically after every action in your browser's `localStorage` (key `smithsy-save-v2`;
best score in `smithsy-best-v1`). Saves stay on your device and are per browser and per site address.
**New game** (top bar, or after a game over) replaces the current run; the best score is kept. To wipe
everything, clear the site's data in your browser.

- **v1.0 saves** (key `smithsy-save-v1`) are converted the first time v1.1 loads: items lying on the
  ground move to their field's pile, each remaining debris cell gets a thickness of 40, and old maps get
  no boulders. The game says so in a message. The old key is left untouched.
- **A save that can't be loaded** is kept as a backup (key `smithsy-save-backup-<time>`, never deleted)
  and a new game starts, with a message, instead of a blank page.

For debugging, the browser console has `window.smithsy` (`ctx`, `Game`, `CONFIG`).

## More docs

- [`CHANGELOG.md`](CHANGELOG.md): what changed in each version and how to roll back.
- [`docs/SPEC.md`](docs/SPEC.md): what the game does and the design decisions behind it.
- [`docs/BALANCE.md`](docs/BALANCE.md): the tuning handbook and current balance results.
- [`HANDOFF.md`](HANDOFF.md): project status, known concerns and a session log.
