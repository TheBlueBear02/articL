import { extractText, getDocumentProxy } from "unpdf";
import { inngest, ARTICLE_UPLOADED, AUDIENCE_CHOSEN, HOOKS_REQUESTED, type ArticleUploadedData, type AudienceChosenData } from "./client";
import { supabaseAdmin, ARTICLES_BUCKET } from "@/lib/supabase/server";
import { setJob } from "@/lib/supabase/jobs-db";
import { proposeForJob } from "@/lib/propose";
import { readPaperMeta } from "@/lib/paper-meta";
import { generateHooksForJob } from "@/lib/create-flow";
import { cleanText, MIN_TEXT_CHARS } from "@/lib/text";
import { saveTokens, tokensOf } from "@/lib/usage-db";

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

    // /create flow: read the title and authors for the "Reading your paper" card, then wait for the
    // audience if it hasn't been chosen yet (POST /audience then sends AUDIENCE_CHOSEN).
    const flow = await step.run("read-flow", async () => {
      const { data } = await supabaseAdmin().from("jobs").select("flow").eq("id", jobId).single();
      return (data?.flow as string | null) ?? null;
    });
    if (flow === "create") {
      await step.run("read-paper-meta", async () => {
        const { data } = await supabaseAdmin().from("jobs").select("extracted_text").eq("id", jobId).single();
        try {
          const { meta, usage, model } = await readPaperMeta(data?.extracted_text ?? "");
          await setJob(jobId, { paper_meta: meta });
          await saveTokens(jobId, "meta:1", [tokensOf(model, usage)]);
          return meta;
        } catch (e) {
          // The card then shows the file name; never worth failing the job over.
          console.warn(`[extract-article] no paper meta for ${jobId}: ${e instanceof Error ? e.message : e}`);
          return null;
        }
      });
      // Atomic: only waits if the audience still isn't confirmed. If POST /audience got there first,
      // nothing is updated and the points are found right away.
      const waiting = await step.run("wait-for-audience", async () => {
        const { data } = await supabaseAdmin()
          .from("jobs")
          .update({ status: "awaiting_audience" })
          .eq("id", jobId)
          .eq("audience_confirmed", false)
          .select("id");
        return !!data?.length;
      });
      if (waiting) return { jobId, ...summary, waitingForAudience: true };
      const proposal = await step.run("propose-points", () => proposeForJob(jobId, "awaiting_findings"));
      if (proposal.ok) await step.sendEvent("write-hooks", { name: HOOKS_REQUESTED, data: { jobId } });
      return { jobId, ...summary, proposal };
    }

    // Ask the model for candidate points and keep only those the article supports, then wait for
    // the user to submit add-ons (Continue); scripting starts from /select.
    const proposal = await step.run("propose-points", () => proposeForJob(jobId, "awaiting_selection"));

    return { jobId, ...summary, proposal };
  },
);

// /create flow: the audience was chosen after the text was read (or the user asked for new
// findings): find and rank the points, then write hooks for the top one in the background.
export const proposeFindings = inngest.createFunction(
  {
    id: "propose-findings",
    triggers: [{ event: AUDIENCE_CHOSEN }],
    retries: 2,
    onFailure: async ({ event, error }) => {
      const { jobId } = event.data.event.data as AudienceChosenData;
      await setJob(jobId, { status: "failed", error: error.message });
    },
  },
  async ({ event, step }) => {
    const { jobId } = event.data as AudienceChosenData;
    const proposal = await step.run("propose-points", () => proposeForJob(jobId, "awaiting_findings"));
    if (proposal.ok) await step.sendEvent("write-hooks", { name: HOOKS_REQUESTED, data: { jobId } });
    return { jobId, proposal };
  },
);

// /create flow: hook options for the lead finding. A failure leaves the hooks empty (the page offers
// "Try again" and "Write your own") rather than failing the job.
export const writeHooks = inngest.createFunction(
  { id: "write-hooks", triggers: [{ event: HOOKS_REQUESTED }], retries: 1 },
  async ({ event, step }) => {
    const { jobId, more = 0 } = event.data as { jobId: string; more?: number };
    try {
      return await step.run("write-hooks", () => generateHooksForJob(jobId, more));
    } catch (e) {
      await step.run("save-no-hooks", async () => {
        if (!more) return setJob(jobId, { hooks: { leadId: "", pointIds: [], items: [], failed: true } });
        // "More hooks" failed: keep the hooks already shown.
        const { data } = await supabaseAdmin().from("jobs").select("hooks").eq("id", jobId).single();
        if (data?.hooks) await setJob(jobId, { hooks: { ...data.hooks, pending: false, moreFailed: true } });
      });
      return { jobId, failed: e instanceof Error ? e.message : String(e) };
    }
  },
);
