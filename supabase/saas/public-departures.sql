-- ============================================================================
-- Public departures board — read-only, sanitized tour list for departures.html
-- Run ONCE in the SaaS project's SQL Editor. Idempotent.
--
-- SECURITY MODEL
--   * anon may call get_public_departures(workspace) and receives ONLY marketing
--     fields: tour name, category, dates, capacity, seats booked, status, code.
--   * No guest names, no money, no contacts — those never leave the blob.
--   * Only APPROVED workspaces answer; unknown/unapproved slugs return null,
--     so the function can't be used to enumerate tenants' data.
--   * The workspace blob itself stays protected by its existing RLS; this
--     definer function is the single, narrow public window into it.
-- ============================================================================

create or replace function public.get_public_departures(p_workspace text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare blob jsonb; comp text; out_tours jsonb;
begin
  if p_workspace is null or length(p_workspace) > 80 then return null; end if;
  -- only approved tenants have a public board
  select coalesce(to_jsonb(o)->>'company', to_jsonb(o)->>'name') into comp
    from orgs o where o.workspace = p_workspace and o.status = 'approved' limit 1;
  if not found then return null; end if;

  select w.data into blob from workspaces w where w.id = p_workspace;
  if blob is null then return jsonb_build_object('company', comp, 'tours', '[]'::jsonb); end if;

  select coalesce(jsonb_agg(x order by x->>'start'), '[]'::jsonb) into out_tours
  from (
    select jsonb_build_object(
      'code',  coalesce(t->>'code',''),
      'name',  coalesce(t->>'name',''),
      'cat',   coalesce(t->>'cat',''),
      'start', t->>'start',
      'end',   t->>'end',
      'cap',   coalesce((t->>'cap')::int, 0),
      'status',coalesce(t->>'status','open'),
      'booked', coalesce((
        select sum(coalesce((b->>'party')::int,0))
          from jsonb_array_elements(coalesce(blob->'bookings','[]'::jsonb)) b
         where b->>'tour' = t->>'id' and coalesce(b->>'status','') <> 'Cancelled'
      ), 0)
    ) as x
    from jsonb_array_elements(coalesce(blob->'tours','[]'::jsonb)) t
    where (t->>'end') >= to_char(current_date,'YYYY-MM-DD')
      and coalesce(t->>'status','open') not in ('completed','closed')
  ) s;

  return jsonb_build_object('company', comp, 'tours', out_tours);
end; $$;

revoke all on function public.get_public_departures(text) from public;
grant execute on function public.get_public_departures(text) to anon, authenticated;
