-- ArticL Phase 3: script, voiceover and word timestamps.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in (
    'awaiting_upload', 'uploaded', 'extracting', 'extracted',
    'proposing', 'awaiting_selection', 'points_selected',
    'scripting', 'voicing', 'voiced',
    'failed'
  ));

-- script:   { hook, beats: [{ pointId, text, broll }], closing, hookBroll, closingBroll }
-- segments: [{ kind: 'hook'|'beat'|'closing', pointId?, text, broll, audioPath, duration, words: [{word,start,end}] }]
alter table public.jobs add column if not exists script           jsonb;
alter table public.jobs add column if not exists segments         jsonb;
alter table public.jobs add column if not exists total_duration_s numeric;

-- Private bucket for generated media (voiceover now; b-roll and renders in Phase 4).
-- The browser plays files through short-lived signed URLs created by the server.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', false, 104857600, array['audio/mpeg', 'image/jpeg', 'image/png', 'video/mp4'])
on conflict (id) do nothing;
