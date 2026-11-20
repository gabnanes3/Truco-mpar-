// Fixture snapshots for the state gallery. Every state is produced by the REAL engine, by dealing stacked
// decks and applying real actions, then wrapped in a RoomSnapshot the way the session layer does. Nothing
// here is typed by hand as a view, so the fixtures cannot drift from the real shapes.
// Pure module: used by the gallery page (browser) and by the test (Node, to list the states).

import { fullDeck } from '../../../app/js/engine/cards.js';
import { apply, canRaise, createMatch, defaultAction, pendingPlayers, viewFor } from '../../../app/js/engine/game.js';

/** @typedef {import('../../../app/js/net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../../../app/js/net/types.js').RoomEvent} RoomEvent */
/** @typedef {import('../../../app/js/engine/types.js').MatchState} MatchState */
/** @typedef {import('../../../app/js/engine/types.js').Action} Action */
/** @typedef {import('../../../app/js/engine/types.js').EngineEvent} EngineEvent */

/**
 * @typedef {Object} GalleryState
 * @property {RoomSnapshot[]} snapshots rendered in order; the last one is what stays on screen
 * @property {(step: number) => number} pauseMs pause before the snapshot at `step` (0: back to back)
 * @property {number} [tauntMs] keeps taunt bubbles up long enough to be looked at
 */

const NOMES = ['Gabriel', 'Bruninho', 'Maria Fernanda', 'Zé Pequeno', 'Marcão', 'Duda', 'Seu Antônio'];
const NOMES_LONGOS = ['Maria Fernanda', 'João Guilherme', 'Pedro Henrique', 'WWWWWWWWWWWWWW', 'Carlos Eduardo', 'Paulo Henrique', 'Sebastião Lima'];
const LADDER = [12, 9, 6, 3, 1];
const SPECTATOR = { id: 'e1', name: 'Tia Neide' };

/** A match being driven, with every step recorded so a state can also be replayed as a sequence. */
class Mesa {
  /**
   * @param {string[]} nomes seat order; ids are p0, p1, ...
   * @param {number} dealer seat that deals the first hand
   */
  constructor(nomes, dealer) {
    /** @type {MatchState} */
    this.state = createMatch(nomes.map((name, seat) => ({ id: `p${seat}`, name })), { dealerIndex: dealer });
    /** @type {{ state: MatchState, events: EngineEvent[] }[]} */
    this.steps = [{ state: this.state, events: [] }];
  }

  /** @param {Action} action */
  act(action) {
    const result = apply(this.state, action);
    if (!result.ok) throw new Error(`Fixture action rejected (${result.error}): ${JSON.stringify(action)}`);
    this.state = result.state;
    this.steps.push({ state: result.state, events: result.events });
  }

  /** @returns {number[]} seats the next deal reaches, in deal order */
  dealOrder() {
    const { players, dealer } = this.state;
    return players.map((_, step) => (dealer + 1 + step) % players.length).filter((seat) => !players[seat].removed);
  }

  /**
   * Deals exactly these cards.
   * @param {Record<number, string>} hands seat → three cards, e.g. { 0: '4e 3p Qp' }; other seats get leftovers
   * @param {string} vira
   */
  deal(hands, vira) {
    const taken = new Set([vira, ...Object.values(hands).flatMap((cards) => cards.split(' '))]);
    const spare = fullDeck().filter((card) => !taken.has(card));
    const top = this.dealOrder().flatMap((seat) => (hands[seat] ? hands[seat].split(' ') : spare.splice(0, 3)));
    this.act({ type: 'deal', deck: [...top, vira, ...spare] });
  }

  /**
   * Compact script: "p2 4o" plays a card, "p1 truco" raises, "p3 aceita" / "p3 corre" answer, "p2 sai"
   * removes the player from the match.
   * @param {...string} lines
   */
  run(...lines) {
    for (const line of lines) {
      const [playerId, what] = line.split(' ');
      if (what === 'truco') this.act({ type: 'truco', playerId });
      else if (what === 'aceita' || what === 'corre') this.act({ type: 'respond', playerId, accept: what === 'aceita' });
      else if (what === 'sai') this.act({ type: 'remove', playerId });
      else this.act({ type: 'play', playerId, card: what });
    }
  }

