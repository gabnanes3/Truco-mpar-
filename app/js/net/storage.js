// localStorage behind a wrapper that never throws: private mode, a full quota or a missing storage only
// mean "nothing is persisted", never a broken app.

/**
 * The part of the Web Storage API that is used.
 * @typedef {Object} StorageLike
 * @property {(key: string) => string | null} getItem
 * @property {(key: string, value: string) => void} setItem
 * @property {(key: string) => void} removeItem
 */

export const STORAGE_KEYS = Object.freeze({
  identity: 'trucoimpar.identity',
  hostRoom: 'trucoimpar.host',
  lastRoom: 'trucoimpar.lastRoom',
});

/**
 * @returns {StorageLike | null} the page's localStorage when it exists and accepts writes
 */
export function browserStorage() {
  try {
    const storage = /** @type {{ localStorage?: StorageLike }} */ (globalThis).localStorage;
    if (storage === undefined || storage === null) return null;
    const probe = 'trucoimpar.probe';
    storage.setItem(probe, '1');
    storage.removeItem(probe);
    return storage;
  } catch {
    return null;
  }
}

/** JSON values in a storage that may be missing or failing. */
export class SafeStorage {
  /** @param {StorageLike | null} backend null when there is no storage at all */
  constructor(backend) {
    this.backend = backend;
  }

  /**
   * @param {string} key
   * @returns {unknown} the stored JSON value; null when absent, unreadable or not JSON
   */
  read(key) {
    try {
      const text = this.backend === null ? null : this.backend.getItem(key);
      return typeof text === 'string' ? JSON.parse(text) : null;
    } catch {
      return null;
    }
  }

  /**
   * @param {string} key
   * @param {unknown} value any JSON value
   * @returns {boolean} whether the value was stored
   */
  write(key, value) {
    try {
      if (this.backend === null) return false;
      this.backend.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  }

  /** @param {string} key */
  remove(key) {
    try {
      if (this.backend !== null) this.backend.removeItem(key);
    } catch {
      // Nothing to do: the entry stays, and every reader validates what it reads.
    }
  }
}
