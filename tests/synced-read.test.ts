import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { couldNotLoad, createChange, startSyncedRead, type ChangeState, type SyncedRead, type SyncedState } from '../src/lib/synced-read';
import { NOT_SAVED, NOT_SAVED_OFFLINE } from '../src/lib/write-failure';

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

// The change of a card (specs 0011 and 0012): the card write guard, then the write, then the read-back when there is a read, and the
// words of a write that did not go through. Plain TypeScript, so nothing here needs a screen. The guard's cases (once the card write's
// own, in tests/card-write.test.ts) and the failure words' (once `sayFailure`'s) are asserted here through `change`.
describe('createChange', () => {
  const server500 = Object.assign(new Error('boom'), { code: '500' });
  const refused = Object.assign(new Error('too long'), { code: '23514' });
  const PAIR_WORDS = { said: { failed: 'Could not pair. Try again.', offline: 'No internet, so that did not pair. Try again soon.' } };
  const saidAt = (c: { state(): ChangeState }, place: string) => c.state().problems[place];

  describe('the guard', () => {
    it('is free until something runs', () => {
      expect(createChange().state()).toEqual({ busy: false, focus: null, problems: {} });
    });

    it('runs a second press once: a press while the first is busy does nothing', async () => {
      const c = createChange();
      const first = deferred<void>();
      const ran: string[] = [];
      const one = c.change(null, () => (ran.push('first'), first.promise));
      expect(c.state().busy).toBe(true);
      // The same moment, before anything has been drawn: the guard is the core's, not the screen's.
      expect(await c.change(null, async () => void ran.push('second'))).toBe('busy');
      first.resolve();
      expect(await one).toBe('done');
      expect(ran).toEqual(['first']);
      expect(c.state().busy).toBe(false);
      // And a later press goes through.
      expect(await c.change(null, async () => void ran.push('third'))).toBe('done');
      expect(ran).toEqual(['first', 'third']);
    });

    it('does not say a press that did nothing landed or failed', async () => {
      const c = createChange();
      const first = deferred<void>();
      const told: string[] = [];
      const one = c.change(null, () => first.promise);
      await c.change('pair', async () => undefined, { landed: () => void told.push('landed'), failed: () => void told.push('failed') });
      first.resolve();
      await one;
      expect(told).toEqual([]);
      expect(c.state().problems).toEqual({});
    });

    it('lets go after a throw, so one error never leaves the card dead', async () => {
      const c = createChange();
      const failure = new Error('refused');
      const heard: unknown[] = [];
      expect(await c.change(null, () => Promise.reject(failure), { failed: (error) => void heard.push(error) })).toBe('failed');
      expect(heard).toEqual([failure]);
      expect(c.state().busy).toBe(false);
      expect(await c.change(null, async () => undefined)).toBe('done');
    });

    it('lets go after work that throws before it returns a promise', async () => {
      const c = createChange();
      expect(
        await c.change(null, () => {
          throw new Error('at once');
        }),
      ).toBe('failed');
      expect(c.state().busy).toBe(false);
    });

    it('lets go after what the card does on landing throws, and passes that error on', async () => {
      const c = createChange();
      await expect(
        c.change(null, async () => undefined, {
          landed: () => {
            throw new Error('card bug');
          },
        }),
      ).rejects.toThrow('card bug');
      expect(c.state().busy).toBe(false);
    });

    it('is busy while the card is told what landed, and free once it has been', async () => {
      const c = createChange();
      const seen: boolean[] = [];
      await c.change(null, async () => 7, { landed: () => void seen.push(c.state().busy) });
      expect(seen).toEqual([true]);
      expect(c.state().busy).toBe(false);
    });

    it('hands the card what the work returned', async () => {
      const c = createChange();
      const heard: number[] = [];
      await c.change(null, async () => 42, { landed: (value) => void heard.push(value) });
      expect(heard).toEqual([42]);
    });

    it('sends focus where the card says once the work has landed, in the same change that lets go', async () => {
      const c = createChange();
      const states: { busy: boolean; focus: string | null }[] = [];
      c.subscribe(() => states.push(c.state()));
      await c.change(null, async () => 'on', { landed: (next) => (next === 'on' ? 'first-switch' : null) });
      expect(c.state()).toEqual({ busy: false, focus: 'first-switch', problems: {} });
      // Busy, then free with the focus decided: a draw never sees the guard let go with the focus still to be decided.
      expect(states).toEqual([
        { busy: true, focus: null, problems: {} },
        { busy: false, focus: 'first-switch', problems: {} },
      ]);
    });

    it('decides on no focus when the card names none, and when the work failed', async () => {
      const c = createChange();
      await c.change(null, async () => undefined, { landed: () => undefined });
      expect(c.state().focus).toBeNull();
      await c.change(null, () => Promise.reject(new Error('no')), { landed: () => 'never' });
      expect(c.state().focus).toBeNull();
    });

    it('takes focus where the card asks for it outside a write, and forgets it once it has been moved there', () => {
      const c = createChange();
      c.focus('unpair-1');
      expect(c.state().focus).toBe('unpair-1');
      c.focused();
      expect(c.state().focus).toBeNull();
    });

    it('tells its listeners of each change until they stop listening', async () => {
      const c = createChange();
      let heard = 0;
      const stop = c.subscribe(() => (heard += 1));
      await c.change(null, async () => undefined);
      expect(heard).toBe(2);
      stop();
      c.focus('a');
      expect(heard).toBe(2);
    });

    it('hands out the same state until something changes, so a draw is not asked to draw again', async () => {
      const c = createChange();
      const before = c.state();
      expect(c.state()).toBe(before);
      c.clear('nowhere');
      c.clear();
      expect(c.state()).toBe(before);
      await c.change('pair', () => Promise.reject(server500));
      expect(c.state()).not.toBe(before);
    });
  });

  describe('saying a failure', () => {
    it('says it through the failure words when the card does not word it, and the guard lets go', async () => {
      const c = createChange();
      await c.change('pair', () => Promise.reject(server500));
      expect(saidAt(c, 'pair')?.words).toBe(NOT_SAVED);
      await c.change('pair', () => Promise.reject(new TypeError('Failed to fetch')));
      expect(saidAt(c, 'pair')?.words).toBe(NOT_SAVED_OFFLINE);
      expect(c.state().busy).toBe(false);
    });

    it('leaves it to the card when the card words it itself', async () => {
      const c = createChange();
      await c.change('pair', () => Promise.reject(new Error('boom')), { failed: () => true });
      expect(c.state().problems).toEqual({});
    });

    it('says it at the place, with the words, when the card returns false or nothing', async () => {
      const c = createChange();
      const error = new Error('boom');
      await c.change('a', () => Promise.reject(error), { words: PAIR_WORDS, failed: () => false });
      await c.change('b', () => Promise.reject(error), { words: PAIR_WORDS, failed: () => undefined });
      await c.change('c', () => Promise.reject(error), { words: PAIR_WORDS });
      for (const place of ['a', 'b', 'c']) expect(saidAt(c, place)).toMatchObject({ place, words: PAIR_WORDS.said.failed, refused: false });
    });

    it('says nothing when the card names no place, and clears nothing when the work lands', async () => {
      const c = createChange();
      c.say('kept', 'Said before.');
      await c.change(null, () => Promise.reject(new Error('boom')), { words: PAIR_WORDS });
      await c.change(null, async () => undefined);
      expect(Object.keys(c.state().problems)).toEqual(['kept']);
    });

    it('words a value the database refused as the card says, and calls it refused; any other answer gets the default words', async () => {
      const c = createChange();
      const words = { refusal: 'Could not save. Check the name and try again.' };
      await c.change('edit', () => Promise.reject(refused), { words });
      expect(saidAt(c, 'edit')).toMatchObject({ words: words.refusal, refused: true });
      await c.change('edit', () => Promise.reject(server500), { words });
      expect(saidAt(c, 'edit')).toMatchObject({ words: NOT_SAVED, refused: false });
      await c.change('edit', () => Promise.reject(refused));
      expect(saidAt(c, 'edit')).toMatchObject({ words: NOT_SAVED, refused: false });
    });

    it('words an action that is not a save in its own two sentences', async () => {
      const c = createChange();
      await c.change('pair', () => Promise.reject(server500), { words: PAIR_WORDS });
      expect(saidAt(c, 'pair')?.words).toBe(PAIR_WORDS.said.failed);
      await c.change('pair', () => Promise.reject(new TypeError('Failed to fetch')), { words: PAIR_WORDS });
      expect(saidAt(c, 'pair')?.words).toBe(PAIR_WORDS.said.offline);
    });

    it('chooses offline words from the connection when the write fails, not when it was made, and not for an answer', async () => {
      let offline = false;
      const c = createChange({ offline: () => offline });
      const work = deferred<void>();
      const one = c.change('save', () => work.promise);
      offline = true;
      work.reject(new Error('no answer'));
      await one;
      expect(saidAt(c, 'save')?.words).toBe(NOT_SAVED_OFFLINE);
      // The server answered, so the connection is not why it failed.
      await c.change('save', () => Promise.reject(server500));
      expect(saidAt(c, 'save')?.words).toBe(NOT_SAVED);
    });

    it('says what the card chose itself, at a place, refused or not', () => {
      const c = createChange();
      c.say('add', 'Give the person a name.', true);
      c.say('invite', 'Could not copy.');
      expect(saidAt(c, 'add')).toMatchObject({ words: 'Give the person a name.', refused: true });
      expect(saidAt(c, 'invite')).toMatchObject({ words: 'Could not copy.', refused: false });
    });
  });

  describe('the words, repeated and cleared', () => {
    it('says a repeat of the same failure again: the count goes up though the words are the same', async () => {
      const c = createChange();
      await c.change('add', () => Promise.reject(server500));
      const first = saidAt(c, 'add')!;
      await c.change('add', () => Promise.reject(server500));
      const second = saidAt(c, 'add')!;
      expect(second.words).toBe(first.words);
      expect(second.n).toBeGreaterThan(first.n);
    });

    it('counts what has been said across places, so two rows that both failed both say so', async () => {
      const c = createChange();
      await c.change('move-1', () => Promise.reject(server500));
      await c.change('move-2', () => Promise.reject(server500));
      expect(Object.keys(c.state().problems)).toEqual(['move-1', 'move-2']);
      expect(saidAt(c, 'move-2')!.n).toBe(saidAt(c, 'move-1')!.n + 1);
    });

    it('keeps the words while a retry is on its way, and takes them away only when it lands, and only its own place', async () => {
      const c = createChange();
      await c.change('add', () => Promise.reject(server500));
      await c.change('move', () => Promise.reject(server500));
      const retry = deferred<void>();
      const one = c.change('add', () => retry.promise);
      expect(saidAt(c, 'add')).toBeDefined();
      retry.resolve();
      await one;
      expect(Object.keys(c.state().problems)).toEqual(['move']);
    });

    it('replaces the words of a place with the new failure when the work there fails again', async () => {
      const c = createChange();
      await c.change('add', () => Promise.reject(refused), { words: { refusal: 'Check the name.' } });
      await c.change('add', () => Promise.reject(server500), { words: { refusal: 'Check the name.' } });
      expect(saidAt(c, 'add')).toMatchObject({ words: NOT_SAVED, refused: false });
    });

    it('takes away what was said in one place, or everywhere when none is named, and tells no one when there was nothing', async () => {
      const c = createChange();
      c.say('a', 'one');
      c.say('b', 'two');
      let heard = 0;
      c.subscribe(() => (heard += 1));
      c.clear('a');
      expect(Object.keys(c.state().problems)).toEqual(['b']);
      c.clear('a');
      expect(heard).toBe(1);
      c.clear();
      expect(c.state().problems).toEqual({});
      c.clear();
      expect(heard).toBe(2);
    });
  });

  describe('with a read', () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    function changing() {
      const h = harness();
      return { ...h, c: createChange<string[]>({ read: () => h.read }) };
    }

    it('is done once the work landed and the read after it has settled, and says what landed only then', async () => {
      const { reads, c } = changing();
      reads[0]!.resolve(['a']);
      await settle();
      const told: string[] = [];
      const work = deferred<string>();
      let outcome: string | undefined;
      void c.change('add', () => work.promise, { landed: (value) => void told.push(value) }).then((result) => (outcome = result));
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

    it('takes away the words of its place when the work lands, before the read after it has', async () => {
      const { reads, c } = changing();
      reads[0]!.resolve(['a']);
      await settle();
      await c.change('add', () => Promise.reject(server500));
      reads[1]!.resolve(['a']);
      await settle();
      expect(saidAt(c, 'add')).toBeDefined();
      void c.change('add', async () => undefined);
      await settle();
      expect(reads).toHaveLength(3);
      expect(saidAt(c, 'add')).toBeUndefined();
    });

    it('is failed when the work threw: said first, no read-back waited for, and the guard let go', async () => {
      const { c, reads } = changing();
      reads[0]!.resolve(['a']);
      await settle();
      const heard: unknown[] = [];
      const landed = vi.fn();
      const outcome = await c.change('add', () => Promise.reject(new Error('no')), { failed: (error) => void heard.push(error), landed });
      expect(outcome).toBe('failed');
      expect(heard).toEqual([new Error('no')]);
      expect(landed).not.toHaveBeenCalled();
      expect(c.state().busy).toBe(false);
      // The read that follows the write still comes, in its own time.
      expect(reads).toHaveLength(2);
    });

    it('says a failure at its place in the words of the screen, with a read as without', async () => {
      const { c, reads } = changing();
      reads[0]!.resolve(['a']);
      await settle();
      await c.change('add', () => Promise.reject(server500));
      expect(saidAt(c, 'add')?.words).toBe(NOT_SAVED);
    });

    it('is busy, and does nothing, while another change is on its way', async () => {
      const { c, reads } = changing();
      reads[0]!.resolve(['a']);
      await settle();
      const first = deferred<void>();
      const firstOutcome = c.change('add', () => first.promise);
      expect(c.state().busy).toBe(true);
      const work = vi.fn(async () => undefined);
      const landed = vi.fn();
      await expect(c.change('add', work, { landed })).resolves.toBe('busy');
      expect(work).not.toHaveBeenCalled();
      expect(landed).not.toHaveBeenCalled();
      first.resolve();
      await settle();
      reads[1]!.resolve(['a']);
      await expect(firstOutcome).resolves.toBe('done');
      expect(c.state().busy).toBe(false);
    });

    it('shows what the write landed with from its result until the read after it, and goes on to the focus the card names', async () => {
      const { reads, c, shown } = changing();
      reads[0]!.resolve(['a', 'b']);
      await settle();
      const outcome = c.change('add', async () => 'b', { meanwhile: (gone) => (items) => items.filter((item) => item !== gone), landed: () => 'next' });
      await settle();
      expect(shown()[shown().length - 1]).toEqual(['a']);
      reads[1]!.resolve(['a']);
      await expect(outcome).resolves.toBe('done');
      expect(c.state().focus).toBe('next');
    });
  });

  describe('without a read', () => {
    it('is done as soon as the work landed: there is nothing to read back', async () => {
      const c = createChange();
      const told: string[] = [];
      const work = deferred<string>();
      const outcome = c.change('household', () => work.promise, { landed: (value) => void told.push(value) });
      expect(c.state().busy).toBe(true);
      work.resolve('saved');
      expect(await outcome).toBe('done');
      expect(told).toEqual(['saved']);
      expect(c.state().busy).toBe(false);
    });

    it('asks for its read when it changes, so a screen that makes its read again is written through the new one', async () => {
      const written: string[] = [];
      const screen: { read?: Pick<SyncedRead<string[]>, 'write' | 'readBack'> } = {};
      const c = createChange<string[]>({ read: () => screen.read });
      await c.change(null, async () => undefined);
      screen.read = {
        write: async (work) => (written.push('write'), work()),
        readBack: async () => void written.push('readBack'),
      };
      await c.change(null, async () => undefined);
      expect(written).toEqual(['write', 'readBack']);
    });
  });
});

describe('couldNotLoad', () => {
  it('says what could not load, and what to check', () => {
    expect(couldNotLoad('routines')).toBe('Could not load routines. Check your connection.');
  });
});
