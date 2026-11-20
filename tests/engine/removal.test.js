// Removing a player from the match (spec 2.3): kicked or left, for good.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullDeck } from '../../app/js/engine/cards.js';
import { canRaise, defaultAction, pendingPlayers } from '../../app/js/engine/game.js';
import { Table } from './helpers.js';

const THREE = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' };
const FOUR = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc' };
/** One round each for a and b, then b leads the third: see hand.test.js. */
const ONE_ROUND_EACH = { a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e 3c' };

describe('removing a player', () => {
  it('is permanent: the seat stays in the list, flagged, and indices do not move', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    assert.deepEqual(table.remove('b'), [{ type: 'playerRemoved', playerId: 'b' }]);
    assert.deepEqual(table.view(null).players, [
      { id: 'a', name: 'A', score: 0, removed: false },
      { id: 'b', name: 'B', score: 0, removed: true },
      { id: 'c', name: 'C', score: 0, removed: false },
      { id: 'd', name: 'D', score: 0, removed: false },
    ]);
    table.fail({ type: 'remove', playerId: 'b' }, 'already-removed');
    table.fail({ type: 'remove', playerId: 'nobody' }, 'unknown-player');
    assert.equal(table.state.phase, 'deal');
  });

  it('keeps the points the player had', () => {
    const table = new Table(['a', 'b', 'c']);
    table.setScores({ a: 4, b: 7, c: 2 });
    table.remove('b');
    assert.equal(table.score('b'), 7);
  });

  it('between hands leaves the finished hand on display untouched', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');
    const before = table.hand('b');
    table.remove('b');
    assert.deepEqual(table.hand('b'), before);
    assert.deepEqual(table.view(null).lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
  });
});

describe('a player removed during a hand', () => {
  it('leaves the hand: cards discarded, nothing scored, the others play on', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.play('a', '3o');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
    ]);
    assert.equal(table.state.phase, 'play');
    assert.deepEqual(table.hand().alive, ['a', 'b']);
    assert.deepEqual(table.hand().ran, ['c']);
    assert.deepEqual(table.hand().cardCounts, [2, 3, 0]);
    assert.deepEqual(table.hand('c').myCards, []);
    assert.deepEqual([...table.rawHand.discards].sort(), ['5e', '5o', '6c']);
    assert.equal(table.hand().turn, 'b');

    assert.deepEqual(table.play('b', '4o'), [
      { type: 'cardPlayed', playerId: 'b', card: '4o', round: 0 },
      { type: 'roundEnded', round: 0, winner: 'a' },
    ]);
    table.plays('a 3e', 'b 4e');
    assert.equal(table.event('handEnded').winner, 'a');
    assert.equal(table.score('c'), 0);
  });

  it('has the card already played in the unfinished round voided', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.play('a', '3o');
    table.remove('a');
    assert.deepEqual(table.hand().plays, [{ playerId: 'a', card: '3o', voided: true }]);
    assert.equal(table.hand().turn, 'b');
    table.plays('b 4o', 'c 5o');
    assert.equal(table.event('roundEnded').winner, 'c', 'the 3 no longer counts');
  });

  it('passes the turn, when it was theirs, to the next player in the hand who has not played', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.play('a', '3o');
    assert.equal(table.hand().turn, 'b');
    table.remove('b');
    assert.equal(table.hand().turn, 'c');
    assert.deepEqual(pendingPlayers(table.state), ['c']);
    table.play('c', '5o');
    table.remove('d');
    // d was the last to play: with d gone the round is complete.
    assert.deepEqual(table.eventTypes, ['playerRemoved', 'playerLeftHand', 'roundEnded']);
    assert.equal(table.event('roundEnded').winner, 'a');
    assert.equal(table.hand().turn, 'a');
  });

  it('passes the turn on even when removed before opening the round', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.remove('a');
    assert.equal(table.hand().turn, 'b');
    table.plays('b 4o', 'c 5o', 'd 6o');
    assert.equal(table.event('roundEnded').winner, 'd');
    assert.deepEqual(table.hand().rounds[0].plays.map((play) => play.playerId), ['b', 'c', 'd']);
  });

  it('wraps the turn around the table', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'a' });
    table.deal({ b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc', a: '3o 3e 4c' });
    table.plays('b 4o', 'c 5o');
    table.remove('d');
    assert.equal(table.hand().turn, 'a');
  });

  it('completes the round when everyone else had already played, and the round is settled normally', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'roundEnded', round: 0, winner: 'a' },
    ]);
    assert.equal(table.hand().rounds.length, 1);
    assert.equal(table.hand().leader, 'a');
    assert.equal(table.hand().turn, 'a');
    assert.equal(table.state.phase, 'play');
  });

  it('can complete the round that decides the hand', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'roundEnded', round: 1, winner: 'a' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'rounds' },
    ]);
    assert.equal(table.state.phase, 'deal');
  });

  it('stops counting as the winner of earlier rounds, which can decide the hand on the spot', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(ONE_ROUND_EACH);
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p');
    // a and b have one round each. Without a, only b's round counts.
    assert.deepEqual(table.remove('a'), [
      { type: 'playerRemoved', playerId: 'a' },
      { type: 'playerLeftHand', playerId: 'a', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'b', value: 1, reason: 'rounds' },
    ]);
    assert.equal(table.score('b'), 1);
  });

  it('leaves the last player standing with the hand, at its current value', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 3, reason: 'lastStanding' },
    ]);
    assert.equal(table.score('a'), 3);
    // b ran from the hand but is still in the match, so the match goes on.
    assert.equal(table.state.phase, 'deal');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.deepEqual(table.hand().dealtIn, ['b', 'a']);
  });

  it('changes nothing in the hand when the player had already run', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    const before = table.hand();
    assert.deepEqual(table.remove('b'), [{ type: 'playerRemoved', playerId: 'b' }]);
    assert.deepEqual(table.hand(), before);
    assert.equal(table.state.phase, 'play');
  });

  it('can no longer act', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.remove('a');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'not-your-turn');
    table.fail({ type: 'truco', playerId: 'a' }, 'not-your-turn');
    assert.equal(canRaise(table.state, 'a'), false);
    assert.equal(defaultAction(table.state, 'a'), null);
    table.truco('b');
    table.fail({ type: 'respond', playerId: 'a', accept: true }, 'not-in-hand');
    assert.deepEqual(pendingPlayers(table.state), ['c', 'd']);
    assert.equal(table.view('a').viewer, 'a');
    assert.equal(table.hand('a').raise?.mustAnswer, false);
  });
});

