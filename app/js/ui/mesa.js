// The table screen. One entry point: give it a container, a RoomSnapshot and the callbacks for intents, and
// it renders (first call) or updates (later calls) the DOM for whatever state the engine can produce, for
// 2 to 7 players, seated or watching.
//
// Update strategy: the skeleton is built once; every snapshot is turned into a TableModel (modelo.js) and
// patched onto stable, keyed elements, so nothing flickers, CSS transitions keep running and focus stays
// put. The snapshot is always the truth. Events only add motion on top of it, and only when `seq` is
// contiguous: cards on their way out remove themselves on a timer, so a skipped or late snapshot can never
// leave the screen in an intermediate state, and nothing here ever blocks input.

import { isManilha } from '../engine/cards.js';
import { TAUNT_COOLDOWN_MS, tauntText } from '../net/taunts.js';
import { append, el, reducedMotion, setAttr } from './dom.js';
import { createHeader } from './cabecalho.js';
import { createCentre } from './centro.js';
import { seatSpots } from './layout.js';
import { createMyArea } from './minha-area.js';
import { eventNews, tableModel } from './modelo.js';
import { createPanels } from './paineis.js';
import { createRaisePrompt } from './pedido.js';
import { createPlate } from './placa.js';
import { createSlot } from './vaga.js';

/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../net/types.js').RoomEvent} RoomEvent */
/** @typedef {import('./modelo.js').TableModel} TableModel */
/** @typedef {import('./placa.js').Plate} Plate */
/** @typedef {import('./vaga.js').Slot} Slot */

/**
 * Intents of the person at this device. Fire-and-forget: the answer is the next snapshot.
 * @typedef {Object} TableCallbacks
 * @property {(card: string) => void} onPlay
 * @property {() => void} onRaise call truco / seis / nove / doze
 * @property {(accept: boolean) => void} onRespond answer a pending raise
 * @property {(tauntId: string) => void} onTaunt
 * @property {() => void} onToggleSound the owner flips the setting and calls `setSound`
 * @property {() => void} onLeave the owner confirms and leaves
 */
/**
 * @typedef {Object} TableOptions
 * @property {boolean} [soundOn] initial state of the sound button (default true)
 * @property {() => number} [now] the clock `RoomSnapshot.receivedAt` was read from (default Date.now)
 * @property {number} [tauntMs] how long a taunt bubble stays (default 3000)
 */
/**
 * @typedef {Object} Table
 * @property {(snapshot: RoomSnapshot) => void} update
 * @property {(on: boolean) => void} setSound reflect the sound setting on the toggle button
 * @property {() => void} destroy stop every timer and empty the container
 */

const TICK_MS = 250;
/** A finished round stays on the table this long before it goes to whoever won it. */
const ROUND_HOLD_MS = 1100;
/** Input comes back by itself if no snapshot answers an intent (e.g. it was lost on the way). */
const BUSY_MS = 4000;
const TAUNT_MS = 3000;

/** Where a played card comes from, per side of the table. */
const ARRIVAL = /** @type {const} */ ({
  esq: ['-26px', '0px'], dir: ['26px', '0px'], topo: ['0px', '-24px'], 'canto-esq': ['-10px', '-24px'], 'canto-dir': ['10px', '-24px'],
});

/**
 * @param {HTMLElement} container emptied and owned by the table until `destroy`
 * @param {TableCallbacks} callbacks read at the moment of each intent
 * @param {TableOptions} [options]
 * @returns {Table}
 */
