import type { Audience, PointType, SettingFact } from "./jobs";

// Prototype choice (Nov 2026), per 1M tokens in/out:
//   gpt-5-mini  $0.25 / $2.00 -> ~$0.007 per article; kept 13 of 15 points on the Margalit paper, plain wording.
//   gpt-5-nano  $0.05 / $0.40 -> ~$0.0013 per article; kept only 5-10 points per run, often jargon.
// TODO(after prototype): revisit — retry gpt-5-nano or a newer cheap model on real articles.
// Override any time with OPENAI_MODEL in .env.
const DEFAULT_MODEL = "gpt-5-mini";

export type RawPoint = { type: PointType; text: string; evidence: string; recommended: boolean; main?: boolean };
export type RawSetting = { place?: SettingFact; period?: SettingFact; sample?: SettingFact };
export type ProposeResult = { points: RawPoint[]; setting: RawSetting; model: string; usage: Usage };

const SYSTEM_PROMPT = `You help turn articles into 60-second vertical videos.
From the article, propose 12 to 15 candidate points a viewer would find interesting.
Each point is one of:
- "stat": a concrete number, percentage or measured effect
- "quote": a striking sentence worth reading out as-is
- "claim": a key finding, argument or conclusion

Rules:
- "text": 1-2 short, plain-English sentences suited to being spoken in a video to the general public. Keep any number exactly as the article states it, but replace research jargon (e.g. "referenda", "statistically significant", "treatment group", "standard deviations") with everyday words.
- "evidence": ONE sentence copied word for word from the article that supports the point, including any parentheses inside it. Do not paraphrase, shorten, fix typos, add commentary or merge sentences.
- Cover the article's main findings; prefer concrete results over methods details.
- Skip citations, author lists, table and figure captions, and references to other papers.
- No duplicate points.

Then mark EXACTLY 5 points with "recommended": true (all others false): the 5 that together make
the best 60-second video for a general audience. Prefer a mix that tells one clear story:
an attention-grabbing finding to open with, concrete numbers, and a takeaway. Avoid recommending
points that repeat each other or need technical background to understand.
List the 5 recommended points first, in the order they would work best in the video.

Also fill "setting": where and when the study itself took place and who it covered (not other
studies it cites). For each of "place" (e.g. "250 villages in Afghanistan", "England"), "period"
(when the data was collected, e.g. "2007 to 2011", "2016") and "sample" (e.g. "2,703 voters"):
"value" is a few plain words and "evidence" is the sentence copied word for word from the article
that states it (if it takes several sentences, copy each one whole, joined by " ... "). If the
article does not state it, write "" for both.`;

const FACT = {
  type: "object",
  additionalProperties: false,
  required: ["value", "evidence"],
  properties: { value: { type: "string" }, evidence: { type: "string" } },
};

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["points", "setting"],
  properties: {
    setting: {
      type: "object",
      additionalProperties: false,
      required: ["place", "period", "sample"],
      properties: { place: FACT, period: FACT, sample: FACT },
    },
    points: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "text", "evidence", "recommended"],
        properties: {
          type: { type: "string", enum: ["stat", "quote", "claim"] as string[] },
          text: { type: "string" },
          evidence: { type: "string" },
          recommended: { type: "boolean" },
        },
      },
    },
  },
};

export type Usage = { input_tokens: number; output_tokens: number; reasoning_tokens: number; cached_tokens?: number };

export function openaiKey(): string {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is not set");
  return apiKey;
}

/** One Chat Completions call with a strict JSON schema; returns the parsed object. */
export async function chatJson<T>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: object;
  /** Image URLs shown to the model after the text (low detail: ~85 tokens each). */
  images?: string[];
}): Promise<{ data: T; model: string; usage: Usage }> {
  const userContent = opts.images?.length
    ? [
        { type: "text", text: opts.user },
        ...opts.images.map((url) => ({ type: "image_url", image_url: { url, detail: "low" } })),
      ]
    : opts.user;
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning_effort: "minimal", // fewest billed reasoning tokens
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: userContent },
      ],
      response_format: {
        type: "json_schema",
        json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
      },
    }),
  });
  if (!res.ok) throw new Error(`OpenAI request failed: ${res.status} ${await res.text()}`);

  const json = await res.json();
  const message = json.choices?.[0]?.message;
  if (message?.refusal) throw new Error(`Model refused: ${message.refusal}`);
  return {
    data: JSON.parse(message?.content ?? "{}") as T,
    model: json.model ?? model,
    usage: {
      input_tokens: json.usage?.prompt_tokens ?? 0,
      output_tokens: json.usage?.completion_tokens ?? 0,
      reasoning_tokens: json.usage?.completion_tokens_details?.reasoning_tokens ?? 0,
      cached_tokens: json.usage?.prompt_tokens_details?.cached_tokens ?? 0,
    },
  };
}

