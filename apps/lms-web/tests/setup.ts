// Required env so module-level code in lib/stripe.ts and @tracey/db can load
// without throwing during import-time of unit-tested modules.
process.env.STRIPE_SECRET_KEY ??= "sk_test_dummy";
process.env.DATABASE_URL ??= "postgres://test:test@localhost:5432/test";
process.env.NEXT_PUBLIC_APP_URL ??= "http://localhost:4000";
