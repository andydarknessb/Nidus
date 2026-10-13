// The work budget of one calendar-sync run for iPhone (iCloud) feeds (spec 0012). The hosted function has a
// 2 s CPU limit for the whole run, and a repeating rule that started long ago can take forever, so every
// cap on that work is here and nothing else holds one: steps for the run, a feed and a series; rows for a
// feed and an event; RDATEs; the day-search steps of a feed and of a series; the age a day-search series may
// have; the time the run's expansion may take. The expansion asks (a feed scope, a series scope within it)
// and never reads a number. The caps only ever limit repeating series: a single event, an RDATE or a moved
// occurrence costs no steps and is kept whatever any cap says.
//
// Two kinds of answer. A series that reaches its own, its feed's or its day-search cap is cut short and
// keeps what it reached (the feed says `truncated`): `step()` answers false. The run being out of steps or
// time is not a cut: the feed is not read at all this run, because storing half of it would delete the
// rows it did not reach, so the budget throws FeedTooLargeError.
const MAX_STEPS_PER_RUN = 80_000;
const MAX_STEPS_PER_FEED = 60_000;
const MAX_STEPS_PER_SERIES = 30_000;
const MAX_ROWS_PER_FEED = 20_000;
const MAX_ROWS_PER_EVENT = 1000;
const MAX_RDATES_PER_EVENT = 1000;
const MAX_EXPANSION_MS = 800;
// A step of a day-search shape (a monthly rule with BYSETPOS or an ordinal BYDAY, a yearly one with BYSETPOS
// or an ordinal BYDAY) is an ical.js search inside a month or a year, about 0.7 ms. A series walked from
// DTSTART is admitted only when it is at most this many of its steps before the window.
const MAX_DAY_SEARCH_AGE_STEPS = 240;
const DAY_SEARCH_MARGIN = 24;
// One feed may spend only this many day-search steps across all its series (about 420 ms): a feed of several
// series near the age limit is cut and synced, not left to run out the clock, which stores nothing.
const MAX_DAY_SEARCH_STEPS_PER_FEED = 600;
const MONTH_MS = 28 * 86_400_000;

// The run's steps or time ran out while a feed still had repeating events to walk.
export class FeedTooLargeError extends Error {}

export class RunBudget {
  private left: number;
  private spent = 0;
  private readonly now: () => number;

  // `steps` is for a test that wants a run part spent; `now` is the clock (performance.now by default),
  // injectable so the time limit is testable.
  constructor(options: { steps?: number; now?: (() => number) | undefined } = {}) {
    this.left = options.steps ?? MAX_STEPS_PER_RUN;
    this.now = options.now ?? (() => performance.now());
  }

  // What the run has left and has spent so far (parsing included), for logs and tests.
  get remaining(): number {
    return this.left;
  }
  get spentMs(): number {
    return this.spent;
  }

  // Whether the run has all its steps and time still: only a feed that had the whole run to itself shows,
  // by not fitting, that it is too big.
  get fresh(): boolean {
    return this.left === MAX_STEPS_PER_RUN && !this.spent;
  }

  // Whether the run has no steps or time left for another feed, to be asked before anything is read.
  skip(): boolean {
    return this.left <= 0 || this.spent >= MAX_EXPANSION_MS;
  }

  // One feed's scope, over a window `windowMs` long. Its time counts from here to `end()`.
  feed(windowMs: number) {
    const began = this.now();
    let feedSteps = MAX_STEPS_PER_FEED;
    let daySearchSteps = MAX_DAY_SEARCH_STEPS_PER_FEED;
    const runOut = () => this.left <= 0 || this.spent + (this.now() - began) >= MAX_EXPANSION_MS;

    return {
      // Before work that costs steps or time and is not a step (an iterator, a skip forward): throws
      // FeedTooLargeError when the run is out.
      start(): void {
        if (runOut()) throw new FeedTooLargeError();
      },

      // Whether a series of this kind is near enough to the window to be walked from DTSTART: the walk
      // estimates its steps and the budget answers.
      admits(_kind: 'daySearch', estimatedSteps: number): boolean {
        return estimatedSteps <= MAX_DAY_SEARCH_AGE_STEPS;
      },

      // Whether the feed has day-search steps left to start another such series.
      daySearch(): boolean {
        return daySearchSteps > 0;
      },

      // Whether the feed holds as many rows as it may.
      full(rows: number): boolean {
        return rows >= MAX_ROWS_PER_FEED;
      },

      // The rows that were always kept, then as many of the repeating ones as the feed has room for, and
      // whether any were left out.
      fit<T>(kept: T[], later: T[]): { rows: T[]; cut: boolean } {
        const room = Math.max(0, MAX_ROWS_PER_FEED - kept.length);
        return { rows: [...kept, ...later.slice(0, room)].slice(0, MAX_ROWS_PER_FEED), cut: later.length > room || kept.length > MAX_ROWS_PER_FEED };
      },

      // One repeating event of the feed. A day-search series has a step cap of its own: what an admitted
      // series needs (the age limit and the window, with a margin), however it is reached.
      series: (kind: 'plain' | 'daySearch' = 'plain') => {
        const cap = kind === 'daySearch' ? Math.min(MAX_STEPS_PER_SERIES, MAX_DAY_SEARCH_AGE_STEPS + Math.ceil(windowMs / MONTH_MS) + DAY_SEARCH_MARGIN) : MAX_STEPS_PER_SERIES;
        let steps = 0;
        let rows = 0;
        let rdates = 0;
        return {
          // Takes one step. False when the series, the feed or (for a day search) the feed's day-search
          // steps are spent: the series is cut. Throws FeedTooLargeError when the run is out.
          step: (): boolean => {
            if (steps >= cap || feedSteps <= 0 || (kind === 'daySearch' && daySearchSteps <= 0)) return false;
            if (runOut()) throw new FeedTooLargeError();
            steps += 1;
            feedSteps -= 1;
            if (kind === 'daySearch') daySearchSteps -= 1;
            this.left -= 1;
            return true;
          },

          // An occurrence was offered as a row (`isNew`: one the feed did not hold). Whether more are
          // wanted, which is whether neither the event nor the feed (holding `rowsInFeed`) is full.
          row(rowsInFeed: number, isNew: boolean): boolean {
            if (isNew) rows += 1;
            return rows < MAX_ROWS_PER_EVENT && rowsInFeed < MAX_ROWS_PER_FEED;
          },

          // Whether the event may take one more RDATE.
          rdate(): boolean {
            if (rdates >= MAX_RDATES_PER_EVENT) return false;
            rdates += 1;
            return true;
          },
        };
      },

      // The feed is done, however it ended: its time is the run's.
      end: (): void => {
        this.spent += this.now() - began;
      },
    };
  }
}

export type FeedBudget = ReturnType<RunBudget['feed']>;
export type SeriesBudget = ReturnType<FeedBudget['series']>;
