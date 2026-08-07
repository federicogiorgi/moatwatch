import { Hono } from 'hono';
import type { TaskRequest, TaskResponse } from '@devvit/web/server';
import { runPass, scheduleNextPass } from '../core/daily';
import { isWithinIntradayWindow } from '../../shared/clock';
import { CHUNKS, FINAL_PASS } from '../../shared/watchlist';

export const scheduler = new Hono();

type PassData = {
  index?: number;
  force?: boolean;
  chain?: boolean;
  marketHoursOnly?: boolean;
};

/**
 * One endpoint for every pass. Which chunk to fetch arrives as task data:
 * the cron entries in devvit.json each carry a fixed index, and the manual
 * chain passes its own index along as it goes.
 *
 * Always returns 200. A non-2xx just makes the platform retry a job that
 * would fail the same way, and a retried chunk burns more of the daily API
 * allowance. Failures go to the log - watch them with `npx devvit logs`.
 */
scheduler.post('/daily-charts-pass', async (c) => {
  let data: PassData = {};
  try {
    const body = await c.req.json<TaskRequest<PassData>>().catch(() => null);
    data = body?.data ?? {};

    const index = typeof data.index === 'number' ? data.index : 0;
    const force = data.force === true;

    if (index < 0 || index >= CHUNKS.length) {
      console.error(`Ignoring pass with out-of-range index ${index}.`);
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    // The cron runs on UTC hours wider than the trading day, so the real New
    // York clock is checked here before a single API call is spent. The window
    // runs 30 minutes past the close so the pass that seals the post is inside
    // it. Evening passes omit this flag: catching a late-published session is
    // their entire job.
    if (data.marketHoursOnly === true && !isWithinIntradayWindow()) {
      return c.json<TaskResponse>({ status: 'ok' }, 200);
    }

    const result = await runPass(index, force);

    // Only a manually started chain books its own successor; cron passes are
    // scheduled independently and must not chain, or they would double up.
    if (data.chain === true && index < FINAL_PASS) {
      await scheduleNextPass(index + 1, force);
    }

    if (index === FINAL_PASS && !result) {
      console.log('Daily charts: nothing new to post.');
    }
  } catch (error) {
    console.error(`Daily charts pass ${data.index ?? '?'} failed: ${error}`);
  }
  return c.json<TaskResponse>({ status: 'ok' }, 200);
});
