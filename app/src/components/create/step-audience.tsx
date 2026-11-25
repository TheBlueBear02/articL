"use client";

import { useState } from "react";
import type { Audience, Job } from "@/lib/jobs";
import { ActionBar, Button, Card, ErrorNote, StepHeading, cx } from "./ui";
import { post } from "./use-job";

export const AUDIENCE_OPTIONS: { value: Audience; who: string; format: string; detail: string; icon: string }[] = [
  {
    value: "social",
    who: "General public",
    format: "Social reel",
    detail: "Fast and hooky, up to 60 seconds. Your strongest finding as the payoff.",
    icon: "M13 2L4 14h7l-1 8 9-12h-7l1-8z",
  },
  {
    value: "student",
    who: "Students",
    format: "Student reel",
    detail: "The question, how it was tested and what was found, 60 to 90 seconds.",
    icon: "M12 4L2 9l10 5 10-5-10-5zm-6 7.5V16c0 1.7 2.7 3 6 3s6-1.3 6-3v-4.5",
  },
  {
    value: "academic",
    who: "Peers & policymakers",
    format: "LinkedIn reel",
    detail: "A calm, professional summary of the question, method and findings, about 90 seconds.",
    icon: "M4 8h16v11H4zM9 8V6a1 1 0 011-1h4a1 1 0 011 1v2M4 13h16",
  },
];

/**
 * Recovery screen when a job exists but audience was never confirmed (e.g. an older /create job).
 * Happy path picks audience with the PDF on step 1.
 */
export function AudiencePicker({
  initial,
  locked,
  busy,
  error,
  onConfirm,
}: {
  initial?: Audience | null;
  locked?: boolean;
  busy?: boolean;
  error?: string | null;
  onConfirm: (audience: Audience) => void;
}) {
  const [choice, setChoice] = useState<Audience | null>(initial ?? null);
  return (
    <>
      <StepHeading step={2} eyebrow="Step 2 · Choose your target audience" title="Who is this video for?">
        This sets the format of your video.
      </StepHeading>
      <div className="space-y-3" role="radiogroup">
        {AUDIENCE_OPTIONS.map((o, i) => {
          const on = choice === o.value;
          return (
            <Card
              key={o.value}
              as="button"
              index={i}
              selected={on}
              role="radio"
              aria-checked={on}
              disabled={locked}
              onClick={() => setChoice(o.value)}
              className="p-5"
            >
              <div className="flex items-start gap-4">
                <span className={cx("flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl transition", on ? "bg-brand" : "bg-neutral-100")}>
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" aria-hidden>
                    <path d={o.icon} stroke="#111" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />
                  </svg>
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[17px] font-semibold text-neutral-950">{o.who}</span>
                    <span className="text-[12px] font-medium text-neutral-400">{o.format}</span>
                  </span>
                  <span className="mt-1 block text-[14px] leading-relaxed text-neutral-500">{o.detail}</span>
                </span>
              </div>
            </Card>
          );
        })}
      </div>
      <ErrorNote>{error}</ErrorNote>
      <ActionBar>
        <Button disabled={!choice} busy={busy} onClick={() => choice && onConfirm(choice)}>
          Continue
        </Button>
      </ActionBar>
    </>
  );
}

/** Recovery step on a job's page when audience was never saved. */
export function StepAudience({ job, onDone }: { job: Job; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(audience: Audience) {
    if (job.audience_confirmed) return onDone();
    setBusy(true);
    setError(null);
    try {
      await post(job.id, "audience", { audience });
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <AudiencePicker
      initial={job.audience_confirmed ? (job.audience ?? "social") : null}
      locked={job.audience_confirmed}
      busy={busy}
      error={error}
      onConfirm={confirm}
    />
  );
}