// Student videos explain the research question and how it was tested, not just the findings.
const STUDENT_PROMPT = `You help turn research articles into 60-90 second vertical videos for students who
want to understand what a study asked, how it was done and what it found.
From the article, propose 12 to 15 candidate points. Each point is one of:
- "question": the research question the study set out to answer (1 or 2 such points)
- "method": how it was tested: who took part, the groups, what was given or changed, what was
  measured and how (3 to 5 such points)
- "stat": a concrete result, percentage or measured effect
- "claim": a key finding or conclusion
- "quote": a striking sentence worth reading out as-is

Rules:
- "text": 1-2 short, plain-English sentences a first-year student understands. Keep any number
  exactly as the article states it. Key research terms ("randomly assigned", "control group",
  "survey") are fine when the sentence makes their meaning clear; replace other jargon.
- "evidence": the sentence copied word for word from the article that supports the point, including
  any parentheses inside it. If a method takes several sentences, copy each one whole (at most 3),
  joined by " ... ". Do not paraphrase, shorten, fix typos or add commentary.
- The "question" evidence is the article's own sentence stating what it asks or tests (e.g. "We ask
  whether...", "This paper examines...").
- Skip citations, author lists, table and figure captions, and references to other papers.
- No duplicate points.

Then mark EXACTLY 5 points with "recommended": true (all others false), which together explain the
study: 1 "question", 1 or 2 "method" points, and 2 or 3 findings ("stat", "claim" or "quote").
The findings must include the study's main result: the direct answer to the research question
(e.g. "the audits reduced missing funds by 8 percentage points"), not only background numbers.
List the 5 recommended points first, in this order: question, method, findings (main result last).

Mark EXACTLY 1 point with "main": true (all others false): that main result, as a "stat" or
"claim". Keep it simple so it can be checked: its evidence is ONE sentence, and its text uses only
numbers from that sentence.

Also fill "setting": where and when the study itself took place and who it covered (not other
studies it cites). For each of "place" (e.g. "250 villages in Afghanistan", "England"), "period"
(when the data was collected, e.g. "2007 to 2011", "2016") and "sample" (e.g. "2,703 voters"):
"value" is a few plain words and "evidence" is the sentence copied word for word from the article
that states it (if it takes several sentences, copy each one whole, joined by " ... "). If the
article does not state it, write "" for both.`;

/** Same shape as SCHEMA, with the Student point types. */
const STUDENT_SCHEMA = (() => {
  const s = structuredClone(SCHEMA);
  const item = s.properties.points.items as { properties: Record<string, unknown>; required: string[] };
  s.properties.points.items.properties.type.enum = ["question", "method", "stat", "claim", "quote"];
  item.properties.main = { type: "boolean" };
  item.required = [...item.required, "main"];
  return s;
})();

