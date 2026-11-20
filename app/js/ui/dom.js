// Tiny DOM helpers. Player-provided strings only ever reach the page through textContent.

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {string} tag
 * @param {string} [className]
 * @param {string} [text]
 * @returns {HTMLElement}
 */
export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/**
 * @param {string} className
 * @param {string} [label] accessible name
 * @returns {HTMLButtonElement}
 */
export function button(className, label) {
  const node = document.createElement('button');
  node.type = 'button';
  node.className = className;
  if (label) node.setAttribute('aria-label', label);
  return node;
}

/**
 * Builds an inline SVG from markup that is a constant of this code base (never from user data).
 * @param {string} viewBox
 * @param {string} staticMarkup
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function svg(viewBox, staticMarkup, className) {
  const node = document.createElementNS(SVG_NS, 'svg');
  node.setAttribute('viewBox', viewBox);
  node.setAttribute('aria-hidden', 'true');
  node.setAttribute('focusable', 'false');
  if (className) node.setAttribute('class', className);
  node.innerHTML = staticMarkup;
  return node;
}

/**
 * @template {Node} T
 * @param {T} parent
 * @param {...(Node | null)} children
 * @returns {T}
 */
export function append(parent, ...children) {
  for (const child of children) if (child) parent.appendChild(child);
  return parent;
}

/** @param {Node} node @param {string} text */
export function setText(node, text) {
  if (node.textContent !== text) node.textContent = text;
}

/**
 * Sets or removes an attribute, touching the DOM only when the value changes.
 * @param {Element} node
 * @param {string} name
 * @param {string | boolean | null | undefined} value false / null / undefined remove it, true sets it empty
 */
export function setAttr(node, name, value) {
  const wanted = value === false || value === null || value === undefined ? null : value === true ? '' : value;
  if (node.getAttribute(name) === wanted) return;
  if (wanted === null) node.removeAttribute(name);
  else node.setAttribute(name, wanted);
}

/**
 * Keeps `parent`'s element children in sync with `items`, reusing the element of each key, so CSS
 * transitions keep running and focus is never lost on a re-render.
 * @template T
 * @param {Element} parent
 * @param {readonly T[]} items
 * @param {(item: T) => string} keyOf
 * @param {(item: T, index: number) => HTMLElement} create
 * @param {(node: HTMLElement, item: T, index: number) => void} [update]
 */
export function syncKeyed(parent, items, keyOf, create, update) {
  /** @type {Map<string, HTMLElement>} */
  const existing = new Map();
  for (const child of Array.from(parent.children)) {
    if (child instanceof HTMLElement && child.dataset.key !== undefined) existing.set(child.dataset.key, child);
  }
  /** @type {Element | null} */
  let cursor = parent.firstElementChild;
  items.forEach((item, index) => {
    const key = keyOf(item);
    let node = existing.get(key);
    if (node) {
      existing.delete(key);
    } else {
      node = create(item, index);
      node.dataset.key = key;
    }
    if (update) update(node, item, index);
    if (node === cursor) cursor = cursor.nextElementSibling;
    else parent.insertBefore(node, cursor);
  });
  for (const stale of existing.values()) stale.remove();
}

/**
 * Restarts a CSS animation tied to a class, e.g. the score chip popping.
 * @param {Element} node
 * @param {string} className
 */
export function replay(node, className) {
  node.classList.remove(className);
  void node.getBoundingClientRect();
  node.classList.add(className);
}

/** @returns {boolean} */
export function reducedMotion() {
  return typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}
