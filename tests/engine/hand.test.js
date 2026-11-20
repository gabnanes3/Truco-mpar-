// Rounds, who leads them, and who takes the hand (spec 2.1), played out card by card.
// Every hand here uses the vira 7o, so Q is the manilha and the order is 4 5 6 7 J K A 2 3 < Qo Qe Qc Qp.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { pendingPlayers } from '../../app/js/engine/game.js';
import { Table } from './helpers.js';

describe('a round', () => {
  it('is played in seat order from its leader, and the strongest card takes it', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '4o 3e 4c', b: '3o 4e 5c', c: '5o 5e 6c' });
    assert.equal(table.hand().turn, 'a');
    assert.deepEqual(table.play('a', '4o'), [{ type: 'cardPlayed', playerId: 'a', card: '4o', round: 0 }]);
    assert.equal(table.hand().turn, 'b');
    table.play('b', '3o');
    assert.equal(table.hand().turn, 'c');
    assert.deepEqual(table.hand().plays, [
      { playerId: 'a', card: '4o', voided: false },
      { playerId: 'b', card: '3o', voided: false },
    ]);
    assert.deepEqual(table.hand().cardCounts, [2, 2, 3]);

    assert.deepEqual(table.play('c', '5o'), [
      { type: 'cardPlayed', playerId: 'c', card: '5o', round: 0 },
      { type: 'roundEnded', round: 0, winner: 'b' },
    ]);
    const hand = table.hand();
    assert.deepEqual(hand.rounds, [{
      leader: 'a',
      winner: 'b',
      plays: [
        { playerId: 'a', card: '4o', voided: false },
        { playerId: 'b', card: '3o', voided: false },
        { playerId: 'c', card: '5o', voided: false },
      ],
    }]);
    assert.deepEqual(hand.plays, []);
    assert.equal(table.state.phase, 'play');
  });

  it('is led by the winner of the previous one, and the order wraps around the table', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e'], { dealer: 'b' });
    table.deal({ c: '4o 4e 4c', d: '5o 5e 5c', e: '6o 6e 6c', a: '3o Ko Ke', b: 'Jo Je Jc' });
    const order = [];
    for (const card of ['4o', '5o', '6o', '3o', 'Jo']) {
      const turn = table.hand().turn ?? '';
      order.push(turn);
      assert.deepEqual(pendingPlayers(table.state), [turn]);
      table.play(turn, card);
    }
    assert.deepEqual(order, ['c', 'd', 'e', 'a', 'b']);
    assert.equal(table.event('roundEnded').winner, 'a');
    assert.equal(table.hand().leader, 'a');

    const second = [];
    for (const card of ['Ko', 'Je', '4e', '5e', '6e']) {
      const turn = table.hand().turn ?? '';
      second.push(turn);
      table.play(turn, card);
    }
    assert.deepEqual(second, ['a', 'b', 'c', 'd', 'e']);
  });

  it('is a tie when the strongest strength is shared; a manilha settles it by suit', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: 'Ko Qo 4c', b: 'Ke Qp 5c', c: '5o Qc 6c' });
    table.plays('a Ko', 'b Ke', 'c 5o');
    assert.equal(table.event('roundEnded').winner, null);
    table.plays('a Qo', 'b Qp', 'c Qc');
    assert.equal(table.event('roundEnded').winner, 'b');
  });
});

