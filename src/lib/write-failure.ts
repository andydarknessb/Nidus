import { TICK_FAILED, TICK_OFFLINE } from './routines';

// What a write that did not go through says, on the phone as on the Wall (spec 0003, A tick that did not save): with no
// connection, "No internet, so that did not save. Try again soon."; otherwise "That did not save. Try again." They are the
// Wall's own two sentences, so the family reads one thing for one trouble. A value the database refused is the one case with
// words of its own (a form says which field to look at), and an action that is not a save (connecting to Google, pairing) names
// itself in both.
export const NOT_SAVED = TICK_FAILED;
export const NOT_SAVED_OFFLINE = TICK_OFFLINE;

// The error codes of a value the database refused (Postgres: a check, a not null, a value too long). Any other code is the
// server answering that it could not, or would not, which is not for the person to fix by looking at a field.
const REFUSALS: ReadonlySet<string> = new Set(['23514', '23502', '22001']);

const codeOf = (error: unknown): string => {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === 'string' ? code : '';
};

// Whether the server refused a value (see REFUSALS).
export function isRefusal(error: unknown): boolean {
  return REFUSALS.has(codeOf(error));
}

// Whether a request never got an answer. supabase-js hands back a fetch that threw as an error with no code and the browser's
// own words ("TypeError: Failed to fetch"; Safari says "Load failed", Firefox "NetworkError when attempting to fetch resource"),
// and the Edge Function client calls it a FunctionsFetchError. An answer, even a refusal, has a code.
export function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) return false;
  if (error instanceof TypeError) return true;
  const { name, message } = error as { name?: unknown; message?: unknown };
  if (name === 'FunctionsFetchError' || name === 'AuthRetryableFetchError') return true;
  if (codeOf(error) !== '') return false;
  return typeof message === 'string' && /failed to fetch|networkerror|load failed|network request failed|fetch failed/i.test(message);
}

// What is said of a write that did not go through: the words, and how many failures have been said (`n`), so that a retry that
// fails again is a new alert, heard again, though its words are the same.
export type Said = { words: string; n?: number | undefined };

// The words for a write that failed. `offline` is what the screen knows of its connection when it failed (the change feed's
// word); an error that says it never got an answer is offline whatever the screen thought. `refusal` is a form's words for a
// value the database would not take; `said` names an action that is not a save.
export function writeFailureWords(error: unknown, options: { offline: boolean; refusal?: string | undefined; said?: { failed: string; offline: string } | undefined }): string {
  const answered = codeOf(error) !== '';
  if (answered && options.refusal !== undefined && isRefusal(error)) return options.refusal;
  const offline = isNetworkFailure(error) || (!answered && options.offline);
  const said = options.said ?? { failed: NOT_SAVED, offline: NOT_SAVED_OFFLINE };
  return offline ? said.offline : said.failed;
}