describe('removing the caller of a pending raise', () => {
  it('cancels the raise: same value, same last raiser, answers thrown away, nobody runs', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.play('a', '3o');
    table.truco('b');
    table.run('a');
    table.accept('c');
    assert.deepEqual(table.remove('b'), [
      { type: 'playerRemoved', playerId: 'b' },
      { type: 'trucoCancelled', caller: 'b' },
      { type: 'playerLeftHand', playerId: 'b', reason: 'removed' },
    ]);
    assert.equal(table.state.phase, 'play');
    const hand = table.hand();
    assert.equal(hand.raise, null);
    assert.equal(hand.value, 1);
    assert.equal(hand.lastRaiser, null);
    assert.deepEqual(hand.alive, ['a', 'c', 'd'], 'a had answered "run", but that answer died with the raise');
    assert.deepEqual(hand.plays, [{ playerId: 'a', card: '3o', voided: false }]);
    assert.deepEqual(hand.cardCounts, [2, 0, 3, 3]);
    assert.equal(hand.turn, 'c', 'the turn was the caller\'s: it moves on');

    // Play resumes as if nothing had been called: the next raise proposes 3 again and everyone answers anew.
    assert.deepEqual(table.truco('c'), [{ type: 'trucoCalled', playerId: 'c', value: 3 }]);
    assert.deepEqual(table.hand('a').raise, {
      caller: 'c', value: 3, waiting: ['a', 'd'], answered: [], mustAnswer: true, myAnswer: null,
    });
  });

  it('keeps the value and the last raiser of an earlier, accepted raise', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.accept('b', 'c');
    table.play('a', '3o');
    table.truco('b');
    table.accept('c');
    table.remove('b');
    assert.equal(table.hand().value, 3);
    assert.equal(table.hand().lastRaiser, 'a');
    assert.equal(table.hand().nextValue, 6);
    assert.equal(table.hand().turn, 'c');
    assert.equal(canRaise(table.state, 'c'), true);
  });

  it('completes the round when the caller was the last one to play', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o');
    table.truco('c');
    table.accept('a');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'trucoCancelled', caller: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'roundEnded', round: 0, winner: 'a' },
    ]);
    assert.equal(table.hand().value, 1);
    assert.equal(table.hand().turn, 'a');
  });

  it('gives the hand to the only player left, at the value before the cancelled raise', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    table.play('a', '3o');
    table.truco('c');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'trucoCancelled', caller: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 3, reason: 'lastStanding' },
    ]);
    assert.equal(table.score('a'), 3);
    assert.equal(table.state.phase, 'deal');
  });
});

