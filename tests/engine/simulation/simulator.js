// Plays whole matches with seeded random (but always valid) actions and inspects the engine after every
// single step. The inspection avoids node:assert and needless allocations on purpose: it runs hundreds of
// thousands of times, and the suite has to stay within a few seconds.

import { fullDeck } from '../../../app/js/engine/cards.js';
import {
  LADDER, apply, canRaise, checkInvariants, createMatch, defaultAction, pendingPlayers, viewFor,
} from '../../../app/js/engine/game.js';
import { dealOrder, deepFreeze, prng, shuffledDeck } from '../helpers.js';

/** @typedef {import('../../../app/js/engine/types.js').MatchState} MatchState */
/** @typedef {import('../../../app/js/engine/types.js').Action} Action */
/** @typedef {import('../../../app/js/engine/types.js').EngineEvent} EngineEvent */
/** @typedef {import('../../../app/js/engine/types.js').View} View */

/**
 * @typedef {Object} MatchPlan
 * @property {number} seed
 * @property {number} playerCount
 * @property {boolean} [timeoutsOnly] every action is the timeout default: nobody raises, nobody is removed
 * @property {number} [maxSteps] generous bound on the number of actions (default 20000)
 */

/**
 * @typedef {Object} MatchReport
 * @property {number} steps actions applied
 * @property {MatchState} state the final state
 * @property {Record<string, number>} seen how often each event type, hand ending (`hand:<reason>`), resolved
 *   raise (`value:<hand value after it>`) and match ending (`match:<reason>`) happened
 */

/**
 * How a simulated table behaves; drawn per match so that cautious and reckless tables are both covered.
 * @typedef {Object} Mood
 * @property {number} raise chance of raising when allowed
 * @property {number} accept chance of accepting a raise
 * @property {number} remove chance, per action, that somebody is removed from the match instead
 * @property {number} lazy chance of just doing the timeout default
 */

/** @typedef {(message: string) => never} Fail */

const DECK = fullDeck();
const DEFAULT_MAX_STEPS = 20000;

/**
 * Plays one match to the end. Throws an Error naming the seed, the step and the latest actions as soon as
 * anything is off, so the failure can be replayed.
 * @param {MatchPlan} plan
 * @returns {MatchReport}
 */
export function playMatch(plan) {
  const random = prng(plan.seed);
  const timeoutsOnly = plan.timeoutsOnly === true;
  const maxSteps = plan.maxSteps ?? DEFAULT_MAX_STEPS;
  /** @type {Mood} */
  const mood = {
    raise: 0.08 + random() * 0.5,
    accept: 0.15 + random() * 0.75,
    remove: random() < 0.5 ? 0 : 0.002 + random() * 0.03,
    lazy: random() * 0.3,
  };
  const players = Array.from({ length: plan.playerCount }, (_, seat) => ({ id: `player${seat}`, name: `Jogador ${seat + 1}` }));
  let state = createMatch(players, { dealerIndex: Math.floor(random() * plan.playerCount) });
  /** @type {Action[]} */
  const history = [];
  /** @type {Record<string, number>} */
  const seen = {};
  /** @type {Fail} */
  const fail = (message) => {
    const recent = history.slice(-12).map((action) => JSON.stringify(action.type === 'deal' ? { type: 'deal' } : action));
    throw new Error(`${message}\n  seed ${plan.seed}, ${plan.playerCount} players, after ${history.length} actions`
      + `\n  latest actions: ${recent.join(' ')}`);
  };

  inspectState(state, random, fail);
  while (state.phase !== 'over') {
    if (history.length >= maxSteps) fail(`the match did not end within ${maxSteps} actions`);
    const action = timeoutsOnly ? timeoutAction(state, random) : randomAction(state, random, mood);
    const result = apply(state, action);
    history.push(action);
    if (!result.ok) return fail(`a valid action was rejected with ${result.error}`);
    inspectTransition(state, action, result.state, result.events, seen, fail);
    const hidden = inspectState(result.state, random, fail);
    // Events are public: they may not mention any card that is still face down after the action.
    const leak = findString(result.events, (text) => text.length === 2 && hidden.has(text));
    if (leak !== null) fail(`an event mentions the hidden card ${leak}`);
    // One match in eight runs on frozen states: any attempt of the engine to write to its input throws.
    state = plan.seed % 8 === 0 ? deepFreeze(result.state) : result.state;
  }
  if (state.result === null) return fail('the match is over without a result');
  seen[`match:${state.result.reason}`] = 1;
  // Once the match is over nothing moves any more, not even a deal or a removal.
  /** @type {Action[]} */
  const tooLate = [{ type: 'deal', deck: DECK }, ...players.map(({ id }) => /** @type {Action} */ ({ type: 'remove', playerId: id }))];
  for (const action of tooLate) {
    const result = apply(state, action);
    if (result.ok || result.error !== 'match-over' || result.state !== state) fail(`${action.type} was not refused after the match`);
  }
  return { steps: history.length, state, seen };
}

