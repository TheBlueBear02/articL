import { setJob } from "@/lib/supabase/jobs-db";
import { audienceOf, type CandidatePoint, type ChosenHook, type HookSet, type StudySetting } from "@/lib/jobs";
import { POINTS_SELECTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { hookProblems } from "@/lib/hooks";
import { titleOf } from "@/lib/create-flow";
import { advance, bad, logEvent, readCreateJob } from "@/lib/create-api";

const MAX_HOOK_CHARS = 200;

// Step 4: the chosen (or own) hook. Starts the script, its checks and the voice in the background
// while the user picks add-ons.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/hook">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);

  const read = await readCreateJob<{
    hooks: HookSet | null;
    candidate_points: CandidatePoint[] | null;
    selected_point_ids: string[] | null;
    lead_point_id: string | null;
    audience: string;
    extracted_text: string | null;
    study_setting: StudySetting | null;
  }>(id, "hooks, candidate_points, selected_point_ids, lead_point_id, audience, extracted_text, study_setting", ["awaiting_hook"]);
  if ("error" in read) return read.error;
  const { job } = read;

  let chosen: ChosenHook;
  if (typeof body?.index === "number") {
    const option = job.hooks?.items[body.index];
    if (!option) return bad("That hook isn't available any more.", 409);
    chosen = { type: option.type, hook: option.hook, hookTitle: option.hookTitle };
  } else if (typeof body?.custom?.hook === "string" && typeof body?.custom?.hookTitle === "string") {
    chosen = {
      type: "custom",
      hook: body.custom.hook.trim().replace(/\s+/g, " ").slice(0, MAX_HOOK_CHARS),
      hookTitle: body.custom.hookTitle.trim().replace(/\s+/g, " ").replace(/[.!?]+$/, "").slice(0, 80),
    };
    const all = job.candidate_points ?? [];
    const points = (job.selected_point_ids ?? []).map((x) => all.find((p) => p.id === x)).filter((p): p is CandidatePoint => !!p);
    const text = job.extracted_text ?? "";
    const problems = hookProblems(chosen, {
      title: titleOf(text),
      opening: text.slice(0, 3000),
      points,
      leadId: job.lead_point_id ?? "",
      setting: job.study_setting,
      audience: audienceOf(job),
    });
    if (problems.length) return bad(problems.join(" "), 422);
  } else {
    return bad("Send index (a hook option) or custom { hook, hookTitle }.");
  }

  const moved = await advance(id, ["awaiting_hook"], { status: "points_selected", chosen_hook: chosen, selected_at: new Date().toISOString() });
  if (!moved) return bad("A hook was already chosen.", 409);
  await logEvent(id, "hook_chosen", { type: chosen.type, audience: audienceOf(job) });

  const sendError = await sendJobEvent(POINTS_SELECTED, { jobId: id });
  if (sendError) {
    await setJob(id, { status: "awaiting_hook", chosen_hook: null, selected_at: null });
    return bad(sendError, 503);
  }
  return Response.json({ ok: true, chosen });
}
