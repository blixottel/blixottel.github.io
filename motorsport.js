// ============================================================
// Pit Wall — motorsport link tracker
// Reads every series from series-data.json as a flat list. Which
// section a series lands in (Overdue / This week / etc.) is worked
// out here from its nextDate, not stored in the data — so the JSON
// never needs re-shuffling as dates pass.
// ============================================================

const DATA_URL = 'series-data.json';

// Category → accent colour + human label. Colours match the values
// previously hard-coded per class in motorsport.css.
const CATEGORY_META = {
  formula1:         { label: 'FIA Formula',          color: 'var(--formula1)' },
  formulaRegional:  { label: 'Regional Formula',     color: 'var(--formulaRegional)' },
  formula4:         { label: 'FIA F4',                color: 'var(--formula4)' },
  nonFIA:           { label: 'National / Non-FIA',    color: 'var(--nonFIA)' },
  usaSeries:        { label: 'USA Series',            color: 'var(--usaSeries)' },
  motorbikes:       { label: 'Motorbikes',            color: 'var(--motorbikes)' },
  electric:         { label: 'Electric',              color: 'var(--electric)' },
  karting:          { label: 'Karting',               color: 'var(--karting)' },
};

// Which link keys to show, in order, and what icon/label to use.
// Every row always renders all four, in this order, so the columns
// line up regardless of which links a given series actually has.
const LINK_TYPES = [
  { key: 'official',  icon: 'fa-globe',    label: 'Site' },
  { key: 'results',   icon: 'fa-poll',     label: 'Results' },
  { key: 'standings', icon: 'fa-table',    label: 'Standings' },
  { key: 'calendar',  icon: 'fa-calendar', label: 'Calendar' },
];

const DUE_SOON_DAYS = 7;

// Secondary sort within a group, after date: category in this fixed
// sequence (distinct from the CATEGORY_META declaration order above,
// which only drives the legend). Anything not listed falls to the end.
const CATEGORY_SORT_ORDER = [
  'formula1',
  'formulaRegional',
  'formula4',
  'nonFIA',
  'usaSeries',
  'electric',
  'motorbikes',
  'karting',
];

function categoryRank(category) {
  const idx = CATEGORY_SORT_ORDER.indexOf(category);
  return idx === -1 ? CATEGORY_SORT_ORDER.length : idx;
}

// Kind of bucket a series falls into, ordered for display.
const KIND_ORDER = { overdue: 0, 'this-week': 1, plain: 2, tbs: 3 };
const KIND_SUFFIX = {
  overdue: ' : Overdue',
  'this-week': ' : This week',
  plain: '',
  tbs: ' : To be scheduled',
};
// Sections that start expanded; everything else starts collapsed.
const OPEN_BY_DEFAULT = new Set(['this-week']);

function parseSeriesDate(text) {
  if (!text) return null;
  if (/^\d{4}$/.test(text.trim())) {
    return { date: new Date(Number(text.trim()), 0, 1), bareYear: true };
  }
  const d = new Date(text);
  return isNaN(d) ? null : { date: d, bareYear: false };
}

function classify(series, now) {
  if (!series.resultsVerified) {
    // Overdue is purely a manual flag now — disregard the date entirely.
    // Whatever nextDate says, an unverified series stays in Overdue until
    // you flip the flag.
    const parsed = parseSeriesDate(series.nextDate);
    return {
      year: parsed ? parsed.date.getFullYear() : now.getFullYear(),
      kind: 'overdue',
      sortDate: parsed ? parsed.date : now,
    };
  }

  const parsed = parseSeriesDate(series.nextDate);
  if (!parsed) return { year: now.getFullYear(), kind: 'tbs', sortDate: now };

  const { date, bareYear } = parsed;
  const year = date.getFullYear();

  if (bareYear) return { year, kind: 'tbs', sortDate: date };

  const diffDays = (date - now) / 86400000;
  let kind;
  if (date <= now) kind = 'plain'; // already verified — just archived under its year, not "due soon"
  else if (diffDays <= DUE_SOON_DAYS) kind = 'this-week';
  else kind = 'plain';

  return { year, kind, sortDate: date };
}

function dueState(kind) {
  if (kind === 'overdue') return 'overdue';
  if (kind === 'this-week') return 'due-soon';
  return 'upcoming';
}

function buildLinkCell(type, linkData) {
  const cell = document.createElement('div');
  cell.className = 'cell cell-link';
  const a = document.createElement('a');
  a.className = 'link-chip';
  const active = !!(linkData && linkData.active && linkData.url);
  if (active) {
    a.href = linkData.url;
    a.target = '_blank';
    a.rel = 'noopener';
  } else {
    a.classList.add('inactive');
    a.setAttribute('aria-disabled', 'true');
    if (linkData && linkData.url) a.title = 'Link currently disabled';
  }
  a.innerHTML = `<i class="fas ${type.icon}"></i><span>${type.label}</span>`;
  cell.appendChild(a);
  return cell;
}

