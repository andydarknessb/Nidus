import { LogOut } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { AppearanceSection } from '@/AppearanceSection';
import { DevicesSection } from '@/DevicesSection';
import { ProfilesSection } from '@/ProfilesSection';
import { WeatherSection } from '@/WeatherSection';
import { Card, Field, PhonePage, cardClass, fieldClass, helpClass } from '@/components/phone';
import { Button } from '@/components/ui/button';
import { updateHousehold, type Household } from '@/lib/household';
import { timezoneOptions } from '@/lib/timezones';

type Props = { household: Household; onSaved: (household: Household) => void; onSignOut: () => void };

// The phone's Household page (/settings): the Household's name and time zone, how the Wall looks, the weather, the people and the
// Wall tablets, then Sign out. The Calendar Accounts and the events added in Nidus are on the Calendars page.
export function SettingsPage({ household, onSaved, onSignOut }: Props) {
  const [name, setName] = useState(household.name);
  const [timezone, setTimezone] = useState(household.timezone);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');
  // About four hundred zones, each named: drawn once for a zone and not again at every key typed in the name.
  const zones = useMemo(() => timezoneOptions(household.timezone), [household.timezone]);

  async function save(event: FormEvent) {
    event.preventDefault();
    setStatus('saving');
    try {
      onSaved(await updateHousehold(household.id, { name: name.trim(), timezone }));
      setStatus('saved');
    } catch {
      setStatus('failed');
    }
  }

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
                setStatus('idle');
              }}
              maxLength={100}
              required
            />
          </Field>
          <div className="flex flex-col gap-2">
            <Field label="Time zone">
              <select
                className={fieldClass}
                value={timezone}
                onChange={(e) => {
                  setTimezone(e.target.value);
                  setStatus('idle');
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
          {/* The line for what the save did is there from the start, so a screen reader has it before it speaks, and is one line
              tall whichever it says, so nothing below moves. */}
          <div className="flex flex-col gap-2">
            <Button type="submit" variant="primary" size="phone" disabled={status === 'saving'}>
              Save
            </Button>
            <p role="status" className="min-h-6 text-base">
              {status === 'saved' && 'Saved.'}
              {status === 'failed' && 'Could not save. Check the name and try again.'}
            </p>
          </div>
        </form>
      </Card>
      <div className={cardClass}>
        <AppearanceSection household={household} onSaved={onSaved} />
      </div>
      <WeatherSection household={household} onSaved={onSaved} />
      <ProfilesSection householdId={household.id} />
      <DevicesSection />
      <Button variant="quiet" className="h-12 w-full" onClick={onSignOut}>
        <LogOut aria-hidden className="size-[22px]" />
        Sign out
      </Button>
    </PhonePage>
  );
}
