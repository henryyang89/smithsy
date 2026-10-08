// Banners and pack mules (core/groups.js) and the pack rules built on them (core/pack.js).
// Fights are decided by the config (WEAK_ENEMIES / DEADLY_ENEMIES), so these tests check the rules, not the balance.
import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, SLOTS } from '../js/config.js';
import { endDay, acknowledgeReport, confirmPlan, validatePlan, serialize, deserialize } from '../js/core/game.js';
import { recordDefeat, groupProgress, newGroups, bannersLine, bannerLabel, groupRewardText } from '../js/core/groups.js';
import { packLimit, defaultPack, leaveWornHome, slotNoun } from '../js/core/pack.js';
import { couldBreak, shownDurability } from '../js/core/gear.js';
import { makeRng } from '../js/core/rng.js';
import { game, cfgWith, addGear, spendAllIntel, WEAK_ENEMIES, DEADLY_ENEMIES } from './helpers.mjs';

const WIN = cfgWith(WEAK_ENEMIES);
const LOSE = cfgWith(DEADLY_ENEMIES);
const DRAW = cfgWith({ combat: { safetyCapSeconds: 0.01 } }); // a cap shorter than any first attack: nobody swings
const WIN_ONE_EACH = cfgWith(WEAK_ENEMIES, { groups: { maxExtraPerType: 1 } }); // each gear type can take one pack mule: rewards are distinct
const BANNERS = Object.keys(CONFIG.groups.list);
const PER = CONFIG.groups.defeatsPerReward;
const MAX_EXTRA = CONFIG.groups.maxExtraPerType;
const total = (g) => Object.values(g.defeats).reduce((a, b) => a + b, 0);

// From the plan phase: fight the first enemy of the roster, put under `group`, with nothing packed. Returns the report.
function fightUnder(s, group, cfg) {
  s.roster.enemies[0].group = group;
  spendAllIntel(s, cfg);
  const c = confirmPlan(s, { enemyIndex: 0, gearIds: [], ringIds: [] }, cfg);
  assert.equal(c.ok, true, c.msg);
  const r = endDay(s, cfg);
  assert.equal(r.ok, true, r.msg);
  if (s.phase === 'report') acknowledgeReport(s);
  return r.report;
}

// A game at the plan phase of day 1 (no fight yet).
function atPlan(seed, cfg) {
  const s = game(seed, cfg);
  assert.equal(endDay(s, cfg).ok, true);
  return s;
}

// ------------------------------------------------------------- banners ----
test('newGroups: a zero counter per configured banner, no pack mules', () => {
  const g = newGroups();
  assert.deepEqual(Object.keys(g.defeats), BANNERS);
  assert.deepEqual(Object.keys(g.extra), SLOTS);
  assert.ok(Object.values(g.defeats).every((n) => n === 0) && Object.values(g.extra).every((n) => n === 0));
  assert.equal(g.earned, 0);
});

test('a win adds one defeat to the enemy\'s banner; a draw or a loss adds nothing', () => {
  const s = atPlan(3, WIN);
  const r = fightUnder(s, BANNERS[1], WIN);
  assert.equal(r.win, true);
  assert.equal(s.groups.defeats[BANNERS[1]], 1);
  assert.equal(total(s.groups), 1);
  assert.equal(r.enemy.group, BANNERS[1], 'the report keeps the banner');
  // a draw
  const d = atPlan(3, DRAW);
  const rd = fightUnder(d, BANNERS[0], DRAW);
  assert.equal(rd.draw, true);
  assert.equal(total(d.groups), 0);
  assert.equal(rd.groupReward, null);
  // a loss
  const l = atPlan(3, LOSE);
  const rl = fightUnder(l, BANNERS[0], LOSE);
  assert.equal(rl.win, false);
  assert.equal(l.phase, 'over');
  assert.equal(total(l.groups), 0);
  assert.equal(rl.groupReward, null);
});

