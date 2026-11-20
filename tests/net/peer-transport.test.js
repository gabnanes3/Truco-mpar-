// The PeerJS adapter against a fake `Peer`: what it does with each thing PeerJS can say, on a mocked clock.
// (The real PeerJS in a real browser is tests/e2e/transporte.test.js.)

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PEER_PREFIX, createPeerTransport } from '../../app/js/net/peer-transport.js';

/** @typedef {import('../../app/js/net/transport.js').Connection} Connection */

class Emitter {
  constructor() {
    /** @type {Map<string, ((...values: unknown[]) => void)[]>} */
    this.listeners = new Map();
  }

  /**
   * @param {string} event
   * @param {(...values: unknown[]) => void} listener
   */
  on(event, listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), listener]);
  }

  removeAllListeners() {
    this.listeners.clear();
  }

  /**
   * @param {string} event
   * @param {...unknown} values
   */
  emit(event, ...values) {
    for (const listener of this.listeners.get(event) ?? []) listener(...values);
  }
}

class FakeChannel extends Emitter {
  constructor() {
    super();
    this.open = false;
    this.serialization = 'json';
    /** @type {unknown[]} */
    this.sent = [];
  }

  /** @param {unknown} data */
  send(data) {
    this.sent.push(data);
  }

  close() {
    this.open = false;
  }

  announceOpen() {
    this.open = true;
    this.emit('open');
  }
}

class FakePeer extends Emitter {
  /** @type {FakePeer[]} every peer created since the test started */
  static all = [];

  /**
   * @param {string} id
   * @param {Record<string, unknown>} options
   */
  constructor(id, options) {
    super();
    this.id = id;
    this.options = options;
    this.disconnected = false;
    this.destroyed = false;
    this.reconnects = 0;
    /** @type {{ id: string, options: unknown, channel: FakeChannel } | null} */
    this.dialed = null;
    FakePeer.all.push(this);
  }

  /**
   * @param {string} id
   * @param {unknown} options
   */
  connect(id, options) {
    this.dialed = { id, options, channel: new FakeChannel() };
    return this.dialed.channel;
  }

  reconnect() {
    this.reconnects += 1;
    this.disconnected = false;
  }

  disconnect() {
    this.disconnected = true;
  }

  destroy() {
    this.destroyed = true;
  }

  /** The broker link fell, as PeerJS tells it. */
  drop() {
    this.disconnected = true;
    this.emit('error', { type: 'network' });
    this.emit('disconnected');
  }
}

/**
 * @param {import('node:test').TestContext} t
 * @returns {{ tick: (ms: number) => void, last: () => FakePeer }}
 */
function setup(t) {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'] });
  FakePeer.all = [];
  Object.assign(globalThis, { Peer: FakePeer });
  t.after(() => {
    Reflect.deleteProperty(globalThis, 'Peer');
    Reflect.deleteProperty(globalThis, '__TRUCO_CONFIG__');
  });
  return {
    tick: (ms) => t.mock.timers.tick(ms),
    last: () => FakePeer.all[FakePeer.all.length - 1],
  };
}

/**
 * @param {string} code
 * @param {boolean} resume
 */
function listen(code, resume) {
  /** @type {string[]} */
  const heard = [];
  /** @type {Connection[]} */
  const connections = [];
  const listener = createPeerTransport().listen(code, {
    onOpen: () => heard.push('open'),
    onConnection: (connection) => {
      heard.push('connection');
      connections.push(connection);
    },
    onClose: (reason) => heard.push(`close:${reason}`),
  }, { resume });
  return { listener, heard, connections };
}

/** @param {string} code */
function connect(code) {
  /** @type {string[]} */
  const heard = [];
  /** @type {Connection[]} */
  const connections = [];
  const pending = createPeerTransport().connect(code, {
    onOpen: (connection) => {
      heard.push('open');
      connections.push(connection);
    },
    onFail: (reason) => heard.push(`fail:${reason}`),
  });
  return { pending, heard, connections };
}

