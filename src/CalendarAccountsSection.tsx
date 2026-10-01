import { useCallback, useEffect, useState } from 'react';
import {
  calendarsOfAccount,
  lastSyncedText,
  loadCalendarAccounts,
  loadMirroredCalendars,
  removeCalendarAccount,
  startCalendarConnect,
  updateMirroredCalendar,
  type CalendarAccount,
  type MirroredCalendar,
} from '@/lib/calendar-accounts';
import { PROFILE_PALETTE, loadProfiles, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { useRefetchOn } from '@/lib/change-feed';

const CALENDAR_TABLES = ['calendar_accounts', 'mirrored_calendars', 'profiles'] as const;

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';

const STATUS_TEXT: Record<CalendarAccount['status'], string> = {
  active: 'Connected',
  needs_reauth: 'Needs to be connected again',
};

// The choice values a select can carry: '' is "no override" and "whole Household".
function CalendarRow({
  calendar,
  profiles,
  onChange,
}: {
  calendar: MirroredCalendar;
  profiles: Profile[];
  onChange: (choice: { selected: boolean; profile_id: string | null; color: string | null }) => void;
}) {
  const choice = { selected: calendar.selected, profile_id: calendar.profile_id, color: calendar.color };
  return (
    <li className="flex flex-col gap-3 rounded-lg border border-border p-3">
      <label className="flex min-h-12 items-center gap-3 text-base">
        <input
          type="checkbox"
          className="size-6"
          checked={calendar.selected}
          onChange={(event) => onChange({ ...choice, selected: event.target.checked })}
        />
        <span className="break-words">{calendar.name}</span>
      </label>
      {calendar.selected && (
        <div className="flex flex-col gap-3">
          <label className="flex flex-col gap-2 text-base">
            Whose calendar is {calendar.name}?
            <select
              className={field}
              value={calendar.profile_id ?? ''}
              onChange={(event) => onChange({ ...choice, profile_id: event.target.value === '' ? null : event.target.value })}
            >
              <option value="">Whole household</option>
              {profiles.map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2 text-base">
            Colour for {calendar.name}
            <select
              className={field}
              value={calendar.color ?? ''}
              onChange={(event) => onChange({ ...choice, color: event.target.value === '' ? null : event.target.value })}
            >
              <option value="">Use the Profile colour</option>
              {PROFILE_PALETTE.map((color) => (
                <option key={color.hex} value={color.hex}>
                  {color.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
    </li>
  );
}

// Settings, phone only: connect a Google account, choose which of its calendars are
// mirrored and whose they are, and remove an account. A Device never gets this screen.
export function CalendarAccountsSection() {
  const [accounts, setAccounts] = useState<CalendarAccount[] | null>(null);
  const [calendars, setCalendars] = useState<MirroredCalendar[]>([]);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
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
      setProblem(null);
    } catch {
      setProblem('Could not load your calendars. Check your connection.');
    }
  }, []);

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
    } catch {
      setProblem('Could not start connecting to Google. Try again.');
    }
  }

  // Reconnect an account that needs it: Google offers that account first, and the account's
  // calendars, Profiles and colours are kept.
  async function reconnect(email: string) {
    setNotice(null);
    try {
      window.location.assign(await startCalendarConnect(supabase, 'settings', email));
    } catch {
      setProblem('Could not start connecting to Google. Try again.');
    }
  }

  async function makeLink() {
    setNotice(null);
    try {
      const url = await startCalendarConnect(supabase, 'link');
      setLink(url);
      setProblem(null);
      try {
        await navigator.clipboard.writeText(url);
        setNotice('Link copied. It works for 7 days. Send it to another adult to open on their own phone.');
      } catch {
        setNotice('Copy the link below and send it to another adult. It works for 7 days.');
      }
    } catch {
      setProblem('Could not make a link. Try again.');
    }
  }

  async function choose(id: string, choice: { selected: boolean; profile_id: string | null; color: string | null }) {
    try {
      await updateMirroredCalendar(supabase, id, choice);
      setProblem(null);
    } catch {
      setProblem('Could not save that choice. Try again.');
    }
    await refresh();
  }

  async function remove(id: string) {
    try {
      await removeCalendarAccount(supabase, id);
      setProblem(null);
      setNotice('Calendar account removed.');
    } catch {
      setProblem('Could not remove the calendar account. Try again.');
    }
    setConfirming(null);
    await refresh();
  }

  return (
    <section aria-labelledby="calendars-heading" className="flex flex-col gap-4">
      <h2 id="calendars-heading" className="text-xl font-semibold">
        Calendars
      </h2>
      <p className="text-base">
        Nidus shows your Google calendars on the wall. It only reads them and never changes anything in Google.
      </p>
      <div className="flex flex-col gap-3">
        <button type="button" className={`${action} bg-primary text-primary-foreground`} onClick={() => void connect()}>
          Connect a Google calendar
        </button>
        <button type="button" className={`${action} border border-border`} onClick={() => void makeLink()}>
          Copy a link for another adult
        </button>
        {link && <input className={field} readOnly value={link} aria-label="Link for another adult" onFocus={(event) => event.target.select()} />}
      </div>
      <p role="status" className="min-h-6 text-base">
        {notice}
      </p>
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {accounts?.length === 0 && !problem && <p className="text-base">No Google account is connected yet.</p>}
      {accounts?.map((account) => {
        const own = calendarsOfAccount(calendars, account.id);
        return (
          <div key={account.id} className="flex flex-col gap-3 rounded-lg border border-border p-3">
            <div className="flex flex-col gap-1">
              <h3 className="break-words text-lg font-medium">{account.google_email}</h3>
              <p className="text-base">
                {STATUS_TEXT[account.status]}
                {account.last_error ? `: ${account.last_error}` : ''}
              </p>
              <p className="text-base">{lastSyncedText(account.last_synced_at, now)}</p>
            </div>
            {account.status === 'needs_reauth' && (
              <div className="flex flex-col gap-3">
                <p className="text-base">Nothing is lost. Connecting again keeps this account’s calendars and your choices for them.</p>
                <button type="button" className={`${action} bg-primary text-primary-foreground`} onClick={() => void reconnect(account.google_email)}>
                  Connect {account.google_email} again
                </button>
              </div>
            )}
            {own.length === 0 ? (
              <p className="text-base">This account has no calendars to choose from.</p>
            ) : (
              <>
                <p className="text-base">Choose the calendars to show:</p>
                <ul className="flex flex-col gap-3">
                  {own.map((calendar) => (
                    <CalendarRow
                      key={calendar.id}
                      calendar={calendar}
                      profiles={profiles}
                      onChange={(choice) => void choose(calendar.id, choice)}
                    />
                  ))}
                </ul>
              </>
            )}
            {confirming === account.id ? (
              <div role="group" aria-label={`Remove ${account.google_email}`} className="flex flex-col gap-3">
                <p className="text-base">
                  Remove {account.google_email}? Its calendars leave the wall and Nidus forgets its Google sign-in.
                </p>
                <button type="button" className={`${action} bg-primary text-primary-foreground`} onClick={() => void remove(account.id)}>
                  Yes, remove it
                </button>
                <button type="button" className={`${action} border border-border`} onClick={() => setConfirming(null)}>
                  Keep it
                </button>
              </div>
            ) : (
              <button type="button" className={`${action} border border-border`} onClick={() => setConfirming(account.id)}>
                Remove {account.google_email}
              </button>
            )}
          </div>
        );
      })}
    </section>
  );
}
