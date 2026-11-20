// The engine's safety promises: invalid input never throws and never changes anything, inputs are never
// mutated, and the state is plain JSON that can be saved and restored at any point.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullDeck } from '../../app/js/engine/cards.js';
import {
  apply, canRaise, checkInvariants, createMatch, defaultAction, pendingPlayers, viewFor,
} from '../../app/js/engine/game.js';
import { Table, assertHealthy, deepFreeze, jsonCopy, prng, shuffledDeck } from './helpers.js';

/** @typedef {import('../../app/js/engine/types.js').MatchState} MatchState */
/** @typedef {import('../../app/js/engine/types.js').Action} Action */

const THREE = { a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' };
const ERROR_CODES = [
  'bad-action', 'match-over', 'wrong-phase', 'bad-deck', 'unknown-player', 'not-your-turn', 'card-not-in-hand',
  'raise-at-max', 'raise-twice', 'raise-at-match-point', 'not-in-hand', 'own-raise', 'already-answered', 'already-removed',
];

/**
 * One table in each situation the engine can be in.
 * @returns {Record<string, Table>}
 */
function situations() {
  const beforeFirstDeal = new Table(['a', 'b', 'c']);

  const playing = new Table(['a', 'b', 'c']);
  playing.deal(THREE);
  playing.plays('a 3o', 'b 4o');

  const raised = new Table(['a', 'b', 'c']);
  raised.deal(THREE);
  raised.truco('a');
  raised.accept('b', 'c');

  const answering = new Table(['a', 'b', 'c']);
  answering.deal(THREE);
  answering.play('a', '3o');
  answering.truco('b');
  answering.accept('c');

  const answeringAfterSomeoneRan = new Table(['a', 'b', 'c']);
  answeringAfterSomeoneRan.deal(THREE);
  answeringAfterSomeoneRan.truco('a');
  answeringAfterSomeoneRan.run('b');
  answeringAfterSomeoneRan.accept('c');
  answeringAfterSomeoneRan.play('a', '3o');
  answeringAfterSomeoneRan.truco('c');

  const betweenHands = new Table(['a', 'b', 'c']);
  betweenHands.deal(THREE);
  betweenHands.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');

  const withRemovedPlayer = new Table(['a', 'b', 'c']);
  withRemovedPlayer.deal(THREE);
  withRemovedPlayer.remove('b');

  const wonByScore = new Table(['a', 'b', 'c']);
  wonByScore.setScores({ a: 11 });
  wonByScore.deal(THREE);
  wonByScore.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');

  const abandoned = new Table(['a', 'b', 'c']);
  abandoned.deal(THREE);
  abandoned.remove('a');
  abandoned.remove('b');

  return {
    beforeFirstDeal, playing, raised, answering, answeringAfterSomeoneRan, betweenHands, withRemovedPlayer, wonByScore,
    abandoned,
  };
}

/** Things that are not actions at all, as they could arrive from the network. */
const GARBAGE = [
  undefined, null, true, 0, 42, NaN, '', 'play', [], [1, 2], {}, () => {}, Symbol('x'),
  { type: undefined }, { type: null }, { type: 7 }, { type: '' }, { type: 'PLAY' }, { type: 'pass' }, { type: 'toString' },
  { type: ['play'] }, { type: { type: 'play' } },
  { type: 'play' }, { type: 'play', playerId: 'a' }, { type: 'play', card: '3o' }, { type: 'play', playerId: 0, card: '3o' },
  { type: 'play', playerId: 'a', card: 3 }, { type: 'play', playerId: 'a', card: null }, { type: 'play', playerId: 'a', card: ['3o'] },
  { type: 'play', playerId: ['a'], card: '3o' }, { type: 'play', playerId: { id: 'a' }, card: '3o' },
  { type: 'truco' }, { type: 'truco', playerId: null }, { type: 'truco', playerId: 1 }, { type: 'truco', player: 'a' },
  { type: 'respond', playerId: 'b' }, { type: 'respond', playerId: 'b', accept: 'yes' }, { type: 'respond', playerId: 'b', accept: 1 },
  { type: 'respond', playerId: 'b', accept: null }, { type: 'respond', accept: true },
  { type: 'remove' }, { type: 'remove', playerId: undefined }, { type: 'remove', playerId: {} },
];

/**
 * A broad list of well-formed actions, most of them invalid in any given situation.
 * @returns {Action[]}
 */
function wellFormedActions() {
  /** @type {Action[]} */
  const actions = [{ type: 'deal', deck: fullDeck() }];
  for (const playerId of ['a', 'b', 'c', 'nobody', '']) {
    for (const card of ['3o', '3e', '4c', '4o', '4e', '5c', '5o', '5e', '6c', '7o', 'Qp', 'zz', '']) {
      actions.push({ type: 'play', playerId, card });
    }
    actions.push({ type: 'truco', playerId });
    actions.push({ type: 'respond', playerId, accept: true });
    actions.push({ type: 'respond', playerId, accept: false });
    actions.push({ type: 'remove', playerId });
  }
  return actions;
}

describe('invalid actions', () => {
  it('garbage is answered with bad-action, in every situation, without throwing', () => {
    for (const [name, table] of Object.entries(situations())) {
      for (const garbage of GARBAGE) {
        const result = apply(table.state, /** @type {any} */ (garbage));
        assert.deepEqual(result, { ok: false, error: 'bad-action', state: table.state }, `${name}: ${String(garbage)}`);
        assert.equal(result.state, table.state);
      }
    }
  });

  it('return a known error code and the very same, unchanged state', () => {
    const seenErrors = new Set();
    for (const [name, table] of Object.entries(situations())) {
      const snapshot = jsonCopy(table.state);
      for (const action of wellFormedActions()) {
        const result = apply(table.state, action);
        const label = `${name}: ${JSON.stringify(action.type === 'deal' ? { type: 'deal' } : action)}`;
        if (result.ok) {
          assert.notEqual(result.state, table.state, label);
          assertHealthy(result.state);
        } else {
          assert.ok(ERROR_CODES.includes(result.error), `${label} → unknown error ${result.error}`);
          assert.equal(result.state, table.state, label);
          assert.deepEqual(Object.keys(result), ['ok', 'error', 'state'], label);
          seenErrors.add(result.error);
        }
        // Valid or not, the state that went in is untouched (it is deep-frozen, so a write would have thrown).
        assert.deepEqual(table.state, snapshot, label);
      }
    }
    // Some codes need a longer set-up than those situations; they have their own test below.
    const rare = ['bad-action', 'bad-deck', 'raise-at-max', 'raise-at-match-point'];
    assert.deepEqual([...seenErrors].sort(), ERROR_CODES.filter((code) => !rare.includes(code)).sort());
  });

  it('each have their own stable error code', () => {
    const table = new Table(['a', 'b', 'c']);
    table.fail('rubbish', 'bad-action');
    table.fail({ type: 'deal', deck: ['4o'] }, 'bad-deck');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'wrong-phase');
    table.fail({ type: 'truco', playerId: 'a' }, 'wrong-phase');
    table.fail({ type: 'respond', playerId: 'a', accept: true }, 'wrong-phase');
    table.fail({ type: 'remove', playerId: 'z' }, 'unknown-player');

    table.setScores({ c: 11 });
    table.deal(THREE);
    table.fail({ type: 'deal', deck: fullDeck() }, 'wrong-phase');
    table.fail({ type: 'play', playerId: 'z', card: '3o' }, 'unknown-player');
    table.fail({ type: 'play', playerId: 'b', card: '4o' }, 'not-your-turn');
    table.fail({ type: 'play', playerId: 'a', card: '4o' }, 'card-not-in-hand');
    table.fail({ type: 'play', playerId: 'a', card: 'not a card' }, 'card-not-in-hand');
    table.fail({ type: 'truco', playerId: 'z' }, 'unknown-player');
    table.fail({ type: 'truco', playerId: 'b' }, 'not-your-turn');
    table.fail({ type: 'respond', playerId: 'z', accept: true }, 'unknown-player');
    table.fail({ type: 'respond', playerId: 'b', accept: true }, 'wrong-phase');

    table.truco('a');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'wrong-phase');
    table.fail({ type: 'truco', playerId: 'b' }, 'wrong-phase');
    table.fail({ type: 'respond', playerId: 'a', accept: true }, 'own-raise');
    table.accept('b', 'c');
    table.fail({ type: 'truco', playerId: 'a' }, 'raise-twice');
    table.plays('a 3o', 'b 4o');
    table.fail({ type: 'truco', playerId: 'c' }, 'raise-at-match-point');
    table.fail({ type: 'play', playerId: 'c', card: '3o' }, 'card-not-in-hand');
    table.play('c', '5o');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'card-not-in-hand');

    table.remove('c');
    table.fail({ type: 'remove', playerId: 'c' }, 'already-removed');
    table.play('a', '3e');
    table.truco('b');
    table.fail({ type: 'respond', playerId: 'c', accept: true }, 'not-in-hand');
    table.accept('a');
    table.fail({ type: 'respond', playerId: 'a', accept: true }, 'wrong-phase');
    table.play('b', '4e');
    assert.equal(table.state.phase, 'deal');

    table.remove('a');
    assert.equal(table.state.phase, 'over');
    table.fail({ type: 'remove', playerId: 'b' }, 'match-over');
    table.fail({ type: 'play', playerId: 'b', card: '5c' }, 'match-over');
    table.fail({}, 'bad-action');
  });

  it('are still rejected when the same card is sent twice in a row', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.play('a', '3o');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'not-your-turn');
    table.plays('b 4o', 'c 5o');
    table.fail({ type: 'play', playerId: 'a', card: '3o' }, 'card-not-in-hand');
  });

  it('ignore extra fields instead of trusting them', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    const result = apply(table.state, /** @type {any} */ ({
      type: 'play', playerId: 'a', card: '3o', seat: 2, voided: true, accept: true, deck: ['Qp'], state: { phase: 'over' },
    }));
    assert.ok(result.ok);
    assert.deepEqual(result.events, [{ type: 'cardPlayed', playerId: 'a', card: '3o', round: 0 }]);
    assertHealthy(result.state);
    assert.deepEqual(result.state.hand?.current?.plays, [{ seat: 0, card: '3o', voided: false }]);
  });
});

