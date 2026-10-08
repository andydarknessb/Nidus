-- Calendar Account facts, not sentences (issue #155, spec 0008). The sync used to write two
-- family-readable sentences into calendar_accounts.last_error and the client compared against
-- copies of them. Now the row says what happened as facts: `truncated` says some repeating events
-- of an iPhone (iCloud) calendar were cut short by the work limits, and `last_error` is for logs
-- only, never shown and never compared. A calendar the run did not reach is left untouched, so
-- nothing writes "was not read this time" any more.
--
-- Additive: RLS and every existing grant stand; `truncated` joins the readable columns exactly as
-- `provider` did, so a client reads it as it reads `last_error` and `status`. Only the service role
-- (the calendar-sync function) writes it.

alter table public.calendar_accounts add column truncated boolean not null default false;

grant select (truncated) on public.calendar_accounts to authenticated;

-- The sentences the old sync stored. The first became the flag; the second is simply gone.
update public.calendar_accounts
set truncated = true
where last_error = 'Some repeating events in this calendar cannot be shown in full.';

update public.calendar_accounts
set last_error = null
where last_error in (
  'Some repeating events in this calendar cannot be shown in full.',
  'This calendar was not read this time; it will be tried again.'
);

comment on column public.calendar_accounts.truncated is 'icloud: true when the last read of the feed left some repeating events cut short by the work limits. Set and cleared by the sync with each successful read (and kept on a 304). Always false for Google.';
comment on column public.calendar_accounts.last_error is 'Why the last sync failed, for the logs only: never shown to the family and never compared by code. Null after a successful sync.';
