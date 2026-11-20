// Mechanical checks of the table screen, on the state gallery: the real table code rendering snapshots
// built by the real engine. Every state is opened at phone and desktop sizes and must have no horizontal
// scroll, nothing outside the viewport, no overlapping plates or cards, touch targets of 44 px, no text
// under 11 px and no console errors. Screenshots are saved outside the repository to be looked at.

import assert from 'node:assert/strict';
import { mkdir } from 'node:fs/promises';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { ESTADOS } from './support/galeria-estados.js';
import { startGalleryServer } from './support/galeria-servidor.js';

const SHOTS = process.env.GALERIA_CAPTURAS
  ?? '/tmp/claude-0/-home-user/ae1380f4-6561-5426-99b9-b88233832240/scratchpad/work/galeria';
// The three sizes the table is designed for, plus a 360×640 phone with the browser bars showing.
const VIEWPORTS = [{ width: 320, height: 568 }, { width: 360, height: 640 }, { width: 1280, height: 800 }, { width: 360, height: 560 }];

/** @type {import('playwright').Browser} */
let browser;
/** @type {Awaited<ReturnType<typeof startGalleryServer>>} */
let server;

before(async () => {
  await mkdir(SHOTS, { recursive: true });
  server = await startGalleryServer();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  await server?.close();
});

/**
 * Opens a page that records everything that would be an error for a player.
 * @param {{ width: number, height: number }} viewport
 * @param {'reduce' | 'no-preference'} motion
 */
async function openPage(viewport, motion) {
  const context = await browser.newContext({ viewport, reducedMotion: motion, deviceScaleFactor: 2, hasTouch: viewport.width < 600 });
  const page = await context.newPage();
  /** @type {string[]} */
  const errors = [];
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`console: ${message.text()}`);
  });
  page.on('pageerror', (error) => errors.push(`exception: ${error.message}`));
  page.on('requestfailed', (request) => errors.push(`request failed: ${request.url()}`));
  page.on('response', (response) => {
    if (response.status() >= 400) errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });
  /**
   * @param {string} query
   * @param {() => Promise<unknown>} [during] runs while the gallery is still feeding snapshots
   */
  const show = async (query, during = async () => {}) => {
    await page.goto(`${server.url}?${query}`);
    await during();
    await page.waitForFunction(() => document.documentElement.dataset.pronto === '1');
    await page.evaluate(() => document.fonts.ready);
  };
  return { context, page, errors, show };
}

