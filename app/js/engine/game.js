// The match state machine. `createMatch` builds a state and `apply` moves it one validated action forward.
// Pure and deterministic: no clock, no randomness (shuffled decks arrive in the `deal` action), no mutation
// of inputs. Rule references ("2.1", "2.3"...) point to the sections of the game rules in the project spec.

import { isCard, manilhaRank } from './cards.js';
import {
  activeSeatsAfter, aliveFrom, idOrNull, liveHand, nextToPlay, pendingSeats, raiseOffer, seatOf,
} from './queries.js';
import {
  DEFAULT_TARGET, HAND_SIZE, LADDER, MAX_PLAYERS, MIN_PLAYERS, TARGET_OPTIONS, decideHand, roundWinner,
} from './rules.js';

export { DEFAULT_TARGET, LADDER, MAX_PLAYERS, MIN_PLAYERS, TARGET_OPTIONS } from './rules.js';
export { canRaise, defaultAction, pendingPlayers } from './queries.js';
export { viewFor } from './view.js';
export { checkInvariants } from './invariants.js';

/** @typedef {import('./types.js').PlayerInfo} PlayerInfo */
/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').HandState} HandState */
/** @typedef {import('./types.js').RaiseState} RaiseState */
/** @typedef {import('./types.js').Action} Action */
/** @typedef {import('./types.js').ApplyResult} ApplyResult */
/** @typedef {import('./types.js').ApplyFailure} ApplyFailure */
/** @typedef {import('./types.js').EngineEvent} EngineEvent */
/** @typedef {import('./types.js').ErrorCode} ErrorCode */
/** @typedef {import('./types.js').HandReason} HandReason */
/** @typedef {import('./types.js').LeaveReason} LeaveReason */
/** @typedef {import('./types.js').MatchReason} MatchReason */
/** @typedef {import('./queries.js').LiveHand} LiveHand */

/**
 * An action whose fields have the right types. The deck is checked later, by the deal itself.
 * @typedef {{ type: 'deal', deck: unknown }
 *   | { type: 'play', playerId: string, card: string }
 *   | { type: 'truco' | 'remove', playerId: string }
 *   | { type: 'respond', playerId: string, accept: boolean }} ParsedAction
 */

const DECK_SIZE = 40;

/**
 * @param {readonly PlayerInfo[]} players 2 to 7 players with distinct ids, in seat order
 * @param {{ dealerIndex?: number, targetScore?: number }} [opts] seat of the first dealer (default 0) and the
 *   points that win the match: 6, 9 or 12 (default 12)
 * @returns {MatchState} a match in phase 'deal', waiting for the first deck
 * @throws {TypeError | RangeError} when the arguments cannot make a match
 */
export function createMatch(players, opts = {}) {
  if (!Array.isArray(players) || players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    throw new RangeError(`A match takes ${MIN_PLAYERS} to ${MAX_PLAYERS} players`);
  }
  /** @type {Set<string>} */
  const ids = new Set();
  for (const player of players) {
    if (typeof player?.id !== 'string' || player.id === '' || typeof player.name !== 'string') {
      throw new TypeError('Every player needs a non-empty string id and a string name');
    }
    if (ids.has(player.id)) throw new RangeError(`Duplicate player id: ${player.id}`);
    ids.add(player.id);
  }
  const dealer = opts.dealerIndex ?? 0;
  if (!Number.isInteger(dealer) || dealer < 0 || dealer >= players.length) {
    throw new RangeError('dealerIndex must be the index of a player');
  }
  const targetScore = opts.targetScore ?? DEFAULT_TARGET;
  if (!TARGET_OPTIONS.includes(targetScore)) {
    throw new RangeError(`targetScore must be one of ${TARGET_OPTIONS.join(', ')}`);
  }
  return {
    targetScore,
    players: players.map(({ id, name }) => ({ id, name, score: 0, removed: false })),
    phase: 'deal',
    dealer,
    handNumber: 0,
    hand: null,
    lastHand: null,
    result: null,
  };
}

/**
 * Applies one action. Never throws for an invalid action and never touches `state`: an invalid action
 * returns `{ ok: false, error, state }` with the very same state object.
 * @param {MatchState} state
 * @param {Action} action anything else (garbage from the network included) is answered with 'bad-action'
 * @returns {ApplyResult}
 */
