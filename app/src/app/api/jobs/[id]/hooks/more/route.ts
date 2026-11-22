import { setJob } from "@/lib/supabase/jobs-db";
import { audienceOf, hookTypesFor, type HookSet } from "@/lib/jobs";
import { HOOKS_REQUESTED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { MORE_HOOKS } from "@/lib/create-flow";
import { bad, readCreateJob } from "@/lib/create-api";

// Step 4, "More hooks": write 2 more hook options for the same lead finding and add them under the
// ones already shown (which stay, so a choice made from them still works). If the first hooks all
// failed the checks, this writes a full set instead ("Try again").
export async function POST(_request: Request, ctx: RouteContext<"/api/jobs/[id]/hooks/more">) {
  const { id } = await ctx.params;
  const read = await readCreateJob<{ hooks: HookSet | null; audience: string }>(id, "hooks, audience", ["awaiting_hook"]);
  if ("error" in read) return read.error;
  const hooks = read.job.hooks;
  if (!hooks) return bad("The first hooks are still being written.", 409);
  if (hooks.pending) return bad("More hooks are already on the way.", 409);

  const more = hooks.items.length ? MORE_HOOKS : hookTypesFor(audienceOf(read.job)).length;
  await setJob(id, { hooks: { ...hooks, failed: false, pending: true, moreFailed: false } });
  const sendError = await sendJobEvent(HOOKS_REQUESTED, { jobId: id, more });
  if (sendError) {
    await setJob(id, { hooks: { ...hooks, pending: false } });
    return bad(sendError, 503);
  }
  return Response.json({ ok: true });
}
