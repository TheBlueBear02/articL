import { setJob } from "@/lib/supabase/jobs-db";
import { VOICE_READY } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { advance, bad, logEvent, readCreateJob } from "@/lib/create-api";
import type { ScriptFlag } from "@/lib/jobs";

// Step 6 -> 7: the script is approved; find the footage and render.
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/approve">) {
  const { id } = await ctx.params;
  const read = await readCreateJob<{ script_flags: ScriptFlag[] | null }>(id, "script_flags", ["awaiting_review"]);
  if ("error" in read) return read.error;

  const moved = await advance(id, ["awaiting_review"], {
    status: "voiced",
    addons_confirmed_at: new Date().toISOString(),
  });
  if (!moved) return bad("The script was already approved.", 409);
  const flags = read.job.script_flags ?? [];
  await logEvent(id, "script_approved", {
    flags: flags.length,
    accepted: flags.filter((f) => f.state === "accepted").length,
  });

  const sendError = await sendJobEvent(VOICE_READY, { jobId: id });
  if (sendError) {
    await setJob(id, { status: "awaiting_review" });
    return bad(sendError, 503);
  }
  return Response.json({ ok: true });
}
