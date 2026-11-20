// Side panels of the round (desktop) table: the score in chalk tallies, the raise ladder and the story of
// the hand so far. Hidden on phones by CSS; all of it is derived from the snapshot.

import { append, el, setAttr, setText, svg, syncKeyed } from './dom.js';
import { grito } from './textos.js';

/** @typedef {import('./modelo.js').TableModel} TableModel */
/** @typedef {import('./modelo.js').ScoreRow} ScoreRow */

const LADDER = [1, 3, 6, 9, 12];

/**
 * Tally marks the way they are chalked on a bar wall: four strokes and a slash, a little unsteady. The
 * wobble depends only on the stroke's position, so a score always draws the same marks.
 * @param {number} count
 * @returns {{ d: string, width: number }}
 */
function tally(count) {
  /** @param {number} n */
  const wobble = (n) => ((Math.sin(n * 12.9898) * 43758.5453) % 1) * 0.9;
  let d = '';
  let x = 2;
  for (let stroke = 1; stroke <= count; stroke += 1) {
    if (stroke % 5 === 0) {
      d += `M${(x - 25.5).toFixed(1)} ${(14.2 + wobble(stroke)).toFixed(1)}L${(x - 2.6).toFixed(1)} ${(4.6 + wobble(stroke + 0.5)).toFixed(1)}`;
      x += 8;
    } else {
      d += `M${(x + 1.2 + wobble(stroke)).toFixed(1)} ${(2.6 + wobble(stroke + 0.3)).toFixed(1)}L${(x + wobble(stroke + 0.7)).toFixed(1)} ${(17.2 + wobble(stroke + 0.1)).toFixed(1)}`;
      x += 5.6;
    }
  }
  return { d, width: Math.max(4, x) };
}

/**
 * @typedef {Object} Panels
 * @property {HTMLElement} scores
 * @property {HTMLElement} story
 * @property {(model: TableModel) => void} update
 */

/** @returns {Panels} */
export function createPanels() {
  const targetLabel = el('span', 'rot');
  const scoreList = el('ol', 'placar');
  const scoreBoard = append(el('section', 'lousa'), append(el('div', 'lousa__cab'), el('h2', '', 'Placar'), targetLabel), scoreList);

  const ladderHand = el('span', 'rot');
  const ladder = el('ol', 'escada');
  ladder.setAttribute('aria-label', 'Escada de aumentos');
  for (const step of LADDER) {
    const item = append(el('li'), el('b', '', String(step)), document.createTextNode(step === 1 ? 'mão' : grito(step).toLowerCase()));
    item.dataset.valor = String(step);
    ladder.appendChild(item);
  }
  const ladderBoard = append(el('section', 'lousa'), append(el('div', 'lousa__cab'), el('h2', '', 'Quanto vale'), ladderHand), ladder);
  const scores = append(el('aside', 'lado lado--placar'), scoreBoard, ladderBoard);
  scores.setAttribute('aria-label', 'Placar');

  const storyHand = el('span', 'rot');
  const storyList = el('ol', 'resenha');
  const story = append(
    el('aside', 'lado lado--resenha'),
    append(el('section', 'lousa lousa--cresce'), append(el('div', 'lousa__cab'), el('h2', '', 'Resenha'), storyHand), storyList),
  );
  story.setAttribute('aria-label', 'Resenha da mão');

  /** @returns {HTMLElement} */
  function createRow() {
    const item = el('li');
    append(item, append(el('span', 'placar__nome'), el('span'), el('small')), el('span', 'placar__riscos'), el('b', 'placar__n'));
    item.dataset.pontos = '';
    return item;
  }

  /** @param {HTMLElement} item @param {ScoreRow} row */
  function updateRow(item, row) {
    const [name, marks, number] = /** @type {HTMLElement[]} */ (Array.from(item.children));
    setText(/** @type {Element} */ (name.firstElementChild), row.name);
    setText(/** @type {Element} */ (name.lastElementChild), row.note);
    setText(number, String(row.score));
    setAttr(item, 'data-lider', row.leader);
    setAttr(item, 'data-zerado', row.score === 0);
    if (item.dataset.pontos === String(row.score)) return;
    item.dataset.pontos = String(row.score);
    if (row.score === 0) {
      marks.replaceChildren(el('span', 'placar__vazio', 'nenhum risco'));
      return;
    }
    const { d, width } = tally(row.score);
    const drawing = svg(`0 0 ${width.toFixed(1)} 20`, `<path d="${d}"/>`, 'riscos');
    drawing.setAttribute('width', width.toFixed(1));
    drawing.setAttribute('height', '20');
    marks.replaceChildren(drawing);
  }

  return {
    scores,
    story,
    update(model) {
      setText(targetLabel, `até ${model.target}`);
      setText(ladderHand, `mão ${Math.max(1, model.handNumber)}`);
      setText(storyHand, `mão ${Math.max(1, model.handNumber)}`);
      syncKeyed(scoreList, model.scores, (row) => row.id, createRow, updateRow);
      for (const item of Array.from(ladder.children)) {
        const step = Number(/** @type {HTMLElement} */ (item).dataset.valor);
        setAttr(item, 'data-estado', step === model.value ? 'agora' : step < model.value ? 'ja' : null);
      }
      syncKeyed(storyList, model.log, (line) => String(model.log.indexOf(line)), () => el('li'), (item, line) => {
        const text = line.parts.map((part) => part.text).join('');
        setAttr(item, 'data-agora', line.now);
        if (item.dataset.texto === text) return;
        item.dataset.texto = text;
        const body = el('span');
        for (const part of line.parts) body.appendChild(part.strong ? el('b', '', part.text) : document.createTextNode(part.text));
        item.replaceChildren(body);
      });
    },
  };
}
