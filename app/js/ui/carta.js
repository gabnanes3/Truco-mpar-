// The playing card. All 40 fronts come from the same drawing: rank top-left, suit bottom-right.

import { append, el } from './dom.js';
import { estrela, naipe } from './icones.js';
import { apelidoDaManilha, nomeDaCarta } from './textos.js';

/**
 * @typedef {Object} CardOptions
 * @property {boolean} [manilha] yolk frame and star seal
 * @property {boolean} [hand] hand size, a real <button>, and the nickname band on manilhas
 */

/**
 * @param {string} id card id: rank + suit letter, e.g. "Qp"
 * @param {CardOptions} [options]
 * @returns {HTMLElement} a `div` on the table, a `button` in the hand
 */
export function createCard(id, options = {}) {
  const card = el(options.hand ? 'button' : 'div', 'carta');
  if (card instanceof HTMLButtonElement) card.type = 'button';
  else card.setAttribute('role', 'img');
  card.dataset.carta = id;
  card.dataset.cor = id[1] === 'o' || id[1] === 'c' ? 'v' : 'p';
  let label = nomeDaCarta(id);
  append(card, el('b', 'carta__v', id[0]), naipe(id[1], 'carta__n'));
  if (options.hand) card.classList.add('carta--mao');
  if (options.manilha) {
    card.classList.add('carta--manilha');
    append(card, append(el('i', 'carta__selo'), estrela()));
    if (options.hand) {
      const band = el('span', 'carta__faixa', apelidoDaManilha(id));
      // The zap also says it is the top card, where the card is wide enough for it (see cartas.css).
      if (id[1] === 'p') band.appendChild(el('span', 'carta__maior', ' · a maior'));
      card.appendChild(band);
    }
    label += `, manilha (${apelidoDaManilha(id)})`;
  }
  card.setAttribute('aria-label', label);
  return card;
}

/** @returns {HTMLElement} the back: cream border, cobalt field, tile lattice */
export function createCardBack() {
  const back = el('div', 'carta carta--verso');
  back.setAttribute('aria-hidden', 'true');
  return back;
}
