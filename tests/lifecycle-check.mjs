// Walks the post through a whole trading day, then checks the awkward cases.
import { decideAction } from '../src/shared/lifecycle.ts';
import { renderCharts } from '../src/shared/charts.ts';
import { ORDER, NAMES } from '../src/shared/watchlist.ts';

let fail = 0;
const ok = (label, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}: ${got}${good ? '' : ` (want ${want})`}`);
};

const TODAY = '2026-08-03'; // a Monday

// ---------------------------------------------------------------- a full day
console.log('A full trading day, simulated:');
let livePost = null;
let finalized = null;
const say = (label, input) => {
  const a = decideAction(input);
  // Apply the action, the way reconcile() would.
  if (a.kind === 'create-live') livePost = { session: input.session, postId: 't3_abc' };
  if (a.kind === 'create-final') {
    livePost = { session: input.session, postId: 't3_abc' };
    finalized = input.session;
  }
  if (a.kind === 'finalize') finalized = input.session;
  console.log(`  ${label.padEnd(34)} -> ${a.kind}`);
  return a.kind;
};

ok(
  '09:35 first pass of the day',
  say('09:35 market open, no post yet', {
    session: TODAY, sessionComplete: false, isToday: true, livePost, finalizedSession: finalized,
  }),
  'create-live'
);
ok(
  '09:40 five minutes later',
  say('09:40 market open, post exists', {
    session: TODAY, sessionComplete: false, isToday: true, livePost, finalizedSession: finalized,
  }),
  'update-live'
);
ok(
  '15:30 still running',
  say('15:30 market open', {
    session: TODAY, sessionComplete: false, isToday: true, livePost, finalizedSession: finalized,
  }),
  'update-live'
);
ok(
  '16:05 close - seal it',
  say('16:05 session complete', {
    session: TODAY, sessionComplete: true, isToday: true, livePost, finalizedSession: finalized,
  }),
  'finalize'
);
ok(
  '16:10 a later pass must not touch it',
  say('16:10 after sealing', {
    session: TODAY, sessionComplete: true, isToday: true, livePost, finalizedSession: finalized,
  }),
  'skip'
);
ok(
  '21:30 evening fallback must not touch it',
  say('21:30 evening pass', {
    session: TODAY, sessionComplete: true, isToday: false, livePost, finalizedSession: finalized,
  }),
  'skip'
);
ok(
  '01:30 overnight retry must not touch it',
  say('01:30 overnight retry', {
    session: TODAY, sessionComplete: true, isToday: false, livePost, finalizedSession: finalized,
  }),
  'skip'
);

// -------------------------------------------------------------- awkward cases
console.log('\nAwkward cases:');
ok(
  'weekend: vendor returns Fridays session, already sealed',
  decideAction({
    session: TODAY, sessionComplete: true, isToday: false,
    livePost: { session: TODAY, postId: 't3_abc' }, finalizedSession: TODAY,
  }).kind,
  'skip'
);
ok(
  'app was asleep all day: post it closed, once',
  decideAction({
    session: TODAY, sessionComplete: true, isToday: false,
    livePost: null, finalizedSession: null,
  }).kind,
  'create-final'
);
ok(
  'new day: yesterdays post is not reused',
  decideAction({
    session: '2026-08-04', sessionComplete: false, isToday: true,
    livePost: { session: TODAY, postId: 't3_abc' }, finalizedSession: TODAY,
  }).kind,
  'create-live'
);
ok(
  'stale vendor: unfinished session that is not today is refused',
  decideAction({
    session: '2026-07-31', sessionComplete: false, isToday: false,
    livePost: null, finalizedSession: null,
  }).kind,
  'skip'
);
ok(
  'no data at all',
  decideAction({
    session: '', sessionComplete: false, isToday: false,
    livePost: null, finalizedSession: null,
  }).kind,
  'skip'
);

// ------------------------------------------------------------- payload wiring
console.log('\nSubtitle and polling flag:');
const series = {};
ORDER.forEach((s, i) => {
  const pts = [];
  let v = 100 + i * 5;
  for (let m = 0; m < 40; m++) {
    v *= 1.001;
    pts.push({ d: `1${String(m).padStart(1, '0')}:00`.slice(0, 5), c: v });
  }
  series[s] = { name: NAMES[s] ?? s, points: pts, session: TODAY, prevClose: 100 + i * 5 };
});
const liveP = renderCharts(series, ORDER, { sessionLabel: '3 August 2026', live: true });
const doneP = renderCharts(series, ORDER, { sessionLabel: '3 August 2026', live: false });
ok('live subtitle', liveP.rangeLabel, 'Live prices, updated every 5 minutes');
ok('live flag drives polling', liveP.live, true);
ok('closed subtitle', doneP.rangeLabel, 'Prices at close, 3 August 2026');
ok('closed post stops polling', doneP.live, false);

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);

