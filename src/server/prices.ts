/**
 * prices.ts - intraday bars from Yahoo Finance.
 *
 * Four vendors were evaluated; each rejection was established by testing, not
 * assumption:
 *
 *   Stooq   answers every request with a JavaScript proof-of-work page instead
 *           of CSV. The Devvit runtime has no browser, so no symbol convention
 *           would have helped.
 *   Google  embeds usable data, but www.google.com is not allowlisted, has had
 *           no public API since 2012, and scraping it breaches Google's terms.
 *   Polygon is free and globally allowlisted, but its free tier runs a full
 *           trading session behind. On a Monday evening the newest session on
 *           offer was still the previous Friday.
 *   Twelve  Data works and serves the current session, but its free tier
 *           allows 800 credits a day. Nine symbols refreshed every five
 *           minutes across a 6.5 hour session is about 700 of them, leaving no
 *           room for a manual trigger or a retry.
 *
 * Yahoo wins on the one constraint that actually binds here: it needs no API
 * key, imposes no daily credit budget, serves the current session, and quotes
 * the real S&P 500 index rather than an ETF standing in for it.
 *
 * The trade-off, stated plainly: this endpoint is not publicly documented and
 * carries no stability guarantee. If Yahoo reshapes it, this file breaks. That
 * risk is affordable because the alternatives are all approved for this app
 * too - swapping vendors means rewriting this one file and nothing else.
 */

import type { SeriesMap } from '../shared/charts';
import { parseSessions } from '../shared/session';
import type { YahooChart } from '../shared/yahoo';
import { toBars, vendorSymbol } from '../shared/yahoo';
import { NAMES } from '../shared/watchlist';

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Five days of five-minute bars: two sessions plus slack for long weekends. */
const RANGE = '5d';
const INTERVAL = '5m';

/** One symbol's recent sessions. Throws on failure. */
async function fetchSeries(symbol: string) {
  const url =
    `${ENDPOINT}/${encodeURIComponent(vendorSymbol(symbol))}` +
    `?range=${RANGE}&interval=${INTERVAL}&includePrePost=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as YahooChart;
  const err = body.chart?.error;
  if (err) throw new Error(err.description ?? 'chart error');

  const parsed = parseSessions(toBars(body.chart?.result));
  if (!parsed) throw new Error('no complete session with a prior close');
  return parsed;
}

/**
 * One chunk of symbols, fetched sequentially.
 *
 * Yahoo takes one symbol per request, so a chunk of three is three calls. They
 * are spaced a little apart: there is no published rate limit, but hammering
 * an unofficial endpoint is how you acquire one.
 *
 * Symbols that fail are reported in `failed` and left with empty points; the
 * renderer draws those as a "no data" panel, so one bad ticker degrades one
 * panel instead of killing the whole post.
 */
export async function fetchChunk(symbols: readonly string[]): Promise<{
  series: SeriesMap;
  failed: string[];
}> {
  const series: SeriesMap = {};
  const failed: string[] = [];

  let first = true;
  for (const symbol of symbols) {
    if (!first) await new Promise((r) => setTimeout(r, 1500));
    first = false;

    const name = NAMES[symbol] ?? symbol;
    try {
      series[symbol] = { name, ...(await fetchSeries(symbol)) };
    } catch (error) {
      failed.push(
        `${symbol}: ${error instanceof Error ? error.message : String(error)}`
      );
      series[symbol] = { name, points: [], session: '', prevClose: 0 };
    }
  }

  return { series, failed };
}
