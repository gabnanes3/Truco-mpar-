// The state gallery: mounts the REAL table code with fixture snapshots, one state per URL.
//   galeria.html                      → index of every state
//   galeria.html?estado=7-jogadores   → that state (add &relogio=vivo to let the countdown run, or
//                                       &passo=ultimo to render only the last snapshot of a sequence)
// When the last snapshot is on screen the page sets data-pronto on <html>, which is what the test waits for.

import { renderTable } from '../../../app/js/ui/mesa.js';
import { ESTADOS, montarEstado } from './galeria-estados.js';

const params = new URLSearchParams(location.search);
const nome = params.get('estado');
const container = /** @type {HTMLElement} */ (document.getElementById('mesa'));

/** @param {number} ms */
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function index() {
  const list = document.createElement('main');
  list.className = 'galeria';
  const title = document.createElement('h1');
  title.textContent = 'Galeria de estados';
  const note = document.createElement('p');
  note.textContent = 'A mesa de verdade, com fotos montadas pelo motor do jogo.';
  list.append(title, note);
  for (const estado of ESTADOS) {
    const link = document.createElement('a');
    link.href = `?estado=${encodeURIComponent(estado)}`;
    link.textContent = estado;
    list.appendChild(link);
  }
  container.replaceWith(list);
}

/** @param {string} estado */
async function show(estado) {
  const { snapshots: all, pauseMs, tauntMs } = montarEstado(estado);
  const snapshots = params.get('passo') === 'ultimo' ? all.slice(-1) : all;
  const frozenAt = snapshots[snapshots.length - 1].receivedAt;
  let soundOn = true;
  /** @type {import('../../../app/js/ui/mesa.js').Table | null} */
  let table = null;
  /** Intents are only logged here; `window.intents` lets a test read them. @type {unknown[][]} */
  const intents = [];
  Object.assign(window, { intents });
  /** @type {import('../../../app/js/ui/mesa.js').TableCallbacks} */
  const callbacks = {
    onPlay: (card) => intents.push(['play', card]),
    onRaise: () => intents.push(['raise']),
    onRespond: (accept) => intents.push(['respond', accept]),
    onTaunt: (tauntId) => intents.push(['taunt', tauntId]),
    onLeave: () => intents.push(['leave']),
    onToggleSound: () => {
      soundOn = !soundOn;
      table?.setSound(soundOn);
      intents.push(['sound', soundOn]);
    },
  };
  const options = { tauntMs, now: params.get('relogio') === 'vivo' ? undefined : () => frozenAt };
  for (const [step, snapshot] of snapshots.entries()) {
    if (step > 0 && pauseMs(step) > 0) await pause(pauseMs(step));
    table = renderTable(container, snapshot, callbacks, options);
  }
  document.title = `${estado} — galeria Truco Ímpar`;
}

if (nome === null) index();
else await show(nome);
document.documentElement.dataset.pronto = '1';
