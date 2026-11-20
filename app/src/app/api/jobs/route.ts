import { supabaseAdmin, ARTICLES_BUCKET } from "@/lib/supabase/server";
import { MAX_PDF_BYTES } from "@/lib/jobs";

// Step 1 of an upload: create the job row and hand the browser a one-time signed
// URL so the PDF goes straight to Supabase Storage (not through this server).
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const filename = typeof body?.filename === "string" ? body.filename.trim() : "";
  const size = typeof body?.size === "number" ? body.size : NaN;

  if (!filename.toLowerCase().endsWith(".pdf")) {
    return Response.json({ error: "Please upload a .pdf file." }, { status: 400 });
  }
  if (!(size > 0 && size <= MAX_PDF_BYTES)) {
    return Response.json({ error: "PDFs must be under 20 MB." }, { status: 400 });
  }

  const supabase = supabaseAdmin();
  const id = crypto.randomUUID();
  const filePath = `${id}.pdf`;

  const { error: insertError } = await supabase
    .from("jobs")
    .insert({ id, original_filename: filename, file_path: filePath });
  if (insertError) {
    return Response.json({ error: `Could not create job: ${insertError.message}` }, { status: 500 });
  }

  const { data, error } = await supabase.storage.from(ARTICLES_BUCKET).createSignedUploadUrl(filePath);
  if (error || !data) {
    return Response.json({ error: `Could not create upload link: ${error?.message}` }, { status: 500 });
  }

  return Response.json({ jobId: id, path: data.path, token: data.token });
}