test('a pack mule at every defeatsPerReward-th win against the most-beaten banner: a new random gear type each time', () => {
  const s = atPlan(11, WIN_ONE_EACH);
  const rewards = [];
  for (let n = 1; n <= 2 * PER; n++) {
    const r = fightUnder(s, BANNERS[0], WIN_ONE_EACH);
    assert.equal(s.groups.defeats[BANNERS[0]], n);
    const due = Math.floor(n / PER);
    assert.equal(s.groups.earned, due, `after ${n} wins`);
    if (n % PER === 0) {
      assert.ok(SLOTS.includes(r.groupReward), `the ${n}th win earns a pack mule`);
      assert.equal(r.groupDefeats, n);
      rewards.push(r.groupReward);
    } else assert.equal(r.groupReward, null, `win ${n} earns nothing`);
  }
  assert.equal(rewards.length, 2);
  assert.notEqual(rewards[0], rewards[1], 'distinct types while each type may take only one');
  for (const slot of SLOTS) assert.equal(s.groups.extra[slot], rewards.includes(slot) ? 1 : 0, slot);
});

test('the wins of different banners do not add up: only the most-beaten banner counts', () => {
  const s = atPlan(12, WIN);
  // PER - 1 wins under each banner in turn: no pack mule although the total is far above PER
  for (const b of BANNERS) for (let n = 0; n < PER - 1; n++) fightUnder(s, b, WIN);
  assert.equal(total(s.groups), BANNERS.length * (PER - 1));
  assert.equal(s.groups.earned, 0);
  // one more under the first banner reaches PER
  const r = fightUnder(s, BANNERS[0], WIN);
  assert.equal(s.groups.earned, 1);
  assert.ok(SLOTS.includes(r.groupReward));
});

test('never more than maxExtraPerType per gear type and never more than one per type x limit in all', () => {
  const s = atPlan(21, WIN);
  const cap = SLOTS.length * MAX_EXTRA;
  const seen = [];
  for (let n = 1; n <= PER * (cap + 3); n++) {
    const r = fightUnder(s, BANNERS[0], WIN);
    if (r.groupReward) seen.push(r.groupReward);
    assert.ok(Object.values(s.groups.extra).every((x) => x <= MAX_EXTRA), `after win ${n}`);
    assert.ok(s.groups.earned <= cap);
  }
  assert.equal(s.groups.earned, cap, 'every gear type ends up with its pack mule');
  assert.equal(seen.length, cap, 'one reward per pack mule');
  assert.deepEqual([...seen].sort(), SLOTS.flatMap((slot) => Array(MAX_EXTRA).fill(slot)).sort(), 'every gear type exactly maxExtraPerType times');
});

test('with a higher maxExtraPerType a type can win more than one pack mule, up to the limit', () => {
  const cfg = cfgWith(WEAK_ENEMIES, { groups: { maxExtraPerType: 3, defeatsPerReward: 1 } });
  const g = newGroups(cfg);
  const state = { groups: g };
  const rng = makeRng({ s: 5 });
  const enemy = { group: BANNERS[0] };
  for (let i = 0; i < 40; i++) recordDefeat(state, enemy, rng, cfg);
  assert.equal(g.earned, SLOTS.length * 3);
  assert.ok(Object.values(g.extra).every((n) => n === 3));
  assert.equal(recordDefeat(state, enemy, rng, cfg).reward, null, 'nothing left to give');
});

test('recordDefeat ignores an enemy without a known banner and gives nothing without a win', () => {
  const state = { groups: newGroups() };
  const rng = makeRng({ s: 1 });
  assert.deepEqual(recordDefeat(state, { group: 'purple' }, rng), { reward: null });
  assert.deepEqual(recordDefeat(state, {}, rng), { reward: null });
  assert.equal(total(state.groups), 0);
});

