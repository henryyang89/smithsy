import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, TIERS } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import {
  ATTR_KEYS, growth, rollLevels, generateRoster, attrVisible, ringTypeVisible, ringGradeVisible, groupVisible, hiddenGradeOdds,
  knownLevels, sampleLevels, enemyBase, enemyCombatant,
} from '../js/core/enemies.js';
import { intelValue, enemySightFor, ringGradeSightFor } from '../js/core/intel.js';
import { game, cfgWith, allLevels, countLevels, approx } from './helpers.mjs';

// low/normal/high counts per tier, as configured
const EXPECTED = Object.fromEntries(TIERS.map((t) => [t, { low: 0, normal: 0, high: 0, ...CONFIG.enemies.tiers[t].levels }]));
const ATTR = CONFIG.enemies.attributes;
const val = (attr, level) => ATTR[attr].values[level];
// Pinned intel numbers for the visibility test.
const STEPS = { gains: [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], max: 100 };
const INTEL = cfgWith({ intel: { tracks: { enemySight: { base: 25, ...STEPS }, ringTypeSight: { base: 25, ...STEPS }, ringGradeSight: { base: 25, ...STEPS } } } });

test('12 attributes in 6 offense|defense pairs', () => {
  assert.equal(ATTR_KEYS.length, 12);
  const paired = CONFIG.enemies.pairs.flat();
  assert.deepEqual([...paired].sort(), [...ATTR_KEYS].sort());
  for (const [o, d] of CONFIG.enemies.pairs) {
    assert.equal(CONFIG.enemies.attributes[o].side, 'O');
    assert.equal(CONFIG.enemies.attributes[d].side, 'D');
  }
});

test('level counts per tier add up to the 12 attributes', () => {
  for (const tier of TIERS) assert.equal(EXPECTED[tier].low + EXPECTED[tier].normal + EXPECTED[tier].high, 12, tier);
});

test('roster: configured count per tier (normal, elite, champion order) with exact level counts per tier', () => {
  const tierList = TIERS.flatMap((t) => Array(CONFIG.enemies.tiers[t].count).fill(t));
  for (let seed = 1; seed <= 100; seed++) {
    const roster = generateRoster(seededRng(seed), 4);
    assert.equal(roster.day, 4);
    assert.equal(roster.enemies.length, tierList.length);
    assert.deepEqual(roster.enemies.map((e) => e.tier), tierList);
    for (const e of roster.enemies) {
      assert.equal(e.day, 4);
      assert.deepEqual(Object.keys(e.levels).sort(), [...ATTR_KEYS].sort());
      assert.deepEqual(countLevels(e.levels), EXPECTED[e.tier], `${e.tier} seed ${seed}`);
      assert.ok(CONFIG.enemies.names[e.tier].includes(e.name));
      for (const k of ATTR_KEYS) assert.ok(e.sight[k] >= 0 && e.sight[k] < 100);
      assert.ok(e.ringTypeRoll >= 0 && e.ringTypeRoll < 100);
      assert.ok(e.ringGradeRoll >= 0 && e.ringGradeRoll < 100);
      assert.ok(CONFIG.rings.types[e.ring.type]);
      assert.ok(Object.keys(CONFIG.rings.gradeWeights[e.tier]).includes(e.ring.grade));
    }
    for (const tier of TIERS) {
      const names = roster.enemies.filter((e) => e.tier === tier).map((e) => e.name);
      assert.equal(new Set(names).size, names.length, `duplicate ${tier} name (seed ${seed})`);
    }
  }
});

test('rollLevels: assignment is random (each attribute gets each allowed level sometimes)', () => {
  const rng = seededRng(2);
  for (const tier of TIERS) {
    const allowed = Object.entries(EXPECTED[tier]).filter(([, n]) => n > 0).map(([lv]) => lv).sort();
    const seen = Object.fromEntries(ATTR_KEYS.map((k) => [k, new Set()]));
    for (let i = 0; i < 400; i++) {
      const lv = rollLevels(rng, tier);
      for (const k of ATTR_KEYS) seen[k].add(lv[k]);
    }
    for (const k of ATTR_KEYS) assert.deepEqual([...seen[k]].sort(), allowed, `${tier} ${k}`);
  }
});

test('rollLevels throws if a tier\'s counts do not add up to 12', () => {
  const cfg = cfgWith({ enemies: { tiers: { elite: { levels: { low: 3, normal: 9, high: 3 } } } } });
  assert.throws(() => rollLevels(seededRng(1), 'elite', cfg), /add up to 12/);
});

