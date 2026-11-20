// Shared tools for the session tests: a fake clock, a storage that can fail, a seeded generator, and a
// `Table` that wires a HostRoom and GuestClients over a MemoryNetwork while scanning every message that
// travels for leaks (other players' hidden cards, anybody's secret).

import assert from 'node:assert/strict';
import { checkInvariants } from '../../app/js/engine/game.js';
import { GuestClient } from '../../app/js/net/guest-client.js';
import { HostRoom } from '../../app/js/net/host-room.js';
import { MemoryNetwork } from '../../app/js/net/memory-network.js';
import { PROTOCOL_VERSION } from '../../app/js/net/protocol.js';
import { cardsIn, prng } from '../engine/helpers.js';

/** @typedef {import('../../app/js/net/types.js').GameClient} GameClient */
/** @typedef {import('../../app/js/net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../../app/js/net/types.js').RoomEvent} RoomEvent */
/** @typedef {import('../../app/js/net/transport.js').Connection} Connection */
/** @typedef {import('../../app/js/net/identity.js').Identity} Identity */
/** @typedef {import('../../app/js/net/env.js').EnvOptions} EnvOptions */
/** @typedef {import('../../app/js/net/env.js').SessionConfig} SessionConfig */
/** @typedef {import('../../app/js/net/env.js').Random} Random */
/** @typedef {import('../../app/js/net/protocol.js').StateMessage} StateMessage */

/** Timers run in time order (ties in creation order), each at its own instant. */
export class FakeClock {
  constructor(start = 1_800_000_000_000) {
    this.time = start;
    /** @type {{ id: number, at: number, callback: () => void }[]} */
    this.timers = [];
    this.lastId = 0;
    this.now = () => this.time;
    /** @type {(callback: () => void, ms: number) => unknown} */
    this.setTimeout = (callback, ms) => {
      this.lastId += 1;
      this.timers.push({ id: this.lastId, at: this.time + Math.max(0, ms), callback });
      return this.lastId;
    };
    /** @type {(handle: unknown) => void} */
    this.clearTimeout = (handle) => {
      this.timers = this.timers.filter((timer) => timer.id !== handle);
    };
  }

  /**
   * Lets `ms` milliseconds pass, running every timer that comes due on the way (and those they schedule).
   * @param {number} ms
   */
  advance(ms) {
    const end = this.time + ms;
    for (;;) {
      let next = null;
      for (const timer of this.timers) {
        if (timer.at <= end && (next === null || timer.at < next.at || (timer.at === next.at && timer.id < next.id))) next = timer;
      }
      if (next === null) break;
      this.clearTimeout(next.id);
      this.time = Math.max(this.time, next.at);
      next.callback();
    }
    this.time = end;
  }

  /**
   * The device was suspended: time jumps, and every overdue timer fires late, all at the new instant.
   * @param {number} ms
   */
  sleep(ms) {
    this.time += ms;
    this.advance(0);
  }
}

/** The Web Storage subset the app uses, with a switch to make every write fail (quota, private mode). */
export class MemoryStorage {
  constructor() {
    /** @type {Map<string, string>} */
    this.items = new Map();
    this.failWrites = false;
    this.writes = 0;
  }

  /** @param {string} key @returns {string | null} */
  getItem(key) {
    return this.items.get(key) ?? null;
  }

  /** @param {string} key @param {string} value */
  setItem(key, value) {
    if (this.failWrites) throw new Error('QuotaExceededError');
    this.writes += 1;
    this.items.set(key, value);
  }

  /** @param {string} key */
  removeItem(key) {
    this.items.delete(key);
  }
}

/**
 * @param {number} seed
 * @returns {Random}
 */
export function seededRandom(seed) {
  const next = prng(seed);
  return { int: (bound) => Math.floor(next() * bound) };
}

/**
 * @param {string} name
 * @returns {Identity} always the same identity for the same name
 */
