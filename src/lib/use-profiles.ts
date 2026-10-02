import { useEffect, useState } from 'react';
import { useChangeTick } from './change-feed';
import type { ProfileFilter } from './profile-filter';
import { loadProfiles, type Profile } from './profiles';
import { supabase } from './supabase';

// A rename, a new colour, a new Profile or a deleted one reads them again.
const PROFILE_TABLES = ['profiles'] as const;
// After a failed read, try again sooner, as the Wall's other readers do.
const RETRY_MS = 5_000;

// The Household's Profiles in their own order, read once by the shell for everything that draws a person: the people
// strip and the fill and discs of every event pill. null until the first read lands; a failed read keeps what the Wall
// has and looks again soon. A Profile that was deleted leaves the filter as soon as it is gone.
export function useProfiles(filter: ProfileFilter): Profile[] | null {
  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const changes = useChangeTick(PROFILE_TABLES);
  useEffect(() => {
    let live = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    function read() {
      loadProfiles(supabase).then(
        (rows) => {
          if (!live) return;
          setProfiles(rows);
          filter.prune(rows);
        },
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
  return profiles;
}
