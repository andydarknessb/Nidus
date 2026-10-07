import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type * as PushModule from '../src/lib/push';

// What the tap on "Turn on notifications" does, in order, against stubbed browser globals: nothing here reaches the database (the
// fake key fetch stops each run before the save; readPushState gets its row answered by a stubbed fetch).

let push: typeof PushModule;
beforeAll(async () => {
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  push = await import('../src/lib/push');
});
afterEach(() => {
  vi.unstubAllGlobals();
});
afterAll(() => {
  vi.unstubAllEnvs();
});

// The browser as the tap finds it. `calls` is the order things happened in.
function browser(permission: NotificationPermission, subscribeError?: Error) {
  const calls: string[] = [];
  const stale = { unsubscribe: vi.fn(() => (calls.push('unsubscribe'), Promise.resolve(true))) };
  const registration = {
    pushManager: {
      subscribe: vi.fn(() => {
        calls.push('subscribe');
        // A subscribe that gets this far stops the run: there is no database here to save to.
        return Promise.reject(subscribeError ?? new Error('stop'));
      }),
      getSubscription: vi.fn(() => (calls.push('getSubscription'), Promise.resolve(stale))),
    },
  };
  vi.stubGlobal('Notification', { requestPermission: vi.fn(() => (calls.push('permission'), Promise.resolve(permission))) });
  vi.stubGlobal('navigator', {
    serviceWorker: {
      register: vi.fn(() => (calls.push('register'), Promise.resolve(registration))),
      ready: Promise.resolve(registration),
      getRegistration: vi.fn(() => Promise.reject(new Error('no worker'))),
    },
  });
  vi.stubGlobal('fetch', vi.fn(() => (calls.push('key'), Promise.resolve(new Response('BEl6_-ke', { status: 200 })))));
  return { calls, registration };
}

describe('turnOnNotifications', () => {
  it('asks for permission in the tap itself, before anything is awaited and before the worker is registered', async () => {
    const { calls } = browser('granted');
    const turning = push.turnOnNotifications();
    expect(calls).toEqual(['permission']);
    await expect(turning).rejects.toThrow('stop');
    expect(calls).toEqual(['permission', 'register', 'key', 'getSubscription', 'unsubscribe', 'subscribe']);
  });

  it.each<NotificationPermission>(['denied', 'default'])('registers nothing, fetches nothing and never subscribes when the answer is %s', async (answer) => {
    const { calls, registration } = browser(answer);
    expect(await push.turnOnNotifications()).toEqual({ kind: answer === 'denied' ? 'denied' : 'off' });
    expect(calls).toEqual(['permission']);
    expect(registration.pushManager.subscribe).not.toHaveBeenCalled();
  });

  it('drops whatever subscription the browser holds before subscribing, so a dead endpoint is never saved again', async () => {
    const { calls } = browser('granted');
    await expect(push.turnOnNotifications()).rejects.toThrow('stop');
    expect(calls.indexOf('unsubscribe')).toBeGreaterThan(calls.indexOf('getSubscription'));
    expect(calls.indexOf('unsubscribe')).toBeLessThan(calls.indexOf('subscribe'));
  });

  it('does not retry a refused subscribe', async () => {
    const invalid = Object.assign(new Error('different key'), { name: 'InvalidStateError' });
    const { calls } = browser('granted', invalid);
    await expect(push.turnOnNotifications()).rejects.toThrow('different key');
    expect(calls.filter((call) => call === 'subscribe')).toHaveLength(1);
  });
});

describe('readPushState', () => {
  // A supported phone whose browser holds a subscription; the database answers with `rows` for it.
  function phone(rows: unknown[], unsubscribe: () => Promise<boolean>) {
    const subscription = { endpoint: 'https://fcm.googleapis.com/fcm/send/x', unsubscribe: vi.fn(unsubscribe) };
    vi.stubGlobal('window', { PushManager: class {}, Notification: {}, matchMedia: () => ({ matches: false }) });
    vi.stubGlobal('Notification', { permission: 'granted' });
    vi.stubGlobal('navigator', {
      userAgent: 'Mozilla/5.0 (Linux; Android 14) Chrome/126 Mobile',
      platform: 'Linux armv81',
      maxTouchPoints: 5,
      serviceWorker: { getRegistration: vi.fn(() => Promise.resolve({ pushManager: { getSubscription: () => Promise.resolve(subscription) } })) },
    });
    vi.stubGlobal('fetch', vi.fn(() => Promise.resolve(new Response(JSON.stringify(rows), { status: 200, headers: { 'Content-Type': 'application/json' } }))));
    return subscription;
  }

  it('drops a subscription the browser holds when this account has no row for it, and says off', async () => {
    const subscription = phone([], () => Promise.resolve(true));
    expect(await push.readPushState()).toEqual({ kind: 'off' });
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('says off even when dropping it fails', async () => {
    const subscription = phone([], () => Promise.reject(new Error('refused')));
    expect(await push.readPushState()).toEqual({ kind: 'off' });
    expect(subscription.unsubscribe).toHaveBeenCalledOnce();
  });

  it('keeps a subscription that has its row', async () => {
    const row = { id: 'abc', endpoint: 'https://fcm.googleapis.com/fcm/send/x', event_reminders: true, reminder_minutes: 30, morning_summary: false, routines_nudge: true, list_additions: true };
    const subscription = phone([row], () => Promise.resolve(true));
    expect(await push.readPushState()).toMatchObject({ kind: 'on', id: 'abc' });
    expect(subscription.unsubscribe).not.toHaveBeenCalled();
  });
});

describe('turnOffBeforeSignOut', () => {
  it('never throws when turning off fails, so that signing out is never held up', async () => {
    browser('granted');
    // The stubbed browser has no PushManager, so it is not "supported" and does nothing; and with one, a failure is swallowed.
    vi.stubGlobal('window', { PushManager: class {}, Notification: {}, matchMedia: () => ({ matches: false }) });
    await expect(push.turnOffBeforeSignOut()).resolves.toBeUndefined();
  });
});
