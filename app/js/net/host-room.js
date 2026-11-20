// The room, as run by the host's browser: the single source of truth. Guests send intents and get back the
// view they are allowed to see. Everything that can change the room goes through one run-to-completion
// queue (`run`), and every change ends in `commit`: deadline, broadcast, persistence, timer.

import { fullDeck } from '../engine/cards.js';
import {
  DEFAULT_TARGET, MAX_PLAYERS, MIN_PLAYERS, apply, createMatch, defaultAction, pendingPlayers, viewFor,
} from '../engine/game.js';
import { createEnv, shuffled } from './env.js';
import { loadHostSnapshot } from './host-snapshot.js';
import { clearLastRoom, saveLastRoom } from './identity.js';
import {
  FALLBACK_NAME, MAX_SPECTATORS, cleanName, generateCode, isPlayerId, normalizeCode, parseClientMessage, uniqueName,
} from './protocol.js';
import { STORAGE_KEYS } from './storage.js';
import { TAUNT_COOLDOWN_MS } from './taunts.js';

/** @typedef {import('../engine/types.js').MatchState} MatchState */
/** @typedef {import('../engine/types.js').Action} Action */
/** @typedef {import('./types.js').GameClient} GameClient */
/** @typedef {import('./types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('./types.js').RoomInfo} RoomInfo */
/** @typedef {import('./types.js').RoomPhase} RoomPhase */
/** @typedef {import('./types.js').RoomEvent} RoomEvent */
/** @typedef {import('./types.js').RoomError} RoomError */
/** @typedef {import('./types.js').TimerInfo} TimerInfo */
/** @typedef {import('./types.js').TargetScore} TargetScore */
/** @typedef {import('./types.js').ConnectionState} ConnectionState */
/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./transport.js').Connection} Connection */
/** @typedef {import('./transport.js').Listener} Listener */
/** @typedef {import('./transport.js').ListenFailure} ListenFailure */
/** @typedef {import('./protocol.js').Intent} Intent */
/** @typedef {import('./protocol.js').HelloMessage} HelloMessage */
/** @typedef {import('./protocol.js').StateMessage} StateMessage */
/** @typedef {import('./protocol.js').ByeReason} ByeReason */
/** @typedef {import('./host-snapshot.js').HostSnapshot} HostSnapshot */
/** @typedef {import('./host-snapshot.js').MemberRecord} MemberRecord */
/** @typedef {import('./host-snapshot.js').Deadline} Deadline */
/** @typedef {import('./env.js').Env} Env */
/** @typedef {import('./env.js').EnvOptions} EnvOptions */

/**
 * One connection as the host sees it.
 * @typedef {Object} Link
 * @property {Connection} connection
 * @property {string | null} memberId null until a valid hello binds it to a member
 * @property {number} attempt the hello's attempt number: a later hello with a lower one is a stale connection
 * @property {number} lastSeen when the last valid message arrived
 * @property {number} windowStart flood control: start of the current counting window
 * @property {number} windowCount messages seen in the current window
 * @property {boolean} dead replaced, dismissed or lost: whatever still arrives on it is ignored
 */

/** A dismissed connection is closed only after its goodbye had time to travel: `close()` is abrupt. */
const BYE_FLUSH_MS = 400;
/** A player who has been gone for long still "thinks" this long, so the table can follow the cards. */
const AUTO_PLAY_MIN_MS = 1000;
const MAX_PENDING_LINKS = 24;
const RATE_WINDOW_MS = 1000;
const RATE_LIMIT = 30;
const MAX_KICKED = 64;
/** While creating a room: new codes tried on a collision, and failures tolerated before giving up. */
const CODE_ATTEMPTS = 5;
const OPEN_ATTEMPTS = 3;
const RETRY_MIN_MS = 1000;
const RETRY_MAX_MS = 8000;
/** After a tick that had nothing to apply, the room is not looked at again sooner than this. */
const IDLE_RETRY_MS = 250;
/** The stored snapshot is refreshed at least this often, so an idle room does not look abandoned. */
const PERSIST_REFRESH_MS = 5 * 60 * 1000;

