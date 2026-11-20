// The servers a browser test needs, both on free ports: the static server (the app at `/`, plus the test
// pages of this folder under their real path, so their relative imports are the same in the browser and on
// disk) and a local PeerJS broker. Returns the URLs and the `__TRUCO_CONFIG__` that points a page at them.
//
//   const servers = await startServers({ config: { turnMs: 60000 } });
//   const context = await browser.newContext();
//   await servers.inject(context);                    // before any page of the context loads
//   await page.goto(servers.appUrl);                  // or servers.harnessUrl
//   await servers.close();

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';
import { startStaticServer } from '../../../tools/serve.js';

/** @typedef {import('../../../app/js/net/env.js').SessionConfig} SessionConfig */
/**
 * @typedef {Object} PeerSettings
 * @property {string} host
 * @property {number} port
 * @property {string} path
 * @property {boolean} secure
 * @property {unknown[]} iceServers
 */
/** @typedef {SessionConfig & { peer: PeerSettings }} TrucoConfig what a page finds in `globalThis.__TRUCO_CONFIG__` */
/**
 * @typedef {Object} TestServers
 * @property {string} appUrl the app (app/index.html)
 * @property {string} supportUrl this folder: `${supportUrl}harness.html`
 * @property {string} harnessUrl the transport harness page
 * @property {TrucoConfig} config local broker, no ICE servers, short timers (plus the overrides)
 * @property {(context: import('playwright').BrowserContext) => Promise<void>} inject makes every page of the
 *   context start with `config` in `globalThis.__TRUCO_CONFIG__`
 * @property {() => Promise<void>} stopBroker the broker goes away, as in an outage
 * @property {() => Promise<void>} startBroker and comes back on the same port, having forgotten everything
 * @property {() => Promise<void>} close
 */

const HOST = '127.0.0.1';
const SUPPORT_PREFIX = '/tests/e2e/support/';
const BROKER_PATH = '/truco';
const BROKER_SCRIPT = fileURLToPath(new URL('./servidores-peer.mjs', import.meta.url));

/** Timers short enough for a test to see every transition, long enough not to fire by accident. */
const TEST_TIMINGS = Object.freeze({
  turnMs: 20000,
  handPauseMs: 300,
  disconnectGraceMs: 6000,
  heartbeatMs: 500,
  heartbeatTimeoutMs: 4000,
});

/**
 * Runs in the page, before its own scripts.
 * @param {TrucoConfig} config
 */
function setConfig(config) {
  Object.assign(globalThis, { __TRUCO_CONFIG__: config });
}

/**
 * @param {number} port 0 picks a free one
 * @returns {Promise<{ port: number, stop: () => Promise<void> }>}
 */
async function runBroker(port) {
  const child = spawn(process.execPath, [BROKER_SCRIPT, String(port), BROKER_PATH], { stdio: ['pipe', 'pipe', 'inherit'] });
  const exited = once(child, 'exit');
  const lines = createInterface({ input: child.stdout });
  const [line] = await Promise.race([
    once(lines, 'line'),
    exited.then(() => Promise.reject(new Error('the local PeerJS broker did not start'))),
  ]);
  lines.close();
  return {
    port: JSON.parse(line).port,
    stop: async () => {
      child.kill();
      await exited;
    },
  };
}

/**
 * @param {{ config?: Partial<SessionConfig> }} [options] `config` overrides the test timings
 * @returns {Promise<TestServers>}
 */
export async function startServers(options = {}) {
  const pages = await startStaticServer(0, HOST, {
    [SUPPORT_PREFIX]: fileURLToPath(new URL('.', import.meta.url)),
    '/app/': fileURLToPath(new URL('../../../app/', import.meta.url)),
  });
  /** @type {Awaited<ReturnType<typeof runBroker>> | null} */
  let broker = await runBroker(0);
  const brokerPort = broker.port;
  /** @type {TrucoConfig} */
  const config = {
    ...TEST_TIMINGS,
    ...options.config,
    peer: { host: HOST, port: brokerPort, path: BROKER_PATH, secure: false, iceServers: [] },
  };
  const stopBroker = async () => {
    const running = broker;
    broker = null;
    if (running !== null) await running.stop();
  };
  const supportUrl = `${pages.url}${SUPPORT_PREFIX.slice(1)}`;
  return {
    appUrl: pages.url,
    supportUrl,
    harnessUrl: `${supportUrl}harness.html`,
    config,
    inject: async (context) => {
      await context.addInitScript(setConfig, config);
    },
    stopBroker,
    startBroker: async () => {
      if (broker === null) broker = await runBroker(brokerPort);
    },
    close: async () => {
      await Promise.all([pages.close(), stopBroker()]);
    },
  };
}
