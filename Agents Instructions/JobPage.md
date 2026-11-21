# Job page layout

## Desktop columns

Before the reel is ready (`status !== "rendered"`):

1. **Progress** (left) — Production: step list only. Test: step times, tokens, estimated cost.
2. **Controls** (middle) — Add-ons while the article is prepared; after points are found, add-ons + Continue + read-only auto-chosen points; then points summary while producing.
3. **Article** (right) — PDF iframe or pasted-text preview. No reel placeholder.

After render (`status === "rendered"`):

1. **Progress**
2. **Article**
3. **Reel** — player + Download MP4 (`ReelPanel`). Mounted only when rendered so Storage egress is not used earlier.

## Point selection + add-ons

Manual point picking is off. After propose, `extract-article` marks recommended points and pauses on `awaiting_selection` — it does **not** start scripting by itself.

The user submits add-ons with **Continue**, which calls `POST /api/jobs/[id]/select` with the recommended point ids + current add-ons, then fires `POINTS_SELECTED`.

While points are still being found, **Save add-ons** only stores preferences; production waits for Continue.

## Components

- `JobView` (`app/src/components/job-view.tsx`) — owns layout, add-ons state, Continue.
- `JobMediaPanel` — article only.
- `ReelPanel` — signed video URL + player; only when rendered.
- `JobControlsColumn` — add-ons picker + Continue + points list beside progress.

## Notes

- Add-ons are not inside the progress sidebar.
- Progress includes a user step: **Confirm add-ons**.