/**
 * @param {MatchState} match in phase 'play' or 'truco'
 * @returns {string} names what is being timed: it changes exactly when the clock must restart. Answers to a
 *   raise do not change it (one shared deadline), and neither does somebody else leaving the match.
 */
function turnKey(match) {
  const { hand } = match;
  if (hand === null) return 'none';
  if (hand.raise !== null) return `raise:${hand.number}:${hand.rounds.length}:${hand.raise.caller}:${hand.raise.value}`;
  const played = hand.current === null ? 0 : hand.current.plays.length;
  return `turn:${hand.number}:${hand.rounds.length}:${played}:${hand.turn}:${hand.value}`;
}

export class HostRoom {
  /**
   * Opens a brand new room, with the host seated in the lobby.
   * @param {{ transport: Transport, identity: { playerId: string, name: string }, env?: EnvOptions }} options
   * @returns {HostRoom}
   */
  static create(options) {
    if (!isPlayerId(options.identity.playerId)) throw new TypeError('The host needs a valid player id (see ensureIdentity)');
    return new HostRoom(options.transport, createEnv(options.env), options.identity, null);
  }

  /**
   * Picks up the room this device was hosting, from the snapshot in storage.
   * @param {{ transport: Transport, code: string, identity?: { playerId: string }, env?: EnvOptions }} options
   * @returns {HostRoom | null} null when storage holds no usable snapshot of that room (or it belongs to
   *   another identity): this device is then not its host
   */
  static resume(options) {
    const env = createEnv(options.env);
    const snapshot = loadHostSnapshot(env.storage, env.clock.now());
    if (snapshot === null || snapshot.code !== normalizeCode(options.code)) return null;
    if (options.identity !== undefined && options.identity.playerId !== snapshot.hostId) return null;
    return new HostRoom(options.transport, env, { playerId: snapshot.hostId, name: '' }, snapshot);
  }

  /**
   * @param {EnvOptions} [envOptions]
   * @returns {string | null} the code of the room this device is hosting according to storage
   */
  static storedCode(envOptions) {
    const env = createEnv(envOptions);
    return loadHostSnapshot(env.storage, env.clock.now())?.code ?? null;
  }

  /**
   * Use `HostRoom.create` or `HostRoom.resume`.
   * @param {Transport} transport
   * @param {Env} env
   * @param {{ playerId: string, name: string }} identity
   * @param {HostSnapshot | null} snapshot
   */
  constructor(transport, env, identity, snapshot) {
    this.transport = transport;
    this.clock = env.clock;
    this.random = env.random;
    this.storage = env.storage;
    this.config = env.config;
    const now = this.clock.now();

    // ---- what is persisted
    /** @type {string} */
    this.code = snapshot?.code ?? generateCode(this.random);
    /** @type {RoomPhase} */
    this.phase = snapshot?.phase ?? 'lobby';
    /** @type {TargetScore} */
    this.targetScore = snapshot?.targetScore ?? DEFAULT_TARGET;
    this.hostId = identity.playerId;
    /** @type {MemberRecord[]} players in seat order, then spectators in join order */
    this.members = snapshot?.members.map((member) => ({ ...member }))
      ?? [{ id: identity.playerId, secret: null, name: cleanName(identity.name) ?? FALLBACK_NAME, role: 'player' }];
    /** @type {string[]} */
    this.kicked = snapshot === null ? [] : [...snapshot.kicked];
    /** @type {MatchState | null} */
    this.match = snapshot?.match ?? null;
    this.seq = snapshot?.seq ?? 0;
    /** @type {Deadline | null} */
    this.deadline = snapshot?.deadline ?? null;

    // ---- what lives only while this page does
    this.resumed = snapshot !== null;
    /** @type {Map<string, Link>} the current connection of each connected guest */
    this.links = new Map();
    /** @type {Set<Link>} connections that have not said a valid hello yet */
    this.strangers = new Set();
    /** @type {Map<string, number>} since when each guest without a connection has been gone */
    this.goneSince = new Map();
    /** @type {Map<string, number>} */
    this.lastTauntAt = new Map();
    /** @type {RoomEvent[]} public events waiting for the next broadcast */
    this.events = [];
    /** @type {Listener | null} */
    this.listener = null;
    this.everOpen = false;
    this.openFailures = 0;
    this.codeChanges = 0;
    this.retries = 0;
    /** @type {ConnectionState} */
    this.connection = 'connecting';
    /** @type {RoomError | null} */
    this.error = null;
    this.closed = false;
    /** @type {unknown} */
    this.deadlineTimer = null;
    /** @type {unknown} */
    this.sweepTimer = null;
    /** @type {unknown} */
    this.listenTimer = null;
    this.lastSweepAt = now;
    this.savedAt = now;
    /** @type {(() => void)[]} */
    this.queue = [];
    this.draining = false;
    /** @type {Set<(snapshot: RoomSnapshot) => void>} */
    this.listeners = new Set();
    /** @type {RoomSnapshot | null} */
    this.snapshot = null;
    /** @type {GameClient} the host's own seat, same interface as a guest's client */
    this.client = this.createClient();

    if (snapshot !== null) {
      // Nobody is connected yet. Guests need up to a heartbeat timeout to notice that the host went away and
      // come back, so that much is added: their disconnect grace starts counting only then, and whoever was
      // on the clock gets a full turn after it.
      const noticeAt = now + this.config.heartbeatTimeoutMs;
      for (const member of this.members) {
        if (member.id !== this.hostId) this.goneSince.set(member.id, noticeAt);
      }
      const { match } = this;
      if (this.phase === 'match' && match !== null && (match.phase === 'play' || match.phase === 'truco')) {
        this.deadline = { key: turnKey(match), at: noticeAt + this.config.turnMs, total: this.config.turnMs };
      }
    }

    this.stopWake = env.onWake(() => this.run(() => this.tick()));
    this.run(() => this.commit());
    this.openListener();
    this.scheduleSweep();
  }

