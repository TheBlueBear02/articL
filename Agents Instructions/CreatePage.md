# Create page (`/create`)

Steps 1–2 of the create flow live here (`CreateStart`: upload, then audience). Later steps are at `/create/<id>`.

## Chrome

- **Top bar** — logo left-aligned; optional back; on step 1 an **Upload PDF** yellow button on the right; yellow progress bar. No step count in the header. Width: `max-w-md` mobile, `max-w-6xl` desktop.
- **Step heading** — grey eyebrow with `N/7` on the same row; big title + helper under it (`StepHeading` in `ui.tsx`).
- **Mobile** — single column (`max-w-md`), fixed bottom `ActionBar`.
- **Desktop (`lg+`)** — two-pane shell: left = same step components + docked actions; right = sticky 9:16 phone preview then step rail (`CreateAside`). Columns stretch to the same height (`items-stretch`, min viewport under the top bar). One component set for both layouts.

## Steps (7 listed)

| # | Label | Tag | Est. (right) |
| --- | --- | --- | --- |
| 1 | Upload your paper | You (blue) | — |
| 2 | Choose your target audience | You (blue) | — |
| 3 | Extracting findings | AI (yellow) | ~est from last 5 videos |
| 4 | Choose opening hook | You (blue) | — |
| 5 | Choose Add-ons | You (blue) | — |
| 6 | Writing video script | AI (yellow) | ~est from last 5 videos |
| 7 | Creating the video | AI (yellow) | ~est from last 5 videos |

Step 1 is upload only (audience types are informational, not buttons). Picking a PDF moves to step 2 (audience). Build and result both highlight listed step 7. Older jobs without `audience_confirmed` show a recovery audience picker on `/create/<id>`.

### Automated estimates

`GET /api/create/estimates` returns moving averages (seconds) over the last **5** finished `flow=create` jobs, from `jobs.stage_times`:

- **findings** — earliest of `extracting` / `uploaded` / `proposing` → `awaiting_findings`
- **script** — earliest of `scripting` / `points_selected` → `awaiting_review`
- **video** — earliest of `fetching_broll` / `rendering` → `rendered`

Shown in the desktop rail on the right of the step title as `~45s` (omitted when there is no sample yet). Helpers live in `lib/create-estimates.ts`.

## Step 1 layout (`UploadDrop`)

1. **Heading** — same as home: “Get your research seen like never before” + home supporting line.
2. **PDF drop / choose** — dashed upload card; choosing a file starts the upload in the background and opens step 2.
3. **Trust bullets** — findings checked against the paper; full video in under 4 minutes; no AI model uses the research for training.
4. **Paper → reel demo** — `PaperToReel` tall scroll track on **mobile only**. On desktop the right phone pane runs the compact demo (drag / keys only).
5. **Audience types** — informational grid (not buttons); real choice is step 2.
6. **Recent videos** — last finished reels (in-column on desktop; edge-bleed swipe on mobile).
7. **Action bar** — Upload PDF.

## Step 2 (`AudiencePicker`)

Who the video is for (General public / Students / Peers & policymakers). Continue waits for the upload if needed, saves audience, then opens `/create/<id>`.

## Desktop phone preview

| Flow step | Right-pane content |
| --- | --- |
| 1 (start) | Compact `PaperToReel` (drag / keys only) |
| 2–4 | Soft teaser (paper title / lead finding / hook) |
| 5 | Script hook teaser |
| 6 | Build progress + part thumbs |
| 7 | Finished video |

## Components

- `create-start.tsx` — steps 1–2; navigates to `/create/<id>` after audience.
- `create-flow.tsx` — later steps on a job; `Shell` two-pane layout.
- `create-aside.tsx` — desktop step rail (labels + right-side est. times) + phone frame.
- `step-upload.tsx` — step 1 UI (PDF + informational audience types).
- `step-audience.tsx` — step 2 / recovery audience picker + shared `AUDIENCE_OPTIONS`.
- `audience-types.tsx` — non-interactive audience preview on step 1.
- `paper-to-reel.tsx` — scroll (mobile) and compact (desktop) modes.
- `recent-reels.tsx` — swipe row of finished videos.