test('sampleLevels keeps known levels and fills the rest to the exact tier counts', () => {
  const rng = seededRng(3);
  for (const tier of TIERS) {
    for (let i = 0; i < 100; i++) {
      // reveal 4 attributes of a real enemy of this tier
      const real = rollLevels(rng, tier);
      const known = Object.fromEntries(rng.shuffle([...ATTR_KEYS]).slice(0, 4).map((k) => [k, real[k]]));
      const out = sampleLevels(rng, tier, known);
      for (const [k, v] of Object.entries(known)) assert.equal(out[k], v);
      assert.deepEqual(countLevels(out), EXPECTED[tier]);
    }
  }
  // every high of a tier known -> no high is left for the other attributes
  const ch = EXPECTED.champion;
  const highs = Object.fromEntries(ATTR_KEYS.slice(0, ch.high).map((k) => [k, 'high']));
  const c = sampleLevels(rng, 'champion', highs);
  for (const k of ATTR_KEYS.slice(ch.high)) assert.notEqual(c[k], 'high');
  assert.deepEqual(countLevels(c), ch);
  // a pinned tier: 6 highs known -> everything else must be normal
  const pinned = cfgWith({ enemies: { tiers: { champion: { levels: { low: 0, normal: 6, high: 6 } } } } });
  const c6 = sampleLevels(rng, 'champion', Object.fromEntries(ATTR_KEYS.slice(0, 6).map((k) => [k, 'high'])), pinned);
  for (const k of ATTR_KEYS.slice(6)) assert.equal(c6[k], 'normal');
  // nothing known -> a valid random assignment
  for (const tier of TIERS) assert.deepEqual(countLevels(sampleLevels(rng, tier, {})), EXPECTED[tier]);
  // everything known -> unchanged
  const full = rollLevels(rng, 'normal');
  assert.deepEqual(sampleLevels(rng, 'normal', full), full);
});

test('sampleLevels does not mutate the known object', () => {
  const known = { piercing: 'low' };
  sampleLevels(seededRng(1), 'normal', known);
  assert.deepEqual(known, { piercing: 'low' });
});

test('growth: 1 + growthPerDay% x (day - 1) for HP/damage and for ratings', () => {
  assert.deepEqual(growth(1), { hpDamage: 1, ratings: 1 });
  const G = CONFIG.enemies.growthPerDay;
  const g = growth(11);
  assert.ok(approx(g.hpDamage, 1 + (G.hpDamage / 100) * 10));
  assert.ok(approx(g.ratings, 1 + (G.ratings / 100) * 10));
  const pinned = cfgWith({ enemies: { growthPerDay: { hpDamage: 5, ratings: 2 } } });
  assert.ok(approx(growth(11, pinned).hpDamage, 1.5));
  assert.ok(approx(growth(11, pinned).ratings, 1.2));
});

test('enemyCombatant: tier base stats with all-normal attributes on day 1', () => {
  const T = CONFIG.enemies.tiers.champion;
  const N = (attr) => val(attr, 'normal');
  const e = enemyCombatant('champion', 1, allLevels('normal'), 'Lich');
  assert.equal(e.name, 'Lich');
  assert.ok(approx(e.hp, T.hp * (N('hp') / 100)));
  assert.equal(e.damage, T.damage);
  assert.equal(e.defense, T.defense);
  assert.equal(e.interval, CONFIG.enemies.attackInterval);
  assert.equal(e.speed, N('fast'));
  assert.equal(e.accuracy, N('accurate'));
  assert.equal(e.dodge, N('evasion'));
  assert.equal(e.magicPct, N('magical'));
  assert.equal(e.magicRes, N('magicRes'));
  assert.equal(e.pierce, N('piercing'));
  assert.equal(e.pierceRes, N('pierceRes'));
  assert.equal(e.stunChance, N('stunning'));
  assert.equal(e.stunDur, CONFIG.enemies.stunDuration);
  assert.equal(e.stunChanceRed, N('stunRes'));
  assert.equal(e.stunDurRed, N('stunRes'));
  assert.equal(e.slowPct, N('chilling'));
  assert.equal(e.slowDur, CONFIG.enemies.slowDuration);
  assert.equal(e.slowRed, N('slowRes'));
  assert.equal(e.slowDurRed, N('slowRes'));
});