  /**
   * Plays one whole hand that `seat` wins for exactly `value` points: the winner holds the three top
   * manilhas, raises are called and accepted until the hand is worth `value`, everybody else throws away.
   * @param {number} seat
   * @param {number} value a ladder value
   */
  handFor(seat, value) {
    this.deal({ [seat]: '5p 5c 5e' }, '4o');
    while (this.state.phase === 'play' || this.state.phase === 'truco') {
      const hand = this.state.hand;
      if (!hand || hand.turn === null) break;
      const turnId = this.state.players[hand.turn].id;
      if (hand.value < value && canRaise(this.state, turnId)) {
        this.act({ type: 'truco', playerId: turnId });
        for (const id of pendingPlayers(this.state)) this.act({ type: 'respond', playerId: id, accept: true });
      } else if (hand.turn === seat) {
        this.act({ type: 'play', playerId: turnId, card: hand.cards[seat][0] });
      } else {
        const fallback = defaultAction(this.state, turnId);
        if (!fallback) throw new Error('Fixture: nothing to play');
        this.act(fallback);
      }
    }
    const got = this.state.lastHand;
    if (!got || got.winner !== seat || got.value !== value) throw new Error(`Fixture: seat ${seat} should have scored ${value}`);
  }
}

/**
 * A match whose players already have these scores, about to deal a hand with the given dealer.
 * @param {string[]} nomes
 * @param {number[]} pontos score per seat (each below the target)
 * @param {number} dealer seat that deals the hand the state is about
 * @returns {Mesa}
 */
function mesaCom(nomes, pontos, dealer) {
  /** @type {[number, number][]} */
  const hands = [];
  pontos.forEach((score, seat) => {
    let left = score;
    for (const value of LADDER) {
      while (left >= value) {
        hands.push([seat, value]);
        left -= value;
      }
    }
  });
  const n = nomes.length;
  const mesa = new Mesa(nomes, (((dealer - hands.length) % n) + n) % n);
  for (const [seat, value] of hands) mesa.handFor(seat, value);
  mesa.steps = [{ state: mesa.state, events: [] }];
  return mesa;
}

/**
 * @typedef {Object} SnapshotOptions
 * @property {string} [me] id of the viewer (default p0)
 * @property {boolean} [spectator]
 * @property {number} [seq]
 * @property {RoomEvent[]} [events]
 * @property {RoomSnapshot['connection']} [connection]
 * @property {string[]} [offline] ids of disconnected players
 * @property {number} [remainingMs]
 */

/**
 * Wraps the engine view the way the session layer does.
 * @param {MatchState} state
 * @param {SnapshotOptions} [options]
 * @returns {RoomSnapshot}
 */
function snapshot(state, options = {}) {
  const me = options.me ?? 'p0';
  const pending = pendingPlayers(state);
  /** @type {RoomSnapshot['room']['members']} */
  const members = state.players.filter((player) => !player.removed).map((player) => ({
    id: player.id, name: player.name, role: 'player', connected: !(options.offline ?? []).includes(player.id), isHost: player.id === 'p0',
  }));
  if (options.spectator) members.push({ ...SPECTATOR, role: 'spectator', connected: true, isHost: false });
  return {
    seq: options.seq ?? 1,
    room: { code: 'K7M4QX', phase: state.phase === 'over' ? 'ended' : 'match', settings: { targetScore: 12 }, members },
    you: options.spectator ? { id: SPECTATOR.id, role: 'spectator', isHost: false } : { id: me, role: 'player', isHost: me === 'p0' },
    game: viewFor(state, options.spectator ? null : me),
    timer: pending.length === 0 ? null : { remainingMs: options.remainingMs ?? 11000, totalMs: 15000, players: pending },
    events: options.events ?? [],
    connection: options.connection ?? 'online',
    error: null,
    receivedAt: Date.now(),
  };
}

/** @param {Mesa} mesa @param {SnapshotOptions} [options] @returns {GalleryState} */
const still = (mesa, options) => ({ snapshots: [snapshot(mesa.state, options)], pauseMs: () => 0 });

// ------------------------------------------------------------------------------------------ scenarios

/** Seven at the table, second round: truco accepted, one ran, one dropped, the espadilha is winning. */
function seteJogadores(nomes = NOMES) {
  const mesa = mesaCom(nomes, [7, 10, 4, 11, 0, 6, 3], 1);
  mesa.deal({
    0: '4e 3p Qp', 1: '5o 6o 7o', 2: '4o 6e Je', 3: '5e 6c 7e', 4: '3o Ke 4c', 5: '6p 2o 5c', 6: '7p Qe 4p',
  }, '7c');
  mesa.run('p2 4o', 'p3 5e', 'p4 3o', 'p5 6p', 'p6 7p', 'p0 4e', 'p1 truco');
  return mesa;
}

