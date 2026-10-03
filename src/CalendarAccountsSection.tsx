import { Plus } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { EmptyRing, Tick } from '@/components/people';
import { Card, Confirm, Field, Problem, fieldClass, helpClass, labelClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useRefetchOn } from '@/lib/change-feed';
import {
  accountStatusText,
  calendarsOfAccount,
  lastSyncedText,
  loadCalendarAccounts,
  loadMirroredCalendars,
  removeCalendarAccount,
  shownCalendar,
  startCalendarConnect,
  stillPending,
  updateMirroredCalendar,
  type CalendarAccount,
  type MirroredCalendar,
  type PendingChoice,
} from '@/lib/calendar-accounts';
import { loadProfiles, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { useWriteProblem } from '@/lib/use-write-problem';
import { type Said } from '@/lib/write-failure';

const CALENDAR_TABLES = ['calendar_accounts', 'mirrored_calendars', 'profiles'] as const;

// What is said when connecting to Google does not start, which is not a save: the Wall's two sentences with the verb that fits.
const CONNECT_SAID = { failed: 'Could not start connecting to Google. Try again.', offline: 'No internet, so that did not start. Try again soon.' };
const LINK_SAID = { failed: 'Could not make a link. Try again.', offline: 'No internet, so that did not make a link. Try again soon.' };

// Where a write that failed says so: under the Google buttons, under an account's reconnect button, in the question about removing
// an account, or under the row of the calendar that was changed.
const CONNECT = 'connect';
const reconnectPlace = (id: string) => `reconnect-${id}`;
const removePlace = (id: string) => `remove-${id}`;
const calendarPlace = (id: string) => `calendar-${id}`;
const problemId = (place: string) => `problem-${place}`;

// A calendar's row: the switch for showing it, and, while it is shown, whose it is (the choice values a select can carry: '' is
// "Everyone", the whole Household, as the Wall says it). A calendar has no colour to choose any more (the Wall draws an event in its person's colour). What is sent is
// only what was changed, `{ selected }` or `{ profile_id }`. `problem` is what a write of this row said when it did not go through.
export function CalendarRow({
  calendar,
  profiles,
  problem,
  onChange,
}: {
  calendar: MirroredCalendar;
  profiles: Profile[];
  problem?: Said | null | undefined;
  onChange: (change: { selected: boolean } | { profile_id: string | null }) => void;
}) {
  return (
    <li className="flex flex-col gap-2">
      {/* The checkbox is the whole row, 48 tall, so that the control is what a finger lands on; what is drawn is the app's own tick, or
          the empty ring a Routine waits in. */}
      <label className="relative flex min-h-12 items-center gap-3 rounded-lg text-[17px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ring">
        <input type="checkbox" className="absolute inset-0 size-full cursor-pointer opacity-0" checked={calendar.selected} onChange={(event) => onChange({ selected: event.target.checked })} />
        {calendar.selected ? <Tick size={28} /> : <EmptyRing size={28} width={2.5} />}
        <span className="min-w-0 break-words">{calendar.name}</span>
      </label>
      {calendar.selected && (
        <Field label={`Whose calendar is ${calendar.name}?`}>
          <select className={fieldClass} value={calendar.profile_id ?? ''} onChange={(event) => onChange({ profile_id: event.target.value === '' ? null : event.target.value })}>
            <option value="">Everyone</option>
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name}
              </option>
            ))}
          </select>
        </Field>
      )}
      <Problem id={problemId(calendarPlace(calendar.id))} problem={problem} />
    </li>
  );
}

// An account's name, how it is doing, and when it last synced. What the sync wrote when it failed is for the logs, and is not here.
export function AccountSummary({ account, now }: { account: CalendarAccount; now: number }) {
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[17px] leading-6 font-semibold break-words">{account.google_email}</h3>
      <p className="text-base leading-6">{accountStatusText(account)}</p>
      <p className={helpClass}>{lastSyncedText(account.last_synced_at, now)}</p>
    </div>
  );
}

