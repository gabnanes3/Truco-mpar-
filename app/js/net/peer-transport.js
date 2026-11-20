// The production transport: WebRTC data channels, with the public PeerJS broker introducing the two sides.
// Uses the global `Peer` defined by vendor/peerjs.min.js (PeerJS 1.5.4); browser only.
//
// The host registers the peer id `trucoimpar-v1-<CODE>` and accepts data connections on it. Every guest
// connection attempt uses a peer of its own with a random id, destroyed with the attempt or the connection:
// whatever the broker says to that peer is then about that attempt and nothing else.

import { cryptoRandom, randomText } from './env.js';

/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./transport.js').Connection} Connection */
/** @typedef {import('./transport.js').ConnectFailure} ConnectFailure */
/** @typedef {import('./transport.js').ListenFailure} ListenFailure */
/** @typedef {import('./transport.js').ListenHandlers} ListenHandlers */

// The few parts of PeerJS this adapter touches.
/**
 * @typedef {Object} DataChannel a PeerJS DataConnection
 * @property {boolean} open
 * @property {string} serialization
 * @property {(data: unknown) => void} send
 * @property {() => void} close emits 'close' only when it was open
 * @property {((event: 'data', listener: (data: unknown) => void) => unknown)
 *   & ((event: 'open' | 'close' | 'error', listener: () => void) => unknown)} on
 * @property {() => unknown} removeAllListeners
 */
/**
 * @typedef {Object} BrokerPeer a PeerJS Peer
 * @property {boolean} disconnected the broker link is down (the data connections are not affected)
 * @property {(id: string, options: { serialization: 'json', reliable: boolean }) => DataChannel | undefined} connect
 * @property {() => void} reconnect re-opens the broker link under the same id; throws unless disconnected
 * @property {() => void} disconnect drops the broker link only
 * @property {() => void} destroy drops the broker link and closes every data connection
 * @property {((event: 'error', listener: (error: { type: string }) => void) => unknown)
 *   & ((event: 'connection', listener: (channel: DataChannel) => void) => unknown)
 *   & ((event: 'open' | 'disconnected' | 'close', listener: () => void) => unknown)} on
 * @property {() => unknown} removeAllListeners
 */
/** @typedef {new (id: string, options: Record<string, unknown>) => BrokerPeer} PeerConstructor */

export const PEER_PREFIX = 'trucoimpar-v1-';

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
/** How long the broker gets to answer a registration before the attempt counts as failed. */
const BROKER_TIMEOUT_MS = 10000;
/** Re-opening our own room: how long a stale registration of its id at the broker is waited out. */
const RESUME_WAIT_MS = 60000;
/** A guest's connection that has not opened by then is dropped (the guest retries by itself). */
const CHANNEL_TIMEOUT_MS = 15000;
const MAX_OPENING = 32;
/** After the room stops listening, the connections it still holds get this long to carry its goodbye. */
const LINGER_MS = 2000;
const GUEST_ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * @returns {Record<string, unknown>} options for `new Peer`. Without overrides PeerJS keeps its defaults: its
 *   public broker and its own ICE list (Google STUN plus the PeerJS TURN servers). Overrides come from
 *   `globalThis.__TRUCO_CONFIG__.peer = { host, port, path, secure, iceServers }` (tests use a local broker).
 */
function peerOptions() {
  const page = /** @type {{ __TRUCO_CONFIG__?: { peer?: unknown } }} */ (globalThis).__TRUCO_CONFIG__;
  const peer = typeof page === 'object' && page !== null ? page.peer : null;
  /** @type {Record<string, unknown>} */
  const given = typeof peer === 'object' && peer !== null ? { ...peer } : {};
  /** @type {Record<string, unknown>} */
  const options = { debug: 0 };
  if (typeof given.host === 'string' && given.host !== '') options.host = given.host;
  if (typeof given.port === 'number') options.port = given.port;
  if (typeof given.path === 'string') options.path = given.path;
  if (typeof given.secure === 'boolean') options.secure = given.secure;
  if (Array.isArray(given.iceServers)) options.config = { iceServers: given.iceServers, sdpSemantics: 'unified-plan' };
  return options;
}

/**
 * @param {string} id
 * @returns {BrokerPeer} throws when PeerJS is not loaded or cannot even start
 */
function createPeer(id) {
  const Peer = /** @type {{ Peer?: PeerConstructor }} */ (globalThis).Peer;
  if (typeof Peer !== 'function') throw new Error('PeerJS is not loaded');
  return new Peer(id, peerOptions());
}

/**
 * @param {DataChannel} channel an open data connection
 * @param {() => void} release called once when the connection is over, whoever ended it
 * @returns {Connection}
 */
