import { useCallback, useEffect, useRef, useState } from 'react';
import { useConnection } from './change-feed';
import { isRefusal, writeFailureWords } from './write-failure';

// A write on the phone that did not go through, with where it was made. It is said at once, in the place the person is looking
// (inside the open form, under the row that failed), and it stays there until that place is written again, closed, or the person
// answers the question: reading the screen again never clears it, since a read that succeeds says nothing of whether a write did.
// A trouble reading is its own thing, and a section keeps it apart. Each place has its own, so two rows that both failed both say
// so. `n` counts what has been said, so that a retry that fails again is a new alert, heard again, though its words are the same.
export type WriteProblem = { place: string; words: string; n: number; refused: boolean };

export function useWriteProblem() {
  const [problems, setProblems] = useState<Record<string, WriteProblem>>({});
  const said = useRef(0);
  // Whether the screen is offline when a write fails, which decides what that write says: read when it fails, not when it was made.
  const offline = useRef(false);
  const connection = useConnection();
  useEffect(() => {
    offline.current = connection === 'offline';
  }, [connection]);

  const put = useCallback((place: string, words: string, refused: boolean) => {
    said.current += 1;
    const problem = { place, words, refused, n: said.current };
    setProblems((all) => ({ ...all, [place]: problem }));
  }, []);

  const fail = useCallback(
    (place: string, error: unknown, words: { refusal?: string; said?: { failed: string; offline: string } } = {}) => {
      const sentence = writeFailureWords(error, { offline: offline.current, refusal: words.refusal, said: words.said });
      put(place, sentence, words.refusal !== undefined && isRefusal(error));
    },
    [put],
  );
  // A sentence the caller has chosen itself (a code the server said is not valid), `refused` when it is about a field.
  const say = useCallback((place: string, words: string, refused = false) => put(place, words, refused), [put]);
  // Takes away what was said in `place`, or everywhere when no place is named: a write that landed takes away its own failure, and
  // opening or closing a form takes away what another one said. Nothing is taken away when a retry starts: the words stay until
  // there is an answer, so that the screen does not move under the finger that is pressing.
  const clear = useCallback((place?: string) => {
    setProblems((all) => {
      if (place === undefined) return Object.keys(all).length === 0 ? all : {};
      if (!(place in all)) return all;
      const next = { ...all };
      delete next[place];
      return next;
    });
  }, []);
  // The problem, when it was made in this place.
  const at = (place: string): WriteProblem | null => problems[place] ?? null;

  return { fail, say, clear, at };
}
