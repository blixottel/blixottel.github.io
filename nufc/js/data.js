/**
 * data.js — data loading, master/season merging, and pure data-shape helpers.
 * No DOM building here; see render.js for that.
 */

const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABEL = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const SQUAD_LABEL = { senior: 'First Team', u21: 'Under-21s', u18: 'Under-18s', u19: 'Under-19s' };

// URLs that are shared across many players rather than specific to one of
// them — currently just the generic silhouette used when no real photo of
// a player exists yet. Rather than repeating the same URL in every one of
// those players' `photos` entries in players-master.json, that entry is
// set to `true` (a sentinel, not a URL) and resolved against this registry
// by key — see resolvePhotoUrl / photoCandidates below. Update the URL here
// once and every player using it picks up the change; gallery.html keeps
// its own copy of this registry since it's deliberately self-contained.
const SHARED_PHOTO_SOURCES = {
  placeholder: 'https://i.ibb.co/99RpQjTT/nufc-placeholder.png',
};
// u16 has no label of its own — it never gets a page/section (see mergePlayers
// below) — but SQUAD_SHORT still needs an entry so a U16 player who's played
// up for the U18s gets a readable "U16" pill rather than a blank one.
const SQUAD_SHORT = { senior: 'Seniors', u21: 'U21', u18: 'U18', u16: 'U16', u19: 'U19' };

// The three squads every season has, driven by that season's ageBands (see
// ageBandForDob below) — always shown, even if a squad's roster ends up
// empty. OPTIONAL_SQUADS lists squads that only exist for specific seasons
// and are never produced by ageBandForDob at all — currently just 'u19',
// used solely to hold fixtures for a one-off competition (the 2025/26 UEFA
// Youth League run, entered because of Champions League qualification).
// Because no player's *computed* squad is ever 'u19', anyone appearing in a
// u19 fixtures file is automatically a cross-squad "guest" there — the same
// guest mechanism already used for e.g. a U18 who plays up for the U21s
// (see "Squads and guest appearances" in DATA-GUIDE.md) — regardless of
// whether they're really a U18, a U21, or a senior fringe player. A season's
// fixtures file simply omits the 'u19' key entirely in any year there's no
// such campaign; squadKeysFor (below) and app.js use that to show or hide
// the tab accordingly, rather than it needing a flag set anywhere else.
const CORE_SQUADS = ['senior', 'u21', 'u18'];
const OPTIONAL_SQUADS = ['u19'];

/**
 * Which squad tabs/sections should exist for a given season's fixtures
 * data: the three age-banded squads always, plus any OPTIONAL_SQUADS key
 * that's actually present (i.e. has real data) in this season's fixtures
 * file.
 */
function squadKeysFor(fixturesData) {
  return [...CORE_SQUADS, ...OPTIONAL_SQUADS.filter(k => fixturesData && fixturesData[k])];
}

// Statuses that mean "was actually named in a matchday squad" (started,
// came on, or sat as an unused sub) — as opposed to e.g. an injured/loan/
// incoming record logged against a squad for a day they weren't really
// part of. Used both to decide who counts as a genuine cross-squad guest
// (buildSquadSection in render.js) and, for a squad with no computed home
// roster of its own (an OPTIONAL_SQUADS entry like 'u19'), to count how
// many players are actually on that page at all (app.js).
const NAMED_STATUSES = new Set(['start', 'sub_on', 'unused_sub']);

function namedPlayerIdsFor(fixtureData) {
  const appearances = (fixtureData && fixtureData.appearances) || {};
  return Object.keys(appearances).filter(id => {
    const recs = appearances[id];
    return !!recs && Object.values(recs).some(r => r && NAMED_STATUSES.has(r.status));
  });
}
// `squad` is computed, not read from JSON (see mergePlayers) — this just
// normalizes the computed value/casing consistently everywhere it's compared.
const normSquad = (s) => (s || '').trim().toLowerCase() === 'seniors' ? 'senior' : (s || '').trim().toLowerCase();

