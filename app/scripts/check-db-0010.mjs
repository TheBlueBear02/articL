// Checks whether migration 0010 (the /create flow) has been run. Read-only.
// Run from app/: node scripts/with-root-env.mjs node scripts/check-db-0010.mjs
import { createClient } from "@supabase/supabase-js";

const key = process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;
const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key);
const cols = await sb.from("jobs").select("flow, hooks, script_flags").limit(1);
console.log(cols.error ? `jobs columns MISSING: ${cols.error.message}` : "jobs columns present");
const ev = await sb.from("events").select("id").limit(1);
console.log(ev.error ? `events table MISSING: ${ev.error.message}` : "events table present");
