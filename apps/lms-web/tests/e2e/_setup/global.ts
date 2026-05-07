import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Load apps/lms-web/.env.test.local — gitignored, never committed.
function loadDotEnvTestLocal() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const envPath = path.resolve(here, "..", "..", "..", ".env.test.local");
  if (!fs.existsSync(envPath)) return;
  const content = fs.readFileSync(envPath, "utf8");
  for (const raw of content.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (!process.env[key]) process.env[key] = value;
  }
}

export default async function globalSetup() {
  loadDotEnvTestLocal();
  if (!process.env.E2E_EMAIL || !process.env.E2E_PASSWORD) {
    throw new Error(
      "E2E credentials missing. Create apps/lms-web/.env.test.local with " +
        "E2E_EMAIL and E2E_PASSWORD (see .env.test.local.example).",
    );
  }
}