export function apply(state, action) {
  const parsed = parseAction(action);
  if (parsed === null) return fail(state, 'bad-action');
  if (state.phase === 'over') return fail(state, 'match-over');
  switch (parsed.type) {
    case 'deal':
      return applyDeal(state, parsed.deck);
    case 'play':
      return applyPlay(state, parsed.playerId, parsed.card);
    case 'truco':
      return applyTruco(state, parsed.playerId);
    case 'respond':
      return applyRespond(state, parsed.playerId, parsed.accept);
    case 'remove':
      return applyRemove(state, parsed.playerId);
  }
}

/**
 * @param {unknown} action
 * @returns {ParsedAction | null} null when the action is not an object of a known type with well-typed fields
 */
function parseAction(action) {
  if (typeof action !== 'object' || action === null) return null;
  const { type, playerId, card, accept, deck } = /** @type {Record<string, unknown>} */ (action);
  if (type === 'deal') return { type, deck };
  if (typeof playerId !== 'string') return null;
  if (type === 'play') return typeof card === 'string' ? { type, playerId, card } : null;
  if (type === 'respond') return typeof accept === 'boolean' ? { type, playerId, accept } : null;
  if (type === 'truco' || type === 'remove') return { type, playerId };
  return null;
}

/**
 * @param {MatchState} state
 * @param {ErrorCode} error
 * @returns {ApplyFailure}
 */
function fail(state, error) {
  return { ok: false, error, state };
}

// ------------------------------------------------------------------------------------------- actions
// Every handler validates against the untouched state first, and only then works on a private copy.

/**
 * @param {MatchState} state
 * @param {unknown} deck
 * @returns {ApplyResult}
 */
function applyDeal(state, deck) {
  if (state.phase !== 'deal') return fail(state, 'wrong-phase');
  if (!isValidDeck(deck)) return fail(state, 'bad-deck');

  const draft = cloneJson(state);
  // Deal mapping (fixed): players in order from the seat after the dealer get three cards each, then the vira.
  const order = activeSeatsAfter(draft.players, draft.dealer);
  /** @type {string[][]} */
  const cards = draft.players.map(() => []);
  order.forEach((seat, position) => {
    cards[seat] = deck.slice(HAND_SIZE * position, HAND_SIZE * (position + 1));
  });
  const vira = deck[HAND_SIZE * order.length];
  const leader = order[0];

  draft.handNumber += 1;
  draft.phase = 'play';
  draft.hand = {
    number: draft.handNumber,
    vira,
    manilha: manilhaRank(vira),
    value: LADDER[0],
    lastRaiser: null,
    dealtIn: order,
    alive: [...order],
    cards,
    rounds: [],
    current: { leader, plays: [] },
    turn: leader,
    raise: null,
    discards: [],
    stock: deck.slice(HAND_SIZE * order.length + 1),
  };
  return {
    ok: true,
    state: draft,
    events: [{
      type: 'handDealt',
      hand: draft.handNumber,
      dealer: draft.players[draft.dealer].id,
      leader: draft.players[leader].id,
      players: order.map((seat) => draft.players[seat].id),
      vira,
      manilha: draft.hand.manilha,
    }],
  };
}

/**
 * @param {unknown} deck
 * @returns {deck is string[]} whether it is the 40 distinct card ids
 */
function isValidDeck(deck) {
  return Array.isArray(deck) && deck.length === DECK_SIZE && deck.every(isCard) && new Set(deck).size === DECK_SIZE;
}

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @param {string} card
 * @returns {ApplyResult}
 */
function applyPlay(state, playerId, card) {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail(state, 'unknown-player');
  const live = liveHand(state);
  if (state.phase !== 'play' || live === null) return fail(state, 'wrong-phase');
  if (live.hand.turn !== seat) return fail(state, 'not-your-turn');
  if (!live.hand.cards[seat].includes(card)) return fail(state, 'card-not-in-hand');

  const draft = cloneJson(state);
  const { hand, round } = hold(draft);
  /** @type {EngineEvent[]} */
  const events = [{ type: 'cardPlayed', playerId, card, round: hand.rounds.length }];
  hand.cards[seat] = hand.cards[seat].filter((held) => held !== card);
  round.plays.push({ seat, card, voided: false });
  advanceHand(draft, events);
  return { ok: true, state: draft, events };
}

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @returns {ApplyResult}
 */
function applyTruco(state, playerId) {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail(state, 'unknown-player');
  const offer = raiseOffer(state, seat);
  if (typeof offer !== 'number') return fail(state, offer);

  const draft = cloneJson(state);
  hold(draft).hand.raise = { caller: seat, value: offer, answers: [] };
  draft.phase = 'truco';
  return { ok: true, state: draft, events: [{ type: 'trucoCalled', playerId, value: offer }] };
}

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @param {boolean} accept
 * @returns {ApplyResult}
 */
