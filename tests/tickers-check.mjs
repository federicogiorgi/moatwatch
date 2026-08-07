// The contestable board: parsing nominations out of comments, counting votes,
// and deciding which eight symbols hold the panels.
import {
  parseMentions,
  tallyVotes,
  rankBoard,
  unknownSymbols,
  BASELINE_VOTE,
} from '../src/shared/tickers.ts';
import {
  countsTowardBoard,
  closeTimesElsewhere,
  easternInstant,
} from '../src/shared/clock.ts';

let fail = 0;
const ok = (label, got, want) => {
  const good = String(got) === String(want);
  if (!good) fail++;
  console.log(`  ${good ? 'PASS' : 'FAIL'}  ${label}: got ${got}, want ${want}`);
};

// The owner's eight, as in watchlist.ts. The index is not contestable and
// never takes part.
const DEFAULTS = ['GOOGL', 'BRK.B', 'CVX', 'KO', 'MCD', 'PG', 'SPCX', 'SYM'];
const all = () => true;

console.log('1. a nomination needs the dollar sign and capitals');
{
  ok('$GOOGL counts', parseMentions('buying $GOOGL today').join(), 'GOOGL');
  ok('bare GOOGL does not', parseMentions('buying GOOGL today').length, 0);
  ok('$googl does not', parseMentions('buying $googl today').length, 0);
  ok('$Googl does not', parseMentions('buying $Googl today').length, 0);
  ok('Google does not', parseMentions('buying Google today').length, 0);
  ok('goo does not', parseMentions('buying goo today').length, 0);
  ok('share class $BRK.B counts', parseMentions('$BRK.B is cheap').join(), 'BRK.B');
  ok('several in one comment', parseMentions('$KO and $PG and $MCD').join(), 'KO,PG,MCD');
  ok('repeats are kept', parseMentions('$KO $KO $KO').length, 3);
  ok('start of string', parseMentions('$SYM to the moon').join(), 'SYM');
  ok('punctuation after', parseMentions('I like $CVX, honestly.').join(), 'CVX');
  ok('inside parentheses', parseMentions('($MCD)').join(), 'MCD');
  ok('empty text', parseMentions('').length, 0);
  // Ending a sentence is the common case, and an earlier lookahead ate it.
  ok('sentence-final $SYM.', parseMentions('all in on $SYM.').join(), 'SYM');
  ok('sentence-final $BRK.B.', parseMentions('I hold $BRK.B.').join(), 'BRK.B');
  ok('$KO! and $PG?', parseMentions('$KO! or $PG?').join(), 'KO,PG');
  ok('newline after', parseMentions('$CVX\nand more').join(), 'CVX');
}

console.log('\n2. the false-positive trap that made the sigil mandatory');
{
  // Every one of these is a real listing. Without the dollar sign an ordinary
  // English sentence would rewrite the board.
  ok('I DID IT', parseMentions('I DID IT').length, 0);
  ok('ALL CAPS SHOUTING', parseMentions('THIS IS ALL SO KEY NOW').length, 0);
  ok('$GOOGLE is not $GOOGL', parseMentions('$GOOGLE').length, 0);
  ok('$TOOLONGX rejected', parseMentions('$TOOLONGX').length, 0);
  ok('bare $ alone', parseMentions('costs $ 5').length, 0);
  ok('$5 is not a ticker', parseMentions('it cost $5').length, 0);
}

console.log('\n3. votes: defaults open at half, each mention adds one');
{
  const v = tallyVotes([], DEFAULTS);
  ok('every default seeded', v.size, 8);
  ok('baseline is 0.5', v.get('KO'), BASELINE_VOTE);

  const v2 = tallyVotes(['$KO is great', 'more $KO'], DEFAULTS);
  ok('two mentions of a default', v2.get('KO'), 2.5);

  const v3 = tallyVotes(['$NVDA'], DEFAULTS);
  ok('newcomer starts from its mentions', v3.get('NVDA'), 1);
  ok('one mention beats an untouched default', v3.get('NVDA') > v3.get('KO'), true);
}

