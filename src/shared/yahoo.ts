/**
 * yahoo.ts - reading Yahoo's chart payload.
 *
 * Pure: no network, no Devvit, no value imports, so it can be exercised
 * directly against real responses. The network call itself lives in
 * server/prices.ts.
 */

import type { Bar } from './session';

export type YahooChart = {
  chart?: {
    error?: { description?: string } | null;
    result?: {
      meta?: {
        previousClose?: number;
        regularMarketPrice?: number;
        chartPreviousClose?: number;
        shortName?: string;
        longName?: string;
      };
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

/**
 * The official figures, when Yahoo supplies them.
 *
 * Both come from the same response we already fetch, so using them costs
 * nothing extra.
 */
export type OfficialQuote = {
  /** Previous session's official closing price. */
  previousClose?: number | undefined;
  /** Latest official regular-session price; the closing print once shut. */
  lastPrice?: number | undefined;
};

const positive = (n: unknown): number | undefined =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? n : undefined;

/**
 * Read the official close and last price out of `meta`.
 *
 * Why this exists: the five-minute bars are a sampling of the session, so the
 * last bar is not the closing auction print and the previous session's last
 * bar is not the official close. Both ends of every percentage were therefore
 * slightly wrong - about 0.04 on a 312 dollar share, which is the ~0.1pp
 * discrepancy against other finance sites disclosed in docs/TERMS.md.
 *
 * NOT `chartPreviousClose`. That is the close before the whole requested
 * range begins - five days back, not yesterday - and it looks entirely
 * plausible until you compare it with anything. `previousClose` is the one.
 */
export function toOfficial(
  result: NonNullable<YahooChart['chart']>['result']
): OfficialQuote {
  const meta = result?.[0]?.meta;
  return {
    previousClose: positive(meta?.previousClose),
    lastPrice: positive(meta?.regularMarketPrice),
  };
}

/**
 * The company name Yahoo knows this symbol by.
 *
 * Needed because readers nominate arbitrary tickers, and a panel labelled
 * "SPCE" says far less than one labelled "Virgin Galactic". `shortName` is
 * preferred: `longName` is the full registered title and is longer still.
 * Callers tidy the legal suffix off - see watchlist.tidyCompanyName.
 */
export function toVendorName(
  result: NonNullable<YahooChart['chart']>['result']
): string | undefined {
  const meta = result?.[0]?.meta;
  const name = meta?.shortName ?? meta?.longName;
  return typeof name === 'string' && name.trim() ? name.trim() : undefined;
}

/**
 * Our ticker to Yahoo's.
 *
 * Yahoo writes share classes with a hyphen: Berkshire's B shares are `BRK-B`,
 * and `BRK.B` returns 404. Confirmed against the live endpoint - precisely the
 * kind of mistake that ships as a silent "no data" panel nobody notices.
 */
export function vendorSymbol(symbol: string): string {
  return symbol.replace(/\./g, '-');
}

/**
 * Pair Yahoo's parallel timestamp and close arrays into bars.
 *
 * Timestamps are UTC seconds; session.ts converts them to New York time.
 */
export function toBars(result: NonNullable<YahooChart['chart']>['result']): Bar[] {
  const first = result?.[0];
  const stamps = first?.timestamp;
  const closes = first?.indicators?.quote?.[0]?.close;
  if (!Array.isArray(stamps) || !Array.isArray(closes)) return [];

  const bars: Bar[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const c = closes[i];
    const t = stamps[i];
    // Yahoo pads its arrays with nulls for bars that never traded. Number(null)
    // is 0, not NaN, so these must be dropped explicitly or they drag the
    // chart to the floor.
    if (typeof t !== 'number' || typeof c !== 'number' || !Number.isFinite(c)) {
      continue;
    }
    bars.push({ t: t * 1000, c });
  }
  return bars;
}
