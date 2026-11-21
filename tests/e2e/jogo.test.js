// The whole game through the real interface: Chromium pages (one browser context per device, each with its
// own storage) talking over PeerJS and WebRTC through a local broker. Everything is done the way a person
// would do it: typing a name, opening the invite link, tapping cards and buttons. Nobody is ever timed out
// here, so a lost tap or a lost message stops the match and fails the test instead of being papered over.

import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from 'playwright';
import { startServers } from './support/servidores.js';

/**
 * @typedef {Object} Device one browser context: a device of its own
 * @property {string} name
 * @property {import('playwright').Page} page
 * @property {string[]} errors console errors, uncaught exceptions, failed requests and HTTP errors
 */
/** @typedef {'end' | 'answer' | 'play' | 'play-or-raise' | 'wait'} Move what a device can do right now */
/** @typedef {{ host: Device, guests: Device[], all: Device[], code: string }} Party */

const WAIT_MS = 20000;
const MATCH_MS = 170000;
const STALL_MS = 40000;
const POLL_MS = 40;
const TABLE = '.app--mesa:not([hidden])';
const LOBBY = '.app--sala';
const END = '.app--fim';

/** @type {Awaited<ReturnType<typeof startServers>>} */
let servers;
/** @type {import('playwright').Browser} */
let browser;
/** @type {Device[]} every device opened, to check at the end that none saw an error */
const devices = [];

before(async () => {
  servers = await startServers({ config: { turnMs: 120000 } });
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await servers?.close();
});

/** @param {number} seed @returns {() => number} a repeatable source of numbers in [0, 1) */
function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * @param {string} name
 * @returns {Promise<Device>} a phone-sized page with nothing loaded yet
 */
async function openDevice(name) {
  const context = await browser.newContext({ viewport: { width: 360, height: 640 } });
  await servers.inject(context);
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`exception: ${error.message}`));
  page.on('requestfailed', (request) => {
    // A reload cancels whatever was still on its way: that is not a broken link.
    if (request.failure()?.errorText !== 'net::ERR_ABORTED') errors.push(`request failed: ${request.url()}`);
  });
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  const device = { name, page, errors };
  devices.push(device);
  return device;
}

/** @param {Device} device @returns {Promise<string[]>} the names on the lobby roster, in seat order */
function roster(device) {
  return device.page.locator('.lista > li:not(.vago) .lista__txt').allTextContents();
}

/** @param {Device} device @returns {Promise<{ name: string | null, cards: (string | undefined)[] }>} */
function seatOf(device) {
  return device.page.evaluate(() => ({
    name: document.querySelector('.placa--eu .placa__nome')?.textContent ?? null,
    cards: Array.from(document.querySelectorAll('.mao__cartas .carta--mao'), (card) => /** @type {HTMLElement} */ (card).dataset.carta),
  }));
}

/**
 * The host types a name and opens a table; every guest arrives through the invite link.
 * @param {string[]} names the host first
 * @returns {Promise<Party>}
 */
async function gather(names) {
  const host = await openDevice(names[0]);
  await host.page.goto(servers.appUrl);
  await host.page.fill('input[name="nome"]', names[0]);
  await host.page.getByRole('button', { name: 'Abrir uma mesa' }).click();
  await host.page.waitForSelector(LOBBY, { timeout: WAIT_MS });
  await host.page.waitForURL(/\?sala=[A-Z2-9]{6}$/, { timeout: WAIT_MS });
  const link = host.page.url();
  const code = new URL(link).searchParams.get('sala') ?? '';
  assert.equal(await host.page.locator('.codigo__chapas').getAttribute('data-codigo'), code, 'a sala mostra o código que está no endereço');

  /** @type {Device[]} */
  const guests = [];
  for (const name of names.slice(1)) {
    const guest = await openDevice(name);
    await guest.page.goto(link);
    assert.equal(await guest.page.locator('.convite__codigo').textContent(), code, 'quem chega pelo link vê pra qual mesa foi chamado');
    await guest.page.fill('input[name="nome"]', name);
    await guest.page.getByRole('button', { name: 'Entrar na mesa' }).click();
    await guest.page.waitForSelector(LOBBY, { timeout: WAIT_MS });
    guests.push(guest);
  }
  const all = [host, ...guests];
  for (const device of all) {
    await device.page.waitForFunction((count) => document.querySelectorAll('.lista > li:not(.vago)').length === count, names.length, { timeout: WAIT_MS });
    assert.deepEqual(await roster(device), names, `${device.name} vê todo mundo na sala, na ordem de chegada`);
  }
  return { host, guests, all, code };
}

