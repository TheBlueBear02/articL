import { supabaseAdmin } from "@/lib/supabase/server";
import { ARTICLE_UPLOADED } from "@/inngest/client";
import { sendJobEvent } from "@/inngest/send";
import { checkPastedText, cleanText, countWords, MAX_TITLE_CHARS } from "@/lib/text";
import { audienceColumn, parseAudience } from "@/lib/audience-input";

// Create a job from pasted article text instead of a PDF. The text is stored right away and
// the same background job runs from the points step on. A pasted-text job is recognised by
// its empty file_path (there is no PDF in Storage).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const rawText = typeof body?.text === "string" ? body.text : "";
  const title = typeof body?.title === "string" ? body.title.trim().replace(/\s+/g, " ").slice(0, MAX_TITLE_CHARS) : "";

  const text = cleanText(rawText);
  const problem = checkPastedText(text);
  if (problem) return Response.json({ error: problem }, { status: 400 });
  const parsed = parseAudience(body?.audience);
  if ("error" in parsed) return Response.json({ error: parsed.error }, { status: 400 });

  // The script step takes the article's first line as its title, so put the title first.
  const extracted = title ? `${title}\n\n${text}` : text;
  const id = crypto.randomUUID();
  const supabase = supabaseAdmin();

  const { error } = await supabase.from("jobs").insert({
    id,
    status: "uploaded",
    original_filename: title || "Pasted text",
    file_path: "",
    extracted_text: extracted,
    word_count: countWords(extracted),
    ...audienceColumn(parsed.audience),
  });
  if (error) return Response.json({ error: `Could not create job: ${error.message}` }, { status: 500 });

  const sendError = await sendJobEvent(ARTICLE_UPLOADED, { jobId: id });
  if (sendError) {
    await supabase.from("jobs").update({ status: "failed", error: sendError }).eq("id", id);
    return Response.json({ error: sendError }, { status: 503 });
  }
  return Response.json({ jobId: id });
}
