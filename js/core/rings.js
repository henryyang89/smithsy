import { CONFIG, GRADES } from '../config.js';

export function ringDef(type, cfg = CONFIG) {
  return cfg.rings.types[type];
}

export function ringValue(ring, cfg = CONFIG) {
  return ringDef(ring.type, cfg).values[GRADES.indexOf(ring.grade)];
}

export function ringLabel(ring, cfg = CONFIG) {
  const d = ringDef(ring.type, cfg);
  const v = ringValue(ring, cfg);
  return `${d.name} ${ring.grade} (${d.desc.startsWith('%') ? `${v}${d.desc}` : `${v} ${d.desc}`})`;
}

// How much the n-th best ring (0-based) of a type counts: duplicateFactor^n, or only the best one (1, 0, 0, ...) for a
// type with `stack: false` (config rings.types).
export function ringFactor(type, n, cfg = CONFIG) {
  if (ringDef(type, cfg).stack === false) return n === 0 ? 1 : 0;
  return cfg.rings.duplicateFactor ** n;
}

// Sum ring bonuses with duplicate penalties.
// Same type sorted high->low: 1st x1, 2nd x0.5, 3rd x0.25, ... (duplicateFactor^n); a type with stack: false counts
// only its best ring.
export function ringTotals(rings, cfg = CONFIG) {
  const byType = {};
  for (const r of rings) (byType[r.type] = byType[r.type] || []).push(ringValue(r, cfg));
  const out = {};
  for (const [type, vals] of Object.entries(byType)) {
    vals.sort((a, b) => b - a);
    out[type] = vals.reduce((acc, v, i) => acc + v * ringFactor(type, i, cfg), 0);
  }
  return out;
}

// Per-ring effective contribution (for display), keyed by ring id.
export function ringContributions(rings, cfg = CONFIG) {
  const byType = {};
  for (const r of rings) (byType[r.type] = byType[r.type] || []).push(r);
  const out = {};
  for (const [type, list] of Object.entries(byType)) {
    list
      .slice()
      .sort((a, b) => ringValue(b, cfg) - ringValue(a, cfg))
      .forEach((r, i) => {
        const factor = ringFactor(type, i, cfg);
        out[r.id] = { value: ringValue(r, cfg), factor, effective: ringValue(r, cfg) * factor };
      });
  }
  return out;
}

export function wornRings(state, owner, cfg = CONFIG) {
  return state.rings.filter((r) => r.worn && ringDef(r.type, cfg).owner === owner);
}

export function smithRingTotals(state, cfg = CONFIG) {
  return ringTotals(wornRings(state, 'smith', cfg), cfg);
}

// Roll a ring reward for an enemy tier: type uniform, grade from tier weights.
export function rollRing(rng, tier, cfg = CONFIG) {
  const type = rng.pick(Object.keys(cfg.rings.types));
  const grade = rng.weighted(cfg.rings.gradeWeights[tier]);
  return { type, grade };
}

// Smith rings can be changed while planning at night or at the very start of the day (8:00 at camp),
// so the 10-ring limit is a real choice for the whole day. Returns a reason string, or null.
export function smithRingLock(state, cfg = CONFIG) {
  if (state.phase === 'plan' || state.phase === 'report') return null;
  if (state.phase !== 'work') return 'The game is over.';
  const atCamp = state.location.x === state.map.camp.x && state.location.y === state.map.camp.y;
  if (state.time <= cfg.time.dayStartMin + 1e-9 && atCamp) return null;
  return 'Smith rings can only be changed at the start of the day (before your first action) or while planning at night.';
}

export function toggleRing(state, id, cfg = CONFIG) {
  const ring = state.rings.find((r) => r.id === id);
  if (!ring) return { ok: false, msg: 'No such ring.' };
  const owner = ringDef(ring.type, cfg).owner;
  const lock = smithRingLock(state, cfg);
  if (owner === 'smith' && lock) return { ok: false, msg: lock };
  if (state.phase === 'over') return { ok: false, msg: 'The game is over.' };
  if (!ring.worn && wornRings(state, owner, cfg).length >= cfg.rings.maxWorn) {
    return { ok: false, msg: `The ${owner} already wears ${cfg.rings.maxWorn} rings.` };
  }
  ring.worn = !ring.worn;
  return { ok: true, msg: `${ring.worn ? 'Equipped' : 'Removed'} ${ringLabel(ring, cfg)}.` };
}
