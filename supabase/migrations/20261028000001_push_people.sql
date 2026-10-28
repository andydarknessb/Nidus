-- Whose events a phone gets (docs/specs/0018-whose-events-a-phone-gets.md, issue #287). A Push
-- Subscription now holds the people whose events its phone wants; empty is Everyone, as before.
-- A phone that chose people gets reminders for, and a morning summary of, only the events for one
-- of them and the events for everyone (push-notify decides; this is the data).
--
-- No foreign key: an array cannot carry one. The sender keeps only the ids of the Household's
-- current Profiles, so a removed person, or an id from anywhere else, is ignored. A foreign id
-- exposes nothing, since the sender only ever reads the phone's own Household.
alter table public.push_subscriptions
  add column profile_ids uuid[] not null default '{}' check (cardinality(profile_ids) <= 100);

comment on column public.push_subscriptions.profile_ids is 'The Profiles whose events this phone gets; empty is Everyone (docs/specs/0018). Not a foreign key: the sender keeps only the Household''s current Profiles.';

-- The column joins the five preferences a client reads and changes. The policies stay as they are
-- (a Household Account''s own rows only); save_push_subscription is unchanged, so a phone moved to
-- another Household Account gets a fresh row on '{}' and the same account subscribing again keeps its people.
grant select (profile_ids) on public.push_subscriptions to authenticated;
grant update (profile_ids) on public.push_subscriptions to authenticated;