function seteNaSegundaRodada(nomes = NOMES) {
  const mesa = seteJogadores(nomes);
  mesa.run('p2 aceita', 'p3 corre', 'p4 aceita', 'p5 aceita', 'p6 aceita', 'p0 aceita', 'p1 5o', 'p4 Ke', 'p5 2o', 'p6 Qe');
  return mesa;
}

/** Five at the table; I open with a king, Marcão takes the first round with a 2. */
function cincoJogadores() {
  const mesa = mesaCom([NOMES[0], NOMES[1], NOMES[2], NOMES[4], NOMES[5]], [3, 9, 1, 6, 4], 4);
  mesa.deal({ 0: '4c Kp 2o', 1: 'Ae 5o 6c', 2: '7e Qo Jc', 3: '2p 3e 5p', 4: 'Ko 6e 7o' }, '3p');
  return mesa;
}

function cincoNaSegundaRodada() {
  const mesa = cincoJogadores();
  mesa.run('p0 Kp', 'p1 Ae', 'p2 7e', 'p3 2p', 'p4 Ko', 'p3 3e', 'p4 6e');
  return mesa;
}

/** Three at the table, as in the raise mock: Bruninho, Duda and me. */
function tresJogadores(dealer = 2) {
  const mesa = mesaCom([NOMES[0], NOMES[1], NOMES[5]], [5, 8, 2], dealer);
  mesa.deal({ 0: 'Ac 7o 4p', 1: 'Kc 2e 5o', 2: '3c Jp 6e' }, '5e');
  return mesa;
}

