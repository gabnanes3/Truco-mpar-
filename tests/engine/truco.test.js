// Raises (spec 2.2): who may call, the secret simultaneous answers, and what running does to the hand.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apply, canRaise, pendingPlayers, viewFor } from '../../app/js/engine/game.js';
import { Table } from './helpers.js';

const THREE = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' };
const FOUR = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc' };

describe('calling a raise', () => {
  it('climbs the whole ladder 1 → 3 → 6 → 9 → 12, each step called by a different player than the last', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    assert.equal(table.hand().value, 1);
    assert.equal(table.hand().nextValue, 3);
    assert.equal(table.hand().lastRaiser, null);

    assert.deepEqual(table.truco('a'), [{ type: 'trucoCalled', playerId: 'a', value: 3 }]);
    assert.equal(table.state.phase, 'truco');
    assert.equal(table.hand().value, 1, 'the value only changes when somebody accepts');
    table.accept('b', 'c');
    assert.deepEqual(table.event('trucoResolved'), { type: 'trucoResolved', caller: 'a', accepted: ['b', 'c'], ran: [], value: 3 });
    assert.deepEqual([table.hand().value, table.hand().nextValue, table.hand().lastRaiser], [3, 6, 'a']);
    assert.equal(table.state.phase, 'play');
    assert.equal(table.hand().turn, 'a', 'the caller still has to play');
    table.play('a', '3o');

    assert.deepEqual(table.truco('b'), [{ type: 'trucoCalled', playerId: 'b', value: 6 }]);
    table.accept('a', 'c');
    assert.deepEqual([table.hand().value, table.hand().nextValue, table.hand().lastRaiser], [6, 9, 'b']);
    table.play('b', '4o');

    assert.deepEqual(table.truco('c'), [{ type: 'trucoCalled', playerId: 'c', value: 9 }]);
    table.accept('a', 'b');
    assert.deepEqual([table.hand().value, table.hand().nextValue, table.hand().lastRaiser], [9, 12, 'c']);
    table.play('c', '5o');
    assert.equal(table.event('roundEnded').winner, 'a');

    assert.deepEqual(table.truco('a'), [{ type: 'trucoCalled', playerId: 'a', value: 12 }]);
    table.accept('b', 'c');
    assert.deepEqual([table.hand().value, table.hand().nextValue, table.hand().lastRaiser], [12, null, 'a']);
    table.play('a', '3e');

    // At 12 nobody can raise, not even a player who did not make the last raise.
    assert.equal(table.hand().turn, 'b');
    assert.equal(canRaise(table.state, 'b'), false);
    assert.equal(table.hand('b').canRaise, false);
    table.fail({ type: 'truco', playerId: 'b' }, 'raise-at-max');

    table.plays('b 4e', 'c 5e');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 12, reason: 'rounds' });
    assert.equal(table.score('a'), 12);
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'score' });
  });

  it('is not allowed twice in a row for the same player, until somebody else raises', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.truco('a');
    table.accept('b');
    assert.equal(table.hand().turn, 'a');
    assert.equal(canRaise(table.state, 'a'), false);
    assert.equal(table.hand('a').canRaise, false);
    table.fail({ type: 'truco', playerId: 'a' }, 'raise-twice');

    table.plays('a 3o', 'b 4o');
    // New round, a to play again: still the last raiser.
    assert.equal(table.hand().turn, 'a');
    table.fail({ type: 'truco', playerId: 'a' }, 'raise-twice');
    table.play('a', '4c');

    assert.equal(canRaise(table.state, 'b'), true);
    table.truco('b');
    table.accept('a');
    table.fail({ type: 'truco', playerId: 'b' }, 'raise-twice');
    table.play('b', '5c');
    // b took the round and leads: still the last raiser. Once b has played, a may raise again.
    table.fail({ type: 'truco', playerId: 'b' }, 'raise-twice');
    table.play('b', '4e');
    assert.equal(canRaise(table.state, 'a'), true);
    assert.deepEqual(table.truco('a'), [{ type: 'trucoCalled', playerId: 'a', value: 9 }]);
  });

  it('is not allowed with exactly 11 points, but 10 is fine and an 11 may still accept', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 11, b: 10 });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    assert.equal(canRaise(table.state, 'a'), false);
    assert.equal(table.hand('a').canRaise, false);
    table.fail({ type: 'truco', playerId: 'a' }, 'raise-at-eleven');

    table.play('a', '3o');
    assert.equal(canRaise(table.state, 'b'), true);
    assert.equal(table.hand('b').canRaise, true);
    table.truco('b');
    table.accept('a');
    assert.equal(table.hand().value, 3);
  });

  it('starts over in every hand: value 1, and the last raiser of the previous hand may raise again', () => {
    const table = new Table(['a', 'b'], { dealer: 'a' });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.play('b', '4o');
    table.truco('a');
    table.accept('b');
    table.plays('a 3o', 'a 3e', 'b 4e');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 3, reason: 'rounds' });

    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    assert.deepEqual([table.hand().value, table.hand().nextValue, table.hand().lastRaiser], [1, 3, null]);
    assert.equal(table.hand().turn, 'a');
    assert.equal(canRaise(table.state, 'a'), true);
    assert.deepEqual(table.truco('a'), [{ type: 'trucoCalled', playerId: 'a', value: 3 }]);
  });

  it('is only possible on your own turn, before playing', () => {
    const table = new Table(['a', 'b', 'c']);
    table.fail({ type: 'truco', playerId: 'a' }, 'wrong-phase');
    table.deal(THREE);
    assert.deepEqual(['a', 'b', 'c'].map((id) => canRaise(table.state, id)), [true, false, false]);
    assert.deepEqual(['a', 'b', 'c'].map((id) => table.hand(id).canRaise), [true, false, false]);
    table.fail({ type: 'truco', playerId: 'b' }, 'not-your-turn');
    table.fail({ type: 'truco', playerId: 'c' }, 'not-your-turn');
    assert.equal(canRaise(table.state, 'nobody'), false);
    table.fail({ type: 'truco', playerId: 'nobody' }, 'unknown-player');

    table.play('a', '3o');
    assert.deepEqual(['a', 'b', 'c'].map((id) => canRaise(table.state, id)), [false, true, false]);
    table.fail({ type: 'truco', playerId: 'a' }, 'not-your-turn');
  });

  it('is not possible while another raise is waiting for answers', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    for (const id of ['a', 'b', 'c']) {
      assert.equal(canRaise(table.state, id), false);
      assert.equal(table.hand(id).canRaise, false);
      table.fail({ type: 'truco', playerId: id }, 'wrong-phase');
    }
  });

  it('freezes the cards: nobody plays until every answer is in', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'wrong-phase');
    table.fail({ type: 'play', playerId: 'b', card: '4o' }, 'wrong-phase');
    table.accept('b');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'wrong-phase');
    table.accept('c');
    table.play('a', '3o');
  });
});

