"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { MAX_PDF_BYTES } from "@/lib/jobs";
import { checkPastedText, countWords, MAX_PASTE_WORDS, MAX_TITLE_CHARS, MIN_PASTE_WORDS } from "@/lib/text";
import { RecentJobs } from "@/components/recent-jobs";

// Start a new video (upload a PDF or paste text), then continue on the job's own page.
export default function Home() {
  const router = useRouter();
  const [mode, setMode] = useState<"pdf" | "text">("pdf");
  const [file, setFile] = useState<File | null>(null);
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submitText() {
    setError(null);
    const problem = checkPastedText(pastedText);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/jobs/text", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: pastedTitle, text: pastedText }),
      });
      const created = (await readJson(res)) as { jobId: string };
      router.push(`/jobs/${created.jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  async function upload() {
    if (!file) return;
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
        body: JSON.stringify({ filename: file.name, size: file.size }),
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

  const pastedWords = countWords(pastedText);

  return (
    <main className="mx-auto w-full max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-bold tracking-tight">ArticL</h1>
      <p className="mt-2 text-neutral-600 dark:text-neutral-400">
        Turn an article into a short vertical video. Upload a PDF or paste the text, then pick the points that matter.
      </p>

      <div className="mt-8 rounded-lg border border-neutral-300 p-6 dark:border-neutral-700">
        <div role="tablist" className="mb-5 inline-flex rounded-md bg-neutral-100 p-1 text-sm dark:bg-neutral-900">
          {(
            [
              ["pdf", "Upload PDF"],
              ["text", "Paste text"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              role="tab"
              aria-selected={mode === value}
              onClick={() => {
                setMode(value);
                setError(null);
              }}
              className={`rounded px-4 py-1.5 font-medium ${
                mode === value ? "bg-white shadow-sm dark:bg-neutral-700" : "text-neutral-600 dark:text-neutral-400"
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        {mode === "pdf" ? (
          <>
            <input
              type="file"
              accept="application/pdf,.pdf"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="block w-full text-sm file:mr-4 file:rounded-md file:border-0 file:bg-neutral-900 file:px-4 file:py-2 file:text-white dark:file:bg-neutral-100 dark:file:text-neutral-900"
            />
            <button
              onClick={upload}
              disabled={!file || busy}
              className="mt-4 rounded-md bg-yellow-400 px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
            >
              {busy ? "Uploading…" : "Upload and extract"}
            </button>
          </>
        ) : (
          <>
            <label className="block text-sm font-medium" htmlFor="paste-title">
              Title <span className="font-normal text-neutral-500">(optional, helps the video&apos;s opening line)</span>
            </label>
            <input
              id="paste-title"
              type="text"
              value={pastedTitle}
              maxLength={MAX_TITLE_CHARS}
              onChange={(e) => setPastedTitle(e.target.value)}
              placeholder="e.g. How Markets Shape Values and Political Preferences"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
            />
            <label className="mt-4 block text-sm font-medium" htmlFor="paste-text">
              Article text
            </label>
            <textarea
              id="paste-text"
              value={pastedText}
              onChange={(e) => setPastedText(e.target.value)}
              rows={10}
              placeholder="Paste the article here…"
              className="mt-1 block w-full rounded-md border border-neutral-300 bg-transparent px-3 py-2 text-sm leading-relaxed dark:border-neutral-700"
            />
            <p
              className={`mt-1 text-xs ${
                pastedWords > MAX_PASTE_WORDS ? "text-red-600" : "text-neutral-500 dark:text-neutral-400"
              }`}
            >
              {pastedWords.toLocaleString("en-US")} words
              {pastedWords > 0 && pastedWords < MIN_PASTE_WORDS && ` · at least ${MIN_PASTE_WORDS} needed`}
              {pastedWords > MAX_PASTE_WORDS && ` · limit is ${MAX_PASTE_WORDS.toLocaleString("en-US")}`}
            </p>
            <button
              onClick={submitText}
              disabled={busy || pastedWords < MIN_PASTE_WORDS || pastedWords > MAX_PASTE_WORDS}
              className="mt-4 rounded-md bg-yellow-400 px-5 py-2 font-semibold text-neutral-900 disabled:opacity-40"
            >
              {busy ? "Starting…" : "Use this text"}
            </button>
          </>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>

      <RecentJobs />
    </main>
  );
}
