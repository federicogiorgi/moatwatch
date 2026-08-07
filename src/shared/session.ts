/**
 * session.ts - turning raw vendor bars into one trading session.
 *
 * Pure: no network, no Devvit, no value imports. It lives beside the renderer
 * rather than beside the fetch code so it can be exercised directly, which
 * matters because this is where the subtle mistakes are - timezone handling
 * and the previous close that every percentage on the page depends on.
 */

import type { Point } from './charts';

/** US regular trading hours, Eastern. */
export const SESSION_OPEN = '09:30';
export const SESSION_CLOSE = '16:00';

export type Bar = { t?: number; c?: number };

export type ParsedSession = {
  session: string;
  points: Point[];
  prevClose: number;
};

/**
 * Bars carry a UTC millisecond timestamp, but sessions are defined in US
 * Eastern, which shifts with daylight saving. Formatting through the runtime's
 * own tz database is the only way to get this right in both halves of the
 * year - the same trap that makes a fixed UTC cron wrong.
 */
const ET = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

export function toEastern(ms: number): { date: string; time: string } {
  const p = ET.formatToParts(new Date(ms));
  const get = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  };
}

const byTime = (a: Point, b: Point) => (a.d < b.d ? -1 : a.d > b.d ? 1 : 0);

/** A bar already expressed in New York wall-clock terms. */
export type EasternRow = { date: string; time: string; c: number };

/**
 * Reduce bars to the most recent session plus the prior close.
 *
 * This is the part worth sharing between data vendors: the grouping, the
 * regular-hours filter, and the previous close that every percentage on the
 * page depends on. Vendors differ only in how they express a timestamp, so
 * they each convert to EasternRow and hand it here.
 *
 * Extended-hours bars are dropped: a pre-market print on thin volume would
 * stretch the vertical scale and bury the real session in a corner.
 *
 * Returns null unless there are two distinct sessions, because without the
 * previous close there is no honest way to state the change on the day.
 */
export function sessionsFromEastern(
  rows: readonly EasternRow[]
): ParsedSession | null {
  const byDate = new Map<string, Point[]>();
  for (const row of rows) {
    const c = Number(row?.c);
    if (!Number.isFinite(c) || c <= 0) continue;
    if (!row.date || !row.time) continue;
    if (row.time < SESSION_OPEN || row.time >= SESSION_CLOSE) continue;

    const list = byDate.get(row.date);
    if (list) list.push({ d: row.time, c });
    else byDate.set(row.date, [{ d: row.time, c }]);
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length < 2) return null;

  const session = dates[dates.length - 1]!;
  const prevDate = dates[dates.length - 2]!;

  const points = (byDate.get(session) ?? []).sort(byTime);
  const prevClose = (byDate.get(prevDate) ?? []).sort(byTime).at(-1)?.c;

  // One bar is enough to draw. The renderer prepends the previous close
  // before plotting, so a single point still yields a two-vertex line.
  // Requiring two bars here meant that at 09:30, when exactly one five-minute
  // bar exists, every symbol in the first chunk was rejected and rendered as
  // an empty "no data" panel for the opening minutes - including the S&P 500.
  // charts.ts carries the matching guard; the two have to agree.
  if (!prevClose || points.length < 1) return null;
  return { session, points, prevClose };
}

/** Bars carrying a UTC millisecond timestamp (Polygon's shape). */
export function parseSessions(results: Bar[] | undefined): ParsedSession | null {
  if (!Array.isArray(results)) return null;
  const rows: EasternRow[] = [];
  for (const bar of results) {
    if (typeof bar?.t !== 'number') continue;
    const { date, time } = toEastern(bar.t);
    rows.push({ date, time, c: Number(bar?.c) });
  }
  return sessionsFromEastern(rows);
}
