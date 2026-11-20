// Everything the session layer needs from the outside world, injectable so tests run on a fake clock, a
// seeded generator and an in-memory storage. The defaults are the browser's (they also work in Node).

import { SafeStorage, browserStorage } from './storage.js';

/**
 * @typedef {Object} Clock
 * @property {() => number} now wall-clock milliseconds
 * @property {(callback: () => void, ms: number) => unknown} setTimeout returns a handle for clearTimeout
 * @property {(handle: unknown) => void} clearTimeout
 */
/**
 * @typedef {Object} Random
 * @property {(bound: number) => number} int a uniform integer in [0, bound)
 */
/**
 * Calls `handler` whenever the device may have been away (tab visible again, network back).
 * @typedef {(handler: () => void) => () => void} WakeSource returns an unsubscribe
 */
/**
 * Timings in milliseconds; every key can be overridden through `globalThis.__TRUCO_CONFIG__`.
 * @typedef {Object} SessionConfig
 * @property {number} turnMs time to play a card, or (shared by all responders) to answer a raise
 * @property {number} handPauseMs pause on the hand result before the next deal
 * @property {number} disconnectGraceMs time a disconnected player gets before the default action
 * @property {number} heartbeatMs
 * @property {number} heartbeatTimeoutMs silence after which the other side counts as gone
 */
/**
 * @typedef {Object} Env
 * @property {Clock} clock
 * @property {Random} random
 * @property {SafeStorage} storage
 * @property {WakeSource} onWake
 * @property {SessionConfig} config
 */
/**
 * @typedef {Object} EnvOptions
 * @property {Clock} [clock]
 * @property {Random} [random]
 * @property {import('./storage.js').StorageLike | null} [storage] null = no persistence
 * @property {WakeSource} [onWake]
 * @property {Partial<SessionConfig>} [config] wins over `globalThis.__TRUCO_CONFIG__`
 */

/** @type {Readonly<SessionConfig>} */
export const DEFAULT_CONFIG = Object.freeze({
  turnMs: 15000,
  handPauseMs: 4500,
  disconnectGraceMs: 6000,
  heartbeatMs: 4000,
  heartbeatTimeoutMs: 12000,
});

/** @type {Clock} */
export const systemClock = {
  now: () => Date.now(),
  setTimeout: (callback, ms) => setTimeout(callback, ms),
  clearTimeout: (handle) => clearTimeout(/** @type {ReturnType<typeof setTimeout>} */ (handle)),
};

/** Unbiased integers from `crypto.getRandomValues` (rejection sampling, no modulo bias). @type {Random} */
export const cryptoRandom = {
  int(bound) {
    const limit = Math.floor(0x100000000 / bound) * bound;
    const buffer = new Uint32Array(1);
    do {
      globalThis.crypto.getRandomValues(buffer);
    } while (buffer[0] >= limit);
    return buffer[0] % bound;
  },
};

/** @type {WakeSource} */
export function browserWake(handler) {
  const page = /** @type {{ document?: Document, addEventListener?: Function, removeEventListener?: Function }} */ (globalThis);
  const doc = page.document;
  if (doc === undefined || typeof page.addEventListener !== 'function') return () => {};
  const onVisible = () => {
    if (doc.visibilityState === 'visible') handler();
  };
  doc.addEventListener('visibilitychange', onVisible);
  globalThis.addEventListener('online', handler);
  return () => {
    doc.removeEventListener('visibilitychange', onVisible);
    globalThis.removeEventListener('online', handler);
  };
}

/**
 * @param {Partial<SessionConfig>} [overrides]
 * @returns {SessionConfig} defaults, then `globalThis.__TRUCO_CONFIG__`, then `overrides`; bad values ignored
 */
export function readConfig(overrides = {}) {
  const fromPage = /** @type {{ __TRUCO_CONFIG__?: unknown }} */ (globalThis).__TRUCO_CONFIG__;
  /** @type {Record<string, unknown>[]} */
  const layers = [typeof fromPage === 'object' && fromPage !== null ? { ...fromPage } : {}, { ...overrides }];
  const config = { ...DEFAULT_CONFIG };
  for (const layer of layers) {
    for (const key of /** @type {(keyof SessionConfig)[]} */ (Object.keys(DEFAULT_CONFIG))) {
      const value = layer[key];
      if (typeof value === 'number' && Number.isFinite(value) && value >= 0) config[key] = value;
    }
  }
  return config;
}

/**
 * @param {EnvOptions} [options]
 * @returns {Env}
 */
export function createEnv(options = {}) {
  return {
    clock: options.clock ?? systemClock,
    random: options.random ?? cryptoRandom,
    storage: new SafeStorage(options.storage === undefined ? browserStorage() : options.storage),
    onWake: options.onWake ?? browserWake,
    config: readConfig(options.config),
  };
}

/**
 * Fisher–Yates: every permutation is equally likely when `random.int` is unbiased.
 * @template T
 * @param {readonly T[]} items
 * @param {Random} random
 * @returns {T[]} a shuffled copy
 */
export function shuffled(items, random) {
  const list = [...items];
  for (let last = list.length - 1; last > 0; last -= 1) {
    const pick = random.int(last + 1);
    [list[last], list[pick]] = [list[pick], list[last]];
  }
  return list;
}

/**
 * @param {Random} random
 * @param {string} alphabet
 * @param {number} length
 * @returns {string}
 */
export function randomText(random, alphabet, length) {
  let text = '';
  for (let index = 0; index < length; index += 1) text += alphabet[random.int(alphabet.length)];
  return text;
}