// LinkedIn videos (the "academic" audience): a calm ~90 s summary for peers and policymakers, told
// as motivation -> method -> findings -> limitation (spec: "ArticL LinkedIn Reel Spec" in Notion).
const LINKEDIN_PROMPT = `You help turn research articles into calm, professional 90-second videos that
researchers share on LinkedIn with peers and policymakers.
From the article, propose 12 to 15 candidate points. Each point is one of:
- "motivation": why the question matters in the real world, or what was not known before this
  study (1 or 2 such points)
- "method": how the study was done: the data or sample, the design, what was compared or measured
  (2 to 4 such points)
- "stat": a concrete result, percentage or measured effect
- "claim": a key finding or conclusion
- "quote": a striking sentence worth reading out as-is
- "limitation": what the study itself says it cannot show, or a caveat it states (1 or 2 such points)

Rules:
- "text": 1-2 short, plain, professional sentences. Keep any number exactly as the article states
  it. Standard research terms ("randomized", "survey", "control group") are fine; explain anything
  more technical in plain words.
- "evidence": the sentence copied word for word from the article that supports the point, including
  any parentheses inside it. If a method takes several sentences, copy each one whole (at most 3),
  joined by " ... ". Do not paraphrase, shorten, fix typos or add commentary.
- A "limitation" must be stated by the article itself (e.g. "We cannot rule out...", "One
  limitation is..."), never your own criticism.
- Skip citations, author lists, table and figure captions, and references to other papers.
- No duplicate points.

Then mark EXACTLY 6 points with "recommended": true (all others false): 1 "motivation", 1 "method",
3 findings ("stat", "claim" or "quote") and 1 "limitation". The findings must include the study's
main result: the direct answer to its research question, not only background numbers.
List the 6 recommended points first, in this order: motivation, method, findings (main result
first), limitation.

Mark EXACTLY 1 point with "main": true (all others false): that main result, as a "stat" or
"claim". Keep it simple so it can be checked: its evidence is ONE sentence, and its text uses only
numbers from that sentence.

Also fill "setting": where and when the study itself took place and who it covered (not other
studies it cites). For each of "place" (e.g. "250 villages in Afghanistan", "England"), "period"
(when the data was collected, e.g. "2007 to 2011", "2016") and "sample" (e.g. "2,703 voters"):
"value" is a few plain words and "evidence" is the sentence copied word for word from the article
that states it (if it takes several sentences, copy each one whole, joined by " ... "). If the
article does not state it, write "" for both.`;

const LINKEDIN_SCHEMA = (() => {
  const s = structuredClone(STUDENT_SCHEMA);
  s.properties.points.items.properties.type.enum = ["motivation", "method", "stat", "claim", "quote", "limitation"];
  return s;
})();

export async function proposePoints(articleText: string, audience: Audience = "social"): Promise<ProposeResult> {
  const [system, schema] =
    audience === "student" ? [STUDENT_PROMPT, STUDENT_SCHEMA] : audience === "academic" ? [LINKEDIN_PROMPT, LINKEDIN_SCHEMA] : [SYSTEM_PROMPT, SCHEMA];
  const { data, model, usage } = await chatJson<{ points?: RawPoint[]; setting?: RawSetting }>({
    system,
    user: `ARTICLE:\n\n${articleText}`,
    schemaName: "candidate_points",
    schema,
  });
  return { points: data.points ?? [], setting: data.setting ?? {}, model, usage };
}

// Student and LinkedIn videos need the study's main result. When its quote fails the check, it is
// asked for on its own. Testing (Olken, LinkedIn): the model wrote "about eight percentage points"
// into a quote whose sentence says "about 30 percent of the level", in both full attempts.
const MAIN_RESULT_PROMPT = `You find the main result of a research study: the direct answer to its research
question (e.g. "the audits reduced missing funds by 8 percentage points"), not background numbers.

Return one point:
- "type": "stat" if it has a number, else "claim".
- "text": 1-2 short, plain sentences stating the result. Use only numbers that appear in "evidence",
  always as digits ("8 percentage points", even where the sentence says "eight").
- "evidence": ONE sentence copied character for character from the article that states the result.
  Copy it exactly as printed, including its own wording of numbers ("eight", "30 percent of the
  level"). Never merge sentences, shorten, paraphrase or fix anything. Prefer a sentence from the
  abstract, introduction or conclusion that states the result in words.`;

const MAIN_RESULT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["type", "text", "evidence"],
  properties: {
    type: { type: "string", enum: ["stat", "claim"] },
    text: { type: "string" },
    evidence: { type: "string" },
  },
};