test('enemyCombatant: every attribute maps to its level value', () => {
  const rng = seededRng(4);
  const statOf = { piercing: 'pierce', pierceRes: 'pierceRes', magical: 'magicPct', magicRes: 'magicRes', stunning: 'stunChance', stunRes: 'stunChanceRed', chilling: 'slowPct', slowRes: 'slowRed', fast: 'speed' };
  for (const tier of TIERS) {
    const levels = rollLevels(rng, tier);
    const e = enemyCombatant(tier, 1, levels);
    for (const [attr, stat] of Object.entries(statOf)) assert.equal(e[stat], val(attr, levels[attr]), `${tier} ${attr}`);
    assert.equal(e.stunDurRed, e.stunChanceRed);
    assert.equal(e.slowDurRed, e.slowRed);
    assert.equal(e.accuracy, val('accurate', levels.accurate));
    assert.equal(e.dodge, val('evasion', levels.evasion));
    assert.ok(approx(e.hp, CONFIG.enemies.tiers[tier].hp * (val('hp', levels.hp) / 100)));
  }
});

test('enemy pierce resistance is a % (0..100) and grows low -> high', () => {
  const v = ATTR.pierceRes.values;
  assert.ok(v.low >= 0 && v.high <= 100);
  assert.ok(v.low <= v.normal && v.normal <= v.high);
});

test('enemyCombatant: daily growth scales HP/damage and ratings, not defense', () => {
  const hiT = CONFIG.enemies.tiers.normal;
  const g = growth(11);
  const hi = enemyCombatant('normal', 11, allLevels('high'));
  assert.ok(approx(hi.hp, hiT.hp * g.hpDamage * (val('hp', 'high') / 100)));
  assert.ok(approx(hi.damage, hiT.damage * g.hpDamage));
  assert.ok(approx(hi.accuracy, val('accurate', 'high') * g.ratings));
  assert.ok(approx(hi.dodge, val('evasion', 'high') * g.ratings));
  assert.equal(hi.speed, val('fast', 'high'));
  assert.equal(hi.defense, hiT.defense, 'defense does not grow');
  const eT = CONFIG.enemies.tiers.elite;
  const lo = enemyCombatant('elite', 1, allLevels('low'));
  assert.ok(approx(lo.hp, eT.hp * (val('hp', 'low') / 100)));
  assert.equal(lo.speed, val('fast', 'low'));
  assert.equal(lo.pierce, val('piercing', 'low'));
  assert.equal(lo.magicRes, val('magicRes', 'low'));
  assert.equal(lo.accuracy, val('accurate', 'low'));
  const b = enemyBase('elite', 3);
  const g3 = growth(3);
  assert.ok(approx(b.hp, eT.hp * g3.hpDamage));
  assert.ok(approx(b.damage, eT.damage * g3.hpDamage));
  assert.equal(b.defense, eT.defense);
  assert.ok(approx(b.ratingMult, g3.ratings));
  // with pinned numbers
  const pinned = cfgWith({ enemies: { growthPerDay: { hpDamage: 5, ratings: 2 }, tiers: { elite: { hp: 90, damage: 8, defense: 15 } } } });
  const pb = enemyBase('elite', 3, pinned);
  assert.ok(approx(pb.hp, 99));
  assert.ok(approx(pb.damage, 8.8));
  assert.equal(pb.defense, 15);
  assert.ok(approx(pb.ratingMult, 1.04));
});

test('attribute visibility: stored roll < intel chance (base 25% here, rises when intel is spent)', () => {
  const s = game(1);
  const e = { tier: 'normal', ring: { type: 'travelTime', grade: 'D' }, levels: allLevels('normal'), sight: Object.fromEntries(ATTR_KEYS.map((k, i) => [k, i * 8.5])), ringTypeRoll: 24.99, ringGradeRoll: 25 };
  // rolls: 0, 8.5, 17, 25.5, 34, ...
  assert.equal(attrVisible(s, e, 'piercing', INTEL), true);
  assert.equal(attrVisible(s, e, 'magical', INTEL), true); // 17 < 25
  assert.equal(attrVisible(s, e, 'magicRes', INTEL), false); // 25.5
  assert.deepEqual(Object.keys(knownLevels(s, e, INTEL)), ATTR_KEYS.slice(0, 3));
  assert.equal(ringTypeVisible(s, e, INTEL), true);
  assert.equal(ringGradeVisible(s, e, INTEL), false, 'roll equal to the chance is hidden');
  s.intel.spent.enemySight = 1; // 35%
  assert.equal(attrVisible(s, e, 'magicRes', INTEL), true);
  assert.equal(Object.keys(knownLevels(s, e, INTEL)).length, 5); // 0..34
  s.intel.spent.ringGradeSight = 1;
  assert.equal(ringGradeVisible(s, e, INTEL), true);
  // maximum intel shows everything (rolls are < 100)
  s.intel.spent.enemySight = 1000;
  e.sight.hp = 99.999;
  assert.deepEqual(knownLevels(s, e, INTEL), e.levels);
  assert.deepEqual(knownLevels(s, e), e.levels, 'default config: maximum intel also shows everything');
});

