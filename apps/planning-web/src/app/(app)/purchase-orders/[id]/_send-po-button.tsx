"use client";

/**
 * Tiny client wrapper that owns the SendPoModal open/close state.
 * The PO detail page is a server component, so this lives separately so
 * server-rendered defaults (To/Cc/subject/body) can flow in as props
 * without dragging the modal into the server tree.
 */

import { useState } from "react";
import SendPoModal from "./_send-po-modal";

export default function SendPoButton(props: {
  poId: string;
  poNumber: string;
  supplierName: string;
  defaultTo: string;
  defaultCc: string;
  defaultSubject: string;
  defaultBody: string;
  hasContacts: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="btn-primary"
        style={{ fontSize: "0.8125rem" }}
        title={
          props.hasContacts
            ? "Send this PO to the supplier via email with PDF attached"
            : "No supplier contact email yet — set one before sending. Click to open the send dialog and add a recipient."
        }
      >
        📧 Send to supplier
      </button>
      {open && (
        <SendPoModal
          poId={props.poId}
          poNumber={props.poNumber}
          supplierName={props.supplierName}
          defaultTo={props.defaultTo}
          defaultCc={props.defaultCc}
          defaultSubject={props.defaultSubject}
          defaultBody={props.defaultBody}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}
