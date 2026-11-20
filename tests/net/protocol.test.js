import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { DEFAULT_CONFIG, readConfig, shuffled } from '../../app/js/net/env.js';
import { createIdentity, ensureIdentity, loadIdentity, loadLastRoom, saveLastRoom } from '../../app/js/net/identity.js';
import {
  CODE_ALPHABET, PROTOCOL_VERSION, cleanName, generateCode, normalizeCode, parseClientMessage, parseHostMessage,
  uniqueName,
} from '../../app/js/net/protocol.js';
import { SafeStorage } from '../../app/js/net/storage.js';
import { TAUNTS } from '../../app/js/net/taunts.js';
import { MemoryStorage, Table, identityOf, seededRandom } from './support.js';

describe('room codes', () => {
  it('are 6 characters of an alphabet without look-alikes', () => {
    const random = seededRandom(7);
    for (let count = 0; count < 50; count += 1) {
      const code = generateCode(random);
      assert.equal(code.length, 6);
      assert.ok([...code].every((letter) => CODE_ALPHABET.includes(letter)));
      assert.equal(normalizeCode(code), code);
    }
    assert.equal(/[01IO]/.test(CODE_ALPHABET), false);
  });

  it('are read case-insensitively and without spaces', () => {
    assert.equal(normalizeCode(' ab cd 23 '), 'ABCD23');
    assert.equal(normalizeCode('abcd23'), 'ABCD23');
    for (const bad of ['', 'ABCD2', 'ABCD234', 'ABCD1O', 'ABC-23', null, 42, 'A'.repeat(100)]) {
      assert.equal(normalizeCode(bad), null, String(bad));
    }
  });
});

describe('names', () => {
  it('are trimmed, stripped of invisible characters and cut at 14', () => {
    assert.equal(cleanName('  Ana  '), 'Ana');
    assert.equal(cleanName('Zé\u0000 da\u202e\n Silva'), 'Zé da Silva');
    assert.equal(cleanName('Bartolomeu de Gusmão'), 'Bartolomeu de');
    assert.equal(cleanName('ÁÉÍÓÚáéíóúÇçÃã!!'), 'ÁÉÍÓÚáéíóúÇçÃã');
    for (const empty of ['', '   ', '\u200b\u0007', null, 12, {}]) assert.equal(cleanName(empty), null);
  });

  it('are told apart with a number when taken', () => {
    assert.equal(uniqueName('Ana', []), 'Ana');
    assert.equal(uniqueName('Ana', ['ana']), 'Ana 2');
    assert.equal(uniqueName('Ana', ['Ana', 'Ana 2']), 'Ana 3');
    const long = uniqueName('Bartolomeu Gus', ['Bartolomeu Gus']);
    assert.equal(long, 'Bartolomeu G 2');
    assert.ok(long.length <= 14);
  });
});

describe('messages from a guest', () => {
  const hello = { t: 'hello', v: PROTOCOL_VERSION, ...identityOf('Bia'), attempt: 5 };

  it('are accepted when they are exactly a known message', () => {
    const { playerId, secret, name } = identityOf('Bia');
    assert.deepEqual(parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, playerId, secret, name, attempt: 5 }), hello);
    const valid = [
      { t: 'ping' }, { t: 'play', card: '3p' }, { t: 'truco' }, { t: 'respond', accept: false },
      { t: 'taunt', id: TAUNTS[0].id }, { t: 'leave' }, { t: 'start' }, { t: 'kick', playerId }, { t: 'newMatch' },
      { t: 'setTarget', target: 9 },
    ];
    for (const message of valid) assert.deepEqual(parseClientMessage(message), message);
  });

  it('are refused when anything is off', () => {
    const invalid = [
      null, undefined, 7, 'play', [], [{ t: 'ping' }], {}, { t: 'dance' }, { t: 'ping', extra: 1 },
      { t: 'play' }, { t: 'play', card: '1o' }, { t: 'play', card: 'x'.repeat(100000) }, { t: 'play', card: ['3p'] },
      { t: 'play', card: '3p', playerId: 'player-ana' }, { t: 'truco', playerId: 'player-ana' },
      { t: 'respond' }, { t: 'respond', accept: 'yes' }, { t: 'respond', accept: 1 },
      { t: 'taunt', id: 'free text' }, { t: 'taunt', id: 3 }, { t: 'taunt', text: 'oi' },
      { t: 'kick', playerId: '' }, { t: 'kick', playerId: 'a b' }, { t: 'kick' },
      { t: 'setTarget', target: 7 }, { t: 'setTarget', target: '12' }, { t: 'setTarget' },
      { ...hello, secret: 'short' }, { ...hello, playerId: 'no spaces allowed' }, { ...hello, attempt: -1 },
      { ...hello, attempt: 1.5 }, { ...hello, name: 'x'.repeat(5000) }, { ...hello, name: 5 }, { ...hello, more: true },
      { t: 'hello' }, { t: 'hello', v: 'one' },
    ];
    for (const message of invalid) assert.equal(parseClientMessage(message), null, JSON.stringify(message)?.slice(0, 80));
  });

  it('are flagged when they speak another protocol version', () => {
    assert.deepEqual(parseClientMessage({ ...hello, v: PROTOCOL_VERSION + 1 }), { t: 'bad-version' });
    assert.deepEqual(parseClientMessage({ t: 'hello', v: 0, whatever: [] }), { t: 'bad-version' });
  });
});

