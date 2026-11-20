// A raise on the table, in two pieces that never cover a played card:
// - the red cut-corner sign, slammed on the bottom edge of the table for as long as the raise is pending;
// - the two answer buttons, which take the place of the raise plate beside my cards, under the right thumb.

import { append, button, el, setAttr, setText } from './dom.js';
import { chapa } from './icones.js';

/** @typedef {import('./modelo.js').RaisePromptModel} RaisePromptModel */

/**
 * @typedef {Object} RaiseSign
 * @property {HTMLElement} el
 * @property {(model: RaisePromptModel | null, animate: boolean) => void} update
 */

/** @returns {RaiseSign} */
export function createRaiseSign() {
  const who = el('span', 'grito__quem');
  const word = el('span', 'grito__palavra');
  const sign = append(el('div', 'grito'), chapa(288, 86, 11, 'grito__chapa'), who, word);
  const root = append(el('div', 'pedido'), sign);
  root.setAttribute('role', 'status');
  root.hidden = true;

  return {
    el: root,
    update(model, animate) {
      const opening = root.hidden && model !== null;
      root.hidden = model === null;
      if (model === null) return;
      setText(who, model.caller === null ? 'você pediu' : `${model.caller} pediu`);
      setText(word, `${model.word}!`);
      setAttr(root, 'aria-label', model.label);
      if (opening) root.classList.toggle('anim', animate);
    },
  };
}

/**
 * @typedef {Object} RaiseAnswer
 * @property {HTMLElement} el
 * @property {(model: RaisePromptModel | null, state: { busy: boolean, online: boolean }) => void} update
 *   shown only while the viewer has to answer
 */

/**
 * @param {(accept: boolean) => void} onRespond
 * @returns {RaiseAnswer}
 */
export function createRaiseAnswer(onRespond) {
  const acceptNote = el('span', 'btn__sub');
  const accept = button('btn responder__aceitar');
  append(accept, el('span', 'btn__txt', 'Aceitar'), acceptNote);
  accept.addEventListener('click', () => onRespond(true));
  const run = button('btn btn--giz responder__correr');
  append(run, el('span', 'btn__txt', 'Correr'), el('span', 'btn__sub', 'fora da mão'));
  run.addEventListener('click', () => onRespond(false));

  const root = append(el('div', 'responder'), accept, run);
  root.setAttribute('role', 'group');
  root.hidden = true;

  return {
    el: root,
    update(model, state) {
      const answering = model !== null && model.mustAnswer;
      root.hidden = !answering;
      if (!answering) return;
      setAttr(root, 'aria-label', model.label);
      setText(acceptNote, `vale ${model.to}`);
      accept.disabled = state.busy || !state.online;
      run.disabled = accept.disabled;
    },
  };
}
