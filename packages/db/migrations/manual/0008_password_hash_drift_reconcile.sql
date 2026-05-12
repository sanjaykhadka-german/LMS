-- One-shot reconcile for password hashes that drifted between
-- public.users.password_hash (legacy Flask) and app.users.password_hash
-- (Tracey/Auth.js) before commit bc1709e (fix(auth): mirror password
-- resets across both stores).
--
-- Background:
--   Before bc1709e, two server actions wrote to only one of the two
--   password stores:
--     - resetEmployeePasswordAction → public.users only
--     - changePasswordAction        → app.users only
--   Sign-in tried app.users first and fell back to the legacy bridge, so
--   both old and new passwords kept authorizing until both stores
--   converged. Any user whose password was reset before that fix still
--   has misaligned hashes — this script aligns them.
--
-- Strategy:
--   For each user with mismatched hashes, look up the most recent
--   password-related audit event:
--     - 'employee.password_reset'   → admin reset → public.users is newer
--                                     → copy public → app
--     - 'profile.password_changed'  → self-serve  → app.users is newer
--                                     → copy app → public
--   Users with no matching audit event are flagged for manual review.
--
-- Why this is safe:
--   - We never invent a new hash; we only copy one existing verified hash
--     to the other store.
--   - password_changed_at is NOT bumped: from the user's perspective
--     their password didn't change just now, so existing JWT sessions
--     should not be invalidated.
--   - Idempotent: re-running after success is a no-op (no rows match).
--
-- HOW TO RUN
-- ----------
-- Local:
--   psql "postgres://root:root@localhost:5432/lms" \
--        -f packages/db/migrations/manual/0008_password_hash_drift_reconcile.sql
--
-- Render (lms-db):
--   1) Open Render dashboard → lms-db → Connect → External psql command.
--   2) Run the DIAGNOSTIC block first to see what's affected.
--   3) Eyeball the list, then run the BEGIN…COMMIT block to apply.
--   4) Run the VERIFICATION block — should return zero "still drifted" rows.

-- ─── DIAGNOSTIC (read-only, run first) ─────────────────────────────────
WITH drift AS (
  SELECT
    u.id          AS lms_id,
    u.tracey_user_id::uuid AS tracey_uid,
    u.email,
    u.password_hash AS lms_hash,
    au.password_hash AS app_hash
  FROM public.users u
  JOIN app.users au ON au.id = u.tracey_user_id::uuid
  WHERE u.password_hash IS NOT NULL
    AND au.password_hash IS NOT NULL
    AND u.password_hash <> au.password_hash
),
last_event AS (
  SELECT DISTINCT ON (target_id)
    target_id,
    action,
    created_at
  FROM app.audit_events
  WHERE action IN ('employee.password_reset', 'profile.password_changed')
  ORDER BY target_id, created_at DESC
)
SELECT
  d.email,
  d.lms_id,
  COALESCE(e.action, '(no audit event — manual review)') AS last_event,
  e.created_at AS last_event_at,
  CASE
    WHEN e.action = 'employee.password_reset'   THEN 'lms  →  app'
    WHEN e.action = 'profile.password_changed'  THEN 'app  →  lms'
    ELSE 'unknown — skipped'
  END AS reconcile_direction
FROM drift d
LEFT JOIN last_event e ON e.target_id = d.lms_id::text
ORDER BY d.email;

-- ─── APPLY (mutates rows — wrap in transaction) ────────────────────────
BEGIN;

-- Direction A: admin reset was last → lms is canonical → copy lms → app
WITH last_event AS (
  SELECT DISTINCT ON (target_id) target_id, action
  FROM app.audit_events
  WHERE action IN ('employee.password_reset', 'profile.password_changed')
  ORDER BY target_id, created_at DESC
)
UPDATE app.users au
   SET password_hash = u.password_hash,
       updated_at    = NOW()
  FROM public.users u
  JOIN last_event e ON e.target_id = u.id::text
 WHERE au.id = u.tracey_user_id::uuid
   AND u.password_hash IS NOT NULL
   AND au.password_hash IS NOT NULL
   AND u.password_hash <> au.password_hash
   AND e.action = 'employee.password_reset';

-- Direction B: self-serve change was last → app is canonical → copy app → lms
WITH last_event AS (
  SELECT DISTINCT ON (target_id) target_id, action
  FROM app.audit_events
  WHERE action IN ('employee.password_reset', 'profile.password_changed')
  ORDER BY target_id, created_at DESC
)
UPDATE public.users u
   SET password_hash = au.password_hash
  FROM app.users au
  JOIN last_event e ON e.target_id = u.id::text
 WHERE au.id = u.tracey_user_id::uuid
   AND u.password_hash IS NOT NULL
   AND au.password_hash IS NOT NULL
   AND u.password_hash <> au.password_hash
   AND e.action = 'profile.password_changed';

COMMIT;

-- ─── VERIFICATION (should return zero rows for fixed users) ────────────
-- Rows here mean either: (a) users with no audit event (manual review),
-- or (b) the script didn't cover their case for some reason.
SELECT
  u.email,
  u.id AS lms_id,
  'still drifted' AS status
FROM public.users u
JOIN app.users au ON au.id = u.tracey_user_id::uuid
WHERE u.password_hash IS NOT NULL
  AND au.password_hash IS NOT NULL
  AND u.password_hash <> au.password_hash;
