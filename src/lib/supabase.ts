import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;
if (!url || !anonKey) {
  throw new Error('Nidus: set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (see .env.example)');
}

// The project's address, for the one call that is not the client's (the push key).
export const supabaseUrl: string = url;
export const supabase = createClient(url, anonKey);
