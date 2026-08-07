/**
 * clock.ts - every time question this app asks.
 *
 * TIME ZONE POLICY - one rule, no exceptions.
 *
 * Every decision is made in NEW YORK time (America/New_York), resolved through
 * the runtime's own tz database so it is correct in both halves of the year.
 * Never write "EST" or "EDT" into logic: the market keeps the same local hours
 * all year while its offset from UTC moves by an hour, so any fixed offset is
 * wrong for months at a time. "New York time" is the only phrase that is
 * always true.
 *
 * The single unavoidable exception is `scheduler.tasks[].cron` in devvit.json,
 * which the platform evaluates in UTC. Those crons are therefore deliberately
 * wider than the trading day, and every handler re-checks the real New York
 * clock here before acting. Cron decides "might be worth looking"; this file
 * decides "actually do it".
 *
 * For reference, the cron window `13-21` UTC covers:
 *   summer, New York at UTC-4:  09:00-17:59 New York
 *   winter, New York at UTC-5:  08:00-16:59 New York
 * Both contain the 09:30-16:30 window below in full.
 *
 * Pure: no network, no Devvit, no value imports, so it can be tested directly.
 */

/** Regular US trading session, New York time. */
export const MARKET_OPEN_ET = '09:30';
export const MARKET_CLOSE_ET = '16:00';

/**
 * Close plus 30 minutes.
 *
 * The pass that SEALS the post has to run after the bell, so a gate asking
 * only "is the market open" would skip it and sealing would wait for the
 * evening pass - leaving a post advertising "Live prices" for up to 90 minutes
 * after trading stopped.
 */
export const INTRADAY_WINDOW_END_ET = '16:30';

/** Today's date in New York, "YYYY-MM-DD". */
export function todayEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

/** Clock time in New York, "HH:MM". */
export function nowEastern(now: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: 'America/New_York',
    hourCycle: 'h23',
    hour: '2-digit',
    minute: '2-digit',
  }).format(now);
}

/** Is it a weekday in New York? */
export function isWeekdayEastern(now: Date = new Date()): boolean {
  const day = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
  }).format(now);
  return day !== 'Sat' && day !== 'Sun';
}

/** Is the market in its regular session? 09:30-16:00 New York. */
export function isMarketOpen(now: Date = new Date()): boolean {
  if (!isWeekdayEastern(now)) return false;
  const t = nowEastern(now);
  return t >= MARKET_OPEN_ET && t < MARKET_CLOSE_ET;
}

/**
 * Should the intraday passes run?
 *
 * No holiday calendar needed: on a market holiday the vendor returns a session
 * already sealed, and the lifecycle decision skips it without posting.
 */
export function isWithinIntradayWindow(now: Date = new Date()): boolean {
  if (!isWeekdayEastern(now)) return false;
  const t = nowEastern(now);
  return t >= MARKET_OPEN_ET && t < INTRADAY_WINDOW_END_ET;
}

/**
 * Does a comment count towards the day's board?
 *
 * Voting closes with the market, at 16:00 New York. This is asked of the
 * comment's own timestamp rather than of the clock, because the pass that
 * seals the post runs up to half an hour after the bell: without this, a
 * comment posted at 16:12 could still change the panels on a session that had
 * already stopped trading.
 *
 * A comment from a day before the session counts - it cannot exist on a post
 * created that morning, but treating it as valid is the harmless direction.
 */
export function countsTowardBoard(
  session: string,
  createdAt: Date | number
): boolean {
  const when = typeof createdAt === 'number' ? new Date(createdAt) : createdAt;
  const date = todayEastern(when);
  if (date < session) return true;
  if (date > session) return false;
  return nowEastern(when) < MARKET_CLOSE_ET;
}

/**
 * Has this session finished trading?
 *
 * Asked of the data, not the clock. An earlier version asked "is it past 16:00
 * in New York right now?", which answered "market still open" at 4am on a
 * Saturday. A session dated before today in New York is finished by
 * definition, which also covers half-day holidays closing at 13:00.
 */
export function isSessionComplete(
  session: string,
  points: readonly { d: string }[],
  now: Date = new Date()
): boolean {
  if (session < todayEastern(now)) return true;
  return (points.at(-1)?.d ?? '') >= '15:55';
}
