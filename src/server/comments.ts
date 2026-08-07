/**
 * comments.ts - what the readers voted for.
 *
 * The eight small panels are contested. This reads the post's comments and
 * hands their text to shared/tickers.ts, which does the counting. Everything
 * decidable is pure and lives there; this file only deals with Reddit.
 */

import { reddit } from '@devvit/web/server';
import { countsTowardBoard } from '../shared/clock';

/** Read no more than this many comments in one pass. */
const COMMENT_LIMIT = 500;

/**
 * The text of every comment that may vote on `session`.
 *
 * Two exclusions, both load-bearing:
 *
 * The app's own comments never count. The stickied comment names every ticker
 * on the board, complete with dollar signs, so counting it would re-elect the
 * incumbents every single day and no nomination could ever win a slot.
 *
 * Comments posted after 16:00 New York never count. Voting closes with the
 * market, and the sealing pass runs up to half an hour later.
 */
export async function votingComments(
  postId: `t3_${string}`,
  session: string
): Promise<string[]> {
  let appUser = '';
  try {
    appUser = (await reddit.getCurrentUsername()) ?? '';
  } catch {
    // If we cannot establish who we are, we cannot prove a comment is not
    // ours. Counting nothing is wrong, but counting our own ballot stuffing
    // is worse, so fall back to excluding by the sticky's distinguished flag
    // alone and log it.
    console.warn('Could not resolve app username; sticky may be counted.');
  }

  const listing = await reddit.getComments({ postId, limit: COMMENT_LIMIT });
  const all = await listing.all();

  const texts: string[] = [];
  for (const c of all) {
    if (appUser && c.authorName === appUser) continue;
    if (!c.body) continue;
    if (!countsTowardBoard(session, c.createdAt)) continue;
    texts.push(c.body);
  }

  return texts;
}
