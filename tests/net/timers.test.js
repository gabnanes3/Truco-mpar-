// Deadlines are wall-clock and host-driven. Whatever fires, fires against the state as it is at that moment.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { weakestCard } from '../../app/js/engine/cards.js';
import { Table, eventTypes, identityOf } from './support.js';

/**
 * @param {Table} table
 * @returns {string[]} who is in the room besides whoever is to play
 */
function others(table) {
  const turn = table.turn();
  return ['Ana', 'Bia', 'Caio'].filter((name) => name !== turn);
}

describe('turn timeout', () => {
  for (const who of ['Ana', 'Bia']) {
    it(`plays the weakest card of ${who === 'Ana' ? 'the host' : 'a guest'} when the 15 seconds run out`, () => {
      const table = new Table({ seed: 31 });
      table.start('Bia', 'Caio');
      table.untilTurnOf(who);
      const { playerId } = identityOf(who);
      const { myCards, manilha, plays } = table.hand(who);
      const timer = table.snap('Caio').timer;
      assert.deepEqual([timer?.totalMs, timer?.players], [15000, [playerId]]);
      assert.ok(timer !== null && timer.remainingMs > 14900 && timer.remainingMs <= 15000);

      table.clock.advance(14900);
      assert.equal(table.hand('Ana').plays.length, plays.length);
      table.clock.advance(150);
      const expected = { playerId, card: weakestCard(myCards, manilha), voided: false };
      assert.deepEqual(table.hand('Caio').plays[plays.length] ?? table.hand('Caio').rounds[0].plays[plays.length], expected);
      assert.equal(table.hand(who).myCards.length, 2);
      // The next player gets a full clock of their own.
      const next = table.snap('Caio').timer;
      assert.ok(next !== null && next.remainingMs > 14900 && !next.players.includes(playerId));
    });
  }

  it('is not fooled by late or repeated timers: nothing happens before the time is really up', () => {
    const table = new Table({ seed: 32 });
    table.start('Bia', 'Caio');
    const state = table.room.matchState;
    const seq = table.snap('Ana').seq;
    table.clock.advance(5000);
    for (let count = 0; count < 5; count += 1) table.room.tick();
    table.settle();
    assert.equal(table.room.matchState, state);
    assert.equal(table.snap('Ana').seq, seq);
    assert.notEqual(table.room.deadlineTimer, null);

    // A player who acts in time is not played for when the old deadline passes.
    const turn = table.turn();
    table.client(turn).play(table.hand(turn).myCards[0]);
    table.settle();
    const afterPlay = table.room.matchState;
    table.clock.advance(10100);
    assert.equal(table.room.matchState, afterPlay);
    table.clock.advance(5000);
    assert.notEqual(table.room.matchState, afterPlay);
  });

  it('is applied exactly once when the host wakes up long after the deadline', () => {
    const table = new Table({ seed: 33 });
    table.start('Bia', 'Caio');
    const turn = table.hand('Ana').turn;
    /** @type {string[]} */
    const events = [];
    table.host.subscribe((snapshot) => events.push(...eventTypes(snapshot)));

    table.clock.sleep(10 * 60 * 1000);
    table.settle();
    assert.deepEqual(events, ['cardPlayed']);
    assert.deepEqual(table.hand('Ana').plays.map((play) => play.playerId), [turn]);
    const timer = table.snap('Ana').timer;
    assert.ok(timer !== null && timer.remainingMs > 14900 && !timer.players.includes(turn ?? ''));
    // The silence was the host's own: nobody is thrown out for it.
    table.settle(5000);
    assert.deepEqual(table.snap('Ana').room.members.map((member) => member.connected), [true, true, true]);
    assert.deepEqual(['Bia', 'Caio'].map((name) => table.snap(name).connection), ['online', 'online']);
    assert.equal(table.hand('Bia').plays.length, 1);
  });
});

