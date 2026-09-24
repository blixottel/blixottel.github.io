# Data guide — The Teamsheet

This site is a pair of static pages (`index.html`, the squad tracker, and
`gallery.html`, a photo-audit tool) built on `styles.css` + `js/*.js`, that
read everything else from JSON files sitting next to them. There's no build
step — edit the JSON, refresh the page.

Because it all runs on `fetch()`, you need to serve the folder over HTTP, not
open the pages directly from disk:

```
python3 -m http.server 8000
```

then visit `http://localhost:8000` (or `http://localhost:8000/gallery.html`
for the photo gallery).

## File overview

| File | What it holds | Changes... |
|---|---|---|
| `players-master.json` | One entry per player, ever: name, nationality, dob, position, photos | Rarely — only when these facts genuinely change (a transfer doesn't touch this file) |
| `players-YYYY-YY.json` | One entry per player *in that season's squad*: squad, number, status, loan/incoming details | Every season, and whenever a player's situation changes within a season |
| `fixtures-YYYY-YY.json` | Per-squad fixtures and appearance records for a season | Every matchday |
| `seasons.json` | Which files belong to which season, and which season loads by default | Once per new season |

The app joins `players-master.json` and the active season's roster file by
`id` at load time — see `mergePlayers` in `js/data.js` (and the copy of the
same logic in `gallery.html`, which is a standalone single file). Everything
downstream (cards, the fixture matrix, leaderboards, the gallery) sees one
flat player object, so you never have to think about the split once the JSON
is filled in correctly.

## players-master.json

One object per player. `id` is the permanent key used everywhere else
(season rosters, fixtures' appearance records) — never change it once a
player is in the fixtures file, or you'll orphan their history.

```json
{
  "id": "s-pope",
  "name": "Nick Pope",
  "nationality": "England",
  "dob": "1992-04-19",
  "position": "GK",
  "photos": {
    "official-profile": "https://...",
    "premierleague": "https://...",
    "transfermarkt": "https://..."
  }
}
```

| Field | Notes |
|---|---|
| `id` | Permanent, unique. Convention so far: `s-` (senior), `u21-`, `u18-`, `u16-` prefix + surname (plus a disambiguating suffix for shared surnames, e.g. `u21-thompson-m` / `u21-thompson-c`). Note this prefix is now just a naming habit, not meaningful data — see "Squad is computed" below, squad membership no longer comes from the id or from any stored field. |
| `name` | Display name. |
| `nationality` | Free text, shown as-is. |
| `dob` | `YYYY-MM-DD`, or `""` if unknown. Drives both the displayed age **and** automatic squad assignment — see below. |
| `position` | One of `GK`, `DEF`, `MID`, `FWD`. |
| `photos` | A **source-name → URL** map. See below. |
| `squadIfDobUnknown` | Optional, only consulted when `dob` is blank. See "Squad is computed" below. |

### Photos

`photos` is a plain object, not a fixed list — you can add or remove source
keys freely without touching any code:

```json
"photos": {
  "official-profile": "https://contentfulproxy.stadion.io/.../pope.png",
  "premierleague": "https://resources.premierleague.com/.../98747.png",
  "zerozero": "https://cdn-img.staticzz.com/.../pope.png",
  "transfermarkt": "https://img.a.transfermarkt.technology/.../192080.jpg"
}
```

The app tries each URL in the order the keys appear in the JSON, falling
back to the next one if an image fails to load (a genuine 404, a since-moved
CDN path, etc.), and finally falls back to the initials badge if every URL
fails. So put your most reliable/best-quality source first.

Any key name works — `official-profile`, `premierleague`, `fotmob`,
`instagram`, whatever fits the source (the keys currently in use across the
data are: `official-profile`, `premierleague`, `zerozero`, `transfermarkt`,
`besoccer`, `sortitoutsi`, `fotmob`, `fminside`, `flashscore`, `google`,
`sofascore`, `statshub`, `twitter`, `instagram`, `cloudfront`, `sevillafc`,
plus a couple of one-off loan-club-site keys — but that list is just what's
been used so far, not a fixed set). There's no need to register new source
names anywhere else; just start using one in `photos` and, if you want,
reference it from a season file's `photoSource` (next section).

Omit `photos` entirely, or leave it `{}`, for a player with no photo yet —
they'll just show initials. `gallery.html` is the fastest way to see, at a
glance, which players are missing photos or relying on a single shaky
source — see below.

**Shared sources.** A handful of source names are meant to resolve to the
same URL for every player rather than being player-specific — currently
just `placeholder`, the generic club-crest silhouette shown when no real
photo exists yet. These live in a small `SHARED_PHOTO_SOURCES` registry —
in `js/data.js`, duplicated in `gallery.html`'s own script since that page
is self-contained — mapping a source name straight to one URL:

```js
const SHARED_PHOTO_SOURCES = {
  placeholder: 'https://i.ibb.co/99RpQjTT/nufc-placeholder.png',
};
```

Any key listed there is automatically available to *every* player as a
fallback candidate, tried last, without needing to be mentioned in that
player's own `photos` object in `players-master.json` at all — that's why
you won't find `"placeholder"` in any player record even though every
player effectively has it. Change the URL in the registry once and every
player picks it up. A season roster file can still promote a shared source
to the front of a specific player's fallback order with `photoSource`
(e.g. `"photoSource": "placeholder"`), exactly as it would for a real
per-player source — the promotion logic checks the same combined candidate
list either way, so it doesn't matter that `placeholder` isn't literally
sitting in that player's `photos`.

To opt a specific player *out* of a shared source (skip it entirely rather
than have it as a fallback), give it an explicit empty value in that
player's own `photos`, e.g. `"placeholder": ""` — an explicit empty entry
takes precedence over the automatic one. This should be rare; it's meant
for a genuine edge case, not routine use.

### Squad is computed, not stored

A player's squad (`senior` / `u21` / `u18` / `u16`) is worked out
automatically from `dob` against the active season's `ageBands` (defined per
season in `seasons.json` — see below) — it's never read from a JSON field,
so there's nothing to keep in sync as players have birthdays or move up an
age group. Concretely, for each player: `mergePlayers` in `js/data.js` runs
`dob` through that season's `ageBands`, first match wins, falling through to
`senior` if nothing matches (i.e. born before the oldest band's cutoff).

**U16 is computed but has no page of its own.** `index.html` only ever
builds Senior/U21/U18 sections — a U16 player is invisible on the site
*unless* they've actually played a match for the U18s (per the fixtures
data), in which case they show up as a guest card on the U18 page with a
"U16" pill, same mechanism as any other cross-squad appearance (see
"Squads and guest appearances" below). `gallery.html` is the exception — it
shows U16 players directly, with their own filter button, since its job is
auditing every player's photos regardless of squad.

**Unknown dob.** Some players' dob is legally unknown at younger ages —
`dob` stays `""`. In that case:
- If `squadIfDobUnknown` is set, that's used directly (e.g.
  `"squadIfDobUnknown": "u18"` for a specific player known to be older than
  the blanket default, despite no confirmed dob).
