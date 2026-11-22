import { supabaseAdmin } from "@/lib/supabase/server";
import { HOOKS_REQUESTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { bad, logEvent, readCreateJob } from "@/lib/create-api";

// Step 8, "Make another version": a new video from the same paper, starting at the findings step.
// The text, points and setting are copied, so nothing is read or proposed again.
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/clone">) {
  const { id } = await ctx.params;
  const read = await readCreateJob<Record<string, unknown>>(
    id,
    "original_filename, file_path, page_count, word_count, extracted_text, candidate_points, study_setting, audience, paper_meta, addons, author_info",
  );
  if ("error" in read) return read.error;
  const src = read.job;
  if (!src.candidate_points) return bad("This video has no findings to start from.", 409);

  const newId = crypto.randomUUID();
  const { error } = await supabaseAdmin()
    .from("jobs")
    .insert({
      id: newId,
      flow: "create",
      status: "awaiting_findings",
      audience_confirmed: true,
      original_filename: src.original_filename,
      file_path: src.file_path,
      page_count: src.page_count,
      word_count: src.word_count,
      extracted_text: src.extracted_text,
      candidate_points: src.candidate_points,
      study_setting: src.study_setting,
      audience: src.audience,
      paper_meta: src.paper_meta,
      addons: src.addons,
      author_info: src.author_info,
    });
  if (error) return bad(`Could not start a new version: ${error.message}`, 500);
  await logEvent(id, "another_version", { newJobId: newId });
  // Hooks for the default lead, so step 4 opens quickly if the user keeps the same findings.
  await sendJobEvent(HOOKS_REQUESTED, { jobId: newId });
  return Response.json({ jobId: newId });
}