const STAT_COLUMNS = [
  { key: 'appearances', label: 'Apps' },
  { key: 'starts', label: 'Starts' },
  { key: 'subApps', label: 'Sub' },
  { key: 'goals', label: 'Goals' },
  { key: 'xg', label: 'xG', seniorOnly: true, decimals: 2 },
  { key: 'assists', label: 'Assists' },
  { key: 'yellowCards', label: 'YC' },
  { key: 'redCards', label: 'RC' },
  { key: 'minutes', label: 'Mins', seniorOnly: true },
];

function statColumnsFor(squadKey) {
  return STAT_COLUMNS.filter(col => !col.seniorOnly || squadKey === 'senior');
}

const APPEARANCE_STATUSES = new Set(['start', 'sub_on']);

function calcAge(dob) {
  if (!dob) return '—';
  const d = new Date(dob);
  const now = new Date();
  let age = now.getFullYear() - d.getFullYear();
  const m = now.getMonth() - d.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < d.getDate())) age--;
  return age;
}

function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso + 'T00:00:00');
  return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
}

/**
 * Squad is computed from date of birth against the active season's age
 * bands (see loadSeasons below), not read from JSON — a player's squad
 * naturally shifts season to season as they age, with no manual upkeep.
 * `ageBands` is a list of { squad, bornOnOrAfter?, bornBefore? } entries,
 * most-specific/youngest first; the first matching band wins. Both bounds
 * are optional and, where given, half-open — bornOnOrAfter is inclusive,
 * bornBefore is exclusive — so date ranges never gap or overlap at the
 * boundary. A dob that matches no band (i.e. older than every band's
 * bornOnOrAfter) falls through to 'senior'.
 */
function ageBandForDob(dob, ageBands) {
  for (const band of (ageBands || [])) {
    const afterOk = !band.bornOnOrAfter || dob >= band.bornOnOrAfter;
    const beforeOk = !band.bornBefore || dob < band.bornBefore;
    if (afterOk && beforeOk) return band.squad;
  }
  return 'senior';
}

// Some players' dob is legally unknown at younger ages. In that case squad
// falls back to squadIfDobUnknown if the master record sets one (for the
// occasional case that's known to be older than the blanket default, e.g.
// "this one's U18 despite no confirmed dob"), or to this default otherwise.
const DEFAULT_UNKNOWN_DOB_SQUAD = 'u16';

/**
 * Player data lives in two files: a master file (one row per player, ever —
 * name, nationality, dob, position, and the full set of photo sources) and
 * a per-season roster file (number, status, loanClub, and an optional
 * photoSource override — the things that can change year to year). Squad
 * membership is neither of these — it's computed (see ageBandForDob above),
 * unless a season roster entry pins it explicitly via `squadOverride` (see
 * below). mergePlayers joins master + season by `id` and attaches the
 * computed `squad`, producing the same flat player-object shape the rest of
 * the app has always expected, so buildSquadSection and friends don't need
 * to know any of this happened.
 *
 * A season-roster id with no matching master entry is a data-entry mistake
 * (typo'd id, or a player never added to the master file — including a
 * missed rename if ids are being changed) — it's kept in the merged list
 * with placeholder fields rather than dropped, so it still shows up
 * somewhere and the gap is obvious. It's also tagged with `_unresolvedMaster:
 * true`, which validateFixtures (stats.js) turns into a proper entry in the
 * on-page "Data checks" panel — the console.warn below is a backup for
 * anyone watching DevTools, not the primary way this is meant to be caught.
 *
 * `squadOverride` (season-roster field, optional): pins a player to a given
 * squad for that season regardless of what dob/ageBands would otherwise
 * compute — for the rare case a player should stay associated with a squad
 * they've aged out of on paper. E.g. a player who spent most of a season
 * rehabbing an injury with the U21s, having turned too old for the U21s
 * partway through, but was never actually in first-team contention:
 *   { "id": "u21-nathan-carlyon", "status": "injured_season",
 *     "squadOverride": "u21", "reasonNote": "Completing rehab with the U21s" }
 * This takes priority over everything else, including `squadIfDobUnknown` —
 * unlike that field (only ever a substitute for a *missing* dob), this is
 * an explicit override of a *known* one. `_squadOverrideRedundant: true` is
 * set on the merged player when the override is the same value the normal
 * computation would've produced anyway (i.e. it can safely be removed) —
 * a candidate for its own "Data checks" entry in stats.js, not yet wired up
 * there.
 */