function wrap(channel, release) {
  let over = false;
  const end = () => {
    over = true;
    channel.removeAllListeners();
    channel.close();
    release();
  };
  /** @type {Connection} */
  const connection = {
    onMessage: null,
    onClose: null,
    send(message) {
      if (over || !channel.open) return;
      try {
        channel.send(message);
      } catch {
        // A channel dying under the message: the session's heartbeat is what notices.
      }
    },
    close() {
      if (!over) end();
    },
  };
  channel.on('data', (data) => {
    if (!over && connection.onMessage !== null) connection.onMessage(data);
  });
  channel.on('close', () => {
    if (over) return;
    end();
    if (connection.onClose !== null) connection.onClose();
  });
  return connection;
}

/** The host side of one `listen` call: keeps the room's id registered at the broker and accepts guests. */
class RoomListener {
  /**
   * @param {string} code
   * @param {ListenHandlers} handlers
   * @param {boolean} resume
   */
  constructor(code, handlers, resume) {
    this.id = PEER_PREFIX + code;
    this.handlers = handlers;
    this.resume = resume;
    this.startedAt = Date.now();
    /** @type {BrokerPeer | null} */
    this.peer = null;
    /** The room has been reachable: from then on the peer is kept, and only its broker link is repaired. */
    this.opened = false;
    /** Closed by the room, or reported dead: nothing is reported after this. */
    this.closed = false;
    this.delay = RETRY_MIN_MS;
    /** @type {ReturnType<typeof setTimeout> | null} the one thing being waited for (see `wait`) */
    this.timer = null;
    /** @type {Map<DataChannel, ReturnType<typeof setTimeout>>} guests' connections that are still opening */
    this.opening = new Map();
    /** @type {Set<Connection>} connections handed to the room and still open */
    this.active = new Set();
    // Never inside `listen` itself: the caller has not stored the listener yet.
    this.wait(0, () => this.register());
  }

  /** Stops accepting connections (called by the room). Connections it still holds are its own to close. */
  close() {
    if (this.closed) return;
    this.closed = true;
    this.stopWaiting();
    for (const [channel, timeout] of this.opening) {
      clearTimeout(timeout);
      channel.close();
    }
    this.opening.clear();
    const { peer } = this;
    if (peer === null) return;
    peer.removeAllListeners();
    if (this.active.size === 0) {
      this.dropPeer();
      return;
    }
    // Destroying the peer would cut the goodbye the room may have just sent on them: the id is given back to
    // the broker now, and the peer goes when the room has closed the last connection (or shortly, anyway).
    if (!peer.disconnected) peer.disconnect();
    this.wait(LINGER_MS, () => this.dropPeer());
  }

  /**
   * One timer at a time: the broker's answer, the next try, or the last moments of a closed listener.
   * @param {number} ms
   * @param {() => void} task
   */
  wait(ms, task) {
    this.stopWaiting();
    this.timer = setTimeout(() => {
      this.timer = null;
      task();
    }, ms);
  }

