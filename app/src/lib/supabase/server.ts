import "server-only";
import { createClient } from "@supabase/supabase-js";

// Server-side client with the secret key: bypasses RLS. Never import this from client code.
export function supabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) throw new Error("Supabase env vars are missing (see app/.env.example)");
  return createClient(url, key, { auth: { persistSession: false } });
}

export const ARTICLES_BUCKET = "articles";
