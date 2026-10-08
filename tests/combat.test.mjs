import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import { clamp } from '../js/core/util.js';
import { gearStats } from '../js/core/gear.js';
import { adventurerCombatant, hitChance, attackInterval, hitDamage, fight } from '../js/core/combat.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { cfgWith, combatant, approx, allLevels, scriptRand, NO_HEAD_START } from './helpers.mjs';

// Pinned combat numbers: the hand-computed expectations below hold whatever CONFIG says.
const PIN = { combat: { hitK: 0.25, minHitPct: 5, maxHitPct: 95, damageRoll: [90, 110], defenseCap: 75, resistCap: 75, safetyCapSeconds: 36000 } };
// The hand-timed fights below have no random head start (each bar starts empty); head start has its own tests.
const CFG = cfgWith(PIN, NO_HEAD_START);
const capAt = (seconds, extra = {}) => cfgWith(PIN, NO_HEAD_START, { combat: { safetyCapSeconds: seconds, ...extra } });

const item = (slot, material = 'copper', grade = 'D', gem = null) => ({ id: Math.random(), slot, material, grade, gem, durability: 100, packed: false });
const close = (a, b, epsOrMsg) => {
  const eps = typeof epsOrMsg === 'number' ? epsOrMsg : 1e-9;
  assert.ok(approx(a, b, eps), `${a} != ${b}${typeof epsOrMsg === 'string' ? ` (${epsOrMsg})` : ''}`);
};
const always = (v) => () => v;
const attacks = (log, side) => log.filter((e) => e.side === side);
const times = (log, side) => attacks(log, side).map((e) => e.t);
// A combatant that never hurts anybody (for timing tests).
const dummy = (over = {}) => combatant({ damage: 0, ...over });

// ---------------------------------------------------------------- hit chance --
test('hitChance S-curve: acc^2 / (acc^2 + k dodge^2) -> 80% at parity, ~94.1% at 2x accuracy, 50% at half (k = 0.25)', () => {
  close(hitChance(100, 100, CFG), 0.8);
  close(hitChance(250, 250, CFG), 0.8);
  close(hitChance(200, 100, CFG), 4 / 4.25);
  assert.ok(Math.abs(hitChance(200, 100, CFG) - 0.941) < 0.001);
  close(hitChance(50, 100, CFG), 0.5);
  // k comes from the config
  close(hitChance(100, 100, cfgWith(PIN, { combat: { hitK: 1 } })), 0.5);
});

test('hitChance defaults to CONFIG', () => {
  const { hitK, minHitPct, maxHitPct } = CONFIG.combat;
  for (const [a, d] of [[100, 100], [150, 90], [60, 130]]) {
    close(hitChance(a, d), clamp((a * a) / (a * a + hitK * d * d), minHitPct / 100, maxHitPct / 100));
  }
});

test('hitChance clamps to minHit..maxHit and treats ratings below 1 as 1', () => {
  assert.equal(hitChance(1, 1000, CFG), 0.05);
  assert.equal(hitChance(1000, 1, CFG), 0.95);
  assert.equal(hitChance(400, 100, CFG), 0.95); // 16/16.25 = 98.5% -> capped
  assert.equal(hitChance(0, 0, CFG), 0.8);
  assert.equal(hitChance(-50, 100, CFG), 0.05);
  const wide = cfgWith(PIN, { combat: { minHitPct: 20, maxHitPct: 90 } });
  assert.equal(hitChance(1, 1000, wide), 0.2);
  assert.equal(hitChance(1000, 1, wide), 0.9);
});

test('hitChance has diminishing returns', () => {
  const g1 = hitChance(150, 100, CFG) - hitChance(100, 100, CFG);
  const g2 = hitChance(200, 100, CFG) - hitChance(150, 100, CFG);
  assert.ok(g1 > g2 && g2 > 0);
});

