import { useEffect, useRef, useState } from 'react';
import type { ChartsResponse, ErrorResponse } from '../shared/api';
import type { ChartsPayload, PanelRender } from '../shared/charts';

type State =
  | { kind: 'loading' }
  | { kind: 'ready'; charts: ChartsPayload }
  | { kind: 'error'; message: string };

/**
 * Only the plot is injected as markup, and it is safe: every byte comes from
 * our own plotSvg, built from numbers, with no interpolated text at all. The
 * labels are React text, so names go through normal escaping.
 */
const Plot = ({ svg }: { svg: string }) => (
  <div className="absolute inset-0" dangerouslySetInnerHTML={{ __html: svg }} />
);

const Panel = ({
  panel,
  big,
  compact,
}: {
  panel: PanelRender;
  big?: boolean;
  compact: boolean;
}) => {
  const titleSize = big
    ? compact
      ? 'text-base'
      : 'text-2xl'
    : compact
      ? 'text-[11px]'
      : 'text-sm';
  const statSize = big
    ? compact
      ? 'text-base'
      : 'text-2xl'
    : compact
      ? 'text-[12px]'
      : 'text-base';

  /**
   * Both readouts sit on top of the plot, so they need to survive whatever is
   * behind them. They were previously drawn in the up/down colour, which put
   * green on a green gradient and red on a red one - the worst possible
   * contrast, and the colour carried no information the sign and the line were
   * not already giving. White plus a dark shadow reads on any background.
   */
  const overlay = 'text-[#e6edf3] font-bold';
  const shadow = { textShadow: '0 1px 4px rgba(0,0,0,0.95)' };

  // A quarter-width panel on a phone is about 90px. "Berkshire Hathaway" does
  // not fit there; "BRK.B" always does.
  const label = !big && compact ? panel.ticker : panel.name;

  return (
    // h-full matters: grid children stretch on their own, but the index panel
    // sits in a plain block wrapper, where without it the panel collapses to
    // its title and the plot is handed zero height.
    <div className="flex flex-col h-full min-h-0 min-w-0">
      <div className="flex items-baseline justify-between gap-1 shrink-0 min-w-0">
        <span className={`font-bold text-[#e6edf3] truncate ${titleSize}`}>
          {label}
        </span>
        {!compact && (
          <span
            className={`text-[#8b949e] shrink-0 ${big ? 'text-sm' : 'text-[10px]'}`}
          >
            {panel.ticker}
          </span>
        )}
      </div>

      <div className="relative flex-1 min-h-0 w-full rounded bg-[#161b22] overflow-hidden">
        {panel.hasData ? (
          <>
            <Plot svg={panel.svg} />
            <span
              className={`absolute top-0.5 right-1.5 ${overlay} ${statSize}`}
              style={shadow}
            >
              {panel.pctLabel}
            </span>
            <span
              className={`absolute bottom-0.5 right-1.5 ${overlay} ${statSize}`}
              style={shadow}
            >
              {panel.lastLabel}
            </span>
          </>
        ) : (
          <span className="absolute inset-0 flex items-center justify-center text-[#8b949e] text-[10px]">
            no data
          </span>
        )}
      </div>
    </div>
  );
};

/**
 * Fills the post container exactly - never scrolls, never clips.
 *
 * Three things had to be learned the hard way here.
 *
 * One: a single fixed-size SVG always fitted, because a viewBox scales to its
 * box, but it shrank every label until it was unreadable on a phone.
 *
 * Two: a natural HTML grid made the text readable and then overflowed, so the
 * bottom rows were clipped on mobile and needed scrolling on desktop. The
 * container has a fixed height and a variable width, so the layout has to be
 * driven by height: a flex column with `min-h-0` throughout, where panels take
 * the height they are given instead of asking for an aspect ratio.
 *
 * Three: CSS media queries are not reliable here. On a 1000px-wide desktop
 * post the `md:` breakpoint never fired, so the grid stayed at two columns and
 * overflowed. The iframe does not report the viewport width you would expect,
 * so the element measures itself with a ResizeObserver instead.
 *
 * The grid stays 4 x 2 at every size. Dropping to fewer columns when narrow -
 * the usual responsive reflex - adds rows, which is exactly wrong when height
 * is the scarce dimension.
 */
export const ChartView = () => {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [compact, setCompact] = useState(true);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setCompact(w < 520);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [state.kind]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const load = async () => {
      try {
        const res = await fetch('/api/charts');
        const data = (await res.json()) as ChartsResponse | ErrorResponse;
        if (cancelled) return;

        if (!res.ok || !('charts' in data)) {
          setState({
            kind: 'error',
            message: 'message' in data ? data.message : 'Could not load charts',
          });
          return;
        }
        setState({ kind: 'ready', charts: data.charts });

        /*
         * Poll only while the session is still running. The payload itself
         * says so, so a sealed post stops asking the moment it is sealed -
         * including the post open in front of you when the close happens.
         *
         * This hits our own server, which serves whatever the scheduled passes
         * last wrote. It never triggers a vendor call, so the number of
         * viewers has no effect on the API allowance.
         */
        if (data.charts.live) timer = setTimeout(() => void load(), 60_000);
      } catch (error) {
        if (!cancelled) {
          setState({
            kind: 'error',
            message: error instanceof Error ? error.message : 'Network error',
          });
        }
      }
    };

    void load();

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (state.kind !== 'ready') {
    return (
      <div
        ref={rootRef}
        className="flex items-center justify-center h-full bg-[#0d1117] text-[#8b949e] text-sm px-4 text-center"
      >
        {state.kind === 'loading' ? 'Loading charts...' : state.message}
      </div>
    );
  }

  const { charts } = state;

  return (
    <div
      ref={rootRef}
      className={`h-full w-full bg-[#0d1117] text-[#e6edf3] flex flex-col overflow-hidden ${compact ? 'p-2' : 'p-4'}`}
    >
      <header className={`shrink-0 ${compact ? 'mb-1.5' : 'mb-3'}`}>
        <div className="flex items-baseline justify-between gap-2 min-w-0">
          <h1
            className={`font-bold tracking-wide shrink-0 ${compact ? 'text-lg' : 'text-3xl'}`}
          >
            THE MOAT
          </h1>
          <span
            className={`font-bold truncate ${compact ? 'text-[11px]' : 'text-base'}`}
          >
            {charts.dateLabel}
          </span>
        </div>
        {/* First thing sacrificed when vertical space is tight: it explains
            the chart, but the chart is legible without it. */}
        {!compact && (
          <p className="text-xs text-[#8b949e] mt-0.5 truncate">
            {charts.rangeLabel}
          </p>
        )}
      </header>

      <div
        className={`flex-1 min-h-0 flex flex-col ${compact ? 'gap-1.5' : 'gap-3'}`}
      >
        <div className="flex-[3] min-h-0">
          <Panel panel={charts.index} big compact={compact} />
        </div>

        <div
          className={`flex-[4] min-h-0 grid grid-cols-4 grid-rows-2 ${compact ? 'gap-1.5' : 'gap-x-3 gap-y-2'}`}
        >
          {charts.panels.map((p) => (
            <Panel key={p.ticker} panel={p} compact={compact} />
          ))}
        </div>
      </div>

      <p
        className={`shrink-0 text-[#8b949e] ${compact ? 'text-[9px] mt-1' : 'text-xs mt-2'}`}
      >
        Not investment advice.
      </p>
    </div>
  );
};