test('the same seed gives the same sequence of pack mule types; another seed can differ', () => {
  const run = (seed) => {
    const s = atPlan(seed, WIN);
    const out = [];
    for (let n = 1; n <= PER * SLOTS.length; n++) {
      const r = fightUnder(s, BANNERS[0], WIN);
      if (r.groupReward) out.push(r.groupReward);
    }
    return out;
  };
  const a = run(31);
  assert.deepEqual(run(31), a);
  assert.equal(a.length, SLOTS.length);
  const others = [32, 33, 34, 35, 36].map(run);
  assert.ok(others.some((o) => o.join() !== a.join()), 'the order is random');
});

test('the report and the log say what the pack mule gives; report.groupLimit is the new pack limit', () => {
  const s = atPlan(41, WIN);
  let rep = null;
  for (let n = 1; n <= PER; n++) rep = fightUnder(s, BANNERS[2], WIN);
  assert.ok(rep.groupReward);
  assert.equal(rep.groupLimit, CONFIG.plan.perSlot + 1);
  assert.equal(rep.groupLimit, packLimit(s, rep.groupReward));
  const text = groupRewardText(rep);
  assert.ok(text.includes(CONFIG.groups.list[BANNERS[2]].name) && text.includes(`lost ${PER} fighters`) && text.includes(`pack ${rep.groupLimit} ${slotNoun(rep.groupReward, rep.groupLimit)}`), text);
  assert.ok(s.log.some((l) => l.text === text), 'the log says it too');
  // the report of a win without a reward has no banner text values
  const r2 = fightUnder(s, BANNERS[2], WIN);
  assert.equal(r2.groupReward, null);
  assert.equal(r2.groupDefeats, null);
  assert.equal(r2.groupLimit, null);
});

test('groupProgress: wins per banner, the most-beaten banner, the next pack mule and how far away it is', () => {
  const s = game(5, WIN);
  let p = groupProgress(s);
  assert.deepEqual(p.defeats, Object.fromEntries(BANNERS.map((b) => [b, 0])));
  assert.equal(p.top, null);
  assert.equal(p.next, PER);
  assert.equal(p.toGo, PER);
  assert.equal(p.earned, 0);
  s.groups.defeats[BANNERS[0]] = PER + 1;
  s.groups.defeats[BANNERS[1]] = 2;
  s.groups.earned = 1;
  s.groups.extra.chest = 1;
  p = groupProgress(s);
  assert.equal(p.top, BANNERS[0]);
  assert.equal(p.next, 2 * PER);
  assert.equal(p.toGo, 2 * PER - (PER + 1));
  assert.equal(p.extra.chest, 1);
  assert.equal(p.full, false);
  // exactly on a multiple: the next one is a full step away
  s.groups.defeats[BANNERS[0]] = 2 * PER;
  assert.equal(groupProgress(s).toGo, PER);
  // every gear type has its pack mule
  s.groups.earned = SLOTS.length * MAX_EXTRA;
  p = groupProgress(s);
  assert.equal(p.full, true);
  assert.equal(p.next, null);
  assert.equal(p.toGo, null);
});

test('bannersLine reads like the plan: wins per banner, the next pack mule, the pack mules so far', () => {
  const s = game(5, WIN);
  assert.match(bannersLine(s), /^Banners beaten: .*0.*\. Next pack mule at \d+ from one banner \(\d+ more\)\. Pack mules: none yet\.$/);
  s.groups.defeats[BANNERS[0]] = PER + 1;
  s.groups.defeats[BANNERS[1]] = 2;
  s.groups.earned = 1;
  s.groups.extra.sword = 1;
  const line = bannersLine(s);
  assert.ok(line.includes(`${bannerLabel(BANNERS[0])} ${PER + 1}`) && line.includes(`${bannerLabel(BANNERS[1])} 2`), line);
  assert.ok(line.includes(`Next pack mule at ${2 * PER} from one banner (${PER - 1} more ${bannerLabel(BANNERS[0])})`), line);
  assert.ok(line.includes('Pack mules: +1 sword.'), line);
});

