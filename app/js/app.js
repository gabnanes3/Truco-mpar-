// The app shell: picks the screen from the latest RoomSnapshot (home, waiting, lobby, table, match end,
// error), wires each screen's buttons to the GameClient, keeps the address in step with the room
// (`?sala=CODE`, so a reload comes back to the same seat) and voices the game.

import { hostRoom, joinRoom, lastRoom, savedName } from './net/browser.js';
import { normalizeCode } from './net/protocol.js';
import { closeDialog, createErrorNotice, createWaitingNotice, openConfirm, openHowTo } from './ui/avisos.js';
import { createEnd } from './ui/fim.js';
import { createHome } from './ui/inicio.js';
import { renderTable, unmountTable } from './ui/mesa.js';
import { createLobby } from './ui/sala.js';
import { createSound, cuesFor } from './ui/som.js';

/** @typedef {import('./net/types.js').GameClient} GameClient */
/** @typedef {import('./net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('./net/types.js').RoomError} RoomError */
/**
 * @typedef {Object} Screen what is on the page right now
 * @property {'home' | 'waiting' | 'lobby' | 'table' | 'end' | 'error'} name
 * @property {HTMLElement} el
 * @property {(snapshot: RoomSnapshot) => void} [update]
 * @property {(on: boolean) => void} [setSound]
 * @property {() => void} [destroy]
 */
/** @typedef {{ kind: 'create', name: string } | { kind: 'join', code: string, name?: string }} Attempt */

/** The table stays up this long after the last card, so the winning hand is seen before the ranking. */
const END_HOLD_MS = 2800;
/** Lobby and end-screen buttons come back by themselves if no snapshot answers an intent. */
const BUSY_MS = 4000;
const TICK_FROM_SECONDS = 5;

const mount = /** @type {HTMLElement} */ (document.getElementById('app'));
const sound = createSound();

/** @type {Screen | null} */
let screen = null;
/** @type {GameClient | null} */
let client = null;
let unsubscribe = () => {};
/** @type {RoomSnapshot | null} the last snapshot of the current client */
let latest = null;
/** @type {Attempt | null} what to repeat when the person asks to try again */
let attempt = null;
/** Whether the current client has been online at all: until then a new room has no final code. */
let seenOnline = false;
let busy = false;
let busyTimer = 0;
let endTimer = 0;
let lastTick = '';

// ------------------------------------------------------------------------------------------- screens

/** @param {Screen} next */
function setScreen(next) {
  closeDialog();
  screen?.destroy?.();
  screen = next;
  mount.replaceChildren(next.el);
  window.scrollTo(0, 0);
}

/** @param {string | null} code the room in the address bar, or none */
function setAddress(code) {
  const url = new URL(location.href);
  const wanted = code === null ? '' : `?sala=${code}`;
  if (url.search === wanted) return;
  url.search = wanted;
  url.hash = '';
  history.replaceState(null, '', url);
}

/** @param {string | null} invite the code of the invite link that brought this person here */
function showHome(invite) {
  dropClient();
  setAddress(invite);
  const last = lastRoom();
  setScreen({
    name: 'home',
    el: createHome({
      name: savedName(),
      invite,
      lastCode: last !== null && last.code !== invite ? last.code : null,
      onCreate: create,
      onJoin: join,
      onReturn: (code) => join(code),
      onHowTo: openHowTo,
    }),
  });
}

/** @param {RoomSnapshot} snapshot */
function showWaiting(snapshot) {
  if (screen?.name !== 'waiting') {
    const notice = createWaitingNotice({
      code: attempt?.kind === 'join' ? attempt.code : null,
      onCancel: () => {
        // Not `leave`: somebody whose host is slow to answer keeps the seat for a later visit.
        const closing = client;
        dropClient();
        closing?.close();
        showHome(null);
      },
    });
    setScreen({ name: 'waiting', el: notice.el, update: notice.update });
  }
  screen?.update?.(snapshot);
}