/**
 * @template T
 * @param {readonly T[]} list
 * @param {() => number} random
 * @returns {T}
 */
function pick(list, random) {
  return list[Math.floor(random() * list.length)];
}

/**
 * What a table of players who all let their clocks run out does.
 * @param {MatchState} state
 * @param {() => number} random
 * @returns {Action}
 */
function timeoutAction(state, random) {
  if (state.phase === 'deal') return { type: 'deal', deck: shuffledDeck(random) };
  const playerId = pick(pendingPlayers(state), random);
  const action = defaultAction(state, playerId);
  if (action === null) throw new Error(`no default action for the pending player ${playerId}`);
  return action;
}

/**
 * @param {MatchState} state
 * @param {() => number} random
 * @param {Mood} mood
 * @returns {Action}
 */
function randomAction(state, random, mood) {
  if (random() < mood.remove) {
    const present = state.players.filter((player) => !player.removed);
    return { type: 'remove', playerId: pick(present, random).id };
  }
  if (state.phase === 'deal' || random() < mood.lazy) return timeoutAction(state, random);

  const playerId = pick(pendingPlayers(state), random);
  if (state.phase === 'truco') return { type: 'respond', playerId, accept: random() < mood.accept };
  if (canRaise(state, playerId) && random() < mood.raise) return { type: 'truco', playerId };
  // Clients choose a card from their own view, so the simulation does too.
  const cards = viewFor(state, playerId).hand?.myCards ?? [];
  return { type: 'play', playerId, card: pick(cards, random) };
}

/**
 * What must hold between a state and its successor.
 * @param {MatchState} before
 * @param {Action} action
 * @param {MatchState} after
 * @param {EngineEvent[]} events
 * @param {Record<string, number>} seen
 * @param {Fail} fail
 */
function inspectTransition(before, action, after, events, seen, fail) {
  if (after === before) fail('a valid action returned the state it was given');
  let scorer = -1;
  let points = 0;
  let handEnded = false;
  let matchEnded = false;
  /** @param {string} what */
  const count = (what) => {
    seen[what] = (seen[what] ?? 0) + 1;
  };
  for (const event of events) {
    count(event.type);
    if (event.type === 'handEnded') {
      count(`hand:${event.reason}`);
      handEnded = true;
      scorer = after.players.findIndex((player) => player.id === event.winner);
      points = event.value;
      if ((event.winner === null) !== (event.value === 0)) fail('a hand is worth 0 exactly when nobody wins it');
    } else if (event.type === 'trucoResolved') {
      count(`value:${event.value}`);
    } else if (event.type === 'matchEnded') {
      matchEnded = true;
    } else if (event.type === 'trucoAnswered' && Object.keys(event).length !== 2) {
      fail('a trucoAnswered event must say who answered and nothing else');
    }
  }
  // Only the winner of a hand scores, exactly what the hand was worth; nobody ever loses points. Seats keep
  // their identity, and a removed player stays removed.
  after.players.forEach((player, seat) => {
    const earlier = before.players[seat];
    const expected = earlier.score + (seat === scorer ? points : 0);
    if (player.score !== expected) fail(`${player.id} has ${player.score} points, expected ${expected}`);
    if (player.id !== earlier.id || player.name !== earlier.name) fail(`seat ${seat} changed identity`);
    if (earlier.removed && !player.removed) fail(`${player.id} came back after being removed`);
  });
  if (matchEnded !== (after.phase === 'over')) fail('matchEnded must be emitted exactly when the match ends');
  if (after.handNumber !== before.handNumber + (action.type === 'deal' ? 1 : 0)) fail('only a deal starts a new hand');

  // The dealer moves one active seat forward when a hand ends, and when the player about to deal is removed.
  let dealer = before.dealer;
  if (after.phase === 'deal' && (handEnded || after.players[dealer].removed)) {
    do {
      dealer = (dealer + 1) % after.players.length;
    } while (after.players[dealer].removed);
  }
  if (after.dealer !== dealer) fail(`seat ${after.dealer} is the dealer, expected seat ${dealer}`);

  if (action.type === 'deal') inspectDeal(before, action.deck, after, events, fail);
  else inspectHandStep(before, after, events, fail);
}

