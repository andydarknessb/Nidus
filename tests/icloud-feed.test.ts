import { describe, expect, it } from 'vitest';
import { feedCalendarName, fetchFeed, normaliseFeedUrl } from '../supabase/functions/_shared/feed';
import { fakeICloud } from './support/icloud';

const ICS = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Family\r\nEND:VCALENDAR\r\n';
const LINK = 'https://p12-caldav.icloud.com/published/2/abc123';

describe('normaliseFeedUrl', () => {
  it('accepts an https link on icloud.com or a host ending .icloud.com', () => {
    expect(normaliseFeedUrl(LINK)).toBe(LINK);
    expect(normaliseFeedUrl('https://icloud.com/published/2/abc')).toBe('https://icloud.com/published/2/abc');
    expect(normaliseFeedUrl('https://P12-CalDAV.iCloud.com/published/2/abc123')).toBe(LINK);
  });

  it('rewrites webcal to https and trims the text', () => {
    expect(normaliseFeedUrl('  webcal://p12-caldav.icloud.com/published/2/abc123\n')).toBe(LINK);
    expect(normaliseFeedUrl('WEBCAL://p12-caldav.icloud.com/published/2/abc123')).toBe(LINK);
  });

  it.each([
    ['a bare question mark', `${LINK}?`],
    ['a query', `${LINK}?x=1`],
    ['a fragment', `${LINK}#top`],
    ['an escape of an unreserved character', 'https://p12-caldav.icloud.com/published/2/abc%31%32%33'],
    ['an escape in lower case', 'https://p12-caldav.icloud.com/published/2/%61bc123'],
    ['webcal, a query and an escape together', 'webcal://P12-caldav.iCloud.com/published/2/abc%31%32%33?x=1#y'],
  ])('gives one spelling to a link with %s, so it is one feed_key', (_name, text) => {
    expect(normaliseFeedUrl(text)).toBe(LINK);
  });

  it('keeps an escape of a reserved character, in one case', () => {
    expect(normaliseFeedUrl('https://p12-caldav.icloud.com/published/2/a%2fb')).toBe('https://p12-caldav.icloud.com/published/2/a%2Fb');
  });

  it.each([
    ['another host', 'https://example.com/published/2/abc'],
    ['a look-alike suffix', 'https://icloud.com.evil.example/published/2/abc'],
    ['a look-alike prefix', 'https://evilicloud.com/published/2/abc'],
    ['a trailing dot', 'https://icloud.com./published/2/abc'],
    ['an IPv4 address', 'https://17.253.144.10/published/2/abc'],
    ['an IPv6 address', 'https://[2620:149:af0::10]/published/2/abc'],
    ['a port', 'https://p12-caldav.icloud.com:8443/published/2/abc'],
    ['the default port spelled out', 'https://p12-caldav.icloud.com:443/published/2/abc'],
    ['a port after extra slashes', 'https:///p12-caldav.icloud.com:8443/x'],
    ['the default port after extra slashes', 'https:///p12-caldav.icloud.com:443/x'],
    ['a port after backslashes', 'https:\\\\p12-caldav.icloud.com:8443/x'],
    ['a port with no slashes after the scheme', 'https:p12-caldav.icloud.com:8443/x'],
    ['an empty port', 'https://p12-caldav.icloud.com:/published/2/abc'],
    ['a port on a webcal link', 'webcal://p12-caldav.icloud.com:8443/published/2/abc'],
    ['a port on the bare domain', 'https://icloud.com:444/published/2/abc'],
    ['a link over 2048 characters', `https://p12-caldav.icloud.com/${'a'.repeat(2048)}`],
    ['user info', 'https://user:pass@p12-caldav.icloud.com/published/2/abc'],
    ['user info that hides the real host', 'https://p12-caldav.icloud.com@evil.example/published/2/abc'],
    ['a backslash that hides the real host', 'https://evil.example\\@p12-caldav.icloud.com/published/2/abc'],
    ['http', 'http://p12-caldav.icloud.com/published/2/abc'],
    ['file', 'file:///etc/passwd'],
    ['javascript', 'javascript:alert(1)'],
    ['ftp', 'ftp://p12-caldav.icloud.com/published/2/abc'],
    ['no path', 'https://p12-caldav.icloud.com'],
    ['only a slash', 'https://p12-caldav.icloud.com/'],
    ['no scheme', 'p12-caldav.icloud.com/published/2/abc'],
    ['whitespace inside', 'https://p12-caldav.icloud.com/pub lished'],
    ['empty text', ''],
  ])('refuses %s', (_name, text) => {
    expect(normaliseFeedUrl(text)).toBeNull();
  });
});

