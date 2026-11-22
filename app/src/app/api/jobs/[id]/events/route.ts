import { bad, logEvent, readCreateJob } from "@/lib/create-api";

/** Events the page may record (others are refused, so the table stays tidy). */
const NAMES = ["feedback", "download", "share", "copy_post_text", "another_version", "another_paper", "cover_chosen"] as const;

// Product analytics from the page: feedback, downloads, shares and repeat use.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/events">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  if (!NAMES.includes(body?.name)) return bad(`name must be one of: ${NAMES.join(", ")}.`);
  const data = body?.data && typeof body.data === "object" && !Array.isArray(body.data) ? body.data : {};
  if (JSON.stringify(data).length > 2000) return bad("data is too large.");
  const read = await readCreateJob(id, "id");
  if ("error" in read) return read.error;
  await logEvent(id, body.name, data);
  return Response.json({ ok: true });
}
