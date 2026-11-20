// Turns a RoomSnapshot into what the table shows. Pure: no DOM, no clock. Every rule comes from the engine
// view; the only thing derived here is which card is leading the round on the table.

import { isManilha, strength } from '../engine/cards.js';
import { grito, lista, nomeDaCarta, pontos } from './textos.js';

/** @typedef {import('../net/types.js').RoomSnapshot} RoomSnapshot */
/** @typedef {import('../engine/types.js').View} View */
/** @typedef {import('../engine/types.js').ViewHand} ViewHand */
/** @typedef {import('../engine/types.js').ViewPlay} ViewPlay */
/** @typedef {import('./icones.js').NomeIcone} NomeIcone */

/**
 * One state tag inside a plate. `short` always fits; `long` is used where the plate is wide. For kind
 * 'tempo' the plate appends the seconds left to both.
 * @typedef {Object} TagModel
 * @property {'tempo' | 'pediu' | 'respondeu' | 'correu' | 'saiu' | 'caiu' | 'levou' | 'rodada' | 'aumento' | 'voce'} kind
 * @property {string} short
 * @property {string} long
 * @property {'anil' | 'giz' | 'gema'} tone
 * @property {NomeIcone | null} icon
 */
/**
 * @typedef {Object} TableCardModel
 * @property {string} id
 * @property {boolean} manilha
 * @property {boolean} voided the player left the hand: the card no longer counts
 * @property {'ganhando' | 'levou' | null} mark the chalk ring: leading the open round, or won the closed one
 */
/**
 * @typedef {Object} SeatModel
 * @property {string} id
 * @property {string} name untrusted text
 * @property {number} score
 * @property {'ativo' | 'correu' | 'saiu'} state
 * @property {boolean} disconnected
 * @property {boolean} acting must act now: the yolk ring
 * @property {boolean} dealer
 * @property {TagModel | null} tag
 * @property {TableCardModel | null} card the card in this player's slot
 * @property {boolean} waiting still has to play in the open round: the empty slot is outlined
 */
/** @typedef {{ state: 'ganha' | 'melou' | 'agora' | 'futura', who: string }} RoundCell */
/**
 * @typedef {Object} RaisePromptModel
 * @property {'responder' | 'esperar'} mode
 * @property {string} caller name, or "Você"
 * @property {string} word TRUCO, SEIS, NOVE or DOZE
 * @property {number} from
 * @property {number} to
 * @property {string} text what is happening, for whoever is looking at the prompt
 */
/**
 * @typedef {Object} ResultModel
 * @property {string} title
 * @property {string} detail
 * @property {number} value points scored (the winner's total at the end of a match)
 * @property {string} capText what the cap shows: "+3" for a hand, the final score for a match
 * @property {string} unit label on the cap
 * @property {boolean} mine the viewer won
 * @property {string} key changes when a different result is shown
 */
/** @typedef {{ tone: 'alerta' | 'calmo', icon: NomeIcone, text: string }} BannerModel */
/** @typedef {{ id: string, name: string, score: number, note: string, leader: boolean }} ScoreRow */
/** @typedef {{ parts: { text: string, strong: boolean }[], now: boolean }} LogLine */
/**
 * @typedef {Object} TableModel
 * @property {string} matchKey changes when the seats change (a different match)
 * @property {boolean} spectator
 * @property {boolean} online
 * @property {string} code
 * @property {number} handNumber
 * @property {number} target
 * @property {RoundCell[]} rounds always three
 * @property {SeatModel} me the seat at the bottom (the first seat, for spectators)
 * @property {SeatModel[]} others clockwise from the bottom seat
 * @property {number} value hand value
 * @property {{ word: string, name: string } | null} raiser who made the last accepted raise
 * @property {string | null} vira
 * @property {string | null} manilha
 * @property {'minha' | 'outros' | 'parado'} turnMode
 * @property {string} turnLabel small label over the call ("vez de"), or empty
 * @property {string} turnCall
 * @property {boolean} myTurnToPlay
 * @property {{ id: string, manilha: boolean }[]} cards the viewer's hand
 * @property {boolean} playable
 * @property {string} emptyHand shown in place of the cards when there are none
 * @property {{ word: string, enabled: boolean, note: string } | null} raiseButton null for spectators
 * @property {string} hint
 * @property {RaisePromptModel | null} raise
 * @property {ResultModel | null} result
 * @property {BannerModel | null} banner
 * @property {boolean} canTaunt
 * @property {ScoreRow[]} scores
 * @property {LogLine[]} log
 */

