// Shared JSON loading + cache, the shared season setup, and the combined data checks (js/data.js, js/stats.js).
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSite, fakeFetch, makeStorage } = require('./helpers/site');
const { cleanMatch, squadPlayers } = require('./helpers/fixtures');

const plain = v => JSON.parse(JSON.stringify(v));
const DIR = 'data-men/';

test.describe('fetchJson / fetchText', () => {
  test('callers on the same page share one request', async () => {
    const f = fakeFetch({ 'a.json': { n: 1 } });
    const site = loadSite({ fetch: f });
    await Promise.all([site.fetchJson('a.json'), site.fetchJson('a.json'), site.fetchText('a.json')]);
    await site.fetchJson('a.json');
    assert.equal(f.calls['a.json'], 1);
  });
  test('every caller gets its own parsed copy, so one cannot corrupt another', async () => {
    const site = loadSite({ fetch: fakeFetch({ 'list.json': [{ id: 'a' }] }) });
    const first = await site.fetchJson('list.json');
    first.push({ id: 'extra' });
    first[0].id = 'changed';
    const second = await site.fetchJson('list.json');
    assert.deepEqual(plain(second), [{ id: 'a' }]);
  });
  test('a 404 rejects, and is remembered for the life of the page (no repeat requests for a missing optional file)', async () => {
    const f = fakeFetch({});
    const site = loadSite({ fetch: f });
    await assert.rejects(() => site.fetchJson('players-former.json'));
    await assert.rejects(() => site.fetchJson('players-former.json'));
    assert.equal(f.calls['players-former.json'], 1);
  });
  test('invalid JSON rejects', async () => {
    const site = loadSite({ fetch: fakeFetch({ 'bad.json': '{"a":' }) });
    await assert.rejects(() => site.fetchJson('bad.json'));
  });

  test.describe('sessionStorage cache', () => {
    test('is OFF on localhost, so JSON edits show up on refresh', async () => {
      const storage = makeStorage();
      const site = loadSite({ fetch: fakeFetch({ 'a.json': { n: 1 } }), hostname: 'localhost', sessionStorage: storage });
      await site.fetchJson('a.json');
      assert.equal(storage._map.size, 0);
    });
    test('on a published site, a second page load is served from the cache without a request', async () => {
      const storage = makeStorage();
      const routes = { 'a.json': { n: 1 } };
      const f1 = fakeFetch(routes);
      await loadSite({ fetch: f1, hostname: 'example.com', sessionStorage: storage }).fetchJson('a.json');
      assert.equal(f1.calls['a.json'], 1);
      assert.equal(storage._map.size, 1);

      const f2 = fakeFetch(routes); // a "new page": fresh context, same sessionStorage
      const again = await loadSite({ fetch: f2, hostname: 'example.com', sessionStorage: storage }).fetchJson('a.json');
      assert.deepEqual(plain(again), { n: 1 });
      assert.equal(f2.calls['a.json'], undefined);
    });
    test('a cached copy expires after the TTL', async () => {
      const storage = makeStorage();
      const f1 = fakeFetch({ 'a.json': { n: 1 } });
      await loadSite({ fetch: f1, hostname: 'example.com', sessionStorage: storage }).fetchJson('a.json');
      const key = [...storage._map.keys()][0];
      const entry = JSON.parse(storage._map.get(key));
      entry.t -= 6 * 60 * 1000; // older than the 5 minute TTL
      storage._map.set(key, JSON.stringify(entry));

      const f2 = fakeFetch({ 'a.json': { n: 2 } });
      const fresh = await loadSite({ fetch: f2, hostname: 'example.com', sessionStorage: storage }).fetchJson('a.json');
      assert.deepEqual(plain(fresh), { n: 2 });
      assert.equal(f2.calls['a.json'], 1);
    });
    test('failed requests and oversized files are never stored; a full or blocked storage does not break loading', async () => {
      const storage = makeStorage();
      const site = loadSite({ fetch: fakeFetch({ 'big.json': { s: 'x'.repeat(1600000) } }), hostname: 'example.com', sessionStorage: storage });
      await site.fetchJson('big.json');
      await assert.rejects(() => site.fetchJson('missing.json'));
      assert.equal(storage._map.size, 0);

      const blocked = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('quota'); }, removeItem() {} };
      const site2 = loadSite({ fetch: fakeFetch({ 'a.json': { n: 1 } }), hostname: 'example.com', sessionStorage: blocked });
      assert.deepEqual(plain(await site2.fetchJson('a.json')), { n: 1 });
    });
  });
});

