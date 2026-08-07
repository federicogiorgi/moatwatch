/**
 * The watchlist, as Twelve Data symbols.
 *
 * Every symbol here was confirmed against Twelve Data's reference endpoints
 * before being trusted (https://api.twelvedata.com/stocks?symbol=..., and
 * /etf for SPY). Do not add a symbol without checking it the same way.
 *
 * On the index panel: Twelve Data's free tier does not serve the S&P 500
 * index itself - SPX, GSPC and US500 all come back empty - so the large
 * panel tracks SPY, the SPDR S&P 500 ETF, instead. It follows the index to
 * within a fraction of a percent. The label says so rather than implying we
 * have the index.
 */

export type Instrument = { symbol: string; name: string };

/**
 * The real index, at last.
 *
 * This tracked SPY - the ETF - for as long as the data vendor's free tier
 * refused to serve index data. Yahoo quotes ^GSPC itself, so the panel no
 * longer needs a proxy or the apologetic "(SPY)" in its label.
 */
export const INDEX: Instrument = { symbol: '^GSPC', name: 'S&P 500' };

export const STOCKS: readonly Instrument[] = [
  { symbol: 'GOOGL', name: 'Alphabet' },
  { symbol: 'AAPL', name: 'Apple' },
  { symbol: 'KO', name: 'Coca-Cola' },
  { symbol: 'BRK.B', name: 'Berkshire Hathaway' },
  { symbol: 'CVX', name: 'Chevron' },
  { symbol: 'SYM', name: 'Symbotic' },
  { symbol: 'PG', name: 'Procter & Gamble' },
  { symbol: 'SPCX', name: "Space-X" },
];

/** Index first, then the eight small panels in display order. */
export const ORDER: readonly string[] = [
  INDEX.symbol,
  ...STOCKS.map((s) => s.symbol),
];

export const NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  [INDEX, ...STOCKS].map((s) => [s.symbol, s.name])
);

/**
 * The watchlist is fetched in three chunks, minutes apart.
 *
 * Polygon's free tier allows 5 API calls per minute and has no multi-symbol
 * aggregates endpoint, so nine symbols cannot be fetched inside one minute.
 * Devvit's 30 second HTTP handler limit rules out waiting the window out
 * in-process, so the split is across scheduled passes instead.
 *
 * Three chunks of three, not two of five and four. Five sits exactly at the
 * per-minute cap with no headroom, and in practice that failed: a burst of
 * five got `HTTP 429` from Polygon on the first symbol and then
 * `not allowed due to too many requests` from Devvit's own fetch limiter on
 * the remaining four. Three leaves room for an overlapping retry or a stray
 * manual trigger without any request being refused.
 */
export const CHUNKS: readonly (readonly string[])[] = [
  ORDER.slice(0, 3),
  ORDER.slice(3, 6),
  ORDER.slice(6),
];

/** Index of the pass that merges everything and publishes. */
export const FINAL_PASS = CHUNKS.length - 1;
