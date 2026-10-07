import { CONFIG } from '../config.js';
import { clamp } from './util.js';
import { gearStats } from './gear.js';

const ZERO = {
  speed: 0, defense: 0, magicPct: 0, magicRes: 0, pierce: 0, pierceRes: 0,
  stunChance: 0, stunDur: 0, stunChanceRed: 0, stunDurRed: 0,
  slowPct: 0, slowDur: 0, slowRed: 0, slowDurRed: 0,
};

// Adventurer combat stats from equipped gear (max 1 per slot) and adventurer ring totals.
export function adventurerCombatant(gearItems, ringTotals = {}, cfg = CONFIG) {
  const a = cfg.adventurer;
  const c = { name: 'Adventurer', ...ZERO, hp: a.hp, damage: a.unarmedDamage, interval: a.attackInterval, accuracy: a.accuracy, dodge: a.dodge };
  for (const item of gearItems) {
    const s = gearStats(item, cfg);
    for (const [k, v] of Object.entries(s)) {
      if (k === 'damage') c.damage = v; // a sword replaces unarmed damage
      else c[k] = (c[k] || 0) + v;
    }
  }
  const r = (k) => ringTotals[k] || 0;
  c.pierce += r('pierce');
  c.pierceRes += r('pierceRes');
  c.magicPct += r('magicDmg');
  c.magicRes += r('magicRes');
  c.stunChanceRed += r('stunRes');
  c.stunDurRed += r('stunRes');
  c.accuracy += r('accuracy');
  c.dodge += r('dodge');
  c.slowRed += r('slowRes');
  c.slowDurRed += r('slowRes');
  c.speed += r('speed');
  c.hp *= 1 + r('health') / 100;
  return c;
}

// S-curve hit chance: acc^2 / (acc^2 + k * dodge^2), clamped. Returns 0..1.
export function hitChance(acc, dodge, cfg = CONFIG) {
  const a = Math.max(1, acc);
  const d = Math.max(1, dodge);
  const p = (a * a) / (a * a + cfg.combat.hitK * d * d);
  return clamp(p, cfg.combat.minHitPct / 100, cfg.combat.maxHitPct / 100);
}

// Seconds between attacks (attack bar fill time) when not stunned.
export function attackInterval(c, slowed, slowPct) {
  return (c.interval / (1 + c.speed / 100)) * (slowed ? 1 + slowPct / 100 : 1);
}

// Expected damage of one landed hit (no damage roll) — used for display.
export function hitDamage(att, def, cfg = CONFIG) {
  const capD = cfg.combat.defenseCap;
  const capR = cfg.combat.resistCap;
  // piercing ignores part of the target's defense; pierce resistance ignores part of the piercing
  const pierce = clamp(att.pierce, 0, 100) * (1 - Math.min(def.pierceRes, capR) / 100);
  const effDef = Math.min(def.defense, capD) * (1 - pierce / 100);
  const phys = att.damage * (1 - effDef / 100);
  const magic = att.damage * (att.magicPct / 100) * (1 - Math.min(def.magicRes, capR) / 100);
  return { phys, magic, total: phys + magic, effDef };
}

function fighter(c, side) {
  return {
    c, side, hp: c.hp,
    meter: 0, // attack bar 0..1; attacks when full
    baseRate: (1 + c.speed / 100) / c.interval, // bar per second when not slowed or stunned
    stunUntil: 0, slowPct: 0, slowUntil: 0,
    st: { attacks: 0, hits: 0, dmg: 0, stuns: 0, slows: 0, stunnedFor: 0 },
  };
}

const TINY = 1e-9;

// Attack-bar fill rate at time t: 0 while stunned, divided by (1 + slow%) while slowed.
function barRate(f, t) {
  if (t < f.stunUntil - TINY) return 0;
  return t < f.slowUntil - TINY ? f.baseRate / (1 + f.slowPct / 100) : f.baseRate;
}

// Next moment this fighter's situation changes: bar full, stun ends, or slow ends.
function nextChange(f, t) {
  let n = Infinity;
  if (f.stunUntil > t + TINY) n = f.stunUntil;
  if (f.slowUntil > t + TINY) n = Math.min(n, f.slowUntil);
  const r = barRate(f, t);
  if (r > 0) n = Math.min(n, t + Math.max(0, 1 - f.meter) / r);
  return n;
}

