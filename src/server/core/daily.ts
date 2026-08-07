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

import { context, redis, reddit } from '@devvit/web/server';
import { dayChangePct, renderCharts } from '../../shared/charts';
import type { ChartsPayload, SeriesMap } from '../../shared/charts';
import {
  MARKET_CLOSE_ET,
  closeTimesElsewhere,
  isSessionComplete,
  todayEastern,
} from '../../shared/clock';
import { decideAction } from '../../shared/lifecycle';
import {
  DEFAULT_BOARD,
  INDEX,
  ORDER,
  orderFor,
} from '../../shared/watchlist';
import { rankBoard, tallyVotes, unknownSymbols } from '../../shared/tickers';
import { fetchAll, validateSymbols } from '../prices';
import { votingComments } from '../comments';

/** Redis key holding the rendered chart payload for a given post. */
export const chartsKey = (postId: string) => `charts:${postId}`;

/** The post currently being tracked live: {"session","postId"}. */
const LIVE_POST_KEY = 'livePost';

/** The last session sealed. Nothing for this session is ever written again. */
const FINALIZED_KEY = 'finalizedSession';

/** Symbols we have already asked the vendor about: {"NVDA":true,...}. */
const TRADABLE_KEY = 'tradableSymbols';

/**
 * Which symbols hold the panels right now.
 *
 * Recomputed every pass from the post's comments, so the board mutates through
 * the day as people nominate. Nominated symbols are checked against the vendor
 * before they can take a slot, and the answers are cached: a nominee is worth
 * one probe, not one every five minutes.
 *
 * Returns the display order, index first.
 */
async function resolveOrder(
  session: string,
  postId: `t3_${string}` | null
): Promise<string[]> {
  // Before a post exists there is nothing to have commented on.
  if (!postId) return [...ORDER];

  let texts: string[];
  try {
    texts = await votingComments(postId, session);
  } catch (error) {
    // A board is not worth losing the post over. Fall back to the owner's.
    console.warn(`Could not read comments, using default board: ${error}`);
    return [...ORDER];
  }

  const votes = tallyVotes(texts, DEFAULT_BOARD);

  const cachedRaw = await redis.get(TRADABLE_KEY);
  const cached: Record<string, boolean> = cachedRaw ? JSON.parse(cachedRaw) : {};

  // Anything nominated that we have never checked. Defaults are known good;
  // the index is not contestable and must never be probed as a nominee.
  const toCheck = unknownSymbols(votes, [
    ...DEFAULT_BOARD,
    INDEX.symbol,
    ...Object.keys(cached),
  ]);

  if (toCheck.length > 0) {
    const checked = await validateSymbols(toCheck);
    Object.assign(cached, checked);
    await redis.set(TRADABLE_KEY, JSON.stringify(cached));
    const good = Object.entries(checked).filter(([, v]) => v).map(([k]) => k);
    console.log(
      `Checked ${toCheck.length} nominated symbol(s); tradable: ${good.join(', ') || 'none'}.`
    );
  }

  const eligible = (sym: string) =>
    sym !== INDEX.symbol &&
    (DEFAULT_BOARD.includes(sym) || cached[sym] === true);

  const board = rankBoard(votes, eligible);
  if (board.length === 0) return [...ORDER];

  const promoted = board.filter((s) => !DEFAULT_BOARD.includes(s));
  if (promoted.length > 0) {
    console.log(`Board changed by comments: ${promoted.join(', ')} in.`);
  }

  return orderFor(board);
}

/**
 * The stickied comment: posted once, when the post is created, and never
 * touched again.
 *
 * It is deliberately static. Its job is to tell readers how to nominate a
 * ticker, which is useless if it only appears once trading has finished, and
 * misleading if it carries prices that stop updating. So it lists the owner's
 * own board - the lineup the day starts from - and the rules, and nothing that
 * goes stale.
 */
function stickyText(session: string): string {
  const elsewhere = closeTimesElsewhere(session)
    .map((t) => `${t.city} ${t.time}${t.nextDay ? ' (next day)' : ''}`)
    .join(' · ');

  return [
    '**Want a different chart up here? Ask for it.**',
    '',
    `Write the ticker with a dollar sign, in capitals: **\`$GOOGL\`**, **\`$NVDA\`**, **\`$BRK.B\`**.`,
    'Every mention is a vote, and the eight best-supported tickers take the eight small panels.',
    `${INDEX.name} always keeps the big one.`,
    '',
    '`GOOGL`, `googl`, `$googl` and `Google` do not count - the `$` and the capitals are both required.',
    'A ticker the data provider does not recognise is ignored.',
    '',
    `**Comments are counted until ${MARKET_CLOSE_ET} New York time**, when the market closes and this post is sealed.`,
    `That is ${elsewhere}.`,
    '',
    'Tomorrow the board resets and the race starts again from zero.',
    '',
    'Data from Yahoo Finance. Nothing here is investment advice.',
  ].join('\n');
}

