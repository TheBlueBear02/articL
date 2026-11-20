import { supabaseAdmin, ARTICLES_BUCKET } from "@/lib/supabase/server";
import { ARTICLE_UPLOADED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";

// Step 2 of an upload: the browser says the file is in Storage. Confirm it, then
// kick off the background extraction job.
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/start">) {
  const { id } = await ctx.params;
  const supabase = supabaseAdmin();

  const { data: job, error } = await supabase.from("jobs").select("status, file_path").eq("id", id).single();
  if (error || !job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (job.status !== "awaiting_upload") {
    return Response.json({ error: `Job already ${job.status}.` }, { status: 409 });
  }

  const { data: exists } = await supabase.storage.from(ARTICLES_BUCKET).exists(job.file_path);
  if (!exists) return Response.json({ error: "The PDF hasn't finished uploading." }, { status: 409 });

  await supabase.from("jobs").update({ status: "uploaded" }).eq("id", id);
  const sendError = await sendJobEvent(ARTICLE_UPLOADED, { jobId: id });
  if (sendError) {
    await supabase.from("jobs").update({ status: "failed", error: sendError }).eq("id", id);
    return Response.json({ error: sendError }, { status: 503 });
  }

  return Response.json({ ok: true });
}
