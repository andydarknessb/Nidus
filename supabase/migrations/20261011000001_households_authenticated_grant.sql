-- `authenticated` kept the default grant on `households` (insert, delete, truncate and the
-- rest), refused only by row-level security. The table has two policies, select and update;
-- the one insert runs inside `ensure_household`, which is `security definer`, and no
-- principal deletes a Household through the API. A paired Device, a Household Account and an
-- unpaired anonymous session all run as `authenticated`, so the grant is the one place to
-- say so: select and update only, table-level update to match the policy (no column list).
-- Defence in depth; the policies stay as they are.
revoke all on public.households from authenticated;
grant select, update on public.households to authenticated;
