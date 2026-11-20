// checkInvariants is what the simulation and the host lean on to notice a broken state, so every single
// rule it enforces is exercised here by breaking a healthy state in exactly one way.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { checkInvariants } from '../../app/js/engine/game.js';
import { Table, jsonCopy } from './helpers.js';

/** @typedef {import('../../app/js/engine/types.js').MatchState} MatchState */
/** @typedef {import('../../app/js/engine/types.js').HandState} HandState */

const THREE = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' };
const FOUR = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc' };
const ONE_ROUND_EACH = { a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e 3c' };

/** Healthy states to start from, one per kind of situation. */
const BASES = {
  /** Three players, nothing dealt yet. */
  fresh: () => new Table(['a', 'b', 'c']).state,
  /** Four players; d ran from an accepted truco; one round closed (won by a) and a has opened the second. */
  mid: () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    table.accept('b', 'c');
    table.run('d');
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e');
    return table.state;
  },
  /** Four players, d removed before the deal, so seat 3 is not in the hand; value 3 raised by a. */
  short: () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'c' });
    table.remove('d');
    table.deal(THREE);
    table.truco('a');
    table.accept('b', 'c');
    return table.state;
  },
  /** One round each for a and b; b has opened the third and c is to play. */
  oneEach: () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(ONE_ROUND_EACH);
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p');
    return table.state;
  },
  /** Four players; a played, b called truco, c accepted; a and d still owe an answer. */
  raise: () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.play('a', '3o');
    table.truco('b');
    table.accept('c');
    return table.state;
  },
  /** As oneEach, but c has called truco and a and b owe an answer. */
  oneEachRaise: () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(ONE_ROUND_EACH);
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p');
    table.truco('c');
    return table.state;
  },
  /** Three players, first hand won by a with two rounds; waiting for the next deal. */
  between: () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');
    return table.state;
  },
  /** Three players, a reached 12. */
  over: () => {
    const table = new Table(['a', 'b', 'c']);
    table.setScores({ a: 11 });
    table.deal(THREE);
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');
    return table.state;
  },
  /** Two players, b left during the first hand. */
  abandoned: () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.remove('b');
    return table.state;
  },
};

/**
 * @param {MatchState} state
 * @returns {HandState}
 */
function handOf(state) {
  if (state.hand === null) assert.fail('this base has no hand');
  return state.hand;
}

/**
 * One way of breaking a healthy state, and the violation that must report it.
 * @typedef {[violation: string, base: keyof typeof BASES, breakIt: (state: any, hand: any) => void]} Breakage
 */

