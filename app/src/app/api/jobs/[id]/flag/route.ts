import { supabaseAdmin } from "@/lib/supabase/server";
import { MEDIA_BUCKET, setJob } from "@/lib/supabase/jobs-db";
import { audienceOf, type CandidatePoint, type ChosenHook, type Script, type ScriptFlag, type Segment, type StudySetting } from "@/lib/jobs";
import { cleanPopup, lengthFor } from "@/lib/script-checks";
import { newProblems, withSegmentText } from "@/lib/overclaim";
import { textToSpeech, transcribeWords } from "@/lib/voice";
import { saveUsage } from "@/lib/usage-db";
import { titleOf } from "@/lib/create-flow";
import { bad, readCreateJob } from "@/lib/create-api";

// Step 6: accept the softer wording for a flagged part (re-recorded right away, ~5-10 s), or keep
// the original.
export async function POST(request: Request, ctx: RouteContext<"/api/jobs/[id]/flag">) {
  const { id } = await ctx.params;
  const body = await request.json().catch(() => null);
  const segment = body?.segment;
  const action = body?.action;
  if (!Number.isInteger(segment) || (action !== "accept" && action !== "keep")) return bad('Send segment and action ("accept" or "keep").');

  const read = await readCreateJob<{
    script: Script | null;
    segments: Segment[] | null;
    script_flags: ScriptFlag[] | null;
    candidate_points: CandidatePoint[] | null;
    selected_point_ids: string[] | null;
    study_setting: StudySetting | null;
    extracted_text: string | null;
    audience: string;
    chosen_hook: ChosenHook | null;
  }>(
    id,
    "script, segments, script_flags, candidate_points, selected_point_ids, study_setting, extracted_text, audience, chosen_hook",
    ["awaiting_review"],
  );
  if ("error" in read) return read.error;
  const { job } = read;
  const flags = job.script_flags ?? [];
  const flag = flags.find((f) => f.segment === segment);
  if (!flag || flag.state !== "open" || !job.script || !job.segments?.[segment]) return bad("That suggestion isn't open any more.", 409);

  const updatedFlags = (state: ScriptFlag["state"]) => flags.map((f) => (f.segment === segment ? { ...f, state } : f));
  if (action === "keep") {
    await setJob(id, { script_flags: updatedFlags("kept") });
    return Response.json({ ok: true });
  }

  const audience = audienceOf(job);
  const all = job.candidate_points ?? [];
  const points = (job.selected_point_ids ?? []).map((x) => all.find((p) => p.id === x)).filter((p): p is CandidatePoint => !!p);
  const text = job.extracted_text ?? "";
  const { maxWords, ttsSpeed } = lengthFor(audience);
  let script = withSegmentText(job.script, segment, flag.softer);
  const problems = newProblems(job.script, script, {
    points,
    maxWords,
    source: `${titleOf(text)}\n${text.slice(0, 3000)}`,
    setting: job.study_setting,
    audience,
    allowQuestionHook: audience === "student" && String(job.chosen_hook?.hook ?? "").includes("?"),
  });
  if (problems.length) return bad(`The softer wording no longer passes the checks: ${problems.join(" ")}`, 422);

  // A beat's pop-up word and chart values must still be said in its new wording.
  const seg = job.segments[segment];
  let next: Segment = { ...seg, text: flag.softer };
  if (seg.kind === "beat") {
    const popup = cleanPopup(seg.popup, flag.softer);
    const chartSaid = seg.chart?.items.every((i) => flag.softer.replace(/,(?=\d{3}\b)/g, "").includes(i.value.replace(/,/g, "")));
    next = { ...next, popup, chart: chartSaid ? seg.chart : undefined };
    script = {
      ...script,
      beats: script.beats.map((b, i) => (i === segment - 1 ? { ...b, popup, chart: chartSaid ? b.chart : undefined } : b)),
    };
  }

  const audio = await textToSpeech(flag.softer, ttsSpeed);
  const audioPath = `${id}/edit-seg-${segment}-${Date.now()}.mp3`;
  const { error } = await supabaseAdmin().storage.from(MEDIA_BUCKET).upload(audioPath, audio, { contentType: "audio/mpeg", upsert: true });
  if (error) return bad(`Saving the new recording failed: ${error.message}`, 500);
  const { duration, words } = await transcribeWords(audio, flag.softer);
  await saveUsage(id, `voice:edit:${segment}:${Date.now()}`, { ttsChars: flag.softer.length, whisperSeconds: duration });
  next = { ...next, audioPath, duration, words };

  const segments = job.segments.map((s, i) => (i === segment ? next : s));
  const total = Math.round(segments.reduce((n, s) => n + s.duration, 0) * 100) / 100;
  await setJob(id, { script, segments, total_duration_s: total, script_flags: updatedFlags("accepted") });
  return Response.json({ ok: true, text: flag.softer, total });
}
