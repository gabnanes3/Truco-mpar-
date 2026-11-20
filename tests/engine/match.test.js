import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullDeck } from '../../app/js/engine/cards.js';
import { apply, checkInvariants, createMatch, pendingPlayers } from '../../app/js/engine/game.js';
import { Table, stackedDeck } from './helpers.js';

/** @typedef {import('../../app/js/engine/types.js').PlayerInfo} PlayerInfo */

/**
 * @param {number} count
 * @returns {PlayerInfo[]}
 */
function somePlayers(count) {
  return Array.from({ length: count }, (_, seat) => ({ id: `p${seat}`, name: `Jogador ${seat + 1}` }));
}

describe('createMatch', () => {
  it('starts waiting for the first deal, everyone at zero', () => {
    const state = createMatch([{ id: 'x1', name: 'Ana' }, { id: 'x2', name: 'Bia' }, { id: 'x3', name: 'Caio' }]);
    assert.deepEqual(state, {
      targetScore: 12,
      players: [
        { id: 'x1', name: 'Ana', score: 0, removed: false },
        { id: 'x2', name: 'Bia', score: 0, removed: false },
        { id: 'x3', name: 'Caio', score: 0, removed: false },
      ],
      phase: 'deal',
      dealer: 0,
      handNumber: 0,
      hand: null,
      lastHand: null,
      result: null,
    });
    assert.deepEqual(checkInvariants(state), []);
    assert.deepEqual(pendingPlayers(state), []);
  });

  it('takes the first dealer from dealerIndex', () => {
    assert.equal(createMatch(somePlayers(5), { dealerIndex: 3 }).dealer, 3);
    assert.equal(createMatch(somePlayers(5), {}).dealer, 0);
    assert.equal(createMatch(somePlayers(5)).dealer, 0);
    assert.equal(createMatch(somePlayers(5)).targetScore, 12);
    assert.equal(createMatch(somePlayers(5), { targetScore: 6 }).targetScore, 6);
    assert.equal(createMatch(somePlayers(5), { dealerIndex: 1, targetScore: 9 }).targetScore, 9);
  });

  it('accepts 2 to 7 players', () => {
    for (let count = 2; count <= 7; count += 1) {
      const state = createMatch(somePlayers(count), { dealerIndex: count - 1 });
      assert.equal(state.players.length, count);
      assert.deepEqual(checkInvariants(state), []);
    }
  });

  it('refuses any other number of players', () => {
    assert.throws(() => createMatch([]), RangeError);
    assert.throws(() => createMatch(somePlayers(1)), RangeError);
    assert.throws(() => createMatch(somePlayers(8)), RangeError);
    assert.throws(() => createMatch(/** @type {any} */ (null)), RangeError);
    assert.throws(() => createMatch(/** @type {any} */ ('ab')), RangeError);
  });

  it('refuses duplicate, empty or malformed players', () => {
    assert.throws(() => createMatch([{ id: 'a', name: 'A' }, { id: 'a', name: 'B' }]), RangeError);
    assert.throws(() => createMatch([{ id: '', name: 'A' }, { id: 'b', name: 'B' }]), TypeError);
    assert.throws(() => createMatch(/** @type {any} */ ([{ id: 'a' }, { id: 'b', name: 'B' }])), TypeError);
    assert.throws(() => createMatch(/** @type {any} */ ([{ id: 1, name: 'A' }, { id: 'b', name: 'B' }])), TypeError);
    assert.throws(() => createMatch(/** @type {any} */ ([null, { id: 'b', name: 'B' }])), TypeError);
  });

  it('refuses a target score that is not 6, 9 or 12', () => {
    for (const targetScore of [0, 1, 3, 7, 11, 13, 15, -6, 6.5, NaN, /** @type {any} */ ('12'), /** @type {any} */ (null)]) {
      if (targetScore === null) continue;
      assert.throws(() => createMatch(somePlayers(3), { targetScore }), RangeError, `target ${String(targetScore)}`);
    }
  });

  it('refuses a dealer that is not a seat', () => {
    for (const dealerIndex of [-1, 3, 1.5, NaN, /** @type {any} */ ('1')]) {
      assert.throws(() => createMatch(somePlayers(3), { dealerIndex }), RangeError);
    }
  });

  it('keeps no reference to its arguments and adds nothing to them', () => {
    const players = [{ id: 'a', name: 'A', secret: 's3cr3t' }, { id: 'b', name: 'B', secret: 'hidden' }];
    const state = createMatch(players);
    players[0].name = 'changed';
    players.pop();
    assert.equal(state.players.length, 2);
    assert.equal(state.players[0].name, 'A');
    assert.equal(JSON.stringify(state).includes('s3cr3t'), false, 'extra fields of the player objects are not copied');
  });
});