describe('who takes the hand (2.1)', () => {
  it('two rounds for the same player end the hand at once', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' });
    table.plays('a 3o', 'b 4o', 'c 5o');
    assert.equal(table.hand().leader, 'a');
    table.plays('a 3e', 'b 4e');
    assert.deepEqual(table.play('c', '5e'), [
      { type: 'cardPlayed', playerId: 'c', card: '5e', round: 1 },
      { type: 'roundEnded', round: 1, winner: 'a' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'rounds' },
    ]);

    assert.equal(table.state.phase, 'deal');
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [1, 0, 0]);
    assert.deepEqual(table.view(null).lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
    assert.deepEqual(pendingPlayers(table.state), []);
    // The finished hand stays on display until the next deal: no third round was played.
    const hand = table.hand('a');
    assert.equal(hand.rounds.length, 2);
    assert.equal(hand.turn, null);
    assert.equal(hand.leader, null);
    assert.deepEqual(hand.plays, []);
    assert.deepEqual(hand.myCards, ['4c']);
    assert.deepEqual(hand.cardCounts, [1, 1, 1]);
    assert.equal(hand.canRaise, false);
  });

  it('first round tied → whoever takes the second', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '3e 5e 5c', c: '4o 6c 6e' });
    table.plays('a 3o', 'b 3e', 'c 4o');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.state.phase, 'play');
    table.plays('a 4e', 'b 5e', 'c 6c');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'c', value: 1, reason: 'rounds' });
    assert.equal(table.hand().rounds.length, 2);
  });

  it('second round tied → whoever took the first', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '4o 2e 5c', c: '5o 2c 6c' });
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 4e', 'b 2e', 'c 2c');
    assert.equal(table.event('roundEnded').winner, null);
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'rounds' });
  });

  it('three different winners → the winner of the first round', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e 3c' });
    table.plays('a 3o', 'b 6o', 'c 5o');
    assert.equal(table.event('roundEnded').winner, 'a');
    table.plays('a 4e', 'b 3e', 'c 5e');
    assert.equal(table.event('roundEnded').winner, 'b');
    assert.equal(table.state.phase, 'play', 'one round each: the hand goes on');
    assert.equal(table.hand().leader, 'b');
    table.plays('b 4p', 'c 3c', 'a 4c');
    assert.equal(table.event('roundEnded').winner, 'c');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'rounds' });
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [1, 0, 0]);
    assert.deepEqual(table.hand().rounds.map((round) => round.winner), ['a', 'b', 'c']);
  });

  it('one round each and the third tied → the winner of the first round', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 2c', b: '6o 3e 2p', c: '5o 5e 4c' });
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 2p', 'c 4c', 'a 2c');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.event('handEnded').winner, 'a');
  });

  it('one round each → whoever takes the third', () => {
    const second = new Table(['a', 'b', 'c']);
    second.deal({ a: '3o 4e 4c', b: '6o 3e 3c', c: '5o 5e 5c' });
    second.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 3c', 'c 5c', 'a 4c');
    assert.equal(second.event('handEnded').winner, 'b');

    const first = new Table(['a', 'b', 'c']);
    first.deal({ a: '3o 4e 3c', b: '6o 3e 4p', c: '5o 5e 5c' });
    first.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p', 'c 5c', 'a 3c');
    assert.equal(first.event('handEnded').winner, 'a');
  });

  it('two ties → whoever takes the third', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 2o 4c', b: '3e 2e 5c', c: '4o 4e 6c' });
    table.plays('a 3o', 'b 3e', 'c 4o', 'a 2o', 'b 2e', 'c 4e');
    assert.equal(table.state.phase, 'play', 'two ties: the hand goes on');
    table.plays('a 4c', 'b 5c', 'c 6c');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'c', value: 1, reason: 'rounds' });
  });

  it('three ties → nobody scores, and the match simply goes on', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 2o Ao', b: '3e 2e Ae', c: '4o 4e 4c' });
    table.plays('a 3o', 'b 3e', 'c 4o', 'a 2o', 'b 2e', 'c 4e', 'a Ao', 'b Ae');
    assert.deepEqual(table.play('c', '4c'), [
      { type: 'cardPlayed', playerId: 'c', card: '4c', round: 2 },
      { type: 'roundEnded', round: 2, winner: null },
      { type: 'handEnded', hand: 1, winner: null, value: 0, reason: 'allTied' },
    ]);
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [0, 0, 0]);
    assert.deepEqual(table.view(null).lastHand, { hand: 1, winner: null, value: 0, reason: 'allTied' });
    assert.equal(table.state.phase, 'deal');
    assert.equal(table.view(null).dealer, 'a');

    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' });
    assert.equal(table.hand().number, 2);
    assert.equal(table.hand().turn, 'b');
  });

  it('a finished hand takes no more cards and no raises', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' });
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');
    assert.equal(table.state.phase, 'deal');
    table.fail({ type: 'play', playerId: 'a', card: '4c' }, 'wrong-phase');
    table.fail({ type: 'truco', playerId: 'a' }, 'wrong-phase');
    table.fail({ type: 'respond', playerId: 'b', accept: true }, 'wrong-phase');
  });

  it('three ties after a raise → still nobody scores', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 2o Ao', b: '3e 2e Ae' });
    table.truco('a');
    table.accept('b');
    table.plays('a 3o', 'b 3e', 'a 2o', 'b 2e', 'a Ao', 'b Ae');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: null, value: 0, reason: 'allTied' });
    assert.deepEqual([table.score('a'), table.score('b')], [0, 0]);
  });
});

