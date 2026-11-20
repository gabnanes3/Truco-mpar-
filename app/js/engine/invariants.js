// Health check for a match state. The simulation tests run it after every step and the host runs it on
// snapshots read back from storage, so it is deliberately strict and never trusts its input.

import { isCard, manilhaRank } from './cards.js';
import {
  HAND_SIZE, LADDER, MAX_PLAYERS, MIN_PLAYERS, TARGET_SCORE, decideHand, nextValue, roundWinner,
} from './rules.js';

/** @typedef {import('./types.js').MatchState} MatchState */
/** @typedef {import('./types.js').HandState} HandState */
/** @typedef {import('./types.js').RaiseState} RaiseState */
/** @typedef {import('./types.js').OpenRound} OpenRound */

const DECK_SIZE = 40;
const MAX_SCORE = TARGET_SCORE - 1 + LADDER[LADDER.length - 1];

const STATE_KEYS = ['players', 'phase', 'dealer', 'handNumber', 'hand', 'lastHand', 'result'];
const PLAYER_KEYS = ['id', 'name', 'score', 'removed'];
const HAND_KEYS = [
  'number', 'vira', 'manilha', 'value', 'lastRaiser', 'dealtIn', 'alive', 'cards', 'rounds', 'current', 'turn',
  'raise', 'discards', 'stock',
];
const PHASES = ['deal', 'play', 'truco', 'over'];
const HAND_REASONS = ['rounds', 'allRan', 'lastStanding', 'allTied'];
const MATCH_REASONS = ['score', 'abandon'];

/**
 * @param {unknown} state anything; a value that is not a match state is reported, not thrown
 * @returns {string[]} human-readable violations; empty when the state is healthy
 */
export function checkInvariants(state) {
  try {
    const malformed = shapeProblems(state);
    if (malformed.length > 0) return malformed;
    return ruleProblems(/** @type {MatchState} */ (state));
  } catch (error) {
    return [`state: could not be checked (${String(error)})`];
  }
}

// ---------------------------------------------------------------------------------------------- shape
// First pass: plain JSON of exactly the documented shape, with every seat in range and every card a real
// card. The second pass relies on this to index freely.

/**
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @returns {Record<string, unknown> | null} the value when it is a plain object with exactly these keys
 */