describe('deal', () => {
  it('follows the fixed mapping: three cards each from the seat after the dealer, then the vira', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'b' });
    const deck = fullDeck();
    table.do({ type: 'deal', deck });

    assert.deepEqual(table.hand('c').myCards, deck.slice(0, 3));
    assert.deepEqual(table.hand('d').myCards, deck.slice(3, 6));
    assert.deepEqual(table.hand('a').myCards, deck.slice(6, 9));
    assert.deepEqual(table.hand('b').myCards, deck.slice(9, 12));
    assert.equal(table.hand().vira, deck[12]);
    assert.deepEqual(table.rawHand.stock, deck.slice(13));
    assert.deepEqual(table.rawHand.discards, []);

    assert.deepEqual(table.events, [{
      type: 'handDealt', hand: 1, dealer: 'b', leader: 'c', players: ['c', 'd', 'a', 'b'], vira: '7o', manilha: 'Q',
    }]);
    assert.equal(table.state.phase, 'play');
    assert.equal(table.state.handNumber, 1);
    const hand = table.hand();
    assert.equal(hand.number, 1);
    assert.equal(hand.value, 1);
    assert.equal(hand.manilha, 'Q');
    assert.equal(hand.leader, 'c');
    assert.equal(hand.turn, 'c');
    assert.deepEqual(hand.dealtIn, ['c', 'd', 'a', 'b']);
    assert.deepEqual(hand.alive, ['c', 'd', 'a', 'b']);
    assert.deepEqual(hand.ran, []);
    assert.deepEqual(hand.cardCounts, [3, 3, 3, 3]);
    assert.deepEqual(pendingPlayers(table.state), ['c']);
  });

  it('deals 2 players from a 40-card deck and 7 players too', () => {
    const duo = new Table(['a', 'b']);
    duo.do({ type: 'deal', deck: fullDeck() });
    assert.equal(duo.rawHand.stock.length, 40 - 7);

    const full = new Table(['a', 'b', 'c', 'd', 'e', 'f', 'g']);
    full.do({ type: 'deal', deck: fullDeck() });
    assert.deepEqual(full.hand().cardCounts, [3, 3, 3, 3, 3, 3, 3]);
    assert.equal(full.hand().vira, fullDeck()[21]);
    assert.equal(full.rawHand.stock.length, 40 - 22);
  });

  it('gives the cards chosen by a stacked deck (the helper the other tests rely on)', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'a' });
    table.deal({ a: '4o 4e 4c', b: '5o 5e 5c', c: '6o 6e 6c' }, '3p');
    assert.deepEqual(table.hand('a').myCards, ['4o', '4e', '4c']);
    assert.deepEqual(table.hand('b').myCards, ['5o', '5e', '5c']);
    assert.deepEqual(table.hand('c').myCards, ['6o', '6e', '6c']);
    assert.equal(table.hand().vira, '3p');
    assert.equal(table.hand().manilha, '4');
    assert.equal(table.hand().turn, 'b');
  });

  it('rejects anything that is not the 40 distinct cards', () => {
    const table = new Table(['a', 'b', 'c']);
    const deck = fullDeck();
    const badDecks = [
      undefined,
      null,
      'not a deck',
      42,
      {},
      { length: 40 },
      [],
      deck.slice(0, 39),
      [...deck, '4o'],
      [...deck.slice(0, 39), deck[0]],
      [...deck.slice(0, 39), '9o'],
      [...deck.slice(0, 39), ''],
      [...deck.slice(0, 39), null],
      [...deck.slice(0, 39), 7],
      [...deck.slice(0, 39), ['3p']],
      deck.map((card) => card.toLowerCase()),
      new Array(40).fill('4o'),
      new Array(40),
    ];
    for (const bad of badDecks) table.fail({ type: 'deal', deck: bad }, 'bad-deck');
    table.fail({ type: 'deal' }, 'bad-deck');
    assert.equal(table.state.phase, 'deal');
    assert.equal(table.state.handNumber, 0);
  });

  it('is only possible between hands', () => {
    const table = new Table(['a', 'b', 'c']);
    table.do({ type: 'deal', deck: fullDeck() });
    table.fail({ type: 'deal', deck: fullDeck() }, 'wrong-phase');
    table.truco('a');
    table.fail({ type: 'deal', deck: fullDeck() }, 'wrong-phase');
    table.run('b', 'c');
    assert.equal(table.state.phase, 'deal');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.equal(table.state.handNumber, 2);
  });

  it('copies the deck: changing the array afterwards does not reach the state', () => {
    const state = createMatch(somePlayers(3));
    const deck = fullDeck();
    const result = apply(state, { type: 'deal', deck });
    assert.ok(result.ok);
    const before = JSON.stringify(result.state);
    deck.reverse();
    deck.length = 3;
    assert.equal(JSON.stringify(result.state), before);
    assert.deepEqual(checkInvariants(result.state), []);
  });

  it('skips removed players, who are never dealt in again', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'b' });
    table.remove('d');
    const deck = fullDeck();
    table.do({ type: 'deal', deck });
    assert.deepEqual(table.hand().dealtIn, ['c', 'a', 'b']);
    assert.deepEqual(table.hand('c').myCards, deck.slice(0, 3));
    assert.deepEqual(table.hand('a').myCards, deck.slice(3, 6));
    assert.deepEqual(table.hand('b').myCards, deck.slice(6, 9));
    assert.deepEqual(table.hand('d').myCards, []);
    assert.equal(table.hand().vira, deck[9]);
    assert.deepEqual(table.hand().cardCounts, [3, 3, 3, 0]);

    for (let hand = 0; hand < 6; hand += 1) {
      table.truco(table.hand().turn ?? '');
      table.run(...table.hand().alive.filter((id) => id !== table.hand().turn));
      table.do({ type: 'deal', deck: fullDeck() });
      assert.equal(table.hand().dealtIn.includes('d'), false);
      assert.equal(table.hand().dealtIn.length, 3);
    }
  });
});

