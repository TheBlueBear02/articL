import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { setJob } from "@/lib/supabase/jobs-db";
import { proposeMainResult, proposePoints } from "@/lib/openai";
import { applyRecommendations, matchKey, trimBackMatter, verifyPoints, verifySetting, type VerifyResult } from "@/lib/points";
import { audienceOf, maxPointsFor, type CandidatePoint, type JobStatus, type StudySetting } from "@/lib/jobs";
import { saveTokens, tokensOf } from "@/lib/usage-db";
import type { TokenUsage } from "@/lib/pricing";

// Below this many verified points the checklist isn't useful; ask the model once more.
const MIN_VERIFIED_POINTS = 3;

/**
 * Ask the model for candidate points and keep only those the article supports, then save them with
 * the best ones marked and set the job to `doneStatus` (the original page waits on
 * "awaiting_selection"; the /create flow on "awaiting_findings"). Reads the text from the database
 * rather than passing it through Inngest step state.
 */
export async function proposeForJob(jobId: string, doneStatus: JobStatus) {
  await setJob(jobId, { status: "proposing" });
  const { data, error } = await supabaseAdmin().from("jobs").select("extracted_text").eq("id", jobId).single();
  if (error || !data?.extracted_text) throw new Error(`Reading text for job ${jobId} failed: ${error?.message}`);
  const fullText: string = data.extracted_text;
  const articleText = trimBackMatter(fullText);
  // Separate query so jobs keep working before migration 0008 adds the column.
  const { data: who } = await supabaseAdmin().from("jobs").select("audience").eq("id", jobId).single();
  const audience = audienceOf(who ?? {});

  const usage = [];
  const calls: TokenUsage[] = []; // both attempts are billed, even when the first is kept
  let kept: CandidatePoint[] = [];
  let dropped: { reason: string; text: string }[] = [];
  let setting: StudySetting = {};
  let failedMain: VerifyResult["dropped"][number] | undefined;
  // Student videos also need their main result and research question to pass the checks: if
  // either was dropped, ask once more and keep the better attempt. Testing (Olken): the main
  // audit result failed the number check in 3 runs out of 3, so the videos missed it.
  // LinkedIn videos likewise need their main result and a limitation the article itself states.
  const complete = (k: CandidatePoint[]) =>
    audience === "student"
      ? k.some((p) => p.main) && k.some((p) => p.type === "question")
      : audience === "academic"
        ? k.some((p) => p.main) && k.some((p) => p.type === "limitation")
        : true;
  const score = (k: CandidatePoint[]) => (k.length >= MIN_VERIFIED_POINTS ? 2 : 0) + (complete(k) ? 1 : 0);
  for (let attempt = 1; attempt <= 2 && !(kept.length >= MIN_VERIFIED_POINTS && complete(kept)); attempt++) {
    const result = await proposePoints(articleText, audience);
    usage.push({ model: result.model, ...result.usage });
    calls.push(tokensOf(result.model, result.usage));
    const withIds = result.points.map((p, i) => ({ id: `p${i + 1}`, ...p }));
    const verified = verifyPoints(withIds, fullText);
    if (attempt > 1 && score(verified.kept) < score(kept)) continue; // the first attempt was better
    kept = verified.kept;
    dropped = verified.dropped.map((d) => ({ reason: d.reason, text: d.point.text }));
    failedMain = verified.dropped.find((d) => d.point.main);
    setting = verifySetting(result.setting, fullText);
  }

  // Still no main result: ask for it alone, with its sentence copied exactly (one extra call,
  // only when needed). Testing (Olken, LinkedIn): both full attempts misquoted the main result.
  let mainRetry: "not needed" | "recovered" | "failed" = "not needed";
  if ((audience === "student" || audience === "academic") && kept.length && !kept.some((p) => p.main)) {
    const result = await proposeMainResult(
      articleText,
      failedMain && { text: failedMain.point.text, evidence: failedMain.point.evidence, reason: failedMain.reason },
    );
    usage.push({ model: result.model, ...result.usage });
    calls.push(tokensOf(result.model, result.usage));
    const verified = verifyPoints([{ id: "main", ...result.point }], fullText);
    const main = verified.kept[0];
    if (main) {
      // If a kept point quotes the same sentence, mark that one instead of adding a duplicate.
      const same = kept.find((p) => matchKey(p.evidence) === matchKey(main.evidence));
      kept = same ? kept.map((p) => (p === same ? { ...p, main: true, recommended: true } : p)) : [main, ...kept];
      mainRetry = "recovered";
    } else {
      mainRetry = "failed";
      dropped.push({ reason: `main result retry: ${verified.dropped[0]?.reason}`, text: result.point.text });
    }
  }

  await saveTokens(jobId, "points:1", calls);

  if (kept.length < MIN_VERIFIED_POINTS) {
    await setJob(jobId, {
      status: "failed",
      error: "Couldn't find enough points that could be checked against the article text. Try another article.",
    });
    return { ok: false as const, kept: kept.length, dropped, usage };
  }

  // Auto-mark the best points (recommended first), then renumber so ids are tidy.
  const points = applyRecommendations(kept, maxPointsFor(audience), audience).map((p, i) => ({ ...p, id: `p${i + 1}` }));
  try {
    await setJob(jobId, { status: doneStatus, candidate_points: points, study_setting: setting });
  } catch (e) {
    // Before migration 0007 there is no study_setting column: save the points without it.
    if (!/study_setting/.test(String(e))) throw e;
    await setJob(jobId, { status: doneStatus, candidate_points: points });
  }
  const modelRecommended = kept.filter((p) => p.recommended).length;
  return { ok: true as const, kept: points.length, modelRecommended, mainRetry, dropped, setting, usage };
}
