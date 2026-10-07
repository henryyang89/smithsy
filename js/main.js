// App shell: load/save, top bar, tabs, side log, phase screens.
// Screen modules export render functions with the signature (root, ctx) — see ctx below.
import { CONFIG } from './config.js';
import * as Game from './core/game.js';
import { atCamp, timeLeft, currentField, returnMinutes } from './core/map.js';
import { formatClock, formatDuration, EPS } from './core/util.js';
import { h, clear } from './ui/dom.js';
import { renderMap } from './ui/mapview.js';
import { renderWorkshop } from './ui/workshop.js';
import { renderAdventurer } from './ui/adventurer.js';
import { renderRings } from './ui/ringsview.js';
import { renderSkills } from './ui/skillsview.js';
import { renderLog } from './ui/logview.js';
import { renderHelp } from './ui/help.js';
import { renderReport, renderPlan, renderGameOver } from './ui/endday.js';

const TABS = [
  { id: 'map', label: 'Map', render: renderMap },
  { id: 'workshop', label: 'Workshop', render: renderWorkshop },
  { id: 'adventurer', label: 'Adventurer', render: renderAdventurer },
  { id: 'rings', label: 'Rings', render: renderRings },
  { id: 'skills', label: 'Skills & Intel', render: renderSkills },
  { id: 'log', label: 'Log', render: renderLog },
  { id: 'help', label: 'Help', render: renderHelp },
];

let state = load() || Game.newGame();

// Per-session UI state (not saved). Screen modules may store their own keys here.
const ui = { tab: 'map' };

// ctx is passed to every render function.
const ctx = {
  get state() {
    return state;
  },
  cfg: CONFIG,
  ui,
  // Run a game action: fn() must return { ok, msg, notes? }. Logs it, toasts failures, saves, re-renders.
  act(fn, opts = {}) {
    let res;
    try {
      res = fn();
    } catch (e) {
      console.error(e);
      res = { ok: false, msg: `Error: ${e.message}` };
    }
    if (res && res.ok) Game.logResult(state, res);
    if (res && res.msg && (!res.ok || opts.toast)) toast(res.msg, res.ok ? 'ok' : 'err');
    save();
    render();
    return res;
  },
  rerender: () => render(),
  save: () => save(),
  toast: (msg, kind) => toast(msg, kind),
  newGame(seed) {
    state = Game.newGame(seed);
    ui.tab = 'map';
    save();
    render();
  },
  setTab(id) {
    ui.tab = id;
    render();
  },
};

function load() {
  try {
    const text = localStorage.getItem(Game.SAVE_KEY);
    return text ? Game.deserialize(text) : null;
  } catch (e) {
    console.warn('Save could not be loaded', e);
    return null;
  }
}

function save() {
  try {
    localStorage.setItem(Game.SAVE_KEY, Game.serialize(state));
    const best = Number(localStorage.getItem(Game.BEST_KEY) || 0);
    if (state.stats.score > best) localStorage.setItem(Game.BEST_KEY, String(state.stats.score));
  } catch (e) {
    /* storage unavailable: game still works for this session */
  }
}

function bestScore() {
  try {
    return Number(localStorage.getItem(Game.BEST_KEY) || 0);
  } catch {
    return 0;
  }
}

let toastTimer = null;
function toast(msg, kind = 'ok') {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.className = `show ${kind}`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.className = ''), 3500);
}

function locationText() {
  if (atCamp(state)) return 'Camp';
  const f = currentField(state);
  return `Field (${state.location.x + 1},${state.location.y + 1}) · distance ${f.dist}`;
}