// ----------------------------------------------------------- interval/damage --
test('attackInterval: speed shortens, slow lengthens', () => {
  close(attackInterval({ interval: 2, speed: 0 }, false, 0), 2);
  close(attackInterval({ interval: 2, speed: 25 }, false, 0), 1.6);
  close(attackInterval({ interval: 2, speed: -5 }, false, 0), 2 / 0.95);
  close(attackInterval({ interval: 2, speed: 0 }, true, 50), 3);
  close(attackInterval({ interval: 2, speed: 25 }, true, 50), 2.4);
  close(attackInterval({ interval: 2, speed: 0 }, false, 50), 2, 'slowPct ignored when not slowed');
});

test('hitDamage: defense reduces physical damage, capped at defenseCap', () => {
  const att = combatant({ damage: 20 });
  close(hitDamage(att, combatant({ defense: 25 }), CFG).phys, 15);
  close(hitDamage(att, combatant({ defense: 90 }), CFG).phys, 5); // capped at 75%
  close(hitDamage(att, combatant({ defense: 0 }), CFG).total, 20);
  close(hitDamage(att, combatant({ defense: 90 }), cfgWith(PIN, { combat: { defenseCap: 50 } })).phys, 10);
  close(hitDamage(att, combatant({ defense: 25 }), CFG).effDef, 25);
});

test('piercing ignores a % of the defense; pierce resistance ignores a % of the piercing (capped at resistCap)', () => {
  const att = combatant({ damage: 10, pierce: 40 });
  close(hitDamage(att, combatant({ defense: 50 }), CFG).effDef, 30); // 40% of 50 ignored
  const h = hitDamage(att, combatant({ defense: 50, pierceRes: 50 }), CFG);
  close(h.effDef, 40); // 50% of the 40 piercing ignored -> 20% of 50 ignored
  close(h.phys, 6);
  // relative, not points: 25% resistance against 40 piercing leaves 30 (not 15)
  close(hitDamage(att, combatant({ defense: 50, pierceRes: 25 }), CFG).effDef, 35);
  // pierce resistance never goes past the resist cap (75%): 100 -> 75 -> 10 piercing left
  close(hitDamage(att, combatant({ defense: 50, pierceRes: 100 }), CFG).effDef, 45);
  close(hitDamage(att, combatant({ defense: 50, pierceRes: 100 }), cfgWith(PIN, { combat: { resistCap: 50 } })).effDef, 40);
  // no pierce resistance -> full piercing; no piercing -> resistance does nothing
  close(hitDamage(combatant({ damage: 10 }), combatant({ defense: 50, pierceRes: 40 }), CFG).effDef, 50);
  // piercing above 100% counts as 100%, and it applies to the capped defense
  close(hitDamage(combatant({ damage: 10, pierce: 150 }), combatant({ defense: 50 }), CFG).effDef, 0);
  close(hitDamage(combatant({ damage: 10, pierce: 20 }), combatant({ defense: 100 }), CFG).effDef, 60);
});

test('adventurer pierce resistance (diamond armor + ring) ignores that % of the enemy\'s piercing', () => {
  const chest = item('chest', 'iron', 'B', { type: 'diamond', grade: 'S' });
  const adv = adventurerCombatant([chest], { pierceRes: 10 });
  const res = gearStats(chest).pierceRes + 10;
  close(adv.pierceRes, res);
  const enemy = enemyCombatant('champion', 1, allLevels('high'));
  const h = hitDamage(enemy, adv);
  const pierce = Math.min(100, enemy.pierce) * (1 - Math.min(res, CONFIG.combat.resistCap) / 100);
  close(h.effDef, Math.min(adv.defense, CONFIG.combat.defenseCap) * (1 - pierce / 100));
  assert.ok(h.effDef > hitDamage(enemy, adventurerCombatant([item('chest', 'iron', 'B')])).effDef, 'more defense left than without resistance');
});

test('magic damage ignores defense but is reduced by magic resistance (capped at resistCap)', () => {
  const att = combatant({ damage: 10, magicPct: 50 });
  close(hitDamage(att, combatant({ defense: 0 }), CFG).magic, 5);
  close(hitDamage(att, combatant({ defense: 75 }), CFG).magic, 5, 'defense does not touch magic');
  close(hitDamage(att, combatant({ defense: 75 }), CFG).phys, 2.5);
  close(hitDamage(att, combatant({ magicRes: 40 }), CFG).magic, 3);
  close(hitDamage(att, combatant({ magicRes: 100 }), CFG).magic, 1.25);
  close(hitDamage(att, combatant({ magicRes: 40 }), CFG).phys, 10, 'magic resistance does not touch physical');
  close(hitDamage(att, combatant({ magicRes: 40 }), CFG).total, 13);
});