  stopWaiting() {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  /** @returns {number} 1 s, 2 s, 4 s, then 8 s every time, until the broker answers */
  nextDelay() {
    const delay = this.delay;
    this.delay = Math.min(RETRY_MAX_MS, delay * 2);
    return delay;
  }

  /** Asks the broker for the room's id, with a new peer. */
  register() {
    /** @type {BrokerPeer} */
    let peer;
    try {
      peer = createPeer(this.id);
    } catch {
      this.fail('unreachable');
      return;
    }
    this.peer = peer;
    // A peer that was dropped may still have events on their way: only the current one is listened to.
    peer.on('open', () => {
      if (peer === this.peer) this.brokerUp();
    });
    peer.on('error', (error) => {
      if (peer === this.peer) this.brokerError(error.type);
    });
    peer.on('disconnected', () => {
      if (peer === this.peer) this.brokerDown();
    });
    peer.on('close', () => {
      // PeerJS destroyed it under us: every connection went with it, and the room has to listen again.
      if (peer === this.peer) this.fail('unreachable');
    });
    peer.on('connection', (channel) => {
      if (peer === this.peer) this.incoming(channel);
      else channel.close();
    });
    this.wait(BROKER_TIMEOUT_MS, () => this.fail('unreachable'));
  }

  brokerUp() {
    this.stopWaiting();
    this.delay = RETRY_MIN_MS;
    if (this.opened) return;
    this.opened = true;
    this.handlers.onOpen();
  }

  /** @param {string} type a PeerJS error type */
  brokerError(type) {
    // 'peer-unavailable' and 'webrtc' are about one guest's connection, never about the room. And once the
    // room has been open PeerJS keeps the peer whatever happens to the broker link: `brokerDown` repairs it.
    if (this.opened || type === 'peer-unavailable' || type === 'webrtc') return;
    if (type !== 'unavailable-id') {
      this.fail('unreachable');
      return;
    }
    // The id is registered to somebody else. For a new room that is a code collision. For a room that was
    // ours it is most likely our own previous page, which the broker has not noticed is gone: wait it out.
    this.dropPeer();
    const delay = this.nextDelay();
    if (!this.resume || Date.now() - this.startedAt + delay > RESUME_WAIT_MS) this.fail('code-taken');
    else this.wait(delay, () => this.register());
  }

  /** The broker link dropped. Connections already open are not affected. */
  brokerDown() {
    if (!this.opened) return;
    this.wait(this.nextDelay(), () => {
      const { peer } = this;
      if (peer === null) return;
      try {
        peer.reconnect();
      } catch {
        // Not in a state to reconnect: the timeout below puts it there.
      }
      // No answer at all: drop the link again, which comes back here for the next try.
      this.wait(BROKER_TIMEOUT_MS, () => {
        if (peer.disconnected) this.brokerDown();
        else peer.disconnect();
      });
    });
  }

  /** @param {DataChannel} channel a guest is connecting: it is handed to the room once it is open */
  incoming(channel) {
    if (this.closed || channel.serialization !== 'json' || this.opening.size >= MAX_OPENING) {
      channel.close();
      return;
    }
    const timeout = setTimeout(() => {
      this.opening.delete(channel);
      channel.close();
    }, CHANNEL_TIMEOUT_MS);
    this.opening.set(channel, timeout);
    channel.on('open', () => {
      clearTimeout(timeout);
      this.opening.delete(channel);
      const connection = wrap(channel, () => {
        this.active.delete(connection);
        if (this.closed && this.active.size === 0) this.dropPeer();
      });
      this.active.add(connection);
      this.handlers.onConnection(connection);
    });
  }

  /**
   * This listener is over without the room having closed it.
   * @param {ListenFailure} reason
   */
  fail(reason) {
    if (this.closed) return;
    this.close();
    this.handlers.onClose(reason);
  }

  dropPeer() {
    this.stopWaiting();
    const { peer } = this;
    this.peer = null;
    if (peer === null) return;
    peer.removeAllListeners();
    peer.destroy();
  }
}

/**
 * One connection attempt of a guest, with a peer of its own.
 * @param {string} code
 * @param {import('./transport.js').ConnectHandlers} handlers
 * @returns {import('./transport.js').PendingConnect}
 */
function connectToRoom(code, handlers) {
  /** Opened, failed or cancelled: nothing more is reported. */
  let settled = false;
  /** @type {BrokerPeer | null} */
  let peer = null;
  const dropPeer = () => {
    if (peer === null) return;
    peer.removeAllListeners();
    peer.destroy();
    peer = null;
  };
  /** @param {ConnectFailure} reason */
  const fail = (reason) => {
    if (settled) return;
    settled = true;
    dropPeer();
    handlers.onFail(reason);
  };
  const dial = () => {
    const channel = peer === null ? undefined : peer.connect(PEER_PREFIX + code, { serialization: 'json', reliable: true });
    if (channel === undefined) {
      fail('unreachable');
      return;
    }
    channel.on('open', () => {
      if (settled) return;
      settled = true;
      channel.removeAllListeners();
      handlers.onOpen(wrap(channel, dropPeer));
    });
    channel.on('error', () => fail('unreachable'));
  };

  try {
    peer = createPeer(`${PEER_PREFIX}guest-${randomText(cryptoRandom, GUEST_ID_ALPHABET, 20)}`);
    peer.on('open', () => {
      if (!settled) dial();
    });
    peer.on('error', (error) => {
      // 'webrtc' is one step of the negotiation failing: the attempt may still open, or the caller times out.
      // Once the connection is open the broker is not needed any more, and nothing it says matters.
      if (error.type !== 'webrtc') fail(error.type === 'peer-unavailable' ? 'not-found' : 'unreachable');
    });
  } catch {
    // Reported like any other failure, but never inside `connect` itself.
    setTimeout(() => fail('unreachable'), 0);
  }
  return {
    cancel() {
      if (settled) return;
      settled = true;
      dropPeer();
    },
  };
}

/**
 * @returns {Transport} rooms over PeerJS. It holds nothing between calls: every `listen` and every `connect`
 *   owns its peer and releases it when closed, cancelled, failed, or when its connection ends.
 */
export function createPeerTransport() {
  return {
    listen: (code, handlers, options) => new RoomListener(code, handlers, options.resume),
    connect: connectToRoom,
  };
}
