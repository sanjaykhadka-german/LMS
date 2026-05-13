-- Allow managers and above to delete DRAFT BOMs only
-- (is_active = false AND approved_at is null = Draft status)
create policy "bom_headers_delete" on bom_headers
  for delete using (
    tenant_id = my_tenant_id()
    and is_manager_or_above()
    and is_active = false
    and approved_at is null
  );

-- bom_lines delete is handled by ON DELETE CASCADE from bom_headers,
-- but also add an explicit policy for direct line deletion (edit form)
create policy "bom_lines_delete_draft" on bom_lines
  for delete using (
    exists (
      select 1 from bom_headers
      where id = bom_lines.bom_header_id
        and tenant_id = my_tenant_id()
        and is_manager_or_above()
    )
  );
