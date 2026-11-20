-- ArticL Phase 4: b-roll and video render.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in (
    'awaiting_upload', 'uploaded', 'extracting', 'extracted',
    'proposing', 'awaiting_selection', 'points_selected',
    'scripting', 'voicing', 'voiced',
    'fetching_broll', 'rendering', 'rendered',
    'failed'
  ));

-- broll: [{ segment, query, imagePath, pixabayId, user, pageURL }]
alter table public.jobs add column if not exists broll           jsonb;
alter table public.jobs add column if not exists render_progress integer;
alter table public.jobs add column if not exists video_path      text;

-- Pixabay asks API results to be cached for 24 hours. Server-only (RLS on, no policies).
create table if not exists public.pixabay_cache (
  query      text primary key,
  hits       jsonb not null,
  fetched_at timestamptz not null default now()
);
alter table public.pixabay_cache enable row level security;
