-- Migration 025: user_logins table for login history tracking

CREATE TABLE IF NOT EXISTS public.user_logins (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid REFERENCES public.tenants(id) ON DELETE CASCADE,
  user_id     uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  user_email  text,
  ip_address  text,
  created_at  timestamptz DEFAULT now()
);

ALTER TABLE public.user_logins ENABLE ROW LEVEL SECURITY;

CREATE POLICY user_logins_select ON public.user_logins
  FOR SELECT USING (tenant_id = public.my_tenant_id());

CREATE INDEX IF NOT EXISTS idx_user_logins_user_id ON public.user_logins(user_id);
CREATE INDEX IF NOT EXISTS idx_user_logins_created_at ON public.user_logins(created_at DESC);

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS last_sign_in_at timestamptz;
