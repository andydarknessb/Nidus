# Google sign-in for local development

The Household Account signs in with Google. Sign-in is identity only: Supabase Auth asks Google for `openid`, `email` and `profile`, and no calendar scope (ADR 0002). Calendar access is a separate consent, added with the Calendar Account ticket.

## Create the OAuth client

1. In the [Google Cloud console](https://console.cloud.google.com/), create or pick a project.
2. APIs & Services, OAuth consent screen: choose External, fill in the app name and your email, and add yourself as a test user. Leave the scopes at the defaults.
3. APIs & Services, Credentials, Create credentials, OAuth client ID, type Web application.
4. Authorized JavaScript origins: `http://127.0.0.1:5173` and `http://localhost:5173`.
5. Authorized redirect URI: `http://127.0.0.1:54321/auth/v1/callback` (the local Supabase Auth callback).
6. Copy the client ID and secret.

## Wire it to the local stack

1. Copy `supabase/.env.example` to `supabase/.env` and paste the client ID and secret. The file is gitignored.
2. Copy `.env.example` to `.env.local` and set `VITE_SUPABASE_ANON_KEY` from `pnpm supabase status -o env` (`ANON_KEY`).
3. `pnpm db:stop`, then `pnpm db:start` so Auth picks up the secrets.
4. `pnpm dev`, open `http://127.0.0.1:5173` (use this host, not another, so it matches the redirect allow-list) and sign in.

The provider block is in `supabase/config.toml` under `[auth.external.google]`.