console.log('\n4. the board: one mention displaces a default, Z goes first');
{
  // Nothing said: the eight defaults hold, unchanged.
  const quiet = rankBoard(tallyVotes([], DEFAULTS), all);
  ok('quiet day keeps all eight', quiet.length, 8);
  ok('quiet day is the defaults', [...quiet].sort().join(), [...DEFAULTS].sort().join());

  // One newcomer: it takes exactly one slot, and the slot it takes is the
  // one held by the symbol latest in the alphabet - SYM.
  const one = rankBoard(tallyVotes(['$NVDA'], DEFAULTS), all);
  ok('still eight panels', one.length, 8);
  ok('newcomer is in', one.includes('NVDA'), true);
  ok('SYM is the one displaced', one.includes('SYM'), false);
  ok('SPCX survives', one.includes('SPCX'), true);

  // Two newcomers displace the last two alphabetically.
  const two = rankBoard(tallyVotes(['$NVDA $TSLA'], DEFAULTS), all);
  ok('both newcomers in', two.includes('NVDA') && two.includes('TSLA'), true);
  ok('SYM and SPCX both out', !two.includes('SYM') && !two.includes('SPCX'), true);

  // A default that gets talked about is safe even when eight others arrive.
  const loud = tallyVotes(['$SYM $SYM $A $B $C $D $E $F $G $H'], DEFAULTS);
  const board = rankBoard(loud, all);
  ok('a defended default holds its slot', board.includes('SYM'), true);
  ok('board is still eight', board.length, 8);
}

console.log('\n5. a full replacement, and the ordering rule end to end');
{
  const votes = tallyVotes(['$AAA $BBB $CCC $DDD $EEE $FFF $GGG $HHH'], DEFAULTS);
  const board = rankBoard(votes, all);
  ok('eight newcomers take every slot', board.length, 8);
  ok('no default survives', DEFAULTS.some((d) => board.includes(d)), false);
}

console.log('\n6. symbols the vendor will not serve are dropped');
{
  const votes = tallyVotes(['$ZZZZ is going up'], DEFAULTS);
  ok('ZZZZ was counted', votes.get('ZZZZ'), 1);

  // ...but it never reaches a panel, because it does not exist.
  const board = rankBoard(votes, (s) => s !== 'ZZZZ');
  ok('ZZZZ is not on the board', board.includes('ZZZZ'), false);
  ok('the default it would have displaced stays', board.includes('SYM'), true);
  ok('board is still full', board.length, 8);
}

console.log('\n7. which symbols need checking against the vendor');
{
  const votes = tallyVotes(['$NVDA and $KO and $TSLA'], DEFAULTS);
  const unknown = unknownSymbols(votes, DEFAULTS).sort();
  ok('only the newcomers', unknown.join(), 'NVDA,TSLA');
  ok('a known default is not re-checked', unknown.includes('KO'), false);
}

console.log('\n8. the app must not vote for itself');
{
  // The sticky comment names every ticker on the board. If it were counted,
  // the incumbents would be re-elected every day and nothing would move.
  const sticky =
    'Todays panels: $GOOGL $BRK.B $CVX $KO $MCD $PG $SPCX $SYM. ' +
    'Mention a ticker with a dollar sign to nominate it.';
  ok('the sticky is full of nominations', parseMentions(sticky).length, 8);

  const withApp = rankBoard(tallyVotes([sticky, '$NVDA'], DEFAULTS), all);
  ok('counted: newcomer is locked out', withApp.includes('NVDA'), false);

  const withoutApp = rankBoard(tallyVotes(['$NVDA'], DEFAULTS), all);
  ok('excluded: newcomer gets in', withoutApp.includes('NVDA'), true);
}