// Pinned scouting numbers for the tier / grade multiplier tests: 50% scouting, elites 90%, champions 80%; ring grades 100 .. 60%.
const MULT = cfgWith({
  intel: {
    tracks: {
      enemySight: { base: 50, tierMult: { normal: 100, elite: 90, champion: 80 } },
      ringGradeSight: { base: 50, gradeMult: { D: 100, C: 90, B: 80, A: 70, S: 60 } },
      groupSight: { base: 40 },
    },
  },
});

test('enemy scouting is worth less against elites and champions (tierMult): the same roll can be seen on a normal and hidden on a champion', () => {
  const s = game(1);
  const c = intelValue(s, 'enemySight', MULT); // 50
  const m = MULT.intel.tracks.enemySight.tierMult;
  assert.equal(enemySightFor(s, 'normal', MULT), c);
  assert.equal(enemySightFor(s, 'elite', MULT), (c * m.elite) / 100);
  assert.equal(enemySightFor(s, 'champion', MULT), (c * m.champion) / 100);
  const enemy = (tier, roll) => ({ tier, levels: allLevels('normal'), sight: Object.fromEntries(ATTR_KEYS.map((k) => [k, roll])) });
  const hiddenFor = (roll) => ['normal', 'elite', 'champion'].filter((t) => !attrVisible(s, enemy(t, roll), 'piercing', MULT));
  // a roll in [0.8c, c): visible for a normal, hidden for a champion (elite: 0.9c)
  const roll = (c * m.champion) / 100 + 0.5;
  assert.ok(roll < c);
  assert.deepEqual(hiddenFor(roll), ['champion'], 'visible for a normal and an elite, hidden for a champion');
  assert.deepEqual(hiddenFor((c * m.elite) / 100 + 0.5), ['elite', 'champion'], 'between 0.9c and c: the elite hides it too');
  assert.deepEqual(hiddenFor(c), ['normal', 'elite', 'champion'], 'a roll equal to the chance is hidden for everyone');
  assert.deepEqual(hiddenFor((c * m.champion) / 100 - 0.5), [], 'below 0.8c every tier sees it');
  // knownLevels follows the same rule
  const e = enemy('champion', roll);
  assert.deepEqual(knownLevels(s, e, MULT), {});
  assert.deepEqual(Object.keys(knownLevels(s, enemy('normal', roll), MULT)), ATTR_KEYS);
  // a track without a tierMult treats every tier alike
  const flat = cfgWith({ intel: { tracks: { enemySight: { base: 50, tierMult: { normal: 100, elite: 100, champion: 100 } } } } });
  for (const t of ['normal', 'elite', 'champion']) assert.equal(enemySightFor(s, t, flat), 50, t);
});

test('ring grade scouting is worth less for better grades (gradeMult): the same roll is seen for a D ring and hidden for an S ring', () => {
  const s = game(1);
  const c = intelValue(s, 'ringGradeSight', MULT); // 50
  const m = MULT.intel.tracks.ringGradeSight.gradeMult;
  const enemy = (grade, roll) => ({ tier: 'champion', ring: { type: 'travelTime', grade }, ringGradeRoll: roll });
  for (const g of Object.keys(m)) assert.equal(ringGradeSightFor(s, g, MULT), (c * m[g]) / 100, g);
  const roll = (c * m.S) / 100 + 0.5; // between the S chance and the D chance
  assert.equal(ringGradeVisible(s, enemy('D', roll), MULT), true);
  assert.equal(ringGradeVisible(s, enemy('S', roll), MULT), false);
  assert.equal(ringGradeVisible(s, enemy('S', (c * m.S) / 100 - 0.5), MULT), true);
  assert.equal(ringGradeVisible(s, enemy('D', c), MULT), false, 'a roll equal to the chance is hidden');
  assert.equal(ringGradeVisible(s, { tier: 'normal', ringGradeRoll: 1 }, MULT), false, 'an enemy without a ring has no grade to see');
});

