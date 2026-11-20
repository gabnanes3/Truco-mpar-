// Shapes used by the engine, as JSDoc typedefs. This module has no runtime content.
//
// Two vocabularies, on purpose:
// - inside the STATE players are referred to by SEAT (a number: the index into `state.players`);
// - everything that leaves the engine (actions in, views and events out) refers to players by ID (a string).
// Cards are always strings, so the type checker tells the three apart.

/** @typedef {'deal' | 'play' | 'truco' | 'over'} Phase */

/**
 * Why a hand ended.
 * - `rounds`: decided by the rounds won (spec 2.1, rules 2 to 4);
 * - `allRan`: a raise that nobody accepted, the caller takes the value before the raise;
 * - `lastStanding`: only one player was left in the hand;
 * - `allTied`: three rounds without a winner, nobody scores.
 * @typedef {'rounds' | 'allRan' | 'lastStanding' | 'allTied'} HandReason
 */

/** @typedef {'score' | 'abandon'} MatchReason */

/** @typedef {'ran' | 'removed'} LeaveReason */

/**
 * Stable codes returned by `apply` for actions that are not valid right now.
 * @typedef {'bad-action' | 'match-over' | 'wrong-phase' | 'bad-deck' | 'unknown-player' | 'not-your-turn'
 *   | 'card-not-in-hand' | 'raise-at-max' | 'raise-twice' | 'raise-at-eleven' | 'not-in-hand' | 'own-raise'
 *   | 'already-answered' | 'already-removed'} ErrorCode
 */

// ---------------------------------------------------------------------------------------------- state

/**
 * @typedef {Object} PlayerInfo
 * @property {string} id unique within the match
 * @property {string} name
 */

/**
 * @typedef {Object} PlayerState
 * @property {string} id
 * @property {string} name
 * @property {number} score
 * @property {boolean} removed permanently out of the match; the seat keeps its index
 */

/**
 * @typedef {Object} Play
 * @property {number} seat
 * @property {string} card
 * @property {boolean} voided the player left the hand before the round ended, so the card does not count
 */

/**
 * A completed round.
 * @typedef {Object} Round
 * @property {number} leader seat that opened the round
 * @property {Play[]} plays in playing order
 * @property {number | null} winner seat with the single strongest counting card; null when the round tied
 */

/**
 * The round being played.
 * @typedef {Object} OpenRound
 * @property {number} leader seat the playing order starts from (alive when the round started)
 * @property {Play[]} plays in playing order
 */

/**
 * @typedef {Object} RaiseAnswer
 * @property {number} seat
 * @property {boolean} accept false = run
 */

/**
 * A raise waiting for answers.
 * @typedef {Object} RaiseState
 * @property {number} caller
 * @property {number} value the proposed hand value
 * @property {RaiseAnswer[]} answers secret until resolution. A responder removed from the match stays here
 *   as a runner although it already left the hand.
 */

/**
 * @typedef {Object} HandState
 * @property {number} number 1-based hand number within the match
 * @property {string} vira
 * @property {string} manilha the manilha RANK of this hand
 * @property {number} value current hand value (a ladder step)
 * @property {number | null} lastRaiser seat of the last accepted raise
 * @property {number[]} dealtIn seats dealt in, in deal order (round-1 leader first, dealer last)
 * @property {number[]} alive seats still in the hand, in deal order
 * @property {string[][]} cards cards held, indexed by seat (empty for seats out of the hand). HIDDEN.
 * @property {Round[]} rounds completed rounds
 * @property {OpenRound | null} current round in progress; null once the hand ended on a round boundary
 * @property {number | null} turn seat that plays the next card (the caller while a raise is pending);
 *   null once the hand ended
 * @property {RaiseState | null} raise
 * @property {string[]} discards cards thrown away by players who left the hand. HIDDEN.
 * @property {string[]} stock cards that were not dealt. HIDDEN.
 */

