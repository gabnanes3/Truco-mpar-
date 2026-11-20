// The two ways into a room, with the device's stored identity: create one, or enter one by its code.
// Entering resumes the room as its host when this device was hosting it, and joins as a guest otherwise.

import { createEnv } from './env.js';
import { GuestClient } from './guest-client.js';
import { HostRoom } from './host-room.js';
import { ensureIdentity } from './identity.js';

/** @typedef {import('./types.js').GameClient} GameClient */
/** @typedef {import('./transport.js').Transport} Transport */
/** @typedef {import('./env.js').EnvOptions} EnvOptions */

/**
 * @typedef {Object} Session
 * @property {'host' | 'guest'} role
 * @property {GameClient} client what the UI renders from and acts through
 * @property {string} playerId this device's public id
 */

/**
 * Creates a room hosted by this device. The room code is `client.getSnapshot().room.code`; it is final once
 * the snapshot's `connection` is 'online' (a code collision at the broker picks another one before that).
 * @param {{ transport: Transport, name: string, env?: EnvOptions }} options
 * @returns {Session}
 */
export function createRoom(options) {
  const env = createEnv(options.env);
  const identity = ensureIdentity(env.storage, env.random, options.name);
  const room = HostRoom.create({ transport: options.transport, identity, env: options.env });
  return { role: 'host', client: room.client, playerId: identity.playerId };
}

/**
 * Enters the room with that code: as its host again when storage holds this device's snapshot of it (after a
 * reload), as a guest otherwise. A guest with a seat there gets the same seat and cards back.
 * @param {{ transport: Transport, code: string, name?: string, env?: EnvOptions }} options `name` updates the
 *   stored name; leave it out to keep the one already stored
 * @returns {Session}
 */
export function enterRoom(options) {
  const env = createEnv(options.env);
  const identity = ensureIdentity(env.storage, env.random, options.name);
  const { transport, code } = options;
  const room = HostRoom.resume({ transport, code, identity, env: options.env });
  if (room !== null) return { role: 'host', client: room.client, playerId: identity.playerId };
  const client = new GuestClient({ transport, code, identity, env: options.env });
  return { role: 'guest', client, playerId: identity.playerId };
}
