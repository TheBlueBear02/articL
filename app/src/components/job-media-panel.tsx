"use client";

import { useEffect, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/browser";
import { readJson } from "@/lib/api-client";
import { STATUS_LABEL, type JobStatus } from "@/lib/jobs";

type Props = {
  jobId: string;
  filename: string;
  status: JobStatus;
  /** Empty string for pasted-text jobs (no PDF in Storage). */
  filePath: string;
  wordCount: number | null;
};

type ArticleSource =
  | { kind: "pdf"; url: string }
  | { kind: "text"; text: string }
  | { kind: "loading" }
  | { kind: "waiting" }
  | { kind: "error"; message: string };

/** Article preview for the job page (PDF iframe or pasted text). */
export function JobMediaPanel({
  jobId,
  filename,
  status,
  filePath,
  wordCount,
}: Props) {
  const isPdfJob = filePath !== "";
  const [article, setArticle] = useState<ArticleSource>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (isPdfJob) {
        setArticle({ kind: "loading" });
        try {
          const body = (await readJson(await fetch(`/api/jobs/${jobId}/article`))) as {
            kind: "pdf" | "text";
            url?: string;
          };
          if (cancelled) return;
          if (body.kind === "pdf" && body.url) setArticle({ kind: "pdf", url: body.url });
          else setArticle({ kind: "error", message: "No PDF preview available." });
        } catch (e) {
          if (!cancelled) setArticle({ kind: "error", message: e instanceof Error ? e.message : String(e) });
        }
        return;
      }

      // Pasted text: show the extracted article once it exists.
      if ((wordCount ?? 0) <= 0) {
        setArticle({ kind: "waiting" });
        return;
      }
      setArticle({ kind: "loading" });
      const { data, error } = await supabaseBrowser().from("jobs").select("extracted_text").eq("id", jobId).single();
      if (cancelled) return;
      if (error) setArticle({ kind: "error", message: error.message });
      else setArticle({ kind: "text", text: data?.extracted_text ?? "" });
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId, isPdfJob, wordCount]);

  return (
    <section className="flex h-full min-h-[28rem] flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-white dark:border-neutral-800 dark:bg-neutral-950 lg:min-h-[32rem]">
      <div className="min-h-[22rem] min-w-0 flex-1 overflow-hidden p-2 md:min-h-0">
        <div className="h-full min-h-0 overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-900">
          {article.kind === "pdf" ? (
            <iframe title={`Preview of ${filename}`} src={article.url} className="h-full w-full border-0" />
          ) : article.kind === "text" ? (
            <article className="h-full overflow-auto px-4 py-5 sm:px-6 sm:py-5">
              <div className="whitespace-pre-wrap text-sm leading-7 text-neutral-800 dark:text-neutral-200">{article.text}</div>
            </article>
          ) : article.kind === "error" ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-sm text-red-600">{article.message}</p>
            </div>
          ) : article.kind === "waiting" ? (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-sm font-medium">{STATUS_LABEL[status]}</p>
              <p className="mt-1 text-xs text-neutral-500 dark:text-neutral-400">
                The article preview will show here once the text is ready.
              </p>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center px-6 text-center">
              <p className="text-sm text-neutral-500 dark:text-neutral-400">
                {isPdfJob ? "Loading PDF…" : "Loading article…"}
              </p>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

/** Finished reel player + download. Only mount once status is rendered. */
export function ReelPanel({ jobId }: { jobId: string }) {
  const [links, setLinks] = useState<{ url: string; downloadUrl: string } | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${jobId}/video`)
      .then(readJson)
      .then((body) => setLinks(body as unknown as { url: string; downloadUrl: string }))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)));
  }, [jobId]);

  return (
    <aside className="flex h-full min-h-[28rem] w-full flex-col overflow-hidden rounded-2xl border border-neutral-200 bg-neutral-50 dark:border-neutral-800 dark:bg-neutral-900/40 lg:min-h-[32rem] lg:w-[19rem] xl:w-[21rem]">
      <div className="flex min-h-[22rem] flex-1 flex-col p-2 md:min-h-0">
        {loadError && <p className="mb-2 shrink-0 text-xs text-red-600">{loadError}</p>}
        {links ? (
          <>
            <div className="flex min-h-0 flex-1 items-center justify-center">
              <video
                src={links.url}
                controls
                loop
                playsInline
                preload="metadata"
                className="h-full max-h-full w-auto max-w-full rounded-lg object-cover aspect-[9/16]"
              />
            </div>
            <a
              href={links.downloadUrl}
              className="mx-auto mt-2 flex h-[30px] shrink-0 items-center rounded-md bg-brand px-3 text-xs font-semibold text-neutral-900"
            >
              Download MP4
            </a>
          </>
        ) : (
          !loadError && (
            <div className="flex flex-1 items-center justify-center text-xs text-neutral-500 dark:text-neutral-400">
              Loading video…
            </div>
          )
        )}
      </div>
    </aside>
  );
}