/** @type {Breakage[]} */
const BREAKAGES = [
  // ------------------------------------------------------------------------------------------- shape
  ['state: expected a plain object', 'fresh', (s) => { s.extra = 1; }],
  ['state: expected a plain object', 'fresh', (s) => { delete s.result; }],
  ['players: expected a list', 'fresh', (s) => { s.players = 'abc'; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0] = null; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0].score = -1; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0].score = 1.5; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0].score = '0'; }],
  ['players: expected a list', 'fresh', (s) => { delete s.players[1].name; }],
  ['players: expected a list', 'fresh', (s) => { s.players[1].id = 7; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0].removed = 0; }],
  ['players: expected a list', 'fresh', (s) => { s.players[0].secret = 'x'; }],
  ['phase: unknown phase', 'fresh', (s) => { s.phase = 'paused'; }],
  ['phase: unknown phase', 'fresh', (s) => { s.phase = 0; }],
  ['dealer: expected a seat', 'fresh', (s) => { s.dealer = 3; }],
  ['dealer: expected a seat', 'fresh', (s) => { s.dealer = -1; }],
  ['dealer: expected a seat', 'fresh', (s) => { s.dealer = '0'; }],
  ['dealer: expected a seat', 'fresh', (s) => { s.dealer = 0.5; }],
  ['handNumber: expected', 'fresh', (s) => { s.handNumber = -1; }],
  ['handNumber: expected', 'fresh', (s) => { s.handNumber = '0'; }],
  ['lastHand: expected null or', 'between', (s) => { s.lastHand = {}; }],
  ['lastHand: expected null or', 'between', (s) => { s.lastHand.reason = 'luck'; }],
  ['lastHand: expected null or', 'between', (s) => { s.lastHand.winner = 3; }],
  ['lastHand: expected null or', 'between', (s) => { s.lastHand.value = -1; }],
  ['lastHand: expected null or', 'between', (s) => { s.lastHand = undefined; }],
  ['result: expected null or', 'over', (s) => { s.result.winner = 3; }],
  ['result: expected null or', 'over', (s) => { s.result.reason = 'draw'; }],
  ['result: expected null or', 'over', (s) => { s.result = ['a', 'score']; }],
  ['result: expected null or', 'mid', (s) => { s.result = undefined; }],
  ['hand: expected null or a plain object', 'mid', (s) => { s.hand = []; }],
  ['hand: expected null or a plain object', 'mid', (s) => { s.hand = undefined; }],
  ['hand: expected null or a plain object', 'mid', (s, h) => { h.dealer = 3; }],
  ['hand: expected null or a plain object', 'mid', (s, h) => { delete h.stock; }],
  ['hand.number: expected', 'mid', (s, h) => { h.number = -1; }],
  ['hand.vira: expected a card', 'mid', (s, h) => { h.vira = 'zz'; }],
  ['hand.manilha: expected a rank', 'mid', (s, h) => { h.manilha = 5; }],
  ['hand.value: expected a number', 'mid', (s, h) => { h.value = '3'; }],
  ['hand.lastRaiser: expected a seat or null', 'mid', (s, h) => { h.lastRaiser = 4; }],
  ['hand.dealtIn: expected a list of seats', 'mid', (s, h) => { h.dealtIn = '0123'; }],
  ['hand.dealtIn: expected a list of seats', 'mid', (s, h) => { h.dealtIn[3] = 4; }],
  ['hand.alive: expected a list of seats', 'mid', (s, h) => { h.alive[1] = 1.5; }],
  ['hand.cards: expected one list of cards per seat', 'mid', (s, h) => { h.cards.pop(); }],
  ['hand.cards: expected one list of cards per seat', 'mid', (s, h) => { h.cards[0] = '4c'; }],
  ['hand.cards: expected one list of cards per seat', 'mid', (s, h) => { h.cards[0] = ['4x']; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds = {}; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds[0].winner = 4; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { delete h.rounds[0].leader; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds[0].plays[0].seat = 4; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds[0].plays[0].card = '1o'; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds[0].plays[0].voided = 'no'; }],
  ['hand.rounds: expected a list of', 'mid', (s, h) => { h.rounds[0].plays[0].playerId = 'a'; }],
  ['hand.current: expected null or', 'mid', (s, h) => { h.current = { leader: 0 }; }],
  ['hand.current: expected null or', 'mid', (s, h) => { h.current.plays = [{ seat: 0 }]; }],
  ['hand.current: expected null or', 'mid', (s, h) => { h.current.winner = null; }],
  ['hand.turn: expected a seat or null', 'mid', (s, h) => { h.turn = 4; }],
  ['hand.turn: expected a seat or null', 'mid', (s, h) => { h.turn = 'b'; }],
  ['hand.raise: expected null or', 'raise', (s, h) => { h.raise = {}; }],
  ['hand.raise: expected null or', 'raise', (s, h) => { h.raise.caller = 4; }],
  ['hand.raise: expected null or', 'raise', (s, h) => { h.raise.value = '3'; }],
  ['hand.raise: expected null or', 'raise', (s, h) => { h.raise.answers = [{ seat: 2 }]; }],
  ['hand.raise: expected null or', 'raise', (s, h) => { h.raise.answers[0].accept = 'yes'; }],
  ['hand.discards: expected a list of cards', 'mid', (s, h) => { h.discards = [null]; }],
  ['hand.stock: expected a list of cards', 'mid', (s, h) => { h.stock = 'deck'; }],

  // ------------------------------------------------------------------------------------------- match
  ['players: a match has 2 to 7 seats', 'fresh', (s) => { s.players.length = 1; s.dealer = 0; }],
  ['players: a match has 2 to 7 seats', 'fresh', (s) => { while (s.players.length < 8) s.players.push({ ...s.players[0], id: `x${s.players.length}` }); }],
  ['players: ids must be non-empty and distinct', 'fresh', (s) => { s.players[1].id = s.players[0].id; }],
  ['players: ids must be non-empty and distinct', 'fresh', (s) => { s.players[2].id = ''; }],
  ['players: no score can exceed 23', 'fresh', (s) => { s.players[0].score = 24; }],
  ['result: must be set exactly when the match is over', 'fresh', (s) => { s.phase = 'over'; }],
  ['result: must be set exactly when the match is over', 'over', (s) => { s.phase = 'deal'; }],
  ['result: must be set exactly when the match is over', 'over', (s) => { s.result = null; }],
  ['players: a running match needs 2 players', 'fresh', (s) => { s.players[0].removed = true; s.players[1].removed = true; }],
  ['players: a running match cannot have a score at the target', 'fresh', (s) => { s.players[1].score = 12; }],
  ['result: an abandoned match is won by the only player left', 'abandoned', (s) => { s.players[1].removed = false; }],
  ['result: an abandoned match is won by the only player left', 'abandoned', (s) => { s.result.winner = 1; }],
  ['result: with a single player left the reason must be abandon', 'over', (s) => { s.players[1].removed = true; s.players[2].removed = true; }],
  ['result: the winner, and nobody else, must have reached the target score', 'over', (s) => { s.players[0].score = 11; }],
  ['result: the winner, and nobody else, must have reached the target score', 'over', (s) => { s.players[1].score = 12; }],
  ['result: the winner, and nobody else, must have reached the target score', 'over', (s) => { s.result.winner = 1; }],
  ['result: a match won by score ends with a hand won by the match winner', 'over', (s) => { s.lastHand.winner = 1; }],
  ['dealer: a removed player cannot deal', 'between', (s) => { s.players[s.dealer].removed = true; }],
  ['hand: must be the hand counted by handNumber', 'mid', (s) => { s.handNumber = 2; }],
  ['hand: must be the hand counted by handNumber', 'mid', (s) => { s.hand = null; }],
  ['hand: must be the hand counted by handNumber', 'fresh', (s) => { s.handNumber = 3; }],
  ['hand: must be the hand counted by handNumber', 'fresh', (s) => { s.phase = 'play'; }],
  ['lastHand: must describe the most recently finished hand', 'between', (s) => { s.lastHand = null; }],
  ['lastHand: must describe the most recently finished hand', 'between', (s) => { s.lastHand.hand = 2; }],
  ['lastHand: must describe the most recently finished hand', 'mid', (s) => { s.lastHand = { hand: 1, winner: 0, value: 1, reason: 'rounds' }; }],
  ['lastHand: must describe the most recently finished hand', 'fresh', (s) => { s.lastHand = { hand: 0, winner: 0, value: 1, reason: 'rounds' }; }],
  ['lastHand: winner, value and reason disagree', 'between', (s) => { s.lastHand.winner = null; }],
  ['lastHand: winner, value and reason disagree', 'between', (s) => { s.lastHand.reason = 'allTied'; }],
  ['lastHand: winner, value and reason disagree', 'between', (s) => { s.lastHand.value = 2; }],
  ['lastHand: winner, value and reason disagree', 'between', (s) => { s.lastHand.value = 0; }],

  // -------------------------------------------------------------------------------------------- hand
  ['hand.manilha: must follow the vira', 'mid', (s, h) => { h.manilha = 'K'; }],
  ['hand.value: must be a step of the ladder', 'mid', (s, h) => { h.value = 2; }],
  ['hand.lastRaiser: must be set exactly when the hand was raised', 'mid', (s, h) => { h.lastRaiser = null; }],
  ['hand.lastRaiser: must be set exactly when the hand was raised', 'between', (s, h) => { h.lastRaiser = 0; }],
  ['hand.lastRaiser: must have been dealt in', 'short', (s, h) => { h.lastRaiser = 3; }],
  ['hand.dealtIn: expected at least 2 distinct seats in playing order', 'mid', (s, h) => { h.dealtIn = [0]; }],
  ['hand.dealtIn: expected at least 2 distinct seats in playing order', 'mid', (s, h) => { h.dealtIn = [0, 2, 1, 3]; }],
  ['hand.dealtIn: expected at least 2 distinct seats in playing order', 'mid', (s, h) => { h.dealtIn = [0, 1, 1, 3]; }],
  ['hand.alive: expected dealt-in seats, in deal order, without repeats', 'mid', (s, h) => { h.alive = [0, 1, 2, 2]; }],
  ['hand.alive: expected dealt-in seats, in deal order, without repeats', 'mid', (s, h) => { h.alive = [1, 0, 2]; }],
  ['hand.alive: expected dealt-in seats, in deal order, without repeats', 'short', (s, h) => { h.alive = [0, 1, 2, 3]; }],
  ['hand.rounds: a hand has at most 3 rounds', 'mid', (s, h) => { h.rounds.push(h.rounds[0], h.rounds[0], h.rounds[0]); }],
  ['hand.rounds: a hand has at most 3 rounds', 'mid', (s, h) => { h.rounds.push(h.rounds[0], h.rounds[0]); }],
  ['hand.rounds[0].leader: expected seat 0', 'mid', (s, h) => { h.rounds[0].leader = 1; }],
  ['hand.current.leader: expected seat 0', 'mid', (s, h) => { h.current.leader = 2; }],
  ['hand.current.leader: expected seat 1', 'oneEach', (s, h) => { h.current.leader = 0; }],
  ['hand.rounds[0].plays: expected one card per player in the hand, in playing order', 'mid', (s, h) => { h.rounds[0].plays.reverse(); }],
  ['hand.rounds[0].plays: expected one card per player in the hand, in playing order', 'short', (s, h) => { h.current.plays.push({ seat: 3, card: h.stock.pop(), voided: true }); h.rounds.push({ ...h.current, winner: null }); }],
  ['hand.current.plays: expected one card per player in the hand, in playing order', 'mid', (s, h) => { h.current.plays.push({ seat: 3, card: h.discards.pop(), voided: true }); }],
  ['hand.current.plays: expected one card per player in the hand, in playing order', 'mid', (s, h) => { h.current.plays.push({ seat: 0, card: h.cards[0].pop(), voided: false }); }],
  ['hand.rounds[0].plays: a closed round has at least 2 counting cards', 'mid', (s, h) => { h.rounds[0].plays[1].voided = true; h.rounds[0].plays[2].voided = true; }],
  ['hand.rounds[0].plays: everyone still in the hand must have a counting card', 'mid', (s, h) => { h.rounds[0].plays[2].voided = true; }],
  ['hand.rounds[0].winner: does not match the cards played', 'mid', (s, h) => { h.rounds[0].winner = 1; }],
  ['hand.rounds[0].winner: does not match the cards played', 'mid', (s, h) => { h.rounds[0].winner = null; }],
  ['hand.current.plays: a card is voided exactly when its player left the hand', 'mid', (s, h) => { h.current.plays[0].voided = true; }],
  ['hand.current.plays: a card is voided exactly when its player left the hand', 'mid', (s, h) => { h.alive = [1, 2]; h.discards.push(h.cards[0].pop()); }],
  ['hand.cards[3]: expected 0 cards, found 1', 'mid', (s, h) => { h.cards[3].push(h.discards.pop()); }],
  ['hand.cards[1]: expected 2 cards, found 1', 'mid', (s, h) => { h.discards.push(h.cards[1].pop()); }],
  ['hand.cards[0]: expected 1 cards, found 2', 'mid', (s, h) => { h.cards[0].push(h.stock.pop()); }],
  ['hand: each of the 40 cards must be in exactly one place', 'mid', (s, h) => { h.stock[0] = h.vira; }],
  ['hand: each of the 40 cards must be in exactly one place', 'mid', (s, h) => { h.stock.pop(); }],
  ['hand: each of the 40 cards must be in exactly one place', 'mid', (s, h) => { h.discards.push(h.rounds[0].plays[0].card); }],
  ['hand: each of the 40 cards must be in exactly one place', 'mid', (s, h) => { h.cards[1][0] = h.cards[2][0]; }],
  ['hand.stock: must hold every card that was not dealt', 'mid', (s, h) => { h.discards.push(h.stock.pop()); }],

  // --------------------------------------------------------------------------------- hand in progress
  ['hand.alive: a hand in progress has at least 2 players', 'mid', (s, h) => { h.alive = [1]; h.discards.push(...h.cards[0], ...h.cards[2]); h.cards[0] = []; h.cards[2] = []; }],
  ['hand.alive: removed players cannot be in the hand', 'mid', (s) => { s.players[1].removed = true; }],
  ['dealer: must be the last seat dealt in', 'mid', (s) => { s.dealer = 0; }],
  ['hand.current: a hand in progress has a round in progress', 'mid', (s, h) => { h.current = null; }],
  ['hand.current: everyone played but the round was not closed', 'mid', (s, h) => { h.alive = [0]; }],
  ['hand.turn: expected seat 1', 'mid', (s, h) => { h.turn = 2; }],
  ['hand.turn: expected seat 1', 'mid', (s, h) => { h.turn = null; }],
  ['hand.turn: expected seat 1', 'mid', (s, h) => { h.turn = 0; }],
  ['hand.raise: a raise can only be pending in the truco phase', 'mid', (s, h) => { h.raise = { caller: 1, value: 6, answers: [] }; }],
  ['hand: already decided but still being played', 'oneEach', (s, h) => { h.rounds[1].winner = 0; }],
  ['hand: already decided but still being played', 'oneEach', (s, h) => { h.rounds[0].winner = null; }],
  ['hand.raise: the truco phase needs a pending raise', 'raise', (s, h) => { h.raise = null; }],
  ['hand.raise.caller: must be the player whose turn it is', 'raise', (s, h) => { h.raise.caller = 3; }],
  ['hand.raise.value: must be the next step of the ladder', 'raise', (s, h) => { h.raise.value = 6; }],
  ['hand.raise.value: must be the next step of the ladder', 'raise', (s, h) => { h.raise.value = 1; }],
  ['hand.raise.caller: nobody raises twice in a row', 'raise', (s, h) => { h.lastRaiser = 1; h.value = 3; h.raise.value = 6; }],
  ['hand.raise.caller: nobody raises with 11 points', 'raise', (s) => { s.players[1].score = 11; }],
  ['hand.raise.answers: expected at most one answer per responder', 'raise', (s, h) => { h.raise.answers.push({ seat: 2, accept: false }); }],
  ['hand.raise.answers: expected at most one answer per responder', 'raise', (s, h) => { h.raise.answers.push({ seat: 1, accept: true }); }],
  ['hand.raise.answers: expected at most one answer per responder', 'short', (s, h) => { s.phase = 'truco'; h.raise = { caller: 0, value: 6, answers: [{ seat: 3, accept: false }] }; h.lastRaiser = 1; }],
  ['hand.raise.answers: only removed players answer from outside the hand, and they run', 'raise', (s, h) => { h.alive = [0, 1, 2]; h.discards.push(...h.cards[3]); h.cards[3] = []; h.raise.answers.push({ seat: 3, accept: false }); }],
  ['hand.raise.answers: only removed players answer from outside the hand, and they run', 'raise', (s, h) => { s.players[3].removed = true; h.alive = [0, 1, 2]; h.discards.push(...h.cards[3]); h.cards[3] = []; h.raise.answers.push({ seat: 3, accept: true }); }],
  ['hand.raise: every answer is in but the raise was not resolved', 'raise', (s, h) => { h.raise.answers.push({ seat: 0, accept: true }, { seat: 3, accept: false }); }],
  ['hand: was already decided when the raise was called', 'oneEachRaise', (s, h) => { h.rounds[1].winner = 0; }],

  // ------------------------------------------------------------------------------------ finished hand
  ['hand: a finished hand has no turn and no pending raise', 'between', (s, h) => { h.turn = 0; }],
  ['hand: a finished hand has no turn and no pending raise', 'between', (s, h) => { h.raise = { caller: 0, value: 3, answers: [] }; }],
  ['lastHand.value: must be the value the hand ended with', 'between', (s, h) => { h.value = 3; h.lastRaiser = 0; }],
  ['lastHand: does not match how the hand ended', 'between', (s) => { s.lastHand.winner = 1; }],
  ['lastHand: does not match how the hand ended', 'between', (s) => { s.lastHand.reason = 'lastStanding'; }],
  ['lastHand: does not match how the hand ended', 'between', (s) => { s.lastHand.reason = 'allRan'; }],
  ['lastHand: does not match how the hand ended', 'abandoned', (s) => { s.lastHand.reason = 'rounds'; }],
];

