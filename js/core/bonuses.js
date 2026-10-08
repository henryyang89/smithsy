import { CONFIG } from '../config.js';
import { smithRingTotals } from './rings.js';
import { skillEffectTotals } from './skills.js';
import { intelValue } from './intel.js';

// Every smith-side modifier in one place: worn smith rings + skills + intel.
// All values are percentages / percentage points. Time reductions are capped by the callers
// (processing.maxTimeReduction).
export function smithBonuses(state, cfg = CONFIG) {
  const ring = smithRingTotals(state, cfg);
  const rv = (k) => ring[k] || 0;
  // se(effect, material): the activity skills' total for the effect plus the material's own skills (none without one)
  const totals = skillEffectTotals(state, cfg);
  const se = (effect, material = null) => (totals.all[effect] || 0) + (material && totals.byMaterial[material] ? totals.byMaterial[material][effect] || 0 : 0);
  return {
    travelPct: rv('travelTime') + se('travelTime'), // every trip
    loadPenaltyRed: Math.min(100, se('loadPenalty')), // % of the per-item load penalty removed (Carrying)
    searchTimePct: rv('searchTime') + se('searchTime'),
    searchEffPct: rv('searchEff') + se('searchEff'),
    debrisPct: se('debrisClear'),
    sight: intelValue(state, 'oreSight', cfg) + rv('reveal'), // Ore sight intel + Ore sight rings (see field.sight)
    gearCarePct: se('wear'), // % less durability loss per used item in a fight
    refineTimePct: rv('processTime') + se('refineTime'),
    cutTimePct: rv('processTime') + se('cutTime'),
    smithTimePct: (bar) => se('smithTime', bar), // % less smithing time for gear of this bar type
    repairTimePct: (bar) => se('repairTime', bar), // 3 x Repair + 1 x General repair + 0.5 x Smithing per level
    oreUpgrade: (bar) => rv('oreGrade') + se('refineUpgrade', bar),
    oreFailRed: (bar) => se('refineFail', bar), // 0.5 x refining skill + 0.1 x General refining, per level
    gemUpgrade: () => rv('gemGrade'), // rings only; the gem grade skills blend the cut table instead
    gemBlend: (gem) => Math.min(100, se('cutBlend', gem)), // % of the way from the novice to the master table
    gemFailRed: (gem) => se('cutFail', gem),
  };
}
