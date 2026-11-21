import { inngest, POINTS_SELECTED, VOICE_READY, type PointsSelectedData } from "./client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { setJob, MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import {
  autoFixScript,
  checkScript,
  draftScript,
  lengthFor,
  sectionFor,
  OPTIONAL_FIELD_PROBLEM,
  scriptSegments,
  settingBlock,
  SOFT_PROBLEM,
  verifyCredit,
} from "@/lib/script";
import { textToSpeech, transcribeWords } from "@/lib/voice";
import { prefetchFootage } from "./footage";
import { saveTokens, saveUsage, tokensOf } from "@/lib/usage-db";
import type { TokenUsage } from "@/lib/pricing";
import { audienceOf, type CandidatePoint, type Script, type Segment, type StudySetting } from "@/lib/jobs";

const DRAFT_ATTEMPTS = 3; // the reel-structure checks (loop lead-in, hashtags) reject more first drafts

// Phase 3: selected points -> checked script -> voiceover per segment -> word timestamps.
export const produceVoice = inngest.createFunction(
  {
    id: "produce-voice",
    triggers: [{ event: POINTS_SELECTED }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data as PointsSelectedData;
      await setJob(jobId, { status: "failed", error: error.message });
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as PointsSelectedData;
    // Separate query so jobs keep working before migration 0008 adds the column.
    const audience = await step.run("read-audience", async () => {
      const { data } = await supabaseAdmin().from("jobs").select("audience").eq("id", jobId).single();
      return audienceOf(data ?? {});
    });
    // Social: aim for 60 s, never over 75 s. Student: aim for 90 s, never over 100 s. A longer
    // recording than the aim gets one shorter rewrite; a little over beats a failed run.
    const { maxWords: startWords, targetS: MAX_DURATION_S, hardMaxS: HARD_MAX_DURATION_S, ttsSpeed } = lengthFor(audience);
    let maxWords = startWords;
    /** Round 1's checked, recorded version, kept in case the shorter rewrite fails. */
    let previous: { segments: Segment[]; total: number; script: Script } | null = null;

    // At most two rounds: if the recorded audio runs over 60 s, redraft shorter and re-record once.
    for (let round = 1; round <= 2; round++) {
      const draft = await step.run(`draft-script-${round}`, async () => {
        await setJob(jobId, { status: "scripting", error: null });
        const { data: job, error } = await supabaseAdmin()
          .from("jobs")
          .select("extracted_text, candidate_points, selected_point_ids")
          .eq("id", jobId)
          .single();
        if (error || !job) throw new Error(`Job ${jobId} not found: ${error?.message}`);
        // Separate query so jobs keep working before migration 0007 adds the column.
        const { data: withSetting } = await supabaseAdmin().from("jobs").select("study_setting").eq("id", jobId).single();
        const setting = (withSetting?.study_setting ?? null) as StudySetting | null;
        const settingText = settingBlock(setting);

        const all = (job.candidate_points ?? []) as CandidatePoint[];
        const points = ((job.selected_point_ids ?? []) as string[])
          .map((id) => all.find((p) => p.id === id))
          .filter((p): p is CandidatePoint => !!p);
        const text: string = job.extracted_text ?? "";
        const title = text.split("\n").find((l) => l.trim().length > 10)?.trim() ?? "Untitled article";
        // Abstract and start of the introduction: enough to say where and when the study took place.
        const opening = text.slice(0, 3000);

        let feedback: string[] = [];
        const calls: TokenUsage[] = []; // every draft attempt is billed, passed or not
        for (let attempt = 1; attempt <= DRAFT_ATTEMPTS; attempt++) {
          const { script: raw, usage, model } = await draftScript({ title, opening, points, setting, maxWords, feedback, audience });
          calls.push(tokensOf(model, usage));
          // Slips with one right answer are corrected, not sent back for a rewrite.
          let { script: drafted } = autoFixScript(raw, points, audience);
          const source = `${title}\n${opening}`;
          feedback = checkScript(drafted, points, maxWords, source, settingText, audience);
          // Last try: if only the optional on-screen title or post caption still fail, leave those
          // out rather than fail the whole video, and accept a script that's a little short.
          // Spoken-script problems still fail the run.
          const forgivable = (p: string) => OPTIONAL_FIELD_PROBLEM.test(p) || SOFT_PROBLEM.test(p);
          if (attempt === DRAFT_ATTEMPTS && feedback.length && feedback.every(forgivable)) {
            drafted = {
              ...drafted,
              hookTitle: feedback.some((p) => p.startsWith("Hook title")) ? undefined : drafted.hookTitle,
              postCaption: feedback.some((p) => p.startsWith("Post caption")) ? undefined : drafted.postCaption,
            };
            feedback = checkScript(drafted, points, maxWords, source, settingText, audience).filter((p) => !SOFT_PROBLEM.test(p));
          }
          if (!feedback.length) {
            const script = { ...drafted, sourceCredit: verifyCredit(drafted.sourceCredit, text) };
            await setJob(jobId, { script });
            const pointTypes = Object.fromEntries(points.map((p) => [p.id, p.type]));
            await saveTokens(jobId, `script:${round}`, calls);
            return { ok: true as const, script, usage, model, attempt, pointTypes };
          }
        }
        await saveTokens(jobId, `script:${round}`, calls);
        return { ok: false as const, problems: feedback };
      });

      if (!draft.ok && previous) {
        // The shorter rewrite failed its checks, but the first version passed and is recorded: use it
        // (a little over the target beats a failed run). Testing: a 135-word rewrite failed 3 times.
        const kept = previous;
        await step.run("save-voice-fallback", () =>
          setJob(jobId, { status: "voiced", segments: kept.segments, total_duration_s: kept.total, error: null }),
        );
        await step.sendEvent("start-render", { name: VOICE_READY, data: { jobId } });
        return { jobId, ok: true, total: kept.total, rounds: round, fallback: draft.problems };
      }
      if (!draft.ok) {
        await step.run(`fail-script-${round}`, () =>
          setJob(jobId, {
            status: "failed",
            error: `Couldn't write a script that passed the checks: ${draft.problems.join(" ")}`,
          }),
        );
        return { jobId, ok: false, problems: draft.problems };
      }

      const script = draft.script as Script;
      // Student videos label each part on screen ("THE QUESTION"), from its point's type.
      const parts = scriptSegments(script).map((part) => ({
        ...part,
        section: sectionFor(part.kind, "pointId" in part ? draft.pointTypes[part.pointId] : undefined, audience),
      }));
      await step.run(`mark-voicing-${round}`, () => setJob(jobId, { status: "voicing" }));

      // All parts are recorded at the same time, one step each, so a failed TTS/Whisper call only
      // retries that piece. Alongside them, the footage searches run (they only need the script).
      // Testing: recording one part after another took 30-138 s; footage search 17-28 s after it.
      const prefetch = step.run(`prefetch-footage-${round}`, () =>
        prefetchFootage(jobId, script, round).catch((e) => {
          console.warn(`[produce-voice] footage prefetch failed for ${jobId}: ${e instanceof Error ? e.message : e}`);
          return null;
        }),
      );
      const recorded = parts.map((part, i) =>
        step.run(`voice-${round}-${i}`, async () => {
          const audio = await textToSpeech(part.text, ttsSpeed);
          const audioPath = `${jobId}/r${round}-seg-${i}.mp3`;
          const { error } = await supabaseAdmin()
            .storage.from(MEDIA_BUCKET)
            .upload(audioPath, audio, { contentType: "audio/mpeg", upsert: true });
          if (error) throw new Error(`Uploading ${audioPath} failed: ${error.message}`);
          const { duration, words } = await transcribeWords(audio, part.text);
          // tts-1 bills the characters read aloud; Whisper the minutes of audio it hears.
          await saveUsage(jobId, `voice:${round}:${i}`, { ttsChars: part.text.length, whisperSeconds: duration });
          return { ...part, audioPath, duration, words };
        }),
      );
      const [segments] = await Promise.all([Promise.all(recorded) as Promise<Segment[]>, prefetch]);

      const total = Math.round(segments.reduce((s, x) => s + x.duration, 0) * 100) / 100;
      if (total <= MAX_DURATION_S || round === 2) {
        // After the shorter rewrite, use whichever recording is shorter, if it's within the hard limit.
        const best = previous && previous.total < total ? previous : { segments, total };
        const ok = best.total <= HARD_MAX_DURATION_S;
        await step.run("save-voice", () =>
          setJob(jobId, {
            status: ok ? "voiced" : "failed",
            segments: best.segments,
            total_duration_s: best.total,
            error: ok ? null : `Voiceover is ${best.total}s, over the ${HARD_MAX_DURATION_S}s limit.`,
            ...(best !== previous ? {} : { script: previous.script }),
          }),
        );
        // Hand off to Phase 4 (b-roll + render).
        if (ok) await step.sendEvent("start-render", { name: VOICE_READY, data: { jobId } });
        return { jobId, ok, total: best.total, rounds: round, draftAttempts: draft.attempt };
      }
      previous = { segments, total, script };

      // Too long: shrink the word budget in proportion (with a little margin) and go again.
      maxWords = Math.floor((maxWords * MAX_DURATION_S * 0.95) / total);
    }
  },
);