describe('checkInvariants', () => {
  it('finds nothing wrong with the healthy states the breakages start from', () => {
    for (const [name, build] of Object.entries(BASES)) {
      assert.deepEqual(checkInvariants(build()), [], name);
      assert.deepEqual(checkInvariants(jsonCopy(build())), [], `${name}, after a JSON round trip`);
    }
  });

  it('describes violations as text', () => {
    const state = jsonCopy(BASES.mid());
    handOf(state).turn = 2;
    handOf(state).manilha = 'K';
    assert.deepEqual(checkInvariants(state), ['hand.manilha: must follow the vira', 'hand.turn: expected seat 1']);
  });

  for (const [violation, base, breakIt] of BREAKAGES) {
    const source = breakIt.toString().replace(/^\(s(, h)?\) => \{ ?/, '').replace(/;? ?\}$/, '');
    it(`${base}: ${source}  →  ${violation}`, () => {
      const state = jsonCopy(BASES[base]());
      breakIt(state, state.hand);
      const violations = checkInvariants(state);
      assert.ok(
        violations.some((found) => found.startsWith(violation)),
        `expected a violation starting with "${violation}", got ${JSON.stringify(violations)}`,
      );
    });
  }

  it('reports exactly one violation for a single inconsistency, where the rules do not overlap', () => {
    /** @type {[keyof typeof BASES, (state: any, hand: any) => void][]} */
    const single = [
      ['mid', (s, h) => { h.turn = 2; }],
      ['mid', (s, h) => { h.manilha = 'K'; }],
      ['mid', (s) => { s.dealer = 0; }],
      ['mid', (s, h) => { h.discards.push(h.stock.pop()); }],
      ['raise', (s, h) => { h.raise.value = 6; }],
      ['between', (s, h) => { h.turn = 0; }],
      ['fresh', (s) => { s.players[2].id = ''; }],
    ];
    for (const [base, breakIt] of single) {
      const state = jsonCopy(BASES[base]());
      breakIt(state, state.hand);
      assert.equal(checkInvariants(state).length, 1, breakIt.toString());
    }
  });

  it('rejects anything that is not a state, without throwing', () => {
    class Impostor {
      constructor() {
        Object.assign(this, BASES.fresh());
      }
    }
    const notStates = [
      undefined, null, true, 0, 42, 'state', [], [BASES.fresh()], {}, () => {}, new Map(), new Set(), new Date(0),
      Object.create(null), new Impostor(), JSON.stringify(BASES.fresh()),
    ];
    for (const value of notStates) {
      const violations = checkInvariants(value);
      assert.equal(violations.length, 1);
      assert.ok(violations[0].startsWith('state: expected a plain object'), String(violations[0]));
    }
  });

  it('rejects class instances, Maps and holes hidden inside a state', () => {
    class Seat {
      constructor() {
        this.id = 'a';
        this.name = 'A';
        this.score = 0;
        this.removed = false;
      }
    }
    /** @type {((state: any) => void)[]} */
    const intrusions = [
      (s) => { s.players[0] = new Seat(); },
      (s) => { s.hand = new Map(Object.entries(s.hand)); },
      (s) => { s.hand.stock = new Set(s.hand.stock); },
      (s) => { s.hand.cards = Object.assign({}, s.hand.cards); },
      (s) => { s.hand.cards[0] = [undefined]; },
      (s) => { s.hand.rounds = new Array(1); },
      (s) => { s.hand.turn = undefined; },
      (s) => { s.hand.value = NaN; },
      (s) => { s.players[0].score = Infinity; },
      (s) => { s.handNumber = () => 1; },
    ];
    for (const intrude of intrusions) {
      const state = jsonCopy(BASES.mid());
      intrude(state);
      assert.notDeepEqual(checkInvariants(state), [], intrude.toString());
    }
  });

  it('reports, rather than throws, when the value cannot even be inspected', () => {
    const hostile = { ...BASES.fresh() };
    Object.defineProperty(hostile, 'players', { enumerable: true, get() { throw new Error('boom'); } });
    const violations = checkInvariants(hostile);
    assert.equal(violations.length, 1);
    assert.ok(violations[0].startsWith('state: could not be checked'));
    assert.ok(violations[0].includes('boom'));
  });

  it('does not change the state it checks', () => {
    for (const build of Object.values(BASES)) {
      const state = build();
      const before = JSON.stringify(state);
      checkInvariants(state);
      assert.equal(JSON.stringify(state), before);
    }
  });
});