/**
 * The host picks how many points the match goes to and starts it; everybody lands on the table.
 * @param {Party} party
 * @param {number} target
 */
async function start(party, target) {
  const guest = party.guests[0];
  assert.equal(await guest.page.locator('.alvo__op:not(:disabled)').count(), 0, 'convidado não escolhe os pontos');
  assert.equal(await guest.page.locator('.sala__comecar').isVisible(), false, 'convidado não tem o botão de começar');
  await party.host.page.locator(`.alvo__op[data-alvo="${target}"]`).click();
  for (const device of party.all) {
    await device.page.waitForSelector(`.alvo__op[data-alvo="${target}"][aria-checked="true"]`, { timeout: WAIT_MS });
  }
  await party.host.page.locator('.sala__comecar:not(:disabled)').click();
  for (const device of party.all) {
    await device.page.waitForSelector(TABLE, { timeout: WAIT_MS });
    assert.equal(await device.page.locator('.topo__ate').textContent(), `até ${target}`, 'o cabeçalho mostra até quanto vai a partida');
  }
}

/** @param {Device} device @returns {Promise<Move>} */
function moveOf(device) {
  return device.page.evaluate(() => {
    if (document.querySelector('.app--fim')) return 'end';
    if (document.querySelector('.responder:not([hidden]) .responder__aceitar:not(:disabled)')) return 'answer';
    if (!document.querySelector('.mao:not([hidden]) .carta--mao:not(:disabled)')) return 'wait';
    return document.querySelector('.pedir:not([hidden]):not(:disabled)') ? 'play-or-raise' : 'play';
  });
}

/**
 * One tap on a real control. A control that is gone by the time the tap lands is not a failure: the next
 * look at the page decides what to do.
 * @param {Device} device
 * @param {Move} move
 * @param {() => number} random
 */
async function tap(device, move, random) {
  const { page } = device;
  try {
    if (move === 'answer') {
      await page.locator(random() < 0.6 ? '.responder__aceitar' : '.responder__correr').click({ timeout: 3000 });
    } else if (move === 'play-or-raise' && random() < 0.25) {
      await page.locator('.pedir').click({ timeout: 3000 });
    } else {
      const cards = page.locator('.mao__cartas .carta--mao:not(:disabled)');
      await cards.nth(Math.floor(random() * await cards.count())).click({ timeout: 3000 });
    }
  } catch (error) {
    if (!(error instanceof Error) || error.name !== 'TimeoutError') throw error;
  }
}

/**
 * Everybody plays by tapping, with the odd raise, until every device shows the end screen.
 * @param {Device[]} all
 * @param {() => number} random
 * @param {((pending: Device, taps: number) => Promise<void>)} [between] runs before each tap, while the
 *   match is standing still waiting for `pending`
 * @returns {Promise<number>} how many taps it took
 */
async function playToTheEnd(all, random, between) {
  const deadline = Date.now() + MATCH_MS;
  let taps = 0;
  let lastTapAt = Date.now();
  for (;;) {
    let ended = 0;
    for (const device of all) {
      const move = await moveOf(device);
      if (move === 'end') ended += 1;
      if (move === 'end' || move === 'wait') continue;
      if (between) await between(device, taps);
      await tap(device, move, random);
      taps += 1;
      lastTapAt = Date.now();
    }
    if (ended === all.length) return taps;
    assert.ok(Date.now() - lastTapAt < STALL_MS, `a partida parou: ninguém tem o que fazer depois de ${taps} toques`);
    assert.ok(Date.now() < deadline, `a partida não terminou em ${MATCH_MS} ms (${taps} toques)`);
    await delay(POLL_MS);
  }
}

