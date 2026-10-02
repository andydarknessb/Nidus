import { createContext, useContext } from 'react';

// The Wall's status line: one line at the foot of the screen that says what just happened, for six seconds. A
// newer line replaces an older one. Nothing here is saved or sent anywhere. The state holder is plain TypeScript
// with a timer, so a test fakes the clock rather than waiting for one; components/StatusLine.tsx draws it.

// How long a line stays up.
export const STATUS_LINE_MS = 6_000;

export type StatusLine = {
  // The line being shown, or '' when there is none.
  line(): string;
  // Shows `words` in place of what is there, for six seconds from now.
  say(words: string): void;
  // Calls `listener` after each change. Returns the function that stops it.
  subscribe(listener: () => void): () => void;
  // Stops the timer, for when the screen that held the line is gone.
  dispose(): void;
};

export function createStatusLine(): StatusLine {
  let line = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const set = (words: string) => {
    line = words;
    listeners.forEach((listener) => listener());
  };

  return {
    line: () => line,
    say(words) {
      // The older line's timer must not take the newer line down.
      clearTimeout(timer);
      timer = setTimeout(() => set(''), STATUS_LINE_MS);
      set(words);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose: () => clearTimeout(timer),
  };
}

// What a component says a line with: `const say = useStatusLine(); say('Added milk')`. With no provider (a screen
// under test, the phone) saying does nothing.
export const StatusLineContext = createContext<(words: string) => void>(() => undefined);

export function useStatusLine(): (words: string) => void {
  return useContext(StatusLineContext);
}