function buildSocialCell(social) {
  const cell = document.createElement('div');
  cell.className = 'cell cell-social';
  (social || []).forEach(entry => {
    const a = document.createElement('a');
    a.href = entry.url;
    a.target = '_blank';
    a.rel = 'noopener';
    a.title = entry.platform;
    a.innerHTML = `<i class="fab fa-${entry.platform}"></i>`;
    cell.appendChild(a);
  });
  return cell;
}

function buildRow(series) {
  const meta = CATEGORY_META[series.category] || { label: series.category, color: 'var(--ink-faint)' };

  const row = document.createElement('div');
  row.className = 'row';
  row.style.setProperty('--accent', meta.color);
  row.dataset.category = series.category;

  const tab = document.createElement('div');
  tab.className = 'cell cell-tab';
  tab.title = meta.label;

  const name = document.createElement('div');
  name.className = 'cell cell-name';
  name.textContent = series.name;

  row.appendChild(tab);
  row.appendChild(name);
  LINK_TYPES.forEach(type => row.appendChild(buildLinkCell(type, series.links[type.key])));
  row.appendChild(buildSocialCell(series.social));

  const now = new Date();
  const parsedForIcon = parseSeriesDate(series.nextDate);
  const wasVerified = !!series.resultsVerified && parsedForIcon && !parsedForIcon.bareYear && parsedForIcon.date <= now;
  const date = document.createElement('div');
  date.className = 'cell cell-date';
  const icon = wasVerified ? 'fa-check' : 'fa-forward';
  date.innerHTML = `<i class="fas ${icon}"></i><span>${series.nextDate || 'TBC'}</span>`;
  if (wasVerified) date.title = 'Results checked off';
  row.appendChild(date);

  return row;
}

function refreshDueStates(seriesRows) {
  const now = new Date();
  seriesRows.forEach(({ row, series }) => {
    const { kind } = classify(series, now);
    const el = row.querySelector('.cell-date');
    el.classList.remove('overdue', 'due-soon');
    const state = dueState(kind);
    if (state === 'overdue') el.classList.add('overdue');
    if (state === 'due-soon') el.classList.add('due-soon');
  });
}

function buildLegend() {
  const legend = document.getElementById('legend');
  Object.entries(CATEGORY_META).forEach(([key, meta]) => {
    const item = document.createElement('span');
    item.className = 'legend-item';
    item.innerHTML = `<span class="legend-swatch" style="background:${meta.color}"></span>${meta.label}`;
    legend.appendChild(item);
  });
}

function groupBuckets(allSeries) {
  const now = new Date();
  const buckets = new Map(); // key -> { year, kind, title, id, items: [] }

  allSeries.forEach(series => {
    const { year, kind, sortDate } = classify(series, now);
    const key = `${year}-${kind}`;
    if (!buckets.has(key)) {
      const title = `${year} motorsport series${KIND_SUFFIX[kind]}`;
      buckets.set(key, {
        year, kind, title,
        id: title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''),
        items: [],
      });
    }
    buckets.get(key).items.push({ series, sortDate });
  });

  const groups = Array.from(buckets.values());
  groups.forEach(g => g.items.sort((a, b) =>
    a.sortDate - b.sortDate
    || categoryRank(a.series.category) - categoryRank(b.series.category)
    || a.series.name.localeCompare(b.series.name)
  ));
  groups.sort((a, b) => a.year - b.year || KIND_ORDER[a.kind] - KIND_ORDER[b.kind]);
  return groups;
}

function buildGroup(group, seriesRows) {
  const details = document.createElement('details');
  details.className = 'group';
  details.id = group.id;
  details.open = OPEN_BY_DEFAULT.has(group.kind);

  const summary = document.createElement('summary');
  summary.innerHTML = `
    <span class="group-title">${group.title}</span>
    <span class="group-count">${group.items.length} series</span>
  `;
  details.appendChild(summary);

  const rows = document.createElement('div');
  rows.className = 'rows';
  group.items.forEach(({ series }) => {
    const row = buildRow(series);
    rows.appendChild(row);
    seriesRows.push({ row, series });
  });
  details.appendChild(rows);

  return details;
}

function buildJumpNav(groups) {
  const nav = document.getElementById('jump-nav');
  groups.forEach(group => {
    const a = document.createElement('a');
    a.href = '#' + group.id;
    const suffix = KIND_SUFFIX[group.kind] ? KIND_SUFFIX[group.kind] : '';
    a.innerHTML = `${group.year}${suffix}<span class="n">${group.items.length}</span>`;
    a.addEventListener('click', () => {
      const target = document.getElementById(group.id);
      if (target) target.open = true;
    });
    nav.appendChild(a);
  });
}

async function init() {
  buildLegend();
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    const groups = groupBuckets(data.series);
    buildJumpNav(groups);

    const main = document.getElementById('main');
    const seriesRows = [];
    groups.forEach(group => main.appendChild(buildGroup(group, seriesRows)));

    refreshDueStates(seriesRows);
    setInterval(() => refreshDueStates(seriesRows), 60000);

    const stamp = document.getElementById('updated-stamp');
    if (stamp) stamp.textContent = 'Loaded ' + new Date().toLocaleString();
  } catch (err) {
    console.error(err);
    document.getElementById('load-error').style.display = 'block';
  }
}

init();