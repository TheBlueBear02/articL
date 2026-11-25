"use client";

import { useRef, useState, type CSSProperties } from "react";
import type { Job } from "@/lib/jobs";
import { ActionBar, Button, Card, ErrorNote, Skeleton, StepHeading, Working, cx } from "./ui";
import { RecentReels } from "./recent-reels";
import { AudienceTypes } from "./audience-types";
import { PaperToReel } from "./paper-to-reel";

/** Step 1: pick a PDF. Choosing a file moves on to audience (see CreateStart); this only hands it over. */
export function UploadDrop({ onPick, error }: { onPick: (file: File) => void; error?: string | null }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  function take(f: File | undefined) {
    if (f) onPick(f);
  }

  return (
    <>
      <StepHeading step={1} eyebrow="Step 1 · Upload your paper" title="Get your research seen like never before">
        Upload a paper, choose your audience, and get a short video with every number checked against your study.
      </StepHeading>

      <Card
        as="label"
        className={cx(
          "flex cursor-pointer flex-col items-center justify-center gap-4 border-dashed border-neutral-300 bg-neutral-100! px-6 py-14 text-center",
          dragging && "border-transparent bg-[var(--a2r-brand-tint)]! shadow-[0_0_0_2px_var(--a2r-brand)]",
        )}
        onDragOver={(e: React.DragEvent) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e: React.DragEvent) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" aria-hidden>
            <path d="M12 16V4m0 0l-4.5 4.5M12 4l4.5 4.5M5 15v3a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-3" stroke="#111" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        <span className="text-center">
          <span className="block text-[17px] font-semibold text-neutral-950">Upload a PDF</span>
          <span className="mt-1 block text-[13px] text-neutral-500">or drop it here</span>
        </span>
        <input
          ref={inputRef}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
      </Card>
      <ErrorNote>{error}</ErrorNote>

      <ul className="mt-8 space-y-3 text-[13px] text-neutral-500">
        {["Findings checked against your paper's own sentences", "Full video, script, voice and graphics in less than 4 minutes", "No AI model uses your research for training"].map(
          (t, i) => (
            <li key={t} className="a2r-rise flex items-center gap-3" style={{ "--i": i + 2 } as CSSProperties}>
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              {t}
            </li>
          ),
        )}
      </ul>

      {/* Tall scroll demo stays on mobile; desktop uses the right-pane compact preview. */}
      <div className="lg:hidden">
        <PaperToReel />
      </div>

      {/* Informational only — audience is chosen on step 2. */}
      <AudienceTypes />

      <RecentReels />

      <ActionBar pin="viewport">
        <Button onClick={() => inputRef.current?.click()}>Upload PDF</Button>
      </ActionBar>
    </>
  );
}

/** "Reading your paper…" card: file name first, then title and authors once found. */
export function PaperCard({ filename, job, reading }: { filename: string; job?: Job | null; reading?: boolean }) {
  const meta = job?.paper_meta;
  const read = !!job && !["awaiting_upload", "uploaded", "extracting"].includes(job.status);
  const metaDone = read && job?.stage_times?.extracted != null && (meta != null || job.status !== "extracted");
  return (
    <Card className="overflow-hidden">
      <div className="flex items-start gap-4 p-5">
        <div className="flex h-14 w-11 shrink-0 items-end justify-center rounded-lg border border-neutral-200 bg-[var(--a2r-soft)] pb-1.5">
          <span className="text-[9px] font-bold tracking-wider text-neutral-500">PDF</span>
        </div>
        <div className="min-w-0 flex-1">
          {meta?.title ? (
            <p className="a2r-rise text-[15px] font-semibold leading-snug text-neutral-950">{meta.title}</p>
          ) : (
            <p className="truncate text-[15px] font-semibold text-neutral-950">{filename}</p>
          )}
          {meta?.authors?.length ? (
            <p className="a2r-rise mt-1 text-[13px] text-neutral-500" style={{ "--i": 1 } as CSSProperties}>
              {meta.authors.slice(0, 4).join(", ")}
              {meta.authors.length > 4 ? " et al." : ""}
              {meta.year ? ` · ${meta.year}` : ""}
            </p>
          ) : (
            !metaDone && <Skeleton className="mt-2 h-3.5 w-2/3" />
          )}
        </div>
      </div>
      <div className="border-t border-neutral-100 px-5 py-3">
        {reading || !read ? (
          <Working>Reading your paper…</Working>
        ) : (
          <p className="flex items-center gap-2 text-[13px] text-neutral-500">
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {job?.page_count ? `${job.page_count} pages read` : "Paper read"}
          </p>
        )}
      </div>
    </Card>
  );
}
