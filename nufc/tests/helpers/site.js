/**
 * helpers/site.js — loads the site's plain browser scripts (js/*.js) into an isolated Node `vm` context so
 * the tests can call their functions without a browser and without changing how the site is written.
 *
 *   const site = loadSite({ search: '?season=2025-26', hostname: 'example.com', fetch: fakeFetch });
 *   site.computeStatsForSquad(...)        // any top-level function in the loaded files
 *   site.run('AGE_AS_OF = new Date(2024, 5, 30)')   // run code inside the context (needed for let/const globals)
 *
 * Only the scripts a page needs for the thing under test are loaded; by default teams, data, stats.
 * transfers.js ends by starting itself (initTransfers()), so that last call is stripped when it is loaded here.
 */
const vm = require('vm');
const fs = require('fs');
const path = require('path');

const JS_DIR = path.join(__dirname, '..', '..', 'js');

function makeStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(k, String(v)); },
    removeItem: k => { m.delete(k); },
    _map: m,
  };
}

function loadSite(opts = {}) {
  const files = opts.files || ['teams', 'data', 'stats'];
  const sessionStorage = opts.sessionStorage || makeStorage();
  const quiet = { log() {}, warn() {}, error() {} };
  const ctx = vm.createContext({
    console: opts.console || quiet,
    location: { search: opts.search || '', hostname: opts.hostname || 'localhost', protocol: opts.protocol || 'http:' },
    document: {
      documentElement: { classList: { add() {} } },
      getElementById: () => null,
      querySelector: () => null,
    },
    sessionStorage,
    fetch: opts.fetch || (async () => { throw new Error('no fetch in this test'); }),
    URLSearchParams,
  });
  files.forEach(f => {
    let src = fs.readFileSync(path.join(JS_DIR, f + '.js'), 'utf8');
    if (f === 'transfers') src = src.replace(/\r?\ninitTransfers\(\);\s*$/, '\n');
    new vm.Script(src, { filename: f + '.js' }).runInContext(ctx);
  });
  const run = code => vm.runInContext(code, ctx);
  // Expose every top-level function (and a few well-known consts) as properties.
  const api = { run, sessionStorage, ctx };
  const names = new Set();
  files.forEach(f => {
    const src = fs.readFileSync(path.join(JS_DIR, f + '.js'), 'utf8');
    for (const m of src.matchAll(/^(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm)) names.add(m[1]);
  });
  names.forEach(n => { api[n] = (...a) => run(n)(...a); });
  return api;
}

/** A fake fetch(): `routes` maps a URL to the JSON to return (or an Error / null for a 404). Counts calls per URL. */
function fakeFetch(routes) {
  const calls = {};
  const f = async url => {
    calls[url] = (calls[url] || 0) + 1;
    const body = routes[url];
    if (body === undefined || body === null || body instanceof Error) return { ok: false, status: 404, text: async () => '', json: async () => { throw new Error('404'); } };
    const text = typeof body === 'string' ? body : JSON.stringify(body);
    return { ok: true, status: 200, text: async () => text, json: async () => JSON.parse(text) };
  };
  f.calls = calls;
  return f;
}

module.exports = { loadSite, fakeFetch, makeStorage };
