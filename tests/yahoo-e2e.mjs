// End-to-end against LIVE Yahoo data: fetch, parse sessions, render panels.
// Uses the app's own vendorSymbol/toBars/parseSessions/renderCharts.
import { vendorSymbol, toBars } from '../src/shared/yahoo.ts';
import { parseSessions } from '../src/shared/session.ts';
import { renderCharts, dayChangePct } from '../src/shared/charts.ts';
import { ORDER, NAMES } from '../src/shared/watchlist.ts';

let fail = 0;
const ok = (label, cond) => {
  if (!cond) fail++;
  console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${label}`);
};

const series = {};
console.log(`watchlist: ${ORDER.join(', ')}\n`);

for (const symbol of ORDER) {
  const url =
    `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(vendorSymbol(symbol))}` +
    `?range=5d&interval=5m&includePrePost=false`;
  try {
    const res = await fetch(url);
    const body = await res.json();
    if (body.chart?.error) throw new Error(body.chart.error.description);
    const parsed = parseSessions(toBars(body.chart?.result));
    if (!parsed) throw new Error('no complete session');
    series[symbol] = { name: NAMES[symbol] ?? symbol, ...parsed };
    const pct = dayChangePct(series[symbol]);
    console.log(
      `  ${symbol.padEnd(6)} -> ${vendorSymbol(symbol).padEnd(6)} ` +
      `session=${parsed.session} bars=${String(parsed.points.length).padStart(3)} ` +
      `${parsed.points[0].d}-${parsed.points.at(-1).d} ` +
      `prev=${parsed.prevClose.toFixed(2).padStart(9)} ` +
      `last=${parsed.points.at(-1).c.toFixed(2).padStart(9)} ` +
      `${pct >= 0 ? '+' : ''}${pct.toFixed(2)}%`
    );
  } catch (e) {
    console.log(`  ${symbol.padEnd(6)} FAILED: ${e.message}`);
    fail++;
  }
  await new Promise((r) => setTimeout(r, 300));
}

// Every check below tolerates a missing symbol. A failed fetch must show up as
// one FAIL and let the rest of the suite run: this script is the thing you
// reach for WHEN something is broken, so crashing on the first absent symbol
// hides exactly the report you came for. It used to do that - `series[s].points`
// threw a TypeError and killed the run before the render checks ever ran.
console.log('\nchecks:');
const present = ORDER.filter((s) => series[s]);

ok('every symbol returned data', Object.keys(series).length === ORDER.length);
// One bar is legitimate in the opening minutes - session.ts and charts.ts both
// draw it. Asserting more than two here reported a failure every morning.
ok('all panels have points', present.length > 0 && present.every((s) => series[s].points.length >= 1));
ok('all agree on one session', new Set(present.map((s) => series[s].session)).size === 1);
ok('bars are inside regular hours', present.length > 0 && present.every((s) => {
  const p = series[s].points;
  return p.length > 0 && p[0].d >= '09:30' && p.at(-1).d < '16:00';
}));
ok('every prevClose is positive', present.length > 0 && present.every((s) => series[s].prevClose > 0));

const payload = renderCharts(series, ORDER, {
  sessionLabel: 'test',
  live: false,
});
ok('index panel rendered', payload.index.hasData);
ok('eight small panels rendered', payload.panels.length === 8 && payload.panels.every((p) => p.hasData));
ok('plots are stretchable', payload.index.svg.includes('preserveAspectRatio="none"'));

console.log(`\nsession: ${series[ORDER[0]]?.session ?? 'none'}`);
console.log(fail === 0 ? 'ALL CHECKS PASSED' : `${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

