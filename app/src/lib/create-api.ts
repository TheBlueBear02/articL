import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import type { JobStatus } from "@/lib/jobs";

export const bad = (error: string, status = 400) => Response.json({ error }, { status });

/** Read a /create-flow job's columns, or a ready error response. */
export async function readCreateJob<T extends Record<string, unknown>>(
  id: string,
  columns: string,
  statuses?: JobStatus[],
): Promise<{ job: T & { status: JobStatus } } | { error: Response }> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return { error: bad("Job not found.", 404) };
  const { data, error } = await supabaseAdmin().from("jobs").select(`status, flow, ${columns}`).eq("id", id).maybeSingle();
  if (error) return { error: bad(error.message, 500) };
  if (!data) return { error: bad("Job not found.", 404) };
  const job = data as unknown as T & { status: JobStatus; flow: string | null };
  if (job.flow !== "create") return { error: bad("This video wasn't made in the new flow.", 409) };
  if (statuses && !statuses.includes(job.status)) {
    return { error: bad(`The video is ${job.status.replace(/_/g, " ")}; this step is closed.`, 409) };
  }
  return { job };
}

/** Move a job on only if its status is still one of `from` (a double tap can't save twice). */
export async function advance(id: string, from: JobStatus[], fields: Record<string, unknown>): Promise<boolean> {
  const { data, error } = await supabaseAdmin().from("jobs").update(fields).eq("id", id).in("status", from).select("id");
  if (error) throw new Error(error.message);
  return !!data?.length;
}

/** Product analytics (migration 0010). Never fails the request. */
export async function logEvent(jobId: string | null, name: string, data: Record<string, unknown> = {}) {
  const { error } = await supabaseAdmin().from("events").insert({ job_id: jobId, name, data });
  if (error) console.warn(`[events] ${name} not recorded: ${error.message}`);
}
