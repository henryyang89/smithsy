// v1.2: durability loss per fight (a roll x the enemy tier's multiplier x the Gear care skill, kept to one
// decimal so every Gear care level counts) and the Gear care skill (XP from fights the adventurer survives),
// incl. saves from v1.1 that lack the skill.
//
// Tunable numbers are never hardcoded: expectations are derived from CONFIG, or the numbers a
// hand-computed expectation depends on are pinned with cfgWith.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { endDay, confirmPlan, acknowledgeReport, serialize, deserialize, addMissingKeys, SAVE_VERSION } from '../js/core/game.js';
import { wearLoss, wornDurability, repairInfo, repairPlan, repair } from '../js/core/gear.js';
import { skillDefs, xpToNext } from '../js/core/skills.js';
import { smithBonuses } from '../js/core/bonuses.js';
import { game, cfgWith, fullSet, addGear, setSkillLevel, totalXp, WEAK_ENEMIES, DEADLY_ENEMIES } from './helpers.mjs';

const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);
const DRAW = cfgWith({ combat: { safetyCapSeconds: 0.01 } }); // a cap shorter than any first attack: nobody swings

const DL = CONFIG.gear.durabilityLoss;
const tierMultOf = (tier, dl = DL) => (dl.tierMult && dl.tierMult[tier]) || 1;
const careOf = (level, cfg = CONFIG) => Math.min(100, cfg.skills.activity.gearCare.perLevel * level);
// the rule from the config comment, written out on its own: one decimal, at least 1
const lossOf = (base, mult, red) => Math.max(1, Math.round(base * mult * (1 - red / 100) * 10) / 10);
const oneDecimal = (v) => Math.round(v * 10) / 10;
const tierIndex = (s, tier) => s.roster.enemies.findIndex((e) => e.tier === tier);
const plan = (enemyIndex, gearIds = [], ringIds = []) => ({ enemyIndex, gearIds, ringIds });

// Day 1 -> plan -> day 2 with a full mythril S set packed against an enemy of `tier`.
// Returns { s, set }; the fight happens on the next endDay.
function toFightDay({ seed = 1, tier = 'normal', cfg = WIN, care = 0, gear = true } = {}) {
  const s = game(seed, cfg);
  const set = gear ? fullSet(s, 'mythril', 'S') : [];
  if (care) setSkillLevel(s, 'gearCare', care);
  assert.equal(endDay(s, cfg).ok, true);
  const r = confirmPlan(s, plan(tierIndex(s, tier), set.map((g) => g.id)), cfg);
  assert.equal(r.ok, true, r.msg);
  return { s, set };
}

function fightOnce(opts) {
  const { s, set } = toFightDay(opts);
  const rep = endDay(s, opts.cfg || WIN).report;
  return { s, set, rep };
}

// --------------------------------------------------------------- wear ----
test('config: durability loss is a min..max roll with a multiplier per enemy tier (harder tiers wear gear more)', () => {
  assert.ok(Number.isInteger(DL.min) && Number.isInteger(DL.max) && DL.min >= 1 && DL.max >= DL.min);
  for (const tier of Object.keys(CONFIG.enemies.tiers)) assert.ok(DL.tierMult[tier] > 0, `tierMult.${tier}`);
  assert.ok(DL.tierMult.normal <= DL.tierMult.elite && DL.tierMult.elite <= DL.tierMult.champion);
});

