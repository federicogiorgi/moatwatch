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
import { applyOfficial, parseSessions } from '../shared/session';
import type { YahooChart } from '../shared/yahoo';
import { toBars, toOfficial, vendorSymbol } from '../shared/yahoo';
import { NAMES, ORDER } from '../shared/watchlist';

const ENDPOINT = 'https://query1.finance.yahoo.com/v8/finance/chart';

/** Five days of five-minute bars: two sessions plus slack for long weekends. */
const RANGE = '5d';
const INTERVAL = '5m';

/** Gap between symbols. No published limit; this is politeness, not a rule. */
const SPACING_MS = 1200;

/** Pause before a single retry of an empty payload. */
const RETRY_MS = 800;

/**
 * Stop retrying past this point so the handler cannot run out of time.
 * Devvit allows 30 seconds; nine symbols at the spacing above take about 14.
 */
const RETRY_DEADLINE_MS = 22_000;

/** One symbol's recent sessions, with official figures applied. Throws. */
async function fetchSeries(symbol: string) {
  const url =
    `${ENDPOINT}/${encodeURIComponent(vendorSymbol(symbol))}` +
    `?range=${RANGE}&interval=${INTERVAL}&includePrePost=false`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);

  const body = (await res.json()) as YahooChart;
  const err = body.chart?.error;
  if (err) throw new Error(err.description ?? 'chart error');

  const result = body.chart?.result;
  const parsed = parseSessions(toBars(result));
  if (!parsed) throw new Error('no complete session with a prior close');

  // Swap the sampled endpoints for the vendor's official ones. Costs no extra
  // request - the figures ride along in the same response.
  return applyOfficial(parsed, toOfficial(result));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Does the vendor actually serve this symbol?
 *
 * Readers nominate tickers by typing them, so the board can contain anything
 * that looks like a ticker. A symbol that does not exist must never reach a
 * panel - it would render as an empty "no data" box, which is exactly the
 * failure the whole feature is supposed to avoid.
 *
 * Deliberately strict: it is not enough for Yahoo to answer, it has to return
 * a session we can actually plot. `$ZZZZ` returns a polite empty result, which
 * would otherwise sail through an HTTP-status check.
 */
export async function isTradable(symbol: string): Promise<boolean> {
  try {
    await fetchSeries(symbol);
    return true;
  } catch {
    return false;
  }
}

/**
 * Check several nominated symbols, spaced like any other vendor traffic.
 *
 * Capped: a brigade of nonsense tickers must not turn one pass into a hundred
 * requests. Anything past the cap is simply not validated this pass, so it
 * stays off the board until a later pass has room for it.
 */
export async function validateSymbols(
  symbols: readonly string[],
  cap = 6
): Promise<Record<string, boolean>> {
  const out: Record<string, boolean> = {};
  let first = true;
  for (const symbol of symbols.slice(0, cap)) {
    if (!first) await sleep(SPACING_MS);
    first = false;
    out[symbol] = await isTradable(symbol);
  }
  return out;
}

/**
 * The whole watchlist, fetched sequentially in one pass.
 *
 * This used to be split into three chunks across three scheduled passes,
 * because Polygon's free tier allowed five calls a minute and nine symbols
 * could not fit inside one. Yahoo has no such cap, and the split had costs of
 * its own: it needed an accumulator in Redis, it left a three-minute window in
 * which the grid was half-built, and a deploy landing mid-cycle merged symbols
 * from two different watchlists into one incoherent post. Measured at nine
 * sequential fetches in about 14 seconds against Devvit's 30 second budget,
 * so one pass now does the lot and the accumulator is gone.
 *
 * Symbols are still spaced apart. There is no published rate limit, but
 * hammering an unofficial endpoint is how you acquire one.
 *
 * Retry: Yahoo intermittently answers HTTP 200 with a `meta` block and no bar
 * arrays at all. Observed hitting every symbol in one burst and clearing
 * moments later, so it is a transient rather than a throttle. Without a retry
 * that transient blanks panels for a full five minutes, so each failure gets
 * one more attempt - subject to a deadline, because a run of failures must
 * never push the handler past its limit.
 *
 * Symbols that still fail are reported in `failed` and left with empty points;
 * the renderer draws those as a "no data" panel, so one bad ticker degrades
 * one panel instead of killing the whole post.
 */
export async function fetchAll(
  symbols: readonly string[] = ORDER
): Promise<{ series: SeriesMap; failed: string[] }> {
  const series: SeriesMap = {};
  const failed: string[] = [];
  const startedAt = Date.now();

  let first = true;
  for (const symbol of symbols) {
    if (!first) await sleep(SPACING_MS);
    first = false;

    const name = NAMES[symbol] ?? symbol;
    try {
      series[symbol] = { name, ...(await fetchSeries(symbol)) };
    } catch (error) {
      const first_ = error instanceof Error ? error.message : String(error);

      if (Date.now() - startedAt > RETRY_DEADLINE_MS) {
        failed.push(`${symbol}: ${first_} (no time to retry)`);
        series[symbol] = { name, points: [], session: '', prevClose: 0 };
        continue;
      }

      await sleep(RETRY_MS);
      try {
        series[symbol] = { name, ...(await fetchSeries(symbol)) };
        console.log(`${symbol} recovered on retry after: ${first_}`);
      } catch (retryError) {
        const second = retryError instanceof Error ? retryError.message : String(retryError);
        failed.push(`${symbol}: ${first_} / retry: ${second}`);
        series[symbol] = { name, points: [], session: '', prevClose: 0 };
      }
    }
  }

  return { series, failed };
}
