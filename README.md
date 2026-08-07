# MoatWatch

A Devvit app for r/TheMoat that posts one chart grid per trading day: the S&P 500
as a large panel, eight watchlist companies below it, and a stickied first
comment containing a table of closing prices and the change on the day.

Each panel shows a single trading session intraday, 09:30 to 16:00 New York
time, in five-minute closes. The dashed line on every panel marks the previous
session's close, which is also the reference for the percentage shown, so the
line, the colour and the number all describe the same period.

Installed on one subreddit, r/TheMoat, which the author moderates.

## Fetch Domains

Every domain below is requested for one single purpose: fetching daily and
intraday price bars for the nine instruments on the watchlist (SPY, GOOGL,
AAPL, KO, BRK.B, MCD, CVX, SYM, CLX), which are the only input this app has.
Each is a free, publicly documented, publicly accessible REST API requiring no
end-user account. All requests are made server-side on a fixed schedule after
the US market close and total nine per trading day.

**No Reddit user data is transmitted to any of them.** The app sends ticker
symbols and reads back market prices. It reads no user data, stores no user
data, and has no client-side fetch.

- `api.polygon.io` — Currently in use. Listed because apps must request each
  domain they fetch, including globally allowlisted ones.
  Docs: https://polygon.io/docs
- `api.twelvedata.com` — Docs: https://twelvedata.com/docs
- `api.tiingo.com` — Docs: https://www.tiingo.com/documentation/general/overview
- `alphavantage.co` — Docs: https://www.alphavantage.co/documentation/
  (request the bare host, without `www` — Reddit normalises it that way, and
  the bare host serves the API directly rather than redirecting, so calls must
  use `https://alphavantage.co/query?...` to match the approved entry exactly)
- `financialmodelingprep.com` — Docs: https://site.financialmodelingprep.com/developer/docs

### Why more than one is requested

The app needs exactly one working provider and will use exactly one. Several
are listed because free tiers differ in a way that is not visible from their
documentation: whether a trading session becomes available within hours of its
close, or only the following day.

That distinction is the entire problem this app has. The original data source
(Stooq) began serving a JavaScript bot-check instead of CSV and cannot be used
from a server at all. The current source, Polygon's free tier, turned out to be
end-of-day only — nine hours after a Friday close it still offered nothing
newer than Thursday, which makes a daily chart post pointless.

Rather than request one domain, discover the same limitation days later, and
request another, the alternatives are requested together. Once one is confirmed
to serve same-session data, `src/server/prices.ts` is pointed at it and the
unused domains will be removed from this list.

## How it works

- `src/shared/charts.ts` — Renders the whole grid as one standalone SVG string.
  Pure function, data in, string out. No DOM, no Devvit, no charting library.
- `src/shared/session.ts` — Reduces raw vendor bars to a single trading session
  plus the previous close. Pure, and where the timezone handling lives.
- `src/shared/watchlist.ts` — The nine instruments, and how they are split into
  fetch chunks.
- `src/server/prices.ts` — The vendor client. The only file that changes when
  the data source changes.
- `src/server/core/daily.ts` — Builds the post, publishes it, and stickies the
  price comment.

### Scheduling

Two scheduled passes, declared in `devvit.json`, retrying at 21:30, 23:30,
01:30, 03:30 and 05:30 UTC. Cron is expressed in UTC because Devvit schedulers
run in UTC and the US close moves between 20:00 and 21:00 UTC across daylight
saving. The watchlist is fetched in two chunks minutes apart because free data
tiers rate-limit per minute and Devvit's HTTP handler has a 30 second limit.

The passes retry because vendors do not publish a session the moment it closes.
A post is only ever created for a session that has finished trading and has not
been published before, so weekends, market holidays and repeated retries all
produce silence rather than duplicates.

### Moderator menu

"Post today's charts" runs the same build on demand, for testing and for the
first time the scheduler quietly does not fire. It obeys the same rules, so it
will not produce a duplicate or publish a session still in progress.

## Commands

- `npm run dev` — Playtest against r/TheMoat with hot reload and streamed logs.
- `npm run build` — Build client and server.
- `npm run deploy` — Type-check, lint, and upload a new private version.
- `npm run type-check` — Type check.
- `npm run lint` — Lint.

Set the data provider's API key as an encrypted app secret, never in the repo:

```
npx devvit settings set polygonApiKey
```
