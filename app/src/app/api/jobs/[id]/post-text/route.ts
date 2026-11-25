import { supabaseAdmin } from "@/lib/supabase/server";
import { POST_PLATFORMS, type PostPlatform, type PostTexts } from "@/lib/jobs";
import { bad, readCreateJob } from "@/lib/create-api";

const MAX_CHARS = 5000;

// Step 6/7: the user's edited post text for one platform.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/post-text">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const platform = body?.platform as PostPlatform;
  if (!POST_PLATFORMS.includes(platform) || typeof body?.text !== "string") return bad("Send platform and text.");
  const read = await readCreateJob<{ post_texts: PostTexts | null }>(id, "post_texts");
  if ("error" in read) return read.error;
  const post_texts = { ...(read.job.post_texts ?? {}), [platform]: body.text.slice(0, MAX_CHARS) };
  const { error } = await supabaseAdmin().from("jobs").update({ post_texts }).eq("id", id);
  if (error) return bad(error.message, 500);
  return Response.json({ ok: true });
}