  /** @returns {MatchState | null} the engine state, hidden cards included: for tests and diagnostics only */
  get matchState() {
    return this.match;
  }

  /**
   * Page teardown: releases timers and connections. The room stays in storage and can be resumed.
   */
  close() {
    if (this.closed) return;
    for (const link of [...this.links.values(), ...this.strangers]) {
      this.detach(link);
      link.connection.close();
    }
    this.finish(null);
  }

  // ------------------------------------------------------------------------------------------ plumbing

  /**
   * Runs a task now, or right after the one in progress: nothing ever re-enters the room half-way through a
   * change. A task that throws is contained, so no input can take the host down.
   * @param {() => void} task
   */
  run(task) {
    this.queue.push(task);
    if (this.draining) return;
    this.draining = true;
    try {
      for (let next = this.queue.shift(); next !== undefined; next = this.queue.shift()) {
        try {
          next();
        } catch (error) {
          console.error('[truco] host task failed', error);
        }
      }
    } finally {
      this.draining = false;
    }
  }

  /** @returns {GameClient} */
  createClient() {
    /** @param {unknown} intent */
    const send = (intent) => this.run(() => this.local(intent));
    return {
      getSnapshot: () => this.snapshot,
      subscribe: (listener) => {
        this.listeners.add(listener);
        return () => {
          this.listeners.delete(listener);
        };
      },
      play: (card) => send({ t: 'play', card }),
      raise: () => send({ t: 'truco' }),
      respond: (accept) => send({ t: 'respond', accept }),
      taunt: (tauntId) => send({ t: 'taunt', id: tauntId }),
      leave: () => send({ t: 'leave' }),
      start: () => send({ t: 'start' }),
      kick: (playerId) => send({ t: 'kick', playerId }),
      newMatch: () => send({ t: 'newMatch' }),
      setTargetScore: (target) => send({ t: 'setTarget', target }),
      close: () => this.run(() => this.close()),
    };
  }

  /**
   * An intent from the host's own seat: parsed and authorised exactly like one that came over the network.
   * @param {unknown} raw
   */
  local(raw) {
    const host = this.member(this.hostId);
    if (this.closed || host === undefined) return;
    const intent = parseClientMessage(raw);
    const done = intent !== null && intent.t !== 'hello' && intent.t !== 'bad-version' && intent.t !== 'ping'
      && this.handleIntent(host, intent);
    if (!done) this.resync(host);
  }

  /**
   * @param {string} id
   * @returns {MemberRecord | undefined}
   */
  member(id) {
    return this.members.find((member) => member.id === id);
  }

