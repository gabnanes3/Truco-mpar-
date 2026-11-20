// Words of the table, in Brazilian Portuguese. The system speaks in lower case; only the players shout.

/** Hand value → the word shouted to raise to it. */
const GRITOS = /** @type {Readonly<Record<number, string>>} */ ({ 3: 'TRUCO', 6: 'SEIS', 9: 'NOVE', 12: 'DOZE' });

const VALORES = /** @type {Readonly<Record<string, string>>} */ ({ Q: 'dama', J: 'valete', K: 'rei', A: 'ás' });
const NAIPES = /** @type {Readonly<Record<string, string>>} */ ({ o: 'ouros', e: 'espadas', c: 'copas', p: 'paus' });
/** Nicknames of the four manilhas, weakest to strongest. */
const APELIDOS = /** @type {Readonly<Record<string, string>>} */ ({ o: 'pica-fumo', e: 'espadilha', c: 'copas', p: 'zap' });

/**
 * @param {number | null} valor the value a raise proposes
 * @returns {string} TRUCO, SEIS, NOVE or DOZE
 */
export function grito(valor) {
  return (valor !== null && GRITOS[valor]) || 'DOZE';
}

/** @param {string} carta card id @returns {string} e.g. "dama de espadas" */
export function nomeDaCarta(carta) {
  return `${VALORES[carta[0]] ?? carta[0]} de ${NAIPES[carta[1]] ?? ''}`;
}

/** @param {string} carta card id @returns {string} nickname of that manilha */
export function apelidoDaManilha(carta) {
  return APELIDOS[carta[1]] ?? '';
}

/** @param {number} n @returns {string} "1 ponto", "3 pontos" */
export function pontos(n) {
  return n === 1 ? '1 ponto' : `${n} pontos`;
}

/**
 * @param {readonly string[]} nomes
 * @returns {string} "Ana", "Ana e Bia", "Ana, Bia e Caio"
 */
export function lista(nomes) {
  if (nomes.length <= 1) return nomes.join('');
  return `${nomes.slice(0, -1).join(', ')} e ${nomes[nomes.length - 1]}`;
}

/** The secrecy rule of a raise, said the same way everywhere. */
export const SEGREDO = 'As respostas ficam em segredo até todo mundo responder.';
