import { GRADES } from '../config.js';

export const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
export const round1 = (v) => Math.round(v * 10) / 10;
export const round2 = (v) => Math.round(v * 100) / 100;
export const gradeIndex = (g) => GRADES.indexOf(g);
export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

// Floating point tolerance for fractional material quantities (repairs use 0.01 bars).
export const EPS = 1e-9;

// "14:05" from minutes after midnight
export function formatClock(min) {
  const m = Math.floor(min + EPS);
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

// "1h 25m" / "12.5m"
export function formatDuration(min) {
  if (min < 60) return `${round1(min)}m`;
  const h = Math.floor(min / 60);
  const m = round1(min - h * 60);
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

// Apply a % reduction (capped) to a base amount.
export function reduced(base, pct, maxPct = 75) {
  return base * (1 - clamp(pct, 0, maxPct) / 100);
}

export function fmtNum(v, digits = 1) {
  const f = 10 ** digits;
  return String(Math.round(v * f) / f);
}

export function deepClone(o) {
  return JSON.parse(JSON.stringify(o));
}
