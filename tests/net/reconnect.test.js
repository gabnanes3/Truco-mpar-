// Phones lock, networks change, pages reload: seats and cards must survive all of it.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { HostRoom } from '../../app/js/net/host-room.js';
import { loadLastRoom } from '../../app/js/net/identity.js';
import { MemoryNetwork } from '../../app/js/net/memory-network.js';
import { createRoom, enterRoom } from '../../app/js/net/session.js';
import { SafeStorage } from '../../app/js/net/storage.js';
import { FakeClock, MemoryStorage, Table, actAtRandom, identityOf, seededRandom } from './support.js';

/**
 * @param {Table} table
 * @param {string} name
 * @returns {boolean} whether the host lists that member as connected
 */
function connected(table, name) {
  const member = table.snap('Ana').room.members.find((other) => other.id === identityOf(name).playerId);
  if (member === undefined) assert.fail(`${name} is not in the room`);
  return member.connected;
}

describe('a guest that drops', () => {
  it('mid-turn: keeps the seat, comes back by itself to the same cards and plays', () => {
    const table = new Table({ seed: 2 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    const cards = table.hand('Bia').myCards;
    const played = table.hand('Ana').plays.length;
    /** @type {string[]} */
    const states = [];
    table.client('Bia').subscribe((snapshot) => states.push(snapshot.connection));

    table.net.dropGuest('player-bia');
    table.settle();
    assert.equal(connected(table, 'Bia'), false);
    assert.equal(table.snap('Caio').room.members[1].connected, false);
    assert.equal(table.snap('Bia').connection, 'reconnecting');
    assert.deepEqual(table.roster(), ['Ana', 'Bia', 'Caio']);

    table.clock.advance(1100);
    assert.deepEqual(states, ['reconnecting', 'online']);
    assert.equal(connected(table, 'Bia'), true);
    assert.deepEqual(table.hand('Bia').myCards, cards);
    assert.equal(table.hand('Bia').turn, 'player-bia');
    assert.deepEqual(table.snap('Bia').events, []);

    table.client('Bia').play(cards[0]);
    table.settle();
    assert.equal(table.hand('Ana').plays.length, played + 1);
    assert.deepEqual(table.hand('Bia').myCards, cards.slice(1));
  });

  it('mid-raise: still owes the answer after coming back, and nobody learned what the others said', () => {
    const table = new Table({ seed: 3 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Ana');
    table.host.raise();
    table.settle();
    table.client('Caio').respond(true);
    table.settle();
    assert.deepEqual(table.hand('Bia').raise?.answered, ['player-caio']);

    table.net.dropGuest('player-bia');
    table.clock.advance(1200);
    const raise = table.hand('Bia').raise;
    assert.equal(table.snap('Bia').connection, 'online');
    assert.deepEqual([raise?.caller, raise?.value, raise?.mustAnswer, raise?.myAnswer], ['player-ana', 3, true, null]);
    assert.deepEqual(table.snap('Bia').timer?.players, ['player-bia']);
    assert.equal(table.hand('Caio').raise?.myAnswer, true);

    table.client('Bia').respond(false);
    table.settle();
    const resolved = table.snap('Caio').events.find((event) => event.type === 'trucoResolved');
    assert.deepEqual(resolved, {
      type: 'trucoResolved', caller: 'player-ana', accepted: ['player-caio'], ran: ['player-bia'], value: 3,
    });
    assert.deepEqual(table.hand('Bia').myCards, []);
  });

  it('silently: both sides notice by the heartbeat, and the guest reconnects', () => {
    const table = new Table({ seed: 4 });
    table.joinAll('Bia', 'Caio');
    /** @type {string[]} */
    const states = [];
    table.client('Bia').subscribe((snapshot) => states.push(snapshot.connection));
    /** @type {boolean[]} */
    const seenByHost = [];
    table.host.subscribe((snapshot) => seenByHost.push(snapshot.room.members[1].connected));

    table.clock.advance(10000);
    assert.deepEqual([states, seenByHost], [[], []]);
    table.net.dropGuest('player-bia', { silent: true });
    table.clock.advance(11000);
    assert.equal(table.snap('Bia').connection, 'online');
    table.clock.advance(9000);
    assert.deepEqual(states, ['host-away', 'online']);
    assert.equal(connected(table, 'Bia'), true);
    assert.equal(connected(table, 'Caio'), true);
    assert.equal(table.net.openLinks(), 2);
    assert.deepEqual(table.roster(), ['Ana', 'Bia', 'Caio']);
  });

  it('and reconnects while the host still holds the old connection: the new one simply takes over', () => {
    const table = new Table({ seed: 5 });
    table.start('Bia', 'Caio');
    const cards = table.hand('Bia').myCards;
    /** @type {boolean[]} */
    const seenByHost = [];
    table.host.subscribe((snapshot) => seenByHost.push(snapshot.room.members[1].connected));

    table.net.dropGuest('player-bia', { silent: true });
    table.guests.get('Bia')?.connect();
    table.settle();
    assert.equal(table.snap('Bia').connection, 'online');
    assert.deepEqual(table.hand('Bia').myCards, cards);
    // The old connection going quiet later must not take the seat's new connection down with it.
    table.clock.advance(40000);
    assert.equal(connected(table, 'Bia'), true);
    assert.ok(seenByHost.length > 0 && seenByHost.every((isConnected) => isConnected));
  });

  it('checks the connection when the device wakes up, instead of waiting for the heartbeat', () => {
    const table = new Table({ seed: 6 });
    const bia = table.join('Bia');
    bia.nudge();
    table.clock.advance(5000);
    assert.equal(table.net.openLinks(), 1);
    assert.equal(bia.getSnapshot().connection, 'online');

    table.net.dropGuest('player-bia', { silent: true });
    bia.nudge();
    table.clock.advance(3100);
    assert.equal(bia.getSnapshot().connection, 'online');
    assert.equal(connected(table, 'Bia'), true);
    assert.equal(table.net.openLinks(), 1);
  });
});

describe('one seat, one owner, one connection', () => {
  it('refuses the right player id with the wrong secret, and the impostor learns nothing', () => {
    const table = new Table({ seed: 7 });
    table.start('Bia', 'Caio');
    const cards = table.hand('Bia').myCards;
    const wrong = 'not-the-secret-of-bia-000';

    const impostor = table.raw('Bia', { secret: wrong });
    assert.deepEqual(impostor.byes, ['refused']);
    assert.deepEqual(impostor.states, []);
    const client = table.join('Bia?', { identity: { ...identityOf('Bia'), secret: wrong }, label: 'impostor-client' });
    assert.deepEqual([client.getSnapshot().connection, client.getSnapshot().error], ['closed', 'kicked']);
    assert.equal(client.getSnapshot().game, null);
    assert.equal(table.statesTo.get('impostor-client'), undefined);

    // Nobody can take the host's seat either: it was never bound to a secret.
    assert.deepEqual(table.raw('Ana').byes, ['refused']);

    table.settle(1000);
    assert.equal(connected(table, 'Bia'), true);
    assert.equal(table.snap('Bia').connection, 'online');
    assert.deepEqual(table.hand('Bia').myCards, cards);
  });

  it('gives the seat to a second tab and stops the first one', () => {
    const table = new Table({ seed: 8 });
    table.start('Bia', 'Caio');
    const first = table.client('Bia');
    const cards = table.hand('Bia').myCards;
    table.settle(100);
    const second = table.join('Bia');
    table.settle(500);
    assert.deepEqual([first.getSnapshot()?.connection, first.getSnapshot()?.error], ['closed', null]);
    assert.equal(second.getSnapshot().connection, 'online');
    assert.deepEqual(table.hand('Bia').myCards, cards);
    // The first tab stays out: no tug of war between the two.
    table.clock.advance(20000);
    assert.equal(first.getSnapshot()?.connection, 'closed');
    assert.equal(second.getSnapshot().connection, 'online');
    assert.equal(connected(table, 'Bia'), true);
    assert.equal(table.net.openLinks(), 2);
    // The room is still this device's last room: it now lives in the other tab.
    const storage = new SafeStorage(table.storages.get('player-bia') ?? null);
    assert.equal(loadLastRoom(storage, table.clock.now())?.code, table.code);
  });

  it('ignores a stale connection whose hello arrives after a newer one', () => {
    const table = new Table({ seed: 9 });
    table.start('Bia', 'Caio');
    const stale = table.raw('Bia', { attempt: 1 });
    assert.deepEqual(stale.byes, ['replaced']);
    assert.deepEqual(stale.states, []);
    table.settle(1000);
    assert.equal(table.snap('Bia').connection, 'online');
    assert.equal(connected(table, 'Bia'), true);
  });

  it('ignores whatever still arrives on a connection that was replaced', () => {
    const table = new Table({ seed: 10 });
    const old = table.raw('Caio', { attempt: 10 });
    assert.deepEqual(table.roster(), ['Ana', 'Caio']);
    const current = table.raw('Caio', { attempt: 20 });
    assert.deepEqual(old.byes, ['replaced']);

    old.send({ t: 'leave' });
    old.send({ t: 'ping' });
    table.settle();
    assert.deepEqual(table.roster(), ['Ana', 'Caio']);
    assert.equal(old.received.length, 2);
    // The old connection is closed a moment later; the seat stays connected through the new one.
    table.settle(1000);
    assert.equal(connected(table, 'Caio'), true);

    current.send({ t: 'leave' });
    table.settle();
    assert.deepEqual(table.roster(), ['Ana']);
  });

  it('drops strangers that connect and never introduce themselves', () => {
    const table = new Table({ seed: 11 });
    const stranger = table.raw('Zeca', { hello: false });
    stranger.send({ t: 'play', card: '3p' });
    stranger.send({ t: 'start' });
    table.settle();
    assert.deepEqual(stranger.received, []);
    assert.equal(table.net.openLinks(), 1);
    table.clock.advance(17000);
    assert.equal(table.net.openLinks(), 0);
    assert.equal(stranger.closed, true);

    const future = table.raw('Zeca', { hello: false });
    future.send({ t: 'hello', v: 99, anything: true });
    table.settle();
    assert.deepEqual(future.byes, ['bad-version']);
  });
});

describe('entering a room from a page load', () => {
  it('uses the stored identity: the host resumes its room, a guest gets its seat and cards back', () => {
    const clock = new FakeClock();
    const net = new MemoryNetwork({ clock });
    const devices = { ana: new MemoryStorage(), bia: new MemoryStorage(), caio: new MemoryStorage() };
    /** @param {keyof typeof devices} who @param {number} seed */
    const env = (who, seed) => ({ clock, random: seededRandom(seed), storage: devices[who], onWake: () => () => {} });
    /** @param {import('../../app/js/net/session.js').Session} session */
    const snap = (session) => session.client.getSnapshot() ?? assert.fail('no snapshot');

    const ana = createRoom({ transport: net.transport('ana'), name: 'Ana', env: env('ana', 1) });
    clock.advance(20);
    const { code } = snap(ana).room;
    const bia = enterRoom({ transport: net.transport('bia'), code: code.toLowerCase(), name: 'Bia', env: env('bia', 2) });
    const caio = enterRoom({ transport: net.transport('caio'), code, name: 'Caio', env: env('caio', 3) });
    clock.advance(20);
    assert.deepEqual([ana.role, bia.role, caio.role], ['host', 'guest', 'guest']);
    assert.deepEqual(snap(ana).room.members.map((member) => member.name), ['Ana', 'Bia', 'Caio']);
    ana.client.start();
    clock.advance(20);
    const cards = [ana, bia, caio].map((session) => snap(session).game?.hand?.myCards);

    // Everybody reloads the page: no name is typed again, only the code from the URL is known.
    for (const session of [ana, bia, caio]) session.client.close();
    clock.advance(300);
    const anaAgain = enterRoom({ transport: net.transport('ana'), code, env: env('ana', 4) });
    const biaAgain = enterRoom({ transport: net.transport('bia'), code, env: env('bia', 5) });
    const caioAgain = enterRoom({ transport: net.transport('caio'), code, env: env('caio', 6) });
    clock.advance(2000);
    assert.deepEqual([anaAgain.role, biaAgain.role, caioAgain.role], ['host', 'guest', 'guest']);
    assert.deepEqual([anaAgain.playerId, biaAgain.playerId], [ana.playerId, bia.playerId]);
    assert.deepEqual([anaAgain, biaAgain, caioAgain].map((session) => snap(session).game?.hand?.myCards), cards);
    assert.deepEqual([anaAgain, biaAgain, caioAgain].map((session) => snap(session).connection), ['online', 'online', 'online']);
    assert.deepEqual(snap(biaAgain).room.members.map((member) => [member.name, member.connected]), [['Ana', true], ['Bia', true], ['Caio', true]]);
  });
});

describe('a host that reloads', () => {
  it('mid-hand: a brand new HostRoom resumes from storage and the guests find it again by themselves', () => {
    const table = new Table({ seed: 12, config: { handPauseMs: 300 } });
    table.joinAll('Bia', 'Caio');
    table.host.setTargetScore(6);
    table.host.start();
    table.settle();
    table.client(table.turn()).play(table.hand(table.turn()).myCards[0]);
    table.settle();
    const before = {
      seq: table.snap('Ana').seq,
      turn: table.hand('Ana').turn,
      plays: table.hand('Ana').plays,
      cards: ['Ana', 'Bia', 'Caio'].map((name) => table.hand(name).myCards),
      state: table.room.matchState,
    };
    const old = table.room;

    assert.notEqual(table.reloadHost(), null);
    assert.notEqual(table.room, old);
    assert.deepEqual(table.room.matchState, before.state);
    assert.deepEqual(table.snap('Ana').you, { id: 'player-ana', role: 'player', isHost: true });
    assert.deepEqual(table.snap('Ana').room.members.map((member) => member.connected), [true, false, false]);

    table.clock.advance(1500);
    assert.deepEqual(['Ana', 'Bia', 'Caio'].map((name) => table.snap(name).connection), ['online', 'online', 'online']);
    assert.deepEqual(['Ana', 'Bia', 'Caio'].map((name) => table.hand(name).myCards), before.cards);
    assert.deepEqual(table.hand('Caio').plays, before.plays);
    assert.equal(table.hand('Bia').turn, before.turn);
    assert.ok(table.snap('Bia').seq > before.seq);
    assert.deepEqual(table.snap('Bia').room.members.map((member) => member.connected), [true, true, true]);
    assert.deepEqual(table.snap('Bia').timer, { remainingMs: 15000, totalMs: 15000, players: [before.turn] });

    // And the match can be played to the end on the resumed room.
    const random = seededRandom(12);
    for (let steps = 0; table.snap('Ana').room.phase === 'match'; steps += 1) {
      assert.ok(steps < 20000);
      const acted = ['Ana', 'Bia', 'Caio'].filter((name) => actAtRandom(table.client(name), random)).length;
      table.settle(acted > 0 ? 20 : 100);
    }
    assert.equal(table.snap('Caio').game?.result?.reason, 'score');
    table.assertSequences();
  });

  it('mid-raise: the answers already given are kept, and kept secret', () => {
    const table = new Table({ seed: 13 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Ana');
    table.host.raise();
    table.settle();
    table.client('Bia').respond(true);
    table.settle();

    assert.notEqual(table.reloadHost({ silent: true }), null);
    assert.equal(table.snap('Ana').game?.phase, 'truco');
    // The guests were told nothing: they notice by the heartbeat, and nobody is timed out meanwhile.
    table.clock.advance(18000);
    assert.deepEqual(['Bia', 'Caio'].map((name) => table.snap(name).connection), ['online', 'online']);
    assert.equal(table.snap('Ana').game?.phase, 'truco');
    assert.deepEqual(table.hand('Ana').raise?.waiting, ['player-caio']);
    assert.equal(table.hand('Bia').raise?.myAnswer, true);
    assert.deepEqual([table.hand('Caio').raise?.mustAnswer, table.hand('Caio').raise?.myAnswer], [true, null]);
    assert.deepEqual(table.snap('Caio').timer?.players, ['player-caio']);

    table.client('Caio').respond(false);
    table.settle();
    assert.deepEqual([table.hand('Ana').value, [...table.hand('Ana').alive].sort()], [3, ['player-ana', 'player-bia']]);
    assert.equal(table.hand('Ana').turn, 'player-ana');
  });

  it('during the pause between hands: the next hand is dealt once, on time or at once when overdue', () => {
    for (const downMs of [500, 20000]) {
      const table = new Table({ seed: 14 });
      table.start('Bia', 'Caio');
      const caller = table.turn();
      table.client(caller).raise();
      table.settle();
      for (const name of ['Ana', 'Bia', 'Caio'].filter((other) => other !== caller)) table.client(name).respond(false);
      table.settle();
      assert.equal(table.snap('Ana').game?.phase, 'deal');

      assert.notEqual(table.reloadHost({ downMs }), null);
      if (downMs < 4500) {
        assert.equal(table.snap('Ana').game?.phase, 'deal');
        assert.equal(table.snap('Ana').game?.lastHand?.reason, 'allRan');
        table.clock.advance(4500);
      }
      // Time for the guests' next reconnection attempt (their backoff grew while the host was away).
      table.clock.advance(4000);
      for (const name of ['Ana', 'Bia', 'Caio']) {
        assert.deepEqual([table.snap(name).game?.phase, table.snap(name).game?.handNumber], ['play', 2]);
        assert.equal(table.hand(name).myCards.length, 3);
      }
    }
  });

  it('is not resumed from a snapshot that is missing, foreign, too old or damaged', () => {
    const table = new Table({ seed: 15 });
    table.start('Bia', 'Caio');
    const storage = table.hostStorage;
    if (storage === null) assert.fail('this test needs a storage');
    const { code } = table;
    const transport = table.net.transport('player-ana');
    const env = table.env(storage, 9);
    const stored = storage.getItem('trucoimpar.host') ?? '';
    table.room.close();
    table.settle();

    assert.equal(HostRoom.resume({ transport, code: code === 'AAAAAA' ? 'BBBBBB' : 'AAAAAA', env }), null);
    assert.equal(HostRoom.resume({ transport, code, env, identity: { playerId: 'player-bia' } }), null);
    assert.equal(HostRoom.resume({ transport, code, env: table.env(null, 9) }), null);
    assert.equal(HostRoom.storedCode(env), code);

    const damaged = JSON.parse(stored);
    damaged.match.hand.cards[0][0] = damaged.match.hand.cards[1][0];
    for (const text of ['{not json', '{}', JSON.stringify({ ...JSON.parse(stored), phase: 'lobby' }), JSON.stringify(damaged)]) {
      storage.setItem('trucoimpar.host', text);
      assert.equal(HostRoom.resume({ transport, code, env }), null, text.slice(0, 40));
      assert.equal(storage.getItem('trucoimpar.host'), null, 'an unusable snapshot is deleted');
    }

    storage.setItem('trucoimpar.host', stored);
    table.clock.advance(12 * 3600 * 1000 + 1000);
    assert.equal(HostRoom.resume({ transport, code, env }), null);
    assert.equal(HostRoom.storedCode(env), null);
  });

  it('for good: the guests say so and keep trying, they never freeze or give up', () => {
    const table = new Table({ seed: 16 });
    table.start('Bia', 'Caio');
    table.net.killRoom(table.code);
    table.room.close();
    table.settle();
    assert.equal(table.snap('Bia').connection, 'reconnecting');
    table.clock.advance(60000);
    for (const name of ['Bia', 'Caio']) {
      assert.deepEqual([table.snap(name).connection, table.snap(name).error], ['host-away', null]);
      assert.notEqual(table.snap(name).game, null);
    }

    // A guest who reloads in the meantime knows the room existed: same answer, not "room not found".
    table.client('Bia').close();
    const reloaded = table.join('Bia');
    table.clock.advance(20000);
    assert.deepEqual([reloaded.getSnapshot().connection, reloaded.getSnapshot().error], ['host-away', null]);

    // And when the host does come back, even much later, everybody is there again.
    const resumed = HostRoom.resume({
      transport: table.net.transport('player-ana'), code: table.code, env: table.env(table.hostStorage, 77),
    });
    if (resumed === null) assert.fail('the room should resume');
    table.room = resumed;
    table.clock.advance(9000);
    assert.equal(reloaded.getSnapshot().connection, 'online');
    assert.equal(table.snap('Caio').connection, 'online');
    assert.equal(table.hand('Bia').myCards.length + table.hand('Bia').plays.length >= 1, true);
  });
});
