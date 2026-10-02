import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { STATUS_LINE_MS, createStatusLine } from '../src/lib/status-line';

// The status line: one line that says what just happened, for six seconds, and a newer line replaces an older one.
// The clock is faked: nothing here waits for a real one.

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('the status line', () => {
  it('says nothing until something is said', () => {
    expect(createStatusLine().line()).toBe('');
  });

  it('shows what was said for six seconds, and then nothing', () => {
    const status = createStatusLine();
    status.say('Added Plumber coming: Fri, Oct 2, 2:00 PM');
    expect(status.line()).toBe('Added Plumber coming: Fri, Oct 2, 2:00 PM');
    vi.advanceTimersByTime(STATUS_LINE_MS - 1);
    expect(status.line()).toBe('Added Plumber coming: Fri, Oct 2, 2:00 PM');
    vi.advanceTimersByTime(1);
    expect(status.line()).toBe('');
    expect(STATUS_LINE_MS).toBe(6000);
  });

  it('is replaced by a newer line, which has the six seconds to itself', () => {
    const status = createStatusLine();
    status.say('Added milk');
    vi.advanceTimersByTime(4_000);
    status.say('Showing everyone');
    expect(status.line()).toBe('Showing everyone');
    // The older line's six seconds are up here, and the newer line is not touched by them.
    vi.advanceTimersByTime(2_000);
    expect(status.line()).toBe('Showing everyone');
    vi.advanceTimersByTime(3_999);
    expect(status.line()).toBe('Showing everyone');
    vi.advanceTimersByTime(1);
    expect(status.line()).toBe('');
  });

  it('starts the six seconds again when the same words are said again', () => {
    const status = createStatusLine();
    status.say('Added milk');
    vi.advanceTimersByTime(5_000);
    status.say('Added milk');
    vi.advanceTimersByTime(5_000);
    expect(status.line()).toBe('Added milk');
    vi.advanceTimersByTime(1_000);
    expect(status.line()).toBe('');
  });

  it('tells its listeners when the line changes and when it goes, until they stop listening', () => {
    const status = createStatusLine();
    const heard: string[] = [];
    const stop = status.subscribe(() => heard.push(status.line()));
    status.say('One');
    status.say('Two');
    vi.advanceTimersByTime(STATUS_LINE_MS);
    expect(heard).toEqual(['One', 'Two', '']);
    stop();
    status.say('Three');
    expect(heard).toEqual(['One', 'Two', '']);
  });

  it('runs no timer once it is disposed of', () => {
    const status = createStatusLine();
    status.say('One');
    status.dispose();
    expect(vi.getTimerCount()).toBe(0);
  });
});
