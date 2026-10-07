import { useEffect, useRef, useState } from 'react';
import { EmptyRing, Tick } from '@/components/people';
import { Card, Field, Problem, fieldClass, helpClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { REMINDER_MINUTES, pushSupport, readPushState, savePushPreferences, sendTestNotification, turnOffNotifications, turnOnNotifications, type PushPreferences, type PushState, type PushSupport } from '@/lib/push';
import { loadPinnedListName } from '@/lib/shared-lists';
import { supabase } from '@/lib/supabase';
import { useWriteProblem, type WriteProblem } from '@/lib/use-write-problem';

// What the status line says: nothing, or what the last tap did.
export type NotificationsStatus = 'idle' | 'saved' | 'test';

const statusWords: Record<NotificationsStatus, string> = { idle: '', saved: 'Saved', test: 'Test sent' };

export const UNSUPPORTED_WORDS = 'This browser cannot show notifications from Nidus.';
export const HOME_SCREEN_WORDS = 'On iPhone, notifications need Nidus on your Home Screen. In Safari, tap Share, then Add to Home Screen, then open Nidus from the new icon and come back here.';
export const OFF_WORDS = 'Get reminders and updates on this phone, even when Nidus is closed.';
export const DENIED_WORDS = "Notifications are blocked for Nidus on this phone. Allow them in the phone's settings, then come back here.";
export const LOCK_SCREEN_WORDS = 'Notifications can show event names on your lock screen.';
export const LOAD_FAILED = 'Could not check notifications on this phone. Check your connection.';

// Where a write that failed says so: under the buttons, whichever it was.
const PLACE = 'notifications';

const TURN_ON_SAID = { failed: 'Could not turn on notifications. Try again.', offline: 'No internet, so notifications were not turned on. Try again soon.' };
const TURN_OFF_SAID = { failed: 'Could not turn off notifications. Try again.', offline: 'No internet, so notifications were not turned off. Try again soon.' };
const TEST_SAID = { failed: 'Could not send a test. Try again.', offline: 'No internet, so the test was not sent. Try again soon.' };

// A row of the card: the whole row is a labelled checkbox, 48 tall at least, drawn as the app's own tick or empty ring. A change
// while a write is on its way is ignored, and the row says so with `aria-disabled`, never `disabled`.
function Switch({ label, checked, busy, onChange }: { label: string; checked: boolean; busy: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="relative flex min-h-12 items-center gap-3 rounded-lg text-[17px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
      <input
        type="checkbox"
        className="absolute inset-0 size-full cursor-pointer opacity-0"
        checked={checked}
        aria-disabled={busy || undefined}
        onChange={(event) => {
          if (!busy) onChange(event.target.checked);
        }}
      />
      {checked ? <Tick size={28} /> : <EmptyRing size={28} width={2.5} />}
      <span className="min-w-0 break-words">{label}</span>
    </label>
  );
}

type ViewProps = {
  support: PushSupport;
  // null until the first read lands.
  state: PushState | null;
  // The pinned list's name, or null when there is none.
  listName: string | null;
  busy: boolean;
  status: NotificationsStatus;
  loadProblem: string | null;
  problem: WriteProblem | null;
  onTurnOn: () => void;
  onTurnOff: () => void;
  onTest: () => void;
  onChange: (preferences: PushPreferences) => void;
};

// What the card draws, from what it is told: each of its states is rendered in tests/notifications-section.test.ts.
export function NotificationsView({ support, state, listName, busy, status, loadProblem, problem, onTurnOn, onTurnOff, onTest, onChange }: ViewProps) {
  // A tap while a write is on its way does nothing; the button says so with `aria-disabled`, never `disabled`.
  const guarded = (action: () => void) => () => {
    if (!busy) action();
  };
  const change = (preferences: PushPreferences, part: Partial<PushPreferences>) => onChange({ ...preferences, ...part });
  return (
    <Card title="Notifications on this phone">
      {loadProblem && (
        <p role="alert" className="text-base">
          {loadProblem}
        </p>
      )}
      {support === 'unsupported' && <p className="text-base">{UNSUPPORTED_WORDS}</p>}
      {support === 'needs-home-screen' && <p className="text-base">{HOME_SCREEN_WORDS}</p>}
      {support === 'supported' && state?.kind === 'off' && (
        <>
          <p className="text-base">{OFF_WORDS}</p>
          <Button variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(onTurnOn)}>
            Turn on notifications
          </Button>
        </>
      )}
      {support === 'supported' && state?.kind === 'denied' && <p className="text-base">{DENIED_WORDS}</p>}
      {support === 'supported' && state?.kind === 'on' && (
        <>
          <div className="flex flex-col gap-2">
            <Switch label="Event reminders" checked={state.preferences.eventReminders} busy={busy} onChange={(eventReminders) => change(state.preferences, { eventReminders })} />
            <Field label="How long before">
              <select
                className={fieldClass}
                value={state.preferences.reminderMinutes}
                aria-disabled={busy || undefined}
                onChange={(event) => {
                  if (!busy) change(state.preferences, { reminderMinutes: Number(event.target.value) as PushPreferences['reminderMinutes'] });
                }}
              >
                {REMINDER_MINUTES.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {minutes} minutes
                  </option>
                ))}
              </select>
            </Field>
          </div>
          <Switch label="Morning summary at 7 AM" checked={state.preferences.morningSummary} busy={busy} onChange={(morningSummary) => change(state.preferences, { morningSummary })} />
          <Switch label="Routines not done at 7 PM" checked={state.preferences.routinesNudge} busy={busy} onChange={(routinesNudge) => change(state.preferences, { routinesNudge })} />
          <Switch label={`Added to ${listName ?? 'the shopping list'}`} checked={state.preferences.listAdditions} busy={busy} onChange={(listAdditions) => change(state.preferences, { listAdditions })} />
          <p className={helpClass}>{LOCK_SCREEN_WORDS}</p>
          <Button variant="secondary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(onTest)}>
            Send a test
          </Button>
          <Button variant="quiet" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(onTurnOff)}>
            Turn off notifications
          </Button>
        </>
      )}
      <Problem id="problem-notifications" problem={problem} />
      <p role="status" className="min-h-6 text-base">
        {statusWords[status]}
      </p>
    </Card>
  );
}

