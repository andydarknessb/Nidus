import { useCallback, useEffect, useState } from 'react';
import { createCardWrite, type CardWriteOutcome } from './card-write';
import type { useWriteProblem } from './use-write-problem';

// The card write guard (card-write.ts) on a card: it wires the core to state, draws nothing itself, and moves focus once the control the
// card named is on screen (the swap unmounts whatever had it). The card draws `aria-disabled={busy || undefined}`, never `disabled`.

type FailWords = Parameters<ReturnType<typeof useWriteProblem>['fail']>[2];

export type CardAction<T> = {
  // Where a failure says so (useWriteProblem's place), and in whose words when they are not the default two.
  place?: string | undefined;
  words?: FailWords | undefined;
  // A failure the card words itself (a code the server said is not valid). Return true when it did; otherwise the write-problem
  // words say it at `place`.
  failed?: ((error: unknown) => boolean | void) | undefined;
  // What the card does once the action landed; the id it returns is where focus goes.
  landed?: ((value: T) => string | null | undefined | void) | undefined;
};

export function useCardWrite(problems?: Pick<ReturnType<typeof useWriteProblem>, 'fail'>) {
  const [core] = useState(createCardWrite);
  const [state, setState] = useState(core.state);

  useEffect(() => {
    setState(core.state());
    return core.subscribe(() => setState(core.state()));
  }, [core]);

  // Moves focus once the control it names is on screen.
  useEffect(() => {
    if (state.focus === null) return;
    document.getElementById(state.focus)?.focus();
    core.focused();
  }, [core, state.focus]);

  const fail = problems?.fail;
  const run = useCallback(
    <T>(work: () => Promise<T>, action: CardAction<T> = {}): Promise<CardWriteOutcome> =>
      core.run(work, {
        landed: action.landed,
        failed: (error) => {
          if (action.failed?.(error) === true) return;
          if (fail && action.place !== undefined) fail(action.place, error, action.words);
        },
      }),
    [core, fail],
  );
  const focus = useCallback((id: string) => core.focus(id), [core]);
  // Whether an action is on its way now, for a handler that must not start anything else when one is (`busy` is as of the last draw).
  const isBusy = useCallback(() => core.state().busy, [core]);

  return { busy: state.busy, isBusy, run, focus };
}
