// Appearance maths and fixture checks (js/stats.js). Run with: npm test (or: node --test)
const test = require('node:test');
const assert = require('node:assert/strict');
const { loadSite } = require('./helpers/site');
const { cleanMatch, squadPlayers } = require('./helpers/fixtures');

const site = loadSite();
const fixtureIds = ids => new Set(ids);
// Objects created inside the vm context have a different Object.prototype, so compare via JSON.
const plain = v => JSON.parse(JSON.stringify(v));

test.describe('computeStatsForSquad', () => {
  const data = {
    fixtures: [{ id: 'f1' }, { id: 'f2' }, { id: 'f3' }],
    appearances: {
      a: {
        f1: { status: 'start', goals: 2, assists: 1, minutes: 90, xg: 0.8, yellowCard: true },
        f2: { status: 'sub_on', goals: 1, minutes: 20, xg: 0.3 },
        f3: { status: 'unused_sub' },
      },
      b: { f1: { status: 'start', redCard: true }, f2: { status: 'injured' } },
    },
  };
  const stats = plain(site.computeStatsForSquad(data));

  test('counts appearances, starts and sub appearances (unused subs are not appearances)', () => {
    assert.equal(stats.a.appearances, 2);
    assert.equal(stats.a.starts, 1);
    assert.equal(stats.a.subApps, 1);
    assert.equal(stats.a.unusedSubs, 1);
  });
  test('sums goals, assists, minutes and xG', () => {
    assert.equal(stats.a.goals, 3);
    assert.equal(stats.a.assists, 1);
    assert.equal(stats.a.minutes, 110);
    assert.ok(Math.abs(stats.a.xg - 1.1) < 1e-9);
  });
  test('counts cards', () => {
    assert.equal(stats.a.yellowCards, 1);
    assert.equal(stats.b.redCards, 1);
  });
  test('minutes and xG are null (not 0) when never recorded', () => {
    assert.equal(stats.b.minutes, null);
    assert.equal(stats.b.xg, null);
  });
  test('a non-playing record (e.g. injured) creates an entry but no appearance', () => {
    assert.equal(stats.b.appearances, 1); // only the start in f1
    const onlyInjured = plain(site.computeStatsForSquad({ appearances: { c: { f1: { status: 'injured' } } } }));
    assert.equal(onlyInjured.c.appearances, 0);
  });
  test('empty or missing input gives no stats and does not throw', () => {
    assert.deepEqual(plain(site.computeStatsForSquad(undefined)), {});
    assert.deepEqual(plain(site.computeStatsForSquad({ fixtures: [], appearances: {} })), {});
  });
  test('records without a status are ignored', () => {
    assert.deepEqual(plain(site.computeStatsForSquad({ appearances: { z: { f1: {} } } })), {});
  });
  test('computeStatsForFixtureIds only counts the chosen fixtures', () => {
    const only1 = plain(site.computeStatsForFixtureIds(data, fixtureIds(['f1'])));
    assert.equal(only1.a.appearances, 1);
    assert.equal(only1.a.goals, 2);
    assert.equal(plain(site.computeStatsForFixtureIds(data, null)).a.goals, 3);
  });
});

test.describe('competitionGroups', () => {
  test('League first, then other competitions in order of first appearance', () => {
    const groups = site.competitionGroups([
      { id: '1', competition: 'FA Cup' }, { id: '2' }, { id: '3', competition: ' League Cup ' }, { id: '4', competition: 'FA Cup' }, { id: '5', competition: '' },
    ]);
    assert.deepEqual(plain(groups.map(g => g.label)), ['League', 'FA Cup', 'League Cup']);
    assert.deepEqual([...groups[0].fixtureIds], ['2', '5']);
    assert.deepEqual([...groups[1].fixtureIds], ['1', '4']);
  });
  test('no League group when every fixture is a named competition', () => {
    assert.deepEqual(plain(site.competitionGroups([{ id: '1', competition: 'FA Cup' }]).map(g => g.label)), ['FA Cup']);
  });
});

