import { supabaseAdmin } from "@/lib/supabase/server";
import type { JobStatus } from "@/lib/jobs";
import { parseAddons } from "@/lib/addons-input";

/** While the article is read and points are found, the user can already choose the add-ons. */
const EARLY_STATUSES: JobStatus[] = ["awaiting_upload", "uploaded", "extracting", "extracted", "proposing", "awaiting_selection"];

// Save add-on choices while the article is prepared. After points are ready, Continue
// (POST /select) submits the final add-ons and starts scripting.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/addons">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const parsed = await parseAddons(body?.addons);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  const { data, error } = await supabaseAdmin()
    .from("jobs")
    .update({ addons: parsed.addons })
    .eq("id", id)
    .in("status", EARLY_STATUSES)
    .select("id");
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data?.length) {
    return Response.json({ error: "The video is already being made; add-ons can no longer change." }, { status: 409 });
  }
  return Response.json({ ok: true, addons: parsed.addons });
}
