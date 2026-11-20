// Pure helpers for Phase 2 (no framework imports, so they can be tested with plain node).
import type { CandidatePoint, SettingFact, StudySetting } from "./jobs";

const BACK_MATTER_HEADING = /^(references|bibliography|works cited)\s*$/gim;

/**
 * Drop the reference list (and anything after it, e.g. appendices) before sending the
 * article to the model. Cuts at the LAST standalone "References"-style line, and only
 * if it sits in the second half of the text, so an early mention can't eat the article.
 */
export function trimBackMatter(text: string): string {
  let cutAt = -1;
  for (const m of text.matchAll(BACK_MATTER_HEADING)) cutAt = m.index;
  return cutAt >= text.length * 0.5 ? text.slice(0, cutAt).trimEnd() : text;
}

/** Make PDF text and model output comparable: case, quotes, dashes, ligatures, breaks, spaces. */
export function normalize(s: string): string {
  return s
    .normalize("NFKC") // also expands ligatures like "ﬁ" -> "fi"
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/[‐-―−]/g, "-")
    .replace(/(\w)-\s*\n\s*(\w)/g, "$1$2")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/**
 * Looser key for "does this sentence appear in the article": drops punctuation (models
 * often trim a parenthetical or end with a period mid-sentence) but keeps every word,
 * digit, %, currency sign and decimal point, so a changed word or number still fails.
 */
export function matchKey(s: string): string {
  return normalize(s)
    .replace(/(\d),(?=\d{3}\b)/g, "$1") // thousands separators: "13,165" -> "13165"
    .replace(/(\d)\.(\d)/g, "$1\u0000$2") // protect decimal points
    // Join hyphenated words: PDF extraction turns "self-\nsustaining" into "selfsustaining",
    // while the model writes "self-sustaining". Ranges like "7-9" are left alone.
    .replace(/([a-z])-([a-z])/g, "$1$2")
    .replace(/[^a-z0-9%£$€\u0000\s]/g, " ")
    .replace(/\u0000/g, ".")
    .replace(/\s+/g, " ")
    .trim();
}

/** Numbers as written, with thousands separators removed: "13,165" -> "13165", "6.5%" -> "6.5". */
function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Decide the pre-selected points after verification. Keeps the model's recommended points
 * (in its order); if verification dropped some, tops up from the remaining points in order.
 * Returns all points with recommended ones first, so the checklist leads with the picks.
 */
export function applyRecommendations(points: CandidatePoint[], max: number): CandidatePoint[] {
  const modelPicks = points.filter((p) => p.recommended);
  const others = points.filter((p) => !p.recommended);
  const picks = [...modelPicks, ...others].slice(0, max);
  const pickSet = new Set(picks);
  return [
    ...picks.map((p) => ({ ...p, recommended: true })),
    ...points.filter((p) => !pickSet.has(p)).map((p) => ({ ...p, recommended: false })),
  ];
}

export type VerifyResult = {
  kept: CandidatePoint[];
  dropped: { point: CandidatePoint; reason: string }[];
};

/**
 * Keep only points the article actually supports:
 * - the evidence sentence must appear (after normalizing) in the source text;
 * - every number in the point's wording must also appear in its evidence,
 *   so the model can't invent or round a figure.
 */
export function verifyPoints(points: CandidatePoint[], sourceText: string): VerifyResult {
  const source = matchKey(sourceText);
  const result: VerifyResult = { kept: [], dropped: [] };

  for (const point of points) {
    const evidence = matchKey(point.evidence);
    if (evidence.length < 20) {
      result.dropped.push({ point, reason: "evidence too short" });
      continue;
    }
    if (!source.includes(evidence)) {
      result.dropped.push({ point, reason: "evidence not found in article" });
      continue;
    }
    const evidenceNumbers = new Set(numbersIn(evidence));
    const missing = numbersIn(point.text).filter((n) => !evidenceNumbers.has(n));
    if (missing.length) {
      result.dropped.push({ point, reason: `number(s) ${missing.join(", ")} not in its evidence sentence` });
      continue;
    }
    result.kept.push(point);
  }
  return result;
}

/**
 * Keep only the setting facts (place, period, sample) the article supports: the evidence sentence
 * must appear in the article, every number in the value must be in that sentence, and so must every
 * capitalized word (place names), so the video can't say a wrong country or year.
 */
export function verifySetting(
  setting: { place?: SettingFact; period?: SettingFact; sample?: SettingFact },
  sourceText: string,
): StudySetting {
  const source = matchKey(sourceText);
  const ok = (fact?: SettingFact): SettingFact | undefined => {
    const value = fact?.value?.trim() ?? "";
    // Dates are often spread over several sentences, which the model joins with "...": each piece
    // must be in the article word for word. (Testing: Beath's "2007 to 2011" came from three survey dates.)
    const pieces = (fact?.evidence ?? "").split(/\.{3}|…/).map(matchKey).filter(Boolean);
    const evidence = pieces.join(" ");
    if (!value || evidence.length < 20 || pieces.some((p) => p.length < 20 || !source.includes(p))) return undefined;
    const evidenceNumbers = new Set(numbersIn(evidence));
    if (numbersIn(value).some((n) => !evidenceNumbers.has(n))) return undefined;
    const names = value.match(/\b[A-Z][a-zA-Z]+/g) ?? [];
    if (names.some((w) => !evidence.includes(matchKey(w)))) return undefined;
    return { value, evidence: fact!.evidence.trim() };
  };
  const out: StudySetting = {};
  for (const key of ["place", "period", "sample"] as const) {
    const fact = ok(setting[key]);
    if (fact) out[key] = fact;
  }
  return out;
}