test.describe('parseResult', () => {
  test('parses W/D/L with hyphen or en dash, any case, spaces optional', () => {
    assert.deepEqual(plain(site.parseResult('W 3–1')), { letter: 'W', forGoals: 3, againstGoals: 1 });
    assert.deepEqual(plain(site.parseResult('d 1-1')), { letter: 'D', forGoals: 1, againstGoals: 1 });
    assert.deepEqual(plain(site.parseResult('L0-2')), { letter: 'L', forGoals: 0, againstGoals: 2 });
  });
  test('returns null for blank or malformed results', () => {
    assert.equal(site.parseResult(''), null);
    assert.equal(site.parseResult('   '), null);
    assert.equal(site.parseResult(undefined), null);
    assert.equal(site.parseResult('postponed'), null);
  });
});

test.describe('countNoDetailedStats', () => {
  const data = {
    fixtures: [{ id: 'f1', noDetailedStats: true }, { id: 'f2', noDetailedStats: true }, { id: 'f3' }],
    appearances: { a: { f1: { status: 'start' }, f2: { status: 'unused_sub' } } },
  };
  test('counts flagged fixtures, optionally limited to ids or to ones the player played in', () => {
    assert.equal(site.countNoDetailedStats(data), 2);
    assert.equal(site.countNoDetailedStats(data, ['f1', 'f3']), 1);
    assert.equal(site.countNoDetailedStats(data, null, 'a'), 1); // f2 was only an unused sub
  });
});

test.describe('looseDate / seasonRange', () => {
  const utc = (y, m, d) => Date.UTC(y, m - 1, d);
  test('looseDate handles full, month-only and year-only dates, as a start or an end', () => {
    assert.equal(site.looseDate('2024-05-20', false), utc(2024, 5, 20));
    assert.equal(site.looseDate('2024-05', false), utc(2024, 5, 1));
    assert.equal(site.looseDate('2024-02', true), utc(2024, 2, 29)); // leap year
    assert.equal(site.looseDate('2024', true), utc(2024, 12, 31));
    assert.equal(site.looseDate('nonsense', false), null);
    assert.equal(site.looseDate(undefined, false), null);
  });
  test('seasonRange defaults to 1 July - 30 June from the id', () => {
    const r = site.seasonRange({ id: '2025-26' });
    assert.equal(r.start, utc(2025, 7, 1));
    assert.equal(r.end, utc(2026, 6, 30));
  });
  test('explicit startDate / endDate win; a bad id with no dates gives null', () => {
    const r = site.seasonRange({ id: '2025-26', startDate: '2025-08-01', endDate: '2026-05-31' });
    assert.equal(r.start, utc(2025, 8, 1));
    assert.equal(r.end, utc(2026, 5, 31));
    assert.equal(site.seasonRange({ id: 'preseason' }), null);
    assert.equal(site.seasonRange(null), null);
  });
});

test.describe('findDuplicateJsonKeys', () => {
  test('finds a repeated key at the top level and nested, with its path', () => {
    const top = site.findDuplicateJsonKeys('{"a":1,"a":2}');
    assert.deepEqual(plain(top), [{ path: '', key: 'a', count: 2 }]);
    const nested = site.findDuplicateJsonKeys('{"x":{"y":1,"y":2,"z":3}}');
    assert.equal(nested.length, 1);
    assert.equal(nested[0].key, 'y');
    assert.equal(nested[0].path, 'x');
  });
  test('finds duplicates inside arrays of objects', () => {
    const r = site.findDuplicateJsonKeys('[{"id":"a","id":"b"}]');
    assert.equal(r.length, 1);
    assert.equal(r[0].key, 'id');
  });
  test('same key in different objects is fine; clean and malformed input give []', () => {
    assert.deepEqual(plain(site.findDuplicateJsonKeys('[{"id":1},{"id":2}]')), []);
    assert.deepEqual(plain(site.findDuplicateJsonKeys('{"a":1,"b":[1,2,{"c":null}]}')), []);
    assert.deepEqual(plain(site.findDuplicateJsonKeys('{"a":')), []);
  });
});

