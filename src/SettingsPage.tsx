import { LogOut } from 'lucide-react';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { AppearanceSection } from '@/AppearanceSection';
import { DevicesSection } from '@/DevicesSection';
import { HouseholdAccountsSection } from '@/HouseholdAccountsSection';
import { NotificationsSection } from '@/NotificationsSection';
import { ProfilesSection } from '@/ProfilesSection';
import { WeatherSection } from '@/WeatherSection';
import { Card, Field, PhonePage, Problem, cardClass, fieldClass, helpClass, statusLineClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { updateHousehold, type Household } from '@/lib/household';
import { timezoneOptions } from '@/lib/timezones';
import { useWriteProblem } from '@/lib/use-write-problem';

type Props = { household: Household; userId: string; onSaved: (household: Household) => void; onSignOut: () => void };

// The phone's Household page (/settings): the Household's name and time zone, how the Wall looks, the weather, the people and the
// Wall tablets, who can sign in and notifications on this phone, then Sign out. The Calendar Accounts and the events added in Nidus are on the Calendars page.
export function SettingsPage({ household, userId, onSaved, onSignOut }: Props) {
  const [name, setName] = useState(household.name);
  const [timezone, setTimezone] = useState(household.timezone);
  const [saved, setSaved] = useState(false);
  // What a save that did not go through says (the Wall's two sentences; "Check the name" only when the database refused the name), at
  // once, under the button. One save at a time: while it is on its way Save is `aria-disabled` and does nothing, never `disabled`,
  // which would drop the focus to the page.
  const problems = useWriteProblem();
  const working = useRef(false);
  const [busy, setBusy] = useState(false);
  // About four hundred zones, each named: drawn once for a zone and not again at every key typed in the name.
  const zones = useMemo(() => timezoneOptions(household.timezone), [household.timezone]);

  async function save(event: FormEvent) {
    event.preventDefault();
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setSaved(false);
    try {
      onSaved(await updateHousehold(household.id, { name: name.trim(), timezone }));
      problems.clear('household');
      setSaved(true);
    } catch (error) {
      problems.fail('household', error, { refusal: 'Could not save. Check the name and try again.' });
    } finally {
      working.current = false;
      setBusy(false);
    }
  }

  const problem = problems.at('household');
  // What was said is old once either field changes.
  const edited = () => {
    setSaved(false);
    problems.clear();
  };

  return (
    <PhonePage title="Household settings">
      <Card title="Household">
        <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
          <Field label="Name">
            <input
              className={fieldClass}
              autoComplete="off"
              value={name}
              onChange={(e) => {
                setName(e.target.value);
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
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
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
        <AppearanceSection household={household} onSaved={onSaved} />
      </div>
      <WeatherSection household={household} onSaved={onSaved} />
      <ProfilesSection householdId={household.id} />
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
