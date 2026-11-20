// The end of a match: who took it, the final ranking chalked up in tally marks, and what comes next (the
// host opens a new match at the same table; everybody else waits for it or leaves).

import { append, button, el, setAttr, setText, svg, syncKeyed } from './dom.js';
import { connectionText } from './avisos.js';
import { createCap } from './centro.js';
import { tally } from './paineis.js';

/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */
/**
 * @typedef {Object} EndCallbacks
 * @property {() => void} onNewMatch host only
 * @property {() => void} onLeave the owner confirms and leaves
 */
/**
 * @typedef {Object} End
 * @property {HTMLElement} el
 * @property {(snapshot: RoomSnapshot, busy: boolean) => void} update `busy`: an intent of mine is in flight
 */
/** @typedef {{ id: string, name: string, score: number, removed: boolean, me: boolean, winner: boolean }} RankRow */

/** Names longer than this get a smaller headline, so 14 characters still fit beside the cap. */
const LONG_NAME = 9;

/**
 * @param {RoomSnapshot} snapshot
 * @returns {RankRow[]} the winner first, then by score; ties keep the seat order
 */
function ranking(snapshot) {
  const game = snapshot.game;
  if (!game) return [];
  const winner = game.result?.winner ?? null;
  return game.players
    .map((player) => ({ ...player, me: player.id === snapshot.you.id, winner: player.id === winner }))
    .sort((a, b) => Number(b.winner) - Number(a.winner) || b.score - a.score);
}

/**
 * @param {EndCallbacks} callbacks
 * @returns {End}
 */
export function createEnd(callbacks) {
  const trouble = el('p', 'faixa');
  trouble.setAttribute('role', 'status');
  trouble.hidden = true;

  const cap = createCap();
  const room = el('p', 'rot');
  const titleName = el('span');
  const title = append(el('h1', 'fim__titulo'), titleName, el('span', '', 'levou!'));
  const detail = el('p', 'fim__sub');
  const head = append(el('header', 'fim__cab'), cap.el, append(el('div', 'fim__txt'), room, title, detail));

  const list = el('ol', 'final');
  const board = append(el('section', 'lousa'), list);
  board.setAttribute('aria-label', 'Placar final');

  const againNote = el('span', 'btn__sub');
  const again = button('btn fim__nova');
  append(again, el('span', 'btn__txt', 'Nova partida'), againNote);
  again.addEventListener('click', callbacks.onNewMatch);
  const waiting = el('p', 'sala__espera');
  const leave = button('btn btn--texto');
  leave.appendChild(el('span', 'btn__txt', 'Sair da mesa'));
  leave.addEventListener('click', callbacks.onLeave);
  const actions = append(el('div', 'fim__acoes'), again, waiting, leave);

  const root = append(el('div', 'app app--fim'), el('div', 'luz'), append(el('main', 'fim'), trouble, head, board, actions));

  /** @returns {HTMLElement} */
  function createRow() {
    const row = append(el('li'), el('span', 'final__pos'), append(el('span', 'final__nome'), el('span'), el('small')), el('span', 'final__riscos'), el('b', 'final__n'));
    row.dataset.pontos = '';
    return row;
  }

  /** @param {HTMLElement} row @param {RankRow} item @param {number} index */
  function updateRow(row, item, index) {
    const [position, name, marks, number] = /** @type {HTMLElement[]} */ (Array.from(row.children));
    setText(position, `${index + 1}º`);
    setText(/** @type {Element} */ (name.firstElementChild), item.name);
    setText(/** @type {Element} */ (name.lastElementChild), item.me ? 'você' : item.removed ? 'saiu' : '');
    setText(number, String(item.score));
    setAttr(row, 'data-campeao', item.winner);
    setAttr(row, 'data-zerado', item.score === 0);
    setAttr(row, 'data-saiu', item.removed);
    if (row.dataset.pontos === String(item.score)) return;
    row.dataset.pontos = String(item.score);
    if (item.score === 0) {
      marks.replaceChildren(el('span', 'placar__vazio', 'passou em branco'));
      return;
    }
    const { d, width } = tally(item.score);
    const drawing = svg(`0 0 ${width.toFixed(1)} 20`, `<path d="${d}"/>`, 'riscos');
    drawing.setAttribute('width', width.toFixed(1));
    drawing.setAttribute('height', '20');
    drawing.setAttribute('role', 'img');
    drawing.setAttribute('aria-label', `${item.score} riscos de giz`);
    drawing.removeAttribute('aria-hidden');
    marks.replaceChildren(drawing);
  }

  return {
    el: root,
    update(snapshot, busy) {
      const game = snapshot.game;
      if (!game) return;
      const rows = ranking(snapshot);
      const winner = rows.find((row) => row.winner) ?? rows[0];
      const host = snapshot.room.members.find((member) => member.isHost);
      const online = snapshot.connection === 'online';

      const problem = connectionText(snapshot);
      trouble.hidden = problem === null;
      setText(trouble, problem ?? '');

      setText(room, `Fim de partida · mesa ${snapshot.room.code}`);
      if (winner) {
        cap.set(3, String(winner.score), 'fechou');
        setText(titleName, winner.me ? 'Você' : winner.name);
        setAttr(title, 'data-longo', !winner.me && winner.name.length > LONG_NAME);
        const who = winner.me ? 'você' : winner.name;
        setText(detail, game.result?.reason === 'abandon'
          ? `Só sobrou ${who} na mesa: o resto da turma saiu.`
          : `${winner.score} pontos em ${game.handNumber === 1 ? 'uma mão' : `${game.handNumber} mãos`}, numa partida até ${game.targetScore}.`);
      }
      syncKeyed(list, rows, (row) => row.id, createRow, updateRow);

      again.hidden = !snapshot.you.isHost;
      waiting.hidden = snapshot.you.isHost;
      if (snapshot.you.isHost) {
        const staying = snapshot.room.members.length;
        setText(againNote, staying < 2 ? 'mesma mesa, chama a turma de novo' : `mesma mesa, com os ${staying} que ficaram`);
        again.disabled = busy || !online;
      } else {
        setText(waiting, `Esperando ${host ? host.name : 'o dono da mesa'} abrir a próxima partida…`);
      }
    },
  };
}
