// The waiting room: the room code on enamel plates, the invite (copy the link, or send it straight to the
// group), who has arrived, how many points the match goes to, and the button that starts it. The host's
// controls (points, removing somebody, starting) are shown read-only or not at all to everybody else.

import { TARGET_OPTIONS } from '../engine/game.js';
import { append, button, el, setAttr, setText, svg, syncKeyed } from './dom.js';
import { connectionText } from './avisos.js';
import { estrela, icone } from './icones.js';

/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../net/types.js').Member} Member */
/** @typedef {import('../net/types.js').TargetScore} TargetScore */

/**
 * @typedef {Object} LobbyCallbacks
 * @property {() => void} onLeave the owner confirms and leaves
 * @property {() => void} onStart
 * @property {(member: Member) => void} onKick the owner confirms and removes
 * @property {(target: TargetScore) => void} onTarget
 * @property {() => void} onHowTo
 * @property {() => void} onToggleSound
 */
/**
 * @typedef {Object} Lobby
 * @property {HTMLElement} el
 * @property {(snapshot: RoomSnapshot, busy: boolean) => void} update `busy`: an intent of mine is in flight
 * @property {(on: boolean) => void} setSound
 * @property {() => void} destroy
 */

const SEATS = 7;
const COPIED_MS = 2200;
const INVITE_TEXT = 'Bora de truco? Aqui é cada um por si, sem dupla. Entra na mesa:';
const COUNT_WORDS = ['Nenhuma', 'Uma', 'Duas', 'Três', 'Quatro', 'Cinco', 'Seis'];
/** Seven chairs around a little table, clockwise from the top. */
const CHAIRS = [[14, 3.7], [22.1, 7.6], [24, 16.3], [18.5, 23.3], [9.5, 23.3], [4, 16.3], [5.9, 7.6]];

/** @param {string} code @returns {string} the link that brings somebody to this room */
export function inviteUrl(code) {
  const url = new URL(location.href);
  url.search = `?sala=${code}`;
  url.hash = '';
  return url.href;
}

/** @param {string} text @returns {Promise<boolean>} */
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // No clipboard permission (or no secure context): the old way still works in most browsers.
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  area.remove();
  return copied;
}

/** The system share sheet where there is one; a WhatsApp link everywhere else. @param {string} code */
async function shareInvite(code) {
  const url = inviteUrl(code);
  if (typeof navigator.share === 'function') {
    try {
      await navigator.share({ title: 'Truco Ímpar', text: INVITE_TEXT, url });
      return;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') return;
    }
  }
  window.open(`https://wa.me/?text=${encodeURIComponent(`${INVITE_TEXT} ${url}`)}`, '_blank', 'noopener');
}

/** @param {number} taken @returns {SVGSVGElement} */
function chairs(taken) {
  const dots = CHAIRS.map(([x, y], index) => (index < taken
    ? `<circle class="cheia" cx="${x}" cy="${y}" r="2.9"/>`
    : `<circle class="vaga-c" cx="${x}" cy="${y}" r="2.3"/>`)).join('');
  return svg('0 0 28 28', `<circle class="tampo" cx="14" cy="14" r="5"/>${dots}`);
}

/**
 * @param {LobbyCallbacks} callbacks
 * @returns {Lobby}
 */
