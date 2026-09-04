# Data Guide — The Teamsheet

Two files hold all the data for a season. Edit them directly in a text editor and refresh the page — nothing else needs to change.

- `players.json` — one entry per player: who they are.
- `fixtures.json` — one entry per squad: the fixture list and, for each fixture, who did what.

**Appearance stats are calculated automatically from `fixtures.json`.** `players.json` only holds biographical info — there's no stats block to keep in sync by hand any more. If a player's numbers look wrong, the fix is always in `fixtures.json`.

Run the page from a local server, not by double-clicking `index.html` — see the note at the bottom.

## Multiple seasons

The page supports tracking more than one season's worth of data, with a **Season** dropdown in the top-right of the header to switch between them. This is entirely optional — a single-season setup using plain `players.json` / `fixtures.json` (as described above) keeps working exactly as it always has, with no dropdown shown at all, until you deliberately opt in.

To opt in, add a new file, **`seasons.json`**, alongside the others:

```json
[
  {
    "id": "2026-27",
    "label": "2026/27",
    "playersFile": "players-2026-27.json",
    "fixturesFile": "fixtures-2026-27.json"
  },
  {
    "id": "2025-26",
    "label": "2025/26",
    "playersFile": "players-2025-26.json",
    "fixturesFile": "fixtures-2025-26.json"
  }
]
```

It's an array, one object per season:

| Field | Required | Meaning |
|---|---|---|
| `id` | Yes | A short, URL-safe identifier for the season, e.g. `"2026-27"`. This is what shows up in the address bar (`?season=2026-27`) when that season's selected. |
| `label` | No | The human-readable text shown in the dropdown, e.g. `"2026/27"`. Falls back to `id` if omitted. |
| `playersFile` | Yes | Path to that season's players file, e.g. `"players-2026-27.json"`. Same format as `players.json` described below — just a different filename. |
| `fixturesFile` | Yes | Path to that season's fixtures file, e.g. `"fixtures-2026-27.json"`. Same format as `fixtures.json` described below. |

**The first entry in the array is the default season** — whichever one loads when someone opens the page with no `?season=` in the URL. List your current/most recent season first.

Each season is a completely separate pair of files — a full `players.json`-shaped file and a full `fixtures.json`-shaped file per season, with no cross-referencing between seasons. Nothing about how you structure a single season's two files changes — squads, statuses, fixtures, appearances, validation, all exactly as documented below, just scoped to whichever season's files are currently loaded. This also means each season's stats, leaderboards, and validation are entirely independent — nothing carries over or gets combined across seasons automatically. A player who's active in two seasons needs an entry in *both* players files, once each.

**To migrate an existing single-season setup:**

1. Rename your current `players.json` and `fixtures.json` to something season-specific, e.g. `players-2026-27.json` and `fixtures-2026-27.json` (any naming works — `seasons.json` just needs to point at whatever you called them).
2. Add `seasons.json` listing that one season, pointing at the renamed files.
3. Refresh — the dropdown appears, with your existing data now showing under that season.
4. Next season, duplicate the previous season's two files under new names (e.g. `players-2027-28.json`, starting from a copy of the departing squad, and a fresh empty `fixtures-2027-28.json`), add a new entry to the *top* of `seasons.json`, and you're switching between both.

**How switching works:** picking a season from the dropdown reloads the page with `?season=<id>` in the URL — a full refresh, not a live in-page swap. This keeps things simple and guarantees everything (roster, matrix, leaderboards, validation panel) is rebuilt cleanly from that season's files. Your currently open squad tab is preserved across the switch (it's tracked separately, in the URL's `#senior`/`#u21`/`#u18` hash). A URL with both — e.g. `?season=2025-26#u21` — is a direct, bookmarkable link to a specific season and squad.

If `seasons.json` is missing, empty, or fails to load for any reason, the page quietly falls back to the original single-season behaviour (`players.json` / `fixtures.json`, no dropdown) — so there's no rush to migrate, and no risk of a typo in `seasons.json` breaking an otherwise-working page.

## Page layout

The three squads (First Team / Under-21s / Under-18s) are separate **tabs** — only one is visible at a time, and the URL hash (`#senior`, `#u21`, `#u18`) tracks which one so a link to a specific squad is bookmarkable.

