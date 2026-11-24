# Create page (`/create`)

Steps 1–2 of the mobile create flow live here (`CreateStart`). Later steps are at `/create/<id>`.

## Step 1 layout (`UploadDrop`)

1. **Heading** — “Turn your paper into a reel” + short helper.
2. **PDF drop / choose** — dashed upload card.
3. **Trust bullets** — findings checked against the paper; full video in under 4 minutes; no AI model uses the research for training.
4. **Paper → reel demo** — `PaperToReel`: tall scroll track with a sticky frame. Page scroll (and drag) moves the horizontal line down so the reel **thumbnail** covers the paper (no playback yet); aspect morphs toward 9:16. Assets in `app/public/demo/` (`paper-page.jpg`, `reel-thumb.jpg`; `reel.mp4` kept for later).
5. **Audience types** — “Customize based on the target audience you choose” + three columns (General public / Students / Peers & policymakers).
6. **Recent videos** — last finished reels.
7. **Action bar** — Upload PDF.

## Components

- `create-start.tsx` — upload + audience; navigates to `/create/<id>`.
- `step-upload.tsx` — step 1 UI.
- `paper-to-reel.tsx` — vertical wipe compare (paper under, reel clipped above the line).
- `audience-types.tsx` — audience grid.
- `recent-reels.tsx` — swipe row of finished videos.
