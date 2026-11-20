// The raise prompt: the red cut-corner sign slammed over the table. Whoever must answer gets the two
// buttons; everybody else sees the same sign while the table makes up its mind.

import { append, button, el, setAttr, setText } from './dom.js';
import { createCap } from './centro.js';
import { chapa, icone } from './icones.js';
import { SEGREDO } from './textos.js';

/** @typedef {import('./modelo.js').RaisePromptModel} RaisePromptModel */

/**
 * @typedef {Object} RaisePrompt
 * @property {HTMLElement} el
 * @property {(model: RaisePromptModel | null, state: { busy: boolean, online: boolean, animate: boolean }) => void} update
 */

/**
 * @param {(accept: boolean) => void} onRespond
 * @returns {RaisePrompt}
 */
export function createRaisePrompt(onRespond) {
  const who = el('span', 'grito__quem');
  const word = el('span', 'grito__palavra');
  word.id = 'pedido-titulo';
  const sign = append(el('div', 'grito'), chapa(288, 100, 11, 'grito__chapa'), who, word);

  const from = createCap({ small: true });
  const to = createCap({ small: true });
  const text = el('p');
  text.id = 'pedido-texto';
  const arrow = icone('seta');
  arrow.classList.add('pedido__seta');
  const rise = append(el('div', 'pedido__sobe'), from.el, arrow, to.el, text);

  const run = button('btn btn--giz');
  append(run, el('span', 'btn__txt', 'Correr'), el('span', 'btn__sub', 'fora da mão'));
  run.addEventListener('click', () => onRespond(false));
  const acceptNote = el('span', 'btn__sub');
  const accept = button('btn');
  append(accept, el('span', 'btn__txt', 'Aceitar'), acceptNote);
  accept.addEventListener('click', () => onRespond(true));

  const secret = append(el('p', 'pedido__segredo'), icone('cadeado'), el('span', '', SEGREDO));
  const root = append(el('section', 'pedido'), sign, rise, append(el('div', 'pedido__acoes'), run, accept), secret);
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-labelledby', 'pedido-titulo');
  root.setAttribute('aria-describedby', 'pedido-texto');
  root.hidden = true;

  return {
    el: root,
    update(model, state) {
      const opening = root.hidden && model !== null;
      root.hidden = model === null;
      if (model === null) return;
      setAttr(root, 'data-modo', model.mode);
      setText(who, model.caller === 'Você' ? 'você pediu' : `${model.caller} pediu`);
      setText(word, `${model.word}!`);
      from.set(model.from);
      to.set(model.to);
      setText(text, model.text);
      setText(acceptNote, `a mão vale ${model.to}`);
      run.disabled = state.busy || !state.online;
      accept.disabled = run.disabled;
      if (opening) root.classList.toggle('anim', state.animate);
    },
  };
}
