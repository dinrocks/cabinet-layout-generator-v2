# Supabase (Phase 2)

`schema.sql` sets up the Slice-1 backend: an **email allowlist**, **profiles**, and **projects**
(each layout stored as one `jsonb` blob), with **RLS** that gates all data on being allow-listed.

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

> The **service_role key never goes in the frontend or this repo** — it bypasses RLS. It's only needed
> later (Slice 2) for the ezdxf service to verify JWTs / read blocks server-side.

Full click-by-click provisioning (OAuth apps, Cloudflare, Render CORS) lives in
[`docs/PHASE2_SETUP.md`](../docs/PHASE2_SETUP.md).
