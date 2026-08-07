# Working on MoatWatch

**Read `docs/HANDOVER.md` first.** It explains what this app is, what state it
is in, which data sources are dead ends and why, and the bugs that have already
been made here so you do not repeat them. Nothing below replaces it.

This is a Devvit Web app (React 19, Tailwind 4, Vite, Hono, TypeScript) that
posts a daily stock chart grid to r/TheMoat.

## Before you change anything

```
npm run check        # offline test suites - run this before every deploy
npm run check:live   # hits real Yahoo, verifies all nine symbols
```

## Publishing — both commands, always

```
npm run deploy
npx devvit install r/TheMoat
```

Uploading alone does not change what the subreddit runs. Never run
`devvit publish` — that submits the app for review, which the owner does not
want.

## Rules specific to this project

- **All time logic is New York time.** `src/shared/clock.ts` holds the policy.
  The only UTC thing is `cron` in `devvit.json`, which the platform forces.
- **Pure logic goes in `src/shared/`.** Extensionless imports mean Node cannot
  load anything that imports Devvit, so only `shared/` modules are testable.
  If it is worth testing, it belongs there.
- **`src/server/prices.ts` is the only file that knows the data vendor.** Keep
  it that way — the vendor has changed four times.
- **Do not use CSS media queries for layout in the client.** They do not fire
  as expected inside the Devvit webview. `ChartView.tsx` measures its own
  element with a `ResizeObserver`.
- **Never put an API key in a file or a shell argument.** Use
  `npx devvit settings set <key>`, which prompts.
- **Verify a ticker before adding it.** A wrong symbol does not error, it
  renders a silent "no data" panel. Yahoo writes share classes with a hyphen:
  `BRK-B`, not `BRK.B`.

## Layout and architecture

- `/src/shared` — pure: clock, session parsing, lifecycle decision, chart
  rendering, watchlist, Yahoo payload shape
- `/src/server` — I/O: vendor fetch, orchestration, routes
- `/src/client` — the responsive webview (`game.html` expanded,
  `splash.html` inline)

## Code style

- Type aliases over interfaces
- Named exports over default exports
- Never cast TypeScript types
- Match the surrounding comment density: this codebase explains *why*,
  especially where a previous approach failed

Devvit docs: https://developers.reddit.com/docs/llms.txt
