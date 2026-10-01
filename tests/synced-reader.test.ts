import { describe, expect, it } from 'vitest';
import { createSyncedReader } from '../src/lib/synced-reader';

// The optimistic-update seam: a screen shows its own change at once, and a change from another
// Device may arrive while that write is still in flight. What is shown must end as the server's.

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((ok, no) => {
    resolve = ok;
    reject = no;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function harness() {
  const shown: string[][] = [];
  const reads: ReturnType<typeof deferred<string[]>>[] = [];
  const failures: unknown[] = [];
  const reader = createSyncedReader<string[]>(
    () => {
      const read = deferred<string[]>();
      reads.push(read);
      return read.promise;
    },
    (value) => shown.push(value),
    (error) => failures.push(error),
  );
  return { reader, shown, reads, failures };
}

describe('createSyncedReader', () => {
  it('shows what a read returns', async () => {
    const { reader, shown, reads } = harness();
    reader.refresh();
    reads[0]!.resolve(['a']);
    await tick();
    expect(shown).toEqual([['a']]);
  });

  it('holds a change from another device that arrives mid-write, then reads once the write lands', async () => {
    const { reader, shown, reads } = harness();
    const write = deferred<void>();
    const writing = reader.write(() => write.promise);

    // The other tablet's change arrives while this tablet's tick is still in flight: nothing is
    // read now, because that read could overwrite the optimistic tick with the old answer.
    reader.refresh();
    expect(reads).toHaveLength(0);

    write.resolve();
    await writing;
    expect(reads).toHaveLength(1);
    reads[0]!.resolve(['mine', 'theirs']);
    await tick();
    expect(shown).toEqual([['mine', 'theirs']]);
  });

  it('drops a read that began before a write and so may predate it', async () => {
    const { reader, shown, reads } = harness();
    reader.refresh();
    const write = deferred<void>();
    const writing = reader.write(() => write.promise);

    reads[0]!.resolve(['stale']);
    await tick();
    expect(shown).toEqual([]);

    write.resolve();
    await writing;
    reads[1]!.resolve(['fresh']);
    await tick();
    expect(shown).toEqual([['fresh']]);
  });

  it('reads again after a write that failed, so the screen shows what the server holds', async () => {
    const { reader, reads } = harness();
    await expect(reader.write(() => Promise.reject(new Error('no')))).rejects.toThrow('no');
    expect(reads).toHaveLength(1);
  });

  it('waits for the last of several overlapping writes', async () => {
    const { reader, reads } = harness();
    const first = deferred<void>();
    const second = deferred<void>();
    const writes = [reader.write(() => first.promise), reader.write(() => second.promise)];
    reader.refresh();
    first.resolve();
    await writes[0];
    expect(reads).toHaveLength(0);
    second.resolve();
    await writes[1];
    expect(reads).toHaveLength(1);
  });

  it('never applies an older read over a newer one', async () => {
    const { reader, shown, reads } = harness();
    reader.refresh();
    reader.refresh();
    reads[1]!.resolve(['new']);
    await tick();
    reads[0]!.resolve(['old']);
    await tick();
    expect(shown).toEqual([['new']]);
  });

  it('reports a failed read and keeps what is shown', async () => {
    const { reader, shown, reads, failures } = harness();
    reader.refresh();
    reads[0]!.reject(new Error('offline'));
    await tick();
    expect(shown).toEqual([]);
    expect(failures).toHaveLength(1);
  });

  it('stops applying once disposed', async () => {
    const { reader, shown, reads } = harness();
    reader.refresh();
    reader.dispose();
    reads[0]!.resolve(['late']);
    await tick();
    expect(shown).toEqual([]);
  });
});
