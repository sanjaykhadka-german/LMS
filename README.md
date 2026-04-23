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
| `ANTHROPIC_API_KEY` | Claude API key — enables `/admin/modules/ai-generate` (blank disables the feature) |
| `CLAUDE_MODEL` | Claude model id, default `claude-sonnet-4-6` |

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
