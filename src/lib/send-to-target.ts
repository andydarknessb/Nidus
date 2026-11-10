// The message Send to Target shows, sends and opens (docs/specs/0019-the-shopper.md, "The Send to Target sheet"). Pure: the items to get
// in their order, then each Usual whose name is in one of them (the Household's Usuals, src/lib/usuals.ts). Also the send: what each
// press does, over the phone's share and copy and the list's mark-sent write (docs/specs/0020, "The send").

import type { CardWriteOutcome } from './change';
import type { Usual as HouseholdUsual } from './usuals';

export type Usual = Pick<HouseholdUsual, 'name' | 'product' | 'target_link'>;

// ChatGPT takes at most this many characters of link, so an Open link longer than that is not offered.
export const CHATGPT_LINK_LIMIT = 8000;

// Whole words, any case: "milk" is named in "Whole milk" and not in "Milkshake".
const wordsOf = (text: string) => text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

export function namedIn(text: string, name: string): boolean {
  const wanted = wordsOf(name);
  const words = wordsOf(text);
  return wanted.length > 0 && words.some((_, start) => wanted.every((word, offset) => words[start + offset] === word));
}

export function targetMessage(items: { text: string }[], usuals: Usual[]): string {
  const named = usuals.filter((usual) => items.some((item) => namedIn(item.text, usual.name)));
  const lines = ['Target, please build a cart with these items:', ...items.map((item) => `- ${item.text}`)];
  if (named.length > 0) {
    lines.push('', 'Use our usual product when one fits:', ...named.map((usual) => `- ${usual.name}: ${usual.product}${usual.target_link ? ` (${usual.target_link})` : ''}`));
  }
  lines.push('', 'Ask me before swapping anything.');
  return lines.join('\n');
}

// The Open link, or null when the link is longer than ChatGPT takes (the sheet then offers no Open).
export function chatGptLink(message: string): string | null {
  const link = `https://chatgpt.com/?q=${encodeURIComponent(message)}`;
  return link.length <= CHATGPT_LINK_LIMIT ? link : null;
}

// What a share that threw says: a share sheet the person closed says nothing; any other failure says so.
function shareFailure(error: unknown): string {
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  return name === 'AbortError' ? '' : "Couldn't share. Try Copy.";
}

// The phone's side of a press, and the list's: what the message is now, whether a write is on its way (the list's, or the Usuals not yet
// read), the share sheet (absent when the phone has none), the copy, and the mark-sent write (the list's change).
export type SendAdapters = {
  message: () => string;
  busy: () => boolean;
  share?: ((data: { text: string }) => Promise<void>) | undefined;
  copy: (text: string) => Promise<void>;
  mark: () => Promise<CardWriteOutcome>;
};

export type SendState = { said: string; copied: boolean };

// What a press of Send to Target does (docs/specs/0020, "The send"). Open marks the list sent and says whether the link is to be
// followed; a share that resolves marks it, a share the person closed marks nothing and says nothing, any other failure says so; a copy
// that worked says Copied and marks it, one that failed says so and marks nothing. A press while a mark or the share sheet is on its way
// does nothing. A share is called in the press's own turn, since the browser allows it only from a press.
export function createSend(adapters: SendAdapters) {
  let state: SendState = { said: '', copied: false };
  const listeners = new Set<() => void>();
  const set = (next: Partial<SendState>) => {
    state = { ...state, ...next };
    listeners.forEach((listener) => listener());
  };
  let marking = false;
  let sharing = false;
  const idle = () => !marking && !sharing && !adapters.busy();

  const mark = async () => {
    marking = true;
    try {
      await adapters.mark();
    } finally {
      marking = false;
    }
  };

  return {
    state: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    // Returns whether the link is to be followed.
    open(): boolean {
      if (!idle()) return false;
      set({ said: '' });
      void mark();
      return true;
    },
    async share(): Promise<void> {
      const share = adapters.share;
      if (!share || !idle()) return;
      sharing = true;
      set({ said: '' });
      let said = '';
      let marks = true;
      try {
        await share({ text: adapters.message() });
      } catch (error) {
        marks = false;
        said = shareFailure(error);
      } finally {
        sharing = false;
      }
      set({ said });
      if (marks) await mark();
    },
    async copy(): Promise<void> {
      if (!idle()) return;
      set({ said: '' });
      try {
        await adapters.copy(adapters.message());
      } catch {
        set({ copied: false, said: "Couldn't copy. Select the message and copy it by hand." });
        return;
      }
      set({ copied: true });
      await mark();
    },
  };
}
