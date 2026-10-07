// The Deno entry for push-notify. Everything testable lives in handler.ts.
// Secrets (see supabase/.env.example): PUSH_NOTIFY_SECRET, VAPID_KEYS, VAPID_SUBJECT.
import { createClient } from '@supabase/supabase-js';
import { ApplicationServer, exportApplicationServerKey, importVapidKeys, PushMessageError, Urgency } from '@negrel/webpush';
import { handlePushNotify, type SendPush } from './handler.ts';

declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

// The secret is the only thing standing between the internet and a run: a short one can be guessed.
const pushSecret = required('PUSH_NOTIFY_SECRET');
if (pushSecret.length < 32) throw new Error('PUSH_NOTIFY_SECRET must be at least 32 characters');

const admin = createClient(required('SUPABASE_URL'), required('SUPABASE_SERVICE_ROLE_KEY'), {
  auth: { persistSession: false, autoRefreshToken: false },
});

// VAPID_KEYS is exportVapidKeys' JSON: { publicKey, privateKey } as JWKs.
const vapidKeys = await importVapidKeys(JSON.parse(required('VAPID_KEYS')));
const server = await ApplicationServer.new({ contactInformation: required('VAPID_SUBJECT'), vapidKeys });
const applicationServerKey = await exportApplicationServerKey(vapidKeys);

const sendPush: SendPush = async (subscription, payload, urgency) => {
  try {
    await server.subscribe(subscription).pushTextMessage(JSON.stringify(payload), {
      ttl: 3600,
      urgency: urgency === 'normal' ? Urgency.Normal : Urgency.Low,
    });
    return 'sent';
  } catch (error) {
    // The library's own isGone() knows only 410; the push services answer 404 as well.
    if (error instanceof PushMessageError && (error.response.status === 404 || error.response.status === 410)) return 'gone';
    return 'failed';
  }
};

Deno.serve((request) => handlePushNotify(request, { admin, sendPush, env: { pushSecret, applicationServerKey } }));
