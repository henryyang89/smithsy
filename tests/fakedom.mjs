// A minimal fake DOM so the UI screens (js/ui/*.js) can be rendered in Node and their text checked.
// Not a test file itself (`node --test tests/*.test.mjs` skips it). It is NOT a browser: nothing is laid out,
// no events fire, and queries find nothing. It supports exactly what the screen modules use while they
// build their tree: createElement (className, style, attributes, listeners, children), createTextNode,
// append / appendChild / removeChild / replaceChildren, firstChild, children, textContent, classList,
// getElementById / querySelector → null, querySelectorAll → [].
//
//   import { installFakeDom, textOf, findAll, countTags } from './fakedom.mjs';
//   installFakeDom();                         // once, before any js/ui module builds a node
//   const root = document.createElement('div');
//   renderMap(root, ctx);
//   assert.match(textOf(root), /0 items seen/);

class FakeNode {
  constructor() {
    this.parentNode = null;
  }
}

class FakeText extends FakeNode {
  constructor(text) {
    super();
    this.nodeType = 3;
    this.data = String(text);
  }

  get textContent() {
    return this.data;
  }

  set textContent(v) {
    this.data = String(v);
  }
}

class FakeElement extends FakeNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attributes = {};
    this.style = {};
    this.className = '';
    this.childNodes = [];
    this.listeners = {};
    // plain properties the screens assign (checked, disabled, value, ...) just live on the object
  }

  get children() {
    return this.childNodes.filter((c) => c.nodeType === 1);
  }

  get firstChild() {
    return this.childNodes[0] || null;
  }

  get lastChild() {
    return this.childNodes[this.childNodes.length - 1] || null;
  }

  get textContent() {
    return this.childNodes.map((c) => c.textContent).join('');
  }

  set textContent(v) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = v === '' || v === null || v === undefined ? [] : [Object.assign(new FakeText(v), { parentNode: this })];
  }

  get classList() {
    const el = this;
    const list = () => el.className.split(/\s+/).filter(Boolean);
    const set = (arr) => { el.className = arr.join(' '); };
    return {
      add: (...c) => set([...new Set([...list(), ...c])]),
      remove: (...c) => set(list().filter((x) => !c.includes(x))),
      toggle: (c, force) => {
        const has = list().includes(c);
        const want = force === undefined ? !has : !!force;
        if (want && !has) set([...list(), c]);
        if (!want && has) set(list().filter((x) => x !== c));
        return want;
      },
      contains: (c) => list().includes(c),
    };
  }

  get dataset() {
    const out = {};
    for (const [k, v] of Object.entries(this.attributes)) {
      if (k.startsWith('data-')) out[k.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase())] = v;
    }
    return out;
  }

  setAttribute(k, v) {
    this.attributes[k] = String(v);
    if (k === 'class') this.className = String(v);
  }

  getAttribute(k) {
    return k in this.attributes ? this.attributes[k] : null;
  }

  hasAttribute(k) {
    return k in this.attributes;
  }

  addEventListener(type, fn) {
    (this.listeners[type] = this.listeners[type] || []).push(fn);
  }

  removeEventListener(type, fn) {
    this.listeners[type] = (this.listeners[type] || []).filter((f) => f !== fn);
  }

  appendChild(c) {
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    this.childNodes.push(c);
    return c;
  }

  append(...cs) {
    for (const c of cs) this.appendChild(typeof c === 'string' || typeof c === 'number' ? new FakeText(c) : c);
  }

  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      c.parentNode = null;
    }
    return c;
  }

  replaceChildren(...cs) {
    this.childNodes.forEach((c) => { c.parentNode = null; });
    this.childNodes = [];
    this.append(...cs);
  }

  contains(n) {
    for (let p = n; p; p = p.parentNode) if (p === this) return true;
    return false;
  }

  querySelector() {
    return null;
  }

  querySelectorAll() {
    return [];
  }

  scrollIntoView() {}

  focus() {}

  blur() {}
}

// Install `document` and `Node` on globalThis (what js/ui/dom.js needs). Safe to call more than once.
export function installFakeDom() {
  if (globalThis.__fakeDom) return globalThis.document;
  const listeners = {};
  globalThis.Node = FakeNode;
  globalThis.document = {
    createElement: (tag) => new FakeElement(tag),
    createTextNode: (text) => new FakeText(text),
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener: (type, fn) => { (listeners[type] = listeners[type] || []).push(fn); },
    removeEventListener: () => {},
  };
  globalThis.__fakeDom = true;
  return globalThis.document;
}

// The text a user would read in the node: all text, in order (like DOM textContent).
export function textOf(node) {
  return node.textContent;
}

// Every element below `node` (depth first), optionally only those matching `pred`.
export function findAll(node, pred = () => true) {
  const out = [];
  const walk = (n) => {
    for (const c of n.childNodes || []) {
      if (c.nodeType !== 1) continue;
      if (pred(c)) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

// How many elements with this tag name are below `node`.
export const countTags = (node, tag) => findAll(node, (el) => el.tagName === String(tag).toUpperCase()).length;

// Elements with a CSS class.
export const withClass = (node, cls) => findAll(node, (el) => el.classList.contains(cls));

// Every `title` / `data-tip` hover text below `node`, joined: hover details are part of what a player can read.
export function tipsOf(node) {
  return findAll(node, (el) => el.attributes.title || el.attributes['data-tip']).map((el) => el.attributes.title || el.attributes['data-tip']).join('\n');
}