- If not, it defaults to `u16` — the app assumes an unknown dob means a very
  young player, since that's the case in practice. This default (and the
  "both dob and squadIfDobUnknown are set" case, where `squadIfDobUnknown`
  is just ignored) both show up as warnings in the "Data checks" panel, so
  neither happens silently.
- `squadIfDobUnknown` is only ever a substitute for missing dob data — it's
  never consulted when `dob` is present, so it can't be used to override a
  known age.

**Overriding a known age: `squadOverride`.** Occasionally a player should
stay associated with a squad they've technically aged out of — e.g. a
player contracted as an U21 who was injured, still rehabbing when they
became too old for the U21 age band, and never actually in first-team
contention. Setting `squadOverride` on that player's *season roster* entry
pins their `squad` to that value outright, regardless of what `dob` +
`ageBands` would otherwise produce:

```json
{ "id": "u21-nathan-carlyon", "number": 34, "status": "injured_season",
  "squadOverride": "u21", "reasonNote": "Completing rehab with the U21s" }
```

Unlike `squadIfDobUnknown`, this works whether or not `dob` is known, and
takes priority over everything else — it's an explicit "keep them here"
instruction, not a fallback for missing data. Because it's set per season
roster entry, it naturally stops applying the moment you don't carry it
forward into the next season's roster file (or once it becomes redundant —
see below).

Use it sparingly, for genuine one-off exceptions — not as a routine way to
keep a squad's numbers up, and not as a substitute for fixing `ageBands` if
the *bands themselves* are wrong for a whole cohort.

## players-YYYY-YY.json (season roster files)

One object per player who's part of that season — either on the books
(`active`, `loan`, `injured_season`, etc.) or dropped for a specific reason.
A player who left the club before this season simply isn't listed here (but
stays in `players-master.json`).