test('wear: each used item loses roll x tier multiplier x (1 - Gear care %) to one decimal, at least 1 (every tier x Gear care level)', () => {
  const bases = new Set();
  for (const tier of Object.keys(CONFIG.enemies.tiers)) {
    for (const level of [0, 1, 5, CONFIG.skills.maxLevel]) {
      const red = careOf(level);
      const lo = lossOf(DL.min, tierMultOf(tier), red);
      const hi = lossOf(DL.max, tierMultOf(tier), red);
      for (let seed = 1; seed <= 6; seed++) {
        const where = `${tier} care ${level} seed ${seed}`;
        const { s, set, rep } = fightOnce({ seed, tier, cfg: WIN, care: level });
        assert.equal(rep.win, true, where);
        assert.equal(rep.wear.length, set.length, `${where}: every item of the full set is used`);
        for (const w of rep.wear) {
          assert.ok(Number.isInteger(w.base) && w.base >= DL.min && w.base <= DL.max, `${where}: roll ${w.base}`);
          assert.equal(w.tierMult, tierMultOf(tier), where);
          assert.equal(w.skillRed, red, where);
          assert.equal(w.loss, lossOf(w.base, w.tierMult, w.skillRed), `${where}: loss`);
          assert.ok(w.loss >= lo && w.loss <= hi && w.loss >= 1, `${where}: loss ${w.loss} outside ${lo}..${hi}`);
          assert.equal(oneDecimal(w.loss), w.loss, `${where}: loss ${w.loss} has at most one decimal`);
          assert.equal(w.left, oneDecimal(100 - w.loss), where);
          assert.equal(s.gear.find((g) => g.id === w.id).durability, w.left, `${where}: the item itself`);
          bases.add(w.base);
        }
      }
    }
  }
  // the roll really spans the configured range
  assert.ok(bases.has(DL.min) && bases.has(DL.max), `rolls seen: ${[...bases].sort((a, b) => a - b)}`);
});

test('wear: exact numbers with a pinned config (roll fixed, tier multipliers 1 / 1.5 / 2, Gear care 2% per level)', () => {
  const cfg = cfgWith(WEAK_ENEMIES, {
    gear: { durabilityLoss: { min: 10, max: 10, tierMult: { normal: 1, elite: 1.5, champion: 2 } } },
    skills: { activity: { gearCare: { perLevel: 2 } } },
  });
  // [tier, Gear care level, loss]; level 10 = 20% less
  const table = [
    ['normal', 0, 10], ['elite', 0, 15], ['champion', 0, 20],
    ['normal', 10, 8], ['elite', 10, 12], ['champion', 10, 16],
  ];
  for (const [tier, level, expected] of table) {
    const { s, rep } = fightOnce({ tier, cfg, care: level });
    assert.equal(rep.win, true);
    assert.equal(rep.wear.length, 5);
    for (const w of rep.wear) {
      assert.equal(w.loss, expected, `${tier} care ${level}`);
      assert.equal(w.base, 10);
      assert.equal(w.left, 100 - expected);
    }
    for (const g of s.gear) assert.equal(g.durability, 100 - expected, `${tier} care ${level} ${g.slot}`);
  }
});

test('wear: never below 1 (heavy reductions, tiny multipliers) and the skill reduction is capped at 100%', () => {
  // 3 x 10% of the roll rounds to 0 -> 1
  const strong = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 3, max: 3 } }, skills: { activity: { gearCare: { perLevel: 9 } } } });
  const a = fightOnce({ cfg: strong, care: CONFIG.skills.maxLevel });
  assert.equal(a.rep.wear[0].skillRed, 9 * CONFIG.skills.maxLevel);
  for (const w of a.rep.wear) assert.equal(w.loss, 1);
  // a reduction above 100% is capped at 100% (and the minimum still holds)
  const absurd = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 9, max: 9 } }, skills: { activity: { gearCare: { perLevel: 25 } } } });
  const b = fightOnce({ cfg: absurd, care: CONFIG.skills.maxLevel });
  for (const w of b.rep.wear) {
    assert.equal(w.skillRed, 100);
    assert.equal(w.loss, 1);
  }
  // a tiny tier multiplier alone also rounds to 0 -> 1
  const tiny = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 4, max: 4, tierMult: { normal: 0.05 } } } });
  for (const w of fightOnce({ cfg: tiny }).rep.wear) assert.equal(w.loss, 1);
});

test('wear: a config without tier multipliers wears gear by the plain roll', () => {
  const cfg = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 7, max: 7 } } });
  delete cfg.gear.durabilityLoss.tierMult;
  for (const tier of Object.keys(CONFIG.enemies.tiers)) {
    for (const w of fightOnce({ tier, cfg }).rep.wear) {
      assert.equal(w.tierMult, 1, tier);
      assert.equal(w.loss, 7, tier);
    }
  }
});