/** @param {RoomSnapshot} snapshot */
function showLobby(snapshot) {
  if (screen?.name !== 'lobby') {
    const lobby = createLobby({
      onLeave: confirmLeave,
      onStart: () => send((room) => room.start()),
      onTarget: (target) => {
        if (latest?.room.settings.targetScore !== target) send((room) => room.setTargetScore(target));
      },
      onKick: (member) => openConfirm({
        title: `Tirar ${member.name}?`,
        text: 'Quem é tirado da mesa não consegue voltar pra ela.',
        confirm: 'Tirar da mesa',
        cancel: 'Deixar ficar',
        onConfirm: () => send((room) => room.kick(member.id)),
      }),
      onHowTo: openHowTo,
      onToggleSound: toggleSound,
    });
    lobby.setSound(sound.isOn());
    setScreen({ name: 'lobby', el: lobby.el, update: (next) => lobby.update(next, busy), setSound: lobby.setSound, destroy: lobby.destroy });
  }
  screen?.update?.(snapshot);
}

/** @param {RoomSnapshot} snapshot */
function showTable(snapshot) {
  if (screen?.name !== 'table') {
    const host = document.createElement('div');
    const callbacks = {
      /** @param {string} card */
      onPlay: (card) => client?.play(card),
      onRaise: () => client?.raise(),
      /** @param {boolean} accept */
      onRespond: (accept) => client?.respond(accept),
      /** @param {string} tauntId */
      onTaunt: (tauntId) => client?.taunt(tauntId),
      onToggleSound: toggleSound,
      onLeave: confirmLeave,
    };
    setScreen({
      name: 'table',
      el: host,
      update: (next) => { renderTable(host, next, callbacks, { soundOn: sound.isOn() }); },
      setSound: (on) => renderTable(host, latest ?? snapshot, callbacks).setSound(on),
      destroy: () => unmountTable(host),
    });
  }
  screen?.update?.(snapshot);
}

/** @param {RoomSnapshot} snapshot */
function showEnd(snapshot) {
  if (screen?.name !== 'end') {
    const end = createEnd({ onNewMatch: () => send((room) => room.newMatch()), onLeave: confirmLeave });
    setScreen({ name: 'end', el: end.el, update: (next) => end.update(next, busy) });
  }
  screen?.update?.(snapshot);
}

/** @param {RoomError | 'replaced'} error */
function showError(error) {
  dropClient();
  if (error !== 'replaced' && error !== 'broker-unreachable') setAddress(null);
  setScreen({ name: 'error', el: createErrorNotice(error, { onHome: () => showHome(null), onRetry: retry }) });
}

// -------------------------------------------------------------------------------------------- the room

function dropClient() {
  unsubscribe();
  unsubscribe = () => {};
  client = null;
  latest = null;
  seenOnline = false;
  clearTimeout(endTimer);
  endTimer = 0;
  clearBusy();
}

function clearBusy() {
  busy = false;
  clearTimeout(busyTimer);
}

/** @param {GameClient} next */
function attach(next) {
  dropClient();
  client = next;
  unsubscribe = next.subscribe(onSnapshot);
  const first = next.getSnapshot();
  if (first !== null) onSnapshot(first);
}

/** @param {string} name */
function create(name) {
  attempt = { kind: 'create', name };
  attach(hostRoom(name));
}

/** @param {string} code @param {string} [name] left out to come back as whoever this device already is */
function join(code, name) {
  attempt = { kind: 'join', code, name };
  setAddress(code);
  attach(joinRoom(code, name));
}

function retry() {
  if (attempt === null) showHome(null);
  else if (attempt.kind === 'create') create(attempt.name);
  else join(attempt.code, attempt.name);
}

/**
 * Sends a lobby or end-screen intent once and holds those buttons until the room answers.
 * @param {(room: GameClient) => void} intent
 */