/** @type {(kind: TagModel['kind'], short: string, extra?: Partial<TagModel>) => TagModel} */
const tag = (kind, short, extra = {}) => ({ kind, short, long: short, tone: 'anil', icon: null, ...extra });

/**
 * @param {RoomSnapshot} snapshot
 * @returns {TableModel | null} null while there is no match to show
 */
export function tableModel(snapshot) {
  const { game, room, you } = snapshot;
  if (game === null || game.players.length < 2) return null;

  const players = game.players;
  const hand = game.hand;
  const live = hand !== null && (game.phase === 'play' || game.phase === 'truco');
  const raise = live ? hand.raise : null;
  const myIndex = players.findIndex((player) => player.id === you.id);
  const spectator = you.role !== 'player' || myIndex === -1;
  const meId = spectator ? null : you.id;
  const online = snapshot.connection === 'online';
  const target = room.settings.targetScore;
  const connected = new Map(room.members.map((member) => [member.id, member.connected]));
  /** @param {string | null} id */
  const nameOf = (id) => players.find((player) => player.id === id)?.name ?? '';
  const pending = live ? (raise ? raise.waiting : hand.turn === null ? [] : [hand.turn]) : [];
  const onTable = hand === null ? null : roundOnTable(hand, live);
  const handWinner = !live && hand !== null && game.lastHand?.hand === hand.number ? game.lastHand : null;
  // The dealer of the hand on screen: the last one dealt in. Before the first deal, whoever is about to deal.
  const dealerId = hand === null ? game.dealer : hand.dealtIn[hand.dealtIn.length - 1] ?? null;

  /**
   * @param {View['players'][number]} player
   * @returns {SeatModel}
   */
  const seat = (player) => {
    const { id } = player;
    const mine = id === meId;
    const ran = hand !== null && hand.ran.includes(id);
    const play = onTable?.plays.find((entry) => entry.playerId === id);
    return {
      id,
      name: player.name,
      score: player.score,
      state: player.removed ? 'saiu' : ran ? 'correu' : 'ativo',
      disconnected: !player.removed && connected.get(id) === false,
      acting: !mine && pending.includes(id),
      dealer: !player.removed && dealerId === id,
      tag: seatTag(player, mine),
      card: play && hand ? {
        id: play.card,
        manilha: isManilha(play.card, hand.manilha),
        voided: play.voided,
        mark: onTable?.marked === id ? (onTable.closed ? 'levou' : 'ganhando') : null,
      } : null,
      waiting: live && hand.alive.includes(id) && !play,
    };
  };

  /**
   * @param {View['players'][number]} player
   * @param {boolean} mine
   * @returns {TagModel | null}
   */
  const seatTag = (player, mine) => {
    const { id } = player;
    if (player.removed) return tag('saiu', 'saiu');
    if (hand !== null && hand.ran.includes(id)) return tag('correu', 'correu');
    if (raise !== null && !mine) {
      const word = grito(raise.value).toLowerCase();
      if (id === raise.caller) return tag('pediu', 'pediu', { long: `pediu ${word}`, tone: 'gema' });
      if (raise.answered.includes(id)) return tag('respondeu', 'ok', { long: 'respondeu', tone: 'giz', icon: 'cadeado' });
      if (raise.waiting.includes(id)) return tag('tempo', '', { long: 'responde', tone: 'gema' });
    }
    if (live && raise === null && hand.turn === id && !mine) return tag('tempo', '', { long: 'joga', tone: 'gema' });
    if (connected.get(id) === false) return tag('caiu', 'caiu', { icon: 'sem-sinal' });
    if (handWinner !== null && handWinner.winner === id) {
      return tag('levou', 'levou', { long: `levou +${handWinner.value}`, tone: 'giz', icon: 'check' });
    }
    const won = hand === null ? -1 : hand.rounds.findIndex((round) => round.winner === id);
    if (won !== -1) return tag('rodada', `${won + 1}ª`, { tone: 'giz', icon: 'check' });
    if (hand !== null && hand.lastRaiser === id && hand.value > 1) {
      const word = grito(hand.value).toLowerCase();
      return tag('aumento', word, { long: `pediu ${word}`, tone: 'giz' });
    }
    return mine ? tag('voce', 'você') : null;
  };

  const anchor = spectator ? 0 : myIndex;
  const ordered = players.map((_, step) => players[(anchor + step) % players.length]);
  const me = seat(ordered[0]);
  const iAmOut = meId !== null && me.state !== 'ativo';
  const myTurnToPlay = live && raise === null && hand.turn === meId && meId !== null;

  /** @type {TableModel['turnMode']} */
  let turnMode = 'parado';
  let turnLabel = '';
  let turnCall = game.phase === 'over' ? 'Fim de partida' : hand === null ? 'Embaralhando…' : 'Próxima mão já vem';
  if (live && raise !== null) {
    turnMode = raise.mustAnswer ? 'minha' : 'outros';
    turnCall = raise.mustAnswer ? 'Responda!' : 'Esperando a mesa';
  } else if (live && hand.turn !== null) {
    turnMode = myTurnToPlay ? 'minha' : 'outros';
    turnLabel = myTurnToPlay ? '' : 'vez de';
    turnCall = myTurnToPlay ? 'Sua vez!' : nameOf(hand.turn);
  }

  return {
    matchKey: players.map((player) => player.id).join('|'),
    spectator,
    online,
    code: room.code,
    handNumber: hand?.number ?? game.handNumber,
    target,
    rounds: roundCells(hand, live, nameOf),
    me,
    others: ordered.slice(1).map(seat),
    value: hand?.value ?? 1,
    raiser: hand !== null && hand.lastRaiser !== null && hand.value > 1
      ? { word: grito(hand.value).toLowerCase(), name: nameOf(hand.lastRaiser) } : null,
    vira: hand?.vira ?? null,
    manilha: hand?.manilha ?? null,
    turnMode,
    turnLabel,
    turnCall,
    myTurnToPlay,
    cards: hand === null ? [] : hand.myCards.map((id) => ({ id, manilha: isManilha(id, hand.manilha) })),
    playable: myTurnToPlay && online,
    emptyHand: live && iAmOut ? 'Você correu. Na próxima mão você volta.' : '',
    raiseButton: spectator ? null : raiseButton(),
    hint: hint(),
    raise: raise === null || hand === null ? null : raisePrompt(hand, raise),
    result: result(),
    banner: banner(snapshot.connection),
    canTaunt: !spectator && online,
    scores: scoreRows(),
    log: hand === null ? [] : handLog(hand),
  };

  /** @returns {NonNullable<TableModel['raiseButton']>} */
  function raiseButton() {
    const next = hand?.nextValue ?? null;
    const word = hand === null ? grito(3) : grito(next);
    if (live && hand.canRaise && next !== null) return { word, enabled: online, note: `vale ${next}` };
    let note = 'na sua vez';
    if (!live) note = 'aguarde';
    else if (next === null) note = 'no teto';
    else if (iAmOut) note = 'você correu';
    else if (raise !== null) note = 'pedido na mesa';
    else if (hand.lastRaiser === meId) note = 'já é seu';
    else if (me.score === target - 1) note = 'falta 1 ponto';
    return { word, enabled: false, note };
  }

  /** @returns {string} */
  function hint() {
    if (!online) return 'Sem conexão. Suas cartas estão guardadas.';
    if (game?.phase === 'over') return 'Fim de partida.';
    if (!live) return hand === null ? 'Embaralhando as cartas…' : 'Embaralhando a próxima mão…';
    if (raise !== null) {
      const names = raise.answered.filter((id) => id !== meId).map(nameOf);
      if (names.length === 0) return raise.myAnswer === null ? 'Ninguém respondeu ainda.' : 'Só você respondeu até agora.';
      if (names.length > 2) return `${names.length} já responderam. Faltam ${raise.waiting.length}.`;
      return `${lista(names)} já ${names.length === 1 ? 'respondeu' : 'responderam'}.`;
    }
    if (spectator) return '';
    if (iAmOut) return 'Você está fora desta mão.';
    return myTurnToPlay ? 'Toque na carta pra jogar' : 'Aguarde sua vez';
  }

  /**
   * @param {ViewHand} current
   * @param {NonNullable<ViewHand['raise']>} pendingRaise
   * @returns {RaisePromptModel}
   */
  function raisePrompt(current, pendingRaise) {
    const mine = pendingRaise.caller === meId;
    let text = 'Esperando a mesa responder.';
    if (pendingRaise.mustAnswer) text = `A mão sobe de ${current.value} pra ${pendingRaise.value}. Vai encarar?`;
    else if (mine) text = `Você pediu pra mão valer ${pendingRaise.value}. Esperando a mesa.`;
    else if (pendingRaise.myAnswer === true) text = 'Você aceitou. Esperando o resto da mesa.';
    else if (pendingRaise.myAnswer === false) text = 'Você correu. Esperando o resto da mesa.';
    else if (iAmOut) text = 'Você está fora desta mão. A mesa decide.';
    return {
      mode: pendingRaise.mustAnswer ? 'responder' : 'esperar',
      caller: mine ? 'Você' : nameOf(pendingRaise.caller),
      word: grito(pendingRaise.value),
      from: current.value,
      to: pendingRaise.value,
      text,
    };
  }

  /** @returns {ResultModel | null} */
  function result() {
    if (game === null) return null;
    if (game.phase === 'over' && game.result !== null) {
      const winner = players.find((player) => player.id === game.result?.winner);
      const mine = winner?.id === meId;
      return {
        title: mine ? 'Você levou a partida!' : `${winner?.name ?? ''} levou a partida!`,
        detail: game.result.reason === 'abandon' ? 'Sobrou sozinho na mesa.' : `Chegou a ${pontos(winner?.score ?? 0)}.`,
        value: winner?.score ?? 0,
        capText: String(winner?.score ?? 0),
        unit: 'pontos',
        mine,
        key: `fim:${winner?.id ?? ''}`,
      };
    }
    if (handWinner === null) return null;
    const { winner, value, reason } = handWinner;
    const mine = winner !== null && winner === meId;
    const gain = `+${pontos(value)}`;
    let detail = `Ganhou nas rodadas: ${gain}.`;
    if (reason === 'allRan') detail = `Ninguém encarou o pedido: ${gain}.`;
    else if (reason === 'lastStanding') detail = `Todo mundo correu: ${gain}.`;
    else if (reason === 'allTied') detail = 'Três rodadas empatadas. Ninguém pontua.';
    return {
      title: winner === null ? 'Melou: ninguém levou.' : mine ? 'Você levou a mão!' : `${nameOf(winner)} levou a mão.`,
      detail,
      value,
      capText: value === 0 ? '0' : `+${value}`,
      unit: value === 1 ? 'ponto' : 'pontos',
      mine,
      key: `mao:${handWinner.hand}`,
    };
  }

  /** @returns {ScoreRow[]} */
  function scoreRows() {
    const best = Math.max(...players.map((player) => player.score));
    return [...players].sort((a, b) => b.score - a.score).map((player) => {
      let note = '';
      if (player.removed) note = 'saiu';
      else if (hand !== null && hand.ran.includes(player.id)) note = 'correu';
      else if (connected.get(player.id) === false) note = 'caiu';
      else if (player.id === meId) note = 'você';
      else if (player.id === dealerId) note = 'deu';
      return { id: player.id, name: player.name, score: player.score, note, leader: best > 0 && player.score === best };
    });
  }

  /**
   * The hand so far, told in order. Derived from the view alone, so it is always right after a reconnection.
   * @param {ViewHand} current
   * @returns {LogLine[]}
   */
  function handLog(current) {
    /** @type {LogLine[]} */
    const lines = [];
    /** @param {...(string | [string])} parts a one-item array marks a strong part */
    const say = (...parts) => {
      lines.push({ parts: parts.map((part) => (typeof part === 'string' ? { text: part, strong: false } : { text: part[0], strong: true })), now: false });
    };
    say([nameOf(dealerId)], ` deu as cartas. Vira ${nomeDaCarta(current.vira)}: a manilha é `, [current.manilha], '.');
    if (current.lastRaiser !== null && current.value > 1) {
      say([nameOf(current.lastRaiser)], ` pediu ${grito(current.value).toLowerCase()}! A mesa topou: vale ${current.value}.`);
    }
    for (const id of current.ran) {
      say([nameOf(id)], players.find((player) => player.id === id)?.removed ? ' saiu da partida.' : ' correu.');
    }
    current.rounds.forEach((round, index) => {
      if (round.winner === null) say(`Melou: a ${index + 1}ª rodada empatou.`);
      else say([nameOf(round.winner)], ` levou a ${index + 1}ª rodada.`);
    });
    for (const player of players) {
      if (!player.removed && connected.get(player.id) === false) say([player.name], ' caiu. A cadeira fica guardada.');
    }
    if (current.plays.length > 0) {
      const last = current.plays[current.plays.length - 1];
      say(`${current.rounds.length + 1}ª rodada: `, [nameOf(last.playerId)], ` jogou ${nomeDaCarta(last.card)}.`);
    }
    if (raise !== null) say([nameOf(raise.caller)], ` pediu ${grito(raise.value).toLowerCase()}! A mesa está respondendo.`);
    else if (live && current.turn !== null) {
      if (current.turn === meId) say(['Sua vez.']);
      else say('Vez de ', [nameOf(current.turn)], '.');
    } else if (handWinner !== null) {
      if (handWinner.winner === null) say('Ninguém levou a mão.');
      else say([nameOf(handWinner.winner)], ` levou a mão: +${pontos(handWinner.value)}.`);
    }
    lines[lines.length - 1].now = true;
    return lines;
  }
}