test('wear: only the items actually used wear; spares and unpacked gear keep their durability; a draw wears too', () => {
  const cfg = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 10, max: 10 } } });
  const s = game(4, cfg);
  const set = fullSet(s, 'mythril', 'S');
  const spare = addGear(s, 'sword', 'copper', 'D');
  const home = addGear(s, 'boots', 'copper', 'D');
  endDay(s, cfg);
  confirmPlan(s, plan(tierIndex(s, 'normal'), [...set.map((g) => g.id), spare.id]), cfg);
  const rep = endDay(s, cfg).report;
  assert.equal(rep.wear.length, set.length);
  assert.ok(!rep.usedIds.includes(spare.id));
  assert.equal(spare.durability, 100);
  assert.equal(home.durability, 100);
  for (const g of set) {
    const used = rep.usedIds.includes(g.id);
    assert.equal(g.durability, used ? 100 - lossOf(10, tierMultOf('normal'), 0) : 100);
  }
  // a draw (nobody swings) still wears the used items, by the same formula
  const drawCfg = cfgWith(DRAW, { gear: { durabilityLoss: { min: 10, max: 10 } } });
  const d = fightOnce({ cfg: drawCfg, tier: 'elite' });
  assert.equal(d.rep.draw, true);
  assert.equal(d.rep.wear.length, d.set.length);
  for (const w of d.rep.wear) assert.equal(w.loss, lossOf(10, tierMultOf('elite'), 0));
  // no gear packed: nothing to wear
  assert.deepEqual(fightOnce({ cfg: drawCfg, gear: false }).rep.wear, []);
});

test('wear: each report entry breaks the loss down (roll, tier multiplier, skill reduction)', () => {
  const { rep } = fightOnce({ care: 3, tier: 'champion' });
  for (const w of rep.wear) {
    for (const k of ['id', 'name', 'loss', 'base', 'tierMult', 'skillRed', 'left']) assert.ok(k in w, k);
  }
});

// ------------------------------------------------- one decimal (v1.2) ----
test('wearLoss: roll x tier multiplier x (1 - Gear care %) to one decimal, at least 1, reduction capped at 100%', () => {
  assert.equal(wearLoss(10), 10);
  assert.equal(wearLoss(10, 1, 0), 10);
  assert.equal(wearLoss(10, 1.2, 0), 12);
  assert.equal(wearLoss(10, 1, 4), 9.6);
  assert.equal(wearLoss(9, 1.1, 3), 9.6, '9 x 1.1 x 0.97 = 9.603 -> 9.6');
  assert.equal(wearLoss(8, 1, 1), 7.9, '7.92 -> 7.9, not 8');
  assert.equal(wearLoss(0.2), 1, 'never below 1');
  assert.equal(wearLoss(10, 1, 100), 1);
  assert.equal(wearLoss(10, 1, 250), 1, 'a reduction above 100% counts as 100%');
  assert.equal(wearLoss(10, 1, -50), 10, 'and a negative one as 0%');
  // always at most one decimal
  for (const base of [DL.min, DL.max]) for (const red of [0, 0.7, 3.33, 9.99]) assert.equal(oneDecimal(wearLoss(base, 1.1, red)), wearLoss(base, 1.1, red));
});

test('wornDurability: one decimal, no float drift, never below 0', () => {
  assert.equal(wornDurability(100, 9.6), 90.4);
  let d = 100;
  for (let i = 0; i < 10; i++) d = wornDurability(d, 0.1);
  assert.equal(d, 99, 'ten times 0.1 is exactly 1 (plain subtraction gives 99.00000000000001)');
  assert.equal(wornDurability(5, 12), 0);
  assert.equal(wornDurability(90.4, 90.4), 0);
});

test('Gear care: on the default config every level lowers the average loss, for every enemy tier', () => {
  const rolls = [];
  for (let r = DL.min; r <= DL.max; r++) rolls.push(r);
  for (const tier of Object.keys(CONFIG.enemies.tiers)) {
    let prev = Infinity;
    for (let level = 0; level <= CONFIG.skills.maxLevel; level++) {
      const red = careOf(level);
      const mean = rolls.reduce((a, r) => a + wearLoss(r, tierMultOf(tier), red), 0) / rolls.length;
      assert.ok(mean < prev, `${tier}: level ${level} mean ${mean} should be below level ${level - 1} (${prev})`);
      prev = mean;
    }
  }
});