function mergePlayers(masterList, seasonList, ageBands) {
  const masterById = {};
  masterList.forEach(m => { masterById[m.id] = m; });
  return seasonList.map(s => {
    const master = masterById[s.id];
    if (!master) {
      console.warn(`Season file references player id "${s.id}", which isn't in players-master.json (typo in the id?).`);
      return { id: s.id, name: s.id, nationality: '', dob: '', position: '', photos: {}, ...s, _unresolvedMaster: true, squad: 'senior' };
    }
    const merged = { ...master, ...s };
    let computedSquad;
    if (merged.dob) {
      computedSquad = ageBandForDob(merged.dob, ageBands);
      if (merged.squadIfDobUnknown) merged._squadIfDobUnknownUnused = true;
    } else if (merged.squadIfDobUnknown) {
      computedSquad = merged.squadIfDobUnknown;
    } else {
      computedSquad = DEFAULT_UNKNOWN_DOB_SQUAD;
      merged._dobUnknownDefaulted = true;
    }

    if (merged.squadOverride) {
      merged.squad = merged.squadOverride;
      if (normSquad(merged.squadOverride) === normSquad(computedSquad)) {
        merged._squadOverrideRedundant = true;
      }
    } else {
      merged.squad = computedSquad;
    }
    return merged;
  });
}

async function loadData(masterFile, seasonFile, fixturesFile, ageBands) {
  const [masterRes, seasonRes, fixturesRes] = await Promise.all([
    fetch(masterFile),
    fetch(seasonFile),
    fetch(fixturesFile),
  ]);
  if (!masterRes.ok || !seasonRes.ok || !fixturesRes.ok) throw new Error('fetch failed');
  const master = await masterRes.json();
  const season = await seasonRes.json();
  const fixtures = await fixturesRes.json();
  const players = mergePlayers(master, season, ageBands);

  return { players, fixtures };
}

/**
 * Multi-season support. seasons.json is an optional manifest listing each
 * season and which files belong to it — e.g.:
 *   [
 *     {
 *       "id": "2026-27", "label": "2026/27",
 *       "playersFile": "players-2026-27.json", "fixturesFile": "fixtures-2026-27.json",
 *       "ageBands": [
 *         { "squad": "u16", "bornOnOrAfter": "2010-09-01" },
 *         { "squad": "u18", "bornOnOrAfter": "2008-09-01", "bornBefore": "2010-09-01" },
 *         { "squad": "u21", "bornOnOrAfter": "2005-01-01", "bornBefore": "2008-09-01" }
 *       ]
 *     },
 *     { "id": "2024-25", "label": "2024/25", "playersFile": "players-2024-25.json", "fixturesFile": "fixtures-2024-25.json" }
 *   ]
 * `playersFile` here is the season roster file (number/status), not the
 * master file — the master file (name/dob/photos etc.) is shared across
 * every season and doesn't need listing per-entry; it defaults to
 * players-master.json, or can be overridden per-season via an optional
 * `playersMasterFile` key if you ever need to.
 *
 * `ageBands` defines that season's cutoffs for turning a dob into a squad
 * (see ageBandForDob above) — they genuinely shift every season as players
 * age, so they live here rather than in code. Omitting `ageBands` (or
 * leaving it `[]`) makes every player resolve to 'senior'.
 *
 * The first entry is treated as the default/current season. If seasons.json
 * doesn't exist (fetch fails, e.g. a single-season setup that hasn't been
 * migrated yet), the page falls back to players-master.json plus
 * players-season.json / fixtures.json, no season switcher, and no age bands
 * (everyone resolves to 'senior' unless that single-season setup is later
 * given its own seasons.json entry).
 */
async function loadSeasons() {
  try {
    const res = await fetch('seasons.json');
    if (!res.ok) return null;
    const seasons = await res.json();
    if (!Array.isArray(seasons) || seasons.length === 0) return null;
    return seasons;
  } catch (err) {
    return null;
  }
}

