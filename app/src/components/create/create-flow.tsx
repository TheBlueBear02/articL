"use client";

import { useState } from "react";
import Link from "next/link";
import type { Job } from "@/lib/jobs";
import { Card, Skeleton, TopBar } from "./ui";
import { useJob } from "./use-job";
import { StepAudience } from "./step-audience";
import { StepFindings } from "./step-findings";
import { StepHook } from "./step-hook";
import { StepAddons } from "./step-addons";
import { StepReview } from "./step-review";
import { StepBuild } from "./step-build";
import { StepResult } from "./step-result";
import { ActionBar } from "./ui";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8;

/** Where the job is, from its row. Steps 5-7 also depend on what the user did this visit. */
function stepOf(job: Job, local: { approved: boolean }): Step {
  // Straight after the upload: the audience is asked while the paper is still being read.
  if (!job.audience_confirmed) return 2;
  switch (job.status) {
    case "awaiting_hook":
      return 4;
    case "points_selected":
    case "scripting":
    case "voicing":
    case "voiced":
    case "awaiting_review":
      // "voiced" after the review was approved: the render is about to start.
      if (local.approved || (job.status === "voiced" && job.stage_times?.awaiting_review)) return 7;
      return job.addons_confirmed_at ? 6 : 5;
    case "fetching_broll":
    case "rendering":
      return 7;
    case "rendered":
      return 8;
    default:
      return 3;
  }
}

/** Steps 2-8 of the /create flow for one job; refresh-safe (the step comes from the job row). */
export function CreateFlow({ jobId }: { jobId: string }) {
  const { job, missing, loadError, patch } = useJob(jobId);
  const [approved, setApproved] = useState(false);
  /** A step the user went back to (only ones that can still change). */
  const [view, setView] = useState<Step | null>(null);
  /** Seen building this visit: stay there when it finishes, until "Watch your video". */
  const [stayOnBuild, setStayOnBuild] = useState(false);
  const [shown, setShown] = useState<{ step: Step; dir: "next" | "back" }>({ step: 1, dir: "next" });

  if (missing || loadError) {
    return (
      <Shell step={1}>
        <Card className="mt-8 p-6 text-[15px] text-neutral-600">{loadError ?? "This video doesn't exist (or the link is wrong)."}</Card>
        <ActionBar>
          <Link href="/create" className="inline-flex h-[52px] flex-1 items-center justify-center rounded-2xl bg-brand text-[15px] font-semibold">
            Start a new video
          </Link>
        </ActionBar>
      </Shell>
    );
  }
  if (!job) {
    return (
      <Shell step={2}>
        <div className="space-y-3 pt-8">
          <Skeleton className="h-4 w-24" />
          <Skeleton className="h-8 w-3/4" />
          <Skeleton className="mt-6 h-28 w-full rounded-[20px]" />
        </div>
      </Shell>
    );
  }

  const derived = stepOf(job, { approved });
  let step: Step = view && view < derived ? view : derived;
  if (derived === 8 && stayOnBuild) step = 7;
  if (derived === 7 && !stayOnBuild) setStayOnBuild(true);
  // Slide forward or back depending on where the user came from.
  if (step !== shown.step) setShown({ step, dir: step > shown.step ? "next" : "back" });
  const dir = step === shown.step ? shown.dir : step > shown.step ? "next" : "back";

  const goForward = (fields?: Partial<Job>) => {
    if (fields) patch(fields);
    setView(null);
  };
  const back: (() => void) | undefined =
    step === 4
        ? () => setView(3)
        : step === 6 && job.status !== "rendering"
          ? () => {
              patch({ addons_confirmed_at: null });
              setView(5);
            }
          : undefined;

  if (job.status === "failed") {
    return (
      <Shell step={step}>
        <div className="a2r-step-next pt-8">
          <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-neutral-400">Stopped</p>
          <h1 className="mt-2 text-[28px] font-semibold leading-tight tracking-[-0.02em]">We couldn&apos;t finish this one</h1>
          <Card className="mt-5 p-5 text-[14px] leading-relaxed text-neutral-600">{job.error ?? "Something went wrong."}</Card>
        </div>
        <ActionBar>
          <Link href="/create" className="inline-flex h-[52px] flex-1 items-center justify-center rounded-2xl bg-brand text-[15px] font-semibold">
            Try another paper
          </Link>
        </ActionBar>
      </Shell>
    );
  }

  return (
    <Shell step={step} onBack={back}>
      <div key={step} className={dir === "next" ? "a2r-step-next" : "a2r-step-back"}>
        {step === 2 && <StepAudience job={job} onDone={() => goForward({ audience_confirmed: true })} />}
        {step === 3 && <StepFindings job={job} onDone={() => goForward({ status: "awaiting_hook", hooks: job.hooks })} />}
        {step === 4 && <StepHook job={job} onDone={() => goForward({ status: "points_selected" })} />}
        {step === 5 && <StepAddons job={job} onDone={() => goForward({ addons_confirmed_at: new Date().toISOString() })} />}
        {step === 6 && (
          <StepReview
            job={job}
            onDone={() => {
              setApproved(true);
              goForward({ status: "voiced" });
            }}
          />
        )}
        {step === 7 && <StepBuild job={job} onDone={() => setStayOnBuild(false)} />}
        {step === 8 && <StepResult job={job} />}
      </div>
    </Shell>
  );
}

export function Shell({ step, onBack, children }: { step: number; onBack?: () => void; children: React.ReactNode }) {
  return (
    <div className="a2r a2r-page min-h-dvh">
      {/* The flow has its own top bar: hide the site header on these pages. */}
      <style>{".site-header{display:none}"}</style>
      <TopBar step={step} onBack={onBack} />
      <main className="mx-auto w-full max-w-md px-4 pb-40">{children}</main>
    </div>
  );
}
