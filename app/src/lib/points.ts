// Pure helpers for Phase 2 (no framework imports, so they can be tested with plain node).
import { isFindingType, type Audience, type CandidatePoint, type SettingFact, type StudySetting } from "./jobs";

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
/** "(1)", "(2)" or "1)" numbering a list inside a point's wording. */
const LIST_MARKER = /\(\d{1,2}\)|(?<![\w.])\d{1,2}\)(?=\s)/g;

function numbersIn(s: string): string[] {
  return (s.match(/\d[\d,]*(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,/g, ""));
}

/**
 * Decide the auto-selected points after verification. Keeps the model's recommended points
 * (in its order); if verification dropped some, tops up from the remaining points in order.
 * Returns all points with recommended ones first (those are the selected set).
 */
export function applyRecommendations(points: CandidatePoint[], max: number, audience: Audience = "social"): CandidatePoint[] {
  const modelPicks = points.filter((p) => p.recommended);
  const others = points.filter((p) => !p.recommended);
  const ranked = [...modelPicks, ...others];
  const picks =
    audience === "student" ? studentMix(ranked, max) : audience === "academic" ? linkedinMix(ranked, max) : ranked.slice(0, max);
  const pickSet = new Set(picks);
  return [
    ...picks.map((p) => ({ ...p, recommended: true })),
    ...points.filter((p) => !pickSet.has(p)).map((p) => ({ ...p, recommended: false })),
  ];
}

const STUDENT_RANK: Partial<Record<CandidatePoint["type"], number>> = { question: 0, method: 1 };
const isFinding = (p: CandidatePoint) => isFindingType(p.type);

/** Student picks: at most this many of each kind; findings fill the rest. */
const STUDENT_MAX = { question: 1, method: 2 };

/**
 * Student picks: 1 question, up to 2 method points and the rest findings, each kind in the
 * model's order (its recommended points first), always including the main result. Kinds that run
 * short are topped up from whatever is left. Ordered question -> method -> findings with the main
 * result last, the order the video tells them in.
 * Testing (Margalit): the model recommended 1 question + 4 methods and no finding at all.
 */
function studentMix(ranked: CandidatePoint[], max: number): CandidatePoint[] {
  const out: CandidatePoint[] = [
    ...ranked.filter((p) => p.type === "question").slice(0, STUDENT_MAX.question),
    ...ranked.filter((p) => p.type === "method").slice(0, STUDENT_MAX.method),
  ].slice(0, max);
  // The main result always goes in (as a finding), so the video answers its own question.
  const main = ranked.find((p) => p.main && isFinding(p));
  out.push(...ranked.filter((p) => isFinding(p) && p !== main).slice(0, max - out.length - (main ? 1 : 0)));
  if (main) out.push(main);
  out.push(...ranked.filter((p) => !out.includes(p)).slice(0, max - out.length));
  // Findings keep their order, with the main result last.
  return out
    .map((p, i) => ({ p, i: p === main ? Infinity : i }))
    .sort((a, b) => (STUDENT_RANK[a.p.type] ?? 2) - (STUDENT_RANK[b.p.type] ?? 2) || a.i - b.i)
    .map(({ p }) => p);
}

/** LinkedIn picks: at most this many of each non-finding kind; findings fill the rest. */
const LINKEDIN_MAX = { motivation: 1, method: 1, limitation: 1 };
/** LinkedIn video order: motivation, method, findings, limitation. */
const LINKEDIN_RANK: Partial<Record<CandidatePoint["type"], number>> = { motivation: 0, question: 0, method: 1, limitation: 3 };

/**
 * LinkedIn picks: 1 motivation, 1 method, 1 limitation and the rest findings, always including the
 * main result. Kinds that run short are topped up from what is left. Ordered motivation -> method
 * -> findings (main result first) -> limitation, the order the video tells them in.
 */
function linkedinMix(ranked: CandidatePoint[], max: number): CandidatePoint[] {
  const setup = (["motivation", "method", "limitation"] as const).flatMap((t) =>
    ranked.filter((p) => p.type === t).slice(0, LINKEDIN_MAX[t]),
  );
  const out: CandidatePoint[] = setup.slice(0, max);
  const main = ranked.find((p) => p.main && isFinding(p));
  if (main && out.length < max) out.push(main);
  out.push(...ranked.filter((p) => isFinding(p) && p !== main).slice(0, max - out.length));
  out.push(...ranked.filter((p) => !out.includes(p)).slice(0, max - out.length));
  return out
    .map((p, i) => ({ p, i: p === main ? -1 : i }))
    .sort((a, b) => (LINKEDIN_RANK[a.p.type] ?? 2) - (LINKEDIN_RANK[b.p.type] ?? 2) || a.i - b.i)
    .map(({ p }) => p);
}

export type VerifyResult = {
  kept: CandidatePoint[];
  dropped: { point: CandidatePoint; reason: string }[];
};

/** A point's evidence may join at most this many quoted pieces. */
const MAX_EVIDENCE_PIECES = 4;

/** Longest interruption allowed inside a quoted sentence: about one footnote or page header. */
const FOOTNOTE_GAP = 2000;
/** Words that must match on each side of such an interruption. */
const MIN_SIDE_WORDS = 5;

/**
 * Is this (matchKey'd) quote in the (matchKey'd) article? Exactly, or as two parts with one short
 * interruption between them: PDF text puts footnotes and page headers wherever the page broke.
 * Every word must still be there, in order. Testing (Olken): "To examine these alternative
 * approaches to fighting corruption, I [footnote 1 ...] designed and conducted a randomized..."
 */
export function foundInSource(piece: string, source: string): boolean {
  if (source.includes(piece)) return true;
  const words = piece.split(" ");
  for (let k = MIN_SIDE_WORDS; k <= words.length - MIN_SIDE_WORDS; k++) {
    const head = words.slice(0, k).join(" ");
    const tail = words.slice(k).join(" ");
    for (let at = source.indexOf(head); at >= 0; at = source.indexOf(head, at + 1)) {
      const after = at + head.length;
      const next = source.indexOf(tail, after);
      if (next >= 0 && next - after <= FOOTNOTE_GAP) return true;
    }
  }
  return false;
}

/** Small spelled-out numbers in a quote count as digits: Olken writes "about eight percentage points". */
const SPELLED: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90,
};
function spelledNumbers(s: string): string[] {
  const out: string[] = [];
  const words = s.toLowerCase().split(/[^a-z]+/);
  words.forEach((w, i) => {
    if (!(w in SPELLED)) return;
    out.push(String(SPELLED[w]));
    // "twenty five" / "twenty-five" -> 25
    if (SPELLED[w] >= 20 && SPELLED[words[i + 1]] < 10) out.push(String(SPELLED[w] + SPELLED[words[i + 1]]));
  });
  return out;
}