export type DailyBuild = {
  charts: ChartsPayload;
  title: string;
  body: string;
  session: string;
};

/** The session every panel agrees on - the most recent one present. */
function latestSession(series: SeriesMap, order: readonly string[]): string {
  let latest = '';
  for (const sym of order) {
    const s = series[sym]?.session;
    if (s && s > latest) latest = s;
  }
  return latest;
}

/** Points for whichever symbol actually carries the session we are showing. */
function samplepoints(
  series: SeriesMap,
  order: readonly string[],
  session: string
) {
  return (
    order.map((s) => series[s]).find(
      (s) => s && s.session === session && s.points.length > 0
    )?.points ?? []
  );
}

function priceTable(series: SeriesMap, order: readonly string[]): string {
  const rows = [
    '| Name | Symbol | Close | Change on the day |',
    '|:--|:--|--:|--:|',
  ];

  for (const sym of order) {
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
export function composeDaily(
  series: SeriesMap,
  live: boolean,
  order: readonly string[] = ORDER
): DailyBuild {
  const session = latestSession(series, order);
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

  const charts = renderCharts(series, order, { dateLabel, sessionLabel, live });

  const title = `Daily Charts, ${fmt({
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}`;

  const body = [
    `**Closing numbers for ${dateLabel}**`,
    '',
    priceTable(series, order),
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
async function reconcile(
  series: SeriesMap,
  order: readonly string[]
): Promise<string | null> {
  const { subredditName } = context;
  if (!subredditName) throw new Error('subredditName missing from context');

  const session = latestSession(series, order);
  const points = samplepoints(series, order, session);

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
  const build = composeDaily(series, live, order);

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

    // No comment here. The stickied comment went up when the post was created
    // - readers need the nomination rules while they can still act on them,
    // not after the close - and it is deliberately never edited.
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

  // The rules, posted once, at the only moment they are still actionable.
  const comment = await reddit.submitComment({
    id: post.id,
    text: stickyText(session),
  });
  await comment.distinguish(true); // true = also sticky it

  if (action.kind === 'create-final') {
    await redis.set(FINALIZED_KEY, session);
    console.log(`Posted ${post.id} for closed session ${session}.`);
  } else {
    console.log(`Opened ${post.id} for live session ${session}.`);
  }

  return post.id;
}

/**
 * One pass: fetch the whole watchlist, then act on it.
 *
 * There is no accumulator and no partial state. The previous design fetched
 * three symbols per pass and merged them in Redis across three scheduled
 * passes, which meant the grid spent three minutes half-built and, if a deploy
 * landed inside that window, merged symbols from two different watchlists into
 * a single post. Fetching everything in one pass removes the shared state that
 * made both possible.
 *
 * `force` republishes a session already sealed - the mod menu's force item
 * only. Scheduled runs never set it.
 */
export async function runPass(force = false): Promise<string | null> {
  // The board is decided before anything is fetched, because it decides what
  // to fetch. It can only have moved if there is a post to have commented on:
  // the first pass of the day always runs the owner's line-up, which is also
  // the honest answer, since nobody has voted yet.
  const livePost = await readLivePost();
  const order =
    livePost && livePost.session === todayEastern()
      ? await resolveOrder(livePost.session, livePost.postId)
      : [...ORDER];

  const { series, failed } = await fetchAll(order);
  if (failed.length > 0) {
    console.warn(`Fetch problems: ${failed.join('; ')}`);
  }

  const held = order.filter((s) => (series[s]?.points.length ?? 0) > 0).length;
  console.log(`Fetched ${held}/${order.length} symbols: ${order.join(' ')}`);

  if (force) {
    // Deliberately bypasses the whole lifecycle: publish a fresh closed post
    // from whatever we hold, for checking a rendering change without waiting
    // for the next session.
    await redis.del(FINALIZED_KEY);
    await redis.del(LIVE_POST_KEY);
  }

  return reconcile(series, order);
}

/**
 * Manual trigger. A single pass now fits inside one handler, so there is no
 * chain to book and nothing to wait for.
 */
export async function triggerManualRun(force = false): Promise<string | null> {
  const postId = await runPass(force);
  console.log(`Manual run (force=${force}) complete.`);
  return postId;
}
