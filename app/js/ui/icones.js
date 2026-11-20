// Drawings of the identity: suits, interface icons, the bottle cap, the chalk ring and the cut-corner sign.
// Everything here is constant markup of this code base, on a 24-unit grid unless noted.

import { svg } from './dom.js';

/** Suit letter → path. Filled shapes. */
const NAIPES = {
  c: '<path d="M12 21.4C5.1 16 2.3 12.3 2.3 8.4 2.3 5.3 4.7 3 7.6 3c1.8 0 3.5.9 4.4 2.6C12.9 3.9 14.6 3 16.4 3c2.9 0 5.3 2.3 5.3 5.4 0 3.9-2.8 7.6-9.7 13z"/>',
  o: '<path fill-rule="evenodd" d="M12 1.4c1.6 4.7 4.1 8 8.4 10.6-4.3 2.6-6.8 5.9-8.4 10.6-1.6-4.7-4.1-8-8.4-10.6C7.9 9.4 10.4 6.1 12 1.4zm0 7.7L9.7 12l2.3 2.9 2.3-2.9z"/>',
  e: '<path d="M12 1.6c-1.6 3.3-4.4 5.4-6.8 7.7-1.7 1.6-2.9 3.2-2.9 5.2 0 2.6 2 4.5 4.6 4.5 1.5 0 2.8-.6 3.8-1.7-.2 2-.9 3.7-2.4 5h7.4c-1.5-1.3-2.2-3-2.4-5 1 1.1 2.3 1.7 3.8 1.7 2.6 0 4.6-1.9 4.6-4.5 0-2-1.2-3.600-2.9-5.200-2.400-2.300-5.200-4.400-6.800-7.700z"/>',
  p: '<path d="M12 1.9a4.6 4.6 0 0 1 3.5 7.6 4.6 4.6 0 1 1-2.3 7.5c.2 2 .9 3.8 2.5 5.300H8.300c1.600-1.500 2.300-3.300 2.500-5.300a4.600 4.600 0 1 1-2.300-7.500A4.600 4.600 0 0 1 12 1.900z"/>',
};

/** Stroke icons (class "ico"); solid parts carry their own fill. */
const ICONES = {
  check: '<path d="M4.5 12.8l4.700 4.700L19.500 6.800"/>',
  'sem-sinal': '<path d="M2.5 9a14 14 0 0 1 19 0M6 13a9 9 0 0 1 12 0M9.5 16.800a4.200 4.200 0 0 1 5 0M4 3.500l16 17"/><circle cx="12" cy="20" r="1.500" fill="currentColor" stroke="none"/>',
  baralho: '<rect x="9" y="2.500" width="11" height="15.500" rx="2" transform="rotate(10 14.500 10)"/><rect x="4" y="5.500" width="11" height="15.500" rx="2" fill="currentColor"/>',
  cadeado: '<rect x="4.500" y="10.500" width="15" height="10.500" rx="2.300" fill="currentColor" stroke="none"/><path d="M8 10.500V7.800a4 4 0 0 1 8 0v2.700"/>',
  seta: '<path d="M4 12h15M13 6l6 6-6 6"/>',
  sair: '<path d="M10 4H6.500a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2H10M15 7.500l4.500 4.500-4.500 4.500M19.500 12H9.500"/>',
  som: '<path d="M4 9.500v5h3.500l5 4v-13l-5 4z" fill="currentColor"/><path d="M16 9a4.200 4.200 0 0 1 0 6M18.700 6.300a8 8 0 0 1 0 11.400"/>',
  mudo: '<path d="M4 9.500v5h3.500l5 4v-13l-5 4z" fill="currentColor"/><path d="M16.500 9.500l5 5M21.500 9.500l-5 5"/>',
  balao: '<path d="M5.500 4.500h13a2.500 2.500 0 0 1 2.500 2.500v7a2.500 2.500 0 0 1-2.500 2.500H12l-4.500 4v-4h-2A2.500 2.500 0 0 1 3 14V7a2.500 2.500 0 0 1 2.500-2.500z"/><path d="M8 9.300h8M8 12.500h5"/>',
  olho: '<path d="M2 12c2.600-4.700 6-7 10-7s7.400 2.300 10 7c-2.600 4.700-6 7-10 7s-7.400-2.300-10-7z"/><circle cx="12" cy="12" r="3.200" fill="currentColor" stroke="none"/>',
};