function renderTopbar() {
  const el = clear(document.getElementById('topbar'));
  const left = timeLeft(state);
  const working = state.phase === 'work';
  const canEnd = working && atCamp(state);
  const away = state.plan ? `Adventurer is fighting ${state.plan.enemy.name} today` : state.day === 1 ? 'Adventurer rests today' : '';
  const parts = [
    h('div', { class: 'brand' }, 'Smithsy'),
    h('div', { class: 'stat' }, h('b', {}, `Day ${state.day}`)),
    h('div', { class: 'stat' }, h('b', {}, formatClock(Math.min(state.time, CONFIG.time.dayEndMin))), ' ', h('span', { class: 'muted' }, left > EPS ? `${formatDuration(left)} left` : 'day over')),
    h('div', { class: 'stat' }, locationText()),
    h('div', { class: 'stat' }, `Bag ${state.bag.length}/${CONFIG.bag.slots}`),
    !atCamp(state) && working ? h('div', { class: 'stat muted' }, `Return: ${formatDuration(returnMinutes(state))}`) : null,
    h('div', { class: 'stat' }, `Score ${state.stats.score}`, h('span', { class: 'muted' }, ` (best ${Math.max(bestScore(), state.stats.score)})`)),
    state.intel.points > 0 ? h('div', { class: 'stat hl' }, `${state.intel.points} intel pt`) : null,
    away ? h('div', { class: 'stat muted' }, away) : null,
    h('div', { class: 'spacer' }),
    working
      ? h('button', {
        class: 'primary',
        disabled: !canEnd,
        title: canEnd ? 'End the day: resolve the fight and plan tomorrow' : 'Return to camp first',
        onclick: () => {
          if (left >= 30 && !confirm(`End day ${state.day} with ${formatDuration(left)} still left?`)) return;
          ctx.act(() => Game.endDay(state));
        },
      }, 'End day')
      : null,
    h('button', {
      class: 'ghost',
      onclick: () => {
        if (confirm('Start a new game? Your current run will be lost.')) ctx.newGame();
      },
    }, 'New game'),
  ];
  el.append(...parts.filter(Boolean));
}

// Outside the work day (report / plan / game over) the phase screen is the first tab and only
// the reference tabs stay available, so the player can check numbers while planning.
const PHASE_SCREENS = {
  report: { label: 'Battle report', render: renderReport },
  plan: { label: 'Plan tomorrow', render: renderPlan },
  over: { label: 'Game over', render: renderGameOver },
};
const PHASE_EXTRA_TABS = ['rings', 'skills', 'log', 'help'];

function phaseTabs() {
  const screen = PHASE_SCREENS[state.phase];
  return [{ id: 'phase', label: screen.label, render: screen.render }, ...TABS.filter((t) => PHASE_EXTRA_TABS.includes(t.id))];
}

function renderTabs() {
  const el = clear(document.getElementById('tabs'));
  if (state.phase !== 'work') {
    if (ui.lastPhase !== state.phase) ui.phaseTab = 'phase';
    ui.lastPhase = state.phase;
    for (const t of phaseTabs()) {
      el.append(h('button', {
        class: ui.phaseTab === t.id ? 'tab active' : 'tab',
        onclick: () => {
          ui.phaseTab = t.id;
          render();
        },
      }, t.label));
    }
    return;
  }
  if (ui.lastPhase === 'plan') ui.tab = 'map'; // a new day starts on the Map
  ui.lastPhase = state.phase;
  for (const t of TABS) el.append(h('button', { class: ui.tab === t.id ? 'tab active' : 'tab', onclick: () => ctx.setTab(t.id) }, t.label));
}

function renderSideLog() {
  const el = clear(document.getElementById('sidelog'));
  el.append(h('h3', {}, 'Recent'));
  const items = state.log.slice(-40).reverse();
  el.append(h('ul', { class: 'log' }, items.map((l) => h('li', {}, h('span', { class: 'muted' }, `D${l.day} ${l.time} `), l.text))));
}

function render() {
  renderTopbar();
  renderTabs();
  renderSideLog();
  const main = clear(document.getElementById('main'));
  try {
    if (state.phase !== 'work') {
      const tabs = phaseTabs();
      (tabs.find((t) => t.id === ui.phaseTab) || tabs[0]).render(main, ctx);
    } else (TABS.find((t) => t.id === ui.tab) || TABS[0]).render(main, ctx);
  } catch (e) {
    console.error(e);
    main.append(h('pre', { class: 'error' }, `Render error: ${e.message}\n${e.stack}`));
  }
}

render();
// Expose for debugging/balancing in the browser console.
window.smithsy = { ctx, Game, CONFIG };
