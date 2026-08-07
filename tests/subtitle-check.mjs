// Checks the subtitle says the right thing in both states.
import { renderCharts } from '../src/shared/charts.ts';
import { ORDER, NAMES } from '../src/shared/watchlist.ts';

let fail = 0;
const ok = (label, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}\n        got:  ${got}\n        want: ${want}`);
};

const series = {};
ORDER.forEach((s, i) => {
  const pts = [];
  let v = 100 + i * 5;
  for (let m = 0; m < 78; m++) {
    const hh = String(9 + Math.floor((30 + m * 5) / 60)).padStart(2, '0');
    const mm = String((30 + m * 5) % 60).padStart(2, '0');
    v *= 1 + Math.sin(m * (i + 1) * 0.21) * 0.002;
    pts.push({ d: `${hh}:${mm}`, c: Math.round(v * 100) / 100 });
  }
  series[s] = { name: NAMES[s] ?? s, points: pts, session: '2026-07-31', prevClose: 100 + i * 5 };
});

console.log('closed (what it does today):');
ok(
  'subtitle',
  renderCharts(series, ORDER, { sessionLabel: '31 July 2026', live: false }).rangeLabel,
  'Prices at close, 31 July 2026'
);

console.log('\nlive (once a same-day provider is approved):');
ok(
  'subtitle',
  renderCharts(series, ORDER, { sessionLabel: '31 July 2026', live: true }).rangeLabel,
  'Live prices, updated every 5 minutes'
);

console.log('\nno data:');
const empty = {};
ORDER.forEach((s) => {
  empty[s] = { name: s, points: [], session: '', prevClose: 0 };
});
ok('subtitle', renderCharts(empty, ORDER, { sessionLabel: 'x', live: false }).rangeLabel, 'no data');

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} FAILED`);
process.exit(fail === 0 ? 0 : 1);