// ------------------------------------------------------- adventurer stats ----
test('adventurerCombatant: unarmed base stats come from CONFIG.adventurer', () => {
  const A = CONFIG.adventurer;
  const a = adventurerCombatant([]);
  assert.equal(a.hp, A.hp);
  assert.equal(a.damage, A.unarmedDamage);
  assert.equal(a.interval, A.attackInterval);
  assert.equal(a.accuracy, A.accuracy);
  assert.equal(a.dodge, A.dodge);
  assert.equal(a.defense, 0);
  assert.equal(a.speed, 0);
  assert.equal(a.pierce, 0);
  assert.equal(a.pierceRes, 0);
});

test('adventurerCombatant: sword damage replaces unarmed damage; every other gear stat adds up', () => {
  const gear = [item('sword', 'iron', 'D', { type: 'diamond', grade: 'S' }), item('gloves'), item('boots', 'steel', 'B'), item('chest', 'copper', 'D', { type: 'ruby', grade: 'S' }), item('helmet')];
  const a = adventurerCombatant(gear);
  const base = adventurerCombatant([]);
  const sum = {};
  for (const g of gear) for (const [k, v] of Object.entries(gearStats(g))) sum[k] = (sum[k] || 0) + v;
  close(a.damage, gearStats(gear[0]).damage, 'sword damage, not sword + unarmed');
  for (const [k, v] of Object.entries(sum)) if (k !== 'damage') close(a[k], (base[k] || 0) + v, k);
  assert.ok(a.pierce > 0 && a.magicRes > 0, 'gem effects included');
  assert.equal(a.hp, base.hp, 'gear does not change HP');
});

test('adventurerCombatant: adventurer rings add their stats; health ring scales HP', () => {
  const rings = { pierce: 7, pierceRes: 3, magicDmg: 5, magicRes: 4, stunRes: 10, accuracy: 9, dodge: 8, slowRes: 6, speed: 4, health: 7 };
  const A = CONFIG.adventurer;
  const a = adventurerCombatant([], rings);
  close(a.hp, A.hp * 1.07);
  assert.equal(a.pierce, 7);
  assert.equal(a.pierceRes, 3);
  assert.equal(a.magicPct, 5);
  assert.equal(a.magicRes, 4);
  assert.equal(a.stunChanceRed, 10);
  assert.equal(a.stunDurRed, 10);
  assert.equal(a.accuracy, A.accuracy + 9);
  assert.equal(a.dodge, A.dodge + 8);
  assert.equal(a.slowRed, 6);
  assert.equal(a.slowDurRed, 6);
  assert.equal(a.speed, 4);
  // smith ring keys are ignored
  assert.deepEqual(adventurerCombatant([], { travelTime: 10 }), adventurerCombatant([]));
});

// ------------------------------------------------------------- attack bar ----
test('attack bar: without slows or stuns each side attacks exactly every interval / (1 + speed%)', () => {
  const a = dummy({ interval: 2, speed: 25 }); // 1.6s
  const e = dummy({ interval: 3, speed: -25 }); // 4s
  const r = fight(a, e, always(0.99), true, capAt(39));
  const tA = times(r.log, 'A');
  const tE = times(r.log, 'E');
  assert.equal(tA.length, 24); // 24 x 1.6 = 38.4 <= 39
  assert.equal(tE.length, 9); // 9 x 4 = 36
  tA.forEach((t, i) => close(t, (i + 1) * attackInterval(a, false, 0), 1e-6));
  tE.forEach((t, i) => close(t, (i + 1) * 4, 1e-6));
  assert.equal(r.draw, true);
});

test('attack bar: ties go to the adventurer', () => {
  const r = fight(dummy(), dummy(), always(0.99), true, capAt(7));
  assert.deepEqual(r.log.map((e) => `${e.t}${e.side}`), ['2A', '2E', '4A', '4E', '6A', '6E']);
});

