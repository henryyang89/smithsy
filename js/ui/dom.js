// Tiny DOM helpers shared by all UI modules.

// h('div', { class: 'x', onclick: fn, title: 't' }, child, 'text', [more children])
export function h(tag, attrs = {}, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c === null || c === undefined || c === false) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export function clear(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
  return el;
}

// Simple table: headers = ['A','B'], rows = [[cell, cell], ...] (cells may be nodes)
export function table(headers, rows, attrs = {}) {
  return h('table', attrs,
    headers ? h('thead', {}, h('tr', {}, headers.map((x) => h('th', {}, x)))) : null,
    h('tbody', {}, rows.map((r) => h('tr', {}, r.map((c) => h('td', {}, c))))));
}

export function section(title, ...children) {
  return h('section', { class: 'panel' }, h('h3', {}, title), ...children);
}

export function button(label, onclick, attrs = {}) {
  return h('button', { ...attrs, onclick }, label);
}

// Horizontal percent bar
export function bar(pct, cls = '') {
  return h('div', { class: `bar ${cls}` }, h('div', { class: 'bar-fill', style: { width: `${Math.max(0, Math.min(100, pct))}%` } }));
}

export const pct = (v, d = 1) => `${Math.round(v * 10 ** d) / 10 ** d}%`;
export const num = (v, d = 1) => String(Math.round(v * 10 ** d) / 10 ** d);
