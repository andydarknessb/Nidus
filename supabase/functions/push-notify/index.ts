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
const contactInformation = required('VAPID_SUBJECT');
const applicationServerKey = await exportApplicationServerKey(vapidKeys);

// A push service that never answers must not hold up the minute's run.
const SEND_TIMEOUT_MS = 10_000;

const sendPush: SendPush = async (subscription, payload, urgency) => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<'failed'>((resolve) => {
    timer = setTimeout(() => resolve('failed'), SEND_TIMEOUT_MS);
  });
  const send = (async (): Promise<'sent' | 'gone' | 'failed'> => {
    try {
      // A new application server per message: ApplicationServer.new makes a fresh ECDH key pair
      // each time, which RFC 8291 section 3.1 asks for. Only the VAPID keys are reused.
      const server = await ApplicationServer.new({ contactInformation, vapidKeys });
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
  })();
  try {
    return await Promise.race([send, timeout]);
  } finally {
    clearTimeout(timer);
  }
};

Deno.serve((request) => handlePushNotify(request, { admin, sendPush, env: { pushSecret, applicationServerKey } }));
