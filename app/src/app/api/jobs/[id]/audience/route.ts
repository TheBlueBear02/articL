import { supabaseAdmin } from "@/lib/supabase/server";
import { READY_AUDIENCES, type Audience } from "@/lib/jobs";
import { AUDIENCE_CHOSEN } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { bad, readCreateJob } from "@/lib/create-api";

// Step 2: who the video is for. Saved while the text may still be read; the points are found as
// soon as both are ready (extract-article checks the flag; if it is already waiting, start here).
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/audience">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const audience = body?.audience as Audience;
  if (!READY_AUDIENCES.includes(audience)) return bad(`audience must be one of: ${READY_AUDIENCES.join(", ")}.`);

  const read = await readCreateJob<{ audience_confirmed: boolean }>(id, "audience_confirmed");
  if ("error" in read) return read.error;
  if (read.job.audience_confirmed) return bad("The audience is already chosen for this video.", 409);

  const supabase = supabaseAdmin();
  const { data: saved, error } = await supabase
    .from("jobs")
    .update({ audience, audience_confirmed: true })
    .eq("id", id)
    .eq("audience_confirmed", false)
    .select("id");
  if (error) return bad(error.message, 500);
  if (!saved?.length) return bad("The audience is already chosen for this video.", 409);

  // Text already read and waiting: find the points now.
  const { data: started } = await supabase
    .from("jobs")
    .update({ status: "proposing" })
    .eq("id", id)
    .eq("status", "awaiting_audience")
    .select("id");
  if (started?.length) {
    const sendError = await sendJobEvent(AUDIENCE_CHOSEN, { jobId: id });
    if (sendError) {
      await supabase.from("jobs").update({ status: "awaiting_audience", audience_confirmed: false }).eq("id", id);
      return bad(sendError, 503);
    }
  }
  return Response.json({ ok: true, audience });
}
