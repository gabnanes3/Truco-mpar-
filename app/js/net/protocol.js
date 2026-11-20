// What travels between a guest and the host, and the strict checks applied to everything that arrives.
// Nothing here trusts its input: a parser returns null for anything that is not exactly a known message.

import { isCard } from '../engine/cards.js';
import { TARGET_OPTIONS } from '../engine/rules.js';
import { randomText } from './env.js';
import { isTauntId } from './taunts.js';

/** @typedef {import('./types.js').RoomInfo} RoomInfo */
/** @typedef {import('./types.js').Member} Member */
/** @typedef {import('./types.js').MemberRole} MemberRole */
/** @typedef {import('./types.js').TimerInfo} TimerInfo */
/** @typedef {import('./types.js').RoomEvent} RoomEvent */
/** @typedef {import('./types.js').TargetScore} TargetScore */
/** @typedef {import('./types.js').View} View */

export const PROTOCOL_VERSION = 1;

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 6;
export const NAME_MAX_LENGTH = 14;
export const MAX_SPECTATORS = 8;
/** A name that cleans down to nothing still needs something to show. */
export const FALLBACK_NAME = 'Jogador';

const ID_PATTERN = /^[A-Za-z0-9_-]{6,40}$/;
const SECRET_PATTERN = /^[A-Za-z0-9_-]{16,80}$/;
/** Raw names longer than this are not even cleaned: the message is dropped. */
const RAW_NAME_LIMIT = 200;
// Control characters, zero-width characters and direction overrides: never part of a name.
const INVISIBLE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202f\u2060-\u206f\ufeff]/g;

// ------------------------------------------------------------------------------------------- messages

/**
 * First message of every connection. `attempt` grows with every connection the same identity opens, so the
 * host can tell a fresh connection from a stale one whose hello arrived late.
 * @typedef {{ t: 'hello', v: number, playerId: string, secret: string, name: string, attempt: number }} HelloMessage
 */
/** A hello from another protocol version: nothing else about it can be trusted. @typedef {{ t: 'bad-version' }} BadVersion */
/** @typedef {{ t: 'ping' }} PingMessage */
/**
 * What a member asks the host to do. The last four are for the host's own seat only.
 * @typedef {{ t: 'play', card: string } | { t: 'truco' } | { t: 'respond', accept: boolean }
 *   | { t: 'taunt', id: string } | { t: 'leave' }
 *   | { t: 'start' } | { t: 'kick', playerId: string } | { t: 'newMatch' }
 *   | { t: 'setTarget', target: TargetScore }} Intent
 */
/** @typedef {HelloMessage | BadVersion | PingMessage | Intent} ClientMessage */

/**
 * The full picture for one client, plus the public events since the previous broadcast.
 * @typedef {Object} StateMessage
 * @property {'state'} t
 * @property {number} seq
 * @property {RoomInfo} room
 * @property {{ id: string, role: MemberRole, isHost: boolean }} you
 * @property {View | null} game
 * @property {TimerInfo | null} timer
 * @property {RoomEvent[]} events
 */
/**
 * Why the host is ending this connection for good. 'refused' covers a wrong secret; 'replaced' means a newer
 * connection of the same identity took over (another tab).
 * @typedef {'full' | 'kicked' | 'bad-version' | 'host-closed' | 'refused' | 'replaced' | 'left'} ByeReason
 */
/** @typedef {{ t: 'bye', reason: ByeReason }} ByeMessage */
/** @typedef {{ t: 'pong' }} PongMessage */
/** @typedef {StateMessage | ByeMessage | PongMessage} HostMessage */

const BYE_REASONS = ['full', 'kicked', 'bad-version', 'host-closed', 'refused', 'replaced', 'left'];

// --------------------------------------------------------------------------------------- small checks

/**
 * @param {unknown} value
 * @param {readonly string[]} keys
 * @returns {Record<string, unknown> | null} the value when it is a plain object with exactly these keys
 */
export function exactRecord(value, keys) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const own = Object.keys(value);
  if (own.length !== keys.length || !keys.every((key) => own.includes(key))) return null;
  return /** @type {Record<string, unknown>} */ (value);
}

