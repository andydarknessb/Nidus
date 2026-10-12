import { describe, expect, it } from 'vitest';
import { FeedTooLargeError, RunBudget } from '../supabase/functions/_shared/run-budget';

// The run budget driven directly, with a clock of the test's own: no feed is parsed and nothing depends on how
// fast the machine is. How the walk asks it (where each question is put) is tests/ics-expand.test.ts.
const RUN_STEPS = 80_000;
const FEED_STEPS = 60_000;
const SERIES_STEPS = 30_000;
const RUN_MS = 800;
// A window of six 28-day months, the walk's usual: a day-search series is cut at 240 + 6 + 24 steps.
const WINDOW_MS = 6 * 28 * 86_400_000;
const DAY_SEARCH_SERIES = 270;

// A clock the test moves by hand.
function clock(start = 0) {
  let t = start;
  return { now: () => t, set: (ms: number) => (t = ms), tick: (ms: number) => (t += ms) };
}

// Takes steps from a series until it answers false; how many it gave.
function drain(series: { step(): boolean }, limit = Infinity): number {
  let taken = 0;
  while (taken < limit && series.step()) taken += 1;
  return taken;
}

describe('RunBudget: steps', () => {
  it('gives a series at most 30,000 steps, then says it is cut, without spending the run', () => {
    const run = new RunBudget();
    const feed = run.feed(WINDOW_MS);
    const series = feed.series();
    expect(drain(series)).toBe(SERIES_STEPS);
    expect(series.step()).toBe(false);
    expect(run.remaining).toBe(RUN_STEPS - SERIES_STEPS);
  });

  it('gives a feed at most 60,000 steps across its series, then cuts every series after, keeping what the run has left', () => {
    const run = new RunBudget();
    const feed = run.feed(WINDOW_MS);
    expect(drain(feed.series())).toBe(SERIES_STEPS);
    expect(drain(feed.series())).toBe(SERIES_STEPS);
    // A third series starts with the feed's steps spent.
    const third = feed.series();
    expect(third.step()).toBe(false);
    expect(run.remaining).toBe(RUN_STEPS - FEED_STEPS);
    feed.end();
  });

  it('shares what is left between feeds: a second feed that needs more than the run has throws, and leaves nothing', () => {
    const run = new RunBudget();
    const first = run.feed(WINDOW_MS);
    drain(first.series());
    drain(first.series());
    first.end();
    const second = run.feed(WINDOW_MS);
    const series = second.series();
    // The run has 20,000 steps for it, fewer than a series may take.
    expect(drain(series, 20_000)).toBe(20_000);
    expect(() => series.step()).toThrow(FeedTooLargeError);
    expect(run.remaining).toBe(0);
    second.end();
  });

  it('throws, rather than say the series is cut, when the run ran out in the middle of one', () => {
    const run = new RunBudget({ steps: 20_000 });
    const feed = run.feed(WINDOW_MS);
    const series = feed.series();
    expect(drain(series, 20_000)).toBe(20_000);
    expect(() => series.step()).toThrow(FeedTooLargeError);
    expect(() => series.step()).toThrow(FeedTooLargeError);
    expect(run.remaining).toBe(0);
  });

  it('refuses a step of a run with none left, at once', () => {
    const feed = new RunBudget({ steps: 0 }).feed(WINDOW_MS);
    expect(() => feed.series().step()).toThrow(FeedTooLargeError);
  });

  it('asks before work that is not a step, and spends nothing for it', () => {
    const run = new RunBudget({ steps: 3 });
    const feed = run.feed(WINDOW_MS);
    expect(() => feed.start()).not.toThrow();
    expect(run.remaining).toBe(3);
    drain(feed.series(), 3);
    expect(() => feed.start()).toThrow(FeedTooLargeError);
  });
});

