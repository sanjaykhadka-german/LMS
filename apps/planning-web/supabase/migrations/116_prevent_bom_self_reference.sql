-- Block any bom_lines row whose component is the same item as the parent
-- of its bom_header. Self-references created infinite cascade loops in the
-- MRP explosion (capped only by recursion depth), inflating raw-material
-- requirements by 10× to 80×. The two known offenders (5001.56.5.10 and
-- W-5001.56.5) were fixed manually; this trigger guarantees no new ones.

CREATE OR REPLACE FUNCTION trg_bom_lines_prevent_self_reference()
RETURNS trigger
LANGUAGE plpgsql
AS $fn$
DECLARE
  v_parent_item_id uuid;
  v_parent_code    text;
BEGIN
  SELECT b.item_id, i.code
    INTO v_parent_item_id, v_parent_code
    FROM bom_headers b
    JOIN items i ON i.id = b.item_id
   WHERE b.id = NEW.bom_header_id;

  IF v_parent_item_id IS NOT NULL AND NEW.component_item_id = v_parent_item_id THEN
    RAISE EXCEPTION
      'BOM self-reference is not allowed: item % cannot appear in its own BOM. '
      'If this is a refining/aging step that consumes a previous version of itself, '
      'create a separate ''raw'' or ''pre'' item code (e.g. RAW-% or %-PRE) and reference that instead.',
      v_parent_code, v_parent_code, v_parent_code;
  END IF;

  RETURN NEW;
END
$fn$;

DROP TRIGGER IF EXISTS bom_lines_no_self_reference ON bom_lines;
CREATE TRIGGER bom_lines_no_self_reference
BEFORE INSERT OR UPDATE OF component_item_id, bom_header_id ON bom_lines
FOR EACH ROW
EXECUTE FUNCTION trg_bom_lines_prevent_self_reference();

COMMENT ON FUNCTION trg_bom_lines_prevent_self_reference IS
  'Defensive guard against the bug class that broke 9004 / 5001 cascades on 2026-05-10.';
