import { Check } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useChangeTick } from '../lib/change-feed';
import type { ProfileFilter } from '../lib/profile-filter';
import { loadProfiles, type Profile } from '../lib/profiles';
import { supabase } from '../lib/supabase';

// A rename, a new colour, a new Profile or a deleted one moves the chips.
const PROFILE_TABLES = ['profiles'] as const;
// After a failed read, try again sooner, as the Wall's other readers do.
const RETRY_MS = 5_000;

// One toggle chip: a dot in the Profile's colour (grey for everyone) with a check in it while pressed,
// and the name. The check sits in the dot, so a tap never changes the chip's width, and the words stay
// the default foreground, which clears 7:1 on either ground.
function Chip({ name, color, on, onClick }: { name: string; color: string; on: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`flex min-h-12 shrink-0 items-center gap-2 rounded-lg border-2 px-4 text-lg font-medium whitespace-nowrap ${on ? 'border-foreground bg-muted' : 'border-border'}`}
    >
      <span aria-hidden className="grid size-5 shrink-0 place-items-center rounded-full text-background" style={{ backgroundColor: color }}>
        {on && <Check className="size-4" strokeWidth={3} />}
      </span>
      {name}
    </button>
  );
}

// The Profile filter's chips for the Wall's header (CONTEXT.md: Profile): "Everyone", pressed while no
// filter is on, then a toggle per Profile in the Profiles' order. Nothing with fewer than two Profiles,
// where there is no one to pick between, and nothing while `hidden` (a screen that is not a calendar),
// though it stays mounted so the Profiles it has read are kept. The row scrolls sideways when it does
// not fit and never wraps, so it cannot make the header taller; a fade on its trailing edge shows that
// more lie past it, and its wrapper clips it, so nothing of it paints outside its box.
export function ProfileChips({ filter, pressed, hidden }: { filter: ProfileFilter; pressed: readonly string[]; hidden: boolean }) {
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const changes = useChangeTick(PROFILE_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function read() {
      loadProfiles(supabase).then(
        (rows) => {
          if (!live) return;
          setProfiles(rows);
          // A deleted Profile leaves the filter.
          filter.prune(rows);
        },
        // Keep the chips the screen has and look again soon.
        () => {
          if (live) timer = setTimeout(read, RETRY_MS);
        },
      );
    }
    read();
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [changes, filter]);

  if (hidden || profiles.length < 2) return null;
  return (
    // The padding gives a focus ring room inside the clip; the negative margin takes it back out of the header's height.
    <div className="-my-1 min-w-0 flex-1 overflow-hidden py-1">
      {/* The end padding is as wide as the fade, so the last chip clears it when scrolled to the end. */}
      <div
        role="group"
        aria-label="Show events for"
        className="-my-1 flex items-center gap-2 overflow-x-auto py-1 pr-8 [mask-image:linear-gradient(to_right,#000_calc(100%-2rem),transparent)] [scrollbar-width:none]"
      >
        <Chip name="Everyone" color="var(--muted-foreground)" on={pressed.length === 0} onClick={filter.clear} />
        {profiles.map((profile) => (
          <Chip key={profile.id} name={profile.name} color={profile.color} on={pressed.includes(profile.id)} onClick={() => filter.toggle(profile.id)} />
        ))}
      </div>
    </div>
  );
}
