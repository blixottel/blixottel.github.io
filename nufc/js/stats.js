/**
 * stats.js — appearance-stat aggregation and fixtures.json/players data validation.
 */

/**
 * Computes stat totals from a single squad's own fixture data only —
 * NOT aggregated across all three squads. This matters for a player whose
 * home squad differs from where they actually played: e.g. a U18 player
 * who's only ever turned out for the U21s should have that yellow card
 * show up in the U21 leaderboards (where the match actually happened),
 * not bleed onto their home U18 page just because it's technically "their"
 * card. Call this once per squad with that squad's own { fixtures, appearances }.
 */
function computeStatsForSquad(fixtureData) {
  return computeStatsForFixtureIds(fixtureData, null);
}

/**
 * Same aggregation as computeStatsForSquad, but optionally scoped to a
 * subset of fixture ids (e.g. just this squad's league fixtures, or just
 * its cup fixtures) — the basis for the per-competition leaderboards.
 * Pass fixtureIdSet = null/undefined for no filtering (every fixture).
 */
function computeStatsForFixtureIds(fixtureData, fixtureIdSet) {
  const stats = {};
  const minutesTracked = {};

  const ensure = (id) => {
    if (!stats[id]) {
      stats[id] = { appearances: 0, starts: 0, subApps: 0, unusedSubs: 0, goals: 0, xg: 0, assists: 0, yellowCards: 0, redCards: 0, minutes: 0 };
      minutesTracked[id] = false;
    }
    return stats[id];
  };

  const appearances = (fixtureData && fixtureData.appearances) || {};
  Object.keys(appearances).forEach(playerId => {
    const byFixture = appearances[playerId];
    Object.keys(byFixture).forEach(fxId => {
      if (fixtureIdSet && !fixtureIdSet.has(fxId)) return;
      const rec = byFixture[fxId];
      if (!rec || !rec.status) return;
      const s = ensure(playerId);
      if (APPEARANCE_STATUSES.has(rec.status)) {
        s.appearances += 1;
        if (rec.status === 'start') s.starts += 1;
        if (rec.status === 'sub_on') s.subApps += 1;
      }
      if (rec.status === 'unused_sub') s.unusedSubs += 1;
      s.goals += rec.goals || 0;
      s.xg += rec.xg || 0;
      s.assists += rec.assists || 0;
      if (rec.yellowCard) s.yellowCards += 1;
      if (rec.redCard) s.redCards += 1;
      if (typeof rec.minutes === 'number') {
        s.minutes += rec.minutes;
        minutesTracked[playerId] = true;
      }
    });
  });

  Object.keys(stats).forEach(id => {
    if (!minutesTracked[id]) stats[id].minutes = null;
  });

  return stats;
}

/**
 * Groups a squad's fixtures by competition name, in display order: the
 * "League" bucket (fixtures with no competition set, or a competition name
 * that isn't a cup/European one) first, then every other named competition
 * in the order it first appears in the fixture list. Returns an array of
 * { label, fixtureIds: Set } — used to build the per-competition leaderboard
 * tabs alongside the season-wide "Overall" view.
 */
function competitionGroups(fixtures) {
  const order = [];
  const idsByLabel = {};
  fixtures.forEach(fx => {
    const label = (fx.competition && fx.competition.trim()) ? fx.competition.trim() : 'League';
    if (!idsByLabel[label]) {
      idsByLabel[label] = new Set();
      order.push(label);
    }
    idsByLabel[label].add(fx.id);
  });
  const ordered = [];
  if (idsByLabel['League']) ordered.push('League');
  order.forEach(label => { if (label !== 'League') ordered.push(label); });
  return ordered.map(label => ({ label, fixtureIds: idsByLabel[label] }));
}

/**
 * Parses a result string like "W 3–1" / "D 1-1" / "L 0-2" into
 * { letter, forGoals, againstGoals }. "for" is always Newcastle's goals,
 * regardless of home/away, matching the DATA-GUIDE convention.
 * Returns null if the string is empty or doesn't match the expected shape.
 */
function parseResult(resultStr) {
  if (!resultStr || !resultStr.trim()) return null;
  const m = resultStr.trim().match(/^([WDL])\s*(\d+)\s*[–-]\s*(\d+)/i);
  if (!m) return null;
  return { letter: m[1].toUpperCase(), forGoals: parseInt(m[2], 10), againstGoals: parseInt(m[3], 10) };
}

