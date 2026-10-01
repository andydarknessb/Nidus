// The Deno entry for calendar-sync. Everything testable lives in handler.ts.
// Secrets (see supabase/.env.example): CALENDAR_SYNC_SECRET, GOOGLE_CALENDAR_CLIENT_ID,
// GOOGLE_CALENDAR_CLIENT_SECRET.
import { createClient } from '@supabase/supabase-js';
import { handleCalendarSync } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// The secret is the only thing standing between the internet and a sync: a short one can be guessed.
const syncSecret = required('CALENDAR_SYNC_SECRET');
if (syncSecret.length < 32) throw new Error('CALENDAR_SYNC_SECRET must be at least 32 characters');

const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleCalendarSync(request, {
    admin,
    fetch,
    env: {
      syncSecret,
      googleClientId: required('GOOGLE_CALENDAR_CLIENT_ID'),
      googleClientSecret: required('GOOGLE_CALENDAR_CLIENT_SECRET'),
    },
  }),
);
