import { describe, expect, it } from 'vitest';
import { createCardWrite } from '../src/lib/card-write';
import { NOT_SAVED, NOT_SAVED_OFFLINE, writeFailureWords } from '../src/lib/write-failure';

// The card write guard: one-shot actions on a Settings card go one at a time, the guard is let go on every exit, and the card says where
// focus goes afterwards. Plain TypeScript, so nothing here needs a screen.

// A write that waits until the test says it is done.
function slow<T = void>() {
  let finish!: (value: T) => void;
  let fail!: (error: unknown) => void;
  const promise = new Promise<T>((resolve, reject) => ((finish = resolve), (fail = reject)));
  return { promise, finish, fail };
}

describe('the card write guard', () => {
  it('is free until something runs', () => {
    expect(createCardWrite().state()).toEqual({ busy: false, focus: null });
  });

  it('runs a second press once: a press while the first is busy does nothing', async () => {
    const card = createCardWrite();
    const first = slow();
    const ran: string[] = [];
    const one = card.run(() => (ran.push('first'), first.promise));
    expect(card.state().busy).toBe(true);
    // The same moment, before anything has been drawn: the guard is the core's, not the screen's.
    expect(await card.run(async () => void ran.push('second'))).toBe('busy');
    first.finish();
    expect(await one).toBe('done');
    expect(ran).toEqual(['first']);
    expect(card.state().busy).toBe(false);
    // And a later press goes through.
    expect(await card.run(async () => void ran.push('third'))).toBe('done');
    expect(ran).toEqual(['first', 'third']);
  });

  it('does not say a press that did nothing landed or failed', async () => {
    const card = createCardWrite();
    const first = slow();
    const told: string[] = [];
    const one = card.run(() => first.promise);
    await card.run(async () => undefined, { landed: () => void told.push('landed'), failed: () => void told.push('failed') });
    first.finish();
    await one;
    expect(told).toEqual([]);
  });

  it('lets go after a throw, so one error never leaves the card dead', async () => {
    const card = createCardWrite();
    const failure = new Error('refused');
    const heard: unknown[] = [];
    expect(await card.run(() => Promise.reject(failure), { failed: (error) => void heard.push(error) })).toBe('failed');
    expect(heard).toEqual([failure]);
    expect(card.state().busy).toBe(false);
    expect(await card.run(async () => undefined)).toBe('done');
  });

  it('lets go after work that throws before it returns a promise', async () => {
    const card = createCardWrite();
    expect(
      await card.run(() => {
        throw new Error('at once');
      }),
    ).toBe('failed');
    expect(card.state().busy).toBe(false);
  });

  it('lets go after what the card does on landing throws, and passes that error on', async () => {
    const card = createCardWrite();
    await expect(
      card.run(async () => undefined, {
        landed: () => {
          throw new Error('card bug');
        },
      }),
    ).rejects.toThrow('card bug');
    expect(card.state().busy).toBe(false);
  });

  it('is busy while the card is told what landed, and free once it has been', async () => {
    const card = createCardWrite();
    const seen: boolean[] = [];
    await card.run(async () => 7, { landed: () => void seen.push(card.state().busy) });
    expect(seen).toEqual([true]);
    expect(card.state().busy).toBe(false);
  });

  it('hands the card what the work returned', async () => {
    const card = createCardWrite();
    const heard: number[] = [];
    await card.run(async () => 42, { landed: (value) => void heard.push(value) });
    expect(heard).toEqual([42]);
  });

  it('sends focus where the card says once the work has landed, in the same change that lets go', async () => {
    const card = createCardWrite();
    const states: { busy: boolean; focus: string | null }[] = [];
    card.subscribe(() => states.push(card.state()));
    await card.run(async () => 'on', { landed: (next) => (next === 'on' ? 'first-switch' : null) });
    expect(card.state()).toEqual({ busy: false, focus: 'first-switch' });
    // Busy, then free with the focus decided: a draw never sees the guard let go with the focus still to be decided.
    expect(states).toEqual([
      { busy: true, focus: null },
      { busy: false, focus: 'first-switch' },
    ]);
  });

  it('decides on no focus when the card names none, and when the work failed', async () => {
    const card = createCardWrite();
    await card.run(async () => undefined, { landed: () => undefined });
    expect(card.state().focus).toBeNull();
    await card.run(() => Promise.reject(new Error('no')), { landed: () => 'never' });
    expect(card.state().focus).toBeNull();
  });

  it('takes focus where the card asks for it outside a write, and forgets it once it has been moved there', () => {
    const card = createCardWrite();
    card.focus('unpair-1');
    expect(card.state().focus).toBe('unpair-1');
    card.focused();
    expect(card.state().focus).toBeNull();
  });

  it('tells its listeners of each change until they stop listening', async () => {
    const card = createCardWrite();
    let heard = 0;
    const stop = card.subscribe(() => (heard += 1));
    await card.run(async () => undefined);
    expect(heard).toBe(2);
    stop();
    card.focus('a');
    expect(heard).toBe(2);
  });

  // The words a failure is said in are the write-problem words (use-write-problem), which the card hands the error to.
  it('hands the failure on as it was thrown, for the write-problem words', async () => {
    const card = createCardWrite();
    const said: string[] = [];
    const words = (error: unknown) => said.push(writeFailureWords(error, { offline: false }));
    await card.run(() => Promise.reject(Object.assign(new Error('boom'), { code: '500' })), { failed: words });
    await card.run(() => Promise.reject(new TypeError('Failed to fetch')), { failed: words });
    expect(said).toEqual([NOT_SAVED, NOT_SAVED_OFFLINE]);
  });
});
