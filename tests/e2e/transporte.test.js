// The real transport in a real browser: the session layer over PeerJS and WebRTC data channels between
// Chromium pages, with a local broker. One browser context per device (each has its own storage). The steps
// of the main story build on each other; once one fails, the ones that depend on it are skipped.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startServers } from './support/servidores.js';

/** @typedef {import('../../app/js/net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('./support/harness.js').Harness} Harness */
/**
 * @typedef {Object} Device one browser context: a device of its own
 * @property {string} name
 * @property {import('playwright').BrowserContext} context
 * @property {import('playwright').Page} page
 * @property {string[]} errors console errors and uncaught exceptions (unhandled rejections included)
 */

const NAMES = ['Ana', 'Bia', 'Caio', 'Duda', 'Enzo'];
const WAIT_MS = 20000;
const MATCH_MS = 60000;
const POLL_MS = 20;
/** What Chromium prints when the broker's socket cannot be opened: expected only while the broker is down. */
const NO_BROKER = /WebSocket connection to .* failed/;

/** @type {Awaited<ReturnType<typeof startServers>>} */
let servers;
/** @type {import('playwright').Browser} */
let browser;
/** @type {Device[]} every device opened, to check that none saw an error */
const devices = [];
/** @type {Device} */
let host;
/** @type {Device[]} */
const guests = [];
/** @type {Map<string, Device>} who sits where, by player id */
const seats = new Map();
let code = '';
let broken = false;

before(async () => {
  // Nobody is ever timed out here: a lost message would stop the match and fail the test, not be papered over.
  servers = await startServers({ config: { turnMs: 120000 } });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await servers?.close();
});

/**
 * A test of the main story: skipped when an earlier one failed, since it starts where that one stopped.
 * @param {string} name
 * @param {() => Promise<void>} run
 */
function step(name, run) {
  test(name, { timeout: 100000 }, async (t) => {
    if (broken) {
      t.skip('uma etapa anterior falhou');
      return;
    }
    try {
      await run();
    } catch (error) {
      broken = true;
      throw error;
    }
  });
}

/**
 * @param {string} name
 * @param {string} [query] `?sala=CODE&nome=NAME` enters that room as soon as the page loads
 * @param {RegExp} [expected] console errors this device is expected to see
 * @returns {Promise<Device>}
 */
async function openDevice(name, query = '', expected) {
  const context = await browser.newContext();
  await servers.inject(context);
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error' && expected?.test(message.text()) !== true) errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`exception: ${error.message}`));
  await page.goto(`${servers.harnessUrl}${query}`);
  const device = { name, context, page, errors };
  devices.push(device);
  return device;
}

/**
 * Runs `action` inside the device's page, with the page's harness. Like any function given to Playwright it
 * travels as source text: it can use nothing from this file but its `argument` (a JSON value).
 * @template T
 * @template [A=undefined]
 * @param {Device} device
 * @param {(harness: Harness, argument: A) => T} action
 * @param {A} [argument]
 * @returns {Promise<Awaited<T>>}
 */
function inPage(device, action, argument) {
  const source = `(${action})(window.harness, ${JSON.stringify(argument)})`;
  return /** @type {Promise<Awaited<T>>} */ (device.page.evaluate(source));
}

/**
 * @param {RoomSnapshot | null} snapshot
 * @returns {string} what matters of it, for a failure message
 */
function brief(snapshot) {
  if (snapshot === null) return 'sem estado';
  const { connection, error, seq, room, game } = snapshot;
  const hand = game === null ? null : game.hand;
  return JSON.stringify({
    connection, error, seq, phase: room.phase,
    members: room.members.map((member) => `${member.name}${member.connected ? '' : ' (fora)'}`),
    game: game === null ? null : { phase: game.phase, hand: game.handNumber, scores: game.players.map((player) => player.score) },
    turn: hand === null ? null : hand.turn,
  });
}

/**
 * Waits until the device's snapshot satisfies `predicate`.
 * @param {Device} device
 * @param {string} what what is being waited for, for the failure message
 * @param {(snapshot: RoomSnapshot) => boolean} predicate
 * @param {number} [timeoutMs]
 * @returns {Promise<RoomSnapshot>} the snapshot that satisfied it
 */
async function until(device, what, predicate, timeoutMs = WAIT_MS) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const snapshot = await inPage(device, (harness) => harness.snapshot());
    if (snapshot !== null && predicate(snapshot)) return snapshot;
    if (Date.now() >= deadline) assert.fail(`${device.name} não chegou a "${what}" em ${timeoutMs} ms: ${brief(snapshot)}`);
    await delay(POLL_MS);
  }
}

/**
 * Waits until the transport-level listener of the device has reported `count` things.
 * @param {Device} device
 * @param {number} count
 * @returns {Promise<string[]>} everything it reported so far
 */
async function heardBy(device, count) {
  const deadline = Date.now() + WAIT_MS;
  for (;;) {
    const heard = await inPage(device, (harness) => harness.heard);
    if (heard.length >= count) return heard;
    if (Date.now() >= deadline) assert.fail(`${device.name} só ouviu ${JSON.stringify(heard)}`);
    await delay(POLL_MS);
  }
}