Each squad's tab has four parts, in order:

1. **Player Info** — a grid of player cards (photo, shirt number, name, position, age, nationality) grouped by position, several per row. Bio only, no match stats.
2. **Fixture-by-fixture** — the player × fixture matrix. Each cell shows only what can be read off the appearance `status` (started / sub on / unused sub / injured / suspended / on loan / transferred / unavailable / not in squad) — no goals or cards overlaid on the cells. A **Total** column on the right shows each player's appearance count. Rows are sorted by that appearance count, most to fewest, with the squad's own roster taking priority over guest rows on a tie (see "Row order in the fixture matrix" below) — except own players out on loan, who always sink to the very bottom regardless of appearances. League, cup, and European fixtures are shown in different colours in the column headers (and a light tint down the whole column) — see "League vs cup vs European colouring" below.
3. **Leaderboards** — small ranked tables (top 10) for Goals, Assists, Yellow cards, Red cards, and, for the First Team only, Minutes played and xG. A leaderboard just doesn't render if nobody has a non-zero value for it yet.
4. **Out on loan** / **Incoming** / **Left the club** panels — each one only renders if there's actually someone in it; an empty panel is skipped entirely rather than showing a "nobody here" message. Cards in these panels use the same photo/number/position/age/nationality layout as the main **Player Info** cards, plus one extra line with the status-specific detail (loan club, incoming from/expected date, or new club/date left).

The underlying data in `fixtures.json` is unchanged by this — goals, assists, cards, minutes, and xG are still logged per fixture exactly as described below, they're just displayed via the leaderboards and validation rather than inline in the matrix.

### Stats are scoped to the squad they actually happened in

The **Total** column and every **Leaderboard** on a squad's tab are calculated only from that squad's *own* `fixtures.json` entry — not aggregated across all three squads. This matters for anyone who's played up (or down) a level: if a U18 player has only ever turned out for the U21s, their card, goal, or appearance shows up in the **U21s** tab (where the match actually happened), not on their home **U18s** tab, even though `players.json` still lists them as a U18 player. A player who genuinely never played for U18s this season will show zero everywhere on the U18s tab and simply won't appear in any U18s leaderboard.