  /**
   * @param {string} id
   * @returns {boolean}
   */
  isConnected(id) {
    return id === this.hostId || this.links.has(id);
  }

  // --------------------------------------------------------------------------------------- connections

  openListener() {
    this.listenTimer = null;
    if (this.closed) return;
    try {
      this.listener = this.transport.listen(this.code, {
        onOpen: () => this.run(() => {
          if (this.closed) return;
          this.everOpen = true;
          this.retries = 0;
          this.connection = 'online';
          saveLastRoom(this.storage, { code: this.code, role: 'host', at: this.clock.now() });
          this.emitLocal([]);
        }),
        onConnection: (connection) => this.run(() => this.accept(connection)),
        onClose: (reason) => this.run(() => this.listenerLost(reason)),
      }, { resume: this.resumed || this.everOpen });
    } catch (error) {
      console.error('[truco] could not open the room', error);
      this.run(() => this.listenerLost('unreachable'));
    }
  }

  /** @param {ListenFailure} reason */
  listenerLost(reason) {
    if (this.closed) return;
    this.listener = null;
    if (!this.resumed && !this.everOpen) {
      // Still creating the room: a taken code is a collision (pick another), anything else is the network.
      if (reason === 'code-taken' && this.codeChanges < CODE_ATTEMPTS) {
        this.codeChanges += 1;
        this.code = generateCode(this.random);
        this.commit();
        this.openListener();
        return;
      }
      this.openFailures += 1;
      if (reason === 'code-taken' || this.openFailures >= OPEN_ATTEMPTS) {
        this.storage.remove(STORAGE_KEYS.hostRoom);
        this.finish('broker-unreachable');
        return;
      }
    } else {
      // A room with people in it is never given up: connections already open keep working meanwhile.
      this.connection = 'reconnecting';
      this.emitLocal([]);
    }
    const delay = Math.min(RETRY_MAX_MS, RETRY_MIN_MS * 2 ** this.retries);
    this.retries += 1;
    this.listenTimer = this.clock.setTimeout(() => this.run(() => this.openListener()), delay);
  }

  /** @param {Connection} connection */
  accept(connection) {
    if (this.closed || this.strangers.size >= MAX_PENDING_LINKS) {
      connection.close();
      return;
    }
    const now = this.clock.now();
    /** @type {Link} */
    const link = { connection, memberId: null, attempt: 0, lastSeen: now, windowStart: now, windowCount: 0, dead: false };
    this.strangers.add(link);
    connection.onMessage = (raw) => this.run(() => this.receive(link, raw));
    connection.onClose = () => this.run(() => this.lost(link));
  }

  /**
   * @param {Link} link
   * @param {unknown} raw
   */
  receive(link, raw) {
    if (link.dead || this.closed) return;
    const now = this.clock.now();
    if (now - link.windowStart >= RATE_WINDOW_MS) {
      link.windowStart = now;
      link.windowCount = 0;
    }
    link.windowCount += 1;
    if (link.windowCount > RATE_LIMIT) return;

    const message = parseClientMessage(raw);
    if (message === null) return;
    if (link.memberId === null) {
      if (message.t === 'hello') this.hello(link, message);
      else if (message.t === 'bad-version') this.dismiss(link, 'bad-version');
      return;
    }
    const member = this.member(link.memberId);
    if (member === undefined || message.t === 'hello' || message.t === 'bad-version') return;
    link.lastSeen = now;
    if (message.t === 'ping') this.post(link, { t: 'pong' });
    else if (!this.handleIntent(member, message)) this.resync(member);
  }

