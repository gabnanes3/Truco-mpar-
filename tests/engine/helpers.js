// Shared tools for the engine tests: a seeded PRNG, deck builders and a small table driver that checks the
// engine's promises (invariants, immutability, JSON safety, no leaks) after every single action.

import assert from 'node:assert/strict';
import { fullDeck, isCard } from '../../app/js/engine/cards.js';
import { apply, checkInvariants, createMatch, viewFor } from '../../app/js/engine/game.js';

/** @typedef {import('../../app/js/engine/types.js').MatchState} MatchState */
/** @typedef {import('../../app/js/engine/types.js').HandState} HandState */
/** @typedef {import('../../app/js/engine/types.js').Action} Action */
/** @typedef {import('../../app/js/engine/types.js').ErrorCode} ErrorCode */
/** @typedef {import('../../app/js/engine/types.js').EngineEvent} EngineEvent */
/** @typedef {import('../../app/js/engine/types.js').View} View */
/** @typedef {import('../../app/js/engine/types.js').ViewHand} ViewHand */

/**
 * Freezes plain data all the way down, so any attempt to mutate it throws (modules run in strict mode).
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function deepFreeze(value) {
  if (typeof value === 'object' && value !== null) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/**
 * @template T
 * @param {T} value
 * @returns {T} a deep, unfrozen copy made the way the host persists a state
 */
export function jsonCopy(value) {
  return JSON.parse(JSON.stringify(value));
}

/**
 * mulberry32: small, fast and good enough to drive tests reproducibly.
 * @param {number} seed
 * @returns {() => number} uniform numbers in [0, 1)
 */
