// Captions should show the script's own words, but Whisper's word-level output drops
// punctuation and splits numbers ("7.5" -> "7", "5"; "2,703" -> "2", "703"; "$0.14" -> "0", "14").
// So: take the WORDS from the script and only the TIMING from Whisper, matching each script
// word to the one or more Whisper words it was spoken as. Pure, testable with plain node.
import type { Word } from "../lib/jobs";

const key = (s: string) =>
  s
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

/** Strip sentence punctuation but keep what belongs to the word: "$0.14," -> "$0.14", "percent." -> "percent". */
const display = (token: string) => token.replace(/^[^\w$£€]+/, "").replace(/[^\w%]+$/, "");

const MAX_WORDS_PER_TOKEN = 4; // "Labour–Conservative" or "$0.003" can span several Whisper words
const MAX_SKIP = 2; // extra words Whisper may insert that aren't in the script
const MIN_MATCH_RATIO = 0.6; // below this, alignment is unreliable: fall back to Whisper's words

export function alignToScript(script: string, words: Word[]): Word[] {
  const tokens = script.split(/\s+/).filter((t) => key(t));
  if (!tokens.length || !words.length) return words;

  const out: (Word & { matched: boolean })[] = [];
  let j = 0;
  let matched = 0;

  for (const token of tokens) {
    const target = key(token);
    let hit: { from: number; to: number } | null = null;

    search: for (let skip = 0; skip <= MAX_SKIP; skip++) {
      let acc = "";
      for (let n = 0; n < MAX_WORDS_PER_TOKEN; n++) {
        const idx = j + skip + n;
        if (idx >= words.length) break;
        acc += key(words[idx].word);
        if (acc === target) {
          hit = { from: j + skip, to: idx };
          break search;
        }
        if (!target.startsWith(acc)) break;
      }
    }

    if (hit) {
      out.push({ word: display(token), start: words[hit.from].start, end: words[hit.to].end, matched: true });
      j = hit.to + 1;
      matched++;
    } else {
      // Whisper missed this word (e.g. a quick "to"): time it in the gap, filled below.
      out.push({ word: display(token), start: NaN, end: NaN, matched: false });
    }
  }

  if (matched / tokens.length < MIN_MATCH_RATIO) return words;

  // Unmatched words get a zero-length slot where the previous matched word ended
  // (the caption code already handles zero-length words by holding the highlight).
  for (let i = 0; i < out.length; i++) {
    if (out[i].matched) continue;
    const prev = out.slice(0, i).reverse().find((w) => w.matched);
    const next = out.slice(i + 1).find((w) => w.matched);
    const t = prev ? prev.end : next ? next.start : 0;
    out[i].start = t;
    out[i].end = t;
  }
  return out.map(({ word, start, end }) => ({ word, start, end }));
}