  /**
   * @param {Link} link a connection that is not bound to a member yet
   * @param {HelloMessage} hello
   */
  hello(link, hello) {
    if (this.kicked.includes(hello.playerId)) {
      this.dismiss(link, 'kicked');
      return;
    }
    let member = this.member(hello.playerId);
    if (member !== undefined) {
      // A seat belongs to whoever knows its secret. The host's own seat has none and cannot be joined.
      if (member.secret === null || member.secret !== hello.secret) {
        this.dismiss(link, 'refused');
        return;
      }
      const current = this.links.get(member.id);
      if (current !== undefined && hello.attempt < current.attempt) {
        // The hello of an older connection, arriving late: the newer connection stays.
        this.dismiss(link, 'replaced');
        return;
      }
      if (current !== undefined) this.dismiss(current, 'replaced');
    } else {
      const seated = this.members.filter((other) => other.role === 'player').length;
      const watching = this.members.length - seated;
      const seatFree = this.phase === 'lobby' && seated < MAX_PLAYERS;
      if (!seatFree && watching >= MAX_SPECTATORS) {
        this.dismiss(link, 'full');
        return;
      }
      const name = uniqueName(cleanName(hello.name) ?? FALLBACK_NAME, this.members.map((other) => other.name));
      member = { id: hello.playerId, secret: hello.secret, name, role: seatFree ? 'player' : 'spectator' };
      // Players come first, in join order; a new player goes right after the last one.
      this.members.splice(seatFree ? seated : this.members.length, 0, member);
    }
    this.strangers.delete(link);
    link.memberId = member.id;
    link.attempt = hello.attempt;
    link.lastSeen = this.clock.now();
    this.links.set(member.id, link);
    this.goneSince.delete(member.id);
    this.commit();
  }

  /**
   * The connection closed or went silent. The member keeps the seat and may come back.
   * @param {Link} link
   */
  lost(link) {
    if (link.dead) return;
    const memberId = this.links.get(link.memberId ?? '') === link ? link.memberId : null;
    this.detach(link);
    link.connection.close();
    if (memberId === null) return;
    this.goneSince.set(memberId, this.clock.now());
    this.commit();
  }

  /**
   * Sends on a connection. A transport that throws must not interrupt a broadcast half-way: the connection
   * is then simply left for the heartbeat to drop.
   * @param {Link} link
   * @param {import('./protocol.js').HostMessage} message
   */
  post(link, message) {
    try {
      link.connection.send(message);
    } catch (error) {
      console.error('[truco] could not send to a guest', error);
    }
  }

  /**
   * Stops listening to a connection for good, without closing it.
   * @param {Link} link
   */
  detach(link) {
    link.dead = true;
    link.connection.onMessage = null;
    link.connection.onClose = null;
    this.strangers.delete(link);
    if (link.memberId !== null && this.links.get(link.memberId) === link) this.links.delete(link.memberId);
  }

  /**
   * Tells the other side why, then drops the connection.
   * @param {Link} link
   * @param {ByeReason} reason
   */
  dismiss(link, reason) {
    this.post(link, { t: 'bye', reason });
    this.detach(link);
    this.clock.setTimeout(() => link.connection.close(), BYE_FLUSH_MS);
  }

  scheduleSweep() {
    this.sweepTimer = this.clock.setTimeout(() => this.run(() => this.sweep()), this.config.heartbeatMs);
  }

  /** Heartbeat: drops connections that went silent and re-checks the deadline. */
  sweep() {
    if (this.closed) return;
    const now = this.clock.now();
    // If this page itself was asleep (locked phone, background tab), the silence proves nothing about the
    // guests: everybody gets a fresh window instead of being dropped at once.
    const slept = now - this.lastSweepAt > this.config.heartbeatMs * 2.5;
    this.lastSweepAt = now;
    let changed = false;
    for (const link of [...this.links.values(), ...this.strangers]) {
      if (slept) link.lastSeen = now;
      if (now - link.lastSeen <= this.config.heartbeatTimeoutMs) continue;
      const { memberId } = link;
      this.detach(link);
      link.connection.close();
      if (memberId !== null) {
        this.goneSince.set(memberId, now);
        changed = true;
      }
    }
    if (changed) this.commit();
    else if (now - this.savedAt > PERSIST_REFRESH_MS) this.persist();
    this.tick();
    this.scheduleSweep();
  }

  // ------------------------------------------------------------------------------------------- intents

