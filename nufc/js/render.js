/**
 * render.js — all DOM-building functions: player cards, the fixture matrix,
 * fixtures list, leaderboards, side panels, the season switcher, and the
 * validation panel.
 */

function buildSeasonSwitcher(seasons, activeId) {
  const wrap = document.createElement('div');
  wrap.className = 'season-switcher';

  const label = document.createElement('label');
  label.setAttribute('for', 'season-select');
  label.className = 'season-switcher-label';
  label.textContent = 'Season';
  wrap.appendChild(label);

  const select = document.createElement('select');
  select.id = 'season-select';
  seasons.forEach(s => {
    const opt = document.createElement('option');
    opt.value = s.id;
    opt.textContent = s.label || s.id;
    if (s.id === activeId) opt.selected = true;
    select.appendChild(opt);
  });
  select.addEventListener('change', () => {
    // Full page reload on season switch — simplest way to get a clean
    // re-render of everything (roster, matrix, leaderboards, validation)
    // against the new season's files. The currently open squad tab (in the
    // URL hash) is preserved since only the query string changes.
    const params = new URLSearchParams(location.search);
    params.set('season', select.value);
    location.search = params.toString();
  });
  wrap.appendChild(select);

  return wrap;
}

/**
 * Renders the "Data checks" panel. `verbose` controls how much detail is
 * shown: true (local dev — see isLocalDev in data.js) gives the full
 * per-squad breakdown of every issue, same as before. false (a published
 * copy of the page) collapses it to a single concise line — enough to flag
 * that something's worth checking in the source data, without airing the
 * specifics to site visitors.
 */
function renderValidationPanel(issues, verbose) {
  const panel = document.getElementById('validation-panel');
  const list = document.getElementById('validation-list');
  const sub = panel.querySelector('.vp-sub');
  if (issues.length === 0) {
    panel.style.display = 'none';
    return;
  }

  if (!verbose) {
    panel.classList.add('vp-concise');
    if (sub) sub.style.display = 'none';
    list.innerHTML = '';
    const p = document.createElement('p');
    p.className = 'vp-concise-note';
    p.textContent = 'There are inconsistencies in the underlying data on this page.';
    list.appendChild(p);
    document.querySelector('#validation-panel h2').textContent = 'Data checks';
    panel.style.display = 'block';
    return;
  }

  panel.classList.remove('vp-concise');
  if (sub) sub.style.display = '';

  const bySquad = { senior: [], u21: [], u18: [], _general: [] };
  issues.forEach(iss => {
    (bySquad[iss.squad] || bySquad._general).push(iss);
  });

  list.innerHTML = '';
  ['senior', 'u21', 'u18', '_general'].forEach(key => {
    const group = bySquad[key];
    if (!group || group.length === 0) return;
    const wrap = document.createElement('div');
    wrap.className = 'vp-squad';
    const heading = document.createElement('p');
    heading.className = 'vp-squad-name';
    heading.textContent = key === '_general' ? 'General' : SQUAD_LABEL[key];
    wrap.appendChild(heading);
    const ul = document.createElement('ul');
    group.forEach(iss => {
      const li = document.createElement('li');
      li.className = iss.severity;
      li.textContent = iss.message;
      ul.appendChild(li);
    });
    wrap.appendChild(ul);
    list.appendChild(wrap);
  });

  const errorCount = issues.filter(i => i.severity === 'error').length;
  const warnCount = issues.filter(i => i.severity === 'warning').length;
  const parts = [];
  if (errorCount) parts.push(`${errorCount} issue${errorCount === 1 ? '' : 's'}`);
  if (warnCount) parts.push(`${warnCount} warning${warnCount === 1 ? '' : 's'}`);
  document.querySelector('#validation-panel h2').textContent = `Data checks — ${parts.join(', ')}`;

  panel.style.display = 'block';
}

/**
 * Renders the "next match" indicator into #next-match-slot — the earliest
 * fixture, across all three squads, that doesn't have a result yet (see
 * findNextMatch in data.js). `next` is { squad, fixture } or null; null
 * (nothing left to play, or no fixtures at all) clears the slot so it
 * takes up no space.
 */
function buildNextMatchBanner(next) {
  const slot = document.getElementById('next-match-slot');
  if (!slot) return;
  slot.innerHTML = '';
  if (!next) return;

  const fx = next.fixture;
  const wrap = document.createElement('div');
  wrap.className = 'next-match';

  const label = document.createElement('span');
  label.className = 'next-match-label';
  label.textContent = 'Next match';
  wrap.appendChild(label);

  const squadTag = document.createElement('span');
  squadTag.className = 'next-match-squad';
  squadTag.textContent = SQUAD_SHORT[next.squad] || SQUAD_LABEL[next.squad] || next.squad;
  wrap.appendChild(squadTag);

  const details = document.createElement('span');
  details.className = 'next-match-details';
  const venueSuffix = fx.venue === 'H' ? ' (H)' : (fx.venue === 'A' ? ' (A)' : '');
  const compLabel = (fx.competition && fx.competition.trim()) ? fx.competition.trim() : 'League';
  details.textContent = `${fx.date ? fmtDate(fx.date) : 'TBC'} · v ${fx.opponent || '—'}${venueSuffix} · ${compLabel}`;
  wrap.appendChild(details);

  slot.appendChild(wrap);
}

