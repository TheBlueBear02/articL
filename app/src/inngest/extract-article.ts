import { extractText, getDocumentProxy } from "unpdf";
import { inngest, ARTICLE_UPLOADED, type ArticleUploadedData } from "./client";
import { supabaseAdmin, ARTICLES_BUCKET } from "@/lib/supabase/server";
import { setJob } from "@/lib/supabase/jobs-db";
import { proposePoints } from "@/lib/openai";
import { applyRecommendations, trimBackMatter, verifyPoints, verifySetting } from "@/lib/points";
import { MAX_SELECTED_POINTS, type CandidatePoint, type StudySetting } from "@/lib/jobs";
import { cleanText, MIN_TEXT_CHARS } from "@/lib/text";

// Below this many verified points the checklist isn't useful; ask the model once more.
const MIN_VERIFIED_POINTS = 3;

export const extractArticle = inngest.createFunction(
  {
    id: "extract-article",
    triggers: [{ event: ARTICLE_UPLOADED }],
    retries: 2,
    // Runs after all retries are used up: record the error so the page can show it.
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data as ArticleUploadedData;
      await setJob(jobId, { status: "failed", error: error.message });
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as ArticleUploadedData;

    const filePath = await step.run("mark-extracting", async () => {
      const { data, error } = await supabaseAdmin()
        .from("jobs")
        .update({ status: "extracting", error: null })
        .eq("id", jobId)
        .select("file_path")
        .single();
      if (error) throw new Error(`Job ${jobId} not found: ${error.message}`);
      return data.file_path as string;
    });

    // Download, extract and save in one step so the (possibly large) article text
    // never has to pass through Inngest's step state.
    const summary = await step.run("extract-and-save", async () => {
      // Pasted-text jobs have no PDF (empty file_path): the text was saved when the job was
      // created, so there's nothing to extract.
      if (!filePath) {
        await setJob(jobId, { status: "extracted" });
        return { ok: true, pages: null, words: null };
      }

      const { data: blob, error } = await supabaseAdmin().storage.from(ARTICLES_BUCKET).download(filePath);
      if (error || !blob) throw new Error(`Downloading ${filePath} failed: ${error?.message}`);

      const pdf = await getDocumentProxy(new Uint8Array(await blob.arrayBuffer()));
      const { totalPages, text } = await extractText(pdf, { mergePages: true });
      const cleaned = cleanText(text);

      if (cleaned.length < MIN_TEXT_CHARS) {
        // Not worth retrying: the file simply has no text layer.
        await setJob(jobId, {
          status: "failed",
          page_count: totalPages,
          error: "No readable text found. This may be a scanned PDF (images of pages), which isn't supported yet.",
        });
        return { ok: false, pages: totalPages, words: 0 };
      }

      const words = cleaned.split(/\s+/).length;
      await setJob(jobId, {
        status: "extracted",
        page_count: totalPages,
        word_count: words,
        extracted_text: cleaned,
      });
      return { ok: true, pages: totalPages, words };
    });

    if (!summary.ok) return { jobId, ...summary };

    // Ask the model for candidate points and keep only those the article supports.
    // Reads the text from the database rather than passing it through step state.
    const proposal = await step.run("propose-points", async () => {
      await setJob(jobId, { status: "proposing" });
      const { data, error } = await supabaseAdmin().from("jobs").select("extracted_text").eq("id", jobId).single();
      if (error || !data?.extracted_text) throw new Error(`Reading text for job ${jobId} failed: ${error?.message}`);
      const fullText: string = data.extracted_text;
      const articleText = trimBackMatter(fullText);

      const usage = [];
      let kept: CandidatePoint[] = [];
      let dropped: { reason: string; text: string }[] = [];
      let setting: StudySetting = {};
      for (let attempt = 1; attempt <= 2 && kept.length < MIN_VERIFIED_POINTS; attempt++) {
        const result = await proposePoints(articleText);
        usage.push({ model: result.model, ...result.usage });
        const withIds = result.points.map((p, i) => ({ id: `p${i + 1}`, ...p }));
        const verified = verifyPoints(withIds, fullText);
        kept = verified.kept;
        dropped = verified.dropped.map((d) => ({ reason: d.reason, text: d.point.text }));
        setting = verifySetting(result.setting, fullText);
      }

      if (kept.length < MIN_VERIFIED_POINTS) {
        await setJob(jobId, {
          status: "failed",
          error: "Couldn't find enough points that could be checked against the article text. Try another article.",
        });
        return { ok: false, kept: kept.length, dropped, usage };
      }

      // Pre-select the best 5 (recommended first), then renumber so ids are tidy.
      const points = applyRecommendations(kept, MAX_SELECTED_POINTS).map((p, i) => ({ ...p, id: `p${i + 1}` }));
      try {
        await setJob(jobId, { status: "awaiting_selection", candidate_points: points, study_setting: setting });
      } catch (e) {
        // Before migration 0007 there is no study_setting column: save the points without it.
        if (!/study_setting/.test(String(e))) throw e;
        await setJob(jobId, { status: "awaiting_selection", candidate_points: points });
      }
      const modelRecommended = kept.filter((p) => p.recommended).length;
      return { ok: true, kept: points.length, modelRecommended, dropped, setting, usage };
    });

    return { jobId, ...summary, proposal };
  },
);
