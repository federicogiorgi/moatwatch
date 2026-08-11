/**
 * comments.ts - what the readers voted for.
 *
 * The eight small panels are contested. This reads the post's comments and
 * hands their text to shared/tickers.ts, which does the counting. Everything
 * decidable is pure and lives there; this file only deals with Reddit.
 */

import { reddit } from '@devvit/web/server';
import { countsTowardBoard } from '../shared/clock';
import { isVotingComment } from '../shared/tickers';

/** Read no more than this many comments in one pass. */
const COMMENT_LIMIT = 500;

/**
 * Comments fetched per request as the listing is paged through.
 *
 * This is not optional, and leaving it out is what broke the whole feature on
 * 10 and 11 August. `getComments({ postId, limit })` without a page size
 * returned exactly ONE comment - and because a stickied comment sorts to the
 * top, that one comment was always the app's own. Readers' nominations were
 * never returned at all, so no vote could ever be counted, while the sticky's
 * own examples voted on every pass. Devvit's own documented example pairs
 * `limit` with `pageSize`; the omission is silent and looks like an empty
 * post rather than a paging fault.
 */
const PAGE_SIZE = 100;

/**
 * How deep into reply threads to read.
 *
 * A reply to the stickied comment is the obvious place to answer "which ticker
 * do you want?", so replies have to vote too. Without a depth the listing does
 * not reliably descend past the top level.
 */
const DEPTH = 10;

export type VotingRead = {
  /** Bodies of the comments that may vote. */
  texts: string[];
  /** How many comments the post had in total. */
  read: number;
  /** How many were ours and therefore ignored. */
  own: number;
  /** How many arrived after voting closed. */
  late: number;
};

/**
 * The text of every comment that may vote on `session`.
 *
 * Two exclusions, both load-bearing:
 *
 * The app's own comments never count. The stickied comment spells out the
 * rules using real tickers as examples - `$GOOGL`, `$NVDA`, `$BRK.B` - so
 * counting it hands those three a vote every single pass, and a ticker nobody
 * asked for takes a panel. That is not hypothetical: it is exactly what
 * happened on 10 August 2026, when NVDA held a panel all day off the back of
 * the app quoting itself.
 *
 * `excludeIds` is the reliable half of that. The sticky's id is recorded when
 * it is posted, so the exclusion does not depend on being able to resolve who
 * we are. The username check stays as a second line of defence for anything
 * else we might ever post, but it must never be the only one: a scheduled
 * task has no logged-in user, so `getCurrentUsername()` returns nothing there,
 * and the previous version silently skipped the whole check when it did.
 *
 * Comments posted after 16:00 New York never count. Voting closes with the
 * market, and the sealing pass runs up to half an hour later.
 */
export async function votingComments(
  postId: `t3_${string}`,
  session: string,
  excludeIds: readonly string[] = []
): Promise<VotingRead> {
  let appUser: string;
  try {
    appUser = (await reddit.getCurrentUsername()) ?? '';
  } catch {
    appUser = '';
  }
  if (!appUser) {
    // Not fatal - `excludeIds` covers the comment that actually matters - but
    // it must be visible, because this is the condition under which the old
    // code quietly counted its own ballot.
    console.warn(
      'Could not resolve app username; relying on recorded comment ids alone.'
    );
  }

  const skip = new Set(excludeIds);
  const listing = await reddit.getComments({
    postId,
    limit: COMMENT_LIMIT,
    pageSize: PAGE_SIZE,
    depth: DEPTH,
    sort: 'new',
  });
  const all = await listing.all();

  // Every comment the API handed back, itemised.
  //
  // On 10 August this call returned the app's own stickied comment but not a
  // reader's top-level comment on the same post, and the logs recorded only
  // the outcome - so there was no way to tell whether the comment had been
  // read and discarded, or never returned at all. Those are entirely
  // different bugs and they looked identical. They do not any more.
  for (const c of all.slice(0, 25)) {
    const when = new Date(c.createdAt).toISOString();
    const body = (c.body ?? '').replace(/\s+/g, ' ').slice(0, 60);
    console.log(`  comment ${c.id} by ${c.authorName ?? '?'} at ${when}: ${body}`);
  }

  const out: VotingRead = { texts: [], read: all.length, own: 0, late: 0 };

  for (const c of all) {
    if (skip.has(c.id) || (appUser && c.authorName === appUser)) {
      out.own++;
      continue;
    }
    if (!c.body) continue;
    if (!countsTowardBoard(session, c.createdAt)) {
      out.late++;
      continue;
    }
    // The decision itself is shared/tickers.ts, so it is covered by tests.
    // The two checks above are only here to keep the tallies for the log line.
    if (
      isVotingComment(c, {
        session,
        appUser,
        excludeIds,
        inWindow: countsTowardBoard,
      })
    ) {
      out.texts.push(c.body);
    }
  }

  return out;
}
