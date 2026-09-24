/**
 * app.js — wiring: fetches the season manifest and data, renders each
 * squad section, and sets up tab switching. Entry point — calls init()
 * at the bottom.
 */

async function init() {
  const main = document.getElementById('main');
  try {
    const seasons = await loadSeasons();
    // playersFile here is the season *roster* file (number/status/etc.) —
    // the master file (name/dob/photos) is shared across every season and
    // defaults to players-master.json unless a season entry overrides it
    // with its own playersMasterFile. Squad membership isn't read from
    // either file — see mergePlayers in data.js.
    let masterFile = 'data/players-master.json';
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

    const issues = validateFixtures(fixtures, playersById, {
      requireDetailedStats: activeSeason ? activeSeason.requireDetailedStats !== false : true,
    });
    // Full breakdown on a local dev server; a single concise line once this
    // is published, so visitors see "worth a check" without the specifics.
    renderValidationPanel(issues, isLocalDev());
    if (isLocalDev()) renderTodoProgress(players);

    // The three age-banded squads, plus 'u19' if (and only if) this season's
    // fixtures file actually has one — see CORE_SQUADS/OPTIONAL_SQUADS and
    // squadKeysFor in data.js.
    const squadKeys = squadKeysFor(fixtures);

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

    // Hide the tab for any optional squad (currently just 'u19') that has
    // no data this season, rather than leaving an empty tab in the nav —
    // index.html's markup always includes it so it's ready for a season
    // that does have it.
    OPTIONAL_SQUADS.filter(k => !squadKeys.includes(k)).forEach(k => {
      const tabLink = document.querySelector(`nav.tabs a[href="#${k}"]`);
      if (tabLink) tabLink.style.display = 'none';
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