describe('purity', () => {
  it('apply never mutates the state or the action it receives', () => {
    // The Table driver deep-freezes every state and action, so this whole suite would throw on any write.
    // Here the same is shown explicitly, once per kind of action.
    const players = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }];
    const state = deepFreeze(createMatch(players, { dealerIndex: 2 }));
    const deal = deepFreeze({ type: /** @type {const} */ ('deal'), deck: fullDeck() });
    const dealt = apply(state, deal);
    assert.ok(dealt.ok);
    assert.equal(state.phase, 'deal');
    assert.equal(state.hand, null);
    assert.deepEqual(deal.deck, fullDeck());

    const before = deepFreeze(dealt.state);
    const snapshot = jsonCopy(before);
    /** @type {Action[]} */
    const actions = [
      { type: 'play', playerId: 'a', card: before.hand?.cards[0][0] ?? '' },
      { type: 'truco', playerId: 'a' },
      { type: 'remove', playerId: 'b' },
    ];
    for (const action of actions) {
      const result = apply(before, deepFreeze(action));
      assert.ok(result.ok, action.type);
      assert.deepEqual(before, snapshot, action.type);
    }
    const raised = apply(before, { type: 'truco', playerId: 'a' });
    assert.ok(raised.ok);
    const frozenRaise = deepFreeze(raised.state);
    const answered = apply(frozenRaise, deepFreeze({ type: /** @type {const} */ ('respond'), playerId: 'b', accept: false }));
    assert.ok(answered.ok);
    assert.equal(frozenRaise.hand?.raise?.answers.length, 0);
  });

  it('a new state shares no mutable structure with the previous one', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    const previous = table.state;
    const result = apply(previous, { type: 'play', playerId: 'a', card: '3o' });
    assert.ok(result.ok);
    // Scribbling over the new state must not reach the old one (which is frozen: a shared part would throw).
    const scribble = (/** @type {any} */ value) => {
      if (typeof value !== 'object' || value === null) return;
      Object.values(value).forEach(scribble);
      if (Array.isArray(value)) value.push('x');
      else value.extra = 'x';
    };
    scribble(result.state);
    assert.deepEqual(checkInvariants(previous), []);
  });

  it('the read-only helpers leave the state alone', () => {
    const table = new Table(['a', 'b', 'c']);
    table.deal(THREE);
    table.truco('a');
    const before = JSON.stringify(table.state);
    for (const id of ['a', 'b', 'c', 'z']) {
      canRaise(table.state, id);
      defaultAction(table.state, id);
      viewFor(table.state, id);
    }
    pendingPlayers(table.state);
    checkInvariants(table.state);
    assert.equal(JSON.stringify(table.state), before);
  });

  it('the same actions always lead to the same states and events', () => {
    const run = () => {
      const random = prng(2024);
      let state = createMatch([{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }, { id: 'c', name: 'C' }], { dealerIndex: 1 });
      const log = [];
      for (let step = 0; step < 400 && state.phase !== 'over'; step += 1) {
        /** @type {Action | null} */
        let action = null;
        if (state.phase === 'deal') action = { type: 'deal', deck: shuffledDeck(random) };
        else action = defaultAction(state, pendingPlayers(state)[0]);
        assert.ok(action !== null);
        const result = apply(state, action);
        assert.ok(result.ok);
        log.push(result.events);
        state = result.state;
      }
      return { state, log };
    };
    const first = run();
    const second = run();
    assert.equal(first.state.phase, 'over');
    assert.deepEqual(second, first);
  });
});

