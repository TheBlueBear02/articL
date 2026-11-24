// The "Paper page" add-on: the article's first page as a card in the video. The image is drawn from
// the PDF during the render, into the render's temp project folder, so it is never stored: the
// folder is deleted once the video is saved (or the render fails).
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { renderPageAsImage } from "unpdf";

/** The card on screen is 4:3; the image is drawn at twice that size so it stays sharp. */
export const PAPER_IMAGE = { width: 1200, height: 900 };

/** Page width the PDF is drawn at before cropping (about 1.7x the card, for crisp small text). */
const RENDER_WIDTH = 1400;
/** A pixel darker than this (0-255) counts as printed content, not page background. */
const INK = 225;
/** A row or column needs this many content pixels, so specks and scan noise don't count. */
const MIN_INK_PIXELS = 3;

/**
 * Draw `page` (1 = the first page) of a PDF and crop it to the top of its printed area, where the
 * title, authors and abstract are: the page's margins are left out, so the card shows text, not
 * white paper. Returns a JPEG.
 */
export async function renderPaperPage(pdf: Uint8Array, page = 1): Promise<Buffer> {
  const png = await renderPageAsImage(new Uint8Array(pdf), page, {
    canvasImport: () => import("@napi-rs/canvas"),
    width: RENDER_WIDTH,
  });
  const img = await loadImage(Buffer.from(png));
  const full = createCanvas(img.width, img.height);
  const ctx = full.getContext("2d");
  ctx.fillStyle = "#fff"; // transparent PDF backgrounds would turn black in a JPEG
  ctx.fillRect(0, 0, img.width, img.height);
  ctx.drawImage(img, 0, 0);
  const box = contentBox(ctx.getImageData(0, 0, img.width, img.height));

  // The content's width (plus a small margin) at the card's 4:3 shape, from just above its top.
  const pad = Math.round(box.width * 0.04);
  const cropW = Math.min(img.width, box.width + 2 * pad);
  const cropH = Math.min(img.height, Math.round((cropW * PAPER_IMAGE.height) / PAPER_IMAGE.width));
  const x = clamp(box.x - pad, 0, img.width - cropW);
  const y = clamp(box.y - pad, 0, img.height - cropH);

  const out = createCanvas(PAPER_IMAGE.width, PAPER_IMAGE.height);
  const octx = out.getContext("2d");
  octx.fillStyle = "#fff";
  octx.fillRect(0, 0, PAPER_IMAGE.width, PAPER_IMAGE.height);
  octx.drawImage(full, x, y, cropW, cropH, 0, 0, PAPER_IMAGE.width, PAPER_IMAGE.height);
  return out.toBuffer("image/jpeg", 88);
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

/** The rectangle holding the page's printed content; the whole page if it looks blank. */
function contentBox(data: { data: Uint8ClampedArray; width: number; height: number }) {
  const { width, height } = data;
  const rows = new Uint32Array(height);
  const cols = new Uint32Array(width);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      const lum = 0.299 * data.data[i] + 0.587 * data.data[i + 1] + 0.114 * data.data[i + 2];
      if (lum < INK) {
        rows[y]++;
        cols[x]++;
      }
    }
  }
  const first = (counts: Uint32Array) => counts.findIndex((n) => n >= MIN_INK_PIXELS);
  const last = (counts: Uint32Array) => counts.length - 1 - [...counts].reverse().findIndex((n) => n >= MIN_INK_PIXELS);
  const top = first(rows);
  const left = first(cols);
  if (top < 0 || left < 0) return { x: 0, y: 0, width, height };
  return { x: left, y: top, width: last(cols) - left + 1, height: last(rows) - top + 1 };
}
