// The one fake iCloud, for every test that reads an iPhone calendar's public link (the feed fetch, the
// calendar-connect add route, the calendar sync). The feed's server is the only thing faked, injected as
// `fetch`: a map from link to what the server says to it, recording each request.
//
// A reply is a Response (served as it is, cloned per request), a function that makes one, a feed with its
// validators (a real server answers 304 to a validator it issued), an HTTP status, or 'unreachable'.
// A link it does not know is a 404. The replies can be changed between requests with `set`.
export type FeedReply = Response | (() => Response | Promise<Response>) | { text: string; etag?: string; lastModified?: string } | number | 'unreachable';

export type FeedCall = { url: string; headers: Headers; init: RequestInit };

export function fakeICloud(initial: Record<string, FeedReply> | Map<string, FeedReply> = {}) {
  // A Map passed in is the server's own, so a test can change what it says by setting a link in it.
  const replies = initial instanceof Map ? initial : new Map<string, FeedReply>(Object.entries(initial));
  const calls: FeedCall[] = [];
  const fake = (async (input: string | URL | Request, init: RequestInit = {}): Promise<Response> => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init.headers), init });
    const reply = replies.get(url);
    if (reply === undefined) return new Response('missing', { status: 404 });
    if (reply === 'unreachable') throw new TypeError(`fetch failed for ${url}`);
    if (typeof reply === 'number') return new Response('', { status: reply });
    if (typeof reply === 'function') return reply();
    if (reply instanceof Response) return reply.clone();
    const headers = new Headers();
    if (reply.etag) headers.set('ETag', reply.etag);
    if (reply.lastModified) headers.set('Last-Modified', reply.lastModified);
    const sent = new Headers(init.headers);
    if ((reply.etag && sent.get('If-None-Match') === reply.etag) || (!reply.etag && reply.lastModified && sent.get('If-Modified-Since') === reply.lastModified)) {
      return new Response(null, { status: 304 });
    }
    return new Response(reply.text, { headers });
  }) as typeof fetch;
  return { fetch: fake, calls, set: (link: string, reply: FeedReply) => replies.set(link, reply) };
}
