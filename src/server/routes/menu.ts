import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { triggerManualRun } from '../core/daily';

export const menu = new Hono();

/**
 * Neither handler can post synchronously: the watchlist takes two vendor calls
 * spaced a couple of minutes apart, far past the 30 second handler limit. Both
 * kick off pass A, book pass B, and say when to look.
 */

/** "Post today's charts" - normal trigger, obeys the duplicate guard. */
menu.post('/post-create', async (c) => {
  try {
    await triggerManualRun(false);
    return c.json<UiResponse>(
      {
        showToast:
          'Fetching prices. If there is a session we have not posted yet, it will appear in a couple of minutes.',
      },
      200
    );
  } catch (error) {
    console.error(`Manual trigger failed: ${error}`);
    return c.json<UiResponse>(
      {
        showToast: `Failed: ${error instanceof Error ? error.message : error}`,
      },
      400
    );
  }
});

/**
 * "Re-post latest session (force)" - republishes even if already posted.
 *
 * Deliberately a separate item rather than a flag on the one above, so the
 * everyday action stays incapable of creating duplicates. This one is for
 * checking a rendering change without waiting for the next trading session,
 * which over a weekend can be three days away.
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
