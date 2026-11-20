// Phase 3 script checks. Pure (type-only imports), so they can be tested with plain node.
import type { CandidatePoint, Script, StudySetting } from "./jobs";

/** ~150 words is ~55 s at TTS speed 1.1 (measured: the spike's 20 words took 5.97 s). */
export const DEFAULT_MAX_WORDS = 150;
const MIN_WORDS = 70;
const MAX_TITLE_WORDS = 7;

/** Words to aim for: at least 80% of the limit. Testing: the short prompt gave a 38 s Beath video. */
export const targetMinWords = (maxWords: number) => Math.round(maxWords * 0.8);

/** Problems worth one rewrite but not a failed run: on the last attempt the script is used anyway. */
export const SOFT_PROBLEM = /^(Too short|Too long|Jargon|Spoiler)\b/;
/** Up to 15% over the word limit only costs a rewrite, not the run. */
const SOFT_OVER = 1.15;

// Research words the general public won't know. Testing: the "12-year-old" prompt rule alone still
// let "randomized", "referenda", "socioeconomic" and "0.095 standard units" through.
const JARGON =
  /\b(randomi[sz]ed|randomi[sz]ation|referenda|statistically significant|standard (?:deviations?|units?)|treatment group|control group|socioeconomic|coefficients?|heterogene\w+|regressions?|endline|baseline survey|ITT)\b/gi;

/** The STUDY SETTING block the script model sees (and the checks allow numbers from). */
export function settingBlock(setting: StudySetting | null | undefined): string {
  const line = (label: string, f?: { value: string; evidence: string }) =>
    `${label}: ${f ? `${f.value} (article: "${f.evidence}")` : "unknown"}`;
  return [line("Place", setting?.place), line("Period", setting?.period), line("Sample", setting?.sample)].join("\n");
}

/** Lowercase letters only, accents removed, so "Shayo" matches "SHAYO" and "Müller" matches "Muller". */
const plain = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const MONTHS = "January|February|March|April|May|June|July|August|September|October|November|December";
const PUBLICATION_YEAR = [
  // "Journal of Development Economics 124 (2017) 199-213"
  /\b(?:Journal|Review|Quarterly|Studies|Proceedings|Science|Politics|Economics|Sociology|Policy|Research)\b[^\n()]{0,80}\(((?:19|20)\d{2})\)/g,
  // "© 2020 The Authors", "Copyright 2019"
  /(?:©|\(c\)|Copyright)\s*((?:19|20)\d{2})\b/gi,
  // "Vol. 65, No. 2, April 2021, Pp. 1-17"
  new RegExp(`\\b(?:Vol|No)\\.?\\s*\\d+,\\s*(?:${MONTHS})\\s+((?:19|20)\\d{2})\\b`, "g"),
];

/**
 * The article's publication year from its front matter (journal header, copyright line, issue date),
 * or undefined. The latest one wins: received/accepted dates come before publication.
 * Testing: the model credited Beath et al. (2017) as "2013", a year that appears elsewhere in the paper.
 */
export function publicationYear(articleText: string): string | undefined {
  // Front matter, wherever PDF extraction put it: the start and the end of the text.
  const front = `${articleText.slice(0, 8000)}\n${articleText.slice(-3000)}`;
  const thisYear = new Date().getFullYear();
  const years = PUBLICATION_YEAR.flatMap((re) => [...front.matchAll(re)].map((m) => Number(m[1]))).filter(
    (y) => y >= 1900 && y <= thisYear,
  );
  return years.length ? String(Math.max(...years)) : undefined;
}

/**
 * Build the on-screen source credit from the model's suggestion: keep only surnames that appear in
 * the article, take the year from the article's front matter (never the model), and format it
 * APA-style ("Surname, 2021", "Surname & Surname, 2021", "Surname et al., 2021" for 3+ authors).
 * Returns undefined when that can't be done reliably (a missing credit is better than a wrong one).
 */