describe('feedCalendarName', () => {
  it('reads X-WR-CALNAME, with its parameters, escapes and folding', () => {
    expect(feedCalendarName(ICS)).toBe('Family');
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nX-WR-CALNAME;VALUE=TEXT:Mum\\, Dad \\& us\r\nEND:VCALENDAR')).toBe('Mum, Dad & us');
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Long na\r\n me here\r\nEND:VCALENDAR')).toBe('Long name here');
  });

  it('says "iPhone calendar" when the feed has no name or a blank one', () => {
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nEND:VCALENDAR')).toBe('iPhone calendar');
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nX-WR-CALNAME:   \r\nEND:VCALENDAR')).toBe('iPhone calendar');
  });

  it('cuts a very long name to what a Mirrored Calendar can hold', () => {
    expect(feedCalendarName(`BEGIN:VCALENDAR\r\nX-WR-CALNAME:${'a'.repeat(600)}\r\nEND:VCALENDAR`)).toHaveLength(500);
  });

  it('cuts by characters, never through the middle of one', () => {
    const name = feedCalendarName(`BEGIN:VCALENDAR\r\nX-WR-CALNAME:${'a'.repeat(499)}\u{1F600}\u{1F600}\r\nEND:VCALENDAR`);
    expect(Array.from(name)).toHaveLength(500);
    expect(name).toBe(`${'a'.repeat(499)}\u{1F600}`);
  });

  it('drops control characters, so the name is one a database will store', () => {
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nX-WR-CALNAME:Fam\u0000ily\u0007\r\nEND:VCALENDAR')).toBe('Family');
    expect(feedCalendarName('BEGIN:VCALENDAR\r\nX-WR-CALNAME:\u0000\u0001\r\nEND:VCALENDAR')).toBe('iPhone calendar');
  });
});

const fakeFeed = fakeICloud;

const redirect = (to: string, status = 302) => new Response(null, { status, headers: { Location: to } });
const none = { etag: null, lastModified: null };

