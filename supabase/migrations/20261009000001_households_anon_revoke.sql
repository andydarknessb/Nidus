-- `households` was the one table without a table-level revoke: RLS is on and both
-- policies are `to authenticated`, but the default grants still let `anon` reach the
-- table, where it reads an empty list instead of being refused. A client with no session
-- has no business at this table, so refuse it at the grant (defence in depth; the
-- policies stay as they are). Authenticated principals keep their default grants.
revoke all on public.households from anon;