// Settings, phone only: this phone's notifications. Whether this browser can, and has, is read once; each write (turning on or
// off, a change of what is sent, a test) is alone, and the card says what it did.
export function NotificationsSection() {
  const [support] = useState<PushSupport>(() => (typeof window === 'undefined' ? 'unsupported' : pushSupport()));
  const [state, setState] = useState<PushState | null>(null);
  const [listName, setListName] = useState<string | null>(null);
  const [status, setStatus] = useState<NotificationsStatus>('idle');
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const problems = useWriteProblem();
  // One write at a time: the ref is the guard, the state is what is drawn (`aria-disabled`, never `disabled`).
  const working = useRef(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (support !== 'supported') return;
    let live = true;
    readPushState().then(
      (read) => live && setState(read),
      () => live && setLoadProblem(LOAD_FAILED),
    );
    // The name only words one line; without it the card says "the shopping list".
    loadPinnedListName(supabase).then(
      (name) => live && setListName(name),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [support]);

  // One write, alone: what it did is the status; what it could not do, in `said`'s words, is under the buttons.
  async function write<T>(run: () => Promise<T>, done: (result: T) => void, said?: { failed: string; offline: string }) {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    try {
      const result = await run();
      problems.clear(PLACE);
      done(result);
    } catch (error) {
      setStatus('idle');
      problems.fail(PLACE, error, said ? { said } : {});
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  return (
    <NotificationsView
      support={support}
      state={state}
      listName={listName}
      busy={busy}
      status={status}
      loadProblem={loadProblem}
      problem={problems.at(PLACE)}
      // Asking for permission is the first thing the tap does: turnOnNotifications calls requestPermission before awaiting anything.
      onTurnOn={() =>
        void write(
          turnOnNotifications,
          (next) => {
            setState(next);
            setStatus('idle');
          },
          TURN_ON_SAID,
        )
      }
      onTurnOff={() =>
        void write(
          turnOffNotifications,
          () => {
            setState({ kind: 'off' });
            setStatus('idle');
          },
          TURN_OFF_SAID,
        )
      }
      onTest={() => void write(sendTestNotification, () => setStatus('test'), TEST_SAID)}
      onChange={(preferences) => {
        if (state?.kind !== 'on') return;
        void write(
          () => savePushPreferences(state.id, preferences),
          () => {
            setState({ kind: 'on', id: state.id, preferences });
            setStatus('saved');
          },
        );
      }}
    />
  );
}
