-- ArticL: where and when the study took place and who it covered, so the video can say it.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- study_setting: { "place": {"value", "evidence"}, "period": {...}, "sample": {...} }
-- Each fact is verified against the article text; missing facts are left out.
alter table public.jobs add column if not exists study_setting jsonb;