function send(intent) {
  if (busy || client === null) return;
  busy = true;
  busyTimer = window.setTimeout(() => {
    busy = false;
    if (latest !== null) screen?.update?.(latest);
  }, BUSY_MS);
  if (latest !== null) screen?.update?.(latest);
  intent(client);
}

function confirmLeave() {
  if (latest === null) return;
  const hosting = latest.you.isHost;
  const playing = latest.room.phase === 'match' && latest.you.role === 'player';
  openConfirm({
    title: hosting ? 'Fechar a mesa?' : 'Sair da mesa?',
    text: hosting
      ? 'Você abriu esta mesa: se sair, ela fecha pra todo mundo.'
      : playing
        ? 'Saindo no meio da partida você fica de fora dela: só volta a jogar na próxima.'
        : 'Dá pra voltar pelo mesmo link enquanto a mesa estiver aberta.',
    confirm: hosting ? 'Fechar a mesa' : 'Sair da mesa',
    cancel: 'Continuar na mesa',
    onConfirm: () => {
      const leaving = client;
      dropClient();
      leaving?.leave();
      showHome(null);
    },
  });
}

/** @param {RoomSnapshot} snapshot */
function onSnapshot(snapshot) {
  const previous = latest;
  latest = snapshot;
  clearBusy();
  for (const cue of cuesFor(previous, snapshot)) sound.play(cue.name, cue.at);
  route(snapshot);
}

/** @param {RoomSnapshot} snapshot */
function route(snapshot) {
  if (snapshot.connection === 'closed') {
    // Closed without an error and without having asked for it: another tab of this device took the seat.
    showError(snapshot.error ?? 'replaced');
    return;
  }
  if (snapshot.connection === 'online') seenOnline = true;
  if (snapshot.room.members.length === 0 || (!seenOnline && attempt?.kind === 'create')) {
    showWaiting(snapshot);
    return;
  }
  if (snapshot.connection === 'online') setAddress(snapshot.room.code);
  const phase = snapshot.room.phase;
  if (phase !== 'ended') {
    clearTimeout(endTimer);
    endTimer = 0;
  }
  if (phase === 'lobby') {
    showLobby(snapshot);
  } else if (phase === 'match') {
    showTable(snapshot);
  } else if (screen?.name === 'table') {
    if (endTimer === 0) {
      endTimer = window.setTimeout(() => {
        endTimer = 0;
        if (latest !== null && latest.room.phase === 'ended') showEnd(latest);
      }, END_HOLD_MS);
    }
    screen.update?.(snapshot);
  } else {
    showEnd(snapshot);
  }
}

// ------------------------------------------------------------------------------------------------ sound

function toggleSound() {
  sound.setOn(!sound.isOn());
  sound.unlock();
  sound.play('card');
  screen?.setSound?.(sound.isOn());
}

/** The last seconds of my own clock tick, one tick per second. */
function tickClock() {
  const timer = latest?.timer ?? null;
  if (latest === null || timer === null || latest.you.role !== 'player' || !timer.players.includes(latest.you.id)) return;
  const seconds = Math.ceil((timer.remainingMs - (Date.now() - latest.receivedAt)) / 1000);
  if (seconds < 1 || seconds > TICK_FROM_SECONDS) return;
  const key = `${latest.seq}:${seconds}`;
  if (key === lastTick) return;
  lastTick = key;
  sound.play('tick');
}

// ------------------------------------------------------------------------------------------------- boot

// Browsers only let a page make sound after a tap or a key press: every one of them (re)opens the audio.
for (const type of ['pointerdown', 'keydown']) document.addEventListener(type, () => sound.unlock(), { capture: true, passive: true });
window.setInterval(tickClock, 200);

const invite = normalizeCode(new URLSearchParams(location.search).get('sala'));
const known = lastRoom();
// A reload, or the same link again: this device was in that room, so it goes straight back to its seat.
if (invite !== null && known !== null && known.code === invite && savedName() !== '') join(invite);
else showHome(invite);
