import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../js/config.js';
import { seededRng } from '../js/core/rng.js';
import { adventurerCombatant, hitChance, attackInterval, hitDamage, fight } from '../js/core/combat.js';
import { enemyCombatant } from '../js/core/enemies.js';
import { cfgWith, combatant, approx, allLevels } from './helpers.mjs';

const item = (slot, material = 'copper', grade = 'D', gem = null) => ({ id: Math.random(), slot, material, grade, gem, durability: 100, packed: false });
const close = (a, b, epsOrMsg) => {
  const eps = typeof epsOrMsg === 'number' ? epsOrMsg : 1e-9;
  assert.ok(approx(a, b, eps), `${a} != ${b}${typeof epsOrMsg === 'string' ? ` (${epsOrMsg})` : ''}`);
};
const always = (v) => () => v;
const attacks = (log, side) => log.filter((e) => e.side === side);

// ---------------------------------------------------------------- hit chance --
test('hitChance S-curve: 80% at parity, ~94.1% at 2x accuracy, 50% at half', () => {
  close(hitChance(100, 100), 0.8);
  close(hitChance(250, 250), 0.8);
  close(hitChance(200, 100), 4 / 4.25);
  assert.ok(Math.abs(hitChance(200, 100) - 0.941) < 0.001);
  close(hitChance(50, 100), 0.5);
});

test('hitChance clamps to 5%..95% and treats ratings below 1 as 1', () => {
  assert.equal(hitChance(1, 1000), 0.05);
  assert.equal(hitChance(1000, 1), 0.95);
  assert.equal(hitChance(400, 100), 0.95); // 16/16.25 = 98.5% -> capped
  assert.equal(hitChance(0, 0), 0.8);
  assert.equal(hitChance(-50, 100), 0.05);
});

test('hitChance has diminishing returns', () => {
  const g1 = hitChance(150, 100) - hitChance(100, 100);
  const g2 = hitChance(200, 100) - hitChance(150, 100);
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

test('hitDamage: defense reduces physical damage, capped at 75%', () => {
  const att = combatant({ damage: 20 });
  close(hitDamage(att, combatant({ defense: 25 })).phys, 15);
  close(hitDamage(att, combatant({ defense: 90 })).phys, 5); // capped at 75%
  close(hitDamage(att, combatant({ defense: 0 })).total, 20);
});

test('piercing ignores part of the defense, reduced by the defender\'s pierce resistance', () => {
  const def = combatant({ defense: 50, pierceRes: 10 });
  const h = hitDamage(combatant({ damage: 10, pierce: 30 }), def);
  close(h.effDef, 40); // pierce 30 - 10 = 20% of 50 ignored
  close(h.phys, 6);
  // resistance above piercing -> no negative piercing
  close(hitDamage(combatant({ damage: 10, pierce: 5 }), def).effDef, 50);
  // piercing applies to the capped defense
  close(hitDamage(combatant({ damage: 10, pierce: 20 }), combatant({ defense: 100 })).effDef, 60);
});

test('magic damage ignores defense but is reduced by magic resistance (capped at 75%)', () => {
  const att = combatant({ damage: 10, magicPct: 50 });
  close(hitDamage(att, combatant({ defense: 0 })).magic, 5);
  close(hitDamage(att, combatant({ defense: 75 })).magic, 5, 'defense does not touch magic');
  close(hitDamage(att, combatant({ defense: 75 })).phys, 2.5);
  close(hitDamage(att, combatant({ magicRes: 40 })).magic, 3);
  close(hitDamage(att, combatant({ magicRes: 100 })).magic, 1.25);
  close(hitDamage(att, combatant({ magicRes: 40 })).phys, 10, 'magic resistance does not touch physical');
});

// ------------------------------------------------------- adventurer stats ----
test('adventurerCombatant: unarmed base stats', () => {
  const a = adventurerCombatant([]);
  assert.equal(a.hp, CONFIG.adventurer.hp);
  assert.equal(a.damage, CONFIG.adventurer.unarmedDamage);
  assert.equal(a.interval, CONFIG.adventurer.attackInterval);
  assert.equal(a.accuracy, 100);
  assert.equal(a.dodge, 100);
  assert.equal(a.defense, 0);
  assert.equal(a.speed, 0);
});

test('adventurerCombatant: sword replaces unarmed damage; gear stats add up', () => {
  const a = adventurerCombatant([item('sword', 'iron', 'D'), item('gloves'), item('boots'), item('chest'), item('helmet')]);
  close(a.damage, 15, 'not 15 + 4');
  close(a.accuracy, 100 + 15 + 10);
  close(a.dodge, 110);
  close(a.speed, 3);
  close(a.defense, 6 + 4 + 2 + 2);
  const gemmed = adventurerCombatant([item('sword', 'copper', 'D', { type: 'diamond', grade: 'S' }), item('chest', 'copper', 'D', { type: 'ruby', grade: 'S' })]);
  close(gemmed.pierce, 30);
  close(gemmed.magicRes, 15);
});

test('adventurerCombatant: adventurer rings add their stats; health ring scales HP', () => {
  const rings = { pierce: 7, pierceRes: 3, magicDmg: 5, magicRes: 4, stunRes: 10, accuracy: 9, dodge: 8, slowRes: 6, speed: 4, health: 7 };
  const a = adventurerCombatant([], rings);
  close(a.hp, 107);
  assert.equal(a.pierce, 7);
  assert.equal(a.pierceRes, 3);
  assert.equal(a.magicPct, 5);
  assert.equal(a.magicRes, 4);
  assert.equal(a.stunChanceRed, 10);
  assert.equal(a.stunDurRed, 10);
  assert.equal(a.accuracy, 109);
  assert.equal(a.dodge, 108);
  assert.equal(a.slowRed, 6);
  assert.equal(a.slowDurRed, 6);
  assert.equal(a.speed, 4);
  // smith ring keys are ignored
  assert.deepEqual(adventurerCombatant([], { travelTime: 10 }), adventurerCombatant([]));
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
    magicPct: rng.float(0, 60), magicRes: rng.float(0, 100), pierce: rng.float(0, 60), pierceRes: rng.float(0, 30),
    stunChance: rng.float(0, 100), stunDur: rng.float(0, 5), stunChanceRed: rng.float(0, 100), stunDurRed: rng.float(0, 100),
    slowPct: rng.float(0, 100), slowDur: rng.float(0, 5), slowRed: rng.float(0, 100), slowDurRed: rng.float(0, 100),
  });
  let wins = 0; let losses = 0;
  for (let i = 0; i < 400; i++) {
    const r = fight(rnd(), rnd(), seededRng(i).next);
    assert.ok(Number.isFinite(r.time));
    assert.ok(r.win || r.draw || r.advHp === 0);
    assert.ok(!(r.win && r.draw));
    if (r.win) { wins++; assert.equal(r.enemyHp, 0); assert.ok(r.advHp > 0); }
    else if (!r.draw) losses++;
  }
  assert.ok(wins > 50 && losses > 50);
});

