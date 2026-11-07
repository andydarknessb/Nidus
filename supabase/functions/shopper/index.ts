// The Deno entry for shopper. Everything testable lives in handler.ts.
// Secrets (see supabase/.env.example): ANTHROPIC_API_KEY. The service role is in the function's environment already.
import { createClient } from '@supabase/supabase-js';
import { handleShopper } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

const admin = createClient(Deno.env.get('SUPABASE_URL') ?? '', Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '', {
  auth: { persistSession: false, autoRefreshToken: false },
});

Deno.serve((request) => handleShopper(request, { admin, apiKey: Deno.env.get('ANTHROPIC_API_KEY') || undefined }));
