/**
 * teams.js — the list of teams this site can show, and which one is active.
 * Loaded before data.js. The active team comes from ?team=<id> in the URL
 * (e.g. index.html?team=women); with no param, the FIRST team in the list is
 * used, so existing links to the men's site keep working unchanged.
 *
 * Per-team fields:
 *   id, label            id is used in the URL; label is shown in the switcher
 *   title, subtitle      page <title> and masthead subtitle
 *   clubName             shown on player pages
 *   dataDir              folder (with trailing slash) holding that team's
 *                        seasons.json, players-master.json, players-archive.json.
 *                        Paths INSIDE seasons.json are page-relative, so they
 *                        need to include this folder, e.g. "data-women/players-2026-27.json".
 *   squads               squads that always get a tab (see CORE_SQUADS in data.js)
 *   unknownDobSquad      squad for a player with no dob and no squadIfDobUnknown
 *   youthSquad           the age group (squad key) whose players are "Youth" — pre-scholarship players who make
 *                        guest appearances higher up ('u16' for men, 'u21' for women). Drives the "Youth" pill and
 *                        the recommended end date for "youth" movements.
 *   dataFrom             OPTIONAL override of the date this team's data starts ("YYYY-MM-DD"). Leave it out and the
 *                        data is taken to start where the oldest season in seasons.json starts (its startDate, or
 *                        1 July from its id). Nothing earlier is expected to have data: player-level checks ignore
 *                        earlier seasons, and players who joined before it show a "Partial record" note.
 *   placeholderPhoto     optional; overrides the shared placeholder image
 */
const TEAMS = [
  {
    id: 'men', label: "Men's",
    title: 'The Teamsheet \u2014 NUFC Squad Tracker',
    subtitle: 'Newcastle United \u2014 Seniors, U21s & U18s, appearance by appearance',
    clubName: 'Newcastle United',
    dataDir: 'data-men/',
    squads: ['senior', 'u21', 'u18'],
    unknownDobSquad: 'u16',
    youthSquad: 'u16',
    dataFrom: '2023-07-01',
  },
  {
    id: 'women', label: "Women's",
    title: 'The Teamsheet \u2014 NUFC Women Squad Tracker',
    subtitle: 'Newcastle United Women \u2014 First Team, appearance by appearance',
    clubName: 'Newcastle United Women',
    dataDir: 'data-women/',
    squads: ['senior'],
    unknownDobSquad: 'u21',
    youthSquad: 'u21',
    dataFrom: '2024-07-01',
	placeholderPhoto: 'https://i.ibb.co/3JvpTRJ/cc39cdc9-8937-4e56-9f46-900c96d4da9c.png'
  },
];
const DEFAULT_TEAM = TEAMS[0];
const TEAM = TEAMS.find(t => t.id === new URLSearchParams(location.search).get('team')) || DEFAULT_TEAM;

/** Appends ?team=... to a URL when a non-default team is active (keeps default URLs clean). */
function withTeam(url) {
  if (TEAM === DEFAULT_TEAM) return url;
  return url + (url.includes('?') ? '&' : '?') + 'team=' + encodeURIComponent(TEAM.id);
}