/** @param {unknown} value @returns {value is number} */
export function isCount(value) {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/** @param {unknown} value @returns {value is string} */
export function isPlayerId(value) {
  return typeof value === 'string' && ID_PATTERN.test(value);
}

/** @param {unknown} value @returns {value is string} */
export function isSecret(value) {
  return typeof value === 'string' && SECRET_PATTERN.test(value);
}

/** @param {unknown} value @returns {value is TargetScore} */
export function isTargetScore(value) {
  return typeof value === 'number' && TARGET_OPTIONS.includes(value);
}

// ------------------------------------------------------------------------------------ codes and names

/**
 * @param {unknown} input what a person typed or a URL carried
 * @returns {string | null} the code in canonical form (upper case, no spaces); null when it is not a code
 */
export function normalizeCode(input) {
  if (typeof input !== 'string' || input.length > 40) return null;
  const code = input.replace(/\s+/g, '').toUpperCase();
  if (code.length !== CODE_LENGTH || [...code].some((letter) => !CODE_ALPHABET.includes(letter))) return null;
  return code;
}

/** @param {import('./env.js').Random} random @returns {string} */
export function generateCode(random) {
  return randomText(random, CODE_ALPHABET, CODE_LENGTH);
}

/**
 * @param {unknown} input
 * @returns {string | null} the name without invisible characters, trimmed, at most 14 characters; null when
 *   nothing is left
 */
export function cleanName(input) {
  if (typeof input !== 'string') return null;
  const visible = input.replace(INVISIBLE, ' ').replace(/\s+/g, ' ').trim();
  const name = [...visible].slice(0, NAME_MAX_LENGTH).join('').trim();
  return name === '' ? null : name;
}

/**
 * @param {string} name a clean name
 * @param {readonly string[]} taken names already in the room
 * @returns {string} `name`, or `name 2`, `name 3`… (shortened to fit) when it is taken
 */
export function uniqueName(name, taken) {
  const used = new Set(taken.map((other) => other.toLowerCase()));
  if (!used.has(name.toLowerCase())) return name;
  for (let number = 2; ; number += 1) {
    const suffix = ` ${number}`;
    const candidate = [...name].slice(0, NAME_MAX_LENGTH - suffix.length).join('').trim() + suffix;
    if (!used.has(candidate.toLowerCase())) return candidate;
  }
}

// ----------------------------------------------------------------------------------- guest → host

/**
 * @param {unknown} raw whatever arrived on a connection
 * @returns {ClientMessage | null} null for anything that is not exactly one of the known messages
 */
export function parseClientMessage(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const type = /** @type {Record<string, unknown>} */ (raw).t;
  switch (type) {
    case 'hello':
      return parseHello(raw);
    case 'ping':
    case 'truco':
    case 'leave':
    case 'start':
    case 'newMatch':
      return exactRecord(raw, ['t']) === null ? null : { t: type };
    case 'play': {
      const message = exactRecord(raw, ['t', 'card']);
      return message !== null && isCard(message.card) ? { t: type, card: message.card } : null;
    }
    case 'respond': {
      const message = exactRecord(raw, ['t', 'accept']);
      return message !== null && typeof message.accept === 'boolean' ? { t: type, accept: message.accept } : null;
    }
    case 'taunt': {
      const message = exactRecord(raw, ['t', 'id']);
      return message !== null && isTauntId(message.id) ? { t: type, id: message.id } : null;
    }
    case 'kick': {
      const message = exactRecord(raw, ['t', 'playerId']);
      return message !== null && isPlayerId(message.playerId) ? { t: type, playerId: message.playerId } : null;
    }
    case 'setTarget': {
      const message = exactRecord(raw, ['t', 'target']);
      return message !== null && isTargetScore(message.target) ? { t: type, target: message.target } : null;
    }
    default:
      return null;
  }
}

/**
 * @param {object} raw an object whose `t` is 'hello'
 * @returns {HelloMessage | BadVersion | null}
 */
function parseHello(raw) {
  const version = /** @type {Record<string, unknown>} */ (raw).v;
  if (typeof version !== 'number') return null;
  if (version !== PROTOCOL_VERSION) return { t: 'bad-version' };
  const message = exactRecord(raw, ['t', 'v', 'playerId', 'secret', 'name', 'attempt']);
  if (message === null) return null;
  const { playerId, secret, name, attempt } = message;
  if (!isPlayerId(playerId) || !isSecret(secret) || !isCount(attempt)) return null;
  if (typeof name !== 'string' || name.length > RAW_NAME_LIMIT) return null;
  return { t: 'hello', v: version, playerId, secret, name, attempt };
}

// ----------------------------------------------------------------------------------- host → guest

/**
 * @param {unknown} raw whatever arrived from the host
 * @returns {HostMessage | null}
 */
export function parseHostMessage(raw) {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
  const type = /** @type {Record<string, unknown>} */ (raw).t;
  if (type === 'pong') return exactRecord(raw, ['t']) === null ? null : { t: 'pong' };
  if (type === 'bye') {
    const message = exactRecord(raw, ['t', 'reason']);
    if (message === null || typeof message.reason !== 'string' || !BYE_REASONS.includes(message.reason)) return null;
    return { t: 'bye', reason: /** @type {ByeReason} */ (message.reason) };
  }
  if (type !== 'state') return null;
  const message = exactRecord(raw, ['t', 'seq', 'room', 'you', 'game', 'timer', 'events']);
  if (message === null || !isCount(message.seq)) return null;
  if (!isRoomInfo(message.room) || !isYou(message.you) || !isTimer(message.timer)) return null;
  if (message.game !== null && !isViewLike(message.game)) return null;
  if (!Array.isArray(message.events) || !message.events.every(isEventLike)) return null;
  return /** @type {StateMessage} */ (/** @type {unknown} */ (message));
}

/** @param {unknown} value @returns {boolean} */
function isRole(value) {
  return value === 'player' || value === 'spectator';
}

/** @param {unknown} value @returns {boolean} */
function isRoomInfo(value) {
  const room = exactRecord(value, ['code', 'phase', 'settings', 'members']);
  if (room === null || normalizeCode(room.code) !== room.code) return false;
  if (room.phase !== 'lobby' && room.phase !== 'match' && room.phase !== 'ended') return false;
  const settings = exactRecord(room.settings, ['targetScore']);
  if (settings === null || !isTargetScore(settings.targetScore)) return false;
  return Array.isArray(room.members) && room.members.length <= 32 && room.members.every((item) => {
    const member = exactRecord(item, ['id', 'name', 'role', 'connected', 'isHost']);
    return member !== null && isPlayerId(member.id) && typeof member.name === 'string'
      && member.name.length <= 2 * NAME_MAX_LENGTH && isRole(member.role)
      && typeof member.connected === 'boolean' && typeof member.isHost === 'boolean';
  });
}

/** @param {unknown} value @returns {boolean} */
function isYou(value) {
  const you = exactRecord(value, ['id', 'role', 'isHost']);
  return you !== null && isPlayerId(you.id) && isRole(you.role) && typeof you.isHost === 'boolean';
}

/** @param {unknown} value @returns {boolean} */
function isTimer(value) {
  if (value === null) return true;
  const timer = exactRecord(value, ['remainingMs', 'totalMs', 'players']);
  return timer !== null && isCount(timer.remainingMs) && isCount(timer.totalMs)
    && Array.isArray(timer.players) && timer.players.every(isPlayerId);
}

/**
 * The host is the authority on the game, so the view is only checked for the outline the UI indexes into.
 * @param {unknown} value
 * @returns {boolean}
 */
function isViewLike(value) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const view = /** @type {Record<string, unknown>} */ (value);
  const { hand } = view;
  if (!isTargetScore(view.targetScore) || typeof view.phase !== 'string' || typeof view.dealer !== 'string') return false;
  if (!Array.isArray(view.players) || !view.players.every((item) => {
    const player = exactRecord(item, ['id', 'name', 'score', 'removed']);
    return player !== null && typeof player.id === 'string' && typeof player.name === 'string'
      && isCount(player.score) && typeof player.removed === 'boolean';
  })) return false;
  if (hand === null) return true;
  if (typeof hand !== 'object' || hand === undefined || Array.isArray(hand)) return false;
  const fields = /** @type {Record<string, unknown>} */ (hand);
  return ['rounds', 'plays', 'dealtIn', 'alive', 'ran', 'cardCounts', 'myCards'].every((key) => Array.isArray(fields[key]))
    && Array.isArray(fields.myCards) && fields.myCards.every(isCard);
}

/** @param {unknown} value @returns {boolean} */
function isEventLike(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    && typeof (/** @type {Record<string, unknown>} */ (value).type) === 'string';
}
