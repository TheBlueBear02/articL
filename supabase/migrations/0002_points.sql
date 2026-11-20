-- ArticL Phase 2: AI-proposed candidate points and the user's selection.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in (
    'awaiting_upload', 'uploaded', 'extracting', 'extracted',
    'proposing', 'awaiting_selection', 'points_selected',
    'failed'
  ));

-- candidate_points: [{ id, type: 'stat'|'quote'|'claim', text, evidence }]
alter table public.jobs add column if not exists candidate_points   jsonb;
alter table public.jobs add column if not exists selected_point_ids text[];
alter table public.jobs add column if not exists selected_at        timestamptz;