/**
 * A card this guest has just tapped stays on screen until the host's answer arrives, so the seat is read
 * until two readings in a row agree.
 * @param {Device} guest
 */
async function settledSeat(guest) {
  let previous = await seatOf(guest);
  for (;;) {
    await delay(250);
    const current = await seatOf(guest);
    if (JSON.stringify(current) === JSON.stringify(previous)) return current;
    previous = current;
  }
}

/**
 * Reloads a guest's page in the middle of a hand: same seat, same cards, straight back to the table.
 * @param {Device} guest
 * @returns {Promise<boolean>} false when that guest holds no cards right now (nothing to compare)
 */
async function reloadGuest(guest) {
  const seat = await settledSeat(guest);
  if (seat.cards.length === 0) return false;
  await guest.page.reload();
  await guest.page.waitForSelector(TABLE, { timeout: WAIT_MS });
  await guest.page.waitForFunction(() => document.querySelectorAll('.mao__cartas .carta--mao').length > 0, null, { timeout: WAIT_MS });
  assert.deepEqual(await seatOf(guest), seat, `${guest.name} recarregou e voltou pro mesmo lugar, com as mesmas cartas`);
  return true;
}

/**
 * @param {Party} party
 * @param {number} target
 */
async function checkEndScreen(party, target) {
  for (const device of party.all) {
    await device.page.waitForSelector(END, { timeout: WAIT_MS });
    const scores = (await device.page.locator('.final__n').allTextContents()).map(Number);
    assert.equal(scores.length, party.all.length, 'o placar final tem todo mundo');
    assert.ok(scores[0] >= target, `quem levou tem pelo menos ${target} pontos (${scores.join(', ')})`);
    assert.ok(scores.slice(1).every((score) => score < target), 'só um chegou lá');
    assert.equal(await device.page.locator('.final > li[data-campeao]').count(), 1);
  }
  assert.equal(await party.host.page.locator('.fim__nova').isVisible(), true, 'o dono da mesa pode abrir outra partida');
  assert.equal(await party.guests[0].page.locator('.fim__nova').isVisible(), false, 'convidado espera o dono da mesa');
}

test('três jogadores pela interface: convite, até 6, provocação, recarga no meio da mão, fim e nova partida', { timeout: 300000 }, async () => {
  const names = ['Ana', 'Bia', 'Caio'];
  const party = await gather(names);
  await start(party, 6);
  const [bia, caio] = party.guests;

  // A taunt from one player shows up as a speech bubble for the others, and the sender has to wait.
  await bia.page.getByRole('button', { name: 'Provocar a mesa' }).click();
  await bia.page.locator('.provocar__op', { hasText: 'Tá com medo?' }).click();
  for (const device of [party.host, caio]) {
    await device.page.locator('.lugar .balao', { hasText: 'Tá com medo?' }).waitFor({ timeout: WAIT_MS });
  }
  await bia.page.locator('.placa--eu .balao', { hasText: 'Tá com medo?' }).waitFor({ timeout: WAIT_MS });
  assert.equal(await bia.page.getByRole('button', { name: 'Provocar a mesa' }).isDisabled(), true, 'provocar fica em espera depois de mandar uma');

  let reloaded = false;
  const taps = await playToTheEnd(party.all, seeded(3), async (pending, count) => {
    if (reloaded || count < 4 || pending === caio) return;
    reloaded = await reloadGuest(caio);
  });
  assert.ok(reloaded, 'um convidado recarregou a página no meio de uma mão');
  assert.ok(taps >= 6, 'a partida foi jogada toque a toque');
  await checkEndScreen(party, 6);

  await party.host.page.locator('.fim__nova').click();
  for (const device of party.all) {
    await device.page.waitForSelector(LOBBY, { timeout: WAIT_MS });
    assert.deepEqual(await roster(device), names, 'nova partida: todo mundo de volta na sala');
    assert.equal(new URL(device.page.url()).searchParams.get('sala'), party.code);
  }
});

