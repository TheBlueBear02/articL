import "server-only";
import { chatJson, type Usage } from "./openai";
import { checkScript, settingBlock } from "./script-checks";
import {
  hookTypesFor,
  type Audience,
  type CandidatePoint,
  type HookOption,
  type HookType,
  type Script,
  type StudySetting,
} from "./jobs";

const TYPE_RULES: Record<HookType, string> = {
  number: `"number": opens on the most striking number from the chosen points or the study setting, said
  so it makes people stop ("1 in 3 village leaders..."). Not the lead finding's own number: that is
  revealed at the end, so the hook only teases it.`,
  myth: `"myth": names something most people believe, then says this study points the other way, teasing
  the lead finding without giving away its number.`,
  you: `"you": speaks straight to the viewer's own life, as a statement ("If you have ever waited weeks for
  a driving test, this study is about you."), then teases the lead finding without its number.`,
  question: `"question": the research question in plain words, as a direct question to the viewer
  ("Can a single audit stop officials from stealing?"). The only type that may end with a question mark.`,
};

const SYSTEM = (types: HookType[]) => `You write the opening line (the hook) of a short vertical video about a research study.
The hook has to stop the scroll within 2 seconds, and it teases the LEAD FINDING, which the video
reveals at the end.

Write exactly ${types.length} hooks, one per line below and in this order (if a type is listed twice,
make the two clearly different):
${types.map((t) => `- ${TYPE_RULES[t]}`).join("\n")}

For each:
- hook: 1-2 short spoken sentences, about 15 words. A statement (except the question type).
  No filler like "the answer might surprise you" or "you won't believe".
- hookTitle: the hook as on-screen text, at most 7 words, no final punctuation.
- pointId: the id of the chosen point whose source sentence backs the hook up.

Rules (checked automatically):
- Use only facts and numbers from the chosen points and STUDY SETTING. Never round or convert a
  number; "percentage points" are not "percent".
- Plain spoken English for a text-to-speech voice: every number as digits ("6 weeks"), no symbols,
  abbreviations or parentheses, money as digits plus the currency word ("50 pounds").
- Words a 12-year-old knows; no research jargon ("randomized", "statistically significant").
- Never mention the video itself ("in this video", "at the end", "payoff").`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["hooks"],
  properties: {
    hooks: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["type", "hook", "hookTitle", "pointId"],
        properties: {
          type: { type: "string", enum: ["number", "myth", "you", "question"] },
          hook: { type: "string" },
          hookTitle: { type: "string" },
          pointId: { type: "string" },
        },
      },
    },
  },
};

export type HookInput = {
  title: string;
  opening: string;
  points: CandidatePoint[];
  leadId: string;
  setting?: StudySetting | null;
  audience: Audience;
};

/** Which hooks to write: one per slot (default: the audience's 3 types), different from `avoid`. */
export type HookRequest = { slots?: HookType[]; avoid?: HookOption[] };

/** The next `count` hook types after `offered` hooks, going round the audience's types. */
export function nextHookTypes(audience: Audience, offered: number, count: number): HookType[] {
  const types = hookTypesFor(audience);
  return Array.from({ length: count }, (_, i) => types[(offered + i) % types.length]);
}

/** Hook-only problems from the full script checks (numbers, symbols, jargon, spoiler, title length). */
export function hookProblems(
  hook: { hook: string; hookTitle: string; type: HookType | "custom" },
  input: Omit<HookInput, "title"> & { title?: string },
): string[] {
  const lead = input.points.find((p) => p.id === input.leadId);
  const others = input.points.filter((p) => p.id !== input.leadId);
  const probe: Script = {
    hook: hook.hook,
    hookTitle: hook.hookTitle,
    hookBroll: "",
    payoffPointId: input.leadId,
    beats: [...others, ...(lead ? [lead] : [])].map((p) => ({ pointId: p.id, text: "", broll: "" })),
    closing: "and that is why",
    closingBroll: "",
  };
  const allowQuestionHook = input.audience === "student" && (hook.type === "question" || hook.type === "custom");
  const problems = checkScript(probe, input.points, 150, `${input.title ?? ""}\n${input.opening}`, settingBlock(input.setting), input.audience, {
    allowQuestionHook,
  }).filter((p) => /^(Jargon: )?Hook\b|^Spoiler/.test(p));
  if (!hook.hook.trim()) problems.push("Hook is empty.");
  if (!hook.hookTitle.trim()) problems.push("Hook title is empty.");
  // A question hook is only offered (and allowed) for Student videos.
  if (hook.type !== "question" && input.audience !== "student" && hook.hook.includes("?")) {
    problems.push("Hook is a question; for Social videos write it as a statement.");
  }
  return [...new Set(problems)];
}

