import { h } from './dom.js';
import * as Game from '../core/game.js';

// STUB — to be implemented.
export function renderReport(root, ctx) {
  root.append(h('p', {}, 'Battle report (stub)'), h('button', { onclick: () => ctx.act(() => Game.acknowledgeReport(ctx.state)) }, 'Continue'));
}
export function renderPlan(root, ctx) {
  root.append(h('p', {}, 'Plan (stub)'), h('button', { onclick: () => ctx.act(() => Game.confirmPlan(ctx.state, { enemyIndex: 0, gearIds: [], ringIds: [] })) }, 'Confirm'));
}
export function renderGameOver(root, ctx) {
  root.append(h('p', {}, 'Game over (stub)'), h('button', { onclick: () => ctx.newGame() }, 'New game'));
}
