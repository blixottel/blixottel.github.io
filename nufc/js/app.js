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
    let masterFile = 'players-master.json';
    let playersFile = 'players-season.json';
    let fixturesFile = 'fixtures.json';
    let activeSeason = null;

    if (seasons) {
      const activeId = currentSeasonId(seasons);
      activeSeason = seasons.find(s => s.id === activeId) || seasons[0];
      masterFile = activeSeason.playersMasterFile || masterFile;
      playersFile = activeSeason.playersFile;
      fixturesFile = activeSeason.fixturesFile;

      document.getElementById('season-switcher-slot').appendChild(buildSeasonSwitcher(seasons, activeSeason.id));
      const eyebrow = document.getElementById('eyebrow');
      if (eyebrow) eyebrow.textContent = `Est. manually · Season ${activeSeason.label || activeSeason.id}`;
      const footerNote = document.getElementById('footer-note');
      if (footerNote) {
        footerNote.innerHTML = `Data maintained by hand in <code>${masterFile}</code>, <code>${playersFile}</code> and <code>${fixturesFile}</code> (season ${activeSeason.label || activeSeason.id} — see <code>seasons.json</code> for the full list). Appearance stats are calculated automatically from the fixture records. See <code>DATA-GUIDE.md</code> for field reference.`;
      }
    }

    const { players, fixtures } = await loadData(masterFile, playersFile, fixturesFile, activeSeason ? activeSeason.ageBands : []);
    const playersById = {};
    players.forEach(p => { playersById[p.id] = p; });

    const issues = validateFixtures(fixtures, playersById, {
      requireDetailedStats: activeSeason ? activeSeason.requireDetailedStats !== false : true,
    });
    renderValidationPanel(issues);

    const fixtureIssuesMap = {}; // "squad::fixtureId" -> [messages]
    const squadIssueCounts = { senior: 0, u21: 0, u18: 0 };
    issues.forEach(iss => {
      if (squadIssueCounts[iss.squad] !== undefined) squadIssueCounts[iss.squad] += 1;
      if (iss.fixtureId) {
        const key = iss.squad + '::' + iss.fixtureId;
        (fixtureIssuesMap[key] = fixtureIssuesMap[key] || []).push(iss.message.replace(/^.*?: /, ''));
      }
    });

    ['senior', 'u21', 'u18'].forEach(squadKey => {
      const squadPlayers = players.filter(p => normSquad(p.squad) === squadKey);
      const activeCount = squadPlayers.filter(p => (p.status || 'active') === 'active').length;
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