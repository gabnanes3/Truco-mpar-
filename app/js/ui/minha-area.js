// My corner, always in the same place and in the dark: my plate, whose turn it is and how long is left,
// my cards, the raise sign under the right thumb, the taunt picker, and the hand result.

import { TAUNTS } from '../net/taunts.js';
import { append, button, el, setAttr, setText, syncKeyed } from './dom.js';
import { createCard } from './carta.js';
import { createCap } from './centro.js';
import { chapa, icone } from './icones.js';
import { createPlate } from './placa.js';

/** @typedef {import('./modelo.js').TableModel} TableModel */
/** @typedef {import('./modelo.js').ResultModel} ResultModel */

/** The clock turns red and blinks for the last seconds. */
const URGENT_SECONDS = 5;

/**
 * @typedef {Object} MyAreaCallbacks
 * @property {(card: string) => void} onPlay
 * @property {() => void} onRaise
 * @property {(tauntId: string) => void} onTaunt
 */
/**
 * @typedef {Object} MyArea
 * @property {HTMLElement} el
 * @property {import('./placa.js').Plate} plate
 * @property {(model: TableModel, state: { busy: boolean, tauntReady: boolean, animate: boolean, dealt: boolean }) => void} update
 * @property {(seconds: number | null, fraction: number) => void} setClock
 * @property {() => void} closePicker
 */

/**
 * @param {MyAreaCallbacks} callbacks
 * @returns {MyArea}
 */
