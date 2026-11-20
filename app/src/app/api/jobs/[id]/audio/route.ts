import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import type { Segment } from "@/lib/jobs";

const LINK_SECONDS = 60 * 60;

// Short-lived playback links for a job's voiceover segments (the media bucket is private).
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/audio">) {
  const { id } = await ctx.params;
  const supabase = supabaseAdmin();

  const { data: job, error } = await supabase.from("jobs").select("status, segments").eq("id", id).single();
  if (error || !job) return Response.json({ error: "Job not found." }, { status: 404 });
  const segments = (job.segments ?? []) as Segment[];
  if (!segments.length) return Response.json({ error: "No voiceover yet." }, { status: 409 });

  const { data, error: signError } = await supabase.storage
    .from(MEDIA_BUCKET)
    .createSignedUrls(segments.map((s) => s.audioPath), LINK_SECONDS);
  if (signError || !data) return Response.json({ error: signError?.message }, { status: 500 });

  return Response.json({ urls: data.map((d) => d.signedUrl) });
}
