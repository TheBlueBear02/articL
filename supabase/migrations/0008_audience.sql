-- ArticL: who the video is for. It changes which points are suggested, how the script is told,
-- the video's length and its on-screen section labels.
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- social: short hooky reel (the original type). student: the question, how it was tested, what was found.
-- academic and kids are planned; the check allows them so they need no new migration later.
alter table public.jobs add column if not exists audience text not null default 'social'
  check (audience in ('social', 'student', 'academic', 'kids'));
