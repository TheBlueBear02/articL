import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET } from "@/lib/supabase/jobs-db";

const MAX_LIMIT = 20;
const LINK_SECONDS = 60 * 60;

export type ReelCard = {
  id: string;
  title: string;
  hookTitle: string | null;
  audience: string | null;
  durationS: number | null;
  createdAt: string;
  /** "create" for videos made in the new /create flow (they open there). */
  flow: string | null;
  /** Short-lived link to `<jobId>/thumb.jpg`, or null when the video has no thumbnail yet. */
  thumbUrl: string | null;
};

// The latest finished videos for the home page carousel, with signed thumbnail links (the media
// bucket is private). Thumbnails exist only where one was made; the rest show a plain card.
// ?limit=6 for a shorter row (at most 20).
export async function GET(request: Request) {
  const asked = Number(new URL(request.url).searchParams.get("limit"));
  const limit = Number.isInteger(asked) && asked > 0 ? Math.min(asked, MAX_LIMIT) : MAX_LIMIT;
  const supabase = supabaseAdmin();
  const base = "id, original_filename, audience, total_duration_s, created_at, hook_title:script->>hookTitle";
  const query = (columns: string) =>
    supabase
      .from("jobs")
      .select(columns)
      .eq("status", "rendered")
      .not("video_path", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);
  // Before migration 0010 there is no flow column: read without it.
  let { data, error } = await query(`${base}, flow`);
  if (error && /flow/.test(error.message)) ({ data, error } = await query(base));
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const rows = (data ?? []) as unknown as {
    id: string;
    original_filename: string;
    audience: string | null;
    total_duration_s: number | null;
    created_at: string;
    hook_title: string | null;
    flow?: string | null;
  }[];
  // One call for all links; a missing thumbnail comes back as an error for that path only.
  const { data: links } = rows.length
    ? await supabase.storage.from(MEDIA_BUCKET).createSignedUrls(rows.map((r) => `${r.id}/thumb.jpg`), LINK_SECONDS)
    : { data: [] };
  const urlFor = new Map((links ?? []).filter((l) => !l.error && l.signedUrl).map((l) => [l.path, l.signedUrl]));

  const reels: ReelCard[] = rows.map((r) => ({
    id: r.id,
    title: r.original_filename,
    hookTitle: r.hook_title,
    audience: r.audience,
    durationS: r.total_duration_s,
    createdAt: r.created_at,
    flow: r.flow ?? null,
    thumbUrl: urlFor.get(`${r.id}/thumb.jpg`) ?? null,
  }));
  return Response.json({ reels });
}
