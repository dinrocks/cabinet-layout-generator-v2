# Deploying

Three free-tier pieces:

- **`web/`** — Vite/React frontend → **Cloudflare Pages** (static, commercial-OK). The editor +
  PDF/PNG/SVG exports + share-link viewer work with no backend.
- **`service/`** — Python ezdxf service → **Render** (free web service). Needed only for **DXF**
  upload/export and the bundle's block download.
- **Supabase** — auth (email allowlist) + Postgres/RLS + Storage (uploaded blocks, nightly backups).
  Optional: with none of it configured the app runs in **local mode** (full editor, local JSON
  save/open, no sign-in) — nothing breaks.

> **This page is the overview + current hosting map.** The exact click-by-click provisioning (Supabase
> schema, OAuth, buckets, env vars, keep-alive, the auth cutover) lives in **[docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md)** —
> follow that to stand a full deployment up. Local dev is in **[RUNNING.md](RUNNING.md)**.

---

## Current hosting map

| Where | What | Key env / secrets |
|---|---|---|
| **Cloudflare Pages** (`…pages.dev`) | frontend — root `web`, `npm ci && npm run build` → `dist` | `NODE_VERSION=22`, `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_DXF_SERVICE_URL` |
| **Render** (`…onrender.com`) | ezdxf service — root `service`, from `service/render.yaml` | `ALLOWED_ORIGINS`, `REQUIRE_AUTH=1`, `SUPABASE_JWT_SECRET` ⚠, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` ⚠, `SUPABASE_BUCKET=equipment` |
| **Supabase** | auth + DB (RLS) + Storage buckets `equipment`, `backups` (both private) | schema via `supabase/schema.sql` |
| **GitHub Actions** | nightly backup + keep-alive | secrets `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY` ⚠ |

⚠ `service_role` / `JWT_SECRET` are server-only — **only** in Render env + GitHub Actions secrets, never
in the repo, the frontend, or `web/.env` (the anon key is the only browser-safe key).

## Deploy order (fresh setup)

1. **Frontend → Cloudflare Pages** — connect the repo, root `web`, build `npm ci && npm run build`,
   output `dist`. You get the app URL (your **app domain**; settle it before wiring OAuth — callbacks
   are per-domain). SPA routing is handled by `web/public/_redirects`; security headers + CSP ship via
   `web/public/_headers` (applied automatically by Pages — see the CSP-verify note below).
2. **Service → Render** — New → Blueprint from `service/render.yaml` (or a Web Service, root `service`,
   build `pip install -r requirements.txt`, start `uvicorn app:app --host 0.0.0.0 --port $PORT`). Set
   `ALLOWED_ORIGINS` = the exact Pages URL. Verify `GET /health` → `{"status":"ok", …}`.
3. **Supabase + env + OAuth + auth cutover** — follow **[docs/PHASE2_SETUP.md](docs/PHASE2_SETUP.md)**
   end to end (schema, allowlist, providers, first admin, the `VITE_*` + service env, the
   `SUPABASE_JWT_SECRET` + `REQUIRE_AUTH=1` auth flip, keep-alive, backups).

## Security must-dos on deploy

- **`REQUIRE_AUTH=1` on Render** — makes a missing `SUPABASE_JWT_SECRET` a hard **503** instead of an
  open endpoint (fail closed). After deploy, `/health` should read `{"auth": true, "require_auth": true}`.
- **`ALLOWED_ORIGINS`** = the exact frontend origin(s), never `*`.
- **Verify the CSP** (`web/public/_headers`) on a Cloudflare **preview** deployment before trusting prod:
  open the preview and confirm sign-in, save/open, DXF export/upload, and a **share link + its PDF
  download** all work with no console CSP violations. Loosen only the specific directive that breaks.
  Full matrix + rationale: **[docs/SECURITY_HARDENING.md](docs/SECURITY_HARDENING.md)**.

## Notes

- **Render free sleeps** after ~15 min idle → the first DXF op is slow ("waking service…"). In-browser
  exports (PDF/PNG/SVG) and the share viewer are unaffected. `keepalive.yml` mitigates Supabase's pause,
  not Render's sleep.
- **Uploaded blocks are durable** (Supabase Storage) once `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` are set
  on Render; without them the service falls back to its ephemeral local disk (re-upload after a restart).
- GitHub account was renamed `Taamrock04` → `Taam4142`; Cloudflare/Render still deploy via the redirect —
  reconnect to the new name when convenient.

See **[RUNNING.md](RUNNING.md)** for local development.
