import { Plus } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { EmptyRing, Tick } from '@/components/people';
import { Card, Confirm, Field, Problem, fieldClass, helpClass, labelClass, statusLineClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import {
  accountStatusText,
  addIphoneCalendar,
  pressAdd,
  calendarsOfAccount,
  chooseCalendar,
  lastSyncedText,
  loadCalendarAccounts,
  loadMirroredCalendars,
  removeCalendarAccount,
  startCalendarConnect,
  type CalendarAccount,
  type MirroredCalendar,
} from '@/lib/calendar-accounts';
import { loadProfiles, type Profile } from '@/lib/profiles';
import { supabase } from '@/lib/supabase';
import { useWriteProblem } from '@/lib/use-write-problem';
import { useStatusLine } from '@/lib/status-line';
import { type Said } from '@/lib/write-failure';
import { couldNotLoad, useSyncedRead } from '@/lib/synced-read';

const CALENDAR_TABLES = ['calendar_accounts', 'mirrored_calendars', 'profiles'] as const;

// What is said when connecting to Google does not start, which is not a save: the Wall's two sentences with the verb that fits.
const CONNECT_SAID = { failed: 'Could not start connecting to Google. Try again.', offline: 'No internet, so that did not start. Try again soon.' };
const LINK_SAID = { failed: 'Could not make a link. Try again.', offline: 'No internet, so that did not make a link. Try again soon.' };

// Where a write that failed says so: under the Google buttons, under an account's reconnect button, in the question about removing
// an account, or under the row of the calendar that was changed.
const CONNECT = 'connect';
const ADD_IPHONE = 'add-iphone';
const reconnectPlace = (id: string) => `reconnect-${id}`;
const removePlace = (id: string) => `remove-${id}`;
const calendarPlace = (id: string) => `calendar-${id}`;
const problemId = (place: string) => `problem-${place}`;
const removeButtonId = (id: string) => `remove-${id}`;
const IPHONE_LINK = 'iphone-link';

// The iPhone calendars card's steps.
export const IPHONE_STEPS =
  'On your iPhone, open Calendar, tap Calendars, tap the i next to a calendar, turn on Public Calendar, tap Share Link, then Copy Link. Paste it here.';

// Whose a calendar is: a person, or "Everyone" (the whole Household, as the Wall says it); '' is Everyone, the value a select can
// carry. A Google calendar's row shows it while the calendar is shown; an iPhone calendar, which is always shown, always does.
function WhoseCalendar({ calendar, profiles, onChange }: { calendar: MirroredCalendar; profiles: Profile[]; onChange: (change: { profile_id: string | null }) => void }) {
  return (
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
  );
}

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
      {calendar.selected && <WhoseCalendar calendar={calendar} profiles={profiles} onChange={onChange} />}
      <Problem id={problemId(calendarPlace(calendar.id))} problem={problem} />
    </li>
  );
}

// An account's name, how it is doing, and when it last synced. What the sync wrote when it failed is for the logs, and is not here
// (accountStatusText says the one case that is). A Google account is named by its email; an iPhone calendar by its calendar's
// name, with what it is under that.
export function AccountSummary({ account, name, now }: { account: CalendarAccount; name?: string | undefined; now: number }) {
  const iphone = account.provider === 'icloud';
  const heading = iphone ? (name ?? 'iPhone calendar') : account.google_email;
  return (
    <div className="flex flex-col gap-1">
      <h3 className="text-[17px] leading-6 font-semibold break-words">{heading}</h3>
      {iphone && heading !== 'iPhone calendar' && <p className={helpClass}>iPhone calendar</p>}
      <p className="text-base leading-6">{accountStatusText(account)}</p>
      <p className={helpClass}>{lastSyncedText(account.last_synced_at, now)}</p>
    </div>
  );
}

