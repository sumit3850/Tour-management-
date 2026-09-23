-- ============================================================================
-- GUIDE / DRIVER APP FIX — run once on the SaaS project (Supabase Studio > SQL Editor).
--
-- Problem: the SaaS migration (schema.sql) locked the old per-record mirror
-- tables (ieo_ops, ieo_external_guides, ieo_drivers, …). The console can no
-- longer write to them, so they froze at the migration date — but guide_login,
-- driver_login and driver_trips still READ them first whenever they exist, so
-- guides and drivers were served that frozen copy: no new tours, no operation
-- filed under an additional guide, nothing changed since the migration.
--
-- Phone numbers match on their last 10 digits, so a stored '+91 …' or a typed
-- country code never blocks a sign-in.
-- Fix: the three login functions now read ONLY the live workspace blob (the one
-- thing the console writes), find the guide / driver across every company's
-- workspace row by phone + code, and return that workspace id so the apps tag
-- their status updates correctly. Idempotent — safe to re-run.
-- ============================================================================

-- Which workspace rows may serve a login: rows registered to a company, plus
-- the original island-explorer row; never inbox submissions.
create or replace function public._login_workspaces()
returns table(id text, data jsonb)
language sql security definer set search_path = public as $$
  select w.id, w.data from workspaces w
   where w.id not like 'sub\_%' escape '\'
     and w.id <> 'ieo_submissions'
     and (w.id = 'island-explorer' or exists (select 1 from orgs o where o.workspace = w.id))
   order by (w.id = 'island-explorer') desc, w.updated_at desc;
$$;

create or replace function public.guide_login(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w record; ws jsonb; wsid text; g jsonb; gname text; ops jsonb; vehs jsonb; drvs jsonb; ph text;
begin
  ph := regexp_replace(coalesce(p_phone,''),'\D','','g');
  if length(ph) < 6 or coalesce(p_code,'') = '' then return jsonb_build_object('error','no_match'); end if;
  for w in select * from _login_workspaces() loop
    select (x - 'documents' - 'idDoc' - 'licenseDoc') into g
      from jsonb_array_elements(coalesce(w.data->'externalGuides','[]'::jsonb)) x
     where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10)
       and coalesce(x->>'code','') = p_code
     limit 1;
    if g is null then
      select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code') into g
        from jsonb_array_elements(coalesce(w.data->'operators','[]'::jsonb)) x
       where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10)
         and coalesce(x->>'code','') = p_code
         and lower(coalesce(x->>'role','')) = 'guide'
       limit 1;
    end if;
    if g is not null then ws := w.data; wsid := w.id; exit; end if;
  end loop;
  if g is null then return jsonb_build_object('error','no_match'); end if;
  gname := lower(trim(g->>'name'));
  -- Every operation filed under this guide (the console files one copy per
  -- guide on the job), plus any older record that lists them as an extra guide.
  select coalesce(jsonb_agg(o),'[]'::jsonb) into ops
    from jsonb_array_elements(coalesce(ws->'ops','[]'::jsonb)) o
   where lower(trim(coalesce(o->>'guide',''))) = gname
      or (coalesce(o->>'shadowOf','') = ''
          and exists (select 1 from jsonb_array_elements(coalesce(o->'guides','[]'::jsonb)) gg
                       where lower(trim(coalesce(gg->>'name',''))) = gname)
          and not exists (select 1 from jsonb_array_elements(coalesce(ws->'ops','[]'::jsonb)) sh
                           where sh->>'shadowOf' = o->>'id' and lower(trim(coalesce(sh->>'guide',''))) = gname));
  select coalesce(jsonb_agg(jsonb_build_object('name',v->>'name','reg',v->>'reg','driver',v->>'driver')),'[]'::jsonb) into vehs
    from jsonb_array_elements(coalesce(ws->'vehicles','[]'::jsonb)) v
   where lower(trim(coalesce(v->>'name',''))) in (
      select lower(trim(coalesce(x->>'veh',''))) from jsonb_array_elements(ops) x
      union
      select lower(trim(coalesce(l->>'veh',''))) from jsonb_array_elements(ops) x, jsonb_array_elements(coalesce(x->'legs','[]'::jsonb)) l);
  select coalesce(jsonb_agg(jsonb_build_object('name',d->>'name','phone',d->>'phone')),'[]'::jsonb) into drvs
    from jsonb_array_elements(coalesce(ws->'drivers','[]'::jsonb)) d
   where lower(trim(coalesce(d->>'name',''))) in (
      select lower(trim(coalesce(x->>'driver',''))) from jsonb_array_elements(ops) x
      union
      select lower(trim(coalesce(l->>'driver',''))) from jsonb_array_elements(ops) x, jsonb_array_elements(coalesce(x->'legs','[]'::jsonb)) l);
  return jsonb_build_object('guide',g,'ops',ops,'vehicles',vehs,'drivers',drvs,'workspace',wsid);
