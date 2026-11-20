// Provocações: only the id travels on the wire; the text is always looked up locally.

/** @typedef {{ id: string, text: string }} Taunt */

/** @type {ReadonlyArray<Readonly<Taunt>>} */
export const TAUNTS = Object.freeze([
  Object.freeze({ id: 'pede-mais', text: 'Pede mais, ladrão!' }),
  Object.freeze({ id: 'medo', text: 'Tá com medo?' }),
  Object.freeze({ id: 'essa-eu-levo', text: 'Essa eu levo.' }),
  Object.freeze({ id: 'corre', text: 'Corre, que é melhor.' }),
  Object.freeze({ id: 'blefe', text: 'Isso aí é blefe.' }),
  Object.freeze({ id: 'chora', text: 'Pode chorar.' }),
  Object.freeze({ id: 'boa', text: 'Boa!' }),
  Object.freeze({ id: 'vixe', text: 'Vixe…' }),
]);

/** Minimum time between two taunts from the same player. */
export const TAUNT_COOLDOWN_MS = 3000;

/** @param {unknown} id @returns {id is string} */
export function isTauntId(id) {
  return typeof id === 'string' && TAUNTS.some((taunt) => taunt.id === id);
}

/** @param {string} id @returns {string | null} */
export function tauntText(id) {
  return TAUNTS.find((taunt) => taunt.id === id)?.text ?? null;
}
