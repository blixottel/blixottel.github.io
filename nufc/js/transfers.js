/**
 * transfers.js — the "Transfer history" page: every movement in every player's
 * `movements` list (players-master.json + players-archive.json), as one
 * date-ordered list, split into incoming and outgoing, with the player's squad
 * at the time. Reuses data.js / stats.js / render.js as-is.
 *
 * Squad at the time = the player's squad in whichever season the movement date
 * falls in: from that season's roster file if they're on it (so squadOverride
 * is honoured), otherwise worked out from their dob and that season's ageBands.
 * A date no season covers shows "—".
 */

// dir: 'in' = arriving at the club (or into the squad), 'out' = leaving it.
const TRANSFER_TYPES = {
  joined:        { label: 'Joined',   dir: 'in',  cls: 'guest-tag',              prep: 'from' },
  youth:         { label: 'Youth',    dir: 'in',  cls: 'guest-tag',              prep: 'from' },
  loan_in:       { label: 'Loan in',  dir: 'in',  cls: 'guest-tag incoming-tag', prep: 'from' },
  trial_in:      { label: 'Trial',    dir: 'in',  cls: 'guest-tag trialist-tag', prep: 'from' },
  left:          { label: 'Left',     dir: 'out', cls: 'guest-tag left-tag',     prep: 'to' },
  retired:       { label: 'Retired',  dir: 'out', cls: 'guest-tag left-tag',     prep: 'at' },
  loan_out:      { label: 'Loan out', dir: 'out', cls: 'guest-tag loan-tag',     prep: 'to' },
  loan_out_dual: { label: 'Dual reg.', dir: 'out', cls: 'guest-tag loan-tag',    prep: 'to' },
};
const SPELL_TYPES = new Set(['loan_out', 'loan_out_dual', 'loan_in', 'trial_in', 'youth']);

// The end of a loan, shown as its own row (switchable with the "Show loan returns" toggle).
// from = the movement type that produces it. The club is the same club as the loan's.
const RETURN_TYPES = {
  loan_return:   { from: 'loan_out',      label: 'Loan return',    dir: 'in',  cls: 'guest-tag loan-tag',     prep: 'from' },
  dual_return:   { from: 'loan_out_dual', label: 'Dual reg. ended', dir: 'in', cls: 'guest-tag loan-tag',     prep: 'from' },
  loan_in_end:   { from: 'loan_in',       label: 'Loan ended',     dir: 'out', cls: 'guest-tag incoming-tag', prep: 'to' },
};
const RETURN_BY_SOURCE = {};
Object.keys(RETURN_TYPES).forEach(k => { RETURN_BY_SOURCE[RETURN_TYPES[k].from] = k; });

const trEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trDMY = iso => (iso ? iso.split('-').reverse().join('/') : '');
// sortKey: which column the list is ordered by; sortDesc: direction. Date sorting groups rows under season headings.
const trState = { rows: [], seasons: [], dir: 'all', sortKey: 'date', sortDesc: true, showReturns: true };
const SORT_KEYS = ['date', 'player', 'squad', 'type', 'club'];

function seasonFor(ms, seasons) {
  if (ms === null) return null;
  return seasons.find(s => { const r = seasonRange(s); return r && ms >= r.start && ms <= r.end; }) || null;
}

function squadAt(player, season, rosterMerged) {
  if (!season) return null;
  const onRoster = rosterMerged[season.id] && rosterMerged[season.id][player.id];
  if (onRoster) return normSquad(onRoster.squad);
  const bands = season.ageBands || [];
  const squad = player.dob ? ageBandForDob(player.dob, bands) : (player.squadIfDobUnknown || DEFAULT_UNKNOWN_DOB_SQUAD);
  return normSquad(squad);
}

// True if the player permanently left (or, for a loan_in, signed permanently) during the loan, so they
// never actually went back: no return row is wanted then.
function endedByExit(p, m, endMs) {
  const startMs = looseDate(m.date, false);
  const exits = m.type === 'loan_in' ? ['joined'] : ['left', 'retired'];
  return (p.movements || []).some(x => {
    if (!exits.includes(x.type)) return false;
    const d = looseDate(x.date, false);
    return d !== null && (startMs === null || d >= startMs) && d <= endMs;
  });
}

