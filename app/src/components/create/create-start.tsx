"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { MAX_PDF_BYTES, type Audience } from "@/lib/jobs";
import { Shell } from "./create-flow";
import { UploadDrop } from "./step-upload";
import { AudiencePicker } from "./step-audience";
import { post } from "./use-job";

/** Create the job, upload the PDF and start reading it. Audience is confirmed on step 2. */
async function uploadPaper(file: File): Promise<string> {
  const created = (await readJson(
    await fetch("/api/jobs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ filename: file.name, size: file.size, flow: "create" }),
    }),
  )) as { jobId: string; path: string; token: string };
  const { error } = await supabaseBrowser()
    .storage.from("articles")
    .uploadToSignedUrl(created.path, created.token, file, { contentType: "application/pdf" });
  if (error) throw new Error(`Upload failed: ${error.message}`);
  await readJson(await fetch(`/api/jobs/${created.jobId}/start`, { method: "POST" }));
  return created.jobId;
}

/**
 * Steps 1–2 on /create. Picking a PDF moves to the audience step; the upload runs in the
 * background. Continue waits for the upload if needed, saves the audience, and opens the job page.
 */
export function CreateStart() {
  const router = useRouter();
  const upload = useRef<Promise<string> | null>(null);
  const headerInput = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<1 | 2>(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function pick(file: File) {
    setError(null);
    if (!file.name.toLowerCase().endsWith(".pdf")) return setError("Please choose a PDF file.");
    if (file.size > MAX_PDF_BYTES) return setError("PDFs must be under 20 MB.");
    const running = uploadPaper(file);
    running.catch(() => {}); // reported when Continue is pressed
    upload.current = running;
    setStep(2);
  }

  async function confirm(audience: Audience) {
    if (!upload.current) return;
    setBusy(true);
    setError(null);
    let jobId: string;
    try {
      jobId = await upload.current;
    } catch (e) {
      upload.current = null;
      setBusy(false);
      setStep(1);
      setError(e instanceof Error ? e.message : String(e));
      return;
    }
    try {
      await post(jobId, "audience", { audience });
      router.replace(`/create/${jobId}`);
    } catch (e) {
      setBusy(false);
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const uploadAction =
    step === 1 ? (
      <>
        <input
          ref={headerInput}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) pick(f);
            e.target.value = "";
          }}
        />
        <button
          type="button"
          onClick={() => headerInput.current?.click()}
          className="inline-flex h-9 items-center justify-center rounded-xl bg-brand px-3.5 text-[13px] font-semibold text-neutral-950 shadow-[0_1px_0_rgba(0,0,0,0.04)] transition hover:bg-[var(--a2r-brand-strong)] active:scale-[0.98]"
        >
          Upload PDF
        </button>
      </>
    ) : undefined;

  return (
    <Shell
      step={1}
      audienceRecovery={step === 2}
      onBack={step === 2 && !busy ? () => setStep(1) : undefined}
      headerAction={uploadAction}
    >
      <div key={step} className={step === 2 ? "a2r-step-next" : "a2r-step-back"}>
        {step === 1 ? <UploadDrop onPick={pick} error={error} /> : <AudiencePicker busy={busy} error={error} onConfirm={confirm} />}
      </div>
    </Shell>
  );
}
