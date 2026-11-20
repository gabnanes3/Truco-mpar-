// What the house has to say outside the table: dialogs (how to play, confirmations) and the full-screen
// notices (looking for a room, and every way a room can be lost).

import { append, button, el, setText } from './dom.js';
import { createCardBack } from './carta.js';
import { banner } from './modelo.js';

/** @typedef {import('../net/types.js').RoomError} RoomError */
/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */
/**
 * @typedef {Object} DialogAction
 * @property {string} label
 * @property {'gema' | 'giz' | 'texto'} kind
 * @property {() => void} [onClick] the dialog closes first
 */
/**
 * @typedef {Object} NoticeAction
 * @property {string} label
 * @property {'gema' | 'giz' | 'texto'} kind
 * @property {() => void} onClick
 */

const BUTTON_CLASS = { gema: 'btn', giz: 'btn btn--giz', texto: 'btn btn--texto' };

/** @param {string} label @param {'gema' | 'giz' | 'texto'} kind @returns {HTMLButtonElement} */
function actionButton(label, kind) {
  const node = button(BUTTON_CLASS[kind]);
  node.appendChild(el('span', 'btn__txt', label));
  return node;
}

/** @type {(() => void) | null} */
let closeOpenDialog = null;

/**
 * Opens a modal dialog over whatever is on screen. Only one is open at a time.
 * @param {{ title: string, body: Node[], actions: DialogAction[] }} options
 * @returns {() => void} closes it
 */
export function openDialog(options) {
  closeOpenDialog?.();
  const previousFocus = document.activeElement;
  const title = el('h2', 'dialogo__titulo', options.title);
  title.id = 'dialogo-titulo';
  const body = append(el('div', 'dialogo__corpo'), ...options.body);
  const actions = el('div', 'dialogo__acoes');
  const panel = append(el('div', 'dialogo lousa'), title, body, actions);
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', title.id);
  const veil = append(el('div', 'veu'), panel);

  function close() {
    if (closeOpenDialog !== close) return;
    closeOpenDialog = null;
    document.removeEventListener('keydown', onKey);
    veil.remove();
    if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
  }
  /** @param {KeyboardEvent} event */
  function onKey(event) {
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key !== 'Tab') return;
    // Focus stays inside the dialog while it is open.
    const stops = Array.from(panel.querySelectorAll('button'));
    const first = stops[0];
    const lastStop = stops[stops.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      lastStop.focus();
    } else if (!event.shiftKey && document.activeElement === lastStop) {
      event.preventDefault();
      first.focus();
    }
  }

  for (const action of options.actions) {
    const node = actionButton(action.label, action.kind);
    node.addEventListener('click', () => {
      close();
      action.onClick?.();
    });
    actions.appendChild(node);
  }
  veil.addEventListener('pointerdown', (event) => {
    if (event.target === veil) close();
  });
  document.addEventListener('keydown', onKey);
  document.body.appendChild(veil);
  closeOpenDialog = close;
  actions.querySelector('button')?.focus();
  return close;
}

/** Closes the dialog that is open, if any (the screen behind it is going away). */
export function closeDialog() {
  closeOpenDialog?.();
}

/**
 * @param {{ title: string, text: string, confirm: string, cancel: string, onConfirm: () => void }} options
 * The safe choice (`cancel`) is the big button and gets the focus.
 */
export function openConfirm(options) {
  openDialog({
    title: options.title,
    body: [el('p', '', options.text)],
    actions: [
      { label: options.cancel, kind: 'gema' },
      { label: options.confirm, kind: 'texto', onClick: options.onConfirm },
    ],
  });
}

const RULES = [
  ['Cada um por si', 'Aqui não tem dupla. De 2 a 7 na mesa, todo mundo contra todo mundo: só quem leva a mão pontua.'],
  ['A mão', 'Cada um recebe 3 cartas. São até 3 rodadas: em cada uma todo mundo joga uma carta e a mais forte leva. Quem levar 2 rodadas leva a mão.'],
  ['As cartas', 'Da mais fraca pra mais forte: 4, 5, 6, 7, Q, J, K, A, 2, 3. Naipe não desempata: cartas iguais empatam e a rodada mela.'],
  ['A manilha', 'A carta virada no meio da mesa é a vira. A manilha é a carta seguinte a ela, e ganha de todas as outras. Entre as manilhas manda o naipe: ouros, espadas, copas e paus (o zap, a maior).'],
  ['Truco!', 'Na sua vez, antes de jogar, você pode pedir truco: a mão passa a valer 3, depois 6, 9 e 12. Cada um responde em segredo, aceitando ou correndo. Quem corre sai da mão. Se ninguém aceitar, quem pediu leva o que a mão valia.'],
  ['Se empatar', 'Melou a 1ª rodada: leva quem ganhar a 2ª. Melou a 2ª: leva quem ganhou a 1ª. Três rodadas com três donos diferentes: leva quem ganhou a 1ª.'],
  ['O relógio', 'São 15 segundos por jogada. Se o tempo acabar, o jogo joga sua carta mais fraca; se era resposta de truco, você corre.'],
  ['Quem ganha', 'Quem chegar primeiro a 6, 9 ou 12 pontos, como o dono da mesa escolher.'],
];

