// The transport interface the session layer is written against. Two implementations: MemoryNetwork (tests)
// and the PeerJS adapter (production). This module has no runtime content.
//
// Rules every implementation follows:
// - everything is asynchronous: no handler is ever called before the call that registered it has returned;
// - messages are plain JSON values and arrive in the order they were sent, or not at all;
// - a connection may die without notice (`onClose` is best effort): the session layer runs its own heartbeat;
// - `close()` is abrupt: messages still in flight may be lost, and the local side gets no callback.

/**
 * An open, bidirectional link between one guest and the host. Handlers are plain assignable properties: set
 * them synchronously when the connection is handed over (`onOpen` / `onConnection`), before returning.
 * @typedef {Object} Connection
 * @property {(message: unknown) => void} send never throws; silently dropped once the connection is closed
 * @property {() => void} close idempotent; after it no handler of this connection is called again
 * @property {((message: unknown) => void) | null} onMessage
 * @property {(() => void) | null} onClose the other side closed or the link was lost; called at most once
 */

/** @typedef {'not-found' | 'unreachable'} ConnectFailure no such room right now / the network or broker failed */
/**
 * Exactly one of the two is called, once, unless the attempt is cancelled first.
 * @typedef {Object} ConnectHandlers
 * @property {(connection: Connection) => void} onOpen
 * @property {(reason: ConnectFailure) => void} onFail
 */
/**
 * @typedef {Object} PendingConnect
 * @property {() => void} cancel gives up: no handler is called afterwards and a late connection is closed
 */

/** @typedef {'code-taken' | 'unreachable'} ListenFailure the room code is in use / the network or broker failed */
/**
 * @typedef {Object} ListenHandlers
 * @property {() => void} onOpen the room is reachable by its code
 * @property {(connection: Connection) => void} onConnection a guest connected; the connection is already open
 * @property {(reason: ListenFailure) => void} onClose the room could not be opened, or stopped being reachable
 *   for good: this listener is dead and `listen` must be called again. Connections already open stay open.
 */
/**
 * @typedef {Object} Listener
 * @property {() => void} close stops accepting connections; `onClose` is not called
 */
/**
 * @typedef {Object} ListenOptions
 * @property {boolean} resume true when re-opening a code this device already owned (after a reload or an
 *   outage): the adapter should then wait out a stale registration instead of reporting 'code-taken' at once
 */

/**
 * @typedef {Object} Transport
 * @property {(code: string, handlers: ListenHandlers, options: ListenOptions) => Listener} listen host side
 * @property {(code: string, handlers: ConnectHandlers) => PendingConnect} connect guest side
 */

export {};
