// Phase 3: turn the selected points into a spoken script, and check it before recording.
import { chatJson, type Usage } from "./openai";
import type { CandidatePoint, Script, StudySetting } from "./jobs";
import { settingBlock, targetMinWords } from "./script-checks";
export {
  autoFixScript,
  checkScript,
  DEFAULT_MAX_WORDS,
  OPTIONAL_FIELD_PROBLEM,
  SOFT_PROBLEM,
  scriptSegments,
  scriptWordCount,
  settingBlock,
  verifyCredit,
} from "./script-checks";

const SYSTEM_PROMPT = `You write the script for a 60-second vertical video (Reels, TikTok) that explains a research article
to the general public: curious adults with no background in the field.

After watching, the viewer should know:
- the study's main findings (from the chosen points),
- where and when it took place and who it covered (from STUDY SETTING),
- why it matters to them.

You get the article's title, its opening, the study setting, and the points the user chose.

Write these fields:
- payoffPointId: the most surprising chosen point.
- hook: 1-2 statements that stop the scroll within 2 seconds: a surprising number or a
  counter-intuitive claim. Never a question, and no filler like "the answer might surprise you".
  Tease the payoff point without revealing its result.
- hookTitle: the hook as on-screen text, at most 7 words, no final punctuation.
- beats: exactly one per chosen point (pointId is that point's id; no extra beats), 1-3 sentences each, ordered as a story with the payoff point last.
  The first beat opens with where, when and with whom the study was done (only what STUDY SETTING
  gives), then its point; there is no separate setting beat. Start one middle beat with a short
  re-hook such as "But here's the strange part".
  The payoff beat states its key number.
- closing: the takeaway in one sentence, ending with an unfinished lead-in (no final punctuation)
  that the hook's first words complete, so closing + hook read as one sentence, e.g.
  "...and that is exactly why" + "owning stocks can change how you vote." Never repeat the hook
  or hook title inside the closing.
- sourceCredit: "Surname, 2021", "Surname & Surname, 2021" or "Surname et al., 2021" from the
  title or opening; "" if not given.
- postCaption: 1-2 sentences on the main finding, a line asking viewers to share or comment,
  then a line of 3 to 5 hashtags.
- popup (each beat): a thing the beat's text literally says that you could photograph, popped up
  on screen as it is spoken. "word": 1-3 words copied exactly as written in that beat; "query": a
  1-3 word photo search for it. Good: "villages", "ballot box", "female elites", "headmen's houses",
  "stock market". Bad: "45 percent" (a number), "strange part" (not a thing), "women" when the beat
  says "female elites" (not the beat's words). If the beat names nothing photographable, "" for both.
- broll and shots for the hook, each beat and the closing: broll is 2-4 words for the topic;
  shots are 3 visually different stock-video searches of at most 3 concrete, filmable words
  (e.g. "voting booth", "coins"). No abstract ideas, arrows or icons.

Rules (checked automatically):
- Plain spoken English for a text-to-speech voice: short sentences, no symbols, abbreviations or
  parentheses. Write "percent", ranges as "9 to 12", and every number as digits ("6 weeks").
  Apostrophes are fine and needed: "headmen's houses", "don't".
- If a 12-year-old wouldn't know a word (e.g. "randomized", "referenda", "socioeconomic",
  "market exposure"), say it in everyday words instead.
- Use only facts and numbers from the chosen points and STUDY SETTING. Never round, change or
  convert a number ("1 in 8" stays "1 in 8", not "12.5 percent"); "percentage points" are not "percent".
- Never mention the video itself ("in this video", "at the end", "payoff", "loop", field names).
- Use {MIN_WORDS} to {MAX_WORDS} words across hook, beats and closing.`;

const SHOTS = { type: "array", items: { type: "string" } };

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "payoffPointId",
    "hook",
    "hookTitle",
    "hookBroll",
    "hookShots",
    "beats",
    "closing",
    "closingBroll",
    "closingShots",
    "sourceCredit",
    "postCaption",
  ],
  properties: {
    payoffPointId: { type: "string" },
    hook: { type: "string" },
    hookTitle: { type: "string" },
    sourceCredit: { type: "string" },
    postCaption: { type: "string" },
    hookBroll: { type: "string" },
    hookShots: SHOTS,
    beats: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["pointId", "text", "broll", "shots", "popup"],
        properties: {
          pointId: { type: "string" },
          text: { type: "string" },
          broll: { type: "string" },
          shots: SHOTS,
          popup: {
            type: "object",
            additionalProperties: false,
            required: ["word", "query"],
            properties: { word: { type: "string" }, query: { type: "string" } },
          },
        },
      },
    },
    closing: { type: "string" },
    closingBroll: { type: "string" },
    closingShots: SHOTS,
  },
};

/** Keep shot searches short (Pixabay matches 1-3 words best) and drop empties. */
const DANGLING = /\s+(a|an|the|and|or|of|in|on|at|to|for|with|by|from)$/i;
const tidyShots = (shots: string[] | undefined, broll: string) => {
  const out = (shots ?? [])
    .map((s) => {
      let short = s.trim().split(/\s+/).slice(0, 3).join(" ");
      while (DANGLING.test(short)) short = short.replace(DANGLING, ""); // "person smiling at" -> "person smiling"
      return short;
    })
    .filter(Boolean)
    .slice(0, 3);
  return out.length ? out : [broll];
};

export type DraftInput = {
  title: string;
  opening: string;
  points: CandidatePoint[]; // the selected points (the script picks the video order)
  /** Verified place/period/sample from the whole article (empty if unknown). */
  setting?: StudySetting | null;
  maxWords: number;
  /** Problems with the previous attempt, so the model can fix them. */
  feedback?: string[];
};

export async function draftScript(input: DraftInput): Promise<{ script: Script; usage: Usage; model: string }> {
  const pointsBlock = input.points
    .map((p) => `- id ${p.id} (${p.type}): ${p.text}\n  Source sentence: "${p.evidence}"`)
    .join("\n");
  const feedback = input.feedback?.length
    ? `\n\nYour previous draft was rejected. Fix these problems:\n- ${input.feedback.join("\n- ")}`
    : "";

  const { data: raw, usage, model } = await chatJson<Script>({
    system: SYSTEM_PROMPT.replace("{MAX_WORDS}", String(input.maxWords)).replace(
      "{MIN_WORDS}",
      String(targetMinWords(input.maxWords)),
    ),
    user:
      `TITLE: ${input.title}\n\nOPENING OF THE ARTICLE:\n${input.opening}\n\n` +
      `STUDY SETTING:\n${settingBlock(input.setting)}\n\nCHOSEN POINTS:\n${pointsBlock}${feedback}`,
    schemaName: "reel_script",
    schema: SCHEMA,
  });
  // Belt and braces: strip a leaked "p1:" style id from the start of a beat before it's spoken.
  const data: Script = {
    ...raw,
    hookTitle: raw.hookTitle?.trim().replace(/[.!?]+$/, "") || undefined,
    sourceCredit: raw.sourceCredit?.trim() || undefined,
    postCaption: raw.postCaption?.trim() || undefined,
    hookShots: tidyShots(raw.hookShots, raw.hookBroll),
    closingShots: tidyShots(raw.closingShots, raw.closingBroll),
    beats: raw.beats.map((b) => ({
      ...b,
      text: b.text.replace(/^\s*p\d+\s*[:.\-–)]?\s*/i, ""),
      shots: tidyShots(b.shots, b.broll),
    })),
  };
  return { script: data, usage, model };
}