describe('answering a raise', () => {
  it('is for every other player in the hand, once each, and never for the caller', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.fail({ type: 'respond', playerId: 'b', accept: true }, 'wrong-phase');
    table.truco('a');
    assert.deepEqual(pendingPlayers(table.state), ['b', 'c', 'd']);
    table.fail({ type: 'respond', playerId: 'a', accept: true }, 'own-raise');
    table.fail({ type: 'respond', playerId: 'a', accept: false }, 'own-raise');
    table.fail({ type: 'respond', playerId: 'nobody', accept: true }, 'unknown-player');

    table.accept('c');
    assert.deepEqual(pendingPlayers(table.state), ['b', 'd']);
    table.fail({ type: 'respond', playerId: 'c', accept: true }, 'already-answered');
    table.fail({ type: 'respond', playerId: 'c', accept: false }, 'already-answered');
    table.run('d');
    assert.deepEqual(pendingPlayers(table.state), ['b']);
    assert.equal(table.state.phase, 'truco');
    table.accept('b');
    assert.equal(table.state.phase, 'play');
    assert.deepEqual(pendingPlayers(table.state), ['a']);
  });

  it('is not for players who already left the hand', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    table.run('b');
    table.accept('c', 'd');
    table.play('a', '3o');
    table.truco('c');
    assert.deepEqual(pendingPlayers(table.state), ['a', 'd']);
    table.fail({ type: 'respond', playerId: 'b', accept: true }, 'not-in-hand');
    table.fail({ type: 'respond', playerId: 'b', accept: false }, 'not-in-hand');
    assert.deepEqual(table.hand().raise?.waiting, ['a', 'd']);
  });

  it('stays secret until every answer is in: only who answered is public', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    const accepted = apply(table.state, { type: 'respond', playerId: 'b', accept: true });
    const ran = apply(table.state, { type: 'respond', playerId: 'b', accept: false });
    assert.ok(accepted.ok && ran.ok);

    // The event tells who, not what.
    assert.deepEqual(accepted.events, [{ type: 'trucoAnswered', playerId: 'b' }]);
    assert.deepEqual(ran.events, accepted.events);
    // Nobody else (the caller included) can tell the two worlds apart.
    for (const viewer of ['a', 'c', 'd', null, 'not-a-player']) {
      assert.deepEqual(viewFor(accepted.state, viewer), viewFor(ran.state, viewer), `viewer ${viewer}`);
    }
    assert.deepEqual(viewFor(accepted.state, 'a').hand?.raise, {
      caller: 'a', value: 3, waiting: ['c', 'd'], answered: ['b'], mustAnswer: false, myAnswer: null,
    });
    assert.deepEqual(viewFor(accepted.state, 'c').hand?.raise, {
      caller: 'a', value: 3, waiting: ['c', 'd'], answered: ['b'], mustAnswer: true, myAnswer: null,
    });
    // Only b sees b's answer.
    assert.equal(viewFor(accepted.state, 'b').hand?.raise?.myAnswer, true);
    assert.equal(viewFor(ran.state, 'b').hand?.raise?.myAnswer, false);
    assert.equal(viewFor(accepted.state, 'b').hand?.raise?.mustAnswer, false);
    // Nothing has changed on the table yet, whatever b answered.
    for (const state of [accepted.state, ran.state]) {
      assert.equal(state.phase, 'truco');
      assert.equal(state.hand?.value, 1);
      assert.deepEqual(state.hand?.alive, [0, 1, 2, 3]);
    }
  });

  it('keeps earlier answers secret while later ones arrive, and reveals all of them together', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    table.run('b');
    table.accept('c');
    for (const viewer of ['a', 'd', null]) {
      const raise = table.hand(viewer).raise;
      assert.deepEqual(raise?.answered, ['b', 'c']);
      assert.deepEqual(raise?.waiting, ['d']);
      assert.equal(raise?.myAnswer, null);
      assert.equal(JSON.stringify(table.view(viewer)).includes('accept'), false);
    }
    assert.deepEqual(table.hand().alive, ['a', 'b', 'c', 'd'], 'b ran, but nobody may know yet');
    assert.deepEqual(table.hand().cardCounts, [3, 3, 3, 3]);

    assert.deepEqual(table.do({ type: 'respond', playerId: 'd', accept: true }), [
      { type: 'trucoAnswered', playerId: 'd' },
      { type: 'trucoResolved', caller: 'a', accepted: ['c', 'd'], ran: ['b'], value: 3 },
      { type: 'playerLeftHand', playerId: 'b', reason: 'ran' },
    ]);
    assert.equal(table.hand().raise, null);
    assert.deepEqual(table.hand().alive, ['a', 'c', 'd']);
    assert.deepEqual(table.hand().ran, ['b']);
  });

  it('lists who accepted and who ran in deal order, not in the order they answered', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e']);
    table.deal({ ...FOUR, e: 'Jo Je Ko' });
    table.truco('a');
    table.run('e');
    table.accept('d');
    table.run('c');
    table.accept('b');
    assert.deepEqual(table.event('trucoResolved'), { type: 'trucoResolved', caller: 'a', accepted: ['b', 'd'], ran: ['c', 'e'], value: 3 });
    assert.deepEqual(table.events.filter((event) => event.type === 'playerLeftHand').map((event) => event.playerId), ['c', 'e']);
  });
});

