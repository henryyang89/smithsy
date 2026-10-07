# Smithsy

Smithsy is a browser game about numbers and luck. You are a miner and blacksmith: you dig ore and gems
out of the fields around your camp, refine them into bars, and smith gear for your adventurer, who fights
one enemy every day with what you made. Pick fights wisely: one lost fight ends the run, and enemies get
stronger every day.

It is a static site (plain HTML + ES modules, no build step, no dependencies) and saves in your browser.

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
build.

1. Push the branch to GitHub (the game lives on `claude/miner-blacksmith-game-tzd15o`; merge it into
   `main` when you are happy with it).
2. In the repository open **Settings → Pages**.
3. Under **Build and deployment** set **Source: Deploy from a branch**.
4. Pick the branch: `claude/miner-blacksmith-game-tzd15o`, or `main` after merging. Pick the folder
   **/ (root)**. Click **Save**.
5. After a minute or two the game is live at <https://henryyang89.github.io/smithsy/>. Later pushes to that
   branch redeploy automatically.

The empty `.nojekyll` file in the root tells GitHub Pages to skip Jekyll processing and serve every file
as is. All paths in the game are relative, so it works from the `/smithsy/` sub-path.

## How to play

**The day.** Each day runs from 8:00 to 18:00 (600 minutes). Only actions cost time: travelling,
searching, clearing debris, refining, cutting, smithing and repairing. The top bar shows the day, the
clock, where you are, your bag, your score, and the **End day** button. The day does **not** end by itself
at 18:00: walk back to camp and press **End day** (it only works at camp).

**Day loop**

1. **Map tab: gather.** The 5x5 world map has your camp in the center and 20 fields around it (4 map
   cells are blocked). Farther fields are richer (more items, more coal and gems; mythril only in the
   farthest fields) but take longer to reach. Click a field to travel there. Inside a field (8x8 cells),
   click a cell and press **Search area** to search the 3x3 area around it. Each search digs halfway into
   every cell (shown as "% searched"), so two searches finish a cell; hidden ores and gems are found once
   the search passes their depth. Clear debris first where it covers cells. Your bag holds 20 items; extra
   finds stay on the ground for later. Field work can only start if you can still walk home by 18:00.
   Walking back to camp unloads the bag into storage. Each night a few searched cells regrow (5% of them)
   with fresh, hidden contents.
2. **Workshop tab: refine, cut and smith.** At camp, refine ore into bars (copper, iron, steel = iron +
   coal, mythril) and cut gems. Each attempt rolls a grade (S, A, B, C, D) or fails (10%); the odds are
   shown before you click. Smith gear from bars of the same material and grade (sword 2, chest 3, helmet 2,
   gloves 2, boots 2), optionally infusing a cut gem for a bonus. Repair worn gear here too (only gear
   that is at home, not the gear the adventurer took today).
3. **Adventurer tab.** See today's fight, your gear and **tomorrow's roster** of 7 enemies (2 normal,
   3 elite, 2 champion). Most enemy attributes are hidden until you scout them with intel.
4. **End day** (at camp). If the adventurer fought today you get the battle report: full combat log, gear
   wear and the ring reward. A loss is game over.
5. **Plan tomorrow.** Pick one enemy, pack up to 2 items per gear slot (the adventurer uses the best one
   for each slot once the real enemy is known), choose up to 10 adventurer rings, check the **Matchup**
   table (hit chances, damage per hit, attack speed, damage per second, HP and a rough time to win or lose;
   hidden attributes show as ranges), and optionally run the win-chance simulation. Confirm to start the
   next day. Packed gear is away all day and cannot be repaired; only the items actually used lose
   durability.

While the battle report, the plan screen or the game-over screen is open, the **Rings**, **Skills & Intel**,
**Log** and **Help** tabs stay available so you can check numbers before deciding.

