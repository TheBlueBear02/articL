// Phase 3: turn the selected points into a spoken script, and check it before recording.
import { chatJson, type Usage } from "./openai";
import { CHART_KINDS, type Audience, type CandidatePoint, type Script, type StudySetting } from "./jobs";
import { settingBlock, targetMinWords } from "./script-checks";
export {
  autoFixScript,
  checkScript,
  DEFAULT_MAX_WORDS,
  lengthFor,
  OPTIONAL_FIELD_PROBLEM,
  sectionFor,
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
- chart (each beat): an on-screen chart, only for numbers the beat says that compare.
  kind "bars": the same measure for 2-3 groups (e.g. women vs men); "change": the same measure at
  2 times or before vs after (labels such as "2007" and "2011"); "share": a single percentage of a
  whole ("24 percent of villages"); "none" for anything else (one count, money, years, no number).
  items, in the order the beat says them: label is 1-3 words copied from the point's source sentence
  ("women", "control villages", "2007"); value is the number as digits exactly as the source sentence
  writes it, no symbols ("31.2"). unit: "percent", "percentage points", 1-2 words from the source
  sentence ("rupees"), or "". All items share the unit, and the beat must say every value.
  Chart only what the source sentence itself compares: both values of a change, or each group's
  value on the same measure. Never add a starting 0, a baseline or a total it doesn't give, and
  never put two different measures on one chart. "percentage points" (an effect size) is never a
  share. If unsure, "none": the beat's number is still shown big on screen.
  With "none": items [] and unit "".
- broll and shots for the hook, each beat and the closing: broll is 2-4 words for the topic;
  shots are 3 visually different stock-video searches of at most 3 concrete, filmable words
  (e.g. "voting booth", "coins"). No abstract ideas, arrows or icons.

Rules (checked automatically):
- Plain spoken English for a text-to-speech voice: short sentences, no symbols, abbreviations or
  parentheses. Write "percent", ranges as "9 to 12", and every number as digits ("6 weeks"); money as digits plus the
  currency word ("50 pounds", not "£50" or "fifty pounds").
  Apostrophes are fine and needed: "headmen's houses", "don't".
- If a 12-year-old wouldn't know a word (e.g. "randomized", "referenda", "socioeconomic",
  "market exposure"), say it in everyday words instead.
- Use only facts and numbers from the chosen points and STUDY SETTING. Never round, change or
  convert a number ("1 in 8" stays "1 in 8", not "12.5 percent"); "percentage points" are not "percent".
- Never mention the video itself ("in this video", "at the end", "payoff", "loop", field names).
- Use {MIN_WORDS} to {MAX_WORDS} words across hook, beats and closing.`;

/** Replace one exact part of the Social prompt; fails loudly if the Social prompt changed under it. */
function swap(prompt: string, from: string, to: string): string {
  if (!prompt.includes(from)) throw new Error(`Student prompt: part not found in the Social prompt: ${from.slice(0, 40)}`);
  return prompt.replace(from, to);
}

// Student videos: the same fields, checks and loop, told as question -> how it was tested -> what
// was found -> why it matters. Only the intro, the beat order and the jargon rule differ.
const STUDENT_PROMPT = [
  [
    SYSTEM_PROMPT.slice(0, SYSTEM_PROMPT.indexOf("You get the article's title")),
    `You write the script for a 60 to 90 second vertical video that explains a research study to
students who want to understand what it asked, how it was tested and what it found.

After watching, the student should know:
- the research question,
- how the study was done: where, when and with whom (from STUDY SETTING) and the method (from the
  "question" and "method" points),
- the main findings, and why they matter.

