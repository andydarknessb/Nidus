import { LogOut } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { AppearanceSection } from '@/AppearanceSection';
import { DevicesSection } from '@/DevicesSection';
import { HouseholdAccountsSection } from '@/HouseholdAccountsSection';
import { NotificationsSection } from '@/NotificationsSection';
import { ProfilesSection } from '@/ProfilesSection';
import { UsualsSection } from '@/UsualsSection';
import { WeatherSection } from '@/WeatherSection';
import { Card, Field, PhonePage, Problem, cardClass, fieldClass, helpClass, statusLineClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { updateHousehold, type Household } from '@/lib/household';
import { changesOf, leftAfter, shownOf, type HouseholdDraft } from '@/lib/household-draft';
import { timezoneOptions } from '@/lib/timezones';
import { useChange } from '@/lib/change';
import type { SyncedRead } from '@/lib/synced-read';

type Props = { household: Household; read: Pick<SyncedRead<Household>, 'write' | 'readBack'>; userId: string; onSignOut: () => void };

// The phone's Household page (/settings): the Household's name and time zone, how the Wall looks, the weather, the people and the
// Wall tablets, who can sign in and notifications on this phone, then Sign out. The Calendar Accounts and the events added in Nidus are on the Calendars page.
export function SettingsPage({ household, read, userId, onSignOut }: Props) {
  // The fields as edited: a field shows the Household as it is now until it is edited, so a page left open shows what the Household
  // holds, and a Save sends only what was edited.
  const [draft, setDraft] = useState<HouseholdDraft>({});
  const [saved, setSaved] = useState(false);
  const shown = shownOf(household, draft);
  // What a save that did not go through says (the Wall's two sentences; "Check the name" only when the database refused the name), at
  // once, under the button. One save at a time: while it is on its way Save is `aria-disabled` and does nothing, never `disabled`,
  // which would drop the focus to the page.
  const { busy, isBusy, change, problem: problemAt, clear } = useChange(read);
  // About four hundred zones, each named: drawn once for a zone and not again at every key typed in the name.
  const zones = useMemo(() => timezoneOptions(shown.timezone), [shown.timezone]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (isBusy()) return;
    setSaved(false);
    const changes = changesOf(draft);
    // Nothing edited: nothing is written, and the Household is as it says it is.
    if (changes === null) {
      setSaved(true);
      return;
    }
    await change('household', () => updateHousehold(household.id, changes), {
      words: { refusal: 'Could not save. Check the name and try again.' },
      // What the Household holds from the save until the read after it lands, so a read that fails leaves the saved words on screen.
      meanwhile: (saved) => () => saved,
      // The read has followed the save by now, so the fields show what the Household holds: what was sent is no longer drafted, and an edit
      // made while the save was on its way stays.
      landed: () => {
        setDraft((now) => leftAfter(now, changes));
        setSaved(true);
      },
    });
  }

  const problem = problemAt('household');
  // What was said is old once either field changes.
  const edited = () => {
    setSaved(false);
    clear();
  };

  return (
    <PhonePage title="Household settings">
      <Card title="Household">
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <Field label="Name">
            <input
              className={fieldClass}
              autoComplete="off"
              value={shown.name}
              onChange={(e) => {
                setDraft({ ...draft, name: e.target.value });
                edited();
              }}
              maxLength={100}
              required
              aria-invalid={problem?.refused || undefined}
              aria-describedby={problem?.refused ? 'problem-household' : undefined}
            />
          </Field>
          <div className="flex flex-col gap-2">
            <Field label="Time zone">
              <select
                className={fieldClass}
                value={shown.timezone}
                onChange={(e) => {
                  setDraft({ ...draft, timezone: e.target.value });
                  edited();
                }}
              >
                {zones.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className={helpClass}>Every date and the midnight reset follow this time zone.</p>
          </div>
          {/* The line for what the save did is there from the start, so a screen reader has it before it speaks, and takes no room
              until it says something. */}
          <div className="flex flex-col gap-2">
            <Button type="submit" variant="primary" size="phone" aria-disabled={busy || undefined}>
              Save
            </Button>
            <p role="status" className={statusLineClass}>
              {saved && 'Saved.'}
            </p>
            <Problem id="problem-household" problem={problem} />
          </div>
        </form>
      </Card>
      <div className={cardClass}>
        <AppearanceSection household={household} read={read} />
      </div>
      <WeatherSection household={household} read={read} />
      <ProfilesSection householdId={household.id} />
      <UsualsSection householdId={household.id} />
      <DevicesSection />
      <HouseholdAccountsSection householdId={household.id} timezone={household.timezone} userId={userId} />
      <NotificationsSection />
      <Button variant="quiet" className="h-12 w-full" onClick={onSignOut}>
        <LogOut aria-hidden className="size-[22px]" />
        Sign out
      </Button>
    </PhonePage>
  );
}
