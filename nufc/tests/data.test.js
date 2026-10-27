// Squad assignment, ages and roster merging (js/data.js).
process.env.TZ = 'America/Los_Angeles'; // a zone behind UTC: this is where date-of-birth parsing bugs show up
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSite } = require('./helpers/site');

const site = loadSite();
const plain = v => JSON.parse(JSON.stringify(v));

const BANDS = [
  { squad: 'u16', bornOnOrAfter: '2010-09-01' },
  { squad: 'u18', bornOnOrAfter: '2008-09-01', bornBefore: '2010-09-01' },
  { squad: 'u21', bornOnOrAfter: '2005-01-01', bornBefore: '2008-09-01' },
];

test.describe('ageBandForDob', () => {
  test('bornOnOrAfter is inclusive and bornBefore is exclusive, so bands never gap or overlap', () => {
    assert.equal(site.ageBandForDob('2010-09-01', BANDS), 'u16');
    assert.equal(site.ageBandForDob('2010-08-31', BANDS), 'u18');
    assert.equal(site.ageBandForDob('2008-09-01', BANDS), 'u18');
    assert.equal(site.ageBandForDob('2008-08-31', BANDS), 'u21');
    assert.equal(site.ageBandForDob('2005-01-01', BANDS), 'u21');
  });
  test('older than every band, or no bands at all, means senior', () => {
    assert.equal(site.ageBandForDob('2004-12-31', BANDS), 'senior');
    assert.equal(site.ageBandForDob('1990-01-01', []), 'senior');
    assert.equal(site.ageBandForDob('1990-01-01', undefined), 'senior');
  });
});

test.describe('squadKeysFor / namedPlayerIdsFor', () => {
  test('always the core squads; u19 only when the season has u19 fixtures', () => {
    assert.deepEqual(plain(site.squadKeysFor({})), ['senior', 'u21', 'u18']);
    assert.deepEqual(plain(site.squadKeysFor({ u19: { fixtures: [] } })), ['senior', 'u21', 'u19', 'u18']);
  });
  test('named players are those who started, came on or sat as an unused sub', () => {
    const ids = site.namedPlayerIdsFor({ appearances: {
      a: { f1: { status: 'start' } }, b: { f1: { status: 'unused_sub' } }, c: { f1: { status: 'injured' } }, d: { f1: { status: 'sub_on' } }, e: {},
    } });
    assert.deepEqual(plain(ids), ['a', 'b', 'd']);
    assert.deepEqual(plain(site.namedPlayerIdsFor(undefined)), []);
  });
});

test.describe('mergePlayers', () => {
  const master = [
    { id: 'kid', name: 'Kid', dob: '2009-03-03' },
    { id: 'vet', name: 'Vet', dob: '1990-01-01' },
    { id: 'nodob', name: 'No Dob' },
    { id: 'nodob18', name: 'No Dob 18', squadIfDobUnknown: 'u18' },
  ];
  const merge = roster => plain(site.mergePlayers(master, roster, BANDS));

  test('squad is computed from date of birth, and roster fields are layered on top of the master record', () => {
    const [kid, vet] = merge([{ id: 'kid', number: 7, status: 'active' }, { id: 'vet', number: 1 }]);
    assert.equal(kid.squad, 'u18');
    assert.equal(kid.name, 'Kid');
    assert.equal(kid.number, 7);
    assert.equal(vet.squad, 'senior');
  });
  test('no dob: uses squadIfDobUnknown, else the team default (u16) and flags it', () => {
    const [a, b] = merge([{ id: 'nodob' }, { id: 'nodob18' }]);
    assert.equal(a.squad, 'u16');
    assert.equal(a._dobUnknownDefaulted, true);
    assert.equal(b.squad, 'u18');
    assert.equal(b._dobUnknownDefaulted, undefined);
  });
  test('squadOverride beats the computed squad; flagged redundant when it changes nothing', () => {
    const [moved, same] = merge([{ id: 'kid', squadOverride: 'u21' }, { id: 'vet', squadOverride: 'senior' }]);
    assert.equal(moved.squad, 'u21');
    assert.equal(moved._squadOverrideRedundant, undefined);
    assert.equal(same._squadOverrideRedundant, true);
  });
  test('a roster id with no master entry is kept, with placeholders, and flagged', () => {
    const [ghost] = merge([{ id: 'typo-id', number: 9 }]);
    assert.equal(ghost.name, 'typo-id');
    assert.equal(ghost._unresolvedMaster, true);
    assert.equal(ghost.number, 9);
  });
  test('does not modify the master list it is given', () => {
    const before = JSON.stringify(master);
    site.mergePlayers(master, [{ id: 'kid', status: 'left' }], BANDS);
    assert.equal(JSON.stringify(master), before);
  });
});

test.describe('seasonAgeDate', () => {
  test('a finished season uses its end (30 June by default, or endDate)', () => {
    const d = site.seasonAgeDate({ id: '2022-23' });
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2023, 5, 30]);
    const e = site.seasonAgeDate({ id: '2022-23', endDate: '2023-05-31' });
    assert.deepEqual([e.getFullYear(), e.getMonth(), e.getDate()], [2023, 4, 31]);
  });
  test('a season that has not finished yet, or has no usable id, gives null (ages as at today)', () => {
    assert.equal(site.seasonAgeDate({ id: '2999-00' }), null);
    assert.equal(site.seasonAgeDate({ id: 'preseason' }), null);
    assert.equal(site.seasonAgeDate(null), null);
  });
});

test.describe('calcAge', () => {
  test.beforeEach(() => site.run('AGE_AS_OF = new Date(2024, 5, 30)')); // 30 June 2024, local time
  test.after(() => site.run('AGE_AS_OF = null'));

  test('age changes on the birthday itself, not a day early or late', () => {
    assert.equal(site.calcAge('2008-06-30'), 16); // birthday is "today"
    assert.equal(site.calcAge('2008-07-01'), 15); // birthday tomorrow
    assert.equal(site.calcAge('2008-06-29'), 16);
  });
  test('missing dob shows a dash', () => {
    assert.equal(site.calcAge(''), '—');
    assert.equal(site.calcAge(undefined), '—');
  });
});
