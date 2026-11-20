// Article text helpers shared by PDF extraction and pasted text. Pure, safe in browser and server.

/** Fewer characters than this almost always means a scanned (image-only) PDF, or too little text. */
export const MIN_TEXT_CHARS = 200;
/** Pasted text limits, in words. The 20-page Margalit paper is ~13,000 words. */
export const MIN_PASTE_WORDS = 40;
export const MAX_PASTE_WORDS = 30_000;
export const MAX_TITLE_CHARS = 200;

/** Collapse layout noise: hyphenated line breaks, stray spaces, 3+ blank lines. */
export function cleanText(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .replace(/(\w)-\n(\w)/g, "$1$2")
    .replace(/[ \t ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function countWords(s: string): number {
  const t = s.trim();
  return t ? t.split(/\s+/).length : 0;
}

/** Returns a problem message, or null if the pasted text can be used. */
export function checkPastedText(text: string): string | null {
  const words = countWords(text);
  if (words < MIN_PASTE_WORDS || text.trim().length < MIN_TEXT_CHARS) {
    return `Please paste at least ${MIN_PASTE_WORDS} words of article text.`;
  }
  if (words > MAX_PASTE_WORDS) {
    return `That's ${words.toLocaleString("en-US")} words; the limit is ${MAX_PASTE_WORDS.toLocaleString("en-US")}. Paste the main article without appendices.`;
  }
  return null;
}
