import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { pushSupport as pushSupportType } from '../src/lib/push';

// The phone's side of notifications (spec 0007, The phone): which browsers can show them, and what the service worker does with
// a push and with a tap. Neither reaches the database: the first is pure over a fake navigator, the second runs public/sw.js in a
// fake service worker global.

let pushSupport: typeof pushSupportType;
beforeAll(async () => {
  // push.ts reaches the Supabase client, which reads these at import; CI has no .env.local.
  vi.stubEnv('VITE_SUPABASE_URL', process.env['VITE_SUPABASE_URL'] ?? 'http://127.0.0.1:54321');
  vi.stubEnv('VITE_SUPABASE_ANON_KEY', process.env['VITE_SUPABASE_ANON_KEY'] ?? 'placeholder-anon-key');
  ({ pushSupport } = await import('../src/lib/push'));
});
afterAll(() => {
  vi.unstubAllEnvs();
});

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1';
const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36';
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

type Fake = { userAgent: string; platform?: string; maxTouchPoints?: number; standalone?: boolean; serviceWorker?: object };
const nav = ({ serviceWorker = {}, ...rest }: Fake) => ({ platform: '', maxTouchPoints: 0, serviceWorker, ...rest }) as unknown as Navigator;
const win = (apis: { push?: boolean; notification?: boolean; displayStandalone?: boolean } = { push: true, notification: true }) =>
  ({
    ...(apis.push ? { PushManager: class {} } : {}),
    ...(apis.notification ? { Notification: class {} } : {}),
    matchMedia: (query: string) => ({ matches: query === '(display-mode: standalone)' && apis.displayStandalone === true }),
  }) as unknown as Window;

describe('pushSupport', () => {
  it('is supported on Android Chrome', () => {
    expect(pushSupport(nav({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 }), win())).toBe('supported');
  });

  it('is supported on a desktop with the three APIs', () => {
    expect(pushSupport(nav({ userAgent: MAC_SAFARI, platform: 'MacIntel' }), win())).toBe('supported');
  });

  it('is unsupported without PushManager, Notification or serviceWorker', () => {
    expect(pushSupport(nav({ userAgent: ANDROID }), win({ notification: true }))).toBe('unsupported');
    expect(pushSupport(nav({ userAgent: ANDROID }), win({ push: true }))).toBe('unsupported');
    const bare = { userAgent: ANDROID, platform: '', maxTouchPoints: 0 } as unknown as Navigator;
    expect(pushSupport(bare, win())).toBe('unsupported');
  });

  it('needs the Home Screen in an iPhone Safari tab, where PushManager is not there', () => {
    expect(pushSupport(nav({ userAgent: IPHONE, platform: 'iPhone', maxTouchPoints: 5 }), win({ notification: true }))).toBe('needs-home-screen');
  });

  it('needs the Home Screen in Chrome on an iPhone, which is Safari underneath', () => {
    const chrome = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.153 Mobile/15E148 Safari/604.1';
    expect(pushSupport(nav({ userAgent: chrome, platform: 'iPhone', maxTouchPoints: 5 }), win({ notification: true }))).toBe('needs-home-screen');
  });

  it('is supported on an iPad Home Screen app that says it is a Mac, and on an installed Android app', () => {
    expect(pushSupport(nav({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5, standalone: true }), win())).toBe('supported');
    expect(pushSupport(nav({ userAgent: ANDROID, platform: 'Linux armv81', maxTouchPoints: 5 }), win({ push: true, notification: true, displayStandalone: true }))).toBe('supported');
  });

  it('needs the Home Screen in an iPad tab that says it is a Mac, and not on a Mac without a touch screen', () => {
    expect(pushSupport(nav({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 5 }), win({ notification: true }))).toBe('needs-home-screen');
    expect(pushSupport(nav({ userAgent: MAC_SAFARI, platform: 'MacIntel', maxTouchPoints: 0 }), win())).toBe('supported');
  });

  it('is supported on an iPhone Home Screen app, found by navigator.standalone or by the display mode', () => {
    expect(pushSupport(nav({ userAgent: IPHONE, platform: 'iPhone', standalone: true }), win())).toBe('supported');
    expect(pushSupport(nav({ userAgent: IPHONE, platform: 'iPhone' }), win({ push: true, notification: true, displayStandalone: true }))).toBe('supported');
  });

  it('is unsupported on an iPhone Home Screen app of an iOS too old for push', () => {
    expect(pushSupport(nav({ userAgent: IPHONE, platform: 'iPhone', standalone: true }), win({ displayStandalone: true }))).toBe('unsupported');
  });
});

