import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { GuestClient } from '../../app/js/net/guest-client.js';
import { HostRoom } from '../../app/js/net/host-room.js';
import { normalizeCode } from '../../app/js/net/protocol.js';
import { MemoryStorage, Table, identityOf } from './support.js';

const SEVEN = ['Bia', 'Caio', 'Duda', 'Edu', 'Fabi', 'Gil'];

describe('lobby', () => {
  it('starts with the host alone, online, and the first snapshot ready at once', () => {
    const table = new Table();
    const snapshot = table.snap('Ana');
    assert.equal(normalizeCode(table.code), table.code);
    assert.deepEqual(snapshot.room, {
      code: table.code,
      phase: 'lobby',
      settings: { targetScore: 12 },
      members: [{ id: 'player-ana', name: 'Ana', role: 'player', connected: true, isHost: true }],
    });
    assert.deepEqual(snapshot.you, { id: 'player-ana', role: 'player', isHost: true });
    assert.deepEqual([snapshot.game, snapshot.timer, snapshot.error, snapshot.connection], [null, null, null, 'online']);
    assert.equal(HostRoom.storedCode(table.env(table.hostStorage, 0)), table.code);
  });

  it('seats guests in join order and shows everybody the same room', () => {
    const table = new Table();
    const bia = table.join('Bia');
    assert.equal(bia.getSnapshot().connection, 'online');
    table.join('Caio');
    assert.deepEqual(table.roster(), ['Ana', 'Bia', 'Caio']);
    assert.deepEqual(table.snap('Bia').room, table.snap('Ana').room);
    assert.deepEqual(table.snap('Caio').room, table.snap('Ana').room);
    assert.deepEqual(table.snap('Caio').you, { id: 'player-caio', role: 'player', isHost: false });
    assert.equal(table.snap('Bia').seq, table.snap('Ana').seq);
    assert.ok(table.snap('Bia').room.members.every((member) => member.connected));
  });

  it('gives a placeholder snapshot while connecting, then the real room', () => {
    const table = new Table();
    const guest = new GuestClient({
      transport: table.net.transport('player-bia'),
      code: ` ${table.code.toLowerCase()} `,
      identity: identityOf('Bia'),
      env: table.env(new MemoryStorage(), 9),
    });
    /** @type {string[]} */
    const seen = [];
    const unsubscribe = guest.subscribe((snapshot) => seen.push(snapshot.connection));
    const placeholder = guest.getSnapshot();
    assert.deepEqual([placeholder.connection, placeholder.seq, placeholder.room.members, placeholder.game], ['connecting', 0, [], null]);
    table.settle();
    assert.deepEqual(seen, ['online']);
    assert.equal(guest.getSnapshot().room.members.length, 2);
    const { receivedAt } = guest.getSnapshot();
    assert.ok(receivedAt > table.clock.now() - 20 && receivedAt < table.clock.now());

    unsubscribe();
    table.join('Caio');
    assert.deepEqual(seen, ['online']);
    assert.equal(guest.getSnapshot().room.members.length, 3);
  });

  it('disambiguates duplicate names and replaces unusable ones', () => {
    const table = new Table();
    table.join('ana', { identity: { ...identityOf('ana-two'), name: ' ana ' } });
    table.join('Ana!', { identity: { ...identityOf('ana-three'), name: 'ANA' } });
    table.join('blank', { identity: { ...identityOf('blank'), name: '\n\t ' } });
    table.join('long', { identity: { ...identityOf('long'), name: 'Um nome comprido demais' } });
    assert.deepEqual(table.roster(), ['Ana', 'ana 2', 'ANA 3', 'Jogador', 'Um nome compri']);
  });

  it('lets only the host start, and only with two players', () => {
    const table = new Table();
    table.host.start();
    table.settle();
    assert.equal(table.snap('Ana').room.phase, 'lobby');

    const bia = table.join('Bia');
    bia.start();
    table.settle();
    assert.equal(table.snap('Ana').room.phase, 'lobby');

    table.host.start();
    table.settle();
    for (const name of ['Ana', 'Bia']) {
      const snapshot = table.snap(name);
      assert.equal(snapshot.room.phase, 'match');
      assert.equal(snapshot.game?.phase, 'play');
      assert.equal(table.hand(name).myCards.length, 3);
      assert.deepEqual(snapshot.timer?.players, [table.hand('Ana').turn]);
      assert.equal(snapshot.timer?.totalMs, 15000);
    }
    assert.notDeepEqual(table.hand('Ana').myCards, table.hand('Bia').myCards);
  });

  it('lets the host, and nobody else, choose 6, 9 or 12 — in the lobby only — and the match honours it', () => {
    const table = new Table();
    const bia = table.join('Bia');
    table.host.setTargetScore(6);
    table.settle();
    assert.equal(table.snap('Bia').room.settings.targetScore, 6);

    bia.setTargetScore(9);
    table.host.setTargetScore(/** @type {any} */ (7));
    table.host.setTargetScore(/** @type {any} */ ('12'));
    table.settle();
    assert.equal(table.snap('Ana').room.settings.targetScore, 6);

    table.host.start();
    table.settle();
    assert.equal(table.snap('Bia').game?.targetScore, 6);
    assert.equal(table.room.matchState?.targetScore, 6);
    table.host.setTargetScore(12);
    table.settle();
    assert.equal(table.snap('Ana').room.settings.targetScore, 6);

    // The match ends (Bia walks out), and the choice is still there for the next one.
    bia.leave();
    table.settle();
    assert.equal(table.snap('Ana').room.phase, 'ended');
    table.host.newMatch();
    table.settle();
    assert.deepEqual([table.snap('Ana').room.phase, table.snap('Ana').room.settings.targetScore], ['lobby', 6]);
  });

  it('takes 7 players, then 8 spectators, then nobody', () => {
    const table = new Table();
    table.joinAll(...SEVEN);
    const watchers = ['W1', 'W2', 'W3', 'W4', 'W5', 'W6', 'W7', 'W8'];
    table.joinAll(...watchers);
    assert.deepEqual(table.roster(), ['Ana', ...SEVEN, ...watchers.map((name) => `*${name}`)]);
    assert.deepEqual(table.snap('W1').you, { id: 'player-w1', role: 'spectator', isHost: false });

    const late = table.join('Zeca');
    assert.deepEqual([late.getSnapshot().connection, late.getSnapshot().error], ['closed', 'full']);
    assert.equal(table.roster().length, 15);

    // A seat that frees up in the lobby goes to the first spectator.
    table.client('Caio').leave();
    table.settle();
    assert.deepEqual(table.roster().slice(0, 8), ['Ana', 'Bia', 'Duda', 'Edu', 'Fabi', 'Gil', 'W1', '*W2']);
  });

  it('answers "not found" for a room that does not exist', () => {
    const table = new Table();
    const lost = table.join('Bia', { code: table.code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ' });
    assert.equal(lost.getSnapshot().connection, 'connecting');
    table.clock.advance(1500);
    assert.deepEqual([lost.getSnapshot().connection, lost.getSnapshot().error], ['closed', 'not-found']);
  });
});

describe('spectators', () => {
  it('watch a match they arrived late for, without any cards, and are seated in the next one', () => {
    const table = new Table();
    table.start('Bia');
    const caio = table.join('Caio');
    const duda = table.join('Duda');
    assert.deepEqual(table.roster(), ['Ana', 'Bia', '*Caio', '*Duda']);
    assert.equal(caio.getSnapshot().you.role, 'spectator');
    assert.deepEqual(table.hand('Caio').myCards, []);
    assert.equal(caio.getSnapshot().game?.viewer, null);
    assert.equal(table.hand('Caio').vira, table.hand('Ana').vira);

    // A spectator cannot play, raise or answer.
    const before = table.room.matchState;
    caio.play(table.hand('Ana').myCards[0]);
    caio.raise();
    caio.respond(true);
    table.settle();
    assert.equal(table.room.matchState, before);

    table.client('Bia').leave();
    table.settle();
    assert.equal(table.snap('Caio').room.phase, 'ended');
    assert.deepEqual(table.snap('Caio').game?.result, { winner: 'player-ana', reason: 'abandon' });
    duda.newMatch();
    table.settle();
    assert.equal(table.snap('Ana').room.phase, 'ended');

    table.host.newMatch();
    table.settle();
    assert.deepEqual(table.roster(), ['Ana', 'Caio', 'Duda']);
    assert.deepEqual([table.snap('Duda').room.phase, table.snap('Duda').game, table.snap('Duda').you.role], ['lobby', null, 'player']);
    table.host.start();
    table.settle();
    assert.equal(table.hand('Duda').myCards.length, 3);
  });
});

describe('kick and leave', () => {
  it('in the lobby: a kicked guest is told, loses the seat and cannot come back', () => {
    const table = new Table();
    const [bia] = table.joinAll('Bia', 'Caio');
    table.client('Caio').kick('player-bia');
    table.host.kick('player-ana');
    table.host.kick('player-nobody');
    table.settle();
    assert.deepEqual(table.roster(), ['Ana', 'Bia', 'Caio']);

    table.host.kick('player-bia');
    table.settle(500);
    assert.deepEqual(table.roster(), ['Ana', 'Caio']);
    assert.deepEqual([bia.getSnapshot().connection, bia.getSnapshot().error], ['closed', 'kicked']);
    const again = table.join('Bia');
    assert.deepEqual([again.getSnapshot().connection, again.getSnapshot().error], ['closed', 'kicked']);
    assert.deepEqual(table.roster(), ['Ana', 'Caio']);
  });

  it('in the lobby: a guest who leaves frees the seat and may join again later', () => {
    const table = new Table();
    const [bia] = table.joinAll('Bia', 'Caio');
    bia.leave();
    table.settle(500);
    assert.deepEqual([bia.getSnapshot().connection, bia.getSnapshot().error], ['closed', null]);
    assert.deepEqual(table.roster(), ['Ana', 'Caio']);
    table.join('Bia');
    assert.deepEqual(table.roster(), ['Ana', 'Caio', 'Bia']);
  });

  it('mid-match: the kicked player is removed from the game, which goes on with the others', () => {
    const table = new Table();
    table.start('Bia', 'Caio');
    table.host.kick('player-caio');
    table.settle(500);
    const snapshot = table.snap('Bia');
    assert.deepEqual(table.roster(), ['Ana', 'Bia']);
    assert.equal(snapshot.room.phase, 'match');
    assert.deepEqual(snapshot.game?.players.map((player) => player.removed), [false, false, true]);
    assert.ok(snapshot.events.some((event) => event.type === 'playerRemoved' && event.playerId === 'player-caio'));
    assert.equal(table.client('Caio').getSnapshot()?.error, 'kicked');
    assert.equal(table.join('Caio').getSnapshot().error, 'kicked');
  });

  it('mid-match: a player who leaves is out of the game; with one player left the match is over', () => {
    const table = new Table();
    table.start('Bia', 'Caio');
    table.client('Caio').leave();
    table.settle(500);
    assert.deepEqual(table.roster(), ['Ana', 'Bia']);
    assert.equal(table.snap('Ana').room.phase, 'match');

    // Whoever left may come back to watch, and plays again in the next match.
    const back = table.join('Caio');
    assert.equal(back.getSnapshot().you.role, 'spectator');
    assert.deepEqual(table.hand('Caio').myCards, []);

    table.client('Bia').leave();
    table.settle(500);
    assert.equal(table.snap('Ana').room.phase, 'ended');
    assert.deepEqual(table.snap('Ana').game?.result, { winner: 'player-ana', reason: 'abandon' });
    assert.equal(table.snap('Ana').timer, null);
  });

  it('the host leaving closes the room for everybody and forgets it', () => {
    const table = new Table();
    table.start('Bia', 'Caio');
    assert.notEqual(table.hostStorage?.getItem('trucoimpar.host'), null);
    table.host.leave();
    table.settle(500);
    assert.deepEqual([table.snap('Ana').connection, table.snap('Ana').error], ['closed', null]);
    for (const name of ['Bia', 'Caio']) {
      assert.deepEqual([table.snap(name).connection, table.snap(name).error], ['closed', 'host-closed']);
    }
    assert.equal(table.hostStorage?.getItem('trucoimpar.host'), null);
    assert.equal(table.net.openLinks(), 0);
    const late = table.join('Duda');
    table.clock.advance(1500);
    assert.equal(late.getSnapshot().error, 'not-found');
  });
});