// One account in its card: its summary, then what is the account's to do. A Google account has its reconnect and the choice of its
// calendars; an iPhone calendar has its one calendar, always shown, and only whose it is. Both end in Remove, with the question
// before it.
export function AccountBlock({
  account,
  calendars,
  profiles,
  now,
  confirming,
  removing,
  problems,
  onReconnect,
  onChoose,
  onAskRemove,
  onCancelRemove,
  onRemove,
}: {
  account: CalendarAccount;
  calendars: MirroredCalendar[];
  profiles: Profile[];
  now: number;
  confirming: boolean;
  removing: boolean;
  problems: { at: (place: string) => Said | null };
  onReconnect: () => void;
  onChoose: (calendar: MirroredCalendar, change: { selected: boolean } | { profile_id: string | null }) => void;
  onAskRemove: () => void;
  onCancelRemove: () => void;
  onRemove: () => void;
}) {
  const iphone = account.provider === 'icloud';
  const own = calendars[0];
  const name = iphone ? (own?.name ?? 'iPhone calendar') : (account.google_email ?? '');
  return (
    <div className="flex flex-col gap-4 border-t border-border pt-4">
      <AccountSummary account={account} name={iphone ? name : undefined} now={now} />
      {iphone ? (
        own && (
          <div className="flex flex-col gap-2">
            <WhoseCalendar calendar={own} profiles={profiles} onChange={(change) => onChoose(own, change)} />
            <Problem id={problemId(calendarPlace(own.id))} problem={problems.at(calendarPlace(own.id))} />
          </div>
        )
      ) : (
        <>
          {account.status === 'needs_reauth' && (
            <div className="flex flex-col gap-3">
              <p className="text-base leading-6">Nothing is lost. Connecting again keeps this account’s calendars and your choices for them.</p>
              <Button variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]" onClick={onReconnect}>
                Connect {account.google_email} again
              </Button>
              <Problem id={problemId(reconnectPlace(account.id))} problem={problems.at(reconnectPlace(account.id))} />
            </div>
          )}
          {calendars.length === 0 ? (
            <p className="text-base">This account has no calendars to choose from.</p>
          ) : (
            <fieldset className="flex min-w-0 flex-col gap-2">
              <legend className={`${labelClass} mb-2`}>Choose the calendars to show</legend>
              <ul className="flex flex-col gap-2">
                {calendars.map((calendar) => (
                  <CalendarRow key={calendar.id} calendar={calendar} profiles={profiles} problem={problems.at(calendarPlace(calendar.id))} onChange={(change) => onChoose(calendar, change)} />
                ))}
              </ul>
            </fieldset>
          )}
        </>
      )}
      {confirming ? (
        <Confirm
          title={`Remove ${name}?`}
          words={iphone ? 'Its events leave the Wall and Nidus forgets its link.' : 'Its calendars leave the Wall and Nidus forgets its Google sign-in.'}
          cancel="Keep it"
          confirm="Yes, remove it"
          busy={removing}
          problem={problems.at(removePlace(account.id))}
          onCancel={onCancelRemove}
          onConfirm={onRemove}
        />
      ) : (
        <Button id={removeButtonId(account.id)} variant="secondary" size="phone" className="h-auto min-h-14 py-2 whitespace-normal [overflow-wrap:anywhere]" onClick={onAskRemove}>
          Remove {name}
        </Button>
      )}
    </div>
  );
}

// The iPhone calendars card's form: the steps, the link and Add. The link is the card's to keep; what went wrong is said under the
// field, which points at it (aria-describedby) with the steps. While a link is being added the button says "Adding" and does
// nothing, so it is not pressed twice.
export function IphoneCalendarForm({
  value,
  adding,
  problem,
  onChange,
  onAdd,
}: {
  value: string;
  adding: boolean;
  problem?: Said | null | undefined;
  onChange: (value: string) => void;
  onAdd: () => void;
}) {
  const stepsId = useId();
  return (
    <form
      noValidate
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        if (!adding) onAdd();
      }}
    >
      <p id={stepsId} className="text-base leading-6">
        {IPHONE_STEPS}
      </p>
      <Field label="Link">
        <input
          id={IPHONE_LINK}
          type="url"
          inputMode="url"
          autoCapitalize="off"
          autoCorrect="off"
          spellCheck={false}
          className={fieldClass}
          value={value}
          aria-invalid={problem ? true : undefined}
          aria-describedby={problem ? `${stepsId} ${problemId(ADD_IPHONE)}` : stepsId}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      <Problem id={problemId(ADD_IPHONE)} problem={problem} />
      <Button type="submit" variant="secondary" size="phone" className="w-full" aria-disabled={adding || undefined}>
        {adding ? 'Adding' : 'Add'}
      </Button>
    </form>
  );
}

// Settings, phone only: connect a Google account, choose which of its calendars are mirrored and whose they are, and remove an
// account. A Device never gets this screen.
const NONE: MirroredCalendar[] = [];
const NO_PROFILES: Profile[] = [];