// ---- public/sw.js, in a fake service worker global ----------------------------------------------------------------------------

const source = readFileSync(new URL('../public/sw.js', import.meta.url), 'utf8');
const SCOPE = 'https://nidus.example/';

type Listener = (event: unknown) => void;
type FakeClient = { url: string; focus: ReturnType<typeof vi.fn>; navigate?: ReturnType<typeof vi.fn> };
const claim = vi.fn(() => Promise.resolve());

function worker(clients: FakeClient[] = []) {
  const listeners = new Map<string, Listener>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const subscribed: unknown[] = [];
  const marked = new Map<string, string>();
  const self = {
    addEventListener: (type: string, listener: Listener) => listeners.set(type, listener),
    caches: {
      open: (name: string) =>
        Promise.resolve({
          put: (request: string, response: Response) => response.text().then((text) => void marked.set(`${name} ${request}`, text)),
          match: (request: string) => {
            const text = marked.get(`${name} ${request}`);
            return Promise.resolve(text === undefined ? undefined : new Response(text));
          },
        }),
    },
    registration: {
      scope: SCOPE,
      pushManager: {
        subscribe: (options: unknown) => {
          subscribed.push(options);
          return Promise.resolve({ endpoint: `https://push.example/new${subscribed.length > 1 ? subscribed.length : ''}` });
        },
      },
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim,
      matchAll: () => Promise.resolve(clients),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve(null);
      },
    },
  };
  new Function('self', source)(self);
  // Fires an event and waits for what it handed to waitUntil.
  async function fire(type: string, event: Record<string, unknown>) {
    const waits: Promise<unknown>[] = [];
    listeners.get(type)?.({ ...event, waitUntil: (promise: Promise<unknown>) => waits.push(promise) });
    await Promise.all(waits);
    return waits.length;
  }
  const push = (data: { json: () => unknown } | null) => fire('push', { data });
  const click = (url: string | undefined) => {
    const close = vi.fn();
    return fire('notificationclick', { notification: { close, data: url === undefined ? undefined : { url } } }).then(() => close);
  };
  return { listeners, shown, opened, subscribed, marked, fire, push, click };
}

