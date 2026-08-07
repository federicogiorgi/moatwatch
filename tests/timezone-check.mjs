// Every case is stated as a real UTC instant, then checked against what the
// New York clock says at that instant. Summer and winter both, because that is
// where fixed-offset assumptions break.
import {
  isMarketOpen,
  isWithinIntradayWindow,
  todayEastern,
  isSessionComplete,
} from '../src/shared/clock.ts';

let fail = 0;
const nyc = (d) =>
  new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(d);

const check = (utcISO, wantOpen, wantWindow, note) => {
  const d = new Date(utcISO);
  const gotOpen = isMarketOpen(d);
  const gotWindow = isWithinIntradayWindow(d);
  const good = gotOpen === wantOpen && gotWindow === wantWindow;
  if (!good) fail++;
  console.log(
    `  ${good ? 'PASS' : 'FAIL'}  ${utcISO} = ${nyc(d).padEnd(16)} NY  ` +
    `open=${String(gotOpen).padEnd(5)} window=${String(gotWindow).padEnd(5)} ${note}`
  );
};

console.log('SUMMER (EDT, New York is UTC-4) - Mon 3 Aug 2026');
check('2026-08-03T13:00:00Z', false, false, '09:00 NY, before the bell');
check('2026-08-03T13:30:00Z', true,  true,  '09:30 NY, the open');
check('2026-08-03T17:00:00Z', true,  true,  '13:00 NY, midday');
check('2026-08-03T19:59:00Z', true,  true,  '15:59 NY, last minute');
check('2026-08-03T20:00:00Z', false, true,  '16:00 NY, the close - must still seal');
check('2026-08-03T20:25:00Z', false, true,  '16:25 NY, grace period');
check('2026-08-03T20:30:00Z', false, false, '16:30 NY, window shut');

console.log('\nWINTER (EST, New York is UTC-5) - Mon 5 Jan 2026');
check('2026-01-05T14:00:00Z', false, false, '09:00 NY, before the bell');
check('2026-01-05T14:30:00Z', true,  true,  '09:30 NY, the open');
check('2026-01-05T20:59:00Z', true,  true,  '15:59 NY, last minute');
check('2026-01-05T21:00:00Z', false, true,  '16:00 NY, the close - must still seal');
check('2026-01-05T21:30:00Z', false, false, '16:30 NY, window shut');

console.log('\nWEEKEND');
check('2026-08-01T17:00:00Z', false, false, 'Saturday 13:00 NY');
check('2026-08-02T17:00:00Z', false, false, 'Sunday 13:00 NY');

console.log('\nThe date rolls over on New York time, not UTC or Rome:');
const ok = (label, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}: ${got}${good ? '' : ` (want ${want})`}`);
};
// 02:00 UTC on the 4th is still the evening of the 3rd in New York, and it is
// already 04:00 in Rome on the 4th. The app must say the 3rd.
ok('2026-08-04T02:00Z -> New York date', todayEastern(new Date('2026-08-04T02:00:00Z')), '2026-08-03');
ok('2026-08-03T23:00Z -> New York date', todayEastern(new Date('2026-08-03T23:00:00Z')), '2026-08-03');
ok('2026-08-03T13:00Z -> New York date', todayEastern(new Date('2026-08-03T13:00:00Z')), '2026-08-03');

console.log('\nSession completeness is judged on New York time too:');
const during = new Date('2026-08-03T17:00:00Z'); // 13:00 NY, mid-session
ok(
  'partial session today is not complete',
  isSessionComplete('2026-08-03', [{ d: '12:55' }], during),
  false
);
ok(
  'session running to the bell is complete',
  isSessionComplete('2026-08-03', [{ d: '15:55' }], during),
  true
);
ok(
  'any earlier session is complete',
  isSessionComplete('2026-07-31', [{ d: '11:00' }], during),
  true
);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);

