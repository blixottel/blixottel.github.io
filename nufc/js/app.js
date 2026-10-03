/**
 * app.js — wiring: fetches the season manifest and data, renders each
 * squad section, and sets up tab switching. Entry point — calls init()
 * at the bottom.
 */

// Team-specific page chrome: title, subtitle and the team switcher. Done before
// any data loads, so the switcher still works if this team's data is missing.
function applyTeamChrome() {
  document.title = TEAM.title;
  const sub = document.querySelector('.masthead .subtitle');
  if (sub) sub.textContent = TEAM.subtitle;
  if (TEAMS.length > 1) document.getElementById('season-switcher-slot').appendChild(buildTeamSwitcher());
}

// Tabs are generated from the squads this team/season actually has, so the
// same index.html serves every team.
function buildTabs(squadKeys) {
  document.getElementById('tabs').innerHTML = squadKeys
    .map(k => `<a href="#${k}">${SQUAD_LABEL[k] || k} <span class="count" id="count-${k}"></span></a>`)
    .join('');
}

async function init() {
  const main = document.getElementById('main');
  applyTeamChrome();
  try {
    const seasons = await loadSeasons();
    // playersFile here is the season *roster* file (number/status/etc.) —
    // the master file (name/dob/photos) is shared across every season and
    // defaults to players-master.json unless a season entry overrides it
    // with its own playersMasterFile. Squad membership isn't read from
    // either file — see mergePlayers in data.js.
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
      if (eyebrow) eyebrow.textContent = `Est. manually · Season ${activeSeason.label || activeSeason.id}${AGE_AS_OF ? ' · Ages as at ' + AGE_AS_OF.toLocaleDateString('en-GB') : ''}`;
      const footerNote = document.getElementById('footer-note');
      if (footerNote) {
        footerNote.innerHTML = `Data maintained by hand in <code>${masterFile}</code>, <code>players-archive.json</code>, <code>${playersFile}</code> and <code>${fixturesFile}</code> (season ${activeSeason.label || activeSeason.id} — see <code>seasons.json</code> for the full list). Appearance stats are calculated automatically from the fixture records. See <code>DATA-GUIDE.md</code> for field reference.`;
      }
    }

    const { players, fixtures } = await loadData(masterFile, playersFile, fixturesFile, activeSeason ? activeSeason.ageBands : []);
    const playersById = {};
    players.forEach(p => { playersById[p.id] = p; });

    buildNextMatchBanner(findNextMatch(fixtures));

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
    // The full list of checks now lives on validation.html; here we just
    // show the count as a badge on the "Data checks" nav link.
    setNavBadge('validation', issues.length);
    // Shown on published copies too: a plain heads-up (no specifics) whenever
    // this team/season has any outstanding data checks.
    document.getElementById('wip-notice').style.display = issues.some(i => !i.ignoreInBanner) ? 'block' : 'none';

    // The three age-banded squads, plus 'u19' if (and only if) this season's
    // fixtures file actually has one — see CORE_SQUADS/OPTIONAL_SQUADS and
    // squadKeysFor in data.js.
    const squadKeys = squadKeysFor(fixtures);
    buildTabs(squadKeys);

    const fixtureIssuesMap = {}; // "squad::fixtureId" -> [messages]
    const squadIssueCounts = {};
    squadKeys.forEach(k => { squadIssueCounts[k] = 0; });
    issues.forEach(iss => {
      if (squadIssueCounts[iss.squad] !== undefined) squadIssueCounts[iss.squad] += 1;
      if (iss.fixtureId) {
        const key = iss.squad + '::' + iss.fixtureId;
        (fixtureIssuesMap[key] = fixtureIssuesMap[key] || []).push(iss.message.replace(/^.*?: /, ''));
      }
    });

    squadKeys.forEach(squadKey => {
      const squadPlayers = players.filter(p => normSquad(p.squad) === squadKey);
      // A squad with a real computed roster (senior/u21/u18) shows its
      // active-player count as before. An OPTIONAL_SQUADS entry like 'u19'
      // never has a computed home roster at all — everyone on that page is
      // a guest — so its count instead reflects how many players were
      // actually named in a u19 matchday squad this season.
      const activeCount = squadPlayers.length
        ? squadPlayers.filter(p => (p.status || 'active') === 'active').length
        : namedPlayerIdsFor(fixtures[squadKey]).length;
      document.getElementById('count-' + squadKey).textContent = activeCount;
      if (squadIssueCounts[squadKey] > 0) {
        const dot = document.createElement('span');
        dot.className = 'tab-flag';
        dot.title = `${squadIssueCounts[squadKey]} data check(s) to review`;
        document.querySelector(`nav.tabs a[href="#${squadKey}"]`).appendChild(dot);
      }
      main.appendChild(buildSquadSection(squadKey, squadPlayers, fixtures[squadKey] || { fixtures: [], appearances: {} }, playersById, fixtureIssuesMap));
    });

    setupTabs();
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  }
}

function setupTabs() {
  const tabLinks = Array.from(document.querySelectorAll('nav.tabs a'));
  const sections = Array.from(document.querySelectorAll('section.squad'));

  const showTab = (squadKey) => {
    sections.forEach(s => s.classList.toggle('active-squad', s.id === squadKey));
    tabLinks.forEach(a => a.classList.toggle('active', a.getAttribute('href') === '#' + squadKey));
  };

  tabLinks.forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const squadKey = a.getAttribute('href').slice(1);
      showTab(squadKey);
      history.replaceState(null, '', '#' + squadKey);
    });
  });

  const validKeys = sections.map(s => s.id);
  const initial = validKeys.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'senior';
  showTab(initial);
}

init();