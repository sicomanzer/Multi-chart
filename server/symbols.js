/**
 * Symbol helpers shared by the API layer.
 *
 * Two naming conventions collide in this project:
 *   - TradingView / MCP style  `SET:CPF`, `NASDAQ:AAPL`, `BINANCE:BTCUSDT`
 *   - Yahoo Finance style      `CPF.BK`, `AAPL`, `BTC-USD`
 *
 * The MCP screener only accepts the first form; the Yahoo chart endpoint (the
 * one the MCP itself uses for quotes) only accepts the second. Everything the
 * user types is normalised into a TradingView symbol, then converted.
 */

/** Exchange -> Yahoo suffix. Anything absent uses the bare symbol. */
const YAHOO_SUFFIX = {
  SET: '.BK',
  BIST: '.IS',
  EGX: '.CA',
  TADAWUL: '.SR',
  SAU: '.SR',
  BAHRAIN: '.BH',
  KUWAIT: '.KW',
  QATAR: '.QA',
  DUBAI: '.DU',
  AMEX: '',
  NASDAQ: '',
  NYSE: '',
  NYSEARCA: '',
  OTC: '',
  TSX: '.TO',
  TSXV: '.V',
  ASX: '.AX',
  NZX: '.NZ',
  HKEX: '.HK',
  SSE: '.SS',
  SZSE: '.SZ',
  TWSE: '.TW',
  TPEX: '.TWO',
  KRX: '',
  KOSPI: '',
  IDX: '.JK',
  KLC: '.KL',
  NSE: '.NS',
  BSE: '.BO',
  LSE: '.L',
  XETR: '.DE',
  EURONEXT: '.PA',
  BVME: '.MC',
  BMV: '.MX',
  BVMF: '.SA',
  JPX: '.T',
  CRYPTO: '-USD',
};

/** Crypto venues map onto Yahoo's `BASE-QUOTE` pairs, not suffixed symbols. */
const CRYPTO_VENUES = new Set([
  'BINANCE', 'KUCOIN', 'BYBIT', 'MEXC', 'BITGET', 'OKX', 'COINBASE',
  'GATEIO', 'HUOBI', 'BITFINEX', 'KUCOINSPOT', 'FTX', 'DYDX',
]);

const SET_PRICE_SUFFIX = '.BK';

export const DEFAULT_EXCHANGES = [
  'SET', 'NASDAQ', 'NYSE', 'AMEX', 'BIST', 'EGX', 'HKEX', 'TWSE', 'KRX',
  'LSE', 'XETR', 'ASX', 'TSX', 'KLC', 'SGX', 'NSE', 'BINANCE', 'KUCOIN',
  'BYBIT', 'MEXC', 'BITGET', 'OKX',
];

const INDEX_ALIASES = {
  SET: ['^SET.BK', '^SET.BK.I', 'SETI'],
  NASDAQ: ['^IXIC', '^NDX', '^GSPC'],
  NYSE: ['^DJI', '^GSPC'],
  AMEX: ['^GSPC', 'SPY'],
};

/**
 * Turn anything the user typed into a canonical `EXCHANGE:SYMBOL`.
 * Accepts `CPF`, `SET:CPF`, `CPF.BK`, `cpf.bk`, `^SET.BK`.
 */
export function normalizeSymbol(input, fallbackExchange = 'SET') {
  let s = String(input || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!s) return null;

  // Yahoo index form -> TradingView form (only the handful we care about).
  const indexHit = Object.entries(INDEX_ALIASES).find(([, aliases]) => aliases.includes(s));
  if (indexHit) return `${indexHit[0]}:${s.replace(/^\^/, '').replace(/\.BK\..*$/, '')}`;

  if (s.includes(':')) return s;

  // Strip a Yahoo market suffix and recover the exchange from it.
  if (s.endsWith(SET_PRICE_SUFFIX)) return `SET:${s.slice(0, -SET_PRICE_SUFFIX.length)}`;
  for (const [ex, suffix] of Object.entries(YAHOO_SUFFIX)) {
    if (suffix && suffix !== '.BK' && s.endsWith(suffix)) {
      return `${ex}:${s.slice(0, -suffix.length)}`;
    }
  }
  if (s.startsWith('^')) return `${fallbackExchange}:${s.slice(1)}`;

  return `${fallbackExchange}:${s}`;
}

/** `SET:CPF` -> `CPF.BK`. Returns null when the symbol cannot be mapped. */
export function toYahooSymbol(tvSymbol) {
  const norm = normalizeSymbol(tvSymbol);
  if (!norm) return null;
  const [exchange, symbol] = norm.split(':');
  if (!symbol) return null;

  if (CRYPTO_VENUES.has(exchange)) {
    const base = symbol.replace(/USDT$|USDC$|BUSD$/, '');
    return `${base}-USD`;
  }

  // Unknown venue: try the bare ticker rather than inventing a suffix, so a
  // typo surfaces as "symbol not found" instead of a mangled query.
  if (!(exchange in YAHOO_SUFFIX)) return symbol;

  const suffix = YAHOO_SUFFIX[exchange];
  return suffix ? `${symbol}${suffix}` : symbol;
}

/** The bare ticker without its exchange prefix, for display. */
export function bareSymbol(tvSymbol) {
  const norm = normalizeSymbol(tvSymbol);
  return norm ? norm.split(':')[1] : String(tvSymbol || '');
}

export function exchangeOf(tvSymbol) {
  const norm = normalizeSymbol(tvSymbol);
  return norm ? norm.split(':')[0] : '';
}

/** Dedupe while preserving order, used for batch quote requests. */
export function uniqueSymbols(list) {
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    const norm = normalizeSymbol(raw);
    if (!norm || seen.has(norm)) continue;
    seen.add(norm);
    out.push(norm);
  }
  return out;
}