test('slow: X% applied mid-wait stretches the remaining wait by the overlapping part', () => {
  const E = dummy({ interval: 4 });
  // A hits once at t=1 (scripted: hit roll 0, damage roll 0.5), every later attack misses.
  // E is slowed by 50% during [1, 2]: that second fills only 1/1.5 of what it normally would.
  const r = fight(dummy({ interval: 1, slowPct: 50, slowDur: 1 }), E, scriptRand([0, 0.5]), true, capAt(20));
  assert.deepEqual(attacks(r.log, 'A')[0].slow, { pct: 50, dur: 1 });
  assert.equal(r.summary.A.slows, 1);
  const tE = times(r.log, 'E');
  close(tE[0], 4 + 1 * (1 - 1 / 1.5)); // 4.333
  close(tE[1] - tE[0], 4, 'after the slow the bar fills at full speed again');
  // a slow that covers the whole remaining wait (3s) stretches all of it by 50%...
  const long = fight(dummy({ interval: 1, slowPct: 50, slowDur: 10 }), E, scriptRand([0, 0.5]), true, capAt(20));
  const tL = times(long.log, 'E');
  close(tL[0], 1 + 3 * 1.5); // 5.5
  // ...and when it ends mid-wait (t=11) the rest of the bar fills at the normal rate
  close(tL[1], 11 + (1 - (11 - 5.5) / 6) * 4); // 5.5s at 1/6 per s, then normal speed
  // without the hit there is no slow
  const miss = fight(dummy({ interval: 1, slowPct: 50, slowDur: 10 }), E, always(0.99), true, capAt(20));
  close(times(miss.log, 'E')[0], 4);
});

test('slow: does not stack, a new hit only refreshes it to max(until)', () => {
  const E = dummy({ interval: 4 });
  // A hits at t=1 and t=2 (slow 50% for 1.5s each): slowed during [1, 3.5], not [1, 4] and not 100%
  const r = fight(dummy({ interval: 1, slowPct: 50, slowDur: 1.5 }), E, scriptRand([0, 0.5, 0, 0.5]), true, capAt(20));
  assert.equal(r.summary.A.slows, 2);
  // progress: 1s at 1/4 + 2.5s at 1/6, rest at 1/4
  close(times(r.log, 'E')[0], 3.5 + (1 - 0.25 - 2.5 / 6) * 4);
});

test('slow resistance weakens a slow\'s strength and duration (capped at resistCap)', () => {
  const quiet = { hp: 200, damage: 1 };
  const tE = (r) => times(r.log, 'E').slice(0, 3);
  const base = fight(combatant(quiet), combatant(quiet), always(0), true, CFG);
  assert.deepEqual(tE(base), [2, 4, 6]);
  // A hits at t=2 first (ties go to the adventurer), slowing E by 50% for 10s; it re-hits every 2s
  const sl = fight(combatant({ ...quiet, slowPct: 50, slowDur: 10 }), combatant(quiet), always(0), true, CFG);
  assert.deepEqual(attacks(sl.log, 'A')[0].slow, { pct: 50, dur: 10 });
  assert.deepEqual(tE(sl), [2, 5, 8]);
  const res = fight(combatant({ ...quiet, slowPct: 50, slowDur: 10 }), combatant({ ...quiet, slowRed: 50, slowDurRed: 50 }), always(0), true, CFG);
  assert.deepEqual(attacks(res.log, 'A')[0].slow, { pct: 25, dur: 5 });
  assert.deepEqual(tE(res), [2, 4.5, 7]);
  const capped = fight(combatant({ ...quiet, slowPct: 40, slowDur: 8 }), combatant({ ...quiet, slowRed: 100, slowDurRed: 100 }), always(0), true, CFG);
  assert.deepEqual(attacks(capped.log, 'A')[0].slow, { pct: 10, dur: 2 });
});

