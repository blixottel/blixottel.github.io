/**
 * player.js — player profile page: bio, career totals, and a season-by-season
 * timeline split by squad. Reuses data.js / stats.js / render.js as-is.
 */
const SQUAD_ORDER_TL = SQUAD_ORDER; // First Team, U21s, U19s, U18s

function statVal(stat, col, squadKey) {
  if (col.seniorOnly && squadKey !== 'senior' && squadKey !== null) return '—';
  const v = stat ? stat[col.key] : null;
  if (v == null) return '—';
  return col.decimals != null ? v.toFixed(col.decimals) : v;
}

function sumStats(list) {
  const t = { appearances: 0, starts: 0, subApps: 0, goals: 0, xg: 0, assists: 0, yellowCards: 0, redCards: 0, minutes: null };
  list.forEach(s => {
    Object.keys(t).forEach(k => {
      if (k === 'minutes') { if (typeof s.minutes === 'number') t.minutes = (t.minutes || 0) + s.minutes; }
      else t[k] += s[k] || 0;
    });
  });
  return t;
}

function eventChips(rec) {
  if (!rec) return '';
  const c = [];
  if (rec.goals) c.push(`<i class="g">${rec.goals}</i>`);
  if (rec.assists) c.push(`<i class="a">${rec.assists}</i>`);
  if (rec.yellowCard) c.push('<i class="y">&nbsp;</i>');
  if (rec.redCard) c.push('<i class="r">&nbsp;</i>');
  return c.length ? `<div class="ev">${c.join('')}</div>` : '';
}

