/** Number/price formatting shared by the tiles and the UI chrome. */

export function formatPrice(value, precision = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return n.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision,
  });
}

/** Compact form for indicator legends (1.23K / 4.5M). */
export function formatCompact(value) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const abs = Math.abs(n);
  if (abs >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(n / 1e3).toFixed(2)}K`;
  if (abs >= 100) return n.toFixed(2);
  if (abs >= 1) return n.toFixed(3);
  return n.toFixed(4);
}

export function formatSigned(value, digits = 2) {
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  return `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`;
}

/** Infer display precision from a price level (SET trades at 2.94, not 2.00). */
export function inferPrecision(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return 2;
  const abs = Math.abs(n);
  if (abs >= 1000) return 0;
  if (abs >= 1) return 2;
  if (abs >= 0.1) return 3;
  return 4;
}

/**
 * Format one fundamental metric for the tile footer.
 *
 * `kind` comes from the server so the client never has to know whether a
 * number is a ratio, a percentage or an amount:
 *   ratio   -> 2 decimals, with "x" for the ones that read like multiples
 *   percent -> already a percentage from the screener, so just append %
 *   money   -> compact with the currency kept out of the way
 *   number  -> plain 2 decimals
 */
export function formatMetric(entry, { compact = false } = {}) {
  const value = entry?.value;
  if (value == null || !Number.isFinite(Number(value))) return '—';
  const n = Number(value);
  const kind = entry?.kind ?? 'number';

  switch (kind) {
    case 'percent':
      // Screener yields arrive as percentages already (5.06 == 5.06%).
      return `${n.toFixed(2)}%`;
    case 'money':
      return formatCompact(n);
    case 'ratio':
      if (compact && Math.abs(n) >= 100) return n.toFixed(0);
      return n.toFixed(2);
    default:
      return n.toFixed(2);
  }
}

/** Colour a ratio the way a terminal would: cheap vs expensive. */
export function metricTone(entry, { highIsGood = true } = {}) {
  const value = entry?.value;
  if (value == null || !Number.isFinite(Number(value))) return '';
  if (entry?.kind === 'percent') return Number(value) > 0 ? 'is-up' : 'is-down';
  return '';
}