test('slowed ties still go to the adventurer', () => {
  // E (interval 1) slows A by 100% on every hit: A's bar then fills in 2s, so both bars fill at t=3, 5, 7, 9
  const r = fight(dummy({ interval: 1 }), dummy({ interval: 1, slowPct: 100, slowDur: 100 }), always(0), true, capAt(10));
  assert.deepEqual(times(r.log, 'A'), [1, 3, 5, 7, 9]);
  assert.equal(times(r.log, 'E').length, 10);
  for (const t of times(r.log, 'A')) {
    const both = r.log.filter((e) => e.t === t).map((e) => e.side);
    assert.deepEqual(both, ['A', 'E'], `t=${t}`);
  }
  // the other way round: A slows E by 100%; E's bar is half full at t=1 and then needs 2 more seconds
  const r2 = fight(dummy({ interval: 1, slowPct: 100, slowDur: 100 }), dummy({ interval: 2 }), always(0), true, capAt(10));
  assert.deepEqual(times(r2.log, 'E'), [3, 7]);
  for (const t of [3, 7]) assert.deepEqual(r2.log.filter((e) => e.t === t).map((e) => e.side), ['A', 'E']);
});

test('stun: freezes the target\'s attack bar for its duration', () => {
  const E = dummy({ interval: 4 });
  // A hits once at t=1 (hit roll, damage roll, stun roll), then always misses
  const r = fight(dummy({ interval: 1, stunChance: 100, stunDur: 1.5 }), E, scriptRand([0, 0.5, 0]), true, capAt(20));
  assert.equal(attacks(r.log, 'A')[0].stun, 1.5);
  assert.equal(r.summary.A.stuns, 1);
  close(r.summary.E.stunnedFor, 1.5);
  const tE = times(r.log, 'E');
  close(tE[0], 4 + 1.5); // the quarter-full bar waits 1.5s, then needs the usual 3s
  close(tE[1] - tE[0], 4);
});

test('stun: does not stack, two stuns in a row only extend it to max(until)', () => {
  const E = dummy({ interval: 4 });
  // stuns at t=1 (until 2.5) and t=2 (until 3.5): frozen during [1, 3.5] = 2.5s, not 1.5 + 1.5
  const r = fight(dummy({ interval: 1, stunChance: 100, stunDur: 1.5 }), E, scriptRand([0, 0.5, 0, 0, 0.5, 0]), true, capAt(20));
  assert.equal(r.summary.A.stuns, 2);
  close(r.summary.E.stunnedFor, 2.5);
  close(times(r.log, 'E')[0], 4 + 2.5);
});

test('stun: a stunned side with a full bar waits; stun resistance shortens it and lowers the chance', () => {
  // rand always 0 -> every attack hits and every stun lands
  const quiet = { hp: 200, damage: 1 };
  const base = fight(combatant({ ...quiet }), combatant({ ...quiet }), always(0), true, CFG);
  assert.equal(attacks(base.log, 'E')[0].t, 2);
  // A attacks first at t=2 and stuns E (whose bar is already full) for 1s
  const st = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet }), always(0), true, CFG);
  assert.equal(attacks(st.log, 'A')[0].stun, 1);
  assert.equal(attacks(st.log, 'E')[0].t, 3);
  assert.ok(attacks(st.log, 'E').length < attacks(base.log, 'E').length, 'stunned side attacks less often');
  assert.ok(st.summary.A.stuns > 0);
  assert.ok(st.summary.E.stunnedFor > 0);
  const res = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet, stunDurRed: 50 }), always(0), true, CFG);
  assert.equal(attacks(res.log, 'E')[0].t, 2.5);
  // stun chance reduction: 100% x (1 - 60%) = 40% vs a roll of 50 -> no stun
  const resC = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet, stunChanceRed: 60 }), always(0.5), true, CFG);
  assert.equal(attacks(resC.log, 'E')[0].t, 2);
  assert.equal(resC.summary.A.stuns, 0);
});

// ------------------------------------------------------------------- fight ----
test('fight is deterministic for a seed', () => {
  const adv = adventurerCombatant([item('sword', 'iron', 'B'), item('chest', 'iron', 'B')]);
  const en = enemyCombatant('elite', 3, { ...allLevels('normal'), stunning: 'high', chilling: 'high', piercing: 'low' });
  const a = fight(adv, en, seededRng(42).next, true);
  const b = fight(adv, en, seededRng(42).next, true);
  assert.deepEqual(a, b);
  const c = fight(adv, en, seededRng(43).next, true);
  assert.notDeepEqual(a.log, c.log);
});

