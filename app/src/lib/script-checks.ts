// Phase 3 script checks. Pure (type-only imports), so they can be tested with plain node.
import type { Audience, CandidatePoint, Chart, PointType, Popup, Script, StudySetting } from "./jobs";

/** ~150 words is ~55 s at TTS speed 1.1 (measured: the spike's 20 words took 5.97 s). */
export const DEFAULT_MAX_WORDS = 150;
const MIN_WORDS = 70;
const MAX_TITLE_WORDS = 7;

/** Words to aim for: at least 80% of the limit. Testing: the short prompt gave a 38 s Beath video. */
export const targetMinWords = (maxWords: number) => Math.round(maxWords * 0.8);

/** Problems worth one rewrite but not a failed run: on the last attempt the script is used anyway. */
export const SOFT_PROBLEM = /^(Too short|Too long|Jargon|Spoiler|Order)\b/;
// Up to 30% over is accepted on the last attempt: the recorded length is the real gate (one shorter
// rewrite over 60 s, never over 75 s). Testing: Bertrand failed outright at 200 words for 150.
const SOFT_OVER = 1.3;

// Research words the general public won't know. Testing: the "12-year-old" prompt rule alone still
// let "randomized", "referenda", "socioeconomic" and "0.095 standard units" through.
const JARGON =
  /\b(randomi[sz]ed|randomi[sz]ation|referenda|statistically significant|standard (?:deviations?|units?)|treatment group|control group|socioeconomic|coefficients?|heterogene\w+|regressions?|endline|baseline survey|ITT)\b/gi;

// Student videos teach the key method terms (the prompt asks to explain them in the same sentence),
// so only terms a first-year student can't be expected to know count as jargon.
const STUDENT_JARGON =
  /\b(standard (?:deviations?|units?)|coefficients?|heterogene\w+|regressions?|endline|ITT|referenda|principal components?(?: analysis)?)\b/gi;

/**
 * Length per audience. Social: ~150 words is ~55 s at TTS speed 1.1. Student: slower and calmer
 * (speed 1.0, ~2.5 words a second), so ~210 words is ~85 s.
 */
export function lengthFor(audience: Audience = "social") {
  return audience === "student"
    ? { maxWords: 210, targetS: 90, hardMaxS: 100, ttsSpeed: 1.0 }
    : { maxWords: DEFAULT_MAX_WORDS, targetS: 60, hardMaxS: 75, ttsSpeed: 1.1 };
}

/**
 * Student videos: the on-screen label for a part, from its point's type. The hook has none.
 * Other audiences: no labels.
 */
export function sectionFor(kind: "hook" | "beat" | "closing", pointType: PointType | undefined, audience: Audience = "social") {
  if (audience !== "student" || kind === "hook") return undefined;
  if (kind === "closing") return "WHY IT MATTERS";
  if (pointType === "question") return "THE QUESTION";
  if (pointType === "method") return "HOW THEY TESTED IT";
  return "WHAT THEY FOUND";
}

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

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90, hundred: 100,
};

/**
 * Numbers a point gives, as digits, including ones the article spells out. Testing: a point quoting
 * "one-of-eight male villagers" left the model no legal way to say it (digits required, but "8" wasn't
 * in the point), so it converted to "12.5 percent" and the run failed.
 */
function pointNumbers(s: string): string[] {
  const spelled = (s.toLowerCase().match(/\b[a-z]+\b/g) ?? []).filter((w) => w in NUMBER_WORDS).map((w) => String(NUMBER_WORDS[w]));
  return [...numbersIn(s), ...spelled];
}

/** Digits as written, thousands separators removed: "13,165" -> "13165". */
function numbersIn(s: string): string[] {
  // The number can't end in a comma: "In 2010, voters..." is 2010.
  return (s.match(/\d(?:[\d,]*\d)?(?:\.\d+)?/g) ?? []).map((n) => n.replace(/,(?=\d{3}\b)/g, ""));
}