/**
 * @typedef {Object} HandResultState
 * @property {number} hand hand number this result belongs to
 * @property {number | null} winner seat; null when nobody scored
 * @property {number} value points given to the winner (0 when nobody scored)
 * @property {HandReason} reason
 */

/**
 * @typedef {Object} MatchResultState
 * @property {number} winner seat
 * @property {MatchReason} reason
 */

/**
 * The whole match. Plain JSON: safe to persist and to `JSON.parse(JSON.stringify(...))` at any point.
 * Never send it to a client: it contains every hidden card. Use `viewFor`.
 * @typedef {Object} MatchState
 * @property {PlayerState[]} players seats in playing order
 * @property {Phase} phase
 * @property {number} dealer seat that deals the hand in progress; in phase 'deal', the hand about to be dealt
 * @property {number} handNumber hands dealt so far
 * @property {HandState | null} hand the hand in progress ('play', 'truco') or the last finished hand, kept
 *   frozen for display ('deal', 'over'); null before the first deal
 * @property {HandResultState | null} lastHand result of the most recently finished hand
 * @property {MatchResultState | null} result set exactly when phase is 'over'
 */

// -------------------------------------------------------------------------------------------- actions

/**
 * Deals a new hand. `deck` is the 40 distinct card ids, already shuffled by the caller.
 * @typedef {{ type: 'deal', deck: string[] }} DealAction
 */
/** @typedef {{ type: 'play', playerId: string, card: string }} PlayAction */
/**
 * Raises the hand to the next ladder value.
 * @typedef {{ type: 'truco', playerId: string }} TrucoAction
 */
/**
 * Answers a pending raise: accept = true, run = false.
 * @typedef {{ type: 'respond', playerId: string, accept: boolean }} RespondAction
 */
/**
 * Removes a player from the match for good (kick or voluntary leave).
 * @typedef {{ type: 'remove', playerId: string }} RemoveAction
 */
/** @typedef {DealAction | PlayAction | TrucoAction | RespondAction | RemoveAction} Action */

/** @typedef {{ ok: true, state: MatchState, events: EngineEvent[] }} ApplySuccess */
/**
 * `state` is the very same object that was passed in.
 * @typedef {{ ok: false, error: ErrorCode, state: MatchState }} ApplyFailure
 */
/** @typedef {ApplySuccess | ApplyFailure} ApplyResult */

// --------------------------------------------------------------------------------------------- events
// Public facts, in the order they happened. `round` is always the 0-based index into the hand's rounds.

/**
 * @typedef {Object} HandDealtEvent
 * @property {'handDealt'} type
 * @property {number} hand
 * @property {string} dealer
 * @property {string} leader
 * @property {string[]} players dealt in, in deal order
 * @property {string} vira
 * @property {string} manilha
 */
/**
 * @typedef {Object} CardPlayedEvent
 * @property {'cardPlayed'} type
 * @property {string} playerId
 * @property {string} card
 * @property {number} round
 */
/**
 * @typedef {Object} RoundEndedEvent
 * @property {'roundEnded'} type
 * @property {number} round
 * @property {string | null} winner null when the round tied
 */
/**
 * @typedef {Object} TrucoCalledEvent
 * @property {'trucoCalled'} type
 * @property {string} playerId
 * @property {number} value the proposed hand value
 */
/**
 * Someone answered; what they answered stays secret.
 * @typedef {Object} TrucoAnsweredEvent
 * @property {'trucoAnswered'} type
 * @property {string} playerId
 */
/**
 * @typedef {Object} TrucoResolvedEvent
 * @property {'trucoResolved'} type
 * @property {string} caller
 * @property {string[]} accepted in deal order; empty means the caller takes the hand
 * @property {string[]} ran in deal order; includes responders removed while the raise was pending
 * @property {number} value the hand value after the resolution
 */
/**
 * The caller was removed from the match, so the raise never happened.
 * @typedef {Object} TrucoCancelledEvent
 * @property {'trucoCancelled'} type
 * @property {string} caller
 */
