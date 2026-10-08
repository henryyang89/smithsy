import { CONFIG } from '../config.js';
import { smithRingTotals } from './rings.js';
import { skillBonus } from './skills.js';
import { intelValue } from './intel.js';

// Every smith-side modifier in one place: worn smith rings + skills + intel.
// All values are percentages / percentage points.
export function smithBonuses(state, cfg = CONFIG) {
  const ring = smithRingTotals(state, cfg);
  const sk = (k) => skillBonus(state, k, cfg);
  const rv = (k) => ring[k] || 0;
  return {
    travelPct: rv('travelTime'), // all travel
    returnPct: sk('returnTravel'), // travel ending at camp (stacks with travelPct)
    searchTimePct: rv('searchTime') + sk('searchTime'),
    searchEffPct: rv('searchEff') + sk('searchEff'),
    sight: intelValue(state, 'oreSight', cfg) + rv('reveal'), // Ore sight intel + Ore sight rings (see field.sight)
    debrisPct: sk('debris'),
    gearCarePct: sk('gearCare'), // % less durability loss per used item in a fight
    refineTimePct: rv('processTime') + sk('refineTime'),
    cutTimePct: rv('processTime') + sk('cutTime'),
    oreUpgrade: (bar) => rv('oreGrade') + sk(`oreGrade_${bar}`),
    gemUpgrade: () => rv('gemGrade'), // rings only; the gem grade skill blends the cut table instead
    gemBlend: (gem) => sk(`gemGrade_${gem}`), // % of the way from novice to master table
    oreFailRed: (bar) => sk(`oreFail_${bar}`),
    gemFailRed: (gem) => sk(`gemFail_${gem}`),
  };
}
