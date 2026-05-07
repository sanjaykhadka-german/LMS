"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Input } from "~/components/ui/input";

interface UserHit {
  id: number;
  name: string;
  email: string;
  url: string;
}
interface ModuleHit {
  id: number;
  title: string;
  url: string;
}
interface SearchResult {
  users: UserHit[];
  modules: ModuleHit[];
}

type Flat = { kind: "user" | "module"; label: string; sub?: string; url: string };

export function GlobalSearch() {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SearchResult>({ users: [], modules: [] });
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reqIdRef = useRef(0);

  // Click-outside closes the dropdown.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  // Debounced fetch.
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = q.trim();
    if (trimmed.length < 2) {
      setResults({ users: [], modules: [] });
      return;
    }
    const myReq = ++reqIdRef.current;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/admin/search?q=${encodeURIComponent(trimmed)}`);
        if (!res.ok) return;
        const data = (await res.json()) as SearchResult;
        // Drop stale responses.
        if (myReq !== reqIdRef.current) return;
        setResults(data);
        setHighlight(0);
        setOpen(true);
      } catch {
        // Network error — silently leave the previous results in place.
      }
    }, 200);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [q]);

  const flat: Flat[] = [
    ...results.users.map<Flat>((u) => ({
      kind: "user",
      label: u.name,
      sub: u.email,
      url: u.url,
    })),
    ...results.modules.map<Flat>((m) => ({ kind: "module", label: m.title, url: m.url })),
  ];

  function navigate(item: Flat) {
    setOpen(false);
    setQ("");
    router.push(item.url);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === "Escape") {
      setOpen(false);
      return;
    }
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = flat[highlight];
      if (item) navigate(item);
    }
  }

  return (
    <div ref={containerRef} className="relative hidden md:block" style={{ minWidth: 240 }}>
      <Input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => {
          if (flat.length > 0) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        placeholder="Search users or modules…"
        aria-label="Search users or modules"
        autoComplete="off"
      />
      {open && flat.length > 0 && (
        <div
          className="absolute left-0 top-full z-50 mt-1 w-full overflow-y-auto rounded-md border border-[color:var(--border)] bg-[color:var(--background)] shadow-lg"
          style={{ maxHeight: "60vh" }}
          role="listbox"
        >
          {results.users.length > 0 && (
            <Section label="Users">
              {results.users.map((u, idx) => (
                <Row
                  key={`u-${u.id}`}
                  active={highlight === idx}
                  onClick={() => navigate(flat[idx]!)}
                  onMouseEnter={() => setHighlight(idx)}
                  primary={u.name}
                  secondary={u.email}
                />
              ))}
            </Section>
          )}
          {results.modules.length > 0 && (
            <Section label="Modules">
              {results.modules.map((m, idx) => {
                const flatIdx = results.users.length + idx;
                return (
                  <Row
                    key={`m-${m.id}`}
                    active={highlight === flatIdx}
                    onClick={() => navigate(flat[flatIdx]!)}
                    onMouseEnter={() => setHighlight(flatIdx)}
                    primary={m.title}
                  />
                );
              })}
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-[color:var(--muted-foreground)]">
        {label}
      </div>
      {children}
    </div>
  );
}

function Row({
  active,
  onClick,
  onMouseEnter,
  primary,
  secondary,
}: {
  active: boolean;
  onClick: () => void;
  onMouseEnter: () => void;
  primary: string;
  secondary?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      role="option"
      aria-selected={active}
      className={
        "block w-full px-3 py-2 text-left text-sm transition-colors " +
        (active
          ? "bg-[color:var(--secondary)] text-[color:var(--foreground)]"
          : "text-[color:var(--foreground)] hover:bg-[color:var(--secondary)]")
      }
    >
      <div className="font-medium">{primary}</div>
      {secondary && (
        <div className="text-xs text-[color:var(--muted-foreground)]">{secondary}</div>
      )}
    </button>
  );
}