/**
 * One hook per slot for the lead finding (by default one per type). Each is checked like the
 * script's hook; a slot whose hook fails is asked for once more with the problems. Slots that still
 * fail are left out.
 */
export async function proposeHooks(
  input: HookInput,
  request: HookRequest = {},
): Promise<{ items: HookOption[]; usage: Usage[]; model: string }> {
  const types = request.slots ?? hookTypesFor(input.audience);
  const avoid = request.avoid ?? [];
  const seen = new Set(avoid.map((h) => h.hook.toLowerCase()));
  const avoidBlock = avoid.length
    ? `\n\nALREADY OFFERED (write new ones, not rewordings of these):\n${avoid.map((h) => `- (${h.type}) "${h.hook}"`).join("\n")}`
    : "";
  const byId = new Map(input.points.map((p) => [p.id, p]));
  const pointsBlock = input.points
    .map((p) => `- id ${p.id} (${p.type}${p.id === input.leadId ? ", LEAD FINDING" : ""}): ${p.text}\n  Source sentence: "${p.evidence}"`)
    .join("\n");
  const kept: (HookOption | undefined)[] = types.map(() => undefined);
  const open = () => types.map((t, i) => (kept[i] ? null : i)).filter((i): i is number => i !== null);
  const usage: Usage[] = [];
  let model = "";
  let feedback = "";
  for (let attempt = 1; attempt <= 2 && open().length > 0; attempt++) {
    const wanted = open().map((i) => types[i]);
    const res = await chatJson<{ hooks: { type: HookType; hook: string; hookTitle: string; pointId: string }[] }>({
      system: SYSTEM(wanted),
      user:
        `TITLE: ${input.title}\n\nOPENING OF THE ARTICLE:\n${input.opening}\n\nSTUDY SETTING:\n${settingBlock(input.setting)}\n\n` +
        `CHOSEN POINTS:\n${pointsBlock}${avoidBlock}${feedback}`,
      schemaName: "reel_hooks",
      schema: SCHEMA,
    });
    usage.push(res.usage);
    model = res.model;
    const problemsByType: string[] = [];
    for (const raw of res.data.hooks) {
      // Fill the first open slot of this type; skip repeats of hooks already offered.
      const slot = open().find((i) => types[i] === raw.type);
      if (slot === undefined || seen.has(raw.hook.trim().toLowerCase())) continue;
      const option = {
        type: raw.type,
        hook: raw.hook.trim(),
        hookTitle: raw.hookTitle.trim().replace(/[.!?]+$/, ""),
        pointId: byId.has(raw.pointId) ? raw.pointId : input.leadId,
      };
      const problems = hookProblems(option, input);
      if (problems.length) {
        problemsByType.push(`${raw.type} hook ("${option.hook}"): ${problems.join(" ")}`);
        continue;
      }
      kept[slot] = { ...option, quote: byId.get(option.pointId)?.evidence ?? "" };
      seen.add(option.hook.toLowerCase());
    }
    feedback = problemsByType.length ? `\n\nYour previous hooks were rejected. Fix these problems:\n- ${problemsByType.join("\n- ")}` : "";
  }
  return { items: kept.filter((h): h is HookOption => !!h), usage, model };
}
