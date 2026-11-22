import "server-only";
import { chatJson, type Usage } from "./openai";
import { checkScript, scriptSegments, settingBlock, SOFT_PROBLEM } from "./script-checks";
import type { Audience, CandidatePoint, Script, ScriptFlag, StudySetting } from "./jobs";

const SYSTEM = `You check a short video script about a research study for OVERCLAIMS: wording that says more
than the study's own sentences support. Flag a part only for one of these:
- cause and effect ("X causes Y", "makes", "leads to") when the source only shows a link or a difference;
- generalising beyond who or where was studied ("everyone", "all voters", "people in general");
- certainty the source doesn't have ("proves", "always", "never", "guarantees", "definitely");
- a bigger or different effect than the source states.
Teasing, plain words and simplifying are fine: do not flag style.

For each flagged part give:
- segment: the part's number as given;
- problem: one short sentence a non-expert understands, e.g. "The study shows a link, not that one causes the other.";
- softer: the whole part rewritten with the smallest change that fixes it. Keep every number exactly,
  keep it about as long, same plain spoken style, no symbols. For the closing, keep its unfinished
  ending (no final punctuation) exactly as it is.
Return an empty list when nothing overclaims. Flag at most 3 parts.`;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["flags"],
  properties: {
    flags: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["segment", "problem", "softer"],
        properties: { segment: { type: "integer" }, problem: { type: "string" }, softer: { type: "string" } },
      },
    },
  },
};

/** Put `text` into part `segment` of the script (0 = hook, 1..n = beats, last = closing). */
export function withSegmentText(script: Script, segment: number, text: string): Script {
  if (segment === 0) return { ...script, hook: text };
  if (segment === script.beats.length + 1) return { ...script, closing: text };
  return { ...script, beats: script.beats.map((b, i) => (i === segment - 1 ? { ...b, text } : b)) };
}

export type CheckContext = {
  points: CandidatePoint[];
  maxWords: number;
  source: string;
  setting?: StudySetting | null;
  audience: Audience;
  allowQuestionHook?: boolean;
};

/** Hard problems a changed script has that the original didn't (soft ones only ask for a rewrite). */
export function newProblems(before: Script, after: Script, ctx: CheckContext): string[] {
  const run = (s: Script) =>
    checkScript(s, ctx.points, ctx.maxWords, ctx.source, settingBlock(ctx.setting), ctx.audience, {
      allowQuestionHook: ctx.allowQuestionHook,
    }).filter((p) => !SOFT_PROBLEM.test(p));
  const old = new Set(run(before));
  return run(after).filter((p) => !old.has(p));
}

/**
 * Flag parts of a checked script that claim more than their sources. Each softer wording must pass
 * the same number checks as the script, or the flag is dropped (a softer line can't add a figure).
 */
export async function checkOverclaims(script: Script, ctx: CheckContext): Promise<{ flags: ScriptFlag[]; usage: Usage; model: string }> {
  const byId = new Map(ctx.points.map((p) => [p.id, p]));
  const parts = scriptSegments(script);
  const lead = byId.get(script.payoffPointId ?? "");
  const block = parts
    .map((part, i) => {
      const sources =
        part.kind === "beat"
          ? [byId.get(part.pointId)?.evidence]
          : part.kind === "hook"
            ? [lead?.evidence]
            : ctx.points.map((p) => p.evidence);
      return `PART ${i} (${part.kind}): ${part.text}\n  Sources: ${sources.filter(Boolean).map((s) => `"${s}"`).join(" | ") || "none"}`;
    })
    .join("\n");
  const { data, usage, model } = await chatJson<{ flags: { segment: number; problem: string; softer: string }[] }>({
    system: SYSTEM,
    user: `STUDY SETTING:\n${settingBlock(ctx.setting)}\n\nSCRIPT:\n${block}`,
    schemaName: "overclaim_check",
    schema: SCHEMA,
  });
  const flags: ScriptFlag[] = [];
  for (const f of data.flags) {
    if (!Number.isInteger(f.segment) || f.segment < 0 || f.segment >= parts.length) continue;
    if (flags.some((x) => x.segment === f.segment)) continue;
    const softer = f.softer.trim();
    if (!softer || softer === parts[f.segment].text.trim()) continue;
    if (newProblems(script, withSegmentText(script, f.segment, softer), ctx).length) continue;
    flags.push({ segment: f.segment, problem: f.problem.trim(), softer, state: "open" });
  }
  return { flags: flags.slice(0, 3), usage, model };
}
