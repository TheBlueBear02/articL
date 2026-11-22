import { setJob } from "@/lib/supabase/jobs-db";
import { AUDIENCE_CHOSEN } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { advance, bad, readCreateJob } from "@/lib/create-api";

// Step 3: ask the AI for a new set of points (about $0.01).
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/findings/regenerate">) {
  const { id } = await ctx.params;
  const read = await readCreateJob(id, "id", ["awaiting_findings", "awaiting_hook"]);
  if ("error" in read) return read.error;
  const moved = await advance(id, ["awaiting_findings", "awaiting_hook"], {
    status: "proposing",
    hooks: null,
    selected_point_ids: null,
    lead_point_id: null,
  });
  if (!moved) return bad("This step is already closed.", 409);
  const sendError = await sendJobEvent(AUDIENCE_CHOSEN, { jobId: id });
  if (sendError) {
    await setJob(id, { status: "awaiting_findings" });
    return bad(sendError, 503);
  }
  return Response.json({ ok: true });
}
