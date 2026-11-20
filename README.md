# ArticL

Turns an article PDF into a short, Reels-style vertical video. The user picks the key points, and AI handles the script, voice, visuals and render.

## Status
- **Phase 1, upload + extract:** done. The PDF goes straight to Supabase Storage, and an Inngest job extracts the text.
- **Phase 2, candidate points + selection:** done. The AI proposes points and pre-selects the best 5 for the video. Each point is checked against the article, and the user can adjust the picks or just continue.
- **Phase 3, script + voice:** done. The AI writes a hook, one beat per point and a closing line, and checks them against the points. Each segment is recorded with OpenAI TTS and timed word by word with Whisper. The result is at most 60 seconds and costs about $0.02 per video.
- **Phase 4, b-roll + render:** done. The app picks one Pixabay portrait photo per segment, builds a HyperFrames composition (the spike's caption style, trailing silence trimmed) and renders the MP4 **locally**. A ~52 s reel takes ~3.5 minutes to render, about 4.5 minutes from Continue to finished video. The page shows the video, a download button and Pixabay credits.
- **Pasted text:** besides uploading a PDF, you can paste article text, with an optional title, in the "Paste text" tab (40–30,000 words). It joins the same pipeline from the points step on. Pasted-text jobs have an empty `file_path`.
- **Job pages + My videos:** every job has its own page (`/jobs/<id>`) that survives a refresh and can be bookmarked. The home page lists the 20 most recent jobs with their status. Finished videos are stored in the private `media` bucket at `<jobId>/video.mp4`.
- **Reel structure (from `product-documents/Short-Video-Structure-Research.md`):** the script opens with a proven hook formula and an on-screen hook title, teases the strongest point (the "payoff") and saves it for the last beat, re-hooks halfway, and ends on a line that runs into the hook. The video ends on the first shot's media, timed to land on the opening frame, so the replay loops seamlessly (no freeze or end card). A source credit ("Surname & Surname, 2021") stays on screen if the names and year are found in the article. A post caption with a share prompt and hashtags is shown under the video, ready to copy.
- **Add-ons:** chosen on the points screen, both off by default.
  - **Background music:** Calm / Upbeat / Dramatic. Tracks come from `library/music/<mood>/` and play at about -18 dB under the voice. The music's tail is timed so it loops with the video.
  - **Split screen:** the story footage takes the top half. The bottom half shows **gameplay** from `library/gameplay/` (your own recordings, played continuously) or **satisfying clips** from Pixabay (marble run, pottery wheel, skateboarding and similar, cut every ~12 s). The bottom half loops seamlessly too.
  - Choices with no files in the library are greyed out.
- **Written for the general public:** after watching, the viewer should know the study's main findings and where, when and with whom it was done. While proposing points, the AI also pulls the study's **place, time period and sample** from the whole article, each with a sentence quoted from it. They are checked against the text and saved in `study_setting`. The first beat opens with them; facts that can't be verified are left out.
- **Timing:** the job page shows how long each step took, ticking live while the job runs: upload, reading the PDF, finding points, your choice (not counted), writing the script, recording the voice, finding footage, render + save. My videos shows "made in …" for each video. A database trigger records the first time a job enters each status (`stage_times`). A typical run takes about 6 minutes, about 4 of them rendering.
- Phase 5, end-to-end testing on real articles: next. HyperFrames Cloud rendering is needed before deploying, because Vercel can't render locally.

## Layout
- `app/`: Next.js web app (upload page, API routes, Inngest jobs)
- `supabase/migrations/`: database + storage setup (run each file once, in order, in the Supabase SQL Editor)
- `spike/`: HyperFrames proof of concept (one hardcoded beat), plus `scripts/` to regenerate its assets

## Setup
1. **Supabase:** create a project. In **SQL Editor**, run the files in `supabase/migrations/` in order (`0001` → `0007`).
   - `0006_stage_times.sql` adds the step timings (column + trigger).
   - `0007_study_setting.sql` adds the study's place, period and sample.
   The app keeps working without these two, just without timings or the setting.
   For the add-ons, upload files in **Storage → library**:
   - `music/calm/`, `music/upbeat/`, `music/dramatic/`: royalty-free tracks of 60 s or more. Name them `Title -- Artist.mp3` to get a credit.
   - `gameplay/`: your own gameplay recordings as MP4, under 50 MB each (the Supabase free-tier limit).
   Local rendering also needs **FFmpeg** (`winget install --id Gyan.FFmpeg -e`) and Chrome. The app's startup script finds a winget FFmpeg install even if it isn't on PATH yet.
2. **Keys:** copy `.env.example` to `.env` (repo root) and fill it in. The app reads this file through `app/scripts/with-root-env.mjs`.
   - OpenAI key (TTS, Whisper, and points via `OPENAI_MODEL`, default `gpt-5-mini`)
   - Supabase project URL, publishable key and secret key (Project Settings → API Keys)
   - Pixabay key (b-roll, used by the spike scripts)
3. **Run** these in two terminals, both from `app/`:
   ```powershell
   npm run dev
   ```
   ```powershell
   npm run inngest
   ```
4. Open http://localhost:3000 and upload a PDF. The Inngest dashboard at http://localhost:8288 shows each job run.
   **Both terminals must be running.** Without `npm run inngest`, uploads fail with "The background job runner isn't reachable".

## How points are checked
Each proposed point must include one sentence copied from the article. The server keeps a point only if:
- that sentence appears in the extracted text (punctuation and hyphenation are ignored; words and numbers must match), and
- every number in the point's wording also appears in that sentence.

This catches invented or rounded figures and paraphrased "quotes". The code is in `app/src/lib/points.ts`.

The study setting (place, period, sample) is checked the same way. Each quoted sentence must be in the article (several sentences joined with "..." are checked piece by piece). Every number and capitalized name in the value must appear in the quote, so a wrong year or country is dropped rather than shown.

The script is checked the same way (`app/src/lib/script-checks.ts`). The model gets up to 3 attempts, each told what was wrong with the last. A script is rewritten if:
- a beat uses a number that isn't in its own point or the study setting;
- the hook, closing, on-screen hook title or post caption uses a number that isn't in any chosen point or the study setting. A year is allowed only from the verified setting: years in the article's opening are mostly citations of other papers. A count is allowed if the article says it with the same noun ("250 villages");
- numbers are spelled out, ranges are written with a dash, symbols are used, or a point id is read aloud;
- the hook is a question, uses filler ("the answer might surprise you"), or the closing repeats the hook title. Any of these would break the loop, where the closing's last words run into the hook;
- the script talks about itself ("in this video", "payoff", "loop");
- a chosen point is missing or repeated, or the hook title is over 7 words.

Some problems only ask for a rewrite. If they're still there on the last attempt, the script is used anyway:
- research jargon ("randomized", "statistically significant", "standard deviation" and similar);
- a hook that gives away the payoff's number;
- a script under 80% of the word budget, or up to 15% over it. If the recorded voice runs past 60 s, the script is redrafted shorter.

Slips with one right answer are fixed automatically instead of rewritten:
- "7.5 percent" → "7.5 percentage points" when the article says points;
- "six weeks" → "6 weeks";
- "referenda" → "referendums";
- a missing apostrophe ("headmen s" → "headmen's");
- a separate setting beat merged into the first beat;
- the payoff beat moved to the end.

The source credit is never a reason to rewrite. If its surnames aren't in the first lines of the article, it is left out. The year always comes from the article's own publication line, never from the model.

## Known prototype limits
- Rendering runs on the machine running `npm run dev` (project in the OS temp folder, `articl-render/<jobId>`). It won't work on Vercel until HyperFrames Cloud is wired in. HyperFrames renders one video at a time per machine, so a second video waits for the first to finish.
- B-roll photos are matched only by the script's 2–4 word search terms, so some fit loosely.
- No sign-in yet. Anyone holding the publishable key can read every job row (see the policy note in `0001_jobs.sql`).
- The checks verify numbers and setting facts, not framing. In testing, a hook said "investing just once" for a study where people invested over 6 weeks.
- Scanned (image-only) PDFs fail with a clear message, because there's no OCR yet.
- Points use `gpt-5-mini` (~$0.007 per article) during the prototype. `gpt-5-nano` is about 5x cheaper but gave only 5 to 10 verified points per run; revisit after the prototype.
