/**
 * nav.js — the little "Squad tracker · Data checks · Photo gallery" link row
 * shown in the masthead of index.html, validation.html and gallery.html.
 * Self-contained (injects its own CSS), so it can be dropped into any page
 * that has a <div id="site-nav"></div>.
 *
 * The current ?team= and ?season= are carried across every link, so hopping
 * between pages keeps you on the same team and season.
 *
 *   buildSiteNav('teamsheet' | 'transfers' | 'validation' | 'gallery')   // marks the current page
 *   setNavBadge('validation', 3)                            // optional count next to a link (0 or null clears it)
 *
 * To add another page later, add a line to SITE_PAGES. Pages marked
 * localOnly are only linked when running on localhost (or from disk); on a
 * published copy they're left out, and if that leaves just one link the whole
 * row is hidden. (This only hides the links — the pages are still reachable
 * if someone types the address.)
 */
const SITE_PAGES = [
  { id: 'teamsheet',  label: 'Squad tracker', href: 'index.html' },
  { id: 'transfers',  label: 'Transfer history', href: 'transfers.html' },
  { id: 'validation', label: 'Data checks',   href: 'validation.html', localOnly: true },
  { id: 'gallery',    label: 'Photo gallery', href: 'gallery.html',    localOnly: true },
];

// Same test as isLocalDev() in data.js, repeated here because the gallery
// page doesn't load data.js.
function navIsLocal() {
  const h = location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h === '' || location.protocol === 'file:';
}

function buildSiteNav(currentId) {
  const slot = document.getElementById('site-nav');
  if (!slot) return;

  if (!document.getElementById('site-nav-style')) {
    const style = document.createElement('style');
    style.id = 'site-nav-style';
    style.textContent = `
      .site-nav { display: flex; flex-wrap: wrap; gap: 6px 18px; margin: 0 0 16px; }
      .site-nav a {
        font-family: 'IBM Plex Mono', monospace; font-size: 12px; letter-spacing: 0.04em;
        color: inherit; opacity: 0.6; text-decoration: none;
        padding-bottom: 2px; border-bottom: 1px solid transparent;
        transition: opacity 0.15s ease;
      }
      .site-nav a:hover { opacity: 1; }
      .site-nav a:focus-visible { opacity: 1; outline: 2px solid currentColor; outline-offset: 3px; }
      .site-nav a[aria-current="page"] { opacity: 1; border-bottom-color: currentColor; }
      .site-nav .nav-badge {
        display: inline-block; margin-left: 6px; padding: 0 6px; border-radius: 8px;
        background: #D9A441; color: #131315; font-size: 11px; font-weight: 600; line-height: 16px;
      }`;
    document.head.appendChild(style);
  }

  const pages = SITE_PAGES.filter(p => !p.localOnly || navIsLocal());
  if (pages.length < 2) { slot.style.display = 'none'; return; }

  const src = new URLSearchParams(location.search);
  const keep = new URLSearchParams();
  ['team', 'season'].forEach(k => { if (src.get(k)) keep.set(k, src.get(k)); });
  const qs = keep.toString() ? '?' + keep.toString() : '';

  slot.className = 'site-nav';
  slot.setAttribute('aria-label', 'Site pages');
  slot.innerHTML = pages.map(p =>
    `<a data-page="${p.id}" href="${p.href}${qs}"${p.id === currentId ? ' aria-current="page"' : ''}>${p.label}</a>`
  ).join('');
}

function setNavBadge(pageId, count) {
  const a = document.querySelector(`#site-nav a[data-page="${pageId}"]`);
  if (!a) return;
  const old = a.querySelector('.nav-badge');
  if (old) old.remove();
  if (!count) return;
  const b = document.createElement('span');
  b.className = 'nav-badge';
  b.textContent = count;
  b.title = `${count} data check${count === 1 ? '' : 's'} to review`;
  a.appendChild(b);
}