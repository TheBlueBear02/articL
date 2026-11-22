# ArticL: new 8-step creation flow (build plan, draft v2)

Date: 2026-11-21. Status: **proposal, nothing built yet.**

## Decisions (2026-11-21)
- Only the two current versions: **Social** and **Student**. No LinkedIn, no other audiences.
- **PDF only.** No DOI, no paste-text in the new flow.
- **Script structure stays as today:** hook (+ on-screen hook title), one beat per point with the payoff last, closing that loops into the hook. Student keeps question → method → findings → why it matters.
- Pop-ups, sound effects, map and charts stay **on by default**, under a **"More options"** fold in step 5.
- **Drag to reorder** findings on touch screens (`@dnd-kit/sortable`).

## 1. Where we start from

| New step | What already exists | Gap |
|---|---|---|
| 1 Upload | PDF drop, signed upload, `extract-article` Inngest job | "Reading your paper…" card with title + authors once found |
| 2 Audience | Audience picked *before* upload | Picked *after* upload: Social or Student |
| 3 Findings | Verified points, auto-picked, read-only | Finding cards with quote, drag to reorder, choose lead, edit, regenerate |
| 4 Hook | Hook written inside the one script call | Separate call returning 3 typed hooks; script accepts a fixed hook |
| 5 Add-ons | Music, split, popups, sfx, map, charts, render target | Author name/role/university for the caption; split only for Social; "More options" fold; script runs in background |
| 6 Script review | Script is never shown | Today's script shown as blocks (Hook, each beat, Closing) with quotes, **overclaim check** (new), one-tap softer wording |
| 7 Rendering | Progress list + percentage | Per-part tracker with thumbnails, 5 s preview, post text, cover frame, feedback |
| 8 Result | Player + Download | Share, Copy post text, Make another version, Try another paper, analytics |

## 2. Design direction

- **Layout:** one column, phone first; on desktop a centred column (~28rem). 16px side gutters.
- **Colour:** white background always, near-black text, neutral greys and hairline borders. Brand yellow `#ffd93d` only for accents (primary button, selected-card ring, progress bar, check marks), never as text colour.
- **Type:** Geist (already loaded). Large step titles, 15–16px body, small uppercase "Step 3 of 8" labels.
- **Surfaces:** soft cards (radius ~20px, 1px light border, faint shadow), generous padding.
- **Navigation:** thin yellow progress bar + step label at the top, back arrow, **sticky bottom action bar** in thumb reach (iPhone safe-area padding).
- **Motion:** step change = fade + 12px slide (~280 ms, reversed when going back); cards fade up one after another; selection ring and check marks animate in; shimmer skeletons for background work; everything off under `prefers-reduced-motion`. CSS only, plus `@dnd-kit` for drag.

## 3. Architecture

### Routes
New flow at **`/create`** (upload) and **`/create/[id]`** (steps 2–8). The step is derived from the job row, so refresh lands on the right step. Current home and `/jobs/[id]` stay untouched until you approve the new flow.

### New job statuses (one migration)
```
uploaded → extracting → extracted
  → awaiting_audience*
  → proposing → awaiting_findings*
  → (hooks pre-generated) → awaiting_hook*
  → awaiting_addons*  (script drafted + checked in background)
  → awaiting_script_review*
  → voicing → fetching_broll → rendering → rendered
```
`*` = waits for the user. New columns: `paper_meta` (title, authors, year), `hooks`, `chosen_hook`, `author_info`, `script_flags`, `cover_time_s`. New `events` table (job id, name, payload, time) for analytics and feedback.

### Background work
| Trigger | Runs |
|---|---|
| PDF uploaded | extract text → read title/authors from the first page |
| Audience chosen + text extracted | propose, verify and rank findings |
| Findings ready | 3 hooks for the top finding; re-run if the lead changes |
| Hook chosen | draft script → existing checks → overclaim check → auto-fix/rewrite |
| Script approved (per block) | TTS + Whisper for approved blocks; footage prefetch |
| All approved | footage timing → render → thumbnails, post text |

## 4. Build phases

1. **Design system + flow shell.** Tokens, `StepShell`, `StepTransition`, cards/buttons/toggles. Steps 1, 2, 5, 7, 8 wired to the existing pipeline (findings shown read-only for now). Checked at 375px.
2. **Findings + hooks (steps 3–4).** Drag reorder + lead, edit (re-verified against the quote), regenerate. New `proposeHooks()` returning `{type, line, onScreen, quote}`; `draftScript` gets a `fixedHook` input.
3. **Script review + overclaim check (steps 5–6).** Blocks follow today's structure. Overclaim check flags causal or over-general wording the quote doesn't support and offers a softer version, which still passes the number checks. Author info goes into the post caption.
4. **Interactive rendering (step 7).** Per-part status + thumbnail, 5 s preview, editable/copyable post text (caption, a viewer question), cover-frame picker, one-question feedback.
5. **Result + analytics (step 8).** Player, Download, Share (Web Share API on phones), Copy post text, Make another version (clone job, back to step 3 or 4), Try another paper. Events: hook type, share, download, repeat use, feedback.

## 5. Risks
- Overclaim check is untested; it flags and suggests, it can't guarantee.
- Per-block voicing before full approval means re-recording if an approved block is edited later (small cost).
- 5 s preview: a real render competes with the main render for CPU (see question B).
- Audience after upload delays point-finding until the user taps.

## 6. Settled (2026-11-21, second round)
- **Rollout:** build at `/create` alongside the current home and job pages.
- **A. Hook types:** Social gets 2 types (surprising number, myth-buster); Student gets 3 (adds the question hook, allowed by the checks only for Student).
- **B. No 5 s preview** in step 7.
- **C. Findings:** show all verified points in a fixed-height scrollable list; the user keeps up to 5 and drags to order them.
