"use client";

import { useEffect, useState } from "react";
import type { Job } from "@/lib/jobs";
import { formatEstimate, type EstimateKey } from "@/lib/create-estimates";
import { TOTAL_STEPS, cx, Spinner } from "./ui";
import { PaperToReel } from "./paper-to-reel";
import { useMediaLinks } from "./step-build";
import { scriptBlocks } from "./step-review";

type Who = "you" | EstimateKey;

type RailStep = {
  label: string;
  who: Who;
};

const RAIL_STEPS: RailStep[] = [
  { label: "Upload your paper", who: "you" },
  { label: "Choose your target audience", who: "you" },
  { label: "Extracting findings", who: "findings" },
  { label: "Choose opening hook", who: "you" },
  { label: "Choose Add-ons", who: "you" },
  { label: "Writing video script", who: "script" },
  { label: "Creating the video", who: "video" },
];

type Estimates = Partial<Record<EstimateKey, number | null>>;

/** Desktop-only right pane: step rail + sticky phone preview. Hidden below `lg`. */
export function CreateAside({
  step,
  listed,
  job,
}: {
  /** Internal flow step (1–7), drives phone preview content. */
  step: number;
  /** Listed progress step (1–7), drives the rail. */
  listed: number;
  job?: Job | null;
}) {
  const [estimates, setEstimates] = useState<Estimates>({});

  useEffect(() => {
    let live = true;
    fetch("/api/create/estimates")
      .then((r) => r.json())
      .then((d) => {
        if (live && d?.estimates) setEstimates(d.estimates);
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);

  return (
    <aside className="hidden h-full pt-6 lg:sticky lg:top-20 lg:flex lg:flex-col lg:gap-5">
      <PhoneFrame>
        <PhonePreview step={step} job={job} />
      </PhoneFrame>
      <div className="h-px w-full bg-neutral-200" role="separator" />
      <StepRail step={listed} estimates={estimates} />
    </aside>
  );
}

function StepRail({ step, estimates }: { step: number; estimates: Estimates }) {
  return (
    <ol className="space-y-1" aria-label="Progress">
      {RAIL_STEPS.map((item, i) => {
        const n = i + 1;
        const current = n === step;
        const done = n < step;
        const est = item.who === "you" ? null : formatEstimate(estimates[item.who] ?? null);

        return (
          <li
            key={item.label}
            className={cx(
              "flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-[13px]",
              current && "bg-[var(--a2r-brand-tint)] text-neutral-950",
              done && "text-neutral-600",
              !current && !done && "text-neutral-400",
            )}
          >
            <span
              className={cx(
                "flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold tabular-nums",
                current && "bg-brand text-neutral-950",
                done && "bg-neutral-900 text-white",
                !current && !done && "bg-neutral-100 text-neutral-400",
              )}
            >
              {done ? (
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              ) : (
                n
              )}
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className={cx("min-w-0 truncate leading-snug", current && "font-semibold")}>{item.label}</span>
                {item.who === "you" ? (
                  <span className="shrink-0 rounded-full bg-sky-100 px-1.5 py-px text-[10px] font-semibold tracking-wide text-sky-700">
                    You
                  </span>
                ) : (
                  <span className="shrink-0 rounded-full bg-brand px-1.5 py-px text-[10px] font-semibold tracking-wide text-neutral-950">
                    AI
                  </span>
                )}
              </span>
            </span>
            {est && (
              <span
                className={cx(
                  "shrink-0 text-[11px] font-medium tabular-nums",
                  current && "text-neutral-700",
                  done && "text-neutral-500",
                  !current && !done && "text-neutral-400",
                )}
              >
                {est}
              </span>
            )}
            <span className="sr-only">
              {current ? "(current)" : done ? "(done)" : ""} · step {n} of {TOTAL_STEPS}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function PhoneFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto w-full max-w-[17rem]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-[2rem] border border-neutral-200 bg-neutral-950 shadow-[0_24px_48px_-28px_rgba(0,0,0,0.55)]">
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-2">
          <span className="h-1.5 w-16 rounded-full bg-black/40" />
        </div>
        <div className="absolute inset-0">{children}</div>
      </div>
    </div>
  );
}

function PhonePreview({ step, job }: { step: number; job?: Job | null }) {
  if (step <= 1 && !job) {
    return <PaperToReel mode="compact" />;
  }
  if (step === 1) {
    return <PaperToReel mode="compact" />;
  }
  if (step >= 2 && step <= 4) {
    return <ContextPreview job={job} step={step} />;
  }
  if (step === 5) {
    return <ScriptTeaser job={job} />;
  }
  if (step === 6 && job) {
    return <BuildPreview job={job} />;
  }
  if (step === 7 && job) {
    return <ResultPreview job={job} />;
  }
  return <SoftPlaceholder title="Your reel" line="It will show up here as you go." />;
}

function SoftPlaceholder({ title, line, eyebrow }: { title: string; line: string; eyebrow?: string }) {
  return (
    <div className="flex h-full flex-col justify-end bg-[linear-gradient(160deg,#1a1a1a_0%,#2a2a28_45%,#111_100%)] p-5 text-white">
      {eyebrow && <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-white/45">{eyebrow}</p>}
      <p className="mt-1 text-[17px] font-semibold leading-snug tracking-[-0.02em]">{title}</p>
      <p className="mt-2 text-[12px] leading-relaxed text-white/55">{line}</p>
    </div>
  );
}

function ContextPreview({ job, step }: { job?: Job | null; step: number }) {
  const title = job?.paper_meta?.title ?? job?.original_filename ?? "Your paper";
  const points = job?.candidate_points?.filter((p) => job.selected_point_ids?.includes(p.id)) ?? [];
  const lead = points.find((p) => p.id === job?.lead_point_id) ?? points[0];
  const hook = job?.chosen_hook?.hook ?? job?.hooks?.items?.[0]?.hook;

  if (step === 4 && hook) {
    return <SoftPlaceholder eyebrow="Opening" title={hook} line="Your hook will open the reel." />;
  }
  if (lead) {
    return (
      <SoftPlaceholder
        eyebrow={step === 2 ? "Lead finding" : step === 3 ? "In the reel" : "Building on"}
        title={lead.text}
        line={title}
      />
    );
  }
  return (
    <SoftPlaceholder
      eyebrow={RAIL_STEPS[step - 1]?.label ?? "Step"}
      title={title}
      line={job ? "Findings and hooks will preview here." : "Your reel preview will appear here."}
    />
  );
}

function ScriptTeaser({ job }: { job?: Job | null }) {
  const hook = job?.script?.hook ?? job?.chosen_hook?.hook;
  if (!hook) {
    return <SoftPlaceholder eyebrow="Script" title="Review your script" line="The opening line will show here." />;
  }
  return <SoftPlaceholder eyebrow="Hook" title={hook} line={job?.script?.hookTitle ?? "Opening of your reel"} />;
}

function BuildPreview({ job }: { job: Job }) {
  const links = useMediaLinks(job);
  const blocks = scriptBlocks(job);
  const rendered = job.status === "rendered";
  const progress = rendered ? 100 : job.status === "rendering" ? (job.render_progress ?? 0) : 8;
  const cover = links.cover ?? links.blocks.find(Boolean) ?? null;

  return (
    <div className="relative flex h-full flex-col bg-neutral-950 text-white">
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover opacity-80" />
      ) : (
        <div className="absolute inset-0 bg-[linear-gradient(160deg,#222_0%,#111_100%)]" />
      )}
      <div className="relative mt-auto bg-gradient-to-t from-black/90 via-black/55 to-transparent p-4 pt-16">
        <p className="text-[12px] font-semibold text-white/80">{rendered ? "Ready" : `Building · ${Math.round(progress)}%`}</p>
        <div className="mt-2 h-1 overflow-hidden rounded-full bg-white/20">
          <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${Math.max(progress, 4)}%` }} />
        </div>
        <ul className="mt-3 space-y-1.5">
          {blocks.slice(0, 4).map((b, i) => (
            <li key={b.segment} className="flex items-center gap-2 text-[11px] text-white/75">
              <span className="h-1.5 w-1.5 rounded-full bg-brand" />
              <span className="truncate">{b.title}</span>
              {links.blocks[i] ? <span className="ml-auto text-white/40">✓</span> : null}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ResultPreview({ job }: { job: Job }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    fetch(`/api/jobs/${job.id}/video`)
      .then((r) => r.json())
      .then((d) => live && !d.error && setUrl(d.url))
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [job.id]);

  if (!url) {
    return (
      <div className="flex h-full items-center justify-center bg-neutral-950 text-white/50">
        <Spinner />
      </div>
    );
  }
  return <video src={url} controls playsInline loop preload="metadata" className="h-full w-full object-cover" />;
}
