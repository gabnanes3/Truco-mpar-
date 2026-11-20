// The page the transport tests drive: the real session layer over the real PeerJS transport, with no
// interface. It behaves like the app where it matters to the network: `?sala=CODE` enters that room on load
// (so a reload comes back by itself), and a host puts its room code in the URL once the room is open.
// Everything a test needs is on `window.harness`.

import { hostRoom, joinRoom } from '../../../app/js/net/browser.js';
import { createPeerTransport } from '../../../app/js/net/peer-transport.js';

/** @typedef {import('../../../app/js/net/types.js').GameClient} GameClient */
/** @typedef {import('../../../app/js/net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../../../app/js/net/transport.js').Listener} Listener */
/** @typedef {typeof harness} Harness */

const BOT_DELAY_MS = 10;

/** @type {GameClient | null} */
let client = null;
let autoplay = false;
/** @type {ReturnType<typeof setTimeout> | null} */
let thinking = null;
/** @type {Listener | null} */
let listener = null;

/** @param {GameClient} next */
function use(next) {
  client = next;
  next.subscribe((snapshot) => {
    if (snapshot.connection === 'online' && snapshot.you.isHost) history.replaceState(null, '', `?sala=${snapshot.room.code}`);
    think();
  });
}

/** The bot takes a moment before acting, and acts on what is true by then. */
function think() {
  if (!autoplay || thinking !== null) return;
  thinking = setTimeout(() => {
    thinking = null;
    act();
  }, BOT_DELAY_MS);
}

/** When it is this page's turn to do something: a random valid answer, raise or card. */
function act() {
  const snapshot = client === null ? null : client.getSnapshot();
  if (!autoplay || client === null || snapshot === null || snapshot.connection !== 'online') return;
  const { game, you } = snapshot;
  const hand = game === null ? null : game.hand;
  if (game === null || hand === null || you.role !== 'player') return;
  if (game.phase === 'truco' && hand.raise !== null && hand.raise.mustAnswer) client.respond(Math.random() < 0.6);
  else if (game.phase === 'play' && hand.turn === you.id) {
    if (hand.canRaise && Math.random() < 0.25) client.raise();
    else client.play(hand.myCards[Math.floor(Math.random() * hand.myCards.length)]);
  }
}

const harness = {
  /** @param {string} name creates a room hosted by this page */
  create(name) {
    use(hostRoom(name));
  },

  /**
   * @param {string} code enters that room: as its host again if this browser was hosting it, as a guest otherwise
   * @param {string} [name]
   */
  enter(code, name) {
    use(joinRoom(code, name));
  },

  /** @returns {GameClient | null} the client of this page, for sending intents */
  get client() {
    return client;
  },

  /** @returns {RoomSnapshot | null} */
  snapshot() {
    return client === null ? null : client.getSnapshot();
  },

  /** @param {boolean} on whether this page plays by itself, choosing at random among what is valid */
  autoplay(on) {
    autoplay = on;
    think();
  },

  /** @type {string[]} what the listener opened by `listen` reported, in order */
  heard: [],

  /**
   * The transport on its own, below the session layer: tries to register a room code at the broker.
   * @param {string} code
   * @param {boolean} resume
   */
  listen(code, resume) {
    listener = createPeerTransport().listen(code, {
      onOpen: () => harness.heard.push('open'),
      onConnection: (connection) => {
        harness.heard.push('connection');
        connection.close();
      },
      onClose: (reason) => harness.heard.push(`close:${reason}`),
    }, { resume });
  },

  stopListening() {
    if (listener !== null) listener.close();
    listener = null;
  },

  /**
   * The transport on its own: one attempt to reach a room, closed again as soon as it opens.
   * @param {string} code
   * @returns {Promise<'open' | import('../../../app/js/net/transport.js').ConnectFailure>}
   */
  probe(code) {
    return new Promise((resolve) => {
      createPeerTransport().connect(code, {
        onOpen: (connection) => {
          connection.close();
          resolve('open');
        },
        onFail: resolve,
      });
    });
  },
};

Object.assign(window, { harness });

const parameters = new URLSearchParams(location.search);
const code = parameters.get('sala');
if (code !== null) harness.enter(code, parameters.get('nome') ?? undefined);
