import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { runPass } from '../core/daily';
import { isWithinIntradayWindow } from '../../shared/clock';

export const scheduler = new Hono();

type PassData = {
  force?: boolean;
  marketHoursOnly?: boolean;
};

/**
 * One endpoint for every pass. A pass fetches the whole watchlist and acts on
 * it, so there is no chunk index to carry and no chain to continue.
 *
 * Always returns 200. A non-2xx just makes the platform retry a job that would
 * fail the same way, and a retried pass spends the vendor's goodwill twice.
 * Failures go to the log - watch them with `npx devvit logs`.
 */
scheduler.post('/daily-charts-pass', async (c) => {
  try {
    const body = await c.req.json<TaskRequest<PassData>>().catch(() => null);
    const data: PassData = body?.data ?? {};

    // The cron runs on UTC hours wider than the trading day, so the real New
    // York clock is checked here before a single API call is spent. The window
    // runs 30 minutes past the close so the pass that seals the post is inside
    // it. Evening passes omit this flag: catching a late-published session is
    // their entire job.
    if (data.marketHoursOnly === true && !isWithinIntradayWindow()) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const result = await runPass(data.force === true);
    if (!result) console.log('Daily charts: nothing new to post.');
  } catch (error) {
    console.error(`Daily charts pass failed: ${error}`);
  }
  return c.json<TaskResponse>({ status: 'ok' }, 200);
});