/**
 * @typedef {Object} PlayerLeftHandEvent
 * @property {'playerLeftHand'} type
 * @property {string} playerId
 * @property {LeaveReason} reason
 */
/**
 * @typedef {Object} PlayerRemovedEvent
 * @property {'playerRemoved'} type
 * @property {string} playerId
 */
/**
 * @typedef {Object} HandEndedEvent
 * @property {'handEnded'} type
 * @property {number} hand
 * @property {string | null} winner
 * @property {number} value points given to the winner (0 when nobody scored)
 * @property {HandReason} reason
 */
/**
 * @typedef {Object} MatchEndedEvent
 * @property {'matchEnded'} type
 * @property {string} winner
 * @property {MatchReason} reason
 */
/**
 * @typedef {HandDealtEvent | CardPlayedEvent | RoundEndedEvent | TrucoCalledEvent | TrucoAnsweredEvent
 *   | TrucoResolvedEvent | TrucoCancelledEvent | PlayerLeftHandEvent | PlayerRemovedEvent | HandEndedEvent
 *   | MatchEndedEvent} EngineEvent
 */

// ----------------------------------------------------------------------------------------------- view

/**
 * @typedef {Object} ViewPlayer
 * @property {string} id
 * @property {string} name
 * @property {number} score
 * @property {boolean} removed
 */
/**
 * @typedef {Object} ViewPlay
 * @property {string} playerId
 * @property {string} card
 * @property {boolean} voided
 */
/**
 * @typedef {Object} ViewRound
 * @property {string} leader
 * @property {ViewPlay[]} plays
 * @property {string | null} winner null when the round tied
 */
/**
 * @typedef {Object} ViewRaise
 * @property {string} caller
 * @property {number} value the proposed hand value
 * @property {string[]} waiting players who still have to answer
 * @property {string[]} answered players who already answered (what they answered is not here)
 * @property {boolean} mustAnswer the viewer is in `waiting`
 * @property {boolean | null} myAnswer the viewer's own answer, null if none yet
 */
/**
 * The hand in progress, or the last finished one while phase is 'deal' / 'over'.
 * @typedef {Object} ViewHand
 * @property {number} number
 * @property {string} vira
 * @property {string} manilha the manilha RANK
 * @property {number} value
 * @property {number | null} nextValue what a raise would propose; null at the top of the ladder
 * @property {string | null} lastRaiser
 * @property {string | null} turn who plays the next card (the caller while a raise is pending); null once the
 *   hand ended
 * @property {string | null} leader who opened the current round (may have left the hand since); null when
 *   there is no current round
 * @property {ViewRound[]} rounds completed rounds
 * @property {ViewPlay[]} plays cards on the table in the current round
 * @property {string[]} dealtIn in deal order
 * @property {string[]} alive still in the hand
 * @property {string[]} ran left the hand, by running or by being removed
 * @property {number[]} cardCounts cards held, aligned with `View.players`
 * @property {string[]} myCards the viewer's own cards (empty for spectators)
 * @property {boolean} canRaise the viewer may call a raise right now
 * @property {ViewRaise | null} raise
 */
/**
 * @typedef {Object} HandResult
 * @property {number} hand
 * @property {string | null} winner null when nobody scored
 * @property {number} value points given to the winner (0 when nobody scored)
 * @property {HandReason} reason
 */
/**
 * @typedef {Object} MatchResult
 * @property {string} winner
 * @property {MatchReason} reason
 */
/**
 * What one client is allowed to know. The only engine data that may leave the host.
 * @typedef {Object} View
 * @property {Phase} phase
 * @property {ViewPlayer[]} players seats in playing order
 * @property {string | null} viewer the viewer's id when seated in this match, null for spectators
 * @property {string} dealer who deals the hand in progress; in phase 'deal', the hand about to be dealt
 * @property {number} handNumber hands dealt so far
 * @property {ViewHand | null} hand null before the first deal
 * @property {HandResult | null} lastHand result of the most recently finished hand
 * @property {MatchResult | null} result set exactly when phase is 'over'
 */

export {};
