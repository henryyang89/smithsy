// App shell: load/save, top bar, tabs, side log, phase screens.
// Screen modules export render functions with the signature (root, ctx) — see ctx below.
import { CONFIG } from './config.js';
import * as Game from './core/game.js';
import { atCamp, timeLeft, currentField, returnMinutes, projectedLoad } from './core/map.js';
import { formatDuration } from './core/util.js';
import { VERSION } from './version.js';
import { h, clear, tip, isRestoredScroll } from './ui/dom.js';
import { renderMap } from './ui/mapview.js';
import { renderWorkshop } from './ui/workshop.js';
import { renderAdventurer } from './ui/adventurer.js';
import { renderRings } from './ui/ringsview.js';
import { renderSkills } from './ui/skillsview.js';
import { renderLog } from './ui/logview.js';
import { renderHelp } from './ui/help.js';
import { renderReport, renderPlan, renderRunSummary, cancelAnalysis } from './ui/endday.js';
import { clearEstimates } from './ui/estimates.js';
import { dayProgress, clockStatus } from './ui/present.js';

const TABS = [
  { id: 'map', label: 'Map', render: renderMap },
  { id: 'workshop', label: 'Workshop', render: renderWorkshop },
  { id: 'adventurer', label: 'Adventurer', render: renderAdventurer },
  { id: 'rings', label: 'Rings', render: renderRings },
  { id: 'skills', label: 'Skills & Intel', render: renderSkills },
  { id: 'log', label: 'Log', render: renderLog },
  { id: 'help', label: 'Help', render: renderHelp },
];

let startupNote = null;
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
    if (res && res.msg && (!res.ok || opts.toast)) toast(res.msg, res.tone || (res.ok ? 'ok' : 'err')); // an action may colour its own toast (a failed refine is red)
    save();
    render();
    return res;
  },
  rerender: () => render(),
  save: () => save(),
  toast: (msg, kind) => toast(msg, kind),
  newGame(seed) {
    clearEstimates(ctx); // the automatic win estimates belong to the old game
    cancelAnalysis(ctx); // ... and so does a loss analysis that is still being worked out
    state = Game.newGame(seed);
    ui.plan = null;
    ui.tab = 'map';
    save();
    render();
  },
  setTab(id) {
    ui.tab = id;
    render();
  },
};

// Load this version's save. Saves are per version: another version's save is never read, converted or deleted
// (it stays in the browser, so that version still finds it). A save of this version that can't be read is kept
// under a backup key (never deleted) and a new game starts, so a bad save can't leave the page blank.
function load() {
  let text = null;
  const allKeys = [];
  try {
    text = localStorage.getItem(Game.SAVE_KEY);
    for (let i = 0; i < localStorage.length; i++) allKeys.push(localStorage.key(i));
  } catch (e) {
    return null; // storage blocked: play without saving
  }
  if (!text) {
    if (Game.oldSaveKeys(allKeys).length) {
      startupNote = `Smithsy ${VERSION} starts a fresh game: saves do not carry over between versions. Your older save is still in this browser and opens again in that version.`;
    }
    return null;
  }
  try {
    const s = Game.deserialize(text);
    if (!s.map || !s.storage) throw new Error('Save is missing data');
    return s;
  } catch (e) {
    console.warn('Save could not be loaded', e);
    try {
      localStorage.setItem(`smithsy-save-backup-${Date.now()}`, text);
    } catch (e2) {
      /* ignore */
    }
    startupNote = 'Your save could not be loaded, so a new game started (the old save was kept as a backup in browser storage).';
    return null;
  }
}

// When a run is over, remember its score as the best one (per version) once: end.prevBest is the best score from before this
// run, so the run summary can say "New best score!". Lives in the save, so a reload shows the same summary.
function recordBest() {
  if (state.phase !== 'over' || !state.end || state.end.prevBest != null) return;
  try {
    const prev = Number(localStorage.getItem(Game.BEST_KEY) || 0);
    state.end.prevBest = prev;
    if (state.stats.score > prev) localStorage.setItem(Game.BEST_KEY, String(state.stats.score));
  } catch (e) {
    /* storage unavailable: no best score to compare with */
  }
}

