// Banners and pack mules. Every enemy marches under one of the banners in config groups.list (random, no effect on its
// attributes). For every groups.defeatsPerReward wins against the banner the adventurer has beaten most, it captures a
// pack mule: from then on it can pack 1 more item of one gear type (random; each type at most maxExtraPerType times).
// The state is state.groups = { defeats: { red, black, gold }, extra: { sword, chest, ... }, earned }.
import { CONFIG, SLOTS } from '../config.js';
import { slotNoun } from './pack.js';

export function newGroups(cfg = CONFIG) {
  return {
    defeats: Object.fromEntries(Object.keys(cfg.groups.list).map((k) => [k, 0])),
    extra: Object.fromEntries(SLOTS.map((s) => [s, 0])),
    earned: 0,
  };
}

// "Red" for the Red Banner (the colour chip and the running text).
export const bannerLabel = (key, cfg = CONFIG) => {
  const g = cfg.groups.list[key];
  return g ? g.name.replace(/\s*Banner$/, '') : String(key);
};

const maxSlots = (cfg) => SLOTS.length * cfg.groups.maxExtraPerType;
const mostBeaten = (defeats) => Math.max(0, ...Object.values(defeats));

// A win over `enemy`: one more defeat for its banner, and a pack mule when the most-beaten banner reaches the next
// multiple of defeatsPerReward. The slot is picked with the game's rng among the types that can still take one.
// Never taken back. Returns { reward: slot | null }. Only a win calls this (resolveBattle); a draw or loss counts nothing.
export function recordDefeat(state, enemy, rng, cfg = CONFIG) {
  const g = state.groups;
  if (!g || !enemy || !(enemy.group in g.defeats)) return { reward: null };
  g.defeats[enemy.group] += 1;
  const due = Math.min(maxSlots(cfg), Math.floor(mostBeaten(g.defeats) / Math.max(1, cfg.groups.defeatsPerReward)));
  let reward = null;
  while (g.earned < due) {
    const open = SLOTS.filter((s) => g.extra[s] < cfg.groups.maxExtraPerType);
    if (!open.length) break;
    const slot = rng.pick(open);
    g.extra[slot] += 1;
    g.earned += 1;
    reward = slot;
  }
  return { reward };
}

// Numbers for the "Banners beaten" line: wins per banner, the most-beaten banner (null while none is beaten), the win
// count of one banner at which the next pack mule comes (null when every gear type has one), how many more wins that
// is, and the extra slots so far.
export function groupProgress(state, cfg = CONFIG) {
  const g = state.groups;
  const defeats = { ...g.defeats };
  const max = mostBeaten(defeats);
  const top = max > 0 ? Object.keys(defeats).find((k) => defeats[k] === max) : null;
  const full = g.earned >= maxSlots(cfg);
  const per = Math.max(1, cfg.groups.defeatsPerReward);
  const next = full ? null : (Math.floor(max / per) + 1) * per;
  return { defeats, top, next, toGo: next == null ? null : next - max, extra: { ...g.extra }, earned: g.earned, full };
}

// The banner's win/lose text for the pack-mule reward of a report (resolveBattle stores groupReward, groupDefeats and
// groupLimit): "The Red Banner has now lost 8 fighters to your adventurer. They capture a pack mule: from now on the
// adventurer can pack 3 swords."
export function groupRewardText(report, cfg = CONFIG) {
  const g = cfg.groups.list[report.enemy.group];
  return `The ${g ? g.name : 'banner'} has now lost ${report.groupDefeats} fighters to your adventurer. They capture a pack mule: from now on the adventurer can pack ${report.groupLimit} ${slotNoun(report.groupReward, report.groupLimit)}.`;
}

// The line under the roster (plan screen and Adventurer tab): "Banners beaten: Red 5 · Black 2 · Gold 3. Next pack
// mule at 8 from one banner (3 more Red). Pack mules: +1 sword."
export function bannersLine(state, cfg = CONFIG) {
  const p = groupProgress(state, cfg);
  const beaten = Object.keys(p.defeats).map((k) => `${bannerLabel(k, cfg)} ${p.defeats[k]}`).join(' · ');
  const next = p.next == null
    ? 'Every gear type has a pack mule.'
    : `Next pack mule at ${p.next} from one banner (${p.toGo} more${p.top ? ` ${bannerLabel(p.top, cfg)}` : ''}).`;
  const mules = SLOTS.filter((s) => p.extra[s] > 0).map((s) => `+${p.extra[s]} ${slotNoun(s, p.extra[s])}`);
  return `Banners beaten: ${beaten}. ${next} Pack mules: ${mules.length ? mules.join(', ') : 'none yet'}.`;
}

const NUMBER_WORDS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const andList = (names) => (names.length < 2 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`);

// The story of the banners and pack mules, for the hover on the banners line and for Help. Numbers come from the config.
export function bannersText(cfg = CONFIG) {
  const keys = Object.keys(cfg.groups.list);
  const names = keys.map((k) => bannerLabel(k, cfg));
  const n = keys.length;
  const per = cfg.groups.defeatsPerReward;
  const once = cfg.groups.maxExtraPerType === 1 ? 'each gear type once' : `each gear type up to ${cfg.groups.maxExtraPerType} times`;
  return `Banners. ${NUMBER_WORDS[n] || n} warbands roam the valley, each under its own banner: ${andList(names)}. Every enemy marches under one of them, and you only sometimes know which (Banner scouting raises the chance). For every ${per} fighters your adventurer beats from the banner they have beaten most, they capture one of that warband's pack mules and can carry 1 more item of one gear type into a fight (the type is random; ${once}).`;
}
