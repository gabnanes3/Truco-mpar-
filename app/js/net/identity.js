// Who this device is ({ playerId, secret, name }) and which room it was last in, kept in storage so a reload
// lands on the same seat with the same cards.

import { randomText } from './env.js';
import { cleanName, isPlayerId, isSecret, normalizeCode, exactRecord } from './protocol.js';
import { STORAGE_KEYS } from './storage.js';

/** @typedef {import('./env.js').Random} Random */
/** @typedef {import('./storage.js').SafeStorage} SafeStorage */

/**
 * @typedef {Object} Identity
 * @property {string} playerId public
 * @property {string} secret proves the seat is ours; sent only to the host, in `hello`
 * @property {string} name '' until the person chooses one
 */
/**
 * @typedef {Object} LastRoom
 * @property {string} code
 * @property {'host' | 'guest'} role
 * @property {number} at when it was last seen alive (ms)
 */

/** A stored room older than this is forgotten (same limit as the host's snapshot). */
export const ROOM_MAX_AGE_MS = 12 * 60 * 60 * 1000;

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * @param {Random} random
 * @param {string} [name]
 * @returns {Identity} a brand new identity (not stored)
 */
export function createIdentity(random, name = '') {
  return {
    playerId: `p${randomText(random, ID_ALPHABET, 15)}`,
    secret: randomText(random, ID_ALPHABET, 32),
    name: cleanName(name) ?? '',
  };
}

/**
 * @param {SafeStorage} storage
 * @returns {Identity | null} the stored identity, when there is a valid one
 */
export function loadIdentity(storage) {
  const stored = exactRecord(storage.read(STORAGE_KEYS.identity), ['playerId', 'secret', 'name']);
  if (stored === null || !isPlayerId(stored.playerId) || !isSecret(stored.secret)) return null;
  return { playerId: stored.playerId, secret: stored.secret, name: cleanName(stored.name) ?? '' };
}

/**
 * The device's identity: the stored one, or a new one that is stored right away. Passing a name updates it.
 * Works without storage too: the identity then lives as long as the caller keeps the returned object.
 * @param {SafeStorage} storage
 * @param {Random} random
 * @param {string} [name]
 * @returns {Identity}
 */
export function ensureIdentity(storage, random, name) {
  const identity = loadIdentity(storage) ?? createIdentity(random);
  const chosen = name === undefined ? null : cleanName(name);
  if (chosen !== null) identity.name = chosen;
  storage.write(STORAGE_KEYS.identity, identity);
  return identity;
}

/**
 * @param {SafeStorage} storage
 * @param {number} now
 * @returns {LastRoom | null} the room this device was in, if it was seen alive in the last 12 hours
 */
export function loadLastRoom(storage, now) {
  const stored = exactRecord(storage.read(STORAGE_KEYS.lastRoom), ['code', 'role', 'at']);
  if (stored === null || normalizeCode(stored.code) !== stored.code || typeof stored.code !== 'string') return null;
  if (stored.role !== 'host' && stored.role !== 'guest') return null;
  if (typeof stored.at !== 'number' || !(now - stored.at <= ROOM_MAX_AGE_MS)) return null;
  return { code: stored.code, role: stored.role, at: stored.at };
}

/**
 * @param {SafeStorage} storage
 * @param {LastRoom} room
 */
export function saveLastRoom(storage, room) {
  storage.write(STORAGE_KEYS.lastRoom, room);
}

/**
 * Forgets the last room, but only if it is still `code`: another tab may have moved on to another room.
 * @param {SafeStorage} storage
 * @param {string} code
 */
export function clearLastRoom(storage, code) {
  const stored = exactRecord(storage.read(STORAGE_KEYS.lastRoom), ['code', 'role', 'at']);
  if (stored === null || stored.code === code) storage.remove(STORAGE_KEYS.lastRoom);
}