/**
 * Builds the <img> markup for a player-card photo, wired up to fall through
 * the candidate list on load failure: onerror hands off to
 * handlePhotoAttemptFailed, which advances to the next URL in the queue
 * (stashed on the element itself) or, once the queue's exhausted, hides the
 * <img> entirely so the existing .photo-fallback initials badge underneath
 * shows through. Returns '' when there are no candidates at all, same as
 * the old single-photo behaviour.
 */
function buildPhotoImg(p) {
  const candidates = photoCandidates(p);
  if (candidates.length === 0) return '';
  const first = candidates[0].replace(/"/g, '&quot;');
  const restJson = JSON.stringify(candidates.slice(1)).replace(/"/g, '&quot;');
  return `<img src="${first}" alt="" data-photo-queue="${restJson}" onerror="handlePhotoAttemptFailed(this)">`;
}

function handlePhotoAttemptFailed(img) {
  let queue = [];
  try { queue = JSON.parse((img.getAttribute('data-photo-queue') || '[]').replace(/&quot;/g, '"')); } catch (err) { queue = []; }
  if (queue.length === 0) {
    img.style.display = 'none';
    return;
  }
  const next = queue.shift();
  img.setAttribute('data-photo-queue', JSON.stringify(queue).replace(/"/g, '&quot;'));
  img.src = next;
}

function initialsFor(name) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function buildPlayerCard(p, badges) {
  const card = document.createElement('div');
  card.className = 'player-card';
  const pillsHtml = (badges && badges.length)
    ? `<div class="status-pills">${badges.map(b =>
        `<span class="status-pill pill-${b.kind}"${b.title ? ` title="${b.title}"` : ''}>${b.text}</span>`
      ).join('')}</div>`
    : '';
  card.innerHTML = `
    <div class="photo-wrap">
      <div class="photo-fallback">${initialsFor(p.name)}</div>
      ${buildPhotoImg(p)}
      <span class="number-badge">${p.number ? p.number : ''}</span>
      ${pillsHtml}
    </div>
    <div class="card-name">${p.name}</div>
    <div class="card-meta">${p.position} · ${calcAge(p.dob)} · ${p.nationality || '—'}</div>
  `;
  return card;
}

/**
 * Renders the main Player Info grid. Each position group is built from a
 * pre-sorted list of { p, badges } entries: the squad's own active/left
 * players sorted by number, then any cross-squad guests (younger players
 * called up), then the squad's own players out on loan who made at least
 * one appearance before leaving — in that order, each group appended after
 * the last — see buildSquadSection for how that combined list is put
 * together. A card can carry more than one badge (see playerBadges above).
 */
function buildPlayerInfoGrid(entriesByPosition) {
  const container = document.createElement('div');
  POSITION_ORDER.forEach(pos => {
    const entries = entriesByPosition[pos] || [];
    if (entries.length === 0) return;

    const subhead = document.createElement('div');
    subhead.className = 'section-subhead';
    subhead.textContent = POSITION_LABEL[pos];
    container.appendChild(subhead);

    const grid = document.createElement('div');
    grid.className = 'player-grid';
    entries.forEach(({ p, badges }) => grid.appendChild(buildPlayerCard(p, badges)));
    container.appendChild(grid);
  });
  return container;
}

function statusMarker(rec) {
  const status = rec ? rec.status : 'not_in_squad';
  switch (status) {
    case 'start': return '<span class="mk"><span class="mk-start"></span></span>';
    case 'sub_on': return '<span class="mk"><span class="mk-sub"></span></span>';
    case 'unused_sub': return '<span class="mk"><span class="mk-unused"></span></span>';
    case 'injured': return '<span class="mk"><span class="mk-injured">+</span></span>';
    case 'suspended': return '<span class="mk"><span class="mk-suspended">⊘</span></span>';
    case 'loan': return '<span class="mk"><span class="mk-loan">⇄</span></span>';
    case 'transferred': return '<span class="mk"><span class="mk-transferred">→</span></span>';
    case 'incoming': return '<span class="mk"><span class="mk-incoming">←</span></span>';
    case 'unavailable': return '<span class="mk"><span class="mk-out">–</span></span>';
    case 'not_in_squad': return '<span class="mk"><span class="mk-out">·</span></span>';
    default: return '<span class="mk"><span class="mk-out">·</span></span>';
  }
}


/**
 * Builds the fixture matrix for a squad. Includes the squad's own active
 * roster, plus any "guest" players from a different squad who show up in
 * this squad's appearance records (e.g. an U18 called up to play U21s).
 */
function playerBadges(p, squadKey) {
  const badges = [];
  const isGuestHere = normSquad(p.squad) !== squadKey;
  if (isGuestHere) {
    badges.push({ text: SQUAD_SHORT[normSquad(p.squad)] || p.squad, cls: 'guest-tag', kind: 'cross' });
  }
  const STATUS_BADGES = {
    loan: { text: 'On loan', cls: 'guest-tag loan-tag', kind: 'loan' },
    incoming: { text: 'Incoming', cls: 'guest-tag incoming-tag', kind: 'incoming' },
    left: { text: 'Left', cls: 'guest-tag left-tag', kind: 'left' },
    injured_season: { text: 'Injured', cls: 'guest-tag injured-season-tag', kind: 'injured-season' },
    not_selected_season: { text: 'Not selected', cls: 'guest-tag not-selected-season-tag', kind: 'not-selected-season' },
    trialist: { text: 'Trialist', cls: 'guest-tag trialist-tag', kind: 'trialist' },
  };
  // Location/employment statuses (on loan, incoming, left the club) are
  // true no matter which page you're looking at, so they still combine
  // with the cross-squad pill — e.g. a U21 who was named on a senior bench
  // and has since gone out on loan shows "U21" + "On loan" together.
  // Selection-outcome statuses (not selected, injured, trialist) describe
  // absence from *their home squad's* matchday squad specifically — if
  // they're showing up here as a cross-squad guest at all, they're
  // self-evidently not absent from selection, so those don't stack onto a
  // guest card. They still show normally on the player's own home-squad
  // page (via the "Not in the matchday squad" section, a separate code
  // path from this one).
  const CROSS_COMPATIBLE_STATUSES = new Set(['loan', 'incoming', 'left']);
  const statusBadge = STATUS_BADGES[p.status];
  if (statusBadge && (!isGuestHere || CROSS_COMPATIBLE_STATUSES.has(p.status))) {
    badges.push({ ...statusBadge });
  }
  return badges;
}


/**
 * Finds the most recent fixture date a player actually started or came on
 * as a sub for, within one squad's own fixture list. Used to give the
 * "Left" badge a hover date without needing a separate leftDate field —
 * per the DATA-GUIDE, that date is considered derivable from the matrix.
 */
function lastAppearanceDate(playerId, fixtureData) {
  const appearances = ((fixtureData && fixtureData.appearances) || {})[playerId] || {};
  const fixturesById = {};
  (fixtureData.fixtures || []).forEach(fx => { fixturesById[fx.id] = fx; });
  let latest = null;
  Object.keys(appearances).forEach(fxId => {
    const rec = appearances[fxId];
    if (!rec || !APPEARANCE_STATUSES.has(rec.status)) return;
    const fx = fixturesById[fxId];
    if (!fx || !fx.date) return;
    if (!latest || fx.date > latest) latest = fx.date;
  });
  return latest;
}

/** True if a fixture's competition is a cup competition rather than a league one. */
function isCupFixture(fx) {
  return !!(fx.competition && /cup|trophy/i.test(fx.competition));
}

/** True if a fixture's competition is a European club competition (Champions League etc). */
function isEuropeanFixture(fx) {
  return !!(fx.competition && /champions league|europa league|conference league/i.test(fx.competition));
}

/** Which colour class (if any) a fixture's column should be styled with. European
 * competitions take priority in the unlikely case a competition name matches both. */
function fixtureColourClass(fx) {
  if (isEuropeanFixture(fx)) return 'euro';
  if (isCupFixture(fx)) return 'cup';
  return null;
}

/** Which W/D/L class a fixture's score cell should get, based on its result string. */
function resultLetterClass(fx) {
  const parsed = parseResult(fx.result);
  return parsed ? 'fx-res-' + parsed.letter : '';
}

/**
 * Builds a compact, all-fixtures list for a squad: one row per fixture with
 * date, competition, opponent (with venue), and score — a plain-English
 * companion to the fixture matrix above it, which favours density over
 * per-player detail. League/cup/European fixtures get the same colour
 * treatment as the matrix columns so the two views read consistently.
 */
function buildFixturesList(fixtureData, squadKey, fixtureIssuesMap) {
  const fixtures = fixtureData.fixtures || [];
  if (fixtures.length === 0) return null;

  const wrap = document.createElement('div');
  wrap.className = 'fixtures-list-wrap';
  const table = document.createElement('table');
  table.className = 'fixtures-list';

  const thead = document.createElement('thead');
  thead.innerHTML = '<tr><th>#</th><th>Date</th><th>Comp</th><th>Fixture</th><th>Score</th></tr>';
  table.appendChild(thead);

  const tbody = document.createElement('tbody');
  fixtures.forEach((fx, idx) => {
    const tr = document.createElement('tr');
    const colourClass = fixtureColourClass(fx);
    if (colourClass) tr.classList.add('fl-' + colourClass);
    const fxIssues = (fixtureIssuesMap && fixtureIssuesMap[squadKey + '::' + fx.id]) || [];
    if (fxIssues.length) {
      tr.classList.add('fl-flagged');
      tr.title = '⚠ ' + fxIssues.join('\n⚠ ');
    }

    const fxNumber = (fx.gameweek != null) ? fx.gameweek : (idx + 1);
    const compLabel = (fx.competition && fx.competition.trim()) ? fx.competition.trim() : 'League';
    const venueSuffix = fx.venue === 'H' ? ' (H)' : (fx.venue === 'A' ? ' (A)' : '');
    const oppText = `v ${fx.opponent || '—'}${venueSuffix}`.trim();
    const resClass = resultLetterClass(fx);

    tr.innerHTML = `
      <td class="fl-num">${fxNumber}</td>
      <td class="fl-date">${fx.date ? fmtDate(fx.date) : '—'}</td>
      <td class="fl-comp">${compLabel}</td>
      <td class="fl-fixture">${oppText}</td>
      <td class="fl-score ${resClass}">${fx.result || '—'}</td>
    `;
    tbody.appendChild(tr);
  });
  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildMatrix(rosterPlayers, fixtureData, playersById, squadKey, fixtureIssuesMap, squadStats) {
  const fixtures = fixtureData.fixtures || [];
  const appearances = fixtureData.appearances || {};
  if (fixtures.length === 0) return null;

  const rosterIds = new Set(rosterPlayers.map(p => p.id));
  const guestIds = Object.keys(appearances).filter(id => !rosterIds.has(id) && playersById[id]);

  const wrap = document.createElement('div');
  wrap.className = 'matrix-wrap';
  const table = document.createElement('table');
  table.className = 'matrix';

  const thead = document.createElement('thead');
  const headRow = document.createElement('tr');
  const playerTh = document.createElement('th');
  playerTh.className = 'player-col';
  playerTh.textContent = 'Player';
  headRow.appendChild(playerTh);

  fixtures.forEach((fx, idx) => {
    const th = document.createElement('th');
    const fxIssues = fixtureIssuesMap[squadKey + '::' + fx.id] || [];
    const fxNumber = (fx.gameweek != null) ? fx.gameweek : (idx + 1);
    const titleVenueSuffix = fx.venue === 'H' ? ' (H)' : (fx.venue === 'A' ? ' (A)' : '');
    let titleText = `${fmtDate(fx.date)} — v ${fx.opponent}${titleVenueSuffix}${fx.competition ? ' · ' + fx.competition : ''}${fx.result ? ' · ' + fx.result : ''}`;
    const colourClass = fixtureColourClass(fx);
    if (colourClass) th.classList.add('fx-' + colourClass);
    if (fxIssues.length) {
      th.classList.add('fx-flagged');
      titleText += '\n\n⚠ ' + fxIssues.join('\n⚠ ');
    }
    th.title = titleText;
    th.innerHTML = `<span class="fx-num">${fxNumber}</span><span class="fx-venue">${fx.venue || ''}</span>`;
    headRow.appendChild(th);
  });

  const totalTh = document.createElement('th');
  totalTh.className = 'total-col';
  totalTh.title = 'Total appearances (starts + sub appearances)';
  totalTh.textContent = 'Total';
  headRow.appendChild(totalTh);

  thead.appendChild(headRow);
  table.appendChild(thead);

  const tbody = document.createElement('tbody');

  const addRow = (p, isGuest, squadKey) => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    nameTd.className = 'player-col';
    if (isGuest) {
      const badges = playerBadges(p, squadKey);
      tr.className = 'guest-row guest-row-' + (badges.length ? badges[0].kind : 'cross');
      const tagsHtml = badges.map(b => `<span class="${b.cls}">${b.text}</span>`).join(' ');
      nameTd.innerHTML = badges.length ? `${p.name} ${tagsHtml}` : p.name;
    } else {
      nameTd.innerHTML = p.name;
    }
    tr.appendChild(nameTd);

    fixtures.forEach(fx => {
      const td = document.createElement('td');
      td.className = 'cell';
      const colourClass = fixtureColourClass(fx);
      if (colourClass) td.classList.add('fx-' + colourClass + '-col');
      const rec = (appearances[p.id] || {})[fx.id];
      td.innerHTML = statusMarker(rec);
      if (rec && (rec.status === 'injured' || rec.status === 'suspended' || rec.status === 'loan' || rec.status === 'transferred' || rec.status === 'incoming') && rec.reasonNote) {
        td.title = rec.reasonNote;
      }
      tr.appendChild(td);
    });

    const totalTd = document.createElement('td');
    totalTd.className = 'total-col';
    const stat = squadStats[p.id];
    const totalApps = (stat && typeof stat.appearances === 'number') ? stat.appearances : 0;
    totalTd.textContent = totalApps;
    tr.appendChild(totalTd);

    tbody.appendChild(tr);
  };

  // One combined sort across the squad's own roster and any guest rows
  // (players from another squad, or the squad's own loan/incoming/left
  // players who still have logged appearances):
  //   1. Own players out on loan always sink to the very bottom, regardless
  //      of how many appearances they've made — they're not part of the
  //      matchday picture right now.
  //   2. Everyone else (roster + U18/U21-style guests) is ranked together by
  //      appearance count, most to fewest; ties are broken by starts, then
  //      sub appearances, then unused-sub count, all most to fewest.
  //   3. On a further tie, the squad's own roster player is listed before a guest.
  //   4. Final tiebreak is alphabetical.
  const statFor = (id, key) => {
    const s = squadStats[id];
    return (s && typeof s[key] === 'number') ? s[key] : 0;
  };
  const isLoanRow = (id) => {
    const pl = playersById[id];
    return !!pl && normSquad(pl.squad) === squadKey && pl.status === 'loan';
  };

  const rows = [
    ...rosterPlayers.map(p => ({ p, isGuest: false })),
    ...guestIds.map(id => ({ p: playersById[id], isGuest: true })),
  ];

  rows.sort((a, b) => {
    const aLoan = a.isGuest && isLoanRow(a.p.id);
    const bLoan = b.isGuest && isLoanRow(b.p.id);
    if (aLoan !== bLoan) return aLoan ? 1 : -1;
    const keys = ['appearances', 'starts', 'subApps', 'unusedSubs'];
    for (const key of keys) {
      const diff = statFor(b.p.id, key) - statFor(a.p.id, key);
      if (diff !== 0) return diff;
    }
    if (a.isGuest !== b.isGuest) return a.isGuest ? 1 : -1;
    return a.p.name.localeCompare(b.p.name);
  });

  rows.forEach(r => addRow(r.p, r.isGuest, squadKey));

  table.appendChild(tbody);
  wrap.appendChild(table);
  return wrap;
}

function buildLegend() {
  const div = document.createElement('div');
  div.className = 'legend';
  div.innerHTML = `
    <span><span class="mk"><span class="mk-start"></span></span> Started</span>
    <span><span class="mk"><span class="mk-sub"></span></span> Sub appearance</span>
    <span><span class="mk"><span class="mk-unused"></span></span> Unused sub</span>
    <span><span class="mk"><span class="mk-injured">+</span></span> Injured</span>
    <span><span class="mk"><span class="mk-suspended">⊘</span></span> Suspended</span>
    <span><span class="mk"><span class="mk-loan">⇄</span></span> Unavailable (on loan)</span>
    <span><span class="mk"><span class="mk-transferred">→</span></span> Unavailable (transferred out)</span>
    <span><span class="mk"><span class="mk-incoming">←</span></span> Unavailable (not yet joined)</span>
    <span><span class="mk"><span class="mk-out">–</span></span> Unavailable (other)</span>
    <span><span class="mk"><span class="mk-out">·</span></span> Not in squad</span>
    <span><span class="guest-tag">U18</span> Guesting from another squad</span>
    <span><span class="guest-tag loan-tag">On loan</span> Own squad, currently out on loan</span>
    <span><span class="guest-tag incoming-tag">Incoming</span> Own squad, incoming signing</span>
    <span><span class="guest-tag left-tag">Left</span> Own squad, left the club</span>
    <span><span class="guest-tag injured-season-tag">Injured</span> Season-long injury</span>
    <span><span class="guest-tag not-selected-season-tag">Not selected</span> Season-long non-selection</span>
    <span><span class="guest-tag trialist-tag">Trialist</span> On trial</span>
    <span><span class="fx-swatch league"></span> League fixture</span>
    <span><span class="fx-swatch cup"></span> Cup fixture</span>
    <span><span class="fx-swatch euro"></span> European fixture</span>
  `;
  return div;
}

/**
 * Builds the "Out on loan" / "Incoming" / "Left the club" side panel for a
 * squad, as a grid of photo cards (same visual language as the Player Info
 * cards) with a kind-specific detail line (loan club, incoming from/expected,
 * or new club/date left). Returns null when there's nobody to show, so the
 * caller can skip appending the section entirely rather than rendering an
 * empty panel.
 */
function statusDetailLine(p, kind) {
  if (kind === 'loan') {
    return p.loanClub ? `On loan · ${p.loanClub}` : 'On loan';
  }
  if (kind === 'incoming') {
    const parts = [];
    if (p.fromClub) parts.push(`From ${p.fromClub}`);
    if (p.expectedDate) parts.push(`Exp. ${fmtDate(p.expectedDate)}`);
    return parts.length ? parts.join(' · ') : 'Incoming signing';
  }
  if (kind === 'injured-season') {
    return p.reasonNote ? `Injured · ${p.reasonNote}` : 'Injured — out for the season';
  }
  if (kind === 'not-selected-season') {
    return p.reasonNote ? `Not selected · ${p.reasonNote}` : 'Not selected all season';
  }
  // trialist
  return p.reasonNote ? `Trialist · ${p.reasonNote}` : 'On trial';
}

function buildStatusCard(p, kind) {
  const card = document.createElement('div');
  card.className = `player-card status-card status-card-${kind}`;
  card.innerHTML = `
    <div class="photo-wrap">
      <div class="photo-fallback">${initialsFor(p.name)}</div>
      ${buildPhotoImg(p)}
      <span class="number-badge">${p.number ? p.number : ''}</span>
    </div>
    <div class="card-name">${p.name}</div>
    <div class="card-meta">${p.position} · ${calcAge(p.dob)} · ${p.nationality || '—'}</div>
    <div class="card-detail">${statusDetailLine(p, kind)}</div>
  `;
  return card;
}

/**
 * The "not in the matchday squad" block: everyone on loan (with no
 * appearances yet this season), incoming, season-long injured, not
 * selected, or a trialist — shown together in one muted grid rather than
 * five separate headed subsections, since each card's own detail line
 * (from statusDetailLine) already says why they're here. Sits between
 * Player Info and Fixture-by-fixture, so it reads as "here's the rest of
 * the squad" rather than being buried at the very bottom of the page.
 * Returns null when there's nobody to show, so the caller can skip it.
 */
function buildNotPlayingSection(groups) {
  // groups: [{ kind, players }, ...] in display order
  const byNumber = (a, b) => (a.number || 999) - (b.number || 999);
  const all = groups.filter(g => g.players.length > 0);
  if (all.length === 0) return null;

  const wrap = document.createElement('div');
  const heading = document.createElement('h3');
  heading.className = 'block-heading';
  heading.textContent = 'Not in the matchday squad';
  wrap.appendChild(heading);

  const grid = document.createElement('div');
  grid.className = 'player-grid status-grid status-grid-muted';
  all.forEach(g => g.players.slice().sort(byNumber).forEach(p => grid.appendChild(buildStatusCard(p, g.kind))));
  wrap.appendChild(grid);

  return wrap;
}


const LEADERBOARD_DEFS = [
  { key: 'goals', label: 'Top scorers' },
  { key: 'assists', label: 'Assists' },
  { key: 'yellowCards', label: 'Yellow cards' },
  { key: 'redCards', label: 'Red cards' },
];
const SENIOR_LEADERBOARD_DEFS = [
  { key: 'minutes', label: 'Minutes played' },
  { key: 'xg', label: 'xG', decimals: 2 },
];

/**
 * Picks a column count for the leaderboard grid so cards land in balanced
 * rows instead of leaving a single card stranded alone on the last row
 * (e.g. 6 cards as 5-then-1). Prefers an even split, falling back to
 * whatever avoids a lone leftover card.
 */
function pickLeaderboardColumns(n) {
  if (n <= 3) return n || 1;
  for (let c = 4; c >= 2; c--) {
    if (n % c === 0) return c;
  }
  for (let c = 4; c >= 2; c--) {
    if (n % c !== 1) return c;
  }
  return n;
}

function buildLeaderboards(playersById, squadStats, squadKey) {
  const defs = squadKey === 'senior' ? [...LEADERBOARD_DEFS, ...SENIOR_LEADERBOARD_DEFS] : LEADERBOARD_DEFS;

  const grid = document.createElement('div');
  grid.className = 'leaderboard-grid';

  let anyRendered = false;
  const candidateIds = Object.keys(squadStats);

  defs.forEach(def => {
    const ranked = candidateIds
      .map(id => ({ p: playersById[id], stat: squadStats[id] }))
      .filter(x => x.p && typeof x.stat[def.key] === 'number' && x.stat[def.key] > 0)
      .sort((a, b) => b.stat[def.key] - a.stat[def.key])
      .slice(0, 10);
    if (ranked.length === 0) return;
    anyRendered = true;

    const card = document.createElement('div');
    card.className = 'leaderboard-card';
    const h4 = document.createElement('h4');
    h4.textContent = def.label;
    card.appendChild(h4);

    const table = document.createElement('table');
    const tbody = document.createElement('tbody');
    ranked.forEach(({ p, stat }) => {
      const tr = document.createElement('tr');
      const val = def.decimals != null ? stat[def.key].toFixed(def.decimals) : stat[def.key];
      const badges = playerBadges(p, squadKey);
      const tagsHtml = badges.map(b => `<span class="${b.cls}">${b.text}</span>`).join(' ');
      const nameHtml = badges.length ? `${p.name} ${tagsHtml}` : p.name;
      tr.innerHTML = `<td class="lb-name">${nameHtml}</td><td class="lb-val">${val}</td>`;
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    card.appendChild(table);
    grid.appendChild(card);
  });

  if (!anyRendered) {
    const p = document.createElement('p');
    p.className = 'panel-empty';
    p.textContent = 'No stats logged yet.';
    grid.appendChild(p);
  } else {
    grid.style.setProperty('--lb-cols', pickLeaderboardColumns(grid.children.length));
  }

  return grid;
}

/**
 * Wraps buildLeaderboards with an "Overall" view plus one view per
 * competition (League, cups, Europe, etc.), switchable via a small tab bar.
 * Every view is pre-built up front and toggled with display:none, so
 * switching tabs is instant and there's no re-render on click. If the
 * squad's fixtures only span a single competition, "Overall" and that
 * competition's numbers are identical, so the tab bar is skipped entirely
 * and just the one grid is shown.
 */
function buildLeaderboardsBlock(playersById, fixtureData, squadKey) {
  const fixtures = fixtureData.fixtures || [];
  const groups = competitionGroups(fixtures);

  const wrap = document.createElement('div');
  wrap.className = 'leaderboards-block';

  if (groups.length <= 1) {
    wrap.appendChild(buildLeaderboards(playersById, computeStatsForSquad(fixtureData), squadKey));
    return wrap;
  }

  const views = [{ key: '__overall__', label: 'Overall', grid: buildLeaderboards(playersById, computeStatsForSquad(fixtureData), squadKey) }];
  groups.forEach(g => {
    views.push({ key: g.label, label: g.label, grid: buildLeaderboards(playersById, computeStatsForFixtureIds(fixtureData, g.fixtureIds), squadKey) });
  });

  const tabBar = document.createElement('div');
  tabBar.className = 'lb-tabs';
  views.forEach((v, i) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'lb-tab' + (i === 0 ? ' active' : '');
    btn.textContent = v.label;
    btn.addEventListener('click', () => {
      tabBar.querySelectorAll('.lb-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      views.forEach(vv => { vv.grid.style.display = (vv.key === v.key) ? '' : 'none'; });
    });
    tabBar.appendChild(btn);
  });
  wrap.appendChild(tabBar);

  views.forEach((v, i) => {
    if (i !== 0) v.grid.style.display = 'none';
    wrap.appendChild(v.grid);
  });

  return wrap;
}

function buildSquadSection(squadKey, allSquadPlayers, fixtureData, playersById, fixtureIssuesMap) {
  const activePlayers = allSquadPlayers.filter(p => (p.status || 'active') === 'active');
  const loanPlayers = allSquadPlayers.filter(p => p.status === 'loan');
  const incomingPlayers = allSquadPlayers.filter(p => p.status === 'incoming');
  const leftPlayers = allSquadPlayers.filter(p => p.status === 'left');
  const injuredSeasonPlayers = allSquadPlayers.filter(p => p.status === 'injured_season');
  const notSelectedPlayers = allSquadPlayers.filter(p => p.status === 'not_selected_season');
  const trialistPlayers = allSquadPlayers.filter(p => p.status === 'trialist');

  // Stats scoped to THIS squad's own fixtures only — a guest appearance (e.g. a
  // U18 who's only ever played for the U21s) contributes here, not to their home
  // squad's numbers, since that's where the match actually happened.
  const squadStats = computeStatsForSquad(fixtureData);
  const appsFor = (id) => {
    const s = squadStats[id];
    return (s && typeof s.appearances === 'number') ? s.appearances : 0;
  };

  // A loan player who made appearances for this squad before heading out
  // (or who's due back and already played some games) belongs up with
  // everyone else, badged "On loan" — only a loan spell with zero logged
  // appearances this season counts as a genuine "hasn't played" case.
  const loanPlayedPlayers = loanPlayers.filter(p => appsFor(p.id) > 0);
  const loanOutPlayers = loanPlayers.filter(p => appsFor(p.id) === 0);

  const appearances = fixtureData.appearances || {};

  // Cross-squad guests who were named in a matchday squad here at all —
  // started, came on, or sat as an unused sub — same mechanism the matrix
  // already uses, but only for the statuses that mean "was actually part of
  // a squad", so an injured/loan/incoming/etc. record logged against this
  // squad on their behalf doesn't wrongly earn them a spot in the grid.
  const NAMED_STATUSES = new Set(['start', 'sub_on', 'unused_sub']);
  const namedInSquad = (id) => {
    const recs = appearances[id];
    return !!recs && Object.values(recs).some(r => r && NAMED_STATUSES.has(r.status));
  };
  const guestPlayers = Object.keys(appearances)
    .filter(id => {
      const pl = playersById[id];
      return pl && normSquad(pl.squad) !== squadKey && namedInSquad(id);
    })
    .map(id => playersById[id]);

  const section = document.createElement('section');
  section.className = 'squad';
  section.id = squadKey;

  const header = document.createElement('div');
  header.className = 'squad-header';
  header.innerHTML = `<h2>${SQUAD_LABEL[squadKey]}</h2><span class="meta">${activePlayers.length} players</span>`;
  section.appendChild(header);

  // Main Player Info grid, in this order within each position group:
  //   1. the squad's own active/left players, sorted by number
  //   2. cross-squad guests (younger players called up), sorted by name
  //   3. the squad's own players out on loan who've made at least one
  //      appearance before leaving, sorted by number
  // A shirt number of 0 or unset means "no number" — sorts to the end of
  // its group rather than to the front, and displays blank rather than "0".
  const byNumber = (a, b) => (a.number || 999) - (b.number || 999);
  const byName = (a, b) => a.name.localeCompare(b.name);
  const badgeFor = (p) => {
    const badges = playerBadges(p, squadKey);
    const leftBadge = badges.find(b => b.kind === 'left');
    if (leftBadge) {
      const d = lastAppearanceDate(p.id, fixtureData);
      if (d) leftBadge.title = `Last appeared ${fmtDate(d)}`;
    }
    return { p, badges };
  };
  const regularTop = [...activePlayers, ...leftPlayers];
  const positionEntries = {};
  POSITION_ORDER.forEach(pos => {
    const regular = regularTop.filter(p => p.position === pos).sort(byNumber);
    const guests = guestPlayers.filter(p => p.position === pos).sort(byName);
    const loanPlayed = loanPlayedPlayers.filter(p => p.position === pos).sort(byNumber);
    positionEntries[pos] = [...regular.map(badgeFor), ...guests.map(badgeFor), ...loanPlayed.map(badgeFor)];
  });

  const infoHeader = document.createElement('h3');
  infoHeader.className = 'block-heading';
  infoHeader.style.marginTop = '0';
  infoHeader.textContent = 'Player Info';
  section.appendChild(infoHeader);

  section.appendChild(buildPlayerInfoGrid(positionEntries));

  // Everyone who isn't part of the current matchday picture — on loan (with
  // no appearances yet), incoming, season-long injured, not selected, or a
  // trialist — shown together, muted, right after the active squad and
  // before the fixture-by-fixture detail, rather than buried at the very
  // bottom of the page.
  const notPlaying = buildNotPlayingSection([
    { kind: 'loan', players: loanOutPlayers },
    { kind: 'incoming', players: incomingPlayers },
    { kind: 'injured-season', players: injuredSeasonPlayers },
    { kind: 'not-selected-season', players: notSelectedPlayers },
    { kind: 'trialist', players: trialistPlayers },
  ]);
  if (notPlaying) section.appendChild(notPlaying);

  const fxHeader = document.createElement('h3');
  fxHeader.className = 'block-heading';
  fxHeader.textContent = 'Fixture-by-fixture';
  section.appendChild(fxHeader);

  section.appendChild(buildLegend());

  const matrix = buildMatrix(activePlayers, fixtureData, playersById, squadKey, fixtureIssuesMap, squadStats);
  if (matrix) {
    section.appendChild(matrix);
  } else {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No fixtures recorded yet for this squad.';
    section.appendChild(p);
  }

  const fxListHeader = document.createElement('h3');
  fxListHeader.className = 'block-heading';
  fxListHeader.textContent = 'All Fixtures';
  section.appendChild(fxListHeader);
  const fixturesList = buildFixturesList(fixtureData, squadKey, fixtureIssuesMap);
  if (fixturesList) {
    section.appendChild(fixturesList);
  } else {
    const p = document.createElement('p');
    p.className = 'note';
    p.textContent = 'No fixtures recorded yet for this squad.';
    section.appendChild(p);
  }

  const lbHeader = document.createElement('h3');
  lbHeader.className = 'block-heading';
  lbHeader.textContent = 'Leaderboards';
  section.appendChild(lbHeader);
  section.appendChild(buildLeaderboardsBlock(playersById, fixtureData, squadKey));

  return section;
}