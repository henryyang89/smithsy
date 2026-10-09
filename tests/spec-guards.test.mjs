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

test('guard: a screen that puts a scroll box back after a re-render goes through restoreScrollLeft, and the tip popover ignores that scroll', () => {
  const main = read(join(ROOT, 'js', 'main.js'));
  assert.match(main, /isRestoredScroll\(/);
  assert.doesNotMatch(main, /addEventListener\('scroll', hide/, 'the popover must not close on a scroll the screen made');
  for (const f of filesUnder(join(ROOT, 'js', 'ui'))) {
    if (f.endsWith('dom.js')) continue;
    assert.doesNotMatch(read(f), /\.scrollLeft\s*=[^=]/, `${relative(ROOT, f)} sets scrollLeft directly`);
  }
});

// ------------------------------------------------------------ batch 3 guards ----
test('guard: enemy growth is never shown (R8): no "Rating growth" in endday.js, Help does not read growthPerDay or growth()', () => {
  const endday = read(join(ROOT, 'js', 'ui', 'endday.js'));
  assert.doesNotMatch(endday, /Rating growth/);
  assert.doesNotMatch(endday, /ratingMult/, 'the enemy card and roster no longer show the rating multiplier');
  const help = read(join(ROOT, 'js', 'ui', 'help.js'));
  assert.doesNotMatch(help, /growthPerDay/);
  assert.doesNotMatch(help, /\bgrowth\(/);
  assert.doesNotMatch(help, /Growth by day|Daily growth/);
  // no UI file prints the growth config either
  assert.deepEqual(hits(filesUnder(join(ROOT, 'js', 'ui')), /growthPerDay/), []);
});

test('guard: durability is shown through durText / shownDurability, never as a raw decimal', () => {
  // the screens that list gear take their durability text from present.js
  for (const f of ['endday.js', 'adventurer.js', 'workshop.js', 'repairui.js']) {
    const src = read(join(ROOT, 'js', 'ui', f));
    assert.doesNotMatch(src, /\$\{(f1|num)\((d|g\.durability|item\.durability|w\.left|w\.loss)[,)]/, `${f} prints a durability with decimals`);
  }
  assert.match(read(join(ROOT, 'js', 'ui', 'present.js')), /shownDurability/);
});

test('guard: the old estimate margin and the 1.2 gear search are gone (marginPts, one bestLoadout over every combination in resolveBattle)', () => {
  assert.deepEqual(hits([...JS_FILES, ...TOOL_FILES], /\bmarginPts\b/), []);
  const game = read(join(ROOT, 'js', 'core', 'game.js'));
  assert.doesNotMatch(game, /bestLoadout/);
  assert.match(game, /searchLoadout/);
  // the one place gearPower is defined
  assert.deepEqual(hits(JS_FILES, /(const|function) gearPower\b/).length, 1);
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

test('request pins (batch 3): R6 tiers rise, R40 and R41 Low = none, R21 S sits between D and C, A2 5 x 5 with at most +5', () => {
  const T = CONFIG.enemies.tiers;
  assert.ok(T.elite.hp > T.normal.hp || T.elite.damage > T.normal.damage || T.elite.defense > T.normal.defense, 'R6: elites are above normals');
  assert.ok(T.champion.hp > T.elite.hp || T.champion.damage > T.elite.damage || T.champion.defense > T.elite.defense, 'R6: champions are above elites');
  assert.equal(CONFIG.enemies.attributes.chilling.values.low, 0, 'R40: Low Chilling = no slowing at all');
  assert.equal(CONFIG.enemies.attributes.magical.values.low, 0, 'R41: Low Magical = no magic at all');
  assert.equal(CONFIG.sim.samples, 5, 'A2: 5 guesses ...');
  assert.equal(CONFIG.sim.evalFights, 5, 'A2: ... x 5 test fights');
  const sd = CONFIG.intel.tracks.simDepth;
  assert.equal(sd.gains[0], 1, 'A2: +1 per Battle simulation point');
  assert.equal(sd.max, 3, 'A2: up to +3');
  const fs = CONFIG.rings.types.foresight;
  assert.equal(fs.stack, false, 'A2: only the best Foresight ring counts');
  assert.equal(Math.max(...fs.values), 2, 'A2: Foresight adds at most +2');
  assert.equal(CONFIG.sim.samples + sd.max + Math.max(...fs.values), 10, 'A2: at most 10 x 10 in total');
  // R21 in the config's own terms: copper S (1.55) is between iron D (1.45) and iron C (1.595)
  const { materialMult: M, gradeMult: G } = CONFIG.gear;
  assert.ok(M.copper * G.S > M.iron * G.D && M.copper * G.S < M.iron * G.C);
});

// ------------------------------------------------------------ batch 4 guards ----
test('guard: the win estimate is automatic (R12): no Estimate all button, no startEstimateAll / cancelRun, no old plan run state', () => {
  const css = filesUnder(join(ROOT, 'css'), ['.css']);
  assert.deepEqual(hits(JS_FILES, /Estimate all/i), [], 'js/');
  assert.deepEqual(hits(JS_FILES, /\bstartEstimateAll\b|\bcancelRun\b|\bplan_est\b|\bplan_run\b|adv-est-btn|adv-est-fill|adv-estrun/), []);
  assert.deepEqual(hits(css, /adv-est-|adv-estrun/), [], 'css/');
  // the estimates come from one module: the screens ask for them, they never call estimateWinChance themselves
  assert.deepEqual(hits(filesUnder(join(ROOT, 'js', 'ui')).filter((f) => !f.endsWith('estimates.js')), /\bestimateWinChance(Sync)?\(/), []);
  assert.match(read(join(ROOT, 'js', 'ui', 'estimates.js')), /estimateWinChance\(/);
});

test('guard: the roster has no names row under Defense (R1): no namesRow, no rt-sect-names, Defense is a plain section row', () => {
  assert.deepEqual(hits([...JS_FILES, ...filesUnder(join(ROOT, 'css'), ['.css'])], /\bnamesRow\b|rt-sect-names|\brt-nm\b/), []);
  assert.match(read(join(ROOT, 'js', 'ui', 'endday.js')), /sectionRow\('Defense'/);
});

test('guard: pack mules and the intel gate live in the core: validatePlan uses packLimit, confirmPlan checks canSpendIntel, only a win records a defeat', () => {
  const game = read(join(ROOT, 'js', 'core', 'game.js'));
  assert.match(game, /packLimit\(state, g\.slot, cfg\)/);
  assert.doesNotMatch(game, /> 2\b/, 'no hard-coded limit of 2 per slot');
  assert.match(game, /if \(canSpendIntel\(state, cfg\)\) return \{ ok: false/);
  // recordDefeat is called once, inside the win branch of resolveBattle
  assert.equal(game.split('recordDefeat(').length - 1, 1);
  const win = game.slice(game.indexOf('if (result.win) {'), game.indexOf('const report = {'));
  assert.match(win, /recordDefeat\(/);
  // the pack limit is never read from the config anywhere else in the screens (they ask packLimit)
  assert.deepEqual(hits(['endday.js', 'adventurer.js'].map((f) => join(ROOT, 'js', 'ui', f)), /\.slice\(0, 2\)|n >= 2\b|\/2 packed/), []);
  assert.deepEqual(hits(TOOL_FILES, /\.slice\(0, 2\)\.map\(\(g\) => g\.id\)/), [], 'the bot packs packLimit items too');
});

test('guard: visibility goes through the multiplier helpers (R22, R23): no screen or core file compares a roll with the plain track value', () => {
  const src = [...JS_FILES].filter((f) => !f.endsWith('intel.js'));
  assert.deepEqual(hits(src, /sight\[[^\]]+\]\s*<\s*intelValue\(/), [], 'attributes use enemySightFor');
  assert.deepEqual(hits(src, /ringGradeRoll\s*<\s*intelValue\(/), [], 'ring grades use ringGradeSightFor');
  assert.match(read(join(ROOT, 'js', 'core', 'enemies.js')), /enemySightFor\(state, enemy\.tier, cfg\)/);
  assert.match(read(join(ROOT, 'js', 'core', 'enemies.js')), /ringGradeSightFor\(state, enemy\.ring\.grade, cfg\)/);
});

test('guard: no tier points on the roster rows added in batch 4 (U3): the Banner row and the confirm bar carry none', () => {
  const endday = read(join(ROOT, 'js', 'ui', 'endday.js'));
  const bannerRow = endday.slice(endday.indexOf("const banner = row('Banner'"), endday.indexOf('const hiddenRow'));
  assert.doesNotMatch(bannerRow, /pts|score/);
  const bar = endday.slice(endday.indexOf('function confirmBar('), endday.indexOf('function confirmClicked('));
  assert.doesNotMatch(bar, /pts|\.score/);
});

test('request pins (batch 4): R13 three banners, +1 pack slot per 4 wins against the most-beaten banner, at most +1 per gear type, R14 R45 intel', () => {
  assert.equal(Object.keys(CONFIG.groups.list).length, 3, 'R13: three groups');
  assert.deepEqual(Object.values(CONFIG.groups.list).map((g) => g.name), ['Red Banner', 'Black Banner', 'Gold Banner']);
  assert.equal(CONFIG.groups.defeatsPerReward, 4, 'R13: +1 gear slot per 4 enemies defeated of the group with the most defeats');
  assert.equal(CONFIG.groups.maxExtraPerType, 1, 'R13: at most +1 per gear type');
  assert.ok(CONFIG.intel.tracks.groupSight, 'R14: banner scouting is an intel track');
  const t = CONFIG.intel.tracks;
  assert.ok(t.enemySight.tierMult.elite < t.enemySight.tierMult.normal && t.enemySight.tierMult.champion < t.enemySight.tierMult.elite, 'R23: elites a little harder to scout, champions harder than elites');
  const gm = t.ringGradeSight.gradeMult;
  assert.ok(gm.D > gm.C && gm.C > gm.B && gm.B > gm.A && gm.A > gm.S, 'R22: the higher the ring grade, the harder to scout');
});

// ------------------------------------------------------------------ batch 5 ----
const UI_FILES = filesUnder(join(ROOT, 'js', 'ui'));
const uiSrc = (name) => read(join(ROOT, 'js', 'ui', name));

test('guard: no score and no tier points on screen during a run (R32, U3): only the run summary and Help talk about the score', () => {
  const main = read(join(ROOT, 'js', 'main.js'));
  assert.doesNotMatch(main, /Score \$\{|best \$\{|stats\.score\}/, 'the top bar has no running score');
  assert.deepEqual(hits(UI_FILES, /\} pts|\d pts| pts['"`)]/), [], 'no "+25 pts" anywhere');
  assert.deepEqual(hits(UI_FILES.filter((f) => !f.endsWith('present.js')), /tiers\[[^\]]+\]\.score|tierCfg\.score|t\.score\b/), [], 'tier points are only read for the run summary (present.js scoreBreakdown)');
  assert.doesNotMatch(uiSrc('ringsview.js'), /Score/);
  assert.doesNotMatch(uiSrc('help.js'), /\.score\b/, 'Help does not read the tier points');
  // the run summary is the one place that explains the formula
  assert.match(uiSrc('endday.js'), /How your score is worked out/);
  assert.match(uiSrc('present.js'), /export function scoreBreakdown/);
});

test('guard: the top bar has End run and New game (only when over), the work-day bar fills from dayProgress, the toast takes the action\'s tone, the best score is recorded once', () => {
  const main = read(join(ROOT, 'js', 'main.js'));
  assert.match(main, /'End run'/);
  assert.match(main, /Game\.endRun\(state\)/);
  assert.match(main, /End this run now\? Your adventurer retires and the run is scored, the same as a lost fight would score it\. You can't continue it afterwards\./);
  assert.match(main, /state\.phase !== 'over'/);
  assert.match(main, /dayProgress\(state, CONFIG\)/);
  assert.match(main, /clockStatus\(state, left, CONFIG\)/, 'a finished run shows "Run over", not the work clock');
  assert.match(main, /clock\.bar/, 'and no work-day bar');
  assert.match(main, /ui\.est_screen = null/, 'render() clears the estimating-screen mark, so a run that outlives its tab never redraws another one');
  assert.match(main, /\.\.\.tip\(clock\.label\)/, 'the clock hover also opens on a tap (tip(), not a bare title)');
  assert.match(main, /\.\.\.tip\(day\.label\)/, 'so does the work-day bar\'s');
  assert.match(main, /res\.tone \|\| \(res\.ok \? 'ok' : 'err'\)/);
  assert.match(main, /function recordBest\(\)/);
  assert.match(main, /state\.end\.prevBest != null/);
  assert.match(main, /label: 'Run summary'/);
  assert.match(main, /cancelAnalysis\(ctx\)/);
  assert.doesNotMatch(main, /renderGameOver|timeLabel|bestScore\(/);
});

test('guard: batch 5 deletions stay deleted (renderGameOver, storagePanel, distRefView, bonusBits, durabilityNode, the gem skill lines)', () => {
  assert.deepEqual(hits(UI_FILES, /renderGameOver|storagePanel|distRefView|durabilityNode|Grade skill lv|Cutting skill lv|Gem luck rings \(/), []);
  assert.deepEqual(hits(['workshop.js', 'endday.js', 'inventory.js', 'gearlist.js'].map((f) => join(ROOT, 'js', 'ui', f)), /bonusBits/), [], 'the workshop rows carry no bonus text');
  assert.deepEqual(hits([...UI_FILES, ...filesUnder(join(ROOT, 'css'), ['.css'])], /ws-gear\b|ws-dist-l\b|ws-dist-ref\b|ws-chip-packed/), [], 'the old workshop gear list and gem rows are gone');
});

test('guard: the Workshop has no drop-downs and no upgrade luck / fail / time bonus text (R17, R19)', () => {
  const ws = uiSrc('workshop.js') + uiSrc('inventory.js') + uiSrc('gearlist.js');
  assert.doesNotMatch(ws, /h\('select'|h\('option'|<select/);
  assert.doesNotMatch(ws, /upgrade luck|% time`|fail`/);
  assert.doesNotMatch(ws, /['"`][^'"`\n]*(novice|master)[^'"`\n]*['"`]/i, 'no novice / master wording in the text (the config key novice is the first-time cutter\'s table)');
});

test('guard: Help has no novice / master tables, no regrowth, no night and never reads the growth or the tier points', () => {
  const help = uiSrc('help.js');
  assert.doesNotMatch(help, /novice|blendCutTable|masterLv|Estimate all|growthPerDay|growth\(/i);
  assert.doesNotMatch(help, /night/i);
});

test('guard: the loss analysis is a screen-only feature: the game and the tools never run replays (bots never pay for it)', () => {
  assert.doesNotMatch(read(join(ROOT, 'js', 'core', 'game.js')), /replay/);
  assert.deepEqual(hits(TOOL_FILES, /core\/replay/), []);
  assert.deepEqual(hits(JS_FILES.filter((f) => !/replay\.js$|endday\.js$|present\.js$/.test(f)), /from '.*replay\.js'/), [], 'only the screen (and its DOM-free helpers) import it');
  // core/replay.js itself changes nothing in the state it is given
  const replay = read(join(ROOT, 'js', 'core', 'replay.js'));
  assert.doesNotMatch(replay, /state\.[a-zA-Z.]+\s*=[^=]|state\.[a-zA-Z.]+\.(push|splice)\(/, 'no writes to the game state');
});

test('guard: the report never lists home gear and has the two gear groups of R39', () => {
  const endday = uiSrc('endday.js');
  assert.doesNotMatch(endday, /Packed but not used|Gear the adventurer used/);
  assert.match(endday, /Gear used in the fight/);
  assert.match(endday, /Brought but not used \(no wear\)/);
  assert.doesNotMatch(endday, /ctx\.state\.gear\.find\(\(x\) => x\.id === id\)/, 'the report reads the snapshots, not the gear you own now');
});

test('request pins (batch 5): R15 the work-day bar fills with time used, R28 six combat-log columns, R30 Time each right of the outcome and left of the buttons', () => {
  const main = read(join(ROOT, 'js', 'main.js'));
  assert.match(main, /width: `\$\{Math\.round\(day\.frac \* 1000\) \/ 10\}%`/, 'R15: the fill is the fraction used');
  assert.doesNotMatch(main, /left \/ dayLen|frac = Math\.max\(0, Math\.min\(1, left/);
  const css = read(join(ROOT, 'css', 'ui-adventurer.css'));
  assert.equal((css.match(/\.clog col\.c-/g) || []).length >= 5, true, 'R28: a fixed column each for time, attacker, effects, you and foe');
  const ws = uiSrc('workshop.js');
  assert.match(ws, /\['Bar' \/ 'Gem'|isRefine \? 'Bar' : 'Gem', 'Needs \(you have\)', distHeader\(\), 'You can make', \{ v: 'Time each', cls: 'num' \}, ''\]/, 'R30: Bar | Needs | Outcome | You can make | Time each | buttons');
});

// ------------------------------------------------------------ docs guards (7c) ----
test('guard: README.md describes 2.0, not 1.2 (A3 repairs by day, R32 / U3 no score on screen, A2 automatic estimate, R9 whole numbers, R18 no novice / master tables)', async () => {
  const { VERSION } = await import('../js/version.js');
  const readme = read(join(ROOT, 'README.md'));
  assert.ok(readme.includes(`Current version: **${VERSION}**`), 'README names the current version');
  const banned = [
    [/Estimate all/i, 'the Estimate all button is gone (A2, R12)'],
    [/free of time/i, 'repairs are never free of time (A3)'],
    [/repairs? (at|by) night|at night \(battle report/i, 'no night repairs (A3)'],
    [/one decimal/i, 'durability shows whole numbers (R9)'],
    [/novice and master tables|novice table \(Fail/i, 'no novice / master tables for the player (R18)'],
    [/Each win scores points: normal 10/i, 'no score numbers (U3)'],
    [/your score, and the \*\*End day\*\*/i, 'the top bar shows no score (R32)'],
    [/a level-10 skill is as strong as a C-grade ring/i, 'no skill-at-level-10 text (R18)'],
    [/10 guesses of the hidden attributes x 10/i, 'the estimate is 5 x 5 (A2)'],
    [/5x5 world map|8x8|smithsy-save-v3/i, 'the 1.2 map and save key'],
  ];
  for (const [re, why] of banned) assert.doesNotMatch(readme, re, `README.md: ${why}`);
  // what 2.0 says instead
  assert.match(readme, /7x7 world map/);
  assert.match(readme, /Repairs happen by day, at camp, and cost time/);
  assert.match(readme, /There is no score on screen while you play/);
  assert.match(readme, /worked out by itself/);
  assert.match(readme, /--persona/);
  assert.match(readme, /day2/);
});

test('guard: CHANGELOG.md has a 2.0 section in player terms with the fresh-save rule, and the save table has a 2.0 row', async () => {
  const { VERSION } = await import('../js/version.js');
  const section = changelogSection(VERSION);
  assert.notEqual(section, null, `CHANGELOG.md has a "## ${VERSION}" section`);
  assert.match(section, /starts a fresh game/i, 'the fresh-save note (A1)');
  assert.match(section, /1\.x save/i);
  assert.match(section, /opens\s+again/i);
  assert.doesNotMatch(section, /free of time|one decimal|repairs? at night/i, 'the 2.0 section does not describe the 1.2 rules');
  assert.doesNotMatch(section, /Estimate all(?! button any more)/, 'the Estimate all button is only mentioned to say it is gone');
  const text = read(join(ROOT, 'CHANGELOG.md'));
  assert.match(text, new RegExp(`\\|\\s*${VERSION.replace('.', '\\.')}\\s*\\|[^\\n]*smithsy-save-${VERSION.replace('.', '\\.')}`), 'the save table has a row for this version with its own key');
});

test('guard: the docs name the same save key as the code, and BENCHMARKS.md has 2.0 rows for the three personas', async () => {
  const { SAVE_KEY } = await import('../js/core/game.js');
  for (const f of ['README.md', 'CHANGELOG.md', 'docs/SPEC.md']) assert.ok(read(join(ROOT, f)).includes(SAVE_KEY), `${f} names ${SAVE_KEY}`);
  const bench = read(join(ROOT, 'docs', 'BENCHMARKS.md'));
  for (const persona of ['Careful planner', 'Champion hunter', 'Casual']) {
    assert.match(bench, new RegExp(`\\|\\s*2\\.0\\s*\\|[^\\n]*${persona}[^\\n]*\\|\\s*\\d`), `BENCHMARKS.md has a 2.0 row for ${persona}`);
  }
  assert.match(bench, /\|\s*2\.0\s*\|\s*Careful planner\s*\|\s*200\s*\|/, 'and the 200-seed careful row of the deaths table');
});
