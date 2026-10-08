// Google's token endpoint, as calendar-sync (a refresh token for an access token) and
// calendar-connect (an authorization code for both) use it. No Deno globals and `fetch` is injected,
// so the tests drive it under Node with a fake Google.
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';

export type GoogleClient = { clientId: string; clientSecret: string };

function requestTokens(fetchFn: typeof fetch, client: GoogleClient, grant: Record<string, string>): Promise<Response> {
  return fetchFn(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: client.clientId, client_secret: client.clientSecret, ...grant }).toString(),
  });
}

// An access token for a stored refresh token, or why not. `revoked` is Google saying the refresh token is
// revoked, expired or replaced (invalid_grant): only the parent reconnecting the account fixes that, so
// retrying every five minutes would be noise.
export async function mintAccessToken(fetchFn: typeof fetch, client: GoogleClient, refreshToken: string): Promise<{ token: string } | { revoked: boolean; message: string }> {
  const response = await requestTokens(fetchFn, client, { refresh_token: refreshToken, grant_type: 'refresh_token' });
  if (response.ok) {
    const body = (await response.json().catch(() => ({}))) as { access_token?: string };
    if (body.access_token) return { token: body.access_token };
    return { revoked: false, message: 'Google sent no access token' };
  }
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (body.error === 'invalid_grant') return { revoked: true, message: 'Google no longer accepts this account. Reconnect it in settings.' };
  return { revoked: false, message: `Google token request failed (${response.status})` };
}

// The tokens Google gives for the code its consent screen returned, or null when it refuses the code.
export async function exchangeCode(
  fetchFn: typeof fetch,
  client: GoogleClient,
  code: string,
  redirectUri: string,
): Promise<{ access_token?: string; refresh_token?: string } | null> {
  const response = await requestTokens(fetchFn, client, { code, redirect_uri: redirectUri, grant_type: 'authorization_code' });
  if (!response.ok) return null;
  return (await response.json()) as { access_token?: string; refresh_token?: string };
}
