-- Migration 026: Add force_password_change flag to profiles
-- Used for the temp-password invite flow: user must change password on first login

ALTER TABLE public.profiles
ADD COLUMN IF NOT EXISTS force_password_change boolean DEFAULT false;
