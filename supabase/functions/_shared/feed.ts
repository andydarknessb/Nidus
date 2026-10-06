// An iPhone (iCloud) calendar's public link: which links are accepted, and how a feed is read
// (docs/specs/0005-iphone-calendars.md, ADR 0003). Shared by calendar-connect (adding a link)
// and calendar-sync (reading it every five minutes). No Deno globals and `fetch` is injected, so
// the tests drive it under Node with a fake feed server.
//
// The link is a secret and the server it names must only ever be Apple's: every address this
// fetches, the first and each redirect, passes normaliseFeedUrl. Nothing here puts the link in
// a message it returns.

const MAX_REDIRECTS = 3;
const TIMEOUT_MS = 15_000;
// 2 MB: a feed expands to roughly thirty times its size in heap, and an Edge Function has little.
const MAX_BYTES = 2 * 1024 * 1024;
const DEFAULT_NAME = 'iPhone calendar';
const MAX_NAME = 500;
const MAX_LINK = 2048;

// The link in its one spelling (https, host in lower case, no query or fragment, escapes of
// unreserved characters decoded), or null when it is not an iPhone calendar link: only https (or
// webcal, which is rewritten) on icloud.com or a host ending .icloud.com, with a path, and no
// port, user info or IP address. One link is one spelling, so it is one feed_key.
export function normaliseFeedUrl(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.length > MAX_LINK || /[\s\p{Cc}]/u.test(trimmed)) return null;
  const rewritten = trimmed.replace(/^webcal:\/\//i, 'https://');
  // The text before the first slash is the authority however the URL parser would read it (it
  // skips any run of slashes and backslashes after the scheme), so a ':' (port, IPv6) or '@'
  // (user info) there is refused outright, whatever the port, even the default one.
  const authority = /^https:[/\\]*([^/\\?#]*)/i.exec(rewritten)?.[1];
  if (authority === undefined || /[:@]/.test(authority)) return null;
  let url: URL;
  try {
    url = new URL(rewritten);
  } catch {
    return null;
  }
  const host = url.hostname;
  const onIcloud = host === 'icloud.com' || host.endsWith('.icloud.com');
  if (url.protocol !== 'https:' || !onIcloud || url.username || url.password || url.port || url.pathname === '/') return null;
  url.hash = '';
  url.search = '';
  url.pathname = url.pathname.replace(/%([0-9a-f]{2})/gi, (escape, hex: string) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return /[A-Za-z0-9\-._~]/.test(char) ? char : escape.toUpperCase();
  });
  return url.toString();
}

export type FeedResult =
  | { kind: 'unchanged' }
  | { kind: 'gone'; status: number }
  | { kind: 'calendar'; text: string; etag: string | null; lastModified: string | null }
  | { kind: 'error'; message: string };

const error = (message: string): FeedResult => ({ kind: 'error', message });

// Reads a body up to MAX_BYTES, then gives up: nothing past the cap is ever held.
async function readCapped(response: Response, signal: AbortSignal): Promise<string | null> {
  const announced = Number(response.headers.get('Content-Length'));
  if (announced > MAX_BYTES) return null;
  const reader = response.body?.getReader();
  if (!reader) return '';
  // A body that stalls is cut off with the rest of the read: cancelling ends a pending read. The
  // listener goes on before any read, and a signal that has already fired is handled here.
  const stop = () => void reader.cancel().catch(() => undefined);
  signal.addEventListener('abort', stop, { once: true });
  if (signal.aborted) {
    stop();
    signal.throwIfAborted();
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

// Reads one feed. Redirects are followed by hand (at most three), each target held to the same
// rule as the link; the whole read, body included, is cut off after 15 seconds. `validators` are
// what the last read stored, sent so an unchanged feed answers 304. `limits.timeoutMs` is for tests.
export async function fetchFeed(
  url: string,
  validators: { etag: string | null; lastModified: string | null },
  fetchImpl: typeof fetch,
  limits: { timeoutMs?: number } = {},
): Promise<FeedResult> {
  const signal = AbortSignal.timeout(limits.timeoutMs ?? TIMEOUT_MS);
  const headers: Record<string, string> = { Accept: 'text/calendar, text/plain;q=0.5' };
  if (validators.etag) headers['If-None-Match'] = validators.etag;
  if (validators.lastModified) headers['If-Modified-Since'] = validators.lastModified;

  let current = normaliseFeedUrl(url);
  try {
    for (let redirects = 0; ; redirects++) {
      if (current === null) return error('not an iPhone calendar link');
      const response = await fetchImpl(current, { headers, redirect: 'manual', signal });
      if (response.status >= 300 && response.status < 400 && response.status !== 304) {
        const location = response.headers.get('Location');
        await response.body?.cancel().catch(() => undefined);
        if (!location) return error('redirect with nowhere to go');
        if (redirects >= MAX_REDIRECTS) return error('too many redirects');
        current = normaliseFeedUrl(new URL(location, current).toString());
        continue;
      }
      if (response.status === 304) return { kind: 'unchanged' };
      if ([401, 403, 404, 410].includes(response.status)) return { kind: 'gone', status: response.status };
      if (!response.ok) return error(`feed answered ${response.status}`);
      const text = await readCapped(response, signal);
      if (text === null) return error('feed is too large');
      if (!/^\s*BEGIN:VCALENDAR/i.test(text)) return error('not a calendar');
      return { kind: 'calendar', text, etag: response.headers.get('ETag'), lastModified: response.headers.get('Last-Modified') };
    }
  } catch {
    // A message that names neither the link nor the server's own words.
    return error(signal.aborted ? 'timed out' : 'could not reach the feed');
  }
}

// The calendar's name: X-WR-CALNAME (its parameters, folding and escapes read as iCalendar says),
// else "iPhone calendar". Cut to what a Mirrored Calendar's name holds.
export function feedCalendarName(text: string): string {
  const unfolded = text.replace(/\r?\n[ \t]/g, '');
  const value = /^X-WR-CALNAME(?:;[^:\r\n]*)?:(.*)$/im.exec(unfolded)?.[1];
  const name = (value ?? '')
    .replace(/\\(.)/g, (_all, char: string) => (char === 'n' || char === 'N' ? ' ' : char))
    .replace(/\p{Cc}/gu, '')
    .trim();
  // By code points, so a character outside the Basic Multilingual Plane is never cut in half.
  return Array.from(name || DEFAULT_NAME).slice(0, MAX_NAME).join('');
}