describe('dealer and first player', () => {
  it('rotate one seat every hand; the first player is the seat after the dealer', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'a' });
    assert.equal(table.view(null).dealer, 'a');
    const seen = [];
    for (let hand = 0; hand < 7; hand += 1) {
      const dealer = table.view(null).dealer;
      const winner = table.quickHand();
      seen.push(`${dealer}>${winner}`);
      assert.equal(table.event('handEnded').winner, winner);
    }
    assert.deepEqual(seen, ['a>b', 'b>c', 'c>a', 'a>b', 'b>c', 'c>a', 'a>b']);
  });

  it('also rotate after a hand in which nobody scored', () => {
    const table = new Table(['a', 'b'], { dealer: 'b' });
    table.deal({ a: '3o 2o Ao', b: '3e 2e Ae' });
    table.plays('a 3o', 'b 3e', 'a 2o', 'b 2e', 'a Ao', 'b Ae');
    assert.equal(table.event('handEnded').winner, null);
    assert.equal(table.view(null).dealer, 'a');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.equal(table.hand().leader, 'b');
  });

  it('skip removed seats', () => {
    const table = new Table(['a', 'b', 'c', 'd', 'e'], { dealer: 'a' });
    table.remove('b');
    table.remove('d');
    const seen = [];
    for (let hand = 0; hand < 6; hand += 1) {
      const dealer = table.view(null).dealer;
      seen.push(`${dealer}>${table.quickHand()}`);
    }
    assert.deepEqual(seen, ['a>c', 'c>e', 'e>a', 'a>c', 'c>e', 'e>a']);
  });

  it('pass to the next seat when the dealer of the coming hand is removed between hands', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'd' });
    table.remove('d');
    assert.equal(table.view(null).dealer, 'a');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.equal(table.hand().leader, 'b');
    assert.deepEqual(table.hand().dealtIn, ['b', 'c', 'a']);
  });

  it('are untouched when someone else is removed between hands', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'd' });
    table.remove('b');
    assert.equal(table.view(null).dealer, 'd');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.deepEqual(table.hand().dealtIn, ['a', 'c', 'd']);
  });

  it('keep the dealer of a hand in progress even if that player is removed, then move on from that seat', () => {
    const table = new Table(['a', 'b', 'c', 'd'], { dealer: 'b' });
    table.do({ type: 'deal', deck: fullDeck() });
    table.remove('b');
    assert.equal(table.view(null).dealer, 'b');
    assert.equal(table.state.phase, 'play');
    table.truco('c');
    table.run('d', 'a');
    assert.equal(table.view(null).dealer, 'c');
    table.do({ type: 'deal', deck: fullDeck() });
    assert.deepEqual(table.hand().dealtIn, ['d', 'a', 'c']);
  });

  it('wrap around the last seat', () => {
    const table = new Table(['a', 'b', 'c'], { dealer: 'c' });
    table.do({ type: 'deal', deck: stackedDeck(table.state, { a: '4o 4e 4c', b: '5o 5e 5c', c: '6o 6e 6c' }, '7o') });
    assert.equal(table.hand().leader, 'a');
    assert.deepEqual(table.hand().dealtIn, ['a', 'b', 'c']);
  });
});