test('fight always ends (random stat soup, many seeds)', () => {
  const rng = seededRng(7);
  const rnd = () => combatant({
    hp: rng.float(1, 400), damage: rng.float(0.1, 40), interval: rng.float(0.5, 4), speed: rng.float(-50, 200),
    accuracy: rng.float(1, 300), dodge: rng.float(1, 300), defense: rng.float(0, 100),
    magicPct: rng.float(0, 60), magicRes: rng.float(0, 100), pierce: rng.float(0, 60), pierceRes: rng.float(0, 100),
    stunChance: rng.float(0, 100), stunDur: rng.float(0, 5), stunChanceRed: rng.float(0, 100), stunDurRed: rng.float(0, 100),
    slowPct: rng.float(0, 100), slowDur: rng.float(0, 5), slowRed: rng.float(0, 100), slowDurRed: rng.float(0, 100),
  });
  let wins = 0; let losses = 0;
  for (let i = 0; i < 400; i++) {
    const r = fight(rnd(), rnd(), seededRng(i).next, false, CFG);
    assert.ok(Number.isFinite(r.time) && r.time <= CFG.combat.safetyCapSeconds);
    assert.ok(r.win || r.draw || r.advHp === 0);
    assert.ok(!(r.win && r.draw));
    if (r.win) { wins++; assert.equal(r.enemyHp, 0); assert.ok(r.advHp > 0); }
    else if (!r.draw) losses++;
  }
  assert.ok(wins > 50 && losses > 50);
});

test('fight hits the safety cap -> draw at exactly safetyCapSeconds (nobody can hurt anybody)', () => {
  const r = fight(dummy(), dummy(), seededRng(1).next, true, capAt(100));
  assert.equal(r.draw, true);
  assert.equal(r.win, false);
  assert.equal(r.time, 100);
  assert.equal(r.advHp, 100);
  assert.equal(r.enemyHp, 100);
  assert.ok(r.log.length >= 98 && r.log.every((e) => e.t <= 100));
  // a cap before anybody's first attack: no attacks at all
  const early = fight(dummy(), dummy(), seededRng(1).next, true, capAt(1));
  assert.equal(early.draw, true);
  assert.equal(early.time, 1);
  assert.deepEqual(early.log, []);
});

test('fight log: ordered timeline, HP only goes down, final blow ends it', () => {
  const adv = combatant({ name: 'A', hp: 120, damage: 9, defense: 20, accuracy: 120, speed: 10, magicPct: 15, pierce: 20, stunChance: 10, stunDur: 0.7 });
  const en = combatant({ name: 'E', hp: 150, damage: 8, defense: 25, pierceRes: 20, magicRes: 10, slowPct: 20, slowDur: 2 });
  const r = fight(adv, en, seededRng(5).next, true, CFG);
  assert.ok(r.log.length > 2);
  for (let i = 1; i < r.log.length; i++) {
    assert.ok(r.log[i].t >= r.log[i - 1].t);
    assert.ok(r.log[i].hpA <= r.log[i - 1].hpA + 1e-9);
    assert.ok(r.log[i].hpE <= r.log[i - 1].hpE + 1e-9);
  }
  const last = r.log[r.log.length - 1];
  assert.equal(last.hit, true);
  assert.ok(last.hpA === 0 || last.hpE === 0);
  assert.equal(r.time, last.t);
  assert.equal(r.summary.A.attacks, attacks(r.log, 'A').length);
  assert.equal(r.summary.E.hits, attacks(r.log, 'E').filter((e) => e.hit).length);
  const [lo, hi] = CFG.combat.damageRoll;
  for (const e of r.log.filter((x) => x.hit)) {
    const base = e.side === 'A' ? r.summary.dmgAE.total : r.summary.dmgEA.total;
    assert.ok(e.dmg >= (base * lo) / 100 - 1e-9 && e.dmg <= (base * hi) / 100 + 1e-9, 'damage roll within damageRoll');
    close(e.dmg, e.phys + e.magic);
  }
});

