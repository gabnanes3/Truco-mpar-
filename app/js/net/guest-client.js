// A guest's side of the room: joins by code, keeps the connection alive, reconnects by itself for as long as
// the page is open, and turns what the host sends into the RoomSnapshot the UI renders from.

import { DEFAULT_TARGET } from '../engine/game.js';
import { createEnv } from './env.js';
import { clearLastRoom, loadLastRoom, saveLastRoom } from './identity.js';
import { PROTOCOL_VERSION, normalizeCode, parseHostMessage } from './protocol.js';

/** @typedef {import('./types.js').GameClient} GameClient */
/** @typedef {import('./types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('./types.js').RoomEvent} RoomEvent */
/** @typedef {import('./types.js').RoomError} RoomError */
/** @typedef {import('./types.js').ConnectionState} ConnectionState */
/** @typedef {import('./types.js').TargetScore} TargetScore */
/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./transport.js').Connection} Connection */
/** @typedef {import('./transport.js').PendingConnect} PendingConnect */
/** @typedef {import('./transport.js').ConnectFailure} ConnectFailure */
/** @typedef {import('./protocol.js').StateMessage} StateMessage */
/** @typedef {import('./protocol.js').Intent} Intent */
/** @typedef {import('./protocol.js').ByeReason} ByeReason */
/** @typedef {import('./identity.js').Identity} Identity */
/** @typedef {import('./env.js').EnvOptions} EnvOptions */

const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
/** Joining a room for the first time: tries before "room not found" / "cannot reach the network" is final. */
const NOT_FOUND_ATTEMPTS = 2;
const UNREACHABLE_ATTEMPTS = 3;
/** After waking up, how long the host has to answer a ping before the connection is rebuilt. */
const PROBE_MS = 3000;
/** `close()` is abrupt, so the last message gets this long to travel first. */
const FLUSH_MS = 400;

/**
 * What the host's goodbye means for the UI. A wrong secret is reported as 'kicked': the seat is not ours.
 * Being replaced by a newer tab, or having left, closes without an error.
 * @type {Record<ByeReason, RoomError | null>}
 */
const BYE_ERRORS = {
  full: 'full',
  kicked: 'kicked',
  'bad-version': 'bad-version',
  'host-closed': 'host-closed',
  refused: 'kicked',
  replaced: null,
  left: null,
};

/** @implements {GameClient} */
export class GuestClient {
  /**
   * Starts connecting right away. `getSnapshot()` is never null: until the host answers it returns a
   * placeholder (empty room, `connection: 'connecting'`).
   * @param {{ transport: Transport, code: string, identity: Identity, env?: EnvOptions }} options
   */
  constructor(options) {
    const env = createEnv(options.env);
    this.transport = options.transport;
    this.clock = env.clock;
    this.storage = env.storage;
    this.config = env.config;
    this.identity = options.identity;
    this.code = normalizeCode(options.code) ?? options.code;
    const now = this.clock.now();

    /** @type {ConnectionState} */
    this.connection = 'connecting';
    /** @type {RoomError | null} */
    this.error = null;
    /** @type {StateMessage | null} the last state the host sent */
    this.state = null;
    this.receivedAt = now;
    /**
     * Whether this device has been in the room before (now or before a reload). If so the room is known to
     * exist, and failing to reach it means "host away", never "not found".
     */
    this.known = loadLastRoom(this.storage, now)?.code === this.code;
    /** @type {Connection | null} the one connection whose messages count */
    this.link = null;
    /** @type {PendingConnect | null} */
    this.pending = null;
    /** Identifies the current connection attempt: callbacks of older attempts are ignored. */
    this.generation = 0;
    this.attempt = 0;
    this.retries = 0;
    this.notFound = 0;
    this.unreachable = 0;
    this.lastTrafficAt = now;
    this.lastBeatAt = now;
    this.stopped = false;
    /** @type {unknown} */
    this.retryTimer = null;
    /** @type {unknown} */
    this.connectTimer = null;
    /** @type {unknown} */
    this.beatTimer = null;
    /** @type {unknown} */
    this.probeTimer = null;
    /** @type {Set<(snapshot: RoomSnapshot) => void>} */
    this.listeners = new Set();
    /** @type {RoomSnapshot} */
    this.snapshot = this.compose([]);

    this.stopWake = env.onWake(() => this.nudge());
    this.scheduleBeat();
    this.connect();
  }

  // --------------------------------------------------------------------------------------- GameClient

  /** @returns {RoomSnapshot} */
  getSnapshot() {
    return this.snapshot;
  }