function buildRows(master, seasons, rosterMerged) {
  const rows = [];
  master.forEach(p => {
    (p.movements || []).forEach(m => {
      const retKey = RETURN_BY_SOURCE[m.type];
      const retEnd = m.endDate || '';
      const retMs = retKey && retEnd ? looseDate(retEnd, true) : null;
      if (retMs !== null && !endedByExit(p, m, retMs)) {
        const rt = RETURN_TYPES[retKey];
        const season = seasonFor(retMs, seasons);
        rows.push({
          player: p, type: retKey, t: rt, date: retEnd, ms: retMs, season, isReturn: true,
          squad: squadAt(p, season, rosterMerged), club: m.club || '', note: '',
          details: `Began ${trDMY(m.date)}`,
        });
      }
      const t = TRANSFER_TYPES[m.type] || { label: m.type || 'Movement', dir: 'other', cls: 'guest-tag', prep: '' };
      const ms = looseDate(m.date, false);
      const season = seasonFor(ms, seasons);
      const endDate = m.endDate || '';
      rows.push({
        player: p, type: m.type, t, date: m.date || '', ms, season,
        squad: squadAt(p, season, rosterMerged), club: m.club || '', note: m.note || '',
        details: SPELL_TYPES.has(m.type) && endDate !== m.date ? `${trDMY(m.date)} – ${endDate ? trDMY(endDate) : 'ongoing'}` : '',
      });
    });
  });
  return rows;
}

function groupLabel(r, seasons) {
  if (r.season) return r.season.label || r.season.id;
  if (r.ms === null) return 'Date unknown';
  const first = seasons[seasons.length - 1], last = seasons[0];
  const fr = seasonRange(first);
  return fr && r.ms < fr.start ? `Before ${first.label || first.id}` : `After ${last.label || last.id}`;
}

// ---- sorting -------------------------------------------------------------------------------------
// Value a row is ordered by for a column. null = "nothing to sort on" (blank club, no squad): those rows
// always sink to the bottom, whichever direction is chosen.
function sortValue(r, key) {
  if (key === 'player') return r.player.name;
  if (key === 'type') return r.t.label;
  if (key === 'club') return r.club || null;
  if (key === 'squad') {
    if (!r.squad) return null;
    const i = SQUAD_ORDER.indexOf(r.squad);
    return i >= 0 ? i : 98; // squads not in SQUAD_ORDER (e.g. u16) go after the listed ones
  }
  return null;
}

function compareRows(a, b) {
  const sign = trState.sortDesc ? -1 : 1;
  const byName = () => a.player.name.localeCompare(b.player.name);
  if (trState.sortKey === 'date') {
    // Unknown dates always sink to the bottom; same-day rows fall back to name.
    if (a.ms === null || b.ms === null) return (a.ms === null) - (b.ms === null);
    return sign * (a.ms - b.ms) || byName();
  }
  const va = sortValue(a, trState.sortKey), vb = sortValue(b, trState.sortKey);
  if (va === null || vb === null) { if (va !== vb) return (va === null) - (vb === null); }
  else {
    const c = typeof va === 'number' ? va - vb : String(va).localeCompare(String(vb));
    if (c) return sign * c;
  }
  // Ties: newest first, then name.
  if (a.ms !== null && b.ms !== null && a.ms !== b.ms) return b.ms - a.ms;
  return byName();
}

// Clicking the active column's header flips the direction; a different column starts at its natural
// direction (date: newest first; everything else: A to Z).
function setSortKey(key) {
  if (key === trState.sortKey) trState.sortDesc = !trState.sortDesc;
  else { trState.sortKey = key; trState.sortDesc = key === 'date'; }
  renderTransfers();
}

function syncSortUi() {
  document.querySelectorAll('.tr-table thead th[data-sort]').forEach(th => {
    th.setAttribute('aria-sort', th.dataset.sort === trState.sortKey ? (trState.sortDesc ? 'descending' : 'ascending') : 'none');
  });
  document.getElementById('tr-sortkey').value = trState.sortKey;
  document.getElementById('tr-sort').textContent = trState.sortKey === 'date'
    ? (trState.sortDesc ? 'Newest first ↓' : 'Oldest first ↑')
    : (trState.sortDesc ? 'Descending ↓' : 'Ascending ↑');
}

