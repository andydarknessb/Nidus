import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { startReadLoop } from '../src/lib/read-loop';

// The read loop with a `read` the test resolves by hand. No stack needed.

type Pending = { resolve: (rows: string) => void; reject: (error: Error) => void };

function harness() {
  const reads: Pending[] = [];
  const delivered: string[] = [];
  const failures: number[] = [];
  const read = () =>
    new Promise<string>((resolve, reject) => {
      reads.push({ resolve, reject });
    });
  const loop = startReadLoop({
    read,
    onResult: (rows) => delivered.push(rows),
    onFail: () => failures.push(reads.length),
    refreshMs: 60_000,
    retryMs: 5_000,
  });
  return { reads, delivered, failures, loop };
}

// Let the promise continuations that follow a settled read run.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('startReadLoop', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('reads at once on start and delivers the result', async () => {
    const { reads, delivered } = harness();
    expect(reads).toHaveLength(1);
    reads[0]!.resolve('a');
    await settle();
    expect(delivered).toEqual(['a']);
  });

  it('lets a read in flight finish and runs exactly one more for any number of pokes meanwhile', async () => {
    const { reads, delivered, loop } = harness();
    loop.poke();
    loop.poke();
    loop.poke();
    expect(reads).toHaveLength(1);
    reads[0]!.resolve('first');
    await settle();
    expect(delivered).toEqual(['first']);
    expect(reads).toHaveLength(2);
    reads[1]!.resolve('second');
    await settle();
    expect(delivered).toEqual(['first', 'second']);
    expect(reads).toHaveLength(2);
  });

  it('starts a read at once on a poke while idle', async () => {
    const { reads, loop } = harness();
    reads[0]!.resolve('a');
    await settle();
    loop.poke();
    expect(reads).toHaveLength(2);
  });

  it('reads again after the refresh time, and sooner after a failed read', async () => {
    const { reads, failures } = harness();
    reads[0]!.resolve('a');
    await settle();
    await vi.advanceTimersByTimeAsync(59_999);
    expect(reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(reads).toHaveLength(2);
    reads[1]!.reject(new Error('down'));
    await settle();
    expect(failures).toEqual([2]);
    await vi.advanceTimersByTimeAsync(5_000);
    expect(reads).toHaveLength(3);
  });

  it('after stop, a late result is not delivered and no further read starts', async () => {
    const { reads, delivered, failures, loop } = harness();
    loop.poke();
    loop.stop();
    reads[0]!.resolve('late');
    await settle();
    await vi.advanceTimersByTimeAsync(120_000);
    loop.poke();
    expect(delivered).toEqual([]);
    expect(failures).toEqual([]);
    expect(reads).toHaveLength(1);
  });
});