/** Runs in the page: everything that is mechanically wrong with the layout on screen. @returns {string[]} */
function layoutProblems() {
  /** @type {string[]} */
  const problems = [];
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  /** @param {Element} node */
  const visible = (node) => {
    const box = node.getBoundingClientRect();
    return box.width > 0 && box.height > 0 && node.checkVisibility({ visibilityProperty: true });
  };
  /** @param {Element} node */
  const name = (node) => `<${node.tagName.toLowerCase()} class="${node.getAttribute('class') ?? ''}"> "${(node.textContent ?? '').trim().slice(0, 28)}"`;
  /** @param {string} selector */
  const all = (selector) => Array.from(document.querySelectorAll(selector)).filter(visible);

  if (document.documentElement.scrollWidth > vw) problems.push(`horizontal scroll: ${document.documentElement.scrollWidth} > ${vw}`);
  if (document.documentElement.scrollHeight > vh) problems.push(`vertical scroll: ${document.documentElement.scrollHeight} > ${vh}`);

  const parts = all('.topo > *, .placa, .placa__deu, .mesa .vaga, .mesa .carta, .giz-anel, .vaga__nota, .centro, .meu, .meu button, '
    + '.tempo, .dica, .pedido, .grito, .responder, .resultado, .assistindo, .balao, .provocar, .lado .lousa');
  for (const node of parts) {
    const box = node.getBoundingClientRect();
    if (box.left < -0.5 || box.top < -0.5 || box.right > vw + 0.5 || box.bottom > vh + 0.5) {
      problems.push(`outside the viewport: ${name(node)} [${Math.round(box.left)},${Math.round(box.top)} → ${Math.round(box.right)},${Math.round(box.bottom)}]`);
    }
  }

  const solids = all('.placa, .mesa .vaga, .mesa .carta, .mesa .vale, .vale__quem, .vira');
  solids.forEach((a, index) => {
    for (const b of solids.slice(index + 1)) {
      if (a.contains(b) || b.contains(a) || (a.closest('.vaga, .vira') !== null && a.closest('.vaga, .vira') === b.closest('.vaga, .vira'))) continue;
      const one = a.getBoundingClientRect();
      const two = b.getBoundingClientRect();
      const overlapX = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const overlapY = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (overlapX > 0.5 && overlapY > 0.5) problems.push(`overlap: ${name(a)} × ${name(b)} (${overlapX.toFixed(1)} × ${overlapY.toFixed(1)} px)`);
    }
  });

  // The raise sign is slammed where it covers no card and no plate (its box before the tilt is what counts).
  for (const sign of all('.pedido')) {
    const one = sign.getBoundingClientRect();
    for (const node of all('.mesa .carta, .mesa .placa, .vira')) {
      const two = node.getBoundingClientRect();
      const overlapX = Math.min(one.right, two.right) - Math.max(one.left, two.left);
      const overlapY = Math.min(one.bottom, two.bottom) - Math.max(one.top, two.top);
      if (overlapX > 0.5 && overlapY > 0.5) problems.push(`under the raise sign: ${name(node)} (${overlapX.toFixed(1)} × ${overlapY.toFixed(1)} px)`);
    }
  }

  // The line under the hand carries rules (e.g. that raise answers are secret): it must never be cut.
  for (const line of all('.dica > span:last-child')) {
    if (line.scrollWidth > line.clientWidth) problems.push(`cut text: ${name(line)}`);
  }

  for (const node of all('button')) {
    const control = /** @type {HTMLElement} */ (node);
    if (control.offsetWidth < 44 || control.offsetHeight < 44) problems.push(`touch target ${control.offsetWidth}×${control.offsetHeight}: ${name(control)}`);
  }

  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    const owner = text.parentElement;
    if (!owner || (text.textContent ?? '').trim() === '' || !visible(owner) || owner.closest('.so-leitor')) continue;
    const size = parseFloat(getComputedStyle(owner).fontSize);
    if (size < 11) problems.push(`text at ${size}px: ${name(owner)}`);
  }
  return problems;
}

for (const viewport of VIEWPORTS) {
  const size = `${viewport.width}x${viewport.height}`;
  test(`todos os estados da galeria cabem e não se sobrepõem em ${size}`, async () => {
    const { context, show, page, errors } = await openPage(viewport, 'reduce');
    /** @type {string[]} */
    const failures = [];
    for (const estado of ESTADOS) {
      if (estado === 'sequencia') continue;
      await show(`estado=${estado}`);
      await page.screenshot({ path: `${SHOTS}/${estado}-${size}.png` });
      const problems = await page.evaluate(layoutProblems);
      failures.push(...problems.map((problem) => `${estado} @ ${size}: ${problem}`), ...errors.splice(0).map((error) => `${estado} @ ${size}: ${error}`));
    }
    await context.close();
    assert.deepEqual(failures, []);
  });
}

