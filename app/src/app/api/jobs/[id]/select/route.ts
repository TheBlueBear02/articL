import { supabaseAdmin } from "@/lib/supabase/server";
import { MAX_SELECTED_POINTS, MUSIC_MOODS, SPLIT_STYLES, type Addons, type CandidatePoint } from "@/lib/jobs";
import { libraryInfo } from "@/lib/library";
import { POINTS_SELECTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";

// Save the user's chosen points (1 to 5). This is the one approval step in the flow;
// Phase 3 (script drafting) will start from here.
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

  // Optional add-ons: { music?: "calm" | "upbeat" | "dramatic", split?: "gameplay" | "satisfying",
  //   gameplayClip?: string, popups?: boolean }
  const rawAddons = body?.addons ?? {};
  if (typeof rawAddons !== "object" || Array.isArray(rawAddons)) {
    return Response.json({ error: "addons must be an object." }, { status: 400 });
  }
  const addons: Addons = {};
  if (rawAddons.music != null) {
    if (!MUSIC_MOODS.includes(rawAddons.music)) {
      return Response.json({ error: `music must be one of: ${MUSIC_MOODS.join(", ")}.` }, { status: 400 });
    }
    addons.music = rawAddons.music;
  }
  if (rawAddons.split != null) {
    if (!SPLIT_STYLES.includes(rawAddons.split)) {
      return Response.json({ error: `split must be one of: ${SPLIT_STYLES.join(", ")}.` }, { status: 400 });
    }
    addons.split = rawAddons.split;
  }
  if (rawAddons.gameplayClip != null) {
    if (typeof rawAddons.gameplayClip !== "string" || addons.split !== "gameplay") {
      return Response.json({ error: "gameplayClip needs split \"gameplay\" and a clip path." }, { status: 400 });
    }
    addons.gameplayClip = rawAddons.gameplayClip;
  }
  if (rawAddons.popups != null) {
    if (typeof rawAddons.popups !== "boolean") {
      return Response.json({ error: "popups must be true or false." }, { status: 400 });
    }
    if (rawAddons.popups) addons.popups = true;
  }
  // Library-backed choices need files in the library (Pixabay "satisfying" clips don't).
  if (addons.music || addons.split === "gameplay") {
    const lib = await libraryInfo().catch(() => null);
    if (addons.music && !lib?.music[addons.music]) {
      return Response.json({ error: `There is no ${addons.music} music in the library yet.` }, { status: 400 });
    }
    if (addons.split === "gameplay" && !lib?.gameplay) {
      return Response.json({ error: "There are no gameplay clips in the library yet." }, { status: 400 });
    }
    if (addons.gameplayClip && !lib?.gameplayClips.some((c) => c.path === addons.gameplayClip)) {
      return Response.json({ error: "That gameplay clip isn't in the library (it may have been removed)." }, { status: 400 });
    }
  }

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
      // Only written when an add-on was chosen, so jobs still work before migration 0005 is run.
      ...(Object.keys(addons).length ? { addons } : {}),
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