// Simulate one fight. rand() -> [0,1). Returns { win, draw, time, advHp, enemyHp, log?, summary }.
// Each side has an attack bar that fills in interval / (1 + speed%) seconds and attacks when full.
// Slowed by X%: the bar fills X% slower. Stunned: the bar stops filling. Ties: adventurer first.
export function fight(adv, enemy, rand, withLog = false, cfg = CONFIG) {
  const capR = cfg.combat.resistCap;
  const [rollLo, rollHi] = cfg.combat.damageRoll;
  const A = fighter(adv, 'A');
  const E = fighter(enemy, 'E');
  const hitAE = hitChance(adv.accuracy, enemy.dodge, cfg);
  const hitEA = hitChance(enemy.accuracy, adv.dodge, cfg);
  const dmgAE = hitDamage(adv, enemy, cfg);
  const dmgEA = hitDamage(enemy, adv, cfg);
  const log = withLog ? [] : null;
  let t = 0;
  let winner = null;

  const attack = (att, def) => {
    const aSide = att === A;
    att.meter = 0;
    att.st.attacks++;
    const p = aSide ? hitAE : hitEA;
    const entry = withLog ? { t, side: att.side, hit: false, hitPct: p * 100 } : null;
    if (rand() < p) {
      const base = aSide ? dmgAE : dmgEA;
      const roll = (rollLo + rand() * (rollHi - rollLo)) / 100;
      const phys = base.phys * roll;
      const magic = base.magic * roll;
      const dmg = phys + magic;
      def.hp -= dmg;
      att.st.hits++;
      att.st.dmg += dmg;
      if (entry) Object.assign(entry, { hit: true, phys, magic, dmg });
      // stun: target's attack bar stops filling for the duration (does not stack; refreshes)
      if (att.c.stunChance > 0) {
        const sc = att.c.stunChance * (1 - Math.min(def.c.stunChanceRed, capR) / 100);
        if (rand() * 100 < sc) {
          const dur = att.c.stunDur * (1 - Math.min(def.c.stunDurRed, capR) / 100);
          const until = Math.max(def.stunUntil, t + dur);
          def.st.stunnedFor += until - Math.max(def.stunUntil, t);
          def.stunUntil = until;
          att.st.stuns++;
          if (entry) entry.stun = dur;
        }
      }
      // slow: target's attack bar fills slower for the duration (does not stack; strongest wins, refreshes)
      if (att.c.slowPct > 0) {
        const sp = att.c.slowPct * (1 - Math.min(def.c.slowRed, capR) / 100);
        const sd = att.c.slowDur * (1 - Math.min(def.c.slowDurRed, capR) / 100);
        if (sp > 0 && sd > 0) {
          def.slowPct = t < def.slowUntil - TINY ? Math.max(def.slowPct, sp) : sp;
          def.slowUntil = Math.max(def.slowUntil, t + sd);
          att.st.slows++;
          if (entry) entry.slow = { pct: sp, dur: sd };
        }
      }
    }
    if (entry) {
      entry.hpA = Math.max(0, A.hp);
      entry.hpE = Math.max(0, E.hp);
      log.push(entry);
    }
    if (def.hp <= 0) winner = att.side;
  };

  while (!winner) {
    const T = Math.min(nextChange(A, t), nextChange(E, t));
    if (!Number.isFinite(T) || T > cfg.combat.safetyCapSeconds) {
      t = cfg.combat.safetyCapSeconds; // nobody can finish: draw at the safety cap
      break;
    }
    const rA = barRate(A, t);
    const rE = barRate(E, t);
    A.meter += (T - t) * rA;
    E.meter += (T - t) * rE;
    t = T;
    const ready = (f) => f.meter >= 1 - TINY && t >= f.stunUntil - TINY;
    if (ready(A)) attack(A, E);
    if (!winner && ready(E)) attack(E, A);
  }
  return {
    win: winner === 'A',
    draw: winner === null,
    time: t,
    advHp: Math.max(0, A.hp),
    enemyHp: Math.max(0, E.hp),
    log,
    summary: withLog ? { A: A.st, E: E.st, hitAE, hitEA, dmgAE, dmgEA } : null,
  };
}
