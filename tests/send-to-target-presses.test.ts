import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { createChange as CreateChange } from '../src/lib/change';
import type { createSend as CreateSend } from '../src/lib/send-to-target';

// Every press of Send to Target (docs/specs/0020, "The send"), driven with a fake share, a fake copy and a real change. The mark-sent
// write is the list's change at its own place (ADR 0006), so what a press came to is tested here without a screen.

vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');

let createChange: typeof CreateChange;
let createSend: typeof CreateSend;
beforeAll(async () => {
  ({ createChange } = await import('../src/lib/change'));
  ({ createSend } = await import('../src/lib/send-to-target'));
});

const MESSAGE = 'Target, please build a cart with these items:';
const COPY_FAILED = "Couldn't copy. Select the message and copy it by hand.";
const SHARE_FAILED = "Couldn't share. Try Copy.";

// A write or a share the test settles by hand, for a press that is still on its way.
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

// Lets every settled promise run on before the test looks.
const settle = () => new Promise((done) => setTimeout(done, 0));

// `busy` defaults to the change's live state; a test gives its own to show the send refuses on the sheet's word alone.
function setup(options: { share?: boolean; busy?: () => boolean } = {}) {
  const change = createChange();
  const work = vi.fn(async () => 1);
  const share = vi.fn<(data: { text: string }) => Promise<void>>(async () => {});
  const copy = vi.fn<(text: string) => Promise<void>>(async () => {});
  const send = createSend({
    message: () => MESSAGE,
    busy: options.busy ?? change.isBusy,
    share: options.share === false ? undefined : share,
    copy,
    mark: () => change.change('sent-l', work),
  });
  return { change, send, share, copy, work };
}

describe('Open in ChatGPT', () => {
  it('follows the link and marks the list sent', async () => {
    const { send, work } = setup();
    expect(send.open()).toBe(true);
    await settle();
    expect(work).toHaveBeenCalledTimes(1);
    expect(send.state()).toEqual({ said: '', copied: false });
  });

  it('does not follow, and marks nothing, while a write is on its way', () => {
    const { change, send, work } = setup();
    const held = deferred();
    void change.change('got-l', () => held.promise);
    expect(send.open()).toBe(false);
    expect(work).not.toHaveBeenCalled();
    held.resolve();
  });
});

describe('Share', () => {
  it('calls share in the same turn as the press, with the message', () => {
    const { send, share } = setup();
    void send.share();
    expect(share).toHaveBeenCalledTimes(1);
    expect(share).toHaveBeenCalledWith({ text: MESSAGE });
  });

  it('marks the list sent when the share resolved, and says nothing', async () => {
    const { send, work } = setup();
    await send.share();
    expect(work).toHaveBeenCalledTimes(1);
    expect(send.state()).toEqual({ said: '', copied: false });
  });

  it('marks nothing and says nothing when the person closed the share sheet', async () => {
    const { send, share, work } = setup();
    share.mockRejectedValueOnce(new DOMException('Share canceled', 'AbortError'));
    await send.share();
    expect(work).not.toHaveBeenCalled();
    expect(send.state()).toEqual({ said: '', copied: false });
  });

  it('marks nothing and says so when the share failed for another reason', async () => {
    const { send, share, work } = setup();
    share.mockRejectedValueOnce(new Error('not allowed'));
    await send.share();
    expect(work).not.toHaveBeenCalled();
    expect(send.state()).toEqual({ said: SHARE_FAILED, copied: false });
  });

  it('does nothing on a phone with no share sheet', async () => {
    const { send, share, work } = setup({ share: false });
    await send.share();
    expect(share).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });
});

describe('Copy', () => {
  it('says Copied and marks the list sent when the copy worked', async () => {
    const { send, copy, work } = setup();
    await send.copy();
    expect(copy).toHaveBeenCalledWith(MESSAGE);
    expect(send.state()).toEqual({ said: '', copied: true });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it('says so and marks nothing when the copy failed', async () => {
    const { send, copy, work } = setup();
    copy.mockRejectedValueOnce(new Error('denied'));
    await send.copy();
    expect(send.state()).toEqual({ said: COPY_FAILED, copied: false });
    expect(work).not.toHaveBeenCalled();
  });
});

describe('a press while a mark or a share is on its way', () => {
  it('does nothing while the sheet says a write is on its way, even when no mark is pending', async () => {
    const { send, copy, share, work } = setup({ busy: () => false });
    const held = deferred();
    work.mockImplementationOnce(() => held.promise.then(() => 1));
    expect(send.open()).toBe(true);
    // The sheet has not drawn the mark yet, so its busy is still false: only the send's own flag refuses these.
    expect(send.open()).toBe(false);
    await send.copy();
    await send.share();
    expect(copy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(work).toHaveBeenCalledTimes(1);
    held.resolve();
  });

  it('refuses Copy and Share while the sheet says a write is on its way', async () => {
    const { send, copy, share, work } = setup({ busy: () => true });
    await send.copy();
    await send.share();
    expect(copy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(work).not.toHaveBeenCalled();
  });

  it('does nothing while a mark is on its way: no second mark, no link, no copy, no share', async () => {
    const { send, copy, share, work } = setup();
    const held = deferred();
    work.mockImplementationOnce(() => held.promise.then(() => 1));
    expect(send.open()).toBe(true);
    expect(send.open()).toBe(false);
    await send.copy();
    await send.share();
    expect(copy).not.toHaveBeenCalled();
    expect(share).not.toHaveBeenCalled();
    expect(work).toHaveBeenCalledTimes(1);
    held.resolve();
  });

  it('does nothing while the share sheet is open: no second share, no link, no copy', async () => {
    const { send, copy, share, work } = setup();
    const held = deferred();
    share.mockImplementationOnce(() => held.promise);
    const first = send.share();
    await send.share();
    expect(share).toHaveBeenCalledTimes(1);
    expect(send.open()).toBe(false);
    await send.copy();
    expect(copy).not.toHaveBeenCalled();
    held.resolve();
    await first;
    expect(work).toHaveBeenCalledTimes(1);
  });
});

describe('a mark that did not land', () => {
  it("is said at the list's own place, and nowhere else", async () => {
    const { change, send, work } = setup();
    work.mockRejectedValueOnce(new Error('boom'));
    await send.share();
    expect(change.state().problems['sent-l']).toMatchObject({ place: 'sent-l' });
    expect(change.state().problems['got-l']).toBeUndefined();
  });

  it('is taken away by the next mark that lands', async () => {
    const { change, send, work } = setup();
    work.mockRejectedValueOnce(new Error('boom'));
    await send.share();
    expect(change.state().problems['sent-l']).toBeDefined();
    await send.share();
    expect(work).toHaveBeenCalledTimes(2);
    expect(change.state().problems['sent-l']).toBeUndefined();
  });
});
