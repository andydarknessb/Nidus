// A run that syncs a Google account and an iPhone calendar makes both providers' requests through one
// injected `fetch`: this sends each to its fake (tests/support/google.ts, tests/support/icloud.ts) by
// host, and keeps one log of all of them, in order.
export function mixed(google: { fetch: typeof fetch }, icloud: { fetch: typeof fetch }) {
  const calls: { url: string; headers: Headers }[] = [];
  const fake = ((input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, headers: new Headers(init?.headers) });
    const toGoogle = /(^|\.)(google\.com|googleapis\.com)$/.test(new URL(url).hostname);
    return (toGoogle ? google : icloud).fetch(input, init);
  }) as typeof fetch;
  return { fetch: fake, calls };
}
