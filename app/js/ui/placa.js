// The seat plate: cobalt enamel with a cream inset line. Two lines say everything about a player: the name,
// then the score chip plus one state tag. States change the plate's material, not only its text.

import { append, el, replay, setAttr, setText } from './dom.js';
import { icone } from './icones.js';

/** @typedef {import('./modelo.js').SeatModel} SeatModel */
/** @typedef {import('./modelo.js').TagModel} TagModel */

/**
 * @typedef {Object} Plate
 * @property {HTMLElement} el
 * @property {(seat: SeatModel, animate: boolean) => void} update
 * @property {(seconds: number | null) => void} setSeconds countdown shown by a 'tempo' tag
 * @property {(text: string, ms: number, animate: boolean) => void} say speech bubble (a taunt)
 * @property {() => void} destroy
 */

/**
 * @param {{ mine?: boolean }} [options]
 * @returns {Plate}
 */
export function createPlate(options = {}) {
  const root = el('div', options.mine ? 'placa placa--eu' : 'placa');
  root.setAttribute('role', 'group');
  const dealer = append(el('span', 'placa__deu'), icone('baralho'), el('span', '', 'deu'));
  dealer.hidden = true;
  const name = el('span', 'placa__nome');
  const score = el('b', 'pontos');
  const tagIcon = el('span', 'etq__icone');
  const tagShort = el('span', 'etq__curto');
  const tagLong = el('span', 'etq__longo');
  const tagEl = append(el('span', 'etq'), tagIcon, tagShort, tagLong);
  append(root, dealer, name, append(el('span', 'placa__linha'), score, tagEl));

  /** @type {TagModel | null} */
  let tag = null;
  /** @type {number | null} */
  let seconds = null;
  let shownIcon = '';
  /** @type {number | null} */
  let lastScore = null;
  /** @type {HTMLElement | null} */
  let bubble = null;
  let bubbleTimer = 0;

  function renderTag() {
    tagEl.hidden = tag === null;
    if (tag === null) return;
    setAttr(tagEl, 'data-tipo', tag.kind);
    setAttr(tagEl, 'data-tom', tag.tone);
    const wantedIcon = tag.icon ?? '';
    if (wantedIcon !== shownIcon) {
      tagIcon.replaceChildren(...(tag.icon ? [icone(tag.icon)] : []));
      shownIcon = wantedIcon;
    }
    if (tag.kind === 'tempo') {
      setText(tagShort, seconds === null ? tag.long : `${seconds}s`);
      setText(tagLong, seconds === null ? tag.long : `${tag.long} · ${seconds}s`);
    } else {
      setText(tagShort, tag.short);
      setText(tagLong, tag.long);
    }
  }

  function hush() {
    clearTimeout(bubbleTimer);
    bubble?.remove();
    bubble = null;
    root.closest('.lugar')?.removeAttribute('data-fala');
  }

  return {
    el: root,
    update(seat, animate) {
      setText(name, seat.name);
      setText(score, String(seat.score));
      if (animate && lastScore !== null && seat.score > lastScore) replay(score, 'anim');
      lastScore = seat.score;
      setAttr(root, 'data-estado', seat.state === 'ativo' ? null : seat.state);
      setAttr(root, 'data-caiu', seat.disconnected);
      setAttr(root, 'data-vez', seat.acting);
      dealer.hidden = !seat.dealer;
      tag = seat.tag;
      renderTag();
      const notes = [seat.name, `${seat.score} pontos`, seat.dealer ? 'deu as cartas' : '', seat.tag?.long ?? ''];
      setAttr(root, 'aria-label', notes.filter(Boolean).join(', '));
    },
    setSeconds(value) {
      if (value === seconds) return;
      seconds = value;
      if (tag?.kind === 'tempo') renderTag();
    },
    say(text, ms, animate) {
      hush();
      bubble = el('div', animate ? 'balao anim' : 'balao', text);
      root.appendChild(bubble);
      root.closest('.lugar')?.setAttribute('data-fala', '');
      bubbleTimer = window.setTimeout(hush, ms);
    },
    destroy: hush,
  };
}