describe('when nobody accepts', () => {
  it('the caller takes the hand at the value before the raise', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.run('b');
    assert.deepEqual(table.do({ type: 'respond', playerId: 'c', accept: false }), [
      { type: 'trucoAnswered', playerId: 'c' },
      { type: 'trucoResolved', caller: 'a', accepted: [], ran: ['b', 'c'], value: 1 },
      { type: 'playerLeftHand', playerId: 'b', reason: 'ran' },
      { type: 'playerLeftHand', playerId: 'c', reason: 'ran' },
      { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'allRan' },
    ]);
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [1, 0, 0]);
    assert.equal(table.state.phase, 'deal');
    assert.equal(table.hand().value, 1);
    assert.equal(table.hand().lastRaiser, null);
    assert.deepEqual(table.hand().alive, ['a']);
    assert.deepEqual(table.hand().ran, ['b', 'c']);
  });

  it('the caller of a refused seis scores 3, of a refused nove scores 6', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    table.truco('a');
    table.accept('b');
    table.play('a', '3o');
    table.truco('b');
    table.run('a');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'allRan' });
    assert.equal(table.score('b'), 3);

    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c' });
    assert.equal(table.hand().turn, 'b');
    table.truco('b');
    table.accept('a');
    table.play('b', '4o');
    table.truco('a');
    table.accept('b');
    table.plays('a 3o', 'a 3e');
    table.truco('b');
    table.run('a');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 2, winner: 'b', value: 6, reason: 'allRan' });
    assert.equal(table.score('b'), 9);
    assert.deepEqual(table.view(null).lastHand, { hand: 2, winner: 'b', value: 6, reason: 'allRan' });
  });
});