test('fight hits the safety cap -> draw (nobody can hurt anybody)', () => {
  const cfg = cfgWith({ combat: { safetyCapSeconds: 100 } });
  const r = fight(combatant({ damage: 0 }), combatant({ damage: 0 }), seededRng(1).next, false, cfg);
  assert.equal(r.draw, true);
  assert.equal(r.win, false);
  assert.ok(r.time > 100 && r.time <= 102);
  assert.equal(r.advHp, 100);
});

test('fight log: alternating timeline, HP only goes down, final blow ends it', () => {
  const adv = adventurerCombatant([item('sword', 'steel', 'B')]);
  const en = enemyCombatant('normal', 1, allLevels('normal'));
  const r = fight(adv, en, seededRng(5).next, true);
  assert.ok(r.log.length > 2);
  for (let i = 1; i < r.log.length; i++) {
    assert.ok(r.log[i].t >= r.log[i - 1].t);
    assert.ok(r.log[i].hpA <= r.log[i - 1].hpA + 1e-9);
    assert.ok(r.log[i].hpE <= r.log[i - 1].hpE + 1e-9);
  }
  const last = r.log[r.log.length - 1];
  assert.equal(last.hit, true);
  assert.ok(last.hpA === 0 || last.hpE === 0);
  assert.equal(r.summary.A.attacks, attacks(r.log, 'A').length);
  assert.equal(r.summary.E.hits, attacks(r.log, 'E').filter((e) => e.hit).length);
  for (const e of r.log.filter((x) => x.hit)) {
    const base = e.side === 'A' ? r.summary.dmgAE.total : r.summary.dmgEA.total;
    assert.ok(e.dmg >= base * 0.9 - 1e-9 && e.dmg <= base * 1.1 + 1e-9, 'damage roll 90%-110%');
  }
});

