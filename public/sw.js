// Nidus's service worker, for push only: it caches no pages (its one cache entry is the rotation marker below) and has no fetch handler, so it never touches a page load.
// An iPhone revokes a subscription whose push shows no notification, so every push shows one, even a malformed one.

const ICON = '/icons/icon-192.png';

// A page opened before the worker was installed is taken over at once, so that a tap's focus and navigate reach it.
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try {
    const parsed = event.data ? event.data.json() : null;
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch (error) {
    // Not JSON: it still shows "Nidus".
  }
  const text = (value) => (typeof value === 'string' && value !== '' ? value : undefined);
  const options = { icon: ICON, data: { url: text(data.url) || '/' } };
  const body = text(data.body);
  if (body) options.body = body;
  const tag = text(data.tag);
  // A tag replaces the earlier notification of its kind, and renotify makes that replacement buzz; never renotify without a tag.
  if (tag) {
    options.tag = tag;
    options.renotify = true;
  }
  event.waitUntil(self.registration.showNotification(text(data.title) || 'Nidus', options));
});

// The push service rotated this phone's endpoint. The worker has no session to save the new one with, so it subscribes again with the
// same key and leaves the two endpoints in a cache of its own; the page saves the new one the next time it reads the phone's state
// (readPushState in src/lib/push.ts, which shares this cache name and key).
self.addEventListener('pushsubscriptionchange', (event) => {
  const key = event.oldSubscription && event.oldSubscription.options && event.oldSubscription.options.applicationServerKey;
  if (!key) return;
  event.waitUntil(
    self.registration.pushManager
      .subscribe({ userVisibleOnly: true, applicationServerKey: key })
      .then(async (subscription) => {
        const cache = await self.caches.open('nidus-push-rotation');
        // A second rotation before the page has healed the first keeps the first marker's old endpoint: that is the row to inherit from.
        const earlier = await cache.match('/push-rotation').then((hit) => (hit ? hit.json() : null), () => null);
        const old = earlier && earlier.new === event.oldSubscription.endpoint ? earlier.old : event.oldSubscription.endpoint;
        await cache.put('/push-rotation', new Response(JSON.stringify({ old, new: subscription.endpoint })));
      }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Only a place in Nidus: anything else opens its front door.
  const scope = self.registration.scope;
  let target = new URL('/', scope);
  try {
    const wanted = new URL((event.notification.data && event.notification.data.url) || '/', scope);
    if (wanted.origin === target.origin) target = wanted;
  } catch (error) {
    // A url that does not parse opens the front door.
  }
  const url = target.href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
      const open = windows.find((client) => 'focus' in client);
      if (!open) return self.clients.openWindow(url);
      await open.focus();
      if (open.url === url) return undefined;
      try {
        if (!('navigate' in open)) throw new Error('no navigate');
        await open.navigate(url);
      } catch (error) {
        // A window that cannot be sent there is not left on the wrong page: the url opens in a window of its own.
        return self.clients.openWindow(url);
      }
      return undefined;
    }),
  );
});
