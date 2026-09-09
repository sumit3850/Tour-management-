-- ============================================================================
-- FORM ↔ TOUR live sync
-- ----------------------------------------------------------------------------
-- Lets the PUBLIC registration form (register.html) read a single tour's
-- current form-relevant fields by its tour id, so the shared form always
-- mirrors the latest tour — activity, dates, category and session dates —
-- even when the link was copied before the tour was edited.
--
-- Returns ONLY the handful of fields the form needs (no prices, bookings or
-- guests) and only for APPROVED companies. Safe to run more than once.
--
-- HOW TO RUN: Supabase dashboard → SQL Editor → paste this file → Run.
-- ============================================================================
create or replace function public.get_tour_for_form(p_workspace text, p_tid text)
returns jsonb language plpgsql security definer set search_path = public stable as $$
declare blob jsonb; t jsonb;
begin
  if p_workspace is null or p_tid is null or length(p_workspace) > 80 then return null; end if;
  perform 1 from orgs o where o.workspace = p_workspace and o.status = 'approved' limit 1;
  if not found then return null; end if;
  select w.data into blob from workspaces w where w.id = p_workspace;
  if blob is null then return null; end if;
  select x into t
    from jsonb_array_elements(coalesce(blob->'tours','[]'::jsonb)) x
   where x->>'id' = p_tid
   limit 1;
  if t is null then return null; end if;
  return jsonb_build_object(
    'name',         t->>'name',
    'code',         t->>'code',
    'cat',          t->>'cat',
    'activity',     t->>'activity',
    'tourType',     t->>'tourType',
    'start',        t->>'start',
    'end',          t->>'end',
    'sessionDates', t->'sessionDates',
    'updatedAt',    t->>'updatedAt'
  );
end; $$;
revoke all on function public.get_tour_for_form(text, text) from public;
grant execute on function public.get_tour_for_form(text, text) to anon, authenticated;
