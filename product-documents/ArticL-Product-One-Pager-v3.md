# ArticL — Product One-Pager v3

Nov 21, 2026 · Amir

> Exported from the Claude Doc: https://claude.ai/artifact/2tJJg8ZyBEi9Fm483C6YEN (the live, editable version). Replaces v2 (`ArticL-Product-One-Pager-v2.md`, kept for reference).

**Target user: academics who want their papers to reach more people.** A researcher uploads a paper (PDF or pasted text) and gets a short vertical video that explains it, with every number checked against the paper. The researcher chooses who the video is for: the general public on social media, or students.

The product has three parts:

1. **Article analysis:** understand the paper and pick what matters, traceable to the text.
2. **Video creation:** turn that into the right video for the chosen audience, fast and cheaply.
3. **Frontend and user experience:** make the minutes of production feel active, not like waiting.

| Measure (Nov 20-21 test runs) | Today |
| --- | --- |
| Upload to points checklist | 20-33 s |
| Continue to finished video | ~5 min (Social, ~50 s video); ~8 min (Student, ~70-87 s video) |
| Share of time spent rendering | ~4 of 5 min (Social), ~6-7 of 8 min (Student) |
| Cost per video | ~$0.02-0.05, OpenAI only (estimate; now recorded per step on each job) |

## Part 1: Article analysis

**Goal:** understand the paper correctly and pick the points a short video needs, with every number traceable to the text.

**Today:**

- Text is extracted from the PDF (or pasted), cleaned, and the reference list cut.
- One AI call (gpt-5-mini) proposes 12-15 points, each with a quoted sentence. A point is dropped unless its quote is in the paper (footnotes mid-sentence allowed) and every number in it is in the quote.
- The study's place, period and sample are pulled out and checked the same way.
- Point types depend on the audience. Student videos add the research **question** and **method** points, and the study's **main result** is flagged.

**Gaps:**

- The main result still fails the check in some runs (the AI adds numbers from other sentences), so a Student video can miss it.
- No section-by-section "article map" or plain summary yet.
- Scanned PDFs fail (no OCR); very long papers are refused.

**Next:** make the main result reliable, then the article map (question, method, findings, limits, summary).

## Part 2: Video creation

**Goal:** the right video for the chosen audience, in plain words, at a few cents and a few minutes per video.

**Audience and video type** (chosen on the upload screen):

| Audience | What the viewer gets | Length | Status |
| --- | --- | --- | --- |
| Social | A hooky reel of the main findings, with a seamless loop | up to 60 s | Built |
| Student | The question, how it was tested, what was found, why it matters; section labels and a section list in the corner | 60-90 s | Built |
| Academic | Design, methods and results in depth, for peers | 2-4 min | Planned; needs checks on method claims |
| Kids | One big idea in cartoon style | 45-60 s | Planned last |

Formats such as "3 things this study found" or myth vs fact can later become options inside an audience.

**Today:** script with automatic checks and fixes (numbers, setting, order, plain words), voice (OpenAI TTS) with word timings (Whisper), captions, stock footage from Pixabay, and big-number callouts. Optional add-ons: pop-up photos with an AI fit check, a map that zooms in as the place is said, sound effects, music and split screen. Rendered with HyperFrames on this laptop.

**Gaps:**

- Rendering is about 80% of the wait and only works on this laptop.
- Some stock clips fit loosely; Pixabay has few photos for some places and topics.
- Checks verify numbers, not framing: a line can still claim more than its point says.

**Next:** HyperFrames Cloud rendering, then the Academic type.

## Part 3: Frontend and user experience

**Goal:** the researcher never feels they uploaded a file and are now just waiting.

**Today:**

- Create-video home layout: left **audience** sidebar + main **Article** panel (stacks on mobile). Generate video sits at the bottom of the sidebar.
- Article panel starts as a grey PDF drag-and-drop zone; after a file is chosen it becomes an in-browser PDF reader. Paste-text mode goes through an editable form, then a readable article preview before submit.
- Audience (Social / Student; Academic and Kids “soon”) lives in the sidebar and is saved with the job on upload.
- Job page: **progress** on the left, **add-ons** (then the auto-chosen points list) in the middle, **article** preview on the right. The **reel** player (9:16 + download) only appears after render finishes, then as progress · article · reel.
- **Production / Test** switch on the job page: Production shows a clean progress sidebar (no timing/tokens/cost); Test shows step durations, tokens and estimated OpenAI cost in the left sidebar, plus the script/voiceover panel.
- Choose add-ons in the middle column while the paper is read; the best 5 points are chosen automatically (no manual pick for now).
- A job page that survives a refresh.
- "My videos" lists the 20 latest jobs with their audience and status.

**Gaps:** the render minutes are still mostly a progress bar / placeholder; no editing or re-rendering; no notification when done; no sign-in (every job visible to all); no retry for a failed job; phone layout started but not fully tested end-to-end.

**Next:** sign-in, a "Try again" button, a done notification, then a storyboard that fills in during the wait.

## Before sharing with others

| Area | Today | Needed |
| --- | --- | --- |
| Hosting | Local dev server | Vercel |
| Background jobs | Inngest dev server | Inngest Cloud |
| Rendering | HyperFrames on this laptop, one video at a time | HyperFrames Cloud |
| Database and files | Supabase free tier (5 GB egress a month) | Supabase Pro when usage grows |
| Sign-in | None | Supabase Auth, per-user access |

## Open questions

- [ ] **Languages:** English only, or Hebrew too?
- [ ] **Script review:** let researchers read and edit the script before rendering?
- [ ] **Publishing:** download only, or post straight to Instagram, TikTok, YouTube Shorts?
- [ ] **Voice and branding:** a choice of voices, the researcher's logo or university colours?
- [ ] **Inputs:** article links (web page, DOI), not just PDFs and text?
- [ ] **Budget:** cloud rendering will be most of the cost; what can researchers or departments pay per video?