test('a save keeps the banners: groups, and every enemy\'s group and groupRoll', () => {
  const s = atPlan(8, WIN);
  fightUnder(s, BANNERS[1], WIN);
  const back = deserialize(serialize(s));
  assert.deepEqual(back.groups, s.groups);
  assert.deepEqual(back.roster.enemies.map((e) => [e.group, e.groupRoll]), s.roster.enemies.map((e) => [e.group, e.groupRoll]));
  assert.deepEqual(back, s);
  // a save without the banners (or with other banners) is not this version's save
  const broken = JSON.parse(serialize(s));
  delete broken.groups;
  assert.throws(() => deserialize(JSON.stringify(broken)));
  const other = JSON.parse(serialize(s));
  delete other.groups.defeats[BANNERS[0]];
  assert.throws(() => deserialize(JSON.stringify(other)));
});

// ---------------------------------------------------------------- pack ----
test('packLimit: perSlot, plus the pack mules of that gear type', () => {
  const s = game(1);
  for (const slot of SLOTS) assert.equal(packLimit(s, slot), CONFIG.plan.perSlot, slot);
  s.groups.extra.sword = 1;
  assert.equal(packLimit(s, 'sword'), CONFIG.plan.perSlot + 1);
  assert.equal(packLimit(s, 'chest'), CONFIG.plan.perSlot, 'other types are unchanged');
  assert.equal(packLimit(s, 'sword', cfgWith({ plan: { perSlot: 4 } })), 5, 'perSlot comes from the config');
  assert.equal(packLimit({}, 'sword'), CONFIG.plan.perSlot, 'a state without banners has no pack mules');
});

test('validatePlan: three swords are refused without a sword pack mule and allowed with one; the message names the limit', () => {
  const s = atPlan(2);
  const swords = [addGear(s, 'sword'), addGear(s, 'sword'), addGear(s, 'sword')];
  const ids = swords.map((g) => g.id);
  const p = { enemyIndex: 0, gearIds: ids, ringIds: [] };
  assert.equal(validatePlan(s, p), `At most ${CONFIG.plan.perSlot} swords.`);
  assert.equal(confirmPlan(s, p).ok, false);
  s.groups.extra.sword = 1;
  assert.equal(validatePlan(s, p), null);
  assert.equal(confirmPlan(s, p).ok, true);
  assert.equal(slotNoun('gloves', 3), 'pairs of gloves');
  assert.equal(slotNoun('sword', 1), 'sword');
});

test('defaultPack: the best packLimit items per type, a pack mule adds one more', () => {
  const s = game(3);
  const [a, b, c] = [addGear(s, 'sword', 'iron', 'C'), addGear(s, 'sword', 'copper', 'S'), addGear(s, 'sword', 'copper', 'D')];
  assert.deepEqual(defaultPack(s), [a.id, b.id].slice(0, CONFIG.plan.perSlot), 'iron C beats copper S beats copper D');
  s.groups.extra.sword = 1;
  const three = defaultPack(s);
  assert.deepEqual(three, [a.id, b.id, c.id].slice(0, packLimit(s, 'sword')));
  // ties: the higher gem grade, then the more durable, then the lower id
  const t = game(4);
  const plain = addGear(t, 'chest', 'iron', 'B');
  const gem = addGear(t, 'chest', 'iron', 'B', { type: 'ruby', grade: 'C' });
  const worn = addGear(t, 'chest', 'iron', 'B', null, { durability: 80 });
  t.groups.extra.chest = 1;
  assert.deepEqual(defaultPack(t), [gem.id, plain.id, worn.id].slice(0, packLimit(t, 'chest')));
});

