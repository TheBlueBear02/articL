import { setJob } from "@/lib/supabase/jobs-db";
import { audienceOf, isFindingType, MAX_SELECTED_POINTS, type CandidatePoint, type HookSet, type StudySetting } from "@/lib/jobs";
import { HOOKS_REQUESTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { hookProblems } from "@/lib/hooks";
import { titleOf, videoOrder } from "@/lib/create-flow";
import { advance, bad, readCreateJob } from "@/lib/create-api";

// Step 3: the kept points (up to 5, in the user's order) and the lead finding. Hooks written in the
// background stay if they still fit; otherwise new ones are asked for.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/findings">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const ids: unknown = body?.pointIds;
  const leadId: unknown = body?.leadId;
  if (!Array.isArray(ids) || !ids.every((x) => typeof x === "string") || typeof leadId !== "string") {
    return bad("Send pointIds (a list) and leadId.");
  }
  const unique = [...new Set(ids as string[])];
  if (unique.length < 1 || unique.length > MAX_SELECTED_POINTS) return bad(`Keep between 1 and ${MAX_SELECTED_POINTS} points.`);

  const read = await readCreateJob<{
    candidate_points: CandidatePoint[] | null;
    hooks: HookSet | null;
    audience: string;
    extracted_text: string | null;
    study_setting: StudySetting | null;
  }>(id, "candidate_points, hooks, audience, extracted_text, study_setting", ["awaiting_findings", "awaiting_hook"]);
  if ("error" in read) return read.error;
  const { job } = read;
  const audience = audienceOf(job);
  const all = job.candidate_points ?? [];
  const unknown = unique.filter((x) => !all.some((p) => p.id === x));
  if (unknown.length) return bad(`Unknown point id(s): ${unknown.join(", ")}`);
  const lead = all.find((p) => p.id === leadId);
  if (!lead || !unique.includes(leadId) || !isFindingType(lead.type)) return bad("The lead must be one of the kept findings.");

  const order = videoOrder(all, unique, leadId, audience);
  const points = order.map((x) => all.find((p) => p.id === x)!);
  const text = job.extracted_text ?? "";
  const hookContext = { title: titleOf(text), opening: text.slice(0, 3000), points, leadId, setting: job.study_setting, audience };
  const hooksFit =
    !!job.hooks &&
    job.hooks.leadId === leadId &&
    job.hooks.items.length > 0 &&
    job.hooks.items.every((h) => points.some((p) => p.id === h.pointId) && hookProblems(h, hookContext).length === 0);

  const moved = await advance(id, ["awaiting_findings", "awaiting_hook"], {
    status: "awaiting_hook",
    selected_point_ids: order,
    lead_point_id: leadId,
    hooks: hooksFit ? { ...job.hooks, pointIds: order } : null,
  });
  if (!moved) return bad("This step is already closed.", 409);
  if (!hooksFit) {
    const sendError = await sendJobEvent(HOOKS_REQUESTED, { jobId: id });
    if (sendError) {
      await setJob(id, { hooks: { leadId, pointIds: order, items: [], failed: true } });
      return bad(sendError, 503);
    }
  }
  return Response.json({ ok: true, order, hooksReady: hooksFit });
}
