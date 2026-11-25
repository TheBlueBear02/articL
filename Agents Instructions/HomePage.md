# Home page

## Layout

1. **Header copy** — headline + one supporting line.
2. **Create grid** — audience sidebar + article upload / paste panel.
3. **My videos** — `ReelCarousel`: latest **6** finished reels (`/api/reels?limit=6`).
4. **Q&A** — `HomeFaq` at the bottom.

## Brand lines (logo L)

The ArticL mark ends in a yellow **L** whose upright is **four vertical parallel strokes**. Reuse that as vertical yellow lines on quiet white sections — not diagonals or horizontals as the main motif.

- **SVG mark:** `BrandVerticalLines` in `app/src/components/brand-lines.tsx` (default 4 strokes).
- **Section wash:** `.brand-lines-section` in `globals.css` — repeating vertical yellow lines; fade with a mask on a decorative layer so copy stays on white.
- **Q&A:** `HomeFaq` — white panel; denser vertical lines from the right fade toward the copy; yellow “Q&A” eyebrow; larger two-line headline. Accordion rows are dividers only (no cards). Same component on `/create` step 1 via `compact` for the narrow column.

## Components

- `page.tsx` — upload/start flow + mounts carousel and FAQ.
- `HomeFaq` — client accordion; one open panel at a time (first open by default). Optional `compact` for create / mobile-narrow layouts.
- `ReelCarousel` — finished videos only; limit 6.
