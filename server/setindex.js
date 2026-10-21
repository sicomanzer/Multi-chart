/**
 * Index constituents, straight from the exchange.
 *
 * `set.or.th` is a single-page app: the HTML carries the index level but the
 * member table arrives from a JSON endpoint,
 * `/api/set/index/set100/composition`. That endpoint sits behind Akamai bot
 * protection — a bare request gets a 403 — but it answers normally once the
 * cookies from the page itself are attached, which is exactly what a browser
 * does and what this module does in two requests.
 *
 * It is a fallback-friendly design on purpose. The list changes twice a year
 * (SET reviews the index in June and December), so a stale copy is a small
 * problem, while a screen that cannot start because the exchange is slow is a
 * large one. Every caller passes the written list it already has; this module
 * only replaces it when a refresh has actually succeeded, and every failure is
 * silent except for one line in the log.
 */

/** Where the member table lives, and the page that hands out the cookies. */
const PAGE = 'https://www.set.or.th/th/market/index/set100/overview';
const endpoint = (id) => `https://www.set.or.th/api/set/index/${id}/composition?lang=en`;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/** A refresh costs two requests to a site we do not own; twice a day is plenty. */
const TTL_MS = 12 * 60 * 60 * 1000;

/** Long enough for a slow exchange, short enough not to hang a request. */
const TIMEOUT_MS = 8_000;

const cache = new Map();
const inflight = new Map();

/**
 * Pull the symbol list out of the composition payload.
 *
 * Kept separate from the network so it can be tested: the shape is
 * `{ composition: { stockInfos: [{ symbol, securityType, … }] } }`, and a
 * truncated or error payload must not be mistaken for a one-member index.
 */
export function parseComposition(payload) {
  const infos = payload?.composition?.stockInfos;
  if (!Array.isArray(infos)) throw new Error('unexpected composition payload');
  const symbols = infos
    .map((info) => String(info?.symbol ?? '').trim().toUpperCase())
    .filter((symbol) => /^[A-Z0-9-]{1,12}$/.test(symbol));
  const unique = [...new Set(symbols)];
  if (unique.length < 20) throw new Error(`only ${unique.length} constituents returned`);
  return unique;
}

async function get(url, headers) {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res;
}

/** The API needs the cookies the page sets; the page itself is not parsed. */
async function fetchConstituents(id) {
  const page = await get(PAGE, {
    'User-Agent': USER_AGENT,
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'upgrade-insecure-requests': '1',
  });
  const cookie = (page.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
  const res = await get(endpoint(id), {
    'User-Agent': USER_AGENT,
    Accept: 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,th;q=0.8',
    Referer: PAGE,
    ...(cookie ? { Cookie: cookie } : {}),
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
  });
  return parseComposition(await res.json());
}

/**
 * Refresh in the background, once per id at a time.
 *
 * Callers never await this: a stale list is better than a stalled dialog, so
 * the request that notices the cache is old gets the previous list and the
 * next one gets the new.
 */
export function refresh(id) {
  if (inflight.has(id)) return inflight.get(id);
  const task = fetchConstituents(id)
    .then((symbols) => {
      cache.set(id, { symbols, at: Date.now() });
      console.log(`[setindex] ${id}: ${symbols.length} constituents from set.or.th`);
      return symbols;
    })
    .catch((err) => {
      // One line, not a stack: an unreachable exchange is expected, and the
      // written list keeps the screen working.
      console.warn(`[setindex] ${id}: keeping the written list (${err.message})`);
      return null;
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, task);
  return task;
}

/** The freshest list available, falling back to the caller's written copy. */
export function constituents(id, fallback) {
  const hit = cache.get(id);
  if (!hit || Date.now() - hit.at > TTL_MS) void refresh(id);
  return hit?.symbols ?? fallback;
}

/** Test seam: drop the cache without waiting out the TTL. */
export function clearConstituentCache() {
  cache.clear();
}
