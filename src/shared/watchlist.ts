/**
 * The watchlist.
 *
 * Every symbol here was confirmed against live Yahoo before being trusted:
 * fetch it through vendorSymbol/toBars/parseSessions and check that a real
 * session comes back. Do not add a symbol without checking it the same way -
 * a wrong ticker ships as a silent "no data" panel that nobody notices.
 *
 * The eight small panels are ordered alphabetically by display name, which is
 * the order they are read in on the post. The index is not part of that
 * ordering; it is the large panel and always leads.
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
  { symbol: 'BRK.B', name: 'Berkshire Hathaway' },
  { symbol: 'CVX', name: 'Chevron' },
  { symbol: 'KO', name: 'Coca-Cola' },
  { symbol: 'MCD', name: "McDonald's" },
  { symbol: 'PG', name: 'Procter & Gamble' },
  { symbol: 'SPCX', name: 'Space-X' },
  { symbol: 'SYM', name: 'Symbotic' },
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
