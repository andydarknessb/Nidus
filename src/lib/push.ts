import { supabase, supabaseUrl } from './supabase';

// Notifications on this phone (spec 0007, The phone): the only place the UI reaches the browser's push. The service worker
// (public/sw.js) is registered only by turnOnNotifications, so the Wall's tablets never have one.

export type PushSupport = 'supported' | 'needs-home-screen' | 'unsupported';
export type PushPreferences = {
  eventReminders: boolean;
  reminderMinutes: 5 | 10 | 15 | 30 | 60;
  morningSummary: boolean;
  routinesNudge: boolean;
  listAdditions: boolean;
};
export type PushState = { kind: 'off' } | { kind: 'denied' } | { kind: 'on'; id: string; preferences: PushPreferences };

// What the server says when the subscription is not there to be changed or tested (its row is gone, or the push service has dropped it).
export class PushGoneError extends Error {}

export const REMINDER_MINUTES = [5, 10, 15, 30, 60] as const;

// What a phone gets before it chooses: everything on, the reminder 15 minutes ahead (the database's own defaults).
export const DEFAULT_PREFERENCES: PushPreferences = { eventReminders: true, reminderMinutes: 15, morningSummary: true, routinesNudge: true, listAdditions: true };

// Whether this browser can show notifications from Nidus. Pure over what it is given. An iPhone or iPad (iPadOS says it is a Mac,
// with a touch screen) shows them only to a Home Screen app; in a Safari tab it has no PushManager at all, so that is told first.
export function pushSupport(nav: Navigator = navigator, win: Window = window): PushSupport {
  const apple = /iPhone|iPad|iPod/.test(nav.userAgent) || (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1);
  const homeScreen = (nav as { standalone?: boolean }).standalone === true || win.matchMedia?.('(display-mode: standalone)').matches === true;
  if (apple && !homeScreen) return 'needs-home-screen';
  return 'serviceWorker' in nav && 'PushManager' in win && 'Notification' in win ? 'supported' : 'unsupported';
}

const columns = 'id, endpoint, event_reminders, reminder_minutes, morning_summary, routines_nudge, list_additions';

type Row = { id: string; endpoint: string; event_reminders: boolean; reminder_minutes: number; morning_summary: boolean; routines_nudge: boolean; list_additions: boolean };

const stateOf = (row: Row): PushState => ({
  kind: 'on',
  id: row.id,
  preferences: {
    eventReminders: row.event_reminders,
    reminderMinutes: row.reminder_minutes as PushPreferences['reminderMinutes'],
    morningSummary: row.morning_summary,
    routinesNudge: row.routines_nudge,
    listAdditions: row.list_additions,
  },
});

// This browser's subscription, if it has one, found without asking for anything.
async function currentSubscription(): Promise<PushSubscription | null> {
  const registration = await navigator.serviceWorker.getRegistration('/');
  return (await registration?.pushManager.getSubscription()) ?? null;
}

async function rowOf(endpoint: string): Promise<PushState> {
  const { data, error } = await supabase.from('push_subscriptions').select(columns).eq('endpoint', endpoint).maybeSingle<Row>();
  if (error) throw error;
  return data ? stateOf(data) : { kind: 'off' };
}

// What public/sw.js leaves when the push service rotates this phone's endpoint (its cache name and key are repeated there).
const ROTATION_CACHE = 'nidus-push-rotation';
const ROTATION_KEY = '/push-rotation';

async function rotationMarker(): Promise<{ old: string; new: string } | null> {
  try {
    const hit = await (await caches.open(ROTATION_CACHE)).match(ROTATION_KEY);
    return hit ? await hit.json() : null;
  } catch {
    return null;
  }
}

// The worker has already subscribed again; this saves the new endpoint as the signed-in account, with the old row's preferences when
// that row is still there (the sender deletes it on the first 410, and then the defaults apply). A refused save throws and leaves the
// subscription and the marker, to be tried again at the next open.
async function healRotation(subscription: PushSubscription, from: string): Promise<PushState> {
  const before = await rowOf(from);
  const { endpoint, keys } = subscription.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys?.['p256dh'], p_auth: keys?.['auth'] });
  if (error) throw error;
  const saved = await rowOf(subscription.endpoint);
  if (saved.kind === 'on' && before.kind === 'on') await savePushPreferences(saved.id, before.preferences);
  const { error: deleteError } = await supabase.from('push_subscriptions').delete().eq('endpoint', from);
  if (deleteError) throw deleteError;
  await (await caches.open(ROTATION_CACHE)).delete(ROTATION_KEY);
  return saved.kind === 'on' && before.kind === 'on' ? { ...saved, preferences: before.preferences } : saved;
}