describe('rounds won by a player who left the hand', () => {
  it('count as rounds without a winner: the next round decides', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e 3c' });
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e');
    table.truco('b');
    table.run('a');
    table.accept('c');
    // a took the first round and ran: that round now has no winner, so the hand is still open...
    assert.equal(table.state.phase, 'play');
    assert.deepEqual(table.hand().rounds.map((round) => round.winner), ['a'], 'history is kept');
    assert.deepEqual(table.hand().ran, ['a']);
    table.plays('b 3e', 'c 5e');
    // ...and b, taking the second, wins exactly as after a tied first round.
    assert.equal(table.event('roundEnded').winner, 'b');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'rounds' });
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [0, 3, 0]);
  });

  it('can decide the hand the moment that player leaves', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e 3c' });
    table.plays('a 3o', 'b 6o', 'c 5o', 'a 4e', 'b 3e', 'c 5e', 'b 4p');
    table.truco('c');
    table.accept('b');
    // One round for a, one for b. When a runs, only b's round still counts.
    assert.deepEqual(table.do({ type: 'respond', playerId: 'a', accept: false }), [
      { type: 'trucoAnswered', playerId: 'a' },
      { type: 'trucoResolved', caller: 'c', accepted: ['b'], ran: ['a'], value: 3 },
      { type: 'playerLeftHand', playerId: 'a', reason: 'ran' },
      { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'rounds' },
    ]);
    assert.equal(table.score('b'), 3);
    assert.equal(table.hand().rounds.length, 2, 'the third round was never finished');
    assert.deepEqual(table.hand().plays, [{ playerId: 'b', card: '4p', voided: false }]);
  });

  it('can leave a hand with no winner at all', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal({ a: '3o 4e 4c', b: '6o 3e 4p', c: '5o 5e Kc', d: '6e 6c Ke' });
    table.plays('a 3o', 'b 6o', 'c 5o', 'd 6e', 'a 4e', 'b 3e', 'c 5e', 'd 6c', 'b 4p');
    table.truco('c');
    table.accept('d');
    table.run('a', 'b');
    // Both round winners are gone: for c and d it is as if the first two rounds had tied.
    assert.equal(table.state.phase, 'play');
    assert.deepEqual(table.hand().alive, ['c', 'd']);
    table.plays('c Kc', 'd Ke');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: null, value: 0, reason: 'allTied' });
    assert.deepEqual(['a', 'b', 'c', 'd'].map((id) => table.score(id)), [0, 0, 0, 0]);
  });

});

