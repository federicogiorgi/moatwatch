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
 * The watchlist is fetched in one pass. There is no chunking any more.
 *
 * It used to be split into three chunks across three scheduled passes, because
 * Polygon's free tier allowed five calls a minute and nine symbols could not
 * fit inside one. That vendor is long gone; Yahoo publishes no such cap, and
 * nine sequential fetches measure at about 14 seconds against Devvit's 30
 * second handler budget. See server/prices.ts for the spacing and the retry.
 */