`,
  ],
  [
    `- payoffPointId: the most surprising chosen point.`,
    `- payoffPointId: the point marked "the main result" if there is one, otherwise the most important finding (not a question or method point).`,
  ],
  [
    `- beats: exactly one per chosen point (pointId is that point's id; no extra beats), 1-3 sentences each, ordered as a story with the payoff point last.
  The first beat opens with where, when and with whom the study was done (only what STUDY SETTING
  gives), then its point; there is no separate setting beat. Start one middle beat with a short
  re-hook such as "But here's the strange part".
  The payoff beat states its key number.`,
    `- beats: exactly one per chosen point (pointId is that point's id; no extra beats), 1-3 sentences each, in this order:
  the "question" point(s) first, then the "method" points, then the findings, with the payoff point last.
  The first beat states the research question and where, when and with whom the study was done (only
  what STUDY SETTING gives); there is no separate setting beat. Method beats say plainly what the
  researchers did, step by step ("First...", "Then..."). Findings beats state their numbers.`,
  ],
  [
    `- closing: the takeaway in one sentence,`,
    `- closing: why the findings matter, in one sentence,`,
  ],
  [
    `- If a 12-year-old wouldn't know a word (e.g. "randomized", "referenda", "socioeconomic",
  "market exposure"), say it in everyday words instead.`,
    `- Key research terms are welcome when the same sentence explains them ("randomly assigned, like a
  coin flip", "a control group that got nothing"). Any other term a first-year student wouldn't know
  (e.g. "coefficients", "heterogeneity", "endline") must be said in everyday words.`,
  ],
].reduce((p, [from, to]) => swap(p, from, to), SYSTEM_PROMPT);

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
        required: ["pointId", "text", "broll", "shots", "popup", "chart"],
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
          chart: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "items", "unit"],
            properties: {
              kind: { type: "string", enum: ["none", ...CHART_KINDS] },
              items: {
                type: "array",
                items: {
                  type: "object",
                  additionalProperties: false,
                  required: ["label", "value"],
                  properties: { label: { type: "string" }, value: { type: "string" } },
                },
              },
              unit: { type: "string" },
            },
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
  /** Who the video is for; "student" tells it as question -> method -> findings. */
  audience?: Audience;
  /** /create flow: the hook, lead finding and beat order the user already chose. */
  fixed?: FixedParts;
};

export type FixedParts = {
  hook: string;
  hookTitle: string;
  /** The lead finding: the payoff, last beat. */
  payoffPointId: string;
  /** Beat order (point ids), lead last. */
  order: string[];
  /** Student question hook: the closing leads into a question. */
  questionHook?: boolean;
};

export async function draftScript(input: DraftInput): Promise<{ script: Script; usage: Usage; model: string }> {
  const pointsBlock = input.points
    .map((p) => `- id ${p.id} (${p.type}${p.main ? ", the main result" : ""}): ${p.text}\n  Source sentence: "${p.evidence}"`)
    .join("\n");
  // Testing (Bertrand, 5 points): the model left a point out in 2 of 3 drafts and wrote 200 words for a
  // 150-word limit. Naming every beat and giving each part a word budget keeps both in check.
  const ids = input.points.map((p) => p.id);
  const perBeat = Math.max(12, Math.floor((input.maxWords - 30) / Math.max(1, ids.length)));
  const plan =
    `\n\nBEATS NEEDED: exactly ${ids.length}, one for each of ${ids.join(", ")}; leave none out.` +
    `\nWORD BUDGET: hook about 15 words, each beat about ${perBeat} words, closing about 15 words.`;
  const fixed = input.fixed
    ? `\n\nALREADY CHOSEN (keep exactly):` +
      `\n- hook: "${input.fixed.hook}"\n- hookTitle: "${input.fixed.hookTitle}"` +
      `\n- payoffPointId: ${input.fixed.payoffPointId}` +
      `\n- BEAT ORDER: ${input.fixed.order.join(", ")} (in exactly this order)` +
      (input.fixed.questionHook
        ? `\nThe hook is a question. The closing ends with an unfinished lead-in that the question` +
          ` follows naturally on replay (e.g. "...which leaves one question").`
        : "")
    : "";
  const feedback = input.feedback?.length
    ? `\n\nYour previous draft was rejected. Fix these problems:\n- ${input.feedback.join("\n- ")}`
    : "";

  const { data: raw, usage, model } = await chatJson<Script>({
    system: (input.audience === "student" ? STUDENT_PROMPT : SYSTEM_PROMPT).replace("{MAX_WORDS}", String(input.maxWords)).replace(
      "{MIN_WORDS}",
      String(targetMinWords(input.maxWords)),
    ),
    user:
      `TITLE: ${input.title}\n\nOPENING OF THE ARTICLE:\n${input.opening}\n\n` +
      `STUDY SETTING:\n${settingBlock(input.setting)}\n\nCHOSEN POINTS:\n${pointsBlock}${plan}${fixed}${feedback}`,
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
  return { script: input.fixed ? withFixedParts(data, input.fixed) : data, usage, model };
}

/** Put the user's hook, lead and beat order back in, whatever the model wrote. */
function withFixedParts(script: Script, fixed: FixedParts): Script {
  const byId = new Map(script.beats.map((b) => [b.pointId, b]));
  const sameSet = script.beats.length === fixed.order.length && fixed.order.every((id) => byId.has(id));
  return {
    ...script,
    hook: fixed.hook,
    hookTitle: fixed.hookTitle,
    payoffPointId: fixed.payoffPointId,
    beats: sameSet ? fixed.order.map((id) => byId.get(id)!) : script.beats,
  };
}
