// Read-only questions about a match state. Nothing here changes the state.

import { weakestCard } from './cards.js';
import { TARGET_SCORE, nextValue, seatOrder } from './rules.js';

/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').PlayerState} PlayerState */
/** @typedef {import('./types.js').HandState} HandState */
/** @typedef {import('./types.js').OpenRound} OpenRound */
/** @typedef {import('./types.js').ErrorCode} ErrorCode */
/** @typedef {import('./types.js').PlayAction} PlayAction */
/** @typedef {import('./types.js').RespondAction} RespondAction */

/**
 * A hand that is being played, with its round in progress.
 * @typedef {{ hand: HandState, round: OpenRound }} LiveHand
 */

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @returns {number} the player's seat, -1 when the id is not in the match
 */
export function seatOf(state, playerId) {
  return state.players.findIndex((player) => player.id === playerId);
}

/**
 * @param {MatchState} state
 * @param {number | null} seat
 * @returns {string | null}
 */
export function idOrNull(state, seat) {
  return seat === null ? null : state.players[seat].id;
}

/**
 * @param {MatchState} state
 * @returns {LiveHand | null} null between hands and after the match
 */
export function liveHand(state) {
  if (state.phase !== 'play' && state.phase !== 'truco') return null;
  const hand = state.hand;
  if (hand === null || hand.current === null) return null;
  return { hand, round: hand.current };
}

/**
 * @param {readonly PlayerState[]} players
 * @param {number} seat
 * @returns {number[]} seats still in the match, in playing order starting right after `seat` (which, when
 *   still in the match, comes last)
 */
export function activeSeatsAfter(players, seat) {
  return seatOrder(players.length, (seat + 1) % players.length).filter((other) => !players[other].removed);
}

/**
 * @param {readonly number[]} alive seats still in the hand
 * @param {number} start
 * @param {number} seatCount
 * @returns {number[]} the seats still in the hand, in playing order starting at `start`
 */
export function aliveFrom(alive, start, seatCount) {
  return seatOrder(seatCount, start).filter((seat) => alive.includes(seat));
}

/**
 * @param {readonly number[]} alive seats still in the hand
 * @param {OpenRound} round
 * @param {number} seatCount
 * @returns {number | null} the seat that plays next; null when everyone still in the hand has played
 */
export function nextToPlay(alive, round, seatCount) {
  const waiting = aliveFrom(alive, round.leader, seatCount).filter(
    (seat) => !round.plays.some((play) => play.seat === seat),
  );
  return waiting.length > 0 ? waiting[0] : null;
}

/**
 * Spec 2.2: who may raise.
 * @param {MatchState} state
 * @param {number} seat
 * @returns {number | ErrorCode} the value `seat` would propose by raising now, or why it may not raise
 */
export function raiseOffer(state, seat) {
  const live = liveHand(state);
  if (state.phase !== 'play' || live === null) return 'wrong-phase';
  if (live.hand.turn !== seat) return 'not-your-turn';
  const value = nextValue(live.hand.value);
  if (value === null) return 'raise-at-max';
  if (live.hand.lastRaiser === seat) return 'raise-twice';
  if (state.players[seat].score === TARGET_SCORE - 1) return 'raise-at-eleven';
  return value;
}

/**
 * @param {MatchState} state
 * @returns {number[]} seats that must act now: the player to play, or the responders yet to answer a raise
 */
export function pendingSeats(state) {
  const live = liveHand(state);
  if (live === null) return [];
  const { turn, raise, alive } = live.hand;
  if (raise === null) return turn === null ? [] : [turn];
  return alive.filter((seat) => seat !== raise.caller && !raise.answers.some((answer) => answer.seat === seat));
}

/**
 * @param {MatchState} state
 * @param {string} playerId
 * @returns {boolean} whether the player may call a raise right now
 */
export function canRaise(state, playerId) {
  const seat = seatOf(state, playerId);
  return seat !== -1 && typeof raiseOffer(state, seat) === 'number';
}

/**
 * @param {MatchState} state
 * @returns {string[]} ids of the players who must act now; empty in phases 'deal' and 'over'
 */
export function pendingPlayers(state) {
  return pendingSeats(state).map((seat) => state.players[seat].id);
}

/**
 * Spec 2.4: what happens when a player's time runs out.
 * @param {MatchState} state
 * @param {string} playerId
 * @returns {PlayAction | RespondAction | null} null when the player has nothing to do right now
 */
export function defaultAction(state, playerId) {
  const seat = seatOf(state, playerId);
  const live = liveHand(state);
  if (live === null || !pendingSeats(state).includes(seat)) return null;
  if (live.hand.raise !== null) return { type: 'respond', playerId, accept: false };
  const card = weakestCard(live.hand.cards[seat], live.hand.manilha);
  return card === null ? null : { type: 'play', playerId, card };
}
