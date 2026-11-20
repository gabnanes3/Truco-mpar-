// The middle of the table: what the hand is worth (a bottle cap) and the vira on its little slate.

import { append, el, replay, setAttr, setText } from './dom.js';
import { createCard, createCardBack } from './carta.js';
import { tampinha } from './icones.js';
import { nomeDaCarta } from './textos.js';

/**
 * The hand value in a crown cap. It changes colour as the hand heats up: cream 1, yolk 3, orange 6, red 9
 * and 12.
 * @returns {{ el: HTMLElement, set: (value: number, text?: string, label?: string) => void }}
 */
export function createCap() {
  const root = el('div', 'vale');
  root.setAttribute('role', 'img');
  const label = el('span', 'vale__rot', 'vale');
  const number = el('b', 'vale__n');
  append(root, tampinha(), append(el('span', 'vale__txt'), label, number));
  return {
    el: root,
    set(value, text = String(value), labelText) {
      setAttr(root, 'data-v', String(Math.max(1, value)));
      setText(number, text);
      if (labelText !== undefined) setText(label, labelText);
      setAttr(root, 'aria-label', `${label.textContent} ${text}`);
    },
  };
}

/**
 * @typedef {Object} Centre
 * @property {HTMLElement} el
 * @property {(model: import('./modelo.js').TableModel, animate: boolean) => void} update
 */

/** @returns {Centre} */
export function createCentre() {
  const cap = createCap();
  const raiserWord = el('span');
  const raiserName = el('b');
  const raiser = append(el('p', 'vale__quem'), raiserWord, raiserName);
  const stack = append(el('div', 'vira__monte'), createCardBack());
  const manilha = el('b');
  const manilhaLine = append(el('span', 'manilha-rot'), el('span', '', 'manilha'), manilha);
  // The manilha goes on top and the vira slate above the cap: a raise prompt covers the lower half of the
  // table, and the one thing nobody may lose sight of while answering is which rank is the manilha.
  const vira = append(el('div', 'vira'), manilhaLine, stack, el('span', 'vira__rot', 'vira'));
  vira.setAttribute('role', 'group');
  const root = append(el('div', 'centro'), vira, append(el('div', 'centro__valor'), cap.el, raiser));

  let shownValue = 0;
  /** @type {string | null} */
  let shownVira = null;
  /** @type {HTMLElement | null} */
  let viraCard = null;

  return {
    el: root,
    update(model, animate) {
      cap.set(model.value);
      if (animate && shownValue !== 0 && shownValue !== model.value) replay(cap.el, 'anim');
      shownValue = model.value;
      setText(raiserWord, model.raiser ? `${model.raiser.word} de` : '');
      setText(raiserName, model.raiser?.name ?? '');

      if (model.vira !== shownVira) {
        viraCard?.remove();
        viraCard = null;
        if (model.vira !== null) {
          viraCard = createCard(model.vira);
          if (animate) viraCard.classList.add('anim-bater');
          stack.appendChild(viraCard);
        }
        shownVira = model.vira;
      }
      manilhaLine.style.visibility = model.manilha === null ? 'hidden' : '';
      setText(manilha, model.manilha ?? '');
      setAttr(vira, 'aria-label', model.vira === null || model.manilha === null
        ? 'Embaralhando' : `Vira ${nomeDaCarta(model.vira)}: a manilha é ${model.manilha}`);
    },
  };
}
