import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import { readCreateJob } from "@/lib/create-api";

const LINK_SECONDS = 60 * 60;

// Short-lived links to the build tracker's part thumbnails and the cover (the bucket is private).
export async function GET(_request: Request, ctx: RouteContext<"/api/jobs/[id]/media">) {
  const { id } = await ctx.params;
  const read = await readCreateJob<{ block_thumbs: (string | null)[] | null }>(id, "block_thumbs");
  if ("error" in read) return read.error;
  const storage = supabaseAdmin().storage.from(MEDIA_BUCKET);
  const paths = read.job.block_thumbs ?? [];
  const wanted = paths.filter((p): p is string => !!p);
  const signed = wanted.length ? await storage.createSignedUrls(wanted, LINK_SECONDS) : { data: [] };
  const byPath = new Map((signed.data ?? []).map((s) => [s.path, s.signedUrl]));
  const cover =
    read.job.status === "rendered" ? (await storage.createSignedUrl(`${id}/thumb.jpg`, LINK_SECONDS)).data?.signedUrl ?? null : null;
  return Response.json({ blocks: paths.map((p) => (p ? (byPath.get(p) ?? null) : null)), cover });
}
