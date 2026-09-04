# series-data.json field reference

The whole site is built from this one file. `motorsport.html`/`.js`/`.css`
never need editing just to add, remove, or change a series — and neither
does the file's grouping. There's a single flat `series` array; which
section each series appears under (Overdue, This week, etc.) is worked out
automatically from `nextDate` every time the page loads.

```json
{
  "series": [
    {
      "name": "Formula 1",
      "category": "formula1",
      "links": {
        "official":  { "url": "https://...", "label": "Official site", "active": true },
        "results":   { "url": "https://...", "label": "Results",       "active": true },
        "standings": { "url": "https://...", "label": "Standings",     "active": true },
        "calendar":  { "url": "https://...", "label": "Calendar",      "active": true }
      },
      "nextDate": "5 Sep 2026",
      "social": [
        { "platform": "x-twitter", "url": "https://x.com/f1" },
        { "platform": "facebook",  "url": "https://facebook.com/Formula1" }
      ]
    }
  ]
}
```

## How grouping works

`motorsport.js` sorts every series into a section based purely on
`nextDate`, using today's date at page-load time:

| Condition on `nextDate` | Section |
|---|---|
| `resultsVerified` is not `true` | `[year] motorsport series : Overdue` — regardless of `nextDate` |
| `resultsVerified` is `true`, `nextDate` a full date, within the next 7 days | `[year] motorsport series : This week` |
| `resultsVerified` is `true`, `nextDate` a full date, more than 7 days away (past or future) | `[year] motorsport series` |
| `resultsVerified` is `true`, `nextDate` a bare year only (e.g. `"2027"`) | `[year] motorsport series : To be scheduled` |

Overdue is a **pure manual flag** — the date is not consulted at all. A
series stays in Overdue for as long as `resultsVerified` is anything other
than `true`, whether its `nextDate` is last month or next year. Once a race
weekend happens, set `"resultsVerified": true` when you've entered the
results and checked the standings offline; that both clears Overdue and
lets the date-based rules above take over. When you're ready to point the
series at its next round, update `nextDate` and set `resultsVerified` back
to `false` (or remove it — it's treated as `false`/unverified when absent).

`[year]` is always the year embedded in the date itself, so this scales to
any year without code changes — a 2028 series with a bare-year date will
automatically get its own "2028 motorsport series : To be scheduled"
section. Sections are ordered by year, then Overdue → This week → (plain) →
To be scheduled.

Only the **This week** section starts expanded on page load; every other
section (including Overdue) starts collapsed, since the group heading and
the row colouring already flag anything urgent — click a section, or a
"jump to" pill at the top, to open it. This re-runs every 60 seconds
without a page reload, so a series quietly moves from "This week" to
"Overdue" as its date passes.

## Series fields

- **name** — shown as the row title.
- **category** — one of `formula1`, `formulaRegional`, `formula4`, `nonFIA`,
  `usaSeries`, `motorbikes`, `electric`, `karting`. This drives the colour
  coding (see `CATEGORY_META` in `motorsport.js` and the matching CSS
  variables in `motorsport.css`). Adding a new category means adding one
  entry to `CATEGORY_META` and one `--categoryname` CSS variable.
- **links** — the four link chips shown on the row, always rendered in the
  same Site / Results / Standings / Calendar order and column position so
  they line up across rows. Any of the four keys can be omitted entirely if
  that link type doesn't apply to a series (e.g. a series with no standings
  page) — a disabled placeholder chip is shown in its place to keep the
  columns aligned. Set `"active": false` and keep the `url` if the link
  should show up but not be clickable (e.g. known but not live yet) — the
  URL is kept so it's ready to switch back on later.
- **nextDate** — either a date the site can parse (`"5 Sep 2026"`) or a bare
  year (`"2027"`) for series that are only loosely scheduled. Ignored for
  Overdue; used for This week / plain / To be scheduled once verified — see
  the grouping table above.
- **resultsVerified** — optional, defaults to `false`. The sole switch for
  Overdue (see above) — set to `true` once you've processed a race weekend.
- **social** — any number of `{ "platform", "url" }` pairs. `platform` must
  match a Font Awesome brand icon name (the part after `fa-`, e.g.
  `"x-twitter"`, `"instagram"`, `"youtube"`).