import { useState, type FormEvent } from 'react';
import { DevicesSection } from '@/DevicesSection';
import { ProfilesSection } from '@/ProfilesSection';
import { updateHousehold, type Household } from '@/lib/household';
import { timezoneOptions } from '@/lib/timezones';

const field = 'min-h-12 w-full rounded-lg border border-input bg-background px-3 text-base text-foreground';
const action = 'min-h-12 rounded-lg px-4 text-base font-medium';

type Props = { household: Household; onSaved: (household: Household) => void; onSignOut: () => void };

export function SettingsPage({ household, onSaved, onSignOut }: Props) {
  const [name, setName] = useState(household.name);
  const [timezone, setTimezone] = useState(household.timezone);
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'failed'>('idle');

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
    <main className="mx-auto flex min-h-svh max-w-md flex-col gap-6 p-4">
      <h1 className="text-2xl font-semibold">Household settings</h1>
      <form onSubmit={(event) => void save(event)} className="flex flex-col gap-4">
        <label className="flex flex-col gap-2 text-base">
          Household name
          <input className={field} value={name} onChange={(e) => setName(e.target.value)} maxLength={100} required />
        </label>
        <label className="flex flex-col gap-2 text-base">
          Household Timezone
          <select className={field} value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions(household.timezone).map((zone) => (
              <option key={zone} value={zone}>
                {zone}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={`${action} bg-primary text-primary-foreground`} disabled={status === 'saving'}>
          Save
        </button>
        <p role="status" className="min-h-6 text-base">
          {status === 'saved' && 'Saved.'}
          {status === 'failed' && 'Could not save. Check the name and try again.'}
        </p>
      </form>
      <ProfilesSection householdId={household.id} />
      <DevicesSection />
      <button type="button" className={`${action} border border-border`} onClick={onSignOut}>
        Sign out
      </button>
    </main>
  );
}
