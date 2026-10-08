// ============================================================================
// SMITHSY — ALL TUNABLE NUMBERS LIVE IN THIS FILE.
// Edit values here to rebalance. docs/BALANCE.md explains every number.
// Percentages are written as whole numbers (25 means 25%) unless noted.
// ============================================================================

export const GRADES = ['D', 'C', 'B', 'A', 'S']; // index 0..4, used to look up per-grade tables
export const ORES = ['copper', 'iron', 'coal', 'mythril']; // raw ores, increasing rarity
export const BARS = ['copper', 'iron', 'steel', 'mythril']; // refined bars (steel = iron + coal)
export const GEMS = ['ruby', 'topaz', 'sapphire', 'emerald', 'diamond'];
export const SLOTS = ['sword', 'chest', 'helmet', 'gloves', 'boots'];
export const ARMOR_SLOTS = ['chest', 'helmet', 'gloves', 'boots'];
export const TIERS = ['normal', 'elite', 'champion'];
export const LEVELS = ['low', 'normal', 'high'];

export const CONFIG = {
  // --------------------------------------------------------------- TIME ----
  time: {
    dayStartMin: 8 * 60, // 8:00am, minutes after midnight
    dayEndMin: 18 * 60, // 6:00pm -> 600 working minutes per day
  },

  // ---------------------------------------------------------------- MAP ----
  map: {
    size: 5, // 5x5 world map, camp in the center
    blockedCells: 4, // impassable map cells (never the camp; all fields stay reachable)
    travelMinPerStep: 20, // minutes per map step (up/down/left/right)
    loadPenaltyPerItem: 1, // +1% travel time per item in the bag
  },

  // Items you find go to the field's pile (no limit). When you leave a field you choose what to carry:
  // up to `slots` raw ores/gems, 1 per slot. The rest stays in that field's pile. Camp storage is unlimited.
  bag: { slots: 20 },

  // -------------------------------------------------------------- FIELD ----
  field: {
    size: 8, // each map field is an 8x8 grid
    searchMin: 30, // minutes per 3x3 search
    freshCellMin: 2, // +minutes per never-searched cell in the 3x3 (a cell is "touched" once a search works on it)
    searchEfficiency: 35, // % of each cell searched per search, before bonuses (about 3 searches finish a cell)
    searchRandomness: 5, // each cell rolls efficiency +/- this many points per search (35 -> 30..40)
    debrisChance: 15, // % of cells covered by debris (must be cleared before the cell can be searched)
    // Debris thickness in search effort (a search gives each cell ~35 effort). Searching a debris cell
    // clears debris first; leftover effort searches the cell. Thickness is shown on the cell.
    debrisAmount: { min: 20, max: 60 },
    boulders: 1, // cells per field covered by a boulder: can never be cleared or searched
    debrisLootBonus: 20, // debris cells get +20% (points) chance to hold items
    // Regrowth: each night, every searched cell has this % chance to reset to a fresh, unsearched cell
    // with new hidden contents (boulders and the field's pile stay). OFF (0) for now: fields do not regrow.
    regrowPctPerDay: 0,
    // Chance a cell holds items, by distance d from camp: base + perDistance*(d-1), capped at max.
    lootChance: { base: 50, perDistance: 5, max: 80 },
    itemCountWeights: { 1: 30, 2: 40, 3: 30 }, // how many items a loot cell holds (weights)
    oreShare: 70, // % of items that are ores (the rest are gems)
    // Ore / gem weights by distance from camp (row 1 = distance 1). Last row is used for farther fields.
    oreWeights: [
      { copper: 80, iron: 20, coal: 0, mythril: 0 },
      { copper: 60, iron: 35, coal: 5, mythril: 0 },
      { copper: 45, iron: 40, coal: 15, mythril: 0 },
      { copper: 35, iron: 40, coal: 20, mythril: 5 },
    ],
    // Every gem type is equally likely at every distance.
    gemWeights: [
      { ruby: 20, topaz: 20, sapphire: 20, emerald: 20, diamond: 20 },
    ],
  },

  // --------------------------------------------------------- PROCESSING ----
  // Grade outcome tables (% chance). F = failure (material lost). Each row sums to 100.
  refine: {
    copper: { minutes: 15, input: { copper: 1 }, dist: { S: 5, A: 10, B: 20, C: 25, D: 30, F: 10 } },
    iron: { minutes: 20, input: { iron: 1 }, dist: { S: 4, A: 8, B: 18, C: 25, D: 35, F: 10 } },
    steel: { minutes: 25, input: { iron: 1, coal: 1 }, dist: { S: 3, A: 6, B: 16, C: 25, D: 40, F: 10 } },
    mythril: { minutes: 30, input: { mythril: 1 }, dist: { S: 2, A: 4, B: 14, C: 25, D: 45, F: 10 } },
  },
  // Gem cutting blends from the `novice` table (grade skill level 0) to the `master` table (max level).
  // Failure: novice F minus the gem's cutting skill (points). Grade weights D..S blend linearly by the
  // gem's grade skill and are scaled to fill the rest. Gem luck rings then upgrade on top.
  cut: {
    ruby: { minutes: 20, novice: { F: 15, D: 45, C: 25, B: 10, A: 4, S: 1 }, master: { F: 10, D: 20, C: 25, B: 22, A: 15, S: 8 } },
    topaz: { minutes: 20, novice: { F: 15, D: 45, C: 25, B: 10, A: 4, S: 1 }, master: { F: 10, D: 20, C: 25, B: 22, A: 15, S: 8 } },
    sapphire: { minutes: 20, novice: { F: 15, D: 45, C: 25, B: 10, A: 4, S: 1 }, master: { F: 10, D: 20, C: 25, B: 22, A: 15, S: 8 } },
    emerald: { minutes: 20, novice: { F: 15, D: 45, C: 25, B: 10, A: 4, S: 1 }, master: { F: 10, D: 20, C: 25, B: 22, A: 15, S: 8 } },
    diamond: { minutes: 20, novice: { F: 15, D: 45, C: 25, B: 10, A: 4, S: 1 }, master: { F: 10, D: 20, C: 25, B: 22, A: 15, S: 8 } },
  },
  processing: {
    maxTimeReduction: 75, // time bonuses (rings + skills) are capped at -75%
  },

  // --------------------------------------------------------------- GEAR ----
  gear: {
    // Final stat = slot base stat x material multiplier x grade multiplier
    materialMult: { copper: 1.0, iron: 1.5, steel: 2.0, mythril: 3.0 },
    gradeMult: { D: 1.0, C: 1.1, B: 1.2, A: 1.3, S: 1.5 },
    slots: {
      sword: { bars: 2, stats: { damage: 16, accuracy: 10 } },
      chest: { bars: 3, stats: { defense: 6 } },
      helmet: { bars: 2, stats: { defense: 4 } },
      gloves: { bars: 2, stats: { defense: 2, accuracy: 10 } },
      boots: { bars: 2, stats: { defense: 2, dodge: 10, speed: 3 } },
    },
    smithMinPerBar: 15, // minutes of smithing per bar used
    infuseMin: 10, // extra minutes to infuse a cut gem
    gemArmorMult: { chest: 1.25, helmet: 1.1, gloves: 1.0, boots: 1.0 }, // armor gem effect multiplier
    // % durability each USED item loses per fight: a whole-number roll min..max (avg 10), x the enemy tier's
    // multiplier, x (1 - Gear care skill %), rounded, at least 1. Packed-but-unused gear does not wear.
    durabilityLoss: { min: 8, max: 12, tierMult: { normal: 1.0, elite: 1.1, champion: 1.2 } },
    repair: {
      materialFraction: 35, // full 0->100% repair costs 35% of the original bars (+ gem); scales with % repaired
      timeFraction: 50, // full repair takes 50% of the original smithing time; scales with % repaired
    },
  },

  // Gem infusion effects, indexed by gem grade [D, C, B, A, S].
  // Weapon effects go on swords. Armor effects are multiplied by gear.gemArmorMult for the slot.
  // Balance (1.2): an S sword gem is a little weaker than the matching enemy special at High (ruby 15 vs
  // Magical 30, diamond 55 vs Piercing 60, topaz 30% / 1.5s vs Stunning 35% / 1.5s, sapphire 30% / 2s vs
  // Chilling 40% / 2.5s) and every sword gem is worth about the same in win points (C ~ +6, S ~ +15 for a
  // steel set vs an elite). Armor gems (3 pieces at C + a B ring) win back most of what a High special costs.
  gemEffects: {
    ruby: {
      weapon: { magicPct: [5, 8, 10, 12, 15] }, // + magic damage as % of weapon damage (ignores defense)
      armor: { magicRes: [4, 6, 8, 10, 12] }, // % magic damage reduction
    },
    topaz: {
      weapon: { stunChance: [10, 15, 20, 25, 30], stunDur: [1, 1, 1.5, 1.5, 1.5] }, // % per hit, seconds
      armor: { stunChanceRed: [4, 6, 8, 10, 12], stunDurRed: [4, 6, 8, 10, 12] }, // % reductions
    },
    emerald: {
      weapon: { accuracy: [20, 30, 40, 50, 60] }, // accuracy rating
      armor: { dodge: [4, 6, 8, 10, 12] }, // dodge rating
    },
    sapphire: {
      weapon: { slowPct: [10, 15, 20, 25, 30], slowDur: [1.5, 1.5, 1.5, 1.5, 2] }, // % slower attacks, seconds
      armor: { slowRed: [4, 6, 8, 10, 12], slowDurRed: [4, 6, 8, 10, 12] }, // % reductions
    },
    diamond: {
      weapon: { pierce: [15, 25, 35, 45, 55] }, // % of enemy defense ignored
      armor: { pierceRes: [6, 9, 12, 15, 18] }, // % of enemy piercing ignored
    },
  },

  // --------------------------------------------------------- ADVENTURER ----
  adventurer: {
    hp: 100,
    unarmedDamage: 11, // damage per hit with no sword
    attackInterval: 2.0, // seconds between attacks at 0% speed
    accuracy: 100,
    dodge: 100,
  },

  // ------------------------------------------------------------- COMBAT ----
  combat: {
    // Hit chance = acc^2 / (acc^2 + hitK * dodge^2), clamped to [minHit, maxHit].
    // With hitK = 0.25: equal ratings -> 80%, double accuracy -> 94%, half accuracy -> 50%.
    hitK: 0.25,
    minHitPct: 5,
    maxHitPct: 95,
    damageRoll: [90, 110], // each hit deals 90%..110% of listed damage
    defenseCap: 75, // max % physical damage reduction
    resistCap: 75, // cap for magic resistance and all stun/slow reductions
    safetyCapSeconds: 36000, // fights have no time limit; this only guards against infinite loops
    bestGearFights: 200, // fights per loadout the adventurer "thinks through" to pick the best gear
  },

  // ------------------------------------------------------------ ENEMIES ----
  enemies: {
    attackInterval: 2.0,
    stunDuration: 1.5, // seconds, when an enemy with Stunning lands a stun
    slowDuration: 2.5, // seconds, when an enemy with Chilling hits
    // Daily scaling: multiplier = 1 + growth/100 * (day - 1)
    growthPerDay: { hpDamage: 3.5, ratings: 1 }, // HP & damage +3.5%/day, accuracy & dodge +1%/day
    // All tiers share the same base HP / damage / defense: tiers differ only by attribute levels
    // (normal: 6 low, elite: 3 low / 3 high, champion: 6 high) and by their score and ring rewards.
    tiers: {
      normal: { count: 2, hp: 80, damage: 8, defense: 25, levels: { low: 6, normal: 6, high: 0 }, score: 10 },
      elite: { count: 3, hp: 80, damage: 8, defense: 25, levels: { low: 3, normal: 6, high: 3 }, score: 25 },
      champion: { count: 2, hp: 80, damage: 8, defense: 25, levels: { low: 0, normal: 6, high: 6 }, score: 50 },
    },
    // 12 attributes, displayed as pairs: offensive (left) | defensive (right).
    attributes: {
      piercing: { name: 'Piercing', side: 'O', values: { low: 10, normal: 25, high: 60 }, desc: '% of your defense ignored' },
      pierceRes: { name: 'Pierce resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% of your piercing ignored' },
      magical: { name: 'Magical', side: 'O', values: { low: 10, normal: 20, high: 30 }, desc: 'extra magic damage, % of its damage' },
      magicRes: { name: 'Magic resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% magic damage reduction' },
      stunning: { name: 'Stunning', side: 'O', values: { low: 5, normal: 15, high: 35 }, desc: '% stun chance per hit' },
      stunRes: { name: 'Stun resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% less stun chance and duration' },
      accurate: { name: 'Accurate', side: 'O', values: { low: 80, normal: 100, high: 120 }, desc: 'accuracy rating (before daily growth)' },
      evasion: { name: 'Evasion', side: 'D', values: { low: 80, normal: 100, high: 120 }, desc: 'dodge rating (before daily growth)' },
      chilling: { name: 'Chilling', side: 'O', values: { low: 10, normal: 20, high: 40 }, desc: '% slower attacks for 2.5s on hit' },
      slowRes: { name: 'Slow resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% less slow strength and duration' },
      fast: { name: 'Fast', side: 'O', values: { low: -5, normal: 0, high: 5 }, desc: '% attack speed' },
      hp: { name: 'HP', side: 'D', values: { low: 90, normal: 100, high: 110 }, desc: '% of base HP' },
    },
    pairs: [
      ['piercing', 'pierceRes'],
      ['magical', 'magicRes'],
      ['stunning', 'stunRes'],
      ['accurate', 'evasion'],
      ['chilling', 'slowRes'],
      ['fast', 'hp'],
    ],
    names: {
      normal: ['Goblin', 'Wolf', 'Bandit', 'Skeleton', 'Slime', 'Giant Rat', 'Kobold', 'Bat Swarm'],
      elite: ['Orc Brute', 'Dire Wolf', 'Bandit Captain', 'Ghoul', 'Harpy', 'Lizardman', 'Ogre', 'Dark Acolyte'],
      champion: ['Troll Chieftain', 'Wyvern', 'Lich', 'Minotaur', 'Ice Giant', 'Basilisk', 'Vampire Lord', 'Golem'],
    },
  },

  // -------------------------------------------------------------- RINGS ----
  rings: {
    maxWorn: 10, // per wearer (smith and adventurer each)
    duplicateFactor: 0.5, // same type: best counts 100%, 2nd 50%, 3rd 25%, 4th 12.5%...
    // Ring grade weights by enemy tier (each enemy drops one ring when defeated).
    gradeWeights: {
      normal: { D: 60, C: 30, B: 10 },
      elite: { C: 60, B: 30, A: 10 },
      champion: { B: 60, A: 30, S: 10 },
    },
    // Each type is equally likely. values = [D, C, B, A, S].
    types: {
      travelTime: { owner: 'smith', name: 'Travel', values: [5, 6, 7, 8, 10], desc: '% less travel time' },
      searchTime: { owner: 'smith', name: 'Quick search', values: [5, 6, 7, 8, 10], desc: '% less search time' },
      searchEff: { owner: 'smith', name: 'Thorough search', values: [10, 12, 14, 16, 20], desc: '% more searched per search' },
      reveal: { owner: 'smith', name: 'Ore sight', values: [3, 4, 5, 6, 7], desc: '% (points) chance to see all items in a searched cell' },
      processTime: { owner: 'smith', name: 'Refining', values: [5, 6, 7, 8, 10], desc: '% less refining and cutting time' },
      oreGrade: { owner: 'smith', name: 'Bar luck', values: [2, 3, 4, 5, 6], desc: '% chance a bar is upgraded one grade' },
      gemGrade: { owner: 'smith', name: 'Gem luck', values: [2, 3, 4, 5, 6], desc: '% chance a gem is upgraded one grade' },
      foresight: { owner: 'smith', name: 'Foresight', values: [2, 3, 4, 5, 6], desc: 'more guesses and test fights in the win-chance estimate' },
      pierce: { owner: 'adventurer', name: 'Piercing', values: [6, 8, 10, 12, 14], desc: '% of enemy defense ignored' },
      pierceRes: { owner: 'adventurer', name: 'Pierce resistance', values: [6, 9, 12, 15, 18], desc: '% of enemy piercing ignored' },
      magicDmg: { owner: 'adventurer', name: 'Magic damage', values: [3, 4, 5, 6, 7], desc: '% of weapon damage added as magic' },
      magicRes: { owner: 'adventurer', name: 'Magic resistance', values: [4, 6, 8, 10, 12], desc: '% magic damage reduction' },
      stunRes: { owner: 'adventurer', name: 'Stun resistance', values: [4, 6, 8, 10, 12], desc: '% less stun chance and duration' },
      accuracy: { owner: 'adventurer', name: 'Accuracy', values: [6, 7, 8, 9, 10], desc: 'accuracy rating' },
      dodge: { owner: 'adventurer', name: 'Dodge', values: [6, 7, 8, 9, 10], desc: 'dodge rating' },
      slowRes: { owner: 'adventurer', name: 'Slow resistance', values: [6, 9, 12, 15, 18], desc: '% less slow strength and duration' },
      speed: { owner: 'adventurer', name: 'Speed', values: [2, 2.5, 3, 3.5, 4], desc: '% attack speed' },
      health: { owner: 'adventurer', name: 'Health', values: [3, 4, 5, 6, 7], desc: '% max HP' },
    },
  },

  // ------------------------------------------------------------- SKILLS ----
  // Skills level up automatically from doing the activity. A level-10 skill (lots of activity) equals a
  // C-grade ring of the same kind. Skills without a ring: debris clearing +100% (twice as fast), failure
  // -5 points, gem grade (blends the novice table into the master table), Gear care (-10% durability loss
  // per fight; XP from fights the adventurer survives, not from time).
  // XP needed to go from level L to L+1 = xpBase * (L + 1). Level 10 = 5,500 total XP.
  skills: {
    maxLevel: 10,
    xpBase: 100,
    gearCareXpPerFight: 100, // Gear care XP for each fight the adventurer survives (win or draw)
    // XP per bar refined / gem cut (failures count), for the per-material skills. Rarer = more XP.
    xpPerItem: { copper: 25, iron: 25, steel: 30, mythril: 50, ruby: 25, topaz: 25, sapphire: 30, emerald: 40, diamond: 50 },
    // Activity skills: XP = minutes spent on the activity. Bonus = perLevel x level.
    activity: {
      returnTravel: { name: 'Return travel', perLevel: 0.6, desc: '% less travel time back to camp', xpFrom: 'minutes travelling to camp' },
      searchTime: { name: 'Search speed', perLevel: 0.6, desc: '% less search time', xpFrom: 'minutes searching' },
      searchEff: { name: 'Search efficiency', perLevel: 1.2, desc: '% more searched per search', xpFrom: 'minutes searching' },
      debris: { name: 'Debris clearing', perLevel: 10, desc: '% more debris cleared per search', xpFrom: 'debris cleared (1 XP per point)' },
      refineTime: { name: 'Refining speed', perLevel: 0.6, desc: '% less refining time', xpFrom: 'minutes refining' },
      cutTime: { name: 'Cutting speed', perLevel: 0.6, desc: '% less cutting time', xpFrom: 'minutes cutting' },
      gearCare: { name: 'Gear care', perLevel: 1, desc: '% less durability loss in fights', xpFrom: 'fights the adventurer survives' },
    },
    // Per-material skills (one per bar type / gem type). XP = xpPerItem per item processed of that type.
    perMaterial: {
      oreGrade: { name: 'grade', perLevel: 0.3, desc: '% chance to upgrade the bar one grade' },
      oreFail: { name: 'refining', perLevel: 0.5, desc: 'points less failure chance' },
      gemGrade: { name: 'grade', perLevel: 10, desc: '% of the way from the novice to the master grade table' },
      gemFail: { name: 'cutting', perLevel: 0.5, desc: 'points less failure chance' },
    },
  },

  // -------------------------------------------------------------- INTEL ----
  intel: {
    daysPerPoint: 5, // 1 intel point at the end of day 5, 10, 15, ...
    gainsPerPoint: [10, 9, 8, 7, 6, 5, 4, 3, 2], // 1st point +10, 2nd +9, ... then +1 each
    minGain: 1,
    maxChance: 100,
    tracks: {
      oreSight: { name: 'Ore sight', base: 10, desc: 'chance per searched cell to see everything left in it' },
      enemySight: { name: 'Enemy scouting', base: 10, desc: 'chance to see each enemy attribute' },
      ringTypeSight: { name: 'Ring type scouting', base: 25, desc: 'chance to see each reward ring type' },
      ringGradeSight: { name: 'Ring grade scouting', base: 25, desc: 'chance to see each reward ring grade' },
      // Not a chance: the value is the number of EXTRA guesses and extra test fights per enemy (gainsPerPoint).
      simDepth: { name: 'Battle simulation', base: 0, desc: 'extra guesses and test fights per enemy in the win-chance estimate' },
    },
  },

  // ---------------------------------------------------------------- SIM ----
  // Base sizes of the win-chance estimate (one button estimates every enemy). Each count is raised by
  // the Battle simulation intel track and Foresight rings (see simCounts in js/core/sim.js). Kept small
  // on purpose: with 10 x 10 = 100 test fights the estimate is noisy, which is a little risk to plan with.
  sim: {
    samples: 10, // random guesses of the hidden enemy attributes per enemy
    evalFights: 10, // fresh fights with the chosen gear per guess (the reported win %)
    fightsPerLoadout: 10, // fights per gear combination when picking the best gear for a guess
  },
};