// Spelled-out quantities could slip a figure past the digit check, so flag them.
// Testing: "After six weeks" slipped through when only "six percent" was flagged.
// A scale word after digits ("1.2 million") is fine.
const SPELLED_NUMBER =
  /\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety)\b|(?<!\d\s?)\b(hundred|thousand|million|billion)\b|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)(?:\s+|-)(?:percent|percentage|points?|weeks?|months?|years?|days?|hours?|times)\b/i;

const SMALL_NUMBERS = ["one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const SMALL_SPELLED = new RegExp(
  // Also hyphenated: "six-week" -> "6-week". Testing: a Student hook said "A six-week stock experiment".
  `\\b(${SMALL_NUMBERS.join("|")})(\\s+|-)(percent|percentage|points?|weeks?|months?|years?|days?|hours?|times)\\b`,
  "gi",
);

const UNITS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17,
  eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60,
  seventy: 70, eighty: 80, ninety: 90,
};
const SCALES: Record<string, number> = { hundred: 100, thousand: 1000, million: 1e6, billion: 1e9 };
const NUM_WORD = `(?:${[...Object.keys(UNITS), ...Object.keys(SCALES)].join("|")})`;
/** A run of number words: "fifty", "twenty-five", "one thousand five hundred and sixty". */
// Not after digits ("1.2 million" is already right); "a hundred" is taken whole.
const SPELLED_RUN = new RegExp(
  `(?<!\\d\\s?)\\b(?:an?\\s+(?=hundred|thousand|million|billion))?${NUM_WORD}(?:(?:[\\s-]+|\\s+and\\s+)${NUM_WORD})*\\b`,
  "gi",
);
const BIG_WORD = /\b(?:eleven|twelve|\w+teen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred|thousand|million|billion)\b/i;

/** "one thousand five hundred and sixty" -> 1560; null if the words don't form a number. */
function spelledValue(run: string): number | null {
  let total = 0;
  let current = 0;
  for (const w of run.toLowerCase().split(/[\s-]+/).filter((x) => !["and", "a", "an"].includes(x))) {
    if (w in UNITS) current += UNITS[w];
    else if (w === "hundred") current = (current || 1) * 100;
    else if (w in SCALES) {
      total += (current || 1) * SCALES[w];
      current = 0;
    } else return null;
  }
  return total + current;
}

