// Display helpers that need no DOM (so tests and tools can use them). Each turns game numbers into the text the
// player reads; the game itself keeps its own, more exact numbers.
import { shownDurability } from '../core/gear.js';

// Durability as the player reads it: a whole number ("63%"), never a decimal. Costs and times use the exact value.
export const durText = (d) => `${shownDurability(d)}%`;

// What a repair adds, as shown on the Repair button: the gap between the SHOWN durability and 100, so the shown
// durability plus the shown gain always add up to 100.
export const repairGainShown = (d) => 100 - shownDurability(d);

// A win chance in whole percent: "62%".
export const winText = (v) => `${Math.round(v)}%`;
