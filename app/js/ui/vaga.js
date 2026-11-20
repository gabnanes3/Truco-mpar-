// A slot on the table: where one player's card lands. Holds at most one current card (keyed by its id, so
// re-renders never restart its animation) plus cards on their way out, which always remove themselves.

import { append, el, setAttr, setText } from './dom.js';
import { createCard } from './carta.js';
import { gizAnel } from './icones.js';

/** @typedef {import('./modelo.js').TableCardModel} TableCardModel */

const FADE_MS = 180;
const COLLECT_MS = 380;

/**
 * @typedef {Object} Slot
 * @property {HTMLElement} el
 * @property {(card: TableCardModel | null, waiting: boolean, animate: boolean) => void} update
 * @property {(holdMs: number, target: Element | null) => void} sendOff after `holdMs`, the current card
 *   slides to `target` (or just fades) and is removed; the slot is free for a new card right away
 * @property {() => void} flush removes at once every card that is on its way out
 * @property {() => void} destroy
 */

/**
 * @param {string} [className] extra class for the slot
 * @returns {Slot}
 */
export function createSlot(className) {
  const root = el('div', className ? `vaga ${className}` : 'vaga');
  /** @type {{ id: string, wrap: HTMLElement, card: HTMLElement, ring: SVGSVGElement | null, note: HTMLElement | null } | null} */
  let current = null;
  /** @type {Set<number>} */
  const timers = new Set();
  /** Cards sent off and not yet removed. @type {Set<HTMLElement>} */
  const leaving = new Set();

  function flush() {
    for (const wrap of leaving) wrap.remove();
    leaving.clear();
  }

  /** @param {() => void} task @param {number} ms */
  function later(task, ms) {
    const timer = window.setTimeout(() => {
      timers.delete(timer);
      task();
    }, ms);
    timers.add(timer);
  }

  /** @param {HTMLElement} wrap @param {boolean} animate */
  function dismiss(wrap, animate) {
    if (!animate) {
      wrap.remove();
      return;
    }
    wrap.classList.add('anim-sumir');
    later(() => wrap.remove(), FADE_MS);
  }

  return {
    el: root,
    update(model, waiting, animate) {
      setAttr(root, 'data-espera', waiting && model === null);
      if (model === null || current?.id !== model.id) {
        if (current) dismiss(current.wrap, animate);
        current = null;
      }
      if (model === null) return;
      if (current === null) {
        flush(); // a new card never lands on top of one that is still leaving
        const card = createCard(model.id, { manilha: model.manilha });
        const wrap = append(el('div', animate ? 'vaga__jogada anim-bater' : 'vaga__jogada'), card);
        root.appendChild(wrap);
        current = { id: model.id, wrap, card, ring: null, note: null };
      }
      current.card.classList.toggle('carta--anulada', model.voided);
      setAttr(current.card, 'data-destaque', model.mark !== null && !model.voided);
      if (model.mark !== null && current.ring === null) {
        current.ring = gizAnel();
        if (animate) current.ring.classList.add('anim-riscar');
        current.note = el('span', 'vaga__nota');
        append(current.wrap, current.ring, current.note);
      } else if (model.mark === null && current.ring !== null) {
        current.ring.remove();
        current.note?.remove();
        current.ring = null;
        current.note = null;
      }
      if (current.note && model.mark) setText(current.note, model.mark);
    },
    sendOff(holdMs, target) {
      if (current === null) return;
      const { wrap } = current;
      current = null;
      leaving.add(wrap);
      later(() => {
        if (target) {
          const from = wrap.getBoundingClientRect();
          const to = target.getBoundingClientRect();
          wrap.style.setProperty('--para-x', `${Math.round(to.left + to.width / 2 - from.left - from.width / 2)}px`);
          wrap.style.setProperty('--para-y', `${Math.round(to.top + to.height / 2 - from.top - from.height / 2)}px`);
        }
        wrap.classList.remove('anim-bater');
        wrap.classList.add(target ? 'anim-recolher' : 'anim-sumir');
        later(() => {
          leaving.delete(wrap);
          wrap.remove();
        }, target ? COLLECT_MS : FADE_MS);
      }, holdMs);
    },
    flush,
    destroy() {
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
    },
  };
}