test('Gear care: in real fights (roll fixed, 1% per level) each level takes off a visible 0.1% and the item keeps one decimal', () => {
  const cfg = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 10, max: 10, tierMult: { normal: 1 } } }, skills: { activity: { gearCare: { perLevel: 1 } } } });
  let prev = Infinity;
  for (let level = 0; level <= cfg.skills.maxLevel; level++) {
    const { s, rep } = fightOnce({ cfg, care: level });
    const expected = oneDecimal(10 * (1 - level / 100));
    for (const w of rep.wear) {
      assert.equal(w.loss, expected, `level ${level}`);
      assert.ok(w.loss < prev, `level ${level}: ${w.loss} < ${prev}`);
    }
    for (const g of s.gear) assert.equal(g.durability, oneDecimal(100 - expected), `level ${level} ${g.slot}`);
    prev = rep.wear[0].loss;
  }
});

test('wear: durability stays at one decimal over many fights (no float drift) and repairs still make sense', () => {
  const cfg = cfgWith(WEAK_ENEMIES, { gear: { durabilityLoss: { min: 9, max: 9, tierMult: { normal: 1.1 } } } });
  const s = game(6, cfg);
  const set = fullSet(s, 'mythril', 'S');
  setSkillLevel(s, 'gearCare', 3);
  endDay(s, cfg);
  let expected = 100;
  for (let fight = 1; fight <= 4; fight++) {
    assert.equal(confirmPlan(s, plan(tierIndex(s, 'normal'), set.map((g) => g.id)), cfg).ok, true);
    const rep = endDay(s, cfg).report;
    assert.equal(rep.win, true);
    // 9 x 1.1 = 9.9, less the Gear care of that fight (the level reached in a fight applies from the next one)
    const loss = lossOf(9, 1.1, rep.wear[0].skillRed);
    expected = oneDecimal(expected - loss);
    for (const g of set) {
      assert.equal(g.durability, expected, `fight ${fight}`);
      assert.equal(oneDecimal(g.durability), g.durability);
    }
    assert.equal(acknowledgeReport(s).ok, true);
  }
  assert.ok(!Number.isInteger(expected), `a decimal, like ${expected}`);
  // repairing a fractional item: the cost is for exactly the missing part, rounded up to 0.01, and it is paid
  const g = set[1];
  const missing = oneDecimal(100 - g.durability);
  assert.ok(missing > 0 && !Number.isInteger(missing));
  const info = repairInfo(g, cfg);
  assert.ok(Math.abs(info.missing - missing) < 1e-9);
  const barKey = `${g.material}:${g.grade}`;
  const want = Math.ceil(cfg.gear.slots[g.slot].bars * (cfg.gear.repair.materialFraction / 100) * (missing / 100) * 100 - 1e-7) / 100;
  assert.equal(info.bars[barKey], want);
  assert.ok(info.bars[barKey] > 0);
  const full = repairInfo({ ...g, durability: 0 }, cfg);
  assert.ok(info.bars[barKey] < full.bars[barKey], 'a partial repair costs less than a full one');
  // one decimal of missing durability changes the price (here: 0.1% of a full repair is a visible fraction of a bar)
  const slightlyMore = repairInfo({ ...g, durability: oneDecimal(g.durability - 0.1) }, cfg);
  assert.ok(slightlyMore.bars[barKey] >= info.bars[barKey]);
  assert.ok(slightlyMore.minutes >= info.minutes);
  s.storage.bars[barKey] = 10;
  const before = s.storage.bars[barKey];
  assert.equal(repairPlan(s, g, cfg).ok, true);
  const res = repair(s, g.id, cfg);
  assert.equal(res.ok, true, res.msg);
  assert.equal(g.durability, 100);
  assert.ok(Math.abs(before - s.storage.bars[barKey] - want) < 1e-9, 'exactly the quoted amount was taken');
});

// ------------------------------------------------------------ Gear care ----
test('Gear care skill: an activity skill, perLevel % less durability loss, from config', () => {
  const def = skillDefs().find((d) => d.key === 'gearCare');
  assert.ok(def);
  assert.equal(def.group, 'activity');
  assert.equal(def.perLevel, CONFIG.skills.activity.gearCare.perLevel);
  assert.ok(def.perLevel > 0);
  // "very slightly" reduces: even at max level the loss stays well above zero
  assert.ok(careOf(CONFIG.skills.maxLevel) < 50);
  const s = game(1);
  assert.equal(smithBonuses(s).gearCarePct, 0);
  for (const level of [1, 4, CONFIG.skills.maxLevel]) {
    setSkillLevel(s, 'gearCare', level);
    assert.equal(smithBonuses(s).gearCarePct, def.perLevel * level);
  }
  assert.deepEqual(game(1).skills.gearCare, { xp: 0, level: 0 });
});

