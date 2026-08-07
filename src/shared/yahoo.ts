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
      timestamp?: number[];
      indicators?: { quote?: { close?: (number | null)[] }[] };
    }[];
  };
};

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
