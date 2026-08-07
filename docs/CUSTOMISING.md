# Changing MoatWatch yourself

Every change below is one file plus one command. Nothing here needs deep
knowledge of the code.

## The one command that publishes anything

After **any** edit, from `D:\Drive\programs\reddit\moatwatch`:

```
npm run deploy
npx devvit install r/TheMoat
```

The first type-checks, lints, builds and uploads a new version. The second
points r/TheMoat at it. **Both are needed** — uploading alone does not change
what the subreddit runs.

If `npm run deploy` prints errors, nothing was uploaded and the live app is
untouched. Read the error, fix it, run it again. It is safe to repeat.

To see a change without waiting for the next trading day, use the subreddit
menu item **"Re-post latest session (force)"**. Click it once and wait ~4
minutes: the watchlist is fetched in three chunks 90 seconds apart to stay
under the data provider's rate limit. Clicking repeatedly causes `HTTP 429`
errors and empty panels.

---

## Swap a company

File: `src/shared/watchlist.ts`

Find the `STOCKS` list and change the line. To replace Clorox with Procter &
Gamble:

```ts
// before
{ symbol: 'CLX', name: 'Clorox' },
// after
{ symbol: 'PG', name: 'Procter & Gamble' },
```

`symbol` must be exactly what the data provider calls it. `name` is only a
label — write whatever reads well.

**Check the symbol first.** A wrong one does not crash anything; it renders a
silent "no data" panel, which is easy to miss. Open this in a browser, swapping
in your ticker:

```
https://finance.yahoo.com/quote/PG
```

If the page shows the company you meant, the symbol is right. Watch out for
share classes: Berkshire is `BRK.B`, not `BRK` or `BRKB`, and Alphabet's A
shares are `GOOGL` while `GOOG` is the C shares.

Long names are fine — panels show the ticker on narrow screens and the full
name when there is room. Ampersands and accents are safe.

## Change how many companies are shown

The layout is a fixed 4 x 2 grid, so **eight small panels** is what fits. Fewer
leaves gaps; more will not display. Keep `STOCKS` at eight unless you also
change the grid in `src/client/ChartView.tsx`.

## Change the large panel

Same file, the `INDEX` line:

```ts
export const INDEX: Instrument = { symbol: 'SPY', name: 'S&P 500 (SPY)' };
```

It tracks SPY, the ETF, because the free data tier does not serve the index
itself. If you ever move to a provider that does, change the symbol and the
name together.

## Change the posting times

File: `devvit.json`, under `scheduler.tasks`.

**These crons are in UTC** — the platform requires it. Everything else in the
app works in New York time. The `intraday-*` tasks run every 5 minutes across a
UTC window wider than the trading day, and the code then checks the real New
York clock and does nothing outside 09:30–16:30. So widening the UTC window is
harmless; narrowing it can silently cut off the end of the trading day in one
half of the year, when New York's offset from UTC changes.

The `daily-charts-pass-*` tasks are the evening fallback that catches a session
the provider only published after the close.

## Change wording on the chart

- Title, subtitle, footer: `src/client/ChartView.tsx`
- "Prices at close" / "Live prices" wording: `src/shared/charts.ts`
- The stickied comment under each post: `composeDaily` in
  `src/server/core/daily.ts`

## Change the data provider

File: `src/server/prices.ts` — the only file that knows about the vendor.

Also add the new domain to `permissions.http.domains` in `devvit.json` and
wait for Reddit to approve it (1–2 business days), then set the key with:

```
npx devvit settings set polygonApiKey
```

Never put a key in a file. The command prompts for it and stores it encrypted.

---

## Checking it worked

Watch the app's own log:

```
npx devvit logs r/TheMoat
```

Leave it running in a terminal. Useful lines:

| Log line | Meaning |
|:--|:--|
| `Pass 0 fetched 3, 3/9 symbols held` | a chunk arrived |
| `Opened t3_… for live session …` | a post was created at the open |
| `Refreshed t3_… for live session …` | figures updated during the day |
| `Sealed t3_… at close of …` | post finalised, never changes again |
| `No action: … already finalized` | correct — that session is done |
| `Pass N problems: … HTTP 429` | triggered too often; wait a few minutes |

Add `--since 30m` to look back rather than watch live. Reddit keeps 7 days.