/**
 * Whoever is to play plays the first card they hold.
 * @returns {Promise<Device>} who played
 */
async function playFirstCard() {
  const hand = (await until(host, 'uma mão em andamento', (s) => s.game?.hand?.turn != null)).game?.hand;
  const player = seats.get(hand?.turn ?? '');
  if (hand === null || hand === undefined || player === undefined) assert.fail('ninguém para jogar');
  await inPage(player, (harness) => {
    const cards = harness.snapshot()?.game?.hand?.myCards ?? [];
    harness.client?.play(cards[0]);
  });
  await until(host, 'a carta na mesa', (s) => s.game?.hand?.plays.length === hand.plays.length + 1);
  return player;
}

// ------------------------------------------------------------------------------------ the main story

step('o anfitrião cria a sala, que fica aberta pelo código', async () => {
  host = await openDevice(NAMES[0]);
  await inPage(host, (harness, name) => harness.create(name), host.name);
  const snapshot = await until(host, 'a sala aberta', (s) => s.connection === 'online');
  code = snapshot.room.code;
  assert.match(code, /^[A-HJ-NP-Z2-9]{6}$/);
  assert.equal(snapshot.room.phase, 'lobby');
  assert.deepEqual(snapshot.room.members.map((member) => member.name), [host.name]);
  assert.deepEqual(snapshot.you, { id: snapshot.room.members[0].id, role: 'player', isHost: true });
  await host.page.waitForURL(`**/harness.html?sala=${code}`);
});

step('quatro convidados entram pelo código e todos veem a mesma lista', async () => {
  for (const name of NAMES.slice(1)) {
    const guest = await openDevice(name, `?sala=${code}&nome=${name}`);
    guests.push(guest);
    await until(guest, 'entrar na sala', (s) => s.connection === 'online');
  }
  const complete = await until(host, 'ver os cinco', (s) => s.room.members.length === 5 && s.room.members.every((member) => member.connected));
  assert.deepEqual(complete.room.members.map((member) => [member.name, member.role, member.isHost]),
    NAMES.map((name, index) => [name, 'player', index === 0]));
  for (const [index, device] of [host, ...guests].entries()) {
    const snapshot = await until(device, 'ver os cinco', (s) => s.seq >= complete.seq);
    assert.deepEqual(snapshot.room, complete.room);
    assert.deepEqual(snapshot.you, { id: complete.room.members[index].id, role: 'player', isHost: index === 0 });
    seats.set(snapshot.you.id, device);
  }
});

step('um convidado recarrega a página no meio da mão e volta ao mesmo lugar, com as mesmas cartas', async () => {
  await inPage(host, (harness) => harness.client?.start());
  for (const device of [host, ...guests]) await until(device, 'receber três cartas', (s) => s.game?.hand?.myCards.length === 3);
  // Two cards on the table, played by hand: from here to the end of the next step nobody acts, so the
  // table must come back exactly as it is. One of the two who played is a guest.
  const first = await playFirstCard();
  const second = await playFirstCard();
  const guest = first === host ? second : first;
  const earlier = await until(guest, 'ver as duas cartas na mesa', (s) => s.game?.hand?.plays.length === 2);
  assert.equal(earlier.game?.hand?.myCards.length, 2);

  await guest.page.reload();
  const back = await until(guest, 'voltar à mesa', (s) => s.connection === 'online');
  assert.deepEqual(back.you, earlier.you);
  assert.deepEqual(back.game, earlier.game);
  assert.equal(new URL(guest.page.url()).search, `?sala=${code}`);
  await until(host, 'ver todos conectados', (s) => s.room.members.every((member) => member.connected));
});

step('o anfitrião recarrega a página: a sala guardada volta com o mesmo código e todos se reconectam sozinhos', async () => {
  const everyone = [host, ...guests];
  const earlier = await Promise.all(everyone.map((device) => until(device, 'ver as duas cartas na mesa',
    (s) => s.connection === 'online' && s.game?.hand?.plays.length === 2)));

  await host.page.reload();
  const resumed = await until(host, 'reabrir a sala e ver todos de volta',
    (s) => s.connection === 'online' && s.room.members.every((member) => member.connected));
  assert.equal(resumed.room.code, code);
  assert.equal(new URL(host.page.url()).search, `?sala=${code}`);
  for (const [index, device] of everyone.entries()) {
    // A state newer than anything the first page of the host ever sent: it came from the resumed room.
    const back = await until(device, 'voltar à sala reaberta', (s) => s.connection === 'online' && s.seq >= resumed.seq);
    assert.ok(back.seq > earlier[index].seq);
    assert.deepEqual(back.you, earlier[index].you);
    assert.deepEqual(back.game, earlier[index].game);
    assert.deepEqual(back.room, resumed.room);
  }
});

