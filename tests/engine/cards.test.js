import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  RANKS, SUITS, fullDeck, isCard, isManilha, manilhaRank, rankOf, strength, suitOf, weakestCard,
} from '../../app/js/engine/cards.js';

describe('deck', () => {
  it('has the truco ranks and suits, weakest first', () => {
    assert.deepEqual([...RANKS], ['4', '5', '6', '7', 'Q', 'J', 'K', 'A', '2', '3']);
    assert.deepEqual([...SUITS], ['o', 'e', 'c', 'p']);
  });

  it('has 40 distinct valid cards, and a fresh array on every call', () => {
    const deck = fullDeck();
    assert.equal(deck.length, 40);
    assert.equal(new Set(deck).size, 40);
    assert.ok(deck.every(isCard));
    assert.ok(['4o', 'Qp', '3c', 'Ae', '2o', '7p'].every((card) => deck.includes(card)));
    assert.notEqual(fullDeck(), deck);
  });

  it('recognises card ids and nothing else', () => {
    for (const card of fullDeck()) assert.equal(isCard(card), true);
    const impostors = ['', '4', '4oo', 'o4', '1o', '8p', '9c', 'Tc', '10o', 'qp', '4O', '4x', ' 4o', null, undefined, 4, {}, ['4o']];
    for (const impostor of impostors) assert.equal(isCard(impostor), false, `isCard(${JSON.stringify(impostor)})`);
  });

  it('splits an id into rank and suit', () => {
    assert.equal(rankOf('Qp'), 'Q');
    assert.equal(suitOf('Qp'), 'p');
    for (const card of fullDeck()) assert.equal(rankOf(card) + suitOf(card), card);
  });

  it('refuses ids that are not cards instead of guessing', () => {
    assert.throws(() => rankOf('9o'), RangeError);
    assert.throws(() => suitOf('4x'), RangeError);
    assert.throws(() => manilhaRank('zz'), RangeError);
    assert.throws(() => strength('', '4'), RangeError);
    assert.throws(() => isManilha(/** @type {any} */ (undefined), '4'), RangeError);
  });
});

describe('manilha', () => {
  it('is the rank right after the vira, for every vira', () => {
    /** @type {Record<string, string>} */
    const expected = { 4: '5', 5: '6', 6: '7', 7: 'Q', Q: 'J', J: 'K', K: 'A', A: '2', 2: '3', 3: '4' };
    assert.equal(Object.keys(expected).length, 10);
    for (const vira of fullDeck()) assert.equal(manilhaRank(vira), expected[rankOf(vira)], `vira ${vira}`);
  });

  it('wraps around: a vira 3 makes the 4s manilhas', () => {
    for (const suit of SUITS) assert.equal(manilhaRank(`3${suit}`), '4');
    assert.equal(isManilha('4o', '4'), true);
    assert.ok(strength('4o', '4') > strength('3p', '4'));
  });

  it('marks exactly the four cards of the manilha rank', () => {
    for (const manilha of RANKS) {
      const manilhas = fullDeck().filter((card) => isManilha(card, manilha));
      assert.deepEqual(manilhas, SUITS.map((suit) => manilha + suit));
    }
  });

  it('orders the manilhas by suit: paus > copas > espadas > ouros', () => {
    for (const manilha of RANKS) {
      const [ouros, espadas, copas, paus] = ['o', 'e', 'c', 'p'].map((suit) => strength(manilha + suit, manilha));
      assert.ok(paus > copas && copas > espadas && espadas > ouros, `manilha ${manilha}`);
    }
  });

  it('beats every card that is not a manilha', () => {
    for (const manilha of RANKS) {
      const weakestManilha = strength(`${manilha}o`, manilha);
      for (const card of fullDeck()) {
        if (!isManilha(card, manilha)) assert.ok(strength(card, manilha) < weakestManilha, `${card} vs manilha ${manilha}`);
      }
    }
  });
});

describe('strength', () => {
  it('follows the rank order 4 5 6 7 Q J K A 2 3 for cards that are not manilhas', () => {
    for (const manilha of RANKS) {
      const others = RANKS.filter((rank) => rank !== manilha);
      for (let index = 1; index < others.length; index += 1) {
        for (const suit of SUITS) {
          for (const otherSuit of SUITS) {
            assert.ok(
              strength(others[index] + suit, manilha) > strength(others[index - 1] + otherSuit, manilha),
              `${others[index]}${suit} must beat ${others[index - 1]}${otherSuit} when the manilha is ${manilha}`,
            );
          }
        }
      }
    }
  });

  it('ignores the suit of cards that are not manilhas: equal ranks tie', () => {
    for (const manilha of RANKS) {
      for (const rank of RANKS.filter((candidate) => candidate !== manilha)) {
        const strengths = SUITS.map((suit) => strength(rank + suit, manilha));
        assert.equal(new Set(strengths).size, 1, `${rank}s with manilha ${manilha}`);
      }
    }
  });

  it('gives every manilha a different strength', () => {
    for (const manilha of RANKS) {
      assert.equal(new Set(SUITS.map((suit) => strength(manilha + suit, manilha))).size, 4);
    }
  });
});

describe('weakestCard', () => {
  it('picks the lowest strength', () => {
    assert.equal(weakestCard(['3o', '5p', 'Kc'], 'Q'), '5p');
    assert.equal(weakestCard(['2e', 'Ap', 'Jo'], 'Q'), 'Jo');
  });

  it('never treats a manilha as weak, whatever its rank', () => {
    assert.equal(weakestCard(['4p', '5o', '3c'], '4'), '5o');
    assert.equal(weakestCard(['4p', '4o', '3c'], '4'), '3c');
    assert.equal(weakestCard(['4p', '4o', '4e'], '4'), '4o');
  });

  it('breaks ties between equal strengths by the lowest suit', () => {
    assert.equal(weakestCard(['5p', '5c', '5e'], 'Q'), '5e');
    assert.equal(weakestCard(['5p', '5o', '6e'], 'Q'), '5o');
  });

  it('does not depend on the order of the cards', () => {
    const cards = ['5p', '5e', 'Qo', '3c', '5c'];
    const orders = [cards, [...cards].reverse(), [...cards].sort(), ['3c', '5c', 'Qo', '5p', '5e']];
    for (const order of orders) assert.equal(weakestCard(order, 'Q'), '5e');
  });

  it('returns the only card, and null for an empty hand', () => {
    assert.equal(weakestCard(['Qp'], 'Q'), 'Qp');
    assert.equal(weakestCard([], 'Q'), null);
  });

  it('does not change the list it is given', () => {
    const cards = Object.freeze(['3o', '5p', 'Kc']);
    weakestCard(cards, 'Q');
    assert.deepEqual([...cards], ['3o', '5p', 'Kc']);
  });
});