test.describe('loadSeasons / withArchive / sharedMasterFile', () => {
  test('loadSeasons returns the list, or null when missing, empty or not a list', async () => {
    assert.equal((await loadSite({ fetch: fakeFetch({ [DIR + 'seasons.json']: [{ id: '2026-27' }] }) }).loadSeasons()).length, 1);
    assert.equal(await loadSite({ fetch: fakeFetch({}) }).loadSeasons(), null);
    assert.equal(await loadSite({ fetch: fakeFetch({ [DIR + 'seasons.json']: [] }) }).loadSeasons(), null);
    assert.equal(await loadSite({ fetch: fakeFetch({ [DIR + 'seasons.json']: { a: 1 } }) }).loadSeasons(), null);
  });
  test('withArchive adds former/archived players, tagged, and keeps the first entry for duplicate ids', async () => {
    const site = loadSite({ fetch: fakeFetch({
      [DIR + 'players-former.json']: [{ id: 'f1', name: 'Former' }, { id: 'm1', name: 'Dupe' }],
      [DIR + 'players-archive.json']: [{ id: 'a1', name: 'Archived' }],
    }) });
    const master = [{ id: 'm1', name: 'Main' }];
    const out = plain(await site.withArchive(master, DIR + 'players-master.json'));
    assert.deepEqual(out.map(p => p.id), ['m1', 'f1', 'a1']);
    assert.equal(out[0].name, 'Main');
    assert.equal(out[0]._alsoInFormer, true);
    assert.equal(out[1]._former, true);
    assert.equal(out[2]._archived, true);
  });
  test('withArchive copes with the extra files not existing', async () => {
    const out = await loadSite({ fetch: fakeFetch({}) }).withArchive([{ id: 'm1' }], DIR + 'players-master.json');
    assert.equal(out.length, 1);
  });
  test('loading the same master twice does not double up the archived players', async () => {
    const site = loadSite({ fetch: fakeFetch({ [DIR + 'players-master.json']: [{ id: 'm1' }], [DIR + 'players-archive.json']: [{ id: 'a1' }] }) });
    const one = await site.withArchive(await site.fetchJson(DIR + 'players-master.json'), DIR + 'players-master.json');
    const two = await site.withArchive(await site.fetchJson(DIR + 'players-master.json'), DIR + 'players-master.json');
    assert.equal(one.length, 2);
    assert.equal(two.length, 2);
  });
  test('sharedMasterFile: the newest season\'s playersMasterFile, else the team default', () => {
    const site = loadSite();
    assert.equal(site.sharedMasterFile([{ id: 'x', playersMasterFile: 'custom/master.json' }]), 'custom/master.json');
    assert.equal(site.sharedMasterFile([{ id: 'x' }]), DIR + 'players-master.json');
    assert.equal(site.sharedMasterFile([]), DIR + 'players-master.json');
    assert.equal(site.sharedMasterFile(null), DIR + 'players-master.json');
  });
});