/** The rules of individual truco, short enough to read while the others arrive. */
export function openHowTo() {
  const list = el('dl', 'regras');
  for (const [term, text] of RULES) append(list, el('dt', '', term), el('dd', '', text));
  openDialog({ title: 'Como se joga', body: [list], actions: [{ label: 'Entendi', kind: 'gema' }] });
}

/**
 * The sentence shown outside the table while the connection is not fine (the table has its own banner).
 * @param {RoomSnapshot} snapshot
 * @returns {string | null} null when there is nothing to say
 */
export function connectionText(snapshot) {
  return banner(snapshot.connection)?.text ?? null;
}

/**
 * A whole screen for one message: a card face down, a title, one or two sentences and what to do next.
 * @param {{ title: string, text: string, code?: string, waiting?: boolean, actions: NoticeAction[] }} options
 *   `waiting`: something is still going on (the card keeps moving)
 * @returns {HTMLElement}
 */
export function createNotice(options) {
  const brand = document.createElement('img');
  brand.className = 'aviso__marca';
  brand.src = new URL('../../assets/img/marca-linha.svg', import.meta.url).href;
  brand.alt = 'Truco Ímpar';
  const card = createCardBack();
  card.classList.add('aviso__carta');
  const title = el('h1', 'aviso__titulo', options.title);
  const text = el('p', 'aviso__texto', options.text);
  const actions = el('div', 'aviso__acoes');
  for (const action of options.actions) {
    const node = actionButton(action.label, action.kind);
    node.addEventListener('click', action.onClick);
    actions.appendChild(node);
  }
  const main = append(el('main', 'aviso'), card, title, text);
  if (options.code) main.appendChild(append(el('p', 'aviso__codigo'), el('span', 'rot', 'mesa'), el('b', '', options.code)));
  main.setAttribute('role', 'status');
  if (options.waiting) main.dataset.espera = '';
  return append(el('div', 'app app--aviso'), el('div', 'luz'), brand, main, actions);
}

/**
 * The screen shown while a room is being opened or looked for.
 * @param {{ code: string | null, onCancel: () => void }} options
 * @returns {{ el: HTMLElement, update: (snapshot: RoomSnapshot) => void }}
 */
export function createWaitingNotice(options) {
  const creating = options.code === null;
  const root = createNotice({
    title: creating ? 'Abrindo a mesa…' : 'Procurando a mesa…',
    text: creating ? 'Só um instante, já sai o código pra chamar a turma.' : 'Só um instante, puxando uma cadeira pra você.',
    code: options.code ?? undefined,
    waiting: true,
    actions: [{ label: 'Voltar pro início', kind: 'texto', onClick: options.onCancel }],
  });
  const text = /** @type {HTMLElement} */ (root.querySelector('.aviso__texto'));
  const calm = text.textContent ?? '';
  return {
    el: root,
    update(snapshot) {
      const away = snapshot.connection === 'reconnecting' || snapshot.connection === 'host-away';
      setText(text, away ? 'Quem abriu a mesa não respondeu ainda. Continuo tentando: sua cadeira tá guardada.' : calm);
    },
  };
}

/** What to say for each way a room is lost: what happened, then what to do. Never blames anyone. */
const ERRORS = /** @type {Readonly<Record<RoomError | 'replaced', { title: string, text: string, retry: boolean }>>} */ ({
  'not-found': { title: 'Não achei essa mesa', text: 'Confere o código com quem te chamou. Se a mesa já fechou, é só abrir outra.', retry: true },
  full: { title: 'Essa mesa já lotou', text: 'Não cabe mais ninguém nela. Abre outra e chama a turma.', retry: false },
  kicked: { title: 'Você ficou de fora', text: 'O dono da mesa tirou você desta mesa. Dá pra abrir outra e chamar a turma.', retry: false },
  'host-closed': { title: 'A mesa fechou', text: 'O dono da mesa encerrou o jogo. Abre outra e chama a turma de volta.', retry: false },
  'broker-unreachable': { title: 'Não deu pra conectar', text: 'O serviço que liga os jogadores não respondeu. Confere sua internet e tenta de novo.', retry: true },
  'bad-version': { title: 'Versões diferentes', text: 'Alguém na mesa está com uma versão antiga do jogo. Recarrega a página e tenta de novo.', retry: true },
  replaced: { title: 'O jogo continua em outra aba', text: 'Você abriu esta mesa em outra aba ou aparelho. Dá pra voltar pra cá quando quiser.', retry: true },
});

/**
 * @param {RoomError | 'replaced'} error
 * @param {{ onHome: () => void, onRetry: () => void }} callbacks
 * @returns {HTMLElement}
 */
export function createErrorNotice(error, callbacks) {
  const { title, text, retry } = ERRORS[error];
  /** @type {NoticeAction[]} */
  const actions = [{ label: 'Voltar pro início', kind: 'gema', onClick: callbacks.onHome }];
  if (retry) actions.push({ label: error === 'replaced' ? 'Jogar nesta aba' : 'Tentar de novo', kind: 'texto', onClick: callbacks.onRetry });
  const notice = createNotice({ title, text, actions });
  notice.dataset.erro = error;
  return notice;
}
