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
  const xgTracked = {};

  const ensure = (id) => {
    if (!stats[id]) {
      stats[id] = { appearances: 0, starts: 0, subApps: 0, unusedSubs: 0, goals: 0, xg: 0, assists: 0, yellowCards: 0, redCards: 0, minutes: 0 };
      minutesTracked[id] = false;
      xgTracked[id] = false;
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
      if (typeof rec.xg === 'number') {
        s.xg += rec.xg;
        xgTracked[playerId] = true;
      }
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
    // Same for xG: no recorded value at all means "not available" (null), not 0.00.
    if (!xgTracked[id]) stats[id].xg = null;
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
/**
 * Number of fixtures flagged "noDetailedStats": true (xG / minutes genuinely unavailable) in a squad's
 * fixture data — optionally only those whose id is in `ids` (an array or Set), and/or only ones
 * `playerId` was actually on the pitch for. Used for the "totals are understated" footnotes.
 */
function countNoDetailedStats(fixtureData, ids, playerId) {
  const idSet = ids ? new Set(ids) : null;
  const apps = (fixtureData && fixtureData.appearances) || {};
  return ((fixtureData && fixtureData.fixtures) || []).filter(fx => {
    if (fx.noDetailedStats !== true) return false;
    if (idSet && !idSet.has(fx.id)) return false;
    if (playerId) {
      const rec = (apps[playerId] || {})[fx.id];
      if (!rec || !APPEARANCE_STATUSES.has(rec.status)) return false;
    }
    return true;
  }).length;
}

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
const KNOWN_PLAYER_STATUSES = new Set(['active', 'loan', 'incoming', 'left', 'injured_season', 'pregnancy_leave', 'not_selected_season', 'trialist']);

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
    checkMovementDates(p, fixturesData).forEach(i => issues.push(i));
    if (p._archived && !p.careerComplete) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'warning',
        message: `${p.name} is in players-archive.json but isn't marked careerComplete.` });
    }
    if (p._alsoInArchive || p._alsoInFormer) {
      issues.push({ squad: normSquad(p.squad), fixtureId: null, fixtureLabel: null, severity: 'warning',
        message: `${p.name} is in more than one of players-master.json, players-former.json and players-archive.json — the first of those is used. Remove the duplicate.` });
    }
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
        message: `${p.name} has an unrecognized status "${p.status}" in players.json (expected "active", "loan", "incoming", "left", "injured_season", "pregnancy_leave", "not_selected_season", "trialist", or omitted).` });
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

    // Fixture sanity: required fields, valid/duplicate dates, season range, date order, gameweeks.
    {
      const range = options.season ? seasonRange(options.season) : null;
      const seasonName = options.season ? (options.season.label || options.season.id) : '';
      const seenKey = new Set(), gwSeen = {};
      let prev = null, orderFlagged = false;
      fixtures.forEach(fx => {
        const lbl = `${fx.date ? fmtDate(fx.date) : 'undated'} v ${fx.opponent || '(no opponent)'}`;
        const fl = (severity, message) => issues.push({ squad: squadKey, fixtureId: fx.id, fixtureLabel: lbl, severity, message: `${lbl}: ${message}` });
        if (!fx.date || !fx.opponent) {
          fl('error', `fixture is missing its ${!fx.date && !fx.opponent ? 'date and opponent' : !fx.date ? 'date' : 'opponent'}.`);
        } else if (!validDateStr(fx.date, false)) {
          fl('error', `"${fx.date}" isn't a valid date (expected YYYY-MM-DD).`);
        } else {
          const key = fx.date + '|' + String(fx.opponent).trim().toLowerCase();
          if (seenKey.has(key)) fl('error', `duplicate fixture — another ${SQUAD_LABEL[squadKey] || squadKey} fixture has the same date and opponent.`);
          seenKey.add(key);
          if (range) {
            const ms = looseDate(fx.date, false);
            if (ms < range.start || ms > range.end) fl('warning', `this date is outside the ${seasonName} season (1 July – 30 June).`);
          }
          if (prev && fx.date < prev.date && !orderFlagged) {
            orderFlagged = true;
            fl('warning', `fixtures aren't in date order — this one is dated before the previous fixture (${fmtDate(prev.date)} v ${prev.opponent}).`);
          }
          prev = fx;
        }
        if (fx.gameweek != null) {
          const comp = (fx.competition && fx.competition.trim()) ? fx.competition.trim() : 'League';
          const gk = comp + '|' + fx.gameweek;
          if (gwSeen[gk]) fl('warning', `${comp} gameweek ${fx.gameweek} is used by more than one fixture.`);
          gwSeen[gk] = true;
        }
      });
    }

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

      const KNOWN_STATUSES = new Set(['start', 'sub_on', 'unused_sub', 'injured', 'pregnancy_leave', 'suspended', 'loan', 'transferred', 'incoming', 'unavailable']);
      records.forEach(({ pid, rec }) => {
        if (!KNOWN_STATUSES.has(rec.status)) {
          const name = (playersById[pid] || {}).name || pid;
          flag('error', `${name} has an unrecognized status "${rec.status}" (expected "start", "sub_on", "unused_sub", "injured", "pregnancy_leave", "suspended", "loan", "transferred", "incoming", or "unavailable") — this record won't be counted anywhere until it's fixed.`);
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

      // A date that's passed should have a lineup AND a result by now. (The "nothing logged at all"
      // case is caught above; this catches fixtures with only placeholder records, or a lineup but no result.)
      const isPast = !!fx.date && new Date(fx.date + 'T00:00:00') < new Date(new Date().toDateString());
      if (isPast && !fx.result && !hasPlayingData) {
        flag('warning', `this fixture's date has passed but no starters or substitutes have been logged for it yet.`);
      }
      if (isPast && !fx.result && hasPlayingData) {
        flag('warning', `this fixture's date has passed but no result has been entered yet.`);
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
            const playingRecords = records.filter(r => APPEARANCE_STATUSES.has(r.rec.status));
            const missingMinutes = playingRecords.filter(r => typeof r.rec.minutes !== 'number');
            if (fx.noDetailedStats === true) {
              // Marked as a match where xG / minutes genuinely aren't available, so they're
              // not nagged for. But if they're all there after all, the flag is stale.
              if (typeof fx.xg === 'number' && playingRecords.length && !missingMinutes.length) {
                flag('warning', `is marked "noDetailedStats", but xG and every player's minutes are filled in — remove the flag.`);
              }
            } else {
              if (typeof fx.xg !== 'number') {
                flag('warning', `result is entered but "xg" (team expected goals) hasn't been filled in yet.`);
              }
              if (missingMinutes.length) {
                flag('warning', `result is entered but ${missingMinutes.length} player${missingMinutes.length === 1 ? '' : 's'} still missing "minutes".`);
              }
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

  validatePlayerSeasonConsistency(fixturesData, playersById, options.season).forEach(i => issues.push(i));

  return issues;
}

/**
 * Per-player consistency checks within one season. "Home squad" = the squad the player belongs to
 * (from their age band); the squad's own fixtures are what its page shows.
 *  A. injured_season / pregnancy_leave / not_selected_season but named in their HOME squad's matchday squads (error).
 *     Guest appearances in other squads are fine.
 *  H. injured_season / pregnancy_leave / not_selected_season but no entry at all in the home squad's appearances, so they
 *     won't show in the fixture-by-fixture listing (warning).
 *  F. Left (or retired) during the season but the season status is still "active" (warning).
 *  B. Joined after a squad's first match (and by its last) with no "incoming" status in that squad's
 *     fixtures; left before a squad's last match with no "transferred" (or "loan") status. Run for the home
 *     squad and for every other squad they have appearance records in (guesting), each against that
 *     squad's own first/last match dates. Retirements are exempt (warning).
 *  L. On loan (loan_out) during home-squad fixtures where the record is missing / not "loan" (warning).
 *     Fixtures where they're named during the loan are reported separately by checkMovementDates.
 *  D. Named in more than one squad's matchday squad on the same date (warning). Silenced by "verified": true on
 *     either of the appearance records for that date.
 */
function validatePlayerSeasonConsistency(fixturesData, playersById, season) {
  const issues = [];
  // Seasons used to work out a youth player's recommended end date: every season in seasons.json if known, else just this one.
  const allSeasons = (typeof LOADED_SEASONS !== 'undefined' && LOADED_SEASONS) ? LOADED_SEASONS : (season ? [season] : []);
  const dmy = d => (d || '').split('-').reverse().join('/');
  const push = (squad, severity, message) => issues.push({ squad, fixtureId: null, fixtureLabel: null, severity, message });
  const endOf = m => m.endDate || m.enddate || m.end_date;
  const windowFor = sq => {
    const dates = ((sq && sq.fixtures) || []).map(f => f.date).filter(Boolean).sort();
    return dates.length ? { firstMs: looseDate(dates[0], false), lastMs: looseDate(dates[dates.length - 1], true) } : null;
  };

  Object.keys(playersById).forEach(pid => {
    const p = playersById[pid];
    const name = p.name || pid;
    const home = normSquad(p.squad);
    const homeLabel = SQUAD_LABEL[home] || home;
    const mv = Array.isArray(p.movements) ? p.movements : [];
    const homeSq = fixturesData[home];
    const homeFixtures = (homeSq && homeSq.fixtures) || [];
    const homeRecs = (homeSq && homeSq.appearances && homeSq.appearances[pid]) || null;

    // Y. In the youth age group (too young for the lowest tracked squad) but named in matchday squads
    //    without any "youth" movement.
    const ys = (typeof TEAM !== 'undefined') ? TEAM.youthSquad : null;
    if (ys && home === normSquad(ys) && !mv.some(m => m.type === 'youth')) {
      const named = [];
      Object.keys(fixturesData).forEach(k => {
        const sq = fixturesData[k] || {};
        const recs = (sq.appearances || {})[pid] || {};
        (sq.fixtures || []).forEach(fx => { const r = recs[fx.id]; if (r && NAMED_STATUSES.has(r.status)) named.push({ k, fx }); });
      });
      // Appearances inside a loan_in / trial_in period are explained by that, not by being a youth player.
      const visitWindows = mv.filter(m => m.type === 'loan_in' || m.type === 'trial_in').map(m => {
        const s = looseDate(m.date, false), e = looseDate(endOf(m), true);
        return { s: s === null ? -Infinity : s, e: e === null ? Infinity : e };
      });
      for (let i = named.length - 1; i >= 0; i--) {
        const d = named[i].fx.date ? looseDate(named[i].fx.date, false) : null;
        if (d !== null && visitWindows.some(w => d >= w.s && d <= w.e)) named.splice(i, 1);
      }
      if (named.length) {
        named.sort((a, b) => (a.fx.date || '').localeCompare(b.fx.date || ''));
        const f = named[0];
        const recMs = lastYouthSeasonEndMs(p, allSeasons);
        const endText = recMs !== null
          ? `enddate = ${dmy(new Date(recMs).toISOString().slice(0, 10))} (the end of the last season they're in the ${homeLabel} age group)`
          : `enddate = the end of the last season they're in the ${homeLabel} age group`;
        push(home, 'error', `${name} is in the ${homeLabel} age group (too young for the lowest squad) but was named in ${named.length} matchday squad${named.length === 1 ? '' : 's'} (first: ${SQUAD_LABEL[f.k] || f.k} v ${f.fx.opponent}, ${dmy(f.fx.date)}), so needs a "youth" movement: date = their first appearance (no later than ${dmy(f.fx.date)}), ${endText}.`);
      }
    }

    // A + H. season-long status
    if (p.status === 'injured_season' || p.status === 'pregnancy_leave' || p.status === 'not_selected_season') {
      const named = homeFixtures.filter(fx => homeRecs && homeRecs[fx.id] && NAMED_STATUSES.has(homeRecs[fx.id].status))
        .sort((a, b) => (a.date || '').localeCompare(b.date || ''));
      if (named.length) {
        push(home, 'error', `${name} is marked "${p.status}" but was named in ${named.length} ${homeLabel} matchday squad${named.length === 1 ? '' : 's'} (first: v ${named[0].opponent}, ${dmy(named[0].date)}).`);
      }
      // An (even empty) entry in the squad's appearances is enough to make them show in the listing.
      const hasEntry = !!(homeSq && homeSq.appearances && Object.prototype.hasOwnProperty.call(homeSq.appearances, pid));
      if (homeFixtures.length && !hasEntry) {
        push(home, 'warning', `${name} is marked "${p.status}" but has no entry in the ${homeLabel} fixtures, so won't appear in its fixture-by-fixture listing — add them to the season's fixtures file.`);
      }
    }

    // F. left during the season but still "active"
    const hw = windowFor(homeSq);
    if (hw && (!p.status || p.status === 'active')) {
      const lv = mv.find(m => {
        const d = isLeavingMovement(m.type) ? looseDate(m.date, true) : null;
        return d !== null && d >= hw.firstMs && d < hw.lastMs;
      });
      if (lv) push(home, 'warning', `${name} ${lv.type === 'retired' ? 'retired' : 'left'} on ${dmy(lv.date)}, during the season, but their season status is "${p.status || 'active'}" (expected "left").`);
    }

    // B. joined late / left early => needs a matching fixture status, squad by squad
    if (mv.length) {
      Object.keys(fixturesData).forEach(k => {
        const sq = fixturesData[k];
        const recs = ((sq && sq.appearances) || {})[pid];
        if (k !== home && (!recs || !Object.keys(recs).length)) return; // only squads they belong to or have guested for
        const w = windowFor(sq);
        if (!w) return;
        const statuses = new Set(Object.values(recs || {}).map(r => r && r.status));
        const lbl = SQUAD_LABEL[k] || k;
        const lateJoin = mv.find(m => {
          const d = m.type === 'joined' ? looseDate(m.date, false) : null;
          if (d === null || !(d > w.firstMs && d <= w.lastMs)) return false;
          // A youth period that began before they joined explains the earlier fixtures — no "incoming" needed.
          return !mv.some(y => y.type === 'youth' && looseDate(y.date, false) !== null && looseDate(y.date, false) <= d);
        });
        if (lateJoin && !statuses.has('incoming')) {
          push(home, 'warning', `${name} joined on ${dmy(lateJoin.date)}, after the first match of the season, but has no "incoming" status on any ${lbl} fixture.`);
        }
        const earlyLeave = mv.find(m => {
          const d = m.type === 'left' ? looseDate(m.date, true) : null;
          return d !== null && d >= w.firstMs && d < w.lastMs;
        });
        if (earlyLeave && !statuses.has('transferred') && !statuses.has('loan')) {
          push(home, 'warning', `${name} left on ${dmy(earlyLeave.date)}, before the last match of the season, but has no "transferred" (or "loan") status on any ${lbl} fixture.`);
        }
      });
    }

    // L. loan_out periods need "loan" statuses on the home squad's fixtures
    if (homeFixtures.length) {
      mv.filter(m => m.type === 'loan_out').forEach(m => {
        const s = looseDate(m.date, false);
        const eRaw = looseDate(endOf(m), true);
        const e = eRaw === null ? Infinity : eRaw;
        if (s === null) return;
        const inLoan = homeFixtures.filter(fx => { const d = fx.date ? looseDate(fx.date, false) : null; return d !== null && d >= s && d <= e; });
        const missing = inLoan.filter(fx => {
          const r = homeRecs && homeRecs[fx.id];
          return !(r && (r.status === 'loan' || NAMED_STATUSES.has(r.status)));
        });
        if (missing.length) {
          push(home, 'warning', `${name} was on loan to ${m.club || 'another club'} (${dmy(m.date)}${endOf(m) ? ' – ' + dmy(endOf(m)) : ''}), but ${missing.length} ${homeLabel} fixture${missing.length === 1 ? '' : 's'} in that period ${missing.length === 1 ? "doesn't" : "don't"} have a "loan" status.`);
        }
      });
    }

    // D. named in two squads on the same date
    const byDate = {};
    Object.keys(fixturesData).forEach(k => {
      const sq = fixturesData[k] || {};
      const recs = (sq.appearances || {})[pid] || {};
      (sq.fixtures || []).forEach(fx => {
        const r = recs[fx.id];
        if (r && NAMED_STATUSES.has(r.status) && fx.date) {
          const day = (byDate[fx.date] = byDate[fx.date] || { names: [], verified: false });
          day.names.push(`${SQUAD_LABEL[k] || k} v ${fx.opponent}`);
          if (r.verified === true) day.verified = true; // you've checked it: "verified": true on either record
        }
      });
    });
    Object.keys(byDate).sort().forEach(d => {
      const day = byDate[d];
      if (day.names.length > 1 && !day.verified) {
        push(home, 'warning', `${name} is named in ${day.names.length} matchday squads on ${dmy(d)}: ${day.names.join('; ')}. If that's correct, add "verified": true to one of those appearance records.`);
      }
    });
  });
  return issues;
}

/**
 * Cross-checks a player's matchday-squad records (start / sub_on / unused_sub) against their
 * `movements` in players-master.json — only for players marked
 * `careerComplete: true`, since only then do the movements describe the whole
 * career. (A loan_out_dual spell — dual registration — is deliberately not
 * treated as a conflict: the player may appear for both clubs.)
 * Flags an appearance that falls (a) inside a loan_out spell, or
 * (b) outside every period he was with the club: joined -> left, plus any
 * loan_in / trial_in window. The "with the club" check only runs if at least
 * one joined / left / loan_in / trial_in movement exists. Dates are inclusive
 * and partial dates ("2024-05") cover the whole month.
 */
// Movement types that end a spell at the club. "retired" counts the same as "left"
// everywhere the checks care about someone no longer being with the club.
const LEAVING_MOVEMENT_TYPES = new Set(['left', 'retired']);
const isLeavingMovement = t => LEAVING_MOVEMENT_TYPES.has(t);

function checkMovementDates(p, fixturesData) {
  const out = [];
  if (!p || !Array.isArray(p.movements) || !p.movements.length) return out;
  // Complete careers, or anyone with a "joined" record (otherwise their movements are too patchy to judge by).
  if (!p.careerComplete && !p.movements.some(m => m.type === 'joined' || m.type === 'youth')) return out;
  const OPEN = '9999-99-99';
  const padEnd = e => (e ? (e.length < 10 ? e + '-99' : e) : OPEN);
  const endOf = m => padEnd(m.endDate || m.enddate || m.end_date);
  const dmy = d => d.split('-').reverse().join('/');

  const allowed = [], loans = [];
  let openFrom = null;
  [...p.movements].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(m => {
    if (m.type === 'joined') { if (openFrom === null) openFrom = m.date || '0000'; }
    else if (isLeavingMovement(m.type)) { allowed.push([openFrom === null ? '0000' : openFrom, padEnd(m.date)]); openFrom = null; }
    else if (m.type === 'loan_in' || m.type === 'trial_in' || m.type === 'youth') allowed.push([m.date || '0000', endOf(m)]);
    else if (m.type === 'loan_out') loans.push({ from: m.date || '0000', to: endOf(m), club: m.club || 'another club' });
    // 'loan_out_dual' (dual registration) is intentionally ignored here: he can still be named for us.
  });
  if (openFrom !== null) allowed.push([openFrom, OPEN]);
  const firstStart = allowed.map(w => w[0]).sort()[0];

  Object.keys(fixturesData || {}).forEach(sk => {
    const sq = fixturesData[sk] || {};
    const recs = (sq.appearances || {})[p.id];
    if (!recs) return;
    const byId = {};
    (sq.fixtures || []).forEach(fx => { byId[fx.id] = fx; });
    Object.keys(recs).forEach(fid => {
      const r = recs[fid], fx = byId[fid];
      if (!r || !NAMED_STATUSES.has(r.status) || !fx || !fx.date) return;
      const d = fx.date;
      const label = `${fmtDate(fx.date)} v ${fx.opponent} (${SQUAD_SHORT[sk] || sk})`;
      const loan = loans.find(l => d >= l.from && d <= l.to);
      const role = r.status === 'start' ? 'started' : r.status === 'sub_on' ? 'came on as a sub' : 'unused sub';
      let why = null;
      if (loan) why = `${p.name} is named in the matchday squad (${role}), but this is during their loan to ${loan.club}.`;
      else if (allowed.length && !allowed.some(w => d >= w[0] && d <= w[1])) {
        why = d < firstStart
          ? `${p.name} is named in the matchday squad (${role}) before they joined the club (${dmy(firstStart)}).${p.movements.some(m => m.type === 'youth') ? '' : ' If they were a youth player then, add a "youth" movement.'}`
          : `${p.name} is named in the matchday squad (${role}) after they left, or between spells at the club.`;
      }
      if (why) out.push({ squad: sk, fixtureId: fx.id, fixtureLabel: label, severity: 'error', message: `${label}: ${why}` });
    });
  });
  return out;
}

/* ------------------------------------------------------------------ *
 * Cross-season checks
 *
 * Unlike validateFixtures (one season at a time), these look at a player's
 * whole history: every season's roster file plus the movements in
 * players-master.json / players-archive.json. The result is the same list
 * whichever season is being viewed, so it shows in all of them.
 * Issues use squad '_cross' (shown under "Across seasons" in the panel).
 * ------------------------------------------------------------------ */

// A season only "requires" a player in its roster file if the player was with
// the club for MORE than this many days of it. Stops a 1 June arrival or a
// 30 June departure from demanding a roster entry in the season that's ending.
const SEASON_OVERLAP_GRACE_DAYS = 45;

// The earliest date this team has data from (TEAM.dataFrom in teams.js) as ms, or null if not set.
// Nothing before it is ever expected to have data, so player-level checks ignore earlier seasons.
function dataCutoffMs() {
  if (typeof TEAM !== 'undefined' && TEAM.dataFrom) return looseDate(TEAM.dataFrom, false); // explicit override
  // Otherwise the data starts where the oldest season in seasons.json starts.
  if (typeof LOADED_SEASONS !== 'undefined' && LOADED_SEASONS) {
    const starts = LOADED_SEASONS.map(s => seasonRange(s)).filter(Boolean).map(r => r.start);
    if (starts.length) return Math.min(...starts);
  }
  return null;
}

// The football season that cut-off falls in, e.g. "2023/24" ('' if no cut-off).
function dataCutoffLabel() {
  const ms = dataCutoffMs();
  if (ms === null) return '';
  const d = new Date(ms);
  const y = d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `${y}/${String(y + 1).slice(2)}`;
}

// True if the player's (earliest) "joined" date is before the data cut-off, i.e. part of their career predates the data.
function joinedBeforeCutoff(p) {
  const cut = dataCutoffMs();
  if (cut === null) return false;
  const joined = (p.movements || []).filter(m => m.type === 'joined').map(m => looseDate(m.date, false)).filter(x => x !== null);
  return joined.length > 0 && Math.min(...joined) < cut;
}

/**
 * The "season looks complete" nudge. A season in seasons.json can carry "dataComplete": true (you've
 * finished entering its data) or false (still in progress). If it isn't true, every fixture in every
 * squad has a result, and there are no errors anywhere in the checks, returns an issue asking you to
 * set it to true. Returns null otherwise. `issues` = the full list so far.
 */
function seasonCompleteIssue(season, fixtures, issues) {
  if (!season || season.dataComplete === true) return null;
  let total = 0, allHaveResults = true;
  Object.keys(fixtures || {}).forEach(k => {
    ((fixtures[k] && fixtures[k].fixtures) || []).forEach(fx => {
      total += 1;
      if (!fx.result || !String(fx.result).trim()) allHaveResults = false;
    });
  });
  if (!total || !allHaveResults || issues.some(i => i.severity === 'error')) return null;
  return {
    squad: '_general', fixtureId: null, fixtureLabel: null, severity: 'warning', ignoreInBanner: true,
    message: `Season ${season.label || season.id}: every fixture has a result and there are no errors, so it looks complete. Set "dataComplete": true for this season in seasons.json.`,
  };
}

// "2024-05-20" -> that day; "2024-05" -> 1st (or last, asEnd) of the month; "2024" -> 1 Jan (or 31 Dec). Returns ms (UTC) or null.
function looseDate(s, asEnd) {
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$/.exec((s || '').trim());
  if (!m) return null;
  const y = +m[1];
  if (m[3]) return Date.UTC(y, +m[2] - 1, +m[3]);
  if (m[2]) return asEnd ? Date.UTC(y, +m[2], 0) : Date.UTC(y, +m[2] - 1, 1);
  return asEnd ? Date.UTC(y, 11, 31) : Date.UTC(y, 0, 1);
}

// Football season "2025-26" runs 1 Jul 2025 – 30 Jun 2026 (same convention as seasonAgeDate). null if the id isn't in that shape.
function seasonRange(season) {
  if (!season) return null;
  const m = /^(\d{4})-\d{2}$/.exec(season.id || '');
  // Explicit "startDate" / "endDate" (YYYY-MM-DD) in seasons.json win; whichever is missing falls back to 1 Jul / 30 Jun from the id.
  const explicit = (s, asEnd) => (typeof s === 'string' && validDateStr(s, false)) ? looseDate(s, asEnd) : null;
  const start = explicit(season.startDate, false) ?? (m ? Date.UTC(+m[1], 6, 1) : null);
  const end = explicit(season.endDate, true) ?? (m ? Date.UTC(+m[1] + 1, 5, 30) : null);
  return (start !== null && end !== null && start < end) ? { start, end } : null;
}

// True if, for this season, the player's age band (from their dob and the season's ageBands in seasons.json)
// is a squad the site doesn't track — e.g. the U16s. Such a player is never expected to be on that
// season's player file, so the cross-season checks leave that season out for them. Only meaningful
// for a player who ISN'T on the season's roster (a roster entry means they're tracked that season).
// No ageBands = everyone is treated as tracked.
function untrackedSquadIn(p, season) {
  const bands = season && season.ageBands;
  if (!bands || !bands.length) return false;
  const squad = p.dob ? ageBandForDob(p.dob, bands) : (p.squadIfDobUnknown || DEFAULT_UNKNOWN_DOB_SQUAD);
  const key = normSquad(squad);
  return !(CORE_SQUADS.includes(key) || OPTIONAL_SQUADS.includes(key));
}

// First football-season start (1 July) on or after a date (ms).
function nextSeasonStart(ms) {
  const y = new Date(ms).getUTCFullYear();
  const s = Date.UTC(y, 6, 1);
  return s >= ms ? s : Date.UTC(y + 1, 6, 1);
}

// First season a player counts as "there from the start" of: the first season starting on or after
// (their joined date minus SEASON_OVERLAP_GRACE_DAYS). So joining 13 Jul 2023 still counts as being in
// 2023/24 (it started 1 Jul), while joining 1 Jan 2025 makes 2025/26 their first full season.
function firstFullSeasonStart(joinedMs) {
  return nextSeasonStart(joinedMs - SEASON_OVERLAP_GRACE_DAYS * 86400000);
}

// joined -> left periods from a player's movements (a joined with no later left stays open-ended).
function clubSpells(movements) {
  const spells = [];
  let open = null;
  [...movements].sort((a, b) => (a.date || '').localeCompare(b.date || '')).forEach(m => {
    if (m.type === 'joined') {
      if (open === null) { const d = looseDate(m.date, false); open = d === null ? -Infinity : d; }
    } else if (isLeavingMovement(m.type) && open !== null) {
      const d = looseDate(m.date, true);
      spells.push({ from: open, to: d === null ? Infinity : d, leftDate: m.date, leftType: m.type });
      open = null;
    }
  });
  if (open !== null) spells.push({ from: open, to: Infinity, leftDate: '' });
  return spells;
}

// The photo a player would show in a given season (roster photoSource applied), as { url, label }.
function effectivePhoto(p) {
  const url = photoCandidates(p)[0];
  if (!url) return { url: '', label: 'no photo' };
  let label = 'default';
  const photos = p.photos;
  if (photos && typeof photos === 'object' && !Array.isArray(photos)) {
    label = Object.keys(photos).find(k => photos[k] === url)
      || Object.keys(SHARED_PHOTO_SOURCES).find(k => SHARED_PHOTO_SOURCES[k] === url) || 'default';
  }
  return { url, label };
}

/**
 * masterList  – active master (+archive) player list, as loaded by withArchive.
 * seasonData  – [{ season, roster (array or null if it failed to load), master (array or null) }],
 *               in seasons.json order (first entry = latest season).
 *
 * Checks (errors unless noted):
 *  1. Photo — a player must show the same photo in every season they're on a roster (warning).
 *  2. Movements — anyone with movements (or marked careerComplete) needs a "joined" record.
 *  3. Movements — anyone not on the latest season's roster needs a "left" (or "retired") record.
 *  4. Roster — a player must be on the roster file of every season between joined and left.
 *  (For careerComplete players, 2-4 also cover: joined before the earliest season file, and a missing "left" even if they're on no roster at all.)
 *  4b. Roster — a player must NOT be on the roster file of a season that starts after they left (or retired).
 *  4c. careerComplete — a player NOT marked careerComplete, but who is on the roster of every season that started after
 *      they joined (or after the data cut-off, if later) and before they left (or up to the latest season, if still here),
 *      where each of those seasons is marked "dataComplete": true in seasons.json, should be marked careerComplete (warning).
 *  A season in which the player's age band (per that season's ageBands in seasons.json) is an untracked squad such as
 *  U16 is left out of checks 3, 4 and 4c for that player.
 *  Seasons before the team's data cut-off (TEAM.dataFrom in teams.js) are never expected to have data.
 *  6. Movements — a movement's end date can't be before its start date.
 *  5. Archive — a player who has left and is careerComplete belongs in players-archive.json, not players-master.json (warning).
 * Players whose only movements are loan_in / trial_in (visitors who never joined) are exempt from 2–4.
 */
function validateAcrossSeasons(masterList, seasonData) {
  const issues = [];
  const add = (severity, message) => issues.push({ squad: '_cross', fixtureId: null, fixtureLabel: null, severity, crossSeason: true, message });
  const dmy = d => (d || '').split('-').reverse().join('/');
  const label = s => s.label || s.id;
  const usable = seasonData.filter(sd => sd.roster);
  if (!usable.length) return issues;

  const rosterIdx = seasonData.map(sd => {
    const byId = {};
    (sd.roster || []).forEach(r => { byId[r.id] = r; });
    return byId;
  });
  const masterIdx = seasonData.map(sd => {
    const byId = {};
    (sd.master || []).forEach(m => { byId[m.id] = m; });
    return byId;
  });
  const latest = seasonData[0];
  const cutoff = dataCutoffMs(); // null = no cut-off configured
  const DAY = 86400000;
  const endOf = m => m.endDate || m.enddate || m.end_date;
  const nameOf = id => ((seasonData.map(sd => (sd.master || []).find(m => m.id === id)).find(Boolean)) || {}).name || id;

  const byYear = {}; // season start year -> { sd, i, range }
  seasonData.forEach((sd, i) => { const r = seasonRange(sd.season); if (r) byYear[new Date(r.start).getUTCFullYear()] = { sd, i, range: r }; });
  const maxYear = Object.keys(byYear).length ? Math.max(...Object.keys(byYear).map(Number)) : null;
  const seasonYearOf = ms => { const d = new Date(ms); return d.getUTCMonth() >= 6 ? d.getUTCFullYear() : d.getUTCFullYear() - 1; };

  // Suggest careerComplete for a player who isn't marked yet. Every season they were with the club
  // — permanent spells (from their first full season) and any loan_in / trial_in period (any overlap
  // counts) — must be a season file that lists them and is marked dataComplete. Anything starting
  // before the data cut-off means part of their career predates the data, so never suggested.
  function suggestCareerComplete(p, mv) {
    if (p.careerComplete || maxYear === null) return;
    // A youth spell on its own isn't a full career with the club. Once they've joined, the usual rules apply
    // (the youth period is ignored here: only the joined -> left spell(s) decide which seasons are required).
    if (mv.some(m => m.type === 'youth') && !mv.some(m => m.type === 'joined')) return;
    const spells = clubSpells(mv);
    const visits = mv.filter(m => m.type === 'loan_in' || m.type === 'trial_in').map(m => {
      const s = looseDate(m.date, false), e = looseDate(endOf(m), true);
      return { from: s === null ? -Infinity : s, to: e === null ? Infinity : e };
    });
    if (!spells.length && !visits.length) return;
    const firstStart = Math.min(...spells.map(s => s.from), ...visits.map(v => v.from));
    if (!isFinite(firstStart)) return; // a start date is unknown
    // Anything before the data starts means there may be appearances that aren't recorded, so the career
    // can't be called complete (with a little slack, SEASON_OVERLAP_GRACE_DAYS, for an arrival just before).
    const dataStart = cutoff !== null ? cutoff : Math.min(...Object.values(byYear).map(s => s.range.start));
    if (firstStart < dataStart - SEASON_OVERLAP_GRACE_DAYS * DAY) return;

    // Every season they were with the club needs a season file: permanent spells need more than the grace
    // period of overlap with the season, loan-in / trial periods any overlap at all.
    const lastEnd = Math.max(...spells.map(s => s.to), ...visits.map(v => v.to));
    const required = [];
    for (let y = seasonYearOf(Math.max(firstStart, dataStart)); y <= maxYear; y++) {
      const rng = byYear[y] ? byYear[y].range : { start: Date.UTC(y, 6, 1), end: Date.UTC(y + 1, 5, 30) };
      if (rng.start > lastEnd) break;
      const a = rng.start, b = rng.end;
      const days = (from, to) => (Math.min(to, b) - Math.max(from, a)) / DAY + 1;
      if (spells.some(sp => days(sp.from, sp.to) > SEASON_OVERLAP_GRACE_DAYS) || visits.some(v => days(v.from, v.to) > 0)) required.push(y);
    }
    if (!required.length) return;

    const need = [];
    let ok = true;
    required.forEach(y => {
      const s = byYear[y];
      if (!s || !s.sd.roster) { ok = false; return; }
      if (!rosterIdx[s.i][p.id]) { if (!untrackedSquadIn(p, s.sd.season)) ok = false; return; } // untracked age group: not applicable
      if (s.sd.season.dataComplete !== true) { ok = false; return; }
      need.push(label(s.sd.season));
    });
    if (ok && need.length) {
      add('warning', `${p.name || p.id} is on the season file for every season they were with the club (${need.join(', ')}), all marked dataComplete, so careerComplete can be set to true.`);
    }
  }

  masterList.forEach(p => {
    const name = p.name || p.id;

    // 1. Photo consistency
    const groups = []; // { url, label, seasons[] }
    seasonData.forEach((sd, i) => {
      const entry = rosterIdx[i][p.id];
      if (!entry) return;
      const ph = effectivePhoto({ ...(masterIdx[i][p.id] || p), ...entry });
      let g = groups.find(x => x.url === ph.url);
      if (!g) { g = { url: ph.url, label: ph.label, seasons: [] }; groups.push(g); }
      g.seasons.push(label(sd.season));
    });
    if (groups.length > 1) {
      add('warning', `${name} uses different photos in different seasons: ${groups.map(g => `${g.label} (${g.seasons.join(', ')})`).join(' vs ')}. Use the same photoSource in every season file.`);
    }

    // 2-5. Movements
    const mv = Array.isArray(p.movements) ? p.movements : [];

    // 6. A movement's end date can't be before its start date (e.g. a loan that "ends" before it begins).
    mv.forEach(m => {
      const endRaw = m.endDate || m.enddate || m.end_date;
      const s = looseDate(m.date, false), e = looseDate(endRaw, true);
      if (s !== null && e !== null && e < s) {
        add('error', `${name} has a ${m.type || 'movement'}${m.club ? ' (' + m.club + ')' : ''} that ends (${dmy(endRaw)}) before it starts (${dmy(m.date)}).`);
      }
    });

    // Movement types, dates and sequence
    mv.forEach(m => {
      if (!KNOWN_MOVEMENT_TYPES.has(m.type)) {
        add('error', `${name} has a movement with an unrecognised type "${m.type}" (expected one of: ${[...KNOWN_MOVEMENT_TYPES].join(', ')}).`);
      }
      if (!validDateStr(m.date, true)) {
        add('error', `${name} has a ${m.type || 'movement'}${m.club ? ' (' + m.club + ')' : ''} with ${m.date ? `an invalid date "${m.date}"` : 'no date'}.`);
      }
      if (endOf(m) && !validDateStr(endOf(m), true)) {
        add('error', `${name} has a ${m.type || 'movement'}${m.club ? ' (' + m.club + ')' : ''} with an invalid end date "${endOf(m)}".`);
      }
      if (['loan_out', 'loan_out_dual', 'loan_in', 'trial_in'].includes(m.type) && !m.club) {
        add('warning', `${name} has a ${m.type} movement (${dmy(m.date) || 'no date'}) with no club.`);
      }
    });
    {
      const seq = mv.filter(m => (m.type === 'joined' || isLeavingMovement(m.type)) && validDateStr(m.date, true))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '') || ((a.type === 'joined' ? 0 : 1) - (b.type === 'joined' ? 0 : 1)));
      const hasJoin = seq.some(x => x.type === 'joined');
      let inClub = false, seenJoin = false;
      seq.forEach(m => {
        if (m.type === 'joined') {
          if (inClub) add('error', `${name} has a second "joined" movement (${dmy(m.date)}) with no "left" before it.`);
          inClub = true; seenJoin = true;
        } else {
          if (!seenJoin && hasJoin) add('error', `${name} has a "${m.type}" movement (${dmy(m.date)}) before they first joined.`);
          else if (!inClub && seenJoin) add('error', `${name} has a "${m.type}" movement (${dmy(m.date)}) when they'd already left.`);
          inClub = false;
        }
      });
      ['loan_out', 'loan_in', 'youth'].forEach(type => {
        const ws = mv.filter(m => m.type === type && validDateStr(m.date, true))
          .map(m => { const e = looseDate(endOf(m), true); return { m, s: looseDate(m.date, false), e: e === null ? Infinity : e }; })
          .sort((a, b) => a.s - b.s);
        let maxE = -Infinity;
        ws.forEach((x, i) => {
          if (i && x.s <= maxE) {
            const pv = ws[i - 1];
            const fmt = w => `${w.m.club || 'unknown club'} ${dmy(w.m.date)}${endOf(w.m) ? '–' + dmy(endOf(w.m)) : ' onwards'}`;
            add('error', `${name} has overlapping ${type === 'loan_out' ? 'loans' : type === 'loan_in' ? 'loan-in periods' : 'youth periods'}: ${fmt(pv)} and ${fmt(x)}.`);
          }
          maxE = Math.max(maxE, x.e);
        });
      });
    }

    // photoSource that doesn't match any photo, and photo entries with no URL
    {
      const photos = p.photos;
      const isLegacy = Array.isArray(photos) || (!photos && p.photo);
      const keys = new Set(Object.keys(SHARED_PHOTO_SOURCES));
      if (photos && typeof photos === 'object' && !Array.isArray(photos)) {
        Object.keys(photos).forEach(k => { if (photos[k]) keys.add(k); else add('warning', `${name} has a "${k}" photo entry with no URL.`); });
      }
      if (!isLegacy) {
        const bad = [];
        if (p.photoSource && !keys.has(p.photoSource)) bad.push(`"${p.photoSource}" (players-master.json)`);
        seasonData.forEach((sd, i) => {
          const e = rosterIdx[i][p.id];
          if (e && e.photoSource && !keys.has(e.photoSource)) bad.push(`"${e.photoSource}" (${label(sd.season)})`);
        });
        if (bad.length) add('warning', `${name} has a photoSource that doesn't match any of their photos — ${bad.join(', ')}. Available: ${[...keys].join(', ')}.`);
      }
    }

    // Date of birth: valid, not in the future, plausible age on each season file they're on
    if (p.dob) {
      if (!validDateStr(p.dob, false)) {
        add('error', `${name} has an invalid dob "${p.dob}" (expected YYYY-MM-DD).`);
      } else {
        const d = looseDate(p.dob, false);
        if (d > Date.now()) {
          add('error', `${name}'s dob (${dmy(p.dob)}) is in the future.`);
        } else {
          const odd = [];
          seasonData.forEach((sd, i) => {
            const r = seasonRange(sd.season);
            if (!r || !rosterIdx[i][p.id]) return;
            const age = (r.start - d) / (365.25 * DAY);
            if (age < MIN_PLAUSIBLE_AGE || age > MAX_PLAUSIBLE_AGE) odd.push(`${label(sd.season)}: ${Math.floor(age)}`);
          });
          if (odd.length) add('warning', `${name} (dob ${dmy(p.dob)}) would be an implausible age on the season file${odd.length === 1 ? '' : 's'} for ${odd.join(', ')}. Check the dob.`);
        }
      }
    }

    // Youth periods: end date within the last season they're in the youth age group, scholarship date
    // passed with nothing following, and overlap with "joined". (Youth players needn't be on a season file —
    // those only cover the tracked squads; if they were named in a tracked squad, the fixtures' own
    // "logged but not in players.json" check asks for a roster entry.)
    {
      const youths = mv.filter(m => m.type === 'youth');
      if (youths.length) {
        const ys = (typeof TEAM !== 'undefined') ? TEAM.youthSquad : null;
        const ysLabel = ys ? (SQUAD_LABEL[ys] || ys) : 'youth';
        const recMs = ys ? lastYouthSeasonEndMs(p, seasonData.map(sd => sd.season)) : null;
        const recStr = recMs !== null ? new Date(recMs).toISOString().slice(0, 10) : null;
        let overlapFlagged = false;
        youths.forEach(m => {
          const endRaw = endOf(m);
          const startMs = looseDate(m.date, false);
          if (!endRaw) {
            add('warning', recStr
              ? `${name} has an open-ended youth period — set its enddate to ${dmy(recStr)} (the end of the last season they're in the ${ysLabel} age group).`
              : `${name} has an open-ended youth period — set its enddate (the end of the last season they're in the youth age group).`);
            return;
          }
          if (!validDateStr(endRaw, true)) return; // reported above
          const endMs = looseDate(endRaw, true);
          if (recMs !== null && endMs > recMs) {
            add('error', `${name}'s youth period ends ${dmy(endRaw)}, after the last season they're in the ${ysLabel} age group — it should be no later than ${dmy(recStr)}.`);
          }
          // Once a youth period has ended (its end date is before today) there must be a "joined" or
          // "left"/"retired" record dated on or after that end date, saying what happened next.
          const concluded = mv.some(x => {
            if (x.type !== 'joined' && !isLeavingMovement(x.type)) return false;
            const xs = looseDate(x.date, false);
            return xs !== null && xs >= endMs;
          });
          if (endMs < Date.now() && !concluded) {
            add('error', `${name}'s youth period ended ${dmy(endRaw)} but there is no "joined" or "left" record on or after that date — add one.`);
          }
          const early = mv.find(x => { const xs = x.type === 'joined' ? looseDate(x.date, false) : null; return xs !== null && xs <= endMs; });
          if (early && !overlapFlagged) {
            overlapFlagged = true;
            add('warning', `${name} has a "joined" date (${dmy(early.date)}) on or before the end of their youth period (${dmy(endRaw)}) — shorten the youth enddate, or check the dates.`);
          }
        });
      }
    }

    // 5. Which player file a player belongs in. "Gone" = the most recent joined/left/retired movement is a
    // leaving one whose date has passed (or has no usable date), or — for a loan-in / trial player who
    // never joined — every such spell has an end date that has passed.
    //   current                      -> players-master.json
    //   gone, careerComplete         -> players-archive.json (finished; never touched again)
    //   gone, not careerComplete     -> players-former.json  (gone, but still needs data entering)
    if (!p._archived && mv.length) {
      const last = [...mv].filter(m => m.type === 'joined' || isLeavingMovement(m.type))
        .sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
      const leftMs = last && isLeavingMovement(last.type) ? looseDate(last.date, true) : undefined;
      let subject = null; // e.g. "Name has left (01/07/2024)"
      if (last && isLeavingMovement(last.type) && (leftMs === null || leftMs <= Date.now())) {
        subject = `${name} has left${last.date ? ' (' + dmy(last.date) + ')' : ''}`;
      } else if (!mv.some(m => m.type === 'joined')) {
        const visits = mv.filter(m => m.type === 'loan_in' || m.type === 'trial_in');
        if (visits.length && visits.every(m => { const e = looseDate(endOf(m), true); return e !== null && e <= Date.now(); })) {
          const lastEnd = visits.map(endOf).sort().pop();
          subject = `${name}'s ${visits.length > 1 ? 'loan/trial spells' : visits[0].type === 'trial_in' ? 'trial' : 'loan'} ended (${dmy(lastEnd)})`;
        }
      }
      const here = p._former ? 'players-former.json' : 'players-master.json';
      if (subject && p.careerComplete && !p._alsoInArchive) {
        add('warning', `${subject} and careerComplete is set, so should be moved from ${here} to players-archive.json.`);
      } else if (subject && !p.careerComplete && !p._former && !p._alsoInFormer) {
        add('warning', `${subject} but careerComplete isn't set yet, so should be moved from players-master.json to players-former.json (players who have gone but still need data entering).`);
      } else if (!subject && p._former) {
        add('warning', `${name} is in players-former.json but hasn't left the club (no leaving movement dated in the past) — move them back to players-master.json.`);
      }
    }
    // Every player needs at least one movement saying how they came to the club: "joined", "loan_in",
    // "trial_in" or "youth". With none at all, flag it and skip the rest (nothing else can be checked).
    // (Players who have movements but none of these are caught by the "no joined movement" error below.)
    if (!mv.length && !p.careerComplete) {
      add('error', `${name} has no movements in players-master.json — add a "joined" (or "loan_in", "trial_in" or "youth") movement.`);
      return;
    }
    const has = t => mv.some(m => m.type === t);
    const hasLeft = mv.some(m => isLeavingMovement(m.type));
    if (!has('joined') && (has('loan_in') || has('trial_in') || has('youth'))) { suggestCareerComplete(p, mv); return; } // visitor / youth player, never joined

    if (!has('joined')) {
      add('error', `${name} has no "joined" movement in players-master.json${mv.length ? '' : ' (marked careerComplete but has no movements at all)'}.`);
    }

    const inAnyRoster = seasonData.some((sd, i) => rosterIdx[i][p.id]);
    if (latest.roster && (inAnyRoster || p.careerComplete) && !rosterIdx[0][p.id] && !hasLeft && !untrackedSquadIn(p, latest.season)) {
      add('error', `${name} isn't in the ${label(latest.season)} season file, so needs a "left" (or "retired") movement in players-master.json.`);
    }

    const spells = clubSpells(mv);
    if (spells.length && p.careerComplete) {
      // careerComplete means every season is in the data, so a whole season (one starting after they
      // joined) can't fall before the earliest season file. A part-season on arrival doesn't count.
      const starts = seasonData.map(sd => seasonRange(sd.season)).filter(Boolean).map(r => r.start);
      const earliest = starts.length ? Math.min(...starts) : null;
      let from = Math.min(...spells.map(sp => sp.from));
      if (cutoff !== null) from = Math.max(from, cutoff); // earlier history is outside the data, by design (the player page says so)
      if (earliest !== null && isFinite(from) && firstFullSeasonStart(from) < earliest) {
        const eSeason = seasonData.filter(sd => seasonRange(sd.season) && seasonRange(sd.season).start === earliest)[0].season;
        add('error', `${name} is marked careerComplete but joined ${dmy(mv.filter(m => m.type === 'joined').map(m => m.date).sort()[0])}, before the earliest season file (${label(eSeason)}), so the earlier seasons have no data.`);
      }
    }
    if (spells.length) {
      const missing = [];
      seasonData.forEach((sd, i) => {
        const range = seasonRange(sd.season);
        if (!sd.roster || !range || rosterIdx[i][p.id]) return;
        if (cutoff !== null && range.start < cutoff) return; // before the data cut-off
        if (untrackedSquadIn(p, sd.season)) return; // in an untracked age group (e.g. U16s) that season
        const covered = spells.some(sp => {
          const days = (Math.min(sp.to, range.end) - Math.max(sp.from, range.start)) / 86400000 + 1;
          return days > SEASON_OVERLAP_GRACE_DAYS;
        });
        if (covered) missing.push(label(sd.season));
      });
      if (missing.length) {
        const first = mv.filter(m => m.type === 'joined').map(m => m.date).sort()[0];
        add('error', `${name} is missing from the season file${missing.length === 1 ? '' : 's'} for ${missing.join(', ')}, but was with the club then (joined ${dmy(first) || 'date unknown'}${spells[spells.length - 1].leftDate ? ', left ' + dmy(spells[spells.length - 1].leftDate) : ''}).`);
      }
    }

    // 4b. On a season file after they left. Intervals = joined->left spells (or, with no
    // "joined" at all, everything up to their leaving date). A season with no more than
    // SEASON_OVERLAP_GRACE_DAYS of overlap, that starts after an interval ended, is one they shouldn't be in.
    {
      const intervals = spells.map(sp => ({ to: sp.to, from: sp.from, date: sp.leftDate, type: sp.leftType, ended: isFinite(sp.to) }));
      if (!has('joined')) {
        const lv = mv.filter(m => isLeavingMovement(m.type)).sort((a, b) => (a.date || '').localeCompare(b.date || '')).pop();
        const to = lv ? looseDate(lv.date, true) : null;
        if (lv && to !== null) intervals.push({ from: -Infinity, to, date: lv.date, type: lv.type, ended: true });
      }
      const after = []; let leftInfo = null;
      seasonData.forEach((sd, i) => {
        const range = seasonRange(sd.season);
        if (!sd.roster || !range || !rosterIdx[i][p.id]) return;
        const overlaps = iv => (Math.min(iv.to, range.end) - Math.max(iv.from, range.start)) / 86400000 + 1;
        if (intervals.some(iv => overlaps(iv) > SEASON_OVERLAP_GRACE_DAYS)) return; // with the club for this season
        const ended = intervals.filter(iv => iv.ended && iv.to < range.start + SEASON_OVERLAP_GRACE_DAYS * 86400000);
        if (!ended.length) return; // not left yet (or hasn't joined yet — a different problem)
        after.push(label(sd.season));
        if (!leftInfo) leftInfo = ended.sort((a, b) => b.to - a.to)[0];
      });
      if (after.length) {
        add('error', `${name} is in the ${after.join(', ')} season file${after.length === 1 ? '' : 's'} but ${leftInfo.type === 'retired' ? 'retired' : 'left the club'} on ${dmy(leftInfo.date)}.`);
      }
    }

    // 4c. Suggest careerComplete (see suggestCareerComplete above).
    suggestCareerComplete(p, mv);
  });

  // ---- seasons.json: start / end dates ----
  {
    const ranges = [];
    seasonData.forEach(sd => {
      const s = sd.season, name = `Season ${label(s)}`;
      ['startDate', 'endDate'].forEach(f => {
        if (s[f] !== undefined && !validDateStr(s[f], false)) add('error', `${name} has an invalid ${f} "${s[f]}" in seasons.json (expected YYYY-MM-DD).`);
      });
      const hasBoth = validDateStr(s.startDate || '', false) && validDateStr(s.endDate || '', false);
      if (hasBoth && looseDate(s.startDate, false) >= looseDate(s.endDate, true)) add('error', `${name}'s startDate (${dmy(s.startDate)}) isn't before its endDate (${dmy(s.endDate)}).`);
      const r = seasonRange(s);
      if (r) ranges.push({ name, r });
    });
    ranges.sort((a, b) => a.r.start - b.r.start).forEach((x, i, arr) => {
      if (i && x.r.start <= arr[i - 1].r.end) add('error', `${x.name} overlaps ${arr[i - 1].name} in seasons.json — check the start / end dates.`);
    });
  }

  // ---- Season roster files (one season at a time) ----
  seasonData.forEach(sd => {
    if (!sd.roster) return;
    const season = label(sd.season);

    // Same player listed twice in one roster file
    const seen = {}, dup = new Set();
    sd.roster.forEach(r => { if (!r || !r.id) return; if (seen[r.id]) dup.add(r.id); seen[r.id] = true; });
    dup.forEach(id => add('error', `${nameOf(id)} is listed more than once in the ${season} season file.`));

    // Shirt numbers: duplicates within a squad, and missing numbers in the First Team
    let merged = [];
    try { merged = mergePlayers(sd.master || [], sd.roster, sd.season.ageBands || []); } catch (e) { merged = []; }
    { const seenIds = new Set(); merged = merged.filter(p => !seenIds.has(p.id) && seenIds.add(p.id)); } // one entry per player
    const current = s => !s || s === 'active' || s === 'injured_season' || s === 'pregnancy_leave' || s === 'not_selected_season' || s === 'trialist';
    const bySquad = {};
    merged.filter(p => current(p.status)).forEach(p => { const k = normSquad(p.squad); (bySquad[k] = bySquad[k] || []).push(p); });
    Object.keys(bySquad).forEach(k => {
      if (!(CORE_SQUADS.includes(k) || OPTIONAL_SQUADS.includes(k))) return; // untracked age groups
      const byNum = {}, none = [];
      bySquad[k].forEach(p => {
        const n = p.number;
        const ns = (n === undefined || n === null) ? '' : String(n).trim();
        if (ns === '') none.push(p.name || p.id);
        else if (ns !== '0') (byNum[ns] = byNum[ns] || []).push(p.name || p.id); // 0 = deliberately unallocated: never a duplicate or "missing"
      });
      Object.keys(byNum).forEach(n => {
        if (byNum[n].length > 1) add('warning', `Shirt number ${n} is used by ${byNum[n].join(' and ')} in the ${SQUAD_LABEL[k] || k} (${season} season file).`);
      });
      if (k === 'senior' && none.length) {
        add('warning', `${none.length} First Team player${none.length === 1 ? ' has' : 's have'} no shirt number in the ${season} season file: ${none.slice(0, 6).join(', ')}${none.length > 6 ? ` and ${none.length - 6} more` : ''}.`);
      }
    });
  });

  // ---- Orphans: master players on no season file; archived players on the latest one ----
  if (seasonData.every(sd => sd.roster)) {
    masterList.forEach(p => {
      const inAny = seasonData.some((sd, i) => rosterIdx[i][p.id]);
      const youthOnly = !(p.movements || []).some(m => m.type === 'joined') && (p.movements || []).some(m => m.type === 'youth');
      if (!p._archived && !inAny && !youthOnly) add('warning', `${p.name || p.id} is in ${p._former ? 'players-former.json' : 'players-master.json'} but isn't on any season file.`);
      if (p._archived && rosterIdx[0][p.id]) add('warning', `${p.name || p.id} is in players-archive.json but is on the latest season file (${label(latest.season)}) — move them back to players-master.json.`);
    });
  }

  return issues;
}

// Movement types the site understands (see MOVE_TYPES in player.js). Anything else is probably a typo.
const KNOWN_MOVEMENT_TYPES = new Set(['joined', 'left', 'retired', 'loan_out', 'loan_out_dual', 'loan_in', 'trial_in', 'youth']);

// Ages outside this range on a season file are flagged as a probable dob mistake.
const MIN_PLAUSIBLE_AGE = 13;
const MAX_PLAUSIBLE_AGE = 45;

// "YYYY-MM-DD" (or, if allowPartial, "YYYY-MM" / "YYYY") that is a real calendar date.
function validDateStr(s, allowPartial) {
  if (typeof s !== 'string') return false;
  const m = /^(\d{4})(?:-(\d{2})(?:-(\d{2}))?)?$/.exec(s.trim());
  if (!m) return false;
  if (!allowPartial && !m[3]) return false;
  if (m[2] && (+m[2] < 1 || +m[2] > 12)) return false;
  if (m[3]) {
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    if (d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3]) return false;
  }
  return true;
}

/**
 * The reverse of seasonCompleteIssue: a season marked "dataComplete": true that still has fixtures with
 * no result, or any errors in the checks. Returns an issue (warning) or null.
 */
function seasonStaleCompleteIssue(season, fixtures, issues) {
  if (!season || season.dataComplete !== true) return null;
  let noResult = 0;
  Object.keys(fixtures || {}).forEach(k => {
    ((fixtures[k] && fixtures[k].fixtures) || []).forEach(fx => { if (!fx.result || !String(fx.result).trim()) noResult += 1; });
  });
  const errors = issues.filter(i => i.severity === 'error').length;
  if (!noResult && !errors) return null;
  const parts = [];
  if (noResult) parts.push(`${noResult} fixture${noResult === 1 ? ' has' : 's have'} no result`);
  if (errors) parts.push(`there ${errors === 1 ? 'is 1 error' : 'are ' + errors + ' errors'}`);
  return { squad: '_general', fixtureId: null, fixtureLabel: null, severity: 'warning',
    message: `Season ${season.label || season.id} is marked "dataComplete": true, but ${parts.join(' and ')}. Fix them, or set it back to false.` };
}

// Adds `k` years to a "YYYY-MM-DD" (or partial) date string.
function addYearsStr(dateStr, k) {
  const [y, ...rest] = dateStr.split('-');
  return [String(+y + k).padStart(4, '0'), ...rest].join('-');
}

/**
 * The end (30 June, as ms) of the last football season in which the player is in the team's youth age
 * group (TEAM.youthSquad), judged from their dob and the seasons' ageBands. Bands move forward a year each
 * season, so for the latest season in seasons.json the bands are projected forward as far as needed.
 * `seasonsNewestFirst` = the season objects from seasons.json. Returns null if it can't be worked out
 * (no dob, no youthSquad, no ageBands, or they were never in the youth group).
 */
function lastYouthSeasonEndMs(p, seasonsNewestFirst) {
  const ys = (typeof TEAM !== 'undefined') ? TEAM.youthSquad : null;
  if (!ys || !p.dob || !validDateStr(p.dob, false)) return null;
  const banded = seasonsNewestFirst.filter(s => s && s.ageBands && s.ageBands.length && seasonRange(s));
  if (!banded.length) return null;
  const latest = banded[0];
  if (ageBandForDob(p.dob, latest.ageBands) === ys) {
    const shifted = k => latest.ageBands.map(b => ({
      ...b,
      bornOnOrAfter: b.bornOnOrAfter ? addYearsStr(b.bornOnOrAfter, k) : b.bornOnOrAfter,
      bornBefore: b.bornBefore ? addYearsStr(b.bornBefore, k) : b.bornBefore,
    }));
    let k = 1;
    while (k <= 10 && ageBandForDob(p.dob, shifted(k)) === ys) k++;
    // Projected seasons keep the latest season's end day, a year later each time.
    const end = new Date(seasonRange(latest).end);
    end.setUTCFullYear(end.getUTCFullYear() + (k - 1));
    return end.getTime();
  }
  const wasYouth = banded.filter(s => ageBandForDob(p.dob, s.ageBands) === ys);
  return wasYouth.length ? seasonRange(wasYouth[0]).end : null;
}