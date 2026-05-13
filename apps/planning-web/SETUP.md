# German Butchery Planning App — Setup Guide

A production planning web app for German Butchery, built with Next.js 16 + Supabase + Vercel.

## What's included

- **Production Schedules** — weekly drag-and-drop style planning grid (Mon–Sun), mark items as completed, track planned vs actual quantities
- **Products & Recipes** — finished product catalogue with full spec sheets, recipe management with ingredient quantities and percentages
- **Raw Materials** — raw material catalogue with specifications (origin, fat, protein, moisture, pH, micro, allergens, storage, shelf life)
- **Inventory** — stock levels for raw materials and finished products, log receipts/production use/wastage/dispatch
- **Reports & Export** — download raw material specs, finished product specs, inventory, and production schedules as CSV
- **Role-based access** — admin / manager / staff roles with different permissions

---

## Setup (first time only, ~45 minutes)

### Step 1 — Create a Supabase project

1. Go to [supabase.com](https://supabase.com) and sign in / create a free account
2. Click **New project** and give it a name (e.g. "german-butchery-planning")
3. Choose a database password and save it somewhere safe
4. Once the project is ready, go to **Settings → API** and copy:
   - **Project URL** (looks like `https://xxxxx.supabase.co`)
   - **anon / public key**
   - **service_role key** (keep this secret — never commit it)

### Step 2 — Run the database migration

1. In your Supabase project, go to **SQL Editor**
2. Open the file `supabase/migrations/001_initial.sql` from this project
3. Paste the entire contents into the SQL editor and click **Run**
4. You should see the tables created in the **Table Editor**

The migration includes 10 sample raw materials and 5 sample products to get you started.

### Step 3 — Set up your environment variables

1. Copy `.env.example` to `.env.local` in the project root:
   ```
   cp .env.example .env.local
   ```
2. Fill in the three Supabase values from Step 1

### Step 4 — Install dependencies and run locally

Make sure you have Node.js 18+ installed, then:

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) — you'll be redirected to the login page.

### Step 5 — Create your first user

In the Supabase dashboard:

1. Go to **Authentication → Users**
2. Click **Invite user** and enter your email (e.g. `tino.dees@germanbutchery.com.au`)
3. Check your email and set a password
4. To make yourself an admin: go to **Table Editor → profiles**, find your row, and change `role` from `staff` to `admin`

### Step 6 — Deploy to Vercel (optional but recommended)

1. Push this project to a GitHub repository
2. Go to [vercel.com](https://vercel.com) → **Add New Project** → import your GitHub repo
3. In the project settings, add the three environment variables from `.env.local`
4. Set `NEXT_PUBLIC_SITE_URL` to your Vercel URL (e.g. `https://german-butchery-planning.vercel.app`)
5. In Supabase → **Authentication → URL Configuration**, add your Vercel URL to **Redirect URLs**
6. Deploy — Vercel will auto-deploy on every push to `main`

---

## Importing existing data

When you're happy with the app and ready to load your existing data:

1. Export your existing spreadsheets to CSV
2. Use the Supabase **Table Editor → Import** to bulk-upload rows into each table
3. Or use the Reports page to see the expected CSV format for each table

Key tables to populate:
- `raw_materials` — your raw material list with specs
- `products` — your finished product catalogue
- `recipe_ingredients` — links products to raw materials with quantities

---

## User roles

| Role    | Can view | Can create/edit | Can delete |
|---------|----------|-----------------|------------|
| staff   | ✓        | Schedules only  | ✗          |
| manager | ✓        | Everything      | ✗          |
| admin   | ✓        | Everything      | ✓          |

Change a user's role in Supabase → Table Editor → `profiles` → edit the `role` column.

---

## Project structure

```
src/app/(app)/          All authenticated pages
  dashboard/            Overview & stats
  schedules/            Production schedule list + weekly grid editor
  products/             Finished product catalogue + recipes
  raw-materials/        Raw material catalogue + specs
  inventory/            Stock levels + transaction log
  reports/              CSV export for all data

src/app/auth/           Login page + auth callback
src/lib/supabase/       Database clients (server, client, admin)
src/components/         Sidebar navigation
supabase/migrations/    Database schema SQL
```
