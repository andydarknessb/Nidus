// The message Send to Target shows, sends and opens (docs/specs/0019-the-shopper.md, "The Send to Target sheet"). Pure: the items to get
// in their order, then each Usual whose name is in one of them (the Household's Usuals, src/lib/usuals.ts).

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

// What a Share that ended means (the sheet calls it with the error, or undefined when the share resolved): a resolved share marks the
// list sent; a share sheet the person closed marks nothing and says nothing; any other failure marks nothing and says so.
export function shareEnd(error: unknown): { marks: boolean; said: string } {
  if (error === undefined) return { marks: true, said: '' };
  const name = typeof error === 'object' && error !== null && 'name' in error ? error.name : '';
  return name === 'AbortError' ? { marks: false, said: '' } : { marks: false, said: "Couldn't share. Try Copy." };
}
