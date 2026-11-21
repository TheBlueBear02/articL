import { ARTICLES_BUCKET, supabaseAdmin } from "@/lib/supabase/server";

const LINK_SECONDS = 60 * 60;

// Short-lived link to the uploaded PDF (articles bucket is private). Pasted-text jobs have no file.
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/article">) {
  const { id } = await ctx.params;
  const supabase = supabaseAdmin();

  const { data: job, error } = await supabase.from("jobs").select("file_path, original_filename").eq("id", id).single();
  if (error || !job) return Response.json({ error: "Job not found." }, { status: 404 });

  // Pasted-text jobs store the article in the row and leave file_path empty.
  if (!job.file_path) {
    return Response.json({ kind: "text" as const });
  }

  const { data, error: signError } = await supabase.storage
    .from(ARTICLES_BUCKET)
    .createSignedUrl(job.file_path, LINK_SECONDS);
  if (signError || !data?.signedUrl) {
    return Response.json({ error: signError?.message ?? "Could not open the PDF." }, { status: 500 });
  }

  return Response.json({
    kind: "pdf" as const,
    url: `${data.signedUrl}#toolbar=0&navpanes=0`,
    filename: job.original_filename,
  });
}