describe('RunBudget: the day search', () => {
  it('admits a day-search series of at most 240 of its steps before the window, and no older', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    expect(feed.admits('daySearch', 0)).toBe(true);
    expect(feed.admits('daySearch', 240)).toBe(true);
    expect(feed.admits('daySearch', 241)).toBe(false);
  });

  it('cuts a day-search series at what an admitted one needs: 240 steps and the window’s months, with a margin', () => {
    const run = new RunBudget();
    const series = run.feed(WINDOW_MS).series('daySearch');
    expect(drain(series)).toBe(DAY_SEARCH_SERIES);
    expect(series.step()).toBe(false);
    // A longer window needs more months.
    expect(drain(new RunBudget().feed(12 * 28 * 86_400_000).series('daySearch'))).toBe(240 + 12 + 24);
  });

  it('gives a feed 600 day-search steps across its series, then says no more such series start', () => {
    const run = new RunBudget();
    const feed = run.feed(WINDOW_MS);
    expect(feed.daySearch()).toBe(true);
    expect(drain(feed.series('daySearch'))).toBe(DAY_SEARCH_SERIES);
    expect(drain(feed.series('daySearch'))).toBe(DAY_SEARCH_SERIES);
    expect(feed.daySearch()).toBe(true);
    expect(drain(feed.series('daySearch'))).toBe(600 - 2 * DAY_SEARCH_SERIES);
    expect(feed.daySearch()).toBe(false);
    expect(feed.series('daySearch').step()).toBe(false);
  });

  it('does not spend the day-search steps on a plain series, and a plain series is not stopped by them', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    drain(feed.series(), 500);
    expect(feed.daySearch()).toBe(true);
    drain(feed.series('daySearch'));
    drain(feed.series('daySearch'));
    drain(feed.series('daySearch'));
    expect(feed.daySearch()).toBe(false);
    expect(feed.series().step()).toBe(true);
  });

  it('counts a day-search step against the feed’s and the run’s steps too', () => {
    const run = new RunBudget();
    drain(run.feed(WINDOW_MS).series('daySearch'));
    expect(run.remaining).toBe(RUN_STEPS - DAY_SEARCH_SERIES);
  });
});

describe('RunBudget: rows and RDATEs', () => {
  it('wants rows of an event until it has 1000 new ones, counting a row it already held once', () => {
    const series = new RunBudget().feed(WINDOW_MS).series();
    for (let n = 1; n < 1000; n += 1) expect(series.row(n, true)).toBe(true);
    // DTSTART comes round again from the iterator: not new, not counted.
    expect(series.row(999, false)).toBe(true);
    expect(series.row(1000, false)).toBe(true);
    expect(series.row(1000, true)).toBe(false);
    expect(series.row(1001, false)).toBe(false);
  });

  it('wants no more rows once the feed holds 20,000, whatever the event has', () => {
    const series = new RunBudget().feed(WINDOW_MS).series();
    expect(series.row(19_999, true)).toBe(true);
    expect(series.row(20_000, true)).toBe(false);
    expect(series.row(20_000, false)).toBe(false);
  });

  it('counts each event’s rows by itself', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    const first = feed.series();
    for (let n = 1; n <= 1000; n += 1) first.row(n, true);
    expect(first.row(1000, false)).toBe(false);
    expect(feed.series().row(1000, true)).toBe(true);
  });

  it('says whether the feed is full at 20,000 rows', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    expect(feed.full(19_999)).toBe(false);
    expect(feed.full(20_000)).toBe(true);
  });

  it('allows an event 1000 RDATEs and refuses the 1001st, each event by itself', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    const series = feed.series();
    for (let n = 0; n < 1000; n += 1) expect(series.rdate()).toBe(true);
    expect(series.rdate()).toBe(false);
    expect(series.rdate()).toBe(false);
    expect(feed.series().rdate()).toBe(true);
  });

  it('keeps the rows that were always kept, then fills the room the feed has, and says whether any were left out', () => {
    const feed = new RunBudget().feed(WINDOW_MS);
    const number = (count: number, from = 0) => Array.from({ length: count }, (_, index) => from + index);
    const fits = feed.fit(number(3), number(19_997, 3));
    expect(fits.rows).toHaveLength(20_000);
    expect(fits.cut).toBe(false);
    const over = feed.fit(number(3), number(19_998, 3));
    expect(over.rows).toEqual(number(20_000));
    expect(over.cut).toBe(true);
    // What was always kept is not cut for the repeating rows, and past the cap it is cut itself.
    const crowded = feed.fit(number(20_005), number(4, 20_005));
    expect(crowded.rows).toEqual(number(20_000));
    expect(crowded.cut).toBe(true);
    expect(feed.fit([], []).cut).toBe(false);
  });
});