// Settings, phone only: connect a Google account, choose which of its calendars are mirrored and whose they are, and remove an
// account. A Device never gets this screen.
export function CalendarAccountsSection() {
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(null);
  const [calendars, setCalendars] = useState<MirroredCalendar[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  // A trouble reading, which a read that works takes away. What a write said of itself is kept apart (useWriteProblem): a good read,
  // each minute, says nothing of whether a write did.
  const [loadProblem, setLoadProblem] = useState<string | null>(null);
  const problems = useWriteProblem();
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  // What has been asked of each calendar and not answered yet, laid over what is stored so that a tick shows at once; and, for each
  // calendar, the writes in the order they were asked, so that the last asked is the last written.
  const [pending, setPending] = useState<Record<string, PendingChoice>>({});
  const writes = useRef<Record<string, Promise<void>>>({});
  const [focusNext, setFocusNext] = useState<string | null>(null);
  // Ticks each minute so "last synced N minutes ago" keeps up without a reload.
  const [now, setNow] = useState(() => Date.now());

  const refresh = useCallback(async () => {
    try {
      const [nextAccounts, nextCalendars, nextProfiles] = await Promise.all([
        loadCalendarAccounts(supabase),
        loadMirroredCalendars(supabase),
        loadProfiles(supabase),
      ]);
      setAccounts(nextAccounts);
      setCalendars(nextCalendars);
      setProfiles(nextProfiles);
      setLoadProblem(null);
    } catch {
      setLoadProblem('Could not load your calendars. Check your connection.');
    }
  }, []);

  // Moves focus once the control it names is on screen; the swap unmounts whatever had it.
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  useEffect(() => {
    void refresh();
  }, [refresh]);
  useRefetchOn(CALENDAR_TABLES, () => void refresh());

  useEffect(() => {
    const id = setInterval(() => {
      setNow(Date.now());
      void refresh();
    }, 60_000);
    return () => clearInterval(id);
  }, [refresh]);

  async function connect() {
    setNotice(null);
    try {
      window.location.assign(await startCalendarConnect(supabase, 'settings'));
    } catch (error) {
      problems.fail(CONNECT, error, { said: CONNECT_SAID });
    }
  }

  // Reconnect an account that needs it: Google offers that account first, and the account's
  // calendars and people are kept.
  async function reconnect(account: CalendarAccount) {
    setNotice(null);
    try {
      window.location.assign(await startCalendarConnect(supabase, 'settings', account.google_email));
    } catch (error) {
      problems.fail(reconnectPlace(account.id), error, { said: CONNECT_SAID });
    }
  }

  async function makeLink() {
    setNotice(null);
    try {
      const url = await startCalendarConnect(supabase, 'link');
      problems.clear(CONNECT);
      setLink(url);
      try {
        await navigator.clipboard.writeText(url);
        setNotice('Link copied. It works for 7 days. Send it to another adult to open on their own phone.');
      } catch {
        setNotice('Copy the link below and send it to another adult. It works for 7 days.');
      }
    } catch (error) {
      problems.fail(CONNECT, error, { said: LINK_SAID });
    }
  }

  // A calendar's switch or its person, one field at a time. It shows at once; if the write does not go through it goes back to what
  // is stored, and says so under that row (what an earlier try of that row said stays until this one answers). Writes to one
  // calendar go in the order they were asked.
  function choose(calendar: MirroredCalendar, change: { selected: boolean } | { profile_id: string | null }) {
    const id = calendar.id;
    setPending((all) => ({ ...all, [id]: { ...all[id], ...change } }));
    writes.current[id] = (writes.current[id] ?? Promise.resolve()).then(async () => {
      try {
        await updateMirroredCalendar(supabase, id, change);
        setCalendars((rows) => rows.map((row) => (row.id === id ? { ...row, ...change } : row)));
        problems.clear(calendarPlace(id));
      } catch (error) {
        problems.fail(calendarPlace(id), error);
      }
      setPending((all) => {
        const next = { ...all };
        const left = stillPending(all[id], change);
        if (left === undefined) delete next[id];
        else next[id] = left;
        return next;
      });
      void refresh();
    });
  }

  async function remove(id: string) {
    if (removing) return;
    setRemoving(true);
    let failed = false;
    try {
      await removeCalendarAccount(supabase, id);
      problems.clear(removePlace(id));
      setNotice('Account removed.');
    } catch (error) {
      failed = true;
      problems.fail(removePlace(id), error);
    }
    setRemoving(false);
    if (!failed) {
      // The account is gone and with it the button that asked: focus goes to the first button of the card.
      setConfirming(null);
      setFocusNext('connect-google');
    }
    void refresh();
  }

  return (
    <Card title="Google calendars">
      <p className="text-base leading-6">Nidus shows your Google calendars on the Wall. It only reads them and never changes anything in Google.</p>
      <div className="flex flex-col gap-2">
        <Button id="connect-google" variant="secondary" size="phone" className="w-full" onClick={() => void connect()}>
          <Plus aria-hidden />
          Connect a Google calendar
        </Button>
        <Button variant="quiet" size="phone" className="w-full" onClick={() => void makeLink()}>
          Copy a link for another adult
        </Button>
        {link && <input className={fieldClass} readOnly value={link} aria-label="Link for another adult" onFocus={(event) => event.target.select()} />}
        <p role="status" className="text-base">
          {notice}
        </p>
        <Problem id={problemId(CONNECT)} problem={problems.at(CONNECT)} />
      </div>
      {loadProblem && (
        <p role="alert" className="text-base">
          {loadProblem}
        </p>
      )}
      {accounts?.length === 0 && !loadProblem && <p className="text-base">No Google account is connected yet.</p>}
      {accounts?.map((account) => {
        const own = calendarsOfAccount(calendars, account.id).map((calendar) => shownCalendar(calendar, pending[calendar.id]));
        return (
          <div key={account.id} className="flex flex-col gap-4 border-t border-border pt-4">
            <AccountSummary account={account} now={now} />
            {account.status === 'needs_reauth' && (
              <div className="flex flex-col gap-3">
                <p className="text-base leading-6">Nothing is lost. Connecting again keeps this account’s calendars and your choices for them.</p>
                <Button variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]" onClick={() => void reconnect(account)}>
                  Connect {account.google_email} again
                </Button>
                <Problem id={problemId(reconnectPlace(account.id))} problem={problems.at(reconnectPlace(account.id))} />
              </div>
            )}
            {own.length === 0 ? (
              <p className="text-base">This account has no calendars to choose from.</p>
            ) : (
              <fieldset className="flex min-w-0 flex-col gap-2">
                <legend className={`${labelClass} mb-2`}>
                  Choose the calendars to show
                </legend>
                <ul className="flex flex-col gap-2">
                  {own.map((calendar) => (
                    <CalendarRow key={calendar.id} calendar={calendar} profiles={profiles} problem={problems.at(calendarPlace(calendar.id))} onChange={(change) => choose(calendar, change)} />
                  ))}
                </ul>
              </fieldset>
            )}
            {confirming === account.id ? (
              <Confirm
                title={`Remove ${account.google_email}?`}
                words="Its calendars leave the Wall and Nidus forgets its Google sign-in."
                cancel="Keep it"
                confirm="Yes, remove it"
                busy={removing}
                problem={problems.at(removePlace(account.id))}
                onCancel={() => {
                  problems.clear(removePlace(account.id));
                  setConfirming(null);
                  setFocusNext(`remove-${account.id}`);
                }}
                onConfirm={() => void remove(account.id)}
              />
            ) : (
              <Button
                id={`remove-${account.id}`}
                variant="secondary"
                size="phone"
                className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]"
                onClick={() => {
                  problems.clear(removePlace(account.id));
                  setConfirming(account.id);
                }}
              >
                Remove {account.google_email}
              </Button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