/** "And the payoff:", "Here's the payoff —" at a sentence start (only with a colon or dash after it). */
const PAYOFF_LABEL = /(?<=^|[.!?]\s+)(?:and\s+)?(?:here(?:'s|’s|\s+is)\s+)?the\s+pay-?off\s*[:—–-]\s*/gi;

// Testing: "Would a small stock test nudge people...? The answer might surprise you."
const HOOK_FILLER = /\b(?:the answer (?:might|may|will) surprise you|you won'?t believe|guess what)\b/i;

// Testing: the model said "the biggest surprise comes at the end", "And the payoff:" and "that payoffPointId".
const STRUCTURE_TALK =
  /\b(payoff|pay-off|pointid|hooktitle|payoffpointid|in this video|this video|(?:stay|wait|watch) (?:to|till|until) the end|comes at the end|at the end of (?:this|the) video|loop)\b/i;

const SYMBOLS = /[%()[\]{}<>#@*_~|\\/^=+$£€₹]|\b(?:e\.g|i\.e|etc|Rs|USD|INR)\b/i;

/** "Rs 1,120", "$50", "£50", "USD 3 million" -> amount + currency word (autoFixScript). */
const CURRENCY_WORD: Record<string, string> = { rs: "rupees", inr: "rupees", "₹": "rupees", $: "dollars", usd: "dollars", "£": "pounds", "€": "euros" };
const CURRENCY = /(\bRs\.?|\bINR|\bUSD|₹|\$|£|€)\s?(\d(?:[\d,]*\d)?(?:\.\d+)?)(\s(?:thousand|million|billion))?/gi;

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
export function autoFixScript(
  script: Script,
  points: CandidatePoint[],
  audience: Audience = "social",
): { script: Script; fixes: string[] } {
  const fixes: string[] = [];
  const nums = percentagePointNumbers(points);
  const fix = (label: string, text: string, short = false): string => {
    // Testing: the model wrote "headmen s houses" and "male elites preferences"-style possessives.
    let out = text.replace(/\b([A-Za-z]{2,}) s\b/g, (_m, w: string) => {
      fixes.push(`${label}: "${w} s" -> "${w}'s"`);
      return `${w}'s`;
    });
    // Small spelled numbers before a unit have one right answer: "six weeks" -> "6 weeks".
    out = out.replace(SMALL_SPELLED, (m, word: string, gap: string, unit: string) => {
      const digits = `${SMALL_NUMBERS.indexOf(word.toLowerCase()) + 1}${gap === "-" ? "-" : " "}${unit}`;
      fixes.push(`${label}: "${m}" -> "${digits}"`);
      return digits;
    });
    // Larger spelled numbers have one right answer too: "fifty pounds" -> "50 pounds". The digit
    // check then still makes sure the number is in the point. Testing: the point said "£50", the
    // prompt says no symbols, and the model wrote "fifty pounds" in all 3 attempts.
    // Small ones without a unit ("one in eight") are left alone.
    out = out.replace(SPELLED_RUN, (m) => {
      const value = BIG_WORD.test(m) ? spelledValue(m) : null;
      if (value == null) return m;
      const digits =
        value >= 1e6 && value % 1e6 === 0 ? `${value / 1e6} million` : value.toLocaleString("en-US");
      fixes.push(`${label}: "${m}" -> "${digits}"`);
      return digits;
    });
    // A label for the last beat has one right fix: drop it. Testing: "And the payoff: 62 percent of..."
    const unlabelled = out.replace(PAYOFF_LABEL, (m) => {
      fixes.push(`${label}: dropped "${m.trim()}"`);
      return "";
    });
    if (unlabelled !== out) {
      // Capitalize what now starts a sentence: "62 percent" stays, "of those" -> "Of those".
      out = unlabelled.replace(/(^|[.!?]\s+)([a-z])/g, (_m, pre: string, c: string) => pre + c.toUpperCase());
    }
    // Currency signs and codes read badly aloud. Testing: "Rs 1,120" (rupees) reached the voice.
    out = out.replace(CURRENCY, (m, sign: string, amount: string, scale = "") => {
      const spoken = `${amount}${scale} ${CURRENCY_WORD[sign.toLowerCase().replace(".", "")]}`;
      fixes.push(`${label}: "${m}" -> "${spoken}"`);
      return spoken;
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
  // Testing also saw a separate "rehook" beat: any beat that isn't a chosen point joins the next beat
  // (or the previous one, if it's last).
  let beats = script.beats;
  const ids = new Set(points.map((p) => p.id));
  for (let i = 0; i < beats.length && beats.length > 1; ) {
    if (ids.has(beats[i].pointId)) {
      i++;
      continue;
    }
    const stray = beats[i];
    const j = i + 1 < beats.length ? i + 1 : i - 1;
    const target = beats[j];
    if (!ids.has(target.pointId)) break; // two strays in a row: leave it to the checks
    const text = j > i ? `${stray.text.trim()} ${target.text.trim()}` : `${target.text.trim()} ${stray.text.trim()}`;
    fixes.push(`Merged the separate "${stray.pointId}" beat into beat ${target.pointId}`);
    const merged = { ...target, text, popup: target.popup?.word ? target.popup : stray.popup };
    beats = beats.flatMap((b, k) => (k === i ? [] : k === j ? [merged] : [b]));
  }
  let payoffPointId = script.payoffPointId;
  // Student videos tell the study in order (question, method, findings) and end on a finding; both
  // have one right answer. Testing (Olken): the soft order check let finding -> method -> finding ->
  // finding -> method through on the last attempt, with a method point as the payoff.
  if (audience === "student") {
    const rank = (id: string) => {
      const t = points.find((p) => p.id === id)?.type;
      return t === "question" ? 0 : t === "method" ? 1 : 2;
    };
    const findings = beats.filter((b) => rank(b.pointId) === 2);
    // The study's main result is the payoff: the video ends on the answer to its question.
    const main = points.find((p) => p.main && beats.some((b) => b.pointId === p.id) && rank(p.id) === 2);
    if (main && payoffPointId !== main.id) {
      fixes.push(`Payoff set to the main result ${main.id}`);
      payoffPointId = main.id;
    } else if (payoffPointId && rank(payoffPointId) !== 2 && findings.length) {
      fixes.push(`Payoff ${payoffPointId} is not a finding; used ${findings[findings.length - 1].pointId}`);
      payoffPointId = findings[findings.length - 1].pointId;
    }
    const sorted = beats.map((b, i) => ({ b, i })).sort((x, y) => rank(x.b.pointId) - rank(y.b.pointId) || x.i - y.i).map(({ b }) => b);
    if (sorted.some((b, i) => b !== beats[i])) {
      fixes.push(`Reordered beats question -> method -> findings: ${sorted.map((b) => b.pointId).join(", ")}`);
      beats = sorted;
    }
  }
  // The payoff beat belongs last; moving it there has one right answer, so don't spend a rewrite on it.
  const payoffAt = beats.findIndex((b) => b.pointId === payoffPointId);
  // (Not the first beat: it opens with where and when, so the model must rewrite that one.)
  if (payoffAt > 0 && payoffAt !== beats.length - 1) {
    beats = [...beats.slice(0, payoffAt), ...beats.slice(payoffAt + 1), beats[payoffAt]];
    fixes.push(`Moved payoff beat ${payoffPointId} to the end`);
  }
  const fixed: Script = {
    ...script,
    payoffPointId,
    hook: fix("Hook", script.hook),
    beats: beats.map((b) => {
      const text = fix(`Beat ${b.pointId}`, b.text);
      const popup = cleanPopup(b.popup, text);
      if (b.popup?.word && !popup) fixes.push(`Beat ${b.pointId}: dropped pop-up "${b.popup.word}"`);
      const point = points.find((p) => p.id === b.pointId);
      const checked = point ? checkChart(b.chart, point.evidence, text) : { problem: "no point" };
      if ("problem" in checked && b.chart && (b.chart.kind as string) !== "none") {
        fixes.push(`Beat ${b.pointId}: dropped ${b.chart.kind} chart (${checked.problem})`);
      }
      return { ...b, text, popup, chart: "chart" in checked ? checked.chart : undefined };
    }),
    closing: fix("Closing", script.closing),
    hookTitle: script.hookTitle === undefined ? undefined : fix("Hook title", script.hookTitle, true),
    postCaption: script.postCaption === undefined ? undefined : fix("Post caption", script.postCaption),
  };
  return { script: fixed, fixes };
}

const plainWords = (s: string) => s.toLowerCase().replace(/[’']/g, "'").replace(/[^a-z0-9' ]+/g, " ").replace(/\s+/g, " ").trim();
/** Same word up to a plural or possessive ending, so the pop-up word "village" matches "villages"
 *  (testing: most pop-ups were lost to plurals). */
const sameWord = (a: string, b: string) => {
  const base = (w: string) => w.replace(/'s?$/, "");
  const [x, y] = [base(a), base(b)];
  return x === y || x + "s" === y || y + "s" === x || x + "es" === y || y + "es" === x;
};
// Pop-up words that can't be photographed (testing: "strange part", and numbers despite the prompt).
const ABSTRACT = new Set(
  "part parts result results effect effects influence change changes difference finding findings study surprise share percent percentage points thing things way".split(" "),
);

/**
 * Keep a beat's pop-up only if it can be timed and searched: 1-3 words, no digits, said in the beat
 * (so the word timestamps can place it), and a search to look it up. Never a reason to rewrite.
 */
export function cleanPopup(popup: Popup | undefined, beatText: string): Popup | undefined {
  const word = plainWords(popup?.word ?? "");
  const query = plainWords(popup?.query ?? "").split(" ").slice(0, 3).join(" ");
  if (!query) return undefined;
  const said = plainWords(beatText).split(" ");
  // The beat's own spelling of `want`, matched word by word ("village" finds "villages").
  const find = (want: string[]) => {
    const at = said.findIndex((_, i) => want.every((x, k) => said[i + k] !== undefined && sameWord(said[i + k], x)));
    return at < 0 ? undefined : said.slice(at, at + want.length).join(" ");
  };
  const usable = (w: string) => !!w && !/\d/.test(w) && countWords(w) <= 3 && !ABSTRACT.has(w.split(" ").pop()!); // main noun last: "strange PART"
  const found = usable(word) ? find(word.split(" ")) : undefined;
  if (found) return { word: found, query };
  // Fallback: time it to a word of the photo search the beat says, main noun first. Testing: in
  // beats with a number the model kept choosing the number ("45 percent") despite the prompt.
  const keys = query.split(" ").filter((w) => w.length > 2 && usable(w));
  for (const k of [...keys].reverse()) {
    const hit = find([k]);
    if (hit) return { word: hit, query };
  }
  return undefined;
}

// Label words that needn't be in the source sentence ("the control group" vs "control group").
const LABEL_FILLER = new Set("a an the of in on at to for and or with by from group groups".split(" "));
// Time words a "change" chart may use for its two sides without the source saying them.
const CHANGE_LABELS = new Set(["before", "after", "then", "now", "start", "end"]);
const CHART_SIZES: Record<Chart["kind"], [number, number]> = { bars: [2, 3], change: [2, 2], share: [1, 1] };

/**
 * Keep a beat's chart only if everything on it comes from the point's source sentence: each value
 * is a number written there (same digits, no rounding), each label's words are there, the unit is
 * there, and the beat says each value (so it can appear on its word). Charts never cause a rewrite:
 * a failed one is dropped and the beat keeps its plain big-number callout.
 */
export function checkChart(
  chart: Chart | undefined,
  evidence: string,
  beatText: string,
): { chart: Chart } | { problem: string } {
  if (!chart || !(chart.kind in CHART_SIZES)) return { problem: "none" };
  const [min, max] = CHART_SIZES[chart.kind];
  const items = (chart.items ?? []).map((i) => ({
    label: plainWords(i.label ?? "").split(" ").slice(0, 4).join(" "),
    value: String(i.value ?? "").replace(/[,%\s]/g, ""),
  }));
  if (items.length < min || items.length > max) return { problem: `${items.length} items` };
  const sourceNums = new Set(numbersIn(evidence));
  const saidNums = new Set(numbersIn(beatText));
  // Word stems, so a label's "obtained" matches the source's "obtain" (testing: Bertrand).
  const stem = (w: string) => singular(w).replace(/(ing|ed|d)$/, "");
  const sourceWords = plainWords(evidence).split(" ").map(stem);
  const unit = plainWords(chart.unit ?? "");
  for (const it of items) {
    if (!/^\d+(\.\d+)?$/.test(it.value)) return { problem: `value "${it.value}" is not a number` };
    if (/^(19|20)\d{2}$/.test(it.value)) return { problem: `value ${it.value} is a year` }; // years are labels, not bars
    if (!sourceNums.has(it.value)) return { problem: `${it.value} is not in the source sentence` };
    if (!saidNums.has(it.value)) return { problem: `${it.value} is not said in the beat` };
    const words = it.label.split(" ").filter((w) => w && !LABEL_FILLER.has(w));
    if (chart.kind !== "share" && !words.length) return { problem: "empty label" };
    const generic = (w: string) => chart.kind === "change" && CHANGE_LABELS.has(w);
    const missing = words.find((w) => !sourceWords.includes(stem(w)) && !sourceNums.has(w) && !generic(w));
    if (missing) return { problem: `label word "${missing}" is not in the source sentence` };
  }
  if (new Set(items.map((i) => i.value + "|" + i.label)).size < items.length) return { problem: "repeated item" };
  if (unit === "percent") {
    if (!items.every((it) => asPercent(it.value).test(evidence.replace(/,(?=\d{3}\b)/g, "")))) return { problem: "not percent in the source" };
    if (items.some((it) => Number(it.value) > 100)) return { problem: "percent over 100" };
  } else if (unit === "percentage points") {
    if (!/percentage[- ]points?|\bp\.?p\b/i.test(evidence)) return { problem: "not percentage points in the source" };
  } else if (unit) {
    if (countWords(unit) > 2) return { problem: "unit too long" };
    const missing = unit.split(" ").find((w) => !sourceWords.includes(stem(w)));
    if (missing) return { problem: `unit "${unit}" is not in the source sentence` };
  }
  if (chart.kind === "share" && unit !== "percent") return { problem: "share needs a percent" };
  return { chart: { kind: chart.kind, items, unit } };
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
  // "6-week period" counts as "6 week period". Testing (Margalit): "over 6 weeks" was rejected
  // because the article only wrote "a 6-week period".
  const prep = (s: string) => s.replace(/,(?=\d{3}\b)/g, "").replace(/(\d)-(?=[A-Za-z])/g, "$1 ");
  const sourceWords = after(prep(source));
  const uses = after(prep(text));
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
  audience: Audience = "social",
  /** The /create flow lets Student videos open on a question hook (the closing then leads into it). */
  opts: { allowQuestionHook?: boolean } = {},
): string[] {
  const problems: string[] = [];
  const jargonWords = audience === "student" ? STUDENT_JARGON : JARGON;

  // Student videos tell the study in order: the question, how it was tested, then the findings.
  if (audience === "student") {
    const rank = (id: string) => {
      const t = points.find((p) => p.id === id)?.type;
      return t === "question" ? 0 : t === "method" ? 1 : 2;
    };
    const ranks = script.beats.map((b) => rank(b.pointId));
    if (ranks.some((r, i) => i > 0 && r < ranks[i - 1])) {
      problems.push("Order: put the question beat first, then the method beats, then the findings.");
    }
  }

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

  const allowedEverywhere = new Set(points.flatMap((p) => pointNumbers(`${p.text} ${p.evidence}`)));
  const byId = new Map(points.map((p) => [p.id, new Set(pointNumbers(`${p.text} ${p.evidence}`))]));
  // Where and when: the study's years (setting) and counts (setting or opening) may be said anywhere.
  const years = yearsIn(setting);
  // Numbers in the setting's own values are verified against the article, so they may be said with
  // any noun. Testing: the sample "822 driver's license candidates" was said as "822 people".
  const settingValues = new Set(
    [...setting.matchAll(/^(?:Place|Period|Sample): (.*?) \(article: /gm)].flatMap((m) => numbersIn(m[1])),
  );
  const context = `${sourceOpening}\n${setting}`.trim();
  const fromOpening = (n: string, text: string) =>
    years.has(n) || settingValues.has(n) || (context !== "" && numberInContext(n, text, context));

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
    const jargon = [...new Set((text.match(jargonWords) ?? []).map((w) => w.toLowerCase()))];
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
  if (script.payoffPointId !== undefined && script.hook.includes("?") && !opts.allowQuestionHook) {
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
      popup: b.popup,
      chart: b.chart,
    })),
    { kind: "closing" as const, text: script.closing, broll: script.closingBroll, shots: script.closingShots },
  ];
}
