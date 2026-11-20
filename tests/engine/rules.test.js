import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { LADDER, MAX_PLAYERS, MIN_PLAYERS, TARGET_SCORE } from '../../app/js/engine/game.js';
import { HAND_SIZE, decideHand, nextValue, roundWinner, seatOrder } from '../../app/js/engine/rules.js';

/** @typedef {import('../../app/js/engine/types.js').Play} Play */

/**
 * @param {...string} text plays as "seat card", a trailing "x" marking a voided card: `plays('0 3o', '1 4ox')`
 * @returns {Play[]}
 */
function plays(...text) {
  return text.map((entry) => {
    const [seat, card] = entry.split(' ');
    return { seat: Number(seat), card: card.slice(0, 2), voided: card.endsWith('x') };
  });
}

describe('constants', () => {
  it('match the rules of the game', () => {
    assert.equal(TARGET_SCORE, 12);
    assert.deepEqual([...LADDER], [1, 3, 6, 9, 12]);
    assert.equal(MIN_PLAYERS, 2);
    assert.equal(MAX_PLAYERS, 7);
    assert.equal(HAND_SIZE, 3);
  });
});

describe('nextValue', () => {
  it('climbs the ladder 1 → 3 → 6 → 9 → 12 and stops there', () => {
    assert.deepEqual([1, 3, 6, 9, 12].map(nextValue), [3, 6, 9, 12, null]);
  });

  it('has no next step for values that are not on the ladder', () => {
    assert.deepEqual([0, 2, 4, 13, -1, NaN].map(nextValue), [null, null, null, null, null, null]);
  });
});

describe('seatOrder', () => {
  it('goes up from the starting seat and wraps', () => {
    assert.deepEqual(seatOrder(5, 0), [0, 1, 2, 3, 4]);
    assert.deepEqual(seatOrder(5, 3), [3, 4, 0, 1, 2]);
    assert.deepEqual(seatOrder(2, 1), [1, 0]);
    assert.deepEqual(seatOrder(7, 6), [6, 0, 1, 2, 3, 4, 5]);
  });
});

describe('roundWinner', () => {
  it('is the seat with the strongest card', () => {
    assert.equal(roundWinner(plays('0 4o', '1 3e', '2 Kc'), 'Q'), 1);
    assert.equal(roundWinner(plays('2 Ko', '0 5e', '1 6c'), 'Q'), 2);
  });

  it('lets a manilha beat a 3, and the higher suit win between manilhas', () => {
    assert.equal(roundWinner(plays('0 3o', '1 Qo', '2 3p'), 'Q'), 1);
    assert.equal(roundWinner(plays('0 Qc', '1 Qp', '2 Qe'), 'Q'), 1);
  });

  it('is a tie when the strongest strength is shared, even if a weaker card was also played', () => {
    assert.equal(roundWinner(plays('0 3o', '1 3e'), 'Q'), null);
    assert.equal(roundWinner(plays('0 3o', '1 4e', '2 3p'), 'Q'), null);
    assert.equal(roundWinner(plays('0 Ko', '1 Ke', '2 Kc', '3 Kp'), 'Q'), null);
  });

  it('is not a tie when only weaker cards are equal', () => {
    assert.equal(roundWinner(plays('0 5o', '1 5e', '2 6c'), 'Q'), 2);
    assert.equal(roundWinner(plays('0 6c', '1 5o', '2 5e'), 'Q'), 0);
    assert.equal(roundWinner(plays('0 5o', '1 5e', '2 5c', '3 Ao'), 'Q'), 3);
  });

  it('ignores voided cards', () => {
    assert.equal(roundWinner(plays('0 3ox', '1 4e', '2 5c'), 'Q'), 2);
    assert.equal(roundWinner(plays('0 3o', '1 3ex', '2 5c'), 'Q'), 0);
    assert.equal(roundWinner(plays('0 Qpx', '1 4e', '2 4c'), 'Q'), null);
  });

  it('has no winner when nothing counts', () => {
    assert.equal(roundWinner([], 'Q'), null);
    assert.equal(roundWinner(plays('0 3ox'), 'Q'), null);
  });
});

