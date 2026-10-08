// Source guards: things this version removed or renamed must stay gone. They read the source text, so they
// catch a leftover in a rarely used UI string or a tool just as well as in the game logic.
//
// Each batch of the 2.0 plan adds its own guards here (B1: regrowth, ore-sight reveal, the old intel and
// save names).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import { newGame } from '../js/core/game.js';
import { expectedSearches, sightValue } from '../js/core/map.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));

function filesUnder(dir, ext = ['.js', '.mjs']) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...filesUnder(p, ext));
    else if (ext.some((e) => name.endsWith(e))) out.push(p);
  }
  return out;
}

const read = (p) => readFileSync(p, 'utf8');
const JS_FILES = filesUnder(join(ROOT, 'js'));
const TOOL_FILES = filesUnder(join(ROOT, 'tools'));

// [{ file, line, text }] for every line of `files` matching `re`.
function hits(files, re) {
  const out = [];
  for (const f of files) {
    read(f).split('\n').forEach((text, i) => {
      if (re.test(text)) out.push(`${relative(ROOT, f)}:${i + 1}: ${text.trim()}`);
    });
  }
  return out;
}

// The text of CHANGELOG.md's 2.0 section ("## 2.0 ..." up to the next "## " heading), or null before it exists.
function changelogSection(version) {
  const lines = read(join(ROOT, 'CHANGELOG.md')).split('\n');
  const start = lines.findIndex((l) => new RegExp(`^##\\s+(v|version\\s+)?${version.replace('.', '\\.')}\\b`, 'i').test(l));
  if (start < 0) return null;
  let end = lines.findIndex((l, i) => i > start && /^##\s/.test(l));
  if (end < 0) end = lines.length;
  return lines.slice(start, end).join('\n');
}

test('guard: the game has no regrowth anywhere (R25): js, tools, README, and the 2.0 changelog section', () => {
  assert.deepEqual(hits(JS_FILES, /regrow/i), [], 'js/');
  assert.deepEqual(hits(TOOL_FILES, /regrow/i), [], 'tools/');
  assert.deepEqual(hits([join(ROOT, 'README.md')], /regrow/i), [], 'README.md');
  // the 2.0 section is written in the last batch; once it exists it must not mention regrowth either
  const section = changelogSection('2.0');
  if (section !== null) assert.doesNotMatch(section, /regrow/i, 'CHANGELOG.md 2.0 section');
});

test('guard: no ore-sight "reveal" mechanism: no revealed flag on cells and no revealPct in js/ (sight replaced it, R31)', () => {
  assert.deepEqual(hits(JS_FILES, /revealPct/), []);
  // the cell property (cell.revealed, `revealed:` / `revealed =`), not the word in a sentence
  assert.deepEqual(hits(JS_FILES, /\.revealed\b|\brevealed\s*[:=]/), []);
  assert.deepEqual(hits(JS_FILES, /mv-revealed/), [], 'the revealed-cell style is gone too');
  assert.deepEqual(hits(filesUnder(join(ROOT, 'css'), ['.css']), /mv-revealed/), []);
});

test('guard: the renamed and removed names are gone from js/ and tools/', () => {
  const gone = ['intelChance', 'intelChanceFor', 'migrateV1', 'migrateV2', 'addMissingKeys', 'SAVE_VERSION', 'LEGACY_SAVE_KEYS', 'regrowFields',
    'gainsPerPoint', 'minGain', 'maxChance', 'oreWeights', 'oreShare', 'lootChance', 'regrowPctPerDay'];
  for (const name of gone) {
    assert.deepEqual(hits([...JS_FILES, ...TOOL_FILES], new RegExp(`\\b${name}\\b`)), [], name);
  }
  // the old field.boulders setting (a number) is now a per-distance row value
  assert.deepEqual(hits([...JS_FILES, ...TOOL_FILES], /field\.boulders\b/), []);
});

test('guard: the config has no leftovers of the removed settings', async () => {
  const { CONFIG } = await import('../js/config.js');
  for (const k of ['boulders', 'regrowPctPerDay', 'lootChance', 'oreShare', 'oreWeights']) assert.equal(k in CONFIG.field, false, `field.${k}`);
  assert.equal(Array.isArray(CONFIG.field.gemWeights), false, 'gemWeights is one object now, not a list of rows');
  for (const k of ['gainsPerPoint', 'minGain', 'maxChance']) assert.equal(k in CONFIG.intel, false, `intel.${k}`);
});

test('guard: saves are per version: the game never reads another version\'s save key', () => {
  const main = read(join(ROOT, 'js', 'main.js'));
  const game = read(join(ROOT, 'js', 'core', 'game.js'));
  // main.js reads only SAVE_KEY; old keys are only listed (oldSaveKeys) to word a note, never read
  const reads = main.match(/localStorage\.getItem\([^)]*\)/g) || [];
  for (const r of reads) assert.match(r, /Game\.SAVE_KEY|Game\.BEST_KEY/, `main.js reads ${r}`);
  assert.doesNotMatch(main, /LEGACY|migrate/);
  assert.doesNotMatch(game, /LEGACY|migrate/);
  // and it never writes to or deletes another version's key
  assert.doesNotMatch(main, /removeItem/);
});

// ---------------------------------------------------------------- request pins ----
// The numbers the user asked for in their own words (R2 7x7 world map and 9x9 fields, R3 boulders 2 to 4, R14 20% base
// banner chance, R29 gem share 15% to 25%, R31 no sight on day 1, R37 about 4 searches per cell). This is the one place
// that reads them straight from CONFIG: retuning one of them is a decision to take with the user, so it should fail
// here, loudly and alone. Every behaviour test derives its numbers from CONFIG or pins its own with cfgWith.
test('request pins: the numbers the user asked for are what CONFIG says (R2, R3, R14, R29, R31, R37)', () => {
  assert.equal(CONFIG.map.size, 7, 'R2: a 7x7 world map');
  assert.equal(CONFIG.field.size, 9, 'R2: each field is 9x9');
  const rows = CONFIG.field.byDistance;
  assert.equal(Math.min(...rows.map((r) => r.boulders)), 2, 'R3: boulders start at 2 ...');
  assert.equal(Math.max(...rows.map((r) => r.boulders)), 4, '... and reach 4');
  assert.equal(rows[0].gemShare, 15, 'R29: gem share 15% near ...');
  assert.equal(rows[rows.length - 1].gemShare, 25, '... 25% far away');
  assert.equal(CONFIG.intel.tracks.groupSight.base, 20, 'R14: 20% base chance of knowing an enemy\'s banner');
  assert.equal(CONFIG.intel.tracks.oreSight.base, 0, 'R31: sight starts at 0');
  assert.equal(sightValue(newGame(1)), 0, 'R31: a new game has no sight, so nothing is seen on day 1');
  const e = expectedSearches(newGame(1), CONFIG);
  assert.ok(e > 3.9 && e < 4.1, `R37: about 4 searches finish a cell (${e})`);
});
