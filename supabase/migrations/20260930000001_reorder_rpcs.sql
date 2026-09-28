-- Atomic reorders for Shared Lists (issue #25). The client used to send one
-- update per id, each its own request and transaction, so a dropped connection
-- or a row the caller may not move left the order half-applied. These functions
-- write every position in one statement and raise if any named row was not
-- updated, which rolls the whole reorder back.
--
-- security invoker on purpose: the existing row-level security policies on
-- shared_lists (Household Account only) and list_items (any principal of the
-- Household) stay the one authority on who may move a row.

create or replace function public.reorder_lists(ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.shared_lists as l
  set sort_order = ordered.position - 1
  from unnest(ids) with ordinality as ordered (id, position)
  where l.id = ordered.id;

  get diagnostics moved = row_count;
  if moved < coalesce(cardinality(ids), 0) then
    raise exception 'reorder names a list that cannot be moved' using errcode = 'P0001';
  end if;
end;
$$;

create or replace function public.reorder_list_items(ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  moved integer;
begin
  update public.list_items as i
  set sort_order = ordered.position - 1
  from unnest(ids) with ordinality as ordered (id, position)
  where i.id = ordered.id;

  get diagnostics moved = row_count;
  if moved < coalesce(cardinality(ids), 0) then
    raise exception 'reorder names an item that cannot be moved' using errcode = 'P0001';
  end if;
end;
$$;

revoke all on function public.reorder_lists(uuid[]) from public;
revoke all on function public.reorder_list_items(uuid[]) from public;
grant execute on function public.reorder_lists(uuid[]) to authenticated;
grant execute on function public.reorder_list_items(uuid[]) to authenticated;