function save() {
  recordBest();
  try {
    localStorage.setItem(Game.SAVE_KEY, Game.serialize(state));
  } catch (e) {
    /* storage unavailable: game still works for this session */
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

// Visual bar of the work day (08:00-18:00): empty at the start, it fills from left to right as the day's minutes are used
// (dayProgress). Drawn as a thin strip along the bottom edge of the top bar (CSS: absolute, so it takes no layout space).
function timeBar(day) {
  return h('div', {
    class: `timebar${day.tone === 'ok' ? '' : ` ${day.tone}`}`,
    role: 'progressbar',
    'aria-label': 'Work day used',
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(day.len),
    'aria-valuenow': Math.round(day.used),
    ...tip(day.label),
  }, h('div', { class: 'timebar-fill', style: { width: `${Math.round(day.frac * 1000) / 10}%` } }));
}

function renderTopbar() {
  const el = clear(document.getElementById('topbar'));
  const left = timeLeft(state);
  const day = dayProgress(state, CONFIG);
  const clock = clockStatus(state, left, CONFIG);
  const working = state.phase === 'work';
  const canEnd = working && atCamp(state);
  const field = currentField(state);
  const load = projectedLoad(state);
  const away = state.plan ? `Adventurer is fighting ${state.plan.enemy.name} today` : state.day === 1 ? 'Adventurer rests today' : '';
  const parts = [
    h('div', { class: 'brand' }, 'Smithsy', h('span', { class: 'version', ...tip(`Smithsy version ${VERSION} (see Help and CHANGELOG.md)`) }, `v${VERSION}`)),
    h('div', { class: 'stat' }, h('b', {}, `Day ${state.day}`)),
    h('div', { class: 'stat timestat', ...tip(clock.label) }, clock.clock ? [h('b', {}, clock.clock), ' '] : null, h('span', { class: 'muted' }, clock.note)),
    h('div', { class: 'stat' }, locationText()),
    h('div', { class: 'stat' }, `Bag ${state.bag.length}/${CONFIG.bag.slots}`,
      field && field.pile && field.pile.length ? h('span', { class: 'muted', ...tip('Items waiting in this field\'s pile') }, ` · pile ${field.pile.length}`) : null),
    !atCamp(state) && working ? h('div', { class: 'stat muted', ...tip(`Walk home with a full load (${load} items: bag + this field's pile, up to ${CONFIG.bag.slots})`) }, `Return: ${formatDuration(returnMinutes(state, state.location, load))}`) : null,
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
    state.phase !== 'over'
      ? h('button', {
        class: 'ghost',
        id: 'end-run',
        title: 'Retire the adventurer and see your score',
        onclick: () => {
          const planned = state.plan ? ` Today's fight against ${state.plan.enemy.name} will not happen.` : '';
          if (confirm(`End this run now? Your adventurer retires and the run is scored, the same as a lost fight would score it. You can't continue it afterwards.${planned}`)) ctx.act(() => Game.endRun(state));
        },
      }, 'End run')
      : h('button', { class: 'primary', onclick: () => ctx.newGame() }, 'New game'),
  ];
  if (clock.bar) parts.push(timeBar(day));
  el.append(...parts.filter(Boolean));
}

// Outside the work day (report / plan / game over) the phase screen is the first tab and only
// the reference tabs stay available, so the player can check numbers while planning.
const PHASE_SCREENS = {
  report: { label: 'Battle report', render: renderReport },
  plan: { label: 'Plan tomorrow', render: renderPlan },
  over: { label: 'Run summary', render: renderRunSummary },
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
  const main = clear(document.getElementById('main'));
  ui.est_screen = null; // the screen drawn below says it is the estimating one (scheduleEstimates); see ui/estimates.js
  try {
    renderTopbar();
    renderTabs();
    renderSideLog();
    if (state.phase !== 'work') {
      const tabs = phaseTabs();
      (tabs.find((t) => t.id === ui.phaseTab) || tabs[0]).render(main, ctx);
    } else (TABS.find((t) => t.id === ui.tab) || TABS[0]).render(main, ctx);
  } catch (e) {
    console.error(e);
    main.append(
      h('pre', { class: 'error' }, `Render error: ${e.message}\n${e.stack}`),
      h('button', { onclick: () => { if (confirm('Start a new game? Your current run will be lost.')) ctx.newGame(); } }, 'Start a new game'),
    );
  }
}

// Hover details on touch screens. A `title` never shows on a phone, so an element built with tip() (js/ui/dom.js)
// also carries data-tip; tapping it opens the small popover #tip under it. The next tap anywhere, or a scroll,
// closes it. Mouse users keep the normal title hover (pointerType 'mouse' is ignored).
function installTips() {
  const pop = document.getElementById('tip');
  if (!pop) return;
  let open = null;
  const hide = () => {
    pop.className = '';
    open = null;
  };
  document.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse') return;
    const el = e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
    // a tap on an enabled button or a checkbox does what it says: no popover (it would keep showing out-of-date text after the re-render)
    const control = e.target && e.target.closest ? e.target.closest('button:not(:disabled), input:not(:disabled)') : null;
    if (!el || el === open || control) {
      hide();
      return;
    }
    open = el;
    pop.textContent = el.getAttribute('data-tip');
    pop.className = 'show';
    const r = el.getBoundingClientRect();
    const w = pop.offsetWidth;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - w - 8))}px`;
    const below = r.bottom + 6;
    pop.style.top = `${below + pop.offsetHeight > window.innerHeight - 8 ? Math.max(8, r.top - pop.offsetHeight - 6) : below}px`;
  });
  window.addEventListener('scroll', (e) => {
    if (!isRestoredScroll(e.target)) hide(); // a screen putting a scroll box back after a re-render is not the player scrolling
  }, true);
}

installTips();
render();
if (startupNote) {
  save();
  toast(startupNote, 'ok');
}
// Expose for debugging/balancing in the browser console.
window.smithsy = { ctx, Game, CONFIG };
