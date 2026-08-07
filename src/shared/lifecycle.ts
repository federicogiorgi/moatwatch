/**
 * lifecycle.ts - what to do with a session we have just fetched.
 *
 * A post is born at the open, updated while the market runs, sealed at the
 * close, and never touched again. That is four states and several ways to
 * arrive at each, so the decision lives here as a pure function rather than
 * tangled into the Redis and Reddit calls. It can then be tested exhaustively,
 * which matters because the failure modes are things like "posted twice" and
 * "kept editing yesterday's post".
 *
 * No network, no Devvit, no clock of its own - everything arrives as input.
 */

export type LifecycleInput = {
  /** Session date the vendor just gave us, "YYYY-MM-DD". */
  session: string;
  /** Has that session finished trading? */
  sessionComplete: boolean;
  /** Is that session today's, in New York? */
  isToday: boolean;
  /** The post we are currently tracking, if any. */
  livePost: { session: string; postId: string } | null;
  /** Session we have already sealed, if any. */
  finalizedSession: string | null;
};

export type LifecycleAction =
  /** Nothing to do. */
  | { kind: 'skip'; reason: string }
  /** Market is open and no post exists yet for it: create a live one. */
  | { kind: 'create-live' }
  /** Market is open and the post exists: refresh its figures in place. */
  | { kind: 'update-live' }
  /** Market has closed: write final figures and seal the existing post. */
  | { kind: 'finalize' }
  /**
   * Market has closed and no live post was ever created - the app was asleep,
   * or the vendor only published the session afterwards. Post it closed.
   */
  | { kind: 'create-final' };

export function decideAction(input: LifecycleInput): LifecycleAction {
  const { session, sessionComplete, isToday, livePost, finalizedSession } =
    input;

  if (!session) return { kind: 'skip', reason: 'no session in data' };

  // Sealed means sealed. This is the guarantee that a closed post never moves
  // again, and it has to be checked before anything else.
  if (finalizedSession === session) {
    return { kind: 'skip', reason: `session ${session} already finalized` };
  }

  if (!sessionComplete) {
    // An unfinished session that is not today's is nonsense - stale or
    // mid-flight vendor data. Never publish it.
    if (!isToday) {
      return { kind: 'skip', reason: `unfinished session ${session} is not today` };
    }
    return livePost?.session === session
      ? { kind: 'update-live' }
      : { kind: 'create-live' };
  }

  return livePost?.session === session
    ? { kind: 'finalize' }
    : { kind: 'create-final' };
}
