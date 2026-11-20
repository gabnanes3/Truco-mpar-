// Where each opponent sits, for 1 to 6 opponents. Seats go clockwise from the viewer, who is always at
// the bottom: the next player to act after "me" is on my left.
//
// Two regimes share the same DOM (see mesa.css):
// - phone: plates hug the table's left / right edge in rows placed at `py` (% of the table height), with
//   the card inboard; an odd opponent sits at the top centre; two opponents take the top corners;
// - desktop: the table is round and each seat is centred at (`dx`, `dy`), in % of the table box.

/**
 * @typedef {'esq' | 'dir' | 'topo' | 'canto-esq' | 'canto-dir'} Lado
 * @typedef {'esq' | 'dir' | 'topo'} LadoDesktop
 */
/**
 * @typedef {Object} SeatSpot
 * @property {Lado} lado phone side
 * @property {number} py phone: top of the row, in % of the table height (ignored at the top and corners)
 * @property {LadoDesktop} dlado desktop: where the plate is relative to its card
 * @property {number} dx desktop: seat centre, % of the table width
 * @property {number} dy desktop: seat centre, % of the table height
 */

/** @type {(py: number, dx: number, dy: number) => SeatSpot} */
const esq = (py, dx, dy) => ({ lado: 'esq', py, dlado: 'esq', dx, dy });
/** @type {(py: number, dx: number, dy: number) => SeatSpot} */
const dir = (py, dx, dy) => ({ lado: 'dir', py, dlado: 'dir', dx: 100 - dx, dy });
/** @type {SeatSpot} */
const TOPO = { lado: 'topo', py: 0, dlado: 'topo', dx: 50, dy: 15.6 };

/** Opponent count → spots in seat order. @type {Readonly<Record<number, readonly SeatSpot[]>>} */
const SPOTS = {
  1: [TOPO],
  2: [
    { lado: 'canto-esq', py: 0, dlado: 'topo', dx: 27, dy: 17 },
    { lado: 'canto-dir', py: 0, dlado: 'topo', dx: 73, dy: 17 },
  ],
  3: [esq(38, 15, 44), TOPO, dir(38, 15, 44)],
  4: [
    esq(53, 15.5, 58), { ...esq(17, 31, 15.6), dlado: 'topo' },
    { ...dir(17, 31, 15.6), dlado: 'topo' }, dir(53, 15.5, 58),
  ],
  5: [esq(57, 17.6, 73.5), esq(27, 15, 43), TOPO, dir(27, 15, 43), dir(57, 17.6, 73.5)],
  6: [
    esq(61, 19.1, 71.6), esq(33, 15, 43), { ...esq(5, 33.4, 15.6), dlado: 'topo' },
    { ...dir(5, 33.4, 15.6), dlado: 'topo' }, dir(33, 15, 43), dir(61, 19.1, 71.6),
  ],
};

/**
 * @param {number} opponents 1 to 6
 * @returns {readonly SeatSpot[]} one spot per opponent, in seat order after the viewer
 */
export function seatSpots(opponents) {
  return SPOTS[opponents] ?? [];
}
