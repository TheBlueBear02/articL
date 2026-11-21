-- ArticL: what each step used from OpenAI (tokens, voice characters, transcribed seconds), so the
-- job page can show usage and an estimated cost per step.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- usage: { "<step>:<part>": {...} }, e.g. "points:1", "script:1", "voice:1:3", "footage:prefetch:1".
-- Each part is written by one step only; the page adds up the parts of each step.
alter table public.jobs add column if not exists usage jsonb;

-- Add or replace one part atomically. Steps run in parallel (voice parts, footage prefetch), and
-- a read-modify-write from the app could lose one of two updates; this can't.
create or replace function public.add_job_usage(job_id uuid, part text, value jsonb)
returns void
language sql
as $$
  update public.jobs
  set usage = coalesce(usage, '{}'::jsonb) || jsonb_build_object(part, value)
  where id = job_id;
$$;

-- Only the server (secret key) records usage.
revoke execute on function public.add_job_usage(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.add_job_usage(uuid, text, jsonb) to service_role;
