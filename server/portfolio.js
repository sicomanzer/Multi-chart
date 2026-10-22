/**
 * What the reader would have made, and how.
 *
 * The back test says how much a rule earned in the abstract. A reader wants a
 * number with money in it: five million baht, the five names the screen
 * picked, and the three ways a person would actually have put the money in —
 * all at once, a slice every month, or only when the price came down to
 * something worth paying.
 *
 * The rules of the game:
 *
 *   1. The money goes in at a close and comes out at a close. No price is
 *      known before it happened, and the dates are the same ones the back test
 *      uses, so the two answers can be read against each other.
 *   2. The dividends are the reader's money too. A dividend screen judged on
 *      the price alone would be judged on the wrong thing — the whole point
 *      of the income mandate is the cash that arrives twice a year — so they
 *      are counted, and counted for the benchmark in the same way.
 *   3. Cash that has not been deployed earns nothing. The report says so, and
 *      the strategies are read against that: a strategy that waits has money
 *      sitting still, and that is a real cost, not a detail.
 *   4. The slice is the same for every name and every month, so what the
 *      numbers measure is the picking and the timing, not the weighting.
 */
import { sustainableDividend, ddm, marginOfSafety, DEFAULTS } from './screener.js';

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** The close on the last trading day at or before a date. */
export function closeAt(closes, date) {
  let best = null;
  for (const c of closes ?? []) {
    if (c.date <= date) best = c;
    else break;
  }
  return best;
}

/**
 * The first trading day of each month inside a window.
 *
 * A monthly plan is paid on a day, and the day a month starts is the one a
 * reader would use: the first trading day of it.
 */
export function monthStarts(closes, from, to) {
  const out = [];
  let lastMonth = null;
  for (const c of closes ?? []) {
    if (c.date < from) continue;
    if (c.date > to) break;
    const month = c.date.slice(0, 7);
    if (month !== lastMonth) {
      lastMonth = month;
      out.push(c);
    }
  }
  return out;
}

/** The dividends per share paid between two dates, the later one included. */
export function dividendsBetween(dividends, from, to) {
  let sum = 0;
  for (const d of dividends ?? []) {
    if (d.date > from && d.date <= to) sum += d.amount;
  }
  return sum;
}

/**
 * Buy and hold: everything in, on the first day, split evenly.
 */
function runLump({ picks, closesBySymbol, dividendsBySymbol, from, to, capital }) {
  const perName = capital / picks.length;
  let cash = capital;
  let deployed = 0;
  let dividends = 0;
  const shares = new Map();
  for (const pick of picks) {
    const bar = closeAt(closesBySymbol[pick.symbol] ?? [], from);
    if (!bar || !(bar.close > 0)) continue;
    shares.set(pick.symbol, (shares.get(pick.symbol) ?? 0) + perName / bar.close);
    cash -= perName;
    deployed += perName;
  }
  // The dividends that arrived while the money was at work.
  for (const pick of picks) {
    const units = shares.get(pick.symbol) ?? 0;
    if (!units) continue;
    dividends += dividendsBetween(dividendsBySymbol[pick.symbol] ?? [], from, to) * units;
  }
  return { shares, cash, dividends, deployed };
}

/**
 * A slice every month, whether the price is what it was or not.
 *
 * The slice is per name: twenty-five thousand a month into each of the five,
 * so a hundred and twenty-five thousand a month and the whole five million
 * goes to work in forty months. That is what makes the three strategies
 * comparable — the same money, the same names, deployed differently.
 */
function runMonthly({
  picks, closesBySymbol, dividendsBySymbol, from, to, capital, monthly,
}) {
  let cash = capital;
  let deployed = 0;
  let dividends = 0;
  const shares = new Map();
  const days = monthStarts(closesBySymbol[picks[0]?.symbol] ?? [], from, to);
  let lastDate = from;
  for (const day of days) {
    // The dividends that arrived since the last purchase date, on the units
    // held at the time.
    for (const pick of picks) {
      const units = shares.get(pick.symbol) ?? 0;
      if (!units) continue;
      dividends += dividendsBetween(dividendsBySymbol[pick.symbol] ?? [], lastDate, day.date) * units;
    }
    lastDate = day.date;
    for (const pick of picks) {
      if (cash <= 0) break;
      const bar = closeAt(closesBySymbol[pick.symbol] ?? [], day.date);
      if (!bar || !(bar.close > 0)) continue;
      const amount = Math.min(monthly, cash);
      shares.set(pick.symbol, (shares.get(pick.symbol) ?? 0) + amount / bar.close);
      cash -= amount;
      deployed += amount;
    }
  }
  // And the ones after the last purchase date.
  for (const pick of picks) {
    const units = shares.get(pick.symbol) ?? 0;
    if (!units) continue;
    dividends += dividendsBetween(dividendsBySymbol[pick.symbol] ?? [], lastDate, to) * units;
  }
  return { shares, cash, dividends, deployed };
}

