-- The supplier-link modal labels the supplier code field "optional" but the
-- column was NOT NULL, so saves with a blank code failed with a constraint
-- violation. Relax the constraint — operators creating a brand-new supplier
-- inline rarely have a code handy at that moment. They can fill it in later
-- via the suppliers settings page.
ALTER TABLE suppliers ALTER COLUMN code DROP NOT NULL;
