import { useLayoutEffect } from 'react';
import type { ProfileFilter } from './profile-filter';
import { loadProfiles, type Profile } from './profiles';
import { supabase } from './supabase';
import { useSyncedRead } from './synced-read';

// A rename, a new colour, a new Profile or a deleted one reads them again.
const PROFILE_TABLES = ['profiles'] as const;

// The Household's Profiles in their own order, read by the shell (and again when they change) for everything that draws a person:
// the people strip and the fill and discs of every event pill. The Routines reader and the Add event sheet are handed them, not
// reading them again. null until the first read lands; a failed read keeps what the Wall has and looks again soon (the synced
// read's retry). A Profile that was deleted leaves the filter as soon as it is gone: each read that lands prunes it.
export function useProfiles(filter: ProfileFilter): Profile[] | null {
  const { data } = useSyncedRead(() => loadProfiles(supabase), PROFILE_TABLES, 'profiles');
  // Before paint, so no frame draws the strip without a deleted person while the filter still names them.
  useLayoutEffect(() => {
    if (data) filter.prune(data);
  }, [data, filter]);
  return data;
}