function applyRespond(state, playerId, accept) {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail(state, 'unknown-player');
  const live = liveHand(state);
  if (state.phase !== 'truco' || live === null || live.hand.raise === null) return fail(state, 'wrong-phase');
  if (!live.hand.alive.includes(seat)) return fail(state, 'not-in-hand');
  if (live.hand.raise.caller === seat) return fail(state, 'own-raise');
  if (live.hand.raise.answers.some((answer) => answer.seat === seat)) return fail(state, 'already-answered');

  const draft = cloneJson(state);
  const raise = pendingRaise(draft);
  /** @type {EngineEvent[]} */
  const events = [{ type: 'trucoAnswered', playerId }];
  raise.answers.push({ seat, accept });
  if (pendingSeats(draft).length === 0) resolveRaise(draft, raise, events);
  return { ok: true, state: draft, events };
}

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @returns {ApplyResult}
 */
function applyRemove(state, playerId) {
  const seat = seatOf(state, playerId);
  if (seat === -1) return fail(state, 'unknown-player');
  if (state.players[seat].removed) return fail(state, 'already-removed');

  const draft = cloneJson(state);
  /** @type {EngineEvent[]} */
  const events = [{ type: 'playerRemoved', playerId }];
  draft.players[seat].removed = true;
  const live = liveHand(draft);
  if (live === null) {
    // Between hands: nothing to leave, but the match may be over or need another dealer (2.3).
    const remaining = activeSeatsAfter(draft.players, draft.dealer);
    if (remaining.length < MIN_PLAYERS) endMatch(draft, remaining[0], 'abandon', events);
    else if (draft.dealer === seat) draft.dealer = remaining[0];
  } else if (live.hand.alive.includes(seat)) {
    removeFromHand(draft, live, seat, events);
  }
  return { ok: true, state: draft, events };
}

// ----------------------------------------------------------------------------------------- hand flow
// The functions below change the draft they receive.

/**
 * The hand in progress of a draft whose original was validated to have one.
 * @param {MatchState} draft
 * @returns {LiveHand}
 */
function hold(draft) {
  return /** @type {LiveHand} */ (liveHand(draft));
}

/**
 * The raise awaiting answers in a draft whose original was validated to have one.
 * @param {MatchState} draft
 * @returns {RaiseState}
 */
function pendingRaise(draft) {
  return /** @type {RaiseState} */ (hold(draft).hand.raise);
}

/**
 * Takes a player who is being removed from the match out of the hand in progress (2.3).
 * @param {MatchState} draft
 * @param {LiveHand} live
 * @param {number} seat
 * @param {EngineEvent[]} events
 */
function removeFromHand(draft, live, seat, events) {
  const { hand } = live;
  const raise = hand.raise;
  if (raise !== null && raise.caller !== seat) {
    // A responder who leaves the match counts as having run. Like any runner it weighs on the hand only
    // when the raise is resolved, so 2.1 is not evaluated while other answers are still missing.
    raise.answers = raise.answers.filter((answer) => answer.seat !== seat);
    raise.answers.push({ seat, accept: false });
    leaveHand(draft, live, seat, 'removed', events);
    if (pendingSeats(draft).length === 0) resolveRaise(draft, raise, events);
    return;
  }
  if (raise !== null) {
    // The caller left: the raise never happened.
    hand.raise = null;
    draft.phase = 'play';
    events.push({ type: 'trucoCancelled', caller: draft.players[seat].id });
  }
  leaveHand(draft, live, seat, 'removed', events);
  advanceHand(draft, events);
}

/**
 * Closes a raise once every answer is in (2.2).
 * @param {MatchState} draft
 * @param {RaiseState} raise
 * @param {EngineEvent[]} events
 */
function resolveRaise(draft, raise, events) {
  const live = hold(draft);
  const { hand } = live;
  /** @param {boolean} accept */
  const seatsThatAnswered = (accept) =>
    hand.dealtIn.filter((seat) => raise.answers.some((answer) => answer.seat === seat && answer.accept === accept));
  const accepted = seatsThatAnswered(true);
  const ran = seatsThatAnswered(false);

  hand.raise = null;
  draft.phase = 'play';
  if (accepted.length > 0) {
    hand.value = raise.value;
    hand.lastRaiser = raise.caller;
  }
  events.push({
    type: 'trucoResolved',
    caller: draft.players[raise.caller].id,
    accepted: accepted.map((seat) => draft.players[seat].id),
    ran: ran.map((seat) => draft.players[seat].id),
    value: hand.value,
  });
  for (const seat of ran) {
    // Responders removed while the raise was pending are already out of the hand.
    if (hand.alive.includes(seat)) leaveHand(draft, live, seat, 'ran', events);
  }
  if (accepted.length === 0) endHand(draft, hand, raise.caller, 'allRan', events);
  else advanceHand(draft, events);
}

