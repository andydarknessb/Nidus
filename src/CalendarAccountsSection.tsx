import { Plus } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Card, Field, helpClass, labelClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { useRefetchOn } from '@/lib/change-feed';
import {
  accountStatusText,
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
import { loadProfiles, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';

const CALENDAR_TABLES = ['calendar_accounts', 'mirrored_calendars', 'profiles'] as const;

// The choice values a select can carry: '' is "whole household". A calendar has no colour to choose any more (the Wall draws an
// event in its person's colour); its stored one is sent back as it is, and nothing here shows it.
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
    <li className="flex flex-col gap-2">
      <label className="flex min-h-12 items-center gap-3 text-[17px]">
        <input type="checkbox" className="size-6 shrink-0" checked={calendar.selected} onChange={(event) => onChange({ ...choice, selected: event.target.checked })} />
        <span className="min-w-0 break-words">{calendar.name}</span>
      </label>
      {calendar.selected && (
        <Field label={`Whose calendar is ${calendar.name}?`}>
          <select
            className="h-14 w-full text-[17px]"
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
        </Field>
      )}
    </li>
  );
}

// Settings, phone only: connect a Google account, choose which of its calendars are mirrored and whose they are, and remove an
// account. A Device never gets this screen.
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
  // calendars and people are kept.
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
      setNotice('Account removed.');
    } catch {
      setProblem('Could not remove the account. Try again.');
    }
    setConfirming(null);
    await refresh();
  }

  return (
    <Card title="Google calendars">
      <p className="text-base leading-6">Nidus shows your Google calendars on the Wall. It only reads them and never changes anything in Google.</p>
      <div className="flex flex-col gap-2">
        <Button variant="secondary" size="phone" className="w-full" onClick={() => void connect()}>
          <Plus aria-hidden />
          Connect a Google calendar
        </Button>
        <Button variant="quiet" size="phone" className="w-full" onClick={() => void makeLink()}>
          Copy a link for another adult
        </Button>
        {link && <input className="h-14 w-full text-[17px]" readOnly value={link} aria-label="Link for another adult" onFocus={(event) => event.target.select()} />}
        <p role="status" className="min-h-6 text-base">
          {notice}
        </p>
      </div>
      {problem && (
        <p role="alert" className="text-base">
          {problem}
        </p>
      )}
      {accounts?.length === 0 && !problem && <p className="text-base">No Google account is connected yet.</p>}
      {accounts?.map((account) => {
        const own = calendarsOfAccount(calendars, account.id);
        return (
          <div key={account.id} className="flex flex-col gap-4 border-t border-border pt-4">
            <div className="flex flex-col gap-1">
              <h3 className="text-[17px] leading-6 font-semibold break-words">{account.google_email}</h3>
              <p className="text-base leading-6">{accountStatusText(account)}</p>
              <p className={helpClass}>{lastSyncedText(account.last_synced_at, now)}</p>
            </div>
            {account.status === 'needs_reauth' && (
              <div className="flex flex-col gap-3">
                <p className="text-base leading-6">Nothing is lost. Connecting again keeps this account’s calendars and your choices for them.</p>
                <Button variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal" onClick={() => void reconnect(account.google_email)}>
                  Connect {account.google_email} again
                </Button>
              </div>
            )}
            {own.length === 0 ? (
              <p className="text-base">This account has no calendars to choose from.</p>
            ) : (
              <div className="flex flex-col gap-2">
                <p className={labelClass}>Choose the calendars to show</p>
                <ul className="flex flex-col gap-2">
                  {own.map((calendar) => (
                    <CalendarRow key={calendar.id} calendar={calendar} profiles={profiles} onChange={(choice) => void choose(calendar.id, choice)} />
                  ))}
                </ul>
              </div>
            )}
            {confirming === account.id ? (
              <div role="group" aria-label={`Remove ${account.google_email}`} className="flex flex-col gap-3">
                <p className="text-base leading-6">Remove {account.google_email}? Its calendars leave the Wall and Nidus forgets its Google sign-in.</p>
                <div className="flex gap-2">
                  <Button variant="secondary" size="phone" className="flex-1" onClick={() => setConfirming(null)}>
                    Keep it
                  </Button>
                  <Button variant="delete" size="phone" className="flex-[2]" onClick={() => void remove(account.id)}>
                    Yes, remove it
                  </Button>
                </div>
              </div>
            ) : (
              <Button variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal" onClick={() => setConfirming(account.id)}>
                Remove {account.google_email}
              </Button>
            )}
          </div>
        );
      })}
    </Card>
  );
}