/**
 * Keep only points the article actually supports:
 * - the evidence sentence must appear (after normalizing) in the source text;
 * - every number in the point's wording must also appear in its evidence (as digits or spelled
 *   out), so the model can't invent or round a figure.
 */
export function verifyPoints(points: CandidatePoint[], sourceText: string): VerifyResult {
  const source = matchKey(sourceText);
  const result: VerifyResult = { kept: [], dropped: [] };

  for (const point of points) {
    // Methods are often spread over a few sentences, which the model joins with "...": each piece
    // must be in the article word for word, like the study setting. Testing (Margalit, Student):
    // 6 of 15 points, most of the method points, were dropped when only one whole sentence counted.
    const pieces = point.evidence.split(/\.{3}|…/).map(matchKey).filter(Boolean);
    const evidence = pieces.join(" ");
    if (evidence.length < 20 || pieces.length > MAX_EVIDENCE_PIECES || pieces.some((p) => p.length < 20)) {
      result.dropped.push({ point, reason: pieces.length > MAX_EVIDENCE_PIECES ? "evidence too long" : "evidence too short" });
      continue;
    }
    if (pieces.some((p) => !foundInSource(p, source))) {
      result.dropped.push({ point, reason: "evidence not found in article" });
      continue;
    }
    const evidenceNumbers = new Set([...numbersIn(evidence), ...spelledNumbers(evidence)]);
    // List markers aren't figures. Testing (Olken, LinkedIn): "comparing (1) audits and (2) two
    // grassroots interventions" dropped the only method point for "number 2 not in its evidence".
    const missing = numbersIn(point.text.replace(LIST_MARKER, " ")).filter((n) => !evidenceNumbers.has(n));
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
    if (!value || evidence.length < 20 || pieces.some((p) => p.length < 20 || !foundInSource(p, source))) return undefined;
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