/**
 * A player leaves the hand: scores nothing, discards the cards still held, and the card already played in
 * the unfinished round stops counting (2.2).
 * @param {MatchState} draft
 * @param {LiveHand} live
 * @param {number} seat
 * @param {LeaveReason} reason
 * @param {EngineEvent[]} events
 */
function leaveHand(draft, live, seat, reason, events) {
  const { hand, round } = live;
  hand.alive = hand.alive.filter((other) => other !== seat);
  for (const play of round.plays) {
    if (play.seat === seat) play.voided = true;
  }
  hand.discards.push(...hand.cards[seat]);
  hand.cards[seat] = [];
  events.push({ type: 'playerLeftHand', playerId: draft.players[seat].id, reason });
}

/**
 * Moves the hand on after a card was played or someone left: ends the hand if 2.1 names a winner, closes
 * the round once everybody still in the hand has played, and sets whose turn it is.
 * @param {MatchState} draft
 * @param {EngineEvent[]} events
 */
function advanceHand(draft, events) {
  const { hand, round } = hold(draft);
  if (endHandIfDecided(draft, hand, events)) return;
  const next = nextToPlay(hand.alive, round, draft.players.length);
  if (next !== null) {
    hand.turn = next;
    return;
  }

  const winner = roundWinner(round.plays, hand.manilha);
  hand.rounds.push({ leader: round.leader, plays: round.plays, winner });
  hand.current = null;
  events.push({ type: 'roundEnded', round: hand.rounds.length - 1, winner: idOrNull(draft, winner) });
  if (endHandIfDecided(draft, hand, events)) return;

  // The winner leads the next round; after a tie, whoever led it, or the next player still in the hand.
  const leader = winner ?? aliveFrom(hand.alive, round.leader, draft.players.length)[0];
  hand.current = { leader, plays: [] };
  hand.turn = leader;
}

/**
 * @param {MatchState} draft
 * @param {HandState} hand
 * @param {EngineEvent[]} events
 * @returns {boolean} whether the hand ended
 */
function endHandIfDecided(draft, hand, events) {
  const verdict = decideHand(hand.alive, hand.rounds.map((round) => round.winner));
  if (verdict === null) return false;
  endHand(draft, hand, verdict.winner, verdict.reason, events);
  return true;
}

/**
 * Scores the hand and decides what comes next: the end of the match or another deal.
 * @param {MatchState} draft
 * @param {HandState} hand
 * @param {number | null} winner null when nobody scores
 * @param {HandReason} reason
 * @param {EngineEvent[]} events
 */
function endHand(draft, hand, winner, reason, events) {
  const value = winner === null ? 0 : hand.value;
  if (winner !== null) draft.players[winner].score += value;
  hand.turn = null;
  draft.lastHand = { hand: hand.number, winner, value, reason };
  events.push({ type: 'handEnded', hand: hand.number, winner: idOrNull(draft, winner), value, reason });

  const remaining = activeSeatsAfter(draft.players, draft.dealer);
  if (remaining.length < MIN_PLAYERS) {
    // Checked before the score on purpose: with nobody left to play against, the reason is the abandon.
    endMatch(draft, remaining[0], 'abandon', events);
  } else if (winner !== null && draft.players[winner].score >= draft.targetScore) {
    endMatch(draft, winner, 'score', events);
  } else {
    draft.phase = 'deal';
    draft.dealer = remaining[0];
  }
}

/**
 * @param {MatchState} draft
 * @param {number} winner
 * @param {MatchReason} reason
 * @param {EngineEvent[]} events
 */
function endMatch(draft, winner, reason, events) {
  draft.phase = 'over';
  draft.result = { winner, reason };
  events.push({ type: 'matchEnded', winner: draft.players[winner].id, reason });
}

/**
 * Deep copy of plain JSON data, which is all a match state is made of.
 * @template T
 * @param {T} value
 * @returns {T}
 */
function cloneJson(value) {
  if (typeof value !== 'object' || value === null) return value;
  if (Array.isArray(value)) return /** @type {T} */ (/** @type {unknown} */ (value.map(cloneJson)));
  const source = /** @type {Record<string, unknown>} */ (value);
  /** @type {Record<string, unknown>} */
  const copy = {};
  for (const key of Object.keys(source)) copy[key] = cloneJson(source[key]);
  return /** @type {T} */ (copy);
}
