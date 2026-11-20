// What one client may know about a match. The state never leaves the host; views do.

import { idOrNull, pendingSeats, raiseOffer, seatOf } from './queries.js';
import { nextValue } from './rules.js';

/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').HandState} HandState */
/** @typedef {import('./types.js').Play} Play */
/** @typedef {import('./types.js').View} View */
/** @typedef {import('./types.js').ViewHand} ViewHand */
/** @typedef {import('./types.js').ViewPlay} ViewPlay */
/** @typedef {import('./types.js').ViewRaise} ViewRaise */

/**
 * Hides everything the viewer must not know: other players' cards, discards, the stock and the individual
 * answers to a pending raise.
 * @param {MatchState} state
 * @param {string | null} viewerId null (or an id that is not in the match) for spectators
 * @returns {View}
 */
export function viewFor(state, viewerId) {
  const viewer = viewerId === null ? -1 : seatOf(state, viewerId);
  const { hand, lastHand, result } = state;
  return {
    targetScore: state.targetScore,
    phase: state.phase,
    players: state.players.map(({ id, name, score, removed }) => ({ id, name, score, removed })),
    viewer: viewer === -1 ? null : state.players[viewer].id,
    dealer: state.players[state.dealer].id,
    handNumber: state.handNumber,
    hand: hand === null ? null : handView(state, hand, viewer),
    lastHand: lastHand === null ? null : {
      hand: lastHand.hand,
      winner: idOrNull(state, lastHand.winner),
      value: lastHand.value,
      reason: lastHand.reason,
    },
    result: result === null ? null : { winner: state.players[result.winner].id, reason: result.reason },
  };
}

/**
 * @param {MatchState} state
 * @param {HandState} hand
 * @param {number} viewer seat, -1 for spectators
 * @returns {ViewHand}
 */
function handView(state, hand, viewer) {
  /** @param {number} seat */
  const idOf = (seat) => state.players[seat].id;
  /**
   * @param {Play} play
   * @returns {ViewPlay}
   */
  const playView = (play) => ({ playerId: idOf(play.seat), card: play.card, voided: play.voided });
  const { current } = hand;
  return {
    number: hand.number,
    vira: hand.vira,
    manilha: hand.manilha,
    value: hand.value,
    nextValue: nextValue(hand.value),
    lastRaiser: idOrNull(state, hand.lastRaiser),
    turn: idOrNull(state, hand.turn),
    leader: current === null ? null : idOf(current.leader),
    rounds: hand.rounds.map((round) => ({
      leader: idOf(round.leader),
      plays: round.plays.map(playView),
      winner: idOrNull(state, round.winner),
    })),
    plays: current === null ? [] : current.plays.map(playView),
    dealtIn: hand.dealtIn.map(idOf),
    alive: hand.alive.map(idOf),
    ran: hand.dealtIn.filter((seat) => !hand.alive.includes(seat)).map(idOf),
    cardCounts: hand.cards.map((held) => held.length),
    myCards: viewer === -1 ? [] : [...hand.cards[viewer]],
    canRaise: viewer !== -1 && typeof raiseOffer(state, viewer) === 'number',
    raise: raiseView(state, hand, viewer),
  };
}

/**
 * @param {MatchState} state
 * @param {HandState} hand
 * @param {number} viewer seat, -1 for spectators
 * @returns {ViewRaise | null}
 */
function raiseView(state, hand, viewer) {
  const { raise } = hand;
  if (raise === null) return null;
  /** @param {number} seat */
  const idOf = (seat) => state.players[seat].id;
  const waiting = pendingSeats(state);
  const own = raise.answers.find((answer) => answer.seat === viewer);
  return {
    caller: idOf(raise.caller),
    value: raise.value,
    waiting: waiting.map(idOf),
    answered: hand.alive.filter((seat) => seat !== raise.caller && !waiting.includes(seat)).map(idOf),
    mustAnswer: waiting.includes(viewer),
    myAnswer: own === undefined ? null : own.accept,
  };
}