/**
 * The cards to show in the seats' slots: the open round, or, once the hand is over, the round that
 * decided it (so everybody can see what won).
 * @param {ViewHand} hand
 * @param {boolean} live
 * @returns {{ plays: ViewPlay[], marked: string | null, closed: boolean }}
 */
function roundOnTable(hand, live) {
  if (live || hand.plays.length > 0) return { plays: hand.plays, marked: live ? leading(hand) : null, closed: false };
  const last = hand.rounds[hand.rounds.length - 1];
  return last ? { plays: last.plays, marked: last.winner, closed: true } : { plays: [], marked: null, closed: true };
}

/**
 * @param {ViewHand} hand
 * @returns {string | null} who holds the single strongest counting card of the open round
 */
function leading(hand) {
  let best = -1;
  /** @type {string | null} */
  let leader = null;
  for (const play of hand.plays) {
    if (play.voided) continue;
    const power = strength(play.card, hand.manilha);
    if (power > best) {
      best = power;
      leader = play.playerId;
    } else if (power === best) {
      leader = null;
    }
  }
  return leader;
}

/**
 * @param {ViewHand | null} hand
 * @param {boolean} live
 * @param {(id: string | null) => string} nameOf
 * @returns {RoundCell[]}
 */
function roundCells(hand, live, nameOf) {
  return [0, 1, 2].map((index) => {
    const round = hand?.rounds[index];
    if (round) return round.winner === null ? { state: 'melou', who: 'melou' } : { state: 'ganha', who: nameOf(round.winner) };
    return { state: live && hand !== null && index === hand.rounds.length ? 'agora' : 'futura', who: '' };
  });
}

