import { useCallback, useEffect, useRef } from 'react';
import { useConnection } from './change-feed';
import { writeFailureWords } from './write-failure';

// What a write on the Wall that did not go through says: the phone's two sentences (write-failure.ts), so the family reads one thing
// for one trouble, whether it was a tick, an item, a meal or an event. "No internet, so that did not save. Try again soon." when the
// screen could not reach the server, otherwise "That did not save. Try again." Chosen when the write fails, from what the screen knows
// of its connection then (not when the write was made), and an error that says it never got an answer is offline whatever the screen
// thought. Each screen keeps its words where it draws them.
export function useFailureWords(): (error: unknown) => string {
  const offline = useRef(false);
  const connection = useConnection();
  useEffect(() => {
    offline.current = connection === 'offline';
  }, [connection]);
  return useCallback((error: unknown) => writeFailureWords(error, { offline: offline.current }), []);
}
