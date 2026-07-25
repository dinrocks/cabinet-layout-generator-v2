# Supabase

`schema.sql` is the **whole backend**, idempotent — **re-run the entire file** whenever it changes
(never apply partial diffs). It sets up, all under **RLS** that gates every table on being
allow-listed: **email allowlist** + **profiles** · **projects** (each layout one `jsonb` blob) +
**project_revisions** (last-20 history) + **project_events** (append-only audit log) + **folders** ·
the shared **library_items** catalog · **share tokens** + the `shared_project(token)` anonymous
read-only RPC. Helper functions `is_member()` / `is_admin()` are `SECURITY DEFINER`.

## Apply it

1. Create a free Supabase project → copy its **Project URL**, **anon key**, and **service_role key**.
2. Open **SQL Editor** → paste all of `schema.sql` → **Run**.
3. **Seed the allowlist** (service role bypasses RLS, so do this in the SQL editor):
   ```sql
   insert into public.allowed_emails (email) values
     ('you@example.com'),
     ('teammate@example.com');
   ```
4. Enable **Auth → Providers**: GitHub (quickest) and/or Google. Set the redirect/callback to your
   Cloudflare Pages URL **and** `http://localhost:5180` for local dev.
5. **Bootstrap the first admin** (after that person signs in once so their profile exists):
   ```sql
   update public.profiles set is_admin = true where email = 'you@example.com';
   ```

Then set the frontend env (`web/.env` locally, Cloudflare Pages env in prod):
```
VITE_SUPABASE_URL=...        # Project URL
VITE_SUPABASE_ANON_KEY=...   # anon/publishable key (safe in the browser)
```

> The **service_role key never goes in the frontend or this repo** — it bypasses RLS. It's only used
> server-side: the ezdxf service (read/write Storage blocks) and the nightly-backup Action.

Full click-by-click provisioning (OAuth apps, Cloudflare, Render CORS) lives in
[`docs/PHASE2_SETUP.md`](../docs/PHASE2_SETUP.md).
