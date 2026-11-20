// Contract between the session layer (host room / guest client) and the UI.
// The UI renders ONLY from RoomSnapshot and acts ONLY through GameClient.

/** @typedef {import('../engine/types.js').View} View */
/** @typedef {import('../engine/types.js').EngineEvent} EngineEvent */

/** @typedef {'lobby' | 'match' | 'ended'} RoomPhase */
/** @typedef {'player' | 'spectator'} MemberRole */
/** @typedef {6 | 9 | 12} TargetScore */

/**
 * @typedef {Object} Member
 * @property {string} id public player id (never the secret)
 * @property {string} name chosen by that player: untrusted text, render with textContent only
 * @property {MemberRole} role
 * @property {boolean} connected
 * @property {boolean} isHost
 */
/**
 * @typedef {Object} RoomInfo
 * @property {string} code 6-character room code
 * @property {RoomPhase} phase
 * @property {{ targetScore: TargetScore }} settings
 * @property {Member[]} members players in seat order first, then spectators in join order
 */
/**
 * Countdown for whoever must act now. Remaining time is relative to the moment the snapshot was produced,
 * so clients count down from `RoomSnapshot.receivedAt` on their own clock.
 * @typedef {Object} TimerInfo
 * @property {number} remainingMs
 * @property {number} totalMs
 * @property {string[]} players ids being timed (one on a turn; every pending responder during a raise)
 */
/**
 * @typedef {Object} TauntEvent
 * @property {'taunt'} type
 * @property {string} playerId
 * @property {string} tauntId an id from TAUNTS (taunts.js); free text never travels
 */
/** @typedef {EngineEvent | TauntEvent} RoomEvent */

/** @typedef {'connecting' | 'online' | 'reconnecting' | 'host-away' | 'closed'} ConnectionState */
/**
 * Terminal problems; when set, `connection` is 'closed'.
 * @typedef {'not-found' | 'full' | 'kicked' | 'bad-version' | 'host-closed' | 'broker-unreachable'} RoomError
 */
/**
 * Everything one client knows. Same shape for the host's own seat and for remote guests.
 * @typedef {Object} RoomSnapshot
 * @property {number} seq room-wide counter, +1 per broadcast; animate `events` only when contiguous
 * @property {RoomInfo} room
 * @property {{ id: string, role: MemberRole, isHost: boolean }} you
 * @property {View | null} game null in the lobby; the engine view for this client otherwise
 * @property {TimerInfo | null} timer null when nobody is being timed
 * @property {RoomEvent[]} events public events produced since the previous snapshot
 * @property {ConnectionState} connection
 * @property {RoomError | null} error
 * @property {number} receivedAt this client's clock (ms) when the snapshot arrived
 */
/**
 * What the UI talks to. Intents are fire-and-forget: the answer is the next snapshot. Invalid or
 * unauthorised intents are ignored by the host.
 * @typedef {Object} GameClient
 * @property {() => RoomSnapshot | null} getSnapshot null until the first snapshot exists
 * @property {(listener: (snapshot: RoomSnapshot) => void) => () => void} subscribe returns an unsubscribe
 * @property {(card: string) => void} play
 * @property {() => void} raise call truco / seis / nove / doze
 * @property {(accept: boolean) => void} respond answer a pending raise
 * @property {(tauntId: string) => void} taunt
 * @property {() => void} leave leave the room for good and stop reconnecting
 * @property {() => void} start host only
 * @property {(playerId: string) => void} kick host only
 * @property {() => void} newMatch host only: back to the lobby after a match ended
 * @property {(target: TargetScore) => void} setTargetScore host only, lobby only
 * @property {() => void} close release timers and connections without leaving the room (page teardown)
 */

export {};
