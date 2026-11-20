import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { TAUNTS, TAUNT_COOLDOWN_MS, isTauntId, tauntText } from '../../app/js/net/taunts.js';
import { Table } from './support.js';

/** @typedef {import('../../app/js/net/types.js').RoomEvent} RoomEvent */

/**
 * Collects the taunt events each client is shown.
 * @param {Table} table
 * @param {string[]} names
 * @returns {Record<string, RoomEvent[]>}
 */
function listen(table, names) {
  /** @type {Record<string, RoomEvent[]>} */
  const heard = {};
  for (const name of names) {
    heard[name] = [];
    table.client(name).subscribe((snapshot) => {
      heard[name].push(...snapshot.events.filter((event) => event.type === 'taunt'));
    });
  }
  return heard;
}

describe('taunts', () => {
  it('are a fixed list of 6 to 8 phrases looked up by id', () => {
    assert.ok(TAUNTS.length >= 6 && TAUNTS.length <= 8);
    assert.equal(TAUNT_COOLDOWN_MS, 3000);
    assert.equal(new Set(TAUNTS.map((taunt) => taunt.id)).size, TAUNTS.length);
    assert.equal(tauntText(TAUNTS[0].id), TAUNTS[0].text);
    assert.equal(tauntText('nope'), null);
    assert.equal(isTauntId('nope'), false);
  });

  it('from a player reach everybody at once, sender included, without touching the game', () => {
    const table = new Table({ seed: 41 });
    table.start('Bia', 'Caio');
    table.join('Duda');
    const everyone = ['Ana', 'Bia', 'Caio', 'Duda'];
    const heard = listen(table, everyone);
    const state = table.room.matchState;
    const seq = table.snap('Ana').seq;

    table.client('Bia').taunt(TAUNTS[2].id);
    table.settle();
    const expected = { type: 'taunt', playerId: 'player-bia', tauntId: TAUNTS[2].id };
    for (const name of everyone) {
      assert.deepEqual(heard[name], [expected]);
      assert.equal(table.snap(name).seq, seq + 1);
    }
    assert.equal(table.room.matchState, state);

    table.host.taunt(TAUNTS[0].id);
    table.settle();
    assert.deepEqual(heard.Caio[1], { type: 'taunt', playerId: 'player-ana', tauntId: TAUNTS[0].id });
  });

  it('are limited to one every 3 seconds per player; the extras vanish silently', () => {
    const table = new Table({ seed: 42 });
    table.start('Bia', 'Caio');
    const heard = listen(table, ['Ana']);
    table.client('Bia').taunt(TAUNTS[0].id);
    table.settle();
    const seq = table.snap('Ana').seq;

    table.clock.advance(1000);
    table.client('Bia').taunt(TAUNTS[1].id);
    table.client('Bia').taunt(TAUNTS[2].id);
    table.settle();
    assert.equal(heard.Ana.length, 1);
    assert.equal(table.snap('Ana').seq, seq);

    // Somebody else's limit is their own.
    table.client('Caio').taunt(TAUNTS[3].id);
    table.settle();
    assert.equal(heard.Ana.length, 2);

    table.clock.advance(2000);
    table.client('Bia').taunt(TAUNTS[4].id);
    table.settle();
    assert.deepEqual(heard.Ana.map((event) => event.type === 'taunt' && event.tauntId), [TAUNTS[0].id, TAUNTS[3].id, TAUNTS[4].id]);
  });

  it('are refused from spectators, in the lobby, and when the id is not on the list', () => {
    const table = new Table({ seed: 43 });
    table.join('Bia');
    const heard = listen(table, ['Ana', 'Bia']);
    table.client('Bia').taunt(TAUNTS[0].id);
    table.host.taunt(TAUNTS[0].id);
    table.settle();
    assert.deepEqual(heard, { Ana: [], Bia: [] });

    table.host.start();
    table.settle();
    const duda = table.join('Duda');
    const seq = table.snap('Ana').seq;
    duda.taunt(TAUNTS[0].id);
    table.client('Bia').taunt('free text is never sent on');
    table.client('Bia').taunt(/** @type {any} */ ({ id: TAUNTS[0].id }));
    table.guests.get('Bia')?.link?.send({ t: 'taunt', id: TAUNTS[0].id, text: 'oi' });
    table.settle();
    assert.deepEqual(heard, { Ana: [], Bia: [] });
    assert.equal(table.snap('Ana').seq, seq);
  });

  it('still work when the match is over, and are never written to storage', () => {
    const table = new Table({ seed: 44 });
    table.start('Bia', 'Caio');
    table.client('Caio').leave();
    table.client('Bia').taunt(TAUNTS[5].id);
    table.settle();
    table.client('Bia').leave();
    table.settle();
    assert.equal(table.snap('Ana').room.phase, 'ended');
    const heard = listen(table, ['Ana']);
    table.host.taunt(TAUNTS[1].id);
    table.settle();
    assert.equal(heard.Ana.length, 1);

    const stored = table.hostStorage?.getItem('trucoimpar.host') ?? '';
    assert.ok(stored.includes(table.code));
    assert.equal(stored.includes('taunt'), false);
    for (const taunt of TAUNTS) assert.equal(stored.includes(taunt.id), false);
  });
});