export function identityOf(name) {
  const slug = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  return { playerId: `player-${slug}`, secret: `secret-of-${slug}-0123456789`, name };
}

/** A connection opened by hand, to send the host whatever a test wants. */
export class RawGuest {
  /** @param {Connection} connection */
  constructor(connection) {
    this.connection = connection;
    /** @type {any[]} */
    this.received = [];
    this.closed = false;
    connection.onMessage = (message) => this.received.push(message);
    connection.onClose = () => {
      this.closed = true;
    };
  }

  /** @param {unknown} message */
  send(message) {
    this.connection.send(message);
  }

  /** @returns {StateMessage[]} */
  get states() {
    return this.received.filter((message) => message.t === 'state');
  }

  /** @returns {string[]} */
  get byes() {
    return this.received.filter((message) => message.t === 'bye').map((message) => message.reason);
  }
}

export class Table {
  /**
   * A room created by Ana, already open.
   * @param {{ seed?: number, config?: Partial<SessionConfig>, storage?: MemoryStorage | null }} [options]
   */
  constructor(options = {}) {
    this.seed = options.seed ?? 1;
    this.config = options.config ?? {};
    this.clock = new FakeClock();
    this.net = new MemoryNetwork({ clock: this.clock });
    /** @type {MemoryStorage | null} */
    this.hostStorage = options.storage === undefined ? new MemoryStorage() : options.storage;
    this.hostIdentity = identityOf('Ana');
    /** @type {Map<string, Identity>} everybody the test ever created, by player id */
    this.identities = new Map([[this.hostIdentity.playerId, this.hostIdentity]]);
    /** @type {Map<string, GuestClient>} */
    this.guests = new Map();
    /** @type {Map<string, MemoryStorage>} */
    this.storages = new Map();
    /** @type {Map<string, StateMessage[]>} every state message sent to each device label */
    this.statesTo = new Map();
    this.checkedSeq = -1;
    /** @type {unknown} the first thing the message scan found wrong; thrown by the next `settle` */
    this.failure = null;
    this.net.onSend = (sent) => {
      // Messages are sent from inside host tasks, which contain whatever is thrown: keep it for later.
      try {
        this.inspect(sent.to, sent.message);
      } catch (error) {
        this.failure = this.failure ?? error;
      }
    };

    this.room = HostRoom.create({
      transport: this.net.transport(this.hostIdentity.playerId),
      identity: this.hostIdentity,
      env: this.env(this.hostStorage, 0),
    });
    this.settle();
  }

  /**
   * @param {MemoryStorage | null} storage
   * @param {number} salt
   * @returns {EnvOptions}
   */
  env(storage, salt) {
    return {
      clock: this.clock,
      random: seededRandom(this.seed * 1000 + salt),
      storage,
      onWake: () => () => {},
      config: this.config,
    };
  }

  get code() {
    return this.room.code;
  }

  /** @returns {GameClient} */
  get host() {
    return this.room.client;
  }

  /**
   * @param {number} [ms] enough for a few network hops by default
   */
  settle(ms = 20) {
    this.clock.advance(ms);
    if (this.failure !== null) throw this.failure;
  }

  /**
   * A guest joins (or joins again, as a fresh page with the same stored identity).
   * @param {string} name
   * @param {{ identity?: Identity, label?: string, code?: string }} [options]
   * @returns {GuestClient}
   */
  join(name, options = {}) {
    const identity = options.identity ?? identityOf(name);
    this.identities.set(identity.playerId, this.identities.get(identity.playerId) ?? identity);
    const label = options.label ?? identity.playerId;
    const storage = this.storages.get(label) ?? new MemoryStorage();
    this.storages.set(label, storage);
    const guest = new GuestClient({
      transport: this.net.transport(label),
      code: options.code ?? this.code,
      identity,
      env: this.env(storage, this.guests.size + 1),
    });
    this.guests.set(name, guest);
    this.settle();
    return guest;
  }