export function verifyCredit(credit: string | undefined, articleText: string): string | undefined {
  const c = credit?.trim();
  if (!c) return undefined;
  // No publication line (e.g. a working paper): credit the authors without a year rather than guess one.
  const year = publicationYear(articleText);
  const withYear = (names: string) => (year ? `${names}, ${year}` : names);
  const hadEtAl = /\bet al\b/i.test(c);
  const names = c
    .replace(/\bet al\.?/gi, "")
    .replace(/\b(19|20)\d{2}\b/g, "")
    .split(/[\s,&]+|\band\b/)
    .filter((w) => w.length > 1);
  // Authors are named right under the title (within ~250 characters in the test papers). A wider window
  // would match people the article discusses: Margalit's introduction mentions "Adam Smith" at ~1,700.
  const front = plain(articleText.slice(0, 1200));
  if (!names.length || !names.every((n) => front.includes(plain(n)))) return undefined;
  if (names.length >= 3 || hadEtAl) return withYear(`${names[0]} et al.`);
  return withYear(names.length === 2 ? `${names[0]} & ${names[1]}` : names[0]);
}

/** Digits as written, thousands separators removed: "13,165" -> "13165". */
function numbersIn(s: string): string[] {
  // The number can't end in a comma: "In 2010, voters..." is 2010.
  return (s.match(/\d(?:[\d,]*\d)?(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, ""));
}

// Spelled-out quantities could slip a figure past the digit check, so flag them.
// Testing: "After six weeks" slipped through when only "six percent" was flagged.
const SPELLED_NUMBER =
  /\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:percent|percentage|points?|weeks?|months?|years?|days?|hours?|times)\b/i;

const SMALL_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const SMALL_SPELLED = new RegExp(
  `\\b(${SMALL_NUMBERS.join("|")})\\s+(percent|percentage|points?|weeks?|months?|years?|days?|hours?|times)\\b`,
  "gi",
);

// Testing: "Would a small stock test nudge people...? The answer might surprise you."
const HOOK_FILLER = /\b(?:the answer (?:might|may|will) surprise you|you won'?t believe|guess what)\b/i;

// Testing: the model said "the biggest surprise comes at the end", "And the payoff:" and "that payoffPointId".
const STRUCTURE_TALK =
  /\b(payoff|pay-off|pointid|hooktitle|payoffpointid|in this video|this video|(?:stay|wait|watch) (?:to|till|until) the end|comes at the end|at the end of (?:this|the) video|loop)\b/i;

const SYMBOLS =/[%()[\]{}<>#@*_~|\\/^=+]|\b(?:e\.g|i\.e|etc)\b/i;

export function countWords(s: string): number {
  return s.trim() ? s.trim().split(/\s+/).length : 0;
}

export function scriptWordCount(script: Script): number {
  return [script.hook, ...script.beats.map((b) => b.text), script.closing].reduce((n, t) => n + countWords(t), 0);
}

const escapeNum = (n: string) => n.replace(/\./g, "\\.");
/** "7.5 percent" / "7.5%" (but not "7.5 percentage points"). */
const asPercent = (n: string, flags = "i") => new RegExp(`(?<![\\d.])${escapeNum(n)}\\s*(?:%|percent(?!age))`, flags);

/**
 * Numbers the chosen points give ONLY in percentage points ("7.5 percentage points"), never as plain
 * percent. Testing: the model kept turning "7.5 percentage points" into "7.5 percent", even after
 * being told, which made whole runs fail.
 */
export function percentagePointNumbers(points: CandidatePoint[]): Set<string> {
  const pp = new Set<string>();
  const plain = new Set<string>();
  for (const p of points) {
    const t = `${p.text} ${p.evidence}`;
    for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:percentage|%-?\s*)\s*points?/gi)) pp.add(m[1]);
    for (const m of t.matchAll(/(\d[\d,]*(?:\.\d+)?)\s*(?:%(?!-?\s*points?)|percent(?!age))/gi)) plain.add(m[1]);
  }
  return new Set([...pp].filter((n) => !plain.has(n)));
}

/**
 * Fix slips that have exactly one right answer, so they never cost a rewrite or a failed run.
 * Only "percent" -> "percentage points" for numbers the article gives only in percentage points.
 * Returns the fixed script and what was changed.
 */