/**
 * A slice every month, but only when the price is at or below the level the
 * framework called right.
 *
 * The level is the dividend discount model's value of the company on the day
 * the screen was run — what the reader would have written down as "worth
 * paying up to". A name the model cannot value (no dividend to discount) falls
 * back to the price the screen saw, which is the same idea in a weaker form:
 * cheaper than when I found it.
 */
function runWait({
  picks, closesBySymbol, dividendsBySymbol, from, to, capital, monthly, thresholds,
}) {
  let cash = capital;
  let deployed = 0;
  let dividends = 0;
  const shares = new Map();
  const days = monthStarts(closesBySymbol[picks[0]?.symbol] ?? [], from, to);
  let lastDate = from;
  for (const day of days) {
    for (const pick of picks) {
      const units = shares.get(pick.symbol) ?? 0;
      if (!units) continue;
      dividends += dividendsBetween(dividendsBySymbol[pick.symbol] ?? [], lastDate, day.date) * units;
    }
    lastDate = day.date;
    for (const pick of picks) {
      if (cash <= 0) break;
      const bar = closeAt(closesBySymbol[pick.symbol] ?? [], day.date);
      if (!bar || !(bar.close > 0)) continue;
      const level = thresholds?.[pick.symbol];
      if (level == null || !(bar.close <= level)) continue;
      const amount = Math.min(monthly, cash);
      shares.set(pick.symbol, (shares.get(pick.symbol) ?? 0) + amount / bar.close);
      cash -= amount;
      deployed += amount;
    }
  }
  for (const pick of picks) {
    const units = shares.get(pick.symbol) ?? 0;
    if (!units) continue;
    dividends += dividendsBetween(dividendsBySymbol[pick.symbol] ?? [], lastDate, to) * units;
  }
  return { shares, cash, dividends, deployed };
}

/** What the holdings are worth at the end, plus whatever was never spent. */
function valueAt(shares, cash, dividends, closesBySymbol, to) {
  let value = cash + dividends;
  for (const [symbol, units] of shares) {
    const bar = closeAt(closesBySymbol[symbol] ?? [], to);
    if (bar && bar.close > 0) value += units * bar.close;
  }
  return value;
}

/**
 * One period, three strategies.
 *
 * `picks` are the names in the order the screen ranked them, with the value
 * the framework put on each one on that day.
 */
export function simulatePeriod({
  picks, closesBySymbol, dividendsBySymbol = {}, from, to, capital, monthly, thresholds = null,
}) {
  const common = {
    picks, closesBySymbol, dividendsBySymbol, from, to, capital, monthly, thresholds,
  };
  const lump = runLump(common);
  const dca = runMonthly(common);
  const wait = runWait(common);

  const wrap = (result) => {
    const value = valueAt(result.shares, result.cash, result.dividends, closesBySymbol, to);
    return {
      value,
      cash: result.cash,
      dividends: result.dividends,
      deployed: result.deployed,
      return: capital > 0 ? value / capital - 1 : null,
    };
  };

  return {
    lump: wrap(lump),
    dca: wrap(dca),
    wait: wrap(wait),
  };
}

/**
 * The value the framework put on a company on a given day.
 *
 * Exposed for anyone who wants to know what the "right price" was at the
 * time, rather than what it is today.
 */
export function intrinsicAt({ years, price, asOf }) {
  if (!years?.length) return null;
  const dividend = sustainableDividend({ years, dividends: [], asOf });
  const valuation = ddm({ d0: dividend.d0, ...DEFAULTS });
  if (!valuation.ok) return null;
  return {
    intrinsic: valuation.intrinsic,
    mos: marginOfSafety(valuation.intrinsic, price),
  };
}