/** Ask only for the main result, with an exactly copied sentence. `failed` is the wording whose quote failed. */
export async function proposeMainResult(
  articleText: string,
  failed?: { text: string; evidence: string; reason: string },
): Promise<{ point: RawPoint; model: string; usage: Usage }> {
  const hint = failed
    ? `\n\nA previous attempt was rejected (${failed.reason}):\n- text: ${failed.text}\n- evidence: "${failed.evidence}"\n` +
      `Find the sentence the article actually prints and copy it exactly.`
    : "";
  const { data, model, usage } = await chatJson<{ type: "stat" | "claim"; text: string; evidence: string }>({
    system: MAIN_RESULT_PROMPT,
    user: `ARTICLE:\n\n${articleText}${hint}`,
    schemaName: "main_result",
    schema: MAIN_RESULT_SCHEMA,
  });
  return { point: { ...data, recommended: true, main: true }, model, usage };
}

const PICK_PHOTO_PROMPT = `You choose a stock photo for a short educational video about a research study.
A small photo pops up on screen while the narrator says a word. You see numbered candidate photos.
Pick the one that best shows that word as MEANT (what the script means by it) in the sentence, in a
setting that fits the study.

A photo fits only if a viewer would recognize MEANT in it at a glance. A photo of something else that
merely shares the word (a car's license plate for driving licenses, a realtor or a police badge for
agents who arrange paperwork) does not fit.

The photo does NOT have to show the study's country: a neutral photo (a dirt road, a ballot box, hands
holding money, a simple house) is fine. Reject a photo (answer 0 if all are rejected) only when it:
- clearly shows a different part of the world (e.g. Alpine chalets, a Swiss flag or a European church
  for villages in Afghanistan),
- shows the word in a different situation than the sentence and study describe (e.g. a corporate
  office meeting for village meetings in Afghanistan, a modern city for a rural study),
- shows another meaning of the word than MEANT (e.g. a COVID or medical test for a driving test, a
  real-estate agent for agents who arrange paperwork, any motorbike for "licenses"),
- is about something else that only shares a tag (holidays, pets, food, unrelated people),
- is a drawing, cartoon, 3D render or mostly text,
- could mislead a viewer about the study.
A plain, clear photo that fits is better than a striking one that doesn't.`;

// Judge every photo before choosing. Testing: asked only for "the best one", the model picked a
// corporate office meeting for village meetings in Afghanistan, as the best of a poor set.
const PICK_PHOTO_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["photos", "choice", "reason"],
  properties: {
    photos: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["number", "shows", "fits"],
        properties: {
          number: { type: "integer" },
          shows: { type: "string" },
          fits: { type: "boolean" },
        },
      },
    },
    choice: { type: "integer" },
    reason: { type: "string" },
  },
};

/**
 * Ask a vision model which candidate photo fits a pop-up word, or none.
 * Returns the 0-based index into `imageUrls`, or -1 when none fits.
 */
export async function pickPhoto(opts: {
  word: string;
  /** What the script means by the word: its own photo search ("failed driving test"). */
  meant?: string;
  sentence: string;
  place?: string;
  imageUrls: string[];
}): Promise<{ index: number; reason: string; usage: Usage; model: string }> {
  const { data, usage, model } = await chatJson<{ photos: { number: number; shows: string; fits: boolean }[]; choice: number; reason: string }>({
    system: PICK_PHOTO_PROMPT,
    user:
      `WORD: ${opts.word}\nMEANT: ${opts.meant || opts.word}\nSENTENCE: ${opts.sentence}\nWHERE THE STUDY TOOK PLACE: ${opts.place || "not stated"}\n` +
      `There are ${opts.imageUrls.length} photos, numbered 1 to ${opts.imageUrls.length} in the order shown. ` +
      `First, for EACH photo: "shows" = what and where it shows in a few words, "fits" = true only if ` +
      `none of the reject rules apply. Then "choice" = the number of the best photo that fits, or 0 if ` +
      `none fits, and a short "reason".`,
    schemaName: "photo_pick",
    schema: PICK_PHOTO_SCHEMA,
    images: opts.imageUrls,
  });
  const n = Math.round(data.choice);
  // Only accept a choice the model itself judged as fitting.
  const fits = data.photos?.some((p) => p.number === n && p.fits);
  const index = fits && n >= 1 && n <= opts.imageUrls.length ? n - 1 : -1;
  const verdicts = (data.photos ?? []).map((p) => `${p.number}${p.fits ? "+" : "-"} ${p.shows}`).join("; ");
  return { index, reason: `${data.reason ?? ""} [${verdicts}]`, usage, model };
}
