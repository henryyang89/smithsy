// ============================================================================
// SMITHSY — ALL TUNABLE NUMBERS LIVE IN THIS FILE.
// Edit values here to rebalance. docs/BALANCE.md explains every number.
// Percentages are written as whole numbers (25 means 25%) unless noted.
// Skills: each skill lists `effects` (an effect and its amount per level); the skills block explains the model.
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
    size: 7, // 7x7 world map, camp in the center
    blockedCells: 8, // impassable map cells (never the camp; every field stays reachable)
    maxDetour: 2, // a map is re-rolled if rocks make any field more than 2 steps farther than the straight walk
    travelMinPerStep: 15, // minutes per map step (up/down/left/right)
    loadPenaltyPerItem: 2.5, // +2.5% travel time per carried item (T-B2: the load is 8-15% of the travel minutes)
  },

  // Items you find go to the field's pile (no limit). When you leave a field you choose what to carry:
  // up to `slots` raw ores/gems, 1 per slot. The rest stays in that field's pile. Camp storage is unlimited.
  bag: { slots: 20 },

  // -------------------------------------------------------------- FIELD ----
  field: {
    size: 9, // each map field is a 9x9 grid = 9 plots of 3x3
    searchMin: 27, // minutes per 3x3 search (27: copper takes about 24 field minutes per unit at the best distance, T-E2)
    freshCellMin: 2, // +minutes per never-searched cell in the 3x3 (a cell is "touched" once a search works on it)
    searchEfficiency: 30, // % of each cell searched per search, before bonuses (about 4 searches finish a cell)
    searchRandomness: 5, // each cell rolls efficiency +/- this many points per search (30 -> 25..35)
    debrisChance: 15, // % of cells covered by debris (cleared by searching before the cell can be searched)
    // Debris thickness in search effort (a search gives each cell ~30). Searching a debris cell
    // clears debris first; leftover effort searches the cell. Thickness is shown on the cell.
    debrisAmount: { min: 20, max: 60 },
    debrisLootBonus: 20, // debris cells get +20% (points) chance to hold items
    itemCountWeights: { 1: 30, 2: 40, 3: 30 }, // how many items a loot cell holds (weights)
    // Field contents by distance from camp: row 1 = distance 1 ... row 6 = distance 6; farther fields use the last row.
    //   loot: % chance a cell holds items · boulders: boulder cells per field (fixed, never rolled; can never be
    //   searched) · gemShare: % of items that are gems (the rest are ores) · ores: ore weights (relative)
    byDistance: [
      { loot: 46, boulders: 2, gemShare: 15, ores: { copper: 80, iron: 20, coal: 0, mythril: 0 } },
      { loot: 53, boulders: 2, gemShare: 17, ores: { copper: 70, iron: 27, coal: 3, mythril: 0 } },
      { loot: 56, boulders: 3, gemShare: 19, ores: { copper: 57, iron: 36, coal: 7, mythril: 0 } },
      { loot: 59, boulders: 3, gemShare: 21, ores: { copper: 48, iron: 39, coal: 13, mythril: 0 } },
      { loot: 62, boulders: 4, gemShare: 23, ores: { copper: 41, iron: 40, coal: 17, mythril: 2 } },
      { loot: 65, boulders: 4, gemShare: 25, ores: { copper: 35, iron: 40, coal: 20, mythril: 5 } },
    ],
    gemWeights: { ruby: 20, topaz: 20, sapphire: 20, emerald: 20, diamond: 20 }, // every gem type equally likely
    // Sight thresholds: each item rolls a whole number above the first value and up to the second when the field is
    // made. In the field you stand in, you see an item still in the ground once your sight (Ore sight intel + Ore
    // sight rings) is at least its threshold. Rarer ores roll higher. `gem` is shared by every gem type.
    sight: { copper: [0, 40], iron: [10, 60], coal: [15, 70], gem: [15, 80], mythril: [50, 100] },
  },

  // --------------------------------------------------------- PROCESSING ----
  // Grade outcome tables (% chance). F = failure (material lost). Each row sums to 100.
  refine: {
    copper: { minutes: 17, input: { copper: 1 }, dist: { S: 5, A: 10, B: 20, C: 25, D: 30, F: 10 } },
    iron: { minutes: 23, input: { iron: 1 }, dist: { S: 4, A: 8, B: 18, C: 25, D: 35, F: 10 } },
    steel: { minutes: 29, input: { iron: 1, coal: 1 }, dist: { S: 3, A: 6, B: 16, C: 25, D: 40, F: 10 } },
    mythril: { minutes: 35, input: { mythril: 1 }, dist: { S: 2, A: 4, B: 14, C: 25, D: 45, F: 10 } },
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
    // Final stat = slot base stat x material multiplier x grade multiplier. An S item of one material sits between
    // D and C of the next one (about 70% of the way from the next material's D to its C), so a top-grade copper
    // piece is still worth a little more than a plain iron one. A (1.3) stays below the next material's D.
    materialMult: { copper: 1.0, iron: 1.45, steel: 2.1, mythril: 3.0 },
    gradeMult: { D: 1.0, C: 1.1, B: 1.2, A: 1.3, S: 1.55 },
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
    // multiplier, x (1 - Gear care skill %), kept to one decimal (so every Gear care level counts), at least 1.
    // Packed-but-unused gear does not wear.
    durabilityLoss: { min: 8, max: 12, tierMult: { normal: 1.0, elite: 1.1, champion: 1.2 } },
    repair: {
      materialFraction: 35, // a full 0->100% repair costs 35% of the item's bars, scaled by the % repaired; scrap gives back 35% x durability
      gemFraction: 35, // ... plus 35% of its cut gem, scaled the same way (0 = repairs cost bars only)
      timeFraction: 250, // a full repair takes 2.5 times as long as smithing the item, scaled by the % repaired (repair skills cut it); T-B3: repairs are 3-6% of the work time
    },
  },

  // Gem infusion effects, indexed by gem grade [D, C, B, A, S].
  // Weapon effects go on swords. Armor effects are multiplied by gear.gemArmorMult for the slot.
  // Balance (2.0): gems are meant to be worth crafting for. Against a High special, armor with the matching gem
  // should beat emerald armor; against a Low special emerald wins (so bring the right gem to each fight). Armor
  // resistances are about 3.75x their 1.2 values (diamond 6x: pierce resistance is the only piercing answer);
  // sword gems are about as strong as before, except that the top grades are kept below the special they answer.
  // An S sword gem stays worth less in win points than the matching enemy special costs (Low to High); sapphire
  // is the tight one, so its sword gem rises only from 16% to 19%. Targets M1-M7 and the way to measure them:
  // docs/BALANCE.md and `node tools/balance.mjs --section specials` (tuned in the Batch 7 log).
  gemEffects: {
    ruby: {
      weapon: { magicPct: [5, 7, 9, 11, 13] }, // + magic damage as % of weapon damage (ignores defense)
      armor: { magicRes: [18, 27, 36, 45, 54] }, // % magic damage reduction
    },
    topaz: {
      weapon: { stunChance: [15, 20, 24, 26, 26], stunDur: [1, 1.5, 1.5, 1.5, 1.5] }, // % per hit, seconds
      armor: { stunChanceRed: [15, 22, 30, 37, 45], stunDurRed: [15, 22, 30, 37, 45] }, // % reductions
    },
    emerald: {
      weapon: { accuracy: [28, 42, 56, 72, 90] }, // accuracy rating
      armor: { dodge: [2, 3, 4, 5, 6] }, // dodge rating (halved: emerald armor must not beat the matching gem)
    },
    sapphire: {
      weapon: { slowPct: [11, 16, 18, 19, 19], slowDur: [2, 2, 2, 2, 2] }, // % slower attacks, seconds
      armor: { slowRed: [15, 22, 30, 37, 45], slowDurRed: [15, 22, 30, 37, 45] }, // % reductions
    },
    diamond: {
      weapon: { pierce: [15, 25, 35, 45, 55] }, // % of enemy defense ignored
      armor: { pierceRes: [16, 24, 32, 40, 48] }, // % of enemy piercing ignored
    },
  },

  // --------------------------------------------------------- ADVENTURER ----
  adventurer: {
    hp: 100,
    unarmedDamage: 14, // damage per hit with no sword (a Copper D sword is 16: the first sword is a modest step up, see enemies.tiers)
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
    // Each attack bar starts the fight a random 0..this % full (one roll per side), so who strikes first is luck.
    // Without it, Low = 0 specials make both bars tie every exchange and a hidden "adventurer first" rule would decide
    // fights. 0 = both bars start empty (the old timing; scripted tests use that).
    startFillMax: 50,
  },

  // ------------------------------------------------------------ ENEMIES ----
  enemies: {
    attackInterval: 2.0,
    stunDuration: 1.8, // seconds, when an enemy with Stunning lands a stun
    slowDuration: 3, // seconds, when an enemy with Chilling hits
    // Daily scaling: multiplier = 1 + growth/100 * (day - 1). The player is never shown these numbers.
    growthPerDay: { hpDamage: 6.3, ratings: 0.3 }, // HP & damage +6.3%/day, accuracy & dodge +0.3%/day (T-D: careful median life 30-40 days)
    // Base HP / damage / defense on day 1. Elites slightly above normals, champions slightly above elites.
    // Fights are steep (+1% enemy HP and damage is about -3.5 win points), so the steps are small on purpose.
    // Tiers also differ by attribute levels (normal: 6 low, elite: 3 low / 3 high, champion: 6 high), score and ring grades.
    // Tuned together with adventurer.unarmedDamage and the High special values (docs/PLAN-2.0.md T-R7 / T-GEAR, user answer U1):
    // on day 2 an unarmed adventurer wins about 42% against an elite (30-50 by how many of Magical / Stunning / Chilling are
    // High) and about 18% against a champion (0-25); a Copper D sword + Copper D chest wins about 77% / 53%. Normals sit
    // about 7% below elites in HP and damage so that every roster has a safe fight while the typical elite is 85% (T-D, T-GEAR c).
    tiers: {
      normal: { count: 2, hp: 82, damage: 9.2, defense: 22, levels: { low: 6, normal: 6, high: 0 }, score: 10 },
      elite: { count: 3, hp: 88, damage: 10, defense: 23, levels: { low: 3, normal: 6, high: 3 }, score: 25 },
      champion: { count: 2, hp: 89, damage: 10.1, defense: 24, levels: { low: 0, normal: 6, high: 6 }, score: 50 },
    },
    // 12 attributes, displayed as pairs: offensive (left) | defensive (right).
    // Specials and resistances: Low = the enemy does not have it at all (0, shown as "none"). Core stats (Accurate,
    // Evasion, Fast, HP) move in small steps.
    attributes: {
      piercing: { name: 'Piercing', side: 'O', values: { low: 0, normal: 20, high: 45 }, desc: '% of your defense ignored' },
      pierceRes: { name: 'Pierce resistance', side: 'D', values: { low: 0, normal: 25, high: 60 }, desc: '% of your piercing ignored' },
      magical: { name: 'Magical', side: 'O', values: { low: 0, normal: 5, high: 9 }, desc: 'extra magic damage, % of its damage' },
      magicRes: { name: 'Magic resistance', side: 'D', values: { low: 0, normal: 25, high: 60 }, desc: '% magic damage reduction' },
      stunning: { name: 'Stunning', side: 'O', values: { low: 0, normal: 5, high: 15 }, desc: '% stun chance per hit' },
      stunRes: { name: 'Stun resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% less stun chance and duration' },
      accurate: { name: 'Accurate', side: 'O', values: { low: 95, normal: 100, high: 105 }, desc: 'accuracy rating' },
      evasion: { name: 'Evasion', side: 'D', values: { low: 95, normal: 100, high: 105 }, desc: 'dodge rating' },
      chilling: { name: 'Chilling', side: 'O', values: { low: 0, normal: 5, high: 12 }, desc: '% slower attacks for 3s on hit' },
      slowRes: { name: 'Slow resistance', side: 'D', values: { low: 0, normal: 20, high: 40 }, desc: '% less slow strength and duration' },
      fast: { name: 'Fast', side: 'O', values: { low: -2, normal: 0, high: 2 }, desc: '% attack speed' },
      hp: { name: 'HP', side: 'D', values: { low: 97, normal: 100, high: 103 }, desc: '% of base HP' },
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
    // Each type is equally likely. values = [D, C, B, A, S]. A type with `stack: false` counts only its best worn ring.
    types: {
      travelTime: { owner: 'smith', name: 'Travel', values: [5, 6, 7, 8, 10], desc: '% less travel time' },
      searchTime: { owner: 'smith', name: 'Quick search', values: [5, 6, 7, 8, 10], desc: '% less search time' },
      searchEff: { owner: 'smith', name: 'Thorough search', values: [10, 12, 14, 16, 20], desc: '% more searched per search' },
      reveal: { owner: 'smith', name: 'Ore sight', values: [10, 15, 20, 25, 30], desc: 'sight' }, // adds to your sight (see field.sight)
      processTime: { owner: 'smith', name: 'Refining', values: [5, 6, 7, 8, 10], desc: '% less refining and cutting time' },
      oreGrade: { owner: 'smith', name: 'Bar luck', values: [2, 3, 4, 5, 6], desc: '% chance a bar is upgraded one grade' },
      gemGrade: { owner: 'smith', name: 'Gem luck', values: [2, 3, 4, 5, 6], desc: '% chance a gem is upgraded one grade' },
      // stack: false = only the best worn ring of this type counts (no duplicate bonus from the rest)
      foresight: { owner: 'smith', name: 'Foresight', values: [1, 1, 2, 2, 2], stack: false, desc: 'extra guesses and test fights per enemy in the win estimate' },
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
  // Skills level up by themselves from doing the activity. XP from level L to L+1 = xpBase x (L + 1) (level 10 =
  // 5,500 XP). Every skill lists `effects` = { effect: amount per level }; `effects` below says what each effect means.
  // Activity skills work for every material; per-material skills only for their own bar or gem type.
  // A level-10 skill reaches a C-grade smith ring of the same kind (Travel 6% = Travel ring C, Search speed 6%, Search
  // efficiency 12%, General refining and cutting time 6%, bar grade 3%). The other effects have no ring.
  skills: {
    maxLevel: 10,
    xpBase: 100,
    // XP per bar refined / gem cut / bar smithed into gear, for per-material skills without their own `xp`.
    xpPerItem: { copper: 25, iron: 25, steel: 30, mythril: 50, ruby: 25, topaz: 25, sapphire: 30, emerald: 40, diamond: 50 },
    // unit: '%' percent, 'pts' percentage points
    effects: {
      travelTime: { unit: '%', text: 'less travel time' },
      loadPenalty: { unit: '%', text: 'less extra travel time per carried item' },
      searchTime: { unit: '%', text: 'less search time' },
      searchEff: { unit: '%', text: 'more searched per search' },
      debrisClear: { unit: '%', text: 'more debris cleared per search' },
      refineTime: { unit: '%', text: 'less refining time' },
      refineFail: { unit: 'pts', text: 'less refining failure chance' },
      refineUpgrade: { unit: '%', text: 'chance to upgrade a bar one grade' },
      cutTime: { unit: '%', text: 'less cutting time' },
      cutFail: { unit: 'pts', text: 'less cutting failure chance' },
      cutBlend: { unit: '%', text: 'better cutting chances (of the way to a master cutter)' },
      smithTime: { unit: '%', text: 'less smithing time' },
      repairTime: { unit: '%', text: 'less repair time' },
      wear: { unit: '%', text: 'less durability loss in fights' },
    },
    // group: where the Skills tab lists it. xp: XP per one xpUnit.
    activity: {
      travel: { name: 'Travel', group: 'field', effects: { travelTime: 0.6 }, xp: 15, xpUnit: 'map step walked' },
      carrying: { name: 'Carrying', group: 'field', effects: { loadPenalty: 5 }, xp: 2, xpUnit: 'item carried one map step' },
      searchTime: { name: 'Search speed', group: 'field', effects: { searchTime: 0.6 }, xp: 1, xpUnit: 'minute searching' },
      searchEff: { name: 'Search efficiency', group: 'field', effects: { searchEff: 1.2 }, xp: 1, xpUnit: 'minute searching' },
      debris: { name: 'Debris clearing', group: 'field', effects: { debrisClear: 10 }, xp: 1, xpUnit: 'point of debris cleared' },
      refineTime: { name: 'General refining', group: 'workshop', effects: { refineTime: 0.6, refineFail: 0.1 }, xp: 1, xpUnit: 'minute refining' },
      cutTime: { name: 'General cutting', group: 'workshop', effects: { cutTime: 0.6, cutBlend: 1 }, xp: 1, xpUnit: 'minute cutting' },
      repairTime: { name: 'General repair', group: 'workshop', effects: { repairTime: 1 }, xp: 2, xpUnit: 'durability point repaired, per bar in the item' },
      gearCare: { name: 'Gear care', group: 'workshop', effects: { wear: 1 }, xp: 100, xpUnit: 'fight the adventurer survives' },
    },
    // One skill per bar type (materials: 'bars') or gem type ('gems'); name = material + label.
    perMaterial: {
      oreGrade: { label: 'bar grade', materials: 'bars', effects: { refineUpgrade: 0.3 }, xpUnit: 'bar refined' },
      oreFail: { label: 'refining', materials: 'bars', effects: { refineFail: 0.5 }, xpUnit: 'bar refined' },
      smith: { label: 'smithing', materials: 'bars', effects: { smithTime: 2, repairTime: 0.5 }, xpUnit: 'bar smithed into gear' },
      repair: { label: 'repair', materials: 'bars', effects: { repairTime: 3 }, xp: 2.5, xpUnit: 'durability point repaired, per bar in the item' },
      gemGrade: { label: 'grade', materials: 'gems', effects: { cutBlend: 10 }, xpUnit: 'gem cut' },
      gemFail: { label: 'cutting', materials: 'gems', effects: { cutFail: 0.5 }, xpUnit: 'gem cut' },
    },
  },

  // -------------------------------------------------------------- INTEL ----
  // 1 intel point at the end of every daysPerPoint-th day. A track's value = min(max, base + the gains of the points
  // spent on it).
  //   unit: '%' = a chance, 'sight' = sight points (see field.sight), 'count' = extra guesses and test fights.
  //   gains: what each point adds, in order; the last value repeats. Steps get smaller: diminishing returns.
  //   max: the track's ceiling.
  //   tierMult / gradeMult (optional): a track's chance is multiplied by this % for the enemy's tier / the ring's grade
  //   (enemySightFor, ringGradeSightFor in js/core/intel.js).
  // A point that can still raise some track MUST be spent before the next day can start (confirmPlan refuses).
  intel: {
    daysPerPoint: 5,
    tracks: {
      oreSight: { name: 'Ore sight', unit: 'sight', base: 0, gains: [10, 10, 10, 8, 8, 8, 6, 6, 6, 4], max: 100, desc: 'see more of the items still in the ground' },
      enemySight: { name: 'Enemy scouting', unit: '%', base: 10, gains: [6, 6, 6, 4, 4, 4, 3, 3, 3, 2], max: 100,
        tierMult: { normal: 100, elite: 90, champion: 80 }, // % of the chance that applies per enemy tier
        desc: 'chance to see each enemy attribute (a little less for elites, less for champions)' },
      ringTypeSight: { name: 'Ring type scouting', unit: '%', base: 25, gains: [8, 8, 8, 6, 6, 6, 4, 4, 4, 2], max: 100, desc: 'chance to see the type of the ring an enemy drops' },
      ringGradeSight: { name: 'Ring grade scouting', unit: '%', base: 25, gains: [10, 10, 10, 8, 8, 8, 5, 5, 5, 3], max: 100,
        gradeMult: { D: 100, C: 90, B: 80, A: 70, S: 60 }, // % of the chance that applies per ring grade
        desc: 'chance to see the grade of the ring an enemy drops (harder for better grades)' },
      groupSight: { name: 'Banner scouting', unit: '%', base: 20, gains: [10, 10, 10, 6, 6, 6, 4, 4, 4, 2], max: 100, desc: 'chance to see which banner an enemy marches under' },
      simDepth: { name: 'Battle simulation', unit: 'count', base: 0, gains: [1], max: 3, desc: 'extra guesses and test fights per enemy in the win estimate' },
    },
  },

  // ---------------------------------------------------------------- SIM ----
  // The win estimate runs by itself for every enemy. Each count is raised by Battle simulation intel and the best
  // Foresight ring (simCounts in js/core/sim.js). Small on purpose: the estimate is a risk to plan with.
  sim: {
    samples: 5, // random guesses of the hidden enemy attributes per enemy
    evalFights: 5, // fresh fights with the chosen gear per guess (the reported win %)
    fightsPerLoadout: 5, // fights per gear combination when picking the best gear for a guess
    maxExactCombos: 48, // up to this many gear combinations are all tried; above it the gear is picked one type at a time
    searchPasses: 2, // one-type-at-a-time search: at most this many passes over the five gear types
  },

  // ------------------------------------------------------------ BANNERS ----
  // Every enemy marches under one of three banners (random, equally likely; it has no effect on its attributes).
  // For every `defeatsPerReward` wins against the banner your adventurer has beaten most, it captures a pack mule and
  // can pack 1 more item of a random gear type from then on (js/core/groups.js).
  groups: {
    list: { red: { name: 'Red Banner' }, black: { name: 'Black Banner' }, gold: { name: 'Gold Banner' } },
    defeatsPerReward: 4, // wins against your most-beaten banner per extra pack slot
    maxExtraPerType: 1, // each gear type gets at most this many extra slots (so at most 5 pack mules in all)
  },

  // --------------------------------------------------------------- PLAN ----
  plan: {
    perSlot: 2, // items of one gear type the adventurer can pack (before banner pack mules)
    leaveHomeBelow: 50, // "Leave worn gear home" unpacks repairable items below this durability %
  },

  // ------------------------------------------------------------ DISPLAY ----
  // Screen-only numbers: they change what you see, never how the game plays.
  display: {
    dayBarWarnPct: 75, // the work-day bar turns yellow once this % of the day is used
    dayBarLowPct: 90, // ... and red from this %
    chipsPerCell: 3, // Workshop gear overview: items shown per gear type x material cell before "+N"
  },

  // ------------------------------------------------------ BATTLE REPORT ----
  // After a lost fight the run summary replays it (same enemy, now fully known; same rings; seeded). Screen only:
  // bots and the benchmark never run it (js/core/replay.js).
  report: {
    replayFights: 500, // replays with the gear used (and with the best owned gear)
    whatIfFights: 50, // fights per gear combination when searching all owned gear
    whatIfMinGain: 5, // win points a better loadout must gain to count as "would have helped"
    closeCut: 25, // % HP left that splits "close" from "badly" / "easily" in the outcome bar
  },
};