/**
 * The fixed deal mapping: three cards each in order from the seat after the dealer, then the vira.
 * @param {MatchState} before
 * @param {string[]} deck
 * @param {MatchState} after
 * @param {EngineEvent[]} events
 * @param {Fail} fail
 */
function inspectDeal(before, deck, after, events, fail) {
  const { hand } = after;
  if (hand === null) return fail('a deal left no hand');
  const order = dealOrder(before);
  const dealtIn = hand.dealtIn.map((seat) => after.players[seat].id);
  if (dealtIn.join() !== order.join()) fail(`dealt to ${dealtIn}, expected ${order}`);
  hand.dealtIn.forEach((seat, position) => {
    if (hand.cards[seat].join() !== deck.slice(3 * position, 3 * position + 3).join()) fail(`seat ${seat} got the wrong cards`);
  });
  if (hand.vira !== deck[3 * order.length]) fail('the vira is not the card after the last hand dealt');
  if (hand.turn !== hand.dealtIn[0] || hand.value !== 1) fail('a hand starts at 1 with the seat after the dealer');

  const expected = {
    type: 'handDealt', hand: after.handNumber, dealer: after.players[after.dealer].id, leader: order[0], players: order,
    vira: hand.vira, manilha: hand.manilha,
  };
  if (JSON.stringify(events) !== JSON.stringify([expected])) fail(`unexpected events for a deal: ${JSON.stringify(events)}`);
}

/**
 * What must hold between two states of the same hand (or of the pause between hands).
 * @param {MatchState} before
 * @param {MatchState} after
 * @param {EngineEvent[]} events
 * @param {Fail} fail
 */
function inspectHandStep(before, after, events, fail) {
  const earlier = before.hand;
  const { hand } = after;
  if (earlier === null || hand === null) {
    if (earlier !== null || hand !== null) fail('a hand appeared or vanished without a deal');
    return;
  }
  /** @param {number} seat */
  const idOf = (seat) => after.players[seat].id;
  let raiseAccepted = false;
  /** @type {string[]} */
  const left = [];
  for (const event of events) {
    if (event.type === 'handDealt') fail('handDealt without a deal');
    if (event.type === 'cardPlayed' && event.round !== earlier.rounds.length) fail('cardPlayed names the wrong round');
    if (event.type === 'roundEnded') {
      const closed = hand.rounds.length === earlier.rounds.length + 1 ? hand.rounds[event.round] : undefined;
      if (event.round !== earlier.rounds.length || closed === undefined) fail('roundEnded does not match a round closed by this action');
      else if (event.winner !== (closed.winner === null ? null : idOf(closed.winner))) fail('roundEnded names the wrong winner');
    }
    if (event.type === 'trucoResolved') raiseAccepted = event.accepted.length > 0;
    if (event.type === 'playerLeftHand') left.push(event.playerId);
  }
  // Nobody comes back into a hand, and every departure is announced exactly once.
  const gone = earlier.alive.filter((seat) => !hand.alive.includes(seat)).map(idOf);
  if (hand.alive.some((seat) => !earlier.alive.includes(seat))) fail('a player came back into the hand');
  if ([...left].sort().join() !== [...gone].sort().join()) fail(`players ${gone} left the hand but the events announce ${left}`);
  // The value only climbs, one step at a time, when a raise is accepted.
  const climbed = LADDER[LADDER.indexOf(earlier.value) + (raiseAccepted ? 1 : 0)];
  if (hand.value !== climbed) fail(`the hand is worth ${hand.value}, expected ${climbed}`);
}

/**
 * What must hold in every state.
 * @param {MatchState} state
 * @param {() => number} random
 * @param {Fail} fail
 * @returns {Set<string>} the cards that are face down in this state
 */
function inspectState(state, random, fail) {
  const violations = checkInvariants(state);
  if (violations.length > 0) fail(`invariants broken: ${violations.join('; ')}`);
  const hidden = inspectCards(state, fail);
  inspectWhoCanAct(state, random, fail);
  inspectViews(state, hidden, random, fail);
  return hidden;
}

/**
 * Card conservation, counted independently of checkInvariants.
 * @param {MatchState} state
 * @param {Fail} fail
 * @returns {Set<string>} the cards that are face down: held, discarded or never dealt
 */