test('cinco jogadores até o fim: um convidado e depois o dono da mesa recarregam no meio da mão e o jogo segue', { timeout: 300000 }, async () => {
  const party = await gather(['Ana', 'Bia', 'Caio', 'Duda', 'Enzo']);
  await start(party, 6);
  const duda = party.guests[2];

  let guestReloaded = false;
  let hostReloaded = false;
  await playToTheEnd(party.all, seeded(11), async (pending, count) => {
    if (!guestReloaded && count >= 3 && pending !== duda) {
      guestReloaded = await reloadGuest(duda);
    } else if (guestReloaded && !hostReloaded && count >= 9 && pending !== party.host) {
      // The host's device is the server: the room comes back from its storage with the same code, and
      // everybody else finds it again without doing anything.
      await party.host.page.reload();
      await party.host.page.waitForSelector(TABLE, { timeout: WAIT_MS });
      assert.equal(new URL(party.host.page.url()).searchParams.get('sala'), party.code, 'a mesa volta com o mesmo código');
      hostReloaded = true;
    }
  });
  assert.ok(guestReloaded && hostReloaded, 'as duas recargas aconteceram durante a partida');
  await checkEndScreen(party, 6);
});

test('um código que não existe leva à tela "não achei essa mesa", com caminho de volta', { timeout: 60000 }, async () => {
  const device = await openDevice('Zeca');
  await device.page.goto(servers.appUrl);
  await device.page.fill('input[name="nome"]', 'Zeca');
  await device.page.fill('input[name="codigo"]', 'zz zz99');
  await device.page.getByRole('button', { name: 'Entrar', exact: true }).click();
  await device.page.waitForSelector('.app--aviso[data-erro="not-found"]', { timeout: WAIT_MS });
  assert.equal(await device.page.locator('.aviso__titulo').textContent(), 'Não achei essa mesa');
  await device.page.getByRole('button', { name: 'Voltar pro início' }).click();
  await device.page.waitForSelector('.app--inicio', { timeout: WAIT_MS });
  assert.equal(await device.page.inputValue('input[name="nome"]'), 'Zeca', 'o nome fica guardado');
  assert.equal(new URL(device.page.url()).search, '', 'o endereço não aponta mais pra mesa que não existe');
});

test('o som desligado continua desligado depois de recarregar, e fechar a mesa leva de volta ao início', { timeout: 60000 }, async () => {
  const device = await openDevice('Lia');
  await device.page.goto(servers.appUrl);
  await device.page.fill('input[name="nome"]', 'Lia');
  await device.page.getByRole('button', { name: 'Abrir uma mesa' }).click();
  await device.page.waitForSelector(LOBBY, { timeout: WAIT_MS });
  await device.page.waitForURL(/\?sala=[A-Z2-9]{6}$/, { timeout: WAIT_MS });
  const address = device.page.url();
  const sound = device.page.locator('.barra .icone-btn[aria-pressed]');
  assert.equal(await sound.getAttribute('aria-pressed'), 'true', 'o som começa ligado');
  await sound.click();
  assert.equal(await sound.getAttribute('aria-pressed'), 'false');

  await device.page.reload();
  await device.page.waitForSelector(LOBBY, { timeout: WAIT_MS });
  assert.equal(device.page.url(), address, 'quem abriu a mesa volta pra mesma mesa');
  assert.deepEqual(await roster(device), ['Lia']);
  assert.equal(await sound.getAttribute('aria-pressed'), 'false', 'a escolha do som fica guardada');

  await device.page.getByRole('button', { name: 'Sair da mesa' }).click();
  await device.page.getByRole('button', { name: 'Fechar a mesa' }).click();
  await device.page.waitForSelector('.app--inicio', { timeout: WAIT_MS });
  assert.equal(new URL(device.page.url()).search, '', 'o endereço deixa de apontar pra mesa fechada');
});

test('nenhuma página registrou erro no console, exceção, requisição falha ou 404', () => {
  assert.ok(devices.length >= 10);
  for (const device of devices) assert.deepEqual(device.errors, [], `erros na página de ${device.name}`);
});
