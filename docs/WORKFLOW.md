# Workflow — how we build this project

_The collaboration loop that has worked (engineer + AI assistant, Phase 1 → Phase 2). Follow it
every session so quality stays repeatable. Companions: [REFERENCE.md](REFERENCE.md) (palette/tree/
stack), `CLAUDE.md` (laws), `SKILL.md` (architecture), [RISK_REVIEW.md](RISK_REVIEW.md) (risk log)._

---

## The loop (per feature / fix)

1. **Propose before building.** Restate the request, say what you'd build and *why that design*.
   If a decision genuinely changes the outcome (scope, UX shape, data model), ask **2–4 concrete
   options** with a recommendation — then build. If there's an obvious conventional answer, pick
   it, state it, and proceed. **"Don't magic":** never guess at intent or at facts checkable in
   the code — ask, or read the code.

2. **Ground in the code first.** Before designing or claiming anything, read the actual files
   involved (targeted reads/greps, not whole-file dumps). Cite `file:line`. Assumptions that turn
   out wrong cost more than the read.

3. **Build bottom-up.**
   types → **pure core in `web/src/model/` + unit tests** → the three renderers (toSvg ·
   FabricStage · dxf_build — always all three) → stores → UI wiring → CSS. The riskiest logic
   must be testable without the UI (CLAUDE.md §5).

4. **Verify — all of it, every time.**
   - web: `npm run typecheck` · `npm run lint` · `npm test` · `npm run build` (in `web/`)
   - service: `python test_build.py` · `test_auth.py` · `test_upload_rail.py`
     (local venv lives in the **Phase-1** clone: `C:\dev\cabinet-layout-generator\service\.venv`)
   - New logic gets new tests in the same commit — including a regression test for every bug fix.

5. **Improve / de-risk pass.** After a feature lands, look for what it newly exposes (the
   RISK_REVIEW habit): what breaks it, who can lose data, what's now inconsistent. Rank by
   expected damage; fix the top honestly or record it (see doc map) — never silently skip.

6. **Commit + push at "one coherent change" granularity.** One feature or one fix per commit —
   not five, not half. Message = what + why (the failure story for fixes). Push, then **watch CI
   to green** (`gh run watch <id> --exit-status`); a red CI is the current task, not background noise.

7. **Document in the same commit** (see doc map below), and keep the assistant's persistent
   memory in sync so the next session resumes exactly here.

## Doc map — where things get written down

| When | Write to |
|---|---|
| Any user-visible change | `CHANGELOG.md` (Keep-a-Changelog style, why included) |
| Plan approved / idea worth keeping / deferred item | `ROADMAP.md` — deferred items get a **trigger** ("do when X"), never just "later" |
| Risk found or fixed | `docs/RISK_REVIEW.md` — the failure story (why) + the fix (how); mark ✅ when shipped |
| Engineer must click things (SQL, buckets, secrets, env) | `docs/PHASE2_SETUP.md` — exact click-by-click + a Verify step |
| Palette / tree / stack / conventions changed | `docs/REFERENCE.md` |
| The process itself evolves | this file + the short pointer in `CLAUDE.md` |
| Rule of thumb | if a plan, decision, or gotcha took real effort to reach and would cost tokens to re-derive, it belongs in a doc — pick the one file it belongs in (no duplicates), link instead of copying. |

## Conventions that keep us fast (token + quality discipline)

- **Read narrow.** Grep to locate, read only the needed line range. Don't re-read files just
  edited. Don't re-derive what a doc already records — that's what the docs above are for.
- **Reuse before adding.** Shared comparator/constants/helpers over one-off logic; match the
  style of the file being edited; no new dependencies without a reason.
- **Schema changes:** append to `supabase/schema.sql` **idempotently** (`if not exists`, `drop
  policy if exists`) so "re-run the whole file" is always the migration story; hand the user the
  snippet + a verify step, and note it in PHASE2_SETUP.
- **Git on this machine (PowerShell):** multiline commit messages via `git commit -F <file>`
  (here-strings with quotes/emoji break); the CRLF warnings are noise; remote is
  `Taam4142/cabinet-layout-generator-v2`.
- **Deploys are automatic on push:** Cloudflare (frontend) + Render (service — needed for any
  `service/*.py` change to take effect). Tell the user when a re-export/redeploy is needed to see
  a change, and when a schema re-run is pending on their side.
- **Secrets:** anon key = browser-safe; `service_role` key only in Render env / GitHub Actions
  secrets. Nothing private in this public repo (no real cabinet DXFs in tests — synthesize them).

## Definition of done (per increment)

CLAUDE.md §7, plus the working additions:
- [ ] Pure-core tests for new logic (and a regression test if it was a bug)
- [ ] typecheck · lint · test · build green locally; service harnesses green if touched
- [ ] All three renderers agree (if drawing changed) — and DXF opens right in GstarCAD when relevant
- [ ] Docs updated **in the same commit** (doc map above) + memory synced
- [ ] Committed with a what+why message, pushed, **CI green**
- [ ] The user told: what shipped, how to try it, and anything pending on their side
