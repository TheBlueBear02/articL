import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET, setJob } from "@/lib/supabase/jobs-db";
import type { Segment } from "@/lib/jobs";
import { coverTime, saveCover } from "@/render/cover";
import { bad, readCreateJob } from "@/lib/create-api";

// Step 6/7: which script part's frame becomes the cover. Before the render finishes it is only
// saved (the render uses it); afterwards the frame is taken from the finished video now.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/cover">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const segment = body?.segment;
  if (!Number.isInteger(segment) || segment < 0) return bad("Send the part number (segment).");

  const read = await readCreateJob<{ segments: Segment[] | null; video_path: string | null }>(id, "segments, video_path");
  if ("error" in read) return read.error;
  const { job } = read;
  if (!job.segments || segment >= job.segments.length) return bad("Unknown part.");

  await setJob(id, { cover_segment: segment });
  if (job.status === "rendered" && job.video_path) {
    const { data, error } = await supabaseAdmin().storage.from(MEDIA_BUCKET).download(job.video_path);
    if (error || !data) return bad(`Reading the video failed: ${error?.message}`, 500);
    await saveCover(id, { bytes: Buffer.from(await data.arrayBuffer()) }, coverTime(job.segments, segment));
  }
  return Response.json({ ok: true, segment });
}