export function autoFixScript(script: Script, points: CandidatePoint[]): { script: Script; fixes: string[] } {
  const fixes: string[] = [];
  const nums = percentagePointNumbers(points);
  const fix = (label: string, text: string, short = false): string => {
    // Testing: the model wrote "headmen s houses" and "male elites preferences"-style possessives.
    let out = text.replace(/\b([A-Za-z]{2,}) s\b/g, (_m, w: string) => {
      fixes.push(`${label}: "${w} s" -> "${w}'s"`);
      return `${w}'s`;
    });
    // Small spelled numbers before a unit have one right answer: "six weeks" -> "6 weeks".
    out = out.replace(SMALL_SPELLED, (m, word: string, unit: string) => {
      const digits = `${SMALL_NUMBERS.indexOf(word.toLowerCase()) + 1} ${unit}`;
      fixes.push(`${label}: "${m}" -> "${digits}"`);
      return digits;
    });
    // The everyday plural; the points often copy the article's "referenda".
    out = out.replace(/\breferenda\b/gi, (m) => {
      fixes.push(`${label}: "${m}" -> "referendums"`);
      return m[0] === "R" ? "Referendums" : "referendums";
    });
    for (const n of nums) {
      const re = asPercent(n, "gi");
      if (re.test(out)) {
        out = out.replace(asPercent(n, "gi"), `${n} ${short ? "points" : "percentage points"}`);
        fixes.push(`${label}: "${n} percent" -> "${n} ${short ? "points" : "percentage points"}"`);
      }
    }
    return out;
  };
  // Testing: the model often put where/when in its own first beat ("setting", "studySetting") instead of
  // opening the first point's beat with it. Merge it into the next beat rather than spend a rewrite.
  let beats = script.beats;
  const ids = new Set(points.map((p) => p.id));
  if (beats.length > 1 && !ids.has(beats[0].pointId) && ids.has(beats[1].pointId)) {
    fixes.push(`Merged the separate "${beats[0].pointId}" beat into beat ${beats[1].pointId}`);
    beats = [{ ...beats[1], text: `${beats[0].text.trim()} ${beats[1].text.trim()}` }, ...beats.slice(2)];
  }
  // The payoff beat belongs last; moving it there has one right answer, so don't spend a rewrite on it.
  const payoffAt = beats.findIndex((b) => b.pointId === script.payoffPointId);
  // (Not the first beat: it opens with where and when, so the model must rewrite that one.)
  if (payoffAt > 0 && payoffAt !== beats.length - 1) {
    beats = [...beats.slice(0, payoffAt), ...beats.slice(payoffAt + 1), beats[payoffAt]];
    fixes.push(`Moved payoff beat ${script.payoffPointId} to the end`);
  }
  const fixed: Script = {
    ...script,
    hook: fix("Hook", script.hook),
    beats: beats.map((b) => ({ ...b, text: fix(`Beat ${b.pointId}`, b.text) })),
    closing: fix("Closing", script.closing),
    hookTitle: script.hookTitle === undefined ? undefined : fix("Hook title", script.hookTitle, true),
    postCaption: script.postCaption === undefined ? undefined : fix("Post caption", script.postCaption),
  };
  return { script: fixed, fixes };
}

/** Problems that only affect optional extras: the video can still be made without those fields. */
export const OPTIONAL_FIELD_PROBLEM = /^(Hook title|Post caption)\b/;

const singular = (w: string) => w.toLowerCase().replace(/[^a-z]/g, "").replace(/(ies)$/, "y").replace(/s$/, "");

/**
 * True if the number appears in the source with the same noun after it (within 3 words), e.g. the
 * hook's "250 villages" matches the abstract's "250 villages across Afghanistan". A bare number
 * isn't enough: "250 percent" or "250 people" must not pass because "250" appears somewhere.
 */
export function numberInContext(n: string, text: string, source: string): boolean {
  const after = (s: string) =>
    [...s.matchAll(new RegExp(`(?<![\\d.,])${escapeNum(n)}(?![\\d]|\\.\\d)((?:\\s+[A-Za-z][\\w-]*){1,3})`, "g"))].map((m) =>
      m[1].trim().split(/\s+/).map(singular),
    );
  const sourceWords = after(source.replace(/,(?=\d{3}\b)/g, ""));
  const uses = after(text.replace(/,(?=\d{3}\b)/g, ""));
  if (!uses.length) return false;
  // Every use of the number in the text needs its next word to follow the number in the source too.
  // (First two words, so "250 Afghan villages" still matches "250 villages"; filler words don't count.)
  const FILLER = new Set(["of", "in", "the", "a", "an", "and", "to", "for", "from", "across", "more", "than"]);
  return uses.every((u) =>
    u.slice(0, 2).some((w) => !FILLER.has(w) && sourceWords.some((s) => s.includes(w))),
  );
}