When a leaderboard entry belongs to someone whose `squad` field doesn't match the tab you're looking at (or who's currently `"loan"`/`"incoming"`), their name carries the same small badge used in the matrix (e.g. `U18`, `On loan`) so it's clear at a glance where they actually belong.

---

## players.json

An array of player objects.

```json
{
  "id": "s-pope",
  "squad": "senior",
  "name": "Nick Pope",
  "number": 1,
  "position": "GK",
  "nationality": "England",
  "dob": "1992-04-19",
  "photo": "https://example.com/pope.png",
  "status": "active"
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | Yes | Unique across the whole file, all three squads. Used to link a player to their fixture records. Convention: `s-`, `u21-`, `u18-` prefix + surname. |
| `squad` | Yes | `"senior"`, `"u21"`, or `"u18"` — the player's **home/registered squad**. This decides which section their roster row and season totals appear under. It does **not** limit which fixture lists they can appear in — see "Playing up a squad" below. |
| `name` | Yes | Display name. |
| `number` | No | Shirt number. Use `0` if unassigned/unknown — the page won't display it specially, so consider leaving a placeholder like `99` if you'd rather it sort to the bottom. |
| `position` | Yes | `"GK"`, `"DEF"`, `"MID"`, or `"FWD"`. Controls which position group the player is grouped under. |
| `nationality` | No | Free text. |
| `dob` | No | `YYYY-MM-DD`. Age is calculated automatically; leave blank (`""`) if unknown. |
| `photo` | No | Image URL. Leave `""` if you don't have one — the page just hides a broken image gracefully. |
| `status` | No | `"active"` (default if omitted), `"loan"`, `"incoming"`, or `"left"`. See below. |

### Player status: active / loan / incoming / left

This answers your questions about players who aren't currently part of the first-team picture directly.

- **`"active"`** (or omit the field) — shows up normally in their squad's roster table and fixture matrix.
- **`"loan"`** — pulled out of the main roster and fixture matrix entirely, and instead listed in an **"Out on loan"** panel at the bottom of their squad's section. Add this optional field alongside `status`:
  - `"loanClub"`: where they're out on loan, e.g. `"Sheffield United"`.
- **`"incoming"`** — same idea, but for a confirmed signing who hasn't started playing for the club yet. Shown in an **"Incoming"** panel. Optional fields:
  - `"fromClub"`: previous club.
  - `"expectedDate"`: `YYYY-MM-DD`, shown as their expected join/eligibility date.
- **`"left"`** — for a player who was part of the squad this season but has since departed (transferred, released, retired...) partway through. Pulled out of the main roster the same way, and listed in a **"Left the club"** panel instead. Optional fields:
  - `"newClub"`: where they went, e.g. `"Real Madrid"`. Leave blank/omit if unknown, released, or retired.
  - `"leftDate"`: `YYYY-MM-DD`, shown as the date they left.

Any of these three statuses only changes which table the player's card physically sits in — it never affects their stats. If a player logged appearances earlier in the season (say, `s-isak` scored a hat-trick in August before being sold in the same window), those appearance records in `fixtures.json` don't need to change at all: his goals, appearances, and everything else still total up correctly and still count towards the squad's **Total** column and **Leaderboards** — flipping his `status` to `"left"` only moves his Player Info card out of the main grid and into the "Left the club" panel. If he still has logged appearances for that squad, he'll also still show as an extra row in the fixture matrix (same mechanism as a loan player — see "Loan players in the fixture matrix" below), so his individual match-by-match record stays visible too.

A loan, incoming, or departed player's stats will still calculate correctly from `fixtures.json` if you ever do log an appearance for them (e.g. a returning loanee plays a game before you've flipped their status back to `"active"`) — the automatic totals aren't affected by `status`, only which table they physically appear in.

Once a loan spell ends, a signing arrives, or you no longer need to track a departed player, just change `status` back to `"active"` (or delete the field).

---

## fixtures.json

One object per squad (`senior`, `u21`, `u18`), each with its own fixture list and its own appearance log:

```json
{
  "senior": {
    "fixtures": [ ... ],
    "appearances": { ... }
  },
  "u21": { ... },
  "u18": { ... }
}
```

### `fixtures` array

```json
{ "id": "s-f1", "date": "2026-08-16", "opponent": "Aston Villa", "venue": "H", "competition": "Premier League", "result": "W 3–1", "subsUsed": 4, "subsUnused": 3, "ownGoalsFor": 0, "redCardMinutesLost": 12 }
```

| Field | Required | Notes |
|---|---|---|
| `id` | Yes | Unique **within that squad's fixture list**. Convention: `s-f1`, `u21-f1`, `u18-f1`... |
| `date` | Yes | `YYYY-MM-DD`. Fixtures render in the order they appear in the array — keep the array in date order. |
| `opponent` | Yes | Free text. |
| `venue` | Yes | `"H"` or `"A"`. Shown as a small letter under the fixture number in the matrix header. |
| `competition` | No | Shown on hover over the fixture's column header. |
| `gameweek` | No | The number shown in the matrix column header. If omitted, the column just shows its position in the array (1, 2, 3...). Set this explicitly if you want it to show the actual Premier League gameweek number rather than a running count — useful once cup fixtures are mixed into the same list, since those would otherwise throw the running count out. |
| `result` | No | **Must be `"W"`/`"D"`/`"L"` followed by a score, e.g. `"W 3–1"`, `"D 1-1"`.** The first number is always Newcastle's goals, the second the opponent's — regardless of home/away. Leave `""` until played. This also drives the goals-tally check below, so keep the format consistent (either dash `-` or en dash `–` both work). |
| `subsUsed` | No | The actual number of substitutes used in the match, if you want it double-checked against the player records (see validation below). Omit if you don't want this checked. |
| `subsUnused` | No | The actual number of unused substitutes on the bench. Same deal — omit to skip the check. |
| `assistsTotal` | No | The actual number of assists in the match, cross-checked against the sum of every player's `assists` for that fixture. Omit to skip. |
| `yellowCardsTotal` | No | The actual number of yellow cards shown, cross-checked against the count of `yellowCard: true` records. Omit to skip. |
| `redCardsTotal` | No | Same idea, for red cards. Omit to skip. |
| `xg` | No | **First team only.** The match's total expected goals, cross-checked against the sum of every player's `xg` for that fixture (see "Senior-only validation" below). |
| `redCardMinutesLost` | No | **First team only.** When a player's sent off, the team plays the rest of the match a man down, so the XI's total minutes will legitimately fall short of 990 by however many minutes were left when the red card happened. Set this to that many minutes and the 990 check (see "Senior-only validation" below) expects `990 − redCardMinutesLost` instead. Omit if there was no red card that match. |
| `ownGoalsFor` | No | Number of opposition own goals that contributed to Newcastle's tally in this match. Own goals aren't credited to any Newcastle player's `goals` count, so without this the goals-tally check would flag a false mismatch. |

With 38 league fixtures (plus cups) in a season, the matrix columns are intentionally narrow — each just shows a fixture number and a small `H`/`A`. Hover over a column header for the full date, opponent, competition and result.

### `appearances` object

Keyed by player `id`, then by fixture `id`:

```json
"s-burn": {
  "s-f1": { "status": "start", "goals": 1, "yellowCard": true },
  "s-f2": { "status": "start" }
}
```

Each per-fixture record supports:

| Field | Required | Notes |
|---|---|---|
| `status` | Yes | One of `"start"`, `"sub_on"`, `"unused_sub"`, `"injured"`, `"suspended"`, `"loan"`, `"transferred"`, `"incoming"`, `"unavailable"`. See below. |
| `goals` | No | Number scored in that match. Omit or `0` if none. |
| `assists` | No | Number of assists in that match. |
| `yellowCard` | No | `true`/`false`. |
| `redCard` | No | `true`/`false`. |
| `minutes` | No | Minutes played in that match. Only shown/tracked for the **first team** — see "Senior-only columns" below. |
| `xg` | No | This player's individual expected goals for that match (decimal, e.g. `0.34`). Only shown for the **first team** — see "Senior-only columns" below. Not the same field as the fixture-level `xg` (that's the team total — see the fixtures table above).

**A player with no entry at all for a given fixture** is treated as "not in squad that day" — shown as a small dot in the matrix, and doesn't affect their stats. You don't need to add an explicit record for every player for every match — only add one when something happened (they were involved, or you specifically want to record they were unavailable).

`status` values:
- `"start"` — started the match. Counts as an appearance and a start.
- `"sub_on"` — came on as a substitute. Counts as an appearance and a sub appearance.
- `"unused_sub"` — on the bench, didn't play. Doesn't count as an appearance.
- `"injured"` — unavailable through injury. Doesn't count as an appearance. Shown as a small red `+`.
- `"suspended"` — unavailable through suspension (cards, disciplinary). Doesn't count as an appearance. Shown as a small amber card icon (`▮`).
- `"loan"` — unavailable specifically because they're out on loan that match. Doesn't count as an appearance. Shown as a small amber `⇄` (out and, eventually, back). This is for logging a *specific fixture* as missed due to a loan spell — see "Loan players in the fixture matrix" below for how a loaned-out player's row appears at all.
- `"transferred"` — unavailable specifically because they've **permanently left** the club by that match (sold, released, retired...). Doesn't count as an appearance. Shown as a small claret `→` (moved on, one-way). Pair it with `status: "left"` on the player's `players.json` entry (see "Player status" above) to also move their card into the "Left the club" panel and get the "Left" row badge in the matrix.
- `"incoming"` — the mirror image of `"transferred"`: unavailable specifically because they **hadn't joined the club yet** by that match (a mid-season signing who wasn't yet eligible/registered). Doesn't count as an appearance. Shown as a small sky-blue `←` (arriving, one-way). Pair it with `status: "incoming"` on the player's `players.json` entry (already described above) to also get the "Incoming" panel card and row badge.
- `"unavailable"` — anything else (rested, international duty, personal reasons, illness...). Doesn't count as an appearance. Shown as a dash.

The `"loan"` / `"transferred"` / `"incoming"` trio is deliberately symmetric with the three non-`"active"` player statuses in `players.json`: a loan spell, a permanent departure, and a not-yet-joined signing each get both a fixture-level status (for marking *which specific matches* were missed because of it) and a player-level status (for where their card and row badge sit). A player can pick up a run of `"transferred"` records after leaving mid-season (goals scored earlier in the season under `"start"` still count, per "Player status" above), and symmetrically, a new signing can have a run of `"incoming"` records for the fixtures before they arrived, then switch to normal `"start"`/`"sub_on"` records — and their `players.json` `status` — once they're actually turning out.

For `"injured"`, `"suspended"`, `"loan"`, `"transferred"`, or `"incoming"` records you can add an optional `"reasonNote"` field with free text (e.g. `"hamstring, ~3 weeks"`, `"one-match ban"`, `"out at Sheffield United"`, `"signed for Real Madrid"`, `"registration pending"`) — it shows on hover over that cell in the matrix.

### Minutes tracking is optional and all-or-nothing per player

If you never add `minutes` to any of a player's records, their **Mins** column shows `—` rather than `0`, so it's clear it's untracked rather than actually zero. If you add `minutes` to at least one of their appearances, the column sums whatever you've entered — so if you want accurate season totals, add it consistently. If you don't care about minutes, just skip the field everywhere and ignore the column.

### Senior-only columns: Minutes and xG

**Mins** and **xG** only appear in the **First Team** roster table — they're hidden entirely for the U21s and U18s sections, regardless of whether you've entered the data. This is a display choice, not a data restriction: if you did add `minutes` or `xg` to a U21/U18 appearance record (e.g. because they played up for the seniors and it landed in the senior fixture list), it's still totalled correctly behind the scenes — it just won't be shown on their U21/U18 row. `xg` takes a decimal (e.g. `0.34`) and is summed and shown to two decimal places.

---

## Playing up a squad (U18s appearing for U21s, etc.)

A player's `squad` field in `players.json` is their **home squad** — where their **Player Info** card lives. It doesn't stop them from being logged in another squad's fixtures.

To log a U18 player appearing for the U21s: just add an entry for their existing `id` into the **u21** squad's `appearances` object in `fixtures.json`, against a **u21** fixture `id`. For example, if `u18-hutchison` gets called up:

```json
"u21": {
  "fixtures": [ ... ],
  "appearances": {
    "u18-hutchison": { "u21-f2": { "status": "start", "goals": 1 } }
  }
}
```

You don't create a second player entry and you don't change their `squad` field. On the page, this shows up two ways:

1. In the **U21s** fixture matrix, `u18-hutchison` appears as an extra row below the regular U21 roster, italicised with a small `U18` tag, so it's clear they're guesting up rather than a permanent U21 player.
2. Their goal counts towards the **U21s** Total column and the **U21s** leaderboards — not the U18s ones — because stats are scoped to whichever squad's fixture list the entry actually sits in (see "Stats are scoped to the squad they actually happened in" above). Their Player Info card still lives on the U18s tab; it just won't carry this goal anywhere in its stats, since as far as the U18s are concerned, it didn't happen there.

The same mechanism works for a U21 playing up for the seniors, or (less commonly) a senior playing down — just add the appearance record to whichever squad's fixture list matches the match that was actually played, using the player's existing `id`.

## Loan / left / incoming players in the fixture matrix

A player with `status: "loan"`, `"left"`, or `"incoming"` is pulled out of their squad's main roster and matrix (see "Player status" above) — but if they still have appearance entries logged against that squad's own fixtures (e.g. you'd already marked a run of matches `"unavailable"` before a loan move went through, or `s-isak` scored a hat-trick before being sold), those entries don't just vanish: the player still shows as an extra row in the matrix, same as a cross-squad guest.

The badge on that row tells you *why* they're an extra row, and it's picked automatically:

- If their `squad` field points to a **different** squad than the one you're looking at, the badge shows that squad (`U18`, `U21`, `Seniors`) — a genuine guest appearance.
- If their `squad` field matches the squad you're looking at, but their `status` is `"loan"`, the badge reads **"On loan"** instead — this is one of the squad's own players, just not currently available.
- Same idea for `status: "incoming"` — the badge reads **"Incoming"**.
- Same idea for `status: "left"` — the badge reads **"Left"**.

Each of these four kinds of row also gets its own background tint on the name cell, so you can tell them apart at a glance without reading the badge text: a genuine cross-squad guest is green, an on-loan row is amber, an incoming signing is sky blue, and a departed player is claret — matching the colours used for the equivalent status marker in the matrix cells and the panel cards below. A normal roster row has no tint at all.

So for a loaned-out (or departed) player you get two independent layers: the row's badge and background tint mark them as on loan/left/incoming for the whole section, and the fixture-level `"loan"`/`"transferred"`/`"incoming"` status on individual records marks specifically *which* matches they missed because of it (as opposed to being injured or dropped for some other reason in between). See "Row order in the fixture matrix" below for exactly how these rows are sorted relative to everyone else — loan rows in particular are treated differently from left/incoming rows.

## Row order in the fixture matrix

Every row in the matrix — the squad's own roster and any guest rows (cross-squad guests, plus the squad's own loan/incoming/left players who still have logged appearances) — is sorted together with one set of rules, in this order:

1. **Own players currently out on loan always sink to the very bottom**, below everyone else, no matter how many appearances they've made this season. They're not part of the current matchday picture, so they're kept out of the way rather than competing for a spot near the top on appearance count. (This applies only to `status: "loan"` rows — a `"left"` or `"incoming"` guest row, or a genuine cross-squad guest like a U18 called up to the U21s, is not affected and sorts in with everyone else normally.)
2. **Everyone else is ranked by appearance count**, most to fewest — so a U18 guest who's played 15 games for the U21s this season will sit above a fringe U21 squad player who's played 3, for example.
3. **On a tie, the squad's own roster player is listed before a guest row.**
4. Any remaining tie is broken alphabetically.

## League vs cup vs European colouring

In the fixture-by-fixture matrix, a fixture's column header (and a light tint down its whole column) is coloured differently depending on whether it's a league match, a cup match, or a European match. This is picked automatically from the `competition` field, checked in this order:

1. **European** — if `competition` contains `"Champions League"`, `"Europa League"`, or `"Conference League"` (case-insensitive), the column is styled as a European fixture (a blue tone).
2. **Cup** — otherwise, if `competition` contains the word **"cup"** or **"trophy"** (case-insensitive — `"FA Youth Cup"`, `"EFL Cup"`, `"EFL Trophy"`, `"Premier League Cup"`, all match), the column is styled as a cup fixture (a purple tone).
3. **League** — anything else is treated as a league fixture (the default dark styling).

There's no separate field to set — just make sure `competition` reads correctly (containing "Champions League"/"Europa League"/"Conference League" for European fixtures, or "Cup"/"Trophy" for domestic cup fixtures) and the colouring follows automatically. The legend at the top of the matrix has a small swatch key for all three colours.

---

## Data checks

The page cross-checks `fixtures.json` against itself and against `players.json` every time it loads, and shows the results in a **"Data checks"** panel near the top of the page. If nothing's wrong, the panel doesn't appear at all — no news is good news. When it does appear, each issue names the squad and fixture so you can go straight to the fix. Flagged fixtures also get a small ⚠ on their column header in the matrix, with the specific message(s) on hover.

A fixture is only fully checked (starters, goals, etc.) once someone actually has a `"start"` or `"sub_on"` record against it — so pre-marking a loan player `"unavailable"` for a future match doesn't trigger a "no starters" warning before the game's even been played. But a `result` entered with nobody logged as playing is never silently skipped, regardless of the scoreline:

- If **no appearance records exist at all** for that fixture, that's flagged as an error ("result is entered but no player appearances have been logged for this fixture at all") — a result with nobody's data logged is clearly incomplete.
- If **some records exist but none of them are `"start"` or `"sub_on"`** (e.g. only a loan/injured/unavailable placeholder has been added so far), that's also flagged as an error ("result is entered but no players are logged as having started or come on as a substitute for this fixture"). This catches a scoreless-for-us result (a 0–0 draw, or a loss where your side didn't score) that would otherwise pass the goals check below by coincidence — 0 logged goals equals 0 scored, even though the lineup itself hasn't been touched.
- If a fixture has **no** `result` but its `date` has already passed, that's flagged as a warning instead, since it's likely just been forgotten rather than genuinely not played yet.
- A future fixture with neither a `result` nor a past `date` is left alone — nothing to check yet.

The goals-vs-result check below only runs once there's an actual lineup to check against (at least one `"start"` or `"sub_on"` record) — otherwise the two checks above would double up or produce a misleading "0 = 0"-style comparison against an empty lineup.

What's checked, for any fixture with at least one player logged as having played:

- **Starters** — exactly 11 `"start"` records.
- **Subs used / unused** — only if you've set `subsUsed` / `subsUnused` on that fixture; checked against the count of `"sub_on"` / `"unused_sub"` records.
- **Goals** — once there's an actual lineup logged (at least one `"start"` or `"sub_on"` record), the sum of every player's `goals` for that fixture (plus `ownGoalsFor`, if set) must equal the "for" score parsed from `result`. The message only mentions own goals when `ownGoalsFor` is actually set — e.g. `"result shows 2 goals for, but player records total 0."` for a straightforward shortfall, or `"...total 1 + 1 own goal = 2."` when an own goal is part of the tally.
- **Assists vs goals** — total assists logged can't exceed total goals logged in the same match.
- **Declared totals vs player records** — if you've set `assistsTotal`, `yellowCardsTotal`, or `redCardsTotal` on a fixture, they're checked against the sum/count from player records. Same pattern as `subsUsed`/`subsUnused`. All optional — omit any of them to skip that particular check.
- **Completeness once a result is entered** — the checks above only fire once a field is actually present, so a field you forgot entirely would otherwise pass silently. Once `result` is filled in for a fixture with a logged lineup, the validator now also nags for anything still missing: `subsUsed`, `subsUnused`, `assistsTotal`, `yellowCardsTotal`, `redCardsTotal`, and — for the First Team only — the fixture's own `xg` and every playing player's `minutes`. These are warnings, not errors: a fixture with a result but a lineup still being filled in isn't "wrong", just incomplete. The idea is that once you've committed to entering a result, the page reminds you what else is worth finishing off, rather than only catching mistakes in fields you already remembered to add. Note there's deliberately **no** nag for an individual player missing `xg` — not every player needs one logged (see "Senior-only validation" below for what actually gets checked on `xg`).
- **W/D/L vs scoreline** — flags it if, say, `result` says `"W"` but the scoreline is level or behind.
- **Stray stats on a non-playing record** — an `"unused_sub"`, `"injured"`, `"suspended"`, `"loan"`, `"transferred"`, `"incoming"`, or `"unavailable"` record with goals, assists, cards, or xG attached is flagged, since none of those should happen without playing.
- **Unknown player ids** — an id in `fixtures.json` appearances that doesn't exist in `players.json` (usually a typo).
- **Duplicate fixture ids** within the same squad's fixture list.

### Senior-only validation: total minutes and xG

Two extra checks run **only on First Team fixtures**:

- **Minutes should total 990** — the sum of `minutes` across everyone with a `"start"` or `"sub_on"` record should equal 11 × 90. This only runs once *every* playing record for that fixture has a `minutes` value — partial minutes data is skipped rather than flagged, since a partial sum is expected to look "wrong". It's a warning rather than an error, because a non-90-minute match can legitimately produce a different total. If a player was sent off, set `redCardMinutesLost` on the fixture (see the fixture field table above) to however many minutes remained when it happened — the check then expects `990 − redCardMinutesLost` instead of flat 990, so a correctly-recorded red card doesn't nag you every time.
- **xG should tally** — if you've set `xg` on the fixture (the match's total expected goals), the sum of every playing player's `xg` for that fixture must match it (within a small rounding tolerance). Unlike minutes, this doesn't require *every* player to have an `xg` value first — you don't need to log an individual xG for every single player, just make sure whichever ones you do log add up to the fixture's total. It's an error rather than a warning, since a declared team xG that doesn't match its own components is a straightforward mistake, not a legitimately variable outcome.

Everything here is a nudge, not a hard stop — the page still renders normally either way.

## Running the page

Browsers block a page opened directly from disk (`file://...`) from fetching local JSON files. From this folder, run:

```
python3 -m http.server 8000
```

then open `http://localhost:8000` in your browser. (Any other local static server works too — this is just the one every machine already has.)