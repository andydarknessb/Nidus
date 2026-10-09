import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCardWrite } from '../src/lib/card-write';
import { changeThrough, couldNotLoad, startSyncedRead, type SyncedState } from '../src/lib/synced-read';

// The synced read (spec 0008) with a `load` the test resolves by hand: no stack needed. A screen
// shows its own change at once, and a change from another Device may arrive while that write is
// still in flight. What is shown must end as the server's.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness() {
  const reads: ReturnType<typeof deferred<string[]>>[] = [];
  const states: SyncedState<string[]>[] = [];
  const read = startSyncedRead<string[]>({
    load: () => {
      const next = deferred<string[]>();
      reads.push(next);
      return next.promise;
    },
    onChange: (state) => states.push(state),
  });
  const shown = () => states.map((state) => state.data);
  const last = () => states[states.length - 1];
  return { read, reads, states, shown, last };
}

// Let the promise continuations that follow a settled read or write run.
const settle = () => vi.advanceTimersByTimeAsync(0);

describe('startSyncedRead', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  describe('reading', () => {
    it('reads at once on start and shows what the read returns', async () => {
      const { reads, shown } = harness();
      expect(reads).toHaveLength(1);
      reads[0]!.resolve(['a']);
      await settle();
      expect(shown()).toEqual([['a']]);
    });

    it('lets a read in flight finish and runs exactly one more for any number of change notices meanwhile', async () => {
      const { read, reads, shown } = harness();
      read.poke();
      read.poke();
      read.poke();
      expect(reads).toHaveLength(1);
      reads[0]!.resolve(['first']);
      await settle();
      expect(shown()).toEqual([['first']]);
      expect(reads).toHaveLength(2);
      reads[1]!.resolve(['second']);
      await settle();
      expect(shown()).toEqual([['first'], ['second']]);
      expect(reads).toHaveLength(2);
    });

    it('starts a read at once on a change notice while idle', async () => {
      const { read, reads } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      read.poke();
      expect(reads).toHaveLength(2);
    });

    it('reads again 30 seconds after a read lands, and 5 seconds after one fails', async () => {
      const { reads, last } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      await vi.advanceTimersByTimeAsync(29_999);
      expect(reads).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toHaveLength(2);
      reads[1]!.reject(new Error('down'));
      await settle();
      expect(last()).toMatchObject({ data: ['a'], state: 'ready', failed: true });
      await vi.advanceTimersByTimeAsync(4_999);
      expect(reads).toHaveLength(2);
      await vi.advanceTimersByTimeAsync(1);
      expect(reads).toHaveLength(3);
    });

    // The read state the screens' ladder draws (ReadState): loading, then failed or ready; a failure after something has landed is
    // still ready, with `failed` the flag beside it for the header's lost-connection line.
    it('is failed only while nothing has ever loaded, and keeps what is shown when a later read fails', async () => {
      const { read, reads, last } = harness();
      reads[0]!.reject(new Error('offline'));
      await settle();
      expect(last()).toMatchObject({ data: null, state: 'failed', failed: true });
      expect(last()!.error).toEqual(new Error('offline'));
      read.poke();
      reads[1]!.resolve(['a']);
      await settle();
      expect(last()).toEqual({ data: ['a'], state: 'ready', failed: false, error: null });
      read.poke();
      reads[2]!.reject(new Error('offline'));
      await settle();
      expect(last()).toMatchObject({ data: ['a'], state: 'ready', failed: true });
    });

    // Nothing is said before the first read lands: the hook's own start is 'loading'.
    it('says failed, then ready when a later read lands, for a read that fails first and works second', async () => {
      const { read, reads, states } = harness();
      reads[0]!.reject(new Error('offline'));
      await settle();
      read.poke();
      reads[1]!.resolve(['a']);
      await settle();
      expect(states.map((state) => state.state)).toEqual(['failed', 'ready']);
    });

    it('keeps the shown object when a read finds the same data, and says nothing new', async () => {
      const { read, reads, states } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      read.poke();
      reads[1]!.resolve(['a']);
      await settle();
      expect(states).toHaveLength(1);
    });

    it('keeps the shown object when the read after a failure finds the same data', async () => {
      const { read, reads, states } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      const shown = states[0]!.data;
      read.poke();
      reads[1]!.reject(new Error('offline'));
      await settle();
      read.poke();
      reads[2]!.resolve(['a']);
      await settle();
      expect(states.map((state) => state.failed)).toEqual([false, true, false]);
      expect(states.every((state) => state.data === shown)).toBe(true);
    });

    it('says nothing new when a read fails again, so an offline screen is not drawn every few seconds', async () => {
      const { reads, states } = harness();
      reads[0]!.reject(new Error('offline'));
      await settle();
      await vi.advanceTimersByTimeAsync(5_000);
      reads[1]!.reject(new Error('offline'));
      await settle();
      expect(states).toHaveLength(1);
    });

    it('after stop, a late result is not shown and no further read starts', async () => {
      const { read, reads, states } = harness();
      read.poke();
      read.stop();
      reads[0]!.resolve(['late']);
      await settle();
      await vi.advanceTimersByTimeAsync(120_000);
      read.poke();
      expect(states).toEqual([]);
      expect(reads).toHaveLength(1);
    });
  });

  describe('writing', () => {
    it('holds a change from another device that arrives mid-write, then reads once the write lands', async () => {
      const { read, reads, shown } = harness();
      reads[0]!.resolve([]);
      await settle();
      const write = deferred<void>();
      const writing = read.write(() => write.promise);

      // The other tablet's change arrives while this tablet's tick is still in flight: nothing is
      // read now, because that read could overwrite the tick with the old answer.
      read.poke();
      expect(reads).toHaveLength(1);

      write.resolve();
      await writing;
      expect(reads).toHaveLength(2);
      reads[1]!.resolve(['mine', 'theirs']);
      await settle();
      expect(shown()).toEqual([[], ['mine', 'theirs']]);
    });

    it('drops a read that began before a write and so may predate it', async () => {
      const { read, reads, shown } = harness();
      const write = deferred<void>();
      const writing = read.write(() => write.promise);

      reads[0]!.resolve(['stale']);
      await settle();
      expect(shown()).toEqual([]);

      write.resolve();
      await writing;
      await settle();
      reads[1]!.resolve(['fresh']);
      await settle();
      expect(shown()).toEqual([['fresh']]);
    });

    it('reads again after a write that failed, so the screen shows what the server holds', async () => {
      const { read, reads } = harness();
      reads[0]!.resolve([]);
      await settle();
      await expect(read.write(() => Promise.reject(new Error('no')))).rejects.toThrow('no');
      expect(reads).toHaveLength(2);
    });

    it('waits for the last of several overlapping writes', async () => {
      const { read, reads } = harness();
      reads[0]!.resolve([]);
      await settle();
      const first = deferred<void>();
      const second = deferred<void>();
      const writes = [read.write(() => first.promise), read.write(() => second.promise)];
      read.poke();
      first.resolve();
      await writes[0];
      expect(reads).toHaveLength(1);
      second.resolve();
      await writes[1];
      expect(reads).toHaveLength(2);
    });


    it('shows a change at once and keeps it until the read after the write lands', async () => {
      const { read, reads, shown } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      const write = deferred<void>();
      const writing = read.write(() => write.promise, (items) => [...items, 'b']);
      expect(shown()).toEqual([['a'], ['a', 'b']]);
      write.resolve();
      await writing;
      // Saved, not yet read back: still shown.
      expect(shown()[shown().length - 1]).toEqual(['a', 'b']);
      reads[1]!.resolve(['a', 'b', 'c']);
      await settle();
      expect(shown()[shown().length - 1]).toEqual(['a', 'b', 'c']);
    });

    it('reads back after a write: readBack waits for the read that follows it, not one that began before', async () => {
      const { read, reads } = harness();
      const write = deferred<void>();
      const writing = read.write(() => write.promise);
      let back = false;
      const backing = read.readBack().then(() => {
        back = true;
      });
      // The first read began before the write: it is stale and does not count.
      reads[0]!.resolve(['stale']);
      await settle();
      expect(back).toBe(false);
      write.resolve();
      await writing;
      expect(reads).toHaveLength(2);
      await settle();
      expect(back).toBe(false);
      reads[1]!.resolve(['fresh']);
      await backing;
      // One read after the write, not two.
      expect(reads).toHaveLength(2);
    });

    it('reads back at once when idle, and settles on a failed read too', async () => {
      const { read, reads } = harness();
      reads[0]!.resolve([]);
      await settle();
      const backing = read.readBack();
      expect(reads).toHaveLength(2);
      reads[1]!.reject(new Error('offline'));
      await expect(backing).resolves.toBeUndefined();
    });

    it('shows what a write landed with, from its result, until the read after it lands', async () => {
      const { read, reads, shown } = harness();
      reads[0]!.resolve(['a', 'b']);
      await settle();
      const write = deferred<string>();
      const writing = read.write(() => write.promise, undefined, (gone) => (items) => items.filter((item) => item !== gone));
      expect(shown()).toEqual([['a', 'b']]);
      write.resolve('b');
      await expect(writing).resolves.toBe('b');
      expect(shown()[shown().length - 1]).toEqual(['a']);
      reads[1]!.resolve(['a', 'c']);
      await settle();
      expect(shown()[shown().length - 1]).toEqual(['a', 'c']);
    });

    it('shows nothing landed when the result says nothing changed, or the write fails', async () => {
      const { read, reads, states } = harness();
      reads[0]!.resolve(['a']);
      await settle();
      await read.write(async () => false, undefined, (removed) => (removed ? () => [] : undefined));
      await expect(read.write(() => Promise.reject(new Error('no')), undefined, () => () => [])).rejects.toThrow('no');
      expect(states).toHaveLength(1);
    });

    it('takes back only the change whose write failed, keeping one made after it', async () => {
      // Offline: Ava's tick, then Ben's. Ava's save fails; Ben's lands.
      const { read, reads, shown } = harness();
      reads[0]!.resolve([]);
      await settle();
      const ava = deferred<void>();
      const ben = deferred<void>();
      const avas = read.write(() => ava.promise, (done) => [...done, 'ava']);
      const bens = read.write(() => ben.promise, (done) => [...done, 'ben']);
      expect(shown()[shown().length - 1]).toEqual(['ava', 'ben']);
      ava.reject(new Error('offline'));
      await expect(avas).rejects.toThrow('offline');
      expect(shown()[shown().length - 1]).toEqual(['ben']);
      ben.resolve();
      await bens;
      expect(reads).toHaveLength(2);
      reads[1]!.resolve(['ben']);
      await settle();
      expect(shown()[shown().length - 1]).toEqual(['ben']);
    });

    it('keeps a saved change shown when the read after it fails', async () => {
      const { read, reads, last } = harness();
      reads[0]!.resolve([]);
      await settle();
      await read.write(async () => undefined, (done) => [...done, 'ava']);
      reads[1]!.reject(new Error('offline'));
      await settle();
      expect(last()).toMatchObject({ data: ['ava'], state: 'ready', failed: true });
    });
  });
});

