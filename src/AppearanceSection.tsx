import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateHousehold, type Household } from '@/lib/household';
import type { Appearance } from '@/lib/mode';

// Light and Dark carry the icon of what they are; Auto is the Wall following the sun, which no one icon says.
const OPTIONS: { value: Appearance; label: string; Icon?: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'auto', label: 'Auto' },
];

// Settings, phone only: how the Wall looks. A choice is saved the moment it is made, and the screen says what Auto
// does. The Wall reads the Household again when it changes, so a tablet follows within a second or two. A Device
// reads the Appearance and never gets this screen. The section brings its own heading, as the others do, so a card
// can take it whole.
export function AppearanceSection({ household, onSaved }: { household: Household; onSaved: (household: Household) => void }) {
  // The choice being saved shows as chosen at once; it goes back to the saved one if the save fails.
  const [saving, setSaving] = useState<Appearance | null>(null);
  const [failed, setFailed] = useState(false);
  const chosen = saving ?? household.appearance;

  async function choose(appearance: Appearance) {
    // One save at a time, so a slow answer can never land after a newer one; the chosen one is already saved.
    if (saving !== null || appearance === household.appearance) return;
    setSaving(appearance);
    setFailed(false);
    try {
      onSaved(await updateHousehold(household.id, { appearance }));
    } catch {
      setFailed(true);
    } finally {
      setSaving(null);
    }
  }

  return (
    <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
      <h2 id="appearance-heading" className="font-display text-[22px] leading-7">
        Appearance
      </h2>
      <div className="flex flex-col gap-2">
        <span id="appearance-label" className="text-[15px] leading-5 text-muted-foreground">
          The Wall looks
        </span>
        <div role="group" aria-labelledby="appearance-label" aria-describedby="appearance-help" className="grid h-14 grid-cols-3 gap-1 rounded-2xl bg-muted p-1">
          {OPTIONS.map(({ value, label, Icon }) => (
            <Button key={value} variant="quiet" aria-pressed={chosen === value} className="h-12 rounded-xl px-2 text-base font-medium" onClick={() => void choose(value)}>
              {Icon && <Icon aria-hidden="true" />}
              {label}
            </Button>
          ))}
        </div>
        <p id="appearance-help" className="text-sm leading-5 text-muted-foreground">
          Auto is light by day and dark after sunset. The switch on the Wall changes it until the next sunrise or sunset.
        </p>
        {failed && (
          <p role="alert" className="text-base">
            Could not save. Try again.
          </p>
        )}
      </div>
    </section>
  );
}