describe('removing a responder of a pending raise', () => {
  it('counts as running, and the raise keeps waiting for the other answers', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
    ]);
    assert.equal(table.state.phase, 'truco');
    assert.deepEqual(table.hand().alive, ['a', 'b', 'd']);
    assert.deepEqual(table.hand().raise?.waiting, ['b', 'd']);
    assert.deepEqual(table.hand().raise?.answered, []);
    assert.equal(table.hand().value, 1);

    table.accept('b');
    assert.deepEqual(table.do({ type: 'respond', playerId: 'd', accept: false }), [
      { type: 'trucoAnswered', playerId: 'd' },
      { type: 'trucoResolved', caller: 'a', accepted: ['b'], ran: ['c', 'd'], value: 3 },
      { type: 'playerLeftHand', playerId: 'd', reason: 'ran' },
    ]);
    assert.deepEqual(table.hand().alive, ['a', 'b']);
    assert.equal(table.hand().value, 3);
  });

  it('resolves the raise when it was the last answer missing: accepted by the others', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    table.accept('b', 'c');
    assert.deepEqual(table.remove('d'), [
      { type: 'playerRemoved', playerId: 'd' },
      { type: 'playerLeftHand', playerId: 'd', reason: 'removed' },
      { type: 'trucoResolved', caller: 'a', accepted: ['b', 'c'], ran: ['d'], value: 3 },
    ]);
    assert.equal(table.state.phase, 'play');
    assert.equal(table.hand().value, 3);
    assert.equal(table.hand().lastRaiser, 'a');
    assert.equal(table.hand().turn, 'a');
  });

  it('resolves the raise when it was the last answer missing: nobody accepted', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'trucoResolved', caller: 'a', accepted: [], ran: ['b', 'c'], value: 1 },
      { type: 'playerLeftHand', playerId: 'b', reason: 'ran' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'allRan' },
    ]);
    assert.equal(table.score('a'), 1);
    assert.equal(table.state.phase, 'deal');
  });

  it('turns an answer of "accept" already given into running', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.accept('c');
    table.remove('c');
    assert.equal(table.state.phase, 'truco');
    assert.deepEqual(table.hand().raise?.waiting, ['b']);
    table.run('b');
    // c's acceptance left with c: nobody accepted, so the caller takes the hand at the old value.
    assert.deepEqual(table.event('trucoResolved'), { type: 'trucoResolved', caller: 'a', accepted: [], ran: ['b', 'c'], value: 1 });
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'allRan' });
  });

  it('gives the hand to the caller when the removed player was the only one to answer', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    table.play('a', '3o');
    table.truco('c');
    assert.deepEqual(table.remove('a'), [
      { type: 'playerRemoved', playerId: 'a' },
      { type: 'playerLeftHand', playerId: 'a', reason: 'removed' },
      { type: 'trucoResolved', caller: 'c', accepted: [], ran: ['a'], value: 3 },
      { type: 'handEnded', hand: 1, winner: 'c', value: 3, reason: 'allRan' },
    ]);
    assert.equal(table.score('c'), 3);
    assert.equal(table.state.phase, 'deal');
  });

  it('does not judge the hand before the raise is resolved, even if the removed player held a round', () => {
    const position = () => {
      const table = new Table(['a', 'b', 'c']);
      table.deal(ONE_ROUND_EACH);
      table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p');
      table.truco('c');
      // a and b have one round each. a leaves the match while b still owes an answer.
      assert.deepEqual(table.remove('a'), [
        { type: 'playerRemoved', playerId: 'a' },
        { type: 'playerLeftHand', playerId: 'a', reason: 'removed' },
      ]);
      assert.equal(table.state.phase, 'truco');
      assert.deepEqual(pendingPlayers(table.state), ['b']);
      return table;
    };

    // b accepts: the raise stands, and b, holding the only round that still counts, takes the hand at 3.
    const accepting = position();
    assert.deepEqual(accepting.do({ type: 'respond', playerId: 'b', accept: true }), [
      { type: 'trucoAnswered', playerId: 'b' },
      { type: 'trucoResolved', caller: 'c', accepted: ['b'], ran: ['a'], value: 3 },
      { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'rounds' },
    ]);

    // b runs: nobody accepted, the caller takes the hand at the value before the raise.
    const running = position();
    assert.deepEqual(running.do({ type: 'respond', playerId: 'b', accept: false }), [
      { type: 'trucoAnswered', playerId: 'b' },
      { type: 'trucoResolved', caller: 'c', accepted: [], ran: ['a', 'b'], value: 1 },
      { type: 'playerLeftHand', playerId: 'b', reason: 'ran' },
      { type: 'handEnded', hand: 1, winner: 'c', value: 1, reason: 'allRan' },
    ]);
  });

  it('is forgotten if the caller is removed next: the cancelled raise leaves the hand to be judged as it stands', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal({ ...ONE_ROUND_EACH, d: '4o 6c 6e' });
    table.plays('a 3o', 'b 6o', 'c 5o', 'd 4o', 'a 4e', 'b 3e', 'c 5e', 'd 6c', 'b 4p');
    table.truco('c');
    table.accept('d');
    table.remove('a');
    assert.equal(table.state.phase, 'truco', 'b still owes an answer');
    // The caller goes too. The raise is cancelled, and of the two rounds only b's still has its winner.
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'trucoCancelled', caller: 'c' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'b', value: 1, reason: 'rounds' },
    ]);
    assert.deepEqual(table.hand().alive, ['b', 'd']);
    assert.equal(table.score('b'), 1);
    assert.equal(table.state.phase, 'deal');
  });

  it('is not affected by the removal of someone who had already left the hand', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    table.play('a', '3o');
    table.truco('c');
    assert.deepEqual(table.remove('b'), [{ type: 'playerRemoved', playerId: 'b' }]);
    assert.equal(table.state.phase, 'truco');
    assert.deepEqual(pendingPlayers(table.state), ['a']);
    table.accept('a');
    assert.equal(table.hand().value, 6);
  });
});

