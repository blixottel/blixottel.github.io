/** Small builders for sample squads / fixtures used across the tests. */

/** 11 starters p1..p11 for one senior fixture, each 90 minutes; `goals` = { playerId: n }. */
function cleanMatch({ id = 'f1', date = '2026-08-10', opponent = 'Leeds', result = 'W 1-0', goals = { p9: 1 } } = {}) {
  const appearances = {};
  for (let i = 1; i <= 11; i++) {
    const pid = 'p' + i;
    appearances[pid] = { [id]: { status: 'start', minutes: 90, ...(goals[pid] ? { goals: goals[pid] } : {}) } };
  }
  const fixture = {
    id, date, opponent, venue: 'H', result,
    subsUsed: 0, subsUnused: 0, assistsTotal: 0, yellowCardsTotal: 0, redCardsTotal: 0,
  };
  return { senior: { fixtures: [fixture], appearances } };
}

/** playersById for p1..p11 (all senior, adults). */
function squadPlayers() {
  const byId = {};
  for (let i = 1; i <= 11; i++) byId['p' + i] = { id: 'p' + i, name: 'Player ' + i, squad: 'senior', dob: '1998-01-01', position: 'MID' };
  return byId;
}

module.exports = { cleanMatch, squadPlayers };
