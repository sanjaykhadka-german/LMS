// ─── Tracey Offline — IndexedDB helpers ──────────────────────────────────────
// Wraps IndexedDB in a promise-based API.
// Stores queued mutations so they survive page reloads while offline.
// ─────────────────────────────────────────────────────────────────────────────

const DB_NAME    = "tracey-offline";
const DB_VERSION = 1;
const STORE_NAME = "queue";

export type QueueStatus = "pending" | "syncing" | "done" | "failed";

export interface QueueEntry {
  id: string;            // uuid v4
  createdAt: string;     // ISO timestamp
  action: string;        // server action name key
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  args: any[];           // serialised arguments
  status: QueueStatus;
  error?: string;
  attempts: number;
}

// ── Open / lazy-init ──────────────────────────────────────────────────────────

let _db: IDBDatabase | null = null;

function openDb(): Promise<IDBDatabase> {
  if (_db) return Promise.resolve(_db);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("status", "status");
        store.createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => { _db = req.result; resolve(_db!); };
    req.onerror   = () => reject(req.error);
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tx(db: IDBDatabase, mode: IDBTransactionMode) {
  return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
}

function promisify<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((res, rej) => {
    req.onsuccess = () => res(req.result);
    req.onerror   = () => rej(req.error);
  });
}

// ── Public API ─────────────────────────────────────────────────────────────────

/** Add a new mutation to the queue. */
export async function enqueue(action: string, args: unknown[]): Promise<string> {
  const db = await openDb();
  const entry: QueueEntry = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    action,
    args,
    status: "pending",
    attempts: 0,
  };
  await promisify(tx(db, "readwrite").add(entry));
  return entry.id;
}

/** Get all pending entries (oldest first). */
export async function getPending(): Promise<QueueEntry[]> {
  const db = await openDb();
  const all = await promisify<QueueEntry[]>(tx(db, "readonly").getAll());
  return all
    .filter(e => e.status === "pending" || e.status === "syncing")
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Get full queue (all statuses). */
export async function getAll(): Promise<QueueEntry[]> {
  const db = await openDb();
  const all = await promisify<QueueEntry[]>(tx(db, "readonly").getAll());
  return all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Update an entry's status. */
export async function updateEntry(
  id: string,
  updates: Partial<Pick<QueueEntry, "status" | "error" | "attempts">>
): Promise<void> {
  const db = await openDb();
  const store = tx(db, "readwrite");
  const entry = await promisify<QueueEntry>(store.get(id));
  if (!entry) return;
  await promisify(tx(db, "readwrite").put({ ...entry, ...updates }));
}

/** Remove a successfully synced entry. */
export async function remove(id: string): Promise<void> {
  const db = await openDb();
  await promisify(tx(db, "readwrite").delete(id));
}

/** Count pending items. */
export async function pendingCount(): Promise<number> {
  const db = await openDb();
  const all = await promisify<QueueEntry[]>(tx(db, "readonly").getAll());
  return all.filter(e => e.status === "pending").length;
}

/** Clear all completed/failed entries older than 24h. */
export async function pruneOld(): Promise<void> {
  const db = await openDb();
  const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const all = await promisify<QueueEntry[]>(tx(db, "readonly").getAll());
  const toDelete = all.filter(e =>
    (e.status === "done" || e.status === "failed") && e.createdAt < cutoff
  );
  const store = tx(db, "readwrite");
  for (const e of toDelete) store.delete(e.id);
}
