# MoatWatch — Privacy Policy

_Last updated: 1 August 2026_

MoatWatch is a Reddit Developer Platform (Devvit) app that posts a daily stock
chart summary to the subreddit it is installed on.

## What data this app collects

**None.**

MoatWatch does not collect, store, request, process, or transmit any personal
information about any Reddit user. Specifically, it does not collect usernames,
email addresses, IP addresses, location, browsing history, voting history,
subscriptions, or any other user-identifying information.

The app has no sign-up, no login, no user accounts, no forms, no analytics, and
no advertising or tracking of any kind.

## What data this app stores

MoatWatch uses Reddit's Redis storage to hold only:

- Stock price data retrieved from a third-party market data provider
- The rendered chart image (an SVG) for each post it has created
- The date of the most recent trading session it has already posted, used to
  avoid publishing the same session twice

None of this is derived from, or linked to, any Reddit user.

## Third parties

To produce its charts, the app requests historical and intraday price data for
a fixed list of nine publicly traded instruments (SPY, GOOGL, AAPL, KO, BRK.B,
MCD, CVX, SYM, CLX) from a third-party market data provider.

**No Reddit user data is sent to these providers.** The only information
transmitted is the ticker symbols listed above and an API key belonging to the
app's operator. Requests are made from the server on a fixed schedule, are not
triggered by any user action, and total approximately nine per trading day.

The provider currently in use, and alternatives that may be used in future, are
listed in the app's README along with links to their own privacy policies:
Polygon.io, Twelve Data, Tiingo, Alpha Vantage, and Financial Modeling Prep.

## Viewing a post

The chart is rendered inside a Reddit-hosted webview. It requests only the
chart data for the post being viewed, from the app's own server. It makes no
requests to any external domain, sets no cookies, and records nothing about the
viewer.

## Children

The app is not directed at children and collects no data from anyone.

## Changes

Any change to this policy will be published at this same location with an
updated date.

## Contact

Questions about this policy can be sent to the app's developer, u/Crucco, via
Reddit private message.
