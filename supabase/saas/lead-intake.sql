-- ============================================================================
-- Lead-intake pipeline — per-workspace ingest tokens.
-- Run this ONCE in the SaaS project's SQL Editor (after schema.sql). Idempotent.
--
-- The lead-intake Edge Function (supabase/functions/lead-intake) turns an inbound
-- email or WhatsApp message into a `sub_` "interest" submission tagged with the
-- right workspace — the console then auto-converts it into a lead (existing flow),
-- and the existing inbox RLS keeps every tenant's leads private.
--
-- SECURITY MODEL
--   * Each workspace gets ONE unguessable `token`. The token maps a public ingest
--     request to exactly one workspace and can only ever CREATE a lead — it grants
--     no read access to anything.
--   * The token table is not client-readable; owners fetch/rotate their own token
--     through the security-definer RPCs below (scoped to their approved org). The
--     Edge Function reads it with the service-role key, server-side only.
--   * A leaked token affects only that one company and only lets someone submit a
--     lead (same blast radius as the public register link) — rotate to revoke.
-- ============================================================================
create extension if not exists pgcrypto;

create table if not exists lead_sources (
  workspace      text primary key,                                   -- the tenant slug (orgs.workspace)
  token          text unique not null default encode(gen_random_bytes(18), 'hex'),
  wa_verify      text not null default encode(gen_random_bytes(12), 'hex'), -- WhatsApp webhook verify token
  wa_app_secret  text,                                               -- optional Meta app secret (for HMAC verify)
  enabled        boolean not null default true,
  allow_mode     text not null default 'all',                        -- 'all' = anyone; 'list' = only allowed contacts
  email_allow    text[] not null default '{}',                       -- allowed sender emails (lowercased)
  wa_allow       text[] not null default '{}',                       -- allowed WhatsApp numbers (digits only)
  created_at     timestamptz default now(),
  updated_at     timestamptz default now()
);
-- Add the filter columns if an earlier version of this table already exists.
alter table lead_sources add column if not exists allow_mode  text   not null default 'all';
alter table lead_sources add column if not exists email_allow text[] not null default '{}';
alter table lead_sources add column if not exists wa_allow    text[] not null default '{}';
alter table lead_sources enable row level security;
-- No policies: the table is reachable ONLY via the security-definer RPCs below and
-- the service-role Edge Function. Clients (anon/authenticated) get nothing directly.
revoke all on table lead_sources from anon, authenticated;

-- The caller's own approved workspace slug (mirrors my_org()'s selection).
create or replace function public.my_workspace_slug()
returns text language sql security definer set search_path = public stable as $$
  select o.workspace from orgs o
    join org_members m on m.org_id = o.id
   where m.user_id = auth.uid() and o.status = 'approved'
   order by o.created_at asc
   limit 1;
$$;

-- Fetch (creating on first use) the caller's ingest token. Owner-only, scoped to
-- their approved org — a user can never see another workspace's token.
create or replace function public.my_lead_source()
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; rec lead_sources%rowtype;
begin
  ws := public.my_workspace_slug();
  if ws is null then return jsonb_build_object('error','no_workspace'); end if;
  select * into rec from lead_sources where workspace = ws;
  if rec.workspace is null then
    insert into lead_sources (workspace) values (ws)
      on conflict (workspace) do nothing;
    select * into rec from lead_sources where workspace = ws;
  end if;
  return jsonb_build_object('workspace', rec.workspace, 'token', rec.token,
                            'wa_verify', rec.wa_verify, 'enabled', rec.enabled,
                            'has_secret', rec.wa_app_secret is not null,
                            'allow_mode', rec.allow_mode,
                            'email_allow', to_jsonb(rec.email_allow),
                            'wa_allow', to_jsonb(rec.wa_allow));
end; $$;
grant execute on function public.my_lead_source() to authenticated;

-- Rotate the token (and WhatsApp verify token) — instantly revokes the old ones.
create or replace function public.rotate_lead_source_token()
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; rec lead_sources%rowtype;
begin
  ws := public.my_workspace_slug();
  if ws is null then return jsonb_build_object('error','no_workspace'); end if;
  insert into lead_sources (workspace) values (ws)
    on conflict (workspace) do update
      set token = encode(gen_random_bytes(18),'hex'),
          wa_verify = encode(gen_random_bytes(12),'hex'),
          updated_at = now()
    returning * into rec;
  return jsonb_build_object('token', rec.token, 'wa_verify', rec.wa_verify);
end; $$;
grant execute on function public.rotate_lead_source_token() to authenticated;

-- Enable/disable ingestion, set the capture filter (which emails/numbers to
-- accept), and optionally store the Meta app secret for HMAC verification.
-- Every parameter is optional; pass only what you're changing. Owner-only.
-- Drop the earlier 2-arg signature so re-running this file doesn't leave two
-- overloads (which would make a p_enabled-only call ambiguous in PostgREST).
drop function if exists public.set_lead_source(boolean, text);
create or replace function public.set_lead_source(
  p_enabled boolean default null, p_wa_app_secret text default null,
  p_allow_mode text default null, p_email_allow text[] default null, p_wa_allow text[] default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare ws text; rec lead_sources%rowtype;
begin
  ws := public.my_workspace_slug();
  if ws is null then return jsonb_build_object('error','no_workspace'); end if;
  if p_allow_mode is not null and p_allow_mode not in ('all','list') then
    return jsonb_build_object('error','bad_mode'); end if;
  insert into lead_sources (workspace) values (ws) on conflict (workspace) do nothing;
  update lead_sources
     set enabled = coalesce(p_enabled, enabled),
         wa_app_secret = coalesce(nullif(p_wa_app_secret,''), wa_app_secret),
         allow_mode = coalesce(p_allow_mode, allow_mode),
         email_allow = coalesce(p_email_allow, email_allow),
         wa_allow = coalesce(p_wa_allow, wa_allow),
         updated_at = now()
   where workspace = ws
   returning * into rec;
  return jsonb_build_object('enabled', rec.enabled, 'has_secret', rec.wa_app_secret is not null,
                            'allow_mode', rec.allow_mode,
                            'email_allow', to_jsonb(rec.email_allow),
                            'wa_allow', to_jsonb(rec.wa_allow));
end; $$;
grant execute on function public.set_lead_source(boolean, text, text, text[], text[]) to authenticated;

-- The Edge Function calls this with the SERVICE ROLE to resolve a token → tenant.
-- (Service role bypasses RLS; this function keeps the lookup + enabled/approved
-- checks in one place and never exposes the secret to anon/authenticated.)
create or replace function public.resolve_lead_source(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare rec lead_sources%rowtype; ok boolean;
begin
  if p_token is null or length(p_token) < 20 then return null; end if;
  select * into rec from lead_sources where token = p_token and enabled;
  if rec.workspace is null then return null; end if;
  select exists(select 1 from orgs where workspace = rec.workspace and status = 'approved') into ok;
  if not ok then return null; end if;   -- only approved orgs receive leads
  return jsonb_build_object('workspace', rec.workspace, 'wa_verify', rec.wa_verify,
                            'wa_app_secret', rec.wa_app_secret,
                            'allow_mode', rec.allow_mode,
                            'email_allow', to_jsonb(rec.email_allow),
                            'wa_allow', to_jsonb(rec.wa_allow));
end; $$;
-- Only the service role (Edge Function) may resolve tokens; no client grant.
revoke execute on function public.resolve_lead_source(text) from public, anon, authenticated;
grant execute on function public.resolve_lead_source(text) to service_role;