describe('RunBudget: time', () => {
  it('stops the steps once 800 ms of the run have passed, as if the run had no steps left', () => {
    // A clock that moves a millisecond each time it is read, which a step does once.
    let t = 0;
    const run = new RunBudget({ now: () => (t += 1) });
    const feed = run.feed(WINDOW_MS);
    const series = feed.series();
    let walked = 0;
    expect(() => {
      for (;;) {
        series.step();
        walked += 1;
      }
    }).toThrow(FeedTooLargeError);
    expect(walked).toBeGreaterThan(700);
    expect(walked).toBeLessThanOrEqual(RUN_MS);
    feed.end();
    expect(run.spentMs).toBeGreaterThanOrEqual(RUN_MS - 1);
  });

  it('does not stop anything while the time is within the limit', () => {
    const time = clock();
    const run = new RunBudget({ now: time.now });
    const feed = run.feed(WINDOW_MS);
    const series = feed.series();
    time.set(RUN_MS - 1);
    expect(series.step()).toBe(true);
    expect(() => feed.start()).not.toThrow();
    time.set(RUN_MS);
    expect(() => feed.start()).toThrow(FeedTooLargeError);
    expect(() => series.step()).toThrow(FeedTooLargeError);
  });

  it('counts the time of every feed of the run: what the first spent, the second does not have', () => {
    const time = clock();
    const run = new RunBudget({ now: time.now });
    const first = run.feed(WINDOW_MS);
    time.set(700);
    first.end();
    expect(run.spentMs).toBe(700);
    // The second feed has a hundred milliseconds of the run.
    const second = run.feed(WINDOW_MS);
    time.set(700 + 99);
    expect(() => second.start()).not.toThrow();
    time.set(700 + 100);
    expect(() => second.start()).toThrow(FeedTooLargeError);
    second.end();
    expect(run.spentMs).toBe(800);
  });

  it('counts a feed’s time from the moment it opens to the moment it ends', () => {
    const time = clock(5000);
    const run = new RunBudget({ now: time.now });
    const feed = run.feed(WINDOW_MS);
    time.tick(250);
    feed.end();
    expect(run.spentMs).toBe(250);
  });

  it('never runs out of time with a clock that does not move', () => {
    const run = new RunBudget({ now: () => 0 });
    const feed = run.feed(WINDOW_MS);
    const series = feed.series();
    expect(drain(series)).toBe(SERIES_STEPS);
    feed.end();
    expect(run.spentMs).toBe(0);
    expect(run.skip()).toBe(false);
  });
});

describe('RunBudget: the run', () => {
  it('is fresh until a step is taken or time is spent, and skips nothing then', () => {
    const run = new RunBudget();
    expect(run.fresh).toBe(true);
    expect(run.skip()).toBe(false);
    // Opening and closing a feed that did nothing spends no steps, and (with a clock that does not move) no time.
    const idle = new RunBudget({ now: () => 0 });
    idle.feed(WINDOW_MS).end();
    expect(idle.fresh).toBe(true);
  });

  it('is not fresh after one step', () => {
    const run = new RunBudget();
    run.feed(WINDOW_MS).series().step();
    expect(run.fresh).toBe(false);
    expect(run.skip()).toBe(false);
  });

  it('is not fresh after time is spent without a step, and not fresh again afterwards', () => {
    const time = clock();
    const run = new RunBudget({ now: time.now });
    const feed = run.feed(WINDOW_MS);
    time.set(10);
    feed.end();
    expect(run.fresh).toBe(false);
    expect(run.skip()).toBe(false);
  });

  it('skips a feed once the run has no steps left', () => {
    expect(new RunBudget({ steps: 0 }).skip()).toBe(true);
    const run = new RunBudget({ steps: 1 });
    expect(run.skip()).toBe(false);
    run.feed(WINDOW_MS).series().step();
    expect(run.skip()).toBe(true);
  });

  it('skips a feed once the time is spent: at 800 ms, not before', () => {
    const time = clock();
    const run = new RunBudget({ now: time.now });
    const first = run.feed(WINDOW_MS);
    time.set(RUN_MS - 1);
    first.end();
    expect(run.skip()).toBe(false);
    const second = run.feed(WINDOW_MS);
    time.tick(1);
    second.end();
    expect(run.skip()).toBe(true);
  });

  it('asks the question of the run without reading the clock', () => {
    let reads = 0;
    const run = new RunBudget({ now: () => (reads += 1) });
    run.skip();
    expect(run.fresh).toBe(true);
    expect(reads).toBe(0);
  });

  it('shows what is left and what is spent', () => {
    const time = clock();
    const run = new RunBudget({ now: time.now });
    expect(run.remaining).toBe(RUN_STEPS);
    expect(run.spentMs).toBe(0);
    const feed = run.feed(WINDOW_MS);
    drain(feed.series(), 7);
    time.set(12);
    feed.end();
    expect(run.remaining).toBe(RUN_STEPS - 7);
    expect(run.spentMs).toBe(12);
  });
});
