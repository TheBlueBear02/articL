import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/supabase/jobs-db";

const LINK_SECONDS = 60 * 60;

// Short-lived links to watch and download a job's finished video (the media bucket is private).
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/video">) {
  const { id } = await ctx.params;
  const supabase = supabaseAdmin();

  const { data: job, error } = await supabase
    .from("jobs")
    .select("video_path, original_filename")
    .eq("id", id)
    .single();
  if (error || !job) return Response.json({ error: "Job not found." }, { status: 404 });
  if (!job.video_path) return Response.json({ error: "No video yet." }, { status: 409 });

  // e.g. "How Markets Shape Values.pdf" -> "how-markets-shape-values-reel.mp4"
  const slug =
    String(job.original_filename)
      .replace(/\.pdf$/i, "")
      .normalize("NFKD")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/, "") || "articl";
  const name = `${slug}-reel.mp4`;
  const storage = supabase.storage.from(MEDIA_BUCKET);
  const [watch, download] = await Promise.all([
    storage.createSignedUrl(job.video_path, LINK_SECONDS),
    storage.createSignedUrl(job.video_path, LINK_SECONDS, { download: name }),
  ]);
  if (watch.error || download.error) {
    return Response.json({ error: (watch.error ?? download.error)?.message }, { status: 500 });
  }
  return Response.json({ url: watch.data.signedUrl, downloadUrl: download.data.signedUrl });
}