  /**
   * @param {...string} names
   * @returns {GuestClient[]}
   */
  joinAll(...names) {
    return names.map((name) => this.join(name));
  }

  /**
   * Opens a connection by hand and says hello as `name` (unless told not to).
   * @param {string} name
   * @param {{ hello?: boolean, attempt?: number, secret?: string, label?: string }} [options]
   * @returns {RawGuest}
   */
  raw(name, options = {}) {
    const identity = identityOf(name);
    /** @type {RawGuest | null} */
    let guest = null;
    // With the right secret this device really is that player; with a wrong one it is nobody.
    const label = options.label ?? (options.secret === undefined ? identity.playerId : `impostor-${name}`);
    this.identities.set(identity.playerId, this.identities.get(identity.playerId) ?? identity);
    this.net.transport(label).connect(this.code, {
      onOpen: (connection) => {
        guest = new RawGuest(connection);
      },
      onFail: (reason) => assert.fail(`raw connection failed: ${reason}`),
    });
    this.settle();
    const opened = /** @type {RawGuest | null} */ (guest);
    if (opened === null) assert.fail('raw connection did not open');
    if (options.hello !== false) {
      opened.send({
        t: 'hello',
        v: PROTOCOL_VERSION,
        playerId: identity.playerId,
        secret: options.secret ?? identity.secret,
        name,
        attempt: options.attempt ?? this.clock.now(),
      });
      this.settle();
    }
    return opened;
  }

  /**
   * @param {string} name 'Ana' is the host
   * @returns {GameClient}
   */
  client(name) {
    const client = name === 'Ana' ? this.host : this.guests.get(name);
    if (client === undefined) assert.fail(`nobody called ${name}`);
    return client;
  }

  /**
   * @param {string} name
   * @returns {RoomSnapshot}
   */
  snap(name) {
    const snapshot = this.client(name).getSnapshot();
    if (snapshot === null) assert.fail(`${name} has no snapshot yet`);
    return snapshot;
  }

  /**
   * @param {string} name
   * @returns {NonNullable<NonNullable<RoomSnapshot['game']>['hand']>} the hand as that client sees it
   */
  hand(name) {
    const hand = this.snap(name).game?.hand;
    if (hand === null || hand === undefined) assert.fail(`${name} sees no hand`);
    return hand;
  }

  /** @returns {string[]} names in the room as the host lists them, spectators marked with a star */
  roster() {
    return this.snap('Ana').room.members.map((member) => (member.role === 'player' ? member.name : `*${member.name}`));
  }

  /**
   * @param {string} playerId
   * @returns {string} the name of the client with that id
   */
  nameOf(playerId) {
    const names = ['Ana', ...this.guests.keys()];
    const found = names.find((name) => identityOf(name).playerId === playerId);
    if (found === undefined) assert.fail(`no client for ${playerId}`);
    return found;
  }

  /** @returns {string} the name of whoever has to play a card now */
  turn() {
    const turn = this.hand('Ana').turn;
    if (turn === null) assert.fail('nobody is to play');
    return this.nameOf(turn);
  }

  /**
   * Whoever is to play plays their first card, until it is `name`'s turn.
   * @param {string} name
   */
  untilTurnOf(name) {
    for (let step = 0; step < 300; step += 1) {
      if (this.snap('Ana').game?.phase === 'deal') {
        this.settle(1000);
        continue;
      }
      const current = this.turn();
      if (current === name) return;
      this.client(current).play(this.hand(current).myCards[0]);
      this.settle();
    }
    assert.fail(`it never became the turn of ${name}`);
  }

  /**
   * The lobby with these guests, then the host starts the match.
   * @param {...string} names
   */
  start(...names) {
    this.joinAll(...names);
    this.host.start();
    this.settle();
    assert.equal(this.snap('Ana').room.phase, 'match');
  }