  /**
   * @param {(snapshot: RoomSnapshot) => void} listener
   * @returns {() => void}
   */
  subscribe(listener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** @param {string} card */
  play(card) {
    this.send({ t: 'play', card });
  }

  raise() {
    this.send({ t: 'truco' });
  }

  /** @param {boolean} accept */
  respond(accept) {
    this.send({ t: 'respond', accept });
  }

  /** @param {string} tauntId */
  taunt(tauntId) {
    this.send({ t: 'taunt', id: tauntId });
  }

  // The four below are the host's alone: a guest may ask, and the host refuses.
  start() {
    this.send({ t: 'start' });
  }

  /** @param {string} playerId */
  kick(playerId) {
    this.send({ t: 'kick', playerId });
  }

  newMatch() {
    this.send({ t: 'newMatch' });
  }

  /** @param {TargetScore} target */
  setTargetScore(target) {
    this.send({ t: 'setTarget', target });
  }

  /** Leaves the room for good: the seat is given up and nothing reconnects. */
  leave() {
    if (this.stopped) return;
    const link = this.link;
    this.link = null;
    if (link !== null) {
      link.send({ t: 'leave' });
      this.clock.setTimeout(() => link.close(), FLUSH_MS);
    }
    clearLastRoom(this.storage, this.code);
    this.stop(null);
  }

  /** Page teardown: stops everything without leaving the room. */
  close() {
    if (!this.stopped) this.stop(null);
  }

  /**
   * The device may have been away (tab visible again, network back): retry now instead of waiting, or, when
   * the connection looks alive, make the host prove it.
   */
  nudge() {
    if (this.stopped) return;
    const link = this.link;
    if (link === null || this.connection !== 'online') {
      if (this.retryTimer !== null) {
        this.retries = 0;
        this.connect();
      }
      return;
    }
    const askedAt = this.clock.now();
    link.send({ t: 'ping' });
    if (this.probeTimer !== null) this.clock.clearTimeout(this.probeTimer);
    this.probeTimer = this.clock.setTimeout(() => {
      this.probeTimer = null;
      if (this.link === link && this.lastTrafficAt < askedAt) this.reconnect();
    }, PROBE_MS);
  }

  // --------------------------------------------------------------------------------------- connecting

  /** Opens a new connection, abandoning whatever connection or attempt existed. */
  connect() {
    if (this.stopped) return;
    this.abandon();
    this.generation += 1;
    const generation = this.generation;
    // Grows with every connection of this identity, across reloads and tabs too (same device, same clock).
    this.attempt = Math.max(this.clock.now(), this.attempt + 1);
    const { attempt } = this;
    try {
      this.pending = this.transport.connect(this.code, {
        onOpen: (link) => {
          if (generation !== this.generation || this.stopped) {
            link.close();
            return;
          }
          this.pending = null;
          this.link = link;
          link.onMessage = (raw) => this.receive(link, raw);
          link.onClose = () => this.lost(link);
          const { playerId, secret, name } = this.identity;
          link.send({ t: 'hello', v: PROTOCOL_VERSION, playerId, secret, name, attempt });
        },
        onFail: (reason) => {
          if (generation === this.generation && !this.stopped) this.failed(reason);
        },
      });
    } catch (error) {
      // A transport that cannot even try is one more failed attempt (reported by the timer below).
      console.error('[truco] could not start connecting', error);
    }
    // Covers a connection that never opens and a host that never answers the hello.
    this.connectTimer = this.clock.setTimeout(() => {
      this.connectTimer = null;
      if (generation === this.generation && !this.stopped) this.failed('unreachable');
    }, this.config.heartbeatTimeoutMs);
  }

  /** Drops the current connection and attempt without telling anybody. */
  abandon() {
    for (const timer of [this.retryTimer, this.connectTimer, this.probeTimer]) {
      if (timer !== null) this.clock.clearTimeout(timer);
    }
    this.retryTimer = null;
    this.connectTimer = null;
    this.probeTimer = null;
    if (this.pending !== null) this.pending.cancel();
    this.pending = null;
    if (this.link !== null) this.link.close();
    this.link = null;
    // Whatever an older attempt still reports is ignored from here on.
    this.generation += 1;
  }

  /** @param {ConnectFailure} reason */
  failed(reason) {
    this.abandon();
    if (this.state === null && !this.known) {
      // Joining for the first time: a missing room or a dead network is an answer, not something to wait out.
      if (reason === 'not-found') this.notFound += 1;
      else this.unreachable += 1;
      if (this.notFound >= NOT_FOUND_ATTEMPTS) {
        this.stop('not-found');
        return;
      }
      if (this.unreachable >= UNREACHABLE_ATTEMPTS) {
        this.stop('broker-unreachable');
        return;
      }
    }
    this.retryLater();
  }

  /** @param {Connection} link */
  lost(link) {
    if (link === this.link && !this.stopped) this.failed('unreachable');
  }

  /** The connection is useless: rebuild it now. */
  reconnect() {
    if (this.connection === 'online') this.setConnection('reconnecting');
    this.connect();
  }

  /** Schedules the next attempt: 1 s, 2 s, 4 s, then every 8 s, for as long as the page is open. */
  retryLater() {
    if (this.connection === 'online') this.setConnection('reconnecting');
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.retries);
    this.retries += 1;
    this.retryTimer = this.clock.setTimeout(() => {
      this.retryTimer = null;
      this.connect();
    }, delay);
  }

