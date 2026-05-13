"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

type CustomerRow = {
  id: string; code: string; name: string;
  contact_name: string | null; email: string | null; phone: string | null;
  city: string | null; state: string | null;
  price_group: { name: string } | null;
  currency: string; is_active: boolean;
};

export default function CustomersTable({ customers }: { customers: CustomerRow[] }) {
  const router = useRouter();
  return (
    <table className="data-table">
      <thead>
        <tr>
          <th>Code</th><th>Name</th><th>Contact</th><th>Email</th>
          <th>Location</th><th>Price Group</th><th>Currency</th><th>Status</th><th></th>
        </tr>
      </thead>
      <tbody>
        {customers.length === 0 && (
          <tr>
            <td colSpan={9} style={{ padding: "2rem", textAlign: "center", color: "#78716c" }}>
              No customers yet.{" "}
              <Link href="/customers/new" style={{ color: "#b91c1c" }}>Add your first customer →</Link>
            </td>
          </tr>
        )}
        {customers.map(c => (
          <tr key={c.id} onClick={() => router.push(`/customers/${c.id}`)} style={{ cursor: "pointer" }}>
            <td style={{ fontFamily: "monospace", fontWeight: 600 }}>{c.code}</td>
            <td style={{ fontWeight: 500 }}>{c.name}</td>
            <td style={{ color: "#78716c" }}>{c.contact_name ?? "—"}</td>
            <td>
              {c.email
                ? <a href={`mailto:${c.email}`} onClick={e => e.stopPropagation()} style={{ color: "#b91c1c", textDecoration: "none" }}>{c.email}</a>
                : <span style={{ color: "#a8a29e" }}>—</span>}
            </td>
            <td style={{ color: "#78716c" }}>{[c.city, c.state].filter(Boolean).join(", ") || "—"}</td>
            <td>
              {c.price_group
                ? <span className="badge badge-blue" style={{ fontSize: "0.6875rem" }}>{c.price_group.name}</span>
                : <span style={{ color: "#a8a29e" }}>—</span>}
            </td>
            <td style={{ fontFamily: "monospace", color: "#78716c" }}>{c.currency}</td>
            <td>
              {c.is_active
                ? <span className="badge badge-green" style={{ fontSize: "0.6875rem" }}>Active</span>
                : <span className="badge badge-gray"  style={{ fontSize: "0.6875rem" }}>Inactive</span>}
            </td>
            <td>
              <Link href={`/customers/${c.id}`} className="btn-secondary" style={{ fontSize: "0.75rem", padding: "0.25rem 0.625rem" }} onClick={e => e.stopPropagation()}>View</Link>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
