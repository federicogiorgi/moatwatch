// Verifies session parsing, the previous-trading-day reference across
// weekends and holidays, the gap fix, and that plots are built to stretch.
import {
  renderCharts,
  dayChangePct,
} from '../src/shared/charts.ts';
import { applyOfficial, parseSessions } from '../src/shared/session.ts';
import { toOfficial } from '../src/shared/yahoo.ts';
import { ORDER, NAMES } from '../src/shared/watchlist.ts';

let fail = 0;
const ok = (label, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}: got ${got}, want ${want}`);
};
// offset 4 = EDT (summer), 5 = EST (winter)
const et = (y, m, d, h, min, off) => Date.UTC(y, m, d, h + off, min);

console.log('1. session parsing + extended-hours exclusion (EDT)');
{
  const b = [
    { t: et(2026, 6, 29, 8, 0, 4), c: 999 },      // pre-market, drop
    { t: et(2026, 6, 29, 9, 30, 4), c: 330.0 },
    { t: et(2026, 6, 29, 15, 55, 4), c: 336.71 }, // previous close
    { t: et(2026, 6, 29, 17, 0, 4), c: 888 },     // after-hours, drop
    { t: et(2026, 6, 30, 9, 30, 4), c: 335.0 },
    { t: et(2026, 6, 30, 15, 55, 4), c: 333.66 },
  ];
  const p = parseSessions(b);
  ok('session date', p.session, '2026-07-30');
  ok('extended hours excluded', p.points.length, 2);
  ok('previous close', p.prevClose, 336.71);
  ok('pct (Yahoo: -0.906%)', dayChangePct(p).toFixed(2), '-0.91');
}

console.log('\n2. WEEKEND: Monday compares to Friday');
{
  const b = [
    { t: et(2026, 6, 24, 9, 30, 4), c: 300.0 },
    { t: et(2026, 6, 24, 15, 55, 4), c: 310.0 },
    { t: et(2026, 6, 27, 9, 30, 4), c: 312.0 },
    { t: et(2026, 6, 27, 15, 55, 4), c: 319.30 },
  ];
  const p = parseSessions(b);
  ok('session is Monday', p.session, '2026-07-27');
  ok('prevClose is Friday close', p.prevClose, 310);
  ok('pct vs Friday', dayChangePct(p).toFixed(2), '3.00');
}

console.log('\n3. HOLIDAY: Tue after MLK Monday compares to Friday (EST)');
{
  const b = [
    { t: et(2026, 0, 16, 9, 30, 5), c: 200.0 },
    { t: et(2026, 0, 16, 15, 55, 5), c: 250.0 },
    // Mon 19 Jan is MLK Day - no bars at all
    { t: et(2026, 0, 20, 9, 30, 5), c: 255.0 },
    { t: et(2026, 0, 20, 15, 55, 5), c: 262.50 },
  ];
  const p = parseSessions(b);
  ok('session is Tuesday', p.session, '2026-01-20');
  ok('prevClose is Friday (holiday skipped)', p.prevClose, 250);
  ok('pct vs Friday', dayChangePct(p).toFixed(2), '5.00');
}

// Build a full payload for the remaining checks.
//
// The gapped symbol is read from the watchlist rather than named, for the
// same reason the index is in check 4: editing the watchlist must not fail an
// unrelated assertion. Naming a ticker here once meant that removing it broke
// the whole suite with a TypeError.
const GAPPED = ORDER[1];
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
  // Give one symbol an overnight gap, as Apple had on 31 Jul.
  series[s] = {
    name: NAMES[s] ?? s,
    points: pts,
    session: '2026-07-31',
    prevClose: (100 + i * 5) * (s === GAPPED ? 1.09 : 1.0),
  };
});
const payload = renderCharts(series, ORDER, { dateLabel: 'Friday, 31 July 2026' });

console.log('\n4. payload shape');
{
  // Read from the watchlist rather than hardcoding, so swapping the index
  // instrument cannot fail an unrelated assertion.
  ok('index panel present', payload.index.ticker, ORDER[0]);
  ok('eight small panels', payload.panels.length, 8);
  ok('all panels have data', payload.panels.every((p) => p.hasData), true);
  ok('name is data, not baked into svg', payload.panels[0].name, NAMES[ORDER[1]]);
  ok('percent is a label', /^[+-]\d+\.\d{2}%$/.test(payload.panels[0].pctLabel), true);
}

console.log('\n5. plots are built to stretch (the responsive part)');
{
  const svg = payload.index.svg;
  ok('preserveAspectRatio=none', svg.includes('preserveAspectRatio="none"'), true);
  ok('stroke will not smear', svg.includes('vector-effect="non-scaling-stroke"'), true);
  ok('normalised viewBox', svg.includes('viewBox="0 0 1000 1000"'), true);
  // Must match the <svg> tag only: stroke-width="2" contains width="2".
  const svgTag = svg.match(/<svg[^>]*>/)[0];
  ok('svg tag has no fixed width', /\swidth="\d/.test(svgTag), false);
  ok('svg tag sizes from CSS', svgTag.includes('width:100%'), true);
  ok('no text baked into plot', svg.includes('<text'), false);

  const ids = payload.panels.map((p) => p.svg.match(/id="(grad\d+)"/)?.[1]);
  ok('gradient ids unique across panels', new Set(ids).size, ids.length);
}

console.log('\n6. gap fix: line starts at the previous close');
{
  const gapped = payload.panels.find((p) => p.ticker === GAPPED);
  ok('gapped panel exists', Boolean(gapped), true);
  const baseline = Number(gapped.svg.match(/<line x1="0" y1="([\d.]+)"/)[1]);
  const first = Number(gapped.svg.match(/<polyline points="[\d.]+,([\d.]+)/)[1]);
  const second = Number(
    gapped.svg.match(/<polyline points="[\d.]+,[\d.]+ [\d.]+,([\d.]+)/)[1]
  );
  ok('starts on previous-close line', first.toFixed(1), baseline.toFixed(1));
  ok('drops away from it', second > baseline + 100, true);
}

console.log('\n7. opening minutes: a single bar still draws');
{
  // 09:30, one five-minute bar. This used to be rejected by matching guards in
  // session.ts and charts.ts, blanking the first chunk every morning.
  const one = parseSessions([
    { t: et(2026, 6, 30, 9, 30, 4), c: 100.0 },
    { t: et(2026, 6, 30, 15, 55, 4), c: 110.0 }, // previous close
    { t: et(2026, 6, 31, 9, 30, 4), c: 104.5 },  // the only bar so far today
  ]);
  ok('single-bar session parses', Boolean(one), true);
  ok('session is the new day', one.session, '2026-07-31');
  ok('one point held', one.points.length, 1);
  ok('prevClose is yesterday', one.prevClose, 110);

  const p = renderCharts({ [ORDER[0]]: { name: 'X', ...one } }, ORDER);
  ok('panel reports data', p.index.hasData, true);
  ok('percent is a label', /^[+-]\d+\.\d{2}%$/.test(p.index.pctLabel), true);
  // prevClose -> the single point: exactly two vertices.
  const verts = p.index.svg.match(/<polyline points="([^"]+)"/)[1].split(' ');
  ok('two vertices drawn', verts.length, 2);
  const baseline = Number(p.index.svg.match(/<line x1="0" y1="([\d.]+)"/)[1]);
  ok('starts on previous-close line', Number(verts[0].split(',')[1]).toFixed(1), baseline.toFixed(1));
}

console.log('\n8. official close replaces the sampled endpoints');
{
  const bars = [
    { t: et(2026, 6, 30, 9, 30, 4), c: 100.0 },
    { t: et(2026, 6, 30, 15, 55, 4), c: 110.0 }, // sampled "previous close"
    { t: et(2026, 6, 31, 9, 30, 4), c: 111.0 },
    { t: et(2026, 6, 31, 15, 55, 4), c: 120.0 }, // sampled "last"
  ];
  const sampled = parseSessions(bars);
  ok('sampled prevClose is the 15:55 bar', sampled.prevClose, 110);
  ok('sampled last is the 15:55 bar', sampled.points.at(-1).c, 120);

  // The official figures differ slightly, as they do in reality.
  const official = applyOfficial(sampled, {
    previousClose: 110.4,
    lastPrice: 120.75,
  });
  ok('prevClose becomes official', official.prevClose, 110.4);
  ok('last point becomes official', official.points.at(-1).c, 120.75);
  ok('last point is moved, not appended', official.points.length, sampled.points.length);
  // points[0] is this session's 09:30 bar; 100 belongs to the previous day.
  ok('earlier points untouched', official.points[0].c, 111);
  ok('pct uses both official ends', dayChangePct(official).toFixed(3), '9.375');

  // A partial or absent meta must degrade to the sampled values, never to NaN.
  const none = applyOfficial(sampled, {});
  ok('no meta -> sampled prevClose', none.prevClose, 110);
  ok('no meta -> sampled last', none.points.at(-1).c, 120);
  const half = applyOfficial(sampled, { previousClose: 110.4 });
  ok('partial meta -> official prev', half.prevClose, 110.4);
  ok('partial meta -> sampled last', half.points.at(-1).c, 120);
}

console.log('\n9. toOfficial reads the right fields');
{
  // chartPreviousClose is the close before the whole 5d range - NOT yesterday.
  // Picking it instead of previousClose is the trap this check exists to catch.
  const o = toOfficial([
    {
      meta: {
        previousClose: 312.41,
        regularMarketPrice: 312.23,
        chartPreviousClose: 308.91,
      },
    },
  ]);
  ok('previousClose, not chartPreviousClose', o.previousClose, 312.41);
  ok('lastPrice is regularMarketPrice', o.lastPrice, 312.23);

  const empty = toOfficial([{ meta: {} }]);
  ok('absent meta fields -> undefined', empty.previousClose, undefined);
  const zero = toOfficial([{ meta: { previousClose: 0, regularMarketPrice: -3 } }]);
  ok('zero is rejected', zero.previousClose, undefined);
  ok('negative is rejected', zero.lastPrice, undefined);
  ok('no result at all -> undefined', toOfficial(undefined).previousClose, undefined);
}

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);

