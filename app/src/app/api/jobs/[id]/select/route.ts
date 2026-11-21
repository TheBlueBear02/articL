import { supabaseAdmin } from "@/lib/supabase/server";
import { MAX_SELECTED_POINTS, type CandidatePoint } from "@/lib/jobs";
import { parseAddons } from "@/lib/addons-input";
import { POINTS_SELECTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";

// Save chosen points (1 to 5) + add-ons and start Phase 3. Points are auto-recommended;
// this is the user submit step that confirms add-ons and continues.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/select">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const pointIds: unknown = body?.pointIds;

  if (!Array.isArray(pointIds) || !pointIds.every((p) => typeof p === "string")) {
    return Response.json({ error: "pointIds must be a list of point ids." }, { status: 400 });
  }
  const unique = [...new Set(pointIds as string[])];
  if (unique.length < 1 || unique.length > MAX_SELECTED_POINTS) {
    return Response.json({ error: `Select between 1 and ${MAX_SELECTED_POINTS} points.` }, { status: 400 });
  }

  // Optional add-ons (also saveable earlier, while the article is read: see ../addons).
  const parsed = await parseAddons(body?.addons);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });
  const { addons } = parsed;

  const supabase = supabaseAdmin();
  const { data: job, error } = await supabase
    .from("jobs")
    .select("status, candidate_points")
    .eq("id", id)
    .single();
  if (error || !job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "awaiting_selection") {
    return Response.json({ error: `Job is ${job.status}, not waiting for a selection.` }, { status: 409 });
  }

  const known = new Set(((job.candidate_points ?? []) as CandidatePoint[]).map((p) => p.id));
  const unknown = unique.filter((p) => !known.has(p));
  if (unknown.length) {
    return Response.json({ error: `Unknown point id(s): ${unknown.join(", ")}` }, { status: 400 });
  }

  // Only move forward if the job is still waiting, so a double-click can't save twice.
  const { data: updated, error: updateError } = await supabase
    .from("jobs")
    .update({
      status: "points_selected",
      selected_point_ids: unique,
      selected_at: new Date().toISOString(),
      // Always written, so turning everything off here overrides choices saved earlier.
      addons,
    })
    .eq("id", id)
    .eq("status", "awaiting_selection")
    .select("id");
  if (updateError) return Response.json({ error: updateError.message }, { status: 500 });
  if (!updated?.length) return Response.json({ error: "Selection was already saved." }, { status: 409 });

  // Start Phase 3: script, voiceover and word timestamps. If that fails, put the job back so
  // the user can simply press Continue again.
  const sendError = await sendJobEvent(POINTS_SELECTED, { jobId: id });
  if (sendError) {
    await supabase
      .from("jobs")
      .update({ status: "awaiting_selection", selected_point_ids: null, selected_at: null })
      .eq("id", id);
    return Response.json({ error: sendError }, { status: 503 });
  }

  return Response.json({ ok: true, selected: unique });
}
