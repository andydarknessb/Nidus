-- The sent mark (spec 0019, ticket 1): an item a phone sends to Target is waiting until Got it crosses it off, or leaves it on the
-- list when it did not come. sent_at is null for an item that is not waiting. Both functions are security invoker, so the existing
-- row-level security policies on list_items (any principal of the Household) stay the one authority on who may move a row.

alter table public.list_items add column sent_at timestamptz;

-- A Device may now also set an item's sent mark; nothing else on the row moves.
grant update (sent_at) on public.list_items to authenticated;

-- Marks every item of the list that is not crossed off as sent now, in one statement, and says how many.
create or replace function public.mark_list_sent(p_list_id uuid)
returns integer
language sql
security invoker
set search_path = ''
as $$
  with marked as (
    update public.list_items
    set sent_at = now()
    where list_id = p_list_id and crossed_at is null
    returning id
  )
  select count(*)::integer from marked;
$$;

-- Got it: in one statement, crosses off the waiting items named in p_came and stops every other waiting item waiting. Ids that are not
-- waiting items of the list are not touched, and says how many were crossed off.
create or replace function public.got_list_items(p_list_id uuid, p_came uuid[])
returns integer
language sql
security invoker
set search_path = ''
as $$
  with gotten as (
    update public.list_items
    set crossed_at = case when id = any(p_came) then now() else crossed_at end,
        sent_at = case when id = any(p_came) then sent_at else null end
    where list_id = p_list_id and sent_at is not null and crossed_at is null
    returning id = any(p_came) as came
  )
  select count(*) filter (where came)::integer from gotten;
$$;

-- Supabase grants execute on new functions to anon directly; revoking from public does not remove it.
revoke all on function public.mark_list_sent(uuid) from public;
revoke all on function public.got_list_items(uuid, uuid[]) from public;
revoke execute on function public.mark_list_sent(uuid) from anon;
revoke execute on function public.got_list_items(uuid, uuid[]) from anon;
grant execute on function public.mark_list_sent(uuid) to authenticated;
grant execute on function public.got_list_items(uuid, uuid[]) to authenticated;
