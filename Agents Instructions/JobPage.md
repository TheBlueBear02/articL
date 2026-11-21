# Job page layout

## Desktop columns

Before the reel is ready (`status !== "rendered"`):

1. **Progress** (left) — Production: step list only. Test: step times, tokens, estimated cost.
2. **Controls** (middle) — Add-ons while the article is prepared; auto-chosen points summary while the video is being made.
3. **Article** (right) — PDF iframe or pasted-text preview. No reel placeholder.

After render (`status === "rendered"`):

1. **Progress**
2. **Article**
3. **Reel** — player + Download MP4 (`ReelPanel`). Mounted only when rendered so Storage egress is not used earlier.

## Point selection

Manual “pick points” is off for now. After propose, `extract-article` auto-selects the recommended points, sets `points_selected`, and sends `POINTS_SELECTED` to start scripting. `/api/jobs/[id]/select` remains for recovery; the job page also auto-calls it if an old job is still on `awaiting_selection`.

## Components

- `JobView` (`app/src/components/job-view.tsx`) — owns layout, add-ons state, recovery auto-select.
- `JobMediaPanel` — article only.
- `ReelPanel` — signed video URL + player; only when rendered.
- `JobControlsColumn` — add-ons picker + chosen-points list beside progress.

## Notes

- Add-ons are no longer inside the progress sidebar.
- There is no point-checklist UI; Progress no longer shows a “Pick points” step.
