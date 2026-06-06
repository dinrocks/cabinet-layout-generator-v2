# Phase 2 — setup & provisioning (Slice 1)

The Slice-1 **code** (auth gate, cloud-saved projects, local fallback) is in the repo and builds. To
turn the cloud features **on** you do these account-level steps once. Until they're done, the app runs in
**local mode** (full editor, local JSON save/open, no sign-in) — nothing breaks.

Order matters: **host first** (so OAuth callbacks have a stable domain), then Supabase, then env.

---

## 1. Host the editor on Cloudflare Pages

1. [Cloudflare dashboard](https://dash.cloudflare.com) → **Workers & Pages** → **Create** → **Pages** →
   **Connect to Git** → pick **`cabinet-layout-generator-v2`**.
2. Build settings:
   - **Framework preset:** None / Vite
   - **Build command:** `npm ci && npm run build`
   - **Build output directory:** `dist`
   - **Root directory:** `web`
3. Deploy. Note the URL, e.g. `https://cabinet-layout-generator-v2.pages.dev` — this is your **app domain**.
   (SPA routing is handled by `web/public/_redirects`.)

> The ezdxf **service stays on Render** — create a service from this repo's `service/render.yaml` (or reuse
> the Phase-1 one), and put its URL in `VITE_DXF_SERVICE_URL` below.

## 2. Create the Supabase project + schema

1. [supabase.com](https://supabase.com) → **New project** (free tier). Copy from **Settings → API**:
   **Project URL**, **anon public key**, **service_role key** (keep the service_role secret).
2. **SQL Editor** → paste all of [`supabase/schema.sql`](../supabase/schema.sql) → **Run**.
3. **Seed the allowlist** (SQL Editor — service role bypasses RLS):
   ```sql
   insert into public.allowed_emails (email) values
     ('you@example.com'),
     ('teammate@example.com');
   ```

## 3. Enable OAuth providers

In Supabase **Authentication → Providers**, enable **GitHub** (quickest) and/or **Google**:

- **GitHub:** create an OAuth App at GitHub → *Settings → Developer settings → OAuth Apps*.
  - **Homepage URL:** your Pages URL.
  - **Authorization callback URL:** `https://<your-project>.supabase.co/auth/v1/callback`
    (Supabase shows the exact value on the provider page.) Paste the Client ID/Secret into Supabase.
- **Google:** same idea via Google Cloud Console → OAuth client (Web). Use the same Supabase callback URL.

In Supabase **Authentication → URL Configuration**, set **Site URL** to your Pages URL and add
`http://localhost:5180` to **Redirect URLs** (for local dev).

## 4. Bootstrap the first admin

After you sign in once (so your profile row exists), in the SQL Editor:
```sql
update public.profiles set is_admin = true where email = 'you@example.com';
```
Admins can then manage `allowed_emails` from SQL/queries (a UI for it can come later).

## 5. Wire the env vars

**Local dev** — create `web/.env` (gitignored):
```
VITE_DXF_SERVICE_URL=http://localhost:8000
VITE_SUPABASE_URL=https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

**Cloudflare Pages** — *Settings → Environment variables* (Production + Preview):
```
VITE_DXF_SERVICE_URL = https://<your-render-service>.onrender.com
VITE_SUPABASE_URL     = https://<your-project>.supabase.co
VITE_SUPABASE_ANON_KEY = <anon public key>
```
Re-deploy after setting them (Vite inlines env at build time).

**Render (service CORS)** — set `ALLOWED_ORIGINS` to include your Pages URL:
```
ALLOWED_ORIGINS = https://cabinet-layout-generator-v2.pages.dev,http://localhost:5180
```

## 6. Keep-alive (avoid the 7-day pause)

Add repo **secrets** (Settings → Secrets and variables → Actions): `SUPABASE_URL`, `SUPABASE_ANON_KEY`.
The [`keepalive.yml`](../.github/workflows/keepalive.yml) workflow then pings Supabase every ~3 days
(no-ops if the secrets are absent).

---

## Verify

1. Open the Pages URL → you get the **sign-in screen**. Sign in with an **allow-listed** email → set a
   display name → the account chip shows it.
2. **Save** the demo layout → refresh → **Open…** → it comes back (validates on load).
3. Sign in with a **non-allow-listed** email → "not on the access list" screen; it can read nothing.
4. A second allow-listed teammate sees your saved layout in **Open…** (shared, last-write-wins).
5. With env unset locally, the app still runs in **Local mode** and the **⬇ / ⬆ JSON** buttons round-trip a
   layout — the graceful-degrade path.

> **Never** put the `service_role` key in the frontend, Cloudflare, or this repo. The browser only ever
> uses the **anon** key; the service_role key is for the ezdxf service later (Slice 2).