  /**
   * @param {MemberRecord} member who asks (already authenticated)
   * @param {Intent} intent already validated in shape
   * @returns {boolean} whether it was carried out; false leaves the room untouched
   */
  handleIntent(member, intent) {
    const isHost = member.id === this.hostId;
    switch (intent.t) {
      case 'play':
        return this.play(member, { type: 'play', playerId: member.id, card: intent.card });
      case 'truco':
        return this.play(member, { type: 'truco', playerId: member.id });
      case 'respond':
        return this.play(member, { type: 'respond', playerId: member.id, accept: intent.accept });
      case 'taunt':
        return this.taunt(member, intent.id);
      case 'leave':
        return this.leave(member);
      case 'start':
        return isHost && this.start();
      case 'kick':
        return isHost && this.kick(intent.playerId);
      case 'newMatch':
        return isHost && this.newMatch();
      case 'setTarget':
        return isHost && this.setTarget(intent.target);
    }
  }

  /**
   * @param {MemberRecord} member
   * @param {Action} action an action of that member; the engine decides whether it is valid right now
   * @returns {boolean}
   */
  play(member, action) {
    if (this.phase !== 'match' || member.role !== 'player' || !this.applyEngine(action)) return false;
    this.commit();
    return true;
  }

  /**
   * @param {MemberRecord} member
   * @param {string} tauntId a known taunt id
   * @returns {boolean}
   */
  taunt(member, tauntId) {
    if (member.role !== 'player' || this.phase === 'lobby') return false;
    const now = this.clock.now();
    const last = this.lastTauntAt.get(member.id);
    // Too soon after the previous one: dropped without a word.
    if (last !== undefined && now - last < TAUNT_COOLDOWN_MS) return true;
    this.lastTauntAt.set(member.id, now);
    this.events.push({ type: 'taunt', playerId: member.id, tauntId });
    this.commit();
    return true;
  }

  /**
   * @param {MemberRecord} member
   * @returns {boolean}
   */
  leave(member) {
    if (member.id === this.hostId) {
      this.shutDown();
      return true;
    }
    this.removeMember(member, 'left');
    this.commit();
    return true;
  }

  /** @returns {boolean} */
  start() {
    const players = this.members.filter((member) => member.role === 'player');
    if (this.phase !== 'lobby' || players.length < MIN_PLAYERS) return false;
    this.match = createMatch(players.map(({ id, name }) => ({ id, name })), {
      dealerIndex: this.random.int(players.length),
      targetScore: this.targetScore,
    });
    this.phase = 'match';
    this.deal();
    this.commit();
    return true;
  }

  /**
   * @param {string} playerId
   * @returns {boolean}
   */
  kick(playerId) {
    const member = this.member(playerId);
    if (member === undefined || member.id === this.hostId) return false;
    this.removeMember(member, 'kicked');
    this.kicked = [...this.kicked, playerId].slice(-MAX_KICKED);
    this.commit();
    return true;
  }

  /** @returns {boolean} */
  newMatch() {
    if (this.phase !== 'ended') return false;
    this.match = null;
    this.phase = 'lobby';
    this.fillSeats();
    this.commit();
    return true;
  }

  /**
   * @param {TargetScore} target
   * @returns {boolean}
   */
  setTarget(target) {
    if (this.phase !== 'lobby') return false;
    this.targetScore = target;
    this.commit();
    return true;
  }

  /**
   * Takes a member out of the room (and out of the match being played), and says goodbye to its connection.
   * @param {MemberRecord} member
   * @param {ByeReason} reason
   */
  removeMember(member, reason) {
    if (this.phase === 'match' && member.role === 'player') this.applyEngine({ type: 'remove', playerId: member.id });
    this.members = this.members.filter((other) => other !== member);
    const link = this.links.get(member.id);
    if (link !== undefined) this.dismiss(link, reason);
    this.goneSince.delete(member.id);
    this.lastTauntAt.delete(member.id);
    if (this.phase === 'lobby') this.fillSeats();
  }

  /** In the lobby, spectators take the free seats in join order. */
  fillSeats() {
    let seated = this.members.filter((member) => member.role === 'player').length;
    for (const member of this.members) {
      if (member.role === 'spectator' && seated < MAX_PLAYERS) {
        member.role = 'player';
        seated += 1;
      }
    }
  }

  /** The host leaves: the room is over for everybody. */
  shutDown() {
    for (const link of [...this.links.values(), ...this.strangers]) this.dismiss(link, 'host-closed');
    this.storage.remove(STORAGE_KEYS.hostRoom);
    clearLastRoom(this.storage, this.code);
    this.finish(null);
  }