console.log('\n9. voting closes at 16:00 New York, by the comment clock');
{
  // offset 4 = EDT (summer), 5 = EST (winter)
  const et = (y, m, d, h, min, off) => new Date(Date.UTC(y, m, d, h + off, min));
  const S = '2026-08-07';

  ok('09:31 counts', countsTowardBoard(S, et(2026, 7, 7, 9, 31, 4)), true);
  ok('15:59 counts', countsTowardBoard(S, et(2026, 7, 7, 15, 59, 4)), true);
  ok('16:00 exactly does not', countsTowardBoard(S, et(2026, 7, 7, 16, 0, 4)), false);
  // The sealing pass runs up to 16:30, so this is the case that matters.
  ok('16:12 does not', countsTowardBoard(S, et(2026, 7, 7, 16, 12, 4)), false);
  ok('next morning does not', countsTowardBoard(S, et(2026, 7, 8, 9, 31, 4)), false);
  ok('accepts a raw epoch too', countsTowardBoard(S, et(2026, 7, 7, 9, 31, 4).getTime()), true);

  // Winter: same wall-clock rule, one hour further from UTC. A fixed offset
  // would put this on the wrong side of the close for months at a time.
  const W = '2026-01-20';
  ok('winter 15:59 counts', countsTowardBoard(W, et(2026, 0, 20, 15, 59, 5)), true);
  ok('winter 16:01 does not', countsTowardBoard(W, et(2026, 0, 20, 16, 1, 5)), false);
}

console.log('\n10. the close, resolved to a real instant');
{
  // Summer: New York is UTC-4, so 16:00 there is 20:00 UTC.
  ok('summer close in UTC', easternInstant('2026-08-07', '16:00').toISOString(), '2026-08-07T20:00:00.000Z');
  // Winter: New York is UTC-5, so the same wall clock is 21:00 UTC. Writing
  // either offset into logic would be wrong for half the year.
  ok('winter close in UTC', easternInstant('2026-01-20', '16:00').toISOString(), '2026-01-20T21:00:00.000Z');
  ok('open resolves too', easternInstant('2026-08-07', '09:30').toISOString(), '2026-08-07T13:30:00.000Z');
}

console.log('\n11. the deadline quoted elsewhere');
{
  const at = (session, city) =>
    closeTimesElsewhere(session).find((t) => t.city === city);

  const s = '2026-08-07'; // summer
  ok('LA is three hours behind', at(s, 'Los Angeles').time, '13:00');
  ok('London', at(s, 'London').time, '21:00');
  ok('Rome', at(s, 'Rome').time, '22:00');
  ok('Mumbai', at(s, 'Mumbai').time, '01:30');
  ok('Mumbai rolls over', at(s, 'Mumbai').nextDay, true);
  ok('Tokyo', at(s, 'Tokyo').time, '05:00');
  ok('Tokyo rolls over', at(s, 'Tokyo').nextDay, true);
  ok('London does not roll over', at(s, 'London').nextDay, false);

  const w = '2026-01-20'; // winter
  ok('winter London', at(w, 'London').time, '21:00');
  ok('winter Rome', at(w, 'Rome').time, '22:00');
  ok('winter Sydney', at(w, 'Sydney').time, '08:00');

  // The reason this is computed and not written down: for two weeks each
  // spring New York has moved to summer time and London has not, so the gap
  // is four hours instead of the usual five and every hardcoded table is
  // wrong. 8 March 2026 is inside that window.
  ok('spring gap: London', at('2026-03-09', 'London').time, '20:00');
  ok('spring gap: Rome', at('2026-03-09', 'Rome').time, '21:00');
  // ...and once Europe catches up, the usual gap returns.
  ok('after Europe shifts: London', at('2026-04-13', 'London').time, '21:00');
}

console.log(fail === 0 ? '\nALL CHECKS PASSED' : `\n${fail} CHECK(S) FAILED`);
process.exit(fail === 0 ? 0 : 1);
