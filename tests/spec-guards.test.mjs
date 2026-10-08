// Source guards: things this version removed or renamed must stay gone. They read the source text, so they
// catch a leftover in a rarely used UI string or a tool just as well as in the game logic.
//
// Each batch of the 2.0 plan adds its own guards here (B1: regrowth, ore-sight reveal, the old intel and
// save names; B2: night repairs, the old skill model, the Skills tab's Maxed KPI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG } from '../js/config.js';
import { newGame } from '../js/core/game.js';
import { expectedSearches, sightValue } from '../js/core/map.js';
import { scrapReturn } from '../js/core/gear.js';
import { skillDefs } from '../js/core/skills.js';

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

// ------------------------------------------------------------ batch 2 guards ----
test('guard: no night repairs anywhere (A3): no isNight, no "free at night", no "no time tonight", no night banner', () => {
  assert.deepEqual(hits([...JS_FILES, ...TOOL_FILES], /\bisNight\b/), []);
  assert.deepEqual(hits(JS_FILES, /free at night/i), []);
  assert.deepEqual(hits(JS_FILES, /no time tonight/i), []);
  assert.deepEqual(hits(JS_FILES, /repairs? (at|by) night|repair tonight|repairs tonight|cost materials but no time/i), []);
  assert.deepEqual(hits(TOOL_FILES, /nightRepair\b|\bat night \(free\)/), []);
  // the night banner and the night-only helpers are gone from code and styles
  assert.deepEqual(hits([...JS_FILES, ...filesUnder(join(ROOT, 'css'), ['.css'])], /rp-night|reportRepair|repairAllButton|repairAllPreview/), []);
});

test('guard: the old skill model is gone (skillBonus, perLevel, Return travel, Maxed, level-10 vs ring text)', () => {
  const gone = ['skillBonus', 'returnTravel', 'returnPct', 'gearCareXpPerFight', 'skillVsRingText', 'skillRingText', 'skillRingMatch', 'commonSkillRingGrade', 'xpFrom', 'perLevel'];
  for (const name of gone) assert.deepEqual(hits([...JS_FILES, ...TOOL_FILES], new RegExp(`\\b${name}\\b`)), [], name);
  // the Skills tab has no Maxed KPI (R43)
  assert.doesNotMatch(read(join(ROOT, 'js', 'ui', 'skillsview.js')), /Maxed/);
  // the config lists each skill's effects, not a per-level number
  for (const d of Object.values(CONFIG.skills.activity)) assert.ok(d.effects && !('perLevel' in d), d.name);
  for (const d of Object.values(CONFIG.skills.perMaterial)) assert.ok(d.effects && !('perLevel' in d), d.label);
});

test('guard: tips work on touch screens: index.html has the #tip holder and main.js opens it on a non-mouse tap', () => {
  assert.match(read(join(ROOT, 'index.html')), /<div id="tip"/);
  const main = read(join(ROOT, 'js', 'main.js'));
  assert.match(main, /function installTips\(/);
  assert.match(main, /pointerup/);
  assert.match(main, /pointerType === 'mouse'/);
  assert.match(main, /\[data-tip\]/);
  assert.match(read(join(ROOT, 'css', 'style.css')), /#tip\b/);
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

test('request pins (batch 2): travel 0.6% / 15 XP, carrying 5% / 2 XP, smithing 2%, repair 3% / 1% / 0.5%, general skills 5x and 10x weaker, scrap 35%', () => {
  const A = CONFIG.skills.activity;
  const P = CONFIG.skills.perMaterial;
  assert.equal(A.travel.effects.travelTime, 0.6, 'R4: 0.6% less time on every trip per level');
  assert.equal(A.travel.xp, 15, 'R4: 15 XP per map step walked');
  assert.equal(A.carrying.effects.loadPenalty, 5, 'R5: 5% of the per-item load penalty per level');
  assert.equal(A.carrying.xp, 2, 'R5: 2 XP per item carried one map step');
  assert.equal(P.smith.effects.smithTime, 2, 'R34: 2% less smithing time per level');
  assert.equal(P.repair.effects.repairTime, 3, 'R35: 3% less repair time per Repair level');
  assert.equal(A.repairTime.effects.repairTime, 1, 'R35: 1% per General repair level');
  assert.equal(P.smith.effects.repairTime, 0.5, 'R35: 0.5% per Smithing level');
  assert.equal(P.oreFail.effects.refineFail / A.refineTime.effects.refineFail, 5, 'R36: the own-material refining skill is 5x General refining');
  assert.equal(P.gemGrade.effects.cutBlend / A.cutTime.effects.cutBlend, 10, 'R36: the own-material gem grade skill is 10x General cutting');
  assert.equal(A.refineTime.effects.refineFail, 0.1, 'R36: General refining +0.1 failure points per level');
  assert.equal(A.cutTime.effects.cutBlend, 1, 'R36: General cutting +1% blend per level');
  assert.equal(CONFIG.gear.repair.materialFraction, 35, 'A4: scrap and repairs use 35% of the bars');
  // A4 / R10 in play: a 60% copper sword (2 bars) scraps for 0.42 bars, a 59.6% one for 0.41, a 0% one for nothing
  const sword = (durability) => ({ slot: 'sword', material: 'copper', grade: 'D', gem: null, durability });
  assert.equal(scrapReturn(sword(60)).qty, 0.42);
  assert.equal(scrapReturn(sword(59.6)).qty, 0.41);
  assert.equal(scrapReturn(sword(0)).qty, 0);
  assert.equal(skillDefs().length, 35);
});