describe('fewer than two players left in the match', () => {
  it('ends the match between hands: the remaining player wins by abandon, whatever the score', () => {
    const table = new Table(['a', 'b', 'c']);
    table.setScores({ a: 2, b: 9, c: 5 });
    table.remove('b');
    assert.equal(table.state.phase, 'deal');
    assert.deepEqual(table.remove('c'), [
      { type: 'playerRemoved', playerId: 'c' },
      { type: 'matchEnded', winner: 'a', reason: 'abandon' },
    ]);
    assert.equal(table.state.phase, 'over');
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'abandon' });
    assert.equal(table.score('a'), 2);
    assert.deepEqual(pendingPlayers(table.state), []);
    table.fail({ type: 'deal', deck: fullDeck() }, 'match-over');
  });

  it('ends the match before the first deal', () => {
    const table = new Table(['a', 'b']);
    table.remove('a');
    assert.deepEqual(table.view(null).result, { winner: 'b', reason: 'abandon' });
    assert.equal(table.view(null).hand, null);
    assert.equal(table.view(null).lastHand, null);
  });

  it('ends the match during a hand, after giving that hand to the player left standing', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 0, b: 11 });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.play('a', '3o');
    assert.deepEqual(table.remove('b'), [
      { type: 'playerRemoved', playerId: 'b' },
      { type: 'playerLeftHand', playerId: 'b', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'lastStanding' },
      { type: 'matchEnded', winner: 'a', reason: 'abandon' },
    ]);
    assert.equal(table.score('a'), 1);
    assert.equal(table.score('b'), 11);
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'abandon' });
    assert.equal(table.hand().turn, null);
  });

  it('ends the match when the responder of a pending raise is removed', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.truco('a');
    assert.deepEqual(table.remove('b'), [
      { type: 'playerRemoved', playerId: 'b' },
      { type: 'playerLeftHand', playerId: 'b', reason: 'removed' },
      { type: 'trucoResolved', caller: 'a', accepted: [], ran: ['b'], value: 1 },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'allRan' },
      { type: 'matchEnded', winner: 'a', reason: 'abandon' },
    ]);
    assert.equal(table.hand().raise, null);
  });

  it('ends the match when the caller of a pending raise is removed', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.truco('a');
    assert.deepEqual(table.remove('a'), [
      { type: 'playerRemoved', playerId: 'a' },
      { type: 'trucoCancelled', caller: 'a' },
      { type: 'playerLeftHand', playerId: 'a', reason: 'removed' },
      { type: 'handEnded', hand: 1, winner: 'b', value: 1, reason: 'lastStanding' },
      { type: 'matchEnded', winner: 'b', reason: 'abandon' },
    ]);
  });

  it('is reported as an abandon even when that last hand takes the winner to 12', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 11, b: 3 });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.remove('b');
    assert.equal(table.score('a'), 12);
    assert.deepEqual(table.event('matchEnded'), { type: 'matchEnded', winner: 'a', reason: 'abandon' });
    assert.equal(table.events.filter((event) => event.type === 'matchEnded').length, 1);
  });

  it('counts players, not hands: someone who only ran from the hand keeps the match alive', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    table.accept('c');
    table.remove('a');
    // c takes the hand as the last one standing; b ran but is still in the match.
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'c', value: 3, reason: 'lastStanding' });
    assert.equal(table.state.phase, 'deal');
    assert.equal(table.view(null).result, null);
    table.remove('b');
    assert.deepEqual(table.view(null).result, { winner: 'c', reason: 'abandon' });
  });

  it('applies to matches that started with seven players too', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    table.do({ type: 'deal', deck: fullDeck() });
    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      table.remove(id);
      assert.equal(table.state.phase, 'play');
    }
    assert.deepEqual(table.hand().alive, ['f', 'g']);
    table.remove('g');
    assert.deepEqual(table.view(null).result, { winner: 'f', reason: 'abandon' });
    assert.equal(table.score('f'), 1);
  });
});
