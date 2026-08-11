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

/**
 * The owner's eight: where every day starts, before anyone has voted.
 *
 * These are not fixed any more. Readers nominate tickers by writing them with
 * a dollar sign, and the eight best-supported symbols hold the panels - see
 * shared/tickers.ts. Each of these opens the day with half a vote, so an
 * untouched default outranks anything nobody mentioned but loses its slot to
 * a single genuine nomination. The next morning the board resets to this list.
 *
 * The index is not contestable and is not part of this.
 */
export const DEFAULT_BOARD: readonly string[] = STOCKS.map((s) => s.symbol);

/** Index first, then the eight small panels in display order. */
export const ORDER: readonly string[] = [INDEX.symbol, ...DEFAULT_BOARD];

/**
 * Display order for a board that may contain symbols we have never seen.
 *
 * The index always leads and is never voted on; the contested panels follow
 * alphabetically, so the grid reads the same way however the voting went.
 */
export function orderFor(board: readonly string[]): string[] {
  return [INDEX.symbol, ...[...board].sort()];
}

/**
 * Display names for the symbols we ship with.
 *
 * A nominated ticker has no name of ours. Every call site already falls back
 * to the symbol itself (`NAMES[s] ?? s`), which is what a reader who typed
 * `$NVDA` will recognise anyway.
 */
export const NAMES: Readonly<Record<string, string>> = Object.fromEntries(
  [INDEX, ...STOCKS].map((s) => [s.symbol, s.name])
);

/**
 * Legal furniture to drop off the end of a vendor-supplied company name.
 *
 * Order matters only in that the list is applied repeatedly: "Virgin Galactic
 * Holdings, Inc." needs two passes to become "Virgin Galactic".
 */
const SUFFIXES = [
  'incorporated', 'inc', 'corporation', 'corp', 'company', 'co',
  'holdings', 'holding', 'group', 'plc', 'limited', 'ltd', 'llc',
  'ag', 'se', 'nv', 'sa', 'nsp', 'new',
  'common stock', 'ordinary shares', 'class a', 'class b', 'class c',
];

/**
 * A vendor company name, cut down to something that fits a panel.
 *
 * Yahoo answers with the registered name - "Virgin Galactic Holdings, Inc.",
 * "Energy Recovery, Inc." - and the panels are as narrow as 90 pixels, which
 * is why the layout already falls back to the ticker when there is no room.
 * Trimming the legal suffix is what makes the difference between a name that
 * fits and one that never shows at all.
 *
 * Only ever used when we have no curated name of our own: the owner's
 * spellings ("Space-X", "Coca-Cola") stay exactly as he wrote them.
 */
export function tidyCompanyName(raw: string): string {
  let out = raw.trim().replace(/^The\s+/i, '');

  // Strip one suffix at a time until nothing else matches, so stacked
  // suffixes ("Holdings, Inc.") come off completely.
  for (let changed = true; changed; ) {
    changed = false;
    for (const suffix of SUFFIXES) {
      const re = new RegExp(`[,\\s]+${suffix}\\.?$`, 'i');
      if (re.test(out)) {
        out = out.replace(re, '');
        changed = true;
      }
    }
  }

  return out.replace(/[,\s]+$/, '').trim() || raw.trim();
}

/**
 * The watchlist is fetched in one pass. There is no chunking any more.
 *
 * It used to be split into three chunks across three scheduled passes, because
 * Polygon's free tier allowed five calls a minute and nine symbols could not
 * fit inside one. That vendor is long gone; Yahoo publishes no such cap, and
 * nine sequential fetches measure at about 14 seconds against Devvit's 30
 * second handler budget. See server/prices.ts for the spacing and the retry.
 */
