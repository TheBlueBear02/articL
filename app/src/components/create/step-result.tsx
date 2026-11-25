"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Job } from "@/lib/jobs";
import { defaultPostText } from "@/lib/post-text";
import { Button, Card, ErrorNote, Spinner, StepHeading } from "./ui";
import { PostTextCard } from "./step-build";
import { post, track } from "./use-job";

/** Step 7: the finished reel, with download, share, post text and what to do next. */
export function StepResult({ job }: { job: Job }) {
  const router = useRouter();
  const [links, setLinks] = useState<{ url: string; downloadUrl: string } | null>(null);
  const [busy, setBusy] = useState<"share" | "another" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/jobs/${job.id}/video`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setLinks(d)))
      .catch((e) => setError(String(e)));
  }, [job.id]);

  const fileName = `${(job.paper_meta?.title ?? "articl").slice(0, 50).replace(/[^\w]+/g, "-").toLowerCase()}-reel.mp4`;
  const caption = job.post_texts?.instagram ?? defaultPostText("instagram", job.script, job.author_info, job.paper_meta);

  async function share() {
    if (!links) return;
    setBusy("share");
    setNote(null);
    try {
      const blob = await (await fetch(links.url)).blob();
      const file = new File([blob], fileName, { type: "video/mp4" });
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], text: caption });
        track(job.id, "share", { via: "share-sheet" });
      } else {
        await navigator.clipboard.writeText(caption);
        setNote("Sharing files isn't supported here. Download the video; the post text is copied.");
        track(job.id, "share", { via: "fallback" });
      }
    } catch (e) {
      if (!(e instanceof DOMException && e.name === "AbortError")) setNote("Couldn't open sharing. Try Download instead.");
    } finally {
      setBusy(null);
    }
  }

  async function another() {
    setBusy("another");
    setError(null);
    try {
      const { jobId } = await post<{ jobId: string }>(job.id, "clone");
      router.push(`/create/${jobId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(null);
    }
  }

  return (
    <>
      <StepHeading step={7} eyebrow="Step 7 · Creating the video" title="Ready to post" />

      <div className="a2r-rise mx-auto aspect-[9/16] w-full max-w-[300px] overflow-hidden rounded-[28px] bg-neutral-950 shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)]">
        {links ? (
          <video src={links.url} controls playsInline loop preload="metadata" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center text-white/60">
            <Spinner />
          </div>
        )}
      </div>

      <div className="mt-6 grid grid-cols-2 gap-2">
        <a
          href={links?.downloadUrl}
          onClick={() => track(job.id, "download")}
          aria-disabled={!links}
          className="col-span-2 inline-flex h-[52px] items-center justify-center rounded-2xl bg-brand text-[15px] font-semibold text-neutral-950 shadow-[0_8px_20px_-8px_rgba(242,194,0,0.7)] transition active:scale-[0.98] aria-disabled:pointer-events-none aria-disabled:opacity-40"
        >
          Download video
        </a>
        <Button variant="secondary" disabled={!links} busy={busy === "share"} onClick={share}>
          Share
        </Button>
        <Button variant="secondary" busy={busy === "another"} onClick={another}>
          Make another version
        </Button>
      </div>
      {note && <p className="mt-3 text-center text-[13px] text-neutral-500">{note}</p>}
      <ErrorNote>{error}</ErrorNote>

      <div className="mt-6">
        <PostTextCard job={job} index={1} />
      </div>

      <Card index={2} className="mt-3 divide-y divide-neutral-100">
        <NextRow
          title="Try another paper"
          hint="Start fresh with a new PDF"
          onClick={() => {
            track(job.id, "another_paper");
            router.push("/create");
          }}
        />
      </Card>
      <div className="h-10" />
    </>
  );
}

function NextRow({ title, hint, onClick, busy }: { title: string; hint: string; onClick: () => void; busy?: boolean }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className="flex w-full items-center justify-between gap-3 px-5 py-4 text-left transition hover:bg-neutral-50">
      <span>
        <span className="block text-[15px] font-semibold text-neutral-950">{title}</span>
        <span className="mt-0.5 block text-[13px] text-neutral-500">{hint}</span>
      </span>
      {busy ? (
        <Spinner />
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" aria-hidden>
          <path d="M9 6l6 6-6 6" stroke="#a3a3a3" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      )}
    </button>
  );
}