**Other tabs.** **Rings**: wear up to 10 smith rings (they speed up and improve your own work and apply at
once). Adventurer rings marked as worn there are only the default selection for tonight's plan; the plan
screen decides what the adventurer actually wears, and changes never affect today's fight.
**Skills & Intel**: skills level up automatically as you work; an intel point arrives every 5 days and
improves enemy scouting, ring scouting or ore sight. **Log**: everything that happened. **Help**: rules plus
a live reference of every number in the game.

**Score.** Each win scores points: normal 10, elite 25, champion 50. A draw (only possible at an internal
safety time cap) scores nothing but the run goes on. The run is endless; your best score is remembered.

## Project structure

```
index.html            page shell; loads css/ and js/main.js
.nojekyll             tells GitHub Pages to serve files as they are
css/style.css         shared styles; css/ui-*.css per screen
js/config.js          EVERY tunable number (the place to rebalance)
js/main.js            UI shell: top bar, tabs, side log, phase screens, save/load
js/core/              game logic, no DOM (runs in the browser and in Node)
  game.js             state, day flow, battle resolution, save format
  map.js              world map, fields, travel, search, debris, regrowth, bag
  processing.js       refining and cutting, grade odds
  gear.js             gear stats, smithing, repair
  combat.js           combat stats, hit chance, attack-bar fight simulation with log
  sim.js              best-gear choice and win-chance estimate
  enemies.js          rosters, attributes, enemy stats
  rings.js skills.js intel.js bonuses.js rng.js util.js
js/ui/                one module per screen (mapview, workshop, adventurer, ringsview,
                      skillsview, logview, help, endday) + dom.js helpers
tests/                unit tests for the core (node:test)
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
that affect generation (field loot, map layout, enemy rosters).

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

- **economy**: what a field holds, items per search, minutes per item, refining odds, and the time needed
  to mine, refine and smith a full set of each material (about 10 s).
- **power**: win chances of different gear against each enemy tier from day 2 to day 80, the weakest set
  that stays safe on each day, and how much each gem, ring and gear slot is worth (about 5 s).
- **bot**: a scripted careful player runs whole games through the real game API; shows survival, score,
  material progression, the daily time split, rings, skills and intel (about 80 s for 24 runs).

```sh
node tools/balance.mjs                                  # all sections (or: npm run balance)
node tools/balance.mjs --section power                  # one section: economy | power | bot | all
node tools/balance.mjs --section bot --seeds 24         # 24 bot runs (default 20)
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
| `--set path=value` | what-if: override a `CONFIG` value in memory for this run (repeatable) |
| `--quick` | small sample sizes |

`--set` examples (the path walks object keys and array indices, `*` matches every key or index, the value
is parsed as JSON; a path that does not exist in `CONFIG` is rejected):

```sh
node tools/balance.mjs --section power --set enemies.growthPerDay.hpDamage=4
node tools/balance.mjs --section bot --set 'field.oreWeights.*.mythril=2'
node tools/balance.mjs --section bot --set 'gear.durabilityLoss={"min":2,"max":4}'
node tools/balance.mjs --section bot --seeds 24 --ablate rings,skills
```

Each section ends with a one-line `ECONOMY SUMMARY`, `POWER SUMMARY` or `BOT SUMMARY`; run the baseline and
the what-if with the same flags and compare those lines. The current results and how to read them are in
`docs/BALANCE.md` ("Balance targets and current results").

## Save data

The game saves automatically after every action in your browser's `localStorage` (key `smithsy-save-v1`;
best score in `smithsy-best-v1`). Saves stay on your device and are per browser and per site address.
**New game** (top bar, or after a game over) replaces the current run; the best score is kept. To wipe
everything, clear the site's data in your browser. Saves from an incompatible version are ignored and a new
game starts.

For debugging, the browser console has `window.smithsy` (`ctx`, `Game`, `CONFIG`).

## More docs

- [`docs/SPEC.md`](docs/SPEC.md): what the game does and the design decisions behind it.
- [`docs/BALANCE.md`](docs/BALANCE.md): the tuning handbook and current balance results.
- [`HANDOFF.md`](HANDOFF.md): project status, known concerns and a session log.
