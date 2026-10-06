# Smithsy — Handoff

Everything needed to pick this project up in a fresh session.

## What it is
Browser game: you mine ore/gems on a 5x5 world map of 8x8 fields, refine and smith gear, and each
night plan your adventurer's next fight (1 enemy from a roster of 7). A loss is game over; score is
endless. Plain HTML + ES modules, no build step, hosted on GitHub Pages. Save in localStorage.

## Where things are
| Path | What |
|---|---|
| `js/config.js` | **Every tunable number.** Edit here to rebalance. |
| `docs/BALANCE.md` | Explains every number, formula, worked examples, tuning notes. |
| `docs/SPEC.md` | Requirements + all design decisions agreed with the user. |
| `js/core/` | DOM-free game logic (works in Node). `game.js` = state, day flow, battle resolution, save. |
| `js/core/map.js` | World map, fields, travel, search (depth mechanic), debris, bag. |
| `js/core/processing.js` | Refining/cutting, grade distributions (fail reduction + upgrade luck). |
| `js/core/gear.js` | Gear stats, crafting, repair. |
| `js/core/combat.js` | Combatant stats, hit chance S-curve, event-driven fight sim with log. |
| `js/core/sim.js` | Best-gear selection and win-chance estimate (samples hidden enemy attributes). |
| `js/core/enemies.js` | Roster generation, attribute levels, visibility, enemy stats. |
| `js/core/rings.js`, `skills.js`, `intel.js`, `bonuses.js` | Rings (stacking), skills (XP), intel points, combined smith bonuses. |
| `js/main.js` | UI shell (top bar, tabs, side log, phase screens, save). |
| `js/ui/*.js` | One module per screen; `dom.js` = tiny `h()` helper. |
| `tests/` | `node --test tests/` |
| `tools/balance.mjs` | Balance report: economy, power curve, bot playthrough. |

## Design decisions (from Q&A with the user)
- One enemy per day from a new daily roster (2 normal, 3 elite, 2 champion). No skipping.
- Loss = game over. No fight time limit (internal safety cap only; counts as draw).
- Day 1: adventurer rests. The plan for day N+1 (enemy, up to 2 gear per slot, rings) is made at the
  end of day N. The adventurer is away all of day N+1 with the packed gear (can't repair it that day).
- When the fight starts the adventurer sees the real attributes and uses the best packed item per slot.
- Optional win-chance simulation (player clicks); samples hidden attributes respecting tier counts.
- Ring only as fight reward. Simple 20-slot bag (1 item per slot). Unlimited camp storage.
- Persistent 5x5 map, camp in center, 4 blocked cells; travel by path distance; farther = richer.
- Elite attribute split fixed to 3 low / 6 normal / 3 high (user's 3/9/3 summed to 15).
- Interpretations made without asking (flag to user if they disagree):
  - Search depth model: each item has a hidden depth 0–100; a cell's "% searched" rises by the
    efficiency each search; items are found when % searched passes their depth.
  - Ore sight = chance per searched cell to reveal what's left in it (intel + smith ring).
  - "Refining time" smith ring applies to refining and cutting.
  - Sapphire armor "debuff reduction" = slow strength + slow duration reduction.
  - Topaz/Sapphire armor: two stats with the same table values.
  - Upgrade luck: after a successful roll, X% chance to go up one grade (S stays S).
  - Skill "fail reduction" moves failure % into D.
  - Duplicate rings beyond the 3rd keep halving (12.5%, ...).
  - Enemy accuracy/dodge also grow 2%/day (otherwise late-game hit chances saturate).
  - Debris cells are 20 points more likely to hold items.
  - Smithing has no skill; repairs take 50% of craft time x fraction repaired.

## Known concerns / ideas
- Fields never regrow; very long runs could exhaust the map (24 fields x ~45 items).
- Balance is first-pass; see `node tools/balance.mjs` output and BALANCE.md quick levers.
- Win-chance sim cost grows with packed gear combos (max 32) x samples; tuned in `CONFIG.sim`.

## Session log
- Session 1: built engine, UI, docs, tests, balance tool. (Update this section each session.)
