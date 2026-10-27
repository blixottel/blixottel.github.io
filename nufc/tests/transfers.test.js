// Transfer history sorting and squad-at-the-time (js/transfers.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSite } = require('./helpers/site');

const site = loadSite({ files: ['teams', 'data', 'stats', 'transfers'] });
const ms = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const row = (name, date, over = {}) => ({
  player: { name }, ms: date ? ms(date) : null, squad: 'senior', club: '', t: { label: 'Joined' }, ...over,
});
const sorted = (rows, key, desc) => {
  site.run(`trState.sortKey = ${JSON.stringify(key)}; trState.sortDesc = ${desc}`);
  return rows.slice().sort((a, b) => site.compareRows(a, b)).map(r => r.player.name + (r.tag || ''));
};

test.describe('compareRows (transfer table sorting)', () => {
  const a = row('Ann', '2025-08-01', { club: 'Leeds', squad: 'u21' });
  const b = row('Bea', '2026-01-15', { club: 'Arsenal', squad: 'senior' });
  const c = row('Cal', null,         { club: '',        squad: null });
  const d = row('Dee', '2024-06-30', { club: 'Brighton', squad: 'u18' });
  const all = [a, b, c, d];

  test('date: newest first or oldest first, and unknown dates always last', () => {
    assert.deepEqual(sorted(all, 'date', true), ['Bea', 'Ann', 'Dee', 'Cal']);
    assert.deepEqual(sorted(all, 'date', false), ['Dee', 'Ann', 'Bea', 'Cal']);
  });
  test('same date falls back to name', () => {
    const x = row('Zed', '2025-01-01'), y = row('Abe', '2025-01-01');
    assert.deepEqual(sorted([x, y], 'date', true), ['Abe', 'Zed']);
  });
  test('player: A-Z or Z-A', () => {
    assert.deepEqual(sorted(all, 'player', false), ['Ann', 'Bea', 'Cal', 'Dee']);
    assert.deepEqual(sorted(all, 'player', true), ['Dee', 'Cal', 'Bea', 'Ann']);
  });
  test('club: alphabetical, and a blank club sinks to the bottom in BOTH directions', () => {
    assert.deepEqual(sorted(all, 'club', false), ['Bea', 'Dee', 'Ann', 'Cal']);
    assert.deepEqual(sorted(all, 'club', true), ['Ann', 'Dee', 'Bea', 'Cal']);
  });
  test('squad: in squad order (senior, u21, u19, u18), no squad last in both directions', () => {
    assert.deepEqual(sorted(all, 'squad', false), ['Bea', 'Ann', 'Dee', 'Cal']);
    assert.deepEqual(sorted(all, 'squad', true), ['Dee', 'Ann', 'Bea', 'Cal']);
  });
  test('squads outside the usual order (u16) sort after the listed ones but before "no squad"', () => {
    const k = row('Kid', '2025-01-01', { squad: 'u16' });
    assert.deepEqual(sorted([k, a, c], 'squad', false), ['Ann', 'Kid', 'Cal']);
  });
  test('ties on the sort column are broken newest first, then by name', () => {
    const p = row('Pat', '2024-01-01', { club: 'Leeds' }), q = row('Quin', '2026-01-01', { club: 'Leeds' });
    assert.deepEqual(sorted([p, q], 'club', false), ['Quin', 'Pat']);
  });
});

test.describe('squadAt (squad at the time of a movement)', () => {
  const bands = [{ squad: 'u21', bornOnOrAfter: '2005-01-01' }];
  const season = { id: '2025-26', ageBands: bands };
  test('uses the squad on that season\'s roster when the player is on it', () => {
    const roster = { '2025-26': { p1: { squad: 'U18' } } };
    assert.equal(site.squadAt({ id: 'p1', dob: '1990-01-01' }, season, roster), 'u18');
  });
  test('otherwise works it out from date of birth and that season\'s age bands', () => {
    assert.equal(site.squadAt({ id: 'p2', dob: '2006-05-05' }, season, {}), 'u21');
    assert.equal(site.squadAt({ id: 'p3', dob: '1990-05-05' }, season, {}), 'senior');
  });
  test('no dob: the player\'s squadIfDobUnknown, else the team default', () => {
    assert.equal(site.squadAt({ id: 'p4', squadIfDobUnknown: 'u18' }, season, {}), 'u18');
    assert.equal(site.squadAt({ id: 'p5' }, season, {}), 'u16');
  });
  test('a date that falls in no season has no squad', () => {
    assert.equal(site.squadAt({ id: 'p1', dob: '2006-05-05' }, null, {}), null);
  });
});

test.describe('seasonFor', () => {
  const seasons = [{ id: '2026-27' }, { id: '2025-26' }];
  test('finds the season a date falls in (inclusive of 1 July and 30 June), or null', () => {
    assert.equal(site.seasonFor(ms('2026-07-01'), seasons).id, '2026-27');
    assert.equal(site.seasonFor(ms('2026-06-30'), seasons).id, '2025-26');
    assert.equal(site.seasonFor(ms('2020-01-01'), seasons), null);
    assert.equal(site.seasonFor(null, seasons), null);
  });
});