describe('messages from the host', () => {
  it('are accepted as the host really sends them, and refused when damaged', () => {
    const table = new Table();
    table.start('Bia', 'Caio');
    const states = table.statesTo.get(identityOf('Bia').playerId) ?? [];
    assert.ok(states.length >= 2);
    for (const state of states) assert.deepEqual(parseHostMessage(state), state);
    assert.deepEqual(parseHostMessage({ t: 'pong' }), { t: 'pong' });
    assert.deepEqual(parseHostMessage({ t: 'bye', reason: 'kicked' }), { t: 'bye', reason: 'kicked' });

    const good = states[states.length - 1];
    const damaged = [
      null, 'state', {}, { t: 'pong', x: 1 }, { t: 'bye', reason: 'because' }, { t: 'bye' },
      { ...good, seq: -1 }, { ...good, seq: '4' }, { ...good, extra: 1 }, { ...good, events: 'none' }, { ...good, events: [3] },
      { ...good, room: { ...good.room, phase: 'party' } }, { ...good, room: { ...good.room, code: 'abc' } },
      { ...good, room: { ...good.room, settings: { targetScore: 10 } } },
      { ...good, room: { ...good.room, members: [{ id: 'player-x' }] } },
      { ...good, you: { id: 'player-bia', role: 'boss', isHost: false } }, { ...good, timer: { remainingMs: -5 } },
      { ...good, game: 'none' }, { ...good, game: { ...good.game, players: 'all' } },
      { ...good, game: { ...good.game, hand: { ...good.game?.hand, myCards: ['zz'] } } },
    ];
    for (const message of damaged) assert.equal(parseHostMessage(message), null, JSON.stringify(message)?.slice(0, 80));
  });
});

describe('injected environment', () => {
  it('reads timings from the defaults, the page config and explicit overrides, ignoring bad values', () => {
    assert.deepEqual(readConfig(), DEFAULT_CONFIG);
    assert.deepEqual([DEFAULT_CONFIG.turnMs, DEFAULT_CONFIG.disconnectGraceMs, DEFAULT_CONFIG.handPauseMs], [15000, 6000, 4500]);
    const page = /** @type {{ __TRUCO_CONFIG__?: unknown }} */ (globalThis);
    page.__TRUCO_CONFIG__ = { turnMs: 500, heartbeatMs: 'fast', handPauseMs: -1, host: 'localhost' };
    try {
      assert.deepEqual(readConfig(), { ...DEFAULT_CONFIG, turnMs: 500 });
      assert.equal(readConfig({ turnMs: 900 }).turnMs, 900);
    } finally {
      delete page.__TRUCO_CONFIG__;
    }
  });

  it('shuffles without losing or repeating anything', () => {
    const cards = Array.from({ length: 40 }, (_, index) => index);
    const mixed = shuffled(cards, seededRandom(3));
    assert.notDeepEqual(mixed, cards);
    assert.deepEqual([...mixed].sort((a, b) => a - b), cards);
  });
});

describe('stored identity and last room', () => {
  it('is created once and found again, with the chosen name', () => {
    const storage = new SafeStorage(new MemoryStorage());
    const first = ensureIdentity(storage, seededRandom(1), '  Bia ');
    assert.equal(first.name, 'Bia');
    assert.deepEqual(parseClientMessage({ t: 'hello', v: PROTOCOL_VERSION, ...first, attempt: 1 })?.t, 'hello');
    assert.deepEqual(ensureIdentity(storage, seededRandom(2)), first);
    assert.deepEqual(loadIdentity(storage), first);
    assert.equal(ensureIdentity(storage, seededRandom(2), 'Beatriz').name, 'Beatriz');
    assert.equal(loadIdentity(storage)?.secret, first.secret);
    assert.notEqual(createIdentity(seededRandom(9)).secret, first.secret);
  });

  it('survives a storage that is missing, failing or holding garbage', () => {
    const broken = new MemoryStorage();
    broken.failWrites = true;
    for (const storage of [new SafeStorage(null), new SafeStorage(broken)]) {
      const identity = ensureIdentity(storage, seededRandom(1), 'Bia');
      assert.equal(identity.name, 'Bia');
      assert.equal(loadIdentity(storage), null);
      assert.equal(storage.write('key', 1), false);
      storage.remove('key');
    }
    const garbage = new MemoryStorage();
    garbage.setItem('trucoimpar.identity', '{not json');
    assert.equal(loadIdentity(new SafeStorage(garbage)), null);
    garbage.setItem('trucoimpar.identity', JSON.stringify({ playerId: 'x', secret: 'y', name: 'z' }));
    assert.equal(loadIdentity(new SafeStorage(garbage)), null);
  });

  it('forgets the last room after 12 hours', () => {
    const storage = new SafeStorage(new MemoryStorage());
    saveLastRoom(storage, { code: 'ABCD23', role: 'guest', at: 1000 });
    assert.deepEqual(loadLastRoom(storage, 2000), { code: 'ABCD23', role: 'guest', at: 1000 });
    assert.equal(loadLastRoom(storage, 1000 + 12 * 3600 * 1000 + 1), null);
  });
});