test('Gear care XP: every survived fight gives gearCareXpPerFight (a win, and a draw), once per fight not per item', () => {
  const per = CONFIG.skills.gearCareXpPerFight;
  assert.ok(per > 0);
  // win, with the full set (5 used items) and with no gear at all
  for (const gear of [true, false]) {
    const { s, rep } = fightOnce({ cfg: WIN, gear });
    assert.equal(rep.win, true);
    assert.equal(totalXp(s, 'gearCare'), per, `gear ${gear}`);
    assert.ok(Array.isArray(rep.notes));
  }
  // draw: the adventurer survives, no ring, no score
  const d = fightOnce({ cfg: DRAW, tier: 'champion' });
  assert.equal(d.rep.draw, true);
  assert.equal(d.rep.win, false);
  assert.equal(d.s.rings.length, 0);
  assert.equal(totalXp(d.s, 'gearCare'), per);
  // other skills are not touched by a fight
  for (const [k, v] of Object.entries(d.s.skills)) if (k !== 'gearCare') assert.deepEqual(v, { xp: 0, level: 0 }, k);
});

test('Gear care XP: nothing for a lost fight (game over)', () => {
  const { s, rep } = fightOnce({ cfg: LOSE, tier: 'champion' });
  assert.equal(rep.win, false);
  assert.equal(rep.draw, false);
  assert.equal(s.phase, 'over');
  assert.deepEqual(s.skills.gearCare, { xp: 0, level: 0 });
  assert.deepEqual(rep.notes, []);
  // the gear still wore in that fight (only the XP depends on surviving)
  assert.equal(rep.wear.length, 5);
  assert.ok(rep.wear.every((w) => w.loss >= 1));
});

test('Gear care XP: levels follow the XP curve; a level gained in a fight applies from the next fight', () => {
  // pinned: 100 XP for level 1, 200 more for level 2; 150 XP per fight; 2% less loss per level; fixed roll 50
  const cfg = cfgWith(WEAK_ENEMIES, {
    skills: { xpBase: 100, maxLevel: 10, gearCareXpPerFight: 150, activity: { gearCare: { perLevel: 2 } } },
    gear: { durabilityLoss: { min: 50, max: 50, tierMult: { normal: 1 } } },
  });
  const s = game(9, cfg);
  const set = fullSet(s, 'mythril', 'S');
  endDay(s, cfg);
  const seen = [];
  for (let fight = 1; fight <= 3; fight++) {
    for (const g of set) g.durability = 100; // keep the gear alive; this test is about the skill
    const r = confirmPlan(s, plan(tierIndex(s, 'normal'), set.map((g) => g.id)), cfg);
    assert.equal(r.ok, true, r.msg);
    const rep = endDay(s, cfg).report;
    assert.equal(rep.win, true, `fight ${fight}`);
    seen.push({ skillRed: rep.wear[0].skillRed, loss: rep.wear[0].loss, level: s.skills.gearCare.level, xp: s.skills.gearCare.xp, notes: rep.notes });
    assert.equal(acknowledgeReport(s).ok, true);
  }
  // after fight 1: 150 XP -> level 1 (100 spent), 50 left. After 2: 300 total -> level 2 exactly. After 3: 450 -> level 3 needs 600 -> still 2
  assert.deepEqual(seen.map((x) => x.skillRed), [0, 2, 4], 'the level reached in a fight reduces the wear of the NEXT fight');
  assert.deepEqual(seen.map((x) => x.loss), [50, 49, 48]);
  assert.deepEqual(seen.map((x) => x.level), [1, 2, 2]);
  assert.equal(totalXp(s, 'gearCare', cfg), 3 * 150);
  assert.equal(seen[0].xp, 150 - xpToNext(0, cfg));
  assert.match(seen[0].notes.join('\n'), /Gear care is now level 1/);
  assert.match(seen[1].notes.join('\n'), /Gear care is now level 2/);
  assert.deepEqual(seen[2].notes, []);
  assert.ok(s.log.some((l) => /Gear care is now level 2/.test(l.text)), 'level-ups reach the log');
});

