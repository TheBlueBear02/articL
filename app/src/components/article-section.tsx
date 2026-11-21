"use client";

import { forwardRef, useEffect, useId, useImperativeHandle, useRef, useState } from "react";
import { MAX_PDF_BYTES } from "@/lib/jobs";
import { checkPastedText, countWords, MAX_PASTE_WORDS, MAX_TITLE_CHARS, MIN_PASTE_WORDS } from "@/lib/text";

type Mode = "pdf" | "text";

export type ArticlePayload =
  | { kind: "pdf"; file: File }
  | { kind: "text"; title: string; text: string };

export type ArticleSectionHandle = {
  submit: () => void;
};

type Props = {
  busy: boolean;
  error: string | null;
  onError: (message: string | null) => void;
  onSubmit: (payload: ArticlePayload) => void;
  onCanGenerateChange?: (canGenerate: boolean) => void;
};

/** Main create-flow panel: drag-and-drop while empty, article reader once a PDF or text is ready. */
export const ArticleSection = forwardRef<ArticleSectionHandle, Props>(function ArticleSection(
  { busy, error, onError, onSubmit, onCanGenerateChange },
  ref,
) {
  const inputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<Mode>("pdf");
  const [dragging, setDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [pastedTitle, setPastedTitle] = useState("");
  const [pastedText, setPastedText] = useState("");
  const [textEditing, setTextEditing] = useState(true);

  const pastedWords = countWords(pastedText);
  const hasPdf = mode === "pdf" && file != null;
  const hasReadableText = mode === "text" && !textEditing && pastedWords >= MIN_PASTE_WORDS && pastedWords <= MAX_PASTE_WORDS;
  const canGenerate = hasPdf || hasReadableText;

  useEffect(() => {
    onCanGenerateChange?.(canGenerate);
  }, [canGenerate, onCanGenerateChange]);

  useEffect(() => {
    if (!file) {
      setPreviewUrl(null);
      return;
    }
    // Chrome/Edge honor these open params on blob URLs: hide the viewer toolbar and thumbnail sidebar.
    const url = `${URL.createObjectURL(file)}#toolbar=0&navpanes=0`;
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url.split("#")[0]!);
  }, [file]);

  function acceptFile(next: File | null) {
    onError(null);
    if (!next) {
      setFile(null);
      return;
    }
    const isPdf = next.type === "application/pdf" || next.name.toLowerCase().endsWith(".pdf");
    if (!isPdf) {
      onError("Please drop a PDF file.");
      return;
    }
    if (next.size > MAX_PDF_BYTES) {
      onError("PDFs must be under 20 MB.");
      return;
    }
    setMode("pdf");
    setFile(next);
  }

  function clearArticle() {
    setFile(null);
    setPastedTitle("");
    setPastedText("");
    setTextEditing(true);
    onError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function switchMode(next: Mode) {
    if (busy) return;
    setMode(next);
    onError(null);
    if (next === "pdf") setTextEditing(true);
  }

  function startTextReader() {
    const problem = checkPastedText(pastedText);
    if (problem) {
      onError(problem);
      return;
    }
    onError(null);
    setTextEditing(false);
  }

  function submit() {
    if (mode === "pdf") {
      if (!file) return;
      onSubmit({ kind: "pdf", file });
      return;
    }
    if (textEditing) {
      startTextReader();
      return;
    }
    const problem = checkPastedText(pastedText);
    if (problem) {
      onError(problem);
      return;
    }
    onSubmit({ kind: "text", title: pastedTitle, text: pastedText });
  }

  useImperativeHandle(ref, () => ({ submit }), [mode, file, pastedTitle, pastedText, textEditing]);

  const empty = mode === "pdf" ? !file : textEditing && pastedWords === 0;

  return (
    <section className="flex min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:min-h-[32rem]">
      <div className="flex min-h-0 flex-1 flex-col">
        {mode === "pdf" && !file && (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload PDF"
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                fileInputRef.current?.click();
              }
            }}
            onClick={() => fileInputRef.current?.click()}
            onDragEnter={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(e) => {
              e.preventDefault();
              if (e.currentTarget.contains(e.relatedTarget as Node)) return;
              setDragging(false);
            }}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              acceptFile(e.dataTransfer.files?.[0] ?? null);
            }}
            className={`m-4 flex flex-1 cursor-pointer flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-16 text-center transition sm:m-5 sm:py-20 ${
              dragging
                ? "border-brand bg-neutral-200 dark:border-brand dark:bg-neutral-800"
                : "border-neutral-300 bg-neutral-100 hover:border-neutral-400 hover:bg-neutral-200/80 dark:border-neutral-700 dark:bg-neutral-900 dark:hover:border-neutral-500"
            }`}
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-white text-neutral-700 dark:bg-neutral-800 dark:text-neutral-200">
              <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                <path d="M12 16V4m0 0 4 4m-4-4-4 4" strokeLinecap="round" strokeLinejoin="round" />
                <path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4" strokeLinecap="round" />
              </svg>
            </span>
            <p className="mt-4 text-base font-semibold tracking-tight">Drag and drop your PDF here</p>
            <p className="mt-1 max-w-sm text-sm text-neutral-500 dark:text-neutral-400">
              or click to browse · up to 20 MB
            </p>
            <button
              type="button"
              disabled={busy}
              onClick={(e) => {
                e.stopPropagation();
                switchMode("text");
              }}
              className="mt-4 text-sm font-medium text-neutral-600 underline-offset-2 hover:underline dark:text-neutral-300"
            >
              Or paste text instead
            </button>
            <input
              ref={fileInputRef}
              id={inputId}
              type="file"
              accept="application/pdf,.pdf"
              className="sr-only"
              disabled={busy}
              onChange={(e) => acceptFile(e.target.files?.[0] ?? null)}
            />
          </div>
        )}

        {mode === "pdf" && file && previewUrl && (
          <iframe
            title={`Preview of ${file.name}`}
            src={previewUrl}
            className="min-h-[22rem] w-full flex-1 bg-neutral-100 dark:bg-neutral-900"
          />
        )}

        {mode === "text" && textEditing && (
          <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-medium">Paste article text</p>
              <button
                type="button"
                disabled={busy}
                onClick={() => switchMode("pdf")}
                className="text-xs font-medium text-neutral-500 underline-offset-2 hover:underline"
              >
                Upload PDF instead
              </button>
            </div>
            <div>
              <label className="block text-sm font-medium" htmlFor="paste-title">
                Title <span className="font-normal text-neutral-500">(optional)</span>
              </label>
              <input
                id="paste-title"
                type="text"
                value={pastedTitle}
                maxLength={MAX_TITLE_CHARS}
                disabled={busy}
                onChange={(e) => setPastedTitle(e.target.value)}
                placeholder="e.g. How Markets Shape Values and Political Preferences"
                className="mt-1 block w-full rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm dark:border-neutral-700"
              />
            </div>
            <div className="flex min-h-0 flex-1 flex-col">
              <label className="block text-sm font-medium" htmlFor="paste-text">
                Article text
              </label>
              <textarea
                id="paste-text"
                value={pastedText}
                disabled={busy}
                onChange={(e) => setPastedText(e.target.value)}
                rows={12}
                placeholder="Paste the article here…"
                className="mt-1 min-h-[14rem] w-full flex-1 resize-y rounded-lg border border-neutral-200 bg-transparent px-3 py-2 text-sm leading-relaxed dark:border-neutral-700"
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
            </div>
          </div>
        )}

        {mode === "text" && hasReadableText && (
          <article className="min-h-[22rem] flex-1 overflow-auto px-4 py-5 sm:px-8 sm:py-6">
            {pastedTitle.trim() && (
              <h3 className="mb-4 text-xl font-semibold tracking-tight text-balance">{pastedTitle.trim()}</h3>
            )}
            <div className="whitespace-pre-wrap text-sm leading-7 text-neutral-800 dark:text-neutral-200">{pastedText}</div>
          </article>
        )}
      </div>

      <footer className="border-t border-neutral-200 px-4 py-3 dark:border-neutral-800 sm:px-5">
        {error && <p className="mb-2 text-sm text-red-600">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {hasPdf && file ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate text-sm font-medium" title={file.name}>
                  {file.name}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearArticle}
                  aria-label="Remove article"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ) : hasReadableText ? (
              <div className="flex min-w-0 items-center gap-1.5">
                <p className="min-w-0 truncate text-sm font-medium" title={pastedTitle.trim() || "Pasted article"}>
                  {pastedTitle.trim() || "Pasted article"}
                </p>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setTextEditing(true)}
                  className="shrink-0 rounded-md px-2 py-1 text-xs font-medium text-neutral-500 underline-offset-2 hover:underline disabled:opacity-40"
                >
                  Edit
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={clearArticle}
                  aria-label="Remove article"
                  className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-neutral-500 transition hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-40 dark:hover:bg-neutral-800 dark:hover:text-neutral-100"
                >
                  <svg viewBox="0 0 20 20" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.75" aria-hidden>
                    <path d="M5 5l10 10M15 5 5 15" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            ) : (
              <p className="text-xs text-neutral-500 dark:text-neutral-400">
                {empty
                  ? "Add an article to continue."
                  : "Review the text as a readable article before creating."}
              </p>
            )}
          </div>
          {mode === "text" && textEditing && (
            <button
              type="button"
              disabled={busy || pastedWords < MIN_PASTE_WORDS || pastedWords > MAX_PASTE_WORDS}
              onClick={startTextReader}
              className="rounded-lg bg-neutral-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40 dark:bg-neutral-100 dark:text-neutral-900"
            >
              Preview article
            </button>
          )}
        </div>
      </footer>
    </section>
  );
});
