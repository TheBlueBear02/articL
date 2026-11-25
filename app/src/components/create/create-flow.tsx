"use client";

import { useState } from "react";
import Link from "next/link";
import type { Job } from "@/lib/jobs";
import { ActionBar, Card, listedStep, Skeleton, TopBar } from "./ui";
import { useJob } from "./use-job";
import { StepAudience } from "./step-audience";
import { StepFindings } from "./step-findings";
import { StepHook } from "./step-hook";
import { StepAddons } from "./step-addons";
import { StepReview } from "./step-review";
import { StepBuild } from "./step-build";
import { StepResult } from "./step-result";
import { CreateAside } from "./create-aside";

type Step = 1 | 2 | 3 | 4 | 5 | 6 | 7;

/** Where the job is, from its row. Steps 4–6 also depend on what the user did this visit. */
function stepOf(job: Job, local: { approved: boolean }): Step {
  // Older jobs may still need audience before findings.
  if (!job.audience_confirmed) return 1;
  switch (job.status) {
    case "awaiting_hook":
      return 3;
    case "points_selected":
    case "scripting":
    case "voicing":
    case "voiced":
    case "awaiting_review":
      // "voiced" after the review was approved: the render is about to start.
      if (local.approved || (job.status === "voiced" && job.stage_times?.awaiting_review)) return 6;
      return job.addons_confirmed_at ? 5 : 4;
    case "fetching_broll":
    case "rendering":
      return 6;
    case "rendered":
      return 7;
    default:
      return 2;
  }
}

/** Steps 1–7 of the /create flow for one job; refresh-safe (the step comes from the job row). */
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
  if (derived === 7 && stayOnBuild) step = 6;
  if (derived === 6 && !stayOnBuild) setStayOnBuild(true);
  // Slide forward or back depending on where the user came from.
  if (step !== shown.step) setShown({ step, dir: step > shown.step ? "next" : "back" });
  const dir = step === shown.step ? shown.dir : step > shown.step ? "next" : "back";

  const goForward = (fields?: Partial<Job>) => {
    if (fields) patch(fields);
    setView(null);
  };
  const back: (() => void) | undefined =
    step === 3
      ? () => setView(2)
      : step === 5 && job.status !== "rendering"
        ? () => {
            patch({ addons_confirmed_at: null });
            setView(4);
          }
        : undefined;

  if (job.status === "failed") {
    return (
      <Shell step={step} job={job}>
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
    <Shell step={step} onBack={back} job={job} audienceRecovery={step === 1}>
      <div key={step} className={dir === "next" ? "a2r-step-next" : "a2r-step-back"}>
        {step === 1 && <StepAudience job={job} onDone={() => goForward({ audience_confirmed: true })} />}
        {step === 2 && <StepFindings job={job} onDone={() => goForward({ status: "awaiting_hook", hooks: job.hooks })} />}
        {step === 3 && <StepHook job={job} onDone={() => goForward({ status: "points_selected" })} />}
        {step === 4 && <StepAddons job={job} onDone={() => goForward({ addons_confirmed_at: new Date().toISOString() })} />}
        {step === 5 && (
          <StepReview
            job={job}
            onDone={() => {
              setApproved(true);
              goForward({ status: "voiced" });
            }}
          />
        )}
        {step === 6 && <StepBuild job={job} onDone={() => setStayOnBuild(false)} />}
        {step === 7 && <StepResult job={job} />}
      </div>
    </Shell>
  );
}

export function Shell({
  step,
  onBack,
  job,
  audienceRecovery,
  headerAction,
  children,
}: {
  step: number;
  onBack?: () => void;
  job?: Job | null;
  /** Job page still waiting on audience: highlight listed step 2. */
  audienceRecovery?: boolean;
  headerAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  const listed = listedStep(step, audienceRecovery);
  return (
    <div className="a2r a2r-page min-h-dvh">
      {/* The flow has its own top bar: hide the site header on these pages. */}
      <style>{".site-header{display:none}"}</style>
      <TopBar step={listed} onBack={onBack} action={headerAction} />
      <main className="mx-auto w-full max-w-md px-4 pb-40 lg:grid lg:min-h-[calc(100dvh-3.75rem)] lg:max-w-6xl lg:grid-cols-[minmax(0,1fr)_18.5rem] lg:items-stretch lg:gap-10 lg:px-6 lg:pb-16">
        <div id="a2r-left-col" className="flex min-w-0 flex-col lg:h-full">
          <div className="min-w-0 flex-1">{children}</div>
          {/* Desktop ActionBar portals here so the phone preview stays free. */}
          <div id="a2r-action-slot" className="pointer-events-none sticky bottom-0 z-20 mt-auto hidden w-full lg:pointer-events-auto lg:block" />
        </div>
        <CreateAside step={step} listed={listed} job={job} />
      </main>
    </div>
  );
}