/** Four-digit years (1900 to this year) written in the text, e.g. the study's "2007 and 2011". */
export function yearsIn(text: string): Set<string> {
  const thisYear = new Date().getFullYear();
  return new Set(
    [...text.matchAll(/(?<![\d.,])((?:19|20)\d{2})(?![\d]|\.\d)/g)].map((m) => m[1]).filter((y) => Number(y) <= thisYear),
  );
}

/**
 * Returns a list of problems; an empty list means the script can be recorded.
 * sourceOpening: the article's title + opening (what the model sees). Any part may use a count from it
 * with the same noun after it ("250 villages").
 * setting: the STUDY SETTING block (verified place/period/sample). Any part may use its years
 * ("from 2007 to 2011") and counts, so the script can say where and when the study took place.
 * (Years from the opening alone aren't allowed: there they are mostly citations of other papers.)
 */
export function checkScript(
  script: Script,
  points: CandidatePoint[],
  maxWords: number,
  sourceOpening = "",
  setting = "",
): string[] {
  const problems: string[] = [];

  // Any order (the script tells the story), but each chosen point exactly once, payoff last.
  const expectedIds = points.map((p) => p.id);
  const gotIds = script.beats.map((b) => b.pointId);
  if ([...gotIds].sort().join(",") !== [...expectedIds].sort().join(",")) {
    problems.push(`Beats must cover each of these point ids exactly once: ${expectedIds.join(", ")} (got ${gotIds.join(", ") || "none"}).`);
  }
  if (script.payoffPointId !== undefined) {
    if (!expectedIds.includes(script.payoffPointId)) {
      problems.push(`payoffPointId "${script.payoffPointId}" is not one of the chosen points.`);
    } else if (gotIds.at(-1) !== script.payoffPointId) {
      problems.push(`The payoff point ${script.payoffPointId} must be the last beat.`);
    }
  }

  const allowedEverywhere = new Set(points.flatMap((p) => numbersIn(`${p.text} ${p.evidence}`)));
  const byId = new Map(points.map((p) => [p.id, new Set(numbersIn(`${p.text} ${p.evidence}`))]));
  // Where and when: the study's years (setting) and counts (setting or opening) may be said anywhere.
  const years = yearsIn(setting);
  const context = `${sourceOpening}\n${setting}`.trim();
  const fromOpening = (n: string, text: string) =>
    years.has(n) || (context !== "" && numberInContext(n, text, context));

  for (const beat of script.beats) {
    const allowed = byId.get(beat.pointId) ?? new Set<string>();
    const bad = numbersIn(beat.text).filter((n) => !allowed.has(n) && !fromOpening(n, beat.text));
    if (bad.length) problems.push(`Beat ${beat.pointId} uses number(s) ${bad.join(", ")} that are not in that point.`);
  }
  // On-screen and posted text must not invent figures either.
  const framing = [
    ["Hook", script.hook],
    ["Closing", script.closing],
    ["Hook title", script.hookTitle ?? ""],
    ["Post caption", script.postCaption ?? ""],
  ] as const;
  for (const [label, text] of framing) {
    const bad = numbersIn(text).filter(
      (n) => !allowedEverywhere.has(n) && !fromOpening(n, text),
    );
    if (bad.length) problems.push(`${label} uses number(s) ${bad.join(", ")} that are not in any chosen point.`);
  }

  const spoken = [["Hook", script.hook], ...script.beats.map((b) => [`Beat ${b.pointId}`, b.text]), ["Closing", script.closing]];
  for (const [label, text] of spoken) {
    if (/\bp\d+\b/i.test(text)) problems.push(`${label} contains a point id (like "p1") in the spoken text; remove it.`);
    if (/\d\s*[-–—]\s*\d/.test(text)) problems.push(`${label} writes a range with a dash; write "9 to 12", not "9-12".`);
    if (SPELLED_NUMBER.test(text)) problems.push(`${label} spells a number in words; use digits.`);
    if (SYMBOLS.test(text)) problems.push(`${label} contains symbols or abbreviations that read badly aloud.`);
    const jargon = [...new Set((text.match(JARGON) ?? []).map((w) => w.toLowerCase()))];
    if (jargon.length) {
      problems.push(`Jargon: ${label} uses ${jargon.map((w) => `"${w}"`).join(", ")}; say it in everyday words.`);
    }
    if (STRUCTURE_TALK.test(text)) {
      problems.push(`${label} talks about the video itself or a field name ("payoff", "at the end", "in this video"); tease with content instead.`);
    }
  }

  // "Percentage points" are not "percent" (autoFixScript corrects this first; this is the safety net).
  const allText: [string, string][] = [
    ...(spoken as [string, string][]),
    ["Hook title", script.hookTitle ?? ""],
    ["Post caption", script.postCaption ?? ""],
  ];
  for (const n of percentagePointNumbers(points)) {
    for (const [label, text] of allText) {
      if (asPercent(n).test(text)) problems.push(`${label} calls ${n} "percent"; in the article it is ${n} percentage points.`);
    }
  }

  // Seamless loop: the closing must be an unfinished lead-in that the hook completes.
  if (script.payoffPointId !== undefined && /[.!?]["”']?\s*$/.test(script.closing.trim())) {
    problems.push(`Closing ends with punctuation; it must end with an unfinished lead-in that the hook's first words complete (e.g. "...and that is exactly why").`);
  }
  // A question hook can't complete the closing's lead-in ("...exactly why would a small test...?").
  if (script.payoffPointId !== undefined && script.hook.includes("?")) {
    problems.push(`Hook is a question; make it a statement that completes the closing's last words as one sentence.`);
  }
  // Open loop: the hook teases the payoff, it doesn't give its number away. Testing: "elite picks fell
  // from 39 percent to 23 percent" in the hook, with the same figures as the last beat.
  const payoff = points.find((p) => p.id === script.payoffPointId);
  if (payoff) {
    const spoiled = numbersIn(payoff.text).filter((n) => numbersIn(script.hook).includes(n));
    if (spoiled.length) {
      problems.push(`Spoiler: the hook gives away the payoff's number(s) ${spoiled.join(", ")}; tease the result without them.`);
    }
  }
  if (HOOK_FILLER.test(script.hook)) {
    problems.push(`Hook uses filler ("the answer might surprise you"); tease with a concrete fact instead.`);
  }
  // Testing: the closing ended "...and that is exactly why Can Stocks Shift Views" (the on-screen title).
  const words_ = (s: string) => s.toLowerCase().replace(/[^\w\s]/g, " ").replace(/\s+/g, " ").trim();
  if (script.hookTitle && countWords(script.hookTitle) >= 3 && words_(script.closing).includes(words_(script.hookTitle))) {
    problems.push(`Closing repeats the hook title; end it with a lead-in only, the hook itself follows on replay.`);
  }
  if (script.postCaption !== undefined) {
    const tags = script.postCaption.match(/#\w+/g) ?? [];
    if (tags.length < 3 || tags.length > 5) problems.push(`Post caption has ${tags.length} hashtags; end it with 3 to 5.`);
  }

  if (script.hookTitle !== undefined && countWords(script.hookTitle) > MAX_TITLE_WORDS) {
    problems.push(`Hook title is ${countWords(script.hookTitle)} words; the limit is ${MAX_TITLE_WORDS}.`);
  }

  const words = scriptWordCount(script);
  // Slightly long is soft: the recorded audio is measured anyway, and a voice over 60 s gets a shorter redraft.
  if (words > maxWords * SOFT_OVER) problems.push(`Script is ${words} words; the limit is ${maxWords}.`);
  else if (words > maxWords) problems.push(`Too long: the script is ${words} words; the limit is ${maxWords}.`);
  if (words < MIN_WORDS) problems.push(`Script is only ${words} words; aim for ${MIN_WORDS}-${maxWords}.`);
  else if (words < targetMinWords(maxWords)) {
    problems.push(`Too short: the script is ${words} words; use ${targetMinWords(maxWords)} to ${maxWords} (add detail to the beats).`);
  }

  return problems;
}

/** Flatten a script into the ordered segments that get recorded. */
export function scriptSegments(script: Script) {
  return [
    { kind: "hook" as const, text: script.hook, broll: script.hookBroll, shots: script.hookShots },
    ...script.beats.map((b) => ({
      kind: "beat" as const,
      pointId: b.pointId,
      text: b.text,
      broll: b.broll,
      shots: b.shots,
    })),
    { kind: "closing" as const, text: script.closing, broll: script.closingBroll, shots: script.closingShots },
  ];
}