export function prng(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {() => number} random
 * @returns {string[]} the 40 cards in a random order (Fisher–Yates)
 */
export function shuffledDeck(random) {
  const deck = fullDeck();
  for (let last = deck.length - 1; last > 0; last -= 1) {
    const pick = Math.floor(random() * (last + 1));
    [deck[last], deck[pick]] = [deck[pick], deck[last]];
  }
  return deck;
}

/**
 * The ids of the players the next deal reaches, in deal order. Written independently of the engine: seats
 * in increasing order from the one after the dealer, skipping removed players.
 * @param {MatchState} state
 * @returns {string[]}
 */
export function dealOrder(state) {
  const count = state.players.length;
  const order = [];
  for (let step = 1; step <= count; step += 1) {
    const player = state.players[(state.dealer + step) % count];
    if (!player.removed) order.push(player.id);
  }
  return order;
}

/**
 * A deck that deals exactly the given cards. Deal mapping: the k-th player in deal order gets cards 3k,
 * 3k+1 and 3k+2, and the vira is the card right after the last player's.
 * @param {MatchState} state
 * @param {Record<string, string>} hands three cards per dealt-in player id, e.g. `{ a: '3o 4e 4c' }`
 * @param {string} vira
 * @returns {string[]}
 */
export function stackedDeck(state, hands, vira) {
  const order = dealOrder(state);
  assert.deepEqual(Object.keys(hands).sort(), [...order].sort(), 'hands must list exactly the players dealt in');
  const top = [...order.flatMap((id) => hands[id].split(' ')), vira];
  assert.equal(top.length, order.length * 3 + 1, 'three cards per player');
  assert.ok(top.every(isCard), 'every stacked card must be a card id');
  assert.equal(new Set(top).size, top.length, 'stacked cards must be distinct');
  return [...top, ...fullDeck().filter((card) => !top.includes(card))];
}

/**
 * @param {unknown} value
 * @returns {string[]} every card id found anywhere inside `value`
 */
export function cardsIn(value) {
  if (isCard(value)) return [value];
  if (typeof value !== 'object' || value === null) return [];
  return Object.values(value).flatMap(cardsIn);
}

/**
 * Asserts that no view shows a card its viewer must not see: only the vira, cards on the table (voided or
 * not) and the viewer's own hand may appear.
 * @param {MatchState} state
 */
export function assertNoHiddenCards(state) {
  const { hand } = state;
  if (hand === null) return;
  const table = [...hand.rounds, ...(hand.current === null ? [] : [hand.current])].flatMap((round) => round.plays);
  const open = new Set([hand.vira, ...table.map((play) => play.card)]);
  state.players.forEach((player, seat) => {
    const allowed = new Set([...open, ...hand.cards[seat]]);
    const leaked = cardsIn(viewFor(state, player.id)).filter((card) => !allowed.has(card));
    assert.deepEqual(leaked, [], `the view of ${player.id} shows cards it must not`);
  });
  const leaked = cardsIn(viewFor(state, null)).filter((card) => !open.has(card));
  assert.deepEqual(leaked, [], 'the spectator view shows hidden cards');
}

/**
 * Asserts that no object or array is referenced twice inside `value`. A state must be a plain tree, or it
 * would behave differently after being saved and restored.
 * @param {unknown} value
 * @param {Set<object>} [seen]
 */
export function assertNoSharedParts(value, seen = new Set()) {
  if (typeof value !== 'object' || value === null) return;
  assert.equal(seen.has(value), false, 'the same object or array appears twice inside the state');
  seen.add(value);
  for (const item of Object.values(value)) assertNoSharedParts(item, seen);
}

/**
 * Asserts everything the engine promises about any state it returns.
 * @param {MatchState} state
 */
export function assertHealthy(state) {
  assert.deepEqual(checkInvariants(state), []);
  assert.deepEqual(jsonCopy(state), state, 'the state must survive a JSON round trip');
  assertNoSharedParts(state);
  assertNoHiddenCards(state);
}

/**
 * Drives one match. Every state is deep-frozen before the next action is applied to it, so a test using
 * this driver also proves that `apply` never mutates its input.
 */
export class Table {
  /**
   * @param {string[]} ids player ids in seat order; names are the ids in upper case
   * @param {{ dealer?: string }} [opts] first dealer; by default the last seat, so the first seat leads
   */
  constructor(ids, opts = {}) {
    const dealerIndex = opts.dealer === undefined ? ids.length - 1 : ids.indexOf(opts.dealer);
    /** @type {MatchState} */
    this.state = deepFreeze(createMatch(ids.map((id) => ({ id, name: id.toUpperCase() })), { dealerIndex }));
    /** @type {EngineEvent[]} events produced by the last successful action */
    this.events = [];
    assertHealthy(this.state);
  }

  /**
   * Applies an action that must be valid.
   * @param {Action} action
   * @returns {EngineEvent[]}
   */
  do(action) {
    const result = apply(this.state, deepFreeze(action));
    if (!result.ok) assert.fail(`${JSON.stringify(action)} was rejected with ${result.error}`);
    assert.notEqual(result.state, this.state, 'a valid action returns a new state object');
    assertHealthy(result.state);
    assert.deepEqual(jsonCopy(result.events), result.events, 'events must be plain JSON');
    this.state = deepFreeze(result.state);
    this.events = result.events;
    return result.events;
  }

  /**
   * Applies an action that must be rejected, leaving the state untouched.
   * @param {unknown} action
   * @param {ErrorCode} error
   */
  fail(action, error) {
    const before = jsonCopy(this.state);
    const result = apply(this.state, /** @type {Action} */ (action));
    assert.equal(result.ok, false, `${JSON.stringify(action)} should have been rejected`);
    assert.equal(!result.ok && result.error, error);
    assert.equal(result.state, this.state, 'a rejected action returns the same state object');
    assert.deepEqual(this.state, before, 'a rejected action must not change the state');
    assert.equal('events' in result, false);
  }

  /**
   * Deals a hand with chosen cards.
   * @param {Record<string, string>} hands three cards per dealt-in player, e.g. `{ a: '3o 4e 4c' }`
   * @param {string} [vira] defaults to 7o, which makes Q the manilha
   */
  deal(hands, vira = '7o') {
    return this.do({ type: 'deal', deck: stackedDeck(this.state, hands, vira) });
  }

  /**
   * @param {string} playerId
   * @param {string} card
   */
  play(playerId, card) {
    return this.do({ type: 'play', playerId, card });
  }

  /**
   * Plays cards in the given order, e.g. `plays('a 3o', 'b 4o')`.
   * @param {...string} moves
   */
  plays(...moves) {
    for (const move of moves) {
      const [playerId, card] = move.split(' ');
      this.play(playerId, card);
    }
  }

  /** @param {string} playerId */
  truco(playerId) {
    return this.do({ type: 'truco', playerId });
  }

  /** @param {...string} playerIds */
  accept(...playerIds) {
    for (const playerId of playerIds) this.do({ type: 'respond', playerId, accept: true });
  }

  /** @param {...string} playerIds */
  run(...playerIds) {
    for (const playerId of playerIds) this.do({ type: 'respond', playerId, accept: false });
  }

  /** @param {string} playerId */
  remove(playerId) {
    return this.do({ type: 'remove', playerId });
  }

  /**
   * The fastest complete hand: deals, then the first player raises and everybody else runs.
   * @returns {string} the id of the player who took the hand (1 point)
   */
  quickHand() {
    this.do({ type: 'deal', deck: fullDeck() });
    const caller = this.hand().turn;
    if (caller === null) assert.fail('nobody to play after the deal');
    this.truco(caller);
    this.run(...this.hand().alive.filter((playerId) => playerId !== caller));
    return caller;
  }

  /**
   * @param {string | null} viewerId
   * @returns {View}
   */
  view(viewerId) {
    return viewFor(this.state, viewerId);
  }

  /**
   * @param {string | null} [viewerId] spectator by default
   * @returns {ViewHand} the hand as seen by the viewer; fails when no hand was dealt yet
   */
  hand(viewerId = null) {
    const { hand } = this.view(viewerId);
    if (hand === null) assert.fail('no hand was dealt yet');
    return hand;
  }

  /**
   * @returns {HandState} the raw hand, hidden cards included; fails when no hand was dealt yet
   */
  get rawHand() {
    const { hand } = this.state;
    if (hand === null) assert.fail('no hand was dealt yet');
    return hand;
  }

  /**
   * @param {string} playerId
   * @returns {number}
   */
  score(playerId) {
    const player = this.state.players.find((candidate) => candidate.id === playerId);
    if (player === undefined) assert.fail(`no player ${playerId}`);
    return player.score;
  }

  /**
   * Replaces the scores, to set a scene without playing dozens of hands.
   * @param {Record<string, number>} scores
   */
  setScores(scores) {
    const copy = jsonCopy(this.state);
    for (const player of copy.players) {
      if (player.id in scores) player.score = scores[player.id];
    }
    assertHealthy(copy);
    this.state = deepFreeze(copy);
  }

  /**
   * @returns {string[]} the types of the events produced by the last action, in order
   */
  get eventTypes() {
    return this.events.map((event) => event.type);
  }

  /**
   * @template {EngineEvent['type']} T
   * @param {T} type
   * @returns {Extract<EngineEvent, { type: T }>} the only event of that type produced by the last action
   */
  event(type) {
    const found = this.events.filter((event) => event.type === type);
    assert.equal(found.length, 1, `expected exactly one ${type} event, got ${found.length}`);
    return /** @type {Extract<EngineEvent, { type: T }>} */ (found[0]);
  }
}