describe('public/sw.js', () => {
  it('listens for activation, push, a tap and a rotated subscription, and for nothing else: no fetch handler, so it never touches a page load', () => {
    expect([...worker().listeners.keys()].sort()).toEqual(['activate', 'notificationclick', 'push', 'pushsubscriptionchange']);
    expect(source).not.toMatch(/['"]fetch['"]/);
  });

  describe('when the push service rotates the endpoint', () => {
    const KEY = new Uint8Array([4, 1, 2, 3]).buffer;    const rotated = { oldSubscription: { endpoint: 'https://push.example/old', options: { applicationServerKey: KEY } } };

    it('subscribes again with the old subscription\'s key and leaves a marker of the old and the new endpoint in a cache of its own', async () => {
      const w = worker();
      expect(await w.fire('pushsubscriptionchange', rotated)).toBe(1);
      expect(w.subscribed).toEqual([{ userVisibleOnly: true, applicationServerKey: KEY }]);
      expect([...w.marked.values()].map((text) => JSON.parse(text))).toEqual([{ old: 'https://push.example/old', new: 'https://push.example/new' }]);
      expect([...w.marked.keys()]).toEqual(['nidus-push-rotation /push-rotation']);
    });

    it('chains a second rotation before the page has healed the first: the marker keeps the first old endpoint', async () => {
      const w = worker();
      await w.fire('pushsubscriptionchange', rotated);
      await w.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push.example/new', options: { applicationServerKey: KEY } } });
      expect([...w.marked.values()].map((text) => JSON.parse(text))).toEqual([{ old: 'https://push.example/old', new: 'https://push.example/new2' }]);
    });

    it('starts a fresh marker when the earlier one is for an unrelated endpoint', async () => {
      const w = worker();
      await w.fire('pushsubscriptionchange', rotated);
      await w.fire('pushsubscriptionchange', { oldSubscription: { endpoint: 'https://push.example/elsewhere', options: { applicationServerKey: KEY } } });
      expect([...w.marked.values()].map((text) => JSON.parse(text))).toEqual([{ old: 'https://push.example/elsewhere', new: 'https://push.example/new2' }]);
    });

    it.each([
      ['no old subscription', {}],
      ['an old subscription with no key', { oldSubscription: { endpoint: 'https://push.example/old', options: {} } }],
    ])('does nothing for %s', async (_name, event) => {
      const w = worker();
      await w.fire('pushsubscriptionchange', event);
      expect(w.subscribed).toEqual([]);
      expect(w.marked.size).toBe(0);
    });
  });

  it('takes over the open pages when it activates', async () => {
    claim.mockClear();
    expect(await worker().fire('activate', {})).toBe(1);
    expect(claim).toHaveBeenCalledOnce();
  });

  it('shows the notification a push carries, with its tag, url and icon', async () => {
    const w = worker();
    expect(await w.push({ json: () => ({ title: 'Swim', body: 'At 8:30 AM, in 15 minutes', url: '/day?date=2026-10-07', tag: 'event:1' }) })).toBe(1);
    expect(w.shown).toEqual([{ title: 'Swim', options: { body: 'At 8:30 AM, in 15 minutes', tag: 'event:1', renotify: true, icon: '/icons/icon-192.png', data: { url: '/day?date=2026-10-07' } } }]);
  });

  it.each([
    ['no data', null],
    ['text that is not JSON', { json: () => { throw new SyntaxError('Unexpected token'); } }],
    ['JSON that is null', { json: () => null }],
    ['JSON that is a number', { json: () => 7 }],
    ['JSON of the wrong shapes', { json: () => ({ title: 5, body: {}, url: false, tag: [] }) }],
  ])('still shows one for %s, as "Nidus" opening the front door, since an iPhone revokes a subscription that is sent a push with none', async (_name, data) => {
    const w = worker();
    expect(await w.push(data)).toBe(1);
    expect(w.shown).toEqual([{ title: 'Nidus', options: { icon: '/icons/icon-192.png', data: { url: '/' } } }]);
  });

  it('closes the notification on a tap and opens a window at its url when none is open', async () => {
    const w = worker();
    const close = await w.click('/lists');
    expect(close).toHaveBeenCalledOnce();
    expect(w.opened).toEqual([`${SCOPE}lists`]);
  });

  it('focuses a window that is open and navigates it to the url', async () => {
    const open: FakeClient = { url: `${SCOPE}`, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockResolvedValue(null) };
    const w = worker([open]);
    await w.click('/routines');
    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.navigate).toHaveBeenCalledWith(`${SCOPE}routines`);
    expect(w.opened).toEqual([]);
  });

  it('opens the url in a window of its own when the open one cannot navigate, or fails to', async () => {
    const cannot: FakeClient = { url: SCOPE, focus: vi.fn().mockResolvedValue(undefined) };
    const w = worker([cannot]);
    await w.click('/lists');
    expect(w.opened).toEqual([`${SCOPE}lists`]);

    const fails: FakeClient = { url: SCOPE, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn().mockRejectedValue(new Error('refused')) };
    const v = worker([fails]);
    await v.click('/meals');
    expect(fails.navigate).toHaveBeenCalledWith(`${SCOPE}meals`);
    expect(v.opened).toEqual([`${SCOPE}meals`]);
  });

  it('only focuses a window that is already at the url', async () => {
    const open: FakeClient = { url: `${SCOPE}lists`, focus: vi.fn().mockResolvedValue(undefined), navigate: vi.fn() };
    await worker([open]).click('/lists');
    expect(open.focus).toHaveBeenCalledOnce();
    expect(open.navigate).not.toHaveBeenCalled();
  });

  it('opens the front door for a url outside Nidus, or none', async () => {
    for (const url of ['https://elsewhere.example/phish', 'http://[bad', undefined]) {
      const w = worker();
      await w.click(url);
      expect(w.opened).toEqual([SCOPE]);
    }
  });
});
