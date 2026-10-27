import { useRef, useState } from 'react';
import { answer, askToDelete, goBack, openDraft, setTime, submit, writeFailed, type EventDraft, type Plan } from './event-draft';
import type { Occurrence } from './calendar-occurrences';

// The event draft's hook (docs/specs/0015): it keeps the current draft and answers at once, so the sheet does not wait for a draw to
// know what a move came to. `latest` is the draft as the last move left it, which the time sheet's Done and a submit read. It
// does not write: a plan goes back to the sheet, which runs it through its change.
export function useEventDraft(from: { date: string } | { occurrence: Occurrence }, timezone: string) {
  const [draft, setDraft] = useState<EventDraft>(() => openDraft(from, timezone));
  const latest = useRef(draft);
  const keep = (next: EventDraft): boolean => {
    if (next === latest.current) return false;
    latest.current = next;
    setDraft(next);
    return true;
  };

  return {
    draft,
    // A move of the draft (event-draft.ts): whether it was one.
    move: (transition: (draft: EventDraft) => EventDraft): boolean => keep(transition(latest.current)),
    // The time sheet's Done: the words that refuse it, or nothing when it was set.
    setTime(which: 'start' | 'end', time: string): string | undefined {
      const next = setTime(latest.current, which, time);
      if ('problem' in next) return next.problem;
      keep(next);
      return undefined;
    },
    // A problem in the form's words, a plan, or neither when the draft is now asking.
    submit(): { problem: string } | { plan: Plan } | undefined {
      const result = submit(latest.current);
      if (!('draft' in result)) return result;
      keep(result.draft);
      return undefined;
    },
    askToDelete: () => keep(askToDelete(latest.current)),
    back: () => keep(goBack(latest.current)),
    failed: () => keep(writeFailed(latest.current)),
    answer: (which: 'one' | 'every'): Plan | null => answer(latest.current, which),
  };
}