```json
{
  "id": "s-pope",
  "number": 1,
  "status": "active"
}
```

| Field | Notes |
|---|---|
| `id` | Must match an entry in `players-master.json`. A typo here shows up as a "Data checks" panel error (the player renders with their raw id as a name, e.g. `s-hall`, rather than being silently dropped) — useful to know if you're mid-rename and ids briefly don't line up between files. |
| `number` | Shirt number. |
| `status` | One of `active`, `loan`, `incoming`, `left`, `injured_season`, `not_selected_season`, `trialist`, or omit for `active`. |
| `loanClub` | Only for `status: "loan"`. |
| `fromClub` | Only for `status: "incoming"`. |
| `expectedDate` | Only for `status: "incoming"`, `YYYY-MM-DD`. |
| `reasonNote` | Free text shown on the status card, for `injured_season` / `not_selected_season` / `trialist`. |
| `squadOverride` | Optional. Pins `squad` to this value regardless of what `dob`/`ageBands` compute. See "Overriding a known age" above — use sparingly. |
| `photoSource` | Optional. Names a key in that player's master `photos` object to try **first** this season — e.g. `"photoSource": "premierleague"` if the official club photo hasn't been shot yet for a new arrival. Falls through to the rest of `photos` as normal if that source 404s. |

There's deliberately no `squad` field here beyond the optional `squadOverride` above — squad is computed by default; see "Squad is computed" above.

## Squads and guest appearances

A card normally lives on its computed home squad's page. If a player also
made a real matchday appearance (start, sub-on, or unused sub — not just an
injury/loan/etc. record) for a *different* squad, per that squad's
`fixtures-YYYY-YY.json`, they get a second card on that squad's page too,
badged with their actual squad (e.g. a U21 who played a first-team game
shows on the Senior page with a "U21" pill). A player can legitimately have
more than one card across the site this way — that's intended, not a bug.
This is also how U16s ever become visible at all (see above).

A card can carry **more than one pill at once**, but only for statuses that
remain true regardless of which page you're looking at — `loan`,
`incoming`, and `left`. E.g. a U21 named on the senior bench who's since
gone out on loan shows both "U21" and "On loan" stacked on the same card.
`not_selected_season`, `injured_season`, and `trialist` are different: they
describe an outcome specific to the player's *home* squad ("not selected
for the U21 matchday squad this season") and never stack onto a cross-squad
guest pill, since a guest appearance already proves they weren't in fact
absent from selection — just for a different squad. Enter this by giving
the player their normal home-squad status (e.g. `not_selected_season` on
their U21 roster entry) and logging their real appearances against
whichever squad's `fixtures-YYYY-YY.json` they actually played for — the
site works out the rest: "Not selected" (plain text, no pill) on their home
U21 page, just a "U21" pill on the Senior page where they're guesting.

### Card ordering within a position group

Within each position (Goalkeepers/Defenders/Midfielders/Forwards) on a
squad's page, cards appear in this order:

1. The squad's own active/left players, sorted by shirt number.
2. Cross-squad guests (players called up from a younger squad), sorted by
   name.
3. The squad's own players out on loan who've made at least one appearance
   before leaving, sorted by number.

**Position is the primary grouping, number is only a tiebreaker within it**
— a #14 defender and a #67 midfielder will show the #67 first, because
Defenders renders before Midfielders regardless of number. This is by
design (standard football-website convention: keepers, then defenders, then
midfielders, then forwards), not a sorting bug.

**A shirt number of `0` (or no `number` field at all) means "no number
assigned"** — it displays as a blank badge rather than "0", and sorts to
the *end* of its group rather than the front. Common for incoming
signings, trialists, and young academy players who haven't been issued a
squad number yet.

## Competition-only squads (e.g. `u19`)