test('o anfitrião registra trucoimpar-v1-<código>, com a configuração padrão do PeerJS ou a da página', (t) => {
  const { tick, last } = setup(t);
  const room = listen('ABC234', false);
  assert.equal(FakePeer.all.length, 0, 'nada acontece dentro da própria chamada');
  tick(0);
  assert.equal(last().id, `${PEER_PREFIX}ABC234`);
  assert.equal(last().id, 'trucoimpar-v1-ABC234');
  assert.deepEqual(last().options, { debug: 0 });
  last().emit('open');
  assert.deepEqual(room.heard, ['open']);

  Object.assign(globalThis, { __TRUCO_CONFIG__: { peer: { host: 'broker.local', port: 9000, path: '/truco', secure: false, iceServers: [] } } });
  listen('XYZ789', false);
  tick(0);
  assert.deepEqual(last().options, {
    debug: 0, host: 'broker.local', port: 9000, path: '/truco', secure: false,
    config: { iceServers: [], sdpSemantics: 'unified-plan' },
  });
});

test('um canal anunciado como aberto duas vezes é entregue à sala uma vez só', (t) => {
  const { tick, last } = setup(t);
  const room = listen('ABC234', false);
  tick(0);
  last().emit('open');
  const channel = new FakeChannel();
  last().emit('connection', channel);
  assert.deepEqual(room.heard, ['open'], 'só é entregue depois de aberto');
  channel.announceOpen();
  channel.announceOpen();
  assert.deepEqual(room.heard, ['open', 'connection']);

  /** @type {unknown[]} */
  const received = [];
  room.connections[0].onMessage = (message) => received.push(message);
  channel.emit('data', { t: 'hello' });
  assert.deepEqual(received, [{ t: 'hello' }]);
});

test('código ocupado: colisão imediata para quem cria; quem retoma insiste por cerca de um minuto', (t) => {
  const { tick, last } = setup(t);
  const created = listen('ABC234', false);
  tick(0);
  last().emit('error', { type: 'unavailable-id' });
  assert.deepEqual(created.heard, ['close:code-taken']);
  assert.equal(last().destroyed, true);

  // Retaking the code: refused twice, then the broker lets go of the old registration.
  const resumed = listen('ABC234', true);
  tick(0);
  last().emit('error', { type: 'unavailable-id' });
  tick(1000);
  last().emit('error', { type: 'unavailable-id' });
  tick(2000);
  last().emit('open');
  assert.deepEqual(resumed.heard, ['open']);
  assert.equal(FakePeer.all.length, 4);

  // Refused every time: it gives up, and says why.
  const refused = listen('ABC234', true);
  const startedAt = Date.now();
  tick(0);
  while (refused.heard.length === 0) {
    /** @type {number} */
    const tries = FakePeer.all.length;
    last().emit('error', { type: 'unavailable-id' });
    while (refused.heard.length === 0 && FakePeer.all.length === tries) tick(1000);
  }
  assert.deepEqual(refused.heard, ['close:code-taken']);
  const waited = Date.now() - startedAt;
  assert.ok(waited >= 45000 && waited <= 60000, `desistiu depois de ${waited} ms`);
  assert.ok(FakePeer.all.every((peer) => peer.destroyed || peer.listeners.has('open')), 'só o peer em uso continua vivo');
});

test('broker inalcançável ao abrir a sala: "unreachable", com erro ou sem resposta nenhuma', (t) => {
  const { tick, last } = setup(t);
  const refused = listen('ABC234', false);
  tick(0);
  last().emit('error', { type: 'network' });
  assert.deepEqual(refused.heard, ['close:unreachable']);
  assert.equal(last().destroyed, true);

  const silent = listen('ABC234', true);
  tick(0);
  tick(9999);
  assert.deepEqual(silent.heard, []);
  tick(1);
  assert.deepEqual(silent.heard, ['close:unreachable']);
  assert.equal(last().destroyed, true);
});

