import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { triggerManualRun } from '../core/daily';

export const menu = new Hono();

/**
 * "Re-post latest session (force)" - republishes even if already posted.
 *
 * This is for checking a rendering change without waiting for the next trading
 * session, which over a weekend can be three days away.
 *
 * There used to be a second, safe item here ("Post today's charts") that
 * obeyed the duplicate guard. It was removed as redundant: the intraday cron
 * runs every five minutes and the evening passes catch a late session, so a
 * missing post appears on its own without anyone pressing anything.
 *
 * The handler cannot post synchronously - the watchlist takes several vendor
 * calls spaced minutes apart, far past the 30 second handler limit. It kicks
 * off pass 0, books the rest, and says when to look.
 *
 * Note this clears `livePost` as well as `finalizedSession`, so running it
 * while the market is open orphans the session's live post: that post stops
 * refreshing and a duplicate starts alongside it. Use it out of hours.
 */
menu.post('/post-force', async (c) => {
  try {
    await triggerManualRun(true);
    return c.json<UiResponse>(
      {
        showToast:
          'Re-posting the latest session. This creates a duplicate post in about 2 minutes.',
      },
      200
    );
  } catch (error) {
    console.error(`Forced trigger failed: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: `Failed: ${error instanceof Error ? error.message : error}`,
      },
      400
    );
  }
});
