// The 40-card truco deck: card ids and how strong each card is in a hand.

/** Ranks from weakest to strongest, manilhas aside. */
export const RANKS = Object.freeze(['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']);

/** Suit letters from weakest to strongest manilha: ouros, espadas, copas, paus. */
export const SUITS = Object.freeze(['o', 'e', 'c', 'p']);

/** @returns {string[]} the 40 card ids, in a fixed order */
export function fullDeck() {
  return RANKS.flatMap((rank) => SUITS.map((suit) => rank + suit));
}

/**
 * @param {unknown} id
 * @returns {id is string}
 */
export function isCard(id) {
  return typeof id === 'string' && id.length === 2 && RANKS.includes(id[0]) && SUITS.includes(id[1]);
}

/**
 * @param {string} id
 * @returns {string} the card's rank
 * @throws {RangeError} when `id` is not a card id
 */
export function rankOf(id) {
  if (!isCard(id)) throw new RangeError(`Not a card id: ${String(id)}`);
  return id[0];
}

/**
 * @param {string} id
 * @returns {string} the card's suit letter
 * @throws {RangeError} when `id` is not a card id
 */
export function suitOf(id) {
  if (!isCard(id)) throw new RangeError(`Not a card id: ${String(id)}`);
  return id[1];
}

/**
 * @param {string} viraId the card turned up
 * @returns {string} the rank right after the vira's rank (after `3` comes `4`)
 */
export function manilhaRank(viraId) {
  return RANKS[(RANKS.indexOf(rankOf(viraId)) + 1) % RANKS.length];
}

/**
 * @param {string} cardId
 * @param {string} manilha the manilha rank of the hand
 * @returns {boolean}
 */
export function isManilha(cardId, manilha) {
  return rankOf(cardId) === manilha;
}

/**
 * Higher wins, equal ties. Manilhas rank above everything, by suit; other cards rank by rank only.
 * @param {string} cardId
 * @param {string} manilha the manilha rank of the hand
 * @returns {number}
 */
export function strength(cardId, manilha) {
  if (isManilha(cardId, manilha)) return RANKS.length + SUITS.indexOf(suitOf(cardId));
  return RANKS.indexOf(rankOf(cardId));
}

/**
 * The card a timed-out player throws away: lowest strength, and among equals the lowest suit.
 * @param {readonly string[]} cardIds
 * @param {string} manilha the manilha rank of the hand
 * @returns {string | null} null when `cardIds` is empty
 */
export function weakestCard(cardIds, manilha) {
  /** @type {string | null} */
  let weakest = null;
  for (const card of cardIds) {
    if (weakest === null || isWeaker(card, weakest, manilha)) weakest = card;
  }
  return weakest;
}

/**
 * @param {string} card
 * @param {string} other
 * @param {string} manilha
 * @returns {boolean}
 */
function isWeaker(card, other, manilha) {
  const difference = strength(card, manilha) - strength(other, manilha);
  if (difference !== 0) return difference < 0;
  return SUITS.indexOf(suitOf(card)) < SUITS.indexOf(suitOf(other));
}
