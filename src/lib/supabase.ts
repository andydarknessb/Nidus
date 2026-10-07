import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error('Nidus: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)');
}

// The project's address, for the calls to Edge Functions that are not the client's: the push key and the push test.
export const supabaseUrl: string = url;
export const supabase = createClient(url, anonKey);
