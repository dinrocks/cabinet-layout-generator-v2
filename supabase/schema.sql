-- Cabinet Layout Generator — Phase 2 schema (Slice 1: auth allowlist + cloud-saved projects)
-- Apply once in the Supabase SQL editor (or `supabase db` CLI). See supabase/README.md.
--
-- Security model: only emails in `allowed_emails` ever get a `profiles` row (via a trigger),
-- and RLS gates ALL data on "has a profile" — so a non-allow-listed user can sign in but reads
-- nothing. This is enforced at the database, not just the UI.

-- ───────────────────────────── tables ─────────────────────────────

-- The allowlist (admin-managed). Seed the first emails via the SQL editor (service role
-- bypasses RLS); after that, admins manage it through the policy below.
create table if not exists public.allowed_emails (
  email      text primary key,
  added_by   uuid references auth.users (id),
  created_at timestamptz not null default now()
);

-- One row per allow-listed signed-in user.
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  display_name text,
  is_admin     boolean not null default false,
  created_at   timestamptz not null default now()
);

-- One layout per row, stored as a single JSON blob (anti-lock-in: layouts stay portable JSON).
create table if not exists public.projects (
  id         uuid primary key default gen_random_uuid(),
  owner      uuid not null references public.profiles (id),
  name       text not null default 'Untitled',
  panel_tag  text not null default '',
  rev        text not null default 'A',
  layout     jsonb not null,
  -- the project's non-seed library items (custom + uploaded parts) so a reload
  -- resolves every lib_key. (Shared library + DXF blocks in Storage come in Slice 2.)
  library    jsonb not null default '{}'::jsonb,
  updated_by uuid references public.profiles (id),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index if not exists projects_updated_at_idx on public.projects (updated_at desc);

-- ──────────────────────── helper functions ────────────────────────
-- SECURITY DEFINER so they read `profiles` WITHOUT triggering its RLS (avoids policy recursion).

create or replace function public.is_member()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid());
$$;

create or replace function public.is_admin()
returns boolean language sql security definer stable set search_path = public as $$
  select exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_admin);
$$;

-- On signup, create a profile ONLY if the email is allow-listed.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from public.allowed_emails a where lower(a.email) = lower(new.email)) then
    insert into public.profiles (id, email)
    values (new.id, new.email)
    on conflict (id) do nothing;
  end if;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ───────────────────────────── RLS ─────────────────────────────
alter table public.allowed_emails enable row level security;
alter table public.profiles       enable row level security;
alter table public.projects       enable row level security;

-- allowed_emails: admins only (seed the first rows via the SQL editor / service role).
drop policy if exists "admins manage allowlist" on public.allowed_emails;
create policy "admins manage allowlist" on public.allowed_emails
  for all using (public.is_admin()) with check (public.is_admin());

-- profiles: any member can read (to show "owned by [name]"); update only your own.
drop policy if exists "members read profiles" on public.profiles;
create policy "members read profiles" on public.profiles
  for select using (public.is_member());
drop policy if exists "update own profile" on public.profiles;
create policy "update own profile" on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

-- projects: shared read among members; insert/update by members; delete by owner or admin.
drop policy if exists "members read projects" on public.projects;
create policy "members read projects" on public.projects
  for select using (public.is_member());
drop policy if exists "members insert projects" on public.projects;
create policy "members insert projects" on public.projects
  for insert with check (public.is_member() and owner = auth.uid());
drop policy if exists "members update projects" on public.projects;
create policy "members update projects" on public.projects
  for update using (public.is_member()) with check (public.is_member());
drop policy if exists "owner or admin delete" on public.projects;
create policy "owner or admin delete" on public.projects
  for delete using (owner = auth.uid() or public.is_admin());

-- ───────────────────────── Slice 2: shared equipment library ─────────────────────────
-- Uploaded-DXF parts shared across all projects. The raw block lives in Supabase Storage
-- (bucket `equipment`, object `<block_ref>.dxf`); this table is the catalog. Add-by-anyone,
-- edit/delete admin-only.
create table if not exists public.library_items (
  lib_key        text primary key,             -- e.g. up_xxxx
  name           text not null,
  source         text not null default 'dxf',
  width_mm       double precision not null,
  height_mm      double precision not null,
  block_ref      text not null,                -- Storage object id (<block_ref>.dxf)
  svg_ref        text,                         -- inline SVG for the editor view
  rail_offset_mm double precision,
  band           int,                          -- category (1..7); also the future BOM type
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
-- for projects created before `band` existed (idempotent):
alter table public.library_items add column if not exists band int;

alter table public.library_items enable row level security;

-- members read the whole shared library; any member may add; only admins edit/delete.
drop policy if exists "members read library" on public.library_items;
create policy "members read library" on public.library_items
  for select using (public.is_member());
drop policy if exists "members add library" on public.library_items;
create policy "members add library" on public.library_items
  for insert with check (public.is_member() and created_by = auth.uid());
drop policy if exists "admins edit library" on public.library_items;
create policy "admins edit library" on public.library_items
  for update using (public.is_admin()) with check (public.is_admin());
drop policy if exists "admins delete library" on public.library_items;
create policy "admins delete library" on public.library_items
  for delete using (public.is_admin());
