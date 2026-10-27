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
      const text = await fetchText(file);
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
  mountTeamSwitcher();

  try {
    const ctx = await resolveSeasonContext();
    const { seasons, activeSeason, masterFile, playersFile, fixturesFile } = ctx;
    if (seasons) {
      mountSeasonSwitcher(ctx);
      const eyebrow = document.getElementById('eyebrow');
      if (eyebrow) eyebrow.textContent = `Season ${activeSeason.label || activeSeason.id} · Data checks`;
    }

    const { players, fixtures } = await loadData(masterFile, playersFile, fixturesFile, ctx.ageBands);
    const playersById = {};
    players.forEach(p => { playersById[p.id] = p; });

    // Per-season checks plus the cross-season ones, plus this page's own duplicate-key findings.
    const issues = await gatherIssues(ctx, fixtures, playersById, await loadDuplicateKeyIssues(seasons, masterFile, playersFile, fixturesFile));

    renderValidationPanel(issues, isLocalDev(), await loadPlayerNames(masterFile));
    if (isLocalDev()) renderTodoProgress(players);
    document.getElementById('all-clear').style.display = issues.length === 0 ? 'block' : 'none';
    setNavBadge('validation', issues.length);
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  } finally {
    hideLoading();
  }
}

initValidation();