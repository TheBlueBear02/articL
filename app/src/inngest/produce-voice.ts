import { inngest, POINTS_SELECTED, VOICE_READY, type PointsSelectedData } from "./client";
import { supabaseAdmin } from "@/lib/supabase/server";
import { setJob, MEDIA_BUCKET } from "@/lib/supabase/jobs-db";
import {
  autoFixScript,
  checkScript,
  DEFAULT_MAX_WORDS,
  draftScript,
  OPTIONAL_FIELD_PROBLEM,
  scriptSegments,
  settingBlock,
  SOFT_PROBLEM,
  verifyCredit,
} from "@/lib/script";
import { textToSpeech, transcribeWords } from "@/lib/voice";
import type { CandidatePoint, Script, Segment, StudySetting } from "@/lib/jobs";

const MAX_DURATION_S = 60;
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
    let maxWords = DEFAULT_MAX_WORDS;

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
        for (let attempt = 1; attempt <= DRAFT_ATTEMPTS; attempt++) {
          const { script: raw, usage, model } = await draftScript({ title, opening, points, setting, maxWords, feedback });
          // Slips with one right answer are corrected, not sent back for a rewrite.
          let { script: drafted } = autoFixScript(raw, points);
          const source = `${title}\n${opening}`;
          feedback = checkScript(drafted, points, maxWords, source, settingText);
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
            feedback = checkScript(drafted, points, maxWords, source, settingText).filter((p) => !SOFT_PROBLEM.test(p));
          }
          if (!feedback.length) {
            const script = { ...drafted, sourceCredit: verifyCredit(drafted.sourceCredit, text) };
            await setJob(jobId, { script });
            return { ok: true as const, script, usage, model, attempt };
          }
        }
        return { ok: false as const, problems: feedback };
      });

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
      const parts = scriptSegments(script);
      const segments: Segment[] = [];

      // One step per segment, so a failed TTS/Whisper call only retries that piece.
      for (const [i, part] of parts.entries()) {
        const seg = await step.run(`voice-${round}-${i}`, async () => {
          if (i === 0) await setJob(jobId, { status: "voicing" });
          const audio = await textToSpeech(part.text);
          const audioPath = `${jobId}/r${round}-seg-${i}.mp3`;
          const { error } = await supabaseAdmin()
            .storage.from(MEDIA_BUCKET)
            .upload(audioPath, audio, { contentType: "audio/mpeg", upsert: true });
          if (error) throw new Error(`Uploading ${audioPath} failed: ${error.message}`);
          const { duration, words } = await transcribeWords(audio, part.text);
          return { ...part, audioPath, duration, words };
        });
        segments.push(seg as Segment);
      }

      const total = Math.round(segments.reduce((s, x) => s + x.duration, 0) * 100) / 100;
      if (total <= MAX_DURATION_S || round === 2) {
        await step.run("save-voice", () =>
          setJob(jobId, {
            status: total <= MAX_DURATION_S ? "voiced" : "failed",
            segments,
            total_duration_s: total,
            error: total <= MAX_DURATION_S ? null : `Voiceover is ${total}s, over the ${MAX_DURATION_S}s limit.`,
          }),
        );
        // Hand off to Phase 4 (b-roll + render).
        if (total <= MAX_DURATION_S) await step.sendEvent("start-render", { name: VOICE_READY, data: { jobId } });
        return { jobId, ok: total <= MAX_DURATION_S, total, rounds: round, draftAttempts: draft.attempt };
      }

      // Too long: shrink the word budget in proportion (with a little margin) and go again.
      maxWords = Math.floor((maxWords * MAX_DURATION_S * 0.95) / total);
    }
  },
);
