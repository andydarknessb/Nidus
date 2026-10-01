import { Check } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useChangeTick } from '../lib/change-feed';
import type { ProfileFilter } from '../lib/profile-filter';
import { loadProfiles, type Profile } from '../lib/profiles';
import { supabase } from '../lib/supabase';

// A rename, a new colour, a new Profile or a deleted one moves the chips.
const PROFILE_TABLES = ['profiles'] as const;

// The Profile filter's chips for the Wall's header (CONTEXT.md: Profile): a toggle per Profile in the
// Profiles' order, and "Show everyone" while any is pressed. Nothing with fewer than two Profiles,
// where there is no one to pick between. The chips scroll sideways when they do not fit and never
// wrap, so they cannot make the header taller; "Show everyone" stays outside the scroll, so a filter
// that is on can always be seen and cleared. Pressed is a check and a filled ground as well as the
// colour, and the words stay the default foreground, which clears 7:1 on either ground. It takes the
// header's flexible middle, and keeps a 20rem basis while a long Household name truncates.
export function ProfileChips({ filter, pressed }: { filter: ProfileFilter; pressed: readonly string[] }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const group = useRef<HTMLDivElement>(null);
  const changes = useChangeTick(PROFILE_TABLES);
  useEffect(() => {
    let live = true;
    loadProfiles(supabase).then(
      (rows) => {
        if (!live) return;
        setProfiles(rows);
        // A deleted Profile leaves the filter.
        filter.prune(rows);
      },
      // Offline: keep the chips the screen has.
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, [changes, filter]);

  if (profiles.length < 2) return null;
  return (
    <div className="flex min-w-0 flex-[1_1_20rem] items-center gap-3">
      {/* The padding gives a focus ring room inside the scroll; the negative margin takes it back out of the header's height. */}
      <div ref={group} role="group" aria-label="Show events for" className="-my-1 flex items-center gap-2 overflow-x-auto py-1 [scrollbar-width:none]">
        {profiles.map((profile) => {
          const on = pressed.includes(profile.id);
          return (
            <button
              key={profile.id}
              type="button"
              aria-pressed={on}
              onClick={(event) => {
                const button = event.currentTarget;
                filter.toggle(profile.id);
                // "Show everyone" takes room as the filter comes on: keep the chip just pressed in view.
                requestAnimationFrame(() => button.scrollIntoView({ block: 'nearest', inline: 'nearest' }));
              }}
              className={`flex min-h-12 shrink-0 items-center gap-2 rounded-lg border-2 px-4 text-lg font-medium whitespace-nowrap ${on ? 'border-foreground bg-muted' : 'border-border'}`}
            >
              {/* The check sits in the dot, so a tap never moves the chips beside it. */}
              <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full text-background" style={{ backgroundColor: profile.color }}>
                {on && <Check className="size-4" strokeWidth={3} />}
              </span>
              {profile.name}
            </button>
          );
        })}
      </div>
      {pressed.length > 0 && (
        <button
          type="button"
          className="min-h-12 shrink-0 rounded-lg border border-border px-4 text-lg font-medium whitespace-nowrap"
          onClick={() => {
            filter.clear();
            // This button goes with the filter: put focus on the first chip instead of losing it.
            group.current?.querySelector('button')?.focus();
          }}
        >
          Show everyone
        </button>
      )}
    </div>
  );
}
