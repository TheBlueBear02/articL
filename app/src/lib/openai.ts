import type { PointType, SettingFact } from "./jobs";

// Prototype choice (Nov 2026), per 1M tokens in/out:
//   gpt-5-mini  $0.25 / $2.00 -> ~$0.007 per article; kept 13 of 15 points on the Margalit paper, plain wording.
//   gpt-5-nano  $0.05 / $0.40 -> ~$0.0013 per article; kept only 5-10 points per run, often jargon.
// TODO(after prototype): revisit — retry gpt-5-nano or a newer cheap model on real articles.
// Override any time with OPENAI_MODEL in .env.
const DEFAULT_MODEL = "gpt-5-mini";

export type RawPoint = { type: PointType; text: string; evidence: string; recommended: boolean };
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
          type: { type: "string", enum: ["stat", "quote", "claim"] },
          text: { type: "string" },
          evidence: { type: "string" },
          recommended: { type: "boolean" },
        },
      },
    },
  },
};

export type Usage = { input_tokens: number; output_tokens: number; reasoning_tokens: number };

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
}): Promise<{ data: T; model: string; usage: Usage }> {
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${openaiKey()}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      reasoning_effort: "minimal", // fewest billed reasoning tokens
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.user },
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
    },
  };
}

export async function proposePoints(articleText: string): Promise<ProposeResult> {
  const { data, model, usage } = await chatJson<{ points?: RawPoint[]; setting?: RawSetting }>({
    system: SYSTEM_PROMPT,
    user: `ARTICLE:\n\n${articleText}`,
    schemaName: "candidate_points",
    schema: SCHEMA,
  });
  return { points: data.points ?? [], setting: data.setting ?? {}, model, usage };
}