test.describe('validateFixtures', () => {
  const run = (fx, opts) => plain(site.validateFixtures(fx, squadPlayers(), { requireDetailedStats: false, ...opts }));
  const has = (issues, re, severity) => issues.some(i => re.test(i.message) && (!severity || i.severity === severity));

  test('a complete, consistent match has no errors', () => {
    const issues = run(cleanMatch());
    assert.deepEqual(issues.filter(i => i.severity === 'error'), []);
  });
  test('goals in the player records must add up to the scoreline', () => {
    const issues = run(cleanMatch({ result: 'W 2-0', goals: { p9: 1 } }));
    assert.ok(has(issues, /result shows 2 goals for, but player records total 1/, 'error'));
  });
  test('the W/D/L letter must match the scoreline', () => {
    const issues = run(cleanMatch({ result: 'L 1-0' }));
    assert.ok(has(issues, /W\/D\/L doesn't match the scoreline/));
  });
  test('a match needs 11 starters', () => {
    const fx = cleanMatch();
    delete fx.senior.appearances.p11;
    assert.ok(has(run(fx), /10 starters logged, expected 11/, 'error'));
  });
  test('duplicate fixture ids are errors', () => {
    const fx = cleanMatch();
    fx.senior.fixtures.push({ ...fx.senior.fixtures[0], date: '2026-08-17', opponent: 'Spurs' });
    assert.ok(has(run(fx), /Duplicate fixture id "f1"/, 'error'));
  });
  test('an id in the appearances that is not a known player is an error', () => {
    const fx = cleanMatch();
    fx.senior.appearances.ghost = { f1: { status: 'unused_sub' } };
    assert.ok(has(run(fx), /"ghost" is logged in First Team appearances/, 'error'));
  });
  test('an unrecognised status is an error', () => {
    const fx = cleanMatch();
    fx.senior.appearances.p1.f1.status = 'flying';
    assert.ok(has(run(fx), /unrecognized status "flying"/, 'error'));
  });
  test('a fixture outside the season dates is flagged', () => {
    const issues = run(cleanMatch({ date: '2025-01-10' }), { season: { id: '2026-27', label: '2026/27' } });
    assert.ok(has(issues, /outside the 2026\/27 season/, 'warning'));
  });
  test('a fixture with no venue is flagged', () => {
    const fx = cleanMatch();
    delete fx.senior.fixtures[0].venue;
    assert.ok(has(run(fx), /no venue/, 'warning'));
  });
});

test.describe('seasonCompleteIssue / seasonStaleCompleteIssue', () => {
  const done = { senior: { fixtures: [{ id: 'f1', result: 'W 1-0' }] } };
  const notDone = { senior: { fixtures: [{ id: 'f1', result: 'W 1-0' }, { id: 'f2', result: '' }] } };
  test('suggests dataComplete once every fixture has a result and there are no errors', () => {
    const issue = site.seasonCompleteIssue({ id: '2025-26' }, done, []);
    assert.ok(issue && issue.ignoreInBanner === true);
  });
  test('does not suggest it with missing results, errors, an empty season, or when already complete', () => {
    assert.equal(site.seasonCompleteIssue({ id: '2025-26' }, notDone, []), null);
    assert.equal(site.seasonCompleteIssue({ id: '2025-26' }, done, [{ severity: 'error' }]), null);
    assert.equal(site.seasonCompleteIssue({ id: '2025-26' }, { senior: { fixtures: [] } }, []), null);
    assert.equal(site.seasonCompleteIssue({ id: '2025-26', dataComplete: true }, done, []), null);
  });
  test('flags a season marked complete that still has fixtures without results', () => {
    const issue = site.seasonStaleCompleteIssue({ id: '2025-26', dataComplete: true }, notDone, []);
    assert.ok(issue && /1 fixture has no result/.test(issue.message));
    assert.equal(site.seasonStaleCompleteIssue({ id: '2025-26', dataComplete: true }, done, []), null);
    assert.equal(site.seasonStaleCompleteIssue({ id: '2025-26' }, notDone, []), null);
  });
});
