// Whole matches over the (in-memory) network. The Table's message scan runs on every message sent, so each
// of these also proves that no guest is ever sent another player's hidden card or anybody's secret.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { Table, actAtRandom, identityOf, seededRandom } from './support.js';

/** @typedef {import('../../app/js/net/types.js').RoomSnapshot} RoomSnapshot */

const GUESTS = ['Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Gil'];

/**
 * The room may never be in a state where a match is running and nothing will ever wake it up.
 * @param {Table} table
 */
function assertAlive(table) {
  const { room } = table;
  if (room.phase !== 'match') return;
  assert.notEqual(room.deadline, null, 'a running match has a deadline');
  assert.notEqual(room.deadlineTimer, null, 'a running match has its timer armed');
}

describe('a whole match over the network', () => {
  for (const [players, targetScore, seed] of /** @type {[number, 6 | 9 | 12, number][]} */ ([[3, 6, 11], [5, 9, 12], [7, 12, 13]])) {
    it(`${players} clients playing at random reach the end (target ${targetScore}) and agree on everything public`, () => {
      const table = new Table({ seed, config: { handPauseMs: 300 } });
      const names = GUESTS.slice(0, players - 1);
      table.joinAll(...names);
      table.host.setTargetScore(targetScore);
      table.host.start();
      table.settle();

      const random = seededRandom(seed);
      const everyone = ['Ana', ...names];
      /** @type {Record<string, number>} */
      const eventsSeen = {};
      table.host.subscribe((snapshot) => {
        for (const event of snapshot.events) eventsSeen[event.type] = (eventsSeen[event.type] ?? 0) + 1;
      });
      let steps = 0;
      while (table.snap('Ana').room.phase === 'match') {
        steps += 1;
        assert.ok(steps < 20000, 'the match did not end');
        const acted = everyone.filter((name) => actAtRandom(table.client(name), random)).length;
        table.settle(acted > 0 ? 20 : 100);
        assertAlive(table);
      }

      const final = table.snap('Ana');
      const winner = final.game?.players.find((player) => player.id === final.game?.result?.winner);
      assert.equal(final.room.phase, 'ended');
      assert.equal(final.game?.result?.reason, 'score');
      assert.ok(winner !== undefined && winner.score >= targetScore);
      assert.equal(final.game?.targetScore, targetScore);
      assert.equal(final.timer, null);
      for (const name of names) {
        const theirs = table.snap(name);
        assert.equal(theirs.seq, final.seq);
        assert.deepEqual(theirs.room, final.room);
        assert.deepEqual(theirs.game?.players, final.game?.players);
        assert.deepEqual(theirs.game?.result, final.game?.result);
        assert.equal(theirs.game?.viewer, identityOf(name).playerId);
      }
      for (const type of ['handDealt', 'cardPlayed', 'roundEnded', 'trucoCalled', 'trucoResolved', 'handEnded', 'matchEnded']) {
        assert.ok(eventsSeen[type] > 0, `no ${type} event was broadcast`);
      }
      assert.equal(eventsSeen.matchEnded, 1);

      // Nobody dropped, so every guest saw every broadcast: the numbers have no holes.
      table.assertSequences();
      for (const name of names) {
        const seqs = [...new Set((table.statesTo.get(identityOf(name).playerId) ?? []).map((state) => state.seq))];
        assert.equal(seqs.length, seqs[seqs.length - 1] - seqs[0] + 1, `${name} missed a broadcast`);
        assert.equal(seqs[seqs.length - 1], final.seq);
      }
    });
  }

  it('finishes by itself when every guest vanished and the host never touches the screen', () => {
    const table = new Table({ seed: 21 });
    table.joinAll('Bia', 'Caio', 'Duda');
    table.host.setTargetScore(6);
    table.host.start();
    table.settle();
    for (const name of ['Bia', 'Caio', 'Duda']) table.net.dropGuest(identityOf(name).playerId, { silent: true });
    for (const name of ['Bia', 'Caio', 'Duda']) table.client(name).close();

    let waited = 0;
    while (table.snap('Ana').room.phase === 'match') {
      table.clock.advance(1000);
      waited += 1000;
      assertAlive(table);
      assert.ok(waited < 3_600_000, 'the match did not end by timeouts alone');
    }
    const final = table.snap('Ana');
    assert.equal(final.game?.result?.reason, 'score');
    assert.deepEqual(final.room.members.map((member) => member.connected), [true, false, false, false]);
  });

  it('goes on to a second match with the same people after "nova partida"', () => {
    const table = new Table({ seed: 5, config: { handPauseMs: 300 } });
    table.joinAll('Bia', 'Caio');
    table.host.setTargetScore(6);
    const random = seededRandom(5);
    for (let match = 1; match <= 2; match += 1) {
      table.host.start();
      table.settle();
      assert.equal(table.snap('Caio').game?.handNumber, 1);
      for (let steps = 0; table.snap('Ana').room.phase === 'match'; steps += 1) {
        assert.ok(steps < 20000);
        const acted = ['Ana', 'Bia', 'Caio'].filter((name) => actAtRandom(table.client(name), random)).length;
        table.settle(acted > 0 ? 20 : 100);
      }
      assert.equal(table.snap('Bia').room.phase, 'ended');
      table.client('Bia').newMatch();
      table.settle();
      assert.equal(table.snap('Bia').room.phase, 'ended');
      table.host.newMatch();
      table.settle();
      assert.deepEqual([table.snap('Bia').room.phase, table.snap('Bia').game], ['lobby', null]);
      assert.deepEqual(table.roster(), ['Ana', 'Bia', 'Caio']);
    }
  });
});