describe('running from a raise', () => {
  it('voids the card the runner had already played in the unfinished round', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o 4e 4c', b: '4o 5e 5c', c: '5o 6e 6c' });
    table.plays('a 3o', 'b 4o');
    table.truco('c');
    table.run('a');
    table.accept('b');

    assert.deepEqual(table.hand().plays, [
      { playerId: 'a', card: '3o', voided: true },
      { playerId: 'b', card: '4o', voided: false },
    ]);
    assert.deepEqual(table.hand().alive, ['b', 'c']);
    assert.deepEqual(table.hand().ran, ['a']);
    assert.deepEqual(table.hand().cardCounts, [0, 2, 3]);
    assert.deepEqual(table.hand('a').myCards, [], 'the cards the runner still held are discarded');
    assert.deepEqual([...table.rawHand.discards].sort(), ['4c', '4e']);
    assert.equal(table.hand().turn, 'c');

    // a's 3 was the strongest card on the table, but it no longer counts.
    table.play('c', '5o');
    assert.equal(table.event('roundEnded').winner, 'c');
    assert.deepEqual(table.hand().rounds[0].plays[0], { playerId: 'a', card: '3o', voided: true });
    table.fail({ type: 'play', playerId: 'a', card: '4e' }, 'not-your-turn');

    table.plays('c 6e', 'b 5e');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'c', value: 3, reason: 'rounds' });
    assert.equal(table.score('a'), 0);
  });

  it('can turn a lost round into a tie, or a tie into a win', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal({ a: '3o 4e 4c', b: '2o 5e 5c', c: '2e 6e 6c', d: '4o Je Jc' });
    table.plays('a 3o', 'b 2o', 'c 2e');
    table.truco('d');
    table.run('a');
    table.accept('b', 'c');
    table.play('d', '4o');
    assert.equal(table.event('roundEnded').winner, null, 'without the 3, the two 2s tie');
  });

  it('by a player who had not played yet simply removes that player from the round', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.plays('a 3o', 'b 4o');
    table.truco('c');
    table.accept('a', 'b');
    table.run('d');
    assert.equal(table.hand().turn, 'c');
    table.fail({ type: 'play', playerId: 'a', card: '3e' }, 'not-your-turn');
    table.fail({ type: 'play', playerId: 'b', card: '4e' }, 'not-your-turn');
    // The caller's card completes the round: d is gone and a and b have already played.
    assert.deepEqual(table.play('c', '5o'), [
      { type: 'cardPlayed', playerId: 'c', card: '5o', round: 0 },
      { type: 'roundEnded', round: 0, winner: 'a' },
    ]);
    assert.deepEqual(table.hand().rounds[0].plays.map((play) => play.playerId), ['a', 'b', 'c']);
    assert.equal(table.hand().turn, 'a');
    table.plays('a 3e', 'b 4e', 'c 5e');
    assert.equal(table.event('handEnded').value, 3);
  });

  it('means scoring nothing, even for a runner who had the best cards', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: 'Qp Qc Qe', b: '4o 4e 5c', c: '5o 5e 6c' });
    table.play('a', 'Qp');
    table.truco('b');
    table.run('a');
    table.accept('c');
    table.plays('b 4o', 'c 5o', 'c 5e', 'b 4e');
    assert.equal(table.event('handEnded').winner, 'c');
    assert.deepEqual([table.score('a'), table.score('b'), table.score('c')], [0, 0, 3]);
  });

  it('leaves the last two players to finish the hand between them', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    table.deal({
      a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc', e: 'Jo Je Kc', f: 'Ko Ke Ac', g: 'Ao Ae 2c',
    });
    table.truco('a');
    table.run('b', 'c', 'd', 'e', 'f');
    table.accept('g');
    assert.deepEqual(table.hand().alive, ['a', 'g']);
    assert.deepEqual(table.hand().cardCounts, [3, 0, 0, 0, 0, 0, 3]);
    assert.equal(table.rawHand.discards.length, 15);
    table.plays('a 3o', 'g Ao', 'a 3e', 'g Ae');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 3, reason: 'rounds' });
  });
});

describe('a raise in the middle of a round', () => {
  it('is answered by everyone else in the hand, including those who already played', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.plays('a 3o', 'b 4o');
    table.truco('c');
    assert.deepEqual(pendingPlayers(table.state), ['a', 'b', 'd']);
    assert.equal(table.hand().turn, 'c');
    assert.deepEqual(table.hand('a').raise, {
      caller: 'c', value: 3, waiting: ['a', 'b', 'd'], answered: [], mustAnswer: true, myAnswer: null,
    });
    assert.equal(table.hand('c').raise?.mustAnswer, false);
    table.accept('a', 'b', 'd');
    assert.equal(table.hand().turn, 'c');
    assert.equal(table.hand().plays.length, 2, 'the cards already on the table stay there');
    table.plays('c 5o', 'd 6o');
    assert.equal(table.event('roundEnded').winner, 'a');
  });

  it('can be followed by another raise in the same round, by the next player', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    table.accept('b', 'c');
    table.play('a', '3o');
    table.truco('b');
    table.accept('a');
    table.run('c');
    assert.equal(table.hand().value, 6);
    assert.deepEqual(table.hand().alive, ['a', 'b']);
    table.play('b', '4o');
    assert.equal(table.event('roundEnded').winner, 'a');
  });
});
