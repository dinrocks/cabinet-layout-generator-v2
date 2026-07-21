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
  band           int,                          -- category (1..8); also the future BOM type
  manufacturer   text,                         -- BOM: orderable identity (human-entered)
  model          text,                         -- BOM: manufacturer model / part number
  description    text,                         -- BOM: long spec line (falls back to name)
  created_by     uuid references public.profiles (id),
  created_at     timestamptz not null default now()
);
-- for projects created before these columns existed (idempotent):
alter table public.library_items add column if not exists band int;
alter table public.library_items add column if not exists manufacturer text;
alter table public.library_items add column if not exists model text;
alter table public.library_items add column if not exists description text;

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

-- ── project_revisions: the last ~20 saves of every project (RISK_REVIEW R1) ──
-- Every save also writes a revision here, so one bad save no longer destroys a
-- drawing — any recent version can be restored from the History dialog. Rows are
-- trimmed automatically (trigger below); deleting a project deletes its history.
create table if not exists public.project_revisions (
  id         uuid primary key default gen_random_uuid(),
  project_id uuid not null references public.projects (id) on delete cascade,
  name       text not null default 'Untitled',   -- project name at save time
  layout     jsonb not null,
  library    jsonb not null default '{}'::jsonb, -- the project-local parts snapshot
  saved_by   uuid references public.profiles (id),
  saved_at   timestamptz not null default now()
);
create index if not exists project_revisions_proj_idx
  on public.project_revisions (project_id, saved_at desc);

-- keep only the newest 20 revisions per project (SECURITY DEFINER so the trim
-- isn't blocked by RLS; members have no direct delete right)
create or replace function public.trim_project_revisions()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  delete from public.project_revisions
  where project_id = new.project_id
    and id not in (
      select id from public.project_revisions
      where project_id = new.project_id
      order by saved_at desc
      limit 20
    );
  return new;
end $$;
drop trigger if exists trim_revisions on public.project_revisions;
create trigger trim_revisions after insert on public.project_revisions
  for each row execute function public.trim_project_revisions();

alter table public.project_revisions enable row level security;
drop policy if exists "members read revisions" on public.project_revisions;
create policy "members read revisions" on public.project_revisions
  for select using (public.is_member());
drop policy if exists "members add revisions" on public.project_revisions;
create policy "members add revisions" on public.project_revisions
  for insert with check (public.is_member() and saved_by = auth.uid());
-- no update/delete policies: history is append-only (the trigger trims).

-- ── folders: team-shared, one-level grouping of layouts (Job → its cabinets) ──
create table if not exists public.folders (
  id         uuid primary key default gen_random_uuid(),
  name       text not null default 'Folder',
  owner      uuid not null references public.profiles (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
-- a layout's folder (null = Unfiled). Deleting a folder UN-FILES its layouts, never deletes them.
alter table public.projects add column if not exists folder_id uuid references public.folders (id) on delete set null;
create index if not exists projects_folder_idx on public.projects (folder_id);

alter table public.folders enable row level security;
-- shared like projects: any member reads/creates/renames; delete by owner or admin.
drop policy if exists "members read folders" on public.folders;
create policy "members read folders" on public.folders for select using (public.is_member());
drop policy if exists "members insert folders" on public.folders;
create policy "members insert folders" on public.folders
  for insert with check (public.is_member() and owner = auth.uid());
drop policy if exists "members update folders" on public.folders;
create policy "members update folders" on public.folders
  for update using (public.is_member()) with check (public.is_member());
drop policy if exists "owner or admin delete folders" on public.folders;
create policy "owner or admin delete folders" on public.folders
  for delete using (owner = auth.uid() or public.is_admin());

-- ── Phase 3: read-only share links ─────────────────────────────────────────
-- A project with a share_token is viewable (read-only) by ANYONE holding the
-- exact token — via the RPC below only. RLS stays closed; clearing the token
-- revokes the link instantly. Members create/clear it through the normal
-- "members update projects" policy.
alter table public.projects add column if not exists share_token text unique;

-- The ONLY anonymous door: exact-token lookup returning just what the viewer
-- needs (never listable, no member/owner data beyond the display name).
-- `catalog` carries the shared library_items the layout actually references
-- (anonymous viewers can't read the members-only catalog table) — only those,
-- never the whole catalog.
create or replace function public.shared_project(token text)
returns table (name text, layout jsonb, library jsonb, catalog jsonb, updated_at timestamptz)
language sql security definer stable set search_path = public as $$
  select p.name, p.layout, p.library,
    (select coalesce(jsonb_object_agg(li.lib_key, to_jsonb(li)), '{}'::jsonb)
     from public.library_items li
     where li.lib_key in (
       select e->>'lib_key' from jsonb_array_elements(coalesce(p.layout->'elements', '[]'::jsonb)) e
       union
       select g->>'lib_key' from jsonb_array_elements(coalesce(p.layout->'groups', '[]'::jsonb)) g
       union
       select g->>'cap_start_key' from jsonb_array_elements(coalesce(p.layout->'groups', '[]'::jsonb)) g
       union
       select g->>'cap_end_key' from jsonb_array_elements(coalesce(p.layout->'groups', '[]'::jsonb)) g
     )),
    p.updated_at
  from public.projects p
  where p.share_token is not null and p.share_token = token
$$;
revoke all on function public.shared_project(text) from public;
grant execute on function public.shared_project(text) to anon, authenticated;

-- ── Phase 3: audit log — who did what, when (team activity trail) ────────────
-- Append-only. Survives project deletion (project_id → null on delete) so a
-- delete stays auditable; project_name is snapshotted for that case. Written
-- best-effort by the client (team-trust model, same as revisions).
create table if not exists public.project_events (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid references public.projects (id) on delete set null,
  project_name text not null default 'Untitled',
  actor        uuid references public.profiles (id),
  action       text not null,          -- created | saved | duplicated | deleted | shared | unshared
  detail       text,                   -- optional (e.g. copy source/target)
  at           timestamptz not null default now()
);
create index if not exists project_events_project_idx on public.project_events (project_id, at desc);
create index if not exists project_events_at_idx on public.project_events (at desc);

alter table public.project_events enable row level security;
drop policy if exists "members read events" on public.project_events;
create policy "members read events" on public.project_events
  for select using (public.is_member());
drop policy if exists "members add events" on public.project_events;
create policy "members add events" on public.project_events
  for insert with check (public.is_member() and actor = auth.uid());
-- no update/delete policies: the audit trail is append-only.
