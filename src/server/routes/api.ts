import { Hono } from 'hono';
import { context, redis } from '@devvit/web/server';
import type { ChartsResponse, ErrorResponse } from '../../shared/api';
import type { ChartsPayload } from '../../shared/charts';
import { chartsKey } from '../core/daily';

export const api = new Hono();

/**
 * Hand the webview the chart payload built when the post was created.
 *
 * The figures are deliberately frozen at post time rather than re-fetched on
 * view: the post is a record of one session's close, every viewer should see
 * identical numbers, and re-fetching per viewer would burn the daily quota.
 */
api.get('/charts', async (c) => {
  const { postId } = context;

  if (!postId) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'postId missing from context' },
      400
    );
  }

  const stored = await redis.get(chartsKey(postId));

  if (!stored) {
    return c.json<ErrorResponse>(
      { status: 'error', message: 'No chart stored for this post' },
      404
    );
  }

  return c.json<ChartsResponse>({
    type: 'charts',
    postId,
    charts: JSON.parse(stored) as ChartsPayload,
  });
});
