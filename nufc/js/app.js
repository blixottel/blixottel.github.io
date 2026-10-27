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
  mountTeamSwitcher();
}

// Tabs are generated from the squads this team/season actually has, so the
// same index.html serves every team.
function buildTabs(squadKeys) {
  const tabs = document.getElementById('tabs');
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Squads');
  tabs.innerHTML = squadKeys
    .map(k => `<a role="tab" id="tab-${k}" aria-controls="${k}" aria-selected="false" href="#${k}">${SQUAD_LABEL[k] || k} <span class="count" id="count-${k}"></span></a>`)
    .join('');
}

async function init() {
  const main = document.getElementById('main');
  applyTeamChrome();
  try {
    const ctx = await resolveSeasonContext();
    const { seasons, activeSeason, masterFile, playersFile, fixturesFile } = ctx;

    if (seasons) {
      mountSeasonSwitcher(ctx);
      const eyebrow = document.getElementById('eyebrow');
      if (eyebrow) eyebrow.textContent = `Est. manually · Season ${activeSeason.label || activeSeason.id}${AGE_AS_OF ? ' · Ages as at ' + AGE_AS_OF.toLocaleDateString('en-GB') : ''}`;
      const footerNote = document.getElementById('footer-note');
      if (footerNote) {
        footerNote.innerHTML = `Data maintained by hand in <code>${masterFile}</code>, <code>players-former.json</code>, <code>players-archive.json</code>, <code>${playersFile}</code> and <code>${fixturesFile}</code> (season ${activeSeason.label || activeSeason.id} — see <code>seasons.json</code> for the full list). Appearance stats are calculated automatically from the fixture records. See <code>DATA-GUIDE.md</code> for field reference.`;
      }
    }

    const { players, fixtures } = await loadData(masterFile, playersFile, fixturesFile, ctx.ageBands);
    const playersById = {};
    players.forEach(p => { playersById[p.id] = p; });

    buildNextMatchBanner(findNextMatch(fixtures));

    // Per-season checks plus the cross-season ones (see gatherIssues in stats.js).
    const issues = await gatherIssues(ctx, fixtures, playersById);
    // The full list of checks now lives on validation.html; here we just
    // show the count as a badge on the "Data checks" nav link.
    setNavBadge('validation', issues.length);
    // Shown on published copies too: a plain heads-up (no specifics) whenever
    // this team/season has any outstanding data checks.
    updateWipNotice(issues, activeSeason);

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
  } finally {
    hideLoading();
  }
}

/**
 * The heads-up banner under the tabs. Worded per season, and only shown when it's useful:
 *  - a season still being entered (not "dataComplete"): shown if any outstanding check, with "work in progress" wording;
 *  - a season marked complete: shown only for real *errors in that season's own data*, or a stale "complete" flag (other warnings and the
 *    cross-season checks, which would otherwise flag every old season, don't count), with softer "under review" wording.
 * No specifics are given; the full list is on the Data checks page.
 */
function updateWipNotice(issues, season) {
  const el = document.getElementById('wip-notice');
  if (!el) return;
  const label = season ? (season.label || season.id) : 'this season';
  const complete = !!season && season.dataComplete === true;
  const relevant = issues.filter(i => !i.ignoreInBanner && (!complete || i.bannerWorthy || (i.severity === 'error' && !i.crossSeason)));
  if (!relevant.length) { el.style.display = 'none'; return; }
  el.innerHTML = complete
    ? `<strong>Data under review.</strong> The ${label} season is marked complete, but a few records are still being double-checked, so you may spot a mistake.`
    : `<strong>Work in progress.</strong> The ${label} data is still being entered, so this page may contain errors or gaps.`;
  el.style.display = 'block';
}

function setupTabs() {
  const tabLinks = Array.from(document.querySelectorAll('nav.tabs a'));
  const sections = Array.from(document.querySelectorAll('section.squad'));

  sections.forEach(s => {
    s.setAttribute('role', 'tabpanel');
    s.setAttribute('aria-labelledby', 'tab-' + s.id);
  });

  const showTab = (squadKey) => {
    sections.forEach(s => s.classList.toggle('active-squad', s.id === squadKey));
    tabLinks.forEach(a => {
      const on = a.getAttribute('href') === '#' + squadKey;
      a.classList.toggle('active', on);
      a.setAttribute('aria-selected', on ? 'true' : 'false');
      a.tabIndex = on ? 0 : -1; // only the current tab is in the Tab order; arrow keys move between tabs
    });
  };

  // Arrow keys / Home / End move between tabs, as screen-reader users expect of a tablist.
  document.getElementById('tabs').addEventListener('keydown', (e) => {
    const i = tabLinks.indexOf(document.activeElement);
    if (i < 0) return;
    const last = tabLinks.length - 1;
    const next = { ArrowRight: i === last ? 0 : i + 1, ArrowLeft: i === 0 ? last : i - 1, Home: 0, End: last }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    tabLinks[next].focus();
    tabLinks[next].click();
  });

  tabLinks.forEach(a => {
    a.addEventListener('click', (e) => {
      e.preventDefault();
      const squadKey = a.getAttribute('href').slice(1);
      showTab(squadKey);
      history.replaceState(null, '', '#' + squadKey);
    });
  });

  const validKeys = sections.map(s => s.id);
  // Fall back to the first tab this season actually has (not a hard-coded 'senior').
  const initial = validKeys.includes(location.hash.slice(1)) ? location.hash.slice(1) : validKeys[0];
  if (initial) showTab(initial);
}

init();