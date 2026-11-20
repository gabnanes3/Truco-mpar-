// viewFor is the only engine data that leaves the host: it must carry everything a screen needs and nothing
// a player must not know.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { viewFor } from '../../app/js/engine/game.js';
import { Table, cardsIn, jsonCopy } from './helpers.js';

const FOUR = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc' };
const VIEW_KEYS = ['targetScore', 'phase', 'players', 'viewer', 'dealer', 'handNumber', 'hand', 'lastHand', 'result'];
const HAND_KEYS = [
  'number', 'vira', 'manilha', 'value', 'nextValue', 'lastRaiser', 'turn', 'leader', 'rounds', 'plays', 'dealtIn',
  'alive', 'ran', 'cardCounts', 'myCards', 'canRaise', 'raise',
];

describe('viewFor', () => {
  it('before the first deal shows the players and who deals', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'b' });
    assert.deepEqual(table.view('a'), {
      targetScore: 12,
      phase: 'deal',
      players: [
        { id: 'a', name: 'A', score: 0, removed: false },
        { id: 'b', name: 'B', score: 0, removed: false },
        { id: 'c', name: 'C', score: 0, removed: false },
      ],
      viewer: 'a',
      dealer: 'b',
      handNumber: 0,
      hand: null,
      lastHand: null,
      result: null,
    });
  });

  it('during a hand carries everything the table screen shows', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'd' });
    table.setScores({ a: 2, b: 0, c: 5, d: 1 });
    table.deal(FOUR);
    table.truco('a');
    table.accept('b', 'c');
    table.run('d');
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e');

    assert.deepEqual(table.view('b'), {
      targetScore: 12,
      phase: 'play',
      players: [
        { id: 'a', name: 'A', score: 2, removed: false },
        { id: 'b', name: 'B', score: 0, removed: false },
        { id: 'c', name: 'C', score: 5, removed: false },
        { id: 'd', name: 'D', score: 1, removed: false },
      ],
      viewer: 'b',
      dealer: 'd',
      handNumber: 1,
      hand: {
        number: 1,
        vira: '7o',
        manilha: 'Q',
        value: 3,
        nextValue: 6,
        lastRaiser: 'a',
        turn: 'b',
        leader: 'a',
        rounds: [{
          leader: 'a',
          winner: 'a',
          plays: [
            { playerId: 'a', card: '3o', voided: false },
            { playerId: 'b', card: '4o', voided: false },
            { playerId: 'c', card: '5o', voided: false },
          ],
        }],
        plays: [{ playerId: 'a', card: '3e', voided: false }],
        dealtIn: ['a', 'b', 'c', 'd'],
        alive: ['a', 'b', 'c'],
        ran: ['d'],
        cardCounts: [1, 2, 2, 0],
        myCards: ['4e', '5c'],
        canRaise: true,
        raise: null,
      },
      lastHand: null,
      result: null,
    });
  });

  it('shows each player their own cards and nobody else\'s', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    for (const [id, cards] of Object.entries(FOUR)) {
      assert.deepEqual(table.hand(id).myCards, cards.split(' '));
      assert.deepEqual(cardsIn(table.view(id)).sort(), [...cards.split(' '), '7o'].sort(), `only own cards and the vira for ${id}`);
    }
    assert.deepEqual(cardsIn(table.view(null)), ['7o']);
  });

  it('never shows discarded cards or the stock, not even to the player who discarded', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.play('a', '3o');
    table.truco('b');
    table.run('a', 'd');
    table.accept('c');
    assert.deepEqual([...table.rawHand.discards].sort(), ['3e', '4c', '6e', '6o', 'Jc']);
    for (const viewer of ['a', 'b', 'c', 'd', null]) {
      const visible = cardsIn(table.view(viewer));
      for (const hidden of [...table.rawHand.discards, ...table.rawHand.stock]) {
        assert.equal(visible.includes(hidden), false, `${hidden} shown to ${viewer}`);
      }
    }
    // The voided card was played face up: it stays visible, marked.
    assert.deepEqual(table.hand('c').plays, [{ playerId: 'a', card: '3o', voided: true }]);
  });

  it('treats null and ids that are not in the match as spectators', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    const spectator = table.view(null);
    assert.equal(spectator.viewer, null);
    assert.deepEqual(spectator.hand?.myCards, []);
    assert.equal(spectator.hand?.canRaise, false);
    assert.deepEqual(spectator.hand?.raise, {
      caller: 'a', value: 3, waiting: ['b', 'c', 'd'], answered: [], mustAnswer: false, myAnswer: null,
    });
    assert.deepEqual(table.view('stranger'), spectator);
    assert.deepEqual(table.view(''), spectator);
  });

  it('has exactly the documented fields', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.truco('a');
    for (const viewer of ['a', 'b', null]) {
      const view = table.view(viewer);
      assert.deepEqual(Object.keys(view), VIEW_KEYS);
      assert.deepEqual(Object.keys(view.hand ?? {}), HAND_KEYS);
      assert.deepEqual(Object.keys(view.hand?.raise ?? {}), ['caller', 'value', 'waiting', 'answered', 'mustAnswer', 'myAnswer']);
    }
  });

  it('keeps the finished hand and its result on display between hands', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.plays('a 3o', 'b 4o', 'c 5o', 'd 6o', 'a 3e', 'b 4e', 'c 5e', 'd 6e');
    const view = table.view('c');
    assert.equal(view.phase, 'deal');
    assert.equal(view.dealer, 'a', 'the dealer shown is already the one of the coming hand');
    assert.equal(view.handNumber, 1);
    assert.deepEqual(view.lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
    assert.equal(view.players[0].score, 1);
    assert.equal(view.hand?.number, 1);
    assert.equal(view.hand?.rounds.length, 2);
    assert.deepEqual(view.hand?.plays, []);
    assert.equal(view.hand?.turn, null);
    assert.equal(view.hand?.leader, null);
    assert.deepEqual(view.hand?.myCards, ['6c']);
    assert.equal(view.hand?.canRaise, false);

    // During the next hand the previous result is still there for whoever reconnects.
    table.deal({ b: '4o 4e 5c', c: '5o 5e 6c', d: '6o 6e Jc', a: '3o 3e 4c' });
    assert.deepEqual(table.view('c').lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
    assert.equal(table.view('c').hand?.number, 2);
    assert.equal(table.view('c').hand?.turn, 'b');
  });

  it('shows the result of the match when it is over', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.setScores({ a: 11 });
    table.deal(FOUR);
    table.plays('a 3o', 'b 4o', 'c 5o', 'd 6o', 'a 3e', 'b 4e', 'c 5e', 'd 6e');
    for (const viewer of ['a', 'd', null]) {
      const view = table.view(viewer);
      assert.equal(view.phase, 'over');
      assert.deepEqual(view.result, { winner: 'a', reason: 'score' });
      assert.deepEqual(view.lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
      assert.equal(view.players[0].score, 12);
    }
  });

  it('marks removed players and still answers them, as onlookers', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.remove('c');
    const view = table.view('c');
    assert.equal(view.viewer, 'c');
    assert.equal(view.players[2].removed, true);
    assert.deepEqual(view.hand?.myCards, []);
    assert.deepEqual(view.hand?.ran, ['c']);
    assert.deepEqual(cardsIn(view), ['7o']);
  });

  it('is plain JSON', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    for (const step of [
      () => table.deal(FOUR),
      () => table.truco('a'),
      () => table.accept('b'),
      () => table.run('c', 'd'),
      () => table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e'),
    ]) {
      step();
      for (const viewer of ['a', 'b', 'c', 'd', null]) {
        const view = table.view(viewer);
        assert.deepEqual(jsonCopy(view), view);
      }
    }
  });

  it('is a fresh copy every time: changing a view cannot reach the state', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    table.plays('a 3o', 'b 4o', 'c 5o', 'd 6o', 'a 3e');
    table.truco('b');
    table.accept('a');
    const before = jsonCopy(table.state);

    /** Scribbles over every object and array reachable from `value`. The state is frozen: a shared reference would throw. */
    const vandalise = (/** @type {any} */ value) => {
      if (typeof value !== 'object' || value === null) return;
      Object.values(value).forEach(vandalise);
      if (Array.isArray(value)) value.push('Qp');
      else Object.keys(value).forEach((key) => { value[key] = 'Qp'; });
    };
    for (const viewer of ['a', 'b', null]) {
      const pristine = jsonCopy(viewFor(table.state, viewer));
      vandalise(viewFor(table.state, viewer));
      assert.deepEqual(viewFor(table.state, viewer), pristine);
    }
    assert.deepEqual(table.state, before);
  });

  it('does not change the state it is given', () => {
    const table = new Table(['a', 'b', 'c', 'd']);
    table.deal(FOUR);
    const before = JSON.stringify(table.state);
    for (const viewer of ['a', 'b', 'c', 'd', null, 'stranger']) viewFor(table.state, viewer);
    assert.equal(JSON.stringify(table.state), before);
  });
});