export function CalendarAccountsSection() {
  // Read through the synced read. A choice of calendar or person is a pending change on it: it shows at once, goes back if its write
  // fails, and choices stay in the order they were made. A trouble reading, which a read that works takes away, is kept apart from
  // what a write said of itself (useWriteProblem): a good read says nothing of whether a write did.
  const read = useSyncedRead(
    async () => {
      const [accounts, calendars, profiles] = await Promise.all([loadCalendarAccounts(supabase), loadMirroredCalendars(supabase), loadProfiles(supabase)]);
      return { accounts, calendars, profiles };
    },
    CALENDAR_TABLES,
    'calendars',
  );
  const accounts = read.data?.accounts ?? null;
  const calendars = read.data?.calendars ?? NONE;
  const profiles = read.data?.profiles ?? NO_PROFILES;
  const loadProblem = read.failed ? couldNotLoad('your calendars') : null;
  const problems = useWriteProblem();
  const [notice, setNotice] = useState<string | null>(null);
  const [link, setLink] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);
  const [iphoneLink, setIphoneLink] = useState('');
  const [adding, setAdding] = useState(false);
  // The guard against a second press, and what the field holds now (a press's answer comes after more may have been typed).
  const addState = useRef({ adding: false });
  const iphoneLinkNow = useRef('');
  const say = useStatusLine();
  // For each calendar, its writes in the order they were asked, so that the last asked is the last written.
  const writes = useRef<Record<string, Promise<void>>>({});
  const [focusNext, setFocusNext] = useState<string | null>(null);
  // Ticks each minute so "last synced N minutes ago" keeps up without a reload.
  const [now, setNow] = useState(() => Date.now());

  // Moves focus once the control it names is on screen; the swap unmounts whatever had it.
  useEffect(() => {
    if (focusNext === null) return;
    document.getElementById(focusNext)?.focus();
    setFocusNext(null);
  }, [focusNext]);

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

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
      window.location.assign(await startCalendarConnect(supabase, 'settings', account.google_email ?? undefined));
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
    chooseCalendar(read, writes.current, supabase, calendar.id, change).then(
      () => problems.clear(calendarPlace(calendar.id)),
      (error: unknown) => problems.fail(calendarPlace(calendar.id), error),
    );
  }


  async function remove(account: CalendarAccount) {
    if (removing) return;
    setRemoving(true);
    let failed = false;
    try {
      await read.write(() => removeCalendarAccount(supabase, account.id));
      problems.clear(removePlace(account.id));
      if (account.provider === 'icloud') say('iPhone calendar removed.');
      else setNotice('Account removed.');
    } catch (error) {
      failed = true;
      problems.fail(removePlace(account.id), error);
    }
    setRemoving(false);
    if (!failed) {
      // The account is gone and with it the button that asked: focus goes to the first control of its card.
      setConfirming(null);
      setFocusNext(account.provider === 'icloud' ? IPHONE_LINK : 'connect-google');
    }
  }

  // Adds the pasted link as an iPhone calendar (pressAdd says what each answer comes to). The route's own words are said under the
  // field when it refuses; any other failure is worded as every write on this page is.
  async function addIphone() {
    setAdding(true);
    const result = await pressAdd({ link: iphoneLink, state: addState.current, current: () => iphoneLinkNow.current, add: (url) => read.write(() => addIphoneCalendar(supabase, url)) });
    if (result.kind === 'ignored') return;
    setAdding(false);
    if (result.kind === 'added') {
      problems.clear(ADD_IPHONE);
      if (result.clear) changeIphoneLink('');
      say(result.say);
    } else if (result.kind === 'refused') problems.say(ADD_IPHONE, result.words);
    else problems.fail(ADD_IPHONE, result.error);
  }
  function changeIphoneLink(value: string) {
    iphoneLinkNow.current = value;
    setIphoneLink(value);
  }

  const block = (account: CalendarAccount) => (
    <AccountBlock
      key={account.id}
      account={account}
      calendars={calendarsOfAccount(calendars, account.id)}
      profiles={profiles}
      now={now}
      confirming={confirming === account.id}
      removing={removing}
      problems={problems}
      onReconnect={() => void reconnect(account)}
      onChoose={choose}
      onAskRemove={() => {
        problems.clear(removePlace(account.id));
        setConfirming(account.id);
      }}
      onCancelRemove={() => {
        problems.clear(removePlace(account.id));
        setConfirming(null);
        setFocusNext(removeButtonId(account.id));
      }}
      onRemove={() => void remove(account)}
    />
  );
  const google = accounts?.filter((account) => account.provider !== 'icloud');
  const iphones = accounts?.filter((account) => account.provider === 'icloud');

  return (
    <>
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
          <p role="status" className={statusLineClass}>
            {notice}
          </p>
          <Problem id={problemId(CONNECT)} problem={problems.at(CONNECT)} />
        </div>
        {loadProblem && (
          <p role="alert" className="text-base">
            {loadProblem}
          </p>
        )}
        {google?.length === 0 && !loadProblem && <p className="text-base">No Google account is connected yet.</p>}
        {google?.map(block)}
      </Card>
      <Card title="iPhone calendars">
        <IphoneCalendarForm value={iphoneLink} adding={adding} problem={problems.at(ADD_IPHONE)} onChange={changeIphoneLink} onAdd={() => void addIphone()} />
        {iphones?.map(block)}
      </Card>
    </>
  );
}