step('a partida de cinco jogadores vai até o fim, com jogadas válidas ao acaso', async () => {
  const everyone = [host, ...guests];
  for (const device of everyone) await inPage(device, (harness) => harness.autoplay(true));
  const finals = await Promise.all(everyone.map((device) => until(device, 'o fim da partida',
    (s) => s.room.phase === 'ended' && s.game?.result != null, MATCH_MS)));
  const game = finals[0].game;
  const result = game === null ? null : game.result;
  if (game === null || result === null) assert.fail('a partida terminou sem resultado');
  assert.equal(result.reason, 'score');
  assert.deepEqual(game.players.filter((player) => player.score >= game.targetScore).map((player) => player.id), [result.winner]);
  for (const final of finals) {
    assert.equal(final.connection, 'online');
    assert.deepEqual(final.game?.players, game.players);
    assert.deepEqual(final.game?.result, result);
  }
});

step('o código em uso é recusado a quem cria e esperado por quem retoma; quando o anfitrião sai, a sala fecha para todos', async () => {
  // Below the session layer: another device asks the broker for the same code.
  const other = await openDevice('Outro');
  await inPage(other, (harness, room) => harness.listen(room, false), code);
  assert.deepEqual(await heardBy(other, 1), ['close:code-taken']);
  await inPage(other, (harness, room) => harness.listen(room, true), code);
  // Long enough for the broker to refuse the code again: retaking a code does not give up on that.
  await delay(400);
  assert.deepEqual(await inPage(other, (harness) => harness.heard), ['close:code-taken']);

  await inPage(host, (harness) => harness.client?.leave());
  assert.deepEqual(await heardBy(other, 2), ['close:code-taken', 'open']);
  await inPage(other, (harness) => harness.stopListening());
  for (const guest of guests) {
    const closed = await until(guest, 'saber que a sala fechou', (s) => s.connection === 'closed');
    assert.equal(closed.error, 'host-closed');
  }
  assert.equal((await until(host, 'fechar a sala', (s) => s.connection === 'closed')).error, null);
});

test('um código que não existe dá "sala não encontrada" em poucos segundos', { timeout: 30000 }, async () => {
  const missing = code === 'ZZZZZ2' ? 'ZZZZZ3' : 'ZZZZZ2';
  const stranger = await openDevice('Zeca', `?sala=${missing}&nome=Zeca`);
  const snapshot = await until(stranger, 'desistir de procurar', (s) => s.connection === 'closed', 10000);
  assert.equal(snapshot.error, 'not-found');
});

test('nenhuma página registrou erro no console nem exceção', async () => {
  const opened = devices.splice(0);
  await Promise.all(opened.map((device) => device.context.close()));
  assert.ok(opened.length > 0);
  assert.deepEqual(opened.map((device) => [device.name, device.errors]), opened.map((device) => [device.name, []]));
});

// --------------------------------------------------------------------------------- a broker outage

test('sem o broker a sala continua, quem chega recebe "broker-unreachable", e a sala volta a ser encontrada quando ele retorna', { timeout: 100000 }, async () => {
  const ana = await openDevice('Ana', '', NO_BROKER);
  await inPage(ana, (harness) => harness.create('Ana'));
  const room = (await until(ana, 'a sala aberta', (s) => s.connection === 'online')).room.code;
  const bia = await openDevice('Bia', `?sala=${room}&nome=Bia`, NO_BROKER);
  await until(bia, 'entrar na sala', (s) => s.connection === 'online');

  await servers.stopBroker();
  // The broker only introduces people: what is already connected does not need it.
  await inPage(ana, (harness) => harness.client?.setTargetScore(9));
  await until(bia, 'ver a pontuação escolhida', (s) => s.room.settings.targetScore === 9);
  const caio = await openDevice('Caio', '', NO_BROKER);
  await inPage(caio, (harness) => harness.create('Caio'));
  const duda = await openDevice('Duda', `?sala=${room}&nome=Duda`, NO_BROKER);
  for (const device of [caio, duda]) {
    const snapshot = await until(device, 'desistir de alcançar o broker', (s) => s.connection === 'closed');
    assert.equal(snapshot.error, 'broker-unreachable');
  }

  await servers.startBroker();
  // The host registers the room again by itself (the new broker knows nothing): probed from another device.
  const deadline = Date.now() + WAIT_MS;
  let answer = '';
  while (answer !== 'open' && Date.now() < deadline) answer = await inPage(caio, (harness, target) => harness.probe(target), room);
  assert.equal(answer, 'open');
  const enzo = await openDevice('Enzo', `?sala=${room}&nome=Enzo`);
  await until(enzo, 'entrar na sala', (s) => s.connection === 'online');
  // Bia never left: the connection she had before the outage is the one that tells her about Enzo.
  const seen = await until(bia, 'ver quem chegou', (s) => s.room.members.length === 3);
  assert.equal(seen.connection, 'online');
  assert.deepEqual(seen.room.members.map((member) => [member.name, member.connected]), [['Ana', true], ['Bia', true], ['Enzo', true]]);

  assert.deepEqual(devices.map((device) => [device.name, device.errors]), devices.map((device) => [device.name, []]));
});
