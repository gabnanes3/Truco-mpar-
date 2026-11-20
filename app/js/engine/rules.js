// Rule constants and the pure rule functions that do not need the match state.

import { strength } from './cards.js';

/** @typedef {import('./types.js').Play} Play */
/** @typedef {import('./types.js').HandReason} HandReason */

/** Points that win a match when the host does not choose. */
export const DEFAULT_TARGET = 12;

/** Match targets the host may choose from. */
export const TARGET_OPTIONS = Object.freeze([6, 9, 12]);

/** Hand values: 1, then truco, seis, nove, doze. */
export const LADDER = Object.freeze([1, 3, 6, 9, 12]);

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 7;

/** Cards dealt to each player, hence also the number of rounds a hand can have. */
export const HAND_SIZE = 3;

/**
 * @param {number} value a hand value
 * @returns {number | null} the value a raise would propose; null at the top of the ladder
 */
export function nextValue(value) {
  const step = LADDER.indexOf(value);
  return step >= 0 && step < LADDER.length - 1 ? LADDER[step + 1] : null;
}

/**
 * Playing order: increasing seat index, wrapping around.
 * @param {number} count number of seats
 * @param {number} start seat the order starts from
 * @returns {number[]} every seat exactly once
 */
export function seatOrder(count, start) {
  return Array.from({ length: count }, (_, step) => (start + step) % count);
}

/**
 * @param {readonly Play[]} plays
 * @param {string} manilha the manilha rank of the hand
 * @returns {number | null} seat of the single strongest counting card; null when the top strength is shared
 */
export function roundWinner(plays, manilha) {
  let best = -1;
  /** @type {number | null} */
  let winner = null;
  for (const play of plays) {
    if (play.voided) continue;
    const power = strength(play.card, manilha);
    if (power > best) {
      best = power;
      winner = play.seat;
    } else if (power === best) {
      winner = null;
    }
  }
  return winner;
}

/**
 * Spec 2.1, literally. To be evaluated after every completed round and after every departure.
 * @param {readonly number[]} alive seats still in the hand
 * @param {readonly (number | null)[]} winners winner of each completed round (null = tie)
 * @returns {{ winner: number | null, reason: Exclude<HandReason, 'allRan'> } | null} null while the hand goes on
 */
export function decideHand(alive, winners) {
  if (alive.length === 1) return { winner: alive[0], reason: 'lastStanding' };

  // A round won by someone who has since left the hand counts as a round without a winner.
  const eff = winners.map((winner) => (winner !== null && alive.includes(winner) ? winner : null));
  const [first, second, third] = eff;

  for (const seat of alive) {
    if (eff.filter((winner) => winner === seat).length >= 2) return { winner: seat, reason: 'rounds' };
  }
  if (eff.length >= 2) {
    if (first === null && second !== null) return { winner: second, reason: 'rounds' };
    if (first !== null && second === null) return { winner: first, reason: 'rounds' };
  }
  if (eff.length >= HAND_SIZE) {
    // Rounds 1 and 2 are either both won (by two different players) or both without a winner here.
    if (first !== null && second !== null) return { winner: first, reason: 'rounds' };
    if (third !== null) return { winner: third, reason: 'rounds' };
    return { winner: null, reason: 'allTied' };
  }
  return null;
}
