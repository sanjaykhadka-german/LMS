-- Backfill tenants created with the old 24-day trial default so their
-- trial_ends_at is consistent with TRIAL_DAYS = 14 in
-- apps/lms-web/lib/site-config.ts and the post-0003 schema default
-- (now() + interval '14 days').
--
-- Background: 0003_serious_maximus.sql changed the column DEFAULT but
-- Drizzle does not retroactively rewrite existing rows. Tenants created
-- before that migration ran still have trial_ends_at = created_at + 24d
-- and show "trialing 23d left" on the dashboard.
--
-- Idempotent: only updates rows where trial_ends_at is *longer* than
-- created_at + 14 days, so re-running is a no-op.
--
-- Note: any tenant created more than 14 days ago will have a
-- trial_ends_at strictly in the past after this runs. Their dashboard
-- will show "trial expired" until they subscribe; that's the intended
-- end-state of a 14-day trial.
--
-- HOW TO RUN
-- ----------
-- Local:
--   psql "postgres://root:root@localhost:5432/lms" \
--        -f packages/db/migrations/manual/0005_backfill_14d_trial.sql
--
-- Render (lms-db):
--   1) Open Render dashboard → lms-db → Connect → External psql command.
--   2) Paste the UPDATE statement below into the prompt and run it.
--   3) Run the (commented) verification SELECT to inspect the result.

UPDATE app.tenants
   SET trial_ends_at = created_at + interval '14 days',
       updated_at    = now()
 WHERE status = 'trialing'
   AND trial_ends_at > created_at + interval '14 days';

-- Verify after running:
-- SELECT id, name, status, created_at, trial_ends_at,
--        (trial_ends_at - now())::interval AS time_left
--   FROM app.tenants
--  WHERE status = 'trialing'
--  ORDER BY created_at DESC;