test('fight: magic part of each hit ignores defense, respects magic resistance', () => {
  const att = combatant({ damage: 10, magicPct: 50, accuracy: 1000 });
  const run = (def) => {
    const r = fight(att, combatant({ hp: 1e6, damage: 0, ...def }), seededRng(3).next, true, capAt(60));
    return attacks(r.log, 'A').filter((e) => e.hit);
  };
  for (const e of run({ defense: 0 })) close(e.magic / e.phys, 0.5);
  for (const e of run({ defense: 75 })) close(e.magic / e.phys, 2); // phys 2.5 vs magic 5
  for (const e of run({ defense: 75, magicRes: 50 })) close(e.magic / e.phys, 1);
  const hits = run({ defense: 50, magicRes: 20 });
  assert.ok(hits.length > 10);
  for (const e of hits) close(e.magic / e.phys, 4 / 5);
});

test('fight: piercing raises damage through defense; pierce resistance ignores a % of it', () => {
  const run = (attOver, defOver) => {
    const r = fight(combatant({ damage: 10, accuracy: 1000, ...attOver }), combatant({ hp: 1e6, damage: 0, defense: 50, ...defOver }), seededRng(9).next, true, capAt(40));
    return attacks(r.log, 'A').filter((e) => e.hit).reduce((a, e) => a + e.dmg, 0);
  };
  const plain = run({}, {});
  close(run({ pierce: 40 }, {}) / plain, 7 / 5, 1e-6); // eff. defense 50 -> 30
  close(run({ pierce: 40 }, { pierceRes: 50 }) / plain, 6 / 5, 1e-6); // piercing 40 -> 20, eff. defense 40
  close(run({ pierce: 40 }, { pierceRes: 100 }) / plain, 5.5 / 5, 1e-6); // resistance capped at 75%: piercing 10
  close(run({}, { pierceRes: 40 }) / plain, 1, 1e-6);
});

test('fight: better gear wins more often against the same enemy', () => {
  // a fixed, hand-built enemy so the comparison does not depend on enemy balance numbers
  const en = combatant({ hp: 120, damage: 9, defense: 15, magicPct: 10, pierce: 10 });
  const rate = (gear) => {
    const adv = adventurerCombatant(gear);
    const rng = seededRng(11);
    let w = 0;
    for (let i = 0; i < 300; i++) if (fight(adv, en, rng.next).win) w++;
    return w / 300;
  };
  const unarmed = rate([]);
  const copper = rate([item('sword'), item('chest'), item('helmet')]);
  const mythril = rate(['sword', 'chest', 'helmet', 'gloves', 'boots'].map((s) => item(s, 'mythril', 'S')));
  assert.ok(unarmed < copper, `${unarmed} < ${copper}`);
  assert.ok(copper < mythril, `${copper} < ${mythril}`);
});

test('fight: health ring HP shows up as a higher max HP', () => {
  const r = fight(adventurerCombatant([], { health: 7 }), combatant({ hp: 1, damage: 0 }), always(0), true);
  assert.equal(r.win, true);
  close(r.advHp, CONFIG.adventurer.hp * 1.07);
});

// ------------------------------------------------- Low = none, head start ----
test('a Low special is none at all: Low Chilling never slows, Low Magical deals no magic, Low Stunning never stuns', () => {
  const A = CONFIG.enemies.attributes;
  const lv = allLevels('normal');
  const adv = combatant({ hp: 1e6, damage: 0, accuracy: 100, dodge: 1 });
  // an enemy with every offensive special Low: rand() = 0 makes every possible roll succeed
  const low = enemyCombatant('elite', 1, { ...lv, chilling: 'low', magical: 'low', stunning: 'low', piercing: 'low' });
  assert.equal(low.slowPct, A.chilling.values.low);
  assert.equal(low.magicPct, A.magical.values.low);
  assert.equal(low.stunChance, A.stunning.values.low);
  assert.equal(low.pierce, A.piercing.values.low);
  const r = fight(adv, { ...low, hp: 1e6 }, always(0), true, capAt(60));
  assert.equal(r.summary.E.slows, 0, 'Low Chilling never slows');
  assert.equal(r.summary.E.stuns, 0, 'Low Stunning never stuns');
  const hits = attacks(r.log, 'E').filter((e) => e.hit);
  assert.ok(hits.length > 5);
  for (const e of hits) {
    assert.equal(e.magic, 0, 'Low Magical deals no magic');
    assert.equal(e.slow, undefined);
    assert.equal(e.stun, undefined);
  }
  assert.equal(hitDamage(low, adv, CFG).magic, 0);
  // the same enemy with the special at Normal does have it
  const normal = enemyCombatant('elite', 1, lv);
  assert.ok(normal.slowPct > 0 && normal.magicPct > 0 && normal.stunChance > 0);
  const r2 = fight(adv, { ...normal, hp: 1e6 }, always(0), true, capAt(60));
  assert.ok(r2.summary.E.slows > 0 && r2.summary.E.stuns > 0);
  assert.ok(attacks(r2.log, 'E').some((e) => e.hit && e.magic > 0));
});

