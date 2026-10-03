import { Moon, Sun } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { updateHousehold, type Household } from '@/lib/household';
import type { Appearance } from '@/lib/mode';
import { useWriteProblem } from '@/lib/use-write-problem';
import { NOT_SAVED } from '@/lib/write-failure';

// Light and Dark carry the icon of what they are; Auto is the Wall following the sun, which no one icon says.
const OPTIONS: { value: Appearance; label: string; Icon?: typeof Sun }[] = [
  { value: 'light', label: 'Light', Icon: Sun },
  { value: 'dark', label: 'Dark', Icon: Moon },
  { value: 'auto', label: 'Auto' },
];

// What Auto does for this Household: it follows the sun when there is a weather place to read it from, and keeps to the
// hours the Wall falls back on when there is none.
const AUTO_WORDS = {
  sun: 'Auto is light from sunrise to sunset. The switch on the Wall changes it until the next sunrise or sunset.',
  hours: 'Auto is light from 7 AM to 7 PM. The switch on the Wall changes it until the next 7 AM or 7 PM. Add a weather place to follow sunrise and sunset.',
};

// What the last save did: nothing yet (or the next choice has started), it landed, or it did not.
export type SaveStatus = 'idle' | 'saved' | 'failed';

// The section as it is drawn for what it is told: the choice made, whether the Household has a weather place, and what the last
// save did, in `words` when it did not go through (the Wall's two sentences, by what went wrong). Kept apart from the saving so
// that it can be rendered, and tested, in each state. It brings its own heading, as the other sections do, so a card can take it
// whole.
export function AppearanceControl({
  chosen,
  weatherOn,
  status,
  words = NOT_SAVED,
  onChoose,
}: {
  chosen: Appearance;
  weatherOn: boolean;
  status: SaveStatus;
  words?: string | undefined;
  onChoose: (appearance: Appearance) => void;
}) {
  return (
    <section aria-labelledby="appearance-heading" className="flex flex-col gap-4">
      <h2 id="appearance-heading" className="font-display text-[22px] leading-7">
        Appearance
      </h2>
      <div className="flex flex-col gap-2">
        <span id="appearance-label" className="text-[15px] leading-5 text-muted-foreground">
          The Wall looks
        </span>
        <div role="group" aria-labelledby="appearance-label" aria-describedby="appearance-help" className="grid h-14 grid-cols-3 gap-2 rounded-2xl bg-muted p-1">
          {OPTIONS.map(({ value, label, Icon }) => (
            <Button key={value} variant="quiet" aria-pressed={chosen === value} className="h-12 rounded-xl px-2 text-base font-medium" onClick={() => onChoose(value)}>
              {Icon && <Icon aria-hidden="true" />}
              {label}
            </Button>
          ))}
        </div>
        <p id="appearance-help" className="text-sm leading-5 text-muted-foreground">
          {weatherOn ? AUTO_WORDS.sun : AUTO_WORDS.hours}
        </p>
        {/* The status line is there from the start, as in the Weather section, so a screen reader has it before it speaks; the
            line it keeps is one line tall whichever of the two says something, so nothing below moves. */}
        <div className="min-h-6 text-base">
          <p role="status">{status === 'saved' && 'Saved.'}</p>
          {status === 'failed' && <p role="alert">{words}</p>}
        </div>
      </div>
    </section>
  );
}

// Settings, phone only: how the Wall looks. A choice is saved the moment it is made, and the section says when it has landed
// and what Auto does. The Wall reads the Household again when it changes, so a tablet follows within a second or two. A Device
// reads the Appearance and never gets this screen.
export function AppearanceSection({ household, onSaved }: { household: Household; onSaved: (household: Household) => void }) {
  // The choice being saved shows as chosen at once; it goes back to the saved one if the save fails.
  const [saving, setSaving] = useState<Appearance | null>(null);
  const [status, setStatus] = useState<SaveStatus>('idle');
  const problems = useWriteProblem();

  async function choose(appearance: Appearance) {
    // One save at a time, so a slow answer can never land after a newer one; the chosen one is already saved.
    if (saving !== null || appearance === household.appearance) return;
    setSaving(appearance);
    setStatus('idle');
    try {
      onSaved(await updateHousehold(household.id, { appearance }));
      setStatus('saved');
    } catch (error) {
      problems.fail('appearance', error);
      setStatus('failed');
    } finally {
      setSaving(null);
    }
  }

  return (
    <AppearanceControl
      chosen={saving ?? household.appearance}
      weatherOn={household.weather_place !== null}
      status={status}
      words={problems.at('appearance')?.words}
      onChoose={(appearance) => void choose(appearance)}
    />
  );
}
