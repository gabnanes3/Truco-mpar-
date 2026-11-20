// The host's whole room as it is written to storage after every change, and the strict reader that decides
// whether a stored snapshot can be trusted to resume from.

import { checkInvariants } from '../engine/game.js';
import { ROOM_MAX_AGE_MS } from './identity.js';
import { exactRecord, isCount, isPlayerId, isSecret, isTargetScore, normalizeCode } from './protocol.js';
import { STORAGE_KEYS } from './storage.js';

/** @typedef {import('../engine/types.js').MatchState} MatchState */
/** @typedef {import('./types.js').RoomPhase} RoomPhase */
/** @typedef {import('./types.js').MemberRole} MemberRole */
/** @typedef {import('./types.js').TargetScore} TargetScore */
/** @typedef {import('./storage.js').SafeStorage} SafeStorage */

/**
 * @typedef {Object} MemberRecord
 * @property {string} id
 * @property {string | null} secret bound on the first join; null for the host's own seat, which never joins
 *   over the network
 * @property {string} name
 * @property {MemberRole} role
 */
/**
 * A wall-clock deadline: the turn (or shared raise answer) being timed, or the pause before the next deal.
 * @typedef {Object} Deadline
 * @property {string} key identifies the situation being timed; a new key means a new deadline
 * @property {number} at
 * @property {number} total
 */
/**
 * @typedef {Object} HostSnapshot
 * @property {1} v
 * @property {number} savedAt
 * @property {string} code
 * @property {RoomPhase} phase
 * @property {TargetScore} targetScore
 * @property {string} hostId
 * @property {MemberRecord[]} members players in seat order, then spectators in join order
 * @property {string[]} kicked identities that may not come back
 * @property {MatchState | null} match null exactly in the lobby
 * @property {number} seq
 * @property {Deadline | null} deadline
 */

const SNAPSHOT_KEYS = ['v', 'savedAt', 'code', 'phase', 'targetScore', 'hostId', 'members', 'kicked', 'match', 'seq', 'deadline'];
/** Tolerance for a clock that was set back a little between the save and the load. */
const CLOCK_SLACK_MS = 60 * 1000;

/**
 * @param {unknown} value
 * @returns {HostSnapshot | null} the value when it is a coherent snapshot
 */
export function parseHostSnapshot(value) {
  const top = exactRecord(value, SNAPSHOT_KEYS);
  if (top === null || top.v !== 1 || typeof top.savedAt !== 'number' || !isCount(top.seq)) return null;
  if (normalizeCode(top.code) !== top.code || !isTargetScore(top.targetScore) || !isPlayerId(top.hostId)) return null;
  if (top.phase !== 'lobby' && top.phase !== 'match' && top.phase !== 'ended') return null;
  if (!Array.isArray(top.kicked) || !top.kicked.every(isPlayerId)) return null;

  const { members, match, deadline } = top;
  if (!Array.isArray(members) || !members.every((item) => {
    const member = exactRecord(item, ['id', 'secret', 'name', 'role']);
    return member !== null && isPlayerId(member.id) && typeof member.name === 'string'
      && (member.role === 'player' || member.role === 'spectator')
      && (member.id === top.hostId ? member.secret === null && member.role === 'player' : isSecret(member.secret));
  })) return null;
  const records = /** @type {MemberRecord[]} */ (members);
  const ids = records.map((member) => member.id);
  if (new Set(ids).size !== ids.length || !ids.includes(top.hostId)) return null;

  if (deadline !== null) {
    const timed = exactRecord(deadline, ['key', 'at', 'total']);
    if (timed === null || typeof timed.key !== 'string' || typeof timed.at !== 'number' || !isCount(timed.total)) return null;
  }
  if ((match === null) !== (top.phase === 'lobby')) return null;
  if (match !== null) {
    if (checkInvariants(match).length > 0) return null;
    const state = /** @type {MatchState} */ (match);
    if ((state.phase === 'over') !== (top.phase === 'ended') || state.targetScore !== top.targetScore) return null;
    // While the match runs, the seated members are exactly the players still in it.
    const playing = state.players.filter((player) => !player.removed).map((player) => player.id).sort();
    const seated = records.filter((member) => member.role === 'player').map((member) => member.id).sort();
    if (top.phase === 'match' && playing.join() !== seated.join()) return null;
  }
  return /** @type {HostSnapshot} */ (/** @type {unknown} */ (top));
}

/**
 * @param {SafeStorage} storage
 * @param {number} now
 * @returns {HostSnapshot | null} the room this device hosts, if it was saved in the last 12 hours. Anything
 *   else found under the key is deleted.
 */
export function loadHostSnapshot(storage, now) {
  const snapshot = parseHostSnapshot(storage.read(STORAGE_KEYS.hostRoom));
  const age = snapshot === null ? Infinity : now - snapshot.savedAt;
  if (snapshot === null || age > ROOM_MAX_AGE_MS || age < -CLOCK_SLACK_MS) {
    storage.remove(STORAGE_KEYS.hostRoom);
    return null;
  }
  return snapshot;
}
