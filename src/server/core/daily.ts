/**
 * daily.ts - the post's life: born at the open, updated while the market
 * runs, sealed at the close, never touched again.
 *
 * Fetching is split across passes because the vendor's free tier allows only
 * 5 calls a minute and the watchlist is nine symbols, while a Devvit handler
 * has 30 seconds. Each pass fetches one chunk and merges it into an
 * accumulator in Redis; the last pass decides what to do with the result.
 *
 * The decision itself is in shared/lifecycle.ts as a pure function, so the
 * awkward cases - posted twice, still editing yesterday's post, updating a
 * post that has already closed - can be tested exhaustively.
 */

import { context, redis, reddit, scheduler } from '@devvit/web/server';
import { dayChangePct, renderCharts } from '../../shared/charts';
import type { ChartsPayload, SeriesMap } from '../../shared/charts';
import { isSessionComplete, todayEastern } from '../../shared/clock';
import { decideAction } from '../../shared/lifecycle';
import { ORDER, CHUNKS, FINAL_PASS } from '../../shared/watchlist';
import { fetchChunk } from '../prices';

/** Redis key holding the rendered chart payload for a given post. */
export const chartsKey = (postId: string) => `charts:${postId}`;

/** Partial result accumulated by earlier passes. */
const PENDING_KEY = 'pendingSeries';

/** The post currently being tracked live: {"session","postId"}. */
const LIVE_POST_KEY = 'livePost';

/** The last session sealed. Nothing for this session is ever written again. */
const FINALIZED_KEY = 'finalizedSession';

/** Task name for the manual chain's follow-up passes, from devvit.json. */
export const NEXT_PASS_TASK = 'daily-charts-next-pass';

export type DailyBuild = {
  charts: ChartsPayload;
  title: string;
  body: string;
  session: string;
};

/** The session every panel agrees on - the most recent one present. */
function latestSession(series: SeriesMap): string {
  let latest = '';
  for (const sym of ORDER) {
    const s = series[sym]?.session;
    if (s && s > latest) latest = s;
  }
  return latest;
}

/** Points for whichever symbol actually carries the session we are showing. */
function samplepoints(series: SeriesMap, session: string) {
  return (
    ORDER.map((s) => series[s]).find(
      (s) => s && s.session === session && s.points.length > 0
    )?.points ?? []
  );
}

function priceTable(series: SeriesMap): string {
  const rows = [
    '| Name | Symbol | Close | Change on the day |',
    '|:--|:--|--:|--:|',
  ];

  for (const sym of ORDER) {
    const entry = series[sym];
    const name = entry?.name ?? sym;
    const last = entry?.points.at(-1)?.c;
    const pct = entry ? dayChangePct(entry) : NaN;

    if (last === undefined || !Number.isFinite(pct)) {
      rows.push(`| ${name} | \`${sym}\` | n/a | n/a |`);
      continue;
    }
    rows.push(
      `| ${name} | \`${sym}\` | ${last.toFixed(2)} | ${pct >= 0 ? '+' : ''}${pct.toFixed(2)}% |`
    );
  }

  return rows.join('\n');
}

