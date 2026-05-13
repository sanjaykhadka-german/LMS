-- Migration 036: Dynamic RBAC — roles + role_permissions + migrate profiles

-- 1. roles table
CREATE TABLE public.roles (
  id          uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  description text,
  is_system   boolean NOT NULL DEFAULT false,
  is_active   boolean NOT NULL DEFAULT true,
  sort_order  integer NOT NULL DEFAULT 0,
  created_at  timestamptz DEFAULT now(),
  UNIQUE (tenant_id, name)
);
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
CREATE POLICY roles_tenant ON public.roles FOR ALL USING (tenant_id = public.my_tenant_id());
CREATE INDEX idx_roles_tenant ON public.roles(tenant_id);

-- 2. role_permissions table
CREATE TABLE public.role_permissions (
  id       uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  role_id  uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  section  text NOT NULL,
  access   text NOT NULL DEFAULT 'none' CHECK (access IN ('none','read','write')),
  UNIQUE (role_id, section)
);
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY role_permissions_tenant ON public.role_permissions FOR ALL
  USING (role_id IN (SELECT id FROM public.roles WHERE tenant_id = public.my_tenant_id()));
CREATE INDEX idx_role_permissions_role ON public.role_permissions(role_id);

-- 3. Add role_id to profiles and user_invites (keep old role column for now)
ALTER TABLE public.profiles    ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;
ALTER TABLE public.user_invites ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

-- 4. Seed default roles + permissions and migrate existing profiles
DO $$
DECLARE
  t_id        uuid;
  r_admin     uuid;
  r_manager   uuid;
  r_operator  uuid;
  r_viewer    uuid;
BEGIN
  FOR t_id IN SELECT id FROM public.tenants LOOP

    INSERT INTO public.roles (tenant_id, name, description, is_system, sort_order) VALUES
      (t_id, 'Admin',    'Full access including user management and audit log', true, 1),
      (t_id, 'Manager',  'Can edit items, suppliers, customers; manage settings', true, 2),
      (t_id, 'Operator', 'Can enter production data, stocktakes and dispatch', true, 3),
      (t_id, 'Viewer',   'Read-only access to all data', true, 4)
    ON CONFLICT (tenant_id, name) DO NOTHING;

    SELECT id INTO r_admin    FROM public.roles WHERE tenant_id = t_id AND name = 'Admin';
    SELECT id INTO r_manager  FROM public.roles WHERE tenant_id = t_id AND name = 'Manager';
    SELECT id INTO r_operator FROM public.roles WHERE tenant_id = t_id AND name = 'Operator';
    SELECT id INTO r_viewer   FROM public.roles WHERE tenant_id = t_id AND name = 'Viewer';

    INSERT INTO public.role_permissions (role_id, section, access) VALUES
      (r_admin,    'items',             'write'),
      (r_manager,  'items',             'write'),
      (r_operator, 'items',             'read'),
      (r_viewer,   'items',             'read'),

      (r_admin,    'boms',              'write'),
      (r_manager,  'boms',              'write'),
      (r_operator, 'boms',              'read'),
      (r_viewer,   'boms',              'read'),

      (r_admin,    'production_orders', 'write'),
      (r_manager,  'production_orders', 'write'),
      (r_operator, 'production_orders', 'write'),
      (r_viewer,   'production_orders', 'read'),

      (r_admin,    'purchase_orders',   'write'),
      (r_manager,  'purchase_orders',   'write'),
      (r_operator, 'purchase_orders',   'none'),
      (r_viewer,   'purchase_orders',   'read'),

      (r_admin,    'stocktakes',        'write'),
      (r_manager,  'stocktakes',        'write'),
      (r_operator, 'stocktakes',        'write'),
      (r_viewer,   'stocktakes',        'read'),

      (r_admin,    'customer_orders',   'write'),
      (r_manager,  'customer_orders',   'write'),
      (r_operator, 'customer_orders',   'none'),
      (r_viewer,   'customer_orders',   'read'),

      (r_admin,    'dispatch',          'write'),
      (r_manager,  'dispatch',          'write'),
      (r_operator, 'dispatch',          'write'),
      (r_viewer,   'dispatch',          'read'),

      (r_admin,    'invoices',          'write'),
      (r_manager,  'invoices',          'read'),
      (r_operator, 'invoices',          'none'),
      (r_viewer,   'invoices',          'read'),

      (r_admin,    'suppliers',         'write'),
      (r_manager,  'suppliers',         'write'),
      (r_operator, 'suppliers',         'none'),
      (r_viewer,   'suppliers',         'read'),

      (r_admin,    'customers',         'write'),
      (r_manager,  'customers',         'write'),
      (r_operator, 'customers',         'none'),
      (r_viewer,   'customers',         'read'),

      (r_admin,    'reports',           'write'),
      (r_manager,  'reports',           'read'),
      (r_operator, 'reports',           'read'),
      (r_viewer,   'reports',           'read'),

      (r_admin,    'settings',          'write'),
      (r_manager,  'settings',          'read'),
      (r_operator, 'settings',          'none'),
      (r_viewer,   'settings',          'none'),

      (r_admin,    'settings_users',    'write'),
      (r_manager,  'settings_users',    'none'),
      (r_operator, 'settings_users',    'none'),
      (r_viewer,   'settings_users',    'none'),

      (r_admin,    'settings_roles',    'write'),
      (r_manager,  'settings_roles',    'none'),
      (r_operator, 'settings_roles',    'none'),
      (r_viewer,   'settings_roles',    'none'),

      (r_admin,    'audit_log',         'write'),
      (r_manager,  'audit_log',         'read'),
      (r_operator, 'audit_log',         'none'),
      (r_viewer,   'audit_log',         'none')
    ON CONFLICT (role_id, section) DO NOTHING;

    UPDATE public.profiles SET role_id = r_admin
      WHERE tenant_id = t_id AND role IN ('super_admin','admin') AND role_id IS NULL;
    UPDATE public.profiles SET role_id = r_manager
      WHERE tenant_id = t_id AND role IN ('manager','planner') AND role_id IS NULL;
    UPDATE public.profiles SET role_id = r_operator
      WHERE tenant_id = t_id AND role IN ('operator','production','filling','cooking','packing','dispatch') AND role_id IS NULL;
    UPDATE public.profiles SET role_id = r_viewer
      WHERE tenant_id = t_id AND role = 'viewer' AND role_id IS NULL;

    UPDATE public.user_invites SET role_id = r_admin
      WHERE tenant_id = t_id AND role IN ('super_admin','admin') AND role_id IS NULL;
    UPDATE public.user_invites SET role_id = r_manager
      WHERE tenant_id = t_id AND role IN ('manager','planner') AND role_id IS NULL;
    UPDATE public.user_invites SET role_id = r_operator
      WHERE tenant_id = t_id AND role IN ('operator','production','filling','cooking','packing','dispatch') AND role_id IS NULL;
    UPDATE public.user_invites SET role_id = r_viewer
      WHERE tenant_id = t_id AND role = 'viewer' AND role_id IS NULL;

  END LOOP;
END $$;

-- 5. Helper: check if current user has at least a given access level for a section
CREATE OR REPLACE FUNCTION public.has_permission(p_section text, p_access text)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.role_permissions rp ON rp.role_id = p.role_id
    WHERE p.id = auth.uid()
      AND rp.section = p_section
      AND CASE p_access
            WHEN 'read'  THEN rp.access IN ('read','write')
            WHEN 'write' THEN rp.access = 'write'
            ELSE false
          END
  );
$$;