describe('end of the match', () => {
  /** A hand that `a` wins by taking the first two rounds, without raises. */
  const aWinsTwoRounds = { a: '3o 3e 4c', b: '4o 4e 5c' };

  it('comes when a hand takes a player to exactly 12', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 11, b: 11 });
    table.deal(aWinsTwoRounds);
    table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e');
    assert.deepEqual(table.eventTypes, ['cardPlayed', 'roundEnded', 'handEnded', 'matchEnded']);
    assert.deepEqual(table.event('matchEnded'), { type: 'matchEnded', winner: 'a', reason: 'score' });
    assert.equal(table.state.phase, 'over');
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'score' });
    assert.equal(table.score('a'), 12);
    assert.equal(table.score('b'), 11);
    assert.deepEqual(table.view('b').lastHand, { hand: 1, winner: 'a', value: 1, reason: 'rounds' });
  });

  it('comes when a hand takes a player past 12: scores are not capped', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 10, b: 3 });
    table.deal(aWinsTwoRounds);
    table.truco('a');
    table.accept('b');
    table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e');
    assert.equal(table.score('a'), 13);
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'score' });
  });

  it('does not come at 11', () => {
    const table = new Table(['a', 'b']);
    table.setScores({ a: 10, b: 10 });
    table.deal(aWinsTwoRounds);
    table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e');
    assert.equal(table.score('a'), 11);
    assert.equal(table.state.phase, 'deal');
    assert.equal(table.view(null).result, null);
  });

  for (const targetScore of [6, 9, 12]) {
    it(`comes at the chosen target of ${targetScore}, and not one point before`, () => {
      const table = new Table(['a', 'b'], { targetScore });
      assert.equal(table.state.targetScore, targetScore);
      assert.equal(table.view('a').targetScore, targetScore);
      assert.equal(table.view(null).targetScore, targetScore);
      table.setScores({ a: targetScore - 2, b: targetScore - 1 });
      table.deal(aWinsTwoRounds);
      table.plays('a 3o', 'b 4o', 'a 3e', 'b 4e');
      assert.equal(table.score('a'), targetScore - 1);
      assert.equal(table.state.phase, 'deal');

      table.deal({ b: '4o 4e 5c', a: '3o 3e 4c' });
      table.plays('b 4o', 'a 3o', 'a 3e', 'b 4e');
      assert.equal(table.score('a'), targetScore);
      assert.equal(table.state.phase, 'over');
      assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'score' });
    });
  }

  it('with a target of 6, a hand raised to 12 still scores 12', () => {
    const table = new Table(['a', 'b'], { targetScore: 6 });
    table.deal(aWinsTwoRounds);
    table.truco('a');
    table.accept('b');
    table.play('a', '3o');
    table.truco('b');
    table.accept('a');
    table.play('b', '4o');
    table.truco('a');
    table.accept('b');
    table.play('a', '3e');
    table.truco('b');
    table.accept('a');
    table.play('b', '4e');
    assert.equal(table.score('a'), 12);
    assert.deepEqual(table.view(null).result, { winner: 'a', reason: 'score' });
  });

  it('can come from a raise nobody accepted', () => {
    const table = new Table(['a', 'b', 'c']);
    table.setScores({ a: 9, b: 10, c: 11 });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' });
    table.truco('a');
    table.accept('b', 'c');
    table.play('a', '3o');
    table.truco('b');
    table.run('a', 'c');
    assert.deepEqual(table.event('handEnded'), { type: 'handEnded', hand: 1, winner: 'b', value: 3, reason: 'allRan' });
    assert.equal(table.score('b'), 13);
    assert.deepEqual(table.view(null).result, { winner: 'b', reason: 'score' });
  });

  it('freezes everything: no action is accepted afterwards', () => {
    const table = new Table(['a', 'b', 'c']);
    table.setScores({ a: 11 });
    table.deal({ a: '3o 3e 4c', b: '4o 4e 5c', c: '5o 5e 6c' });
    table.plays('a 3o', 'b 4o', 'c 5o', 'a 3e', 'b 4e', 'c 5e');
    assert.equal(table.state.phase, 'over');

    table.fail({ type: 'deal', deck: fullDeck() }, 'match-over');
    table.fail({ type: 'play', playerId: 'a', card: '4c' }, 'match-over');
    table.fail({ type: 'truco', playerId: 'a' }, 'match-over');
    table.fail({ type: 'respond', playerId: 'b', accept: true }, 'match-over');
    table.fail({ type: 'remove', playerId: 'b' }, 'match-over');
    table.fail({ type: 'remove', playerId: 'nobody' }, 'match-over');
    assert.deepEqual(pendingPlayers(table.state), []);
    // The last hand stays on display.
    assert.equal(table.hand().rounds.length, 2);
    assert.equal(table.hand().turn, null);
  });
});
