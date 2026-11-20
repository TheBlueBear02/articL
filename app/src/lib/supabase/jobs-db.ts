import "server-only";
import { supabaseAdmin } from "./server";

/** Update fields on a job row (server-side, bypasses RLS). */
export async function setJob(jobId: string, fields: Record<string, unknown>) {
  const { error } = await supabaseAdmin().from("jobs").update(fields).eq("id", jobId);
  if (error) throw new Error(`Updating job ${jobId} failed: ${error.message}`);
}

export const MEDIA_BUCKET = "media";