export function createLobby(callbacks) {
  /** @type {RoomSnapshot | null} */
  let last = null;
  let copiedTimer = 0;

  // ---- top bar
  const leave = button('icone-btn', 'Sair da mesa');
  leave.appendChild(icone('voltar'));
  leave.addEventListener('click', callbacks.onLeave);
  const help = button('icone-btn', 'Como se joga');
  help.appendChild(icone('ajuda'));
  help.addEventListener('click', callbacks.onHowTo);
  const sound = button('icone-btn', 'Som');
  sound.addEventListener('click', callbacks.onToggleSound);
  const bar = append(el('header', 'barra'), leave, el('h1', 'barra__titulo', 'Mesa aberta'), help, sound);

  const trouble = el('p', 'faixa');
  trouble.setAttribute('role', 'status');
  trouble.hidden = true;

  // ---- code and invite
  const plates = el('div', 'codigo__chapas');
  plates.setAttribute('role', 'img');
  const code = append(el('section', 'codigo'), el('span', 'rot', 'Código da mesa'), plates);
  code.setAttribute('aria-label', 'Código da mesa');
  const copyLabel = el('span', 'btn__txt', 'Copiar link');
  const copy = button('btn btn--giz btn--linha');
  append(copy, icone('copiar'), copyLabel);
  const share = button('btn btn--anil btn--linha');
  append(share, icone('enviar'), el('span', 'btn__txt', 'Mandar no zap'));
  const said = el('p', 'so-leitor');
  said.setAttribute('aria-live', 'polite');
  copy.addEventListener('click', async () => {
    if (last === null) return;
    const copied = await copyText(inviteUrl(last.room.code));
    setText(copyLabel, copied ? 'Link copiado!' : 'Copie o código');
    setText(said, copied ? 'Link copiado. Agora é só colar no grupo.' : 'Não deu pra copiar o link. Passe o código da mesa.');
    clearTimeout(copiedTimer);
    copiedTimer = window.setTimeout(() => setText(copyLabel, 'Copiar link'), COPIED_MS);
  });
  share.addEventListener('click', () => {
    if (last !== null) shareInvite(last.room.code);
  });

  // ---- roster
  const chairsBox = el('span', 'cadeiras');
  const chairsText = el('span', 'rot');
  const list = el('ol', 'lista');
  const targetOptions = el('div', 'alvo__ops');
  const targetLock = icone('cadeado');
  const target = append(el('div', 'alvo'), el('span', 'alvo__rot', 'Partida até'), targetOptions, append(el('span', 'alvo__un'), document.createTextNode('pontos'), targetLock));
  targetOptions.setAttribute('role', 'radiogroup');
  targetOptions.setAttribute('aria-label', 'Partida até quantos pontos');
  for (const value of TARGET_OPTIONS) {
    const option = button('alvo__op');
    option.textContent = String(value);
    option.dataset.alvo = String(value);
    option.setAttribute('role', 'radio');
    option.addEventListener('click', () => callbacks.onTarget(/** @type {TargetScore} */ (value)));
    targetOptions.appendChild(option);
  }
  const roster = append(
    el('section', 'lousa'),
    append(el('div', 'lousa__cab lousa__cab--sala'), el('h2', '', 'Na mesa'), append(chairsBox, chairsText)),
    list,
    target,
  );

  const hintStrong = el('b');
  const hintRest = el('span');
  const hint = append(el('p', 'aviso-impar'), estrela(), append(el('span'), hintStrong, hintRest));
  hint.setAttribute('aria-live', 'polite');

  // ---- start
  const startLabel = el('span', 'btn__txt');
  const startNote = el('span', 'btn__sub');
  const start = button('btn sala__comecar');
  append(start, startLabel, startNote);
  start.addEventListener('click', callbacks.onStart);
  const waiting = el('p', 'sala__espera');
  const foot = append(el('div', 'sala__fim'), start, waiting);

  const main = append(el('main', 'sala'), trouble, code, append(el('div', 'sala__acoes'), copy, share, said), roster, hint, foot);
  const root = append(el('div', 'app app--sala'), el('div', 'luz'), bar, main);

  /** @param {Member} member @returns {HTMLElement} */
  function createRow(member) {
    const name = append(el('span', 'lista__nome'), el('span', 'lista__txt'), el('small'));
    const kick = button('icone-btn lista__tirar');
    kick.appendChild(icone('fechar'));
    kick.addEventListener('click', () => {
      const current = last?.room.members.find((other) => other.id === member.id);
      if (current) callbacks.onKick(current);
    });
    return append(el('li'), el('span', 'lista__n'), name, el('span', 'lista__estado'), kick);
  }

  /** @param {HTMLElement} row @param {Member} member @param {number} index */
  function updateRow(row, member, index) {
    if (last === null) return;
    const [number, name, state, kick] = /** @type {HTMLElement[]} */ (Array.from(row.children));
    const playing = member.role === 'player';
    setText(number, playing ? String(index + 1) : '·');
    setText(/** @type {HTMLElement} */ (name.firstElementChild), member.name);
    setText(/** @type {HTMLElement} */ (name.lastElementChild), member.id === last.you.id ? 'você' : '');
    const kind = member.isHost ? 'dono' : !member.connected ? 'caiu' : playing ? 'chegou' : 'fila';
    if (state.dataset.tipo !== kind) {
      state.dataset.tipo = kind;
      state.className = kind === 'dono' ? 'lista__estado selo-dono' : 'lista__estado pronto';
      const words = { dono: 'dono da mesa', caiu: 'caiu', chegou: 'chegou', fila: 'na fila' }[kind];
      state.replaceChildren(...(kind === 'chegou' ? [icone('check')] : kind === 'caiu' ? [icone('sem-sinal')] : []), document.createTextNode(words));
    }
    kick.hidden = !last.you.isHost || member.id === last.you.id;
    setAttr(kick, 'aria-label', `Tirar ${member.name} da mesa`);
  }

  return {
    el: root,
    update(snapshot, busy) {
      last = snapshot;
      const { room, you } = snapshot;
      const players = room.members.filter((member) => member.role === 'player');
      const count = players.length;
      const host = room.members.find((member) => member.isHost);
      const targetScore = room.settings.targetScore;
      const online = snapshot.connection === 'online';

      const problem = connectionText(snapshot);
      trouble.hidden = problem === null;
      setText(trouble, problem ?? '');

      if (plates.dataset.codigo !== room.code) {
        plates.dataset.codigo = room.code;
        plates.replaceChildren(...[...room.code].map((letter) => el('span', '', letter)));
        setAttr(plates, 'aria-label', [...room.code].join(' '));
      }

      if (chairsBox.dataset.n !== String(count)) {
        chairsBox.dataset.n = String(count);
        chairsBox.querySelector('svg')?.remove();
        chairsBox.prepend(chairs(count));
      }
      setText(chairsText, `${count} de ${SEATS} cadeiras`);

      /** @type {(Member | null)[]} */
      const rows = [...room.members];
      if (count < SEATS) rows.push(null);
      syncKeyed(list, rows, (member) => member?.id ?? '_vaga', (member) => {
        if (member !== null) return createRow(member);
        return append(el('li', 'vago'), el('span', 'lista__n'), el('span', 'lista__nome'), el('span', 'pronto', 'esperando…'));
      }, (row, member, index) => {
        if (member !== null) {
          updateRow(row, member, index);
          return;
        }
        const free = SEATS - count;
        setText(/** @type {HTMLElement} */ (row.children[1]), free === 1 ? 'Uma cadeira vaga' : `${COUNT_WORDS[free]} cadeiras vagas`);
      });

      for (const option of Array.from(targetOptions.children)) {
        if (!(option instanceof HTMLButtonElement)) continue;
        const chosen = option.dataset.alvo === String(targetScore);
        setAttr(option, 'aria-checked', chosen ? 'true' : 'false');
        option.disabled = !you.isHost || busy || !online;
      }
      setAttr(target, 'data-fixo', !you.isHost);
      targetLock.style.display = you.isHost ? 'none' : '';
      setAttr(target, 'title', you.isHost ? null : 'Quem escolhe é o dono da mesa');

      if (count < 2) {
        setText(hintStrong, 'Sozinho não dá truco.');
        setText(hintRest, ' Manda o link no grupo e espera a turma chegar.');
      } else if (count % 2 === 1) {
        setText(hintStrong, `${count} na mesa: número ímpar, pode começar.`);
        setText(hintRest, ' Aqui não tem dupla: é cada um por si.');
      } else {
        setText(hintStrong, `${count} na mesa: já dá jogo.`);
        setText(hintRest, ' Aqui não tem dupla, nem com número par: é cada um por si.');
      }

      start.hidden = !you.isHost;
      waiting.hidden = you.isHost;
      if (you.isHost) {
        const ready = count >= 2;
        setText(startLabel, ready ? `Começar com ${count}` : 'Esperando a turma');
        setText(startNote, ready ? `partida até ${targetScore} pontos` : 'precisa de pelo menos 2 na mesa');
        start.disabled = !ready || busy || !online;
      } else {
        setText(waiting, you.role === 'spectator'
          ? 'A mesa lotou: você entra assim que vagar uma cadeira.'
          : `Esperando ${host ? host.name : 'o dono da mesa'} começar a partida…`);
      }
    },
    setSound(on) {
      sound.replaceChildren(icone(on ? 'som' : 'mudo'));
      setAttr(sound, 'aria-pressed', on ? 'true' : 'false');
      setAttr(sound, 'aria-label', on ? 'Som ligado: tocar pra desligar' : 'Som desligado: tocar pra ligar');
    },
    destroy() {
      clearTimeout(copiedTimer);
    },
  };
}
