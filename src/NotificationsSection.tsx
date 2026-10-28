import { useEffect, useState } from 'react';
import { EmptyRing, HouseDisc, PersonDisc, Tick } from '@/components/people';
import { personStyle } from '@/lib/look';
import { loadProfiles, type Profile } from '@/lib/profiles';
import { Card, Field, Problem, fieldClass, helpClass, statusLineClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { REMINDER_MINUTES, pressPerson, pushSupport, readPushState, savePushPreferences, sendTestNotification, turnOffNotifications, turnOnNotifications, type PushPreferences, type PushState, type PushSupport } from '@/lib/push';
import { loadPinnedListName } from '@/lib/shared-lists';
import { supabase } from '@/lib/supabase';
import { type WriteProblem } from '@/lib/change';
import { useSyncedRead } from '@/lib/synced-read';

// What the status line says: nothing, or what the last tap did.
export type NotificationsStatus = 'idle' | 'saved' | 'test';

const statusWords: Record<NotificationsStatus, string> = { idle: '', saved: 'Saved.', test: 'Test sent.' };

// The controls focus goes to once the one it was on is gone: the first switch after turning on, Turn on notifications after turning
// off, the line that says it is blocked after a refusal.
const FIRST_SWITCH = 'notifications-first-switch';
const TURN_ON = 'notifications-turn-on';
const DENIED = 'notifications-denied';

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
function Switch({ id, label, checked, busy, onChange }: { id?: string; label: string; checked: boolean; busy: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="relative flex min-h-12 items-center gap-3 rounded-lg text-[17px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
      <input
        id={id}
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

// A chip of "Whose events?": the Add event sheet's "Who is it for?" chip (52 tall, round, a ring when pressed). A person keeps their
// soft colour when pressed, so only the ring answers.
const chip = 'h-13 max-w-full gap-2 rounded-full pr-4 pl-2 font-medium selected:ring-[2.5px]';

type ViewProps = {
  support: PushSupport;
  // null until the first read lands.
  state: PushState | null;
  // The Household's Profiles in sort order, or null until they are read. None, and no group is drawn.
  profiles?: Profile[] | null;
  // The pinned list's name, or null when there is none.
  listName: string | null;
  busy: boolean;
  status: NotificationsStatus;
  failed: boolean;
  problem: WriteProblem | null;
  onTurnOn: () => void;
  onTurnOff: () => void;
  onTest: () => void;
  onChange: (preferences: PushPreferences) => void;
};

// What the card draws, from what it is told: each of its states is rendered in tests/notifications-section.test.ts.
export function NotificationsView({ support, state, profiles = null, listName, busy, status, failed, problem, onTurnOn, onTurnOff, onTest, onChange }: ViewProps) {
  // A tap while a write is on its way does nothing; the button says so with `aria-disabled`, never `disabled`.
  const guarded = (action: () => void) => () => {
    if (!busy) action();
  };
  // A chosen id that is no longer a Profile is not drawn and is dropped by the next save. Until the Profiles are read nothing is dropped.
  const chosenOf = (preferences: PushPreferences) => (profiles ? preferences.people.filter((id) => profiles.some((profile) => profile.id === id)) : preferences.people);
  const change = (preferences: PushPreferences, part: Partial<PushPreferences>) => onChange({ ...preferences, people: chosenOf(preferences), ...part });
  return (
    <Card title="Notifications on this phone" read={{ failed }} of="notifications" words={LOAD_FAILED}>
      {support === 'unsupported' && <p className="text-base">{UNSUPPORTED_WORDS}</p>}
      {support === 'needs-home-screen' && <p className="text-base">{HOME_SCREEN_WORDS}</p>}
      {support === 'supported' && state?.kind === 'off' && (
        <>
          <p className="text-base">{OFF_WORDS}</p>
          <Button id={TURN_ON} variant="primary" size="phone" className="w-full" aria-disabled={busy || undefined} onClick={guarded(onTurnOn)}>
            Turn on notifications
          </Button>
        </>
      )}
      {support === 'supported' && state?.kind === 'denied' && (
        <p id={DENIED} tabIndex={-1} className="text-base">
          {DENIED_WORDS}
        </p>
      )}
      {support === 'supported' && state?.kind === 'on' && (
        <>
          <div className="flex flex-col gap-2">
            <Switch id={FIRST_SWITCH} label="Event reminders" checked={state.preferences.eventReminders} busy={busy} onChange={(eventReminders) => change(state.preferences, { eventReminders })} />
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
          {profiles && profiles.length > 0 && (
            <div role="group" aria-labelledby="whose-label" className="flex flex-col gap-2">
              <span id="whose-label" className="text-[15px] leading-5 text-muted-foreground">
                Whose events?
              </span>
              <div className="flex flex-wrap gap-2">
                <Button aria-pressed={chosenOf(state.preferences).length === 0} aria-disabled={busy || undefined} onClick={guarded(() => change(state.preferences, { people: [] }))} className={`${chip} selected:bg-secondary`}>
                  <HouseDisc size={34} />
                  Everyone
                </Button>
                {profiles.map((profile) => (
                  <Button
                    key={profile.id}
                    variant="quiet"
                    aria-pressed={chosenOf(state.preferences).includes(profile.id)}
                    aria-disabled={busy || undefined}
                    onClick={guarded(() => change(state.preferences, { people: pressPerson(chosenOf(state.preferences), profile.id) }))}
                    style={personStyle(profile.color)}
                    className={`person ${chip} bg-person-soft text-foreground selected:bg-person-soft`}
                  >
                    <PersonDisc name={profile.name} color={profile.color} size={34} />
                    <span className="truncate">{profile.name}</span>
                  </Button>
                ))}
              </div>
              <p className={helpClass}>Events for everyone come to every phone.</p>
            </div>
          )}
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
      <p role="status" className={statusLineClass}>
        {statusWords[status]}
      </p>
    </Card>
  );
}

// Settings, phone only: this phone's notifications. Whether this browser can is read once; whether it has is read through the synced
// read (every 30 seconds, 5 after a failure, after each write, and again on coming back to the page); each write (turning on or off,
// a change of what is sent, a test) is alone, and the card says what it did.
const NO_TABLES = [] as const;

export function NotificationsSection() {
  const [support] = useState<PushSupport>(() => (typeof window === 'undefined' ? 'unsupported' : pushSupport()));
  const read = useSyncedRead<PushState>(() => readPushState(supabase), NO_TABLES, support === 'supported' ? 'push' : null);
  const state = read.data;
  const [listName, setListName] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [status, setStatus] = useState<NotificationsStatus>('idle');
  // One change at a time (read.change, the card write guard): the card draws `aria-disabled` from `busy`, and says where focus goes
  // afterwards.
  const { busy, change } = read;

  useEffect(() => {
    if (support !== 'supported') return;
    let live = true;
    // Back on the page after the phone's settings: what was blocked may be allowed now. A write on its way is let finish first.
    const again = () => {
      if (document.visibilityState === 'visible') read.refresh();
    };
    document.addEventListener('visibilitychange', again);
    // The name only words one line; without it the card says "the shopping list".
    loadPinnedListName(supabase).then(
      (name) => live && setListName(name),
      () => undefined,
    );
    // Likewise the people: without them the card draws no "Whose events?" and drops nothing from the saved choice.
    loadProfiles(supabase).then(
      (found) => live && setProfiles(found),
      () => undefined,
    );
    return () => {
      live = false;
      document.removeEventListener('visibilitychange', again);
    };
  }, [support, read.refresh]);

  // Each write is alone: what it did is the status (what was said of the last write is old when the next begins, so that a repeat is
  // said again); what it could not do, in its own words, is under the buttons. `meanwhile` is what the card shows from the result
  // until the read that follows it, which also says what is so after one that failed (a subscription gone from the server is off).
  return (
    <NotificationsView
      support={support}
      state={state}
      profiles={profiles}
      listName={listName}
      busy={busy}
      status={status}
      failed={read.failed}
      problem={read.problem(PLACE)}
      // Asking for permission is the first thing the tap does: turnOnNotifications calls requestPermission before awaiting anything.
      onTurnOn={() =>
        void change(
          PLACE,
          () => {
            setStatus('idle');
            return turnOnNotifications(supabase);
          },
          {
            words: { said: TURN_ON_SAID },
            landed: (next) => (next.kind === 'on' ? FIRST_SWITCH : next.kind === 'denied' ? DENIED : undefined),
            meanwhile: (next) => () => next,
          },
        )
      }
      onTurnOff={() =>
        void change(
          PLACE,
          () => {
            setStatus('idle');
            return turnOffNotifications(supabase);
          },
          { words: { said: TURN_OFF_SAID }, landed: () => TURN_ON, meanwhile: () => () => ({ kind: 'off' }) },
        )
      }
      onTest={() =>
        void change(
          PLACE,
          () => {
            setStatus('idle');
            return sendTestNotification(supabase);
          },
          { words: { said: TEST_SAID }, landed: () => void setStatus('test') },
        )
      }
      onChange={(preferences) => {
        if (state?.kind !== 'on') return;
        void change(
          PLACE,
          () => {
            setStatus('idle');
            return savePushPreferences(supabase, state.id, preferences);
          },
          { landed: () => void setStatus('saved'), meanwhile: () => () => ({ kind: 'on', id: state.id, preferences }) },
        );
      }}
    />
  );
}