  /**
   * The host page dies without a word (or says goodbye to the network when `silent` is false), and a new
   * page resumes the room from what was in storage.
   * @param {{ silent?: boolean, downMs?: number }} [options]
   * @returns {HostRoom | null}
   */
  reloadHost(options = {}) {
    this.net.killRoom(this.code, { silent: options.silent ?? false });
    const { code } = this;
    this.room.close();
    this.clock.advance(options.downMs ?? 500);
    const resumed = HostRoom.resume({
      transport: this.net.transport(this.hostIdentity.playerId),
      code,
      env: this.env(this.hostStorage, 500),
    });
    if (resumed !== null) this.room = resumed;
    this.settle();
    return resumed;
  }

  /**
   * Every message that leaves for a device goes through here, at the instant it is sent.
   * @param {string} to
   * @param {any} message
   */
  inspect(to, message) {
    if (to === this.hostIdentity.playerId) return;
    const text = JSON.stringify(message);
    for (const identity of this.identities.values()) {
      assert.equal(text.includes(identity.secret), false, `a message to ${to} carries the secret of ${identity.playerId}`);
    }
    if (message.t !== 'state') return;
    const states = this.statesTo.get(to) ?? [];
    states.push(message);
    this.statesTo.set(to, states);

    const state = this.room.matchState;
    if (state === null) {
      assert.equal(message.game, null);
      return;
    }
    if (message.seq !== this.checkedSeq) {
      this.checkedSeq = message.seq;
      assert.deepEqual(checkInvariants(state), []);
    }
    const { hand } = state;
    if (hand === null) return;
    // Face up for everybody: the vira and the cards on the table. Besides those, only the receiver's own hand.
    const table = [...hand.rounds, ...(hand.current === null ? [] : [hand.current])].flatMap((round) => round.plays);
    const seat = state.players.findIndex((player) => player.id === to);
    const allowed = new Set([hand.vira, ...table.map((play) => play.card), ...(seat === -1 ? [] : hand.cards[seat])]);
    const leaked = cardsIn(message).filter((card) => !allowed.has(card));
    assert.deepEqual(leaked, [], `a message to ${to} shows cards it must not`);
    if (hand.raise !== null) assert.equal(text.includes('"accept"'), false, 'a message carries raise answers');
  }

  /**
   * Checks what every guest device received: sequence numbers never go back, and events only ever come in a
   * message that continues the sequence.
   */
  assertSequences() {
    for (const [to, states] of this.statesTo) {
      states.forEach((state, index) => {
        if (index === 0) return;
        const previous = states[index - 1].seq;
        assert.ok(state.seq >= previous, `the sequence went back for ${to}`);
        // A private resync repeats the current number, and never carries events.
        if (state.events.length > 0) assert.ok(state.seq > previous, `events repeated a sequence number for ${to}`);
      });
    }
  }
}

/**
 * What a bot does when it is its turn to do something: answers a raise, or raises / plays a card.
 * @param {GameClient} client
 * @param {Random} random
 * @returns {boolean} whether it did something
 */
export function actAtRandom(client, random) {
  const snapshot = client.getSnapshot();
  const hand = snapshot?.game?.hand;
  if (snapshot === null || snapshot.connection !== 'online' || hand === null || hand === undefined) return false;
  if (snapshot.game?.phase === 'truco' && hand.raise !== null && hand.raise.mustAnswer) {
    client.respond(random.int(100) < 60);
    return true;
  }
  if (snapshot.game?.phase !== 'play' || hand.turn !== snapshot.you.id || snapshot.you.role !== 'player') return false;
  if (hand.canRaise && random.int(100) < 25) client.raise();
  else client.play(hand.myCards[random.int(hand.myCards.length)]);
  return true;
}

/**
 * @param {RoomSnapshot} snapshot
 * @returns {RoomEvent['type'][]}
 */
export function eventTypes(snapshot) {
  return snapshot.events.map((event) => event.type);
}