end;
$$;
grant execute on function public.guide_login(text,text) to anon, authenticated;

create or replace function public.driver_login(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w record; ws jsonb; wsid text; d jsonb; dname text; ops jsonb; vehs jsonb; ph text;
begin
  ph := regexp_replace(coalesce(p_phone,''),'\D','','g');
  if length(ph) < 6 or coalesce(p_code,'') = '' then return jsonb_build_object('error','no_match'); end if;
  for w in select * from _login_workspaces() loop
    select (x - 'documents' - 'idDoc' - 'licenseDoc') into d
      from jsonb_array_elements(coalesce(w.data->'drivers','[]'::jsonb)) x
     where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10)
       and coalesce(x->>'code','') = p_code
     limit 1;
    if d is null then
      select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code','veh','') into d
        from jsonb_array_elements(coalesce(w.data->'operators','[]'::jsonb)) x
       where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10)
         and coalesce(x->>'code','') = p_code
         and lower(coalesce(x->>'role','')) = 'driver'
       limit 1;
    end if;
    if d is not null then ws := w.data; wsid := w.id; exit; end if;
  end loop;
  if d is null then return jsonb_build_object('error','no_match'); end if;
  dname := lower(trim(d->>'name'));
  select coalesce(jsonb_agg(o),'[]'::jsonb) into ops
    from jsonb_array_elements(coalesce(ws->'ops','[]'::jsonb)) o
   where coalesce(o->>'shadowOf','') = ''
     and (lower(trim(coalesce(o->>'driver',''))) = dname
          or exists (select 1 from jsonb_array_elements(coalesce(o->'legs','[]'::jsonb)) l where lower(trim(coalesce(l->>'driver',''))) = dname));
  select coalesce(jsonb_agg(jsonb_build_object('name',v->>'name','reg',v->>'reg')),'[]'::jsonb) into vehs
    from jsonb_array_elements(coalesce(ws->'vehicles','[]'::jsonb)) v
   where lower(trim(coalesce(v->>'driver',''))) = dname;
  return jsonb_build_object('driver',d,'ops',ops,'vehicles',vehs,'workspace',wsid);
end;
$$;
grant execute on function public.driver_login(text,text) to anon, authenticated;

create or replace function public.driver_trips(p_phone text, p_code text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  w record; ws jsonb; d jsonb; dname text; trips jsonb; ph text;
begin
  ph := regexp_replace(coalesce(p_phone,''),'\D','','g');
  if length(ph) < 6 or coalesce(p_code,'') = '' then return jsonb_build_object('error','no_match'); end if;
  for w in select * from _login_workspaces() loop
    select x into d from jsonb_array_elements(coalesce(w.data->'drivers','[]'::jsonb)) x
     where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10) and coalesce(x->>'code','') = p_code limit 1;
    if d is null then
      select jsonb_build_object('name',x->>'name','phone',x->>'phone','code',x->>'code') into d
        from jsonb_array_elements(coalesce(w.data->'operators','[]'::jsonb)) x
       where right(regexp_replace(coalesce(x->>'phone',''),'\D','','g'),10) = right(ph,10) and coalesce(x->>'code','') = p_code
         and lower(coalesce(x->>'role','')) = 'driver' limit 1;
    end if;
    if d is not null then ws := w.data; exit; end if;
  end loop;
  if d is null then return jsonb_build_object('error','no_match'); end if;
  dname := lower(trim(d->>'name'));
  select coalesce(jsonb_agg(t),'[]'::jsonb) into trips
    from jsonb_array_elements(coalesce(ws->'trips','[]'::jsonb)) t
   where lower(trim(coalesce(t->>'driver',''))) = dname;
  return jsonb_build_object('trips',trips);
end;
$$;
grant execute on function public.driver_trips(text,text) to anon, authenticated;

-- ---- Report: what each guide will now see (read this result) ---------------
select w.id as workspace,
       g->>'name' as guide,
       (select count(*) from jsonb_array_elements(coalesce(w.data->'ops','[]'::jsonb)) o
         where lower(trim(coalesce(o->>'guide',''))) = lower(trim(g->>'name'))) as operations_served
  from _login_workspaces() w, jsonb_array_elements(coalesce(w.data->'externalGuides','[]'::jsonb)) g
 order by 1, 2;
