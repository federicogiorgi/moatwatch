/**
 * tickers.ts - reading ticker nominations out of comments, and turning them
 * into the day's board.
 *
 * The eight small panels are contestable. Readers nominate a ticker by writing
 * it with a dollar sign, every mention is a vote, and the eight highest-voted
 * symbols hold the panels. The index panel is not contestable and never
 * appears here.
 *
 * Pure: no network, no Devvit, no value imports. Validating that a nominated
 * symbol actually exists needs the vendor and therefore lives in the server,
 * but everything about *deciding* the board is here so it can be tested
 * exhaustively - which matters, because the failure modes are things like
 * "the app voted for itself" and "a word in a sentence became a stock".
 */

/** Each default panel starts with half a vote. */
export const BASELINE_VOTE = 0.5;

/** How many contestable panels there are. */
export const BOARD_SIZE = 8;

/**
 * A nomination: a dollar sign, then the ticker in capitals.
 *
 * The dollar sign is required, and this is the whole reason the feature is
 * safe. Bare capitals cannot be used: IT, ALL, ON, SO, NOW, KEY and CAR are
 * all real listings, so "I DID IT" would nominate Gartner and any acronym in
 * an ordinary sentence would move the board. Requiring the sigil makes a
 * nomination deliberate.
 *
 * Capitals only, so `$googl` and `$Googl` are not nominations - matching the
 * rule as stated, and keeping the parser from having to guess at intent.
 *
 * The trailing lookahead stops `$GOOGLE` from matching as `GOOGL`: a longer
 * run of letters is a different word, not a ticker with something stuck to it.
 * Share classes carry a dot, as in `$BRK.B`.
 *
 * That lookahead has to reject a dot only when a capital follows it. Rejecting
 * every trailing dot also threw away `$SYM.` at the end of a sentence, which
 * is how most people write - the tests caught it, and it would have quietly
 * lost a large share of real votes.
 */
const NOMINATION = /\$([A-Z]{1,5}(?:\.[A-Z])?)(?![A-Za-z0-9]|\.[A-Z])/g;

/** Every ticker nominated in one piece of text, in order, with repeats. */
export function parseMentions(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const m of text.matchAll(NOMINATION)) {
    const sym = m[1];
    if (sym) out.push(sym);
  }
  return out;
}

/**
 * Count the votes.
 *
 * Defaults open at half a vote each, so a single genuine mention (one whole
 * vote) is enough to displace an unmentioned default, while the defaults still
 * outrank anything with no support at all.
 *
 * Repeated mentions inside one comment each count. That is the rule as
 * specified; if it ever needs to become one-vote-per-comment or
 * per-author, do it by de-duplicating before calling this - the counting
 * itself should stay this simple.
 *
 * The caller is responsible for excluding the app's own comments. It lists
 * every ticker on the board in its sticky comment, so counting itself would
 * re-elect the incumbents every day and nothing would ever change.
 */
export function tallyVotes(
  commentTexts: readonly string[],
  defaults: readonly string[]
): Map<string, number> {
  const votes = new Map<string, number>();
  for (const sym of defaults) votes.set(sym, BASELINE_VOTE);

  for (const text of commentTexts) {
    for (const sym of parseMentions(text)) {
      votes.set(sym, (votes.get(sym) ?? 0) + 1);
    }
  }
  return votes;
}

/**
 * The winning board, highest first.
 *
 * Ties break alphabetically, and that is not cosmetic: every unmentioned
 * default sits on exactly the baseline, so the tie-break decides which of them
 * is displaced first. Ordering ties A-to-Z and taking from the top means the
 * symbol latest in the alphabet is the first to lose its panel, which is the
 * "Z before the A" rule.
 *
 * `eligible` filters to symbols the vendor will actually serve. Nominating
 * something that does not exist must not blank a panel, so an unknown ticker
 * is dropped here rather than reaching the renderer.
 */
export function rankBoard(
  votes: ReadonlyMap<string, number>,
  eligible: (symbol: string) => boolean,
  size: number = BOARD_SIZE
): string[] {
  return [...votes.entries()]
    .filter(([sym]) => eligible(sym))
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .slice(0, size)
    .map(([sym]) => sym);
}

/** The little we need to know about a comment to decide whether it votes. */
export type VoteCandidate = {
  id: string;
  authorName?: string | undefined;
  body?: string | undefined;
  createdAt: Date | number;
};

/**
 * Does this comment get a vote?
 *
 * This lives here, pure, because the version that lived in the server was
 * untestable and was wrong. It excluded the app's own comment by comparing
 * author names, and fell back to no exclusion at all when the app's name could
 * not be resolved - which is the normal state inside a scheduled task, since
 * there is no logged-in user there. The guard read `if (appUser && ...)`, so an
 * empty name skipped it silently, with nothing logged. On 10 August 2026 that
 * let the stickied comment vote for the tickers it uses as examples, and NVDA
 * held a panel all day without a single reader asking for it.
 *
 * Hence `excludeIds`, which does not depend on resolving anything: the sticky's
 * id is recorded when it is posted. The author check remains as a second line
 * of defence, never as the only one.
 */
export function isVotingComment(
  comment: VoteCandidate,
  opts: {
    session: string;
    appUser?: string | undefined;
    excludeIds?: readonly string[] | undefined;
    /** Injected so this stays pure; server passes clock.countsTowardBoard. */
    inWindow: (session: string, createdAt: Date | number) => boolean;
  }
): boolean {
  if (opts.excludeIds?.includes(comment.id)) return false;
  if (opts.appUser && comment.authorName === opts.appUser) return false;
  if (!comment.body) return false;
  return opts.inWindow(opts.session, comment.createdAt);
}

/**
 * Which nominated symbols are new, and therefore need checking against the
 * vendor before they can be trusted onto the board.
 */
export function unknownSymbols(
  votes: ReadonlyMap<string, number>,
  known: readonly string[]
): string[] {
  const seen = new Set(known);
  return [...votes.keys()].filter((s) => !seen.has(s));
}