test('banner scouting: the banner is visible when its roll is below the Banner scouting chance', () => {
  const s = game(1);
  const c = intelValue(s, 'groupSight', MULT);
  assert.equal(groupVisible(s, { groupRoll: c - 0.01 }, MULT), true);
  assert.equal(groupVisible(s, { groupRoll: c }, MULT), false);
  assert.equal(groupVisible(s, { groupRoll: 0 }, MULT), true);
  assert.equal(groupVisible(s, {}, MULT), false, 'an enemy without a banner roll shows none');
  s.intel.spent.groupSight = 1;
  assert.equal(groupVisible(s, { groupRoll: c }, MULT), true, 'one more point raises the chance');
  s.intel.spent.groupSight = 1000;
  assert.equal(groupVisible(s, { groupRoll: 99.999 }, MULT), true, 'at the maximum every banner is seen');
});

test('hiddenGradeOdds: the odds of each grade given that it is hidden add up to 100 and favour better grades as scouting rises', () => {
  const s = game(1);
  for (const tier of TIERS) {
    const weights = MULT.rings.gradeWeights[tier];
    const grades = Object.keys(weights);
    const enemy = { tier, ring: { type: 'travelTime', grade: grades[0] } };
    let prev = null;
    for (const points of [0, 1, 2, 3, 4, 5]) {
      s.intel.spent.ringGradeSight = points;
      const odds = hiddenGradeOdds(s, enemy, MULT);
      assert.deepEqual(Object.keys(odds), grades, 'the tier\'s grades, low first');
      assert.ok(approx(Object.values(odds).reduce((a, b) => a + b, 0), 100, 1e-9), `${tier} adds up to 100 at ${points} points`);
      const share = (g) => odds[g];
      if (prev) {
        // the best grade's share rises and the lowest grade's falls (their ratio moves toward the better grade)
        const best = grades[grades.length - 1];
        assert.ok(share(best) >= prev[best] - 1e-9, `${tier}: ${best} does not lose share`);
        assert.ok(share(grades[0]) <= prev[grades[0]] + 1e-9, `${tier}: ${grades[0]} does not gain share`);
      }
      prev = odds;
    }
    // no scouting at all: the plain tier odds
    s.intel.spent.ringGradeSight = 0;
    const zero = cfgWith({ intel: { tracks: { ringGradeSight: { base: 0 } } } });
    const plain = hiddenGradeOdds(s, enemy, zero);
    const total = Object.values(weights).reduce((a, b) => a + b, 0);
    for (const g of grades) assert.ok(approx(plain[g], (weights[g] / total) * 100, 1e-9), `${tier} ${g}`);
  }
  // with a strong scouting chance the better grade gets a visibly larger share than its plain weight
  s.intel.spent.ringGradeSight = 0;
  const strong = cfgWith({ intel: { tracks: { ringGradeSight: { base: 80 } } } });
  const odds = hiddenGradeOdds(s, { tier: 'champion' }, strong);
  const w = strong.rings.gradeWeights.champion;
  const wTotal = Object.values(w).reduce((a, b) => a + b, 0);
  assert.ok(odds.S > (w.S / wTotal) * 100, 'S is likelier than its plain weight once most hidden rings would have been scouted');
});

test('every roster enemy has a banner from the config and a banner roll in [0, 100); banners spread over all colours', () => {
  const seen = new Set();
  for (let seed = 1; seed <= 60; seed++) {
    for (const e of generateRoster(seededRng(seed), 3).enemies) {
      assert.ok(e.group in CONFIG.groups.list, `${e.group} is a configured banner`);
      assert.ok(e.groupRoll >= 0 && e.groupRoll < 100, `roll ${e.groupRoll}`);
      seen.add(e.group);
    }
  }
  assert.deepEqual([...seen].sort(), Object.keys(CONFIG.groups.list).sort(), 'every banner turns up');
});

test('the banner is not tied to the enemy name and does not change its attributes', () => {
  const byName = new Map();
  for (let seed = 1; seed <= 200; seed++) {
    for (const e of generateRoster(seededRng(seed), 3).enemies) {
      if (!byName.has(e.name)) byName.set(e.name, new Set());
      byName.get(e.name).add(e.group);
    }
  }
  assert.ok([...byName.values()].every((g) => g.size > 1), 'a name appears under more than one banner');
  // the attribute levels of a roster only depend on the tier counts, never on the group
  for (const e of generateRoster(seededRng(5), 3).enemies) assert.deepEqual(countLevels(e.levels), EXPECTED[e.tier]);
});

