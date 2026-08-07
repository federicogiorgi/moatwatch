# MoatWatch — handover

Written 7 August 2026. Read this before changing anything.

---

## 1. What this is

A Devvit app on **r/TheMoat** that posts one stock chart grid per trading day:
the S&P 500 as a large panel, eight companies below it, and a stickied comment
with a price table. Owner: **u/Crucco**. App id **moatwatch**, currently
**v0.0.21**.

The original brief is in `../import/BRIEF.md`. **Large parts of it are now
wrong** — it names Stooq as the data source and describes a yearly-closes
chart. Read it for intent, not instructions.

## 2. State right now — the live question

Yahoo was wired in on 7 August and the app has **never yet been observed
running a full live day**. As of 09:15 New York on Friday 7 August, the
immediate task is simply to watch what happens:

- **09:30 NY** — first intraday passes should `create-live` a post for the new
  session, subtitle reading *"Live prices, updated every 5 minutes"*
- **every 5 min** — `update-live`, refreshing figures in place
- **16:00–16:30 NY** — `finalize`: seal it to *"Prices at close, 7 August
  2026"*, add the stickied price table, never touch it again

Watch it with:

```
npx devvit logs r/TheMoat
```

Confirmed working already: Devvit **can** fetch Yahoo from inside the app
(`Pass 0 fetched 3, 3/9 symbols held` appears in the logs). The data path is
proven end to end. What is unproven is the lifecycle against real live data.

## 3. Publishing — two commands, both required

```
npm run deploy            # type-check, lint, build, upload
npx devvit install r/TheMoat   # point the subreddit at the new version
```

**Uploading alone changes nothing on r/TheMoat.** This has caught people out.
If `npm run deploy` errors, nothing was uploaded and the live app is untouched.

Tests:

```
npm run check        # offline suites: timezone, lifecycle, subtitle, charts
npm run check:live   # hits real Yahoo, checks all 9 symbols end to end
```

Run `npm run check` before every deploy. It is fast and has caught real bugs.

## 4. Architecture, and why it is split this way

```
src/shared/     PURE. No network, no Devvit, no value imports.
  clock.ts        every time question. THE TIME ZONE POLICY LIVES HERE.
  session.ts      raw bars -> one trading session + previous close
  yahoo.ts        Yahoo's payload shape -> bars
  lifecycle.ts    what to do with a session (pure decision function)
  charts.ts       series -> panel data + stretchable SVG plots
  watchlist.ts    the nine instruments and how they are chunked
  api.ts          client/server response types

src/server/
  prices.ts       THE ONLY FILE THAT KNOWS THE VENDOR
  core/daily.ts   orchestration: fetch, decide, post, seal
  routes/         scheduler, menu, api

src/client/
  ChartView.tsx   the responsive layout
```

**Everything pure lives in `shared/` on purpose.** The project's TypeScript
uses extensionless imports, which Node cannot resolve, so anything importing
Devvit or server paths **cannot be unit tested**. Pure modules in `shared/` can
be imported directly by the test scripts. This is why `clock.ts`, `session.ts`
and `yahoo.ts` exist as separate files rather than living inside `prices.ts` —
each was extracted the moment it needed testing.

Corollary: **if you write logic worth testing, put it in `shared/`.**

## 5. Time zones — the one rule

**Every decision is in New York time** (`America/New_York`), resolved through
the runtime tz database. Never write `EST` or `EDT` in logic: the market keeps
constant local hours while its UTC offset moves, so a fixed offset is wrong for
months at a time.

The **only** exception is `scheduler.tasks[].cron` in `devvit.json`, which
Devvit evaluates in **UTC**. Those crons are deliberately wider than the
trading day, and every handler re-checks the real New York clock before doing
anything. Cron says "might be worth looking"; `clock.ts` says "actually do it".

`tests/timezone-check.mjs` verifies this against real UTC instants in both
summer and winter. Run it after touching anything time-related.

A bug this already caused: `isMarketOpen()` goes false at 16:00, so gating the
intraday passes on it **skipped the pass that seals the post**, leaving it
advertising "Live prices" for up to 90 minutes after the close. Hence
`isWithinIntradayWindow()`, which runs to 16:30.

## 6. The post lifecycle

`shared/lifecycle.ts` is a pure function returning one of:

| Action | When |
|:--|:--|
| `create-live` | market open, no post yet for this session |
| `update-live` | market open, post exists — refresh figures in place |
| `finalize` | session finished — write final figures, seal, add comment |
| `create-final` | session finished, no live post existed (app was asleep) |
| `skip` | already sealed, or data is stale/absent |

**Sealing is one-way.** `finalizedSession` in Redis is checked first, so a
closed post can never be modified again. This is also what keeps weekends and
market holidays silent — on a non-trading day the vendor returns a session
already published, so it skips. **There is no holiday calendar and none is
needed.**

`tests/lifecycle-check.mjs` walks a full day plus the awkward cases.

## 7. Data source: Yahoo — and four dead ends

**Current: `query1.finance.yahoo.com`** — no API key, no daily quota, current
session, and the real `^GSPC` index. Approved as a domain exception on 6 August.

**Do not retry these. Each was ruled out by testing, not assumption:**

| Vendor | Why it fails |
|:--|:--|
| **Stooq** | Serves a JavaScript proof-of-work page instead of CSV. Devvit has no browser. |
| **Google Finance** | `www.google.com` not allowlisted, no public API since 2012, scraping breaches their terms. |
| **Polygon free** | A full trading session behind. On a Monday evening it still offered the previous Friday. |
| **Twelve Data free** | Works and is current, but 800 credits/day. Nine symbols every 5 min ≈ 700/day — no headroom. |
| **Reddit Data API / PRAW** | Gated behind manual approval. This is why the app is Devvit at all. |

