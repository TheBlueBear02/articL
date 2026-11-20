-- ArticL: record when each job enters each status, for the timing panel on the job page.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- stage_times: { "<status>": "<timestamp it was first entered>", ... }
alter table public.jobs add column if not exists stage_times jsonb not null default '{}'::jsonb;

-- Done in the database so every writer (Inngest jobs and API routes) is timed the same way.
-- The FIRST time a status is entered is kept, so retries and re-renders don't move a step's start.
create or replace function public.jobs_record_stage_time() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' then
    new.stage_times := coalesce(new.stage_times, '{}'::jsonb)
      || jsonb_build_object('created', clock_timestamp(), new.status, clock_timestamp());
  elsif new.status is distinct from old.status and not (coalesce(old.stage_times, '{}'::jsonb) ? new.status) then
    new.stage_times := coalesce(old.stage_times, '{}'::jsonb) || jsonb_build_object(new.status, clock_timestamp());
  else
    new.stage_times := coalesce(old.stage_times, '{}'::jsonb);
  end if;
  return new;
end;
$$;

drop trigger if exists jobs_stage_times on public.jobs;
create trigger jobs_stage_times
  before insert or update on public.jobs
  for each row execute function public.jobs_record_stage_time();
