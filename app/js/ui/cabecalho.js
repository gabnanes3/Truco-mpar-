// The top bar: hand number, match target, round tracker, sound and leave buttons, and the announcement
// strip that briefly covers the tracker (connection trouble, raise outcomes) without moving the table.

import { append, button, el, setAttr, setText, syncKeyed } from './dom.js';
import { icone } from './icones.js';

/** @typedef {import('./modelo.js').TableModel} TableModel */
/** @typedef {import('./modelo.js').RoundCell} RoundCell */

const NEWS_MS = 2800;

/**
 * @typedef {Object} Header
 * @property {HTMLElement} el
 * @property {(model: TableModel) => void} update
 * @property {(on: boolean) => void} setSound
 * @property {(lines: string[], animate: boolean) => void} announce transient news; also read by screen readers
 * @property {() => void} destroy
 */

/**
 * @param {{ onToggleSound: () => void, onLeave: () => void }} callbacks
 * @returns {Header}
 */
export function createHeader(callbacks) {
  const brand = document.createElement('img');
  brand.className = 'topo__marca';
  brand.src = new URL('../../assets/img/marca-linha.svg', import.meta.url).href;
  brand.alt = 'Truco Ímpar';
  const code = el('b');
  const room = append(el('div', 'topo__sala'), el('span', 'rot', 'mesa'), code);
  const handNumber = el('b');
  const target = el('b');
  const hand = append(
    el('div', 'topo__mao'),
    append(el('span', 'topo__num'), el('span', 'rot', 'mão'), handNumber),
    append(el('span', 'topo__ate'), document.createTextNode('até '), target),
  );
  const rounds = el('ol', 'rodadas');
  rounds.setAttribute('aria-label', 'Rodadas desta mão');

  const strip = el('div', 'topo__aviso');
  strip.hidden = true;
  const stripIcon = el('span');
  const stripText = el('span');
  append(strip, stripIcon, stripText);
  const live = el('div', 'so-leitor');
  live.setAttribute('aria-live', 'polite');

  const sound = button('icone-btn', 'Som');
  sound.addEventListener('click', callbacks.onToggleSound);
  const leave = button('icone-btn', 'Sair da mesa');
  leave.appendChild(icone('sair'));
  leave.addEventListener('click', callbacks.onLeave);

  const root = append(el('header', 'topo'), brand, room, hand, rounds, sound, leave, strip, live);

  /** @type {import('./modelo.js').BannerModel | null} */
  let banner = null;
  /** @type {string | null} */
  let news = null;
  let newsTimer = 0;
  let shownIcon = '';

  /** @param {boolean} animate */
  function renderStrip(animate) {
    const text = banner?.text ?? news;
    const wasHidden = strip.hidden;
    strip.hidden = text === null;
    if (text === null) return;
    setText(stripText, text);
    setAttr(strip, 'data-tom', banner?.tone ?? 'calmo');
    const wantedIcon = banner?.icon ?? '';
    if (wantedIcon !== shownIcon) {
      stripIcon.replaceChildren(...(banner ? [icone(banner.icon)] : []));
      shownIcon = wantedIcon;
    }
    stripIcon.hidden = banner === null;
    strip.classList.toggle('anim', animate && wasHidden);
  }

  /** @param {RoundCell} _cell @param {number} index @returns {HTMLElement} */
  function createCell(_cell, index) {
    const item = el('li', 'rodada');
    append(item, el('span', 'rodada__n', `${index + 1}ª`), el('span', 'rodada__quem'), el('span', 'rodada__extra', ' em jogo'));
    return item;
  }

  /** @param {HTMLElement} item @param {RoundCell} cell */
  function updateCell(item, cell) {
    if (item.dataset.estado === cell.state && item.dataset.quem === cell.who) return;
    item.dataset.estado = cell.state;
    item.dataset.quem = cell.who;
    setAttr(item, 'aria-current', cell.state === 'agora' ? 'step' : null);
    item.querySelector('svg')?.remove();
    if (cell.state === 'ganha') item.prepend(icone('check'));
    const [, who, extra] = /** @type {HTMLElement[]} */ (Array.from(item.querySelectorAll('span')));
    setText(who, cell.who);
    who.hidden = cell.who === '';
    extra.hidden = cell.state !== 'agora';
  }

  return {
    el: root,
    update(model) {
      setText(code, model.code);
      setText(handNumber, String(Math.max(1, model.handNumber)));
      setText(target, String(model.target));
      setAttr(hand, 'aria-label', `Mão ${Math.max(1, model.handNumber)}, partida até ${model.target} pontos`);
      syncKeyed(rounds, model.rounds, (cell) => String(model.rounds.indexOf(cell)), createCell, updateCell);
      banner = model.banner;
      renderStrip(false);
    },
    setSound(on) {
      sound.replaceChildren(icone(on ? 'som' : 'mudo'));
      setAttr(sound, 'aria-pressed', on ? 'true' : 'false');
      setAttr(sound, 'aria-label', on ? 'Som ligado: tocar pra desligar' : 'Som desligado: tocar pra ligar');
    },
    announce(lines, animate) {
      if (lines.length === 0) return;
      news = lines.slice(-2).join(' ');
      setText(live, lines.join(' '));
      renderStrip(animate);
      clearTimeout(newsTimer);
      newsTimer = window.setTimeout(() => {
        news = null;
        renderStrip(false);
      }, NEWS_MS);
    },
    destroy() {
      clearTimeout(newsTimer);
    },
  };
}