/**
 * Cross-checks fixtures.json against itself and against players.json:
 * goals tally, starter count, subs count, W/D/L vs scoreline, clean sheet
 * plausibility, stray stats on bench/unavailable records, season-roster ids
 * that don't resolve against players-master.json, dob/squad-computation
 * gaps, and unknown status values. Returns a flat list of issues; an empty
 * list means clean data.
 *
 * `options.requireDetailedStats` (default true) controls whether missing
 * first-team minutes/xG are flagged as warnings at all — set it to false
 * for a season where that data was never recorded, so the "Data checks"
 * panel doesn't fill up with nags that can never be resolved. It has no
 * effect on the tally checks (minutes-sum-vs-90×11, xG-sum-vs-fixture-xG),
 * which only run when the relevant data is already present either way.
 */
const KNOWN_PLAYER_STATUSES = new Set(['active', 'loan', 'incoming', 'left', 'injured_season', 'not_selected_season', 'trialist']);

function validateFixtures(fixturesData, playersById, options = {}) {
  const issues = []; // { squad, fixtureId, fixtureLabel, severity, message }
  // Minutes and xG are only expected to be filled in for the first team, and
  // only for seasons where that data is actually available — older seasons
  // dug up from historical records often don't have per-player minutes/xG,
  // so this can be turned off per season (see seasons.json's
  // "requireDetailedStats" flag) without disabling it for current seasons.
  const requireDetailedStats = options.requireDetailedStats !== false;

  Object.keys(playersById).forEach(pid => {
    const p = playersById[pid];
    if (p._unresolvedMaster) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'error',
        message: `"${pid}" is in a season roster file but has no matching entry in players-master.json — showing "${pid}" as the name instead of a real one. Check for a typo, or a player id that was renamed in one file but not the other.` });
    }
    if (p._dobUnknownDefaulted) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'warning',
        message: `${p.name} has no "dob" and no "squadIfDobUnknown" in players-master.json — defaulting to U16. Add "squadIfDobUnknown" there if that's the wrong squad.` });
    }
    if (p._squadIfDobUnknownUnused) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'warning',
        message: `${p.name} has both a "dob" and a "squadIfDobUnknown" in players-master.json — the dob is used for squad assignment and "squadIfDobUnknown" is ignored. Safe to remove it.` });
    }
    if (p.status && !KNOWN_PLAYER_STATUSES.has(p.status)) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'error',
        message: `${p.name} has an unrecognized status "${p.status}" in players.json (expected "active", "loan", "incoming", "left", "injured_season", "not_selected_season", "trialist", or omitted).` });
    }
  });

  Object.keys(fixturesData).forEach(squadKey => {
    const sq = fixturesData[squadKey] || {};
    const fixtures = sq.fixtures || [];
    const appearances = sq.appearances || {};

    const seenFixtureIds = new Set();
    fixtures.forEach(fx => {
      if (seenFixtureIds.has(fx.id)) {
        issues.push({ squad: squadKey, fixtureId: fx.id, fixtureLabel: null, severity: 'error',
          message: `Duplicate fixture id "${fx.id}" in ${SQUAD_LABEL[squadKey]} fixtures.` });
      }
      seenFixtureIds.add(fx.id);
    });

    const validFixtureIds = new Set(fixtures.map(fx => fx.id));

    Object.keys(appearances).forEach(pid => {
      if (!playersById[pid]) {
        issues.push({ squad: squadKey, fixtureId: null, fixtureLabel: null, severity: 'error',
          message: `"${pid}" is logged in ${SQUAD_LABEL[squadKey]} appearances but isn't in players.json (typo in the id?).` });
      }
      Object.keys(appearances[pid] || {}).forEach(fxId => {
        if (!validFixtureIds.has(fxId)) {
          const name = (playersById[pid] || {}).name || pid;
          issues.push({ squad: squadKey, fixtureId: null, fixtureLabel: null, severity: 'error',
            message: `${name} has an appearance logged against fixture id "${fxId}", which doesn't match any fixture in ${SQUAD_LABEL[squadKey]}'s fixture list (typo in the id? this fixture's real entry would be silently skipped).` });
        }
      });
    });

    fixtures.forEach(fx => {
      const records = [];
      Object.keys(appearances).forEach(pid => {
        const rec = appearances[pid][fx.id];
        if (rec) records.push({ pid, rec });
      });

      const label = `${fmtDate(fx.date)} v ${fx.opponent}`;
      const flag = (severity, message) => issues.push({ squad: squadKey, fixtureId: fx.id, fixtureLabel: label, severity, message: `${label}: ${message}` });

      if (records.length === 0) {
        // Nothing logged for this fixture yet. That's expected for a fixture
        // that genuinely hasn't been played — but if it has a result, or its
        // date has already passed, it should have appearance data by now.
        const isPastDate = !!fx.date && new Date(fx.date + 'T00:00:00') < new Date(new Date().toDateString());
        if (fx.result) {
          flag('error', `result "${fx.result}" is entered but no player appearances have been logged for this fixture at all.`);
        } else if (isPastDate) {
          flag('warning', `this fixture's date has passed but no player appearances have been logged for it yet.`);
        }
        return; // nothing else to check until at least one appearance is logged
      }

      const KNOWN_STATUSES = new Set(['start', 'sub_on', 'unused_sub', 'injured', 'suspended', 'loan', 'transferred', 'incoming', 'unavailable']);
      records.forEach(({ pid, rec }) => {
        if (!KNOWN_STATUSES.has(rec.status)) {
          const name = (playersById[pid] || {}).name || pid;
          flag('error', `${name} has an unrecognized status "${rec.status}" (expected "start", "sub_on", "unused_sub", "injured", "suspended", "loan", "transferred", "incoming", or "unavailable") — this record won't be counted anywhere until it's fixed.`);
        }
      });

      const starts = records.filter(r => r.rec.status === 'start');
      const subsOn = records.filter(r => r.rec.status === 'sub_on');
      const unusedSubs = records.filter(r => r.rec.status === 'unused_sub');
      const goalsSum = records.reduce((s, r) => s + (r.rec.goals || 0), 0);
      const assistsSum = records.reduce((s, r) => s + (r.rec.assists || 0), 0);

      // If nobody has a "start" or "sub_on" record yet, this fixture hasn't actually
      // been logged as played — e.g. only a loan player's "unavailable" was pre-filled
      // for a future match. Skip the lineup/goals checks, but still catch stray stats
      // below (a goal on an "unavailable" record would still be a mistake worth flagging).
      const hasPlayingData = starts.length > 0 || subsOn.length > 0;

      if (!hasPlayingData && fx.result) {
        // A result is on the board, but nobody's actually logged as having
        // started or come off the bench — e.g. only an "unavailable"/"loan"
        // placeholder record exists so far. Flag this directly, rather than
        // relying on the goals-vs-result check below, which would otherwise
        // stay silent for a scoreless-for-us result (a 0-0 draw or an
        // away loss) even though the lineup is still completely missing.
        flag('error', `result "${fx.result}" is entered but no players are logged as having started or come on as a substitute for this fixture.`);
      }

      if (hasPlayingData && starts.length !== 11) {
        flag('error', `${starts.length} starter${starts.length === 1 ? '' : 's'} logged, expected 11.`);
      }

      if (hasPlayingData && typeof fx.subsUsed === 'number' && fx.subsUsed !== subsOn.length) {
        flag('error', `fixture says ${fx.subsUsed} sub${fx.subsUsed === 1 ? '' : 's'} used, but ${subsOn.length} player record${subsOn.length === 1 ? '' : 's'} show "sub_on".`);
      }
      if (hasPlayingData && typeof fx.subsUnused === 'number' && fx.subsUnused !== unusedSubs.length) {
        flag('error', `fixture says ${fx.subsUnused} unused sub${fx.subsUnused === 1 ? '' : 's'}, but ${unusedSubs.length} player record${unusedSubs.length === 1 ? '' : 's'} show "unused_sub".`);
      }

      if (assistsSum > goalsSum) {
        flag('error', `assists logged (${assistsSum}) exceed goals logged (${goalsSum}).`);
      }

      const yellowSum = records.filter(r => r.rec.yellowCard).length;
      const redSum = records.filter(r => r.rec.redCard).length;

      if (hasPlayingData && typeof fx.assistsTotal === 'number' && fx.assistsTotal !== assistsSum) {
        flag('error', `fixture says ${fx.assistsTotal} assist${fx.assistsTotal === 1 ? '' : 's'}, but player records total ${assistsSum}.`);
      }
      if (hasPlayingData && typeof fx.yellowCardsTotal === 'number' && fx.yellowCardsTotal !== yellowSum) {
        flag('error', `fixture says ${fx.yellowCardsTotal} yellow card${fx.yellowCardsTotal === 1 ? '' : 's'}, but player records total ${yellowSum}.`);
      }
      if (hasPlayingData && typeof fx.redCardsTotal === 'number' && fx.redCardsTotal !== redSum) {
        flag('error', `fixture says ${fx.redCardsTotal} red card${fx.redCardsTotal === 1 ? '' : 's'}, but player records total ${redSum}.`);
      }

      // Senior-only: total minutes across the XI + subs should equal 11 × 90, and
      // per-player xG should tally to the fixture's team xG — only meaningful once
      // every playing record has the relevant field filled in, otherwise it's just
      // partial data and would produce a misleading mismatch.
      if (squadKey === 'senior' && hasPlayingData) {
        const playingRecords = records.filter(r => APPEARANCE_STATUSES.has(r.rec.status));
        const allHaveMinutes = playingRecords.length > 0 && playingRecords.every(r => typeof r.rec.minutes === 'number');
        if (allHaveMinutes) {
          const minutesSum = playingRecords.reduce((s, r) => s + r.rec.minutes, 0);
          const matchMinutes = fx.wentToExtraTime ? 120 : 90;
          const baseTotal = matchMinutes * 11;
          const expectedMinutes = baseTotal - (fx.redCardMinutesLost || 0);
          if (minutesSum !== expectedMinutes) {
            const baseLabel = fx.wentToExtraTime ? `11 × 120 (extra time) = ${baseTotal}` : `11 × 90 = ${baseTotal}`;
            flag('warning', `total minutes played (${minutesSum}) doesn't equal ${expectedMinutes === baseTotal ? baseLabel : `${baseTotal} − ${fx.redCardMinutesLost} (red card) = ${expectedMinutes}`} — a red card or non-standard match length can legitimately explain a difference, otherwise worth checking.`);
          }
        }

        if (typeof fx.xg === 'number') {
          const xgSum = playingRecords.reduce((s, r) => s + (r.rec.xg || 0), 0);
          if (Math.abs(xgSum - fx.xg) > 0.02) {
            flag('error', `fixture xG is ${fx.xg.toFixed(2)}, but player records total ${xgSum.toFixed(2)}.`);
          }
        }
      }

      records.forEach(({ pid, rec }) => {
        if (!APPEARANCE_STATUSES.has(rec.status) && !rec.allowNonPlayingStats) {
          const extras = [];
          if (rec.goals) extras.push('goals');
          if (rec.assists) extras.push('assists');
          if (rec.yellowCard) extras.push('a yellow card');
          if (rec.redCard) extras.push('a red card');
          if (rec.xg) extras.push('xG');
          if (extras.length) {
            const name = (playersById[pid] || {}).name || pid;
            flag('error', `${name} is marked "${rec.status}" but has ${extras.join(', ')} recorded.`);
          }
        }
      });

      const parsed = parseResult(fx.result);
      if (fx.result && !parsed) {
        flag('warning', `result "${fx.result}" isn't in the expected "W 3–1" format, so it can't be checked against logged goals.`);
      }
      if (parsed) {
        const outcomeOk = (parsed.letter === 'W' && parsed.forGoals > parsed.againstGoals)
          || (parsed.letter === 'L' && parsed.forGoals < parsed.againstGoals)
          || (parsed.letter === 'D' && parsed.forGoals === parsed.againstGoals);
        if (!outcomeOk) {
          flag('warning', `result "${fx.result}" — the W/D/L doesn't match the scoreline.`);
        }

        const ownGoals = fx.ownGoalsFor || 0;
        const expectedFor = goalsSum + ownGoals;
        if (hasPlayingData && expectedFor !== parsed.forGoals) {
          const detail = ownGoals
            ? `${goalsSum} + ${ownGoals} own goal${ownGoals === 1 ? '' : 's'} = ${expectedFor}`
            : `${goalsSum}`;
          flag('error', `result shows ${parsed.forGoals} goal${parsed.forGoals === 1 ? '' : 's'} for, but player records total ${detail}.`);
        }

        // Once a result is on the board, nudge towards filling in everything else
        // too — the checks above only fire once a field is present, so an entirely
        // missing field would otherwise pass silently.
        if (hasPlayingData) {
          const requiredFields = ['subsUsed', 'subsUnused', 'assistsTotal', 'yellowCardsTotal', 'redCardsTotal'];
          requiredFields.forEach(field => {
            if (typeof fx[field] !== 'number') {
              flag('warning', `result is entered but "${field}" hasn't been filled in yet.`);
            }
          });

          if (squadKey === 'senior' && requireDetailedStats) {
            if (typeof fx.xg !== 'number') {
              flag('warning', `result is entered but "xg" (team expected goals) hasn't been filled in yet.`);
            }
            const playingRecords = records.filter(r => APPEARANCE_STATUSES.has(r.rec.status));
            const missingMinutes = playingRecords.filter(r => typeof r.rec.minutes !== 'number');
            if (missingMinutes.length) {
              flag('warning', `result is entered but ${missingMinutes.length} player${missingMinutes.length === 1 ? '' : 's'} still missing "minutes".`);
            }
            // Deliberately no per-player "missing xg" nag: not every player needs
            // an individual xG value. The only xG check that matters is the tally
            // above — that whatever per-player xG values ARE logged add up to the
            // fixture's total xg.
          }
        }
      }
    });
  });

  return issues;
}