function record(value, keys) {
  if (typeof value !== 'object' || value === null || Object.getPrototypeOf(value) !== Object.prototype) return null;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => own.includes(key))) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isCount(value) {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

/**
 * @param {unknown} value
 * @param {number} seats
 * @returns {value is number}
 */
function isSeat(value, seats) {
  return isCount(value) && value < seats;
}

/**
 * @param {unknown} value
 * @param {number} seats
 * @returns {boolean}
 */
function isSeatOrNull(value, seats) {
  return value === null || isSeat(value, seats);
}

/**
 * @param {unknown} value
 * @param {number} seats
 * @returns {boolean}
 */
function isSeatList(value, seats) {
  return Array.isArray(value) && value.every((seat) => isSeat(seat, seats));
}

/**
 * @param {unknown} value
 * @returns {boolean}
 */
function isCardList(value) {
  return Array.isArray(value) && value.every(isCard);
}

/**
 * @param {unknown} value
 * @param {readonly string[]} options
 * @returns {boolean}
 */
function isOneOf(value, options) {
  return typeof value === 'string' && options.includes(value);
}

/**
 * @param {unknown} value
 * @param {number} seats
 * @returns {boolean}
 */
function isPlayList(value, seats) {
  return Array.isArray(value) && value.every((item) => {
    const play = record(item, ['seat', 'card', 'voided']);
    return play !== null && isSeat(play.seat, seats) && isCard(play.card) && typeof play.voided === 'boolean';
  });
}

/**
 * @param {unknown} state
 * @returns {string[]}
 */
function shapeProblems(state) {
  const top = record(state, STATE_KEYS);
  if (top === null) return [`state: expected a plain object with exactly the keys ${STATE_KEYS.join(', ')}`];
  const { players } = top;
  const playersOk = Array.isArray(players) && players.every((item) => {
    const player = record(item, PLAYER_KEYS);
    return player !== null && typeof player.id === 'string' && typeof player.name === 'string'
      && isCount(player.score) && typeof player.removed === 'boolean';
  });
  if (!Array.isArray(players) || !playersOk) return ['players: expected a list of { id, name, score, removed }'];
  const seats = players.length;

  /** @type {string[]} */
  const problems = [];
  if (!isOneOf(top.phase, PHASES)) problems.push('phase: unknown phase');
  if (!isSeat(top.dealer, seats)) problems.push('dealer: expected a seat');
  if (!isCount(top.handNumber)) problems.push('handNumber: expected a non-negative integer');
  if (top.hand !== null) problems.push(...handShapeProblems(top.hand, seats));

  const lastHand = top.lastHand === null ? null : record(top.lastHand, ['hand', 'winner', 'value', 'reason']);
  if (top.lastHand !== null && (lastHand === null || !isCount(lastHand.hand) || !isSeatOrNull(lastHand.winner, seats)
    || !isCount(lastHand.value) || !isOneOf(lastHand.reason, HAND_REASONS))) {
    problems.push('lastHand: expected null or { hand, winner, value, reason }');
  }
  const result = top.result === null ? null : record(top.result, ['winner', 'reason']);
  if (top.result !== null && (result === null || !isSeat(result.winner, seats) || !isOneOf(result.reason, MATCH_REASONS))) {
    problems.push('result: expected null or { winner, reason }');
  }
  return problems;
}

/**
 * @param {unknown} value
 * @param {number} seats
 * @returns {string[]}
 */
function handShapeProblems(value, seats) {
  const hand = record(value, HAND_KEYS);
  if (hand === null) return [`hand: expected null or a plain object with exactly the keys ${HAND_KEYS.join(', ')}`];

  /** @type {string[]} */
  const problems = [];
  if (!isCount(hand.number)) problems.push('hand.number: expected a non-negative integer');
  if (!isCard(hand.vira)) problems.push('hand.vira: expected a card');
  if (typeof hand.manilha !== 'string') problems.push('hand.manilha: expected a rank');
  if (typeof hand.value !== 'number') problems.push('hand.value: expected a number');
  if (!isSeatOrNull(hand.lastRaiser, seats)) problems.push('hand.lastRaiser: expected a seat or null');
  if (!isSeatList(hand.dealtIn, seats)) problems.push('hand.dealtIn: expected a list of seats');
  if (!isSeatList(hand.alive, seats)) problems.push('hand.alive: expected a list of seats');
  if (!Array.isArray(hand.cards) || hand.cards.length !== seats || !hand.cards.every(isCardList)) {
    problems.push('hand.cards: expected one list of cards per seat');
  }
  const roundsOk = Array.isArray(hand.rounds) && hand.rounds.every((item) => {
    const round = record(item, ['leader', 'plays', 'winner']);
    return round !== null && isSeat(round.leader, seats) && isPlayList(round.plays, seats)
      && isSeatOrNull(round.winner, seats);
  });
  if (!roundsOk) problems.push('hand.rounds: expected a list of { leader, plays, winner }');
  const current = hand.current === null ? null : record(hand.current, ['leader', 'plays']);
  if (hand.current !== null && (current === null || !isSeat(current.leader, seats) || !isPlayList(current.plays, seats))) {
    problems.push('hand.current: expected null or { leader, plays }');
  }
  if (!isSeatOrNull(hand.turn, seats)) problems.push('hand.turn: expected a seat or null');
  const raise = hand.raise === null ? null : record(hand.raise, ['caller', 'value', 'answers']);
  const answersOk = raise !== null && Array.isArray(raise.answers) && raise.answers.every((item) => {
    const answer = record(item, ['seat', 'accept']);
    return answer !== null && isSeat(answer.seat, seats) && typeof answer.accept === 'boolean';
  });
  if (hand.raise !== null && (raise === null || !isSeat(raise.caller, seats) || typeof raise.value !== 'number' || !answersOk)) {
    problems.push('hand.raise: expected null or { caller, value, answers }');
  }
  if (!isCardList(hand.discards)) problems.push('hand.discards: expected a list of cards');
  if (!isCardList(hand.stock)) problems.push('hand.stock: expected a list of cards');
  return problems;
}

// ---------------------------------------------------------------------------------------------- rules

/**
 * @param {MatchState} state
 * @returns {string[]}
 */
function ruleProblems(state) {
  const problems = matchProblems(state);
  const { hand, phase } = state;
  if (hand === null) return problems;
  problems.push(...handProblems(state, hand));
  if (phase === 'play' || phase === 'truco') problems.push(...liveHandProblems(state, hand));
  else problems.push(...finishedHandProblems(state, hand));
  return problems;
}

/**
 * Players, scores, phase, results and the hand counter.
 * @param {MatchState} state
 * @returns {string[]}
 */
function matchProblems(state) {
  /** @type {string[]} */
  const problems = [];
  const { players, phase, hand, lastHand, result } = state;
  const active = players.filter((player) => !player.removed).length;
  const playing = phase === 'play' || phase === 'truco';

  if (players.length < MIN_PLAYERS || players.length > MAX_PLAYERS) {
    problems.push(`players: a match has ${MIN_PLAYERS} to ${MAX_PLAYERS} seats`);
  }
  if (players.some((player) => player.id === '') || new Set(players.map((player) => player.id)).size !== players.length) {
    problems.push('players: ids must be non-empty and distinct');
  }
  if (players.some((player) => player.score > MAX_SCORE)) problems.push(`players: no score can exceed ${MAX_SCORE}`);

  if ((phase === 'over') !== (result !== null)) {
    problems.push('result: must be set exactly when the match is over');
  } else if (result === null) {
    if (active < MIN_PLAYERS) problems.push('players: a running match needs 2 players who were not removed');
    if (players.some((player) => player.score >= TARGET_SCORE)) {
      problems.push('players: a running match cannot have a score at the target');
    }
  } else if (result.reason === 'abandon') {
    if (active !== 1 || players[result.winner].removed) {
      problems.push('result: an abandoned match is won by the only player left');
    }
  } else {
    if (active < MIN_PLAYERS) problems.push('result: with a single player left the reason must be abandon');
    if (players.some((player, seat) => (player.score >= TARGET_SCORE) !== (seat === result.winner))) {
      problems.push('result: the winner, and nobody else, must have reached the target score');
    }
    if (lastHand === null || lastHand.winner !== result.winner) {
      problems.push('result: a match won by score ends with a hand won by the match winner');
    }
  }

  if (phase === 'deal' && players[state.dealer].removed) problems.push('dealer: a removed player cannot deal');
  if (hand === null ? state.handNumber !== 0 || playing : hand.number !== state.handNumber) {
    problems.push('hand: must be the hand counted by handNumber, and present while playing');
  }

  const finishedHands = playing ? state.handNumber - 1 : state.handNumber;
  if (finishedHands <= 0 ? lastHand !== null : lastHand === null || lastHand.hand !== finishedHands) {
    problems.push('lastHand: must describe the most recently finished hand');
  }
  if (lastHand !== null) {
    const scored = lastHand.winner !== null;
    const valueOk = scored ? LADDER.includes(lastHand.value) : lastHand.value === 0;
    if (scored === (lastHand.reason === 'allTied') || !valueOk) {
      problems.push('lastHand: winner, value and reason disagree');
    }
  }
  return problems;
}

/**
 * What holds for any hand, in progress or finished: seating, rounds and the 40 cards.
 * @param {MatchState} state
 * @param {HandState} hand
 * @returns {string[]}
 */
function handProblems(state, hand) {
  /** @type {string[]} */
  const problems = [];
  const seats = state.players.length;
  const { dealtIn, alive, rounds, current } = hand;
  /**
   * Whether `list` follows the playing order that starts at `start`, without repeats.
   * @param {readonly number[]} list
   * @param {number} start
   */
  const inPlayingOrder = (list, start) => list.every((seat, index) => index === 0
    || (list[index - 1] - start + seats) % seats < (seat - start + seats) % seats);

  if (hand.manilha !== manilhaRank(hand.vira)) problems.push('hand.manilha: must follow the vira');
  if (!LADDER.includes(hand.value)) problems.push('hand.value: must be a step of the ladder');
  if ((hand.lastRaiser === null) !== (hand.value === LADDER[0])) {
    problems.push('hand.lastRaiser: must be set exactly when the hand was raised');
  }
  if (hand.lastRaiser !== null && !dealtIn.includes(hand.lastRaiser)) {
    problems.push('hand.lastRaiser: must have been dealt in');
  }
  if (dealtIn.length < MIN_PLAYERS || !inPlayingOrder(dealtIn, dealtIn[0])) {
    problems.push('hand.dealtIn: expected at least 2 distinct seats in playing order');
    return problems;
  }
  if (!alive.every((seat) => dealtIn.includes(seat)) || !inPlayingOrder(alive, dealtIn[0])) {
    problems.push('hand.alive: expected dealt-in seats, in deal order, without repeats');
  }
  if (rounds.length > HAND_SIZE || (current !== null && rounds.length >= HAND_SIZE)) {
    problems.push(`hand.rounds: a hand has at most ${HAND_SIZE} rounds`);
  }

  // Walk the rounds in order. `eligible` are the seats that were in the hand when the round started (those
  // with a counting card in the previous round) and `leader` is who had to open it.
  let eligible = dealtIn;
  let leader = dealtIn[0];
  /**
   * @param {string} label
   * @param {OpenRound} round
   */
  const checkRound = (label, round) => {
    if (round.leader !== leader) problems.push(`${label}.leader: expected seat ${leader}`);
    const played = round.plays.map((play) => play.seat);
    if (!played.every((seat) => eligible.includes(seat)) || !inPlayingOrder(played, round.leader)) {
      problems.push(`${label}.plays: expected one card per player in the hand, in playing order`);
    }
  };
  rounds.forEach((round, index) => {
    const label = `hand.rounds[${index}]`;
    checkRound(label, round);
    const counting = round.plays.filter((play) => !play.voided).map((play) => play.seat);
    if (counting.length < MIN_PLAYERS) problems.push(`${label}.plays: a closed round has at least 2 counting cards`);
    if (!alive.every((seat) => counting.includes(seat))) {
      problems.push(`${label}.plays: everyone still in the hand must have a counting card`);
    }
    if (round.winner !== roundWinner(round.plays, hand.manilha)) {
      problems.push(`${label}.winner: does not match the cards played`);
    }
    eligible = counting;
    // Counting plays are in playing order from the old leader, so the first one is who leads after a tie.
    leader = round.winner ?? counting[0];
  });
  if (current !== null) {
    checkRound('hand.current', current);
    if (current.plays.some((play) => play.voided === alive.includes(play.seat))) {
      problems.push('hand.current.plays: a card is voided exactly when its player left the hand');
    }
  }

  hand.cards.forEach((held, seat) => {
    const playedNow = current !== null && current.plays.some((play) => play.seat === seat);
    const expected = alive.includes(seat) ? HAND_SIZE - rounds.length - (playedNow ? 1 : 0) : 0;
    if (held.length !== expected) problems.push(`hand.cards[${seat}]: expected ${expected} cards, found ${held.length}`);
  });
  const table = [...rounds, ...(current === null ? [] : [current])].flatMap((round) => round.plays);
  const everyCard = [hand.vira, ...hand.cards.flat(), ...table.map((play) => play.card), ...hand.discards, ...hand.stock];
  if (everyCard.length !== DECK_SIZE || new Set(everyCard).size !== DECK_SIZE) {
    problems.push('hand: each of the 40 cards must be in exactly one place (vira, hands, table, discards, stock)');
  }
  if (hand.stock.length !== DECK_SIZE - 1 - HAND_SIZE * dealtIn.length) {
    problems.push('hand.stock: must hold every card that was not dealt');
  }
  return problems;
}

/**
 * What holds while the hand is being played (phases 'play' and 'truco').
 * @param {MatchState} state
 * @param {HandState} hand
 * @returns {string[]}
 */
function liveHandProblems(state, hand) {
  /** @type {string[]} */
  const problems = [];
  const seats = state.players.length;
  const { dealtIn, alive, current, raise } = hand;
  const winners = hand.rounds.map((round) => round.winner);

  if (alive.length < MIN_PLAYERS) problems.push('hand.alive: a hand in progress has at least 2 players');
  if (alive.some((seat) => state.players[seat].removed)) problems.push('hand.alive: removed players cannot be in the hand');
  if (dealtIn[dealtIn.length - 1] !== state.dealer) problems.push('dealer: must be the last seat dealt in');

  if (current === null) {
    problems.push('hand.current: a hand in progress has a round in progress');
  } else {
    const waiting = alive
      .filter((seat) => !current.plays.some((play) => play.seat === seat))
      .sort((a, b) => (a - current.leader + seats) % seats - (b - current.leader + seats) % seats);
    if (waiting.length === 0) problems.push('hand.current: everyone played but the round was not closed');
    else if (hand.turn !== waiting[0]) problems.push(`hand.turn: expected seat ${waiting[0]}`);
  }

  if (state.phase === 'play') {
    if (raise !== null) problems.push('hand.raise: a raise can only be pending in the truco phase');
    if (decideHand(alive, winners) !== null) problems.push('hand: already decided but still being played');
  } else if (raise === null) {
    problems.push('hand.raise: the truco phase needs a pending raise');
  } else {
    problems.push(...raiseProblems(state, hand, raise));
  }
  return problems;
}

/**
 * @param {MatchState} state
 * @param {HandState} hand
 * @param {RaiseState} raise
 * @returns {string[]}
 */
function raiseProblems(state, hand, raise) {
  /** @type {string[]} */
  const problems = [];
  const { alive, dealtIn } = hand;
  const answered = raise.answers.map((answer) => answer.seat);
  // Responders removed from the match while the raise is pending: out of the hand, counted as runners.
  const departed = raise.answers.filter((answer) => !alive.includes(answer.seat));

  if (raise.caller !== hand.turn) problems.push('hand.raise.caller: must be the player whose turn it is');
  if (raise.value !== nextValue(hand.value)) problems.push('hand.raise.value: must be the next step of the ladder');
  if (raise.caller === hand.lastRaiser) problems.push('hand.raise.caller: nobody raises twice in a row');
  if (state.players[raise.caller].score === TARGET_SCORE - 1) {
    problems.push('hand.raise.caller: nobody raises with 11 points');
  }
  if (new Set(answered).size !== answered.length || answered.includes(raise.caller)
    || !answered.every((seat) => dealtIn.includes(seat))) {
    problems.push('hand.raise.answers: expected at most one answer per responder');
  }
  if (departed.some((answer) => answer.accept || !state.players[answer.seat].removed)) {
    problems.push('hand.raise.answers: only removed players answer from outside the hand, and they run');
  }
  if (alive.every((seat) => seat === raise.caller || answered.includes(seat))) {
    problems.push('hand.raise: every answer is in but the raise was not resolved');
  }
  const aliveAtCall = [...alive, ...departed.map((answer) => answer.seat)];
  if (decideHand(aliveAtCall, hand.rounds.map((round) => round.winner)) !== null) {
    problems.push('hand: was already decided when the raise was called');
  }
  return problems;
}

/**
 * What holds for the hand kept on display between hands and after the match.
 * @param {MatchState} state
 * @param {HandState} hand
 * @returns {string[]}
 */
function finishedHandProblems(state, hand) {
  /** @type {string[]} */
  const problems = [];
  const { lastHand } = state;
  if (hand.turn !== null || hand.raise !== null) problems.push('hand: a finished hand has no turn and no pending raise');
  // A missing or mismatched lastHand was already reported by the match checks.
  if (lastHand === null || lastHand.hand !== hand.number) return problems;

  if (lastHand.winner !== null && lastHand.value !== hand.value) {
    problems.push('lastHand.value: must be the value the hand ended with');
  }
  const verdict = decideHand(hand.alive, hand.rounds.map((round) => round.winner));
  const expectedReason = lastHand.reason === 'allRan' ? 'lastStanding' : lastHand.reason;
  if (verdict === null || verdict.winner !== lastHand.winner || verdict.reason !== expectedReason) {
    problems.push('lastHand: does not match how the hand ended');
  }
  return problems;
}
