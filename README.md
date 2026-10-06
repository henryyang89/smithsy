# Smithsy

Smithsy is a browser game about numbers and luck. You are a miner and blacksmith: you dig ore and gems
out of the fields around your camp, refine them into bars, and smith gear for your adventurer, who fights
one enemy every day with what you made. Pick fights wisely: one lost fight ends the run, and enemies get
stronger every day.

It is a static site (plain HTML + ES modules, no build step, no dependencies) and saves in your browser.

## Play locally

ES modules do not load from `file://`, so serve the folder with any static web server:

```sh
cd smithsy
python3 -m http.server 8000
```

Then open <http://localhost:8000>. Other servers work too (for example `npx serve .`).

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. In the repository go to **Settings → Pages → Build and deployment**.
3. Set **Source: Deploy from a branch**, pick the branch (e.g. `main`) and the folder **/ (root)**, then Save.
4. After a minute the game is live at `https://<user>.github.io/<repo>/`.

The empty `.nojekyll` file tells GitHub Pages to serve the files as they are (no Jekyll processing).
All paths are relative, so the game works from a sub-path like `/<repo>/`.

## How to play

**The day.** Each day runs from 8:00 to 18:00 (600 minutes). Only actions cost time: travelling,
searching, clearing debris, refining, cutting, smithing and repairing. The top bar shows the day, the
clock, where you are, your bag, your score, and the **End day** button (only at camp).

**Day loop**

1. **Map tab: gather.** The 5x5 world map has your camp in the center and 20 fields around it (some map
   cells are blocked). Farther fields are richer but take longer to reach. Click a field to travel there.
   Inside a field (8x8 cells), click a cell and press **Search area** to search the 3x3 area around it.
   Each search digs a bit deeper into every cell (shown as "% searched"); hidden ores and gems are found
   once the search passes their depth. Clear debris first where it covers cells. Your bag holds 20 items;
   extra finds stay on the ground for later. You may only start field work if you can still walk home by
   18:00. Walking back to camp unloads the bag into storage.
2. **Workshop tab: refine, cut and smith.** At camp, refine ore into bars (copper, iron, steel = iron +
   coal, mythril) and cut gems. Each attempt rolls a grade (S, A, B, C, D) or fails; the odds are shown
   before you click. Smith gear from bars of the same material and grade (sword 2, chest 3, helmet 2,
   gloves 2, boots 2), optionally infusing a cut gem for a bonus. Repair worn gear here too.
3. **Adventurer tab.** See today's fight, your gear and **tomorrow's roster** of 7 enemies (2 normal,
   3 elite, 2 champion). Some enemy attributes are hidden until you scout them with intel.
4. **End day** (at camp). If the adventurer fought today you get the battle report: full combat log, gear
   wear and the ring reward. A loss is game over.
5. **Plan tomorrow.** Pick one enemy, pack up to 2 items per gear slot (the adventurer uses the best one
   for each slot once the real enemy is known), choose up to 10 adventurer rings, and optionally run the
   win-chance simulation. Confirm to start the next day. Packed gear is away all day and cannot be repaired.

**Other tabs.** **Rings**: wear up to 10 smith rings (they speed up and improve your own work).
**Skills & Intel**: skills level up automatically as you work; an intel point arrives every 5 days and
improves scouting or ore sight. **Log**: everything that happened. **Help**: rules plus a live reference of
every number in the game.

**Score.** Each win scores points: normal 10, elite 25, champion 50. The run is endless; your best score is
remembered.

## Project structure

```
index.html            page shell; loads css/ and js/main.js
css/style.css         shared styles; css/ui-*.css per screen
js/config.js          EVERY tunable number (the place to rebalance)
js/main.js            UI shell: top bar, tabs, side log, phase screens, save/load
js/core/              game logic, no DOM (runs in the browser and in Node)
  game.js             state, day flow, battle resolution, save format
  map.js              world map, fields, travel, search, debris, bag
  processing.js       refining and cutting, grade odds
  gear.js             gear stats, smithing, repair
  combat.js           combat stats, hit chance, fight simulation with log
  sim.js              best-gear choice and win-chance estimate
  enemies.js          rosters, attributes, enemy stats
  rings.js skills.js intel.js bonuses.js rng.js util.js
js/ui/                one module per screen (mapview, workshop, adventurer, ringsview,
                      skillsview, logview, help, endday) + dom.js helpers
tests/                unit tests for the core (node:test)
tools/balance.mjs     balance report (economy, power curve, bot playthrough)
docs/SPEC.md          requirements and design decisions
docs/BALANCE.md       every number explained: formulas, examples, tuning notes
HANDOFF.md            notes for picking the project up in a new session
package.json          script shortcuts only (npm test, npm run balance); no dependencies
```

## Tweaking numbers

All game numbers are in **`js/config.js`**. Edit a value, reload the page, and the game, the Help tab and
the tools all use the new number. **`docs/BALANCE.md`** explains every number: its config path, the exact
formula, a worked example, and what raising or lowering it does. Start with its "Quick levers" table.

Note: an existing save keeps its already generated map and rosters; start a **New game** to see changes
that affect generation (field loot, map layout, enemy rosters).

## Tests

Requires Node.js 18 or newer. From the repository root:

```sh
npm test                       # runs: node --test tests/*.test.mjs
node --test tests/*.test.mjs   # same, without npm
node --test                    # also finds tests/*.test.mjs automatically
```

(`node --test tests/` works on Node 18/20 but not on Node 22+, which treats the folder as a file.)
There are no dependencies to install; `package.json` only holds these script shortcuts.

## Balance tool

`tools/balance.mjs` runs the real core engine in Node and prints a balance report with three sections:

- **Economy**: how much ore, gems, bars and gear a typical day produces.
- **Power curve**: win chances of different gear against each enemy tier as the days go by.
- **Bot playthrough**: simple automated players run whole games; shows how long runs last and why they end.

```sh
node tools/balance.mjs                     # full report (or: npm run balance)
node tools/balance.mjs --section economy   # one section only
node tools/balance.mjs --seeds 20 --days 40
```

`--section` picks one section, `--seeds` sets how many random games to average over, `--days` sets how many
days to simulate. See the comment at the top of the file for the exact options and defaults.

## Save data

The game saves automatically after every action in your browser's `localStorage` (key `smithsy-save-v1`;
best score in `smithsy-best-v1`). Saves stay on your device and are per browser and per site address.
**New game** (top bar, or after a game over) replaces the current run; the best score is kept. To wipe
everything, clear the site's data in your browser. Saves from an incompatible version are ignored and a new
game starts.

For debugging, the browser console has `window.smithsy` (`ctx`, `Game`, `CONFIG`).

## More docs

- [`docs/SPEC.md`](docs/SPEC.md): what the game does and the design decisions behind it.
- [`docs/BALANCE.md`](docs/BALANCE.md): the tuning handbook.
- [`HANDOFF.md`](HANDOFF.md): project status, known concerns and a session log.