test('defaultPack skips an item that could break while the type has another one, and keeps it when it is the only one', () => {
  const s = game(6);
  const worn = addGear(s, 'chest', 'mythril', 'S', null, { durability: 1 });
  assert.equal(couldBreak(worn, s, null), true);
  assert.deepEqual(defaultPack(s), [worn.id], 'the only chest is packed although it could break');
  const sturdy = addGear(s, 'chest', 'copper', 'D');
  assert.equal(couldBreak(sturdy, s, null), false);
  assert.deepEqual(defaultPack(s), [sturdy.id], 'the weaker but safe chest is packed instead');
  // two items that could both break: the best ones are packed anyway
  const t = game(7);
  const w1 = addGear(t, 'boots', 'iron', 'C', null, { durability: 2 });
  const w2 = addGear(t, 'boots', 'copper', 'D', null, { durability: 3 });
  assert.deepEqual(defaultPack(t), [w1.id, w2.id]);
  // the tier decides: a mid-level item is fine against a normal enemy and could break against a champion
  const u = game(8);
  const wear = (tier) => couldBreak({ durability: 100 }, u, tier);
  assert.equal(wear('normal'), false);
  const mid = addGear(u, 'helmet', 'copper', 'D', null, { durability: 13 });
  const other = addGear(u, 'helmet', 'copper', 'D', null, { durability: 100 });
  const dl = CONFIG.gear.durabilityLoss;
  const loss = (tier) => Math.round(dl.max * ((dl.tierMult || {})[tier] || 1) * 10) / 10;
  const expectSkip = (tier) => loss(tier) >= mid.durability - 1e-9;
  assert.equal(defaultPack(u, CONFIG, 'normal').includes(mid.id), !expectSkip('normal'));
  assert.equal(defaultPack(u, CONFIG, 'champion').includes(mid.id), !expectSkip('champion'));
  assert.ok(defaultPack(u, CONFIG, 'champion').includes(other.id));
});

test('leaveWornHome: takes out worn items the stock can repair, but keeps the best item of every type that had one', () => {
  const s = game(9);
  const below = CONFIG.plan.leaveHomeBelow;
  // pick a durability that is below the limit whatever the config says
  const low = Math.max(1, below - 10);
  const ok = Math.min(100, below + 10);
  s.storage.bars['copper:D'] = 20;
  s.storage.bars['iron:C'] = 0;
  const swordWorn = addGear(s, 'sword', 'copper', 'D', null, { durability: low });
  const swordGood = addGear(s, 'sword', 'copper', 'D', null, { durability: ok });
  const chest1 = addGear(s, 'chest', 'copper', 'D', null, { durability: low });
  const chest2 = addGear(s, 'chest', 'copper', 'D', null, { durability: low - 1 || 1 });
  const helmet = addGear(s, 'helmet', 'copper', 'D', null, { durability: low });
  const boots = addGear(s, 'boots', 'iron', 'C', null, { durability: low }); // no iron C bars: cannot be repaired
  const ids = [swordWorn, swordGood, chest1, chest2, helmet, boots].map((g) => g.id);
  const out = leaveWornHome(s, ids);
  assert.ok(shownDurability(low) < below);
  assert.equal(out.includes(swordWorn.id), false, 'a worn sword with a spare at home goes home');
  assert.equal(out.includes(swordGood.id), true);
  assert.equal(out.filter((id) => [chest1.id, chest2.id].includes(id)).length, 1, 'both chests are worn: the best one stays');
  assert.equal(out.includes(helmet.id), true, 'the only helmet stays');
  assert.equal(out.includes(boots.id), true, 'boots that cannot be repaired stay');
  // the input is not changed and nothing is unpacked in the game state
  assert.equal(ids.length, 6);
  assert.ok(s.gear.every((g) => g.packed === false));
  // nothing worn: nothing changes
  const fresh = game(10);
  const f = [addGear(fresh, 'sword'), addGear(fresh, 'chest')];
  assert.deepEqual(leaveWornHome(fresh, f.map((g) => g.id)).sort(), f.map((g) => g.id).sort());
  assert.deepEqual(leaveWornHome(fresh, []), []);
});