// This browser's subscription and its row. A browser that cannot, or has not, subscribed is off.
export async function readPushState(): Promise<PushState> {
  if (pushSupport() !== 'supported') return { kind: 'off' };
  if (Notification.permission === 'denied') return { kind: 'denied' };
  const subscription = await currentSubscription();
  if (!subscription) return { kind: 'off' };
  const state = await rowOf(subscription.endpoint);
  if (state.kind === 'off') {
    // A subscription the worker made when the push service rotated the endpoint is saved, not dropped.
    const marker = await rotationMarker();
    if (marker?.new === subscription.endpoint) return healRotation(subscription, marker.old);
    // The browser holds a subscription this account has no row for (a turn-off at sign-out that failed): it is dropped, best effort.
    await subscription.unsubscribe().catch(() => undefined);
  }
  return state;
}

// base64url, as the key comes and as the push service wants it: the bytes.
function bytesOfBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(text.length / 4) * 4, '=');
  return Uint8Array.from(atob(padded), (char) => char.charCodeAt(0));
}

// Call from a tap: iOS asks for permission only from one, so the request is the first thing done, before anything is awaited.
// Asking and answering "no" is { kind: 'denied' }; closing the question without an answer leaves it off.
export async function turnOnNotifications(): Promise<PushState> {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') return { kind: 'denied' };
  if (permission !== 'granted') return { kind: 'off' };
  await navigator.serviceWorker.register('/sw.js', { scope: '/' });
  const registration = await navigator.serviceWorker.ready;
  const response = await fetch(`${supabaseUrl}/functions/v1/push-notify/key`);
  if (!response.ok) throw new Error(`push key: ${response.status}`);
  const applicationServerKey = bytesOfBase64Url((await response.text()).trim());
  // Any subscription the browser already holds goes first, so that a dead endpoint, or one made with another key, is never saved again.
  await (await registration.pushManager.getSubscription())?.unsubscribe();
  const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
  const { endpoint, keys } = subscription.toJSON();
  const { error } = await supabase.rpc('save_push_subscription', { p_endpoint: endpoint, p_p256dh: keys?.['p256dh'], p_auth: keys?.['auth'] });
  if (error) throw error;
  return rowOf(subscription.endpoint);
}

// Ends this phone's notifications: the row first, so that a failure leaves the phone as it was.
export async function turnOffNotifications(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) return;
  const { error } = await supabase.from('push_subscriptions').delete().eq('endpoint', subscription.endpoint);
  if (error) throw error;
  await subscription.unsubscribe();
}

export async function savePushPreferences(id: string, preferences: PushPreferences): Promise<void> {
  const { data, error } = await supabase
    .from('push_subscriptions')
    .update({
      event_reminders: preferences.eventReminders,
      reminder_minutes: preferences.reminderMinutes,
      morning_summary: preferences.morningSummary,
      routines_nudge: preferences.routinesNudge,
      list_additions: preferences.listAdditions,
    })
    .eq('id', id)
    .select('id');
  if (error) throw error;
  // A row that is not this account's is not updated, and says nothing.
  if (!data?.length) throw new PushGoneError('push preferences: no row saved');
}

// Sends this browser a test notification: only to its own subscription, as the signed-in account. A raw fetch, not the client's: the
// Edge Function is called by address, with the session's token.
export async function sendTestNotification(): Promise<void> {
  const subscription = await currentSubscription();
  if (!subscription) throw new Error('push test: not subscribed');
  const { data } = await supabase.auth.getSession();
  const response = await fetch(`${supabaseUrl}/functions/v1/push-notify/test`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${data.session?.access_token ?? ''}` },
    body: JSON.stringify({ endpoint: subscription.endpoint }),
  });
  if (response.status === 404 || response.status === 410) throw new PushGoneError(`push test: ${response.status}`);
  if (!response.ok) throw new Error(`push test: ${response.status}`);
}

// Signing out first ends this phone's notifications, so that a phone that has left stops receiving. Best effort: it never throws and
// never holds sign-out for more than a few seconds.
export async function turnOffBeforeSignOut(): Promise<void> {
  if (typeof window === 'undefined' || pushSupport() !== 'supported') return;
  const patience = new Promise<void>((resolve) => setTimeout(resolve, 3000));
  await Promise.race([turnOffNotifications().catch(() => undefined), patience]);
}
