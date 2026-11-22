-- ArticL: the new mobile create flow (/create). Jobs made there wait for the user at four points:
-- audience, findings, hook and script review. Old jobs (flow null) keep the original pipeline.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

alter table public.jobs drop constraint if exists jobs_status_check;
alter table public.jobs add constraint jobs_status_check
  check (status in (
    'awaiting_upload', 'uploaded', 'extracting', 'extracted',
    'awaiting_audience',
    'proposing', 'awaiting_selection', 'awaiting_findings', 'awaiting_hook',
    'points_selected',
    'scripting', 'voicing', 'voiced', 'awaiting_review',
    'fetching_broll', 'rendering', 'rendered',
    'failed'
  ));

-- 'create' = made in the new flow; null = the original job page.
alter table public.jobs add column if not exists flow                text;
-- The new flow asks for the audience after the upload; points wait until it's chosen.
alter table public.jobs add column if not exists audience_confirmed  boolean not null default false;
-- { title, authors: [..], year?, doi? } read from the first page.
alter table public.jobs add column if not exists paper_meta          jsonb;
-- The finding the hook teases and the video builds to (its beat comes last).
alter table public.jobs add column if not exists lead_point_id       text;
-- { leadId, pointIds: [..], items: [{ type, hook, hookTitle, pointId, quote }] }, or null while generating.
alter table public.jobs add column if not exists hooks               jsonb;
-- { type, hook, hookTitle, custom? }
alter table public.jobs add column if not exists chosen_hook         jsonb;
-- { name, role, university } for the post text.
alter table public.jobs add column if not exists author_info         jsonb;
alter table public.jobs add column if not exists addons_confirmed_at timestamptz;
-- [{ segment, problem, softer, state: 'open' | 'accepted' | 'kept' }] from the overclaim check.
alter table public.jobs add column if not exists script_flags        jsonb;
-- Storage paths of one small frame per script part, made when rendering starts.
alter table public.jobs add column if not exists block_thumbs        jsonb;
-- Which script part's frame becomes the cover (thumb.jpg).
alter table public.jobs add column if not exists cover_segment       integer;
-- { instagram, tiktok, youtube } as edited by the user.
alter table public.jobs add column if not exists post_texts          jsonb;

-- Product analytics: hook type chosen, shares, downloads, repeat use, feedback.
-- Server-only (RLS on, no policies): written through /api/jobs/<id>/events.
create table if not exists public.events (
  id         bigint generated always as identity primary key,
  job_id     uuid references public.jobs(id) on delete set null,
  name       text not null,
  data       jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.events enable row level security;
create index if not exists events_name_created on public.events (name, created_at);
