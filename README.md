# ArticL

Turns an article PDF into a short, Reels-style vertical video. AI picks the key points and handles the script, voice, visuals and render.

## Status
- **Phase 1, upload + extract:** done. The PDF goes straight to Supabase Storage, and an Inngest job extracts the text.
- **Phase 2, candidate points:** done. The AI proposes points, checks them against the article, and auto-marks the best 5. The job then waits for you to confirm add-ons (Continue via `/api/jobs/<id>/select`) before scripting starts.
- **Phase 3, script + voice:** done. The AI writes a hook, one beat per point and a closing line, and checks them against the points. Each segment is recorded with OpenAI TTS and timed word by word with Whisper. The result is at most 60 seconds and costs about $0.02 per video.
- **Phase 4, b-roll + render:** done. The app picks one Pixabay portrait photo per segment, builds a HyperFrames composition (the spike's caption style, trailing silence trimmed) and renders the MP4 **locally**. A ~52 s reel takes ~3.5 minutes to render, about 4.5 minutes from Continue to finished video. The page shows the video, a download button and Pixabay credits.
- **Pasted text:** besides uploading a PDF, you can paste article text, with an optional title, in the "Paste text" tab (40–30,000 words). It joins the same pipeline from the points step on. Pasted-text jobs have an empty `file_path`.
- **Job pages + My videos:** every job has its own page (`/jobs/<id>`) that survives a refresh and can be bookmarked. The home page shows the 6 latest **finished** videos as reel-shaped cards in a sideways-scrolling row (`/api/reels?limit=6`); running and failed jobs aren't listed there. A card shows `<jobId>/thumb.jpg` if it exists, otherwise the hook title on a plain card. Every new video gets one automatically: local renders take the frame at 1 s with FFmpeg (free, under a second, ~30 KB); cloud renders save HeyGen's thumbnail. Videos from before Nov 21 have none, except the 5 done by hand. Finished videos are stored in the private `media` bucket at `<jobId>/video.mp4`.
- **Reel structure (from `product-documents/Short-Video-Structure-Research.md`):** the script opens with a proven hook formula and an on-screen hook title, teases the strongest point (the "payoff") and saves it for the last beat, re-hooks halfway, and ends on a line that runs into the hook. The video ends on the first shot's media, timed to land on the opening frame, so the replay loops seamlessly (no freeze or end card). A source credit ("Surname & Surname, 2021") stays on screen if the names and year are found in the article.
- **Add-ons:** chosen while the article is read ("While you wait", `POST /api/jobs/<id>/addons`), then confirmed with Continue once points are ready. Pop-up images, sound effects, the map intro and data visuals are on by default; music and split screen are off.
  - **Map intro:** when the verified study place names a country ("250 villages across Afghanistan", "England"), a dark world map covers the footage and zooms into that country the first time the script says the place, by the country's name or the place's own names ("Java", "Delhi"), once the hook title is gone. If the place is never said, it shows at the start of the first beat. The country is filled in, with a pin and a label ("Afghanistan · 2007–2011"). On split screen it covers the bottom half. Shapes are Natural Earth (public domain) via `world-atlas`, drawn as SVG on the server (`app/src/render/map.ts`); the zoom animates the SVG viewBox, so it stays sharp. Country level only; a few names are aliased (England → United Kingdom, US → United States). No country means no map.
  - **Data visuals:** a beat that compares numbers shows an animated chart instead of its single big number, in the same band above the captions. Three kinds: **bars** (2-3 groups on the same measure), **change** (one measure at two times, before → after) and **share** (one percentage as a 10×10 grid). Each bar grows and its value counts up as the number is spoken. The script step proposes the chart (labels, values, unit); `checkChart` in `script-checks.ts` keeps it only if every value is a number written in the point's source sentence (no rounding, no added 0 or baseline, no years as values), every label word is in that sentence (plus "before"/"after" for change charts), the unit matches ("percent" vs "percentage points"), and the beat says every value. Otherwise the chart is dropped and the beat keeps its big-number callout; a chart never causes a rewrite. Bar lengths are drawn to scale from zero. Testing (Nov 21, 5 papers): 2 of 5 papers got a chart; the dropped ones invented a starting 0, mixed two measures, or called percentage points "percent". Most findings are single effect sizes, which stay as a big number.
  - **Sound effects:** a pop when a pop-up photo appears, a ding on each number callout, and a whoosh at most twice per video (when the map appears and when the payoff beat starts). They play well under the voice, at least 0.4 s apart, and never in the hook-title or loop seconds. Built-in sounds are generated with FFmpeg (`node scripts/make-sfx.mjs` → `app/assets/sfx/`); upload `pop.mp3`, `ding.mp3` or `whoosh.mp3` to `library/sfx/` to replace them.
  - **Pop-up images:** the script picks one picturable word per beat ("ballot box"). A small tilted photo card pops up as that word is spoken, in the band above the captions, for about 1.8 s. It waits briefly for a number callout or the hook title to clear, or is skipped, and it stays out of the loop seconds at the end. The photo comes from Pixabay, searched most specific first: the study's place plus the search ("afghanistan village"), then the search, then the word. Real photos whose tags strictly match (no illustrations or low-quality images) go to a vision model (`OPENAI_MODEL`, low detail, ~6 photos per check, at most 2 checks per pop-up). It is told what the script means by the word (its own search, e.g. "failed driving test" for "test") and picks a photo where a viewer would recognize that at a glance and that doesn't clearly show a different part of the world, or rejects them all. (Testing: without this it accepted a COVID test for "driving test" and a realtor for "agents".) A pop-up with no good photo is left out rather than showing something off-topic.
  - **Background music:** Calm / Upbeat / Dramatic. Tracks come from `library/music/<mood>/` and play at about -18 dB under the voice. The music's tail is timed so it loops with the video.
  - **Split screen:** the story footage takes the top half. The bottom half shows **gameplay** from `library/gameplay/` (your own recordings, played continuously) or **satisfying clips** from Pixabay (marble run, pottery wheel, skateboarding and similar, cut every ~12 s). The bottom half loops seamlessly too.
  - Choices with no files in the library are greyed out.
- **Create-video UI:** two-column layout on desktop (audience/progress sidebar on the left + main panel; stacks on mobile). Home: drag-and-drop PDF (or paste text) and Generate video. Job page: progress on the left, add-ons then Continue (with auto-chosen points) in the middle, article preview on the right; the reel player only appears after render finishes (then: progress · article · reel). Production / Test switch: Test shows step times, tokens and estimated cost in the left sidebar; Production hides those.
- **Target audience:** chosen in the create-flow sidebar (PDF or pasted text) and saved in `jobs.audience` (migration 0008). Academic and Kids are shown as "soon" (ideas in the project's Notion page).
  - **Social** (default): the hooky reel described in this README, up to 60 s.
  - **Student:** what the study asked, how it was tested and what it found, 60-90 s (aim 90 s, never over 100 s; ~210 words; calmer TTS speed 1.0).
    - The points step adds two point types: **question** (the research question, quoted from the article) and **method** (who took part, the groups, what was changed and measured).
    - The pre-selection is 1 question, up to 2 method points and the rest findings, in that order.
    - The script runs question → method → findings, with the main finding last, then why it matters. The loop is kept. The order and a finding as the payoff are fixed automatically, not left to the model.
    - Key method terms ("randomly assigned", "control group") are allowed if the sentence explains them; harder terms are still jargon.
    - A small label shows when each section starts: THE QUESTION, HOW THEY TESTED IT, WHAT THEY FOUND, WHY IT MATTERS.
    - A section list in the top-left corner (Question · How tested · Findings · Why it matters) marks the current section in yellow as it starts. It appears after the hook title and leaves before the loop seconds.
- **Written for the general public:** after watching, the viewer should know the study's main findings and where, when and with whom it was done. While proposing points, the AI also pulls the study's **place, time period and sample** from the whole article, each with a sentence quoted from it. They are checked against the text and saved in `study_setting`. The first beat opens with them; facts that can't be verified are left out.
- **Timing:** the job page shows how long each step took, ticking live while the job runs: upload, reading the PDF, finding points, writing the script, recording the voice, finding visual materials, render + save. My videos shows "made in …" for each video. Next to each AI step the panel also shows what it used from OpenAI and an estimated cost, with the total in the header: tokens in/out for finding points, writing the script (all attempts) and the pop-up photo checks; characters read aloud and seconds transcribed for the voice. Prices are in `app/src/lib/pricing.ts` (gpt-5-mini $0.25 / $2.00 per 1M tokens in/out, tts-1 $15 per 1M characters, Whisper $0.006 a minute; checked 2026-11-21). They are estimates; OpenAI's usage page is the bill. A database trigger records the first time a job enters each status (`stage_times`). To save time, all parts of the voiceover are recorded at the same time, and the footage searches and pop-up photo checks run alongside them (`app/src/inngest/footage.ts`), since they only need the script. The "find footage" step then only fits the results to the recorded timing. A typical run takes about 6 minutes, about 4 of them rendering.
- **New mobile create flow (`/create`, Nov 22, not yet tested end to end):** an 8-step, phone-first flow built alongside the current pages (plan: `product-documents/ArticL-New-Flow-Plan.md`). Upload a PDF → choose Social or Student → confirm up to 5 findings (drag to reorder; the top one leads) → choose a hook (Social: surprising number or myth-buster; Student also a question) → add-ons (extra ones under "More options") and author details → review the script, with an overclaim check that suggests softer wording → a build tracker with post text, cover frame and feedback → the finished reel. Needs migration `0010_create_flow.sql`. `/create/preview?step=N` shows each step with sample data (dev only).
- Phase 5, end-to-end testing on real articles: next. HyperFrames Cloud rendering is needed before deploying, because Vercel can't render locally.

## Layout
- `app/`: Next.js web app (upload page, API routes, Inngest jobs)
- `supabase/migrations/`: database + storage setup (run each file once, in order, in the Supabase SQL Editor)
- `spike/`: HyperFrames proof of concept (one hardcoded beat), plus `scripts/` to regenerate its assets

## Setup
1. **Supabase:** create a project. In **SQL Editor**, run the files in `supabase/migrations/` in order (`0001` → `0008`).
   - `0006_stage_times.sql` adds the step timings (column + trigger).
   - `0007_study_setting.sql` adds the study's place, period and sample.
   - `0008_audience.sql` adds who the video is for (Social / Student).
   - `0009_usage.sql` adds OpenAI usage per step (column + `add_job_usage` function).
   The app keeps working without these four, just without timings, the setting, the Student type or usage.
   For the add-ons, upload files in **Storage → library**:
   - `music/calm/`, `music/upbeat/`, `music/dramatic/`: royalty-free tracks of 60 s or more. Name them `Title -- Artist.mp3` to get a credit.
   - `gameplay/`: your own gameplay recordings as MP4, under 50 MB each (the Supabase free-tier limit).
   Local rendering also needs **FFmpeg** (`winget install --id Gyan.FFmpeg -e`) and Chrome. The app's startup script finds a winget FFmpeg install even if it isn't on PATH yet.
2. **Keys:** copy `.env.example` to `.env` (repo root) and fill it in. The app reads this file through `app/scripts/with-root-env.mjs`.
   - OpenAI key (TTS, Whisper, and points via `OPENAI_MODEL`, default `gpt-5-mini`)
   - Supabase project URL, publishable key and secret key (Project Settings → API Keys)
   - Pixabay key (b-roll, used by the spike scripts)
   - Optional, for cloud rendering: `HEYGEN_API_KEY` (HeyGen API key). `RENDER_MODE=cloud` makes the cloud the pre-selected choice (default: `local`); `CLOUD_RENDER_QUALITY` = `draft` | `standard` (default) | `high`. Restart `npm run dev` after changing `.env`.
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
Each proposed point must include a sentence copied from the article (or up to 4 pieces joined with "...", which methods often need). The server keeps a point only if:
- each piece appears in the extracted text (punctuation and hyphenation are ignored; words and numbers must match), and
- every number in the point's wording also appears in that sentence.

This catches invented or rounded figures and paraphrased "quotes". The code is in `app/src/lib/points.ts`.

The study setting (place, period, sample) is checked the same way. Each quoted sentence must be in the article (several sentences joined with "..." are checked piece by piece). Every number and capitalized name in the value must appear in the quote, so a wrong year or country is dropped rather than shown.

The script is checked the same way (`app/src/lib/script-checks.ts`). The model gets up to 3 attempts, each told what was wrong with the last. A script is rewritten if:
- a beat uses a number that isn't in its own point or the study setting;
- the hook, closing, on-screen hook title or post caption uses a number that isn't in any chosen point or the study setting. A year is allowed only from the verified setting: years in the article's opening are mostly citations of other papers. A number in the verified setting itself ("822 driver's license candidates") may be said with any noun ("822 people"). Any other count is allowed if the article's opening says it with the same noun ("250 villages");
- numbers are spelled out, ranges are written with a dash, symbols are used, or a point id is read aloud;
- the hook is a question, uses filler ("the answer might surprise you"), or the closing repeats the hook title. Any of these would break the loop, where the closing's last words run into the hook;
- the script talks about itself ("in this video", "payoff", "loop");
- a chosen point is missing or repeated, or the hook title is over 7 words.

Some problems only ask for a rewrite. If they're still there on the last attempt, the script is used anyway:
- research jargon ("randomized", "statistically significant", "standard deviation" and similar);
- a hook that gives away the payoff's number;
- a script under 80% of the word budget, or up to 30% over it. (The prompt names every beat the script needs and gives each part a word budget, which keeps most drafts within the limit.) If the recorded voice runs past 60 s, the script is redrafted shorter. If that shorter rewrite fails its checks, the first (checked, recorded) version is used as long as it's under 75 s, rather than failing the run.

Slips with one right answer are fixed automatically instead of rewritten:
- "7.5 percent" → "7.5 percentage points" when the article says points;
- "six weeks" → "6 weeks", and larger spelled numbers like "fifty pounds" → "50 pounds" (the number is then still checked against the point; "one in eight" is left alone);
- "referenda" → "referendums";
- currency signs and codes → words: "Rs 1,120" → "1,120 rupees", "$50" → "50 dollars" (also £, €, USD, INR);
- a missing apostrophe ("headmen s" → "headmen's");
- a separate setting beat merged into the first beat;
- a "the payoff:" label at the start of a sentence removed;
- a beat's pop-up dropped if its word isn't said in that beat, contains a number, or is over 3 words;
- the payoff beat moved to the end.

The source credit is never a reason to rewrite. If its surnames aren't in the first lines of the article, it is left out. The year always comes from the article's own publication line, never from the model.

## Supabase egress (free tier: 5 GB a month)
- A finished video is ~30-40 MB. The job page loads only its details until you press play, so opening a job page no longer downloads the whole video.
- While a job runs, the page re-reads the job row every 3 s without the article text (~130 KB), which is fetched only when "Show extracted text" is clicked.
- Re-compressing finished videos was tested: about 25% smaller (40 to 30 MB) for ~2 minutes of extra work per video on the dev laptop, so it isn't done.

## Known prototype limits
- Rendering: each video's add-ons include **Render on: This computer / HeyGen Cloud**.
  - **This computer** (free, the default): the HyperFrames CLI on the machine running `npm run dev` (project in the OS temp folder, `articl-render/<jobId>`), one video at a time.
  - **HeyGen Cloud** (`app/src/lib/heygen.ts`): the same project folder is zipped, sent with HeyGen's direct upload, and rendered at 1080p, 9:16, 30 fps; the job polls every 20 s, then copies the MP4 and HeyGen's thumbnail into Storage. $0.15 per minute of video, billed by the second (a 50 s video cost $0.13 in testing, rendered in 88 s versus ~4 minutes locally); the timing panel shows the estimate. A failed cloud render fails the job with HeyGen's reason and never falls back to local. Needs `HEYGEN_API_KEY` and credit on the HeyGen account; without the key the option is greyed out.
  - Vercel can only use the cloud option (it can't run the local CLI).
- B-roll photos are matched only by the script's 2–4 word search terms, so some fit loosely.
- No sign-in yet. Anyone holding the publishable key can read every job row (see the policy note in `0001_jobs.sql`).
- The checks verify numbers and setting facts, not framing. In testing, a hook said "investing just once" for a study where people invested over 6 weeks.
- Scanned (image-only) PDFs fail with a clear message, because there's no OCR yet.
- Points use `gpt-5-mini` (~$0.007 per article) during the prototype. `gpt-5-nano` is about 5x cheaper but gave only 5 to 10 verified points per run; revisit after the prototype.
