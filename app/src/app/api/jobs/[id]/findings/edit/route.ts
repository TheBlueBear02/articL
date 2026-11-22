import { setJob } from "@/lib/supabase/jobs-db";
import { verifyPoints } from "@/lib/points";
import type { CandidatePoint } from "@/lib/jobs";
import { bad, readCreateJob } from "@/lib/create-api";

const MAX_CHARS = 400;

// Step 3: reword a point. It must still pass the same check as the AI's points: its numbers must be
// in its quote from the article (the quote itself can't be edited).
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/findings/edit">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const pointId = body?.pointId;
  const text = typeof body?.text === "string" ? body.text.trim().replace(/\s+/g, " ") : "";
  if (typeof pointId !== "string" || !text) return bad("Send pointId and the new text.");
  if (text.length > MAX_CHARS) return bad(`Keep it under ${MAX_CHARS} characters.`);

  const read = await readCreateJob<{ candidate_points: CandidatePoint[] | null; extracted_text: string | null }>(
    id,
    "candidate_points, extracted_text",
    ["awaiting_findings", "awaiting_hook"],
  );
  if ("error" in read) return read.error;
  const all = read.job.candidate_points ?? [];
  const point = all.find((p) => p.id === pointId);
  if (!point) return bad("Unknown point.", 404);

  const edited = { ...point, text };
  const { kept, dropped } = verifyPoints([edited], read.job.extracted_text ?? "");
  if (!kept.length) {
    return bad(`That wording can't be checked against the quote (${dropped[0]?.reason ?? "it doesn't match"}). Keep the numbers as the quote gives them.`, 422);
  }
  // Hooks quote the points: an edit asks for new ones when the findings are confirmed.
  await setJob(id, { candidate_points: all.map((p) => (p.id === pointId ? edited : p)), hooks: null, status: "awaiting_findings" });
  return Response.json({ ok: true, point: edited });
}