export function createMyArea(callbacks) {
  const plate = createPlate({ mine: true });

  // ---- whose turn + countdown
  const callLabel = el('span', 'tempo__rot');
  const call = el('span', 'tempo__vez');
  const number = el('b', 'tempo__n');
  const digits = document.createTextNode('');
  append(number, digits, el('small', '', 's'));
  const fill = el('i');
  const clock = append(el('div', 'tempo'), append(el('span', 'tempo__txt'), callLabel, call), number, append(el('span', 'tempo__trilho'), fill));
  clock.setAttribute('role', 'timer');

  // ---- taunts
  const tauntButton = button('icone-btn icone-btn--lousa', 'Provocar a mesa');
  tauntButton.appendChild(icone('balao'));
  tauntButton.setAttribute('aria-haspopup', 'true');
  /** @type {HTMLElement | null} */
  let picker = null;

  // ---- hand + raise sign
  const cards = el('div', 'mao__cartas');
  const emptyHand = el('p', 'mao__vazio');
  const raiseWord = el('span', 'pedir__grito');
  const raiseNote = el('span', 'pedir__vale');
  const raise = button('pedir');
  append(raise, chapa(98, 112, 9, 'pedir__chapa'), el('span', 'pedir__rot', 'pedir'), raiseWord, raiseNote);
  raise.addEventListener('click', () => callbacks.onRaise());
  const hand = append(el('div', 'mao'), cards, emptyHand, raise);

  // ---- spectators get a notice instead of a hand
  const watching = append(
    el('div', 'assistindo'),
    icone('olho'),
    append(el('div'), el('h2', '', 'Você está assistindo'), el('p', '', 'Na próxima partida tem cadeira pra você.')),
  );

  // ---- hand result, laid over the hand zone so nothing moves
  const resultCap = createCap();
  const resultTitle = el('h2', 'resultado__titulo');
  const resultDetail = el('p', 'resultado__detalhe');
  const result = append(el('div', 'resultado'), resultCap.el, append(el('div', 'resultado__txt'), resultTitle, resultDetail));
  result.setAttribute('role', 'status');
  result.hidden = true;
  let resultKey = '';

  const zone = append(el('div', 'meu__zona'), hand, watching, result);
  const hint = el('p', 'dica');
  const root = append(el('section', 'meu'), append(el('div', 'meu__barra'), plate.el, clock, tauntButton), zone, hint);
  root.setAttribute('aria-label', 'Sua mão');

  function closePicker() {
    picker?.remove();
    picker = null;
    tauntButton.setAttribute('aria-expanded', 'false');
  }

  function openPicker() {
    const list = el('div', 'provocar__lista');
    for (const taunt of TAUNTS) {
      const option = button('provocar__op');
      option.textContent = taunt.text;
      option.addEventListener('click', () => {
        closePicker();
        callbacks.onTaunt(taunt.id);
      });
      list.appendChild(option);
    }
    picker = append(el('div', 'provocar'), el('span', 'rot provocar__titulo', 'provocar a mesa'), list);
    picker.setAttribute('role', 'group');
    picker.setAttribute('aria-label', 'Provocações');
    root.appendChild(picker);
    tauntButton.setAttribute('aria-expanded', 'true');
  }

  tauntButton.addEventListener('click', () => (picker ? closePicker() : openPicker()));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && picker) {
      closePicker();
      tauntButton.focus();
    }
  });

  /** @param {ResultModel | null} model @param {boolean} animate */
  function renderResult(model, animate) {
    result.hidden = model === null;
    if (model === null) {
      resultKey = '';
      return;
    }
    resultCap.set(model.value, model.capText, model.unit);
    setText(resultTitle, model.title);
    setText(resultDetail, model.detail);
    setAttr(result, 'data-eu', model.mine);
    result.classList.toggle('anim', animate && resultKey !== model.key);
    resultKey = model.key;
  }

  return {
    el: root,
    plate,
    closePicker,
    update(model, state) {
      plate.update(model.me, state.animate);

      setAttr(clock, 'data-modo', model.turnMode);
      setText(callLabel, model.turnLabel);
      callLabel.hidden = model.turnLabel === '';
      setText(call, model.turnCall);

      tauntButton.hidden = model.spectator;
      tauntButton.disabled = !model.canTaunt || !state.tauntReady;
      if (tauntButton.disabled) closePicker();

      hand.hidden = model.spectator;
      watching.hidden = !model.spectator;
      const playable = model.playable && !state.busy;
      setAttr(cards, 'data-n', String(model.cards.length));
      setAttr(cards, 'data-jogavel', playable);
      syncKeyed(cards, model.cards, (card) => card.id, (card, index) => {
        const node = createCard(card.id, { manilha: card.manilha, hand: true });
        if (state.dealt) {
          node.classList.add('anim-distribuir');
          node.style.setProperty('--i', String(index));
        }
        node.addEventListener('click', () => callbacks.onPlay(card.id));
        return node;
      }, (node) => {
        /** @type {HTMLButtonElement} */ (node).disabled = !playable;
      });
      cards.hidden = model.cards.length === 0 && model.emptyHand !== '';
      emptyHand.hidden = !cards.hidden;
      setText(emptyHand, model.emptyHand);

      if (model.raiseButton) {
        const { word, enabled, note } = model.raiseButton;
        setText(raiseWord, word);
        setText(raiseNote, note);
        setAttr(raise, 'data-palavra', word);
        raise.disabled = !enabled || state.busy;
        setAttr(raise, 'aria-label', enabled ? `Pedir ${word.toLowerCase()}: ${note}` : `Pedir ${word.toLowerCase()} (${note})`);
      }

      renderResult(model.result, state.animate);
      setText(hint, model.hint);
    },
    setClock(seconds, fraction) {
      setAttr(clock, 'data-sem-relogio', seconds === null);
      setAttr(clock, 'data-urgente', seconds !== null && seconds <= URGENT_SECONDS);
      if (seconds !== null) {
        const text = String(seconds);
        if (digits.data !== text) digits.data = text;
        fill.style.transform = `scaleX(${fraction.toFixed(3)})`;
        setAttr(clock, 'aria-label', `${callLabel.textContent} ${call.textContent}: ${seconds} segundos`.trim());
      } else {
        setAttr(clock, 'aria-label', `${callLabel.textContent} ${call.textContent}`.trim());
      }
    },
  };
}
