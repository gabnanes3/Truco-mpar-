// The simulation tests for one table size. Each size has its own test file (players-2.test.js and so on)
// because the test runner gives every file its own process: the six sizes then run side by side and
// thousands of fully inspected matches still take only a few seconds.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { playMatch } from './simulator.js';

/**
 * Random matches per table size: 2060 in total. Bigger tables need more actions per match, so they get fewer
 * matches and every size ends up with a similar number of inspected steps (around 30 thousand).
 * @type {Record<number, number>}
 */
const RANDOM_MATCHES = { 2: 520, 3: 400, 4: 340, 5: 300, 6: 260, 7: 240 };
const TIMEOUT_MATCHES = 6;
const TARGETS = [6, 9, 12];

/** Everything a healthy run of random matches must have gone through, for any table size. */
const EXPECTED_SITUATIONS = [
  'handDealt', 'cardPlayed', 'roundEnded', 'trucoCalled', 'trucoAnswered', 'trucoResolved', 'trucoCancelled',
  'playerLeftHand', 'playerRemoved', 'handEnded', 'matchEnded',
  'hand:rounds', 'hand:allRan', 'hand:lastStanding',
  'value:1', 'value:3', 'value:6', 'value:9', 'value:12',
  'match:score', 'match:abandon',
];

/**
 * Defines the simulation tests for tables of `playerCount` players.
 * @param {number} playerCount
 */
export function simulateTable(playerCount) {
  const matches = RANDOM_MATCHES[playerCount];
  describe(`simulation with ${playerCount} players`, () => {
    it(`${matches} matches of random valid actions stay healthy at every step and all end`, () => {
      /** @type {Record<string, number>} */
      const seen = {};
      let steps = 0;
      for (let match = 0; match < matches; match += 1) {
        const report = playMatch({ seed: playerCount * 1_000_000 + match, playerCount, targetScore: TARGETS[match % TARGETS.length] });
        assert.equal(report.state.phase, 'over');
        steps += report.steps;
        for (const [situation, times] of Object.entries(report.seen)) seen[situation] = (seen[situation] ?? 0) + times;
      }
      // The seeds are fixed, so this is not a matter of luck: it proves the run really exercised the engine.
      const missing = EXPECTED_SITUATIONS.filter((situation) => !(situation in seen));
      assert.deepEqual(missing, [], `situations never reached in ${steps} steps`);
      assert.equal(seen.matchEnded, matches);
      assert.equal(seen['match:score'] + seen['match:abandon'], matches);
      assert.equal(seen.handEnded, seen.handDealt, 'every hand that was dealt ended');
    });

    it(`${TIMEOUT_MATCHES} matches where every action is the timeout default still end, by score`, () => {
      for (let match = 0; match < TIMEOUT_MATCHES; match += 1) {
        const targetScore = TARGETS[match % TARGETS.length];
        const report = playMatch({ seed: playerCount * 2_000_000 + match, playerCount, targetScore, timeoutsOnly: true });
        const { state, seen } = report;
        assert.deepEqual(state.result?.reason, 'score');
        // Nobody raises and nobody runs, so every hand is worth 1 and the winner stops exactly at the target.
        assert.equal(seen.trucoCalled, undefined);
        assert.equal(seen.playerLeftHand, undefined);
        assert.equal(state.players[state.result?.winner ?? 0].score, targetScore);
        assert.equal(state.players.filter((player) => player.score >= targetScore).length, 1);
        // A hand is at most one deal plus three cards per player; ties aside, the scores add up to the hands.
        const scoringHands = state.players.reduce((sum, player) => sum + player.score, 0);
        assert.equal(seen.handEnded - (seen['hand:allTied'] ?? 0), scoringHands);
        assert.ok(report.steps <= seen.handDealt * (1 + 3 * playerCount));
      }
    });
  });
}
