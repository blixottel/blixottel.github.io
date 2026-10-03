/**
 * validation.js — the standalone "Data checks" page. Loads the same data as
 * the squad tracker, runs validateFixtures (stats.js) and shows the results
 * using renderValidationPanel (render.js). The local-only career-data
 * progress line (renderTodoProgress) lives here too.
 *
 * To add new checks later: add them to validateFixtures in stats.js and push
 * issues in the usual { squad, fixtureId, fixtureLabel, severity, message }
 * shape — they'll show up on this page automatically.
 */
async function initValidation() {
  document.title = 'Data checks — ' + TEAM.title;
  const sub = document.getElementById('page-subtitle');
  if (sub) sub.textContent = TEAM.clubName + ' — things worth double-checking in the JSON data files';
  if (TEAMS.length > 1) document.getElementById('season-switcher-slot').appendChild(buildTeamSwitcher());

  try {
    const seasons = await loadSeasons();
    let masterFile = TEAM.dataDir + 'players-master.json';
    let playersFile = 'players-season.json';
    let fixturesFile = 'fixtures.json';
    let activeSeason = null;

    if (seasons) {
      const activeId = currentSeasonId(seasons);
      activeSeason = seasons.find(s => s.id === activeId) || seasons[0];
      AGE_AS_OF = seasonAgeDate(activeSeason);
      masterFile = activeSeason.playersMasterFile || masterFile;
      playersFile = activeSeason.playersFile;
      fixturesFile = activeSeason.fixturesFile;
      document.getElementById('season-switcher-slot').appendChild(buildSeasonSwitcher(seasons, activeSeason.id));
      const eyebrow = document.getElementById('eyebrow');
      if (eyebrow) eyebrow.textContent = `Season ${activeSeason.label || activeSeason.id} · Data checks`;
    }

    const { players, fixtures } = await loadData(masterFile, playersFile, fixturesFile, activeSeason ? activeSeason.ageBands : []);
    const playersById = {};
    players.forEach(p => { playersById[p.id] = p; });

    // Per-season checks, plus the checks that look across every season
    // (photo consistency, movements vs season files) — these appear in all seasons.
    const crossIssues = seasons ? await loadCrossSeasonIssues(seasons, masterFile) : [];
    const issues = validateFixtures(fixtures, playersById, {
      requireDetailedStats: activeSeason ? activeSeason.requireDetailedStats !== false : true,
      season: activeSeason,
    }).concat(crossIssues);
    // Nudge to mark this season "dataComplete" once every fixture has a result and there are no errors.
    const completeIssue = seasonCompleteIssue(activeSeason, fixtures, issues);
    if (completeIssue) issues.push(completeIssue);
    // ...and the reverse: a season flagged complete that still has fixtures without results, or errors.
    const staleIssue = seasonStaleCompleteIssue(activeSeason, fixtures, issues);
    if (staleIssue) issues.push(staleIssue);

    renderValidationPanel(issues, isLocalDev(), await loadPlayerNames(masterFile));
    if (isLocalDev()) renderTodoProgress(players);
    document.getElementById('all-clear').style.display = issues.length === 0 ? 'block' : 'none';
    setNavBadge('validation', issues.length);
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  }
}

initValidation();