function inspectCards(state, fail) {
  const { hand } = state;
  /** @type {Set<string>} */
  const hidden = new Set();
  if (hand === null) return hidden;
  /** @type {Set<string>} */
  const faceUp = new Set([hand.vira]);
  let count = 1;
  for (const pile of [...hand.cards, hand.discards, hand.stock]) {
    for (const card of pile) {
      hidden.add(card);
      count += 1;
    }
  }
  for (const round of hand.current === null ? hand.rounds : [...hand.rounds, hand.current]) {
    for (const play of round.plays) {
      faceUp.add(play.card);
      count += 1;
    }
  }
  // 40 cards in total, and every card of the deck in exactly one of the two groups: nothing lost or doubled.
  const placedOnce = DECK.filter((card) => hidden.has(card) !== faceUp.has(card)).length;
  if (count !== DECK.length || placedOnce !== DECK.length) {
    fail(`the 40 cards are not each in exactly one place: ${count} found, ${placedOnce} of the deck placed once`);
  }
  return hidden;
}

/**
 * Exactly the pending players can act, and the timeout default of each of them is a valid action.
 * @param {MatchState} state
 * @param {() => number} random
 * @param {Fail} fail
 */
function inspectWhoCanAct(state, random, fail) {
  const pending = pendingPlayers(state);
  if ((state.phase === 'play' || state.phase === 'truco') !== (pending.length > 0)) {
    fail(`phase ${state.phase} with ${pending.length} pending players`);
  }
  /** @param {Action} action */
  const accepted = (action) => {
    const result = apply(state, action);
    if (!result.ok && result.state !== state) fail('a rejected action must return the state it was given');
    return result.ok;
  };
  // Every possible action of one pending player is tried on one step out of four: trying all of them on
  // every step would cost far more time than it adds coverage.
  const probed = pending.length > 0 && random() < 0.25 ? pick(pending, random) : null;

  state.players.forEach((player, seat) => {
    const playerId = player.id;
    const held = state.hand === null ? [] : state.hand.cards[seat];
    const fallback = defaultAction(state, playerId);
    if (player.removed && accepted({ type: 'remove', playerId })) fail(`${playerId} was removed twice`);

    if (!pending.includes(playerId)) {
      if (fallback !== null) fail(`${playerId} is not pending but has a default action`);
      if (canRaise(state, playerId)) fail(`${playerId} is not pending but can raise`);
      if (accepted({ type: 'truco', playerId })) fail(`${playerId} raised without being pending`);
      if (accepted({ type: 'respond', playerId, accept: true })) fail(`${playerId} accepted without being pending`);
      if (accepted({ type: 'respond', playerId, accept: false })) fail(`${playerId} ran without being pending`);
      if (accepted({ type: 'play', playerId, card: DECK[seat] })) fail(`${playerId} played without being pending`);
      for (const card of held) {
        if (accepted({ type: 'play', playerId, card })) fail(`${playerId} played ${card} without being pending`);
      }
      return;
    }

    if (fallback === null || !accepted(fallback)) fail(`${playerId} is pending but its default action is not valid`);
    if (playerId !== probed) return;
    if (state.phase === 'truco') {
      if (!accepted({ type: 'respond', playerId, accept: true })) fail(`${playerId} could not accept`);
      if (!accepted({ type: 'respond', playerId, accept: false })) fail(`${playerId} could not run`);
      if (accepted({ type: 'truco', playerId })) fail(`${playerId} raised while answering`);
      if (held.some((card) => accepted({ type: 'play', playerId, card }))) fail(`${playerId} played while answering`);
    } else {
      if (held.length === 0) fail(`${playerId} must play but holds no cards`);
      if (!held.every((card) => accepted({ type: 'play', playerId, card }))) fail(`${playerId} could not play a held card`);
      if (accepted({ type: 'truco', playerId }) !== canRaise(state, playerId)) fail(`canRaise and apply disagree for ${playerId}`);
      if (accepted({ type: 'respond', playerId, accept: true })) fail(`${playerId} answered without a raise`);
      const foreign = DECK.find((card) => !held.includes(card)) ?? '';
      if (accepted({ type: 'play', playerId, card: foreign })) fail(`${playerId} played a card it does not hold`);
    }
  });
}

/**
 * No view shows a hidden card of somebody else, nor anybody else's answer to a pending raise.
 * @param {MatchState} state
 * @param {Set<string>} hidden the cards that are face down
 * @param {() => number} random
 * @param {Fail} fail
 */