function recTitle(fx, rec) {
  const bits = [`${fmtDate(fx.date)} v ${fx.opponent}${fx.venue ? ' (' + fx.venue + ')' : ''}`];
  if (fx.competition) bits.push(fx.competition);
  if (fx.result) bits.push(fx.result);
  if (rec) {
    bits.push(rec.status.replace('_', ' '));
    if (typeof rec.minutes === 'number') bits.push(rec.minutes + "'");
    if (rec.goals) bits.push(rec.goals + ' goal' + (rec.goals > 1 ? 's' : ''));
    if (rec.assists) bits.push(rec.assists + ' assist' + (rec.assists > 1 ? 's' : ''));
    if (rec.yellowCard) bits.push('yellow card');
    if (rec.redCard) bits.push('red card');
    if (rec.reasonNote) bits.push(rec.reasonNote);
  }
  return bits.join(' · ').replace(/"/g, '&quot;');
}

function playerStrip(fd, id) {
  const fixtures = fd.fixtures || [];
  const recs = (fd.appearances || {})[id] || {};
  const head = fixtures.map((fx, i) => {
    const cc = fixtureColourClass(fx);
    return `<th class="${cc ? 'fx-' + cc : ''}" title="${recTitle(fx, null)}"><span class="fx-num">${fx.gameweek != null ? fx.gameweek : i + 1}</span><span class="fx-venue">${fx.venue || ''}</span></th>`;
  }).join('');
  const cells = fixtures.map(fx => {
    const cc = fixtureColourClass(fx);
    const rec = recs[fx.id] || loanAt(fx.date);
    return `<td class="cell ${cc ? 'fx-' + cc + '-col' : ''}" title="${recTitle(fx, rec)}">${statusMarker(rec)}${eventChips(rec)}</td>`;
  }).join('');
  return `<div class="matrix-wrap"><table class="matrix solo"><thead><tr><th class="player-col">Fixture</th>${head}</tr></thead><tbody><tr><td class="player-col">Matchday</td>${cells}</tr></tbody></table></div>`;
}

function totalsTable(rows, heads) {
  const showSenior = rows.some(r => r.key === 'senior');
  const cols = STAT_COLUMNS.filter(c => !c.seniorOnly || showSenior);
  const body = rows.map(r => `<tr class="${r.total ? 'total' : ''} ${r.start ? 'start' : ''}">${r.cells.map(c => `<td>${c}</td>`).join('')}${cols.map(c => `<td>${statVal(r.stat, c, r.key)}</td>`).join('')}</tr>`).join('');
  return `<div class="totals-wrap"><table class="season-totals"><thead><tr>${heads.map(h => `<th>${h}</th>`).join('')}${cols.map(c => `<th>${c.label}</th>`).join('')}</tr></thead><tbody>${body}</tbody></table></div>`;
}

function careerTable(entries) {
  const all = entries.flatMap(e => e.squads);
  const rows = SQUAD_ORDER_TL.filter(k => all.some(s => s.key === k)).map(k => ({ key: k, cells: [SQUAD_LABEL[k]], stat: sumStats(all.filter(s => s.key === k).map(s => s.stat)) }));
  if (rows.length > 1) rows.push({ key: null, total: true, cells: ['Career total'], stat: sumStats(all.map(s => s.stat)) });
  return rows.length ? totalsTable(rows, ['Squad']) : '<p class="tl-empty">No appearances logged yet.</p>';
}

function summaryTable(entries) {
  const rows = [];
  entries.forEach(e => {
    if (!e.squads.length) return;
    e.squads.forEach((sq, i) => rows.push({ key: sq.key, start: i === 0, cells: [i === 0 ? e.season.label : '', SQUAD_LABEL[sq.key]], stat: sq.stat }));
    if (e.squads.length > 1) rows.push({ key: null, total: true, cells: ['', 'Season total'], stat: sumStats(e.squads.map(s => s.stat)) });
  });
  return rows.length ? totalsTable(rows, ['Season', 'Squad']) : '';
}

// Accepts "2021-07-01", "2021-07" or "2021" and shows dd/mm/yyyy (or as much as was given).
function fmtDMY(iso) { return iso ? iso.split('-').reverse().join('/') : ''; }

// Loan spells (loan_out movements) — used to mark the fixture strip and season header.
let LOANS = [];
const endKey = d => (d && d.length < 10 ? d + '-99' : d);
function loanAt(date) {
  const m = LOANS.find(l => date && date >= l.date && (!l.endDate || date <= endKey(l.endDate)));
  return m ? { status: 'loan', reasonNote: `On loan · ${m.club}` } : null;
}
function loansIn(range) {
  return range ? LOANS.filter(l => l.date <= range[1] && (!l.endDate || endKey(l.endDate) >= range[0])) : [];
}
function loanBand(m) {
  return `<div class="loan-band">On loan · <b>${m.club}</b> · ${fmtDMY(m.date)} – ${m.endDate ? fmtDMY(m.endDate) : 'ongoing'}${m.note ? ' · ' + m.note : ''}</div>`;
}

const MOVE_TYPES = {
  joined:   { label: 'Joined',  cls: 'guest-tag', prep: 'from' },
  left:     { label: 'Left',    cls: 'guest-tag left-tag', prep: 'to' },
  loan_out: { label: 'Loan',    cls: 'guest-tag loan-tag', prep: 'to' },
  loan_in:  { label: 'Loan in', cls: 'guest-tag incoming-tag', prep: 'from' },
  trial_in: { label: 'Trial',   cls: 'guest-tag trialist-tag', prep: 'from' },
};

function movementsBlock(list) {
  if (!list || !list.length) return '';
  const rows = [...list].sort((a, b) => (a.date || '').localeCompare(b.date || '')).map(m => {
    const t = MOVE_TYPES[m.type] || { label: m.type, cls: 'guest-tag', prep: '' };
    const loan = m.type === 'loan_out' || m.type === 'loan_in' || m.type === 'trial_in';
    const dates = loan && m.endDate !== m.date ? `${fmtDMY(m.date)} – ${m.endDate ? fmtDMY(m.endDate) : 'ongoing'}` : fmtDMY(m.date);
    return `<li><span class="mv-date">${dates || 'Date unknown'}</span><span class="${t.cls}">${t.label}</span><span>${t.prep} <b>${m.club || '—'}</b>${m.note ? ` <em>${m.note}</em>` : ''}</span></li>`;
  }).join('');
  return `<h3 class="block-heading">Movements</h3><ol class="moves">${rows}</ol>`;
}

function seasonBlock(entry, id) {
  const { season, merged, squads } = entry;
  const home = merged ? normSquad(merged.squad) : null;
  const pills = [];
  if (home) pills.push(`<span class="guest-tag">${SQUAD_SHORT[home] || home}</span>`);
  if (merged && merged.number) pills.push(`<span class="guest-tag">#${merged.number}</span>`);
  const loans = loansIn(entry.range);
  if (merged) playerBadges(merged, home).filter(b => !(loans.length && b.kind === 'loan')).forEach(b => pills.push(`<span class="${b.cls}">${b.text}${b.kind === 'loan' && merged.loanClub ? ' · ' + merged.loanClub : ''}</span>`));

  let html = `<div class="tl-season"><div class="tl-head"><h3>${season.label || season.id}</h3>${pills.join('')}</div>${loans.map(loanBand).join('')}`;
  if (!squads.length) {
    html += '<p class="tl-empty">No matchday-squad appearances logged this season.</p>';
  } else {
    squads.forEach(sq => {
      const guest = home && sq.key !== home ? '<span class="guest-tag">Guest</span>' : '';
      html += `<div class="tl-squad"><h4>${SQUAD_LABEL[sq.key]} ${guest}</h4>${playerStrip(sq.fd, id)}</div>`;
    });
  }
  return html + '</div>';
}

// Bio status, worked out from movements and today's date. Order of precedence:
// on loan out > trialist > on loan in > left > incoming. With no movements at
// all it falls back to the roster status; with movements, only the roster's
// "injured" / "not selected" statuses are kept as a fallback.
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function statusPills(p, hasRoster) {
  const t = todayISO();
  const mv = [...(p.movements || [])].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const started = m => m.date && m.date <= t;
  const live = m => started(m) && (!m.endDate || endKey(m.endDate) >= t);
  const pill = (cls, text) => `<span class="guest-tag ${cls}" style="margin-left:0">${text}</span>`;
  const loanOut = mv.find(m => m.type === 'loan_out' && live(m));
  if (loanOut) return pill('loan-tag', `On loan · ${loanOut.club}`);
  const trial = mv.find(m => m.type === 'trial_in' && live(m));
  if (trial) return pill('trialist-tag', `Trialist${trial.club ? ' · ' + trial.club : ''}`);
  const loanIn = mv.find(m => m.type === 'loan_in' && live(m));
  if (loanIn) return pill('incoming-tag', `On loan from ${loanIn.club}`);
  const last = [...mv].reverse().find(m => (m.type === 'left' || m.type === 'joined') && started(m));
  if (last && last.type === 'left') return pill('left-tag', `Left${last.club ? ' · ' + last.club : ''}`);
  if (mv.some(m => m.type === 'joined' && m.date > t)) return pill('incoming-tag', 'Incoming');
  if (!hasRoster) return '';
  return playerBadges(p, normSquad(p.squad))
    .filter(b => !mv.length || b.kind === 'injured-season' || b.kind === 'not-selected-season')
    .map(b => `<span class="${b.cls}" style="margin-left:0">${b.text}${b.kind === 'loan' && p.loanClub ? ' · ' + p.loanClub : ''}</span>`).join('');
}

async function initPlayer() {
  const root = document.getElementById('player-root');
  try {
    const id = new URLSearchParams(location.search).get('id');
    if (!id) throw new Error('no id');
    const seasons = (await loadSeasons()) || [];
    const masterPath = (seasons[0] && seasons[0].playersMasterFile) || 'data/players-master.json';
    const master = await withArchive(await (await fetch(masterPath)).json(), masterPath);
    if (!master.some(p => p.id === id)) throw new Error('unknown id');

    const loaded = await Promise.all(seasons.map(async s => {
      try {
        const [rr, fr] = await Promise.all([fetch(s.playersFile), fetch(s.fixturesFile)]);
        if (!rr.ok || !fr.ok) return null;
        const roster = (await rr.json()).filter(r => r.id === id);
        const fixtures = await fr.json();
        const merged = roster.length ? mergePlayers(master, roster, s.ageBands)[0] : null;
        const squads = squadKeysFor(fixtures)
          .filter(k => namedPlayerIdsFor(fixtures[k]).includes(id))
          .map(k => ({ key: k, fd: fixtures[k], stat: computeStatsForSquad(fixtures[k])[id] }));
        const dates = Object.values(fixtures).flatMap(sq => (sq.fixtures || []).map(f => f.date)).filter(Boolean).sort();
        const range = dates.length ? [dates[0], dates[dates.length - 1]] : null;
        return (merged || squads.length) ? { season: s, merged, squads, range, fixtures } : null;
      } catch (e) { return null; }
    }));
    const entries = loaded.filter(Boolean).reverse(); // oldest first

    const latest = [...entries].reverse().find(e => e.merged);
    const p = latest ? latest.merged : mergePlayers(master, [{ id }], [])[0];
    // Be forgiving about key casing (e.g. "enddate" vs "endDate").
    p.movements = (p.movements || []).map(m => ({ ...m, endDate: m.endDate || m.enddate || m.end_date || '' }));
    LOANS = (p.movements || []).filter(m => m.type === 'loan_out');
    document.title = `${p.name} — The Teamsheet`;
    document.getElementById('player-title').textContent = p.name;
    const firstL = entries.length ? entries[0].season.label : '', lastL = entries.length ? entries[entries.length - 1].season.label : '';
    const span = firstL === lastL ? firstL : `${firstL} – ${lastL}`;
    document.getElementById('player-subtitle').textContent = `Newcastle United${span ? ' · ' + span : ''}`;

    const bornLong = p.dob ? new Date(p.dob + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';
    const status = statusPills(p, !!latest);
    const fact = (k, v) => `<div><dt>${k}</dt><dd>${v}</dd></div>`;

    const issues = entries.flatMap(e => checkMovementDates(p, e.fixtures).map(i => ({ ...i, season: e.season.label })));
    const issuesHtml = !issues.length ? '' : `<div id="validation-panel" style="display:block;margin:0 0 24px"><h2>Data checks — ${issues.length} issue${issues.length === 1 ? '' : 's'}</h2>${
      isLocalDev() ? `<ul>${issues.map(i => `<li class="error">${i.season}: ${i.message}</li>`).join('')}</ul>` : '<p class="vp-concise-note">There are inconsistencies in the underlying data for this player.</p>'}</div>`;
    const trackedFrom = seasons.length ? seasons[seasons.length - 1].label : '';
    const partial = !p.careerComplete;
    const evKey = '<div class="ev-key"><span><span class="ev"><i class="g">1</i></span> Goals</span><span><span class="ev"><i class="a">1</i></span> Assists</span><span><span class="ev"><i class="y">&nbsp;</i></span> Yellow card</span><span><span class="ev"><i class="r">&nbsp;</i></span> Red card</span></div>';
    const legend = buildLegend();
    legend.insertAdjacentHTML('beforeend', evKey);

    root.innerHTML = `
      ${issuesHtml}
      <section class="bio">
        <div class="bio-photo ${todoState(p)}"><div class="photo-fallback">${initialsFor(p.name)}</div>${buildPhotoImg(p)}${p.number ? `<span class="number-badge">${p.number}</span>` : ''}</div>
        <dl class="bio-facts">
          ${fact('Position', p.position || '—')}${fact('Age', calcAge(p.dob))}${fact('Born', bornLong)}
          ${fact('Nationality', p.nationality || '—')}
          ${latest ? fact('Current squad', SQUAD_LABEL[normSquad(p.squad)] || p.squad) : ''}
          ${status ? fact('Status', status) : ''}
          ${fact('Career record', partial ? '<span class="guest-tag loan-tag" style="margin-left:0">Partial</span>' : '<span class="guest-tag" style="margin-left:0">Complete</span>')}
        </dl>
      </section>
      <h3 class="block-heading">Career totals</h3>
      <p class="note">${partial ? `Partial record: figures cover ${trackedFrom} onwards only, so earlier seasons aren't included.` : 'Complete record: every season this player has played in is in the data.'}</p>
      ${careerTable(entries)}
      ${movementsBlock(p.movements)}
      <h3 class="block-heading">Fixture-by-fixture</h3>
      ${entries.length ? legend.outerHTML : '<p class="note">No seasons found for this player yet.</p>'}
      <div class="timeline">${entries.map(e => seasonBlock(e, id)).join('')}</div>
      ${entries.some(e => e.squads.length) ? `<h3 class="block-heading">Season summary</h3>${summaryTable(entries)}` : ''}`;
  } catch (err) {
    console.error(err);
    document.getElementById('player-title').textContent = 'Player not found';
    document.getElementById('load-error').style.display = 'block';
  }
}

initPlayer();