describe('decideHand (spec 2.1)', () => {
  const A = 0;
  const B = 1;
  const C = 2;
  const everyone = [A, B, C];
  /** @param {number} winner */
  const wonBy = (winner) => ({ winner, reason: 'rounds' });

  it('rule 1: a single player left wins, whatever the rounds say', () => {
    assert.deepEqual(decideHand([B], []), { winner: B, reason: 'lastStanding' });
    assert.deepEqual(decideHand([B], [A]), { winner: B, reason: 'lastStanding' });
    assert.deepEqual(decideHand([C], [A, B]), { winner: C, reason: 'lastStanding' });
    assert.deepEqual(decideHand([C], [null, null]), { winner: C, reason: 'lastStanding' });
  });

  it('rule 2: a player with two rounds wins', () => {
    assert.deepEqual(decideHand(everyone, [A, A]), wonBy(A));
    assert.deepEqual(decideHand(everyone, [A, B, A]), wonBy(A));
    assert.deepEqual(decideHand(everyone, [A, B, B]), wonBy(B));
  });

  it('rule 3: with the first round tied, the second round decides', () => {
    assert.deepEqual(decideHand(everyone, [null, B]), wonBy(B));
  });

  it('rule 3: with the second round tied, the first round decides', () => {
    assert.deepEqual(decideHand(everyone, [A, null]), wonBy(A));
  });

  it('rule 4: three different winners → the first-round winner', () => {
    assert.deepEqual(decideHand(everyone, [A, B, C]), wonBy(A));
    assert.deepEqual(decideHand(everyone, [C, A, B]), wonBy(C));
  });

  it('rule 4: third round tied after two different winners → the first-round winner', () => {
    assert.deepEqual(decideHand(everyone, [B, A, null]), wonBy(B));
  });

  it('rule 4: two ties, then the third round decides', () => {
    assert.deepEqual(decideHand(everyone, [null, null, C]), wonBy(C));
  });

  it('rule 4: three rounds without a winner → nobody scores', () => {
    assert.deepEqual(decideHand(everyone, [null, null, null]), { winner: null, reason: 'allTied' });
  });

  it('rule 5: otherwise the hand goes on', () => {
    assert.equal(decideHand(everyone, []), null);
    assert.equal(decideHand(everyone, [A]), null);
    assert.equal(decideHand(everyone, [null]), null);
    assert.equal(decideHand(everyone, [A, B]), null);
    assert.equal(decideHand(everyone, [null, null]), null);
    assert.equal(decideHand([A, B], []), null);
  });

  it('treats a round won by someone who left the hand as a round without a winner', () => {
    // C won the first round and left: the second round decides (rule 3)...
    assert.deepEqual(decideHand([A, B], [C, B]), wonBy(B));
    // ...or the hand simply goes on.
    assert.equal(decideHand([A, B], [C]), null);
    assert.equal(decideHand([A, B], [C, null]), null);
    // B took the second round and left: the first round decides (rule 3).
    assert.deepEqual(decideHand([A, C], [A, B]), wonBy(A));
    // The player with two rounds left before the hand could end by rule 2... the rounds no longer count.
    assert.deepEqual(decideHand([A, B], [C, C, B]), wonBy(B));
    assert.deepEqual(decideHand([A, B], [C, null, null]), { winner: null, reason: 'allTied' });
    assert.deepEqual(decideHand([A, B], [C, C, C]), { winner: null, reason: 'allTied' });
  });

  it('never names a winner who is not in the hand', () => {
    const outcomes = [null, A, B, C];
    for (const alive of [[A, B], [A, C], [B, C], everyone]) {
      for (const first of outcomes) {
        for (const second of outcomes) {
          for (const third of outcomes) {
            for (const winners of [[first], [first, second], [first, second, third]]) {
              const verdict = decideHand(alive, winners);
              if (verdict !== null && verdict.winner !== null) assert.ok(alive.includes(verdict.winner));
              if (winners.length === HAND_SIZE) assert.notEqual(verdict, null, 'three rounds always end the hand');
            }
          }
        }
      }
    }
  });

  it('agrees with an independent reading of the rules for every possible sequence of rounds', () => {
    /**
     * The same rules told the way players say them at the table.
     * @param {(number | null)[]} eff
     * @returns {number | null | undefined} winner, null for nobody, undefined when the hand goes on
     */
    const tableTalk = (eff) => {
      const [first, second, third] = eff;
      if (eff.length === 2) {
        if (first !== null && first === second) return first; // won two
        if (first === null && second !== null) return second; // first tied: whoever takes the second
        if (first !== null && second === null) return first; // second tied: whoever took the first
        return undefined;
      }
      if (eff.length === 3) {
        if (third !== null && (third === first || third === second)) return third; // third makes two
        if (first !== null) return first; // third tied or won by an outsider: the first round rules
        return third; // everything tied so far: the third decides, or nobody
      }
      return undefined;
    };
    const outcomes = [null, A, B, C];
    for (const first of outcomes) {
      for (const second of outcomes) {
        for (const third of outcomes) {
          for (const winners of [[first], [first, second], [first, second, third]]) {
            // A hand that was decided after two rounds never reaches the third.
            if (winners.length === 3 && tableTalk([first, second]) !== undefined) continue;
            const verdict = decideHand(everyone, winners);
            const expected = tableTalk(winners);
            assert.equal(verdict === null ? undefined : verdict.winner, expected, JSON.stringify(winners));
          }
        }
      }
    }
  });
});