// ------------------------------------------------------------ v1.1 saves ----
test('a v1.1 save (no Gear care skill, no Battle simulation intel entry) loads with both added at zero', () => {
  const s = game(7);
  s.skills.searchTime = { xp: 40, level: 3 };
  s.intel.points = 2;
  s.intel.spent.enemySight = 4;
  const v11 = JSON.parse(serialize(s));
  v11.version = 2;
  delete v11.skills.gearCare;
  delete v11.intel.spent.simDepth;
  const back = deserialize(JSON.stringify(v11));
  assert.equal(back.version, SAVE_VERSION, 'a version-2 save is converted to the current version');
  assert.deepEqual(back.skills.gearCare, { xp: 0, level: 0 });
  assert.equal(back.intel.spent.simDepth, 0);
  assert.deepEqual(back.skills.searchTime, { xp: 40, level: 3 }, 'existing skills are kept');
  assert.equal(back.intel.spent.enemySight, 4);
  assert.deepEqual(back, s, 'equal to the game it came from');
  // it plays on: the next survived fight trains the new skill
  const set = fullSet(back, 'mythril', 'S');
  endDay(back, WIN);
  confirmPlan(back, plan(tierIndex(back, 'normal'), set.map((g) => g.id)), WIN);
  const rep = endDay(back, WIN).report;
  assert.equal(rep.win, true);
  assert.equal(totalXp(back, 'gearCare'), CONFIG.skills.gearCareXpPerFight);
});

test('a v1.1 save with whole-number durability keeps it, and the next fight wears it with a decimal', () => {
  const s = game(8);
  const set = fullSet(s, 'mythril', 'S');
  set[0].durability = 73;
  const v11 = JSON.parse(serialize(s));
  v11.version = 2;
  const back = deserialize(JSON.stringify(v11));
  assert.equal(back.gear[0].durability, 73);
  setSkillLevel(back, 'gearCare', 4);
  endDay(back, WIN);
  confirmPlan(back, plan(tierIndex(back, 'normal'), back.gear.map((g) => g.id)), WIN);
  const rep = endDay(back, WIN).report;
  const w = rep.wear.find((x) => x.id === set[0].id);
  assert.equal(w.left, oneDecimal(73 - w.loss));
  assert.equal(back.gear.find((g) => g.id === set[0].id).durability, w.left);
});

test('loading keeps Gear care progress that exists, and adds any skill the config defines that the save lacks', () => {
  const s = game(3);
  s.skills.gearCare = { xp: 33, level: 2 };
  const back = deserialize(serialize(s));
  assert.deepEqual(back.skills.gearCare, { xp: 33, level: 2 });
  // a config with one more activity skill: the missing key is added by deserialize / addMissingKeys
  const cfg = cfgWith({ skills: { activity: { newSkill: { name: 'New', perLevel: 1, desc: '% x', xpFrom: 'y' } } } });
  const loaded = deserialize(serialize(s), cfg);
  assert.deepEqual(loaded.skills.newSkill, { xp: 0, level: 0 });
  assert.deepEqual(loaded.skills.gearCare, { xp: 33, level: 2 });
  assert.equal(skillDefs(cfg).length, skillDefs().length + 1);
  // addMissingKeys works on a bare object, adds intel tracks, and tolerates parts that are not there
  const bare = addMissingKeys({ skills: {}, intel: { points: 0 } });
  assert.deepEqual(Object.keys(bare.skills).sort(), skillDefs().map((d) => d.key).sort());
  for (const k of Object.keys(CONFIG.intel.tracks)) assert.equal(bare.intel.spent[k], 0, k);
  assert.deepEqual(addMissingKeys({ version: 2 }), { version: 2 });
});

test('a v1.0 save migrates and also gets the Gear care skill', () => {
  const s = game(5);
  const v1 = structuredClone(s);
  v1.version = 1;
  delete v1.skills.gearCare;
  delete v1.intel.spent.simDepth;
  for (const f of Object.values(v1.map.fields)) {
    delete f.pile;
    for (const c of f.cells) { c.debris = c.debris > 0; delete c.boulder; c.ground = []; delete c.touched; }
  }
  v1.loadMark = 0;
  const back = deserialize(JSON.stringify(v1));
  assert.deepEqual(back.skills.gearCare, { xp: 0, level: 0 });
  assert.equal(back.intel.spent.simDepth, 0);
});
