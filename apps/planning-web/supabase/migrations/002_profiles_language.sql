-- Add language preference to user profiles
-- Defaults to 'en' (English). Supported values: 'en', 'de'
-- Extend the check constraint as new locales are added.

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS language TEXT NOT NULL DEFAULT 'en'
    CHECK (language IN ('en', 'de'));

COMMENT ON COLUMN profiles.language IS 'UI language preference for this user (ISO 639-1 code)';
