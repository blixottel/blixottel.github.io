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

const trEsc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const trDMY = iso => (iso ? iso.split('-').reverse().join('/') : '');
const trState = { rows: [], seasons: [], dir: 'all', newestFirst: true };

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

function buildRows(master, seasons, rosterMerged) {
  const rows = [];
  master.forEach(p => {
    (p.movements || []).forEach(m => {
      const t = TRANSFER_TYPES[m.type] || { label: m.type || 'Movement', dir: 'other', cls: 'guest-tag', prep: '' };
      const ms = looseDate(m.date, false);
      const season = seasonFor(ms, seasons);
      const endDate = m.endDate || m.enddate || m.end_date || '';
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

function renderTransfers() {
  const q = document.getElementById('tr-search').value.trim().toLowerCase();
  const type = document.getElementById('tr-type').value;
  const squad = document.getElementById('tr-squad').value;
  const seasonId = document.getElementById('tr-season').value;

  const list = trState.rows.filter(r =>
    (trState.dir === 'all' || r.t.dir === trState.dir) &&
    (!type || r.type === type) &&
    (!squad || r.squad === squad) &&
    (!seasonId || (r.season && r.season.id === seasonId)) &&
    (!q || r.player.name.toLowerCase().includes(q) || r.club.toLowerCase().includes(q))
  ).sort((a, b) => {
    // Unknown dates always sink to the bottom; same-day rows fall back to name.
    if (a.ms === null || b.ms === null) return (a.ms === null) - (b.ms === null);
    const d = trState.newestFirst ? b.ms - a.ms : a.ms - b.ms;
    return d || a.player.name.localeCompare(b.player.name);
  });

  const nIn = list.filter(r => r.t.dir === 'in').length, nOut = list.filter(r => r.t.dir === 'out').length;
  document.getElementById('tr-summary').textContent = `${list.length} movement${list.length === 1 ? '' : 's'} · ${nIn} incoming · ${nOut} outgoing`;

  let html = '', lastGroup = null;
  list.forEach(r => {
    const g = groupLabel(r, trState.seasons);
    if (g !== lastGroup) { html += `<tr class="tr-group"><td colspan="7">${trEsc(g)}</td></tr>`; lastGroup = g; }
    const dir = r.t.dir === 'other' ? '' : `<span class="tr-dir-pill tr-${r.t.dir}">${r.t.dir === 'in' ? 'In' : 'Out'}</span>`;
    const squadHtml = r.squad ? `<span class="guest-tag">${trEsc(SQUAD_SHORT[r.squad] || r.squad)}</span>` : '<span class="tr-none">—</span>';
    const club = r.club ? `<span class="tr-prep">${r.t.prep}</span> ${trEsc(r.club)}` : '<span class="tr-none">—</span>';
    const details = [r.details, r.note ? `<em>${trEsc(r.note)}</em>` : ''].filter(Boolean).join(' · ');
    html += `<tr class="tr-row tr-${r.t.dir}"><td class="tr-date">${trDMY(r.date) || 'Unknown'}</td><td>${dir}</td>` +
      `<td class="tr-player">${playerLinkHtml(r.player)}</td><td>${squadHtml}</td>` +
      `<td><span class="${r.t.cls}">${trEsc(r.t.label)}</span></td><td>${club}</td><td class="tr-details">${details}</td></tr>`;
  });
  document.getElementById('tr-body').innerHTML = html || '<tr><td colspan="7" class="tr-empty">No movements match these filters.</td></tr>';
}

function fillSelect(id, firstLabel, options) {
  document.getElementById(id).innerHTML = `<option value="">${firstLabel}</option>` +
    options.map(([v, l]) => `<option value="${trEsc(v)}">${trEsc(l)}</option>`).join('');
}

async function initTransfers() {
  document.title = 'Transfer history — ' + TEAM.title;
  document.getElementById('page-subtitle').textContent = TEAM.clubName + ' — every incoming and outgoing movement, by date';
  if (TEAMS.length > 1) document.getElementById('season-switcher-slot').appendChild(buildTeamSwitcher());

  try {
    const seasons = (await loadSeasons()) || [];
    const masterFile = (seasons[0] && seasons[0].playersMasterFile) || TEAM.dataDir + 'players-master.json';
    const res = await fetch(masterFile);
    if (!res.ok) throw new Error('master fetch failed');
    const master = await withArchive(await res.json(), masterFile);

    // Each season's merged roster, keyed by player id, for the squad at the time.
    const rosterMerged = {};
    await Promise.all(seasons.map(async s => {
      try {
        const r = await fetch(s.playersFile);
        if (!r.ok) return;
        const map = {};
        mergePlayers(master, await r.json(), s.ageBands).forEach(p => { map[p.id] = p; });
        rosterMerged[s.id] = map;
      } catch (e) { /* season without a roster file: squads fall back to dob */ }
    }));

    trState.seasons = seasons;
    trState.rows = buildRows(master, seasons, rosterMerged);

    const types = Object.keys(TRANSFER_TYPES).filter(k => trState.rows.some(r => r.type === k));
    fillSelect('tr-type', 'All movements', types.map(k => [k, TRANSFER_TYPES[k].label]));
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
    document.getElementById('tr-sort').addEventListener('click', e => {
      trState.newestFirst = !trState.newestFirst;
      e.currentTarget.textContent = trState.newestFirst ? 'Newest first ↓' : 'Oldest first ↑';
      renderTransfers();
    });

    document.getElementById('transfers-root').hidden = false;
    renderTransfers();
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  }
}

initTransfers();