test.describe('resolveSeasonContext', () => {
  const seasons = [
    { id: '2026-27', playersFile: DIR + 'p-26.json', fixturesFile: DIR + 'f-26.json', ageBands: [{ squad: 'u21' }] },
    { id: '2022-23', playersFile: DIR + 'p-22.json', fixturesFile: DIR + 'f-22.json', playersMasterFile: 'old/master.json' },
  ];
  const ctxFor = search => loadSite({ search, fetch: fakeFetch({ [DIR + 'seasons.json']: seasons }) });

  test('defaults to the first (newest) season', async () => {
    const ctx = plain(await ctxFor('').resolveSeasonContext());
    assert.equal(ctx.activeSeason.id, '2026-27');
    assert.equal(ctx.playersFile, DIR + 'p-26.json');
    assert.equal(ctx.fixturesFile, DIR + 'f-26.json');
    assert.equal(ctx.masterFile, DIR + 'players-master.json');
    assert.deepEqual(ctx.ageBands, [{ squad: 'u21' }]);
  });
  test('?season= picks that season, with its own files and master file override', async () => {
    const site = ctxFor('?season=2022-23');
    const ctx = plain(await site.resolveSeasonContext());
    assert.equal(ctx.activeSeason.id, '2022-23');
    assert.equal(ctx.masterFile, 'old/master.json');
    assert.equal(ctx.fixturesFile, DIR + 'f-22.json');
  });
  test('an unknown ?season= falls back to the first season', async () => {
    assert.equal((await ctxFor('?season=1999-00').resolveSeasonContext()).activeSeason.id, '2026-27');
  });
  test('sets AGE_AS_OF for a finished season, and clears it (today) for the current one', async () => {
    const site = ctxFor('?season=2022-23');
    await site.resolveSeasonContext();
    const d = site.run('AGE_AS_OF');
    assert.deepEqual([d.getFullYear(), d.getMonth(), d.getDate()], [2023, 5, 30]);
    const current = ctxFor('?season=2026-27');
    await current.resolveSeasonContext();
    assert.equal(current.run('AGE_AS_OF'), null);
  });
  test('with no seasons.json: single-season file names, no active season', async () => {
    const ctx = plain(await loadSite({ fetch: fakeFetch({}) }).resolveSeasonContext());
    assert.equal(ctx.seasons, null);
    assert.equal(ctx.activeSeason, null);
    assert.equal(ctx.masterFile, DIR + 'players-master.json');
    assert.equal(ctx.playersFile, 'players-season.json');
    assert.equal(ctx.fixturesFile, 'fixtures.json');
    assert.deepEqual(ctx.ageBands, []);
  });
});

test.describe('gatherIssues', () => {
  const site = loadSite();
  const ctx = season => ({ seasons: null, activeSeason: season, masterFile: DIR + 'players-master.json' });

  test('combines the per-season checks with any extra issues the page passes in, in that order', async () => {
    const fx = cleanMatch({ result: 'L 1-0' }); // W/D/L letter wrong -> one warning
    const extra = { squad: '_general', fixtureId: null, fixtureLabel: null, severity: 'error', message: 'extra!' };
    const issues = plain(await site.gatherIssues(ctx(null), fx, squadPlayers(), [extra]));
    const iExtra = issues.findIndex(i => i.message === 'extra!');
    const iLetter = issues.findIndex(i => /W\/D\/L/.test(i.message));
    assert.ok(iLetter >= 0 && iExtra > iLetter);
  });
  test('suggests marking a finished, error-free season dataComplete', async () => {
    const issues = plain(await site.gatherIssues(ctx({ id: '2025-26' }), cleanMatch(), squadPlayers()));
    const nudge = issues.find(i => /"dataComplete": true/.test(i.message));
    assert.ok(nudge && nudge.ignoreInBanner === true);
  });
  test('a season marked complete that still has unfinished fixtures gets a banner-worthy issue', async () => {
    const fx = cleanMatch();
    fx.senior.fixtures.push({ id: 'f2', date: '2026-08-17', opponent: 'Spurs', venue: 'A', result: '' });
    const issues = plain(await site.gatherIssues(ctx({ id: '2026-27', dataComplete: true }), fx, squadPlayers()));
    const stale = issues.find(i => /marked "dataComplete": true, but/.test(i.message));
    assert.ok(stale && stale.bannerWorthy === true);
  });
});
