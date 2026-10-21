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
/**
 * Duplicate-key check. JSON.parse quietly keeps only the last copy of a repeated key, so the files are
 * re-read as raw text (findDuplicateJsonKeys, stats.js). Covers every season's roster, fixtures and master
 * file, the former / archive files and seasons.json. Player files are also checked for the same "id"
 * appearing twice in the list. Never throws: a file that can't be read is just skipped.
 */
async function loadDuplicateKeyIssues(seasons, masterFile, playersFile, fixturesFile) {
  const dir = masterFile.replace(/[^/]*$/, '');
  const files = [];
  const add = (file, players) => { if (file && !files.some(f => f.file === file)) files.push({ file, players }); };
  add(masterFile, true);
  add(dir + 'players-former.json', true);
  add(dir + 'players-archive.json', true);
  (seasons || []).forEach(s => {
    add(s.playersMasterFile, true);
    add(s.playersFile, true);
    add(s.fixturesFile, false);
  });
  add(playersFile, true);
  add(fixturesFile, false);
  if (seasons) add((ACTIVE_TEAM.dataDir || 'data/') + 'seasons.json', false);

  const issue = message => ({ squad: '_general', fixtureId: null, fixtureLabel: null, severity: 'error', message });
  const perFile = await Promise.all(files.map(async ({ file, players }) => {
    const out = [];
    try {
      const res = await fetch(file);
      if (!res.ok) return out;
      const text = await res.text();
      const name = file.split('/').pop();
      findDuplicateJsonKeys(text).forEach(d => {
        out.push(issue(`${name}: the key "${d.key}" appears ${d.count} times${d.path ? ' in ' + d.path : ' at the top level'} — only the last one is used, so the earlier ones are being ignored. Remove or rename the extras.`));
      });
      if (players) {
        const list = JSON.parse(text);
        if (Array.isArray(list)) {
          const counts = {};
          list.forEach(p => { if (p && p.id != null) counts[p.id] = (counts[p.id] || 0) + 1; });
          Object.keys(counts).filter(id => counts[id] > 1).forEach(id => {
            out.push(issue(`${name}: the player id "${id}" appears ${counts[id]} times in the list. Remove the duplicate entry.`));
          });
        }
      }
    } catch (e) { /* unreadable or not JSON: the page's own load error covers that */ }
    return out;
  }));
  return [].concat(...perFile);
}

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
    }).concat(crossIssues, await loadDuplicateKeyIssues(seasons, masterFile, playersFile, fixturesFile));
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