// ---- shareable filters (kept in the address bar) ---------------------------------------------------
// ?q= search · dir= in|out · type= · squad= · yr= (the season FILTER; plain ?season= already belongs to the
// site's season switcher) · sort= · order= asc|desc · returns=0. Only non-default values are written, and
// any other parameters (team, season) are left alone.
const FILTER_PARAMS = ['q', 'dir', 'type', 'squad', 'yr', 'sort', 'order', 'returns'];

function readUrlState() {
  const p = new URLSearchParams(location.search);
  const setSelect = (id, value) => {
    const el = document.getElementById(id);
    if (value && Array.from(el.options).some(o => o.value === value)) el.value = value;
  };
  document.getElementById('tr-search').value = p.get('q') || '';
  setSelect('tr-type', p.get('type'));
  setSelect('tr-squad', p.get('squad'));
  setSelect('tr-season', p.get('yr'));
  if (['in', 'out'].includes(p.get('dir'))) trState.dir = p.get('dir');
  if (SORT_KEYS.includes(p.get('sort'))) {
    trState.sortKey = p.get('sort');
    trState.sortDesc = trState.sortKey === 'date';
  }
  if (['asc', 'desc'].includes(p.get('order'))) trState.sortDesc = p.get('order') === 'desc';
  trState.showReturns = p.get('returns') !== '0';
  document.getElementById('tr-returns').checked = trState.showReturns;
  document.querySelectorAll('#tr-dir button').forEach(x => x.classList.toggle('active', x.dataset.dir === trState.dir));
}

function writeUrlState() {
  const p = new URLSearchParams(location.search);
  FILTER_PARAMS.forEach(k => p.delete(k));
  const q = document.getElementById('tr-search').value.trim();
  if (q) p.set('q', q);
  if (trState.dir !== 'all') p.set('dir', trState.dir);
  [['type', 'tr-type'], ['squad', 'tr-squad'], ['yr', 'tr-season']].forEach(([k, id]) => {
    const v = document.getElementById(id).value;
    if (v) p.set(k, v);
  });
  if (trState.sortKey !== 'date') p.set('sort', trState.sortKey);
  if (trState.sortDesc !== (trState.sortKey === 'date')) p.set('order', trState.sortDesc ? 'desc' : 'asc');
  if (!trState.showReturns) p.set('returns', '0');
  const qs = p.toString();
  try { history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash); } catch (e) { /* e.g. file:// in some browsers */ }
}

function renderTransfers() {
  const q = document.getElementById('tr-search').value.trim().toLowerCase();
  const type = document.getElementById('tr-type').value;
  const squad = document.getElementById('tr-squad').value;
  const seasonId = document.getElementById('tr-season').value;

  const list = trState.rows.filter(r =>
    (trState.showReturns || !r.isReturn) &&
    (trState.dir === 'all' || r.t.dir === trState.dir) &&
    (!type || r.type === type) &&
    (!squad || r.squad === squad) &&
    (!seasonId || (r.season && r.season.id === seasonId)) &&
    (!q || r.player.name.toLowerCase().includes(q) || r.club.toLowerCase().includes(q))
  ).sort(compareRows);

  const nIn = list.filter(r => r.t.dir === 'in').length, nOut = list.filter(r => r.t.dir === 'out').length;
  document.getElementById('tr-summary').textContent = `${list.length} movement${list.length === 1 ? '' : 's'} · ${nIn} incoming · ${nOut} outgoing`;

  // Season headings only make sense while the list is in date order.
  const grouped = trState.sortKey === 'date';
  let html = '', lastGroup = null;
  list.forEach(r => {
    if (grouped) {
      const g = groupLabel(r, trState.seasons);
      if (g !== lastGroup) { html += `<tr class="tr-group"><td colspan="7">${trEsc(g)}</td></tr>`; lastGroup = g; }
    }
    const dir = r.t.dir === 'other' ? '' : `<span class="tr-dir-pill tr-${r.t.dir}">${r.t.dir === 'in' ? 'In' : 'Out'}</span>`;
    const squadHtml = r.squad ? `<span class="guest-tag">${trEsc(SQUAD_SHORT[r.squad] || r.squad)}</span>` : '<span class="tr-none">—</span>';
    const club = r.club ? `<span class="tr-prep">${r.t.prep}</span> ${trEsc(r.club)}` : '<span class="tr-none">—</span>';
    const details = [r.details, r.note ? `<em>${trEsc(r.note)}</em>` : ''].filter(Boolean).join(' · ');
    html += `<tr class="tr-row tr-${r.t.dir}"><td class="tr-date">${trDMY(r.date) || 'Unknown'}</td><td>${dir}</td>` +
      `<td class="tr-player">${playerLinkHtml(r.player)}</td><td>${squadHtml}</td>` +
      `<td><span class="${r.t.cls}">${trEsc(r.t.label)}</span></td><td>${club}</td><td class="tr-details">${details}</td></tr>`;
  });
  document.getElementById('tr-body').innerHTML = html || '<tr><td colspan="7" class="tr-empty">No movements match these filters.</td></tr>';
  syncSortUi();
  writeUrlState();
}