Some seasons need a squad page for a one-off competition rather than a real
age group — e.g. 2025/26, where Champions League qualification meant an
Under-19 side entered the UEFA Youth League. That squad isn't computed from
`dob`/`ageBands` like `senior`/`u21`/`u18` are (see "Squad is computed,
not stored" above) — no age band ever produces it — so every player who
appears in it is, by definition, a cross-squad guest there, badged with
their real computed squad, exactly like any other guest appearance (see
"Squads and guest appearances"). There's nothing to keep in sync: you don't
add anyone to a roster file for it.

To add one:

1. Add a top-level key to that season's `fixtures-YYYY-YY.json` with the
   usual `{ fixtures, appearances }` shape (e.g. `"u19": { ... }`).
2. Add the key to `OPTIONAL_SQUADS` in `js/data.js` (once — it's a small,
   fixed list, currently just `['u19']`) and give it an entry in
   `SQUAD_LABEL` / `SQUAD_SHORT`.
3. That's it. The tab and page appear automatically, and only for a season
   whose fixtures file actually has that key — `squadKeysFor()` in
   `js/data.js` checks for it, and `app.js` hides the tab when it's absent.
   Because the squad has no roster of its own, its Player Info grid is
   entirely guest cards, and its tab count reflects players actually named
   in a matchday squad (start/sub-on/unused-sub) rather than an "active
   roster" size.

Don't add a genuinely recurring squad this way — `OPTIONAL_SQUADS` is for
one-off competitions that come and go with qualification, not a substitute
for a proper age band in `seasons.json`.

## seasons.json

Lists every season and which roster/fixtures files belong to it. The first
entry is the default season shown on load; `?season=<id>` in the URL selects
another one (works on both `index.html` and `gallery.html`). `gallery.html`
also builds a Season drop-down from this file, so you don't have to edit the
URL there — picking a season updates `?season=` for you, so the link stays
shareable/bookmarkable.

```json
[
  {
    "id": "2026-27", "label": "2026/27",
    "playersFile": "players-2026-27.json", "fixturesFile": "fixtures-2026-27.json",
    "ageBands": [
      { "squad": "u16", "bornOnOrAfter": "2010-09-01" },
      { "squad": "u18", "bornOnOrAfter": "2008-09-01", "bornBefore": "2010-09-01" },
      { "squad": "u21", "bornOnOrAfter": "2005-01-01", "bornBefore": "2008-09-01" }
    ]
  },
  { "id": "2025-26", "label": "2025/26", "playersFile": "players-2025-26.json", "fixturesFile": "fixtures-2025-26.json", "ageBands": [ /* ... */ ] },
  { "id": "2024-25", "label": "2024/25", "playersFile": "players-2024-25.json", "fixturesFile": "fixtures-2024-25.json", "requireDetailedStats": false, "ageBands": [ /* ... */ ] }
]
```

`playersFile` here is the **season roster** file, not the master file.
`players-master.json` is shared across every season and doesn't need
listing — it's assumed by default. If you ever need a season to read from a
different master file, add `"playersMasterFile": "..."` to that season's
entry.

`ageBands` is a list of `{ squad, bornOnOrAfter?, bornBefore? }` entries,
most-specific/youngest first — the first matching band wins. Both bounds are
optional and, where given, **half-open**: `bornOnOrAfter` is inclusive,
`bornBefore` is exclusive, so date ranges never gap or overlap at the
boundary. A dob that matches nothing (older than every band's
`bornOnOrAfter`) falls through to `senior`. Omitting `ageBands` (or leaving
it `[]`) makes every player in that season resolve to `senior`.

**These cutoffs are genuinely quirky by design, not a mistake**: U16/U18 use
a 1 September cutoff (the standard English football/school year), while U21
uses 1 January (a calendar-year cutoff) — two different rules for two
different reasons. They also shift every season as players age, so they're
data here, not code. 2025-26 and 2024-25's bands were extrapolated by
shifting the 2026-27 dates back one year per season — worth double-checking
those two against whatever the actual historical cutoffs were, if that
matters for old data.

`requireDetailedStats` (default `true`) controls whether the "Data checks"
panel nags about missing first-team minutes/xG for that season. It has no
effect on the other squads (they were never required to have this data), and
no effect on the *consistency* checks — minutes summing to 90×11, per-player
xG summing to the fixture's total xG — which only run when that data is
actually present regardless of this flag. Set it to `false` for a season
where minutes/xG were never recorded (2024-25, currently) so those warnings
don't pile up for something that can't be fixed. 2025-26 and 2026-27 are
still being tracked in detail, so they're left at the `true` default —
missing values there are real gaps worth flagging, typically because a
fixture just hasn't been played yet.

If `seasons.json` is missing entirely, the app falls back to
`players-master.json` + `players-season.json` + `fixtures.json` with no
season switcher and no age bands (everyone resolves to `senior`) — useful
for a quick single-season setup.

## fixtures-YYYY-YY.json

Unchanged by the master/season split — still one object per squad (`senior`,
`u21`, `u18`), each with a `fixtures` array and an `appearances` map keyed by
player `id`. See the in-code comments in `js/stats.js` (`validateFixtures`)
for the full set of checks run against this file, which double as
documentation of the expected shape: `status` (`start` / `sub_on` /
`unused_sub` / `injured` / `suspended` / `loan` / `transferred` / `incoming`
/ `unavailable`), plus `goals`, `assists`, `yellowCard`, `redCard`,
`minutes`, `xg`, and `allowNonPlayingStats` per appearance record.

## gallery.html

A standalone reference page (all HTML/CSS/JS in one file, no `js/*.js`
dependency) for auditing player photos across a season: every photo on
record for every player, in fallback order, each tile labelled with its
source key (`official`, `zerozero`, etc.) so you can spot at a glance which
source a photo came from — handy when deciding whether to trust it or
replace it.

Reads the same `players-master.json` + season roster + `seasons.json` as
`index.html`, via its own copies of `mergePlayers` and `photoCandidates`
(kept deliberately self-contained rather than sharing `js/data.js`, so this
page can be opened on its own). A Season drop-down (built from
`seasons.json`), search, squad filter, a "no photos" toggle and an "Only
photoSource problems" toggle live in the sticky header; each URL has a
one-click copy button for pasting into `players-master.json`. The roster and
master files are always re-fetched fresh, so editing them and switching
season (or refreshing) shows the change.

### What "In use" means

The tile outlined in green / badged **In use** is the photo the season
roster's `photoSource` names — not simply whichever image happens to load
first. Cases:

| Situation | What you see |
|---|---|
| `photoSource` set, photo loads | That tile: green, **In use**. It's also moved to position 1. |
| `photoSource` set, but the player's `photos` has no such key, or its URL is `""` | Amber chip in the player's header (`photoSource "x" — no photo on record for it`), amber outline on the player's block, and the photo the main site would actually fall back to is badged **Fallback showing**. |
| `photoSource` set, photo exists but fails to load | Chip says it didn't load; that tile gets a red **Specified · failed** badge; the fallback that's really showing is badged **Fallback showing**. |
| No `photoSource` | First photo that loads, badged **In use · auto** (this is what the main site does by default). |

The header stat line counts how many players have a `photoSource` problem,
and "Only photoSource problems" filters to them. A missing photoSource photo
is known immediately; the specified photo is loaded eagerly so a broken one
is caught without scrolling, but the *Fallback showing* marker for that
player only appears once the other (lazy-loaded) tiles have loaded, i.e.
when you scroll to them. The "Photo sources" table at the bottom counts what's
actually showing (green + amber tiles).

### Picking a photo and saving it

Every tile has a **Use this photo** button. Clicking it sets that player's
`photoSource` for the season you're viewing, immediately re-orders their tiles
and re-marks "In use". **Clear photoSource** (in the player's header) removes
the property so they revert to the default order. Only the roster file
(`players-YYYY-YY.json`) is ever changed — never `players-master.json`.

A static page can't write to disk by itself, so there are two routes:

1. **Chrome / Edge (over `http://localhost`)** — click **Connect site
   folder…** once per visit and choose the folder that contains
   `gallery.html`. From then on each pick is written straight into that
   season's roster file. The browser will ask you to allow editing that folder.
2. **Any browser** — picks are held in the page; **Download
   players-YYYY-YY.json** gives you the updated roster to drop over the old one.
   (Also the fallback if a write fails.) Switching season or closing the tab
   with unsaved picks asks for confirmation.

Either way the change is a surgical text edit of just that one roster entry
(adding or replacing `"photoSource": "..."`), so the rest of the file's
formatting, indentation and line endings are left exactly as they were. The
result is re-parsed before being written, and the write is refused if
anything looks off. When saving to a connected folder, the file is re-read
from disk each time, so edits you've made elsewhere in the meantime aren't
overwritten.

## Adding a new season

1. Copy the previous season's roster file to `players-YYYY-YY.json` and
   update `number`/`status`/`loanClub`/etc. — no need to touch names, DOBs,
   photos, or squad (squad is computed automatically — see above).
2. Add any brand-new players to `players-master.json` first (name,
   nationality, dob, position, photos), then reference their `id` in the new
   roster file. `gallery.html` is a good way to check the new arrivals'
   photos resolve correctly once added.
3. Create a fresh `fixtures-YYYY-YY.json`.
4. Add an entry to `seasons.json` (as the *first* entry, if it's now the
   current season), including that season's `ageBands` — these shift every
   year, so don't just copy the previous season's dates unchanged.

**Don't hand-write a season roster file as a full player record** (i.e.
don't copy name/dob/position/photos into it) — that data belongs in
`players-master.json` only. If a season file does end up with full player
data in it (e.g. because it started life as a plain export before the
master/season split existed), split it: pull the master-only fields into
`players-master.json` (filling in any gaps there, not overwriting fields
that already have a value), convert `photos` from an array to a keyed
object, and trim the season file back down to `id`/`number`/`status`/etc.

## Not in the matchday squad

On each squad's page, everyone who isn't part of the active playing picture
— on loan with no appearances yet, incoming, season-long injured, not
selected, or a trialist — is shown together in one muted grid, right after
Player Info and before the fixture-by-fixture detail. It's deliberately one
flat grid rather than five headed subsections, since each card's own detail
line (loan club, injury note, etc.) already says why they're there; and it's
deliberately muted (lower opacity, desaturated photo, full colour on hover)
so it reads at a glance as "not currently playing" without being hidden away
at the bottom of the page.

A player in one of these states who *does* pick up a genuine appearance
before their status is updated back to `active` shows up as a normal guest
card with a status pill instead (same mechanism as any cross-squad guest —
see "Squads and guest appearances" above), not in this muted section.

## File/code layout

| File | Purpose |
|---|---|
| `index.html` | Markup only, for the squad tracker. |
| `gallery.html` | Standalone photo-audit page — self-contained, doesn't use `js/*.js`. |
| `styles.css` | All styling for `index.html`. |
| `js/data.js` | Fetching, master/season merging, photo-candidate resolution, and small pure helpers (`calcAge`, `fmtDate`, `normSquad`). |
| `js/stats.js` | Appearance-stat aggregation and the data-validation checks that power the "Data checks" panel. |
| `js/render.js` | Every DOM-building function: player cards, the fixture matrix, fixtures list, leaderboards, side panels, the season switcher. |
| `js/app.js` | Wiring: `init()` loads everything and calls the `render.js` builders; `setupTabs()` handles the squad tabs. Entry point. |
## Player profile (`player.html?id=<player-id>`)

Shows bio, career totals by squad, every season's fixture-by-fixture strips, then a season summary. It reads every season in `seasons.json`, so nothing needs listing per player.

Two optional fields in `players-master.json` drive the extras:

```json
{
  "id": "u21-example",
  "careerComplete": true,
  "movements": [
    { "type": "joined",   "date": "2021-07-01", "club": "Team X" },
    { "type": "loan_out", "date": "2025-08-01", "endDate": "2026-05-31", "club": "Team Y", "note": "Recalled early" },
    { "type": "left",     "date": "2027-06-30", "club": "Team Z" }
  ]
}
```

- `careerComplete: true` means every season he played in is covered by the data files. Leave it out (or `false`) for anyone who may have played before the earliest season in `seasons.json`; his profile then shows "Partial record".
- `movements`: `type` is `joined`, `left`, `loan_out`, `loan_in` or `trial_in`. `date` is `YYYY-MM-DD` (`YYYY-MM` or `YYYY` also work if the exact day is unknown); shown as dd/mm/yyyy. Loans take an optional `endDate` (no `endDate` shows "ongoing"). `note` is optional. `trial_in` also takes an optional `endDate`.
- A `loan_out` spell also marks the profile: a band appears on any season it overlaps, and fixtures inside the loan dates with no appearance record show the ⇄ loan marker. Only Newcastle matches are tracked, so nothing from the loan club is shown.

- **Movement checks:** for players with `careerComplete: true`, being named in a matchday squad (started, came on, or unused sub) on a date that falls inside a `loan_out` spell, before he joined, or after he left (outside any `joined`→`left`, `loan_in` or `trial_in` window) is flagged. These show in the "Data checks" panel on the squad page and on the player's profile. Players without `careerComplete` are not checked.

- **Profile status:** worked out from `movements` and today's date (on loan, trialist, on loan from, left, incoming). A player with no movements uses his roster `status`; one with movements keeps only the roster's injured / not-selected statuses as a fallback.

## players-archive.json

Same format as `players-master.json`, for players who have left. Every page reads both files (the archive sits in the same folder as the master file), so old seasons and profiles still resolve names. If an id is in both files the master entry wins and a console warning is logged. A missing archive file is fine.

On a local server only (never on a published copy): current players who aren't yet `careerComplete` get a small amber "To do" badge on their photo, and a line above the Data checks panel reads "Career data: X of Y current players complete" — click it for the list of who's left, each linking to their profile. Data checks also warn about an archived player without `careerComplete`, and about an id that's in both the master and archive files.