/**
 * @param {RoomSnapshot['connection']} connection
 * @returns {BannerModel | null}
 */
function banner(connection) {
  if (connection === 'reconnecting') return { tone: 'alerta', icon: 'sem-sinal', text: 'Caiu a conexão. Segura aí que sua cadeira tá guardada.' };
  if (connection === 'host-away') return { tone: 'alerta', icon: 'sem-sinal', text: 'Quem abriu a mesa sumiu. Esperando voltar…' };
  if (connection === 'connecting') return { tone: 'calmo', icon: 'sem-sinal', text: 'Conectando com a mesa…' };
  if (connection === 'closed') return { tone: 'alerta', icon: 'sem-sinal', text: 'A conexão com a mesa acabou.' };
  return null;
}

/**
 * Short public news for the announcement strip, from the events of a snapshot.
 * @param {RoomSnapshot} snapshot
 * @returns {string[]}
 */
export function eventNews(snapshot) {
  const players = snapshot.game?.players ?? [];
  /** @param {string | null} id */
  const nameOf = (id) => players.find((player) => player.id === id)?.name ?? '';
  /** @type {string[]} */
  const news = [];
  for (const event of snapshot.events) {
    if (event.type === 'trucoCalled') {
      news.push(`${nameOf(event.playerId)} pediu ${grito(event.value).toLowerCase()}!`);
    } else if (event.type === 'trucoResolved') {
      const ran = event.ran.map(nameOf);
      if (event.accepted.length === 0) news.push(`Ninguém encarou. ${nameOf(event.caller)} leva a mão.`);
      else if (ran.length === 0) news.push(`A mesa topou: vale ${event.value}.`);
      else news.push(`A mesa topou: vale ${event.value}. ${lista(ran)} ${ran.length === 1 ? 'correu' : 'correram'}.`);
    } else if (event.type === 'trucoCancelled') {
      news.push(`${nameOf(event.caller)} saiu: o pedido não valeu.`);
    } else if (event.type === 'roundEnded') {
      news.push(event.winner === null ? `Melou: a ${event.round + 1}ª rodada empatou.` : `${nameOf(event.winner)} levou a ${event.round + 1}ª rodada.`);
    } else if (event.type === 'playerRemoved') {
      news.push(`${nameOf(event.playerId)} saiu da partida.`);
    }
  }
  return news;
}