test('fight: magic part of each hit ignores defense, respects magic resistance', () => {
  const att = combatant({ damage: 10, magicPct: 50, accuracy: 1000 });
  const run = (def) => {
    const r = fight(att, combatant({ hp: 1e6, damage: 0, ...def }), seededRng(3).next, true, cfgWith({ combat: { safetyCapSeconds: 60 } }));
    return attacks(r.log, 'A').filter((e) => e.hit);
  };
  for (const e of run({ defense: 0 })) close(e.magic / e.phys, 0.5);
  for (const e of run({ defense: 75 })) close(e.magic / e.phys, 2); // phys 2.5 vs magic 5
  for (const e of run({ defense: 75, magicRes: 50 })) close(e.magic / e.phys, 1);
  const hits = run({ defense: 50, magicRes: 20 });
  for (const e of hits) close(e.magic / e.phys, 4 / 5);
});

test('fight: piercing raises damage through defense (minus pierce resistance)', () => {
  const run = (attOver, defOver) => {
    const r = fight(combatant({ damage: 10, accuracy: 1000, ...attOver }), combatant({ hp: 1e6, damage: 0, defense: 50, ...defOver }), seededRng(9).next, true, cfgWith({ combat: { safetyCapSeconds: 40 } }));
    return attacks(r.log, 'A').filter((e) => e.hit).reduce((a, e) => a + e.dmg, 0);
  };
  const plain = run({}, {});
  const pierced = run({ pierce: 40 }, {});
  const resisted = run({ pierce: 40 }, { pierceRes: 40 });
  close(pierced / plain, 7 / 5, 1e-6); // eff. defense 50 -> 30
  close(resisted / plain, 1, 1e-6);
});

test('fight: a stun delays the target\'s next attack (stun resistance shortens it)', () => {
  // rand always 0 -> every attack hits and every stun lands
  const quiet = { hp: 200, damage: 1 };
  const base = fight(combatant({ ...quiet }), combatant({ ...quiet }), always(0), true);
  assert.equal(attacks(base.log, 'E')[0].t, 2);
  const st = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet }), always(0), true);
  assert.equal(attacks(st.log, 'A')[0].stun, 1);
  assert.equal(attacks(st.log, 'E')[0].t, 3);
  assert.ok(attacks(st.log, 'E').length < attacks(base.log, 'E').length, 'stunned side attacks less often');
  assert.ok(st.summary.A.stuns > 0);
  assert.ok(st.summary.E.stunnedFor > 0);
  const res = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet, stunDurRed: 50 }), always(0), true);
  assert.equal(attacks(res.log, 'E')[0].t, 2.5);
  // stun chance reduction: 100% x (1 - 60%) = 40% vs a roll of 50 -> no stun
  const resC = fight(combatant({ ...quiet, stunChance: 100, stunDur: 1 }), combatant({ ...quiet, stunChanceRed: 60 }), always(0.5), true);
  assert.equal(attacks(resC.log, 'E')[0].t, 2);
  assert.equal(resC.summary.A.stuns, 0);
});

test('fight: a slow lengthens the target\'s attack interval (slow resistance weakens it)', () => {
  const quiet = { hp: 200, damage: 1 };
  const times = (r) => attacks(r.log, 'E').slice(0, 3).map((e) => e.t);
  const base = fight(combatant(quiet), combatant(quiet), always(0), true);
  assert.deepEqual(times(base), [2, 4, 6]);
  // A hits at t=2 first (ties go to the adventurer), slowing E by 50% for 10s
  const sl = fight(combatant({ ...quiet, slowPct: 50, slowDur: 10 }), combatant(quiet), always(0), true);
  assert.deepEqual(attacks(sl.log, 'A')[0].slow, { pct: 50, dur: 10 });
  assert.deepEqual(times(sl), [2, 5, 8]);
  const res = fight(combatant({ ...quiet, slowPct: 50, slowDur: 10 }), combatant({ ...quiet, slowRed: 50, slowDurRed: 50 }), always(0), true);
  assert.deepEqual(times(res), [2, 4.5, 7]);
  assert.deepEqual(attacks(res.log, 'A')[0].slow, { pct: 25, dur: 5 });
});

test('fight: better gear wins more often against the same enemy', () => {
  const en = enemyCombatant('elite', 2, allLevels('normal'));
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
  assert.ok(mythril > 0.99);
});

test('fight: health ring HP shows up as a higher max HP', () => {
  const r = fight(adventurerCombatant([], { health: 7 }), combatant({ hp: 1, damage: 0 }), always(0), true);
  assert.equal(r.win, true);
  close(r.advHp, 107);
});
