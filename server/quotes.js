/**
 * Yahoo's quote snapshot, in the currency the share price trades in.
 *
 * The fundamentals-timeseries endpoint reports statements in the company's
 * reporting currency, which is not always the trading currency: BANPU files in
 * US dollars while its shares trade in baht. Dividing a baht price by a dollar
 * EPS does not produce a P/E, it produces a P/E divided by 33 — and the same
 * mistake runs through P/BV, the dividend yield and the dividend model.
 *
 * The quote endpoint already publishes trailing EPS and book value converted to
 * the trading currency, so it is the authority for "what a buyer pays today".
 * The statement history stays in its own currency; it is converted with the
 * ratio between the two EPS figures, which is the rate that makes the per-share
 * numbers agree.
 *
 * Yahoo rejects anonymous quote requests with a 401, so a crumb is required.
 * The cookie and token are fetched once, kept for an hour and refreshed on the
 * first 401. Every call is best-effort: a missing quote must degrade the
 * multiples, never fail the screen.
 */

const QUOTE = 'https://query1.finance.yahoo.com/v7/finance/quote';
const SUMMARY = 'https://query1.finance.yahoo.com/v10/finance/quoteSummary';
const CRUMB = 'https://query1.finance.yahoo.com/v1/test/getcrumb';
const COOKIE_SEED = 'https://fc.yahoo.com';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

const SESSION_TTL_MS = 60 * 60 * 1000;
const QUOTE_TTL_MS = 10 * 60 * 1000;
const PROFILE_TTL_MS = 12 * 60 * 60 * 1000;
const TIMEOUT_MS = 15_000;
const CHUNK = 50;

let session = null;
let sessionPending = null;

const quotes = new Map();
const profiles = new Map();

async function get(url, { cookie, json = true } = {}) {
  const res = await fetch(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Accept: json ? 'application/json' : '*/*',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401) {
    const err = new Error('crumb expired');
    err.code = 'CRUMB';
    throw err;
  }
  if (!res.ok) throw new Error(`${res.status} from ${url}`);
  return res;
}

/** The cookie/token pair Yahoo demands before it will answer a quote call. */
async function getSession(force = false) {
  if (!force && session && Date.now() - session.at < SESSION_TTL_MS) return session;
  if (sessionPending) return sessionPending;
  sessionPending = (async () => {
    // fc.yahoo.com answers 404 but sets the cookies, which is all it is for.
    const seed = await fetch(COOKIE_SEED, {
      headers: { 'User-Agent': USER_AGENT },
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    }).catch(() => null);
    const cookie = (seed?.headers.getSetCookie?.() ?? []).map((c) => c.split(';')[0]).join('; ');
    const res = await get(CRUMB, { cookie, json: false });
    const crumb = (await res.text()).trim();
    if (!crumb || crumb.length > 40) throw new Error('no crumb from Yahoo');
    session = { cookie, crumb, at: Date.now() };
    return session;
  })().finally(() => {
    sessionPending = null;
  });
  return sessionPending;
}

async function request(urlFor, { force = false } = {}) {
  let s = await getSession(force);
  try {
    return await get(urlFor(s), { cookie: s.cookie });
  } catch (err) {
    if (err.code !== 'CRUMB') throw err;
    s = await getSession(true);
    return get(urlFor(s), { cookie: s.cookie });
  }
}

function chunk(list, size) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * One quote per Yahoo symbol, keyed by that symbol.
 *
 * Fields are copied into a flat shape so callers never depend on Yahoo's
 * nested naming, and anything absent stays absent rather than becoming zero.
 */
export async function quoteBatch(yahooSymbols) {
  const now = Date.now();
  const wanted = [...new Set(yahooSymbols.filter(Boolean))];
  const fresh = new Map();
  const missing = [];
  for (const sym of wanted) {
    const hit = quotes.get(sym);
    if (hit && now - hit.at < QUOTE_TTL_MS) fresh.set(sym, hit.value);
    else missing.push(sym);
  }

  for (const part of chunk(missing, CHUNK)) {
    try {
      const res = await request((s) =>
        `${QUOTE}?symbols=${part.map(encodeURIComponent).join(',')}&crumb=${encodeURIComponent(s.crumb)}`);
      const payload = await res.json();
      for (const q of payload?.quoteResponse?.result ?? []) {
        if (!q?.symbol) continue;
        const value = {
          currency: q.currency ?? null,
          price: q.regularMarketPrice ?? null,
          epsTtm: q.epsTrailingTwelveMonths ?? null,
          bookValue: q.bookValue ?? null,
          priceToBook: q.priceToBook ?? null,
          trailingPe: q.trailingPE ?? null,
          dividendYield: q.dividendYield ?? null,
          shares: q.sharesOutstanding ?? null,
          marketCap: q.marketCap ?? null,
        };
        quotes.set(q.symbol, { value, at: now });
        fresh.set(q.symbol, value);
      }
    } catch (err) {
      console.warn(`[quotes] ${part.length} symbols skipped (${err.message})`);
    }
  }
  return fresh;
}

/**
 * Sector, industry and reporting currency.
 *
 * Two decisions need a fact the statements do not carry: whether a name is a
 * financial (no meaningful EBIT, cash flow or leverage) and whether its
 * statements are filed in the currency its shares trade in. Yahoo labels both.
 */
export async function profile(yahooSymbol) {
  const hit = profiles.get(yahooSymbol);
  if (hit && Date.now() - hit.at < PROFILE_TTL_MS) return hit.value;
  try {
    const res = await request((s) =>
      `${SUMMARY}/${encodeURIComponent(yahooSymbol)}?modules=assetProfile,financialData&crumb=${encodeURIComponent(s.crumb)}`);
    const payload = await res.json();
    const result = payload?.quoteSummary?.result?.[0];
    const p = result?.assetProfile;
    const value = {
      sector: p?.sector ?? null,
      industry: p?.industry ?? null,
      financialCurrency: result?.financialData?.financialCurrency ?? null,
    };
    profiles.set(yahooSymbol, { value, at: Date.now() });
    return value;
  } catch (err) {
    console.warn(`[quotes] profile ${yahooSymbol} unavailable (${err.message})`);
    return null;
  }
}

export function clearQuoteCache() {
  quotes.clear();
  profiles.clear();
}
