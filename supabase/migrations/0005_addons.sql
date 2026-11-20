-- ArticL add-ons: background music and a split-screen bottom half (gameplay or "satisfying" clips).
-- Run once in the Supabase dashboard: SQL Editor -> New query -> paste -> Run.

-- addons: what the user chose, e.g. { "music": "upbeat", "split": "satisfying" }
alter table public.jobs add column if not exists addons       jsonb not null default '{}'::jsonb;
-- addon_media: what was picked for those choices (library paths, Pixabay clips), set before rendering.
alter table public.jobs add column if not exists addon_media  jsonb;

-- Private library of files you add by hand in Storage -> library:
--   music/calm/, music/upbeat/, music/dramatic/  royalty-free tracks (mp3, ideally 60 s or longer)
--   gameplay/                                    your own gameplay recordings (mp4, under 50 MB each)
-- Name music files "Title -- Artist.mp3" to get a credit under the video.
insert into storage.buckets (id, name, public)
values ('library', 'library', false)
on conflict (id) do nothing;
