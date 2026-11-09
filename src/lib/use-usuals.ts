import { supabase } from './supabase';
import { useSyncedRead } from './synced-read';
import { loadUsuals } from './usuals';

// The Household's Usuals, read again when one changes. The Settings card writes them through the same read (its changes); the Send to
// Target sheet only reads. `data` is null until the first read lands.
const USUAL_TABLES = ['usuals'] as const;

export const useUsuals = () => useSyncedRead(() => loadUsuals(supabase), USUAL_TABLES, 'usuals');
