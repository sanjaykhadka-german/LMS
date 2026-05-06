# Learning Management System (LMS)

A small Flask-based LMS for delivering training modules, quizzes, and a
completion register to employees. Mobile-friendly (Bootstrap 5), free to run
on Render's free tier + Resend's free email tier.

## Features

- Admin panel
  - Create training modules with mixed content (PDF, audio, video, image, text, link)
  - Build quizzes (single- and multi-answer)
  - Add employees (temporary password emailed automatically)
  - Assign modules to one or many employees
  - Completion register + CSV export
  - One-click reminder emails for outstanding trainings
- Employee portal
  - Mobile-friendly login
  - View assigned modules, play audio/video, view PDFs inline
  - Take auto-scored quizzes (default pass mark: 80%)
- Email notifications (via Resend)
  - Account invite
  - New assignment
  - Attempt result (both employee and admin)
  - Weekly reminder (manual trigger)

## Quick start (local)

Requires Python 3.10+.

```bash
python -m venv .venv
.venv\Scripts\activate          # Windows
# source .venv/bin/activate     # macOS / Linux

pip install -r requirements.txt
copy .env.example .env          # then edit values
python app.py
```

The first boot creates an admin account with a random password — check the
console log for the temporary password, then log in at
<http://localhost:5000/login> and change it immediately.

## Deploy to Render (free tier)

1. Create a Resend account at <https://resend.com> and verify your domain
   (or use their test sender). Copy the API key.
2. Push this folder to a new private GitHub repo.
3. On <https://render.com>, choose **New → Blueprint**, select your repo.
   Render reads `render.yaml` and provisions the web service + free
   Postgres database.
4. In the service dashboard, set:
   - `RESEND_API_KEY` — from step 1
   - `APP_BASE_URL` — e.g. `https://lms-yourname.onrender.com`
5. Open the deployed URL, read the admin password from the deploy logs,
   log in, change it, then start adding employees and modules.

## Environment variables

| Var | Purpose |
| --- | --- |
| `SECRET_KEY` | Flask session signing key |
| `DATABASE_URL` | Postgres in prod, SQLite in dev (default) |
| `RESEND_API_KEY` | Resend email API key (leave blank to disable email) |
| `MAIL_FROM` | Verified sender address |
| `MAIL_FROM_NAME` | Display name |
| `APP_BASE_URL` | Public URL — used in email links |
| `ADMIN_EMAIL` | Bootstrap admin + notification recipient |
| `PASS_THRESHOLD` | Integer percent, default 80 |
| `GEMINI_API_KEY` | Google Gemini API key — enables the AI studio via Gemini. Free tier at <https://aistudio.google.com/apikey> |
| `GEMINI_MODEL` | Gemini model id, default `gemini-2.5-flash` |
| `CLAUDE_API_KEY` | Claude API key — enables the AI studio via Claude. Pay-as-you-go at <https://console.anthropic.com>. `ANTHROPIC_API_KEY` is also accepted. |
| `CLAUDE_MODEL` | Claude model id, default `claude-sonnet-4-6` |
| `AI_PROVIDER` | Leave blank to auto-pick (Claude if its key is set, else Gemini), or force `claude` / `gemini`. Claude accepts PDFs/images/DOCX; Gemini also accepts audio/video |

## Project layout

```
app.py              Flask application (routes, scoring)
models.py           SQLAlchemy models
config.py           Env-driven config
email_service.py    Resend email wrapper (degrades gracefully)
templates/
  base.html
  login.html
  change_password.html
  admin/
    dashboard.html  modules.html  module_form.html
    employees.html  assignments.html  register.html
  employee/
    dashboard.html  module.html  quiz.html  result.html
static/uploads/     Uploaded course content (auto-created)
render.yaml         Render deployment manifest
requirements.txt
.env.example
```

## Notes

- Uploads are stored on the local filesystem. Render's free tier has
  ephemeral disk — for production use, switch to an object store
  (S3 / Cloudflare R2) or attach a persistent disk.
- Pass threshold is configurable per-deploy via `PASS_THRESHOLD`.

---

# Tracey monorepo (Phase 1+)

This repository now hosts both the existing Flask LMS (above) and a new
Next.js multi-tenant SaaS — brand: **Tracey**. The Flask app stays at the
repo root and continues to serve German Butchery in production. The Tracey
monorepo lives alongside it under `apps/` and `packages/`. Both apps connect
to the same Render Postgres (`lms-db`); Flask owns the `public` schema,
Tracey owns the `app` schema.

The migration is happening in five phases (see the plan file under
`.claude/plans/`). Phase 1 — covered here — stands up the marketing site,
Clerk auth, tenant model, and Stripe billing.