/** @type {Record<string, () => GalleryState>} */
const BUILDERS = {
  '2-jogadores': () => {
    const mesa = mesaCom([NOMES[0], NOMES[5]], [4, 6], 0);
    mesa.deal({ 1: '3e 2c 6o', 0: 'Ap 7c Jo' }, 'Ko');
    mesa.run('p1 3e');
    return still(mesa);
  },
  '3-jogadores': () => {
    const mesa = tresJogadores();
    mesa.run('p0 7o', 'p1 Kc');
    return still(mesa);
  },
  '4-jogadores': () => {
    const mesa = mesaCom(NOMES.slice(0, 4), [2, 0, 5, 3], 3);
    mesa.deal({ 0: 'Jc 4o 6p', 1: '7c Qe 2o', 2: 'Kp 3e 5c', 3: 'Ae 6o 4p' }, '6e');
    mesa.run('p0 Jc', 'p1 Qe');
    return still(mesa);
  },
  '5-jogadores': () => still(cincoNaSegundaRodada()),
  '6-jogadores': () => {
    const mesa = mesaCom(NOMES.slice(0, 6), [1, 4, 0, 7, 2, 5], 0);
    mesa.deal({ 1: 'Kc 4o 6p', 2: '7c Qe 2o', 3: 'Ap 3e 5c', 4: 'Je 6o 4p', 5: '2e 5o 7p', 0: '3c Qp Jo' }, '6e');
    mesa.run('p1 Kc', 'p2 truco', 'p3 aceita', 'p4 aceita', 'p5 aceita', 'p0 aceita', 'p1 aceita', 'p2 2o', 'p3 Ap');
    return still(mesa);
  },
  '7-jogadores': () => still(seteNaSegundaRodada(), { offline: ['p2'] }),
  'minha-vez': () => {
    const mesa = new Mesa([NOMES[0], NOMES[1], NOMES[5]], 2);
    mesa.deal({ 0: 'Ko 3c 5p', 1: '4o 4e 4c', 2: '5o 5e 5c' }, 'Jo');
    return still(mesa);
  },
  'vez-de-outro': () => {
    const mesa = cincoJogadores();
    mesa.run('p0 Kp');
    return still(mesa);
  },
  'pedido-responder': () => {
    const mesa = tresJogadores(0);
    mesa.run('p1 Kc', 'p2 truco', 'p1 aceita');
    return still(mesa);
  },
  'pedido-quem-pediu': () => {
    const mesa = cincoNaSegundaRodada();
    mesa.run('p0 truco', 'p1 aceita', 'p3 corre');
    return still(mesa);
  },
  'pedido-7-jogadores': () => {
    const mesa = seteJogadores();
    mesa.run('p2 aceita', 'p3 corre');
    return still(mesa, { offline: ['p2'] });
  },
  'resultado-da-mao': () => {
    const mesa = cincoJogadores();
    mesa.run(
      'p0 Kp', 'p1 Ae', 'p2 7e', 'p3 2p', 'p4 Ko',
      'p3 truco', 'p4 aceita', 'p0 aceita', 'p1 aceita', 'p2 aceita',
      'p3 3e', 'p4 6e', 'p0 4c', 'p1 5o', 'p2 Qo',
      'p0 2o', 'p1 6c', 'p2 Jc', 'p3 5p', 'p4 7o',
    );
    return still(mesa);
  },
  'resultado-ninguem-encarou': () => {
    const mesa = mesaCom([NOMES[0], NOMES[2], NOMES[5]], [5, 8, 2], 0);
    mesa.deal({ 0: 'Ac 7o 4p', 1: 'Kc 2e 5o', 2: '3c Jp 6e' }, '5e');
    mesa.run('p1 truco', 'p2 corre', 'p0 corre');
    return still(mesa);
  },
  'manilha-na-mao': () => {
    const mesa = mesaCom([NOMES[0], NOMES[1], NOMES[5]], [2, 5, 1], 2);
    mesa.deal({ 0: '3o 3e 3p', 1: 'Kc 2e 5o', 2: 'Ac Jp 6e' }, '2o');
    return still(mesa);
  },
  'alguem-correu': () => {
    const mesa = cincoJogadores();
    mesa.run('p0 Kp', 'p1 Ae', 'p2 truco', 'p3 aceita', 'p4 aceita', 'p0 aceita', 'p1 corre');
    return still(mesa);
  },
  'alguem-caiu': () => {
    const mesa = cincoJogadores();
    mesa.run('p0 Kp', 'p1 Ae', 'p2 7e', 'p3 2p', 'p4 Ko');
    return still(mesa, { offline: ['p3'], remainingMs: 4000 });
  },
  'saiu-da-partida': () => {
    const mesa = cincoJogadores();
    mesa.run('p0 Kp', 'p1 Ae', 'p2 sai');
    return still(mesa);
  },
  espectador: () => still(seteNaSegundaRodada(), { spectator: true, offline: ['p2'] }),
  reconectando: () => still(cincoNaSegundaRodada(), { connection: 'reconnecting' }),
  provocacao: () => {
    const { state } = cincoNaSegundaRodada();
    /** @type {RoomEvent[]} */
    const events = [
      { type: 'taunt', playerId: 'p1', tauntId: 'pede-mais' },
      { type: 'taunt', playerId: 'p3', tauntId: 'medo' },
      { type: 'taunt', playerId: 'p0', tauntId: 'essa-eu-levo' },
    ];
    return { snapshots: [snapshot(state), snapshot(state, { seq: 2, events })], pauseMs: () => 0, tauntMs: 600000 };
  },
  'nomes-longos': () => still(seteNaSegundaRodada(NOMES_LONGOS), { offline: ['p2'] }),
  'antes-da-primeira-mao': () => still(new Mesa(NOMES.slice(0, 5), 1)),
  'fim-de-partida': () => {
    const mesa = mesaCom([NOMES[0], NOMES[1], NOMES[5]], [5, 11, 8], 1);
    mesa.handFor(1, 1);
    return still(mesa);
  },
  // A whole hand and the next deal, one snapshot per engine step: exercises every animation path. The table
  // gets time to collect the first round; after that the steps come faster than any animation ends.
  sequencia: () => {
    const mesa = tresJogadores();
    mesa.run(
      'p0 7o', 'p1 Kc', 'p2 Jp',
      'p1 truco', 'p2 aceita', 'p0 aceita',
      'p1 2e', 'p2 3c', 'p0 Ac',
      'p2 6e', 'p0 4p', 'p1 5o',
    );
    mesa.deal({ 0: 'Qp 2o 7e', 1: '4o 4e 4c', 2: '5o 5e 5c' }, 'Jo');
    mesa.run('p1 4o', 'p2 5o');
    const snapshots = mesa.steps.map((step, index) => snapshot(step.state, { seq: index + 1, events: step.events }));
    const firstRoundEnd = snapshots.findIndex((shot) => shot.events.some((event) => event.type === 'roundEnded'));
    return { snapshots, pauseMs: (step) => (step === firstRoundEnd + 1 ? 1700 : 120) };
  },
};

/** Every state the gallery can show. */
export const ESTADOS = Object.freeze(Object.keys(BUILDERS));

/**
 * @param {string} nome one of ESTADOS
 * @returns {GalleryState}
 */
export function montarEstado(nome) {
  const build = BUILDERS[nome];
  if (!build) throw new Error(`Estado desconhecido: ${nome}`);
  return build();
}
