import { useEffect, useId, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { personStyle } from '@/lib/look';
import { PROFILE_PALETTE, colorOwners, initialOf, namesInWords, type Profile } from '@/lib/profiles';
import { helpClass, labelClass } from './phone';

// The parts of the People card that say something to the family (docs/look.md; spec 0003, People): the colours a person can be
// given and whose each one is, and what deleting a person takes with them. Drawn from what they are told, so a test renders them.

// What deleting a person takes with them, as the database does it: their Routines go, and every Routine Completion with them
// (on delete cascade); an event added here that was only for them is left with no one named, and a Mirrored Calendar set to them
// with no Profile (on delete cascade of the join row, and set null), and both read as the whole Household's.
export const DELETE_PERSON_WORDS = "Their Routines and every tick go. Events only for them, and calendars set to them, become everyone's.";

// What a swatch says of whose it is: the first two initials, and a count past them, so it never carries more than that.
const initialsOf = (owners: readonly Pick<Profile, 'name'>[]) =>
  owners
    .slice(0, 2)
    .map((owner) => initialOf(owner.name))
    .join('') + (owners.length > 2 ? `+${owners.length - 2}` : '');

// The ten colours as a group of radios, five to a row. Nothing here is told by colour alone: each swatch is named, the chosen one
// has a ring, and a colour someone already has carries their initial and says whose it is in its name. A colour in use can still
// be chosen: two children may share one on purpose, and the first free colour is only where a new person starts. `profiles` is
// everyone, the person being edited included, whose own colour then carries their own initial.
export function ColorPicker({
  value,
  profiles,
  onChange,
}: {
  value: string;
  profiles: readonly Pick<Profile, 'id' | 'name' | 'color'>[];
  onChange: (hex: string) => void;
}) {
  // One group of radios to a picker, so a form to add and a form to edit open together do not share a choice.
  const group = useId();
  const inUse = PROFILE_PALETTE.some(({ hex }) => colorOwners(profiles, hex).length > 0);
  return (
    <fieldset className="flex flex-col">
      <legend className={`${labelClass} mb-2`}>Colour</legend>
      <div className="grid grid-cols-5 gap-3">
        {PROFILE_PALETTE.map(({ name, hex }) => {
          const owners = colorOwners(profiles, hex);
          return (
            <label
              key={hex}
              // The swatch is the family's own 300 step (the person's base) and the initial on it is --ink: the pair a finished
              // tile uses, held to 7 to 1 for every family by tests/look.test.ts. The ring and the outline sit outside it.
              className="person relative flex aspect-square cursor-pointer items-center justify-center rounded-full bg-person-base text-[17px] leading-none font-semibold text-person-on-base has-[:checked]:ring-2 has-[:checked]:ring-foreground has-[:checked]:ring-offset-2 has-[:checked]:ring-offset-card has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-[5px] has-[:focus-visible]:outline-ring"
              style={personStyle(hex)}
            >
              <input
                type="radio"
                name={group}
                className="sr-only"
                value={hex}
                checked={value.toLowerCase() === hex}
                onChange={() => onChange(hex)}
                aria-label={owners.length === 0 ? name : `${name}, in use by ${namesInWords(owners.map((owner) => owner.name))}`}
              />
              {owners.length > 0 && <span aria-hidden="true">{initialsOf(owners)}</span>}
            </label>
          );
        })}
      </div>
      {inUse && <p className={`${helpClass} mt-2`}>A letter marks a colour someone already has.</p>}
    </fieldset>
  );
}

// Before a person is deleted: who, what goes with them, and the two ways out. It takes the focus when it opens, so a screen
// reader reads what is about to happen before it can be done; the safe button comes first.
export function DeletePerson({ name, busy = false, onCancel, onDelete }: { name: string; busy?: boolean; onCancel: () => void; onDelete: () => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  return (
    <div className="flex flex-col gap-3">
      <h3 ref={heading} tabIndex={-1} className="text-[17px] leading-6 font-semibold">
        Delete {name}?
      </h3>
      <p className="text-base leading-6">{DELETE_PERSON_WORDS}</p>
      <div className="flex gap-2">
        <Button variant="secondary" size="phone" className="flex-1" onClick={onCancel}>
          Cancel
        </Button>
        <Button variant="delete" size="phone" className="h-auto min-h-14 flex-[2] py-2 whitespace-normal" disabled={busy} onClick={onDelete}>
          Delete {name}
        </Button>
      </div>
    </div>
  );
}