describe('persistence', () => {
  it('a state saved and restored as JSON at every step plays out exactly like the original', () => {
    const random = prng(7);
    /** @type {MatchState} */
    let kept = createMatch(['a', 'b', 'c', 'd', 'e'].map((id) => ({ id, name: id })));
    /** @type {MatchState} */
    let restored = jsonCopy(kept);
    let steps = 0;
    while (kept.phase !== 'over') {
      steps += 1;
      assert.ok(steps < 5000, 'the match should end');
      const pending = pendingPlayers(kept);
      /** @type {Action} */
      let action;
      if (kept.phase === 'deal') {
        action = { type: 'deal', deck: shuffledDeck(random) };
      } else {
        const playerId = pending[Math.floor(random() * pending.length)];
        const fallback = defaultAction(kept, playerId);
        assert.ok(fallback !== null);
        if (kept.phase === 'truco') action = { type: 'respond', playerId, accept: random() < 0.6 };
        else if (canRaise(kept, playerId) && random() < 0.3) action = { type: 'truco', playerId };
        else action = fallback;
      }
      const original = apply(kept, action);
      const fromJson = apply(restored, jsonCopy(action));
      assert.ok(original.ok && fromJson.ok);
      assert.deepEqual(fromJson.state, original.state);
      assert.deepEqual(fromJson.events, original.events);
      assert.equal(JSON.stringify(fromJson.state), JSON.stringify(original.state), 'same key order too');
      kept = original.state;
      restored = JSON.parse(JSON.stringify(fromJson.state));
      assert.deepEqual(checkInvariants(restored), []);
    }
    assert.ok(steps > 50);
  });

  it('the state holds nothing but plain JSON values', () => {
    /** @param {unknown} value */
    const assertPlain = (value) => {
      if (value === null || ['string', 'boolean'].includes(typeof value)) return;
      if (typeof value === 'number') {
        assert.ok(Number.isFinite(value));
        return;
      }
      assert.equal(typeof value, 'object', `unexpected ${typeof value}`);
      const prototype = Object.getPrototypeOf(value);
      assert.ok(prototype === Object.prototype || prototype === Array.prototype, 'no class instances, Maps or Sets');
      for (const item of Object.values(/** @type {object} */ (value))) assertPlain(item);
      if (Array.isArray(value)) assert.equal(Object.keys(value).length, value.length, 'no holes in arrays');
    };
    for (const table of Object.values(situations())) assertPlain(table.state);
  });
});

describe('player ids', () => {
  it('can be any distinct strings, even names of object internals', () => {
    const ids = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', '0', 'length', 'jogador com espaço ✓'];
    const table = new Table(ids);
    table.do({ type: 'deal', deck: fullDeck() });
    assert.deepEqual(table.hand().dealtIn, ids);
    for (const id of ids) assert.equal(table.hand(id).myCards.length, 3);

    table.truco('__proto__');
    table.accept('constructor', 'toString');
    table.run('hasOwnProperty', '0', 'length');
    table.remove('jogador com espaço ✓');
    assert.deepEqual(table.event('trucoResolved'), {
      type: 'trucoResolved',
      caller: '__proto__',
      accepted: ['constructor', 'toString'],
      ran: ['hasOwnProperty', '0', 'length', 'jogador com espaço ✓'],
      value: 3,
    });
    assert.deepEqual(table.hand().alive, ['__proto__', 'constructor', 'toString']);
    assert.deepEqual(pendingPlayers(table.state), ['__proto__']);
    const action = defaultAction(table.state, '__proto__');
    assert.ok(action !== null);
    table.do(action);
    assert.equal(table.hand().turn, 'constructor');
  });
});