/**
 * True when the page is being viewed from a local dev server (or opened
 * straight off disk), as opposed to a published/deployed copy. Used to
 * decide how much detail the "Data checks" panel shows — see
 * renderValidationPanel in render.js.
 */
function isLocalDev() {
  const host = location.hostname;
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '' || location.protocol === 'file:';
}

// Order squads are checked in when looking for the next match, and the
// tie-break order (see findNextMatch) if two squads share the earliest date.
// 'u19' is included (via CORE_SQUADS + OPTIONAL_SQUADS) so a UEFA Youth
// League date can win the "next match" banner too, but sorts last on a
// tie since it's the least central of the four in a given week.
const SQUAD_ORDER = [...CORE_SQUADS, ...OPTIONAL_SQUADS];

/**
 * Finds the earliest fixture, across all three squads, that doesn't have a
 * result yet — the basis for the "next match" indicator. Fixtures with no
 * date are skipped, since there's nothing to sort them by. Ties on date are
 * broken by SQUAD_ORDER (senior first). Returns { squad, fixture } or null
 * if every fixture across every squad already has a result (or there are
 * no fixtures at all).
 */
function findNextMatch(fixturesData) {
  let best = null;
  SQUAD_ORDER.forEach(squadKey => {
    const fixtures = (fixturesData[squadKey] && fixturesData[squadKey].fixtures) || [];
    fixtures.forEach(fx => {
      if (fx.result || !fx.date) return;
      if (!best || fx.date < best.fixture.date) {
        best = { squad: squadKey, fixture: fx };
      }
    });
  });
  return best;
}

function currentSeasonId(seasons) {
  const requested = new URLSearchParams(location.search).get('season');
  if (requested && seasons.some(s => s.id === requested)) return requested;
  return seasons[0].id;
}

/**
 * Returns a player's candidate photo URLs, in the order they should be
 * tried. `photos` is a source-name → URL map (e.g. { official: "...",
 * premierleague: "...", transfermarkt: "..." }) — the set of source names
 * is deliberately open-ended rather than a fixed list, so a new source can
 * be added to players-master.json at any time without a code change. Object
 * key order (i.e. the order sources are listed in the JSON) is the default
 * fallback priority; a season roster entry can override that per-player-
 * per-season with a `photoSource` key naming which source to try first.
 *
 * Every key in SHARED_PHOTO_SOURCES (above) is automatically available to
 * every player as a fallback, tried last, without needing to be listed in
 * that player's own `photos` — so `placeholder` doesn't need repeating (or
 * even mentioning) in every one of 140+ player records. A season file can
 * still promote it to the front via `photoSource: "placeholder"` exactly as
 * it would for a real per-player source; the promotion check just also
 * looks in SHARED_PHOTO_SOURCES, not only in that player's own `photos`. A
 * player can opt out of a given shared source by giving it an explicit
 * empty value in their own `photos` (e.g. `"placeholder": ""`), which is
 * how a genuinely photo-less-forever edge case could suppress it.
 *
 * Also accepts the older array-of-URLs `photos` shape and the single-string
 * `photo` field, for any records that haven't been migrated yet. Empty/falsy
 * entries are dropped so a blank string doesn't count as a candidate.
 */
function photoCandidates(p) {
  const photos = p.photos;
  let candidates = [];

  if (photos && typeof photos === 'object' && !Array.isArray(photos)) {
    const keys = Object.keys(photos).filter(k => photos[k]);
    candidates = keys.map(k => ({ key: k, url: photos[k] }));
    Object.keys(SHARED_PHOTO_SOURCES).forEach(k => {
      if (!(k in photos)) candidates.push({ key: k, url: SHARED_PHOTO_SOURCES[k] });
    });
  } else if (Array.isArray(photos) && photos.length) {
    candidates = photos.filter(Boolean).map(url => ({ key: null, url }));
  } else if (p.photo) {
    candidates = [{ key: null, url: p.photo }];
  }

  if (p.photoSource) {
    const idx = candidates.findIndex(c => c.key === p.photoSource);
    if (idx > 0) {
      const [chosen] = candidates.splice(idx, 1);
      candidates.unshift(chosen);
    }
  }

  return candidates.map(c => c.url);
}