// A change (spec 0011): the card write guard, then the write, then the read-back, behind one call.
describe('changeThrough', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function changing() {
    const h = harness();
    const card = createCardWrite();
    return { ...h, card, change: changeThrough<string[]>(h.read, card) };
  }

  it('is done once the work landed and the read after it has settled, and says what landed only then', async () => {
    const { reads, change } = changing();
    reads[0]!.resolve(['a']);
    await settle();
    const told: string[] = [];
    const work = deferred<string>();
    let outcome: string | undefined;
    void change(() => work.promise, { landed: (value) => void told.push(value) }).then((result) => (outcome = result));
    work.resolve('saved');
    await settle();
    // The write is done and its read has begun: not done yet.
    expect(reads).toHaveLength(2);
    expect(told).toEqual([]);
    expect(outcome).toBeUndefined();
    reads[1]!.resolve(['a', 'b']);
    await settle();
    expect(told).toEqual(['saved']);
    expect(outcome).toBe('done');
  });

  it('is failed when the work threw: said first, no read-back waited for, and the guard let go', async () => {
    const { card, change, reads } = changing();
    reads[0]!.resolve(['a']);
    await settle();
    const heard: unknown[] = [];
    const landed = vi.fn();
    const outcome = await change(() => Promise.reject(new Error('no')), { failed: (error) => void heard.push(error), landed });
    expect(outcome).toBe('failed');
    expect(heard).toEqual([new Error('no')]);
    expect(landed).not.toHaveBeenCalled();
    expect(card.state().busy).toBe(false);
  });

  it('is busy, and does nothing, while another change is on its way', async () => {
    const { card, change, reads } = changing();
    reads[0]!.resolve(['a']);
    await settle();
    const first = deferred<void>();
    const firstOutcome = change(() => first.promise);
    expect(card.state().busy).toBe(true);
    const work = vi.fn(async () => undefined);
    const landed = vi.fn();
    await expect(change(work, { landed })).resolves.toBe('busy');
    expect(work).not.toHaveBeenCalled();
    expect(landed).not.toHaveBeenCalled();
    first.resolve();
    await settle();
    reads[1]!.resolve(['a']);
    await expect(firstOutcome).resolves.toBe('done');
    expect(card.state().busy).toBe(false);
  });

  it('shows what the write landed with from its result until the read after it, and goes on to the focus the card names', async () => {
    const { reads, change, card, shown } = changing();
    reads[0]!.resolve(['a', 'b']);
    await settle();
    const outcome = change(async () => 'b', { showing: (gone) => (items) => items.filter((item) => item !== gone), landed: () => 'next' });
    await settle();
    expect(shown()[shown().length - 1]).toEqual(['a']);
    reads[1]!.resolve(['a']);
    await expect(outcome).resolves.toBe('done');
    expect(card.state().focus).toBe('next');
  });
});

describe('couldNotLoad', () => {
  it('says what could not load, and what to check', () => {
    expect(couldNotLoad('routines')).toBe('Could not load routines. Check your connection.');
  });
});
