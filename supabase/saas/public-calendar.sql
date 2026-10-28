-- ============================================================================
-- Public calendar — read-only schedule for calendar.html (shareable link)
-- Run ONCE in the SaaS project's SQL Editor. Idempotent.
--
-- SECURITY MODEL
--   * The console stores an unguessable token in the workspace prefs
--     (Calendar → Share). The link carries workspace + token; anon may call
--     get_public_calendar(workspace, token) and receives ONLY schedule fields:
--     tour name, code, category, dates, seats offered / booked, status, guide.
--   * No guest names, no contacts, no money — those never leave the blob.
--   * A wrong or missing token returns null, as does an unapproved workspace.
--   * "Make a new link" in the console writes a new token, which instantly
--     revokes the old link.
-- ============================================================================

create or replace function public.get_public_calendar(p_workspace text, p_token text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare blob jsonb; comp text; out_tours jsonb; tok text;
begin
  if p_workspace is null or length(p_workspace) > 80 or p_token is null or length(p_token) < 8 then return null; end if;
  select coalesce(to_jsonb(o)->>'company', to_jsonb(o)->>'name') into comp
    from orgs o where o.workspace = p_workspace and o.status = 'approved' limit 1;
  if not found then return null; end if;

  select w.data into blob from workspaces w where w.id = p_workspace;
  if blob is null then return null; end if;
  tok := blob->'prefs'->>'calToken';
  if tok is null or tok <> p_token then return null; end if;

  select coalesce(jsonb_agg(x order by x->>'start'), '[]'::jsonb) into out_tours
  from (
    select jsonb_build_object(
      'code',   coalesce(t->>'code',''),
      'name',   coalesce(t->>'name',''),
      'cat',    coalesce(t->>'cat',''),
      'type',   coalesce(t->>'tourType','group'),
      'start',  t->>'start',
      'end',    t->>'end',
      'dates',  coalesce(t->'sessionDates','[]'::jsonb),
      'cap',    coalesce(nullif(regexp_replace(coalesce(t->>'cap',''),'[^0-9]','','g'),'')::int, 0),
      'status', coalesce(t->>'status','open'),
      'guide',  coalesce(t->>'guide',''),
      'booked', coalesce((
        select sum(coalesce(nullif(regexp_replace(coalesce(b->>'party',''),'[^0-9]','','g'),'')::int,0))
          from jsonb_array_elements(coalesce(blob->'bookings','[]'::jsonb)) b
         where b->>'tour' = t->>'id' and lower(coalesce(b->>'status','')) <> 'cancelled'
      ), 0)
    ) as x
    from jsonb_array_elements(coalesce(blob->'tours','[]'::jsonb)) t
    where coalesce(t->>'archived','') <> 'true'
      and coalesce(t->>'end', t->>'start', '') >= to_char(current_date - interval '120 days','YYYY-MM-DD')
  ) s;

  return jsonb_build_object('company', comp, 'tours', out_tours, 'at', now());
end; $$;

revoke all on function public.get_public_calendar(text, text) from public;
grant execute on function public.get_public_calendar(text, text) to anon, authenticated;
