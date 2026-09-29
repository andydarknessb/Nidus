// The Deno entry for calendar-connect. Everything testable lives in handler.ts.
// Secrets (see supabase/.env.example): CALENDAR_STATE_SECRET, GOOGLE_CALENDAR_CLIENT_ID,
// GOOGLE_CALENDAR_CLIENT_SECRET, APP_URL, and optionally CALENDAR_CONNECT_URL.
import { createClient } from '@supabase/supabase-js';
import { handleCalendarConnect } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// A short secret lets one observed state be brute-forced offline and then forged.
if (required('CALENDAR_STATE_SECRET').length < 32) throw new Error('CALENDAR_STATE_SECRET must be at least 32 characters');

const supabaseUrl = required('SUPABASE_URL');
const admin = createClient(supabaseUrl, required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) =>
  handleCalendarConnect(request, {
    admin,
    fetch,
    env: {
      functionUrl: Deno.env.get('CALENDAR_CONNECT_URL') ?? `${supabaseUrl}/functions/v1/calendar-connect`,
      appUrl: required('APP_URL'),
      stateSecret: required('CALENDAR_STATE_SECRET'),
      googleClientId: required('GOOGLE_CALENDAR_CLIENT_ID'),
      googleClientSecret: required('GOOGLE_CALENDAR_CLIENT_SECRET'),
    },
  }),
);