describe('raise timeout', () => {
  it('makes everybody who did not answer run, and the caller takes the hand at the old value', () => {
    const table = new Table({ seed: 34 });
    table.start('Bia', 'Caio');
    const caller = table.turn();
    const waiting = others(table).map((name) => identityOf(name).playerId);
    table.client(caller).raise();
    table.settle();
    assert.deepEqual([...(table.snap('Ana').timer?.players ?? [])].sort(), [...waiting].sort());

    table.clock.advance(14900);
    assert.equal(table.snap('Ana').game?.phase, 'truco');
    table.clock.advance(150);
    const snapshot = table.snap(caller);
    assert.deepEqual(eventTypes(snapshot).filter((type) => type === 'trucoResolved' || type === 'handEnded'), ['trucoResolved', 'handEnded']);
    assert.deepEqual(snapshot.game?.lastHand, { hand: 1, winner: identityOf(caller).playerId, value: 1, reason: 'allRan' });
    assert.equal(snapshot.game?.players.find((player) => player.id === identityOf(caller).playerId)?.score, 1);
    assert.equal(snapshot.timer, null);
  });

  it('is one shared deadline: an answer does not give the others more time', () => {
    const table = new Table({ seed: 35 });
    table.start('Bia', 'Caio');
    const caller = table.turn();
    const [quick, slow] = others(table);
    table.client(caller).raise();
    table.settle();
    table.clock.advance(10000);
    table.client(quick).respond(true);
    table.settle();
    const timer = table.snap('Ana').timer;
    assert.deepEqual(timer?.players, [identityOf(slow).playerId]);
    assert.ok(timer !== null && timer.remainingMs < 5000 && timer.remainingMs > 4900);

    table.clock.advance(5000);
    const hand = table.hand('Ana');
    assert.deepEqual([hand.value, hand.raise, hand.turn], [3, null, identityOf(caller).playerId]);
    assert.deepEqual(hand.ran, [identityOf(slow).playerId]);
    // Back to playing, the caller has a fresh turn.
    assert.ok((table.snap('Ana').timer?.remainingMs ?? 0) > 14900);
  });
});

describe('a disconnected player', () => {
  it('gets 6 seconds from the moment of the drop, then the default action', () => {
    const table = new Table({ seed: 36 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    table.clock.advance(2000);
    table.client('Bia').close();
    table.settle();
    const timer = table.snap('Caio').timer;
    assert.ok(timer !== null && timer.remainingMs <= 6000 && timer.remainingMs > 5900);
    assert.equal(timer.totalMs, 15000);
    const played = table.hand('Ana').plays.length;

    table.clock.advance(5900);
    assert.equal(table.hand('Ana').plays.length, played);
    table.clock.advance(150);
    assert.equal(table.hand('Ana').cardCounts[1], 2);
    assert.deepEqual(table.snap('Ana').room.members.map((member) => member.connected), [true, false, true]);

    // Still gone at their next turn: played for after a short beat, not after another full wait.
    table.untilTurnOf('Bia');
    const before = table.room.matchState;
    table.clock.advance(900);
    assert.equal(table.room.matchState, before);
    table.clock.advance(200);
    assert.notEqual(table.room.matchState, before);
  });

  it('gets the normal deadline back by reconnecting in time', () => {
    const table = new Table({ seed: 37 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    const state = table.room.matchState;
    table.clock.advance(2000);
    table.client('Bia').close();
    table.settle();
    table.clock.advance(3000);
    table.join('Bia');
    const timer = table.snap('Bia').timer;
    assert.ok(timer !== null && timer.remainingMs > 9900 && timer.remainingMs < 10000);

    table.clock.advance(9000);
    assert.equal(table.room.matchState, state);
    table.clock.advance(1000);
    assert.notEqual(table.room.matchState, state);
  });

  it('who had already used up the normal time is not given extra by dropping', () => {
    const table = new Table({ seed: 38 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    const state = table.room.matchState;
    table.clock.advance(12000);
    table.client('Bia').close();
    table.settle();
    table.clock.advance(2900);
    assert.equal(table.room.matchState, state);
    table.clock.advance(150);
    assert.notEqual(table.room.matchState, state);
  });
});

describe('between hands', () => {
  it('shows the result for 4.5 seconds, then the host deals by itself', () => {
    const table = new Table({ seed: 39 });
    table.start('Bia', 'Caio');
    const caller = table.turn();
    const dealer = table.snap('Ana').game?.dealer;
    table.client(caller).raise();
    table.settle();
    for (const name of others(table)) table.client(name).respond(false);
    table.settle();
    const paused = table.snap('Bia');
    assert.deepEqual([paused.game?.phase, paused.timer, paused.game?.lastHand?.reason], ['deal', null, 'allRan']);
    assert.notEqual(table.room.deadlineTimer, null);

    table.clock.advance(4400);
    assert.equal(table.snap('Bia').game?.phase, 'deal');
    table.clock.advance(150);
    for (const name of ['Ana', 'Bia', 'Caio']) {
      assert.deepEqual([table.snap(name).game?.phase, table.snap(name).game?.handNumber], ['play', 2]);
      assert.equal(table.hand(name).myCards.length, 3);
      assert.ok(eventTypes(table.snap(name)).includes('handDealt'));
    }
    assert.notEqual(table.snap('Ana').game?.dealer, dealer);
    assert.equal(table.snap('Ana').timer?.totalMs, 15000);
  });
});