/** Compose everything for a session. `live` drives the subtitle. */
export function composeDaily(series: SeriesMap, live: boolean): DailyBuild {
  const session = latestSession(series);
  if (!session) throw new Error('No usable price data for any symbol');

  // `session` is already a New York calendar date, decided by session.ts. It
  // is parsed and formatted as UTC purely so a bare date cannot slip a day
  // during formatting - this is not a second time zone in the logic, it is the
  // standard way to render a date-only value without a clock attached.
  const asDate = new Date(`${session}T00:00:00Z`);
  const fmt = (opts: Intl.DateTimeFormatOptions) =>
    asDate.toLocaleDateString('en-GB', { ...opts, timeZone: 'UTC' });

  const dateLabel = fmt({
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
  const sessionLabel = fmt({ day: 'numeric', month: 'long', year: 'numeric' });

  const charts = renderCharts(series, ORDER, { dateLabel, sessionLabel, live });

  const title = `Daily Charts, ${fmt({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;

  const body = [
    `**Closing numbers for ${dateLabel}**`,
    '',
    priceTable(series),
    '',
    '---',
    '',
    'Each panel is that session traded intraday, 09:30 to 16:00 New York time,',
    'starting from the previous close - the dashed line - which is also what',
    'the percentage is measured against.',
    '',
    'Data from Yahoo Finance.',
    'Nothing here is investment advice.',
  ].join('\n');

  return { charts, title, body, session };
}

// postId keeps Reddit's own thing-id shape, so it can be handed straight to
// submitComment without a cast.
type LivePost = { session: string; postId: `t3_${string}` };

async function readLivePost(): Promise<LivePost | null> {
  const raw = await redis.get(LIVE_POST_KEY);
  return raw ? (JSON.parse(raw) as LivePost) : null;
}

/**
 * Act on a complete set of series: create, refresh, or seal.
 *
 * Returns the post id when one was created, so callers can log it.
 */
async function reconcile(series: SeriesMap): Promise<string | null> {
  const { subredditName } = context;
  if (!subredditName) throw new Error('subredditName missing from context');

  const session = latestSession(series);
  const points = samplepoints(series, session);

  const action = decideAction({
    session,
    sessionComplete: isSessionComplete(session, points),
    isToday: session === todayEastern(),
    livePost: await readLivePost(),
    finalizedSession: (await redis.get(FINALIZED_KEY)) ?? null,
  });

  if (action.kind === 'skip') {
    console.log(`No action: ${action.reason}.`);
    return null;
  }

  const live = action.kind === 'create-live' || action.kind === 'update-live';
  const build = composeDaily(series, live);

  if (action.kind === 'update-live') {
    const livePost = await readLivePost();
    await redis.set(chartsKey(livePost!.postId), JSON.stringify(build.charts));
    console.log(`Refreshed ${livePost!.postId} for live session ${session}.`);
    return null;
  }

  if (action.kind === 'finalize') {
    const livePost = await readLivePost();
    await redis.set(chartsKey(livePost!.postId), JSON.stringify(build.charts));
    await redis.set(FINALIZED_KEY, session);

    // The summary comment is added once, at the close, because that is the
    // first moment the numbers in it are final.
    const comment = await reddit.submitComment({
      id: livePost!.postId,
      text: build.body,
    });
    await comment.distinguish(true); // true = also sticky it

    console.log(`Sealed ${livePost!.postId} at close of ${session}.`);
    return null;
  }

  // create-live or create-final
  const post = await reddit.submitCustomPost({
    subredditName,
    title: build.title,
    entry: 'default',
    textFallback: { text: build.body },
  });

  await redis.set(chartsKey(post.id), JSON.stringify(build.charts));
  await redis.set(
    LIVE_POST_KEY,
    JSON.stringify({ session, postId: post.id } satisfies LivePost)
  );

  if (action.kind === 'create-final') {
    await redis.set(FINALIZED_KEY, session);
    const comment = await reddit.submitComment({
      id: post.id,
      text: build.body,
    });
    await comment.distinguish(true);
    console.log(`Posted ${post.id} for closed session ${session}.`);
  } else {
    console.log(`Opened ${post.id} for live session ${session}.`);
  }

  return post.id;
}

/**
 * Run one pass: fetch its chunk, merge into the accumulator, and on the final
 * pass act on the result.
 *
 * `force` republishes a session already sealed - the mod menu's force item
 * only. Scheduled runs never set it.
 */
export async function runPass(
  index: number,
  force = false
): Promise<string | null> {
  const chunk = CHUNKS[index];
  if (!chunk) throw new Error(`No chunk at index ${index}`);

  const { series: fetched, failed } = await fetchChunk(chunk);
  if (failed.length > 0) {
    console.warn(`Pass ${index} problems: ${failed.join('; ')}`);
  }

  const parked = index === 0 ? null : ((await redis.get(PENDING_KEY)) ?? null);
  const merged: SeriesMap = {
    ...(parked ? (JSON.parse(parked) as SeriesMap) : {}),
    ...fetched,
  };
  await redis.set(PENDING_KEY, JSON.stringify(merged));
  console.log(
    `Pass ${index} fetched ${Object.keys(fetched).length}, ` +
      `${Object.keys(merged).length}/${ORDER.length} symbols held.`
  );

  if (index !== FINAL_PASS) return null;

  if (force) {
    // Deliberately bypasses the whole lifecycle: publish a fresh closed post
    // from whatever we hold, for checking a rendering change without waiting
    // for the next session.
    await redis.del(FINALIZED_KEY);
    await redis.del(LIVE_POST_KEY);
  }

  return reconcile(merged);
}

/** Book the next pass in a manually started chain. */
export async function scheduleNextPass(
  index: number,
  force: boolean
): Promise<void> {
  await scheduler.runJob({
    name: NEXT_PASS_TASK,
    data: { index, force, chain: true },
    runAt: new Date(Date.now() + 90 * 1000),
  });
  console.log(`Pass ${index} booked in 90s (force=${force}).`);
}

/**
 * Manual trigger: run the first pass now and chain the rest.
 *
 * Each pass books the next rather than scheduling all of them up front, so the
 * vendor's per-minute window has rolled over between chunks even if a pass
 * runs slowly.
 */
export async function triggerManualRun(force = false): Promise<void> {
  await runPass(0, force);
  await scheduleNextPass(1, force);
  console.log(`Manual run (force=${force}): pass 0 done.`);
}