test('about the scouting chance of attributes are visible at base intel (a little less for elites and champions)', () => {
  const s = game(2);
  let vis = 0;
  let total = 0;
  let expected = 0;
  for (let seed = 1; seed <= 100; seed++) {
    for (const e of generateRoster(seededRng(seed), 2).enemies) {
      vis += Object.keys(knownLevels(s, e)).length;
      total += 12;
      expected += 12 * Math.min(100, enemySightFor(s, e.tier)) / 100;
    }
  }
  assert.ok(Math.abs(vis / total - expected / total) < 0.03, `${vis / total} vs ${expected / total}`);
  assert.ok(expected / total <= CONFIG.intel.tracks.enemySight.base / 100 + 1e-9, 'never more than the plain chance');
});

// ----------------------------------------------- 2.0 enemy table (B3) ----
test('tier base stats: normal <= elite <= champion in HP, damage and defense, with at least one strict step each', () => {
  const T = CONFIG.enemies.tiers;
  const stats = ['hp', 'damage', 'defense'];
  for (const [lo, hi] of [['normal', 'elite'], ['elite', 'champion']]) {
    for (const k of stats) assert.ok(T[hi][k] >= T[lo][k], `${hi} ${k} (${T[hi][k]}) >= ${lo} (${T[lo][k]})`);
    assert.ok(stats.some((k) => T[hi][k] > T[lo][k]), `${hi} is strictly above ${lo} in at least one stat`);
  }
  // and the base numbers an enemy gets on day 1 are exactly those
  for (const tier of TIERS) {
    const b = enemyBase(tier, 1);
    assert.ok(approx(b.hp, T[tier].hp) && approx(b.damage, T[tier].damage) && b.defense === T[tier].defense, tier);
  }
});

test('every attribute: Low <= Normal <= High', () => {
  for (const [k, a] of Object.entries(ATTR)) {
    assert.ok(a.values.low <= a.values.normal, `${k} low <= normal`);
    assert.ok(a.values.normal <= a.values.high, `${k} normal <= high`);
    assert.ok(a.values.low < a.values.high, `${k} Low and High differ`);
  }
});

test('Low = none: the four specials and the four resistances are 0 at Low', () => {
  const specials = ['piercing', 'magical', 'stunning', 'chilling'];
  const resistances = ['pierceRes', 'magicRes', 'stunRes', 'slowRes'];
  for (const k of [...specials, ...resistances]) assert.equal(val(k, 'low'), 0, k);
  // and positive at Normal and High, so Low really is "has none"
  for (const k of [...specials, ...resistances]) {
    assert.ok(val(k, 'normal') > 0 && val(k, 'high') > val(k, 'normal'), k);
  }
  // an enemy with all of them Low has none of the abilities
  const e = enemyCombatant('champion', 1, allLevels('low'));
  for (const k of ['pierce', 'pierceRes', 'magicPct', 'magicRes', 'stunChance', 'stunChanceRed', 'stunDurRed', 'slowPct', 'slowRed', 'slowDurRed']) assert.equal(e[k], 0, k);
});

test('Accurate, Evasion, Fast and HP are core stats: they move in small steps (not 0 at Low)', () => {
  for (const k of ['accurate', 'evasion', 'hp']) assert.ok(val(k, 'low') > 0, k);
  assert.ok(val('fast', 'low') < 0 && val('fast', 'high') > 0);
  for (const k of ['accurate', 'evasion', 'hp']) assert.ok(val(k, 'high') - val(k, 'low') <= 0.25 * val(k, 'normal'), `${k} stays within a quarter of Normal`);
});

test('growth is applied to the combat stats (HP, damage, accuracy, dodge) and nothing else', () => {
  const lv = allLevels('normal');
  const d1 = enemyCombatant('elite', 1, lv);
  const d11 = enemyCombatant('elite', 11, lv);
  const g = growth(11);
  assert.ok(approx(d11.hp, d1.hp * g.hpDamage) && approx(d11.damage, d1.damage * g.hpDamage));
  assert.ok(approx(d11.accuracy, d1.accuracy * g.ratings) && approx(d11.dodge, d1.dodge * g.ratings));
  assert.equal(d11.defense, d1.defense);
  assert.equal(d11.magicPct, d1.magicPct);
  assert.equal(d11.stunChance, d1.stunChance);
});
