# legacy-flask/ — quarantined source

Frozen Flask LMS app and quarantined lms-web bridge code, moved here in
**Phase 5 — Flask retirement** on 2026-05-08.

## Why this directory exists

The Flask app at the repo root served the German Butchery LMS in production
through Phases 1–4.5. Phase 5 retires it: every Flask route now has a
Tracey/Next.js equivalent under `apps/lms-web/`. Rather than `git rm` the
Flask source — which would lose the recoverable backup — everything Flask
owned was moved here so the working tree is no longer cluttered with
inactive code, but rollback is still trivial.

**Do not modify code in this directory.** It exists as a recoverable
backup. If you need to change Flask behaviour, the right answer is almost
always to make the change in `apps/lms-web/` instead.

## Contents

### Flask runtime (root of legacy-flask/)
- `app.py` — Flask app factory + ~91 routes (~3,900 lines)
- `models.py` — SQLAlchemy models for `public.*` tables
- `config.py`, `gunicorn.conf.py` — runtime config
- `ai_service.py`, `claude_service.py`, `gemini_service.py`,
  `email_service.py`, `file_extract.py` — Flask-only services
- `requirements.txt`, `requirements-dev.txt`, `.python-version`,
  `pytest.ini` — Python toolchain
- `generate_pwa_icons.py` — Flask PWA icon helper

### Flask assets
- `static/` — Flask CSS, icons, manifest.json, sw.js (uploads excluded —
  user-uploaded files in `static/uploads/` are gitignored and live on the
  Render disk; they were copied to lms-web's storage before this move)
- `templates/` — 38 Jinja2 templates

### Flask tests
- `tests/` — 15 pytest files

### Quarantined lms-web bridges
- `lms-web-quarantined/api/sso/launch/route.ts.original` — the original
  Phase 2 JWT-minting bridge that POSTed to Flask `/sso/callback`. The
  active route at `apps/lms-web/app/api/sso/launch/route.ts` is now a
  redirect to `/my/modules`.
- `lms-web-quarantined/tests/sso-launch.test.ts` — vitest for the
  original JWT bridge; not relevant to the redirect replacement.

## Render service rollback

**2026-05-19 update:** the `lms` block was removed from `render.yaml`,
stopping Blueprint sync and reclaiming the free-tier slot for ShiftCraft.
The actual dashboard service was deleted on **2026-05-21** (38 Flask-era
users still had `tracey_user_id IS NULL` at that point; the legacy bridge
in `apps/lms-web/lib/auth/legacy-bridge.ts` continues to serve them via
shared `lms-db`). The <60s "just restart it" rollback is no longer
available; rollback now takes ~10-15 min:

1. Recover the `lms` service block from git history (the commit
   immediately before this README change), restore it to `render.yaml`,
   with the same build/start commands as before:
   - buildCommand: `pip install -r legacy-flask/requirements.txt`
   - startCommand: `cd legacy-flask && gunicorn app:app --timeout 180 --workers 2`
2. Push to main; Render Blueprint sync recreates the service.
3. From the dashboard, trigger a manual deploy.

Source in this directory is unchanged — the Python app still builds and
runs. Rollback failure mode is "slower", not "blocked".

## When this directory can be deleted

Only after **all** of these are true:
1. lms-web has been the sole sign-in path in production for at least 60
   days from 2026-05-08 (suggest 90)
2. `SELECT count(*) FROM public.users WHERE tracey_user_id IS NULL` returns
   0 (every Flask-era user has migrated to Tracey)
3. The legacy auth bridge (`apps/lms-web/lib/auth/legacy-bridge.ts`) has
   been removed
4. `users` has been re-added to `0004_enable_rls.sql`'s text_tables array
   and the migration re-applied

(Item 4 from the original list — "lms service removed from render.yaml
and dashboard" — yaml removal 2026-05-19, dashboard deletion 2026-05-21.)

Until then, leave it untouched.
