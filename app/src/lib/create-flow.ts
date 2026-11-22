import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { setJob } from "@/lib/supabase/jobs-db";
import { nextHookTypes, proposeHooks } from "@/lib/hooks";
import { saveTokens, tokensOf } from "@/lib/usage-db";
import {
  audienceOf,
  isFindingType,
  type Audience,
  type CandidatePoint,
  type HookSet,
  type StudySetting,
} from "@/lib/jobs";

/** The first line of the text that looks like a title (the script prompts use the same guess). */
export const titleOf = (text: string) => text.split("\n").find((l) => l.trim().length > 10)?.trim() ?? "Untitled article";

/** The lead finding before the user picks one: Student's main result, else the first recommended stat. */
export function defaultLead(points: CandidatePoint[], audience: Audience): CandidatePoint | undefined {
  const kept = points.filter((p) => p.recommended && isFindingType(p.type));
  if (audience === "student") return kept.find((p) => p.main) ?? kept.at(-1);
  return kept.find((p) => p.type === "stat") ?? kept[0];
}

/**
 * The order the video tells the kept points in: Student's question and method first; then the other
 * findings in the user's order; the lead last (the hook teases it, the last beat reveals it).
 */
export function videoOrder(points: CandidatePoint[], ids: string[], leadId: string, audience: Audience): string[] {
  const byId = new Map(points.map((p) => [p.id, p]));
  const kept = ids.filter((id) => byId.has(id));
  const rank = (id: string) => {
    if (audience !== "student") return 0;
    const t = byId.get(id)!.type;
    return t === "question" ? 0 : t === "method" ? 1 : 2;
  };
  const rest = kept.filter((id) => id !== leadId);
  return [...rest.map((id, i) => ({ id, i })).sort((a, b) => rank(a.id) - rank(b.id) || a.i - b.i).map((x) => x.id), leadId];
}

/** How many hooks "More hooks" adds under the existing ones. */
export const MORE_HOOKS = 2;

/**
 * Write and save the hook options for the job's lead finding and kept points. With `more`, write
 * that many extra hooks (different from the ones shown) and add them under the existing ones.
 */
export async function generateHooksForJob(jobId: string, more = 0) {
  const { data: job, error } = await supabaseAdmin()
    .from("jobs")
    .select("extracted_text, candidate_points, selected_point_ids, lead_point_id, study_setting, audience, hooks")
    .eq("id", jobId)
    .single();
  if (error || !job) throw new Error(`Job ${jobId} not found: ${error?.message}`);
  const audience = audienceOf(job);
  const all = (job.candidate_points ?? []) as CandidatePoint[];
  const ids: string[] = job.selected_point_ids?.length ? job.selected_point_ids : all.filter((p) => p.recommended).map((p) => p.id);
  const points = ids.map((id) => all.find((p) => p.id === id)).filter((p): p is CandidatePoint => !!p);
  const leadId = (job.lead_point_id as string | null) ?? defaultLead(all, audience)?.id ?? points[0]?.id;
  if (!leadId) throw new Error(`Job ${jobId} has no lead finding.`);
  const text: string = job.extracted_text ?? "";
  const existing = more ? ((job.hooks as HookSet | null)?.items ?? []) : [];
  const { items, usage, model } = await proposeHooks(
    {
      title: titleOf(text),
      opening: text.slice(0, 3000),
      points,
      leadId,
      setting: job.study_setting as StudySetting | null,
      audience,
    },
    more ? { slots: nextHookTypes(audience, existing.length, more), avoid: existing } : {},
  );
  await saveTokens(jobId, `hooks:${Date.now()}`, usage.map((u) => tokensOf(model, u)));
  // The user may have changed the lead or the kept points meanwhile: those changes asked for new
  // hooks, so don't overwrite them with these.
  const { data: now } = await supabaseAdmin().from("jobs").select("lead_point_id, selected_point_ids").eq("id", jobId).single();
  const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
  if (!same(now?.lead_point_id, job.lead_point_id) || !same(now?.selected_point_ids, job.selected_point_ids)) {
    return { leadId, stale: true };
  }
  const hooks: HookSet = more
    ? { leadId, pointIds: points.map((p) => p.id), items: [...existing, ...items], moreFailed: items.length === 0 }
    : { leadId, pointIds: points.map((p) => p.id), items };
  await setJob(jobId, { hooks });
  return { leadId, types: items.map((h) => h.type), more };
}