export function createTable(container, callbacks, options = {}) {
  const now = options.now ?? Date.now;
  const tauntMs = options.tauntMs ?? TAUNT_MS;

  const header = createHeader({ onToggleSound: () => callbacks.onToggleSound(), onLeave: () => callbacks.onLeave() });
  header.setSound(options.soundOn ?? true);
  const centre = createCentre();
  const mySlot = createSlot('vaga--minha');
  mySlot.el.style.setProperty('--de-x', '0px');
  mySlot.el.style.setProperty('--de-y', '34px');
  const mesa = append(el('div', 'mesa'), el('div', 'mesa__tampo'), centre.el, mySlot.el);
  const prompt = createRaisePrompt((accept) => send(() => callbacks.onRespond(accept)));
  const mine = createMyArea({
    onPlay: (card) => send(() => callbacks.onPlay(card)),
    onRaise: () => send(() => callbacks.onRaise()),
    onTaunt: sendTaunt,
  });
  const panels = createPanels();
  const root = append(
    el('div', 'app app--mesa'),
    el('div', 'luz'), header.el, panels.scores, append(el('main', 'salao'), mesa, prompt.el), panels.story, mine.el,
  );
  root.hidden = true;
  root.addEventListener('pointerdown', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('.provocar, .icone-btn--lousa')) mine.closePicker();
  });
  container.replaceChildren(root);

  /** @type {RoomSnapshot | null} */
  let last = null;
  /** @type {TableModel | null} */
  let model = null;
  /** @type {Map<string, { wrap: HTMLElement, plate: Plate, slot: Slot }>} */
  const seats = new Map();
  let matchKey = '';
  let seenAt = 0;
  let busy = false;
  let busyTimer = 0;
  let tauntReadyAt = 0;
  let tauntTimer = 0;
  let ticker = 0;
  let wasMyMove = false;
  let shownHand = 0;

  /** Cards still on their way out belong to a moment that is over: drop them. */
  function flushSlots() {
    mySlot.flush();
    for (const seat of seats.values()) seat.slot.flush();
  }

  /** Runs an intent once and holds further input until the next snapshot answers it. @param {() => void} intent */
  function send(intent) {
    if (busy || last === null) return;
    busy = true;
    clearTimeout(busyTimer);
    busyTimer = window.setTimeout(() => {
      busy = false;
      if (last) render(last, false, false);
    }, BUSY_MS);
    render(last, false, false);
    intent();
  }

  /** @param {string} tauntId */
  function sendTaunt(tauntId) {
    if (now() < tauntReadyAt) return;
    tauntReadyAt = now() + TAUNT_COOLDOWN_MS;
    clearTimeout(tauntTimer);
    tauntTimer = window.setTimeout(() => {
      if (last) render(last, false, false);
    }, TAUNT_COOLDOWN_MS + 40);
    if (last) render(last, false, false);
    callbacks.onTaunt(tauntId);
  }

  /** @param {TableModel} next */
  function rebuildSeats(next) {
    for (const seat of seats.values()) {
      seat.plate.destroy();
      seat.slot.destroy();
      seat.wrap.remove();
    }
    seats.clear();
    const spots = seatSpots(next.others.length);
    next.others.forEach((seatModel, index) => {
      const spot = spots[index];
      const plate = createPlate();
      const slot = createSlot();
      const wrap = append(el('div', 'lugar'), plate.el, slot.el);
      wrap.dataset.lado = spot.lado;
      wrap.dataset.dlado = spot.dlado;
      wrap.style.setProperty('--py', `${spot.py}%`);
      wrap.style.setProperty('--dx', `${spot.dx}%`);
      wrap.style.setProperty('--dy', `${spot.dy}%`);
      slot.el.style.setProperty('--de-x', ARRIVAL[spot.lado][0]);
      slot.el.style.setProperty('--de-y', ARRIVAL[spot.lado][1]);
      mesa.insertBefore(wrap, mySlot.el);
      seats.set(seatModel.id, { wrap, plate, slot });
    });
    setAttr(mesa, 'data-k', String(next.others.length));
    setAttr(mesa, 'data-topo', spots.some((spot) => spot.lado === 'topo'));
    matchKey = next.matchKey;
  }

  /** @param {string} id @returns {Plate | undefined} */
  const plateOf = (id) => (id === model?.me.id ? mine.plate : seats.get(id)?.plate);
  /** @param {string} id @returns {Slot | undefined} */
  const slotOf = (id) => (id === model?.me.id ? mySlot : seats.get(id)?.slot);

  /**
   * A round ended and the hand goes on: the snapshot already shows an empty table, so put the finished
   * round back for a moment (including the card nobody saw land) and send it to whoever won it.
   * @param {RoomSnapshot} snapshot
   */
  function collectFinishedRound(snapshot) {
    const game = snapshot.game;
    const hand = game?.hand ?? null;
    if (!game || hand === null || (game.phase !== 'play' && game.phase !== 'truco')) return;
    const ended = snapshot.events.filter((event) => event.type === 'roundEnded').pop();
    const round = ended && ended.type === 'roundEnded' ? hand.rounds[ended.round] : undefined;
    if (!round) return;
    flushSlots();
    const winnerPlate = round.winner === null ? null : plateOf(round.winner)?.el ?? null;
    for (const play of round.plays) {
      const slot = slotOf(play.playerId);
      if (!slot) continue;
      const mark = play.playerId === round.winner ? 'levou' : null;
      slot.update({ id: play.card, manilha: isManilha(play.card, hand.manilha), voided: play.voided, mark }, false, true);
      slot.sendOff(ROUND_HOLD_MS, winnerPlate);
    }
  }

  /** @param {readonly RoomEvent[]} events @param {boolean} animate */
  function showTaunts(events, animate) {
    for (const event of events) {
      if (event.type !== 'taunt') continue;
      const text = tauntText(event.tauntId);
      if (text !== null) plateOf(event.playerId)?.say(text, tauntMs, animate);
    }
  }

  function tick() {
    const timer = last?.timer ?? null;
    if (last === null || timer === null || model === null) return;
    const sinceArrival = now() - last.receivedAt;
    // A snapshot stamped by another clock would freeze the countdown at zero: fall back to when it got here.
    const elapsed = sinceArrival >= 0 && sinceArrival < 600000 ? sinceArrival : now() - seenAt;
    const left = Math.max(0, timer.remainingMs - elapsed);
    const seconds = Math.ceil(left / 1000);
    mine.setClock(seconds, timer.totalMs > 0 ? Math.min(1, left / timer.totalMs) : 0);
    for (const [id, seat] of seats) seat.plate.setSeconds(timer.players.includes(id) ? seconds : null);
    mine.plate.setSeconds(timer.players.includes(model.me.id) ? seconds : null);
  }

  function syncClock() {
    if (last?.timer) {
      tick();
      if (ticker === 0) ticker = window.setInterval(tick, TICK_MS);
      return;
    }
    clearInterval(ticker);
    ticker = 0;
    mine.setClock(null, 0);
    mine.plate.setSeconds(null);
    for (const seat of seats.values()) seat.plate.setSeconds(null);
  }

  /**
   * @param {RoomSnapshot} snapshot
   * @param {boolean} fresh the snapshot directly follows the one on screen: its events may be shown
   * @param {boolean} animate
   */
  function render(snapshot, fresh, animate) {
    model = tableModel(snapshot);
    root.hidden = model === null;
    if (model === null) {
      syncClock();
      return;
    }
    if (model.matchKey !== matchKey) rebuildSeats(model);
    if (model.handNumber !== shownHand) flushSlots();
    shownHand = model.handNumber;
    const events = fresh ? snapshot.events : [];

    header.update(model);
    panels.update(model);
    centre.update(model, animate);
    setAttr(mesa, 'data-pedido', model.raise !== null);

    if (animate) collectFinishedRound(snapshot);
    for (const seatModel of model.others) {
      const seat = seats.get(seatModel.id);
      if (!seat) continue;
      seat.plate.update(seatModel, animate);
      seat.slot.update(seatModel.card, seatModel.waiting, animate);
    }
    mySlot.update(model.me.card, model.me.waiting, animate);
    setAttr(mySlot.el, 'data-vez', model.myTurnToPlay && model.me.card === null);

    mine.update(model, {
      busy,
      tauntReady: now() >= tauntReadyAt,
      animate,
      dealt: animate && events.some((event) => event.type === 'handDealt'),
    });
    prompt.update(model.raise, { busy, online: model.online, animate });
    syncClock();

    if (fresh) {
      header.announce(eventNews(snapshot), animate);
      showTaunts(events, animate);
      const myMove = model.turnMode === 'minha';
      if (myMove && !wasMyMove) buzz();
    }
    wasMyMove = model.turnMode === 'minha';
  }

  return {
    update(snapshot) {
      const fresh = last !== null && snapshot.seq === last.seq + 1;
      if (last === null || snapshot.seq !== last.seq) {
        busy = false;
        clearTimeout(busyTimer);
      }
      if (snapshot !== last) seenAt = now();
      last = snapshot;
      render(snapshot, fresh, fresh && !reducedMotion());
    },
    setSound(on) {
      header.setSound(on);
    },
    destroy() {
      clearInterval(ticker);
      clearTimeout(busyTimer);
      clearTimeout(tauntTimer);
      header.destroy();
      mine.plate.destroy();
      mySlot.destroy();
      for (const seat of seats.values()) {
        seat.plate.destroy();
        seat.slot.destroy();
      }
      root.remove();
    },
  };
}

