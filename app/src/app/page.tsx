"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { MAX_PDF_BYTES, type Audience } from "@/lib/jobs";
import { ArticleSection, type ArticlePayload, type ArticleSectionHandle } from "@/components/article-section";
import { AudienceSidebar } from "@/components/audience-sidebar";
import { ReelCarousel } from "@/components/reel-carousel";

// Start a new video (upload a PDF or paste text), then continue on the job's own page.
export default function Home() {
  const router = useRouter();
  const articleRef = useRef<ArticleSectionHandle>(null);
  const [audience, setAudience] = useState<Audience>("social");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [canGenerate, setCanGenerate] = useState(false);
  const onCanGenerateChange = useCallback((ready: boolean) => setCanGenerate(ready), []);

  async function submitText(title: string, text: string) {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/jobs/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, text, audience }),
      });
      const created = (await readJson(res)) as { jobId: string };
      router.push(`/jobs/${created.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function upload(file: File) {
    setError(null);
    if (file.size > MAX_PDF_BYTES) {
      setError("PDFs must be under 20 MB.");
      return;
    }

    setBusy(true);
    try {
      // 1. Create the job and get a one-time upload link.
      const createRes = await fetch("/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename: file.name, size: file.size, audience }),
      });
      const created = (await readJson(createRes)) as { jobId: string; path: string; token: string };

      // 2. Upload the PDF straight to Supabase Storage.
      const { error: uploadError } = await supabaseBrowser()
        .storage.from("articles")
        .uploadToSignedUrl(created.path, created.token, file, { contentType: "application/pdf" });
      if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

      // 3. Start background extraction, then follow the job on its own page.
      await readJson(await fetch(`/api/jobs/${created.jobId}/start`, { method: "POST" }));
      router.push(`/jobs/${created.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  function onSubmit(payload: ArticlePayload) {
    if (payload.kind === "pdf") void upload(payload.file);
    else void submitText(payload.title, payload.text);
  }

  return (
    <main className="mx-auto w-full max-w-6xl px-4 py-8 sm:px-6 sm:py-10 lg:py-12">
      <header className="max-w-none">
        <h1 className="text-3xl font-bold tracking-tight sm:whitespace-nowrap sm:text-4xl">
          Get your research seen like never before
        </h1>
        <p className="mt-2 text-sm text-neutral-600 sm:text-base dark:text-neutral-400">
          Upload a paper, choose your audience, and get a short video with every number checked against your study.
        </p>
      </header>

      <div className="mt-8 grid gap-4 lg:grid-cols-[17.5rem_minmax(0,1fr)] lg:items-start lg:gap-6">
        <AudienceSidebar
          audience={audience}
          onChange={setAudience}
          disabled={busy}
          busy={busy}
          canGenerate={canGenerate}
          onGenerate={() => articleRef.current?.submit()}
        />
        <ArticleSection
          ref={articleRef}
          busy={busy}
          error={error}
          onError={setError}
          onSubmit={onSubmit}
          onCanGenerateChange={onCanGenerateChange}
        />
      </div>

      <ReelCarousel />
    </main>
  );
}
