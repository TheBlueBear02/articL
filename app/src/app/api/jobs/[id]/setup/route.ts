import { setJob } from "@/lib/supabase/jobs-db";
import { parseAddons } from "@/lib/addons-input";
import { audienceOf, type AuthorInfo, type JobStatus } from "@/lib/jobs";
import { bad, readCreateJob } from "@/lib/create-api";

/** Add-ons can change until the script is approved (they only matter when rendering). */
const OPEN: JobStatus[] = ["awaiting_findings", "awaiting_hook", "points_selected", "scripting", "voicing", "voiced", "awaiting_review"];
const MAX_FIELD = 120;

const clean = (v: unknown) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, MAX_FIELD) : "");

// Step 5: add-ons plus the author's name, role and university for the post text.
// confirm: true moves the page on to the script review.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/setup">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const read = await readCreateJob<{ audience: string }>(id, "audience", OPEN);
  if ("error" in read) return read.error;

  const parsed = await parseAddons(body?.addons);
  if ("error" in parsed) return bad(parsed.error);
  const { addons } = parsed;
  // Split screen (gameplay or satisfying clips) is a Social-reel style only.
  if (addons.split && audienceOf(read.job) !== "social") return bad("Split screen is only for Social videos.");

  const author: AuthorInfo = { name: clean(body?.author?.name), role: clean(body?.author?.role), university: clean(body?.author?.university) };
  await setJob(id, {
    addons,
    author_info: author,
    ...(body?.confirm ? { addons_confirmed_at: new Date().toISOString() } : {}),
  });
  return Response.json({ ok: true, addons, author });
}
