# LinkedIn (academic) composition

Peers & policymakers videos use LinkedIn extras in `app/src/render/composition.ts`: byline, method panel, shows/doesn't verdict, finding quote popups, and a closing card.

## Quote popups

On finding beats (`stat` / `claim` / `quote`) that are not already a panel, the paper evidence shows as a short italic popup above the captions.

Rules:

- **One sentence only** — take the first sentence of the evidence (after any `...` join split in `render-video`).
- **Hard cap** — clip to ~110 characters at a word boundary so large type still fits.
- **Large type** — ~44px italic (readable on a phone); label “From the paper”.
- **Brief on screen** — about 3.2s at the start of the beat, not the full segment. `linkedinBusy` uses the same short window so image pop-ups / paper page can use the rest of the beat.

Constants: `QUOTE_POPUP_S`, `QUOTE_POPUP_CHARS` in `composition.ts`.
