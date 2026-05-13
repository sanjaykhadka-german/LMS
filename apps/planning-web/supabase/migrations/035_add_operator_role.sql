-- Migration 035: Add 'operator' to user_role enum
ALTER TYPE public.user_role ADD VALUE IF NOT EXISTS 'operator' AFTER 'manager';