const ESTRELA = '<path d="M12 1.500c.9 6.300 4.200 9.600 10.500 10.500-6.300.9-9.600 4.200-10.500 10.500C11.100 16.200 7.800 12.900 1.500 12 7.800 11.100 11.100 7.800 12 1.500z"/>';

/** A real crown cap has 21 teeth: an odd number, like the game. */
const TAMPINHA = '<g transform="translate(52 52)"><path d="M0 -46.5A8.2 8.2 0 0 1 13.71 -44.43A8.2 8.2 0 0 1 26.19 -38.42A8.2 8.2 0 0 1 36.36 -28.99A8.2 8.2 0 0 1 43.29 -16.99A8.2 8.2 0 0 1 46.37 -3.47A8.2 8.2 0 0 1 45.33 10.35A8.2 8.2 0 0 1 40.27 23.25A8.2 8.2 0 0 1 31.63 34.09A8.2 8.2 0 0 1 20.18 41.9A8.2 8.2 0 0 1 6.93 45.98A8.2 8.2 0 0 1 -6.93 45.98A8.2 8.2 0 0 1 -20.18 41.9A8.2 8.2 0 0 1 -31.63 34.09A8.2 8.2 0 0 1 -40.27 23.25A8.2 8.2 0 0 1 -45.33 10.35A8.2 8.2 0 0 1 -46.37 -3.47A8.2 8.2 0 0 1 -43.29 -16.99A8.2 8.2 0 0 1 -36.36 -28.99A8.2 8.2 0 0 1 -26.19 -38.42A8.2 8.2 0 0 1 -13.71 -44.43A8.2 8.2 0 0 1 0 -46.5Z"/><circle r="40.5"/></g>';

const GIZ_ANEL = '<path d="M14 7C30 1.5 52 2 59.5 12c6.500 12 4.500 50-.5 63-6 11-42 12-51 2C.5 66 1.500 24 7.500 12 11.500 5.500 25 2.500 42 4.500"/><path d="M10.500 9.500C5.500 26 3.500 60 9.500 74.500" opacity=".45" stroke-width="1.2"/>';

/** @typedef {keyof typeof ICONES} NomeIcone */

/**
 * @param {NomeIcone} nome
 * @returns {SVGSVGElement}
 */
export function icone(nome) {
  return svg('0 0 24 24', ICONES[nome], 'ico');
}

/**
 * @param {string} letra suit letter: o, e, c, p
 * @param {string} [className]
 * @returns {SVGSVGElement}
 */
export function naipe(letra, className) {
  return svg('0 0 24 24', NAIPES[/** @type {keyof typeof NAIPES} */ (letra)] ?? '', className);
}

/** @returns {SVGSVGElement} the four-point star of the manilha seal */
export function estrela() {
  return svg('0 0 24 24', ESTRELA);
}

/** @returns {SVGSVGElement} */
export function tampinha() {
  return svg('0 0 104 104', TAMPINHA, 'vale__tampa');
}

/** @returns {SVGSVGElement} the hand-drawn chalk ring around the leading card */
export function gizAnel() {
  return svg('0 0 66 88', GIZ_ANEL, 'giz-anel');
}

/**
 * Outline of an enamel sign with concave (cut) corners.
 * @param {number} w
 * @param {number} h
 * @param {number} r corner radius
 * @param {number} [inset] distance from the edge, for the inner hairline
 * @returns {string} SVG path data
 */
function contornoChapa(w, h, r, inset = 0) {
  const a = inset;
  const b = inset + r;
  return `M${b} ${a}H${w - b}A${r} ${r} 0 0 0 ${w - a} ${b}V${h - b}A${r} ${r} 0 0 0 ${w - b} ${h - a}H${b}A${r} ${r} 0 0 0 ${a} ${h - b}V${b}A${r} ${r} 0 0 0 ${b} ${a}Z`;
}

/**
 * The cut-corner sign used by every raise call: thickness, plate and inner hairline.
 * @param {number} w
 * @param {number} h
 * @param {number} r
 * @param {string} className
 * @returns {SVGSVGElement}
 */
export function chapa(w, h, r, className) {
  const borda = contornoChapa(w, h, r);
  const drop = Math.round(h * 0.045);
  return svg(`0 0 ${w} ${h}`, `<path class="espessura" d="${borda}" transform="translate(0 ${drop})"/>`
    + `<path class="chapa" d="${borda}"/><path class="fio" d="${contornoChapa(w, h, r + 2, 4)}"/>`, className);
}