test('head start: startFillMax 0 keeps the old timing (first attack one full interval in, no rand() used for it)', () => {
  const noHead = capAt(5);
  const r = fight(dummy(), dummy(), always(0.99), true, noHead);
  assert.deepEqual(times(r.log, 'A').slice(0, 2), [2, 4]);
  assert.deepEqual(times(r.log, 'E').slice(0, 2), [2, 4]);
  // the first rand() value is the first attack's hit roll: the adventurer's 0 hits at once
  const hit = fight(dummy({ damage: 10 }), dummy({ hp: 1000 }), scriptRand([0, 0.5]), true, noHead);
  assert.equal(hit.log[0].side, 'A');
  assert.equal(hit.log[0].hit, true);
});

test('head start: each bar starts a random 0..startFillMax% full; two rand() calls, adventurer first', () => {
  const cfg = capAt(10, { startFillMax: 50 });
  const sf = cfg.combat.startFillMax / 100;
  // rand(): 0.4 then 0.8 -> adventurer bar 0.4 x sf, enemy bar 0.8 x sf; every later attack misses
  const r = fight(dummy(), dummy(), scriptRand([0.4, 0.8]), true, cfg);
  close(times(r.log, 'A')[0], (1 - 0.4 * sf) * 2);
  close(times(r.log, 'E')[0], (1 - 0.8 * sf) * 2);
  close(times(r.log, 'A')[1] - times(r.log, 'A')[0], 2, 'after the first attack the bar fills from empty as usual');
  // always inside [0, startFillMax): the first attack comes between (1 - sf) x interval and one interval in
  for (let seed = 1; seed <= 40; seed++) {
    const q = fight(dummy(), dummy(), seededRng(seed).next, true, cfg);
    for (const side of ['A', 'E']) {
      const t0 = times(q.log, side)[0];
      assert.ok(t0 > (1 - sf) * 2 - 1e-9 && t0 <= 2 + 1e-9, `seed ${seed} ${side}: ${t0}`);
    }
  }
  // a head start of 100% would be a full bar: the first attack happens at t = 0
  const full = fight(dummy(), dummy(), always(1), true, capAt(3, { startFillMax: 100 }));
  assert.equal(times(full.log, 'A')[0], 0);
  // deterministic per rand source, different for another one
  const a = fight(dummy({ damage: 5 }), dummy({ damage: 5 }), seededRng(9).next, true, cfg);
  const b = fight(dummy({ damage: 5 }), dummy({ damage: 5 }), seededRng(9).next, true, cfg);
  assert.deepEqual(a, b);
  const c = fight(dummy({ damage: 5 }), dummy({ damage: 5 }), seededRng(10).next, true, cfg);
  assert.notDeepEqual(a.log, c.log);
});

test('head start: the default config starts the bars partly filled, so the adventurer does not always strike first', () => {
  assert.ok(CONFIG.combat.startFillMax > 0 && CONFIG.combat.startFillMax <= 100);
  let enemyFirst = 0;
  let advFirst = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const r = fight(dummy(), dummy(), seededRng(seed).next, true, cfgWith({ combat: { safetyCapSeconds: 5 } }));
    if (r.log[0].side === 'E') enemyFirst++;
    else advFirst++;
  }
  assert.ok(enemyFirst > 5 && advFirst > 5, `adventurer first ${advFirst}, enemy first ${enemyFirst}`);
});
