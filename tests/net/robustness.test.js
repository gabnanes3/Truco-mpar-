// Nothing a client sends, and nothing the environment fails at, may break the room or change its state.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { fullDeck } from '../../app/js/engine/cards.js';
import { GuestClient } from '../../app/js/net/guest-client.js';
import { HostRoom } from '../../app/js/net/host-room.js';
import { MemoryNetwork } from '../../app/js/net/memory-network.js';
import { FakeClock, MemoryStorage, Table, identityOf, seededRandom } from './support.js';

/**
 * Everything observable about the room that an invalid message must leave alone.
 * @param {Table} table
 */
function picture(table) {
  const { seq, room } = table.snap('Ana');
  return { state: table.room.matchState, seq, room };
}

/**
 * @param {Table} table
 * @param {string} name
 * @param {unknown} message sent on that guest's real connection, bypassing the client's own checks
 */
function sendRaw(table, name, message) {
  const link = table.guests.get(name)?.link;
  if (link === null || link === undefined) assert.fail(`${name} has no connection`);
  link.send(message);
}

describe('malformed and unauthorised messages', () => {
  it('leave the match exactly as it was', () => {
    const table = new Table({ seed: 51 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    const before = picture(table);
    const caioCards = table.hand('Caio').myCards;
    const biaCards = table.hand('Bia').myCards;
    const notBias = fullDeck().find((card) => !biaCards.includes(card));

    const fromCaio = [
      // Not his turn, nothing to answer.
      { t: 'play', card: caioCards[0] }, { t: 'truco' }, { t: 'respond', accept: true }, { t: 'respond', accept: false },
      // Acting for the player whose turn it is.
      { t: 'play', card: biaCards[0], playerId: 'player-bia' }, { t: 'play', card: biaCards[0] },
      { type: 'play', playerId: 'player-bia', card: biaCards[0] }, { t: 'remove', playerId: 'player-bia' },
      // The host's buttons.
      { t: 'start' }, { t: 'newMatch' }, { t: 'kick', playerId: 'player-bia' }, { t: 'kick', playerId: 'player-ana' },
      { t: 'setTarget', target: 6 }, { t: 'deal', deck: fullDeck() },
      // Garbage, small and huge.
      null, 0, 'play', [], {}, { t: null }, { t: 'play', card: null }, { t: ['play'] }, { t: 'state', seq: 1 },
      { t: 'play', card: 'x'.repeat(300000) }, { t: 'taunt', id: 'y'.repeat(300000) },
      { t: 'ping', padding: Array.from({ length: 5000 }, (_, index) => ({ index })) },
      { t: 'hello', v: 1, ...identityOf('Ana'), attempt: 9e15 }, { t: 'hello', v: 1, ...identityOf('Bia'), attempt: 9e15 },
    ];
    for (const message of fromCaio) {
      sendRaw(table, 'Caio', message);
      table.settle(40);
    }
    // Her turn, but not her card; and nobody raised.
    sendRaw(table, 'Bia', { t: 'play', card: notBias });
    sendRaw(table, 'Bia', { t: 'respond', accept: true });
    table.settle();
    assert.deepEqual(picture(table), before);
    assert.equal(table.room.matchState, before.state);
    assert.deepEqual(table.hand('Bia').myCards, biaCards);
    assert.equal(table.snap('Caio').connection, 'online');

    // And the room is as alive as before: the right player plays the right card.
    table.client('Bia').play(biaCards[0]);
    table.settle();
    assert.equal(table.snap('Ana').seq, before.seq + 1);
  });

  it('get a private resync when well-formed but refused, so no client waits forever for "the next snapshot"', () => {
    const table = new Table({ seed: 52 });
    table.start('Bia', 'Caio');
    table.untilTurnOf('Bia');
    const seq = table.snap('Ana').seq;
    let caioHeard = 0;
    let anaHeard = 0;
    table.client('Caio').subscribe((snapshot) => {
      caioHeard += 1;
      assert.deepEqual([snapshot.seq, snapshot.events], [seq, []]);
    });
    table.client('Ana').subscribe(() => {
      anaHeard += 1;
    });
    table.client('Caio').play(table.hand('Caio').myCards[0]);
    table.settle();
    assert.equal(caioHeard, 1);
    assert.equal(anaHeard, 0);

    // The host's own seat goes through the very same checks, and gets the same kind of answer.
    const state = table.room.matchState;
    table.host.play(table.hand('Ana').myCards[0]);
    table.host.play('not a card');
    table.host.kick('player-ana');
    table.host.newMatch();
    table.settle();
    assert.equal(anaHeard, 4);
    assert.equal(table.room.matchState, state);
    assert.equal(table.snap('Ana').seq, seq);
  });

  it('are cut off when they come in a flood', () => {
    const table = new Table({ seed: 53 });
    table.start('Bia', 'Caio');
    const pongs = () => table.net.log.filter((sent) => sent.to === 'player-caio' && /** @type {any} */ (sent.message).t === 'pong').length;
    table.clock.advance(1500);
    const before = pongs();
    for (let count = 0; count < 500; count += 1) sendRaw(table, 'Caio', { t: 'ping' });
    table.settle();
    assert.equal(pongs() - before, 30);
    table.clock.advance(1000);
    sendRaw(table, 'Caio', { t: 'ping' });
    table.settle();
    assert.equal(pongs() - before, 31);
    assert.equal(table.snap('Caio').connection, 'online');
  });

  it('cannot take the host down through a listener that throws', () => {
    const table = new Table({ seed: 54 });
    const errors = [];
    const original = console.error;
    console.error = (...args) => errors.push(args);
    try {
      table.host.subscribe(() => {
        throw new Error('the UI blew up');
      });
      table.start('Bia', 'Caio');
    } finally {
      console.error = original;
    }
    assert.ok(errors.length > 0);
    assert.equal(table.snap('Bia').room.phase, 'match');
    assert.equal(table.hand('Bia').myCards.length, 3);
  });
});

describe('storage', () => {
  it('missing altogether: the room works, it just cannot be resumed', () => {
    const table = new Table({ seed: 55, storage: null });
    const bia = new GuestClient({
      transport: table.net.transport('player-bia'), code: table.code, identity: identityOf('Bia'), env: table.env(null, 1),
    });
    table.guests.set('Bia', bia);
    table.settle();
    table.host.start();
    table.settle();
    const turn = table.turn();
    table.client(turn).play(table.hand(turn).myCards[0]);
    table.settle();
    assert.equal(table.hand('Bia').plays.length, 1);
    assert.equal(table.reloadHost(), null);
  });

  it('failing on every write: the match goes on, and persistence is back as soon as writes work again', () => {
    const table = new Table({ seed: 56 });
    const storage = table.hostStorage;
    if (storage === null) assert.fail('this test needs a storage');
    table.start('Bia', 'Caio');
    const savedBefore = storage.getItem('trucoimpar.host');
    storage.failWrites = true;
    for (let count = 0; count < 4; count += 1) {
      const turn = table.turn();
      table.client(turn).play(table.hand(turn).myCards[0]);
      table.settle();
    }
    assert.equal(storage.getItem('trucoimpar.host'), savedBefore);
    assert.equal(table.snap('Bia').connection, 'online');

    storage.failWrites = false;
    const turn = table.turn();
    table.client(turn).play(table.hand(turn).myCards[0]);
    table.settle();
    const state = table.room.matchState;
    assert.notEqual(table.reloadHost(), null);
    assert.deepEqual(table.room.matchState, state);
  });
});

describe('opening a room', () => {
  /**
   * @param {MemoryNetwork} net
   * @param {FakeClock} clock
   * @param {number} seed
   */
  const create = (net, clock, seed) => HostRoom.create({
    transport: net.transport('player-ana'),
    identity: identityOf('Ana'),
    env: { clock, random: seededRandom(seed), storage: new MemoryStorage(), onWake: () => () => {} },
  });

  it('picks another code when the first one is taken', () => {
    const clock = new FakeClock();
    const net = new MemoryNetwork({ clock });
    const first = create(net, clock, 1);
    clock.advance(20);
    const second = create(net, clock, 1);
    assert.equal(second.code, first.code);
    assert.equal(second.client.getSnapshot()?.connection, 'connecting');
    clock.advance(20);
    assert.notEqual(second.code, first.code);
    assert.deepEqual([second.client.getSnapshot()?.connection, second.client.getSnapshot()?.room.code], ['online', second.code]);
    assert.equal(first.client.getSnapshot()?.connection, 'online');
  });

  it('gives up with "broker unreachable" when the network is not there, for host and guest alike', () => {
    const clock = new FakeClock();
    const net = new MemoryNetwork({ clock });
    net.reachable = false;
    const room = create(net, clock, 2);
    const guest = new GuestClient({
      transport: net.transport('player-bia'),
      code: 'ABCDEF',
      identity: identityOf('Bia'),
      env: { clock, random: seededRandom(3), storage: new MemoryStorage(), onWake: () => () => {} },
    });
    clock.advance(60000);
    assert.deepEqual([room.client.getSnapshot()?.connection, room.client.getSnapshot()?.error], ['closed', 'broker-unreachable']);
    assert.deepEqual([guest.getSnapshot().connection, guest.getSnapshot().error], ['closed', 'broker-unreachable']);
    assert.equal(clock.timers.length, 0, 'nothing keeps running after giving up');
  });

  it('keeps an open room alive through a broker outage: it re-registers by itself', () => {
    const table = new Table({ seed: 57 });
    table.start('Bia');
    // The broker forgets the room; the connection to Bia survives.
    const room = table.net.rooms.get(table.code);
    table.net.rooms.delete(table.code);
    room?.handlers.onClose('unreachable');
    table.settle();
    assert.equal(table.snap('Ana').connection, 'reconnecting');
    assert.equal(table.snap('Bia').connection, 'online');
    table.clock.advance(1100);
    assert.equal(table.snap('Ana').connection, 'online');
    assert.equal(table.join('Caio').getSnapshot().you.role, 'spectator');
  });
});