  /** @param {RoomError | null} error */
  finish(error) {
    this.closed = true;
    for (const timer of [this.deadlineTimer, this.sweepTimer, this.listenTimer]) {
      if (timer !== null) this.clock.clearTimeout(timer);
    }
    if (this.listener !== null) this.listener.close();
    this.listener = null;
    this.stopWake();
    this.connection = 'closed';
    this.error = error;
    this.emitLocal([]);
  }

  // -------------------------------------------------------------------------------------------- engine

  /**
   * @param {Action} action
   * @returns {boolean} whether the engine accepted it
   */
  applyEngine(action) {
    if (this.match === null) return false;
    const result = apply(this.match, action);
    if (!result.ok) return false;
    this.match = result.state;
    this.events.push(...result.events);
    if (result.state.phase === 'over') this.phase = 'ended';
    return true;
  }

  /** @returns {boolean} */
  deal() {
    return this.applyEngine({ type: 'deal', deck: shuffled(fullDeck(), this.random) });
  }

  // -------------------------------------------------------------------------------------------- timers

  /** Makes the deadline match what is being waited for right now, starting a new one when that changed. */
  syncDeadline() {
    const { match } = this;
    if (this.phase !== 'match' || match === null || match.phase === 'over') {
      this.deadline = null;
      return;
    }
    const dealing = match.phase === 'deal';
    const key = dealing ? `deal:${match.handNumber}` : turnKey(match);
    const total = dealing ? this.config.handPauseMs : this.config.turnMs;
    if (this.deadline === null || this.deadline.key !== key) this.deadline = { key, at: this.clock.now() + total, total };
  }

  /**
   * @param {string} playerId a pending player
   * @param {Deadline} deadline
   * @returns {number} when that player's time is up: the shared deadline, or sooner for somebody disconnected
   */
  timeUpAt(playerId, deadline) {
    if (this.isConnected(playerId)) return deadline.at;
    const gone = this.goneSince.get(playerId) ?? this.clock.now();
    const started = deadline.at - deadline.total;
    return Math.min(deadline.at, Math.max(gone + this.config.disconnectGraceMs, started + AUTO_PLAY_MIN_MS));
  }

  /**
   * Applies whatever is due by the wall clock: the next deal, or the default action of everybody whose time
   * is up. Safe to call at any moment and any number of times: it looks at the state as it is now, so a late
   * or duplicated timer does nothing wrong, and a deadline missed while the page slept is applied once.
   */
  tick() {
    if (this.closed) return;
    let changed = false;
    // Each pass needs somebody whose time is up, and acting gives the next player a fresh deadline.
    for (let pass = 0; pass < 64 && this.applyDue(); pass += 1) {
      changed = true;
      this.syncDeadline();
    }
    if (changed) this.commit();
    else this.arm(IDLE_RETRY_MS);
  }

  /** @returns {boolean} whether something was due and done */
  applyDue() {
    const { match, deadline } = this;
    if (this.phase !== 'match' || match === null || deadline === null) return false;
    const now = this.clock.now();
    if (match.phase === 'deal') return now >= deadline.at && this.deal();
    const due = pendingPlayers(match).filter((playerId) => this.timeUpAt(playerId, deadline) <= now);
    let acted = false;
    for (const playerId of due) {
      const action = this.match === null ? null : defaultAction(this.match, playerId);
      if (action !== null && this.applyEngine(action)) acted = true;
    }
    return acted;
  }

  /**
   * (Re)arms the one timer that wakes the room up for the next deadline.
   * @param {number} [overdueMs] how long to wait when the deadline has already passed: 0 after a change (the
   *   next thing is due right now), a short pause after a tick that found nothing to do, so the room can
   *   never spin on a deadline it is unable to apply
   */
  arm(overdueMs = 0) {
    if (this.deadlineTimer !== null) this.clock.clearTimeout(this.deadlineTimer);
    this.deadlineTimer = null;
    const { match, deadline } = this;
    if (this.closed || this.phase !== 'match' || match === null || deadline === null) return;
    const pending = match.phase === 'deal' ? [] : pendingPlayers(match);
    const wakeAt = pending.length === 0
      ? deadline.at
      : Math.min(...pending.map((playerId) => this.timeUpAt(playerId, deadline)));
    const wait = wakeAt - this.clock.now();
    this.deadlineTimer = this.clock.setTimeout(() => {
      this.deadlineTimer = null;
      this.run(() => this.tick());
    }, wait > 0 ? wait : overdueMs);
  }

