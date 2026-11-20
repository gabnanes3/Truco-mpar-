// What the interface needs from the session layer, wired to the browser: the PeerJS transport, localStorage,
// the real clock and `crypto`. Two calls open a room, each returning the GameClient the UI renders from.

import { createEnv } from './env.js';
import { loadIdentity, loadLastRoom } from './identity.js';
import { createPeerTransport } from './peer-transport.js';
import { createRoom, enterRoom } from './session.js';

/** @typedef {import('./types.js').GameClient} GameClient */
/** @typedef {import('./identity.js').LastRoom} LastRoom */

/** Holds no state: one for the whole page is enough. */
const transport = createPeerTransport();

/**
 * Creates a room hosted by this device, with the host seated in its lobby. The room code is
 * `client.getSnapshot().room.code`; it is final once the snapshot's `connection` is 'online' (put it in the
 * URL only then). If the broker cannot be reached the client ends with `error: 'broker-unreachable'`.
 * @param {string} name the host's name; it is cleaned (trimmed, 14 characters) and stored for next time
 * @returns {GameClient}
 */
export function hostRoom(name) {
  return createRoom({ transport, name }).client;
}

/**
 * Enters the room with that code, as whoever this device is in it: its host again when this device was
 * hosting it (the room is resumed from storage, same code, same match), a guest otherwise — in the same seat
 * with the same cards when it had one. `client.getSnapshot().you.isHost` tells which of the two it is.
 * @param {string} code as typed or as found in `?sala=`; upper/lower case and spaces do not matter
 * @param {string} [name] updates the stored name; leave it out (a reload) to keep the one already stored
 * @returns {GameClient}
 */
export function joinRoom(code, name) {
  return enterRoom({ transport, code, name }).client;
}

/** @returns {string} the name this device used last time, '' when there is none */
export function savedName() {
  return loadIdentity(createEnv().storage)?.name ?? '';
}

/** @returns {LastRoom | null} the room this device was in during the last 12 hours, for a "voltar à sala" */
export function lastRoom() {
  const env = createEnv();
  return loadLastRoom(env.storage, env.clock.now());
}
