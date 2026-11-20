  -- ArticL Phase 1: one row per uploaded article, plus a private bucket for the PDFs.
  -- Run this once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.
  
  create table if not exists public.jobs (
    id                uuid primary key default gen_random_uuid(),
    status            text not null default 'awaiting_upload'
                      check (status in ('awaiting_upload', 'uploaded', 'extracting', 'extracted', 'failed')),
    original_filename text not null,
    file_path         text not null,
    page_count        integer,
    word_count        integer,
    extracted_text    text,
    error             text,
    created_at        timestamptz not null default now(),
    updated_at        timestamptz not null default now()
  );
  
  create or replace function public.set_updated_at() returns trigger
  language plpgsql as $$
  begin
    new.updated_at = now();
    return new;
  end;
  $$;
  
  drop trigger if exists jobs_set_updated_at on public.jobs;
  create trigger jobs_set_updated_at
    before update on public.jobs
    for each row execute function public.set_updated_at();
  
  -- All writes go through the server with the secret key (which bypasses RLS).
  alter table public.jobs enable row level security;
  
  -- PROTOTYPE ONLY: lets the browser read job rows so the page can follow status
  -- live via Realtime. Anyone with the publishable key can read every job.
  -- Replace with an owner-based policy (auth.uid() = user_id) when sign-in is added.
  drop policy if exists "prototype: anyone can read jobs" on public.jobs;
  create policy "prototype: anyone can read jobs"
    on public.jobs for select
    to anon, authenticated
    using (true);
  
  -- Send row changes to Realtime subscribers.
  do $$
  begin
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'jobs'
    ) then
      alter publication supabase_realtime add table public.jobs;
    end if;
  end $$;
  
  -- Private bucket for article PDFs (20 MB max, PDFs only). No storage policies are
  -- needed: uploads use one-time signed URLs and downloads use the secret key.
  insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
  values ('articles', 'articles', false, 20971520, array['application/pdf'])
  on conflict (id) do nothing;