function fillSelect(id, firstLabel, options) {
  document.getElementById(id).innerHTML = `<option value="">${firstLabel}</option>` +
    options.map(([v, l]) => `<option value="${trEsc(v)}">${trEsc(l)}</option>`).join('');
}

async function initTransfers() {
  document.title = 'Transfer history — ' + TEAM.title;
  document.getElementById('page-subtitle').textContent = TEAM.clubName + ' — every incoming and outgoing movement, by date';
  mountTeamSwitcher();

  try {
    const seasons = (await loadSeasons()) || [];
    const masterFile = sharedMasterFile(seasons);
    const master = await withArchive(await fetchJson(masterFile), masterFile);

    // Each season's merged roster, keyed by player id, for the squad at the time.
    const rosterMerged = {};
    await Promise.all(seasons.map(async s => {
      try {
        const roster = await fetchJson(s.playersFile);
        const map = {};
        mergePlayers(master, roster, s.ageBands).forEach(p => { map[p.id] = p; });
        rosterMerged[s.id] = map;
      } catch (e) { /* season without a roster file: squads fall back to dob */ }
    }));

    trState.seasons = seasons;
    trState.rows = buildRows(master, seasons, rosterMerged);

    const ALL_TYPES = Object.assign({}, TRANSFER_TYPES, RETURN_TYPES);
    const types = Object.keys(ALL_TYPES).filter(k => trState.rows.some(r => r.type === k));
    fillSelect('tr-type', 'All movements', types.map(k => [k, ALL_TYPES[k].label]));
    const squads = SQUAD_ORDER.concat(Object.keys(SQUAD_LABEL)).filter((k, i, a) => a.indexOf(k) === i && trState.rows.some(r => r.squad === k));
    fillSelect('tr-squad', 'All squads', squads.map(k => [k, SQUAD_LABEL[k] || k]));
    fillSelect('tr-season', 'All seasons', seasons.map(s => [s.id, s.label || s.id]));

    document.getElementById('tr-dir').addEventListener('click', e => {
      const b = e.target.closest('button[data-dir]');
      if (!b) return;
      trState.dir = b.dataset.dir;
      document.querySelectorAll('#tr-dir button').forEach(x => x.classList.toggle('active', x === b));
      renderTransfers();
    });
    ['tr-type', 'tr-squad', 'tr-season'].forEach(id => document.getElementById(id).addEventListener('change', renderTransfers));
    document.getElementById('tr-search').addEventListener('input', renderTransfers);
    // "Show loan returns" toggle (markup in transfers.html, styles in transfers.css). On by default.
    document.getElementById('tr-returns').addEventListener('change', e => {
      trState.showReturns = e.target.checked;
      renderTransfers();
    });
    // Sorting: header buttons (wide screens), the "Sort by" dropdown (narrow screens), and the direction button.
    document.querySelector('.tr-table thead').addEventListener('click', e => {
      const th = e.target.closest('th[data-sort]');
      if (th) setSortKey(th.dataset.sort);
    });
    document.getElementById('tr-sortkey').addEventListener('change', e => {
      trState.sortKey = e.target.value;
      trState.sortDesc = trState.sortKey === 'date';
      renderTransfers();
    });
    document.getElementById('tr-sort').addEventListener('click', () => {
      trState.sortDesc = !trState.sortDesc;
      renderTransfers();
    });

    readUrlState();
    document.getElementById('transfers-root').hidden = false;
    renderTransfers();
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  } finally {
    hideLoading();
  }
}

initTransfers();