test('a queda do broker com a sala aberta é consertada com reconnect, sem derrubar a sala nem as conexões', (t) => {
  const { tick, last } = setup(t);
  const room = listen('ABC234', false);
  tick(0);
  const peer = last();
  peer.emit('open');
  const channel = new FakeChannel();
  peer.emit('connection', channel);
  channel.announceOpen();

  peer.drop();
  tick(999);
  assert.equal(peer.reconnects, 0);
  tick(1);
  assert.equal(peer.reconnects, 1);
  // Still down: the next try comes later.
  peer.drop();
  tick(1999);
  assert.equal(peer.reconnects, 1);
  tick(1);
  assert.equal(peer.reconnects, 2);
  // A broker that takes the socket and never answers is dropped and tried again.
  tick(10000);
  assert.equal(peer.disconnected, true);
  peer.emit('disconnected');
  tick(4000);
  assert.equal(peer.reconnects, 3);
  peer.emit('open');

  tick(120000);
  assert.equal(peer.reconnects, 3, 'depois de voltar, nada mais fica agendado');
  assert.deepEqual(room.heard, ['open', 'connection']);
  assert.equal(FakePeer.all.length, 1);
  assert.equal(channel.open, true);
  // PeerJS destroying the peer under us is the one thing that ends the listener.
  peer.emit('close');
  assert.deepEqual(room.heard, ['open', 'connection', 'close:unreachable']);
});

test('fechar a sala solta tudo: o peer vai embora com a última conexão, e nada fica agendado', (t) => {
  const { tick, last } = setup(t);
  const early = listen('ABC234', false);
  tick(0);
  early.listener.close();
  assert.equal(last().destroyed, true);
  assert.equal(last().listeners.size, 0);

  const room = listen('XYZ789', false);
  tick(0);
  const peer = last();
  peer.emit('open');
  const waiting = new FakeChannel();
  peer.emit('connection', waiting);
  const channel = new FakeChannel();
  peer.emit('connection', channel);
  channel.announceOpen();
  room.listener.close();
  // The id goes back to the broker at once; the open connection may still be carrying the room's goodbye.
  assert.equal(peer.disconnected, true);
  assert.equal(peer.destroyed, false);
  room.connections[0].close();
  assert.equal(peer.destroyed, true);
  assert.equal(channel.listeners.size, 0);

  waiting.announceOpen();
  peer.emit('connection', new FakeChannel());
  tick(120000);
  assert.deepEqual(early.heard, []);
  assert.deepEqual(room.heard, ['open', 'connection']);
  assert.equal(FakePeer.all.length, 2);
});

test('convidado: sala inexistente é "not-found", o resto é "unreachable", e a conexão aberta leva as mensagens', (t) => {
  const { last } = setup(t);
  const missing = connect('ABC234');
  assert.match(last().id, /^trucoimpar-v1-guest-[a-z0-9]{20}$/);
  last().emit('open');
  assert.deepEqual(last().dialed?.id, 'trucoimpar-v1-ABC234');
  assert.deepEqual(last().dialed?.options, { serialization: 'json', reliable: true });
  last().emit('error', { type: 'webrtc' });
  assert.deepEqual(missing.heard, []);
  last().emit('error', { type: 'peer-unavailable' });
  assert.deepEqual(missing.heard, ['fail:not-found']);
  assert.equal(last().destroyed, true);

  const offline = connect('ABC234');
  last().emit('error', { type: 'network' });
  last().emit('open');
  assert.deepEqual(offline.heard, ['fail:unreachable']);
  assert.equal(last().dialed, null);

  const cancelled = connect('ABC234');
  last().emit('open');
  cancelled.pending.cancel();
  last().dialed?.channel.announceOpen();
  assert.deepEqual(cancelled.heard, []);
  assert.equal(last().destroyed, true);

  const joined = connect('ABC234');
  const peer = last();
  peer.emit('open');
  const channel = peer.dialed?.channel ?? assert.fail('não discou');
  channel.announceOpen();
  channel.announceOpen();
  assert.deepEqual(joined.heard, ['open']);
  const [connection] = joined.connections;
  /** @type {unknown[]} */
  const received = [];
  let closes = 0;
  connection.onMessage = (message) => received.push(message);
  connection.onClose = () => {
    closes += 1;
  };
  connection.send({ t: 'ping' });
  channel.emit('data', { t: 'pong' });
  // Once connected, the broker going away is nobody's problem.
  peer.emit('error', { type: 'network' });
  assert.deepEqual([channel.sent, received, joined.heard], [[{ t: 'ping' }], [{ t: 'pong' }], ['open']]);
  channel.open = false;
  channel.emit('close');
  connection.send({ t: 'ping' });
  connection.close();
  assert.deepEqual([closes, channel.sent.length, peer.destroyed], [1, 1, true]);
});