describe('fetchFeed', () => {
  it('returns the calendar text with its ETag and Last-Modified, asking without redirect-following', async () => {
    const feed = fakeFeed({ [LINK]: new Response(ICS, { headers: { ETag: '"v1"', 'Last-Modified': 'Tue, 06 Oct 2026 10:00:00 GMT' } }) });
    expect(await fetchFeed(LINK, none, feed.fetch)).toEqual({
      kind: 'calendar',
      text: ICS,
      etag: '"v1"',
      lastModified: 'Tue, 06 Oct 2026 10:00:00 GMT',
    });
    expect(feed.calls).toHaveLength(1);
    expect(feed.calls[0]!.init.redirect).toBe('manual');
    expect(feed.calls[0]!.init.signal).toBeInstanceOf(AbortSignal);
  });

  it('answers null for a validator the server did not send', async () => {
    const feed = fakeFeed({ [LINK]: new Response(ICS) });
    expect(await fetchFeed(LINK, none, feed.fetch)).toMatchObject({ kind: 'calendar', etag: null, lastModified: null });
  });

  it('sends the stored validators and takes a 304 as unchanged', async () => {
    const feed = fakeFeed({ [LINK]: new Response(null, { status: 304 }) });
    const result = await fetchFeed(LINK, { etag: '"v1"', lastModified: 'Tue, 06 Oct 2026 10:00:00 GMT' }, feed.fetch);
    expect(result).toEqual({ kind: 'unchanged' });
    const headers = new Headers(feed.calls[0]!.init.headers);
    expect(headers.get('If-None-Match')).toBe('"v1"');
    expect(headers.get('If-Modified-Since')).toBe('Tue, 06 Oct 2026 10:00:00 GMT');
  });

  it('sends no conditional headers when it has no validators', async () => {
    const feed = fakeFeed({ [LINK]: new Response(ICS) });
    await fetchFeed(LINK, none, feed.fetch);
    const headers = new Headers(feed.calls[0]!.init.headers);
    expect(headers.has('If-None-Match')).toBe(false);
    expect(headers.has('If-Modified-Since')).toBe(false);
  });

  it.each([401, 403, 404, 410])('takes a %i as gone', async (status) => {
    const feed = fakeFeed({ [LINK]: new Response('no', { status }) });
    expect(await fetchFeed(LINK, none, feed.fetch)).toEqual({ kind: 'gone', status });
  });

  it('takes any other failure as an error, without the link in the message', async () => {
    const feed = fakeFeed({ [LINK]: new Response('boom', { status: 503 }) });
    const result = await fetchFeed(LINK, none, feed.fetch);
    expect(result.kind).toBe('error');
    expect(JSON.stringify(result)).not.toContain('abc123');
  });

  it('takes a network failure as an error', async () => {
    const result = await fetchFeed(LINK, none, (() => Promise.reject(new TypeError('network down'))) as typeof fetch);
    expect(result).toMatchObject({ kind: 'error' });
  });

  it('takes a body that is not a calendar as an error', async () => {
    const feed = fakeFeed({ [LINK]: new Response('<html>sign in</html>') });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('error');
  });

  it('refuses a link it would not have accepted, without asking the network', async () => {
    const feed = fakeFeed({});
    expect((await fetchFeed('https://evil.example/feed.ics', none, feed.fetch)).kind).toBe('error');
    expect(feed.calls).toHaveLength(0);
  });

  it('follows a redirect on iCloud by hand, checking each hop, and reads the last', async () => {
    const second = 'https://p99-caldav.icloud.com/published/2/moved';
    const feed = fakeFeed({ [LINK]: redirect(second, 301), [second]: new Response(ICS) });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('calendar');
    expect(feed.calls.map((call) => call.url)).toEqual([LINK, second]);
  });

  it('follows a relative redirect and a webcal one', async () => {
    const feed = fakeFeed({
      [LINK]: redirect('/published/2/next'),
      'https://p12-caldav.icloud.com/published/2/next': redirect('webcal://p13-caldav.icloud.com/published/2/last'),
      'https://p13-caldav.icloud.com/published/2/last': new Response(ICS),
    });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('calendar');
  });

  it.each([
    ['another host', 'https://evil.example/feed.ics'],
    ['a look-alike host', 'https://icloud.com.evil.example/feed.ics'],
    ['http', 'http://p12-caldav.icloud.com/published/2/abc123'],
    ['an IP address', 'https://10.0.0.1/feed.ics'],
    ['a port', 'https://p12-caldav.icloud.com:8443/feed.ics'],
  ])('refuses a redirect to %s, and never asks it', async (_name, target) => {
    const feed = fakeFeed({ [LINK]: redirect(target), [target]: new Response(ICS) });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('error');
    expect(feed.calls.map((call) => call.url)).toEqual([LINK]);
  });

  it('follows three redirects and refuses a fourth', async () => {
    const hop = (n: number) => `https://p${n}-caldav.icloud.com/published/2/abc`;
    const three = fakeFeed({ [LINK]: redirect(hop(1)), [hop(1)]: redirect(hop(2)), [hop(2)]: redirect(hop(3)), [hop(3)]: new Response(ICS) });
    expect((await fetchFeed(LINK, none, three.fetch)).kind).toBe('calendar');

    const four = fakeFeed({
      [LINK]: redirect(hop(1)),
      [hop(1)]: redirect(hop(2)),
      [hop(2)]: redirect(hop(3)),
      [hop(3)]: redirect(hop(4)),
      [hop(4)]: new Response(ICS),
    });
    expect((await fetchFeed(LINK, none, four.fetch)).kind).toBe('error');
    expect(four.calls.map((call) => call.url)).not.toContain(hop(4));
  });

  it('refuses a redirect with nowhere to go', async () => {
    const feed = fakeFeed({ [LINK]: new Response(null, { status: 302 }) });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('error');
  });

  it('refuses a body over 2 MB, announced or not', async () => {
    const big = new TextEncoder().encode(`BEGIN:VCALENDAR\r\n${'x'.repeat(2 * 1024 * 1024)}\r\nEND:VCALENDAR`);
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(big);
        controller.close();
      },
    });
    const unannounced = fakeFeed({ [LINK]: new Response(stream) });
    expect((await fetchFeed(LINK, none, unannounced.fetch)).kind).toBe('error');

    const announced = fakeFeed({ [LINK]: new Response('BEGIN:VCALENDAR', { headers: { 'Content-Length': String(3 * 1024 * 1024) } }) });
    expect((await fetchFeed(LINK, none, announced.fetch)).kind).toBe('error');
  });

  it('reads a body just under 2 MB', async () => {
    const text = `BEGIN:VCALENDAR\r\n${'x'.repeat(2 * 1024 * 1024 - 100)}\r\nEND:VCALENDAR`;
    const feed = fakeFeed({ [LINK]: new Response(text) });
    expect((await fetchFeed(LINK, none, feed.fetch)).kind).toBe('calendar');
  });

  it('gives up on a server that never answers', async () => {
    // The fetch ends only when the signal aborts it.
    const hang = ((_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => init.signal!.addEventListener('abort', () => reject(init.signal!.reason)))) as unknown as typeof fetch;
    expect(await fetchFeed(LINK, none, hang, { timeoutMs: 30 })).toEqual({ kind: 'error', message: 'timed out' });
  });

  it('gives up on a body whose time ran out before it began to be read', async () => {
    const late = (async () => {
      await new Promise((resolve) => setTimeout(resolve, 40));
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'));
          },
        }),
      );
    }) as typeof fetch;
    expect(await fetchFeed(LINK, none, late, { timeoutMs: 5 })).toEqual({ kind: 'error', message: 'timed out' });
  });

  it('gives up on a body that stalls too', async () => {
    const stalled = (async () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('BEGIN:VCALENDAR\r\n'));
          },
        }),
      )) as typeof fetch;
    expect(await fetchFeed(LINK, none, stalled, { timeoutMs: 30 })).toEqual({ kind: 'error', message: 'timed out' });
  });
});