describe('who leads the next round', () => {
  it('the winner of the round', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '4o 4e 4c', b: '5o 5e 5c', c: '6o 3e 3c' });
    table.plays('a 4o', 'b 5o', 'c 6o');
    assert.equal(table.hand().leader, 'c');
    assert.equal(table.hand().turn, 'c');
    table.fail({ type: 'play', playerId: 'a', card: '4e' }, 'not-your-turn');
    table.play('c', '3e');
    assert.equal(table.hand().turn, 'a', 'after seat c the order wraps to seat a');
  });

  it('after a tie, the player who led the tied round', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'a' });
    table.deal({ b: '4o 2o 4c', c: '3o 2e 5c', a: '3e 5o 6c' });
    assert.equal(table.hand().leader, 'b');
    table.plays('b 4o', 'c 3o', 'a 3e');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.hand().leader, 'b');
    assert.equal(table.hand().turn, 'b');
    // A second tie: the same player leads once more.
    table.plays('b 2o', 'c 2e', 'a 5o');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.hand().leader, 'b');
    assert.equal(table.hand().turn, 'b');
  });

  it('after a tie whose leader ran, the next player in seat order still in the hand', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal({ a: 'Ko 4e 4c', b: '3o 5e 5c', c: '3e 6e 6c', d: '4o 2e 2c' });
    table.plays('a Ko', 'b 3o', 'c 3e');
    table.truco('d');
    table.run('a');
    table.accept('b', 'c');
    table.play('d', '4o');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.hand().leader, 'b');
    assert.equal(table.hand().turn, 'b');
    table.plays('b 5e', 'c 6e', 'd 2e');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'd', value: 3, reason: 'rounds' });
  });

  it('after a tie whose leader was removed, the next player in seat order, wrapping around', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'b' });
    table.deal({ c: '3o 4o 4e', a: '3e 5o 5e', b: '3c 6o 6e' });
    table.plays('c 3o', 'a 3e');
    table.remove('c');
    assert.equal(table.hand().turn, 'b');
    table.play('b', '3c');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.hand().leader, 'a');
    assert.equal(table.hand().turn, 'a');
  });

  it('after a tie whose leader and the following player both left, the one after them', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e']);
    table.deal({ a: 'Ko 4e 4c', b: 'Ke 5e 5c', c: '3o 6e 6c', d: '3e 2e 2c', e: '4o Ao Ae' });
    table.plays('a Ko', 'b Ke', 'c 3o', 'd 3e');
    table.truco('e');
    table.run('a', 'b');
    table.accept('c', 'd');
    table.play('e', '4o');
    assert.equal(table.event('roundEnded').winner, null);
    assert.equal(table.hand().leader, 'c');
    assert.equal(table.hand().turn, 'c');
  });
});

describe('who leads after a tie when the tied round was led by a previous winner who left', () => {
  it('is the next player in seat order after that leader, not the first player of the hand', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal({ a: '4o 2e 5e', b: '5o 4e 6e', c: '3o Ko 4c', d: '6o 2o 5c' });
    table.plays('a 4o', 'b 5o', 'c 3o', 'd 6o');
    assert.equal(table.event('roundEnded').winner, 'c');
    // c opens the second round and then runs from d's truco.
    table.play('c', 'Ko');
    table.truco('d');
    table.accept('a', 'b');
    table.run('c');
    table.plays('d 2o', 'a 2e', 'b 4e');
    assert.equal(table.event('roundEnded').winner, null);
    // Neither round has a winner in the hand any more, so it goes on, led by the seat after c.
    assert.equal(table.state.phase, 'play');
    assert.equal(table.hand().leader, 'd');
    assert.equal(table.hand().turn, 'd');
    table.plays('d 5c', 'a 5e', 'b 6e');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'rounds' });
  });
});

describe('whose turn it is when players leave', () => {
  it('skips everyone who left, and the round ends when the players still in the hand have played', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e'], { dealer: 'b' });
    table.deal({ c: '4o 4e 4c', d: '5o 5e 5c', e: '6o 6e 6c', a: 'Jo Je Jc', b: 'Ko Ke Kc' });
    table.play('c', '4o');
    table.truco('d');
    table.run('e', 'b');
    table.accept('a', 'c');
    assert.equal(table.hand().turn, 'd', 'the caller still has to play');
    table.play('d', '5o');
    assert.equal(table.hand().turn, 'a', 'e ran: the turn jumps over that seat');
    assert.deepEqual(table.play('a', 'Jo'), [
      { type: 'cardPlayed', playerId: 'a', card: 'Jo', round: 0 },
      { type: 'roundEnded', round: 0, winner: 'a' },
    ]);
    // Second round, led by a: b is out, so the order is a, c, d.
    const order = [];
    for (const card of ['Je', '4e', '5e']) {
      const turn = table.hand().turn ?? '';
      order.push(turn);
      table.play(turn, card);
    }
    assert.deepEqual(order, ['a', 'c', 'd']);
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 3, reason: 'rounds' });
  });
});