  scheduleBeat() {
    this.beatTimer = this.clock.setTimeout(() => this.beat(), this.config.heartbeatMs);
  }

  /** Heartbeat: pings the host, and notices when nothing has come from it for too long. */
  beat() {
    if (this.stopped) return;
    const now = this.clock.now();
    const slept = now - this.lastBeatAt > this.config.heartbeatMs * 2.5;
    this.lastBeatAt = now;
    this.scheduleBeat();
    if (slept) {
      // This page was asleep: the silence was ours. Start counting again and check the connection.
      this.lastTrafficAt = now;
      this.nudge();
      return;
    }
    const silent = now - this.lastTrafficAt > this.config.heartbeatTimeoutMs;
    if (this.link !== null && this.connection === 'online') {
      if (silent) {
        this.setConnection('host-away');
        this.connect();
      } else {
        this.link.send({ t: 'ping' });
      }
    } else if (silent && this.connection !== 'host-away' && (this.state !== null || this.known)) {
      this.setConnection('host-away');
    }
  }

  // ----------------------------------------------------------------------------------------- messages

  /**
   * @param {Connection} link
   * @param {unknown} raw
   */
  receive(link, raw) {
    // Anything from a connection that was replaced is noise, whatever it says.
    if (link !== this.link || this.stopped) return;
    const message = parseHostMessage(raw);
    if (message === null) return;
    const now = this.clock.now();
    this.lastTrafficAt = now;
    if (message.t === 'pong') return;
    if (message.t === 'bye') {
      this.link = null;
      this.clock.setTimeout(() => link.close(), 0);
      // Replaced by a newer tab of the same person: the room is still theirs, in that tab.
      if (message.reason !== 'replaced') clearLastRoom(this.storage, this.code);
      this.stop(BYE_ERRORS[message.reason]);
      return;
    }
    if (this.connectTimer !== null) this.clock.clearTimeout(this.connectTimer);
    this.connectTimer = null;
    this.retries = 0;
    this.state = message;
    this.receivedAt = now;
    // First state of this connection: remember the room, so a reload comes straight back to it.
    if (this.connection !== 'online') saveLastRoom(this.storage, { code: this.code, role: 'guest', at: now });
    this.connection = 'online';
    this.known = true;
    this.emit(message.events);
  }

  /**
   * Intents are fire-and-forget. One that cannot even be sent is answered with the current snapshot again, so
   * a UI that waits for "the next snapshot" before accepting input is never left waiting.
   * @param {Intent} intent
   */
  send(intent) {
    if (this.link !== null && this.connection === 'online') this.link.send(intent);
    else this.emit([]);
  }

  // ----------------------------------------------------------------------------------------- snapshot

  /**
   * Ends this client for good.
   * @param {RoomError | null} error
   */
  stop(error) {
    this.stopped = true;
    this.abandon();
    if (this.beatTimer !== null) this.clock.clearTimeout(this.beatTimer);
    this.beatTimer = null;
    this.stopWake();
    if (error !== null) clearLastRoom(this.storage, this.code);
    this.error = error;
    this.setConnection('closed');
  }

  /** @param {ConnectionState} connection */
  setConnection(connection) {
    this.connection = connection;
    this.emit([]);
  }

  /**
   * @param {RoomEvent[]} events
   * @returns {RoomSnapshot}
   */
  compose(events) {
    const { state } = this;
    return {
      seq: state === null ? 0 : state.seq,
      room: state === null
        ? { code: this.code, phase: 'lobby', settings: { targetScore: DEFAULT_TARGET }, members: [] }
        : state.room,
      you: state === null ? { id: this.identity.playerId, role: 'spectator', isHost: false } : state.you,
      game: state === null ? null : state.game,
      timer: state === null ? null : state.timer,
      events,
      connection: this.connection,
      error: this.error,
      receivedAt: this.receivedAt,
    };
  }

  /** @param {RoomEvent[]} events */
  emit(events) {
    this.snapshot = this.compose(events);
    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshot);
      } catch (error) {
        console.error('[truco] snapshot listener failed', error);
      }
    }
  }
}