/** One short tick on the phone when it becomes my move. Never throws where vibration is missing or blocked. */
function buzz() {
  try {
    // Browsers refuse (and log) vibration before the first tap on the page.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (typeof navigator.vibrate === 'function') navigator.vibrate(30);
  } catch {
    // Haptics are a nicety.
  }
}

/** @type {WeakMap<HTMLElement, { table: Table, callbacks: TableCallbacks }>} */
const mounted = new WeakMap();

/**
 * The single entry point of the table screen: mounts it in `container` on the first call and updates it on
 * every later call. `options` only count on the first call.
 * @param {HTMLElement} container
 * @param {RoomSnapshot} snapshot
 * @param {TableCallbacks} callbacks
 * @param {TableOptions} [options]
 * @returns {Table} the same object for the same container, e.g. to call `setSound`
 */
export function renderTable(container, snapshot, callbacks, options) {
  let entry = mounted.get(container);
  if (entry) {
    Object.assign(entry.callbacks, callbacks);
  } else {
    const own = { ...callbacks };
    entry = { table: createTable(container, own, options), callbacks: own };
    mounted.set(container, entry);
  }
  entry.table.update(snapshot);
  return entry.table;
}

/** @param {HTMLElement} container */
export function unmountTable(container) {
  mounted.get(container)?.table.destroy();
  mounted.delete(container);
}