  // ----------------------------------------------------------------------------------------- broadcast

  /** Ends every change: deadline, one broadcast to everybody, storage, timer. */
  commit() {
    this.syncDeadline();
    this.seq += 1;
    const events = this.events;
    this.events = [];
    const room = this.roomInfo();
    const timer = this.timerInfo();
    for (const [memberId, link] of this.links) {
      const member = this.member(memberId);
      if (member !== undefined) this.post(link, this.stateFor(member, events, room, timer));
    }
    this.emitLocal(events, room, timer);
    this.persist();
    this.arm();
  }

  /**
   * Sends one member the current picture again, outside the broadcast sequence: the answer to an intent that
   * was refused, so that a client waiting for "the next snapshot" is never left waiting.
   * @param {MemberRecord} member
   */
  resync(member) {
    const link = this.links.get(member.id);
    if (member.id === this.hostId) this.emitLocal([]);
    else if (link !== undefined) this.post(link, this.stateFor(member, [], this.roomInfo(), this.timerInfo()));
  }

  /** @returns {RoomInfo} */
  roomInfo() {
    return {
      code: this.code,
      phase: this.phase,
      settings: { targetScore: this.targetScore },
      members: this.members.map(({ id, name, role }) => ({
        id, name, role, connected: this.isConnected(id), isHost: id === this.hostId,
      })),
    };
  }

  /** @returns {TimerInfo | null} */
  timerInfo() {
    const { match, deadline } = this;
    if (this.phase !== 'match' || match === null || deadline === null) return null;
    const players = pendingPlayers(match);
    if (players.length === 0) return null;
    const end = Math.max(...players.map((playerId) => this.timeUpAt(playerId, deadline)));
    // Never more than the total: a deadline extended on resume shows as a full clock until it really runs.
    const remainingMs = Math.min(deadline.total, Math.max(0, Math.round(end - this.clock.now())));
    return { remainingMs, totalMs: deadline.total, players };
  }

  /**
   * The only place where game data is prepared to leave the host: always a view, never the state.
   * @param {MemberRecord} member
   * @param {RoomEvent[]} events
   * @param {RoomInfo} room
   * @param {TimerInfo | null} timer
   * @returns {StateMessage}
   */
  stateFor(member, events, room, timer) {
    return {
      t: 'state',
      seq: this.seq,
      room,
      you: { id: member.id, role: member.role, isHost: member.id === this.hostId },
      game: this.match === null ? null : viewFor(this.match, member.role === 'player' ? member.id : null),
      timer,
      events,
    };
  }

  /**
   * @param {RoomEvent[]} events
   * @param {RoomInfo} [room]
   * @param {TimerInfo | null} [timer]
   */
  emitLocal(events, room = this.roomInfo(), timer = this.timerInfo()) {
    const host = this.member(this.hostId);
    if (host === undefined) return;
    const { seq, you, game } = this.stateFor(host, events, room, timer);
    /** @type {RoomSnapshot} */
    const snapshot = {
      seq, room, you, game, timer, events, connection: this.connection, error: this.error, receivedAt: this.clock.now(),
    };
    this.snapshot = snapshot;
    for (const listener of [...this.listeners]) {
      try {
        listener(snapshot);
      } catch (error) {
        console.error('[truco] snapshot listener failed', error);
      }
    }
  }

  /** Writes the whole room to storage. A failed write only means there is nothing newer to resume from. */
  persist() {
    this.savedAt = this.clock.now();
    /** @type {HostSnapshot} */
    const snapshot = {
      v: 1,
      savedAt: this.savedAt,
      code: this.code,
      phase: this.phase,
      targetScore: this.targetScore,
      hostId: this.hostId,
      members: this.members,
      kicked: this.kicked,
      match: this.match,
      seq: this.seq,
      deadline: this.deadline,
    };
    this.storage.write(STORAGE_KEYS.hostRoom, snapshot);
  }
}
