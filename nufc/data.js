/**
 * data.js — data loading, master/season merging, and pure data-shape helpers.
 * No DOM building here; see render.js for that.
 */

const POSITION_ORDER = ['GK', 'DEF', 'MID', 'FWD'];
const POSITION_LABEL = { GK: 'Goalkeepers', DEF: 'Defenders', MID: 'Midfielders', FWD: 'Forwards' };
const SQUAD_LABEL = { senior: 'First Team', u21: 'Under-21s', u18: 'Under-18s' };
// u16 has no label of its own — it never gets a page/section (see mergePlayers
// below) — but SQUAD_SHORT still needs an entry so a U16 player who's played
// up for the U18s gets a readable "U16" pill rather than a blank one.
const SQUAD_SHORT = { senior: 'Seniors', u21: 'U21', u18: 'U18', u16: 'U16' };
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
 * membership is neither of these — it's computed (see ageBandForDob above).
 * mergePlayers joins master + season by `id` and attaches the computed
 * `squad`, producing the same flat player-object shape the rest of the app
 * has always expected, so buildSquadSection and friends don't need to know
 * any of this happened.
 *
 * A season-roster id with no matching master entry is a data-entry mistake
 * (typo'd id, or a player never added to the master file — including a
 * missed rename if ids are being changed) — it's kept in the merged list
 * with placeholder fields rather than dropped, so it still shows up
 * somewhere and the gap is obvious. It's also tagged with `_unresolvedMaster:
 * true`, which validateFixtures (stats.js) turns into a proper entry in the
 * on-page "Data checks" panel — the console.warn below is a backup for
 * anyone watching DevTools, not the primary way this is meant to be caught.
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
    if (merged.dob) {
      merged.squad = ageBandForDob(merged.dob, ageBands);
      if (merged.squadIfDobUnknown) merged._squadIfDobUnknownUnused = true;
    } else if (merged.squadIfDobUnknown) {
      merged.squad = merged.squadIfDobUnknown;
    } else {
      merged.squad = DEFAULT_UNKNOWN_DOB_SQUAD;
      merged._dobUnknownDefaulted = true;
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
 * Also accepts the older array-of-URLs `photos` shape and the single-string
 * `photo` field, for any records that haven't been migrated yet. Empty/falsy
 * entries are dropped so a blank string doesn't count as a candidate.
 */
function photoCandidates(p) {
  const photos = p.photos;
  if (photos && typeof photos === 'object' && !Array.isArray(photos)) {
    const keys = Object.keys(photos).filter(k => photos[k]);
    if (keys.length === 0) return [];
    let ordered = keys;
    if (p.photoSource && photos[p.photoSource]) {
      ordered = [p.photoSource, ...keys.filter(k => k !== p.photoSource)];
    }
    return ordered.map(k => photos[k]);
  }
  if (Array.isArray(photos) && photos.length) return photos.filter(Boolean);
  if (p.photo) return [p.photo];
  return [];
}