**Approved domain exceptions** (all usable, switching vendor is one file):
`query1.finance.yahoo.com`, `api.twelvedata.com`, `api.tiingo.com`,
`alphavantage.co`, `financialmodelingprep.com`.

**The honest risk:** Yahoo's endpoint is undocumented and could change without
notice. If it breaks, rewrite `server/prices.ts` against one of the approved
alternatives. Nothing else needs to change — that isolation is the single most
valuable decision in the codebase and it has already paid for itself four times.

### Yahoo gotchas

- **`BRK.B` returns 404 — Yahoo uses `BRK-B`.** Handled by `vendorSymbol()`.
  Share classes use a hyphen.
- **Yahoo pads its close array with `null`** for bars that never traded.
  `Number(null)` is `0`, not `NaN`, so these must be dropped explicitly or they
  drag the chart to the floor.
- `^GSPC` needs URI encoding in the path.

## 8. Rate limits and chunking

The watchlist is fetched in **3 chunks of 3**, passes a minute apart, with a
1.5s gap between calls inside a chunk. This was tuned for Polygon's 5/minute
cap; Yahoo has no published limit but hammering an unofficial endpoint is how
you acquire one.

History worth not repeating: firing all symbols at once produced `HTTP 429`
from the vendor **and** `not allowed due to too many requests` from Devvit's own
fetch limiter, which then blocked the remaining calls outright. Rate-limited
passes render blank panels.

Also seen: `scheduler.runJob` failing transiently with
`check rate limit: i/o timeout`. That is Devvit infrastructure, not this code.
Only the **manual** trigger chains passes via `runJob`; the cron passes are
independent entries and cannot hit it.

## 9. The client layout — three things learned painfully

1. **A single fixed-size SVG always fits** (a viewBox scales) **but the text
   becomes unreadable on a phone.** Do not go back to one monolithic SVG.
2. **A natural HTML grid overflows**, clipping on mobile and scrolling on
   desktop. The container has **fixed height and variable width**, so the
   layout must be driven by height: flex column, `min-h-0` throughout, panels
   take the height they are given and never request an aspect ratio.
3. **CSS media queries do not fire as expected in the webview.** A 1000px-wide
   desktop post never triggered Tailwind's `md:`. The component measures its own
   element with a `ResizeObserver` and switches at 520px. **Do not reintroduce
   `sm:`/`md:` breakpoints for layout decisions.**

The grid stays **4 × 2 at every width**. Dropping to fewer columns when narrow
— the usual responsive reflex — adds rows, which is exactly wrong when height
is scarce.

Other details: panels show the **ticker** on narrow screens and the full name
when there is room ("Berkshire Hathaway" does not fit in 90px). Overlay
readouts are **white with a dark text-shadow**, because coloured text on a
same-coloured gradient was unreadable. Each plot line **starts at the previous
close** so an overnight gap draws as a drop rather than vanishing.

## 10. Chart semantics

- Each panel is **one session**, 09:30–16:00 New York, five-minute closes.
- The **dashed line is the previous close**, and the percentage is measured
  against it — not the open. That is what "up 2% today" means everywhere else,
  and it is the only definition that counts an overnight gap.
- The previous close comes from **the previous session present in the data**,
  never calendar arithmetic. Weekends and holidays are therefore handled for
  free: a Monday compares to Friday; a Tuesday after a holiday compares to the
  Friday before. Tested.

Known imprecision: figures come from the 15:55 five-minute bar, not the closing
auction print, so they can differ from finance sites by up to ~0.1pp. Disclosed
in `docs/TERMS.md`. Fixing it needs official close data.

## 11. Secrets

Yahoo needs no key, so there is currently **no secret configured**. If you
switch to a keyed vendor:

```
npx devvit settings set <keyName>
```

The command prompts, so the key never appears in a file, a shell argument, or a
chat log. A key was leaked into a transcript once this way — do not paste keys
into commands.

## 12. Legal / policy notes

- `docs/TERMS.md` and `docs/PRIVACY.md` are published as public GitHub gists and
  linked from the app's developer settings. **Reddit requires both for any app
  using `fetch`.**
- The README's **"Fetch Domains"** section is required by Reddit's HTTP fetch
  policy and is read during domain review. Keep it accurate.
- Reddit approves domains that are **publicly documented and publicly
  accessible** — though note they approved Yahoo's undocumented endpoint, so
  the policy is applied more loosely than written.
- **Do not run `devvit publish`.** That submits for app review, which the owner
  does not want. `devvit upload` is private and is what `npm run deploy` uses.

## 13. Owner preferences

- **Will not pay for data.** Free tiers only. This is a hobby project.
- Wants to make small changes himself — see `docs/CUSTOMISING.md`.
- **Give instructions when asked for instructions.** Do not do the task instead.
- Prefers being told what was verified versus what was assumed.
- Watchlist is his to choose; he edits it directly.

## 14. Where to look

| Question | File |
|:--|:--|
| How do I change a ticker / the schedule? | `docs/CUSTOMISING.md` |
| What does the app do, and which domains? | `README.md` |
| Anything about time | `src/shared/clock.ts` |
| When does it post, and why not? | `src/shared/lifecycle.ts` |
| Vendor-specific anything | `src/server/prices.ts` |
| Why is the layout like that? | `src/client/ChartView.tsx` |
| Original intent (partly outdated) | `../import/BRIEF.md` |