test('o seletor de provocações abre, cabe na tela, manda uma só e fica em espera', async () => {
  const { context, show, page, errors } = await openPage(VIEWPORTS[0], 'reduce');
  await show('estado=minha-vez&relogio=vivo');
  await page.click('button[aria-label="Provocar a mesa"]');
  await page.screenshot({ path: `${SHOTS}/provocacoes-abertas-320x568.png` });
  assert.equal(await page.locator('.provocar__op').count(), 8);
  assert.deepEqual(await page.evaluate(layoutProblems), []);
  await page.click('.provocar__op >> nth=1');
  assert.equal(await page.locator('.provocar').count(), 0, 'the picker closes after choosing');
  assert.equal(await page.locator('button[aria-label="Provocar a mesa"]').isDisabled(), true, 'no second taunt during the cooldown');
  assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).intents), [['taunt', 'medo']]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('toque duplo na carta ou carta seguida de truco manda uma intenção só', async () => {
  const { context, show, page, errors } = await openPage(VIEWPORTS[1], 'reduce');
  await show('estado=minha-vez');
  assert.equal(await page.locator('.pedir').isDisabled(), false, 'I may raise on my turn');
  await page.locator('.mao__cartas .carta').first().click();
  assert.equal(await page.locator('.mao__cartas .carta:disabled').count(), 3, 'the hand is held while the intent is in flight');
  assert.equal(await page.locator('.pedir').isDisabled(), true);
  await page.locator('.mao__cartas .carta').nth(1).dispatchEvent('click');
  await page.locator('.pedir').dispatchEvent('click');
  assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).intents), [['play', 'Ko']]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('responder a um pedido manda aceitar ou correr uma vez só', async () => {
  const { context, show, page, errors } = await openPage(VIEWPORTS[1], 'reduce');
  await show('estado=pedido-responder');
  assert.match(await page.locator('.pedido').innerText(), /DUDA PEDIU\s+TRUCO!/i);
  assert.match(await page.locator('.dica').innerText(), /As respostas ficam em segredo até todo mundo responder\./);
  assert.equal(await page.locator('.mao__cartas .carta:disabled').count(), 3, 'no card can be played while a raise is pending');
  assert.equal(await page.locator('.pedir').isVisible(), false, 'the answer takes the place of the raise plate');
  await page.click('.responder__aceitar');
  await page.locator('.responder__correr').dispatchEvent('click');
  assert.deepEqual(await page.evaluate(() => /** @type {any} */ (window).intents), [['respond', true]]);
  assert.deepEqual(errors, []);
  await context.close();
});

test('uma mão inteira animada termina igual a desenhar só a última foto', async () => {
  /** What the table shows, without anything that depends on how it got there. */
  const summary = () => ({
    mesa: Array.from(document.querySelectorAll('.mesa .vaga')).map((slot) => Array.from(slot.querySelectorAll('[data-carta]'))
      .map((card) => `${card.getAttribute('data-carta')}${card.classList.contains('carta--anulada') ? ' anulada' : ''}${card.hasAttribute('data-destaque') ? ' destaque' : ''}`)),
    mao: Array.from(document.querySelectorAll('.mao__cartas [data-carta]')).map((card) => card.getAttribute('data-carta')),
    placas: Array.from(document.querySelectorAll('.placa')).map((plate) => plate.getAttribute('aria-label')),
    vale: document.querySelector('.centro .vale')?.getAttribute('aria-label'),
    rodadas: Array.from(document.querySelectorAll('.rodada')).map((cell) => `${cell.getAttribute('data-estado')} ${cell.getAttribute('data-quem')}`),
    pedido: document.querySelector('.pedido')?.hasAttribute('hidden'),
    resultado: document.querySelector('.resultado')?.hasAttribute('hidden'),
    dica: document.querySelector('.dica')?.textContent,
  });
  const animated = await openPage(VIEWPORTS[1], 'no-preference');
  // The first finished round stays a moment on the table and is then collected by whoever won it.
  await animated.show('estado=sequencia', () => animated.page.waitForSelector('.vaga__jogada.anim-recolher', { state: 'attached' }));
  await animated.page.waitForTimeout(1900); // longer than any card takes to leave the table
  const afterAnimation = await animated.page.evaluate(summary);
  assert.deepEqual(await animated.page.evaluate(layoutProblems), []);
  await animated.page.screenshot({ path: `${SHOTS}/sequencia-360x640.png` });

  const direct = await openPage(VIEWPORTS[1], 'reduce');
  await direct.show('estado=sequencia&passo=ultimo');
  assert.deepEqual(afterAnimation, await direct.page.evaluate(summary));
  assert.equal(afterAnimation.mao?.length, 3, 'the new hand was dealt');
  assert.deepEqual([...animated.errors, ...direct.errors], []);
  await animated.context.close();
  await direct.context.close();
});
