// The first screen: who you are, and either open a table or sit at one. Arriving through an invite link
// (`?sala=CODE`) the code is already known, so all that is asked is the name.

import { cleanName, normalizeCode } from '../net/protocol.js';
import { append, button, el } from './dom.js';
import { createCard } from './carta.js';
import { icone } from './icones.js';

/**
 * @typedef {Object} HomeOptions
 * @property {string} name the name used last time, '' when there is none
 * @property {string | null} invite the room code of the invite link, when there is one
 * @property {string | null} lastCode a room this device was in recently, to offer the way back
 * @property {(name: string) => void} onCreate
 * @property {(code: string, name: string) => void} onJoin
 * @property {(code: string) => void} onReturn back to `lastCode` with the stored name
 * @property {() => void} onHowTo
 */

/**
 * @param {string} label
 * @param {string} className
 * @param {'submit' | 'button'} type
 * @returns {HTMLButtonElement}
 */
function wordButton(label, className, type) {
  const node = button(className);
  node.type = type;
  node.appendChild(el('span', 'btn__txt', label));
  return node;
}

/**
 * @param {HomeOptions} options
 * @returns {HTMLElement}
 */
export function createHome(options) {
  let invite = options.invite;

  const hero = append(el('div', 'inicio__heroi'), createCard('3p'), createCard('5c'), createCard('7o'));
  hero.setAttribute('aria-hidden', 'true');
  const brand = document.createElement('img');
  brand.className = 'marca';
  brand.src = new URL('../../assets/img/marca.svg', import.meta.url).href;
  brand.alt = 'Truco Ímpar';
  brand.width = 334;
  brand.height = 176;
  const motto = append(el('p', 'inicio__lema'), el('b', '', 'Sem dupla, sem dó.'), el('br'), document.createTextNode('Truco paulista, cada um por si.'));

  const nameInput = document.createElement('input');
  nameInput.className = 'campo__caixa';
  nameInput.type = 'text';
  nameInput.name = 'nome';
  nameInput.maxLength = 14;
  nameInput.autocomplete = 'nickname';
  nameInput.spellcheck = false;
  nameInput.enterKeyHint = 'go';
  nameInput.setAttribute('autocapitalize', 'words');
  nameInput.value = options.name;
  const nameField = append(el('label', 'campo'), el('span', 'rot', 'Seu nome na mesa'), nameInput);
  const problem = el('p', 'campo__erro');
  problem.setAttribute('role', 'alert');
  problem.hidden = true;

  const codeInput = document.createElement('input');
  codeInput.className = 'campo__caixa campo__caixa--codigo';
  codeInput.type = 'text';
  codeInput.name = 'codigo';
  codeInput.placeholder = 'K7M4QX';
  codeInput.maxLength = 8;
  codeInput.autocomplete = 'off';
  codeInput.spellcheck = false;
  codeInput.enterKeyHint = 'go';
  codeInput.setAttribute('autocapitalize', 'characters');
  const codeField = append(el('label', 'campo'), el('span', 'so-leitor', 'Código da mesa'), codeInput);

  const invited = append(el('p', 'convite'), el('span', 'rot', 'te chamaram pra mesa'), el('b', 'convite__codigo'));
  const create = wordButton('Abrir uma mesa', 'btn', 'submit');
  const join = wordButton('Entrar', 'btn btn--anil', 'button');
  const or = append(el('div', 'ou'), el('span', 'rot', 'ou entre com o código'));
  const joinRow = append(el('div', 'entrar'), codeField, join);
  const sit = wordButton('Entrar na mesa', 'btn', 'submit');
  const other = wordButton('Abrir outra mesa', 'btn btn--texto', 'button');
  const back = button('btn btn--giz btn--linha inicio__voltar');
  append(back, icone('voltar'), el('span', 'btn__txt', options.lastCode ? `Voltar pra mesa ${options.lastCode}` : ''));

  const form = append(document.createElement('form'), back, invited, nameField, problem, create, or, joinRow, sit, other);
  form.className = 'inicio__form';
  form.noValidate = true;
  form.setAttribute('aria-label', 'Entrar no jogo');

  const howTo = wordButton('Como se joga', 'btn btn--texto', 'button');
  howTo.addEventListener('click', options.onHowTo);
  const footer = append(el('div', 'inicio__rodape'), howTo, el('p', '', 'Sem cadastro, sem instalar nada: só o link no grupo e a gritaria.'));

  function arrange() {
    const hasInvite = invite !== null;
    invited.hidden = !hasInvite;
    sit.hidden = !hasInvite;
    other.hidden = !hasInvite;
    create.hidden = hasInvite;
    or.hidden = hasInvite;
    joinRow.hidden = hasInvite;
    back.hidden = hasInvite || options.lastCode === null;
    if (invite !== null) /** @type {HTMLElement} */ (invited.lastElementChild).textContent = invite;
  }

  /** @param {string} message @param {HTMLInputElement} field */
  function complain(message, field) {
    problem.textContent = message;
    problem.hidden = false;
    field.focus();
  }

  /** @returns {string | null} the cleaned name, or null after complaining about it */
  function readName() {
    const name = cleanName(nameInput.value);
    if (name === null) complain('Fala seu nome pra mesa saber quem é.', nameInput);
    return name;
  }

  function joinTyped() {
    const code = normalizeCode(codeInput.value);
    if (code === null) {
      complain('O código da mesa tem 6 letras e números.', codeInput);
      return;
    }
    const name = readName();
    if (name !== null) options.onJoin(code, name);
  }

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const name = readName();
    if (name === null) return;
    if (invite !== null) options.onJoin(invite, name);
    else options.onCreate(name);
  });
  join.addEventListener('click', joinTyped);
  codeInput.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    joinTyped();
  });
  for (const input of [nameInput, codeInput]) input.addEventListener('input', () => { problem.hidden = true; });
  other.addEventListener('click', () => {
    invite = null;
    arrange();
  });
  back.addEventListener('click', () => {
    if (options.lastCode !== null) options.onReturn(options.lastCode);
  });

  arrange();
  const main = append(el('main', 'inicio'), hero, append(el('h1'), brand), motto, form, footer);
  const tiles = el('div', 'rodape-ladrilho');
  tiles.setAttribute('aria-hidden', 'true');
  return append(el('div', 'app app--inicio'), el('div', 'luz'), main, tiles);
}
