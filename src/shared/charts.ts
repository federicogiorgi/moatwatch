/**
 * charts.ts - turns one trading session into the pieces a responsive layout
 * needs: numbers as data, and each plot as a stretchable SVG.
 *
 * Dependency-free on purpose: no DOM, no Devvit, no charting library.
 *
 * This used to emit a single 1200x1000 SVG with every label baked in. That
 * renders identically everywhere, which is the problem - on a phone the whole
 * landscape grid was letterboxed into a short, narrow box and the text became
 * unreadable. Nothing inside a monolithic SVG can reflow.
 *
 * So the text is no longer drawn here. Each panel returns its numbers as
 * strings and its plot as a small SVG with a normalised viewBox and
 * `preserveAspectRatio="none"`, so the client can stretch it to any box CSS
 * gives it. Strokes carry `vector-effect="non-scaling-stroke"` so stretching
 * does not smear the line into a wedge.
 *
 * Each panel plots ONE session, starting at the previous close so an overnight
 * gap shows as a drop rather than vanishing.
 */

export type Point = {
  /** Clock time in US Eastern, "HH:MM". */
  d: string;
  c: number;
};

export type Series = {
  name: string;
  /** Regular-hours points for the session, oldest -> newest. */
  points: Point[];
  /** Session date, "YYYY-MM-DD". */
  session: string;
  /** Previous session's close - the reference for the day's move. */
  prevClose: number;
};

export type SeriesMap = Record<string, Series>;

export type ChartMeta = {
  /** Long form for the header, e.g. "Friday, 31 July 2026". */
  dateLabel?: string;
  /** Short form for the subtitle, e.g. "31 July 2026". */
  sessionLabel?: string;
  /**
   * True only when these figures are a session still being traded.
   *
   * Decided from the data, never assumed: a frozen record of a finished
   * session must not describe itself as live. See buildMeta in daily.ts.
   */
  live?: boolean;
};

/** One panel, ready to lay out. */
export type PanelRender = {
  ticker: string;
  name: string;
  /** Empty when there is no usable data for this symbol. */
  lastLabel: string;
  pctLabel: string;
  up: boolean;
  hasData: boolean;
  /** Standalone, stretchable plot. Empty string when hasData is false. */
  svg: string;
};

export type ChartsPayload = {
  dateLabel: string;
  rangeLabel: string;
  /** The client polls for updates only while this is true. */
  live: boolean;
  index: PanelRender;
  panels: PanelRender[];
};

export const COLORS = {
  bg: '#0d1117',
  panel: '#161b22',
  fg: '#e6edf3',
  muted: '#8b949e',
  grid: '#262d38',
  up: '#2ea043',
  down: '#e5534b',
};

/** Normalised plot space. The client scales this to whatever box it has. */
const VB = 1000;

const fmt = (n: number, dp = 2): string =>
  n.toLocaleString('en-US', {
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });

const sign = (n: number, dp = 2): string => (n >= 0 ? '+' : '') + fmt(n, dp);

/**
 * The day's move, in percent, against the previous session's close.
 *
 * Previous close rather than the opening price: that is what "up 2% today"
 * means everywhere else, and it is the only definition that counts an
 * overnight gap as part of the day.
 */
export function dayChangePct(series: Partial<Series>): number {
  const last = series.points?.at(-1)?.c;
  const prev = series.prevClose;
  if (!last || !prev || prev <= 0) return NaN;
  return (last / prev - 1) * 100;
}

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return h;
}

/**
 * The plot for one session, in normalised coordinates.
 *
 * The previous close is forced into the vertical range so the dashed
 * reference is always visible, even on a day that gapped and never traded
 * back through it.
 */
function plotSvg(
  points: Point[],
  prevClose: number,
  up: boolean,
  gradientId: string
): string {
  const plot: Point[] = [{ d: 'prev', c: prevClose }, ...points];
  const vals = plot.map((p) => p.c);
  const lo = Math.min(...vals, prevClose);
  const hi = Math.max(...vals, prevClose);
  const span = hi - lo || 1;
  const pad = span * 0.08;
  const min = lo - pad;
  const range = hi + pad - min;

  const sx = (i: number) =>
    plot.length === 1 ? VB / 2 : (i / (plot.length - 1)) * VB;
  const sy = (v: number) => VB - ((v - min) / range) * VB;

  const line = plot
    .map((p, i) => `${sx(i).toFixed(1)},${sy(p.c).toFixed(1)}`)
    .join(' ');
  const area = `0,${VB} ${line} ${VB},${VB}`;
  const baseline = sy(prevClose).toFixed(1);
  const col = up ? COLORS.up : COLORS.down;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VB} ${VB}" preserveAspectRatio="none" style="width:100%;height:100%;display:block">
  <defs>
    <linearGradient id="${gradientId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${col}" stop-opacity="0.28"/>
      <stop offset="100%" stop-color="${col}" stop-opacity="0.02"/>
    </linearGradient>
  </defs>
  <polygon points="${area}" fill="url(#${gradientId})"/>
  <line x1="0" y1="${baseline}" x2="${VB}" y2="${baseline}" stroke="${COLORS.muted}"
    stroke-width="1" stroke-dasharray="6 6" opacity="0.55" vector-effect="non-scaling-stroke"/>
  <polyline points="${line}" fill="none" stroke="${col}" stroke-width="2"
    stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/>
</svg>`;
}

function renderPanel(ticker: string, series: Partial<Series>): PanelRender {
  const { points, name, prevClose } = series;

  if (!points || points.length < 2 || !prevClose) {
    return {
      ticker,
      name: name ?? ticker,
      lastLabel: '',
      pctLabel: '',
      up: true,
      hasData: false,
      svg: '',
    };
  }

  const last = points[points.length - 1]!.c;
  const pct = dayChangePct(series);
  const up = pct >= 0;

  return {
    ticker,
    name: name ?? ticker,
    lastLabel: fmt(last),
    pctLabel: `${sign(pct)}%`,
    up,
    hasData: true,
    // Gradient ids share one HTML document once the client mounts several of
    // these, so they have to be unique per ticker rather than per SVG.
    svg: plotSvg(points, prevClose, up, `grad${Math.abs(hash(ticker))}`),
  };
}

/**
 * @param series keyed by ticker
 * @param order  [indexTicker, ...stock tickers]
 */
export function renderCharts(
  series: SeriesMap,
  order: readonly string[],
  meta: ChartMeta = {}
): ChartsPayload {
  const [idxTicker, ...rest] = order;

  const hasData = order.some((t) => (series[t]?.points.length ?? 0) > 0);

  // Say plainly whether these numbers are still moving. The previous wording
  // ("Previous close, then intraday 09:30 to 15:55 ET") described the axis
  // accurately but read as though the chart were updating, which it is not.
  let rangeLabel = 'no data';
  if (hasData) {
    rangeLabel = meta.live
      ? 'Live prices, updated every 5 minutes'
      : `Prices at close, ${meta.sessionLabel ?? ''}`.trim().replace(/,$/, '');
  }

  return {
    dateLabel: meta.dateLabel ?? '',
    rangeLabel,
    live: hasData && meta.live === true,
    index: renderPanel(idxTicker!, series[idxTicker!] ?? {}),
    panels: rest.map((t) => renderPanel(t, series[t] ?? {})),
  };
}
