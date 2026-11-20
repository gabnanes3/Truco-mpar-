// Who has to act (pendingPlayers) and what happens when their time runs out (defaultAction, spec 2.4).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { apply, defaultAction, pendingPlayers } from '../../app/js/engine/game.js';
import { Table } from './helpers.js';

const THREE = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' };

describe('pendingPlayers', () => {
  it('is empty between hands and after the match', () => {
    const table = new Table(['a', 'b', 'c']);
    assert.deepEqual(pendingPlayers(table.state), []);
    table.quickHand();
    assert.deepEqual(pendingPlayers(table.state), []);
    table.remove('a');
    table.remove('b');
    assert.equal(table.state.phase, 'over');
    assert.deepEqual(pendingPlayers(table.state), []);
  });

  it('is the player to play, then everyone who still owes an answer to a raise', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    assert.deepEqual(pendingPlayers(table.state), ['a']);
    table.play('a', '3o');
    assert.deepEqual(pendingPlayers(table.state), ['b']);
    table.truco('b');
    assert.deepEqual(pendingPlayers(table.state), ['a', 'c']);
    table.accept('c');
    assert.deepEqual(pendingPlayers(table.state), ['a']);
    table.accept('a');
    assert.deepEqual(pendingPlayers(table.state), ['b'], 'back to the caller, who still has to play');
  });
});

describe('defaultAction', () => {
  it('is nothing for players who have nothing to do', () => {
    const table = new Table(['a', 'b', 'c']);
    for (const id of ['a', 'b', 'c', 'nobody']) assert.equal(defaultAction(table.state, id), null);
    table.deal(THREE);
    assert.equal(defaultAction(table.state, 'b'), null);
    assert.equal(defaultAction(table.state, 'c'), null);
    assert.equal(defaultAction(table.state, 'nobody'), null);
    table.truco('a');
    assert.equal(defaultAction(table.state, 'a'), null, 'the caller waits for the answers');
    table.accept('b');
    assert.equal(defaultAction(table.state, 'b'), null, 'already answered');
    table.run('c');
    table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e');
    assert.equal(table.state.phase, 'deal');
    for (const id of ['a', 'b', 'c']) assert.equal(defaultAction(table.state, id), null);
  });

  it('on your turn, plays your weakest card', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal({ a: '3o Kc 5e', b: '2o Jc Ae', c: 'Qo 6c 7e' });
    assert.deepEqual(defaultAction(table.state, 'a'), { type: 'play', playerId: 'a', card: '5e' });
    table.play('a', '5e');
    assert.deepEqual(defaultAction(table.state, 'b'), { type: 'play', playerId: 'b', card: 'Jc' });
    table.play('b', 'Jc');
    assert.deepEqual(defaultAction(table.state, 'c'), { type: 'play', playerId: 'c', card: '6c' });
  });

  it('judges weakness under the manilha of the hand', () => {
    const table = new Table(['a', 'b']);
    // Vira 3p: the 4s are manilhas, so the 4 is the strongest card here and the 5 the weakest.
    table.deal({ a: '4o 5e 6c', b: '4p 4c 4e' }, '3p');
    assert.deepEqual(defaultAction(table.state, 'a'), { type: 'play', playerId: 'a', card: '5e' });
    table.play('a', '5e');
    assert.deepEqual(defaultAction(table.state, 'b'), { type: 'play', playerId: 'b', card: '4e' }, 'the lowest manilha');
  });

  it('breaks ties between equally weak cards by the lowest suit: ouros, espadas, copas, paus', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: '5p 5c 5e', b: '6p 6o 7c' });
    assert.deepEqual(defaultAction(table.state, 'a'), { type: 'play', playerId: 'a', card: '5e' });
    table.play('a', '5e');
    assert.deepEqual(defaultAction(table.state, 'b'), { type: 'play', playerId: 'b', card: '6o' });
  });

  it('never raises', () => {
    const table = new Table(['a', 'b']);
    table.deal({ a: 'Qp Qc Qe', b: '4o 4e 5c' });
    assert.equal(defaultAction(table.state, 'a')?.type, 'play');
  });

  it('when answering a raise, runs', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    assert.deepEqual(defaultAction(table.state, 'b'), { type: 'respond', playerId: 'b', accept: false });
    assert.deepEqual(defaultAction(table.state, 'c'), { type: 'respond', playerId: 'c', accept: false });
  });

  it('is always accepted by apply, for every pending player', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.plays('a 3o', 'b 4o');
    table.truco('c');
    for (const id of pendingPlayers(table.state)) {
      const action = defaultAction(table.state, id);
      assert.ok(action !== null && apply(table.state, action).ok);
    }
  });

  it('applied for everybody, lets a raise time out in favour of the caller', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    for (const id of ['b', 'c']) {
      const action = defaultAction(table.state, id);
      assert.ok(action !== null);
      table.do(action);
    }
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'a', value: 1, reason: 'allRan' });
  });
});