function inspectViews(state, hidden, random, fail) {
  const { hand } = state;
  const pending = pendingPlayers(state);
  const viewers = [...state.players.map((player) => player.id), null];

  viewers.forEach((viewerId, seat) => {
    const view = viewFor(state, viewerId);
    if (hand === null || view.hand === null) {
      if (hand !== null || view.hand !== null) fail('a view must show a hand exactly when there is one');
      return;
    }
    const own = viewerId === null ? [] : hand.cards[seat];
    const leak = findString(view, (text) => text.length === 2 && hidden.has(text) && !own.includes(text));
    if (leak !== null) fail(`the view of ${viewerId ?? 'a spectator'} shows the hidden card ${leak}`);
    const mine = view.hand.myCards;
    if (mine.length !== own.length || mine.some((card, index) => card !== own[index])) {
      fail(`the view of ${viewerId ?? 'a spectator'} does not show exactly its own cards`);
    }
    if (viewerId === null) {
      inspectPublicFacts(state, view, fail);
      return;
    }
    if (view.hand.canRaise !== canRaise(state, viewerId)) fail(`view.canRaise is wrong for ${viewerId}`);
    const mustAnswer = view.hand.raise !== null && view.hand.raise.mustAnswer;
    const mustPlay = state.phase === 'play' && view.hand.turn === viewerId;
    if ((mustAnswer || mustPlay) !== pending.includes(viewerId)) fail(`the view of ${viewerId} disagrees with pendingPlayers`);
  });

  if (hand === null || hand.raise === null) return;
  // Secrecy of the answers: flipping what everybody else answered must not change what one viewer is shown.
  const viewerSeat = Math.floor(random() * viewers.length);
  const viewerId = viewers[viewerSeat];
  const answers = hand.raise.answers.map((answer) => (answer.seat === viewerSeat ? answer : { ...answer, accept: !answer.accept }));
  /** @type {MatchState} */
  const flipped = { ...state, hand: { ...hand, raise: { ...hand.raise, answers } } };
  if (JSON.stringify(viewFor(flipped, viewerId)) !== JSON.stringify(viewFor(state, viewerId))) {
    fail(`the view of ${viewerId ?? 'a spectator'} depends on the secret answers of other players`);
  }
}

/**
 * The public part of a view, checked against the state field by field.
 * @param {MatchState} state
 * @param {View} view
 * @param {Fail} fail
 */
function inspectPublicFacts(state, view, fail) {
  const { hand } = state;
  if (hand === null || view.hand === null) return;
  /** @param {readonly number[]} seats */
  const ids = (seats) => seats.map((seat) => state.players[seat].id).join();
  /** @param {number | null} seat */
  const idOrNull = (seat) => (seat === null ? null : state.players[seat].id);
  const facts = [
    view.phase === state.phase,
    view.handNumber === state.handNumber && view.hand.number === hand.number,
    view.dealer === state.players[state.dealer].id,
    view.players.every((player, seat) => player.score === state.players[seat].score && player.removed === state.players[seat].removed),
    view.hand.vira === hand.vira && view.hand.manilha === hand.manilha,
    view.hand.value === hand.value && view.hand.nextValue === (LADDER[LADDER.indexOf(hand.value) + 1] ?? null),
    view.hand.lastRaiser === idOrNull(hand.lastRaiser),
    view.hand.turn === idOrNull(hand.turn),
    view.hand.leader === (hand.current === null ? null : idOrNull(hand.current.leader)),
    view.hand.dealtIn.join() === ids(hand.dealtIn),
    view.hand.alive.join() === ids(hand.alive),
    view.hand.ran.join() === ids(hand.dealtIn.filter((seat) => !hand.alive.includes(seat))),
    view.hand.cardCounts.join() === hand.cards.map((held) => held.length).join(),
    view.hand.rounds.length === hand.rounds.length,
    view.hand.plays.length === (hand.current === null ? 0 : hand.current.plays.length),
    (view.hand.raise === null) === (hand.raise === null),
  ];
  const wrong = facts.indexOf(false);
  if (wrong !== -1) fail(`the spectator view contradicts the state (fact #${wrong + 1})`);
}

/**
 * @param {unknown} value any JSON value
 * @param {(text: string) => boolean} wanted
 * @returns {string | null} the first string anywhere inside `value` that satisfies `wanted`
 */
function findString(value, wanted) {
  if (typeof value === 'string') return wanted(value) ? value : null;
  if (typeof value !== 'object' || value === null) return null;
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const found = findString(value[index], wanted);
      if (found !== null) return found;
    }
    return null;
  }
  const fields = /** @type {Record<string, unknown>} */ (value);
  for (const key in fields) {
    const found = findString(fields[key], wanted);
    if (found !== null) return found;
  }
  return null;
}