## Layout

```
/
├── apps/
│   └── lms-web/            ← Next.js 16 marketing + auth + billing
├── packages/
│   ├── auth/               ← Clerk wrapper + currentTenant()
│   ├── config/             ← shared tsconfig / eslint / prettier / tailwind
│   ├── db/                 ← Drizzle schema (app schema) + migrator
│   ├── types/              ← shared TS types (Plan, SubscriptionStatus)
│   └── ui/                 ← shadcn/ui primitives + cn() helper
├── app.py, models.py, …    ← existing Flask LMS, untouched
├── package.json            ← workspace root
├── pnpm-workspace.yaml
├── turbo.json
└── render.yaml             ← lms (Flask) + lms-web (Next) + cron
```

Future sister apps in this monorepo: `apps/tracey-planning` and
`apps/shift-craft` (planning calendar and workforce management). Phase 1
does not create their directories.

## Prerequisites

- Node ≥ 20.11
- pnpm 9 (`corepack enable && corepack prepare pnpm@9.15.0 --activate`)
- Postgres (Render's `lms-db` for shared dev or a local Postgres 14+)
- A Clerk project (free tier, <https://dashboard.clerk.com>)
- A Stripe account in test mode (<https://dashboard.stripe.com>)

## Local setup

```bash
pnpm install
cp .env.example .env                        # then fill in values
pnpm db:migrate                             # creates app schema + tenants
pnpm dev                                     # boots lms-web on :3000
```

The marketing site is at <http://localhost:3000>. `/sign-up` → create org →
`/app` shows the tenant dashboard. `/api/health` returns
`{ ok: true, db: "up" }`.

For Stripe webhooks during local development:

```bash
stripe listen --forward-to localhost:3000/api/webhooks/stripe
```

Set the printed `whsec_…` as `STRIPE_WEBHOOK_SECRET` in `.env`. Then in
the Stripe dashboard create one **product** for Starter and one for Pro.
Each product needs **two prices**:

- Starter: `$19` recurring monthly, `$182.40` recurring yearly (20% off)
- Pro: `$39` recurring monthly, `$374.40` recurring yearly (20% off)

Set `metadata.plan = starter` (or `pro`) on every price — the webhook
handler reads it to update the tenant row. Copy the four price IDs into
`STRIPE_PRICE_STARTER_MONTHLY`, `STRIPE_PRICE_STARTER_ANNUAL`,
`STRIPE_PRICE_PRO_MONTHLY`, `STRIPE_PRICE_PRO_ANNUAL`.

## Tests

```bash
pnpm --filter lms-web test
```

Covers the Stripe webhook handler (subscription update, checkout completed,
invoice failed, idempotency on re-delivery), the plan/status mapping
helpers, and the `/api/health` route.

## Database (Tracey side)

- Schema: everything Tracey owns lives in the `app` schema (Flask is in
  `public` and untouched). `pnpm db:migrate` creates the schema and the
  `pgcrypto` extension, then applies migrations under
  `packages/db/migrations/`.
- Generate a new migration after editing `packages/db/src/schema.ts`:
  `pnpm db:generate`. Commit the resulting SQL.
- Inspect: `pnpm db:studio`.

## Deploy to Render

`render.yaml` defines three services + one database:

| Service | Type | Notes |
|---|---|---|
| `lms` | web (python) | Existing Flask app — unchanged |
| `lms-web` | web (node) | New Next.js app, `healthCheckPath: /api/health` |
| `lms-stripe-reconcile` | cron (node) | Nightly Stripe → DB drift check |
| `lms-db` | postgres | Shared by both apps |

After connecting the repo as a Render Blueprint:

1. Open the `lms-web` service env vars and fill in everything marked
   `sync: false` (Clerk keys, Stripe keys, Stripe price IDs,
   `NEXT_PUBLIC_APP_URL`, `FLASK_BASE_URL`).
2. Add Stripe webhook endpoint `https://lms-web.onrender.com/api/webhooks/stripe`
   in the Stripe dashboard, copy the signing secret into
   `STRIPE_WEBHOOK_SECRET`.
3. Render auto-deploys on push to `main`. The build runs Drizzle
   migrations before `next build`, so the schema is always up to date.

## What's next

Phase 2 wires Single Sign-On from `lms-web` to the Flask service so the
"Open Training" button signs users in seamlessly. Phase 3 makes Flask
multi-tenant. Phase 4 ports each Flask Blueprint to Next.js. Phase 5
retires Flask. Each phase is its own session and its own sequence of PRs.
